// The GIF picker in the post box (v1.1, batch 8.5).
//
// The owner is applying for a KLIPY production key (2026-10-21): "I am going
// to need to built a GIF selector/searcher with all their requirements". The
// requirements, read off docs.klipy.com the same day: "Search KLIPY" in the
// search box; requests straight from the browser; results in KLIPY's order,
// nothing removed. My calls, written back and kept: Trending first, more on
// scroll, "Powered by KLIPY", the strictest content filter, no user id, the
// share counted when the post goes, a picked GIF in the attachment strip and
// posted as its own address, up to the 4 a post already allows.
//
// CAN: what is asked of KLIPY and when, what the picker shows, what is posted.
// CANNOT: KLIPY itself. Its API and media hosts are routed here; the shape of
// the answers is the one KLIPY's documentation and one live answer gave.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const LOCAL_IMAGE = fs.readFileSync(path.join(__dirname, '..', 'medias', 'images', 'DogslamloopIcon.webp'));
const KLIPY_API = /^https:\/\/api\.klipy\.com\/api\/v1\/[A-Za-z0-9]+\/gifs\//;

const item = (slug, title = slug) => ({
    id: 1, slug, title, type: 'gif', tags: [], blur_preview: '',
    file: {
        md: { mp4: { url: `https://static.klipy.com/ii/0a1b2c/${slug}/md.mp4` }, gif: { url: `https://static.klipy.com/ii/0a1b2c/${slug}/md.gif` } },
        xs: { webp: { url: `https://static.klipy.com/ii/0a1b2c/${slug}/xs.webp` } },
    },
});
const many = (prefix, n) => Array.from({ length: n }, (_, i) => item(`${prefix}-${i + 1}`, `${prefix} ${i + 1}`));
// Trending's first page carries one item with an address off KLIPY's media
// hosts: there is nothing that could be drawn for it.
const HOSTILE = { ...item('hostile'), file: { md: { mp4: { url: 'https://evil.example/ii/x.mp4' } }, xs: { webp: { url: 'https://evil.example/x.webp' } } } };
const ANSWERS = {
    'trending:1': { items: [...many('trend', 12), HOSTILE, ...many('trend-b', 11)], more: true },
    'trending:2': { items: many('trend-c', 24), more: false },
    'search:boom:1': { items: many('boom', 3), more: false },
    'search:slow:1': { items: many('slow', 3), more: false, delay: 900 },
    'search:zzz:1': { items: [], more: false },
};

