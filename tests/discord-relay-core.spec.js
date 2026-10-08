// The Discord relay's rules (v1.0 batch 1), tested without Discord.
//
// supabase/functions/_shared/discord-relay-core.mjs holds every rule about what
// crosses between the wiki and the Discord forum: names, pings, quotes, markup,
// attachments, and how edits and deletions are found. The Edge Function runs
// it in Deno; this file runs the same module in Node. Spec: V1.0-DEVLOG.md,
// "SPEC 2026-10-04: batch 1".
//
// The last tests are derived from other files: the relay and the thread page
// must agree on what a KLIPY address is, and the relay and the migration on
// what a copied image's path is. A rendering test of either side cannot
// notice the other drifting.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const CORE = pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'discord-relay-core.mjs')).href;

let core;
test.beforeAll(async () => { core = await import(CORE); });

// A snowflake for a moment in time, as Discord mints them.
function flake(ms, seq = 0) {
    return (((BigInt(ms) - 1420070400000n) << 22n) + BigInt(seq)).toString();
}
const T0 = Date.parse('2026-10-04T12:00:00Z');

function member(id, name, extra = {}) {
    return { id, username: name.toLowerCase(), global_name: name, discriminator: '0', ...extra };
}

function message(extra = {}) {
    return {
        id: flake(T0, 1),
        type: 0,
        content: 'hello',
        author: member('111111111111111111', 'Kai'),
        attachments: [],
        embeds: [],
        mentions: [],
        ...extra,
    };
}

test.describe('wiki to Discord', () => {
    test('a webhook name never carries what Discord refuses, and never comes out empty', () => {
        expect(core.webhookName('Real Deptr')).toBe('Real Deptr');
        expect(core.webhookName('DiscordFan')).toBe('Fan');
        expect(core.webhookName('CLYDE')).toBe('Wiki member');
        // Taking one out can join two halves into another.
        expect(core.webhookName('disdiscordcord')).toBe('Wiki member');
        expect(core.webhookName('everyone')).toBe('Wiki member');
        expect(core.webhookName('')).toBe('Wiki member');
        expect(core.webhookName('x'.repeat(120))).toHaveLength(80);
    });

    test('a wiki message pings nobody, whatever it says', () => {
        const out = core.toDiscordMessage({ authorName: 'Kai', body: '@everyone @here <@&123456789> look', link: 'https://x/#post-1' });
        expect(out.allowed_mentions).toEqual({ parse: [] });
        expect(out.username).toBe('Kai');
        expect(out.content).toContain('@everyone');
    });

    test('a masked link shows its address instead of hiding it', () => {
        const out = core.toDiscordMessage({ authorName: 'Kai', body: '[frame data](https://evil.example)', link: 'https://x/#post-1' });
        expect(out.content).toBe('[frame data]\\(https://evil.example)');
    });

    test('a wiki reply opens with a quote of what it answers', () => {
        const out = core.toDiscordMessage({
            authorName: 'Kai', body: 'agreed', isReply: true,
            parentAuthor: 'Real *Deptr*', parentBody: 'Boomcat\nwins   this one', link: 'https://x/#post-1',
        });
        expect(out.content).toBe('> **Real \\*Deptr\\***: Boomcat wins this one\nagreed');
        // A removed parent has no words left to quote.
        const bare = core.toDiscordMessage({ authorName: 'Kai', body: 'ok', isReply: true, parentAuthor: 'Mo', parentBody: '', link: 'l' });
        expect(bare.content).toBe('> replying to **Mo**\nok');
    });

    test('a post too long for Discord is cut, with a link to the rest', () => {
        const link = 'https://dogslamloop.com/characters/Boomcat/#post-abc';
        const out = core.toDiscordMessage({ authorName: 'Kai', body: 'a'.repeat(3500), imageUrls: ['https://img/1.webp'], link });
        expect(out.content.length).toBeLessThanOrEqual(2000);
        expect(out.content).toContain(`read the rest on the wiki: <${link}>`);
        expect(out.content.endsWith('https://img/1.webp')).toBe(true);
    });

    test('the wiki address of a post points at its top-level post', () => {
        expect(core.postUrl('characters/Boomcat/', 'p1')).toBe('https://dogslamloop.com/characters/Boomcat/#post-p1');
        expect(core.postUrl('/characters/Boomcat/', 'p1')).toBe('https://dogslamloop.com/characters/Boomcat/#post-p1');
    });

    test('a character post opens with its name and a link back, and pings nobody', () => {
        const open = core.characterPostOpening({ name: 'Boomcat', url: 'characters/Boomcat/' });
        expect(open.thread_name).toBe('Boomcat');
        expect(open.content).toContain('<https://dogslamloop.com/characters/Boomcat/>');
        expect(open.allowed_mentions).toEqual({ parse: [] });
        expect(core.sameTitle('Disaster Plants', 'disaster-plants')).toBe(true);
        expect(core.sameTitle('Boomcat', 'Vessel')).toBe(false);
        expect(core.sameTitle('', '')).toBe(false);
    });

    // Batch 3.
    test('a wiki edit carries the same words and quote a send would, pings nobody, and no name', () => {
        const args = { authorName: 'Kai', body: '@everyone new words', isReply: true, parentAuthor: 'Mo', parentBody: 'q', link: 'l' };
        const edit = core.toDiscordEdit(args);
        const send = core.toDiscordMessage(args);
        expect(edit.content).toBe(send.content);
        expect(edit.allowed_mentions).toEqual({ parse: [] });
        expect(edit).not.toHaveProperty('username');
    });

    test('a forum post is named the same way when it opens and when it is renamed', () => {
        expect(core.forumPostName('  Best\ncombo?  ')).toBe('Best combo?');
        expect(core.forumPostName('')).toBe('Untitled');
        expect(core.forumPostName('x'.repeat(150))).toHaveLength(100);
        const open = core.forumPostOpening({ title: 'Best\ncombo?', authorName: 'Kai', body: 'b', link: 'l' });
        expect(open.thread_name).toBe(core.forumPostName('Best\ncombo?'));
    });
});

