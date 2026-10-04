// One whole run of the Discord relay (v1.0 batch 1), against a fake Discord
// and a fake database.
//
// supabase/functions/_shared/discord-relay-tick.mjs is what Supabase Cron runs
// every 10 seconds. Discord and the database are passed in, so this runs it in
// Node. The fake Discord answers like the real one where the relay depends on
// it (a forum post's opening message shares the post's id; `after` reads
// return what follows; 429 means slow down). The fake database keeps the
// contract of each SQL function in 20261004000000_discord_relay.sql, not its
// SQL: what the functions do in Postgres is probed on the preview branch.
//
// Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 1".
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const TICK = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'discord-relay-tick.mjs')).href;

let runTick;
test.beforeAll(async () => { ({ runTick } = await import(TICK)); });

const EPOCH = 1420070400000n;
const T0 = Date.parse('2026-10-04T12:00:00Z');
const GUILD = '100000000000000001';
const CHANNEL = '100000000000000002';
const WEBHOOK_ID = '100000000000000003';
const WEBHOOK = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${'t'.repeat(68)}`;
const FORUM = '100000000000000004';
const FORUM_WEBHOOK_ID = '100000000000000005';
const FORUM_WEBHOOK = `https://discord.com/api/webhooks/${FORUM_WEBHOOK_ID}/${'f'.repeat(68)}`;
const ENV = {
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_GUILD_ID: GUILD,
    DISCORD_CHARACTER_CHANNEL_ID: CHANNEL,
    DISCORD_CHARACTER_WEBHOOK_URL: WEBHOOK,
    SUPABASE_URL: 'https://project.supabase.co',
};
const FORUM_ENV = { ...ENV, DISCORD_FORUM_CHANNEL_ID: FORUM, DISCORD_FORUM_WEBHOOK_URL: FORUM_WEBHOOK };
const HOOKS = [
    { url: WEBHOOK, id: WEBHOOK_ID, channel: CHANNEL },
    { url: FORUM_WEBHOOK, id: FORUM_WEBHOOK_ID, channel: FORUM },
];

