// mocktail — single-threaded epoll reactor WebSocket server.
//
// Shape:
//   - One epoll fd, all sockets non-blocking, level-triggered.
//   - Fixed connection pool (MAX_CONNECTIONS), free-list slot allocator.
//   - Per-slot stack-allocated read/write buffers: no per-request heap.
//   - Generation-counter token in epoll_data.u64 defeats the stale-event
//     race that occurs when a slot is reused within one epoll_wait batch.
//   - EPOLLOUT is registered only when a socket has queued pending bytes;
//     this gives proper backpressure without busy-polling writability.
//   - Timeout sweep on every epoll tick closes slow/idle peers
//     (distinct deadlines for handshake vs steady-state).
//
// HTTP surface (Cloud Run friendly):
//   GET /, /healthz        -> 200 plain text
//   GET /ws + Upgrade: ws  -> RFC 6455 handshake, then echo text/binary/ping
//   anything else          -> 404
//
// Frame policy: single-frame messages up to MAX_FRAME_PAYLOAD (16 KiB). Frag-
// mented or oversized frames are rejected and the connection is closed.

const std = @import("std");
const builtin = @import("builtin");
const posix = std.posix;
const linux = std.os.linux;
const Sha1 = std.crypto.hash.Sha1;
const firestore = @import("firestore.zig");
const grpc = @import("grpc.zig");
const rooms = @import("rooms.zig");
const pending_mod = @import("pending.zig");
const commit_encode = @import("commit_encode.zig");

comptime {
    // Ensure sub-module tests are discovered by `zig build test`.
    std.testing.refAllDecls(pending_mod);
    std.testing.refAllDecls(commit_encode);
    std.testing.refAllDecls(firestore);
}

// ----- Firestore flush triggers ------------------------------------------
// Size: cap a single CommitRequest at ~500 fields (Firestore max writes =
// 500 ops/commit; we stay under to leave room for per-field update_mask).
const FLUSH_SIZE_FIELDS: usize = 500;

// Defaults and minimums for the env-driven runtime tunables. Operations
// override the defaults via env vars; the minimums protect against
// misconfiguration (e.g. KEEPALIVE_SECONDS=0 would kill the instance every tick).

// Idle deadline before the reactor self-kills and Cloud Run scales to zero.
const DEFAULT_KEEPALIVE_NS: i128 = 30 * 60 * std.time.ns_per_s;
const MIN_KEEPALIVE_NS: i128 = 60 * std.time.ns_per_s;

// Quiescence: idle since last edit; catches the end of a drag gesture so the
// final position lands in Firestore within a few seconds.
const DEFAULT_FLUSH_QUIESCENCE_NS: i128 = 5000 * std.time.ns_per_ms;
const MIN_FLUSH_QUIESCENCE_NS: i128 = 100 * std.time.ns_per_ms;

// Max-interval: absolute ceiling regardless of edit activity. Bounds per-
// room Firestore cost during continuous editing.
const DEFAULT_FLUSH_MAX_INTERVAL_NS: i128 = 10 * 60 * std.time.ns_per_s;
const MIN_FLUSH_MAX_INTERVAL_NS: i128 = std.time.ns_per_s;

// Cloud Run SIGTERM grace is 10s. Bound the drain shorter to leave room for
// listening socket shutdown + gRPC channel close.
const SHUTDOWN_DRAIN_BUDGET_NS: i128 = 8 * std.time.ns_per_s;

/// Set by the SIGTERM handler; the reactor drains pending writes and exits.
var g_shutdown_requested = std.atomic.Value(bool).init(false);

/// Most recent collab-activity timestamp. A frame on any /collab/ WebSocket
/// resets this. The reactor self-kills when (now - g_last_activity_ns) exceeds
/// the configured keepalive window. Atomic to future-proof a worker-thread
/// commit path; today the reactor is single-threaded and this could be a plain
/// i128.
var g_last_activity_ns: std.atomic.Value(i128) = std.atomic.Value(i128).init(0);

const KillReason = enum { unknown, sigterm, idle_keepalive };
/// Why the reactor is exiting. Read once during drain to populate the
/// `event=self_kill_initiated reason=...` log line (Task 5 wires the log).
var g_kill_reason: KillReason = .unknown;

comptime {
    if (builtin.os.tag != .linux) @compileError("mocktail requires Linux (epoll)");
}

const WS_GUID: []const u8 = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MAX_CONNECTIONS: u32 = 2048;
const BACKLOG: u31 = 512;
const READ_BUF_SIZE: usize = 32 * 1024;
const WRITE_BUF_SIZE: usize = 32 * 1024;
const HTTP_HEADER_LIMIT: usize = 8 * 1024;
const MAX_FRAME_PAYLOAD: usize = 16 * 1024;
const IDLE_TIMEOUT_NS: i128 = 60 * std.time.ns_per_s;
const HANDSHAKE_TIMEOUT_NS: i128 = 10 * std.time.ns_per_s;
const EPOLL_WAIT_MS: i32 = 1000;
const MAX_EPOLL_EVENTS: usize = 256;
const LISTEN_TOKEN: u64 = std.math.maxInt(u64);

// MSG_NOSIGNAL on Linux; keep a literal so we don't depend on posix.MSG shape.
const MSG_NOSIGNAL: u32 = 0x4000;

const Phase = enum(u8) { free, http, ws, ws_collab, closing };

const Opcode = enum(u4) {
    continuation = 0x0,
    text = 0x1,
    binary = 0x2,
    close = 0x8,
    ping = 0x9,
    pong = 0xA,
    _,
};

const Conn = struct {
    fd: posix.fd_t = -1,
    phase: Phase = .free,
    generation: u32 = 0,
    registered_events: u32 = 0,
    close_after_flush: bool = false,

    read_len: usize = 0,
    write_start: usize = 0,
    write_end: usize = 0,

    opened_ns: i128 = 0,
    last_activity_ns: i128 = 0,

    read_buf: [READ_BUF_SIZE]u8 = undefined,
    write_buf: [WRITE_BUF_SIZE]u8 = undefined,

    fn writePending(self: *const Conn) usize {
        return self.write_end - self.write_start;
    }
};

inline fn packToken(slot: u32, generation: u32) u64 {
    return (@as(u64, generation) << 32) | @as(u64, slot);
}
inline fn tokenSlot(token: u64) u32 {
    return @truncate(token);
}
inline fn tokenGen(token: u64) u32 {
    return @truncate(token >> 32);
}

fn nowNs() i128 {
    return std.time.nanoTimestamp();
}

fn setsockoptInt(fd: posix.fd_t, level: anytype, opt: anytype, value: c_int) !void {
    try posix.setsockopt(fd, @intCast(level), @intCast(opt), std.mem.asBytes(&value));
}

