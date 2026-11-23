// The Overseer's DIFF VIEW, side by side (owner's Overseer card, v1.2).
//
// "turning the navigation bar to an overlay that can pop out and in, and then
// fit in the review panel that page current state with all the red parts, and
// the current submission with all the green parts". The owner's pick from the
// mockups (2026-11-18): the whole page, side by side, rows level.
//
// Every test opens a real submission in the real overseer.html, as an admin, with
// only the database answered by the test. Both halves are drawn by the site's
// own renderers, so what is asserted is what a reviewer sees: which words are
// struck or added, where a slot stands, whether two rows sit level.
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: text });

const OVERVIEW = [
    para('First paragraph stays the same on both sides.'),
    para('Use it after a dash to start a combo, then Downslam on the third M1.'),
    para('Good for punishing a whiffed M1.'),
];

const liveDesc = (over = {}) => ({
    profile: { name: 'Boomcat', archetype: 'Rushdown', image: '' },
    playstyle: {}, overview: OVERVIEW, strategy: [], extras: [],
    matchups: [], counterplay: [], starterGuide: [],
    comboIntro: [], comboGroups: [], comboList: [], techIntro: [], techGroups: [], techList: [],
    moveStrategies: {}, modeData: {},
    ...over,
});

const leaf = (label, header, startup) => ({
    label, headerInfo: header, totalScale: 40,
    bars: [{ phases: [{ label: 'Startup', duration: startup, styleClass: 'bg-startup' }, { label: 'Recovery', duration: 40 - startup, styleClass: 'bg-recovery' }] }],
});
const move = (damage, chargedHeader) => ({
    id: 'm-1', name: 'Example Move', input: '2', type: 'Melee', damageType: 'Physical', variant: 'Standard',
    stats: [{ label: 'Damage', value: damage }, { label: 'Cooldown', value: '12s' }],
    variants: { std: leaf('Standard', 'Tap', 12), chg: leaf('Charged', chargedHeader, 20) },
});
const liveFrame = (over = {}) => ({ modes: [], m1s: [], skills: [move('14', 'Hold for 1s')], specials: [], modeData: {}, ...over });

const rev = (over = {}) => ({
    id: '00000000-0000-4000-8000-000000000001',
    page_id: 'boomcat', page_type: 'character', status: 'pending',
    author_id: 'u-author', author_name: 'Someone', created_at: '2026-11-17T10:00:00Z',
    is_delta: true, target_scope: 'overview', target_key: 'full', delta_payload: OVERVIEW,
    qa_metadata: { changelog: 'An edit.', confidence: 'high', evidence: '' },
    supporters: [], opposers: [], ticket_chat: [],
    ...over,
});

// overseer.html as an admin (or the given role row), with the queue and the live
// page answered here. Realtime is stubbed, so nothing reaches Supabase.
async function openOverseer(page, { rows = [rev()], desc = liveDesc(), frame = liveFrame(), role = { role: 'admin' } } = {}) {
    await page.addInitScript(({ rows, desc, frame, role }) => {
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
                        if (table === 'user_roles') return thenable({ data: [role], error: null });
                        if (table === 'pending_revisions') return thenable({ data: rows.map(r => ({ ...r })), error: null });
                        if (table === 'page_data') return thenable({ data: { desc_data: desc, frame_data: frame, tab_settings: null }, error: null });
                        return thenable({ data: [], error: null });
                    };
                    const channel = { on() { return channel; }, subscribe() { return channel; } };
                    client.channel = () => channel;
                    client.removeChannel = () => {};
                    return client;
                };
            },
        });
    }, { rows, desc, frame, role });
    await page.goto('/overseer.html', { waitUntil: 'networkidle' });
}

async function reviewFirst(page) {
    await expect(page.locator('#queue-container .admin-review-btn').first()).toBeVisible({ timeout: 15000 });
    await page.locator('#queue-container .admin-review-btn').first().click();
    await expect(page.locator('.sbs-col-right')).toBeVisible({ timeout: 15000 });
}

