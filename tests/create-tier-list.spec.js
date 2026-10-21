// Create Tier List (v1.1). Any visitor ranks the roster and copies the result
// as an image; nothing is sent anywhere.
//
// The owner's calls this file holds the tool to: drag-and-drop, with tier
// names and colours customisable (v0.15, 2026-08-15); the image goes to the
// clipboard, not a download (2026-08-16), with a download only when the
// browser cannot copy one; an optional title on the image (2026-10-20); the
// branding at the top right of the first tier, characters wrapping around it,
// on the board and the image (2026-10-21). Tap-to-place for phones, S to F in
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

// `at`: 'end' (the empty end of a row), 'left' or 'right' (a quarter in from
// that side of a character), or the middle.
const AT = { end: (b) => b.x + b.width - 20, left: (b) => b.x + b.width / 4, right: (b) => b.x + b.width * 3 / 4 };

async function pickUp(page, from) {
    const a = await from.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
}

async function hover(page, to, at) {
    const b = await to.boundingBox();
    await page.mouse.move(AT[at] ? AT[at](b) : b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
}

async function drag(page, from, to, at) {
    await pickUp(page, from);
    await hover(page, to, at);
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

test('a character dragged with the mouse lands in the tier, on the side of the character it is dropped on, and back out', async ({ page }) => {
    const errors = await boot(page);
    const bodyS = page.locator('.mk-body[data-zone="0"]');

    await drag(page, entry(page, X.id), bodyS, 'end');
    expect(await tier(page, 0)).toEqual([X.id]);
    expect(await pool(page)).not.toContain(X.id);

    await drag(page, entry(page, Y.id), bodyS, 'end');
    expect(await tier(page, 0)).toEqual([X.id, Y.id]);

    // The left half of a character is before it, the right half after it.
    await drag(page, entry(page, Z.id), entry(page, X.id), 'left');
    expect(await tier(page, 0)).toEqual([Z.id, X.id, Y.id]);
    await drag(page, entry(page, Z.id), entry(page, X.id), 'right');
    expect(await tier(page, 0)).toEqual([X.id, Z.id, Y.id]);
    await drag(page, entry(page, Z.id), entry(page, X.id), 'left');
    expect(await tier(page, 0)).toEqual([Z.id, X.id, Y.id]);

    // Across tiers, onto the label.
    await drag(page, entry(page, X.id), label(page, 2));
    expect(await tier(page, 0)).toEqual([Z.id, Y.id]);
    expect(await tier(page, 2)).toEqual([X.id]);

    // And back to the pool, in roster order again.
    await drag(page, entry(page, X.id), page.locator('[data-mk-pool]'));
    expect(await tier(page, 2)).toEqual([]);
    expect((await pool(page)).indexOf(X.id)).toBe(0);

    // Let go over its own left half, the character stays put: it is not a
    // place to drop itself. And a drag is not a tap, so nothing is left
    // picked up although the click lands on it.
    const box = await entry(page, Z.id).boundingBox();
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 4 + 30, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await tier(page, 0)).toEqual([Z.id, Y.id]);
    await expect(page.locator('.mk-entry[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.tier-portrait-ghost')).toHaveCount(0);
    expect(errors).toEqual([]);
});

// Owner, 2026-10-21: "a clear indicator inbetween the characters on the list
// to show the current character you are dragging will ended up in between".
test('while dragging, a bar shows the gap the character will land in', async ({ page }) => {
    const errors = await boot(page);
    await tapPlace(page, X.id, 0);
    await tapPlace(page, Y.id, 0);
    const marker = page.locator('.mk-drop-marker');
    const centre = async () => {
        const r = await marker.boundingBox();
        return r.x + r.width / 2;
    };

    await expect(marker).toBeHidden();
    await pickUp(page, entry(page, Z.id));
    const x = await entry(page, X.id).boundingBox();
    const y = await entry(page, Y.id).boundingBox();

    await hover(page, entry(page, Y.id), 'left');
    await expect(marker).toBeVisible();
    // In the gap between the two, and as tall as a character.
    expect(Math.abs(await centre() - (x.x + x.width + y.x) / 2)).toBeLessThanOrEqual(0.75);
    expect(Math.abs((await marker.boundingBox()).height - y.height)).toBeLessThanOrEqual(1);

    await hover(page, entry(page, Y.id), 'right');
    expect(await centre()).toBeGreaterThan(y.x + y.width);
    expect(await centre()).toBeLessThan(y.x + y.width + 6);

    // An empty tier: at its start. The pool has no order, so no bar.
    await hover(page, page.locator('.mk-body[data-zone="3"]'));
    expect(Math.abs(await centre() - ((await page.locator('.mk-body[data-zone="3"]').boundingBox()).x + 3))).toBeLessThanOrEqual(3);
    await hover(page, page.locator('[data-mk-pool]'), 'end');
    await expect(marker).toBeHidden();

    await hover(page, entry(page, Y.id), 'right');
    await page.mouse.up();
    await expect(marker).toBeHidden();
    expect(await tier(page, 0)).toEqual([X.id, Y.id, Z.id]);
    expect(errors, 'no pointer move failed on the way').toEqual([]);
});

// Owner, 2026-10-21: "Make the box of the character larger, so that the
// distance between the each character in the tier list is somewhere 2px-3px".
test('characters sit 2 to 3px apart, in bigger boxes', async ({ page }) => {
    await boot(page);
    await tapPlace(page, X.id, 0);
    await tapPlace(page, Y.id, 0);
    const [a, b] = await page.locator('.mk-body[data-zone="0"] .tier-portrait').evaluateAll(nodes =>
        nodes.map(n => ({ rect: n.getBoundingClientRect(), width: parseFloat(getComputedStyle(n).width) }))
            .map(({ rect, width }) => ({ left: rect.left, right: rect.right, width })));
    expect(b.left - a.right).toBeGreaterThanOrEqual(2);
    expect(b.left - a.right).toBeLessThanOrEqual(3);
    // The CSS width, as the old 76px was: the box measures 4px more with
    // its border.
    expect(a.width, 'bigger than the 76px they started at').toBeGreaterThan(76);
    // No shadow reaching into the gap.
    expect(await page.locator('.mk-body[data-zone="0"] .tier-portrait').first()
        .evaluate(n => getComputedStyle(n).boxShadow)).toBe('none');
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
        // Every probe is in Standard units, scaled to the quality picked.
        const s = bitmap.width / 1200;
        const box = (x0, y0, x1, y1) => ctx.getImageData(Math.round(x0 * s), Math.round(y0 * s),
            Math.round((x1 - x0) * s), Math.round((y1 - y0) * s)).data;
        const at = (x, y) => Array.from(box(x, y, x + 1, y + 1).slice(0, 3));
        const most = (d, f) => {
            let best = 0;
            for (let i = 0; i < d.length; i += 4) best = Math.max(best, f(d[i], d[i + 1], d[i + 2]));
            return best;
        };
        // Text is the only thing brighter than the ground in these boxes,
        // and the icon the only thing with colour in it.
        const brightest = (...b) => most(box(...b), (r, g, bl) => r + g + bl);
        const colourful = (...b) => most(box(...b), (r, g, bl) => Math.max(r, g, bl) - Math.min(r, g, bl));
        // A portrait has many colours; a flat fill with its border has two.
        const distinct = (x0, y0, size) => {
            const d = box(x0, y0, x0 + size, y0 + size);
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
            return seen.size;
        };
        const h = bitmap.height / s;
        // The first tier's first row of cells, under the title: 127px cells,
        // 8 to a row, the last two kept for the branding (x 933 to 1190).
        const row = 76 + 2 + 3;
        return {
            type, width: bitmap.width, height: bitmap.height,
            titleLeft: at(20, 38), titleMiddle: brightest(400, 10, 800, 66),
            labelS: at(20, 76 + 2 + 5), cellColours: distinct(150 + 3 + 8, row + 8, 100),
            // The icon in the top half of the branding, the words under it,
            // and nothing between the one character placed and the branding.
            brandIcon: colourful(940, row + 4, 1185, row + 70), brandText: brightest(940, row + 80, 1185, row + 125),
            firstRowMiddle: brightest(450, row + 4, 920, row + 123),
            // The last tier keeps nothing in its corner now, and the board's
            // own edge is below it.
            lastRowRight: brightest(900, h - 28, 1195, h - 3), lastRowGround: at(500, h - 10),
            bottomEdge: at(600, h - 1),
        };
    });
}