pub const Server = struct {
    allocator: std.mem.Allocator,
    listen_fd: posix.fd_t,
    epoll_fd: posix.fd_t,
    conns: []Conn,
    free_slots: []u32,
    free_count: u32,
    manager: rooms.Manager,
    /// Optional: null in health-check-only deploys or local test runs.
    fs_client: ?*firestore.Client,
    /// Reused across every flush — single-threaded reactor, so serial reuse
    /// is safe. Null when fs_client is null.
    cq: ?*grpc.c.grpc_completion_queue,
    /// Wall-clock at server boot; feeds the /healthz `instance_age_seconds`
    /// metric and the `event=instance_started` log line.
    boot_ns: i128,
    /// Idle deadline (last frame on a /collab/ WS to now). When exceeded, the
    /// reactor sets g_shutdown_requested and falls into drainAndExit.
    keepalive_ns: i128,
    /// Per-room flush triggers. Env-driven so operations can tune cost vs
    /// data-loss exposure without rebuilding.
    flush_max_interval_ns: i128,
    flush_quiescence_ns: i128,
    /// Last successful Firestore commit; -1 if never flushed. Used by /healthz.
    last_flush_ns: i128,

    pub fn init(
        allocator: std.mem.Allocator,
        port: u16,
        fs_client: ?*firestore.Client,
        keepalive_ns: i128,
        flush_max_interval_ns: i128,
        flush_quiescence_ns: i128,
    ) !Server {
        const conns = try allocator.alloc(Conn, MAX_CONNECTIONS);
        errdefer allocator.free(conns);
        for (conns) |*c| c.* = .{};

        const free_slots = try allocator.alloc(u32, MAX_CONNECTIONS);
        errdefer allocator.free(free_slots);
        for (0..MAX_CONNECTIONS) |i| {
            free_slots[i] = @intCast(MAX_CONNECTIONS - 1 - i); // pop yields 0,1,2,...
        }

        const listen_fd = try posix.socket(
            posix.AF.INET,
            posix.SOCK.STREAM | posix.SOCK.NONBLOCK | posix.SOCK.CLOEXEC,
            0,
        );
        errdefer posix.close(listen_fd);

        try setsockoptInt(listen_fd, posix.SOL.SOCKET, posix.SO.REUSEADDR, 1);
        // Allow sharding across processes later; best-effort.
        setsockoptInt(listen_fd, posix.SOL.SOCKET, posix.SO.REUSEPORT, 1) catch {};

        const addr = std.net.Address.initIp4(.{ 0, 0, 0, 0 }, port);
        try posix.bind(listen_fd, &addr.any, addr.getOsSockLen());
        try posix.listen(listen_fd, BACKLOG);

        const epoll_fd = try posix.epoll_create1(linux.EPOLL.CLOEXEC);
        errdefer posix.close(epoll_fd);

        var listen_ev: linux.epoll_event = .{
            .events = linux.EPOLL.IN,
            .data = .{ .u64 = LISTEN_TOKEN },
        };
        try posix.epoll_ctl(epoll_fd, linux.EPOLL.CTL_ADD, listen_fd, &listen_ev);

        const cq: ?*grpc.c.grpc_completion_queue = if (fs_client != null)
            grpc.c.grpc_completion_queue_create_for_next(null)
        else
            null;
        errdefer if (cq) |q| {
            grpc.c.grpc_completion_queue_shutdown(q);
            grpc.c.grpc_completion_queue_destroy(q);
        };

        return .{
            .allocator = allocator,
            .listen_fd = listen_fd,
            .epoll_fd = epoll_fd,
            .conns = conns,
            .free_slots = free_slots,
            .free_count = MAX_CONNECTIONS,
            .manager = rooms.Manager.init(allocator),
            .fs_client = fs_client,
            .cq = cq,
            .boot_ns = nowNs(),
            .keepalive_ns = keepalive_ns,
            .flush_max_interval_ns = flush_max_interval_ns,
            .flush_quiescence_ns = flush_quiescence_ns,
            .last_flush_ns = -1,
        };
    }

    pub fn deinit(self: *Server) void {
        for (self.conns) |*c| if (c.fd >= 0) posix.close(c.fd);
        posix.close(self.listen_fd);
        posix.close(self.epoll_fd);
        self.allocator.free(self.free_slots);
        self.allocator.free(self.conns);
        self.manager.deinit();
        if (self.cq) |q| {
            grpc.c.grpc_completion_queue_shutdown(q);
            // Drain any pending events before destroying.
            while (true) {
                const ev = grpc.c.grpc_completion_queue_next(q, grpc.c.gpr_inf_past(grpc.c.GPR_CLOCK_REALTIME), null);
                if (ev.type == grpc.c.GRPC_QUEUE_SHUTDOWN) break;
            }
            grpc.c.grpc_completion_queue_destroy(q);
        }
    }

    pub fn run(self: *Server) !void {
        var events: [MAX_EPOLL_EVENTS]linux.epoll_event = undefined;
        while (true) {
            // Idle deadline: if no /collab/ frame in the configured window,
            // self-kill. Reuses the SIGTERM drain path — same code, different
            // trigger. The reason flag distinguishes the two in logs.
            if (nowNs() - g_last_activity_ns.load(.acquire) > self.keepalive_ns) {
                if (g_kill_reason == .unknown) {
                    g_kill_reason = .idle_keepalive;
                    const idle_s = @divTrunc(
                        nowNs() - g_last_activity_ns.load(.acquire),
                        std.time.ns_per_s,
                    );
                    var pending_fields: usize = 0;
                    var i: usize = 0;
                    while (i < self.manager.room_count) : (i += 1) {
                        if (self.manager.rooms[i].pending) |p| {
                            pending_fields += p.pendingFieldCount();
                        }
                    }
                    std.debug.print(
                        "event=self_kill_initiated reason=idle_keepalive idle_s={d} rooms={d} pending_fields={d}\n",
                        .{ idle_s, self.manager.room_count, pending_fields },
                    );
                }
                g_shutdown_requested.store(true, .release);
            }
            // Cloud Run sends SIGTERM ~10s before it kills the container. The
            // handler flips the flag; we drain and exit cleanly here.
            // drainAndExit terminates the process via exit_group; control
            // does not return.
            if (g_shutdown_requested.load(.acquire)) {
                self.drainAndExit();
            }
            const n = posix.epoll_wait(self.epoll_fd, &events, EPOLL_WAIT_MS);
            for (events[0..n]) |ev| {
                const token = ev.data.u64;
                if (token == LISTEN_TOKEN) {
                    self.acceptLoop();
                    continue;
                }
                const slot = tokenSlot(token);
                const gen = tokenGen(token);
                if (slot >= MAX_CONNECTIONS) continue;
                const conn = &self.conns[slot];
                if (conn.phase == .free or conn.generation != gen) continue;

                const readable = ev.events & (linux.EPOLL.IN | linux.EPOLL.HUP | linux.EPOLL.RDHUP | linux.EPOLL.ERR);
                const writable = ev.events & linux.EPOLL.OUT;

                if (readable != 0) {
                    self.onReadable(slot);
                    if (self.conns[slot].phase == .free) continue;
                }
                if (writable != 0) {
                    self.flush(slot);
                }
            }
            self.sweepTimeouts();
            self.maybeFlushRooms();
        }
    }

    /// Walk every room with pending edits; commit those whose triggers have
    /// fired (size, quiescence, or max-interval). Single-threaded: each commit
    /// blocks the WS loop for its RPC round-trip. Acceptable at Phase 1 scale
    /// (≤400 concurrent editors → ≤2 flushes/s typical); moving to a worker
    /// thread is a Phase 2 follow-up when latency becomes the bottleneck.
    fn maybeFlushRooms(self: *Server) void {
        if (self.fs_client == null) return;
        const now = nowNs();
        var i: usize = 0;
        while (i < self.manager.room_count) : (i += 1) {
            const room = &self.manager.rooms[i];
            if (room.tenant_id_len == 0) continue;
            const p_ptr = &(room.pending orelse continue);
            if (p_ptr.isEmpty()) continue;

            const since_flush = now - room.last_flush_ns;
            const since_edit = now - p_ptr.last_edit_ns;
            // Deletions count against the size budget so a flurry of
            // delete frames can't exceed the per-CommitRequest write cap.
            const op_count = p_ptr.pendingFieldCount() + p_ptr.deletionCount();
            const should = op_count >= FLUSH_SIZE_FIELDS or
                since_edit >= self.flush_quiescence_ns or
                since_flush >= self.flush_max_interval_ns;
            if (!should) continue;
            self.flushRoom(room);
        }
    }

    fn flushRoom(self: *Server, room: *rooms.Room) void {
        const client = self.fs_client orelse return;
        const cq = self.cq orelse return;
        const p_ptr = &(room.pending orelse return);

        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const arena_alloc = arena.allocator();

        var builder = commit_encode.Builder.init(
            arena_alloc,
            client.config.database,
            room.tenantId(),
            room.key(),
        );
        defer builder.deinit();

        const bytes = builder.encode(p_ptr) catch |err| {
            std.debug.print(
                "flushRoom encode failed room={s} err={s}\n",
                .{ room.key(), @errorName(err) },
            );
            return;
        };

        const fields_before = p_ptr.pendingFieldCount();
        const deletes_before = p_ptr.deletionCount();
        const commit_started_ns = nowNs();
        _ = client.commit(cq, bytes, arena_alloc) catch |err| {
            // Keep the pending snapshot so the next trigger retries; log and
            // return so a transient Firestore blip doesn't lose edits.
            std.debug.print(
                "flushRoom commit failed room={s} fields={d} err={s}\n",
                .{ room.key(), fields_before, @errorName(err) },
            );
            return;
        };

        p_ptr.clear();
        const flush_done_ns = nowNs();
        room.last_flush_ns = flush_done_ns;
        self.last_flush_ns = flush_done_ns;
        std.debug.print(
            "event=flush_committed room={s}/{s} fields={d} deletes={d} elapsed_ms={d}\n",
            .{
                room.tenantId(),
                room.key(),
                fields_before,
                deletes_before,
                @divTrunc(flush_done_ns - commit_started_ns, std.time.ns_per_ms),
            },
        );
    }

    /// Best-effort drain: flush every pending room regardless of triggers so
    /// in-flight edits don't die on SIGTERM. Bounded by SHUTDOWN_DRAIN_BUDGET_NS
    /// so Cloud Run's 10s grace isn't exceeded. Terminates the process directly
    /// via exit_group; never returns. Bypasses libc's atexit chain because
    /// libgrpc registers handlers that wait on internal threads, and at least
    /// one of those threads (TLS subchannel poller) does not unblock during
    /// shutdown — we observed Cloud Run instances hanging after emitting
    /// `event=self_kill_initiated` until SIGKILL fired at the 10s grace.
    fn drainAndExit(self: *Server) noreturn {
        if (self.fs_client == null) {
            // Health-check-only deploys (no Firestore client) still need to
            // emit drain_completed so the verification recipe in README's
            // "Verifying the keepalive cycle" section sees the expected
            // log pair on every kill cycle.
            std.debug.print(
                "event=drain_completed rooms_drained=0 rooms_skipped=0 elapsed_ms=0 budget_exceeded=false\n",
                .{},
            );
            linux.exit_group(0);
        }
        if (g_kill_reason == .sigterm) {
            var pending_fields: usize = 0;
            var k: usize = 0;
            while (k < self.manager.room_count) : (k += 1) {
                if (self.manager.rooms[k].pending) |p| {
                    pending_fields += p.pendingFieldCount();
                }
            }
            std.debug.print(
                "event=self_kill_initiated reason=sigterm rooms={d} pending_fields={d}\n",
                .{ self.manager.room_count, pending_fields },
            );
        }
        const started = nowNs();
        var rooms_drained: usize = 0;
        var rooms_skipped: usize = 0;
        var budget_exceeded = false;
        var i: usize = 0;
        while (i < self.manager.room_count) : (i += 1) {
            if (nowNs() - started > SHUTDOWN_DRAIN_BUDGET_NS) {
                budget_exceeded = true;
                rooms_skipped = self.manager.room_count - i;
                break;
            }
            const room = &self.manager.rooms[i];
            if (room.tenant_id_len == 0) continue;
            const p_ptr = &(room.pending orelse continue);
            if (p_ptr.isEmpty()) continue;
            self.flushRoom(room);
            rooms_drained += 1;
        }
        std.debug.print(
            "event=drain_completed rooms_drained={d} rooms_skipped={d} elapsed_ms={d} budget_exceeded={s}\n",
            .{
                rooms_drained,
                rooms_skipped,
                @divTrunc(nowNs() - started, std.time.ns_per_ms),
                if (budget_exceeded) "true" else "false",
            },
        );
        linux.exit_group(0);
    }

    // ----- slot bookkeeping ------------------------------------------------

    fn acquireSlot(self: *Server) ?u32 {
        if (self.free_count == 0) return null;
        self.free_count -= 1;
        return self.free_slots[self.free_count];
    }

    fn releaseSlot(self: *Server, slot: u32) void {
        self.free_slots[self.free_count] = slot;
        self.free_count += 1;
    }

    // ----- accept ----------------------------------------------------------

    fn acceptLoop(self: *Server) void {
        while (true) {
            var addr_buf: posix.sockaddr = undefined;
            var addr_len: posix.socklen_t = @sizeOf(posix.sockaddr);
            const client_fd = posix.accept(
                self.listen_fd,
                &addr_buf,
                &addr_len,
                posix.SOCK.NONBLOCK | posix.SOCK.CLOEXEC,
            ) catch |err| switch (err) {
                error.WouldBlock => return,
                error.ConnectionAborted, error.ProtocolFailure, error.BlockedByFirewall => continue,
                else => return,
            };

            const slot = self.acquireSlot() orelse {
                // Over capacity: drop immediately. Returning 503 would cost a
                // round-trip we don't have slots for — TCP reset is honest.
                posix.close(client_fd);
                continue;
            };

            // Lower per-message latency for ws frames; best-effort.
            setsockoptInt(client_fd, posix.IPPROTO.TCP, linux.TCP.NODELAY, 1) catch {};

            const conn = &self.conns[slot];
            conn.fd = client_fd;
            conn.phase = .http;
            conn.generation +%= 1;
            conn.close_after_flush = false;
            conn.read_len = 0;
            conn.write_start = 0;
            conn.write_end = 0;
            conn.opened_ns = nowNs();
            conn.last_activity_ns = conn.opened_ns;
            conn.registered_events = linux.EPOLL.IN | linux.EPOLL.RDHUP;

            var ev: linux.epoll_event = .{
                .events = conn.registered_events,
                .data = .{ .u64 = packToken(slot, conn.generation) },
            };
            posix.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_ADD, client_fd, &ev) catch {
                self.hardClose(slot);
            };
        }
    }

    // ----- close -----------------------------------------------------------

    fn hardClose(self: *Server, slot: u32) void {
        const conn = &self.conns[slot];
        if (conn.phase == .free) return;
        // If this slot was in a collab room, broadcast a leave event to peers
        // before ripping the connection down so their presence lists update.
        if (conn.phase == .ws_collab or conn.phase == .closing) {
            if (self.manager.roomForSlot(slot)) |room| {
                if (room.findSlot(slot)) |m| {
                    var buf: [256]u8 = undefined;
                    const uid = m.userId();
                    const msg = std.fmt.bufPrint(&buf, "{{\"type\":\"leave\",\"userId\":\"{s}\"}}", .{
                        uid,
                    }) catch null;
                    _ = self.manager.leave(slot);
                    if (msg) |text| self.broadcastToRoom(slot, room, text);
                } else {
                    _ = self.manager.leave(slot);
                }
            }
        }
        if (conn.fd >= 0) {
            // EPOLL_CTL_DEL first so kernel stops queueing events for this fd.
            _ = posix.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_DEL, conn.fd, null) catch {};
            posix.close(conn.fd);
            conn.fd = -1;
        }
        conn.phase = .free;
        conn.close_after_flush = false;
        conn.read_len = 0;
        conn.write_start = 0;
        conn.write_end = 0;
        conn.registered_events = 0;
        self.releaseSlot(slot);
    }

    // ----- collab --------------------------------------------------------

    fn handleCollabText(self: *Server, slot: u32, payload: []const u8) void {
        // Detect "hello" messages and update the sender's presence fields.
        // This is a forgiving parser — the canonical format is:
        //   {"type":"hello","userId":"u1","name":"Alice","color":"#aaa"}
        // Anything else is treated as an opaque broadcast payload (cursor,
        // selection, edit). We fan the raw bytes out to all other peers so
        // the frontend owns the schema.
        if (isHeartbeatMessage(payload)) {
            // Activity is updated unconditionally in processFrames for
            // .ws_collab connections (Task 4); nothing to do here. Heartbeats
            // are strictly client→server; we do not broadcast them to peers.
            return;
        }
        if (isHelloMessage(payload)) {
            const room = self.manager.roomForSlot(slot) orelse return;
            const member = room.findSlot(slot) orelse return;
            const uid = extractJsonString(payload, "userId") orelse "anon";
            const nm = extractJsonString(payload, "name") orelse "Guest";
            const col = extractJsonString(payload, "color") orelse "#0a0a0a";
            member.setFields(uid, nm, col);
            // Send a "roster" reply so the new client sees who's present.
            self.sendRoster(slot, room);
            // Broadcast a join announcement to existing peers.
            self.broadcastToRoom(slot, room, payload);
            return;
        }
        const room = self.manager.roomForSlot(slot) orelse return;
        // Edit/delete/deleteFields frames are mirrored to peers AND folded
        // into the per-room pending buffer for the Firestore flush. The
        // broadcast keeps the existing low-latency peer sync; the Firestore
        // path converts the high-rate WS firehose into bounded, coalesced
        // writes. Rooms with an empty tenant (pre-migration clients) skip
        // the merge — they stay broadcast-only, matching pre-Phase-1 behavior.
        if (self.fs_client != null and room.tenant_id_len > 0) {
            if (isEditMessage(payload)) {
                self.ingestEdit(room, payload);
            } else if (isDeleteMessage(payload)) {
                self.ingestDelete(room, payload);
            } else if (isDeleteFieldsMessage(payload)) {
                self.ingestDeleteFields(room, payload);
            }
        }
        self.broadcastToRoom(slot, room, payload);
    }

    /// Parse the edit frame for elementId + patch, then merge into the room's
    /// pending field set. Silently drops malformed frames — invalid client
    /// traffic should not crash the reactor.
    fn ingestEdit(self: *Server, room: *rooms.Room, payload: []const u8) void {
        const element_id = extractJsonString(payload, "elementId") orelse return;
        const patch_obj = extractJsonObject(payload, "patch") orelse return;
        if (element_id.len == 0) return;

        const p = room.ensurePending(self.allocator);
        p.mergeEdit(element_id, patch_obj) catch |err| {
            // Log-and-drop; InvalidPatch is the usual cause and we don't
            // want one bad frame to stop further merges.
            std.debug.print("ingestEdit merge failed: {s}\n", .{@errorName(err)});
            return;
        };
        p.last_edit_ns = nowNs();
    }

    fn ingestDelete(self: *Server, room: *rooms.Room, payload: []const u8) void {
        const element_id = extractJsonString(payload, "elementId") orelse return;
        if (element_id.len == 0) return;

        const p = room.ensurePending(self.allocator);
        p.markDeleted(element_id) catch |err| {
            std.debug.print("ingestDelete failed: {s}\n", .{@errorName(err)});
            return;
        };
        p.last_edit_ns = nowNs();
    }

    fn ingestDeleteFields(self: *Server, room: *rooms.Room, payload: []const u8) void {
        const element_id = extractJsonString(payload, "elementId") orelse return;
        if (element_id.len == 0) return;

        // 16 fields/frame is far above any realistic client request — the
        // largest in-app trigger removes ~3 (color/border/text) at once.
        var field_buf: [16][]const u8 = undefined;
        const n = extractJsonStringArray(payload, "fields", &field_buf);
        if (n == 0) return;

        const p = room.ensurePending(self.allocator);
        p.markDeletedFields(element_id, field_buf[0..n]) catch |err| {
            std.debug.print("ingestDeleteFields failed: {s}\n", .{@errorName(err)});
            return;
        };
        p.last_edit_ns = nowNs();
    }

    fn broadcastToRoom(self: *Server, sender_slot: u32, room: *rooms.Room, payload: []const u8) void {
        var i: usize = 0;
        while (i < room.member_count) : (i += 1) {
            const peer = room.members[i].slot;
            if (peer == sender_slot) continue;
            if (peer >= self.conns.len) continue;
            const c = &self.conns[peer];
            if (c.phase != .ws_collab) continue;
            _ = self.writeFrame(peer, .text, payload, false);
        }
    }

    fn sendRoster(self: *Server, slot: u32, room: *rooms.Room) void {
        // Build a JSON roster of peers (excluding the caller) and send it.
        var buf: [2048]u8 = undefined;
        var fbs = std.io.fixedBufferStream(&buf);
        var w = fbs.writer();
        w.writeAll("{\"type\":\"roster\",\"members\":[") catch return;
        var first = true;
        var i: usize = 0;
        while (i < room.member_count) : (i += 1) {
            const m = room.members[i];
            if (m.slot == slot) continue;
            if (!first) w.writeByte(',') catch return;
            first = false;
            w.print(
                "{{\"userId\":\"{s}\",\"name\":\"{s}\",\"color\":\"{s}\"}}",
                .{ m.userId(), m.name(), m.color() },
            ) catch return;
        }
        w.writeAll("]}") catch return;
        _ = self.writeFrame(slot, .text, fbs.getWritten(), false);
    }

    fn requestClose(self: *Server, slot: u32) void {
        const conn = &self.conns[slot];
        if (conn.phase == .free) return;
        if (conn.writePending() == 0) {
            self.hardClose(slot);
        } else {
            conn.close_after_flush = true;
            conn.phase = .closing;
            // Stop accepting more from the client while we drain our close
            // frame; keep OUT so flush drives the shutdown.
            self.dropEvents(slot, linux.EPOLL.IN);
            self.ensureEvents(slot, linux.EPOLL.OUT);
        }
    }

    fn ensureEvents(self: *Server, slot: u32, extra: u32) void {
        const conn = &self.conns[slot];
        const desired = conn.registered_events | extra;
        if (desired == conn.registered_events) return;
        conn.registered_events = desired;
        var ev: linux.epoll_event = .{
            .events = desired,
            .data = .{ .u64 = packToken(slot, conn.generation) },
        };
        _ = posix.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_MOD, conn.fd, &ev) catch {};
    }

    fn dropEvents(self: *Server, slot: u32, remove: u32) void {
        const conn = &self.conns[slot];
        const desired = conn.registered_events & ~remove;
        if (desired == conn.registered_events) return;
        conn.registered_events = desired;
        var ev: linux.epoll_event = .{
            .events = desired,
            .data = .{ .u64 = packToken(slot, conn.generation) },
        };
        _ = posix.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_MOD, conn.fd, &ev) catch {};
    }

    // ----- read path -------------------------------------------------------

    fn onReadable(self: *Server, slot: u32) void {
        while (true) {
            const conn = &self.conns[slot];
            const space = conn.read_buf.len - conn.read_len;
            if (space == 0) {
                // No room to make progress; parser should have consumed by now.
                self.hardClose(slot);
                return;
            }
            const got = posix.read(conn.fd, conn.read_buf[conn.read_len .. conn.read_len + space]) catch |err| switch (err) {
                error.WouldBlock => return,
                error.ConnectionResetByPeer, error.ConnectionTimedOut => {
                    self.hardClose(slot);
                    return;
                },
                else => {
                    self.hardClose(slot);
                    return;
                },
            };
            if (got == 0) {
                self.hardClose(slot);
                return;
            }
            conn.read_len += got;
            conn.last_activity_ns = nowNs();

            // Drain as many complete units as we can before reading again.
            while (true) {
                const before = self.conns[slot].read_len;
                const progressed = switch (self.conns[slot].phase) {
                    .http => self.processHttp(slot),
                    .ws, .ws_collab => self.processFrames(slot),
                    .closing, .free => false,
                };
                if (!progressed) break;
                if (self.conns[slot].phase == .free) return;
                if (self.conns[slot].read_len == before) break; // defensive
            }
            if (self.conns[slot].phase == .free) return;
        }
    }

    // ----- HTTP handshake --------------------------------------------------

    fn processHttp(self: *Server, slot: u32) bool {
        const conn = &self.conns[slot];
        const buf = conn.read_buf[0..conn.read_len];
        const marker = std.mem.indexOf(u8, buf, "\r\n\r\n") orelse {
            if (conn.read_len >= HTTP_HEADER_LIMIT) {
                self.writeHttpStatus(slot, 431, "Request Header Fields Too Large");
                self.requestClose(slot);
            }
            return false;
        };
        const header_end = marker + 4;
        const headers = buf[0..header_end];

        const line_end = std.mem.indexOf(u8, headers, "\r\n") orelse {
            self.writeHttpStatus(slot, 400, "Bad Request");
            self.requestClose(slot);
            return false;
        };
        const request_line = headers[0..line_end];

        var tokens = std.mem.tokenizeScalar(u8, request_line, ' ');
        const method = tokens.next() orelse "";
        const path = tokens.next() orelse "";

        if (!std.mem.eql(u8, method, "GET")) {
            self.writeHttpStatus(slot, 405, "Method Not Allowed");
            self.requestClose(slot);
            return false;
        }

        // Firebase Hosting's Cloud Run rewrite preserves the full path, so the
        // backend sees /api/... when traffic flows through Hosting. Accept both
        // bare paths (for direct access / local dev) and /api-prefixed paths.
        if (std.mem.eql(u8, path, "/") or
            std.mem.eql(u8, path, "/healthz") or
            std.mem.eql(u8, path, "/api/healthz"))
        {
            const accept = findHeader(headers, "Accept") orelse "";
            // Cloud Run startup probes don't send Accept; they keep getting
            // ok\n. Operators querying with `curl -H 'Accept: application/json'`
            // get the metrics JSON.
            if (std.mem.indexOf(u8, accept, "application/json") != null) {
                self.writeHealthzJson(slot);
            } else {
                self.writeHttpText(slot, 200, "OK", "ok\n");
            }
            self.requestClose(slot);
            return false;
        }

        // Determine the target path kind: plain echo (/ws, /api/ws) or a
        // collab room (/collab/:projectId, /api/collab/:projectId). Anything
        // else is 404. The projectId is extracted for book-keeping below.
        const is_plain_ws = std.mem.eql(u8, path, "/ws") or std.mem.eql(u8, path, "/api/ws");
        const collab_prefix_api = "/api/collab/";
        const collab_prefix = "/collab/";
        var collab_project: []const u8 = "";
        var is_collab = false;
        if (std.mem.startsWith(u8, path, collab_prefix_api)) {
            collab_project = path[collab_prefix_api.len..];
            is_collab = collab_project.len > 0;
        } else if (std.mem.startsWith(u8, path, collab_prefix)) {
            collab_project = path[collab_prefix.len..];
            is_collab = collab_project.len > 0;
        }
        if (!is_plain_ws and !is_collab) {
            self.writeHttpText(slot, 404, "Not Found", "not found\n");
            self.requestClose(slot);
            return false;
        }

        const upgrade = findHeader(headers, "Upgrade") orelse "";
        const connection_hdr = findHeader(headers, "Connection") orelse "";
        const version = findHeader(headers, "Sec-WebSocket-Version") orelse "";
        const key = findHeader(headers, "Sec-WebSocket-Key") orelse "";

        if (!std.ascii.eqlIgnoreCase(upgrade, "websocket") or
            !containsTokenCaseInsensitive(connection_hdr, "upgrade") or
            !std.mem.eql(u8, version, "13") or
            key.len == 0)
        {
            self.writeHttpText(slot, 400, "Bad Request", "invalid websocket upgrade\n");
            self.requestClose(slot);
            return false;
        }

        var accept_buf: [32]u8 = undefined;
        const accept = computeAccept(key, &accept_buf);

        // Handshake response; fits in a few hundred bytes.
        var resp_buf: [256]u8 = undefined;
        const resp = std.fmt.bufPrint(
            &resp_buf,
            "HTTP/1.1 101 Switching Protocols\r\n" ++
                "Upgrade: websocket\r\n" ++
                "Connection: Upgrade\r\n" ++
                "Sec-WebSocket-Accept: {s}\r\n\r\n",
            .{accept},
        ) catch {
            self.hardClose(slot);
            return false;
        };
        if (!self.queueBytes(slot, resp)) return false;

        // Consume the parsed HTTP request from the read buffer; anything after
        // (unlikely — clients wait for 101) is the start of WS frames.
        self.shiftRead(slot, header_end);
        if (is_collab) {
            // Auto-join the project room with placeholder identity; the first
            // client text frame ({"type":"hello", ...}) fills name/color/user.
            // URL shape is either /api/collab/{tid}/{pid} (Phase 1 — enables
            // the Firestore write path) or /api/collab/{pid} (legacy —
            // broadcast-only, no Firestore). The tenant stays empty when the
            // client hasn't migrated; in that case flushes are skipped.
            var tenant_part: []const u8 = "";
            var project_part: []const u8 = collab_project;
            if (std.mem.indexOfScalar(u8, collab_project, '/')) |sep| {
                tenant_part = collab_project[0..sep];
                project_part = collab_project[sep + 1 ..];
            }
            const tenant_trim = tenant_part[0..@min(tenant_part.len, rooms.MAX_TENANT_ID)];
            const project_trim = project_part[0..@min(project_part.len, rooms.MAX_ROOM_KEY)];
            _ = self.manager.join(slot, tenant_trim, project_trim, "anon", "Guest", "#0a0a0a");
            self.conns[slot].phase = .ws_collab;
        } else {
            self.conns[slot].phase = .ws;
        }
        return true;
    }

    fn writeHttpStatus(self: *Server, slot: u32, status: u16, reason: []const u8) void {
        self.writeHttpText(slot, status, reason, "");
    }

    fn writeHttpText(self: *Server, slot: u32, status: u16, reason: []const u8, body: []const u8) void {
        var hdr: [256]u8 = undefined;
        const out = std.fmt.bufPrint(
            &hdr,
            "HTTP/1.1 {d} {s}\r\nContent-Type: text/plain\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n",
            .{ status, reason, body.len },
        ) catch return;
        _ = self.queueBytes(slot, out);
        if (body.len > 0) _ = self.queueBytes(slot, body);
    }

    fn writeHealthzJson(self: *Server, slot: u32) void {
        const now = nowNs();
        var pending_fields: usize = 0;
        var k: usize = 0;
        while (k < self.manager.room_count) : (k += 1) {
            if (self.manager.rooms[k].pending) |p| {
                pending_fields += p.pendingFieldCount();
            }
        }
        const idle_s = @divTrunc(
            now - g_last_activity_ns.load(.acquire),
            std.time.ns_per_s,
        );
        const age_s = @divTrunc(now - self.boot_ns, std.time.ns_per_s);
        const last_flush_ago_s: i128 = if (self.last_flush_ns < 0)
            -1
        else
            @divTrunc(now - self.last_flush_ns, std.time.ns_per_s);
        const kills: u8 = if (g_shutdown_requested.load(.acquire)) 1 else 0;

        var body_buf: [512]u8 = undefined;
        const body = std.fmt.bufPrint(
            &body_buf,
            "{{\"ok\":true,\"instance_age_seconds\":{d},\"idle_seconds\":{d}," ++
                "\"rooms_active\":{d},\"pending_field_count\":{d}," ++
                "\"last_flush_seconds_ago\":{d},\"kills_initiated\":{d}}}\n",
            .{
                age_s,
                idle_s,
                self.manager.room_count,
                pending_fields,
                last_flush_ago_s,
                kills,
            },
        ) catch return;

        var hdr: [256]u8 = undefined;
        const out = std.fmt.bufPrint(
            &hdr,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n",
            .{body.len},
        ) catch return;
        _ = self.queueBytes(slot, out);
        _ = self.queueBytes(slot, body);
    }

    // ----- WebSocket frame codec ------------------------------------------

    fn processFrames(self: *Server, slot: u32) bool {
        const conn = &self.conns[slot];
        const buf = conn.read_buf[0..conn.read_len];
        if (buf.len < 2) return false;

        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) != 0;
        const rsv = b0 & 0x70;
        const opcode: Opcode = @enumFromInt(@as(u4, @truncate(b0 & 0x0F)));
        const masked = (b1 & 0x80) != 0;
        var payload_len: u64 = b1 & 0x7F;
        var offset: usize = 2;

        if (!masked) {
            // RFC 6455: client frames MUST be masked.
            self.sendCloseAndShutdown(slot, 1002);
            return false;
        }
        if (rsv != 0) {
            self.sendCloseAndShutdown(slot, 1002);
            return false;
        }

        if (payload_len == 126) {
            if (buf.len < offset + 2) return false;
            payload_len = std.mem.readInt(u16, buf[offset..][0..2], .big);
            offset += 2;
        } else if (payload_len == 127) {
            if (buf.len < offset + 8) return false;
            payload_len = std.mem.readInt(u64, buf[offset..][0..8], .big);
            offset += 8;
        }

        if (payload_len > MAX_FRAME_PAYLOAD) {
            self.sendCloseAndShutdown(slot, 1009); // message too big
            return false;
        }

        if (buf.len < offset + 4) return false;
        const mask_bytes = buf[offset..][0..4].*;
        offset += 4;

        const total: usize = offset + @as(usize, @intCast(payload_len));
        if (buf.len < total) return false;

        // Unmask in place within the read buffer slice.
        const payload = conn.read_buf[offset..total];
        for (payload, 0..) |*b, i| b.* ^= mask_bytes[i % 4];

        // Single activity-tracking site: a fully-parsed frame on a collab WS
        // counts as "user is here". Every frame type (text, ping, close, …)
        // passes through here, so we don't need per-handler updates.
        if (self.conns[slot].phase == .ws_collab) {
            g_last_activity_ns.store(nowNs(), .release);
        }

        const is_control = (@intFromEnum(opcode) & 0x8) != 0;
        if (is_control and (!fin or payload.len > 125)) {
            self.sendCloseAndShutdown(slot, 1002);
            return false;
        }

        switch (opcode) {
            .text, .binary => {
                if (!fin) {
                    // Fragmentation not supported; close cleanly.
                    self.sendCloseAndShutdown(slot, 1003);
                    return false;
                }
                if (self.conns[slot].phase == .ws_collab) {
                    if (opcode == .text) self.handleCollabText(slot, payload);
                    // No echo-back to sender; drop binary in collab.
                } else {
                    if (!self.writeFrame(slot, opcode, payload, false)) return false;
                }
            },
            .ping => {
                if (!self.writeFrame(slot, .pong, payload, false)) return false;
            },
            .pong => {}, // ignore
            .close => {
                // Echo close, then drain and close.
                _ = self.writeFrame(slot, .close, payload, true);
                self.shiftRead(slot, total);
                self.requestClose(slot);
                return false;
            },
            else => {
                self.sendCloseAndShutdown(slot, 1003);
                return false;
            },
        }

        self.shiftRead(slot, total);
        return true;
    }

    fn writeFrame(self: *Server, slot: u32, opcode: Opcode, payload: []const u8, closing_after: bool) bool {
        var hdr: [10]u8 = undefined;
        hdr[0] = 0x80 | @as(u8, @intFromEnum(opcode));
        var hdr_len: usize = 2;
        if (payload.len < 126) {
            hdr[1] = @intCast(payload.len);
        } else if (payload.len <= 0xFFFF) {
            hdr[1] = 126;
            std.mem.writeInt(u16, hdr[2..4], @intCast(payload.len), .big);
            hdr_len = 4;
        } else {
            hdr[1] = 127;
            std.mem.writeInt(u64, hdr[2..10], payload.len, .big);
            hdr_len = 10;
        }
        if (!self.queueBytes(slot, hdr[0..hdr_len])) return false;
        if (payload.len > 0 and !self.queueBytes(slot, payload)) return false;
        if (closing_after) self.conns[slot].close_after_flush = true;
        return true;
    }

    fn sendCloseAndShutdown(self: *Server, slot: u32, code: u16) void {
        var body: [2]u8 = undefined;
        std.mem.writeInt(u16, &body, code, .big);
        _ = self.writeFrame(slot, .close, &body, true);
        self.requestClose(slot);
    }

    fn shiftRead(self: *Server, slot: u32, consumed: usize) void {
        const conn = &self.conns[slot];
        if (consumed >= conn.read_len) {
            conn.read_len = 0;
            return;
        }
        const remaining = conn.read_len - consumed;
        std.mem.copyForwards(u8, conn.read_buf[0..remaining], conn.read_buf[consumed..conn.read_len]);
        conn.read_len = remaining;
    }

    // ----- write path ------------------------------------------------------

    fn queueBytes(self: *Server, slot: u32, bytes: []const u8) bool {
        const conn = &self.conns[slot];
        if (bytes.len == 0) return true;

        // Try to flush immediately if nothing is pending — common fast path.
        if (conn.write_end == conn.write_start) {
            const sent = posix.send(conn.fd, bytes, MSG_NOSIGNAL) catch |err| switch (err) {
                error.WouldBlock => 0,
                else => {
                    self.hardClose(slot);
                    return false;
                },
            };
            if (sent == bytes.len) return true;
            const remainder = bytes[sent..];
            if (remainder.len > conn.write_buf.len) {
                self.hardClose(slot);
                return false;
            }
            @memcpy(conn.write_buf[0..remainder.len], remainder);
            conn.write_start = 0;
            conn.write_end = remainder.len;
            self.ensureEvents(slot, linux.EPOLL.OUT);
            return true;
        }

        // Compact if the tail no longer fits but head space would.
        if (conn.write_end + bytes.len > conn.write_buf.len) {
            const pending = conn.writePending();
            if (conn.write_start > 0) {
                std.mem.copyForwards(u8, conn.write_buf[0..pending], conn.write_buf[conn.write_start..conn.write_end]);
                conn.write_start = 0;
                conn.write_end = pending;
            }
        }
        if (conn.write_end + bytes.len > conn.write_buf.len) {
            // Peer is too slow: drop connection rather than grow unbounded.
            self.hardClose(slot);
            return false;
        }
        @memcpy(conn.write_buf[conn.write_end .. conn.write_end + bytes.len], bytes);
        conn.write_end += bytes.len;
        self.ensureEvents(slot, linux.EPOLL.OUT);
        return true;
    }

    fn flush(self: *Server, slot: u32) void {
        const conn = &self.conns[slot];
        while (conn.writePending() > 0) {
            const pending = conn.write_buf[conn.write_start..conn.write_end];
            const sent = posix.send(conn.fd, pending, MSG_NOSIGNAL) catch |err| switch (err) {
                error.WouldBlock => return,
                else => {
                    self.hardClose(slot);
                    return;
                },
            };
            if (sent == 0) {
                self.hardClose(slot);
                return;
            }
            conn.write_start += sent;
            conn.last_activity_ns = nowNs();
        }
        // Drained.
        conn.write_start = 0;
        conn.write_end = 0;
        self.dropEvents(slot, linux.EPOLL.OUT);
        if (conn.close_after_flush) self.hardClose(slot);
    }

    // ----- timeouts --------------------------------------------------------

    fn sweepTimeouts(self: *Server) void {
        const now = nowNs();
        for (self.conns, 0..) |*conn, i| {
            if (conn.phase == .free) continue;
            const deadline = switch (conn.phase) {
                .http => conn.opened_ns + HANDSHAKE_TIMEOUT_NS,
                // Collab sessions may sit idle between cursor updates for a
                // while; we keep the same idle deadline — the client pings.
                .ws, .ws_collab, .closing => conn.last_activity_ns + IDLE_TIMEOUT_NS,
                .free => continue,
            };
            if (now > deadline) self.hardClose(@intCast(i));
        }
    }
};

