// The js/ folders (owner, 2026-11-21): every module sits in a folder named for
// what it is for, and moving one breaks nothing a reader or a rule can see.
//
// THE BUG THIS GUARDS. A page tag still naming a module's old path loads
// nothing, and the checks that existed could not see it: the stamper rewrites
// only the paths it knows, so a stale tag keeps its old ?v= and passes
// asset-stamping.spec. A rule in .claude/rules/ whose path is stale stops
// loading without a word, and a stamper that no longer finds the pages it owns
// reports them "up to date" until the next change to js/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { SHARED_MODULES } = require('../scripts/asset-version.js');

const ROOT = path.join(__dirname, '..');
// The owner's top folders. editor/ and pages/ have folders of their own inside.
const FOLDERS = ['utility', 'pages', 'dashboards', 'editor', 'overseer', 'owner', 'others'];
const NESTED = ['editor', 'pages'];

// Tracked pages only, so the owner's own folders on disk never count.
const PAGES = execSync('git ls-files -- "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);

const scriptsOf = (page) => [...fs.readFileSync(path.join(ROOT, page), 'utf8')
    .matchAll(/<script\b[^>]*\bsrc="([^"?#]+)/g)]
    .map(m => m[1])
    .filter(src => !/^(https?:)?\/\//.test(src))
    .map(src => ({ src, file: src.startsWith('/') ? path.join(ROOT, src) : path.join(ROOT, path.dirname(page), src) }));

test('every script a page loads is a file that exists', () => {
    const missing = [];
    const read = new Set();
    for (const page of PAGES) {
        for (const { src, file } of scriptsOf(page)) {
            read.add(page);
            if (!fs.existsSync(file)) missing.push(`${page} -> ${src}`);
        }
    }
    // A root page, a page two folders down, and 404.html's root-relative tags.
    for (const page of ['index.html', 'systems/tierlist/index.html', '404.html']) {
        expect([...read], `${page} was read`).toContain(page);
    }
    expect(missing, 'these tags load nothing').toEqual([]);
});

test('every module sits in one of the folders, and editor/ and pages/ one deeper', () => {
    const misplaced = SHARED_MODULES.filter(name => {
        const parts = name.split('/');
        if (!FOLDERS.includes(parts[0])) return true;
        return parts.length !== (NESTED.includes(parts[0]) ? 3 : 2);
    });
    expect(SHARED_MODULES.length, 'the list was read').toBeGreaterThan(0);
    expect(misplaced).toEqual([]);
});

test('every path a rule loads with is a file that exists', () => {
    const dir = path.join(ROOT, '.claude', 'rules');
    const stale = [];
    let named = 0;
    for (const rule of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const head = fs.readFileSync(path.join(dir, rule), 'utf8').match(/^---\n([\s\S]*?)\n---/);
        if (!head) continue;
        for (const m of head[1].matchAll(/^\s*-\s*"([^"]+)"/gm)) {
            if (/[*?[{]/.test(m[1])) continue;
            named++;
            if (!fs.existsSync(path.join(ROOT, m[1]))) stale.push(`${rule}: ${m[1]}`);
        }
    }
    expect(named, 'rules that name a file were read').toBeGreaterThan(0);
    expect(stale, 'a rule with a stale path never loads').toEqual([]);
});

test('every js/ path a Node script or spec builds is a file that exists', () => {
    // The nightly job's scripts read and write modules by path, and only that
    // job runs them: a stale one stops content reaching the site, and no page
    // test would notice first.
    const sources = execSync('git ls-files -- "scripts/*.js" "tests/*.js"', { cwd: ROOT, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
    // lint.spec.js hands ESLint a name for text it lints, so the config's
    // js/**/*.js block applies. No file is meant to be there.
    const NOT_A_FILE = new Set(['tests/lint.spec.js: js/lint-probe.js']);
    const stale = [];
    let named = 0;
    for (const source of sources) {
        const text = fs.readFileSync(path.join(ROOT, source), 'utf8');
        for (const m of text.matchAll(/['"]js['"]((?:\s*,\s*['"][\w.-]+['"])+)/g)) {
            const parts = [...m[1].matchAll(/['"]([\w.-]+)['"]/g)].map(p => p[1]);
            if (!parts[parts.length - 1].endsWith('.js')) continue;
            named++;
            const label = `${source}: js/${parts.join('/')}`;
            if (!NOT_A_FILE.has(label) && !fs.existsSync(path.join(ROOT, 'js', ...parts))) stale.push(label);
        }
    }
    expect(named, 'paths were found').toBeGreaterThan(0);
    expect(stale).toEqual([]);
});

test('the stamper still finds every hand-authored page it owns', () => {
    // Its own selector names site_utils.js by path. Counted here by resolving
    // each tag instead, so a selector left on an old path shows as a shortfall.
    const siteUtils = path.join(ROOT, 'js', 'utility', 'site_utils.js');
    const owned = PAGES.filter(page => {
        if (fs.readFileSync(path.join(ROOT, page), 'utf8').includes('GENERATED by scripts/generate-pages.js')) return false;
        return scriptsOf(page).some(({ file }) => path.resolve(file) === path.resolve(siteUtils));
    });
    const out = execSync('node scripts/stamp-assets.js --check', { cwd: ROOT, encoding: 'utf8' });
    const checked = Number((out.match(/\((\d+) hand-authored page/) || [])[1]);
    expect(owned.length, 'hand-authored pages load site_utils.js').toBeGreaterThan(0);
    expect(checked).toBe(owned.length);
});
