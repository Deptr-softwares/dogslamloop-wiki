// ESLint for the site's scripts: `npm run lint`, and in CI next to
// `npm run validate`.
//
// Unused locals and parameters, and the eval family. Every js/ file is a
// classic script sharing one global scope, so a top-level name is checked by
// tests/unused-globals.spec.js instead, and a name defined in another file
// is not an error here.
//
// Unsafe HTML writes (eslint-plugin-no-unsanitized): an innerHTML,
// outerHTML, insertAdjacentHTML or document.write whose value the rule
// cannot see escaped. It sees a literal, a template whose every ${} is a
// literal or a call to the site's escaper, and nothing else, so an escaped
// list built with .map().join() is reported too. The writes found when the
// rule arrived are recorded in eslint-suppressions.json; a new one fails the
// lint (.claude/rules/practice-escaping.md).
//
// The browser's own alert, confirm and prompt boxes (no-alert): every box is
// the site's own dialog (window.showSystemAlert, window.siteConfirm,
// window.sitePrompt in site_utils.js).
const noUnsanitized = require('eslint-plugin-no-unsanitized');

const ESCAPERS = { methods: ['window.escapeHtml', 'window.escapeHtmlKeepBreaks', 'escapeHtml', 'escapeHtmlKeepBreaks'] };

module.exports = [
    { ignores: ['js/vendor/**'] },
    {
        files: ['js/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        plugins: { 'no-unsanitized': noUnsanitized },
        rules: {
            'no-unused-vars': ['error', { vars: 'local', args: 'after-used', caughtErrors: 'none', argsIgnorePattern: '^_' }],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-alert': 'error',
            'no-unsanitized/property': ['error', { escape: ESCAPERS }],
            'no-unsanitized/method': ['error', { escape: ESCAPERS }],
        },
    },
];
