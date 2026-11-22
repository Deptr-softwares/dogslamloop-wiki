// The notes on the code, as the site and Claude Code see them. Node only.
//
// GitHub Pages builds every Markdown file in the repo into a page on
// dogslamloop.com (Jekyll skips only folders and files starting with . or _),
// so a note on the code is a public page unless robots.txt asks crawlers to
// skip it.
//
// A rule in .claude/rules/ loads only when a file its paths match is read or
// edited. Rename the file it covers and the rule never loads again, with
// nothing to say so, which is what the second half of this file catches.
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

// A rule's paths, read the way Claude Code reads them: a YAML list or a
// comma-separated string under `paths:`. Null when there are none, which
// makes the rule load at launch.
function rulePaths(text) {
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) return null;
    const lines = front[1].split(/\r?\n/);
    const at = lines.findIndex(l => /^paths\s*:/.test(l));
    if (at < 0) return null;
    const unquote = s => s.trim().replace(/^(["'])(.*)\1$/, '$2');
    const inline = lines[at].replace(/^paths\s*:/, '').trim();
    if (inline) return inline.split(',').map(unquote).filter(Boolean);
    const list = [];
    for (const line of lines.slice(at + 1)) {
        const m = line.match(/^\s*-\s*(.+)$/);
        if (!m) break;
        list.push(unquote(m[1]));
    }
    return list;
}

// Claude Code's glob: a pattern with no slash matches at any depth, a leading
// slash anchors it to the root, ** crosses folders and * does not, and {a,b}
// is either.
function globRegExp(glob) {
    const anchored = glob.startsWith('/') || glob.replace(/\/$/, '').includes('/');
    const g = glob.replace(/^\//, '');
    let re = '';
    let braces = 0;
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*' && g[i + 1] === '*') {
            if (g[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; } else { re += '.*'; i += 1; }
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else if (c === '{') { re += '(?:'; braces++; }
        else if (c === '}' && braces) { re += ')'; braces--; }
        else if (c === ',' && braces) re += '|';
        else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`);
}

test.describe('the rules in .claude/rules/', () => {
    const RULES = TRACKED.filter(f => f.startsWith('.claude/rules/') && f.endsWith('.md'));
    const claude = read('CLAUDE.md');

    test('every rule names paths, and each path matches a file, so the rule still loads', () => {
        expect(RULES).toContain('.claude/rules/combo-card.md');
        for (const rule of RULES) {
            const paths = rulePaths(read(rule));
            expect(paths, `${rule} has no paths, so it loads in every session: that is what CLAUDE.md is for`).not.toBeNull();
            expect(paths.length, `${rule} lists no paths`).toBeGreaterThan(0);
            for (const p of paths) {
                const re = globRegExp(p);
                expect(TRACKED.some(f => re.test(f)), `${rule}: "${p}" matches no file in the repo`).toBe(true);
            }
        }
    });

    test('CLAUDE.md lists every rule, and every rule or docs file it names exists', () => {
        for (const rule of RULES) {
            expect(claude, `CLAUDE.md does not name ${path.basename(rule)}`).toContain(`\`${path.basename(rule)}\``);
        }
        const named = [
            ...[...claude.matchAll(/`((?:\.claude\/rules|docs)\/[^`\s]+\.md)`/g)].map(m => m[1]),
            ...[...claude.matchAll(/`(practice-[a-z-]+\.md)`/g)].map(m => `.claude/rules/${m[1]}`),
        ];
        expect(named).toContain('.claude/rules/practice-escaping.md');
        for (const f of named) {
            expect(TRACKED.includes(f) || fs.existsSync(path.join(ROOT, f)), `CLAUDE.md names ${f}, which is not there`).toBe(true);
        }
    });

    test('the glob reads paths the way Claude Code does', () => {
        expect(globRegExp('*.md').test('docs/glossary.md')).toBe(true);
        expect(globRegExp('/*.html').test('edit.html')).toBe(true);
        expect(globRegExp('/*.html').test('characters/Boomcat/index.html')).toBe(false);
        expect(globRegExp('js/**/*.js').test('js/a.js')).toBe(true);
        expect(globRegExp('js/**/*.js').test('js/pages/core/page_boot.js')).toBe(true);
        expect(globRegExp('characters/*/index.html').test('characters/Boomcat/index.html')).toBe(true);
        expect(globRegExp('characters/*/index.html').test('x/characters/Boomcat/index.html')).toBe(false);
        expect(globRegExp('style/*.{css,scss}').test('style/editor.css')).toBe(true);
        expect(globRegExp('supabase/functions/**').test('supabase/functions/_shared/discord-relay-core.mjs')).toBe(true);
    });
});

test.describe('docs/glossary.md', () => {
    test('every file its table names is in the repo, so the table follows a rename', () => {
        const rows = read('docs/glossary.md').split('\n')
            .filter(line => line.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(line))
            .slice(1);
        const files = rows.flatMap(row => {
            const cells = row.split('|').map(cell => cell.trim());
            return [...cells[cells.length - 2].matchAll(/`([\w./-]+\.(?:js|css|html|json|md))`/g)].map(m => m[1]);
        });
        expect(files).toContain('editor-framedata.js');
        for (const f of files) {
            const found = f.includes('/') ? TRACKED.includes(f) : TRACKED.some(t => t === f || t.endsWith(`/${f}`));
            expect(found, `the glossary names ${f}, which is not in the repo`).toBe(true);
        }
    });
});
