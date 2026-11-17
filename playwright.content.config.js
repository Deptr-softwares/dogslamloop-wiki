// @ts-check
// THE CONTENT GATE: what the regeneration job runs before it publishes.
//
// The job used to run the whole suite (about 1,100 tests, 28 minutes a branch)
// before committing what it fetched. Most of that suite tests code, which the
// job does not change and which every PR has already run. So content waited on
// tests that had nothing to say about it, and one flaky editor test stopped
// three nights of content out of ten (2026-11-08, 11-09, 11-13).
//
// Owner, 2026-11-17: the job runs the content checks only. `npm run validate`
// first, then the specs below. The full suite still runs on every PR, and
// again on the commit this job pushes (playwright.yml runs on a push to main
// and next-update), so a code test that new content breaks still shows red
// there. It does not stop the content.
//
// WHAT BELONGS HERE: a spec whose Node side reads a file the job writes
// (data/navigation.json, page-previews.json, portraits.json, faq.json,
// site_meta.json, the search indexes, collaborators_data.json, sitemap.xml,
// the colours in js/site_meta.js). Its result depends on the real content, so
// it is the content's check. tests/content-gate.spec.js fails a PR that adds
// such a spec without listing it here.
//
// Everything else is the base config's: one browser, the same server, the
// same retries.
const base = require('./playwright.config');

const CONTENT_SPECS = [
  // Loads every page in navigation.json and fails on a script error or a
  // missing site file. The one that sees a page the owner made today.
  'page-sweep.spec.js',

  // The generated files themselves.
  'generate-pages.spec.js',
  'registry-roundtrip.spec.js',
  'content-roundtrip.spec.js',
  'portrait-mirror.spec.js',
  'hub-meta.spec.js',
  'hub-structured.spec.js',
  'social-meta.spec.js',
  'sitemap-and-archiving.spec.js',
  'search-index.spec.js',
  'search-fulltext.spec.js',
  'character-colors.spec.js',
  'hex-character-colors.spec.js',
  'routing.spec.js',

  // Features that draw from the real roster, registry or site meta.
  'character-name-outline.spec.js',
  'combo-block.spec.js',
  'create-tier-list.spec.js',
  'free-submit-tier-list.spec.js',
  'hidden-characters.spec.js',
  'discussion-rules-link.spec.js',
  'editor-playground.spec.js',
  'forum.spec.js',
  'gallery-edit-access.spec.js',
  'owner-page-meta.spec.js',
  'profile-description.spec.js',
  'recent-changes.spec.js',
  'tool-page-contents.spec.js',
];

module.exports = {
  ...base,
  testMatch: CONTENT_SPECS.map(name => `**/${name}`),
  // The base ignores visual.spec.js in CI; nothing listed here needs ignoring.
  testIgnore: [],
};
