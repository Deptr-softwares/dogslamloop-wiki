// Images and GIFs in discussion threads (v0.20 batch 3, item 3.2).
//
// CAN: what a post draws (uploaded images, KLIPY GIFs, and nothing else), who
// is offered the IMAGE button, what an attach-and-post sends to Storage and to
// the table, and that a failed post or a deleted one takes its files down.
//
// CANNOT: the bucket's size limit and allowlist, the folder rule, the trigger's
// path rule, can_upload_media() itself. Those were probed against a real
// preview database (V0.20-DEVLOG.md, "Verified on the preview").
//
// Media hosts are routed to a local image, so no test here fetches anything
// from production Storage or from KLIPY.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const LOCAL_IMAGE = fs.readFileSync(path.join(__dirname, '..', 'medias', 'images', 'DogslamloopIcon.webp'));

const post = (over = {}) => ({
    id: over.id || 'p1', page_id: 'honored_one', parent_id: null,
    author_id: OTHER, author_name: 'mango_kun', body: 'look', images: [],
    status: 'visible', created_at: '2026-09-28T10:00:00Z', removed_at: null, removed_by: null,
    ...over,
});

// klipyMedia replaces the KLIPY media route below. Playwright runs the LAST
// registered handler first, so a test's own route registered before this one
// would never be reached.
async function openThread(page, { rows = [], session = null, roleRow = null, insertError = null, safari = false, klipyMedia = null, waitUntil = 'networkidle' } = {}) {
    // Every address either host could produce answers with a real, decodable
    // local file OF THE RIGHT KIND. An .mp4 once got the WebP too: the video
    // could not play it, the missing-media listener (3.5) rightly replaced it,
    // and the MP4 test passed locally only by asserting before the error
    // arrived. It failed all three CI attempts. WebM stands in for the MP4:
    // Playwright's Chromium has no H.264.
    await page.route(/\/storage\/v1\/object\/public\/discussion-media\//, r =>
        r.fulfill({ status: 200, contentType: 'image/webp', body: LOCAL_IMAGE }));
    await page.route(/^https:\/\/static2?\.klipy\.com\//, klipyMedia || (r => r.request().url().endsWith('.mp4')
        ? r.fulfill({ status: 200, contentType: 'video/webm', path: path.join(__dirname, '..', 'medias', 'videos', 'example-video2.webm') })
        : r.fulfill({ status: 200, contentType: 'image/webp', body: LOCAL_IMAGE })));

    await page.addInitScript(({ rows, session, roleRow, insertError, safari }) => {
        window.__inserts = [];
        window.__uploads = [];
        window.__removes = [];
        window.__rpcCalls = [];

        if (safari) {
            // Safari's canvas, asked for WebP, silently hands back a PNG.
            const orig = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
                return orig.call(this, cb, type === 'image/webp' ? 'image/png' : type, q);
            };
        }

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

                    // The real getPublicUrl, so the address shape is Supabase's
                    // own; upload and remove are recorded instead of sent.
                    const realStorage = client.storage;
                    client.storage = {
                        from(bucket) {
                            const real = realStorage.from(bucket);
                            return {
                                getPublicUrl: real.getPublicUrl.bind(real),
                                async upload(p, blob, opts) {
                                    let dims = null;
                                    try { const b = await createImageBitmap(blob); dims = [b.width, b.height]; } catch (e) { dims = null; }
                                    window.__uploads.push({ bucket, path: p, type: blob.type, size: blob.size, dims, opts });
                                    return { data: { path: p }, error: null };
                                },
                                async remove(paths) {
                                    window.__removes.push({ bucket, paths });
                                    return { data: [], error: null };
                                },
                            };
                        },
                    };

                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq() { return this; },
                                maybeSingle: async () => ({ data: roleRow, error: null }) };
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
                                    return Promise.resolve(insertError ? { data: null, error: insertError } : { data: payload, error: null });
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
    }, { rows, session, roleRow, insertError, safari });

    await page.goto(PAGE, { waitUntil });
    await page.waitForSelector('#discussion-section .discussion-title', { timeout: 30000 });
}

// Painted, not merely present: a broken image has naturalWidth 0.
const painted = (loc) => loc.evaluate(el => el.complete && el.naturalWidth > 0);