function world() {
    let seq = 0;
    let clock = T0;
    const flake = () => (((BigInt(clock) - EPOCH) << 22n) + BigInt(++seq)).toString();

    const discord = {
        threads: [],          // { id, name, parent_id, archived, last_message_id }
        messages: new Map(),  // thread id -> [message]
        banned: new Set(),
        members: new Map(),
        rateLimitWebhook: false,
        // The forum channel's tags, as Discord lists them.
        forumTags: [],
        // Posts deleted on Discord: reading them answers Unknown Channel.
        deleted: new Set(),
        calls: [],
    };
    const db = {
        lease: false,
        sweepDue: true,
        missing: [],          // what discord_relay_missing_threads answers
        links: new Map(),     // site_key -> { site_key, channel, discord_thread_id, last_message_id, linked_at }
        outbox: [],
        records: [],
        taken: [],
        viewers: new Set(),   // discord ids of linked wiki accounts under the soft ban
        recent: [],
        gone: [],
        edits: [],
        uploads: new Map(),
        removed: [],
        calls: [],
        released: 0,
        forumSince: new Date(T0).toISOString(),
        forumOutbox: [],
        forumLinks: [],
        lockedSet: [],
        forumTaken: [],
        renames: [],
        threadsGone: [],
    };

    function post(threadId, msg) {
        const list = discord.messages.get(threadId) || [];
        list.push(msg);
        discord.messages.set(threadId, list);
        const t = discord.threads.find(x => x.id === threadId);
        if (t) { t.last_message_id = msg.id; t.archived = false; }
        return msg;
    }

    const json = (status, body) => ({
        status, ok: status >= 200 && status < 300,
        json: async () => body, text: async () => JSON.stringify(body || ''),
        arrayBuffer: async () => new ArrayBuffer(0),
    });

    async function fetchFake(url, init = {}) {
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(init.body) : null;
        discord.calls.push({ method, url, body, headers: init.headers || {} });
        const u = new URL(url);
        const p = u.pathname;

        if (u.host === 'cdn.discordapp.com') {
            return { status: 200, ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        }
        const hook = HOOKS.find(h => url.startsWith(h.url));
        if (hook) {
            if (discord.rateLimitWebhook) return json(429, { retry_after: 1 });
            const rest = p.slice(new URL(hook.url).pathname.length);
            if (method === 'POST') {
                const author = { id: hook.id, username: body.username, bot: true };
                if (body.thread_name) {
                    const id = flake();
                    discord.threads.push({ id, name: body.thread_name, parent_id: hook.channel, archived: false, last_message_id: id, applied_tags: body.applied_tags || [] });
                    return json(200, post(id, { id, channel_id: id, type: 0, webhook_id: hook.id, author, content: body.content }));
                }
                const threadId = u.searchParams.get('thread_id');
                if (discord.deleted.has(threadId)) return json(404, { code: 10003, message: 'Unknown Channel' });
                const msg = { id: flake(), channel_id: threadId, type: 0, webhook_id: hook.id, author, content: body.content };
                return json(200, post(threadId, msg));
            }
            if (method === 'DELETE') {
                const id = rest.split('/').pop();
                const list = discord.messages.get(u.searchParams.get('thread_id')) || [];
                discord.messages.set(u.searchParams.get('thread_id'), list.filter(m => m.id !== id));
                return json(204, null);
            }
        }
        if (p === `/api/v10/guilds/${GUILD}/threads/active`) {
            return json(200, { threads: discord.threads.filter(t => !t.archived) });
        }
        if (p === `/api/v10/channels/${CHANNEL}/threads/archived/public`) {
            return json(200, { threads: discord.threads.filter(t => t.archived) });
        }
        if (p === `/api/v10/channels/${FORUM}` && method === 'GET') {
            return json(200, { id: FORUM, type: 15, available_tags: discord.forumTags });
        }
        let m = /^\/api\/v10\/channels\/(\d+)/.exec(p);
        if (m && discord.deleted.has(m[1])) return json(404, { code: 10003, message: 'Unknown Channel' });
        m = /^\/api\/v10\/channels\/(\d+)$/.exec(p);
        if (m && method === 'PATCH') {
            const t = discord.threads.find(x => x.id === m[1]);
            if (t) Object.assign(t, body);
            return json(200, t || {});
        }
        m = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(p);
        if (m && method === 'GET') {
            const after = BigInt(u.searchParams.get('after'));
            const limit = Number(u.searchParams.get('limit'));
            const list = (discord.messages.get(m[1]) || [])
                .filter(x => BigInt(x.id) > after)
                .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
                .slice(0, limit)
                .reverse();   // Discord answers newest first
            return json(200, list);
        }
        m = /^\/api\/v10\/channels\/(\d+)\/messages\/(\d+)$/.exec(p);
        if (m && method === 'GET') {
            const found = (discord.messages.get(m[1]) || []).find(x => x.id === m[2]);
            return found ? json(200, found) : json(404, { code: 10008, message: 'Unknown Message' });
        }
        if (m && method === 'DELETE') {
            discord.messages.set(m[1], (discord.messages.get(m[1]) || []).filter(x => x.id !== m[2]));
            return json(204, null);
        }
        m = /^\/api\/v10\/guilds\/\d+\/bans\/(\d+)$/.exec(p);
        if (m) return discord.banned.has(m[1]) ? json(200, { user: { id: m[1] } }) : json(404, { message: 'Unknown Ban' });
        m = /^\/api\/v10\/guilds\/\d+\/members\/(\d+)$/.exec(p);
        if (m) return discord.members.has(m[1]) ? json(200, discord.members.get(m[1])) : json(404, { message: 'Unknown Member' });
        throw new Error(`fake Discord has no route for ${method} ${url}`);
    }

    const rpcs = {
        discord_relay_claim() {
            if (db.lease) return { claimed: false, sweep: false };
            db.lease = true;
            const sweep = db.sweepDue;
            db.sweepDue = false;
            return { claimed: true, sweep };
        },
        discord_relay_release() { db.lease = false; db.released++; return null; },
        discord_relay_missing_threads() { return db.missing.filter(p => !db.links.has(p.page_id)); },
        discord_relay_link_thread(a) {
            if (db.links.has(a.p_site_key)) return false;
            db.links.set(a.p_site_key, {
                site_key: a.p_site_key, channel: a.p_channel, discord_thread_id: a.p_discord_thread_id,
                last_message_id: a.p_last_message_id, linked_at: new Date(clock).toISOString(),
            });
            return true;
        },
        discord_relay_threads() { return [...db.links.values()]; },
        discord_relay_advance(a) {
            for (const l of db.links.values()) {
                if (l.discord_thread_id === a.p_discord_thread_id && BigInt(a.p_last_message_id) > BigInt(l.last_message_id || 0)) {
                    l.last_message_id = a.p_last_message_id;
                }
            }
            return null;
        },
        discord_relay_outbox() { const out = db.outbox; db.outbox = []; return out; },
        discord_relay_record(a) { db.records.push(a); return null; },
        discord_relay_take(a) {
            if (db.viewers.has(a.p_author_discord_id)) return null;
            db.taken.push(a);
            return `post-${db.taken.length}`;
        },
        discord_relay_recent() { return db.recent; },
        discord_relay_gone(a) {
            db.gone.push(a.p_discord_message_id);
            return ['discord/123456789012345678-0.png', '00000000-0000-0000-0000-000000000000/own.webp'];
        },
        discord_relay_edit(a) { db.edits.push(a); return null; },
        discord_relay_forum_since() { return db.forumSince; },
        discord_relay_forum_outbox() { const out = db.forumOutbox; db.forumOutbox = []; return out; },
        discord_relay_link_forum(a) {
            db.forumLinks.push(a);
            db.links.set(`forum:${a.p_thread_id}`, {
                site_key: `forum:${a.p_thread_id}`, channel: 'forum', discord_thread_id: a.p_discord_thread_id,
                last_message_id: a.p_last_message_id, linked_at: new Date(clock).toISOString(),
            });
            return true;
        },
        discord_relay_set_locked(a) { db.lockedSet.push(a); return null; },
        discord_relay_take_forum(a) {
            if (db.viewers.has(a.p_author_discord_id)) return null;
            db.forumTaken.push(a);
            const key = `forum:00000000-0000-4000-8000-${String(db.forumTaken.length).padStart(12, '0')}`;
            db.links.set(key, { site_key: key, channel: 'forum', discord_thread_id: a.p_discord_thread_id, last_message_id: a.p_discord_thread_id, linked_at: new Date(T0).toISOString() });
            return key.slice(6);
        },
        discord_relay_forum_rename(a) { db.renames.push(a); return null; },
        discord_relay_thread_gone(a) {
            db.threadsGone.push(a.p_discord_thread_id);
            for (const [k, l] of db.links) if (l.discord_thread_id === a.p_discord_thread_id) db.links.delete(k);
            return ['discord/123456789012345678-1.png'];
        },
    };

    const client = {
        async rpc(name, args) {
            db.calls.push(name);
            if (!rpcs[name]) return { data: null, error: { message: `no fake for ${name}` } };
            return { data: rpcs[name](args || {}), error: null };
        },
        storage: {
            from(bucket) {
                return {
                    async upload(p, bytes, opts) { db.uploads.set(`${bucket}/${p}`, opts); return { error: null }; },
                    async remove(paths) { db.removed.push(...paths.map(x => `${bucket}/${x}`)); return { error: null }; },
                };
            },
        },
    };

    // A character thread already linked, as after its first sweep.
    function linkedThread(name = 'Boomcat', pageId = 'boomcat') {
        const id = flake();
        discord.threads.push({ id, name, parent_id: CHANNEL, archived: false, last_message_id: id });
        discord.messages.set(id, [{ id, type: 0, webhook_id: WEBHOOK_ID, author: { id: WEBHOOK_ID, bot: true }, content: 'opening' }]);
        db.links.set(pageId, { site_key: pageId, channel: 'character', discord_thread_id: id, last_message_id: id, linked_at: new Date(clock).toISOString() });
        db.sweepDue = false;
        return id;
    }

    function say(threadId, extra = {}) {
        clock += 1000;
        return post(threadId, {
            id: flake(), type: 0, content: 'hi',
            author: { id: '200000000000000001', username: 'kai', global_name: 'Kai', discriminator: '0' },
            attachments: [], embeds: [], mentions: [], ...extra,
        });
    }

    // A forum post on Discord: a thread in the forum channel whose starter
    // message shares its id.
    function forumPost(name, starter = {}, extra = {}) {
        clock += 1000;
        const id = flake();
        discord.threads.push({ id, name, parent_id: FORUM, archived: false, last_message_id: id, applied_tags: [], ...extra });
        post(id, {
            id, channel_id: id, type: 0, content: 'opening words',
            author: { id: '200000000000000002', username: 'mo', global_name: 'Mo', discriminator: '0' },
            attachments: [], embeds: [], mentions: [], ...starter,
        });
        return id;
    }

    const tick = (env = ENV) => runTick({ env, db: client, fetch: fetchFake, now: () => clock });
    return { discord, db, tick, linkedThread, say, forumPost, flake, advance: (ms) => { clock += ms; } };
}

test('without its secrets the relay does nothing at all', async () => {
    const w = world();
    expect(await w.tick({ ...ENV, DISCORD_BOT_TOKEN: '' })).toEqual({ relay: 'off' });
    expect(await w.tick({ ...ENV, DISCORD_CHARACTER_WEBHOOK_URL: 'https://evil.example/hook' })).toEqual({ relay: 'off' });
    expect(w.db.calls).toEqual([]);
    expect(w.discord.calls).toEqual([]);
});

test('a tick that finds another one running leaves', async () => {
    const w = world();
    w.db.lease = true;
    expect(await w.tick()).toEqual({ relay: 'busy' });
    expect(w.discord.calls).toEqual([]);
    expect(w.db.lease).toBe(true);
});

test('each character gets one post: an existing one of the same name is linked, the rest opened', async () => {
    const w = world();
    const existing = w.flake();
    w.discord.threads.push({ id: existing, name: 'boomcat', parent_id: CHANNEL, archived: true, last_message_id: existing });
    // A post of the same name in ANOTHER channel is not this character's.
    w.discord.threads.push({ id: w.flake(), name: 'Vessel', parent_id: '999999999999999999', archived: false, last_message_id: '1' });
    w.db.missing = [
        { page_id: 'boomcat', name: 'Boomcat', url: 'characters/Boomcat/' },
        { page_id: 'vessel', name: 'Vessel', url: 'characters/Vessel/' },
    ];

    const report = await w.tick();
    expect(report).toMatchObject({ relay: 'ran', sweep: true, linked: 1, opened: 1, errors: [] });
    expect(w.db.links.get('boomcat').discord_thread_id).toBe(existing);

    const opens = w.discord.calls.filter(c => c.method === 'POST');
    expect(opens).toHaveLength(1);
    expect(opens[0].body).toMatchObject({ thread_name: 'Vessel', allowed_mentions: { parse: [] } });
    // A forum post's opening message shares the post's id; that is the cursor.
    const vessel = w.db.links.get('vessel');
    expect(vessel.last_message_id).toBe(vessel.discord_thread_id);
    expect(w.db.lease).toBe(false);
});

test('a member\'s Discord message is copied in, with its picture; the relay\'s own and system messages are not', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.say(thread, { webhook_id: WEBHOOK_ID, content: 'a wiki post, copied out earlier' });
    w.say(thread, { type: 18, content: '' });
    const msg = w.say(thread, {
        content: 'nice <@300000000000000001>',
        mentions: [{ id: '300000000000000001', username: 'mo', global_name: 'Mo' }],
        attachments: [
            { filename: 'combo.png', content_type: 'image/png', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/2/combo.png' },
            { filename: 'clip.mp4', content_type: 'video/mp4', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/2/clip.mp4' },
        ],
    });

    const report = await w.tick();
    expect(report).toMatchObject({ taken: 1, errors: [] });
    expect(w.db.taken).toEqual([{
        p_discord_thread_id: thread,
        p_discord_message_id: msg.id,
        p_author_discord_id: '200000000000000001',
        p_author_name: 'Kai',
        p_author_handle: 'kai',
        p_body: 'nice @Mo\n[file left on Discord: clip.mp4]',
        p_images: [`discord/${msg.id}-0.png`],
        p_reply_to_discord_id: null,
    }]);
    expect(w.db.uploads.get(`discord-media/discord/${msg.id}-0.png`)).toMatchObject({ contentType: 'image/png' });
    // The cursor moves past everything read, copied or not.
    expect(w.db.links.get('boomcat').last_message_id).toBe(msg.id);

    // Read once: a second tick finds nothing new and asks Discord for no messages.
    w.discord.calls.length = 0;
    await w.tick();
    expect(w.discord.calls.filter(c => c.url.includes('/messages'))).toEqual([]);
    expect(w.db.taken).toHaveLength(1);
});

test('nothing from before a post was linked is copied', async () => {
    const w = world();
    const thread = w.linkedThread();
    const link = w.db.links.get('boomcat');
    // Linked an hour after the message was written.
    const old = w.say(thread, { content: 'from before' });
    link.linked_at = new Date(Date.parse(link.linked_at) + 3600 * 1000).toISOString();

    await w.tick();
    expect(w.db.taken).toEqual([]);
    expect(link.last_message_id).toBe(old.id);
});

test('a message that fails to copy is tried again, never stepped over', async () => {
    const w = world();
    const thread = w.linkedThread();
    const first = w.say(thread, { content: 'one' });
    w.say(thread, { content: 'two' });
    const startCursor = w.db.links.get('boomcat').last_message_id;

    const realTake = w.db.taken.push.bind(w.db.taken);
    let failOnce = true;
    w.db.taken.push = (a) => {
        if (failOnce) { failOnce = false; throw new Error('database away'); }
        return realTake(a);
    };

    const report = await w.tick();
    expect(report.errors.join(' ')).toContain('database away');
    expect(w.db.links.get('boomcat').last_message_id).toBe(startCursor);

    await w.tick();
    expect(w.db.taken.map(t => t.p_body)).toEqual(['one', 'two']);
    expect(w.db.taken[0].p_discord_message_id).toBe(first.id);
});

test('a wiki post goes out under its writer\'s name, pinging nobody, and is recorded', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.db.outbox = [{
        action: 'send', post_id: 'p1', page_id: 'boomcat', page_url: 'characters/Boomcat/', parent_id: null,
        body: '@everyone Boomcat is busted', images: ['00000000-0000-0000-0000-000000000000/a.webp'],
        author_name: 'Real Deptr', author_discord_id: null, parent_author_name: null, parent_body: null,
        channel: 'character', discord_thread_id: thread, discord_message_id: null, attempts: 0,
    }];

    const report = await w.tick();
    expect(report).toMatchObject({ sent: 1, errors: [] });
    const send = w.discord.calls.find(c => c.method === 'POST' && c.url.startsWith(WEBHOOK));
    expect(new URL(send.url).searchParams.get('thread_id')).toBe(thread);
    expect(new URL(send.url).searchParams.get('wait')).toBe('true');
    expect(send.headers.Authorization).toBeUndefined();
    expect(send.body).toEqual({
        content: '@everyone Boomcat is busted\nhttps://project.supabase.co/storage/v1/object/public/discussion-media/00000000-0000-0000-0000-000000000000/a.webp',
        username: 'Real Deptr',
        allowed_mentions: { parse: [] },
    });

    // Claimed before the send, then recorded with the id Discord gave it.
    const sent = w.discord.messages.get(thread).at(-1);
    expect(w.db.records.map(r => [r.p_post_id, r.p_state, r.p_discord_message_id])).toEqual([
        ['p1', 'sending', null],
        ['p1', 'sent', sent.id],
    ]);
});

test('a linked account banned or timed out on the server is never posted there', async () => {
    const w = world();
    const thread = w.linkedThread();
    const item = (id, discordId) => ({
        action: 'send', post_id: id, page_id: 'boomcat', page_url: 'characters/Boomcat/', parent_id: null,
        body: 'hello', images: [], author_name: id, author_discord_id: discordId,
        parent_author_name: null, parent_body: null, channel: 'character', discord_thread_id: thread, attempts: 0,
    });
    w.discord.banned.add('400000000000000001');
    w.discord.members.set('400000000000000002', { communication_disabled_until: new Date(T0 + 86400000).toISOString() });
    w.discord.members.set('400000000000000003', { communication_disabled_until: new Date(T0 - 86400000).toISOString() });
    w.db.outbox = [
        item('banned', '400000000000000001'),
        item('timed-out', '400000000000000002'),
        item('timeout-over', '400000000000000003'),
        item('not-a-member', '400000000000000004'),
    ];

    const report = await w.tick();
    expect(report).toMatchObject({ sent: 2, skipped: 2, errors: [] });
    const final = Object.fromEntries(w.db.records.map(r => [r.p_post_id, r.p_state]));
    expect(final).toEqual({ banned: 'skipped', 'timed-out': 'skipped', 'timeout-over': 'sent', 'not-a-member': 'sent' });
});

test('a ban that cannot be checked holds the post back, to be tried again', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.db.outbox = [{
        action: 'send', post_id: 'p1', page_id: 'boomcat', page_url: 'u/', parent_id: null, body: 'x', images: [],
        author_name: 'A', author_discord_id: '500000000000000001', parent_author_name: null, parent_body: null,
        channel: 'character', discord_thread_id: thread, attempts: 0,
    }];
    // Without View Audit Log, Discord answers 403 to "Get Guild Ban".
    const realBan = w.discord.banned.has.bind(w.discord.banned);
    w.discord.banned.has = () => { throw new Error('403 Missing Permissions'); };

    const report = await w.tick().catch(e => ({ thrown: e.message }));
    w.discord.banned.has = realBan;
    expect(report.thrown).toBeUndefined();
    expect(w.db.records.map(r => r.p_state)).toEqual(['failed']);
    expect(w.discord.calls.some(c => c.method === 'POST')).toBe(false);
});

