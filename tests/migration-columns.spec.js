// Static check: a migration must not reference a column that does not exist.
//
// v0.14 shipped and five of its eight migrations did not apply, because
// 20260813000005 ordered by `ur.created_at` on public.user_roles - a table
// that is (user_id, role) plus v0.13's capability flags and has never carried
// a timestamp. Postgres raised 42703, the migration rolled back, and the four
// after it never ran. The site degraded to "arrives with the next release"
// messages on the tier list and Free Submit pages.
//
// Nothing caught it. Playwright cannot reach Postgres, and the Supabase
// preview check that DID catch it is not a required check, so the release
// merged over a red result.
//
// This is the cheap half of that gap: the schema is in this repo, so a column
// reference can be checked against it without a database. It only inspects
// aliases bound in a plain `FROM public.tbl alias` or `JOIN public.tbl alias`,
// and only for tables whose full column list the migrations define - anything
// less certain is left alone, because a false positive here would train people
// to ignore it.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function migrationSql() {
    return fs.readdirSync(DIR)
        .filter(f => f.endsWith('.sql'))
        .sort()
        .map(f => ({ file: f, sql: fs.readFileSync(path.join(DIR, f), 'utf8') }));
}

// Strip comments and string literals so their contents are never parsed as SQL.
function stripNoise(sql) {
    return sql
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\$\$[\s\S]*?\$\$/g, m => m)   // keep function bodies: they contain the bug
        .replace(/'(?:[^']|'')*'/g, "''");
}

// table -> Set(columns), built from CREATE TABLE and ALTER TABLE ADD COLUMN.
function buildSchema(files) {
    const schema = new Map();

    for (const { sql } of files) {
        const clean = stripNoise(sql);

        const createRe = /CREATE TABLE (?:IF NOT EXISTS )?"public"\."([a-z_]+)"\s*\(([\s\S]*?)\n\)\s*;/gi;
        let m;
        while ((m = createRe.exec(clean))) {
            const [, table, body] = m;
            const cols = schema.get(table) || new Set();
            for (const line of body.split('\n')) {
                // The type may be quoted - the remote_schema dump writes
                // `"user_id" "uuid" NOT NULL`, and missing that made this
                // check see user_roles as having only its later ADD COLUMNs.
                const col = /^\s*"([a-z_]+)"\s+"?[a-z]/i.exec(line);
                if (col) cols.add(col[1]);
            }
            schema.set(table, cols);
        }

        const alterRe = /ALTER TABLE (?:ONLY )?"public"\."([a-z_]+)"([\s\S]*?);/gi;
        while ((m = alterRe.exec(clean))) {
            const [, table, body] = m;
            if (!schema.has(table)) continue;
            const addRe = /ADD COLUMN (?:IF NOT EXISTS )?"([a-z_]+)"/gi;
            let a;
            while ((a = addRe.exec(body))) schema.get(table).add(a[1]);
        }
    }
    return schema;
}

test('no migration reads a column its table does not have', () => {
    const files = migrationSql();
    const schema = buildSchema(files);

    expect(schema.has('user_roles'), 'schema extraction found no user_roles').toBe(true);
    expect(schema.size, 'schema extraction found almost no tables').toBeGreaterThan(5);

    // A migration that has already run against production cannot be edited -
    // its checksum is recorded and its effects have happened. These three
    // defined list_personnel with `ur.created_at` and applied cleanly, because
    // a PL/pgSQL body is not resolved against the schema until it is CALLED.
    // The function raised 42703 at every call until 20260815000000 replaced
    // it; the history stays wrong and the current definition is right.
    //
    // Keyed to the exact reference rather than the whole file, so a DIFFERENT
    // bad column in any of them would still be reported.
    const SUPERSEDED = new Set([
        '20260812000005_user_capabilities.sql:ur.created_at',
        '20260813000001_thread_moderation.sql:ur.created_at',
        '20260813000003_media_deletion.sql:ur.created_at',
    ]);

    const problems = [];

    for (const { file, sql } of files) {
        const clean = stripNoise(sql);

        // alias -> table, for the simple bindings only.
        const bindings = new Map();
        const bindRe = /\b(?:FROM|JOIN)\s+"?public"?\."?([a-z_]+)"?\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi;
        let b;
        while ((b = bindRe.exec(clean))) {
            const [, table, alias] = b;
            const kw = ['on', 'where', 'set', 'using', 'group', 'order', 'limit', 'having', 'join', 'left', 'inner', 'cross', 'lateral'];
            if (kw.includes(alias.toLowerCase())) continue;
            if (schema.has(table)) bindings.set(alias, table);
        }

        // An alias bound to anything OTHER than a public table in the same
        // file is ambiguous and gets skipped. get_free_submit_rankings binds
        // `s` to public.tier_page_settings inside a CTE and then to the CTE
        // itself in the outer query, so s.floor_votes is a CTE column and not
        // a missing table column. Guessing there would produce a false alarm,
        // and a check people learn to ignore is worse than no check.
        const shadowed = new Set();
        const bareRe = /\b(?:FROM|JOIN)\s+(?!"?public"?\.)([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi;
        let sh;
        while ((sh = bareRe.exec(clean))) {
            const kw = ['as', 'on', 'where', 'select', 'lateral'];
            if (!kw.includes(sh[2].toLowerCase())) shadowed.add(sh[2]);
        }

        for (const [alias, table] of bindings) {
            if (shadowed.has(alias)) continue;
            const cols = schema.get(table);
            const useRe = new RegExp(`\\b${alias}\\.\"?([a-z_]+)\"?`, 'gi');
            let u;
            while ((u = useRe.exec(clean))) {
                const col = u[1].toLowerCase();
                if (col === '*') continue;
                if (cols.has(col)) continue;
                if (SUPERSEDED.has(`${file}:${alias}.${col}`)) continue;
                problems.push(`${file}: ${alias}.${col} — public.${table} has no such column`
                    + ` (it has: ${[...cols].join(', ')})`);
            }
        }
    }

    // Deduplicated: the same bad reference inside a loop is one mistake.
    expect([...new Set(problems)]).toEqual([]);
});
