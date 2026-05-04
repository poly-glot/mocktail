// Firestore CommitRequest encoder — Zig veneer over the generated
// protobuf-c C code in ./proto.
//
// Input: a pending.Pending snapshot (per-element merged field maps) plus
// tenantId + projectId + Firestore database path.
// Output: a byte slice holding a packed google.firestore.v1.CommitRequest
// with one Write per element, LWW merge semantics via `update_mask`.
//
// Why no current_document precondition: this proxy is the FIRST writer for
// a running editing session, and the dashboard may also have written the
// doc out-of-band — either way we want upsert-with-merge, not conditional
// update. Leaving current_document unset gives Firestore the "create or
// update, merging listed fields" behavior that matches SDK `setDoc(merge)`
// calls the frontend used to make directly.

const std = @import("std");
const pending = @import("pending.zig");

pub const c = @cImport({
    @cInclude("google/firestore/v1/firestore.pb-c.h");
    @cInclude("google/firestore/v1/document.pb-c.h");
    @cInclude("google/firestore/v1/write.pb-c.h");
    @cInclude("google/firestore/v1/common.pb-c.h");
    @cInclude("protobuf-c/protobuf-c.h");
});

pub const EncodeError = error{
    OutOfMemory,
    PathTooLong,
    EmptyInput,
};

