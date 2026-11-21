// site_utils.js in four parts (owner, 2026-11-22): site_utils.js, then
// site_data.js, site_media.js and site_account.js, by job. They were one file,
// so every page that loads the first must load all four, together, in that
// order, the same way (defer or not). A page missing one still renders and
// breaks only where it calls a missing piece: signing in, a badge, an approved
// edit. The order keeps every top-level statement running in the order it
// always has.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PARTS = ['site_utils.js', 'site_data.js', 'site_media.js', 'site_account.js'];
const PAGES = execSync('git ls-files -- "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);

// Every script tag on a page, as the file it names under js/utility/ (or
// null) and the tag with its path and stamp taken out.
const tagsOf = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"[^>]*><\/script>/g)].map(m => {
    const part = (m[1].match(/js\/utility\/(site_[a-z]+\.js)/) || [])[1] || null;
    return { part, shape: m[0].replace(m[1], '') };
});

test('every page that loads site_utils.js loads all four parts, in order, the same way', () => {
    const wrong = [];
    let pages = 0;
    for (const page of PAGES) {
        const tags = tagsOf(fs.readFileSync(path.join(ROOT, page), 'utf8'));
        const at = tags.findIndex(t => t.part === 'site_utils.js');
        const anyPart = tags.some(t => PARTS.includes(t.part));
        if (at === -1) {
            if (anyPart) wrong.push(`${page}: loads a part without site_utils.js`);
            continue;
        }
        pages++;
        const run = tags.slice(at, at + PARTS.length);
        if (run.map(t => t.part).join() !== PARTS.join()) {
            wrong.push(`${page}: ${run.map(t => t.part || '(other)').join(', ')}`);
        } else if (new Set(run.map(t => t.shape)).size !== 1) {
            wrong.push(`${page}: the four tags are not written the same way`);
        }
        if (tags.filter(t => PARTS.includes(t.part)).length !== PARTS.length) wrong.push(`${page}: a part loads twice`);
    }
    expect(pages, 'pages that load site_utils.js were read').toBeGreaterThan(0);
    expect(wrong).toEqual([]);
});

test('a page runs with all four parts and none of them fails to load', async ({ page }) => {
    // One global from each part, read on a real page.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/history.html');
    const present = await page.evaluate(() => ({
        utils: typeof window.escapeHtml,
        data: typeof window.applyDeltaToData,
        media: typeof window.applyMediaFraming,
        account: typeof window.checkActiveSession,
    }));
    expect(present).toEqual({ utils: 'function', data: 'function', media: 'function', account: 'function' });
    expect(errors).toEqual([]);
});
