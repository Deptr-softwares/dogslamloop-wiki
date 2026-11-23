/**
 * A character page's tabs in the editor: the major tab strip and each tab's
 * sub-navigation (Overview and its custom tabs, moves, Matchups, the keyed
 * sections, the document tabs Combos and Techs with their cards, lists and row
 * modal), and the Profile and Playstyle forms.
 * @since v0.4, as part of editor.js
 * @touches window.currentEditorDescData and currentEditorFrameData, the tab
 *   vocabulary (character_tabs.js), currentStrategyBlocks and the Block editor
 *   (editor-blocks.js), triggerManualSync (editor-sync.js), initDawEditor
 *   (editor-framedata.js), localStorage dsl_editor_stats_folded
 * @watch every loader writes the previous selection's Blocks back into the data
 *   on entry, so anything that changes what is open or the data under it clears
 *   the selection first (clearSubSelection). A write-back takes the whole buffer
 *   (currentStrategyBlocks), never getActiveBlocks(), which inside a Section Box
 *   is only the box's list.
 * @see docs/editor.md
 */

// The major tab strip, the same as the live page's. Optional tabs are included
// whatever this character has: this is evaluated at parse time, before the
// page's tab settings arrive, and an .active class on a hidden button costs
// nothing. Gallery has no editor.
const EDITOR_MAJOR_TABS = window.getCharacterTabIds({
    includeInjected: true,
    editableOnly: true,
    includeOptional: true,
});

/**
 * Draws the major tab strip with `activeTabId` lit.
 */
window.renderEditorTabNav = function(activeTabId) {
    const nav = document.getElementById('editor-tab-nav');
    if (!nav) return;

    // System, tier list, gallery and tool pages have their own builders and tabs.
    if (['system', 'tierlist', 'gallery', 'tool'].includes(window.currentEditorPageType)) {
        nav.classList.add('hidden');
        return;
    }

    nav.classList.remove('hidden');
    EDITOR_MAJOR_TABS.forEach(tabId => {
        const btn = document.getElementById(`edit-nav-${tabId}`);
        if (btn) btn.classList.toggle('active', tabId === activeTabId);
    });
};

// Forgets which section of the tab is open: every loader below writes the
// previous selection's Blocks into desc_data on entry, so this runs whenever the
// buffer cannot be trusted to belong where the selection says.
function clearSubSelection() {
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentKeyedIndex = {};

    // The document tab's cursors are plain values, since one document tab is mounted
    // at a time, so crossing tabs resets them: `group-4` of a tab with one group
    // draws nothing.
    window.currentDocSection = null;
    window.currentDocCardIndex = undefined;
    window.currentDocTableIndex = undefined;
}
// Switching state (editor-modes.js) needs exactly this reset, through this one
// function.
window.clearEditorSubSelection = clearSubSelection;

/**
 * For the reorder bar, which changes the order under the selection: forgets only
 * the selections that name the open entry by position. The fixed sections and
 * the Combo List stay open.
 * @since v1.1
 */
window.clearPositionalSelection = function () {
    window.currentMatchupIndex = undefined;
    window.currentKeyedIndex = {};
    if (String(window.currentOverviewSection || '').startsWith('extra-')) window.currentOverviewSection = null;
    // The open card's write-up is flushed into its group by position too.
    if (String(window.currentDocSection || '').startsWith('group-')) {
        window.currentDocSection = null;
        window.currentDocCardIndex = undefined;
    }
};

/**
 * Redraws the open tab from desc_data after something changed the data, not the
 * buffer (Find and Replace and its UNDO): the selection is cleared first, so the
 * older buffer is not written back, and the same section opens again.
 * @since v1.1
 */
window.reopenEditorTab = function () {
    const tabId = window.currentEditorTabId;
    const activeMove = () => document.querySelector('#interactive-builder [data-move-load].active');
    const place = {
        overview: window.currentOverviewSection,
        matchup: window.currentMatchupIndex,
        keyed: (window.currentKeyedIndex || {})[tabId],
        doc: window.currentDocSection,
        card: window.currentDocCardIndex,
        move: activeMove() ? activeMove().getAttribute('data-move-load') : null,
    };

    clearSubSelection();
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);

    // Each loader first writes back the section initFullTabEditor just opened, which
    // is harmless: that buffer was read from the data a moment ago.
    const desc = window.currentEditorDescData || {};
    if (tabId === 'overview') {
        if (place.overview && place.overview !== 'overview') window.loadOverviewSectionIntoEditor(place.overview);
    } else if (tabId === 'matchups') {
        if (place.matchup > 0 && (desc.matchups || [])[place.matchup]) window.loadMatchupIntoEditor(place.matchup);
    } else if (window.getDocumentSections && window.getDocumentSections(tabId)) {
        if (place.doc && place.doc !== 'intro') window.loadDocumentSectionIntoEditor(tabId, place.doc);
        // Opening a group shuts its cards, so the open one is put back.
        if (place.card !== undefined && String(place.doc).startsWith('group-')) {
            window.currentDocCardIndex = place.card;
            window.renderDocumentCardsPanel(tabId, parseInt(place.doc.replace('group-', ''), 10));
        }
    } else if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tabId)) {
        const section = window.getKeyedSectionByTab(tabId);
        if (place.keyed > 0 && (desc[section.field] || [])[place.keyed]) window.loadKeyedEntryIntoEditor(tabId, place.keyed);
    } else if ((window.FRAME_MOVE_CATEGORIES || []).includes(tabId)) {
        const now = activeMove();
        if (place.move && (!now || now.getAttribute('data-move-load') !== place.move)
            && document.querySelector(`#interactive-builder [data-move-load="${CSS.escape(place.move)}"]`)) {
            loadMoveIntoEditor(place.move);
        }
    }
};

/**
 * Moves the editor to another major tab, flushing first.
 * @since v0.12
 */
window.switchEditorTab = async function(tabId) {
    if (tabId === window.currentEditorTabId) return;

    // The buffer reaches desc_data only on sync, so switching without it drops what
    // is being edited.
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

    // A stale section id would write the buffer's Blocks into the wrong section of
    // the new tab; the flush above already saved them.
    clearSubSelection();

    // The preview keeps one visible tab, so the switch moves it.
    const previousPreviewTab = document.getElementById(`tab-${window.currentEditorTabId}`);
    if (previousPreviewTab) previousPreviewTab.classList.add('hidden');
    const nextPreviewTab = document.getElementById(`tab-${tabId}`);
    if (nextPreviewTab) nextPreviewTab.classList.remove('hidden');

    window.renderEditorTabNav(tabId);
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);

    // The editor boots from ?tab=, so a reload lands where the strip says. A leftover
    // &move= would reopen a move from the tab just left.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    url.searchParams.delete('move');
    window.history.replaceState({}, '', url);

    // VIEW DIFF follows the tab.
    if (window.isDiffModeActive && typeof window.showEditorSideBySide === 'function') window.showEditorSideBySide();
};

window.addExtraTab = async function() {
    await window.triggerManualSync();
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: "New Tab", content: [] });

    if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
    initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    loadOverviewSectionIntoEditor(`extra-${window.currentEditorDescData.extras.length - 1}`);
};

window.removeExtraTab = async function(idx) {
    if (await window.confirmDelete("Delete this custom tab and all its contents?")) {
        await window.triggerManualSync();
        window.currentEditorDescData.extras.splice(idx, 1);
        // Synced above. The open `extra-N` now names a neighbour, or nothing.
        window.currentOverviewSection = null;
        if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
        initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
        loadOverviewSectionIntoEditor('overview');
    }
};

window.updateExtraTabTitle = function(idx, newTitle) {
    window.currentEditorDescData.extras[idx].title = newTitle;
    const btn = document.getElementById(`overview-nav-extra-${idx}`);
    if (btn) btn.firstChild.textContent = newTitle;
    renderFullOverviewPreview();
};

/**
 * Mounts the editor for one tab of the page, routing a gallery, a tool, a system
 * page and a tier list to their own builders.
 */
