// The media moderation queue (v0.13 item 1, second half).
//
// Two owner decisions drive most of these: media does not load until asked
// for, and usage is a filter rather than a detail. The first is the one worth
// pinning hardest - it is invisible when it regresses, because a queue that
// eagerly loads twenty skill clips looks identical to one that does not,
// right up until someone opens it on a phone.
//
// "Unchecked" is the absence of a moderation row, not a stored status. That
// is the whole shape of the table, so it gets a test of its own.
const { test, expect } = require('@playwright/test');

const FILES = [
    { name: 'NewClip.webm', metadata: { size: 2_400_000 }, created_at: '2026-08-12T01:00:00Z' },
    { name: 'UsedPortrait.webp', metadata: { size: 24_000 }, created_at: '2026-07-01T01:00:00Z' },
    { name: 'OldOrphan.webm', metadata: { size: 5_100_000 }, created_at: '2026-07-02T01:00:00Z' },
    { name: 'Flagged.webp', metadata: { size: 30_000 }, created_at: '2026-07-03T01:00:00Z' },
];

const MODERATION = [
    { path: 'UsedPortrait.webp', status: 'approved', note: null, reviewed_at: '2026-08-11T00:00:00Z' },
    { path: 'Flagged.webp', status: 'flagged', note: 'wrong character', reviewed_at: '2026-08-11T00:00:00Z' },
];

const USAGE = [
    { path: 'UsedPortrait.webp', live_pages: ['vessel', 'boomcat'], other_refs: 3 },
    { path: 'Flagged.webp', live_pages: [], other_refs: 2 },
];

async function openQueue(page, config = {}) {
    await page.addInitScript((cfg) => {
        window.__writes = [];
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
                            data: { session: { user: { id: 'u-rev', email: 'r@b.c' }, access_token: 't' } },
                        });
                        const origFrom = client.from.bind(client);
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'reviewer' }], error: null }) };
                            }
                            if (table === 'media_moderation') {
                                return {
                                    select: async () => ({ data: cfg.moderation, error: null }),
                                    upsert: async (row) => { window.__writes.push({ op: 'upsert', row }); return { error: null }; },
                                    delete() { return { eq: async (col, val) => { window.__writes.push({ op: 'delete', path: val }); return { error: null }; } }; },
                                };
                            }
                            const inert = new Proxy({}, {
                                get(_t, prop) {
                                    if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                                    return () => inert;
                                },
                            });
                            return (table === 'pending_revisions' || table === 'page_data') ? inert : origFrom(table);
                        };
                        client.rpc = async (name) => (name === 'media_usage'
                            ? { data: cfg.usage, error: null }
                            : { data: [], error: null });
                        client.storage = {
                            from: () => ({
                                list: async (_p, opts) => ({
                                    data: opts.offset === 0 ? cfg.files : [],
                                    error: null,
                                }),
                                getPublicUrl: (name) => ({ data: { publicUrl: `https://example.test/${name}` } }),
                            }),
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { files: FILES, moderation: MODERATION, usage: USAGE, ...config });

    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.loadMediaQueue());
    await expect(page.locator('#media-queue-container .media-queue-row').first()).toBeVisible();
}

const rows = (page) => page.locator('#media-queue-container .media-queue-row');
const rowFor = (page, name) => page.locator(`.media-queue-row[data-path="${name}"]`);

// initializeMangaSelects hides the native <select> behind a custom dropdown,
// so selectOption cannot reach it. This drives the same binding the custom
// dropdown drives - it only ever dispatches `change` - rather than clicking
// through a widget that has its own coverage in media-framing.spec.js.
async function setFilter(page, id, value) {
    await page.evaluate(({ id, value }) => {
        const select = document.getElementById(id);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { id, value });
}

test('a file with no moderation row counts as unchecked', async ({ page }) => {
    // Absence is the state. Nothing writes "unchecked" anywhere.
    await openQueue(page);

    await expect(rows(page)).toHaveCount(2);
    await expect(rowFor(page, 'NewClip.webm')).toBeVisible();
    await expect(rowFor(page, 'OldOrphan.webm')).toBeVisible();
    await expect(rowFor(page, 'UsedPortrait.webp')).toHaveCount(0);
});

test('no media is loaded until a reviewer asks for it', async ({ page }) => {
    // The decision this whole screen is shaped around. A regression here is
    // silent: the queue looks the same and just costs megabytes to open.
    await openQueue(page);

    await expect(page.locator('#media-queue-container img, #media-queue-container video')).toHaveCount(0);
    await expect(page.locator('#media-preview-stage video, #media-preview-stage img')).toHaveCount(0);

    await rowFor(page, 'NewClip.webm').locator('[data-action="view"]').click();

    // On a desktop it opens in the main pane, not the row - see the block
    // below. What this test is about is that nothing was fetched until asked.
    const media = page.locator('#media-preview-stage video');
    await expect(media).toHaveCount(1);
    await expect(media).toHaveAttribute('src', 'https://example.test/NewClip.webm');

    // Only the row that was asked for.
    await expect(page.locator('.media-queue-row video, .media-queue-row img')).toHaveCount(0);
});

// --------------------------------------------------------------------------
// WHERE A CLIP OPENS (v0.14 fine-tuning, 2026-08-14)
// --------------------------------------------------------------------------
//
// A reviewer deciding whether a clip belongs on the wiki was judging it inside
// a queue row - the narrowest column on the page. It opens in the main pane
// now, which is the part of the screen with room to look at something.
//
// The phone keeps the inline behaviour: there is no second pane there, and the
// owner's instruction was explicit that mobile already works.

test('on a desktop a clip opens in the main pane, not in the queue row', async ({ page }) => {
    await openQueue(page);

    await rowFor(page, 'NewClip.webm').locator('[data-action="view"]').click();

    const panel = page.locator('#media-preview-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#media-preview-name')).toHaveText('NewClip.webm');
    await expect(panel.locator('video')).toHaveAttribute('src', 'https://example.test/NewClip.webm');

    // Wider than the queue column it used to be crammed into - which is the
    // entire point, and the thing a "the panel exists" assertion would miss.
    const [panelBox, queueBox] = await Promise.all([
        panel.boundingBox(),
        page.locator('#media-queue-container').boundingBox(),
    ]);
    expect(panelBox.width).toBeGreaterThan(queueBox.width);

    // Nothing rendered into the row.
    await expect(rowFor(page, 'NewClip.webm').locator('.media-queue-media')).toHaveCount(0);
});

