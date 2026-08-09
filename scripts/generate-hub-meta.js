#!/usr/bin/env node
/**
 * Rewrites the <title> and social/SEO block inside the three hub pages from
 * data/site_meta.json.
 *
 * These three pages are hand-authored and in generate-pages.js's NEVER_TOUCH
 * list, so they cannot be regenerated wholesale - they have bespoke markup
 * (roster grid, systems directory, dashboard widgets) that no generator
 * produces. But their metadata still has to be owner-editable, and it cannot
 * be injected at runtime: Discord, Twitter and Facebook unfurlers do not
 * execute JavaScript, so a tag written by js/site_meta.js is never seen by any
 * of them.
 *
 * A marked region is the narrowest thing that satisfies both. This script owns
 * exactly the lines between the markers and refuses to touch a file that does
 * not carry them - everything else in the page stays hand-authored.
 *
 * Offline and deterministic, like generate-pages.js and generate-sitemap.js,
 * because CI compares the committed files byte-for-byte. The network read that
 * produces its input lives in scripts/fetch-content.js.
 *
 * Usage:
 *   node scripts/generate-hub-meta.js            # report only (same as --check)
 *   node scripts/generate-hub-meta.js --check    # exit 1 if any page is stale
 *   node scripts/generate-hub-meta.js --write    # rewrite the regions
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const BEGIN = '<!-- BEGIN GENERATED: hub-meta - scripts/generate-hub-meta.js - do not edit by hand -->';
const END = '<!-- END GENERATED: hub-meta -->';

const SITE_ORIGIN = 'https://dogslamloop.com';   // matches CNAME
const SITE_NAME = 'Dogslamloop Wiki';
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/medias/images/DogslamloopIconGay.webp`;

// hub id -> where its page lives and how deep it sits. The relative icon href
// differs by depth, and getting it wrong silently breaks the favicon rather
// than failing loudly, so depth is declared rather than inferred.
// suffixTitle: whether <title> gets " | Dogslamloop Wiki" appended. The
// homepage's title already IS the site name, so appending would read
// "Dogslamloop Wiki | Dogslamloop Wiki". The two sub-hubs carry the suffix
// today and keep it - matching generate-pages.js, which appends the same
// string to every system page.
//
// og:title never gets the suffix, on any of them. That is the existing split
// and it is the right one: a browser tab benefits from the site name, while a
// Discord embed already shows og:site_name on its own line right above the
// title, so repeating it there is noise.
const HUBS = {
    'main-hub': { file: 'index.html', url: `${SITE_ORIGIN}/`, depth: 0, suffixTitle: false },
    'character-hub': { file: 'characters/index.html', url: `${SITE_ORIGIN}/characters/index.html`, depth: 1, suffixTitle: true },
    'systems-hub': { file: 'systems/index.html', url: `${SITE_ORIGIN}/systems/index.html`, depth: 1, suffixTitle: true },
};

function attr(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Pure: the region body for one hub. Exported for the round-trip test.
 *
 * The <title> is inside the region deliberately. It is the single string that
 * shows in the browser tab AND as the headline of a search result, so leaving
 * it hand-edited while making og:title editable would be an arbitrary split
 * the owner would have to remember.
 */
function buildRegion(hubId, meta) {
    const hub = HUBS[hubId];
    if (!hub) throw new Error(`Unknown hub id "${hubId}".`);

    const title = meta.title || SITE_NAME;
    const docTitle = hub.suffixTitle ? `${title} | ${SITE_NAME}` : title;
    const description = meta.description || '';
    const iconHref = hub.depth === 0
        ? '/medias/images/DogslamloopIconGay.webp'
        : `${'../'.repeat(hub.depth)}medias/images/DogslamloopIconGay.webp`;

    return [
        BEGIN,
        `    <title>${attr(docTitle)}</title>`,
        `    <link rel="icon" type="image/webp" href="${attr(iconHref)}">`,
        '',
        `    <meta name="description" content="${attr(description)}">`,
        `    <link rel="canonical" href="${attr(hub.url)}">`,
        '',
        `    <meta property="og:site_name" content="${attr(SITE_NAME)}">`,
        '    <meta property="og:type" content="website">',
        `    <meta property="og:title" content="${attr(title)}">`,
        `    <meta property="og:description" content="${attr(description)}">`,
        `    <meta property="og:url" content="${attr(hub.url)}">`,
        `    <meta property="og:image" content="${attr(DEFAULT_OG_IMAGE)}">`,
        // summary, not summary_large_image: the site logo is ~194x134 and
        // upscales badly into a banner. Same call generate-pages.js makes for
        // pages without a real portrait.
        '    <meta name="twitter:card" content="summary">',
        `    ${END}`,
    ].join('\n');
}

/**
 * Pure: existing file contents + region body -> new contents.
 *
 * Returns null when the file carries no markers. That is a refusal, not a
 * silent skip - the caller reports it. Inserting the markers automatically
 * would mean guessing where in someone's hand-written <head> they belong.
 */
function replaceRegion(html, region) {
    const start = html.indexOf(BEGIN);
    if (start === -1) return null;

    const endIdx = html.indexOf(END, start);
    if (endIdx === -1) return null;

    return html.slice(0, start) + region.trimStart().replace(/\n\s*$/, '') + html.slice(endIdx + END.length);
}

function main() {
    const write = process.argv.includes('--write');

    const metaPath = path.join(ROOT, 'data', 'site_meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const hubs = meta.hubs || {};

    if (Object.keys(hubs).length === 0) {
        console.error('generate-hub-meta FAILED - data/site_meta.json has no "hubs" section.');
        console.error('Run: node scripts/fetch-content.js --write');
        process.exit(1);
    }

    const stale = [];
    const missingMarkers = [];
    const planned = [];

    for (const [hubId, hub] of Object.entries(HUBS)) {
        const abs = path.join(ROOT, hub.file);
        const current = fs.readFileSync(abs, 'utf8');

        const next = replaceRegion(current, buildRegion(hubId, hubs[hubId] || {}));
        if (next === null) { missingMarkers.push(hub.file); continue; }

        planned.push({ file: hub.file, abs, next });
        if (next !== current) stale.push(hub.file);
    }

    if (missingMarkers.length > 0) {
        console.error('generate-hub-meta FAILED - these pages carry no hub-meta markers:\n');
        missingMarkers.forEach(f => console.error(`  - ${f}`));
        console.error(`\nAdd the marker pair to the <head>:\n  ${BEGIN}\n  ${END}`);
        process.exit(1);
    }

    if (!write) {
        if (stale.length === 0) {
            console.log(`generate-hub-meta --check passed (${planned.length} pages up to date).`);
            return;
        }
        console.error(`generate-hub-meta --check FAILED - ${stale.length} page(s) are stale:\n`);
        stale.forEach(f => console.error(`  - ${f}`));
        console.error('\nRun: node scripts/generate-hub-meta.js --write');
        process.exit(1);
    }

    // Nothing is written until every page has been built successfully, so a
    // failure halfway cannot leave two hubs updated and one not.
    for (const page of planned) {
        fs.writeFileSync(page.abs, page.next);
    }
    console.log(stale.length === 0
        ? `generate-hub-meta: nothing to do (${planned.length} pages already current).`
        : `generate-hub-meta: wrote ${stale.length} of ${planned.length} page(s).`);
}

if (require.main === module) main();

module.exports = { buildRegion, replaceRegion, BEGIN, END, HUBS };
