// Every release is divided into Features, Fine-tuning and Bug fixes (owner,
// 2026-09-03), on the update log as well as in the Discord post.
//
// The mechanism is ADDITIVE, which is the thing these tests protect. A heading
// is `{ heading: "Features" }` in the `changes` array and a change is still a
// plain string, so the eighteen entries written before this render exactly as
// they did. Same shape as the ticket-chat `type` field: the older form is the
// fallback, not a migration.
//
// An object rather than a bare string that happens to read "Features", because
// a heading and a change line would otherwise be indistinguishable - and one
// day somebody writes a change line that reads "Bug fixes".
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UPDATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'updates.json'), 'utf8'));

const PAGE = '/systems/updatelog/index.html';

// --- THE DATA ---

test('the newest entry is v0.17, named and dated', async () => {
    const first = UPDATES.changelogs[0];
    expect(first.version).toBe('Beta v0.17');
    expect(first.title).toBe("The 'Expert' Update");
    expect(first.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
});

test('it carries the three parts, in order, and nothing else', async () => {
    const headings = UPDATES.changelogs[0].changes
        .filter(c => c && typeof c === 'object')
        .map(c => c.heading);
    expect(headings).toEqual(['Features', 'Fine-tuning', 'Bug fixes']);
});

test('every part has at least one line under it', async () => {
    // A part with nothing in it is omitted, not left empty - an empty heading
    // reads as a mistake.
    const changes = UPDATES.changelogs[0].changes;
    const counts = {};
    let current = null;
    for (const c of changes) {
        if (c && typeof c === 'object') { current = c.heading; counts[current] = 0; }
        else if (current) counts[current] += 1;
    }
    for (const [heading, n] of Object.entries(counts)) {
        expect(n, `${heading} has lines`).toBeGreaterThan(0);
    }
});

test('no older entry was rewritten', async () => {
    // The whole point of an additive shape. Eighteen entries existed before
    // this and none of them should have gained a heading.
    for (const log of UPDATES.changelogs.slice(1)) {
        const objects = (log.changes || []).filter(c => c && typeof c === 'object');
        expect(objects, `${log.version} is untouched`).toEqual([]);
    }
});

test('no changelog line mentions the machinery', async () => {
    // The reader is a player using the wiki, not the owner and not the person
    // who wrote it. v0.12's entry had to be rewritten for exactly this.
    const lines = UPDATES.changelogs[0].changes.filter(c => typeof c === 'string');
    const leaked = lines.filter(l => /migration|RPC|RLS|policy|supabase|postgres|cache-stamp|\.js\b/i.test(l));
    expect(leaked, 'these read as a dev log, not an update').toEqual([]);

    // And nobody is addressed as "you" - the only "you" a changelog could mean
    // is the owner.
    const addressed = lines.filter(l => /\byou\b|\byour\b/i.test(l));
    expect(addressed, 'write about the site, not to one person').toEqual([]);
});

// --- THE RENDER ---

test('the three parts render as headings, each with its own list', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.update-changes-heading');

    const entry = page.locator('.wiki-section').filter({ hasText: "The 'Expert' Update" }).first();
    await expect(entry.locator('.update-changes-heading')).toHaveText(['Features', 'Fine-tuning', 'Bug fixes']);

    // One list per heading, not one list with headings floating in it.
    await expect(entry.locator('.update-changes-list')).toHaveCount(3);

    // A heading is an h4, never an li - the bug this shape exists to avoid is a
    // bulleted "• Features".
    const tags = await entry.locator('.update-changes-heading')
        .evaluateAll(els => els.map(e => e.tagName));
    expect(tags).toEqual(['H4', 'H4', 'H4']);
    expect(await entry.locator('li', { hasText: /^Features$/ }).count()).toBe(0);
});

test('an older entry still renders as one flat list', async ({ page }) => {
    // The compatibility claim, driven rather than reasoned about.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.update-changes-heading');

    const older = page.locator('.wiki-section').filter({ hasText: "The 'Icon' Update" }).first();
    await expect(older.locator('.update-changes-heading')).toHaveCount(0);
    await expect(older.locator('ul')).toHaveCount(1);
    await expect(older.locator('li').first()).toContainText('character roster');
});

test('a heading is escaped', async ({ page }) => {
    // updates.json is hand-authored rather than contributor-supplied, so this
    // is not an attacker path - but the heading goes through innerHTML like
    // everything else, and the standard here is escape at every interpolation.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    const escaped = await page.evaluate(() =>
        window.buildUpdateChangesHTML([{ heading: '<img src=x onerror=alert(1)>' }, 'a line']));
    expect(escaped).toContain('&lt;img');
    expect(escaped).not.toContain('<img src=x');
});

test('an entry with no headings at all still renders', async ({ page }) => {
    // Every older entry takes this path, and it opens an unheaded list rather
    // than dropping the lines on the floor.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    const html = await page.evaluate(() =>
        window.buildUpdateChangesHTML(['one', 'two']));
    expect(html).toMatch(/^<ul[^>]*>/);
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
    expect(html).not.toContain('update-changes-heading');
});
