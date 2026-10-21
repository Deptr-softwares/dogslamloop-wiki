// Emojis in discussion and Forum posts (v1.1, batch 8.5).
//
// The owner's calls (2026-10-21): emojis IN posts (no reactions); the wiki's
// own cats plus Boomcat, named exactly as on the Discord server; every
// standard emoji drawn in Discord's look, Twemoji. Mine, written back and
// kept: one EMOJI button in the post box and the edit box, the cats first,
// then Unicode's groups with a search; 22px in a sentence, 48px when a post
// is only emojis; a picture that will not load becomes its text again.
//
// CAN: what a post draws, what the picker puts in the box, and what is sent.
// CANNOT: Twemoji's real files (the CDN is routed to a local SVG, and the
// address each picture asks for is what is checked). Whether every emoji in
// data/emoji.json has a Twemoji file was checked when the list was built
// (scripts/build-emoji-data.js reads Twemoji's own file listing).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const TWEMOJI = /^https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@/;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#fc0"/></svg>';
const EMOJI_DATA = require('../data/emoji.json');

const post = (over = {}) => ({
    id: over.id || 'p1', page_id: 'honored_one', parent_id: null,
    author_id: OTHER, author_name: 'mango_kun', body: 'look', images: [],
    status: 'visible', created_at: '2026-10-21T10:00:00Z', removed_at: null, removed_by: null,
    ...over,
});

// Returns the Twemoji addresses the page asked for. `missing` names files
// that answer 404, as a file Twemoji does not have would.
async function openThread(page, { rows = [], session = null, missing = [] } = {}) {
    const asked = [];
    await page.route(TWEMOJI, r => {
        const url = r.request().url();
        asked.push(url);
        const file = url.split('/').pop();
        return missing.includes(file)
            ? r.fulfill({ status: 404, body: '' })
            : r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG });
    });

    await page.addInitScript(({ rows, session }) => {
        window.__inserts = [];
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
                    client.auth.getSession = async () => ({ data: { session } });
                    client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        return { data: name === 'get_public_profiles' || name === 'get_page_experts' ? [] : 'ok', error: null };
                    };
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq() { return this; },
                                maybeSingle: async () => ({ data: null, error: null }) };
                        }
                        if (table === 'page_discussions') {
                            const q = { top: false, parents: null, head: false };
                            return {
                                select(_c, o) { if (o && o.head) q.head = true; return this; },
                                eq() { return this; },
                                is(c, v) { if (c === 'parent_id' && v === null) q.top = true; return this; },
                                in(c, v) { if (c === 'parent_id') q.parents = v; return this; },
                                order() { return this; },
                                range() { return this; },
                                insert(payload) {
                                    window.__inserts.push(payload);
                                    return Promise.resolve({ data: payload, error: null });
                                },
                                then(resolve) {
                                    if (q.head) return resolve({ data: null, count: rows.length, error: null });
                                    const out = q.parents ? rows.filter(r => q.parents.includes(r.parent_id))
                                        : q.top ? rows.filter(r => r.parent_id === null) : rows;
                                    return resolve({ data: out, error: null });
                                },
                            };
                        }
                        const inert = new Proxy({}, { get(_t, prop) {
                            if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        } });
                        return inert;
                    };
                    return client;
                };
            },
        });
    }, { rows, session });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title', { timeout: 30000 });
    return asked;
}

const painted = (loc) => loc.evaluate(el => el.complete && el.naturalWidth > 0);
const fileOf = (src) => src.split('/').pop();
// The words a reader sees, pictures left out.
const words = (loc) => loc.evaluate(el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.data).join(''));

test('a post draws the wiki\'s own emojis by name and the standard ones in Twemoji\'s art, and its words stay words', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const body = 'gg :HmmCat: and 😀, not :notACat: or :hmmcat:, © ™ stay text, 1️⃣ 👍🏽 🏳️‍🌈 🇯🇵 <img src=x onerror="window.__xss=1">';
    await openThread(page, { rows: [post({ body })] });
    const shown = page.locator('#post-p1 .discussion-body');

    const cat = shown.locator('img.emoji-custom');
    await expect(cat).toHaveCount(1);
    await expect(cat).toHaveAttribute('alt', ':HmmCat:');
    expect(await cat.getAttribute('src')).toMatch(/medias\/images\/HmmCat\.webp$/);
    await expect.poll(() => painted(cat)).toBe(true);

    // Twemoji's file names: FE0F dropped, except in a sequence with a joiner.
    const standard = shown.locator('img.emoji:not(.emoji-custom)');
    const drawn = await standard.evaluateAll(imgs => imgs.map(i => [i.alt, i.src.split('/').pop()]));
    expect(drawn).toEqual([
        ['😀', '1f600.svg'],
        ['1️⃣', '31-20e3.svg'],
        ['👍🏽', '1f44d-1f3fd.svg'],
        ['🏳️‍🌈', '1f3f3-fe0f-200d-1f308.svg'],
        ['🇯🇵', '1f1ef-1f1f5.svg'],
    ]);
    expect(await standard.first().getAttribute('src')).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@17\.0\.3\/assets\/svg\//);
    await expect.poll(() => painted(standard.first())).toBe(true);

    // Everything else is text: an unknown name, the wrong case, symbols that
    // are text by default, and markup.
    const text = await words(shown);
    expect(text).toContain(':notACat:');
    expect(text).toContain(':hmmcat:');
    expect(text).toContain('© ™ stay text');
    expect(text).toContain('<img src=x onerror="window.__xss=1">');
    await expect(shown.locator('img')).toHaveCount(6);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(shown).not.toHaveClass(/emoji-jumbo/);
    expect(errors).toEqual([]);
});

