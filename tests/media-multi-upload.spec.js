// Batch upload in the Media Library, and the MP4 gate (v0.13 item 11).
//
// The handler used to read files[0] and silently drop the rest. The evidence
// for why that mattered: seven clips uploaded one at a time inside fifty
// minutes on 2026-08-09.
//
// The batch is sequential on purpose, so the tests below assert order as well
// as completeness - the overwrite guard reads a snapshot of the bucket, and
// two uploads in flight together can both pass it for the same name.
//
// MP4 is refused at upload from 2026-08-12 (owner). It is a gate on new
// uploads only: every MP4 already on the wiki still plays, which is why
// nothing here touches a renderer.
const { test, expect } = require('@playwright/test');

const webm = (name) => ({ name, mimeType: 'video/webm', buffer: Buffer.from('fake-webm') });
const mp4 = (name) => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('fake-mp4') });

// One file already in the bucket, so window.currentMediaFiles is populated.
// That is the real-world state and it matters: with a non-empty snapshot the
// overwrite guard never re-lists, which is exactly the case the batch's own
// name history has to cover.
async function openLibrary(page, config = {}) {
    await page.addInitScript((cfg) => {
        window.__media = { uploads: [], lists: 0 };

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
                            data: { session: { user: { id: 'u1', email: 'a@b.c' }, access_token: 't' } },
                        });
                        client.from = () => inertChain();
                        client.rpc = async () => ({ data: null, error: null });
                        client.storage = {
                            from: () => ({
                                // Deliberately does NOT reflect uploads made during a
                                // run: the library holds its listing from before the
                                // batch started, same as the real page does.
                                list: async () => {
                                    window.__media.lists++;
                                    return { data: cfg.existing.map(name => ({ name })), error: null };
                                },
                                upload: async (name) => {
                                    window.__media.uploads.push(name);
                                    return (cfg.failOn || []).includes(name)
                                        ? { data: null, error: { message: 'Storage quota exceeded' } }
                                        : { data: { path: name }, error: null };
                                },
                                getPublicUrl: (name) => ({ data: { publicUrl: `https://example.test/${name}` } }),
                            }),
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { existing: ['Existing.webp'], failOn: [], ...config });

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    await page.evaluate(() => {
        // Measuring dimensions opens the fake buffer in a <video>, which only
        // resolves on its error path after a delay. Not what is under test.
        window.measureMediaSource = async () => null;
        document.getElementById('media-modal-overlay').classList.remove('hidden');
        if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
    });
    await expect(page.locator('#media-upload-zone')).toBeVisible();
}

const uploads = (page) => page.evaluate(() => window.__media.uploads);
const rows = (page) => page.locator('#media-upload-queue .media-upload-row');

async function selectFiles(page, files) {
    await page.setInputFiles('#media-file-input', files);
    // The zone label is restored only once the whole run has finished.
    await expect(page.locator('#media-upload-text')).toContainText('Drop files', { timeout: 15000 });
}

test('every selected file is uploaded, in order', async ({ page }) => {
    await openLibrary(page);
    await selectFiles(page, [webm('One.webm'), webm('Two.webm'), webm('Three.webm')]);

    expect(await uploads(page)).toEqual(['One.webm', 'Two.webm', 'Three.webm']);
});

test('the queue shows a row per file with its outcome', async ({ page }) => {
    await openLibrary(page, { failOn: ['Two.webm'] });
    await selectFiles(page, [webm('One.webm'), webm('Two.webm'), webm('Three.webm')]);

    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0)).toHaveClass(/media-upload-row-done/);
    await expect(rows(page).nth(1)).toHaveClass(/media-upload-row-failed/);
    await expect(rows(page).nth(2)).toHaveClass(/media-upload-row-done/);
});

test('one rejected file does not cancel the rest of the run', async ({ page }) => {
    // The behaviour worth protecting: a bad file halfway through a run of ten
    // used to mean starting the run over.
    await openLibrary(page, { failOn: ['Two.webm'] });
    await selectFiles(page, [webm('One.webm'), webm('Two.webm'), webm('Three.webm')]);

    expect(await uploads(page)).toEqual(['One.webm', 'Two.webm', 'Three.webm']);
    await expect(rows(page).nth(2)).toHaveClass(/media-upload-row-done/);
});

