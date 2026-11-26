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

// Oldest first, the order the table happens to hold them in, so the newest-
// first list can only come from the order the editor asks for.
const VERSIONS = [
    { id: '00000000-0000-4000-8000-0000000000a1', author_name: 'Editor A', approved_at: '2026-11-08T09:00:00Z', is_delta: true, target_scope: 'overview', target_key: 'full' },
    { id: '00000000-0000-4000-8000-0000000000a2', author_name: 'Editor B', approved_at: '2026-11-12T09:00:00Z', is_delta: true, target_scope: 'move', target_key: 'skills::swipe' },
];

// `after` is the whole page after each approved edit, by its id, as the
// database keeps it; an edit missing from it is one the site cannot rebuild.
function mockEditor(page, { desc = { overview: LIVE }, frame = { m1s: [], skills: [], specials: [] }, versions = VERSIONS, after = { [VERSIONS[0].id]: { overview: OLD } } } = {}) {
    return page.addInitScript(({ desc, frame, versions, after }) => {
        window.__asked = [];
        const rowsFor = (table) => {
            if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
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
                in() { return chain; }, limit() { return chain; },
                order(c, { ascending = true } = {}) {
                    if (Array.isArray(result.data)) {
                        result.data = [...result.data].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (ascending ? 1 : -1));
                    }
                    return chain;
                },
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
    }, { desc, frame, versions, after });
}

// The site's styled dropdown stands in front of the native <select>, which
// nobody can click, so it is driven the way a person would.
async function compareWith(page, label) {
    await page.locator('#sbs-compare-with + .manga-select-wrapper .manga-select-trigger').click();
    await page.locator('#sbs-compare-with + .manga-select-wrapper .manga-option', { hasText: label }).click();
}

const left = (page) => page.locator('#diff-view-container .sbs-col-left');
const right = (page) => page.locator('#diff-view-container .sbs-col-right');

// Boots the editor on the Overview, with its first paragraph open to type in.
async function openFirstParagraph(page, { search = '', ...fixture } = {}) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEditor(page, fixture);
    await page.goto(`/edit.html?char=boomcat&type=character&tab=overview${search}`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('#block-list .block-card').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    const field = card.locator('textarea[data-field="content-array"]');
    // A block opens collapsed unless the editor remembers it open.
    if (!(await field.isVisible())) await card.locator('.btn-collapse').click();
    return field;
}

async function editFirstParagraph(page, text, options) {
    await (await openFirstParagraph(page, options)).fill(text);
}

// What was typed reaches the page's data 400ms after the last key
// (js/editor/blocks/editor-blocks.js), redrawing the preview. Waited out where a test needs
// the preview to hold still.
const TYPING_PAUSE_MS = 400;

// The Workspace folds away while the side-by-side is up; to use it (its tabs,
// EXIT DIFF), a person brings it back first.
const bringWorkspaceBack = (page) => page.getByRole('button', { name: '◀ WORKSPACE' }).click();

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
    // No side-by-side here, so no WORKSPACE button: the Workspace, and EXIT
    // DIFF in it, come back by themselves.
    await expect(page.locator('.editor-workspace')).toBeVisible();
});

test('a version that throws while drawing says so, instead of "Drawing both versions..." for good', async ({ page }) => {
    // Nothing caught a throw in the drawing until v1.2: the screen stayed on
    // its placeholder with no way on but EXIT DIFF, folded away with the
    // Workspace. A renderer throwing on what a page holds is the real case;
    // the mount throwing stands in for it.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.evaluate(() => { window.SideBySide.mount = () => { throw new Error('a block would not draw'); }; });
    await page.locator('#btn-toggle-diff').click();

    const note = page.locator('#diff-view-container .sbs-note');
    await expect(note).toHaveText('The two versions could not be drawn side by side: a block would not draw.');
    await expect(page.locator('.editor-workspace')).toBeVisible();
    await expect(page.locator('#sbs-compare-with + .manga-select-wrapper .manga-select-trigger')).toBeVisible();

    await page.getByRole('button', { name: 'CHANGE LIST' }).click();
    await expect(page.locator('#diff-view-container .diff-section-title').first()).toBeVisible();
    expect(errors).toEqual([]);
});

test("leaving VIEW DIFF gives the editor's own preview back untouched", async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-sync').click();
    const preview = page.locator('#standard-preview-container #tab-overview');
    await expect(preview).toContainText('Hold the jump button to start a combo.');
    const ids = () => page.evaluate(() => Array.from(document.querySelectorAll('#standard-preview-container [id]')).map(el => el.id));
    const idsBefore = await ids();
    // The typing pause redraws the preview too, as it should: let it pass, so
    // the only thing left that could redraw it is VIEW DIFF.
    await page.waitForTimeout(TYPING_PAUSE_MS + 100);

    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();
    // Opening VIEW DIFF saves what was typed, which redraws the preview as
    // any Sync does. From here on nothing may: the paragraph is marked, so a
    // redrawn copy would not pass.
    await page.evaluate(() => { document.querySelector('#standard-preview-container #tab-overview p.strategy-paragraph').__kept = true; });
    await bringWorkspaceBack(page);
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
    await bringWorkspaceBack(page);
    await page.locator('#block-list textarea[data-field="content-array"]').first().fill('Typed after the drawing.');
});

