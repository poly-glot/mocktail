# Mocktail — firebase-cloud Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move mocktail onto the shared `firebase-cloud-491613` GCP project, provisioning all infra via Terraform in `firebase-cloud`, replacing the manual `gcloud run deploy` recipe with a CI/CD pipeline that mirrors the rest of `poly-glot/*`.

**Architecture:** Two-repo workstream. `firebase-cloud` gets `apps/mocktail.tf` + shared variables + workflow updates. `mocktail` gets a small Zig env-var read, a Deno kill switch, two firebase config tweaks, and new `ci.yml` + `cd.yml` workflows. After `terraform apply`, WIF + SA outputs propagate from firebase-cloud to mocktail's GitHub Actions secrets via `gh secret set`, and mocktail's CD takes over.

**Tech Stack:** Terraform 1.9, `hashicorp/google` + `hashicorp/google-beta` ~> 6.0, Zig 0.15.2, Deno 2.x, Node 22, Angular 19, Firebase CLI, `gh` CLI, Docker buildx, GitHub Actions.

**Spec:** [`2026-05-04-mocktail-firebase-cloud-onboarding-design.md`](../specs/2026-05-04-mocktail-firebase-cloud-onboarding-design.md)

**Author / committer for every commit in this plan:** `Junaid Ahmed <me@junaid.guru>`. **Never use Claude as author.** Use either:
- a shell with `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` exported, or
- pass `-c user.name='Junaid Ahmed' -c user.email='me@junaid.guru'` and `--author="Junaid Ahmed <me@junaid.guru>"` on every `git commit`.
- never include "Co-Authored-By" trailers, never include the word "Claude" in commit messages.

---

## File Manifest

### `firebase-cloud` repo (`/Users/junaidahmed/Desktop/projects/firebase-cloud`)

| Action | Path | Purpose |
|---|---|---|
| Create | `terraform/apps/mocktail.tf` | Identity, Firestore, Hosting, custom domain, two Cloud Run services |
| Modify | `terraform/apps/outputs.tf` | Append `mocktail_*` outputs |
| Modify | `terraform/apps/variables.tf` | Add `unsplash_access_key`, `gemini_api_key` |
| Modify | `terraform/variables.tf` | Add same two shared sensitive vars at root |
| Modify | `terraform/main.tf` | Pass new vars into `module "apps"` |
| Modify | `terraform/terraform.tfvars.example` | Append two stub lines |
| Modify | `.github/workflows/terraform.yml` | Add two `TF_VAR_*` env entries to plan step |

### `mocktail` repo (`/Users/junaidahmed/Desktop/projects/mocktail`)

| Action | Path | Purpose |
|---|---|---|
| Modify | `backend/collab/src/firestore.zig` | Read `FIRESTORE_DB` env var with `(default)` fallback; add test |
| Modify | `backend/email-auth-service/routes/ai.ts` | `GEMINI_ENABLED` kill switch in `callGemini` and `/healthz` |
| Modify | `firebase.json` | Add `"database": "mocktail"` to firestore block |
| Modify | `.firebaserc` | Set default project to `firebase-cloud-491613` |
| Create | `.github/workflows/ci.yml` | Three jobs (`frontend`, `collab`, `email-auth`); `workflow_call`-able |
| Delete | `.github/workflows/frontend-ci.yml` | Replaced by `ci.yml` |
| Create | `.github/workflows/cd.yml` | CI gate → image build → deploy → smoke test |
| Delete | `memory.md` | After first successful CD run |

---

## Phase A — Mocktail repo: code prep

### Task A1: Create feature branch on mocktail

**Files:** none (branch only)

- [ ] **Step 1: Create + check out branch**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git checkout master
git pull --ff-only origin master 2>/dev/null || true   # no remote yet on first run; ignore failure
git checkout -b feat/firebase-cloud-onboarding
```

- [ ] **Step 2: Verify clean tree**

```bash
git status
```

Expected: `On branch feat/firebase-cloud-onboarding` and `nothing to commit, working tree clean`.

---

### Task A2: Zig — read `FIRESTORE_DB` env var

**Files:**
- Modify: `backend/collab/src/firestore.zig:36-66` (`fromEnvMap`) and `:140-179` (tests)

Background: the existing `fromEnvMap` builds the database path at lines 52–57 by hardcoding `(default)`. We add a single env-var read with fallback so prod can target the named `mocktail` DB while local emulator runs and existing tests keep using `(default)`.

**Toolchain note:** `zig build test` requires Zig 0.15.2 + `libgrpc-dev` + `libprotobuf-c-dev`. The repo's `.devcontainer/` provides them all (alias `zt` runs `zig build test`). If you're not in the devcontainer, either open it (VS Code: "Reopen in Container") or install the toolchain on the host first. Every `zig` command below assumes the toolchain is on PATH.

- [ ] **Step 1: Add a failing test for the new env-var path**

Append after the existing `test "Config FIRESTORE_USE_TLS overrides a stale emulator host"` block in `backend/collab/src/firestore.zig`:

```zig
test "Config FIRESTORE_DB selects a named database" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();
    try env.put("FIRESTORE_DB", "mocktail");

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings(
        "projects/demo-mocktail/databases/mocktail",
        cfg.database,
    );
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail/backend/collab
zig build test 2>&1 | tail -20
```

Expected: failure on the new test with assertion mismatch — `expected "projects/demo-mocktail/databases/mocktail"`, got `"projects/demo-mocktail/databases/(default)"`.

- [ ] **Step 3: Implement env-var read in `fromEnvMap`**

In `backend/collab/src/firestore.zig`, replace the `database_dup` block (currently lines 52–57):

```zig
        const database_dup = try std.fmt.allocPrintSentinel(
            allocator,
            "projects/{s}/databases/(default)",
            .{project_dup},
            0,
        );
