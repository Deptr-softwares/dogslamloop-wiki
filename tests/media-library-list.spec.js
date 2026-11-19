// v1.2: the Media Library is a list of names (owner, 2026-11-19): "what if
// there is no thumbnail? ... Editors would look up the media name normally
// and with an @ to search for specific uploader's medias. Editor can preview a
// media before copying its link."
//
// Why: measured on the live bucket the same day, one page of the old grid (24
// video cards, each a <video preload="metadata">) downloaded 52.2 MB of those
// clips' 120.7 MB before anyone hovered, and every page and every cold open
// paid it again. Now a file is fetched only when someone picks it to preview.
//
// Mocked like tests/media-uploader-credit.spec.js: the supabase client is
// patched as it is created, Storage answers from `files`, and a file's public
// URL is https://example.test/<name>, so a request for a file shows up as a
// request to example.test.
const { test, expect } = require('@playwright/test');

async function openLibrary(page, config = {}) {
    await page.addInitScript((cfg) => {
        window.__lib2 = { listCalls: [], copied: [] };

        // The clipboard, recorded rather than real: headless Chromium refuses it.
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (text) => { window.__lib2.copied.push(text); } },
        });

        const inertChain = () => new Proxy({}, {
            get(_t, prop) {
                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                if (prop === 'maybeSingle') return async () => ({ data: null, error: null });
                return () => inertChain();
            },
        });

        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        client.auth.getSession = async () => ({
                            data: { session: { user: { id: 'u1', email: 'a@b.c' }, access_token: 't' } },
                        });
                        client.from = (table) => (table === 'media_uploads'
                            ? { select: async () => ({ data: cfg.credits, error: null }), insert: async () => ({ data: [], error: null }) }
                            : inertChain());
                        client.rpc = async (fn) => (fn === 'get_public_profiles'
                            ? { data: cfg.profiles, error: null }
                            : { data: null, error: null });
                        client.storage = {
                            from: () => ({
                                // Like the real API: a page of at most `limit`, from `offset`.
                                list: async (_prefix, opts = {}) => {
                                    window.__lib2.listCalls.push({ limit: opts.limit, offset: opts.offset || 0 });
                                    const start = opts.offset || 0;
                                    const page = cfg.files.slice(start, start + (opts.limit || 100));
                                    return { data: page.map(name => ({ name })), error: null };
                                },
                                upload: async (name) => ({ data: { path: name }, error: null }),
                                getPublicUrl: (name) => ({ data: { publicUrl: `https://example.test/${name}` } }),
                            }),
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { files: ['Clip.webm'], credits: [], profiles: [], ...config });

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
    await page.evaluate(() => { window.measureMediaSource = async () => null; });
    if (config.open === false) return;
    await page.evaluate(() => {
        document.getElementById('media-modal-overlay').classList.remove('hidden');
        window.loadMediaGallery();
    });
    await expect(page.locator('#media-upload-zone')).toBeVisible();
}

const rows = page => page.locator('#media-gallery-grid .media-row');
const row = (page, name) => rows(page).filter({ has: page.locator('.media-row-name', { hasText: name }) });
const names = page => page.locator('#media-gallery-grid .media-row-name').allTextContents();

function fileRequests(page) {
    const seen = [];
    page.on('request', r => { if (r.url().startsWith('https://example.test/')) seen.push(decodeURI(r.url())); });
    return seen;
}

test('the list shows names and fetches no file until one is picked to preview', async ({ page }) => {
    const requested = fileRequests(page);
    await openLibrary(page, { files: ['Anim.gif', 'Clip.webm', 'Pic.webp'] });

    expect(await names(page)).toEqual(['Anim.gif', 'Clip.webm', 'Pic.webp']);
    await expect(page.locator('#media-gallery-grid video, #media-gallery-grid img')).toHaveCount(0);
    await expect(page.locator('#media-lib-preview .media-lib-preview-empty')).toBeVisible();
    await page.waitForTimeout(500);
    expect(requested, 'opening the library fetched files').toEqual([]);

    await row(page, 'Clip.webm').click();
    await expect(row(page, 'Clip.webm')).toHaveAttribute('aria-pressed', 'true');
    const video = page.locator('#media-lib-preview video.media-lib-preview-media');
    await expect(video).toHaveAttribute('src', 'https://example.test/Clip.webm');
    await expect(page.locator('#media-lib-preview .media-lib-preview-name')).toHaveText('Clip.webm');
    await expect.poll(() => [...new Set(requested)]).toEqual(['https://example.test/Clip.webm']);

    // Picking another shows that one instead.
    await row(page, 'Pic.webp').click();
    await expect(page.locator('#media-lib-preview img.media-lib-preview-media')).toHaveAttribute('src', 'https://example.test/Pic.webp');
    await expect(page.locator('#media-lib-preview video')).toHaveCount(0);
    await expect(row(page, 'Clip.webm')).toHaveAttribute('aria-pressed', 'false');
});

