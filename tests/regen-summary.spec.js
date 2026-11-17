// What a regeneration run says on its own page (v1.2).
//
// Owner's card, "Streamline the process of owner-level quick editing": a new
// page failed the nightly job check by check, and finding out why meant
// opening the log and scrolling. Owner's pick, 2026-11-17: "a summary on the
// run page". scripts/regen-summary.js writes it: which content checks failed
// and their error, and what the run fetched.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { buildSummary } = require('../scripts/regen-summary.js');

// A Playwright JSON report, cut to what the summary reads.
const report = (specs) => ({ suites: [{ file: 'page-sweep.spec.js', specs: [], suites: [{ specs }] }] });
const spec = (title, status, message) => ({
    title, file: 'page-sweep.spec.js', line: 68,
    tests: [{ status, results: [{ status: 'failed', error: { message: 'first attempt' } }, { status: status === 'unexpected' ? 'failed' : 'passed', error: message ? { message } : undefined }] }],
});

test.describe('the run summary', () => {
    test('a failed run names the check, its error and what was fetched', () => {
        const out = buildSummary({
            status: 'failure', branch: 'next-update',
            report: report([
                spec('no runtime errors on /characters/Sky_assassin/index.html', 'unexpected', '\u001b[31mError: a script threw\u001b[39m\n    at boot'),
                spec('no runtime errors on /index.html', 'expected'),
            ]),
            porcelain: ' M data/navigation.json\n?? characters/Sky_assassin/index.html\n D characters/Old/index.html\n',
        });

        expect(out).toContain('`next-update`: FAILED, nothing was published');
        expect(out).toContain('1 content check failed');
        expect(out).toContain('no runtime errors on /characters/Sky_assassin/index.html');
        expect(out).toContain('page-sweep.spec.js:68');
        // The last attempt's error, without the terminal's colour codes.
        expect(out).toContain('Error: a script threw');
        expect(out).not.toContain('\u001b');
        expect(out).not.toContain('first attempt');
        expect(out).not.toContain('no runtime errors on /index.html');

        expect(out).toContain('What this run fetched (and did not publish)');
        expect(out).toContain('`data/navigation.json` (changed)');
        expect(out).toContain('`characters/Sky_assassin/index.html` (new)');
        expect(out).toContain('`characters/Old/index.html` (removed)');
    });

    test('a run that failed before the checks says so, and does not claim they passed', () => {
        const out = buildSummary({ status: 'failure', branch: 'main', report: null, porcelain: ' M data/faq.json\n' });
        expect(out).toContain('stopped before the content checks ran');
        expect(out).not.toMatch(/content checks? failed/);
        expect(out).toContain('`data/faq.json` (changed)');
    });

    test('a failed run whose checks all passed points at the other steps', () => {
        const out = buildSummary({ status: 'failure', branch: 'main', report: report([spec('fine', 'expected')]), porcelain: '' });
        expect(out).toContain('Every content check passed');
        expect(out).toContain('Nothing had changed in the content');
    });

    test('a good run lists what it published, or says there was nothing', () => {
        const published = buildSummary({ status: 'success', branch: 'main', report: report([spec('fine', 'expected')]), porcelain: ' M data/site_meta.json\n' });
        expect(published).toContain('`main`: published');
        expect(published).toContain('What this run published');
        expect(published).not.toContain('FAILED');

        const nothing = buildSummary({ status: 'success', branch: 'main', report: null, porcelain: '' });
        expect(nothing).toContain('nothing to publish');
    });

    test('a changed colour is quoted, so the value that caused it is on the page', () => {
        const out = buildSummary({
            status: 'failure', branch: 'next-update', report: null,
            porcelain: ' M js/site_meta.js\n',
            diffs: { 'js/site_meta.js': '--- a/js/site_meta.js\n+++ b/js/site_meta.js\n@@ -12 +12 @@\n-    "Vessel": "hsl(0, 100%, 80%)",\n+    "Vessel": "red",\n' },
        });
        expect(out).toContain('Changed lines in `js/site_meta.js`');
        expect(out).toContain('+    "Vessel": "red",');
        expect(out).not.toContain('+++ b/js/site_meta.js');
    });

    test('content quoted in an error cannot close the block it is in', () => {
        const out = buildSummary({
            status: 'failure', branch: 'main',
            report: report([spec('a check', 'unexpected', 'Expected: "```\\n# OWNED"\nReceived: ```')]),
            porcelain: '',
        });
        // One fence opens and one closes: nothing inside it is another fence.
        expect(out.match(/```/g).length).toBe(2);
    });

    test('a long list of files is cut, and says how many it left out', () => {
        const porcelain = Array.from({ length: 55 }, (_, i) => `?? characters/P${i}/index.html`).join('\n');
        const out = buildSummary({ status: 'success', branch: 'main', report: null, porcelain });
        expect(out).toContain('and 15 more');
        expect(out).not.toContain('characters/P54/index.html');
    });

    test('a test that only passed on a retry is named on a failed run', () => {
        const out = buildSummary({
            status: 'failure', branch: 'main',
            report: report([spec('broke', 'unexpected', 'Error: x'), spec('wobbled', 'flaky')]),
            porcelain: '',
        });
        expect(out).toContain('Passed only on a retry');
    });
});

test.describe('the workflow', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'regenerate.yml'), 'utf8');
    const at = (text) => {
        const i = yml.indexOf(text);
        expect(i, `regenerate.yml has: ${text}`).toBeGreaterThan(-1);
        return i;
    };

    test('the summary is written after the checks and before the commit, on a failed run too', () => {
        const gateStep = at('run: npm run test:content');
        const summary = at('node scripts/regen-summary.js');
        const commit = at('git push origin HEAD:');
        expect(gateStep).toBeLessThan(summary);
        // Before the commit: after it there is nothing uncommitted to list.
        expect(summary).toBeLessThan(commit);

        // A failed run is the run it is for.
        const step = yml.slice(yml.lastIndexOf('- name:', summary), summary);
        expect(step).toContain('always()');
        expect(yml.slice(summary).split('\n')[0]).toContain('$GITHUB_STEP_SUMMARY');
    });

    test('the checks write the report the summary reads, where the commit will not pick it up', () => {
        const reportPath = 'playwright-report/content-gate.json';
        expect(yml).toContain(`PLAYWRIGHT_JSON_OUTPUT_NAME: ${reportPath}`);
        expect(yml).toContain(`--report ${reportPath}`);
        // The commit step is `git add -A`: the report must be in an ignored folder.
        const ignored = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').split('\n').map(line => line.trim());
        expect(ignored).toContain('playwright-report/');
    });
});
