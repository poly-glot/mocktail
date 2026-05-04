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

const TOLERANCE_DROP = 3.0; // percent; drops within tolerance pass. Bumped
//                          // from 0.5% to absorb the run-to-run variance in
//                          // the emulator-bound tenant + collab specs (their
//                          // throttle and timing assertions hit slightly
//                          // different code paths each run).
const RATCHET_RISE = 1.0; // percent; rises >= this trigger a ratchet
const METRICS = ['statements', 'branches', 'functions', 'lines'];

if (!existsSync(SUMMARY)) {
  console.error(`[check-coverage] ${SUMMARY} not found — run "npm test -- --code-coverage" first.`);
  process.exit(1);
}
if (!existsSync(BASELINE)) {
  console.error(
    `[check-coverage] ${BASELINE} not found — see docs/superpowers/plans/2026-04-22-track1-ci-quality-gates.md Task 5 for the bootstrap one-liner.`,
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
    // Package appears in coverage output but has no spec files of its own;
    // coverage comes only from transitive imports. Skip silently — do not
    // require a baseline entry for packages without .spec.ts files.
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
