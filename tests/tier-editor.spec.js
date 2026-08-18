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
    // With an intro block, so there is a real field at the bottom to reach.
    // The default fixture has no intro at all, which renders an EMPTY block
    // list - and every "can I type in it" assertion below would then be about
    // an element that does not exist.
    await openEditor(page, {
        list: { ...LIST, intro: [{ type: 'paragraph', content: 'Intro text' }] },
    });

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

    // The half this test was missing, and the reason I spent a session
    // convinced the scroll fix had broken the editor. Measuring the HOST only
    // says the container arrived; the field inside it can still be unusable.
    //
    // It was, when measured before scrolling - because the block card was
    // below the fold and the IntersectionObserver had unloaded it, which is
    // .block-card.virtual-unloaded > * { display: none } doing exactly its
    // job. Scroll to it and it loads. Typing into it is the actual claim.
    const field = page.locator("#block-list .block-card textarea").first();
    // The card only loads once the observer has seen it, which is a frame after
    // the scroll - waiting for the class to clear is waiting for the actual
    // condition rather than for a duration.
    await expect
        .poll(() => page.evaluate(() =>
            !document.querySelector("#block-list .block-card")?.classList.contains("virtual-unloaded")),
        { timeout: 10000 })
        .toBe(true);
    await field.click();
    await page.keyboard.type("x");
    expect(await field.inputValue()).toContain("x");
});

// --- THE PREVIEW PANEL (v0.16 fine-tuning 3) ---

test('editing a block does not throw, because updateLivePreview exists here', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await openEditor(page, {
        list: { ...LIST, intro: [{ type: 'paragraph', content: 'Intro text' }] },
    });

    // editor-blocks.js calls updateLivePreview() BY BARE NAME from about ten
    // sites after every block change, and it is declared in editor-sync.js -
    // which this page does not load. Every edit threw a ReferenceError,
    // silently, into the console.
    expect(await page.evaluate(() => typeof window.updateLivePreview)).toBe('function');

    // Scroll the workspace down and wait for the virtualization observer to
    // load the card: .block-card.virtual-unloaded > * is display:none, so a
    // field below the fold is present but not clickable.
    await page.evaluate(() => {
        const c = document.querySelector('.admin-sidebar-content');
        if (c) c.scrollTop = c.scrollHeight;
    });
    const field = page.locator('#block-list .block-card textarea').first();
    await expect(field).toBeVisible({ timeout: 10000 });
    await field.click();
    await page.keyboard.type('abc');
    await page.waitForTimeout(700);   // past the editor's 400ms typing debounce

    expect(errors, 'typing in the block editor must not throw').toEqual([]);
});

test('the preview uses the live page markup, not a second design', async ({ page }) => {
    await openEditor(page, {
        list: {
            ...LIST,
            intro: [{ type: 'paragraph', content: 'ZZQ INTRO LINE' }],
            reasoning: [{ type: 'paragraph', content: 'ZZQ REASONING LINE' }],
        },
    });

    const host = page.locator('#tier-preview-docs');

    // The classes are the ones js/certified-tier-lists.js renders. A preview
    // with its own layout is not a preview - the first version of this had a
    // Finger-Paint card heading where the real page has a small mono label on
    // an accent border.
    await expect(host.locator('.ctl-intro .ctl-subheading')).toHaveText('Tier List Introduction');
    await expect(host.locator('.ctl-intro-body')).toContainText('ZZQ INTRO LINE');
    await expect(host.locator('.ctl-reasoning .ctl-subheading')).toHaveText('Reasoning');
    await expect(host.locator('.ctl-reasoning-body')).toContainText('ZZQ REASONING LINE');

    // A move that is not saved yet still belongs here: it is the changelog
    // entry being written this minute, in the shape the reader will get it.
    await move(page, 'ten_shadows', '1');
    await page.fill('.tier-move-note', 'Nerfed domain startup.');

    await expect(host.locator('.ctl-changelog .ctl-change-pending')).toHaveCount(1);
    await expect(host.locator('.ctl-change-pending .ctl-change-note'))
        .toContainText('Nerfed domain startup.');
});

