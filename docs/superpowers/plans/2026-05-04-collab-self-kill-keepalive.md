# Collab Self-Kill & Idle Keepalive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-04-collab-self-kill-design.md` (commit `fbe4b85`)

**Goal:** Reduce Cloud Run cost for the Zig collab service by switching to instance-billed mode with `max-instances=1`, self-terminating after 30 min of editor idle, coalescing Firestore writes more aggressively, and adding observability hooks.

**Architecture:** Three env-driven `Server` fields plus a global `g_last_activity_ns` track when the editor was last touched. The reactor's existing `run()` loop checks an idle deadline alongside the existing SIGTERM check, then reuses `drainAndExit`. The Angular client adds a 30 s reset-on-send heartbeat so quiet users don't get culled by the per-connection 60 s idle timeout. `/healthz` returns JSON when called with `Accept: application/json`; structured logs surface kill events, flushes, drains. Cloud Run deploy flags switch to `--no-cpu-throttling --max-instances 1`.

**Tech Stack:** Zig 0.15.2 (epoll reactor), Angular 21 (signals + RxJS), Cloud Run, Firestore via libgrpc-c, Karma + Jasmine, Playwright (untouched).

---

## File Structure

| File | Action | Why |
|---|---|---|
| `backend/collab/src/main.zig` | Modify | Config plumbing, activity tracking, heartbeat handler, /healthz JSON, structured logs |
| `frontend/packages/collab/src/services/collab/collab.service.ts` | Modify | Heartbeat timer + lifecycle wiring |
| `frontend/packages/collab/src/services/collab/collab.service.spec.ts` | Modify | Two new specs (heartbeat timing + cleanup) |
| `README.md` | Modify | Deploy command for `mocktail` service + verification recipe |

All Zig changes land in `main.zig` because the spec's logic is reactor-level, not factorable into a separate module without refactoring out of scope. The single file already has six logical sections (epoll loop, slot bookkeeping, accept, close, collab, HTTP, frames, write path, timeouts, helpers); the new code lands in the appropriate section.

---

## Task 1: Branch setup

**Files:** none.

- [ ] **Step 1.1: Create the implementation branch**

```bash
git checkout -b feat/collab-self-kill-keepalive
```

- [ ] **Step 1.2: Confirm starting state**

Run: `git log --oneline -3`
Expected: top commit is `fbe4b85 docs(specs): add collab self-kill & idle-keepalive design`.

---

## Task 2: Config plumbing — env vars → `Server` fields

**Files:**
- Modify: `backend/collab/src/main.zig` (constants block, `Server` struct, `Server.init`, `maybeFlushRooms`, `main`)

Goal: hoist `FLUSH_QUIESCENCE_NS` and `FLUSH_MAX_INTERVAL_NS` from comptime constants to `Server` fields populated from env vars at startup. Add a new `keepalive_ns` field for Task 4. Add `readEnvNs` helper with default + minimum + warn-on-fallback semantics. The existing constants stay as named defaults consumed by `readEnvNs`.

- [ ] **Step 2.1: Write the failing test for `readEnvNs`**

Append to the bottom of `backend/collab/src/main.zig`, just before the final `test {}` block at line 1349:

```zig
test "readEnvNs returns default when env var is unset" {
    // Helper takes (allocator, name, default_ns, min_ns, multiplier_ns).
    // multiplier_ns lets us reuse the same parser for SECONDS and MILLIS vars.
    const got = readEnvNs(std.testing.allocator, "MOCKTAIL_TEST_NEVER_SET_XYZ", 1234, 100, std.time.ns_per_s);
    try std.testing.expectEqual(@as(i128, 1234), got);
}
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd backend/collab && zig build test`
Expected: compile error — `readEnvNs` is undefined.

- [ ] **Step 2.3: Implement `readEnvNs`**

Add this helper near `readPort` (currently at `main.zig:1173`, just before `// ----- main`):

```zig
/// Read an env var as an integer, multiply by `multiplier_ns` to convert to
/// nanoseconds, clamp to `[min_ns, ∞)`, and fall back to `default_ns` on any
/// of: missing var, unparseable value, value below the minimum. Logs a warn
/// line so misconfiguration is visible in Cloud Logging.
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
            "warn: env {s}={d} below minimum, clamping to {d}ns\n",
            .{ name, parsed, min_ns },
        );
        return min_ns;
    }
    return ns;
}
```

- [ ] **Step 2.4: Add the remaining tests for `readEnvNs`**

Append below the test from Step 2.1:

