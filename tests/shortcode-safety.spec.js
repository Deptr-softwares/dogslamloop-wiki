// js/internalstyling.js - the shortcode and auto-highlight engine.
//
// It reads a block's innerHTML, runs string replacements over it, and writes
// the result back. Every value it interpolates comes from PAGE CONTENT, which
// is contributor-submitted - so it is an innerHTML sink with attacker-reachable
// input, the exact case CLAUDE.md's escaping rule is about.
//
// Three holes, found by probing a running page on 2026-08-14 and all live on
// the public site at the time:
//
//   [url=javascript:alert(1)]           -> href that runs on click
//   [url=" onmouseover="...]            -> a real handler on the anchor
//   [color=red" onmouseover="...]       -> the same, one attribute over
//
// A reviewer could not have caught these in a diff: the submission reads as
// the literal text "[url=...]", and the handler only exists after this file
// runs. That is why the tests below assert on the RENDERED DOM rather than on
// the source string.

const { test, expect } = require('@playwright/test');

// Any page that loads the engine. The block is injected rather than saved,
// because what is under test is the renderer, not the submission pipeline.
const PAGE = '/characters/Boomcat/index.html';

async function render(page, source) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    return page.evaluate((raw) => {
        const host = document.createElement('div');
        host.id = 'sc-probe';
        host.className = 'wiki-text';

        // Escaped the way generateHTMLForBlocks escapes authored text, so this
        // is the string the engine really receives. Note what survives: a
        // double quote in a TEXT node reads back out of innerHTML as a plain
        // quote, which is how it reached an attribute in the first place.
        host.innerHTML = String(raw)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();

        return {
            text: host.textContent,
            html: host.innerHTML,
            anchors: Array.from(host.querySelectorAll('a')).map(a => ({
                href: a.getAttribute('href'),
                rel: a.getAttribute('rel'),
                target: a.getAttribute('target'),
            })),
            // Every event-handler attribute the engine produced, anywhere.
            handlers: Array.from(host.querySelectorAll('*')).flatMap(el =>
                Array.from(el.attributes)
                    .filter(at => at.name.toLowerCase().startsWith('on'))
                    .map(at => `${el.tagName.toLowerCase()}[${at.name}]`)),
            colors: Array.from(host.querySelectorAll('.sc-color')).map(el => el.getAttribute('style')),
        };
    }, source);
}

test.describe('links', () => {
    test('a javascript: URL does not become a link', async ({ page }) => {
        const out = await render(page, '[url=javascript:alert(1)]click me[/url]');

        expect(out.anchors).toEqual([]);
        expect(out.html).not.toContain('javascript:');
        // The words survive. Refusing the link should not silently eat the
        // contributor's text.
        expect(out.text).toContain('click me');
    });

    test('data: and vbscript: are refused as well', async ({ page }) => {
        for (const scheme of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'JaVaScRiPt:alert(1)']) {
            const out = await render(page, `[url=${scheme}]x[/url]`);
            expect(out.anchors, scheme).toEqual([]);
        }
    });

    test('a quote in the URL cannot open a new attribute', async ({ page }) => {
        const out = await render(page, '[url=" onmouseover="window.__pwned=1]hover me[/url]');

        // The finding, stated as the thing that must never be true again.
        expect(out.handlers).toEqual([]);
        expect(out.text).toContain('hover me');
    });

    test('an ordinary link still works, and cannot reach back through the opener', async ({ page }) => {
        const out = await render(page, '[url=https://example.com/guide]a guide[/url]');

        expect(out.anchors).toHaveLength(1);
        expect(out.anchors[0].href).toBe('https://example.com/guide');
        // target="_blank" without this hands the opened page a window.opener
        // reference back to the wiki.
        expect(out.anchors[0].target).toBe('_blank');
        expect(out.anchors[0].rel).toBe('noopener noreferrer');
    });

    test('site-relative and fragment links are allowed', async ({ page }) => {
        const out = await render(page,
            '[url=/systems/hud/index.html]hud[/url] [url=#combos]combos[/url]');

        expect(out.anchors.map(a => a.href)).toEqual(['/systems/hud/index.html', '#combos']);
    });
});

test.describe('colours', () => {
    test('a quote in the colour cannot open a new attribute', async ({ page }) => {
        const out = await render(page, '[color=red" onmouseover="window.__pwned=1]tint[/color]');

        expect(out.handlers).toEqual([]);
        expect(out.text).toContain('tint');
    });

    test('an expression that is not a colour drops the tint and keeps the words', async ({ page }) => {
        const out = await render(page, '[color=url(javascript:alert(1))]words[/color]');

        expect(out.colors).toEqual([]);
        expect(out.text).toContain('words');
    });

    test('the colour formats the site actually uses all still render', async ({ page }) => {
        const out = await render(page,
            '[color=#ff0000]a[/color] [color=hsl(0, 80%, 60%)]b[/color] '
            + '[color=rgb(1,2,3)]c[/color] [color=var(--accent-blue)]d[/color] [color=crimson]e[/color]');

        expect(out.colors).toHaveLength(5);
        expect(out.colors[0]).toContain('#ff0000');
        expect(out.colors[1]).toContain('hsl(0, 80%, 60%)');
        expect(out.colors[3]).toContain('var(--accent-blue)');
    });
});

