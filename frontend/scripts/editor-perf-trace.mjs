import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES = 5;
const BASELINE_DIR = resolve(__dirname, 'perf-baselines');
// Port is configurable so the script can coexist with another dev server
// already bound to 4200 (common in devcontainers).
const PORT = Number(process.env.PERF_PORT ?? 4202);

const outputName = process.argv[2];
if (!outputName) {
  console.error('Usage: node scripts/editor-perf-trace.mjs <output-name>');
  console.error('  e.g. node scripts/editor-perf-trace.mjs 19.x');
  process.exit(2);
}

mkdirSync(BASELINE_DIR, { recursive: true });

console.log(`[perf] starting dev server on :${PORT}...`);
const dev = spawn(
  'npx',
  [
    'ng',
    'serve',
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--proxy-config',
    'proxy.conf.json',
  ],
  {
    cwd: resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    // New process group so we can SIGKILL all descendants (npx -> node -> ng)
    // and avoid orphaning the ng-serve child if this script throws.
    detached: true,
  },
);

const killDev = () => {
  if (dev.pid && !dev.killed) {
    try {
      process.kill(-dev.pid, 'SIGKILL');
    } catch {
      // process group may already be gone
    }
  }
};
process.on('exit', killDev);
process.on('SIGINT', () => {
  killDev();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killDev();
  process.exit(143);
});
const ready = new Promise((res, rej) => {
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    if (buf.includes('Local:') || buf.includes(`localhost:${PORT}`)) res();
  };
  dev.stdout.on('data', onData);
  dev.stderr.on('data', onData);
  setTimeout(() => rej(new Error(`dev server did not start on :${PORT} in 180s`)), 180_000);
});
await ready;
await new Promise((r) => setTimeout(r, 2000)); // settle

const samples = [];

try {
  for (let i = 0; i < SAMPLES; i++) {
    console.log(`[perf] sample ${i + 1}/${SAMPLES}`);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    await cdp.send('Performance.enable');

    await page.addInitScript(() => {
      window.__perf = { longTasks: 0, frames: 0 };
      new PerformanceObserver((list) => {
        window.__perf.longTasks += list.getEntries().length;
      }).observe({ type: 'longtask', buffered: true });
      const tickFrame = () => {
        window.__perf.frames++;
        requestAnimationFrame(tickFrame);
      };
      requestAnimationFrame(tickFrame);
    });

    await page.goto(`http://localhost:${PORT}/perf-fixture?perf=1`, {
      waitUntil: 'domcontentloaded',
    });
    // The dev server keeps a websocket alive for HMR, so 'networkidle' never
    // settles. Wait on the editor host element instead.
    await page.waitForSelector('mk-editor', { timeout: 30_000 });
    // Settle a bit so initial bootstrap work isn't attributed to the interaction.
    await page.waitForTimeout(500);

    const startMetrics = await cdp.send('Performance.getMetrics');

    // Drag text-1 200px right
    const target = page.locator('mk-editor [data-perf-id="text-1"]').first();
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(
        `[perf] sample ${i + 1}: boundingBox() returned null for [data-perf-id="text-1"] — interaction would be skipped, refusing to record a misleading sample`,
      );
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 20 });
    await page.mouse.up();

    // Enter inline edit mode via dblclick on the wrapper, then type into the
    // contenteditable. dblclick triggers the editor's onInlineEditDblClick
    // handler which flips contenteditable=true on mt-el-text.
    const wrapper = page.locator('mk-editor [data-perf-id="text-1"]').first();
    await wrapper.dblclick();
    // Wait for Angular to apply the contentEditable binding after the dblclick
    // handler runs. Without this, .count() races the change-detection cycle.
    const textArea = page.locator('mk-editor [data-perf-id="text-1"] [contenteditable="true"]');
    try {
      await textArea.first().waitFor({ state: 'attached', timeout: 2000 });
    } catch {
      throw new Error(
        `[perf] sample ${i + 1}: contenteditable inside [data-perf-id="text-1"] not found within 2s of dblclick — type interaction would be skipped, refusing to record a misleading sample`,
      );
    }
    await page.keyboard.type('hello world', { delay: 30 });
    // Blur to commit so the trace covers the commit code path too.
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    const endMetrics = await cdp.send('Performance.getMetrics');

    const delta = (name) => {
      const start = startMetrics.metrics.find((m) => m.name === name)?.value ?? 0;
      const end = endMetrics.metrics.find((m) => m.name === name)?.value ?? 0;
      return +(end - start).toFixed(6);
    };

    const perfWindow = await page.evaluate(() => window.__perf);

    samples.push({
      sampleIndex: i,
      scriptDurationMs: +(delta('ScriptDuration') * 1000).toFixed(3),
      taskDurationMs: +(delta('TaskDuration') * 1000).toFixed(3),
      layoutCount: delta('LayoutCount'),
      recalcStyleCount: delta('RecalcStyleCount'),
      layoutDurationMs: +(delta('LayoutDuration') * 1000).toFixed(3),
      recalcStyleDurationMs: +(delta('RecalcStyleDuration') * 1000).toFixed(3),
      longTasks: perfWindow.longTasks,
      frames: perfWindow.frames,
    });

    await browser.close();
  }
} catch (err) {
  killDev();
  throw err;
}

const median = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const middle = sorted.slice(1, -1);
  return middle.reduce((a, b) => a + b, 0) / middle.length;
};

const result = {
  capturedAt: new Date().toISOString(),
  outputName,
  interactionScriptVersion: 1,
  samples,
  median: {
    scriptDurationMs: +median(samples.map((s) => s.scriptDurationMs)).toFixed(3),
    taskDurationMs: +median(samples.map((s) => s.taskDurationMs)).toFixed(3),
    layoutCount: +median(samples.map((s) => s.layoutCount)).toFixed(3),
    recalcStyleCount: +median(samples.map((s) => s.recalcStyleCount)).toFixed(3),
    layoutDurationMs: +median(samples.map((s) => s.layoutDurationMs)).toFixed(3),
    recalcStyleDurationMs: +median(samples.map((s) => s.recalcStyleDurationMs)).toFixed(3),
    longTasks: +median(samples.map((s) => s.longTasks)).toFixed(3),
    frames: +median(samples.map((s) => s.frames)).toFixed(3),
  },
};

const outPath = resolve(BASELINE_DIR, `${outputName}.json`);
// Trailing newline keeps the file Prettier-clean (see frontend/.prettierrc).
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(`[perf] wrote ${outPath}`);
console.log(`[perf] median scriptDurationMs: ${result.median.scriptDurationMs}`);

killDev();
// Tiny grace period so SIGKILL has time to reap descendants before exit.
await new Promise((r) => setTimeout(r, 200));
process.exit(0);