test('a reply opens with a quote of what it answers', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.db.outbox = [{
        action: 'send', post_id: 'r1', page_id: 'boomcat', page_url: 'characters/Boomcat/', parent_id: 'p0',
        body: 'agreed', images: [], author_name: 'Kai', author_discord_id: null,
        parent_author_name: 'Mo', parent_body: 'Boomcat wins this', channel: 'character', discord_thread_id: thread, attempts: 0,
    }];
    await w.tick();
    const send = w.discord.calls.find(c => c.method === 'POST');
    expect(send.body.content).toBe('> **Mo**: Boomcat wins this\nagreed');
});

test('a wiki post taken down comes off Discord; a removed Discord message is deleted at its source', async () => {
    const w = world();
    const thread = w.linkedThread();
    const copy = w.say(thread, { webhook_id: WEBHOOK_ID, content: 'wiki words' });
    const original = w.say(thread, { content: 'discord words' });
    w.db.outbox = [
        { action: 'delete', post_id: 'p1', channel: 'character', discord_thread_id: thread, discord_message_id: copy.id },
        { action: 'delete_original', post_id: 'p2', channel: 'character', discord_thread_id: thread, discord_message_id: original.id },
    ];
    // Read past both first, so this tick is only about the deletions.
    w.db.links.get('boomcat').last_message_id = original.id;

    const report = await w.tick();
    expect(report).toMatchObject({ deleted: 2, errors: [] });
    const deletes = w.discord.calls.filter(c => c.method === 'DELETE');
    // The copy through its own webhook; the original with the bot's token.
    expect(deletes[0].url).toBe(`${WEBHOOK}/messages/${copy.id}?thread_id=${thread}`);
    expect(deletes[1].url).toBe(`https://discord.com/api/v10/channels/${thread}/messages/${original.id}`);
    expect(deletes[1].headers.Authorization).toBe('Bot bot-token');
    expect(w.discord.messages.get(thread).map(m => m.content)).toEqual(['opening']);
    expect(w.db.records.map(r => [r.p_post_id, r.p_direction, r.p_state])).toEqual([
        ['p1', 'to_discord', 'deleted'],
        ['p2', 'from_discord', 'deleted'],
    ]);
});