test('no shortcode of any shape produces an event handler', async ({ page }) => {
    // The broad claim, kept separate from the three specific findings: a new
    // shortcode added later has to pass this too.
    const nasty = [
        '[b]x" onclick="1[/b]',
        '[code]y" onerror="1[/code]',
        '[u]z" onfocus="1[/u]',
        '[url=x" onclick="1]a[/url]',
        '[color=#fff" onclick="1]b[/color]',
        '[url=https://ok.test" onclick="1]c[/url]',
    ].join(' ');

    const out = await render(page, nasty);
    expect(out.handlers).toEqual([]);
});

test('formatting shortcodes render as classes, not inline styles', async ({ page }) => {
    // The "dated" half of the owner's item. Every inline style this engine
    // wrote was one more place a value had to be trusted; only the two
    // genuinely dynamic colours stay inline now, and both are validated.
    const out = await render(page, '[b]bold[/b] [i]it[/i] [u]un[/u] [s]st[/s] [code]cd[/code]');

    expect(out.html).toContain('class="sc-b"');
    expect(out.html).toContain('class="sc-i"');
    expect(out.html).toContain('class="sc-code"');
    expect(out.html).not.toContain('style="font-style');
    expect(out.html).not.toContain('style="text-decoration');
});

// --------------------------------------------------------------------------
// WHAT GETS AUTO-HIGHLIGHTED (owner's question, 2026-08-14)
// --------------------------------------------------------------------------
//
// The term list used to be hardcoded here as a second copy of
// FRAME_COLOR_LABELS in site_meta.js, and the copies had drifted: all six
// OVERLAY WINDOW colours existed in WINDOW_COLORS and in the frame-data
// legend, and not one of them was ever highlighted in prose.
//
// It is derived now, so the next colour token added to site_meta.js is
// highlighted the day it lands.

async function highlighted(page, text) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    return page.evaluate((raw) => {
        const host = document.createElement('div');
        host.className = 'wiki-text';
        host.textContent = raw;
        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();
        return Array.from(host.querySelectorAll('.sc-auto')).map(el => el.textContent);
    }, text);
}

test('every overlay window term is highlighted, not just the frame ticks', async ({ page }) => {
    const found = await highlighted(page,
        'Reverse Hitcancel, Melee I-Frames, Bullet I-Frames, Explosion I-Frames, '
        + 'Swarm I-Frames, Complete I-Frames');

    expect(found).toEqual([
        'Reverse Hitcancel', 'Melee I-Frames', 'Bullet I-Frames',
        'Explosion I-Frames', 'Swarm I-Frames', 'Complete I-Frames',
    ]);
});

test('the term list is derived from site_meta, not written out here', async ({ page }) => {
    // The claim that keeps the two from drifting again. Every label the site
    // declares a colour for has to be reachable.
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    const missing = await page.evaluate(() => {
        const labels = window.FRAME_COLOR_LABELS || {};
        const colors = Object.assign({}, window.FRAME_COLORS || {}, window.WINDOW_COLORS || {});
        const out = [];

        Object.keys(colors).forEach(token => {
            const name = labels[token];
            if (!name) { out.push(`${token} (no label)`); return; }

            const host = document.createElement('div');
            host.className = 'wiki-text';
            host.textContent = `before ${name} after`;
            (document.querySelector('main') || document.body).appendChild(host);
            window.applyInternalStyling();
            if (!host.querySelector('.sc-auto')) out.push(name);
        });
        return out;
    });

    expect(missing).toEqual([]);
});

test('a hyphen typed or omitted reaches the same colour', async ({ page }) => {
    // The bug this test exists for: the pattern accepted both spellings while
    // the lookup key kept the hyphen as a space, so "Bullet Iframes" matched
    // the regex, missed the map, and rendered unstyled. Every regex-level
    // assertion still passed.
    for (const spelling of ['Bullet I-Frames', 'Bullet Iframes', 'Bullet I-frames']) {
        const found = await highlighted(page, `x ${spelling} y`);
        expect(found, spelling).toEqual([spelling]);
    }
});

test('a two-word term beats the one-word term inside it', async ({ page }) => {
    // "Extended Recovery" had been rendering as plain "Extended" plus a
    // recovery-coloured "Recovery", because the old code ran a replace per
    // term and "Recovery" came first in the list.
    const found = await highlighted(page, 'Extended Recovery and Block Endlag and Recovery');

    expect(found).toEqual(['Extended Recovery', 'Block Endlag', 'Recovery']);
});

