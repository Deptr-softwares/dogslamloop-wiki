// v0.19 C6: [multicolor=a,b]text[/multicolor].
//
// Carried since v0.12 as "the auto-splitting multicolor text shortcode" and
// deferred four times with no design ever recorded. The owner chose the
// gradient reading on 2026-09-20: sweep from the first stop to the last, one
// span per visible character.
//
// The interesting risks are in the WALK, not the maths. This runs inside the
// shortcode pass, on a half-built HTML string, so three things have to survive
// it untouched: tags produced by nested shortcodes, HTML entities (one
// character to a reader, five to a string index), and the closed colour
// grammar that [color=] already enforces.
const { test, expect } = require('@playwright/test');

// The engine runs on real pages, against the DOM. A page with ordinary styled
// content is the honest place to drive it.
const PAGE = '/characters/Boomcat/index.html';

async function render(page, markup) {
    return page.evaluate((text) => {
        const host = document.createElement('p');
        host.className = 'strategy-paragraph';
        host.textContent = text;
        // Into <main>, because js/internalstyling.js watches that subtree.
        document.querySelector('main').appendChild(host);
        window.applyInternalStyling();
        return host.innerHTML;
    }, markup);
}

test.beforeEach(async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');
});

test('a two-stop gradient sweeps from the first colour to the last', async ({ page }) => {
    const html = await render(page, '[multicolor=#ff0000,#0000ff]ABCDE[/multicolor]');

    const colours = [...html.matchAll(/color:\s*(rgb\([^)]*\))/g)].map(m => m[1]);
    expect(colours).toHaveLength(5);

    // Endpoints are exactly the stops - a gradient that never reaches its own
    // colours is the classic off-by-one here.
    expect(colours[0]).toBe('rgb(255, 0, 0)');
    expect(colours[4]).toBe('rgb(0, 0, 255)');

    // And it is monotonic, not merely different at the ends.
    const reds = colours.map(c => Number(/rgb\((\d+)/.exec(c)[1]));
    for (let i = 1; i < reds.length; i += 1) expect(reds[i]).toBeLessThan(reds[i - 1]);
});

test('a third stop is passed through, not ignored', async ({ page }) => {
    // Two stops is the common case and the easy one to make work by accident.
    const html = await render(page, '[multicolor=#ff0000,#00ff00,#0000ff]ABCDE[/multicolor]');
    const colours = [...html.matchAll(/color:\s*(rgb\([^)]*\))/g)].map(m => m[1]);

    expect(colours[0]).toBe('rgb(255, 0, 0)');
    expect(colours[4]).toBe('rgb(0, 0, 255)');
    // The middle character lands on the middle stop.
    expect(colours[2]).toBe('rgb(0, 255, 0)');
});

test('spaces are left uncoloured and words still hold together', async ({ page }) => {
    const html = await render(page, '[multicolor=#ff0000,#0000ff]AB CD[/multicolor]');
    const colours = [...html.matchAll(/color:\s*rgb\([^)]*\)/g)];

    // Four visible characters, four spans - the space is not one of them.
    expect(colours).toHaveLength(4);
    expect(html).toContain('</span> <span');
});

test('nested markup survives the split', async ({ page }) => {
    // The do-while in applyInternalStyling converts inside-out, so by the time
    // multicolor runs its inner text can already carry tags. Splitting inside
    // one would produce <str<span>ong>.
    const html = await render(page, '[multicolor=#ff0000,#0000ff]A[b]BC[/b]D[/multicolor]');

    expect(html).toContain('<strong class="sc-b">');
    expect(html).not.toMatch(/<str[^>]*<span/);
    // Four visible characters regardless of the markup between them.
    expect([...html.matchAll(/class="sc-mc"/g)]).toHaveLength(4);
});

test('an entity counts as one character, not five', async ({ page }) => {
    // textContent puts a literal & into the DOM, which reads back as &amp;.
    const html = await render(page, '[multicolor=#ff0000,#0000ff]A&B[/multicolor]');

    expect([...html.matchAll(/class="sc-mc"/g)], 'A, & and B').toHaveLength(3);
    // The entity is inside a single span, not sliced across several.
    expect(html).toMatch(/<span class="sc-mc"[^>]*>&amp;<\/span>/);
});

// --- SHORTCODES THAT CONVERT AFTER IT (v1.1) --------------------------------
//
// [noauto] is lifted out after the whole conversion loop and [url] converts
// after [multicolor] inside it. The split wrapped every letter of their tags
// in a span, so neither could find its own tag again and the reader saw
// "[noauto]Startup[/noauto]" printed in gradient colours. The other nesting
// order always worked; both are asserted, so fixing one cannot break the other.

