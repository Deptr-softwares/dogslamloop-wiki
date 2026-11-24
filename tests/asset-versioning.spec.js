// Cache skew between a fresh module and a stale shared dependency.
//
// The incident, 2026-08-10: GitHub Pages serves js/ with max-age=3600, so the
// first load after a deploy gave the browser a brand-new js/editor/core/editor-modes.js
// and an hour-old js/utility/site_utils.js. The new file called a helper the cached
// copy did not have yet, and the TypeError went straight through edit.html's
// boot try/catch - "Editor failed to initialize context", reported on the live
// site within minutes of the merge.
//
// The defence tested here: every URL carries one content hash, so a page and the
// files it loads are never a deploy apart. The modules also kept stand-ins for
// the helpers that day, until every copy of the shared file anywhere had them
// (docs/overseer.md). The last test keeps them out: a stand-in is a second copy
// of a shared rule, and a check that skips the call hides a file that failed to
// load instead of failing.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { sharedAssetVersion, SHARED_MODULES } = require('../scripts/asset-version.js');
const { collectHtml } = require('../scripts/stamp-assets.js');

const ROOT = path.join(__dirname, '..');

test('every page asks for the shared modules by their current content hash', async () => {
  // Derived from SHARED_MODULES rather than naming site_utils.js, so adding a
  // third shared module extends this test instead of silently escaping it.
  const version = sharedAssetVersion();
  const offenders = [];

  for (const file of collectHtml(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const moduleName of SHARED_MODULES) {
      const escaped = moduleName.replace('.', '\\.');
      const tags = html.match(new RegExp(`src="[^"]*js\\/${escaped}[^"]*"`, 'g'));
      if (!tags) continue;

      for (const tag of tags) {
        if (!tag.includes(`?v=${version}`)) {
          offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: ${tag}`);
        }
      }
    }
  }

  expect(offenders, 'run `npm run generate` to restamp').toEqual([]);
});

test('the hash actually changes when a shared module does', async () => {
  // A version that never moves is worse than no version: it pins the stale
  // copy in place instead of busting it.
  const { stampSharedAssets } = require('../scripts/asset-version.js');

  const tags = SHARED_MODULES.map(n => `<script src="js/${n}"></script>`).join('');
  const before = stampSharedAssets(tags, 'aaaaaaaa');
  const after = stampSharedAssets(before, 'bbbbbbbb');

  // Every shared module, not just the first: a regex that matched one name
  // and missed the other would leave half the pair unstamped.
  SHARED_MODULES.forEach(n => {
    expect(before, `${n} must be stamped`).toContain(`js/${n}?v=aaaaaaaa`);
    expect(after, `${n} must be restamped`).toContain(`js/${n}?v=bbbbbbbb`);
  });
  expect(after, 'restamping replaces the old version rather than appending').not.toContain('aaaaaaaa');
});

test('the served page really carries the query, not just the file on disk', async ({ request }) => {
  const res = await request.get('/edit.html');
  const html = await res.text();
  expect(html).toMatch(/src="js\/utility\/site_utils\.js\?v=[0-9a-f]{8}"/);
  expect(html).toMatch(/src="js\/utility\/character_tabs\.js\?v=[0-9a-f]{8}"/);
});

test('the mode helpers are defined once, and no file stands in for them', () => {
  const home = {
    isBaseMode: 'js/utility/site_data.js',
    getCharacterModes: 'js/utility/site_data.js',
    BASE_MODE_ID: 'js/utility/site_data.js',
    unwrapModeDelta: 'js/utility/submission_delta.js',
  };
  const wrong = [];
  for (const file of SHARED_MODULES.map(n => `js/${n}`)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const [name, definedIn] of Object.entries(home)) {
      const defines = new RegExp(`window\\.${name}\\s*=(?!=)`).test(src);
      if (defines !== (file === definedIn)) wrong.push(`${file} ${defines ? 'defines' : 'does not define'} ${name}`);
      if (new RegExp(`typeof window\\.${name}\\b`).test(src)) wrong.push(`${file} checks whether ${name} exists`);
    }
  }
  expect(wrong).toEqual([]);
});
