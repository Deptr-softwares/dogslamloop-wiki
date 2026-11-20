// Portraits are mirrored into the repo, and the tier list uses the mirror.
//
// Two things depend on this and they pull in the same direction.
//
// The Create Tier List export draws portraits onto a canvas. A cross-origin
// image taints the canvas, and a tainted canvas makes toBlob() throw
// SecurityError - which is the call BOTH the download and the clipboard path
// need, so copying instead of downloading does not avoid it. Supabase Storage
// does send Access-Control-Allow-Origin: *, so crossOrigin="anonymous" would
// work, but only if every request for that image is a CORS request; one
// earlier non-CORS load leaves a cache entry without CORS headers that a later
// crossOrigin load can reuse. A same-origin image cannot taint a canvas at all.
//
// And the URLs were previously guessed - display name, punctuation stripped,
// plus "Portrait.webp". That guess 404s for five characters, and the <img>
// carries onerror="this.style.display='none'", so they rendered nothing and
// said nothing.
//
// These assertions are deliberately about the RELATIONSHIP between the map and
// the mirror, never about how many characters exist. Pinning a count to the
// roster is what once blocked the owner from adding pages and killed the
// regeneration job for three days.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const previews = require('../data/page-previews.json');
const manifest = require('../data/portraits.json');

test('every portrait in the map is mirrored, and every mirrored file exists', () => {
    const ids = Object.entries(previews)
        .filter(([, url]) => typeof url === 'string' && url)
        .map(([id]) => id);

    // Sanity: an empty map would make every assertion below vacuous.
    expect(ids.length).toBeGreaterThan(0);

    // null is the mirror recording a portrait it could not fetch and had no
    // earlier copy of. It warned on the run; the test below covers that path.
    const missing = ids.filter(id => !(id in manifest));
    expect(missing, 'in page-previews.json but never mirrored — run npm run refresh-portraits').toEqual([]);

    const absent = ids.filter(id => manifest[id] !== null && !fs.existsSync(path.join(ROOT, manifest[id])));
    expect(absent, 'manifest points at a file that does not exist').toEqual([]);

    const stale = Object.keys(manifest).filter(id => !ids.includes(id));
    expect(stale, 'mirrored but no longer in page-previews.json').toEqual([]);
});