test.describe('Discord to wiki', () => {
    test('only a person\'s own message or reply is copied', () => {
        expect(core.skipReason(message())).toBeNull();
        expect(core.skipReason(message({ type: 19 }))).toBeNull();
        // The relay's own copies come back as webhook messages.
        expect(core.skipReason(message({ webhook_id: '222222222222222222' }))).toBe('webhook');
        expect(core.skipReason(message({ author: member('333333333333333333', 'Bot', { bot: true }) }))).toBe('bot');
        // 18 is "started a thread", 6 a pin.
        expect(core.skipReason(message({ type: 18 }))).toBe('system message');
        expect(core.skipReason(message({ type: 6 }))).toBe('system message');
        expect(core.skipReason({ id: 'x' })).toBe('not a message');
    });

    test('Discord markup becomes words a wiki reader can read', () => {
        const msg = message({
            content: 'hi <@444444444444444444> and <@!555555555555555555>, see <#666666666666666666> <@&777777777777777777> <:boomcat:888888888888888888> <a:spin:999999999999999999> at <t:1790000000:R> via </tierlist:123456789012345678>',
            mentions: [member('444444444444444444', 'Mo'), member('555555555555555555', 'Ana', { global_name: null })],
            sticker_items: [{ name: 'GG' }],
        });
        expect(core.discordText(msg)).toBe(
            'hi @Mo and @ana, see #channel @role :boomcat: :spin: at 2026-09-21 14:13 UTC via /tierlist\n[sticker: GG]'
        );
    });

    test('a reply keeps what it answers; a plain message does not', () => {
        const reply = core.fromDiscordMessage(message({ type: 19, message_reference: { message_id: '123456789012345678' } }));
        expect(reply.replyTo).toBe('123456789012345678');
        const plain = core.fromDiscordMessage(message({ message_reference: { message_id: '123456789012345678' } }));
        expect(plain.replyTo).toBeNull();
        expect(plain.authorName).toBe('Kai');
        expect(plain.authorHandle).toBe('kai');
        expect(core.handleOf({ username: 'old', discriminator: '1234' })).toBe('old#1234');
    });

    test('still images up to 8 MB are copied, four at most, and every other file is named with why', () => {
        const att = (filename, content_type, size) => ({ filename, content_type, size, url: `https://cdn.discordapp.com/attachments/1/2/${filename}` });
        const { images, notes } = core.pickAttachments(message({
            attachments: [
                att('a.png', 'image/png', 1000),
                att('clip.mp4', 'video/mp4', 1000),
                att('huge.png', 'image/png', 9 * 1024 * 1024),
                att('b.jpg', 'image/jpeg', 1000),
                att('c.webp', 'image/webp', 1000),
                att('d.gif', 'image/gif', 1000),
                att('e.png', 'image/png', 1000),
            ],
        }));
        expect(images.map(i => [i.ext, i.index, i.contentType])).toEqual([
            ['png', 0, 'image/png'], ['jpg', 1, 'image/jpeg'], ['webp', 2, 'image/webp'], ['gif', 3, 'image/gif'],
        ]);
        // The owner's wording (v1.0 Part 2), one reason per file.
        expect(notes).toEqual([
            '[clip.mp4 left on Discord: file type not supported]',
            '[huge.png left on Discord: over 8 MB]',
            '[e.png left on Discord: more than 4 images]',
        ]);
        expect(core.imagePath('123456789012345678', 2, 'webp')).toBe('discord/123456789012345678-2.webp');
        expect(core.COPIED_IMAGE_PATH.test('discord/123456789012345678-2.webp')).toBe(true);
        expect(core.COPIED_IMAGE_PATH.test('discord/123456789012345678-4.webp')).toBe(false);
    });

    test('a KLIPY link becomes its GIF, from Discord\'s embed when that is a KLIPY address', () => {
        const page = 'https://klipy.com/gifs/ronaldo-smile-4';
        const media = 'https://static.klipy.com/ii/abc/def/eH5CypZVAuqHLGZ.mp4';
        const msg = message({
            content: `lol ${page}`,
            embeds: [
                { url: page, video: { url: media } },
                // An embed pointing anywhere else is never used.
                { url: 'https://klipy.com/gifs/other-1', video: { url: 'https://evil.example/x.mp4' } },
            ],
        });
        const found = core.klipyFromEmbeds(msg);
        expect([...found]).toEqual([['ronaldo-smile-4', media]]);
        expect(core.wikiBody(msg, found)).toBe(`lol ${media}`);
        expect(core.klipySlugs('a https://klipy.com/gifs/x-1 b https://www.klipy.com/gifs/y-2?z')).toEqual(['x-1', 'y-2']);
        expect(core.klipyPick({ data: { file: { md: { mp4: { url: media } } } } })).toBe(media);
        expect(core.klipyPick({ data: { file: { md: { mp4: { url: 'https://evil.example/a.mp4' } } } } })).toBeNull();
    });

    test('a long Discord message is cut to the wiki\'s 4,000 characters, and says so', () => {
        const cut = core.wikiBody(message({ content: 'a'.repeat(4500) }));
        expect(cut.length).toBeLessThanOrEqual(4000);
        expect(cut.endsWith('\n[Message is cut off, because it is longer than 4000 characters]')).toBe(true);
        expect(cut.startsWith('a'.repeat(3900))).toBe(true);

        // The cut takes words, never the lines naming what stayed on Discord.
        const withFile = core.wikiBody(message({
            content: 'b'.repeat(4500),
            attachments: [{ filename: 'clip.mp4', content_type: 'video/mp4', size: 10, url: 'https://cdn/x' }],
        }));
        expect(withFile.length).toBeLessThanOrEqual(4000);
        expect(withFile.endsWith('[Message is cut off, because it is longer than 4000 characters]\n[clip.mp4 left on Discord: file type not supported]')).toBe(true);

        // A message that fits is left whole, with no line.
        const fits = core.wikiBody(message({ content: 'c'.repeat(3999) }));
        expect(fits).toBe('c'.repeat(3999));
    });

    test('a forward and a poll arrive as a line saying they cannot be shown', () => {
        // A forward is an ordinary message whose words are in a snapshot, so
        // without the line it would be an empty post.
        const forward = message({
            content: '',
            message_reference: { type: 1, channel_id: '123456789012345678', message_id: '123456789012345679' },
            message_snapshots: [{ message: { content: 'from somewhere else', attachments: [] } }],
        });
        expect(core.wikiBody(forward)).toBe('[Forwarded message cannot be shown, not supported]');
        expect(core.fromDiscordMessage(forward).replyTo, 'a forward is not a reply').toBeNull();

        const poll = message({ content: '', poll: { question: { text: 'Best M1?' }, answers: [] } });
        expect(core.wikiBody(poll)).toBe('[Poll cannot be shown, not supported]');

        // An ordinary reply carries a reference too, of type 0 or none.
        expect(core.wikiBody(message({ type: 19, content: 'yes', message_reference: { message_id: '123456789012345678' } }))).toBe('yes');
    });
});

