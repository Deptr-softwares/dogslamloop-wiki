/**
 * Re-encodes an image as a WebP no larger than maxSide on its longest side.
 * Shared by the two mirrors that keep oversized uploads off the site:
 * scripts/fetch-portraits.js and scripts/fetch-banners.js. The tool is the
 * Chromium that Playwright already installs for the tests and the
 * regeneration job, so nothing new is added. The original in Storage is
 * untouched; only the mirror is smaller.
 */

// RIFF....WEBP: the bytes, not the name. Both oversized portraits in 2026-11
// were PNGs called .webp.
function isWebp(buf) {
    return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
}

// One browser for the run, started the first time an image needs it, so a
// night with nothing to shrink never starts one.
let browser = null;

async function shrinkToWebp(buf, maxSide) {
    if (!browser) browser = await require('playwright').chromium.launch();
    const page = await browser.newPage();
    try {
        const out = await page.evaluate(async ({ data, maxSide }) => {
            const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([bytes]));
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, width, height);
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
            // A browser that cannot write WebP hands back a PNG instead.
            if (blob.type !== 'image/webp') throw new Error(`the browser wrote ${blob.type}, not image/webp`);
            const view = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
            return btoa(binary);
        }, { data: buf.toString('base64'), maxSide });
        return Buffer.from(out, 'base64');
    } finally {
        await page.close();
    }
}

async function closeShrinker() {
    if (browser) await browser.close();
    browser = null;
}

module.exports = { isWebp, shrinkToWebp, closeShrinker };
