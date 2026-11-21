// The video stills job (v1.2; the owner's performance card, 2026-11-17).
//
// Owner: "For videos that takes time to load, there should be a thumbnail that
// stands in place for those videos with the exact dimension it has." Their
// picks: the nightly job makes them, and the picture is the first frame, so
// nothing jumps when the clip starts. scripts/fetch-video-stills.js saves each
// video's first frame and size in data/video-stills.json and medias/stills/.
//
// The first test reads the committed list, which the regeneration job
// rewrites, so this file is in the content gate. It never counts videos. The
// others run the real script in a folder of its own with the network
// replaced, on real clips recorded in the test's own browser, so the repo is
// never touched and nothing reaches Storage.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'fetch-video-stills.js');

test('every still in the list exists and belongs to its video, and the folder holds nothing else', () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'video-stills.json'), 'utf8'));
    expect(list && typeof list === 'object' && !Array.isArray(list)).toBe(true);

    // What js/pages/core/description.js relies on: a still of ours and a size, per video.
    for (const [file, entry] of Object.entries(list)) {
        expect(file, 'keyed by a video file').toMatch(/\.(webm|mp4|m4v|mov|ogv)$/i);
        expect(entry.still).toMatch(/^medias\/stills\/[0-9a-f]{16}\.webp$/);
        expect(Number.isInteger(entry.w) && entry.w > 0 && Number.isInteger(entry.h) && entry.h > 0, `${file} has a size`).toBe(true);
    }
    // And the script's own offline check, on the committed files.
    const check = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
});

// --- THE SCRIPT, WITH THE NETWORK REPLACED ---

const STORE = 'https://example.supabase.co/storage/v1/object/public/wiki-media/';

// A real WebM, recorded in the test's own browser: `first` for its opening
// frames, then `rest`. The still has to be `first`.
//
// On a busy runner the recorder could miss the opening frames, and then a
// still that is not `first` would say nothing about the script (this test
// passed only on a retry once, on PR #284's CI, and no cause was found). So a
// clip is checked before it is used, drawn half a second after it loads, when
// its first frame is surely there, and recorded again if it does not start
// with `first`. A wrong still is then the script's doing, never the clip's.
async function recordClip(page, opts) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        const clip = await recordOnce(page, opts);
        const start = await firstFrameOf(page, clip);
        if (near(start, opts.first)) return clip;
        console.log(`recordClip: attempt ${attempt} starts ${JSON.stringify(start)}, not ${opts.first}; recording again`);
    }
    throw new Error(`the browser could not record a clip that starts ${opts.first}`);
}

// Within what VP8's compression moves a flat color.
const near = (px, hex) => [1, 3, 5].every((i, k) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - [px.r, px.g, px.b][k]) < 80);

async function firstFrameOf(page, buf) {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        await new Promise((resolve, reject) => {
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener('error', () => reject(new Error('the recorded clip does not decode')), { once: true });
            video.src = src;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        URL.revokeObjectURL(src);
        return { r, g, b };
    }, buf.toString('base64'));
}

async function recordOnce(page, { width, height, first, rest }) {
    const b64 = await page.evaluate(async ({ width, height, first, rest }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let colour = first;
        const paint = () => { ctx.fillStyle = colour; ctx.fillRect(0, 0, width, height); };
        paint();
        const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        // Painted on every tick, so the stream carries frames of each colour.
        const timer = setInterval(paint, 30);
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 400));
        colour = rest;
        await new Promise((resolve) => setTimeout(resolve, 600));
        recorder.stop();
        await stopped;
        clearInterval(timer);
        canvas.remove();
        const view = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
        let s = '';
        for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
        return btoa(s);
    }, { width, height, first, rest });
    return Buffer.from(b64, 'base64');
}

// A still's size and the colour at its centre.
async function lookAt(page, buf) {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        // The alpha too: a still drawn before its frame was there is see-through.
        const [r, g, b, a] = ctx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data;
        return { width: bmp.width, height: bmp.height, r, g, b, a };
    }, buf.toString('base64'));
}
const isRed = (px) => px.r > 180 && px.g < 90 && px.b < 90;
const isBlue = (px) => px.b > 180 && px.r < 90 && px.g < 90;

