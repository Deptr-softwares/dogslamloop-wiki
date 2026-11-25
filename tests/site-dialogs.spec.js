// Every box on the site is one dialog (C-1): a <dialog> opened as a modal, in the
// staff look, at one of four sizes, opening with fade and rise. Escape closes any
// box; a click outside closes one with nothing typed in it, never a prompt. The
// page behind does not scroll or shift, focus moves in and comes back, a second
// question to an open box is refused, and a box opened over another sits on top.
const { test, expect } = require('@playwright/test');

// Headless Chromium hides scrollbars, and the room a scrollbar takes is what the
// scroll lock must keep.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const READER = '/characters/Boomcat/index.html';
const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';
const EDITOR_GALLERY = '/edit.html?char=boomcat&type=character&tab=gallery';
const OWNER = '/owner.html';
const OVERSEER = '/overseer.html';
const SUBMISSIONS = '/submissions.html';

const RED = 'rgb(239, 68, 68)';
const YELLOW = 'rgb(234, 179, 8)';
const GREEN = 'rgb(34, 197, 94)';
const PURPLE = 'rgb(168, 85, 247)';
const BLUE = 'accent-blue';

// Every question and message box, as its own code opens it. `answer` is what a way
// out other than a button resolves to (undefined for a message box).
const QUESTIONS = [
    { page: READER, name: 'site confirm', open: "window.siteConfirm('Delete it?')", id: 'site-confirm-modal', tone: RED, light: true, answer: false },
    { page: READER, name: 'site prompt', open: "window.sitePrompt('Which address?')", id: 'site-confirm-modal', tone: BLUE, light: false, answer: null },
    { page: READER, name: 'site message', open: "window.showSystemAlert('Saved.')", id: 'alert-modal-overlay', tone: GREEN, light: true },
    { page: EDITOR, name: 'editor confirm', open: "window.customConfirm('Delete it?')", id: 'editor-custom-modal', tone: RED, light: true, answer: false },
    { page: EDITOR, name: 'editor prompt', open: "window.customPrompt('Which address?')", id: 'editor-custom-modal', tone: RED, light: false, answer: null },
    { page: EDITOR, name: 'editor message', open: "window.editorAlert('Careful.')", id: 'editor-alert-modal', tone: YELLOW, light: true },
    { page: OWNER, name: 'staff confirm', open: "window.adminConfirm('Delete it?')", id: 'admin-confirm-modal', tone: YELLOW, light: true, answer: false },
    { page: OVERSEER, name: 'Overseer message', open: "window.adminAlert('Done.')", id: 'admin-alert-modal', tone: BLUE, light: true },
    { page: OVERSEER, name: 'Overseer note', open: "window.adminPrompt('Why?', 'REJECT', 'DECLINE', true)", id: 'admin-prompt-modal', tone: RED, light: false, answer: null },
    { page: SUBMISSIONS, name: 'My Submissions confirm', open: "showConfirm('Withdraw it?')", id: null, tone: BLUE, light: true, answer: false },
];

// The owner, as far as the two staff gates ask: a session and the role row. The
// gates show ACCESS DENIED to anyone else, which takes the boxes off the page.
async function signedInAsOwner(page) {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const real = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = real(...args);
                    client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-owner', email: 'o@example.com' }, access_token: 't' } } });
                    const from = client.from.bind(client);
                    client.from = table => table === 'user_roles'
                        ? { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) }
                        : from(table);
                    return client;
                };
            },
        });
    });
}

async function load(page, url) {
    const errors = [];
    if (url === OWNER || url === OVERSEER) await signedInAsOwner(page);
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push(`a browser ${d.type()} box`); d.dismiss(); });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.openDialog === 'function');
    return errors;
}

// Opens a box without waiting on its answer; the answer lands in window.__answer.
async function ask(page, expression) {
    await page.evaluate(expr => {
        window.__answer = 'unanswered';
        const result = (0, eval)(expr);
        Promise.resolve(result).then(v => { window.__answer = v; });
    }, expression);
}

const openBox = page => page.locator('dialog.site-dialog[open]');