const left = (page) => page.locator('.sbs-col-left');
const right = (page) => page.locator('.sbs-col-right');
const top = (loc) => loc.evaluate(el => el.getBoundingClientRect().top);
const paragraph = (col, text) => col.locator('p.strategy-paragraph', { hasText: text });

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
});

test('a submission opens side by side: what goes struck in red on the live page, what comes in green on the submission, rows level', async ({ page }) => {
    const edited = [
        para('First paragraph stays the same on both sides.'),
        para('Use it straight out of a dash to start a combo, then Uppercut on the third M1.'),
        { type: 'table', headers: ['Range', 'Hits'], rows: [['Mid', '3']] },
        para('Good for punishing a whiffed M1.'),
    ];
    await openOverseer(page, { rows: [rev({ delta_payload: edited })] });
    await reviewFirst(page);

    await expect(page.locator('#btn-view-diff')).toHaveClass(/btn-sys-purple/);
    await expect(page.locator('.sbs-count')).toHaveText('1 change on this tab');
    await expect(left(page).locator('del.diff-del')).toHaveText(['after', 'Downslam']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['straight out of', 'Uppercut']);
    // Only the marks of each side's own colour: nothing added shows on the live
    // side, nothing removed on the submission's.
    await expect(left(page).locator('ins')).toHaveCount(0);
    await expect(right(page).locator('del')).toHaveCount(0);

    // The new table is the submission's alone, with a slot opposite it.
    const table = right(page).locator('.sbs-new table, table.sbs-new, .sbs-new');
    await expect(table.first()).toContainText('Range');
    const slot = left(page).locator('.sbs-slot');
    await expect(slot).toHaveText('Not on the live page');
    const slotBox = await slot.boundingBox();
    const tableBox = await table.first().boundingBox();
    expect(slotBox.y).toBeLessThanOrEqual(tableBox.y + 1);
    expect(slotBox.y + slotBox.height).toBeGreaterThanOrEqual(tableBox.y + tableBox.height - 1);

    // The paragraph after it sits level on both sides, and so does the changed one.
    for (const text of ['Good for punishing', 'Use it']) {
        expect(Math.abs(await top(paragraph(left(page), text)) - await top(paragraph(right(page), text)))).toBeLessThan(1.5);
    }

    // Two pages need the room: wider than the one page's 1,000px the preview
    // keeps to otherwise.
    expect((await page.locator('.sbs').boundingBox()).width).toBeGreaterThan(1100);
});

test("a move's strategy text is compared with the rest of its card", async ({ page }) => {
    // Drawn into the card 300ms after the card itself (js/pages/core/page_render.js).
    const edit = rev({
        target_scope: 'move', target_key: 'skills::m-1',
        delta_payload: { frame_data: move('14', 'Hold for 1s'), desc_data: [para('Combo into it from a whiffed M1.')] },
    });
    await openOverseer(page, {
        rows: [edit],
        desc: liveDesc({ moveStrategies: { 'm-1': [para('Combo into it from a blocked M1.')] } }),
    });
    await reviewFirst(page);

    await expect(left(page).locator('del.diff-del')).toHaveText(['blocked']);
    await expect(right(page).locator('ins.diff-add')).toHaveText(['whiffed']);
});

test('a tier list opens on CHANGE LIST', async ({ page }) => {
    const tiers = (who) => ({ tabs: [{ id: 'overall', label: 'Overall', tiers: [{ label: 'S', characters: [who] }], changelog: [] }] });
    const edit = rev({
        page_id: 'tierlist', page_type: 'tierlist',
        target_scope: 'tierlist_tiers', target_key: 'overall', delta_payload: tiers('vessel').tabs[0].tiers,
    });
    await openOverseer(page, { rows: [edit], desc: tiers('boomcat'), frame: {} });
    await expect(page.locator('#queue-container .admin-review-btn').first()).toBeVisible({ timeout: 15000 });
    await page.locator('#queue-container .admin-review-btn').first().click();

    await expect(page.locator('#admin-diff-container .diff-view-title')).toHaveText('CHANGE LIST');
    await expect(page.locator('.sbs')).toHaveCount(0);
    await expect(page.locator('#btn-view-diff')).toHaveClass(/btn-sys-purple/);
});

