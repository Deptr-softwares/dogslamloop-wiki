/**
 * Dogslamloop Wiki - Admin Overseer: Diff (change detection, LCS text diff,
 * changed-tabs popup, dynamic document explorer sidebar)
 */

// --- INLINE TEXT DIFF ALGORITHM (SMART GROUPING) ---
//
// MARKERS, NOT MARKUP. This used to escape the text and return real <ins>/<del>
// tags, which worked for as long as the block renderer passed content through
// untouched. v0.15 item 1 closed a stored-XSS hole by escaping at every
// innerHTML interpolation in js/description.js - and that escaped this
// function's tags a second time, so every prose diff in the review screen
// rendered as visible `<ins class="diff-add">` and `&quot;` instead of as a
// diff. Correct escaping, correct diff, and they cancelled each other out.
//
// The fix has to survive a renderer that escapes, without giving anything a way
// to opt out of escaping - an opt-out flag would have to live on the block, and
// blocks are contributor-submitted, so a crafted payload could set it.
//
// So the text stays RAW here and the boundaries are marked with control
// characters. The renderer escapes the text exactly once, as it does for any
// other content, and the markers pass through untouched because escapeHtml does
// not alter them. resolveDiffMarkers then swaps them for the real tags.
// Written as escape sequences on purpose. Typing the control characters
// themselves leaves bytes that no editor shows and some tools treat as
// binary - a literal NUL written that way once made git call a source file
// binary in this repo.
const DIFF_MARK_ADD_OPEN = '\u0011';
const DIFF_MARK_ADD_CLOSE = '\u0012';
const DIFF_MARK_DEL_OPEN = '\u0013';
const DIFF_MARK_DEL_CLOSE = '\u0014';
const DIFF_MARK_ANY = /[\u0011-\u0014]/g;

window.DIFF_MARKERS = Object.freeze({
    addOpen: DIFF_MARK_ADD_OPEN, addClose: DIFF_MARK_ADD_CLOSE,
    delOpen: DIFF_MARK_DEL_OPEN, delClose: DIFF_MARK_DEL_CLOSE,
});

/**
 * Turns the markers left by diffTextLCS into real <ins>/<del> tags, after the
 * renderer has escaped everything around them.
 *
 * Takes an element and rewrites its innerHTML, so it runs once per rendered
 * diff container rather than per field. The tags it writes carry no
 * contributor-derived attributes - they are two fixed strings - so this cannot
 * become an injection point even if a marker were somehow forged.
 */
window.resolveDiffMarkers = function(el) {
    if (!el || !el.innerHTML) return;
    if (!DIFF_MARK_ANY.test(el.innerHTML)) { DIFF_MARK_ANY.lastIndex = 0; return; }
    DIFF_MARK_ANY.lastIndex = 0;

    el.innerHTML = el.innerHTML
        .split(DIFF_MARK_ADD_OPEN).join('<ins class="diff-add">')
        .split(DIFF_MARK_ADD_CLOSE).join('</ins>')
        .split(DIFF_MARK_DEL_OPEN).join('<del class="diff-del">')
        .split(DIFF_MARK_DEL_CLOSE).join('</del>');
};

window.diffTextLCS = function(oldStr, newStr) {
    // Contributor text cannot be allowed to carry the markers themselves, or a
    // submission could open a tag this function never opened. Stripped rather
    // than escaped: these are control characters, so nothing legitimate is lost.
    const clean = (s) => String(s || '').replace(DIFF_MARK_ANY, '');
    oldStr = clean(oldStr);
    newStr = clean(newStr);

    if (oldStr === newStr) return newStr;
    if (!oldStr) return `${DIFF_MARK_ADD_OPEN}${newStr}${DIFF_MARK_ADD_CLOSE}`;
    if (!newStr) return `${DIFF_MARK_DEL_OPEN}${oldStr}${DIFF_MARK_DEL_CLOSE}`;

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
        if (currentDels) finalHtml += `${DIFF_MARK_DEL_OPEN}${currentDels}${DIFF_MARK_DEL_CLOSE}`;
        if (currentInss) finalHtml += `${DIFF_MARK_ADD_OPEN}${currentInss}${DIFF_MARK_ADD_CLOSE}`;
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

// Field names a reviewer reads, rather than the ones the schema uses. The
// explicit entries are the ones de-camelCasing gets wrong or leaves cryptic;
// everything else falls through to the general rule, so a field added later
// reads correctly without being listed.
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
};

