/**
 * Dogslamloop Wiki - Shared Site Utilities: page data
 *
 * The roster, tier list entries, archived pages, character modes, matchup
 * tiers, system page sections, the delta engine that applies an approved
 * edit, and the page data fetcher. Loads right after site_utils.js.
 */

// --- CHARACTER ROSTER ---
// page_id -> { name, url, image, hidden }, for every tier list on the site.
//
// One loader since v1.1. There were three copies (certified lists, Free
// Submit, the tier editor), and two of them shipped reading `entry.image`,
// which navigation.json carries on no character: so they drew a guessed
// Supabase URL, old art, or a 404 for the five portraits named
// "Portrait2.webp" or with no suffix. The portrait comes from
// data/portraits.json, mirrored into the repo by scripts/fetch-portraits.js.
//
// Same-origin matters beyond correctness: a cross-origin image taints a
// canvas, and toBlob() and the clipboard write both throw on one, which every
// tier list image export depends on.
//
// A fresh Map each call, over cached requests, so a caller can keep it as its
// own state. Empty when navigation.json cannot be read; the next call tries
// again, because fetchJson drops a failed request from its cache.
async function loadCharacterRoster() {
    const roster = new Map();
    try {
        const nav = await fetchNavigationData();

        let portraits = {};
        try {
            portraits = await fetchJson(`${getRootPath()}data/portraits.json`, { cache: true });
        } catch (e) {
            // Non-fatal: a character with no portrait shows its name on its
            // colour, which every list draws for that case anyway.
            console.warn('[Roster] Portrait manifest unavailable:', e);
        }

        (nav.Characters || []).forEach(entry => {
            const pageId = entry.cms_config && entry.cms_config.pageId;
            if (!pageId) return;
            roster.set(pageId, {
                name: entry.name,
                url: entry.url,
                image: portraits[pageId] || entry.image,
                // Private server only. Kept, not dropped: a certified list may
                // rank a hidden character, so each list decides.
                hidden: !!entry.isHidden,
            });
        });
    } catch (e) {
        console.warn('[Roster] Could not read the roster:', e);
    }
    return roster;
}

// --- TIER LIST ENTRIES: COPIES AND BADGES (v1.2) ---
//
// A certified tier list may hold a character more than once, each copy told
// apart by a badge (owner, 2026-11-19). An entry in tiers[].characters is:
//   "page_id"                       the character, no badge (every list before)
//   { id, label, color }            the character, with a badge
//   { id, copy, label, color }      a copy of it, which always has one
// The key ("page_id", or "page_id#copy") is what the board, the move diff,
// the notes and tier_list_changes.character_id use, so each copy is moved and
// logged on its own. Read here once for the editor (js/pages/tier-lists/tier-editor.js) and the
// reader (js/pages/tier-lists/certified-tier-lists.js), which must never disagree.
//
// save_tier_list stores the tiers as sent, so nothing is trusted: an entry
// with no string id is dropped (null), a label is cut to TIER_BADGE_MAX, and a
// colour that is not #rgb or #rrggbb is dropped, because it goes into a style.
window.TIER_BADGE_MAX = 12;
window.tierListEntry = function (raw) {
    if (typeof raw === 'string') return raw ? { key: raw, id: raw, copy: null, label: '', color: '' } : null;
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    const copy = typeof raw.copy === 'string' && /^[a-z0-9]{1,12}$/i.test(raw.copy) ? raw.copy : null;
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, window.TIER_BADGE_MAX) : '';
    const color = typeof raw.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.color) ? raw.color : '';
    return { key: copy ? `${raw.id}#${copy}` : raw.id, id: raw.id, copy, label, color };
};

// The badge on a portrait's corner, or null for an entry without one. Its
// text is black or white by the colour's lightness, the same test the
// character colours use (isDarkCharacterColor, js/utility/site_meta.js).
window.tierBadgeElement = function (entry) {
    if (!entry || !entry.label) return null;
    const color = entry.color || '#888888';
    const badge = document.createElement('span');
    badge.className = 'tier-badge';
    badge.textContent = entry.label;
    badge.style.backgroundColor = color;
    const dark = typeof window.isDarkCharacterColor === 'function' && window.isDarkCharacterColor(color);
    badge.style.color = dark ? '#ffffff' : '#000000';
    return badge;
};

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

