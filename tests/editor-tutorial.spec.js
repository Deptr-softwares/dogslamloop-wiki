// v0.19 F2 and F3: the editor tutorial and the Manual of Style.
//
// The thing worth protecting is that NEITHER HOLDS ITS OWN COPY OF THE TEXT.
// Both read the Writing Guide, which the owner edits through the site and
// which is what an edit is actually judged against. A tour that drifted from
// the guide would teach a contributor to write something a reviewer rejects,
// and nothing would report that - it would just look like the guide got
// stricter.
//
// So the steps are DERIVED from the guide's own h3 headings, and these tests
// drive that parse against fixtures shaped like the real section rather than
// asserting a hardcoded list of five. Adding a sixth element to the guide adds
// a sixth step with no code change; a test naming the five would turn that
// into a failure.
const { test, expect } = require('@playwright/test');

// The shape of the real section, read from production 2026-09-20: an "UI"
// preamble, then one h3 per element, an h4 nested inside the first, lists and
// images between them.
const EDITOR_SECTION = {
    sectionTitle: 'How to use the editor?',
    blocks: [
        { type: 'heading', size: 'h3', content: 'UI' },
        { type: 'paragraph', content: 'Depending on the tab that you are editing...' },
        { type: 'image', src: 'https://example.test/shot.webp', caption: 'a screenshot' },
        { type: 'list', items: ['[b]Workspace Header[/b]', '[b]Preview Panel[/b]'] },

        { type: 'heading', size: 'h3', content: '[b]Workspace Header[/b]' },
        { type: 'image', src: 'https://example.test/header.webp' },
        { type: 'paragraph', content: 'In this part, you can spot 6 functions.' },
        { type: 'heading', size: 'h4', content: 'The QA (Quality Assurance)' },
        { type: 'paragraph', content: 'This form has 3 types to choose from.' },
        { type: 'divider' },

        { type: 'heading', size: 'h3', content: '[b]Preview Panel[/b]' },
        { type: 'paragraph', content: 'Shows what you are editing.' },
    ],
};

const UNIVERSAL_RULES = {
    sectionTitle: 'Universal Rules',
    blocks: [
        { type: 'heading', size: 'h3', content: 'Basics' },
        { type: 'list', items: [
            'Try to avoid personal and casual language',
            'Refer to the character as their [b]in-game JJS name[/b] ([s]Yuji[/s], Vessel)',
        ] },
        { type: 'heading', size: 'h3', content: 'Character Pages' },
        { type: 'paragraph', content: 'Do not mention ult in a base kit.' },
        { type: 'heading', size: 'h3', content: 'Ground for Rejection' },
        { type: 'list', items: ['Bad Grammar & Spelling'] },
    ],
};

function guide(sections) {
    return { tabs: [{ tabId: 'basics', sections }] };
}