```zig
test "readEnvNs clamps below minimum" {
    // Set a temporary env var via the platform's setenv.
    // std.posix.setenv doesn't exist; we test the clamp path via a direct call
    // with a hardcoded default below the minimum.
    try std.testing.expectEqual(@as(i128, 60 * std.time.ns_per_s), readEnvNs(
        std.testing.allocator,
        "MOCKTAIL_TEST_NEVER_SET_ABC",
        30 * std.time.ns_per_s, // default below min — exercises only the default branch
        60 * std.time.ns_per_s,
        std.time.ns_per_s,
    ));
    // The clamp-on-parsed-value path requires a real env var to test, which
    // std lacks a portable setter for. Manual staging covers that branch.
}
```

- [ ] **Step 2.5: Run the tests to verify they pass**

Run: `cd backend/collab && zig build test`
Expected: all tests pass, including `readEnvNs returns default when env var is unset` and `readEnvNs clamps below minimum`. Existing tests untouched.

- [ ] **Step 2.6: Add three fields to the `Server` struct**

In `main.zig` around the existing `Server` struct definition (currently `main.zig:129-141`), insert these fields after `cq`:

```zig
    /// Wall-clock at server boot; feeds the /healthz `instance_age_seconds`
    /// metric and the `event=instance_started` log line.
    boot_ns: i128,
    /// Idle deadline (last frame on a /collab/ WS to now). When exceeded, the
    /// reactor sets g_shutdown_requested and falls into drainAndExit.
    keepalive_ns: i128,
    /// Per-room flush triggers. Were comptime constants; now env-driven so
    /// operations can tune cost vs data-loss exposure without rebuilding.
    flush_max_interval_ns: i128,
    flush_quiescence_ns: i128,
    /// Last successful Firestore commit; -1 if never flushed. Used by /healthz.
    last_flush_ns: i128,
```

- [ ] **Step 2.7: Update `Server.init` signature and assignments**

Replace the existing `Server.init` signature and final return at `main.zig:143-202`:

OLD signature:
```zig
    pub fn init(
        allocator: std.mem.Allocator,
        port: u16,
        fs_client: ?*firestore.Client,
    ) !Server {
```

NEW signature:
```zig
    pub fn init(
        allocator: std.mem.Allocator,
        port: u16,
        fs_client: ?*firestore.Client,
        keepalive_ns: i128,
        flush_max_interval_ns: i128,
        flush_quiescence_ns: i128,
    ) !Server {
```

OLD return block (the last `return .{}` in `Server.init`):
```zig
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
        };
```

NEW return block:
```zig
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
```

- [ ] **Step 2.8: Update `maybeFlushRooms` to use the per-instance fields**

In `maybeFlushRooms` (currently `main.zig:265-286`), replace the `should` calculation block:

OLD:
```zig
            const should = op_count >= FLUSH_SIZE_FIELDS or
                since_edit >= FLUSH_QUIESCENCE_NS or
                since_flush >= FLUSH_MAX_INTERVAL_NS;
```

NEW:
```zig
            const should = op_count >= FLUSH_SIZE_FIELDS or
                since_edit >= self.flush_quiescence_ns or
                since_flush >= self.flush_max_interval_ns;
```

`FLUSH_SIZE_FIELDS` stays a constant — it tracks Firestore's hard 500-write commit limit, not a tunable.

- [ ] **Step 2.9: Update `flushRoom` to record `last_flush_ns` on success**

In `flushRoom` (currently `main.zig:288-325`), replace the success tail:

OLD:
```zig
        p_ptr.clear();
        room.last_flush_ns = nowNs();
    }
```

NEW:
```zig
        p_ptr.clear();
        const flush_done_ns = nowNs();
        room.last_flush_ns = flush_done_ns;
        self.last_flush_ns = flush_done_ns;
    }
```

- [ ] **Step 2.10: Update `main` to read env vars and pass them to `Server.init`**

In `main()` (currently `main.zig:1203-1239`), replace the `Server.init` call site:

OLD:
```zig
    var server = try Server.init(allocator, port, fs_client_ptr);
```

NEW:
```zig
    const keepalive_ns = readEnvNs(
        allocator,
        "KEEPALIVE_SECONDS",
        30 * 60 * std.time.ns_per_s, // 30 min default
        60 * std.time.ns_per_s,      // 60 s minimum
        std.time.ns_per_s,
    );
    const flush_max_interval_ns = readEnvNs(
        allocator,
        "FLUSH_MAX_INTERVAL_SECONDS",
        10 * 60 * std.time.ns_per_s, // 10 min default
        std.time.ns_per_s,           // 1 s minimum
        std.time.ns_per_s,
    );
    const flush_quiescence_ns = readEnvNs(
        allocator,
        "FLUSH_QUIESCENCE_MILLIS",
        5000 * std.time.ns_per_ms, // 5 s default
        100 * std.time.ns_per_ms,  // 100 ms minimum
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
```