function initFullTabEditor(charId, tabId, descData, frameData) {
    const builder = document.getElementById('interactive-builder');

    window.currentEditorFrameData = frameData;
    window.currentEditorDescData = descData || {};
    window.currentEditorTabId = tabId;
    window.currentEditorCharId = charId;

    // Every way into a tab lands here, so the strip follows the URL.
    if (typeof window.renderEditorTabNav === 'function') window.renderEditorTabNav(tabId);

    // A gallery is a flat list of named media, not tabs of Blocks.
    if (window.currentEditorPageType === 'gallery') {
        if (typeof window.renderGalleryEditor === 'function') window.renderGalleryEditor(builder);
        return;
    }

    // A tab that brings its own editor: a keyed section declaring `editorFn` (the
    // character Gallery tab), found in the vocabulary rather than by name.
    const tabSection = window.getKeyedSectionByTab ? window.getKeyedSectionByTab(tabId) : null;
    if (tabSection && tabSection.editorFn && typeof window[tabSection.editorFn] === 'function') {
        window[tabSection.editorFn](builder);
        return;
    }

    // A tool page is a link or an app plus two Block lists, not tabs of sections.
    if (window.currentEditorPageType === 'tool') {
        if (typeof window.renderToolEditor === 'function') window.renderToolEditor(builder);
        return;
    }

    if (window.currentEditorPageType === 'system') {
        if (window.currentSystemTabIdx === undefined) {
            // EDIT TAB opens the custom tab that was clicked.
            const foundIdx = (window.currentEditorDescData.tabs || []).findIndex(t => t.tabId === tabId);
            window.currentSystemTabIdx = foundIdx > -1 ? foundIdx : 0;
        }
        if (window.currentSystemSecIdx === undefined) window.currentSystemSecIdx = 0;
        window.renderSystemEditor(builder);
        return;
    } else if (window.currentEditorPageType === 'tierlist') {
        // The tier list's builder lives in the sidebar.
        if (typeof window.initTierListEditor === 'function') {
            window.initTierListEditor(builder.id, window.currentEditorDescData);
        }

        // The live preview gives way to a static notice.
        const previewPane = document.querySelector('.live-preview-pane .main-content-area') || document.querySelector('.live-preview-pane');
        if (previewPane) {
            previewPane.innerHTML = `
                <div class="tierlist-preview-disabled-notice">
                    <div class="tierlist-preview-disabled-icon">🚫</div>
                    <h2 class="tierlist-preview-disabled-title">LIVE PREVIEW DISABLED</h2>
                    <p class="tierlist-preview-disabled-text">The Tier List editor is used on the side. Live Preview is disabled because this shit is so fucking buggy.<br>I want to RAAAAAAAAAAAAAAHHHHHHHH</p>
                </div>
            `;
        }
        return;
    }

    const frameTabs = window.FRAME_MOVE_CATEGORIES;

    if (frameTabs.includes(tabId)) {
        const moves = frameData ? (frameData[tabId] || []) : [];

        let navHTML = window.reorderStripControls(`frame.${tabId}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        if (moves.length === 0) {
            navHTML += `<span class="daw-empty-state">No moves mapped in this category yet.</span>`;
        } else {
            moves.forEach((m, idx) => {
                // A move's id and name are stored data: never inside an inline onclick, where
                // the browser decodes &#39; back into a quote. Data attributes and listeners.
                const id = window.escapeHtml(m.id);
                navHTML += `<div class="daw-tab-item">`;
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable ${idx === 0 ? 'active' : ''}" id="move-nav-${id}" data-move-load="${id}">${window.escapeHtml(m.name || m.id)}</button>`;
                navHTML += `<button class="daw-tab-remove-btn" data-move-remove="${id}" title="Remove Move">✖</button>`;
                navHTML += `</div>`;
            });
            window.registerInserter(`frame.${tabId}`, () => window.addMove());
        }

        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addMove()">+ ADD MOVE</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="move-editor-container"></div>
        `;

        builder.querySelectorAll('[data-move-load]').forEach(btn =>
            btn.addEventListener('click', () => loadMoveIntoEditor(btn.dataset.moveLoad)));
        builder.querySelectorAll('[data-move-remove]').forEach(btn =>
            btn.addEventListener('click', () => window.removeMove(btn.dataset.moveRemove)));

        if (moves.length > 0) {
            loadMoveIntoEditor(moves[0].id);
        } else {
            document.getElementById('move-editor-container').innerHTML = `<div class="empty-tab-msg editor-empty-dashed">Click + ADD MOVE to begin mapping data.</div>`;
        }

    } else if (tabId === 'overview') {
        if (!window.currentEditorDescData.overview) window.currentEditorDescData.overview = [];
        if (!window.currentEditorDescData.strategy) window.currentEditorDescData.strategy = [];
        if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];

        let navHTML = window.reorderStripControls('desc.extras');
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-profile" onclick="loadOverviewSectionIntoEditor('profile')">Profile Card</button>`;
        navHTML += `<button class="daw-tab-btn active" id="overview-nav-overview" onclick="loadOverviewSectionIntoEditor('overview')">Character Overview</button>`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-playstyle" onclick="loadOverviewSectionIntoEditor('playstyle')">Playstyle</button>`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-strategy" onclick="loadOverviewSectionIntoEditor('strategy')">General Strategy</button>`;

        const extras = window.currentEditorDescData.extras;
        extras.forEach((ext, idx) => {
            navHTML += `<div class="daw-tab-item">`;
            navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="overview-nav-extra-${idx}" onclick="loadOverviewSectionIntoEditor('extra-${idx}')">${window.escapeHtml(ext.title)}</button>`;
            navHTML += `<button class="daw-tab-remove-btn" onclick="removeExtraTab(${idx})" title="Remove Tab">✖</button>`;
            navHTML += `</div>`;
        });
        window.registerInserter('desc.extras', () => window.addExtraTab());

        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="addExtraTab()">+ ADD TAB</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="overview-editor-container"></div>
        `;

        loadOverviewSectionIntoEditor('overview');

    } else if (tabId === 'matchups') {
        if (!window.currentEditorDescData.matchups) window.currentEditorDescData.matchups = [];

        let navHTML = window.reorderStripControls('desc.matchups');
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        if (window.currentEditorDescData.matchups.length === 0) {
             navHTML += `<span class="daw-empty-state">No matchups defined yet.</span>`;
        } else {
            window.currentEditorDescData.matchups.forEach((mu, idx) => {
                let muName = mu.opponent || `Matchup ${idx + 1}`;
                navHTML += `<div class="daw-tab-item">`;
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="matchup-nav-${idx}" onclick="window.loadMatchupIntoEditor(${idx})">vs. ${window.escapeHtml(muName)}</button>`;
                navHTML += `<button class="daw-tab-remove-btn" onclick="window.removeMatchup(${idx})" title="Remove Matchup">✖</button>`;
                navHTML += `</div>`;
            });
        }

        window.registerInserter('desc.matchups', () => window.addMatchup());
        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addMatchup()">+ ADD MATCHUP</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="matchup-editor-container"></div>
        `;

        if (window.currentEditorDescData.matchups.length > 0) {
            window.loadMatchupIntoEditor(0);
        } else {
            document.getElementById('matchup-editor-container').innerHTML = `<div class="empty-tab-msg">Create a matchup to begin editing.</div>`;
            if (typeof renderMatchupsPreview === 'function') renderMatchupsPreview();
        }

    } else if (window.getDocumentSections && window.getDocumentSections(tabId)) {
        // A document tab (Combos, Techs) is three parts, so its editor is a sub-tab
        // strip like Overview's, not a list of entries:
        //   [ Read First ] [ Combo List ] [ True Combos x ] [ + GROUP ]
        // Every word that differs between the two comes from character_tabs.js.
        const doc = window.getDocumentSections(tabId);
        const { intro, groups, list } = doc;

        if (!window.currentEditorDescData[intro.field]) window.currentEditorDescData[intro.field] = [];
        if (!window.currentEditorDescData[groups.field]) window.currentEditorDescData[groups.field] = [];

        let navHTML = window.reorderStripControls(`desc.${groups.field}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        // The tab id in the ids: loadDocumentSectionIntoEditor clears `active` by prefix.
        navHTML += `<button class="daw-tab-btn active" id="${window.escapeHtml(tabId)}-nav-intro" onclick="window.loadDocumentSectionIntoEditor('${window.escapeHtml(tabId)}', 'intro')">${window.escapeHtml(intro.label)}</button>`;
        navHTML += `<button class="daw-tab-btn" id="${window.escapeHtml(tabId)}-nav-list" onclick="window.loadDocumentSectionIntoEditor('${window.escapeHtml(tabId)}', 'list')">${window.escapeHtml(list.label)}</button>`;

        window.currentEditorDescData[groups.field].forEach((group, idx) => {
            // Escaped: a group title is contributor text.
            const name = group[groups.keyField] || `Group ${idx + 1}`;
            navHTML += `<div class="daw-tab-item">`;
            navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="${window.escapeHtml(tabId)}-nav-group-${idx}" onclick="window.loadDocumentSectionIntoEditor('${window.escapeHtml(tabId)}', 'group-${idx}')">${window.escapeHtml(name)}</button>`;
            navHTML += `<button class="daw-tab-remove-btn" onclick="window.removeDocumentGroup('${window.escapeHtml(tabId)}', ${idx})" title="Remove Group">&#10006;</button>`;
            navHTML += `</div>`;
        });

        window.registerInserter(`desc.${groups.field}`, () => window.addDocumentGroup(tabId));
        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addDocumentGroup('${window.escapeHtml(tabId)}')">+ GROUP</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="${window.escapeHtml(tabId)}-editor-container"></div>
        `;

        window.loadDocumentSectionIntoEditor(tabId, window.currentDocSection || 'intro');

    } else if (window.usesSharedKeyedUI(tabId)) {
        // Every keyed section but Matchups, whose picker lists the roster and whose
        // metadata is a tier: a different screen.
        const section = window.getKeyedSectionByTab(tabId);
        if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
        const entries = window.currentEditorDescData[section.field];

        const noun = section.entryLabel;

        let navHTML = window.reorderStripControls(`desc.${section.field}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        if (entries.length === 0) {
            navHTML += `<span class="daw-empty-state">No ${window.escapeHtml(noun.toLowerCase())} entries defined yet.</span>`;
        } else {
            entries.forEach((entry, idx) => {
                // Escaped: the name is contributor text. The index is a number this loop made,
                // which is why it may sit in the inline handler and the name may not.
                const name = entry[section.keyField] || `${noun} ${idx + 1}`;
                navHTML += `<div class="daw-tab-item">`;
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="${section.tab}-nav-${idx}" onclick="window.loadKeyedEntryIntoEditor('${section.tab}', ${idx})">${window.escapeHtml(name)}</button>`;
                navHTML += `<button class="daw-tab-remove-btn" onclick="window.removeKeyedEntry('${section.tab}', ${idx})" title="Remove">&#10006;</button>`;
                navHTML += `</div>`;
            });
        }

        window.registerInserter(`desc.${section.field}`, () => window.addKeyedEntry(section.tab));
        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addKeyedEntry('${section.tab}')">+ ADD TOPIC</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="${section.tab}-editor-container"></div>
        `;

        if (entries.length > 0) {
            window.loadKeyedEntryIntoEditor(section.tab, 0);
        } else {
            document.getElementById(`${section.tab}-editor-container`).innerHTML = `<div class="empty-tab-msg">Create a topic to begin editing.</div>`;
            window.renderKeyedSectionPreview(section.tab);
        }

    } else {
        builder.innerHTML = `
            <div class="editor-section-banner editor-section-banner-spaced">
                <span class="editor-section-banner-text">EDITING: ${tabId}</span>
            </div>
            <div id="strategy-block-target"></div>
        `;
        let contentData = descData ? (descData[tabId] || []) : [];
        initStrategyBlockBuilder('strategy-block-target', contentData);
        updateLivePreview();
    }
}

/**
 * Adds a move to the tab: asks for its id, adds a blank move and opens it.
 */
window.addMove = async function() {
    const newMoveMeta = await window.promptForMoveId();
    if (!newMoveMeta) return; // cancelled

    await window.triggerManualSync();
    const tabId = window.currentEditorTabId;

    if (!window.currentEditorFrameData) window.currentEditorFrameData = {};
    if (!window.currentEditorFrameData[tabId]) window.currentEditorFrameData[tabId] = [];
    if (!window.currentEditorDescData.moveStrategies) window.currentEditorDescData.moveStrategies = {};

    window.currentEditorFrameData[tabId].push({
        id: newMoveMeta.id,
        name: newMoveMeta.name,
        input: "M1",
        type: "Attack",
        damageType: "Melee",
        media: { src: "", alt: "" },
        stats: [],
        variants: {},
        totalScale: 100,
        bars: [{ type: "single", headerInfo: "Track 1", phases: [] }]
    });

    window.currentEditorDescData.moveStrategies[newMoveMeta.id] = [];

    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMoveIntoEditor(newMoveMeta.id);
};

window.removeMove = async function(moveId) {
    if (await window.confirmDelete("Delete this entire move (stats, frame data, and strategy)?")) {
        await window.triggerManualSync();
        const tabId = window.currentEditorTabId;
        const arr = window.currentEditorFrameData[tabId];

        const idx = arr.findIndex(m => m.id === moveId);
        if (idx > -1) arr.splice(idx, 1);

        if (window.currentEditorDescData.moveStrategies && window.currentEditorDescData.moveStrategies[moveId]) {
            delete window.currentEditorDescData.moveStrategies[moveId];
        }

        // The deleted move goes from the live preview at once.
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${CSS.escape(String(moveId))}`);
        if (previewCard) previewCard.remove();

        initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    }
};

