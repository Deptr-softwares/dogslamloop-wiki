#!/usr/bin/env node
/**
 * Regenerates data/faq.json and systems/collaborators/collaborators_data.json
 * from the site_faq and site_collaborators tables.
 *
 * Both files are fetched at runtime as plain JSON by js/home_widgets.js and
 * the collaborators page, so the shapes below have to match what those
 * already expect exactly - this is a write-back, not a redesign. The
 * round-trip is asserted in tests/content-roundtrip.spec.js.
 *
 * Public anon key only, same reasoning as scripts/fetch-previews.js.
 *
 * Usage:
 *   node scripts/fetch-content.js            # report what would change
 *   node scripts/fetch-content.js --write    # write both JSON files
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAQ_PATH = path.join(ROOT, 'data', 'faq.json');
const COLLAB_PATH = path.join(ROOT, 'systems', 'collaborators', 'collaborators_data.json');
const META_PATH = path.join(ROOT, 'data', 'site_meta.json');
const SITE_META_JS_PATH = path.join(ROOT, 'js', 'site_meta.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

/**
 * Pure. Rows in, the exact faq.json shape out.
 * `id` is preserved because the committed file has it and dropping it would
 * be a gratuitous diff, even though nothing reads it.
 */
function buildFaq(rows) {
    return {
        faqs: [...rows]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((row, i) => ({
                id: i + 1,
                question: row.question,
                paragraphs: Array.isArray(row.paragraphs) ? row.paragraphs : [],
            })),
    };
}

/**
 * Pure. Rows in, the exact collaborators_data.json shape out.
 *
 * The two sections have genuinely different shapes in the existing file -
 * mainContributors are full cards, specialThanks are {name, reason} lines -
 * so they are emitted differently rather than normalised into one shape the
 * page would then have to be taught to read.
 */
function buildCollaborators(rows) {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    return {
        mainContributors: sorted
            .filter(r => r.section === 'main')
            .map(row => ({
                name: row.name,
                role: row.role || '',
                badgeType: row.badge_type || '',
                isLead: !!row.is_lead,
                avatar: row.avatar || '',
                description: row.description || '',
                links: Array.isArray(row.links) ? row.links : [],
            })),
        specialThanks: sorted
            .filter(r => r.section === 'thanks')
            .map(row => ({ name: row.name, reason: row.description || '' })),
    };
}

/**
 * Pure. The site_meta singleton row in, the exact site_meta.json shape out.
 *
 * version and tagline keep their existing keys and position because
 * js/site_meta.js reads them at runtime on every page; `hubs` is additive and
 * no runtime code touches it. It rides in this file rather than getting its
 * own because it is a few hundred bytes, it shares a source row, and a second
 * artifact would mean a second thing to keep in sync for no benefit -
 * scripts/generate-hub-meta.js reads it from here at build time.
 */
function buildSiteMeta(row) {
    // Sorted at every level so the output is stable regardless of jsonb key
    // ordering. An unstable key order would show up as a spurious diff on
    // every run and, worse, as a false "stale" in generate-hub-meta --check.
    const sortedObject = (obj) => {
        const out = {};
        for (const key of Object.keys(obj || {}).sort()) out[key] = obj[key];
        return out;
    };

    const hubs = {};
    for (const key of Object.keys(row.hubs || {}).sort()) {
        const hub = row.hubs[key] || {};
        hubs[key] = {
            title: hub.title || '',
            description: hub.description || '',
            headings: sortedObject(hub.headings),
            // Ordered step lists (Start Here, How to Contribute). Arrays keep
            // their authored order - it is the entire point of these - so they
            // are passed through rather than sorted like the key/value maps
            // above.
            lists: sortedObject(hub.lists),
        };
    }

    const gameInfo = row.game_info || {};
    return {
        version: row.version,
        tagline: row.tagline,
        hubs,
        gameInfo: {
            title: gameInfo.title || '',
            // Arrays keep their authored order - it is meaningful here, unlike
            // object key order.
            fields: Array.isArray(gameInfo.fields) ? gameInfo.fields : [],
            linksLabel: gameInfo.linksLabel || 'Official Links',
            links: Array.isArray(gameInfo.links) ? gameInfo.links : [],
        },
    };
}

async function fetchSingleton(table) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status} for ${table}: ${await res.text()}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`Refusing to continue: ${table} returned no row.`);
    }
    return rows[0];
}