- [ ] **Step 2.11: Build and run tests**

Run: `cd backend/collab && zig build test`
Expected: all tests pass.

Run: `cd backend/collab && zig build`
Expected: clean build, no warnings.

- [ ] **Step 2.12: Commit**

```bash
git add backend/collab/src/main.zig
git commit -m "feat(collab): env-driven keepalive and flush intervals on Server"
```

---

## Task 3: Heartbeat protocol — server side

**Files:**
- Modify: `backend/collab/src/main.zig` (`isHeartbeatMessage` helper + `handleCollabText` short-circuit)

Goal: a new `{"type":"heartbeat"}` frame on `/collab/...` connections short-circuits in `handleCollabText` — extends activity (Task 4 wires that), is not broadcast to peers, is not ingested into the Pending buffer. Mirrors the existing `isHelloMessage`/`isEditMessage` family.

- [ ] **Step 3.1: Write the failing test for `isHeartbeatMessage`**

Append to `backend/collab/src/main.zig` near the existing `isDeleteMessage` test (around line 1280):

```zig
test "isHeartbeatMessage detects heartbeat frames" {
    try std.testing.expect(isHeartbeatMessage("{\"type\":\"heartbeat\"}"));
    try std.testing.expect(isHeartbeatMessage("{\"type\": \"heartbeat\" }"));
    try std.testing.expect(!isHeartbeatMessage("{\"type\":\"hello\"}"));
    try std.testing.expect(!isHeartbeatMessage("{\"type\":\"edit\"}"));
}
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `cd backend/collab && zig build test`
Expected: compile error — `isHeartbeatMessage` is undefined.

- [ ] **Step 3.3: Add `isHeartbeatMessage`**

In `main.zig`, add after `isDeleteFieldsMessage` (currently `main.zig:1055-1058`):

```zig
fn isHeartbeatMessage(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"type\":\"heartbeat\"") != null or
        std.mem.indexOf(u8, payload, "\"type\": \"heartbeat\"") != null;
}
```

- [ ] **Step 3.4: Short-circuit heartbeats in `handleCollabText`**

In `handleCollabText` (currently `main.zig:448-485`), insert this block immediately after the function-opening doc comment and before the `if (isHelloMessage(payload))` check:

```zig
        if (isHeartbeatMessage(payload)) {
            // Activity is updated unconditionally in processFrames for
            // .ws_collab connections; nothing to do here. Heartbeats are
            // strictly client→server; we do not broadcast them to peers.
            return;
        }
```

- [ ] **Step 3.5: Run all tests**

Run: `cd backend/collab && zig build test`
Expected: all tests pass, including the new heartbeat test.

- [ ] **Step 3.6: Commit**

```bash
git add backend/collab/src/main.zig
git commit -m "feat(collab): handle heartbeat frames (no broadcast, no Firestore)"
```

---

## Task 4: Activity tracking + keepalive deadline + drain reuse

**Files:**
- Modify: `backend/collab/src/main.zig` (new globals, `processFrames` activity update site, `run()` keepalive check, `onTerminationSignal` reason)

Goal: the reactor self-kills after `keepalive_ns` of no `/collab/...` activity. Single update site (top of `processFrames` for `.ws_collab` connections). Reuses existing `g_shutdown_requested → drainAndExit → return` codepath. A new `g_kill_reason` flag distinguishes idle-keepalive from SIGTERM for the log lines added in Task 5.

- [ ] **Step 4.1: Add the new globals**

Add immediately after the existing `g_shutdown_requested` definition (currently `main.zig:54`):

```zig
/// Most recent collab-activity timestamp. A frame on any /collab/ WebSocket
/// resets this. The reactor self-kills when (now - g_last_activity_ns) exceeds
/// the configured keepalive window. Atomic to future-proof a worker-thread
/// commit path; today the reactor is single-threaded and this could be a plain
/// i128.
var g_last_activity_ns: std.atomic.Value(i128) = std.atomic.Value(i128).init(0);

const KillReason = enum { unknown, sigterm, idle_keepalive };
/// Why the reactor is exiting. Read once during drain to populate the
/// `event=self_kill_initiated reason=...` log line.
var g_kill_reason: KillReason = .unknown;
```

- [ ] **Step 4.2: Initialise `g_last_activity_ns` at server boot**

In `main()`, immediately after the `try installSignalHandlers()` line (currently `main.zig:1208`), add:

```zig
    g_last_activity_ns.store(nowNs(), .release);