test('the sweep finds what was deleted and edited on Discord', async () => {
    const w = world();
    const thread = w.linkedThread();
    const kept = w.say(thread, { content: 'kept' });
    const edited = w.say(thread, { content: 'after the edit', edited_timestamp: new Date(T0).toISOString() });
    const deletedId = w.flake();   // copied once, now gone from the thread
    w.db.links.get('boomcat').last_message_id = edited.id;
    w.db.recent = [
        { post_id: 'a', direction: 'from_discord', discord_thread_id: thread, discord_message_id: kept.id, body: 'kept' },
        { post_id: 'b', direction: 'from_discord', discord_thread_id: thread, discord_message_id: edited.id, body: 'before the edit' },
        { post_id: 'c', direction: 'from_discord', discord_thread_id: thread, discord_message_id: deletedId, body: 'bye' },
    ];
    w.db.sweepDue = true;

    const report = await w.tick();
    expect(report).toMatchObject({ sweep: true, gone: 1, edited: 1, errors: [] });
    expect(w.db.gone).toEqual([deletedId]);
    expect(w.db.edits).toEqual([{ p_discord_message_id: edited.id, p_body: 'after the edit' }]);
    // Only the relay's own copies are removed from Storage.
    expect(w.db.removed).toEqual(['discord-media/discord/123456789012345678-0.png']);
});

