/**
 * Dogslamloop Wiki - Admin Overseer: Diff (change detection, LCS text diff,
 * changed-tabs popup, dynamic document explorer sidebar)
 */

// --- INLINE TEXT DIFF ALGORITHM (SMART GROUPING) ---
window.diffTextLCS = function(oldStr, newStr) {
    // Escaped up front, before tokenizing - both inputs are contributor-
    // submitted prose (a revision's actual paragraph/list/table content),
    // rendered straight into innerHTML via the <del>/<ins> markup built
    // below. Was previously unescaped - a real XSS gap, since this is a
    // reviewer's authenticated session rendering untrusted submitted text.
    // Escaping first (not per-fragment later) keeps the LCS matching
    // correct: escapeHtml never introduces/removes whitespace, so token
    // boundaries and equality comparisons are unaffected.
    oldStr = window.escapeHtml(String(oldStr || ''));
    newStr = window.escapeHtml(String(newStr || ''));
    if (oldStr === newStr) return newStr;
    if (!oldStr) return `<ins class="diff-add">${newStr}</ins>`;
    if (!newStr) return `<del class="diff-del">${oldStr}</del>`;

    const a = oldStr.split(/(\s+)/).filter(val => val.length > 0);
    const b = newStr.split(/(\s+)/).filter(val => val.length > 0);
    const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1] + 1;
            else matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
    }

    let i = a.length, j = b.length;
    const rawOps = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            rawOps.unshift({ type: 'eq', text: a[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            rawOps.unshift({ type: 'ins', text: b[j - 1] });
            j--;
        } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            rawOps.unshift({ type: 'del', text: a[i - 1] });
            i--;
        }
    }

    for (let k = 1; k < rawOps.length - 1; k++) {
        if (rawOps[k].type === 'eq' && (!rawOps[k].text.trim() || rawOps[k].text.length === 1)) {
            if (rawOps[k-1].type !== 'eq' && rawOps[k+1].type !== 'eq') {
                rawOps[k].type = 'trivial';
            }
        }
    }

    let finalHtml = '';
    let currentDels = '';
    let currentInss = '';

    const flushEdits = () => {
        if (currentDels) finalHtml += `<del class="diff-del">${currentDels}</del>`;
        if (currentInss) finalHtml += `<ins class="diff-add">${currentInss}</ins>`;
        currentDels = '';
        currentInss = '';
    };

    for (const op of rawOps) {
        if (op.type === 'eq') {
            flushEdits();
            finalHtml += op.text;
        } else if (op.type === 'del') {
            currentDels += op.text;
        } else if (op.type === 'ins') {
            currentInss += op.text;
        } else if (op.type === 'trivial') {
            currentDels += op.text;
            currentInss += op.text;
        }
    }
    flushEdits();

    return finalHtml;
};