test('[noauto] inside a gradient protects the word and leaves no tag behind', async ({ page }) => {
    const out = await page.evaluate(() => {
        const host = document.createElement('p');
        host.className = 'strategy-paragraph';
        host.textContent = '[multicolor=#ff0000,#0000ff][noauto]Startup[/noauto][/multicolor]';
        document.querySelector('main').appendChild(host);
        window.applyInternalStyling();
        const guard = host.querySelector('.sc-noauto');
        const firstLetter = host.querySelector('.sc-mc');
        return {
            text: host.textContent,
            letters: host.querySelectorAll('.sc-mc').length,
            inGuard: guard ? guard.querySelectorAll('.sc-mc').length : -1,
            first: firstLetter ? firstLetter.style.color : '',
            frameTinted: host.querySelectorAll('.sc-auto').length,
        };
    });

    expect(out.text, 'the reader sees the word, not the tags').toBe('Startup');
    expect(out.letters, 'one gradient span per letter of Startup').toBe(7);
    expect(out.inGuard, 'the gradient sits inside the [noauto] guard').toBe(7);
    expect(out.first).toBe('rgb(255, 0, 0)');
    expect(out.frameTinted, 'Startup is a frame term, and [noauto] kept it plain').toBe(0);
});

test('[noauto=all] inside a gradient leaves no tag behind either', async ({ page }) => {
    const out = await page.evaluate(() => {
        const host = document.createElement('p');
        host.className = 'strategy-paragraph';
        host.textContent = '[multicolor=#ff0000,#0000ff][noauto=all]Startup[/noauto][/multicolor]';
        document.querySelector('main').appendChild(host);
        window.applyInternalStyling();
        const guard = host.querySelector('.sc-noauto-all');
        return { text: host.textContent, inGuard: guard ? guard.querySelectorAll('.sc-mc').length : -1 };
    });
    expect(out.text).toBe('Startup');
    expect(out.inGuard).toBe(7);
});

test('[noauto] around a gradient still works', async ({ page }) => {
    const html = await render(page, '[noauto][multicolor=#ff0000,#0000ff]Startup[/multicolor][/noauto]');
    expect(html).not.toContain('[noauto]');
    expect([...html.matchAll(/class="sc-mc"/g)]).toHaveLength(7);
    expect(html).not.toContain('sc-auto');
});

test('a [url] inside a gradient is a link, with the gradient on its label', async ({ page }) => {
    const out = await page.evaluate(() => {
        const host = document.createElement('p');
        host.className = 'strategy-paragraph';
        host.textContent = '[multicolor=#ff0000,#0000ff]See [url=https://example.com/a]the guide[/url][/multicolor]';
        document.querySelector('main').appendChild(host);
        window.applyInternalStyling();
        const link = host.querySelector('a.wiki-link');
        return {
            text: host.textContent,
            href: link ? link.getAttribute('href') : null,
            label: link ? link.textContent : null,
            labelLetters: link ? link.querySelectorAll('.sc-mc').length : 0,
            letters: host.querySelectorAll('.sc-mc').length,
        };
    });

    expect(out.text).toBe('See the guide');
    expect(out.href).toBe('https://example.com/a');
    expect(out.label).toBe('the guide');
    expect(out.labelLetters, 'the label carries the gradient').toBe('theguide'.length);
    // The sweep counts only what the reader sees, so the URL's own letters
    // are not part of it.
    expect(out.letters).toBe('Seetheguide'.length);
});

test('a gradient inside a [url] still works', async ({ page }) => {
    const html = await render(page, '[url=https://example.com/a][multicolor=#ff0000,#0000ff]Guide[/multicolor][/url]');
    expect(html).toContain('href="https://example.com/a"');
    expect(html).not.toContain('[url');
    expect([...html.matchAll(/class="sc-mc"/g)]).toHaveLength(5);
});

test('a literal bracket in a gradient is still a character', async ({ page }) => {
    // Only the tags of the two later shortcodes pass through whole. Anything
    // else in brackets is text the writer typed, and takes its colour.
    const html = await render(page, '[multicolor=#ff0000,#0000ff][x][/multicolor]');
    expect([...html.matchAll(/class="sc-mc"/g)]).toHaveLength(3);
});

// --- REFUSAL, which is the security half -----------------------------------