for (const q of QUESTIONS) {
    test(`${q.name}: a modal in the staff look; Escape closes it, a click outside ${q.light ? 'does too' : 'does not'}`, async ({ page }) => {
        const errors = await load(page, q.page);
        if (q.page === SUBMISSIONS) await page.waitForFunction(() => typeof showConfirm === 'function');

        await ask(page, q.open);
        const box = openBox(page);
        await expect(box).toHaveCount(1);
        if (q.id) await expect(box).toHaveId(q.id);

        const look = await box.evaluate(d => {
            const s = getComputedStyle(d);
            const title = d.querySelector('.dialog-header h3');
            const probe = document.createElement('span');
            probe.style.color = 'var(--accent-blue)';
            document.body.appendChild(probe);
            const blue = getComputedStyle(probe).color;
            probe.remove();
            return {
                modal: d.matches(':modal'),
                width: Math.round(d.getBoundingClientRect().width),
                topWidth: s.borderTopWidth,
                topColour: s.borderTopColor,
                titleColour: getComputedStyle(title).color,
                titleFont: getComputedStyle(title).fontFamily,
                bodyAlign: getComputedStyle(d.querySelector('.dialog-body')).textAlign,
                focusInside: d.contains(document.activeElement),
                blue,
            };
        });
        const tone = q.tone === BLUE ? look.blue : q.tone;
        expect(look.modal, 'opened as a modal').toBe(true);
        expect(look.width, 'a question or message is 400 wide').toBe(400);
        expect(look.topWidth).toBe('3px');
        expect(look.topColour, 'the top bar in its tone').toBe(tone);
        expect(look.titleColour, 'the title in its tone').toBe(tone);
        expect(look.titleFont, 'the staff look: a monospace title').toMatch(/monospace/);
        expect(look.bodyAlign, 'its text centred').toBe('center');
        expect(look.focusInside, 'focus moved into it').toBe(true);

        await page.keyboard.press('Escape');
        await expect(openBox(page)).toHaveCount(0);
        if ('answer' in q) await expect.poll(() => page.evaluate(() => window.__answer)).toBe(q.answer);

        await ask(page, q.open);
        await expect(openBox(page)).toHaveCount(1);
        await page.mouse.click(8, 8);
        await page.waitForTimeout(200);
        await expect(openBox(page)).toHaveCount(q.light ? 0 : 1);
        if (q.light && 'answer' in q) await expect.poll(() => page.evaluate(() => window.__answer)).toBe(q.answer);
        if (!q.light) {
            await page.keyboard.press('Escape');
            await expect(openBox(page)).toHaveCount(0);
        }
        expect(errors).toEqual([]);
    });
}

test('a drag that starts inside a box and ends outside does not close it', async ({ page }) => {
    // Selecting a question's text and letting go over the backdrop: Chrome sends
    // that click to the dialog itself, at a point outside it.
    const errors = await load(page, READER);
    await ask(page, "window.siteConfirm('Delete it? This is a long enough line to drag across.')");
    const text = await page.locator('#site-confirm-text').boundingBox();
    await page.mouse.move(text.x + 4, text.y + text.height / 2);
    await page.mouse.down();
    await page.mouse.move(8, 8, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(openBox(page)).toHaveCount(1);
    await page.mouse.click(8, 8);
    await expect(openBox(page), 'a real click outside still closes it').toHaveCount(0);
    expect(errors).toEqual([]);
});

test('the page behind does not scroll or shift while a box is open, and focus comes back', async ({ page }) => {
    const errors = await load(page, READER);
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => {
        const opener = document.createElement('button');
        opener.id = 'test-opener';
        opener.textContent = 'open';
        document.querySelector('main, .site-body, body').prepend(opener);
        opener.focus({ preventScroll: true });
        // The body's laid-out width: the root's clientWidth counts a kept gutter as page.
        return { y: window.scrollY, width: document.body.getBoundingClientRect().width, hadBar: window.innerWidth > document.documentElement.clientWidth };
    });
    expect(before.hadBar, 'the page has a scrollbar to keep room for').toBe(true);

    await ask(page, "window.siteConfirm('Delete it?')");
    await expect(openBox(page)).toHaveCount(1);
    // Over the backdrop, beside the box: the box's own body never passes a scroll on.
    await page.mouse.move(40, 450);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    const during = await page.evaluate(() => ({ y: window.scrollY, width: document.body.getBoundingClientRect().width }));
    expect(during.y, 'the page did not scroll').toBe(before.y);
    expect(during.width, 'and kept the room its scrollbar took, so nothing shifted').toBe(before.width);

    // A second box over the first keeps it too.
    await page.evaluate(() => window.showSystemAlert('One more thing.'));
    await expect(openBox(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.body.getBoundingClientRect().width), 'nothing shifts for a second box').toBe(before.width);
    await page.keyboard.press('Escape');
    await expect(openBox(page)).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(openBox(page)).toHaveCount(0);
    await expect(page.locator('#test-opener'), 'focus is back on what opened it').toBeFocused();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'the page scrolls again' }).toBeGreaterThan(before.y);
    expect(errors).toEqual([]);
});

