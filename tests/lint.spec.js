// ESLint (eslint.config.js) runs on every PR, beside `npm run validate` in
// playwright.yml, and never in the regeneration job: a lint error must not
// stop content publishing. These check that the config catches what it is
// there for, using ESLint itself rather than reading the config.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const ROOT = path.join(__dirname, '..');
const lint = async (code) => {
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, 'js', 'lint-probe.js') });
    return result.messages.map(m => `${m.ruleId}:${m.line}`).sort();
};

test('an unused local, an unused parameter and eval are errors', async () => {
    expect(await lint([
        'function f(a, b) {',
        '    const unused = 1;',
        '    return eval(a);',
        '}',
        'window.f = f;',
    ].join('\n'))).toEqual(['no-eval:3', 'no-unused-vars:1', 'no-unused-vars:2']);
});

test('a top-level name is not an error, because another file may use it', async () => {
    // Those are tests/unused-globals.spec.js's job.
    expect(await lint('function sharedWithAnotherFile() {}\nconst ALSO_SHARED = 1;\n')).toEqual([]);
});

test('CI runs it, and the regeneration job does not', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.lint).toBe('eslint js/');
    expect(pkg.scripts.validate).not.toMatch(/eslint|lint/);
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'playwright.yml'), 'utf8');
    expect(ci).toMatch(/^\s+- run: npm run lint$/m);
    const regen = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'regenerate.yml'), 'utf8');
    expect(regen).not.toMatch(/lint/);
});
