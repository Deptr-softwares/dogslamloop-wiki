// Skill Card accolades (owner's Kanban card "Skill Card accolades", v1.2).
//
// "a preset amount of accolades that editor can attach to the skill card
// however they want. Think of something like the "Safe on block",
// "Blockbreak" badges/banners that some fighting games have under their move
// description. Hovering over the badges will give its full description and
// its name". The owner's pick from the mockups (2026-11-18): under the move's
// name. Their 26 accolades, in their order, are window.ACCOLADES
// (js/framedata.js); a move stores the ids.
const { test, expect } = require('@playwright/test');

const TRACK = {
    standard: {
        label: 'On Hit', totalScale: 20,
        bars: [{ type: 'single', phases: [
            { duration: 10, styleClass: 'bg-tick-start', label: 'Startup: 10f' },
            { duration: 10, styleClass: 'bg-tick-active', label: 'Active: 10f' },
        ] }],
    },
};

// The reader's page, with moves drawn from data handed to it here.
async function drawMoves(page, moves, { width = 1440 } = {}) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(async (moves) => {
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData['boomcat'] = { specials: moves };
        await window.loadMoveSection('boomcat', 'specials');
    }, moves);
    await page.locator('#nav-specials').click();
    await expect(page.locator('#tab-specials .skill-entry-card').first()).toBeVisible();
}

const SWIPE = (accolades) => ({ id: 'swipe', name: 'Swipe', input: 'M1', type: 'Attack', damageType: 'Physical', stats: [], variants: TRACK, ...(accolades ? { accolades } : {}) });

test("a move's accolades show under its name, in the owner's order, coloured by what they say", async ({ page }) => {
    await drawMoves(page, [SWIPE(['safe-on-block', 'blockbreak', 'punishable-on-whiff', 'not-an-accolade'])]);
    const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Swipe' });
    const badges = card.locator('.skill-accolades .skill-accolade');

    // The owner's order (Blockbreak is 1st, Safe on Block 5th, Punishable on
    // Whiff 6th), not the order they were stored in, and nothing for an id
    // that is not one of theirs.
    await expect(badges).toHaveText(['Blockbreak', 'Safe on Block', 'Punishable on Whiff']);

    // In the header, under the "Input | Skill Type" line.
    const place = await card.evaluate(el => {
        const sub = el.querySelector('.skill-subtitle').getBoundingClientRect();
        const row = el.querySelector('.skill-accolades').getBoundingClientRect();
        const header = el.querySelector('.skill-entry-header').getBoundingClientRect();
        return { under: row.top >= sub.bottom - 1, inHeader: row.bottom <= header.bottom + 1 };
    });
    expect(place.under).toBe(true);
    expect(place.inHeader).toBe(true);

    const color = (name) => card.locator('.skill-accolade', { hasText: name }).evaluate(el => getComputedStyle(el).color);
    const plain = await color('Blockbreak');
    expect(await color('Safe on Block'), 'Safe is green').toBe('rgb(74, 222, 128)');
    expect(await color('Punishable on Whiff'), 'Punishable is red').toBe('rgb(252, 165, 165)');
    expect(plain).not.toBe('rgb(74, 222, 128)');
    expect(plain).not.toBe('rgb(252, 165, 165)');
});

test('hovering a badge shows its name and what it means', async ({ page }) => {
    await drawMoves(page, [SWIPE(['safe-on-block', 'execution'])]);
    const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Swipe' });
    const tip = page.locator('#wiki-frame-tooltip');

    await card.locator('.skill-accolade', { hasText: 'Safe on Block' }).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Safe on Block');
    await expect(tip).toContainText('This move can not be punished on Block');

    await card.locator('.skill-accolade', { hasText: 'Execution' }).hover();
    await expect(tip).toContainText('This move kills earlier than its total damage');
    await page.mouse.move(5, 5);
    await expect(tip).toBeHidden();
});

test('on a phone a long badge wraps inside the card instead of widening the page', async ({ page }) => {
    await drawMoves(page, [SWIPE(['frame-perfect-evasive-punishable', 'hit-only-air-ragdoll', 'safe-on-block', 'semi-uncancellable'])], { width: 360 });
    const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Swipe' });
    await expect(card.locator('.skill-accolade')).toHaveCount(4);

    // A badge that could not wrap widened the name's column and pushed the
    // Edit Move button beside it out of the card, where the card clips it,
    // so the page itself never scrolled sideways.
    const inside = await card.evaluate(el => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('.skill-accolade, .skill-edit-move-btn')].every(part => {
            const r = part.getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right + 1;
        });
    });
    expect(inside, 'every badge and the Edit Move button within the card').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
});

test('a move with no accolades has no row, and takes no room for one', async ({ page }) => {
    await drawMoves(page, [SWIPE(), SWIPE([])]);
    await expect(page.locator('#tab-specials .skill-accolades')).toHaveCount(0);
});

// --- THE EDITOR ---

function mockEditor(page, move) {
    return page.addInitScript((move) => {
        const frame = { m1s: [], skills: [], specials: [move] };
        const rowsFor = (table) => {
            if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: { overview: [] }, frame_data: frame }, error: null };
            if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
            return { data: [], error: null };
        };
        const builder = (table) => {
            const result = rowsFor(table);
            const chain = {
                select() { return chain; }, eq() { return chain; }, in() { return chain; },
                order() { return chain; }, limit() { return chain; }, not() { return chain; },
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
                        rpc: async () => ({ data: null, error: null }),
                        storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
                    });
                    lib.__patched = true;
                }
            },
        });
    }, move);
}

