// v1.1 batch 9: the tab a reader is on lives in the address.
//
// Owner, 2026-10-22: "the site doesn't remember what's the last tab you are on
// the character page ... So I can't click go back on my browser and
// conveniently go back to the last tab I clicked on." setupTabs switched panels
// and never touched the address, so Back, a refresh and a shared link all
// landed on the first tab.
//
// The owner picked ?tab=<id> written with replaceState: no Back step per tab,
// so Back still leaves the page. These tests drive real clicks and read what
// the reader sees (which panel is showing), not the address alone.
//
// The back-forward cache is off for this file. A page restored from that cache
// keeps its tab without any of this, which is not what the owner's browser
// did; with it off, Back loads the page again from its address. Playwright
// only allows the switch for a whole file.
const { test, expect } = require('@playwright/test');

test.use({ launchOptions: { args: ['--disable-back-forward-cache'] } });

const BOOMCAT = '/characters/Boomcat/index.html';

// The page's own address. page.url() follows it a moment late after a
// replaceState, which read as a missing ?tab once in 30 runs.
const href = page => page.evaluate(() => location.href);

function collectErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    return errors;
}

// Replaces the page_data row (the same patch as system-page-anchors.spec.js),
// so a test decides which optional tabs a character has instead of reading the
// owner's settings.
function mockPageRow(page, row) {
    return page.addInitScript((row) => {
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
                                // Late on purpose: the Techs button is shown only
                                // once the row says so, after the strip is wired.
                                single: async () => {
                                    await new Promise(r => setTimeout(r, 800));
                                    return { data: row, error: null };
                                },
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
    }, row);
}

// Which of the character's main tabs are showing. From the vocabulary: frame
// data's own move panels carry `tab-` ids too.
const showing = page => page.evaluate(() =>
    window.getCharacterTabIds({ includeInjected: true, includeOptional: true })
        .filter(id => {
            const p = document.getElementById(`tab-${id}`);
            return p && !p.classList.contains('hidden');
        }));

test('a click names the tab in the address without adding a Back step', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    const before = await page.evaluate(() => history.length);

    await page.locator('#nav-combos').click();
    expect(new URL(await href(page)).searchParams.get('tab')).toBe('combos');
    expect(await page.evaluate(() => history.length)).toBe(before);

    // The first tab writes nothing, so a bare address still means Overview.
    await page.locator('#nav-overview').click();
    expect(new URL(await href(page)).searchParams.has('tab')).toBe(false);
    expect(errors).toEqual([]);
});

test('a refresh reopens the tab the reader was on', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.locator('#nav-m1s').click();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#tab-m1s')).toBeVisible();
    await expect(page.locator('#tab-overview')).toBeHidden();
    await expect(page.locator('#nav-m1s')).toHaveClass(/\bactive\b/);
    expect(errors).toEqual([]);
});

test('Back from another page reopens the tab', async ({ page }) => {
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.locator('#nav-counterplay').click();
    expect(new URL(await href(page)).searchParams.get('tab')).toBe('counterplay');
    await page.goto('/characters/Vessel/index.html', { waitUntil: 'networkidle' });

    await page.goBack({ waitUntil: 'networkidle' });
    const back = new URL(await href(page));
    expect(back.pathname).toContain('/characters/Boomcat/');
    expect(back.searchParams.get('tab')).toBe('counterplay');
    await expect(page.locator('#tab-counterplay')).toBeVisible();
    await expect(page.locator('#tab-overview')).toBeHidden();

    // And one more Back leaves Boomcat: the tab clicks added no steps.
    await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
    expect(new URL(await href(page)).pathname).not.toContain('/characters/Boomcat/');
});

