// The notes on the code, as the site and Claude Code see them. Node only.
//
// GitHub Pages builds every Markdown file in the repo into a page on
// dogslamloop.com (Jekyll skips only folders and files starting with . or _),
// so a note on the code is a public page unless robots.txt asks crawlers to
// skip it.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TRACKED = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The Markdown written for readers: the footer links CONTENT-LICENSE, and
// GitHub shows README and CONTRIBUTING on the repo's own pages.
const FOR_READERS = new Set(['README.md', 'CONTRIBUTING.md', 'CONTENT-LICENSE.md']);

const published = TRACKED.filter(f => f.endsWith('.md') && !f.split('/').some(part => /^[._]/.test(part)));

// robots.txt as RFC 9309 reads it: the rules of every group for `*`, where *
// matches any run of characters, a final $ ends the match, and the longest
// matching rule wins (Allow wins a tie).
function robotsRules(text) {
    const rules = [];
    let agents = [];
    let inRules = false;
    for (const raw of text.split('\n')) {
        const m = raw.replace(/#.*/, '').trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (key === 'user-agent') {
            if (inRules) { agents = []; inRules = false; }
            agents.push(m[2].trim());
            continue;
        }
        inRules = true;
        if (agents.includes('*') && m[2].trim()) rules.push({ allow: key === 'allow', pattern: m[2].trim() });
    }
    return rules;
}

function ruleRegExp(pattern) {
    const anchored = pattern.endsWith('$');
    const body = (anchored ? pattern.slice(0, -1) : pattern)
        .split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function crawlable(rules, urlPath) {
    let best = { length: -1, allow: true };
    for (const r of rules) {
        if (!ruleRegExp(r.pattern).test(urlPath)) continue;
        if (r.pattern.length > best.length || (r.pattern.length === best.length && r.allow)) {
            best = { length: r.pattern.length, allow: r.allow };
        }
    }
    return best.allow;
}

test.describe('robots.txt and the Markdown Pages publishes', () => {
    const rules = robotsRules(read('robots.txt'));

    test('every note on the code is skipped, at each address Pages serves it on', () => {
        const notes = published.filter(f => !FOR_READERS.has(f));
        expect(notes).toContain('CLAUDE.md');
        for (const f of notes) {
            const base = `/${f.replace(/\.md$/, '')}`;
            for (const url of [`${base}.md`, base, `${base}.html`]) {
                expect(crawlable(rules, url), `${url} is a page on dogslamloop.com that crawlers may list`).toBe(false);
            }
        }
    });

    test('the devlog is skipped at the root too, where a release commits it before it moves', () => {
        for (const url of ['/V1.3-DEVLOG.md', '/V1.3-DEVLOG.html', '/V2.0-DEVLOG']) {
            expect(crawlable(rules, url), url).toBe(false);
        }
    });

    test('the pages written for readers stay open to crawlers', () => {
        for (const url of ['/', '/index.html', '/characters/', '/systems/tierlist/', '/CONTENT-LICENSE', '/privacy-policy.html']) {
            expect(crawlable(rules, url), url).toBe(true);
        }
    });
});