async function openEditor(page, { descData = guide([EDITOR_SECTION, UNIVERSAL_RULES]), seen = false } = {}) {
    await page.addInitScript(({ descData, seen }) => {
        // The tour and both notices are once-per-browser. A fresh context has
        // empty localStorage, so this is how a RETURNING contributor is
        // simulated.
        try {
            if (seen) window.localStorage.setItem('dsl_editor_tutorial_seen', '1');
            window.localStorage.setItem('dsl_notice_seen_editor', '1');
        } catch (e) { /* private mode - the test still runs */ }

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
                                maybeSingle: async () => ({ data: { desc_data: descData }, error: null }),
                                single: async () => ({ data: { desc_data: descData }, error: null }),
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { descData, seen });

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
}

// --- THE PARSE, which is where the logic is --------------------------------

test('the guide headings become the steps, in the guide order', async ({ page }) => {
    await openEditor(page);

    const steps = await page.evaluate((section) =>
        window.__editorTutorial.buildSteps(section).map(s => ({ title: s.title, selector: s.selector })),
        EDITOR_SECTION);

    expect(steps.map(s => s.title)).toEqual(['UI', 'Workspace Header', 'Preview Panel']);
    // Shortcodes are stripped from the TITLE - a tour about how to write must
    // not be the one place a contributor sees a raw [b].
    expect(steps[1].title).not.toContain('[b]');
});

test('an h4 stays inside its step rather than starting one', async ({ page }) => {
    // "The QA" belongs to the Workspace Header. The owner listed five elements,
    // not six, and the guide nests it deliberately.
    await openEditor(page);

    const steps = await page.evaluate((s) => window.__editorTutorial.buildSteps(s), EDITOR_SECTION);
    const header = steps.find(s => s.title === 'Workspace Header');

    expect(header.body.join('')).toContain('The QA');
    expect(steps.map(s => s.title)).not.toContain('The QA (Quality Assurance)');
});

test('images are skipped', async ({ page }) => {
    // They are screenshots of the editor, and the tour is pointing at the real
    // thing a few pixels away.
    await openEditor(page);
    const steps = await page.evaluate((s) => window.__editorTutorial.buildSteps(s), EDITOR_SECTION);
    expect(JSON.stringify(steps)).not.toContain('example.test');
});

test('each element is mapped to something real in the editor', async ({ page }) => {
    // The mapping is keyed on the guide's own wording, so a heading rename in
    // the guide silently loses its spotlight. This is the test that notices.
    await openEditor(page);

    const missing = await page.evaluate(() => {
        const out = [];
        for (const [heading, selector] of Object.entries(window.__editorTutorial.SPOTLIGHTS)) {
            if (!document.querySelector(selector)) out.push(`${heading} -> ${selector}`);
        }
        return out;
    });

    // .add-block-toolbar is built at runtime by editor-blocks.js and may not be
    // mounted yet, so it is allowed to be absent; nothing else is.
    expect(missing.filter(m => !m.includes('add-block-toolbar'))).toEqual([]);
});

// --- THE TOUR ---------------------------------------------------------------

test('the tour opens, steps forward, and spotlights the element it names', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await openEditor(page);
    await page.evaluate(() => window.startEditorTutorial({ force: true }));

    const box = page.locator('#editor-tutorial .tutorial-box');
    await expect(box).toBeVisible();
    await expect(box.locator('.tutorial-title')).toHaveText('UI');
    await expect(box.locator('.tutorial-progress')).toContainText('Step 1 of 3');

    // "UI" has no spotlight, so the overlay dims everything instead.
    await expect(page.locator('#editor-tutorial')).toHaveClass(/is-centred/);

    await box.locator('[data-tutorial="next"]').click();
    await expect(box.locator('.tutorial-title')).toHaveText('Workspace Header');

    // Now it points at something, and the cut-out is over the real header.
    const aligned = await page.evaluate(() => {
        const hole = document.querySelector('.tutorial-hole');
        const target = document.querySelector('#editor-header');
        if (!hole || hole.classList.contains('hidden')) return null;
        const a = hole.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        // Within the 6px padding the spotlight adds on each side.
        return Math.abs(a.top + 6 - b.top) < 2 && Math.abs(a.left + 6 - b.left) < 2;
    });
    expect(aligned, 'the cut-out sits over #editor-header').toBe(true);

    expect(errors).toEqual([]);
});

test('BACK is disabled on the first step and works after that', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => window.startEditorTutorial({ force: true }));

    const box = page.locator('#editor-tutorial .tutorial-box');
    await expect(box.locator('[data-tutorial="back"]')).toBeDisabled();

    await box.locator('[data-tutorial="next"]').click();
    await expect(box.locator('[data-tutorial="back"]')).toBeEnabled();
    await box.locator('[data-tutorial="back"]').click();
    await expect(box.locator('.tutorial-title')).toHaveText('UI');
});

test('the last step closes the tour instead of running off the end', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => window.startEditorTutorial({ force: true }));

    const box = page.locator('#editor-tutorial .tutorial-box');
    await box.locator('[data-tutorial="next"]').click();
    await box.locator('[data-tutorial="next"]').click();
    await expect(box.locator('[data-tutorial="next"]')).toHaveText('DONE');

    await box.locator('[data-tutorial="next"]').click();
    await expect(page.locator('#editor-tutorial')).toHaveCount(0);
});

test('it runs once per browser, and REWATCH overrides that', async ({ page }) => {
    await openEditor(page, { seen: true });

    const first = await page.evaluate(() => window.startEditorTutorial());
    expect(first, 'a returning contributor is not interrupted').toBe(false);
    await expect(page.locator('#editor-tutorial')).toHaveCount(0);

    const forced = await page.evaluate(() => window.replayEditorTutorial());
    expect(forced).toBe(true);
    await expect(page.locator('#editor-tutorial .tutorial-box')).toBeVisible();
});

