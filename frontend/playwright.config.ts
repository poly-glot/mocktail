import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against the full local stack:
 *   - Zig backend on :8082 (must be started manually — `zig build run` in
 *     backend/ — we don't auto-start it because it needs Linux + proto
 *     codegen that differs across hosts).
 *   - Angular dev server on :4200 with proxy.conf.json forwarding /api -> 8082.
 *
 * If CI needs a headless full-stack run, wire both processes into the
 * `webServer` array below.
 */

const PORT = 4200;
const baseURL = process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'npm start',
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
      },
});
