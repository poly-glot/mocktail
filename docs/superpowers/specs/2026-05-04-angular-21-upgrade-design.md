# Angular 19 → 21 Upgrade & Modernisation — Design

**Status:** approved, awaiting implementation plan
**Author session:** brainstorm 2026-05-04
**Branch (proposed):** `chore/angular-21-upgrade`, branched off `main` after `refactor/editor-god-object-split` merges.

## Goal

Move the `frontend/` Angular 19 application to Angular 21 and adopt the stable code-quality and rendering improvements introduced across v20 and v21. Land with an empirical before/after number that shows the rendering work was worth doing.

## Scope

**In:**
- `ng update`-driven version bumps `19 → 20 → 21`, with required peers (`@angular/build`, `@angular/cli`, `angular-eslint`, `typescript`).
- Bumping `lucide-angular` to whatever release declares Angular 21 peer support (only because it would otherwise block the bump).
- Three targeted code-quality wins that are stable in 21 and a clear fit for this codebase: `provideRouter` migration, **enforcing `OnPush` via `@angular-eslint/prefer-on-push-component-change-detection` at `error` level** (every component already declares it but the rule today is `warn` — bumping to `error` prevents future regressions), and converting residual `@Input`/`@Output` → `input()`/`output()`.
- Adopting **zoneless change detection** as the rendering improvement available without SSR.
- A throwaway perf-trace script that captures one before/after number to validate the rendering claim.

**Out (each is a separately-justified deferral):**
- SSR / incremental hydration — would require a hosting-pipeline change and re-validation of Firestore reads currently assuming browser context. Separate brainstorm.
- Firebase 10 → 11/12 — the C5/C6/C7 `firestoreSignal` layer makes this richer than a bump. Separate brainstorm.
- Karma → Vitest/Jest migration — Karma still works through v21. Real but separate.
- Signal forms — developer preview only.
- Selectorless components — developer preview only.
- `.component.ts` filename style guide change — mass rename hides real review signal; deferred.
- Material 3 — codebase doesn't use Material; nothing to adopt.
- Coverage ratchet tightening (3.0% → 0.5%) — already an open follow-up in repo memory; stays separate.
- Wip-commit cleanup on `refactor/editor-god-object-split` — separate concern.

## Constraints accepted from existing project state

- Verify gate is `npm run verify` (lint + lint:scss + format:check + typecheck + test --code-coverage + deps:check + per-package coverage ratchet) and stays green at every commit.
- 22 emulator-bound test failures are the known baseline; no change.
- Coverage ratchet stays at `TOLERANCE_DROP = 3.0%`.
- Run inside the devcontainer for the test gate (host node_modules are linux-arm64).
- Pure SPA on Firebase Hosting; no SSR. Hydration-class wins are not on the table.

## Approach

Three approaches were considered (linear-by-phase, interleaved bump+sweep, sweeps-first).

**Selected: linear-by-phase.** Each phase is a discrete commit, each commit reverts cleanly, each commit has a single semantic intent. Trades calendar time for bisect clarity and isolated revertability of the two riskiest commits (the v21 bump and the zoneless cutover).

## Phase plan (8 commits on a single branch)

> **Amendment 2026-05-04 (post-spec, pre-plan):** the original design called for P4a–P4h, one OnPush-sweep commit per package. An empirical audit showed all 32 components in the codebase already declare `OnPush` (the recent god-object refactor shipped them that way). The 8 sweep commits would land zero diffs. Replaced with a single P4 that bumps the existing `@angular-eslint/prefer-on-push-component-change-detection` rule from `warn` to `error` so future components can't ship without it. Net change: 15 commits → 8 commits.
>
> **Other amendments documented at the same time:** P3 stripped of `withComponentInputBinding()` (behaviour change, not mechanical); P5 names the canonical `signal-input-migration` / `signal-output-migration` schematics rather than vague "v19+ schematic".