/// Arena-style builder that owns all heap for the resulting packed buffer.
/// Caller deinits; the returned slice from encode() lives until deinit().
pub const Builder = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    database: [:0]const u8,
    tenant_id: []const u8,
    project_id: []const u8,

    pub fn init(
        allocator: std.mem.Allocator,
        database: [:0]const u8,
        tenant_id: []const u8,
        project_id: []const u8,
    ) Builder {
        return .{
            .allocator = allocator,
            .arena = std.heap.ArenaAllocator.init(allocator),
            .database = database,
            .tenant_id = tenant_id,
            .project_id = project_id,
        };
    }

    pub fn deinit(self: *Builder) void {
        self.arena.deinit();
    }

    /// Build and pack a CommitRequest for the given pending snapshot. Returns
    /// OwnedSlice whose bytes are valid until the builder is deinit'd.
    pub fn encode(self: *Builder, p: *const pending.Pending) EncodeError![]const u8 {
        if (p.isEmpty()) return EncodeError.EmptyInput;
        const arena = self.arena.allocator();

        // Build one Write per pending update + one per pending deletion.
        const n_writes: usize = p.elementCount() + p.deletionCount();
        const writes = arena.alloc(*c.Google__Firestore__V1__Write, n_writes) catch return EncodeError.OutOfMemory;

        var write_idx: usize = 0;
        var it = p.entries.iterator();
        while (it.next()) |entry| : (write_idx += 1) {
            const element_id = entry.key_ptr.*;
            const fields = entry.value_ptr.*;

            const write = try self.buildWrite(arena, element_id, fields);
            writes[write_idx] = write;
        }

        var del_it = p.deleted_ids.iterator();
        while (del_it.next()) |entry| : (write_idx += 1) {
            const element_id = entry.key_ptr.*;
            writes[write_idx] = try self.buildDeleteWrite(arena, element_id);
        }

        const req = arena.create(c.Google__Firestore__V1__CommitRequest) catch return EncodeError.OutOfMemory;
        const database_cstr = try dupeCString(arena, self.database);
        req.* = c.Google__Firestore__V1__CommitRequest{
            .base = baseFor(&c.google__firestore__v1__commit_request__descriptor),
            .database = @constCast(database_cstr.ptr),
            .n_writes = n_writes,
            .writes = @ptrCast(writes.ptr),
            .transaction = .{ .len = 0, .data = null },
        };

        const packed_size = c.google__firestore__v1__commit_request__get_packed_size(req);
        const out = arena.alloc(u8, packed_size) catch return EncodeError.OutOfMemory;
        const actual = c.google__firestore__v1__commit_request__pack(req, out.ptr);
        std.debug.assert(actual == packed_size);
        return out;
    }

    fn buildWrite(
        self: *Builder,
        arena: std.mem.Allocator,
        element_id: []const u8,
        fields: *const pending.FieldMap,
    ) EncodeError!*c.Google__Firestore__V1__Write {
        // Build the Document (name + fields).
        const doc = arena.create(c.Google__Firestore__V1__Document) catch return EncodeError.OutOfMemory;
        const doc_name = try self.buildDocPath(arena, element_id);

        // The mask covers every pending field — including delete_v sentinels,
        // because Firestore deletes a field when its mask path is present and
        // the field itself is absent from the document body. The doc body
        // only carries non-delete fields, so n_doc_fields ≤ n_mask_paths.
        const n_mask_paths = fields.count();
        const fe_array = arena.alloc(*c.Google__Firestore__V1__Document__FieldsEntry, n_mask_paths) catch return EncodeError.OutOfMemory;
        const mask_paths = arena.alloc([*c]u8, n_mask_paths) catch return EncodeError.OutOfMemory;

        var doc_idx: usize = 0;
        var mask_idx: usize = 0;
        var fit = fields.iterator();
        while (fit.next()) |fe| {
            const field_name = fe.key_ptr.*;
            const field_val = fe.value_ptr.*;
            const name_cstr = try dupeCString(arena, field_name);
            mask_paths[mask_idx] = @constCast(name_cstr.ptr);
            mask_idx += 1;

            if (field_val.kind == .delete_v) continue;

            const value_msg = try buildValue(arena, field_val);
            const entry = arena.create(c.Google__Firestore__V1__Document__FieldsEntry) catch return EncodeError.OutOfMemory;
            entry.* = c.Google__Firestore__V1__Document__FieldsEntry{
                .base = baseFor(&c.google__firestore__v1__document__fields_entry__descriptor),
                .key = @constCast(name_cstr.ptr),
                .value = value_msg,
            };
            fe_array[doc_idx] = entry;
            doc_idx += 1;
        }

        doc.* = c.Google__Firestore__V1__Document{
            .base = baseFor(&c.google__firestore__v1__document__descriptor),
            .name = @constCast(doc_name.ptr),
            .n_fields = doc_idx,
            .fields = if (doc_idx == 0) null else @ptrCast(fe_array.ptr),
            .create_time = null,
            .update_time = null,
        };

        const mask = arena.create(c.Google__Firestore__V1__DocumentMask) catch return EncodeError.OutOfMemory;
        mask.* = c.Google__Firestore__V1__DocumentMask{
            .base = baseFor(&c.google__firestore__v1__document_mask__descriptor),
            .n_field_paths = n_mask_paths,
            .field_paths = mask_paths.ptr,
        };

        const write = arena.create(c.Google__Firestore__V1__Write) catch return EncodeError.OutOfMemory;
        write.* = c.Google__Firestore__V1__Write{
            .base = baseFor(&c.google__firestore__v1__write__descriptor),
            .update_mask = mask,
            .n_update_transforms = 0,
            .update_transforms = null,
            .current_document = null,
            .operation_case = c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_UPDATE,
            .unnamed_0 = .{ .update = doc },
        };
        return write;
    }

    /// Build a Write that deletes the entire element document. The protobuf
    /// union holds the document path string (no doc body, no mask).
    fn buildDeleteWrite(
        self: *Builder,
        arena: std.mem.Allocator,
        element_id: []const u8,
    ) EncodeError!*c.Google__Firestore__V1__Write {
        const doc_name = try self.buildDocPath(arena, element_id);
        const write = arena.create(c.Google__Firestore__V1__Write) catch return EncodeError.OutOfMemory;
        write.* = c.Google__Firestore__V1__Write{
            .base = baseFor(&c.google__firestore__v1__write__descriptor),
            .update_mask = null,
            .n_update_transforms = 0,
            .update_transforms = null,
            .current_document = null,
            .operation_case = c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_DELETE,
            .unnamed_0 = .{ .delete_ = @constCast(doc_name.ptr) },
        };
        return write;
    }

    fn buildDocPath(
        self: *Builder,
        arena: std.mem.Allocator,
        element_id: []const u8,
    ) EncodeError![:0]const u8 {
        return std.fmt.allocPrintSentinel(
            arena,
            "{s}/documents/tenants/{s}/projects/{s}/elements/{s}",
            .{ self.database, self.tenant_id, self.project_id, element_id },
            0,
        ) catch EncodeError.OutOfMemory;
    }
};

/// Mirror of protobuf-c's PROTOBUF_C_MESSAGE_INIT macro. Each generated
/// struct embeds a ProtobufCMessage as its first field; pack/unpack require
/// it to carry the matching descriptor and zeroed unknown-field slots.
fn baseFor(desc: *const c.ProtobufCMessageDescriptor) c.ProtobufCMessage {
    return .{ .descriptor = desc, .n_unknown_fields = 0, .unknown_fields = null };
}

