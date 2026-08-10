// Cache skew between a fresh module and a stale shared dependency.
//
// The incident, 2026-08-10: GitHub Pages serves js/ with max-age=3600, so the
// first load after a deploy gave the browser a brand-new js/editor-modes.js
// and an hour-old js/site_utils.js. The new file called a helper the cached
// copy did not have yet, and the TypeError went straight through edit.html's
// boot try/catch - "Editor failed to initialize context", reported on the live
// site within minutes of the merge.
//
// Two defences, both tested here: the URL carries a content hash so the two
// files can never be a deploy apart, and the modules degrade instead of
// throwing if they somehow are.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { siteUtilsVersion } = require('../scripts/asset-version.js');
const { collectHtml } = require('../scripts/stamp-assets.js');

const ROOT = path.join(__dirname, '..');

test('every page asks for site_utils.js by its current content hash', async () => {
  const version = siteUtilsVersion();
  const offenders = [];

  for (const file of collectHtml(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    const tags = html.match(/src="[^"]*js\/site_utils\.js[^"]*"/g);
    if (!tags) continue;

    for (const tag of tags) {
      if (!tag.includes(`?v=${version}`)) {
        offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: ${tag}`);
      }
    }
  }

  expect(offenders, 'run `npm run generate` to restamp').toEqual([]);
});

test('the hash actually changes when site_utils.js does', async () => {
  // A version that never moves is worse than no version: it pins the stale
  // copy in place instead of busting it.
  const { stampSiteUtils } = require('../scripts/asset-version.js');

  const before = stampSiteUtils('<script src="js/site_utils.js"></script>', 'aaaaaaaa');
  const after = stampSiteUtils(before, 'bbbbbbbb');

  expect(before).toContain('?v=aaaaaaaa');
  expect(after).toContain('?v=bbbbbbbb');
  expect(after, 'restamping replaces the old version rather than appending').not.toContain('aaaaaaaa');
});

test('the served page really carries the query, not just the file on disk', async ({ request }) => {
  const res = await request.get('/edit.html');
  const html = await res.text();
  expect(html).toMatch(/src="js\/site_utils\.js\?v=[0-9a-f]{8}"/);
});

test('a character page degrades rather than dying when site_utils is behind', async ({ page }) => {
  // Simulates exactly the skew that happened: the shared helpers are missing,
  // the page-level modules are current. The page must still render its
  // content; only the state toggle is allowed to go missing.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      delete window.getCharacterModes;
      delete window.isBaseMode;
    }, { once: true });
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('.character-nav .btn-manga')).toHaveCount(7);
  await expect(page.locator('#character-mode-bar')).toBeHidden();
  expect(errors, 'a missing helper must not throw').toEqual([]);
});

test('the editor degrades rather than dying when site_utils is behind', async ({ page }) => {
  // The exact reported failure. Before the guards, initEditorModes threw here
  // and editor-core.js reported "Editor failed to initialize context" - the
  // whole editor, not just the states feature.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      delete window.getCharacterModes;
      delete window.isBaseMode;
      delete window.BASE_MODE_ID;
    }, { once: true });
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  const survived = await page.evaluate(async () => {
    window.currentEditorPageType = 'character';
    const desc = { overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {} };
    const frame = { m1s: [], skills: [], specials: [] };
    window.originalCloudDescData = desc;
    window.originalCloudFrameData = frame;

    await window.initEditorModes('testchar', desc, frame);
    window.applyEditorModeView();

    return {
      // The editor still points at the real data, so edits go where they should.
      descIsMaster: window.currentEditorDescData === desc,
      frameIsMaster: window.currentEditorFrameData === frame,
      mode: window.editorActiveMode,
    };
  });

  expect(survived.descIsMaster).toBe(true);
  expect(survived.frameIsMaster).toBe(true);
  expect(survived.mode).toBe('base');
  expect(errors).toEqual([]);
});

test('the admin queue stands in for the helpers it needs', async ({ page }) => {
  // admin-core.js installs verbatim copies when site_utils is behind, because
  // a reviewer losing the whole queue is worse than any feature going missing.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isBaseMode', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'unwrapModeDelta', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'getCharacterModes', { configurable: true, writable: true, value: undefined });
  });

  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const standIns = await page.evaluate(() => ({
    isBaseMode: typeof window.isBaseMode,
    unwrapModeDelta: typeof window.unwrapModeDelta,
    getCharacterModes: typeof window.getCharacterModes,
    // And they behave identically to the real ones.
    unwrapped: window.unwrapModeDelta('mode', 'ultimate::move::skills::x'),
    plain: window.unwrapModeDelta('matchup', 'Sukuna'),
  }));

  expect(standIns.isBaseMode).toBe('function');
  expect(standIns.unwrapModeDelta).toBe('function');
  expect(standIns.getCharacterModes).toBe('function');
  expect(standIns.unwrapped).toEqual({ modeId: 'ultimate', scope: 'move', key: 'skills::x' });
  expect(standIns.plain).toEqual({ modeId: null, scope: 'matchup', key: 'Sukuna' });
});
