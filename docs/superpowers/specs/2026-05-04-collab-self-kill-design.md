# Collab Backend Self-Kill & Idle Keepalive — Design

**Status:** approved, awaiting implementation plan
**Author session:** brainstorm 2026-05-04
**Branch (proposed):** `feat/collab-self-kill-keepalive`, branched off `main`.

## Goal

Reduce Cloud Run cost for the `mocktail` (Zig collab) service during low/idle periods by switching to instance-billed mode, capping the deployment at one instance, and self-terminating after 30 minutes of editor inactivity. Persistence to Firestore is coalesced more aggressively so write volume drops in proportion. Realtime peer feel (cursor broadcast at 30 Hz, edit fan-out) is unchanged.

## Scope

**In:**
- New self-kill loop in `backend/collab/src/main.zig`: global `last_activity_ns`, keepalive deadline check inside `run()`, reuse of the existing `drainAndExit` codepath.
- Three constants → env-driven `Server` fields: `KEEPALIVE_NS`, `FLUSH_MAX_INTERVAL_NS`, `FLUSH_QUIESCENCE_NS`.
- New `{"type":"heartbeat"}` frame: server short-circuits (extends activity, no broadcast); client sends every 30 s when no other traffic has been sent.
- Cloud Run deploy command updates: `--no-cpu-throttling`, `--max-instances=1`, `--concurrency=1000`, three new env vars.
- `/healthz` enrichment: returns JSON when `Accept: application/json`, plain `ok\n` otherwise.
- Three structured-log events for operational verification: `instance_started`, `flush_committed`, `self_kill_initiated` (plus `drain_completed`).

**Out (each is a separately-justified deferral):**
- Worker-thread move for the gRPC commit path. Already noted as Phase 2 at `backend/collab/src/main.zig:262-264`. The 10-minute flush interval makes the synchronous-commit reactor stall less frequent, not more — moving to a worker thread is independent of this work.
- Prometheus / OpenTelemetry endpoint. Cloud Logging structured logs are sufficient at this scale; metrics infrastructure is its own project.
- Server-coordinated client shutdown signal (`{"type":"shutdown_imminent"}`). The existing 500 ms exponential-backoff reconnect handles the kill-and-restart window adequately.
- Tunable client-side heartbeat interval. 30 s is hardcoded; tuning would require a server→client config push that doesn't exist.
- Multi-instance horizontal scaling. The `Pending` buffer is in-memory and per-process; `max-instances=1` is a hard requirement of this design.
- Email-auth Cloud Run service. Untouched.
- Frontend cold-start UX (e.g., explicit "connecting…" banner). The existing `connected` signal already drives in-app indicators.

## Constraints accepted from existing project state

- The reactor is single-threaded epoll; `commit` blocks the WS loop. Acceptable at planned scale.
- The `Pending` buffer (`backend/collab/src/pending.zig`) is in-memory only. Hard kills (OOM, SIGKILL) lose up to `FLUSH_MAX_INTERVAL_SECONDS` of edits; this is the conscious tradeoff that funds the cost saving.
- The per-connection `IDLE_TIMEOUT_NS` (60 s) stays at 60 s. The new client heartbeat at 30 s prevents legitimate idle disconnects in normal use; backgrounded browser tabs may still be culled and reconnected.
- Workload Identity / service account is unchanged. The existing `grpc_google_default_credentials_create(null)` path in `firestore.zig` continues to work when `FIRESTORE_USE_TLS=true`.

## Approach

Three approaches were considered (minimal three-env-var change; minimal + observability; full client/server shutdown coordination).

**Selected: minimal + observability.** Without observability, verifying the kill loop fires at 30 minutes and the drain succeeds requires redeploying with debug builds. Server-coordinated shutdown is overkill — the existing reconnect logic already covers the kill-and-restart window. The observability layer is ~100 lines of stack-allocated formatting; the client coordination would be ~150 lines plus a new client state machine.

## Activity definition (locked decision)

