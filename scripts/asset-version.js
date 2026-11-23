/**
 * The cache-busting version for the shared JS modules and the stylesheets.
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
 * EVERY MODULE, AND ONE VERSION ACROSS ALL OF THEM
 *
 * This used to stamp three files, on the reasoning that "a page and its own
 * script are always deployed together". That is true of the REPOSITORY and
 * false of the CACHE, which is the only place it matters: GitHub Pages serves
 * HTML with max-age=600 and js/ with max-age=3600, so for most of an hour after
 * a release a reader gets fresh HTML against an hour-old script.
 *
 * It has cost three releases. The worst was v0.16: the dynamic roster icons and
 * the Show Hidden control shipped, and the owner could not see them on the live
 * site - js/pages/core/page_shell.js was unstamped, so the browser kept the copy it
 * already had while everything around it updated. The release looked like it
 * had not happened.
 *
 * So the list is now EVERY module in js/, discovered from the directory rather
 * than enumerated. A hand-kept list is a list somebody forgets to add to, and
 * the file they forget is the next page_shell.js.
 *
 * ONE version across all of them, not a hash per file. This codebase is a
 * single shared `window` scope with no module system: page_shell.js calls
 * window.roleBadge from site_account.js, discussions.js calls
 * window.fetchPublicProfiles, page_boot.js drives both. Cross-file calls are
 * the norm, so any pair can be the fresh-module-against-stale-helper failure -
 * and per-file hashes would let exactly that pair be served half-fresh.
 *
 * The cost is that any JS change invalidates every cached script rather than
 * one. That is one extra download per reader per release, which is what a
 * release is for.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JS_DIR = path.join(__dirname, '..', 'js');

// Discovered, then SORTED - readdirSync order is filesystem-dependent, and the
// hash has to be identical on a developer's Windows machine and the Linux CI
// runner or `npm run validate` fails against a tree that is correct.
//
// Every folder under js/, at any depth: reading only the top level once left
// js/tools/ unstamped from a20d29e4 to v1.1. js/vendor/ is not on the list:
// its files carry their version in their name. Named with a forward slash on
// every OS, so the list, the hash and the src it matches agree.
const listModules = (dir, prefix) => fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.isDirectory()) {
            return prefix === '' && entry.name === 'vendor'
                ? []
                : listModules(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        }
        return entry.name.endsWith('.js') ? [prefix + entry.name] : [];
    })
    : [];
const SHARED_MODULES = listModules(JS_DIR, '').sort();

const SHARED_MODULE_PATHS = SHARED_MODULES.map(name => path.join(JS_DIR, name));

// STYLESHEETS TOO, IN THE SAME VERSION. style/ is cached for an hour like js/,
// and scripts write the class names stylesheets paint, so a script and a
// stylesheet are as much a pair as any two modules: fresh markup painted by an
// hour-old sheet is the same failure. Every .css under style/, at any depth.
const STYLE_DIR = path.join(__dirname, '..', 'style');
const listStyles = (dir, prefix) => fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? listStyles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : (entry.name.endsWith('.css') ? [prefix + entry.name] : []))
    : [];
const SHARED_STYLES = listStyles(STYLE_DIR, '').sort();

const SHARED_STYLE_PATHS = SHARED_STYLES.map(name => path.join(STYLE_DIR, name));

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
    for (const file of [...SHARED_MODULE_PATHS, ...SHARED_STYLE_PATHS]) {
        hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    }
    return hash.digest('hex').slice(0, 8);
}

// Rewrites any existing ?v= as well as an unstamped tag, so re-running is
// idempotent and an older stamp is replaced rather than appended to.
function stampSharedAssets(html, version) {
    const stamp = (_m, open, filePath, _query, close) => `${open}${filePath}?v=${version}${close}`;
    const names = SHARED_MODULES.map(n => n.replace('.', '\\.')).join('|');
    const scripts = new RegExp(`(src=")([^"]*js\\/(?:${names}))(\\?[^"]*)?(")`, 'g');
    const sheetNames = SHARED_STYLES.map(n => n.replace('.', '\\.')).join('|');
    const sheets = new RegExp(`(href=")([^"]*style\\/(?:${sheetNames}))(\\?[^"]*)?(")`, 'g');
    return html.replace(scripts, stamp).replace(sheets, stamp);
}

module.exports = {
    sharedAssetVersion,
    stampSharedAssets,
    SHARED_MODULES,
    SHARED_MODULE_PATHS,
    SHARED_STYLES,
    SHARED_STYLE_PATHS,
};
