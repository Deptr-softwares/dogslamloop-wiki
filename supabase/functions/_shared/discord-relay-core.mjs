// The Discord relay's rules, as plain functions (v1.0 batch 1).
//
// Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 1". The numbered rules there
// are cited below as "rule N".
//
// No Deno, no browser, no network in this file. The Edge Function imports it
// in Deno, and tests/discord-relay-core.spec.js imports the same file in Node,
// so every rule about what crosses between the wiki and Discord is tested
// without either of them. `.mjs` because the repo's own JavaScript is
// CommonJS to Node; the extension makes this one a module in both runtimes.

export const SITE_ORIGIN = 'https://dogslamloop.com';

// Discord's limit for one message, and the wiki's for one post.
export const DISCORD_MAX = 2000;
export const WIKI_MAX = 4000;

// Rule 6: still images up to 8 MB, at most 4 per message, the site's own count.
export const MAX_IMAGES = 4;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
export const COPIED_IMAGE_PATH = /^discord\/[0-9]{5,20}-[0-3]\.(png|jpg|webp|gif)$/;

// KLIPY, the same patterns and key as js/discussions.js. A test reads both
// files and fails if they part.
export const KLIPY_MEDIA = /https:\/\/static2?\.klipy\.com\/ii\/[A-Za-z0-9/_-]+\.(gif|webp|mp4)(?![\w./-])/g;
export const KLIPY_MEDIA_EXACT = new RegExp(`^${KLIPY_MEDIA.source}$`);
export const KLIPY_PAGE = /https?:\/\/(?:www\.)?klipy\.com\/gifs\/([A-Za-z0-9-]{1,120})[^\s]*/g;
export const KLIPY_API = 'https://api.klipy.com/api/v1/xdjct5ccuBWrbiAxgyaEgQdKcnFW5LIpjd1glWvPLALxPE6bNDPGsXXJaMPg9Xv7/gifs/';
export const KLIPY_PICK = [['md', 'mp4'], ['hd', 'mp4'], ['sm', 'mp4'], ['md', 'webp'], ['sm', 'webp'], ['md', 'gif']];
export const MAX_GIFS = 4;

const SNOWFLAKE = /^[0-9]{5,20}$/;
const DISCORD_EPOCH = 1420070400000n;

// --- SNOWFLAKES ---
//
// Discord ids are 64-bit and time-ordered. Compared as BigInt, never as
// numbers (they pass 2^53) and never as text ('9' sorts after '10').

export function isSnowflake(id) {
    return typeof id === 'string' && SNOWFLAKE.test(id);
}

