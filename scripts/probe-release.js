#!/usr/bin/env node
/**
 * Live probe for everything v0.14 added to the database.
 *
 * WHY THIS EXISTS. Playwright mocks Supabase in every auth spec - it never
 * touches real Postgres - so RLS, table grants and the caller checks inside
 * SECURITY DEFINER functions are the one part of this site the suite cannot
 * reach. v0.14 shipped 8 migrations, ~20 functions and a dozen policies, and
 * not one of those gates has been proven either to work or to refuse.
 *
 * A migration asserted but not probed is unverified.
 *
 * WHAT IT NEEDS. A URL and an anon key, and optionally two JWTs. It NEVER
 * wants the service-role key: that key bypasses RLS entirely, so a probe using
 * it would report success for exactly the rules it is meant to be testing, and
 * it must never appear in this repo or in CI.
 *
 *   SUPABASE_URL   the preview branch's URL
 *   ANON_KEY       that branch's anon key
 *   USER_JWT       optional: access token of a signed-in user with NO role
 *   ADMIN_JWT      optional: access token of an admin
 *
 * A JWT is the `access_token` in the Supabase session; both are short-lived.
 * Without them the authenticated cases are skipped and reported as skipped
 * rather than silently passing.
 *
 * WHAT IT CHECKS, in order of what each proves:
 *
 *   anon   -> must FAIL for anything not deliberately public. This is the case
 *             that catches a function created without REVOKE, which is exactly
 *             how the 2026-08-07 privilege escalation happened: Postgres
 *             grants EXECUTE to PUBLIC on creation, so every new RPC starts
 *             exposed.
 *   user   -> must fail with 42501 on anything staff-only.
 *   admin  -> must SUCCEED. The case that matters most and the one an
 *             over-tightened policy breaks invisibly, because nothing else on
 *             the site notices.
 *
 * Usage:
 *   node scripts/probe-release.js                  read-only probes
 *   node scripts/probe-release.js --include-writes also run mutating probes
 *
 * --include-writes is REFUSED against production. These probes create tier
 * lists, cast votes and write moderation rows; they are safe on a disposable
 * preview branch and are not safe on the live wiki.
 */

const PRODUCTION_REF = 'gtqswjspxymjdopljmfi';

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON_KEY = process.env.ANON_KEY || '';
const USER_JWT = process.env.USER_JWT || '';
const ADMIN_JWT = process.env.ADMIN_JWT || '';
const INCLUDE_WRITES = process.argv.includes('--include-writes');

if (!URL_BASE || !ANON_KEY) {
    console.error('Set SUPABASE_URL and ANON_KEY.\n');
    console.error('  SUPABASE_URL=https://<ref>.supabase.co ANON_KEY=<anon> node scripts/probe-release.js');
    process.exit(2);
}

if (INCLUDE_WRITES && URL_BASE.includes(PRODUCTION_REF)) {
    console.error('Refusing --include-writes against production.');
    console.error('These probes create tier lists, cast votes and write moderation rows.');
    console.error('Point SUPABASE_URL at a preview branch.');
    process.exit(2);
}

// --------------------------------------------------------------------------
// EXPECTATIONS
// --------------------------------------------------------------------------
//
// 'ok'      the call must succeed
// 'denied'  the call must be refused - 401/403 from a missing grant, or 42501
//           from the function's own caller check
// 'skip'    not meaningful for this identity
//
// `writes` marks a probe with side effects.

