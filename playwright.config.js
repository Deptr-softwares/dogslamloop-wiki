// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
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
