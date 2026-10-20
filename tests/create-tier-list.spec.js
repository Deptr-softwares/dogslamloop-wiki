// Create Tier List (v1.1). Any visitor ranks the roster and copies the result
// as an image; nothing is sent anywhere.
//
// The owner's calls this file holds the tool to: drag-and-drop, with tier
// names and colours customisable (v0.15, 2026-08-15); the image goes to the
// clipboard, not a download (2026-08-16), with a download only when the
// browser cannot copy one; an optional title and a small faint
// dogslamloop.com on the image (2026-10-20). Tap-to-place for phones, S to F in
// Free Submit's colours and the list kept on the device were mine, written
// back and kept.
//
// Characters are read from data/navigation.json rather than named, so the
// owner adding or renaming one never breaks this file. One is marked hidden
// through the route, so the hidden rule is tested whether or not the live
// roster has a hidden character today.
const { test, expect } = require('@playwright/test');

const PAGE = '/tools/create-tier-list/index.html';
const NAV = require('../data/navigation.json');
const ROSTER = (NAV.Characters || [])
    .filter(e => e.cms_config && e.cms_config.pageId && !e.isHidden)
    .map(e => ({ id: e.cms_config.pageId, name: e.name }));
const HIDDEN = ROSTER[0].id;
const VISIBLE = ROSTER.slice(1);
const [X, Y, Z] = VISIBLE;
// Which characters have art is owner content too: read, never listed.
const PORTRAITS = require('../data/portraits.json');
const WITH_PORTRAIT = VISIBLE.find(c => PORTRAITS[c.id]);

// Free Submit's scale, from its migration.
const DEFAULT_COLOURS = ['hsl(0, 80%, 60%)', 'hsl(30, 80%, 60%)', 'hsl(60, 80%, 60%)',
    'hsl(120, 60%, 60%)', 'hsl(210, 80%, 60%)', 'hsl(300, 80%, 60%)'];

async function boot(page, { width = 1400, height = 1700 } = {}) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    // Served from the file rather than through route.fetch, which can dial
    // ::1 while the test server listens on IPv4 only (seen 2026-10-21).
    await page.route('**/data/navigation.json*', route => {
        const nav = JSON.parse(JSON.stringify(NAV));
        nav.Characters.forEach(e => { if (e.cms_config && e.cms_config.pageId === HIDDEN) e.isHidden = true; });
        return route.fulfill({ json: nav });
    });
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-mk-pool] .mk-entry').first()).toBeVisible({ timeout: 20000 });
    return errors;
}

const ids = (locator) => locator.evaluateAll(nodes => nodes.map(n => n.dataset.character));
const tier = (page, i) => ids(page.locator(`.mk-body[data-zone="${i}"] .mk-entry`));
const pool = (page) => ids(page.locator('[data-mk-pool] .mk-entry'));
const entry = (page, id) => page.locator(`.mk-entry[data-character="${id}"]`);
const label = (page, i) => page.locator(`.mk-label[data-zone="${i}"]`);
const labels = (page) => page.locator('.mk-label').allTextContents();
const status = (page) => page.locator('[data-mk-status]');

function resolveColour(page, colour) {
    return page.evaluate((c) => {
        const probe = document.createElement('span');
        probe.style.color = c;
        document.body.appendChild(probe);
        const out = getComputedStyle(probe).color;
        probe.remove();
        return out;
    }, colour);
}

const background = (locator) => locator.evaluate(el => getComputedStyle(el).backgroundColor);

async function drag(page, from, to, at) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
    const x = at === 'end' ? b.x + b.width - 20 : b.x + b.width / 2;
    await page.mouse.move(x, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
}

async function tapPlace(page, id, zone) {
    await entry(page, id).click();
    if (zone === 'pool') await page.locator('[data-mk-pool]').click({ position: { x: 5, y: 5 } });
    else await label(page, zone).click();
}