const RPC = [
    // --- deliberately public -------------------------------------------------
    { fn: 'can_moderate', args: {},
      anon: 'ok', user: 'ok', admin: 'ok',
      why: 'the discussions SELECT policy calls it for every reader, so anon must be able to' },
    { fn: 'can_delete_media', args: {},
      anon: 'ok', user: 'ok', admin: 'ok',
      why: 'same shape as can_moderate; narrower in what it returns, not in who may ask' },
    { fn: 'free_submit_eligibility', args: {},
      anon: 'ok', user: 'ok', admin: 'ok',
      why: 'a signed-out reader has to be told WHY there is no ballot' },
    { fn: 'get_free_submit_rankings', args: {},
      anon: 'ok', user: 'ok', admin: 'ok',
      why: 'the ranking is the page; anonymous readers are its audience' },

    // --- signed in, any role -------------------------------------------------
    { fn: 'remove_my_discussion_post', args: { p_post_id: '00000000-0000-0000-0000-000000000000' },
      anon: 'denied', user: 'ok', admin: 'ok', writes: true,
      why: 'an author may delete their own words; a missing post is P0002, not a refusal' },
    { fn: 'report_discussion_post',
      args: { p_post_id: '00000000-0000-0000-0000-000000000000', p_reason: 'spam', p_note: null },
      anon: 'denied', user: 'ok', admin: 'ok', writes: true,
      why: 'any signed-in reader may report' },
    { fn: 'submit_tier_votes', args: { p_votes: [] },
      anon: 'denied', user: 'ok', admin: 'ok', writes: true,
      why: 'an empty ballot returns early, so this probes the grant and the gate, not the write' },

    // --- staff only ----------------------------------------------------------
    { fn: 'list_content_reports', args: { p_status: 'open' },
      anon: 'denied', user: 'denied', admin: 'ok',
      why: 'reports name the people who filed them' },
    { fn: 'moderate_discussion_post',
      args: { p_post_id: '00000000-0000-0000-0000-000000000000', p_action: 'hide', p_reason: 'probe' },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true,
      why: 'the capability check is inside the function, not on the button' },
    { fn: 'resolve_content_report',
      args: { p_report_id: '00000000-0000-0000-0000-000000000000', p_status: 'resolved', p_note: 'probe' },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true },
    { fn: 'record_media_deletion', args: { p_path: 'probe-does-not-exist.webm', p_note: 'probe' },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true,
      why: 'narrower than can_moderate: admin or the explicit flag only' },
    { fn: 'list_personnel', args: {},
      anon: 'denied', user: 'denied', admin: 'ok',
      why: 'returns email addresses' },
    { fn: 'list_tier_lists', args: {},
      anon: 'denied', user: 'denied', admin: 'ok' },

    // --- admin only, and destructive if wrong --------------------------------
    { fn: 'assign_tier_list', args: { p_email: 'probe@example.invalid', p_slug: 'probe-slug', p_blurb: null },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true,
      why: 'grants trusted_editor as a side effect - a hole here hands out a role' },
    { fn: 'set_user_capability',
      args: { target_email: 'probe@example.invalid', capability: 'can_moderate', enabled: false },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true,
      why: 'the same shape as the 2026-08-07 escalation' },
    { fn: 'save_tier_list',
      args: { p_list_id: '00000000-0000-0000-0000-000000000000', p_tiers: [], p_reasoning: null, p_changes: [], p_intro: null },
      anon: 'denied', user: 'denied', admin: 'denied', writes: true,
      why: 'per-ROW ownership: even an admin is refused a list id that does not exist, and a non-owner is refused one that does' },
    { fn: 'anonymize_user_by_email', args: { target_email: 'probe@example.invalid' },
      anon: 'denied', user: 'denied', admin: 'ok', writes: true,
      why: 'hard-deletes an auth.users row' },
];

// Table reads. RLS and the table-level GRANT are independent gates, and a
// missing grant returns 401 BEFORE RLS is consulted - which looks like a
// broken policy and is not one. This project has been bitten by that twice.
const TABLES = [
    { table: 'page_discussions', anon: 'ok', user: 'ok', admin: 'ok',
      why: 'threads are public reading' },
    { table: 'tier_lists', anon: 'ok', user: 'ok', admin: 'ok' },
    { table: 'tier_list_changes', anon: 'ok', user: 'ok', admin: 'ok',
      why: 'the changelog is the argument for the ranking' },
    { table: 'tier_page_settings', anon: 'ok', user: 'ok', admin: 'ok' },
    { table: 'free_submit_tiers', anon: 'ok', user: 'ok', admin: 'ok' },
    { table: 'free_submit_votes', anon: 'denied', user: 'ok', admin: 'ok',
      why: 'THE ONE THAT MATTERS: raw votes are private. "you rated my main F" is a harassment vector, and anon has no grant at all' },
    { table: 'content_reports', anon: 'denied', user: 'denied', admin: 'ok' },
    { table: 'moderation_log', anon: 'denied', user: 'denied', admin: 'ok' },
];

// --------------------------------------------------------------------------

const IDENTITIES = [
    { id: 'anon', jwt: null },
    { id: 'user', jwt: USER_JWT },
    { id: 'admin', jwt: ADMIN_JWT },
];

