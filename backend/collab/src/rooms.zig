// Collab rooms — per-project pub/sub over WebSocket.
//
// Design:
//   - A Room holds a list of connection slots (u32) currently subscribed.
//   - Rooms are keyed by project-id string and kept in a fixed array owned
//     by Manager (MVP: linear scan is fine at MAX_ROOMS=256).
//   - Membership changes are driven by the WS reactor (join/leave hooks).
//   - Broadcast is a simple fan-out loop; the reactor handles backpressure.
//
// Firestore-proxy state (Phase 1):
//   - Room owns a `pending` map keyed by elementId, merged across WS edit
//     frames between flushes. Arena-backed, reset on flush.
//   - `tenant_id` is set at join time (first caller wins) and is needed to
//     build the Firestore document path `tenants/{tid}/projects/{pid}/...`.
//   - `last_edit_ns` / `last_flush_ns` feed the flush trigger in the reactor.

const std = @import("std");
const pending_mod = @import("pending.zig");

pub const MAX_ROOMS: usize = 256;
pub const MAX_PER_ROOM: usize = 32;
pub const MAX_ROOM_KEY: usize = 128;
pub const MAX_TENANT_ID: usize = 64;

/// Presence state kept per connection in a room.
pub const Member = struct {
    slot: u32,
    user_id_len: u8 = 0,
    user_id_buf: [64]u8 = undefined,
    name_len: u8 = 0,
    name_buf: [48]u8 = undefined,
    color_len: u8 = 0,
    color_buf: [12]u8 = undefined,

    pub fn userId(self: *const Member) []const u8 {
        return self.user_id_buf[0..self.user_id_len];
    }
    pub fn name(self: *const Member) []const u8 {
        return self.name_buf[0..self.name_len];
    }
    pub fn color(self: *const Member) []const u8 {
        return self.color_buf[0..self.color_len];
    }

    pub fn setFields(self: *Member, user_id: []const u8, nm: []const u8, col: []const u8) void {
        const u_n = @min(user_id.len, self.user_id_buf.len);
        @memcpy(self.user_id_buf[0..u_n], user_id[0..u_n]);
        self.user_id_len = @intCast(u_n);

        const n_n = @min(nm.len, self.name_buf.len);
        @memcpy(self.name_buf[0..n_n], nm[0..n_n]);
        self.name_len = @intCast(n_n);

        const c_n = @min(col.len, self.color_buf.len);
        @memcpy(self.color_buf[0..c_n], col[0..c_n]);
        self.color_len = @intCast(c_n);
    }
};

