// The Classic look (v1.2). Owner, 2026-11-19: "we can go with the classic look
// for the second major look of the site", a plain dark wiki ("Use dark mode
// wikipedia"), "Keep the current way frame data is presented and rendered",
// and "minimal code". Their picks: a skin over today's layout, chosen in Site
// settings, on reader pages only.
//
// html.look-classic comes from the stored setting (js/site_utils.js);
// style/look-classic.css is linked on reader pages only, so the class does
// nothing on the editor and staff pages. Supabase's REST API is refused here:
// everything checked is the page's own chrome, not its content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAFF = ['admin.html', 'edit.html', 'owner.html', 'post-editor.html', 'tier-editor.html', 'submissions.html'];
// Puppet Master's colour is dark (46% light), so the character theme both
// tints the page and injects its outlined-heading rule: the most it can do.
const PAGE = '/characters/Puppet_master/index.html';
const CLASSIC_BG = 'rgb(16, 20, 24)';

async function boot(page, look, url = PAGE) {
    await page.route('**/rest/v1/**', r => r.abort());
    await page.addInitScript((look) => {
        try { localStorage.setItem('dsl_site_settings', JSON.stringify({ look })); } catch (e) {}
        // The classes on <html> at the moment <body> arrives: anything added
        // later would show the other look first.
        // Watches the document: an init script runs before <html> exists.
        new MutationObserver((_, obs) => {
            if (!document.body) return;
            window.__classAtBody = document.documentElement.className;
            obs.disconnect();
        }).observe(document, { childList: true, subtree: true });
    }, look);
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
}

test('every reader page links the Classic stylesheet last, and no staff page does', () => {
    const pages = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean)
        .map(rel => ({ rel, html: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
        // A moved or archived stub loads no site script, so it has no look.
        .filter(({ html }) => /src="[^"]*js\/site_utils\.js/.test(html));

    const notLast = [];
    const staff = [];
    for (const { rel, html } of pages) {
        const head = html.slice(0, html.indexOf('</head>'));
        const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)].map(m => m[1]);
        const linked = sheets.some(href => href.endsWith('style/look-classic.css'));
        if (STAFF.includes(rel)) { if (linked) staff.push(rel); continue; }
        // Last, so it wins any tie of specificity with the stylesheets before it.
        if (!(sheets.length && sheets[sheets.length - 1].endsWith('style/look-classic.css'))) notLast.push(rel);
    }
    expect(pages.length).toBeGreaterThan(40);
    expect(notLast, 'reader pages without it as their last stylesheet').toEqual([]);
    expect(staff, 'editor and staff pages never load it').toEqual([]);
});

test('Classic is on <html> before the page body is built, so the other look never shows first', async ({ page }) => {
    await boot(page, 'classic');
    expect(await page.evaluate(() => window.__classAtBody)).toMatch(/\blook-classic\b/);
});

test('Classic on a character page: plain dark colours and a plain title, over the character\'s own theme', async ({ page }) => {
    const read = () => page.evaluate(() => {
        // A panel heading, as the Overview's would be: the dark-character
        // theme injects an !important outline rule for these.
        const h = document.createElement('h2');
        h.className = 'section-title';
        h.textContent = 'Character Overview';
        document.querySelector('main').appendChild(h);
        const title = getComputedStyle(document.querySelector('.character-title'));
        const head = getComputedStyle(h);
        return {
            ground: getComputedStyle(document.body).backgroundColor,
            texture: getComputedStyle(document.body).backgroundImage,
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-blue').trim(),
            titleColour: title.color, titleShadow: title.textShadow, titleFont: title.fontFamily,
            headColour: head.color, headShadow: head.textShadow,
            headBar: getComputedStyle(h, '::after').content,
            themed: !!document.getElementById('persona-dynamic-styles'),
        };
    });

    await boot(page, 'default');
    await expect(page.locator('.character-title')).toHaveText('Puppet Master');
    const before = await read();
    expect(before.themed, 'the character theme ran').toBe(true);
    expect(before.ground).not.toBe(CLASSIC_BG);
    expect(before.titleShadow).not.toBe('none');
    expect(before.headShadow).not.toBe('none');

    // A second boot: its init script runs after the first one's, so it wins.
    await boot(page, 'classic');
    await expect(page.locator('.character-title')).toHaveText('Puppet Master');
    const classic = await read();
    expect(classic.themed, 'the character theme still ran').toBe(true);
    expect(classic.ground).toBe(CLASSIC_BG);
    expect(classic.texture).toBe('none');
    expect(classic.accent).toBe('#88a3e8');
    expect(classic.titleColour).toBe('rgb(234, 236, 240)');
    expect(classic.titleShadow).toBe('none');
    expect(classic.titleFont).toMatch(/^Georgia/);
    expect(classic.headColour).toBe('rgb(234, 236, 240)');
    expect(classic.headShadow).toBe('none');
    expect(classic.headBar).toBe('none');
});

test('Classic makes buttons and tabs plain boxes', async ({ page }) => {
    const read = () => page.evaluate(() => {
        const btn = getComputedStyle(document.querySelector('.btn-sys'));
        const tab = getComputedStyle(document.querySelector('.btn-manga-slanted'));
        // The label leans back against the tab today; on a straight tab that
        // would tip it the other way.
        const label = getComputedStyle(document.querySelector('.btn-manga-slanted .btn-manga-content'));
        return { clip: btn.clipPath, shadow: btn.boxShadow, tabLean: tab.transform, tabShadow: tab.boxShadow, labelLean: label.transform };
    });
    await boot(page, 'default');
    await expect(page.locator('.btn-manga-slanted').first()).toBeVisible();
    const before = await read();
    expect(before.clip).not.toBe('none');
    expect(before.tabLean).not.toBe('none');

    await boot(page, 'classic');
    await expect(page.locator('.btn-manga-slanted').first()).toBeVisible();
    expect(await read()).toEqual({ clip: 'none', shadow: 'none', tabLean: 'none', tabShadow: 'none', labelLean: 'none' });
});

test('frame data keeps its phase colours and its monospace in Classic', async ({ page }) => {
    const read = () => page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML = `<div class="views-wrapper"><div class="frame-bar-container">
            <div class="phase-section bg-tick-start" style="width: 35%"><div class="frame-tick"></div></div>
            <div class="phase-section bg-tick-blockendlag" style="width: 20%"><div class="frame-tick"></div></div></div>
            <div class="frame-ruler"><span class="ruler-label">10</span></div></div>`;
        document.querySelector('main').appendChild(host);
        return {
            startup: getComputedStyle(host.querySelector('.bg-tick-start')).backgroundColor,
            endlag: getComputedStyle(host.querySelector('.bg-tick-blockendlag')).backgroundColor,
            ruler: getComputedStyle(host.querySelector('.ruler-label')).fontFamily,
        };
    });
    await boot(page, 'default');
    const before = await read();
    await boot(page, 'classic');
    const classic = await read();
    expect(classic).toEqual(before);
    expect(classic.ruler).toMatch(/monospace/);
});

test('the editor keeps the default look even with Classic picked', async ({ page }) => {
    await boot(page, 'classic', '/edit.html');
    // The class follows the setting everywhere; the stylesheet is what is
    // missing. Read off the variables it would set: the editor paints its own
    // body, so the body's colour would not tell.
    await expect(page.locator('html')).toHaveClass(/\blook-classic\b/);
    const vars = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { ground: cs.getPropertyValue('--bg-main').trim(), title: cs.getPropertyValue('--font-title').trim() };
    });
    expect(vars).toEqual({ ground: 'hsl(216, 28%, 7%)', title: "'Finger-Paint'" });
});
