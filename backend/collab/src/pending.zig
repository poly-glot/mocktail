// Per-room pending-patch buffer for the Firestore write coalescer.
//
// Design:
//   - Keyed by elementId (owned string).
//   - Each entry is a flat map of field-name -> JSON value (arena-owned).
//   - mergeEdit() upserts field-by-field across frames so repeated drags on
//     x,y coalesce into a single Firestore write at flush time.
//   - clearRetainingCapacity() resets after a successful flush without
//     releasing HashMap buckets, minimising churn.
//
// Memory ownership:
//   - `arena` owns all element-id keys, field-name keys, and JSON value
//     slices. Call reset() at flush time (after the RPC completes) to reclaim
//     everything in one shot.
//   - `parsed_pool` keeps the std.json parse trees alive long enough for
//     borrowed-slice fields to point into them.

const std = @import("std");

pub const Error = error{
    OutOfMemory,
    InvalidPatch,
};

/// One elementId's merged field set. Iteration order is insertion-ordered so
/// flush output is stable across runs (handy for tests and log grepping).
pub const FieldMap = std.StringArrayHashMapUnmanaged(FieldValue);

/// A single JSON value captured at merge time. The slice lives in the owning
/// Pending arena or in a parsed-tree slot.
///
/// `delete_v` is a sentinel kind used for field-level deletions. The encoder
/// emits it as an update_mask path with the field *absent* from the document,
/// which Firestore interprets as "remove this field". It's not a JSON shape
/// that arrives from the wire — callers use markDeletedFields() to inject it.
pub const FieldValue = struct {
    kind: Kind,
    text: []const u8 = "", // raw JSON text for string/number; reused for error reporting
    as_bool: bool = false,
    as_int: i64 = 0,
    as_float: f64 = 0,
    /// Populated when kind == object_v. Pointer indirection avoids the
    /// self-referential struct issue.
    map: ?*FieldMap = null,
    /// Populated when kind == array_v. Empty slice otherwise.
    items: []FieldValue = &.{},

    pub const Kind = enum { null_v, bool_v, int_v, float_v, string_v, object_v, array_v, delete_v };
};

pub const Pending = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    /// elementId -> FieldMap. Values are heap-allocated FieldMap structs so
    /// we can mutate them in place without re-hashing.
    entries: std.StringArrayHashMapUnmanaged(*FieldMap) = .{},
    /// elementIds queued for full-document deletion. A delete wins over any
    /// pending edits for the same id (edits are dropped in markDeleted), and
    /// a subsequent edit on a deleted id resurrects it (delete is dropped in
    /// mergeEdit). The flush turns these into Write.delete protobuf messages.
    deleted_ids: std.StringArrayHashMapUnmanaged(void) = .{},
    last_edit_ns: i128 = 0,
    last_flush_ns: i128 = 0,

    pub fn init(allocator: std.mem.Allocator) Pending {
        return .{
            .allocator = allocator,
            .arena = std.heap.ArenaAllocator.init(allocator),
        };
    }

    pub fn deinit(self: *Pending) void {
        self.entries.deinit(self.allocator);
        self.deleted_ids.deinit(self.allocator);
        self.arena.deinit();
    }

    /// Merge the top-level fields of `patch_json` into the element's pending
    /// FieldMap. `patch_json` must be a JSON object; other shapes return
    /// InvalidPatch so malformed traffic is logged and dropped, not crashed on.
    pub fn mergeEdit(self: *Pending, element_id: []const u8, patch_json: []const u8) !void {
        const arena = self.arena.allocator();
        const parsed = std.json.parseFromSlice(std.json.Value, arena, patch_json, .{}) catch {
            return Error.InvalidPatch;
        };
        // Parse result is arena-owned; don't deinit — the arena lives until flush.
        if (parsed.value != .object) return Error.InvalidPatch;

        // An edit arriving after a delete resurrects the element. Drop the
        // delete so we don't emit both Write.delete and Write.update in the
        // same flush.
        _ = self.deleted_ids.swapRemove(element_id);

        const gop = try self.entries.getOrPut(self.allocator, element_id);
        if (!gop.found_existing) {
            // Dupe the element-id so callers can free their own buffer. The
            // arena owns the dup; it's reset on clear().
            gop.key_ptr.* = try arena.dupe(u8, element_id);
            const map = try arena.create(FieldMap);
            map.* = .{};
            gop.value_ptr.* = map;
        }

        // Inner FieldMap uses the arena so a single arena reset on clear()
        // reclaims its buckets too — no parallel free loop required.
        const map = gop.value_ptr.*;
        var it = parsed.value.object.iterator();
        while (it.next()) |e| {
            const key_dup = try arena.dupe(u8, e.key_ptr.*);
            const fv = try valueFromJson(arena, e.value_ptr.*);
            try map.put(arena, key_dup, fv);
        }
    }

    /// Queue an element for full-document deletion. Drops any pending edits
    /// for the same id — the delete wins, and we don't want the encoder to
    /// emit both a Write.update and a Write.delete in the same CommitRequest.
    pub fn markDeleted(self: *Pending, element_id: []const u8) !void {
        if (element_id.len == 0) return Error.InvalidPatch;
        _ = self.entries.swapRemove(element_id);

        const arena = self.arena.allocator();
        const gop = try self.deleted_ids.getOrPut(self.allocator, element_id);
        if (!gop.found_existing) {
            gop.key_ptr.* = try arena.dupe(u8, element_id);
        }
    }

    /// Queue field-level deletions (Firestore treats a field listed in
    /// update_mask but absent from the document as "delete this field").
    /// No-op when the element is already queued for full deletion.
    pub fn markDeletedFields(
        self: *Pending,
        element_id: []const u8,
        fields: []const []const u8,
    ) !void {
        if (element_id.len == 0) return Error.InvalidPatch;
        if (fields.len == 0) return;
        if (self.deleted_ids.contains(element_id)) return;

        const arena = self.arena.allocator();
        const gop = try self.entries.getOrPut(self.allocator, element_id);
        if (!gop.found_existing) {
            gop.key_ptr.* = try arena.dupe(u8, element_id);
            const map = try arena.create(FieldMap);
            map.* = .{};
            gop.value_ptr.* = map;
        }
        const map = gop.value_ptr.*;
        for (fields) |f| {
            if (f.len == 0) continue;
            const key_dup = try arena.dupe(u8, f);
            try map.put(arena, key_dup, FieldValue{ .kind = .delete_v });
        }
    }

    /// Total field count across all pending elements. Flush triggers compare
    /// this against the size threshold. Includes delete_v sentinels — a field
    /// deletion is still a field write and should count toward the budget.
    pub fn pendingFieldCount(self: *const Pending) usize {
        var total: usize = 0;
        var it = self.entries.iterator();
        while (it.next()) |e| total += e.value_ptr.*.count();
        return total;
    }

    pub fn elementCount(self: *const Pending) usize {
        return self.entries.count();
    }

    pub fn deletionCount(self: *const Pending) usize {
        return self.deleted_ids.count();
    }

    /// True when there are no pending updates AND no pending deletions.
    /// Flush triggers should consult this rather than elementCount() alone.
    pub fn isEmpty(self: *const Pending) bool {
        return self.entries.count() == 0 and self.deleted_ids.count() == 0;
    }

    /// Drop all pending state after a successful flush. Arena reset reclaims
    /// all inner-map buckets, keys, and JSON value slices in one shot; the
    /// outer entries / deleted_ids maps keep their bucket arrays for reuse.
    pub fn clear(self: *Pending) void {
        self.entries.clearRetainingCapacity();
        self.deleted_ids.clearRetainingCapacity();
        _ = self.arena.reset(.retain_capacity);
    }
};