// --- STRUCTURAL DIFF (Phase 2 of the reviewer-workflow redesign) ---
// renderDiffBlock's fallback for anything that isn't a block-array (move
// stats/frame data, profile/playstyle metadata, matchup/counterplay
// metadata) used to dump two raw JSON blobs side by side - readable for a
// reviewer eyeballing prose, not for spotting a single changed frame
// number buried in an object. Walks both objects key by key and highlights
// what actually changed, same visual language (ins.diff-add/del.diff-del)
// as the prose LCS diff above.
window.renderStructuredDiff = function(oldObj, newObj) {
    const formatValue = (val) => {
        if (val === undefined) return '';
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return String(val);
    };

    const renderFields = (oldO, newO) => {
        const safeOld = oldO && typeof oldO === 'object' ? oldO : {};
        const safeNew = newO && typeof newO === 'object' ? newO : {};
        const allKeys = [...new Set([...Object.keys(safeOld), ...Object.keys(safeNew)])];

        let rowsHtml = '';
        allKeys.forEach(key => {
            const oldVal = safeOld[key];
            const newVal = safeNew[key];
            if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return; // unchanged - skip, not noise

            const bothPlainObjects = oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object'
                && !Array.isArray(oldVal) && !Array.isArray(newVal);

            let valueHtml;
            if (bothPlainObjects) {
                valueHtml = `<div class="diff-field-nested">${renderFields(oldVal, newVal)}</div>`;
            } else if (oldVal === undefined) {
                valueHtml = `<ins class="diff-add">${window.escapeHtml(formatValue(newVal))}</ins>`;
            } else if (newVal === undefined) {
                valueHtml = `<del class="diff-del">${window.escapeHtml(formatValue(oldVal))}</del>`;
            } else {
                valueHtml = `<del class="diff-del">${window.escapeHtml(formatValue(oldVal))}</del> <ins class="diff-add">${window.escapeHtml(formatValue(newVal))}</ins>`;
            }

            rowsHtml += `<div class="diff-field-row"><span class="diff-field-key">${window.escapeHtml(key)}:</span> ${valueHtml}</div>`;
        });

        return rowsHtml || `<div class="diff-field-row diff-field-unchanged">No field-level changes detected.</div>`;
    };

    return `<div class="diff-structured">${renderFields(oldObj, newObj)}</div>`;
};

// --- SMART DELTA HIGHLIGHTER ---
// Previously defined twice, byte-identical, further down the old single
// admin.js (a Gemini copy-paste artifact) - one definition here.
function getTabData(tab, mode) {
    const isFrame = ['m1s', 'skills', 'specials'].includes(tab);
    const liveDesc = window.currentLiveDescData || {};
    const liveFrame = window.currentLiveFrameData || {};
    const pendDesc = window.currentPendingDescData || {};
    const pendFrame = window.currentPendingFrameData || {};

    const dataObj = mode === 'live' ? (isFrame ? liveFrame : liveDesc) : (isFrame ? pendFrame : pendDesc);

    if (tab === 'overview') return { profile: dataObj.profile, playstyle: dataObj.playstyle, overview: dataObj.overview, strategy: dataObj.strategy, extras: dataObj.extras };
    return dataObj[tab] || null;
}

// A single dismissable corner popup listing every changed tab, rather than a
// pulsing dot scattered onto each individual nav button - those buttons live
// in the sidebar, which is exactly the pane that's hidden while actually
// looking at the preview on mobile (see window.toggleMobilePreview in
// admin-core.js), so the old indicators were invisible right when they
// mattered most.
const CHANGED_TAB_LABELS = { overview: 'Overview & Strategy', m1s: 'M1s', skills: 'Skills', specials: 'Specials', matchups: 'Matchups', counterplay: 'Counterplay' };

window.showChangedTabsPopup = function() {
    const existing = document.getElementById('changed-tabs-popup');
    if (existing) existing.remove();

    const tabs = window.changedTabs || [];
    if (tabs.length === 0) return;

    const labels = tabs.map(t => CHANGED_TAB_LABELS[t] || t).join(', ');

    const popup = document.createElement('div');
    popup.id = 'changed-tabs-popup';
    popup.innerHTML = `
        <div>
            <div class="changed-tabs-popup-title">Modifications Detected</div>
            <div class="changed-tabs-popup-body">${labels}</div>
        </div>
        <button class="changed-tabs-popup-close" title="Dismiss" onclick="this.parentElement.remove()">✖</button>
    `;

    // Inserted in normal document flow right after the live-header (which
    // holds REVIEWING:/INTERCEPT & EDIT/FORCE APPROVE/FORCE REJECT), not
    // absolutely positioned over it - a floating top-right overlay collided
    // directly with those buttons regardless of screen size, silently
    // covering the actual review actions.
    const header = document.querySelector('.admin-live-header');
    if (header && header.parentElement) {
        header.insertAdjacentElement('afterend', popup);
    } else {
        const pane = document.querySelector('.admin-main-pane');
        if (pane) pane.appendChild(popup);
    }
};

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
            const addScopeTab = (scope, key) => {
                let targetTab = 'overview';
                if (['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) targetTab = 'overview';
                else if (scope === 'matchup') targetTab = 'matchups';
                else if (scope === 'counterplay') targetTab = 'counterplay';
                else if (scope === 'move') targetTab = key.split('::')[0];

                if (!window.changedTabs.includes(targetTab)) window.changedTabs.push(targetTab);
            };

            if (rev.target_scope === 'multi') rev.delta_payload.forEach(edit => addScopeTab(edit.scope, edit.key));
            else addScopeTab(rev.target_scope, rev.target_key);
        } else {
            const tabs = ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'];
            tabs.forEach(tab => {
                const liveStr = JSON.stringify(getTabData(tab, 'live') || {});
                const pendStr = JSON.stringify(getTabData(tab, 'pending') || {});
                if (liveStr !== pendStr) window.changedTabs.push(tab);
            });
        }
    }

    window.showChangedTabsPopup();
    if (typeof window.markChangedRevisionTabs === 'function') window.markChangedRevisionTabs();
}