test('a stop outside the colour grammar refuses the whole shortcode', async ({ page }) => {
    // [color=] drops the tint and keeps the words. This does the same, but
    // refuses WHOLE: quietly dropping one bad stop of three would silently
    // render a different gradient than the one written, with nothing to show
    // for it.
    const html = await render(page, '[multicolor=#ff0000,red;x:y]ABC[/multicolor]');

    expect(html, 'the words survive').toContain('ABC');
    expect(html, 'no gradient was applied').not.toContain('sc-mc');
    expect(html, 'nothing escaped into a style attribute').not.toContain('x:y');
});

test('a style-attribute escape attempt is refused, not escaped', async ({ page }) => {
    const html = await render(page, '[multicolor=#ff0000,#00f" onmouseover="alert(1)]ABC[/multicolor]');

    expect(html).toContain('ABC');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('sc-mc');
});

test('a single stop is not a gradient and is refused', async ({ page }) => {
    const html = await render(page, '[multicolor=#ff0000]ABC[/multicolor]');
    expect(html).toContain('ABC');
    expect(html).not.toContain('sc-mc');
});

// --- THE GRAMMAR IT SHARES WITH [color=] -----------------------------------

test('named colours and var() work, because [color=] accepts them', async ({ page }) => {
    // These cannot be parsed numerically without the browser, which is why the
    // stops are resolved through a probe element rather than by reading hex.
    // Accepting fewer colours here than [color=] accepts would be a difference
    // nobody could guess from the outside.
    const named = await render(page, '[multicolor=red,blue]ABC[/multicolor]');
    expect(named).toContain('sc-mc');
    expect(named).toContain('rgb(255, 0, 0)');

    const cssVar = await render(page, '[multicolor=var(--accent-blue),#ffffff]ABC[/multicolor]');
    expect(cssVar, 'a custom property resolved against :root').toContain('sc-mc');
});

test('the probe leaves nothing behind in the layout', async ({ page }) => {
    await render(page, '[multicolor=red,blue]ABC[/multicolor]');

    const probe = await page.evaluate(() => {
        const all = [...document.documentElement.children].filter(el => el.tagName === 'SPAN');
        if (!all.length) return { count: 0 };
        const el = all[0];
        const r = el.getBoundingClientRect();
        return { count: all.length, w: r.width, h: r.height, hidden: el.getAttribute('aria-hidden') };
    });

    // One probe, reused - not one per shortcode - and it takes no space and is
    // out of the accessibility tree.
    expect(probe.count).toBeLessThanOrEqual(1);
    if (probe.count === 1) {
        expect(probe.w).toBe(0);
        expect(probe.h).toBe(0);
        expect(probe.hidden).toBe('true');
    }
});

test('styling twice does not double-wrap', async ({ page }) => {
    // applyInternalStyling runs on a MutationObserver and can see the same
    // block again. The is-styled guard is what stops the conversion eating its
    // own output; a second pass over already-split text would wrap every span
    // in another span.
    const html = await page.evaluate(() => {
        const host = document.createElement('p');
        host.className = 'strategy-paragraph';
        host.textContent = '[multicolor=#ff0000,#0000ff]ABCDE[/multicolor]';
        document.querySelector('main').appendChild(host);
        window.applyInternalStyling();
        window.applyInternalStyling();
        return host.innerHTML;
    });

    expect([...html.matchAll(/class="sc-mc"/g)]).toHaveLength(5);
    expect(html).not.toMatch(/<span class="sc-mc"[^>]*><span class="sc-mc"/);
});

// --- WHAT THE FOOTER'S GRADIENT PRESETS INSERT ----------------------------
//
// The buttons themselves are tested in tests/color-presets.spec.js, which owns
// that popup and has the harness for it. This is the other half: that what
// those buttons write is something this engine actually renders. Testing only
// the insert would pass against an engine that had never heard of
// [multicolor], which is exactly the state this repo was in an hour ago.

test('what a gradient preset inserts renders as a gradient', async ({ page }) => {
    const html = await render(page, '[multicolor=#a855f7,#22d3ee]Domain Expansion[/multicolor]');

    const colours = [...html.matchAll(/color:\s*(rgb\([^)]*\))/g)].map(m => m[1]);
    expect(colours.length, 'one span per visible character').toBe('DomainExpansion'.length);
    expect(colours[0]).toBe('rgb(168, 85, 247)');
    expect(colours[colours.length - 1]).toBe('rgb(34, 211, 238)');
});
