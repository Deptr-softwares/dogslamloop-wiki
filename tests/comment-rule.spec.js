// The comment rule (.claude/rules/practice-comments.md), in the files trimmed to
// it so far. Node only.
//
// A comment says what the code is for and why. Dates, the owner's words, PR,
// batch and item numbers go in the area's docs/ page and in git, and a comment
// that holds one goes stale the day it is written. A file joins TRIMMED when
// Stage B trims it, so new code in it meets the rule from then on; once the trim
// is done the list is every file in js/ and style/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');

const TRIMMED = [
    'js/pages/core/description.js',
    'js/pages/core/framedata.js',
    'js/pages/core/internalstyling.js',
    'js/pages/core/character_modes.js',
    'js/utility/input_slots.js',
    'js/utility/character_tabs.js',
    'js/pages/core/page_router.js',
    'js/pages/core/page_boot.js',
    'js/pages/core/page_rescue.js',
    'js/utility/search.js',
    'js/pages/types/tool_page.js',
    'js/pages/types/gallery.js',
];

// What a comment never holds. A PR number is #NNN on its own, never a colour.
const BANNED = [
    [/\b20\d\d-\d\d-\d\d\b/, 'a date'],
    [/(?:^|[\s(,])#\d{2,3}(?=[\s),.;:]|$)/m, 'a PR number'],
    [/\b(?:batch|item) \d/i, 'a batch or item number'],
    [/\bv\d+\.\d+\s+(?:[A-Z]{1,2}\d+|Part \d)\b/, 'a roadmap item'],
    [/\(owner\b|\bowner, \d|\bowner's (?:call|words|list|pick|request|wording)\b/i, "the owner's words"],
];

// Every comment in a file, with the line it starts on.
function commentsOf(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file.endsWith('.css')) {
        return [...src.matchAll(/\/\*[\s\S]*?\*\//g)].map(m => ({
            text: m[0], at: m.index, line: src.slice(0, m.index).split('\n').length,
        }));
    }
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script', comment: true, range: true, loc: true });
    return ast.comments.map(c => ({ text: src.slice(c.range[0], c.range[1]), at: c.range[0], line: c.loc.start.line }));
}

test('every trimmed file opens with a block that says when it came in', () => {
    const wrong = [];
    for (const file of TRIMMED) {
        if (!fs.existsSync(path.join(ROOT, file))) { wrong.push(`${file}: not in the repo (renamed? update TRIMMED)`); continue; }
        const first = commentsOf(file)[0];
        const opens = first && first.at === 0 && (file.endsWith('.css') ? first.text.startsWith('/*') : first.text.startsWith('/**'));
        const since = first && (file.endsWith('.css') ? /\bSince v\d+\.\d+/ : /@since v\d+\.\d+/).test(first.text);
        if (!opens || !since) wrong.push(`${file}: ${opens ? 'its opening block has no ' + (file.endsWith('.css') ? '"Since vX.Y"' : '@since vX.Y') : 'does not open with a block'}`);
    }
    expect(wrong).toEqual([]);
});

test("no comment in a trimmed file holds a date, a PR or item number, or the owner's words", () => {
    const found = [];
    for (const file of TRIMMED) {
        for (const c of commentsOf(file)) {
            for (const [pattern, what] of BANNED) {
                const m = pattern.exec(c.text);
                if (m) found.push(`${file}:${c.line}: ${what}: "${m[0].trim()}"`);
            }
        }
    }
    expect(found).toEqual([]);
});

test('every docs page a comment points at exists', () => {
    const missing = [];
    for (const file of TRIMMED) {
        for (const c of commentsOf(file)) {
            for (const m of c.text.matchAll(/\bdocs\/[\w-]+\.md\b/g)) {
                if (!fs.existsSync(path.join(ROOT, m[0]))) missing.push(`${file}:${c.line}: ${m[0]}`);
            }
        }
    }
    expect(missing).toEqual([]);
});
