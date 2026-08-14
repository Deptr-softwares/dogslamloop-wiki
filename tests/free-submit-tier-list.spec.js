// The Free Submit Tier List (v0.14 item 4).
//
// The community's ranking, and the whole point of the feature is that it is
// resistant to a 1.4M-member Discord being told to go and rate somebody S. So
// most of what follows is not "does the board draw" - it is whether the two
// things that make a brigade visible survive: the sample size on every
// character, and the distribution behind the median.
//
// WHAT THIS FILE CANNOT REACH, and what is probed live instead:
//   * UNIQUE(user_id, character_id) - one vote per account, enforced by
//     Postgres. A mock cannot violate a constraint that does not exist here.
//   * The eligibility gate, which reads auth.users.created_at.
//   * The medians themselves, which are percentile_disc/percentile_cont in SQL.
//   * That there is no INSERT or UPDATE grant on the votes table.
// The last block of tests reads the migration for the structural half of
// those, which is the most a suite with no database can honestly claim.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/tools/free-submit-tier-list/index.html';

// Character ids are read from the roster rather than written in, so adding or
// renaming a character never breaks this file. Pinning owner content into
// tests has blocked the owner from editing the site before.
const NAV = require('../data/navigation.json');
const CHARS = (NAV.Characters || [])
    .map(e => e.cms_config && e.cms_config.pageId)
    .filter(Boolean);

const SCALE = [
    { tier: 'S', rank: 6, color: 'hsl(0, 80%, 60%)' },
    { tier: 'A', rank: 5, color: 'hsl(30, 80%, 60%)' },
    { tier: 'B', rank: 4, color: 'hsl(60, 80%, 60%)' },
    { tier: 'C', rank: 3, color: 'hsl(120, 60%, 60%)' },
    { tier: 'D', rank: 2, color: 'hsl(210, 80%, 60%)' },
    { tier: 'F', rank: 1, color: 'hsl(300, 80%, 60%)' },
];

const eligible = (over = {}) => ({
    eligible: true,
    reason: null,
    voting_open: true,
    account_age_days: 120,
    contributions: 3,
    votes_cast: 0,
    min_votes_to_rank: 10,
    ...over,
});