test('when Discord says slow down, the tick stops, says so, and lets go of the lease', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.discord.rateLimitWebhook = true;
    const item = (id) => ({
        action: 'send', post_id: id, page_id: 'boomcat', page_url: 'u/', parent_id: null, body: id, images: [],
        author_name: 'A', author_discord_id: null, parent_author_name: null, parent_body: null,
        channel: 'character', discord_thread_id: thread, attempts: 0,
    });
    w.db.outbox = [item('p1'), item('p2')];

    const report = await w.tick();
    expect(report.rateLimited).toBe(true);
    // p1 was refused and is marked to try again; p2 was never attempted.
    expect(w.db.records.map(r => [r.p_post_id, r.p_state])).toEqual([['p1', 'sending'], ['p1', 'failed']]);
    expect(w.db.lease).toBe(false);
    expect(w.db.released).toBe(1);
});

// --- THE FORUM (batch 2) ---

const TAGS = [
    { id: '300000000000000001', name: 'Question' },
    { id: '300000000000000002', name: 'art' },
    { id: '300000000000000003', name: 'Off-topic' },
];
const THREAD_A = '11111111-1111-4111-8111-111111111111';
const opening = (over = {}) => ({
    action: 'open', thread_id: THREAD_A, title: 'Best Boomcat combo?', tag: 'Question',
    opening_post_id: 'op1', body: 'What do you all use?', images: [], author_name: 'Kai',
    author_discord_id: null, discord_thread_id: null, ...over,
});