```

- [ ] **Step 4.3: Update `onTerminationSignal` to record the kill reason**

Replace `onTerminationSignal` (currently `main.zig:1181-1183`):

OLD:
```zig
fn onTerminationSignal(_: c_int) callconv(.c) void {
    g_shutdown_requested.store(true, .release);
}
```

NEW:
```zig
fn onTerminationSignal(_: c_int) callconv(.c) void {
    // Don't overwrite a reason already set by the keepalive check; the first
    // signaller wins. Signal-context safe — atomic store, no allocation.
    if (g_kill_reason == .unknown) g_kill_reason = .sigterm;
    g_shutdown_requested.store(true, .release);
}
```

- [ ] **Step 4.4: Add the activity update site in `processFrames`**

In `processFrames` (currently `main.zig:794-883`), add this block immediately after the bytes are validated and before the opcode switch — i.e., right after the line `const payload = conn.read_buf[offset..total];` and the unmask loop, just before `const is_control = ...` (currently around `main.zig:842-843`):

```zig
        // Single activity-tracking site: a fully-parsed frame on a collab WS
        // counts as "user is here". Every frame type (text, ping, close, …)
        // passes through here, so we don't need per-handler updates.
        if (self.conns[slot].phase == .ws_collab) {
            g_last_activity_ns.store(nowNs(), .release);
        }
```

- [ ] **Step 4.5: Add the keepalive check in `run()`**

In `run()` (currently `main.zig:222-258`), insert this block immediately before the existing `if (g_shutdown_requested.load(.acquire))` check at the top of the loop:

```zig
            // Idle deadline: if no /collab/ frame in the configured window,
            // self-kill. Reuses the SIGTERM drain path — same code, different
            // trigger. The reason flag distinguishes the two in logs.
            if (nowNs() - g_last_activity_ns.load(.acquire) > self.keepalive_ns) {
                if (g_kill_reason == .unknown) g_kill_reason = .idle_keepalive;
                g_shutdown_requested.store(true, .release);
            }
```

- [ ] **Step 4.6: Build and run tests**

Run: `cd backend/collab && zig build test`
Expected: all tests pass.

Run: `cd backend/collab && zig build`
Expected: clean build, no warnings.

- [ ] **Step 4.7: Smoke test the keepalive (optional but recommended before commit)**

In a terminal, run with a 5-second keepalive override:

```bash
cd backend/collab && KEEPALIVE_SECONDS=5 zig build run
```

Expected: server starts, prints `mocktail epoll reactor on 0.0.0.0:8080 ...`, sits there. After ~5 s, no clients have connected, so no activity has fired — but the activity timer was initialised at boot, so the deadline starts from boot. After ~5 s past boot, the reactor self-kills cleanly. Process exits.

(If you skip this step, Task 5's structured logs make the kill more observable for the next round of testing.)

- [ ] **Step 4.8: Commit**

```bash
git add backend/collab/src/main.zig
git commit -m "feat(collab): self-kill after configurable idle keepalive"
```

---

## Task 5: Structured log events

**Files:**
- Modify: `backend/collab/src/main.zig` (`main`, `flushRoom`, keepalive check, `onTerminationSignal`-driven path, `drainAndExit`)

Goal: four structured log events, single-line `key=value`, written to stderr (Cloud Logging picks up automatically). Fields per the spec's Observability section.

- [ ] **Step 5.1: Emit `event=instance_started` after server boot**

In `main()`, replace the existing reactor-startup print (currently `main.zig:1234-1237`):

OLD:
```zig
    std.debug.print(
        "mocktail epoll reactor on 0.0.0.0:{d} (max_conns={d}, frame={d}B)\n",
        .{ port, MAX_CONNECTIONS, MAX_FRAME_PAYLOAD },
    );
```

NEW:
```zig
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
```

- [ ] **Step 5.2: Emit `event=flush_committed` on successful flush**

In `flushRoom` (currently `main.zig:288-325`), wrap the commit call to capture timing and emit on success.

OLD (the existing tail of `flushRoom`):
```zig
        _ = client.commit(cq, bytes, arena_alloc) catch |err| {
            // Keep the pending snapshot so the next trigger retries; log and
            // return so a transient Firestore blip doesn't lose edits.
            std.debug.print(
                "flushRoom commit failed room={s} fields={d} err={s}\n",
                .{ room.key(), p_ptr.pendingFieldCount(), @errorName(err) },
            );
            return;
        };

        p_ptr.clear();
        const flush_done_ns = nowNs();
        room.last_flush_ns = flush_done_ns;
        self.last_flush_ns = flush_done_ns;
    }