test('a block the submission removes is outlined on the live side, with a slot opposite it', async ({ page }) => {
    await openOverseer(page, { rows: [rev({ delta_payload: [OVERVIEW[0], OVERVIEW[2]] })] });
    await reviewFirst(page);

    await expect(left(page).locator('.sbs-gone')).toHaveText(/Use it after a dash/);
    await expect(right(page).locator('.sbs-slot')).toHaveText('Removed by this submission');
    expect(Math.abs(await top(paragraph(left(page), 'Good for punishing')) - await top(paragraph(right(page), 'Good for punishing')))).toBeLessThan(1.5);
});

test('a change inside a hidden Micro Variant marks its tab, and pressing the tab on one side switches both', async ({ page }) => {
    const edit = rev({
        target_scope: 'move', target_key: 'skills::m-1',
        delta_payload: { frame_data: move('16', 'Hold for 2s'), desc_data: [] },
    });
    await openOverseer(page, { rows: [edit] });
    await reviewFirst(page);

    // The Damage stat is on show from the start.
    await expect(left(page).locator('del.diff-del', { hasText: '14' })).toBeVisible();
    await expect(right(page).locator('ins.diff-add', { hasText: '16' })).toBeVisible();

    // "Hold for 2s" is under Charged, which neither side shows yet.
    const charged = (col) => col.locator('.skill-tab-bar button', { hasText: 'Charged' });
    await expect(charged(left(page))).toHaveClass(/sbs-tab-changed/);
    await expect(charged(right(page))).toHaveClass(/sbs-tab-changed/);
    await expect(right(page).locator('ins.diff-add', { hasText: '2s' })).toBeHidden();
    // Standard has no change, so it carries no dot.
    await expect(right(page).locator('.skill-tab-bar button', { hasText: 'Standard' })).not.toHaveClass(/sbs-tab-changed/);

    await charged(right(page)).click();
    await expect(charged(left(page))).toHaveClass(/active/);
    await expect(left(page).locator('del.diff-del', { hasText: '1s' })).toBeVisible();
    await expect(right(page).locator('ins.diff-add', { hasText: '2s' })).toBeVisible();
});

test('NEXT CHANGE goes to each change in turn', async ({ page }) => {
    const filler = Array.from({ length: 12 }, (_, i) => para(`Unchanged line number ${i + 1} to put the two changes far apart.`));
    const before = [para('The opening line.'), ...filler, para('The closing line.')];
    const after = [para('The opening line, rewritten.'), ...filler, para('The closing line, rewritten.')];
    await openOverseer(page, { desc: liveDesc({ overview: before }), rows: [rev({ delta_payload: after })] });
    await reviewFirst(page);

    const next = page.locator('.sbs-next');
    await expect(page.locator('.sbs-count')).toHaveText('2 changes on this tab');

    const inView = (loc) => loc.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    await next.click();
    await expect(next).toHaveText('↓ NEXT CHANGE (1 of 2)');
    await expect.poll(() => inView(paragraph(right(page), 'The opening line, rewritten'))).toBe(true);
    await next.click();
    await expect(next).toHaveText('↓ NEXT CHANGE (2 of 2)');
    await expect.poll(() => inView(paragraph(right(page), 'The closing line, rewritten'))).toBe(true);
    expect(await inView(paragraph(right(page), 'The opening line, rewritten'))).toBe(false);
});

