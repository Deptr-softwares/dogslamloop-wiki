/**
 * Dogslamloop Wiki - Shared Site Utilities
 */

const fetchPromiseCache = {};

// Counts directory depth rather than naming the directories. The old version
// tested for '/characters/' and '/systems/' explicitly and returned './' for
// anything else - so a page under any new directory (others/, tools/) would
// resolve every data fetch and asset path against the wrong root and 404.
// Depth works for a directory that does not exist yet, which is the point.
//
// The site is served from the domain root (GitHub Pages with a custom domain,
// and the test server likewise), so path segments map directly to depth.
function getRootPath() {
    const segments = window.location.pathname.split('/').filter(Boolean);

    // Drop a trailing filename so /systems/hud/index.html and /systems/hud/
    // are the same depth. A dot is the only thing separating the two here:
    // directory names on this site never contain one.
    if (segments.length && segments[segments.length - 1].includes('.')) segments.pop();

    return segments.length ? '../'.repeat(segments.length) : './';
}

async function fetchJson(url, options = {}) {
    const cacheEnabled = Boolean(options.cache);
    const requestUrl = url.includes('?') ? url : `${url}?v=1.0`;

    if (cacheEnabled) {
        // Cache the Promise, not the resolved data, to prevent race conditions
        if (!fetchPromiseCache[requestUrl]) {
            fetchPromiseCache[requestUrl] = fetch(requestUrl).then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch JSON resource: ${requestUrl}`);
                }
                return response.json();
            }).catch(error => {
                // Clear cache on failure so it can retry later
                delete fetchPromiseCache[requestUrl];
                throw error;
            });
        }
        return fetchPromiseCache[requestUrl];
    }

    // Standard uncached fetch
    const response = await fetch(requestUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch JSON resource: ${requestUrl}`);
    }
    return response.json();
}

async function fetchNavigationData() {
    return fetchJson(`${getRootPath()}data/navigation.json?v=1.0`, { cache: true });
}

// --- ARCHIVED PAGES ---
// Lives next to fetchNavigationData because it answers the question that file
// cannot: navigation.json contains only live pages, so anything reading it is
// already safe from archived ones, and anything NOT reading it is not.
//
// The unsafe readers are the ones that reach into page_data or the revision
// feed directly - matchup and counterplay cards on other character pages,
// tier-list rows, and the v0.11 dashboard widgets. Those keep linking to a
// page that has been archived, because nothing ever told them.
//
// Returns {} on any failure, deliberately. A missing or malformed manifest
// should degrade to "nothing is hidden", which is the pre-v0.11 behaviour -
// not blank out a roster or throw partway through rendering a page.
async function fetchArchivedPages() {
    try {
        const data = await fetchJson(`${getRootPath()}data/archived-pages.json?v=1.0`, { cache: true });
        return (data && typeof data === 'object') ? data : {};
    } catch (e) {
        return {};
    }
}

/**
 * True when a page is archived AND has been explicitly marked to have its
 * remaining references hidden.
 *
 * Archiving alone deliberately does not hide references: it stays a cheap,
 * reversible decision, while scrubbing a character out of every matchup table
 * on the site is a heavier one that has to be opted into per page.
 *
 * Accepts either a page_id ('boomcat') or a nav_id ('Boomcat'), because the
 * callers genuinely differ - page_data is keyed by page_id, while the tier
 * list stores nav_ids.
 */
window.isEntryPointHidden = function(archivedMap, key) {
    if (!archivedMap || !key) return false;

    const direct = archivedMap[key];
    if (direct) return direct.hideEntryPoints === true;

    for (const info of Object.values(archivedMap)) {
        if (info && info.navId === key) return info.hideEntryPoints === true;
    }
    return false;
};

window.fetchArchivedPages = fetchArchivedPages;

// --- MEDIA FRAMING ---
// Skill-card media used to sit in a fixed 16:9 box whatever shape the source
// was, so a square still or a phone-captured clip got pillarboxed into a strip.
//
// The rule the owner chose is "square only when it fits": the box matches the
// source rather than the source being cropped to match the box. A 16:9 clip
// keeps its 16:9 box and loses nothing; a near-square still gets a square box;
// a tall capture gets a 3:4 box, which bounds the card height without
// discarding most of the frame.
//
// 16:9 stays the CSS default, so an unmeasured or broken source looks exactly
// as it does today and the common case never has to flip after layout.
window.MEDIA_WIDE_THRESHOLD = 1.5;
window.MEDIA_TALL_THRESHOLD = 0.75;

// 'auto' measures; the other three are the contributor overriding the measure,
// which matters for media whose subject sits off-centre.
window.MEDIA_FRAMING_OPTIONS = ['auto', 'wide', 'square', 'tall'];

// The nine-point focal grid for a cropped portrait, as literal
// object-position values. A whitelist rather than free text on purpose: this
// lands inside a style attribute, and escaping alone would not stop a crafted
// value from closing the declaration and adding its own.
window.PORTRAIT_FOCUS_VALUES = [
    'left top', 'center top', 'right top',
    'left center', 'center center', 'right center',
    'left bottom', 'center bottom', 'right bottom',
];

window.framingForRatio = function(ratio) {
    if (!ratio || !isFinite(ratio)) return null;
    if (ratio >= window.MEDIA_WIDE_THRESHOLD) return 'wide';
    if (ratio <= window.MEDIA_TALL_THRESHOLD) return 'tall';
    return 'square';
};

// `media` is the move's own media object: { src, framing, width, height }.
// Resolved in that order of confidence - an explicit framing, then stored
// dimensions, then measuring the file once it loads.
window.applyMediaFraming = function(mediaEl, wrapperEl, media) {
    if (!wrapperEl) return;
    const opts = (media && typeof media === 'object') ? media : { framing: media };

    const set = (name) => {
        wrapperEl.classList.remove('is-square', 'is-tall');
        if (name === 'square') wrapperEl.classList.add('is-square');
        else if (name === 'tall') wrapperEl.classList.add('is-tall');
        // 'wide' is the bare class, so there is nothing to add.
    };

    if (opts.framing && opts.framing !== 'auto' && window.MEDIA_FRAMING_OPTIONS.includes(opts.framing)) {
        set(opts.framing);
        return;
    }

    // Stored dimensions settle the box before the file has loaded, which
    // matters because skill media is lazy AND sits in a hidden tab: a lazy
    // image inside display:none never loads at all until the tab is opened, so
    // measurement alone means the box corrects itself in front of the reader
    // the first time they click Skills. Media uploaded through the library
    // records these; anything older falls through to measuring.
    const stored = window.framingForRatio(
        opts.width && opts.height ? Number(opts.width) / Number(opts.height) : null
    );
    if (stored) set(stored);

    if (!mediaEl) return;

    const measure = () => {
        // naturalWidth for <img>, videoWidth for <video> - both are 0 until the
        // source has actually loaded, and skill-card videos are lazy, so this
        // may not resolve until the card scrolls into view.
        const w = mediaEl.naturalWidth || mediaEl.videoWidth;
        const h = mediaEl.naturalHeight || mediaEl.videoHeight;
        const framing = window.framingForRatio(w && h ? w / h : null);
        if (framing) set(framing);
    };

    measure();
    mediaEl.addEventListener('load', measure);
    mediaEl.addEventListener('loadedmetadata', measure);
};

// --- CHARACTER MODES ---
// A full character fights out of more than one kit: a base kit, plus one or
// two ultimate modes that replace their whole moveset. Those are *states* of
// one character, not separate characters, so they share a page and swap the
// tab contents underneath a toggle.
//
// The model is additive on purpose - all 22 characters that exist today
// declare no modes at all and must keep rendering byte-identically:
//
//   frame_data.modes    = [{id:'base', label:'Base Kit'}, {id:'shrine', ...}]
//   frame_data.modeData = { shrine: { m1s: [], skills: [], specials: [] } }
//   desc_data.modeData  = { shrine: { profile, overview, matchups, ... } }
//
// Declaration (`modes`) is deliberately separate from content (`modeData`):
// renaming or reordering the toggle then never rewrites a single block, and a
// mode's content is addressable by a stable id rather than an array position.
//
// BASE_MODE_ID is reserved and always means "the existing top level". That is
// what makes the whole thing free for every page already in the database: no
// modes declared means one implicit base mode, which is exactly what the
// top-level m1s/skills/specials already are.
window.BASE_MODE_ID = 'base';

// window.FRAME_MOVE_CATEGORIES moved to js/character_tabs.js, which loads
// before this file on every page. It is derived from the tab vocabulary there
// (the tabs marked `frameMoves`), so which tabs hold frame data is declared
// once, next to the tabs themselves.

// --- BLOCKED MEDIA ---
//
// A reviewer flagging a file has to actually get it off the page, and the
// pages render contributor media from seven different places across five
// files (skill cards, image blocks, video blocks, profile portraits, gallery
// items, roster cards, tier portraits). Editing each one means the next
// render site added forgets, and "forgot" here means flagged media keeps
// showing.
//
// So this works on the DOM rather than on the seven call sites: sweep what is
// already there, then watch for what arrives. Tab switches, lazy loads and
// mode toggles all rebuild media long after boot, and an observer catches
// those without every renderer having to know this feature exists.
//
// The cost is bounded by the thing that makes it acceptable: **if nothing is
// flagged, nothing runs.** No sweep, no observer, no listeners. That is the
// normal state of the site, and flagged media is meant to be rare.
//
// This is a rendering guard, not a security control. The file still sits at
// its public storage URL - anyone holding the direct link keeps it. Taking it
// down for real is deleting the object, which stays the owner's job.
const BLOCKED_MEDIA_NOTICE = 'Media removed by a moderator';

// The same fact, in one word, for the places where the full sentence does not
// fit: a video BUTTON in a table cell or on a combo card is a small control,
// and a full-width notice in its place is bulkier than the thing it replaced
// (owner, 2026-08-18).
const BLOCKED_MEDIA_LABEL = 'Blocked';

let blockedMediaPromise = null;

// Returns a Set of blocked object paths, and an empty one on any failure.
// Deliberately fail-open: a moderation table that cannot be read must not
// blank out every image on the wiki, which is the failure mode of guessing
// the other way.
window.fetchBlockedMedia = function() {
    if (blockedMediaPromise) return blockedMediaPromise;

    blockedMediaPromise = (async () => {
        try {
            if (!window.supabaseClient) return new Set();
            const { data, error } = await window.supabaseClient
                .from('media_moderation').select('path').eq('status', 'flagged');
            if (error || !Array.isArray(data)) return new Set();
            return new Set(data.map(row => row.path).filter(Boolean));
        } catch (e) {
            return new Set();
        }
    })();

    return blockedMediaPromise;
};

