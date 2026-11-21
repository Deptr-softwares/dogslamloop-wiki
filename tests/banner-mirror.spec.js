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
  new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'utility', 'character_tabs.js'), 'utf8'))(fakeWindow);
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

// --- THE NIGHTLY RUN ---
//
// The real script, run in a folder of its own (its ROOT is the folder above
// it) with the network replaced, as tests/portrait-mirror.spec.js does for
// portraits, so the test can write and the repo is never touched. The night
// an editor sets the first banner is the first time this path runs for real.
const STORE = 'https://example.supabase.co/storage/v1/object/public/wiki-media';
const para = (content) => ({ type: 'paragraph', content });

function mirrorFolder({ rows, previous, files }) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-mirror-'));
  const at = (...p) => path.join(tmp, ...p);
  for (const dir of ['scripts', 'data', 'js/utility', 'medias/banners']) fs.mkdirSync(at(dir), { recursive: true });
  for (const f of ['fetch-banners.js', 'shrink-to-webp.js']) fs.copyFileSync(path.join(ROOT, 'scripts', f), at('scripts', f));
  // The Overview lines are stripped with the site's own tag list.
  fs.copyFileSync(path.join(ROOT, 'js', 'utility', 'character_tabs.js'), at('js', 'utility', 'character_tabs.js'));
  if (previous) fs.writeFileSync(at('data', 'banners.json'), JSON.stringify(previous));
  for (const f of files || []) fs.writeFileSync(at('medias', 'banners', f), `old ${f}`);
  // RIFF....WEBP and small, so nothing here needs the shrinker's browser:
  // portrait-mirror.spec.js shrinks real images through the same module.
  fs.writeFileSync(at('fake-network.js'), `
    const rows = ${JSON.stringify(rows)};
    globalThis.fetch = async (url) => {
      if (url.includes('/rest/v1/page_data')) return { ok: true, status: 200, json: async () => rows };
      if (url.includes('flaky')) throw new Error('socket hang up');
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('RIFF0000WEBPnew ' + url).buffer };
    };`);
  return {
    at,
    run: (flag = '--write') => spawnSync(process.execPath, ['--require', at('fake-network.js'), at('scripts', 'fetch-banners.js'), flag], { cwd: tmp, encoding: 'utf8' }),
    file: (f) => fs.existsSync(at('medias', 'banners', f)) ? fs.readFileSync(at('medias', 'banners', f), 'utf8') : null,
    manifest: () => fs.readFileSync(at('data', 'banners.json'), 'utf8'),
    done: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

test('a banner is mirrored with its line, a broken one keeps its last good copy, and a removed one loses its file', () => {
  const m = mirrorFolder({
    rows: [
      { page_id: 'fine', desc_data: { profile: { banner: `${STORE}/fine.webp` }, overview: [para('Fine [b]line[/b].')] } },
      // The fetch fails, and it had a banner before.
      { page_id: 'flaky', desc_data: { profile: { banner: `${STORE}/flaky.webp` }, overview: [para('Flaky line.')] } },
      // A video set as the banner, on a character that never had one.
      { page_id: 'first', desc_data: { profile: { banner: `${STORE}/first.mp4` } } },
      // Its banner was taken out in the editor.
      { page_id: 'line_only', desc_data: { profile: {}, overview: [para('Only a line.')] } },
      { page_id: 'a_system_page', desc_data: { tabs: [] } },
    ],
    previous: {
      flaky: { image: 'medias/banners/flaky.webp', overview: 'Old flaky line.' },
      line_only: { image: 'medias/banners/line_only.webp', overview: 'Only a line.' },
    },
    files: ['flaky.webp', 'line_only.webp'],
  });
  try {
    const first = m.run();
    expect(first.status, `the run carries on:\n${first.stdout}${first.stderr}`).toBe(0);

    expect(JSON.parse(m.manifest())).toEqual({
      fine: { image: 'medias/banners/fine.webp', overview: 'Fine line.' },
      flaky: { image: 'medias/banners/flaky.webp', overview: 'Flaky line.' },
      line_only: { overview: 'Only a line.' },
    });
    expect(m.file('fine.webp')).toBe(`RIFF0000WEBPnew ${STORE}/fine.webp`);
    expect(m.file('flaky.webp'), 'the last good banner is kept').toBe('old flaky.webp');
    expect(m.file('line_only.webp'), 'a banner taken out loses its copy').toBeNull();

    // A yellow annotation on the run for each one, naming it.
    const warnings = first.stdout.split('\n').filter(l => l.startsWith('::warning'));
    for (const id of ['flaky', 'first']) expect(warnings.some(l => l.includes(id)), `${id} is named in a warning`).toBe(true);
    expect(warnings.some(l => l.includes('fine')), 'nothing is said about the one that worked').toBe(false);

    // The next night changes nothing, so the job has nothing to commit.
    const before = m.manifest();
    const second = m.run();
    expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
    expect(second.stdout).toContain('0 changed');
    expect(m.manifest()).toBe(before);

    // And the offline check agrees with what was written.
    const check = m.run('--check');
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
  } finally {
    m.done();
  }
});

test('an empty answer from Supabase changes nothing', () => {
  // An outage or a broken query, never "every banner is gone".
  const previous = { fine: { image: 'medias/banners/fine.webp', overview: 'Fine line.' } };
  const m = mirrorFolder({ rows: [], previous, files: ['fine.webp'] });
  try {
    const run = m.run();
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(JSON.parse(m.manifest())).toEqual(previous);
    expect(m.file('fine.webp')).toBe('old fine.webp');
  } finally {
    m.done();
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
