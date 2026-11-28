// How much script and style each kind of page loads from its own tags,
// gzipped. Node only.
//
// BUDGET is the weight when this check arrived plus 5% (owner, 2026-11-22:
// "Ceiling at today + 5%"). A PR that makes a page heavier than its number
// fails. A PR that makes one more than 5% lighter fails too, until it lowers
// the number, so the gain is kept.
//
// The generated kinds are built by the generator itself from a made-up page
// list, and the hand-written pages are read as they are. It never reads a
// generated page, and it weighs site_lookups.js without its generated colour
// region, so no owner edit can move a number.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { buildPages, scanToolAssets, NEVER_TOUCH, PAGE_DIRECTORIES } = require('../scripts/generate-pages.js');
const { GENERATED_PAGE_TYPES } = require('../scripts/page-types.js');

const ROOT = path.join(__dirname, '..');

// KB gzipped, per page: { js, css }.
const BUDGET = {
    'a character page': { js: 201, css: 52 },
    'a system page': { js: 187, css: 43 },
    'a gallery page': { js: 189, css: 43 },
    'a tool page': { js: 189, css: 47 },
    'the create_tier_list tool page': { js: 201, css: 49 },
    'the editor_playground tool page': { js: 189, css: 47 },
    'the free_submit_tier_list tool page': { js: 194, css: 49 },
    '404.html': { js: 201, css: 46 },
    'overseer.html': { js: 277, css: 86 },
    // The Overseer's old address: a forward, with nothing of its own to load.
    'admin.html': { js: 0, css: 0 },
    'blog.html': { js: 183, css: 47 },
    'characters/index.html': { js: 191, css: 48 },
    'edit.html': { js: 408, css: 75 },
    'forum.html': { js: 216, css: 54 },
    'history.html': { js: 220, css: 50 },
    'index.html': { js: 189, css: 52 },
    'owner.html': { js: 195, css: 69 },
    'post-editor.html': { js: 221, css: 80 },
    'privacy-policy.html': { js: 133, css: 33 },
    'recent-changes.html': { js: 135, css: 29 },
    'search.html': { js: 131, css: 30 },
    'submissions.html': { js: 137, css: 30 },
    'systems/index.html': { js: 191, css: 48 },
    'systems/tierlist/index.html': { js: 196, css: 49 },
    'systems/updatelog/index.html': { js: 186, css: 44 },
    'terms.html': { js: 133, css: 33 },
    'tier-editor.html': { js: 255, css: 79 },
};

function generatedKinds() {
    const { toolScripts, toolStyles } = scanToolAssets();
    const entry = (name, url, pageId, pageType) => ({ name, url, cms_config: { pageId, pageType } });
    const made = [...GENERATED_PAGE_TYPES].map(type => entry('Probe', `${PAGE_DIRECTORIES[0]}/Probe_${type}/index.html`, `probe_${type}`, type));
    // A tool with its own script and stylesheet loads them on top of the frame.
    for (const id of [...toolScripts].sort()) made.push(entry(id, `${PAGE_DIRECTORIES[0]}/Tool_${id}/index.html`, id, 'tool'));
    const { pages, problems } = buildPages({ Probe: made }, {}, {}, toolScripts, toolStyles);
    expect(problems).toEqual([]);
    return pages.map((p, i) => [made[i].cms_config.pageType === 'tool' && toolScripts.has(made[i].cms_config.pageId)
        ? `the ${made[i].cms_config.pageId} tool page` : `a ${made[i].cms_config.pageType} page`, p.relPath, p.html]);
}

function handWritten() {
    const generatedPath = new RegExp(`^(${PAGE_DIRECTORIES.join('|')})/[^/]+/index\\.html$`);
    return execSync('git ls-files -- "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
        .filter(f => !generatedPath.test(f) || NEVER_TOUCH.has(f))
        .map(f => [f, f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
}

const COLOUR_REGION = /(\/\/ --- GENERATED REGION: CHARACTER_COLORS[^\n]*\n)[\s\S]*?(\n\/\/ --- END GENERATED REGION)/;

function weigh(relPath, html) {
    const total = { js: 0, css: 0 };
    const tags = [
        ...[...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map(m => ['js', m[1]]),
        ...[...html.matchAll(/<link\b[^>]*>/g)].filter(m => /\srel="stylesheet"/.test(m[0]))
            .map(m => ['css', (m[0].match(/\shref="([^"]+)"/) || [])[1]]),
    ];
    for (const [kind, ref] of tags) {
        if (!ref || /^(https?:)?\/\//.test(ref)) continue;
        const clean = ref.replace(/[?#].*$/, '');
        const file = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(relPath), clean));
        let text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (COLOUR_REGION.test(text)) text = text.replace(COLOUR_REGION, '$1$2');
        total[kind] += zlib.gzipSync(text, { level: 9 }).length;
    }
    return { js: total.js / 1024, css: total.css / 1024 };
}

const allowance = kb => Math.ceil(kb * 1.05);

test.describe('page weight', () => {
    const measured = [...generatedKinds(), ...handWritten()].map(([name, relPath, html]) => [name, weigh(relPath, html)]);

    test('every page has a budget, and every budget has a page', () => {
        const names = measured.map(([name]) => name);
        const missing = measured.filter(([name]) => !BUDGET[name])
            .map(([name, w]) => `    '${name}': { js: ${allowance(w.js)}, css: ${allowance(w.css)} },`);
        expect(missing, `add to BUDGET:\n${missing.join('\n')}`).toEqual([]);
        expect(Object.keys(BUDGET).filter(name => !names.includes(name)), 'a budget for a page that is gone').toEqual([]);
    });

    for (const kind of ['js', 'css']) {
        test(`no page's ${kind === 'js' ? 'scripts' : 'stylesheets'} outgrow their budget, and a lighter page lowers it`, () => {
            const off = [];
            for (const [name, w] of measured) {
                const budget = BUDGET[name] && BUDGET[name][kind];
                if (!budget) continue;
                if (w[kind] > budget) off.push(`${name}: ${w[kind].toFixed(1)} KB, over its budget of ${budget} KB`);
                else if (budget - allowance(w[kind]) > budget * 0.05) off.push(`${name}: ${w[kind].toFixed(1)} KB, more than 5% under ${budget} KB: lower it to ${allowance(w[kind])}`);
            }
            expect(off).toEqual([]);
        });
    }
});
