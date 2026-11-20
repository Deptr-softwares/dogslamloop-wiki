// Every global a js/ file creates is read somewhere.
//
// Classic scripts share one window, so a window.X export or a top-level
// function that nothing calls is easy to leave behind and hard to spot. On
// 2026-11-20 there were 15 window exports nothing read. "Read" means named in
// js/, an HTML page or a test, anywhere other than where it is assigned.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'katana-move', 'medias', 'test-results', 'playwright-report', 'vendor']);

// Only with a reason the owner gave.
const KEPT_ON_PURPOSE = {
    // How a badge is awarded. The owner kept the badges when the Halloween
    // event that awarded them was removed (2026-11-14).
    earnBadge: 'js/site_utils.js',
};

function walk(dir, keep, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, keep, out);
        else if (keep(full)) out.push(full);
    }
    return out;
}

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');
const JS = walk(path.join(ROOT, 'js'), f => f.endsWith('.js'));
const CORPUS = [
    ...JS,
    ...walk(ROOT, f => f.endsWith('.html')),
    ...walk(path.join(ROOT, 'tests'), f => f.endsWith('.js')),
].map(f => fs.readFileSync(f, 'utf8')).join('\n');

function tally(matches) {
    const counts = new Map();
    for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);
    return counts;
}
const WORDS = tally(CORPUS.match(/[\w$]+/g));
// `window.x = x;` names x a second time on its own line.
const ALIASES = tally([...CORPUS.matchAll(/window\.([\w$]+)\s*=\s*\1(?![\w$])/g)].map(m => m[1]));

function definitions() {
    const found = new Map();
    const add = (name, where) => {
        if (!found.has(name)) found.set(name, []);
        found.get(name).push(where);
    };
    for (const file of JS) {
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            const where = `${rel(file)}:${i + 1}`;
            let m;
            if ((m = line.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=(?!=)/))) add(m[1], where);
            else if ((m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/))) add(m[1], where);
            else if ((m = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/))) add(m[1], where);
        });
    }
    return found;
}

test('the scan finds the globals it is meant to check', () => {
    const defs = definitions();
    expect(defs.get('escapeHtml')).toEqual([expect.stringMatching(/^js\/site_utils\.js:\d+$/)]);
    expect(defs.has('earnBadge')).toBe(true);
});

test('no global is created that nothing reads', () => {
    const unread = [];
    for (const [name, sites] of definitions()) {
        if (KEPT_ON_PURPOSE[name]) continue;
        const reads = (WORDS.get(name) || 0) - sites.length - (ALIASES.get(name) || 0);
        if (reads <= 0) unread.push(`${name} (${sites.join(', ')})`);
    }
    expect(unread).toEqual([]);
});

test('what is kept on purpose still exists', () => {
    const defs = definitions();
    for (const [name, file] of Object.entries(KEPT_ON_PURPOSE)) {
        expect(defs.get(name) || [], name).toEqual(expect.arrayContaining([expect.stringContaining(file)]));
    }
});
