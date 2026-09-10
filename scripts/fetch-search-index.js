#!/usr/bin/env node
/**
 * Refreshes data/search-index.json - the committed structural index behind the
 * site searchbar (v0.19 F1a).
 *
 * WHAT IS IN IT, AND WHAT IS NOT
 *
 * Page names, section headings and MOVE NAMES. Not body text. A wiki for a
 * fighting game is searched for four things - a character, a move, a system
 * term, a section - and all four are here. Measured against live content on
 * 2026-09-10: 475 headings + 382 move names + every page, about 16 KB. The
 * full-text index is a separate, much larger artifact for search.html (F1b);
 * splitting them is what lets this one load everywhere without thinking about
 * it.
 *
 * IT DOES NOT WALK desc_data ITSELF
 *
 * It calls window.collectSectionTargets (js/character_tabs.js), which is the
 * same function the in-page link picker uses. That matters for two reasons:
 *
 *   - It already mints anchor ids that MATCH assignSectionAnchors' sweep of the
 *     rendered DOM, in rendered order, including the sec-notes / sec-notes-2
 *     numbering when two sections share a title. So every search result deep
 *     links to an id that provably exists on the page.
 *   - It already reads frame_data. A move's heading is its NAME, and names are
 *     not in desc_data at all - 382 of the entries here would simply be missing
 *     from an index built off desc_data alone, i.e. every skill on the site.
 *
 * A second walker would be a third derivation that has to agree with the
 * renderer and the picker, and the picker's own history says what happens when
 * one of them misses a page family: until v0.18 F5 it offered exactly one
 * target on a system page, "Discussion", and none of the sections on it.
 *
 * The module is loaded by evaluating it against a stand-in window - the same
 * technique tests/character-tab-vocabulary.spec.js uses, and for the same
 * reason: so this file never holds a second copy of what it is reading.
 *
 * Deliberately offline everywhere else: like fetch-previews.js, this script
 * fetches and writes a committed artifact, and the generator reads only
 * committed files. Freshness is this script's job (run by the regeneration
 * workflow), correctness belongs to whatever reads the file.
 *
 * Credentials: the public anon key, which is not a secret - it already ships in
 * js/site_utils.js and is in the page source of every page. Deliberately NOT
 * the service-role key. Everything read here is already world-readable through
 * the "Public Read Live Data" policy.
 *
 * Usage:
 *   node scripts/fetch-search-index.js            # report what would change
 *   node scripts/fetch-search-index.js --write    # write data/search-index.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'search-index.json');
const NAV_PATH = path.join(ROOT, 'data', 'navigation.json');
const VOCAB_PATH = path.join(ROOT, 'js', 'character_tabs.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// Tabs whose sections are deliberately NOT in the searchbar index.
//
// Measured on 2026-09-10, the unfiltered index was 1,501 entries and these two
// were 540 of them - 36%:
//
//   matchups (492)  Every character page carries a "vs. <Opponent>" section for
//                   every other character. Typing "Vessel" would return the
//                   Vessel page plus 21 sections all titled "vs. Vessel", which
//                   is the exact "forty near-identical results" failure that
//                   makes a search worse than none. The sections are still
//                   reachable from the page, and they belong in search.html
//                   (F1b), where results are ranked and paginated.
//   page (48)       The synthetic "Discussion" target, one per page. Structure,
//                   not content - nobody searches for it.
//
// This is what "the searchbar for a short search" means in practice, in the
// owner's own framing. Removing them is a product decision, not a size trick,
// though it does cost a third of the bytes.
const SKIP_TABS = new Set(['matchups', 'page']);

/**
 * The tab vocabulary, evaluated against a stand-in window.
 *
 * collectSectionTargets reaches for four things on window. Three
 * (getCharacterTabLabels, GENERIC_SECTION_TITLES, FRAME_MOVE_CATEGORIES) are
 * defined in this same module, so they arrive with it. The fourth,
 * sectionAnchorSlug, lives in js/pagebuilder.js - a DOM-heavy module that does
 * not evaluate in Node - and collectSectionTargets carries an inline fallback
 * for exactly that case.
 *
 * That fallback is currently character-for-character identical to
 * pagebuilder.js's version, which is what makes the anchors this script writes
 * match the ids the page mints. It is an ASSUMPTION, not a guarantee, so
 * tests/search-index.spec.js asserts the two agree - if they ever drift, every
 * anchor in this file silently points at nothing.
 */
function loadVocabulary() {
    const src = fs.readFileSync(VOCAB_PATH, 'utf8');
    const fakeWindow = {};
    new Function('window', src)(fakeWindow);
    if (typeof fakeWindow.collectSectionTargets !== 'function') {
        throw new Error('js/character_tabs.js did not define collectSectionTargets - has it moved?');
    }
    return fakeWindow;
}

/** pageId -> {name, url, type}, from the committed registry. */
function loadPageRegistry() {
    const nav = JSON.parse(fs.readFileSync(NAV_PATH, 'utf8'));
    const byPageId = new Map();

    for (const entries of Object.values(nav)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const cms = entry && entry.cms_config;
            // An `external` entry is a link with no page behind it, so there is
            // nothing to deep link into and nothing to index.
            if (!cms || !cms.pageId || !entry.url) continue;
            byPageId.set(cms.pageId, {
                name: entry.name,
                url: entry.url,
                type: cms.pageType || 'system',
            });
        }
    }
    return byPageId;
}

