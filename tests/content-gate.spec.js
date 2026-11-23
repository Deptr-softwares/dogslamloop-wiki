// The regeneration job's content gate (v1.2).
//
// Owner's card, "Streamline the process of owner-level quick editing": a new
// page failed the nightly job check by check, each run took most of an hour,
// and finding out why meant reading a log. The owner's picks, 2026-11-17: the
// job runs the content checks only (playwright.content.config.js).
//
// These are checks on CODE: the list and the workflow. They run in PR CI, and
// none of them is in the gate itself.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gate = require('../playwright.content.config.js');
const base = require('../playwright.config.js');

const listed = gate.testMatch.map(pattern => pattern.replace('**/', ''));

// A Node-side read of a file the regeneration job writes. This is the rule in
// playwright.content.config.js, as a pattern: a spec that matches it gets its
// answer from the real content.
const GENERATED = /(navigation|page-previews|portraits|faq|site_meta|search-index|search-fulltext|collaborators_data|video-stills|banners)\.json|sitemap\.xml|'site_lookups\.js'/;
const NODE_READ = /require\(|readFileSync\(|path\.join\(/;
const readsGenerated = (source) => source.split('\n').some(line => GENERATED.test(line) && NODE_READ.test(line));

test.describe('the content gate', () => {
    test('every spec it lists exists', () => {
        // testMatch quietly matches nothing for a renamed file, and the job
        // would go on publishing with one check fewer.
        expect(listed.length).toBeGreaterThan(0);
        for (const name of listed) {
            expect(fs.existsSync(path.join(__dirname, name)), `${name} is listed in playwright.content.config.js`).toBe(true);
        }
        expect(new Set(listed).size, 'no spec is listed twice').toBe(listed.length);
    });

    test('a spec that reads a generated file from Node is in it', () => {
        const missing = fs.readdirSync(__dirname)
            .filter(name => name.endsWith('.spec.js') && name !== path.basename(__filename))
            .filter(name => readsGenerated(fs.readFileSync(path.join(__dirname, name), 'utf8')))
            .filter(name => !listed.includes(name));
        expect(missing, 'add these to playwright.content.config.js: their result depends on the content').toEqual([]);
    });

    test('the pattern knows the file the colours are written into', () => {
        // Specs read it by its quoted name. A renamed file the pattern does
        // not know would hide them from the check above, and fail nothing.
        const { SITE_LOOKUPS_JS_PATH } = require('../scripts/fetch-content.js');
        const name = path.basename(SITE_LOOKUPS_JS_PATH);
        expect(fs.existsSync(SITE_LOOKUPS_JS_PATH), name).toBe(true);
        expect(readsGenerated(`const src = fs.readFileSync(path.join(ROOT, 'js', 'utility', '${name}'));`)).toBe(true);
    });

    test('the page sweep is in it', () => {
        // The one check that sees a page the owner made today.
        expect(listed).toContain('page-sweep.spec.js');
    });

    test('it runs on the same browser, server and retries as the suite', () => {
        expect(gate.projects).toEqual(base.projects);
        expect(gate.webServer).toEqual(base.webServer);
        expect(gate.retries).toBe(base.retries);
        expect(gate.use).toEqual(base.use);
    });

    test('the workflow runs the gate after Validate and before it commits', () => {
        const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'regenerate.yml'), 'utf8');
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['test:content']).toContain('playwright.content.config.js');

        const at = (text) => {
            const i = yml.indexOf(text);
            expect(i, `regenerate.yml has: ${text}`).toBeGreaterThan(-1);
            return i;
        };
        const validate = at('run: npm run validate');
        const gateStep = at('run: npm run test:content');
        const commit = at('git push origin HEAD:');
        expect(validate).toBeLessThan(gateStep);
        expect(gateStep).toBeLessThan(commit);
        // And the whole suite is not what gates content any more.
        expect(yml).not.toMatch(/run: npx playwright test\s*$/m);
    });
});