test('a box opens with fade and rise, and with no animation when motion is off', async ({ page }) => {
    await load(page, READER);
    await ask(page, "window.siteConfirm('Delete it?')");
    const moving = await openBox(page).evaluate(d => ({ name: getComputedStyle(d).animationName, duration: getComputedStyle(d).animationDuration }));
    expect(moving).toEqual({ name: 'modal-fade-in', duration: '0.15s' });
    await page.keyboard.press('Escape');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.siteConfirm === 'function');
    await ask(page, "window.siteConfirm('Delete it?')");
    expect(await openBox(page).evaluate(d => getComputedStyle(d).animationName)).toBe('none');
});

test('a second question to an open box is refused, and the first keeps its words', async ({ page }) => {
    const errors = await load(page, EDITOR);
    await ask(page, "window.customConfirm('The first question?')");
    const second = await page.evaluate(() => window.customConfirm('The second question?'));
    expect(second, 'refused at once').toBe(false);
    await expect(page.locator('#editor-modal-text')).toHaveText('The first question?');
    await page.locator('#editor-modal-confirm').click();
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe(true);
    expect(errors).toEqual([]);
});

test('a box opened over another sits on top and answers first', async ({ page }) => {
    const errors = await load(page, EDITOR);
    await ask(page, "window.customConfirm('Delete it?')");
    await page.evaluate(() => window.editorAlert('One more thing.'));
    await expect(openBox(page)).toHaveCount(2);

    const onTop = await page.evaluate(() => {
        const ok = document.getElementById('editor-alert-ok');
        const r = ok.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === ok;
    });
    expect(onTop, 'the later box is on top, where it can be clicked').toBe(true);
    await page.locator('#editor-alert-ok').click();
    await expect(page.locator('#editor-alert-modal')).toBeHidden();
    await expect(page.locator('#editor-custom-modal'), 'the first box is still asking').toBeVisible();
    await page.locator('#editor-modal-cancel').click();
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe(false);
    expect(errors).toEqual([]);
});

test('a sign-in that cannot reach its provider says so in the site message box', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const real = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = real(...args);
                    client.auth.getSession = async () => ({ data: { session: null } });
                    client.auth.signInWithOAuth = async () => ({ data: null, error: { message: 'provider down' } });
                    return client;
                };
            },
        });
    });
    const errors = await load(page, READER);
    await page.locator('#dock-btn-auth').click();
    await expect(page.locator('#auth-modal-overlay')).toBeVisible();
    await page.getByRole('button', { name: /LOGIN WITH DISCORD/ }).click();
    await expect(page.locator('#alert-modal-msg')).toHaveText('Failed to connect to discord');
    await expect(page.locator('#alert-modal-overlay')).toBeVisible();
    expect(errors, 'no browser alert box').toEqual([]);
});

