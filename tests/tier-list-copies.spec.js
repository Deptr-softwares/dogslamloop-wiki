// v1.2: copies of a character on a certified tier list (owner's board card:
// "Add a way for certified tier list creator to add a duplicate of a
// character to their tier list. They will differentiated by a custom badges").
//
// Owner, 2026-11-19: copies are made in a Copies panel; no cap; each copy
// has a badge (a label and a colour the creator picks), and the original may
// have one too. Mine, reversible: a label is at most 12 characters, its text
// is black or white to suit the colour, a new copy waits in Unranked, each
// copy moves and is logged on its own, and a copy still in Unranked stops
// SAVE (save_tier_list stores only the tiers, so an unplaced copy has nowhere
// to be kept).
//
// An entry in tiers[].characters is "page_id" (as before), { id, label,
// color } for a badged original, or { id, copy, label, color } for a copy,
// whose key is "page_id#copy" (window.tierListEntry, js/site_utils.js).
const { test, expect } = require('@playwright/test');

// --- THE EDITOR ---

const LIST = {
    id: 'list-1',
    slug: 'owner',
    owner_id: 'u-me',
    author_name: 'Air Putrifier',
    tiers: [
        { name: 'S', color: '#ff0000', characters: ['ten_shadows'] },
        { name: 'B', color: '#ffff00', characters: ['vessel'] },
    ],
    reasoning: [],
};

