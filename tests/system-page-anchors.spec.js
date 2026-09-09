// v0.18 F5: in-page anchors work on System-type pages.
//
// WHICH HALF WAS BROKEN, measured before anything was changed. The READER side
// already worked: assignSectionAnchors sweeps the DOM, system section headings
// carry .section-title, so the ids exist and jumpToAnchor reaches them. What
// failed was the PICKER - collectSectionTargets walks the character fields
// (overview, matchups, moveStrategies, the keyed sections) and a system page's
// content is desc.tabs, so inserting an in-page link on one offered exactly one
// target, "Discussion", and none of the sections actually on the page.
//
// THE TEST COMPARES BOTH DIRECTIONS, and that is not belt-and-braces. "Every
// id I offer resolves" and "every section on the page is offered" are different
// claims, and v0.15's section-link picker satisfied the first completely while
// being blind to a third of the site. One fixture drives the real renderer and
// the real picker, so the two cannot be right about different pages.
const { test, expect } = require('@playwright/test');

const SYSTEM_DESC = {
    tabs: [
        {
            tabId: 'basics', tabLabel: 'The Basics',
            sections: [
                {
                    sectionTitle: 'Zzq Getting Started', layout: 'full', width: 100, alignment: 'left',
                    blocks: [
                        { type: 'heading', content: 'Zzq A Minor Heading' },
                        { type: 'paragraph', content: 'body text' },
                    ],
                },
                { sectionTitle: 'Zzq Trading Windows', layout: 'full', width: 100, alignment: 'left', blocks: [] },
            ],
        },
        {
            tabId: 'advanced', tabLabel: 'Advanced',
            sections: [
                { sectionTitle: 'Zzq Frame Traps', layout: 'full', width: 100, alignment: 'left', blocks: [] },
                // Two sections sharing a title, which is what makes the ORDER of
                // the walk matter: the first keeps the clean id and the second
                // is numbered, and the picker has to number them the same way
                // the DOM does or it hands out ids pointing at the wrong one.
                { sectionTitle: 'Zzq Frame Traps', layout: 'full', width: 100, alignment: 'left', blocks: [] },
            ],
        },
    ],
};

function mockPageData(page, desc) {
    return page.addInitScript((desc) => {
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
                                single: async () => ({ data: { desc_data: desc, frame_data: {} }, error: null }),
                            };
                            return chain;
                        };
                        client.auth.getSession = async () => ({ data: { session: null } });
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, desc);
}