window.promptForMoveId = function() {
    return new Promise((resolve) => {
        let overlay = document.getElementById('move-id-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'move-id-modal';
            overlay.className = 'editor-modal-overlay move-id-modal-elevated';
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div class="editor-modal-box auth-modal-box move-id-modal-box">
                <div class="auth-header">
                    <h3 class="move-id-modal-title">ADD NEW MOVE</h3>
                </div>
                <div class="auth-body">
                    <div class="move-id-form-fields">
                        <div>
                            <label class="qa-field-label">MOVE DISPLAY NAME</label>
                            <input type="text" id="new-move-name" class="editor-input editor-input-spaced" placeholder="e.g. Cursed Strike">
                        </div>
                        <div>
                            <label class="qa-field-label">TECHNICAL ID (No spaces, lowercase)</label>
                            <input type="text" id="new-move-id" class="editor-input editor-input-spaced" placeholder="e.g. cursed_strike">
                        </div>
                    </div>
                </div>
                <div class="editor-modal-actions qa-modal-actions-divided">
                    <button id="btn-move-cancel" class="btn-sys btn-sys-regular">CANCEL</button>
                    <button id="btn-move-confirm" class="btn-sys btn-sys-green">INITIALIZE</button>
                </div>
            </div>
        `;

        overlay.classList.remove('hidden');

        // The technical id follows the name as it is typed.
        const nameInp = overlay.querySelector('#new-move-name');
        const idInp = overlay.querySelector('#new-move-id');

        nameInp.addEventListener('input', (e) => {
            if (!idInp.dataset.manuallyEdited) {
                idInp.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            }
        });

        idInp.addEventListener('input', () => { idInp.dataset.manuallyEdited = 'true'; });

        overlay.querySelector('#btn-move-cancel').onclick = () => {
            overlay.classList.add('hidden');
            resolve(null);
        };

        overlay.querySelector('#btn-move-confirm').onclick = () => {
            const mName = nameInp.value.trim();
            const mId = idInp.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');

            if (!mName || !mId) {
                window.editorAlert("Both the Name and the Technical ID are required!");
                return;
            }

            // No two moves in a tab share an id.
            const tabId = window.currentEditorTabId;
            const existingMoves = window.currentEditorFrameData[tabId] || [];
            if (existingMoves.some(m => m.id === mId)) {
                window.editorAlert(`A move with the exact ID "${mId}" already exists in this tab!`);
                return;
            }

            overlay.classList.add('hidden');
            resolve({ name: mName, id: mId });
        };
    });
};

window.loadOverviewSectionIntoEditor = function(sectionId) {
    const oldSectionId = window.currentOverviewSection;
    if (oldSectionId && window.currentEditorDescData) {
        if (oldSectionId === 'overview') window.currentEditorDescData.overview = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (oldSectionId === 'strategy') window.currentEditorDescData.strategy = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (oldSectionId.startsWith('extra-')) window.currentEditorDescData.extras[parseInt(oldSectionId.split('-')[1])].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
    }

    document.querySelectorAll('[id^="overview-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`overview-nav-${sectionId}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentOverviewSection = sectionId;
    const descData = window.currentEditorDescData || {};
    const container = document.getElementById('overview-editor-container');

    if (sectionId === 'profile') {
        container.innerHTML = `
            <div class="editor-section-banner">
                <span class="editor-section-banner-text">EDITING: PROFILE CARD</span>
            </div>
            <div id="profile-editor-target"></div>
        `;
        initProfileEditor('profile-editor-target', descData.profile);
        renderFullOverviewPreview();

        setTimeout(() => {
            const previewCard = document.querySelector('.live-preview-pane .profile-card');
            if (previewCard) {
                previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
                previewCard.style.outline = '2px solid var(--accent-blue)';
                previewCard.style.outlineOffset = '2px';
                setTimeout(() => { previewCard.style.outline = 'none'; }, 800);
            }
        }, 150);
        return;
    }

    if (sectionId === 'playstyle') {
        container.innerHTML = `
            <div class="editor-section-banner">
                <span class="editor-section-banner-text">EDITING: PLAYSTYLE</span>
            </div>
            <div id="playstyle-editor-target"></div>
        `;
        initPlaystyleEditor('playstyle-editor-target', descData.playstyle);
        renderFullOverviewPreview();
        return;
    }

    let contentData = [];
    let sectionTitle = "";
    let titleHTML = "";

    if (sectionId === 'overview') {
        contentData = descData.overview || [];
        sectionTitle = "Character Overview";
        titleHTML = `<span class="editor-section-banner-text">EDITING: ${sectionTitle}</span>`;
    } else if (sectionId === 'strategy') {
        contentData = descData.strategy || [];
        sectionTitle = "General Strategy";
        titleHTML = `<span class="editor-section-banner-text">EDITING: ${sectionTitle}</span>`;
    } else if (sectionId.startsWith('extra-')) {
        const idx = parseInt(sectionId.split('-')[1]);
        contentData = descData.extras[idx].content || [];
        sectionTitle = descData.extras[idx].title || `Extra ${idx}`;
        titleHTML = `
            <div class="editor-extra-title-row">
                <span class="editor-section-banner-text-inline">EDITING:</span>
                <input type="text" class="editor-input editor-extra-title-input" value="${window.escapeHtml(sectionTitle)}" oninput="window.updateExtraTabTitle(${idx}, this.value)" placeholder="Custom Tab Name">
            </div>
        `;
    }

    container.innerHTML = `
        <div class="editor-section-banner">
            ${titleHTML}
        </div>
        <div id="strategy-block-target"></div>
    `;

    initStrategyBlockBuilder('strategy-block-target', contentData);
    renderFullOverviewPreview();

    setTimeout(() => {
        let targetId = 'overview-text-subnode';
        if (sectionId === 'strategy') targetId = 'overview-strategy-subnode';
        if (sectionId.startsWith('extra-')) targetId = `overview-extra-${sectionId.split('-')[1]}`;

        const previewCard = document.querySelector(`.live-preview-pane #${targetId}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            previewCard.style.outline = '2px solid var(--accent-blue)';
            previewCard.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.style.outline = 'none'; }, 800);
        }
    }, 150);
};

window.addMatchup = async function() {
    await window.triggerManualSync();
    window.currentEditorDescData.matchups.push({
        opponent: "New Character", tier: "Equal", content: [], author: ""
    });
    initFullTabEditor(window.currentEditorCharId, 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMatchupIntoEditor(window.currentEditorDescData.matchups.length - 1);
};

window.removeMatchup = async function(idx) {
    if (await window.confirmDelete("Delete this entire matchup?")) {
        window.currentEditorDescData.matchups.splice(idx, 1);
        // The open matchup may be gone or shifted: the redraw would save its text over a
        // neighbour.
        window.currentMatchupIndex = undefined;
        initFullTabEditor(window.currentEditorCharId, 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
        if (window.currentEditorDescData.matchups.length > 0) window.loadMatchupIntoEditor(0);
        else renderMatchupsPreview();
    }
};

window.updateMatchupMeta = function(idx, field, value) {
    window.currentEditorDescData.matchups[idx][field] = value;
    if (field === 'opponent') {
        const btn = document.getElementById(`matchup-nav-${idx}`);
        if (btn) btn.firstChild.textContent = `vs. ${value || 'Unknown'}`;
    }
    renderMatchupsPreview();
};

// Keyed sections (Counterplay, Starter Guide): one set of functions taking the tab
// id, and one window.currentKeyedIndex, which the flush in editor-sync.js reads too.

window.currentKeyedIndex = window.currentKeyedIndex || {};

window.addKeyedEntry = async function(tabId) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;
    await window.triggerManualSync();

    const entry = { [section.keyField]: `New ${section.entryLabel}`, content: [], author: "" };
    // Only if the section has metadata: an empty field nothing reads would show as a
    // change in review.
    if (section.metaField) entry[section.metaField] = Object.keys(section.metaColors || {})[2] || '';

    if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
    window.currentEditorDescData[section.field].push(entry);

    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadKeyedEntryIntoEditor(tabId, window.currentEditorDescData[section.field].length - 1);
};

window.removeKeyedEntry = async function(tabId, idx) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;
    if (await window.confirmDelete(`Delete this entire ${section.entryLabel.toLowerCase()}?`)) {
        window.currentEditorDescData[section.field].splice(idx, 1);
        // The open entry may be gone or shifted, and the next flush would write into the
        // wrong one.
        window.currentKeyedIndex[tabId] = undefined;
        initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
        if (window.currentEditorDescData[section.field].length > 0) window.loadKeyedEntryIntoEditor(tabId, 0);
        else window.renderKeyedSectionPreview(tabId);
    }
};

window.updateKeyedMeta = function(tabId, idx, field, value) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;
    window.currentEditorDescData[section.field][idx][field] = value;
    if (field === section.keyField) {
        const btn = document.getElementById(`${section.tab}-nav-${idx}`);
        // textContent: this runs on every keystroke.
        if (btn) btn.textContent = value || `Unknown ${section.entryLabel}`;
    }
    window.renderKeyedSectionPreview(tabId);
};

/**
 * A combo row's fields: window.COMBO_COLUMNS (page_render.js) plus the two
 * resource fields, so a column added to the table appears here too.
 * @since v0.15
 */
window.comboRowFields = function () {
    const columns = (window.COMBO_COLUMNS || []).filter(c => c.field !== 'sequence');
    return [
        { field: 'sequence', label: 'Route', hint: 'One step per line' },
        ...columns.map(c => ({ field: c.field, label: c.label })),
        // Shown above the notes on the page, so they end the form like the notes.
        { field: 'ultGain', label: 'Ult Gain' },
        { field: 'evasiveGain', label: 'Evasive Gain' },
    ];
};

function comboRowSummary(row) {
    const steps = Array.isArray(row.sequence) ? row.sequence : [];
    if (steps.length) return steps.join(' > ');
    return row.damage ? `(${row.damage})` : 'Empty combo';
}

// A document tab (Combos, Techs): one swapping container and one active button,
// flushing whatever was open first. Every function takes the tab id, and the
// words come from character_tabs.js. The inner panel ids stay unprefixed: one
// document tab is mounted at a time. Only the nav ids carry the tab.

function docSections(tabId) {
    return window.getDocumentSections ? window.getDocumentSections(tabId) : null;
}

window.loadDocumentSectionIntoEditor = function (tabId, sectionId) {
    const doc = docSections(tabId);
    const container = document.getElementById(`${tabId}-editor-container`);
    if (!doc || !doc.groups || !doc.intro || !container) return;

    const { intro, groups } = doc;

    // Flush the section being left: the buffer reaches the data only on sync.
    flushDocumentSection();

    document.querySelectorAll(`[id^="${tabId}-nav-"]`).forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`${tabId}-nav-${sectionId}`);
    if (activeBtn) activeBtn.classList.add('active');
    window.currentDocSection = sectionId;

    if (sectionId === 'list') {
        container.innerHTML = `<div id="combo-rows-panel"></div>`;
        window.renderDocumentListEditor(tabId);
        window.renderDocumentPreview(tabId);
        return;
    }

    if (sectionId === 'intro') {
        container.innerHTML = `
            <div class="editor-section-banner">
                <span class="editor-section-banner-text">${window.escapeHtml(intro.label.toUpperCase())}</span>
            </div>
            <div id="strategy-block-target"></div>
        `;
        initStrategyBlockBuilder('strategy-block-target', window.currentEditorDescData[intro.field] || []);
        window.renderDocumentPreview(tabId);
        return;
    }

    const idx = parseInt(String(sectionId).replace('group-', ''), 10);
    const group = (window.currentEditorDescData[groups.field] || [])[idx];
    if (!group) return;

    if (!Array.isArray(group.content)) group.content = [];

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">GROUP METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label class="editor-field-label-sm">Group Title</label>
                        <input type="text" class="editor-input" value="${window.escapeHtml(group[groups.keyField] || '')}"
                               oninput="window.updateDocumentGroupTitle('${window.escapeHtml(tabId)}', ${idx}, this.value)"
                               placeholder="e.g. True Combos">
                    </div>
                </div>
            </div>
        </div>
        <div class="editor-section-banner">
            <span class="editor-section-banner-text">${window.escapeHtml(String(groups.unitNoun || 'Combo').toUpperCase())} CARDS</span>
        </div>
        <div id="combo-cards-panel"></div>
    `;

    // A group is a list of cards, and the Block editor edits the open card's write-up,
    // never the group: with no card picked there is nowhere to add a Block.
    window.currentDocCardIndex = undefined;
    window.renderDocumentCardsPanel(tabId, idx);
    window.renderDocumentPreview(tabId);
};

/**
 * The cards in one group, and the write-up editor for the open one.
 * @since v0.15
 */
window.renderDocumentCardsPanel = function (tabId, groupIdx) {
    const doc = docSections(tabId);
    const host = document.getElementById('combo-cards-panel');
    if (!doc || !doc.groups || !host) return;

    const groups = doc.groups;
    const noun = groups.unitNoun || 'Combo';
    const group = (window.currentEditorDescData[groups.field] || [])[groupIdx];
    if (!group) return;
    if (!Array.isArray(group.content)) group.content = [];

    const cards = group.content;
    const open = window.currentDocCardIndex;

    let html = `<div class="daw-variant-tabs daw-editor-nav-row">`;
    if (cards.length === 0) {
        html += `<span class="daw-empty-state">No ${window.escapeHtml(noun.toLowerCase())} cards in this group yet.</span>`;
    } else {
        cards.forEach((card, i) => {
            // A card is known by its name, or its route; through comboCardLabel, since the
            // card's own title is unused in Multiple Sections.
            const label = window.comboCardLabel(card, i);
            html += `<div class="daw-tab-item">`;
            html += `<button class="daw-tab-btn daw-tab-btn-removable${i === open ? ' active' : ''}" data-card="${i}">${window.escapeHtml(label)}</button>`;
            html += `<button class="daw-tab-remove-btn" data-remove-card="${i}" title="Remove Card">&#10006;</button>`;
            html += `</div>`;
        });
    }
    html += `<button type="button" id="combo-card-add" class="daw-tab-btn daw-add-btn btn-sys btn-sys-green">+ CARD</button>`;
    html += `</div><div id="combo-card-body"></div>`;

    host.innerHTML = html;

    host.querySelectorAll('[data-card]').forEach(btn => {
        btn.addEventListener('click', () => {
            flushDocumentCard(tabId, groupIdx);
            window.currentDocCardIndex = parseInt(btn.getAttribute('data-card'), 10);
            window.renderDocumentCardsPanel(tabId, groupIdx);
        });
    });
    host.querySelectorAll('[data-remove-card]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete(`Delete this ${noun.toLowerCase()} card and its write-up?`))) return;
            cards.splice(parseInt(btn.getAttribute('data-remove-card'), 10), 1);
            // The open card may be gone or shifted.
            window.currentDocCardIndex = undefined;
            window.renderDocumentCardsPanel(tabId, groupIdx);
            window.renderDocumentPreview(tabId);
        });
    });
    const addBtn = host.querySelector('#combo-card-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            flushDocumentCard(tabId, groupIdx);
            const card = window.spawnBlockWithAuthor
                ? window.spawnBlockWithAuthor('theorybox')
                : { type: 'theorybox', title: `New ${noun}`, sequence: [], content: [] };
            cards.push(card);
            window.currentDocCardIndex = cards.length - 1;
            window.renderDocumentCardsPanel(tabId, groupIdx);
            window.renderDocumentPreview(tabId);
        });
    }

    renderDocumentCardBody(tabId, groupIdx, cards);
};

// The buffer belongs to the open card's write-up and is written back only on a
// switch or a sync. The whole buffer: see the file's opening block. The
// introduction, a keyed entry and a matchup write back the same way.
function flushDocumentCard(tabId, groupIdx) {
    const doc = docSections(tabId);
    const idx = window.currentDocCardIndex;
    if (!doc || !doc.groups || idx === undefined || typeof currentStrategyBlocks === 'undefined') return;
    const group = (window.currentEditorDescData[doc.groups.field] || [])[groupIdx];
    const card = group && Array.isArray(group.content) ? group.content[idx] : null;
    // Into the section on screen in Multiple Sections, through the helper the Block
    // form uses, so the two agree where a write-up lives.
    const dest = (card && typeof window.editorCardFieldTarget === 'function')
        ? window.editorCardFieldTarget(card)
        : card;
    if (dest) dest.content = JSON.parse(JSON.stringify(currentStrategyBlocks));
}
window.flushDocumentCard = flushDocumentCard;

function renderDocumentCardBody(tabId, groupIdx, cards) {
    const container = document.getElementById('combo-card-body');
    if (!container) return;

    const doc = docSections(tabId);
    const noun = (doc && doc.groups && doc.groups.unitNoun) || 'Combo';
    const idx = window.currentDocCardIndex;
    const card = cards[idx];
    if (!card) {
        // No card open, so no Block toolbar: an ADD BLOCK there has nowhere to go.
        container.innerHTML = `<p class="admin-tool-hint">Select a ${window.escapeHtml(noun.toLowerCase())} card to edit it, or add one.</p>`;
        return;
    }

    // Multiple Sections here too: a Combo Card has two editors, this one and the
    // Block form in editor-blocks.js, and both use the same helpers. Which section is
    // open is never stored.
    const multi = !!card.multiSections;
    const sections = Array.isArray(card.sections) ? card.sections : [];
    const secIdx = multi ? window.editorCardSectionIndex(card) : -1;
    // The fields edit the section on screen with the switch on, the card off.
    const target = (secIdx >= 0) ? sections[secIdx] : card;

    const stripHTML = (multi && sections.length) ? `
        <div class="cardsec-strip">
            <div class="cardsec-label">SECTIONS</div>
            <div class="cardsec-tabs">
                ${sections.map((sec, i) =>
                    // `cardsec-tab` too: the Block form's strip carries it, and the CSS is written
                    // against it.
                    `<button type="button" class="btn-sys ${i === secIdx ? 'btn-sys-blue' : 'btn-sys-regular'} cardsec-tab" data-cardsec="${i}">`
                    + `${window.escapeHtml(sec.label || sec.title || `Section ${i + 1}`)}</button>`).join('')}
                <button type="button" class="btn-sys btn-sys-green" data-cardsec-add="1" title="Add a section">+</button>
                ${sections.length > 1 ? `<button type="button" class="btn-sys btn-sys-red" data-cardsec-remove="${secIdx}" title="Remove this section">&#10006;</button>` : ''}
            </div>
            <label class="editor-field-label-sm">Tab label</label>
            <input type="text" class="editor-input" data-cardsec-label="${secIdx}" value="${window.escapeHtml(target.label || '')}" placeholder="e.g. In Corner 6H">
        </div>` : '';

    const route = Array.isArray(target.sequence) ? target.sequence.join('\n') : '';
    const difficulties = ['', ...(window.COMBO_DIFFICULTIES || [])]
        .map(d => `<option value="${window.escapeHtml(d)}" ${target.difficulty === d ? 'selected' : ''}>${window.escapeHtml(d || '- none -')}</option>`)
        .join('');

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">${window.escapeHtml(noun.toUpperCase())} CARD</span></div>
                <label class="block-video-controls-label cardsec-switch">
                    <input type="checkbox" data-card-multi ${multi ? 'checked' : ''}> Multiple Sections
                </label>
                ${stripHTML}
                <div class="combo-card-fields">
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">Name</label>
                        <!-- data-format-field: the styling toolbar reaches
                             it, though it sits outside the write-up's
                             builder (v1.0 Part 2). The name renders styled. -->
                        <input type="text" class="editor-input" data-card-field="title" data-format-field value="${window.escapeHtml(target.title || '')}" placeholder="e.g. Corner BnB">
                    </div>
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">One line</label>
                        <input type="text" class="editor-input" data-card-field="oneliner" value="${window.escapeHtml(target.oneliner || '')}" placeholder="What this ${window.escapeHtml(noun.toLowerCase())} is for">
                    </div>
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">Route - one step per line</label>
                        <textarea class="editor-textarea" data-card-field="sequence" rows="4">${window.escapeHtml(route)}</textarea>
                    </div>
                    <!-- The same fields as the Combo Card block form, from the
                         same helper: this editor has drifted from that one
                         three times. -->
                    <div class="combo-field-full">${window.comboNotationFieldsHTML(target, { lines: true })}</div>
                    <div><label class="editor-field-label-sm">Damage</label>
                        <input type="text" class="editor-input" data-card-field="damage" value="${window.escapeHtml(target.damage || '')}" placeholder="e.g. 38-46"></div>
                    <div><label class="editor-field-label-sm">Difficulty</label>
                        <select class="editor-select" data-card-field="difficulty">${difficulties}</select></div>
                    <div><label class="editor-field-label-sm">Practicality</label>
                        <input type="text" class="editor-input" data-card-field="practicality" value="${window.escapeHtml(target.practicality || '')}" placeholder="Anything"></div>
                    <div><label class="editor-field-label-sm">Video</label>
                        <input type="text" class="editor-input" data-card-field="video" value="${window.escapeHtml(target.video || '')}" placeholder="Optional URL"></div>
                    <!-- Author credit was set when the card was spawned and
                         exposed nowhere, so it could not be removed by hand -
                         the theorybox BLOCK editor has this field, the combo
                         CARD editor did not, and a card is only ever created
                         through the card path. Owner's ask: credit is fully
                         optional, so it needs somewhere to be cleared. -->
                    <div class="combo-field-full"><label class="editor-field-label-sm">Author credit (optional)</label>
                        <input type="text" class="editor-input" data-card-field="author" value="${window.escapeHtml(card.author || '')}" placeholder="Leave blank for no credit"></div>
                </div>
            </div>
        </div>
        <div class="editor-section-banner">
            <span class="editor-section-banner-text">WRITE-UP</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    container.querySelectorAll('[data-card-field]').forEach(input => {
        const handler = () => {
            const field = input.getAttribute('data-card-field');
            // The author credit stays on the card, as in the Block form.
            const dest = (field === 'author') ? card : target;
            if (field === 'sequence') {
                // One step a line; blank lines dropped.
                dest.sequence = input.value.split('\n').map(v => v.trim()).filter(Boolean);
            } else {
                dest[field] = input.value;
            }
            if (field === 'title' || field === 'sequence') {
                const btn = document.querySelector(`[data-card="${idx}"]`);
                // The helper the row is built from, so typing and the next render agree on the
                // card's name. textContent: this runs on every keystroke.
                if (btn) btn.textContent = window.comboCardLabel(card, idx);
            }
            window.renderDocumentPreview(tabId);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    // Notation styles write into `target`, like the route. Typing never re-renders;
    // adding or removing one does, so the write-up is flushed first.
    container.querySelectorAll('[data-nstyle-label], [data-nstyle-route]').forEach(input => {
        input.addEventListener('input', () => {
            window.applyComboNotationInput(target, input);
            window.renderDocumentPreview(tabId);
        });
    });
    container.querySelectorAll('[data-nstyle-add], [data-nstyle-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.hasAttribute('data-nstyle-remove')
                && !(await window.confirmDelete('Delete this notation style?'))) return;
            flushDocumentCard(tabId, groupIdx);
            const focusAt = window.applyComboNotationClick(target, btn);
            renderDocumentCardBody(tabId, groupIdx, cards);
            window.renderDocumentPreview(tabId);
            window.focusComboNotationField(document.getElementById('combo-card-body'), focusAt);
        });
    });

    // Section controls flush the buffer first, as switching cards does.
    const multiToggle = container.querySelector('[data-card-multi]');
    if (multiToggle) {
        multiToggle.addEventListener('change', () => {
            flushDocumentCard(tabId, groupIdx);
            card.multiSections = multiToggle.checked;
            // The first section is seeded from the card on the way in and copied back on the
            // way out, so nothing written is stranded behind the switch.
            if (typeof window.seedCardSections === 'function') {
                window.seedCardSections(card, multiToggle.checked);
            }
            renderDocumentCardBody(tabId, groupIdx, cards);
            window.renderDocumentPreview(tabId);
        });
    }

    container.querySelectorAll('[data-cardsec]').forEach(btn => {
        btn.addEventListener('click', () => {
            flushDocumentCard(tabId, groupIdx);
            window.setEditorCardSection(card, parseInt(btn.getAttribute('data-cardsec'), 10));
            renderDocumentCardBody(tabId, groupIdx, cards);
        });
    });

    const addSec = container.querySelector('[data-cardsec-add]');
    if (addSec) {
        addSec.addEventListener('click', () => {
            flushDocumentCard(tabId, groupIdx);
            if (!Array.isArray(card.sections)) card.sections = [];
            card.sections.push({ label: `Section ${card.sections.length + 1}`, title: '', sequence: [], content: [] });
            window.setEditorCardSection(card, card.sections.length - 1);
            renderDocumentCardBody(tabId, groupIdx, cards);
            window.renderDocumentPreview(tabId);
        });
    }

    const removeSec = container.querySelector('[data-cardsec-remove]');
    if (removeSec) {
        removeSec.addEventListener('click', async () => {
            if (!(await window.confirmDelete('Delete this section of the card and everything in it?'))) return;
            const at = parseInt(removeSec.getAttribute('data-cardsec-remove'), 10);
            if (Array.isArray(card.sections) && card.sections.length > 1) {
                card.sections.splice(at, 1);
                window.setEditorCardSection(card, Math.max(0, at - 1));
            }
            renderDocumentCardBody(tabId, groupIdx, cards);
            window.renderDocumentPreview(tabId);
        });
    }

    const secLabel = container.querySelector('[data-cardsec-label]');
    if (secLabel) {
        // No re-render here: it would take the focus and the caret.
        secLabel.addEventListener('input', () => {
            if (secIdx < 0 || !card.sections[secIdx]) return;
            card.sections[secIdx].label = secLabel.value;
            const btn = container.querySelector(`[data-cardsec="${secIdx}"]`);
            if (btn) btn.textContent = secLabel.value || `Section ${secIdx + 1}`;
            // The card's name in the list comes from the first section, so renaming that tab
            // renames the card. Only that one.
            if (secIdx === 0) {
                const cardBtn = document.querySelector(`[data-card="${idx}"]`);
                if (cardBtn) cardBtn.textContent = window.comboCardLabel(card, idx);
            }
            window.renderDocumentPreview(tabId);
        });
    }

    // The write-up of what is on screen: the card, or its open section.
    initStrategyBlockBuilder('strategy-block-target', target.content || []);
}

/**
 * Writes the buffer back into whichever document section is open. It reads
 * currentEditorTabId: its caller, the sync path, knows what is open but not
 * which tab.
 */
function flushDocumentSection() {
    const open = window.currentDocSection;
    const tabId = window.currentEditorTabId;
    const doc = docSections(tabId);
    if (!open || open === 'list' || !doc || !window.currentEditorDescData) return;
    if (typeof currentStrategyBlocks === 'undefined') return;

    // The whole buffer.
    const blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
    if (open === 'intro') {
        window.currentEditorDescData[doc.intro.field] = blocks;
        return;
    }
    // A group's buffer is the open card's write-up: written onto group.content it
    // would replace every card in the group.
    const idx = parseInt(String(open).replace('group-', ''), 10);
    flushDocumentCard(tabId, idx);
}
window.flushDocumentSection = flushDocumentSection;

window.renderDocumentPreview = function (tabId) {
    const doc = docSections(tabId);
    if (!doc || !doc.list || !window.currentEditorDescData) return;
    const fn = doc.list.rendererFn;
    if (!fn || typeof window[fn] !== 'function') return;
    window[fn](window.currentEditorDescData);
    // Styled like the live page, or notation is coloured for readers and plain for
    // the writer.
    if (typeof window.applyInternalStyling === 'function') {
        setTimeout(window.applyInternalStyling, 30);
    }
};

window.addDocumentGroup = async function (tabId) {
    const doc = docSections(tabId);
    if (!doc || !doc.groups) return;
    const groups = doc.groups;
    await window.triggerManualSync();
    if (!window.currentEditorDescData[groups.field]) window.currentEditorDescData[groups.field] = [];
    window.currentEditorDescData[groups.field].push({ [groups.keyField]: 'New Group', content: [] });
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadDocumentSectionIntoEditor(tabId, `group-${window.currentEditorDescData[groups.field].length - 1}`);
};

window.removeDocumentGroup = async function (tabId, idx) {
    const doc = docSections(tabId);
    if (!doc || !doc.groups) return;
    if (!(await window.confirmDelete('Delete this group and everything in it?'))) return;
    window.currentEditorDescData[doc.groups.field].splice(idx, 1);
    // The open section may be gone or shifted.
    window.currentDocSection = 'intro';
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.renderDocumentPreview(tabId);
};

window.updateDocumentGroupTitle = function (tabId, idx, value) {
    const doc = docSections(tabId);
    if (!doc || !doc.groups) return;
    const group = (window.currentEditorDescData[doc.groups.field] || [])[idx];
    if (!group) return;
    group[doc.groups.keyField] = value;
    const btn = document.getElementById(`${tabId}-nav-group-${idx}`);
    // textContent: this runs on every keystroke.
    if (btn) btn.textContent = value || `Group ${idx + 1}`;
    window.renderDocumentPreview(tabId);
};

// The list editor: tables keyed by starter (Combos) or theory (Techs), whose rows
// open in a modal.
window.renderDocumentListEditor = function (tabId) {
    const doc = docSections(tabId);
    const host = document.getElementById('combo-rows-panel');
    if (!doc || !doc.list || !host) return;

    const section = doc.list;
    const noun = section.entryNoun || 'Starter';
    const nounPlural = section.entryNounPlural || 'starters';
    if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
    const tables = window.currentEditorDescData[section.field];

    const openTable = window.currentDocTableIndex;

    // The lists can be reordered like the groups. `section.field`, not a literal, so
    // Techs gets it from the same line.
    let html = window.reorderStripControls(`desc.${section.field}`);
    html += `<div class="daw-variant-tabs daw-editor-nav-row">`;
    if (tables.length === 0) {
        html += `<span class="daw-empty-state">No ${window.escapeHtml(nounPlural)} defined yet.</span>`;
    } else {
        tables.forEach((t, i) => {
            html += `<div class="daw-tab-item">`;
            html += `<button class="daw-tab-btn daw-tab-btn-removable${i === openTable ? ' active' : ''}" data-table="${i}">${window.escapeHtml(t[section.keyField] || `${noun} ${i + 1}`)}</button>`;
            html += `<button class="daw-tab-remove-btn" data-remove-table="${i}" title="Remove ${window.escapeHtml(noun)}">&#10006;</button>`;
            html += `</div>`;
        });
    }
    html += `<button type="button" id="combo-table-add" class="daw-tab-btn daw-add-btn btn-sys btn-sys-green">+ ${window.escapeHtml(noun.toUpperCase())}</button>`;
    html += `</div><div id="combo-table-body"></div>`;

    host.innerHTML = html;

    host.querySelectorAll('[data-table]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.currentDocTableIndex = parseInt(btn.getAttribute('data-table'), 10);
            window.renderDocumentListEditor(tabId);
        });
    });
    host.querySelectorAll('[data-remove-table]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete(`Delete this ${noun.toLowerCase()} and everything in it?`))) return;
            tables.splice(parseInt(btn.getAttribute('data-remove-table'), 10), 1);
            window.currentDocTableIndex = undefined;
            window.renderDocumentListEditor(tabId);
            window.renderDocumentPreview(tabId);
        });
    });
    // Shared by + STARTER and the reorder bar's insert: the latter runs this, then
    // moves what it appended.
    const appendTable = () => {
        tables.push({ [section.keyField]: `New ${noun}`, rows: [] });
        window.currentDocTableIndex = tables.length - 1;
        window.renderDocumentListEditor(tabId);
        window.renderDocumentPreview(tabId);
    };
    window.registerInserter(`desc.${section.field}`, appendTable);

    const addTable = host.querySelector('#combo-table-add');
    if (addTable) addTable.addEventListener('click', appendTable);

    renderDocumentListRows(tabId, section, tables);
};

