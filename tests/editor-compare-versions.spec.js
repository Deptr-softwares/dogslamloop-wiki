// VIEW DIFF in the editor, side by side, with "Compare with" (owner's Overseer
// card, v1.2): "There is no way to compare historical page versions from the
// current version in the editor". The owner's pick from the mockups
// (2026-11-18): a picker beside the diff, in the same side-by-side as the
// Overseer (tests/side-by-side-diff.spec.js covers the side-by-side itself).
//
// The editor is the real edit.html with only the database answered here: the
// live page, the approved edits since 2026-10-29, and the whole page after one
// of them. The edit is typed into the Workspace, as a contributor would.
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: text });
const LIVE = [para('Hold the dash to start a combo.'), para('Good for punishing a whiffed M1.')];
const OLD = [para('Hold the jump to start a combo.'), para('Good for punishing a whiffed M1.')];

const VERSIONS = [
    { id: '00000000-0000-4000-8000-0000000000a2', author_name: 'Editor B', approved_at: '2026-11-12T09:00:00Z', is_delta: true, target_scope: 'move', target_key: 'skills::swipe' },
    { id: '00000000-0000-4000-8000-0000000000a1', author_name: 'Editor A', approved_at: '2026-11-08T09:00:00Z', is_delta: true, target_scope: 'overview', target_key: 'full' },
];

// `after` is the whole page after each approved edit, by its id, as the
// database keeps it; an edit missing from it is one the site cannot rebuild.
function mockEditor(page, { desc = { overview: LIVE }, versions = VERSIONS, after = { [VERSIONS[1].id]: { overview: OLD } } } = {}) {
    return page.addInitScript(({ desc, versions, after }) => {
        window.__asked = [];
        const frame = { m1s: [], skills: [], specials: [] };
        const rowsFor = (table) => {
            if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: frame }, error: null };
            if (table === 'approved_revisions') return { data: versions, error: null };
            if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
            return { data: [], error: null };
        };
        const builder = (table) => {
            const result = rowsFor(table);
            const asked = { table, filters: [] };
            window.__asked.push(asked);
            const chain = {
                select() { return chain; }, eq(c, v) { asked.filters.push(['eq', c, v]); return chain; },
                not(c, op, v) { asked.filters.push(['not', c, op, v]); return chain; },
                in() { return chain; }, order() { return chain; }, limit() { return chain; },
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
                            getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } } }),
                            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                            signOut: async () => ({}),
                        },
                        from: builder,
                        rpc: async (fn, args) => {
                            window.__asked.push({ rpc: fn, args });
                            if (fn === 'get_page_after_revision' && after[args.target_revision_id]) {
                                return { data: { desc_data: after[args.target_revision_id], frame_data: frame, source: 'snapshot' }, error: null };
                            }
                            return { data: null, error: null };
                        },
                        storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
                    });
                    lib.__patched = true;
                }
            },
        });
    }, { desc, versions, after });
}

// The site's styled dropdown stands in front of the native <select>, which
// nobody can click, so it is driven the way a person would.
async function compareWith(page, label) {
    await page.locator('#sbs-compare-with + .manga-select-wrapper .manga-select-trigger').click();
    await page.locator('#sbs-compare-with + .manga-select-wrapper .manga-option', { hasText: label }).click();
}

const left = (page) => page.locator('#diff-view-container .sbs-col-left');
const right = (page) => page.locator('#diff-view-container .sbs-col-right');

// Boots the editor on the Overview and types into its first paragraph.
async function editFirstParagraph(page, text) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEditor(page);
    await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
    const card = page.locator('#block-list .block-card').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    const field = card.locator('textarea[data-field="content-array"]');
    // A block opens collapsed unless the editor remembers it open.
    if (!(await field.isVisible())) await card.locator('.btn-collapse').click();
    await field.fill(text);
}

test('VIEW DIFF puts the live page beside the page in the editor', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();

    await expect(page.locator('.sbs-head-left').first()).toContainText('LIVE PAGE');
    await expect(page.locator('.sbs-head-right').first()).toContainText('YOUR EDITOR');
    await expect(left(page).locator('del.diff-del')).toHaveText(['dash']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
    await expect(page.locator('#standard-preview-container')).toBeHidden();
});

test('Compare with lists the approved edits since Oct 29, newest first, and draws the one picked', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();

    const picker = page.locator('#sbs-compare-with');
    const options = await picker.locator('option').allTextContents();
    expect(options).toEqual([
        'The live page',
        'Nov 12, 2026, Editor B (Skills)',
        'Nov 8, 2026, Editor A (Overview & Strategy)',
    ]);
    // Only versions the site knows the whole page after.
    const asked = await page.evaluate(() => window.__asked.find(a => a.table === 'approved_revisions'));
    expect(asked.filters).toContainEqual(['eq', 'page_id', 'boomcat']);
    expect(asked.filters).toContainEqual(['not', 'approved_at', 'is', null]);

    await compareWith(page, 'Nov 8, 2026, Editor A');
    await expect(page.locator('.sbs-head-left').first()).toContainText('NOV 8, 2026');
    await expect(page.locator('.sbs-head-right').first()).toContainText('YOUR EDITOR');
    // Against Nov 8 ("Hold the jump"), only "button" is new.
    await expect(right(page).locator('ins.diff-add')).toHaveText(['button']);
    await expect(left(page).locator('del.diff-del')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'CHANGE LIST' }), 'the list only compares with the live page').toHaveCount(0);

    await compareWith(page, 'The live page');
    await expect(page.locator('.sbs-head-left').first()).toContainText('LIVE PAGE');
    await expect(left(page).locator('del.diff-del')).toHaveText(['dash']);
});