test('a name used earlier in the same run is caught by the guard, not by storage', async ({ page }) => {
    // The library's file list was taken before the batch began, so only the
    // run's own history knows about the first Clip.webm.
    await openLibrary(page);
    await selectFiles(page, [webm('Clip.webm'), webm('Clip.webm')]);

    // The second never reaches storage at all.
    expect(await uploads(page)).toEqual(['Clip.webm']);
    await expect(rows(page).nth(1)).toHaveClass(/media-upload-row-failed/);
    await expect(rows(page).nth(1)).toContainText('already exists');
});

test('the grid is refreshed once after the run, not once per file', async ({ page }) => {
    await openLibrary(page);
    const before = await page.evaluate(() => window.__media.lists);

    await selectFiles(page, [webm('One.webm'), webm('Two.webm'), webm('Three.webm')]);

    expect(await page.evaluate(() => window.__media.lists) - before).toBe(1);
});

test('the file input is cleared so the same file can be picked again', async ({ page }) => {
    // Otherwise a retry after a failure fires no change event and looks dead.
    await openLibrary(page, { failOn: ['One.webm'] });
    await selectFiles(page, [webm('One.webm')]);

    expect(await page.locator('#media-file-input').inputValue()).toBe('');
});

test('the file input accepts more than one file', async ({ page }) => {
    await openLibrary(page);
    expect(await page.locator('#media-file-input').evaluate(el => el.multiple)).toBe(true);
});

test('a file name is escaped in the queue, not parsed as markup', async ({ page }) => {
    await openLibrary(page);
    await selectFiles(page, [webm('<img src=x onerror="window.__xss=1">.webm')]);

    await expect(rows(page).first()).toContainText('<img src=x');
    expect(await page.locator('#media-upload-queue img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

// --- MP4 GATE ---

test('an MP4 is refused, and the message names WebM', async ({ page }) => {
    await openLibrary(page);
    await selectFiles(page, [mp4('Combo.mp4')]);

    expect(await uploads(page)).toEqual([]);
    await expect(rows(page).first()).toHaveClass(/media-upload-row-failed/);
    await expect(rows(page).first()).toContainText('WebM');
});

test('an MP4 renamed to .webm is still refused', async ({ page }) => {
    // Checked on the type as well as the extension.
    await openLibrary(page);
    await selectFiles(page, [{ name: 'Sneaky.webm', mimeType: 'video/mp4', buffer: Buffer.from('x') }]);

    expect(await uploads(page)).toEqual([]);
    await expect(rows(page).first()).toHaveClass(/media-upload-row-failed/);
});

test('a .mp4 arriving with no type at all is still refused', async ({ page }) => {
    // A hand-renamed file reaches the browser with an empty type, which a
    // MIME-only check waves straight through.
    await openLibrary(page);
    await selectFiles(page, [{ name: 'Untyped.mp4', mimeType: '', buffer: Buffer.from('x') }]);

    expect(await uploads(page)).toEqual([]);
    await expect(rows(page).first()).toHaveClass(/media-upload-row-failed/);
});

test('an MP4 in a batch stops only itself', async ({ page }) => {
    await openLibrary(page);
    await selectFiles(page, [webm('Good.webm'), mp4('Bad.mp4'), webm('AlsoGood.webm')]);

    expect(await uploads(page)).toEqual(['Good.webm', 'AlsoGood.webm']);
    await expect(rows(page).nth(1)).toHaveClass(/media-upload-row-failed/);
    await expect(rows(page).nth(2)).toHaveClass(/media-upload-row-done/);
});

test('existing MP4s are still listed by the library', async ({ page }) => {
    // The gate is on uploading. Nothing already on the wiki changed, and the
    // library has to keep offering those files for use on pages.
    await openLibrary(page, { existing: ['Existing.webp', 'OldClip.mp4'] });

    await expect(page.locator('#media-gallery-grid')).toContainText('OldClip.mp4');
});
