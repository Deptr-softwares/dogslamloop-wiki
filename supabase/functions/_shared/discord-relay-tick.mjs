// One run of the Discord relay (v1.0 batch 1). Supabase Cron starts one every
// 10 seconds; the Edge Function in ../discord-relay hands this file its
// environment, a service-role database client and `fetch`.
//
// Everything outside is passed in, so tests/discord-relay-tick.spec.js runs a
// whole tick in Node against a fake Discord and a fake database. Spec:
// V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 1"; "rule N" cites its list.

import * as core from './discord-relay-core.mjs';

const API = 'https://discord.com/api/v10';
const WEBHOOK_URL = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/([0-9]{5,20})\/[A-Za-z0-9_-]{20,100}$/;

// Per tick. Ten sends is one every second, inside a webhook's 5 per 2 seconds;
// five new character posts a minute open all of them in a few minutes.
const SEND_LIMIT = 10;
const OPEN_LIMIT = 5;
const READ_LIMIT = 50;
const SWEEP_LIMIT = 100;
const LEASE_SECONDS = 60;
// People whose roles are brought up to date in one sweep (batch 4, role rule 7).
const ROLE_LIMIT = 25;
const ROLE_RETRY_MS = 24 * 60 * 60 * 1000;
const ROLE_REASON = 'Wiki role sync';

export class RateLimited extends Error {}

// Discord's "Unknown Channel": the post was deleted on Discord.
const UNKNOWN_CHANNEL = 10003;
const isGone = (e) => e && e.status === 404 && e.code === UNKNOWN_CHANNEL;
// "Unknown Message": the copy was deleted on Discord.
const UNKNOWN_MESSAGE = 10008;
// "Thread is archived": a change to an archived post is refused until it is
// opened again.
const THREAD_ARCHIVED = 50083;
// "Unknown Member": the person is not on the server.
const UNKNOWN_MEMBER = 10007;

// Rule 11: without every secret the relay does nothing. A preview branch is
// never given them, so it never touches the real server.
export function readConfig(env) {
    const get = (k) => (env && typeof env[k] === 'string' ? env[k].trim() : '');
    const token = get('DISCORD_BOT_TOKEN');
    const guildId = get('DISCORD_GUILD_ID');
    const channelId = get('DISCORD_CHARACTER_CHANNEL_ID');
    const webhookUrl = get('DISCORD_CHARACTER_WEBHOOK_URL');
    const supabaseUrl = get('SUPABASE_URL');

    const hook = WEBHOOK_URL.exec(webhookUrl);
    if (!token || !core.isSnowflake(guildId) || !core.isSnowflake(channelId) || !hook || !supabaseUrl) return null;

    const cfg = {
        token,
        guildId,
        supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
        channels: { character: channelId },
        webhooks: { character: webhookUrl },
    };

    // The forum (batch 2) is optional: both secrets, or the forum stays on the
    // wiki while the character threads relay as before.
    const forumChannel = get('DISCORD_FORUM_CHANNEL_ID');
    const forumWebhook = get('DISCORD_FORUM_WEBHOOK_URL');
    if (core.isSnowflake(forumChannel) && WEBHOOK_URL.test(forumWebhook)) {
        cfg.channels.forum = forumChannel;
        cfg.webhooks.forum = forumWebhook;
    }
    return cfg;
}

