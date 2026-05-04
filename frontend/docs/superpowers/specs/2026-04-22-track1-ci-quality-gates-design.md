# Track 1 — CI & Quality Gates (strict-from-day-one)

**Date:** 2026-04-22
**Status:** Approved, ready for implementation planning
**Author:** Junaid Ahmed (with Claude)

## Context

The Mocktail frontend repo has grown to the point where informal code-quality discipline is starting to leak. Recent editor refactors (EditorElementsStateService, EditorInlineEditService, EditorInspectorService, EditorCollabSyncService, EditorElementEditorService, EditorCommentsService, EditorSessionService) landed because individual services crossed internal complexity thresholds and were hard to reason about. There are no automated gates to catch the next such growth _before_ a god-object forms.

A probe against strict ESLint rules (complexity ≤ 10, max-lines ≤ 500, max-lines-per-function ≤ 60, max-params ≤ 5, max-depth ≤ 4) surfaces **26 violations across 11 files** — a tractable cleanup. This is the right moment to lock in strict rules _and_ clear the backlog.

This spec covers Track 1 (Tooling & CI) merged with Track 2 (Refactoring) per the "strict-from-day-one, no overrides" directive. Track 3 (test-coverage growth beyond the baseline floor) remains a separate future cycle.

## Goals

1. A PR that violates any strict ESLint rule, introduces a circular dep, regresses coverage, or breaks formatting fails CI before it can be merged.
2. All 26 existing strict-rule violations are fixed; all rules are `error` repo-wide; no file-level or inline overrides.
3. Pre-commit hook catches formatting/lint issues before push for the typical IDE workflow.
4. Contributors can run `npm run verify` locally and get the same result CI gives.

## Non-goals

- E2E tests in CI (deferred to Track 3).
- Raising test coverage above today's baseline (deferred to Track 3).
- Bundle-size or performance budgets.
- Changelog, release, or dependency-update automation.

## Scope

### In

- Strict ESLint rules added to `eslint.config.js` on day one (as `warn`).
- Prettier config audit + `format:check` script + CI gate.
- Stylelint for SCSS + CI gate.
- Husky pre-commit hook via lint-staged (changed files only).
- madge circular-dependency check in CI.
- GitHub Actions workflow: `lint → stylelint → format:check → tsc → unit tests → coverage check → madge`.
- Per-package coverage thresholds with a ratchet policy (baseline = current coverage).
- Phase 1.2: refactor all 26 strict-rule violations; promote each rule from `warn` to `error` as its last offender goes green.

### Out

See Non-goals.

## Architecture

### Two-phase rollout under one spec

**Phase 1.1 — Skeleton** (ships CI value immediately, no refactor work yet):

- Add the strict rules as `warn` so violations are visible but non-blocking.
- Stand up the GitHub Actions workflow with the full pipeline.
- Add Prettier/Stylelint scripts + husky + lint-staged.
- Capture coverage baseline into `coverage-baseline.json` and commit.

**Phase 1.2 — Refactor the 26 violations** (one rule at a time):

- Fix violations in groups (see Phase 1.2 refactor plan below).
- The PR that lands the last fix for a given rule _also_ flips that rule from `warn` to `error` in `eslint.config.js`.
- When all 4 rules are `error`, Phase 1.2 is complete.

### Component boundaries

```
.github/workflows/ci.yml        # one job: verify
eslint.config.js                # strict rules added (warn → error per rule)
.prettierrc.json                # existing/audited
.stylelintrc.json               # new
.husky/pre-commit               # runs lint-staged
scripts/check-coverage.mjs      # ratchet check against coverage-baseline.json
coverage-baseline.json          # committed, mutated when coverage climbs
package.json                    # new scripts: verify, typecheck, deps:check,
                                #             format, format:check, lint:scss
```

## ESLint config (Section 2)

Rules added to the main TS block (applies to `**/*.ts` excluding specs, which already have their own override block):

```js
rules: {
  // existing rules...
  complexity: ['warn', 10],
  'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
  'max-depth': ['warn', 4],
  'max-params': ['warn', 5],
  'no-restricted-syntax': ['error',
    { selector: "CallExpression[callee.name='setTimeout'][arguments.length<2]", message: 'setTimeout without delay' },
  ],
}
```

Spec files (`**/*.spec.ts`) are exempt via the existing override block.

### Promotion ceremony

Phase 1.2 fixes violations one rule at a time, in this order (easiest first so momentum builds):

1. `max-params` (3 violations) — mechanical param-object refactor.
2. `max-lines-per-function` (4 violations) — extract helpers.
3. `max-lines` file-level (2 violations) — split files.
4. `complexity` (17 violations) — biggest work.

When a rule hits zero violations repo-wide, the same PR that lands the last fix flips `'warn'` → `'error'` in `eslint.config.js`.

