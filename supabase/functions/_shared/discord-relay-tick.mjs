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

export class RateLimited extends Error {}

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

    return {
        token,
        guildId,
        supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
        channels: { character: channelId },
        webhooks: { character: webhookUrl },
    };
}

export function makeDiscord(fetchImpl, token) {
    async function call(method, url, { body = null, bot = true, okStatuses = [] } = {}) {
        const headers = { 'User-Agent': 'DiscordBot (https://dogslamloop.com, 1.0)' };
        if (bot) headers.Authorization = `Bot ${token}`;
        if (body) headers['Content-Type'] = 'application/json';

        const res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        if (res.status === 429) throw new RateLimited(`Discord asked the relay to slow down (${method} ${url.split('?')[0]})`);
        if (okStatuses.includes(res.status)) return res;
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`Discord answered ${res.status} to ${method}: ${text.slice(0, 200)}`);
            err.status = res.status;
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
    try {
        const payload = core.toDiscordMessage({
            authorName: w.author_name,
            body: w.body,
            imageUrls: (w.images || []).map(p => publicImageUrl(ctx, p)),
            isReply: Boolean(w.parent_id),
            parentAuthor: w.parent_author_name,
            parentBody: w.parent_body,
            link: core.postUrl(w.page_url, w.parent_id || w.post_id),
        });
        const msg = await ctx.discord.webhookSend(webhook, w.discord_thread_id, payload);
        await record('sent', msg && msg.id, null);
        ctx.report.sent++;
    } catch (e) {
        await record('failed', null, String(e.message || e));
        throw e;
    }
}

// --- RULE 2: THE SWEEP ---

async function sweep(ctx) {
    const recent = (await rpc(ctx.db, 'discord_relay_recent')) || [];
    const byThread = new Map();
    for (const row of recent) {
        if (!byThread.has(row.discord_thread_id)) byThread.set(row.discord_thread_id, []);
        byThread.get(row.discord_thread_id).push(row);
    }

    for (const [threadId, rows] of byThread) {
        const oldest = rows.map(r => r.discord_message_id).reduce((a, b) => (core.snowflakeAfter(a, b) ? b : a));
        const after = (BigInt(oldest) - 1n).toString();
        const fetched = await ctx.discord.messagesAfter(threadId, after, SWEEP_LIMIT);
        const { gone, edited } = core.sweepFindings(rows, fetched, SWEEP_LIMIT);

        for (const id of gone) {
            const images = (await rpc(ctx.db, 'discord_relay_gone', { p_discord_message_id: id })) || [];
            // Only the copies the relay made. A wiki author's own uploads stay
            // with the page that owns them.
            const copies = images.filter(p => core.COPIED_IMAGE_PATH.test(p));
            if (copies.length) await ctx.db.storage.from('discord-media').remove(copies);
            ctx.report.gone++;
        }
        for (const e of edited) {
            await rpc(ctx.db, 'discord_relay_edit', { p_discord_message_id: e.id, p_body: e.body });
            ctx.report.edited++;
        }
    }
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
        report: { relay: 'ran', sweep: Boolean(claim.sweep), opened: 0, linked: 0, taken: 0, sent: 0, deleted: 0, skipped: 0, gone: 0, edited: 0, errors: [] },
    };

    try {
        // One request answers "which posts have new messages" for every thread.
        const active = await ctx.discord.activeThreads(cfg.guildId);
        if (claim.sweep) await openCharacterPosts(ctx, active);
        await readDiscord(ctx, active);
        await writeDiscord(ctx);
        if (claim.sweep) await sweep(ctx);
    } catch (e) {
        if (e instanceof RateLimited) ctx.report.rateLimited = true;
        ctx.report.errors.push(String(e.message || e));
    } finally {
        await rpc(db, 'discord_relay_release');
    }
    return ctx.report;
}