// Matches on the trailing path segment rather than the whole URL: the same
// object is referenced as a raw name, percent-encoded, and occasionally with
// a query string, and all three end in the object's own name.
window.isBlockedMediaSrc = function(src, blocked) {
    if (!src || !blocked || !blocked.size) return false;

    const withoutQuery = String(src).split(/[?#]/)[0];
    const lastSegment = withoutQuery.substring(withoutQuery.lastIndexOf('/') + 1);
    if (!lastSegment) return false;

    if (blocked.has(lastSegment)) return true;
    try {
        return blocked.has(decodeURIComponent(lastSegment));
    } catch (e) {
        // A malformed escape sequence is not a match, and must not throw
        // mid-sweep and leave the rest of the page unswept.
        return false;
    }
};

function replaceWithBlockedNotice(element) {
    if (!element || !element.parentNode) return;

    // A video button gets the compact form. The REMOVAL is identical either
    // way - the URL and the click target both go - so this is only a question
    // of what fits where the thing used to be.
    const inline = !!(element.matches && element.matches('[data-wiki-video]'));

    const notice = document.createElement(inline ? 'span' : 'div');
    notice.className = inline ? 'media-blocked-inline' : 'media-blocked-notice';
    // textContent, not innerHTML - and the string is a constant anyway.
    notice.textContent = inline ? BLOCKED_MEDIA_LABEL : BLOCKED_MEDIA_NOTICE;
    element.parentNode.replaceChild(notice, element);
}

// Every element that can name a media file, and every attribute it can name it
// in. data-lazy-src because videos carry their real URL there until something
// scrolls them into view; data-wiki-video because a video in a table cell or on
// a combo card is a BUTTON that opens a player (v0.15 item 11), and a button is
// not an <img> or a <video> so nothing here used to see it.
const BLOCKED_MEDIA_SELECTOR =
    'img[src], video[src], video[data-lazy-src], source[src], [data-wiki-video]';
const BLOCKED_MEDIA_ATTRS = ['src', 'data-lazy-src', 'data-wiki-video'];

function blockedMediaSrcOf(element) {
    for (let i = 0; i < BLOCKED_MEDIA_ATTRS.length; i++) {
        const value = element.getAttribute(BLOCKED_MEDIA_ATTRS[i]);
        if (value) return value;
    }
    return null;
}

// What actually comes off the page, which is not always the element that
// matched. A <source> lives inside the media element it belongs to, and a
// player's <video> lives inside a shell carrying its own play, sound and
// duration controls - replacing either one alone leaves working chrome wired
// to nothing, which reads as a broken player rather than a moderated one.
function blockedMediaTarget(element) {
    let target = element;
    if (target.tagName === 'SOURCE' && target.parentNode) target = target.parentNode;
    const player = target.closest ? target.closest('[data-wiki-player]') : null;
    return player || target;
}

window.sweepBlockedMedia = function(root, blocked) {
    if (!root || !blocked || !blocked.size) return 0;

    const candidates = root.querySelectorAll ? root.querySelectorAll(BLOCKED_MEDIA_SELECTOR) : [];

    let removed = 0;
    candidates.forEach(element => {
        // A node replaced earlier in this same sweep - a player shell taking
        // its own video with it, say - is no longer on the page, and replacing
        // a detached node throws.
        if (!element.parentNode) return;
        if (!window.isBlockedMediaSrc(blockedMediaSrcOf(element), blocked)) return;
        replaceWithBlockedNotice(blockedMediaTarget(element));
        removed += 1;
    });
    return removed;
};

window.initBlockedMediaGuard = async function() {
    const blocked = await window.fetchBlockedMedia();
    if (!blocked.size) return null;

    window.sweepBlockedMedia(document, blocked);

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                window.sweepBlockedMedia(node, blocked);
                // The node itself, when media is appended directly rather
                // than as part of a rendered subtree.
                if (node.matches && node.matches(BLOCKED_MEDIA_SELECTOR)) {
                    if (window.isBlockedMediaSrc(blockedMediaSrcOf(node), blocked)) {
                        replaceWithBlockedNotice(blockedMediaTarget(node));
                    }
                }
            });
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
};

// --- MATCHUP TIERS ---
//
// One list, because this vocabulary is read in three places that have to
// agree: the live page (js/description.js), the editor's preview
// (js/editor-previews.js) and the editor's own dropdown (js/editor-tabs.js).
// It used to be two colour maps and a separate option array, which is how a
// rename half-lands - the dropdown offers a word the renderer has no colour
// for, and the tier renders white.
//
// Ordered worst-to-best from the point of view of the character whose page it
// is, and read in that order by all three.
window.MATCHUP_TIERS = [
    { id: 'Hopeless',             color: '#dc2626' },
    { id: 'Extreme Disadvantage', color: '#ef4444' },
    { id: 'Disadvantage',         color: '#fb923c' },
    { id: 'Slight Disadvantage',  color: '#fbbf24' },
    { id: 'Equal',                color: '#9ca3af' },
    { id: 'Slight Advantage',     color: '#a3e635' },
    { id: 'Advantage',            color: '#4ade80' },
    { id: 'Extreme Advantage',    color: '#22c55e' },
    { id: 'Dominating',           color: '#22d3ee' },
];

// Permanent, not a migration leftover.
//
// The v0.13 migration renames these two words in page_data, but deliberately
// does not touch page_history or pending_revisions: both are records of what
// somebody actually submitted and a reviewer actually approved, and editing
// them to say something else falsifies that record. So old revisions replay
// with the old words for as long as the history exists, and they have to keep
// rendering.
window.MATCHUP_TIER_ALIASES = {
    'Unwinnable': 'Hopeless',
    'Unloseable': 'Dominating',
};

// Always returns something renderable. An unrecognised tier keeps its own
// wording and renders white rather than being silently rewritten to a
// neighbouring difficulty - a matchup rating is a claim about the game, and
// guessing at one is worse than showing that nobody has set it properly.
window.resolveMatchupTier = function(tier) {
    const name = window.MATCHUP_TIER_ALIASES[tier] || tier || 'Equal';
    return window.MATCHUP_TIERS.find(t => t.id === name) || { id: name, color: '#ffffff' };
};

// The declared modes, or [] when a character has none. Callers should treat []
// and "one mode called base" as the same thing - the difference only decides
// whether a toggle is worth drawing.
window.getCharacterModes = function(frameData) {
    const modes = frameData && Array.isArray(frameData.modes) ? frameData.modes : [];
    return modes.filter(m => m && m.id).map(m => ({
        id: String(m.id),
        label: String(m.label || m.id),
    }));
};

window.isBaseMode = function(modeId) {
    return !modeId || modeId === window.BASE_MODE_ID;
};

// The frame data a given mode renders from. Non-base modes carry their own
// move arrays and nothing else - a mode with no skills written yet shows an
// empty Skills tab, which is the honest answer. Falling back to the base kit
// there would silently claim the ultimate has the same moves as the base.
window.resolveModeFrame = function(frameData, modeId) {
    const base = frameData || {};
    if (window.isBaseMode(modeId)) return base;

    const scoped = (base.modeData && base.modeData[modeId]) || {};
    const out = { modes: base.modes };
    window.FRAME_MOVE_CATEGORIES.forEach(cat => { out[cat] = scoped[cat] || []; });
    out.moveStrategies = scoped.moveStrategies;
    return out;
};

// The description data a given mode renders from.
//
// `profile` is the one key that falls back to the base mode, and the exception
// is deliberate: it is the character's identity card - portrait, archetype,
// health - not an analysis of the kit. A mode that has not overridden its
// portrait should show the character, not an empty box. Everything else
// (overview, strategy, matchups, counterplay) is kit-specific by definition
// and renders empty until someone writes it for that mode.
window.resolveModeDesc = function(descData, modeId) {
    const base = descData || {};
    if (window.isBaseMode(modeId)) return base;

    const scoped = (base.modeData && base.modeData[modeId]) || {};
    return Object.assign({}, scoped, {
        profile: scoped.profile || base.profile,
    });
};

// Splits a possibly state-wrapped delta into the state it targets and the
// plain scope underneath. Everything that reads a revision's scope to decide
// what to show - the queue label, the changed-tab markers, the preview's
// opening tab, the editor's intercept path - has to look past the wrapper, and
// they must all split it the same way.
//
// Returns modeId: null for an ordinary delta, so callers can treat the result
// uniformly rather than branching on the scope first.
window.unwrapModeDelta = function(scope, key) {
    if (scope !== 'mode' || typeof key !== 'string') return { modeId: null, scope, key };

    const parts = key.split('::');
    const modeId = parts.shift();
    const innerScope = parts.shift() || '';
    return { modeId, scope: innerScope, key: parts.join('::') || 'full' };
};

// --- SYSTEM PAGE SECTION IDENTITY ---
//
// A system page is `{ tabs: [ { tabId, tabLabel, sections: [ { sectionTitle,
// blocks } ] } ] }`, and NOTHING IN IT HAS A STABLE ID. Sections carry no
// identifier at all, and `tabId` is re-slugged from the label on every rename
// (js/editor-system.js), so it is a display name wearing an id's clothes.
//
// Keys are therefore DERIVED, not stored. Both sides of a delta compute the
// same key from the same content, so nothing has to be migrated and no
// existing page changes shape - the same reasoning as the section anchors in
// item 5, and the same trade: a RENAME reads as a delete plus an add, exactly
// as renaming a matchup opponent already does.
//
// Position is deliberately not part of the key. Item 8 makes sections
// reorderable, and a positional key would make every reorder look like every
// section changing at once.
window.slugifySystemKey = function(text) {
    return String(text == null ? '' : text)
        .trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'untitled';
};

window.indexSystemTabs = function(descData) {
    const tabs = (descData && Array.isArray(descData.tabs)) ? descData.tabs : [];
    const seen = Object.create(null);
    return tabs.map((tab, tabIdx) => {
        const base = window.slugifySystemKey((tab && (tab.tabId || tab.tabLabel)) || '');
        seen[base] = (seen[base] || 0) + 1;
        const tabKey = seen[base] === 1 ? base : `${base}-${seen[base]}`;
        return { tabKey, tabIdx, tab };
    });
};

window.indexSystemSections = function(descData) {
    const out = [];
    window.indexSystemTabs(descData).forEach(({ tabKey, tabIdx, tab }) => {
        const sections = (tab && Array.isArray(tab.sections)) ? tab.sections : [];
        const seen = Object.create(null);
        sections.forEach((section, secIdx) => {
            const base = window.slugifySystemKey((section && section.sectionTitle) || '');
            seen[base] = (seen[base] || 0) + 1;
            const secKey = seen[base] === 1 ? base : `${base}-${seen[base]}`;
            out.push({ tabKey, secKey, key: `${tabKey}::${secKey}`, tabIdx, secIdx, tab, section });
        });
    });
    return out;
};

window.splitSystemKey = function(key) {
    const parts = String(key == null ? '' : key).split('::');
    return { tabKey: parts[0] || '', secKey: parts.slice(1).join('::') || '' };
};

