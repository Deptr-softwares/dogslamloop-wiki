// The Editor Playground (v1.1): edit.html?playground, the real editor where
// nothing is sent anywhere. Owner, 2026-10-18: "a place where Editor can mess
// around with the Editor as much as they like without any consequences or
// worry". Scoped 2026-10-20: its own Tools page with an OPEN button, starts as
// a blank character page, Submit becomes Pull ("pull page_data from any page"),
// one draft kept on this device with NEW to wipe it, open to anyone, media
// uploads off.
//
// The promise is about what it can NOT do, so most of this file records every
// call the editor makes to the database and storage and asserts the writes are
// never among them.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const NAV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'navigation.json'), 'utf8'));
// A real character and a real system page, read from the roster rather than
// named, so the owner renaming one never breaks this file.
const CHAR = NAV.Characters.find(e => e.cms_config && e.cms_config.pageType === 'character');
const SYSTEM = Object.values(NAV).flat().find(e => e.cms_config && e.cms_config.pageType === 'system');
const LOCKED_ID = SYSTEM.cms_config.pageId;
const OTHER_SYSTEM = Object.values(NAV).flat()
    .find(e => e.cms_config && e.cms_config.pageType === 'system' && e.cms_config.pageId !== LOCKED_ID);

const block = (text) => ({ type: 'paragraph', content: text });
const LIVE = {
    [CHAR.cms_config.pageId]: {
        desc_data: { overview: [block('LIVE OVERVIEW TEXT')], profile: { stats: [], image: '' }, extras: [], matchups: [] },
        frame_data: { m1s: [], specials: [], skills: [] },
    },
    [OTHER_SYSTEM.cms_config.pageId]: {
        desc_data: { tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [block('LIVE SYSTEM TEXT')] }] }] },
        frame_data: null,
    },
};

async function mockEditor(page, { signedIn = true, openSubmission = false } = {}) {
    await page.addInitScript(({ live, signedIn, openSubmission }) => {
        try {
            localStorage.setItem('dsl_editor_tutorial_seen', '1');
            localStorage.setItem('dsl_notice_seen_editor', '1');
        } catch (e) { /* ignore */ }
        window.__calls = { tables: [], writes: [], rpc: [], uploads: [] };

        const builder = (table) => {
            const q = { table, eq: {} };
            const result = () => {
                if (table === 'page_data') {
                    const row = live[q.eq.page_id];
                    return row ? { data: { page_id: q.eq.page_id, ...row }, error: null } : { data: null, error: { code: 'PGRST116' } };
                }
                // An author's open submission, which the real editor offers to
                // continue. The Playground must never ask.
                if (table === 'pending_revisions' && openSubmission) {
                    return { data: [{ id: 't-1', author_id: 'u-1', created_at: new Date().toISOString(), status: 'pending' }], error: null };
                }
                if (['user_roles', 'site_settings', 'page_permissions'].includes(table)) return { data: null, error: null };
                return { data: [], error: null };
            };
            const write = (kind) => (payload) => { window.__calls.writes.push({ table, kind, payload }); return chain; };
            const chain = {
                select() { return chain; },
                eq(col, val) { q.eq[col] = val; return chain; },
                in() { return chain; }, neq() { return chain; }, order() { return chain; }, limit() { return chain; },
                insert: write('insert'), update: write('update'), upsert: write('upsert'), delete: write('delete'),
                single: async () => result(), maybeSingle: async () => result(),
                then: (res, rej) => Promise.resolve(result()).then(res, rej),
            };
            window.__calls.tables.push(table);
            return chain;
        };
        const session = signedIn ? { user: { id: 'u-1', email: 'u@b.c' }, access_token: 't' } : null;
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    lib.createClient = () => ({
                        auth: {
                            getSession: async () => ({ data: { session } }),
                            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                            signOut: async () => ({}),
                        },
                        from: builder,
                        rpc: async (name) => { window.__calls.rpc.push(name); return { data: null, error: null }; },
                        storage: {
                            from: () => ({
                                list: async () => ({ data: [], error: null }),
                                upload: async (name) => { window.__calls.uploads.push(name); return { error: null }; },
                                getPublicUrl: (name) => ({ data: { publicUrl: `https://x/${name}` } }),
                            }),
                        },
                    });
                    lib.__patched = true;
                }
            },
        });
    }, { live: LIVE, signedIn, openSubmission });
}

