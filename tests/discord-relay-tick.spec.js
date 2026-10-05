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
// Batch 4: the bot's own account, and Discord's Manage Roles bit.
const BOT = '100000000000000009';
const MANAGE_ROLES = String(1n << 28n);

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
        // Batch 3: a webhook edit that fails outright, and Discord's limit on
        // renaming a post.
        failEdits: false,
        rateLimitRename: false,
        // Batch 4: the server's roles ({ id, name, position, permissions,
        // managed }), a 429 or a refusal on every role change, and a hook run
        // after each one.
        roles: [],
        rateLimitRoles: false,
        refuseRoles: false,
        onRoleChange: null,
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
        // Batch 3.
        forumRenames: [],     // what discord_relay_forum_renames answers until renamed
        renamedCalls: [],
        editResults: [],
        // Batch 4, kept as the SQL keeps it, across ticks: who signed in with
        // Discord, what the wiki gives them, the relay's row for each, and the
        // role map.
        identities: new Map(),  // user id -> Discord id
        wiki: new Map(),        // user id -> { role, can_moderate, experts }
        roleRows: new Map(),    // user id -> { synced, taken, dirty_at, next_try_at, attempts, last_error }
        roleMap: new Map(),     // key -> Discord role id
        rolePages: [],
    };
    let dirtySeq = 0;
    // A value no two changes share, as clock_timestamp() gives.
    const dirtyStamp = () => new Date(clock).toISOString().replace('Z', `${String(++dirtySeq).padStart(3, '0')}Z`);

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
            if (method === 'PATCH') {
                if (discord.failEdits) return json(500, { message: 'Internal Server Error' });
                const threadId = u.searchParams.get('thread_id');
                const t = discord.threads.find(x => x.id === threadId);
                if (t && t.archived) return json(400, { code: 50083, message: 'Thread is archived' });
                const found = (discord.messages.get(threadId) || []).find(x => x.id === rest.split('/').pop());
                if (!found) return json(404, { code: 10008, message: 'Unknown Message' });
                found.content = body.content;
                return json(200, found);
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
            // A permission missing on the channel, as on the owner's test server.
            if (body.locked !== undefined && discord.denyLock) return json(403, { code: 50001, message: 'Missing Access' });
            if (body.name !== undefined && discord.rateLimitRename) return json(429, { retry_after: 600 });
            // An archived post takes no change until one opens it again.
            if (t && t.archived && body.archived !== false) return json(400, { code: 50083, message: 'Thread is archived' });
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
        if (p === '/api/v10/users/@me') return json(200, { id: BOT, bot: true });
        if (p === `/api/v10/guilds/${GUILD}/roles`) return json(200, discord.roles);
        m = /^\/api\/v10\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(p);
        if (m && (method === 'PUT' || method === 'DELETE')) {
            if (discord.rateLimitRoles) return json(429, { retry_after: 1 });
            const role = discord.roles.find(r => r.id === m[2]);
            if (!role) return json(404, { code: 10011, message: 'Unknown Role' });
            // As Discord decides it: Manage Roles from @everyone or the bot's
            // roles, and only below the bot's highest.
            const own = (discord.members.get(BOT) || { roles: [] }).roles;
            const mine = discord.roles.filter(r => r.id === GUILD || own.includes(r.id));
            const perms = mine.reduce((a, r) => a | BigInt(r.permissions || '0'), 0n);
            const top = Math.max(0, ...mine.filter(r => r.id !== GUILD).map(r => r.position));
            if (discord.refuseRoles || !(perms & (1n << 28n)) || role.position >= top) {
                return json(403, { code: 50013, message: 'Missing Permissions' });
            }
            const member = discord.members.get(m[1]);
            if (!member) return json(404, { code: 10007, message: 'Unknown Member' });
            member.roles = method === 'PUT'
                ? [...new Set([...(member.roles || []), m[2]])]
                : (member.roles || []).filter(r => r !== m[2]);
            if (discord.onRoleChange) discord.onRoleChange(method, m[1], m[2]);
            return json(204, null);
        }
        m = /^\/api\/v10\/guilds\/\d+\/bans\/(\d+)$/.exec(p);
        if (m) return discord.banned.has(m[1]) ? json(200, { user: { id: m[1] } }) : json(404, { message: 'Unknown Ban' });
        m = /^\/api\/v10\/guilds\/\d+\/members\/(\d+)$/.exec(p);
        if (m) return discord.members.has(m[1]) ? json(200, discord.members.get(m[1])) : json(404, { code: 10007, message: 'Unknown Member' });
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
        // As the SQL does: the first call stamps the moment, later calls read it.
        discord_relay_forum_since() { if (!db.forumSince) db.forumSince = new Date(clock).toISOString(); return db.forumSince; },
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
        discord_relay_forum_renames() { return db.forumRenames.slice(); },
        discord_relay_renamed(a) {
            db.renamedCalls.push(a);
            db.forumRenames = db.forumRenames.filter(r => r.discord_thread_id !== a.p_discord_thread_id);
            return null;
        },
        discord_relay_edit_result(a) { db.editResults.push(a); return null; },
        discord_relay_thread_gone(a) {
            db.threadsGone.push(a.p_discord_thread_id);
            for (const [k, l] of db.links) if (l.discord_thread_id === a.p_discord_thread_id) db.links.delete(k);
            return ['discord/123456789012345678-1.png'];
        },
        // Batch 4, the contract of 20261005000000_discord_role_sync.sql.
        discord_relay_role_jobs(a) {
            for (const userId of db.identities.keys()) {
                if (!db.roleRows.has(userId)) {
                    db.roleRows.set(userId, { synced: null, taken: [], dirty_at: dirtyStamp(), next_try_at: null, attempts: 0, last_error: null });
                }
            }
            return [...db.roleRows]
                .filter(([userId, r]) => db.identities.has(userId) && r.dirty_at
                    && (!r.next_try_at || Date.parse(r.next_try_at) <= clock) && r.attempts < 5)
                .sort((x, y) => (x[1].dirty_at < y[1].dirty_at ? -1 : 1))
                .slice(0, a.p_limit)
                .map(([userId, r]) => {
                    const wk = db.wiki.get(userId) || {};
                    return {
                        user_id: userId, discord_id: db.identities.get(userId),
                        role: wk.role || null, can_moderate: Boolean(wk.can_moderate),
                        expert_pages: [...(wk.experts || [])].sort(),
                        synced: r.synced ? [...r.synced] : null, taken: [...r.taken], dirty_at: r.dirty_at,
                    };
                });
        },
        discord_relay_role_done(a) {
            const r = db.roleRows.get(a.p_user_id);
            if (!r) return null;
            if (a.p_error) { r.attempts++; r.last_error = a.p_error; return null; }
            r.synced = [...(a.p_synced || [])];
            r.taken = [...(a.p_taken || [])];
            r.attempts = 0;
            r.next_try_at = a.p_retry_at;
            r.last_error = a.p_retry_at ? 'Not on the server.' : null;
            if (!a.p_retry_at && r.dirty_at === a.p_dirty_at) r.dirty_at = null;
            return null;
        },
        discord_relay_role_map() { return [...db.roleMap].map(([key, id]) => ({ key, discord_role_id: id })); },
        discord_relay_role_pages() { return db.rolePages.slice(); },
        discord_relay_map_role(a) {
            for (const [k, id] of db.roleMap) if (id === a.p_discord_role_id && k !== a.p_key) db.roleMap.delete(k);
            db.roleMap.set(a.p_key, a.p_discord_role_id);
            return null;
        },
        discord_relay_unmap_role(a) { db.roleMap.delete(a.p_key); return null; },
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

    // Batch 4: a change on the wiki, as the triggers record it. Only a person
    // the relay has already seen is marked; the rest wait for its first-run
    // pass.
    function wikiChange(userId, change) {
        db.wiki.set(userId, { ...(db.wiki.get(userId) || {}), ...change });
        const r = db.roleRows.get(userId);
        if (r) Object.assign(r, { dirty_at: dirtyStamp(), next_try_at: null, attempts: 0 });
    }

    const tick = (env = ENV) => runTick({ env, db: client, fetch: fetchFake, now: () => clock });
    // A tick with the once-a-minute sweep in it, where the role step runs.
    const sweepTick = (env = ENV) => { db.sweepDue = true; return tick(env); };
    return {
        discord, db, tick, sweepTick, linkedThread, say, forumPost, flake, wikiChange,
        advance: (ms) => { clock += ms; },
    };
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
    w.db.sweepDue = true;
    await w.tick(FORUM_ENV);
    patch = w.discord.calls.find(c => c.method === 'PATCH');
    expect(patch.body).toEqual({ locked: false, archived: false });
    expect(w.db.lockedSet.map(x => x.p_locked)).toEqual([true, false]);
});

