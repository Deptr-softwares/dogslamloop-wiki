// v1.1 batch 9: the site's two fonts load as WOFF2.
//
// Common.css lists WOFF2 first and keeps the TTF as a fallback, so a browser
// that can read WOFF2 must never fetch the TTF. A WOFF2 file the browser
// cannot decode also falls through to the TTF, which is why "no TTF request"
// is the check: it fails for a wrong order and for a broken file alike.
const { test, expect } = require('@playwright/test');

const FAMILIES = ['Finger-Paint', 'CC-Wild-Words'];

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