test('no mirrored portrait is a remote URL — this is what keeps the canvas untainted', () => {
    // The consequence, not the setup. A manifest entry that pointed back at
    // Supabase would satisfy "the tier list has a portrait" and still break
    // the export, silently, at toBlob().
    const remote = Object.entries(manifest)
        .filter(([, rel]) => rel !== null && (/^(https?:)?\/\//i.test(rel) || rel.startsWith('/')))
        .map(([id, rel]) => `${id} -> ${rel}`);

    expect(remote, 'a remote or absolute portrait path taints the export canvas').toEqual([]);
});

test('the live tier list renders same-origin portraits, not guessed Supabase URLs', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // The live page renders Certified Tier Lists out of `tier_lists` - not
    // page_data, which is what it used before v0.14. Both the index query and
    // the per-slug detail query hit the same table, so one route handles both
    // and branches on whether a slug was requested.
    //
    // boomcat and disaster_plants are two of the five the old guess got wrong,
    // which is what makes this fail against the pre-fix code rather than
    // merely pass against the new.
    const LIST = {
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'owner',
        author_name: 'Seed Author',
        blurb: 'Fixture list.',
        status: 'published',
        updated_at: new Date().toISOString(),
        reasoning: [],
        tiers: [{ name: 'S', color: 'hsl(0, 80%, 60%)', characters: ['boomcat', 'disaster_plants'] }],
    };

    await page.route('**/rest/v1/tier_lists**', route => {
        const single = /slug=eq\./.test(route.request().url());
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(single ? LIST : [LIST]),
        });
    });
    await page.route('**/rest/v1/tier_page_settings**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ intro: [] }) }));
    await page.route('**/rest/v1/tier_list_changes**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    await page.goto('/systems/tierlist/index.html', { waitUntil: 'domcontentloaded' });

    // The index lists authors; a list only renders its tiers once opened. A
    // test that stopped at the index would assert nothing about portraits.
    const openList = page.locator('.ctl-author-btn').first();
    await expect(openList).toBeVisible();
    await openList.click();

    const images = page.locator('.tier-portrait-img');
    await expect.poll(() => images.count(), { timeout: 10000 }).toBeGreaterThan(0);

    const sources = await images.evaluateAll(nodes => nodes.map(n => n.getAttribute('src') || ''));

    const remote = sources.filter(src => /supabase\.co/i.test(src));
    expect(remote, 'the tier list is still pointing at Supabase for portraits').toEqual([]);

    // And they must actually resolve — a same-origin 404 would still hide
    // itself behind the onerror handler.
    const broken = await images.evaluateAll(nodes =>
        nodes.filter(n => n.complete && n.naturalWidth === 0).map(n => n.getAttribute('src')));
    expect(broken, 'a mirrored portrait did not load').toEqual([]);

    expect(errors).toEqual([]);
});

// One portrait that cannot be mirrored no longer stops the run (owner,
// 2026-10-29). On 2026-10-25 Hired Hunter's portrait was set to a .webm, the
// mirror refused it, wrote nothing and exited 1, and the regeneration job
// published nothing for any page that night.
//
// The real script, run in a folder of its own (its ROOT is the folder above
// it), with the network replaced, so the test can write and the repo is never
// touched.
test('a portrait that cannot be mirrored keeps its last good copy, or none, and the rest still publish', () => {
    const os = require('os');
    const { spawnSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-mirror-'));
    try {
        const at = (...p) => path.join(tmp, ...p);
        for (const dir of ['scripts', 'data', 'medias/portraits']) fs.mkdirSync(at(dir), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'scripts', 'fetch-portraits.js'), at('scripts', 'fetch-portraits.js'));
        // Its shrinker is a module of its own since v1.2, shared with fetch-banners.js.
        fs.copyFileSync(path.join(ROOT, 'scripts', 'shrink-to-webp.js'), at('scripts', 'shrink-to-webp.js'));

        const STORE = 'https://example.supabase.co/storage/v1/object/public/wiki-media';
        fs.writeFileSync(at('data', 'page-previews.json'), JSON.stringify({
            fine: `${STORE}/fine.webp`,         // mirrors normally
            video: `${STORE}/clip.webm`,        // the 10-25 case: had a portrait before
            first: `${STORE}/first.mp4`,        // a new character whose first upload is wrong
            flaky: `${STORE}/flaky.png`,        // the fetch itself fails
        }));
        fs.writeFileSync(at('data', 'portraits.json'), JSON.stringify({
            video: 'medias/portraits/video.webp',
            flaky: 'medias/portraits/flaky.webp',
            gone: 'medias/portraits/gone.webp', // no longer has a portrait at all
        }));
        for (const f of ['video.webp', 'flaky.webp', 'gone.webp']) fs.writeFileSync(at('medias', 'portraits', f), `old ${f}`);

        // RIFF....WEBP: since v1.2 a portrait that is not a WebP is shrunk, and
        // this test is about fetching, so its bytes say WebP.
        fs.writeFileSync(at('fake-network.js'), `
            globalThis.fetch = async (url) => {
                if (url.includes('flaky')) throw new Error('socket hang up');
                return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('RIFF0000WEBPnew ' + url).buffer };
            };`);

        const run = spawnSync(process.execPath, ['--require', at('fake-network.js'), at('scripts', 'fetch-portraits.js'), '--write'],
            { cwd: tmp, encoding: 'utf8' });
        expect(run.status, `the run carries on:\n${run.stdout}${run.stderr}`).toBe(0);

        expect(JSON.parse(fs.readFileSync(at('data', 'portraits.json'), 'utf8'))).toEqual({
            fine: 'medias/portraits/fine.webp',
            first: null,                         // known, not mirrored
            flaky: 'medias/portraits/flaky.webp',
            video: 'medias/portraits/video.webp',
        });
        const file = (f) => fs.existsSync(at('medias', 'portraits', f)) ? fs.readFileSync(at('medias', 'portraits', f), 'utf8') : null;
        expect(file('fine.webp')).toBe(`RIFF0000WEBPnew ${STORE}/fine.webp`);
        expect(file('video.webp'), 'the last good portrait is kept').toBe('old video.webp');
        expect(file('flaky.webp')).toBe('old flaky.webp');
        expect(file('gone.webp'), 'a character with no portrait any more still loses its copy').toBeNull();

        // A yellow annotation on the run, one per portrait, naming it.
        const warnings = run.stdout.split('\n').filter(l => l.startsWith('::warning'));
        for (const id of ['video', 'first', 'flaky']) {
            expect(warnings.some(l => l.includes(id)), `${id} is named in a warning`).toBe(true);
        }
        expect(warnings.some(l => l.includes('fine')), 'nothing is said about the one that worked').toBe(false);

        // And the offline check agrees with what was written.
        const check = spawnSync(process.execPath, [at('scripts', 'fetch-portraits.js'), '--check'], { cwd: tmp, encoding: 'utf8' });
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// --- SHRINKING (owner, 2026-11-17; the performance card) ---
//
// Two uploads were full-size PNGs named .webp (Head of the Hei 1.5MB, Hired
// Killer 1MB), and the tier tools load every portrait: 3.5MB. The mirror
// re-encodes a portrait that is not really a WebP, or is over 200KB, as a WebP
// at most 512px, in the Chromium Playwright already installs. Real images here,
// made in the test's own browser, through the real script.

// Makes an image in the browser: a gradient, or noise (which compresses badly,
// so a WebP of it is big).
async function makeImage(page, { width, height, type, quality = 0.9, noise = false }) {
    const b64 = await page.evaluate(async ({ width, height, type, quality, noise }) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (noise) {
            const img = ctx.createImageData(width, height);
            for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
            ctx.putImageData(img, 0, 0);
        } else {
            const g = ctx.createLinearGradient(0, 0, width, height);
            g.addColorStop(0, '#ff8080'); g.addColorStop(1, '#2040a0');
            ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
        }
        const blob = await canvas.convertToBlob({ type, quality });
        const view = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
        return btoa(s);
    }, { width, height, type, quality, noise });
    return Buffer.from(b64, 'base64');
}

const isWebp = (buf) => buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';

async function sizeOf(page, buf) {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes]));
        return { width: bmp.width, height: bmp.height };
    }, buf.toString('base64'));
}