// Found live, 2026-10-04: a permission missing on the channel had Discord
// refuse the lock 61 times in ten minutes, one per tick.
test('a lock Discord refuses is tried once a minute, in the sweep, not every tick', async () => {
    const w = world();
    const t = w.forumPost('Spam');
    w.discord.denyLock = true;
    const lockRow = () => { w.db.forumOutbox = [{ action: 'lock', thread_id: THREAD_A, discord_thread_id: t }]; };

    w.db.sweepDue = false;
    for (let i = 0; i < 3; i++) { lockRow(); await w.tick(FORUM_ENV); }
    expect(w.discord.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);

    lockRow();
    w.db.sweepDue = true;
    const report = await w.tick(FORUM_ENV);
    expect(w.discord.calls.filter(c => c.method === 'PATCH')).toHaveLength(1);
    expect(report.errors.join(' ')).toContain('Missing Access');
    expect(w.db.lockedSet).toEqual([]);
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

// --- FOUND IN THE LIVE FORUM TEST, 2026-10-04 ---

test('the forum is stamped as connected on its first tick, so the first post started on Discord is copied in', async () => {
    const w = world();
    w.db.forumSince = null;   // never connected
    // The first tick finds an empty forum channel.
    await w.tick(FORUM_ENV);
    expect(w.db.forumSince).toBe(new Date(T0).toISOString());

    w.advance(60000);
    const first = w.forumPost('First post on Discord');
    // Seen a few seconds after it was made, as a 10-second timer sees it.
    w.advance(5000);
    const report = await w.tick(FORUM_ENV);
    expect(report).toMatchObject({ forumTaken: 1, errors: [] });
    expect(w.db.forumTaken[0].p_discord_thread_id).toBe(first);
});

test('a Discord post with none of the six tags leaves the wiki category as it is', async () => {
    const w = world();
    w.discord.forumTags = TAGS;
    const link = (t) => w.db.links.set(`forum:${t}`, { site_key: `forum:${t}`, channel: 'forum', discord_thread_id: t, last_message_id: t, linked_at: new Date(T0).toISOString() });
    const untagged = w.forumPost('Untagged', {}, { applied_tags: [] });
    const offTopic = w.forumPost('Off-topic only', {}, { applied_tags: ['300000000000000003'] });
    link(untagged);
    link(offTopic);
    w.db.sweepDue = true;

    await w.tick(FORUM_ENV);
    expect(w.db.renames).toEqual([
        { p_discord_thread_id: untagged, p_title: 'Untagged', p_tag: null },
        { p_discord_thread_id: offTopic, p_title: 'Off-topic only', p_tag: null },
    ]);
});

// --- EDITS AND RENAMES FROM THE WIKI (batch 3) ---

const EDITED_AT = '2026-10-04T12:05:00.000Z';
const editOf = (thread, messageId, over = {}) => ({
    action: 'edit', post_id: 'p1', page_id: 'boomcat', page_url: 'characters/Boomcat/', parent_id: null,
    body: 'new words', images: [], author_name: 'Kai', author_discord_id: null,
    parent_author_name: null, parent_body: null, channel: 'character',
    discord_thread_id: thread, discord_message_id: messageId, attempts: 0, edited_at: EDITED_AT, ...over,
});

test('a wiki edit edits the Discord copy through its own webhook, quote line and all, and records which edit it carried', async () => {
    const w = world();
    const thread = w.linkedThread();
    const copy = w.say(thread, { webhook_id: WEBHOOK_ID, content: 'old words' });
    w.db.links.get('boomcat').last_message_id = copy.id;
    // A reply to a reply: the quote is of the reply it answers.
    w.db.outbox = [editOf(thread, copy.id, { parent_id: 'top', parent_author_name: 'Mo', parent_body: 'the reply answered' })];

    const report = await w.tick();
    expect(report).toMatchObject({ editsSent: 1, errors: [] });
    const patch = w.discord.calls.find(c => c.method === 'PATCH');
    expect(patch.url).toBe(`${WEBHOOK}/messages/${copy.id}?thread_id=${thread}`);
    expect(patch.headers.Authorization).toBeUndefined();
    // No `username`: a webhook message keeps the name it was sent under.
    expect(patch.body).toEqual({ content: '> **Mo**: the reply answered\nnew words', allowed_mentions: { parse: [] } });
    expect(w.discord.messages.get(thread).find(m => m.id === copy.id).content).toBe(patch.body.content);
    expect(w.db.editResults).toEqual([{ p_post_id: 'p1', p_edited_at: EDITED_AT, p_error: null }]);
    // The message's state is never touched by an edit.
    expect(w.db.records).toEqual([]);
});

test('an edit to a copy deleted on Discord takes the post down on the wiki, as the sweep would', async () => {
    const w = world();
    const thread = w.linkedThread();
    const missing = w.flake();
    w.db.outbox = [editOf(thread, missing)];

    const report = await w.tick();
    expect(report).toMatchObject({ editsSent: 0, gone: 1, errors: [] });
    expect(w.db.gone).toEqual([missing]);
    expect(w.db.removed).toEqual(['discord-media/discord/123456789012345678-0.png']);
    expect(w.db.editResults).toEqual([]);
});

test('an edit to an archived Discord post opens the post and tries once more', async () => {
    const w = world();
    const thread = w.linkedThread();
    const copy = w.say(thread, { webhook_id: WEBHOOK_ID, content: 'old words' });
    w.db.links.get('boomcat').last_message_id = copy.id;
    w.discord.threads.find(t => t.id === thread).archived = true;
    w.db.outbox = [editOf(thread, copy.id)];

    const report = await w.tick();
    expect(report).toMatchObject({ editsSent: 1, errors: [] });
    const patches = w.discord.calls.filter(c => c.method === 'PATCH');
    expect(patches.map(c => (c.url.startsWith(WEBHOOK) ? 'edit' : c.body))).toEqual(['edit', { archived: false }, 'edit']);
    // Opening it changed nothing about whether it is locked.
    expect(patches[1].body).not.toHaveProperty('locked');
});

test('a failed edit is counted and tried again, and the message is never marked failed or sent twice', async () => {
    const w = world();
    const thread = w.linkedThread();
    const copy = w.say(thread, { webhook_id: WEBHOOK_ID, content: 'old words' });
    w.db.links.get('boomcat').last_message_id = copy.id;
    w.discord.failEdits = true;
    w.db.outbox = [editOf(thread, copy.id)];

    const report = await w.tick();
    expect(report.errors.join(' ')).toContain('Discord answered 500');
    expect(w.db.editResults).toHaveLength(1);
    expect(w.db.editResults[0]).toMatchObject({ p_post_id: 'p1', p_edited_at: EDITED_AT });
    expect(w.db.editResults[0].p_error).toContain('Discord answered 500');
    expect(w.db.records).toEqual([]);
    expect(w.discord.calls.some(c => c.method === 'POST')).toBe(false);
});

test('an edit by a linked author banned on the server is not carried over', async () => {
    const w = world();
    const thread = w.linkedThread();
    const copy = w.say(thread, { webhook_id: WEBHOOK_ID, content: 'old words' });
    w.db.links.get('boomcat').last_message_id = copy.id;
    w.discord.banned.add('400000000000000001');
    w.db.outbox = [editOf(thread, copy.id, { author_discord_id: '400000000000000001' })];

    const report = await w.tick();
    expect(report).toMatchObject({ editsSent: 0, skipped: 1, errors: [] });
    expect(w.discord.calls.some(c => c.method === 'PATCH')).toBe(false);
    expect(w.db.editResults).toEqual([{ p_post_id: 'p1', p_edited_at: EDITED_AT, p_error: 'Author is banned or timed out on the server.' }]);
});

test('a send of a post edited before it went out records that edit as carried', async () => {
    const w = world();
    const thread = w.linkedThread();
    w.db.outbox = [{ ...editOf(thread, null), action: 'send' }];

    await w.tick();
    const sent = w.discord.messages.get(thread).at(-1);
    expect(w.db.records.map(r => r.p_state)).toEqual(['sending', 'sent']);
    expect(w.db.records[1].p_discord_message_id).toBe(sent.id);
    expect(w.db.editResults).toEqual([{ p_post_id: 'p1', p_edited_at: EDITED_AT, p_error: null }]);
});

function renamedForumPost(w, over = {}) {
    w.discord.forumTags = TAGS;
    const t = w.forumPost('Old name', {}, { applied_tags: ['300000000000000001'] });
    w.db.links.set(`forum:${THREAD_A}`, { site_key: `forum:${THREAD_A}`, channel: 'forum', discord_thread_id: t, last_message_id: t, linked_at: new Date(T0).toISOString() });
    w.db.forumRenames = [{ thread_id: THREAD_A, title: 'New name', tag: 'Art', edited_at: EDITED_AT, discord_thread_id: t, author_discord_id: null, ...over }];
    return t;
}

test('a wiki rename renames the Discord post in the sweep, name and category at once, and the old name is not copied back', async () => {
    const w = world();
    const t = renamedForumPost(w);

    // Not in an ordinary tick.
    w.db.sweepDue = false;
    await w.tick(FORUM_ENV);
    expect(w.discord.calls.some(c => c.method === 'PATCH')).toBe(false);

    w.db.sweepDue = true;
    const report = await w.tick(FORUM_ENV);
    expect(report).toMatchObject({ renamed: 1, errors: [] });
    const patch = w.discord.calls.find(c => c.method === 'PATCH');
    expect(patch.url).toBe(`https://discord.com/api/v10/channels/${t}`);
    expect(patch.body).toEqual({ name: 'New name', applied_tags: ['300000000000000002'] });
    expect(w.db.renamedCalls).toEqual([{ p_discord_thread_id: t, p_edited_at: EDITED_AT }]);
    // The tick read the post as "Old name" before renaming it; that is not
    // copied back over the wiki's new name.
    expect(w.db.renames).toEqual([]);
});

test('Discord rename limit puts a rename off to the next sweep without ending the tick', async () => {
    const w = world();
    renamedForumPost(w);
    w.discord.rateLimitRename = true;
    // Something else for the same sweep to do after the refused rename.
    const thread = w.linkedThread();
    const deletedId = w.flake();
    w.db.recent = [{ post_id: 'c', direction: 'from_discord', discord_thread_id: thread, discord_message_id: deletedId, body: 'bye' }];
    w.db.sweepDue = true;

    const report = await w.tick(FORUM_ENV);
    expect(report.renameDeferred).toBe(true);
    expect(report.rateLimited).toBeUndefined();
    expect(report.errors).toEqual([]);
    expect(w.db.renamedCalls).toEqual([]);
    expect(w.db.gone).toEqual([deletedId]);

    w.discord.rateLimitRename = false;
    w.db.sweepDue = true;
    expect(await w.tick(FORUM_ENV)).toMatchObject({ renamed: 1 });
});

test('an archived forum post is opened before it is renamed; a banned starter rename waits', async () => {
    const w = world();
    const t = renamedForumPost(w);
    w.discord.threads.find(x => x.id === t).archived = true;
    w.db.sweepDue = true;
    await w.tick(FORUM_ENV);
    const named = { name: 'New name', applied_tags: ['300000000000000002'] };
    expect(w.discord.calls.filter(c => c.method === 'PATCH').map(c => c.body)).toEqual([named, { archived: false }, named]);
    expect(w.db.renamedCalls).toHaveLength(1);

    const v = world();
    renamedForumPost(v, { author_discord_id: '400000000000000001' });
    v.discord.banned.add('400000000000000001');
    v.db.sweepDue = true;
    await v.tick(FORUM_ENV);
    expect(v.discord.calls.some(c => c.method === 'PATCH')).toBe(false);
    // Still waiting, so the sweep does not copy Discord's old name back.
    expect(v.db.renamedCalls).toEqual([]);
    expect(v.db.forumRenames).toHaveLength(1);
});

// Found live, 2026-10-04: a post renamed on the wiki before it reached
// Discord opened under the new name, and the sweep renamed it again to the
// same name, spending one of the renames Discord allows.
test('a rename Discord already shows is marked done without asking Discord again', async () => {
    const w = world();
    const t = renamedForumPost(w);
    const thread = w.discord.threads.find(x => x.id === t);
    thread.name = 'New name';
    thread.applied_tags = ['300000000000000002'];
    w.db.sweepDue = true;

    const report = await w.tick(FORUM_ENV);
    expect(w.discord.calls.filter(c => c.method === 'PATCH')).toEqual([]);
    expect(report.renamed).toBe(0);
    expect(w.db.renamedCalls).toEqual([{ p_discord_thread_id: t, p_edited_at: EDITED_AT }]);

    // The same name under another category is still a change.
    const v = world();
    const u = renamedForumPost(v);
    v.discord.threads.find(x => x.id === u).name = 'New name';
    v.db.sweepDue = true;
    await v.tick(FORUM_ENV);
    expect(v.discord.calls.filter(c => c.method === 'PATCH').map(c => c.body)).toEqual([{ name: 'New name', applied_tags: ['300000000000000002'] }]);
});

// --- BATCH 4: DISCORD ROLES FOLLOW THE WIKI ---
//
// Spec: V1.0-DEVLOG.md, "SPEC 2026-10-05: batch 4", D2. The fake database
// keeps each person's row across ticks, as the SQL does: the batch 2 lesson,
// where a fake with a fixed answer hid a skipped first post.

const R = {
    bot: '300000000000000001', boomcat: '300000000000000002', admin: '300000000000000003',
    reviewer: '300000000000000004', trusted: '300000000000000005', moderate: '300000000000000006',
    honored: '300000000000000007', vessel: '300000000000000008',
};
const ANA = '400000000000000001';
const BO = '400000000000000002';
const CY = '400000000000000003';
const DI = '400000000000000004';
const OWN = '400000000000000005';
const DAY = 24 * 60 * 60 * 1000;

// The owner's server, as they named the roles (2026-10-04), with the bot's
// role above every synced one and below Boomcat.
function roleServer(w, { botPerms = MANAGE_ROLES } = {}) {
    w.discord.roles = [
        { id: GUILD, name: '@everyone', position: 0, permissions: '0', managed: false },
        { id: R.boomcat, name: 'Boomcat', position: 9, permissions: '0', managed: false },
        { id: R.bot, name: 'DSL Relay', position: 8, permissions: botPerms, managed: true },
        { id: R.admin, name: 'Admin of DSL', position: 7, permissions: '0', managed: false },
        { id: R.reviewer, name: 'Reviewer of DSL', position: 6, permissions: '0', managed: false },
        { id: R.trusted, name: 'Trusted Editor of DSL', position: 5, permissions: '0', managed: false },
        { id: R.moderate, name: 'Moderation Perms', position: 4, permissions: '0', managed: false },
        { id: R.honored, name: 'Honored One Expert', position: 3, permissions: '0', managed: false },
        { id: R.vessel, name: 'Vessel Expert', position: 2, permissions: '0', managed: false },
    ];
    w.discord.members.set(BOT, { user: { id: BOT }, roles: [R.bot] });
    w.db.rolePages = [
        { page_id: 'honored_one', name: 'Honored One' },
        { page_id: 'vessel', name: 'Vessel' },
        { page_id: 'boomcat', name: 'Boomcat' },
    ];
}

// Someone signed in with Discord, on the server unless told otherwise.
function person(w, userId, discordId, wiki = {}, { roles = [], onServer = true } = {}) {
    w.db.identities.set(userId, discordId);
    w.db.wiki.set(userId, { role: null, can_moderate: false, experts: [], ...wiki });
    if (onServer) w.discord.members.set(discordId, { user: { id: discordId }, roles: [...roles] });
}

const rolesOf = (w, discordId) => [...w.discord.members.get(discordId).roles].sort();
const sorted = (...ids) => ids.sort();
const roleChanges = (w) => w.discord.calls.filter(c => /\/members\/\d+\/roles\/\d+$/.test(new URL(c.url).pathname));
const roleReads = (w) => w.discord.calls.filter(c => /\/roles$|\/users\/@me$/.test(new URL(c.url).pathname));

test('roles: with nobody waiting, the step asks Discord nothing, and it only runs in the sweep', async () => {
    const w = world();
    roleServer(w);
    const report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(w.db.calls).toContain('discord_relay_role_jobs');
    expect(roleReads(w)).toEqual([]);

    // A tick between sweeps does not even ask the database.
    person(w, 'ana', ANA, { role: 'reviewer' });
    w.db.calls = [];
    await w.tick();
    expect(w.db.calls).not.toContain('discord_relay_role_jobs');
    expect(rolesOf(w, ANA)).toEqual([]);

    // Done once, nobody waits, and the next sweep reads no roles.
    await w.sweepTick();
    w.discord.calls = [];
    await w.sweepTick();
    expect(roleReads(w)).toEqual([]);
    expect(roleChanges(w)).toEqual([]);
});

test('roles: the first run gives everyone signed in with Discord what the wiki gives, once, and takes nothing', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer', can_moderate: true, experts: ['honored_one'] });
    person(w, 'bo', BO, {});
    // Banned on the wiki, with an Expert role given by hand before the sync.
    person(w, 'cy', CY, { role: 'viewer' }, { roles: [R.vessel] });
    // A rank role given by hand that the wiki does not give.
    person(w, 'di', DI, { role: 'trusted_editor' }, { roles: [R.admin] });
    person(w, 'own', OWN, { role: 'owner' });

    const report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, ANA)).toEqual(sorted(R.reviewer, R.moderate, R.honored));
    expect(rolesOf(w, BO)).toEqual([]);
    expect(rolesOf(w, CY)).toEqual([R.vessel]);
    expect(rolesOf(w, DI)).toEqual(sorted(R.admin, R.trusted));
    // Boomcat is the owner's alone and never synced.
    expect(rolesOf(w, OWN)).toEqual([]);
    expect(report).toMatchObject({ rolePeople: 5, rolesAdded: 4, rolesRemoved: 0 });
    expect([...w.db.roleRows.values()].every(r => r.dirty_at === null)).toBe(true);

    // Found by name and kept by id. The owner's role "Boomcat" is not
    // "Boomcat Expert".
    expect(Object.fromEntries(w.db.roleMap)).toEqual({
        admin: R.admin, reviewer: R.reviewer, trusted_editor: R.trusted, moderate: R.moderate,
        'expert:honored_one': R.honored, 'expert:vessel': R.vessel,
    });
    // Every change says why in the server's audit log.
    expect(roleChanges(w).map(c => c.headers['X-Audit-Log-Reason'])).toEqual(Array(4).fill('Wiki%20role%20sync'));

    // Once is once.
    w.discord.calls = [];
    await w.sweepTick();
    expect(roleChanges(w)).toEqual([]);
});

