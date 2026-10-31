#!/usr/bin/env node
/**
 * Mirrors character portraits from Supabase Storage into the repo, and writes
 * data/portraits.json mapping page_id to the local copy.
 *
 * WHY MIRROR RATHER THAN LINK.
 *
 * 1. The tier list renders portraits onto a canvas for the Create Tier List
 *    export. A cross-origin image taints the canvas and makes toBlob() throw
 *    SecurityError - which is the same call the clipboard path needs, so
 *    copying instead of downloading does not avoid it. Supabase Storage does
 *    send `Access-Control-Allow-Origin: *`, so crossOrigin="anonymous" would
 *    work; but it only works if EVERY request for that image is a CORS
 *    request. One earlier non-CORS load leaves a cache entry with no CORS
 *    headers, and a later crossOrigin load can reuse it and taint the canvas
 *    anyway - intermittently, and only for people who visited before. A
 *    same-origin image cannot taint a canvas in any browser, ever.
 *
 * 2. Egress. Portraits are currently fetched from Supabase on every visit to
 *    a tier list page. Served from the repo they cost nothing.
 *
 * 3. The URLs are currently GUESSED, and the guess is wrong for five
 *    characters. js/tierlist.js built them by stripping punctuation from the
 *    display name and appending "Portrait.webp", which misses
 *    DisasterPlantsPortrait2.webp, LocustPortrait.webp,
 *    BlackDeathPortrait2.webp and Boomcat.webp. The <img> carries
 *    onerror="this.style.display='none'", so those five have simply been
 *    rendering no portrait rather than reporting anything.
 *
 * NO RESIZING, DELIBERATELY. All 23 portraits total ~437KB, the largest 47KB.
 * They are already downloaded by every visitor today; mirroring changes the
 * host, not the byte count. Resizing would mean an image-processing dependency
 * in a repo that has no build step, to save a fraction of a megabyte.
 *
 * Run: node scripts/fetch-portraits.js --write   # npm run refresh-portraits
 *      node scripts/fetch-portraits.js --check   # offline; verifies the mirror
 *
 * --check makes NO network calls. It belongs in the suite rather than in
 * `npm run validate` for that reason - see tests/portrait-mirror.spec.js.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREVIEWS_PATH = path.join(ROOT, 'data', 'page-previews.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'portraits.json');
const PORTRAIT_DIR = path.join(ROOT, 'medias', 'portraits');
const REPO_REL_DIR = 'medias/portraits';

// Anything not on this list is refused rather than written. The filename comes
// from a URL in the database, so it is not trusted to name a path.
const ALLOWED_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');

if (!write && !check) {
    console.error('Usage: fetch-portraits.js --check | --write');
    process.exit(2);
}

function readPreviews() {
    const previews = JSON.parse(fs.readFileSync(PREVIEWS_PATH, 'utf8'));
    const entries = Object.entries(previews).filter(([, url]) => typeof url === 'string' && url);
    if (entries.length === 0) {
        console.error('fetch-portraits: page-previews.json has no portraits. Refusing to act on an empty map.');
        process.exit(1);
    }
    return entries;
}

function extensionFor(url) {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ALLOWED_EXT.has(ext) ? ext : null;
}

// ---------------------------------------------------------------------------
// --check: offline. Every portrait in the map has a local file and a manifest
// entry pointing at it.
// ---------------------------------------------------------------------------
if (check) {
    const entries = readPreviews();

    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error('fetch-portraits: data/portraits.json is missing. Run: npm run refresh-portraits');
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const problems = [];

    for (const [pageId] of entries) {
        if (!(pageId in manifest)) {
            problems.push(`${pageId}: in page-previews.json but not mirrored`);
            continue;
        }
        const rel = manifest[pageId];
        // null is --write saying "could not mirror this one, and there was no
        // earlier copy to keep". It warned about it then, and does on every
        // run until the portrait is fixed.
        if (rel === null) continue;
        if (!fs.existsSync(path.join(ROOT, rel))) {
            problems.push(`${pageId}: manifest points at ${rel}, which does not exist`);
        }
    }

    // A manifest entry for a page that no longer has a portrait is stale
    // rather than broken, but it still means the mirror and the map disagree.
    const previewIds = new Set(entries.map(([id]) => id));
    for (const pageId of Object.keys(manifest)) {
        if (!previewIds.has(pageId)) problems.push(`${pageId}: mirrored but no longer in page-previews.json`);
    }

    if (problems.length) {
        console.error(`fetch-portraits --check FAILED (${problems.length}):`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('\n  Run: npm run refresh-portraits');
        process.exit(1);
    }

    console.log(`portrait mirror verified (${entries.length} portraits).`);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// --write: fetch each portrait, write only what actually changed.
// ---------------------------------------------------------------------------
(async () => {
    const entries = readPreviews();
    fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

    const previous = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};
    const manifest = {};
    const failures = [];
    let changed = 0;
    let unchanged = 0;

    for (const [pageId, url] of entries) {
        const ext = extensionFor(url);
        let body = null;
        let failure = null;
        if (!ext) {
            failure = `unsupported extension in ${url}`;
        } else {
            try {
                const res = await fetch(url);
                if (!res.ok) failure = `HTTP ${res.status} for ${url}`;
                else body = Buffer.from(await res.arrayBuffer());
            } catch (err) {
                failure = err.message;
            }
            if (body && body.length === 0) failure = 'empty response';
        }

        // One portrait that cannot be mirrored no longer stops the run (owner,
        // 2026-10-29): a .webm on Hired Hunter stopped every page publishing
        // on 2026-10-25. It keeps its last good copy, so a Storage outage
        // still removes nothing from the site; a character that never had one
        // is recorded as null, which reads as "no portrait" everywhere.
        if (failure) {
            const kept = previous[pageId] && fs.existsSync(path.join(ROOT, previous[pageId])) ? previous[pageId] : null;
            manifest[pageId] = kept;
            failures.push({ pageId, failure, kept });
            continue;
        }

        const filename = `${pageId}${ext}`;
        const abs = path.join(PORTRAIT_DIR, filename);
        manifest[pageId] = `${REPO_REL_DIR}/${filename}`;

        // Byte comparison rather than an unconditional write, so a run that
        // changes nothing leaves the working tree clean and the regeneration
        // job has nothing to commit.
        if (fs.existsSync(abs) && Buffer.compare(fs.readFileSync(abs), body) === 0) {
            unchanged++;
            continue;
        }
        fs.writeFileSync(abs, body);
        changed++;
    }

    // A GitHub Actions annotation, so the run shows a yellow warning naming
    // each one rather than passing in silence. Written to stdout, where the
    // runner reads workflow commands.
    for (const { pageId, failure, kept } of failures) {
        const outcome = kept ? `kept the last good copy (${kept})` : 'no portrait until it is fixed';
        console.log(`::warning title=Portrait not mirrored::${pageId}: ${failure}. ${outcome}.`);
    }

    // Files that no longer correspond to any portrait in the map.
    const keep = new Set(Object.values(manifest).filter(Boolean).map(rel => path.basename(rel)));
    let removed = 0;
    for (const f of fs.readdirSync(PORTRAIT_DIR)) {
        if (!keep.has(f)) { fs.unlinkSync(path.join(PORTRAIT_DIR, f)); removed++; }
    }

    const sorted = {};
    for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k];
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n');

    console.log(`fetch-portraits: ${entries.length - failures.length} portraits mirrored `
        + `(${changed} changed, ${unchanged} unchanged, ${removed} removed)`
        + (failures.length ? `, ${failures.length} not mirrored (warned above).` : '.'));
})();