**No per-file `/* eslint-disable */`. No inline overrides.** If a rule can't be satisfied, the file is split or the rule is reconsidered as a team decision, documented in a follow-up spec — not in code.

### Rule rationale

- `complexity: 10` — industry default; higher usually wants a handler-map refactor.
- `max-lines: 500` — soft cap on god-files; forces domain splitting.
- `max-lines-per-function: 60` — a screen of code.
- `max-depth: 4` — already not violated today; cheap to lock in.
- `max-params: 5` — forces parameter objects, which are self-documenting.

### Intentionally _not_ added

- `max-classes-per-file` — Angular components + services per file is idiomatic.
- `no-magic-numbers` — noisy; fights Angular idioms.
- `@typescript-eslint/strict-boolean-expressions` — high-friction; Track 3 candidate.

## Formatting & pre-commit tooling (Section 3)

### Prettier

- Audit `.prettierrc` and `.prettierignore`; create if missing.
- Root `package.json` scripts:
  ```json
  "format:check": "prettier --check \"**/*.{ts,html,scss,json,md}\"",
  "format": "prettier --write \"**/*.{ts,html,scss,json,md}\""
  ```

### Stylelint (new)

- Install `stylelint`, `stylelint-config-standard-scss`, `stylelint-config-prettier-scss`.
- `.stylelintrc.json` extends the standard-scss config, disabling rules that fight Angular `:host ::ng-deep` idioms (validated against the current SCSS after the initial `--fix` pass).
- Scripts:
  ```json
  "lint:scss": "stylelint \"**/*.scss\"",
  "lint:scss:fix": "stylelint \"**/*.scss\" --fix"
  ```

### Husky + lint-staged (new)

- `husky` installs a `pre-commit` hook running `lint-staged`.
- `lint-staged` config in `package.json`:
  ```json
  "lint-staged": {
    "*.ts":             ["eslint --fix", "prettier --write"],
    "*.html":           ["eslint --fix", "prettier --write"],
    "*.scss":           ["stylelint --fix", "prettier --write"],
    "*.{json,md}":      ["prettier --write"]
  }
  ```
- Runs on **staged files only** — fast, non-blocking for normal work.
- `husky install` runs via `prepare` so it's automatic on `npm install`.

### Root scripts — the developer contract

```json
"verify":     "npm run lint && npm run lint:scss && npm run format:check && npm run typecheck && npm test -- --watch=false && npm run deps:check",
"typecheck":  "tsc -p tsconfig.json --noEmit",
"deps:check": "madge --circular --extensions ts packages/",
"lint":       "eslint ."
```

`npm run verify` == what CI runs. One command, same result.

### Escape hatches