test('roles: a change on the wiki changes only the role it is about, and leaves what was done by hand', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer', can_moderate: true });
    await w.sweepTick();

    // By hand on Discord: Vessel Expert given, Moderation Perms taken.
    w.discord.members.get(ANA).roles = [R.reviewer, R.vessel];

    w.wikiChange('ana', { role: 'admin' });
    await w.sweepTick();
    expect(rolesOf(w, ANA)).toEqual(sorted(R.admin, R.vessel));

    w.wikiChange('ana', { experts: ['honored_one'] });
    await w.sweepTick();
    expect(rolesOf(w, ANA)).toEqual(sorted(R.admin, R.vessel, R.honored));

    w.wikiChange('ana', { experts: [], can_moderate: false });
    const report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, ANA)).toEqual(sorted(R.admin, R.vessel));
});

test("roles: a wiki ban takes every synced role, hand-given ones too, and lifting it gives back the wiki's and what the ban took", async () => {
    const w = world();
    roleServer(w);
    person(w, 'bo', BO, { role: 'reviewer', experts: ['honored_one'] }, { roles: [R.vessel] });
    await w.sweepTick();
    expect(rolesOf(w, BO)).toEqual(sorted(R.reviewer, R.honored, R.vessel));

    w.wikiChange('bo', { role: 'viewer' });
    let report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, BO)).toEqual([]);
    expect(w.db.roleRows.get('bo')).toMatchObject({ synced: [], taken: ['expert:vessel'], dirty_at: null });

    // Restored as a trusted editor: not Reviewer, which the wiki no longer
    // gives; Honored One Expert, which it still does; Vessel Expert, which
    // the ban took.
    w.wikiChange('bo', { role: 'trusted_editor' });
    report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, BO)).toEqual(sorted(R.trusted, R.honored, R.vessel));
    expect(w.db.roleRows.get('bo')).toMatchObject({ synced: ['expert:honored_one', 'trusted_editor'], taken: [] });
});

