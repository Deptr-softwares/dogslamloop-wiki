// The tier list editor (v0.14 item 3, second half).
//
// The rule this page exists to enforce: every character that moves gets a note
// from the author at the time they move it. Not a changelog field to fill in
// afterwards - a changelog written later is written from memory, and the notes
// worth having are the ones somebody wrote while they still knew why.
//
// So most of what follows tests the gate rather than the drag: moves are
// detected against the placement that was loaded, each demands a note, and
// SAVE does nothing until they all have one.
//
// The schema enforces it independently (tier_list_changes.note is NOT NULL
// with a length floor) and the RPC re-checks per-row ownership, because
// SECURITY DEFINER bypasses the policy. Neither is reachable from a browser.
const { test, expect } = require('@playwright/test');

const PAGE = '/tier-editor.html';

const LIST = {
    id: 'list-1',
    slug: 'owner',
    owner_id: 'u-me',
    author_name: 'Air Putrifier',
    tiers: [
        { name: 'S', color: '#ff0000', characters: ['ten_shadows'] },
        { name: 'B', color: '#ffff00', characters: ['vessel'] },
    ],
    reasoning: [],
};

async function openEditor(page, { list = LIST, session = { id: 'u-me' }, role = null, saveError = null } = {}) {
    await page.addInitScript(({ list, session, role, saveError }) => {
        window.__rpcCalls = [];
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({
                        data: { session: session ? { user: { id: session.id, email: 'a@b.test' }, access_token: 't' } : null },
                    });
                    client.from = (table) => {
                        if (table === 'tier_lists') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                maybeSingle: async () => ({ data: list, error: null }),
                                then(r) { return r({ data: list ? [list] : [], error: null }); },
                            };
                            return chain;
                        }
                        if (table === 'user_roles') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
                                then(r) { return r({ data: role ? [{ role }] : [], error: null }); },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, p) {
                                if (p === 'then') return (r) => r({ data: [], error: null });
                                if (p === 'single' || p === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        if (name === 'save_tier_list') {
                            return saveError ? { data: null, error: saveError } : { data: 'Saved. 1 change recorded.', error: null };
                        }
                        return { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, { list, session, role, saveError });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    // Either outcome is a valid load: the board, or the denial screen that
    // replaces the whole body when there is no list to edit.
    await page.waitForSelector('.tier-editor-board, .access-denied-screen');
}

// Moving a character is a data operation; the drag is one way to trigger it.
// Driven directly here so these tests are about the note rule rather than
// about pointer-event synthesis.
const move = (page, charId, target) =>
    page.evaluate(([c, t]) => window.tierEditorPlace(c, t), [charId, target]);

const saveBtn = (page) => page.locator('#btn-save-tier-list');

test('the board renders the loaded placement and everyone unranked', async ({ page }) => {
    await openEditor(page);

    await expect(page.locator('.tier-editor-row')).toHaveCount(2);
    await expect(page.locator('.tier-editor-row').nth(0).locator('.tier-portrait')).toHaveCount(1);
    // Everybody in the roster and in no tier, recomputed rather than stored -
    // so a character added after this list was written shows up rather than
    // being invisible forever. Boomcat is exactly that case.
    const tray = await page.locator('#tier-editor-tray .tier-portrait').count();
    expect(tray).toBeGreaterThan(0);
});

test('no moves means SAVE is available - editing the reasoning needs no note', async ({ page }) => {
    await openEditor(page);
    await expect(saveBtn(page)).toBeEnabled();
    await expect(page.locator('#tier-move-count')).toHaveText('0');
});

test('moving a character demands a note before SAVE will do anything', async ({ page }) => {
    await openEditor(page);

    await move(page, 'ten_shadows', '1');

    await expect(page.locator('.tier-move')).toHaveCount(1);
    await expect(page.locator('.tier-move-arrow')).toHaveText('S → B');
    await expect(saveBtn(page), 'the gate').toBeDisabled();
    await expect(page.locator('#tier-save-status')).toContainText('needs a note');

    // Under the schema's own floor of three characters, so the button and the
    // database agree about what counts.
    await page.fill('.tier-move-note', 'ok');
    await expect(saveBtn(page)).toBeDisabled();

    await page.fill('.tier-move-note', 'Nerfed domain startup.');
    await expect(saveBtn(page)).toBeEnabled();
});

test('moving a character back to where it started cancels the move', async ({ page }) => {
    // The diff is against the placement that was loaded, not a running log, so
    // an experiment that ends where it began is not a change to explain.
    await openEditor(page);

    await move(page, 'ten_shadows', '1');
    await expect(page.locator('.tier-move')).toHaveCount(1);

    await move(page, 'ten_shadows', '0');
    await expect(page.locator('.tier-move')).toHaveCount(0);
    await expect(saveBtn(page)).toBeEnabled();
});

test('first placements and removals are moves too', async ({ page }) => {
    await openEditor(page);

    // Out of a tier entirely.
    await move(page, 'vessel', 'unranked');
    await expect(page.locator('.tier-move-arrow')).toHaveText('B → unranked');

    // ...and in from unranked.
    await move(page, 'boomcat', '0');
    const arrows = await page.locator('.tier-move-arrow').allTextContents();
    expect(arrows).toContain('→ S');
});

test('renaming a tier is not a move', async ({ page }) => {
    // The diff keys on the tier a character sits in, so a rename would
    // otherwise register as everyone in that tier moving - both wrong and a
    // wall of notes to write.
    await openEditor(page);

    await page.locator('.tier-control-name').first().fill('SS');

    await expect(page.locator('.tier-move')).toHaveCount(0);
    await expect(page.locator('.ctl-label').first()).toHaveText('SS');
    await expect(saveBtn(page)).toBeEnabled();
});

test('removing a tier returns its occupants to unranked as explainable moves', async ({ page }) => {
    await openEditor(page);

    await page.locator('.tier-control-row').first().locator('.btn-sys-red').click();

    await expect(page.locator('.tier-editor-row')).toHaveCount(1);
    await expect(page.locator('.tier-move')).toHaveCount(1);
    await expect(page.locator('.tier-move-arrow')).toHaveText('S → unranked');
    await expect(saveBtn(page), 'a removed tier is a ranking decision about everyone in it').toBeDisabled();
});

test('saving sends the placement, the reasoning and every note', async ({ page }) => {
    await openEditor(page);

    await move(page, 'ten_shadows', '1');
    await page.fill('.tier-move-note', 'Domain nerf landed.');
    await saveBtn(page).click();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'save_tier_list'));
    expect(call.params.p_list_id).toBe('list-1');
    expect(call.params.p_changes).toEqual([{
        character_id: 'ten_shadows',
        from_tier: 'S',
        to_tier: 'B',
        note: 'Domain nerf landed.',
    }]);
    // The placement travels whole, not as a patch.
    const sTier = call.params.p_tiers.find(t => t.name === 'S');
    expect(sTier.characters).toEqual([]);
});