async function call(path, { jwt, method = 'POST', body }) {
    const headers = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt || ANON_KEY}`,
        'Content-Type': 'application/json',
    };
    try {
        const res = await fetch(`${URL_BASE}${path}`, {
            method,
            headers,
            body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
        });
        const text = await res.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch (e) { payload = text; }
        return { status: res.status, payload };
    } catch (e) {
        return { status: 0, payload: String(e && e.message) };
    }
}

// A refusal is a 401/403, or a 4xx carrying Postgres' own 42501. A missing row
// (P0002) or a bad argument (22023) means the caller GOT IN and the function
// then complained about the data - which is a pass for "may call", and is why
// the probes use ids that do not exist.
function classify(result) {
    const code = result.payload && result.payload.code;
    if (result.status === 401 || result.status === 403) return 'denied';
    if (code === '42501') return 'denied';
    if (code === 'PGRST202' || code === 'PGRST205') return 'missing';
    if (result.status >= 200 && result.status < 300) return 'ok';
    if (code === 'P0002' || code === '22023' || code === '53400') return 'ok';
    return 'error';
}

const results = [];

async function probe(label, path, spec, body) {
    for (const identity of IDENTITIES) {
        const expected = spec[identity.id];
        if (!expected || expected === 'skip') continue;

        if (identity.id !== 'anon' && !identity.jwt) {
            results.push({ label, identity: identity.id, expected, actual: 'skipped', pass: null });
            continue;
        }

        const res = await call(path, { jwt: identity.jwt, method: body === undefined ? 'GET' : 'POST', body });
        const actual = classify(res);
        results.push({
            label, identity: identity.id, expected, actual,
            pass: actual === expected,
            detail: actual === expected ? '' : JSON.stringify(res.payload).slice(0, 160),
            why: spec.why,
        });
    }
}

(async () => {
    console.log(`\nProbing ${URL_BASE}`);
    console.log(`writes: ${INCLUDE_WRITES ? 'INCLUDED' : 'skipped (pass --include-writes on a preview branch)'}`);
    console.log(`user jwt: ${USER_JWT ? 'given' : 'MISSING'}   admin jwt: ${ADMIN_JWT ? 'given' : 'MISSING'}\n`);

    for (const spec of RPC) {
        if (spec.writes && !INCLUDE_WRITES) {
            results.push({ label: `rpc ${spec.fn}`, identity: '-', expected: '-', actual: 'skipped (write)', pass: null });
            continue;
        }
        await probe(`rpc ${spec.fn}`, `/rest/v1/rpc/${spec.fn}`, spec, spec.args);
    }

    for (const spec of TABLES) {
        await probe(`read ${spec.table}`, `/rest/v1/${spec.table}?select=*&limit=1`, spec, undefined);
    }

    // Between writing a migration and merging the release, EVERY v0.14 table
    // and function is absent - that is the documented normal state, not a
    // dozen findings. Saying so once is the difference between a tool that
    // reports and a tool that cries wolf.
    const attempted = results.filter(r => r.pass !== null);
    const missing = attempted.filter(r => r.actual === 'missing');
    if (attempted.length && missing.length > attempted.length * 0.6) {
        console.log('This database has not had the v0.14 migrations applied.');
        console.log(`${missing.length} of ${attempted.length} probes found no such table or function.\n`);
        console.log('That is the expected state for production before the release merges.');
        console.log('Point SUPABASE_URL at the release PR\'s preview branch instead - it is');
        console.log('the only place the whole accumulated migration set has run together.\n');
        process.exit(3);
    }

    const pad = (s, n) => String(s).padEnd(n);
    let failed = 0, skipped = 0, passed = 0;

    console.log(pad('PROBE', 34) + pad('AS', 7) + pad('EXPECT', 9) + pad('GOT', 10) + 'RESULT');
    console.log('-'.repeat(96));
    for (const r of results) {
        if (r.pass === null) { skipped++; }
        else if (r.pass) { passed++; }
        else { failed++; }

        const verdict = r.pass === null ? 'skip' : (r.pass ? 'pass' : 'FAIL');
        console.log(pad(r.label, 34) + pad(r.identity, 7) + pad(r.expected, 9) + pad(r.actual, 10) + verdict);
        if (r.pass === false) {
            if (r.why) console.log(`${' '.repeat(4)}why it matters: ${r.why}`);
            if (r.detail) console.log(`${' '.repeat(4)}${r.detail}`);
        }
    }

    console.log('-'.repeat(96));
    console.log(`${passed} passed, ${failed} failed, ${skipped} skipped\n`);

    if (skipped) {
        console.log('Skipped probes are NOT passes. Supply USER_JWT and ADMIN_JWT, and');
        console.log('pass --include-writes on a preview branch, to close the gap.\n');
    }

    process.exit(failed > 0 ? 1 : 0);
})();
