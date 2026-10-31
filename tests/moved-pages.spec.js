// A page whose address changed forwards from the old one (2026-10-31, when the
// game renamed Sky Assassin to Sky Bender and Hired Killer to Hired Hunter).
//
// The registry can move a page's folder, and links to the old address already
// sit in Discord messages, search results and other pages. Without this, the
// old stub stayed on disk serving the page under its old title, and nothing
// restamped it, so the next change to js/ failed asset-stamping.spec and
// stopped the regeneration on both branches (rehearsed before the rename).
//
// Made-up navigations throughout, so an owner edit to the real one can never
// turn these red.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPages, scanMovedStubs, MARKER } = require('../scripts/generate-pages.js');

const character = (name, folder, pageId) => ({
  id: name.replace(/\s+/g, '-'), name, url: `characters/${folder}/index.html`,
  cms_config: { pageType: 'character', pageId, editRole: 'open' },
});
const NAV = { Characters: [character('New Name', 'New_name', 'old_name')] };
const OLD = 'characters/Old_name/index.html';
const NEW = 'characters/New_name/index.html';

test('a page whose address changed forwards from the old one', () => {
  const { pages, problems } = buildPages(NAV, {}, {}, new Set(), new Set(), { [OLD]: 'old_name' });
  expect(problems).toEqual([]);

  const live = pages.find(p => p.relPath === NEW);
  const forward = pages.find(p => p.relPath === OLD);
  expect(live, 'the page itself is still generated at its new address').toBeTruthy();
  expect(forward, 'the old address gets a forward').toBeTruthy();

  const html = forward.html;
  expect(html, 'the generator still owns the file').toContain(MARKER);
  expect(html).toContain('<meta name="robots" content="noindex, follow">');
  expect(html).toContain('<link rel="canonical" href="https://dogslamloop.com/characters/New_name/index.html">');
  // The page's current name, never the old one: the old name is gone from the
  // registry, and a title is what a browser tab and a search result show.
  expect(html).toContain('<title>New Name | Dogslamloop</title>');
  // It names the page it belongs to, so a second move finds it again.
  expect(html).toContain('<meta name="dsl-moved-page" content="old_name">');
  // A forward boots nothing, so no asset stamp can go stale on it.
  expect(html).not.toContain('PAGE_ROUTE');
  expect(html).not.toMatch(/src="[^"]*js\//);
});

test('a page still at its address is not forwarded from it', () => {
  const nav = { Characters: [character('Same', 'Same', 'same')] };
  const { pages } = buildPages(nav, {}, {}, new Set(), new Set(), { 'characters/Same/index.html': 'same' });
  const atPath = pages.filter(p => p.relPath === 'characters/Same/index.html');
  expect(atPath).toHaveLength(1);
  expect(atPath[0].html, 'the real page, not a forward to itself').toContain('PAGE_ROUTE');
});

test('an old stub for a page that is no longer live is left alone', () => {
  const { pages } = buildPages(NAV, {}, {}, new Set(), new Set(), { 'characters/Gone/index.html': 'gone' });
  expect(pages.map(p => p.relPath)).not.toContain('characters/Gone/index.html');
});

test('an archived page keeps its tombstone, not a forward', () => {
  const archived = { old_name: { name: 'Old Name', url: OLD, pageType: 'character' } };
  const nav = { Characters: [character('Elsewhere', 'Elsewhere', 'elsewhere')] };
  const { pages, problems } = buildPages(nav, {}, archived, new Set(), new Set(), { [OLD]: 'elsewhere' });
  expect(problems).toEqual([]);
  const atOld = pages.filter(p => p.relPath === OLD);
  expect(atOld).toHaveLength(1);
  expect(atOld[0].archived).toBe(true);
});

test('the scan finds the page each old stub and each forward belongs to', () => {
  // Its own temporary folder, removed afterwards; never the repo.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-moved-'));
  try {
    const write = (rel, html) => {
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), html);
    };
    write('characters/Old_stub/index.html', `${MARKER}\n<script>window.PAGE_ROUTE = { pageId: "old_stub", pageType: "character", title: "Old" };</script>`);
    write('characters/Old_forward/index.html', `${MARKER}\n<meta name="dsl-moved-page" content="twice_moved">`);
    // Hand-written, so never the generator's to touch.
    write('characters/Hand_written/index.html', '<script>window.PAGE_ROUTE = { pageId: "hand", pageType: "character", title: "Hand" };</script>');
    // A tombstone names no page.
    write('systems/tombstone/index.html', `${MARKER}\n<h1 class="home-main-title">Page archived</h1>`);
    // Not a page directory at all.
    write('elsewhere/thing/index.html', `${MARKER}\n<script>window.PAGE_ROUTE = { pageId: "thing" };</script>`);

    expect(scanMovedStubs(root)).toEqual({
      'characters/Old_forward/index.html': 'twice_moved',
      'characters/Old_stub/index.html': 'old_stub',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The forward itself, in a browser: the old address lands on the new one with
// the #section of the link intact, and the old address is not left in the
// back button. Both addresses are served by the test, so no page boots.
async function serveMove(context) {
  const { pages } = buildPages(NAV, {}, {}, new Set(), new Set(), { [OLD]: 'old_name' });
  const forward = pages.find(p => p.relPath === OLD).html;
  await context.route(`**/${OLD}*`, route => route.fulfill({ contentType: 'text/html', body: forward }));
  await context.route(`**/${NEW}*`, route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>arrived</title><p>arrived</p>' }));
}

test('following an old link lands on the new address with its section', async ({ page }) => {
  await serveMove(page.context());
  // Where the reader clicked the link from.
  await page.route('**/discord-message.html', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>before</title>' }));
  await page.goto('/discord-message.html');
  await page.goto(`/${OLD}?from=discord#sec-dark-mango-psychology`);
  await expect(page).toHaveURL(new RegExp(`/${NEW}\\?from=discord#sec-dark-mango-psychology$`));
  await expect(page).toHaveTitle('arrived');

  await page.goBack();
  await expect(page, 'Back goes to where the reader was, not to the forward again').toHaveURL(/\/discord-message\.html$/);
});

test('without JavaScript the old address still forwards', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await serveMove(context);
    const page = await context.newPage();
    await page.goto(`/${OLD}`);
    await expect(page).toHaveURL(new RegExp(`/${NEW}$`));
  } finally {
    await context.close();
  }
});
