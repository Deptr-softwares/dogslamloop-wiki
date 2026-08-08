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

    const [faqRows, collabRows] = await Promise.all([
        fetchTable('site_faq'),
        fetchTable('site_collaborators'),
    ]);

    const results = [];
    writeIfChanged(FAQ_PATH, buildFaq(faqRows), 'faq.json', write, results);
    writeIfChanged(COLLAB_PATH, buildCollaborators(collabRows), 'collaborators_data.json', write, results);

    console.log(`fetch-content: ${results.join(', ')}.`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`fetch-content FAILED: ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = { buildFaq, buildCollaborators };