// The script in a folder of its own, with a stand-in network that serves a
// "world" the test writes: the pages' rows, and each video's status, ETag and
// bytes. Every request a video gets is logged.
function stage() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-stills-'));
    const at = (...p) => path.join(tmp, ...p);
    for (const dir of ['scripts', 'data', 'clips']) fs.mkdirSync(at(dir), { recursive: true });
    fs.copyFileSync(SCRIPT, at('scripts', 'fetch-video-stills.js'));
    fs.writeFileSync(at('fake-network.js'), `
        const fs = require('fs');
        globalThis.fetch = async (url, opts = {}) => {
            const world = JSON.parse(fs.readFileSync(process.env.FAKE_WORLD, 'utf8'));
            url = String(url);
            if (url.includes('/rest/v1/page_data')) {
                if (world.pagesDown) throw new Error('getaddrinfo ENOTFOUND');
                return new Response(JSON.stringify(world.rows), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            const method = opts.method || 'GET';
            const range = (opts.headers && opts.headers.Range) || null;
            fs.appendFileSync(world.log, JSON.stringify({ url, method, range }) + '\\n');
            const v = world.videos[url];
            if (!v || v.status !== 200) return new Response(null, { status: v ? v.status : 400 });
            if (method === 'HEAD') return new Response(null, { status: 200, headers: { etag: v.etag } });
            const bytes = fs.readFileSync(v.file);
            if (range) {
                const end = Math.min(bytes.length, 512 * 1024) - 1;
                const body = v.garbageStart ? Buffer.from('not the start of a video') : bytes.subarray(0, end + 1);
                return new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-' + end + '/' + bytes.length } });
            }
            return new Response(bytes, { status: 200 });
        };`);
    const world = { rows: [], videos: {}, log: at('requests.log') };
    const save = () => fs.writeFileSync(at('world.json'), JSON.stringify(world));
    const clip = (name, bytes) => { fs.writeFileSync(at('clips', name), bytes); return at('clips', name); };
    const run = (mode = '--write') => {
        save();
        fs.writeFileSync(world.log, '');
        const out = spawnSync(process.execPath, ['--require', at('fake-network.js'), at('scripts', 'fetch-video-stills.js'), mode], {
            cwd: tmp, encoding: 'utf8', timeout: 90000,
            // The copy lives outside the repo, so it is told where playwright is.
            env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), SUPABASE_URL: 'https://example.supabase.co', FAKE_WORLD: at('world.json') },
        });
        const requests = fs.readFileSync(world.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        return { ...out, requests, warnings: out.stdout.split('\n').filter((l) => l.startsWith('::warning')) };
    };
    const list = () => JSON.parse(fs.readFileSync(at('data', 'video-stills.json'), 'utf8'));
    const still = (entry) => fs.readFileSync(at(entry.still));
    const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    return { at, world, clip, run, list, still, cleanup };
}

