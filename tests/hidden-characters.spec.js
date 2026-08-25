// v0.16 feature 3: Hidden Characters.
//
// A character playable only in a Private Server. The owner was explicit that
// these are "only playable in a Private Server - basically people know about
// them, they are just hidden away from the Public and Ranked games." Publicly
// known, not secret - which matters, because this repository is public and the
// page, its URL and its generated stub are committed regardless. `isHidden`
// keeps a character out of the roster listing and does nothing else.
//
// It REPLACES the "Hide WIP" button rather than joining it: all 44 character
// entries are currently isWip, so that button emptied the roster, and whether a
// page is finished is the owner's business rather than a reader's filter.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- THE GENERATOR ---

test('a hidden row becomes isHidden in the registry, and an ordinary one stays absent', () => {
  const { buildNavigation } = require(path.join(ROOT, 'scripts', 'fetch-registry.js'));
  const nav = buildNavigation([
    { nav_id: 'Secret', name: 'Secret', url: 'characters/Secret/index.html', status: 'live',
      category: 'Characters', sort_order: 1, page_type: 'character', page_id: 'secret',
      edit_role: 'open', is_hidden: true },
    { nav_id: 'Normal', name: 'Normal', url: 'characters/Normal/index.html', status: 'live',
      category: 'Characters', sort_order: 2, page_type: 'character', page_id: 'normal',
      edit_role: 'open', is_hidden: false },
  ]);

  const chars = nav.Characters;
  expect(chars[0].isHidden, 'the hidden one is marked').toBe(true);
  // Absent, not false: every other flag here is omitted when off, and writing
  // isHidden:false onto all 52 entries would be an enormous diff for a default
  // nothing reads.
  expect('isHidden' in chars[1], 'an ordinary one carries nothing').toBe(false);
});

test('the migration adds the column with a safe default', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260825000000_hidden_characters.sql'), 'utf8');
  // DEFAULT false is what makes this behaviour-preserving by construction: all
  // 52 existing rows keep the visibility they have, with no backfill.
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "is_hidden" boolean NOT NULL DEFAULT false/);
  // site_pages is granted ON TABLE, not column by column, so a new column
  // inherits the existing grants and a new one here would only be a second
  // place for the two to disagree.
  expect(sql, 'no policy or grant is invented for a column add').not.toMatch(/CREATE POLICY|GRANT /);
});

// --- THE ROSTER ---

const ROSTER = [
  { id: 'A', name: 'Public One', url: 'characters/A/index.html', archetype: 'Rushdown', tier: 'A' },
  { id: 'B', name: 'Private Only', url: 'characters/B/index.html', archetype: 'Rushdown', tier: 'A', isHidden: true },
  { id: 'C', name: 'Also Public', url: 'characters/C/index.html', archetype: 'Zoner', tier: 'B', isWip: true },
];

async function roster(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/navigation.json*', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Characters: ROSTER }) }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/characters/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return errors;
}

const names = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#main-roster-grid .roster-card')]
    .map(c => (c.querySelector('.roster-card-text') || c).textContent.trim()));

test('a hidden character is not in the roster until you ask for it', async ({ page }) => {
  const errors = await roster(page);

  const before = await names(page);
  expect(before, 'setup: the ordinary characters are listed').toContain('Public One');
  expect(before, 'the private-server one is not').not.toContain('Private Only');
  // isWip is no longer a filter, so a WIP character is listed like any other.
  expect(before, 'and work-in-progress is not a reason to hide anything').toContain('Also Public');

  await page.locator('#filter-hidden').click();
  await page.waitForTimeout(400);

  const after = await names(page);
  expect(after, 'the toggle lets it in').toContain('Private Only');
  expect(after, 'without dropping anything else').toContain('Public One');

  // Back off again - a toggle that only goes one way is a button.
  await page.locator('#filter-hidden').click();
  await page.waitForTimeout(400);
  expect(await names(page), 'and out again').not.toContain('Private Only');

  expect(errors).toEqual([]);
});

test('the button says Show Hidden, and Hide WIP is gone', async ({ page }) => {
  await roster(page);
  const bar = await page.evaluate(() =>
    document.getElementById('roster-filter-bar').textContent.replace(/\s+/g, ' '));

  expect(bar).toContain('Show Hidden');
  expect(bar, 'the button that emptied the roster is gone').not.toContain('Hide WIP');
});

test('hiding is a roster filter and nothing more', async ({ page }) => {
  // The page, its URL and its stub are public and committed. If this ever
  // starts reading as a secrecy mechanism, the honest thing is for a test to
  // say so rather than for someone to assume it.
  await roster(page);

  const stub = path.join(ROOT, 'characters', 'Boomcat', 'index.html');
  expect(fs.existsSync(stub), 'character stubs are committed regardless of any flag').toBe(true);

  // And the entry is still in the JSON the page fetched - filtered at render,
  // not withheld.
  const inData = await page.evaluate(async () => {
    const res = await fetch('/data/navigation.json');
    const nav = await res.json();
    return nav.Characters.some(c => c.name === 'Private Only');
  });
  expect(inData, 'the data is public; only the listing filters').toBe(true);
});