test('a guide with no editor section fails quietly on a first visit', async ({ page }) => {
    // An extra nobody asked for. An error box in front of the editor would be
    // worse than no tour.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await openEditor(page, { descData: guide([UNIVERSAL_RULES]) });
    const opened = await page.evaluate(() => window.startEditorTutorial());

    expect(opened).toBe(false);
    await expect(page.locator('#editor-tutorial')).toHaveCount(0);
    expect(errors).toEqual([]);
});

// --- THE MANUAL OF STYLE ----------------------------------------------------

test('the MoS button is in the Workspace Header and opens the modal', async ({ page }) => {
    await openEditor(page);

    const btn = page.locator('#editor-header #btn-style-manual');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveClass(/btn-sys-red/);

    await btn.click();
    await expect(page.locator('#editor-mos-modal')).toBeVisible();
});

test('the modal carries the guide Basics and stops at the next heading', async ({ page }) => {
    // "Character Pages" and "Ground for Rejection" follow Basics in the same
    // section. The owner asked for the Basics.
    await openEditor(page);
    await page.evaluate(() => window.openStyleManual());

    const body = page.locator('#editor-mos-modal .mos-body');
    await expect(body).toContainText('avoid personal and casual language');
    await expect(body).not.toContainText('Bad Grammar');
    await expect(body).not.toContainText('Do not mention ult');
});

test('the guide shortcodes are rendered, not shown raw', async ({ page }) => {
    // "[s]Yuji[/s], Vessel" is the rule demonstrating itself - the
    // strikethrough is the point, and a literal [s] would be the one place the
    // style guide breaks its own style.
    await openEditor(page);
    await page.evaluate(() => window.openStyleManual());

    const body = page.locator('#editor-mos-modal .mos-body');
    await expect(body).not.toContainText('[s]');
    await expect(body.locator('.sc-s')).toHaveCount(1);
    await expect(body.locator('.sc-b')).toHaveCount(1);
});

test('the modal states a language standard the guide does not', async ({ page }) => {
    // The one thing authored in code rather than read from the guide, because
    // the guide states no variety and the owner asked for help with it.
    await openEditor(page);
    await page.evaluate(() => window.openStyleManual());
    await expect(page.locator('#editor-mos-modal .mos-body')).toContainText('American English');
});

test('REWATCH TUTORIAL closes the modal before the tour opens', async ({ page }) => {
    // The tour spotlights the editor BEHIND this modal. Leaving it up would
    // point a cut-out at something covered.
    await openEditor(page);
    await page.evaluate(() => window.openStyleManual());
    await page.locator('[data-mos="rewatch"]').click();

    await expect(page.locator('#editor-mos-modal')).toHaveCount(0);
    await expect(page.locator('#editor-tutorial .tutorial-box')).toBeVisible();
});

test('OK just closes it', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => window.openStyleManual());
    await page.locator('[data-mos="ok"]').click();

    await expect(page.locator('#editor-mos-modal')).toHaveCount(0);
    await expect(page.locator('#editor-tutorial')).toHaveCount(0);
});

