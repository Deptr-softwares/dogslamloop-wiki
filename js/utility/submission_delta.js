/**
 * The delta engine: applies a submission's change (a scope, a key and a payload)
 * to a page's data, and the system page keys both sides of a change derive. The
 * editor, the Overseer and History load it; reader pages do not.
 * @since v0.4, as part of site_utils.js
 * @touches page_data (desc_data, frame_data), pending_revisions (target_scope,
 *   target_key, delta_payload), isBaseMode (site_data.js), getKeyedSectionByScope
 *   (character_tabs.js)
 * @watch applyDeltaToData is the last step of approving a ticket: a scope it does
 *   not know is a console error and changes nothing, so a new scope needs its
 *   branch here. A reorder never deletes, and a delta is applied to a snapshot, so
 *   entries it does not name stay put.
 * @see docs/page-data.md
 */

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
