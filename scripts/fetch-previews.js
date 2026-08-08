#!/usr/bin/env node
/**
 * Refreshes data/page-previews.json - the committed map of pageId to social
 * preview image, used by scripts/generate-pages.js for each page's og:image.
 *
 * This is the ONLY part of the page pipeline that touches the network, and
 * that separation is deliberate. generate-pages.js must stay offline and
 * deterministic because `npm run validate` runs it with --check in CI and
 * compares the committed stubs byte-for-byte. If the generator fetched
 * portraits itself, CI would need network access AND would fail whenever
 * someone changed a portrait in Supabase after the last commit - the stubs
 * would be legitimately stale through nobody's fault.
 *
 * So: this script fetches and writes a committed artifact; the generator
 * reads only committed files. Freshness is this script's job (run by the
 * regeneration workflow), correctness is the generator's.
 *
 * Credentials: uses the public anon key, which is not a secret - it already
 * ships in js/site_utils.js and is in the page source of every page on the
 * site. Deliberately NOT the service-role key: that would bypass all RLS and
 * turn a repo compromise into a database compromise. The data read here is
 * already world-readable through the "Public Read Live Data" policy.
 *
 * Usage:
 *   node scripts/fetch-previews.js            # report what would change
 *   node scripts/fetch-previews.js --write    # write data/page-previews.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'page-previews.json');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

async function fetchPagePreviews() {
    const url = `${SUPABASE_URL}/rest/v1/page_data?select=page_id,desc_data`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });

    if (!res.ok) {
        throw new Error(`Supabase returned HTTP ${res.status}: ${await res.text()}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected an array of page_data rows.');

    // An empty result means a broken query, a changed policy, or an outage -
    // never "every page lost its portrait". Refusing here is what stops a
    // transient failure from silently blanking every preview image on the
    // site, which would look exactly like a successful run.
    if (rows.length === 0) {
        throw new Error('Refusing to continue: page_data returned zero rows.');
    }

    const candidates = [];
    for (const row of rows) {
        const image = row.desc_data && row.desc_data.profile && row.desc_data.profile.image;
        // Only absolute URLs are usable as og:image - an unfurler has no page
        // context to resolve a relative path against. Portraits are Supabase
        // Storage URLs so they already are absolute, but a hand-edited
        // relative path would otherwise produce a silently broken preview.
        if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
            candidates.push([row.page_id, image]);
        }
    }

    // Confirm each portrait actually resolves before promising it to an
    // unfurler. This is not paranoia: disaster_plants' portrait was a Discord
    // CDN attachment link, which carries an `ex=` expiry - it died on
    // 2026-07-01 and had been rendering as a broken image on the live page
    // for over a month before this check was written. A dead og:image is
    // worse than the logo, because the preview renders blank rather than
    // falling back.
    const previews = {};
    const broken = [];
    await Promise.all(candidates.map(async ([pageId, image]) => {
        try {
            // HEAD first; some CDNs reject it, so fall back to a ranged GET
            // rather than downloading whole images.
            let res = await fetch(image, { method: 'HEAD' });
            if (res.status === 405 || res.status === 501) {
                res = await fetch(image, { headers: { Range: 'bytes=0-0' } });
            }
            if (res.ok || res.status === 206) previews[pageId] = image;
            else broken.push([pageId, `HTTP ${res.status}`, image]);
        } catch (err) {
            broken.push([pageId, err.message, image]);
        }
    }));

    return { previews, scanned: rows.length, broken };
}

async function main() {
    const write = process.argv.includes('--write');

    const { previews, scanned, broken } = await fetchPagePreviews();
    const found = Object.keys(previews).length;

    // Reported loudly but NOT fatal: a broken portrait is a content problem
    // for the owner to fix, and failing the run would block every other
    // page's preview over one bad image.
    if (broken.length > 0) {
        console.warn(`\n  ${broken.length} portrait(s) did not resolve and will fall back to the site logo:`);
        for (const [pageId, reason, url] of broken) {
            console.warn(`   - ${pageId}: ${reason}`);
            console.warn(`     ${url}`);
        }
        console.warn('  These are also broken on the page itself, not just in previews.\n');
    }

    // Sorted keys so the committed file has a stable diff rather than
    // reshuffling on every run and producing noise commits.
    const sorted = {};
    for (const key of Object.keys(previews).sort()) sorted[key] = previews[key];
    const next = JSON.stringify(sorted, null, 2) + '\n';

    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;

    if (current === next) {
        console.log(`fetch-previews: no change (${found} portraits across ${scanned} pages).`);
        return;
    }

    if (!write) {
        console.log(`fetch-previews: would update data/page-previews.json (${found} portraits across ${scanned} pages).`);
        return;
    }

    fs.writeFileSync(OUT_PATH, next);
    console.log(`fetch-previews: wrote ${found} portraits across ${scanned} pages.`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`fetch-previews FAILED: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { fetchPagePreviews };
