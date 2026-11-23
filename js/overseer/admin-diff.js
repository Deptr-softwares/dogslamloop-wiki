/**
 * What a revision changed: the field-by-field diff of objects, which tabs it
 * touched (marked in the strip), and the strip itself, including a system or tier
 * list page's own tabs. The inline text diff is diff-markers.js.
 * @since v0.4, as part of admin.js
 * @touches window.currentLive* and currentPending*, window.changedTabs,
 *   unwrapModeDelta, getCharacterTabIds, getKeyedSectionByScope and
 *   FIXED_BLOCK_SECTIONS (character_tabs.js), setupTabs (pagebuilder.js)
 * @watch every value is contributor text, escaped before it reaches the page. A
 *   new scope needs its tab here, or its change marks the wrong tab.
 * @see docs/overseer.md
 */

// Field names as a reviewer reads them. Listed: the ones de-camelCasing gets
// wrong; the rest follow the general rule, so a new field needs no entry.
const DIFF_FIELD_LABELS = {
    oneliner: 'Summary',
    worksOn: 'Works On',
    damageType: 'Damage Type',
    startup: 'Startup',
    active: 'Active',
    recovery: 'Recovery',
    blockAdv: 'Block Advantage',
    hitAdv: 'Hit Advantage',
    ver: 'Game Version',
    src: 'File',
    alt: 'Alt Text',
    url: 'Link',
    tier: 'Tier',
    opponent: 'Opponent',
    topic: 'Topic',
    starter: 'Starter',
    // Editor-only, and named so: joining a folder moves the Block, so it is shown.
    folder: 'Editor Folder',
    folderColor: 'Editor Folder Color',
    notations: 'Notation Styles',
};

window.humanFieldName = function(key) {
    if (DIFF_FIELD_LABELS[key]) return DIFF_FIELD_LABELS[key];
    return String(key)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^\w/, c => c.toUpperCase());
};

window.renderStructuredDiff = function(oldObj, newObj) {

    // A value a reviewer can read: a list of objects as one line each, never one
    // line of braces.
    const formatValue = (val) => {
        if (val === undefined || val === null) return '';
        if (Array.isArray(val)) {
            if (!val.length) return '(empty)';
            if (val.every(v => v === null || typeof v !== 'object')) {
                return val.map(v => String(v)).join(', ');
            }
            return val.map((v, i) => {
                const name = v && (v.name || v.label || v.combo || v.title || v[Object.keys(v)[0]]);
                return `${i + 1}. ${name === undefined ? '(item)' : String(name)}`;
            }).join('\n');
        }
        if (typeof val === 'object') {
            return Object.keys(val)
                .map(k => `${window.humanFieldName(k)}: ${val[k] === null || typeof val[k] === 'object' ? formatValue(val[k]) : String(val[k])}`)
                .join('\n');
        }
        return String(val);
    };

    // Escaped first, so the <br> is the only markup left.
    const show = (val) => window.escapeHtml(formatValue(val)).replace(/\n/g, '<br>');

    const renderFields = (oldO, newO, depth) => {
        const safeOld = oldO && typeof oldO === 'object' ? oldO : {};
        const safeNew = newO && typeof newO === 'object' ? newO : {};
        const allKeys = [...new Set([...Object.keys(safeOld), ...Object.keys(safeNew)])];

        // Accolades are stored as ids; a reviewer reads their names, in the card's order.
        const readable = (key, val) => (key === 'accolades' && Array.isArray(val) && typeof window.orderedAccolades === 'function'
            ? window.orderedAccolades(val).map(a => a.name) : val);

        let rowsHtml = '';
        allKeys.forEach(key => {
            const oldVal = readable(key, safeOld[key]);
            const newVal = readable(key, safeNew[key]);
            if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return;

            const bothPlainObjects = oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object'
                && !Array.isArray(oldVal) && !Array.isArray(newVal);
            // Lists of objects compare position by position, so one changed field shows as
            // that field.
            const bothObjectArrays = Array.isArray(oldVal) && Array.isArray(newVal) && (depth || 0) < 3
                && [...oldVal, ...newVal].some(v => v && typeof v === 'object')
                && [...oldVal, ...newVal].every(v => v === null || typeof v === 'object');

            let valueHtml;
            if (bothPlainObjects) {
                valueHtml = `<div class="diff-field-nested">${renderFields(oldVal, newVal, (depth || 0) + 1)}</div>`;
            } else if (bothObjectArrays) {
                let inner = '';
                for (let i = 0; i < Math.max(oldVal.length, newVal.length); i++) {
                    if (JSON.stringify(oldVal[i]) === JSON.stringify(newVal[i])) continue;
                    const label = i + 1;
                    if (oldVal[i] === undefined) inner += `<div class="diff-field-row"><span class="diff-field-key">Added #${label}</span> <ins class="diff-add">${show(newVal[i])}</ins></div>`;
                    else if (newVal[i] === undefined) inner += `<div class="diff-field-row"><span class="diff-field-key">Removed #${label}</span> <del class="diff-del">${show(oldVal[i])}</del></div>`;
                    else inner += `<div class="diff-field-row"><span class="diff-field-key">#${label}</span><div class="diff-field-nested">${renderFields(oldVal[i], newVal[i], (depth || 0) + 1)}</div></div>`;
                }
                valueHtml = `<div class="diff-field-nested">${inner}</div>`;
            } else if (oldVal === undefined) {
                valueHtml = `<ins class="diff-add">${show(newVal)}</ins>`;
            } else if (newVal === undefined) {
                valueHtml = `<del class="diff-del">${show(oldVal)}</del>`;
            } else {
                valueHtml = `<del class="diff-del">${show(oldVal)}</del> <ins class="diff-add">${show(newVal)}</ins>`;
            }

            rowsHtml += `<div class="diff-field-row"><span class="diff-field-key">${window.escapeHtml(window.humanFieldName(key))}:</span> ${valueHtml}</div>`;
        });

        return rowsHtml || `<div class="diff-field-row diff-field-unchanged">No field-level changes detected.</div>`;
    };

    return `<div class="diff-structured">${renderFields(oldObj, newObj, 0)}</div>`;
};

