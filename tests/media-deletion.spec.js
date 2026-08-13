// Deleting media from the queue (v0.14 item 5).
//
// The owner's design: deletion is a deliberate per-item action, not an
// automatic consequence of flagging. Flagging hides; deleting makes a file
// unreachable, and a person decides.
//
// This is the only irreversible action on the site, so most of what follows is
// about the confirmation being honest rather than about the delete working.
//
// What a browser cannot prove, and what the storage policy in
// 20260813000003_media_deletion.sql is actually for: that somebody WITHOUT the
// capability is refused. The button being absent is courtesy; the policy is
// the rule. Probed live.
const { test, expect } = require('@playwright/test');

const file = (over = {}) => ({
    name: over.name || 'sukuna-dp.webm',
    id: over.name || 'sukuna-dp.webm',
    created_at: '2026-08-10T00:00:00Z',
    metadata: { size: 240000 },
    ...over,
});

async function openQueue(page, {
    files = [],
    moderation = [],
    usage = [],
    role = 'admin',
    canDeleteMedia = false,
    removeError = null,
    recordError = null,
} = {}) {
    await page.addInitScript((cfg) => {
        window.__removed = [];
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

                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u1', email: 'staff@site.test' }, access_token: 't' } },
                    });

                    client.from = (table) => {
                        if (table === 'user_roles') {
                            const row = { role: cfg.role, can_moderate: false, can_delete_media: cfg.canDeleteMedia };
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                single: () => Promise.resolve({ data: row, error: null }),
                                maybeSingle: () => Promise.resolve({ data: row, error: null }),
                                then(resolve) { return Promise.resolve({ data: [row], error: null }).then(resolve); },
                            };
                            return chain;
                        }
                        if (table === 'media_moderation') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                upsert: () => Promise.resolve({ data: null, error: null }),
                                delete() { return chain; },
                                then(resolve) { return Promise.resolve({ data: cfg.moderation, error: null }).then(resolve); },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };

                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        if (name === 'media_usage') return { data: cfg.usage, error: null };
                        if (name === 'record_media_deletion') {
                            return cfg.recordError ? { data: null, error: cfg.recordError } : { data: 'ok', error: null };
                        }
                        return { data: null, error: null };
                    };

                    client.storage = {
                        from: () => ({
                            list: async () => ({ data: cfg.files, error: null }),
                            getPublicUrl: (p) => ({ data: { publicUrl: `https://example.test/${p}` } }),
                            remove: async (paths) => {
                                window.__removed.push(...paths);
                                return cfg.removeError ? { data: null, error: cfg.removeError } : { data: paths, error: null };
                            },
                        }),
                    };

                    return client;
                };
            },
        });
    }, { files, moderation, usage, role, canDeleteMedia, removeError, recordError });

    await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.loadMediaQueue === 'function');
    await page.evaluate(() => window.loadMediaQueue());
    await page.waitForSelector('.media-queue-row');
}

const deleteBtn = (page) => page.locator('.media-queue-row [data-action="delete"]');

test('the delete button is offered to an admin', async ({ page }) => {
    await openQueue(page, { files: [file()] });
    await expect(deleteBtn(page)).toHaveCount(1);
});

test('the capability grants deletion without granting admin', async ({ page }) => {
    await openQueue(page, { files: [file()], role: 'reviewer', canDeleteMedia: true });
    await expect(deleteBtn(page)).toHaveCount(1);
});

test('a reviewer without the capability is not offered it', async ({ page }) => {
    // Deliberately not implied by the role, unlike moderation. Reviewing a
    // revision and destroying a file are different amounts of trust.
    await openQueue(page, { files: [file()], role: 'reviewer', canDeleteMedia: false });
    await expect(deleteBtn(page)).toHaveCount(0);
    // ...and the rest of the queue still works for them.
    await expect(page.locator('[data-action="flag"]')).toHaveCount(1);
});

test('the confirmation names the file and says it cannot be undone', async ({ page }) => {
    await openQueue(page, { files: [file({ name: 'honored-one-teleport.webm' })] });

    await deleteBtn(page).click();

    const box = page.locator('.media-queue-confirm');
    await expect(box).toBeVisible();
    await expect(box.locator('.media-queue-confirm-title')).toHaveText('Delete honored-one-teleport.webm?');
    await expect(box.locator('.media-queue-confirm-final')).toContainText('cannot be undone');
    // Nothing has happened yet.
    expect(await page.evaluate(() => window.__removed)).toEqual([]);
});

test('deleting something a live page uses says which pages it breaks', async ({ page }) => {
    // The usage data already existed and was advisory everywhere else. This is
    // the one place it stops being advisory.
    await openQueue(page, {
        files: [file({ name: 'used.webm' })],
        usage: [{ path: 'used.webm', live_pages: ['honored_one', 'sukuna'], other_refs: 0 }],
    });

    await deleteBtn(page).click();

    const warn = page.locator('.media-queue-confirm-body');
    await expect(warn).toHaveClass(/media-queue-confirm-danger/);
    await expect(warn).toContainText('2 live pages');
    await expect(warn).toContainText('honored_one');
    await expect(warn).toContainText('sukuna');
    // The button admits what it is doing rather than reading as routine.
    await expect(page.locator('[data-action="delete-confirm"]')).toHaveText('DELETE ANYWAY');
});