test('without the forum secrets the forum stays on the wiki', async () => {
    const w = world();
    w.linkedThread();
    w.forumPost('Started on Discord');
    w.db.forumOutbox = [opening()];
    const report = await w.tick(ENV);
    expect(report.forum).toBe(false);
    expect(w.db.calls).not.toContain('discord_relay_forum_outbox');
    expect(w.db.calls).not.toContain('discord_relay_take_forum');
    expect(w.discord.calls.some(c => c.url.startsWith(FORUM_WEBHOOK))).toBe(false);
});

test('a wiki forum post opens a Discord post with its title, its category as a tag, and its opening message', async () => {
    const w = world();
    w.discord.forumTags = TAGS;
    w.db.forumOutbox = [opening(), opening({ thread_id: '22222222-2222-4222-8222-222222222222', opening_post_id: 'op2', title: 'A guide', tag: 'Guide' })];

    const report = await w.tick(FORUM_ENV);
    expect(report).toMatchObject({ forum: true, forumOpened: 2, errors: [] });
    const opens = w.discord.calls.filter(c => c.method === 'POST' && c.url.startsWith(FORUM_WEBHOOK));
    expect(opens[0].body).toEqual({
        content: 'What do you all use?',
        username: 'Kai',
        allowed_mentions: { parse: [] },
        thread_name: 'Best Boomcat combo?',
        applied_tags: ['300000000000000001'],
    });
    // The channel has no Guide tag: the post opens untagged, never with a wrong one.
    expect(opens[1].body.applied_tags).toBeUndefined();

    const created = w.discord.threads.find(t => t.name === 'Best Boomcat combo?');
    expect(w.db.forumLinks[0]).toEqual({ p_thread_id: THREAD_A, p_discord_thread_id: created.id, p_last_message_id: created.id });
    // Claimed under the forum channel, then recorded under the new post.
    const forOp1 = w.db.records.filter(r => r.p_post_id === 'op1').map(r => [r.p_state, r.p_discord_thread_id, r.p_discord_message_id]);
    expect(forOp1).toEqual([['sending', FORUM, null], ['sent', created.id, created.id]]);
});