test('a successful save makes the new board the baseline', async ({ page }) => {
    await openEditor(page);

    await move(page, 'ten_shadows', '1');
    await page.fill('.tier-move-note', 'Domain nerf landed.');
    await saveBtn(page).click();

    await expect(page.locator('.tier-move')).toHaveCount(0);
    await expect(page.locator('#tier-save-status')).toContainText('Saved');
});

test('a failed save keeps the moves and their notes', async ({ page }) => {
    // Re-baselining before the write would mean a failed save silently
    // discarding the very moves it failed to record.
    await openEditor(page, { saveError: { message: 'This is not your tier list.' } });

    await move(page, 'ten_shadows', '1');
    await page.fill('.tier-move-note', 'Domain nerf landed.');
    await saveBtn(page).click();

    await expect(page.locator('#tier-save-status')).toContainText('not your tier list');
    await expect(page.locator('.tier-move')).toHaveCount(1);
    await expect(page.locator('.tier-move-note')).toHaveValue('Domain nerf landed.');
    await expect(saveBtn(page), 'still saveable, so a retry is possible').toBeEnabled();
});

test('somebody else\'s list is read only', async ({ page }) => {
    // The client half of the per-row rule. save_tier_list re-checks it, because
    // SECURITY DEFINER bypasses the policy that would otherwise enforce it.
    await openEditor(page, { list: { ...LIST, owner_id: 'someone-else' } });

    await expect(saveBtn(page)).toBeDisabled();
    await expect(page.locator('#tier-editor-subtitle')).toContainText('read only');
    await expect(page.locator('#tier-editor-status')).toContainText('belongs to somebody else');
});

test('an admin may edit anyone\'s list', async ({ page }) => {
    await openEditor(page, { list: { ...LIST, owner_id: 'someone-else' }, role: 'admin' });

    await expect(saveBtn(page)).toBeEnabled();
    await expect(page.locator('#tier-editor-subtitle')).toContainText('Editing');
});

test('somebody with no list is told so rather than shown an empty editor', async ({ page }) => {
    await openEditor(page, { list: null });
    await expect(page.locator('.access-denied-title')).toContainText('NO TIER LIST ASSIGNED');
});

test('a signed-out visitor cannot reach the editor', async ({ page }) => {
    await openEditor(page, { session: null });
    await expect(page.locator('.access-denied-title')).toContainText('SIGN IN');
});

