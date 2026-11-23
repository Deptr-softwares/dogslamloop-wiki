// Skill Card accolades (owner's Kanban card "Skill Card accolades", v1.2).
//
// "a preset amount of accolades that editor can attach to the skill card
// however they want. Think of something like the "Safe on block",
// "Blockbreak" badges/banners that some fighting games have under their move
// description. Hovering over the badges will give its full description and
// its name". The owner's pick from the mockups (2026-11-18): under the move's
// name. Their 26 accolades, in their order, are window.ACCOLADES
// (js/pages/core/skill_card.js); a move stores the ids.
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

// An accolade's color as the browser reports it. The expected colors are read
// from window.ACCOLADES rather than typed here, so the owner changing one is
// not a test to edit.
const rgb = (hex) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test("a move's accolades show under its name, in the owner's order, each in its own color with its icon in front", async ({ page }) => {
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

    // The text, the border and the icon in the accolade's own color (the
    // owner's 26, picked 2026-11-19), the icon first.
    const seen = await badges.evaluateAll(els => els.map(el => {
        const accolade = window.ACCOLADES.find(a => a.id === el.dataset.accolade);
        const icon = el.firstElementChild;
        const style = getComputedStyle(el);
        return {
            id: el.dataset.accolade,
            want: accolade && accolade.color,
            color: style.color,
            border: style.borderTopColor,
            iconFirst: !!icon && icon.classList.contains('px-icon') && el.firstChild === icon,
            iconColor: icon ? getComputedStyle(icon).color : '',
            iconFile: icon ? getComputedStyle(icon).maskImage : '',
        };
    }));
    expect(seen).toHaveLength(3);
    for (const badge of seen) {
        expect(badge.want, `${badge.id} has a color`).toMatch(/^#[0-9a-f]{6}$/);
        expect(badge.color, `${badge.id}'s text`).toBe(rgb(badge.want));
        expect(badge.border, `${badge.id}'s border`).toBe(rgb(badge.want));
        expect(badge.iconFirst, `${badge.id}'s icon comes first`).toBe(true);
        expect(badge.iconColor, `${badge.id}'s icon`).toBe(rgb(badge.want));
        expect(badge.iconFile, `${badge.id}'s own icon`).toContain(`/medias/icons/accolades/${badge.id}.png`);
    }
});

// What the reader sees, pixel by pixel, on a 2x screen (most phones): the
// owner shaded 14 of the 26 icons with grays rather than transparency, so a
// plain silhouette in the badge's color would lose their shading. Each pixel
// is the icon's own times the color, laid over the badge, as one clean 2x2
// block (pixel art smoothed into a blur fails), and nothing shows outside it.
test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test("a badge's icon is the owner's pixels in the badge's color, the grays darker, each pixel sharp", async ({ page }) => {
    await drawMoves(page, [SWIPE(['blockbreak'])]);
    const icon = page.locator('#tab-specials .skill-accolade .px-icon').first();
    await expect(icon).toBeVisible();
    const box = await icon.boundingBox();
    expect([box.width, box.height]).toEqual([16, 16]);
    const onDevicePixel = (v) => Math.round(v * 2) / 2;
    const shot = await page.screenshot({ clip: { x: onDevicePixel(box.x), y: onDevicePixel(box.y), width: 16, height: 16 } });

    const result = await page.evaluate(async (b64) => {
        const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
        const pixels = (img) => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return { width: img.width, data: ctx.getImageData(0, 0, c.width, c.height).data };
        };
        const channels = (css) => css.match(/\d+/g).slice(0, 3).map(Number);
        const badge = document.querySelector('#tab-specials .skill-accolade');
        const tint = channels(getComputedStyle(badge).color);
        const ground = channels(getComputedStyle(badge).backgroundColor);
        const drawn = pixels(await load('data:image/png;base64,' + b64));
        const source = pixels(await load('/medias/icons/accolades/blockbreak.png'));
        let wrong = 0;
        let blurred = 0;
        const shades = new Set();
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const i = (y * 16 + x) * 4;
                const alpha = source.data[i + 3] / 255;
                const want = [0, 1, 2].map(c => Math.round(source.data[i + c] * tint[c] / 255 * alpha + ground[c] * (1 - alpha)));
                // The source pixel's 2x2 block of screen pixels.
                const block = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => {
                    const j = ((y * 2 + dy) * drawn.width + (x * 2 + dx)) * 4;
                    return [drawn.data[j], drawn.data[j + 1], drawn.data[j + 2]];
                });
                if (block.some(p => p.join() !== block[0].join())) blurred++;
                if (want.some((v, c) => Math.abs(v - block[0][c]) > 3)) wrong++;
                if (alpha) shades.add(block[0].join());
            }
        }
        return { size: `${drawn.width}`, wrong, blurred, shades: shades.size };
    }, shot.toString('base64'));

    expect(result.size, 'setup: a 2x screenshot').toBe('32');
    expect(result.wrong, 'pixels unlike the icon times the badge color').toBe(0);
    expect(result.blurred, 'pixels smoothed into their neighbours').toBe(0);
    expect(result.shades, 'the grays stay darker shades of the color').toBeGreaterThan(1);
  });
});