// Pressing VIEW DIFF does not cancel the typing pause, and it used to run out
// while the live page stood in the editor's place: it wrote the Workspace into
// the live copy, so the live side showed the edit too, and a submission made
// after would have carried no change. The live side's drawing is slowed here
// so the pause always runs out in the middle of it.
test("a typing pause that runs out while VIEW DIFF draws leaves the live copy alone", async ({ page }) => {
    const field = await openFirstParagraph(page);
    await page.evaluate(() => {
        const draw = window.loadPageDescriptions;
        let first = true;
        window.loadPageDescriptions = async function (...args) {
            if (first) { first = false; await new Promise(r => setTimeout(r, 700)); }
            return draw.apply(this, args);
        };
    });
    // Typed, and VIEW DIFF pressed straight after, as one step, so the click
    // always lands inside the pause.
    await field.evaluate((el) => {
        el.value = 'Hold the jump button to start a combo.';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('btn-toggle-diff').click();
    });

    await expect(left(page).locator('del.diff-del')).toHaveText(['dash']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
    expect(await page.evaluate(() => window.originalCloudDescData.overview[0].content)).toBe('Hold the dash to start a combo.');
    // What was typed still reached the page, once the editor had it back, and
    // the pause's own work ran then: the typing is a step UNDO can take back.
    expect(await page.evaluate(() => window.currentEditorDescData.overview[0].content)).toEqual(['Hold the jump button to start a combo.']);
    await expect(page.locator('#btn-undo')).toBeEnabled();
});

// The side-by-side is one tab, so it goes where the Workspace goes.
test('VIEW DIFF follows the Workspace to another tab', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.', {
        desc: { overview: LIVE, matchups: [{ opponent: 'Zzq Rival', tier: 'even', content: [para('Keep your distance from Zzq.')] }] },
    });
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);

    await bringWorkspaceBack(page);
    await page.locator('#edit-nav-matchups').click();
    await expect(right(page)).toContainText('Keep your distance from Zzq.');
    await expect(right(page)).not.toContainText('Hold the');
    await expect(page.locator('#diff-view-container .sbs-note')).toHaveText('Nothing this tab shows has changed.');
});

