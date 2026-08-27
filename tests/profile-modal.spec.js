// v0.17 F11 part 2: the profile modal stops being a rename box.
//
// Before this, the modal did exactly one thing - change your display name - and
// reported failure with alert("Failed to update name. Check console."). It now
// carries a bio, a flair, a privacy setting, a standing badge and a password
// change, so what these tests protect is that each control actually reaches the
// database rather than merely rendering.
//
// The riskiest change in the PR is not in this modal at all: the role icon
// suite moved out of initAuthDock (js/pagebuilder.js) into window.ROLE_BADGES
// so the dock and the profile cannot drift. The sidebar dock is on every page,
// so "the dock still draws the same icon" is asserted here too, against the
// crown specifically - it is the icon that was redrawn days ago and the one a
// stale duplicate would have got wrong.
const { test, expect } = require('@playwright/test');

// Chainable and directly awaitable, matching real supabase-js.
async function mockProfile(page, opts) {
    await page.addInitScript((opts) => {
        window.__upserts = [];
        window.__updateUser = [];
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
                        data: {
                            session: {
                                access_token: 't',
                                user: {
                                    id: 'u1',
                                    email: 'someone@site.test',
                                    user_metadata: { display_name: opts.displayName },
                                    app_metadata: { provider: opts.identities[0] || 'email' },
                                    identities: opts.identities.map(p => ({ provider: p })),
                                },
                            },
                        },
                    });
                    client.auth.updateUser = async (payload) => {
                        window.__updateUser.push(payload);
                        return { data: {}, error: null };
                    };
                    const origFrom = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                single: () => Promise.resolve({ data: opts.roleRow, error: null }),
                                then(r) { return Promise.resolve({ data: opts.roleRow ? [opts.roleRow] : [], error: null }).then(r); },
                            };
                            return chain;
                        }
                        if (table === 'user_profiles') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                single: () => opts.profileRow
                                    ? Promise.resolve({ data: opts.profileRow, error: null })
                                    : Promise.reject(new Error('no rows')),
                                upsert(payload) {
                                    window.__upserts.push(payload);
                                    return Promise.resolve(opts.upsertError
                                        ? { data: null, error: opts.upsertError }
                                        : { data: [payload], error: null });
                                },
                            };
                            return chain;
                        }
                        if (table === 'user_notifications') {
                            // order/limit included because the inbox chains them:
                            // a mock that stops at .eq() throws a TypeError that
                            // surfaces as a pageerror in an unrelated assertion.
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                order() { return chain; }, limit() { return chain; },
                                then(r) { return Promise.resolve({ data: [], count: 0, error: null }).then(r); },
                            };
                            return chain;
                        }
                        return origFrom(table);
                    };
                    client.rpc = async () => ({ data: null, error: null });
                    return client;
                };
            },
        });
    }, opts);
}

const DEFAULTS = {
    displayName: 'Boomcat', roleRow: null, profileRow: null,
    identities: ['email'], upsertError: null,
};

// Opens the profile by clicking the real dock button, not by calling
// openAuthModal() - a modal that opens only when a test calls the function is a
// modal that might not be reachable.
async function openProfile(page, overrides = {}) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockProfile(page, { ...DEFAULTS, ...overrides });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#dock-btn-auth').click();
    await expect(page.locator('#profile-modal-overlay')).not.toHaveClass(/hidden/);
    return errors;
}

// --- THE DOCK MUST NOT HAVE MOVED ---

test('the dock still draws the owner crown after the icon suite moved', async ({ page }) => {
    await mockProfile(page, { ...DEFAULTS, roleRow: { role: 'owner' } });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const btn = page.locator('#dock-btn-auth');
    await expect(btn).toHaveClass(/btn-sys-purple/);
    // The redrawn crown, by its path data. A stale duplicate of the icon suite
    // is exactly what this PR removes the possibility of, so it is asserted on
    // the shape rather than on "an svg is present".
    await expect(btn.locator('svg path').first()).toHaveAttribute('d', 'M3 16L5 6.5L9.5 11L12 4.5L14.5 11L19 6.5L21 16Z');
});

test('the dock gives an admin the shield, not the crown', async ({ page }) => {
    // By NAME, not by rank. The owner meets the admin bar, so a roleMeets test
    // here would hand the owner a shield - which is why roleBadge is a lookup.
    await mockProfile(page, { ...DEFAULTS, roleRow: { role: 'admin' } });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#dock-btn-auth');
    await expect(btn).toHaveClass(/btn-sys-red/);
    await expect(btn.locator('svg path').first()).toHaveAttribute('d', 'M12 2.5L20.5 6.5V12L12 21.5L3.5 12V6.5Z');
});