test('the preview follows what is being typed, not the last saved version', async ({ page }) => {
    await openEditor(page, {
        list: { ...LIST, intro: [{ type: 'paragraph', content: 'Before' }] },
    });

    await expect(page.locator('#tier-preview-docs')).toContainText('Before');

    // Scroll the workspace down and wait for the virtualization observer to
    // load the card: .block-card.virtual-unloaded > * is display:none, so a
    // field below the fold is present but not clickable.
    await page.evaluate(() => {
        const c = document.querySelector('.admin-sidebar-content');
        if (c) c.scrollTop = c.scrollHeight;
    });
    const field = page.locator('#block-list .block-card textarea').first();
    await expect(field).toBeVisible({ timeout: 10000 });
    await field.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('ZZQ AFTER');

    // Driven through the real typing path, which is what calls
    // updateLivePreview - a preview that only refreshed on save would satisfy
    // the test above and still be useless while writing.
    await expect(page.locator('#tier-preview-docs')).toContainText('ZZQ AFTER', { timeout: 5000 });
});

// --- GAME VERSION (v0.15 item 13) ---

test('the game version loads and saves', async ({ page }) => {
    await openEditor(page, { list: { ...LIST, game_version: "Update 1.4.2" } });

    const field = page.locator("#tier-game-version");
    await expect(field).toHaveValue("Update 1.4.2");
    await expect(field).toBeEnabled();

    await field.fill("Update 1.5.0");
    await saveBtn(page).click();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === "save_tier_list"));
    expect(call.params.p_game_version).toBe("Update 1.5.0");
});

test('a list with no game version sends an empty string, not undefined', async ({ page }) => {
    // Absent is the normal state - every list that exists predates this field.
    // undefined would be dropped from the JSON body entirely, and the RPC
    // COALESCEs a missing value to the stored one, so "I cleared it" would
    // silently mean "leave it alone".
    await openEditor(page);

    await expect(page.locator("#tier-game-version")).toHaveValue("");
    await saveBtn(page).click();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === "save_tier_list"));
    expect(call.params.p_game_version).toBe("");
});

test('a read-only list cannot have its game version edited', async ({ page }) => {
    await openEditor(page, { list: { ...LIST, owner_id: "someone-else", game_version: "Update 1.4.2" } });

    await expect(page.locator("#tier-game-version")).toBeDisabled();
    await expect(page.locator("#tier-game-version")).toHaveValue("Update 1.4.2");
});

// --- THE TIER COLOUR PICKER (v0.16 fine-tuning 3) ---

test('tier colours use the site picker, not the operating system dialog', async ({ page }) => {
    await openEditor(page);

    // <input type="color"> opens the OS colour dialog on top of the wiki - a
    // different palette, different conventions, and a modal the page cannot
    // see. v0.14 removed it everywhere else; this row was the last one left.
    await expect(page.locator('.tier-control-row input[type="color"]')).toHaveCount(0);

    const swatch = page.locator('.tier-control-color').first();
    await expect(swatch).toBeVisible();
    await expect(page.locator('.tier-color-popup').first()).toBeHidden();

    await swatch.click();
    await expect(page.locator('.tier-color-popup').first()).toBeVisible();

    // Driven through the picker's own hex field and USE button, which is the
    // v0.14 engine rather than a reimplementation of it.
    const popup = page.locator('.tier-color-popup').first();
    await popup.locator('.cp-hex').fill('#123456');
    await popup.locator('.cp-apply').click();

    await expect(popup).toBeHidden();

    // The rendered consequence on the board, not just the stored value.
    const painted = await page.evaluate(() => {
        const label = document.querySelector('.tier-editor-row[data-tier-index="0"] .ctl-label');
        return getComputedStyle(label).backgroundColor;
    });
    expect(painted).toBe('rgb(18, 52, 86)');

    await saveBtn(page).click();
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'save_tier_list'));
    expect(call.params.p_tiers[0].color).toBe('#123456');
});

test('opening one tier colour picker closes the others', async ({ page }) => {
    await openEditor(page);

    await page.locator('.tier-control-color').nth(0).click();
    await expect(page.locator('.tier-color-popup').nth(0)).toBeVisible();

    await page.locator('.tier-control-color').nth(1).click();
    await expect(page.locator('.tier-color-popup').nth(1)).toBeVisible();
    await expect(page.locator('.tier-color-popup').nth(0), 'two open pickers is two answers')
        .toBeHidden();
});

// --- TIER NAMES LONGER THAN A LETTER (v0.16 fine-tuning 3) ---

