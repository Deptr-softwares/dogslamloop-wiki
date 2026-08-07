// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // visual.spec.js compares pixel-exact screenshots against committed
  // baselines, and Playwright names those per-platform (-win32 vs -linux)
  // because font rendering and antialiasing genuinely differ between OSes -
  // the same page is not the same image on two machines. Committing a Linux
  // set alongside the Windows one would mean regenerating BOTH on every CSS
  // change, and one of them always from a machine nobody is looking at.
  // So the visual suite stays what its own header says it is: a local
  // before/after tool for CSS work. Everything else - 162 specs, including
  // the layout assertions that check computed styles and bounding boxes
  // rather than pixels - runs in CI and is platform-independent.
  testIgnore: process.env.CI ? ['**/visual.spec.js'] : [],
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8123',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Static site, no build step - just serve the repo root.
  webServer: {
    command: 'python -m http.server 8123',
    url: 'http://localhost:8123/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