// ----- helpers ------------------------------------------------------------

fn findHeader(headers: []const u8, name: []const u8) ?[]const u8 {
    var it = std.mem.splitSequence(u8, headers, "\r\n");
    _ = it.next(); // request line
    while (it.next()) |line| {
        if (line.len == 0) continue;
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const h_name = std.mem.trim(u8, line[0..colon], " \t");
        if (std.ascii.eqlIgnoreCase(h_name, name)) {
            return std.mem.trim(u8, line[colon + 1 ..], " \t");
        }
    }
    return null;
}

fn containsTokenCaseInsensitive(value: []const u8, needle: []const u8) bool {
    var it = std.mem.tokenizeAny(u8, value, ", \t");
    while (it.next()) |tok| {
        if (std.ascii.eqlIgnoreCase(tok, needle)) return true;
    }
    return false;
}

fn isHelloMessage(payload: []const u8) bool {
    // Fast heuristic: look for a "type":"hello" substring after trimming.
    return std.mem.indexOf(u8, payload, "\"type\":\"hello\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"hello\"") != null;
}

fn isEditMessage(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"type\":\"edit\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"edit\"") != null;
}

fn isDeleteMessage(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"type\":\"delete\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"delete\"") != null;
}

fn isDeleteFieldsMessage(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"type\":\"deleteFields\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"deleteFields\"") != null;
}

