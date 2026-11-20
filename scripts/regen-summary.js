#!/usr/bin/env node
/**
 * What a regeneration run did, as a summary on the run's page.
 *
 * Owner's card (v1.2): a new page failed the job three times in one night, each
 * time on a different check, and finding out which meant opening the log and
 * scrolling. This writes the answer where the run is opened: which content
 * checks failed and their error, and what this run fetched (the new page or
 * the changed colour is in that list).
 *
 * Usage (the workflow appends the output to $GITHUB_STEP_SUMMARY):
 *   node scripts/regen-summary.js --status failure --branch next-update \
 *        --report playwright-report/content-gate.json
 *
 * It never fails the job: a summary that cannot be written is a missing
 * convenience, and exiting non-zero here would stop content for it.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const MAX_FILES = 40;
const MAX_ERROR_LINES = 8;
const MAX_DIFF_LINES = 20;

// Small files where the changed lines themselves are the answer: a page's
// colour, the site version. The rest are named, not quoted.
const QUOTED_DIFFS = ['js/site_meta.js', 'data/site_meta.json'];

const stripAnsi = (text) => String(text == null ? '' : text).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

// A fenced block cannot be closed by what is inside it: test errors quote page
// content, and content is whatever somebody typed.
const fence = (text) => '```\n' + String(text).replace(/```/g, "'''") + '\n```';

// Every spec in a Playwright JSON report whose final result was not a pass,
// and every one that only passed on a retry.
function readReport(report) {
    const failed = [];
    const flaky = [];
    const walk = (suite) => {
        (suite.specs || []).forEach(spec => {
            const tests = spec.tests || [];
            const where = `${spec.file || suite.file || '?'}:${spec.line || '?'}`;
            if (tests.some(t => t.status === 'unexpected')) {
                const results = tests.flatMap(t => t.results || []);
                const withError = [...results].reverse().find(r => r.error && r.error.message);
                failed.push({ where, title: spec.title, error: withError ? stripAnsi(withError.error.message) : '' });
            } else if (tests.some(t => t.status === 'flaky')) {
                flaky.push({ where, title: spec.title });
            }
        });
        (suite.suites || []).forEach(walk);
    };
    ((report && report.suites) || []).forEach(walk);
    return { failed, flaky };
}

// `git status --porcelain` lines as { path, what }.
function readChanges(porcelain) {
    return String(porcelain || '').split('\n').filter(Boolean).map(line => {
        const code = line.slice(0, 2);
        const path = line.slice(3).trim().replace(/^"|"$/g, '');
        const what = code === '??' || code.includes('A') ? 'new' : code.includes('D') ? 'removed' : 'changed';
        return { path, what };
    });
}

function buildSummary({ status, branch, report, porcelain, diffs = {} }) {
    const failedRun = status !== 'success';
    const changes = readChanges(porcelain);
    const out = [];

    // Written before the commit-and-push step (it lists what is uncommitted),
    // so a good run says what it is publishing, not that it has: the push can
    // still be refused, for one when a PR merges into the branch mid-run. That
    // run turns red at the push, and the step that failed says so.
    out.push(`## Regeneration of \`${branch}\`: ${failedRun ? 'FAILED, nothing was published' : (changes.length ? 'checks passed, publishing' : 'nothing to publish')}`);
    out.push('');

    if (failedRun) {
        if (!report) {
            out.push('The job stopped before the content checks ran. The step marked red in this run is where: a fetch from Supabase, the generators, or Validate.');
            out.push('');
        } else {
            const { failed, flaky } = readReport(report);
            if (failed.length) {
                out.push(`### ${failed.length} content check${failed.length === 1 ? '' : 's'} failed`);
                out.push('');
                failed.forEach(f => {
                    out.push(`- **${f.title}** (\`${f.where}\`)`);
                    if (f.error) {
                        out.push('');
                        out.push(fence(f.error.split('\n').slice(0, MAX_ERROR_LINES).join('\n')));
                        out.push('');
                    }
                });
            } else {
                out.push('Every content check passed, so the failure is in another step. The step marked red in this run is where.');
                out.push('');
            }
            if (flaky.length) {
                out.push(`Passed only on a retry: ${flaky.map(f => `\`${f.where}\``).join(', ')}.`);
                out.push('');
            }
        }
    }

    if (changes.length) {
        out.push(failedRun ? '### What this run fetched (and did not publish)' : '### What this run is publishing');
        out.push('');
        changes.slice(0, MAX_FILES).forEach(c => out.push(`- \`${c.path}\` (${c.what})`));
        if (changes.length > MAX_FILES) out.push(`- and ${changes.length - MAX_FILES} more`);
        out.push('');

        QUOTED_DIFFS.filter(path => diffs[path]).forEach(path => {
            const lines = diffs[path].split('\n').filter(l => /^[+-](?![+-])/.test(l));
            if (!lines.length) return;
            out.push(`Changed lines in \`${path}\`:`);
            out.push('');
            out.push(fence(lines.slice(0, MAX_DIFF_LINES).join('\n')));
            out.push('');
        });
    } else if (failedRun) {
        out.push('Nothing had changed in the content when it failed, so the cause is not something fetched in this run.');
        out.push('');
    }

    return out.join('\n');
}

module.exports = { buildSummary, readReport, readChanges };

if (require.main === module) {
    try {
        const arg = (name) => {
            const i = process.argv.indexOf(`--${name}`);
            return i > -1 ? process.argv[i + 1] : null;
        };
        const reportPath = arg('report');
        let report = null;
        if (reportPath && fs.existsSync(reportPath)) {
            try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) { report = null; }
        }
        const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        const porcelain = git('git status --porcelain --untracked-files=all');
        const diffs = {};
        QUOTED_DIFFS.forEach(path => {
            try { diffs[path] = git(`git diff -U0 -- ${path}`); } catch (e) { /* not in this tree */ }
        });
        process.stdout.write(buildSummary({
            status: arg('status') || 'failure',
            branch: arg('branch') || '?',
            report, porcelain, diffs,
        }) + '\n');
    } catch (e) {
        // Deliberately not fatal: see the header.
        console.error('[regen-summary] could not write the summary:', e.message);
    }
}