// listDelay holds the list back the way a real network does: the site builds
// its dropdowns 100ms after load, and in production the list always arrives
// after that (the same option as tests/tier-editor.spec.js).
async function openEditor(page, { list = LIST, changes = [], listDelay = 0 } = {}) {
    await page.addInitScript(({ list, changes, listDelay }) => {
        window.__rpcCalls = [];
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
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u-me', email: 'a@b.test' }, access_token: 't' } },
                    });
                    client.from = (table) => {
                        if (table === 'tier_lists') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                maybeSingle: async () => {
                                    if (listDelay) await new Promise(r => setTimeout(r, listDelay));
                                    return { data: list, error: null };
                                },
                                then(r) { return r({ data: [list], error: null }); },
                            };
                            return chain;
                        }
                        if (table === 'tier_list_changes') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; }, order() { return chain; },
                                then(r) { return r({ data: changes, error: null }); },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, p) {
                                if (p === 'then') return (r) => r({ data: [], error: null });
                                if (p === 'single' || p === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        return name === 'save_tier_list' ? { data: 'Saved.', error: null } : { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, { list, changes, listDelay });
    await page.goto('/tier-editor.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.tier-editor-board');
}

async function pickCopyCharacter(page, id) {
    await page.evaluate((id) => {
        const select = document.getElementById('tier-copy-character');
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
}

async function addCopy(page, id, label) {
    await pickCopyCharacter(page, id);
    await page.fill('#tier-copy-label', label);
    await page.click('#btn-add-copy');
}

const withBadge = (page, scope, label) =>
    page.locator(`${scope} .tier-portrait`, { has: page.locator('.tier-badge', { hasText: label }) });
const place = (page, key, target) => page.evaluate(([k, t]) => window.tierEditorPlace(k, t), [key, target]);
const saveBtn = (page) => page.locator('#btn-save-tier-list');
const lastSave = (page) => page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'save_tier_list').pop().params);

test('a copy is made in the Copies panel, waits in Unranked, and saves with its badge once placed', async ({ page }) => {
    // The list arrives after the site's dropdowns are built, as in production,
    // so the picker's own dropdown is the one this file builds.
    await openEditor(page, { listDelay: 400 });

    // The real control: the site's dropdown, then the badge, then + COPY.
    await page.click('.tier-copy-add .manga-select-trigger');
    await page.click('.tier-copy-add .manga-option:text-is("Vessel")');
    await page.fill('#tier-copy-label', 'Ult');
    await page.click('#btn-add-copy');

    const copy = withBadge(page, '#tier-editor-tray', 'Ult');
    await expect(copy).toHaveCount(1);
    const key = await copy.getAttribute('data-char-id');
    expect(key).toMatch(/^vessel#[a-z0-9]+$/);
    await expect(page.locator('#tier-copy-label')).toHaveValue('');
    // The panel lists Vessel's original and its copy.
    await expect(page.locator('#tier-copies .tier-copy-group[data-copy-group="vessel"] .tier-copy-row')).toHaveCount(2);

    await place(page, key, '0');
    await expect(withBadge(page, '.tier-editor-row[data-tier-index="0"]', 'Ult')).toHaveCount(1);
    // A first placement is a move like any other, named by its badge.
    const moveRow = page.locator('.tier-move', { hasText: 'Vessel [Ult]' });
    await expect(moveRow.locator('.tier-move-arrow')).toHaveText('→ S');
    await expect(saveBtn(page)).toBeDisabled();
    await moveRow.locator('.tier-move-note').fill('Ult form is a different character.');
    await expect(saveBtn(page)).toBeEnabled();
    await saveBtn(page).click();

    const params = await lastSave(page);
    expect(params.p_tiers[0].characters).toEqual([
        'ten_shadows',
        { id: 'vessel', copy: key.split('#')[1], label: 'Ult', color: '#888888' },
    ]);
    expect(params.p_tiers[1].characters, 'the original is stored as before').toEqual(['vessel']);
    expect(params.p_changes).toEqual([
        { character_id: key, from_tier: null, to_tier: 'S', note: 'Ult form is a different character.' },
    ]);
});

test('there is no cap on copies', async ({ page }) => {
    await openEditor(page);
    for (const label of ['One', 'Two', 'Three', 'Four']) await addCopy(page, 'vessel', label);

    await expect(page.locator('#tier-editor-tray .tier-portrait[data-char-id^="vessel#"]')).toHaveCount(4);
    const keys = await page.locator('#tier-editor-tray .tier-portrait[data-char-id^="vessel#"]')
        .evaluateAll(nodes => nodes.map(n => n.dataset.charId));
    expect(new Set(keys).size, 'every copy has its own key').toBe(4);
});

test('a copy still in Unranked stops SAVE, and says which one', async ({ page }) => {
    await openEditor(page);
    await expect(saveBtn(page)).toBeEnabled();

    await addCopy(page, 'vessel', 'Ult');
    await expect(saveBtn(page)).toBeDisabled();
    await expect(page.locator('#tier-save-status')).toContainText('Vessel [Ult]');
    await expect(page.locator('#tier-save-status')).toContainText('Unranked');

    // Placed, and noted, it saves.
    const key = await withBadge(page, '#tier-editor-tray', 'Ult').getAttribute('data-char-id');
    await place(page, key, '1');
    await page.locator('.tier-move', { hasText: 'Vessel [Ult]' }).locator('.tier-move-note').fill('Placed.');
    await expect(saveBtn(page)).toBeEnabled();

    // Dragged back, it waits in Unranked again with its badge, not lost.
    await place(page, key, 'unranked');
    await expect(withBadge(page, '#tier-editor-tray', 'Ult')).toHaveAttribute('data-char-id', key);
    await expect(saveBtn(page)).toBeDisabled();
});

test('a stored list with junk and a repeated character opens clean, and saves that way', async ({ page }) => {
    // save_tier_list stores whatever it is sent.
    await openEditor(page, {
        list: {
            ...LIST,
            tiers: [
                { name: 'S', color: '#ff0000', characters: ['vessel', 42, null, { label: 'no id' }] },
                { name: 'B', color: '#ffff00', characters: ['vessel', 'ten_shadows'] },
            ],
        },
    });
    await expect(page.locator('.tier-editor-board .tier-portrait[data-char-id="vessel"]'), 'a key met twice keeps its first place').toHaveCount(1);
    await expect(page.locator('.tier-editor-row[data-tier-index="0"] .tier-portrait')).toHaveCount(1);
    await expect(page.locator('.tier-move')).toHaveCount(0);
    await saveBtn(page).click();
    const params = await lastSave(page);
    expect(params.p_tiers.map(t => t.characters)).toEqual([['vessel'], ['ten_shadows']]);
});

test('a new copy never takes a key the changelog already holds', async ({ page }) => {
    // 2/7 is 0.aaaa... in base 36 and 1/7 is 0.5555..., so the first key drawn
    // would be "aaaa", which a deleted copy left in the changelog. Pinned just
    // before + COPY: the page's own code draws random numbers while it loads.
    await openEditor(page, {
        changes: [{ id: 'old', list_id: 'list-1', character_id: 'vessel#aaaa', from_tier: 'S', to_tier: null, note: 'Gone.', created_at: '2026-11-01T00:00:00Z' }],
    });
    await pickCopyCharacter(page, 'vessel');
    await page.fill('#tier-copy-label', 'Ult');
    await page.evaluate(() => {
        const real = Math.random;
        const queue = [2 / 7, 1 / 7];
        Math.random = () => (queue.length ? queue.shift() : real());
    });
    await page.click('#btn-add-copy');
    await expect(withBadge(page, '#tier-editor-tray', 'Ult')).toHaveAttribute('data-char-id', 'vessel#5555');
});

test('the original may carry a badge, and an empty one saves exactly as before', async ({ page }) => {
    await openEditor(page);
    await addCopy(page, 'vessel', 'Ult');
    const key = await withBadge(page, '#tier-editor-tray', 'Ult').getAttribute('data-char-id');
    await place(page, key, '0');
    await page.locator('.tier-move', { hasText: 'Vessel [Ult]' }).locator('.tier-move-note').fill('Placed.');

    const original = page.locator('#tier-copies .tier-copy-row[data-copy-key="vessel"] .tier-copy-label-input');
    await original.fill('Base');
    await expect(withBadge(page, '.tier-editor-row[data-tier-index="1"]', 'Base')).toHaveCount(1);
    await saveBtn(page).click();
    expect((await lastSave(page)).p_tiers[1].characters).toEqual([{ id: 'vessel', label: 'Base', color: '#888888' }]);

    await original.fill('');
    await expect(page.locator('.tier-editor-row[data-tier-index="1"] .tier-badge')).toHaveCount(0);
    await saveBtn(page).click();
    expect((await lastSave(page)).p_tiers[1].characters).toEqual(['vessel']);
});

test('a copy needs a badge: + COPY waits for one, and clearing it stops SAVE', async ({ page }) => {
    await openEditor(page);
    await pickCopyCharacter(page, 'vessel');
    await expect(page.locator('#btn-add-copy')).toBeDisabled();
    await page.fill('#tier-copy-label', '   ');
    await expect(page.locator('#btn-add-copy'), 'spaces are not a badge').toBeDisabled();
    await page.fill('#tier-copy-label', 'Ult');
    await expect(page.locator('#btn-add-copy')).toBeEnabled();
    await page.click('#btn-add-copy');

    const key = await withBadge(page, '#tier-editor-tray', 'Ult').getAttribute('data-char-id');
    await place(page, key, '0');
    await page.locator('.tier-move', { hasText: 'Vessel [Ult]' }).locator('.tier-move-note').fill('Placed.');
    await expect(saveBtn(page)).toBeEnabled();

    await page.locator(`#tier-copies .tier-copy-row[data-copy-key="${key}"] .tier-copy-label-input`).fill('');
    await expect(saveBtn(page)).toBeDisabled();
    await expect(page.locator('#tier-save-status')).toContainText('Every copy needs a badge');
});

const SAVED_WITH_COPIES = {
    ...LIST,
    tiers: [
        { name: 'S', color: '#ff0000', characters: ['ten_shadows', { id: 'vessel', copy: 'k1', label: 'Ult', color: '#ff0000' }] },
        { name: 'B', color: '#ffff00', characters: [{ id: 'vessel', label: 'Base', color: '#00ff00' }] },
    ],
};

test('a saved list with copies loads back: badges on the board, the copies in the panel', async ({ page }) => {
    await openEditor(page, { list: SAVED_WITH_COPIES });

    await expect(page.locator('.tier-editor-row[data-tier-index="0"] .tier-portrait[data-char-id="vessel#k1"] .tier-badge')).toHaveText('Ult');
    await expect(page.locator('.tier-editor-row[data-tier-index="1"] .tier-portrait[data-char-id="vessel"] .tier-badge')).toHaveText('Base');
    // Vessel is placed (twice), so it is not also waiting in Unranked.
    await expect(page.locator('#tier-editor-tray .tier-portrait[data-char-id^="vessel"]')).toHaveCount(0);
    await expect(page.locator('#tier-copies .tier-copy-row[data-copy-key="vessel"] .tier-copy-label-input')).toHaveValue('Base');
    await expect(page.locator('#tier-copies .tier-copy-row[data-copy-key="vessel#k1"] .tier-copy-label-input')).toHaveValue('Ult');
    await expect(page.locator('.tier-move')).toHaveCount(0);
    await expect(saveBtn(page)).toBeEnabled();
});

test('deleting a placed copy is a removal that needs a note, and the last copy takes the original\'s badge with it', async ({ page }) => {
    await openEditor(page, { list: SAVED_WITH_COPIES });

    await page.locator('#tier-copies .tier-copy-row[data-copy-key="vessel#k1"] [data-copy-delete]').click();
    await expect(page.locator('.tier-portrait[data-char-id="vessel#k1"]')).toHaveCount(0);
    await expect(page.locator('.tier-editor-row[data-tier-index="1"] .tier-portrait[data-char-id="vessel"] .tier-badge')).toHaveCount(0);
    await expect(page.locator('#tier-copies .tier-copy-group')).toHaveCount(0);

    const moveRow = page.locator('.tier-move', { hasText: 'Vessel [Ult]' });
    await expect(moveRow.locator('.tier-move-arrow')).toHaveText('S → unranked');
    await expect(saveBtn(page)).toBeDisabled();
    await moveRow.locator('.tier-move-note').fill('One Vessel is enough.');
    await saveBtn(page).click();

    const params = await lastSave(page);
    expect(params.p_tiers[0].characters).toEqual(['ten_shadows']);
    expect(params.p_tiers[1].characters).toEqual(['vessel']);
    expect(params.p_changes).toEqual([{ character_id: 'vessel#k1', from_tier: 'S', to_tier: null, note: 'One Vessel is enough.' }]);
});

test('a badge colour comes from the site picker, and its text stays readable on it', async ({ page }) => {
    await openEditor(page, { list: SAVED_WITH_COPIES });
    const row = page.locator('#tier-copies .tier-copy-row[data-copy-key="vessel#k1"]');
    const badge = page.locator('.tier-portrait[data-char-id="vessel#k1"] .tier-badge');

    for (const [hex, background, ink] of [['#111111', 'rgb(17, 17, 17)', 'rgb(255, 255, 255)'], ['#eeeeee', 'rgb(238, 238, 238)', 'rgb(0, 0, 0)']]) {
        await row.locator('.tier-control-color').click();
        const popup = row.locator('.tier-color-popup');
        await expect(popup).toBeVisible();
        await popup.locator('.cp-hex').fill(hex);
        await popup.locator('.cp-apply').click();
        await expect(popup).toBeHidden();
        await expect(badge).toHaveCSS('background-color', background);
        await expect(badge).toHaveCSS('color', ink);
    }
    await page.locator('.tier-move-note').count().then(n => expect(n).toBe(0));
    await saveBtn(page).click();
    expect((await lastSave(page)).p_tiers[0].characters[1]).toEqual({ id: 'vessel', copy: 'k1', label: 'Ult', color: '#eeeeee' });
});

test('a badge is never markup, typed or loaded', async ({ page }) => {
    await openEditor(page, {
        list: {
            ...LIST,
            tiers: [{ name: 'S', color: '#ff0000', characters: [{ id: 'vessel', copy: 'k1', label: '<img src=x onerror="window.__xss=1">', color: '#ff0000' }] }],
        },
    });
    // Loaded: cut to 12 characters, and text.
    const loaded = page.locator('.tier-portrait[data-char-id="vessel#k1"] .tier-badge');
    await expect(loaded).toHaveText('<img src=x o');
    await expect(loaded.locator('img')).toHaveCount(0);

    await addCopy(page, 'vessel', '<b>x</b>');
    const typed = withBadge(page, '#tier-editor-tray', '<b>x</b>').locator('.tier-badge');
    await expect(typed).toHaveText('<b>x</b>');
    await expect(typed.locator('b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

// --- THE READER ---

const READER_LIST = {
    id: 'id-owner',
    slug: 'owner',
    author_name: 'Air Putrifier',
    blurb: '',
    status: 'published',
    updated_at: new Date().toISOString(),
    tiers: [
        { name: 'S', color: 'hsl(0, 80%, 60%)', characters: ['ten_shadows', { id: 'vessel', copy: 'k1', label: 'Ult', color: '#ff0000' }] },
        { name: 'A', color: 'hsl(30, 80%, 60%)', characters: [{ id: 'vessel', label: 'Base', color: '#00ff00' }] },
    ],
    reasoning: [],
};

async function openReader(page, { lists = [READER_LIST], changes = [] } = {}) {
    await page.addInitScript(({ lists, changes }) => {
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
                    client.auth.getSession = async () => ({ data: { session: null } });
                    client.from = (table) => {
                        if (table === 'tier_lists') {
                            const q = {};
                            const chain = {
                                select() { return chain; },
                                eq(col, val) { q[col] = val; return chain; },
                                order() { return chain; },
                                maybeSingle: async () => ({ data: lists.find(l => l.slug === q.slug) || null, error: null }),
                                then(resolve) { return resolve({ data: lists, error: null }); },
                            };
                            return chain;
                        }
                        if (table === 'tier_list_changes') {
                            const q = { range: null, limit: null, count: false };
                            const chain = {
                                select(_c, o) { if (o && o.count) q.count = true; return chain; },
                                eq() { return chain; }, order() { return chain; },
                                limit(n) { q.limit = n; return chain; },
                                range(a, b) { q.range = [a, b]; return chain; },
                                then(resolve) {
                                    let out = changes;
                                    if (q.range) out = changes.slice(q.range[0], q.range[1] + 1);
                                    else if (q.limit) out = changes.slice(0, q.limit);
                                    return resolve({ data: out, count: q.count ? changes.length : null, error: null });
                                },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, p) {
                                if (p === 'then') return (r) => r({ data: [], error: null });
                                if (p === 'single' || p === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    client.rpc = async () => ({ data: null, error: null });
                    return client;
                };
            },
        });
    }, { lists, changes });
    await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#tier-list-ui');
    await page.click('[data-list-slug="owner"]');
    await expect(page.locator('#tier-list-ui .ctl-row').first()).toBeVisible();
}

const CHANGES = [
    { id: 'c2', list_id: 'id-owner', character_id: 'vessel#k1', from_tier: 'A', to_tier: 'S', note: 'The Ult form is a monster.', author_name: 'Air Putrifier', created_at: '2026-11-18T00:00:00Z' },
    { id: 'c1', list_id: 'id-owner', character_id: 'vessel', from_tier: null, to_tier: 'A', note: 'Base form is solid.', author_name: 'Air Putrifier', created_at: '2026-11-01T00:00:00Z' },
];

test('the reader shows every copy with its badge, and each one\'s own last move on hover', async ({ page }) => {
    await openReader(page, { changes: CHANGES });

    const copy = page.locator('#tier-list-ui [data-ctl-char="vessel#k1"]');
    const original = page.locator('#tier-list-ui [data-ctl-char="vessel"]');
    await expect(copy.locator('.tier-badge')).toHaveText('Ult');
    await expect(copy.locator('.tier-badge')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await expect(original.locator('.tier-badge')).toHaveText('Base');
    await expect(page.locator('#tier-list-ui [data-ctl-char="ten_shadows"] .tier-badge')).toHaveCount(0);
    // Over the art, not under it: the badge is what the page shows at its spot.
    // The badge and the art both take no pointer events (hovering either is
    // hovering the portrait), and elementFromPoint skips such elements, so
    // both are switched on for the measuring and stacking decides the hit.
    const onTop = await copy.evaluate(portrait => {
        const parts = [...portrait.querySelectorAll('.tier-badge, .tier-portrait-img')];
        parts.forEach(p => { p.style.pointerEvents = 'auto'; });
        const badge = portrait.querySelector('.tier-badge');
        const r = badge.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === badge;
        parts.forEach(p => { p.style.pointerEvents = ''; });
        return hit;
    });
    expect(onTop, 'the badge is drawn above the portrait').toBe(true);

    await copy.hover();
    await expect(page.locator('#wiki-frame-tooltip .ctl-tip-move')).toHaveText('A → S');
    await expect(page.locator('#wiki-frame-tooltip .ctl-tip-note')).toHaveText('The Ult form is a monster.');
    await page.mouse.move(0, 0);
    await original.hover();
    await expect(page.locator('#wiki-frame-tooltip .ctl-tip-move')).toHaveText('added to A');
});

test('the changelog names a copy by its badge', async ({ page }) => {
    await openReader(page, { changes: CHANGES });
    await expect(page.locator('.ctl-changelog .ctl-change-char')).toHaveText(['Vessel [Ult]', 'Vessel [Base]']);
});

test('a hand-made entry cannot break the page: bad colours, long labels, bad ids', async ({ page }) => {
    // save_tier_list stores tiers as sent, so the reader trusts none of it.
    const requests = [];
    page.on('request', r => { if (r.url().startsWith('https://example.test/')) requests.push(r.url()); });
    await openReader(page, {
        lists: [{
            ...READER_LIST,
            tiers: [{
                name: 'S', color: 'hsl(0, 80%, 60%)', characters: [
                    { id: 'vessel', copy: 'k1', label: 'ABCDEFGHIJKLMNOP', color: 'red; background-image: url(https://example.test/x)' },
                    { id: 42 }, null, { label: 'no id' },
                    'ten_shadows',
                ],
            }],
        }],
    });

    const portraits = page.locator('#tier-list-ui .ctl-row .tier-portrait');
    await expect(portraits).toHaveCount(2);
    const badge = page.locator('#tier-list-ui [data-ctl-char="vessel#k1"] .tier-badge');
    await expect(badge).toHaveText('ABCDEFGHIJKL');
    await expect(badge).toHaveCSS('background-color', 'rgb(136, 136, 136)');
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
});
