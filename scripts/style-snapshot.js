#!/usr/bin/env node
/**
 * "Nothing visible changed", checked: every element's computed style on a set of
 * pages, in both looks, at a desktop and a phone width, and again with the pointer
 * held over the things that react to it, in the working tree against a base commit.
 * Local only, like visual.spec.js: it fetches live data and drives a real browser.
 *
 *   npm run snapshot -- [--base=<commit>] [--list] [page ...]
 *
 * --base is the commit to compare with (HEAD when left out, which shows uncommitted
 * work). A page is an address from the site root, like index.html; with none given,
 * one page of every kind is compared, the editor and staff pages included. --list
 * prints the pages and stops.
 *
 * The base is served from git's own objects and the working tree from disk, each on a
 * port of its own. Every request off localhost is fetched once and replayed to both,
 * and the clock is fixed, so both draw the same content. Every video is held with no
 * file, since its height comes from the file and may arrive in one tree only.
 *
 * A block of specimen markup is added to every page, for what a signed-out visit does
 * not draw. Its differences are listed apart from the page's own. Each is still a real
 * change to the cascade: a reader sees it on any page that draws that element with the
 * sheets this page loads. Only a page that never draws it, or never loads the sheet
 * that styles it, makes one harmless.
 *
 * A border colour on a side whose border style is none in both trees is left out: no
 * border is drawn there to show it.
 *
 * @since v1.3
 * @touches git (the base commit's files), the working tree, every request off localhost
 *   (fetched once, replayed)
 * @watch each difference prints the rules that set its first property in each tree, the
 *   last one listed being the strongest; a page state whose element count differs is
 *   compared only up to the first element that differs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const BASE = execFileSync('git', ['rev-parse', '--verify', `${option('base') || 'HEAD'}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
const PARALLEL = 3;
const FIXED = new Date('2026-01-01T12:00:00Z');
const STATES = [
    { look: 'default', width: 1400, height: 900 },
    { look: 'classic', width: 1400, height: 900 },
    { look: 'default', width: 390, height: 844 },
    { look: 'classic', width: 390, height: 844 },
];
// What reacts to the pointer, in either look. Up to 12 of each per page.
const HOVER = ['.btn-sys', '.btn-manga', '.filter-toggle', '.wiki-card', '.wiki-section', '.skill-entry-card',
    '.update-log-item', '.faq-details', '.roster-card', '.image-card-container', '.wiki-video-btn',
    '.inline-callout-btn', '.manga-select-trigger', '.manga-option', '.btn-nav', '.dock-action-btn',
    '.update-table tbody tr', '.sub-tab'];
// Sizes follow from everything else, so they are left out of the rules printed.
const GEOMETRY = /^(block-size|inline-size|height|width|perspective-origin|transform-origin|inset-.*|top|left|bottom|right|(min|max)-(block|inline)-size)$/;

// Every class a look styles that a signed-out visit may not draw. Laid over the page,
// out of its flow, so a change inside it cannot move the page's own elements.
const SPECIMEN = `
<div id="style-snapshot-specimen" class="space-y-6" style="position: absolute; top: 0; left: 0; width: 100%;">
  <h1 class="home-main-title">Home title</h1>
  <h2 class="site-title">Site title</h2>
  <section class="wiki-section"><h2 class="section-title">Section</h2><h3 class="strategy-title">Strategy</h3>
    <div class="wiki-card"><div class="card-header-title">Card header</div><h2 class="skill-title">Skill</h2></div></section>
  <section class="wiki-section submission-card"><p>Submission</p></section>
  <section class="wiki-section profile-card"><div class="profile-stat-row"><span class="profile-stat-label">Label</span><span class="profile-stat-val">Value</span></div>
    <h4 class="profile-trivia-title">Trivia</h4><h4 class="profile-pager-title">Next</h4></section>
  <div class="update-log-item"><p>Update</p></div>
  <details class="faq-details" open><summary>Q</summary><p>A</p></details>
  <div class="skill-entry-card"><p>Move</p></div>
  <div class="roster-card"><span class="roster-card-text">Name</span></div>
  <div class="image-card-container"><span>Image</span></div>
  <div class="playstyle-container"><div class="playstyle-col"><h4 class="playstyle-header">Strengths</h4>
    <ul class="playstyle-list"><li class="playstyle-item"><span class="playstyle-icon">+</span>Fast</li></ul></div></div>
  <div class="wiki-table-wrapper"><table class="update-table"><thead><tr><th>H</th></tr></thead>
    <tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table></div>
  <button class="wiki-video-btn">Play</button>
  <button class="btn-sys btn-sys-regular">Sys</button>
  <button class="btn-sys btn-sys-blue">Sys blue</button>
  <button class="btn-manga"><span class="btn-manga-content">Manga</span></button>
  <button class="btn-manga active"><span class="btn-manga-content">Active</span></button>
  <button class="filter-toggle">Filter</button>
  <button class="filter-toggle active">Filter on</button>
  <button class="inline-callout-btn">Callout</button>
  <div class="callout-tooltip"><div class="callout-tooltip-title">Tip</div><div class="callout-tooltip-desc">Desc</div></div>
  <details class="wiki-accordion-wrapper"><summary class="wiki-accordion-summary">Accordion</summary><div class="wiki-accordion-body">Body</div></details>
  <div class="sbox sbox-boxed"><div class="sbox-title">Box</div></div>
  <ul class="wiki-block-list wiki-block-list-boxed"><li>Item</li></ul>
  <div class="sub-tabs" role="tablist" aria-label="Specimen"><button class="sub-tab is-active">A</button><button class="sub-tab">B</button></div>
  <div class="manga-select-wrapper"><button class="manga-select-trigger">Pick</button>
    <div class="manga-select-options"><div class="manga-option selected">One</div><div class="manga-option is-active">Two</div><div class="manga-option">Three</div></div></div>
  <div class="manga-select-wrapper open"><button class="manga-select-trigger">Open</button>
    <div class="manga-select-options"><div class="manga-option selected">One</div><div class="manga-option">Two</div></div></div>
  <aside class="global-sidebar-left"><h3 class="sidebar-master-title">Menu</h3><h4 class="sidebar-nav-title">Group</h4>
    <button class="sidebar-nav-title sidebar-group-header">Toggle</button><button class="btn-nav">Link</button><button class="btn-nav active">Here</button>
    <span class="update-badge">WIP</span><span class="update-badge badge-ea">EA</span>
    <button class="btn-sys dock-action-btn"><span class="dock-action-icon">i</span>Inbox<span class="dock-badge">3</span></button>
    <button class="btn-sys btn-sys-purple dock-action-btn"><span class="dock-action-icon">o</span>Overseer</button></aside>
  <aside class="local-sidebar-right"><button class="btn-nav">Toc</button><button class="btn-nav toc-link-minor">Minor</button></aside>
  <div class="update-log-item admin-tool-card personnel"><h3 class="update-title admin-tool-title personnel">Personnel</h3></div>
  <div class="update-log-item admin-tool-card gc"><h3 class="update-title admin-tool-title gc">GC</h3></div>
  <div id="wiki-frame-tooltip">Tip</div>
  <button class="btn-manga btn-manga-slanted active tab-punch"><span class="btn-manga-content">Punch</span></button>
  <button class="filter-toggle btn-manga btn-manga-slanted active tab-punch"><span class="btn-manga-content">Filter punch</span></button>
</div>`;

/** One page of every kind, found in the site itself, so no page is named here. */
function defaultPages() {
    const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'navigation.json'), 'utf8'));
    const entries = Object.values(nav).flat().filter(e => e.url && e.cms_config && !e.isHidden);
    const pages = [];
    const seen = new Set();
    for (const e of entries) {
        const type = e.cms_config.pageType;
        // Every tool, since each can load a sheet of its own; one of every other kind.
        if (type !== 'tool' && seen.has(type)) continue;
        seen.add(type);
        pages.push(`/${e.url}`);
    }
    const first = entries.find(e => e.cms_config.pageType === 'character');
    // A dark colour gives a character's page its own title rules.
    const lookups = fs.readFileSync(path.join(ROOT, 'js', 'utility', 'site_lookups.js'), 'utf8');
    const w = {};
    new Function('window', 'document', 'getComputedStyle', lookups)(w, { addEventListener() {}, documentElement: {} }, () => ({ getPropertyValue: () => '' }));
    const dark = entries.find(e => e.cms_config.pageType === 'character' && w.CHARACTER_COLORS[e.name] && w.isDarkCharacterColor(w.CHARACTER_COLORS[e.name]));
    if (dark && dark !== first) pages.push(`/${dark.url}`);
    const tracked = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const moved = tracked.find(f => /<meta name="dsl-moved-page"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    if (moved) pages.push(`/${moved}`);
    const QUERY = {
        'history.html': `?page=${first.cms_config.pageId}`,
        'search.html': `?q=${encodeURIComponent(first.name)}`,
        'edit.html': `?char=${first.cms_config.pageId}&type=character&tab=overview`,
    };
    for (const f of tracked) {
        if (f.includes('/') && !/^(characters|systems)\/index\.html$|^systems\/(tierlist|updatelog)\/index\.html$/.test(f)) continue;
        // The Overseer's old address only forwards.
        if (f === 'admin.html') continue;
        const url = `/${f}${QUERY[f] || ''}`;
        if (!pages.includes(url)) pages.push(url);
    }
    return pages;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain', '.xml': 'application/xml' };

/** Serves one tree: the working tree from disk, or a commit from git. */
function serve(read) {
    const server = http.createServer(async (req, res) => {
        let file = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/+/, '');
        if (!file || file.endsWith('/')) file += 'index.html';
        let body = await read(file);
        if (!body) { res.writeHead(404); res.end(); return; }
        // A moved page's notice forwards at once; held still, it can be compared.
        if (file.endsWith('.html') && body.includes('dsl-moved-page')) {
            body = Buffer.from(body.toString('utf8').replace(/<script>location\.replace[^<]*<\/script>/, '').replace(/<meta http-equiv="refresh"[^>]*>/, ''));
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://localhost:${server.address().port}` })));
}
const fromDisk = file => fs.promises.readFile(path.join(ROOT, file)).catch(() => null);
const blobs = new Map();
const fromGit = file => {
    if (!blobs.has(file)) {
        blobs.set(file, new Promise(resolve => execFile('git', ['show', `${BASE}:${file}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 28 },
            (err, out) => resolve(err ? null : out))));
    }
    return blobs.get(file);
};

// Runs in the page: every element's computed style and its ::before and ::after,
// names sorted, custom properties left out.
const SNAPSHOT = (roots) => {
    // Every animation held at its start, so both trees are read at the same moment of it.
    document.getAnimations().forEach(a => { try { a.pause(); a.currentTime = 0; } catch (e) { /* a finished one cannot be held: it is left as it ended */ } });
    // Again at every read: the ratio, or a file the lazy loader set, can arrive after the
    // load-time hold.
    document.querySelectorAll('video').forEach(v => {
        const had = v.hasAttribute('src') || v.querySelector('source');
        v.removeAttribute('poster'); v.removeAttribute('data-lazy-src'); v.style.removeProperty('aspect-ratio');
        if (had) { v.removeAttribute('src'); v.querySelectorAll('source').forEach(s => s.remove()); v.load(); }
    });
    const read = (el, pseudo) => {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) return '';
        const names = [];
        for (let i = 0; i < cs.length; i++) if (!cs[i].startsWith('--')) names.push(cs[i]);
        names.sort();
        return names.map(n => `${n}:${cs.getPropertyValue(n).replace(/http:\/\/localhost:\d+/g, '')}`).join(';');
    };
    const els = roots || [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
    return els.map(el => ({
        key: [el.tagName.toLowerCase(), ...[...el.classList].filter(c => c !== 'look-classic')].join('.'),
        label: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`,
        specimen: !!el.closest('#style-snapshot-specimen'),
        s: [read(el, null), read(el, '::before'), read(el, '::after')],
    }));
};

const responses = new Map();
async function load(browser, origin, url) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.clock.setFixedTime(FIXED);
    await page.route(/^https?:\/\/(?!localhost)/, async route => {
        const req = route.request();
        // A video is a fixed file and comes in byte ranges, which do not replay well:
        // each tree fetches its own.
        if (req.resourceType() === 'media' || /\.(mp4|webm|mov)(\?|$)/i.test(req.url())) { await route.continue(); return; }
        const key = `${req.method()} ${req.url()} ${req.postData() || ''}`;
        if (!responses.has(key)) {
            responses.set(key, (async () => {
                try {
                    const r = await route.fetch();
                    const headers = Object.fromEntries(Object.entries(r.headers()).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k)));
                    return { status: r.status(), headers, body: await r.body() };
                } catch (e) {
                    return { status: 599, headers: {}, body: Buffer.from('') };
                }
            })());
        }
        const hit = await responses.get(key);
        // The answer names the origin that asked; the other tree asks from another port.
        const headers = { ...hit.headers };
        const asker = req.headers().origin;
        if (asker && headers['access-control-allow-origin'] && headers['access-control-allow-origin'] !== '*') headers['access-control-allow-origin'] = asker;
        await route.fulfill({ ...hit, headers });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + url, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    // Scrolled once to the end, so everything that loads on sight has loaded.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    // An image still on its way is 0px tall in one tree and full height in the other.
    await page.evaluate(() => Promise.race([
        Promise.all([...document.images].filter(i => !i.complete && i.loading !== 'lazy').map(i => new Promise(r => { i.addEventListener('load', r); i.addEventListener('error', r); }))),
        new Promise(r => setTimeout(r, 8000)),
    ]));
    // A video takes its height from its file, or from the ratio and still page_render.js
    // sets once the list of stills arrives, and either may come in one tree only: every
    // video is held with no file, no still and no inline ratio, in both.
    await page.evaluate(() => document.querySelectorAll('video').forEach(v => {
        v.removeAttribute('src'); v.removeAttribute('data-lazy-src'); v.removeAttribute('poster'); v.style.removeProperty('aspect-ratio');
        v.querySelectorAll('source').forEach(s => s.remove()); v.load();
    }));
    await page.evaluate(html => (document.querySelector('.main-content-area, main') || document.body).insertAdjacentHTML('beforeend', html), SPECIMEN);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    return { context, page, errors };
}

async function setState(page, state) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await page.evaluate(look => { if (window.siteSettings) window.siteSettings.set('look', look); }, state.look);
    await page.waitForTimeout(400);
}

async function snap(page, state) {
    await setState(page, state);
    return page.evaluate(`(${SNAPSHOT.toString()})()`);
}

/** The same, with :hover forced on each thing that reacts to it and on its ancestors. */
async function hoverSnap(page, look) {
    await setState(page, { look, width: 1400, height: 900 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const count = await page.evaluate(sels => {
        let n = 0;
        for (const s of sels) for (const el of [...document.querySelectorAll(s)].slice(0, 12)) el.setAttribute('data-snapshot-hover', String(n++));
        return n;
    }, HOVER);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const out = [];
    for (let i = 0; i < count; i++) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-snapshot-hover="${i}"]` });
        if (!nodeId) continue;
        await page.evaluate(i => { let el = document.querySelector(`[data-snapshot-hover="${i}"]`); while ((el = el && el.parentElement)) el.setAttribute('data-snapshot-above', ''); }, i);
        const above = (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-snapshot-above]' })).nodeIds;
        for (const n of [nodeId, ...above]) await cdp.send('CSS.forcePseudoState', { nodeId: n, forcedPseudoClasses: ['hover'] });
        out.push(...await page.evaluate(([i, src]) => {
            const el = document.querySelector(`[data-snapshot-hover="${i}"]`);
            return eval(`(${src})`)([el, ...el.querySelectorAll('*')].slice(0, 40)).map(x => ({ ...x, label: `hover ${x.label}` }));
        }, [i, SNAPSHOT.toString()]));
        for (const n of [nodeId, ...above]) await cdp.send('CSS.forcePseudoState', { nodeId: n, forcedPseudoClasses: [] });
        await page.evaluate(() => document.querySelectorAll('[data-snapshot-above]').forEach(e => e.removeAttribute('data-snapshot-above')));
    }
    await cdp.detach();
    return out;
}

const split = s => new Map(s ? s.split(';').map(p => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]) : []);

// A side's border colour draws nothing while that side has no border style, in both trees.
const unseen = (p, a, b) => {
    const side = /^border-(.+)-color$/.exec(p);
    return !!side && [a, b].every(m => /^(none|hidden)$/.test(m.get(`border-${side[1]}-style`)));
};

/** Each element that differs: its index, which of itself, ::before or ::after, and the properties. */
function diff(before, after) {
    const out = [];
    let count = null;
    if (before.length !== after.length) count = `element count ${before.length} -> ${after.length}`;
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
        if (before[i].key !== after[i].key) { out.push({ i, text: `element ${i} is ${before[i].key} -> ${after[i].key}: the pages drew different things`, specimen: false }); break; }
        for (let k = 0; k < 3; k++) {
            if (before[i].s[k] === after[i].s[k]) continue;
            const a = split(after[i].s[k]);
            const b = split(before[i].s[k]);
            const props = [...new Set([...a.keys(), ...b.keys()])].filter(p => a.get(p) !== b.get(p) && !unseen(p, a, b));
            if (!props.length) continue;
            out.push({ i, pseudo: ['', '::before', '::after'][k], props, specimen: after[i].specimen,
                sizeOnly: props.every(p => GEOMETRY.test(p)),
                text: `${after[i].label}${['', '::before', '::after'][k]}  ${props.map(p => `${p}: ${b.get(p)} -> ${a.get(p)}`).join('; ')}` });
        }
    }
    // An element that only moved or changed size follows from another's change, which is
    // listed. Only when nothing else changed are they listed, so nothing goes unseen.
    const items = out.some(x => !x.sizeOnly) ? out.filter(x => !x.sizeOnly) : out;
    return { count, items };
}

/** The rules that set a property on the i-th element (in SNAPSHOT's order), weakest first. */
async function rulesFor(page, i, pseudo, prop) {
    const cdp = await page.context().newCDPSession(page);
    const sheets = new Map();
    cdp.on('CSS.styleSheetAdded', e => sheets.set(e.header.styleSheetId, e.header.sourceURL));
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await page.evaluate(i => {
        const els = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
        els[i].setAttribute('data-snapshot-cause', '');
    }, i);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-snapshot-cause]' });
    const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    await page.evaluate(() => document.querySelector('[data-snapshot-cause]').removeAttribute('data-snapshot-cause'));
    await cdp.detach();
    const words = prop.split('-');
    // A shorthand sets the property too: border-top for border-top-color, padding for padding-top.
    const sets = name => name === prop || (name.split('-')[0] === words[0] && name.split('-').every(w => words.includes(w)));
    const rules = pseudo ? ((m.pseudoElements || []).find(p => `::${p.pseudoType}` === pseudo) || { matches: [] }).matches : m.matchedCSSRules || [];
    const out = [];
    for (const r of rules) {
        const rule = r.rule;
        for (const cp of (rule.style.cssProperties || []).filter(cp => cp.text && !cp.disabled && sets(cp.name))) {
            const file = (sheets.get(rule.styleSheetId) || rule.origin).replace(/^.*\/style\//, '').replace(/\?.*$/, '');
            const layer = (rule.layers || []).map(l => l.text).join('.');
            const media = (rule.media || []).map(x => x.text).join(' and ');
            const sel = rule.selectorList.selectors.filter((s, n) => r.matchingSelectors.includes(n)).map(s => s.text).join(', ');
            out.push(`${file}${layer ? ` [${layer}]` : ''}${media ? ` @media ${media}` : ''} ${sel} { ${cp.text.replace(/;$/, '')} }`);
        }
    }
    return out.slice(-4);
}

(async () => {
    // With or without the leading slash: Git Bash turns an argument that starts with one into a file path.
    const pages = args.filter(a => !a.startsWith('--')).map(a => `/${a.replace(/^\/+/, '')}`);
    const list = pages.length ? pages : defaultPages();
    if (args.includes('--list')) { console.log(list.join('\n')); return; }
    const base = await serve(fromGit);
    const now = await serve(fromDisk);
    console.log(`Comparing the working tree with ${BASE.slice(0, 8)} on ${list.length} pages.`);
    const browser = await chromium.launch();
    const totals = { page: 0, specimen: 0 };
    const queue = [...list];
    async function worker() {
        while (queue.length) {
            const url = queue.shift();
            const lines = [];
            const specimenLines = [];
            try {
                const before = await load(browser, base.origin, url);
                const after = await load(browser, now.origin, url);
                const report = async (label, d, withCauses) => {
                    const own = d.items.filter(x => !x.specimen);
                    const spec = d.items.filter(x => x.specimen);
                    lines.push(`${label}: ${own.length} differ${d.count ? ` (${d.count})` : ''}`);
                    if (own.length || d.count) totals.page++;
                    if (spec.length) { totals.specimen++; specimenLines.push(`${label}: ${spec.length} differ`); }
                    for (const x of d.items) {
                        const into = x.specimen ? specimenLines : lines;
                        into.push(`    ${x.text}`);
                        const prop = x.props && (x.props.find(p => !GEOMETRY.test(p) && !/-(block|inline)(-|$)|^-webkit-/.test(p)) || x.props.find(p => !GEOMETRY.test(p)));
                        if (withCauses && prop) {
                            into.push(`      ${prop}, base: ${(await rulesFor(before.page, x.i, x.pseudo, prop)).join('  <  ') || 'no rule'}`);
                            into.push(`      ${prop}, now:  ${(await rulesFor(after.page, x.i, x.pseudo, prop)).join('  <  ') || 'no rule'}`);
                        }
                    }
                };
                for (const state of STATES) {
                    const b = await snap(before.page, state);
                    const a = await snap(after.page, state);
                    await report(`${state.look}/${state.width}`, diff(b, a), true);
                }
                for (const look of ['default', 'classic']) {
                    const b = await hoverSnap(before.page, look);
                    const a = await hoverSnap(after.page, look);
                    await report(`hover/${look}`, diff(b, a), false);
                }
                const newErrors = after.errors.filter(e => !before.errors.includes(e));
                if (newErrors.length) { totals.page++; lines.push(`new page errors: ${newErrors.join(' | ')}`); }
                await before.context.close();
                await after.context.close();
            } catch (e) {
                totals.page++;
                lines.push(`FAILED: ${e.message.split('\n')[0]}`);
            }
            console.log(`${url}\n  ${lines.join('\n  ')}${specimenLines.length ? `\n  specimen only:\n    ${specimenLines.join('\n    ')}` : ''}`);
        }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    await browser.close();
    base.server.close();
    now.server.close();
    console.log(totals.page ? `${totals.page} page states differ on the page itself.` : 'Every page state is the same on the page itself.');
    if (totals.specimen) console.log(`${totals.specimen} differ in the specimen only: each is a real change for any page that draws it.`);
    process.exitCode = totals.page ? 1 : 0;
})();
