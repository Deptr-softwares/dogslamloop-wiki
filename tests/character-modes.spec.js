// Character modes and the Ultimate tab.
//
// A full character swaps their whole kit when they go ultimate, so the tabs
// stay and their contents change under a toggle. A base-only character has no
// second kit and gets one extra tab instead. Both are injected at runtime by
// js/character_modes.js rather than generated into the stub, so the tests here
// drive real pages and real clicks.
//
// The first test is the one that matters most: 22 characters declare no modes
// and every one of them has to keep rendering exactly as it did.
const { test, expect } = require('@playwright/test');

// Labels derived from js/character_tabs.js rather than restated: the claim
// here is about which tabs appear and in what order, not about their wording,
// and a second copy of the list goes stale the next time one is added.
const VOCAB = (() => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();
const labelsOf = (opts) => VOCAB.getCharacterTabs(opts).map(t => t.label);


// .from('page_data').select('*').eq('page_id', id).single()
function mockPageData(page, { desc = {}, frame = {} } = {}) {
  return page.addInitScript(({ desc, frame }) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);

            window.__pageDataReads = 0;

            client.from = (table) => {
              if (table !== 'page_data') return origFrom(table);
              const chain = {
                select() { return chain; },
                eq() { return chain; },
                single: async () => {
                  window.__pageDataReads++;
                  return { data: { desc_data: desc, frame_data: frame }, error: null };
                },
              };
              return chain;
            };

            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { desc, frame });
}

const move = (id, name) => ({
  id,
  name,
  stats: [{ label: 'Damage', value: '10' }],
});

// A full character: base kit plus one ultimate state, each with its own
// skills and its own write-up.
const MODED = {
  frame: {
    modes: [
      { id: 'base', label: 'Base Kit' },
      { id: 'shrine', label: 'Malevolent Shrine' },
    ],
    m1s: [move('base-m1', 'Base Jab')],
    skills: [move('base-skill', 'Base Cleave')],
    specials: [],
    modeData: {
      shrine: {
        m1s: [move('shrine-m1', 'Shrine Jab')],
        skills: [move('shrine-skill', 'Dismantle')],
        specials: [],
      },
    },
  },
  desc: {
    profile: { image: 'https://example.test/portrait.png', stats: [] },
    overview: [{ type: 'paragraph', content: 'The base kit overview.' }],
    counterplay: [],
    matchups: [],
    modeData: {
      shrine: {
        overview: [{ type: 'paragraph', content: 'The shrine overview.' }],
        counterplay: [],
        matchups: [],
      },
    },
  },
};

test('a character with no declared modes renders no toggle and no Ultimate tab', async ({ page }) => {
  // The regression guard for all 22 existing characters.
  await mockPageData(page, {
    frame: { m1s: [move('m1', 'Jab')], skills: [], specials: [] },
    desc: { overview: [{ type: 'paragraph', content: 'Nothing special.' }] },
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#character-mode-bar')).toBeHidden();
  await expect(page.locator('#nav-ultimateAtk')).toHaveCount(0);
  await expect(page.locator('#tab-ultimateAtk')).toHaveCount(0);

  // The tab strip is untouched: the same seven buttons, in the same order.
  const labels = await page.locator('.character-nav .btn-manga-text').allTextContents();
  expect(labels).toEqual(labelsOf());
  expect(errors).toEqual([]);
});

test('two declared modes render a toggle that actually swaps the kit', async ({ page }) => {
  await mockPageData(page, MODED);

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const bar = page.locator('#character-mode-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.character-mode-chip')).toHaveText(['Base Kit', 'Malevolent Shrine']);
  await expect(bar.locator('.character-mode-chip.active')).toHaveText('Base Kit');

  // Base kit first.
  await expect(page.locator('#tab-skills')).toContainText('Base Cleave');
  await expect(page.locator('#tab-overview')).toContainText('The base kit overview.');

  // Drive the real control.
  await bar.getByText('MALEVOLENT SHRINE').click();

  await expect(page.locator('#tab-skills')).toContainText('Dismantle');
  await expect(page.locator('#tab-skills')).not.toContainText('Base Cleave');
  await expect(page.locator('#tab-m1s')).toContainText('Shrine Jab');
  await expect(page.locator('#tab-overview')).toContainText('The shrine overview.');
  await expect(bar.locator('.character-mode-chip.active')).toHaveText('Malevolent Shrine');

  // And back, so the toggle is a toggle rather than a one-way door.
  await bar.getByText('BASE KIT').click();
  await expect(page.locator('#tab-skills')).toContainText('Base Cleave');

  expect(errors).toEqual([]);
});

test('switching mode leaves the Gallery tab alone', async ({ page }) => {
  // Gallery is the character's media, not one state's. A sentinel proves the
  // re-render genuinely skipped that container rather than happening to
  // rebuild it with the same (empty) contents.
  await mockPageData(page, MODED);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    const g = document.getElementById('tab-gallery');
    g.innerHTML = '<p id="gallery-sentinel">universal</p>';
  });

  await page.locator('#character-mode-bar').getByText('MALEVOLENT SHRINE').click();
  await expect(page.locator('#tab-skills')).toContainText('Dismantle');

  await expect(page.locator('#gallery-sentinel')).toHaveText('universal');
});

