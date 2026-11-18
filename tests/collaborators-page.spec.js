// Collaborators, a page edited in the editor since v1.2 (the Kanban card
// "Figure out a way to make the site editing feels less restrictive").
//
// It was hand-written and read collaborators_data.json, which owner tools
// wrote from site_collaborators, and the home page's Credits list reads that
// same file. Now each person is a Collaborator Block, and the file is built
// from the page (scripts/fetch-content.js), so the page and the home page
// cannot drift apart again.
const { test, expect } = require('@playwright/test');
const { buildCollaborators, buildCollaboratorsFromPage, creditsFrom } = require('../scripts/fetch-content.js');

const TAG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const card = (over) => ({ type: 'collaborator', kind: 'card', name: 'Ann', role: 'Frame Data', badge: 'badge-site', avatar: '/medias/images/Ann.webp', description: 'Counted frames.', links: [], ...over });
const line = (over) => ({ type: 'collaborator', kind: 'line', name: 'Bo', description: 'Suggested the colors.', ...over });
const systemPage = (blocksBySection) => ({ tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: blocksBySection.map(([title, blocks]) => ({ sectionTitle: title, layout: 'full', blocks })) }] });

const PAGE = systemPage([
  ['Main Contributors', [
    card({ links: [{ name: 'GitHub', url: 'https://github.com/ann' }, { name: 'Bad', url: 'javascript:alert(1)' }] }),
    card({ name: `Cy ${TAG}`, badge: 'badge-x" onclick="window.__xss=1', avatar: 'javascript:alert(1)' }),
  ]],
  ['Special Thanks', [
    { type: 'paragraph', content: 'This wiki would not be possible without:' },
    line(),
    line({ name: 'Di', description: '' }),
    line({ name: 'Ed', description: `Helped ${TAG}` }),
  ]],
]);

function servePage(page, desc) {
  return page.route('**/rest/v1/page_data*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ page_id: 'collaborators', page_type: 'system', desc_data: desc, frame_data: {} }),
  }));
}

test('cards share one grid and thanks lines one list, as the page always drew them', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await servePage(page, PAGE);
  await page.goto('/systems/collaborators/index.html', { waitUntil: 'networkidle' });

  const grid = page.locator('.collaborator-grid');
  await expect(grid).toHaveCount(1);
  await expect(grid.locator('.collaborator-card')).toHaveCount(2);
  await expect(grid.locator('.collaborator-name')).toHaveText(['Ann', `Cy ${TAG}`]);
  await expect(grid.locator('.update-badge').first()).toHaveText('Frame Data');

  const thanks = page.locator('.collaborator-thanks');
  await expect(thanks).toHaveCount(1);
  await expect(thanks.locator('li')).toHaveText(['Bo - Suggested the colors.', 'Di', `Ed - Helped ${TAG}`]);
  expect(errors).toEqual([]);
});

test('what an editor typed stays text, and only an http(s) link becomes one', async ({ page }) => {
  await servePage(page, PAGE);
  await page.goto('/systems/collaborators/index.html', { waitUntil: 'networkidle' });
  const [ann, cy] = [page.locator('.collaborator-card').nth(0), page.locator('.collaborator-card').nth(1)];
  await expect(ann).toBeVisible();

  // A path from the site's root works from this page's depth.
  expect(await ann.locator('img.contributor-avatar').evaluate(img => new URL(img.src).pathname)).toBe('/medias/images/Ann.webp');
  await expect(ann.locator('.update-badge')).toHaveClass(/\bbadge-site\b/);
  await expect(ann.locator('.collaborator-link')).toHaveText(['GitHub']);
  await expect(ann.locator('.collaborator-link')).toHaveAttribute('href', 'https://github.com/ann');

  // A crafted name, badge and avatar: text, the default badge, no image.
  await expect(cy.locator('.collaborator-name')).toContainText('<img src=x');
  await expect(cy.locator('.update-badge')).toHaveClass('update-badge badge-general');
  await expect(cy.locator('.contributor-avatar-placeholder')).toHaveText('N/A');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => ({ fired: window.__xss || 0, images: document.querySelectorAll('img[src="x"]').length })))
    .toEqual({ fired: 0, images: 0 });
});