test('a change the page does not draw is pointed out, and CHANGE LIST shows it', async ({ page }) => {
    // An editor folder groups blocks in the editor only: the page draws the
    // block the same with or without it.
    const foldered = [OVERVIEW[0], { ...OVERVIEW[1], folder: 'Combo notes' }, OVERVIEW[2]];
    await openOverseer(page, { rows: [rev({ delta_payload: foldered })] });
    await reviewFirst(page);

    await expect(page.locator('.sbs-count')).toHaveText('No change on this tab');
    await expect(page.locator('.sbs-note')).toContainText('in ways the page does not show');
    await expect(page.locator('.sbs-next')).toBeHidden();

    await page.getByRole('button', { name: 'CHANGE LIST' }).click();
    await expect(page.locator('#admin-diff-container .diff-location-label')).toContainText('Overview & Strategy › Overview');
    await expect(page.locator('.sbs')).toHaveCount(0);
    await expect(page.locator('#btn-view-diff'), 'the list is part of DIFF VIEW').toHaveClass(/btn-sys-purple/);
});

test('a picture that loads late still leaves the rows level', async ({ page }) => {
    // Drawn as a square only once the file arrives, well after the rows were
    // first lined up.
    const png = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 240;
        c.getContext('2d').fillRect(0, 0, 240, 240);
        return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    let release;
    const held = new Promise(r => { release = r; });
    await page.route('**/__sbs/late.png', async (route) => {
        await held;
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    const edited = [OVERVIEW[0], { type: 'image', src: 'http://localhost:8123/__sbs/late.png', alt: 'late' }, OVERVIEW[1], OVERVIEW[2]];
    await openOverseer(page, { rows: [rev({ delta_payload: edited })] });
    await reviewFirst(page);

    const image = right(page).locator('img[alt="late"]');
    await expect(image).toHaveCount(1);
    release();
    await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(240);
    await expect.poll(async () => Math.abs(await top(paragraph(left(page), 'Use it')) - await top(paragraph(right(page), 'Use it')))).toBeLessThan(1.5);
    const slot = await left(page).locator('.sbs-slot').boundingBox();
    expect(slot.height).toBeGreaterThanOrEqual(240);
});

test('another tab picked while DIFF VIEW is open is drawn side by side too', async ({ page }) => {
    const edit = rev({
        target_scope: 'multi', target_key: 'batch',
        delta_payload: [
            { scope: 'overview', key: 'full', payload: [OVERVIEW[0], para('A new middle line.'), OVERVIEW[2]] },
            { scope: 'move', key: 'skills::m-1', payload: { frame_data: move('16', 'Hold for 1s'), desc_data: [] } },
        ],
    });
    await openOverseer(page, { rows: [edit] });
    await reviewFirst(page);

    await page.locator('#nav-skills').click();
    await expect(right(page).locator('.skill-title')).toHaveText('Example Move');
    await expect(right(page).locator('ins.diff-add')).toHaveText(['16']);
    await expect(page.locator('#tab-skills'), 'the plain Skills pane stays put away').toBeHidden();

    await page.locator('#nav-overview').click();
    await expect(right(page).locator('ins.diff-add')).toHaveText(['A new middle line.']);

    // A tab the submission did not touch says so.
    await page.locator('#nav-m1s').click();
    await expect(page.locator('.sbs-note')).toHaveText('Nothing on this tab changed.');
});

test('PENDING SUBMISSION and LIVE VERSION still draw every move tab', async ({ page }) => {
    // The side-by-side draws one move tab at a time; the two whole-page views
    // must not inherit that.
    const frame = liveFrame({ m1s: [{ ...move('5', 'Hold for 1s'), id: 'jab', name: 'First Jab' }] });
    const edit = rev({
        target_scope: 'move', target_key: 'skills::m-1',
        delta_payload: { frame_data: move('16', 'Hold for 1s'), desc_data: [] },
    });
    await openOverseer(page, { rows: [edit], frame });
    await reviewFirst(page);

    for (const view of ['#btn-view-pending', '#btn-view-live']) {
        await page.locator(view).click();
        await page.locator('#nav-m1s').click();
        await expect(page.locator('#tab-m1s .skill-title')).toHaveText('First Jab');
        await page.locator('#nav-skills').click();
        await expect(page.locator('#tab-skills .skill-title')).toHaveText('Example Move');
    }
});

test('what a contributor wrote stays text on both sides', async ({ page }) => {
    const evil = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
    await openOverseer(page, { rows: [rev({ delta_payload: [OVERVIEW[0], para(`Use it ${evil} after a dash.`), OVERVIEW[2]] })] });
    await reviewFirst(page);

    await expect(right(page).locator('ins.diff-add').first()).toBeVisible();
    await expect(right(page)).toContainText('onerror=');
    await expect(right(page).locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the queue column is out when the Overseer opens, goes away for a submission, and ☰ QUEUE brings it back', async ({ page }) => {
    await openOverseer(page);
    const column = page.locator('#admin-sidebar');
    const toggle = page.locator('#queue-toggle');
    const paneWidth = () => page.locator('.admin-main-pane').evaluate(el => el.getBoundingClientRect().width);

    await expect(column).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const narrow = await paneWidth();

    await reviewFirst(page);
    await expect(column).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await paneWidth()).toBeGreaterThan(narrow + 250);

    await toggle.click();
    await expect(column).toBeVisible();
    await expect(page.locator('#queue-container .admin-review-btn')).toBeVisible();
    await toggle.click();
    await expect(column).toBeHidden();
});

test('a moderator-only Overseer has no ☰ QUEUE and keeps its column', async ({ page }) => {
    await openOverseer(page, { role: { role: 'trusted_editor', can_moderate: true } });
    await expect(page.locator('body')).toHaveClass(/admin-moderator-only/, { timeout: 15000 });
    await expect(page.locator('#queue-toggle')).toBeHidden();
    await page.evaluate(() => window.setQueueOpen(false));
    await expect(page.locator('#admin-sidebar')).toBeVisible();
});

test('on a phone the two versions stack, live above the submission, with nothing lined up', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverseer(page, { rows: [rev({ delta_payload: [OVERVIEW[0], para('A new middle line.'), OVERVIEW[1], OVERVIEW[2]] })] });
    await expect(page.locator('#queue-toggle'), 'a phone keeps its own SHOW PREVIEW switch').toBeHidden();
    await page.locator('#queue-container .admin-review-btn').first().click();
    if (await page.locator('#mobile-preview-toggle').isVisible()) await page.locator('#mobile-preview-toggle').click();
    await expect(right(page)).toBeVisible({ timeout: 15000 });

    const l = await left(page).boundingBox();
    const r = await right(page).boundingBox();
    expect(r.y).toBeGreaterThanOrEqual(l.y + l.height - 1);
    expect(Math.abs(r.x - l.x)).toBeLessThan(2);
    await expect(page.locator('.sbs-spacer')).toHaveCount(0);
    await expect(left(page).locator('.sbs-head-left')).toBeVisible();
});

test('a Micro Variant only one side has leaves both tab bars level, the same size, and still', async ({ page }) => {
    // Live: four stats and two variants. The submission: three stats, and a
    // variant between the two. Until 2026-11-21 the levelling pushed each
    // paired button down inside its row on its own: the row grew, the new
    // button stretched to fill it, and the buttons' `transition: all`
    // animated each margin, so the levelling ran again mid-animation every
    // frame and the tabs never stopped moving (owner's Salaryman report).
    const stats = (...pairs) => pairs.map(([label, value]) => ({ label, value }));
    const liveMove = { ...move('16', 'Hold for 1s'), stats: stats(['Damage', '16'], ['Cooldown', '16s'], ['Blockbreak?', 'Yes'], ['Hit Ragdoll?', 'No']) };
    const pendingMove = {
        ...liveMove,
        stats: stats(['Damage', '16'], ['Cooldown', '16s'], ['Distance', '25 Studs']),
        variants: { std: liveMove.variants.std, blk: leaf('On Block', 'Blocked', 16), chg: liveMove.variants.chg },
    };
    await openOverseer(page, {
        rows: [rev({ target_scope: 'move', target_key: 'skills::m-1', delta_payload: { frame_data: pendingMove, desc_data: [] } })],
        frame: liveFrame({ skills: [liveMove] }),
    });
    await reviewFirst(page);
    await expect(right(page).locator('.skill-tab-bar > button')).toHaveCount(3);

    const read = () => page.evaluate(() => ['left', 'right'].map(side =>
        [...document.querySelectorAll(`.sbs-col-${side} .skill-tab-bar > button`)].map(b => {
            const box = b.getBoundingClientRect();
            return { text: b.textContent.trim(), top: Math.round(box.top), height: Math.round(box.height), margin: b.style.marginTop };
        })));
    const settled = await read();
    for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(80);
        expect(await read(), 'the tabs stay where the levelling put them').toEqual(settled);
    }

    const [l, r] = settled;
    expect(r.map(b => b.text)).toEqual(['Standard', 'On Block', 'Charged']);
    expect(Math.abs(l[0].top - r[0].top), 'each tab beside its twin').toBeLessThanOrEqual(1);
    expect(Math.abs(l[1].top - r[2].top)).toBeLessThanOrEqual(1);
    expect(r[1].height, 'the new tab is the size of its neighbours').toBe(r[0].height);
    expect([...l, ...r].map(b => b.margin), 'no tab is pushed on its own').toEqual(['', '', '', '', '']);
});

