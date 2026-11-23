// Files only some pages need are loaded only by those pages. For each one, a
// page loads it exactly when something the page runs (its own inline scripts or
// another file it loads) calls a function the file defines. Node only: the
// pages and scripts/page-scripts.js's lists, never the generated content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { HAND_WRITTEN, scriptTags } = require('../scripts/page-scripts.js');
const { GENERATED_PAGE_TYPES } = require('../scripts/page-types.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const loadedFiles = html => [...html.matchAll(/<script\b[^>]*\ssrc="([^"?]+)/g)]
    .map(m => m[1].replace(/^(\.\.\/|\/)+/, ''));
const inlineScripts = html => [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// Every page as what it runs: a hand-written page from disk, a generated one
// from its list (a stub's only inline script sets PAGE_ROUTE).
function pages() {
    const handWritten = Object.keys(HAND_WRITTEN).map(file => {
        const html = read(file);
        return { name: file, files: loadedFiles(html), inline: inlineScripts(html) };
    });
    const generated = [...GENERATED_PAGE_TYPES].map(kind => ({
        name: `a generated ${kind} page`, files: loadedFiles(scriptTags(kind, '../../')), inline: '',
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
        const runs = [page.inline, ...page.files.filter(f => f !== file).map(read)].join('\n');
        const needs = calls.test(runs);
        const loads = page.files.includes(file);
        if (needs !== loads) wrong.push(`${page.name}: ${needs ? 'calls it but does not load it' : 'loads it and never calls it'}`);
    }
    expect(wrong).toEqual([]);
}

test('only the hubs load the roster and directories, and every hub that draws one does', () => {
    loadsExactlyWhereCalled('js/dashboards/hub_roster.js');
});
