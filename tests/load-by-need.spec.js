// Files only some pages need are loaded only by those pages. For each one, a
// page loads it exactly when something the page runs (its own inline scripts and
// markup, or another file it loads) calls a function the file defines. Comments
// do not count. Node only: the pages and scripts/page-scripts.js's lists, never
// the generated content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const { HAND_WRITTEN, scriptTags } = require('../scripts/page-scripts.js');
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