test('the mode lands in the URL so a link opens on the state that was shared', async ({ page }) => {
  await mockPageData(page, MODED);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  // Base is the canonical page: no ?mode= is written for it.
  expect(new URL(page.url()).searchParams.get('mode')).toBe(null);

  await page.locator('#character-mode-bar').getByText('MALEVOLENT SHRINE').click();
  await expect(page.locator('#tab-skills')).toContainText('Dismantle');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('shrine');
});

test('a deep link opens straight into the mode it names', async ({ page }) => {
  await mockPageData(page, MODED);
  await page.goto('/characters/Boomcat/index.html?mode=shrine', { waitUntil: 'networkidle' });

  await expect(page.locator('#tab-skills')).toContainText('Dismantle');
  await expect(page.locator('#character-mode-bar .character-mode-chip.active')).toHaveText('Malevolent Shrine');
});

test('a ?mode= naming a mode this character does not have falls back to base', async ({ page }) => {
  // Not a hypothetical: every resolver looks the name up in modeData, finds
  // nothing, and renders empty arrays - so getting this wrong is a blank page,
  // not a cosmetic slip.
  await mockPageData(page, MODED);
  await page.goto('/characters/Boomcat/index.html?mode=not-a-real-mode', { waitUntil: 'networkidle' });

  await expect(page.locator('#tab-skills')).toContainText('Base Cleave');
  await expect(page.locator('#character-mode-bar .character-mode-chip.active')).toHaveText('Base Kit');
  expect(new URL(page.url()).searchParams.get('mode')).toBe(null);
});

test('a ?mode= on a character with no modes at all still renders the page', async ({ page }) => {
  await mockPageData(page, {
    frame: { m1s: [move('m1', 'Jab')], skills: [move('s1', 'Cleave')], specials: [] },
    desc: { overview: [{ type: 'paragraph', content: 'Nothing special.' }] },
  });

  await page.goto('/characters/Boomcat/index.html?mode=shrine', { waitUntil: 'networkidle' });

  await expect(page.locator('#tab-skills')).toContainText('Cleave');
  await expect(page.locator('#character-mode-bar')).toBeHidden();
});

test('a base-only character gets an Ultimate tab after Counterplay', async ({ page }) => {
  await mockPageData(page, {
    frame: {
      m1s: [], skills: [], specials: [],
      ultimateAtk: [move('locust-ult', 'Locust Swarm')],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Locust_guy/index.html', { waitUntil: 'networkidle' });

  const labels = await page.locator('.character-nav .btn-manga-text').allTextContents();
  expect(labels).toEqual(labelsOf({ includeInjected: true }));

  // No mode toggle - a base-only character has exactly one kit.
  await expect(page.locator('#character-mode-bar')).toBeHidden();

  await page.locator('#nav-ultimateAtk').click();
  await expect(page.locator('#tab-ultimateAtk')).toBeVisible();
  await expect(page.locator('#tab-ultimateAtk')).toContainText('Locust Swarm');
});

test('the tabs bound at boot know to hide the Ultimate tab added after them', async ({ page }) => {
  // setupTabs used to close over the id list it was called with, so a tab
  // registered later was invisible to the six buttons already wired: clicking
  // Skills would show Skills while leaving Ultimate open underneath it.
  await mockPageData(page, {
    frame: { m1s: [move('m1', 'Jab')], skills: [], specials: [], ultimateAtk: [move('u', 'Big One')] },
    desc: { overview: [] },
  });

  await page.goto('/characters/Locust_guy/index.html', { waitUntil: 'networkidle' });

  await page.locator('#nav-ultimateAtk').click();
  await expect(page.locator('#tab-ultimateAtk')).toBeVisible();

  await page.locator('#nav-m1s').click();
  await expect(page.locator('#tab-m1s')).toBeVisible();
  await expect(page.locator('#tab-ultimateAtk')).toBeHidden();
});

test('an empty move tab says so instead of rendering a blank void', async ({ page }) => {
  await mockPageData(page, {
    frame: { m1s: [move('m1', 'Jab')], skills: [], specials: [] },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#tab-skills')).toContainText('Nothing has been recorded here yet.');
  await expect(page.locator('#tab-m1s')).not.toContainText('Nothing has been recorded here yet.');
});

test('one page_data row is read once per boot, not once per caller', async ({ page }) => {
  // Four callers race for the same row at boot (three move tabs plus the
  // descriptions), and character_modes.js makes five. They share one request.
  await mockPageData(page, MODED);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const reads = await page.evaluate(() => window.__pageDataReads);
  expect(reads, 'concurrent boot fetches are deduplicated').toBe(1);
});