window.findSystemTab = function(descData, tabKey) {
    const hit = window.indexSystemTabs(descData).find(t => t.tabKey === tabKey);
    return hit ? hit.tab : null;
};

// --- DELTA INJECTION ENGINE ---
// Shared by admin.js, editor.js, and history.js, which each need to
// reconstruct a full description/frame-data object from a stored
// scoped patch (used for live preview, revision merging, and history
// replay respectively).
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    // --- SMART BATCH UNPACKER (handles bundled multi-field submissions) ---
    if (scope === 'multi' && Array.isArray(payload)) {
        payload.forEach(edit => {
            const res = window.applyDeltaToData(newDesc, newFrame, edit.scope, edit.key, edit.payload);
            newDesc = res.newDesc;
            newFrame = res.newFrame;
        });
        return { newDesc, newFrame };
    }

    // --- MODE UNWRAPPER (a delta aimed at one character state) ---
    // Key shape: `<modeId>::<innerScope>[::<innerKey>]`, payload identical to
    // whatever the inner scope normally carries. Rather than duplicating all
    // nine branches below with a mode-aware twin, this peels the mode off and
    // recurses against that mode's own sub-objects, then puts them back.
    // Adding a scope later therefore costs nothing here.
    //
    // A base-mode delta never reaches this branch - the editor emits the plain
    // scope for base, so every ticket ever submitted keeps applying unchanged.
    if (scope === 'mode' && typeof key === 'string') {
        const firstSep = key.indexOf('::');
        if (firstSep === -1) return { newDesc, newFrame };

        const modeId = key.slice(0, firstSep);
        const rest = key.slice(firstSep + 2);
        const secondSep = rest.indexOf('::');
        const innerScope = secondSep === -1 ? rest : rest.slice(0, secondSep);
        const innerKey = secondSep === -1 ? 'full' : rest.slice(secondSep + 2);

        if (window.isBaseMode(modeId)) {
            return window.applyDeltaToData(newDesc, newFrame, innerScope, innerKey, payload);
        }

        if (!newDesc.modeData) newDesc.modeData = {};
        if (!newFrame.modeData) newFrame.modeData = {};

        const res = window.applyDeltaToData(
            newDesc.modeData[modeId] || {},
            newFrame.modeData[modeId] || {},
            innerScope, innerKey, payload
        );

        newDesc.modeData[modeId] = res.newDesc;
        newFrame.modeData[modeId] = res.newFrame;
        return { newDesc, newFrame };
    }

    // The toggle itself: which states exist, and what they are called. Held
    // apart from the content so renaming a mode cannot touch a single block.
    if (scope === 'modes') {
        newFrame.modes = payload;
        return { newDesc, newFrame };
    }

    // --- Safely intercept full modular replacements ---
    //
    // WHOLE-DOCUMENT REPLACEMENT, AND THE REASON IT IS BEING RETIRED. Every
    // system and tier list submission used to arrive as this one scope carrying
    // the entire desc_data, so approving two tickets for one page silently
    // reverted the first: each payload was captured from the live page as the
    // contributor found it, and the second wrote its whole snapshot over the
    // first's approved change. Nothing warned anyone - not the queue, not the
    // reviewer, not the contributor whose work disappeared.
    //
    // Kept, because tickets submitted before the scopes below existed are still
    // sitting in the queue and have to stay reviewable and applicable.
    if (scope === 'system_data') {
        return { newDesc: JSON.parse(JSON.stringify(payload)), newFrame };
    }

    // One section of one tab. The scope that replaces system_data for new
    // submissions - see js/editor-system.js buildSystemDeltas.
    if (scope === 'system_section') {
        const { tabKey, secKey } = window.splitSystemKey(key);
        const tab = window.findSystemTab(newDesc, tabKey);
        if (!tab) {
            console.error(`[Delta] system_section names tab "${tabKey}", which this page no longer has.`, { key });
            return { newDesc, newFrame };
        }
        if (!Array.isArray(tab.sections)) tab.sections = [];

        const idx = window.indexSystemSections(newDesc)
            .findIndex(e => e.tabKey === tabKey && e.secKey === secKey);

        if (payload === null) {
            if (idx > -1) {
                const target = window.indexSystemSections(newDesc)[idx];
                target.tab.sections.splice(target.secIdx, 1);
            }
        } else if (idx > -1) {
            const target = window.indexSystemSections(newDesc)[idx];
            target.tab.sections[target.secIdx] = payload;
        } else {
            // A section the contributor added. Appended rather than positioned:
            // where it goes is the tab's business, and the tab ships its own
            // order delta when the author moves things.
            tab.sections.push(payload);
        }
        return { newDesc, newFrame };
    }

    // A tab's own metadata and the order of its sections - held apart from the
    // sections themselves for the same reason the character mode toggle is held
    // apart from its content: renaming a tab must not touch a single block.
    if (scope === 'system_tab') {
        if (!Array.isArray(newDesc.tabs)) newDesc.tabs = [];
        const tabIdx = window.indexSystemTabs(newDesc).findIndex(t => t.tabKey === key);

        if (payload === null) {
            if (tabIdx > -1) newDesc.tabs.splice(tabIdx, 1);
            return { newDesc, newFrame };
        }
        if (tabIdx === -1) {
            newDesc.tabs.push(payload);
            return { newDesc, newFrame };
        }

        const tab = newDesc.tabs[tabIdx];
        const existing = tab.sections || [];
        Object.keys(payload).forEach(k => { if (k !== 'sections' && k !== 'order') tab[k] = payload[k]; });

        // Order arrives as a list of section keys, not as section content, so a
        // reorder cannot carry a stale copy of anybody's prose with it.
        if (Array.isArray(payload.order)) {
            const byKey = new Map(window.indexSystemSections(newDesc)
                .filter(e => e.tabKey === key)
                .map(e => [e.secKey, e.section]));
            const reordered = payload.order.map(k => byKey.get(k)).filter(Boolean);
            existing.forEach(s => { if (!reordered.includes(s)) reordered.push(s); });
            tab.sections = reordered;
        }
        return { newDesc, newFrame };
    }

    // A tier list's tiers and changelog, per tab. Not split per TIER: moving a
    // character from A to S changes two tiers at once, so a per-tier scope would
    // manufacture a conflict out of a single ordinary edit.
    if (scope === 'tierlist_tiers' || scope === 'tierlist_changelog') {
        const field = scope === 'tierlist_tiers' ? 'tiers' : 'changelog';
        const tab = window.findSystemTab(newDesc, key);
        if (!tab) {
            console.error(`[Delta] ${scope} names tab "${key}", which this page no longer has.`);
            return { newDesc, newFrame };
        }
        tab[field] = payload;
        return { newDesc, newFrame };
    }

    // --- ORDER ---
    //
    // The one thing a delta could not say. Every other scope names an ENTRY and
    // replaces it; nothing named the SEQUENCE, so reordering was invisible at
    // both ends:
    //
    //   The submit scan pairs local against cloud by identity
    //   (`cloudMoves.find(old => old.id === m.id)`), so a move that only
    //   changed position has a byte-identical partner and produces no payload -
    //   the editor reported "no changes detected" and refused to submit.
    //
    //   And this function replaces in place (`findIndex` then assign), so even
    //   a ticket that did carry the new order would have written each entry
    //   back into the slot it already occupied.
    //
    // Together that is the owner's report: reorder alone would not submit, and
    // reorder plus a wording change submitted, applied the wording, and left
    // the order untouched.
    //
    // `key` is the dotted path js/editor-reorder.js already names its lists by
    // - "frame.skills", "desc.comboGroups" - so the strip that does the
    // reordering and the delta that records it use one vocabulary. `payload` is
    // the identity of each entry in the new order.
    //
    // Entries the payload does not mention are KEPT, appended in their existing
    // relative order. A reorder must never be able to delete: the ticket was
    // raised against a snapshot, and anything added since is not this delta's
    // business.
    if (scope === 'order') {
        const parts = String(key || '').split('.');
        const rootName = parts.shift();
        const root = rootName === 'frame' ? newFrame : newDesc;

        let parent = root;
        const last = parts.pop();
        for (const part of parts) {
            const step = /^\d+$/.test(part) ? Number(part) : part;
            if (parent === null || parent === undefined) { parent = null; break; }
            parent = parent[step];
        }

        const list = parent && last !== undefined ? parent[last] : null;
        if (!Array.isArray(list) || !Array.isArray(payload)) {
            console.error(`[Delta] order names "${key}", which is not a list on this page.`);
            return { newDesc, newFrame };
        }

        // Identity is the id for a move and the key field for a keyed entry;
        // both are resolved by trying each in turn rather than by the caller
        // having to say which, because one scope covers both kinds of list.
        const identify = (entry) => {
            if (!entry || typeof entry !== 'object') return null;
            for (const field of ['id', 'title', 'opponent', 'topic', 'starter', 'theory', 'name']) {
                if (entry[field] !== undefined && entry[field] !== null) return String(entry[field]);
            }
            return null;
        };

        // BACKWARD COMPATIBILITY: WHEN IN DOUBT, CHANGE NOTHING.
        //
        // This runs against page_data written long before the scope existed,
        // and two shapes in there make a reorder ambiguous:
        //
        //   An entry with no identifiable field at all - older content, or a
        //   list this scope was never meant for.
        //
        //   Two entries sharing one identity. Combo group titles are
        //   contributor text and js/description.js already notes two groups may
        //   share a title, so this is not hypothetical.
        //
        // Either way there is no single correct answer, and guessing would
        // silently shuffle a reader's page. Refusing leaves the list exactly as
        // it was - the reorder is lost, which is visible and recoverable, while
        // corruption is neither. The scan in js/editor-core.js declines to emit
        // in both cases too, so this is the second line rather than the first.
        const ids = list.map(identify);
        if (ids.some(id => id === null)) {
            console.warn(`[Delta] order "${key}" skipped: an entry has no identity to order by.`);
            return { newDesc, newFrame };
        }
        if (new Set(ids).size !== ids.length) {
            console.warn(`[Delta] order "${key}" skipped: two entries share an identity.`);
            return { newDesc, newFrame };
        }

        // Entries the payload does not name KEEP THEIR INDEX rather than being
        // pushed to the end. A ticket is raised against a snapshot, so anything
        // added since is not this delta's business - and appending it would
        // move content the contributor never touched.
        const wanted = payload.map(String).filter(id => ids.includes(id));
        const named = new Set(wanted);
        const queue = wanted.map(id => list[ids.indexOf(id)]);

        const ordered = list.map(entry => (named.has(identify(entry)) ? queue.shift() : entry));

        parent[last] = ordered;
        return { newDesc, newFrame };
    }

    // Whole-value block sections. The fixed four, plus any declared in
    // js/character_tabs.js FIXED_BLOCK_SECTIONS - comboIntro is one, and
    // leaving it out is precisely how a Starter Guide delta reported success
    // and wrote nothing.
    const fixedScopes = ['profile', 'playstyle', 'overview', 'strategy']
        .concat((window.FIXED_BLOCK_SECTIONS || []).map(f => f.scope));

    if (fixedScopes.includes(scope)) {
        const field = ((window.FIXED_BLOCK_SECTIONS || []).find(f => f.scope === scope) || {}).field || scope;
        newDesc[field] = payload;
    }
    else if (scope === 'extra') {
        if (!newDesc.extras) newDesc.extras = [];
        if (payload === null) {
            newDesc.extras = newDesc.extras.filter(e => e.title !== key);
        } else {
            const idx = newDesc.extras.findIndex(e => e.title === key);
            if (idx > -1) newDesc.extras[idx] = payload; else newDesc.extras.push(payload);
        }
    }
    // Every keyed section (js/character_tabs.js): matchups, counterplay,
    // starterGuide, and anything declared there later.
    //
    // THIS IS THE LAST STEP OF APPLYING A TICKET, and an unrecognised scope
    // used to fall all the way through to the return below - returning the data
    // UNCHANGED, with no error. The reviewer got a success modal and nothing
    // was written. That is what shipped for Starter Guide: it had a submit
    // scan, a merge compiler entry, a diff and a renderer, and the one branch
    // that actually writes the value did not know the scope existed.
    //
    // The missing `starterGuide` key on existing pages was NOT the cause - the
    // `if (!newDesc[field])` below has always created it on first insert. The
    // cause was that there was no branch to reach it.
    else if (window.getKeyedSectionByScope && window.getKeyedSectionByScope(scope)) {
        const section = window.getKeyedSectionByScope(scope);
        const field = section.field;
        const keyField = section.keyField;

        if (!newDesc[field]) newDesc[field] = [];
        if (payload === null) {
            newDesc[field] = newDesc[field].filter(e => e[keyField] !== key);
        } else {
            const idx = newDesc[field].findIndex(e => e[keyField] === key);
            if (idx > -1) newDesc[field][idx] = payload; else newDesc[field].push(payload);
        }
    }
    // One delta per gallery item, keyed by name. A gallery is the one page
    // type where many people add many small things independently - thirty
    // contributors submitting an emote each must never collide, and they
    // cannot if each submission only ever names its own item.
    else if (scope === 'gallery_item') {
        if (!newDesc.items) newDesc.items = [];
        if (payload === null) {
            newDesc.items = newDesc.items.filter(i => i.name !== key);
        } else {
            const idx = newDesc.items.findIndex(i => i.name === key);
            if (idx > -1) newDesc.items[idx] = payload; else newDesc.items.push(payload);
        }
    }
    // The prose above a gallery, and the tool config on a tool page. Whole-
    // value replacements, like profile/playstyle - they are single objects,
    // not lists with identities.
    // The prose around a gallery or a tool. 'gallery_intro' is the original
    // name and is kept because tickets carrying it may already be queued; new
    // submissions use the plain key, which reads correctly on both page types.
    else if (scope === 'gallery_intro' || scope === 'intro') {
        newDesc.intro = payload;
    }
    else if (scope === 'notes') {
        newDesc.notes = payload;
    }
    else if (scope === 'tool_config') {
        newDesc.tool = payload;
    }
    else if (scope === 'move') {
        const [cat, moveId] = key.split('::');
        if (payload === null) {
            if (newFrame[cat]) newFrame[cat] = newFrame[cat].filter(m => m.id !== moveId);
            if (newDesc.moveStrategies) delete newDesc.moveStrategies[moveId];
        } else {
            if (!newFrame[cat]) newFrame[cat] = [];
            const idx = newFrame[cat].findIndex(m => m.id === moveId);
            if (payload.frame_data) {
                if (idx > -1) newFrame[cat][idx] = payload.frame_data;
                else newFrame[cat].push(payload.frame_data);
            }
            if (!newDesc.moveStrategies) newDesc.moveStrategies = {};
            newDesc.moveStrategies[moveId] = payload.desc_data || [];
        }
    }
    // Nothing matched. This used to return silently, which is how a Starter
    // Guide ticket could pass every check, show the reviewer a success modal
    // and write nothing at all. A scope this function does not understand is
    // always a bug - either a new scope was added without a branch here, or
    // js/character_tabs.js did not load and the keyed-section lookup above
    // could not run.
    else {
        console.error(
            `[Delta] No handler for scope "${scope}" - the edit was NOT applied. `
            + `If this is a keyed section, check js/character_tabs.js loaded before this file.`,
            { scope, key }
        );
    }

    return { newDesc, newFrame };
};