A frame is "activity" — extending the keepalive deadline — if and only if it arrives on a `/collab/{tid}/{pid}` (or `/api/collab/{tid}/{pid}`) WebSocket. Plain `/ws` echo connections, `/healthz` HTTP hits, and Cloud Run startup probes are excluded.

| Frame | Counts as activity? |
|---|---|
| `hello` | Yes |
| `cursor` | Yes |
| `selection` | Yes |
| `edit` / `delete` / `deleteFields` | Yes |
| `heartbeat` (new) | Yes |
| WS-level `ping` opcode | Yes (covered by the `processFrames` activity update) |
| Plain `/ws` echo frame | No |
| HTTP `GET /healthz` | No |

## Server-side design (`backend/collab/src/main.zig`)

### Configuration

Three env vars are read at startup. A new helper `readEnvNs(name, default_ns, min_ns)` parses the value, falls back to default on missing/garbage, clamps to the minimum, and emits a `log_warn` line when fallback or clamping fires.

| Env var | Default | Minimum | Purpose |
|---|---|---|---|
| `KEEPALIVE_SECONDS` | `1800` | `60` | Idle deadline before self-kill |
| `FLUSH_MAX_INTERVAL_SECONDS` | `600` | `1` | Firestore flush ceiling regardless of activity |
| `FLUSH_QUIESCENCE_MILLIS` | `5000` | `100` | Idle-since-edit flush trigger |

These become fields on the `Server` struct alongside `fs_client` and `cq`. The current `FLUSH_*` comptime constants (`backend/collab/src/main.zig:42-48`) remain as named defaults consumed by `readEnvNs`.

### Activity tracking

```zig
var g_last_activity_ns: std.atomic.Value(i128) = std.atomic.Value(i128).init(0);
```

Initialised to `nowNs()` at server boot. Updated at exactly one site: inside `processFrames` (`backend/collab/src/main.zig:794`), immediately after the frame has been fully parsed and unmasked, before the opcode switch — and only when `self.conns[slot].phase == .ws_collab`. That single point covers every collab frame type (text, binary, ping, pong, close) without needing per-handler updates and without false positives on plain `/ws` echo connections or HTTP hits.

Connection-accept time is *not* an activity site — the immediate `hello` frame the client sends after the upgrade arrives microseconds later and updates activity through `processFrames`. Connection-close time is *not* an activity site either — a leave is the end of a user's activity, not a heartbeat for it.

The atomic is over-spec for a single-threaded reactor today; it's free and future-proofs the worker-thread phase 2.

### Heartbeat handling

New `isHeartbeatMessage(payload)` substring check, mirroring the family at `backend/collab/src/main.zig:1039-1058`. Inside `handleCollabText`, before `isHelloMessage`/`isEditMessage`/etc., return early on heartbeat — no broadcast to peers, no Firestore ingest. Activity tracking has already happened in `processFrames`.

### Keepalive check in `run()`

Added immediately before the existing SIGTERM check (`backend/collab/src/main.zig:227-230`):

```zig
if (nowNs() - g_last_activity_ns.load(.acquire) > self.keepalive_ns) {
    // structured log: event=self_kill_initiated reason=idle_keepalive ...
    g_kill_reason = .idle_keepalive;
    g_shutdown_requested.store(true, .release);
}
```

Reuses the existing `g_shutdown_requested → drainAndExit → return` codepath.

### Kill reason flag

```zig
const KillReason = enum { unknown, sigterm, idle_keepalive };
var g_kill_reason: KillReason = .unknown;
```

`onTerminationSignal` sets it to `.sigterm` when the kill flag wasn't already set. The reason is used in the `self_kill_initiated` and `drain_completed` log lines.

### `drainAndExit`

No code change. The existing 8 s budget against Cloud Run's 10 s SIGTERM grace is still appropriate — the budget bounds gRPC commits in flight, not the buffered edit volume. Worst case: ~500-field commit per room at ~200 ms each, well within budget.

## Client-side design (`frontend/packages/collab/src/services/collab/collab.service.ts`)

### Heartbeat timer