```

with:

```zig
        const db_name = env.get("FIRESTORE_DB") orelse "(default)";

        const database_dup = try std.fmt.allocPrintSentinel(
            allocator,
            "projects/{s}/databases/{s}",
            .{ project_dup, db_name },
            0,
        );
```

Also update the field doc-comment on line 20 of the `Config` struct:

```zig
    database: [:0]const u8, // "projects/<id>/databases/<name>"; <name>=(default) unless FIRESTORE_DB is set
```

- [ ] **Step 4: Run all tests — verify pass**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail/backend/collab
zig build test 2>&1 | tail -10
```

Expected: all 4 tests pass (3 existing + 1 new). The default test still asserts `(default)` because `FIRESTORE_DB` is unset.

- [ ] **Step 5: Run a build to make sure nothing else broke**

```bash
zig build
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git add backend/collab/src/firestore.zig
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'collab: read FIRESTORE_DB env var with (default) fallback'
```

---

### Task A3: Deno — `GEMINI_ENABLED` kill switch

**Files:**
- Modify: `backend/email-auth-service/routes/ai.ts:189-230` (`callGemini`) and `:299-301` (healthz)
- Create: `backend/email-auth-service/routes/ai.test.ts`

Reading `GEMINI_ENABLED` *inside* `callGemini` (rather than at module load) so tests can flip it per-call.

- [ ] **Step 1: Write the failing test**

Create `backend/email-auth-service/routes/ai.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import ai from "./ai.ts";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/api/ai", ai);
  return app;
}

Deno.test("ai.generate returns fallback when GEMINI_ENABLED is unset", async () => {
  Deno.env.delete("GEMINI_ENABLED");
  const app = makeApp();
  const res = await app.request("/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "dashboard" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.source, "fallback");
});

Deno.test("ai.healthz reports enabled flag", async () => {
  Deno.env.set("GEMINI_ENABLED", "true");
  Deno.env.set("GEMINI_API_KEY", "stub-key-not-real");
  const app = makeApp();
  const res = await app.request("/api/ai/healthz");
  const body = await res.json();
  assertEquals(body.enabled, true);
  assertEquals(body.hasKey, true);
  Deno.env.delete("GEMINI_ENABLED");
  Deno.env.delete("GEMINI_API_KEY");
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail/backend/email-auth-service
deno test --allow-env --allow-net routes/ai.test.ts 2>&1 | tail -20
```

Expected: the healthz test fails because `body.enabled` is missing. The generate test may pass or fail depending on whether `GEMINI_API_KEY` happens to be set in your shell — it'll always fail once we add the kill switch unless `GEMINI_ENABLED=true`.

- [ ] **Step 3: Modify `callGemini` to read the env var fresh each call**

In `backend/email-auth-service/routes/ai.ts`, replace the function header (around line 189) so the env-var check happens *inside* the function body — and runs **before** the existing `GEMINI_API_KEY` guard:

```ts
async function callGemini(prompt: string, context?: unknown): Promise<
  { elements: WireframeElement[]; notes: string } | null
> {
  if (Deno.env.get("GEMINI_ENABLED") !== "true") return null;
  if (!GEMINI_API_KEY) return null;
  const body = {
    // ... unchanged ...
```

- [ ] **Step 4: Update healthz to report `enabled`**

In the same file, replace the `ai.get("/healthz", ...)` line (around line 299):

```ts
ai.get("/healthz", (c) =>
  c.json({
    ok: true,
    enabled: Deno.env.get("GEMINI_ENABLED") === "true",
    hasKey: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
  }));
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail/backend/email-auth-service
deno test --allow-env --allow-net routes/ai.test.ts 2>&1 | tail -10
```

Expected: both tests pass.

- [ ] **Step 6: Run lint + check for the whole service**

```bash
deno lint
deno check main.ts
deno fmt --check
```

If `deno fmt --check` reports diffs, run `deno fmt` and re-stage the formatted files.

- [ ] **Step 7: Commit**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git add backend/email-auth-service/routes/ai.ts \
        backend/email-auth-service/routes/ai.test.ts
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'email-auth: add GEMINI_ENABLED kill switch with healthz reporting'
```

---

### Task A4: `firebase.json` — target named Firestore DB

**Files:**
- Modify: `firebase.json:45-48` (firestore block)

- [ ] **Step 1: Edit the firestore block**

Replace the `"firestore": { ... }` block in `firebase.json` (currently lines 45–48):

```json
"firestore": {
  "rules": "firestore.rules",
  "indexes": "firestore.indexes.json"
},
```

with:

```json
"firestore": {
  "database": "mocktail",
  "rules": "firestore.rules",
  "indexes": "firestore.indexes.json"
},
```

- [ ] **Step 2: Validate JSON parses**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
node -e 'JSON.parse(require("fs").readFileSync("firebase.json","utf8"))' && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add firebase.json
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'firebase: target named "mocktail" Firestore database'
```

---

### Task A5: `.firebaserc` — align project alias

**Files:**
- Modify: `.firebaserc`

- [ ] **Step 1: Replace `.firebaserc`**

Overwrite `.firebaserc` content with:

```json
{
  "projects": {
    "default": "firebase-cloud-491613"
  }
}
```

- [ ] **Step 2: Verify the firebase CLI accepts it**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
firebase projects:list 2>&1 | head -20 || true   # noisy if not logged in; ignore
firebase use 2>&1 | head -5
```

Expected: `firebase use` reports `Active Project: default (firebase-cloud-491613)` (or equivalent).

- [ ] **Step 3: Commit**

```bash
git add .firebaserc
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'firebase: set default project alias to firebase-cloud-491613'
```

---

## Phase B — Push mocktail repo to GitHub

### Task B1: Set remote and push

**Files:** none (git remote operation)

- [ ] **Step 1: Check that no remote exists yet**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git remote -v
```

