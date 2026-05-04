# Mocktail — firebase-cloud Onboarding & Production Pipeline

Design spec for moving mocktail onto the shared `firebase-cloud-491613` GCP project,
provisioning all infra via the `firebase-cloud` Terraform repo, and replacing the
manual `gcloud run deploy` recipe with a CI/CD pipeline that mirrors the rest of
`poly-glot/*`.

This work spans two repos: `firebase-cloud` (Terraform + workflow) and `mocktail`
(small code changes + new CI/CD workflows). After it lands, `firebase-cloud` is
the single source of truth for mocktail's infra, and the mocktail repo's
pipeline only consumes WIF + SA outputs to deploy code.

## Status

- Date: 2026-05-04
- Branch (firebase-cloud): TBD on plan kickoff
- Branch (mocktail): TBD on plan kickoff
- Supersedes: `mocktail/memory.md` "Handoff for Terraform work" section
- Companion docs: `mocktail/docs/superpowers/specs/2026-05-04-collab-self-kill-design.md` (canonical source for the load-bearing Cloud Run flags)

## Goals

1. Provision mocktail infra (identity, Firestore, Hosting, two Cloud Run
   services, custom domain) via Terraform in `firebase-cloud/terraform/apps/mocktail.tf`,
   following the existing repo pattern (hooklab/azadi/shehryar precedent).
2. Replace the manual `gcloud run deploy --source backend/collab` recipe with a
   sibling-style CI/CD pipeline (`poly-glot/webhook` shape) that builds Docker
   images, pushes to the shared Artifact Registry, and deploys via `gcloud run
   deploy --image=...`.