export function makeDiscord(fetchImpl, token) {
    async function call(method, url, { body = null, bot = true, okStatuses = [], reason = null } = {}) {
        const headers = { 'User-Agent': 'DiscordBot (https://dogslamloop.com, 1.0)' };
        if (bot) headers.Authorization = `Bot ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        // Shown in the server's audit log beside the change.
        if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);

        const res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        if (res.status === 429) throw new RateLimited(`Discord asked the relay to slow down (${method} ${url.split('?')[0]})`);
        if (okStatuses.includes(res.status)) return res;
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`Discord answered ${res.status} to ${method}: ${text.slice(0, 200)}`);
            err.status = res.status;
            try { err.code = JSON.parse(text).code; } catch (_) { err.code = null; }
            throw err;
        }
        return res;
    }

    const json = async (res) => (res.status === 204 ? null : res.json());

    return {
        async activeThreads(guildId) {
            const data = await json(await call('GET', `${API}/guilds/${guildId}/threads/active`));
            return (data && data.threads) || [];
        },
        async archivedThreads(channelId) {
            const data = await json(await call('GET', `${API}/channels/${channelId}/threads/archived/public?limit=100`));
            return (data && data.threads) || [];
        },
        async messagesAfter(threadId, after, limit) {
            return (await json(await call('GET', `${API}/channels/${threadId}/messages?after=${after}&limit=${limit}`))) || [];
        },
        async message(threadId, messageId) {
            const res = await call('GET', `${API}/channels/${threadId}/messages/${messageId}`, { okStatuses: [404] });
            return res.status === 404 ? null : res.json();
        },
        async channel(channelId) {
            return json(await call('GET', `${API}/channels/${channelId}`));
        },
        // Lock and archive a post, or open it again. Needs Manage Threads.
        async setLocked(threadId, locked) {
            await call('PATCH', `${API}/channels/${threadId}`, { body: { locked, archived: locked } });
        },
        // 200 when banned; 404 when not. Needs View Audit Log (or Ban Members,
        // which the bot is never given).
        async isBanned(guildId, userId) {
            const res = await call('GET', `${API}/guilds/${guildId}/bans/${userId}`, { okStatuses: [404] });
            return res.status !== 404;
        },
        async member(guildId, userId) {
            const res = await call('GET', `${API}/guilds/${guildId}/members/${userId}`, { okStatuses: [404] });
            return res.status === 404 ? null : res.json();
        },
        async deleteMessage(threadId, messageId) {
            await call('DELETE', `${API}/channels/${threadId}/messages/${messageId}`, { okStatuses: [404] });
        },
        async webhookSend(webhookUrl, threadId, payload) {
            const q = threadId ? `?wait=true&thread_id=${threadId}` : '?wait=true';
            return json(await call('POST', `${webhookUrl}${q}`, { body: payload, bot: false }));
        },
        async webhookDelete(webhookUrl, threadId, messageId) {
            await call('DELETE', `${webhookUrl}/messages/${messageId}?thread_id=${threadId}`, { bot: false, okStatuses: [404] });
        },
        // A webhook edits only its own messages (batch 3).
        async webhookEdit(webhookUrl, threadId, messageId, payload) {
            await call('PATCH', `${webhookUrl}/messages/${messageId}?thread_id=${threadId}`, { body: payload, bot: false });
        },
        // Open an archived post again, leaving whether it is locked alone.
        async unarchive(threadId) {
            await call('PATCH', `${API}/channels/${threadId}`, { body: { archived: false } });
        },
        // Name and category in one change. Needs Manage Threads.
        async rename(threadId, name, tagIds) {
            const body = { name };
            if (tagIds) body.applied_tags = tagIds;
            await call('PATCH', `${API}/channels/${threadId}`, { body });
        },
        // Roles (batch 4). Giving and taking need Manage Roles, and only reach
        // roles below the bot's highest; both answer 204 whether or not the
        // member already had it.
        async roles(guildId) {
            return (await json(await call('GET', `${API}/guilds/${guildId}/roles`))) || [];
        },
        async me() {
            return json(await call('GET', `${API}/users/@me`));
        },
        async addRole(guildId, userId, roleId, reason) {
            await call('PUT', `${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
        },
        async removeRole(guildId, userId, roleId, reason) {
            await call('DELETE', `${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
        },
    };
}

async function rpc(db, name, args = {}) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message || error}`);
    return data;
}

// --- RULE 6: IMAGES AND GIFS COMING IN ---

async function copyImages(db, fetchImpl, parsed) {
    const paths = [];
    for (const a of parsed.attachments) {
        try {
            const res = await fetchImpl(a.url);
            if (!res.ok) continue;
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.byteLength > core.IMAGE_MAX_BYTES) continue;
            const path = core.imagePath(parsed.discordMessageId, paths.length, a.ext);
            const { error } = await db.storage.from('discord-media').upload(path, bytes, { contentType: a.contentType, upsert: true });
            if (!error) paths.push(path);
        } catch (_) {
            // A picture that will not copy is left on Discord; the words still
            // come across.
        }
    }
    return paths;
}

async function resolveKlipy(fetchImpl, parsed) {
    const media = new Map(parsed.klipyEmbeds);
    for (const slug of parsed.klipySlugs) {
        if (media.has(slug)) continue;
        try {
            const res = await fetchImpl(`${core.KLIPY_API}${encodeURIComponent(slug)}`);
            if (!res.ok) continue;
            const url = core.klipyPick(await res.json());
            if (url) media.set(slug, url);
        } catch (_) {
            // Left as the link it was, as on the wiki.
        }
    }
    return media;
}

// --- D3: A POST FOR EVERY CHARACTER ---

async function openCharacterPosts(ctx, active) {
    const missing = (await rpc(ctx.db, 'discord_relay_missing_threads')) || [];
    if (!missing.length) return;

    const channelId = ctx.cfg.channels.character;
    const archived = await ctx.discord.archivedThreads(channelId);
    const existing = [...active, ...archived].filter(t => t.parent_id === channelId);

    let opened = 0;
    for (const page of missing) {
        const match = existing.find(t => core.sameTitle(t.name, page.name));
        if (match) {
            const linked = await rpc(ctx.db, 'discord_relay_link_thread', {
                p_site_key: page.page_id, p_channel: 'character',
                p_discord_thread_id: match.id, p_last_message_id: match.last_message_id || match.id,
            });
            if (linked) ctx.report.linked++;
            continue;
        }
        if (opened >= OPEN_LIMIT) continue;
        const msg = await ctx.discord.webhookSend(ctx.cfg.webhooks.character, null, core.characterPostOpening(page));
        opened++;
        if (msg && core.isSnowflake(msg.channel_id) && core.isSnowflake(msg.id)) {
            await rpc(ctx.db, 'discord_relay_link_thread', {
                p_site_key: page.page_id, p_channel: 'character',
                p_discord_thread_id: msg.channel_id, p_last_message_id: msg.id,
            });
            ctx.report.opened++;
        }
    }
}

// --- D4: THE FORUM ---

// The forum channel's tags, read once a tick and only when needed.
async function forumTags(ctx) {
    if (!ctx.forumTags) {
        const channel = await ctx.discord.channel(ctx.cfg.channels.forum);
        ctx.forumTags = (channel && channel.available_tags) || [];
    }
    return ctx.forumTags;
}

// Words and copied pictures for one Discord message, ready for the database.
async function prepareMessage(ctx, msg, parsed) {
    const media = await resolveKlipy(ctx.fetch, parsed);
    const images = await copyImages(ctx.db, ctx.fetch, parsed);
    return { body: core.wikiBody(msg, media), images };
}

// Posts started on Discord, copied in as Forum posts. Start fresh: only posts
// begun after the forum was first connected.
async function importForumPosts(ctx, active) {
    // First, on every forum tick, before anything can return early: the first
    // call stamps when the forum was connected. Called only once a post
    // appeared, it stamped THAT moment, a few seconds after the first post
    // was made, and the first post was skipped as "from before" (found live,
    // 2026-10-04).
    const since = Date.parse(await rpc(ctx.db, 'discord_relay_forum_since'));

    const channelId = ctx.cfg.channels.forum;
    const fresh = active.filter(t => t.parent_id === channelId && core.isSnowflake(t.id));
    if (!fresh.length) return;

    const links = new Set(((await rpc(ctx.db, 'discord_relay_threads')) || []).map(l => l.discord_thread_id));
    const unlinked = fresh.filter(t => !links.has(t.id));
    if (!unlinked.length) return;

    for (const thread of unlinked) {
        if (core.snowflakeTime(thread.id) < since) continue;
        // A forum post's starter message shares the post's id.
        const starter = await ctx.discord.message(thread.id, thread.id);
        const parsed = starter && core.fromDiscordMessage(starter);
        // The relay's own posts, and a starter already deleted, are not copied.
        if (!parsed || parsed.skip) continue;

        const { body, images } = await prepareMessage(ctx, starter, parsed);
        const id = await rpc(ctx.db, 'discord_relay_take_forum', {
            p_discord_thread_id: thread.id,
            p_title: thread.name,
            p_tag: core.tagFromApplied(thread.applied_tags, await forumTags(ctx)),
            p_author_discord_id: parsed.authorDiscordId,
            p_author_name: parsed.authorName,
            p_author_handle: parsed.authorHandle,
            p_body: body,
            p_images: images,
        });
        if (id) ctx.report.forumTaken++;
    }
}

// Wiki forum posts not yet on Discord are opened there; a post a wiki
// moderator hid or removed is locked, and unlocked if restored.
async function openForumPosts(ctx) {
    const work = (await rpc(ctx.db, 'discord_relay_forum_outbox', { p_limit: OPEN_LIMIT })) || [];
    for (const w of work) {
        try {
            if (w.action === 'lock' || w.action === 'unlock') {
                // Once a minute, in the sweep's tick: nothing waits on a lock,
                // and a lock Discord keeps refusing (a permission missing on
                // the channel: 61 refusals in ten minutes in the live test)
                // then costs one request a minute, not six.
                if (!ctx.report.sweep) continue;
                const locked = w.action === 'lock';
                await ctx.discord.setLocked(w.discord_thread_id, locked);
                await rpc(ctx.db, 'discord_relay_set_locked', { p_discord_thread_id: w.discord_thread_id, p_locked: locked });
                ctx.report.locked++;
                continue;
            }

            // Until the post exists on Discord, its opening message is filed
            // under the forum channel: there is no post id to give it yet.
            const record = (state, threadId, messageId, error) => rpc(ctx.db, 'discord_relay_record', {
                p_post_id: w.opening_post_id, p_discord_thread_id: threadId || ctx.cfg.channels.forum,
                p_direction: 'to_discord', p_state: state, p_discord_message_id: messageId, p_error: error,
            });

            if (w.author_discord_id && await blockedOnServer(ctx, w.author_discord_id)) {
                await record('skipped', null, null, 'Author is banned or timed out on the server.');
                ctx.report.skipped++;
                continue;
            }

            await record('sending', null, null, null);
            const payload = core.forumPostOpening({
                title: w.title,
                tagId: core.tagIdFor(await forumTags(ctx), w.tag),
                authorName: w.author_name,
                body: w.body,
                imageUrls: (w.images || []).map(p => publicImageUrl(ctx, p)),
                link: `${core.forumThreadUrl(w.thread_id)}#post-${w.opening_post_id}`,
            });
            let msg;
            try {
                msg = await ctx.discord.webhookSend(ctx.cfg.webhooks.forum, null, payload);
            } catch (e) {
                await record('failed', null, null, String(e.message || e));
                throw e;
            }
            await rpc(ctx.db, 'discord_relay_link_forum', {
                p_thread_id: w.thread_id, p_discord_thread_id: msg.channel_id, p_last_message_id: msg.id,
            });
            await record('sent', msg.channel_id, msg.id, null);
            ctx.report.forumOpened++;
        } catch (e) {
            if (e instanceof RateLimited) throw e;
            ctx.report.errors.push(String(e.message || e));
        }
    }
}

// A Discord post that is gone: the wiki follows (a forum post is removed; a
// character post is unlinked and opened afresh by the next sweep).
async function threadGone(ctx, threadId) {
    const copies = (await rpc(ctx.db, 'discord_relay_thread_gone', { p_discord_thread_id: threadId })) || [];
    const ours = copies.filter(p => core.COPIED_IMAGE_PATH.test(p));
    if (ours.length) await ctx.db.storage.from('discord-media').remove(ours);
    ctx.report.threadsGone++;
}

// --- DISCORD TO WIKI ---

async function readDiscord(ctx, active) {
    const links = (await rpc(ctx.db, 'discord_relay_threads')) || [];
    const byThread = new Map(links.map(l => [l.discord_thread_id, l]));

    for (const thread of active) {
        const link = byThread.get(thread.id);
        if (!link || !core.isSnowflake(thread.last_message_id || '')) continue;
        const after = link.last_message_id || thread.id;
        if (!core.snowflakeAfter(thread.last_message_id, after)) continue;

        const messages = core.sortById(await ctx.discord.messagesAfter(thread.id, after, READ_LIMIT));
        const linkedAt = Date.parse(link.linked_at);
        let cursor = after;

        for (const msg of messages) {
            const parsed = core.fromDiscordMessage(msg);
            // Start fresh: nothing older than the moment the post was linked.
            if (!parsed.skip && core.snowflakeTime(msg.id) >= linkedAt) {
                const media = await resolveKlipy(ctx.fetch, parsed);
                const images = await copyImages(ctx.db, ctx.fetch, parsed);
                const body = core.wikiBody(msg, media);
                try {
                    const id = await rpc(ctx.db, 'discord_relay_take', {
                        p_discord_thread_id: thread.id,
                        p_discord_message_id: parsed.discordMessageId,
                        p_author_discord_id: parsed.authorDiscordId,
                        p_author_name: parsed.authorName,
                        p_author_handle: parsed.authorHandle,
                        p_body: body,
                        p_images: images,
                        p_reply_to_discord_id: parsed.replyTo,
                    });
                    if (id) ctx.report.taken++;
                } catch (e) {
                    // Stop this thread at the message that failed, so the next
                    // tick tries it again rather than stepping past it.
                    ctx.report.errors.push(String(e.message || e));
                    break;
                }
            }
            if (core.snowflakeAfter(msg.id, cursor)) cursor = msg.id;
        }

        if (cursor !== after) {
            await rpc(ctx.db, 'discord_relay_advance', { p_discord_thread_id: thread.id, p_last_message_id: cursor });
        }
    }
}

// --- WIKI TO DISCORD ---

// Rule 9: a wiki account linked to Discord whose owner is banned or timed out
// on the server never has its words posted there.
async function blockedOnServer(ctx, discordId) {
    if (ctx.blocked.has(discordId)) return ctx.blocked.get(discordId);
    let blocked = await ctx.discord.isBanned(ctx.cfg.guildId, discordId);
    if (!blocked) {
        const member = await ctx.discord.member(ctx.cfg.guildId, discordId);
        const until = member && member.communication_disabled_until;
        blocked = Boolean(until && Date.parse(until) > ctx.now());
    }
    ctx.blocked.set(discordId, blocked);
    return blocked;
}

function publicImageUrl(ctx, path) {
    return `${ctx.cfg.supabaseUrl}/storage/v1/object/public/discussion-media/${path}`;
}

async function writeDiscord(ctx) {
    const work = (await rpc(ctx.db, 'discord_relay_outbox', { p_limit: SEND_LIMIT })) || [];
    for (const w of work) {
        const webhook = ctx.cfg.webhooks[w.channel];
        if (!webhook) continue;
        const record = (state, messageId, error) => rpc(ctx.db, 'discord_relay_record', {
            p_post_id: w.post_id, p_discord_thread_id: w.discord_thread_id,
            p_direction: w.action === 'delete_original' ? 'from_discord' : 'to_discord',
            p_state: state, p_discord_message_id: messageId, p_error: error,
        });

        // One item failing never holds up the rest. A rate limit is the
        // exception: it ends the tick, and the next one carries on.
        try {
            if (w.action === 'send') await sendOne(ctx, w, webhook, record);
            else if (w.action === 'edit') await editOne(ctx, w, webhook);
            else if (w.action === 'delete') {
                await ctx.discord.webhookDelete(webhook, w.discord_thread_id, w.discord_message_id);
                await record('deleted', null, null);
                ctx.report.deleted++;
            } else if (w.action === 'delete_original') {
                await ctx.discord.deleteMessage(w.discord_thread_id, w.discord_message_id);
                await record('deleted', null, null);
                ctx.report.deleted++;
            }
        } catch (e) {
            if (e instanceof RateLimited) throw e;
            ctx.report.errors.push(String(e.message || e));
        }
    }
}

async function sendOne(ctx, w, webhook, record) {
    // Fail closed: a ban that cannot be checked is not assumed absent. The
    // post is retried on later ticks, up to five times.
    let blocked;
    try {
        blocked = w.author_discord_id ? await blockedOnServer(ctx, w.author_discord_id) : false;
    } catch (e) {
        if (e instanceof RateLimited) throw e;
        await record('failed', null, `Could not check the author on the server: ${e.message || e}`);
        throw e;
    }
    if (blocked) {
        await record('skipped', null, 'Author is banned or timed out on the server.');
        ctx.report.skipped++;
        return;
    }

    // Claimed before the request: a tick that dies mid-send leaves `sending`,
    // and the post is never sent twice.
    await record('sending', null, null);
    let msg;
    try {
        msg = await ctx.discord.webhookSend(webhook, w.discord_thread_id, core.toDiscordMessage(messageArgs(ctx, w)));
        await record('sent', msg && msg.id, null);
        ctx.report.sent++;
    } catch (e) {
        await record('failed', null, String(e.message || e));
        if (isGone(e)) await threadGone(ctx, w.discord_thread_id);
        throw e;
    }
    // The send carried the post as it is now, edits and all.
    if (w.edited_at) await editResult(ctx, w, null);
}

// What a wiki post says on Discord, for a send and for an edit alike. A reply
// quotes what it answers: the reply it answers, or the post at the top.
function messageArgs(ctx, w) {
    return {
        authorName: w.author_name,
        body: w.body,
        imageUrls: (w.images || []).map(p => publicImageUrl(ctx, p)),
        isReply: Boolean(w.parent_id),
        parentAuthor: w.parent_author_name,
        parentBody: w.parent_body,
        link: core.wikiLink(w.page_id, w.page_url, w.parent_id || w.post_id),
    };
}

const editResult = (ctx, w, error) => rpc(ctx.db, 'discord_relay_edit_result', {
    p_post_id: w.post_id, p_edited_at: w.edited_at, p_error: error,
});

// A change to a post Discord has archived (left quiet too long) is refused
// until the post is opened again; open it and try once more.
async function unarchivedRetry(ctx, threadId, change) {
    try {
        return await change();
    } catch (e) {
        if (!e || e.code !== THREAD_ARCHIVED) throw e;
        await ctx.discord.unarchive(threadId);
        return change();
    }
}

// Batch 3: a wiki post edited after it was sent. The message stays `sent`
// whatever happens: marking it failed would send it a second time. A failed
// edit is counted and tried again, five times at most.
async function editOne(ctx, w, webhook) {
    let blocked;
    try {
        blocked = w.author_discord_id ? await blockedOnServer(ctx, w.author_discord_id) : false;
    } catch (e) {
        if (e instanceof RateLimited) throw e;
        await editResult(ctx, w, `Could not check the author on the server: ${e.message || e}`);
        throw e;
    }
    if (blocked) {
        await editResult(ctx, w, 'Author is banned or timed out on the server.');
        ctx.report.skipped++;
        return;
    }

    const payload = core.toDiscordEdit(messageArgs(ctx, w));
    try {
        await unarchivedRetry(ctx, w.discord_thread_id,
            () => ctx.discord.webhookEdit(webhook, w.discord_thread_id, w.discord_message_id, payload));
    } catch (e) {
        if (e instanceof RateLimited) throw e;
        // Deleted on Discord: the wiki follows, as the sweep would.
        if (e.status === 404 && e.code === UNKNOWN_MESSAGE) {
            await messageGone(ctx, w.discord_message_id);
            return;
        }
        await editResult(ctx, w, String(e.message || e));
        if (isGone(e)) await threadGone(ctx, w.discord_thread_id);
        throw e;
    }
    await editResult(ctx, w, null);
    ctx.report.editsSent++;
}

// A copy deleted on Discord. Only the pictures the relay copied are deleted
// from storage; a wiki author's own uploads stay with the page that owns them.
async function messageGone(ctx, messageId) {
    const images = (await rpc(ctx.db, 'discord_relay_gone', { p_discord_message_id: messageId })) || [];
    const copies = images.filter(p => core.COPIED_IMAGE_PATH.test(p));
    if (copies.length) await ctx.db.storage.from('discord-media').remove(copies);
    ctx.report.gone++;
}

// Batch 3: forum posts renamed on the wiki, renamed on Discord. Here in the
// once-a-minute sweep rather than every tick: Discord limits renames, and a
// refusal then costs one request a minute and never ends the rest of the tick.
// Returns the posts renamed, whose names in this tick's `active` list are now
// out of date.
async function renameForumPosts(ctx, active) {
    const renamed = new Set();
    const work = (await rpc(ctx.db, 'discord_relay_forum_renames', { p_limit: OPEN_LIMIT })) || [];
    for (const w of work) {
        try {
            // Left pending, not dropped: dropped, the sweep would copy the old
            // Discord name back over the wiki's.
            if (w.author_discord_id && await blockedOnServer(ctx, w.author_discord_id)) continue;
            const tagId = core.tagIdFor(await forumTags(ctx), w.tag);
            const name = core.forumPostName(w.title);
            const tags = tagId ? [tagId] : null;
            // A post renamed on the wiki before it reached Discord opens under
            // the new name already (found live, 2026-10-04). Asking again
            // would spend one of the few renames Discord allows for nothing.
            const current = (active || []).find(t => t.id === w.discord_thread_id);
            const shown = current && current.name === name
                && (!tags || ((current.applied_tags || []).length === 1 && current.applied_tags[0] === tagId));
            if (!shown) {
                await unarchivedRetry(ctx, w.discord_thread_id,
                    () => ctx.discord.rename(w.discord_thread_id, name, tags));
                ctx.report.renamed++;
            }
            await rpc(ctx.db, 'discord_relay_renamed', { p_discord_thread_id: w.discord_thread_id, p_edited_at: w.edited_at });
            renamed.add(w.discord_thread_id);
        } catch (e) {
            if (e instanceof RateLimited) {
                ctx.report.renameDeferred = true;
                break;
            }
            if (isGone(e)) {
                await threadGone(ctx, w.discord_thread_id);
                continue;
            }
            ctx.report.errors.push(String(e.message || e));
        }
    }
    return renamed;
}

// --- RULE 2: THE SWEEP ---

async function sweep(ctx, active) {
    // Rule: a post renamed or re-tagged on Discord. Active posts only: a
    // rename unarchives a post, so a changed one is always among them.
    if (ctx.cfg.channels.forum) {
        // The wiki's renames go out first. Those posts' names in `active` were
        // read before the rename, so they are not read back this time.
        const renamed = await renameForumPosts(ctx, active);
        const links = new Set(((await rpc(ctx.db, 'discord_relay_threads')) || [])
            .filter(l => l.channel === 'forum').map(l => l.discord_thread_id));
        const forumActive = active.filter(t => t.parent_id === ctx.cfg.channels.forum && links.has(t.id) && !renamed.has(t.id));
        if (forumActive.length) {
            const tags = await forumTags(ctx);
            for (const t of forumActive) {
                await rpc(ctx.db, 'discord_relay_forum_rename', {
                    p_discord_thread_id: t.id, p_title: t.name, p_tag: core.tagFromApplied(t.applied_tags, tags, null),
                });
            }
        }
    }

    const recent = (await rpc(ctx.db, 'discord_relay_recent')) || [];
    const byThread = new Map();
    for (const row of recent) {
        if (!byThread.has(row.discord_thread_id)) byThread.set(row.discord_thread_id, []);
        byThread.get(row.discord_thread_id).push(row);
    }

    for (const [threadId, rows] of byThread) {
        const oldest = rows.map(r => r.discord_message_id).reduce((a, b) => (core.snowflakeAfter(a, b) ? b : a));
        const after = (BigInt(oldest) - 1n).toString();
        let fetched;
        try {
            fetched = await ctx.discord.messagesAfter(threadId, after, SWEEP_LIMIT);
        } catch (e) {
            if (!isGone(e)) throw e;
            await threadGone(ctx, threadId);
            continue;
        }
        const { gone, edited } = core.sweepFindings(rows, fetched, SWEEP_LIMIT);

        for (const id of gone) await messageGone(ctx, id);
        for (const e of edited) {
            await rpc(ctx.db, 'discord_relay_edit', { p_discord_message_id: e.id, p_body: e.body });
            ctx.report.edited++;
        }
    }
}

// --- ROLES (batch 4) ---
//
// Spec: V1.0-DEVLOG.md, "SPEC 2026-10-05: batch 4", D2. The last step of the
// sweep, so a 429 here costs nothing else; with nobody waiting it makes no
// request at all.

async function syncRoles(ctx) {
    const jobs = (await rpc(ctx.db, 'discord_relay_role_jobs', { p_limit: ROLE_LIMIT })) || [];
    if (!jobs.length) return;

    // Role rule 5: without Manage Roles, wait. Nobody is marked done, so
    // switching it on later loses nobody.
    const guildId = ctx.cfg.guildId;
    const serverRoles = await ctx.discord.roles(guildId);
    const me = await ctx.discord.me();
    const self = me && await ctx.discord.member(guildId, me.id);
    const reach = core.botRoleReach(serverRoles, self ? self.roles : [], guildId);
    if (!reach.canManage) {
        ctx.report.roleSync = 'waiting: the bot lacks Manage Roles';
        return;
    }

    const saved = (await rpc(ctx.db, 'discord_relay_role_map')) || [];
    const pages = (await rpc(ctx.db, 'discord_relay_role_pages')) || [];
    const map = core.resolveRoleMap({ serverRoles, saved, pages });
    for (const key of map.forgotten) await rpc(ctx.db, 'discord_relay_unmap_role', { p_key: key });
    for (const m of map.matched) {
        await rpc(ctx.db, 'discord_relay_map_role', { p_key: m.key, p_discord_role_id: m.id, p_name: m.name });
    }
    if (map.ambiguous.length) ctx.report.rolesAmbiguous = map.ambiguous;

    // A role above the bot's own is skipped and named.
    const byId = new Map(serverRoles.map(r => [r.id, r]));
    const ids = {};
    const above = [];
    for (const [key, id] of Object.entries(map.ids)) {
        if (core.canGiveRole(byId.get(id), reach.top)) ids[key] = id;
        else above.push(byId.get(id) ? byId.get(id).name : key);
    }
    if (above.length) ctx.report.rolesAboveBot = above;

    for (const job of jobs) await syncPerson(ctx, job, ids);
}

// `dirty_at` goes back exactly as it came: the database compares it to decide
// whether a newer change arrived, and a Date would drop its microseconds.
async function roleDone(ctx, job, { synced = null, taken = null, retryAt = null, error = null }) {
    await rpc(ctx.db, 'discord_relay_role_done', {
        p_user_id: job.user_id,
        p_dirty_at: job.dirty_at,
        p_synced: synced,
        p_taken: taken,
        p_retry_at: retryAt,
        p_error: error,
    });
}

async function syncPerson(ctx, job, ids) {
    const guildId = ctx.cfg.guildId;
    const taken = job.taken || [];
    const notOnServer = (change) => roleDone(ctx, job, {
        synced: [],
        taken,
        // Role rule 6: something to give waits for them to join.
        retryAt: change && (change.add.length || change.synced.length)
            ? new Date(ctx.now() + ROLE_RETRY_MS).toISOString()
            : null,
    });

    let current = null;
    if (core.needsMemberRoles(job)) {
        const member = await ctx.discord.member(guildId, job.discord_id);
        if (!member) return notOnServer(null);
        current = member.roles || [];
    }

    const change = core.roleChanges({
        wanted: core.wantedRoles(job),
        synced: job.synced,
        taken,
        banned: core.isWikiBan(job.role),
        current,
        ids,
    });

    try {
        for (const roleId of change.add) {
            await ctx.discord.addRole(guildId, job.discord_id, roleId, ROLE_REASON);
            ctx.report.rolesAdded++;
        }
        for (const roleId of change.remove) {
            await ctx.discord.removeRole(guildId, job.discord_id, roleId, ROLE_REASON);
            ctx.report.rolesRemoved++;
        }
    } catch (e) {
        // Role rule 7: a 429 ends the run, and this person waits as they were.
        if (e instanceof RateLimited) throw e;
        if (e && e.status === 404 && e.code === UNKNOWN_MEMBER) return notOnServer(change);
        // Role rule 8: counted, and tried again on a later run.
        ctx.report.errors.push(String(e.message || e));
        return roleDone(ctx, job, { error: String(e.message || e) });
    }

    await roleDone(ctx, job, { synced: change.synced, taken: change.taken });
    ctx.report.rolePeople++;
}

// --- ONE TICK ---

export async function runTick({ env, db, fetch: fetchImpl, now = () => Date.now() }) {
    const cfg = readConfig(env);
    if (!cfg) return { relay: 'off' };

    const claim = await rpc(db, 'discord_relay_claim', { p_seconds: LEASE_SECONDS });
    if (!claim || !claim.claimed) return { relay: 'busy' };

    const ctx = {
        cfg, db, now,
        fetch: fetchImpl,
        discord: makeDiscord(fetchImpl, cfg.token),
        blocked: new Map(),
        report: {
            relay: 'ran', sweep: Boolean(claim.sweep), forum: Boolean(cfg.channels.forum),
            opened: 0, linked: 0, taken: 0, sent: 0, deleted: 0, skipped: 0, gone: 0, edited: 0,
            forumTaken: 0, forumOpened: 0, locked: 0, threadsGone: 0, editsSent: 0, renamed: 0,
            rolePeople: 0, rolesAdded: 0, rolesRemoved: 0, errors: [],
        },
    };

    try {
        // One request answers "which posts have new messages" for every thread.
        const active = await ctx.discord.activeThreads(cfg.guildId);
        if (claim.sweep) await openCharacterPosts(ctx, active);
        // New Discord forum posts first, so their replies are read this tick.
        if (cfg.channels.forum) await importForumPosts(ctx, active);
        await readDiscord(ctx, active);
        // New wiki forum posts open on Discord before their replies are sent.
        if (cfg.channels.forum) await openForumPosts(ctx);
        await writeDiscord(ctx);
        if (claim.sweep) await sweep(ctx, active);
        if (claim.sweep) await syncRoles(ctx);
    } catch (e) {
        if (e instanceof RateLimited) ctx.report.rateLimited = true;
        ctx.report.errors.push(String(e.message || e));
    } finally {
        await rpc(db, 'discord_relay_release');
    }
    return ctx.report;
}
