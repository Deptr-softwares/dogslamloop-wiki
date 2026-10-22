// v1.1 batch 9: KaTeX is fetched only when a page has math in it.
//
// It used to ship in the head of every character page, the Template, admin,
// history and the tier editor, and no page used it (2026-10-22: one `$` in all
// the indexed text). renderMathIfAny (js/site_utils.js) now looks for a $...$
// pair in the page's text and loads the three files the first time it finds
// one. These tests use a page row of their own, so the owner writing math into
// a real page can never change what they assert.
const { test, expect } = require('@playwright/test');

const BOOMCAT = '/characters/Boomcat/index.html';

function mockPageRow(page, row) {
    return page.addInitScript((row) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        const origFrom = client.from.bind(client);
                        client.from = (table) => {
                            if (table !== 'page_data') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                single: async () => ({ data: row, error: null }),
                            };
                            return chain;
                        };
                        client.auth.getSession = async () => ({ data: { session: null } });
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, row);
}

function katexRequests(page) {
    const seen = [];
    page.on('request', r => { if (r.url().includes('/katex@')) seen.push(r.url()); });
    return seen;
}

const intro = text => ({ page_id: 'boomcat', frame_data: {}, desc_data: { comboIntro: [{ type: 'paragraph', content: text }] } });

test('a page with no math never fetches KaTeX', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const seen = katexRequests(page);
    // One lone dollar sign is not math.
    await mockPageRow(page, intro('Costs $5 to unlock.'));
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.locator('#nav-combos').click();
    await expect(page.locator('#tab-combos')).toContainText('Costs $5 to unlock.');
    await page.waitForTimeout(800);

    expect(seen).toEqual([]);
    expect(await page.locator('.katex').count()).toBe(0);
    expect(errors).toEqual([]);
});

test('a page with math fetches KaTeX and draws it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const seen = katexRequests(page);
    await mockPageRow(page, intro('Damage scales as $x^2$ per hit.'));
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.locator('#nav-combos').click();

    // Drawn, not just fetched: the $...$ text became KaTeX's markup.
    await expect(page.locator('#tab-combos .katex')).toHaveCount(1);
    await expect(page.locator('#tab-combos')).not.toContainText('$x^2$');
    expect(seen.some(u => u.endsWith('/katex.min.js'))).toBe(true);
    expect(seen.some(u => u.endsWith('/auto-render.min.js'))).toBe(true);
    expect(seen.some(u => u.endsWith('/katex.min.css'))).toBe(true);
    expect(errors).toEqual([]);
});

test('math in a script is not math', async ({ page }) => {
    const seen = katexRequests(page);
    await mockPageRow(page, intro('Nothing to draw here.'));
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('script');
            s.type = 'text/plain';
            s.textContent = 'const cost = `$${a}$`;';
            document.body.appendChild(s);
        });
    });
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(seen).toEqual([]);
});

test('KaTeX that cannot be reached leaves the text and the page working', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/katex@*/**', route => route.abort());
    await mockPageRow(page, intro('Damage scales as $x^2$ per hit.'));
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.locator('#nav-combos').click();
    await expect(page.locator('#tab-combos')).toContainText('$x^2$');
    await page.locator('#nav-m1s').click();
    await expect(page.locator('#tab-m1s')).toBeVisible();
    expect(errors).toEqual([]);
});