test('a post of nothing but emojis shows them big, one with words at text size', async ({ page }) => {
    await openThread(page, { rows: [
        post({ id: 'p1', body: ':Boomcat: 😀\n:friedCat:', created_at: '2026-10-21T10:00:00Z' }),
        post({ id: 'p2', body: 'nice :Boomcat:', author_id: ME, author_name: 'me', created_at: '2026-10-21T09:00:00Z' }),
    ] });
    const big = page.locator('#post-p1 .discussion-body');
    await expect(big).toHaveClass(/emoji-jumbo/);
    const bigSizes = await big.locator('img.emoji').evaluateAll(imgs => imgs.map(i => i.getBoundingClientRect().width));
    expect(bigSizes).toEqual([48, 48, 48]);

    const small = page.locator('#post-p2 .discussion-body');
    await expect(small).not.toHaveClass(/emoji-jumbo/);
    const smallSize = await small.locator('img.emoji').evaluate(i => i.getBoundingClientRect().width);
    expect(smallSize).toBeGreaterThan(15);
    expect(smallSize).toBeLessThan(26);
});

test('an emoji with no Twemoji picture falls back: first to the name without U+FE0F, then to the device\'s own', async ({ page }) => {
    const asked = await openThread(page, {
        rows: [post({ body: 'eye 👁️‍🗨️ and new 🫨' })],
        missing: ['1f441-fe0f-200d-1f5e8-fe0f.svg', '1fae8.svg'],
    });
    const shown = page.locator('#post-p1 .discussion-body');
    const eye = shown.locator('img.emoji');
    await expect(eye).toHaveCount(1);
    await expect.poll(async () => fileOf(await eye.getAttribute('src'))).toBe('1f441-200d-1f5e8.svg');
    await expect.poll(() => painted(eye)).toBe(true);
    // The one with no file at all is its character again, as text.
    await expect.poll(() => words(shown)).toContain('new 🫨');
    expect(asked.map(fileOf)).toEqual(expect.arrayContaining(['1f441-fe0f-200d-1f5e8-fe0f.svg', '1f441-200d-1f5e8.svg', '1fae8.svg']));
});

test('EMOJI opens the picker: the cats first, then every group; a pick goes in at the caret and is posted as written', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { session: SESSION });
    const form = page.locator('#discussion-section .discussion-composer').first();
    const area = form.locator('.discussion-textarea');
    const toggle = form.locator('.discussion-emoji-btn');
    const picker = form.locator('.emoji-picker');

    await expect(toggle).toHaveText('EMOJI');
    await expect(picker).toHaveCount(0);
    await toggle.click();
    await expect(picker).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const titles = picker.locator('.emoji-section-title');
    await expect(titles).toHaveCount(1 + EMOJI_DATA.groups.length);
    expect(await titles.allTextContents()).toEqual(['Dogslamloop', ...EMOJI_DATA.groups.map(g => g.name)]);
    const cats = picker.locator('.emoji-section').first().locator('.emoji-cell');
    expect(await cats.evaluateAll(c => c.map(b => b.getAttribute('aria-label'))))
        .toEqual([':HmmCat:', ':darkCat:', ':friedCat:', ':lightCat:', ':Boomcat:']);
    const total = EMOJI_DATA.groups.reduce((n, g) => n + g.emoji.length, 0);
    await expect(picker.locator('.emoji-cell')).toHaveCount(5 + total);
    await expect(picker.locator('.emoji-credit')).toContainText('Twemoji');

    // At the caret, not the end.
    await area.fill('hello world');
    await area.evaluate(a => a.setSelectionRange(5, 5));
    await picker.locator('[data-emoji-insert=":HmmCat:"]').click();
    await expect(area).toHaveValue('hello:HmmCat: world');

    await picker.locator('.emoji-search').fill('grinning face');
    const results = picker.locator('.emoji-results .emoji-cell');
    await expect(results.first()).toHaveAttribute('aria-label', 'grinning face');
    await expect(picker.locator('.emoji-section').first()).toBeHidden();
    await results.first().click();
    await expect(area).toHaveValue('hello:HmmCat:😀 world');

    await picker.locator('.emoji-search').fill('zzzz');
    await expect(picker.locator('.emoji-note')).toHaveText('No emoji by that name.');
    await picker.locator('.emoji-search').fill('');
    await expect(picker.locator('.emoji-note')).toBeHidden();

    // A tab scrolls its group into view.
    await picker.locator('.emoji-tab[aria-label="Flags"]').click();
    const scrolled = await picker.locator('.emoji-scroll').evaluate(s => {
        const flags = Array.from(s.querySelectorAll('.emoji-section')).pop();
        return Math.abs(s.scrollTop - Math.min(flags.offsetTop, s.scrollHeight - s.clientHeight));
    });
    expect(scrolled).toBeLessThanOrEqual(1);

    await picker.locator('.emoji-search').press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await form.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    const sent = await page.evaluate(() => window.__inserts[0][0].body);
    expect(sent).toBe('hello:HmmCat:😀 world');
    expect(errors).toEqual([]);
});

