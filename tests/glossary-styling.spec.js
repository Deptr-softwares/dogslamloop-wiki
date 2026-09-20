// The Terminology peek on the Side Dashboard renders shortcodes - v0.19 bug,
// owner 2026-09-20.
//
// Reported as "systems/index.html is missing internalStyling.js". It is not:
// the hub loads that file. The peek simply never used it, in two ways, and
// both had to be fixed:
//
//   1. `applyInternalStyling` matches TARGETS BY CLASS, and the peek rendered
//      <dt class="glossary-term"> / <dd class="glossary-def">, which match
//      none of them. `wiki-text` is the marker for "this is prose, style it";
//      it carries no CSS of its own, so adding it is an opt-in and nothing more.
//   2. Nothing re-runs the pass for content injected after page load, so it
//      has to be called once the peek has rendered.
//
// The same words render correctly on the Terminologies page itself, which is
// what made this look like a missing script rather than a missing call.
const { test, expect } = require('@playwright/test');

// Two characters is enough for the matchup grid beside this widget to render
// without complaining; this file is not about that widget.
const ROSTER = {
    categories: [{ name: 'Characters', pages: [
        { pageId: 'a', name: 'Boomcat', url: '/characters/Boomcat/index.html', type: 'character' },
        { pageId: 'b', name: 'Sukuna', url: '/characters/Sukuna/index.html', type: 'character' },
    ] }],
};

// A term and a definition, each carrying a shortcode, in the shape the peek
// reads: a heading followed by a paragraph.
const TERMINOLOGY = {
    desc_data: {
        tabs: [{
            sections: [{
                blocks: [
                    { type: 'heading', content: '[color=#ff0000]Domain Expansion[/color]' },
                    { type: 'paragraph', content: 'A [b]guaranteed[/b] hit inside the domain.' },
                ],
            }],
        }],
    },
};

async function mockHub(page, { terminology = TERMINOLOGY } = {}) {
    await page.route('**/data/navigation.json*', route => route.fulfill({ json: ROSTER }));

    await page.addInitScript(({ terminology }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        const origFrom = client.from.bind(client);

                        client.from = (table) => {
                            if (table !== 'page_data') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                // The peek calls .maybeSingle(); the matchup
                                // grid beside it awaits the chain directly.
                                // Both are answered so neither widget breaks
                                // the other's test.
                                maybeSingle: async () => ({ data: terminology, error: null }),
                                then(resolve, reject) {
                                    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                                },
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { terminology });
}

test('a shortcode in a term is rendered, not shown as text', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const term = page.locator('.glossary-term').first();
    await expect(term).toBeVisible();

    const out = await page.evaluate(() => {
        const t = document.querySelector('.glossary-term');
        const d = document.querySelector('.glossary-def');
        const probe = document.createElement('span');
        probe.style.color = 'rgb(255, 0, 0)';
        document.body.appendChild(probe);
        const red = getComputedStyle(probe).color;
        probe.remove();
        return {
            termText: t.textContent,
            defText: d.textContent,
            // The rendered CONSEQUENCE, not the class: what the browser painted.
            colouredSpan: !!t.querySelector('span'),
            colour: t.querySelector('span') ? getComputedStyle(t.querySelector('span')).color : null,
            red,
            boldInDef: !!d.querySelector('b, strong'),
        };
    });

    expect(errors).toEqual([]);
    // Asserted as the text READING correctly rather than as "the substring is
    // absent" - the latter passes just as well if the term vanished entirely.
    expect(out.termText).toBe('Domain Expansion');
    expect(out.defText).toBe('A guaranteed hit inside the domain.');
    expect(out.colouredSpan, 'the colour shortcode produced an element').toBe(true);
    expect(out.colour).toBe(out.red);
    expect(out.boldInDef, 'and [b] in the definition became real bold').toBe(true);
});

test('the pass is loaded, and the glossary sits where the observer watches', async ({ page }) => {
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const out = await page.evaluate(() => ({
        // The owner's reading was that the hub does not load
        // internalstyling.js. It does - stated here so that removing the script
        // tag while chasing this fails loudly instead of reproducing the same
        // confusing symptom.
        loaded: typeof window.applyInternalStyling === 'function',
        // And the dependency that makes the peek need no explicit call:
        // internalstyling.js observes <main> with subtree:true and restyles on
        // any added node. Move this section out of <main> and the shortcodes
        // silently go back to being text, with nothing else to show for it.
        insideMain: !!document.querySelector('main .glossary-term'),
    }));

    expect(out.loaded).toBe(true);
    expect(out.insideMain, 'the MutationObserver only watches inside <main>').toBe(true);
});

test('a hostile term is still not markup', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockHub(page, {
        terminology: {
            desc_data: {
                tabs: [{ sections: [{ blocks: [
                    { type: 'heading', content: '<img src=x onerror="window.__PWN=1">' },
                    { type: 'paragraph', content: 'still a definition' },
                ] }] }],
            },
        },
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Honouring shortcodes must not have turned this into an HTML sink. The
    // styling pass runs on ALREADY-ESCAPED html, which is the property that
    // makes [b] safe and <img> not.
    const out = await page.evaluate(() => ({
        fired: !!window.__PWN,
        injected: document.querySelectorAll('.glossary-term img').length,
        text: document.querySelector('.glossary-term')?.textContent || '',
    }));

    expect(errors).toEqual([]);
    expect(out.fired).toBe(false);
    expect(out.injected).toBe(0);
    expect(out.text).toContain('<img');
});
