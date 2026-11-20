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
const STAFF = ['admin.html', 'edit.html', 'owner.html', 'post-editor.html', 'tier-editor.html'];
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

// --- ROUND 2 (owner, 2026-11-20): "It feels like watered down default
// version." Panels lose their box and stop lifting, the playstyle and the
// profile's stats read as tables, content tables are ruled, the account
// buttons are links, sidebar headings and pop-ups are plain. ---

const ACCENT = 'rgb(136, 163, 232)';

test('Classic panels have no box and do not lift on hover; the infobox and frame data cards keep a thin one', async ({ page }) => {
    const add = () => page.evaluate(() => {
        document.querySelector('main').insertAdjacentHTML('afterbegin', `
            <section class="wiki-section" id="t-panel" style="height: 120px"><h2 class="section-title">Overview</h2></section>
            <aside class="wiki-section profile-card" id="t-infobox"></aside>
            <section class="skill-entry-card" id="t-move"></section>`);
    });
    const read = (id) => page.evaluate((id) => {
        const cs = getComputedStyle(document.getElementById(id));
        return { border: cs.borderTopWidth, ground: cs.backgroundColor, pad: cs.paddingTop, lift: cs.transform };
    }, id);

    await boot(page, 'default');
    await add();
    await page.hover('#t-panel');
    expect((await read('t-panel')).lift, 'the default look lifts a panel').not.toBe('none');

    await boot(page, 'classic');
    await add();
    await page.hover('#t-panel');
    expect(await read('t-panel')).toEqual({ border: '0px', ground: 'rgba(0, 0, 0, 0)', pad: '0px', lift: 'none' });
    expect((await read('t-infobox')).border).toBe('1px');
    expect((await read('t-move')).border).toBe('1px');
});

test('the playstyle reads as a two-column table with plain headers; Default still shouts them', async ({ page }) => {
    const render = () => page.evaluate(() => {
        document.querySelector('main').insertAdjacentHTML('afterbegin',
            window.generatePlaystyleHTML({ likes: ['Air combos'], dislikes: ['M1 trading'] }));
        const box = document.querySelector('.playstyle-container');
        return {
            heads: [...box.querySelectorAll('.playstyle-header')].map(h => h.innerText),
            layout: getComputedStyle(box).display,
            icon: getComputedStyle(box.querySelector('.playstyle-icon')).display,
            bullet: getComputedStyle(box.querySelector('.playstyle-item')).display,
        };
    });
    await boot(page, 'default');
    expect((await render()).heads).toEqual(['PICK IF YOU LIKE', 'AVOID IF YOU DISLIKE']);
    await boot(page, 'classic');
    expect(await render()).toEqual({ heads: ['Pick if you like', 'Avoid if you dislike'], layout: 'grid', icon: 'none', bullet: 'list-item' });
});