fn isHeartbeatMessage(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"type\":\"heartbeat\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"heartbeat\"") != null;
}

/// Extract a JSON object value (including braces) for the named key. Walks
/// balanced braces with basic string-literal awareness. Returns null for
/// missing keys or malformed input — good enough for our trusted client
/// without pulling in a full JSON parser on the hot path.
fn extractJsonObject(payload: []const u8, key: []const u8) ?[]const u8 {
    var needle_buf: [64]u8 = undefined;
    if (key.len + 2 > needle_buf.len) return null;
    needle_buf[0] = '"';
    @memcpy(needle_buf[1..][0..key.len], key);
    needle_buf[1 + key.len] = '"';
    const needle = needle_buf[0 .. key.len + 2];
    const start = std.mem.indexOf(u8, payload, needle) orelse return null;
    var i: usize = start + needle.len;
    while (i < payload.len and (payload[i] == ' ' or payload[i] == ':')) i += 1;
    if (i >= payload.len or payload[i] != '{') return null;
    const obj_start = i;
    var depth: i32 = 0;
    var in_str = false;
    while (i < payload.len) : (i += 1) {
        const ch = payload[i];
        if (in_str) {
            if (ch == '\\' and i + 1 < payload.len) {
                i += 1;
                continue;
            }
            if (ch == '"') in_str = false;
            continue;
        }
        if (ch == '"') {
            in_str = true;
            continue;
        }
        if (ch == '{') {
            depth += 1;
        } else if (ch == '}') {
            depth -= 1;
            if (depth == 0) return payload[obj_start .. i + 1];
        }
    }
    return null;
}