test('starts S to F in Free Submit\'s colours, with everyone visible waiting and hidden characters left out', async ({ page }) => {
    const errors = await boot(page);

    expect(await labels(page)).toEqual(['S', 'A', 'B', 'C', 'D', 'F']);
    for (const [i, colour] of DEFAULT_COLOURS.entries()) {
        expect(await background(label(page, i)), `tier ${i}`).toBe(await resolveColour(page, colour));
    }

    expect(await pool(page)).toEqual(VISIBLE.map(c => c.id));
    await expect(entry(page, HIDDEN)).toHaveCount(0);
    await expect(page.locator('[data-mk-pool-count]')).toHaveText(`(${VISIBLE.length})`);

    // The portraits are the site's own mirror: the image export depends on it.
    const src = await entry(page, X.id).locator('img').getAttribute('src');
    expect(src).toContain('medias/portraits/');
    expect(errors).toEqual([]);
});

test('a character dragged with the mouse lands in the tier, before the one it is dropped on, and back out', async ({ page }) => {
    const errors = await boot(page);
    const bodyS = page.locator('.mk-body[data-zone="0"]');

    await drag(page, entry(page, X.id), bodyS, 'end');
    expect(await tier(page, 0)).toEqual([X.id]);
    expect(await pool(page)).not.toContain(X.id);

    await drag(page, entry(page, Y.id), bodyS, 'end');
    expect(await tier(page, 0)).toEqual([X.id, Y.id]);

    // Dropped on a character: in front of it.
    await drag(page, entry(page, Z.id), entry(page, X.id));
    expect(await tier(page, 0)).toEqual([Z.id, X.id, Y.id]);

    // Across tiers, onto the label.
    await drag(page, entry(page, X.id), label(page, 2));
    expect(await tier(page, 0)).toEqual([Z.id, Y.id]);
    expect(await tier(page, 2)).toEqual([X.id]);

    // And back to the pool, in roster order again.
    await drag(page, entry(page, X.id), page.locator('[data-mk-pool]'));
    expect(await tier(page, 2)).toEqual([]);
    expect((await pool(page)).indexOf(X.id)).toBe(0);

    // A drag is not a tap: nothing is left picked up, even by a drag let go
    // over the character it started on, where the click lands on it.
    const box = await entry(page, Y.id).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await tier(page, 0)).toEqual([Z.id, Y.id]);
    await expect(page.locator('.mk-entry[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.tier-portrait-ghost')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('tap a character, then a tier; tap a character to place before it; tap again to put it down', async ({ page }) => {
    const errors = await boot(page);

    await label(page, 0).click();
    await expect(status(page)).toHaveText('Pick a character first, then tap a tier.');

    await entry(page, X.id).click();
    await expect(entry(page, X.id)).toHaveAttribute('aria-pressed', 'true');
    await expect(status(page)).toContainText(`Picked up ${X.name}.`);
    await label(page, 1).click();
    expect(await tier(page, 1)).toEqual([X.id]);
    await expect(entry(page, X.id)).toHaveAttribute('aria-pressed', 'false');
    await expect(entry(page, X.id), 'focus follows the character').toBeFocused();

    await entry(page, Y.id).click();
    await entry(page, X.id).click();
    expect(await tier(page, 1)).toEqual([Y.id, X.id]);

    // Tapped twice, it is put down where it was, not moved to the end.
    await entry(page, Y.id).click();
    await entry(page, Y.id).click();
    await expect(entry(page, Y.id)).toHaveAttribute('aria-pressed', 'false');
    expect(await tier(page, 1)).toEqual([Y.id, X.id]);

    // The keyboard is the same path: entries and labels are buttons.
    await entry(page, Z.id).focus();
    await page.keyboard.press('Enter');
    await label(page, 3).focus();
    await page.keyboard.press('Enter');
    expect(await tier(page, 3)).toEqual([Z.id]);

    // Escape puts down whatever is picked up.
    await entry(page, Y.id).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mk-entry[aria-pressed="true"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a phone taps, and the board fits the screen', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await boot(page, { width: 390, height: 844 });

    await entry(page, X.id).tap();
    await label(page, 0).tap();
    expect(await tier(page, 0)).toEqual([X.id]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
    await context.close();
});

test('renaming a tier changes its label as you type, and the field keeps the caret', async ({ page }) => {
    await boot(page);
    const name = page.locator('.mk-control-name').first();
    await name.fill('');
    await name.focus();
    await page.keyboard.type('Top');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Top');
    await expect(label(page, 0)).toHaveText('Top');

    // A long name gets the small size, not a label wider than its box.
    await page.keyboard.type(' of the world');
    const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('.mk-label'))
        .slice(0, 2).map(l => parseFloat(getComputedStyle(l).fontSize)));
    expect(sizes[0]).toBeLessThan(sizes[1]);
    const fits = await label(page, 0).evaluate(l => l.scrollWidth <= l.clientWidth);
    expect(fits).toBe(true);
});

test('a tier colour comes from the palette or a hex', async ({ page }) => {
    await boot(page);
    const swatch = page.locator('.mk-color-swatch').nth(1);
    const popup = page.locator('.mk-color-popup').nth(1);

    await expect(popup).toBeHidden();
    await swatch.click();
    await expect(popup).toBeVisible();
    await popup.locator('.mk-palette-swatch[data-color="hsl(180, 70%, 55%)"]').click();
    await expect(popup).toBeHidden();
    expect(await background(label(page, 1))).toBe(await resolveColour(page, 'hsl(180, 70%, 55%)'));

    await swatch.click();
    await popup.locator('.mk-hex').fill('zz');
    await popup.locator('.mk-hex-use').click();
    await expect(status(page)).toHaveText('"zz" is not a colour. Use a hex like #ff8800.');
    expect(await background(label(page, 1))).toBe(await resolveColour(page, 'hsl(180, 70%, 55%)'));

    await popup.locator('.mk-hex').fill('123456');
    await popup.locator('.mk-hex').press('Enter');
    expect(await background(label(page, 1))).toBe('rgb(18, 52, 86)');
    expect(await background(swatch)).toBe('rgb(18, 52, 86)');

    // A click anywhere else puts the palette away.
    await swatch.click();
    await page.locator('[data-mk-title]').click();
    await expect(popup).toBeHidden();
});

test('tiers are added, moved and removed, and a removed tier\'s characters go back to waiting', async ({ page }) => {
    await boot(page);
    await tapPlace(page, X.id, 0);

    await page.locator('[data-mk-action="down"][data-tier="0"]').click();
    expect(await labels(page)).toEqual(['A', 'S', 'B', 'C', 'D', 'F']);
    expect(await tier(page, 1)).toEqual([X.id]);

    await page.locator('[data-mk-action="remove"][data-tier="1"]').click();
    expect(await labels(page)).toEqual(['A', 'B', 'C', 'D', 'F']);
    expect(await pool(page)).toContain(X.id);

    await page.locator('[data-mk-action="add"]').click();
    expect(await labels(page)).toEqual(['A', 'B', 'C', 'D', 'F', 'New']);
    const newName = page.locator('.mk-control-name').last();
    await expect(newName).toBeFocused();
    await page.keyboard.type('Z');
    await expect(label(page, 5)).toHaveText('Z');

    // At most twelve, and never none.
    for (let n = 6; n < 12; n++) await page.locator('[data-mk-action="add"]').click();
    await expect(page.locator('.mk-label')).toHaveCount(12);
    await expect(page.locator('[data-mk-action="add"]')).toBeDisabled();
    while (await page.locator('.mk-label').count() > 1) {
        await page.locator('[data-mk-action="remove"]').first().click();
    }
    await expect(page.locator('[data-mk-action="remove"]')).toBeDisabled();
});

test('the list comes back after a reload, title, names and colours included', async ({ page }) => {
    await boot(page);
    await tapPlace(page, X.id, 0);
    await tapPlace(page, Y.id, 0);
    await tapPlace(page, Z.id, 4);
    await page.locator('[data-mk-title]').fill('My list');
    await page.locator('.mk-control-name').nth(2).fill('Mid');
    await page.locator('.mk-color-swatch').nth(2).click();
    await page.locator('.mk-color-popup').nth(2).locator('.mk-hex').fill('#123456');
    await page.locator('.mk-color-popup').nth(2).locator('.mk-hex').press('Enter');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.mk-entry').first()).toBeVisible({ timeout: 20000 });
    expect(await tier(page, 0)).toEqual([X.id, Y.id]);
    expect(await tier(page, 4)).toEqual([Z.id]);
    await expect(page.locator('[data-mk-title]')).toHaveValue('My list');
    expect(await labels(page)).toEqual(['S', 'A', 'Mid', 'C', 'D', 'F']);
    expect(await background(label(page, 2))).toBe('rgb(18, 52, 86)');
    await expect(page.locator('[data-mk-storage-note]')).toBeHidden();
});

test('a saved list is cut back to what can be drawn, and its text stays text', async ({ page }) => {
    await page.addInitScript(([hidden, x]) => {
        localStorage.setItem('dsl_create_tier_list', JSON.stringify({
            v: 1,
            title: '<img src=x onerror="window.__PWN=1">',
            tiers: [
                { name: '<img src=x onerror=1>', color: 'url(javascript:alert(1))', characters: ['gone_character', hidden, x, x, 7] },
                { name: 'A'.repeat(30), color: '#00ff00', characters: [x] },
            ],
        }));
    }, [HIDDEN, X.id]);
    const errors = await boot(page);

    expect(await tier(page, 0)).toEqual([X.id]);
    expect(await tier(page, 1)).toEqual([]);
    await expect(entry(page, HIDDEN)).toHaveCount(0);
    await expect(label(page, 0)).toHaveText('<img src=x onerror=1>');
    await expect(label(page, 1), 'cut to the 24 a tier name allows').toHaveText('A'.repeat(24));
    await expect(page.locator('.mk-tool img[src="x"]')).toHaveCount(0);
    await expect(page.locator('[data-mk-title]')).toHaveValue('<img src=x onerror="window.__PWN=1">');
    // An unusable colour falls back rather than leaving the label bare.
    expect(await background(label(page, 0))).toBe(await resolveColour(page, 'hsl(0, 0%, 75%)'));
    expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('a browser that blocks saving says so, and the tool still works', async ({ page }) => {
    await page.addInitScript(() => {
        Storage.prototype.setItem = () => { throw new Error('blocked'); };
    });
    const errors = await boot(page);
    await expect(page.locator('[data-mk-storage-note]')).toBeHidden();
    await tapPlace(page, X.id, 0);
    expect(await tier(page, 0)).toEqual([X.id]);
    await expect(page.locator('[data-mk-storage-note]'))
        .toHaveText('This browser blocked saving, so the list only lasts until you leave this page.');
    await expect(page.locator('[data-mk-storage-note]')).toBeVisible();
    expect(errors).toEqual([]);
});

test('RESET asks first, then puts everything back', async ({ page }) => {
    await boot(page);
    await tapPlace(page, X.id, 0);
    await page.locator('[data-mk-title]').fill('Mine');
    await page.locator('[data-mk-action="add"]').click();

    await page.locator('[data-mk-action="reset"]').click();
    await expect(page.locator('#site-confirm-modal')).toBeVisible();
    await expect(page.locator('#site-confirm-title')).toHaveText('RESET THE LIST');
    await page.locator('#site-confirm-cancel').click();
    expect(await tier(page, 0)).toEqual([X.id]);
    await expect(page.locator('.mk-label')).toHaveCount(7);

    await page.locator('[data-mk-action="reset"]').click();
    await page.locator('#site-confirm-ok').click();
    expect(await labels(page)).toEqual(['S', 'A', 'B', 'C', 'D', 'F']);
    expect(await pool(page)).toEqual(VISIBLE.map(c => c.id));
    await expect(page.locator('[data-mk-title]')).toHaveValue('');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.mk-entry').first()).toBeVisible({ timeout: 20000 });
    expect(await tier(page, 0), 'the reset was saved too').toEqual([]);
});

// --- THE IMAGE ---

// Reads the PNG on the clipboard back into pixels. Every probe is a point the
// layout puts somewhere specific, so a wrong colour, a missing title or a
// credit in the wrong place each fails a different line.
async function readClipboardImage(page) {
    return page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const type = items[0].types.find(t => t === 'image/png');
        const blob = await items[0].getType(type);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        // The brightest pixel in a box: text is the only thing brighter than
        // the ground there.
        const brightest = (x0, y0, x1, y1) => {
            const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
            let best = 0;
            for (let i = 0; i < d.length; i += 4) best = Math.max(best, d[i] + d[i + 1] + d[i + 2]);
            return best;
        };
        // A portrait has many colours; a flat fill with its border has two.
        const distinct = (x0, y0, size) => {
            const d = ctx.getImageData(x0, y0, size, size).data;
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
            return seen.size;
        };
        const h = bitmap.height;
        return {
            type, width: bitmap.width, height: h,
            titleLeft: at(20, 38), titleMiddle: brightest(400, 10, 800, 66),
            labelS: at(20, 76 + 2 + 5), cellColours: distinct(150 + 10 + 8, 76 + 2 + 10 + 8, 80),
            creditRight: brightest(1050, h - 30, 1195, h), creditLeft: brightest(5, h - 30, 400, h),
            ground: at(5, h - 5),
        };
    });
}

const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

test('COPY IMAGE puts the list on the clipboard: the title on top, the tiers in their colours, the credit in the corner', async ({ page, context }) => {
    test.skip(!WITH_PORTRAIT, 'no character has a portrait to draw');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = await boot(page);
    await tapPlace(page, WITH_PORTRAIT.id, 0);
    await page.locator('[data-mk-title]').fill('My list');

    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText('Copied. Paste it anywhere.', { timeout: 15000 });
    const img = await readClipboardImage(page);

    expect(img.type).toBe('image/png');
    expect(img.width).toBe(1200);
    const ground = rgb(await page.evaluate(() => {
        const p = document.createElement('span');
        p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg-main');
        document.body.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
    }));
    const sColour = rgb(await resolveColour(page, DEFAULT_COLOURS[0]));

    expect(near(img.ground, ground), `ground ${img.ground} vs ${ground}`).toBe(true);
    expect(near(img.titleLeft, ground), 'the title row is above the board').toBe(true);
    expect(img.titleMiddle, 'and has the title written in it').toBeGreaterThan(600);
    expect(near(img.labelS, sColour), `S label ${img.labelS} vs ${sColour}`).toBe(true);
    expect(img.cellColours, 'the placed character\'s portrait is drawn').toBeGreaterThan(50);
    expect(img.creditRight, 'dogslamloop.com in the bottom right').toBeGreaterThan(sum(ground) + 60);
    expect(img.creditLeft, 'and nothing in the bottom left').toBeLessThanOrEqual(sum(ground) + 6);

    // No title, no title row: the board starts at the top.
    await page.locator('[data-mk-title]').fill('');
    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText('Copied. Paste it anywhere.', { timeout: 15000 });
    const plain = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const bitmap = await createImageBitmap(await items[0].getType('image/png'));
        return bitmap.height;
    });
    expect(img.height - plain).toBe(76);
    expect(errors).toEqual([]);
});

function sum(c) { return c[0] + c[1] + c[2]; }

test('a browser that cannot copy images gets the PNG as a download', async ({ page }) => {
    await page.addInitScript(() => { delete window.ClipboardItem; });
    await boot(page);
    await tapPlace(page, X.id, 0);
    await page.locator('[data-mk-title]').fill('My list, v2!');

    const download = page.waitForEvent('download');
    await page.locator('[data-mk-action="copy"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('my-list-v2.png');
    await expect(status(page)).toHaveText('This browser cannot copy images, so the image was downloaded instead.');
    await expect(page.locator('[data-mk-action="copy"]')).toBeEnabled();
});

test('a refused copy falls back to the download too', async ({ page }) => {
    await page.addInitScript(() => {
        navigator.clipboard.write = () => Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError'));
    });
    await boot(page);

    const download = page.waitForEvent('download');
    await page.locator('[data-mk-action="copy"]').click();
    expect((await download).suggestedFilename()).toBe('tier-list.png');
    await expect(status(page)).toHaveText('The browser would not copy the image, so it was downloaded instead.');
});