test('a KLIPY media link shows as the GIF, and its address leaves the text', async ({ page }) => {
    const gif = 'https://static2.klipy.com/ii/7e6c1411ae693211e30afcc600396815/a8/e0/RNsgkdUj.gif';
    await openThread(page, { rows: [post({ body: `this is the whole matchup\n${gif}` })] });

    const node = page.locator('#post-p1 .discussion-media-gif');
    await expect(node).toHaveCount(1);
    await expect(node).toHaveAttribute('src', gif);
    expect(await node.evaluate(el => el.referrerPolicy)).toBe('no-referrer');
    await expect.poll(() => painted(node)).toBe(true);

    await expect(page.locator('#post-p1 .discussion-body')).toHaveText('this is the whole matchup');
    await expect(page.locator('#post-p1 .discussion-media-credit')).toHaveText('GIF via KLIPY');
});

test('a KLIPY MP4 plays as a muted loop, the way a GIF would', async ({ page }) => {
    const mp4 = 'https://static.klipy.com/ii/7e6c1411ae693211e30afcc600396815/a8/e0/Os5wCkO0.mp4';
    await openThread(page, { rows: [post({ body: mp4 })] });

    const video = page.locator('#post-p1 video.discussion-media-gif');
    await expect(video).toHaveCount(1);
    expect(await video.evaluate(v => [v.muted, v.loop])).toEqual([true, true]);
    // Its source comes from the clip queue when its turn comes (2026-10-02),
    // not the moment the thread is drawn.
    await video.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute('src', mp4, { timeout: 15000 });
    // Playing, not merely present: a frame decoded, and it is still the video
    // rather than the missing-media notice a failed one becomes.
    await expect.poll(() => page.locator('#post-p1 video.discussion-media-gif')
        .evaluate(v => v.readyState >= 2 && v.videoWidth > 0).catch(() => false), { timeout: 15000 }).toBe(true);
    await expect(page.locator('#post-p1 .media-missing-notice')).toHaveCount(0);
    await expect(page.locator('#post-p1 .discussion-body')).toBeHidden();
});

// --- KLIPY PAGE LINKS, AND A THREAD FULL OF GIFS (2026-10-02) ---
//
// Discord's GIF picker copies a klipy.com/gifs/<slug> PAGE link, which a
// browser cannot read (the owner's test post, 2026-10-01). Posting one asks
// KLIPY's API for the GIF once and stores the GIF's own address; readers never
// call the API. The API is routed here: no test spends the owner's key.
const KLIPY_PAGE_LINK = 'https://klipy.com/gifs/ronaldo-smile-4';
const KLIPY_HOST = 'https://static.klipy.com/ii/a15b48460c436e1e92c85ffc680932cc/41/4e';
const KLIPY_MD_MP4 = `${KLIPY_HOST}/eH5CypZVAuqHLGZ.mp4`;
// The shape the API answered on 2026-10-02, cut down: four sizes, and the
// heaviest format first in each, so a picker taking the first one it sees
// would choose the 22.6 MB .gif.
const klipyItem = (files) => ({ result: true, data: { slug: 'ronaldo-smile-4', file: files || {
    hd: { gif: { url: `${KLIPY_HOST}/Ez36P8OR.gif` }, mp4: { url: `${KLIPY_HOST}/wht0lcijYnZFyv.mp4` } },
    md: { gif: { url: `${KLIPY_HOST}/hCso4Vnx.gif` }, webp: { url: `${KLIPY_HOST}/mErnTlx4.webp` }, mp4: { url: KLIPY_MD_MP4 } },
    sm: { gif: { url: `${KLIPY_HOST}/cUOA8wd6.gif` }, mp4: { url: `${KLIPY_HOST}/rJMa4ywu75WmYdDZI8.mp4` } },
} } });

