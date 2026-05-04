# Collab Self-Kill / Cloud Run Deployment — Working Notes

> Mirror of the in-flight understanding from `~/.claude/projects/-workspaces-mocktail/memory/cloudrun_collab_deployment.md`. Kept in repo so the next session and human author can pick up cold. Delete after Terraform lands and the deploy command stops drifting.
>
> Previous content (Editor God-Object Split Refactor) was completed and removed; see `git log -- memory.md` to recover if needed.

## Status

- **Self-kill / idle-keepalive feature merged into master** at `b8f3137 Merge branch 'feat/collab-self-kill-keepalive'` (2026-05-04). 9 feature commits + the merge commit.
- Spec: `docs/superpowers/specs/2026-05-04-collab-self-kill-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-collab-self-kill-keepalive.md`
- Manual staging verification (the recipe in README "Verifying the keepalive cycle") **not yet run**. Production deploy is gated on that recipe.

## Cloud Run deployment shape — what's load-bearing

Canonical `gcloud run deploy` for the `mocktail` (Zig collab) service is in `README.md:91-108`. Every flag is load-bearing — dropping any breaks the design. When this gets translated to Terraform, preserve all of them.

| Flag | Value | Why |
|---|---|---|
| `--no-cpu-throttling` | (set) | Reactor's 1 s `epoll_wait` tick must run reliably between WS frames; without it the self-kill timer + flush triggers stall. **Don't drop to "save money".** |
| `--max-instances 1` | 1 | `Pending` buffer is in-memory per process. Two instances would each accumulate conflicting per-room edit state and silently lose data. **Correctness invariant, not a tuning knob.** |
| `--min-instances 0` | 0 | Scale-to-zero on idle is the cost saving. |
| `--concurrency 1000` | 1000 | Reactor handles 2048 conns/instance (`MAX_CONNECTIONS`). Default 80 would force scale-out before saturation, hit max=1, 503. |
| `--cpu 1 --memory 256Mi` | | ~128 MiB connection pool + headroom. 1 vCPU is plenty for single-threaded epoll. |
| `--timeout 3600` | 1 h | Cap per-request (= per-WS-session) wall time at Cloud Run's max; client reconnects on the inevitable reset. |
| `--allow-unauthenticated` | (set) | Auth happens at the application layer; Firebase Hosting `/api/**` rewrite fronts the service. |

## Env vars

| Var | Default | Notes |
|---|---|---|
| `FIRESTORE_USE_TLS` | `true` | Enables `grpc_google_default_credentials_create(null)` — Workload Identity via metadata server. Without it, prod calls 401. |
| `KEEPALIVE_SECONDS` | `1800` | Idle deadline before self-kill. 60 s minimum (clamped in `readEnvNs`). |
| `FLUSH_MAX_INTERVAL_SECONDS` | `600` | Firestore flush ceiling. 1 s minimum. |
| `FLUSH_QUIESCENCE_MILLIS` | `5000` | Idle-since-edit flush trigger. **The actual Firestore write-cost saving lives here**, not in the max-interval. 100 ms minimum. |

## What NOT to do

- Don't set `--min-instances ≥ 1`. Defeats scale-to-zero.
- Don't drop `--no-cpu-throttling` for cost reasons; the reactor literally won't run its kill timer reliably.
- Don't add startup probes that send `Accept: application/json` to `/healthz` — they'd hit the JSON branch instead of the plain `ok\n`.
- Don't bundle `mocktail-email-auth` Terraform with `mocktail`. The email-auth service is unrelated and uses request-billed standard config.
- Don't push to a remote — there is no remote configured for this repo.

## Open follow-up (deferred per final reviewer)

**I1 — `kills_initiated` field semantics in `/healthz` JSON.** Currently `0 | 1` (boolean) but the field name implies a counter. Reviewer recommended renaming to `shutdown_requested` for clarity. One-line code change in `writeHealthzJson` at `backend/collab/src/main.zig` + one-line spec amendment. Defer until the manual staging verification confirms the kill cycle, then bundle with any other small touch-ups.

## Local dev gotchas (for next session)

- Firebase emulators run via `firebase emulators:start --project=demo-mocktail` (alias `fb-ui`). Firestore on `:8083`, Auth on `:9099`, UI on `:4000`.
- Zig backend default port is **8082** (per `readPort` fallback in `main.zig`); frontend `proxy.conf.json` proxies `/api` → `localhost:8082` with `ws: true`. Memory of the README's "8080" example is outdated since the devcontainer port shift in `95e65a5`.
- For verification with shorter timing, set `KEEPALIVE_SECONDS=300 FLUSH_QUIESCENCE_MILLIS=2000 FLUSH_MAX_INTERVAL_SECONDS=30 FIRESTORE_EMULATOR_HOST=localhost:8083 PORT=8082` and run `zig build run`. The instance self-kills 5 min after going idle.
- 22 pre-existing test failures in `TenantService` / `ProjectApiService` are emulator-bound (need Firestore + Auth emulators); they're unrelated to this feature.
- Lint baseline: 0 errors, 56 warnings (project memory said 57; off by one). All warnings are pre-existing in unrelated files.

## Handoff for Terraform work

When the user asks for Terraform that deploys this service: read `cloudrun_collab_deployment.md` in the global memory directory (or this file), translate every `gcloud` flag in the table above to its `google_cloud_run_v2_service` equivalent with a comment noting which constraint each enforces. Especially comment `max_instance_count = 1` and `cpu_idle = false` — those are correctness-load-bearing and easy for a future operator to "optimize" away.

Pickup checklist:
1. `git status` from `/workspaces/mocktail` — should be on `master` at `b8f3137`, clean tree.
2. Read this file + the spec/plan in `docs/superpowers/`.
3. Run `firebase emulators:start --project=demo-mocktail` if you need to verify locally.
4. The README's `Deploy` section is the canonical source for the deploy command shape; diff your Terraform output against it.
