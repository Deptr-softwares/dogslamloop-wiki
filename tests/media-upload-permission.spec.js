// The Media Library and the upload media permission (v0.20 batch 3, item 3.2).
//
// Uploading needs can_upload_media(): Trusted Editor and up, or the owner's
// tick. Storage's "Auth Upload" policy is what refuses; it was probed on the
// preview. This file covers what the editor SAYS: a locked drop zone that
// explains itself, an open one when the answer is yes or the function does not
// exist yet, and a readable sentence when Storage refuses anyway.
const { test, expect } = require('@playwright/test');

const OPEN_TEXT = '+ Drop files or click to upload to Cloud';

async function openLibrary(page, answers) {
    await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.supabaseClient && typeof window.loadMediaGallery === 'function');
    await page.evaluate((answers) => {
        const c = window.supabaseClient;
        const origRpc = c.rpc.bind(c);
        window.__permissionAsks = 0;
        c.rpc = async (name, params) => {
            if (name !== 'can_upload_media') return origRpc(name, params);
            const a = answers[Math.min(window.__permissionAsks, answers.length - 1)];
            window.__permissionAsks++;
            return a;
        };
        // The listing and the upload are stubbed so nothing touches the real
        // bucket; the upload answers the way Storage does when the policy says no.
        c.storage = { from: () => ({
            list: async () => ({ data: [], error: null }),
            upload: async () => ({ data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }),
            getPublicUrl: (p) => ({ data: { publicUrl: p } }),
        }) };
        document.getElementById('media-modal-overlay').classList.remove('hidden');
    }, answers);
    await page.evaluate(() => window.loadMediaGallery());
    await expect.poll(() => page.evaluate(() => window.__permissionAsks)).toBeGreaterThan(0);
}

const zone = (page) => page.locator('#media-upload-zone');

async function opensChooser(page) {
    const chooser = page.waitForEvent('filechooser', { timeout: 1500 }).then(() => true, () => false);
    await zone(page).click();
    return chooser;
}

test('without the permission, the drop zone says why and opens nothing', async ({ page }) => {
    await openLibrary(page, [{ data: false, error: null }]);

    await expect(zone(page)).toHaveClass(/media-upload-zone-locked/);
    await expect(page.locator('#media-upload-text')).toContainText('Uploading needs the upload media permission');
    expect(await zone(page).evaluate(el => getComputedStyle(el).cursor)).toBe('not-allowed');
    expect(await opensChooser(page), 'a click on a locked zone opens no file picker').toBe(false);
});

test('with the permission, or before the function exists, the zone is open', async ({ page }) => {
    for (const answer of [{ data: true, error: null }, { data: null, error: { code: 'PGRST202', message: 'schema cache' } }]) {
        await openLibrary(page, [answer]);
        await expect(zone(page)).not.toHaveClass(/media-upload-zone-locked/);
        await expect(page.locator('#media-upload-text')).toHaveText(OPEN_TEXT);
        expect(await opensChooser(page), JSON.stringify(answer)).toBe(true);
    }
});

test('a permission granted mid-session unlocks the zone on the next open', async ({ page }) => {
    await openLibrary(page, [{ data: false, error: null }, { data: true, error: null }]);
    await expect(zone(page)).toHaveClass(/media-upload-zone-locked/);

    await page.evaluate(() => window.loadMediaGallery());
    await expect(zone(page)).not.toHaveClass(/media-upload-zone-locked/);
    await expect(page.locator('#media-upload-text')).toHaveText(OPEN_TEXT);
});

test('an upload Storage refuses on the permission reads as a sentence, not a policy name', async ({ page }) => {
    // The Gallery bin calls uploadWikiMedia without going through the drop
    // zone, so this is the message that reaches that path.
    await openLibrary(page, [{ data: true, error: null }]);
    const result = await page.evaluate(async () => {
        const file = new File([new Uint8Array([82, 73, 70, 70])], 'clip_v2.webp', { type: 'image/webp' });
        return window.uploadWikiMedia(file);
    });
    expect(result.error).toContain('Uploading needs the upload media permission');
    expect(result.error).not.toMatch(/row-level security/i);
});