async function openSystemPage(page, desc) {
    await mockPageData(page, desc);
    await page.goto('/systems/m1-trading/index.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.collectSectionTargets === 'function');
    await page.waitForTimeout(1200);
}

test('the picker offers the sections that are actually on the page', async ({ page }) => {
    await openSystemPage(page, SYSTEM_DESC);

    const offered = await page.evaluate((desc) => {
        const flat = [];
        window.collectSectionTargets(desc, {}).forEach(t => {
            flat.push({ id: t.id, title: t.title, tabLabel: t.tabLabel });
            (t.children || []).forEach(c => flat.push({ id: c.id, title: c.title, tabLabel: t.tabLabel }));
        });
        return flat;
    }, SYSTEM_DESC);

    const titles = offered.map(o => o.title);
    expect(titles, 'the page offered only Discussion before this').toContain('Zzq Getting Started');
    expect(titles).toContain('Zzq Trading Windows');
    expect(titles).toContain('Zzq Frame Traps');
    expect(titles, 'a block heading inside a section is a minor target')
        .toContain('Zzq A Minor Heading');

    // The tab a target lives in is what the picker groups by, and a system
    // page's tab names are authored per page rather than coming from
    // CHARACTER_TABS - so getting this wrong labels every system target with a
    // raw tabId.
    const started = offered.find(o => o.title === 'Zzq Getting Started');
    expect(started.tabLabel).toBe('The Basics');
    expect(offered.find(o => o.title === 'Zzq Frame Traps').tabLabel).toBe('Advanced');
});

test('every id the picker offers exists on the rendered page', async ({ page }) => {
    // DIRECTION ONE. An offered target that resolves to nothing is a link the
    // contributor inserts and the reader lands nowhere with.
    //
    // THIS TEST PASSES AGAINST THE BROKEN PICKER, and that is the argument for
    // the one below it. Falsified on the pre-fix code, it stayed green: a
    // picker offering only "Discussion" satisfies "everything I offer resolves"
    // completely. It is direction TWO that goes red. Keep both.
    await openSystemPage(page, SYSTEM_DESC);

    const missing = await page.evaluate((desc) => {
        window.assignSectionAnchors();
        const out = [];
        const check = (t) => {
            if (!document.getElementById(t.id)) out.push(`${t.id} (${t.title})`);
            (t.children || []).forEach(check);
        };
        window.collectSectionTargets(desc, {})
            // Discussion is a structural section rendered by the page shell, and
            // is out of scope for the tabs walk this test is about.
            .filter(t => t.id !== 'sec-discussion')
            .forEach(check);
        return out;
    }, SYSTEM_DESC);

    expect(missing, 'the picker named ids the page does not have').toEqual([]);
});

test('every section heading on the page is offered by the picker', async ({ page }) => {
    // DIRECTION TWO, and the one v0.15's picker failed while looking healthy.
    // A section the picker cannot name is a section nobody can link to.
    await openSystemPage(page, SYSTEM_DESC);

    const unoffered = await page.evaluate((desc) => {
        window.assignSectionAnchors();

        const offered = new Set();
        const walk = (t) => { offered.add(t.id); (t.children || []).forEach(walk); };
        window.collectSectionTargets(desc, {}).forEach(walk);

        // Only the headings this fixture authored - the page shell contributes
        // its own, and those are not what the tabs walk is responsible for.
        return [...document.querySelectorAll('.section-title, .wiki-block-heading')]
            .filter(h => h.textContent.trim().startsWith('Zzq'))
            .filter(h => h.id && !offered.has(h.id))
            .map(h => `${h.id} (${h.textContent.trim()})`);
    }, SYSTEM_DESC);

    expect(unoffered, 'a section on the page that nobody can link to').toEqual([]);
});

test('two sections sharing a title are numbered the same way in both', async ({ page }) => {
    // The reason the walk follows RENDERED order rather than any order
    // convenient to the picker. mint() gives the first "Frame Traps"
    // sec-zzq-frame-traps and the second sec-zzq-frame-traps-2, and
    // assignSectionAnchors does the same sweeping the DOM. Walk them in a
    // different order and the ids look right while pointing at the wrong
    // section - which no "does it resolve" check would catch, because both
    // resolve.
    await openSystemPage(page, SYSTEM_DESC);

    const out = await page.evaluate((desc) => {
        window.assignSectionAnchors();
        const offered = window.collectSectionTargets(desc, {})
            .filter(t => t.title === 'Zzq Frame Traps')
            .map(t => t.id);
        const inDom = [...document.querySelectorAll('.section-title')]
            .filter(h => h.textContent.trim() === 'Zzq Frame Traps')
            .map(h => h.id);
        return { offered, inDom };
    }, SYSTEM_DESC);

    expect(out.offered).toHaveLength(2);
    expect(out.offered, 'the picker numbers duplicates in document order')
        .toEqual(out.inDom);
});

test('jumping to a system section reaches it', async ({ page }) => {
    // The reader half. It already worked, and it is asserted here because F5 is
    // only finished if the link a contributor can now insert actually goes
    // somewhere - the two halves were never verified together.
    await openSystemPage(page, SYSTEM_DESC);

    const landed = await page.evaluate(() => {
        window.assignSectionAnchors();
        const target = [...document.querySelectorAll('.section-title')]
            .find(h => h.textContent.trim() === 'Zzq Frame Traps');
        if (!target || !target.id) return { ok: false, why: 'no anchor was assigned' };
        const jumped = window.jumpToAnchor(target.id);
        return { ok: jumped === true, id: target.id };
    });

    expect(landed.ok, `jumpToAnchor refused ${landed.id || ''} ${landed.why || ''}`).toBe(true);
});

test('a character page is unaffected by the system branch', async ({ page }) => {
    // The branch returns early, so this is the check that it returns early for
    // the right pages only. A character page has no desc.tabs and must still
    // walk everything it did before.
    await openSystemPage(page, SYSTEM_DESC);

    const titles = await page.evaluate(() => window.collectSectionTargets({
        overview: [{ type: 'paragraph', content: 'x' }],
        matchups: [{ opponent: 'Vessel', tier: 'even', content: [] }],
    }, {}).map(t => t.title));

    expect(titles).toContain('Character Overview');
    expect(titles).toContain('vs. Vessel');
});