// --- SHARED MANGA TOOLTIP ---
// Used by description.js (inline callouts) and framedata.js (frame
// timeline phases) for the same hover tooltip, so both element types
// get identical styling regardless of which is hovered first.
let frameTooltip = null;

window.initTooltip = function() {
    if (!frameTooltip) {
        frameTooltip = document.getElementById('wiki-frame-tooltip');
        if (!frameTooltip) {
            frameTooltip = document.createElement('div');
            frameTooltip.id = 'wiki-frame-tooltip';

            frameTooltip.style.position = 'fixed';
            frameTooltip.style.zIndex = '100000';
            frameTooltip.style.pointerEvents = 'none'; // Prevents it from stealing the hover cursor
            frameTooltip.style.background = 'var(--bg-main, #050505)';
            frameTooltip.style.border = '2px solid var(--border-color, #333)';
            frameTooltip.style.padding = '0.75rem 1rem';
            frameTooltip.style.boxShadow = '6px 6px 0px var(--manga-shadow, #000)';
            // min() with a viewport-relative term so a long callout can never
            // be wider than the screen itself on a narrow phone - a fixed
            // 320px max-width left no room for positionTooltip's flip logic
            // to keep it on-screen once content pushed close to that width.
            frameTooltip.style.maxWidth = 'min(320px, calc(100vw - 2rem))';
            frameTooltip.style.color = 'var(--text-white, #fff)';
            frameTooltip.style.fontFamily = 'var(--text-mono)';
            frameTooltip.style.fontSize = '0.75rem';
            frameTooltip.style.display = 'none'; // Hidden by default

            document.body.appendChild(frameTooltip);
        }
    }
};

// Positions the shared tooltip near (x, y), flipping away from the right/bottom
// viewport edges. Shared by the mouse and touch bindings below.
function positionTooltip(x, y) {
    const box = frameTooltip.getBoundingClientRect();
    const margin = 8; // keeps it off the exact viewport edge

    if (x + 15 + box.width > window.innerWidth) x -= box.width + 15; else x += 15;
    if (y + 15 + box.height > window.innerHeight) y -= box.height + 15; else y += 15;

    // Final safety clamp: on a narrow phone, a long callout's tooltip can be
    // wide enough that flipping to the other side of the cursor still isn't
    // enough room - always pin it fully inside the viewport as a last resort,
    // regardless of how the flip above landed.
    x = Math.min(Math.max(x, margin), window.innerWidth - box.width - margin);
    y = Math.min(Math.max(y, margin), window.innerHeight - box.height - margin);

    frameTooltip.style.left = x + 'px';
    frameTooltip.style.top = y + 'px';
}

// Tapping outside whichever element currently owns the tooltip closes it.
// Registered once (lazily, alongside the tooltip element itself) rather than
// per-bindTooltip call, since bindTooltip runs once per phase/callout.
let tooltipOwner = null;
function closeTooltipIfOutside(target) {
    if (frameTooltip && tooltipOwner && !tooltipOwner.contains(target)) {
        frameTooltip.style.display = 'none';
        tooltipOwner = null;
    }
}

// Binds hover/move/leave listeners (desktop) plus a tap-to-toggle listener
// (touch, which never fires mouseenter/mousemove/mouseleave on real devices)
// that show titleHtml in the shared tooltip.
window.bindTooltip = function(element, titleHtml) {
    element.addEventListener('mouseenter', () => {
        window.initTooltip();
        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
    });

    element.addEventListener('mousemove', (e) => {
        if (frameTooltip) positionTooltip(e.clientX, e.clientY);
    });

    element.addEventListener('mouseleave', () => {
        if (frameTooltip) frameTooltip.style.display = 'none';
    });

    element.addEventListener('touchend', (e) => {
        // Prevents the browser's synthetic mouse/click compatibility events
        // from double-firing this same toggle right after touchend.
        e.preventDefault();
        window.initTooltip();

        if (!document._tooltipOutsideTapBound) {
            document.addEventListener('touchstart', (ev) => closeTooltipIfOutside(ev.target));
            document._tooltipOutsideTapBound = true;
        }

        if (tooltipOwner === element && frameTooltip.style.display === 'block') {
            frameTooltip.style.display = 'none';
            tooltipOwner = null;
            return;
        }

        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
        tooltipOwner = element;

        const touch = e.changedTouches[0];
        positionTooltip(touch.clientX, touch.clientY);
    });
};

// --- PAGE URL BUILDER ---
// Returns a root-relative path (no '../' prefix - see markNotifRead, which
// prepends getRootPath() at click time). Callers that need a navigable
// path from the current page should do the same rather than baking a
// fixed depth into the stored value, since e.g. notification links are
// shown from every page on the site, at every folder depth.
window.buildPageUrl = function(pageId, pageType) {
    if (pageType === 'tierlist') return 'systems/tierlist/index.html';
    if (pageType === 'system') return `systems/${pageId}/index.html`;
    const folderName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    return `characters/${folderName}/index.html`;
};

// --- GLOBAL SUPABASE BACKEND ---
const SUPABASE_URL = 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// --- LOCAL-ONLY BACKEND OVERRIDE (v0.14) ---
//
// Points a locally served copy of the site at a different Supabase project -
// in practice a branching preview database - so a feature can be clicked
// through against real Postgres before its migration ever reaches production.
//
// This exists because of a gap the test suite cannot close. Every auth spec in
// this project mocks Supabase and never touches a database, so RLS predicates,
// grant gaps, trigger ordering and RPC guards are all unverified until
// somebody uses them. Supabase branching proves a migration APPLIES; it does
// not prove the feature WORKS, and those are different claims. Without this,
// the first real click on a release's worth of policies happens on production.
//
// GUARDED TWICE, and both guards are deliberate:
//
//   1. The hostname must be localhost or a loopback address. dogslamloop.com
//      can never satisfy this, whatever is in storage.
//   2. A localStorage key must be set by hand. Visiting a local copy does not
//      opt you in; you have to have asked for it.
//
// Neither guard depends on a build flag or an environment variable, because
// this site has neither - it is static files served as-is, so the check has to
// be something true of the running page.
//
// Usage, in the console of a locally served page:
//   localStorage.setItem('dsl_supabase_override',
//     JSON.stringify({ url: 'https://<ref>.supabase.co', key: '<anon key>' }));
//   location.reload();
//
// Clear it with localStorage.removeItem('dsl_supabase_override').
function resolveSupabaseTarget() {
    const target = { url: SUPABASE_URL, key: SUPABASE_KEY, overridden: false };

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
    if (!isLocal) return target;

    try {
        const raw = window.localStorage.getItem('dsl_supabase_override');
        if (!raw) return target;

        const parsed = JSON.parse(raw);
        // A malformed override must fall back to production rather than
        // leaving the page with no backend at all.
        if (!parsed || typeof parsed.url !== 'string' || typeof parsed.key !== 'string') return target;
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(parsed.url)) return target;

        target.url = parsed.url.replace(/\/$/, '');
        target.key = parsed.key;
        target.overridden = true;
    } catch (e) {
        // Storage can throw in a locked-down context. Production is the answer.
    }

    return target;
}