async function mockTool(page, {
    rankings = [],
    gate = eligible(),
    myVotes = [],
    session = { user: { id: 'voter-1', email: 'voter@example.com' } },
    rankingError = null,
    submitError = null,
} = {}) {
    await page.addInitScript((cfg) => {
        window.__fsCalls = { rpc: [], deletes: [] };

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
                    client.auth.getSession = async () => ({ data: { session: cfg.session } });

                    client.rpc = async (name, params) => {
                        window.__fsCalls.rpc.push({ name, params });
                        if (name === 'get_free_submit_rankings') {
                            return cfg.rankingError
                                ? { data: null, error: cfg.rankingError }
                                : { data: cfg.rankings, error: null };
                        }
                        if (name === 'free_submit_eligibility') {
                            return { data: [cfg.gate], error: null };
                        }
                        if (name === 'submit_tier_votes') {
                            return cfg.submitError
                                ? { data: null, error: cfg.submitError }
                                : { data: 'Saved.', error: null };
                        }
                        return { data: null, error: null };
                    };

                    client.from = (table) => {
                        if (table === 'free_submit_tiers') {
                            const chain = {
                                select() { return chain; },
                                order() { return chain; },
                                then(resolve) { return resolve({ data: cfg.scale, error: null }); },
                            };
                            return chain;
                        }
                        if (table === 'free_submit_votes') {
                            const record = { ids: null };
                            const chain = {
                                select() { return chain; },
                                delete() { record.deleting = true; return chain; },
                                eq() { return chain; },
                                in(_col, ids) { record.ids = ids; return chain; },
                                then(resolve) {
                                    if (record.deleting) {
                                        window.__fsCalls.deletes.push(record.ids);
                                        return resolve({ data: null, error: null });
                                    }
                                    return resolve({ data: cfg.myVotes, error: null });
                                },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (r) => r({ data: [], error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    return client;
                };
            },
        });
    }, { rankings, gate, myVotes, session, rankingError, submitError, scale: SCALE });
}

test.describe('the board', () => {
    test.skip(CHARS.length < 4, 'needs at least four characters on the roster');

    test('a character sits in its median tier, and its sample size is on its face', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 412, median_tier: 'S', median_rank: 5.5, distribution: { S: 300, A: 112 }, ranked: true },
                { character_id: CHARS[1], vote_count: 88, median_tier: 'C', median_rank: 3, distribution: { C: 88 }, ranked: true },
            ],
        });
        await page.goto(PAGE);

        const sRow = page.locator('.fs-tier-row').filter({ has: page.locator('.fs-tier-label', { hasText: /^S$/ }) });
        await expect(sRow.locator(`.fs-entry[data-character="${CHARS[0]}"]`)).toBeVisible();

        const cRow = page.locator('.fs-tier-row').filter({ has: page.locator('.fs-tier-label', { hasText: /^C$/ }) });
        await expect(cRow.locator(`.fs-entry[data-character="${CHARS[1]}"]`)).toBeVisible();

        // The number that makes the placement readable at all. Without it "S
        // tier" from nine people looks identical to "S tier" from four hundred.
        await expect(page.locator(`.fs-entry[data-character="${CHARS[0]}"] .fs-entry-count`))
            .toHaveText('412 votes');
    });

    test('a character below the floor is shown as unplaced, not omitted', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 4, median_tier: 'S', median_rank: 6, distribution: { S: 4 }, ranked: false },
            ],
        });
        await page.goto(PAGE);

        // Not in S, despite having a median of S - four votes is not a ranking.
        const sRow = page.locator('.fs-tier-row').filter({ has: page.locator('.fs-tier-label', { hasText: /^S$/ }) });
        await expect(sRow.locator(`.fs-entry[data-character="${CHARS[0]}"]`)).toHaveCount(0);

        const pending = page.locator('.fs-tier-row-pending');
        await expect(pending.locator(`.fs-entry[data-character="${CHARS[0]}"]`)).toBeVisible();
        await expect(pending.locator('.fs-pending-note')).toContainText('10 needed');
    });

    // Owner's call, 2026-08-14: within a tier, strongest on the left. A tier
    // row is otherwise an unordered heap, and "which of these three B-tiers is
    // the best B" is a real question a reader asks of a tier list.
    test('inside a tier, characters run strongest to weakest left to right', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                // Returned worst-first on purpose, so passing cannot come from
                // the page simply echoing the order the RPC handed it back.
                { character_id: CHARS[0], vote_count: 40, median_tier: 'B', median_rank: 3.6, distribution: { B: 40 }, ranked: true },
                { character_id: CHARS[1], vote_count: 40, median_tier: 'B', median_rank: 4.4, distribution: { B: 40 }, ranked: true },
                { character_id: CHARS[2], vote_count: 40, median_tier: 'B', median_rank: 4.0, distribution: { B: 40 }, ranked: true },
            ],
        });
        await page.goto(PAGE);

        const bRow = page.locator('.fs-tier-row').filter({ has: page.locator('.fs-tier-label', { hasText: /^B$/ }) });
        // evaluateAll does NOT auto-wait, so the board has to be settled first
        // or this reads a half-rendered row under load and blames the sort.
        await expect(bRow.locator('.fs-entry')).toHaveCount(3);

        const order = await bRow.locator('.fs-entry').evaluateAll(
            nodes => nodes.map(n => n.dataset.character));
        expect(order).toEqual([CHARS[1], CHARS[2], CHARS[0]]);
    });

    test('two characters the community rates the same are split by sample size', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 12, median_tier: 'A', median_rank: 5, distribution: { A: 12 }, ranked: true },
                { character_id: CHARS[1], vote_count: 300, median_tier: 'A', median_rank: 5, distribution: { A: 300 }, ranked: true },
            ],
        });
        await page.goto(PAGE);

        const aRow = page.locator('.fs-tier-row').filter({ has: page.locator('.fs-tier-label', { hasText: /^A$/ }) });
        await expect(aRow.locator('.fs-entry')).toHaveCount(2);

        const order = await aRow.locator('.fs-entry').evaluateAll(
            nodes => nodes.map(n => n.dataset.character));
        // The better-attested one leads, rather than the order being arbitrary.
        expect(order).toEqual([CHARS[1], CHARS[0]]);
    });

    test('every character on the roster appears somewhere, voted or not', async ({ page }) => {
        await mockTool(page, { rankings: [] });
        await page.goto(PAGE);

        // Derived from the roster rather than a pinned number, so this stays
        // true when the owner adds a character.
        await expect(page.locator('.fs-entry')).toHaveCount(CHARS.length);
    });
});