window.humanFieldName = function(key) {
    if (DIFF_FIELD_LABELS[key]) return DIFF_FIELD_LABELS[key];
    return String(key)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^\w/, c => c.toUpperCase());
};

window.renderStructuredDiff = function(oldObj, newObj) {
    const esc = (v) => window.escapeHtml(v);

    // A value a reviewer can read. This used to be JSON.stringify for anything
    // that was not a primitive, which is where most of the "it just shows raw
    // JSON" came from: a list of stats, a sequence of inputs and a set of
    // combo rows all arrived as one unbroken brace-filled line.
    const formatValue = (val) => {
        if (val === undefined || val === null) return '';
        if (Array.isArray(val)) {
            if (!val.length) return '(empty)';
            // A list of plain values reads as a list.
            if (val.every(v => v === null || typeof v !== 'object')) {
                return val.map(v => String(v)).join(', ');
            }
            // A list of objects: one line each, named by whatever identifies
            // them, rather than one wall of braces.
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

    // Multi-line values keep their lines. Escaped first, so the <br> is the
    // only markup that survives - these values are contributor-submitted.
    const show = (val) => esc(formatValue(val)).replace(/\n/g, '<br>');

    const renderFields = (oldO, newO, depth) => {
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
            // Two lists of objects - stats, combo rows, a move's variants.
            // Compared position by position so a single changed field shows as
            // that field, instead of both lists being reprinted whole.
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

            rowsHtml += `<div class="diff-field-row"><span class="diff-field-key">${esc(window.humanFieldName(key))}:</span> ${valueHtml}</div>`;
        });

        return rowsHtml || `<div class="diff-field-row diff-field-unchanged">No field-level changes detected.</div>`;
    };

    return `<div class="diff-structured">${renderFields(oldObj, newObj, 0)}</div>`;
};