test("the home page's credits are built from the page's Blocks, nested ones included", () => {
  const nested = systemPage([['Main Contributors', [
    card(),
    { type: 'accordion', title: 'More', content: [card({ name: 'Eve', links: [{ name: 'Site', url: 'https://eve.test' }] })] },
  ]], ['Special Thanks', [line()]]]);

  expect(buildCollaboratorsFromPage(nested)).toEqual({
    mainContributors: [
      { name: 'Ann', role: 'Frame Data', badgeType: 'badge-site', avatar: '/medias/images/Ann.webp', description: 'Counted frames.', links: [] },
      { name: 'Eve', role: 'Frame Data', badgeType: 'badge-site', avatar: '/medias/images/Ann.webp', description: 'Counted frames.', links: [{ name: 'Site', url: 'https://eve.test' }] },
    ],
    specialThanks: [{ name: 'Bo', reason: 'Suggested the colors.' }],
  });
  // No page content at all is no credits, never somebody else's.
  expect(buildCollaboratorsFromPage({ tabs: [] })).toEqual({ mainContributors: [], specialThanks: [] });
});

test('the page and the old table give the home page the same file for the same people', () => {
  // The release's migration turns each table row into a Block, in sort_order.
  // Whichever source the job reads, the home page must get the same credits.
  const rows = [
    { name: 'Ann', role: 'Frame Data', description: 'Counted frames.', avatar: '/medias/images/Ann.webp', badge_type: 'badge-site', is_lead: true, links: [{ name: 'GitHub', url: 'https://github.com/ann' }], section: 'main', sort_order: 0 },
    { name: 'Bo', role: null, description: 'Suggested the colors.', avatar: null, badge_type: null, is_lead: false, links: [], section: 'thanks', sort_order: 10 },
    { name: 'Cy', role: '', description: '', avatar: '', badge_type: 'badge-wip', is_lead: false, links: [], section: 'main', sort_order: 20 },
  ];
  const asBlock = (r) => (r.section === 'thanks'
    ? { type: 'collaborator', kind: 'line', name: r.name, description: r.description || '' }
    : { type: 'collaborator', kind: 'card', name: r.name, role: r.role || '', badge: r.badge_type || '', avatar: r.avatar || '', description: r.description || '', links: r.links });
  const fromPage = buildCollaboratorsFromPage(systemPage([
    ['Main Contributors', rows.filter(r => r.section === 'main').map(asBlock)],
    ['Special Thanks', rows.filter(r => r.section === 'thanks').map(asBlock)],
  ]));
  expect(fromPage).toEqual(buildCollaborators(rows));
});

test('the old table decides only while the page has no row', () => {
  const rows = [{ name: 'Old', role: '', description: '', avatar: '', badge_type: '', is_lead: false, links: [], section: 'main', sort_order: 0 }];
  // Before the release: no page row, so the table.
  expect(creditsFrom(null, rows).mainContributors.map(c => c.name)).toEqual(['Old']);
  // After it: the page, even with nobody on it. Never the frozen table.
  expect(creditsFrom({ tabs: [] }, rows)).toEqual({ mainContributors: [], specialThanks: [] });
  expect(creditsFrom(systemPage([['Main Contributors', [card()]]]), rows).mainContributors.map(c => c.name)).toEqual(['Ann']);
});

// --- THE EDITOR ---
function mockEditor(page, desc) {
  return page.addInitScript((desc) => {
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'x', desc_data: desc, frame_data: {} }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, not() { return chain; },
        order() { return chain; }, limit() { return chain; }, neq() { return chain; },
        single: async () => result, maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
      };
      return chain;
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'admin-1', email: 'a@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, desc);
}

