// Counting visitors with Umami Cloud (v1.2; owner, 2026-11-17).
//
// The owner turned Cloudflare's Web Analytics off and counts visitors with
// Umami Cloud, because KLIPY asks for monthly active users before it issues a
// production API key. Their brief: "the least intrusive and minimal things".
// Their picks: reader pages only, and no speed data.
//
// js/analytics.js asks Umami for page views on dogslamloop.com only, without
// the ?query or #hash of an address, and not for a browser that sends Do Not
// Track. These tests serve the site under its real address from this checkout
// and stand a recorder in for Umami's script, so nothing here reaches Umami.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://dogslamloop.com';

// The pages that are not for reading the wiki: the owner's pick leaves them
// uncounted. Everything else that boots the site counts.
const STAFF = ['admin.html', 'edit.html', 'owner.html', 'post-editor.html', 'tier-editor.html', 'submissions.html'];

const PAGES = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map(rel => ({ rel, html: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
    // A moved-page stub only redirects, and loads nothing at all.
    .filter(({ html }) => /src="[^"]*js\/site_utils\.js/.test(html));

test('every reader page loads the counter, without holding the page up, and no staff page does', () => {
    const tag = /<script\b[^>]*\bsrc="[^"]*js\/analytics\.js[^"]*"[^>]*>/;
    const missing = [];
    const blocking = [];
    const staff = [];
    for (const { rel, html } of PAGES) {
        const found = html.match(tag);
        if (STAFF.includes(rel)) { if (found) staff.push(rel); continue; }
        if (!found) missing.push(rel);
        else if (!/\basync\b/.test(found[0])) blocking.push(rel);
    }
    expect(PAGES.length).toBeGreaterThan(STAFF.length);
    expect(missing, 'reader pages without the counter').toEqual([]);
    expect(blocking, 'loaded async, so it never waits on anything').toEqual([]);
    expect(staff, 'staff and editor pages are not counted').toEqual([]);
});

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// The site under its real address, from this checkout. `websiteId` stands in
// for the owner's ID in js/analytics.js, which is empty until they send it.
async function serveSite(page, { websiteId = null } = {}) {
    await page.route(`${SITE}/**`, route => {
        const url = new URL(route.request().url());
        let rel = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
        const file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
        let body = fs.readFileSync(file);
        if (rel === 'js/analytics.js' && websiteId) {
            body = Buffer.from(body.toString('utf8').replace("const WEBSITE_ID = '';", `const WEBSITE_ID = '${websiteId}';`));
        }
        route.fulfill({ status: 200, contentType: TYPES[path.extname(rel)] || 'application/octet-stream', body });
    });

    // Umami's script, replaced by a recorder: what it was loaded with, and
    // whether it may send. It sends where Umami's own does.
    await page.route('https://cloud.umami.is/**', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: `
            (function () {
                const s = document.currentScript;
                const attrs = {};
                for (const a of s.attributes) if (a.name.startsWith('data-')) attrs[a.name] = a.value;
                window.__umami = { attrs, async: s.async };
                fetch('https://gateway.umami.is/api/send', { method: 'POST', body: JSON.stringify(attrs) })
                    .then(() => { window.__umami.sent = true; }, (e) => { window.__umami.blocked = String(e); });
            })();`,
    }));
    const sent = [];
    await page.route('https://gateway.umami.is/**', route => { sent.push(route.request().postData()); route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    return sent;
}

const umamiRequests = (page) => {
    const asked = [];
    page.on('request', r => { if (/umami\.(is|dev)/.test(r.url())) asked.push(r.url()); });
    return asked;
};

test('on dogslamloop.com a reader page loads Umami with the minimal settings, and nothing more', async ({ page }) => {
    const sent = await serveSite(page, { websiteId: 'test-website-id' });
    await page.goto(`${SITE}/terms.html`, { waitUntil: 'load' });

    await expect.poll(() => page.evaluate(() => window.__umami && window.__umami.sent)).toBe(true);
    const umami = await page.evaluate(() => window.__umami);
    expect(umami.async).toBe(true);
    // Exactly these. No speed data, no error reports (owner, 2026-11-17).
    expect(umami.attrs).toEqual({
        'data-website-id': 'test-website-id',
        'data-domains': 'dogslamloop.com',
        'data-exclude-search': 'true',
        'data-exclude-hash': 'true',
        'data-do-not-track': 'true',
    });
    expect(sent.length).toBe(1);
});

test('the home page\'s own policy lets Umami load and send', async ({ page }) => {
    // index.html is the one page with a Content-Security-Policy, and it blocks
    // any script host or send address it does not name.
    await serveSite(page, { websiteId: 'test-website-id' });
    await page.goto(`${SITE}/index.html`, { waitUntil: 'load' });

    await expect.poll(() => page.evaluate(() => window.__umami && (window.__umami.sent || window.__umami.blocked))).toBeTruthy();
    expect(await page.evaluate(() => window.__umami.blocked || null)).toBe(null);
});

test('until the owner\'s Website ID is in, nothing is loaded, even on dogslamloop.com', async ({ page }) => {
    // As committed: the ID is empty, and an empty ID counts nothing.
    const asked = umamiRequests(page);
    await serveSite(page);
    await page.goto(`${SITE}/terms.html`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll('script[src*="umami"]').length)).toBe(0);
});

test('anywhere but dogslamloop.com nothing is loaded or sent: local runs, previews and tests never count', async ({ page }) => {
    const asked = umamiRequests(page);
    // The ID filled in, so only the address can be what stops it.
    await page.route('**/js/analytics.js*', async route => {
        const body = fs.readFileSync(path.join(ROOT, 'js', 'analytics.js'), 'utf8')
            .replace("const WEBSITE_ID = '';", "const WEBSITE_ID = 'test-website-id';");
        route.fulfill({ status: 200, contentType: 'application/javascript', body });
    });
    await page.goto('/terms.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll('script[src*="umami"]').length)).toBe(0);
});
