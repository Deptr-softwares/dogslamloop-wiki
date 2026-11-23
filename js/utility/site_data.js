/**
 * Page data: the roster, tier list entries, archived pages, character modes,
 * matchup tiers and the page data fetcher. Loads right after site_utils.js. The
 * delta engine that applies an approved edit is js/utility/submission_delta.js.
 * @since v0.3, as part of site_utils.js
 * @touches page_data (desc_data, frame_data, tab_settings), data/navigation.json,
 *   data/portraits.json, data/archived-pages.json
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
