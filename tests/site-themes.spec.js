// Site settings themes (v1.3, C-4b). Owner, 2026-11-28, picking from mockups of real
// pages: "The four as drawn" (Light, Shadow, Brown Paper, Light Blue, each with its own
// accent; Dark is each look's own colours), over both looks on every page, with
// "Character colour wins" from C-4 (a character page keeps its colour as the accent)
// and "Darker shade for text" (on a light theme, text in a status or character colour
// takes a darker shade of its hue; borders and fills keep the colour).
//
// A theme is html[data-theme], set before the page paints by window.applySiteSettings
// (scripts/page-scripts.js), drawn by the theme layer in style/Common.css. Every check
// reads what the browser computed. Supabase's REST API is refused on the staff pages:
// what is checked is the site's own chrome.
const { test, expect } = require('@playwright/test');

const PAGE = '/privacy-policy.html';
const LIGHT = ['light', 'brown-paper', 'light-blue'];
let boots = 0;

async function boot(page, settings, url = PAGE) {
    // Saved once per boot, and only by the newest, so a reload keeps what the page
    // itself saved since.
    const n = ++boots;
    await page.addInitScript(([s, bootN]) => {
        try {
            if (bootN > (Number(sessionStorage.getItem('test-boot')) || 0)) {
                localStorage.setItem('dsl_site_settings', JSON.stringify(Object.assign({ motionOff: true }, s)));
                sessionStorage.setItem('test-boot', String(bootN));
            }
        } catch (e) {}
        // <html>'s theme at the moment <body> arrives: anything later shows Dark first.
        new MutationObserver((_, obs) => {
            if (!document.body) return;
            window.__themeAtBody = document.documentElement.getAttribute('data-theme');
            obs.disconnect();
        }).observe(document, { childList: true, subtree: true });
    }, [settings, n]);
    await page.goto(url, { waitUntil: 'networkidle' });
}

// Relative luminance of an rgb() colour, 0 for black to 1 for white.
function luminance(rgb) {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(c => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The page's ground and text, and a role colour resolved where the page reads it, so
// an element can be compared with the role the theme set rather than with a literal.
const read = page => page.evaluate(() => {
    document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* endless */ } });
    const role = v => {
        const i = document.createElement('i');
        i.style.cssText = `color: var(${v}); transition: none`;
        document.body.appendChild(i);
        const c = getComputedStyle(i).color;
        i.remove();
        return c;
    };
    const cs = el => getComputedStyle(document.querySelector(el));
    return {
        theme: document.documentElement.getAttribute('data-theme'),
        ground: cs('body').backgroundColor,
        text: cs('body').color,
        // Three ways a colour reaches a theme: a role, a palette grey on the theme's map,
        // and a rare colour that keeps its own value until a theme is on.
        title: cs('.sidebar-master-title').color,
        settingsEdge: cs('#dock-btn-settings').borderTopColor,
        subtitle: cs('.site-subtitle').color,
        muted: role('--text-muted'),
        border: role('--border-color'),
    };
});