test('closing empties the panel rather than only hiding it', async ({ page }) => {
    await openQueue(page);
    await rowFor(page, 'NewClip.webm').locator('[data-action="view"]').click();
    await expect(page.locator('#media-preview-panel')).toBeVisible();

    await page.locator('#media-preview-close').click();

    await expect(page.locator('#media-preview-panel')).toBeHidden();
    // A hidden <video> keeps playing. A reviewer hearing audio from a clip
    // they closed has no way to find it again.
    await expect(page.locator('#media-preview-stage video')).toHaveCount(0);
});

test('opening a second clip replaces the first', async ({ page }) => {
    await openQueue(page);

    await rowFor(page, 'NewClip.webm').locator('[data-action="view"]').click();
    await rowFor(page, 'OldOrphan.webm').locator('[data-action="view"]').click();

    await expect(page.locator('#media-preview-stage video')).toHaveCount(1);
    await expect(page.locator('#media-preview-name')).toHaveText('OldOrphan.webm');
});

test('on a phone a clip still opens inside its row, and viewing twice puts it away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQueue(page);

    const view = rowFor(page, 'NewClip.webm').locator('[data-action="view"]');

    await view.click();
    await expect(rowFor(page, 'NewClip.webm').locator('.media-queue-media')).toHaveCount(1);
    // Not moved to the pane, which does not exist as a usable surface here.
    await expect(page.locator('#media-preview-panel')).toBeHidden();

    await view.click();
    await expect(rowFor(page, 'NewClip.webm').locator('.media-queue-media')).toHaveCount(0);
});

test('usage is shown per file, and filters the list', async ({ page }) => {
    await openQueue(page);

    await expect(rowFor(page, 'OldOrphan.webm')).toContainText('Nothing references it');

    await setFilter(page, 'media-queue-status', 'all');
    await expect(rowFor(page, 'UsedPortrait.webp')).toContainText('Used on 2 pages');
    await expect(rowFor(page, 'UsedPortrait.webp')).toContainText('vessel, boomcat');
    await expect(rowFor(page, 'Flagged.webp')).toContainText('Only in history/pending');

    await setFilter(page, 'media-queue-usage', 'unused');
    await expect(rows(page)).toHaveCount(2); // NewClip and OldOrphan
    await expect(rowFor(page, 'UsedPortrait.webp')).toHaveCount(0);
});

test('approving records a decision and takes it out of the queue', async ({ page }) => {
    await openQueue(page);

    await rowFor(page, 'NewClip.webm').locator('[data-action="approve"]').click();

    await expect(rowFor(page, 'NewClip.webm')).toHaveCount(0);
    const writes = await page.evaluate(() => window.__writes);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('upsert');
    expect(writes[0].row).toMatchObject({ path: 'NewClip.webm', status: 'approved' });
    expect(writes[0].row.reviewed_by).toBe('u-rev');
});

test('flagging asks why, and says the file still exists', async ({ page }) => {
    // Two things a reviewer has to know: the note is public, and flagging
    // hides rather than deletes.
    await openQueue(page);

    await rowFor(page, 'NewClip.webm').locator('[data-action="flag"]').click();
    await expect(page.locator('#admin-prompt-msg')).toContainText('visible to anyone');

    await page.fill('#admin-prompt-input', 'duplicate of the other clip');
    await page.locator('#admin-prompt-modal button', { hasText: 'FLAG' }).first().click();

    const writes = await page.evaluate(() => window.__writes);
    expect(writes[0].row).toMatchObject({ path: 'NewClip.webm', status: 'flagged', note: 'duplicate of the other clip' });
    await expect(page.locator('#admin-alert-msg')).toContainText('still exists');
});

test('resetting a decision deletes the row rather than storing a status', async ({ page }) => {
    await openQueue(page);
    await setFilter(page, 'media-queue-status', 'approved');

    await rowFor(page, 'UsedPortrait.webp').locator('[data-action="reset"]').click();

    const writes = await page.evaluate(() => window.__writes);
    expect(writes).toEqual([{ op: 'delete', path: 'UsedPortrait.webp' }]);
});

test('a filename is escaped, not parsed as markup', async ({ page }) => {
    await openQueue(page, {
        files: [{ name: '<img src=x onerror="window.__xss=1">.webp', metadata: { size: 10 }, created_at: '2026-08-12T00:00:00Z' }],
        moderation: [], usage: [],
    });

    await expect(rows(page).first()).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('usage that cannot be read degrades to unknown rather than failing the queue', async ({ page }) => {
    // Advisory data. A reviewer can still moderate without it.
    await openQueue(page, { usage: null });

    await expect(rows(page)).toHaveCount(2);
    await expect(rowFor(page, 'NewClip.webm')).toContainText('Nothing references it');
});