test('a portrait that is not really a WebP, or is too big, is mirrored as a small WebP, and nothing else is touched', async ({ page }) => {
    test.setTimeout(120000);
    const os = require('os');
    const { spawnSync } = require('child_process');

    const fixtures = {
        // The 2026-11 case: a full-size PNG whose name says .webp.
        named_webp: { url: 'HeadHeiPortrait.webp', bytes: await makeImage(page, { width: 1200, height: 900, type: 'image/png' }) },
        // A PNG that says so.
        png: { url: 'SomePortrait.png', bytes: await makeImage(page, { width: 800, height: 1000, type: 'image/png' }) },
        // Every other portrait today: a real WebP, small.
        small: { url: 'SmallPortrait.webp', bytes: await makeImage(page, { width: 300, height: 300, type: 'image/webp' }) },
        // A real WebP that is still too big.
        big_webp: { url: 'BigPortrait.webp', bytes: await makeImage(page, { width: 900, height: 900, type: 'image/webp', quality: 1, noise: true }) },
        // Not an image at all: cannot be shrunk, so it is kept and warned about.
        broken: { url: 'Broken.png', bytes: Buffer.from('this is not an image') },
    };
    expect(isWebp(fixtures.named_webp.bytes), 'the fixture is a PNG').toBe(false);
    expect(isWebp(fixtures.small.bytes)).toBe(true);
    expect(fixtures.small.bytes.length).toBeLessThan(200 * 1024);
    expect(fixtures.big_webp.bytes.length, 'the big WebP really is over the limit').toBeGreaterThan(200 * 1024);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-shrink-'));
    try {
        const at = (...p) => path.join(tmp, ...p);
        for (const dir of ['scripts', 'data', 'medias/portraits', 'served']) fs.mkdirSync(at(dir), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'scripts', 'fetch-portraits.js'), at('scripts', 'fetch-portraits.js'));
        // Its shrinker is a module of its own since v1.2, shared with fetch-banners.js.
        fs.copyFileSync(path.join(ROOT, 'scripts', 'shrink-to-webp.js'), at('scripts', 'shrink-to-webp.js'));

        const STORE = 'https://example.supabase.co/storage/v1/object/public/wiki-media';
        const previews = {};
        const served = {};
        for (const [id, { url, bytes }] of Object.entries(fixtures)) {
            previews[id] = `${STORE}/${url}`;
            fs.writeFileSync(at('served', url), bytes);
            served[`${STORE}/${url}`] = at('served', url);
        }
        fs.writeFileSync(at('data', 'page-previews.json'), JSON.stringify(previews));
        fs.writeFileSync(at('fake-network.js'), `
            const served = ${JSON.stringify(served)};
            globalThis.fetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => {
                const b = require('fs').readFileSync(served[url]);
                return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            } });`);

        // The copy lives outside the repo, so it is told where playwright is.
        const env = { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') };
        const run = () => spawnSync(process.execPath, ['--require', at('fake-network.js'), at('scripts', 'fetch-portraits.js'), '--write'],
            { cwd: tmp, encoding: 'utf8', env, timeout: 90000 });

        const first = run();
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);

        const manifest = JSON.parse(fs.readFileSync(at('data', 'portraits.json'), 'utf8'));
        expect(manifest).toEqual({
            big_webp: 'medias/portraits/big_webp.webp',
            broken: 'medias/portraits/broken.png',
            named_webp: 'medias/portraits/named_webp.webp',
            png: 'medias/portraits/png.webp',
            small: 'medias/portraits/small.webp',
        });
        const file = (rel) => fs.readFileSync(at(rel));

        // Shrunk: a real WebP, no side over 512, the shape kept, far smaller.
        for (const [id, expected] of [['named_webp', { width: 512, height: 384 }], ['png', { width: 410, height: 512 }], ['big_webp', { width: 512, height: 512 }]]) {
            const out = file(manifest[id]);
            expect(isWebp(out), `${id} is a real WebP`).toBe(true);
            expect(await sizeOf(page, out), `${id} at most 512px, same shape`).toEqual(expected);
            expect(out.length, `${id} is smaller than what was uploaded`).toBeLessThan(fixtures[id].bytes.length);
        }
        // Untouched: a small real WebP, byte for byte.
        expect(Buffer.compare(file(manifest.small), fixtures.small.bytes)).toBe(0);
        // Could not be shrunk: kept as downloaded, and said so on the run.
        expect(Buffer.compare(file(manifest.broken), fixtures.broken.bytes)).toBe(0);
        const warnings = first.stdout.split('\n').filter(l => l.startsWith('::warning'));
        expect(warnings.filter(l => l.includes('Portrait not shrunk')).map(l => l.split('::')[2].split(':')[0])).toEqual(['broken']);
        expect(warnings.filter(l => l.includes('Portrait not mirrored'))).toEqual([]);
        expect(first.stdout).toContain('3 shrunk');

        // The next night changes nothing: the same picture shrinks to the same
        // bytes, so the job has nothing to commit.
        const second = run();
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
        expect(second.stdout).toContain('0 changed');

        const check = spawnSync(process.execPath, [at('scripts', 'fetch-portraits.js'), '--check'], { cwd: tmp, encoding: 'utf8' });
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('the regeneration job installs the browser before it mirrors portraits', () => {
    // The mirror shrinks in that browser since v1.2. Installed only before the
    // content checks, as it was, the first oversized portrait would have been
    // kept full size every night, with a warning nobody asked for.
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'regenerate.yml'), 'utf8');
    const install = yml.indexOf('run: npx playwright install --with-deps chromium');
    const mirror = yml.indexOf('run: node scripts/fetch-portraits.js --write');
    expect(install).toBeGreaterThan(-1);
    expect(mirror).toBeGreaterThan(-1);
    expect(install).toBeLessThan(mirror);
});