test('a forum post by a linked author banned on the server stays on the wiki', async () => {
    const w = world();
    w.discord.banned.add('400000000000000009');
    w.db.forumOutbox = [opening({ author_discord_id: '400000000000000009' })];
    const report = await w.tick(FORUM_ENV);
    expect(report).toMatchObject({ forumOpened: 0, skipped: 1 });
    expect(w.discord.calls.some(c => c.method === 'POST')).toBe(false);
    expect(w.db.records.map(r => r.p_state)).toEqual(['skipped']);
});

test('a post started on Discord is copied in with its category; old ones, the relay posts and deleted starters are not', async () => {
    const w = world();
    w.discord.forumTags = TAGS;
    // Before the forum was connected.
    const old = w.forumPost('From before');
    w.db.forumSince = new Date(T0 + 1500).toISOString();
    const fresh = w.forumPost('My art', {
        content: 'drew this',
        attachments: [{ filename: 'a.png', content_type: 'image/png', size: 10, url: 'https://cdn.discordapp.com/attachments/1/2/a.png' }],
    }, { applied_tags: ['300000000000000003', '300000000000000002'] });
    w.forumPost('Opened by the relay', { webhook_id: FORUM_WEBHOOK_ID, author: { id: FORUM_WEBHOOK_ID, bot: true } });
    const emptied = w.forumPost('Starter deleted');
    w.discord.messages.set(emptied, []);
    // A reply already waiting in the fresh post is read in the same tick.
    w.say(fresh, { content: 'nice' });

    const report = await w.tick(FORUM_ENV);
    expect(report).toMatchObject({ forumTaken: 1, errors: [] });
    expect(w.db.forumTaken).toEqual([{
        p_discord_thread_id: fresh,
        p_title: 'My art',
        p_tag: 'Art',
        p_author_discord_id: '200000000000000002',
        p_author_name: 'Mo',
        p_author_handle: 'mo',
        p_body: 'drew this',
        p_images: [`discord/${fresh}-0.png`],
    }]);
    expect(w.discord.calls.some(c => c.url.endsWith(`/channels/${old}/messages/${old}`))).toBe(false);
    expect(w.db.taken.map(t => [t.p_discord_thread_id, t.p_body])).toEqual([[fresh, 'nice']]);
});