// Explicit error set keeps recursion inferable and callers tight.
fn valueFromJson(arena: std.mem.Allocator, v: std.json.Value) error{OutOfMemory}!FieldValue {
    return switch (v) {
        .null => FieldValue{ .kind = .null_v },
        .bool => |b| FieldValue{ .kind = .bool_v, .as_bool = b },
        .integer => |i| FieldValue{ .kind = .int_v, .as_int = i },
        .float => |f| FieldValue{ .kind = .float_v, .as_float = f },
        .number_string => |s| blk: {
            // std.json emits number_string when a number exceeds i64 range;
            // parse as float so we still round-trip something into Firestore.
            const dup = try arena.dupe(u8, s);
            const f = std.fmt.parseFloat(f64, dup) catch break :blk FieldValue{ .kind = .string_v, .text = dup };
            break :blk FieldValue{ .kind = .float_v, .as_float = f, .text = dup };
        },
        .string => |s| FieldValue{ .kind = .string_v, .text = try arena.dupe(u8, s) },
        .array => |arr| blk: {
            const items = try arena.alloc(FieldValue, arr.items.len);
            for (arr.items, 0..) |child, idx| {
                items[idx] = try valueFromJson(arena, child);
            }
            break :blk FieldValue{ .kind = .array_v, .items = items };
        },
        .object => |obj| blk: {
            const map = try arena.create(FieldMap);
            map.* = .{};
            var it = obj.iterator();
            while (it.next()) |e| {
                const key_dup = try arena.dupe(u8, e.key_ptr.*);
                const fv = try valueFromJson(arena, e.value_ptr.*);
                try map.put(arena, key_dup, fv);
            }
            break :blk FieldValue{ .kind = .object_v, .map = map };
        },
    };
}

// ----- tests ----------------------------------------------------------------

test "mergeEdit merges disjoint fields across frames" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10,\"y\":20}");
    try p.mergeEdit("el-1", "{\"color\":\"#abc\"}");

    try std.testing.expectEqual(@as(usize, 1), p.elementCount());
    const map = p.entries.get("el-1").?;
    try std.testing.expectEqual(@as(usize, 3), map.count());
    try std.testing.expectEqual(@as(i64, 10), map.get("x").?.as_int);
    try std.testing.expectEqual(@as(i64, 20), map.get("y").?.as_int);
    try std.testing.expectEqualStrings("#abc", map.get("color").?.text);
}