test('the levelling moves a grid row as one, and nothing it pushes animates', async ({ page }) => {
    // Straight at the levelling, with content of its own: one side has a
    // line the other does not, above a twin with `transition: all` in a
    // column (pushed by a margin, which must not animate, or the levelling
    // chases it every frame), and above twins in a two-column grid (which
    // must move as one row, not item by item).
    await page.goto('/overseer.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SideBySide);
    const out = await page.evaluate(async () => {
        const side = (extra) => {
            const root = document.createElement('div');
            root.innerHTML = `
                <div style="display: flex; flex-direction: column;">
                    ${extra ? '<p style="margin: 0; height: 40px;">Only on this side</p>' : ''}
                    <div class="twin-col" style="height: 30px; transition: all 0.3s;">Twin</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr;">
                    ${extra ? '<p style="margin: 0; height: 40px; grid-column: 1 / -1;">Only here too</p>' : ''}
                    <div class="twin-grid" style="height: 30px;">A</div>
                    <div class="twin-grid" style="height: 30px;">B</div>
                </div>`;
            return root;
        };
        const host = document.createElement('div');
        document.body.prepend(host);
        window.SideBySide.mount(host, side(true), side(false));
        const read = () => [...host.querySelectorAll('.twin-col, .twin-grid')].map(el => {
            const box = el.getBoundingClientRect();
            return `${Math.round(box.top)}/${Math.round(box.height)}/${el.style.marginTop || '-'}`;
        }).join(' ');
        const samples = [];
        for (let i = 0; i < 8; i++) { samples.push(read()); await new Promise(r => setTimeout(r, 60)); }
        const tops = (cls) => [...host.querySelectorAll(cls)].map(el => Math.round(el.getBoundingClientRect().top));
        return { samples, col: tops('.twin-col'), grid: tops('.twin-grid'), gridMargins: [...host.querySelectorAll('.twin-grid')].map(el => el.style.marginTop) };
    });

    expect(new Set(out.samples).size, 'everything stops where it was put').toBe(1);
    expect(Math.abs(out.col[0] - out.col[1]), 'the column twins are level').toBeLessThanOrEqual(1);
    // Left A, left B, right A, right B: the rows level, and neither item pushed on its own.
    expect(Math.abs(out.grid[0] - out.grid[2])).toBeLessThanOrEqual(1);
    expect(out.grid[2], 'a grid row keeps its items side by side').toBe(out.grid[3]);
    expect(out.gridMargins).toEqual(['', '', '', '']);
});