- `git commit --no-verify` is kept for genuine emergencies (we don't fight developers).
- Prettier/Stylelint only block pre-commit on unfixable issues.
- CI is the hard gate; pre-commit is a convenience.

## CI workflow (Section 4)

**File:** `.github/workflows/ci.yml`
**Triggers:** `pull_request` targeting `main`, plus `push` to `main`.

**One job, sequential steps** (fast-fail on cheap checks first):

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout
      - setup-node (v20, cache: npm)
      - npm ci
      - run: npm run lint
      - run: npm run lint:scss
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm test -- --watch=false --code-coverage --browsers=ChromeHeadlessNoSandbox
      - run: node scripts/check-coverage.mjs
      - run: npm run deps:check
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
```

### Why one job

- Entire pipeline is <5 min on this repo size; splitting adds setup-node + npm-ci duplication that costs more than it saves.
- Simpler mental model: failing step = failing check.
- Can split later if e2e is added (Track 3) or total time crosses ~8 min.

### Why this serial order

- ESLint fails fastest; catches broken commits before tsc/tests run.
- Coverage step runs after tests (reads `coverage/lcov.info`).
- madge last because it's cheap and independent.

### Branch protection (configure in GitHub)

- Require `verify` job to pass before merge to `main`.
- Require up-to-date with base branch.
- No force-push to `main`.

### Artifacts

- Coverage uploaded on every run (even failures).
- No JUnit XML surfacing yet (can add later if PR comments become valuable).

### Not in CI (deferred)

- Playwright e2e (3 pre-existing flakes; Track 3).
- `ng build` (dev build implicit in tests; prod build not yet needed).
- Bundle-size check (Track 3).

## Coverage floor & ratchet (Section 5)

**Policy:** per-package coverage floor. PRs may not drop coverage below the recorded floor; they may raise it, and when they do, the floor moves up automatically.

**Scope:** statements, branches, functions, lines — four metrics per package.

**Location:** `coverage-baseline.json` at repo root, committed to git.

Example (real numbers captured during Phase 1.1 implementation):

```json
{
  "packages/editor": { "statements": 72.3, "branches": 61.4, "functions": 74.1, "lines": 72.8 },
  "packages/projects": { "statements": 68.5, "branches": 55.2, "functions": 69.0, "lines": 68.9 },
  "packages/collab": { "statements": 81.2, "branches": 72.5, "functions": 83.0, "lines": 81.5 },
  "packages/core": { "statements": 64.0, "branches": 50.8, "functions": 65.5, "lines": 64.3 },
  "packages/tenant": { "statements": 70.1, "branches": 58.4, "functions": 71.2, "lines": 70.5 },
  "packages/cdk": { "statements": 55.0, "branches": 42.1, "functions": 56.0, "lines": 55.5 }
}
```

### Check script — `scripts/check-coverage.mjs`

- Reads `coverage/<package>/coverage-summary.json` (karma-coverage emits per package).
- For each package, compares to `coverage-baseline.json`.
- **Fail** if any metric drops > 0.5% (tolerance for flaky floats).
- **Ratchet** if any metric rises ≥ 1%: rewrites `coverage-baseline.json` and fails with a friendly message telling the developer to commit the updated baseline. This forces ratchet to be a visible commit.

### Behavior matrix

| Baseline | PR coverage | Result                                                     |
| -------- | ----------- | ---------------------------------------------------------- |
| 72.3%    | 72.1%       | **pass** (−0.2%, within tolerance)                         |
| 72.3%    | 71.5%       | **fail** (−0.8%, over tolerance)                           |
| 72.3%    | 72.9%       | **pass** (+0.6%, under ratchet threshold; floor unchanged) |
| 72.3%    | 73.8%       | **fail** with "commit new baseline" (+1.5%, ratchets up)   |

### Why package-level, not global

- Editor is large and under-tested; projects is smaller; averaging hides regressions.
- Per-package floors let Track 3 attack coverage package-by-package without complicating this gate.

### Why not "80% floor, period"

- Current repo is mixed (55–81% by package); a hard floor would require a coverage sprint _before_ CI can ship.
- Ratchet means "never worse than today," which is enough for Phase 1.

### Not in this policy

- No per-file thresholds (noisy; file renames break them).
- No exclusion list for generated code (no codegen yet).
- No tests-added-per-changed-line heuristic.

### Bootstrap (Phase 1.1 implementation step)

Run tests once on `main`, capture numbers, write `coverage-baseline.json`, commit before enabling the CI gate.

## Phase 1.2 refactor plan (Section 6)

Each bullet is one PR-worth of work. Grouped by rule so the `warn → error` promotion ceremony has a clean trigger.

### Group A — `max-params > 5` (3 violations, ~1 PR)

Mechanical; collapse trailing primitive args into a single options object.

- `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts:63` `snapToGuides`
- `packages/editor/src/services/drag-resize-rotate/drag-resize-rotate.service.ts:332` `beginRotate`
- `packages/editor/src/services/element-factory/element-factory.service.ts:82` `createFromPalette`

**Last fix flips `max-params` → `error`.**

### Group B — `max-lines-per-function > 60` (4 violations, ~1 PR)

Extract pure helpers.

- `drag-resize-rotate.service.ts:63` `snapToGuides` (90 lines) → `findHorizontalGuides`, `findVerticalGuides`, `pickClosestGuide`
- `drag-resize-rotate.service.ts:159` `snapResizeEdges` (105 lines) → per-edge snap helpers
- `drag-resize-rotate.service.ts:397` `handleResizeMove` (72 lines) → aspect-lock and snap branches
- `packages/tenant/src/services/tenant/tenant.service.ts:254` `_onUserChange` (64 lines) → `_applyTenantsSnapshot`

**Last fix flips `max-lines-per-function` → `error`.**

### Group C — `max-lines > 500` (2 violations, ~2 PRs)

- **PR C1** — `packages/projects/src/services/project-api/project-api.service.ts` (502 lines): split into `ProjectDocApi`, `PageApi`, `ElementApi`, `CommentApi`, `ActivityApi`. `ProjectApiService` becomes a facade composing them; consumers untouched.
- **PR C2** — `packages/editor/src/components/editor/editor.component.ts` (696 lines): continue prior refactor trajectory. Extract canvas-event handlers into `EditorCanvasEventsService` and inspector wiring into `<mk-editor-inspector>`. Target ≤ 400 lines.

**Last file under 500 flips `max-lines` → `error`.**

### Group D — `complexity > 10` (17 violations, ~5 PRs)

**PR-D1: pointer/drag complexity** (3 violations)

- `packages/editor/src/services/pointer-orchestrator/pointer-orchestrator.service.ts` `onCanvasPointerMove` (20), `onCanvasPointerUp` (24), `_finishMarquee` (15) — extract mode handlers (`_handleDragMove`, `_handleMarqueeMove`, etc.).

**PR-D2: drag-resize inner loops** (3 violations)

- `drag-resize-rotate.service.ts` `snapToGuides` (18), `snapResizeEdges` (12), `handleResizeMove` (25) — likely auto-drops when Group B lands; if not, small handler-map pass.

**PR-D3: keyboard + message dispatch** (2 violations)

- `packages/editor/src/directives/editor-shortcuts/editor-shortcuts.directive.ts:47` `onGlobalKey` (31) — refactor switch to `Map<string, Command>`.
- `packages/collab/src/services/collab/collab.service.ts:161` `_handleMessage` (17) — handler map by event type.

**PR-D4: async generators** (3 violations)

- `packages/editor/src/services/ai-orchestrator/ai-orchestrator.service.ts:28` `generate` (18) — extract validation, prompt-build, response-parse.
- `packages/collab/src/services/collab/collab.service.ts:97` arrow (12) — small extraction.
- `packages/editor/src/services/layer-order/layer-order.service.ts:71` `reorderLayer` (14) — extract order-computation helper.

**PR-D5: remaining complexity** (6 violations)

- `tenant.service.ts` `createTenant` (11), `acceptInvite` (11), arrow (16) — extract validation guards.
- `packages/core/src/firebase/firebase.service.ts:40` constructor (11) — move init branches to private helpers.
- `packages/projects/src/services/project-api/project-api.service.ts:156` arrow (13) — expected to auto-resolve when Group C1 splits the file; if it survives the split, handled here.
- `packages/editor/src/components/editor/editor.component.ts:347` `onCanvasDrop` (14) — expected to land in `EditorCanvasEventsService` during Group C2 and be refactored there; if it survives the split, handled here.

**Group violation count**: 17 across D1 (3) + D2 (3) + D3 (2) + D4 (3) + D5 (6) = 17. Two of D5's six are expected to auto-resolve via Group C splits, so the actual PR-D5 workload is typically 4.

**Last complexity fix flips `complexity` → `error`. Phase 1.2 complete. All rules are `error`. No overrides anywhere.**

## Rollout order

1. **Phase 1.1** — CI + tooling skeleton with rules as `warn`, coverage baseline captured. Ships immediately.
2. **Phase 1.2a** — Groups A + B (mechanical, ~1 week).
3. **Phase 1.2b** — Group C (2 file splits, ~3–4 days).
4. **Phase 1.2c** — Group D in order D1 → D5, each its own PR (~2 weeks).

Total Phase 1.2: ~3–4 weeks of part-time work bundled with feature work, or ~1 week of focused effort.

## Error handling

- **ESLint autofix fails / leaves residue**: pre-commit fails the commit; developer re-runs `npm run lint -- --fix` and re-stages.
- **Coverage baseline drift from flaky tests**: 0.5% tolerance absorbs float noise; if a test suite is structurally flaky, it gets fixed (not excluded).
- **`scripts/check-coverage.mjs` missing a new package**: script fails with "unknown package `<path>`, add a baseline entry." Explicit, non-silent.
- **madge reports false positive**: use `madge --exclude` in the npm script to exclude specific regex patterns; documented in README if it ever comes up.
- **Husky hook blocks an emergency**: `git commit --no-verify` escape hatch preserved.

## Testing

Phase 1.1 is mostly configuration. Verification:

- Run `npm run verify` locally — all steps green on current `main`.
- Open a throwaway PR that intentionally violates a rule → CI red, expected rule named.
- Open a throwaway PR that drops a test → coverage check red.
- Open a throwaway PR that adds a test → coverage check names the package whose floor moved.

Phase 1.2 — each refactor PR keeps existing tests green and does not change public APIs of refactored services. Where a file is split (Group C), the existing test files stay pointed at the facade; new specs may be added for extracted classes but are not required unless code coverage dips below baseline.

## Open questions

None as of 2026-04-22. All decisions resolved in brainstorm:

- Single-job vs. split CI → single job.
- Package-level vs. global coverage floor → package-level.
- Ratchet tolerance → 0.5% drop / 1% rise.
- `--no-verify` escape hatch → kept.
- E2E in CI → deferred to Track 3.

## References

- Probe measurement of strict-rule violations: see commit that removed `probe-eslint.config.js` (temporary probe during brainstorm).
- Prior editor refactor commits (base for Group C2):
  - `374b8e8` refactor(editor): extract EditorCollabSyncService
  - `7f6d065` refactor(editor): extract EditorInspectorService
  - `38e1253` refactor(editor): extract EditorElementsStateService
  - `710f6bc` refactor(editor): extract EditorInlineEditService
