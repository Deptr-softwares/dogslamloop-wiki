// The assumptions the storage policies rest on (v0.14).
//
// Two policies on storage.objects were narrowed to require can_delete_media():
// DELETE in 20260813000003, UPDATE in 20260813000004. Both were safe to narrow
// only because of a fact about this codebase rather than a fact about storage:
//
//     nothing in the app ever needs UPDATE on storage.objects
//
// list() is SELECT, upload() without upsert is INSERT, getPublicUrl() consults
// no policy at all on a public bucket, and remove() is DELETE. Nothing calls
// move(), copy(), or upload(..., { upsert: true }).
//
// That is a fact with a shelf life. The day somebody adds a "replace this
// file" button - a perfectly reasonable thing to want - it will call upload
// with upsert, need UPDATE, and fail for every contributor while working
// perfectly for the admin who built it. This spec is here so that change fails
// a test on the machine of the person making it, with a comment explaining
// what to do, rather than in production for everyone else.
//
// A source scan rather than a browser test on purpose: Playwright cannot reach
// a storage policy, and the thing worth pinning is what the code asks for.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');

function readAllJs() {
    return fs.readdirSync(JS_DIR)
        .filter(f => f.endsWith('.js'))
        .map(f => ({ file: f, body: fs.readFileSync(path.join(JS_DIR, f), 'utf8') }));
}

// Comments would otherwise trip every check below - this file's own reasoning
// mentions upsert and move by name, and so do the migrations' explanations.
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('nothing uploads with upsert, which would require UPDATE on storage.objects', () => {
    const offenders = [];

    readAllJs().forEach(({ file, body }) => {
        const code = stripComments(body);
        // .upload(...) spanning up to a few lines, looking for an upsert option
        // in the same call.
        const uploads = code.match(/\.upload\s*\([\s\S]{0,300}?\)/g) || [];
        uploads.forEach(call => {
            if (/upsert\s*:\s*true/.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}`);
        });
    });

    expect(offenders,
        'An upsert needs UPDATE on storage.objects, which is now restricted to can_delete_media. '
        + 'It will fail for every ordinary contributor. Either avoid upsert, or widen the policy in a new '
        + 'migration and update this test with the reasoning.'
    ).toEqual([]);
});

test('nothing moves or copies a stored object, which would require UPDATE', () => {
    const offenders = [];

    readAllJs().forEach(({ file, body }) => {
        const code = stripComments(body);
        // Only storage moves matter. Array.prototype has no move/copy, but
        // plenty of app code has its own - so this is anchored to a storage
        // client expression rather than to the method name alone.
        const storageCalls = code.match(/storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*\w+/g) || [];
        storageCalls.forEach(call => {
            if (/\.\s*(move|copy)$/.test(call)) offenders.push(`${file}: ${call}`);
        });
    });

    expect(offenders,
        'move() and copy() need UPDATE on storage.objects, which is now restricted to can_delete_media.'
    ).toEqual([]);
});

test('the storage operations the app does use are the ones the policies allow', () => {
    // Positive coverage, so this spec fails if the app stops doing the things
    // the open policies exist for - which would mean the policies are wider
    // than anything needs.
    const all = readAllJs().map(f => stripComments(f.body)).join('\n');

    const used = {
        list: /storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*list\s*\(/.test(all),
        upload: /storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*upload\s*\(/.test(all),
        remove: /storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*remove\s*\(/.test(all),
    };

    // list -> SELECT (open), upload -> INSERT (open), remove -> DELETE
    // (restricted to can_delete_media).
    expect(used).toEqual({ list: true, upload: true, remove: true });
});

test('the migrations narrow both destructive storage policies, not just delete', () => {
    // Reading the SQL rather than the database, because a preview branch is
    // the only place these can be executed and this suite never reaches one.
    // It pins that both policies got the same treatment - the delete one
    // shipped first, and the update one was a follow-up that would be easy to
    // lose.
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const sql = fs.readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
        .join('\n');

    expect(sql, 'the DELETE policy must require the capability').toMatch(
        /"Auth Delete"[\s\S]{0,400}can_delete_media/
    );
    expect(sql, 'the UPDATE policy must require the capability').toMatch(
        /"Auth Update"[\s\S]{0,400}can_delete_media/
    );

    // Both are altered-if-present/created-if-absent. Production has these
    // policies because they were made in the dashboard; a preview branch does
    // not, because previews are built from the migrations.
    const guarded = (sql.match(/policyname = 'Auth (Delete|Update)'/g) || []).length;
    expect(guarded, 'each policy change must be guarded on whether it already exists').toBe(2);
});