const stored = (page) => page.evaluate(() => window.cachedMasterFrameData.boomcat.specials[0]);
const chip = (page, name) => page.locator('.accolade-picker .accolade-chip', { hasText: new RegExp(`^${name}$`) });

test("ticking accolades stores them in the owner's order, an opposite unticks, and none ticked stores nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockEditor(page, SWIPE());
    await page.goto('/edit.html?char=boomcat&type=character&tab=specials', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.accolade-picker')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.accolade-picker .accolade-chip')).toHaveCount(26);
    expect(await stored(page)).not.toHaveProperty('accolades');

    await chip(page, 'Safe on Block').click();
    await chip(page, 'Blockbreak').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'safe-on-block']);
    await expect(chip(page, 'Safe on Block')).toHaveAttribute('aria-pressed', 'true');

    // A ticked chip looks ticked, in its badge's color when it has one.
    const color = (name) => chip(page, name).evaluate(el => getComputedStyle(el).color);
    expect(await color('Safe on Block')).toBe('rgb(74, 222, 128)');
    expect(await color('Blockbreak'), 'ticked').not.toBe(await color('Block Bypass'));

    // Safe and Punishable on Block cannot both be true of one move.
    await chip(page, 'Punishable on Block').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'punishable-on-block']);
    await expect(chip(page, 'Safe on Block')).toHaveAttribute('aria-pressed', 'false');

    // Nor can two of the three Ragdoll ones.
    await chip(page, 'Hit Ragdoll').click();
    await chip(page, 'Can not hit Ragdoll').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'punishable-on-block', 'cannot-hit-ragdoll']);

    for (const name of ['Blockbreak', 'Punishable on Block', 'Can not hit Ragdoll']) await chip(page, name).click();
    // Gone, not an empty list: a move nobody ticked and a move ticked then
    // unticked are the same data, so the second is not a change to review.
    expect(await stored(page)).not.toHaveProperty('accolades');
});

// --- THE OVERSEER ---

// admin.html as an admin, with one submission to a Skill Card and the live page
// answered here (a trimmed copy of tests/side-by-side-diff.spec.js's).
async function reviewMoveEdit(page, live, next) {
    const row = {
        id: '00000000-0000-4000-8000-000000000001', page_id: 'boomcat', page_type: 'character', status: 'pending',
        author_id: 'u-author', author_name: 'Someone', created_at: '2026-11-18T10:00:00Z',
        is_delta: true, target_scope: 'move', target_key: `specials::${next.id}`,
        delta_payload: { frame_data: next, desc_data: [] },
        qa_metadata: { changelog: 'An edit.', confidence: 'high', evidence: '' },
        supporters: [], opposers: [], ticket_chat: [],
    };
    const frame = { modes: [], m1s: [], skills: [], specials: [live], modeData: {} };
    await page.addInitScript(({ row, frame }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-staff', email: 'staff@example.com' }, access_token: 'tok' } } });
                    const thenable = (result) => {
                        const chain = {
                            select() { return chain; }, eq() { return chain; }, in() { return chain; },
                            order() { return chain; }, limit() { return chain; },
                            single: async () => result, maybeSingle: async () => result,
                            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
                        };
                        return chain;
                    };
                    client.from = (table) => {
                        if (table === 'user_roles') return thenable({ data: [{ role: 'admin' }], error: null });
                        if (table === 'pending_revisions') return thenable({ data: [{ ...row }], error: null });
                        if (table === 'page_data') return thenable({ data: { desc_data: { overview: [], moveStrategies: {} }, frame_data: frame, tab_settings: null }, error: null });
                        return thenable({ data: [], error: null });
                    };
                    const channel = { on() { return channel; }, subscribe() { return channel; } };
                    client.channel = () => channel;
                    client.removeChannel = () => {};
                    return client;
                };
            },
        });
    }, { row, frame });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#queue-container .admin-review-btn').first()).toBeVisible({ timeout: 15000 });
    await page.locator('#queue-container .admin-review-btn').first().click();
}

test('the Overseer shows a ticked accolade as new beside the live card, and CHANGE LIST names it', async ({ page }) => {
    await reviewMoveEdit(page, SWIPE(['blockbreak']), SWIPE(['blockbreak', 'safe-on-block']));

    const right = page.locator('.sbs-col-right');
    await expect(right.locator('.skill-accolade')).toHaveText(['Blockbreak', 'Safe on Block'], { timeout: 15000 });
    await expect(right.locator('ins.diff-add')).toHaveText(['Safe on Block']);
    await expect(page.locator('.sbs-col-left del.diff-del')).toHaveCount(0);

    // By name, as a reviewer reads them, not by the ids a move stores.
    await page.getByRole('button', { name: 'CHANGE LIST' }).click();
    const row = page.locator('#admin-diff-container .diff-field-row', { hasText: 'Accolades:' });
    await expect(row.locator('del.diff-del')).toHaveText('Blockbreak');
    await expect(row.locator('ins.diff-add')).toHaveText('Blockbreak, Safe on Block');
});

test("the editor's preview shows the badges once synced", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockEditor(page, SWIPE());
    await page.goto('/edit.html?char=boomcat&type=character&tab=specials', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.accolade-picker')).toBeVisible({ timeout: 45000 });

    await chip(page, 'Neutral Skip').click();
    await page.locator('#btn-sync').click();
    await expect(page.locator('.live-preview-pane .skill-accolades .skill-accolade')).toHaveText(['Neutral Skip']);
});
