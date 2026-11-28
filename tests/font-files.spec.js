// v1.1 batch 9: the site's two fonts load as WOFF2.
//
// Common.css lists WOFF2 first and keeps the TTF as a fallback, so a browser
// that can read WOFF2 must never fetch the TTF. A WOFF2 file the browser
// cannot decode also falls through to the TTF, which is why "no TTF request"
// is the check: it fails for a wrong order and for a broken file alike.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FAMILIES = ['Finger-Paint', 'CC-Wild-Words'];

// The faces are named once, as --face-finger-paint and --face-wild-words in
// Common.css, and the fonts point at them, so a look or a reader's font setting can
// swap them. A rule that names a face itself would keep it whatever was picked.
test('no stylesheet names the two faces except through their variables', () => {
    const files = [];
    (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.css')) files.push(full);
        }
    })(path.join(__dirname, '..', 'style'));

    const offenders = [];
    for (const file of files) {
        const css = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/@font-face\s*\{[^}]*\}/g, '')
            .replace(/--face-(finger-paint|wild-words)\s*:[^;]*;/g, '');
        for (const family of FAMILIES) {
            if (css.includes(family)) offenders.push(`${path.basename(file)}: ${family}`);
        }
    }
    expect(offenders).toEqual([]);
    expect(files.length, 'the scan found the stylesheets').toBeGreaterThan(10);
});

test('the default look still sets titles in Finger-Paint and labels in CC-Wild-Words', async ({ page }) => {
    await page.goto('/index.html');
    const fonts = await page.evaluate(() => ({
        title: getComputedStyle(document.documentElement).getPropertyValue('--font-title').trim(),
        label: getComputedStyle(document.documentElement).getPropertyValue('--font-label').trim(),
    }));
    expect(fonts).toEqual({ title: "'Finger-Paint'", label: "'CC-Wild-Words'" });
});

test('both fonts load from their WOFF2 files, and the TTFs are never fetched', async ({ page }) => {
    const fonts = [];
    page.on('request', r => { if (r.resourceType() === 'font') fonts.push(decodeURIComponent(r.url())); });

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    const loaded = await page.evaluate(async (families) => {
        const out = {};
        for (const family of families) {
            const faces = await document.fonts.load(`16px '${family}'`);
            out[family] = faces.map(f => f.status);
        }
        return out;
    }, FAMILIES);

    for (const family of FAMILIES) expect(loaded[family], family).toEqual(['loaded']);
    expect(fonts.filter(u => u.includes('/fonts/'))).toEqual(expect.arrayContaining([
        expect.stringContaining('/fonts/FingerPaint-Regular.woff2'),
        expect.stringContaining('/fonts/CC Wild Words Roman.woff2'),
    ]));
    expect(fonts.filter(u => u.endsWith('.ttf'))).toEqual([]);
});
