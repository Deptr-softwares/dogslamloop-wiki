/**
 * The cache-busting version for the shared JS modules.
 *
 * Shared by scripts/generate-pages.js (which stamps the generated stubs as it
 * writes them) and scripts/stamp-assets.js (which stamps the hand-authored
 * pages). One implementation so the two can never disagree about what the
 * current version is - a disagreement would make `npm run validate` fail
 * against itself.
 *
 * A content hash rather than a hand-bumped number: nobody has to remember, and
 * a deploy that does not touch the files does not invalidate anyone's cache.
 *
 * WHY TWO FILES, AND WHY ONE VERSION ACROSS BOTH
 *
 * site_utils.js was the only stamped file for as long as it was the only
 * genuinely shared module. v0.15 added js/character_tabs.js - the character tab
 * vocabulary - which every page loads and which site_utils.js itself reads at
 * parse time to build FRAME_MOVE_CATEGORIES. That is exactly the dependency
 * shape the stamper exists to protect (see scripts/stamp-assets.js's header:
 * a fresh module paired with an hour-old copy of the helper it calls).
 *
 * They share one version deliberately. Hashing them together means a change to
 * either invalidates both, so the pair can never be served half-fresh - which
 * is the only failure mode that matters when one parses the other's output.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JS_DIR = path.join(__dirname, '..', 'js');

// Order is fixed, not directory order: the hash must be reproducible across
// machines and filesystems.
const SHARED_MODULES = ['character_tabs.js', 'site_utils.js'];

const SHARED_MODULE_PATHS = SHARED_MODULES.map(name => path.join(JS_DIR, name));

// Eight hex characters is ~4 billion values, far past what a cache key needs
// to distinguish, and short enough to keep the script tags readable.
//
// Line endings are normalised before hashing, and that is not cosmetic: this
// repo stores LF but checks out CRLF on Windows, so hashing the bytes on disk
// gave one version on a developer's machine and a different one on the Linux
// CI runner - which made `npm run validate` fail on a tree that was correct.
// Found the first time this shipped.
function sharedAssetVersion() {
    const hash = crypto.createHash('sha256');
    for (const file of SHARED_MODULE_PATHS) {
        hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    }
    return hash.digest('hex').slice(0, 8);
}

// Rewrites any existing ?v= as well as an unstamped tag, so re-running is
// idempotent and an older stamp is replaced rather than appended to.
function stampSharedAssets(html, version) {
    const names = SHARED_MODULES.map(n => n.replace('.', '\\.')).join('|');
    const pattern = new RegExp(`(src=")([^"]*js\\/(?:${names}))(\\?[^"]*)?(")`, 'g');
    return html.replace(pattern, (_m, open, filePath, _query, close) => `${open}${filePath}?v=${version}${close}`);
}

module.exports = {
    sharedAssetVersion,
    stampSharedAssets,
    SHARED_MODULES,
    SHARED_MODULE_PATHS,
};
