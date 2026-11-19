#!/usr/bin/env node
/**
 * Hover Banners (v1.2, the owner's Kanban card "Hover Banners for every
 * characters"): each character's banner, mirrored into medias/banners/, and the
 * first line of their Overview, written to data/banners.json. The roster's
 * popup (js/pagebuilder.js) and each page's Discord preview
 * (scripts/generate-pages.js) read that file.
 *
 * The banner is desc_data.profile.banner, set in the editor's Profile tab like
 * the portrait (owner, 2026-11-19: "the banner image is uploaded and edited by
 * editors, no need for me. Like the character portrait."). It is mirrored and
 * shrunk the way portraits are (scripts/fetch-portraits.js), so a hover asks
 * Supabase for nothing and never downloads a full-size upload, and the Discord
 * preview is served from the site.
 *
 * A banner that cannot be mirrored keeps its last good copy, or has none, and
 * is reported as a warning on the run: one bad upload never stops the content.
 *
 * Run: node scripts/fetch-banners.js --write   # npm run refresh-banners
 *      node scripts/fetch-banners.js --check   # offline; verifies the mirror
 */

const fs = require('fs');
const path = require('path');
const { isWebp, shrinkToWebp, closeShrinker } = require('./shrink-to-webp');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'data', 'banners.json');
const BANNER_DIR = path.join(ROOT, 'medias', 'banners');
const REPO_REL_DIR = 'medias/banners';
const VOCAB_PATH = path.join(ROOT, 'js', 'character_tabs.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
// The public anon key, as in scripts/fetch-previews.js, which says why.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// The popup is 360px wide, so 960px covers a 2x screen with room to spare, and
// is what a Discord preview shows large. Shrunk when not a WebP or over the
// size, as portraits are.
const MAX_BYTES = 200 * 1024;
const MAX_SIDE = 960;
const ALLOWED_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);

// About what a search result or a Discord preview shows before it cuts.
const MAX_LINE = 160;

/**
 * The first paragraph of an Overview, as plain words: the site's own style
 * tags stripped (stripStyleShortcodes, js/character_tabs.js), and cut at a
 * word under MAX_LINE with "..." when longer. null when there is none.
 */
function overviewLine(overview, strip) {
    for (const block of Array.isArray(overview) ? overview : []) {
        if (!block || block.type !== 'paragraph') continue;
        const raw = Array.isArray(block.content) ? block.content.join(' ') : String(block.content == null ? '' : block.content);
        const text = strip(raw).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length <= MAX_LINE) return text;
        const head = text.slice(0, MAX_LINE + 1);
        const space = head.lastIndexOf(' ');
        // A run with no space near the end is cut where it is, rather than
        // losing most of the line to find a word break.
        const cut = space > MAX_LINE * 0.6 ? head.slice(0, space) : text.slice(0, MAX_LINE);
        return cut.replace(/[\s.,;:!?-]+$/, '') + '...';
    }
    return null;
}

/**
 * pageId -> { source?, overview? } for every character page (a page with a
 * profile) that has either. Only a web address can be fetched, so a banner
 * that is not one is left out: the same rule portraits follow.
 */
