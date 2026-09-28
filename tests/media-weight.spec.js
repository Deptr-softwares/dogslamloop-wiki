// The Media Library asks before uploading a clip heavier than the wiki needs
// (v0.20 V2 fix 4).
//
// Measured on 2026-09-28: every working clip on Puppet Master's Overview was
// 1920x1080 and up to 4.9 MB, shown in a column about 800px wide. The rule is
// 1080p or larger (on the short side), or over 2 MB, and the library ASKS: it
// never refuses, because a long clip can be over 2 MB and still be right.
//
// The clips here are real committed files, 1920x1080, so the resolution is
// measured by the browser rather than stubbed. The light files are small fakes
// of a type that is never measured (GIF), so nothing waits on a decode.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const VIDEOS = path.join(__dirname, '..', 'medias', 'videos');
// example-video5.webm: 1920x1080, 0.4 MB. Heavy by resolution alone.
const clip1080 = (name) => ({ name, mimeType: 'video/webm', buffer: fs.readFileSync(path.join(VIDEOS, 'example-video5.webm')) });
// example-video1.webm: 1906x1080, 4.8 MB. Heavy both ways.
const clipBig = (name) => ({ name, mimeType: 'video/webm', buffer: fs.readFileSync(path.join(VIDEOS, 'example-video1.webm')) });
const gif = (name, bytes = 64) => ({ name, mimeType: 'image/gif', buffer: Buffer.alloc(bytes) });

async function openLibrary(page) {
    await page.addInitScript(() => {
        window.__media = { uploads: [] };
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
                                list: async () => ({ data: [{ name: 'Existing.webp' }], error: null }),
                                upload: async (name) => { window.__media.uploads.push(name); return { data: { path: name }, error: null }; },
                                getPublicUrl: (name) => ({ data: { publicUrl: `https://example.test/${name}` } }),
                            }),
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    });

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
        document.getElementById('media-modal-overlay').classList.remove('hidden');
        if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
    });
    await expect(page.locator('#media-upload-zone')).toBeVisible();
}

const uploads = (page) => page.evaluate(() => window.__media.uploads);
const rows = (page) => page.locator('#media-upload-queue .media-upload-row');
const ask = (page) => page.locator('#media-upload-ask');
const runFinished = (page) => expect(page.locator('#media-upload-text')).toContainText('Drop files', { timeout: 15000 });

test('a 1080p clip is asked about before anything uploads, and skipping it uploads the rest', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openLibrary(page);
    await page.setInputFiles('#media-file-input', [clip1080('Combo.webm'), gif('Light.gif')]);

    await expect(ask(page)).toBeVisible({ timeout: 15000 });
    await expect(ask(page)).toContainText('"Combo.webm" is heavier than the wiki needs.');
    await expect(ask(page)).toContainText('720p');
    await expect(rows(page).nth(0)).toHaveClass(/media-upload-row-heavy/);
    await expect(rows(page).nth(0)).toContainText('1920x1080');
    // Asked BEFORE: a contributor cannot delete media, so a warning after the
    // upload would come too late to act on.
    expect(await uploads(page), 'nothing goes up while the question is open').toEqual([]);

    // Visible is not reachable: the buttons have to be on top of the library.
    await page.locator('#media-upload-ask [data-heavy-choice="skip"]').click();
    await runFinished(page);

    expect(await uploads(page)).toEqual(['Light.gif']);
    await expect(rows(page).nth(0)).toHaveClass(/media-upload-row-skipped/);
    await expect(rows(page).nth(1)).toHaveClass(/media-upload-row-done/);
    await expect(ask(page)).toBeHidden();
    expect(errors).toEqual([]);
});

test('upload anyway uploads them, and over 2 MB counts without 1080p', async ({ page }) => {
    await openLibrary(page);
    // The 3 MB GIF is never measured, so only its size can make it heavy.
    await page.setInputFiles('#media-file-input', [clipBig('Long.webm'), gif('Heavy.gif', 3 * 1024 * 1024), gif('Light.gif')]);

    await expect(ask(page)).toContainText('2 of these are heavier than the wiki needs.', { timeout: 15000 });
    await expect(rows(page).nth(0)).toContainText('1906x1080, 4.8 MB');
    await expect(rows(page).nth(1)).toContainText('3.0 MB');
    await expect(rows(page).nth(2)).not.toHaveClass(/media-upload-row-heavy/);

    await page.locator('#media-upload-ask [data-heavy-choice="upload"]').click();
    await runFinished(page);
    expect(await uploads(page)).toEqual(['Long.webm', 'Heavy.gif', 'Light.gif']);
});

test('a still image is never asked about, whatever its size', async ({ page }) => {
    // It becomes WebP on the way up, so its size here says nothing about what
    // reaches the bucket.
    await openLibrary(page);
    await page.setInputFiles('#media-file-input', [{ name: 'Huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024) }]);
    await runFinished(page);

    expect(await uploads(page)).toHaveLength(1);
    await expect(ask(page)).toHaveCount(0);
});

test('the Gallery bin says the same thing when a heavy clip is picked', async ({ page }) => {
    // That modal uploads on its own, and a clip is what a gallery holds.
    await page.goto('/edit.html?page=emotes&type=gallery', { waitUntil: 'networkidle' });
    // networkidle is not "every script ran": under load the shared dev server
    // has been seen to cut a response short, so wait for the function itself.
    await page.waitForFunction(() => typeof window.initFullTabEditor === 'function', { timeout: 30000 });
    await page.evaluate(() => {
        window.currentEditorPageType = 'gallery';
        window.currentEditorCharId = 'emotes';
        window.currentEditorDescData = { items: [] };
        window.originalCloudDescData = { items: [] };
        window.currentEditorFrameData = {};
        window.saveLocalDraft = () => {};
        initFullTabEditor('emotes', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    });
    await page.click('button:has-text("+ ADD ITEM")');

    await page.setInputFiles('#gallery-item-file', clip1080('wave.webm'));
    const status = page.locator('#gallery-item-status');
    await expect(status).toContainText('Heavier than the wiki needs (1920x1080).', { timeout: 15000 });
    await expect(status).toContainText('720p');

    // A light pick clears it.
    await page.setInputFiles('#gallery-item-file', gif('sit.gif'));
    await expect(status).toHaveText('');
});