async function routeKlipyApi(page, answer) {
    const asked = [];
    await page.route(/^https:\/\/api\.klipy\.com\//, r => {
        asked.push({ url: r.request().url(), referer: r.request().headers()['referer'] });
        const { status = 200, body } = answer(r.request().url());
        return r.fulfill({ status, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    return asked;
}

test('a klipy.com page link, which Discord copies, is posted as its GIF', async ({ page }) => {
    await openThread(page, { session: SESSION });
    const asked = await routeKlipyApi(page, () => ({ body: klipyItem() }));

    await page.fill('#discussion-section .discussion-textarea', `gg\n${KLIPY_PAGE_LINK}`);
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);

    const [[row]] = await page.evaluate(() => window.__inserts);
    // The medium MP4, not the first file in the answer: the lightest that
    // plays everywhere.
    expect(row.body).toBe(`gg\n${KLIPY_MD_MP4}`);
    // One lookup, by the slug, and KLIPY is not told which page this was.
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toMatch(/\/api\/v1\/[^/]+\/gifs\/ronaldo-smile-4$/);
    expect(asked[0].referer).toBeUndefined();
});

test('a lookup that fails leaves the link as it was, and the post still goes up', async ({ page }) => {
    await openThread(page, { session: SESSION });
    await routeKlipyApi(page, () => ({ status: 429, body: { result: false } }));

    await page.fill('#discussion-section .discussion-textarea', `gg ${KLIPY_PAGE_LINK}`);
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);

    const [[row]] = await page.evaluate(() => window.__inserts);
    expect(row.body).toBe(`gg ${KLIPY_PAGE_LINK}`);
    await expect(page.locator('#discussion-section .discussion-composer-status').first())
        .toContainText('could not be turned into its GIF');
});

test('an API answer that is not KLIPY media is never put in a post', async ({ page }) => {
    // KLIPY is a third party: its answer is checked like a pasted link is.
    await openThread(page, { session: SESSION });
    await routeKlipyApi(page, () => ({ body: klipyItem({
        md: { mp4: { url: 'https://evil.test/ii/a/b/c.mp4' }, gif: { url: 'http://static.klipy.com/ii/a/b/c.gif' } },
    }) }));

    await page.fill('#discussion-section .discussion-textarea', KLIPY_PAGE_LINK);
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    const [[row]] = await page.evaluate(() => window.__inserts);
    expect(row.body).toBe(KLIPY_PAGE_LINK);
});

test('a thread full of KLIPY clips loads two at a time, not all at once', async ({ page }) => {
    // The owner, 2026-10-02: "there should be a system in place to avoid
    // loading in all the GIF all at once". Eight clips across two posts; every
    // answer is held, so a clip that has started is still downloading.
    const asked = new Set();
    const clip = (p, i) => `https://static.klipy.com/ii/aa/bb/clip${p}${i}.mp4`;
    const rows = [1, 2].map(p => post({ id: `p${p}`, body: [0, 1, 2, 3].map(i => clip(p, i)).join('\n'),
        created_at: `2026-09-28T10:0${p}:00Z` }));
    // Held answers never let the network go quiet, so wait for the page instead.
    await openThread(page, { rows, waitUntil: 'domcontentloaded', klipyMedia: r => { asked.add(r.request().url()); } });
    await page.locator('#discussion-section .discussion-list').scrollIntoViewIfNeeded();

    await expect.poll(() => asked.size, { timeout: 15000 }).toBe(2);
    // Held, so nothing can free a slot: the other six are still waiting.
    const waiting = await page.locator('#discussion-section video.discussion-media-gif[data-lazy-src]').count();
    expect(waiting).toBe(6);
    expect(asked.size).toBe(2);
});

test('anything that is not KLIPY media stays text, lookalikes included', async ({ page }) => {
    const lookalikes = [
        'https://static.klipy.com.evil.test/ii/a/b/c.gif',
        'https://evil.test/static.klipy.com/ii/a.gif',
        'http://static.klipy.com/ii/a/b/c.gif',
        'https://klipy.com/gifs/shark-shark-puppy-1',
        'https://static3.klipy.com/ii/a/b/c.gif',
        'https://i.imgur.com/abc.gif',
    ];
    await openThread(page, { rows: lookalikes.map((body, i) => post({ id: `p${i}`, body, created_at: `2026-09-28T10:0${i}:00Z` })) });

    await expect(page.locator('#discussion-section .discussion-media')).toHaveCount(0);
    for (let i = 0; i < lookalikes.length; i++) {
        await expect(page.locator(`#post-p${i} .discussion-body`)).toHaveText(lookalikes[i]);
    }
});

test('a hostile link cannot carry an attribute or a handler into the page', async ({ page }) => {
    const clean = 'https://static.klipy.com/ii/aa/bb/cc.gif';
    await openThread(page, { rows: [post({ body: `${clean}" onerror="window.__xss=1` })] });

    const node = page.locator('#post-p1 .discussion-media-gif');
    await expect(node).toHaveAttribute('src', clean);
    expect(await node.evaluate(el => el.getAttributeNames().sort())).toEqual(['alt', 'class', 'decoding', 'loading', 'referrerpolicy', 'src']);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // What was not the link is still there, as text.
    await expect(page.locator('#post-p1 .discussion-body')).toHaveText('" onerror="window.__xss=1');
});

test('uploaded images show as thumbnails that open the full file; a path breaking the rule is not drawn', async ({ page }) => {
    const good = `${OTHER}/c0ffee.webp`;
    await openThread(page, { rows: [post({
        body: '',
        images: [good, '../../etc/passwd.webp', 'https://evil.test/x.webp', `${OTHER}/sub/x.webp`, `${OTHER}/x.png`],
    })] });

    const imgs = page.locator('#post-p1 .discussion-media-img');
    await expect(imgs).toHaveCount(1);
    const src = await imgs.getAttribute('src');
    expect(src).toMatch(new RegExp(`/storage/v1/object/public/discussion-media/${good.replace('/', '\\/')}$`));
    await expect.poll(() => painted(imgs)).toBe(true);

    const link = page.locator('#post-p1 .discussion-media-link');
    await expect(link).toHaveAttribute('href', src);
    await expect(link).toHaveAttribute('target', '_blank');
    // An image-only post shows no empty text box above its image.
    await expect(page.locator('#post-p1 .discussion-body')).toBeHidden();
});

test('a removed post draws no images, even if its row still carries some', async ({ page }) => {
    await openThread(page, { rows: [post({ status: 'removed_by_staff', body: '', images: [`${OTHER}/a.webp`] })] });
    await expect(page.locator('#post-p1 .discussion-body')).toHaveText('[removed by a moderator]');
    await expect(page.locator('#post-p1 .discussion-media')).toHaveCount(0);
});

// One test per case, each on a fresh page: looping openThread on one page
// stacks init scripts, and the cases would then depend on which ran last.
for (const c of [
    { who: 'a Trusted Editor, by role', roleRow: { role: 'trusted_editor' }, offered: true },
    { who: 'a roleless account the owner ticked', roleRow: { role: null, can_upload_media: true }, offered: true },
    { who: 'a roleless account with no row', roleRow: null, offered: false },
    { who: 'a roleless account not ticked', roleRow: { role: null, can_upload_media: false }, offered: false },
]) {
    test(`the IMAGE button is ${c.offered ? 'offered to' : 'not offered to'} ${c.who}`, async ({ page }) => {
        await openThread(page, { session: SESSION, roleRow: c.roleRow });
        await expect(page.locator('#discussion-section .discussion-composer').first()).toBeVisible();
        await expect(page.locator('#discussion-section .discussion-attach')).toHaveCount(c.offered ? 1 : 0);
    });
}

test('a banned viewer with the box ticked still gets no composer and no IMAGE button', async ({ page }) => {
    await openThread(page, { session: SESSION, roleRow: { role: 'viewer', can_upload_media: true } });
    await expect(page.locator('#discussion-section .discussion-composer')).toHaveCount(0);
    await expect(page.locator('#discussion-section .discussion-attach')).toHaveCount(0);
});

async function attachBigImage(page, width, height) {
    // Built in the page, so the image is real and large without a fixture file.
    await page.evaluate(async ([w, h]) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#3a6'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff'; ctx.fillRect(w / 4, h / 4, w / 2, h / 2);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const input = document.querySelector('#discussion-section .discussion-composer .discussion-image-input');
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, [width, height]);
    await expect(page.locator('#discussion-section .discussion-attachment')).toHaveCount(1);
}

test('attaching an image shrinks it, uploads it into your own folder, and names it on the post', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { session: SESSION, roleRow: { role: 'trusted_editor' } });

    await attachBigImage(page, 3200, 800);
    await page.fill('#discussion-section .discussion-textarea', 'my setup');
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);

    const [up] = await page.evaluate(() => window.__uploads);
    expect(up.bucket).toBe('discussion-media');
    expect(up.path).toMatch(new RegExp(`^${ME}/[A-Za-z0-9_-]{1,64}\\.webp$`));
    expect(up.type).toBe('image/webp');
    expect(up.dims).toEqual([1600, 400]);
    expect(up.size).toBeLessThanOrEqual(1024 * 1024);
    expect(up.opts && up.opts.upsert).toBeFalsy();

    const [[row]] = await page.evaluate(() => window.__inserts);
    expect(row).toEqual({ page_id: 'honored_one', parent_id: null, body: 'my setup', images: [up.path] });
    // The composer is empty again, previews included.
    await expect(page.locator('#discussion-section .discussion-attachment')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('on Safari, which cannot encode WebP, the image goes up as JPEG', async ({ page }) => {
    await openThread(page, { session: SESSION, roleRow: { role: 'trusted_editor' }, safari: true });
    await attachBigImage(page, 900, 600);
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);

    const [up] = await page.evaluate(() => window.__uploads);
    expect(up.type).toBe('image/jpeg');
    expect(up.path).toMatch(new RegExp(`^${ME}/[A-Za-z0-9_-]{1,64}\\.jpg$`));
});