| # | Commit message | What it does |
|---|---|---|
| P0 | `chore(perf): baseline editor interaction trace pre-upgrade` | Adds `frontend/scripts/editor-perf-trace.mjs` + fixture. Runs it once. Commits captured baseline to `frontend/scripts/perf-baselines/19.x.json`. |
| P1 | `chore(deps): bump Angular 19 → 20 via ng update` | `ng update @angular/core@20 @angular/cli@20 @angular/build@20`. `angular-eslint@20`. `typescript@~5.8`. **Schematic-applied diffs only.** |
| P2 | `chore(deps): bump Angular 20 → 21 via ng update` | Same shape as P1, to v21. `typescript@~5.9`. `lucide-angular` to its v21-peer release. |
| P3 | `refactor(bootstrap): replace importProvidersFrom(AppRoutingModule) with provideRouter` | Add `src/app/app.routes.ts`. Replace `importProvidersFrom(AppRoutingModule)` in `main.ts` with `provideRouter(routes)`. Delete `src/app/app-routing.module.ts`. Pure mechanical replacement — no router-feature opt-ins. |
| P4 | `chore(eslint): enforce OnPush via prefer-on-push-component-change-detection at error level` | One-line edit in `frontend/eslint.config.js`: rule level `'warn'` → `'error'`. Verify zero violations (audit shows 32/32 components already OnPush). |
| P5 | `refactor(*): convert remaining @Input/@Output to input()/output()` | Run the canonical signal-input/output migration schematics over the ~10 holdouts. `@HostBinding`/`@HostListener` stay. Single commit. |
| P6 | `feat(perf): adopt zoneless change detection` | Drop `zone.js` from polyfills + dependency. Replace `provideZoneChangeDetection({ eventCoalescing: true })` with `provideZonelessChangeDetection()`. Drop `zone.js/testing` from `karma.conf.js`. Fix CD/spec fallout in this same commit. |
| P7 | `chore(perf): record post-upgrade editor interaction trace + delta` | Re-run the P0 script. Save to `frontend/scripts/perf-baselines/21.x-zoneless.json`. Update this design doc with the delta numbers. |

## Per-phase scope detail

### P1, P2 — version bumps

**Hard rules:**
- No hand edits beyond what schematics produce. If a schematic leaves something half-converted, that becomes its own follow-up commit, not bundled in.
- `npm run verify` inside the devcontainer is the acceptance bar.
- If a schematic-induced break can't be fixed in scope (≤ ~2 hours), abort and revert; pin a minor and try again or wait for a schematic fix.
- `package-lock.json` regenerates as part of the commit and is checked in.

### P3 — `provideRouter` migration

- `src/main.ts`: `importProvidersFrom(AppRoutingModule)` → `provideRouter(routes)`.
- New file: `src/app/app.routes.ts` exporting `routes: Routes`.
- Delete: `src/app/app-routing.module.ts`.
- **No router-feature opt-ins.** `withComponentInputBinding()`, `withViewTransitions()`, etc. are out of scope here — each is a behaviour change and belongs in its own deliberate commit if anyone wants it. P3 is a pure mechanical replacement.

### P4 — enforce OnPush via ESLint

- All 32 `@Component` classes in the codebase already declare `ChangeDetectionStrategy.OnPush` (audited 2026-05-04). No file edits to components are required.
- `frontend/eslint.config.js` already includes `'@angular-eslint/prefer-on-push-component-change-detection': 'warn'`. Bump to `'error'`.
- Verify with `npm run lint` — should be zero new errors (audit confirms zero current violations of this rule).
- Effect: any new component shipped without `ChangeDetectionStrategy.OnPush` will fail CI.

### P5 — `@Input`/`@Output` → `input()`/`output()` sweep

- ~10 holdout files. Use the canonical Angular schematics rather than hand-editing — they handle `required: true` → `input.required<T>()` and aliases correctly:
  - `ng generate @angular/core:signal-input-migration`
  - `ng generate @angular/core:signal-output-migration`
- Verify exact schematic names with `ng generate --help` at execution time; Angular has renamed migration schematics between minors.
- `@HostBinding`/`@HostListener` stay (still idiomatic in v21).

### P6 — zoneless cutover

**Mechanical changes (small):**
- `angular.json` build target: `"polyfills": ["zone.js"]` → `"polyfills": []`.
- `angular.json` test target: `"polyfills": ["zone.js", "zone.js/testing"]` → `"polyfills": []`.
- `src/main.ts`: `provideZoneChangeDetection({ eventCoalescing: true })` → `provideZonelessChangeDetection()`.
- `package.json`: remove `zone.js` dependency.

(`karma.conf.js` does not reference zone.js — test polyfills are in `angular.json` under the `@angular/build:karma` builder.)

**Audit surface (the real work):**
- Direct `setTimeout` / `Promise.then` whose result is read in a template — wrap in `signal()` or move to `afterNextRender`.
- Firebase callbacks not wired through `firestoreSignal()` (the C6 adapter covers Firestore reads; check Auth state listeners and any Storage uploads).
- `WebsocketService` message handlers that mutate state — explicit `markForCheck` or signal wrap.
- Spec sites using `fakeAsync(() => { ... tick(); ... })` — works without Zone but assertion timing may shift; expect a few brittle specs.

**Acceptance bar:** `npm run verify` green inside the devcontainer.

### P0, P7 — perf measurement script