export function snowflakeTime(id) {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function snowflakeAfter(a, b) {
    return BigInt(a) > BigInt(b);
}

export function maxSnowflake(ids) {
    return ids.reduce((best, id) => (best === null || snowflakeAfter(id, best) ? id : best), null);
}

export function sortById(messages) {
    return [...messages].sort((x, y) => (snowflakeAfter(x.id, y.id) ? 1 : snowflakeAfter(y.id, x.id) ? -1 : 0));
}

// --- WIKI TO DISCORD ---

// A webhook's name: 1 to 80 characters, never containing "clyde" or "discord"
// in any case (Discord's rule, checked 2026-10-04). Removed until none is left,
// since taking one out can join two halves into another. A name with nothing
// left falls back rather than losing the message (spec, "Checked 2026-10-04").
export function webhookName(name) {
    let s = String(name == null ? '' : name);
    let before;
    do {
        before = s;
        s = s.replace(/clyde|discord/gi, '');
    } while (s !== before);
    s = s.replace(/\s+/g, ' ').trim().slice(0, 80).trim();
    if (!s || /^(everyone|here)$/i.test(s)) return 'Wiki member';
    return s;
}

// Markdown a wiki writer did not mean as markup on Discord. A masked link,
// [label](url), shows only its label, so a wiki post could dress one address
// as another. Breaking the "](" keeps every character visible.
export function neutralize(text) {
    return String(text == null ? '' : text).replace(/\]\(/g, ']\\(');
}

function escapeMarkdown(text) {
    return String(text == null ? '' : text).replace(/([\\*_~`|>])/g, '\\$1');
}

function oneLine(text, max) {
    const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// A wiki reply cannot be a Discord reply (Execute Webhook has no
// message_reference), so it opens with a quote of what it answers.
export function quoteLine(parentAuthor, parentBody) {
    const who = escapeMarkdown(oneLine(parentAuthor || 'a post', 60));
    const what = neutralize(escapeMarkdown(oneLine(parentBody, 90)));
    return what ? `> **${who}**: ${what}` : `> replying to **${who}**`;
}

// The address of a post on the wiki. A reply is shown under its top-level
// post, which is the anchor the thread page honours.
export function postUrl(pageUrl, topLevelPostId) {
    const page = String(pageUrl || '').replace(/^\/+/, '');
    return `${SITE_ORIGIN}/${page}#post-${topLevelPostId}`;
}

// --- THE FORUM (batch 2) ---

// The owner's six categories, 2026-10-04, in their order. The same names are
// the tags on #dogslamloop-forum. A test checks them against the migration.
export const FORUM_TAGS = ['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'];
const FORUM_KEY = /^forum:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function forumThreadUrl(threadId) {
    return `${SITE_ORIGIN}/forum.html?post=${threadId}`;
}

// Where a message lives on the wiki: a forum post's page, or a character's.
export function wikiLink(pageId, pageUrl, topLevelPostId) {
    const forum = FORUM_KEY.exec(String(pageId || ''));
    if (forum) return `${forumThreadUrl(forum[1])}#post-${topLevelPostId}`;
    return postUrl(pageUrl, topLevelPostId);
}

const tagKey = (s) => String(s || '').trim().toLowerCase();

// The Discord tag id for a category, by name, from the channel's
// `available_tags`; null when the channel has no tag of that name.
export function tagIdFor(availableTags, tag) {
    const hit = (availableTags || []).find(t => tagKey(t.name) === tagKey(tag));
    return hit && isSnowflake(hit.id) ? hit.id : null;
}

// A Discord post's category: its first tag that is one of the six, spelled the
// wiki's way; Discussion when none is.
//
// `fallback` is for a post with none of the six. A post copied in needs a
// category, so it gets Discussion; a post the sweep is following keeps the
// one it has (null), or an untagged Discord post would overwrite the wiki's
// category with the default (found live, 2026-10-04).
export function tagFromApplied(appliedIds, availableTags, fallback = 'Discussion') {
    const byId = new Map((availableTags || []).map(t => [t.id, t.name]));
    for (const id of appliedIds || []) {
        const match = FORUM_TAGS.find(name => tagKey(name) === tagKey(byId.get(id)));
        if (match) return match;
    }
    return fallback;
}

// A wiki forum post as the webhook payload that opens its Discord post: the
// opening message, the title as the post's name, the category as its tag.
export function forumPostOpening({ title, tagId, authorName, body, imageUrls = [], link }) {
    const msg = toDiscordMessage({ authorName, body, imageUrls, link });
    const out = { ...msg, thread_name: forumPostName(title) };
    if (tagId) out.applied_tags = [tagId];
    return out;
}

// A forum post's name on Discord, when it opens and when it is renamed.
export function forumPostName(title) {
    return oneLine(title, 100) || 'Untitled';
}

// One wiki post as a webhook payload. Rule 8: `allowed_mentions` is always
// empty, so "@everyone" or a role mention typed on the wiki pings nobody.
// Rule 10: over Discord's limit, the words are cut and the full post linked.
export function toDiscordMessage({ authorName, body, imageUrls = [], parentAuthor = null, parentBody = '', isReply = false, link }) {
    const head = isReply ? `${quoteLine(parentAuthor, parentBody)}\n` : '';
    const tail = imageUrls.length ? `\n${imageUrls.join('\n')}` : '';
    let words = neutralize(String(body || '').trim());

    const fits = (w) => head.length + w.length + tail.length <= DISCORD_MAX;
    if (!fits(words)) {
        const more = `… read the rest on the wiki: <${link}>`;
        const room = DISCORD_MAX - head.length - tail.length - more.length - 1;
        words = `${words.slice(0, Math.max(0, room)).trimEnd()}\n${more}`;
    }

    return {
        content: `${head}${words}${tail}`.trim(),
        username: webhookName(authorName),
        allowed_mentions: { parse: [] },
    };
}

// A wiki edit, as the change to the webhook's own message (batch 3): the words
// and quote line a send would carry, and still no pings. The name a webhook
// message was sent under cannot be changed, so it is left out.
export function toDiscordEdit(args) {
    const { content, allowed_mentions } = toDiscordMessage(args);
    return { content, allowed_mentions };
}

// The message that opens a character's Discord post (rule: D3).
export function characterPostOpening({ name, url }) {
    const page = `${SITE_ORIGIN}/${String(url || '').replace(/^\/+/, '')}`;
    return {
        thread_name: oneLine(name, 100),
        content: `Talk about **${escapeMarkdown(oneLine(name, 100))}** here. Messages in this post and in its thread on the wiki show in both places.\n<${page}>`,
        username: 'dogslamloop wiki',
        allowed_mentions: { parse: [] },
    };
}

// Whether an existing Discord post is the one for this character, so linking
// it beats opening a second.
export function sameTitle(a, b) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return norm(a) !== '' && norm(a) === norm(b);
}

// --- DISCORD TO WIKI ---

// Rule 4: why a Discord message is not copied, or null when it is. Only a
// person's plain message or reply: never a webhook (the relay's own copies
// among them), a bot, or a system line such as "started a post".
export function skipReason(msg) {
    if (!msg || !isSnowflake(msg.id)) return 'not a message';
    if (msg.type !== 0 && msg.type !== 19) return 'system message';
    if (msg.webhook_id) return 'webhook';
    if (!msg.author || msg.author.bot) return 'bot';
    if (!isSnowflake(msg.author.id)) return 'no author';
    return null;
}

function displayName(user) {
    return (user && (user.global_name || user.username)) || 'member';
}

// Discord's handle since 2023 is the unique username; an account still
// carrying a #1234 tag shows it.
export function handleOf(user) {
    if (!user || !user.username) return null;
    const tag = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : '';
    return `${user.username}${tag}`.slice(0, 32);
}

function utcStamp(seconds) {
    const d = new Date(Number(seconds) * 1000);
    if (Number.isNaN(d.getTime())) return 'a date';
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// Rule 7: Discord's markup into words a wiki reader can read.
export function discordText(msg) {
    const mentions = new Map((msg.mentions || []).map(u => [u.id, u]));
    let text = String(msg.content || '');

    text = text
        .replace(/<@!?(\d{5,20})>/g, (_, id) => `@${displayName(mentions.get(id))}`)
        .replace(/<@&\d{5,20}>/g, '@role')
        .replace(/<#\d{5,20}>/g, '#channel')
        .replace(/<a?:([A-Za-z0-9_]{1,32}):\d{5,20}>/g, ':$1:')
        .replace(/<t:(-?\d{1,13})(?::[tTdDfFR])?>/g, (_, s) => utcStamp(s))
        .replace(/<\/([\w -]{1,32}):\d{5,20}>/g, '/$1');

    const stickers = (msg.sticker_items || []).map(s => `[sticker: ${oneLine(s.name, 40)}]`);
    return [text.trim(), ...stickers].filter(Boolean).join('\n');
}

// KLIPY GIFs Discord already resolved: its embed of a klipy.com page link
// carries the GIF's own address. Only an address passing the exact pattern is
// used, as on the wiki.
export function klipyFromEmbeds(msg) {
    const found = new Map();
    for (const embed of msg.embeds || []) {
        const page = typeof embed.url === 'string' ? embed.url : '';
        const slug = /klipy\.com\/gifs\/([A-Za-z0-9-]{1,120})/.exec(page);
        if (!slug) continue;
        const media = [embed.video && embed.video.url, embed.image && embed.image.url, embed.thumbnail && embed.thumbnail.url]
            .find(u => typeof u === 'string' && KLIPY_MEDIA_EXACT.test(u));
        if (media) found.set(slug[1], media);
    }
    return found;
}

// The slugs of the KLIPY page links in a text, the first MAX_GIFS of them.
export function klipySlugs(text) {
    const slugs = [];
    for (const m of String(text || '').matchAll(KLIPY_PAGE)) {
        if (!slugs.includes(m[1])) slugs.push(m[1]);
        if (slugs.length >= MAX_GIFS) break;
    }
    return slugs;
}

// Swap each resolved page link for its GIF's own address.
export function applyKlipy(text, mediaBySlug) {
    return String(text || '').replace(KLIPY_PAGE, (whole, slug) => mediaBySlug.get(slug) || whole);
}

// What a KLIPY API answer offers, in the wiki's order of preference, and only
// if it is a KLIPY media address.
export function klipyPick(answer) {
    const file = answer && answer.data && answer.data.file;
    if (!file) return null;
    for (const [size, format] of KLIPY_PICK) {
        const url = file[size] && file[size][format] && file[size][format].url;
        if (typeof url === 'string' && KLIPY_MEDIA_EXACT.test(url)) return url;
    }
    return null;
}

// Rule 6: which attachments are copied, and a line naming each one that is not.
export function pickAttachments(msg) {
    const images = [];
    const notes = [];
    for (const a of msg.attachments || []) {
        const ext = IMAGE_TYPES[String(a.content_type || '').split(';')[0].trim().toLowerCase()];
        if (ext && Number(a.size) <= IMAGE_MAX_BYTES && images.length < MAX_IMAGES && typeof a.url === 'string') {
            images.push({ url: a.url, ext, contentType: Object.keys(IMAGE_TYPES).find(k => IMAGE_TYPES[k] === ext), index: images.length });
        } else {
            notes.push(`[file left on Discord: ${oneLine(a.filename || 'a file', 80)}]`);
        }
    }
    return { images, notes };
}

export function imagePath(messageId, index, ext) {
    return `discord/${messageId}-${index}.${ext}`;
}

// The wiki post's words for a Discord message, before KLIPY lookups and image
// copies. Cut to the wiki's limit, notes included.
export function wikiBody(msg, mediaBySlug = new Map()) {
    const { notes } = pickAttachments(msg);
    const text = applyKlipy(discordText(msg), mediaBySlug);
    return [text, ...notes].filter(Boolean).join('\n').slice(0, WIKI_MAX);
}

// Everything the database needs to copy one Discord message in, or a reason
// it is not copied.
export function fromDiscordMessage(msg) {
    const skip = skipReason(msg);
    if (skip) return { skip };

    const replyTo = msg.type === 19 && msg.message_reference && isSnowflake(msg.message_reference.message_id)
        ? msg.message_reference.message_id
        : null;

    return {
        skip: null,
        discordMessageId: msg.id,
        authorDiscordId: msg.author.id,
        authorName: oneLine(displayName(msg.author), 80),
        authorHandle: handleOf(msg.author),
        replyTo,
        attachments: pickAttachments(msg).images,
        klipyEmbeds: klipyFromEmbeds(msg),
        klipySlugs: klipySlugs(msg.content),
    };
}

// --- THE SWEEP ---
//
// Rule 2: Discord never tells a poller about an edit or a deletion, so the
// last day of copied messages is compared with a fresh read of each thread.
//
// `fetched` is one read of the thread starting after the oldest copied
// message. A copied message that is absent counts as deleted only where that
// read is known to reach: everything when the read came back short of its
// limit, otherwise the span between its oldest and newest message. Anything
// outside is left alone; a deletion missed this minute is found the next.
export function sweepFindings(recent, fetched, limit) {
    const byId = new Map(fetched.map(m => [m.id, m]));
    const ids = fetched.map(m => m.id);
    const complete = fetched.length < limit;
    const low = ids.length ? ids.reduce((a, b) => (snowflakeAfter(a, b) ? b : a)) : null;
    const high = maxSnowflake(ids);

    const gone = [];
    const edited = [];
    for (const row of recent) {
        const seen = byId.get(row.discord_message_id);
        if (!seen) {
            const covered = complete
                || (low !== null && !snowflakeAfter(low, row.discord_message_id) && !snowflakeAfter(row.discord_message_id, high));
            if (covered) gone.push(row.discord_message_id);
            continue;
        }
        if (row.direction === 'from_discord' && seen.edited_timestamp) {
            const body = wikiBody(seen, klipyFromEmbeds(seen));
            if (body !== row.body) edited.push({ id: row.discord_message_id, body });
        }
    }
    return { gone, edited };
}

// --- ROLES (batch 4) ---
//
// Discord roles follow the wiki, one way. Spec: V1.0-DEVLOG.md, "SPEC
// 2026-10-05: batch 4", D2; "role rule N" cites its list.

// Role rule 1: the Discord role each wiki role gives, named as the owner named
// them on the server (2026-10-04). `owner` gives none (Boomcat is never
// synced) and `viewer` is the ban, role rule 3.
export const RANK_ROLES = Object.freeze({
    admin: 'Admin of DSL',
    reviewer: 'Reviewer of DSL',
    trusted_editor: 'Trusted Editor of DSL',
});
export const UNSYNCED_ROLES = Object.freeze(['owner', 'viewer']);
export const MODERATE_ROLE = 'Moderation Perms';

export function expertRoleName(pageName) {
    return `${String(pageName || '').trim()} Expert`;
}

// A name, not a rank: the ban is tested by name everywhere (CLAUDE.md, Roles).
export function isWikiBan(role) {
    return role === 'viewer';
}

// W: the keys the wiki gives a person now.
export function wantedRoles({ role, can_moderate, expert_pages }) {
    if (isWikiBan(role)) return [];
    const keys = [];
    if (Object.prototype.hasOwnProperty.call(RANK_ROLES, role)) keys.push(role);
    if (can_moderate) keys.push('moderate');
    for (const pageId of expert_pages || []) keys.push(`expert:${pageId}`);
    return keys;
}

// Role rule 4: each key's Discord role. One already found is kept by id, so a
// rename on Discord keeps working; one whose id is gone is forgotten; the rest
// are found by name. A name two roles share matches neither.
export function resolveRoleMap({ serverRoles, saved, pages }) {
    const onServer = new Map((serverRoles || []).map(r => [r.id, r]));
    const ids = {};
    const forgotten = [];
    for (const row of saved || []) {
        if (onServer.has(row.discord_role_id)) ids[row.key] = row.discord_role_id;
        else forgotten.push(row.key);
    }

    const names = Object.entries(RANK_ROLES).map(([key, name]) => ({ key, name }));
    names.push({ key: 'moderate', name: MODERATE_ROLE });
    for (const p of pages || []) {
        if (p && p.page_id && String(p.name || '').trim()) names.push({ key: `expert:${p.page_id}`, name: expertRoleName(p.name) });
    }

    const used = new Set(Object.values(ids));
    const matched = [];
    const ambiguous = [];
    for (const { key, name } of names) {
        if (ids[key]) continue;
        const hits = (serverRoles || []).filter(r => !r.managed && !used.has(r.id) && sameTitle(r.name, name));
        if (hits.length > 1) {
            ambiguous.push(name);
        } else if (hits.length === 1) {
            ids[key] = hits[0].id;
            used.add(hits[0].id);
            matched.push({ key, id: hits[0].id, name: hits[0].name });
        }
    }
    return { ids, matched, forgotten, ambiguous };
}

const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

// Role rule 5: whether the bot may give roles at all, and how high. Its
// permissions are @everyone's (the role whose id is the server's) and its own
// roles' together.
export function botRoleReach(serverRoles, botRoleIds, guildId) {
    const own = new Set([guildId, ...(botRoleIds || [])]);
    let perms = 0n;
    let top = 0;
    for (const r of serverRoles || []) {
        if (!own.has(r.id)) continue;
        try { perms |= BigInt(r.permissions || '0'); } catch (_) { /* not a number: adds nothing */ }
        if (r.id !== guildId) top = Math.max(top, Number(r.position) || 0);
    }
    return { canManage: (perms & (MANAGE_ROLES | ADMINISTRATOR)) !== 0n, top };
}

// A role the bot can give: strictly below its highest role, and not one an
// integration owns.
export function canGiveRole(role, top) {
    return Boolean(role) && !role.managed && (Number(role.position) || 0) < top;
}

// Role rules 2 and 3, as one function. Keys in, Discord role ids out.
//
//   wanted   W, the keys the wiki gives now
//   synced   S, the keys the relay last applied; null before the first run
//   taken    keys a ban took that the sync had not given
//   banned   the person holds the wiki ban
//   current  the member's role ids, read for a ban only
//   ids      key -> role id, for the roles the bot can give
//
// Not banned: add W - S and everything taken, remove S - W. Banned: remove
// every role it knows of that the member holds, and remember the ones S did
// not hold. The first run (S null) never takes anything away.
export function roleChanges({ wanted, synced, taken, banned, current, ids }) {
    const can = (k) => Object.prototype.hasOwnProperty.call(ids || {}, k);
    const S = new Set(synced || []);
    const T = new Set(taken || []);

    if (banned) {
        if (synced === null || synced === undefined) {
            return { add: [], remove: [], synced: [], taken: [...T].sort() };
        }
        const held = new Set(current || []);
        const removeKeys = Object.keys(ids || {}).filter(k => held.has(ids[k]));
        for (const k of removeKeys) if (!S.has(k)) T.add(k);
        return { add: [], remove: removeKeys.map(k => ids[k]), synced: [], taken: [...T].sort() };
    }

    const W = new Set(wanted || []);
    const addKeys = new Set([...W].filter(k => !S.has(k)));
    for (const k of T) addKeys.add(k);
    const removeKeys = [...S].filter(k => !W.has(k) && !addKeys.has(k));
    return {
        add: [...addKeys].filter(can).map(k => ids[k]),
        remove: removeKeys.filter(can).map(k => ids[k]),
        synced: [...W].filter(can).sort(),
        taken: [...T].filter(k => !can(k)).sort(),
    };
}

// Whether a ban needs the member's roles read first.
export function needsMemberRoles({ role, synced }) {
    return isWikiBan(role) && synced !== null && synced !== undefined;
}
