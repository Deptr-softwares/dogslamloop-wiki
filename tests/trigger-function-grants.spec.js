// A trigger function must never be left callable over the REST API.
//
// Postgres grants EXECUTE to PUBLIC on every function at creation. For an RPC
// that is the hazard the supabase-migration skill exists to catch; for a
// TRIGGER function it is pure noise - nothing should ever call it directly,
// and the call fails anyway (0A000, "trigger functions can only be called as
// triggers"). But five of them sat in the exposed schema until Supabase's
// linter pointed at them, and every one of those warnings was a place a real
// finding could have hidden.
//
// Static, with no database: it reads the migration files the same way
// tests/migration-columns.spec.js resolves column references, so it runs in
// the required `test` check rather than only against a preview branch.
//
// This does NOT police RPCs. Whether an ordinary SECURITY DEFINER function
// should be callable by anon or authenticated is a judgement about that
// function - most of this project's RPCs are deliberately granted to
// `authenticated` and guard the caller internally with a 42501. A trigger
// function has no such judgement to make: the answer is always no.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

function allMigrationSql() {
  return fs.readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ file: f, sql: fs.readFileSync(path.join(MIGRATIONS, f), 'utf8') }));
}

// Every function in `public` declared RETURNS trigger, by name. Quoting is
// inconsistent across this schema's history ("public"."fn" and public.fn both
// appear), so both forms are matched.
function declaredTriggerFunctions() {
  const found = new Set();
  const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\(\s*\)\s+RETURNS\s+"?trigger"?/gi;

  for (const { sql } of allMigrationSql()) {
    let m;
    while ((m = pattern.exec(sql)) !== null) found.add(m[1]);
  }
  return found;
}

test('the migrations declare trigger functions at all', () => {
  // Guards the guard. If the regex above stops matching - a formatting change
  // in how these are written, say - every assertion below passes vacuously
  // over an empty set, which is the failure mode this project keeps finding
  // in its own tests.
  const triggers = declaredTriggerFunctions();
  expect(triggers.size, 'no trigger functions matched; the pattern has drifted').toBeGreaterThan(0);
  expect(triggers.has('archive_page_version')).toBe(true);
});

test('every trigger function has its default PUBLIC grant revoked', () => {
  const sql = allMigrationSql().map(m => m.sql).join('\n');
  const missing = [];

  for (const fn of declaredTriggerFunctions()) {
    // The revoke may be written with or without quotes, and may live in a
    // later migration than the CREATE - which is the normal case, since
    // CREATE OR REPLACE preserves existing grants.
    const revoked = new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+"?public"?\\."?${fn}"?\\s*\\(\\s*\\)\\s+FROM\\s+PUBLIC`, 'i',
    ).test(sql);

    if (!revoked) missing.push(fn);
  }

  expect(
    missing,
    'these trigger functions are still callable at /rest/v1/rpc/. Add:\n'
    + missing.map(fn => `  REVOKE ALL ON FUNCTION "public"."${fn}"() FROM PUBLIC;`).join('\n'),
  ).toEqual([]);
});

test('the revokes name anon and authenticated too, not only PUBLIC', () => {
  // Revoking from PUBLIC does not remove a grant held directly by a role, and
  // Supabase's linter reports anon and authenticated separately for exactly
  // that reason. Both roles are named explicitly so the fix cannot be
  // half-applied.
  const sql = allMigrationSql().map(m => m.sql).join('\n');
  const incomplete = [];

  for (const fn of declaredTriggerFunctions()) {
    for (const role of ['anon', 'authenticated']) {
      const ok = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+"?public"?\\."?${fn}"?\\s*\\(\\s*\\)\\s+FROM\\s+"?${role}"?`, 'i',
      ).test(sql);
      if (!ok) incomplete.push(`${fn} (${role})`);
    }
  }

  expect(incomplete).toEqual([]);
});
