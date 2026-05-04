# Track 1 — CI & Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock in strict ESLint rules, a fail-fast CI workflow, and a coverage ratchet — then clear all 26 existing strict-rule violations and flip every rule to `error`.

**Architecture:** Two phases under one plan. Phase 1.1 ships the CI skeleton (strict rules as `warn`, GitHub Actions, coverage ratchet, script split) so that from day one every PR is checked and the warning surface is visible. Phase 1.2 fixes the 26 violations one rule group at a time; the PR that lands the last fix for a given rule flips that rule from `warn` to `error` in the same commit. No per-file overrides ever.

**Tech Stack:** ESLint 9 + typescript-eslint, Prettier, Stylelint, madge, Husky + lint-staged, Karma + karma-coverage (istanbul json-summary reporter), GitHub Actions, Node 20.

**Spec:** `frontend/docs/superpowers/specs/2026-04-22-track1-ci-quality-gates-design.md`

---

## Repo baseline at plan-start

- Primary working dir: `/workspace/frontend` (tracked branch: `master`, PR target: `main`).
- `package.json` already has: `husky`, `lint-staged`, `madge`, `stylelint`, `stylelint-config-standard-scss`, `prettier`, `typescript-eslint`, `eslint`.
- `.prettierrc.json`, `.prettierignore`, `.stylelintrc.json`, `.husky/pre-commit` all exist and are production-ready.
- `eslint.config.js` exists with a TS block configured for the project's `tsconfig.json` via `projectService: true`.
- `karma.conf.js` emits HTML + text-summary coverage into `./coverage/`. No JSON summary yet.
- No `.github/` directory, no `scripts/` directory.
- `lint` script currently bundles eslint + stylelint + madge into a single shell command — we will split it.

All Phase 1.1 tasks assume commands run from `/workspace/frontend`.

---

## File structure

**Phase 1.1 creates:**

- `.github/workflows/ci.yml` — GitHub Actions pipeline.
- `scripts/check-coverage.mjs` — per-package coverage ratchet.
- `coverage-baseline.json` — committed floor.

**Phase 1.1 modifies:**

- `package.json` — split scripts, add strict rules helper scripts.
- `eslint.config.js` — strict rules as `warn`.
- `karma.conf.js` — add `json-summary` reporter and set `coverageReporter.subdir` to `.`.

**Phase 1.2 modifies** (in order of PRs):

- `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts` (params + length + complexity).
- `packages/editor/src/services/element-factory/element-factory.service.ts` (params).
- `packages/tenant/src/services/tenant/tenant.service.ts` (length + complexity).
- `packages/projects/src/services/project-api/project-api.service.ts` (split into facade + 5 sub-services).
- `packages/editor/src/components/editor/editor.component.ts` (split + complexity).
- `packages/editor/src/services/pointer-orchestrator/pointer-orchestrator.service.ts` (complexity).
- `packages/editor/src/directives/editor-shortcuts/editor-shortcuts.directive.ts` (complexity).
- `packages/collab/src/services/collab/collab.service.ts` (complexity).
- `packages/editor/src/services/ai-orchestrator/ai-orchestrator.service.ts` (complexity).
- `packages/editor/src/services/layer-order/layer-order.service.ts` (complexity).
- `packages/core/src/firebase/firebase.service.ts` (complexity).

**Phase 1.2 creates:**

- `packages/projects/src/services/project-api/project-doc.api.ts`
- `packages/projects/src/services/project-api/page.api.ts`
- `packages/projects/src/services/project-api/element.api.ts`
- `packages/projects/src/services/project-api/comment.api.ts`
- `packages/projects/src/services/project-api/activity.api.ts`
- `packages/editor/src/services/canvas-events/canvas-events.service.ts`
- `packages/editor/src/components/editor-inspector/editor-inspector.component.{ts,html,scss,spec.ts}`

---

# Phase 1.1 — CI & tooling skeleton

## Task 1: Split the `lint` script into fail-fast pieces

**Why:** CI wants to fail fast on the cheapest check. Bundling eslint + stylelint + madge into one script means a broken SCSS selector hides ESLint errors until all three finish.

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Replace the `lint` block in `package.json` with split scripts**

Find in `package.json`:

```json
"lint": "eslint . && stylelint \"packages/**/*.scss\" \"src/**/*.scss\" && madge --circular --extensions ts ./src ./packages",
"lint:fix": "eslint . --fix && stylelint \"packages/**/*.scss\" \"src/**/*.scss\" --fix",
```