async function openThread(page, { session = SESSION, failKlipy = false } = {}) {
    const klipy = [];
    await page.route(KLIPY_API, async r => {
        const req = r.request();
        const url = new URL(req.url());
        klipy.push({ method: req.method(), url, body: req.postData(), headers: req.headers() });
        if (failKlipy) return r.fulfill({ status: 500, body: '' });
        const kind = url.pathname.split('/gifs/')[1];
        if (kind.startsWith('share/')) return r.fulfill({ status: 200, json: { result: true } });
        const key = kind === 'search' ? `search:${url.searchParams.get('q')}:${url.searchParams.get('page')}` : `trending:${url.searchParams.get('page')}`;
        const answer = ANSWERS[key] || { items: [], more: false };
        if (answer.delay) await new Promise(res => setTimeout(res, answer.delay));
        return r.fulfill({ status: 200, json: { result: true, data: { data: answer.items, current_page: 1, per_page: 24, has_next: answer.more } } });
    });
    await page.route(/^https:\/\/static2?\.klipy\.com\//, r => r.fulfill({ status: 200, contentType: 'image/webp', body: LOCAL_IMAGE }));

    await page.addInitScript(({ session }) => {
        window.__inserts = [];
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
                    client.rpc = async (name) => ({ data: name === 'get_public_profiles' || name === 'get_page_experts' ? [] : 'ok', error: null });
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq() { return this; },
                                maybeSingle: async () => ({ data: null, error: null }) };
                        }
                        if (table === 'page_discussions') {
                            const q = { head: false };
                            return {
                                select(_c, o) { if (o && o.head) q.head = true; return this; },
                                eq() { return this; }, is() { return this; }, in() { return this; },
                                order() { return this; }, range() { return this; },
                                insert(payload) {
                                    window.__inserts.push(payload);
                                    return Promise.resolve({ data: payload, error: null });
                                },
                                then(resolve) { return resolve(q.head ? { data: null, count: 0, error: null } : { data: [], error: null }); },
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
    }, { session });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title', { timeout: 30000 });
    const form = page.locator('#discussion-section .discussion-composer').first();
    return { klipy, form, picker: form.locator('.gif-picker') };
}

const lists = (klipy) => klipy.filter(k => k.method === 'GET');
const shares = (klipy) => klipy.filter(k => k.url.pathname.includes('/gifs/share/'));
const labels = (picker) => picker.locator('.gif-cell').evaluateAll(cells => cells.map(c => c.getAttribute('aria-label')));
const mp4 = (slug) => `https://static.klipy.com/ii/0a1b2c/${slug}/md.mp4`;

test('GIF opens KLIPY\'s Trending under "Search KLIPY", in KLIPY\'s order, and the next page comes on scroll', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const { klipy, form, picker } = await openThread(page);
    const toggle = form.locator('.discussion-gif-btn');

    await expect(toggle).toHaveText('GIF');
    await toggle.click();
    await expect(picker).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(picker.locator('.gif-search')).toHaveAttribute('placeholder', 'Search KLIPY');
    await expect(picker.locator('.gif-credit')).toHaveText('Powered by KLIPY');

    // KLIPY's order, the one item with nothing drawable left out.
    await expect(picker.locator('.gif-cell')).toHaveCount(23);
    expect(await labels(picker)).toEqual([...many('trend', 12), ...many('trend-b', 11)].map(i => i.title));

    // Straight to KLIPY, strictest filter, nothing that says who or where.
    const first = lists(klipy)[0];
    expect(first.url.pathname).toMatch(/\/gifs\/trending$/);
    expect(Object.fromEntries(first.url.searchParams)).toEqual({ page: '1', per_page: '24', content_filter: 'high' });
    expect(first.headers.referer).toBeUndefined();

    // Pictures load as they come into the picker's view, not all at once.
    const firstImg = picker.locator('.gif-cell img').first();
    await expect.poll(() => firstImg.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(await picker.locator('.gif-cell img').last().getAttribute('src')).toBeNull();

    await picker.locator('.gif-scroll').evaluate(s => { s.scrollTop = s.scrollHeight; });
    await expect(picker.locator('.gif-cell')).toHaveCount(23 + 24);
    expect(lists(klipy).map(k => k.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect((await labels(picker)).slice(23)).toEqual(many('trend-c', 24).map(i => i.title));
    // Its last page said so: scrolling again asks for nothing more.
    await picker.locator('.gif-scroll').evaluate(s => { s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    expect(lists(klipy)).toHaveLength(2);

    await picker.locator('.gif-search').press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(errors).toEqual([]);
});

test('a search asks KLIPY once typing stops, and an answer for an older search never replaces a newer one', async ({ page }) => {
    const { klipy, form, picker } = await openThread(page);
    await form.locator('.discussion-gif-btn').click();
    await expect(picker.locator('.gif-cell')).toHaveCount(23);

    await picker.locator('.gif-search').pressSequentially('boom', { delay: 40 });
    await expect(picker.locator('.gif-cell')).toHaveCount(3);
    expect(await labels(picker)).toEqual(['boom 1', 'boom 2', 'boom 3']);
    const searches = lists(klipy).filter(k => k.url.pathname.endsWith('/search'));
    expect(searches.map(k => k.url.searchParams.get('q'))).toEqual(['boom']);
    expect(searches[0].url.searchParams.get('content_filter')).toBe('high');

    await picker.locator('.gif-search').fill('zzz');
    await expect(picker.locator('.gif-note')).toHaveText('No GIFs for that.');
    await expect(picker.locator('.gif-cell')).toHaveCount(0);

    // "slow" is asked first and answers last.
    await picker.locator('.gif-search').fill('slow');
    await expect.poll(() => lists(klipy).some(k => k.url.searchParams.get('q') === 'slow')).toBe(true);
    await picker.locator('.gif-search').fill('boom');
    await expect(picker.locator('.gif-cell')).toHaveCount(3);
    await page.waitForTimeout(1200);
    expect(await labels(picker)).toEqual(['boom 1', 'boom 2', 'boom 3']);
});

test('a picked GIF waits in the strip, comes out with its ×, and is posted as its own address; KLIPY hears of the share only then', async ({ page }) => {
    const { klipy, form, picker } = await openThread(page);
    const toggle = form.locator('.discussion-gif-btn');
    const strip = form.locator('.discussion-attachments');

    await toggle.click();
    await picker.locator('.gif-cell[aria-label="trend 2"]').click();
    await expect(picker).toHaveCount(0);
    await expect(strip).toBeVisible();
    const chip = strip.locator('.discussion-attachment-gif img');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('src', 'https://static.klipy.com/ii/0a1b2c/trend-2/xs.webp');

    await toggle.click();
    await picker.locator('.gif-search').fill('boom');
    await picker.locator('.gif-cell[aria-label="boom 3"]').click();
    await expect(strip.locator('.discussion-attachment-gif')).toHaveCount(2);
    await strip.locator('[data-remove-gif="0"]').click();
    await expect(strip.locator('.discussion-attachment-gif img')).toHaveAttribute('alt', /boom 3/);
    expect(shares(klipy), 'nothing is shared until it is posted').toEqual([]);

    await form.locator('.discussion-textarea').fill('this one');
    await form.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    expect(await page.evaluate(() => window.__inserts[0][0].body)).toBe(`this one\n${mp4('boom-3')}`);

    await expect.poll(() => shares(klipy).length).toBe(1);
    const share = shares(klipy)[0];
    expect(share.method).toBe('POST');
    expect(share.url.pathname).toMatch(/\/gifs\/share\/boom-3$/);
    // The words that found it, and no user id.
    expect(JSON.parse(share.body)).toEqual({ q: 'boom' });
    await expect(strip).toBeHidden();
});

test('a post of only a GIF goes, and up to 4 GIFs a post, KLIPY links in the words included', async ({ page }) => {
    const { form, picker } = await openThread(page);
    const toggle = form.locator('.discussion-gif-btn');
    for (const n of [1, 2, 3, 4]) {
        await toggle.click();
        await picker.locator(`.gif-cell[aria-label="trend ${n}"]`).click();
    }
    await toggle.click();
    await picker.locator('.gif-cell[aria-label="trend 5"]').click();
    await expect(picker.locator('.gif-note')).toHaveText('Up to 4 GIFs a post.');
    await expect(form.locator('.discussion-attachment-gif')).toHaveCount(4);
    await picker.locator('.gif-search').press('Escape');

    // A KLIPY address typed in counts too.
    await form.locator('.discussion-textarea').fill('https://static.klipy.com/ii/0a1b2c/typed/md.gif');
    await form.locator('.discussion-submit').click();
    await expect(form.locator('.discussion-composer-status')).toHaveText('Up to 4 GIFs a post.');
    expect(await page.evaluate(() => window.__inserts.length)).toBe(0);

    await form.locator('.discussion-textarea').fill('');
    await form.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    expect(await page.evaluate(() => window.__inserts[0][0].body)).toBe([1, 2, 3, 4].map(n => mp4(`trend-${n}`)).join('\n'));
});

test('when KLIPY cannot be reached, the picker says so', async ({ page }) => {
    const { form, picker } = await openThread(page, { failKlipy: true });
    await form.locator('.discussion-gif-btn').click();
    await expect(picker.locator('.gif-note')).toHaveText('KLIPY could not be reached. Try again in a moment.');
    await expect(picker.locator('.gif-cell')).toHaveCount(0);
});