test('a forum post a wiki moderator hid is locked on Discord, and unlocked when restored', async () => {
    const w = world();
    const t = w.forumPost('Spam');
    w.db.forumOutbox = [{ action: 'lock', thread_id: THREAD_A, discord_thread_id: t }];
    await w.tick(FORUM_ENV);
    let patch = w.discord.calls.find(c => c.method === 'PATCH');
    expect(patch.url).toBe(`https://discord.com/api/v10/channels/${t}`);
    expect(patch.body).toEqual({ locked: true, archived: true });
    expect(patch.headers.Authorization).toBe('Bot bot-token');

    w.discord.calls.length = 0;
    w.db.forumOutbox = [{ action: 'unlock', thread_id: THREAD_A, discord_thread_id: t }];
    await w.tick(FORUM_ENV);
    patch = w.discord.calls.find(c => c.method === 'PATCH');
    expect(patch.body).toEqual({ locked: false, archived: false });
    expect(w.db.lockedSet.map(x => x.p_locked)).toEqual([true, false]);
});

test('the sweep follows a forum post renamed or re-tagged on Discord', async () => {
    const w = world();
    w.discord.forumTags = TAGS;
    const t = w.forumPost('Old name', {}, { applied_tags: ['300000000000000002'] });
    w.db.links.set(`forum:${THREAD_A}`, { site_key: `forum:${THREAD_A}`, channel: 'forum', discord_thread_id: t, last_message_id: t, linked_at: new Date(T0).toISOString() });
    w.discord.threads.find(x => x.id === t).name = 'New name';
    w.db.sweepDue = true;

    await w.tick(FORUM_ENV);
    expect(w.db.renames).toEqual([{ p_discord_thread_id: t, p_title: 'New name', p_tag: 'Art' }]);
});

test('a Discord post deleted is noticed: by the sweep, and by a send into it', async () => {
    const w = world();
    // The sweep reads a post that is gone.
    const swept = w.linkedThread('Vessel', 'vessel');
    w.db.recent = [{ post_id: 'a', direction: 'from_discord', discord_thread_id: swept, discord_message_id: w.flake(), body: 'x' }];
    w.discord.deleted.add(swept);
    w.db.sweepDue = true;
    // And a send goes into another that is gone.
    const sent = w.linkedThread('Boomcat', 'boomcat');
    w.discord.deleted.add(sent);
    w.db.outbox = [{
        action: 'send', post_id: 'p1', page_id: 'boomcat', page_url: 'u/', parent_id: null, body: 'x', images: [],
        author_name: 'A', author_discord_id: null, parent_author_name: null, parent_body: null,
        channel: 'character', discord_thread_id: sent, attempts: 0,
    }];
    w.db.sweepDue = true;

    const report = await w.tick();
    expect(w.db.threadsGone.sort()).toEqual([swept, sent].sort());
    expect(report.threadsGone).toBe(2);
    expect(w.db.removed).toContain('discord-media/discord/123456789012345678-1.png');
    expect(w.db.records.map(r => r.p_state)).toEqual(['sending', 'failed']);
});

test('a forum message too long for Discord links back to the forum post', async () => {
    const w = world();
    const t = w.forumPost('Long');
    w.db.links.set(`forum:${THREAD_A}`, { site_key: `forum:${THREAD_A}`, channel: 'forum', discord_thread_id: t, last_message_id: t, linked_at: new Date(T0).toISOString() });
    w.db.outbox = [{
        action: 'send', post_id: 'p9', page_id: `forum:${THREAD_A}`, page_url: null, parent_id: 'p1', body: 'a'.repeat(3000), images: [],
        author_name: 'A', author_discord_id: null, parent_author_name: 'Mo', parent_body: 'q', channel: 'forum', discord_thread_id: t, attempts: 0,
    }];
    await w.tick(FORUM_ENV);
    const send = w.discord.calls.find(c => c.method === 'POST' && c.url.startsWith(FORUM_WEBHOOK));
    expect(send.body.content).toContain(`<https://dogslamloop.com/forum.html?post=${THREAD_A}#post-p1>`);
});
