// Hiding or removing a post tells its author why (v1.0 Part 3, owner,
// 2026-10-10: "the site send a notification with the reason when their post is
// hidden or removed").
//
// The Terms of Service give a strike for breaking the rules in a post, and a
// strike expires 30 days after it is given. The author can only count those
// days if they are told, so the notification is what makes that rule usable.
//
// Playwright never reaches Postgres, so this reads the SQL. It reads the LATEST
// definition of each function across supabase/migrations, by filename order,
// because that is the one production runs: a later migration that redefines
// either function and forgets the notification is exactly the drift this has
// to catch. The behaviour itself is probed on the preview branch.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function latestDefinition(fn) {
    const opener = `CREATE OR REPLACE FUNCTION "public"."${fn}"(`;
    let latest = null;
    for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
        const start = sql.lastIndexOf(opener);
        if (start === -1) continue;
        // The body runs to the closing dollar quote after the opening one.
        const open = sql.indexOf('$$', start);
        const close = sql.indexOf('$$', open + 2);
        latest = { file, body: sql.slice(start, close) };
    }
    return latest;
}

for (const fn of ['moderate_discussion_post', 'moderate_forum_thread']) {
    test(`${fn}, as production runs it, notifies the author with the reason`, () => {
        const def = latestDefinition(fn);
        expect(def, `${fn} is defined somewhere`).not.toBeNull();

        expect(def.body, def.file).toContain('INSERT INTO public.user_notifications');
        expect(def.body, def.file).toContain('target.author_id');
        // The reason itself, in the words a rejected submission uses.
        expect(def.body, def.file).toContain(`'. Staff Note: "' || btrim("p_reason")`);
        // Never on a restore, never to a post with no wiki author, never to
        // the moderator about their own post.
        expect(def.body, def.file).toContain(`"p_action" <> 'restore'`);
        expect(def.body, def.file).toContain('target.author_id IS NOT NULL');
        expect(def.body, def.file).toContain('target.author_id IS DISTINCT FROM auth.uid()');
    });

    test(`${fn} answers "Post hidden.", not "Post hided."`, () => {
        const def = latestDefinition(fn);
        expect(def.body, def.file).toContain(`WHEN 'hide' THEN 'Post hidden.'`);
    });
}