/// Extract up to `out.len` strings from a top-level JSON array `key:[...]`.
/// Returns the number of strings actually written. Each result slice points
/// into `payload` (so callers must finish using them before payload is freed).
/// Tolerant of whitespace and tightly scoped — same hot-path tradeoff as
/// extractJsonObject above.
fn extractJsonStringArray(payload: []const u8, key: []const u8, out: [][]const u8) usize {
    var needle_buf: [64]u8 = undefined;
    if (key.len + 2 > needle_buf.len) return 0;
    needle_buf[0] = '"';
    @memcpy(needle_buf[1..][0..key.len], key);
    needle_buf[1 + key.len] = '"';
    const needle = needle_buf[0 .. key.len + 2];
    const start = std.mem.indexOf(u8, payload, needle) orelse return 0;
    var i: usize = start + needle.len;
    while (i < payload.len and (payload[i] == ' ' or payload[i] == ':')) i += 1;
    if (i >= payload.len or payload[i] != '[') return 0;
    i += 1;

    var count: usize = 0;
    while (i < payload.len and count < out.len) {
        while (i < payload.len and (payload[i] == ' ' or payload[i] == ',')) i += 1;
        if (i >= payload.len or payload[i] == ']') break;
        if (payload[i] != '"') return count;
        i += 1;
        const value_start = i;
        while (i < payload.len and payload[i] != '"') : (i += 1) {
            if (payload[i] == '\\' and i + 1 < payload.len) i += 1;
        }
        if (i > payload.len) return count;
        out[count] = payload[value_start..i];
        count += 1;
        if (i < payload.len) i += 1; // step past closing quote
    }
    return count;
}

