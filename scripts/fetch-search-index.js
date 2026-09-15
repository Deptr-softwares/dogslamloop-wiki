#!/usr/bin/env node
/**
 * Refreshes the two committed search indexes, from ONE walk of the content.
 *
 *   data/search-index.json      the searchbar's         (v0.19 F1a)
 *   data/search-fulltext.json   search.html's           (v0.19 F1b)
 *
 * WHAT IS IN EACH, AND WHY THERE ARE TWO
 *
 * The searchbar index is page names, section headings and MOVE NAMES - no body
 * text. A wiki for a fighting game is searched for four things: a character, a
 * move, a system term, a section. All four are structural. Measured on
 * 2026-09-10: 982 entries, 83 KB raw, 13.7 KB gzipped, small enough to sit
 * behind every page's sidebar.
 *
 * The full-text index is the prose, one record per SECTION, and it is 332 KB
 * raw / 105 KB gzipped - which is why it is a separate file that only
 * search.html fetches. Loading that on every page view for a feature most
 * visits never use is the trade the split exists to avoid.
 *
 * They also differ in CONTENT, not just size. SKIP_TABS drops matchups from the
 * searchbar - 492 near-identical "vs. <Opponent>" headings that would bury a
 * character's own page - but keeps their prose in full text, where "how do I
 * deal with X" is one of the most valuable things on the wiki to be able to
 * find.
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
const FULLTEXT_PATH = path.join(ROOT, 'data', 'search-fulltext.json');
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
    const fulltext = [];

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
            // collectText: the F1b opt-in. It only ADDS `text` to each target;
            // the structure is identical either way, which
            // tests/search-index.spec.js asserts rather than assumes. One walk
            // therefore feeds both indexes.
            targets = vocab.collectSectionTargets(row.desc_data || {}, row.frame_data || {}, { collectText: true });
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

            // SKIP_TABS applies to the SEARCHBAR index only. Matchups are 492
            // near-identical "vs. <Opponent>" headings, which is noise in a
            // typeahead - but their prose is some of the most searched writing
            // on the wiki ("how do I deal with X"), and full text is exactly
            // where it belongs. Filtering both would have thrown away the half
            // that motivated having a second index at all.
            const inSearchbar = !SKIP_TABS.has(major.tab);

            // Body text, one record per SECTION rather than per paragraph. A
            // lone paragraph is a poor search result - no title to show, no
            // anchor of its own - and a section's joined prose gives the
            // results page a snippet to quote around whatever matched.
            const addText = (target, title) => {
                const text = (target.text || []).join(' ').replace(/\s+/g, ' ').trim();
                if (!text) return;
                fulltext.push([text, major.tab, major.tabLabel, target.id, pageIdx, title]);
            };

            if (inSearchbar) entries.push([major.title, major.tab, major.tabLabel, major.id, pageIdx, null]);
            addText(major, major.title);

            for (const minor of major.children || []) {
                if (!minor || !minor.title) continue;
                if (inSearchbar) entries.push([minor.title, major.tab, major.tabLabel, minor.id, pageIdx, major.title]);
                addText(minor, minor.title);
            }
        }
    }

    return { pages, entries, fulltext };
}

async function main() {
    const write = process.argv.includes('--write');

    const vocab = loadVocabulary();
    const registry = loadPageRegistry();
    const rows = await fetchPageContent();
    const { pages, entries, fulltext } = buildIndex(rows, vocab, registry);

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
    const serialise = (fields, records) =>
        '{\n' +
        `  "fields": ${line(fields)},\n` +
        '  "pages": [\n' +
        pages.map(p => `    ${line(p)}`).join(',\n') + '\n' +
        '  ],\n' +
        '  "entries": [\n' +
        records.map(e => `    ${line(e)}`).join(',\n') + '\n' +
        '  ]\n' +
        '}\n';

    const artifacts = [
        {
            path: OUT_PATH, label: 'search index',
            json: serialise(['title', 'tab', 'tabLabel', 'anchor', 'page', 'parent'], entries),
            count: entries.length,
        },
        {
            // Same shape, same `pages` table, different records - so search.html
            // reads it with the same code the searchbar uses rather than a
            // second parser. Position 0 is prose instead of a title, and
            // position 5 is the section it came from rather than a parent
            // heading, which `fields` says.
            path: FULLTEXT_PATH, label: 'full-text index',
            json: serialise(['text', 'tab', 'tabLabel', 'anchor', 'page', 'section'], fulltext),
            count: fulltext.length,
        },
    ];

    let anyChanged = false;
    for (const a of artifacts) {
        // Cheap guard against the hand-built JSON going subtly wrong - a
        // trailing comma or a missed escape would ship a file the site fetches
        // and cannot parse.
        JSON.parse(a.json);

        const rel = path.relative(ROOT, a.path).split(path.sep).join('/');
        const kb = (Buffer.byteLength(a.json) / 1024).toFixed(1);
        console.log(`${a.label}: ${pages.length} pages, ${a.count} entries, ${kb} KB`);

        const existing = fs.existsSync(a.path) ? fs.readFileSync(a.path, 'utf8') : null;
        if (existing === a.json) { console.log(`  ${rel} is up to date.`); continue; }

        anyChanged = true;
        if (!write) { console.log(`  ${rel} would change. Run with --write.`); continue; }

        fs.writeFileSync(a.path, a.json, 'utf8');
        console.log(`  ${rel} written.`);
    }

    if (!anyChanged) console.log('Nothing to do.');
}

main().catch(err => {
    console.error(`fetch-search-index failed: ${err.message}`);
    process.exit(1);
});
