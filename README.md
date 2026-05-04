# mocktail

Full-stack monorepo:

- **backend/collab/** — Zig WebSocket server (single-threaded epoll reactor) deployed
  to Cloud Run as the `mocktail` service. Optional Firestore client via `libgrpc-c`
  with Workload Identity.
- **backend/email-auth-service/** — Deno/Hono HTTP service deployed to Cloud Run as
  `mocktail-email-auth`. Serves `/api/email-auth/*` (email flows) and `/api/ai/*`
  (Gemini generation).
- **frontend/** — Angular 19 app deployed to Firebase Hosting. Talks to the backends
  via `/api/**` (rewritten to the matching Cloud Run service in production; proxied
  to `localhost:8080` during `ng serve`).
- **e2e** — Playwright runs the real Angular app against the real Zig backend.

## Layout

```
.devcontainer/                 Ubuntu 24.04 + Zig 0.15.2 + gRPC + Node 22 + Angular CLI + Playwright
backend/
  collab/
    src/main.zig               Epoll reactor; accepts /ws and /api/ws
    src/grpc.zig               libgrpc-c wrapper
    src/firestore.zig          Firestore config + client
    build.zig                  Links system grpc + protobuf-c
    proto/                     Generated protobuf-c sources (created by post-create.sh)
    Dockerfile                 debian-slim multi-stage image for Cloud Run
  email-auth-service/
    main.ts                    Hono app (/api/email-auth, /api/ai)
    routes/                    Route handlers
    services/                  Mail + AI clients
    Dockerfile                 Deno multi-stage image
frontend/
  src/app/                     Angular standalone components + WebsocketService
  e2e/ws.spec.ts               Playwright tests for the WS echo
  proxy.conf.json              ng serve proxy: /api/** -> localhost:8080
  playwright.config.ts         webServer starts `npm start`; backend runs separately
  angular.json
firebase.json                  Hosting: public -> frontend/dist/mocktail/browser
                               Rewrites: /api/** -> Cloud Run, ** -> /index.html
.firebaserc                    Firebase project alias
```

## Local dev

All commands are exposed as zsh aliases inside the devcontainer.

### Backend (terminal 1)

```sh
zb      # zig build          (inside backend/collab/)
zr      # zig build run      -> ws://localhost:8080/ws
zt      # zig build test
```

### Frontend (terminal 2)

```sh
ng-serve    # npm start -> http://localhost:4200 (proxies /api -> :8080)
ng-build    # production build -> frontend/dist/mocktail/browser
```

### End-to-end (terminal 3, backend must be running)

```sh
e2e       # playwright test (spawns ng serve on :4200 automatically)
e2e-ui    # playwright test --ui (interactive)
```

### Firebase emulators

```sh
fb-hosting   # firebase emulators:start --only hosting (:5000)
fb-ui        # all emulators + UI on :4000
```

The hosting emulator serves `frontend/dist/mocktail/browser`, so run `ng-build`
first if you want to exercise the production bundle. For iterative dev, prefer
`ng-serve` + its proxy — it rebuilds on save.

## Build & run the Cloud Run image locally

```sh
docker-build         # builds backend/collab/Dockerfile
docker-run           # runs on :8080 (the entire collab image)
```

The production `Dockerfile` regenerates Firestore protos from googleapis at
build time and links against the system `libgrpc`/`libprotobuf-c`.

## Deploy

```sh
# Collab backend -> Cloud Run.
# --no-cpu-throttling: instance-billed mode; the 1s epoll tick must run reliably.
# --max-instances 1:   Pending buffer is in-memory; multiple instances would diverge.
# --concurrency 1000:  reactor handles 2048 connections/instance; default 80 is too low.
# --timeout 3600:      max WS session length; client reconnects on the inevitable reset.
gcloud run deploy mocktail \
  --source backend/collab \
  --region europe-west2 --allow-unauthenticated --port 8080 \
  --no-cpu-throttling \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1000 \
  --cpu 1 --memory 512Mi \
  --timeout 3600 \
  --set-env-vars FIRESTORE_USE_TLS=true,KEEPALIVE_SECONDS=1800,FLUSH_MAX_INTERVAL_SECONDS=600,FLUSH_QUIESCENCE_MILLIS=5000

# Email/AI backend -> Cloud Run
gcloud run deploy mocktail-email-auth \
  --source backend/email-auth-service \
  --region europe-west2 --allow-unauthenticated --port 8080

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

## Endpoints (collab backend)

- `GET /`, `GET /healthz`, `GET /api/healthz` → `200 ok`
- `GET /ws` or `GET /api/ws` → WebSocket upgrade, echoes text/binary frames

Both bare and `/api/`-prefixed paths are accepted because Firebase Hosting's
Cloud Run rewrite preserves the full path.

## Collab backend architecture

Single-threaded `epoll` reactor:

- Level-triggered epoll on non-blocking sockets.
- Fixed connection pool (2048 slots), free-list allocation; no per-request heap.
- Per-slot stack-allocated 32 KiB read and write buffers.
- `EPOLLOUT` is registered only while bytes are queued — real backpressure.
- Generation-counter tokens in `epoll_data.u64` defeat the stale-event race
  when a slot is reused within an `epoll_wait` batch.
- Timeout sweep each tick: handshake (10 s), idle (60 s).
- `MSG_NOSIGNAL` on sends; `TCP_NODELAY` on accepted sockets; `SO_REUSEPORT` on
  the listener so you can run multiple processes on the same port later.
- Linux-only (`comptime` guard).

Frame policy: single-frame messages up to 16 KiB. Fragmented, oversized, or
unmasked client frames trigger a close frame with the appropriate code.

## Firestore / gRPC

`backend/collab/src/grpc.zig` wraps `libgrpc`. `backend/collab/src/firestore.zig`
builds a `Client` from env and exposes unary helpers.

Auth selection:

- `FIRESTORE_USE_TLS=true` → `grpc_google_default_credentials_create(null)`.
  This is the call that makes the service **Workload Identity aware** on Cloud
  Run / GKE — ADC picks up the metadata-server token automatically.
- otherwise → insecure channel with `authorization: Bearer owner`, required
  by the Firestore emulator.

Host selection:

- `FIRESTORE_USE_TLS=true` → `firestore.googleapis.com:443` (overrides any
  stale `FIRESTORE_EMULATOR_HOST` in the shell).
- else if `FIRESTORE_EMULATOR_HOST` is set → use it.
- else → production host.
