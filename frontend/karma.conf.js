const fs = require('fs');
const path = require('path');

if (!process.env.CHROME_BIN) {
  const base = '/home/vscode/.cache/ms-playwright/';
  try {
    const dir = fs
      .readdirSync(base)
      .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
      .map((d) => path.join(base, d, 'chrome-linux/chrome'))
      .find((p) => fs.existsSync(p));
    if (dir) process.env.CHROME_BIN = dir;
  } catch {}
}

module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    reporters: ['progress', 'kjhtml', 'coverage'],
    coverageReporter: {
      dir: path.join(__dirname, './coverage'),
      subdir: '.',
      reporters: [
        { type: 'text-summary' },
        { type: 'html' },
        { type: 'json-summary', file: 'coverage-summary.json' },
        { type: 'json', file: 'coverage-final.json' },
      ],
    },
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    singleRun: true,
    restartOnFileChange: false,
  });
};
