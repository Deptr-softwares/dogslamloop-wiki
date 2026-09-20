// The Edit/History pair in the right sidebar renders at the same size on every
// page type.
//
// v0.19 B1, reported by the owner: "The button pair History & Edit Tab that is
// generated on a System Type page is slightly larger than the one generated on
// a Character page."
//
// The cause was not a page-type rule - there is no such rule anywhere. Both
// .btn-sys (style/Buttons.css) and .tab-editor-btn-sidebar (style/Layout.css)
// set font-size and padding, and as two single-class selectors they have EQUAL
// specificity. So the winner is decided by stylesheet ORDER, and the two page
// templates disagree about it:
//
//   character stub   ... Buttons.css ... Layout.css   <- Layout wins
//   system stub      ... Layout.css ... Buttons.css   <- Buttons wins
//
// Measured before the fix: 9.6px / 4px 8px on a character page, 11.2px /
// 6.4px 12px on a system page - exactly .btn-sys's own values.
//
// Two tests, and they protect different halves. The first is the owner's bug:
// the pair matches across page types. The second protects the FIX: it is
// written as `.btn-sys.tab-editor-btn-sidebar`, which silently applies to
// nothing if a future consumer of that class forgets .btn-sys.
//
// A THIRD hazard lives in tests/routing.spec.js:66 rather than here, and it is
// the one this fix actually broke on the way in. The same rule also sets
// display:none, flipped to flex by .is-active - and on a page loading
// Layout.css first, .btn-sys's display:inline-flex had been beating that
// display:none. Two pages carry a STATIC edit button that nothing adds
// .is-active to, and were visible only because of that accident: winning the
// cascade properly hid them. systems/tierlist/index.html now says .is-active
// explicitly. If you touch this rule again, run routing.spec.js - checking
// that every consumer carries .btn-sys is NOT enough, because a consumer can
// also depend on the rule LOSING.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// One of each page type. Named individually rather than swept, because this
// test is about the two TEMPLATES disagreeing, and one page from each is
// exactly the comparison. Both are ordinary generated stubs.
const CHARACTER_PAGE = '/characters/Boomcat/index.html';
const SYSTEM_PAGE = '/systems/framedata/index.html';

async function readPair(page, url) {
    await page.goto(url, { waitUntil: 'networkidle' });

    // The History button is created by initTabEditorButtons at runtime, so wait
    // for it rather than for a timeout.
    await page.waitForSelector('#btn-history-current-tab', { state: 'attached' });

    return page.evaluate(() => {
        const read = id => {
            const el = document.getElementById(id);
            if (!el) return null;
            const cs = getComputedStyle(el);
            // Structural values, not geometry: font metrics differ between
            // Windows and the Linux runner, so comparing widths would fail in
            // CI for reasons unrelated to this bug. These are what the CSS
            // actually declares, resolved by the browser.
            return { fontSize: cs.fontSize, padding: cs.padding };
        };
        return { edit: read('btn-edit-current-tab'), hist: read('btn-history-current-tab') };
    });
}

test('the sidebar button pair is the same size on both page types', async ({ page }) => {
    const char = await readPair(page, CHARACTER_PAGE);
    const sys = await readPair(page, SYSTEM_PAGE);

    // Positive first: the pair exists on both, so the comparison below is
    // comparing something. Two nulls are equal, and that is the vacuous shape.
    expect(char.edit, 'the character page has an Edit button').toBeTruthy();
    expect(sys.edit, 'the system page has an Edit button').toBeTruthy();
    expect(char.hist, 'the character page has a History button').toBeTruthy();
    expect(sys.hist, 'the system page has a History button').toBeTruthy();

    expect(sys.edit, 'EDIT matches across page types').toEqual(char.edit);
    expect(sys.hist, 'HISTORY matches across page types').toEqual(char.hist);

    // And it is the SMALL sidebar size that won, not .btn-sys's larger one -
    // the owner asked for the system pair to come down, not the character pair
    // to go up. Pinned to the declared 0.6rem so "they match" cannot be
    // satisfied by both regressing to 0.7rem together.
    expect(char.edit.fontSize, 'the sidebar size is 0.6rem').toBe('9.6px');
    expect(sys.edit.fontSize, 'the system page uses it too').toBe('9.6px');
});

test('every consumer of .tab-editor-btn-sidebar also carries .btn-sys', () => {
    // The fix qualifies its selector with .btn-sys to win regardless of
    // stylesheet order. A consumer without .btn-sys would therefore match
    // NEITHER rule and lose the sizing entirely - a worse version of the bug
    // being fixed, and invisible unless something asks.
    const sources = ['js/page_router.js', 'js/pagebuilder.js', 'systems/tierlist/index.html'];
    const offenders = [];
    let found = 0;

    for (const rel of sources) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        // Every class attribute / className assignment mentioning the class.
        const re = /class(?:Name)?\s*=\s*["'`]([^"'`]*tab-editor-btn-sidebar[^"'`]*)["'`]/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            found += 1;
            if (!/\bbtn-sys\b/.test(m[1])) offenders.push(`${rel}: "${m[1]}"`);
        }
    }

    // Guards against the regex quietly matching nothing, which would make the
    // assertion below pass on an empty sweep.
    expect(found, 'the sweep found the consumers it is policing').toBeGreaterThanOrEqual(3);
    expect(offenders, 'these would lose the sidebar sizing entirely').toEqual([]);
});