// An on-page banner, not just a console warning, and it was added after the
// override drew blood on its first day of use.
//
// What happened: a preview branch was created, tested, and then deleted - and
// the override stayed in localStorage pointing at a project that no longer
// existed. Every request failed, login stopped working, and nothing on screen
// said why. A console warning is invisible to somebody who is not already
// suspicious, and the whole failure mode of this feature is not being
// suspicious of a page that looks completely normal.
//
// So: impossible to miss, and one click to undo.
function showOverrideBanner(url) {
    const paint = () => {
        if (!document.body || document.getElementById('dsl-override-banner')) return;

        const bar = document.createElement('div');
        bar.id = 'dsl-override-banner';
        bar.setAttribute('role', 'status');
        bar.style.cssText = [
            'position:fixed', 'left:0', 'bottom:0', 'z-index:2147483647',
            'background:#eab308', 'color:#000', 'font-family:monospace',
            'font-size:11px', 'padding:6px 10px', 'display:flex',
            'align-items:center', 'gap:10px', 'max-width:100vw',
            'box-sizing:border-box', 'border-top:2px solid #000',
        ].join(';');

        let host = url;
        try { host = new URL(url).hostname; } catch (e) { /* keep the raw string */ }

        const label = document.createElement('strong');
        label.textContent = `LOCAL SUPABASE OVERRIDE → ${host}`;
        bar.appendChild(label);

        // The page most likely to be confusing, called out by name. index.html
        // is the only page on the site carrying a CSP, and its connect-src
        // pins the production project - so requests from here are blocked no
        // matter what the client was built with.
        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (csp && csp.getAttribute('content') && csp.getAttribute('content').includes('connect-src')
            && !csp.getAttribute('content').includes(host)) {
            const warn = document.createElement('span');
            warn.textContent = "— this page's CSP blocks it; use any other page";
            bar.appendChild(warn);
        }

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = 'USE PRODUCTION';
        clear.style.cssText = 'font:inherit;cursor:pointer;padding:2px 8px;border:2px solid #000;background:#fff';
        clear.addEventListener('click', () => {
            try { window.localStorage.removeItem('dsl_supabase_override'); } catch (e) { /* ignore */ }
            window.location.reload();
        });
        bar.appendChild(clear);

        document.body.appendChild(bar);
    };

    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint);
}

// Attach client to the global window object so editor.js can use it later
window.supabaseClient = null;
try {
    const target = resolveSupabaseTarget();
    if (window.supabase && target.url.startsWith('http')) {
        window.supabaseClient = window.supabase.createClient(target.url, target.key);
        window.supabaseIsOverridden = target.overridden;
        if (target.overridden) {
            // Loud on purpose. Testing against a preview database and thinking
            // it is production - or the reverse - is the one way this helps
            // nobody, so it says so on every single page load.
            console.warn(`[Supabase] LOCAL OVERRIDE ACTIVE -> ${target.url}. This is not production.`);
            showOverrideBanner(target.url);
        }
    }
} catch (e) {
    console.error("Failed to connect to global Supabase instance:", e);
}

// --- GLOBAL AUTHENTICATION & PROFILE MODAL INJECTOR ---
window.injectAuthModal = function() {
    if (document.getElementById('auth-modal-overlay')) return;

    // 1. The Better Auth Modal (Login & Register Tabs)
    const authModalHTML = `
    <div id="auth-modal-overlay" class="modal-overlay hidden">
        <div class="modal-box modal-sm accent-blue">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: none; padding-bottom: 0;">
                <h3>SYSTEM ACCESS</h3>
                <span id="auth-status-indicator" class="status-dot offline"></span>
            </div>
            
            <div class="auth-tabs" style="display: flex; border-bottom: 2px solid var(--border-color); margin-bottom: 1.5rem; padding: 0 1.5rem;">
                <button id="auth-tab-login" class="btn-ghost active" style="flex: 1; border-bottom: none; opacity: 1; border-radius: 0; padding: 1rem 0;">LOGIN</button>
                <button id="auth-tab-register" class="btn-ghost" style="flex: 1; border-bottom: none; opacity: 0.5; border-radius: 0; padding: 1rem 0;">REGISTER</button>
            </div>

            <div class="modal-body" style="padding-top: 0;">
                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 2px dashed var(--border-color); padding-bottom: 1.5rem;">
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('discord')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-19.32-72.15ZM42.68,65.33C38,65.33,34.2,61.13,34.2,56s3.76-9.33,8.48-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Zm41.72,0c-4.73,0-8.52-4.2-8.52-9.33s3.75-9.33,8.52-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Z"/></svg></span> LOGIN WITH DISCORD
                    </button>
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('github')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></span> LOGIN WITH GITHUB
                    </button>
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('google')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg></span> LOGIN WITH GOOGLE
                    </button>
                </div>

                <!-- LOGIN VIEW -->
                <div id="auth-view-login" class="editor-row" style="flex-direction: column; gap: 0.5rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-muted); text-align: left;">MANUAL LOGIN</label>
                    <input type="email" id="auth-email-login" class="editor-input" placeholder="Email Address" style="margin-bottom: 0.25rem;">
                    <input type="password" id="auth-password-login" class="editor-input" placeholder="Password">
                    <button id="btn-auth-action-login" class="btn-sys btn-sys-blue" style="margin-top: 0.5rem; width: 100%;">AUTHENTICATE</button>
                </div>

                <!-- REGISTER VIEW -->
                <div id="auth-view-register" class="editor-row hidden" style="flex-direction: column; gap: 0.5rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-muted); text-align: left;">CREATE ACCOUNT</label>
                    <input type="text" id="auth-name-register" class="editor-input" placeholder="Display Name (Public)" style="margin-bottom: 0.25rem;">
                    <input type="email" id="auth-email-register" class="editor-input" placeholder="Email Address" style="margin-bottom: 0.25rem;">
                    <input type="password" id="auth-password-register" class="editor-input" placeholder="Password (Min 6 Characters)">
                    <button id="btn-auth-action-register" class="btn-sys btn-sys-green" style="margin-top: 0.5rem; width: 100%;">REGISTER ACCOUNT</button>
                </div>

                <div id="auth-feedback-message" class="hidden" style="font-size: 0.75rem; font-family: var(--text-mono); text-align: left; margin-top: 0.75rem; padding: 0.5rem; border-radius: 4px;"></div>
            </div>
            <div class="modal-footer" style="justify-content: center;">
                <button class="btn-sys btn-sys-regular" style="width: 100%;" onclick="document.getElementById('auth-modal-overlay').classList.add('hidden')">CANCEL</button>
            </div>
        </div>
    </div>`;

    // 2. The Custom Profile Modal
    const profileModalHTML = `
    <div id="profile-modal-overlay" class="modal-overlay hidden">
        <div class="modal-box modal-lg accent-purple">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>SYSTEM PROFILE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body">
                <div class="profile-identity">
                    <span id="profile-standing-icon" class="profile-standing-icon"></span>
                    <div class="profile-identity-text">
                        <strong id="profile-current-name"></strong>
                        <span id="profile-standing-label" class="profile-standing-label"></span>
                    </div>
                </div>

                <div class="profile-field">
                    <label for="profile-new-name">DISPLAY NAME</label>
                    <input type="text" id="profile-new-name" class="editor-input" placeholder="Enter custom display name...">
                </div>

                <div class="profile-field">
                    <label for="profile-flair">FLAIR <span id="profile-flair-count" class="profile-count"></span></label>
                    <input type="text" id="profile-flair" class="editor-input" maxlength="32" placeholder="Sukuna main, guide writer...">
                    <p class="profile-hint">Shown beside your name wherever you post.</p>
                </div>

                <div class="profile-field">
                    <label for="profile-bio">ABOUT YOU <span id="profile-bio-count" class="profile-count"></span></label>
                    <textarea id="profile-bio" class="editor-input profile-bio" maxlength="500" rows="4" placeholder="What do you play, and what do you write about?"></textarea>
                </div>

                <div class="profile-field">
                    <label class="profile-toggle" for="profile-private">
                        <input type="checkbox" id="profile-private">
                        <span>Keep my description private</span>
                    </label>
                    <p class="profile-hint">Your name, flair and standing stay visible either way &mdash; they already appear on everything you have submitted.</p>
                </div>

                <div class="profile-field hidden" id="profile-password-field">
                    <label for="profile-new-password">CHANGE PASSWORD</label>
                    <div class="profile-inline-row">
                        <input type="password" id="profile-new-password" class="editor-input" placeholder="New password..." autocomplete="new-password">
                        <button id="btn-profile-password" class="btn-sys btn-sys-regular" type="button">UPDATE</button>
                    </div>
                </div>
                <p class="profile-hint hidden" id="profile-oauth-note"></p>

                <p class="profile-feedback hidden" id="profile-feedback"></p>
            </div>
            <div class="modal-footer" style="justify-content: space-between;">
                <button id="btn-profile-logout" class="btn-sys btn-sys-red">LOGOUT</button>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-sys btn-sys-regular" onclick="document.getElementById('profile-modal-overlay').classList.add('hidden')">CANCEL</button>
                    <button id="btn-profile-save" class="btn-sys btn-sys-purple">SAVE CHANGES</button>
                </div>
            </div>
        </div>
    </div>`;

    // 3. The Custom System Alert Modal
    const alertModalHTML = `
    <div id="alert-modal-overlay" class="modal-overlay tier-priority hidden">
        <div class="modal-box modal-sm accent-green">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>SYSTEM MESSAGE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body centered-text">
                <p id="alert-modal-msg" style="font-family: var(--text-mono); font-size: 0.85rem; color: var(--text-white); margin: 0 0 1rem 0; line-height: 1.5;"></p>
            </div>
            <div class="modal-footer centered-actions">
                <button id="btn-alert-close" class="btn-sys btn-sys-green" style="width: 100%;">ACKNOWLEDGE</button>
            </div>
        </div>
    </div>`;

    // Inject all three into the DOM
    const div = document.createElement('div');
    div.innerHTML = authModalHTML + profileModalHTML + alertModalHTML;
    while(div.firstChild) document.body.appendChild(div.firstChild);

    // --- LOGIC: TABS ---
    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const viewLogin = document.getElementById('auth-view-login');
    const viewRegister = document.getElementById('auth-view-register');
    const feedbackMsg = document.getElementById('auth-feedback-message');

    tabLogin.onclick = () => {
        tabLogin.classList.add('active'); tabLogin.style.opacity = '1';
        tabRegister.classList.remove('active'); tabRegister.style.opacity = '0.5';
        viewLogin.classList.remove('hidden'); viewRegister.classList.add('hidden');
        feedbackMsg.classList.add('hidden');
    };

    tabRegister.onclick = () => {
        tabRegister.classList.add('active'); tabRegister.style.opacity = '1';
        tabLogin.classList.remove('active'); tabLogin.style.opacity = '0.5';
        viewRegister.classList.remove('hidden'); viewLogin.classList.add('hidden');
        feedbackMsg.classList.add('hidden');
    };

    // --- LOGIC: LOGIN ---
    document.getElementById('btn-auth-action-login').addEventListener('click', async (e) => {
        const email = document.getElementById('auth-email-login').value;
        const password = document.getElementById('auth-password-login').value;
        const btn = e.target;
        
        if (!email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Please enter both email and password."; return; 
        }
        
        btn.textContent = "VERIFYING..."; btn.disabled = true;
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        btn.disabled = false; btn.textContent = "AUTHENTICATE";

        if (error) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Error: " + error.message;
        } else {
            document.getElementById('auth-modal-overlay').classList.add('hidden');
            document.getElementById('auth-password-login').value = ''; 
            window.checkActiveSession(); 
            window.showSystemAlert("Authentication successful! You are now securely connected.");
        }
    });

    // --- LOGIC: REGISTER ---
    document.getElementById('btn-auth-action-register').addEventListener('click', async (e) => {
        const name = document.getElementById('auth-name-register').value.trim();
        const email = document.getElementById('auth-email-register').value.trim();
        const password = document.getElementById('auth-password-register').value;
        const btn = e.target;
        
        if (!name || !email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "All fields are required to register."; return; 
        }
        
        btn.textContent = "CREATING..."; btn.disabled = true;
        const { data, error } = await window.supabaseClient.auth.signUp({
            email, password, options: { data: { display_name: name, full_name: name } }
        });
        btn.disabled = false; btn.textContent = "REGISTER ACCOUNT";

        if (error) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Error: " + error.message;
        } else {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#22c55e'; feedbackMsg.style.background = 'rgba(34,197,94,0.1)';
            feedbackMsg.textContent = "Success! Your account has been created. If email verification is enabled on your server, please check your inbox.";
            document.getElementById('auth-password-register').value = '';
            
            // Auto-login fallback if verification isn't strictly required
            if (data.session) {
                setTimeout(() => {
                    document.getElementById('auth-modal-overlay').classList.add('hidden');
                    window.checkActiveSession();
                }, 2000);
            }
        }
    });

    // 5. Bind Profile Modal Logic (Save & Logout)
    const btnLogout = document.getElementById('btn-profile-logout');
    const btnSave = document.getElementById('btn-profile-save');

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            document.getElementById('profile-modal-overlay').classList.add('hidden');
            await window.supabaseClient.auth.signOut();
            location.reload(); 
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const newName = document.getElementById('profile-new-name').value.trim();
            const currentName = document.getElementById('profile-current-name').textContent;
            const bio = document.getElementById('profile-bio').value.trim();
            // The DB rejects a newline in a flair - it would break the line it
            // is rendered on. An <input type="text"> already strips them on
            // both typing and paste, so this is insurance for any other path
            // into the field rather than the thing doing the work.
            const flair = document.getElementById('profile-flair').value.replace(/[\r\n]+/g, ' ').trim();
            const isPrivate = document.getElementById('profile-private').checked;

            btnSave.textContent = "SAVING..."; btnSave.disabled = true;
            const problems = [];

            // The display name is the one field that does NOT live in
            // user_profiles - it stays in auth metadata, so there is no second
            // copy to keep in sync. See the migration header.
            if (newName && newName !== currentName) {
                const { error } = await window.supabaseClient.auth.updateUser({ data: { display_name: newName } });
                if (error) problems.push("display name: " + error.message);
            }

            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (session) {
                // upsert, because the row is created on first save rather than
                // at signup - there is deliberately no trigger on auth.users.
                const { error } = await window.supabaseClient
                    .from('user_profiles')
                    .upsert({
                        user_id: session.user.id,
                        bio: bio || null,
                        flair: flair || null,
                        is_private: isPrivate
                    }, { onConflict: 'user_id' });

                if (error) {
                    // 42501 is the RLS WITH CHECK refusing the row, and for this
                    // table there is exactly one way to earn it. Saying so beats
                    // showing somebody a Postgres string.
                    problems.push(error.code === '42501'
                        ? "your account cannot post content on the site at the moment"
                        : "profile: " + error.message);
                }
            }

            btnSave.disabled = false; btnSave.textContent = "SAVE CHANGES";

            if (problems.length) {
                window.setProfileFeedback("Could not save — " + problems.join("; ") + ".", false);
                return;
            }
            document.getElementById('profile-modal-overlay').classList.add('hidden');
            window.checkActiveSession();
        });
    }

    // Password change. Separate from SAVE CHANGES on purpose: it is the one
    // action here that signs you out of nothing and yet cannot be undone by
    // re-editing a field, so it gets its own button and its own confirmation.
    const btnPassword = document.getElementById('btn-profile-password');
    if (btnPassword) {
        btnPassword.addEventListener('click', async () => {
            const input = document.getElementById('profile-new-password');
            const next = input.value;
            if (!next) { window.setProfileFeedback("Enter a new password first.", false); return; }
            if (next.length < 6) { window.setProfileFeedback("Passwords need at least 6 characters.", false); return; }

            btnPassword.textContent = "..."; btnPassword.disabled = true;
            const { error } = await window.supabaseClient.auth.updateUser({ password: next });
            btnPassword.disabled = false; btnPassword.textContent = "UPDATE";

            if (error) { window.setProfileFeedback("Could not change password: " + error.message, false); return; }
            input.value = '';
            window.setProfileFeedback("Password updated.", true);
        });
    }

    // Live character counts. Both caps are enforced by CHECK constraints in the
    // database as well - maxlength is a courtesy, PostgREST is the real door.
    const bindCount = (fieldId, countId, max) => {
        const field = document.getElementById(fieldId);
        const out = document.getElementById(countId);
        if (!field || !out) return;
        const paint = () => {
            out.textContent = `${field.value.length}/${max}`;
            out.classList.toggle('profile-count-full', field.value.length >= max);
        };
        field.addEventListener('input', paint);
        paint();
    };
    bindCount('profile-bio', 'profile-bio-count', 500);
    bindCount('profile-flair', 'profile-flair-count', 32);

    // Bind System Alert Close Button
    document.getElementById('btn-alert-close')?.addEventListener('click', () => {
        document.getElementById('alert-modal-overlay').classList.add('hidden');
    });
};

