// One HTML escape helper: window.escapeHtml, in js/utility/site_utils.js.
//
// Until 2026-11 there were 48 local copies of it, and 37 of them fell back to
// the raw, unescaped text when window.escapeHtml was missing. That never ran,
// because site_utils.js loads first on every page, but a check that fails open
// puts contributor text into the page as markup the day it does run.
//
// page_router.js keeps its own copy: it runs before site_utils.js loads.
// RegExp syntax has one helper too, window.escapeRegExp.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');
const MAY_DEFINE_IT = new Set(['utility/site_utils.js', 'pages/core/page_router.js']);

function jsFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'vendor') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) jsFiles(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const SOURCES = jsFiles(JS).map(file => ({
    name: path.relative(JS, file).replace(/\\/g, '/'),
    lines: fs.readFileSync(file, 'utf8').split(/\r?\n/),
}));

function linesMatching(pattern, skip = () => false) {
    const hits = [];
    for (const { name, lines } of SOURCES) {
        if (skip(name)) continue;
        lines.forEach((line, i) => { if (pattern.test(line)) hits.push(`${name}:${i + 1}`); });
    }
    return hits;
}

test('the scan reads the files that define the helper', () => {
    const names = SOURCES.map(s => s.name);
    expect(names).toContain('utility/site_utils.js');
    expect(linesMatching(/^window\.escapeHtml = function/)).toEqual(['utility/site_utils.js:' + (SOURCES
        .find(s => s.name === 'utility/site_utils.js').lines.findIndex(l => /^window\.escapeHtml = function/.test(l)) + 1)]);
});

test('nothing falls back to unescaped text when an escape helper is missing', () => {
    // Any escape-named helper, not only escapeHtml: owner-tier-lists.js fell
    // back to the raw value through window.ownerEscape.
    expect(linesMatching(/window\.\w*[Ee]scape\w*\s*\?|typeof\s+window\.\w*[Ee]scape/)).toEqual([]);
});

test('no other file keeps its own copy of the escape', () => {
    // A copy escapes quotes. format_tags.js's escPageText escapes only &,
    // < and >, on purpose: it matches how the browser writes text back out.
    expect(linesMatching(/&quot;/, name => MAY_DEFINE_IT.has(name))).toEqual([]);
});

test('RegExp syntax is escaped by one helper too', () => {
    // window.escapeRegExp, next to escapeHtml: five files carried their own.
    expect(linesMatching(/'\\\\\$&'/, name => name === 'utility/site_utils.js')).toEqual([]);
    expect(linesMatching(/^window\.escapeRegExp = function/)).toHaveLength(1);
});

test('no local alias renames it', () => {
    // One name, so an escaped value reads the same in every file.
    // The helper itself (`= window.escapeHtml;`), or an arrow that only passes
    // its own parameter through to it.
    expect(linesMatching(/\b(const|let|var)\s+[\w$]+\s*=\s*window\.escapeHtml\s*;/)).toEqual([]);
    expect(linesMatching(/\b(const|let|var)\s+[\w$]+\s*=\s*\(?\s*([\w$]+)\s*\)?\s*=>\s*\(?\s*window\.escapeHtml\(\s*(String\(\s*)?\2\b/)).toEqual([]);
    const wrappers = SOURCES.flatMap(({ name, lines }) =>
        [...lines.join('\n').matchAll(/function\s+([\w$]+)\s*\(([\w$]+)\)\s*\{\s*return\s+window\.escapeHtml\(\2\);?\s*\}/g)]
            .map(m => `${name}: ${m[1]}`));
    expect(wrappers).toEqual([]);
});