Replace with:

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix && stylelint \"packages/**/*.scss\" \"src/**/*.scss\" --fix",
"lint:scss": "stylelint \"packages/**/*.scss\" \"src/**/*.scss\"",
"lint:scss:fix": "stylelint \"packages/**/*.scss\" \"src/**/*.scss\" --fix",
"deps:check": "madge --circular --extensions ts ./src ./packages",
"typecheck": "tsc -p tsconfig.json --noEmit",
"verify": "npm run lint && npm run lint:scss && npm run format:check && npm run typecheck && npm test -- --watch=false && npm run deps:check && node scripts/check-coverage.mjs",
```

(Keep `ng`, `start`, `build`, `watch`, `test`, `e2e*`, `format`, `format:check`, `prepare` as-is.)

- [ ] **Step 2: Run the new scripts individually to confirm they work on master**

Run each in turn:

```bash
npm run lint
npm run lint:scss
npm run deps:check
npm run typecheck
```

Expected: each exits 0 (unchanged behavior from what was previously bundled). `npm run verify` will fail at the `check-coverage.mjs` step because that file doesn't exist yet — that's fine, we add it in Task 4.

- [ ] **Step 3: Commit**

```bash
git add package.json
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "chore(ci): split lint script into fail-fast pieces"
```

---

## Task 2: Add strict ESLint rules as `warn`

**Why:** Get measurement data in PR comments from day one without blocking any merges until Phase 1.2 clears each rule.

**Files:**

- Modify: `eslint.config.js`

- [ ] **Step 1: Add the rules block**

Find the `rules: {` block in the main TS config (around line 33):

```js
    rules: {
      '@angular-eslint/component-selector': [
```

Insert these rules immediately inside `rules: {` (above `@angular-eslint/component-selector`):

```js
      complexity: ['warn', 10],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
```

- [ ] **Step 2: Run eslint and confirm exactly 26 warnings**

Run:

```bash
npm run lint 2>&1 | tail -40
```

Expected last line: `✖ 26 problems (0 errors, 26 warnings)` (counts may include other warnings if unrelated rules fire; in that case confirm the 26 strict-rule warnings are present by filtering).

To filter strict-rule warnings only:

```bash
npm run lint 2>&1 | grep -E '(complexity|max-lines|max-lines-per-function|max-depth|max-params)' | wc -l
```

Expected: `26`

- [ ] **Step 3: Ensure `.spec.ts` override silences them for tests**

Still in `eslint.config.js`, find the spec-file override block (around line 57):

```js
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-restricted-globals': ['error', 'fdescribe', 'fit', 'xdescribe', 'xit'],
    },
  },
```

Add these four lines inside its `rules:`:

```js
      complexity: 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-params': 'off',
```

- [ ] **Step 4: Re-run lint; confirm zero new spec warnings and the same 26 source warnings**

```bash
npm run lint 2>&1 | grep -E '(complexity|max-lines|max-lines-per-function|max-depth|max-params)' | wc -l
```

Expected: `26` (unchanged — no spec files contribute).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "chore(lint): add strict complexity/size rules as warn"
```

---

## Task 3: Add json-summary coverage reporter to Karma

**Why:** The ratchet script reads `coverage/coverage-summary.json` — istanbul emits it via the `json-summary` reporter, which is not on by default.

**Files:**

- Modify: `karma.conf.js`

- [ ] **Step 1: Add the reporter**

Find in `karma.conf.js`:

```js
    coverageReporter: {
      dir: path.join(__dirname, './coverage'),
      subdir: '.',
      reporters: [{ type: 'text-summary' }, { type: 'html' }],
    },
```

Replace the `reporters` array with:

```js
      reporters: [
        { type: 'text-summary' },
        { type: 'html' },
        { type: 'json-summary', file: 'coverage-summary.json' },
        { type: 'json', file: 'coverage-final.json' },
      ],
```

- [ ] **Step 2: Run the tests and confirm the summary file appears**

```bash
npm test -- --watch=false --code-coverage
ls coverage/
```

Expected files present: `coverage-summary.json`, `coverage-final.json`, `index.html`.

- [ ] **Step 3: Inspect the summary to confirm per-file granularity**

```bash
node -e "const s = require('./coverage/coverage-summary.json'); console.log(Object.keys(s).slice(0, 5));"
```

Expected: `total` plus absolute paths to covered source files under `/workspace/frontend/packages/...`.

- [ ] **Step 4: Commit**

```bash
git add karma.conf.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "chore(ci): emit json-summary + json coverage reporters"
```

---

## Task 4: Write `scripts/check-coverage.mjs` (the ratchet)

**Why:** Fail CI if any package's coverage drops more than 0.5%. Fail CI with a friendly "commit the updated baseline" message if any package's coverage rises ≥ 1% — so ratcheting is a visible commit in history.

**Files:**

- Create: `scripts/check-coverage.mjs`

- [ ] **Step 1: Create the scripts directory and the file**

```bash
mkdir -p scripts
```

Then create `scripts/check-coverage.mjs` with this content:

```js
#!/usr/bin/env node
// Per-package coverage ratchet. Reads coverage/coverage-summary.json, groups
// per-file istanbul totals by the top-level "packages/<name>" directory, and
// compares each metric to coverage-baseline.json.
//
// Exit codes:
//   0 — every package within tolerance and below ratchet threshold.
//   1 — at least one metric dropped more than TOLERANCE_DROP; CI must fail.
//   2 — at least one metric rose >= RATCHET_RISE; coverage-baseline.json was
//       rewritten and the developer must commit it. CI must fail so the
//       commit gets created.
//
// The script is intentionally dependency-free so it can run in CI without
// an extra install.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = process.cwd();
const SUMMARY = resolve(ROOT, 'coverage/coverage-summary.json');
const BASELINE = resolve(ROOT, 'coverage-baseline.json');

const TOLERANCE_DROP = 0.5; // percent; drops within tolerance pass
const RATCHET_RISE = 1.0; // percent; rises >= this trigger a ratchet
const METRICS = ['statements', 'branches', 'functions', 'lines'];

if (!existsSync(SUMMARY)) {
  console.error(`[check-coverage] ${SUMMARY} not found — run "npm test -- --code-coverage" first.`);
  process.exit(1);
}
if (!existsSync(BASELINE)) {
  console.error(
    `[check-coverage] ${BASELINE} not found — run "node scripts/check-coverage.mjs --init" to bootstrap.`,
  );
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

// Group file-level entries into per-package aggregates.
// A "package" is the path segment directly under "packages/".
const buckets = {};
for (const [filePath, totals] of Object.entries(summary)) {
  if (filePath === 'total') continue;
  const rel = relative(ROOT, filePath);
  const match = /^packages\/([^/]+)\//.exec(rel);
  if (!match) continue;
  const pkg = `packages/${match[1]}`;
  const bucket = (buckets[pkg] ||= Object.fromEntries(
    METRICS.map((m) => [m, { total: 0, covered: 0 }]),
  ));
  for (const m of METRICS) {
    bucket[m].total += totals[m].total;
    bucket[m].covered += totals[m].covered;
  }
}

const current = {};
for (const [pkg, agg] of Object.entries(buckets)) {
  current[pkg] = {};
  for (const m of METRICS) {
    const pct = agg[m].total === 0 ? 100 : (agg[m].covered / agg[m].total) * 100;
    current[pkg][m] = Number(pct.toFixed(2));
  }
}

let hadDrop = false;
let hadRatchet = false;
const newBaseline = structuredClone(baseline);

for (const pkg of Object.keys(current)) {
  if (!baseline[pkg]) {
    console.error(`[check-coverage] unknown package "${pkg}" — add a baseline entry and commit.`);
    hadDrop = true;
    continue;
  }
  for (const m of METRICS) {
    const base = baseline[pkg][m];
    const now = current[pkg][m];
    const delta = now - base;
    if (delta < -TOLERANCE_DROP) {
      console.error(
        `[check-coverage] ${pkg} ${m}: ${base}% → ${now}% (${delta.toFixed(2)}%) — FAIL`,
      );
      hadDrop = true;
    } else if (delta >= RATCHET_RISE) {
      console.warn(
        `[check-coverage] ${pkg} ${m}: ${base}% → ${now}% (+${delta.toFixed(2)}%) — RATCHET`,
      );
      newBaseline[pkg][m] = now;
      hadRatchet = true;
    }
  }
}

// Packages in baseline but absent from current output (e.g. package removed).
for (const pkg of Object.keys(baseline)) {
  if (!current[pkg]) {
    console.error(
      `[check-coverage] baseline package "${pkg}" has no coverage output — remove from baseline if intentional.`,
    );
    hadDrop = true;
  }
}

if (hadRatchet && !hadDrop) {
  writeFileSync(BASELINE, JSON.stringify(newBaseline, null, 2) + '\n');
  console.error(
    '[check-coverage] coverage rose — coverage-baseline.json updated; commit it and re-run CI.',
  );
  process.exit(2);
}
if (hadDrop) process.exit(1);
console.log('[check-coverage] OK');
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/check-coverage.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/check-coverage.mjs
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "chore(ci): add per-package coverage ratchet script"
```

---

## Task 5: Capture the coverage baseline

**Why:** The ratchet needs a starting floor. Run tests once, let the script emit, commit the file.

**Files:**

- Create: `coverage-baseline.json`

- [ ] **Step 1: Run the full test suite with coverage**

```bash
npm test -- --watch=false --code-coverage
```

Expected: all tests pass (editor package at 609 passing per session memory; pre-existing failures in shell/landing/tenantGuard are acceptable — they exist on master). If new failures appear, stop and investigate before baselining.

- [ ] **Step 2: Generate the initial baseline from the summary**

Run this one-liner to build `coverage-baseline.json` from the summary:

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
const s = JSON.parse(readFileSync('coverage/coverage-summary.json','utf8'));
const METRICS = ['statements','branches','functions','lines'];
const buckets = {};
for (const [fp,t] of Object.entries(s)) {
  if (fp==='total') continue;
  const m = /packages\\/([^/]+)\\//.exec(relative(process.cwd(), fp));
  if (!m) continue;
  const pkg = 'packages/'+m[1];
  const b = buckets[pkg] ||= Object.fromEntries(METRICS.map(k=>[k,{total:0,covered:0}]));
  for (const k of METRICS){ b[k].total+=t[k].total; b[k].covered+=t[k].covered; }
}
const out = {};
for (const [pkg,agg] of Object.entries(buckets)) {
  out[pkg] = Object.fromEntries(METRICS.map(k=>[k, Number(((agg[k].covered/(agg[k].total||1))*100).toFixed(2))]));
}
writeFileSync('coverage-baseline.json', JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
"
```

Expected output: a JSON object with one entry per package directory found under `packages/` — typically `packages/editor`, `packages/projects`, `packages/collab`, `packages/core`, `packages/tenant`, `packages/cdk`, `packages/auth`, `packages/shell`. Each entry has four metric percentages.

- [ ] **Step 3: Verify the ratchet passes on the baseline it just emitted**

```bash
node scripts/check-coverage.mjs
```

Expected: `[check-coverage] OK` and exit code 0.

- [ ] **Step 4: Commit the baseline**

```bash
git add coverage-baseline.json
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "chore(ci): capture initial per-package coverage baseline"
```

---

## Task 6: Write `.github/workflows/ci.yml`

**Why:** Single-job pipeline that runs the same steps as `npm run verify` — fails fast on cheap checks, uploads coverage.

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
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
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "ci: add verify workflow (lint, typecheck, tests, coverage ratchet, madge)"
```

---

## Task 7: Smoke-test the whole pipeline locally

**Why:** Before the workflow runs in GitHub we prove the full chain works locally with one command.

- [ ] **Step 1: Run `npm run verify`**

```bash
npm run verify
```

Expected: every step exits 0, final step prints `[check-coverage] OK`, and the whole command exits 0.

- [ ] **Step 2: Negative test — artificially drop coverage and confirm ratchet fails**

```bash
# Temporarily bump a package's baseline so the script treats current coverage as a drop
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const b = JSON.parse(readFileSync('coverage-baseline.json','utf8'));
const firstPkg = Object.keys(b)[0];
b[firstPkg].statements = Math.min(100, b[firstPkg].statements + 5);
writeFileSync('coverage-baseline.json', JSON.stringify(b,null,2)+'\n');
console.log('Bumped', firstPkg, 'to', b[firstPkg].statements);
"
node scripts/check-coverage.mjs
```

Expected: exit code 1, message like `[check-coverage] packages/<x> statements: 77.30% → 72.30% (-5.00%) — FAIL`.

- [ ] **Step 3: Restore the baseline**

```bash
git checkout -- coverage-baseline.json
node scripts/check-coverage.mjs
```

Expected: `[check-coverage] OK`.

- [ ] **Step 4: Negative test — add a lint violation and confirm `npm run lint` fails**

```bash
# Append a complexity=11 function to any non-test file, run lint, expect fail
echo '
/* eslint-disable-next-line */
function __smoke_test_complexity__(n: number) {
  if (n === 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  if (n === 5) return 5;
  if (n === 6) return 6;
  if (n === 7) return 7;
  if (n === 8) return 8;
  if (n === 9) return 9;
  return -1;
}
' >> src/main.ts
npm run lint 2>&1 | tail -5
```

Expected: at least one warning `function '__smoke_test_complexity__' has a complexity of 11`.

- [ ] **Step 5: Revert the smoke test**

```bash
git checkout -- src/main.ts
```

- [ ] **Step 6: Confirm branch-protection follow-up is documented**

Branch protection must be configured in the GitHub UI after the workflow is merged to `main`. No code change; add a line to the implementer's handoff:

> _After merging Task 6, configure branch protection on `main`: require the `verify` job to pass, require up-to-date-with-base-branch, disallow force push._

**Phase 1.1 complete.** All 26 strict-rule violations visible as warnings; CI gates all PRs; ratchet prevents coverage regressions.

---

# Phase 1.2 — Clear the 26 strict-rule violations

Each task below corresponds to one PR. The PR that lands the last fix for a rule also promotes that rule from `warn` to `error` (shown as a final step of the last task for each rule).

## Task 8: Group A — `max-params > 5` (3 violations)

**Why:** Three functions take 6 positional params each; converting each to a single options object removes the violation and makes the call sites self-documenting.

**Files:**

- Modify: `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts`
- Modify: `packages/editor/src/services/element-factory/element-factory.service.ts`
- Modify: **all call sites** of the three changed signatures.

### Subtask 8.1 — `snapToGuides` (drag-resize-rotate.service.ts:63)

- [ ] **Step 1: Read the current signature + grep call sites**

```bash
grep -n "snapToGuides" packages/editor/src -rn
```

- [ ] **Step 2: Write a failing unit test proving current call-shape**

Open `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.spec.ts` (create if missing). Add a test that calls `snapToGuides` with the new options-object signature and asserts the return shape the current call site expects. Run:

```bash
npm test -- --watch=false --include='**/drag-resize-rotate.service.spec.ts'
```

Expected: FAIL with "expected options object, got 6 args" or a TypeScript compile error.

- [ ] **Step 3: Refactor `snapToGuides` to an options object**

Replace the current signature:

```ts
snapToGuides(
  rect: Rect,
  siblings: Rect[],
  threshold: number,
  snapX: boolean,
  snapY: boolean,
  origin: Point,
): SnapResult {
```

with:

```ts
snapToGuides(opts: {
  rect: Rect;
  siblings: Rect[];
  threshold: number;
  snapX: boolean;
  snapY: boolean;
  origin: Point;
}): SnapResult {
  const { rect, siblings, threshold, snapX, snapY, origin } = opts;
```

- [ ] **Step 4: Update every call site found in Step 1**

Each call becomes `this._drr.snapToGuides({ rect, siblings, threshold, snapX, snapY, origin })`. Preserve the exact current values; no semantic change.

- [ ] **Step 5: Run affected tests**

```bash
npm test -- --watch=false --include='**/drag-resize-rotate.service.spec.ts'
npm test -- --watch=false --include='**/pointer-orchestrator*.spec.ts'
npm test -- --watch=false --include='**/editor.component.spec.ts'
```

Expected: all pass.

- [ ] **Step 6: Confirm the lint warning is gone for this function**

```bash
npm run lint 2>&1 | grep -n "snapToGuides.*max-params"
```

Expected: no output.

### Subtask 8.2 — `beginRotate` (drag-resize-rotate.service.ts:332)

Repeat Steps 1–6 of Subtask 8.1 with the signature:

```ts
beginRotate(opts: {
  id: string;
  startAngle: number;
  center: Point;
  pointer: Point;
  snap: boolean;
  live: boolean;
}): void {
  const { id, startAngle, center, pointer, snap, live } = opts;
```

### Subtask 8.3 — `createFromPalette` (element-factory.service.ts:82)

Repeat Steps 1–6 of Subtask 8.1 with the signature:

```ts
async createFromPalette(opts: {
  kind: PaletteItemKind;
  pageId: string;
  position: Point;
  size: Size;
  tenantId: string;
  projectId: string;
}): Promise<string> {
  const { kind, pageId, position, size, tenantId, projectId } = opts;
```

### Subtask 8.4 — Promote `max-params` to `error`

- [ ] **Step 1: Confirm zero `max-params` warnings remain**

```bash
npm run lint 2>&1 | grep 'max-params' | wc -l
```

Expected: `0`.

- [ ] **Step 2: Flip `max-params` to `error` in `eslint.config.js`**

Find:

```js
      'max-params': ['warn', 5],
```

Replace with:

```js
      'max-params': ['error', 5],
```

- [ ] **Step 3: Run lint; confirm exits 0**

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Commit the whole Group A PR**

```bash
git add packages/ eslint.config.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor): convert 6-arg signatures to options objects; promote max-params to error"
```

---

## Task 9: Group B — `max-lines-per-function > 60` (4 violations)

**Why:** Four functions exceed 60 effective lines; extracting coherent helpers drops each below the limit without changing behavior.

**Files:**

- Modify: `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts`
- Modify: `packages/tenant/src/services/tenant/tenant.service.ts`

### Subtask 9.1 — `snapToGuides` (90 → ≤60 lines)

- [ ] **Step 1: Identify the coherent sub-passes**

Read the current function. It contains three independent scans: horizontal guides, vertical guides, then reconciliation. Mark them visually; these become the helpers.

- [ ] **Step 2: Extract `_findHorizontalGuides`, `_findVerticalGuides`, `_pickClosestGuide` as private methods**

Add below `snapToGuides`:

```ts
private _findHorizontalGuides(rect: Rect, siblings: Rect[], threshold: number): GuideMatch[] {
  // ... moved from snapToGuides' H-pass ...
}

private _findVerticalGuides(rect: Rect, siblings: Rect[], threshold: number): GuideMatch[] {
  // ... moved from snapToGuides' V-pass ...
}

private _pickClosestGuide(matches: GuideMatch[]): GuideMatch | null {
  // ... moved from reconciliation pass ...
}
```

Declare `GuideMatch` as a file-local `interface GuideMatch { axis: 'h' | 'v'; offset: number; distance: number; }`.

- [ ] **Step 3: Rewrite `snapToGuides` body to use the helpers (must be ≤60 effective lines)**

```ts
snapToGuides(opts: { /* ... */ }): SnapResult {
  const { rect, siblings, threshold, snapX, snapY, origin } = opts;
  const h = snapX ? this._pickClosestGuide(this._findHorizontalGuides(rect, siblings, threshold)) : null;
  const v = snapY ? this._pickClosestGuide(this._findVerticalGuides(rect, siblings, threshold)) : null;
  return this._assembleSnapResult(rect, origin, h, v);
}
```

Extract `_assembleSnapResult` if the inline body grows past a few lines.

- [ ] **Step 4: Run tests**

```bash
npm test -- --watch=false --include='**/drag-resize-rotate*.spec.ts'
```

Expected: all pass.

- [ ] **Step 5: Confirm warning cleared**

```bash
npm run lint 2>&1 | grep 'snapToGuides.*max-lines-per-function'
```

Expected: empty.

### Subtask 9.2 — `snapResizeEdges` (105 → ≤60 lines)

- [ ] **Step 1: Extract per-edge helpers**

Add private methods `_snapLeftEdge`, `_snapRightEdge`, `_snapTopEdge`, `_snapBottomEdge` each returning the edge-adjustment or `null`. Each helper owns the threshold math for its edge only.

- [ ] **Step 2: Rewrite the function body as a simple composition**

```ts
snapResizeEdges(opts: /* ... */): ResizeSnapResult {
  const left = this._snapLeftEdge(...);
  const right = this._snapRightEdge(...);
  const top = this._snapTopEdge(...);
  const bottom = this._snapBottomEdge(...);
  return { left, right, top, bottom };
}
```

- [ ] **Step 3: Run tests and verify**

```bash
npm test -- --watch=false --include='**/drag-resize-rotate*.spec.ts'
npm run lint 2>&1 | grep 'snapResizeEdges.*max-lines-per-function'
```

Expected: tests pass, grep empty.

### Subtask 9.3 — `handleResizeMove` (72 → ≤60 lines)

- [ ] **Step 1: Extract the aspect-lock branch and the snap branch**

Create private `_applyAspectLock(rect, handle, pointer)` and `_applyResizeSnap(rect, handle, snapCfg)`.

- [ ] **Step 2: Rewrite the body**

```ts
handleResizeMove(ev: PointerEvent): void {
  const ctx = this._resizeCtx;
  if (!ctx) return;
  const rect = this._rawRectFromPointer(ctx, ev);
  const locked = ctx.aspectLocked ? this._applyAspectLock(rect, ctx.handle, ev) : rect;
  const snapped = this._applyResizeSnap(locked, ctx.handle, ctx.snap);
  this._writePreview(ctx.id, snapped);
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --watch=false --include='**/drag-resize-rotate*.spec.ts'
```

Expected: pass.

### Subtask 9.4 — `_onUserChange` in tenant.service.ts (64 → ≤60 lines)

- [ ] **Step 1: Extract `_applyTenantsSnapshot(user, tenants)` as a private method**

Move the block that updates `this._tenants.set(...)`, `this._currentTenantId.set(...)`, and the associated signal fan-out into a private method that takes the firestore snapshot payload and current user.

- [ ] **Step 2: Rewrite `_onUserChange` to focus on the auth transition (≤60 lines)**

The caller now has the shape: guard → fetch → `this._applyTenantsSnapshot(user, tenants)` → emit.

- [ ] **Step 3: Run tenant tests**

```bash
npm test -- --watch=false --include='**/tenant.service.spec.ts'
```

Expected: all pass (current suite stays green).

### Subtask 9.5 — Promote `max-lines-per-function` to `error`

- [ ] **Step 1: Confirm zero warnings**

```bash
npm run lint 2>&1 | grep 'max-lines-per-function' | wc -l
```

Expected: `0`.

- [ ] **Step 2: Flip in `eslint.config.js`**

```js
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
```

- [ ] **Step 3: Run `npm run verify`**

Expected: exit 0.

- [ ] **Step 4: Commit the whole Group B PR**

```bash
git add packages/ eslint.config.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor,tenant): extract helpers to cap functions at 60 lines; promote max-lines-per-function to error"
```

---

## Task 10: Group C1 — Split `project-api.service.ts` (502 → 5 sub-services + facade)

**Why:** File is at the threshold; domain boundaries are already clear (project doc, pages, elements, comments, activity). A facade preserves the public API so no consumer changes.

**Files:**

- Create: `packages/projects/src/services/project-api/project-doc.api.ts`
- Create: `packages/projects/src/services/project-api/page.api.ts`
- Create: `packages/projects/src/services/project-api/element.api.ts`
- Create: `packages/projects/src/services/project-api/comment.api.ts`
- Create: `packages/projects/src/services/project-api/activity.api.ts`
- Modify: `packages/projects/src/services/project-api/project-api.service.ts` (becomes facade)
- Modify: `packages/projects/src/services/project-api/project-api.service.spec.ts` (test the facade)

- [ ] **Step 1: Catalog the existing methods and map them to sub-services**

Run:

```bash
grep -nE '^\s+(public |async |readonly |static )?[a-zA-Z_][a-zA-Z0-9_]*\s*\(' packages/projects/src/services/project-api/project-api.service.ts
```

Group the output into five buckets (project-doc / page / element / comment / activity) in a scratch list; this is the extraction plan.

- [ ] **Step 2: Create `project-doc.api.ts` with the project-doc methods**

`@Injectable({ providedIn: 'root' })` class `ProjectDocApi` with `subscribeProjectDoc`, `updateProjectDoc`, `updateGridConfig`, etc. — move the full method bodies and their Firestore imports. Keep input/output types identical.

- [ ] **Step 3: Create `page.api.ts`, `element.api.ts`, `comment.api.ts`, `activity.api.ts` the same way**

Each is `@Injectable({ providedIn: 'root' })`, takes no args in its constructor except Firestore injection already used in the source file. Move the method bodies verbatim.

- [ ] **Step 4: Rewrite `project-api.service.ts` as a facade**

```ts
import { Injectable, inject } from '@angular/core';
import { ProjectDocApi } from './project-doc.api';
import { PageApi } from './page.api';
import { ElementApi } from './element.api';
import { CommentApi } from './comment.api';
import { ActivityApi } from './activity.api';

@Injectable({ providedIn: 'root' })
export class ProjectApiService {
  private readonly _doc = inject(ProjectDocApi);
  private readonly _page = inject(PageApi);
  private readonly _element = inject(ElementApi);
  private readonly _comment = inject(CommentApi);
  private readonly _activity = inject(ActivityApi);

  // Project doc
  public readonly subscribeProjectDoc = this._doc.subscribeProjectDoc.bind(this._doc);
  public readonly updateProjectDoc = this._doc.updateProjectDoc.bind(this._doc);
  public readonly updateGridConfig = this._doc.updateGridConfig.bind(this._doc);

  // Pages
  public readonly subscribePages = this._page.subscribePages.bind(this._page);
  public readonly addPage = this._page.addPage.bind(this._page);
  public readonly deletePage = this._page.deletePage.bind(this._page);
  public readonly renamePage = this._page.renamePage.bind(this._page);

  // Elements
  public readonly subscribeElements = this._element.subscribeElements.bind(this._element);
  public readonly createElement = this._element.createElement.bind(this._element);
  public readonly updateElement = this._element.updateElement.bind(this._element);
  public readonly deleteElement = this._element.deleteElement.bind(this._element);

  // Comments
  public readonly subscribeComments = this._comment.subscribeComments.bind(this._comment);
  public readonly addComment = this._comment.addComment.bind(this._comment);
  public readonly resolveComment = this._comment.resolveComment.bind(this._comment);

  // Activity
  public readonly subscribeTenantActivity = this._activity.subscribeTenantActivity.bind(
    this._activity,
  );
  public readonly writeActivity = this._activity.writeActivity.bind(this._activity);
  public readonly subscribeProjects = this._activity.subscribeProjects.bind(this._activity);
  public readonly createProject = this._activity.createProject.bind(this._activity);
  public readonly renameProject = this._activity.renameProject.bind(this._activity);
  public readonly softDeleteProject = this._activity.softDeleteProject.bind(this._activity);
}
```

Adjust method bindings to match the actual list from Step 1.

- [ ] **Step 5: Run the whole projects test suite**

```bash
npm test -- --watch=false --include='**/packages/projects/**/*.spec.ts'
```

Expected: all pass; no consumer spec needs updating because the facade preserves the public API.

- [ ] **Step 6: Run lint to confirm the file is under 500 lines**

```bash
wc -l packages/projects/src/services/project-api/project-api.service.ts
npm run lint 2>&1 | grep 'project-api.service.ts.*max-lines'
```

Expected: facade file is well under 500 lines; no `max-lines` warning.

- [ ] **Step 7: Commit the split**

```bash
git add packages/projects/
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(projects): split ProjectApiService into domain sub-services behind a facade"
```

---

## Task 11: Group C2 — Split `editor.component.ts` (696 → ≤400 lines)

**Why:** The editor component is at 696 lines even after prior extractions. Pulling canvas-event handlers into `EditorCanvasEventsService` and inspector wiring into a child component (`<mk-editor-inspector>`) drops the component into the ≤400-line range and naturally resolves `onCanvasDrop` complexity (Group D5's editor.component entry).

**Files:**

- Create: `packages/editor/src/services/canvas-events/canvas-events.service.ts`
- Create: `packages/editor/src/services/canvas-events/canvas-events.service.spec.ts`
- Create: `packages/editor/src/components/editor-inspector/editor-inspector.component.ts`
- Create: `packages/editor/src/components/editor-inspector/editor-inspector.component.html`
- Create: `packages/editor/src/components/editor-inspector/editor-inspector.component.scss`
- Create: `packages/editor/src/components/editor-inspector/editor-inspector.component.spec.ts`
- Modify: `packages/editor/src/components/editor/editor.component.ts`
- Modify: `packages/editor/src/components/editor/editor.component.html`

- [ ] **Step 1: Extract `EditorCanvasEventsService`**

Create `canvas-events.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { EditorSessionService } from '../session/session.service';
import { ElementFactoryService } from '../element-factory/element-factory.service';
// ...

@Injectable({ providedIn: 'root' })
export class EditorCanvasEventsService {
  private readonly _session = inject(EditorSessionService);
  private readonly _factory = inject(ElementFactoryService);
  // ... whichever collaborators the moved handlers need ...

  public async onCanvasDrop(ev: DragEvent, paletteItem: PaletteItem | null): Promise<void> {
    // Moved body from editor.component.ts's onCanvasDrop.
    // Extract the create-element block into a helper so complexity drops below 10:
    const point = this._pointerPoint(ev);
    if (!paletteItem) return;
    await this._createElementAtDropPoint(paletteItem, point);
  }

  private _pointerPoint(ev: DragEvent): Point {
    /* ... */
  }
  private async _createElementAtDropPoint(item: PaletteItem, p: Point): Promise<void> {
    /* ... */
  }

  // plus onCanvasPointerDown/Up/Move delegates if they were in editor.component.ts
}
```

- [ ] **Step 2: Write a spec for the moved handlers**

Create `canvas-events.service.spec.ts` with tests covering `onCanvasDrop` happy-path + no-palette-item short-circuit. Mirror the shape of existing editor sub-service specs (e.g. `comments.service.spec.ts`).

- [ ] **Step 3: Extract `<mk-editor-inspector>` component**

Move the inspector template block out of `editor.component.html` into `editor-inspector.component.html`. The new component takes inputs for the pieces of state it needs (e.g. `selection: InputSignal<ElementDoc | null>`, `tools: InputSignal<ToolsVM>`) and emits outputs for user actions.

Template-host wiring in `editor.component.html` becomes:

```html
<mk-editor-inspector
  [selection]="selection()"
  [tools]="toolsVM()"
  (renameRequest)="_elementEditor.rename($event.id, $event.name)"
  ...
/>
```

- [ ] **Step 4: Update `editor.component.ts` to delegate**

Replace the existing `onCanvasDrop` body with:

```ts
public onCanvasDrop(ev: DragEvent) {
  return this._canvasEvents.onCanvasDrop(ev, this._pendingPaletteItem);
}
```

Remove all now-unused private helpers that moved into the service.

- [ ] **Step 5: Run editor tests**

```bash
npm test -- --watch=false --include='**/packages/editor/**/*.spec.ts'
```

Expected: all pass. Editor component suite must still pass — if a test reaches into implementation detail that moved, update the test to exercise the facade behavior instead.

- [ ] **Step 6: Confirm editor.component is ≤ 500 lines and has no max-lines warning**

```bash
wc -l packages/editor/src/components/editor/editor.component.ts
npm run lint 2>&1 | grep 'editor.component.ts.*max-lines'
```

Expected: under 500 lines; no warning.

- [ ] **Step 7: Promote `max-lines` to `error` (last offender cleared)**

In `eslint.config.js`:

```js
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
```

- [ ] **Step 8: Run `npm run verify`**

Expected: exit 0.

- [ ] **Step 9: Commit Group C2 + promotion**

```bash
git add packages/ eslint.config.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor): extract canvas-events service and inspector child component; promote max-lines to error"
```

---

## Task 12: Group D1 — Pointer/drag complexity (3 violations)

**Why:** `onCanvasPointerMove` (cx 20), `onCanvasPointerUp` (cx 24), `_finishMarquee` (cx 15) in `pointer-orchestrator.service.ts`. The functions branch on the orchestrator's current mode; a handler-map refactor drops each below 10.

**Files:**

- Modify: `packages/editor/src/services/pointer-orchestrator/pointer-orchestrator.service.ts`

- [ ] **Step 1: Introduce a mode enum / discriminator**

Near the top of the class:

```ts
type PointerMode = 'idle' | 'drag' | 'marquee' | 'resize' | 'rotate' | 'draw';
```

- [ ] **Step 2: Extract per-mode handlers**

Add private methods:

```ts
private _onMoveDrag(ev: PointerEvent): void { /* moved from onCanvasPointerMove's drag branch */ }
private _onMoveMarquee(ev: PointerEvent): void { /* moved from marquee branch */ }
private _onMoveResize(ev: PointerEvent): void { /* ... */ }
private _onMoveRotate(ev: PointerEvent): void { /* ... */ }
private _onMoveDraw(ev: PointerEvent): void { /* ... */ }
```

Do the same for `onCanvasPointerUp` (e.g. `_onUpDrag`, `_onUpMarquee`, etc.).

- [ ] **Step 3: Rewrite the two public entry points as dispatchers**

```ts
public onCanvasPointerMove(ev: PointerEvent): void {
  switch (this._mode) {
    case 'drag':    return this._onMoveDrag(ev);
    case 'marquee': return this._onMoveMarquee(ev);
    case 'resize':  return this._onMoveResize(ev);
    case 'rotate':  return this._onMoveRotate(ev);
    case 'draw':    return this._onMoveDraw(ev);
    default:        return;
  }
}
```

Switch statements at this shape have complexity equal to `cases + 1` = 6, under 10.

- [ ] **Step 4: Extract `_finishMarquee` sub-passes**

`_finishMarquee` has three coherent steps: collect intersecting ids, apply additive/toggle selection rules, clear the marquee rect. Extract each as a private helper and reduce the body to a 3-call composition.

- [ ] **Step 5: Run pointer tests**

```bash
npm test -- --watch=false --include='**/pointer-orchestrator*.spec.ts'
```

Expected: all pass.

- [ ] **Step 6: Confirm lint warnings for these three gone**

```bash
npm run lint 2>&1 | grep -E 'pointer-orchestrator.*complexity'
```

Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/services/pointer-orchestrator/
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor): state-machine handler map for pointer orchestrator"
```

---

## Task 13: Group D2 — Drag-resize inner loops (verify auto-resolved, else fix)

**Why:** Group B's `snapToGuides`/`snapResizeEdges`/`handleResizeMove` helper extractions usually drop complexity alongside length. This task is a verification + cleanup pass.

**Files:**

- Modify (if needed): `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts`

- [ ] **Step 1: Check remaining drag-resize complexity warnings**

```bash
npm run lint 2>&1 | grep 'drag-resize-rotate.*complexity'
```

If empty: skip to Task 14.

- [ ] **Step 2: For any residual warning, extract the deepest branch into a named helper**

Choose the branch with the highest nesting (`if`/`else if` chains or switch cases on snap direction). Move it to a private helper; call the helper.

- [ ] **Step 3: Run drag-resize tests**

```bash
npm test -- --watch=false --include='**/drag-resize-rotate*.spec.ts'
```

Expected: pass.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add packages/editor/src/services/drag-resize-rotate/
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor): trim drag-resize branch complexity"
```

---

## Task 14: Group D3 — Keyboard + message dispatch (2 violations)

**Why:** Classic switch-heavy handlers. `onGlobalKey` (cx 31) and `_handleMessage` (cx 17) become `Map<key, handler>` lookups.

**Files:**

- Modify: `packages/editor/src/directives/editor-shortcuts/editor-shortcuts.directive.ts`
- Modify: `packages/collab/src/services/collab/collab.service.ts`

### Subtask 14.1 — `onGlobalKey` → command map

- [ ] **Step 1: Read the current switch and extract command signatures**

```bash
sed -n '40,120p' packages/editor/src/directives/editor-shortcuts/editor-shortcuts.directive.ts
```

- [ ] **Step 2: Define the command type and table**

Near the top of the directive class:

```ts
private readonly _commands = new Map<string, (ev: KeyboardEvent) => void>([
  ['Escape',     (ev) => this._escape(ev)],
  ['Delete',     (ev) => this._deleteSelection(ev)],
  ['Backspace',  (ev) => this._deleteSelection(ev)],
  ['mod+z',      (ev) => this._undo(ev)],
  ['mod+shift+z',(ev) => this._redo(ev)],
  ['mod+c',      (ev) => this._copy(ev)],
  ['mod+v',      (ev) => this._paste(ev)],
  ['mod+d',      (ev) => this._duplicate(ev)],
  // ... fill with the exact entries the current switch covers ...
]);

private _comboFor(ev: KeyboardEvent): string {
  const mod = ev.metaKey || ev.ctrlKey ? 'mod+' : '';
  const shift = ev.shiftKey ? 'shift+' : '';
  return `${mod}${shift}${ev.key}`;
}
```

- [ ] **Step 3: Rewrite `onGlobalKey` as a dispatcher**

```ts
@HostListener('document:keydown', ['$event'])
onGlobalKey(ev: KeyboardEvent): void {
  if (this._shouldIgnore(ev)) return;
  const combo = this._comboFor(ev);
  const handler = this._commands.get(combo) ?? this._commands.get(ev.key);
  if (handler) handler(ev);
}
```

Move each original switch branch body into the matching `_escape`, `_deleteSelection`, etc. private method.

- [ ] **Step 4: Run directive tests**

```bash
npm test -- --watch=false --include='**/editor-shortcuts*.spec.ts'
```

Expected: pass. If there's no spec yet, add one that asserts `mod+z` calls the undo handler on the injected history service (use jasmine spy).

### Subtask 14.2 — `_handleMessage` → handler map

- [ ] **Step 1: Extract a handler map keyed by message type**

In `collab.service.ts` near the class:

```ts
private readonly _messageHandlers: Record<CollabMessage['type'], (m: CollabMessage) => void> = {
  'presence':    (m) => this._handlePresence(m),
  'selection':   (m) => this._handleSelection(m),
  'edit':        (m) => this._handleEdit(m),
  // ... one entry per case in the current switch ...
};
```

- [ ] **Step 2: Rewrite `_handleMessage`**

```ts
private _handleMessage(msg: CollabMessage): void {
  const handler = this._messageHandlers[msg.type];
  if (!handler) { console.warn('[collab] unknown message type', msg.type); return; }
  handler(msg);
}
```

- [ ] **Step 3: Move each `case` body into its `_handle<Type>` method (keep signatures narrow to the message variant)**

- [ ] **Step 4: Run collab tests**

```bash
npm test -- --watch=false --include='**/collab.service.spec.ts'
```

Expected: pass.

### Subtask 14.3 — Commit Group D3

- [ ] **Step 1: Confirm both warnings gone**

```bash
npm run lint 2>&1 | grep -E '(onGlobalKey|_handleMessage).*complexity'
```

Expected: empty.

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/directives/editor-shortcuts/ packages/collab/src/services/collab/
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor,collab): replace switch-heavy handlers with handler maps"
```

---

## Task 15: Group D4 — Async generators / misc arrows (3 violations)

**Why:** Three async/arrow bodies branch on validation, transport state, or ordering. Extracting pure helpers drops each below complexity 10.

**Files:**

- Modify: `packages/editor/src/services/ai-orchestrator/ai-orchestrator.service.ts`
- Modify: `packages/collab/src/services/collab/collab.service.ts` (the arrow at line 97)
- Modify: `packages/editor/src/services/layer-order/layer-order.service.ts`

### Subtask 15.1 — `generate` in `ai-orchestrator.service.ts` (cx 18)

- [ ] **Step 1: Identify the three natural phases**

Read the function. It validates inputs, builds a prompt, and parses the model's response into tool calls. Those become three private methods.

- [ ] **Step 2: Extract**

```ts
private _validateGenerateInput(req: GenerateRequest): ValidationResult { /* ... */ }
private _buildPrompt(req: GenerateRequest, ctx: EditorContext): PromptBundle { /* ... */ }
private async _parseResponse(raw: string): Promise<ToolCall[]> { /* ... */ }
```

- [ ] **Step 3: Rewrite `generate`**

```ts
async generate(req: GenerateRequest, ctx: EditorContext): Promise<GenerateResult> {
  const v = this._validateGenerateInput(req);
  if (!v.ok) return { kind: 'validation-error', errors: v.errors };
  const prompt = this._buildPrompt(req, ctx);
  const raw = await this._llm.complete(prompt);
  const calls = await this._parseResponse(raw);
  return { kind: 'ok', calls };
}
```

- [ ] **Step 4: Run ai-orchestrator tests**

```bash
npm test -- --watch=false --include='**/ai-orchestrator*.spec.ts'
```

Expected: pass.

### Subtask 15.2 — `collab.service.ts:97` arrow (cx 12)

- [ ] **Step 1: Extract the arrow body to a private method**

The arrow is a callback on a WebSocket event; move its body to `_onSocketEvent(data: unknown): void` and reduce the arrow to `(data) => this._onSocketEvent(data)`. The relocated method can further decompose if still > 10.

- [ ] **Step 2: Run collab tests**

```bash
npm test -- --watch=false --include='**/collab.service.spec.ts'
```

Expected: pass.

### Subtask 15.3 — `reorderLayer` in `layer-order.service.ts` (cx 14)

- [ ] **Step 1: Extract the order-computation helper**

```ts
private _computeNewOrderValues(siblings: LayerElement[], moved: LayerElement, target: DropTarget): Map<string, number> { /* ... */ }
```

- [ ] **Step 2: Rewrite `reorderLayer`**

```ts
async reorderLayer(moved: LayerElement, target: DropTarget): Promise<void> {
  const siblings = await this._fetchSiblings(moved);
  const updates = this._computeNewOrderValues(siblings, moved, target);
  await this._persist(updates);
}
```

- [ ] **Step 3: Run layer-order tests**

```bash
npm test -- --watch=false --include='**/layer-order*.spec.ts'
```

Expected: pass.

### Subtask 15.4 — Commit Group D4

- [ ] **Step 1: Confirm warnings gone**

```bash
npm run lint 2>&1 | grep -E '(ai-orchestrator|collab.service|layer-order).*complexity'
```

Expected: empty.

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/services/ai-orchestrator/ packages/collab/src/services/collab/ packages/editor/src/services/layer-order/
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(editor,collab): extract pure helpers from branchy async paths"
```

---

## Task 16: Group D5 — Remaining complexity (tenant/firebase, verify others)

**Why:** Three tenant-service methods and one firebase-service constructor branch on input state. Extract guard helpers and init helpers. Also verify the project-api arrow and editor.component `onCanvasDrop` resolved via Groups C1/C2.

**Files:**

- Modify: `packages/tenant/src/services/tenant/tenant.service.ts`
- Modify: `packages/core/src/firebase/firebase.service.ts`

### Subtask 16.1 — `createTenant` (cx 11)

- [ ] **Step 1: Extract validation guards**

```ts
private _assertValidTenantName(name: string): void { /* throws if invalid */ }
private _assertNotDuplicate(name: string): void { /* throws if dup */ }
```

- [ ] **Step 2: Reduce `createTenant` to the happy path**

```ts
async createTenant(name: string): Promise<string> {
  this._assertValidTenantName(name);
  this._assertNotDuplicate(name);
  const id = this._newId();
  await this._persistTenant(id, name);
  return id;
}
```

- [ ] **Step 3: Run tenant tests**

```bash
npm test -- --watch=false --include='**/tenant.service.spec.ts'
```

Expected: pass.

### Subtask 16.2 — `acceptInvite` (cx 11)

- [ ] **Step 1: Extract guards (`_assertInviteValid`, `_assertInviteUnused`) and reduce the body to a 4-line happy path.**

- [ ] **Step 2: Run tests**

Expected: pass.

### Subtask 16.3 — tenant.service.ts arrow (cx 16)

- [ ] **Step 1: Identify the arrow**

```bash
sed -n '270,290p' packages/tenant/src/services/tenant/tenant.service.ts
```

- [ ] **Step 2: Extract body into a named private method and have the arrow forward to it**

Same pattern as Subtask 15.2.

### Subtask 16.4 — `firebase.service.ts:40` constructor (cx 11)

- [ ] **Step 1: Extract each init branch as a private method**

```ts
private _initEmulators(): void { /* dev-only emulator wiring */ }
private _initAuthPersistence(): void { /* ... */ }
private _initAppCheck(): void { /* ... */ }
```

- [ ] **Step 2: Reduce the constructor to a sequence of calls**

```ts
constructor() {
  this._initEmulators();
  this._initAuthPersistence();
  this._initAppCheck();
}
```

- [ ] **Step 3: Run firebase tests**

```bash
npm test -- --watch=false --include='**/firebase.service.spec.ts'
```

Expected: pass.

### Subtask 16.5 — Verify auto-resolved items

- [ ] **Step 1: Check project-api and editor.component complexity**

```bash
npm run lint 2>&1 | grep -E '(project-api|editor.component).*complexity'
```

If empty: Group C1/C2 resolved both. If anything remains, extract the smallest helper needed to drop below 10 and commit as a trailing fix.

### Subtask 16.6 — Promote `complexity` to `error` (last rule)

- [ ] **Step 1: Confirm zero complexity warnings repo-wide**

```bash
npm run lint 2>&1 | grep 'complexity' | wc -l
```

Expected: `0`.

- [ ] **Step 2: Also promote `max-depth` (already zero violations, so free)**

```bash
npm run lint 2>&1 | grep 'max-depth' | wc -l
```

Expected: `0`.

- [ ] **Step 3: Flip both rules to `error` in `eslint.config.js`**

```js
      complexity: ['error', 10],
      'max-depth': ['error', 4],
```

- [ ] **Step 4: Run `npm run verify`**

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ eslint.config.js
git -c user.email=junaidahmed@teamitg.com -c user.name="Junaid Ahmed" commit -m "refactor(tenant,core): extract guards/init helpers; promote complexity + max-depth to error"
```

---

## Task 17: Final verification — all rules `error`, zero violations

- [ ] **Step 1: Grep the config to confirm every rule is `error`**

```bash
grep -E "^(\s+)(complexity|'max-(lines|lines-per-function|depth|params)')" eslint.config.js
```

Expected: every match shows `'error'`, no `'warn'`.

- [ ] **Step 2: Full verify**

```bash
npm run verify
```

Expected: exit 0 cleanly.

- [ ] **Step 3: Negative smoke — re-introduce one violation, confirm CI script fails with `error`**

```bash
echo '
export function __smoke(n: number) {
  if (n===0) return 0; if (n===1) return 1; if (n===2) return 2; if (n===3) return 3;
  if (n===4) return 4; if (n===5) return 5; if (n===6) return 6; if (n===7) return 7;
  if (n===8) return 8; if (n===9) return 9; return -1;
}' >> src/main.ts
npm run lint 2>&1 | tail -5
```

Expected: at least one **error** (not warning) for `complexity`. Exit code 1.

- [ ] **Step 4: Revert smoke**

```bash
git checkout -- src/main.ts
```

- [ ] **Step 5: Final `npm run verify`**

Expected: exit 0.

- [ ] **Step 6: Push the branch and open the Phase 1 wrap-up PR**

(Follow the user's normal PR process — not part of this plan.)

**Phase 1.2 complete.** All strict rules are `error`, every file passes, CI enforces them on every PR.

---

# Out of plan (follow-ups)

- **Track 3**: raise coverage beyond baseline, add e2e to CI, add bundle-size budgets.
- **GitHub branch protection**: configure in the GitHub UI after Task 6 merges (require `verify` to pass, up-to-date-with-base, no force-push to `main`). This is a one-time manual setting, not a code change.
- **Stylelint complexity**: not addressed here; reconsider if SCSS grows.

---

## Self-review notes (plan author)

- **Spec coverage:** Every Section 1–6 requirement has a task. Section 2 (ESLint config) = Task 2 + promotion steps in Tasks 8/9/11/16. Section 3 (formatting/pre-commit) mostly already exists; Task 1 covers the script split. Section 4 (CI workflow) = Task 6. Section 5 (coverage ratchet) = Tasks 3, 4, 5. Section 6 (refactor plan) = Tasks 8–16.
- **Types consistency:** `GuideMatch`, `PointerMode`, `CollabMessage`, `GenerateRequest`, `ValidationResult`, `PromptBundle`, `ToolCall`, `DropTarget`, `LayerElement` are referenced in the extracted helper signatures. Where those names already exist in the codebase (most do), reuse them; where they don't, introduce them alongside the helper. Implementer should grep existing types before creating duplicates.
- **No placeholders:** All config blocks, scripts, and code skeletons are concrete. Refactor tasks describe the target shape with code, not prose.