async function open(page, query = 'playground', opts = {}) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 1400, height: 900 });
    await mockEditor(page, opts);
    // One page locked, so the picker's rule is tested against data that has one.
    await page.route('**/data/navigation.json*', route => {
        const nav = JSON.parse(JSON.stringify(NAV));
        Object.values(nav).flat().forEach(e => {
            if (e.cms_config && e.cms_config.pageId === LOCKED_ID) e.cms_config.editRole = 'locked';
        });
        return route.fulfill({ json: nav });
    });
    await page.goto(`/edit.html?${query}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#editor-title')).toHaveText('Editor Playground', { timeout: 45000 });
    return errors;
}

const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const param = (page, name) => new URL(page.url()).searchParams.get(name);
const confirmModal = (page) => page.locator('#editor-custom-modal');

test('opens as a blank character page for anyone, with the banner, and Pull where Submit was', async ({ page }) => {
    const errors = await open(page, 'playground', { signedIn: false });

    await expect(page.locator('#editor-subtitle')).toHaveText('A blank character page.');
    await expect(page.locator('.playground-banner')).toBeVisible();
    await expect(page.locator('.playground-banner')).toContainText('Nothing you do here is sent anywhere or seen by anyone.');
    await expect(page.locator('#submit-payload-btn')).toHaveText('Pull');
    await expect(page.locator('#btn-playground-new')).toBeVisible();
    await expect(page.locator('#btn-drafts')).toBeHidden();
    await expect(page.locator('#btn-save')).toBeHidden();
    await expect(page.locator('#editor-scope-tip'), 'it is about Submit').toHaveCount(0);
    expect(param(page, 'page')).toBe('playground');

    // Blank, and not fetched: the blank page is not a page.
    expect(await page.evaluate(() => window.__calls.tables.includes('page_data'))).toBe(false);
    await expect(page.locator('#block-list .block-card')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('Pull lists the pages, asks first, then copies the live page in and keeps it', async ({ page }) => {
    const errors = await open(page);

    await page.locator('#submit-payload-btn').click();
    const picker = page.locator('#playground-pull-modal');
    await expect(picker).toBeVisible();
    await expect(picker.locator(`[data-pull-page="${CHAR.cms_config.pageId}"]`)).toHaveText(CHAR.name);
    await expect(picker.locator(`[data-pull-page="${OTHER_SYSTEM.cms_config.pageId}"]`)).toBeVisible();
    await expect(picker.locator(`[data-pull-page="${LOCKED_ID}"]`), 'a locked page has no editor').toHaveCount(0);
    await expect(picker.locator('[data-pull-page="editor_playground"]')).toHaveCount(0);

    const term = CHAR.name.toLowerCase();
    const sameGroup = NAV.Characters.find(e => e.cms_config && !e.name.toLowerCase().includes(term));
    await picker.locator('#playground-pull-search').fill(term);
    await expect(picker.locator(`[data-pull-page="${CHAR.cms_config.pageId}"]`)).toBeVisible();
    await expect(picker.locator(`[data-pull-page="${sameGroup.cms_config.pageId}"]`), 'a non-match beside a match').toBeHidden();
    await expect(picker.locator(`[data-pull-page="${OTHER_SYSTEM.cms_config.pageId}"]`), 'a group with no match').toBeHidden();

    await picker.locator(`[data-pull-page="${CHAR.cms_config.pageId}"]`).click();
    await expect(confirmModal(page)).toBeVisible();
    await expect(page.locator('#editor-modal-text')).toContainText(`Replace what is in the Playground with ${CHAR.name}?`);
    await page.locator('#editor-modal-cancel').click();
    expect(param(page, 'page'), 'cancel keeps the blank page').toBe('playground');

    await picker.locator(`[data-pull-page="${CHAR.cms_config.pageId}"]`).click();
    await page.locator('#editor-modal-confirm').click();
    await expect(page.locator('#editor-subtitle')).toHaveText(`A copy of ${CHAR.name}.`, { timeout: 45000 });
    await expect(page.locator('#block-list textarea').first()).toHaveValue('LIVE OVERVIEW TEXT', { timeout: 45000 });
    expect(param(page, 'pull'), 'a reload does not pull again').toBeNull();
    expect(JSON.parse(await stored(page, 'dsl_playground')).charId).toBe(CHAR.cms_config.pageId);

    // Pulled pages carry their own type: a system page opens as one.
    await page.locator('#submit-payload-btn').click();
    await page.locator(`[data-pull-page="${OTHER_SYSTEM.cms_config.pageId}"]`).click();
    await page.locator('#editor-modal-confirm').click();
    await expect(page.locator('#editor-subtitle')).toHaveText(`A copy of ${OTHER_SYSTEM.name}.`, { timeout: 45000 });
    expect(param(page, 'type')).toBe('system');
    expect(await page.evaluate(() => window.currentEditorPageType)).toBe('system');
    expect(errors).toEqual([]);
});

test('edits stay in the Playground\'s own draft and never touch the page\'s real one', async ({ page }) => {
    const id = CHAR.cms_config.pageId;
    const realDraft = JSON.stringify({ timestamp: 1, charId: id, tabId: 'overview', desc_data: { overview: [block('MY REAL DRAFT')] }, frame_data: { m1s: [], skills: [], specials: [] } });
    await page.addInitScript(([id, realDraft]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(`wiki_draft_${id}`, realDraft);
        localStorage.setItem('dsl_playground', JSON.stringify({ timestamp: 2, charId: id, pageType: 'character', tabId: 'overview', desc_data: { overview: [block('PLAYGROUND TEXT')], profile: { stats: [], image: '' }, extras: [], matchups: [] }, frame_data: { m1s: [], skills: [], specials: [] } }));
        function block(t) { return { type: 'paragraph', content: t }; }
    }, [id, realDraft]);
    const errors = await open(page);

    // The Playground's draft, without the real editor's "restore your draft?".
    const field = page.locator('#block-list textarea').first();
    await expect(field).toHaveValue('PLAYGROUND TEXT', { timeout: 45000 });
    await expect(confirmModal(page)).toBeHidden();

    await field.fill('PRACTICE EDIT');
    await page.locator('#btn-sync').click();
    // The editor keeps a paragraph as lines.
    await expect.poll(async () => [].concat(JSON.parse(await stored(page, 'dsl_playground')).desc_data.overview[0].content).join('\n'))
        .toBe('PRACTICE EDIT');
    expect(await stored(page, `wiki_draft_${id}`), 'the real draft is untouched').toBe(realDraft);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('wiki_save_'))), 'and no saved version appears').toEqual([]);

    // And it comes back after a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#block-list textarea').first()).toHaveValue('PRACTICE EDIT', { timeout: 45000 });
    expect(errors).toEqual([]);
});

test('nothing is ever sent: no submission, no upload, no Conflict Check, no offer to continue a submission', async ({ page }) => {
    // Signed in, on a real page, with changes Submit would send: everything
    // the real editor needs to reach the review queue.
    await page.addInitScript((id) => {
        localStorage.setItem('dsl_playground', JSON.stringify({ timestamp: 2, charId: id, pageType: 'character', tabId: 'overview', desc_data: { overview: [{ type: 'paragraph', content: 'CHANGED IN THE PLAYGROUND' }], profile: { stats: [], image: '' }, extras: [], matchups: [] }, frame_data: { m1s: [], skills: [], specials: [] } }));
    }, CHAR.cms_config.pageId);
    const errors = await open(page, 'playground', { signedIn: true, openSubmission: true });
    await expect(page.locator('#block-list textarea').first()).toHaveValue('CHANGED IN THE PLAYGROUND', { timeout: 45000 });
    await expect(confirmModal(page), 'the real editor would offer the open submission here').toBeHidden();

    await page.locator('#submit-payload-btn').click();
    await expect(page.locator('#playground-pull-modal')).toBeVisible();
    await page.locator('#playground-pull-close').click();
    // No QA form, no writing checks, no alert: Pull opened its list and
    // nothing else ran.
    await expect(page.locator('.editor-modal-overlay:visible')).toHaveCount(0);

    // The library opens and still lists media, but takes no files.
    await page.evaluate(() => window.loadMediaGallery());
    await expect(page.locator('#media-upload-text')).toHaveText('Uploading is off in the Playground. Media already in the library can still be used.');
    await expect(page.locator('#media-upload-zone')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#media-file-input').setInputFiles({ name: 'clip.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFF0000WEBP') });
    await expect(page.locator('#editor-alert-msg')).toContainText('Uploading is off in the Playground.');
    await page.locator('#editor-alert-modal button').click();

    await page.locator('#btn-editor-config').click();
    await page.locator('[data-config-tab="actions"]').click();
    await expect(page.locator('[data-config-panel="actions"]')).toContainText('MINIMIZE ALL');
    await expect(page.locator('[data-conflict-run]')).toHaveCount(0);

    const calls = await page.evaluate(() => window.__calls);
    expect(calls.writes).toEqual([]);
    expect(calls.uploads).toEqual([]);
    expect(calls.rpc).not.toContain('get_open_submission_scopes');
    expect(calls.tables, 'not even asked about open submissions').not.toContain('pending_revisions');
    expect(errors).toEqual([]);
});

test('NEW asks, then wipes the Playground back to a blank page', async ({ page }) => {
    await page.addInitScript((id) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('dsl_playground', JSON.stringify({ timestamp: 2, charId: id, pageType: 'character', tabId: 'overview', desc_data: { overview: [{ type: 'paragraph', content: 'OLD WORK' }] }, frame_data: { m1s: [], skills: [], specials: [] } }));
    }, CHAR.cms_config.pageId);
    await open(page);
    await expect(page.locator('#block-list textarea').first()).toHaveValue('OLD WORK', { timeout: 45000 });

    await page.locator('#btn-playground-new').click();
    await expect(page.locator('#editor-modal-text')).toContainText('Clear the Playground and start again from a blank character page?');
    await page.locator('#editor-modal-cancel').click();
    await expect(page.locator('#block-list textarea').first()).toHaveValue('OLD WORK');

    await page.locator('#btn-playground-new').click();
    await page.locator('#editor-modal-confirm').click();
    await expect(page.locator('#editor-subtitle')).toHaveText('A blank character page.', { timeout: 45000 });
    expect(param(page, 'page')).toBe('playground');
    await expect(page.locator('#block-list .block-card')).toHaveCount(0);
    const kept = await stored(page, 'dsl_playground');
    expect(kept === null || JSON.parse(kept).charId === 'playground').toBe(true);
});

test('an old link opens the one Playground, never a ticket or a page\'s own draft', async ({ page }) => {
    await page.addInitScript((id) => {
        localStorage.setItem('dsl_playground', JSON.stringify({ timestamp: 2, charId: id, pageType: 'character', tabId: 'overview', desc_data: { overview: [{ type: 'paragraph', content: 'KEPT' }] }, frame_data: { m1s: [], skills: [], specials: [] } }));
    }, CHAR.cms_config.pageId);
    await open(page, `playground&page=${OTHER_SYSTEM.cms_config.pageId}&type=system&editTicket=t-9&loadDraft=true&draftKey=wiki_save_x`);

    await expect(page.locator('#block-list textarea').first()).toHaveValue('KEPT', { timeout: 45000 });
    expect(param(page, 'page')).toBe(CHAR.cms_config.pageId);
    expect(param(page, 'editTicket')).toBeNull();
    expect(param(page, 'draftKey')).toBeNull();
    expect(await page.evaluate(() => window.__calls.tables.includes('pending_revisions'))).toBe(false);
    await expect(page.locator('#submit-payload-btn')).toHaveText('Pull');
});

test('leaving the Playground goes back to its own page', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.editorExitDestination(`?playground&page=${'boomcat'}&type=character`)))
        .toBe('tools/editor-playground/');
    expect(await page.evaluate(() => window.editorExitDestination('?page=boomcat&type=character')))
        .toBe('characters/boomcat/');
});

test('the real editor is left alone: Submit, Drafts and Save, no banner', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockEditor(page);
    await page.goto(`/edit.html?char=${CHAR.cms_config.pageId}&type=character&tab=overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#block-list textarea').first()).toHaveValue('LIVE OVERVIEW TEXT', { timeout: 45000 });
    await expect(page.locator('#submit-payload-btn')).toHaveText('Submit');
    await expect(page.locator('#btn-drafts')).toBeVisible();
    await expect(page.locator('#btn-save')).toBeVisible();
    await expect(page.locator('.playground-banner')).toHaveCount(0);
    await expect(page.locator('#btn-playground-new')).toHaveCount(0);
    expect(await page.evaluate(() => window.editorPlayground)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('the Playground\'s page says what it is and opens it', async ({ page }) => {
    await mockEditor(page, { signedIn: false });
    await page.goto('/tools/editor-playground/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.playground-about')).toContainText('Nothing you do here is sent anywhere', { timeout: 20000 });
    const link = page.locator('#tool-mount a.tool-launch-btn');
    await expect(link).toHaveText('OPEN THE PLAYGROUND');
    await link.click();
    await expect(page.locator('#editor-title')).toHaveText('Editor Playground', { timeout: 45000 });
    expect(new URL(page.url()).pathname).toBe('/edit.html');
});
