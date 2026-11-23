// Files only some pages need are loaded only by those pages. For each script, a
// page loads it exactly when something the page runs (its own inline scripts and
// markup, or another file it loads) calls a function the file defines. Comments
// do not count. For each sheet split from Layout.css, a kind of page loads it
// exactly when it loads what draws it, and a real page draws no class that only
// a sheet it skips styles. Node, but for that last check: the pages and
// scripts/page-scripts.js's lists, never the generated content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const { HAND_WRITTEN, PAGE_SCRIPTS, PAGE_STYLES, SPLIT_FROM_LAYOUT, scriptTags } = require('../scripts/page-scripts.js');
const { GENERATED_PAGE_TYPES } = require('../scripts/page-types.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const loadedFiles = html => [...html.matchAll(/<script\b[^>]*\ssrc="([^"?]+)/g)]
    .map(m => m[1].replace(/^(\.\.\/|\/)+/, ''));

// A script with its comments taken out. The home page's boot script is a module.
function code(source) {
    const parse = sourceType => espree.parse(source, { ecmaVersion: 'latest', sourceType, comment: true, range: true });
    let ast;
    try { ast = parse('script'); } catch (e) { ast = parse('module'); }
    return ast.comments.reduceRight((out, c) => out.slice(0, c.range[0]) + out.slice(c.range[1]), source);
}

// Each file parsed once: the Supabase library is on nearly every page.
const parsed = new Map();
const fileCode = file => parsed.get(file) || parsed.set(file, code(read(file))).get(file);

// What a hand-written page runs besides its files: its inline scripts, and its
// markup (an onclick names a function too), HTML comments left out.
function ownCode(html) {
    const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => code(m[1]));
    const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    return [...inline, markup].join('\n');
}

// Every page as what it runs: a hand-written page from disk, a generated one
// from its list (a stub's only inline script sets PAGE_ROUTE).
function pages() {
    const handWritten = Object.keys(HAND_WRITTEN).map(file => {
        const html = read(file);
        return { name: file, files: loadedFiles(html), own: ownCode(html) };
    });
    const generated = [...GENERATED_PAGE_TYPES].map(kind => ({
        name: `a generated ${kind} page`, files: loadedFiles(scriptTags(kind, '../../')), own: '',
    }));
    return [...handWritten, ...generated];
}

// The names a file puts on window: what another file would call.
const definedBy = file => [...read(file).matchAll(/^window\.([A-Za-z_]\w*)\s*=/gm)].map(m => m[1]);

function loadsExactlyWhereCalled(file) {
    const names = definedBy(file);
    expect(names.length, `${file} defines something`).toBeGreaterThan(0);
    const calls = new RegExp(`\\b(${names.join('|')})\\b`);
    const wrong = [];
    for (const page of pages()) {
        const runs = [page.own, ...page.files.filter(f => f !== file).map(fileCode)].join('\n');
        const needs = calls.test(runs);
        const loads = page.files.includes(file);
        if (needs !== loads) wrong.push(`${page.name}: ${needs ? 'calls it but does not load it' : 'loads it and never calls it'}`);
    }
    expect(wrong).toEqual([]);
}

test('only the hubs load the roster and directories, and every hub that draws one does', () => {
    loadsExactlyWhereCalled('js/dashboards/hub_roster.js');
});

test('only the pages that apply a submission load the delta engine', () => {
    loadsExactlyWhereCalled('js/utility/submission_delta.js');
});

test('only the Forum loads the discussion with its page; a character page loads it from page_boot.js', () => {
    const thread = /^js\/(utility\/emoji|pages\/community\/discussions)\.js$/;
    const eager = pages().filter(page => page.files.some(file => thread.test(file))).map(page => page.name);
    expect(eager).toEqual(['forum.html']);

    const boot = read('js/pages/core/page_boot.js');
    for (const file of ['js/utility/emoji.js', 'js/pages/community/discussions.js']) {
        expect(boot, `page_boot.js loads ${file}`).toContain(`'${file}'`);
        expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
    }
});

test('no page loads the account boxes with its tags; site_account.js loads them on first open', () => {
    const file = 'js/utility/account_boxes.js';
    expect(pages().filter(page => page.files.includes(file)).map(page => page.name)).toEqual([]);
    expect(read('js/utility/site_account.js')).toContain(`'${file}'`);
    expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
});

