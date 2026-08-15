#!/usr/bin/env node
/**
 * Records a checksum for every migration, so editing one that has already been
 * applied somewhere cannot happen silently.
 *
 * WHY THIS EXISTS. A Supabase preview branch records each migration it has run
 * by version, and does not run that version again. So editing a migration file
 * you have already pushed is invisible to the check that is supposed to verify
 * it: the branch reports success without reading your change.
 *
 * v0.14's PR #85 did exactly this and shipped a syntax error to production.
 * Commit 144f721 added 20260814000001 correctly; the preview branch applied it
 * and reported green. Commit 7de46e1 - the tie-break change - edited the same
 * file and dropped a `WITH`, leaving a function body starting `settings AS (`.
 * The preview had already recorded that version, skipped it, and reported
 * green a second time. Production saw the edited text for the first time and
 * raised 42601.
 *
 * THE RULE. A migration is immutable once pushed. To change one, write a new
 * migration with a new timestamp, or rename the file so it becomes a version
 * nothing has applied yet. Both give the preview branch something it has not
 * seen; editing in place does not.
 *
 * This does not forbid re-locking. It forces the decision to be deliberate and
 * to appear in the diff, which is all a check like this can honestly do - the
 * v0.14 hotfix legitimately edited 20260813000005, because that migration had
 * FAILED against production and therefore was not applied anywhere.
 *
 * Run: node scripts/lock-migrations.js --check   (CI, via npm run validate)
 *      node scripts/lock-migrations.js --write   (npm run lock-migrations)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const LOCK_PATH = path.join(__dirname, '..', 'supabase', 'migrations.lock.json');

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');

if (!write && !check) {
    console.error('Usage: lock-migrations.js --check | --write');
    process.exit(2);
}

/**
 * Line endings are normalised before hashing. This repo is authored on Windows
 * and verified on a Linux runner; without this, every checksum would differ
 * between the two and the check would fail for everyone, everywhere, forever.
 */
function hashOf(file) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

if (files.length === 0) {
    console.error('lock-migrations: no .sql files found in supabase/migrations.');
    process.exit(1);
}

const current = {};
for (const f of files) current[f] = hashOf(f);

if (write) {
    // Sorted keys and a trailing newline: the file is regenerated often and a
    // stable serialisation keeps its diffs to the migrations that changed.
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ migrations: current }, null, 4) + '\n');
    console.log(`migrations.lock.json written (${files.length} migrations).`);
    process.exit(0);
}

if (!fs.existsSync(LOCK_PATH)) {
    console.error('lock-migrations: supabase/migrations.lock.json is missing.');
    console.error('  Run: npm run lock-migrations');
    process.exit(1);
}

let locked;
try {
    locked = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')).migrations || {};
} catch (err) {
    console.error(`lock-migrations: could not parse migrations.lock.json — ${err.message}`);
    process.exit(1);
}

const added = files.filter(f => !(f in locked));
const removed = Object.keys(locked).filter(f => !files.includes(f));
const changed = files.filter(f => f in locked && locked[f] !== current[f]);

if (!added.length && !removed.length && !changed.length) {
    console.log(`migration lock verified (${files.length} migrations unchanged).`);
    process.exit(0);
}

console.error('migration lock check FAILED.\n');

if (changed.length) {
    console.error('  MODIFIED after being locked:');
    for (const f of changed) console.error(`    - ${f}`);
    console.error('');
    console.error('  A migration that has been pushed is immutable. A preview branch');
    console.error('  records it by version and will NOT re-run it, so this edit will be');
    console.error('  verified by nothing and reach production unread. That is how v0.14');
    console.error('  shipped a 42601.');
    console.error('');
    console.error('  Put the change in a NEW migration, or rename this one to a new');
    console.error('  timestamp. Re-lock only if you know it has not applied anywhere');
    console.error('  (it failed, or it has never left your machine):');
    console.error('      npm run lock-migrations');
    console.error('');
}

if (removed.length) {
    console.error('  DELETED but still locked:');
    for (const f of removed) console.error(`    - ${f}`);
    console.error('');
    console.error('  Deleting an applied migration does not un-apply it. If this is');
    console.error('  deliberate, re-lock: npm run lock-migrations');
    console.error('');
}

if (added.length) {
    console.error('  NEW and not yet locked:');
    for (const f of added) console.error(`    - ${f}`);
    console.error('');
    console.error('  Expected for a new migration — record it:');
    console.error('      npm run lock-migrations');
    console.error('');
}

process.exit(1);