test('COPY LINK puts the previewed file\'s link on the clipboard', async ({ page }) => {
    await openLibrary(page, { files: ['Clip.webm', 'Pic.webp'] });

    await row(page, 'Pic.webp').click();
    const copy = page.locator('#media-lib-preview [data-media-copy]');
    await expect(copy).toHaveText('COPY LINK');
    await expect(page.locator('#media-lib-preview [data-media-use]')).toHaveCount(0);
    await copy.click();

    await expect.poll(() => page.evaluate(() => window.__lib2.copied)).toEqual(['https://example.test/Pic.webp']);
    await expect(copy).toHaveText('COPIED!');
});

test('opened as a picker, a click previews and USE THIS hands the file back and closes', async ({ page }) => {
    await openLibrary(page, { files: ['Clip.webm', 'Pic.webp'], open: false });
    await page.evaluate(() => {
        window.openMediaLibraryPicker((url, file) => { window.__picked = { url, name: file.name }; });
    });
    await expect(rows(page)).toHaveCount(2);

    await row(page, 'Clip.webm').click();
    expect(await page.evaluate(() => window.__picked), 'a click alone picks nothing').toBeUndefined();
    await expect(page.locator('#media-lib-preview [data-media-copy]')).toHaveCount(0);

    await page.locator('#media-lib-preview [data-media-use]').click();
    expect(await page.evaluate(() => window.__picked)).toEqual({ url: 'https://example.test/Clip.webm', name: 'Clip.webm' });
    await expect(page.locator('#media-modal-overlay')).toBeHidden();
    expect(await page.evaluate(() => window.mediaPickHandler), 'the picker is disarmed').toBeNull();
    // A hidden overlay would keep a clip in it downloading: closing empties it.
    await expect(page.locator('#media-lib-preview video')).toHaveCount(0);
    await expect(page.locator('#media-lib-preview .media-lib-preview-empty')).toBeAttached();
});

test('@ searches by uploader, and the words after the name search the file name', async ({ page }) => {
    await openLibrary(page, {
        files: ['Kick_1.webm', 'Kick_2.webm', 'Old.webm', 'Rush.webm'],
        credits: [
            { path: 'Kick_1.webm', uploaded_by: 'u7' },
            { path: 'Kick_2.webm', uploaded_by: 'u7' },
            { path: 'Rush.webm', uploaded_by: 'u9' },
        ],
        profiles: [{ user_id: 'u7', display_name: 'Deptr' }, { user_id: 'u9', display_name: 'Hired Killer' }],
    });
    await expect(row(page, 'Kick_1.webm').locator('.media-row-uploader')).toHaveText('by Deptr');

    const search = page.locator('#media-search-input');
    const expectNames = async (query, expected) => {
        await search.fill(query);
        await expect.poll(() => names(page), query).toEqual(expected);
    };

    await expectNames('@deptr', ['Kick_1.webm', 'Kick_2.webm']);
    await expectNames('@Deptr 2', ['Kick_2.webm']);
    await expectNames('@hired killer', ['Rush.webm']);
    await expectNames('@hir', ['Rush.webm']);
    await expectNames('old', ['Old.webm']);
    await expectNames('kick', ['Kick_1.webm', 'Kick_2.webm']);

    // A file with no recorded uploader is never an uploader's (not even as the
    // word "undefined"), and nobody matching shows the empty message, not
    // every file.
    await expectNames('@nobody', []);
    await expect(page.locator('#media-gallery-grid .media-status-msg')).toHaveText('No media matches your search criteria.');
    await expectNames('@und', []);
});

test('@ takes the longest uploader name that fits, when one name starts another', async ({ page }) => {
    await openLibrary(page, {
        files: ['Fan_Clip.webm', 'Kick_1.webm', 'Kick_Fan.webm'],
        credits: [
            { path: 'Kick_1.webm', uploaded_by: 'u7' },
            { path: 'Kick_Fan.webm', uploaded_by: 'u7' },
            { path: 'Fan_Clip.webm', uploaded_by: 'u8' },
        ],
        profiles: [{ user_id: 'u7', display_name: 'Deptr' }, { user_id: 'u8', display_name: 'Deptr Fan' }],
    });
    await expect(row(page, 'Fan_Clip.webm').locator('.media-row-uploader')).toHaveText('by Deptr Fan');

    const search = page.locator('#media-search-input');
    await search.fill('@deptr fan');
    await expect.poll(() => names(page)).toEqual(['Fan_Clip.webm']);
    // And the shorter name still takes words after it.
    await search.fill('@deptr fan clip');
    await expect.poll(() => names(page)).toEqual(['Fan_Clip.webm']);
    await search.fill('@deptr kick');
    await expect.poll(() => names(page)).toEqual(['Kick_1.webm', 'Kick_Fan.webm']);
});