fn extractJsonString(payload: []const u8, key: []const u8) ?[]const u8 {
    // Tiny unquoted-key scan: `"key":"value"` with optional whitespace. Not a
    // real JSON parser — MVP client-owned format — but tolerant of reorders.
    var needle_buf: [64]u8 = undefined;
    if (key.len + 2 > needle_buf.len) return null;
    needle_buf[0] = '"';
    @memcpy(needle_buf[1..][0..key.len], key);
    needle_buf[1 + key.len] = '"';
    const needle = needle_buf[0 .. key.len + 2];
    const start = std.mem.indexOf(u8, payload, needle) orelse return null;
    var i: usize = start + needle.len;
    while (i < payload.len and (payload[i] == ' ' or payload[i] == ':')) i += 1;
    if (i >= payload.len or payload[i] != '"') return null;
    i += 1;
    const value_start = i;
    while (i < payload.len and payload[i] != '"') : (i += 1) {
        if (payload[i] == '\\' and i + 1 < payload.len) i += 1;
    }
    if (i > payload.len) return null;
    return payload[value_start..i];
}

fn computeAccept(key: []const u8, out_buf: *[32]u8) []const u8 {
    var sha = Sha1.init(.{});
    sha.update(key);
    sha.update(WS_GUID);
    var digest: [Sha1.digest_length]u8 = undefined;
    sha.final(&digest);

    const Encoder = std.base64.standard.Encoder;
    const len = Encoder.calcSize(Sha1.digest_length);
    std.debug.assert(len <= out_buf.len);
    return Encoder.encode(out_buf[0..len], &digest);
}

