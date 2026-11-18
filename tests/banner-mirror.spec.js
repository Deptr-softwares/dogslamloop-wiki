// Hover Banners are mirrored into the repo (v1.2, scripts/fetch-banners.js),
// and data/banners.json says where each one is, with the first line of the
// character's Overview. The roster popup and each page's Discord preview read
// it.
//
// In the content gate: it checks what the regeneration job just wrote. So the
// assertions are about the RELATIONSHIP between the file and the folder, never
// about how many characters or banners there are - an owner or editor adding
// one must never turn this red (CLAUDE.md, the content gate).
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'banners.json'), 'utf8'));

test('every banner the file names is on the site, and nothing else is in the folder', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-banners.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
});

test('an entry is a banner on the site and a plain line, never a remote address or a style tag', () => {
  const fakeWindow = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8'))(fakeWindow);
  const strip = fakeWindow.stripStyleShortcodes;
  for (const [pageId, entry] of Object.entries(manifest)) {
    expect(Object.keys(entry).filter(k => k !== 'image' && k !== 'overview'), pageId).toEqual([]);
    // A local file: what keeps a hover off Supabase, and the Discord preview
    // on the site's own address.
    if ('image' in entry) expect(entry.image, pageId).toMatch(/^medias\/banners\/[a-z0-9_]+\.(webp|png|jpe?g|gif)$/);
    if ('overview' in entry) {
      expect(typeof entry.overview, pageId).toBe('string');
      expect(strip(entry.overview), `${pageId}'s line still has a style tag`).toBe(entry.overview);
      expect(entry.overview.length, pageId).toBeLessThanOrEqual(163);
    }
  }
});

test('the regeneration job mirrors banners after the browser install and before the pages are generated', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'regenerate.yml'), 'utf8');
  const install = yml.indexOf('npx playwright install');
  const mirror = yml.indexOf('run: node scripts/fetch-banners.js --write');
  const generate = yml.indexOf('run: npm run generate');
  expect(install, 'the browser install').toBeGreaterThan(-1);
  expect(mirror, 'shrinking needs the browser').toBeGreaterThan(install);
  expect(generate, 'the pages read data/banners.json').toBeGreaterThan(mirror);
});