test('tables in page content are ruled cell by cell, with a plain header row', async ({ page }) => {
    await boot(page, 'classic');
    const t = await page.evaluate(() => {
        document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="wiki-table-wrapper"><table class="update-table wiki-content-table">
            <thead><tr><th>Techs</th><th>How</th></tr></thead><tbody><tr><td>Clever</td><td>M1</td></tr></tbody></table></div>`);
        const th = getComputedStyle(document.querySelector('.wiki-content-table th'));
        const td = getComputedStyle(document.querySelector('.wiki-content-table td'));
        return { thCase: th.textTransform, thColour: th.color, tdLeft: td.borderLeftWidth, tdRight: td.borderRightWidth,
            wrapShadow: getComputedStyle(document.querySelector('.wiki-table-wrapper')).boxShadow };
    });
    expect(t).toEqual({ thCase: 'none', thColour: 'rgb(255, 255, 255)', tdLeft: '1px', tdRight: '1px', wrapShadow: 'none' });
});

// A signed-in reviewer with unread mail, as far as the dock asks: its session,
// its role and the unread count. The display name carries markup, which must
// come out as text.
async function signedIn(page) {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const real = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = real(...args);
                    client.auth.getSession = async () => ({ data: { session: {
                        user: { id: 'me', email: 'me@example.com', user_metadata: { display_name: 'Real <i>Deptr</i>' } },
                        access_token: 'tok' } } });
                    const from = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            const c = { select: () => c, eq: () => c, single: async () => ({ data: { role: 'reviewer' }, error: null }) };
                            return c;
                        }
                        if (table === 'user_notifications') {
                            const c = { select: () => c, eq: () => c, then: (ok, no) => Promise.resolve({ count: 2, data: [], error: null }).then(ok, no) };
                            return c;
                        }
                        return from(table);
                    };
                    return client;
                };
            },
        });
    });
}

test('the account buttons are plain links under "Account", in normal case; a name shows as text', async ({ page }) => {
    const read = () => page.evaluate(() => {
        const dock = document.getElementById('sidebar-dynamic-dock');
        const inbox = document.getElementById('dock-btn-inbox');
        const auth = document.getElementById('dock-btn-auth');
        return {
            label: getComputedStyle(dock, '::before').content,
            inbox: inbox.innerText.replace(/\s+/g, ' ').trim(),
            // Generated text: innerText never includes it.
            unread: getComputedStyle(inbox.querySelector('.dock-badge'), '::before').content,
            inboxGround: getComputedStyle(inbox).backgroundImage,
            inboxBorder: getComputedStyle(inbox).borderTopWidth,
            icon: getComputedStyle(inbox.querySelector('.dock-action-icon')).display,
            overseer: document.getElementById('dock-btn-edit').innerText.trim(),
            name: auth.innerText.trim(),
            markup: auth.querySelectorAll('i').length,
            settingsIcon: getComputedStyle(document.querySelector('#dock-btn-settings .dock-action-icon')).display,
        };
    });
    await signedIn(page);
    await boot(page, 'default');
    await expect(page.locator('#dock-btn-inbox')).toBeVisible();
    const usual = await read();
    expect(usual.inbox, 'Default still shows the labels in capitals').toBe('INBOX');
    expect(usual.overseer).toBe('OVERSEER');
    expect(usual.markup, 'the name is text, not markup').toBe(0);

    await boot(page, 'classic');
    await expect(page.locator('#dock-btn-inbox')).toBeVisible();
    expect(await read()).toEqual({
        label: '"Account"', inbox: 'Inbox', unread: '"(new)"', inboxGround: 'none', inboxBorder: '0px', icon: 'none',
        overseer: 'Overseer', name: 'Real <i>Deptr</i>', markup: 0, settingsIcon: 'flex',
    });
});

test('the account links are spaced the same on the home page as on a character page, in both looks', async ({ page }) => {
    // Owner, 2026-11-20: the Classic account links sat further apart on the
    // Main Hub than on a character or system page, "a CSS inconsistency that
    // is not obvious when using the default look". Twelve hand-written pages
    // wrote the dock's layout as an inline style, which beats any stylesheet,
    // so Classic's tighter gap never reached them.
    const spacing = () => page.evaluate(() => {
        const a = document.getElementById('dock-btn-edit').getBoundingClientRect();
        const b = document.getElementById('dock-btn-inbox').getBoundingClientRect();
        return Math.round(b.top - a.bottom);
    });
    await signedIn(page);
    const seen = {};
    for (const look of ['default', 'classic']) {
        for (const url of [PAGE, '/index.html']) {
            await boot(page, look, url);
            await expect(page.locator('#dock-btn-inbox')).toBeVisible();
            seen[`${look} ${url}`] = await spacing();
        }
    }
    expect(seen[`classic /index.html`], 'Classic: the home page as tight as a character page').toBe(seen[`classic ${PAGE}`]);
    expect(seen[`classic ${PAGE}`]).toBeLessThan(seen[`default ${PAGE}`]);
    expect(seen[`default /index.html`], 'Default is the same on both, as it was').toBe(seen[`default ${PAGE}`]);
});

test('no page writes the account dock\'s layout inline, where no look can reach it', () => {
    const inline = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean)
        .filter(rel => /id="sidebar-dynamic-dock"[^>]*\sstyle=/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(inline).toEqual([]);
});

test('sidebar headings are small grey words, while the category toggles stay links', async ({ page }) => {
    await boot(page, 'classic');
    await expect(page.locator('.sidebar-group-header').first()).toBeVisible();
    const s = await page.evaluate(() => {
        const head = getComputedStyle(document.querySelector('.sidebar-master-title'));
        const toggle = getComputedStyle(document.querySelector('.sidebar-group-header'));
        return { headCase: head.textTransform, headSize: head.fontSize, headColour: head.color, toggleColour: toggle.color, toggleRule: toggle.borderBottomWidth };
    });
    expect(s).toEqual({ headCase: 'none', headSize: '12.8px', headColour: 'rgb(162, 169, 177)', toggleColour: ACCENT, toggleRule: '0px' });
});

test('"On this tab" is a list of plain links', async ({ page }) => {
    await boot(page, 'classic');
    const link = await page.evaluate(() => {
        const a = document.createElement('a');
        a.className = 'btn-nav toc-link-major';
        a.textContent = 'Character Overview';
        document.querySelector('.local-sidebar-right').appendChild(a);
        const cs = getComputedStyle(a);
        return { ground: cs.backgroundColor, border: cs.borderTopWidth, colour: cs.color };
    });
    expect(link).toEqual({ ground: 'rgba(0, 0, 0, 0)', border: '0px', colour: ACCENT });
});

test('pop-ups are one plain box with the title as written', async ({ page }) => {
    const open = () => page.evaluate(() => {
        window.openSiteSettings();
        const box = getComputedStyle(document.querySelector('#site-settings-overlay .modal-box'));
        return { title: document.getElementById('site-settings-title').innerText, top: box.borderTopColor, topWidth: box.borderTopWidth, rise: box.animationName };
    });
    await boot(page, 'default');
    expect((await open()).title, 'Default still shows the title in capitals').toBe('SITE SETTINGS');
    await boot(page, 'classic');
    expect(await open()).toEqual({ title: 'Site settings', top: 'rgb(84, 89, 93)', topWidth: '1px', rise: 'none' });
});

// --- ROUND 3 (owner, 2026-11-20): "custom build blocks such as callout and
// dropdown could get its own version in the classic look as well." ---

test('content blocks are plain in Classic: callout, dropdown, boxed list, Section Box, tooltip', async ({ page }) => {
    const render = () => page.evaluate(() => {
        const host = document.createElement('section');
        host.className = 'wiki-section';
        host.innerHTML = window.generateHTMLForBlocks([
            { type: 'callout', intent: 'tip', title: 'Why', content: 'No audio cue.' },
            { type: 'accordion', title: 'More about air combos', content: [{ type: 'paragraph', content: ['Inside.'] }] },
            { type: 'list', items: ['Get up Theory'], boxed: true },
            { type: 'sectionedbox', title: 'Wakeup', sections: [{ title: 'First hit', content: [] }, { title: 'Second hit', content: [] }] },
        ], '');
        document.querySelector('main').prepend(host);
        if (typeof window.initTooltip === 'function') window.initTooltip();
        const cs = (sel) => getComputedStyle(host.querySelector(sel) || document.querySelector(sel));
        const callout = host.querySelector('.inline-callout-btn');
        return {
            calloutLabel: callout.innerText.trim().replace(/^\S+\s*/, ''),
            calloutShadow: cs('.inline-callout-btn').boxShadow,
            calloutTop: cs('.inline-callout-btn').borderTopWidth,
            calloutEdge: cs('.inline-callout-btn').borderLeftWidth,
            summaryCase: cs('.wiki-accordion-summary').textTransform,
            summaryColour: cs('.wiki-accordion-summary').color,
            listBorder: cs('.wiki-block-list-boxed').borderTopWidth,
            tabCase: cs('.sbox-tab').textTransform,
            activeTab: cs('.sbox-tab.is-active').color,
            tooltipBorder: getComputedStyle(document.getElementById('wiki-frame-tooltip')).borderTopWidth,
        };
    });
    await boot(page, 'default');
    const usual = await render();
    expect(usual.calloutLabel, 'Default still shows the label in capitals').toBe('TIP');
    expect(usual.calloutShadow).not.toBe('none');
    expect(usual.tooltipBorder).toBe('2px');

    await boot(page, 'classic');
    expect(await render()).toEqual({
        calloutLabel: 'Tip', calloutShadow: 'none', calloutTop: '1px', calloutEdge: '3px',
        summaryCase: 'none', summaryColour: 'rgb(234, 236, 240)', listBorder: '1px',
        tabCase: 'none', activeTab: 'rgb(255, 255, 255)', tooltipBorder: '1px',
    });
    // Nothing moves under the pointer.
    await page.hover('.inline-callout-btn');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.inline-callout-btn')).transform)).toBe('none');
});

test('the site\'s dropdown is a plain box in Classic', async ({ page }) => {
    await boot(page, 'classic', '/characters/index.html');
    await page.locator('#filter-archetype + .manga-select-wrapper .manga-select-trigger').click();
    const list = page.locator('#filter-archetype + .manga-select-wrapper .manga-select-options');
    await expect(list).toBeVisible();
    const d = await list.evaluate((el) => {
        const cs = getComputedStyle(el);
        const trigger = getComputedStyle(el.parentElement.querySelector('.manga-select-trigger'));
        const option = getComputedStyle(el.querySelector('.manga-option'));
        return { shadow: cs.boxShadow, top: cs.borderTopWidth, rise: cs.animationName, buttonShadow: trigger.boxShadow, buttonLift: trigger.transform, rule: option.borderBottomWidth };
    });
    expect(d).toEqual({ shadow: 'none', top: '1px', rise: 'none', buttonShadow: 'none', buttonLift: 'none', rule: '0px' });
});

// Owner, 2026-11-20: "I think you forget to change the buttons on the left
// sidebar as well. I think it's fine to leave the character text colors in."
test('the site menu on the left is plain links, a character keeps its colour, WIP is a word', async ({ page }) => {
    // One entry as js/pagebuilder.js builds a WIP character's, placed in the
    // real menu, so no roster content decides the answer.
    const read = async () => {
        await expect(page.locator('.global-sidebar-left .toc-list').first()).toBeAttached();
        return page.evaluate(() => {
            const list = document.querySelector('.global-sidebar-left .toc-list');
            list.classList.remove('hidden');
            list.insertAdjacentHTML('afterbegin', `<li><a href="#" class="btn-nav" id="t-menu-link">
                <span class="toc-link-text" style="color: hsl(0, 100%, 80%); font-weight: bold;">Vessel</span>
                <span class="update-badge badge-wip update-badge-inline">WIP</span></a></li>`);
            const a = document.getElementById('t-menu-link');
            const cs = getComputedStyle(a);
            const badge = getComputedStyle(a.querySelector('.update-badge'));
            return {
                ground: cs.backgroundColor, border: cs.borderTopWidth, leftEdge: cs.borderLeftWidth,
                nameColour: getComputedStyle(a.querySelector('.toc-link-text')).color,
                badgeGround: badge.backgroundColor, badgeColour: badge.color, badgeBorder: badge.borderTopWidth,
            };
        });
    };
    await boot(page, 'default');
    const usual = await read();
    expect(usual.border, 'Default draws each link as a box').not.toBe('0px');
    expect(usual.badgeGround, 'and WIP as a filled tag').not.toBe('rgba(0, 0, 0, 0)');

    await boot(page, 'classic');
    expect(await read()).toEqual({
        ground: 'rgba(0, 0, 0, 0)', border: '0px', leftEdge: '0px',
        nameColour: 'rgb(255, 153, 153)',
        // --accent-yellow, hsl(45, 93%, 47%).
        badgeGround: 'rgba(0, 0, 0, 0)', badgeColour: 'rgb(231, 176, 8)', badgeBorder: '0px',
    });
});

test('My Submissions takes Classic, before its body is built, with each submission ruled off', async ({ page }) => {
    // Owner, 2026-11-20: "My Submissions page is not Classic look despite
    // selecting the setting, probably an oversight". It was counted with the
    // staff pages; it is a reader's own page.
    const show = () => page.evaluate(async () => {
        const at = '2026-11-19T18:52:00Z';
        const revisions = [
            { id: 'r-1', page_id: 'locust_guy', author_id: 'me', status: 'pending', is_delta: false, created_at: at, qa_metadata: { changelog: 'One.' } },
            { id: 'r-2', page_id: 'locust_guy', author_id: 'me', status: 'approved', is_delta: false, created_at: at, qa_metadata: { changelog: 'Two.' } },
        ];
        window.supabaseClient = { from() { return { select() { return this; }, eq() { return this; }, order: async () => ({ data: revisions, error: null }) }; } };
        window.currentSessionUserId = 'me';
        await window.loadSubmissions();
        const cs = getComputedStyle(document.querySelector('.submission-card'));
        return {
            body: getComputedStyle(document.body).backgroundColor,
            ground: cs.backgroundColor, sides: cs.borderLeftWidth, rule: cs.borderBottomWidth,
            title: getComputedStyle(document.getElementById('submissions-page-title')).fontFamily,
        };
    });

    await boot(page, 'default', '/submissions.html');
    const usual = await show();
    expect(usual.sides, 'Default draws each submission as a box').not.toBe('0px');

    await boot(page, 'classic', '/submissions.html');
    expect(await page.evaluate(() => window.__classAtBody)).toMatch(/\blook-classic\b/);
    expect(await show()).toEqual({
        body: CLASSIC_BG, ground: 'rgba(0, 0, 0, 0)', sides: '0px', rule: '1px',
        title: 'Georgia, "Times New Roman", serif, serif',
    });
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