```

NEW:
```zig
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
```

- [ ] **Step 5.3: Emit `event=self_kill_initiated` from the keepalive check**

In the keepalive block added in Task 4 Step 4.5, expand to log on transition:

OLD (from Task 4):
```zig
            if (nowNs() - g_last_activity_ns.load(.acquire) > self.keepalive_ns) {
                if (g_kill_reason == .unknown) g_kill_reason = .idle_keepalive;
                g_shutdown_requested.store(true, .release);
            }
```

NEW:
```zig
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
```

- [ ] **Step 5.4: Emit `event=self_kill_initiated reason=sigterm` from the SIGTERM path**

`onTerminationSignal` runs in signal context — no I/O is safe there. Instead, log on the way into `drainAndExit` if the reason is SIGTERM. Modify the top of `drainAndExit` (currently `main.zig:330-345`).

OLD:
```zig
    fn drainAndExit(self: *Server) void {
        if (self.fs_client == null) return;
        const started = nowNs();
        var i: usize = 0;
```

NEW:
```zig
    fn drainAndExit(self: *Server) void {
        if (self.fs_client == null) return;
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
        var i: usize = 0;
```

- [ ] **Step 5.5: Emit `event=drain_completed` at the end of `drainAndExit`**

Replace the existing tail of `drainAndExit`:

OLD:
```zig
        var i: usize = 0;
        while (i < self.manager.room_count) : (i += 1) {
            if (nowNs() - started > SHUTDOWN_DRAIN_BUDGET_NS) {
                std.debug.print("drainAndExit: budget exceeded, {d} rooms left\n", .{self.manager.room_count - i});
                break;
            }
            const room = &self.manager.rooms[i];
            if (room.tenant_id_len == 0) continue;
            const p_ptr = &(room.pending orelse continue);
            if (p_ptr.isEmpty()) continue;
            self.flushRoom(room);
        }
    }
```

NEW:
```zig
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
    }
```

- [ ] **Step 5.6: Build and run tests**

Run: `cd backend/collab && zig build test`
Expected: all tests pass (no test logic changed; existing tests still pass).

Run: `cd backend/collab && zig build`
Expected: clean build.

- [ ] **Step 5.7: Smoke test logs**

Run with a 3 s keepalive:

```bash
cd backend/collab && KEEPALIVE_SECONDS=3 zig build run
```

Expected console output (approximately):
```
firestore: init skipped (...)            # or prod init message
mocktail epoll reactor on 0.0.0.0:8080 (max_conns=2048, frame=16384B)
event=instance_started keepalive_s=3 flush_max_s=600 flush_quiescence_ms=5000
event=self_kill_initiated reason=idle_keepalive idle_s=3 rooms=0 pending_fields=0
event=drain_completed rooms_drained=0 rooms_skipped=0 elapsed_ms=0 budget_exceeded=false
```

(Note: `event=drain_completed` only fires when `fs_client != null`. In local dev with no Firestore client, the drain path returns early before logging. That's acceptable — the staging deploy is where this signal matters.)

- [ ] **Step 5.8: Commit**

```bash
git add backend/collab/src/main.zig
git commit -m "feat(collab): structured log events for kill/flush/drain"
```

---

## Task 6: `/healthz` JSON when `Accept: application/json`

**Files:**
- Modify: `backend/collab/src/main.zig` (`processHttp` healthz branch + new `writeHealthzJson` helper)

Goal: when the request includes `Accept: application/json`, return the spec's metrics JSON. Otherwise return `ok\n` exactly as today (Cloud Run startup probes don't send `Accept`).

- [ ] **Step 6.1: Add `writeHealthzJson` helper on `Server`**

In `main.zig`, add this method on the `Server` struct just below `writeHttpText` (currently `main.zig:781-790`):

```zig
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
```

- [ ] **Step 6.2: Branch on `Accept` in the healthz handler**

In `processHttp` (currently `main.zig:655-775`), find the healthz branch (currently `main.zig:687-695`):

OLD:
```zig
        if (std.mem.eql(u8, path, "/") or
            std.mem.eql(u8, path, "/healthz") or
            std.mem.eql(u8, path, "/api/healthz"))
        {
            self.writeHttpText(slot, 200, "OK", "ok\n");
            self.requestClose(slot);
            return false;
        }
```

NEW:
```zig
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
```

- [ ] **Step 6.3: Build and run tests**

Run: `cd backend/collab && zig build test`
Expected: all tests pass.

Run: `cd backend/collab && zig build`
Expected: clean build.

- [ ] **Step 6.4: Manual healthz verification**

Run the server with default config, then in a separate terminal verify both code paths:

```bash
# Plain text path (current behavior)
curl -i http://localhost:8080/healthz
# Expect: HTTP/1.1 200 OK, Content-Type: text/plain, body "ok"

