// A SECURITY DEFINER function that writes must check its caller.
//
// v0.18 A4. The owner ran Supabase's advisors on 2026-09-09 and got 44 warnings
// across three lint names. All 44 are by design - the triage is in
// V0.18-DEVLOG.md - and the same audit had already been run on 2026-08-19
// (20260819000000_revoke_trigger_function_grants.sql). Twice now the answer has
// been "this is the architecture working", and both times that answer had to be
// re-derived by hand from 40-odd function bodies.
//
// The risk in an audit whose answer is always "fine" is that the one warning
// that is NOT fine looks exactly like the other 43. Lint 0029 fires on every
// RPC this project has, so it cannot distinguish `assign_role_by_email` (guarded
// with a 42501 inside) from a new RPC that forgot. Postgres grants EXECUTE to
// PUBLIC on creation, which is precisely how the 2026-08-07 privilege
// escalation happened.
//
// So this asserts the invariant that makes the warnings dismissible, rather
// than the warnings themselves:
//
//   1. every writing SECURITY DEFINER function raises 42501    - no exemptions
//   2. the anon-executable set is an allowlist with stated reasons
//
// Static, with no database, like tests/migration-columns.spec.js and
// tests/trigger-function-grants.spec.js - so it runs in the required `test`
// check rather than only against a preview branch. It is the companion to
// trigger-function-grants.spec.js, whose header says "This does NOT police
// RPCs". This does.
//
// IT READS THE LAST DEFINITION, NOT ANY DEFINITION. Grepping
// supabase/migrations/ finds historical text rather than deployed state -
// save_tier_list is defined in five migrations and the oldest still reads
// `get_my_role() = 'admin'`. Resolving in version order is the whole reason
// this is a parser and not three greps.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

// name -> { file, body, definer, trigger }, last definition wins.
function resolveFunctions() {
    const latest = new Map();
    const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
        const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\(/gi;
        let m;
        while ((m = re.exec(sql)) !== null) {
            // Walk the argument list to its matching paren - argument types
            // contain parens themselves (numeric(10,2), uuid[]), so a lazy
            // match to the first ")" truncates the header and loses the
            // SECURITY DEFINER that follows it.
            let i = m.index + m[0].length - 1;
            let depth = 0;
            for (; i < sql.length; i++) {
                if (sql[i] === '(') depth++;
                else if (sql[i] === ')') { depth--; if (depth === 0) break; }
            }

            // The body opens at a dollar-quote tag after AS. `AS` is written on
            // its own line throughout this schema, so anything anchored on a
            // leading space matches nothing and reports every function clean -
            // which is exactly what the first draft of this parser did.
            const asM = /\bAS\s*(\$[a-z_]*\$)/i.exec(sql.slice(i, i + 4000));
            if (!asM) continue;
            const tag = asM[1];
            const start = i + asM.index + asM[0].length;
            const end = sql.indexOf(tag, start);
            if (end === -1) continue;

            const header = sql.slice(i, i + asM.index);
            latest.set(name(m), {
                file,
                // Comments quote the things being forbidden - "never grant this
                // to anon" - so parsing prose as SQL is how v0.16 lost a round.
                body: sql.slice(start, end).replace(/--[^\n]*/g, ' '),
                definer: /SECURITY\s+DEFINER/i.test(header),
                trigger: /RETURNS\s+"?trigger"?/i.test(header),
            });
        }
    }
    return latest;

    function name(m) { return m[1]; }
}

// Final grant state: a REVOKE in a later migration beats an earlier GRANT, and
// within one file source order decides. Revoking from PUBLIC does NOT drop a
// grant held directly by a role, which is why the linter reports anon and
// authenticated separately and why that case is skipped here.
function anonExecutable(latest) {
    const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
    const roles = new Map();

    for (const file of files) {
        const code = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, ' ');
        const events = [];
        let m;

        const grant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\([^)]*\)\s+TO\s+"?([a-z_]+)"?/gi;
        while ((m = grant.exec(code)) !== null) events.push([m.index, 'grant', m[1], m[2].toLowerCase()]);

        const revoke = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\([^)]*\)\s+FROM\s+"?([a-z_]+)"?/gi;
        while ((m = revoke.exec(code)) !== null) events.push([m.index, 'revoke', m[1], m[2].toLowerCase()]);

        events.sort((a, b) => a[0] - b[0]);
        for (const [, kind, fn, role] of events) {
            if (!roles.has(fn)) roles.set(fn, new Set());
            if (kind === 'grant') roles.get(fn).add(role);
            else if (role !== 'public') roles.get(fn).delete(role);
        }
    }

    return [...latest.entries()]
        .filter(([fn, meta]) => meta.definer && !meta.trigger && (roles.get(fn) || new Set()).has('anon'))
        .map(([fn]) => fn)
        .sort();
}