test('a theme picked in Site settings repaints the page at once in either look, stays after a reload, and Dark takes it back', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page, {});
    const dark = await read(page);
    expect(dark.theme).toBeNull();

    await page.locator('#dock-btn-settings').click();
    const radios = page.locator('#site-settings-overlay [data-setting="theme"]');
    await expect(radios).toHaveCount(5);
    await expect(page.locator('#site-setting-theme-dark')).toBeChecked();
    for (const key of ['light', 'shadow', 'brown-paper', 'light-blue']) {
        await page.locator(`#site-setting-theme-${key}`).check();
        const now = await read(page);
        expect(now.theme, key).toBe(key);
        expect(now.ground, `${key}: the ground changed`).not.toBe(dark.ground);
        if (LIGHT.includes(key)) {
            expect(luminance(now.ground), `${key}: a light ground`).toBeGreaterThan(0.6);
            expect(luminance(now.text), `${key}: dark text`).toBeLessThan(0.1);
        } else {
            expect(now.ground, 'Shadow: a black ground').toBe('rgb(0, 0, 0)');
            expect(luminance(now.text), 'Shadow: light text').toBeGreaterThan(0.4);
        }
        expect(now.settingsEdge, `${key}: a palette grey follows the theme's line colour`).toBe(now.border);
        expect(now.subtitle, `${key}: a colour kept exact without a theme follows one`).toBe(now.muted);
    }

    // Over Classic as well, which keeps its own shapes.
    await page.locator('#site-setting-look-classic').check();
    const classic = await read(page);
    expect(classic.theme).toBe('light-blue');
    expect(luminance(classic.ground)).toBeGreaterThan(0.6);
    await page.keyboard.press('Escape');

    await page.reload({ waitUntil: 'networkidle' });
    expect(await page.evaluate(() => window.__themeAtBody)).toBe('light-blue');
    expect((await read(page)).ground).toBe(classic.ground);

    await page.locator('#dock-btn-settings').click();
    await expect(page.locator('#site-setting-theme-light-blue')).toBeChecked();
    await page.locator('#site-setting-theme-dark').check();
    await page.locator('#site-setting-look-default').check();
    expect(await read(page)).toEqual(dark);
    expect(errors).toEqual([]);
});

test('a stored theme is on <html> before <body> arrives, on reader and staff pages', async ({ page }) => {
    await page.route('**/rest/v1/**', r => r.abort());
    for (const url of ['/index.html', PAGE, '/characters/Template/index.html', '/edit.html', '/overseer.html', '/owner.html', '/post-editor.html', '/tier-editor.html', '/submissions.html']) {
        await page.addInitScript(() => {
            try { localStorage.setItem('dsl_site_settings', JSON.stringify({ theme: 'brown-paper' })); } catch (e) {}
            new MutationObserver((_, obs) => {
                if (!document.body) return;
                window.__themeAtBody = document.documentElement.getAttribute('data-theme');
                obs.disconnect();
            }).observe(document, { childList: true, subtree: true });
        });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        expect(await page.evaluate(() => window.__themeAtBody), url).toBe('brown-paper');
    }
});

test('a stored theme the site does not have reads as Dark', async ({ page }) => {
    await boot(page, {});
    const dark = await read(page);
    await boot(page, { theme: 'neon' });
    expect(await read(page)).toEqual(dark);
});

test('on the staff pages a theme reaches the editor\'s own colours in either look, and black and white stay true', async ({ page }) => {
    await page.route('**/rest/v1/**', r => r.abort());
    const editor = () => page.evaluate(() => {
        document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* endless */ } });
        const role = v => {
            const i = document.createElement('i');
            i.style.cssText = `color: var(${v}); transition: none`;
            document.body.appendChild(i);
            const c = getComputedStyle(i).color;
            i.remove();
            return c;
        };
        return {
            ground: getComputedStyle(document.body).backgroundColor,
            title: getComputedStyle(document.getElementById('editor-title')).color,
            black: role('--black'), white: role('--white'), bgMain: role('--bg-main'),
        };
    });
    for (const look of ['default', 'classic']) {
        await page.addInitScript(l => {
            try {
                localStorage.setItem('dsl_site_settings', JSON.stringify({ look: l, motionOff: true }));
                localStorage.setItem('dsl_notice_seen_editor', '1');
            } catch (e) {}
        }, look);
        await page.goto('/edit.html?playground', { waitUntil: 'networkidle' });
        await expect(page.locator('#editor-title')).toBeVisible();
        const before = await editor();
        // Classic draws the staff pages' greys as its own colours: black is its ground.
        if (look === 'classic') expect(before.black, 'Classic, no theme').toBe(before.bgMain);
        else expect(before.black).toBe('rgb(0, 0, 0)');

        await page.evaluate(() => window.siteSettings.set('theme', 'light'));
        const lit = await editor();
        expect(luminance(lit.ground), `${look}: the editor's ground`).toBeGreaterThan(0.6);
        expect(luminance(lit.title), `${look}: its white title turns dark`).toBeLessThan(0.1);
        expect(lit.black, `${look}: black stays black, for ink on a coloured fill`).toBe('rgb(0, 0, 0)');
        expect(lit.white, `${look}: white stays white`).toBe('rgb(255, 255, 255)');
        await page.evaluate(() => window.siteSettings.set('theme', ''));
    }
});