test('an image alone is a post; without words or an image there is nothing to send', async ({ page }) => {
    await openThread(page, { session: SESSION, roleRow: { role: 'trusted_editor' } });

    await page.click('#discussion-section .discussion-submit');
    await expect(page.locator('#discussion-section .discussion-composer-status').first()).toHaveText('Write something first.');
    expect(await page.evaluate(() => window.__inserts.length)).toBe(0);

    await attachBigImage(page, 200, 200);
    await page.click('#discussion-section .discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    const [[row]] = await page.evaluate(() => window.__inserts);
    expect(row.body).toBe('');
    expect(row.images).toHaveLength(1);
});

test('a post refused after its images uploaded takes them back down', async ({ page }) => {
    await openThread(page, {
        session: SESSION, roleRow: { role: 'trusted_editor' },
        insertError: { code: '53400', message: 'Slow down - you can post once every 20 seconds.' },
    });
    await attachBigImage(page, 300, 300);
    await page.click('#discussion-section .discussion-submit');

    await expect(page.locator('#discussion-section .discussion-composer-status').first())
        .toHaveText('Slow down - you can post once every 20 seconds.');
    const uploaded = await page.evaluate(() => window.__uploads.map(u => u.path));
    expect(await page.evaluate(() => window.__removes)).toEqual([{ bucket: 'discussion-media', paths: uploaded }]);
    // The attachment is still there to try again with.
    await expect(page.locator('#discussion-section .discussion-attachment')).toHaveCount(1);
});

test('deleting your own post deletes its images too', async ({ page }) => {
    const mine = `${ME}/abc123.webp`;
    await openThread(page, { session: SESSION, roleRow: { role: 'trusted_editor' },
        rows: [post({ author_id: ME, images: [mine] })] });
    await page.evaluate(() => { window.customConfirm = async () => true; });

    await page.click('#post-p1 [data-remove-post]');
    await expect.poll(() => page.evaluate(() => window.__removes)).toEqual([{ bucket: 'discussion-media', paths: [mine] }]);
    expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'remove_my_discussion_post').length)).toBe(1);
});

test('the attach button, the preview and its remove button are all reachable', async ({ page }) => {
    await openThread(page, { session: SESSION, roleRow: { role: 'trusted_editor' } });

    const chooser = page.waitForEvent('filechooser');
    await page.click('#discussion-section .discussion-attach');
    await (await chooser).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(page.locator('#discussion-section .discussion-attachment')).toHaveCount(1);
    await expect.poll(() => painted(page.locator('#discussion-section .discussion-attachment img'))).toBe(true);

    await page.click('#discussion-section .discussion-attachment-remove');
    await expect(page.locator('#discussion-section .discussion-attachment')).toHaveCount(0);
    await expect(page.locator('#discussion-section .discussion-attachments')).toBeHidden();
});