const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

const token = (page, name) => page.evaluate((n) => {
    const p = document.createElement('span');
    p.style.color = getComputedStyle(document.documentElement).getPropertyValue(n);
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
}, name);
const copied = /^Copied \((\d+)x(\d+), \d+\.\d MB\)\. Paste it anywhere\.$/;

test('COPY IMAGE puts the list on the clipboard: the title on top, the tiers in their colours, the branding in the first tier', async ({ page, context }) => {
    test.skip(!WITH_PORTRAIT, 'no character has a portrait to draw');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = await boot(page);
    await tapPlace(page, WITH_PORTRAIT.id, 0);
    await page.locator('[data-mk-title]').fill('My list');

    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText(copied, { timeout: 15000 });
    const img = await readClipboardImage(page);

    expect(img.type).toBe('image/png');
    expect(img.width, 'High is the default').toBe(2400);
    // The status reports the image's own size.
    const [, w, h] = (await status(page).textContent()).match(copied);
    expect([Number(w), Number(h)]).toEqual([img.width, img.height]);

    const ground = rgb(await token(page, '--bg-main'));
    const rowGround = rgb(await token(page, '--bg-secondary'));
    const edge = rgb(await token(page, '--border-color'));
    const sColour = rgb(await resolveColour(page, DEFAULT_COLOURS[0]));
    const sum = (c) => c[0] + c[1] + c[2];

    expect(near(img.titleLeft, ground), 'the title row is above the board').toBe(true);
    expect(img.titleMiddle, 'and has the title written in it').toBeGreaterThan(600);
    expect(near(img.labelS, sColour), `S label ${img.labelS} vs ${sColour}`).toBe(true);
    expect(img.cellColours, 'the placed character\'s portrait is drawn').toBeGreaterThan(50);

    // Owner, 2026-10-21: the icon with dogslamloop.com, at the top right of
    // the first tier like TierMaker's, and not in the last tier any more.
    expect(img.brandIcon, 'the icon at the first tier\'s top right').toBeGreaterThan(40);
    expect(img.brandText, 'dogslamloop.com under it').toBeGreaterThan(sum(rowGround) + 60);
    expect(img.firstRowMiddle, 'the branding sits in the corner, not after the character').toBeLessThanOrEqual(sum(rowGround) + 6);
    expect(near(img.lastRowGround, rowGround), 'the last tier\'s own ground').toBe(true);
    expect(img.lastRowRight, 'nothing in the last tier\'s corner').toBeLessThanOrEqual(sum(rowGround) + 6);
    expect(near(img.bottomEdge, edge), 'no footer: the image ends at the board').toBe(true);

    // No title, no title row: the board starts at the top.
    await page.locator('[data-mk-title]').fill('');
    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText(copied, { timeout: 15000 });
    const plain = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const bitmap = await createImageBitmap(await items[0].getType('image/png'));
        return bitmap.height;
    });
    expect(img.height - plain).toBe(76 * 2);
    expect(errors).toEqual([]);
});

