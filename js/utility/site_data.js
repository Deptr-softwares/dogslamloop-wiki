/**
 * Page data: the roster, tier list entries, archived pages, character modes,
 * matchup tiers, system page section keys, the page data fetcher, and the delta
 * engine that applies an approved edit (applyDeltaToData). Loads right after
 * site_utils.js.
 * @since v0.3, as part of site_utils.js
 * @touches page_data (desc_data, frame_data, tab_settings), data/navigation.json,
 *   data/portraits.json, data/archived-pages.json
 * @watch applyDeltaToData is the last step of approving a ticket: a scope it does
 *   not know throws, never returns the data unchanged. A reorder never deletes, and
 *   a delta is applied to a snapshot, so entries it does not name stay put.
 * @see docs/page-data.md
 */

/**
 * page_id -> { name, url, image, hidden }, for every tier list on the site, a
 * fresh Map each call over cached requests. The portrait is the same-origin copy
 * from data/portraits.json: a cross-origin image taints the canvas a tier list
 * image export draws on.
 * @since v1.1
 * @watch empty when navigation.json cannot be read; the next call tries again
 */
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

/**
 * Tier list entries, copies and badges. An entry in tiers[].characters is
 *   "page_id"                       the character, no badge
 *   { id, label, color }            the character, with a badge
 *   { id, copy, label, color }      a copy of it, which always has one
 * Its key ("page_id" or "page_id#copy") is what the board, the move diff, the notes
 * and tier_list_changes.character_id use. The editor and the reader both read it
 * here, so they never disagree.
 * @since v1.2
 * @watch save_tier_list stores tiers as sent: an entry with no string id is
 *   dropped, a label is cut to TIER_BADGE_MAX, and a colour that is not #rgb or
 *   #rrggbb is dropped, since it lands in a style
 */
window.TIER_BADGE_MAX = 12;
window.tierListEntry = function (raw) {
    if (typeof raw === 'string') return raw ? { key: raw, id: raw, copy: null, label: '', color: '' } : null;
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    const copy = typeof raw.copy === 'string' && /^[a-z0-9]{1,12}$/i.test(raw.copy) ? raw.copy : null;
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, window.TIER_BADGE_MAX) : '';
    const color = typeof raw.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.color) ? raw.color : '';
    return { key: copy ? `${raw.id}#${copy}` : raw.id, id: raw.id, copy, label, color };
};

// The badge on a portrait's corner, or null. Its text is black or white by the
// colour's lightness, the test the character colours use (isDarkCharacterColor).
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

// Archived pages. navigation.json holds only live pages, so its readers are safe;
// the ones that reach into page_data or the revision feed (matchup and counterplay
// cards, tier list rows, the dashboard widgets) ask here. {} on any failure:
// "nothing is hidden", never a blank roster.
async function fetchArchivedPages() {
    try {
        const data = await fetchJson(`${getRootPath()}data/archived-pages.json?v=1.0`, { cache: true });
        return (data && typeof data === 'object') ? data : {};
    } catch (e) {
        return {};
    }
}

/**
 * True when a page is archived and marked to have its remaining references hidden.
 * Takes a page_id ('boomcat') or a nav_id ('Boomcat'): page_data is keyed by one,
 * the tier list by the other.
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

/**
 * Character modes: a full character's base kit plus ultimate states that replace
 * its whole moveset, one page with a toggle.
 *   frame_data.modes    = [{ id: 'base', label: 'Base Kit' }, { id: 'shrine', ... }]
 *   frame_data.modeData = { shrine: { m1s: [], skills: [], specials: [] } }
 *   desc_data.modeData  = { shrine: { profile, overview, matchups, ... } }
 * @since v0.12
 * @watch the declaration (modes) is apart from the content (modeData), so renaming
 *   or reordering the toggle rewrites no Block. BASE_MODE_ID always means the top
 *   level, so a character with no modes declared is one implicit base mode.
 */
window.BASE_MODE_ID = 'base';

/**
 * The matchup tiers, worst to best for the page's own character: one list for the
 * live page, the editor's preview and the editor's dropdown, so a renamed tier
 * cannot half-land.
 * @since v0.13
 */
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

// Permanent: page_history and pending_revisions keep the words people submitted
// and approved, so old revisions replay with the two old tier names.
window.MATCHUP_TIER_ALIASES = {
    'Unwinnable': 'Hopeless',
    'Unloseable': 'Dominating',
};

// Always renderable. An unknown tier keeps its wording and renders white: a matchup
// rating is a claim about the game, and guessing one is worse than showing it unset.
window.resolveMatchupTier = function(tier) {
    const name = window.MATCHUP_TIER_ALIASES[tier] || tier || 'Equal';
    return window.MATCHUP_TIERS.find(t => t.id === name) || { id: name, color: '#ffffff' };
};