// --- GLOBAL SYSTEM ALERT ---
window.showSystemAlert = function(message) {
    window.injectAuthModal(); // Ensure it exists in the DOM
    const msgEl = document.getElementById('alert-modal-msg');
    if (msgEl) msgEl.textContent = message;
    document.getElementById('alert-modal-overlay').classList.remove('hidden');
};

// --- USERNAME & PROFILE SYSTEM ---
window.currentGlobalUsername = "Anonymous"; // Global cache for the editor to use

window.getDisplayName = function(session) {
    if (!session || !session.user) return "Anonymous";
    
    // Fallback to empty object if metadata is null
    const meta = session.user.user_metadata || {};
    
    // Priority: 1. Custom Profile Name -> 2. OAuth Full Name -> 3. Old Discord Claim -> 4. Email Prefix
    return meta.display_name || meta.full_name || meta.custom_claims?.global_name || meta.user_name || session.user.email.split('@')[0];
};

// One line of feedback inside the profile modal, rather than alert(). The old
// save handler used alert("Failed to update name. Check console.") - which
// tells a contributor to open devtools.
window.setProfileFeedback = function (message, ok) {
    const el = document.getElementById('profile-feedback');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    el.classList.toggle('profile-feedback-bad', !!message && !ok);
    el.classList.toggle('profile-feedback-ok', !!message && !!ok);
};

// Fills the profile modal with what is actually stored, every time it opens.
// Deliberately not cached: the role can change under you (the owner assigns
// them from another tab) and a stale standing is worse than a second fetch.
window.hydrateProfileModal = async function (session) {
    if (!session || !window.supabaseClient) return;

    // --- STANDING ---
    let role = 'member';
    try {
        const { data } = await window.supabaseClient
            .from('user_roles').select('*').eq('user_id', session.user.id).single();
        if (data && data.role) role = data.role;
    } catch (e) {
        // Having no role row is the normal state for most accounts, not an error.
    }

    const badge = window.roleBadge(role);
    const iconEl = document.getElementById('profile-standing-icon');
    const labelEl = document.getElementById('profile-standing-label');
    if (iconEl) {
        // Built from the fixed ROLE_BADGES table; nothing here is user text.
        iconEl.innerHTML = window.roleIconSvg(role, 'profile-role-icon');
        iconEl.className = `profile-standing-icon profile-standing-${badge.color}`;
    }
    if (labelEl) labelEl.textContent = badge.label;

    // --- BIO / FLAIR / PRIVACY ---
    const bioEl = document.getElementById('profile-bio');
    const flairEl = document.getElementById('profile-flair');
    const privEl = document.getElementById('profile-private');
    let row = null;
    try {
        const { data } = await window.supabaseClient
            .from('user_profiles').select('*').eq('user_id', session.user.id).single();
        row = data;
    } catch (e) {
        // No row yet is the normal state: user_profiles has no signup trigger,
        // so a profile exists only once it has been saved once. Empty fields,
        // not an error message.
    }
    if (bioEl) bioEl.value = (row && row.bio) || '';
    if (flairEl) flairEl.value = (row && row.flair) || '';
    if (privEl) privEl.checked = !!(row && row.is_private);
    // Repaint the counters against what was just loaded.
    [bioEl, flairEl].forEach(el => el && el.dispatchEvent(new Event('input')));

    // --- PASSWORD, ONLY FOR ACCOUNTS THAT HAVE ONE ---
    // Discord and Google sign-in are both live, and those accounts have no
    // password on this site - offering to change one would fail in a way that
    // reads as a bug. identities[] is the reliable source: app_metadata.provider
    // names only the most recent sign-in, and one account can carry both.
    const identities = session.user.identities || [];
    const hasPassword = identities.length
        ? identities.some(i => i.provider === 'email')
        : (session.user.app_metadata || {}).provider === 'email';

    const pwField = document.getElementById('profile-password-field');
    const oauthNote = document.getElementById('profile-oauth-note');
    if (pwField) pwField.classList.toggle('hidden', !hasPassword);
    if (oauthNote) {
        oauthNote.classList.toggle('hidden', hasPassword);
        if (!hasPassword) {
            const names = identities.map(i => i.provider).filter(Boolean);
            oauthNote.textContent = `You sign in with ${names.length ? names.join(' and ') : 'an external provider'}, so your password is managed there.`;
        }
    }
};