test('the site prompt gives back what was typed, on OK or Enter', async ({ page }) => {
    const errors = await load(page, READER);
    await ask(page, "window.sitePrompt('Which address?', { value: '/systems/' })");
    const field = page.locator('#site-confirm-modal .dialog-input');
    await expect(field).toBeFocused();
    await field.fill('  /systems/hud/  ');
    await page.locator('#site-confirm-ok').click();
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe('/systems/hud/');
    await expect(field, 'the field goes with the box').toHaveCount(0);

    await ask(page, "window.sitePrompt('Which address?')");
    await page.locator('#site-confirm-modal .dialog-input').fill('/systems/m1-trading/');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe('/systems/m1-trading/');

    // The confirm that shares the box is red and asks again as a confirm.
    await ask(page, "window.siteConfirm('Delete it?')");
    await expect(page.locator('#site-confirm-ok')).toHaveClass(/btn-danger-fill/);
    await expect(page.locator('#site-confirm-modal .dialog-input')).toHaveCount(0);
    expect(errors).toEqual([]);
});

// --- The reader's boxes, opened through their own controls ---

// A signed-in reader with one notification, as far as the dock and the account
// boxes ask (the stand-in account-boxes-on-open.spec.js uses).
async function signedIn(page) {
    await page.addInitScript(() => {
        const notifications = [{
            id: 'n-1', created_at: '2026-11-20T00:00:00Z', user_id: 'me',
            message: 'Your edit to Boomcat was approved.', link: '', is_read: false,
        }];
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
                        data: { session: { user: { id: 'me', email: 'me@example.com', user_metadata: {} }, access_token: 'tok' } },
                    });
                    client.auth.getUser = async () => ({ data: { user: { id: 'me' } } });
                    const inert = new Proxy({}, {
                        get(_t, prop) {
                            if (prop === 'then') return resolve => resolve({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        },
                    });
                    client.from = table => {
                        if (table !== 'user_notifications') return inert;
                        const chain = {
                            head: false,
                            select(_cols, opts) { chain.head = !!(opts && opts.head); return chain; },
                            eq() { return chain; },
                            order() { return chain; },
                            limit() { return Promise.resolve({ data: notifications, error: null }); },
                            then(resolve, reject) {
                                return Promise.resolve(chain.head ? { count: 1, error: null } : { data: notifications, error: null }).then(resolve, reject);
                            },
                        };
                        return chain;
                    };
                    client.rpc = async () => ({ data: [], error: null });
                    return client;
                };
            },
        });
    });
}

// The box is open as a modal, in the staff look (or the player's own), at its size
// and tone; a click outside closes it only when it is light.
async function checkBox(page, id, { width, tone, light, ownLook = false }) {
    const box = page.locator(`#${id}`);
    await expect(box).toBeVisible();
    const seen = await box.evaluate(d => {
        const s = getComputedStyle(d);
        const title = d.querySelector('.dialog-header h3');
        return {
            modal: d.matches(':modal'),
            width: Math.round(d.getBoundingClientRect().width),
            top: s.borderTopColor,
            titleFont: title ? getComputedStyle(title).fontFamily : null,
            titleCase: title ? getComputedStyle(title).textTransform : null,
        };
    });
    expect(seen.modal, `${id} opened as a modal`).toBe(true);
    expect(seen.width, `${id} is ${width} wide`).toBe(width);
    if (tone) expect(seen.top, `${id} in its tone`).toBe(tone);
    if (!ownLook) {
        expect(seen.titleFont, `${id} has the staff title`).toMatch(/monospace/);
        expect(seen.titleCase).toBe('uppercase');
    }
    await page.mouse.click(6, 6);
    await page.waitForTimeout(200);
    if (light) await expect(box, `${id}: a click outside closes it`).toBeHidden();
    else await expect(box, `${id}: a click outside leaves it, it holds what was typed`).toBeVisible();
}