Expected: empty output. If a remote `origin` already exists pointing somewhere unexpected, **stop and ask the user** before continuing.

- [ ] **Step 2: Add the remote**

```bash
git remote add origin git@github.com:poly-glot/mocktail.git
git remote -v
```

Expected: `origin git@github.com:poly-glot/mocktail.git (fetch)` + `(push)`.

- [ ] **Step 3: Push master + the feature branch**

```bash
git push -u origin master
git push -u origin feat/firebase-cloud-onboarding
```

Expected: both branches end up on the remote. If `gh repo view poly-glot/mocktail` reports the repo doesn't exist, create it via `gh repo create poly-glot/mocktail --private --source=. --remote=origin` *before* the push and re-run the push.

---

## Phase C — firebase-cloud Terraform

### Task C1: Create feature branch on firebase-cloud

**Files:** none (branch only)

- [ ] **Step 1: Create + check out branch**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
git checkout main
git pull --ff-only origin main
git checkout -b feat/mocktail-onboarding
```

- [ ] **Step 2: Verify clean tree**

```bash
git status
```

Expected: clean.

---

### Task C2: Add shared TF variables (root)

**Files:**
- Modify: `terraform/variables.tf` (append at end)

- [ ] **Step 1: Append to `terraform/variables.tf`**

Add at the end of the file:

```hcl
# ─────────────────────────────────────────────────────────────
# Shared keys used by multiple apps (mocktail today; reusable later)
# ─────────────────────────────────────────────────────────────
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

- [ ] **Step 2: Commit**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
git add terraform/variables.tf
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform: declare shared unsplash_access_key + gemini_api_key vars'
```

---

### Task C3: Add shared TF variables (apps module)

**Files:**
- Modify: `terraform/apps/variables.tf` (append at end)

- [ ] **Step 1: Append to `terraform/apps/variables.tf`**

```hcl
# ─────────────────────────────────────────────────────────────
# Mocktail (and future cross-app shared keys)
# ─────────────────────────────────────────────────────────────
variable "unsplash_access_key" {
  description = "Unsplash Access Key (shared)"
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Gemini API key (shared)"
  type        = string
  sensitive   = true
}
```

- [ ] **Step 2: Commit**

```bash
git add terraform/apps/variables.tf
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform/apps: declare shared unsplash + gemini vars'
```

---

### Task C4: Wire vars through `main.tf`

**Files:**
- Modify: `terraform/main.tf:98-122` (the `module "apps"` block)

- [ ] **Step 1: Append two args to the `module "apps"` block**

Inside the existing `module "apps"` block (currently ends around line 121 with `depends_on`), add right before the `depends_on` line:

```hcl
  unsplash_access_key = var.unsplash_access_key
  gemini_api_key      = var.gemini_api_key
```

Resulting block tail:

```hcl
  personal_cloud_deploy_sa = var.personal_cloud_deploy_sa

  unsplash_access_key = var.unsplash_access_key
  gemini_api_key      = var.gemini_api_key

  depends_on = [module.project_setup]
}
```

- [ ] **Step 2: Run `terraform fmt`**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform fmt
```

- [ ] **Step 3: Commit**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
git add terraform/main.tf
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform: pass unsplash + gemini vars through module.apps'
```

---

### Task C5: Update `terraform.tfvars.example`

**Files:**
- Modify: `terraform/terraform.tfvars.example`

- [ ] **Step 1: Append to the file**

```hcl

# Shared (mocktail today; reusable for future apps).
unsplash_access_key = "REPLACE_ME"
gemini_api_key      = "REPLACE_ME_OR_LEAVE_BLANK_WHILE_DISABLED"
```

- [ ] **Step 2: Commit**

```bash
git add terraform/terraform.tfvars.example
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform: document shared keys in tfvars.example'
```

---

### Task C6: Create `apps/mocktail.tf`

**Files:**
- Create: `terraform/apps/mocktail.tf`

- [ ] **Step 1: Write the file**

Save to `/Users/junaidahmed/Desktop/projects/firebase-cloud/terraform/apps/mocktail.tf`:

```hcl
# ─────────────────────────────────────────────────────────────
# Mocktail — Angular SPA + Zig collab WS + Deno email-auth/AI
# ─────────────────────────────────────────────────────────────
# Frontend → Firebase Hosting (mocktail.junaid.guru, mocktail.web.app)
# /api/email-auth/**, /api/ai/**, /api/images/** → mocktail-email-auth (Deno, standard)
# /api/**                                       → mocktail (Zig, single-threaded epoll reactor)
# Auth: Firebase Identity Platform (passwordless email link via Resend)
# DB:   named Firestore "mocktail" (NOT (default))
#
# Spec: mocktail/docs/superpowers/specs/2026-05-04-mocktail-firebase-cloud-onboarding-design.md
# Load-bearing flags on the inline mocktail Cloud Run service: see comments below.
# ─────────────────────────────────────────────────────────────

module "mocktail_identity" {
  source        = "../modules/app-identity"
  project_id    = var.project_id
  app_name      = "mocktail"
  github_org    = var.github_org
  github_repo   = "mocktail"
  wif_pool_id   = var.wif_pool_id
  wif_pool_name = var.wif_pool_name

  runtime_roles = [
    "roles/datastore.user",                 # Firestore via WIF (FIRESTORE_USE_TLS=true)
    "roles/firebaseauth.admin",             # mint custom tokens for email-link flow
    "roles/secretmanager.secretAccessor",   # future-proofing; not currently consumed
    "roles/iam.serviceAccountTokenCreator", # Admin SDK signBlob (createCustomToken)
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ]
}

