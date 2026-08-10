/**
 * The cache-busting version for js/site_utils.js.
 *
 * Shared by scripts/generate-pages.js (which stamps the generated stubs as it
 * writes them) and scripts/stamp-assets.js (which stamps the hand-authored
 * pages). One implementation so the two can never disagree about what the
 * current version is - a disagreement would make `npm run validate` fail
 * against itself.
 *
 * A content hash rather than a hand-bumped number: nobody has to remember, and
 * a deploy that does not touch the file does not invalidate anyone's cache.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_UTILS = path.join(__dirname, '..', 'js', 'site_utils.js');

// Eight hex characters is ~4 billion values, far past what a cache key needs
// to distinguish, and short enough to keep the script tags readable.
function siteUtilsVersion() {
    const source = fs.readFileSync(SITE_UTILS);
    return crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
}

// Rewrites any existing ?v= as well as an unstamped tag, so re-running is
// idempotent and an older stamp is replaced rather than appended to.
function stampSiteUtils(html, version) {
    return html.replace(
        /(src=")([^"]*js\/site_utils\.js)(\?[^"]*)?(")/g,
        (_match, open, filePath, _query, close) => `${open}${filePath}?v=${version}${close}`
    );
}

module.exports = { siteUtilsVersion, stampSiteUtils, SITE_UTILS };