**Script:** `scripts/editor-perf-trace.mjs`. Node script using Playwright (already a dev dep).

**What it does, in order:**
1. Spin up `npm start` in the background; wait for `http://localhost:4200`.
2. Launch Chromium via Playwright; open the editor route on a deterministic seeded fixture project.
3. Wait for `networkidle` + first canvas paint.
4. Run a fixed interaction script: drag one element 200px, type "hello world" into a text element, switch pages twice. Same input every run.
5. While interactions run, collect via Chrome DevTools Protocol:
   - `Performance.getMetrics()` deltas: `LayoutCount`, `RecalcStyleCount`, `LayoutDuration`, `RecalcStyleDuration`, `ScriptDuration`, `TaskDuration`.
   - Long-task count via `PerformanceObserver({ type: 'longtask' })`.
   - Frame count via `requestAnimationFrame` ticks.
6. Repeat the interaction script 5 times in fresh page contexts; drop high and low; average the middle three.
7. Emit JSON:
   ```json
   {
     "capturedAt": "2026-05-04T...",
     "angularVersion": "19.x",
     "zone": true,
     "interactionScriptVersion": 1,
     "samples": [...],
     "median": { "scriptDurationMs": ..., "layoutCount": ..., "longTasks": ..., "frames": ... }
   }
   ```
8. Print human-readable summary to stdout.

**Fixture:**
- `scripts/perf-baselines/fixture.json` — small project (one page, ~12 elements covering text/heading/image/icon/list/divider). Hand-crafted, committed once in P0.
- Loaded via a dev-only route `/perf-fixture` that bypasses Firestore and pushes the fixture into `WorkspaceStore` directly. Only registered when `NG_DEV_PERF=1` env var is set on the dev server. Zero production cost.

**Output paths:**
- `scripts/perf-baselines/19.x.json` — committed in P0.
- `scripts/perf-baselines/21.x-zoneless.json` — committed in P7.

**Explicitly NOT done by this script:**
- Not added to `npm run verify`.
- No regression threshold, no CI integration.
- No bundle-size measurement (`ng build --stats-json` exists for that).
- No Web Vitals / TTFB / TTI — those are SSR/network metrics, not the workload being changed.

**Acceptance bar for "rendering improvements shipped":** P7 `scriptDurationMs` median ≤ P0 `scriptDurationMs` median. If it isn't, the P7 commit message says so honestly and we have a real conversation about whether the upgrade still pays off on its other merits.

**Caveats baked in:**
- Both samples must come from the same machine. Easiest: run both inside the devcontainer.
- 5 samples is small; variance will be high on micro-metrics. Anchor on `scriptDurationMs`; it's the most stable.

## Verification

- `npm run verify` is the gate at every commit. Definition unchanged.
- 22 emulator-bound failures stay the known baseline — same as today; opt-in via running emulators.
- Per-package coverage ratchet (`scripts/check-coverage.mjs`, 3.0% tolerance) stays as-is.
- Playwright e2e (`playwright test`) runs once after P7 lands as a smoke check; not gated on every commit (matches current practice).
- The P0/P7 perf script is **not** a test. It produces a number. It does not pass or fail.

## Abort criteria