async function fetchTable(table) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=sort_order`, {
        headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status} for ${table}: ${await res.text()}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`Expected an array from ${table}.`);
    // Same reasoning as the other fetchers: an empty result is a broken query
    // or a policy change, never a request to blank the site's content.
    if (rows.length === 0) throw new Error(`Refusing to continue: ${table} returned zero rows.`);
    return rows;
}

// --- CHARACTER COLOURS ---
//
// Written into a MARKED REGION of js/site_meta.js rather than into a JSON file
// of its own, because ten modules read window.CHARACTER_COLORS synchronously at
// script-evaluation time. A JSON file would have to be fetched, which would mean
// changing all ten and introducing a load-order problem the site does not have.
//
// A region rather than the whole file, because js/site_meta.js also holds
// CHARACTER_ALIASES and applyCharacterTheme, both hand-authored. Aliases
// describe how people WRITE about the roster rather than the roster itself -
// the file's own comment is explicit that they are deliberately not colour
// dictionary entries - so they are not generated from site_pages.
const COLORS_BEGIN = '// --- GENERATED REGION: CHARACTER_COLORS (scripts/fetch-content.js) ---';
const COLORS_END = '// --- END GENERATED REGION ---';

// Keyed by NAME, because that is what every consumer looks up: the roster card
// has the name, and internalstyling.js matches names in prose. page_id is the
// database's key, not this dictionary's.
function buildCharacterColors(rows) {
    // THE DEPLOY WINDOW. Migrations apply on merge to main, so between this
    // code landing on next-update and the release, production's site_pages has
    // no `color` column at all - and `select=*` simply returns rows without the
    // key rather than failing.
    //
    // Distinguished from "the column exists and every value is NULL", which is
    // the dangerous case this function must refuse. No key anywhere means not
    // deployed yet; returning null skips the write and leaves the committed
    // dictionary exactly as it is, so the regeneration job still refreshes the
    // FAQ and the collaborators instead of failing the whole run over a column
    // that has not shipped.
    const columnExists = rows.some(r => Object.prototype.hasOwnProperty.call(r, 'color'));
    if (!columnExists) return null;

    const characters = rows
        .filter(r => r.page_type === 'character' && r.color && String(r.color).trim() !== '')
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Refusing rather than writing an empty dictionary, for the same reason
    // fetchTable refuses zero rows: an empty result is a broken query or a
    // policy change, never a request to un-colour the entire roster.
    if (characters.length === 0) {
        throw new Error('Refusing to continue: no character page has a colour set.');
    }

    const body = characters
        .map(r => `    ${JSON.stringify(r.name)}: ${JSON.stringify(String(r.color).trim())}`)
        .join(',\n');

    return `${COLORS_BEGIN}\nwindow.CHARACTER_COLORS = {\n${body}\n};\n${COLORS_END}`;
}

// Swaps the marked region and leaves the rest of the file byte-identical.
function replaceRegion(source, region) {
    const start = source.indexOf(COLORS_BEGIN);
    const end = source.indexOf(COLORS_END);

    // Refuse rather than guess. generate-pages.js takes the same line with its
    // own marker: a file that does not say where the generated part begins is a
    // file this script must not rewrite.
    if (start === -1 || end === -1 || end < start) {
        throw new Error(
            'js/site_meta.js is missing the CHARACTER_COLORS generated-region markers. ' +
            'Restore them before regenerating - writing without them would guess at the boundary.');
    }

    return source.slice(0, start) + region + source.slice(end + COLORS_END.length);
}

function writeRegionIfChanged(filePath, region, label, write, results) {
    // null means the source column is not deployed yet - see buildCharacterColors.
    if (region === null) { results.push(`${label}: skipped (column not deployed)`); return; }

    const current = fs.readFileSync(filePath, 'utf8');
    const next = replaceRegion(current, region);

    if (current === next) { results.push(`${label}: no change`); return; }
    if (!write) { results.push(`${label}: would update`); return; }

    fs.writeFileSync(filePath, next);
    results.push(`${label}: written`);
}

function writeIfChanged(filePath, value, label, write, results) {
    const next = JSON.stringify(value, null, 2) + '\n';
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

    if (current === next) { results.push(`${label}: no change`); return; }
    if (!write) { results.push(`${label}: would update`); return; }

    fs.writeFileSync(filePath, next);
    results.push(`${label}: written`);
}

async function main() {
    const write = process.argv.includes('--write');

    const [faqRows, collabRows, metaRow, pageRows] = await Promise.all([
        fetchTable('site_faq'),
        fetchTable('site_collaborators'),
        fetchSingleton('site_meta'),
        fetchTable('site_pages'),
    ]);

    const results = [];
    writeIfChanged(FAQ_PATH, buildFaq(faqRows), 'faq.json', write, results);
    writeIfChanged(COLLAB_PATH, buildCollaborators(collabRows), 'collaborators_data.json', write, results);
    writeIfChanged(META_PATH, buildSiteMeta(metaRow), 'site_meta.json', write, results);
    writeRegionIfChanged(SITE_META_JS_PATH, buildCharacterColors(pageRows), 'site_meta.js colours', write, results);

    console.log(`fetch-content: ${results.join(', ')}.`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`fetch-content FAILED: ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = { buildFaq, buildCollaborators, buildSiteMeta, buildCharacterColors, replaceRegion, COLORS_BEGIN, COLORS_END };