fn buildValue(arena: std.mem.Allocator, fv: pending.FieldValue) EncodeError!*c.Google__Firestore__V1__Value {
    const v = arena.create(c.Google__Firestore__V1__Value) catch return EncodeError.OutOfMemory;
    v.base = baseFor(&c.google__firestore__v1__value__descriptor);
    switch (fv.kind) {
        .null_v => {
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_NULL_VALUE;
            v.unnamed_0 = .{ .null_value = 0 };
        },
        .bool_v => {
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_BOOLEAN_VALUE;
            v.unnamed_0 = .{ .boolean_value = if (fv.as_bool) 1 else 0 };
        },
        .int_v => {
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_INTEGER_VALUE;
            v.unnamed_0 = .{ .integer_value = fv.as_int };
        },
        .float_v => {
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_DOUBLE_VALUE;
            v.unnamed_0 = .{ .double_value = fv.as_float };
        },
        .string_v => {
            const dup = try dupeCString(arena, fv.text);
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_STRING_VALUE;
            v.unnamed_0 = .{ .string_value = @constCast(dup.ptr) };
        },
        .object_v => {
            const mv = try buildMapValue(arena, fv.map);
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_MAP_VALUE;
            v.unnamed_0 = .{ .map_value = mv };
        },
        .array_v => {
            const av = try buildArrayValue(arena, fv.items);
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_ARRAY_VALUE;
            v.unnamed_0 = .{ .array_value = av };
        },
        .delete_v => {
            // buildWrite filters delete_v before reaching here. If it ever
            // does, fall back to null so the output is at least well-formed.
            v.value_type_case = c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_NULL_VALUE;
            v.unnamed_0 = .{ .null_value = 0 };
        },
    }
    return v;
}

fn buildMapValue(
    arena: std.mem.Allocator,
    maybe_map: ?*pending.FieldMap,
) EncodeError!*c.Google__Firestore__V1__MapValue {
    const mv = arena.create(c.Google__Firestore__V1__MapValue) catch return EncodeError.OutOfMemory;
    const map_ptr = maybe_map orelse {
        mv.* = c.Google__Firestore__V1__MapValue{
            .base = baseFor(&c.google__firestore__v1__map_value__descriptor),
            .n_fields = 0,
            .fields = null,
        };
        return mv;
    };
    const n = map_ptr.count();
    const fe_array = arena.alloc(*c.Google__Firestore__V1__MapValue__FieldsEntry, n) catch return EncodeError.OutOfMemory;
    var i: usize = 0;
    var it = map_ptr.iterator();
    while (it.next()) |e| : (i += 1) {
        const key_cstr = try dupeCString(arena, e.key_ptr.*);
        const child_val = try buildValue(arena, e.value_ptr.*);
        const entry = arena.create(c.Google__Firestore__V1__MapValue__FieldsEntry) catch return EncodeError.OutOfMemory;
        entry.* = c.Google__Firestore__V1__MapValue__FieldsEntry{
            .base = baseFor(&c.google__firestore__v1__map_value__fields_entry__descriptor),
            .key = @constCast(key_cstr.ptr),
            .value = child_val,
        };
        fe_array[i] = entry;
    }
    mv.* = c.Google__Firestore__V1__MapValue{
        .base = baseFor(&c.google__firestore__v1__map_value__descriptor),
        .n_fields = n,
        .fields = if (n == 0) null else @ptrCast(fe_array.ptr),
    };
    return mv;
}

fn buildArrayValue(
    arena: std.mem.Allocator,
    items: []const pending.FieldValue,
) EncodeError!*c.Google__Firestore__V1__ArrayValue {
    const av = arena.create(c.Google__Firestore__V1__ArrayValue) catch return EncodeError.OutOfMemory;
    const n = items.len;
    const val_array = arena.alloc(*c.Google__Firestore__V1__Value, n) catch return EncodeError.OutOfMemory;
    for (items, 0..) |child, idx| {
        val_array[idx] = try buildValue(arena, child);
    }
    av.* = c.Google__Firestore__V1__ArrayValue{
        .base = baseFor(&c.google__firestore__v1__array_value__descriptor),
        .n_values = n,
        .values = if (n == 0) null else @ptrCast(val_array.ptr),
    };
    return av;
}

fn dupeCString(arena: std.mem.Allocator, s: []const u8) EncodeError![:0]const u8 {
    return arena.dupeZ(u8, s) catch EncodeError.OutOfMemory;
}

// ----- tests ----------------------------------------------------------------