| Phase | Trigger | Action |
|---|---|---|
| P1 / P2 | Schematic output fails verify and the fix isn't obvious in ≤ ~2 hours | Abort. Revert. File schematic issue or pin a minor and retry. Don't hand-edit a way out. |
| P4 | The bumped rule produces unexpected violations (shouldn't happen — audit shows zero) | If a violation appears, the offending component is missing `OnPush`. Add it to the same commit. If for any reason a component genuinely cannot be `OnPush`, leave a `// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection` plus a `// FIXME(angular-21-upgrade):` note. |
| P6 | More than 5 specs go red and root cause isn't `fakeAsync`/`tick()` brittleness | Revert P6 entirely. Keep P0–P5. Ship the upgrade without zoneless. Zoneless becomes its own future brainstorm. |

## Rollback

- Each commit reverts cleanly with `git revert <sha>`.
- P5 may need an `npm install` after revert because lockfile lines move; otherwise mechanical.
- Branch isn't pushed until P7 lands green; rollback before then is `git reset --hard <sha>`.
- Once merged, the same per-commit revert story applies — each phase is a discrete revert target.

## Success criteria

1. `frontend/` is on Angular 21.x stable across all `@angular/*` packages, `@angular/cli`, `@angular/build`, `angular-eslint`, with `typescript@~5.9`.
2. `zone.js` is removed from `package.json` and from both the build- and test-target `polyfills` arrays in `angular.json`. (`karma.conf.js` is unrelated — it never referenced zone.js.)
3. `provideRouter` replaces `importProvidersFrom(AppRoutingModule)`.
4. `@angular-eslint/prefer-on-push-component-change-detection` is set to `'error'` in `frontend/eslint.config.js`; `npm run lint` reports zero violations.
5. No `@Input` or `@Output` decorator remains anywhere in `packages/*`.
6. `npm run verify` green inside the devcontainer at the tip of `chore/angular-21-upgrade`.
7. `scripts/perf-baselines/21.x-zoneless.json` median `scriptDurationMs` is ≤ `19.x.json` median, OR the P7 commit message and this design doc record the regression and the reason for shipping anyway.

## Outcome (recorded 2026-05-04, P7)

Captured with `scripts/editor-perf-trace.mjs` (5 samples each, drop high+low, average middle three) inside the devcontainer. Baseline at `b9a3310`; endline at the tip of `chore/angular-21-upgrade` post-zoneless.

| Metric | 19.x baseline | 21.x zoneless | Delta |
|---|---|---|---|
| scriptDurationMs | 45.533 | 35.589 | -9.944 (-21.8%) |
| taskDurationMs | 166.568 | 136.075 | -30.493 (-18.3%) |
| layoutCount | 33 | 33 | 0.000 (0.0%) |
| recalcStyleCount | 33 | 33 | 0.000 (0.0%) |
| layoutDurationMs | 18.822 | 16.541 | -2.281 (-12.1%) |
| recalcStyleDurationMs | 5.963 | 5.367 | -0.596 (-10.0%) |
| longTasks | 1 | 0.667 | -0.333 (-33.3%) |
| frames | 95 | 92.667 | -2.333 (-2.5%) |

**Acceptance bar (scriptDurationMs median ≤ baseline):** met. Median `scriptDurationMs` dropped from 45.533ms to 35.589ms (-9.944ms, -21.8%). Every other timing metric improved as well; `layoutCount` and `recalcStyleCount` are unchanged (the editor still runs the same number of layout/style passes — they're just shorter), and `frames` ticked down ~2.5% which is within sample noise for a fixture that doesn't exercise frame-rate-sensitive paths.

### Phase commit shas (on chore/angular-21-upgrade)

| Phase | SHA | Subject |
|---|---|---|
| P0 | b9a3310 | chore(perf): baseline editor interaction trace pre-upgrade |
| P1 | 007753a | chore(deps): bump Angular 19 -> 20 via ng update |
| P2 | 3e73fa4 | chore(deps): bump Angular 20 -> 21 via ng update |
| P3 | 4d22cc0 | refactor(bootstrap): replace importProvidersFrom(AppRoutingModule) with provideRouter |
| P4 | e182e75 | chore(eslint): enforce OnPush on all components |
| P5 | 4329f4f | refactor(*): convert remaining @Output to output() |
| P6 | db2033e | feat(perf): adopt zoneless change detection |
| P7 | e521690 | chore(perf): record post-upgrade editor interaction trace |

### Follow-ups not addressed in this branch

- **Verify-gate gap (P2 finding):** `npm run verify` uses `tsc -p tsconfig.json --noEmit` for type-checking, which does NOT run Angular's template type-checker. v21's tightening of `@HostListener('document:keydown.<key>', ['$event'])` `$event` narrowing (from `KeyboardEvent` to `Event`) was caught only at `ng build`/`ng serve` time, not by the verify gate. Consider adding `ng build --configuration=development --no-progress` or running `ngc` standalone to the verify gate so this class of failure is caught earlier. Three callsites were widened in commit `3e73fa4`.
- **P5 schematic noise (P5 finding):** the v21 `output-migration` schematic inserted four false-positive `// TODO: The 'emit' function requires a mandatory void argument` comments in `image-library-panel.component.ts`, `layers-panel.component.ts`, and `palette.component.ts` (two locations). They typecheck fine — `output<void>().emit()` with no argument compiles cleanly in v21. Could be removed in a tiny follow-up `chore(editor): drop schematic noise TODOs from output() void emitters`. Not blocking.
- **Schematic name renamed in v21:** the original plan referenced `signal-output-migration`; the actual v21 schematic is `output-migration` (no `signal-` prefix). Documented in commit `4329f4f`. The plan's text could be updated for future readers, though by the time anyone re-uses this plan the schematic name will likely have changed again.
- **Optional v21 migrations skipped:** `use-application-builder` (build system migration) and `router-current-navigation` (deprecated `Router.getCurrentNavigation` → `Router.currentNavigation` signal). Both deliberately deferred to keep this branch tightly scoped.
- **Coverage ratchet at 3.0% tolerance** (referenced in repo memory) — listed in the original spec's "out" list, still deferred to a separate follow-up.