test("a version the site cannot rebuild says so, and leaves the picker to choose another", async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();

    // The mock answers null for Nov 12, as the database does for an edit it has
    // no page after.
    await compareWith(page, 'Nov 12, 2026, Editor B');
    await expect(page.locator('#diff-view-container .sbs-note')).toContainText('That version could not be loaded');
    await expect(page.locator('#sbs-compare-with + .manga-select-wrapper .manga-select-trigger')).toBeVisible();
});

test("leaving VIEW DIFF gives the editor's own preview back untouched", async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-sync').click();
    const preview = page.locator('#standard-preview-container #tab-overview');
    await expect(preview).toContainText('Hold the jump button to start a combo.');
    const ids = () => page.evaluate(() => Array.from(document.querySelectorAll('#standard-preview-container [id]')).map(el => el.id));
    const idsBefore = await ids();

    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();
    // Opening VIEW DIFF saves what was typed, which redraws the preview as
    // any Sync does. From here on nothing may: the paragraph is marked, so a
    // redrawn copy would not pass.
    await page.evaluate(() => { document.querySelector('#standard-preview-container #tab-overview p.strategy-paragraph').__kept = true; });
    await page.locator('#btn-toggle-diff').click();

    await expect(page.locator('#diff-view-container')).toHaveCount(0);
    await expect(preview).toBeVisible();
    // The live page was drawn while the preview stood beside it, and none of
    // it may have landed there.
    await expect(preview).toContainText('Hold the jump button to start a combo.');
    await expect(preview).not.toContainText('Hold the dash');
    expect(await page.evaluate(() => document.querySelector('#standard-preview-container #tab-overview p.strategy-paragraph').__kept)).toBe(true);
    expect(await ids()).toEqual(idsBefore);
});

test('the Workspace is held while the two versions are drawn, and given back after', async ({ page }) => {
    // The page's data is swapped for the other version while it is drawn, so
    // anything typed in that moment would land in the wrong one.
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.evaluate(() => {
        window.__heldWhileDrawing = false;
        const workspace = document.querySelector('.editor-workspace');
        new MutationObserver(() => { if (workspace.inert) window.__heldWhileDrawing = true; })
            .observe(workspace, { attributes: true, attributeFilter: ['inert'] });
    });
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();

    expect(await page.evaluate(() => window.__heldWhileDrawing)).toBe(true);
    await expect(page.locator('.editor-workspace')).not.toHaveAttribute('inert', '');
    await page.locator('#block-list textarea[data-field="content-array"]').first().fill('Typed after the drawing.');
});

// A system page is drawn whole, every tab at once, so the side-by-side has to
// pick out the tab the Workspace is on, and follow the Workspace's own tab
// strip (window.switchSystemTab), which is not the character pages' one.
const section = (title, text) => ({ sectionTitle: title, layout: 'full', blocks: [para(text)] });
const SYSTEM = { tabs: [
    { tabId: 'basics', tabLabel: 'Basics', sections: [section('Intro', 'Hold the dash to start a combo.')] },
    { tabId: 'advanced', tabLabel: 'Advanced', sections: [section('Spacing', 'Spacing wins neutral.')] },
] };
const SYSTEM_VERSION = { id: '00000000-0000-4000-8000-0000000000b1', author_name: 'Editor C', approved_at: '2026-11-10T09:00:00Z', is_delta: true, target_scope: 'system_section', target_key: 'basics::intro' };

test('a system page compares the tab on screen, and follows the Workspace to another tab', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEditor(page, { desc: SYSTEM, versions: [SYSTEM_VERSION], after: {} });
    await page.goto('/edit.html?char=m1-trading&type=system', { waitUntil: 'domcontentloaded' });
    const card = page.locator('#block-list .block-card').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    const field = card.locator('textarea[data-field="content-array"]');
    if (!(await field.isVisible())) await card.locator('.btn-collapse').click();
    await field.fill('Hold the jump button to start a combo.');

    await page.locator('#btn-toggle-diff').click();
    await expect(left(page).locator('del.diff-del')).toHaveText(['dash']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
    await expect(right(page)).not.toContainText('Spacing wins neutral.');
    expect(await page.locator('#sbs-compare-with option').allTextContents())
        .toEqual(['The live page', 'Nov 10, 2026, Editor C (Basics)']);

    await page.locator('.daw-editor-nav-row .daw-tab-btn', { hasText: 'Advanced' }).click();
    await expect(right(page)).toContainText('Spacing wins neutral.');
    await expect(right(page)).not.toContainText('Hold the');
    await expect(page.locator('#diff-view-container .sbs-note')).toHaveText('Nothing this tab shows has changed.');
});

test('CHANGE LIST shows the list, and SIDE BY SIDE comes back', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();

    await page.getByRole('button', { name: 'CHANGE LIST' }).click();
    await expect(page.locator('#diff-view-container .diff-inline-target').first()).toContainText('Hold the');
    await expect(page.locator('#diff-view-container .sbs')).toHaveCount(0);

    await page.getByRole('button', { name: 'SIDE BY SIDE' }).click();
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
});