test('character names in the editor are never parsed as markup', async ({ page }) => {
    await openEditor(page, {
        list: { ...LIST, tiers: [{ name: '<img src=x onerror="window.__pwned=1">', color: '#f00', characters: ['ten_shadows'] }] },
    });

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        imgs: document.querySelectorAll('.ctl-label img').length,
        label: document.querySelector('.ctl-label').textContent,
    }));

    expect(result.pwned).toBe(false);
    expect(result.imgs).toBe(0);
    expect(result.label).toContain('<img');
});

// --- THE TWO DOCUMENTS (v0.14 owner tools) -------------------------------
//
// One block editor, two documents. initStrategyBlockBuilder keeps a single
// module-level buffer, so switching has to flush the open one before loading
// the other - and the bug that pattern exists to prevent, in editor-tabs.js,
// was one tab's blocks being written into another's.

test('the editor opens on the introduction, which is what a new author writes first', async ({ page }) => {
    await openEditor(page);

    await expect(page.locator('#btn-doc-intro')).toHaveClass(/active/);
    await expect(page.locator('#btn-doc-reasoning')).not.toHaveClass(/active/);
    await expect(page.locator('#tier-doc-hint')).toContainText('does not go through the review queue');
});

test('switching documents changes what the hint describes', async ({ page }) => {
    await openEditor(page);

    await page.click('#btn-doc-reasoning');
    await expect(page.locator('#btn-doc-reasoning')).toHaveClass(/active/);
    await expect(page.locator('#btn-doc-intro')).not.toHaveClass(/active/);
    await expect(page.locator('#tier-doc-hint')).toContainText('under the changelog');
});

test('saving sends both documents, whichever one is open', async ({ page }) => {
    // The failure this guards: saving while the introduction is open used to
    // mean writing a stale reasoning and silently dropping everything just
    // typed. The flush is what makes both correct regardless of which is open.
    await openEditor(page, {
        list: {
            ...LIST,
            intro: [{ type: 'paragraph', content: 'INTRO TEXT' }],
            reasoning: [{ type: 'paragraph', content: 'REASONING TEXT' }],
        },
    });

    await saveBtn(page).click();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'save_tier_list'));
    expect(JSON.stringify(call.params.p_intro)).toContain('INTRO TEXT');
    expect(JSON.stringify(call.params.p_reasoning)).toContain('REASONING TEXT');
});

test('switching away and back does not lose the other document', async ({ page }) => {
    await openEditor(page, {
        list: {
            ...LIST,
            intro: [{ type: 'paragraph', content: 'INTRO TEXT' }],
            reasoning: [{ type: 'paragraph', content: 'REASONING TEXT' }],
        },
    });

    await page.click('#btn-doc-reasoning');
    await page.click('#btn-doc-intro');
    await saveBtn(page).click();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'save_tier_list'));
    expect(JSON.stringify(call.params.p_intro)).toContain('INTRO TEXT');
    expect(JSON.stringify(call.params.p_reasoning), 'the document not on screen survived the round trip')
        .toContain('REASONING TEXT');
});

// --- THE WORKSPACE SCROLLS (v0.16 fine-tuning 3) ---

test('the workspace can be scrolled to the block editor at its bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditor(page);

    // This page marks its panes with admin.css class names and never loads
    // admin.css, so .admin-sidebar-content matched nothing and only
    // .editor-workspace applied - and that rule is overflow: hidden, which
    // expects an inner scroll region that did not exist. The block editor is
    // the last thing in the column, so writing the Introduction meant typing
    // into something below the fold with no way to reach it.
    const before = await page.evaluate(() => {
        const content = document.querySelector(".admin-sidebar-content");
        const blocks = document.getElementById("strategy-block-target");
        return {
            overflow: getComputedStyle(content).overflowY,
            scrolls: content.scrollHeight > content.clientHeight,
            blocksBelowFold: blocks.getBoundingClientRect().bottom > window.innerHeight,
        };
    });

    expect(before.overflow, "the inner column is the scroll region").toBe("auto");
    // Guards the test itself: with nothing overflowing, "it scrolls" is vacuous.
    expect(before.scrolls, "the fixture is tall enough to need scrolling").toBe(true);
    expect(before.blocksBelowFold, "and the block editor starts out of reach").toBe(true);

    const reached = await page.evaluate(() => {
        const content = document.querySelector(".admin-sidebar-content");
        content.scrollTop = content.scrollHeight;
        const box = document.getElementById("strategy-block-target").getBoundingClientRect();
        return box.bottom <= window.innerHeight + 2;
    });
    expect(reached, "scrolling brings it fully into view").toBe(true);
});