/** The declared modes, or [] when a character has none (the same as one base mode). */
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

/**
 * The frame data a mode draws from. A non-base mode has its own move arrays only:
 * one with no skills written shows an empty Skills tab, never the base kit's.
 */
window.resolveModeFrame = function(frameData, modeId) {
    const base = frameData || {};
    if (window.isBaseMode(modeId)) return base;

    const scoped = (base.modeData && base.modeData[modeId]) || {};
    const out = { modes: base.modes };
    window.FRAME_MOVE_CATEGORIES.forEach(cat => { out[cat] = scoped[cat] || []; });
    out.moveStrategies = scoped.moveStrategies;
    return out;
};

/**
 * The description data a mode draws from. `profile` alone falls back to the base:
 * it is the character's identity card, not an analysis of the kit.
 */
window.resolveModeDesc = function(descData, modeId) {
    const base = descData || {};
    if (window.isBaseMode(modeId)) return base;

    const scoped = (base.modeData && base.modeData[modeId]) || {};
    return Object.assign({}, scoped, {
        profile: scoped.profile || base.profile,
    });
};

/**
 * Splits a delta aimed at one state into { modeId, scope, key }, modeId null for an
 * ordinary delta. Everything that reads a revision's scope splits it here, the same
 * way.
 */
window.unwrapModeDelta = function(scope, key) {
    if (scope !== 'mode' || typeof key !== 'string') return { modeId: null, scope, key };

    const parts = key.split('::');
    const modeId = parts.shift();
    const innerScope = parts.shift() || '';
    return { modeId, scope: innerScope, key: parts.join('::') || 'full' };
};

/**
 * A system page's tab or section key, derived from its title. Nothing in a system
 * page has a stored id (tabId is re-slugged on every rename), so both sides of a
 * delta derive the same key; a rename reads as a delete plus an add. Position is
 * never part of a key, so a reorder does not look like every section changing.
 */
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