test "encode roundtrips through protobuf-c unpack" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10,\"y\":20,\"color\":\"#abc\"}");
    try p.mergeEdit("el-2", "{\"w\":100}");

    var b = Builder.init(
        allocator,
        "projects/demo-mocktail/databases/(default)",
        "tenant-a",
        "proj-42",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);
    try std.testing.expect(decoded != null);
    try std.testing.expectEqualStrings(
        "projects/demo-mocktail/databases/(default)",
        std.mem.span(decoded.*.database),
    );
    try std.testing.expectEqual(@as(usize, 2), decoded.*.n_writes);

    var saw_el1 = false;
    var saw_el2 = false;
    var i: usize = 0;
    while (i < decoded.*.n_writes) : (i += 1) {
        const write = decoded.*.writes[i];
        try std.testing.expectEqual(
            @as(c_uint, c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_UPDATE),
            write.*.operation_case,
        );
        const doc = write.*.unnamed_0.update;
        const name = std.mem.span(doc.*.name);
        if (std.mem.endsWith(u8, name, "/elements/el-1")) {
            saw_el1 = true;
            try std.testing.expectEqual(@as(usize, 3), doc.*.n_fields);
            try std.testing.expectEqual(@as(usize, 3), write.*.update_mask.*.n_field_paths);
        } else if (std.mem.endsWith(u8, name, "/elements/el-2")) {
            saw_el2 = true;
            try std.testing.expectEqual(@as(usize, 1), doc.*.n_fields);
        }
    }
    try std.testing.expect(saw_el1);
    try std.testing.expect(saw_el2);
}

test "encode emits nested map_value and array_value" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    // Shape mirrors inspector edits: `data: { ... }` nested object, plus an
    // array of primitives. These previously encoded as null_value stubs.
    try p.mergeEdit("el-1", "{\"data\":{\"variant\":\"primary\",\"size\":3},\"tags\":[\"a\",\"b\"]}");

    var b = Builder.init(
        allocator,
        "projects/demo/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);

    const write = decoded.*.writes[0];
    const doc = write.*.unnamed_0.update;

    var saw_map = false;
    var saw_array = false;
    var i: usize = 0;
    while (i < doc.*.n_fields) : (i += 1) {
        const fe = doc.*.fields[i];
        const key = std.mem.span(fe.*.key);
        if (std.mem.eql(u8, key, "data")) {
            try std.testing.expectEqual(
                @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_MAP_VALUE),
                fe.*.value.*.value_type_case,
            );
            const mv = fe.*.value.*.unnamed_0.map_value;
            try std.testing.expectEqual(@as(usize, 2), mv.*.n_fields);
            var j: usize = 0;
            while (j < mv.*.n_fields) : (j += 1) {
                const inner_entry = mv.*.fields[j];
                const inner_key = std.mem.span(inner_entry.*.key);
                if (std.mem.eql(u8, inner_key, "variant")) {
                    try std.testing.expectEqual(
                        @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_STRING_VALUE),
                        inner_entry.*.value.*.value_type_case,
                    );
                    try std.testing.expectEqualStrings(
                        "primary",
                        std.mem.span(inner_entry.*.value.*.unnamed_0.string_value),
                    );
                } else if (std.mem.eql(u8, inner_key, "size")) {
                    try std.testing.expectEqual(
                        @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_INTEGER_VALUE),
                        inner_entry.*.value.*.value_type_case,
                    );
                    try std.testing.expectEqual(
                        @as(i64, 3),
                        inner_entry.*.value.*.unnamed_0.integer_value,
                    );
                }
            }
            saw_map = true;
        } else if (std.mem.eql(u8, key, "tags")) {
            try std.testing.expectEqual(
                @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_ARRAY_VALUE),
                fe.*.value.*.value_type_case,
            );
            const av = fe.*.value.*.unnamed_0.array_value;
            try std.testing.expectEqual(@as(usize, 2), av.*.n_values);
            try std.testing.expectEqualStrings(
                "a",
                std.mem.span(av.*.values[0].*.unnamed_0.string_value),
            );
            try std.testing.expectEqualStrings(
                "b",
                std.mem.span(av.*.values[1].*.unnamed_0.string_value),
            );
            saw_array = true;
        }
    }
    try std.testing.expect(saw_map);
    try std.testing.expect(saw_array);
}

test "encode emits Write.delete for queued deletions" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    try p.markDeleted("el-doomed");

    var b = Builder.init(
        allocator,
        "projects/demo/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);

    try std.testing.expectEqual(@as(usize, 1), decoded.*.n_writes);
    const w = decoded.*.writes[0];
    try std.testing.expectEqual(
        @as(c_uint, c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_DELETE),
        w.*.operation_case,
    );
    try std.testing.expect(w.*.update_mask == null);
    const path = std.mem.span(w.*.unnamed_0.delete_);
    try std.testing.expect(std.mem.endsWith(u8, path, "/elements/el-doomed"));
}