fn readPort(allocator: std.mem.Allocator) u16 {
    const env = std.process.getEnvVarOwned(allocator, "PORT") catch return 8082;
    defer allocator.free(env);
    return std.fmt.parseInt(u16, env, 10) catch 8082;
}

/// Read an env var as an integer in `multiplier_ns` units (so the same parser
/// handles SECONDS and MILLIS env vars), and return:
///   - default_ns when the var is missing or unparseable
///   - min_ns when the parsed value is below min_ns (clamped, with a warn log)
///   - the parsed value (× multiplier_ns) otherwise
/// Logs a warn line on fallback or clamping so misconfiguration is visible
/// in Cloud Logging. The default is returned as-is — callers must pass a
/// default ≥ min_ns.
fn readEnvNs(
    allocator: std.mem.Allocator,
    name: []const u8,
    default_ns: i128,
    min_ns: i128,
    multiplier_ns: i128,
) i128 {
    const raw = std.process.getEnvVarOwned(allocator, name) catch return default_ns;
    defer allocator.free(raw);
    const parsed = std.fmt.parseInt(i64, raw, 10) catch {
        std.debug.print(
            "warn: env {s}={s} unparseable, using default {d}ns\n",
            .{ name, raw, default_ns },
        );
        return default_ns;
    };
    const ns = @as(i128, parsed) * multiplier_ns;
    if (ns < min_ns) {
        std.debug.print(
            "warn: env {s}={d} (input units) below minimum {d}ns, clamping\n",
            .{ name, parsed, min_ns },
        );
        return min_ns;
    }
    return ns;
}

// ----- main ---------------------------------------------------------------

fn onTerminationSignal(_: c_int) callconv(.c) void {
    // Don't overwrite a reason already set by the keepalive check; the first
    // signaller wins. Signal-context safe — atomic store, no allocation.
    if (g_kill_reason == .unknown) g_kill_reason = .sigterm;
    g_shutdown_requested.store(true, .release);
}

fn installSignalHandlers() !void {
    var sa: posix.Sigaction = .{
        .handler = .{ .handler = onTerminationSignal },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.TERM, &sa, null);
    posix.sigaction(posix.SIG.INT, &sa, null);
    // SIGPIPE from writes to a half-closed peer would otherwise kill us; the
    // write path already handles the resulting EPIPE errno.
    var ign: posix.Sigaction = .{
        .handler = .{ .handler = posix.SIG.IGN },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.PIPE, &ign, null);
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    try installSignalHandlers();
    // Treat boot as activity so an instance with no users still self-kills
    // after KEEPALIVE_SECONDS — confirms scale-to-zero on cold deploys with
    // zero traffic. A "first connection resets" variant would defeat that.
    g_last_activity_ns.store(nowNs(), .release);

    const port = readPort(allocator);

    // Firestore client: talks to the emulator when FIRESTORE_EMULATOR_HOST is
    // set, or to firestore.googleapis.com with ADC/Workload Identity when
    // FIRESTORE_USE_TLS=true. Best-effort at startup — the server still runs
    // if the channel can't be built (useful for health-check-only deploys).
    var fs_client_storage: ?firestore.Client = null;
    var fs_client_ptr: ?*firestore.Client = null;
    if (firestore.Client.init(allocator)) |client| {
        fs_client_storage = client;
        fs_client_ptr = &fs_client_storage.?;
        const mode: []const u8 = if (client.config.use_tls) "prod (Workload Identity)" else "insecure/emulator";
        std.debug.print(
            "firestore: project={s} host={s} mode={s}\n",
            .{ client.config.project, client.config.host, mode },
        );
    } else |err| {
        std.debug.print("firestore: init skipped ({s})\n", .{@errorName(err)});
    }
    defer if (fs_client_storage) |*client| client.deinit();

    const keepalive_ns = readEnvNs(
        allocator,
        "KEEPALIVE_SECONDS",
        DEFAULT_KEEPALIVE_NS,
        MIN_KEEPALIVE_NS,
        std.time.ns_per_s,
    );
    const flush_max_interval_ns = readEnvNs(
        allocator,
        "FLUSH_MAX_INTERVAL_SECONDS",
        DEFAULT_FLUSH_MAX_INTERVAL_NS,
        MIN_FLUSH_MAX_INTERVAL_NS,
        std.time.ns_per_s,
    );
    const flush_quiescence_ns = readEnvNs(
        allocator,
        "FLUSH_QUIESCENCE_MILLIS",
        DEFAULT_FLUSH_QUIESCENCE_NS,
        MIN_FLUSH_QUIESCENCE_NS,
        std.time.ns_per_ms,
    );

    var server = try Server.init(
        allocator,
        port,
        fs_client_ptr,
        keepalive_ns,
        flush_max_interval_ns,
        flush_quiescence_ns,
    );
    defer server.deinit();

    std.debug.print(
        "mocktail epoll reactor on 0.0.0.0:{d} (max_conns={d}, frame={d}B)\n",
        .{ port, MAX_CONNECTIONS, MAX_FRAME_PAYLOAD },
    );
    std.debug.print(
        "event=instance_started keepalive_s={d} flush_max_s={d} flush_quiescence_ms={d}\n",
        .{
            @divTrunc(keepalive_ns, std.time.ns_per_s),
            @divTrunc(flush_max_interval_ns, std.time.ns_per_s),
            @divTrunc(flush_quiescence_ns, std.time.ns_per_ms),
        },
    );
    try server.run();
}