// What draws each sheet split from Layout.css: a kind of page loads the sheet
// exactly when it loads one of these scripts. Every tool page loads tierlist.css,
// since the tier list tools are tools.
const TOOL_PAGE = 'a tool page';
const DRAWN_BY = {
    'Blocks.css': ['pages/core/page_render.js'],
    'dashboards.css': ['dashboards/hub_roster.js'],
    'posts.css': ['pages/community/posts.js'],
    'tierlist.css': ['pages/tier-lists/tierlist.js', 'pages/tier-lists/tier-editor.js', TOOL_PAGE],
    'search-page.css': ['pages/records/search-page.js'],
    'post-editor.css': ['owner/post-editor.js'],
};

test('each sheet split from Layout.css loads right after it, on exactly the kinds that draw it', () => {
    expect(Object.keys(DRAWN_BY).sort(), 'every split sheet says what draws it').toEqual([...SPLIT_FROM_LAYOUT].sort());
    const wrong = [];
    for (const [kind, sheets] of Object.entries(PAGE_STYLES)) {
        const scripts = (PAGE_SCRIPTS[kind] || []).map(entry => (typeof entry === 'string' ? entry : entry.src));
        const loads = SPLIT_FROM_LAYOUT.filter(sheet => sheets.includes(sheet));
        const draws = SPLIT_FROM_LAYOUT.filter(sheet => DRAWN_BY[sheet]
            .some(script => scripts.includes(script) || (script === TOOL_PAGE && kind === 'tool')));
        if (loads.join() !== draws.join()) wrong.push(`${kind} loads [${loads}] but draws [${draws}]`);
        // Right after Layout.css and in SPLIT_FROM_LAYOUT's order, so each rule
        // keeps its place against every other sheet.
        const at = sheets.indexOf('Layout.css');
        if (sheets.slice(at + 1, at + 1 + loads.length).join() !== loads.join()) {
            wrong.push(`${kind}: [${loads}] are not right after Layout.css`);
        }
    }
    expect(wrong).toEqual([]);
});

// The classes a stylesheet's selectors name, comments left out. Each sheet read once.
const sheetClasses = new Map();
const classesIn = file => {
    if (sheetClasses.has(file)) return sheetClasses.get(file);
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1]).filter(s => !s.trim().startsWith('@'));
    const names = new Set(selectors.flatMap(s => [...s.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)]
        .map(m => m[1].replace(/\\(.)/g, '$1'))));
    sheetClasses.set(file, names);
    return names;
};

for (const url of [
    '/characters/Boomcat/index.html', '/systems/fundamentals/index.html', '/others/emotes/index.html',
    '/tools/create-tier-list/index.html', '/index.html', '/characters/index.html', '/systems/index.html',
    '/systems/tierlist/index.html', '/systems/updatelog/index.html', '/blog.html', '/forum.html',
    '/history.html?page=boomcat', '/recent-changes.html', '/search.html?q=boomcat', '/privacy-policy.html',
    '/submissions.html', '/edit.html?char=boomcat&type=character&tab=overview',
]) {
    test(`${url} draws no class that only a split sheet it skips would style`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        // What loads on approach, the discussion, comes in too.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        const { sheets, drawn } = await page.evaluate(() => ({
            sheets: [...document.querySelectorAll('link[rel="stylesheet"]')]
                .map(l => new URL(l.href).pathname.replace(/^\//, '')),
            drawn: [...new Set([...document.querySelectorAll('[class]')].flatMap(el => [...el.classList]))],
        }));
        expect(sheets, 'the page loads Layout.css').toContain('style/Layout.css');
        const styledHere = new Set(sheets.flatMap(file => [...classesIn(file)]));
        const skipped = SPLIT_FROM_LAYOUT.map(s => `style/${s}`).filter(file => !sheets.includes(file));
        const unstyled = drawn.filter(name => !styledHere.has(name)
            && skipped.some(file => classesIn(file).has(name)));
        expect(unstyled, `classes only ${skipped.join(', ')} style`).toEqual([]);
    });
}