test.describe('snowflakes', () => {
    test('compare as numbers, never as text', () => {
        expect(core.snowflakeAfter('10', '9')).toBe(true);
        expect(core.snowflakeAfter('1234567890123456789', '1234567890123456788')).toBe(true);
        expect(core.maxSnowflake(['9', '100', '20'])).toBe('100');
        expect(core.sortById([{ id: '100' }, { id: '9' }]).map(m => m.id)).toEqual(['9', '100']);
        expect(core.snowflakeTime(flake(T0))).toBe(T0);
    });
});

test.describe('the sweep', () => {
    const a = flake(T0, 1), b = flake(T0, 2), c = flake(T0, 3), d = flake(T0, 4);

    test('a copied message missing from a complete read is gone', () => {
        const recent = [{ discord_message_id: a, direction: 'from_discord', body: 'x' }, { discord_message_id: b, direction: 'to_discord', body: 'y' }];
        const out = core.sweepFindings(recent, [message({ id: b })], 100);
        expect(out.gone).toEqual([a]);
    });

    test('a read that hit its limit only vouches for the span it returned', () => {
        // The read returned b..c and was full, so a (before it) and d (after it)
        // are unknown, not gone.
        const recent = [a, b, d].map(id => ({ discord_message_id: id, direction: 'from_discord', body: 'hello' }));
        const out = core.sweepFindings(recent, [message({ id: b }), message({ id: c })], 2);
        expect(out.gone).toEqual([]);
        const inside = core.sweepFindings([{ discord_message_id: b, direction: 'from_discord', body: 'hello' }], [message({ id: a }), message({ id: c })], 2);
        expect(inside.gone).toEqual([b]);
    });

    test('an edit on Discord is followed; a wiki post\'s copy is never edited back', () => {
        const recent = [
            { discord_message_id: a, direction: 'from_discord', body: 'old words' },
            { discord_message_id: b, direction: 'to_discord', body: 'wiki words' },
            { discord_message_id: c, direction: 'from_discord', body: 'same' },
        ];
        const fetched = [
            message({ id: a, content: 'new words', edited_timestamp: '2026-10-04T12:05:00Z' }),
            message({ id: b, content: 'changed?', edited_timestamp: '2026-10-04T12:05:00Z' }),
            // Unedited, so never compared, whatever its text.
            message({ id: c, content: 'different' }),
        ];
        expect(core.sweepFindings(recent, fetched, 100).edited).toEqual([{ id: a, body: 'new words' }]);
    });
});