3. Keep every load-bearing constraint of the Zig collab service from
   `2026-05-04-collab-self-kill-design.md` and `memory.md` ("Cloud Run
   deployment shape") intact and explicitly commented at the call site.
4. Keep mocktail-email-auth on the standard `cloud-run` module (per memory.md:
   "Don't bundle `mocktail-email-auth` Terraform with `mocktail`").
5. Promote `UNSPLASH_ACCESS_KEY` and `GEMINI_API_KEY` to *shared* TF
   variables on the `firebase-cloud` repo (like `RESEND_API_KEY`), so future
   apps that need them reuse the same secret.

## Non-goals

- BigQuery dataset for mocktail (not used today).
- Cloud Scheduler jobs (no scheduled work today).
- Realtime Database (mocktail uses Firestore + Auth).
- Staging Cloud Run revision with `--no-traffic` tag. The Zig service has
  `max_instance_count = 1`; running two revisions concurrently is awkward and
  the staging ritual would be non-functional. Rollback path is
  `gcloud run services update-traffic --to-revisions=PREVIOUS=100`.
- Migration of any data already in the `(default)` Firestore database. Mocktail
  starts fresh on the new named `mocktail` DB.
- Switching the email-auth service from public Gemini API (key auth) to Vertex
  AI (WIF). Wired but disabled; revisit later.

## Architecture

```
poly-glot/mocktail (GitHub repo)        ──pinned via WIF────┐
                                                            │
firebase-cloud-491613  (shared GCP project, us-central1)    │
├── module mocktail_identity                                │
│   ├── google_service_account "mocktail-ci-cd"   ◀─────────┘
│   ├── google_service_account "mocktail-runtime"
│   └── google_iam_workload_identity_pool_provider "mocktail-github"
│
├── module mocktail_firestore  →  named DB "mocktail" (FIRESTORE_NATIVE, nam5)
├── module mocktail_hosting    →  Hosting site "mocktail"
├── google_firebase_hosting_custom_domain  →  mocktail.junaid.guru
│
├── google_cloud_run_v2_service "mocktail"             (Zig, INLINED — special flags)
│   └── google_cloud_run_v2_service_iam_member         (allUsers / run.invoker)
│
└── module mocktail_email_auth_cloud_run               (Deno, standard cloud-run module)
```

Routing is unchanged from the existing `firebase.json`:

| Hosting path             | Backend                                        |
|--------------------------|------------------------------------------------|
| `/api/email-auth/**`     | `mocktail-email-auth` (Deno, standard config)  |
| `/api/ai/**`             | `mocktail-email-auth`                          |
| `/api/images/**`         | `mocktail-email-auth`                          |
| `/api/**`                | `mocktail` (Zig, single-threaded epoll)        |
| `**`                     | `/index.html` (SPA)                            |

## Terraform changes (firebase-cloud)

### `terraform/apps/mocktail.tf` (new)

Shape (skeleton — full content rendered by the implementation plan):

```hcl
# ─────────────────────────────────────────────────────────────
# Mocktail — Angular SPA + Zig collab WS + Deno email-auth/AI
# ─────────────────────────────────────────────────────────────

module "mocktail_identity" {
  source        = "../modules/app-identity"
  project_id    = var.project_id
  app_name      = "mocktail"
  github_org    = var.github_org      # "poly-glot"
  github_repo   = "mocktail"
  wif_pool_id   = var.wif_pool_id
  wif_pool_name = var.wif_pool_name

  runtime_roles = [
    "roles/datastore.user",                # Firestore via WIF (FIRESTORE_USE_TLS=true)
    "roles/firebaseauth.admin",            # mint custom tokens for email-link flow
    "roles/secretmanager.secretAccessor",  # future-proofing; not currently consumed
    "roles/iam.serviceAccountTokenCreator",# Admin SDK signBlob (createCustomToken)
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ]
}

module "mocktail_firestore" {
  source        = "../modules/firestore-databases"
  project_id    = var.project_id
  region        = var.region
  database_name = "mocktail"               # Zig client reads FIRESTORE_DB env var
}

module "mocktail_hosting" {
  source     = "../modules/hosting"
  project_id = var.project_id
  site_id    = "mocktail"
}

resource "google_firebase_hosting_custom_domain" "mocktail" {
  provider              = google-beta
  project               = var.project_id
  site_id               = module.mocktail_hosting.site_id
  custom_domain         = "mocktail.junaid.guru"
  wait_dns_verification = false
}

# ── Cloud Run: mocktail-email-auth (Deno, standard) ─────────
module "mocktail_email_auth_cloud_run" {
  source                = "../modules/cloud-run"
  project_id            = var.project_id
  region                = var.region
  service_name          = "mocktail-email-auth"
  service_account_email = module.mocktail_identity.runtime_sa_email
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/firebase-cloud/mocktail-email-auth:latest"
  health_path           = "/healthz"

  env_vars = {
    PROJECT_ID          = var.project_id
    APP_DOMAIN          = "mocktail.junaid.guru"
    FROM_EMAIL          = "Mocktail <me@junaid.guru>"
    RESEND_API_KEY      = var.resend_api_key
    UNSPLASH_ACCESS_KEY = var.unsplash_access_key
    GEMINI_API_KEY      = var.gemini_api_key
    GEMINI_MODEL        = "gemini-2.5-flash"
    # GEMINI_ENABLED is NOT set — service short-circuits callGemini() in code.
    # To enable later: add GEMINI_ENABLED = "true" here and apply.
  }
  depends_on = [module.mocktail_identity]
}

# ── Cloud Run: mocktail (Zig collab) ────────────────────────
# INLINED rather than module-driven. Every flag below is load-bearing — see
# memory.md and 2026-05-04-collab-self-kill-design.md. Don't optimize.
resource "google_cloud_run_v2_service" "mocktail" {
  provider            = google-beta
  project             = var.project_id
  name                = "mocktail"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = module.mocktail_identity.runtime_sa_email

    scaling {
      min_instance_count = 0                   # scale-to-zero when idle (cost saving)
      max_instance_count = 1                   # CORRECTNESS: in-memory pending buffer
                                                # would diverge across instances. Don't raise.
    }

    max_instance_request_concurrency = 1000    # reactor handles 2048 conns/instance.
                                                # Default 80 forces scale-out before saturation.
    timeout                          = "3600s" # cap per-WS-session at Cloud Run max.
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/firebase-cloud/mocktail:latest"

      resources {
        limits           = { cpu = "1", memory = "256Mi" }
        cpu_idle         = false               # CORRECTNESS: --no-cpu-throttling.
                                                # 1s epoll tick + self-kill timer require
                                                # CPU between WS frames.
        startup_cpu_boost = true
      }

      ports { container_port = 8080 }

      env { name = "FIRESTORE_USE_TLS"          value = "true" }
      env { name = "FIRESTORE_DB"               value = "mocktail" }   # named DB
      env { name = "KEEPALIVE_SECONDS"          value = "1800" }
      env { name = "FLUSH_MAX_INTERVAL_SECONDS" value = "600" }
      env { name = "FLUSH_QUIESCENCE_MILLIS"    value = "5000" }

      startup_probe {
        # Plain GET — no Accept header. Service responds `ok\n` to /healthz.
        # Don't change to JSON probe (memory.md "What NOT to do").
        http_get { path = "/healthz" }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
        timeout_seconds       = 3
      }
      # No liveness probe: a stuck reactor should die via self-kill
      # (KEEPALIVE_SECONDS), not be force-restarted mid-flush.
    }
  }

  traffic { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" percent = 100 }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,         # CI/CD swaps :sha at deploy time
      traffic,
    ]
  }

  depends_on = [module.mocktail_identity, module.mocktail_firestore]
}

resource "google_cloud_run_v2_service_iam_member" "mocktail_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.mocktail.name
  role     = "roles/run.invoker"
  member   = "allUsers"   # auth happens at app layer; Hosting /api/** rewrite fronts the service
}
```

### `terraform/apps/outputs.tf` (additions)

```hcl
output "mocktail_wif_provider"      { value = module.mocktail_identity.wif_provider }
output "mocktail_gcp_sa_email"      { value = module.mocktail_identity.ci_cd_sa_email }
output "mocktail_runtime_sa_email"  { value = module.mocktail_identity.runtime_sa_email }
output "mocktail_cloud_run_url"     { value = google_cloud_run_v2_service.mocktail.uri }
output "mocktail_email_auth_url"    { value = module.mocktail_email_auth_cloud_run.service_url }
output "mocktail_hosting_url"       { value = module.mocktail_hosting.site_url }
output "mocktail_firestore_db"      { value = module.mocktail_firestore.database_name }
output "mocktail_custom_domain"     { value = google_firebase_hosting_custom_domain.mocktail.custom_domain }
output "mocktail_required_dns"      { value = google_firebase_hosting_custom_domain.mocktail.required_dns_updates }
```

### Shared variables — promoted to cross-app

`UNSPLASH_ACCESS_KEY` and `GEMINI_API_KEY` are declared once at the `firebase-cloud`
repo level (matching `RESEND_API_KEY`'s pattern), so any future app can reuse
them without re-declaring.

`terraform/variables.tf` (additions):
```hcl
variable "unsplash_access_key" {
  description = "Unsplash Access Key (shared across apps that fetch stock images)"
  type        = string
  sensitive   = true
}
variable "gemini_api_key" {
  description = "Gemini API key (shared across apps; consumers pass it through their Cloud Run env)"
  type        = string
  sensitive   = true
}
```

`terraform/apps/variables.tf` re-declares the same two variables (the `apps`
module is called from root `main.tf` and re-declares each secret it consumes —
matches the existing Azadi/Amazing-Landing convention).

`terraform/main.tf` passes them into the `apps` module:
```hcl
module "apps" {
  # ... existing args ...
  unsplash_access_key = var.unsplash_access_key
  gemini_api_key      = var.gemini_api_key
}
```

`terraform/terraform.tfvars.example` adds stub lines:
```hcl
unsplash_access_key = "REPLACE_ME"
gemini_api_key      = "REPLACE_ME_OR_LEAVE_BLANK_WHILE_DISABLED"
```

The real `terraform.tfvars` is gitignored; values are pasted there once for
local applies.

### `firebase-cloud/.github/workflows/terraform.yml` (additions)

Two new lines under the `Terraform Plan` step's `env:` block, matching the
existing `OPENGUESSR_GOOGLE_MAPS_API_KEY` pattern:

```yaml
- name: Terraform Plan
  env:
    # ... existing TF_VAR_* lines ...
    TF_VAR_unsplash_access_key: ${{ secrets.UNSPLASH_ACCESS_KEY }}
    TF_VAR_gemini_api_key:      ${{ secrets.GEMINI_API_KEY }}
```

The apply job consumes the saved `tfplan` artifact, which already has values
baked in — no env additions needed there.

## Code changes (mocktail repo)

### Zig: read `FIRESTORE_DB` env var (`backend/collab/src/firestore.zig`)

Currently hardcoded at `firestore.zig:54`:
```zig
"projects/{s}/databases/(default)"
```

Replace with an env-var read that falls back to `(default)`:
```zig
const db_name = std.process.getEnvVarOwned(allocator, "FIRESTORE_DB") catch |err| switch (err) {
    error.EnvironmentVariableNotFound => try allocator.dupe(u8, "(default)"),
    else => return err,
};
defer allocator.free(db_name);
const db_path = try std.fmt.allocPrint(
    allocator,
    "projects/{s}/databases/{s}",
    .{ project_id, db_name },
);
```

Existing test at `firestore.zig:150` stays as the unset-env case; add a second
test case for `FIRESTORE_DB=mocktail`. Local verification:
`FIRESTORE_DB=mocktail FIRESTORE_EMULATOR_HOST=localhost:8083 PORT=8082 zig build run`
and confirm Firestore writes land in the named DB in the emulator UI.

### Deno: env-controlled Gemini kill switch (`backend/email-auth-service/routes/ai.ts`)

```ts
const GEMINI_ENABLED = Deno.env.get("GEMINI_ENABLED") === "true";

async function callGemini(prompt: string, context?: unknown): Promise<
  { elements: WireframeElement[]; notes: string } | null
> {
  if (!GEMINI_ENABLED) return null;       // disabled in prod until cost/quality validated
  if (!GEMINI_API_KEY) return null;
  // ... rest unchanged ...
}
```

Extend the healthz endpoint (`/api/ai/healthz`) to report `enabled: GEMINI_ENABLED`
alongside `hasKey`. To enable later: add `GEMINI_ENABLED = "true"` to the
email-auth Cloud Run env_vars block in `mocktail.tf`, apply, redeploy.

### `firebase.json`: target the named Firestore DB

```json
"firestore": {
  "rules":    "firestore.rules",
  "indexes":  "firestore.indexes.json",
  "database": "mocktail"
}
```

Without this, `firebase deploy --only firestore` would push rules to `(default)`
instead of the new named `mocktail` DB.

### `.firebaserc`: align with the GCP project

```json
{ "projects": { "default": "firebase-cloud-491613" } }
```

The CD workflow passes `--project ${{ env.GCP_PROJECT_ID }}` explicitly, but
this lets local `firebase deploy` and `firebase emulators:start` work without
flags.

### Memory.md cleanup

Delete `mocktail/memory.md` after the first successful CI deploy. Its standing
instruction (*"Delete after Terraform lands and the deploy command stops
drifting"*) explicitly anticipates this milestone.

## CI/CD changes (mocktail repo)

### `.github/workflows/ci.yml` (replaces `frontend-ci.yml`)

Three jobs, one workflow. Runs on PR/push and is callable from CD via
`workflow_call`. Existing `frontend-ci.yml` content becomes the `frontend` job;
two new jobs add Zig + Deno checks.

| Job          | Tool         | Steps                                                          |
|--------------|--------------|----------------------------------------------------------------|
| `frontend`   | Node 22      | lint, lint:scss, format:check, typecheck, test (coverage), coverage ratchet, deps:check, build (uploads `frontend-dist` artifact) |
| `collab`     | Zig 0.15.2 + libgrpc-dev + libprotobuf-c-dev | `zig build`, `zig build test` |
| `email-auth` | Deno 2.x     | `deno check main.ts`, `deno fmt --check`, `deno lint` (tests when added) |

The `frontend` job's `frontend-dist` artifact is consumed by CD's deploy job.

### `.github/workflows/cd.yml` (new)

Sequence: `ci` (gate, via `workflow_call`) → `build-images` (Buildx push to AR
for both backend services) → `deploy-production` (Cloud Run deploys, Firestore
rules deploy, Hosting deploy, release tag) → `smoke-test`.

Key env vars (top of file):
```yaml
GCP_REGION:         us-central1               # mocktail is pinned here (firebase.json)
GCP_PROJECT_ID:     firebase-cloud-491613
AR_REPO:            firebase-cloud
COLLAB_SERVICE:     mocktail
EMAIL_AUTH_SERVICE: mocktail-email-auth
FIREBASE_SITE_ID:   mocktail
```

Image naming: `us-central1-docker.pkg.dev/firebase-cloud-491613/firebase-cloud/<service>:<sha>`
plus `:latest`. Cloud Run service's
`lifecycle.ignore_changes = [template[0].containers[0].image]` lets CI swap the
image without TF fighting back.

Smoke test hits `/`, `/api/healthz`, and `/api/email-auth/healthz` on
`mocktail.junaid.guru` — 200 required for the workflow to pass.

No staging environment; deploys go straight to prod. Rollback is
`gcloud run services update-traffic --region=us-central1 --to-revisions=PREVIOUS=100`.

## Migration plan

### Pre-apply prerequisites

1. GitHub secrets on `poly-glot/firebase-cloud`:
   ```sh
   gh secret set UNSPLASH_ACCESS_KEY -R poly-glot/firebase-cloud
   gh secret set GEMINI_API_KEY      -R poly-glot/firebase-cloud
   ```
2. Local `firebase-cloud/terraform/terraform.tfvars` (gitignored): paste real
   values for both vars.
3. Push the mocktail repo to GitHub:
   ```sh
   cd /Users/junaidahmed/Desktop/projects/mocktail
   git remote add origin git@github.com:poly-glot/mocktail.git
   git push -u origin master
   ```

### Imports (run locally on a feature branch in firebase-cloud)

The `mocktail` and `mocktail-email-auth` Cloud Run services already exist in
prod (deployed via the README's manual recipe). Import before first apply,
otherwise create will 409.

```sh
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform

terraform import 'module.apps.google_cloud_run_v2_service.mocktail' \
  projects/firebase-cloud-491613/locations/us-central1/services/mocktail

terraform import 'module.apps.module.mocktail_email_auth_cloud_run.google_cloud_run_v2_service.default' \
  projects/firebase-cloud-491613/locations/us-central1/services/mocktail-email-auth

# Hosting site — IF firebase init created it:
firebase hosting:sites:list --project firebase-cloud-491613
# If "mocktail" is listed:
terraform import 'module.apps.module.mocktail_hosting.google_firebase_hosting_site.default' \
  projects/firebase-cloud-491613/sites/mocktail

# Firestore named DB — IF it exists:
gcloud firestore databases list --project firebase-cloud-491613
# If "mocktail" is listed:
terraform import 'module.apps.module.mocktail_firestore.google_firestore_database.app' \
  projects/firebase-cloud-491613/databases/mocktail
```

`terraform plan` after each import must show only expected changes
(`update_in_place` on env vars / probe path / cpu_idle on the imported Cloud
Run service; net-new SAs, WIF provider, IAM bindings, custom domain, and
optionally Hosting site / Firestore DB). No `delete-then-recreate` is
acceptable.

### Apply order

1. PR on `firebase-cloud` with `mocktail.tf` + variables + workflow → review
   → merge → `terraform apply` runs in CI.
2. After apply, propagate WIF + SA outputs to mocktail:
   ```sh
   gh secret set WIF_PROVIDER -R poly-glot/mocktail \
     --body "$(terraform output -raw mocktail_wif_provider)"
   gh secret set GCP_SA_EMAIL -R poly-glot/mocktail \
     --body "$(terraform output -raw mocktail_gcp_sa_email)"
   ```
3. PR on `poly-glot/mocktail` with code changes (Zig env var, Deno kill switch,
   firebase.json, .firebaserc) and the new `ci.yml` + `cd.yml`. Push to main
   → CD runs end-to-end.
4. Add DNS records: `terraform output mocktail_required_dns` lists the records
   to add at the registrar for `mocktail.junaid.guru`.
5. Verify per the README's "Verifying the keepalive cycle" recipe (or wait for
   the smoke-test job).
6. Delete `mocktail/memory.md`.

## Risks

| Risk | Containment |
|---|---|
| Cloud Run import diff is destructive | Run `terraform plan` after each import; abort if anything proposes `delete-then-recreate`. Reconcile by adjusting TF to match prod, then evolve the value via subsequent applies. |
| Hosting site already exists | Either import or drop the resource block. The site is just a name — no data loss. |
| Firestore named DB `mocktail` already exists with data | Import; data is preserved. Otherwise TF creates an empty one and the Zig client (Section 6.1) starts writing to it cleanly. |
| First `mocktail`-repo CD run fails on IAM eventual consistency (~60 s for new SA bindings) | Re-run the workflow once. README's "Gotchas" section explicitly calls this out. |
| Existing `(default)` Firestore DB has data from prior testing | Out of scope. Old `(default)` data stays untouched; if migration is needed, that's a separate dump/import task. |
| `--no-cpu-throttling` getting "optimized" later | Inline Cloud Run resource has `cpu_idle = false` with comment naming the correctness invariant. Memory.md's handoff item explicitly demands this. |
| Custom domain DNS not yet pointed at Firebase | Workflow smoke-test will fail until DNS propagates. Acceptable; treat as a one-time post-apply task. |
| Region drift across siblings (mocktail = us-central1; many siblings default to europe-west2) | Hardcoded in `cd.yml` env block with a comment. Don't read from `vars.GCP_REGION` for mocktail. |

## Out of scope follow-ups

- Vertex AI migration for the email-auth `/api/ai` route (currently public
  Gemini API + key). Would let us drop `GEMINI_API_KEY` from env and use
  Workload Identity instead.
- `kills_initiated` field rename in `/healthz` JSON (memory.md "I1") — bundle
  with the next reactor touch-up.
- Migration tooling for any data left in `(default)` from prior testing.
- Backups / scheduled exports for the named `mocktail` Firestore DB.
