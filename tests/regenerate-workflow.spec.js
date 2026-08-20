// The regenerate workflow's write set must cover its check set.
//
// This exists because of a three-day silent outage. `.github/workflows/
// regenerate.yml` regenerated page stubs and then ran `npm run validate`,
// which checks five artifacts - so the moment a fetch changed anything that
// only `generate-sitemap` or `generate-hub-meta` produces, Validate failed and
// the job exited before committing anything.
//
// The failure mode is what makes it worth a test. The job could only pass
// when it had nothing to do, and "passed with nothing to do" and "worked" are
// indistinguishable from the outside. A page renamed on 2026-08-09 broke it,
// and it went unnoticed until someone asked why a site version they had
// changed in the owner tools was not on the site.
//
// So: anything `validate` checks, `generate` must write. Adding a --check
// without its --write breaks the regeneration job, not the test suite, which
// is why the assertion lives here rather than being left to reviewers.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/regenerate.yml'), 'utf8');

// "node scripts/generate-sitemap.js --check" -> "generate-sitemap"
function scriptsWithFlag(command, flag) {
    return [...String(command || '').matchAll(/node\s+scripts\/([\w-]+)\.js\s+--(\w+)/g)]
        .filter(match => match[2] === flag)
        .map(match => match[1]);
}

// Guards, not generators.
//
// The rule above is about ARTIFACTS: something generate writes and validate
// then checks, where a check with no write stalls the regeneration job. A
// guard is different. It validates something the job never writes, so it
// cannot stall it - `lock-migrations --check` reads supabase/migrations, which
// no regeneration step touches, and passes there unconditionally.
//
// Giving one of these a --write in `generate` would be actively harmful rather
// than merely redundant, which is why they are exempted here instead of being
// made to fit. Each entry says what breaks if it is "fixed" the obvious way.
const GUARDS_NOT_ARTIFACTS = new Map([
    ['lock-migrations',
     'the migration lock exists so that editing an already-pushed migration '
     + 'fails loudly. Adding it to `generate` would have the nightly '
     + 'regeneration job re-lock any edited migration automatically - the '
     + 'check would go green forever and protect nothing.'],
]);

test('every artifact validate checks is one generate writes', async () => {
    const checked = scriptsWithFlag(pkg.scripts.validate, 'check');
    const written = scriptsWithFlag(pkg.scripts.generate, 'write');

    // Sanity: a regex that silently matched nothing would make this vacuous.
    expect(checked.length).toBeGreaterThan(1);

    for (const script of checked) {
        if (GUARDS_NOT_ARTIFACTS.has(script)) continue;
        expect(written, `${script} is checked by validate but never written by generate`).toContain(script);
    }
});

// The exemption list must not quietly become a place to park real artifacts.
// A guard that DOES have a --write in generate is not a guard; it is an
// artifact that was mislabelled, and the rule above should be applying to it.
test('nothing on the guard list is secretly a generated artifact', async () => {
    const written = scriptsWithFlag(pkg.scripts.generate, 'write');

    for (const [script, why] of GUARDS_NOT_ARTIFACTS) {
        expect(written, `${script} is exempted as a guard but generate writes it — ${why}`)
            .not.toContain(script);
    }
});

test('the regenerate workflow runs the whole generate script', async () => {
    // Not a hand-picked subset of it. That subset was the bug: one of five.
    expect(workflow).toContain('npm run generate');
    expect(workflow).toContain('npm run validate');

    // A lone generate-pages call is how this regressed the first time.
    expect(workflow).not.toMatch(/run:\s*node scripts\/generate-pages\.js --write/);
});

test('the workflow generates before it validates', async () => {
    // Reversed, it would check artifacts it is about to rewrite and fail on
    // exactly the runs that had work to do - which is the original bug with
    // the steps in a different order.
    expect(workflow.indexOf('npm run generate')).toBeLessThan(workflow.indexOf('npm run validate'));
});

test('the workflow fetches fresh data before generating from it', async () => {
    const lastFetch = Math.max(
        workflow.indexOf('fetch-previews.js'),
        workflow.indexOf('fetch-registry.js'),
        workflow.indexOf('fetch-content.js'),
        workflow.indexOf('fetch-portraits.js'),
    );
    expect(lastFetch).toBeGreaterThan(-1);
    expect(lastFetch).toBeLessThan(workflow.indexOf('npm run generate'));
});

// fetch-portraits mirrors the URLs that fetch-previews writes, so running it
// first would mirror the previous run's map and quietly lag one day behind
// every portrait change.
test('portraits are mirrored after the map they are mirrored from is refreshed', async () => {
    const previews = workflow.indexOf('fetch-previews.js');
    const portraits = workflow.indexOf('fetch-portraits.js');

    expect(previews).toBeGreaterThan(-1);
    expect(portraits).toBeGreaterThan(-1);
    expect(portraits).toBeGreaterThan(previews);
});

test('the workflow still commits only after the suite has run', async () => {
    // Pushes made with GITHUB_TOKEN do not trigger other workflows, so the
    // commit this job creates would never be tested by playwright.yml.
    expect(workflow.indexOf('npx playwright test')).toBeLessThan(workflow.indexOf('git commit'));
});
