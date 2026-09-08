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
  // A suite this size cannot be all-or-nothing on a single attempt. With ~650
  // tests, even a 0.1% per-test flake rate means 1 - 0.999^650 ~= 48% of runs
  // show exactly one failure - which is what CI did repeatedly through v0.13,
  // a different test each time while local runs stayed clean.
  //
  // Retries are not a way to stop looking. A test that passes on retry is
  // reported as "flaky" rather than silently green, so it stays visible and
  // fixable; what it no longer does is block a merge on a timing window that
  // closed on a shared runner. Three genuine ones were found and fixed this
  // way in v0.13 (a 1400ms marker, a boot race, a CSS transition), and each
  // was a real defect in the test rather than in the site.
  //
  // Zero locally: a flake on a fast machine is worth seeing immediately.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:8123',
    trace: 'retain-on-failure',
    // THE SUITE RUNS AS A RETURNING VISITOR (v0.18 F6/F7).
    //
    // The editor shows a one-time notice on a first visit, and every test gets
    // a fresh browser context with empty localStorage - so without this, that
    // modal opens on top of the page in all 59 specs that load edit.html and
    // times out their first click. That is not a flake and not a bug in the
    // notice: a modal blocking the page until it is dismissed is exactly what
    // the owner asked for.
    //
    // Seeded HERE rather than dismissed in each spec. Fifty-nine files would
    // have to remember, and so would every editor spec written afterwards -
    // and the thing they would all be working around is not what any of them
    // is about. The suite's subject is the editor, not somebody's first
    // sight of it.
    //
    // tests/editor-notices.spec.js overrides this back to empty, because a
    // first visit is precisely what IT is about.
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:8123',
        localStorage: [
          { name: 'dsl_notice_seen_editor', value: '1' },
          { name: 'dsl_notice_seen_mediaLibrary', value: '1' },
        ],
      }],
    },
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