test.describe('the distribution', () => {
    test.skip(CHARS.length < 4, 'needs at least four characters on the roster');

    // The single most important test in this file. A median reports the middle,
    // and a split community and a unanimous one have the SAME middle - so two
    // characters with the same median tier must not render the same chart. If
    // they do, the distribution is decoration and a brigade is invisible.
    test('two characters with the same median render different spreads', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 100, median_tier: 'B', median_rank: 4, distribution: { B: 100 }, ranked: true },
                { character_id: CHARS[1], vote_count: 100, median_tier: 'B', median_rank: 4, distribution: { S: 50, F: 50 }, ranked: true },
            ],
        });
        await page.goto(PAGE);

        const counts = async (id) => {
            await page.locator(`.fs-entry[data-character="${id}"]`).click();
            await expect(page.locator('.fs-chart')).toBeVisible();
            return page.locator('.fs-chart-count').allTextContents();
        };

        const unanimous = await counts(CHARS[0]);
        const split = await counts(CHARS[1]);

        expect(unanimous).not.toEqual(split);
        // Scale order is S A B C D F, so index 2 is B and 0/5 are S and F.
        expect(unanimous[2]).toBe('100');
        expect(split[0]).toBe('50');
        expect(split[5]).toBe('50');
    });

    test('the summary names the median and the sample size together', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 37, median_tier: 'A', median_rank: 5, distribution: { A: 37 }, ranked: true },
            ],
        });
        await page.goto(PAGE);

        await page.locator(`.fs-entry[data-character="${CHARS[0]}"]`).click();
        await expect(page.locator('.fs-detail-summary')).toHaveText('Median A, from 37 votes.');
    });
});

test.describe('the gate', () => {
    test.skip(CHARS.length < 4, 'needs at least four characters on the roster');

    test('a signed-out reader gets the reason and a way in, and no ballot', async ({ page }) => {
        await mockTool(page, {
            session: null,
            gate: eligible({ eligible: false, reason: 'Sign in to rate characters.' }),
        });
        await page.goto(PAGE);

        await expect(page.locator('.fs-gate-note')).toHaveText('Sign in to rate characters.');
        await expect(page.locator('.fs-choice')).toHaveCount(0);
        await expect(page.locator('.fs-ballot-section a', { hasText: 'SIGN IN' })).toBeVisible();

        // The board is still there. Reading the community's answer needs no
        // account - only adding to it does.
        await expect(page.locator('.fs-board .fs-tier-row').first()).toBeVisible();
    });

    test('a too-new account is told the rule, not shown a broken form', async ({ page }) => {
        await mockTool(page, {
            gate: eligible({
                eligible: false,
                reason: 'Voting opens once your account is 7 days old, or as soon as one of your edits is approved.',
                account_age_days: 2,
                contributions: 0,
            }),
        });
        await page.goto(PAGE);

        await expect(page.locator('.fs-gate-note')).toContainText('7 days old');
        await expect(page.locator('.fs-choice')).toHaveCount(0);
        // Why the rule exists, so a refusal does not read as a bug.
        await expect(page.locator('.fs-gate-why')).toContainText('community');
    });

    test('closed voting refuses new ratings but keeps the ranking readable', async ({ page }) => {
        await mockTool(page, {
            rankings: [
                { character_id: CHARS[0], vote_count: 50, median_tier: 'S', median_rank: 6, distribution: { S: 50 }, ranked: true },
            ],
            gate: eligible({ eligible: false, reason: 'Voting is closed right now.', voting_open: false }),
        });
        await page.goto(PAGE);

        await expect(page.locator('.fs-choice')).toHaveCount(0);
        await expect(page.locator(`.fs-entry[data-character="${CHARS[0]}"] .fs-entry-count`)).toHaveText('50 votes');
    });
});

