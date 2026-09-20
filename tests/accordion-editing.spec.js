// Two accordion bugs the owner found by using the editor (2026-09-20).
//
//   A. "the preview panel keeps resetting (intended) and closing the
//      accordion, which is very annoying when trying to edit the content
//      inside the accordion"
//
//   B. "alignment is broken inside accordion - it simply doesn't align in the
//      middle or right, it keeps aligning on the left side"
//
// They look unrelated and are both about the same thing: an accordion is a
// CONTAINER, and this site's two layout mechanisms - DOM state and floats -
// each stop working when something re-renders around them or lays them out
// differently inside them.
//
// Both matter beyond the accordion. C3's SectionedBox is another container
// holding blocks with an open/closed state, so it inherits both on day one
// unless it is built against these tests. The owner asked for exactly that.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';
const IMG = '/medias/portraits/boomcat.webp';

const media = (align) => ({ type: 'image', src: IMG, alt: align, align, width: '25%' });

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

// --- A: THE PREVIEW REPAINT ---

test('an open accordion survives the preview repaint', async ({ page }) => {
    await boot(page);

    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'preview-host';
        document.body.appendChild(host);
    });

    const render = () => page.evaluate(() => {
        window.populateTextSection('preview-host', '', [
            { type: 'accordion', title: 'First', content: [{ type: 'paragraph', content: 'a' }] },
            { type: 'accordion', title: 'Second', content: [{ type: 'paragraph', content: 'b' }] },
        ], '');
    });

    await render();
    // The author opens the one they are working inside.
    await page.evaluate(() => { document.querySelectorAll('#preview-host details')[1].open = true; });

    // Every keystroke does this.
    await render();

    const state = await page.evaluate(() =>
        [...document.querySelectorAll('#preview-host details')].map(d => d.open));

    expect(state, 'the open one is still open, the closed one still closed').toEqual([false, true]);
});

test('the repaint never opens an accordion the author had closed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'preview-host';
        document.body.appendChild(host);
    });

    const render = () => page.evaluate(() => {
        window.populateTextSection('preview-host', '', [
            { type: 'accordion', title: 'Only', content: [{ type: 'paragraph', content: 'a' }] },
        ], '');
    });

    await render();
    await render();

    // Restoring state must only ever re-OPEN. A section that has just appeared
    // keeps the markup's own default rather than inheriting a neighbour's.
    expect(await page.evaluate(() =>
        document.querySelector('#preview-host details').open)).toBe(false);
});

// --- B: ALIGNMENT INSIDE THE CONTAINER ---

// Structural, not pixels: "is it nearer the right edge than the left one" holds
// on any platform, where a gap measured in px would not.
async function gaps(page, scopeSel) {
    return page.evaluate((sel) => {
        const scope = document.querySelector(sel);
        return [...scope.querySelectorAll('.wiki-media')].map(el => {
            const r = el.getBoundingClientRect();
            const pr = el.parentElement.getBoundingClientRect();
            return {
                align: el.getAttribute('alt') || el.querySelector('img')?.getAttribute('alt'),
                left: Math.round(r.left - pr.left),
                right: Math.round(pr.right - r.right),
            };
        });
    }, scopeSel);
}

test('media inside an accordion aligns the way it does outside one', async ({ page }) => {
    await boot(page);

    // One image per accordion. Floats interact with the content that follows
    // them - that is what a float IS - so three in one box measures the
    // interaction rather than the alignment, and does so identically inside an
    // accordion and outside one. Isolating them asks only this file's question.
    await page.evaluate((blocks) => {
        const host = document.createElement('div');
        host.id = 'align-host';
        host.style.width = '800px';
        document.body.appendChild(host);
        host.innerHTML = window.generateHTMLForBlocks(blocks, '');
        document.querySelectorAll('#align-host details').forEach(d => { d.open = true; });
    }, ['left', 'center', 'right'].map(a => ({
        type: 'accordion', title: a, content: [media(a)],
    })));
    await page.waitForTimeout(400);

    const inside = await page.evaluate(() =>
        [...document.querySelectorAll('#align-host .wiki-accordion-body')].map(body => {
            const el = body.querySelector('.wiki-media');
            const r = el.getBoundingClientRect();
            const pr = body.getBoundingClientRect();
            return {
                align: el.getAttribute('alt') || el.querySelector('img')?.getAttribute('alt'),
                left: Math.round(r.left - pr.left),
                right: Math.round(pr.right - r.right),
            };
        }));
    const byAlign = Object.fromEntries(inside.map(m => [m.align, m]));

    // The bug: float is ignored on a flex item, so Right rendered hard left
    // while Centre survived on margin:auto alone. Measured at 800px before the
    // fix, the right-aligned image sat 40px from the left edge.
    expect(byAlign.right.left, 'right-aligned sits in the right half').toBeGreaterThan(byAlign.right.right);
    expect(byAlign.left.left, 'left-aligned sits in the left half').toBeLessThan(byAlign.left.right);
    // Centre is within a pixel of both edges - it is the one that already
    // worked, and it has to keep working.
    expect(Math.abs(byAlign.center.left - byAlign.center.right)).toBeLessThanOrEqual(2);
});

test('the accordion body does not lay its blocks out as a flex column', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'align-host';
        document.body.appendChild(host);
        host.innerHTML = window.generateHTMLForBlocks([{
            type: 'accordion', title: 'Inside', content: [{ type: 'paragraph', content: 'a' }],
        }], '');
    });

    // Stated directly, because it is the CAUSE rather than a symptom, and the
    // next person to reach for `display:flex; gap` here needs to fail loudly
    // rather than silently break every floated image in the site's accordions.
    const display = await page.evaluate(() =>
        getComputedStyle(document.querySelector('#align-host .wiki-accordion-body')).display);

    expect(display).not.toBe('flex');
});

test('a float inside an accordion does not escape its own box', async ({ page }) => {
    await boot(page);
    await page.evaluate((blocks) => {
        const host = document.createElement('div');
        host.id = 'align-host';
        host.style.width = '800px';
        document.body.appendChild(host);
        host.innerHTML = window.generateHTMLForBlocks(blocks, '');
        document.querySelectorAll('#align-host details').forEach(d => { d.open = true; });
    }, [{ type: 'accordion', title: 'Inside', content: [media('right')] }]);
    await page.waitForTimeout(400);

    // Restoring floats brings back the reason flex was tempting: without the
    // clearfix, a float at the end of the body hangs out of the bottom of it.
    const fits = await page.evaluate(() => {
        const body = document.querySelector('#align-host .wiki-accordion-body');
        const img = body.querySelector('.wiki-media');
        return {
            bodyBottom: Math.round(body.getBoundingClientRect().bottom),
            mediaBottom: Math.round(img.getBoundingClientRect().bottom),
        };
    });

    expect(fits.mediaBottom).toBeLessThanOrEqual(fits.bodyBottom);
});