// Owner, 2026-10-21: "the branding is actually a fixed elements that the boxes
// wrap and go around; but for tiers where the branding isn't situated at, it
// will fill over". Measured with the portraits blocked, so every cell is a
// flat fill, probed near its top left corner, clear of the name drawn in its
// middle.
test('in the image, the first tier wraps around the branding and the next tier fills its whole row', async ({ page, context }) => {
    test.skip(VISIBLE.length < 16, 'needs 16 characters on the roster');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/medias/portraits/**', route => route.fulfill({ status: 404, body: '' }));
    await boot(page);
    await page.locator('[data-mk-quality]').selectOption('1');
    for (const c of VISIBLE.slice(0, 8)) await tapPlace(page, c.id, 0);
    for (const c of VISIBLE.slice(8, 16)) await tapPlace(page, c.id, 1);
    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText(copied, { timeout: 15000 });

    const rowGround = rgb(await token(page, '--bg-secondary'));
    const probe = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const bitmap = await createImageBitmap(await items[0].getType('image/png'));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        let colour = 0;
        const icon = ctx.getImageData(940, 5, 245, 70).data;
        for (let i = 0; i < icon.length; i += 4) colour = Math.max(colour, Math.max(icon[i], icon[i + 1], icon[i + 2]) - Math.min(icon[i], icon[i + 1], icon[i + 2]));
        // 127px cells 130px apart from x 153. S: rows at y 5 and 135, two
        // lines tall, so A's row is at y 270.
        const cellAt = (col, rowTop) => at(153 + col * 130 + 10, rowTop + 10);
        return {
            sSixth: cellAt(5, 5), sSeventhPlace: cellAt(6, 5), brandIcon: colour,
            sSecondLineFirst: cellAt(0, 135), sSecondLineThird: cellAt(2, 135),
            aEighth: cellAt(7, 270),
        };
    });
    const ground = (c) => near(c, rowGround);
    expect(ground(probe.sSixth), 'S\'s first line holds six').toBe(false);
    expect(ground(probe.sSeventhPlace), 'the seventh place is the branding\'s, not a character\'s').toBe(true);
    expect(probe.brandIcon, 'the branding is drawn there').toBeGreaterThan(40);
    expect(ground(probe.sSecondLineFirst), 'the seventh character wraps to the next line').toBe(false);
    expect(ground(probe.sSecondLineThird), 'and only two did').toBe(true);
    expect(ground(probe.aEighth), 'A has no branding, so its eighth character reaches the edge').toBe(false);
});

test('on the board, the branding holds the first tier\'s top right corner and the characters wrap around it', async ({ page }) => {
    const errors = await boot(page);
    const body = (i) => page.locator(`.mk-body[data-zone="${i}"]`);
    const brandEl = page.locator('.mk-brand');
    const columns = await body(0).evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
    test.skip(VISIBLE.length < columns + 1, 'needs a full row of characters and one more');

    // A full row's worth in S, saved and reloaded rather than placed one tap
    // at a time.
    await page.evaluate(({ key, tiers }) => localStorage.setItem(key, JSON.stringify({ v: 1, title: '', tiers, scale: 2 })), {
        key: 'dsl_create_tier_list',
        tiers: ['S', 'A', 'B', 'C', 'D', 'F'].map((name, i) => ({
            name, color: DEFAULT_COLOURS[i], characters: i === 0 ? VISIBLE.slice(0, columns).map(c => c.id) : [],
        })),
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.mk-entry').first()).toBeVisible({ timeout: 20000 });

    await expect(brandEl).toHaveCount(1);
    await expect(body(0).locator('.mk-brand')).toBeVisible();
    await expect(brandEl).toHaveText('dogslamloop.com');
    expect(await brandEl.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), 'the icon loads').toBe(true);

    const rects = (i) => body(i).locator('.mk-entry').evaluateAll(nodes => nodes.map(n => {
        const r = n.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right };
    }));
    const b = await brandEl.boundingBox();
    const box = await body(0).boundingBox();
    const s = await rects(0);
    const firstLine = s.filter(r => Math.abs(r.top - s[0].top) < 1);
    expect(Math.abs(b.y - s[0].top), 'on the first line').toBeLessThan(1);
    expect(firstLine.length, 'two places on the first line are the branding\'s').toBe(columns - 2);
    expect(Math.max(...firstLine.map(r => r.right)), 'the characters stop before it').toBeLessThan(b.x);
    expect(box.x + box.width - (b.x + b.width), 'in the last columns').toBeLessThan(96 + 3 + 3 + 2);
    const wrapped = s[columns - 2];
    expect(wrapped.top, 'the next character wraps under it').toBeGreaterThan(b.y + b.height);
    expect(Math.abs(wrapped.left - s[0].left), 'to the start of the line').toBeLessThan(1);

    // Moved down, S fills its whole first line, and the branding stays with
    // whichever tier is first.
    await page.locator('[data-mk-action="down"][data-tier="0"]').click();
    await expect(body(0).locator('.mk-brand')).toHaveCount(1);
    await expect(body(1).locator('.mk-brand')).toHaveCount(0);
    const moved = await rects(1);
    expect(moved.every(r => Math.abs(r.top - moved[0].top) < 1), 'all of S on one line').toBe(true);

    // The branding is not in the way of a drop: let go over it, the
    // character goes to the end of that tier.
    const extra = VISIBLE[columns];
    await drag(page, entry(page, extra.id), brandEl);
    expect(await tier(page, 0)).toEqual([extra.id]);
    expect(errors).toEqual([]);
});

// The same 3px in the image. Measured with the portraits blocked, so every
// cell is a flat fill and the only ground-coloured pixels along a line through
// the cells are the gaps.
test('in the image too, characters sit 2 to 3px apart', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/medias/portraits/**', route => route.fulfill({ status: 404, body: '' }));
    await boot(page);
    await page.locator('[data-mk-quality]').selectOption('1');
    for (const c of VISIBLE.slice(0, 3)) await tapPlace(page, c.id, 0);
    await page.locator('[data-mk-action="copy"]').click();
    await expect(status(page)).toHaveText(copied, { timeout: 15000 });

    const rowGround = rgb(await token(page, '--bg-secondary'));
    const gaps = await page.evaluate(async (ground) => {
        const items = await navigator.clipboard.read();
        const bitmap = await createImageBitmap(await items[0].getType('image/png'));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        // A line near the top of the first row's cells, above any name.
        const d = ctx.getImageData(0, 2 + 3 + 6, bitmap.width, 1).data;
        const isGround = (x) => [0, 1, 2].every(k => Math.abs(d[x * 4 + k] - ground[k]) <= 2);
        const runs = [];
        let run = 0;
        for (let x = 150; x < bitmap.width; x++) {
            if (isGround(x)) run++;
            else if (run) { runs.push(run); run = 0; }
        }
        return runs;
    }, rowGround);
    // The padding before the first cell, then the two gaps between three.
    expect(gaps.slice(1, 3).every(g => g >= 2 && g <= 3), `gaps ${gaps.slice(0, 4)}`).toBe(true);
});

// Owner, 2026-10-21: "Give people the option to choose export/copy quality".
test('the quality picked sets how sharp the image is, and is kept', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await boot(page);
    await tapPlace(page, X.id, 0);
    const quality = page.locator('[data-mk-quality]');
    await expect(quality).toHaveValue('2');
    const width = () => page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        return (await createImageBitmap(await items[0].getType('image/png'))).width;
    });

    for (const [value, expected] of [['1', 1200], ['3', 3600]]) {
        await quality.selectOption(value);
        await page.locator('[data-mk-action="copy"]').click();
        await expect(status(page)).toHaveText(copied, { timeout: 20000 });
        expect(await width()).toBe(expected);
        await status(page).evaluate(n => { n.textContent = ''; });
    }

    // Kept on the device, and through RESET: it is a preference, not the list.
    await page.locator('[data-mk-action="reset"]').click();
    await page.locator('#site-confirm-ok').click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.mk-entry').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-mk-quality]')).toHaveValue('3');
});

test('a browser that cannot copy images gets the PNG as a download', async ({ page }) => {
    await page.addInitScript(() => { delete window.ClipboardItem; });
    await boot(page);
    await tapPlace(page, X.id, 0);
    await page.locator('[data-mk-title]').fill('My list, v2!');

    const download = page.waitForEvent('download');
    await page.locator('[data-mk-action="copy"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('my-list-v2.png');
    await expect(status(page)).toHaveText(/^This browser cannot copy images, so the image was downloaded instead \(2400x\d+, \d+\.\d MB\)\.$/);
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
    await expect(status(page)).toHaveText(/^The browser would not copy the image, so it was downloaded instead \(\d+x\d+, \d+\.\d MB\)\.$/);
});