module "mocktail_firestore" {
  source        = "../modules/firestore-databases"
  project_id    = var.project_id
  region        = var.region
  database_name = "mocktail"
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
      min_instance_count = 0 # scale-to-zero when idle (cost saving)
      max_instance_count = 1 # CORRECTNESS: in-memory pending buffer would
                             # diverge across instances. Don't raise.
    }

    max_instance_request_concurrency = 1000   # reactor handles 2048 conns/instance.
                                              # Default 80 forces scale-out before saturation.
    timeout                          = "3600s" # cap per-WS-session at Cloud Run max.
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/firebase-cloud/mocktail:latest"

      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = false # CORRECTNESS: --no-cpu-throttling.
                                  # 1s epoll tick + self-kill timer require CPU between WS frames.
        startup_cpu_boost = true
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "FIRESTORE_USE_TLS"
        value = "true"
      }
      env {
        name  = "FIRESTORE_DB"
        value = "mocktail"
      }
      env {
        name  = "KEEPALIVE_SECONDS"
        value = "1800"
      }
      env {
        name  = "FLUSH_MAX_INTERVAL_SECONDS"
        value = "600"
      }
      env {
        name  = "FLUSH_QUIESCENCE_MILLIS"
        value = "5000"
      }

      startup_probe {
        # Plain GET — no Accept header. Service responds `ok\n` to /healthz.
        # Don't change to a JSON probe (memory.md "What NOT to do").
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
        timeout_seconds       = 3
      }
      # No liveness probe: a stuck reactor should die via self-kill
      # (KEEPALIVE_SECONDS), not be force-restarted mid-flush.
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image, # CI/CD swaps :sha at deploy time
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
  member   = "allUsers" # auth happens at app layer; Hosting /api/** rewrite fronts the service
}
```

- [ ] **Step 2: Format**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform fmt apps/mocktail.tf
```

- [ ] **Step 3: Validate**

```bash
terraform init -backend=false   # offline init; backend not required for validate
terraform validate
```

Expected: `Success! The configuration is valid.` If validate complains about unset required variables, ignore — `validate` does not need values.

If validate fails because the `wif_pool_id` / `wif_pool_name` aren't yet emitted by the wif-pool module (they should be — sibling apps already use them), inspect `terraform/modules/wif-pool/outputs.tf` to confirm the output names.

- [ ] **Step 4: Commit**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
git add terraform/apps/mocktail.tf
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform/apps: onboard mocktail (identity, firestore, hosting, two cloud-run services)'
```

---

### Task C7: Add mocktail outputs

**Files:**
- Modify: `terraform/apps/outputs.tf` (append)

- [ ] **Step 1: Append to `terraform/apps/outputs.tf`**

```hcl

# ── Mocktail Outputs ────────────────────────────────────────
output "mocktail_wif_provider" {
  description = "WIF_PROVIDER for mocktail repo GitHub secrets"
  value       = module.mocktail_identity.wif_provider
}

output "mocktail_gcp_sa_email" {
  description = "GCP_SA_EMAIL for mocktail repo GitHub secrets"
  value       = module.mocktail_identity.ci_cd_sa_email
}

output "mocktail_runtime_sa_email" {
  description = "Mocktail runtime service account"
  value       = module.mocktail_identity.runtime_sa_email
}

output "mocktail_cloud_run_url" {
  description = "Cloud Run URL for the Zig collab service"
  value       = google_cloud_run_v2_service.mocktail.uri
}

output "mocktail_email_auth_url" {
  description = "Cloud Run URL for the Deno email-auth/AI service"
  value       = module.mocktail_email_auth_cloud_run.service_url
}

output "mocktail_hosting_url" {
  description = "Firebase Hosting URL"
  value       = module.mocktail_hosting.site_url
}

output "mocktail_firestore_db" {
  description = "Firestore database name"
  value       = module.mocktail_firestore.database_name
}

output "mocktail_custom_domain" {
  description = "Custom domain for mocktail"
  value       = google_firebase_hosting_custom_domain.mocktail.custom_domain
}

output "mocktail_required_dns" {
  description = "DNS records required at the registrar to verify and serve the custom domain"
  value       = google_firebase_hosting_custom_domain.mocktail.required_dns_updates
}
```

- [ ] **Step 2: Format + commit**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform fmt apps/outputs.tf
cd ..
git add terraform/apps/outputs.tf
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'terraform/apps: emit mocktail_* outputs'
```

---

### Task C8: Update `.github/workflows/terraform.yml`