function getTabData(tab, mode) {
    const isFrame = window.FRAME_MOVE_CATEGORIES.includes(tab);

    // Narrowed to the character state on screen, never the base kit.
    const activeMode = window.activePreviewMode || null;
    const scopeDesc = (full) => (typeof window.resolveModeDesc === 'function'
        ? window.resolveModeDesc(full || {}, activeMode) : (full || {}));
    const scopeFrame = (full) => (typeof window.resolveModeFrame === 'function'
        ? window.resolveModeFrame(full || {}, activeMode) : (full || {}));

    const liveDesc = scopeDesc(window.currentLiveDescData);
    const liveFrame = scopeFrame(window.currentLiveFrameData);
    const pendDesc = scopeDesc(window.currentPendingDescData);
    const pendFrame = scopeFrame(window.currentPendingFrameData);

    const dataObj = mode === 'live' ? (isFrame ? liveFrame : liveDesc) : (isFrame ? pendFrame : pendDesc);

    if (tab === 'overview') return { profile: dataObj.profile, playstyle: dataObj.playstyle, overview: dataObj.overview, strategy: dataObj.strategy, extras: dataObj.extras };
    return dataObj[tab] || null;
}

/**
 * Works out which tabs the revision changed in the state on screen and marks
 * them in the strip. Re-run on a character-state switch (admin-modes.js).
 * @watch a state the revision changed is marked on its toggle instead
 */
function calculateTabDiffs(rev) {
    window.changedTabs = [];

    if (window.activePreviewPageType === 'system' || window.activePreviewPageType === 'tierlist') {
        const oldTabs = window.currentLiveDescData.tabs || [];
        const newTabs = window.currentPendingDescData.tabs || [];
        const allTabIds = Array.from(new Set([...oldTabs.map(t=>t.tabId || t.id), ...newTabs.map(t=>t.tabId || t.id)]));

        allTabIds.forEach(tabId => {
            const oTab = oldTabs.find(t => (t.tabId || t.id) === tabId);
            const nTab = newTabs.find(t => (t.tabId || t.id) === tabId);
            if (JSON.stringify(oTab) !== JSON.stringify(nTab)) window.changedTabs.push(tabId);
        });
    } else {
        if (rev && rev.is_delta) {
            const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === 'base'));
            const active = window.activePreviewMode || null;

            const addScopeTab = (rawScope, rawKey) => {
                // A state's edit marks the tab of the scope it wraps.
                const { modeId, scope, key } = window.unwrapModeDelta(rawScope, rawKey);

                // "Changed in the state on screen": a batch can span states, and each state is
                // marked on its toggle.
                if (!((isBase(modeId) && isBase(active)) || modeId === active)) return;

                // The page's own settings belong to no tab.
                if (scope === 'pageConfig') return;

                let targetTab = 'overview';
                if (['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) targetTab = 'overview';
                else if (window.getKeyedSectionByScope(scope)) targetTab = window.getKeyedSectionByScope(scope).tab;
                // A fixed Block section names its own tab.
                else if ((window.FIXED_BLOCK_SECTIONS || []).some(f => f.scope === scope)) {
                    targetTab = window.FIXED_BLOCK_SECTIONS.find(f => f.scope === scope).tab;
                }
                // An order delta's dotted path names its list, and so its tab.
                else if (scope === 'order') {
                    const [root, field] = String(key || '').split('.');
                    if (root === 'frame') targetTab = field;
                    else if (field === 'extras') targetTab = 'overview';
                    else {
                        const section = window.getKeyedSectionByField && window.getKeyedSectionByField(field);
                        if (section) targetTab = section.tab;
                    }
                }
                // A null key must not throw: this scan says which tabs to look at.
                else if (scope === 'move') targetTab = String(key || '').split('::')[0] || 'overview';
                // No branch for the system scopes: a system or tier list page is caught by the
                // page-type check at the top, and never reaches here.

                if (!window.changedTabs.includes(targetTab)) window.changedTabs.push(targetTab);
            };

            if (rev.target_scope === 'multi') rev.delta_payload.forEach(edit => addScopeTab(edit.scope, edit.key));
            else addScopeTab(rev.target_scope, rev.target_key);
        } else {
            // The added Ultimate too, so a base-only character's ultimate edits mark it.
            const tabs = window.getCharacterTabIds({ includeInjected: true, editableOnly: true });
            tabs.forEach(tab => {
                const liveStr = JSON.stringify(getTabData(tab, 'live') || {});
                const pendStr = JSON.stringify(getTabData(tab, 'pending') || {});
                if (liveStr !== pendStr) window.changedTabs.push(tab);
            });
        }
    }

    if (typeof window.markChangedRevisionTabs === 'function') window.markChangedRevisionTabs();
}

