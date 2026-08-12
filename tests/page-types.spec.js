// The page-type vocabulary, and the drift that broke regeneration.
//
// v0.12 added the `gallery` and `tool` page types and taught owner.html to
// create them. Two validators kept their own copies of the valid list and
// were never updated, so the moment somebody actually made one - the owner's
// Emotes gallery, 2026-08-12 - the whole regeneration job stopped:
//
//   fetch-registry FAILED - the generated navigation is invalid, nothing
//   written:
//     - Misc[3] (id: Emotes): bad pageType "gallery".
//
// Not just for that page. For everything: navigation, previews, stubs,
// sitemap. A vocabulary the owner tool can produce but the validator rejects
// is a wedge under the one job keeping the site in step with the database.
//
// The test that matters is the first one, and the thing that makes it worth
// having is that it derives its expectation from owner.html rather than
// restating the list. Restating it is how this happened.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { VALID_PAGE_TYPES, GENERATED_PAGE_TYPES } = require('../scripts/page-types.js');
const { validateNavigation } = require('../scripts/fetch-registry.js');

// Reads the real dropdown, so adding an option to owner.html without teaching
// the validator about it fails here instead of in a regeneration run days
// later.
function pageTypesOwnerToolOffers() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'owner.html'), 'utf8');
    const select = html.match(/<select[^>]*id="new-page-type"[\s\S]*?<\/select>/);
    expect(select, 'owner.html must still have a #new-page-type select').toBeTruthy();
    return [...select[0].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
}

function navWith(pageType) {
    return {
        Misc: [{
            id: 'Emotes',
            name: 'Emotes',
            url: 'others/emotes/index.html',
            cms_config: { pageId: 'emotes', pageType, editRole: 'open' },
        }],
    };
}

test('every page type the owner tool can create is a valid page type', async () => {
    const offered = pageTypesOwnerToolOffers();
    expect(offered.length).toBeGreaterThan(0);

    for (const pageType of offered) {
        expect([...VALID_PAGE_TYPES], `owner.html offers "${pageType}"`).toContain(pageType);
    }
});

test('a gallery page passes validation', async () => {
    // The exact entry that stopped the regeneration job.
    expect(validateNavigation(navWith('gallery'))).toEqual([]);
});

test('a tool page passes validation', async () => {
    // Never created yet, and it would have failed the same way.
    expect(validateNavigation(navWith('tool'))).toEqual([]);
});

test('a page type nobody defined is still rejected', async () => {
    // The check has to keep catching real typos, not just accept everything.
    const errors = validateNavigation(navWith('galery'));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('galery');
});

test('every generated page type is a valid one', async () => {
    // A type this repo writes a stub for but the validator rejects is
    // incoherent: the stub would exist on disk and the navigation naming it
    // could never be written.
    for (const pageType of GENERATED_PAGE_TYPES) {
        expect([...VALID_PAGE_TYPES], `"${pageType}" gets a stub`).toContain(pageType);
    }
});

test('the vocabulary is defined once, anywhere in the repo', async () => {
    // The first version of this test scanned only scripts/ and matched on the
    // constant's NAME. It passed while a fourth copy sat in
    // tests/routing.spec.js as a bare array literal - which then failed the
    // regeneration run for a second time, on the same underlying gap.
    //
    // So this looks for the shape of the list rather than a name, across
    // every directory that can hold one. 'tierlist' and 'external' together
    // are the signature: no other list in this codebase pairs them, because
    // 'external' only ever appears as a page type.
    const roots = ['scripts', 'tests', 'js'];
    const offenders = [];

    for (const root of roots) {
        const dir = path.join(__dirname, '..', root);
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
            if (root === 'scripts' && file === 'page-types.js') continue;
            // This file, which has to name both words to explain the rule.
            if (root === 'tests' && file === 'page-types.spec.js') continue;

            const source = fs.readFileSync(path.join(dir, file), 'utf8');
            // A literal listing both, on one line - an inline copy of the
            // valid-types vocabulary.
            const inline = source.split('\n').some(line =>
                /['"]tierlist['"]/.test(line) && /['"]external['"]/.test(line));
            const named = /VALID_PAGE_TYPES\s*=|GENERATED_PAGE_TYPES\s*=/.test(source);

            if (inline || named) offenders.push(`${root}/${file}`);
        }
    }

    expect(offenders, 'these re-declare the page-type vocabulary instead of importing it').toEqual([]);
});
