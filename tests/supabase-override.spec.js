// The local-only Supabase override (v0.14).
//
// Exists to close a gap the rest of this suite cannot: every auth spec here
// mocks Supabase and never touches Postgres, so RLS predicates, grant gaps,
// trigger ordering and RPC guards stay unverified until somebody clicks them.
// Branching proves a migration APPLIES; it does not prove the feature WORKS.
//
// Which means this file is guarding a footgun. An override that could activate
// on the live site would let anything that can write localStorage point real
// readers at an attacker's database - so the guards matter more than the
// feature, and they are what is tested here.
const { test, expect } = require('@playwright/test');

const PREVIEW = { url: 'https://abcdefghijklmnop.supabase.co', key: 'preview-anon-key' };
const PROD_HOST = 'gtqswjspxymjdopljmfi.supabase.co';

// The client is built while site_utils.js parses, so the override has to be in
// storage before any script runs.
async function withOverride(page, value, { host } = {}) {
    await page.addInitScript((v) => {
        try {
            if (v === null) window.localStorage.removeItem('dsl_supabase_override');
            else window.localStorage.setItem('dsl_supabase_override', typeof v === 'string' ? v : JSON.stringify(v));
        } catch (e) { /* ignore */ }
    }, value);
}

// Reads which project the live client is actually pointed at, rather than
// trusting the flag the code sets about itself.
const targetOf = (page) => page.evaluate(() => {
    const c = window.supabaseClient;
    if (!c) return null;
    // supabase-js exposes the REST endpoint it was built with.
    const url = (c.rest && c.rest.url) || (c.restUrl) || (c.supabaseUrl) || '';
    return { url: String(url), flagged: !!window.supabaseIsOverridden };
});

test('an override in storage redirects the client when served locally', async ({ page }) => {
    await withOverride(page, PREVIEW);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    const target = await targetOf(page);
    expect(target.url).toContain('abcdefghijklmnop');
    expect(target.url).not.toContain(PROD_HOST);
    expect(target.flagged, 'the page knows it is not on production').toBe(true);
});

test('no override means production, with no flag set', async ({ page }) => {
    await withOverride(page, null);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    const target = await targetOf(page);
    expect(target.url).toContain(PROD_HOST);
    expect(target.flagged).toBe(false);
});

test('a malformed override falls back to production rather than leaving no backend', async ({ page }) => {
    // A page with no client at all is worse than a page on the wrong one: every
    // feature silently does nothing and nothing says why.
    for (const bad of ['not json at all', '{}', '{"url":"https://x.supabase.co"}', '{"url":123,"key":"k"}']) {
        await withOverride(page, bad);
        await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

        const target = await targetOf(page);
        expect(target, `override ${bad} left no client`).not.toBeNull();
        expect(target.url, `override ${bad} was accepted`).toContain(PROD_HOST);
        expect(target.flagged).toBe(false);
    }
});

test('only a supabase.co project URL is accepted', async ({ page }) => {
    // The whole value of the override is pointing at another Supabase project.
    // Anything else is somebody redirecting the site, which is the shape of
    // the attack this feature would otherwise be.
    const rejected = [
        'https://evil.example.com',
        'http://abcdefghijklmnop.supabase.co',
        'https://abcdefghijklmnop.supabase.co.evil.com',
        'https://supabase.co',
        'javascript:alert(1)',
    ];

    for (const url of rejected) {
        await withOverride(page, { url, key: 'k' });
        await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

        const target = await targetOf(page);
        expect(target.url, `${url} was accepted`).toContain(PROD_HOST);
        expect(target.flagged).toBe(false);
    }
});

test('the guard is a hostname check, not a build flag', async ({ page, request }) => {
    // This site has no build step and no environment variables, so the check
    // has to be something true of the running page. Asserted against the
    // served source, because the test server IS localhost - the negative case
    // cannot be reached by navigating.
    const js = await (await request.get('/js/site_utils.js')).text();

    expect(js, 'the override is gated on hostname').toMatch(
        /hostname[\s\S]{0,200}localhost[\s\S]{0,120}127\.0\.0\.1/
    );
    expect(js, 'and on an explicit opt-in that has to be set by hand').toContain('dsl_supabase_override');
    // Returns the production target before ever reading storage on a non-local
    // host, so there is no path from a remote page into the stored value.
    expect(js).toMatch(/if\s*\(!isLocal\)\s*return target;/);
});

test('an active override announces itself on every load', async ({ page }) => {
    // Testing against a preview database while believing it is production - or
    // the reverse - is the one way this helps nobody.
    const warnings = [];
    page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });

    await withOverride(page, PREVIEW);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    const notice = warnings.find(w => w.includes('LOCAL OVERRIDE ACTIVE'));
    expect(notice).toBeTruthy();
    expect(notice).toContain('abcdefghijklmnop');
    expect(notice).toContain('not production');
});
