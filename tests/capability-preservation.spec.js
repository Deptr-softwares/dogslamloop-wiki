// Changing a role must not silently discard the person's capabilities.
//
// Owner-reported, 2026-09-04: "The buttons to grant perks in the owner tools
// when clicked on and then I hit Apply, nothing changed. I checked the table in
// the Supabase Dashboard and they are all still FALSE."
//
// assign_role_by_email was DELETE-then-INSERT, and the INSERT named
// (user_id, role). bypass_cooldown, can_moderate and can_delete_media came back
// as their column defaults every time a role was applied. set_user_capability
// had written TRUE correctly moments earlier; APPLY threw the row away. Two
// tools that each worked, in an order that lost data - which is why nothing
// errored and why it survived from 20260808 to now.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres agrees. RLS, grants and RPC
// bodies are invisible to this suite (see the supabase-migration skill), so the
// preview branch and the production probe are what verify the behaviour. These
// tests keep the TEXT honest, and they are written against whichever definition
// is live rather than against the file that happens to fix it today - a future
// migration reintroducing the delete should fail here.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

// Replay every migration in order and keep the last body that wins. Same shape
// as livePolicies() in role-ladder-sweep.spec.js, and for the same reason:
// pinning the assertion to one filename makes it stop testing anything the
// moment somebody writes the next CREATE OR REPLACE.
function liveFunction(name) {
    let body = null;
    let source = null;
    const open = new RegExp(`CREATE OR REPLACE FUNCTION\\s+"public"\\."${name}"`, 'g');

    for (const f of files) {
        const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
        let match;
        open.lastIndex = 0;
        while ((match = open.exec(sql)) !== null) {
            // From the declaration to the end of its dollar-quoted body.
            const rest = sql.slice(match.index);
            const end = rest.search(/\$\$;/);
            if (end === -1) continue;
            body = rest.slice(0, end);
            source = f;
        }
    }
    return { body, source };
}

const ASSIGN = liveFunction('assign_role_by_email');

test('a live definition of assign_role_by_email was actually found', () => {
    // Guards every assertion below: a regex that silently matches nothing would
    // make the rest of this file pass while testing air.
    expect(ASSIGN.source, 'no migration defines assign_role_by_email').toBeTruthy();
    expect(ASSIGN.body).toContain('user_roles');
});

test('applying a role does not delete the row it is applied to', () => {
    // The bug in one line. A DELETE reachable on the assign path takes the
    // capability columns with it, whatever the INSERT afterwards names.
    const nullBranch = ASSIGN.body.search(/IF\s+assigned_role\s+IS\s+NULL\s+THEN/i);
    const del = ASSIGN.body.search(/DELETE\s+FROM\s+public\.user_roles/i);

    expect(nullBranch, 'the revoke branch should exist').toBeGreaterThan(-1);
    expect(del, 'a delete should still exist, for revoking').toBeGreaterThan(-1);
    expect(del, 'the delete must sit INSIDE the revoke branch, not above it')
        .toBeGreaterThan(nullBranch);
});

test('revoking still removes the row, capabilities included', () => {
    // The other direction, and deliberately asserted rather than assumed: with
    // no role there is nothing for a capability to extend, and leaving the flags
    // behind would silently re-arm them the moment a role came back.
    const nullBranch = ASSIGN.body.search(/IF\s+assigned_role\s+IS\s+NULL\s+THEN/i);
    const del = ASSIGN.body.search(/DELETE\s+FROM\s+public\.user_roles/i);
    const revokeReturn = ASSIGN.body.search(/RETURN\s+'Successfully REVOKED/i);

    expect(del).toBeGreaterThan(nullBranch);
    expect(revokeReturn, 'the delete must run before the revoke returns').toBeGreaterThan(del);
});

test('assigning upserts on the unique constraint, not the primary key', () => {
    // user_roles has PRIMARY KEY (user_id, role) AND a separate
    // UNIQUE (user_id) (20260801000000). Only the second one makes "same
    // person, different role" a conflict - targeting the PK would not conflict
    // at all on a role change, so the insert would proceed and violate the
    // unique constraint instead.
    expect(ASSIGN.body).toMatch(/ON CONFLICT\s*\(\s*"?user_id"?\s*\)/i);
});

test('the upsert writes the role and nothing else', () => {
    // The whole point. A DO UPDATE that also touched a capability column would
    // reintroduce the bug in a subtler form than the delete did.
    const doUpdate = ASSIGN.body.match(/DO UPDATE\s+SET([\s\S]*?);/i);
    expect(doUpdate, 'the upsert should update on conflict').toBeTruthy();

    const assigned = doUpdate[1];
    for (const column of ['bypass_cooldown', 'can_moderate', 'can_delete_media']) {
        expect(assigned, `${column} must survive a role change`).not.toContain(column);
    }
    expect(assigned).toMatch(/"?role"?\s*=/i);
});

test('the capability columns are never named in the insert either', () => {
    // Belt and braces: an INSERT listing them would reset them just as
    // effectively as the delete did, and reads as harmless.
    const insert = ASSIGN.body.match(/INSERT INTO\s+public\.user_roles\s*\(([^)]*)\)/i);
    expect(insert, 'the insert should still exist').toBeTruthy();

    for (const column of ['bypass_cooldown', 'can_moderate', 'can_delete_media']) {
        expect(insert[1], `${column} must not be reset on insert`).not.toContain(column);
    }
});

test('the owner guard and the search_path survived the rewrite', () => {
    // A CREATE OR REPLACE that drops either is how a fix becomes an incident.
    // is_owner() rather than a role name, per the ladder rule.
    expect(ASSIGN.body).toContain('is_owner');
    expect(ASSIGN.body).toMatch(/SET\s+"?search_path"?\s+TO\s+'public'/i);
    expect(ASSIGN.body).toContain('42501');
});

test('the grants are restated rather than inherited', () => {
    // CREATE OR REPLACE preserves the existing ACL, so this is belt and braces
    // - but this project has already shipped a function that was reachable by
    // everyone because nobody said otherwise.
    const latest = fs.readFileSync(path.join(MIG_DIR, ASSIGN.source), 'utf8');
    expect(latest).toMatch(/REVOKE ALL ON FUNCTION "public"\."assign_role_by_email".*FROM PUBLIC/);
    expect(latest).toMatch(/REVOKE ALL ON FUNCTION "public"\."assign_role_by_email".*FROM "anon"/);
    expect(latest).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."assign_role_by_email".*TO "authenticated"/);
});
