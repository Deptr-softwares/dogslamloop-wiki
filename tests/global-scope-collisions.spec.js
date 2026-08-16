// Two files cannot declare the same top-level name if a page loads both.
//
// This project has no bundler. Every js/ file is a classic <script> sharing
// ONE global lexical scope, so a top-level `const esc` in two files that load
// together is a hard SyntaxError - "Identifier 'esc' has already been
// declared" - and it aborts the ENTIRE second file, not just that line.
//
// It happened while adding block escaping in v0.15: `const esc` and
// `const safeUrl` in js/description.js collided with js/editor-blocks.js and
// js/internalstyling.js. initStrategyBlockBuilder was then never defined and
// edit.html died with "Editor failed to initialize context" - the same
// symptom as the 2026-08-10 cache-skew incident, from a completely different
// cause. Nothing in the suite noticed: the specs that touch the editor mock
// their way past boot, and the one testing the new escaping had been written
// to build its own markup rather than drive the real builder.
//
// The check is cheap and the failure is catastrophic and silent, so it runs
// on every commit.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// Column 0 only. A declaration indented by even one space is inside a
// function, an IIFE or a block, and therefore scoped - js/character_modes.js
// has its own `const esc` and is perfectly safe because it sits inside
// `(function () {`.
const TOP_LEVEL = /^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm;

function topLevelNames(file) {
    const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    const names = new Set();
    let m;
    TOP_LEVEL.lastIndex = 0;
    while ((m = TOP_LEVEL.exec(src)) !== null) names.add(m[1]);
    return names;
}

// Which js/ files each page loads. Read from the HTML rather than assumed, so
// a page that starts loading a new pair is covered without editing this file.
function pageScriptSets() {
    const pages = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['node_modules', '.git', 'test-results', 'devlogs'].includes(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.html')) pages.push(full);
        }
    };
    walk(ROOT);

    return pages.map(p => ({
        page: path.relative(ROOT, p).replace(/\\/g, '/'),
        scripts: (fs.readFileSync(p, 'utf8').match(/src="[^"]*js\/([\w-]+\.js)/g) || [])
            .map(s => s.replace(/.*js\//, '')),
    }));
}

test('no two scripts loaded by the same page declare the same top-level name', () => {
    const names = {};
    for (const file of fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'))) {
        names[file] = topLevelNames(file);
    }

    const collisions = [];
    for (const { page, scripts } of pageScriptSets()) {
        const seen = new Map();
        for (const script of scripts) {
            if (!names[script]) continue;
            for (const name of names[script]) {
                if (seen.has(name)) {
                    collisions.push(`${page}: '${name}' in both ${seen.get(name)} and ${script}`);
                } else {
                    seen.set(name, script);
                }
            }
        }
    }

    expect(
        [...new Set(collisions)],
        'a duplicate top-level name aborts the whole second file - rename one, or move it inside an IIFE'
    ).toEqual([]);
});

test('every page that renders authored blocks actually defines the builders', async ({ page }) => {
    // The behavioural half. The audit above reads files; this proves the
    // scripts really parsed, which is the thing a collision destroys. A file
    // that fails to parse is invisible to any test that mocks past boot.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/edit.html?char=boomcat&tab=overview', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const defined = await page.evaluate(() => ({
        builder: typeof window.initStrategyBlockBuilder,
        blocks: typeof window.generateHTMLForBlocks,
        tabs: typeof window.switchEditorTab,
        tabVocabulary: typeof window.getCharacterTabIds,
    }));

    expect(defined.builder, 'js/editor-blocks.js did not finish parsing').toBe('function');
    expect(defined.blocks, 'js/description.js did not finish parsing').toBe('function');
    expect(defined.tabs, 'js/editor-tabs.js did not finish parsing').toBe('function');
    expect(defined.tabVocabulary, 'js/character_tabs.js did not finish parsing').toBe('function');

    expect(
        errors.filter(e => /has already been declared|is not defined/.test(e)),
        'a scope collision or a missing global'
    ).toEqual([]);
});