test('a character page keeps its colour as the accent under a theme; Classic takes the theme\'s', async ({ page }) => {
    await page.route('**/rest/v1/**', r => r.abort());
    const accent = () => page.evaluate(() => {
        const probe = v => {
            const i = document.createElement('i');
            i.style.cssText = `color: ${v}; transition: none`;
            document.body.appendChild(i);
            const c = getComputedStyle(i).color;
            i.remove();
            return c;
        };
        const name = document.querySelector('.character-title').textContent.trim();
        return { accent: probe('var(--accent-blue)'), own: probe(window.CHARACTER_COLORS[name]), ground: getComputedStyle(document.body).backgroundColor };
    });
    const url = '/characters/Puppet_master/index.html';
    await boot(page, { theme: 'light' }, url);
    await page.waitForFunction(() => document.querySelector('.character-title[data-themed]'));
    const def = await accent();
    expect(def.accent, 'Default: the character\'s colour wins over the theme\'s accent').toBe(def.own);
    expect(luminance(def.ground), 'its dark ground gives way to the theme\'s').toBeGreaterThan(0.6);

    await boot(page, { theme: 'light', look: 'classic' }, url);
    const classic = await accent();
    expect(classic.accent, 'Classic: the theme\'s accent').toBe('rgb(9, 105, 218)');
});

// A name the site colours itself comes with its colour inline. An invented character
// in a light yellow, so no real character's colour is relied on.
test('on a light theme, a character\'s name in text takes a darker shade of its colour', async ({ page }) => {
    const mention = () => page.evaluate(() => {
        window.CHARACTER_COLORS = { Zelvaar: '#ffe066' };
        const p = document.createElement('p');
        p.className = 'wiki-text';
        p.textContent = 'Zelvaar wins the trade.';
        document.querySelector('.main-content-area').appendChild(p);
        window.applyInternalStyling();
        const name = p.querySelector('.sc-char');
        return name ? getComputedStyle(name).color : 'no name drawn';
    });
    await boot(page, {}, '/systems/hud/index.html');
    expect(await mention(), 'Dark: the colour itself').toBe('rgb(255, 224, 102)');
    await boot(page, { theme: 'light' }, '/systems/hud/index.html');
    const lit = await mention();
    const [l, , h] = (lit.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/) || [0, 1, 0, 0]).slice(1).map(Number);
    expect(l, `light: darker (${lit})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h - 95), 'still yellow').toBeLessThan(10);
});

test('on a light theme, text in a status colour takes a darker shade of its hue, and its border keeps the colour', async ({ page }) => {
    const kofi = () => page.evaluate(() => {
        document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* endless */ } });
        const cs = getComputedStyle(document.querySelector('.kofi-btn-wrapper .btn-sys-yellow'));
        return { text: cs.color, edge: cs.borderTopColor };
    });
    await boot(page, {});
    const dark = await kofi();
    expect(dark.text, 'Dark: the words are the colour itself').toBe(dark.edge);

    await boot(page, { theme: 'shadow' });
    expect(await kofi(), 'a dark theme keeps the colour').toEqual(dark);

    for (const theme of LIGHT) {
        await boot(page, { theme });
        const lit = await kofi();
        expect(lit.edge, `${theme}: the border keeps the colour`).toBe(dark.edge);
        // oklch(L C H): at most half lightness, and the same hue as the colour's.
        const [l, , h] = lit.text.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/).slice(1).map(Number);
        expect(l, `${theme}: darker`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(h - 86), `${theme}: still yellow`).toBeLessThan(10);
    }
});