/**
 * Selects a tab in the strip and shows its pane, without a real click.
 * @since v0.12
 * @watch setupTabs reacts only to clicks, so setting .active alone leaves the strip
 *   and the pane on different tabs
 */
window.setActiveRevisionTab = function(tabId) {
    const nav = document.getElementById('preview-tab-nav');
    if (!nav) return;

    const target = document.getElementById(`nav-${tabId}`);
    if (!target) return;

    nav.querySelectorAll('.btn-manga').forEach(btn => btn.classList.remove('active'));
    target.classList.add('active');

    document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => el.classList.add('hidden'));
    const content = document.getElementById(`tab-${tabId}`);
    if (content) content.classList.remove('hidden');
};

// Marks the tabs the revision changed: a merged ticket has no single tab to open on.
window.markChangedRevisionTabs = function() {
    const nav = document.getElementById('preview-tab-nav');
    if (!nav) return;

    nav.querySelectorAll('.btn-manga').forEach(btn => btn.classList.remove('tab-changed'));
    (window.changedTabs || []).forEach(tabId => {
        const btn = document.getElementById(`nav-${tabId}`);
        if (btn) btn.classList.add('tab-changed');
    });
};

/**
 * The strip's own tabs for a system or tier list page, in place of the character tabs.
 */
window.updateAdminSidebar = function() {
    const navOverviewBtn = document.getElementById('nav-overview');
    const navContainer = navOverviewBtn ? navOverviewBtn.parentElement : null;
    if (!navContainer) return;

    navContainer.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    if (window.activePreviewPageType === 'system' || window.activePreviewPageType === 'tierlist') {
        window.getCharacterTabIds({ editableOnly: true }).forEach(tab => {
            const btn = document.getElementById(`nav-${tab}`);
            if (btn) btn.classList.add('hidden');
        });

        const sysTabs = window.currentPendingDescData.tabs || window.currentLiveDescData.tabs || [];
        const tabIds = [];

        sysTabs.forEach((tab, idx) => {
            // A system page's tabs use tabId/tabLabel; a tier list's use id/label.
            const tabId = tab.tabId || tab.id;
            const tabLabel = tab.tabLabel || tab.label || tabId;
            tabIds.push(tabId);
            // The same markup as the character tabs, built as nodes since tabLabel is
            // contributor text.
            const btn = document.createElement('button');
            btn.id = `nav-${tabId}`;
            btn.className = `btn-manga btn-manga-slanted system-nav-btn ${idx === 0 ? 'active' : ''}`;

            const content = document.createElement('div');
            content.className = 'btn-manga-content';
            const text = document.createElement('span');
            text.className = 'btn-manga-text';
            text.textContent = tabLabel;
            content.appendChild(text);
            btn.appendChild(content);

            navContainer.appendChild(btn);

            btn.addEventListener('click', () => {
                setTimeout(updateAdminTOC, 150);
            });
        });

        if (typeof setupTabs === 'function') {
            setupTabs('nav', 'tab', tabIds, 'major');
        }
    }
};
