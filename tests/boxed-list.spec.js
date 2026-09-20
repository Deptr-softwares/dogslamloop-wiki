// Box-in a list - v0.19 C7.
//
// The owner's whole spec, written in the v0.15 list and carried unchanged
// through v0.16, v0.17 and v0.18 without ever being in an ordered list:
//
//     9. Box-in a list - visual only, a sleek clean border around the list.
//
// "Visual only" is the load-bearing half. A boxed list is the same list: same
// items, same order, same alignment, same credit. Everything below that is not
// about the border is there to hold that line.
//
// OPT-IN, not applied to every list. The wiki already has hundreds of them, and
// turning them all into boxes is a decision about existing pages rather than an
// option on a new one - so an unboxed list has to keep rendering exactly as it
// did, which is what the first test checks.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';
const ITEMS = ['Punish the landing', 'Bait the reversal', 'Take the corner'];

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

async function render(page, blocks) {
    await page.evaluate((b) => {
        let host = document.getElementById('render-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'render-host';
            document.body.appendChild(host);
        }
        host.innerHTML = window.generateHTMLForBlocks(b, '');
    }, blocks);
}

test('an ordinary list is untouched', async ({ page }) => {
    await boot(page);
    await render(page, [{ type: 'list', items: ITEMS, align: 'left' }]);

    const out = await page.evaluate(() => {
        const ul = document.querySelector('#render-host .wiki-block-list');
        const cs = getComputedStyle(ul);
        return {
            boxed: ul.classList.contains('wiki-block-list-boxed'),
            border: cs.borderTopWidth,
            items: [...ul.querySelectorAll('li')].map(li => li.textContent),
        };
    });

    expect(out.boxed).toBe(false);
    expect(out.border, 'no border on a list nobody asked to box').toBe('0px');
    expect(out.items).toEqual(ITEMS);
});

test('a boxed list gets a real border, read back from the browser', async ({ page }) => {
    await boot(page);
    await render(page, [{ type: 'list', items: ITEMS, align: 'left', boxed: true }]);

    // The class is not the claim. An earlier bug in this project shipped nine
    // passing tests against a classList while the page was visibly wrong, so
    // this asks what was actually painted.
    const out = await page.evaluate(() => {
        const ul = document.querySelector('#render-host .wiki-block-list');
        const cs = getComputedStyle(ul);
        const probe = document.createElement('span');
        probe.style.color = 'var(--border-color)';
        document.body.appendChild(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        return {
            borderWidth: parseFloat(cs.borderTopWidth),
            borderStyle: cs.borderTopStyle,
            borderColour: cs.borderTopColor,
            token,
            background: cs.backgroundColor,
        };
    });

    expect(out.borderWidth).toBeGreaterThan(0);
    expect(out.borderStyle).toBe('solid');
    // Compared against the resolved token rather than a hex, so the test
    // follows the palette instead of pinning it.
    expect(out.borderColour).toBe(out.token);
    expect(out.background).not.toBe('rgba(0, 0, 0, 0)');
});

test('the box is visual only - the list is the same list', async ({ page }) => {
    await boot(page);
    await render(page, [
        { type: 'list', items: ITEMS, align: 'right', author: 'Deptr' },
        { type: 'list', items: ITEMS, align: 'right', author: 'Deptr', boxed: true },
    ]);

    // Everything except the border has to match. "Visual only" is the spec, and
    // this is the assertion that holds it - a box that quietly reordered,
    // re-aligned or dropped the credit would still look right.
    const out = await page.evaluate(() => {
        const [plain, boxed] = [...document.querySelectorAll('#render-host .wiki-block-list')];
        const read = (ul) => ({
            items: [...ul.querySelectorAll('li')].map(li => li.textContent),
            align: getComputedStyle(ul).textAlign,
            tag: ul.tagName,
            markers: getComputedStyle(ul).listStyleType,
        });
        return { plain: read(plain), boxed: read(boxed) };
    });

    expect(out.boxed).toEqual(out.plain);
});

test('the bullets sit inside the box, not on its border', async ({ page }) => {
    await boot(page);
    await render(page, [{ type: 'list', items: ITEMS, boxed: true }]);

    // A marker hanging over the border is the thing that stops it reading as
    // clean, which is the one adjective the spec gives. Structural: the item's
    // left edge is inside the box, whatever the padding happens to be.
    const out = await page.evaluate(() => {
        const ul = document.querySelector('#render-host .wiki-block-list');
        const li = ul.querySelector('li');
        return {
            listLeft: ul.getBoundingClientRect().left,
            itemLeft: li.getBoundingClientRect().left,
            paddingLeft: parseFloat(getComputedStyle(ul).paddingLeft),
        };
    });

    expect(out.paddingLeft).toBeGreaterThan(16);
    expect(out.itemLeft).toBeGreaterThan(out.listLeft);
});

test('the editor offers it, and a new list is not boxed', async ({ page }) => {
    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });

    await page.evaluate(() => {
        document.body.innerHTML = '<div id="block-host"></div>';
        window.activeAccordionPath = [];
        window.initStrategyBlockBuilder('block-host', [window.spawnBlockWithAuthor('list')]);
        (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
        window.renderBlockList();
    });

    const box = page.locator('[data-field="boxed"]');
    await expect(box).toHaveCount(1);
    await expect(box, 'a list is not boxed until somebody says so').not.toBeChecked();

    await box.check();
    expect(await page.evaluate(() => window.getActiveBlocks()[0].boxed)).toBe(true);
});