test('roles: a role renamed on Discord keeps working; one deleted is found again by name', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer' });
    await w.sweepTick();

    w.discord.roles.find(r => r.id === R.reviewer).name = 'DSL Reviewers';
    w.wikiChange('ana', { role: 'trusted_editor' });
    await w.sweepTick();
    expect(rolesOf(w, ANA)).toEqual([R.trusted]);

    // Trusted Editor of DSL deleted and made again.
    const NEW_TRUSTED = '300000000000000010';
    w.discord.roles = w.discord.roles.filter(r => r.id !== R.trusted);
    w.discord.members.get(ANA).roles = [];
    w.discord.roles.push({ id: NEW_TRUSTED, name: 'trusted editor of dsl', position: 5, permissions: '0', managed: false });
    person(w, 'di', DI, { role: 'trusted_editor' });
    const report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(w.db.roleMap.get('trusted_editor')).toBe(NEW_TRUSTED);
    expect(rolesOf(w, DI)).toEqual([NEW_TRUSTED]);
});

test('roles: without Manage Roles the step waits, and nobody is lost when it is switched on', async () => {
    const w = world();
    roleServer(w, { botPerms: '0' });
    person(w, 'ana', ANA, { role: 'reviewer' });

    let report = await w.sweepTick();
    expect(report.roleSync).toBe('waiting: the bot lacks Manage Roles');
    expect(roleChanges(w)).toEqual([]);
    expect(w.db.roleRows.get('ana').dirty_at).not.toBeNull();

    w.discord.roles.find(r => r.id === R.bot).permissions = MANAGE_ROLES;
    report = await w.sweepTick();
    expect(report.roleSync).toBeUndefined();
    expect(rolesOf(w, ANA)).toEqual([R.reviewer]);
});

