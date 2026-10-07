// Messages copied in from the Discord forum, as a character thread shows them
// (v1.0 batch 1). Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 1".
//
// CAN: how a row with source = 'discord' is drawn: the DISCORD chip and the
// @handle beside a plain name, no profile to open and no Delete, the
// "removed on Discord" placeholder, the edited note, and pictures from the
// discord-media bucket only when their path is one the relay makes.
//
// CANNOT: that such rows exist. The relay writes them as the service role
// through 20261004000000_discord_relay.sql, which is probed on the preview
// branch; tests/discord-relay-tick.spec.js covers the relay itself.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const LOCAL_IMAGE = fs.readFileSync(path.join(__dirname, '..', 'medias', 'images', 'DogslamloopIcon.webp'));

const row = (over = {}) => ({
    id: 'p1', page_id: 'honored_one', parent_id: null,
    author_id: OTHER, author_name: 'mango_kun', body: 'look', images: [],
    source: 'site', discord_author_id: null, discord_author_handle: null, edited_at: null,
    status: 'visible', created_at: '2026-10-04T10:00:00Z', removed_at: null, removed_by: null,
    ...over,
});
const fromDiscord = (over = {}) => row({
    author_id: null, author_name: 'Kai', source: 'discord',
    discord_author_id: '200000000000000001', discord_author_handle: 'kai', ...over,
});

async function openThread(page, { rows = [], session = null } = {}) {
    await page.route(/\/storage\/v1\/object\/public\/(discussion|discord)-media\//, r =>
        r.fulfill({ status: 200, contentType: 'image/webp', body: LOCAL_IMAGE }));

    await page.addInitScript(({ rows, session }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({ data: { session } });
                    client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
                    client.rpc = async (name) => ({ data: name === 'get_public_profiles' || name === 'get_page_experts' ? [] : 'ok', error: null });
                    client.from = (table) => {
                        if (table === 'page_discussions') {
                            const q = { top: false, parents: null, head: false };
                            return {
                                select(_c, o) { if (o && o.head) q.head = true; return this; },
                                eq() { return this; },
                                is(c, v) { if (c === 'parent_id' && v === null) q.top = true; return this; },
                                in(c, v) { if (c === 'parent_id') q.parents = v; return this; },
                                order() { return this; },
                                range() { return this; },
                                then(resolve) {
                                    if (q.head) return resolve({ data: null, count: rows.length, error: null });
                                    const out = q.parents ? rows.filter(r => q.parents.includes(r.parent_id))
                                        : q.top ? rows.filter(r => r.parent_id === null) : rows;
                                    return resolve({ data: out, error: null });
                                },
                            };
                        }
                        const inert = new Proxy({}, { get(_t, prop) {
                            if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        } });
                        return inert;
                    };
                    return client;
                };
            },
        });
    }, { rows, session });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title', { timeout: 30000 });
}

test('a Discord message shows its name, the DISCORD chip and the handle, with no profile to open', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { rows: [fromDiscord(), row({ id: 'p2', body: 'a wiki post' })], session: SESSION });

    const author = page.locator('#post-p1 .discussion-post-head .discussion-author');
    await expect(author).toHaveText('KaiDISCORD@kai');
    await expect(author.locator('.discussion-discord')).toHaveText('DISCORD');
    await expect(author.locator('.discussion-handle')).toHaveText('@kai');
    // Plain text: nothing to click through to.
    expect(await author.evaluate(el => el.tagName)).toBe('SPAN');
    await expect(page.locator('#post-p1 [data-profile-user]')).toHaveCount(0);
    // Not the signed-in reader's post, and nobody's on the wiki: no Delete.
    await expect(page.locator('#post-p1 [data-remove-post]')).toHaveCount(0);
    await expect(page.locator('#post-p1 [data-reply-to="p1"]')).toHaveCount(1);

    // A wiki post beside it is unchanged: a profile button, no chip.
    await expect(page.locator('#post-p2 button[data-profile-user]')).toHaveCount(1);
    await expect(page.locator('#post-p2 .discussion-discord')).toHaveCount(0);

    // The chip is painted, not merely present.
    const paint = await author.locator('.discussion-discord').evaluate(el => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor];
    });
    expect(paint).toEqual(['rgb(255, 255, 255)', 'rgb(88, 101, 242)']);
    expect(errors).toEqual([]);
});

test('a name and handle typed on Discord are shown as text, never as markup', async ({ page }) => {
    await openThread(page, { rows: [fromDiscord({
        author_name: '<img src=x onerror="window.__xss=1">',
        discord_author_handle: '<b>h</b>',
    })] });
    const author = page.locator('#post-p1 .discussion-author');
    await expect(author).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(author.locator('.discussion-handle')).toHaveText('@<b>h</b>');
    await expect(author.locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('a reply from Discord sits under its post with the chip', async ({ page }) => {
    await openThread(page, { rows: [row(), fromDiscord({ id: 'r1', parent_id: 'p1', body: 'agreed' })] });
    const reply = page.locator('#post-p1 .discussion-replies #post-r1');
    await expect(reply.locator('.discussion-discord')).toHaveText('DISCORD');
    await expect(reply.locator('.discussion-body')).toHaveText('agreed');
});

test('a message deleted on Discord leaves a placeholder that says so, and nothing else', async ({ page }) => {
    await openThread(page, { rows: [fromDiscord({ status: 'removed_on_discord', body: '', images: [] })] });
    const post = page.locator('#post-p1');
    await expect(post.locator('.discussion-body')).toHaveText('[removed on Discord]');
    await expect(post.locator('.discussion-author')).toHaveText('—');
    await expect(post.locator('.discussion-discord, .discussion-handle, .discussion-media')).toHaveCount(0);
});

test('an edit made on Discord is marked', async ({ page }) => {
    await openThread(page, { rows: [fromDiscord({ edited_at: '2026-10-04T10:05:00Z' }), fromDiscord({ id: 'p2' })] });
    await expect(page.locator('#post-p1 .discussion-edited')).toHaveText('edited on Discord');
    await expect(page.locator('#post-p2 .discussion-edited')).toHaveCount(0);
});

test('a copied picture is drawn from discord-media, and only from a path the relay makes', async ({ page }) => {
    await openThread(page, { rows: [fromDiscord({
        images: [
            'discord/123456789012345678-0.png',
            // None of these is a path the relay writes.
            'discord/123456789012345678-7.png',
            'discord/../../wiki-media/x.png',
            'https://evil.example/x.png',
        ],
    })] });
    const imgs = page.locator('#post-p1 .discussion-media-img');
    await expect(imgs).toHaveCount(1);
    const src = await imgs.first().getAttribute('src');
    expect(src).toMatch(/\/storage\/v1\/object\/public\/discord-media\/discord\/123456789012345678-0\.png$/);
    expect(await imgs.first().evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
});

test('on a phone, a long Discord name, chip and handle never push the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openThread(page, { rows: [fromDiscord({
        author_name: 'AnExtremelyLongDiscordDisplayNameWithNoSpaces',
        discord_author_handle: 'an_equally_long_handle_thirty2',
    })] });
    await expect(page.locator('#post-p1 .discussion-discord')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
