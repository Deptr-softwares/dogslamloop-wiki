// v0.19 F8: the Media Library credits whoever uploaded each file.
//
// Carried through v0.16, v0.17 and v0.18. The thing it waited for - a person
// record with a display name - shipped in v0.17.
//
// The credit lives in its own table, public.media_uploads, NOT as a column on
// media_moderation. That table is an overlay whose whole design rests on
// "absence of a row means unchecked" (js/admin-media-queue.js reads
// `record ? record.status : 'unchecked'`), and status is NOT NULL with a CHECK
// of approved|flagged - so a row written at upload time would have to claim one
// of those and would silently pre-approve every upload, emptying the moderation
// queue. Registry data and judgement data have different lifetimes.
//
// This file also carries the regression test for an escaping bug found while
// building it: the gallery card interpolated file.name into innerHTML raw,
// while the upload queue in the same file had always escaped it. Filenames come
// from the uploader's disk.
const { test, expect } = require('@playwright/test');

// One place to describe the world, so each test varies one thing.
async function openLibrary(page, config = {}) {
    await page.addInitScript((cfg) => {
        window.__f8 = { inserted: [], profileCalls: [] };

        const inertChain = () => new Proxy({}, {
            get(_t, prop) {
                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
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
                            data: { session: { user: { id: cfg.userId, email: 'a@b.c' }, access_token: 't' } },
                        });

                        client.from = (table) => {
                            if (table !== 'media_uploads') return inertChain();
                            return {
                                select: async () => (cfg.creditsFail
                                    ? { data: null, error: { message: 'boom' } }
                                    : { data: cfg.credits, error: null }),
                                insert: async (row) => {
                                    window.__f8.inserted.push(row);
                                    return cfg.insertFails
                                        ? { data: null, error: { message: 'RLS said no' } }
                                        : { data: [row], error: null };
                                },
                            };
                        };

                        client.rpc = async (fn, args) => {
                            if (fn !== 'get_public_profiles') return { data: null, error: null };
                            window.__f8.profileCalls.push(args.target_user_ids);
                            return { data: cfg.profiles, error: null };
                        };

                        client.storage = {
                            from: () => ({
                                list: async () => ({ data: cfg.files.map(name => ({ name })), error: null }),
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
    }, {
        userId: 'u1',
        files: ['Clip.webp'],
        credits: [],
        profiles: [],
        insertFails: false,
        creditsFail: false,
        ...config,
    });

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
        window.measureMediaSource = async () => null;
        document.getElementById('media-modal-overlay').classList.remove('hidden');
        if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
    });
    await expect(page.locator('#media-upload-zone')).toBeVisible();
}

const card = page => page.locator('.media-thumbnail-card').first();

// --- THE CREDIT ---

test('a file with a recorded uploader is credited by name', async ({ page }) => {
    await openLibrary(page, {
        files: ['Clip.webp'],
        credits: [{ path: 'Clip.webp', uploaded_by: 'u7' }],
        profiles: [{ user_id: 'u7', display_name: 'Deptr' }],
    });

    await expect(card(page).locator('.media-thumbnail-uploader')).toHaveText('by Deptr');
});

test('a file with no record shows no credit line at all', async ({ page }) => {
    // NOT "Unknown". Every file uploaded before this shipped is in this state -
    // ~198 of them - and a caption that says nothing on almost every card is
    // worse than no caption. Asserts the positive first so this cannot pass by
    // the card failing to render.
    await openLibrary(page, { files: ['Old.webp'], credits: [], profiles: [] });

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.media-thumbnail-filename')).toHaveText('Old.webp');
    await expect(card(page).locator('.media-thumbnail-uploader')).toHaveCount(0);
});

test('a deleted uploader leaves the file uncredited rather than blank-credited', async ({ page }) => {
    // uploaded_by is ON DELETE SET NULL, so the row outlives the account. The
    // row exists and names nobody, which must read the same as no row.
    await openLibrary(page, {
        files: ['Orphan.webp'],
        credits: [{ path: 'Orphan.webp', uploaded_by: null }],
        profiles: [],
    });

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.media-thumbnail-uploader')).toHaveCount(0);

    // And no profile request was made for a null id - it would resolve nothing.
    expect(await page.evaluate(() => window.__f8.profileCalls)).toEqual([]);
});

test('uploader ids are de-duplicated before the profile lookup', async ({ page }) => {
    // get_public_profiles is bounded to 200 ids. A bucket of many files
    // uploaded by two people is two ids, not many.
    await openLibrary(page, {
        files: ['A.webp', 'B.webp', 'C.webp'],
        credits: [
            { path: 'A.webp', uploaded_by: 'u7' },
            { path: 'B.webp', uploaded_by: 'u7' },
            { path: 'C.webp', uploaded_by: 'u9' },
        ],
        profiles: [{ user_id: 'u7', display_name: 'Deptr' }, { user_id: 'u9', display_name: 'Someone' }],
    });

    await expect(card(page).locator('.media-thumbnail-uploader')).toHaveText('by Deptr');
    const calls = await page.evaluate(() => window.__f8.profileCalls);
    expect(calls).toHaveLength(1);
    expect([...calls[0]].sort()).toEqual(['u7', 'u9']);
});

test('the grid still renders when the credit lookup fails', async ({ page }) => {
    // A credit is supplementary. An error banner over a working media picker
    // would be the loudest possible way to report the least important thing on
    // screen - the same call buildTerminologyPeek makes on the systems hub.
    await openLibrary(page, { files: ['Clip.webp'], creditsFail: true });

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.media-thumbnail-filename')).toHaveText('Clip.webp');
    await expect(page.locator('.media-error-msg')).toHaveCount(0);
});

// --- RECORDING THE UPLOAD ---

test('a successful upload records the uploader as the signed-in user', async ({ page }) => {
    await openLibrary(page, { userId: 'u42', files: [] });

    await page.evaluate(async () => {
        await window.uploadWikiMedia(new File(['x'], 'New.webm', { type: 'video/webm' }));
    });

    const inserted = await page.evaluate(() => window.__f8.inserted);
    expect(inserted).toEqual([{ path: 'New.webm', uploaded_by: 'u42' }]);
});

test('an upload still succeeds when the credit cannot be written', async ({ page }) => {
    // The file is already in the bucket by the time the credit is attempted.
    // Reporting a successful upload as failed would be the worse error, and it
    // would leave the caller thinking it has to retry - which the overwrite
    // guard would then refuse.
    await openLibrary(page, { userId: 'u42', files: [], insertFails: true });

    const result = await page.evaluate(async () =>
        await window.uploadWikiMedia(new File(['x'], 'New.webm', { type: 'video/webm' })));

    expect(result.error, 'the upload is not reported as failed').toBeUndefined();
    expect(result.name).toBe('New.webm');
    expect(await page.evaluate(() => window.__f8.inserted)).toHaveLength(1);
});

// --- ESCAPING ---

test('a hostile filename is escaped in the gallery card', async ({ page }) => {
    // Found while building F8: the card interpolated file.name into innerHTML
    // raw while the upload queue in the same file escaped it. Filenames come
    // from the uploader's disk.
    //
    // Asserts the tag survived ESCAPED rather than that a substring is missing -
    // an absence assertion here would pass if the name vanished entirely.
    const hostile = '<img src=x onerror="window.__xss=1">.webp';
    await openLibrary(page, { files: [hostile], credits: [] });

    const label = card(page).locator('.media-thumbnail-filename');
    await expect(label).toHaveText(hostile);

    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    expect(await card(page).locator('img.media-thumbnail-media').count(),
        'the only img is the thumbnail itself').toBe(1);
});

test('a hostile display name is escaped in the credit', async ({ page }) => {
    // get_public_profiles reads display_name out of raw_user_meta_data, which
    // is whatever the person typed at sign-up.
    const hostile = '<img src=x onerror="window.__xss2=1">';
    await openLibrary(page, {
        files: ['Clip.webp'],
        credits: [{ path: 'Clip.webp', uploaded_by: 'u7' }],
        profiles: [{ user_id: 'u7', display_name: hostile }],
    });

    await expect(card(page).locator('.media-thumbnail-uploader')).toHaveText(`by ${hostile}`);
    expect(await page.evaluate(() => window.__xss2), 'no handler ran').toBeUndefined();
    expect(await card(page).locator('img.media-thumbnail-media').count()).toBe(1);
});