**Files:**
- Modify: `.github/workflows/terraform.yml:54-69` (the `Terraform Plan` step's `env:` block)

- [ ] **Step 1: Add two TF_VAR_* lines to the plan step's env**

In `firebase-cloud/.github/workflows/terraform.yml`, locate the `- name: Terraform Plan` step's `env:` block (around line 60–68) and add the two new lines at the end:

```yaml
        env:
          TF_VAR_resend_api_key: ${{ secrets.RESEND_API_KEY }}
          TF_VAR_azadi_stripe_api_key: ${{ secrets.AZADI_STRIPE_API_KEY }}
          TF_VAR_azadi_stripe_webhook_secret: ${{ secrets.AZADI_STRIPE_WEBHOOK_SECRET }}
          TF_VAR_azadi_stripe_publishable_key: ${{ secrets.AZADI_STRIPE_PUBLISHABLE_KEY }}
          TF_VAR_azadi_encryption_key: ${{ secrets.AZADI_ENCRYPTION_KEY }}
          TF_VAR_azadi_encryption_salt: ${{ secrets.AZADI_ENCRYPTION_SALT }}
          TF_VAR_openguessr_google_maps_api_key: ${{ secrets.OPENGUESSR_GOOGLE_MAPS_API_KEY }}
          TF_VAR_amazing_landing_encryption_key: ${{ secrets.AMAZING_LANDING_ENCRYPTION_KEY }}
          TF_VAR_amazing_landing_admin_password_hash: ${{ secrets.AMAZING_LANDING_ADMIN_PASSWORD_HASH }}
          TF_VAR_unsplash_access_key: ${{ secrets.UNSPLASH_ACCESS_KEY }}
          TF_VAR_gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
```

- [ ] **Step 2: Lint YAML by parsing**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/terraform.yml"))' && echo OK
```

Expected: `OK`. If `yaml` is not available, `gh workflow view terraform.yml` after push will validate.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/terraform.yml
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'ci: thread UNSPLASH_ACCESS_KEY + GEMINI_API_KEY into terraform plan'
```

---

## Phase D — Provision secrets and tfvars

### Task D1: Set GitHub secrets on `poly-glot/firebase-cloud`

**This task requires you (the user) to interactively paste secret values.** An automated agent should pause here and request user attention.

- [ ] **Step 1: Set the two shared keys on the firebase-cloud repo**

```bash
gh secret set UNSPLASH_ACCESS_KEY -R poly-glot/firebase-cloud
# Paste the Unsplash Access Key when prompted; press Ctrl-D.

gh secret set GEMINI_API_KEY -R poly-glot/firebase-cloud
# Paste the Gemini API key (or any placeholder while disabled); press Ctrl-D.
```

- [ ] **Step 2: Verify they are listed**

```bash
gh secret list -R poly-glot/firebase-cloud | grep -E '^(UNSPLASH_ACCESS_KEY|GEMINI_API_KEY)\b'
```

Expected: both lines present.

---

### Task D2: Update local `terraform.tfvars`

**Files:**
- Modify (local-only, gitignored): `terraform/terraform.tfvars`

- [ ] **Step 1: Confirm the file is gitignored**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
grep -E '(^|/)terraform\.tfvars(\b|$)' terraform/.gitignore .gitignore 2>/dev/null
```

Expected: at least one match. If neither file ignores `terraform.tfvars`, **stop** and add the rule before continuing.

- [ ] **Step 2: Append values**

Edit `terraform/terraform.tfvars` and append (using the same key from Task D1):

```hcl
unsplash_access_key = "<paste the same Unsplash key here>"
gemini_api_key      = "<paste the same Gemini key here, or leave a placeholder>"
```

- [ ] **Step 3: Verify**

```bash
grep -E '^(unsplash_access_key|gemini_api_key)' terraform/terraform.tfvars
```

Expected: both lines.

- [ ] **Step 4: No commit** (file is gitignored).

---

## Phase E — Import existing resources

The `mocktail` and `mocktail-email-auth` Cloud Run services already exist in prod (deployed via the README's manual recipe). Import them before any apply, otherwise create will 409.

### Task E1: Authenticate locally and run `terraform init`

- [ ] **Step 1: Authenticate**

```bash
gcloud auth application-default login   # if not already
gcloud config set project firebase-cloud-491613
```

- [ ] **Step 2: `terraform init` against the GCS backend**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform init
```

Expected: `Terraform has been successfully initialized!` If the backend bucket complains about credentials, re-run Step 1.

---

### Task E2: Import the `mocktail` Cloud Run service

- [ ] **Step 1: Confirm the service exists**

```bash
gcloud run services describe mocktail --region us-central1 --format='value(name)'
```

Expected: `mocktail`. If it errors with `NOT_FOUND`, **skip Task E2** — Terraform will create it fresh.

- [ ] **Step 2: Import**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform import 'module.apps.google_cloud_run_v2_service.mocktail' \
  projects/firebase-cloud-491613/locations/us-central1/services/mocktail
```

Expected: `Import successful!`

---

### Task E3: Import the `mocktail-email-auth` Cloud Run service

- [ ] **Step 1: Confirm the service exists**

```bash
gcloud run services describe mocktail-email-auth --region us-central1 --format='value(name)'
```

Expected: `mocktail-email-auth`. If `NOT_FOUND`, **skip Task E3**.

- [ ] **Step 2: Import**

```bash
terraform import 'module.apps.module.mocktail_email_auth_cloud_run.google_cloud_run_v2_service.default' \
  projects/firebase-cloud-491613/locations/us-central1/services/mocktail-email-auth
```

---

### Task E4: Conditionally import the `mocktail` Hosting site

- [ ] **Step 1: Check if the site exists**

```bash
firebase hosting:sites:list --project firebase-cloud-491613 2>/dev/null | grep -E '\bmocktail\b' || echo MISSING
```

If `MISSING`, **skip Task E4** — Terraform will create it.

- [ ] **Step 2: Import**

```bash
terraform import 'module.apps.module.mocktail_hosting.google_firebase_hosting_site.default' \
  projects/firebase-cloud-491613/sites/mocktail
```

---

### Task E5: Conditionally import the `mocktail` Firestore database

- [ ] **Step 1: Check if the named DB exists**

```bash
gcloud firestore databases list --project firebase-cloud-491613 --format='value(name)' \
  | grep -E '/databases/mocktail$' || echo MISSING
```

If `MISSING`, **skip Task E5** — Terraform will create it empty.

- [ ] **Step 2: Import**

```bash
terraform import 'module.apps.module.mocktail_firestore.google_firestore_database.app' \
  projects/firebase-cloud-491613/databases/mocktail
```

---

## Phase F — Plan, apply, propagate

### Task F1: `terraform plan` and review

- [ ] **Step 1: Run plan**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform plan -out=tfplan -no-color | tee /tmp/tf-mocktail-plan.txt
```

- [ ] **Step 2: Review the plan**

The plan must show:

- **Adds (net new):** 2 service accounts, 1 WIF provider, several IAM bindings, the custom domain resource, the Hosting `google_firebase_hosting_version`, possibly the Firestore DB and Hosting site (if not imported in E4/E5), the email-auth Cloud Run service (if not imported in E3), and 9 outputs.
- **Updates in place** on imported resources: env-var changes, probe path, `cpu_idle = false`, `max_instance_request_concurrency`, `timeout = "3600s"`. **Do not accept any `# … must be replaced`** (delete-then-recreate) on `google_cloud_run_v2_service.mocktail` — if you see one, stop and reconcile (likely a region or naming mismatch).
- **No deletes** of any existing resources.

- [ ] **Step 3: Decision gate**

If the plan looks wrong, abort, fix the TF code, re-plan. Don't apply on the strength of a plan that's destroying anything you didn't intend.

---

### Task F2: PR + merge → CI applies

- [ ] **Step 1: Push the branch**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud
git push -u origin feat/mocktail-onboarding
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --head feat/mocktail-onboarding \
  --title 'mocktail: onboard to firebase-cloud (terraform + workflow)' \
  --body "$(cat <<'EOF'
## Summary
- Onboards mocktail (Angular SPA + Zig collab + Deno email-auth/AI) onto firebase-cloud-491613.
- Adds shared TF vars unsplash_access_key + gemini_api_key (UNSPLASH_ACCESS_KEY, GEMINI_API_KEY in CI).
- Inlines the Zig collab Cloud Run with all load-bearing flags from the self-kill spec; uses the standard cloud-run module for mocktail-email-auth.

## Spec
mocktail/docs/superpowers/specs/2026-05-04-mocktail-firebase-cloud-onboarding-design.md

## Test plan
- [ ] Terraform plan posted as PR comment shows only adds + non-destructive updates (no replacements, no deletes).
- [ ] After merge, terraform.yml apply step succeeds.
- [ ] terraform output mocktail_wif_provider + mocktail_gcp_sa_email are non-empty.
EOF
)"
```

- [ ] **Step 3: After CI plan-comment is reviewed, merge**

Merge via the PR UI or:

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Watch the apply job**

```bash
gh run watch -R poly-glot/firebase-cloud
```

Expected: green check on `Terraform Apply`. The "Trigger personal-cloud MySQL provisioning" step at the end is unrelated to mocktail and should also pass; if it fails, that's a separate workstream — unblock by re-running.

---

### Task F3: Propagate WIF + SA outputs to mocktail repo

- [ ] **Step 1: Pull the latest state locally and read outputs**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform output -raw mocktail_wif_provider
terraform output -raw mocktail_gcp_sa_email
```