window.openAuthModal = async function() {
    if (!window.supabaseClient) return;
    
    // Ensure the HTML exists in the DOM first
    window.injectAuthModal(); 

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    // IF LOGGED IN: Open the Custom Profile Manager
    if (session) {
        const username = window.getDisplayName(session);
        document.getElementById('profile-current-name').textContent = username;

        // Pre-fill the input box with their current name so it's easy to edit
        const nameInput = document.getElementById('profile-new-name');
        nameInput.value = username;

        window.setProfileFeedback('', true);
        await window.hydrateProfileModal(session);

        document.getElementById('profile-modal-overlay').classList.remove('hidden');
        nameInput.focus();
        return;
    }

    // IF NOT LOGGED IN: Open the Auth Modal
    document.getElementById('auth-modal-overlay').classList.remove('hidden');
};

window.triggerOAuth = async function(providerName) {
    if (!window.supabaseClient) return;
    const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: providerName,
        options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
    });
    if (error) { console.error("OAuth Error:", error.message); alert("Failed to connect to " + providerName); }
};

window.checkActiveSession = async () => {
    if (!window.supabaseClient) return;

    // 1. Fetch Session Data
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    if (session) {
        window.currentGlobalUsername = window.getDisplayName(session);
    } else {
        window.currentGlobalUsername = "Anonymous";
    }

    // 2. Delegate to the unified PageBuilder Dock Engine!
    if (typeof window.initAuthDock === 'function') {
        await window.initAuthDock();
    }
};

// --- MANGA DROPDOWN ENGINE (BULLETPROOF HYBRID) ---
window.initializeMangaSelects = function() {
    document.querySelectorAll('select.editor-select:not(.manga-initialized)').forEach(select => {
        select.classList.add('manga-initialized');

        const wrapper = document.createElement('div');
        wrapper.className = 'manga-select-wrapper';

        const trigger = document.createElement('div');
        trigger.className = 'manga-select-trigger';
        trigger.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'manga-select-options';

        Array.from(select.options).forEach((option, index) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'manga-option';
            if (option.selected) optDiv.classList.add('selected');
            // Read the resolved color rather than option.style.color: options
            // are colored via CSS classes (e.g. the DAW track-color dropdown's
            // .daw-option-* classes), not inline styles, so the inline-only
            // check used to always miss them.
            const optColor = getComputedStyle(option).color;
            if (optColor) optDiv.style.color = optColor;
            optDiv.textContent = option.textContent;

            optDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                select.selectedIndex = index;
                trigger.textContent = option.textContent;

                // CRITICAL FIX: Trigger native change event so DAW updates
                select.dispatchEvent(new Event('change', { bubbles: true }));

                optionsContainer.querySelectorAll('.manga-option').forEach(el => el.classList.remove('selected'));
                optDiv.classList.add('selected');
                wrapper.classList.remove('open');
            });
            optionsContainer.appendChild(optDiv);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.manga-select-wrapper.open').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });

        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsContainer);
        select.parentNode.insertBefore(wrapper, select.nextSibling);

        // Sync trigger text if the DAW programmatic logic changes value
        select.addEventListener('change', () => {
            trigger.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';
        });
    });
};

// --- SUPABASE CLOUD DATA FETCHER ---
// In-flight requests are shared, not cached: the entry is dropped the moment
// it settles, so a later call always re-reads. A character page boot fires
// four callers at once (three loadMoveSection tabs plus loadPageDescriptions,
// and js/character_modes.js makes five) for the same single row, and without
// this they were four separate round-trips. Deduping only what is currently
// in flight keeps that saving without ever serving stale data after a save.
const inFlightPageData = new Map();

window.fetchCloudCharacterData = async function(pageId) {
    if (inFlightPageData.has(pageId)) return inFlightPageData.get(pageId);

    const request = fetchCloudCharacterDataUncached(pageId);
    inFlightPageData.set(pageId, request);
    try {
        return await request;
    } finally {
        inFlightPageData.delete(pageId);
    }
};

async function fetchCloudCharacterDataUncached(pageId) {
    // Failsafe: If Supabase isn't connected, immediately fall back to local files
    if (!window.supabaseClient) return null;
    
    try {
        // Using the updated universal routing schema we built!
        const { data, error } = await window.supabaseClient
            .from('page_data')
            .select('*')
            .eq('page_id', pageId)
            .single();

        if (error) {
            // PGRST116 is Supabase's code for "No rows found". 
            // This just means the character is completely blank/new, so we silently return null.
            if (error.code !== 'PGRST116') {
                console.error("Database fetch error:", error.message);
            }
            return null;
        }
        
        return data;
        
    } catch (err) {
        console.error("Unexpected cloud connection error:", err);
        return null;
    }
}

// Use Capture phase to close dropdowns before drag-and-drop eats the click
document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.manga-select-wrapper')) {
        document.querySelectorAll('.manga-select-wrapper.open').forEach(w => {
            w.classList.remove('open');
        });
    }
}, true);

// Initial run & Dynamic Observer
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(window.initializeMangaSelects, 100);

    // Started here rather than from page_boot.js because this file is the only
    // one loaded by every page - the hand-authored ones (tier list,
    // collaborators, the hubs) never go through the boot sequence, and
    // flagged media has to come off those too. Returns immediately when
    // nothing is flagged, which is the normal case.
    if (typeof window.initBlockedMediaGuard === 'function') window.initBlockedMediaGuard();

    const observer = new MutationObserver((mutations) => {
        let shouldInit = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1) { shouldInit = true; break; }
                }
            }
        });
        if (shouldInit) window.initializeMangaSelects();
    });

    observer.observe(document.body, { childList: true, subtree: true });
});

document.addEventListener('DOMContentLoaded', async () => {
    // Await the auth check so we have session data
    await window.checkActiveSession(); 
    // Then build the inbox
    if (typeof window.initNotifications === 'function') {
        await window.initNotifications();
    }
});