test('every accolade has its 16px icon', async ({ page }) => {
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
    const sizes = await page.evaluate(() => Promise.all(window.ACCOLADES.map(a => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(`${a.id}: ${img.naturalWidth}x${img.naturalHeight}`);
        img.onerror = () => resolve(`${a.id}: missing`);
        img.src = `/medias/icons/accolades/${a.id}.png`;
    }))));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter(s => !s.endsWith(': 16x16'))).toEqual([]);
});

test('hovering a badge shows its name and what it means', async ({ page }) => {
    await drawMoves(page, [SWIPE(['safe-on-block', 'execution'])]);
    const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Swipe' });
    const tip = page.locator('#wiki-frame-tooltip');

    await card.locator('.skill-accolade', { hasText: 'Safe on Block' }).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Safe on Block');
    await expect(tip).toContainText('This move cannot be punished on Block');

    await card.locator('.skill-accolade', { hasText: 'Execution' }).hover();
    await expect(tip).toContainText('This move kills earlier than its total damage');
    await page.mouse.move(5, 5);
    await expect(tip).toBeHidden();
});

test('on a phone a long badge wraps inside the card instead of widening the page', async ({ page }) => {
    await drawMoves(page, [SWIPE(['frame-perfect-evasive-punishable', 'hit-only-air-ragdoll', 'safe-on-block', 'semi-uncancelable'])], { width: 360 });
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

    // A ticked chip is in its accolade's color, icon and all, and an unticked
    // one is muted, so what is ticked reads at a glance.
    const look = (name) => chip(page, name).evaluate(el => {
        const icon = el.firstElementChild;
        return {
            want: window.ACCOLADES.find(a => a.id === el.dataset.accolade).color,
            color: getComputedStyle(el).color,
            border: getComputedStyle(el).borderTopColor,
            icon: icon && icon.classList.contains('px-icon') ? getComputedStyle(icon).maskImage : '',
            iconColor: icon ? getComputedStyle(icon).color : '',
        };
    });
    for (const name of ['Safe on Block', 'Blockbreak']) {
        const ticked = await look(name);
        expect(ticked.color, `${name} ticked`).toBe(rgb(ticked.want));
        expect(ticked.border, `${name} ticked`).toBe(rgb(ticked.want));
        expect(ticked.iconColor, `${name}'s icon`).toBe(rgb(ticked.want));
    }
    const unticked = await look('Block Bypass');
    expect(unticked.color, 'unticked').not.toBe(rgb(unticked.want));
    expect(unticked.icon, "an unticked chip still shows its icon").toContain('/medias/icons/accolades/block-bypass.png');

    // Safe and Punishable on Block cannot both be true of one move.
    await chip(page, 'Punishable on Block').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'punishable-on-block']);
    await expect(chip(page, 'Safe on Block')).toHaveAttribute('aria-pressed', 'false');

    // Nor can two of the three Ragdoll ones.
    await chip(page, 'Hit Ragdoll').click();
    await chip(page, 'Cannot hit Ragdoll').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'punishable-on-block', 'cannot-hit-ragdoll']);

    // And Uncancelable against Semi-uncancelable.
    await chip(page, 'Uncancelable').click();
    await chip(page, 'Semi-uncancelable').click();
    expect((await stored(page)).accolades).toEqual(['blockbreak', 'punishable-on-block', 'cannot-hit-ragdoll', 'semi-uncancelable']);

    for (const name of ['Blockbreak', 'Punishable on Block', 'Cannot hit Ragdoll', 'Semi-uncancelable']) await chip(page, name).click();
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
