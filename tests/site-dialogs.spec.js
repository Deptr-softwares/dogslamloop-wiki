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
const OWNER = '/owner.html';
const OVERSEER = '/overseer.html';
const SUBMISSIONS = '/submissions.html';

const RED = 'rgb(239, 68, 68)';
const YELLOW = 'rgb(234, 179, 8)';
const GREEN = 'rgb(34, 197, 94)';
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