// ----- tests --------------------------------------------------------------

test "findHeader is case-insensitive and trims whitespace" {
    const headers = "GET /ws HTTP/1.1\r\nHost: x\r\nSec-WebSocket-Key:   abcDEF  \r\n\r\n";
    const v = findHeader(headers, "sec-websocket-key") orelse return error.Missing;
    try std.testing.expectEqualStrings("abcDEF", v);
}

test "containsTokenCaseInsensitive handles comma-separated Connection header" {
    try std.testing.expect(containsTokenCaseInsensitive("keep-alive, Upgrade", "upgrade"));
    try std.testing.expect(containsTokenCaseInsensitive("Upgrade", "upgrade"));
    try std.testing.expect(!containsTokenCaseInsensitive("close", "upgrade"));
}

test "computeAccept matches RFC 6455 example" {
    var out: [32]u8 = undefined;
    const accept = computeAccept("dGhlIHNhbXBsZSBub25jZQ==", &out);
    try std.testing.expectEqualStrings("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", accept);
}

test "token pack/unpack round-trips" {
    const t = packToken(42, 0xABCDEF01);
    try std.testing.expectEqual(@as(u32, 42), tokenSlot(t));
    try std.testing.expectEqual(@as(u32, 0xABCDEF01), tokenGen(t));
}

test "isHelloMessage matches both spacings" {
    try std.testing.expect(isHelloMessage("{\"type\":\"hello\",\"name\":\"x\"}"));
    try std.testing.expect(isHelloMessage("{\"type\": \"hello\" }"));
    try std.testing.expect(!isHelloMessage("{\"type\":\"cursor\"}"));
}

test "extractJsonString returns the matched value" {
    const s = "{\"type\":\"hello\",\"userId\":\"u-42\",\"name\":\"Alice\"}";
    try std.testing.expectEqualStrings("u-42", extractJsonString(s, "userId").?);
    try std.testing.expectEqualStrings("Alice", extractJsonString(s, "name").?);
    try std.testing.expect(extractJsonString(s, "missing") == null);
}

test "isDeleteMessage detects delete frames" {
    try std.testing.expect(isDeleteMessage("{\"type\":\"delete\",\"elementId\":\"e1\"}"));
    try std.testing.expect(isDeleteMessage("{\"type\": \"delete\" , \"elementId\":\"e1\"}"));
    try std.testing.expect(!isDeleteMessage("{\"type\":\"deleteFields\"}"));
    try std.testing.expect(!isDeleteMessage("{\"type\":\"edit\"}"));
}

test "isHeartbeatMessage detects heartbeat frames" {
    try std.testing.expect(isHeartbeatMessage("{\"type\":\"heartbeat\"}"));
    try std.testing.expect(isHeartbeatMessage("{\"type\": \"heartbeat\" }"));
    try std.testing.expect(!isHeartbeatMessage("{\"type\":\"hello\"}"));
    try std.testing.expect(!isHeartbeatMessage("{\"type\":\"edit\"}"));
}

test "isDeleteFieldsMessage detects deleteFields frames" {
    try std.testing.expect(isDeleteFieldsMessage(
        "{\"type\":\"deleteFields\",\"elementId\":\"e1\",\"fields\":[\"color\"]}",
    ));
    try std.testing.expect(!isDeleteFieldsMessage("{\"type\":\"delete\"}"));
}

test "extractJsonStringArray returns array elements" {
    var buf: [4][]const u8 = undefined;
    const n = extractJsonStringArray(
        "{\"fields\":[\"color\",\"borderColor\"],\"x\":1}",
        "fields",
        &buf,
    );
    try std.testing.expectEqual(@as(usize, 2), n);
    try std.testing.expectEqualStrings("color", buf[0]);
    try std.testing.expectEqualStrings("borderColor", buf[1]);
}

test "extractJsonStringArray returns 0 for missing or non-array" {
    var buf: [4][]const u8 = undefined;
    try std.testing.expectEqual(@as(usize, 0), extractJsonStringArray(
        "{\"fields\":\"color\"}",
        "fields",
        &buf,
    ));
    try std.testing.expectEqual(@as(usize, 0), extractJsonStringArray(
        "{\"x\":1}",
        "fields",
        &buf,
    ));
    try std.testing.expectEqual(@as(usize, 0), extractJsonStringArray(
        "{\"fields\":[]}",
        "fields",
        &buf,
    ));
}

test "isEditMessage detects edit frames" {
    try std.testing.expect(isEditMessage("{\"type\":\"edit\",\"elementId\":\"e1\"}"));
    try std.testing.expect(isEditMessage("{\"type\": \"edit\" , \"x\":1}"));
    try std.testing.expect(!isEditMessage("{\"type\":\"cursor\"}"));
}

test "extractJsonObject returns balanced braces respecting strings" {
    const s = "{\"elementId\":\"el-1\",\"patch\":{\"x\":10,\"note\":\"}\"},\"color\":\"red\"}";
    const got = extractJsonObject(s, "patch").?;
    try std.testing.expectEqualStrings("{\"x\":10,\"note\":\"}\"}", got);
}

test "extractJsonObject handles nested objects" {
    const s = "{\"patch\":{\"style\":{\"fill\":\"#abc\"}}}";
    const got = extractJsonObject(s, "patch").?;
    try std.testing.expectEqualStrings("{\"style\":{\"fill\":\"#abc\"}}", got);
}

test "extractJsonObject returns null for missing or scalar" {
    const s = "{\"patch\":42}";
    try std.testing.expect(extractJsonObject(s, "patch") == null);
    try std.testing.expect(extractJsonObject(s, "nope") == null);
}

test "readEnvNs returns default when env var is unset" {
    // Helper takes (allocator, name, default_ns, min_ns, multiplier_ns).
    // multiplier_ns lets us reuse the same parser for SECONDS and MILLIS vars.
    const got = readEnvNs(std.testing.allocator, "MOCKTAIL_TEST_NEVER_SET_XYZ", 1234, 100, std.time.ns_per_s);
    try std.testing.expectEqual(@as(i128, 1234), got);
}

test "readEnvNs clamps a too-low parsed value to the minimum" {
    const c = struct {
        extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
        extern "c" fn unsetenv(name: [*:0]const u8) c_int;
    };
    _ = c.setenv("MOCKTAIL_TEST_CLAMP_VAL", "30", 1);
    defer _ = c.unsetenv("MOCKTAIL_TEST_CLAMP_VAL");

    // Env var parses to 30s; min is 60s; expect clamp to 60s.
    try std.testing.expectEqual(@as(i128, 60 * std.time.ns_per_s), readEnvNs(
        std.testing.allocator,
        "MOCKTAIL_TEST_CLAMP_VAL",
        300 * std.time.ns_per_s,
        60 * std.time.ns_per_s,
        std.time.ns_per_s,
    ));
}

test "readEnvNs returns parsed env value when above minimum" {
    const c = struct {
        extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
        extern "c" fn unsetenv(name: [*:0]const u8) c_int;
    };
    _ = c.setenv("MOCKTAIL_TEST_OK_VAL", "120", 1);
    defer _ = c.unsetenv("MOCKTAIL_TEST_OK_VAL");

    try std.testing.expectEqual(@as(i128, 120 * std.time.ns_per_s), readEnvNs(
        std.testing.allocator,
        "MOCKTAIL_TEST_OK_VAL",
        300 * std.time.ns_per_s,
        60 * std.time.ns_per_s,
        std.time.ns_per_s,
    ));
}

test {
    _ = @import("rooms.zig");
}