test('"nothing references it" is phrased as what was found, not as a guarantee', async ({ page }) => {
    // media_usage() finds references by extraction, which can miss an unusual
    // form; the garbage collector uses conservative substring matching for the
    // same question precisely so its mistakes fall the other way. The person
    // about to destroy a file is exactly who needs that difference spelled out.
    await openQueue(page, { files: [file({ name: 'orphan.png' })], usage: [] });

    await deleteBtn(page).click();

    const warn = page.locator('.media-queue-confirm-body');
    await expect(warn).toContainText('Nothing was found');
    await expect(warn).toContainText('not the same as nothing using it');
    await expect(warn).not.toHaveClass(/media-queue-confirm-danger/);
    await expect(page.locator('[data-action="delete-confirm"]')).toHaveText('DELETE PERMANENTLY');
});

test('history-only references are called out as their own case', async ({ page }) => {
    await openQueue(page, {
        files: [file({ name: 'old.webm' })],
        usage: [{ path: 'old.webm', live_pages: [], other_refs: 3 }],
    });

    await deleteBtn(page).click();
    await expect(page.locator('.media-queue-confirm-body')).toContainText('page history or a pending revision');
});

test('cancelling deletes nothing', async ({ page }) => {
    await openQueue(page, { files: [file()] });

    await deleteBtn(page).click();
    await page.click('[data-action="delete-cancel"]');

    await expect(page.locator('.media-queue-confirm')).toBeHidden();
    expect(await page.evaluate(() => window.__removed)).toEqual([]);
    expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'record_media_deletion'))).toEqual([]);
});

test('confirming removes the object and then settles the queue record', async ({ page }) => {
    // Storage first, then bookkeeping. If the object delete fails nothing else
    // has happened; if the bookkeeping fails the file is genuinely gone and
    // the UI has to say so rather than imply a retry.
    await openQueue(page, {
        files: [file({ name: 'gone.webm' })],
        usage: [{ path: 'gone.webm', live_pages: ['honored_one'], other_refs: 0 }],
    });

    await deleteBtn(page).click();
    await page.click('[data-action="delete-confirm"]');

    await expect.poll(async () => await page.evaluate(() => window.__removed)).toEqual(['gone.webm']);

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'record_media_deletion'));
    expect(call.params.p_path).toBe('gone.webm');
    // What the deleter was told, recorded with the deletion - the only record
    // of the information the decision was made on.
    expect(call.params.p_note).toContain('honored_one');

    // The queue must not keep listing a file that is gone.
    await expect(page.locator('.media-queue-row')).toHaveCount(0);
});

test('a refused storage delete changes nothing and says why', async ({ page }) => {
    await openQueue(page, {
        files: [file({ name: 'protected.webm' })],
        removeError: { message: 'new row violates row-level security policy' },
    });

    await deleteBtn(page).click();
    await page.click('[data-action="delete-confirm"]');

    await expect(page.locator('.media-queue-confirm-status')).toContainText('row-level security');
    // Still listed, because it still exists.
    await expect(page.locator('.media-queue-row')).toHaveCount(1);
    expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'record_media_deletion'))).toEqual([]);
});

test('a file deleted but not recorded says the file is gone', async ({ page }) => {
    // The one interleaving that can happen. "Failed" would imply the file
    // survived and invite a second attempt at something that no longer exists.
    await openQueue(page, {
        files: [file({ name: 'halfway.webm' })],
        recordError: { message: 'network died' },
    });

    let alerted = '';
    await page.evaluate(() => { window.adminAlert = (m) => { window.__alert = m; }; });

    await deleteBtn(page).click();
    await page.click('[data-action="delete-confirm"]');

    await expect.poll(async () => await page.evaluate(() => window.__alert || '')).toContain('file is gone');
    alerted = await page.evaluate(() => window.__alert);
    expect(alerted).not.toMatch(/failed to delete/i);
    await expect(page.locator('.media-queue-row')).toHaveCount(0);
});

test('only one confirmation is open at a time', async ({ page }) => {
    // A stray click must not land on a different row's CONFIRM than the one
    // just read.
    await openQueue(page, { files: [file({ name: 'a.webm' }), file({ name: 'b.webm' })] });

    await page.locator('.media-queue-row').nth(0).locator('[data-action="delete"]').click();
    await page.locator('.media-queue-row').nth(1).locator('[data-action="delete"]').click();

    await expect(page.locator('.media-queue-confirm:not(.hidden)')).toHaveCount(1);
    await expect(page.locator('.media-queue-confirm:not(.hidden) .media-queue-confirm-title')).toHaveText('Delete b.webm?');
});

test('a hostile file name is never parsed as markup in the confirmation', async ({ page }) => {
    const hostile = '<img src=x onerror="window.__pwned=1">.png';
    await openQueue(page, { files: [file({ name: hostile })] });

    await deleteBtn(page).click();

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        imgs: document.querySelectorAll('.media-queue-confirm img').length,
        title: document.querySelector('.media-queue-confirm-title').textContent,
    }));

    expect(result.pwned).toBe(false);
    expect(result.imgs).toBe(0);
    expect(result.title).toContain('<img');
});