// A character's states (Ultimate and the like) are edited one at a time, and
// the editor holds only that state's write-up. A past version is cut the same
// way, or the base kit's overview would stand beside the Ultimate one.
test("in a state, a past version is that state as it was, not the base kit", async ({ page }) => {
    const withState = (base, ultimate) => ({ overview: [para(base)], modeData: { ultimate: { overview: [para(ultimate)] } } });
    const modes = [{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Ultimate' }];
    await editFirstParagraph(page, 'Hold the jump button to start a combo.', {
        search: '&mode=ultimate',
        desc: withState('Base kit overview.', 'Hold the dash to start a combo.'),
        frame: { m1s: [], skills: [], specials: [], modes },
        after: { [VERSIONS[0].id]: withState('Base kit overview, as it was.', 'Hold the jump to start a combo.') },
    });
    await page.locator('#btn-toggle-diff').click();
    await expect(left(page).locator('del.diff-del')).toHaveText(['dash']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);

    await compareWith(page, 'Nov 8, 2026, Editor A');
    await expect(page.locator('.sbs-head-left').first()).toContainText('NOV 8, 2026');
    await expect(right(page).locator('ins.diff-add')).toHaveText(['button']);
    await expect(left(page)).not.toContainText('Base kit overview');
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

    await bringWorkspaceBack(page);
    await page.locator('.editor-nav-row .sub-tab', { hasText: 'Advanced' }).click();
    await expect(right(page)).toContainText('Spacing wins neutral.');
    await expect(right(page)).not.toContainText('Hold the');
    await expect(page.locator('#diff-view-container .sbs-note')).toHaveText('Nothing this tab shows has changed.');

    // The system renderer finds its place by class, the first one in the
    // page, so the versions are drawn in a box put first; none of either may
    // be left in the editor's own preview (a second tab strip, empty tabs).
    await page.locator('#btn-toggle-diff').click();
    const preview = page.locator('#standard-preview-container');
    await expect(preview).toBeVisible();
    await expect(preview.locator('[id="system-dynamic-nav"]')).toHaveCount(1);
    await expect(preview.locator('[id="tab-basics"]')).toHaveCount(1);
    await expect(preview.locator('[id="tab-advanced"]')).toHaveCount(1);
    await expect(preview.locator('[id="tab-advanced"]')).toContainText('Spacing wins neutral.');
});

// A tool page (and a gallery, and a tier list) is not drawn tab by tab, so
// there is no tab to put beside another: VIEW DIFF keeps the list for it.
test('a tool page keeps the list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEditor(page, { desc: { intro: [para('Paste the ID here.')], notes: [] } });
    await page.goto('/edit.html?page=id-reader&type=tool', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#tool-url')).toBeVisible({ timeout: 45000 });

    await page.locator('#btn-toggle-diff').click();
    await expect(page.locator('#diff-view-container h2.section-title')).toHaveText('REVISION COMPARISON');
    await expect(page.locator('#diff-view-container .sbs')).toHaveCount(0);
    await expect(page.locator('#sbs-compare-with')).toHaveCount(0);
});

test('CHANGE LIST shows the list, and SIDE BY SIDE comes back', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page)).toBeVisible();

    await page.getByRole('button', { name: 'CHANGE LIST' }).click();
    await expect(page.locator('#diff-view-container .diff-inline-target').first()).toContainText('Hold the');
    await expect(page.locator('#diff-view-container .sbs')).toHaveCount(0);
    // The list has no WORKSPACE button, and EXIT DIFF is in the Workspace.
    await expect(page.locator('.editor-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'SIDE BY SIDE' }).click();
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
    await expect(page.locator('.editor-workspace')).toBeHidden();
});

// "Way too compressed" (owner, 2026-11-18): each half was about 470px at a
// 1440px screen, half of what the Workspace left, under the page's 1000px cap.
// Their pick: the Workspace folds away while comparing.
test('VIEW DIFF folds the Workspace away for the comparison, and WORKSPACE brings it back', async ({ page }) => {
    await editFirstParagraph(page, 'Hold the jump button to start a combo.');
    await page.locator('#btn-toggle-diff').click();
    await expect(right(page).locator('ins.diff-add')).toHaveText(['jump button']);
    await expect(page.locator('.editor-workspace')).toBeHidden();
    expect(await right(page).evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(600);

    await page.getByRole('button', { name: '◀ WORKSPACE' }).click();
    await expect(page.locator('.editor-workspace')).toBeVisible();
    await expect(page.getByRole('button', { name: 'HIDE WORKSPACE' })).toBeVisible();

    // Kept open for the rest of this VIEW DIFF, a tab switch included.
    await page.locator('#edit-nav-matchups').click();
    await expect(page.getByRole('button', { name: 'HIDE WORKSPACE' })).toBeVisible();
    await expect(page.locator('.editor-workspace')).toBeVisible();

    await page.locator('#btn-toggle-diff').click();
    await expect(page.locator('#standard-preview-container')).toBeVisible();
    await expect(page.locator('.editor-workspace')).toBeVisible();

    // A new VIEW DIFF folds it again.
    await page.locator('#btn-toggle-diff').click();
    await expect(page.locator('.editor-workspace')).toBeHidden();
});

// A narrow half kept the card's desktop row and squeezed each stat's value to
// one letter a line (the owner's screenshot). Each half now lays out for its
// own width: folded, the card keeps its row; with the Workspace back, it
// stacks, as the page does on a narrow screen.
test("a Skill Card's stats stay readable in a half, folded or not", async ({ page }) => {
    const phase = (duration, styleClass, label) => ({ duration, styleClass, label });
    const move = {
        id: 'swipe', name: 'Crow Swipe', input: '2', type: 'Attack', damageType: 'Physical', variant: 'Standard',
        stats: [{ label: 'Cooldown', value: '15s' }, { label: 'Hit Ragdoll?', value: 'Only Air Ragdoll' }],
        variants: { standard: { label: 'Standard', totalScale: 60, bars: [{ type: 'single', phases: [phase(24, 'bg-tick-start', 'Startup: 24f'), phase(15, 'bg-tick-recov', 'Recovery: 15f')] }] } },
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEditor(page, { frame: { m1s: [], skills: [move], specials: [] } });
    await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.accolade-picker')).toBeVisible({ timeout: 45000 });
    await page.locator('#btn-toggle-diff').click();

    const value = right(page).locator('.stat-value', { hasText: 'Only Air Ragdoll' });
    const lines = () => value.evaluate(el => {
        const cs = getComputedStyle(el);
        const lineHeight = Number.isFinite(parseFloat(cs.lineHeight)) ? parseFloat(cs.lineHeight) : parseFloat(cs.fontSize) * 1.2;
        return Math.round(el.getBoundingClientRect().height / lineHeight);
    });
    await expect(value).toBeVisible();
    expect(await lines(), 'folded').toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: '◀ WORKSPACE' }).click();
    await expect(page.locator('.editor-workspace')).toBeVisible();
    await expect.poll(lines, { message: 'with the Workspace back' }).toBeLessThanOrEqual(2);
});