/**
 * Applies one stored delta (scope, key, payload) to copies of desc_data and
 * frame_data: the review screens' preview, the merge on approval, and History's
 * replay all go through it.
 * @returns {{ newDesc, newFrame }}
 */
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    // A bundled submission: each part applied in turn.
    if (scope === 'multi' && Array.isArray(payload)) {
        payload.forEach(edit => {
            const res = window.applyDeltaToData(newDesc, newFrame, edit.scope, edit.key, edit.payload);
            newDesc = res.newDesc;
            newFrame = res.newFrame;
        });
        return { newDesc, newFrame };
    }

    // A delta aimed at one state: key `<modeId>::<innerScope>[::<innerKey>]`, the
    // payload what the inner scope carries. The mode is peeled off and the inner scope
    // applied to that mode's own data, so a new scope needs nothing here. A base-mode
    // delta is the plain scope, so every older ticket applies unchanged.
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

    // The toggle itself, apart from the content, so renaming a mode touches no Block.
    if (scope === 'modes') {
        newFrame.modes = payload;
        return { newDesc, newFrame };
    }

    // The whole desc_data at once: kept for tickets already queued. Approving two of
    // them for one page reverted the first, so new submissions use the scopes below.
    if (scope === 'system_data') {
        return { newDesc: JSON.parse(JSON.stringify(payload)), newFrame };
    }

    // One section of one tab (editor-system.js buildSystemDeltas).
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
            // Appended: where it goes is the tab's business, and the tab sends its own order.
            tab.sections.push(payload);
        }
        return { newDesc, newFrame };
    }

    // A tab's own metadata and its sections' order, apart from the sections, so
    // renaming a tab touches no Block.
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

        // The order is a list of section keys, never content, so a reorder cannot carry a
        // stale copy of somebody's prose.
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

    // The order of the tabs themselves: page-level (key 'full'), and a list of tab keys,
    // never content, so moving a tab cannot overwrite an edit made to it meanwhile.
    if (scope === 'system_tab_order') {
        if (!Array.isArray(newDesc.tabs)) newDesc.tabs = [];
        if (!Array.isArray(payload)) {
            console.error('[Delta] system_tab_order payload is not a list of tab keys.');
            return { newDesc, newFrame };
        }

        // indexSystemTabs makes keys unique itself (`basics`, `basics-2`), so two tabs can
        // never share one here.
        const keys = window.indexSystemTabs(newDesc).map(t => t.tabKey);
        const wanted = payload.map(String).filter(k => keys.includes(k));
        const named = new Set(wanted);
        const queue = wanted.map(k => newDesc.tabs[keys.indexOf(k)]);

        // A tab the payload does not name keeps its index: added since the snapshot, it is
        // not this delta's business.
        newDesc.tabs = newDesc.tabs.map((tab, i) => (named.has(keys[i]) ? queue.shift() : tab));
        return { newDesc, newFrame };
    }

    // A tier list's tiers and changelog, per tab, not per tier: moving a character from
    // A to S changes two tiers, and per tier that would be a conflict.
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

    // The order of a list. Every other scope replaces an entry in place, so nothing
    // else can say a sequence changed. `key` is the dotted path editor-reorder.js names
    // its lists by ("frame.skills", "desc.comboGroups"); `payload` is each entry's
    // identity in the new order.
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

        // Identity is a move's id or a keyed entry's key field, tried in turn.
        const identify = (entry) => {
            if (!entry || typeof entry !== 'object') return null;
            for (const field of ['id', 'title', 'opponent', 'topic', 'starter', 'theory', 'name']) {
                if (entry[field] !== undefined && entry[field] !== null) return String(entry[field]);
            }
            return null;
        };

        // When in doubt, change nothing: an entry with no identity, or two sharing one
        // (combo group titles can repeat), leaves the list as it was. A lost reorder is
        // visible and recoverable; a shuffled page is neither. editor-core.js declines to
        // send these too.
        const ids = list.map(identify);
        if (ids.some(id => id === null)) {
            console.warn(`[Delta] order "${key}" skipped: an entry has no identity to order by.`);
            return { newDesc, newFrame };
        }
        if (new Set(ids).size !== ids.length) {
            console.warn(`[Delta] order "${key}" skipped: two entries share an identity.`);
            return { newDesc, newFrame };
        }

        // An entry the payload does not name keeps its index: added since the snapshot, it
        // is not this delta's business.
        const wanted = payload.map(String).filter(id => ids.includes(id));
        const named = new Set(wanted);
        const queue = wanted.map(id => list[ids.indexOf(id)]);

        const ordered = list.map(entry => (named.has(identify(entry)) ? queue.shift() : entry));

        parent[last] = ordered;
        return { newDesc, newFrame };
    }

    // Whole-value Block sections: the fixed four, plus FIXED_BLOCK_SECTIONS
    // (character_tabs.js), such as comboIntro.
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
    // Every keyed section (character_tabs.js): matchups, counterplay, starterGuide and
    // any declared there later.
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
    // One delta per gallery item, keyed by name: many people add items independently,
    // and each submission names only its own.
    else if (scope === 'gallery_item') {
        if (!newDesc.items) newDesc.items = [];
        if (payload === null) {
            newDesc.items = newDesc.items.filter(i => i.name !== key);
        } else {
            const idx = newDesc.items.findIndex(i => i.name === key);
            if (idx > -1) newDesc.items[idx] = payload; else newDesc.items.push(payload);
        }
    }
    // Whole-value replacements: a gallery's or tool page's intro, and a tool's config.
    // 'gallery_intro' is the old name, kept for tickets already queued.
    else if (scope === 'gallery_intro' || scope === 'intro') {
        newDesc.intro = payload;
    }
    else if (scope === 'notes') {
        newDesc.notes = payload;
    }
    else if (scope === 'tool_config') {
        newDesc.tool = payload;
    }
    // A page's own settings (its words and house style). Page-level: on a character
    // with states it sits beside modeData, never in it. null removes them.
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
    // Nothing matched, which is always a bug: a new scope with no branch here, or
    // character_tabs.js not loaded. A silent return would let a reviewer approve a
    // ticket that writes nothing.
    else {
        console.error(
            `[Delta] No handler for scope "${scope}" - the edit was NOT applied. `
            + `If this is a keyed section, check js/utility/character_tabs.js loaded before this file.`,
            { scope, key }
        );
    }

    return { newDesc, newFrame };
};

// In-flight page data requests are shared, never cached: a character page asks for
// its one row five times at boot, and each later call still reads fresh data.
const inFlightPageData = new Map();

// The settings of the page being read, kept per page id, so a page that reads
// another page's row never picks up that page's words.
window.readerPageConfigs = window.readerPageConfigs || {};
window.rememberPageConfig = function(pageId, descData) {
    if (!pageId) return;
    window.readerPageConfigs[pageId] = (descData && descData.pageConfig) || null;
};

/** A house style as Blocks, one paragraph a line, for the editor's window and the review diff. */
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
    // No Supabase client: no data.
    if (!window.supabaseClient) return null;
    
    try {
        const { data, error } = await window.supabaseClient
            .from('page_data')
            .select('*')
            .eq('page_id', pageId)
            .single();

        if (error) {
            // PGRST116 is "no rows": a page with no content yet, so null quietly.
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
window.loadCharacterRoster = loadCharacterRoster;