test("roles: a role above the bot's is skipped and named; moved below, the next wiki change gives it", async () => {
    const w = world();
    roleServer(w);
    w.discord.roles.find(r => r.id === R.admin).position = 10;
    person(w, 'ana', ANA, { role: 'admin', experts: ['honored_one'] });

    let report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(report.rolesAboveBot).toEqual(['Admin of DSL']);
    expect(rolesOf(w, ANA)).toEqual([R.honored]);
    // Never asked for, so Discord never refused it.
    expect(roleChanges(w).filter(c => c.url.includes(R.admin))).toEqual([]);

    w.discord.roles.find(r => r.id === R.admin).position = 7;
    w.wikiChange('ana', { can_moderate: true });
    report = await w.sweepTick();
    expect(report.rolesAboveBot).toBeUndefined();
    expect(rolesOf(w, ANA)).toEqual(sorted(R.admin, R.moderate, R.honored));
});

test('roles: someone not on the server is tried again a day later; someone with nothing to give is simply done', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer' }, { onServer: false });
    person(w, 'bo', BO, {}, { onServer: false });

    let report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(w.db.roleRows.get('ana')).toMatchObject({ synced: [], last_error: 'Not on the server.' });
    expect(w.db.roleRows.get('ana').dirty_at).not.toBeNull();
    expect(Date.parse(w.db.roleRows.get('ana').next_try_at)).toBeGreaterThan(Date.parse('2026-10-05T11:00:00Z'));
    expect(w.db.roleRows.get('bo')).toMatchObject({ dirty_at: null, next_try_at: null });

    // An hour later: not asked again.
    w.advance(60 * 60 * 1000);
    w.discord.calls = [];
    await w.sweepTick();
    expect(roleChanges(w)).toEqual([]);

    // They join, and the day passes.
    w.discord.members.set(ANA, { user: { id: ANA }, roles: [] });
    w.advance(DAY);
    report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, ANA)).toEqual([R.reviewer]);
    expect(w.db.roleRows.get('ana')).toMatchObject({ dirty_at: null, next_try_at: null, last_error: null });
});