test('a tier can be renamed by typing, not one letter per click', async ({ page }) => {
    await openEditor(page);

    // Typed key by key through the real field. The bug was never a length cap:
    // the input handler called renderBoard(), which rebuilt the controls and
    // destroyed the very input being typed into, so focus was lost after each
    // keystroke and the name had to be entered one letter at a time with a
    // click in between. fill() would have masked it completely - it sets the
    // value in one shot and never needs focus to survive.
    const field = page.locator('.tier-control-name').first();
    await field.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Situational');

    await expect(field).toHaveValue('Situational');
    await expect(field, 'the field kept focus the whole way through').toBeFocused();

    const state = await page.evaluate(() => ({
        board: [...document.querySelectorAll('.tier-editor-row .ctl-label')].map(l => l.textContent),
        inputs: [...document.querySelectorAll('.tier-control-name')].map(i => i.value),
    }));
    expect(state.inputs[0]).toBe('Situational');
    expect(state.board[0], 'and the board followed along').toBe('Situational');
});

test('renaming a tier still does not register as a move', async ({ page }) => {
    // The old handler rebuilt everything partly to keep this true. It has to
    // stay true now that it does not.
    await openEditor(page);

    const field = page.locator('.tier-control-name').first();
    await field.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Elite');

    await expect(page.locator('#tier-move-count')).toHaveText('0');
    await expect(saveBtn(page)).toBeEnabled();
});

test('a long tier name shrinks every label, not just its own', async ({ page }) => {
    await openEditor(page, {
        list: {
            ...LIST,
            tiers: [
                { name: 'S', color: '#ff0000', characters: ['ten_shadows'] },
                { name: 'Situational', color: '#ffff00', characters: ['vessel'] },
                { name: 'B', color: '#00ff00', characters: [] },
            ],
        },
    });

    // The web font arrives after first paint and is far wider than the
    // fallback, so the fit is recomputed when it lands. Measured before that
    // settles, this reads a size chosen for the wrong typeface.
    await page.evaluate(() => document.fonts.ready);
    await expect
        .poll(() => page.evaluate(() => {
            const l = document.querySelectorAll('.tier-editor-row .ctl-label')[1];
            const style = getComputedStyle(l);
            const available = l.clientWidth
                - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const range = document.createRange();
            range.selectNodeContents(l);
            return range.getBoundingClientRect().width <= available + 1;
        }), { timeout: 10000 })
        .toBe(true);

    const out = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.tier-editor-row .ctl-label')];
        // Measured with a Range, NOT scrollWidth. The box centres its text, so
        // an oversized name spills out of both sides and scrollWidth reports
        // only the right-hand half - the first version of this assertion used
        // it and called a fitting label unfitted.
        const fits = (el) => {
            const style = getComputedStyle(el);
            const available = el.clientWidth
                - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const range = document.createRange();
            range.selectNodeContents(el);
            return range.getBoundingClientRect().width <= available + 1;
        };
        return {
            sizes: labels.map(l => getComputedStyle(l).fontSize),
            longestFitsOneLine: labels.every(fits),
            stillNoWrap: labels.every(l => getComputedStyle(l).whiteSpace === 'nowrap'),
            texts: labels.map(l => l.textContent),
        };
    });

    expect(out.texts).toEqual(['S', 'Situational', 'B']);
    expect(out.longestFitsOneLine, 'the long name fits its box').toBe(true);
    expect(out.stillNoWrap, 'and did so without falling back to wrapping').toBe(true);

    // The point of the item: these labels are a scale, so they all wear the
    // size the longest one forced. Shrinking only the long one leaves a board
    // whose marks disagree about their own importance.
    expect(new Set(out.sizes).size, 'one size across every tier').toBe(1);

    // And it really did shrink - otherwise "they all match" is satisfied by
    // doing nothing at all.
    expect(parseFloat(out.sizes[0])).toBeLessThan(24);
});

test('short tier names keep the full size', async ({ page }) => {
    // The other direction. A fitter that always shrank would pass the test
    // above without ever measuring anything.
    await openEditor(page);

    const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('.tier-editor-row .ctl-label')]
            .map(l => parseFloat(getComputedStyle(l).fontSize)));

    expect(sizes.length).toBe(2);
    sizes.forEach(size => expect(size).toBe(24)); // 1.5rem at the 16px root
});