test "mergeEdit overwrites last-writer-wins per field" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10}");
    try p.mergeEdit("el-1", "{\"x\":42}");

    const map = p.entries.get("el-1").?;
    try std.testing.expectEqual(@as(usize, 1), map.count());
    try std.testing.expectEqual(@as(i64, 42), map.get("x").?.as_int);
}

test "mergeEdit tracks multiple elements" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":1}");
    try p.mergeEdit("el-2", "{\"y\":2}");
    try p.mergeEdit("el-1", "{\"color\":\"red\"}");

    try std.testing.expectEqual(@as(usize, 2), p.elementCount());
    try std.testing.expectEqual(@as(usize, 3), p.pendingFieldCount());
}

test "mergeEdit handles null, bool, float" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"a\":null,\"b\":true,\"c\":1.5}");
    const map = p.entries.get("el-1").?;
    try std.testing.expectEqual(FieldValue.Kind.null_v, map.get("a").?.kind);
    try std.testing.expectEqual(true, map.get("b").?.as_bool);
    try std.testing.expectEqual(@as(f64, 1.5), map.get("c").?.as_float);
}

test "mergeEdit rejects non-object shapes" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try std.testing.expectError(Error.InvalidPatch, p.mergeEdit("el-1", "[1,2,3]"));
    try std.testing.expectError(Error.InvalidPatch, p.mergeEdit("el-1", "not-json"));
}

test "mergeEdit captures nested object and array" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"data\":{\"variant\":\"primary\",\"size\":3},\"tags\":[\"a\",\"b\"]}");
    const map = p.entries.get("el-1").?;

    const data_fv = map.get("data").?;
    try std.testing.expectEqual(FieldValue.Kind.object_v, data_fv.kind);
    const inner = data_fv.map.?;
    try std.testing.expectEqual(@as(usize, 2), inner.count());
    try std.testing.expectEqualStrings("primary", inner.get("variant").?.text);
    try std.testing.expectEqual(@as(i64, 3), inner.get("size").?.as_int);

    const tags_fv = map.get("tags").?;
    try std.testing.expectEqual(FieldValue.Kind.array_v, tags_fv.kind);
    try std.testing.expectEqual(@as(usize, 2), tags_fv.items.len);
    try std.testing.expectEqualStrings("a", tags_fv.items[0].text);
    try std.testing.expectEqualStrings("b", tags_fv.items[1].text);
}

test "markDeleted queues a deletion and drops pending edits" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":1,\"y\":2}");
    try std.testing.expectEqual(@as(usize, 1), p.elementCount());

    try p.markDeleted("el-1");
    try std.testing.expectEqual(@as(usize, 0), p.elementCount());
    try std.testing.expectEqual(@as(usize, 1), p.deletionCount());
    try std.testing.expect(p.deleted_ids.contains("el-1"));
}

test "markDeleted then mergeEdit resurrects the element" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.markDeleted("el-1");
    try p.mergeEdit("el-1", "{\"x\":42}");

    try std.testing.expectEqual(@as(usize, 0), p.deletionCount());
    try std.testing.expectEqual(@as(usize, 1), p.elementCount());
    try std.testing.expectEqual(@as(i64, 42), p.entries.get("el-1").?.get("x").?.as_int);
}

test "markDeletedFields queues delete sentinels into FieldMap" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10,\"color\":\"#abc\"}");
    try p.markDeletedFields("el-1", &.{ "color", "borderColor" });

    const map = p.entries.get("el-1").?;
    try std.testing.expectEqual(FieldValue.Kind.delete_v, map.get("color").?.kind);
    try std.testing.expectEqual(FieldValue.Kind.delete_v, map.get("borderColor").?.kind);
    // The unrelated field stays put.
    try std.testing.expectEqual(@as(i64, 10), map.get("x").?.as_int);
}

test "markDeletedFields is a no-op when element is queued for full deletion" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.markDeleted("el-1");
    try p.markDeletedFields("el-1", &.{"color"});
    try std.testing.expectEqual(@as(usize, 0), p.elementCount());
    try std.testing.expectEqual(@as(usize, 1), p.deletionCount());
}

test "isEmpty considers both updates and deletions" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try std.testing.expect(p.isEmpty());
    try p.markDeleted("el-1");
    try std.testing.expect(!p.isEmpty());
    p.clear();
    try std.testing.expect(p.isEmpty());
}

test "clear releases field counts but keeps capacity" {
    var p = Pending.init(std.testing.allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":1}");
    try std.testing.expectEqual(@as(usize, 1), p.elementCount());
    p.clear();
    try std.testing.expectEqual(@as(usize, 0), p.elementCount());
    try std.testing.expectEqual(@as(usize, 0), p.pendingFieldCount());

    // Reuse after clear — no allocator abort, stays healthy.
    try p.mergeEdit("el-1", "{\"y\":2}");
    try std.testing.expectEqual(@as(usize, 1), p.elementCount());
}