```ts
private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
private static readonly _HEARTBEAT_INTERVAL_MS = 30_000;
```

The interval is hardcoded — half the server's 60 s `IDLE_TIMEOUT_NS`, comfortable safety margin.

### Reset-on-send pattern

Every `_send()` call (`frontend/packages/collab/src/services/collab/collab.service.ts:237`) re-arms the timer. The timer fires `{"type":"heartbeat"}` if 30 s elapses with no other outbound traffic. Cursor moves at 30 Hz arm the timer naturally; the heartbeat fires only when the user is genuinely quiet.

```ts
private _resetHeartbeat(): void {
  if (this._heartbeatTimer) clearTimeout(this._heartbeatTimer);
  this._heartbeatTimer = setTimeout(() => {
    if (this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send('{"type":"heartbeat"}');
      this._resetHeartbeat();
    }
  }, CollabService._HEARTBEAT_INTERVAL_MS);
}
```

Heartbeat frames bypass `_sendQueue` — a 30-min reconnect outage must not fill the 64-slot queue with stale heartbeats.

### Lifecycle

- Start the timer after the `hello` is sent in `_sendHelloWhenAuthReady` (`frontend/packages/collab/src/services/collab/collab.service.ts:213`).
- Clear the timer in `disconnect()` (`frontend/packages/collab/src/services/collab/collab.service.ts:74`) and the WS `close` handler (`frontend/packages/collab/src/services/collab/collab.service.ts:178`).

### No UX changes

The cold-start delay surfaces through the existing `connected` signal that components already consume. The 500 ms exponential-backoff reconnect (`frontend/packages/collab/src/services/collab/collab.service.ts:222`) handles the kill-and-restart window without new code.

## Cloud Run deploy

The deploy command in `README.md:94-97` is replaced with:

```sh
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
```

Each flag's purpose is documented in the README change as part of this work.

**Deploy-window note:** with `--max-instances 1`, new revisions roll out by killing the old instance before the new one is ready. There's a 5–10 s gap where new WS connections hit cold start — same UX as a self-kill cycle. If this becomes painful, the standard fix is moving to `min-instances=1` during deploys (forfeits scale-to-zero saving for that window). Out of scope for this work.

## Observability

### `/healthz` — backwards-compatible JSON

Today: plain `ok\n` body (`backend/collab/src/main.zig:691-694`). Cloud Run startup probes and `curl /healthz | grep ok` checks rely on that body.

New behavior: when the request includes `Accept: application/json`, return:

```json
{
  "ok": true,
  "instance_age_seconds": 1842,
  "idle_seconds": 47,
  "rooms_active": 3,
  "pending_field_count": 12,
  "last_flush_seconds_ago": 3,
  "kills_initiated": 0
}
```

Otherwise return `ok\n` exactly as today. One-line `Accept` check in `processHttp`; JSON body built into a stack buffer with `std.fmt.bufPrint`. No allocator. Cloud Run probes don't send `Accept`, so they keep getting `ok\n`.

### Structured log events (single-line key=value, stderr)

```
event=instance_started keepalive_s=1800 flush_max_s=600 flush_quiescence_ms=5000
event=flush_committed room=tid/pid fields=23 deletes=0 elapsed_ms=187
event=self_kill_initiated reason=idle_keepalive idle_s=1801 rooms=2 pending_fields=8
event=drain_completed rooms_drained=2 rooms_skipped=0 elapsed_ms=412 budget_exceeded=false
```

`reason` is one of `idle_keepalive` or `sigterm`, populated from `g_kill_reason`. `budget_exceeded` surfaces the existing 8 s drain check at `backend/collab/src/main.zig:335-338`.

### Verification recipe (added to README Deploy section)

> After deploying, exercise the kill cycle: open the editor, idle for 31 minutes, watch Cloud Logs for `event=self_kill_initiated` followed by `event=drain_completed budget_exceeded=false`. Reload the page; confirm the next page load takes ~3-5 s (cold start) and the editor reconnects.

## Failure modes

