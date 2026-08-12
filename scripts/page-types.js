/**
 * The page-type and edit-role vocabulary, in one place.
 *
 * This existed three times: validate-navigation.js, fetch-registry.js (which
 * re-runs those rules in-process before writing) and the owner tool's page
 * creation dropdown. The two script copies fell behind when v0.12 added the
 * `gallery` and `tool` types, and the failure was invisible until somebody
 * actually created one:
 *
 *   fetch-registry FAILED - the generated navigation is invalid, nothing
 *   written:
 *     - Misc[3] (id: Emotes): bad pageType "gallery".
 *
 * The owner created the Emotes gallery, and the whole regeneration job -
 * navigation, previews, page stubs, sitemap - stopped. Not for that page: for
 * everything. A vocabulary the owner tool can produce but the validator
 * rejects is a wedge under the one job that keeps the site in step with the
 * database.
 *
 * So: one definition, and a test asserting it covers everything owner.html
 * offers. That test derives its expectation from the markup rather than
 * restating this list, because restating it is exactly how the drift happened.
 */

// Everything that may appear as cms_config.pageType in navigation.json.
//
//   character | system   the two original page kinds
//   gallery   | tool     added in v0.12; both creatable from owner.html
//   tierlist            hand-authored, its own renderer
//   hub                 the section landing pages
//   external            a nav entry pointing off-site, with no page behind it
const VALID_PAGE_TYPES = new Set([
    'character', 'system', 'gallery', 'tool', 'tierlist', 'hub', 'external',
]);

const VALID_EDIT_ROLES = new Set(['open', 'elevated', 'locked']);

// Deliberately NOT merged with the set above: this answers a different
// question - which types this repo writes an HTML stub for. 'tierlist' and
// 'hub' are hand-authored (NEVER_TOUCH in generate-pages.js) and 'external'
// has no page at all, so all three are valid types that must never be
// generated. Kept here so the relationship between the two lists is visible
// in one file instead of inferred from two.
const GENERATED_PAGE_TYPES = new Set(['character', 'system', 'gallery', 'tool']);

module.exports = { VALID_PAGE_TYPES, VALID_EDIT_ROLES, GENERATED_PAGE_TYPES };
