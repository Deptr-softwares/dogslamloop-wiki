// ESLint for the site's scripts: `npm run lint`, and in CI next to
// `npm run validate`.
//
// Unused locals and parameters, and the eval family. Every js/ file is a
// classic script sharing one global scope, so a top-level name is checked by
// tests/unused-globals.spec.js instead, and a name defined in another file
// is not an error here.
module.exports = [
    { ignores: ['js/vendor/**'] },
    {
        files: ['js/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: {
            'no-unused-vars': ['error', { vars: 'local', args: 'after-used', caughtErrors: 'none', argsIgnorePattern: '^_' }],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
        },
    },
];