test.describe('the forum', () => {
    const TAGS = [{ id: '300000000000000001', name: ' question ' }, { id: '300000000000000002', name: 'ART' }, { id: 'x', name: 'Guide' }];

    test('a category finds its Discord tag by name, and nothing when the channel has none', () => {
        expect(core.tagIdFor(TAGS, 'Question')).toBe('300000000000000001');
        expect(core.tagIdFor(TAGS, 'Art')).toBe('300000000000000002');
        // A tag whose id is not a snowflake is not used.
        expect(core.tagIdFor(TAGS, 'Guide')).toBeNull();
        expect(core.tagIdFor(TAGS, 'Promotion')).toBeNull();
    });

    test('a Discord post takes its first tag that is a category, spelled the wiki way, else Discussion', () => {
        expect(core.tagFromApplied(['999', '300000000000000002'], [...TAGS, { id: '999', name: 'Off-topic' }])).toBe('Art');
        expect(core.tagFromApplied([], TAGS)).toBe('Discussion');
        expect(core.tagFromApplied(['999'], [{ id: '999', name: 'Off-topic' }])).toBe('Discussion');
        // Following a post already copied in: no fallback, so the category stays.
        expect(core.tagFromApplied([], TAGS, null)).toBeNull();
        expect(core.tagFromApplied(['999'], [{ id: '999', name: 'Off-topic' }], null)).toBeNull();
    });

    test('a wiki forum post opens with its title, its tag, and the same no-ping message', () => {
        const out = core.forumPostOpening({ title: 'Combo\nhelp', tagId: '300000000000000001', authorName: 'Kai', body: '@everyone help', link: 'l' });
        expect(out).toEqual({
            content: '@everyone help', username: 'Kai', allowed_mentions: { parse: [] },
            thread_name: 'Combo help', applied_tags: ['300000000000000001'],
        });
        expect(core.forumPostOpening({ title: '', tagId: null, authorName: 'Kai', body: 'x', link: 'l' }))
            .toMatchObject({ thread_name: 'Untitled' });
        expect(core.forumPostOpening({ title: 't', tagId: null, authorName: 'Kai', body: 'x', link: 'l' }).applied_tags).toBeUndefined();
    });

    test('a message links back to its forum post, or its character page', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        expect(core.wikiLink(`forum:${id}`, null, 'p1')).toBe(`https://dogslamloop.com/forum.html?post=${id}#post-p1`);
        expect(core.wikiLink('boomcat', 'characters/Boomcat/index.html', 'p1')).toBe('https://dogslamloop.com/characters/Boomcat/index.html#post-p1');
        // Not a forum key: never read as one.
        expect(core.wikiLink('forum:../x', 'u/', 'p1')).toBe('https://dogslamloop.com/u/#post-p1');
    });
});