pub const Room = struct {
    key_buf: [MAX_ROOM_KEY]u8 = undefined,
    key_len: usize = 0,
    tenant_id_buf: [MAX_TENANT_ID]u8 = undefined,
    tenant_id_len: usize = 0,
    members: [MAX_PER_ROOM]Member = undefined,
    member_count: usize = 0,
    /// Merged-field buffer. Non-null once the room has seen any edit; stays
    /// null for broadcast-only rooms (no tenant -> no Firestore writes).
    pending: ?pending_mod.Pending = null,
    last_edit_ns: i128 = 0,
    last_flush_ns: i128 = 0,

    pub fn key(self: *const Room) []const u8 {
        return self.key_buf[0..self.key_len];
    }

    pub fn tenantId(self: *const Room) []const u8 {
        return self.tenant_id_buf[0..self.tenant_id_len];
    }

    pub fn addMember(self: *Room, slot: u32) ?*Member {
        if (self.member_count >= MAX_PER_ROOM) return null;
        const m = &self.members[self.member_count];
        m.* = .{ .slot = slot };
        self.member_count += 1;
        return m;
    }

    pub fn removeSlot(self: *Room, slot: u32) bool {
        var i: usize = 0;
        while (i < self.member_count) : (i += 1) {
            if (self.members[i].slot == slot) {
                const last = self.member_count - 1;
                if (i != last) self.members[i] = self.members[last];
                self.member_count = last;
                return true;
            }
        }
        return false;
    }

    pub fn findSlot(self: *Room, slot: u32) ?*Member {
        var i: usize = 0;
        while (i < self.member_count) : (i += 1) {
            if (self.members[i].slot == slot) return &self.members[i];
        }
        return null;
    }

    /// Returns the room's Pending, lazily allocating on first use. Only rooms
    /// with a non-empty tenant should call this — broadcast-only rooms skip.
    pub fn ensurePending(self: *Room, allocator: std.mem.Allocator) *pending_mod.Pending {
        if (self.pending == null) {
            self.pending = pending_mod.Pending.init(allocator);
        }
        return &self.pending.?;
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    rooms: [MAX_ROOMS]Room = undefined,
    room_count: usize = 0,
    /// slot -> room index, or -1 when the slot isn't in any room.
    slot_to_room: [4096]i16 = [_]i16{-1} ** 4096,

    pub fn init(allocator: std.mem.Allocator) Manager {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Manager) void {
        var i: usize = 0;
        while (i < self.room_count) : (i += 1) {
            if (self.rooms[i].pending) |*p| p.deinit();
        }
    }

    fn roomIndex(self: *Manager, k: []const u8) ?usize {
        var i: usize = 0;
        while (i < self.room_count) : (i += 1) {
            if (std.mem.eql(u8, self.rooms[i].key(), k)) return i;
        }
        return null;
    }

    fn createRoom(self: *Manager, k: []const u8, tenant_id: []const u8) ?*Room {
        if (self.room_count >= MAX_ROOMS) return null;
        var room = &self.rooms[self.room_count];
        room.* = .{};
        const n = @min(k.len, MAX_ROOM_KEY);
        @memcpy(room.key_buf[0..n], k[0..n]);
        room.key_len = n;
        const tn = @min(tenant_id.len, MAX_TENANT_ID);
        @memcpy(room.tenant_id_buf[0..tn], tenant_id[0..tn]);
        room.tenant_id_len = tn;
        self.room_count += 1;
        return room;
    }

    pub fn join(
        self: *Manager,
        slot: u32,
        tenant_id: []const u8,
        project_id: []const u8,
        user_id: []const u8,
        name: []const u8,
        color: []const u8,
    ) ?*Room {
        if (slot >= self.slot_to_room.len) return null;
        // Leave previous room if any.
        _ = self.leave(slot);

        const idx = self.roomIndex(project_id) orelse blk: {
            _ = self.createRoom(project_id, tenant_id) orelse return null;
            break :blk self.room_count - 1;
        };
        var room = &self.rooms[idx];
        const member = room.addMember(slot) orelse return null;
        member.setFields(user_id, name, color);
        self.slot_to_room[slot] = @intCast(idx);
        return room;
    }

    /// Returns the room that the slot was removed from (so caller can broadcast leave)
    /// or null if it wasn't in a room.
    pub fn leave(self: *Manager, slot: u32) ?*Room {
        if (slot >= self.slot_to_room.len) return null;
        const idx = self.slot_to_room[slot];
        if (idx < 0) return null;
        const i: usize = @intCast(idx);
        if (i >= self.room_count) {
            self.slot_to_room[slot] = -1;
            return null;
        }
        var room = &self.rooms[i];
        _ = room.removeSlot(slot);
        self.slot_to_room[slot] = -1;
        // Do not compact rooms; empty rooms are harmless for MVP.
        return room;
    }

    pub fn roomForSlot(self: *Manager, slot: u32) ?*Room {
        if (slot >= self.slot_to_room.len) return null;
        const idx = self.slot_to_room[slot];
        if (idx < 0) return null;
        const i: usize = @intCast(idx);
        if (i >= self.room_count) return null;
        return &self.rooms[i];
    }
};

test "join/leave round-trip" {
    var m = Manager.init(std.testing.allocator);
    defer m.deinit();
    _ = m.join(1, "t1", "p1", "u1", "Alice", "#000").?;
    _ = m.join(2, "t1", "p1", "u2", "Bob", "#333").?;
    const r = m.roomForSlot(1).?;
    try std.testing.expectEqual(@as(usize, 2), r.member_count);
    try std.testing.expectEqualStrings("t1", r.tenantId());
    _ = m.leave(1);
    const r2 = m.roomForSlot(2).?;
    try std.testing.expectEqual(@as(usize, 1), r2.member_count);
}

test "room tenant is set on first join and preserved" {
    var m = Manager.init(std.testing.allocator);
    defer m.deinit();
    _ = m.join(1, "tenant-a", "proj-42", "u1", "A", "#000").?;
    // Second joiner sending a different tenant doesn't overwrite; first wins
    // so the Firestore path for the room stays consistent.
    _ = m.join(2, "tenant-b", "proj-42", "u2", "B", "#111").?;
    const r = m.roomForSlot(1).?;
    try std.testing.expectEqualStrings("tenant-a", r.tenantId());
}

test "ensurePending lazily allocates and survives clear" {
    var m = Manager.init(std.testing.allocator);
    defer m.deinit();
    const room = m.join(1, "t1", "p1", "u", "N", "#000").?;
    try std.testing.expect(room.pending == null);
    const p = room.ensurePending(std.testing.allocator);
    try p.mergeEdit("el-1", "{\"x\":1}");
    try std.testing.expectEqual(@as(usize, 1), p.elementCount());
    p.clear();
    // Subsequent calls return the same instance, already re-usable.
    const p2 = room.ensurePending(std.testing.allocator);
    try std.testing.expectEqual(p, p2);
}