// loading="lazy" alone fetched 744 pictures on opening (2026-10-21): it does
// not hold inside a scrolling box. One picker row is about ten pictures.
test('opening the picker fetches only the pictures in its view, and a group\'s arrive when it is scrolled to', async ({ page }) => {
    const asked = await openThread(page, { session: SESSION });
    const before = asked.length;
    const form = page.locator('#discussion-section .discussion-composer').first();
    await form.locator('.discussion-emoji-btn').click();
    const picker = form.locator('.emoji-picker');
    await expect(picker.locator('.emoji-section')).toHaveCount(1 + EMOJI_DATA.groups.length);
    const smiley = picker.locator('[data-emoji-insert="😀"] img');
    await expect.poll(() => painted(smiley)).toBe(true);
    await page.waitForTimeout(500);
    const onOpen = asked.length - before;
    expect(onOpen, `${onOpen} pictures fetched on opening`).toBeLessThan(150);

    const flag = picker.locator('.emoji-section').last().locator('.emoji-cell img').first();
    expect(await flag.getAttribute('src')).toBeNull();
    await picker.locator('.emoji-tab[aria-label="Flags"]').click();
    await expect.poll(() => painted(flag)).toBe(true);
});

test('the edit box has the picker too, and the post\'s length limit holds', async ({ page }) => {
    await openThread(page, { session: SESSION, rows: [post({ id: 'mine', author_id: ME, author_name: 'me', body: 'first' })] });
    await page.locator('#post-mine [data-edit-post]').click();
    const form = page.locator('.discussion-edit-form');
    const area = form.locator('.discussion-edit-text');
    await form.locator('.discussion-emoji-btn').click();
    await area.evaluate(a => a.setSelectionRange(a.value.length, a.value.length));
    await form.locator('[data-emoji-insert=":lightCat:"]').click();
    await expect(area).toHaveValue('first:lightCat:');

    // A script's write skips maxlength, so the picker checks it itself.
    await area.fill('x'.repeat(4000));
    await form.locator('[data-emoji-insert=":lightCat:"]').click();
    expect((await area.inputValue()).length).toBe(4000);
    await expect(form.locator('.emoji-note')).toHaveText('The post is at its length limit.');
});

test('when the emoji list cannot load, the picker says so and the cats still work', async ({ page }) => {
    await page.route('**/data/emoji.json*', r => r.fulfill({ status: 500, body: '' }));
    await openThread(page, { session: SESSION });
    const form = page.locator('#discussion-section .discussion-composer').first();
    await form.locator('.discussion-emoji-btn').click();
    const picker = form.locator('.emoji-picker');
    await expect(picker.locator('.emoji-note')).toHaveText('The standard emojis could not be loaded. The Dogslamloop ones still work.');
    await expect(picker.locator('.emoji-section')).toHaveCount(1);
    await picker.locator('[data-emoji-insert=":darkCat:"]').click();
    await expect(form.locator('.discussion-textarea')).toHaveValue(':darkCat:');
});

test('the art version the posts draw is the one the emoji list was cut to', async ({ page }) => {
    await openThread(page);
    expect(await page.evaluate(() => window.DslEmoji.TWEMOJI_VERSION)).toBe(EMOJI_DATA.twemoji);
    // And the list holds no skin tone variants and no bare parts.
    const all = EMOJI_DATA.groups.flatMap(g => g.emoji.map(e => e[0]));
    expect(all.some(c => /[\u{1F3FB}-\u{1F3FF}]/u.test(c))).toBe(false);
    expect(EMOJI_DATA.groups.map(g => g.name)).not.toContain('Component');
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'build-emoji-data.js'))).toBe(true);
});
