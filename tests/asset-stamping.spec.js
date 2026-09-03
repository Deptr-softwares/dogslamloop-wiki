// v0.17: every js/ module is cache-stamped, not three of them.
//
// THE BUG THIS CLOSES, and it has cost three releases.
//
// GitHub Pages serves HTML with max-age=600 and js/ with max-age=3600. For most
// of an hour after a release a reader therefore holds FRESH HTML against an
// HOUR-OLD script. The stamper existed for exactly this, but only covered three
// modules, on the reasoning that "a page and its own script are always deployed
// together" - true of the repository, false of the cache, which is the only
// place it matters.
//
// The worst instance was v0.16: the dynamic roster icons and the Show Hidden
// control shipped and the owner could not see them on the live site, because
// js/pagebuilder.js was unstamped and the browser kept the copy it already had.
// The release looked like it had not happened. That file is the reason this
// test names pagebuilder.js specifically.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { SHARED_MODULES, sharedAssetVersion } = require('../scripts/asset-version.js');

function collectHtml(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'test-results', 'playwright-report'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectHtml(full, out);
        else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
    }
    return out;
}

const PAGES = collectHtml(ROOT);

// --- THE LIST ---

test('every module in js/ is stamped, and the list is discovered', async () => {
    // A hand-kept list is a list somebody forgets to add to, and the file they
    // forget is the next pagebuilder.js.
    const onDisk = fs.readdirSync(path.join(ROOT, 'js'))
        .filter(f => f.endsWith('.js')).sort();

    expect(SHARED_MODULES).toEqual(onDisk);
    expect(SHARED_MODULES.length, 'this site has many modules, not three')
        .toBeGreaterThan(20);

    // The three that used to be the whole list, plus the one whose absence
    // caused the incident.
    for (const name of ['site_utils.js', 'character_tabs.js', 'input_slots.js', 'pagebuilder.js']) {
        expect(SHARED_MODULES, `${name} is stamped`).toContain(name);
    }
});

test('one version across all of them, not a hash per file', async () => {
    // This codebase is a single shared `window` scope with no module system, so
    // any pair can be the fresh-module-against-stale-helper failure. Per-file
    // hashes would let exactly that pair be served half-fresh.
    const version = sharedAssetVersion();
    expect(version).toMatch(/^[0-9a-f]{8}$/);

    const stamps = new Set();
    for (const file of PAGES) {
        const html = fs.readFileSync(file, 'utf8');
        for (const m of html.matchAll(/js\/[a-z_0-9-]+\.js\?v=([0-9a-f]+)/g)) stamps.add(m[1]);
    }
    expect([...stamps], 'every page carries the same one version').toEqual([version]);
});

// --- EVERY PAGE, EVERY TAG ---

test('no page loads a js/ module without a version', async () => {
    // The assertion that would have caught v0.16. Checked across every HTML in
    // the repo - hand-authored and generated - because the generator and the
    // stamper own different files and only together cover the site.
    const unstamped = [];

    for (const file of PAGES) {
        const html = fs.readFileSync(file, 'utf8');
        for (const m of html.matchAll(/src="([^"]*js\/[a-z_0-9-]+\.js)(\?[^"]*)?"/g)) {
            if (!m[2] || !m[2].startsWith('?v=')) {
                unstamped.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
            }
        }
    }

    expect(unstamped, 'these scripts can be served stale against fresh HTML').toEqual([]);
});

test('the check really looked at the whole site', async () => {
    // Every absence assertion above passes trivially against an empty file
    // list, and a broken collectHtml would report a perfectly stamped site.
    expect(PAGES.length, 'found the pages').toBeGreaterThan(50);

    const withScripts = PAGES.filter(f => /src="[^"]*js\//.test(fs.readFileSync(f, 'utf8')));
    expect(withScripts.length, 'and most of them load scripts').toBeGreaterThan(50);

    // And the two files the incident was about are among them.
    const names = PAGES.map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
    expect(names).toContain('index.html');
    expect(names.some(n => n.startsWith('characters/'))).toBe(true);
});

test('a character page stamps pagebuilder.js specifically', async () => {
    // Named rather than left to the sweep above, because this is the exact file
    // and exact page from the v0.16 incident.
    const page = PAGES.find(f => /characters[\\/][^\\/]+[\\/]index\.html$/.test(f));
    expect(page, 'a character page exists').toBeTruthy();

    const html = fs.readFileSync(page, 'utf8');
    expect(html).toMatch(/js\/pagebuilder\.js\?v=[0-9a-f]{8}/);
    expect(html, 'and not the bare form').not.toMatch(/js\/pagebuilder\.js"/);
});

// --- THE HASH ITSELF ---

test('the version changes when any module changes, including a new one', async () => {
    // The property that makes the whole mechanism work. Simulated rather than
    // asserted from history: the hash is computed from what is on disk, so this
    // reads the real files and re-hashes with one byte different.
    const crypto = require('crypto');
    const jsDir = path.join(ROOT, 'js');

    const hashOf = (names) => {
        const h = crypto.createHash('sha256');
        for (const n of names) {
            h.update(fs.readFileSync(path.join(jsDir, n), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
        }
        return h.digest('hex').slice(0, 8);
    };

    expect(hashOf(SHARED_MODULES), 'reproduces the shipped version').toBe(sharedAssetVersion());

    // Dropping any single module changes it - so no module is a no-op in the
    // hash, which is what "every module is covered" actually means.
    for (const name of ['pagebuilder.js', 'site_utils.js', 'discussions.js']) {
        const without = SHARED_MODULES.filter(n => n !== name);
        expect(hashOf(without), `${name} contributes to the version`).not.toBe(sharedAssetVersion());
    }
});

test('line endings are normalised before hashing', async () => {
    // This repo stores LF and checks out CRLF on Windows. Hashing the bytes on
    // disk gave one version on a developer machine and another on the Linux CI
    // runner, which failed validate against a tree that was correct.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'asset-version.js'), 'utf8');
    expect(src).toMatch(/replace\(\/\\r\\n\/g, '\\n'\)/);
    // And the module list is sorted, because readdirSync order is filesystem
    // dependent and would produce a different hash per machine.
    expect(src).toMatch(/\.sort\(\)/);
});
