#!/usr/bin/env node
/**
 * Regenerates data/navigation.json from the site_pages table.
 *
 * navigation.json drives every list on the site - the global sidebar, the
 * character roster grid, the systems directory - so this is the highest-blast-
 * radius generated artifact in the repo. Two things keep that safe:
 *
 *   1. buildNavigation() is pure and exported, and there is a test asserting
 *      that feeding it the registry reproduces the committed navigation.json
 *      byte-for-byte. That round-trip is what proves the table is a faithful
 *      mirror rather than an approximation.
 *   2. Nothing is written unless the result passes validate-navigation.js's
 *      own rules in-process first.
 *
 * Like scripts/fetch-previews.js this uses the public anon key, never the
 * service-role key - see that file for the reasoning.
 *
 * Usage:
 *   node scripts/fetch-registry.js            # report what would change
 *   node scripts/fetch-registry.js --write    # write data/navigation.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NAV_PATH = path.join(ROOT, 'data', 'navigation.json');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// Categories render in this order in the sidebar. Held here rather than
// derived from the data so a new category cannot silently reorder the whole
// menu; an unknown one is appended rather than dropped.
const CATEGORY_ORDER = ['Characters', 'System Pages', 'Site Info', 'Guides'];

/**
 * Pure: registry rows in, the navigation.json object out.
 *
 * Field presence matters as much as field values. The existing JSON omits
 * optional flags rather than writing `false`, and omits archetype/tier for
 * non-characters - emitting them unconditionally would produce a valid but
 * enormous diff and change what `renderFilteredRoster` filters on.
 */
function buildNavigation(rows) {
    const byCategory = {};

    for (const row of rows) {
        // Draft and archived pages stay out of the navigation. An archived
        // page keeps its stub (as a tombstone) so old links still resolve,
        // but it should not be advertised in menus any more.
        if (row.status !== 'live') continue;

        const entry = { id: row.nav_id, name: row.name, url: row.url };

        if (row.is_wip) entry.isWip = true;
        if (row.is_ea) entry.isEA = true;
        if (row.is_base_only) entry.isBaseOnly = true;
        if (row.is_missing_media) entry.isMissingMedia = true;
        if (row.is_subjective) entry.isSubjective = true;

        if (row.archetype) entry.archetype = row.archetype;
        if (row.tier) entry.tier = row.tier;
        if (row.release_date) entry.releaseDate = row.release_date;

        entry.cms_config = {
            pageType: row.page_type,
            pageId: row.page_id,
            editRole: row.edit_role,
        };

        (byCategory[row.category] = byCategory[row.category] || []).push({ entry, sort: row.sort_order });
    }

    const out = {};
    const categories = [
        ...CATEGORY_ORDER.filter(c => byCategory[c]),
        ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
    ];
    for (const category of categories) {
        out[category] = byCategory[category]
            .sort((a, b) => a.sort - b.sort)
            .map(x => x.entry);
    }
    return out;
}

/** Re-runs validate-navigation.js's rules without shelling out. */
function validateNavigation(nav) {
    const VALID_PAGE_TYPES = new Set(['character', 'system', 'tierlist', 'hub', 'external']);
    const VALID_EDIT_ROLES = new Set(['open', 'elevated', 'locked']);
    const errors = [];
    const seen = new Map();

    for (const [category, entries] of Object.entries(nav)) {
        if (!Array.isArray(entries)) { errors.push(`Category "${category}" is not an array.`); continue; }
        entries.forEach((entry, idx) => {
            const where = `${category}[${idx}] (id: ${entry.id || '<missing>'})`;
            if (!entry.id) errors.push(`${where}: missing "id".`);
            const cms = entry.cms_config;
            if (!cms) { errors.push(`${where}: missing "cms_config".`); return; }
            if (!cms.pageId) errors.push(`${where}: cms_config.pageId must be non-empty.`);
            else if (seen.has(cms.pageId)) errors.push(`${where}: duplicate pageId "${cms.pageId}" (also ${seen.get(cms.pageId)}).`);
            else seen.set(cms.pageId, where);
            if (!VALID_PAGE_TYPES.has(cms.pageType)) errors.push(`${where}: bad pageType "${cms.pageType}".`);
            if (!VALID_EDIT_ROLES.has(cms.editRole)) errors.push(`${where}: bad editRole "${cms.editRole}".`);
        });
    }
    return errors;
}

async function fetchRegistry() {
    const url = `${SUPABASE_URL}/rest/v1/site_pages?select=*&order=category,sort_order`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status}: ${await res.text()}`);

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected an array of site_pages rows.');

    // An empty registry would regenerate an empty navigation.json and erase
    // every menu on the site. That is never a legitimate result of a
    // successful query, so it is treated as a failure rather than obeyed.
    if (rows.length === 0) {
        throw new Error('Refusing to continue: site_pages returned zero rows.');
    }
    return rows;
}

async function main() {
    const write = process.argv.includes('--write');

    const rows = await fetchRegistry();
    const nav = buildNavigation(rows);

    const errors = validateNavigation(nav);
    if (errors.length > 0) {
        console.error('fetch-registry FAILED - the generated navigation is invalid, nothing written:\n');
        errors.forEach(e => console.error(`  - ${e}`));
        process.exitCode = 1;
        return;
    }

    const next = JSON.stringify(nav, null, 2) + '\n';
    const current = fs.existsSync(NAV_PATH) ? fs.readFileSync(NAV_PATH, 'utf8') : null;

    if (current === next) {
        console.log(`fetch-registry: no change (${rows.length} rows).`);
        return;
    }

    if (!write) {
        console.log(`fetch-registry: would update data/navigation.json (${rows.length} rows).`);
        return;
    }

    fs.writeFileSync(NAV_PATH, next);
    console.log(`fetch-registry: wrote navigation.json from ${rows.length} rows.`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`fetch-registry FAILED: ${err.message}`);
        // exitCode rather than exit(1): outstanding fetch handles make an
        // immediate exit crash libuv on Windows and report 127 instead of 1.
        process.exitCode = 1;
    });
}

module.exports = { buildNavigation, validateNavigation };