test('a soft-banned account gets no badge of its own in the dock', async ({ page }) => {
    // viewer is a ban. Branding it in the sidebar would publish a moderation
    // decision to anybody looking over their shoulder, and this matches what
    // get_public_profile() does with the standing.
    await mockProfile(page, { ...DEFAULTS, roleRow: { role: 'viewer' } });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#dock-btn-auth')).toHaveClass(/btn-sys-green/);
});

// --- THE MODAL OPENS AND IS POPULATED ---

test('opening the profile loads what is stored, with no page error', async ({ page }) => {
    const errors = await openProfile(page, {
        roleRow: { role: 'reviewer' },
        profileRow: { bio: 'I write combo routes.', flair: 'Sukuna main', is_private: false },
    });

    await expect(page.locator('#profile-bio')).toHaveValue('I write combo routes.');
    await expect(page.locator('#profile-flair')).toHaveValue('Sukuna main');
    await expect(page.locator('#profile-private')).not.toBeChecked();
    await expect(page.locator('#profile-standing-label')).toHaveText('Reviewer');
    expect(errors).toEqual([]);
});

test('an account with no profile row opens empty rather than broken', async ({ page }) => {
    // The normal state: user_profiles has no signup trigger, so a row exists
    // only once it has been saved. A rejected .single() must not read as an
    // error to the user.
    const errors = await openProfile(page, { profileRow: null });
    await expect(page.locator('#profile-bio')).toHaveValue('');
    await expect(page.locator('#profile-flair')).toHaveValue('');
    await expect(page.locator('#profile-feedback')).toHaveClass(/hidden/);
    expect(errors).toEqual([]);
});

test('the standing badge is painted, not merely classed', async ({ page }) => {
    // A class being right is not evidence the reader sees anything - v0.15
    // shipped nine passing tests over a feature that was visibly broken for
    // exactly this reason. Read back what the browser computed.
    await openProfile(page, { roleRow: { role: 'owner' } });
    const icon = page.locator('#profile-standing-icon');
    await expect(icon).toHaveClass(/profile-standing-purple/);
    const painted = await icon.evaluate(el => getComputedStyle(el).color);
    const muted = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim());
    expect(painted).not.toBe('');
    expect(painted).not.toBe(muted);
    await expect(page.locator('#profile-standing-label')).toHaveText('Owner');
});

// --- THE PASSWORD BRANCH ---

test('a Discord account is not offered a password it does not have', async ({ page }) => {
    await openProfile(page, { identities: ['discord'] });
    await expect(page.locator('#profile-password-field')).toHaveClass(/hidden/);
    const note = page.locator('#profile-oauth-note');
    await expect(note).not.toHaveClass(/hidden/);
    await expect(note).toContainText('discord');
});

test('an email account is offered one', async ({ page }) => {
    await openProfile(page, { identities: ['email'] });
    await expect(page.locator('#profile-password-field')).not.toHaveClass(/hidden/);
    await expect(page.locator('#profile-oauth-note')).toHaveClass(/hidden/);
});

test('an account with both providers keeps the password control', async ({ page }) => {
    // app_metadata.provider names only the most recent sign-in, so a Discord
    // login on a password account would hide a control that does work. This is
    // why identities[] is the source and not app_metadata.
    await openProfile(page, { identities: ['discord', 'email'] });
    await expect(page.locator('#profile-password-field')).not.toHaveClass(/hidden/);
});

test('the password button refuses a short password before calling out', async ({ page }) => {
    await openProfile(page, { identities: ['email'] });
    await page.fill('#profile-new-password', 'abc');
    await page.click('#btn-profile-password');
    await expect(page.locator('#profile-feedback')).toContainText('6 characters');
    expect(await page.evaluate(() => window.__updateUser.length)).toBe(0);
});

// --- SAVING REACHES THE DATABASE ---

test('saving writes the bio, flair and privacy to user_profiles', async ({ page }) => {
    await openProfile(page, {});
    await page.fill('#profile-bio', 'Frame data, mostly.');
    await page.fill('#profile-flair', 'Guide Writer');
    await page.check('#profile-private');
    await page.click('#btn-profile-save');

    await expect(page.locator('#profile-modal-overlay')).toHaveClass(/hidden/);
    const sent = await page.evaluate(() => window.__upserts);
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
        user_id: 'u1', bio: 'Frame data, mostly.',
        flair: 'Guide Writer', is_private: true,
    });
});