test('a hostile guide rule is escaped', async ({ page }) => {
    // The Writing Guide is owner-authored rather than contributor-authored, but
    // it reaches innerHTML like everything else and the standard is escape at
    // every interpolation.
    const hostile = '<img src=x onerror="window.__xss=1">';
    await openEditor(page, {
        descData: guide([EDITOR_SECTION, {
            sectionTitle: 'Universal Rules',
            blocks: [
                { type: 'heading', size: 'h3', content: 'Basics' },
                { type: 'list', items: [hostile] },
            ],
        }]),
    });
    await page.evaluate(() => window.openStyleManual());

    await expect(page.locator('#editor-mos-modal .mos-body')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    expect(await page.locator('#editor-mos-modal img').count()).toBe(0);
});

// --- THE HANDOVER FROM THE v0.18 NOTICE -------------------------------------

test('GOT IT on the editor notice hands over to the tour', async ({ page }) => {
    // The owner's sequence: read the notice, press GOT IT, get shown around.
    await page.addInitScript(() => {
        try { window.localStorage.clear(); } catch (e) { /* private mode */ }
    });
    await openEditor(page, { seen: false });

    // Clear the "seen" flags the harness sets, then fire the notice for real.
    await page.evaluate(() => {
        try { window.localStorage.clear(); } catch (e) { /* ignore */ }
        window.showEditorNotice('editor', { force: true });
    });

    await page.locator('[data-notice-dismiss]').click();
    await expect(page.locator('#editor-tutorial .tutorial-box')).toBeVisible();
});

test('the Media Library notice does NOT hand over', async ({ page }) => {
    // It fires while somebody is mid-task picking a file. A five-step tour of
    // the screen behind that modal is the opposite of helpful.
    await openEditor(page, { seen: false });
    await page.evaluate(() => {
        try { window.localStorage.removeItem('dsl_editor_tutorial_seen'); } catch (e) { /* ignore */ }
        window.showEditorNotice('mediaLibrary', { force: true });
    });

    await page.locator('[data-notice-dismiss]').click();
    await expect(page.locator('#editor-tutorial')).toHaveCount(0);
});

test('a hostile guide paragraph is escaped in the TOUR body too', async ({ page }) => {
    // The MoS modal and the tour body are two separate interpolations of the
    // same guide text. The first falsification of the modal test accidentally
    // broke THIS one instead and nothing went red - which is how it came to
    // light that the tour half had no test at all.
    const hostile = '<img src=x onerror="window.__xss2=1">';
    await openEditor(page, {
        descData: guide([{
            sectionTitle: 'How to use the editor?',
            blocks: [
                { type: 'heading', size: 'h3', content: 'Workspace Header' },
                { type: 'paragraph', content: hostile },
                { type: 'list', items: [hostile] },
            ],
        }, UNIVERSAL_RULES]),
    });
    await page.evaluate(() => window.startEditorTutorial({ force: true }));

    const body = page.locator('#editor-tutorial .tutorial-body');
    await expect(body).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss2), 'no handler ran').toBeUndefined();
    expect(await page.locator('#editor-tutorial img').count()).toBe(0);
});

test('a notice raised during the tour stays clickable, in either order', async ({ page }) => {
    // The bug this exists for, and it was invisible from the call site.
    //
    // The tour is ASYNC - it waits on the Writing Guide fetch before it can
    // draw. So pressing GOT IT starts it, the contributor opens the Media
    // Library while it is still loading, and the tour arrives ON TOP of that
    // notice. The tour box sits exactly where the notice GOT IT button lands,
    // so the notice rendered visible and could not be clicked.
    //
    // Fixed on BOTH sides: a notice pauses a tour that is already open, and a
    // tour that opens while a notice is up opens paused. Pausing from one
    // side only handled one ordering and a probe showed the other still
    // broken.
    await openEditor(page, { seen: false });

    // Order A: tour first, then the notice.
    await page.evaluate(() => window.startEditorTutorial({ force: true }));
    await expect(page.locator('#editor-tutorial .tutorial-box')).toBeVisible();
    await page.evaluate(() => window.showEditorNotice('mediaLibrary', { force: true }));

    const clickable = async () => page.evaluate(() => {
        const btn = document.querySelector('#editor-notice-mediaLibrary [data-notice-dismiss]');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return btn.contains(hit) || hit === btn;
    });

    expect(await clickable(), 'notice on top of an open tour').toBe(true);
    await expect(page.locator('#editor-tutorial')).toHaveClass(/is-paused/);

    // Dismissing it hands the tour back where it left off.
    await page.locator('#editor-notice-mediaLibrary [data-notice-dismiss]').click();
    await expect(page.locator('#editor-tutorial')).not.toHaveClass(/is-paused/);
    await expect(page.locator('#editor-tutorial .tutorial-box')).toBeVisible();
});

test('a tour that opens while a notice is up opens paused', async ({ page }) => {
    // Order B - the one the first fix missed.
    await openEditor(page, { seen: false });

    await page.evaluate(() => window.showEditorNotice('mediaLibrary', { force: true }));
    await expect(page.locator('#editor-notice-mediaLibrary')).toBeVisible();

    await page.evaluate(() => window.startEditorTutorial({ force: true }));
    await expect(page.locator('#editor-tutorial')).toHaveClass(/is-paused/);

    const onTop = await page.evaluate(() => {
        const btn = document.querySelector('#editor-notice-mediaLibrary [data-notice-dismiss]');
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return btn.contains(hit) || hit === btn;
    });
    expect(onTop, 'the notice is still the element at that point').toBe(true);
});