// --------------------------------------------------------------------------
// ALIASES, [noauto], [kbd] AND RANGES (owner's list, 2026-08-14)
// --------------------------------------------------------------------------

test('an alias is coloured as its character and links to that character', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    const out = await page.evaluate(async () => {
        const host = document.createElement('div');
        host.className = 'wiki-text';
        host.textContent = 'Gojo beats Higuruma, and Reggie watches.';
        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();

        // The link pass waits on navigation.json.
        await new Promise(r => setTimeout(r, 600));
        window.linkCharacterMentions();

        return {
            canonical: Array.from(host.querySelectorAll('.sc-char')).map(s => `${s.textContent}=${s.dataset.character}`),
            links: Array.from(host.querySelectorAll('a.sc-char-link')).map(a => a.getAttribute('href')),
        };
    });

    // The alias resolves to the canonical name, which is what carries the
    // colour and what the link is looked up by.
    expect(out.canonical).toEqual([
        'Gojo=Honored One', 'Higuruma=Defense Attorney', 'Reggie=Register',
    ]);
    expect(out.links[0]).toContain('Honored_one');
    expect(out.links[1]).toContain('Defense_attorney');
});

test('a long alias beats the short one inside it', async ({ page }) => {
    const found = await highlighted(page, 'Itadori Yuji and Yuji Itadori and Yuji');
    // Not "Itadori" + a separately-wrapped "Yuji".
    expect(found).toEqual(['Itadori Yuji', 'Yuji Itadori', 'Yuji']);
});

test('[noauto] keeps the words and drops the automatic styling', async ({ page }) => {
    // Register, Active and Misc are ordinary words. This is the author saying
    // "that one is not the character".
    const found = await highlighted(page,
        '[noauto]Register the account[/noauto] but Register is a character.');

    expect(found).toEqual(['Register']);

    const text = await page.evaluate(() =>
        document.querySelector('.wiki-text:last-of-type').textContent);
    expect(text).toContain('Register the account');
});

test('[kbd] renders a real kbd element', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    const keys = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'wiki-text';
        host.innerHTML = 'Press [kbd]M1[/kbd] then [kbd]E[/kbd].';
        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();
        return Array.from(host.querySelectorAll('kbd.sc-kbd')).map(k => k.textContent);
    });

    // <kbd> rather than a styled span, so the meaning reaches a screen reader.
    expect(keys).toEqual(['M1', 'E']);
});

test('a frame range is one neutral span, not a red disadvantage', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    const timings = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'wiki-text';
        host.textContent = 'Active 5-8f, then -3f, then +2f.';
        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();
        return Array.from(host.querySelectorAll('.sc-timing'))
            .map(t => `${t.textContent}|${/hsl\(3,/.test(t.getAttribute('style')) ? 'red' : 'other'}`);
    });

    // The bug: "5-8f" produced a plain "5" and a red "-8f", because the
    // disadvantage rule matched inside the range. Three spans, not four, and
    // the range is not red.
    expect(timings).toEqual(['5-8f|other', '-3f|red', '+2f|other']);
});

test('a mention inside an authored link is not wrapped in a second one', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

    const nested = await page.evaluate(async () => {
        const host = document.createElement('div');
        host.className = 'wiki-text';
        host.innerHTML = '[url=https://example.com/x]read about Gojo[/url]';
        (document.querySelector('main') || document.body).appendChild(host);
        window.applyInternalStyling();
        await new Promise(r => setTimeout(r, 600));
        window.linkCharacterMentions();
        return host.querySelectorAll('a a').length;
    });

    // Nested anchors are invalid HTML and the author already chose a
    // destination for that text.
    expect(nested).toBe(0);
});

test('every page type that renders authored blocks loads the engine', async ({ page }) => {
    // It ran on character pages only, so a system or gallery page showed
    // "[b]bold[/b]" as literal text - authored in the same editor, with the
    // same shortcode buttons.
    for (const url of [
        '/characters/Boomcat/index.html',
        '/systems/hud/index.html',
        '/others/emotes/index.html',
        '/tools/free-submit-tier-list/index.html',
        '/systems/tierlist/index.html',
    ]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const present = await page.evaluate(() => typeof window.applyInternalStyling === 'function');
        expect(present, `${url} does not load the shortcode engine`).toBe(true);
    }
});

test('the styling still happens - the engine was not simply defanged', async ({ page }) => {
    // The failure mode a security fix invites: refuse everything and pass every
    // test above. Frame timings are auto-highlighted with no shortcode at all,
    // so this proves the engine is still doing its job.
    const out = await render(page, 'Startup 5f, then -3f on block.');

    expect(out.html).toContain('sc-auto');
    expect(out.html).toContain('sc-timing');
});