async function fetchPageContent() {
    const url = `${SUPABASE_URL}/rest/v1/page_data?select=page_id,desc_data,frame_data,tab_settings`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status}: ${await res.text()}`);

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected an array of page_data rows.');

    // Same refusal as fetch-previews.js. An empty result means a broken query,
    // a changed policy or an outage - never "the wiki has no content". Writing
    // an empty index would look exactly like a successful run and would empty
    // the searchbar site-wide.
    if (rows.length === 0) throw new Error('Refusing to continue: page_data returned zero rows.');

    return rows;
}

function buildIndex(rows, vocab, registry) {
    const pages = [];
    const pageIndexById = new Map();
    const entries = [];

    // Sorted so the artifact is deterministic: `npm run validate` compares the
    // committed file, and a run that reordered rows would report a spurious
    // diff every time Supabase returned them in a different order.
    const sorted = [...rows].sort((a, b) => String(a.page_id).localeCompare(String(b.page_id)));

    for (const row of sorted) {
        const page = registry.get(row.page_id);
        // A page_data row with no live registry entry is content for a page
        // nobody can reach - archived, or not yet published. Indexing it would
        // offer search results that 404.
        if (!page) continue;

        const pageIdx = pages.length;
        pages.push({ name: page.name, url: page.url, type: page.type });
        pageIndexById.set(row.page_id, pageIdx);

        // Per page, because an optional tab is per page. Without this, Techs
        // sections would be missing from the index for every character that has
        // the tab switched ON - getCharacterTabs filters optional tabs against
        // whatever was last set.
        vocab.setOptionalCharacterTabs(row.tab_settings);

        let targets;
        try {
            targets = vocab.collectSectionTargets(row.desc_data || {}, row.frame_data || {});
        } catch (err) {
            // One malformed page must not cost the whole index, but it must be
            // visible rather than silent.
            targets = null;
            console.warn(`  ! ${row.page_id}: could not read sections - ${err.message}`);
        }
        if (!targets) continue;

        // Flattened, with the parent recorded rather than nested: a search
        // result is one line, and "General Strategy - Neutral" reads better
        // than a tree the searchbar would have to walk to display.
        for (const major of targets) {
            if (!major || !major.title) continue;
            if (SKIP_TABS.has(major.tab)) continue;

            entries.push([major.title, major.tab, major.tabLabel, major.id, pageIdx, null]);
            for (const minor of major.children || []) {
                if (!minor || !minor.title) continue;
                entries.push([minor.title, major.tab, major.tabLabel, minor.id, pageIdx, major.title]);
            }
        }
    }

    return { pages, entries };
}

async function main() {
    const write = process.argv.includes('--write');

    const vocab = loadVocabulary();
    const registry = loadPageRegistry();
    const rows = await fetchPageContent();
    const { pages, entries } = buildIndex(rows, vocab, registry);

    if (pages.length === 0) {
        throw new Error('Refusing to continue: no page_data row matched a live registry entry.');
    }
    if (entries.length === 0) {
        throw new Error('Refusing to continue: the index has no entries at all.');
    }

    // No timestamp in the artifact, deliberately. `npm run validate` compares
    // the committed file against a fresh build, so a generated-at field would
    // make every run differ from every other and the check meaningless.
    //
    // Entries are ARRAYS, not objects, and `fields` says what the positions
    // mean. Six keys repeated across ~950 entries is about 40 KB of the word
    // "tabLabel" - real weight in a file every page fetches. `fields` keeps it
    // self-describing rather than requiring the reader to know the order.
    //
    // Serialised ONE RECORD PER LINE rather than with JSON.stringify's indent.
    // Fully pretty-printed, every array element lands on its own line and the
    // file is 129 KB of mostly whitespace; fully minified, it is one enormous
    // line that no diff can review. A line per entry is both: readable in a
    // pull request, and a third of the size.
    const line = v => JSON.stringify(v);
    const json =
        '{\n' +
        `  "fields": ${line(['title', 'tab', 'tabLabel', 'anchor', 'page', 'parent'])},\n` +
        '  "pages": [\n' +
        pages.map(p => `    ${line(p)}`).join(',\n') + '\n' +
        '  ],\n' +
        '  "entries": [\n' +
        entries.map(e => `    ${line(e)}`).join(',\n') + '\n' +
        '  ]\n' +
        '}\n';

    // Cheap guard against the hand-built JSON above going subtly wrong - a
    // trailing comma or a missed escape would otherwise ship a file every page
    // fetches and none can parse.
    JSON.parse(json);

    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
    const changed = existing !== json;
    const kb = (Buffer.byteLength(json) / 1024).toFixed(1);

    console.log(`search index: ${pages.length} pages, ${entries.length} entries, ${kb} KB`);

    if (!changed) {
        console.log('data/search-index.json is up to date.');
        return;
    }

    if (!write) {
        console.log('data/search-index.json would change. Run with --write.');
        return;
    }

    fs.writeFileSync(OUT_PATH, json, 'utf8');
    console.log('data/search-index.json written.');
}

main().catch(err => {
    console.error(`fetch-search-index failed: ${err.message}`);
    process.exit(1);
});