// Not renderComboTableBody: page_render.js has a window.renderComboTableBody,
// and a top-level function here would overwrite it in the shared global scope.
function renderDocumentListRows(tabId, section, tables) {
    const container = document.getElementById('combo-table-body');
    if (!container) return;
    const idx = window.currentDocTableIndex;
    const table = tables[idx];
    if (!table) { container.innerHTML = ''; return; }

    const noun = section.entryNoun || 'Starter';
    if (!Array.isArray(table.rows)) table.rows = [];

    let html = `<div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">${window.escapeHtml(noun.toUpperCase())}</span></div>
                <div class="editor-row"><div>
                    <label class="editor-field-label-sm">${window.escapeHtml(noun)} Name</label>
                    <input type="text" class="editor-input" id="combo-table-name" value="${window.escapeHtml(table[section.keyField] || '')}" placeholder="e.g. M1 Starters">
                </div></div>
            </div>
        </div>
        <div class="combo-rows-list">`;

    if (table.rows.length === 0) {
        html += `<p class="admin-tool-hint">${window.escapeHtml(section.emptyEntryMessage || 'Nothing here yet.')}</p>`;
    } else {
        // Per-row controls, unlike the fixed bars on the strips: a row has no selection to
        // act on (opening one opens a modal), and in a vertical list the buttons stay on
        // the line the eye is on. window.moveListItem does the moving.
        const lastRow = table.rows.length - 1;
        table.rows.forEach((row, i) => {
            html += `<div class="combo-row-item">
                <span class="combo-row-move">
                    <button type="button" class="combo-row-up btn-sys btn-sys-regular" data-row="${i}"${i === 0 ? ' disabled' : ''} title="Move up" aria-label="Move this entry up">&#9650;</button>
                    <button type="button" class="combo-row-down btn-sys btn-sys-regular" data-row="${i}"${i === lastRow ? ' disabled' : ''} title="Move down" aria-label="Move this entry down">&#9660;</button>
                </span>
                <button type="button" class="combo-row-open btn-sys btn-sys-regular" data-row="${i}">${window.escapeHtml(comboRowSummary(row || {}))}</button>
                <button type="button" class="combo-row-remove btn-sys btn-sys-red" data-row="${i}" title="Remove this entry">&#10006;</button>
            </div>`;
        });
    }
    html += `</div><button type="button" id="combo-row-add" class="btn-sys btn-sys-green">+ ADD ROW</button>`;

    container.innerHTML = html;

    const nameInput = container.querySelector('#combo-table-name');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            table[section.keyField] = nameInput.value;
            const btn = document.querySelector(`[data-table="${idx}"]`);
            if (btn) btn.textContent = nameInput.value || `${noun} ${idx + 1}`;
            window.renderDocumentPreview(tabId);
        });
    }

    container.querySelectorAll('.combo-row-open').forEach(btn => {
        btn.addEventListener('click', () =>
            window.openDocumentRowModal(tabId, idx, parseInt(btn.getAttribute('data-row'), 10)));
    });
    // A row's order rides in its table's delta: the table ships whole when it
    // differs (tests/combo-row-order.spec.js).
    container.querySelectorAll('.combo-row-up, .combo-row-down').forEach(btn => {
        btn.addEventListener('click', () => {
            const from = parseInt(btn.getAttribute('data-row'), 10);
            const dir = btn.classList.contains('combo-row-up') ? -1 : 1;
            if (!window.moveListItem(table.rows, from, dir)) return;
            renderDocumentListRows(tabId, section, tables);
            window.renderDocumentPreview(tabId);
        });
    });
    container.querySelectorAll('.combo-row-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete('Delete this row?'))) return;
            table.rows.splice(parseInt(btn.getAttribute('data-row'), 10), 1);
            renderDocumentListRows(tabId, section, tables);
            window.renderDocumentPreview(tabId);
        });
    });
    const addRow = container.querySelector('#combo-row-add');
    if (addRow) {
        addRow.addEventListener('click', () => {
            table.rows.push({ sequence: [], damage: '', difficulty: '', notes: '' });
            renderDocumentListRows(tabId, section, tables);
            window.renderDocumentPreview(tabId);
            window.openDocumentRowModal(tabId, idx, table.rows.length - 1);
        });
    }
}