test('a shared link opens its tab', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BOOMCAT}?tab=matchups`, { waitUntil: 'networkidle' });
    await expect(page.locator('#tab-matchups')).toBeVisible();
    expect(await showing(page)).toEqual(['matchups']);
    expect(errors).toEqual([]);
});

test('a tab that is shown late still opens, and one never shown leaves the first tab', async ({ page }) => {
    const errors = collectErrors(page);
    await mockPageRow(page, { page_id: 'boomcat', desc_data: {}, frame_data: {}, tab_settings: { techs: true } });
    await page.goto(`${BOOMCAT}?tab=techs`, { waitUntil: 'networkidle' });
    await expect(page.locator('#tab-techs')).toBeVisible();
    await expect(page.locator('#tab-overview')).toBeHidden();

    // Techs off: the address names a tab this character does not have.
    const other = await page.context().newPage();
    const otherErrors = collectErrors(other);
    await mockPageRow(other, { page_id: 'boomcat', desc_data: {}, frame_data: {}, tab_settings: {} });
    await other.goto(`${BOOMCAT}?tab=techs`, { waitUntil: 'networkidle' });
    await other.waitForTimeout(1500);
    await expect(other.locator('#tab-overview')).toBeVisible();
    await expect(other.locator('#tab-techs')).toBeHidden();
    expect([...errors, ...otherErrors]).toEqual([]);
});

test("a reader's click while a late tab is pending wins", async ({ page }) => {
    await mockPageRow(page, { page_id: 'boomcat', desc_data: {}, frame_data: {}, tab_settings: { techs: true } });
    await page.goto(`${BOOMCAT}?tab=techs`, { waitUntil: 'domcontentloaded' });
    // Before the row (and so the Techs button) arrives.
    await page.locator('#nav-m1s').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('#nav-techs')).toBeVisible();
    expect(await showing(page)).toEqual(['m1s']);
    expect(new URL(await href(page)).searchParams.get('tab')).toBe('m1s');
});

test('arriving by a section link keeps the link, and the address names its tab', async ({ page }) => {
    const errors = collectErrors(page);
    const desc = { comboList: [{ starter: 'Zzq Arrival Starters', rows: [{ sequence: ['M1'], damage: '1' }] }] };
    await mockPageRow(page, { page_id: 'boomcat', desc_data: desc, frame_data: {} });
    // The id assignSectionAnchors gives the fixture's table title.
    const id = 'sec-zzq-arrival-starters';

    await page.goto(`${BOOMCAT}#${id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('#tab-combos')).toBeVisible();
    await expect.poll(() => href(page)).toContain('?tab=combos');
    expect(new URL(await href(page)).hash).toBe(`#${id}`);
    expect(errors).toEqual([]);
});

test('an unknown tab in the address opens the first tab', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BOOMCAT}?tab=%3Cimg%20src%3Dx%3E`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page.locator('#tab-overview')).toBeVisible();
    expect(await showing(page)).toEqual(['overview']);
    expect(errors).toEqual([]);
});

test('a section link into another tab names that tab, and a later click leaves the section', async ({ page }) => {
    await page.goto(BOOMCAT, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.renderCombosTab({
        comboIntro: [], comboGroups: [],
        comboList: [{ starter: 'Zzq Tab Address Starters', rows: [{ sequence: ['M1'], damage: '1' }] }],
    }));
    const id = await page.evaluate(() => {
        window.assignSectionAnchors();
        const h = [...document.querySelectorAll('#tab-combos .card-header-title')]
            .find(el => el.textContent.includes('Zzq Tab Address Starters'));
        return h && h.id;
    });
    expect(id).toBeTruthy();

    // What an in-page link does when a reader clicks it.
    await page.evaluate(id => window.jumpToAnchor(`#${id}`), id);
    await expect(page.locator('#tab-combos')).toBeVisible();
    await expect.poll(() => href(page)).toContain(`?tab=combos#${id}`);

    await page.locator('#nav-m1s').click();
    const url = new URL(await href(page));
    expect(url.searchParams.get('tab')).toBe('m1s');
    expect(url.hash).toBe('');
});

const SYSTEM_DESC = {
    tabs: [
        { tabId: 'basics', tabLabel: 'The Basics', sections: [{ sectionTitle: 'Zzq One', layout: 'full', width: 100, alignment: 'left', blocks: [] }] },
        { tabId: 'advanced', tabLabel: 'Advanced', sections: [{ sectionTitle: 'Zzq Two', layout: 'full', width: 100, alignment: 'left', blocks: [] }] },
    ],
};

test('a system page keeps its tab in the address too', async ({ page }) => {
    const errors = collectErrors(page);
    await mockPageRow(page, { page_id: 'm1_trading', desc_data: SYSTEM_DESC, frame_data: {} });
    await page.goto('/systems/m1-trading/index.html', { waitUntil: 'networkidle' });
    await page.locator('#nav-advanced').click();
    expect(new URL(await href(page)).searchParams.get('tab')).toBe('advanced');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#tab-advanced')).toBeVisible();
    await expect(page.locator('#tab-basics')).toBeHidden();
    expect(errors).toEqual([]);
});
