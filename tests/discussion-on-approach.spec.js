// A character page's discussion (emoji.js and discussions.js) loads as the reader
// nears the thread, not with the page: about a screen before it, at once for a
// link to a post or a press of the jump button. The jump button's count shows from
// the start, and a thread whose scripts cannot load says so. Supabase is stood in
// for, and the thread is pushed far down the page the way real content pushes it.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';
const FAR = 6000;

async function setUp(page, { failScript = false } = {}) {
    const asked = [];
    page.on('request', request => {
        const m = /js\/(utility\/emoji|pages\/community\/discussions)\.js(\?v=[0-9a-f]+)?/.exec(request.url());
        if (m) asked.push({ file: m[1], stamp: m[2] || '' });
    });
    await page.route(/\.supabase\.co\//, route => {
        const request = route.request();
        if (/\/storage\/v1\//.test(request.url())) return route.abort();
        const one = /vnd\.pgrst\.object/.test(request.headers()['accept'] || '');
        if (/\/rest\/v1\/page_discussions/.test(request.url()) && /count=exact/.test(request.headers()['prefer'] || '')) {
            return route.fulfill({
                status: 200, contentType: 'application/json', body: '[]',
                headers: { 'content-range': '*/3', 'access-control-expose-headers': 'content-range' },
            });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: one ? 'null' : '[]' });
    });
    if (failScript) await page.route('**/js/pages/community/discussions.js*', route => route.abort());
    await page.addInitScript(far => {
        const style = document.createElement('style');
        style.textContent = `#discussion-section { margin-top: ${far}px; }`;
        // Before the page's own DOMContentLoaded listeners, which start the observer.
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    }, FAR);
    return asked;
}

const sectionTop = page => page.evaluate(() => document.getElementById('discussion-section').getBoundingClientRect().top + window.scrollY);
const drawn = page => page.locator('#discussion-section .discussion-title');

test('the thread loads about a screen before the reader reaches it, and then works', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = await setUp(page);
    await page.goto(PAGE, { waitUntil: 'networkidle' });

    expect(asked, 'nothing of the thread is fetched with the page').toEqual([]);
    await expect(page.locator('#jump-discussion-count'), 'the jump button has its count from the start').toHaveText('3');

    // Two screens above the thread: still nothing.
    const top = await sectionTop(page);
    const screen = await page.evaluate(() => window.innerHeight);
    await page.evaluate(y => window.scrollTo(0, y), top - 2.5 * screen);
    await page.waitForTimeout(300);
    expect(asked).toEqual([]);

    // A little under two screens above it (its own, plus one more): it loads.
    await page.evaluate(y => window.scrollTo(0, y), top - 1.8 * screen);
    await expect(drawn(page)).toHaveCount(1);
    expect(asked.map(a => a.file)).toEqual(['utility/emoji', 'pages/community/discussions']);

    // With the page's own stamp, so it is never an older copy than the page.
    const own = await page.evaluate(() => new URL(document.querySelector('script[src*="js/utility/site_utils.js"]').src).search);
    expect(own).toMatch(/^\?v=[0-9a-f]{8}$/);
    for (const a of asked) expect(a.stamp, a.file).toBe(own);

    // The thread's own controls work: signed out, its SIGN IN opens the sign-in box.
    await page.locator('#discussion-section [data-discussion-signin]').click();
    await expect(page.locator('#auth-modal-overlay')).toBeVisible();
    expect(errors).toEqual([]);
});

test('a link to a post loads the thread at once, without scrolling', async ({ page }) => {
    const asked = await setUp(page);
    await page.goto(`${PAGE}#post-p1`, { waitUntil: 'networkidle' });
    await expect(drawn(page)).toHaveCount(1);
    expect(asked.map(a => a.file)).toContain('pages/community/discussions');
});

test('the jump button loads the thread and goes to it', async ({ page }) => {
    const asked = await setUp(page);
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    expect(asked).toEqual([]);

    await page.locator('#btn-jump-discussion').click();
    await expect(drawn(page)).toBeInViewport();
});

test('a thread whose scripts cannot load says so', async ({ page }) => {
    await setUp(page, { failScript: true });
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.locator('#btn-jump-discussion').click();
    await expect(page.locator('#discussion-section .discussion-error')).toHaveText('Could not load the discussion. Try refreshing.');
});