/**
 * The combo row's form, in a modal: twelve fields do not fit beside a preview.
 * @since v0.15
 */
window.openDocumentRowModal = function (tabId, tableIdx, rowIdx) {
    const doc = docSections(tabId);
    const modal = document.getElementById('combo-row-modal');
    const fields = document.getElementById('combo-row-modal-fields');
    if (!doc || !doc.list || !modal || !fields) return;

    const section = doc.list;
    const table = (window.currentEditorDescData[section.field] || [])[tableIdx];
    const rows = table ? (table[section.rowsField] || []) : [];
    const row = rows[rowIdx];
    if (!row) return;

    const titleEl = document.getElementById('combo-row-modal-title');
    if (titleEl) titleEl.textContent = `EDIT ROW ${rowIdx + 1}`;

    fields.innerHTML = window.comboRowFields().map(f => {
        if (f.field === 'sequence') {
            const value = Array.isArray(row.sequence) ? row.sequence.join('\n') : '';
            // Notation styles sit under the route they are alternatives to.
            return `<div class="combo-field-full">
                <label class="editor-field-label-sm">${window.escapeHtml(f.label)}<span class="admin-tool-hint"> - ${window.escapeHtml(f.hint)}</span></label>
                <textarea class="editor-textarea" data-combo-field="sequence" rows="5">${window.escapeHtml(value)}</textarea>
            </div>
            <div class="combo-field-full">${window.comboNotationFieldsHTML(row, { lines: true })}</div>`;
        }
        if (f.field === 'difficulty') {
            // A select: difficulty is ordered, and a typo would sort the row last with no
            // error.
            const options = ['', ...(window.COMBO_DIFFICULTIES || [])]
                .map(d => `<option value="${window.escapeHtml(d)}" ${row.difficulty === d ? 'selected' : ''}>${window.escapeHtml(d || '- none -')}</option>`)
                .join('');
            return `<div><label class="editor-field-label-sm">${window.escapeHtml(f.label)}</label>
                <select class="editor-select" data-combo-field="difficulty">${options}</select></div>`;
        }
        if (f.field === 'notes') {
            return `<div class="combo-field-full">
                <label class="editor-field-label-sm">${window.escapeHtml(f.label)}</label>
                <textarea class="editor-textarea" data-combo-field="notes" rows="3">${window.escapeHtml(row.notes || '')}</textarea>
            </div>`;
        }
        return `<div><label class="editor-field-label-sm">${window.escapeHtml(f.label)}</label>
            <input type="text" class="editor-input" data-combo-field="${window.escapeHtml(f.field)}" value="${window.escapeHtml(row[f.field] || '')}"></div>`;
    }).join('');

    // Live, on every keystroke: the preview behind the modal is the point, and a
    // missed Save button would lose what was typed.
    fields.querySelectorAll('[data-combo-field]').forEach(input => {
        const handler = () => {
            const field = input.getAttribute('data-combo-field');
            if (field === 'sequence') {
                // One step a line; blank lines dropped.
                row.sequence = input.value.split('\n').map(s => s.trim()).filter(Boolean);
            } else {
                row[field] = input.value;
            }
            window.renderDocumentPreview(tabId);
            const btn = document.querySelector(`.combo-row-open[data-row="${rowIdx}"]`);
            if (btn) btn.textContent = comboRowSummary(row);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    // Typing writes into the row; adding or removing a style reopens the modal on
    // the same row.
    fields.querySelectorAll('[data-nstyle-label], [data-nstyle-route]').forEach(input => {
        input.addEventListener('input', () => {
            window.applyComboNotationInput(row, input);
            window.renderDocumentPreview(tabId);
        });
    });
    fields.querySelectorAll('[data-nstyle-add], [data-nstyle-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.hasAttribute('data-nstyle-remove')
                && !(await window.confirmDelete('Delete this notation style?'))) return;
            const focusAt = window.applyComboNotationClick(row, btn);
            window.openDocumentRowModal(tabId, tableIdx, rowIdx);
            window.renderDocumentPreview(tabId);
            window.focusComboNotationField(fields, focusAt);
        });
    });

    const close = () => {
        modal.classList.add('hidden');
        window.renderDocumentListEditor(tabId);
    };

    const done = document.getElementById('combo-row-modal-done');
    const del = document.getElementById('combo-row-modal-delete');
    // Replaced, not added: a reopened modal must not delete two rows on one click.
    if (done) done.onclick = close;
    if (del) {
        del.onclick = async () => {
            if (!(await window.confirmDelete('Delete this row?'))) return;
            rows.splice(rowIdx, 1);
            close();
            window.renderDocumentPreview(tabId);
        };
    }
    modal.onclick = (e) => { if (e.target === modal) close(); };

    modal.classList.remove('hidden');
};