test('the job saves each video\'s first frame and its size, and the next night fetches nothing', async ({ page }) => {
    test.setTimeout(180000);
    await page.setContent('<!doctype html><html><body></body></html>');
    const s = stage();
    try {
        const wide = `${STORE}My%20Clip.webm`;   // stored encoded; keyed decoded
        const tall = `${STORE}tall.webm`;
        const late = `${STORE}late-index.webm`;  // its start cannot be decoded alone
        const inText = `${STORE}only-in-text.webm`;
        s.world.videos[wide] = { status: 200, etag: '"w1"', file: s.clip('wide.webm', await recordClip(page, { width: 1280, height: 720, first: '#ff0000', rest: '#00ff00' })) };
        s.world.videos[tall] = { status: 200, etag: '"t1"', file: s.clip('tall.webm', await recordClip(page, { width: 360, height: 640, first: '#0000ff', rest: '#00ff00' })) };
        s.world.videos[late] = { status: 200, etag: '"l1"', garbageStart: true, file: s.clip('late.webm', await recordClip(page, { width: 400, height: 300, first: '#ff0000', rest: '#00ff00' })) };
        s.world.videos[inText] = { status: 200, etag: '"x1"', file: s.clip('x.webm', await recordClip(page, { width: 200, height: 200, first: '#ff0000', rest: '#00ff00' })) };
        // Where videos sit in page content: a skill's media, a move's video. A
        // link inside a sentence is not a video on the page, so it gets none.
        s.world.rows = [
            { desc_data: { skills: [{ media: { src: wide } }] }, frame_data: { moves: [{ video: tall }, { video: ` ${late} ` }] }, tab_settings: null },
            { desc_data: { note: `Watch this: ${inText}` }, frame_data: null, tab_settings: null },
        ];

        const first = s.run();
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
        expect(first.stdout).toContain('3 made');
        expect(first.warnings).toEqual([]);

        const list = s.list();
        expect(Object.keys(list)).toEqual(['My Clip.webm', 'late-index.webm', 'tall.webm']);
        // The video's own size, for the page's box; the still at most 640px.
        expect(list['My Clip.webm']).toMatchObject({ w: 1280, h: 720, etag: '"w1"' });
        expect(list['tall.webm']).toMatchObject({ w: 360, h: 640 });

        const wideStill = await lookAt(page, s.still(list['My Clip.webm']));
        expect([wideStill.width, wideStill.height]).toEqual([640, 360]);
        expect(isRed(wideStill), `the first frame (red), not a later one: ${JSON.stringify(wideStill)}`).toBe(true);
        const tallStill = await lookAt(page, s.still(list['tall.webm']));
        expect([tallStill.width, tallStill.height]).toEqual([360, 640]);
        expect(isBlue(tallStill), `the first frame (blue), not a later one: ${JSON.stringify(tallStill)}`).toBe(true);
        // The one that once passed only on a retry: what it saw, if it fails
        // again. Its clip is checked to start red, so see-through (a: 0) means
        // the script drew too early, and green that it drew a later frame.
        const lateStill = await lookAt(page, s.still(list['late-index.webm']));
        expect(isRed(lateStill), `the first frame (red), not a later one: ${JSON.stringify(lateStill)}`).toBe(true);

        // The start only, except for the one whose start cannot be decoded.
        const gets = (url) => first.requests.filter((r) => r.url === url && r.method === 'GET');
        expect(gets(wide).map((r) => r.range)).toEqual(['bytes=0-524287']);
        expect(gets(tall).map((r) => r.range)).toEqual(['bytes=0-524287']);
        expect(gets(late).map((r) => r.range)).toEqual(['bytes=0-524287', null]);
        expect(first.requests.some((r) => r.url === inText), 'a link inside a sentence is left alone').toBe(false);

        // The next night: headers only, nothing rewritten.
        const before = fs.readFileSync(s.at('data', 'video-stills.json'), 'utf8');
        const second = s.run();
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
        expect(second.stdout).toContain('0 made, 3 unchanged');
        expect(second.requests.every((r) => r.method === 'HEAD'), JSON.stringify(second.requests)).toBe(true);
        expect(fs.readFileSync(s.at('data', 'video-stills.json'), 'utf8')).toBe(before);

        // The same name, a new file: a new still, and only for that one.
        s.world.videos[wide] = { status: 200, etag: '"w2"', file: s.clip('wide2.webm', await recordClip(page, { width: 1280, height: 720, first: '#0000ff', rest: '#00ff00' })) };
        const tallBytes = s.still(list['tall.webm']);
        const third = s.run();
        expect(third.stdout).toContain('1 made, 2 unchanged');
        const replaced = await lookAt(page, s.still(s.list()['My Clip.webm']));
        expect(isBlue(replaced), `the new clip's first frame (blue): ${JSON.stringify(replaced)}`).toBe(true);
        expect(s.list()['My Clip.webm'].etag).toBe('"w2"');
        expect(Buffer.compare(s.still(s.list()['tall.webm']), tallBytes)).toBe(0);

        const check = s.run('--check');
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    } finally {
        s.cleanup();
    }
});