test.describe('agreement with the files the relay sits between', () => {
    test('the six categories match the migration\'s, in both of its places', () => {
        const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261004000002_forum.sql'), 'utf8');
        const check = /forum_threads_tag_check" CHECK \("tag" = ANY \(ARRAY\[([\s\S]*?)\]\)\)/.exec(sql);
        expect(check, 'no tag CHECK in the forum migration').not.toBeNull();
        expect(check[1].match(/'([^']+)'::text/g).map(s => s.slice(1, -7))).toEqual(core.FORUM_TAGS);
        // The functions that check a category by hand list the same six.
        const lists = [...sql.matchAll(/ARRAY\['Question', 'Guide'[^\]]*\]/g)].map(m => m[0]);
        expect(lists.length).toBeGreaterThanOrEqual(3);
        for (const l of lists) expect(l.match(/'([^']+)'/g).map(s => s.slice(1, -1))).toEqual(core.FORUM_TAGS);
        // And the Forum page's own list, which draws the filter and the picker.
        const page = fs.readFileSync(path.join(ROOT, 'js', 'forum.js'), 'utf8');
        const forumList = /const FORUM_TAGS = \[([^\]]+)\];/.exec(page);
        expect(forumList, 'no FORUM_TAGS in js/forum.js').not.toBeNull();
        expect(forumList[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))).toEqual(core.FORUM_TAGS);
    });

    test('KLIPY patterns, key and order match the thread page', () => {
        const page = fs.readFileSync(path.join(ROOT, 'js', 'discussions.js'), 'utf8');
        const grab = (name) => {
            const m = new RegExp(`const ${name} = (.+);\\n`).exec(page);
            expect(m, `${name} not found in js/discussions.js`).not.toBeNull();
            return m[1];
        };
        expect(grab('KLIPY_MEDIA')).toBe(`/${core.KLIPY_MEDIA.source}/g`);
        expect(grab('KLIPY_PAGE')).toBe(`/${core.KLIPY_PAGE.source}/g`);
        expect(grab('KLIPY_API')).toBe(`'${core.KLIPY_API}'`);
        expect(grab('KLIPY_PICK')).toBe(JSON.stringify(core.KLIPY_PICK).replace(/"/g, "'").replace(/,/g, ', '));
    });

    test('a copied image\'s path and types match the migration', () => {
        const dir = path.join(ROOT, 'supabase', 'migrations');
        const sql = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
            .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

        // The last word on the trigger's rule for a copied image.
        const rules = [...sql.matchAll(/img !~ '(\^discord\/[^']+)'/g)].map(m => m[1]);
        expect(rules.length, 'no discord image rule in the migrations').toBeGreaterThan(0);
        expect(rules[rules.length - 1].replace(/\\\\/g, '\\')).toBe(core.COPIED_IMAGE_PATH.source.replace(/\\\//g, '/'));

        const bucket = /VALUES \('discord-media'[^;]*?ARRAY\[([^\]]+)\]/.exec(sql);
        expect(bucket, 'no discord-media bucket in the migrations').not.toBeNull();
        const types = bucket[1].match(/'[^']+'/g).map(s => s.slice(1, -1)).sort();
        expect(types).toEqual(Object.keys(core.IMAGE_TYPES).sort());
        expect(/VALUES \('discord-media', 'discord-media', true, (\d+)/.exec(sql)[1]).toBe(String(core.IMAGE_MAX_BYTES));
    });

    // Found live, 2026-10-04: "Template & Guide" is a `character` page filed
    // under "Site Info", and got a Discord post of its own. A character is
    // whatever the sidebar colours as one.
    test('the characters given a Discord post are the sidebar\'s Characters', () => {
        const sidebar = fs.readFileSync(path.join(ROOT, 'js', 'pagebuilder.js'), 'utf8');
        const word = /category === '([^']+)' && window\.CHARACTER_COLORS/.exec(sidebar);
        expect(word, 'the sidebar\'s character test not found in js/pagebuilder.js').not.toBeNull();

        const dir = path.join(ROOT, 'supabase', 'migrations');
        const defs = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
            .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
            .flatMap(sql => [...sql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."discord_relay_missing_threads"\(\)[\s\S]*?\n\$\$;/g)].map(m => m[0]));
        expect(defs.length, 'discord_relay_missing_threads not defined in the migrations').toBeGreaterThan(0);
        expect(defs[defs.length - 1]).toContain(`sp.category = '${word[1]}'`);
    });
});

