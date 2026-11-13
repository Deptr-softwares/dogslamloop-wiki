// The Halloween event (2026-10-23 to November 1) was removed on 2026-11-13,
// owner: "Yes you can remove them now. Don't remove the badges though". The
// badges keep their own tests in tests/user-badges.spec.js.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.claude']);

function htmlFiles(dir = ROOT) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        if (SKIP.has(e.name)) return [];
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return htmlFiles(full);
        return e.name.endsWith('.html') ? [full] : [];
    });
}

test('no page, and nothing the generator writes, loads the Halloween event any more', () => {
    const pages = htmlFiles().filter(f => !f.includes(`${path.sep}katana-move${path.sep}`));
    expect(pages.length, 'the scan found the site').toBeGreaterThan(20);

    const loading = pages
        .filter(f => /halloween\.(js|css)/.test(fs.readFileSync(f, 'utf8')))
        .map(f => path.relative(ROOT, f));
    expect(loading).toEqual([]);

    const generator = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-pages.js'), 'utf8');
    expect(generator).not.toMatch(/halloween\.(js|css)/);
});

test('the Update Log shows every entry, even on a day the event was running', async ({ page }) => {
    // The Halloween entry used to stay hidden until a reader had played the
    // minigame, which no one can now.
    await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
    await page.goto('/systems/updatelog/index.html', { waitUntil: 'domcontentloaded' });

    const logs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'updates.json'), 'utf8')).changelogs;
    await expect(page.locator('#changelog-container > section')).toHaveCount(logs.length);
});