test "encode mixes update and delete writes in a single CommitRequest" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10}");
    try p.markDeleted("el-2");

    var b = Builder.init(
        allocator,
        "projects/demo/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);

    try std.testing.expectEqual(@as(usize, 2), decoded.*.n_writes);
    var saw_update = false;
    var saw_delete = false;
    var i: usize = 0;
    while (i < decoded.*.n_writes) : (i += 1) {
        const w = decoded.*.writes[i];
        if (w.*.operation_case == c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_UPDATE) {
            saw_update = true;
            const name = std.mem.span(w.*.unnamed_0.update.*.name);
            try std.testing.expect(std.mem.endsWith(u8, name, "/elements/el-1"));
        } else if (w.*.operation_case == c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_DELETE) {
            saw_delete = true;
            const name = std.mem.span(w.*.unnamed_0.delete_);
            try std.testing.expect(std.mem.endsWith(u8, name, "/elements/el-2"));
        }
    }
    try std.testing.expect(saw_update);
    try std.testing.expect(saw_delete);
}

test "encode emits delete_v as mask path with field omitted from doc body" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"x\":10}");
    try p.markDeletedFields("el-1", &.{"color"});

    var b = Builder.init(
        allocator,
        "projects/demo/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);

    const w = decoded.*.writes[0];
    try std.testing.expectEqual(
        @as(c_uint, c.GOOGLE__FIRESTORE__V1__WRITE__OPERATION_UPDATE),
        w.*.operation_case,
    );
    const doc = w.*.unnamed_0.update;
    // Body has `x` only; mask has both `x` and `color`.
    try std.testing.expectEqual(@as(usize, 1), doc.*.n_fields);
    try std.testing.expectEqualStrings("x", std.mem.span(doc.*.fields[0].*.key));

    try std.testing.expectEqual(@as(usize, 2), w.*.update_mask.*.n_field_paths);
    var saw_x = false;
    var saw_color = false;
    var j: usize = 0;
    while (j < w.*.update_mask.*.n_field_paths) : (j += 1) {
        const path = std.mem.span(w.*.update_mask.*.field_paths[j]);
        if (std.mem.eql(u8, path, "x")) saw_x = true;
        if (std.mem.eql(u8, path, "color")) saw_color = true;
    }
    try std.testing.expect(saw_x);
    try std.testing.expect(saw_color);
}

test "encode rejects empty pending snapshot" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    var b = Builder.init(
        allocator,
        "projects/x/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    try std.testing.expectError(EncodeError.EmptyInput, b.encode(&p));
}

test "encode emits integer vs double values" {
    const allocator = std.testing.allocator;
    var p = pending.Pending.init(allocator);
    defer p.deinit();

    try p.mergeEdit("el-1", "{\"count\":42,\"rotation\":1.5}");

    var b = Builder.init(
        allocator,
        "projects/demo/databases/(default)",
        "t",
        "p",
    );
    defer b.deinit();
    const bytes = try b.encode(&p);

    const decoded = c.google__firestore__v1__commit_request__unpack(null, bytes.len, bytes.ptr);
    defer c.google__firestore__v1__commit_request__free_unpacked(decoded, null);

    const write = decoded.*.writes[0];
    const doc = write.*.unnamed_0.update;
    var saw_int = false;
    var saw_double = false;
    var i: usize = 0;
    while (i < doc.*.n_fields) : (i += 1) {
        const fe = doc.*.fields[i];
        const key = std.mem.span(fe.*.key);
        if (std.mem.eql(u8, key, "count")) {
            try std.testing.expectEqual(
                @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_INTEGER_VALUE),
                fe.*.value.*.value_type_case,
            );
            try std.testing.expectEqual(@as(i64, 42), fe.*.value.*.unnamed_0.integer_value);
            saw_int = true;
        } else if (std.mem.eql(u8, key, "rotation")) {
            try std.testing.expectEqual(
                @as(c_uint, c.GOOGLE__FIRESTORE__V1__VALUE__VALUE_TYPE_DOUBLE_VALUE),
                fe.*.value.*.value_type_case,
            );
            try std.testing.expectEqual(@as(f64, 1.5), fe.*.value.*.unnamed_0.double_value);
            saw_double = true;
        }
    }
    try std.testing.expect(saw_int);
    try std.testing.expect(saw_double);
}