// Batch 4: Discord roles follow the wiki. Spec: V1.0-DEVLOG.md, "SPEC
// 2026-10-05: batch 4", D2.
test.describe('roles', () => {
    const GUILD = '100000000000000001';
    const role = (id, name, position, extra = {}) => ({ id, name, position, permissions: '0', managed: false, ...extra });
    const SERVER = [
        role(GUILD, '@everyone', 0),
        role('11', 'Boomcat', 9),
        role('12', 'DSL Relay', 8, { managed: true, permissions: String(1n << 28n) }),
        role('13', 'Admin of DSL', 7),
        role('14', 'Reviewer of DSL', 6),
        role('15', 'Trusted Editor of DSL', 5),
        role('16', 'Moderation Perms', 4),
        role('17', 'Honored One Expert', 3),
        role('18', 'Head of the Hei Expert', 2),
    ];
    const PAGES = [
        { page_id: 'honored_one', name: 'Honored One' },
        { page_id: 'head_of_the_hei', name: 'Head of the Hei' },
        { page_id: 'boomcat', name: 'Boomcat' },
    ];

    // Derived: a role added to the wiki's ladder must be given a Discord
    // answer (a role, or a stated "never synced"), and the relay must not
    // answer for a role the ladder does not have.
    test('every wiki role has an answer, from role_rank() in the migrations', () => {
        const dir = path.join(ROOT, 'supabase', 'migrations');
        const defs = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
            .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
            .flatMap(sql => [...sql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."role_rank"\([\s\S]*?\n\$\$;/g)].map(m => m[0]));
        expect(defs.length, 'role_rank not defined in the migrations').toBeGreaterThan(0);
        const ladder = [...defs[defs.length - 1].matchAll(/WHEN '([a-z_]+)'/g)].map(m => m[1]).sort();
        expect(ladder.length).toBeGreaterThan(3);
        expect([...Object.keys(core.RANK_ROLES), ...core.UNSYNCED_ROLES].sort()).toEqual(ladder);
    });

    test('what the wiki gives: a rank role, the Moderate tick, each expertise; the owner no rank role; a ban nothing', () => {
        expect(core.wantedRoles({ role: 'reviewer', can_moderate: true, expert_pages: ['vessel'] }))
            .toEqual(['reviewer', 'moderate', 'expert:vessel']);
        expect(core.wantedRoles({ role: 'trusted_editor', can_moderate: false, expert_pages: [] })).toEqual(['trusted_editor']);
        expect(core.wantedRoles({ role: 'owner', can_moderate: true, expert_pages: ['vessel'] })).toEqual(['moderate', 'expert:vessel']);
        expect(core.wantedRoles({ role: null, can_moderate: false, expert_pages: ['vessel'] })).toEqual(['expert:vessel']);
        expect(core.wantedRoles({ role: 'viewer', can_moderate: true, expert_pages: ['vessel'] })).toEqual([]);
    });

    test('roles are found by name ignoring case, spaces and punctuation, then kept by id', () => {
        const first = core.resolveRoleMap({ serverRoles: SERVER, saved: [], pages: PAGES });
        expect(first.ids).toEqual({
            admin: '13', reviewer: '14', trusted_editor: '15', moderate: '16',
            'expert:honored_one': '17', 'expert:head_of_the_hei': '18',
        });
        expect(first.matched.map(m => m.key)).toEqual(Object.keys(first.ids));
        expect(first.forgotten).toEqual([]);

        // Renamed on Discord: kept. Deleted: forgotten, and nothing else takes
        // its id.
        const saved = Object.entries(first.ids).map(([key, discord_role_id]) => ({ key, discord_role_id }));
        const renamed = SERVER.filter(r => r.id !== '16').map(r => (r.id === '14' ? { ...r, name: 'Reviewers' } : r));
        const again = core.resolveRoleMap({ serverRoles: renamed, saved, pages: PAGES });
        expect(again.ids.reviewer).toBe('14');
        expect(again.forgotten).toEqual(['moderate']);
        expect(again.ids.moderate).toBeUndefined();
        expect(again.matched).toEqual([]);

        // Found by name in another spelling.
        const loose = core.resolveRoleMap({ serverRoles: [role('20', 'head of the hei  EXPERT', 2)], saved: [], pages: PAGES });
        expect(loose.ids).toEqual({ 'expert:head_of_the_hei': '20' });
    });

    test('a name two roles share, or a role an integration owns, matches nothing', () => {
        const twice = core.resolveRoleMap({
            serverRoles: [role('21', 'Moderation Perms', 4), role('22', 'moderation perms', 3), role('23', 'Admin of DSL', 7, { managed: true })],
            saved: [], pages: [],
        });
        expect(twice.ids).toEqual({});
        expect(twice.ambiguous).toEqual(['Moderation Perms']);
    });

    test('the bot gives roles only with Manage Roles (or Administrator), and only below its highest role', () => {
        expect(core.botRoleReach(SERVER, ['12'], GUILD)).toEqual({ canManage: true, top: 8 });
        // From @everyone counts too.
        const everyone = SERVER.map(r => (r.id === GUILD ? { ...r, permissions: String(1n << 28n) } : { ...r, permissions: '0' }));
        expect(core.botRoleReach(everyone, ['12'], GUILD).canManage).toBe(true);
        const admin = SERVER.map(r => (r.id === '12' ? { ...r, permissions: String(1n << 3n) } : r));
        expect(core.botRoleReach(admin, ['12'], GUILD).canManage).toBe(true);
        // Every other bit below Manage Roles, Administrator (bit 3) excepted.
        const none = SERVER.map(r => (r.id === '12' ? { ...r, permissions: String(((1n << 28n) - 1n) & ~(1n << 3n)) } : r));
        expect(core.botRoleReach(none, ['12'], GUILD).canManage).toBe(false);

        expect(core.canGiveRole(role('30', 'x', 7), 8)).toBe(true);
        expect(core.canGiveRole(role('30', 'x', 8), 8)).toBe(false);
        expect(core.canGiveRole(role('30', 'x', 9), 8)).toBe(false);
        expect(core.canGiveRole(role('30', 'x', 1, { managed: true }), 8)).toBe(false);
        expect(core.canGiveRole(undefined, 8)).toBe(false);
    });

    const IDS = { admin: 'A', reviewer: 'R', trusted_editor: 'T', moderate: 'M', 'expert:vessel': 'V', 'expert:honored_one': 'H' };

    test('the first run adds what the wiki gives and takes nothing, even from a banned person', () => {
        expect(core.roleChanges({ wanted: ['reviewer', 'moderate'], synced: null, taken: [], banned: false, current: null, ids: IDS }))
            .toEqual({ add: ['R', 'M'], remove: [], synced: ['moderate', 'reviewer'], taken: [] });
        expect(core.needsMemberRoles({ role: 'viewer', synced: null })).toBe(false);
        expect(core.roleChanges({ wanted: [], synced: null, taken: [], banned: true, current: null, ids: IDS }))
            .toEqual({ add: [], remove: [], synced: [], taken: [] });
    });

    test('a change applies only itself: what the wiki newly gives is added, what it stopped giving removed', () => {
        expect(core.roleChanges({
            wanted: ['admin', 'moderate', 'expert:vessel'], synced: ['moderate', 'reviewer'], taken: [], banned: false, current: null, ids: IDS,
        })).toEqual({ add: ['A', 'V'], remove: ['R'], synced: ['admin', 'expert:vessel', 'moderate'], taken: [] });
        // Nothing changed: nothing asked of Discord, whatever it shows.
        expect(core.roleChanges({ wanted: ['reviewer'], synced: ['reviewer'], taken: [], banned: false, current: null, ids: IDS }))
            .toEqual({ add: [], remove: [], synced: ['reviewer'], taken: [] });
    });

    test('a ban takes every known role the member holds and remembers the hand-given ones; lifting it gives them back', () => {
        expect(core.needsMemberRoles({ role: 'viewer', synced: ['reviewer'] })).toBe(true);
        expect(core.needsMemberRoles({ role: 'reviewer', synced: ['reviewer'] })).toBe(false);
        const ban = core.roleChanges({
            wanted: [], synced: ['reviewer', 'expert:honored_one'], taken: [], banned: true,
            current: ['R', 'H', 'V', 'someone-elses-role'], ids: IDS,
        });
        expect(ban).toEqual({ add: [], remove: ['R', 'V', 'H'], synced: [], taken: ['expert:vessel'] });

        const lifted = core.roleChanges({
            wanted: ['trusted_editor', 'expert:honored_one'], synced: [], taken: ['expert:vessel'], banned: false, current: null, ids: IDS,
        });
        expect(lifted).toEqual({ add: ['T', 'H', 'V'], remove: [], synced: ['expert:honored_one', 'trusted_editor'], taken: [] });
    });

    test('a role the bot cannot give is neither given nor counted as given, so the next change gives it', () => {
        const noAdmin = { ...IDS };
        delete noAdmin.admin;
        const out = core.roleChanges({ wanted: ['admin', 'moderate'], synced: [], taken: ['admin'], banned: false, current: null, ids: noAdmin });
        expect(out).toEqual({ add: ['M'], remove: [], synced: ['moderate'], taken: ['admin'] });
    });
});