// --- SMART DELTA HIGHLIGHTER ---
// Previously defined twice, byte-identical, further down the old single
// admin.js (a Gemini copy-paste artifact) - one definition here.
function getTabData(tab, mode) {
    const isFrame = window.FRAME_MOVE_CATEGORIES.includes(tab);

    // Narrowed to the character state the preview is showing. Without this,
    // every tab of an ultimate state was compared against the base kit's -
    // so an edit inside a state read as a wholesale rewrite of the page, and
    // an untouched base kit read as unchanged even when the revision was
    // entirely about a state.
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

// A single dismissable corner popup listing every changed tab, rather than a
// pulsing dot scattered onto each individual nav button - those buttons live
// in the sidebar, which is exactly the pane that's hidden while actually
// looking at the preview on mobile (see window.toggleMobilePreview in
// admin-core.js), so the old indicators were invisible right when they
// mattered most.
const CHANGED_TAB_LABELS = window.getCharacterTabLabels();

window.showChangedTabsPopup = function() {
    const existing = document.getElementById('changed-tabs-popup');
    if (existing) existing.remove();

    const tabs = window.changedTabs || [];

    // States this revision changed other than the one on screen. This is the
    // line that stops the whole class of bug: an edit inside an ultimate state
    // leaves every tab of the base kit identical, so without it the reviewer
    // is shown a page that is genuinely unchanged and told nothing about why.
    const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === 'base'));
    const active = window.activePreviewMode || null;
    const otherStates = (window.changedModes || [])
        .filter(id => !((isBase(id) && isBase(active)) || id === active));

    if (tabs.length === 0 && otherStates.length === 0) return;

    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s === null || s === undefined ? '' : s));
    const labels = tabs.map(t => esc(CHANGED_TAB_LABELS[t] || t)).join(', ');

    // Contributor-authored state labels reach this markup.
    const stateNames = otherStates
        .map(id => esc(typeof window.previewStateLabel === 'function' ? window.previewStateLabel(id) : id))
        .join(', ');

    let body = '';
    if (tabs.length) body += `<div class="changed-tabs-popup-body">${labels}</div>`;
    if (otherStates.length) {
        body += `<div class="changed-tabs-popup-body changed-tabs-popup-states">`
            + `Also changed in another state: ${stateNames}. Use the state toggle above the tabs.`
            + `</div>`;
    }

    const popup = document.createElement('div');
    popup.id = 'changed-tabs-popup';
    popup.innerHTML = `
        <div>
            <div class="changed-tabs-popup-title">Modifications Detected</div>
            ${body}
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

// showPopup is false when this is re-run after a character-state switch
// (js/admin-modes.js): the markers have to be recomputed for the state now on
// screen, but re-announcing the same revision every time the reviewer looks at
// another state would be noise.
function calculateTabDiffs(rev, showPopup = true) {
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
                // A character-state edit wraps one of the scopes below. The tab
                // it changed is the inner scope's tab - without unwrapping,
                // every state edit marked Overview and nothing else.
                const { modeId, scope, key } = window.unwrapModeDelta(rawScope, rawKey);

                // A marker means "changed in the state you are looking at".
                // A batched ticket can span several states, and marking the
                // union would point the reviewer at tabs that are identical in
                // the state on screen. The states themselves are marked on the
                // toggle instead (js/admin-modes.js).
                if (!((isBase(modeId) && isBase(active)) || modeId === active)) return;

                let targetTab = 'overview';
                if (['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) targetTab = 'overview';
                else if (window.getKeyedSectionByScope(scope)) targetTab = window.getKeyedSectionByScope(scope).tab;
                // A fixed block section names its own tab too. Without this,
                // editing "Read First" marked OVERVIEW as the changed tab and
                // left Combos unmarked - so the reviewer was pointed at a tab
                // that had not changed, and away from the one that had.
                else if ((window.FIXED_BLOCK_SECTIONS || []).some(f => f.scope === scope)) {
                    targetTab = window.FIXED_BLOCK_SECTIONS.find(f => f.scope === scope).tab;
                }
                // Coerced for the same reason as the diff renderer: a null key
                // reaching here would throw inside the changed-tabs scan, and
                // that scan feeds the popup telling a reviewer which tabs to
                // look at. Losing it silently is how a batch looks smaller than
                // it is. A move always has a key, so this is a guard rather
                // than a behaviour change.
                else if (scope === 'move') targetTab = String(key || '').split('::')[0] || 'overview';
                // No branch here for the system scopes on purpose. A system or
                // tier list page never reaches this code - it is caught by the
                // page-type check at the top of this function, which marks tabs
                // by comparing live against pending. One was written here, it
                // looked right, and it could not run.

                if (!window.changedTabs.includes(targetTab)) window.changedTabs.push(targetTab);
            };

            if (rev.target_scope === 'multi') rev.delta_payload.forEach(edit => addScopeTab(edit.scope, edit.key));
            else addScopeTab(rev.target_scope, rev.target_key);
        } else {
            // Includes the injected Ultimate: this compares live against
            // pending for a loaded character, so a base-only character's
            // ultimate edits must be able to mark their tab changed.
            const tabs = window.getCharacterTabIds({ includeInjected: true, editableOnly: true });
            tabs.forEach(tab => {
                const liveStr = JSON.stringify(getTabData(tab, 'live') || {});
                const pendStr = JSON.stringify(getTabData(tab, 'pending') || {});
                if (liveStr !== pendStr) window.changedTabs.push(tab);
            });
        }
    }

    if (showPopup) window.showChangedTabsPopup();
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
        window.getCharacterTabIds({ editableOnly: true }).forEach(tab => {
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
