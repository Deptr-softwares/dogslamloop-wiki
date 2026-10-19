// `.btn-sys` is defined once (v0.18 A3).
//
// style/editor.css carried a byte-identical copy of the whole .btn-sys family -
// base, six colour tiers, hover, active, disabled - unscoped, and loaded AFTER
// style/Buttons.css. So on the five pages that load editor.css (admin, edit,
// owner, post-editor, tier-editor) the editor's copy silently won, and a fix
// made in Buttons.css reached every page except those five.
//
// That is precisely the trap CLAUDE.md warns about: "a change to .btn-sys needs
// checking against every consumer, not just the page under investigation." The
// duplication made "every consumer" impossible to satisfy by reading one file.
//
// The check that matters here is the SOURCE-LEVEL one - a rendering test cannot
// see the difference, because the two copies agreed. It is the next edit to
// Buttons.css that the duplication would have broken, not this one.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'style', f), 'utf8');

// A rule that sets the button's own base look, as opposed to a scoped tweak
// like `.combo-row-move .btn-sys` or a compound like `.btn-sys.daw-narrow-btn`.
// Those are legitimate and stay.
function unscopedBaseRules(source) {
    // Comments FIRST. Without this the selector capture below swallows any
    // comment block sitting between the previous `}` and the rule - which is
    // exactly what the explanatory comment above .btn-sys in Buttons.css does,
    // and it made this check report zero definitions of a class that is very
    // much defined.
    const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

    const out = [];
    // Selector lists ending in `{`, then the body.
    // No leading `}` in this pattern, deliberately. Anchoring on one made the
    // match CONSUME the closing brace of each rule - which is the same brace
    // the next rule's anchor needed, so the scan silently saw every OTHER
    // rule. It reported zero definitions in Buttons.css and, worse, an empty
    // list for editor.css: the assertion that mattered was passing vacuously.
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
        const selector = m[1].trim();
        const body = m[2];
        if (selector.startsWith('@') || selector.startsWith('/*')) continue;
        // Only a BARE `.btn-sys` counts - not `.x .btn-sys`, not `.btn-sys.x`,
        // not `.btn-sys:hover`.
        const bare = selector.split(',').some(s => s.trim() === '.btn-sys');
        if (bare && /display\s*:/.test(body)) out.push(selector);
    }
    return out;
}

test('.btn-sys has exactly one base definition, and it is in Buttons.css', () => {
    const buttons = unscopedBaseRules(read('Buttons.css'));
    const editor = unscopedBaseRules(read('editor.css'));
    const layout = unscopedBaseRules(read('Layout.css'));

    // Positive first: the canonical rule exists. Without this the assertions
    // below would pass hardest if somebody deleted the class entirely.
    expect(buttons.length, 'Buttons.css defines .btn-sys').toBe(1);
    expect(editor, 'editor.css must not redefine the shared class').toEqual([]);
    expect(layout, 'nor Layout.css').toEqual([]);
});

test('no button keeps a hand-copied look of its own: every legacy alias rides on .btn-sys', () => {
    // v1.1. The four editor aliases (.submit-btn, .system-page-btn,
    // .add-block-btn, .btn-action-delete) copied the old .btn-sys look by hand,
    // so the restyle could not reach them, and on the add-block menu, where
    // .add-block-btn sat beside .btn-sys and loaded later, the two looks mixed.
    // Every element that names one must be a .btn-sys, and editor.css must not
    // give one a base look again.
    const ALIASES = ['submit-btn', 'system-page-btn', 'add-block-btn', 'btn-action-delete'];
    const sources = [
        ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => path.join('js', f)),
        ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html')),
    ];
    const offenders = [];
    let seen = 0;
    sources.forEach(f => {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const attr = /class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g;
        let m;
        while ((m = attr.exec(src)) !== null) {
            const classes = m[1].split(/\s+/);
            if (!classes.some(c => ALIASES.includes(c))) continue;
            seen++;
            if (!classes.includes('btn-sys')) offenders.push(`${f}: class="${m[1]}"`);
        }
    });
    // Positive first: the add-block menu still uses its hook.
    expect(seen, 'the add-block menu still marks its buttons').toBeGreaterThan(0);
    expect(offenders).toEqual([]);

    const editor = read('editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(editor)) !== null) {
        const bareAlias = m[1].split(',').some(s => ALIASES.includes(s.trim().replace(/^\./, '')));
        expect(bareAlias && /background|border|display\s*:/.test(m[2]),
            `editor.css gives a bare alias a look of its own: ${m[1].trim()}`).toBe(false);
    }
});

test('every page that loads editor.css also loads Buttons.css', () => {
    // What made the consolidation safe. If a page took editor.css alone, moving
    // the base rule out of it would leave every button on that page unstyled.
    const html = fs.readdirSync(ROOT)
        .filter(f => f.endsWith('.html'))
        .map(f => ({ f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

    const consumers = html.filter(({ src }) => /editor\.css/.test(src));
    expect(consumers.length, 'the editor pages are still there').toBeGreaterThan(0);

    consumers.forEach(({ f, src }) => {
        expect(/Buttons\.css/.test(src), `${f} loads Buttons.css`).toBe(true);
    });
});

test('a .btn-sys button gets its pointer cursor on a reader page too', async ({ page }) => {
    // `cursor: pointer` lived only in the editor's copy, so on every reader page
    // a .btn-sys <button> showed the default arrow. It moved up with the
    // consolidation rather than being dropped alongside it.
    //
    // Read back RESOLVED, not as a rule: this is the assertion that would catch
    // the property being lost in the move.
    await page.goto('/systems/framedata/index.html', { waitUntil: 'domcontentloaded' });

    const cursor = await page.evaluate(() => {
        const el = document.createElement('button');
        el.className = 'btn-sys';
        el.textContent = 'probe';
        document.body.appendChild(el);
        return getComputedStyle(el).cursor;
    });

    expect(cursor).toBe('pointer');
});

test('no stylesheet suppresses the focus ring on .btn-sys', () => {
    // editor.css's copy carried `outline: none`, which killed the keyboard
    // focus ring on every editor page. It was deliberately NOT carried over.
    //
    // Asserted against the SOURCE, not the computed style. An unfocused button
    // computes `outline-style: none` regardless, because the browser's default
    // ring lives on :focus-visible - so a computed-style version of this test
    // reads 'none' whether or not the rule exists, and would have passed
    // before the change as happily as after. That is the vacuous shape, and it
    // is what the first draft of this test did.
    ['Buttons.css', 'editor.css', 'Layout.css'].forEach(file => {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
        // Same pattern as above, and no leading `}` for the same reason.
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m;
        while ((m = re.exec(css)) !== null) {
            const selector = m[1].trim();
            if (!selector.split(',').some(s => s.trim() === '.btn-sys')) continue;
            expect(/outline\s*:\s*none/.test(m[2]),
                `${file} must not suppress the focus ring on a bare .btn-sys`).toBe(false);
        }
    });
});