test.describe('the ballot', () => {
    test.skip(CHARS.length < 4, 'needs at least four characters on the roster');

    test('an eligible voter gets a row per character and cannot save nothing', async ({ page }) => {
        await mockTool(page);
        await page.goto(PAGE);

        await expect(page.locator('.fs-ballot-row')).toHaveCount(CHARS.length);
        await expect(page.locator('#fs-save')).toBeDisabled();
    });

    test('existing ratings come back pressed', async ({ page }) => {
        await mockTool(page, { myVotes: [{ character_id: CHARS[0], tier: 'A' }] });
        await page.goto(PAGE);

        const row = page.locator('.fs-ballot-row').filter({ has: page.locator(`.fs-choice[data-vote="${CHARS[0]}"]`) });
        await expect(row.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="A"]`))
            .toHaveAttribute('aria-pressed', 'true');
    });

    // Driving the real control, not asserting that it rendered. The save
    // button's own label is the thing a voter reads to know what is pending.
    test('rating a character arms the save button with a change count', async ({ page }) => {
        await mockTool(page);
        await page.goto(PAGE);

        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="S"]`).click();
        await expect(page.locator('#fs-save')).toBeEnabled();
        await expect(page.locator('#fs-save')).toHaveText('SAVE 1 CHANGE');

        await page.locator(`.fs-choice[data-vote="${CHARS[1]}"][data-tier="F"]`).click();
        await expect(page.locator('#fs-save')).toHaveText('SAVE 2 CHANGES');

        // Changing your mind about the same character is still one change, not
        // two - which is the client half of one vote per person.
        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="B"]`).click();
        await expect(page.locator('#fs-save')).toHaveText('SAVE 2 CHANGES');
    });

    test('re-picking the tier you already saved stops being a change', async ({ page }) => {
        await mockTool(page, { myVotes: [{ character_id: CHARS[0], tier: 'A' }] });
        await page.goto(PAGE);

        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="S"]`).click();
        await expect(page.locator('#fs-save')).toHaveText('SAVE 1 CHANGE');

        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="A"]`).click();
        await expect(page.locator('#fs-save')).toBeDisabled();
    });

    test('saving sends exactly the changed ratings and nothing else', async ({ page }) => {
        await mockTool(page, { myVotes: [{ character_id: CHARS[2], tier: 'D' }] });
        await page.goto(PAGE);

        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="S"]`).click();
        await page.locator('#fs-save').click();

        await expect.poll(async () => (await page.evaluate(
            () => window.__fsCalls.rpc.filter(c => c.name === 'submit_tier_votes').length
        ))).toBe(1);

        const sent = await page.evaluate(() =>
            window.__fsCalls.rpc.find(c => c.name === 'submit_tier_votes').params.p_votes);
        // The untouched character is not resubmitted - a save is a diff.
        expect(sent).toEqual([{ character_id: CHARS[0], tier: 'S' }]);
    });

    test('withdrawing a rating deletes it rather than going through the gated RPC', async ({ page }) => {
        await mockTool(page, { myVotes: [{ character_id: CHARS[0], tier: 'A' }] });
        await page.goto(PAGE);

        // The "no opinion" button, which is what makes a rating retractable.
        await page.locator(`.fs-choice-clear[data-vote="${CHARS[0]}"]`).click();
        await page.locator('#fs-save').click();

        await expect.poll(async () => (await page.evaluate(() => window.__fsCalls.deletes.length))).toBe(1);

        const removed = await page.evaluate(() => window.__fsCalls.deletes[0]);
        expect(removed).toEqual([CHARS[0]]);

        // Taking an opinion back is not a submission, so it never asks the
        // gate - it works even when voting is closed.
        const submits = await page.evaluate(() =>
            window.__fsCalls.rpc.filter(c => c.name === 'submit_tier_votes').length);
        expect(submits).toBe(0);
    });

    test('a refusal from the database is shown to the voter, not swallowed', async ({ page }) => {
        await mockTool(page, {
            submitError: { message: 'Slow down - you can save your ratings once every 20 seconds.', code: '53400' },
        });
        await page.goto(PAGE);

        await page.locator(`.fs-choice[data-vote="${CHARS[0]}"][data-tier="S"]`).click();
        await page.locator('#fs-save').click();

        await expect(page.locator('.fs-ballot-status')).toContainText('once every 20 seconds');
        // And the voter can try again rather than being left with a dead button.
        await expect(page.locator('#fs-save')).toBeEnabled();
    });
});

test('the page says so plainly before the migration has been applied', async ({ page }) => {
    await mockTool(page, {
        rankingError: { message: 'Could not find the function', code: 'PGRST202' },
    });
    await page.goto(PAGE);

    await expect(page.locator('.fs-tool')).toContainText('arrives with the next release');
});