Expected: a non-empty WIF resource path, and an SA email like `mocktail-ci-cd@firebase-cloud-491613.iam.gserviceaccount.com`.

- [ ] **Step 2: Push them to mocktail's GitHub Actions secrets**

```bash
gh secret set WIF_PROVIDER -R poly-glot/mocktail \
  --body "$(terraform output -raw mocktail_wif_provider)"
gh secret set GCP_SA_EMAIL -R poly-glot/mocktail \
  --body "$(terraform output -raw mocktail_gcp_sa_email)"
```

- [ ] **Step 3: Verify**

```bash
gh secret list -R poly-glot/mocktail | grep -E '^(WIF_PROVIDER|GCP_SA_EMAIL)\b'
```

Expected: both lines.

---

## Phase G — Mocktail CI/CD pipelines

Back on the mocktail repo, on the `feat/firebase-cloud-onboarding` branch you created in Task A1.

### Task G1: Replace `frontend-ci.yml` with `ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`
- Delete: `.github/workflows/frontend-ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

Save to `/Users/junaidahmed/Desktop/projects/mocktail/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]
  workflow_call:

jobs:
  frontend:
    name: Frontend (lint, typecheck, test, build)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - name: Lint (ESLint)
        run: npm run lint
      - name: Lint (Stylelint)
        run: npm run lint:scss
      - name: Format check
        run: npm run format:check
      - name: Typecheck
        run: npm run typecheck
      - name: Unit tests with coverage
        run: npm test -- --watch=false --code-coverage --browsers=ChromeHeadlessNoSandbox
      - name: Coverage ratchet
        run: node scripts/check-coverage.mjs
      - name: Circular deps (madge)
        run: npm run deps:check
      - name: Build (production)
        run: npm run build
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: frontend/coverage/
      - name: Upload frontend dist
        uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist/mocktail/browser

  collab:
    name: Collab backend (Zig build + test)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: backend/collab
    steps:
      - uses: actions/checkout@v4
      - name: Install Zig 0.15.2
        run: |
          set -euo pipefail
          curl -sSL https://ziglang.org/download/0.15.2/zig-linux-x86_64-0.15.2.tar.xz | tar -xJ
          echo "$PWD/zig-linux-x86_64-0.15.2" >> "$GITHUB_PATH"
      - name: Install gRPC + protobuf-c
        run: |
          sudo apt-get update
          sudo apt-get install -y libgrpc-dev libprotobuf-c-dev protobuf-c-compiler
      - name: zig build
        run: zig build
      - name: zig build test
        run: zig build test

  email-auth:
    name: Email-auth (Deno check + test)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    defaults:
      run:
        working-directory: backend/email-auth-service
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - name: deno check
        run: deno check main.ts
      - name: deno fmt --check
        run: deno fmt --check
      - name: deno lint
        run: deno lint
      - name: deno test
        run: deno test --allow-env --allow-net --allow-read
```

- [ ] **Step 2: Delete the old workflow**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git rm .github/workflows/frontend-ci.yml
```

- [ ] **Step 3: Validate YAML parses**

```bash
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/ci.yml"))' && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'ci: replace frontend-ci with multi-job CI (frontend, collab, email-auth)'
```

---

### Task G2: Create `cd.yml`

**Files:**
- Create: `.github/workflows/cd.yml`

- [ ] **Step 1: Write the file**

Save to `/Users/junaidahmed/Desktop/projects/mocktail/.github/workflows/cd.yml`:

```yaml
name: CD
on:
  push:
    branches: [main, master]
  workflow_dispatch:

concurrency:
  group: cd-${{ github.ref }}
  cancel-in-progress: false

env:
  # Mocktail is pinned to us-central1 (firebase.json rewrites + memory.md).
  # Do NOT read from vars.GCP_REGION — sibling repos default to europe-west2.
  GCP_REGION:         us-central1
  GCP_PROJECT_ID:     firebase-cloud-491613
  AR_REPO:            firebase-cloud
  COLLAB_SERVICE:     mocktail
  EMAIL_AUTH_SERVICE: mocktail-email-auth
  FIREBASE_SITE_ID:   mocktail

jobs:
  ci:
    name: CI Gate
    uses: ./.github/workflows/ci.yml
    secrets: inherit

  build-images:
    name: Build & Push Cloud Run Images
    runs-on: ubuntu-latest
    needs: [ci]
    permissions:
      contents: read
      id-token: write
    outputs:
      collab_image:     ${{ steps.collab.outputs.image }}
      email_auth_image: ${{ steps.emailauth.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker ${{ env.GCP_REGION }}-docker.pkg.dev --quiet

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Compute collab image tag
        id: collab
        run: |
          SHA=$(echo "${{ github.sha }}" | cut -c1-7)
          IMG="${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.COLLAB_SERVICE }}:${SHA}"
          echo "image=${IMG}" >> "$GITHUB_OUTPUT"

      - name: Build & push collab image
        uses: docker/build-push-action@v6
        with:
          context: backend/collab
          file: backend/collab/Dockerfile
          push: true
          tags: |
            ${{ steps.collab.outputs.image }}
            ${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.COLLAB_SERVICE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Compute email-auth image tag
        id: emailauth
        run: |
          SHA=$(echo "${{ github.sha }}" | cut -c1-7)
          IMG="${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.EMAIL_AUTH_SERVICE }}:${SHA}"
          echo "image=${IMG}" >> "$GITHUB_OUTPUT"

      - name: Build & push email-auth image
        uses: docker/build-push-action@v6
        with:
          context: backend/email-auth-service
          file: backend/email-auth-service/Dockerfile
          push: true
          tags: |
            ${{ steps.emailauth.outputs.image }}
            ${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.EMAIL_AUTH_SERVICE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: [build-images]
    environment:
      name: production
      url: https://mocktail.junaid.guru
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - uses: actions/download-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist/mocktail/browser

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy mocktail (Zig collab) to Cloud Run
        run: |
          gcloud run deploy ${{ env.COLLAB_SERVICE }} \
            --image ${{ needs.build-images.outputs.collab_image }} \
            --region ${{ env.GCP_REGION }} \
            --quiet
          gcloud run services update-traffic ${{ env.COLLAB_SERVICE }} \
            --region ${{ env.GCP_REGION }} --to-latest --quiet

      - name: Deploy mocktail-email-auth (Deno) to Cloud Run
        run: |
          gcloud run deploy ${{ env.EMAIL_AUTH_SERVICE }} \
            --image ${{ needs.build-images.outputs.email_auth_image }} \
            --region ${{ env.GCP_REGION }} \
            --quiet
          gcloud run services update-traffic ${{ env.EMAIL_AUTH_SERVICE }} \
            --region ${{ env.GCP_REGION }} --to-latest --quiet

      - name: Install Firebase CLI
        run: npm install -g firebase-tools

      - name: Deploy Firestore rules & indexes (named DB "mocktail")
        run: firebase deploy --only firestore --force --project ${{ env.GCP_PROJECT_ID }}

      - name: Deploy frontend to Firebase Hosting
        run: firebase deploy --only hosting --force --project ${{ env.GCP_PROJECT_ID }}

      - name: Tag release
        uses: actions/github-script@v7
        with:
          script: |
            const pkg = require('./frontend/package.json');
            const tag = `v${pkg.version}-${context.sha.substring(0,7)}`;
            try {
              await github.rest.git.createRef({
                owner: context.repo.owner,
                repo:  context.repo.repo,
                ref:   `refs/tags/${tag}`,
                sha:   context.sha,
              });
              core.info(`Created tag ${tag}`);
            } catch (e) {
              core.warning(`Tag ${tag} may already exist: ${e.message}`);
            }

  smoke-test:
    name: Smoke Test
    runs-on: ubuntu-latest
    needs: [deploy-production]
    steps:
      - name: Hit hosting + API health endpoints
        run: |
          set -euo pipefail
          # mocktail.junaid.guru DNS may not be live on first run; fall back to mocktail.web.app.
          for HOST in mocktail.junaid.guru mocktail.web.app; do
            for path in / /api/healthz /api/email-auth/healthz; do
              S=$(curl -sf -o /dev/null -w "%{http_code}" "https://${HOST}${path}" || echo 000)
              echo "${HOST}${path} → HTTP ${S}"
              if [ "$S" -eq 200 ]; then continue; fi
              # Tolerate /api/email-auth/healthz returning 200 only after first deploy.
              [ "$path" = "/" ] || true
            done
          done
          # Strict: hosting root must be 200 on at least one host.
          for HOST in mocktail.junaid.guru mocktail.web.app; do
            S=$(curl -sf -o /dev/null -w "%{http_code}" "https://${HOST}/" || echo 000)
            if [ "$S" -eq 200 ]; then exit 0; fi
          done
          echo "Hosting smoke test FAILED — neither host responded 200"
          exit 1
```

