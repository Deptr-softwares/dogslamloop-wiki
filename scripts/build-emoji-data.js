#!/usr/bin/env node
/**
 * Builds data/emoji.json, the standard emojis the post box's EMOJI picker
 * offers (v1.1, batch 8.5).
 *
 * The list is Unicode's own emoji-test.txt, at the version the Twemoji art
 * covers, cut to what Twemoji has a picture for, so the picker never offers an
 * emoji that draws as a broken image. The owner picked Discord's look for
 * every emoji in posts (2026-10-21), and Discord draws Twemoji.
 *
 * Kept out: skin tone variants (the picker has no tone chooser; a tone typed
 * from a phone keyboard still draws, js/emoji.js), and the Component group
 * (bare tone swatches and hair pieces, which are parts, not emojis).
 *
 * Not part of the nightly regeneration: both sources are pinned, so the output
 * only changes when TWEMOJI_VERSION does. Moving it means moving the version
 * in js/emoji.js too (a test checks they agree), then running this.
 *
 *   node scripts/build-emoji-data.js
 */
const fs = require('fs');
const path = require('path');

const TWEMOJI_VERSION = '17.0.3';
const UNICODE_VERSION = '17.0';
const EMOJI_TEST = `https://www.unicode.org/Public/${UNICODE_VERSION}.0/emoji/emoji-test.txt`;
const TWEMOJI_FILES = `https://data.jsdelivr.com/v1/packages/gh/jdecked/twemoji@${TWEMOJI_VERSION}?structure=flat`;
const OUT = path.join(__dirname, '..', 'data', 'emoji.json');

const TONE = /[\u{1F3FB}-\u{1F3FF}]/u;

// Twemoji's own file naming (grabTheRightIcon in twemoji's source): the code
// points in lowercase hex joined by '-', with U+FE0F dropped unless the
// sequence has a zero width joiner. One file breaks that rule (eye in speech
// bubble is 1f441-200d-1f5e8), so the name without any U+FE0F is the second
// try. js/emoji.js names files the same way, in the same order.
const hex = (text) => Array.from(text).map(c => c.codePointAt(0).toString(16)).join('-');
function twemojiNames(text) {
    const stripped = hex(text.replace(/\uFE0F/g, ''));
    return text.includes('\u200D') ? [hex(text), stripped] : [stripped];
}

function parse(text) {
    const groups = [];
    let group = null;
    for (const line of text.split('\n')) {
        const heading = /^# group: (.+)$/.exec(line);
        if (heading) {
            group = { name: heading[1].trim(), emoji: [] };
            groups.push(group);
            continue;
        }
        // 1F600 ; fully-qualified # 😀 E1.0 grinning face
        const row = /^[0-9A-F ]+;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/.exec(line);
        if (row && group) group.emoji.push([row[1], row[2].trim()]);
    }
    return groups;
}

async function get(url, as) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return as === 'json' ? res.json() : res.text();
}

async function main() {
    const [text, listing] = await Promise.all([get(EMOJI_TEST, 'text'), get(TWEMOJI_FILES, 'json')]);
    const drawn = new Set(listing.files
        .map(f => /^\/assets\/svg\/(.+)\.svg$/.exec(f.name))
        .filter(Boolean)
        .map(m => m[1]));
    if (drawn.size < 1000) throw new Error(`Twemoji ${TWEMOJI_VERSION} lists only ${drawn.size} pictures; not writing.`);

    let missing = 0;
    const groups = parse(text)
        .filter(g => g.name !== 'Component')
        .map(g => ({
            name: g.name,
            emoji: g.emoji.filter(([char]) => {
                if (TONE.test(char)) return false;
                if (twemojiNames(char).some(name => drawn.has(name))) return true;
                missing++;
                return false;
            }),
        }))
        .filter(g => g.emoji.length);

    // One emoji a line, so a version bump reads as a diff.
    const lines = groups.map(g => [
        `    { "name": ${JSON.stringify(g.name)}, "emoji": [`,
        g.emoji.map(e => `        ${JSON.stringify(e)}`).join(',\n'),
        '    ] }',
    ].join('\n'));
    const out = `{\n  "unicode": ${JSON.stringify(UNICODE_VERSION)},\n  "twemoji": ${JSON.stringify(TWEMOJI_VERSION)},\n  "groups": [\n${lines.join(',\n')}\n  ]\n}\n`;
    fs.writeFileSync(OUT, out);

    const count = groups.reduce((n, g) => n + g.emoji.length, 0);
    console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${count} emojis in ${groups.length} groups${missing ? `, ${missing} left out with no Twemoji picture` : ''}.`);
}

main().catch(e => {
    console.error(e.message || e);
    process.exit(1);
});