async function openCollaborators(page, desc = systemPage([['Main Contributors', [card()]]])) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockEditor(page, desc);
  await page.goto('/edit.html?char=collaborators&type=system', { waitUntil: 'domcontentloaded' });
  const first = page.locator('#block-list .block-card').first();
  await expect(first).toBeVisible({ timeout: 45000 });
  if (!(await first.locator('input[data-field="name"]').isVisible())) await first.locator('.btn-collapse').click();
  return first;
}

const pick = async (cardEl, field, option) => {
  await cardEl.locator(`select[data-field="${field}"] + .manga-select-wrapper .manga-select-trigger`).click();
  await cardEl.locator('.manga-select-options .manga-option', { hasText: option }).click();
};

test('Collaborator is offered on Collaborators, and "Shown as" swaps the form', async ({ page }) => {
  const first = await openCollaborators(page);
  expect(await page.locator('#add-block-popup .add-block-btn').allTextContents()).toContain('+ Collaborator');
  await expect(first.locator('input[data-field="role"]')).toBeVisible();
  await expect(first.locator('textarea[data-field="links-lines"]')).toBeVisible();

  await pick(first, 'kind', 'Special thanks (one line)');

  const redrawn = page.locator('#block-list .block-card').first();
  await expect(redrawn.locator('textarea[data-field="description"]')).toHaveAttribute('placeholder', 'Why they are thanked');
  await expect(redrawn.locator('input[data-field="role"], select[data-field="badge"], input[data-field="avatar"], textarea[data-field="links-lines"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.getActiveBlocks()[0].kind)).toBe('line');
  await expect(page.locator('#standard-preview-container .collaborator-thanks li')).toHaveText(['Ann - Counted frames.']);
});

test('links are typed one per line, and a line that will not link is named', async ({ page }) => {
  const first = await openCollaborators(page);
  const note = first.locator('[data-links-note]');
  await expect(note).toBeHidden();

  await first.locator('textarea[data-field="links-lines"]').fill('GitHub | https://github.com/ann\nBad | javascript:alert(1)');
  expect(await page.evaluate(() => window.getActiveBlocks()[0].links)).toEqual([
    { name: 'GitHub', url: 'https://github.com/ann' },
    { name: 'Bad', url: 'javascript:alert(1)' },
  ]);
  await expect(note).toBeVisible();
  await expect(note).toHaveText('Not shown, as only an http or https address links: javascript:alert(1)');
  await expect(page.locator('#standard-preview-container .collaborator-link')).toHaveText(['GitHub']);
});

test('Collaborator is not offered on any other page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockEditor(page, { tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [{ type: 'paragraph', content: 'Hi.' }] }] }] });
  await page.goto('/edit.html?char=m1-trading&type=system', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  const types = await page.locator('#add-block-popup .add-block-btn').allTextContents();
  expect(types.length, 'setup: the menu rendered').toBeGreaterThan(5);
  expect(types).not.toContain('+ Collaborator');
});

test("Find and Replace reads a person's words, never what kind of Block it is", async ({ page }) => {
  // Replacing "line" or "frames" in page text must not turn a card into a
  // line or a grid of frame types into another grid.
  await openCollaborators(page);
  const visited = await page.evaluate(() => {
    const keys = [];
    const blocks = [
      { type: 'collaborator', kind: 'line', name: 'N', role: 'R', badge: 'badge-site', avatar: '/a.webp', description: 'D', links: [{ name: 'L', url: 'https://x.test' }] },
      { type: 'colorswatches', set: 'frames' },
    ];
    window.walkEditorStrings(blocks, [], (text, path) => keys.push(path.slice(1).join('.')));
    return keys;
  });
  expect(visited.sort()).toEqual(['description', 'links.0.name', 'name', 'role']);
});