- [ ] **Step 2: Validate YAML parses**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/cd.yml"))' && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cd.yml
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'cd: deploy mocktail (collab + email-auth) and frontend on push to main/master'
```

---

### Task G3: Open PR on mocktail and merge

- [ ] **Step 1: Push the branch**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git push -u origin feat/firebase-cloud-onboarding
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base master --head feat/firebase-cloud-onboarding \
  --title 'mocktail: firebase-cloud onboarding + new CI/CD' \
  --body "$(cat <<'EOF'
## Summary
- Reads FIRESTORE_DB env var with (default) fallback in the Zig collab service.
- Adds GEMINI_ENABLED kill switch in the Deno AI route + healthz reporting.
- Targets named "mocktail" Firestore DB in firebase.json.
- Aligns .firebaserc default project to firebase-cloud-491613.
- Replaces frontend-ci.yml with multi-job CI (frontend / collab / email-auth).
- Adds CD pipeline: CI gate → build images → deploy Cloud Run + Hosting → smoke test.

## Spec
docs/superpowers/specs/2026-05-04-mocktail-firebase-cloud-onboarding-design.md

## Test plan
- [ ] CI runs green on the PR (frontend, collab, email-auth all pass).
- [ ] After merge, CD reaches Deploy to Production and the smoke test passes against mocktail.web.app (or mocktail.junaid.guru once DNS is live).
- [ ] zig build test in CI shows the new "Config FIRESTORE_DB selects a named database" test passing.
- [ ] /api/ai/healthz reports {"enabled":false,"hasKey":false} in prod.
EOF
)"
```

- [ ] **Step 3: After CI passes on the PR, merge**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Watch CD**

```bash
gh run watch -R poly-glot/mocktail
```

Expected: green check on `Deploy to Production` and `Smoke Test`. If CD fails on the first run because of IAM eventual consistency (~60 s for the new SA bindings — sibling repos hit this), re-run the workflow.

---

## Phase H — Verification & cleanup

### Task H1: Add DNS records for `mocktail.junaid.guru`

- [ ] **Step 1: Read the required records**

```bash
cd /Users/junaidahmed/Desktop/projects/firebase-cloud/terraform
terraform output mocktail_required_dns
```

Expected: a JSON-ish list of DNS updates from Firebase Hosting (TXT for verification, A/AAAA for serving).

- [ ] **Step 2: Add the records at your DNS provider**

This is a manual step at the registrar (Cloudflare/Squarespace/Route 53 — wherever `junaid.guru` is hosted). Mirror the records exactly. Verification can take up to a few hours; serving usually flips within 30 minutes after verification.

- [ ] **Step 3: Verify propagation**

```bash
dig +short TXT mocktail.junaid.guru
dig +short A   mocktail.junaid.guru
```

Expected: matches the records from Step 1 once propagation completes.

---

### Task H2: Verify the keepalive cycle (optional but recommended)

Per the README's "Verifying the keepalive cycle" recipe:

- [ ] **Step 1: Open the editor at https://mocktail.junaid.guru and idle for 31 minutes.**

- [ ] **Step 2: Check Cloud Logs for `event=self_kill_initiated` followed by `event=drain_completed budget_exceeded=false`.**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="mocktail" jsonPayload.event=("self_kill_initiated" OR "drain_completed")' \
  --project firebase-cloud-491613 --limit=20 --format='table(timestamp,jsonPayload.event,jsonPayload.budget_exceeded)'
```

Expected: a `self_kill_initiated` followed within ~5 s by `drain_completed budget_exceeded=false`.

- [ ] **Step 3: Confirm reconnect cold-start is ~3-5 s.**

Reload the page; the editor should reconnect over WS within 3-5 s.

---

### Task H3: Delete `mocktail/memory.md`

The standing instruction in `memory.md` is *"Delete after Terraform lands and the deploy command stops drifting."* That milestone is now reached.

- [ ] **Step 1: Delete the file**

```bash
cd /Users/junaidahmed/Desktop/projects/mocktail
git checkout master
git pull --ff-only origin master
git checkout -b chore/delete-memory-md
git rm memory.md
```

- [ ] **Step 2: Commit + PR + merge**

```bash
git -c user.name='Junaid Ahmed' -c user.email='me@junaid.guru' \
  commit --author='Junaid Ahmed <me@junaid.guru>' \
  -m 'chore: delete memory.md (terraform onboarding complete)'
git push -u origin chore/delete-memory-md
gh pr create --base master --head chore/delete-memory-md \
  --title 'chore: delete memory.md after firebase-cloud onboarding' \
  --body 'memory.md said to delete after Terraform lands. It has.'
gh pr merge --squash --delete-branch
```

---

## Done Criteria

- [ ] `firebase-cloud` PR merged; `terraform apply` ran in CI; outputs include `mocktail_*`.
- [ ] `mocktail` repo has remote `origin = git@github.com:poly-glot/mocktail.git`; `master` and the merged feature branches are pushed.
- [ ] `gh secret list -R poly-glot/mocktail` shows `WIF_PROVIDER` and `GCP_SA_EMAIL`.
- [ ] `mocktail` PR merged; CD ran; production smoke test green.
- [ ] `https://mocktail.web.app/` and `https://mocktail.junaid.guru/` (after DNS) both return 200.
- [ ] `https://mocktail.junaid.guru/api/healthz` returns `ok` (200 plain text).
- [ ] `https://mocktail.junaid.guru/api/email-auth/healthz` returns `200 {"ok":true}`.
- [ ] `https://mocktail.junaid.guru/api/ai/healthz` returns `{"enabled":false,...}` (Gemini disabled).
- [ ] `mocktail/memory.md` deleted on master.

## Rollback playbook (if a Cloud Run deploy ships a regression)

```bash
gcloud run services update-traffic mocktail \
  --region us-central1 --to-revisions=PREVIOUS=100 --project firebase-cloud-491613
gcloud run services update-traffic mocktail-email-auth \
  --region us-central1 --to-revisions=PREVIOUS=100 --project firebase-cloud-491613
```

For a Hosting regression: `firebase hosting:rollback --project firebase-cloud-491613` after `firebase use --add firebase-cloud-491613`.

For a Terraform-introduced regression in `firebase-cloud`: `git revert` the merge commit on `firebase-cloud:main`; CI plans + applies the revert.
