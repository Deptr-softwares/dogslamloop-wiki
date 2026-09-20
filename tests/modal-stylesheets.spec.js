// js/site_utils.js injects four modals into EVERY page that loads it - auth,
// profile, alert and public-profile - by appending them to document.body at
// boot. They are not opt-in, and a page cannot decline them.
//
// So any page loading site_utils.js has those modals in its DOM whether it
// knows or not, and needs the stylesheets that dress them:
//
//   Modals.css  .modal-overlay, .modal-box, .modal-body, .profile-field
//   Forms.css   .editor-input  - used 5x by the AUTH modal (the login and
//               register form) and 4x by the profile modal
//
// Seven pages were missing Forms.css and one of those was missing both, so
// signing in from the update log, the tier list, the systems hub, the blog,
// submissions, colour codes or recent changes showed bare browser inputs in a
// box with no styling. Reported by the owner as "unstyled fields" on the
// profile; the login form was the worse half and had gone unnoticed.
//
// DERIVED, NOT LISTED. The obvious version of this test names those seven
// pages, passes forever, and catches nothing - the eighth page makes the same
// mistake and no test knows. This walks every HTML file in the repo instead and
// asks the question of each one, so a new page is covered on the day it is
// written rather than the day someone remembers.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Every stylesheet a page must carry if it injects the modals, with the class
// each one is needed for - named so a failure says WHY, not just "add this".
const REQUIRED = [
    { file: 'Modals.css', because: '.modal-box / .profile-field' },
    { file: 'Forms.css', because: '.editor-input (the login form)' },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);

function findHtml(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findHtml(full, out);
        else if (entry.name.endsWith('.html')) out.push(full);
    }
    return out;
}

const PAGES = findHtml(ROOT).map(full => ({
    rel: path.relative(ROOT, full).replace(/\\/g, '/'),
    src: fs.readFileSync(full, 'utf8'),
}));

// A page "injects the modals" if it loads site_utils.js at all. There is no
// finer condition to test: the injection is unconditional inside that file.
const INJECTORS = PAGES.filter(p => /src="[^"]*js\/site_utils\.js/.test(p.src));

test('the scan found pages to check', () => {
    // Guards the whole file against the vacuous shape - a broken walker finds
    // nothing and every assertion below then passes by looping zero times.
    expect(PAGES.length).toBeGreaterThan(10);
    expect(INJECTORS.length).toBeGreaterThan(10);
});

test('every page injecting the modals loads the stylesheets they need', () => {
    const missing = [];

    for (const page of INJECTORS) {
        for (const need of REQUIRED) {
            // Matches any depth of ../ prefix, since these pages sit at the
            // root, one level down and two.
            const linked = new RegExp(`href="[^"]*style/${need.file.replace('.', '\\.')}"`).test(page.src);
            if (!linked) missing.push(`${page.rel} is missing style/${need.file} - needed for ${need.because}`);
        }
    }

    expect(missing, 'these pages render the injected modals unstyled').toEqual([]);
});

test('the classes this test protects are really defined where it says', () => {
    // The rule above is only worth enforcing while these hold. If .editor-input
    // moves out of Forms.css one day, this fails and says so, instead of the
    // rule quietly protecting the wrong file.
    const forms = fs.readFileSync(path.join(ROOT, 'style', 'Forms.css'), 'utf8');
    const modals = fs.readFileSync(path.join(ROOT, 'style', 'Modals.css'), 'utf8');

    expect(forms, '.editor-input is defined in Forms.css').toMatch(/^\s*\.editor-input[\s,{]/m);
    expect(modals, '.profile-field is defined in Modals.css').toMatch(/^\s*\.profile-field[\s,{]/m);
});

test('the auth modal really is the bigger consumer of .editor-input', () => {
    // Recorded as a test because it is the part the bug report did not say and
    // the fix turns on: the owner saw the PROFILE fields unstyled, but the
    // login and register form uses the same class more, so an anonymous visitor
    // hit this before any signed-in one could.
    const src = fs.readFileSync(path.join(ROOT, 'js', 'site_utils.js'), 'utf8');
    const authStart = src.indexOf('const authModalHTML');
    const profileStart = src.indexOf('const profileModalHTML');
    expect(authStart, 'authModalHTML exists').toBeGreaterThan(-1);
    expect(profileStart, 'profileModalHTML is defined after it').toBeGreaterThan(authStart);

    const authUses = (src.slice(authStart, profileStart).match(/editor-input/g) || []).length;
    expect(authUses, 'the login form styles its inputs with .editor-input').toBeGreaterThan(0);
});
