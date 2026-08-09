// Protects the three structured-content changes in v0.11 stage 2c:
// editable section headings, the editable Game Info panel, and the homepage
// table of contents.
//
// The ToC is the one with real history. refreshTOC() targets #dynamic-toc; the
// homepage had no such element, so the refreshTOC() call it made on a 500ms
// timer had never done anything at all. Its ToC was a hardcoded list, and it
// had already drifted - #blog-section shipped in v0.9 and was never added.
// These tests pin that it now builds from the page's real headings, so it
// cannot drift again as stage 3 adds sections.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const committedMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site_meta.json'), 'utf8'));

/**
 * Mocks BOTH sources of site metadata.
 *
 * As of the post-v0.11 fix, hub pages read the site_meta table and fall back
 * to data/site_meta.json only if that fails. Mocking the file alone would
 * leave the real database answering, so these tests would assert against
 * production data.
 *
 * The trailing * on the route matters: fetchJson appends a cache-buster, so a
 * pattern without it never matches.
 */
async function mockSiteMeta(page, meta) {
    await page.route('**/data/site_meta.json*', route => route.fulfill({ json: meta }));

    await page.addInitScript((meta) => {
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
                            if (table !== 'site_meta') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                limit() { return chain; },
                                // The table's column is game_info; the JSON
                                // file's key is gameInfo. Same data, and the
                                // renderer normalises both.
                                maybeSingle: async () => ({
                                    data: { hubs: meta.hubs, game_info: meta.gameInfo },
                                    error: null,
                                }),
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, meta);
}

test.describe('homepage table of contents', () => {
    test('is built from the real sections, including the one that had drifted', async ({ page }) => {
        await page.goto('/index.html', { waitUntil: 'networkidle' });

        const toc = page.locator('#dynamic-toc');
        await expect(toc).toHaveCount(1);
        await expect(toc.locator('a').first()).toBeVisible();

        const labels = await toc.locator('a').allTextContents();
        const joined = labels.join(' | ');

        // The entry that was missing from the hardcoded list.
        expect(joined).toContain('From the Blog');
        // And the two sections that had no id at all, so could never appear.
        expect(joined).toContain('Game Info');
        expect(joined).toContain('Credits');
    });

    test('entry labels exclude controls nested inside a heading', async ({ page }) => {
        // The Characters heading contains a "View More" link. Without the
        // label fix in refreshTOC the entry reads "Characters View More ➔".
        await page.goto('/index.html', { waitUntil: 'networkidle' });

        const labels = await page.locator('#dynamic-toc a').allTextContents();
        const characters = labels.find(l => l.includes('Characters'));
        expect(characters).toBeTruthy();
        expect(characters).not.toContain('View More');
    });

    test('every entry points at a target that exists', async ({ page }) => {
        await page.goto('/index.html', { waitUntil: 'networkidle' });

        const hrefs = await page.locator('#dynamic-toc a').evaluateAll(
            els => els.map(el => el.getAttribute('href')).filter(h => h && h.startsWith('#'))
        );
        expect(hrefs.length).toBeGreaterThan(4);

        for (const href of hrefs) {
            await expect(page.locator(href), `${href} has no target`).toHaveCount(1);
        }
    });
});

test.describe('editable section headings', () => {
    test('site_meta text replaces the static heading', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.hubs['main-hub'].headings.about = 'Who We Are';
        meta.hubs['main-hub'].headings.blog = 'Latest Writing';
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('[data-heading-key="about"]')).toHaveText('Who We Are');
        await expect(page.locator('[data-heading-key="blog"]')).toHaveText('Latest Writing');
    });

    test('a renamed heading is what the ToC indexes', async ({ page }) => {
        // Ordering contract: headings must land before refreshTOC runs, or the
        // sidebar and the page disagree.
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.hubs['main-hub'].headings.faq = 'Common Questions';
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        const labels = await page.locator('#dynamic-toc a').allTextContents();
        expect(labels.join(' | ')).toContain('Common Questions');
    });

    test('renaming never destroys a control nested in the heading', async ({ page }) => {
        // data-heading-key sits on a span inside the Characters <h2>, because
        // setting textContent on the <h2> would delete the "View More" link.
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.hubs['main-hub'].headings.roster = 'The Roster';
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('[data-heading-key="roster"]')).toHaveText('The Roster');
        await expect(page.locator('#roster-section a.btn-ghost')).toBeVisible();
    });

    test('a missing or blank heading keeps the static text', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.hubs['main-hub'].headings = { about: '   ' };   // blank, and the rest absent
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('[data-heading-key="about"]')).toHaveText('About Us');
        await expect(page.locator('[data-heading-key="credits"]')).toHaveText('Credits');
    });

    test('headings are set as text, never as markup', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.hubs['main-hub'].headings.credits = '<img src=x onerror=window.__xss=1>';
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        await expect(page.locator('[data-heading-key="credits"]')).toContainText('<img');
    });
});

test.describe('Game Info panel', () => {
    test('renders fields and links from site_meta', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.gameInfo.fields = [{ label: 'Developers', value: 'New Studio', subtext: '(someone else)' }];
        meta.gameInfo.links = [{ name: 'Fresh Discord', url: 'https://discord.gg/rotated' }];
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        const panel = page.locator('#game-info-fields');
        await expect(panel).toContainText('New Studio');
        await expect(panel).toContainText('(someone else)');
        await expect(panel.locator('a')).toHaveAttribute('href', 'https://discord.gg/rotated');
        // The old hardcoded invite must be gone, not merely appended to.
        await expect(panel).not.toContainText('nyTYVCDMBF');
    });

    test('keeps the static panel when site_meta has no game info', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.gameInfo = { fields: [], links: [] };
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('#game-info-fields')).toContainText("Tze's Shenanigans");
    });

    test('refuses a non-http link scheme', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.gameInfo.links = [{ name: 'Trap', url: 'javascript:window.__xss=1' }];
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('#game-info-fields a')).toHaveAttribute('href', '#');
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('escapes hostile field text', async ({ page }) => {
        const meta = JSON.parse(JSON.stringify(committedMeta));
        meta.gameInfo.fields = [{ label: 'X', value: '<img src=x onerror=window.__xss=1>' }];
        await mockSiteMeta(page, meta);

        await page.goto('/index.html', { waitUntil: 'networkidle' });
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
});