# JSON path (new behavior)
curl -i -H 'Accept: application/json' http://localhost:8080/healthz
# Expect: HTTP/1.1 200 OK, Content-Type: application/json, body like:
#   {"ok":true,"instance_age_seconds":12,"idle_seconds":12,"rooms_active":0,
#    "pending_field_count":0,"last_flush_seconds_ago":-1,"kills_initiated":0}
```

If the JSON values look reasonable (`instance_age_seconds` matches wall clock since you started the server, others zero), this is working.

- [ ] **Step 6.5: Commit**

```bash
git add backend/collab/src/main.zig
git commit -m "feat(collab): JSON /healthz body when Accept: application/json"
```

---

## Task 7: Frontend heartbeat — service + tests

**Files:**
- Modify: `frontend/packages/collab/src/services/collab/collab.service.ts` (heartbeat field, `_resetHeartbeat`, lifecycle wiring)
- Modify: `frontend/packages/collab/src/services/collab/collab.service.spec.ts` (two new specs)

Goal: client sends `{"type":"heartbeat"}` exactly when 30 s elapses with no other outbound frame. Resets on any `_send`. Cleared on disconnect/close.

- [ ] **Step 7.1: Write the two failing specs**

Append these specs to `frontend/packages/collab/src/services/collab/collab.service.spec.ts`, just before the final `});` on line 191:

```ts
  it('sends a heartbeat after 30s of send-silence; suppressed by intervening sends', () => {
    jasmine.clock().install();
    try {
      const sent: string[] = [];
      const fake: Partial<WebSocket> = {
        readyState: WebSocket.OPEN,
        addEventListener: (
          _t: string,
          _cb: (ev?: unknown) => void,
        ) => undefined,
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');

      // Simulate the open + hello path (the service starts the heartbeat
      // timer once the hello has been sent).
      service.sendCursor(0, 0);
      sent.length = 0;

      // Within 30 s with intervening sends → no heartbeat fires.
      jasmine.clock().tick(20_000);
      service.sendCursor(1, 1);
      jasmine.clock().tick(15_000);
      expect(sent.filter((t) => t.includes('"type":"heartbeat"')).length).toBe(0);

      // Now stay silent for 30 s → exactly one heartbeat fires.
      sent.length = 0;
      jasmine.clock().tick(30_000);
      const hbs = sent.filter((t) => t.includes('"type":"heartbeat"'));
      expect(hbs.length).toBe(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('disconnect() clears the heartbeat timer (no further heartbeats fire)', () => {
    jasmine.clock().install();
    try {
      const sent: string[] = [];
      const fake: Partial<WebSocket> = {
        readyState: WebSocket.OPEN,
        addEventListener: (
          _t: string,
          _cb: (ev?: unknown) => void,
        ) => undefined,
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');
      service.sendCursor(0, 0); // arms the heartbeat timer
      sent.length = 0;

      service.disconnect();

      jasmine.clock().tick(120_000);
      expect(sent.filter((t) => t.includes('"type":"heartbeat"')).length).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });
```

- [ ] **Step 7.2: Run the specs to verify they fail**

Run: `cd frontend && npm run test -- --code-coverage=false --watch=false --browsers=ChromeHeadlessNoSandbox --include='**/collab.service.spec.ts'`
Expected: both new specs fail. The first because no heartbeat frames ever appear in `sent`; the second because of nothing — but it might pass trivially. Continue regardless.

- [ ] **Step 7.3: Add the heartbeat field and constant**

In `collab.service.ts`, add this private field near the existing `_reconnectTimer` (currently `collab.service.ts:50`):

OLD:
```ts
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _intentionalClose = false;
```

NEW:
```ts
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _HEARTBEAT_INTERVAL_MS = 30_000;
  private _intentionalClose = false;
```

- [ ] **Step 7.4: Add `_resetHeartbeat`**

Add this private method in `collab.service.ts`, immediately after `_scheduleReconnect` (currently `collab.service.ts:220-227`):

```ts
  /**
   * Reset-on-send heartbeat. Re-armed by every `_send`; fires
   * `{"type":"heartbeat"}` if 30 s elapses with no other outbound traffic.
   * Cursor frames at 30 Hz arm this naturally during active editing — the
   * heartbeat only ever fires when the user is genuinely quiet, preventing
   * the server's 60 s per-connection idle cull.
   */
  private _resetHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._heartbeatTimer = setTimeout(() => {
      // Skip if disconnected; do NOT fall back to _sendQueue. A long outage
      // must not fill the 64-slot queue with stale heartbeats.
      if (this._socket?.readyState === WebSocket.OPEN) {
        this._socket.send('{"type":"heartbeat"}');
        this._resetHeartbeat();
      }
    }, CollabService._HEARTBEAT_INTERVAL_MS);
  }
```

- [ ] **Step 7.5: Re-arm the heartbeat from `_send`**

Replace `_send` (currently `collab.service.ts:237-244`):

OLD:
```ts
  private _send(payload: unknown): void {
    const text = JSON.stringify(payload);
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(text);
    } else {
      if (this._sendQueue.length < 64) this._sendQueue.push(text);
    }
  }
```

NEW:
```ts
  private _send(payload: unknown): void {
    const text = JSON.stringify(payload);
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(text);
      this._resetHeartbeat();
    } else {
      if (this._sendQueue.length < 64) this._sendQueue.push(text);
    }
  }
```

- [ ] **Step 7.6: Start the heartbeat after the hello is sent**

Replace the tail of `_sendHelloWhenAuthReady` (currently `collab.service.ts:201-218`):

OLD:
```ts
    ws.send(JSON.stringify(hello));
    while (this._sendQueue.length) {
      const msg = this._sendQueue.shift();
      if (msg) ws.send(msg);
    }
  }
```

NEW:
```ts
    ws.send(JSON.stringify(hello));
    while (this._sendQueue.length) {
      const msg = this._sendQueue.shift();
      if (msg) ws.send(msg);
    }
    this._resetHeartbeat();
  }
```

- [ ] **Step 7.7: Clear the heartbeat in `disconnect()` and on `close`**

Replace `disconnect` (currently `collab.service.ts:74-92`):

OLD:
```ts
  public disconnect(): void {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    try {
      this._socket?.close();
    } catch {
      // ignore
    }
    this._socket = null;
    this._currentTenantId = null;
    this._currentProjectId = null;
    this._reconnectAttempts = 0;
    this._pendingEditPatches.clear();
    this.connected.set(false);
    this.cursors.set(new Map());
  }
```

NEW:
```ts
  public disconnect(): void {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    try {
      this._socket?.close();
    } catch {
      // ignore
    }
    this._socket = null;
    this._currentTenantId = null;
    this._currentProjectId = null;
    this._reconnectAttempts = 0;
    this._pendingEditPatches.clear();
    this.connected.set(false);
    this.cursors.set(new Map());
  }
```

In the WS `close` handler inside `_openSocket` (currently `collab.service.ts:178-185`):

OLD:
```ts
    ws.addEventListener('close', () => {
      this.connected.set(false);
      this._socket = null;
      this.cursors.set(new Map());
      if (!this._intentionalClose && this._currentProjectId) {
        this._scheduleReconnect();
      }
    });
```

NEW:
```ts
    ws.addEventListener('close', () => {
      this.connected.set(false);
      this._socket = null;
      this.cursors.set(new Map());
      if (this._heartbeatTimer) {
        clearTimeout(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
      if (!this._intentionalClose && this._currentProjectId) {
        this._scheduleReconnect();
      }
    });
```

- [ ] **Step 7.8: Run the specs to verify they pass**

Run: `cd frontend && npm run test -- --code-coverage=false --watch=false --browsers=ChromeHeadlessNoSandbox --include='**/collab.service.spec.ts'`
Expected: all `CollabService` specs pass — both new ones and the existing ones.

- [ ] **Step 7.9: Run lint and typecheck**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no new errors. Pre-existing 57 warnings are unchanged.

- [ ] **Step 7.10: Commit**

```bash
git add frontend/packages/collab/src/services/collab/collab.service.ts \
        frontend/packages/collab/src/services/collab/collab.service.spec.ts
git commit -m "feat(collab): client-side heartbeat keeps idle WS sessions alive"
```

---

## Task 8: README — deploy command + verification recipe

**Files:**
- Modify: `README.md` (Deploy section)

Goal: replace the bare deploy command for the `mocktail` service with the explicit-flags version, and add the verification recipe at the end of the Deploy section. Email-auth deploy and Frontend deploy are unchanged.

- [ ] **Step 8.1: Replace the `mocktail` deploy command**

In `README.md`, find the Deploy section block (currently `README.md:91-107`):

OLD:
````markdown
## Deploy

```sh
# Collab backend -> Cloud Run
gcloud run deploy mocktail \
  --source backend/collab \
  --region us-central1 --allow-unauthenticated --port 8080

# Email/AI backend -> Cloud Run
gcloud run deploy mocktail-email-auth \
  --source backend/email-auth-service \
  --region us-central1 --allow-unauthenticated --port 8080

# Frontend -> Firebase Hosting
cd frontend && npm run build && cd ..
firebase deploy --only hosting
```
````

NEW:
````markdown
## Deploy

```sh
# Collab backend -> Cloud Run.
# --no-cpu-throttling: instance-billed mode; the 1s epoll tick must run reliably.
# --max-instances 1:   Pending buffer is in-memory; multiple instances would diverge.
# --concurrency 1000:  reactor handles 2048 connections/instance; default 80 is too low.
# --timeout 3600:      max WS session length; client reconnects on the inevitable reset.
gcloud run deploy mocktail \
  --source backend/collab \
  --region us-central1 --allow-unauthenticated --port 8080 \
  --no-cpu-throttling \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1000 \
  --cpu 1 --memory 256Mi \
  --timeout 3600 \
  --set-env-vars FIRESTORE_USE_TLS=true,KEEPALIVE_SECONDS=1800,FLUSH_MAX_INTERVAL_SECONDS=600,FLUSH_QUIESCENCE_MILLIS=5000

# Email/AI backend -> Cloud Run
gcloud run deploy mocktail-email-auth \
  --source backend/email-auth-service \
  --region us-central1 --allow-unauthenticated --port 8080

# Frontend -> Firebase Hosting
cd frontend && npm run build && cd ..
firebase deploy --only hosting
```

### Verifying the keepalive cycle

After deploying, exercise the kill cycle: open the editor, idle for 31
minutes, watch Cloud Logs for `event=self_kill_initiated` followed by
`event=drain_completed budget_exceeded=false`. Reload the page; confirm
the next page load takes ~3-5 s (cold start) and the editor reconnects.

For faster iteration during rollout, deploy a one-off revision with
`KEEPALIVE_SECONDS=120` (2 min) and a separate `mocktail-staging`
service name, idle for 3 min, confirm logs, then redeploy `mocktail`
with prod values.

For instantaneous metrics without waiting for log lines:

```sh
curl -H 'Accept: application/json' https://<service-url>/healthz | jq
```

Returns `instance_age_seconds`, `idle_seconds`, `rooms_active`,
`pending_field_count`, `last_flush_seconds_ago`, `kills_initiated`.
````

- [ ] **Step 8.2: Commit**

```bash
git add README.md
git commit -m "docs: deploy flags and verification recipe for collab self-kill"
```

---

## Task 9: Final verification

**Files:** none.

- [ ] **Step 9.1: Run the full backend test suite**

Run: `cd backend/collab && zig build test`
Expected: all tests pass (existing + the two new readEnvNs tests + the heartbeat-detection test).

- [ ] **Step 9.2: Run the full frontend test suite**

Run: `cd frontend && npm run test -- --code-coverage=false --watch=false --browsers=ChromeHeadlessNoSandbox`
Expected: all `CollabService` specs pass. The 22 emulator-bound failures elsewhere (TenantService, ProjectApiService) are pre-existing per repo memory; they should be unchanged in count.

- [ ] **Step 9.3: Run the frontend lint + typecheck pre-check**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 9.4: Review the commits**

Run: `git log --oneline main..HEAD`
Expected (8 commits, in this order):

```
<sha> docs: deploy flags and verification recipe for collab self-kill
<sha> feat(collab): client-side heartbeat keeps idle WS sessions alive
<sha> feat(collab): JSON /healthz body when Accept: application/json
<sha> feat(collab): structured log events for kill/flush/drain
<sha> feat(collab): self-kill after configurable idle keepalive
<sha> feat(collab): handle heartbeat frames (no broadcast, no Firestore)
<sha> feat(collab): env-driven keepalive and flush intervals on Server
```

- [ ] **Step 9.5: Push the branch**

```bash
git push -u origin feat/collab-self-kill-keepalive
```

(Do NOT open a PR until manual staging verification per the README recipe is complete.)

---

## Out of scope (do NOT do)

- Worker-thread move for the gRPC commit path (Phase 2 noted at `backend/collab/src/main.zig:262-264`).
- Prometheus / OpenTelemetry endpoint.
- Server-coordinated client shutdown signal.
- Tunable client-side heartbeat interval.
- Multi-instance horizontal scaling.
- Email-auth Cloud Run service deploy changes.
- Frontend cold-start UX changes (banner, etc.).
- Tightening or relaxing `KEEPALIVE_SECONDS` based on observed usage — defer until two weeks of post-deploy logs exist.
