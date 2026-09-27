// The broken-media report in owner tools (v0.20 batch 3, item 3.6).
//
// The report reads owner content, so it is a TOOL and never a check: this file
// tests the tool against fixture content with every host routed, and nothing
// here reads the real site's pages or fetches real media.
//
// Both ways a file is checked are driven: a Storage-like host that answers
// HEAD with CORS (the exact path), and a Discord-like host that does not, which
// forces the detached <img>/<video> probe.
const { test, expect } = require('@playwright/test');

const STORE = 'https://store.test/storage/v1/object/public/wiki-media';
const LINKS = {
    discordClip: 'https://cdn.discordapp.test/attachments/1/2/clip.webm',
    icon: '/medias/images/DogslamloopIcon.webp',
    gone: '/medias/images/__gone-from-the-report-test__.png',
    firstM1: `${STORE}/crow_firstm1.png`,
    murmurate: `${STORE}/murmurate.webm`,
    mangled: `https://store.test/storage/v1/object/${STORE}/airdash.webm/wiki-media/MedalTV.webm`,
};

const PAGE_DATA = [
    {
        page_id: 'crow_charmer',
        desc_data: {
            overview: [
                { type: 'heading', content: '[b]Circling[/b]' },
                { type: 'video', src: LINKS.discordClip },
                { type: 'paragraph', content: 'see https://example.test/guide for more' },
                { type: 'image', src: LINKS.icon },
                { type: 'video', src: LINKS.mangled },
                { type: 'heading', content: '<img src=x onerror="window.__xss=1">Hostile' },
                { type: 'image', src: LINKS.gone },
            ],
            matchups: [{ opponent: 'Vessel', content: [{ type: 'image', src: LINKS.gone }] }],
        },
        frame_data: {
            m1s: [{ name: 'First M1', media: { src: LINKS.firstM1 } }],
            skills: [{ name: 'Murmurate', media: { src: LINKS.murmurate } }],
        },
    },
    { page_id: 'vessel', desc_data: { overview: [{ type: 'image', src: LINKS.icon }] }, frame_data: {} },
];
const SITE_PAGES = [
    { page_id: 'crow_charmer', name: 'Crow Charmer', url: 'characters/Crow_charmer/index.html' },
    { page_id: 'vessel', name: 'Vessel', url: 'characters/Vessel/index.html' },
];

async function openReport(page) {
    const cors = { 'access-control-allow-origin': '*' };
    await page.route(/^https:\/\/store\.test\//, r => {
        const url = r.request().url();
        if (url === LINKS.murmurate) return r.fulfill({ status: 200, headers: cors, contentType: 'video/webm', path: 'medias/videos/example-video2.webm' });
        return r.fulfill({ status: url === LINKS.mangled ? 400 : 404, headers: cors, body: 'not found' });
    });
    // A host fetch cannot read. Playwright's fulfilled responses are readable
    // cross-origin even without a CORS header, so leaving the header off was not
    // enough: the first version of this test never reached the element probe,
    // and passed with it deleted. The HEAD is failed outright, which is what an
    // unreadable host looks like to fetch; the probe's own GET gets the 404.
    await page.route(/^https:\/\/cdn\.discordapp\.test\//, r =>
        r.request().method() === 'HEAD' ? r.abort('failed') : r.fulfill({ status: 404, body: 'expired' }));
    await page.route(/^https:\/\/example\.test\//, r => { throw new Error('a non-media link was checked'); });

    await page.addInitScript(({ pageData, sitePages }) => {
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
                        data: { session: { user: { id: 'u-owner', email: 'owner@site.test' }, access_token: 't' } },
                    });
                    client.rpc = async () => ({ data: [], error: null });
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                        }
                        const rows = table === 'page_data' ? pageData : table === 'site_pages' ? sitePages : [];
                        const chain = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (resolve) => resolve({ data: rows, error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => chain;
                            },
                        });
                        return chain;
                    };
                    return client;
                };
            },
        });
    }, { pageData: PAGE_DATA, sitePages: SITE_PAGES });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));
    await expect(page.locator('#btn-media-report')).toBeVisible();
}

test('the report lists every file that loads nothing, by page and by where on it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openReport(page);

    await page.click('#btn-media-report');
    const out = page.locator('#media-report-results');
    // 8 links (the icon twice across two pages, the missing PNG twice on one),
    // 6 distinct files, 4 of them missing, all on Crow Charmer.
    await expect(out.locator('.media-report-summary')).toHaveText(
        '8 media links to 6 files checked. 4 files load nothing, on 1 page.', { timeout: 60000 });

    const pages = out.locator('.media-report-page');
    await expect(pages).toHaveCount(1);
    const name = pages.locator('.media-report-page-name');
    await expect(name).toHaveText('Crow Charmer');
    await expect(name).toHaveAttribute('href', 'characters/Crow_charmer/index.html');

    const rows = await pages.locator('.media-report-item').evaluateAll(items => items.map(li => [
        li.querySelector('.media-report-where').textContent,
        li.querySelector('.media-report-file').textContent,
        li.querySelector('.media-report-state').textContent,
    ]));
    expect(rows).toEqual([
        ['Overview & Strategy > Circling', 'clip.webm', 'missing'],
        ['Overview & Strategy > Circling', 'MedalTV.webm', 'missing'],
        ['Overview & Strategy > <img src=x onerror="window.__xss=1">Hostile', '__gone-from-the-report-test__.png', 'missing'],
        ['Matchups > Vessel', '__gone-from-the-report-test__.png', 'missing'],
        ['M1s > First M1', 'crow_firstm1.png', 'missing'],
    ]);

    // A hostile heading is text in the report, never markup.
    expect(await out.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // The working files, the video included, are not listed.
    await expect(out).not.toContainText('murmurate.webm');
    await expect(out).not.toContainText('DogslamloopIcon.webp');
    expect(errors).toEqual([]);
});

test('a link is a media link only when it is an address to a media file or into Storage', async ({ page }) => {
    await openReport(page);
    const verdicts = await page.evaluate(() => {
        const is = window.mediaReportInternals.isMediaLink;
        return {
            storageFile: is('https://x.supabase.co/storage/v1/object/public/wiki-media/a.webm'),
            storageMangled: is('https://x.supabase.co/storage/v1/object/https://x/y.webm/z'),
            siteFile: is('/medias/images/a.webp'),
            withQuery: is('https://cdn.test/a.png?ex=123'),
            pageLink: is('https://example.test/guide'),
            text: is('a.webm'),
            jsScheme: is('javascript:alert(1)//.png'),
        };
    });
    expect(verdicts).toEqual({
        storageFile: true, storageMangled: true, siteFile: true, withQuery: true,
        pageLink: false, text: false, jsScheme: false,
    });
});
