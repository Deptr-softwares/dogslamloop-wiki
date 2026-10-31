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

        fs.writeFileSync(at('fake-network.js'), `
            globalThis.fetch = async (url) => {
                if (url.includes('flaky')) throw new Error('socket hang up');
                return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('new ' + url).buffer };
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
        expect(file('fine.webp')).toBe(`new ${STORE}/fine.webp`);
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
