// The comment rule (.claude/rules/practice-comments.md), in every script and
// stylesheet in js/ and style/. Node only.
//
// A comment says what the code is for and why. Dates, the owner's words, PR,
// batch and item numbers go in the area's docs/ page and in git, and a comment
// that holds one goes stale the day it is written. A new file meets the rule
// from its first commit.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');

// Every script and stylesheet in js/ and style/. The vendor library is left
// out: its licence header is not ours to change.
function filesIn(dir) {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
        const file = `${dir}/${entry.name}`;
        return entry.isDirectory() ? filesIn(file) : [file];
    });
}
const FILES = [...filesIn('js'), ...filesIn('style')]
    .filter(file => /\.(js|css)$/.test(file) && !file.startsWith('js/vendor/'))
    .sort();

// What a comment never holds. A PR number is #NNN on its own, never a colour,
// and "(owner" is the owner's words, never a file name like "(owner.js)".
const BANNED = [
    [/\b20\d\d-\d\d-\d\d\b/, 'a date'],
    [/(?:^|[\s(,])#\d{2,3}(?=[\s),.;:]|$)/m, 'a PR number'],
    [/\b(?:batch|item) \d/i, 'a batch or item number'],
    [/\bv\d+\.\d+\s+(?:[A-Z]{1,2}\d+|Part \d)\b/, 'a roadmap item'],
    [/\(owner\b(?!\.[a-z])|\bowner, \d|\bowner's (?:call|words|list|pick|request|wording)\b/i, "the owner's words"],
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

test('the list is every script and stylesheet, the vendor library left out', () => {
    // A walk that found nothing would pass every test below.
    expect(FILES).toContain('js/utility/site_utils.js');
    expect(FILES).toContain('style/Layout.css');
    expect(FILES.filter(file => file.startsWith('js/vendor/'))).toEqual([]);
});

test('every file opens with a block that says when it came in', () => {
    const wrong = [];
    for (const file of FILES) {
        const first = commentsOf(file)[0];
        const opens = first && first.at === 0 && (file.endsWith('.css') ? first.text.startsWith('/*') : first.text.startsWith('/**'));
        const since = first && (file.endsWith('.css') ? /\bSince v\d+\.\d+/ : /@since v\d+\.\d+/).test(first.text);
        if (!opens || !since) wrong.push(`${file}: ${opens ? 'its opening block has no ' + (file.endsWith('.css') ? '"Since vX.Y"' : '@since vX.Y') : 'does not open with a block'}`);
    }
    expect(wrong).toEqual([]);
});

test("no comment holds a date, a PR or item number, or the owner's words", () => {
    const found = [];
    for (const file of FILES) {
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
    for (const file of FILES) {
        for (const c of commentsOf(file)) {
            for (const m of c.text.matchAll(/\bdocs\/[\w-]+\.md\b/g)) {
                if (!fs.existsSync(path.join(ROOT, m[0]))) missing.push(`${file}:${c.line}: ${m[0]}`);
            }
        }
    }
    expect(missing).toEqual([]);
});