test('roles: when Discord says slow down, the person waits exactly as they were', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer', can_moderate: true });
    w.discord.rateLimitRoles = true;

    let report = await w.sweepTick();
    expect(report.rateLimited).toBe(true);
    expect(w.db.roleRows.get('ana')).toMatchObject({ synced: null, attempts: 0 });
    expect(w.db.roleRows.get('ana').dirty_at).not.toBeNull();
    expect(w.db.lease).toBe(false);

    w.discord.rateLimitRoles = false;
    report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, ANA)).toEqual(sorted(R.reviewer, R.moderate));
});

test('roles: a wiki change made while the relay works keeps the person waiting for the next run', async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer' });
    w.discord.onRoleChange = () => {
        w.discord.onRoleChange = null;
        w.wikiChange('ana', { role: 'admin' });
    };

    await w.sweepTick();
    expect(rolesOf(w, ANA)).toEqual([R.reviewer]);
    expect(w.db.roleRows.get('ana').dirty_at).not.toBeNull();

    await w.sweepTick();
    expect(rolesOf(w, ANA)).toEqual([R.admin]);
    expect(w.db.roleRows.get('ana').dirty_at).toBeNull();
});

test('roles: two roles with one name match neither, and the report says which', async () => {
    const w = world();
    roleServer(w);
    w.discord.roles.push({ id: '300000000000000011', name: 'vessel expert', position: 1, permissions: '0', managed: false });
    person(w, 'ana', ANA, { experts: ['vessel', 'honored_one'] });

    const report = await w.sweepTick();
    expect(report.rolesAmbiguous).toEqual(['Vessel Expert']);
    expect(w.db.roleMap.has('expert:vessel')).toBe(false);
    expect(rolesOf(w, ANA)).toEqual([R.honored]);
});

test("roles: a refused change is tried on 5 runs, then left until the person's next wiki change", async () => {
    const w = world();
    roleServer(w);
    person(w, 'ana', ANA, { role: 'reviewer' });
    w.discord.refuseRoles = true;

    for (let i = 0; i < 5; i++) {
        const report = await w.sweepTick();
        expect(report.errors.join(' ')).toContain('403');
    }
    expect(w.db.roleRows.get('ana')).toMatchObject({ attempts: 5, synced: null });

    w.discord.calls = [];
    await w.sweepTick();
    expect(roleChanges(w)).toEqual([]);

    w.discord.refuseRoles = false;
    w.wikiChange('ana', { can_moderate: true });
    const report = await w.sweepTick();
    expect(report.errors).toEqual([]);
    expect(rolesOf(w, ANA)).toEqual(sorted(R.reviewer, R.moderate));
});
