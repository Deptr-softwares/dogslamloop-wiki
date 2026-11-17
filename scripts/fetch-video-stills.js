#!/usr/bin/env node
/**
 * Saves the first frame of every video the wiki's pages show, and the video's
 * size, so a page can draw that frame in the video's place, at the video's
 * real shape, until the video plays.
 *
 * Owner's performance card (2026-11-17): "For videos that takes time to load,
 * there should be a thumbnail that stands in place for those videos with the
 * exact dimension it has." Their picks: the nightly job makes them, and the
 * picture is the first frame, so nothing jumps when the clip starts.
 *
 * WHAT IT WRITES. data/video-stills.json, keyed by the video's file in the
 * wiki-media bucket (decoded, so "a%20b.webm" and "a b.webm" are one file):
 *     { "<file>": { "still": "medias/stills/<16 hex>.webp", "w": 1920, "h": 1080, "etag": "..." } }
 * and the stills in medias/stills/, named by a hash of the file name: the
 * name comes from page content and is not trusted to name a path.
 * js/description.js reads the list. Nothing is written to Storage.
 *
 * WHAT IT COSTS. On 2026-11-17 the pages used 388 videos, 1.2 GB. A WebM's
 * first frame is at its start, so this asks for the first 512 KB only. A file
 * whose start cannot be decoded on its own (an MP4 that keeps its index at the
 * end; 13 then) is fetched whole. A video that already has a still is not
 * fetched again: each night asks only for its headers, and a different ETag
 * (deleted and uploaded again under the same name) makes a new still.
 *
 * WHEN SOMETHING FAILS. A video that cannot be fetched or decoded keeps the
 * still it had, or gets none, and a yellow warning names it on the run; the
 * rest carry on, as the portrait mirror does. A run that cannot read the
 * pages at all changes nothing. A still for a video no page shows any more is
 * removed.
 *
 * The browser is the Chromium that Playwright installs for the tests and the
 * job (the portrait mirror shrinks in it too), started only when a still has
 * to be made.
 *
 * Run: node scripts/fetch-video-stills.js --write   # npm run refresh-stills
 *      node scripts/fetch-video-stills.js --check   # offline: the list and the files agree
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LIST_PATH = path.join(ROOT, 'data', 'video-stills.json');
const STILL_DIR = path.join(ROOT, 'medias', 'stills');
const REPO_REL_DIR = 'medias/stills';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';
const BUCKET = `${SUPABASE_URL}/storage/v1/object/public/wiki-media/`;
// The extensions js/description.js treats as video (WIKI_MEDIA_VIDEO_RE).
const VIDEO_EXT = /\.(webm|mp4|m4v|mov|ogv)$/i;

const PREFIX_BYTES = 512 * 1024;
const MAX_WHOLE_BYTES = 64 * 1024 * 1024;
const MAX_SIDE = 640;
const HEADS_AT_ONCE = 8;
const STILLS_AT_ONCE = 4;

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');

if (!write && !check) {
    console.error('Usage: fetch-video-stills.js --check | --write');
    process.exit(2);
}

const stillPathFor = (file) => `${REPO_REL_DIR}/${crypto.createHash('sha1').update(file).digest('hex').slice(0, 16)}.webp`;

function readList() {
    return fs.existsSync(LIST_PATH) ? JSON.parse(fs.readFileSync(LIST_PATH, 'utf8')) : {};
}

// ---------------------------------------------------------------------------
// --check: offline. Every entry names its own still, the still exists, the
// size is there, and the folder holds nothing the list does not name.
// ---------------------------------------------------------------------------
if (check) {
    let list;
    try {
        list = readList();
    } catch (err) {
        console.error(`fetch-video-stills --check FAILED: data/video-stills.json is not JSON (${err.message})`);
        process.exit(1);
    }
    const problems = [];
    for (const [file, entry] of Object.entries(list)) {
        if (!entry || typeof entry !== 'object') { problems.push(`${file}: not an entry`); continue; }
        if (entry.still !== stillPathFor(file)) problems.push(`${file}: its still should be ${stillPathFor(file)}, not ${entry.still}`);
        else if (!fs.existsSync(path.join(ROOT, entry.still))) problems.push(`${file}: ${entry.still} does not exist`);
        if (!(Number.isInteger(entry.w) && entry.w > 0 && Number.isInteger(entry.h) && entry.h > 0)) problems.push(`${file}: no size`);
    }
    const named = new Set(Object.values(list).map(e => e && path.basename(String(e.still))));
    if (fs.existsSync(STILL_DIR)) {
        for (const f of fs.readdirSync(STILL_DIR)) if (!named.has(f)) problems.push(`${REPO_REL_DIR}/${f}: in the folder but not in the list`);
    }
    if (problems.length) {
        console.error(`fetch-video-stills --check FAILED (${problems.length}):`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('\n  Run: npm run refresh-stills');
        process.exit(1);
    }
    console.log(`video stills verified (${Object.keys(list).length}).`);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// --write
// ---------------------------------------------------------------------------

// The file in the bucket a value from page content names, if it is a video
// there. The whole value, as js/description.js reads a media field.
function videoFileOf(value) {
    if (typeof value !== 'string') return null;
    const url = value.trim();
    if (!url.startsWith(BUCKET)) return null;
    let file;
    try { file = decodeURIComponent(url.slice(BUCKET.length).split(/[?#]/)[0]); } catch (e) { return null; }
    return file && VIDEO_EXT.test(file) ? file : null;
}

// Every video the pages show: file -> the address to fetch it from.
function videosIn(rows) {
    const found = new Map();
    const walk = (v) => {
        if (typeof v === 'string') {
            const file = videoFileOf(v);
            if (file && !found.has(file)) found.set(file, v.trim());
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(rows);
    return found;
}

async function inTurn(items, atOnce, work) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, async () => {
        while (next < items.length) await work(items[next++]);
    }));
}

// { tag } for a video that is there, { failure } for one that is not.
async function headOf(url) {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return { failure: `HTTP ${res.status}` };
        return { tag: res.headers.get('etag') || `${res.headers.get('content-length')}:${res.headers.get('last-modified')}` };
    } catch (err) {
        return { failure: err.message };
    }
}

async function bytesOf(url, startOnly) {
    const res = await fetch(url, startOnly ? { headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` } } : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // "bytes 0-524287/15674000" carries the whole file's size, which tells a
    // start that cannot be decoded from a file that is simply that small.
    const total = Number((res.headers.get('content-range') || '').split('/')[1]) || buf.length;
    return { buf, total, partial: res.status === 206 };
}

// The launch itself, shared: four stills start at once, and each asking
// "is there a browser yet?" before the first had started would launch four,
// three of which nothing closes, and the run would never end.
let launching = null;
async function firstFrame(buf) {
    if (!launching) launching = require('playwright').chromium.launch();
    const page = await (await launching).newPage();
    try {
        const out = await page.evaluate(async ({ data, maxSide }) => {
            const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
            const src = URL.createObjectURL(new Blob([bytes]));
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            // loadeddata: the frame at 0 can be drawn, which is the first one.
            const failure = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve('it did not load within 20 seconds'), 20000);
                video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(null); }, { once: true });
                video.addEventListener('error', () => { clearTimeout(timer); resolve(`the browser could not decode it (media error ${video.error && video.error.code})`); }, { once: true });
                video.src = src;
            });
            if (failure) throw new Error(failure);
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (!w || !h) throw new Error('it has no picture');
            const scale = Math.min(1, maxSide / Math.max(w, h));
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
            if (blob.type !== 'image/webp') throw new Error(`the browser wrote ${blob.type}, not image/webp`);
            URL.revokeObjectURL(src);
            const view = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
            return { w, h, still: btoa(binary) };
        }, { data: buf.toString('base64'), maxSide: MAX_SIDE });
        return { w: out.w, h: out.h, still: Buffer.from(out.still, 'base64') };
    } finally {
        await page.close();
    }
}

async function makeStill(url) {
    const start = await bytesOf(url, true);
    try {
        return await firstFrame(start.buf);
    } catch (err) {
        if (!(start.partial && start.buf.length < start.total)) throw err;
        if (start.total > MAX_WHOLE_BYTES) {
            throw new Error(`its start cannot be decoded, and at ${Math.round(start.total / 1048576)} MB it is too big to fetch whole`);
        }
        return firstFrame((await bytesOf(url, false)).buf);
    }
}

// A GitHub Actions annotation. The file name comes from page content, so the
// characters the runner reads as commands are escaped.
const annotate = (title, message) =>
    console.log(`::warning title=${title}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);

(async () => {
    const previous = readList();

    let rows;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/page_data?select=desc_data,frame_data,tab_settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
        rows = await res.json();
        if (!res.ok || !Array.isArray(rows)) throw new Error(`HTTP ${res.status}`);
        if (rows.length === 0) throw new Error('no pages came back');
    } catch (err) {
        // A still is an extra: a page without one draws its video as it did
        // before v1.2. So this never stops the run.
        annotate('Video stills not refreshed', `Could not read the pages (${err.message}). The stills stay as they were.`);
        return;
    }

    const videos = videosIn(rows);
    const files = [...videos.keys()];
    fs.mkdirSync(STILL_DIR, { recursive: true });

    // The still a video had, if it is still there.
    const lastGood = (file) => {
        const entry = previous[file];
        return entry && entry.still === stillPathFor(file) && fs.existsSync(path.join(ROOT, entry.still)) ? entry : null;
    };

    const heads = new Map();
    await inTurn(files, HEADS_AT_ONCE, async (file) => heads.set(file, await headOf(videos.get(file))));

    const list = {};
    const failures = [];
    const toMake = [];
    let unchanged = 0;
    for (const file of files) {
        const head = heads.get(file);
        const had = lastGood(file);
        if (head.failure) {
            if (had) list[file] = had;
            failures.push({ file, failure: head.failure, kept: Boolean(had) });
        } else if (had && had.etag === head.tag) {
            list[file] = had;
            unchanged++;
        } else {
            toMake.push(file);
        }
    }

    let made = 0;
    await inTurn(toMake, STILLS_AT_ONCE, async (file) => {
        const had = lastGood(file);
        try {
            const { w, h, still } = await makeStill(videos.get(file));
            const rel = stillPathFor(file);
            const abs = path.join(ROOT, rel);
            // Only what changed, so a night with nothing new leaves the tree
            // clean and the job has nothing to commit.
            if (!fs.existsSync(abs) || Buffer.compare(fs.readFileSync(abs), still) !== 0) fs.writeFileSync(abs, still);
            list[file] = { still: rel, w, h, etag: heads.get(file).tag };
            made++;
        } catch (err) {
            if (had) list[file] = had;
            failures.push({ file, failure: String(err.message).replace(/^.*?Error: /, '').split('\n')[0], kept: Boolean(had) });
        }
    });
    // A launch that failed has already been reported, video by video.
    if (launching) await launching.then(b => b.close(), () => {});

    const keep = new Set(Object.values(list).map(e => path.basename(e.still)));
    let removed = 0;
    for (const f of fs.readdirSync(STILL_DIR)) {
        if (!keep.has(f)) { fs.unlinkSync(path.join(STILL_DIR, f)); removed++; }
    }

    for (const { file, failure, kept } of failures.sort((a, b) => a.file.localeCompare(b.file))) {
        annotate('Video still not made', `${file}: ${failure}. ${kept ? 'It keeps the still it had.' : 'No still until it is fixed.'}`);
    }

    const sorted = {};
    for (const k of Object.keys(list).sort()) sorted[k] = list[k];
    const text = JSON.stringify(sorted, null, 2) + '\n';
    if (!fs.existsSync(LIST_PATH) || fs.readFileSync(LIST_PATH, 'utf8') !== text) fs.writeFileSync(LIST_PATH, text);

    console.log(`video stills: ${files.length} videos (${made} made, ${unchanged} unchanged, ${failures.length} failed, ${removed} removed)`);
})().catch((err) => {
    console.error(`fetch-video-stills failed: ${err.stack || err.message}`);
    process.exit(1);
});