// --- MATCHUP TIERS ---
//
// One list, because this vocabulary is read in three places that have to
// agree: the live page (js/pages/core/description.js), the editor's preview
// (js/editor/tools/editor-previews.js) and the editor's own dropdown (js/editor/tabs/editor-tabs.js).
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
// (js/editor/tabs/editor-system.js), so it is a display name wearing an id's clothes.
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
    // submissions - see js/editor/tabs/editor-system.js buildSystemDeltas.
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

    // THE ORDER OF THE TABS THEMSELVES - v0.18 B2.
    //
    // Section order has travelled since item 6b, as `order` on the tab's own
    // metadata above. The tab strip had the reorder control from day one and
    // nothing that recorded the move: buildSystemDeltas emits per-tab metadata
    // and per-section content, and reordering tabs changes neither, so the
    // scan found nothing and the contributor was told "no changes detected".
    //
    // Page-level, so it takes key 'full' like `modes` - it belongs to the page
    // rather than to any one tab, and keying it by a tab would make one tab's
    // ticket carry the position of all the others.
    //
    // The payload is a list of tab KEYS and never tab content, for the reason
    // stated one level down: a reorder that carried content would let moving a
    // tab overwrite an edit somebody else made to it in the meantime.
    if (scope === 'system_tab_order') {
        if (!Array.isArray(newDesc.tabs)) newDesc.tabs = [];
        if (!Array.isArray(payload)) {
            console.error('[Delta] system_tab_order payload is not a list of tab keys.');
            return { newDesc, newFrame };
        }

        // indexSystemTabs de-duplicates collisions itself (`basics`,
        // `basics-2`), so the "two entries share an identity" refusal the
        // generic order scope needs cannot arise here - the keys are unique by
        // construction rather than by luck.
        const keys = window.indexSystemTabs(newDesc).map(t => t.tabKey);
        const wanted = payload.map(String).filter(k => keys.includes(k));
        const named = new Set(wanted);
        const queue = wanted.map(k => newDesc.tabs[keys.indexOf(k)]);

        // Unnamed tabs KEEP THEIR INDEX rather than being pushed to the end -
        // the rule the generic `order` scope settled on, and deliberately not
        // the one the section-order branch above uses. A ticket is raised
        // against a snapshot, so a tab added since is not this delta's
        // business, and appending it would move a tab the contributor never
        // touched.
        newDesc.tabs = newDesc.tabs.map((tab, i) => (named.has(keys[i]) ? queue.shift() : tab));
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
    // `key` is the dotted path js/editor/blocks/editor-reorder.js already names its lists by
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
        //   contributor text and js/pages/core/description.js already notes two groups may
        //   share a title, so this is not hypothetical.
        //
        // Either way there is no single correct answer, and guessing would
        // silently shuffle a reader's page. Refusing leaves the list exactly as
        // it was - the reorder is lost, which is visible and recoverable, while
        // corruption is neither. The scan in js/editor/core/editor-core.js declines to emit
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
    // js/utility/character_tabs.js FIXED_BLOCK_SECTIONS - comboIntro is one, and
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
    // Every keyed section (js/utility/character_tabs.js): matchups, counterplay,
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
    // A page's own settings (v1.1): the words it colours and its house style.
    // Page-level, so on a character with states it sits beside modeData and
    // never inside it; the editor never wraps it in a state. null removes them.
    else if (scope === 'pageConfig') {
        if (payload === null || payload === undefined) delete newDesc.pageConfig;
        else newDesc.pageConfig = payload;
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
    // js/utility/character_tabs.js did not load and the keyed-section lookup above
    // could not run.
    else {
        console.error(
            `[Delta] No handler for scope "${scope}" - the edit was NOT applied. `
            + `If this is a keyed section, check js/utility/character_tabs.js loaded before this file.`,
            { scope, key }
        );
    }

    return { newDesc, newFrame };
};

// --- SUPABASE CLOUD DATA FETCHER ---
// In-flight requests are shared, not cached: the entry is dropped the moment
// it settles, so a later call always re-reads. A character page boot fires
// four callers at once (three loadMoveSection tabs plus loadPageDescriptions,
// and js/pages/core/character_modes.js makes five) for the same single row, and without
// this they were four separate round-trips. Deduping only what is currently
// in flight keeps that saving without ever serving stale data after a save.
const inFlightPageData = new Map();

// The settings of the page being read (v1.1), for js/pages/core/internalstyling.js's page
// words. Kept per page id and looked up by the route, so a page that reads
// another page's row can never pick up that page's words.
window.readerPageConfigs = window.readerPageConfigs || {};
window.rememberPageConfig = function(pageId, descData) {
    if (!pageId) return;
    window.readerPageConfigs[pageId] = (descData && descData.pageConfig) || null;
};

// A house style as blocks, one paragraph per line, for the two places that
// show it: the editor's HOUSE STYLE window and the review diff.
window.houseStyleBlocks = function(text) {
    return String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean)
        .map(line => ({ type: 'paragraph', content: line }));
};

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
        
        window.rememberPageConfig(pageId, data && data.desc_data);
        return data;
        
    } catch (err) {
        console.error("Unexpected cloud connection error:", err);
        return null;
    }
}
// --- GLOBALS THE OTHER FILES CALL ---
window.loadCharacterRoster = loadCharacterRoster;