1. **Hard kill mid-edit** (OOM, panic, SIGKILL after a hung syscall). Up to 10 minutes of unflushed edits lost. Conscious tradeoff. Mitigated in practice by `drainAndExit` covering graceful self-kill and SIGTERM.
2. **Drain budget exceeded** (`budget_exceeded=true` log). Remaining rooms don't flush; same data-loss class as failure mode 1. Monitor in Cloud Logging for trend changes.
3. **Backgrounded browser tab.** Browsers throttle `setTimeout` up to 1 min; heartbeat may be late, the WS hits the 60 s server idle timeout, the user reconnects on tab focus. Identical to today; not a regression.
4. **Nonsense env values.** `readEnvNs` clamps to per-var minimums and falls back to defaults on parse failure with a `log_warn` line. Without clamping, `KEEPALIVE_SECONDS=0` would kill the instance every tick.
5. **Activity timestamp race during graceful kill.** None: single-threaded reactor, both writes and the keepalive read happen on the reactor thread. The atomic is for the future worker-thread phase.
6. **Deploy rollout window.** Same UX as self-kill cycle. No new failure mode.

## Testing

### Zig unit tests (`zig build test`)

- `readEnvNs` parses correctly, defaults on missing/garbage, clamps to minimum.
- `isHeartbeatMessage` matches both spacings (mirror existing pattern at `backend/collab/src/main.zig:1267-1271`).
- Existing `pending.zig` tests continue to pass — no logic change there.

### Frontend unit tests (`karma + jasmine`)

- `collab.service.spec.ts`: fake-timer driven, asserts heartbeat fires after 30 s of `_send` silence and is suppressed by intervening sends.
- `collab.service.spec.ts`: `disconnect()` clears the heartbeat timer (no fired heartbeats after disconnect).

### Manual staging check

Deploy with `KEEPALIVE_SECONDS=120` (2 min, not 30) to a staging service, idle, watch Cloud Logs for the kill cycle, redeploy with prod values once verified.

### Deliberately not added

- No integration test for the keepalive itself. Compressing 30 minutes of wall time would mean piping a fake clock into `nowNs()` — enough plumbing that the manual staging recipe is the better verification.
- No e2e (Playwright) test. Existing e2e covers the WS echo path; adding a 30-min idle test would dominate suite runtime.

## Cost analysis (reference)

Single instance, 1 vCPU + 256 MiB, us-central1:

| Usage pattern | Today (request-billed, scale-to-zero) | This design (instance-billed, 30-min keepalive) |
|---|---|---|
| Continuous low usage (8 hrs/day) | ~8 vCPU-hr × $0.024 = **$0.19/day** | ~8 vCPU-hr × $0.018 = **$0.14/day** (~25% saving) |
| Two long sessions (2 × 2 hr/day) | 4 × $0.024 = **$0.10/day** | (2 + 0.5) × 2 × $0.018 = **$0.09/day** (~roughly equal) |
| Bursty short visits (10 × 5 min) | 10 × 5/60 × $0.024 = **$0.02/day** | 10 × 35/60 × $0.018 = **$0.11/day** (~5× worse) |
| Always-active (16 hrs/day) | 16 × $0.024 = **$0.38/day** | 16 × $0.018 = **$0.29/day** (~25% saving) |

The 30-min keepalive is the lever to tune once real usage data exists. Bursty short visits are the failure mode for this design — if that turns out to be the dominant pattern, lowering `KEEPALIVE_SECONDS` (or moving back to request-billed) is the answer.

Firestore write cost reduction comes primarily from raising `FLUSH_QUIESCENCE_MILLIS` (500 → 5000); the 10-minute ceiling rarely fires in practice.

## Out of scope follow-ups

- Tighten or relax `KEEPALIVE_SECONDS` based on observed usage. Defer until two weeks of post-deploy logs exist.
- Move gRPC commits to a worker thread (Phase 2 noted at `backend/collab/src/main.zig:262-264`). Independent of this work.
- Per-environment env-var profiles (dev/staging/prod). Deferred until there's a second environment.