// --- REVISION TAB STRIP ---
// Selects a tab in the strip and shows its content, without needing a real
// click. setupTabs (js/pagebuilder.js) only reacts to click events, so the
// old code - which set .active on a nav button and nothing else - left the
// strip pointing at one tab while the content pane showed another.
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

// Marks which tabs the revision actually changed. This information already
// existed as window.changedTabs but was only surfaced as a dismissible
// popup listing tab names in prose, which the reviewer had to memorise
// before navigating. It matters most on a merged ticket, which touches
// several tabs at once and so has no single target to route to.
//
// A per-button marker was tried before and removed because the buttons then
// lived in the sidebar, invisible while reading the preview on mobile. They
// are above the content now, which is what makes this worth doing again.
window.markChangedRevisionTabs = function() {
    const nav = document.getElementById('preview-tab-nav');
    if (!nav) return;

    nav.querySelectorAll('.btn-manga').forEach(btn => btn.classList.remove('tab-changed'));
    (window.changedTabs || []).forEach(tabId => {
        const btn = document.getElementById(`nav-${tabId}`);
        if (btn) btn.classList.add('tab-changed');
    });
};

// --- DYNAMIC REVISION TABS ---
// Appends into whatever holds #nav-overview, which is now the top strip
// (#preview-tab-nav) rather than the sidebar column it was written for.
window.updateAdminSidebar = function() {
    const navOverviewBtn = document.getElementById('nav-overview');
    const navContainer = navOverviewBtn ? navOverviewBtn.parentElement : null;
    if (!navContainer) return;

    // Clean up any old dynamically generated system tabs
    navContainer.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    if (window.activePreviewPageType === 'system' || window.activePreviewPageType === 'tierlist') {
        // Hide standard character tabs
        ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tab => {
            const btn = document.getElementById(`nav-${tab}`);
            if (btn) btn.classList.add('hidden');
        });

        // Rebuild with system tabs
        const sysTabs = window.currentPendingDescData.tabs || window.currentLiveDescData.tabs || [];
        const tabIds = [];

        sysTabs.forEach((tab, idx) => {
            // System-page tabs use tabId/tabLabel; tierlist tabs use id/label.
            const tabId = tab.tabId || tab.id;
            const tabLabel = tab.tabLabel || tab.label || tabId;
            tabIds.push(tabId);
            // Same markup as the static character tabs above it and as the
            // live system page's own nav (js/description.js) - a bare <div>
            // here rendered unstyled once these moved into the manga strip.
            // Built as nodes rather than innerHTML because tabLabel comes
            // from contributor-submitted desc_data.
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

        // Wire them up to standard pagebuilder tab switching logic
        if (typeof setupTabs === 'function') {
            setupTabs('nav', 'tab', tabIds, 'major');
        }
    }
};