window.loadKeyedEntryIntoEditor = function(tabId, idx) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;

    const open = window.currentKeyedIndex[tabId];
    const list = window.currentEditorDescData[section.field] || [];

    // Flush the entry being left; the whole buffer.
    if (open !== undefined && list[open]) {
        list[open].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
    }

    document.querySelectorAll(`[id^="${section.tab}-nav-"]`).forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`${section.tab}-nav-${idx}`);
    if (activeBtn) activeBtn.classList.add('active');

    window.currentKeyedIndex[tabId] = idx;
    const entry = list[idx];
    if (!entry) return;
    const container = document.getElementById(`${section.tab}-editor-container`);
    if (!container) return;

    let metaHTML = '';
    if (section.metaField) {
        const options = Object.keys(section.metaColors || {});
        const optionHTML = options.map(t =>
            `<option value="${window.escapeHtml(t)}" ${entry[section.metaField] === t ? 'selected' : ''}>${window.escapeHtml(t)}</option>`).join('');
        metaHTML = `
                    <div>
                        <label class="editor-field-label-sm">${window.escapeHtml(section.metaLabel || section.metaField)}</label>
                        <select class="editor-select" onchange="window.updateKeyedMeta('${section.tab}', ${idx}, '${window.escapeHtml(section.metaField)}', this.value)">
                            ${optionHTML}
                        </select>
                    </div>`;
    }

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">${window.escapeHtml(section.entryLabel.toUpperCase())} METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label class="editor-field-label-sm">${window.escapeHtml(section.entryLabel)} Name</label>
                        <input type="text" class="editor-input" value="${window.escapeHtml(entry[section.keyField] || '')}" oninput="window.updateKeyedMeta('${section.tab}', ${idx}, '${window.escapeHtml(section.keyField)}', this.value)" placeholder="${window.escapeHtml(section.placeholder || 'e.g. Dealing with M1s')}">
                    </div>${metaHTML}
                </div>
            </div>
        </div>
        <div class="editor-section-banner">
            <span class="editor-section-banner-text">STRATEGY BLOCKS</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initStrategyBlockBuilder('strategy-block-target', entry.content || []);
    window.renderKeyedSectionPreview(tabId);

    setTimeout(() => {
        const safeKey = String(entry[section.keyField] || 'Unknown').replace(/\s+/g, '-');
        const previewCard = document.querySelector(`.live-preview-pane #${section.tab}-content-${CSS.escape(String(safeKey))}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 100);
};

window.loadMatchupIntoEditor = function(idx) {
    if (window.currentMatchupIndex !== undefined && window.currentEditorDescData && window.currentEditorDescData.matchups[window.currentMatchupIndex]) {
        // The whole buffer.
        window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
    }

    document.querySelectorAll('[id^="matchup-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`matchup-nav-${idx}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentMatchupIndex = idx;
    const matchup = window.currentEditorDescData.matchups[idx];
    const container = document.getElementById('matchup-editor-container');

    // The offered tiers come from site_utils.js, and the stored one is resolved
    // through it first: an old name ("Unwinnable") or junk would match no option,
    // and the browser would show the first, a tier nobody set.
    const currentTier = window.resolveMatchupTier(matchup.tier);
    const offered = window.MATCHUP_TIERS.some(t => t.id === currentTier.id)
        ? window.MATCHUP_TIERS
        : [currentTier, ...window.MATCHUP_TIERS];

    let tierHTML = offered.map(t => {
        const value = window.escapeHtml(t.id);
        return `<option value="${value}" ${t.id === currentTier.id ? 'selected' : ''}>${value}</option>`;
    }).join('');

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">MATCHUP METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label class="editor-field-label-sm">Opponent Name</label>
                        <input type="text" class="editor-input" value="${window.escapeHtml(matchup.opponent || '')}" oninput="window.updateMatchupMeta(${idx}, 'opponent', this.value)" placeholder="e.g. Gojo">
                    </div>
                    <div>
                        <label class="editor-field-label-sm">Difficulty Tier</label>
                        <select class="editor-select" onchange="window.updateMatchupMeta(${idx}, 'tier', this.value)">
                            ${tierHTML}
                        </select>
                    </div>
                    </div>
            </div>
        </div>
        <div class="editor-section-banner">
            <span class="editor-section-banner-text">STRATEGY BLOCKS</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initStrategyBlockBuilder('strategy-block-target', matchup.content || []);
    renderMatchupsPreview();

    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #matchup-content-${CSS.escape((matchup.opponent||'').replace(/\s+/g, '-'))}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// "1. STATS & FRAME DATA" folds, remembered on this device: on a long move it is
// most of the Workspace, above the strategy Blocks.
const STATS_FOLDED_KEY = 'dsl_editor_stats_folded';

function statsSectionFolded() {
    try { return window.localStorage.getItem(STATS_FOLDED_KEY) === '1'; } catch (e) { return false; }
}

function statsSectionHTML(bannerText) {
    const folded = statsSectionFolded();
    return `
        <div class="editor-section-banner editor-section-banner-spaced">
            <span class="editor-section-banner-text">${bannerText}</span>
            <button type="button" class="btn-sys btn-sys-regular editor-stats-fold"
                    aria-controls="daw-editor-target" aria-expanded="${folded ? 'false' : 'true'}">${folded ? 'EXPAND' : 'COLLAPSE'}</button>
        </div>
        <div id="daw-editor-target" class="daw-editor-target-spacing"${folded ? ' hidden' : ''}></div>`;
}

function bindStatsSectionFold(root) {
    const btn = root.querySelector('.editor-stats-fold');
    const target = root.querySelector('#daw-editor-target');
    if (!btn || !target) return;
    btn.addEventListener('click', () => {
        const fold = !target.hidden;
        target.hidden = fold;
        btn.textContent = fold ? 'EXPAND' : 'COLLAPSE';
        btn.setAttribute('aria-expanded', fold ? 'false' : 'true');
        try { window.localStorage.setItem(STATS_FOLDED_KEY, fold ? '1' : '0'); } catch (e) { /* not remembered, still works */ }
    });
}

window.loadMoveIntoEditor = async function(moveId) {
    const oldActiveBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
    if (oldActiveBtn && window.currentEditorDescData) {
        const oldMoveId = oldActiveBtn.id.replace('move-nav-', '');

        if (oldMoveId !== moveId) {
            if (!window.currentEditorDescData.moveStrategies) window.currentEditorDescData.moveStrategies = {};
            window.currentEditorDescData.moveStrategies[oldMoveId] = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
    }

    document.querySelectorAll('[id^="move-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`move-nav-${moveId}`);
    if(activeBtn) activeBtn.classList.add('active');

    const frameData = window.currentEditorFrameData || {};
    const descData = window.currentEditorDescData || {};
    const tabId = window.currentEditorTabId;

    const moveStats = frameData?.[tabId]?.find(m => m.id === moveId);
    const moveStrats = descData?.moveStrategies?.[moveId];

    const container = document.getElementById('move-editor-container');
    container.innerHTML = `
        ${statsSectionHTML(`1. STATS & FRAME DATA: ${window.escapeHtml(moveStats?.name || moveId)}`)}

        <div class="editor-section-banner">
            <span class="editor-section-banner-text">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;
    bindStatsSectionFold(container);

    initDawEditor('daw-editor-target', moveStats);
    initStrategyBlockBuilder('strategy-block-target', moveStrats || []);

    if (typeof window.triggerManualSync === 'function') {
        await window.triggerManualSync();
    }

    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${CSS.escape(String(moveId))}`);
        if (previewCard) previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
    }, 150);
};

function initPerMoveEditor(moveId, statsData, strategyData) {
    const builder = document.getElementById('interactive-builder');
    builder.innerHTML = `
        ${statsSectionHTML('1. STATS & FRAME DATA')}

        <div class="editor-section-banner">
            <span class="editor-section-banner-text">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;
    bindStatsSectionFold(builder);

    initDawEditor('daw-editor-target', statsData);
    initStrategyBlockBuilder('strategy-block-target', strategyData || []);
    updateLivePreview();
}

// Profile and Playstyle edit an object, not a Block list, so they get their own
// toolbar (the Media Library, UNDO and REDO) and history.

// The Block editor's toolbar markup, minus CLEAR ALL: wiping a whole profile from
// a button is not wanted.
function structuredFormToolbar() {
    return `
        <div class="strategy-toolbar-row">
            <div>
                <button class="btn-sys btn-sys-blue" data-form-media title="Open Media Manager">📁 MEDIA LIBRARY</button>
            </div>
            <div class="strategy-toolbar-actions">
                <button class="btn-sys btn-sys-regular" data-form-undo title="Undo" disabled>⮌ UNDO</button>
                <button class="btn-sys btn-sys-regular" data-form-redo title="Redo" disabled>⮎ REDO</button>
            </div>
        </div>
    `;
}

// A snapshot stack over a plain object, like the Block history (50 entries, a new
// branch truncates). apply() writes the restored state back and redraws.
function createFormHistory(initialState, apply) {
    let stack = [JSON.parse(JSON.stringify(initialState))];
    let index = 0;
    let undoBtn = null;
    let redoBtn = null;

    const refresh = () => {
        if (undoBtn) undoBtn.disabled = index <= 0;
        if (redoBtn) redoBtn.disabled = index >= stack.length - 1;
    };

    return {
        // After every redraw, which replaces the toolbar's buttons.
        bindButtons(u, r) { undoBtn = u; redoBtn = r; refresh(); },
        record(state) {
            const str = JSON.stringify(state);
            if (str === JSON.stringify(stack[index])) return;
            stack = stack.slice(0, index + 1);
            stack.push(JSON.parse(str));
            if (stack.length > 50) stack.shift(); else index++;
            refresh();
        },
        undo() {
            if (index <= 0) return;
            index--;
            apply(JSON.parse(JSON.stringify(stack[index])));
            refresh();
        },
        redo() {
            if (index >= stack.length - 1) return;
            index++;
            apply(JSON.parse(JSON.stringify(stack[index])));
            refresh();
        },
    };
}

function bindStructuredFormToolbar(container, history) {
    const media = container.querySelector('[data-form-media]');
    if (media) {
        media.addEventListener('click', () => {
            // The library copies a URL on click, so it needs no target.
            document.getElementById('media-modal-overlay').classList.remove('hidden');
            if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
        });
    }

    const undo = container.querySelector('[data-form-undo]');
    const redo = container.querySelector('[data-form-redo]');
    if (undo) undo.addEventListener('click', () => history.undo());
    if (redo) redo.addEventListener('click', () => history.redo());
    history.bindButtons(undo, redo);
}

function initProfileEditor(containerId, profileData) {
    const container = document.getElementById(containerId);
    if (!profileData) profileData = {};
    if (!profileData.stats) profileData.stats = [];

    // In place: the object is shared with currentEditorDescData.profile. Every field,
    // so nothing is left behind.
    const history = createFormHistory(profileData, (restored) => {
        Object.keys(profileData).forEach(k => { delete profileData[k]; });
        Object.assign(profileData, restored);
        if (!profileData.stats) profileData.stats = [];
        window.currentEditorDescData.profile = profileData;
        renderProfileForm();
        updateLivePreview();
    });

    const triggerSync = () => {
        window.currentEditorDescData.profile = profileData;
        clearTimeout(window.typingTimer);
        window.typingTimer = setTimeout(() => {
            // On the preview's debounce, so a typed word is one history entry.
            history.record(profileData);
            updateLivePreview();
        }, 400);
    };

    const renderProfileForm = () => {
        let statsHtml = '';
        profileData.stats.forEach((stat, idx) => {
            // Escaped: a reviewer intercepting a submission loads someone else's data here,
            // and an unescaped value= ends at the first quote.
            statsHtml += `
                <div class="editor-row editor-row-spaced-sm">
                    <div><input type="text" class="editor-input stat-label" data-idx="${idx}" value="${window.escapeHtml(stat.label)}" placeholder="Label (e.g. Archetype)"></div>
                    <div><input type="text" class="editor-input stat-val" data-idx="${idx}" value="${window.escapeHtml(stat.value)}" placeholder="Value (e.g. M1 Merchant)"></div>
                    <button class="btn-sys btn-sys-red btn-del-stat" data-idx="${idx}" title="Remove Stat">✖</button>
                </div>
            `;
        });

        container.innerHTML = `
            ${structuredFormToolbar()}
            <div class="block-editor-container block-editor-container-notop">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">PORTRAIT IMAGE</span></div>
                    <input type="text" class="editor-input" id="profile-image-input" value="${window.escapeHtml(profileData.image || '')}" placeholder="Image Path/URL (e.g. /medias/images/Portrait.webp)">

                    <!-- Portraits render as a fixed square now, so a source
                         that is not square gets cropped. This aims the crop:
                         nine points, matching object-position's own keywords,
                         because a character whose head sits high in the frame
                         loses it to a centre crop. Preview alongside, so the
                         choice is visible rather than guessed at. -->
                    <div class="portrait-focus-row">
                        <div>
                            <span class="editor-field-label">Crop focus</span>
                            <div class="portrait-focus-grid" id="portrait-focus-grid">
                                ${window.PORTRAIT_FOCUS_VALUES.map(value => `
                                    <button type="button" class="portrait-focus-dot${(profileData.imageFocus || 'center center') === value ? ' active' : ''}"
                                            data-focus="${value}" title="${value}" aria-label="Focus ${value}"></button>`).join('')}
                            </div>
                        </div>
                        <div class="portrait-focus-preview">
                            ${profileData.image
                                ? `<img src="${window.escapeHtml(profileData.image)}" alt="Portrait crop preview" id="portrait-focus-img" style="object-position: ${window.PORTRAIT_FOCUS_VALUES.includes(profileData.imageFocus) ? profileData.imageFocus : 'center center'};">`
                                : `<span class="portrait-focus-empty">No image yet</span>`}
                        </div>
                    </div>
                </div>

                <!-- Hover Banners (v1.2): set by editors like the portrait
                     (owner, 2026-11-19). scripts/fetch-banners.js mirrors it
                     each night for the roster popup and the Discord preview. -->
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">BANNER</span></div>
                    <input type="text" class="editor-input" id="profile-banner-input" value="${window.escapeHtml(profileData.banner || '')}" placeholder="Wide image URL from the Media Library">
                    <p class="config-option-hint">Pops up over this character on the Characters page and the home page, with the start of the Overview, and shows when the page is shared on Discord. A wide picture, about 16:9.</p>
                    <div class="profile-banner-preview" id="profile-banner-preview">
                        ${profileData.banner
                            ? `<img src="${window.escapeHtml(profileData.banner)}" alt="Banner preview" id="profile-banner-img">`
                            : `<span class="portrait-focus-empty">No banner yet</span>`}
                    </div>
                </div>

                <div class="block-card">
                    <div class="block-header">
                        <span class="block-type-badge">CHARACTER STATS</span>
                        <button class="btn-sys btn-sys-green" id="btn-add-stat">+ ADD STAT</button>
                    </div>
                    <div id="profile-stats-container">${statsHtml}</div>
                </div>

                <!-- Profile Description (v1.1): under the stats in the
                     profile card on the page. -->
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">PROFILE DESCRIPTION</span></div>
                    <label class="editor-field-label" for="profile-quote-input">Quote</label>
                    <textarea class="editor-textarea" id="profile-quote-input" rows="2" placeholder="A line the character says. Format tags work here.">${window.escapeHtml(profileData.quote || '')}</textarea>
                    <input type="text" class="editor-input" id="profile-quote-speaker-input" value="${window.escapeHtml(profileData.quoteSpeaker || '')}" placeholder="Who says it (optional)">
                    <label class="editor-field-label" for="profile-trivia-input">Trivia</label>
                    <textarea class="editor-textarea" id="profile-trivia-input" rows="3" placeholder="One fact per line. Label | details shows just the label, with the details on hover. Format tags work here.">${window.escapeHtml((profileData.trivia || []).join('\n'))}</textarea>
                    <p class="config-option-hint">Previous and Next are added for you, in the order of the Characters page.</p>
                </div>
            </div>
        `;

        bindStructuredFormToolbar(container, history);

        container.querySelector('#profile-image-input').addEventListener('input', (e) => {
            profileData.image = e.target.value; triggerSync();
            const preview = container.querySelector('#portrait-focus-img');
            if (preview) preview.src = e.target.value;
        });

        // Removed when emptied, so it is the same data as never touched.
        container.querySelector('#profile-banner-input').addEventListener('input', (e) => {
            const value = e.target.value.trim();
            if (value) profileData.banner = value;
            else delete profileData.banner;
            triggerSync();
            const box = container.querySelector('#profile-banner-preview');
            box.replaceChildren();
            if (value) {
                const img = document.createElement('img');
                img.src = value;
                img.alt = 'Banner preview';
                img.id = 'profile-banner-img';
                box.appendChild(img);
            } else {
                const empty = document.createElement('span');
                empty.className = 'portrait-focus-empty';
                empty.textContent = 'No banner yet';
                box.appendChild(empty);
            }
        });

        // From an allowlist, never the attribute: it lands in a style attribute on the page.
        container.querySelectorAll('.portrait-focus-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const value = dot.dataset.focus;
                if (!window.PORTRAIT_FOCUS_VALUES.includes(value)) return;

                profileData.imageFocus = value;
                container.querySelectorAll('.portrait-focus-dot').forEach(d => d.classList.toggle('active', d === dot));

                const preview = container.querySelector('#portrait-focus-img');
                if (preview) preview.style.objectPosition = value;

                triggerSync();
            });
        });

        container.querySelectorAll('.stat-label').forEach(inp => inp.addEventListener('input', (e) => {
            profileData.stats[e.target.dataset.idx].label = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.stat-val').forEach(inp => inp.addEventListener('input', (e) => {
            profileData.stats[e.target.dataset.idx].value = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.btn-del-stat').forEach(btn => btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete('Delete this stat?'))) return;
            profileData.stats.splice(btn.dataset.idx, 1); renderProfileForm(); triggerSync();
        }));

        container.querySelector('#btn-add-stat').addEventListener('click', () => {
            profileData.stats.push({ label: 'New Stat', value: 'Value' }); renderProfileForm(); triggerSync();
        });

        // An empty field is no field, so leaving the form blank is no change.
        const setOrDrop = (key, value) => {
            if (Array.isArray(value) ? value.length : value) profileData[key] = value;
            else delete profileData[key];
            triggerSync();
        };
        container.querySelector('#profile-quote-input').addEventListener('input', (e) => {
            window.autoSizeEditorTextarea(e.target);
            setOrDrop('quote', e.target.value.trim() ? e.target.value : '');
        });
        container.querySelector('#profile-quote-speaker-input').addEventListener('input', (e) => {
            setOrDrop('quoteSpeaker', e.target.value.trim() ? e.target.value : '');
        });
        container.querySelector('#profile-trivia-input').addEventListener('input', (e) => {
            window.autoSizeEditorTextarea(e.target);
            setOrDrop('trivia', e.target.value.split('\n').filter(line => line.trim() !== ''));
        });
    };

    renderProfileForm();
}

function initPlaystyleEditor(containerId, playstyleData) {
    const container = document.getElementById(containerId);
    if (!playstyleData) playstyleData = { likes: [], dislikes: [] };
    if (!playstyleData.likes) playstyleData.likes = [];
    if (!playstyleData.dislikes) playstyleData.dislikes = [];

    const history = createFormHistory(playstyleData, (restored) => {
        playstyleData.likes = restored.likes || [];
        playstyleData.dislikes = restored.dislikes || [];
        window.currentEditorDescData.playstyle = playstyleData;
        renderForm();
        updateLivePreview();
    });

    const triggerSync = () => {
        window.currentEditorDescData.playstyle = playstyleData;
        clearTimeout(window.typingTimer);
        window.typingTimer = setTimeout(() => {
            history.record(playstyleData);
            updateLivePreview();
        }, 400);
    };

    const renderForm = () => {
        // Escaped, as in the profile form.
        let likesHtml = playstyleData.likes.map((item, idx) => `
            <div class="editor-row editor-row-spaced-sm">
                <input type="text" class="editor-input like-inp" data-idx="${idx}" value="${window.escapeHtml(item)}" placeholder="e.g. Fast-paced rushdown">
                <button class="btn-sys btn-sys-red btn-del-like" data-idx="${idx}">✖</button>
            </div>`).join('');

        let dislikesHtml = playstyleData.dislikes.map((item, idx) => `
            <div class="editor-row editor-row-spaced-sm">
                <input type="text" class="editor-input dislike-inp" data-idx="${idx}" value="${window.escapeHtml(item)}" placeholder="e.g. Long-ranged zoning">
                <button class="btn-sys btn-sys-red btn-del-dislike" data-idx="${idx}">✖</button>
            </div>`).join('');

        container.innerHTML = `
            ${structuredFormToolbar()}
            <div class="block-editor-container block-editor-container-splitgrid">
                <div class="block-card block-card-split">
                    <div class="block-header">
                        <span class="block-type-badge block-type-badge-positive">PICK IF YOU LIKE...</span>
                        <button class="btn-sys btn-sys-green" id="btn-add-like">+ ADD</button>
                    </div>
                    <div id="likes-container">${likesHtml}</div>
                </div>
                <div class="block-card block-card-split">
                    <div class="block-header">
                        <span class="block-type-badge block-type-badge-negative">AVOID IF YOU DISLIKE...</span>
                        <button class="btn-sys btn-sys-red" id="btn-add-dislike">+ ADD</button>
                    </div>
                    <div id="dislikes-container">${dislikesHtml}</div>
                </div>
            </div>
        `;

        bindStructuredFormToolbar(container, history);

        container.querySelectorAll('.like-inp').forEach(inp => inp.addEventListener('input', (e) => {
            playstyleData.likes[e.target.dataset.idx] = e.target.value; triggerSync();
        }));
        container.querySelectorAll('.dislike-inp').forEach(inp => inp.addEventListener('input', (e) => {
            playstyleData.dislikes[e.target.dataset.idx] = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.btn-del-like').forEach(btn => btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete('Delete this line?'))) return;
            playstyleData.likes.splice(btn.dataset.idx, 1); renderForm(); triggerSync();
        }));
        container.querySelectorAll('.btn-del-dislike').forEach(btn => btn.addEventListener('click', async () => {
            if (!(await window.confirmDelete('Delete this line?'))) return;
            playstyleData.dislikes.splice(btn.dataset.idx, 1); renderForm(); triggerSync();
        }));

        container.querySelector('#btn-add-like').addEventListener('click', () => {
            playstyleData.likes.push(""); renderForm(); triggerSync();
        });
        container.querySelector('#btn-add-dislike').addEventListener('click', () => {
            playstyleData.dislikes.push(""); renderForm(); triggerSync();
        });
    };
    renderForm();
}