function bannerSources(rows, strip) {
    const out = {};
    for (const row of rows) {
        const desc = row && row.desc_data;
        if (!desc || !desc.profile || typeof desc.profile !== 'object') continue;
        const entry = {};
        const banner = desc.profile.banner;
        if (typeof banner === 'string' && /^https?:\/\//i.test(banner.trim())) entry.source = banner.trim();
        const line = overviewLine(desc.overview, strip);
        if (line) entry.overview = line;
        if (Object.keys(entry).length) out[row.page_id] = entry;
    }
    return out;
}

function loadStripper() {
    const fakeWindow = {};
    new Function('window', fs.readFileSync(VOCAB_PATH, 'utf8'))(fakeWindow);
    if (typeof fakeWindow.stripStyleShortcodes !== 'function') {
        throw new Error('js/character_tabs.js did not define stripStyleShortcodes - has it moved?');
    }
    return fakeWindow.stripStyleShortcodes;
}

function extensionFor(url) {
    try {
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        return ALLOWED_EXT.has(ext) ? ext : null;
    } catch {
        return null;
    }
}

// --check: offline. Every banner the manifest names exists, and nothing else
// is in the folder.
function check() {
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error('fetch-banners: data/banners.json is missing. Run: npm run refresh-banners');
        return 1;
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const problems = [];
    const named = new Set();
    for (const [pageId, entry] of Object.entries(manifest)) {
        if (!entry || !entry.image) continue;
        if (!entry.image.startsWith(`${REPO_REL_DIR}/`)) problems.push(`${pageId}: ${entry.image} is not in ${REPO_REL_DIR}/`);
        else if (!fs.existsSync(path.join(ROOT, entry.image))) problems.push(`${pageId}: ${entry.image} does not exist`);
        named.add(path.basename(entry.image));
    }
    const files = fs.existsSync(BANNER_DIR) ? fs.readdirSync(BANNER_DIR) : [];
    for (const f of files) if (!named.has(f)) problems.push(`${REPO_REL_DIR}/${f} is in no entry`);
    if (problems.length) {
        console.error(`fetch-banners --check FAILED (${problems.length}):`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('\n  Run: npm run refresh-banners');
        return 1;
    }
    console.log(`banner mirror verified (${named.size} banners, ${Object.keys(manifest).length} entries).`);
    return 0;
}

async function write() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/page_data?select=page_id,desc_data`, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    // An empty answer is a broken query or an outage, never "every banner is
    // gone": refusing keeps the last good file rather than blanking it.
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Refusing to continue: page_data returned no rows.');

    const sources = bannerSources(rows, loadStripper());
    const previous = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};
    fs.mkdirSync(BANNER_DIR, { recursive: true });

    const manifest = {};
    const failures = [];
    let changed = 0;
    for (const pageId of Object.keys(sources).sort()) {
        const { source, overview } = sources[pageId];
        const entry = {};
        if (source) {
            let body = null;
            let failure = null;
            const ext = extensionFor(source);
            if (!ext) failure = `unsupported file type in ${source}`;
            else {
                try {
                    const got = await fetch(source);
                    if (!got.ok) failure = `HTTP ${got.status} for ${source}`;
                    else body = Buffer.from(await got.arrayBuffer());
                } catch (err) {
                    failure = err.message;
                }
                if (body && body.length === 0) failure = 'empty response';
            }
            let savedExt = ext;
            if (!failure && (!isWebp(body) || body.length > MAX_BYTES)) {
                try {
                    body = await shrinkToWebp(body, MAX_SIDE);
                    savedExt = '.webp';
                } catch (err) {
                    console.log(`::warning title=Banner not shrunk::${pageId}: ${err.message.split('\n')[0]}. Kept as downloaded (${Math.round(body.length / 1024)} KB).`);
                }
            }
            if (failure) {
                const kept = previous[pageId] && previous[pageId].image && fs.existsSync(path.join(ROOT, previous[pageId].image)) ? previous[pageId].image : null;
                if (kept) entry.image = kept;
                failures.push({ pageId, failure, kept });
            } else {
                const rel = `${REPO_REL_DIR}/${pageId}${savedExt}`;
                const abs = path.join(ROOT, rel);
                // Byte comparison, so a night that changes nothing leaves the
                // tree clean and the job has nothing to commit.
                if (!fs.existsSync(abs) || Buffer.compare(fs.readFileSync(abs), body) !== 0) {
                    fs.writeFileSync(abs, body);
                    changed++;
                }
                entry.image = rel;
            }
        }
        if (overview) entry.overview = overview;
        if (Object.keys(entry).length) manifest[pageId] = entry;
    }
    await closeShrinker();

    for (const { pageId, failure, kept } of failures) {
        const outcome = kept ? `kept the last good copy (${kept})` : 'no banner until it is fixed';
        console.log(`::warning title=Banner not mirrored::${pageId}: ${failure}. ${outcome}.`);
    }

    // Files no entry names any more: a banner removed, or saved under another
    // extension.
    const keep = new Set(Object.values(manifest).filter(e => e.image).map(e => path.basename(e.image)));
    let removed = 0;
    for (const f of fs.readdirSync(BANNER_DIR)) {
        if (!keep.has(f)) { fs.unlinkSync(path.join(BANNER_DIR, f)); removed++; }
    }

    const next = JSON.stringify(manifest, null, 2) + '\n';
    if (!fs.existsSync(MANIFEST_PATH) || fs.readFileSync(MANIFEST_PATH, 'utf8') !== next) fs.writeFileSync(MANIFEST_PATH, next);

    const banners = Object.values(manifest).filter(e => e.image).length;
    console.log(`fetch-banners: ${Object.keys(manifest).length} characters, ${banners} banners `
        + `(${changed} changed, ${removed} removed)`
        + (failures.length ? `, ${failures.length} not mirrored (warned above).` : '.'));
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--check')) {
        process.exitCode = check();
    } else if (args.includes('--write')) {
        // exitCode rather than exit(): see scripts/fetch-previews.js.
        write().catch(err => { console.error(`fetch-banners FAILED: ${err.message}`); process.exitCode = 1; });
    } else {
        console.error('Usage: fetch-banners.js --check | --write');
        process.exitCode = 2;
    }
}

module.exports = { overviewLine, bannerSources, MAX_LINE };