// --------------------------------------------------------------------------
// THE SCHEMA'S OWN CLAIMS
// --------------------------------------------------------------------------
//
// Read from the migration, because a browser cannot reach any of it and a
// mocked client will happily pretend all of it is true. This is the structural
// half; the behavioural half is a live probe against the release preview.
test.describe('the migration', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260814000001_free_submit_tier_list.sql'),
        'utf8'
    );

    test('one vote per account per character is a database constraint', () => {
        expect(sql).toMatch(/UNIQUE\s*\(\s*"user_id"\s*,\s*"character_id"\s*\)/);
    });

    test('the aggregate is a median, and no mean is computed anywhere', () => {
        expect(sql).toContain('percentile_disc(0.5)');
        expect(sql).toContain('percentile_cont(0.5)');
        // The one thing that must never appear: a mean moves the moment a
        // coordinated block votes, which is the entire vulnerability.
        expect(sql).not.toMatch(/\bavg\s*\(/i);
    });

    test('votes can only be written through the gated RPC', () => {
        // No INSERT or UPDATE grant on the table means no client can skip the
        // eligibility check, whatever it sends.
        const grants = sql.match(/GRANT[^;]*ON TABLE "public"\."free_submit_votes"[^;]*;/g) || [];
        expect(grants.length).toBeGreaterThan(0);
        grants.forEach(g => {
            expect(g).not.toMatch(/\bINSERT\b/);
            expect(g).not.toMatch(/\bUPDATE\b/);
        });
    });

    test('anonymous callers cannot read individual votes', () => {
        const grants = sql.match(/GRANT[^;]*ON TABLE "public"\."free_submit_votes"[^;]*;/g) || [];
        grants.forEach(g => expect(g).not.toMatch(/TO "anon"/));
    });

    test('every new function revokes the default PUBLIC grant', () => {
        ['free_submit_eligibility', 'submit_tier_votes', 'get_free_submit_rankings'].forEach(fn => {
            const revoke = new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"[^;]*FROM PUBLIC;`);
            expect(sql).toMatch(revoke);
        });
    });

    test('the writing RPC is closed to anonymous callers outright', () => {
        expect(sql).toMatch(/REVOKE ALL ON FUNCTION "public"\."submit_tier_votes"\(jsonb\) FROM "anon";/);
        expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION "public"\."submit_tier_votes"\(jsonb\) TO "anon";/);
    });

    // The owner's switch, 2026-08-14. The claim worth pinning is not that a
    // setting exists, but that BOTH answers still return a tier somebody
    // actually voted - which is why the option is which middle vote wins
    // rather than disc-versus-cont.
    test('both tie-break settings place a character on a real vote', () => {
        expect(sql).toContain('percentile_disc(0.5) WITHIN GROUP (ORDER BY c.rank)');
        expect(sql).toContain('percentile_disc(0.5) WITHIN GROUP (ORDER BY c.rank DESC)');
        // Never rounded into a tier nobody chose.
        expect(sql).not.toMatch(/round\s*\(\s*.*cont_rank/i);
        expect(sql).not.toMatch(/(ceil|floor)\s*\(\s*.*cont_rank/i);
    });

    test('the tie-break column only accepts the two offered answers', () => {
        expect(sql).toMatch(/CHECK\s*\(\s*"free_submit_tie_break" = ANY \(ARRAY\['lower'::text, 'higher'::text\]\)\s*\)/);
    });

    test('the continuous median is used for ordering and never for placement', () => {
        // It is joined to a tier through low_rank/high_rank, never cont_rank -
        // cont_rank for an even split is a number like 4.5, which is not a tier.
        expect(sql).toMatch(/ON t\.rank = CASE WHEN s\.tie_break = 'higher' THEN a\.high_rank ELSE a\.low_rank END/);
        expect(sql).not.toMatch(/t\.rank = a\.cont_rank/);
    });

    test('the soft ban is honoured with IS NOT DISTINCT FROM, not =', () => {
        // get_my_role() returns NULL for a signed-in user with no role, and the
        // obvious operator would deny every ordinary contributor.
        expect(sql).toMatch(/my_role IS NOT DISTINCT FROM 'viewer'/);
    });
});