test('an empty bio is stored as NULL, not as an empty string', async ({ page }) => {
    // The column is nullable and get_public_profile returns it straight through.
    // '' and NULL would render differently for no reason a user could explain.
    await openProfile(page, { profileRow: { bio: 'old', flair: 'old', is_private: false } });
    await page.fill('#profile-bio', '');
    await page.fill('#profile-flair', '   ');
    await page.click('#btn-profile-save');
    const sent = await page.evaluate(() => window.__upserts);
    expect(sent[0].bio).toBeNull();
    expect(sent[0].flair).toBeNull();
});

test('no newline can reach the flair column', async ({ page }) => {
    // The CHECK constraint refuses \r\n because the flair renders inline beside
    // a name, and a newline would break that line everywhere it appears.
    //
    // CORRECTED while writing this: the first version asserted the handler
    // folded '\n' to a space, and it did not - it got 'ProPlayer'. An
    // <input type="text"> strips newlines itself, on assignment and on paste,
    // so the fold in the save handler never sees one. It stays as cheap
    // insurance for any other path into that field, but the browser is what
    // actually guarantees this, and the CHECK is what enforces it. Assert the
    // contract - no newline reaches the column - rather than a mechanism that
    // turned out not to be the one doing the work.
    await openProfile(page, {});
    await page.evaluate(() => {
        const el = document.getElementById('profile-flair');
        el.value = 'Pro\nPlayer';
        el.dispatchEvent(new Event('input'));
    });
    await page.click('#btn-profile-save');
    const sent = await page.evaluate(() => window.__upserts);
    expect(sent[0].flair).not.toMatch(/[\r\n]/);
    expect(sent[0].flair, 'and the text itself survives').toContain('Pro');
});

test('the display name still goes to auth metadata, not to the profile row', async ({ page }) => {
    // The one field that deliberately has no column in user_profiles. A second
    // copy here is what would need a sync, and the sync is what would need a
    // trigger on auth.users.
    await openProfile(page, {});
    await page.fill('#profile-new-name', 'Boomcat2');
    await page.click('#btn-profile-save');

    const calls = await page.evaluate(() => window.__updateUser);
    expect(calls).toEqual([{ data: { display_name: 'Boomcat2' } }]);
    const sent = await page.evaluate(() => window.__upserts);
    expect(sent[0].display_name, 'not smuggled into the row as well').toBeUndefined();
});

test('a blocked write explains itself instead of showing a Postgres string', async ({ page }) => {
    // 42501 on this table has exactly one cause: the WITH CHECK refusing a
    // soft-banned account. The old handler said "Check console."
    await openProfile(page, { upsertError: { code: '42501', message: 'new row violates row-level security policy' } });
    await page.fill('#profile-bio', 'hello');
    await page.click('#btn-profile-save');

    const feedback = page.locator('#profile-feedback');
    await expect(feedback).not.toHaveClass(/hidden/);
    await expect(feedback).toContainText('cannot post content');
    await expect(feedback).not.toContainText('row-level security');
    // And the modal stays open, so the text they typed is not thrown away.
    await expect(page.locator('#profile-modal-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#profile-bio')).toHaveValue('hello');
});

// --- THE COUNTERS ---

test('the character count follows what is typed', async ({ page }) => {
    await openProfile(page, {});
    await expect(page.locator('#profile-flair-count')).toHaveText('0/32');
    await page.fill('#profile-flair', 'Pro Player');
    await expect(page.locator('#profile-flair-count')).toHaveText('10/32');
    // At the cap it warns, which is the only reason the count is visible.
    await page.fill('#profile-flair', 'x'.repeat(32));
    await expect(page.locator('#profile-flair-count')).toHaveClass(/profile-count-full/);
});

test('the counters repaint when a stored profile loads', async ({ page }) => {
    // Populating the field with .value fires no input event, so a count bound
    // only to the listener would read 0/500 over a full bio.
    await openProfile(page, { profileRow: { bio: 'x'.repeat(120), flair: 'abc', is_private: false } });
    await expect(page.locator('#profile-bio-count')).toHaveText('120/500');
    await expect(page.locator('#profile-flair-count')).toHaveText('3/32');
});