// Every one of these is reachable without signing in, on purpose. The reason
// matters more than the entry: four of them are called from RLS POLICY
// expressions, where revoking EXECUTE does not deny a row but raises
// `permission denied for function` instead - an error page rather than an empty
// list. That revoke broke the Certified Tier List for logged-out readers in
// v0.17 pass 1, and 20260903000001_page_experts.sql:102-108 documents it.
const ANON_BY_DESIGN = {
    can_delete_media: 'read by a storage.objects policy evaluated as the querying role',
    can_moderate: 'read by RLS policies that carry no TO clause',
    can_review_page: 'read by both pending_revisions policies, which carry no TO clause',
    get_my_role: 'read by RLS policies that carry no TO clause',
    free_submit_eligibility: 'the anonymous Free Submit Tier List tool',
    get_free_submit_rankings: 'the anonymous Free Submit Tier List tool',
    get_page_experts: 'the page-expert badge, which renders for every reader',
    get_public_profile: 'public profile read; privacy is applied to the content, not the caller',
    get_public_profiles: 'the batched form of the same public read',
    get_user_expert_pages: 'public expertise list on a profile',
};

test('the parser resolves this schema at all', () => {
    // Guards the guard. Every assertion below is a filter over this map, so a
    // pattern that stops matching makes all of them pass over an empty set -
    // the failure mode this project keeps finding in its own tests, and the one
    // the first draft of this file actually had.
    const latest = resolveFunctions();
    const definers = [...latest.values()].filter(f => f.definer && !f.trigger);

    expect(latest.size, 'no functions matched; the CREATE FUNCTION pattern has drifted')
        .toBeGreaterThan(30);
    expect(definers.length, 'no SECURITY DEFINER functions matched; the header pattern has drifted')
        .toBeGreaterThan(25);

    // A known guarded function, a known unguarded one, and a known body - so a
    // parser that returns empty bodies cannot pass this file.
    expect(latest.has('assign_role_by_email')).toBe(true);
    expect(latest.get('assign_role_by_email').body).toContain('42501');
    expect(latest.get('get_page_experts').body.length).toBeGreaterThan(50);
});

test('every writing SECURITY DEFINER function checks its caller', () => {
    // THE PRIVILEGE-ESCALATION CHECK. No allowlist on purpose: a function that
    // changes data and does not raise 42501 is relying on its GRANT alone, and
    // the GRANT is `authenticated` - which is every registered account.
    //
    // Reads are excluded because their authorisation is a different shape -
    // get_public_profile is SECURITY DEFINER so it can read auth.users, and it
    // filters the CONTENT it returns rather than refusing the caller.
    const latest = resolveFunctions();
    const unguarded = [];

    for (const [fn, meta] of latest) {
        if (!meta.definer || meta.trigger) continue;
        const writes = /\b(INSERT\s+INTO|UPDATE\s+"?[a-z_]+"?\."?[a-z_]+"?\s+SET|DELETE\s+FROM)\b/i
            .test(meta.body);
        if (writes && !/42501/.test(meta.body)) unguarded.push(`${fn} (${meta.file})`);
    }

    expect(
        unguarded,
        'these SECURITY DEFINER functions write without a caller check. Add, as the\n'
        + 'first statement in the body:\n\n'
        + "  IF \"public\".\"is_owner\"() IS NOT TRUE THEN\n"
        + "      RAISE EXCEPTION 'Permission denied: ...' USING ERRCODE = '42501';\n"
        + '  END IF;\n\n'
        + 'Never test a role by name - use role_rank()/is_staff()/is_owner().\n',
    ).toEqual([]);
});

test('the anon-executable set is exactly the documented allowlist', () => {
    // Postgres grants EXECUTE to PUBLIC at creation, so a new RPC starts
    // reachable by anon unless the migration revokes it. This is what turns
    // that from a thing somebody notices in an annual audit into a failing
    // check on the PR that introduces it.
    const actual = anonExecutable(resolveFunctions());
    const allowed = Object.keys(ANON_BY_DESIGN).sort();

    const added = actual.filter(fn => !ANON_BY_DESIGN[fn]);
    expect(
        added,
        'these SECURITY DEFINER functions became callable WITHOUT SIGNING IN.\n'
        + 'If that is intended, add each to ANON_BY_DESIGN with the reason.\n'
        + 'If it is not, the migration needs:\n'
        + '  REVOKE ALL ON FUNCTION "public"."<fn>"(<args>) FROM PUBLIC;\n'
        + '  REVOKE ALL ON FUNCTION "public"."<fn>"(<args>) FROM "anon";\n',
    ).toEqual([]);

    // Both directions. An entry that no longer resolves means the allowlist is
    // describing a schema that has moved on, and a stale allowlist is how the
    // next real addition gets waved through.
    const stale = allowed.filter(fn => !actual.includes(fn));
    expect(stale, 'ANON_BY_DESIGN names functions that are no longer anon-executable').toEqual([]);
});

test('the four policy-read functions keep their anon grant', () => {
    // The positive form of the rule above, and the one that actually bites.
    // Revoking any of these does not deny a row - it raises `permission denied
    // for function` for logged-out readers, which is an error page rather than
    // an empty list. Asserting only "nothing was added" would survive the
    // deletion that breaks the site, which is this project's most-repeated test
    // failure.
    const actual = anonExecutable(resolveFunctions());

    for (const fn of ['can_review_page', 'can_moderate', 'can_delete_media', 'get_my_role']) {
        expect(actual, `${fn} is read by an RLS policy with no TO clause; anon must keep EXECUTE`)
            .toContain(fn);
    }
});