test('the whole bucket is listed, past the first 1000 files, and the upload check knows all of it', async ({ page }) => {
    const files = Array.from({ length: 1205 }, (_v, i) => `F${String(i).padStart(4, '0')}.webp`);

    // The upload's name check first, before the library has listed anything.
    await openLibrary(page, { files, open: false });
    const refused = await page.evaluate(async () =>
        (await window.uploadWikiMedia(new File(['x'], 'F1100.webp', { type: 'image/webp' }))).error || '');
    expect(refused).toContain('F1100.webp');
    expect(refused).toContain('already exists');

    await page.evaluate(() => {
        document.getElementById('media-modal-overlay').classList.remove('hidden');
        window.loadMediaGallery();
    });
    await page.locator('#media-search-input').fill('F1204');
    await expect.poll(() => names(page)).toEqual(['F1204.webp']);

    // In pages, not one request for everything.
    const calls = await page.evaluate(() => window.__lib2.listCalls);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(c => c.limit <= 1000)).toBe(true);
});

test('a hostile file name and uploader name stay text, in the list and in the preview', async ({ page }) => {
    const hostileFile = '<img src=x onerror="window.__xss=1">.webp';
    const hostileName = '<img src=x onerror="window.__xss2=1">';
    await openLibrary(page, {
        files: [hostileFile],
        credits: [{ path: hostileFile, uploaded_by: 'u7' }],
        profiles: [{ user_id: 'u7', display_name: hostileName }],
    });

    const only = rows(page).first();
    await expect(only.locator('.media-row-name')).toHaveText(hostileFile);
    await expect(only.locator('.media-row-uploader')).toHaveText(`by ${hostileName}`);
    await expect(page.locator('#media-gallery-grid img')).toHaveCount(0);

    await only.click();
    await expect(page.locator('#media-lib-preview .media-lib-preview-name')).toHaveText(hostileFile);
    await expect(page.locator('#media-lib-preview .media-lib-preview-uploader')).toHaveText(`by ${hostileName}`);
    // The preview's own picture is the only element the names could have made.
    await expect(page.locator('#media-lib-preview img')).toHaveCount(1);
    expect(await page.evaluate(() => [window.__xss, window.__xss2]), 'no handler ran').toEqual([undefined, undefined]);
});

test('on a phone the list and the preview both fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page, { files: ['A_very_long_clip_name_that_would_push_a_row_wider_than_a_phone.webm', 'Pic.webp'] });

    await row(page, 'Pic.webp').click();
    // The frame, not the picture: a mocked file never loads, and a broken
    // image draws at no size at all.
    const frame = await page.locator('#media-lib-preview .media-lib-preview-frame').boundingBox();
    expect(frame && frame.width).toBeGreaterThan(100);
    // Height too: in a column the frame was once squeezed to nothing, leaving
    // the name and the button with no picture above them.
    expect(frame.height, 'the preview frame has room to show the file').toBeGreaterThan(80);
    // COPY LINK is the point of the preview: it sits inside the preview's
    // visible part, not below a scroll.
    const preview = await page.locator('#media-lib-preview').boundingBox();
    const copy = await page.locator('#media-lib-preview [data-media-copy]').boundingBox();
    expect(copy.y + copy.height, 'COPY LINK shows without scrolling the preview').toBeLessThanOrEqual(preview.y + preview.height + 1);
    // And the list keeps room for more than a couple of rows.
    const list = await page.locator('#media-gallery-grid').boundingBox();
    expect(list.height, 'the list keeps room beside the preview').toBeGreaterThan(150);
    for (const el of ['#media-gallery-grid', '#media-lib-preview']) {
        const b = await page.locator(el).boundingBox();
        expect(b.x, `${el} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${el} ends on screen`).toBeLessThanOrEqual(390);
    }
    const longName = row(page, 'A_very_long').locator('.media-row-name');
    expect(await longName.evaluate(el => el.scrollWidth > el.clientWidth), 'the long name is cut, not widening the row').toBe(true);
});
