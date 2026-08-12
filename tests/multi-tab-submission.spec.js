// Submitting more than one tab at once (v0.13 item 8).
//
// The payload scan was a chain of `else if (tabId === ...)`, so a contributor
// who edited Overview, then Skills, then Matchups and pressed Submit once sent
// only whatever tab happened to be open. The rest was kept in memory, never
// sent, and nothing said so beyond a notice added in v0.12.
//
// Two properties matter, and the second is the one that could do damage:
//
//   * every edited tab becomes a delta from one Submit
//   * an UNTOUCHED tab produces nothing. The scan now looks at data the
//     contributor never opened, so any normalisation-on-load difference
//     between the working copy and the loaded copy would turn into a
//     spurious delta - a revision nobody wrote, queued for a reviewer to
//     approve over live content.
const { test, expect } = require('@playwright/test');

const CLOUD = {
    desc: {
        profile: { name: 'Testchar' },
        playstyle: [], overview: [{ type: 'paragraph', content: 'Base overview.' }],
        strategy: [], extras: [],
        matchups: [{ opponent: 'Sukuna', tier: 'Equal', content: [] }],
        counterplay: [{ topic: 'Spacing', content: [] }],
        moveStrategies: {},
    },
    frame: {
        m1s: [{ id: 'm1-1', name: 'Jab' }],
        skills: [{ id: 'sk-1', name: 'Dash' }],
        specials: [], ultimateAtk: [],
    },
};

async function openEditor(page) {
    await page.addInitScript((cloud) => {
        window.__inserted = [];
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        client.auth.getSession = async () => ({
                            data: { session: { user: { id: 'u-1', email: 'c@b.c' }, access_token: 't' } },
                        });
                        client.from = (table) => {
                            if (table === 'pending_revisions') {
                                return {
                                    insert: async (rows) => {
                                        window.__inserted.push(...(Array.isArray(rows) ? rows : [rows]));
                                        return { data: null, error: null };
                                    },
                                    select() { return this; }, eq() { return this; },
                                    order: async () => ({ data: [], error: null }),
                                };
                            }
                            if (table === 'page_data') {
                                const row = { desc_data: cloud.desc, frame_data: cloud.frame };
                                return {
                                    select() { return this; }, eq() { return this; },
                                    single: async () => ({ data: row, error: null }),
                                    maybeSingle: async () => ({ data: row, error: null }),
                                };
                            }
                            const chain = new Proxy({}, {
                                get(_t, prop) {
                                    if (prop === 'then') return (resolve) => resolve({ data: null, error: null });
                                    if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                    return () => chain;
                                },
                            });
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, CLOUD);

    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    await page.evaluate(async (cloud) => {
        // The cooldown is a localStorage gate and not what is under test.
        localStorage.removeItem('wiki_last_submit_time');
        // The QA modal is a separate flow with its own coverage.
        window.openQAModal = async () => ({ changelog: 'test', confidence: 'high', evidence: '' });
        window.customConfirm = async () => true;
        window.editorAlert = () => {};

        window.currentEditorPageType = 'character';
        window.currentEditorCharId = 'testchar';
        window.currentEditorTabId = 'overview';
        window.currentOverviewSection = null;
        window.currentMatchupIndex = undefined;
        window.currentCounterplayIndex = undefined;

        const desc = JSON.parse(JSON.stringify(cloud.desc));
        const frame = JSON.parse(JSON.stringify(cloud.frame));
        window.originalCloudDescData = JSON.parse(JSON.stringify(cloud.desc));
        window.originalCloudFrameData = JSON.parse(JSON.stringify(cloud.frame));
        window.originalCloudMasterFrame = JSON.parse(JSON.stringify(cloud.frame));

        await window.initEditorModes('testchar', desc, frame);
        initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    }, CLOUD);
}

async function submit(page) {
    await page.evaluate(() => { window.triggerManualSync = async () => {}; });
    await page.click('#submit-payload-btn');
    await expect(page.locator('#submit-payload-btn')).toBeEnabled({ timeout: 15000 });
    await page.waitForTimeout(600);

    // Two or more deltas are collapsed into one `multi` ticket carrying them
    // as a batch - machinery that already existed, and the reason the reviewer
    // side needed no changes for this feature. Flattened here so the tests
    // talk about the deltas rather than the envelope around them.
    return page.evaluate(() => window.__inserted.flatMap(row => (
        row.target_scope === 'multi'
            ? (row.delta_payload || []).map(d => ({ scope: d.scope, key: d.key }))
            : [{ scope: row.target_scope, key: row.target_key }]
    )));
}

test('an untouched page submits nothing at all', async ({ page }) => {
    // The property that makes scanning every tab safe. If loading normalises
    // anything - a missing array becoming [], a field gaining a default - the
    // scan would now see it on tabs the contributor never opened and file a
    // revision nobody wrote.
    await openEditor(page);
    const inserted = await submit(page);

    expect(inserted, 'no edits means no deltas').toEqual([]);
});

test('edits made across three tabs all ship from one submit', async ({ page }) => {
    await openEditor(page);

    await page.evaluate(() => {
        // Overview, a move on the Skills tab, and a matchup - three tabs, and
        // at most one of them could ever have been the open one.
        window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Rewritten overview.' }];
        window.currentEditorFrameData.skills[0].name = 'Dash (buffed)';
        window.currentEditorDescData.matchups[0].tier = 'Advantage';
    });

    const inserted = await submit(page);
    const scopes = inserted.map(d => `${d.scope}:${d.key}`);

    expect(scopes).toContain('overview:full');
    expect(scopes).toContain('move:skills::sk-1');
    expect(scopes).toContain('matchup:Sukuna');
    expect(inserted, 'one delta per edited section, nothing else').toHaveLength(3);
});

test('an edit on a tab that was never opened still ships', async ({ page }) => {
    // The exact loss this fixes: the editor was left on Overview, but the
    // contributor had already changed counterplay before switching.
    await openEditor(page);

    await page.evaluate(() => {
        window.currentEditorTabId = 'overview';
        window.currentEditorDescData.counterplay[0].topic = 'Spacing and whiff punish';
    });

    const inserted = await submit(page);
    // The topic IS the key, so renaming it is an add plus a removal.
    const keys = inserted.filter(d => d.scope === 'counterplay').map(d => d.key);
    expect(keys).toContain('Spacing and whiff punish');
    expect(keys, 'and the old key is retired').toContain('Spacing');
});

test('a deletion on a non-open tab ships as a null delta', async ({ page }) => {
    await openEditor(page);

    await page.evaluate(() => {
        window.currentEditorFrameData.m1s = [];
    });

    const inserted = await page.evaluate(() => window.__inserted);
    expect(inserted).toEqual([]); // nothing submitted yet

    const after = await submit(page);
    const removal = after.find(d => d.scope === 'move' && d.key === 'm1s::m1-1');
    expect(removal, 'the removed move is reported').toBeTruthy();
});