test('a video it cannot fetch or decode keeps the still it had, or gets none, and the rest carry on', async ({ page }) => {
    test.setTimeout(180000);
    await page.setContent('<!doctype html><html><body></body></html>');
    const s = stage();
    try {
        const good = `${STORE}good.webm`;
        const flaky = `${STORE}flaky.webm`;
        const gone = `${STORE}gone.webm`;
        for (const [url, name] of [[good, 'good'], [flaky, 'flaky'], [gone, 'gone']]) {
            s.world.videos[url] = { status: 200, etag: `"${name}"`, file: s.clip(`${name}.webm`, await recordClip(page, { width: 320, height: 180, first: '#ff0000', rest: '#00ff00' })) };
        }
        s.world.rows = [{ desc_data: { a: good, b: flaky, c: gone }, frame_data: null, tab_settings: null }];
        expect(s.run().stdout).toContain('3 made');
        const had = s.list();
        const flakyBytes = s.still(had['flaky.webm']);

        // The next night: Storage stumbles on one, one is deleted from Storage,
        // one upload is not a video at all, and no page links `gone` any more.
        const missing = `${STORE}missing.webm`;
        const broken = `${STORE}broken.webm`;
        s.world.videos[flaky].status = 503;
        s.world.videos[missing] = { status: 400 };
        s.world.videos[broken] = { status: 200, etag: '"b"', file: s.clip('broken.webm', Buffer.from('this is not a video')) };
        s.world.rows = [{ desc_data: { a: good, b: flaky, d: missing, e: broken }, frame_data: null, tab_settings: null }];

        const night = s.run();
        expect(night.status, `the run carries on:\n${night.stdout}${night.stderr}`).toBe(0);
        const list = s.list();
        expect(Object.keys(list)).toEqual(['flaky.webm', 'good.webm']);
        expect(list['good.webm']).toEqual(had['good.webm']);
        expect(list['flaky.webm'], 'the still it had is kept').toEqual(had['flaky.webm']);
        expect(Buffer.compare(s.still(list['flaky.webm']), flakyBytes)).toBe(0);
        expect(fs.existsSync(s.at(had['gone.webm'].still)), 'a still no page shows is removed').toBe(false);

        // A yellow warning on the run for each, naming it; none for the rest.
        const named = (file) => night.warnings.filter((l) => l.includes(`::${file}:`));
        expect(named('flaky.webm')[0]).toContain('keeps the still it had');
        expect(named('missing.webm')[0]).toContain('HTTP 400');
        expect(named('broken.webm')[0]).toContain('No still until it is fixed');
        expect(named('good.webm')).toEqual([]);
        expect(night.warnings.every((l) => l.startsWith('::warning title=Video still not made::'))).toBe(true);

        // Pages that cannot be read at all: nothing changes, and it says so.
        const listText = fs.readFileSync(s.at('data', 'video-stills.json'), 'utf8');
        s.world.pagesDown = true;
        const down = s.run();
        expect(down.status, `${down.stdout}${down.stderr}`).toBe(0);
        expect(down.warnings.join('\n')).toContain('Could not read the pages');
        expect(fs.readFileSync(s.at('data', 'video-stills.json'), 'utf8')).toBe(listText);
        expect(fs.existsSync(s.at(list['good.webm'].still))).toBe(true);

        const check = s.run('--check');
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    } finally {
        s.cleanup();
    }
});

test('the offline check catches a missing still, a still under the wrong name, no size, and a stray file', () => {
    const s = stage();
    try {
        // The naming rule: a hash of the file name, never the name itself.
        const named = (file) => `medias/stills/${require('crypto').createHash('sha1').update(file).digest('hex').slice(0, 16)}.webp`;
        fs.mkdirSync(s.at('medias', 'stills'), { recursive: true });
        fs.writeFileSync(s.at('data', 'video-stills.json'), JSON.stringify({
            'gone.webm': { still: named('gone.webm'), w: 10, h: 10, etag: '"a"' },
            'renamed.webm': { still: 'medias/stills/0000000000000000.webp', w: 10, h: 10, etag: '"b"' },
            'sizeless.webm': { still: named('sizeless.webm'), w: 0, h: 10, etag: '"c"' },
            'fine.webm': { still: named('fine.webm'), w: 10, h: 10, etag: '"d"' },
        }));
        fs.writeFileSync(s.at(named('sizeless.webm')), 'a still');
        fs.writeFileSync(s.at(named('fine.webm')), 'a still');
        fs.writeFileSync(s.at('medias', 'stills', 'ffffffffffffffff.webp'), 'stray');

        const out = s.run('--check');
        expect(out.status).toBe(1);
        expect(out.stderr).toContain(`gone.webm: ${named('gone.webm')} does not exist`);
        expect(out.stderr).toContain('renamed.webm: its still should be');
        expect(out.stderr).toContain('sizeless.webm: no size');
        expect(out.stderr).toContain('ffffffffffffffff.webp: in the folder but not in the list');
        expect(out.stderr).not.toContain('fine.webm');
    } finally {
        s.cleanup();
    }
});

test('the regeneration job makes the stills after it installs the browser they are drawn in', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'regenerate.yml'), 'utf8');
    const install = yml.indexOf('run: npx playwright install --with-deps chromium');
    const stills = yml.indexOf('run: node scripts/fetch-video-stills.js --write');
    expect(install).toBeGreaterThan(-1);
    expect(stills).toBeGreaterThan(install);
    // Before the content checks, so they see the list this run wrote.
    expect(stills).toBeLessThan(yml.indexOf('run: npm run test:content'));
});
