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

test('the editor keeps its legacy aliases, which Buttons.css does not know about', () => {
    // The duplication was removed, not the aliases. Only editor modules emit
    // these four, and they still need a base of their own - deleting them with
    // the duplicate would have unstyled every submit and add-block button.
    const editor = read('editor.css');
    ['submit-btn', 'system-page-btn', 'add-block-btn', 'btn-action-delete']
        .forEach(cls => {
            expect(editor, `.${cls} still styled`).toContain(`.${cls}`);
        });
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