test('Sign In: opened from the dock, kept open by a click outside, and Escape goes back to the button', async ({ page }) => {
    const errors = await load(page, READER);
    await page.locator('#dock-btn-auth').click();
    await checkBox(page, 'auth-modal-overlay', { width: 400, light: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('#auth-modal-overlay')).toBeHidden();
    await expect(page.locator('#dock-btn-auth'), 'focus is back on the button').toBeFocused();
    await page.locator('#dock-btn-auth').click();
    await page.locator('#auth-modal-overlay').getByRole('button', { name: 'CANCEL' }).click();
    await expect(page.locator('#auth-modal-overlay')).toBeHidden();
    expect(errors).toEqual([]);
});

test('Site Settings: opened from the dock, closed by a click outside or CLOSE', async ({ page }) => {
    const errors = await load(page, READER);
    await page.locator('#dock-btn-settings').click();
    await checkBox(page, 'site-settings-overlay', { width: 400, light: true });
    await page.locator('#dock-btn-settings').click();
    await expect(page.locator('#site-setting-look-default'), 'focus on the look in use').toBeFocused();
    await page.locator('#site-settings-overlay').getByRole('button', { name: 'CLOSE' }).click();
    await expect(page.locator('#site-settings-overlay')).toBeHidden();
    await expect(page.locator('#dock-btn-settings')).toBeFocused();
    expect(errors).toEqual([]);
});

test('Edit Profile: a 650 purple box that a click outside leaves open', async ({ page }) => {
    await signedIn(page);
    const errors = await load(page, READER);
    await page.locator('#dock-btn-auth').click();
    await checkBox(page, 'profile-modal-overlay', { width: 650, tone: 'rgb(168, 85, 247)', light: false });
    await page.locator('#profile-modal-overlay').getByRole('button', { name: 'CANCEL' }).click();
    await expect(page.locator('#profile-modal-overlay')).toBeHidden();
    expect(errors).toEqual([]);
});

test('the inbox: a 500 box, and CLEAR ALL asks on top of it', async ({ page }) => {
    await signedIn(page);
    const errors = await load(page, READER);
    await page.locator('#dock-btn-inbox').click();
    await checkBox(page, 'site-notification-modal', { width: 500, light: true });

    await page.locator('#dock-btn-inbox').click();
    await expect(page.locator('#site-notification-modal')).toContainText('Your edit to Boomcat was approved.');
    await page.locator('#site-notification-modal [data-notif-clear]').click();
    await expect(page.locator('#site-confirm-modal')).toBeVisible();
    const onTop = await page.evaluate(() => {
        const b = document.getElementById('site-confirm-cancel');
        const r = b.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
    });
    expect(onTop, 'the confirm sits over the inbox').toBe(true);
    await page.locator('#site-confirm-cancel').click();
    await expect(page.locator('#site-notification-modal'), 'the inbox is still open under it').toBeVisible();
    await page.locator('#site-notification-modal').getByRole('button', { name: 'CLOSE' }).click();
    await expect(page.locator('#site-notification-modal')).toBeHidden();
    expect(errors).toEqual([]);
});

test('a public profile: a 400 box that a click outside closes', async ({ page }) => {
    await signedIn(page);
    const errors = await load(page, READER);
    await page.evaluate(() => window.openPublicProfile('u-other'));
    await checkBox(page, 'public-profile-overlay', { width: 400, light: true });
    expect(errors).toEqual([]);
});

test('the video player: the dialog in its own look, light, and emptied when it closes', async ({ page }) => {
    await page.route(/\.(mp4|webm)(\?|$)/, route => route.abort());
    const errors = await load(page, READER);
    const open = () => page.evaluate(() => window.openWikiVideoModal('https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/clip.mp4'));
    await open();
    // The clip itself is refused, so the site's missing-media notice may stand in
    // for the <video>: what counts is that the player has something in it.
    const inside = page.locator('#wiki-video-modal .wiki-video-modal-body > *');
    await expect(inside).not.toHaveCount(0);
    await checkBox(page, 'wiki-video-modal', { width: 900, light: true, ownLook: true });
    expect(await inside.count(), 'emptied on close').toBe(0);

    await open();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wiki-video-modal')).toBeHidden();
    await open();
    await page.locator('#wiki-video-modal .wiki-video-modal-close').click();
    await expect(page.locator('#wiki-video-modal')).toBeHidden();
    expect(await inside.count()).toBe(0);
    expect(errors).toEqual([]);
});

// --- The editor's and Overseer's tool boxes (C-1b) ---

// The Merge Compiler with no tickets, over a page fetch that answers at once: the
// stand-in session has no real token, so a live fetch would be refused.
const openCompiler = page => page.evaluate(() => {
    window.currentQueueData = [];
    const from = window.supabaseClient.from.bind(window.supabaseClient);
    window.supabaseClient.from = table => (table === 'page_data'
        ? { select() { return this; }, eq() { return this; }, single: async () => ({ data: { desc_data: {}, frame_data: {} }, error: null }) }
        : from(table));
    window.openMergeCompiler('boomcat');
});

// Each tool box, opened the way the editor opens it. `light`: a click outside
// closes it (nothing typed in it to lose).
const TOOLS = [
    { name: 'QA submit', open: page => ask(page, 'window.openQAModal(false)'), id: 'dynamic-qa-modal-overlay', width: 400, light: false },
    { name: 'Config', open: page => page.locator('#btn-editor-config').click(), id: 'editor-config-modal', width: 500, light: false },
    { name: 'House Style', open: page => page.evaluate(() => window.openHouseStyle()), id: 'editor-house-style-modal', width: 650, light: true },
    { name: 'the editor notice', open: page => page.evaluate(() => window.showEditorNotice('editor', { force: true })), id: 'editor-notice-editor', width: 400, light: true },
    { name: 'move id', open: page => ask(page, 'window.promptForMoveId()'), id: 'move-id-modal', width: 400, tone: GREEN, light: false },
    { name: 'Add a Gallery Item', page: EDITOR_GALLERY, open: page => page.locator('#char-gallery-add').click(), id: 'gallery-item-modal', width: 400, light: false },
    { name: 'Find & Replace', open: page => page.locator('#btn-find-replace').click(), id: 'find-replace-modal', width: 650, light: false },
    { name: 'the Media Library', open: page => page.locator('#btn-media-library').click(), id: 'media-modal-overlay', width: 860, light: false },
    { name: 'the Drafts Manager', open: page => page.locator('#btn-drafts').click(), id: 'draft-manager-modal', width: 650, light: true },
    { name: 'the Merge Compiler', page: OVERSEER, open: openCompiler, id: 'compiler-modal-overlay', width: 650, tone: PURPLE, light: false },
];

for (const t of TOOLS) {
    test(`${t.name}: a ${t.width} site dialog, focus inside, Escape closes it, a click outside ${t.light ? 'does too' : 'does not'}`, async ({ page }) => {
        const url = t.page || EDITOR;
        const errors = await load(page, url);
        if (url !== OVERSEER) await page.waitForFunction(() => window.currentEditorDescData);
        await t.open(page);
        await expect(page.locator(`#${t.id}`)).toBeVisible();
        expect(await page.locator(`#${t.id}`).evaluate(d => d.contains(document.activeElement)), 'focus moved into it').toBe(true);
        await checkBox(page, t.id, { width: t.width, tone: t.tone, light: t.light });
        if (!t.light) {
            await page.keyboard.press('Escape');
            await expect(page.locator(`#${t.id}`)).toBeHidden();
        }
        await t.open(page);
        await expect(page.locator(`#${t.id}`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(`#${t.id}`)).toBeHidden();
        expect(errors).toEqual([]);
    });
}

test('Escape on QA submit answers cancelled, so the submit never waits on it', async ({ page }) => {
    const errors = await load(page, EDITOR);
    await ask(page, 'window.openQAModal(false)');
    await page.locator('#qa-changelog').fill('Fixed the startup of M1.');
    await page.mouse.click(6, 6);
    await expect(page.locator('#dynamic-qa-modal-overlay'), 'a click outside keeps the changelog').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dynamic-qa-modal-overlay')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe(null);

    // And opens again, answering the next time.
    await ask(page, 'window.openQAModal(false)');
    await page.locator('#qa-changelog').fill('Fixed the startup of M1.');
    await page.locator('#btn-qa-confirm').click();
    await expect.poll(() => page.evaluate(() => window.__answer && window.__answer.changelog)).toBe('Fixed the startup of M1.');
    expect(errors).toEqual([]);
});

test('Escape on the move id box answers cancelled', async ({ page }) => {
    const errors = await load(page, EDITOR);
    await ask(page, 'window.promptForMoveId()');
    await page.locator('#new-move-name').fill('Cursed Strike');
    await page.keyboard.press('Escape');
    await expect(page.locator('#move-id-modal')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__answer)).toBe(null);
    expect(errors).toEqual([]);
});

test('Escape on the Media Library picker disarms it and leaves the gallery item box open', async ({ page }) => {
    const errors = await load(page, EDITOR_GALLERY);
    await page.waitForFunction(() => window.currentEditorDescData);
    await page.locator('#char-gallery-add').click();
    await expect(page.locator('#gallery-item-modal')).toBeVisible();
    await page.locator('#gallery-item-pick').click();
    await expect(page.locator('#media-modal-overlay')).toBeVisible();
    expect(await page.evaluate(() => typeof window.mediaPickHandler), 'armed while it is open').toBe('function');

    await page.keyboard.press('Escape');
    await expect(page.locator('#media-modal-overlay')).toBeHidden();
    await expect.poll(() => page.evaluate(() => typeof window.mediaPickHandler), { message: 'disarmed, so the next open is not a picker' }).toBe('object');
    await expect(page.locator('#gallery-item-modal'), 'one Escape closes the top box only').toBeVisible();
    await expect(page.locator('#media-lib-preview')).toContainText('Pick a file to preview it here.');
    expect(errors).toEqual([]);
});

// --- What opens inside a box ---

test('a tooltip shown from inside a box draws on top of it', async ({ page }) => {
    // House Style is a page's own writing, so it can link to one of the page's
    // sections; that link's hover names where it goes, in the site's tooltip.
    const errors = await load(page, EDITOR);
    await page.waitForFunction(() => window.currentEditorDescData);
    await page.evaluate(() => {
        const target = document.createElement('h3');
        target.id = 'sec-dialog-tooltip';
        target.textContent = 'Neutral Game';
        document.body.appendChild(target);
        window.currentEditorDescData.pageConfig = { words: [], houseStyle: 'Read [url=#sec-dialog-tooltip]this part[/url] first.' };
        window.openHouseStyle();
    });
    const link = page.locator('#editor-house-style-modal a.wiki-link-jump');
    await expect(link).toBeVisible();
    await link.hover();
    const tip = page.locator('#wiki-frame-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Neutral Game');

    // The tooltip lets the pointer through, so it is hit-tested with that off.
    const onTop = await tip.evaluate(el => {
        el.style.pointerEvents = 'auto';
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        el.style.pointerEvents = 'none';
        return el === hit || el.contains(hit);
    });
    expect(onTop, 'the tooltip is drawn over the box, not under it').toBe(true);

    // And once the box is gone, the next tooltip draws on the page again.
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor-house-style-modal')).toHaveCount(0);
    await page.evaluate(() => window.showTooltipAt('On the page', 50, 50));
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('On the page');
    expect(errors).toEqual([]);
});

test('a bound tooltip (a callout, a Frame Track phase) inside a box draws on top of it too', async ({ page }) => {
    const errors = await load(page, EDITOR);
    await page.waitForFunction(() => window.currentEditorDescData);
    await page.evaluate(() => {
        window.openHouseStyle();
        const btn = document.createElement('button');
        btn.id = 'test-callout';
        btn.textContent = 'Startup';
        document.querySelector('#editor-house-style-modal .dialog-body').appendChild(btn);
        window.bindTooltip(btn, 'Frames before the hitbox comes out.');
    });
    await page.locator('#test-callout').hover();
    const tip = page.locator('#wiki-frame-tooltip');
    await expect(tip).toHaveText('Frames before the hitbox comes out.');
    const onTop = await tip.evaluate(el => {
        el.style.pointerEvents = 'auto';
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        el.style.pointerEvents = 'none';
        return el === hit || el.contains(hit);
    });
    expect(onTop).toBe(true);
    expect(errors).toEqual([]);
});