// Notification text is staff-authored free text (the approve/reject "Staff
// Note" typed into admin.html's prompt, see js/admin-actions.js) and the link
// is a stored string - neither is safe to drop straight into innerHTML. This
// mattered the moment the modal below became reachable; before that it was a
// dormant gap. Duplicated locally rather than imported: this file loads on
// every page and has no dependency on admin-core.js, which owns the other
// copy (same reasoning as js/history.js's own local copy).
window.escapeHtml = function(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

window.initNotifications = async function() {
    if (!window.supabaseClient) return;
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) return; 

    // Fetch Full Notifications for the Modal
    const { data: notifs, error } = await window.supabaseClient
        .from('user_notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(15); 

    if (error) { console.error("Inbox Error:", error); return; }

    // Build the invisible Modal Container safely into Tier 1 Architecture
    let modal = document.getElementById('site-notification-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-notification-modal';
        modal.className = 'modal-overlay hidden'; // FIXED: Strict DSL overlay
        document.body.appendChild(modal);
    }

    let notifHTML = notifs.length === 0 
        ? `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted); font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`
        : notifs.map(n => `
            <div class="notif-item ${n.is_read ? 'read' : 'unread'}" id="notif-row-${window.escapeHtml(n.id)}"
                 data-notif-id="${window.escapeHtml(n.id)}" data-notif-link="${window.escapeHtml(n.link || '')}"
                 style="padding: 1rem 1.5rem; border-bottom: 1px dashed var(--border-color); background: ${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}; cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden;"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                 onmouseout="this.style.background='${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}'">

                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.65rem; color: ${n.is_read ? 'var(--text-muted)' : 'var(--accent-blue)'}; font-family: var(--text-mono);">${new Date(n.created_at).toLocaleDateString()}</span>

                    <div style="display: flex; gap: 0.75rem; align-items: center;">
                        ${!n.is_read ? `<span id="notif-dot-${window.escapeHtml(n.id)}" class="status-dot online" style="background: var(--accent-blue); color: var(--accent-blue); width: 8px; height: 8px;"></span>` : ''}
                        <button data-notif-delete="${window.escapeHtml(n.id)}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:0; display:flex; transition:color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted)'" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.85rem; color: ${n.is_read ? 'var(--text-primary)' : 'var(--text-white)'}; line-height: 1.5; padding-right: 1rem;">${window.escapeHtml(n.message)}</p>
            </div>
        `).join('');

    // Inject exact DSL Geometry
    modal.innerHTML = `
        <div class="modal-box modal-md accent-blue">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <h3>SYSTEM INBOX</h3>
                    ${notifs.length > 0 ? `<button onclick="clearAllNotifications()" style="background: none; border: none; color: #ef4444; font-size: 0.65rem; font-family: var(--text-mono); cursor: pointer; text-decoration: underline; opacity: 0.8;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">CLEAR ALL</button>` : ''}
                </div>
            </div>
            <div class="modal-body" style="padding: 0; overflow-x: hidden;">
                ${notifHTML}
            </div>
            <div class="modal-footer">
                <button class="btn-sys btn-sys-regular" onclick="document.getElementById('site-notification-modal').classList.add('hidden')">CLOSE</button>
            </div>
        </div>
    `;

    // Delegated rather than inline onclick handlers: the row id/link are
    // stored values, and building them into an onclick="" attribute makes the
    // attribute itself an injection surface that HTML-escaping alone doesn't
    // close (the browser unescapes before the JS parser ever sees it).
    modal.onclick = (event) => {
        const deleteBtn = event.target.closest('[data-notif-delete]');
        if (deleteBtn) {
            window.deleteNotification(deleteBtn.getAttribute('data-notif-delete'), event);
            return;
        }
        const row = event.target.closest('[data-notif-id]');
        if (row) {
            window.markNotifRead(row.getAttribute('data-notif-id'), row.getAttribute('data-notif-link'));
        }
    };
};

// The dock's inbox button is built by js/pagebuilder.js's initAuthDock, which
// runs BEFORE initNotifications in this file's own DOMContentLoaded handler -
// so rather than depending on load order, re-fetch on every open. That also
// means the list is always current instead of a page-load snapshot.
window.openNotificationModal = async function() {
    if (typeof window.initNotifications === 'function') {
        await window.initNotifications();
    }
    const modal = document.getElementById('site-notification-modal');
    if (modal) modal.classList.remove('hidden');
};

window.markNotifRead = async function(id, link) {
    // 1. Optimistic UI Update (Makes it feel instant to the user)
    const row = document.getElementById(`notif-row-${id}`);
    const dot = document.getElementById(`notif-dot-${id}`);
    
    if (row) {
        row.style.background = 'transparent';
        row.classList.remove('unread');
        row.classList.add('read');
    }
    if (dot) dot.classList.add('hidden');

    // 2. Fire database update in the background
    if (window.supabaseClient) {
        window.supabaseClient.from('user_notifications').update({ is_read: true }).eq('id', id).then(() => {
            // Re-run the session checker to update the red bell badge count on the sidebar!
            window.checkActiveSession();
        });
    }
    
    // 3. Navigate if a link was provided
    // Links are stored root-relative (see window.buildPageUrl) since
    // notifications are shown from every page at every folder depth -
    // resolve against the CURRENT page's root, not wherever the link
    // was originally constructed from.
    if (link && link !== 'null' && link !== '') {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
        window.location.href = rootPath + link;
    }
};

// --- NOTIFICATION DELETION SYSTEM ---

window.deleteNotification = async function(id, event) {
    // CRITICAL: Stop the click from bubbling down and triggering "markNotifRead"
    event.stopPropagation(); 
    
    // 1. Optimistic UI Animation (Smooth collapse)
    const row = document.getElementById(`notif-row-${id}`);
    if (row) {
        row.style.height = row.offsetHeight + 'px'; // Lock current height
        row.offsetHeight; // Force browser reflow
        row.style.padding = '0px';
        row.style.height = '0px';
        row.style.opacity = '0';
        row.style.border = 'none';
        setTimeout(() => row.remove(), 200); // Remove node after CSS transition
    }

    // 2. Database Execution
    if (window.supabaseClient) {
        await window.supabaseClient.from('user_notifications').delete().eq('id', id);
        
        // Recalculate the red bell badge count on the sidebar dock!
        window.checkActiveSession(); 
    }
};

// Orders the role names, mirroring public.role_rank() in
// supabase/migrations/20260825000001_role_rank.sql (v0.16 bug 6).
//
// It exists because every perk in this codebase used to test a literal role
// name, so nothing anywhere stated that a reviewer outranks a trusted editor -
// which is why the decision that reviewers have a trusted editor's perks
// reached one of the three places it should have.
//
// Keep the two in step. They are deliberately the same ladder rather than the
// same code: SQL cannot call this, and a perk enforced only here would be a
// suggestion. Where a rule matters, the database version is the boundary and
// this one decides what the interface shows.
// owner outranks admin as of v0.17. Until then "admin" WAS the owner; the two
// were split when a second staff member joined, and the SQL half of this lives
// in role_rank() (supabase/migrations/20260827000003_owner_role.sql). Both
// ladders must carry the same numbers, or the interface promises access the
// database refuses.
window.ROLE_RANK = { owner: 5, admin: 4, reviewer: 3, trusted_editor: 2, viewer: 1 };

window.roleRank = function (roleName) {
    // 0 for null, undefined, '' and any unknown string - the same total
    // behaviour the SQL CASE gets from its ELSE branch. Comparisons against
    // this are then always meaningful, which is the point.
    return window.ROLE_RANK[String(roleName || '').trim().toLowerCase()] || 0;
};

// "Does this person clear the bar the page asks for?" Written once so a fourth
// perk cannot be added while forgetting one of the roles that should have it.
window.roleMeets = function (roleName, requiredRole) {
    return window.roleRank(roleName) >= window.roleRank(requiredRole);
};

// The same question against the ARRAY the pages actually hold.
//
// user_roles has UNIQUE(user_id) so there is only ever one, but every caller
// stores it as a list and `roles.includes('admin')` is the shape this replaces
// - a literal test that silently stopped matching the owner the moment the
// role was renamed. `some` rather than `[0]` so a stale multi-entry array
// still answers correctly instead of reading whichever happened to be first.
window.rolesMeet = function (roles, requiredRole) {
    return (roles || []).some(r => window.roleMeets(r, requiredRole));
};

// --- ROLE BADGES: one source for the icon suite ---
//
// These SVGs were local consts inside initAuthDock (js/pagebuilder.js), which
// was fine while the sidebar dock was the only thing that drew a role. v0.17's
// profile draws one too, and a second copy would drift the first time an icon
// changed - which is not hypothetical: the crown and the shield were both
// redrawn days ago, and a duplicated modal would still be showing a treasure
// chest.
//
// It lives here rather than in pagebuilder.js for a cache reason as much as a
// structural one. site_utils.js is stamped (?v=), pagebuilder.js is not, so a
// reader whose browser holds an hour-old pagebuilder.js still gets today's
// icons. See the cache-stamp note in the v0.17 devlog.
//
// Keyed by NAME, not by rank, and that is correct here for the reason stated at
// js/pagebuilder.js:422 - an icon is an identity, not a bar somebody clears.
// roleMeets would hand the owner the admin's shield, since the owner does meet
// the admin bar.
window.ROLE_BADGES = {
    // OWNER - a crown, redrawn for v0.17. The old one was a zigzag over a
    // full-height box, which at 1.2rem read as a treasure chest rather than a
    // crown: the box dominated and the peaks were uneven. Three peaks with real
    // dips between them, and the band pulled out into a separate thin bar under
    // the base, so at icon size the silhouette is crown-shaped.
    owner: {
        label: 'Owner', color: 'purple', join: true,
        paths: '<path d="M3 16L5 6.5L9.5 11L12 4.5L14.5 11L19 6.5L21 16Z"></path><path d="M4.5 19.5h15"></path>'
    },
    // ADMIN - a shield with a check, new in v0.17 when the role stopped meaning
    // the owner. Angular rather than the usual curved shield, to sit with the
    // pencil and the eye rather than against them. The check deliberately echoes
    // the member badge's: that one is a person plus a check ("you are signed
    // in"), this is a shield plus a check ("you are the one who approves"),
    // which is exactly what an admin has that a reviewer does not - force
    // approve and force reject.
    admin: {
        label: 'Admin', color: 'red', join: true,
        paths: '<path d="M12 2.5L20.5 6.5V12L12 21.5L3.5 12V6.5Z"></path><polyline points="8.5 12.5 11 15 15.5 9.5"></polyline>'
    },
    reviewer: {
        label: 'Reviewer', color: 'blue',
        paths: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
    },
    trusted_editor: {
        label: 'Trusted Editor', color: 'yellow',
        paths: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>'
    },
    // Signed in, no role - and also where `viewer` lands. A viewer is a soft
    // ban, and giving it a badge of its own would publish a moderation decision
    // on the person's own profile. get_public_profile() nulls the standing for
    // exactly the same reason.
    member: {
        label: 'Member', color: 'green',
        paths: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline>'
    },
    guest: {
        label: 'Guest', color: 'regular',
        paths: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
    }
};

// Which badge belongs to a role string. Anything unrecognised falls through to
// the signed-in badge rather than borrowing a senior one.
window.roleBadge = function (roleName) {
    const key = String(roleName || '').trim().toLowerCase();
    return window.ROLE_BADGES[key] || window.ROLE_BADGES.member;
};

// Builds the icon markup. `paths` is a fixed string from the table above and is
// never user-influenced; className is caller-supplied, so it is escaped anyway
// rather than relying on every future caller passing a literal.
window.roleIconSvg = function (roleName, className) {
    const badge = window.roleBadge(roleName);
    const cls = window.escapeHtml(className || 'dock-role-icon');
    const join = badge.join ? 'stroke-linejoin="round" ' : '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ${join}stroke-linecap="square" class="${cls}">${badge.paths}</svg>`;
};

// A confirmation in the site's own modal, for code that runs on EVERY page.
//
// js/editor-core.js has customConfirm, but it is bound to #editor-custom-modal,
// which only edit.html and post-editor.html carry - and site_utils.js loads
// everywhere, including the public pages a reader sees. So this builds its own,
// once, out of the same .modal-overlay / .modal-box classes the notification
// inbox above uses, and reuses that node afterwards.
//
// Deliberately a second implementation rather than a shared one: this project
// prefers small per-file duplication to a new cross-file dependency, and the
// alternative here would be every public page loading an editor script for one
// function (v0.16 fine-tuning 6).
window.siteConfirm = function (message, opts = {}) {
    let modal = document.getElementById('site-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-confirm-modal';
        modal.className = 'modal-overlay hidden';
        modal.innerHTML = `
            <div class="modal-box accent-red modal-sm">
                <div class="modal-header"><h3 id="site-confirm-title">CONFIRM</h3></div>
                <div class="modal-body site-confirm-body">
                    <p id="site-confirm-text" class="site-confirm-text"></p>
                    <div class="site-confirm-actions">
                        <button id="site-confirm-cancel" class="btn-sys btn-sys-regular">CANCEL</button>
                        <button id="site-confirm-ok" class="btn-sys btn-sys-red">CONFIRM</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#site-confirm-title');
    const textEl = modal.querySelector('#site-confirm-text');
    const btnCancel = modal.querySelector('#site-confirm-cancel');
    const btnOk = modal.querySelector('#site-confirm-ok');

    // textContent, not innerHTML: the only current caller passes a fixed string,
    // but a confirmation is exactly the kind of thing that later gets handed a
    // page title or a contributor's name.
    titleEl.textContent = opts.title || 'CONFIRM';
    textEl.textContent = message;
    btnOk.textContent = opts.confirmText || 'CONFIRM';

    return new Promise((resolve) => {
        modal.classList.remove('hidden');
        btnOk.focus();

        const cleanup = () => {
            modal.classList.add('hidden');
            btnCancel.removeEventListener('click', onCancel);
            btnOk.removeEventListener('click', onOk);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
        };
        const onCancel = () => { cleanup(); resolve(false); };
        const onOk = () => { cleanup(); resolve(true); };
        // Backdrop and Escape both cancel. This is a destructive action, so
        // every ambiguous exit resolves to "no".
        const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };

        btnCancel.addEventListener('click', onCancel);
        btnOk.addEventListener('click', onOk);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
};

window.clearAllNotifications = async function() {
    const ok = await window.siteConfirm(
        'This clears your entire inbox. Notifications cannot be brought back.',
        { title: 'CLEAR ALL NOTIFICATIONS', confirmText: 'CLEAR ALL' });
    if (!ok) return;


    // 1. Optimistic UI Wipe
    // .modal-body, not .auth-body - the modal this targets is built above with
    // .modal-body, so the old selector never matched and the wipe silently did
    // nothing (invisible until the modal became reachable at all).
    const body = document.querySelector('#site-notification-modal .modal-body');
    const clearBtn = document.querySelector('#site-notification-modal button[onclick="clearAllNotifications()"]');
    
    if (body) {
        body.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: #555; font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`;
    }
    if (clearBtn) clearBtn.remove(); // Remove the clear button itself

    // 2. Database Execution
    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            await window.supabaseClient.from('user_notifications').delete().eq('user_id', session.user.id);
            window.checkActiveSession(); 
        }
    }
};

window.getRootPath = getRootPath;
window.fetchJson = fetchJson;
window.fetchNavigationData = fetchNavigationData;