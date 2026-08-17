/**
 * Dogslamloop Wiki - Editor: Character Tab Editor + Sub-navigation
 * (custom/extra tabs, moves, matchups, counterplay, profile/playstyle)
 */

// --- MAJOR TAB NAVIGATION ---
// The editor had no way to change major tab at all: currentEditorTabId was
// read from ?tab= once at boot (js/editor-core.js) and never moved again.
// Landing on the wrong tab - which is what every intercept of a non-delta
// ticket did - meant hand-editing the URL or giving up, so intercepting a
// skill revision was effectively impossible. This is the same strip, in the
// same shape, as the live character page's nav.
// Includes ultimateAtk: unlike admin.html, edit.html ships that button in its
// static markup (hidden), and js/editor-modes.js un-hides it for a base-only
// character. Gallery is excluded because it has no editor at all.
const EDITOR_MAJOR_TABS = window.getCharacterTabIds({ includeInjected: true, editableOnly: true });

window.renderEditorTabNav = function(activeTabId) {
    const nav = document.getElementById('editor-tab-nav');
    if (!nav) return;

    // System, tierlist and gallery pages bail out of initFullTabEditor into
    // their own builders, which manage their own tabs - a character strip
    // above them would offer tabs those page types do not have. Gallery was
    // missing from this list when the type shipped, so its editor showed six
    // character tabs that did nothing.
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

window.switchEditorTab = async function(tabId) {
    if (tabId === window.currentEditorTabId) return;

    // currentStrategyBlocks is a buffer that is only written back into
    // desc_data on sync (js/editor-sync.js), so switching without flushing
    // first silently drops whatever is being edited right now.
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

    // Clear the sub-selection state before crossing the boundary. All three
    // sub-tab loaders below flush the *previous* selection's blocks into
    // desc_data on entry - so arriving at Overview with a stale
    // currentOverviewSection of 'strategy' would write the matchup blocks
    // still sitting in the buffer into descData.strategy. The flush above
    // has already saved the real content by this point.
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentKeyedIndex = {};

    // The preview pane keeps one visible tab; editor-core un-hides only the
    // booted one, so the switch has to move it.
    const previousPreviewTab = document.getElementById(`tab-${window.currentEditorTabId}`);
    if (previousPreviewTab) previousPreviewTab.classList.add('hidden');
    const nextPreviewTab = document.getElementById(`tab-${tabId}`);
    if (nextPreviewTab) nextPreviewTab.classList.remove('hidden');

    window.renderEditorTabNav(tabId);
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);

    // Keep the URL honest - the editor boots from ?tab=, so a reload should
    // land where the strip says it is. A leftover &move= would reopen a move
    // belonging to the tab just left.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    url.searchParams.delete('move');
    window.history.replaceState({}, '', url);
};

// --- CUSTOM TAB MANAGEMENT ---
window.addExtraTab = async function() {
    await window.triggerManualSync();
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: "New Tab", content: [] });

    if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
    initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    loadOverviewSectionIntoEditor(`extra-${window.currentEditorDescData.extras.length - 1}`);
};

window.removeExtraTab = async function(idx) {
    if (await window.customConfirm("Delete this custom tab and all its contents?")) {
        await window.triggerManualSync();
        window.currentEditorDescData.extras.splice(idx, 1);
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

function initFullTabEditor(charId, tabId, descData, frameData) {
    const builder = document.getElementById('interactive-builder');

    window.currentEditorFrameData = frameData;
    window.currentEditorDescData = descData || {};
    window.currentEditorTabId = tabId;
    window.currentEditorCharId = charId;

    // Every entry point into a major tab lands here, including the boot
    // route in editor-core.js, so the strip stays in step with the URL.
    if (typeof window.renderEditorTabNav === 'function') window.renderEditorTabNav(tabId);

    // --- Reroute to the Gallery bin ---
    // Before the system branch: a gallery is a flat list of media with names,
    // not tabs of blocks, and routing it through the block editor would be
    // three screens of machinery for two fields.
    if (window.currentEditorPageType === 'gallery') {
        if (typeof window.renderGalleryEditor === 'function') window.renderGalleryEditor(builder);
        return;
    }

    // --- Reroute to the Tool setup ---
    // A tool page is a link or an app plus two blocks of prose, not tabs of
    // sections - routing it through the system builder would offer a tab
    // structure the renderer never reads.
    if (window.currentEditorPageType === 'tool') {
        if (typeof window.renderToolEditor === 'function') window.renderToolEditor(builder);
        return;
    }

    // --- Reroute to the new System Builder UI ---
    if (window.currentEditorPageType === 'system') {
        if (window.currentSystemTabIdx === undefined) {
            // Read the URL parameter so "EDIT TAB" opens the exact custom tab you clicked!
            const foundIdx = (window.currentEditorDescData.tabs || []).findIndex(t => t.tabId === tabId);
            window.currentSystemTabIdx = foundIdx > -1 ? foundIdx : 0;
        }
        if (window.currentSystemSecIdx === undefined) window.currentSystemSecIdx = 0;
        window.renderSystemEditor(builder);
        return;
    } else if (window.currentEditorPageType === 'tierlist') {
        // 1. Lock the builder strictly to the sidebar!
        if (typeof window.initTierListEditor === 'function') {
            window.initTierListEditor(builder.id, window.currentEditorDescData);
        }

        // 2. Kill the Live Preview pane and replace it with a static notice
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

    // Note: window.currentEditor* was previously assigned a second time here,
    // byte-identical to the assignment at the top of this function - a
    // Gemini copy-paste leftover (neither the system nor tierlist branch
    // above touches these vars, so it was pure dead weight). Removed
    // 2026-08-02, same bug class as admin.js's duplicated getTabData.
    if (frameTabs.includes(tabId)) {
        const moves = frameData ? (frameData[tabId] || []) : [];

        let navHTML = window.reorderStripControls(`frame.${tabId}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        if (moves.length === 0) {
            navHTML += `<span class="daw-empty-state">No moves mapped in this category yet.</span>`;
        } else {
            moves.forEach((m, idx) => {
                navHTML += `<div class="daw-tab-item">`;
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable ${idx === 0 ? 'active' : ''}" id="move-nav-${m.id}" onclick="loadMoveIntoEditor('${m.id}')">${m.name || m.id}</button>`;
                // Item 8: a move could only be appended, so putting one next to
                // Skill 1 meant re-entering every skill after it.
                navHTML += `<button class="daw-tab-remove-btn" onclick="window.removeMove('${m.id}')" title="Remove Move">✖</button>`;
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
            navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="overview-nav-extra-${idx}" onclick="loadOverviewSectionIntoEditor('extra-${idx}')">${ext.title}</button>`;
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
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="matchup-nav-${idx}" onclick="window.loadMatchupIntoEditor(${idx})">vs. ${muName}</button>`;
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

    } else if (tabId === 'combos') {
        // The Combos tab is a document of three parts, so its editor is a
        // sub-tab strip like the Overview tab's - not a list of entries.
        //
        //   [ Read First ] [ Combo List ] [ True Combos x ] [ + GROUP ]
        //
        // Same daw-tab-btn strip, same removable-extra affordance, same single
        // swapping container.
        const groups = window.getKeyedSectionByField('comboGroups');
        const intro = (window.FIXED_BLOCK_SECTIONS || []).find(f => f.field === 'comboIntro');
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

        if (!window.currentEditorDescData[intro.field]) window.currentEditorDescData[intro.field] = [];
        if (!window.currentEditorDescData[groups.field]) window.currentEditorDescData[groups.field] = [];

        let navHTML = window.reorderStripControls(`desc.${groups.field}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        navHTML += `<button class="daw-tab-btn active" id="combos-nav-intro" onclick="window.loadCombosSectionIntoEditor('intro')">${esc(intro.label)}</button>`;
        navHTML += `<button class="daw-tab-btn" id="combos-nav-list" onclick="window.loadCombosSectionIntoEditor('list')">Combo List</button>`;

        window.currentEditorDescData[groups.field].forEach((group, idx) => {
            // Escaped: a group title is contributor text reaching innerHTML.
            const name = group[groups.keyField] || `Group ${idx + 1}`;
            navHTML += `<div class="daw-tab-item">`;
            navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="combos-nav-group-${idx}" onclick="window.loadCombosSectionIntoEditor('group-${idx}')">${esc(name)}</button>`;
            navHTML += `<button class="daw-tab-remove-btn" onclick="window.removeComboGroup(${idx})" title="Remove Group">&#10006;</button>`;
            navHTML += `</div>`;
        });

        window.registerInserter(`desc.${groups.field}`, () => window.addComboGroup());
        navHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addComboGroup()">+ GROUP</button>`;
        navHTML += `</div>`;

        builder.innerHTML = `
            ${navHTML}
            <div id="combos-editor-container"></div>
        `;

        window.loadCombosSectionIntoEditor(window.currentCombosSection || 'intro');

    } else if (window.usesSharedKeyedUI(tabId)) {
        // Every keyed section except matchups, which keeps its own editor -
        // its entry picker lists the roster and its metadata is a tier, so it
        // is a different screen rather than this one with different words.
        //
        // This was the counterplay branch with 'counterplay' written through
        // it. Starter Guide is the same shape, and the owner asked for exactly
        // that, so it runs here rather than as a third copy.
        const section = window.getKeyedSectionByTab(tabId);
        if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
        const entries = window.currentEditorDescData[section.field];

        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
        const noun = section.entryLabel;

        let navHTML = window.reorderStripControls(`desc.${section.field}`);
        navHTML += `<div class="daw-variant-tabs daw-editor-nav-row">`;
        if (entries.length === 0) {
            navHTML += `<span class="daw-empty-state">No ${esc(noun.toLowerCase())} entries defined yet.</span>`;
        } else {
            entries.forEach((entry, idx) => {
                // Escaped: the name is contributor-authored and lands in
                // innerHTML. The index is a number this loop produced, which is
                // why it may sit in the inline handler while the name may not.
                const name = entry[section.keyField] || `${noun} ${idx + 1}`;
                navHTML += `<div class="daw-tab-item">`;
                navHTML += `<button class="daw-tab-btn daw-tab-btn-removable" id="${section.tab}-nav-${idx}" onclick="window.loadKeyedEntryIntoEditor('${section.tab}', ${idx})">${esc(name)}</button>`;
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

window.addMove = async function() {
    // 1. Force the user to define the exact ID
    const newMoveMeta = await window.promptForMoveId();
    if (!newMoveMeta) return; // User cancelled

    await window.triggerManualSync();
    const tabId = window.currentEditorTabId;

    // 2. Ensure arrays exist
    if (!window.currentEditorFrameData) window.currentEditorFrameData = {};
    if (!window.currentEditorFrameData[tabId]) window.currentEditorFrameData[tabId] = [];
    if (!window.currentEditorDescData.moveStrategies) window.currentEditorDescData.moveStrategies = {};

    // 3. Inject a fresh, blank move template using their chosen ID
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

    // 4. Reload the UI and instantly switch to the new move
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMoveIntoEditor(newMoveMeta.id);
};

window.removeMove = async function(moveId) {
    if (await window.customConfirm("Delete this entire move (stats, frame data, and strategy)?")) {
        await window.triggerManualSync();
        const tabId = window.currentEditorTabId;
        const arr = window.currentEditorFrameData[tabId];

        // 1. Delete from Frame Data
        const idx = arr.findIndex(m => m.id === moveId);
        if (idx > -1) arr.splice(idx, 1);

        // 2. Delete from Description Data
        if (window.currentEditorDescData.moveStrategies && window.currentEditorDescData.moveStrategies[moveId]) {
            delete window.currentEditorDescData.moveStrategies[moveId];
        }

        // 3. CRITICAL: Immediately purge the deleted move from the Live Preview DOM
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
        if (previewCard) previewCard.remove();

        // 4. Reload the UI
        initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    }
};

// --- MOVE ID GATEKEEPER ---
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
                    <button id="btn-move-cancel" class="system-page-btn">CANCEL</button>
                    <button id="btn-move-confirm" class="submit-btn submit-btn-green-outline">INITIALIZE</button>
                </div>
            </div>
        `;

        overlay.classList.remove('hidden');

        // Auto-fill the Technical ID based on what they type in the Name box
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

            // Failsafe: Prevent duplicate IDs inside the same tab
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

// --- SUB-NAVIGATION: OVERVIEW ---
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
                previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                <input type="text" class="editor-input editor-extra-title-input" value="${sectionTitle}" oninput="window.updateExtraTabTitle(${idx}, this.value)" placeholder="Custom Tab Name">
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
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.style.outline = '2px solid var(--accent-blue)';
            previewCard.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// --- SUB-NAVIGATION: MATCHUPS ---
window.addMatchup = async function() {
    await window.triggerManualSync();
    window.currentEditorDescData.matchups.push({
        opponent: "New Character", tier: "Equal", content: [], author: ""
    });
    initFullTabEditor(window.currentEditorCharId, 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMatchupIntoEditor(window.currentEditorDescData.matchups.length - 1);
};

window.removeMatchup = async function(idx) {
    if (await window.customConfirm("Delete this entire matchup?")) {
        window.currentEditorDescData.matchups.splice(idx, 1);
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

// --- SUB-NAVIGATION: KEYED SECTIONS (Counterplay, Starter Guide) ---
//
// One set of functions for every keyed section, taking the tab id. The
// per-section index lives in window.currentKeyedIndex rather than a
// currentCounterplayIndex / currentStarterGuideIndex pair, because the flush
// in js/editor-sync.js has to find it too, and a second global is a second
// thing to remember on every code path that switches away from a tab.

window.currentKeyedIndex = window.currentKeyedIndex || {};

window.addKeyedEntry = async function(tabId) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;
    await window.triggerManualSync();

    const entry = { [section.keyField]: `New ${section.entryLabel}`, content: [], author: "" };
    // Only if the section HAS metadata. Starter Guide deliberately has none,
    // and writing an empty field would put data in the payload that nothing
    // reads and that the reviewer's diff would then report as a change.
    if (section.metaField) entry[section.metaField] = Object.keys(section.metaColors || {})[2] || '';

    if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
    window.currentEditorDescData[section.field].push(entry);

    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadKeyedEntryIntoEditor(tabId, window.currentEditorDescData[section.field].length - 1);
};

window.removeKeyedEntry = async function(tabId, idx) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;
    if (await window.customConfirm(`Delete this entire ${section.entryLabel.toLowerCase()}?`)) {
        window.currentEditorDescData[section.field].splice(idx, 1);
        // The open entry may have been the one removed, or may have shifted
        // down. Either way the stored index no longer means what it did, and
        // the flush on the next switch would write blocks into the wrong entry.
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
        // textContent, not innerHTML - this runs on every keystroke of a field
        // the contributor is typing into.
        if (btn) btn.textContent = value || `Unknown ${section.entryLabel}`;
    }
    window.renderKeyedSectionPreview(tabId);
};

// --- COMBO ROWS (v0.15 item 3) ---
//
// Row fields come from window.COMBO_COLUMNS (js/description.js) plus the two
// resource fields, so a column added to the table appears in the editor
// without a second edit - the same rule the tab vocabulary and the keyed
// sections follow.
window.comboRowFields = function () {
    const columns = (window.COMBO_COLUMNS || []).filter(c => c.field !== 'sequence');
    return [
        { field: 'sequence', label: 'Route', hint: 'One step per line' },
        ...columns.map(c => ({ field: c.field, label: c.label })),
        // Rendered above the notes on the page rather than as columns, so they
        // sit at the end of the form where the notes are.
        { field: 'ultGain', label: 'Ult Gain' },
        { field: 'evasiveGain', label: 'Evasive Gain' },
    ];
};

function comboRowSummary(row) {
    const steps = Array.isArray(row.sequence) ? row.sequence : [];
    if (steps.length) return steps.join(' > ');
    return row.damage ? `(${row.damage})` : 'Empty combo';
}

// --- SUB-NAVIGATION: THE COMBOS TAB ---
//
// Mirrors loadOverviewSectionIntoEditor: one swapping container, one active
// button, and the block buffer flushed before leaving whatever was open.

window.loadCombosSectionIntoEditor = function (sectionId) {
    const groups = window.getKeyedSectionByField('comboGroups');
    const intro = (window.FIXED_BLOCK_SECTIONS || []).find(f => f.field === 'comboIntro');
    const container = document.getElementById('combos-editor-container');
    if (!groups || !intro || !container) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

    // Flush the section being left, or its blocks are lost. currentStrategyBlocks
    // is only written back into desc_data on sync.
    flushCombosSection();

    document.querySelectorAll('[id^="combos-nav-"]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`combos-nav-${sectionId}`);
    if (activeBtn) activeBtn.classList.add('active');
    window.currentCombosSection = sectionId;

    if (sectionId === 'list') {
        container.innerHTML = `<div id="combo-rows-panel"></div>`;
        window.renderComboListEditor();
        window.renderCombosPreview();
        return;
    }

    if (sectionId === 'intro') {
        container.innerHTML = `
            <div class="editor-section-banner">
                <span class="editor-section-banner-text">${esc(intro.label.toUpperCase())}</span>
            </div>
            <div id="strategy-block-target"></div>
        `;
        initStrategyBlockBuilder('strategy-block-target', window.currentEditorDescData[intro.field] || []);
        window.renderCombosPreview();
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
                        <input type="text" class="editor-input" value="${esc(group[groups.keyField] || '')}"
                               oninput="window.updateComboGroupTitle(${idx}, this.value)"
                               placeholder="e.g. True Combos">
                    </div>
                </div>
            </div>
        </div>
        <div class="editor-section-banner">
            <span class="editor-section-banner-text">COMBO CARDS</span>
        </div>
        <div id="combo-cards-panel"></div>
    `;

    // A group is a list of CARDS, and the block builder edits the write-up of
    // whichever card is open - not the group itself.
    //
    // Owner, 2026-08-16: "you should not be able to Add Blocks when you
    // haven't selected a TheoryBox". Mounting the builder on group.content
    // offered a bare block toolbar with nothing to attach a block to, and a
    // block added there became a sibling of the cards rather than part of one.
    window.currentComboCardIndex = undefined;
    window.renderComboCardsPanel(idx);
    window.renderCombosPreview();
};

// The cards inside one combo group, and the write-up editor for the open one.
window.renderComboCardsPanel = function (groupIdx) {
    const groups = window.getKeyedSectionByField('comboGroups');
    const host = document.getElementById('combo-cards-panel');
    if (!groups || !host) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    const group = (window.currentEditorDescData[groups.field] || [])[groupIdx];
    if (!group) return;
    if (!Array.isArray(group.content)) group.content = [];

    const cards = group.content;
    const open = window.currentComboCardIndex;

    let html = `<div class="daw-variant-tabs daw-editor-nav-row">`;
    if (cards.length === 0) {
        html += `<span class="daw-empty-state">No combo cards in this group yet.</span>`;
    } else {
        cards.forEach((card, i) => {
            // A card is recognised by its name, and falls back to its route -
            // an index is not something anyone remembers.
            const steps = Array.isArray(card.sequence) ? card.sequence : [];
            const label = card.title || steps.join(' > ') || `Card ${i + 1}`;
            html += `<div class="daw-tab-item">`;
            html += `<button class="daw-tab-btn daw-tab-btn-removable${i === open ? ' active' : ''}" data-card="${i}">${esc(label)}</button>`;
            html += `<button class="daw-tab-remove-btn" data-remove-card="${i}" title="Remove Card">&#10006;</button>`;
            html += `</div>`;
        });
    }
    html += `<button type="button" id="combo-card-add" class="daw-tab-btn daw-add-btn btn-sys btn-sys-green">+ CARD</button>`;
    html += `</div><div id="combo-card-body"></div>`;

    host.innerHTML = html;

    host.querySelectorAll('[data-card]').forEach(btn => {
        btn.addEventListener('click', () => {
            flushComboCard(groupIdx);
            window.currentComboCardIndex = parseInt(btn.getAttribute('data-card'), 10);
            window.renderComboCardsPanel(groupIdx);
        });
    });
    host.querySelectorAll('[data-remove-card]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.customConfirm('Delete this combo card and its write-up?'))) return;
            cards.splice(parseInt(btn.getAttribute('data-remove-card'), 10), 1);
            // The open card may have been the one removed, or shifted down.
            window.currentComboCardIndex = undefined;
            window.renderComboCardsPanel(groupIdx);
            window.renderCombosPreview();
        });
    });
    const addBtn = host.querySelector('#combo-card-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            flushComboCard(groupIdx);
            const card = window.spawnBlockWithAuthor
                ? window.spawnBlockWithAuthor('theorybox')
                : { type: 'theorybox', title: 'New Combo', sequence: [], content: [] };
            cards.push(card);
            window.currentComboCardIndex = cards.length - 1;
            window.renderComboCardsPanel(groupIdx);
            window.renderCombosPreview();
        });
    }

    renderComboCardBody(groupIdx, cards);
};

// The block buffer belongs to the open card's write-up. Only ever written back
// on a switch or a sync, same as every other block surface.
function flushComboCard(groupIdx) {
    const groups = window.getKeyedSectionByField('comboGroups');
    const idx = window.currentComboCardIndex;
    if (idx === undefined || typeof window.getActiveBlocks !== 'function') return;
    const group = (window.currentEditorDescData[groups.field] || [])[groupIdx];
    const card = group && Array.isArray(group.content) ? group.content[idx] : null;
    if (card) card.content = JSON.parse(JSON.stringify(window.getActiveBlocks()));
}
window.flushComboCard = flushComboCard;

function renderComboCardBody(groupIdx, cards) {
    const container = document.getElementById('combo-card-body');
    if (!container) return;

    const idx = window.currentComboCardIndex;
    const card = cards[idx];
    if (!card) {
        // No card open, so no block toolbar. This is the owner's point: an
        // ADD BLOCK with nothing selected has nowhere to put the block.
        container.innerHTML = `<p class="admin-tool-hint">Select a combo card to edit it, or add one.</p>`;
        return;
    }

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    const route = Array.isArray(card.sequence) ? card.sequence.join('\n') : '';
    const difficulties = ['', ...(window.COMBO_DIFFICULTIES || [])]
        .map(d => `<option value="${esc(d)}" ${card.difficulty === d ? 'selected' : ''}>${esc(d || '- none -')}</option>`)
        .join('');

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">COMBO CARD</span></div>
                <div class="combo-card-fields">
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">Name</label>
                        <input type="text" class="editor-input" data-card-field="title" value="${esc(card.title || '')}" placeholder="e.g. Corner BnB">
                    </div>
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">One line</label>
                        <input type="text" class="editor-input" data-card-field="oneliner" value="${esc(card.oneliner || '')}" placeholder="What this combo is for">
                    </div>
                    <div class="combo-field-full">
                        <label class="editor-field-label-sm">Route - one step per line</label>
                        <textarea class="editor-textarea" data-card-field="sequence" rows="4">${esc(route)}</textarea>
                    </div>
                    <div><label class="editor-field-label-sm">Damage</label>
                        <input type="text" class="editor-input" data-card-field="damage" value="${esc(card.damage || '')}" placeholder="e.g. 38-46"></div>
                    <div><label class="editor-field-label-sm">Difficulty</label>
                        <select class="editor-select" data-card-field="difficulty">${difficulties}</select></div>
                    <div><label class="editor-field-label-sm">Video</label>
                        <input type="text" class="editor-input" data-card-field="video" value="${esc(card.video || '')}" placeholder="Optional URL"></div>
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
            if (field === 'sequence') {
                // One step per line; blank lines dropped rather than becoming
                // empty chips in the route.
                card.sequence = input.value.split('\n').map(v => v.trim()).filter(Boolean);
            } else {
                card[field] = input.value;
            }
            if (field === 'title' || field === 'sequence') {
                const btn = document.querySelector(`[data-card="${idx}"]`);
                const steps = Array.isArray(card.sequence) ? card.sequence : [];
                // textContent, not innerHTML - this runs on every keystroke.
                if (btn) btn.textContent = card.title || steps.join(' > ') || `Card ${idx + 1}`;
            }
            window.renderCombosPreview();
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    // The builder edits THIS card's write-up.
    initStrategyBlockBuilder('strategy-block-target', card.content || []);
}

// Writes the block buffer back into whichever combos section is open.
function flushCombosSection() {
    const open = window.currentCombosSection;
    if (!open || open === 'list' || !window.currentEditorDescData) return;
    if (typeof window.getActiveBlocks !== 'function') return;

    const blocks = JSON.parse(JSON.stringify(window.getActiveBlocks()));
    if (open === 'intro') {
        window.currentEditorDescData.comboIntro = blocks;
        return;
    }
    // A group's buffer belongs to the open CARD's write-up, not to the group -
    // the group holds cards, and the builder is only ever mounted on one of
    // them. Writing `blocks` onto group.content here would replace every card
    // in the group with the open card's write-up.
    const idx = parseInt(String(open).replace('group-', ''), 10);
    flushComboCard(idx);
}
window.flushCombosSection = flushCombosSection;

window.renderCombosPreview = function () {
    if (typeof window.renderCombosTab !== 'function' || !window.currentEditorDescData) return;
    window.renderCombosTab(window.currentEditorDescData);
    // The preview has to be styled like the live page, or notation is coloured
    // for readers and plain for the person writing it. Without this the only
    // thing colouring the editor's chips was the MutationObserver happening to
    // catch them, which is why some steps came out coloured and others did not.
    if (typeof window.applyInternalStyling === 'function') {
        setTimeout(window.applyInternalStyling, 30);
    }
};

window.addComboGroup = async function () {
    const groups = window.getKeyedSectionByField('comboGroups');
    await window.triggerManualSync();
    if (!window.currentEditorDescData[groups.field]) window.currentEditorDescData[groups.field] = [];
    window.currentEditorDescData[groups.field].push({ [groups.keyField]: 'New Group', content: [] });
    initFullTabEditor(window.currentEditorCharId, 'combos', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadCombosSectionIntoEditor(`group-${window.currentEditorDescData[groups.field].length - 1}`);
};

window.removeComboGroup = async function (idx) {
    const groups = window.getKeyedSectionByField('comboGroups');
    if (!(await window.customConfirm('Delete this combo group and everything in it?'))) return;
    window.currentEditorDescData[groups.field].splice(idx, 1);
    // The open section may have been the one removed, or shifted down.
    window.currentCombosSection = 'intro';
    initFullTabEditor(window.currentEditorCharId, 'combos', window.currentEditorDescData, window.currentEditorFrameData);
    window.renderCombosPreview();
};

window.updateComboGroupTitle = function (idx, value) {
    const groups = window.getKeyedSectionByField('comboGroups');
    const group = (window.currentEditorDescData[groups.field] || [])[idx];
    if (!group) return;
    group[groups.keyField] = value;
    const btn = document.getElementById(`combos-nav-group-${idx}`);
    // textContent, not innerHTML - this runs on every keystroke.
    if (btn) btn.textContent = value || `Group ${idx + 1}`;
    window.renderCombosPreview();
};

// --- THE COMBO LIST EDITOR ---
// Tables keyed by starter, each holding rows. The rows themselves open in the
// modal (openComboRowModal below).
window.renderComboListEditor = function () {
    const section = window.getKeyedSectionByField('comboList');
    const host = document.getElementById('combo-rows-panel');
    if (!section || !host) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    if (!window.currentEditorDescData[section.field]) window.currentEditorDescData[section.field] = [];
    const tables = window.currentEditorDescData[section.field];

    const openTable = window.currentComboTableIndex;

    let html = `<div class="daw-variant-tabs daw-editor-nav-row">`;
    if (tables.length === 0) {
        html += `<span class="daw-empty-state">No starters defined yet.</span>`;
    } else {
        tables.forEach((t, i) => {
            html += `<div class="daw-tab-item">`;
            html += `<button class="daw-tab-btn daw-tab-btn-removable${i === openTable ? ' active' : ''}" data-table="${i}">${esc(t[section.keyField] || `Starter ${i + 1}`)}</button>`;
            html += `<button class="daw-tab-remove-btn" data-remove-table="${i}" title="Remove Starter">&#10006;</button>`;
            html += `</div>`;
        });
    }
    html += `<button type="button" id="combo-table-add" class="daw-tab-btn daw-add-btn btn-sys btn-sys-green">+ STARTER</button>`;
    html += `</div><div id="combo-table-body"></div>`;

    host.innerHTML = html;

    host.querySelectorAll('[data-table]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.currentComboTableIndex = parseInt(btn.getAttribute('data-table'), 10);
            window.renderComboListEditor();
        });
    });
    host.querySelectorAll('[data-remove-table]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.customConfirm('Delete this starter and all its combos?'))) return;
            tables.splice(parseInt(btn.getAttribute('data-remove-table'), 10), 1);
            window.currentComboTableIndex = undefined;
            window.renderComboListEditor();
            window.renderCombosPreview();
        });
    });
    const addTable = host.querySelector('#combo-table-add');
    if (addTable) {
        addTable.addEventListener('click', () => {
            tables.push({ [section.keyField]: 'New Starter', rows: [] });
            window.currentComboTableIndex = tables.length - 1;
            window.renderComboListEditor();
            window.renderCombosPreview();
        });
    }

    renderComboListRows(section, tables);
};

// Named renderComboListRows, NOT renderComboTableBody: description.js assigns
// window.renderComboTableBody, and a top-level `function` declaration here
// silently overwrites it. The reader then called this one with the wrong
// arguments and wrote a `rows: []` field into an individual combo. Every js/
// file shares one global scope - see tests/global-scope-collisions.spec.js.
function renderComboListRows(section, tables) {
    const container = document.getElementById('combo-table-body');
    if (!container) return;
    const idx = window.currentComboTableIndex;
    const table = tables[idx];
    if (!table) { container.innerHTML = ''; return; }

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    if (!Array.isArray(table.rows)) table.rows = [];

    let html = `<div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">STARTER</span></div>
                <div class="editor-row"><div>
                    <label class="editor-field-label-sm">Starter Name</label>
                    <input type="text" class="editor-input" id="combo-table-name" value="${esc(table[section.keyField] || '')}" placeholder="e.g. M1 Starters">
                </div></div>
            </div>
        </div>
        <div class="combo-rows-list">`;

    if (table.rows.length === 0) {
        html += `<p class="admin-tool-hint">No combos under this starter yet.</p>`;
    } else {
        table.rows.forEach((row, i) => {
            html += `<div class="combo-row-item">
                <button type="button" class="combo-row-open btn-sys btn-sys-regular" data-row="${i}">${esc(comboRowSummary(row || {}))}</button>
                <button type="button" class="combo-row-remove btn-sys btn-sys-red" data-row="${i}" title="Remove this combo">&#10006;</button>
            </div>`;
        });
    }
    html += `</div><button type="button" id="combo-row-add" class="btn-sys btn-sys-green">+ ADD COMBO</button>`;

    container.innerHTML = html;

    const nameInput = container.querySelector('#combo-table-name');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            table[section.keyField] = nameInput.value;
            const btn = document.querySelector(`[data-table="${idx}"]`);
            if (btn) btn.textContent = nameInput.value || `Starter ${idx + 1}`;
            window.renderCombosPreview();
        });
    }

    container.querySelectorAll('.combo-row-open').forEach(btn => {
        btn.addEventListener('click', () =>
            window.openComboRowModal(idx, parseInt(btn.getAttribute('data-row'), 10)));
    });
    container.querySelectorAll('.combo-row-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await window.customConfirm('Delete this combo?'))) return;
            table.rows.splice(parseInt(btn.getAttribute('data-row'), 10), 1);
            renderComboListRows(section, tables);
            window.renderCombosPreview();
        });
    });
    const addRow = container.querySelector('#combo-row-add');
    if (addRow) {
        addRow.addEventListener('click', () => {
            table.rows.push({ sequence: [], damage: '', difficulty: '', notes: '' });
            renderComboListRows(section, tables);
            window.renderCombosPreview();
            window.openComboRowModal(idx, table.rows.length - 1);
        });
    }
}

// The row form, in a modal rather than in the sidebar. Twelve fields do not
// fit a pane that is sharing the screen with a live preview.
window.openComboRowModal = function (tableIdx, rowIdx) {
    const section = window.getKeyedSectionByField('comboList');
    const modal = document.getElementById('combo-row-modal');
    const fields = document.getElementById('combo-row-modal-fields');
    if (!section || !modal || !fields) return;

    const table = (window.currentEditorDescData[section.field] || [])[tableIdx];
    const rows = table ? (table[section.rowsField] || []) : [];
    const row = rows[rowIdx];
    if (!row) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    window.currentComboRowIndex = rowIdx;

    const titleEl = document.getElementById('combo-row-modal-title');
    if (titleEl) titleEl.textContent = `EDIT COMBO ${rowIdx + 1}`;

    fields.innerHTML = window.comboRowFields().map(f => {
        if (f.field === 'sequence') {
            const value = Array.isArray(row.sequence) ? row.sequence.join('\n') : '';
            return `<div class="combo-field-full">
                <label class="editor-field-label-sm">${esc(f.label)}<span class="admin-tool-hint"> - ${esc(f.hint)}</span></label>
                <textarea class="editor-textarea" data-combo-field="sequence" rows="5">${esc(value)}</textarea>
            </div>`;
        }
        if (f.field === 'difficulty') {
            // A select, because difficulty is an ordinal enum: a typo sorts the
            // row to the bottom silently (comboSortValue ranks an unrecognised
            // value last) rather than showing an error anywhere.
            const options = ['', ...(window.COMBO_DIFFICULTIES || [])]
                .map(d => `<option value="${esc(d)}" ${row.difficulty === d ? 'selected' : ''}>${esc(d || '- none -')}</option>`)
                .join('');
            return `<div><label class="editor-field-label-sm">${esc(f.label)}</label>
                <select class="editor-select" data-combo-field="difficulty">${options}</select></div>`;
        }
        if (f.field === 'notes') {
            return `<div class="combo-field-full">
                <label class="editor-field-label-sm">${esc(f.label)}</label>
                <textarea class="editor-textarea" data-combo-field="notes" rows="3">${esc(row.notes || '')}</textarea>
            </div>`;
        }
        return `<div><label class="editor-field-label-sm">${esc(f.label)}</label>
            <input type="text" class="editor-input" data-combo-field="${esc(f.field)}" value="${esc(row[f.field] || '')}"></div>`;
    }).join('');

    // Live, on every keystroke: the preview behind the modal is the point of
    // having one, and a Save button that could be missed would let a
    // contributor close the modal having lost what they typed.
    fields.querySelectorAll('[data-combo-field]').forEach(input => {
        const handler = () => {
            const field = input.getAttribute('data-combo-field');
            if (field === 'sequence') {
                // One step per line. Blank lines are dropped rather than
                // becoming empty chips in the route.
                row.sequence = input.value.split('\n').map(s => s.trim()).filter(Boolean);
            } else {
                row[field] = input.value;
            }
            window.renderCombosPreview();
            const btn = document.querySelector(`.combo-row-open[data-row="${rowIdx}"]`);
            if (btn) btn.textContent = comboRowSummary(row);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    const close = () => {
        modal.classList.add('hidden');
        window.currentComboRowIndex = undefined;
        window.renderComboListEditor();
    };

    const done = document.getElementById('combo-row-modal-done');
    const del = document.getElementById('combo-row-modal-delete');
    // Replaced rather than added to, so reopening the modal does not stack a
    // second handler and delete two rows on one click.
    if (done) done.onclick = close;
    if (del) {
        del.onclick = async () => {
            if (!(await window.customConfirm('Delete this combo?'))) return;
            rows.splice(rowIdx, 1);
            close();
            window.renderCombosPreview();
        };
    }
    modal.onclick = (e) => { if (e.target === modal) close(); };

    modal.classList.remove('hidden');
};

window.loadKeyedEntryIntoEditor = function(tabId, idx) {
    const section = window.getKeyedSectionByTab(tabId);
    if (!section) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));
    const open = window.currentKeyedIndex[tabId];
    const list = window.currentEditorDescData[section.field] || [];

    // Flush the entry being left before switching away, or its blocks are lost.
    if (open !== undefined && list[open]) {
        list[open].content = JSON.parse(JSON.stringify(window.getActiveBlocks()));
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
            `<option value="${esc(t)}" ${entry[section.metaField] === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
        metaHTML = `
                    <div>
                        <label class="editor-field-label-sm">${esc(section.metaLabel || section.metaField)}</label>
                        <select class="editor-select" onchange="window.updateKeyedMeta('${section.tab}', ${idx}, '${esc(section.metaField)}', this.value)">
                            ${optionHTML}
                        </select>
                    </div>`;
    }

    container.innerHTML = `
        <div class="block-editor-container block-editor-container-tight">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">${esc(section.entryLabel.toUpperCase())} METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label class="editor-field-label-sm">${esc(section.entryLabel)} Name</label>
                        <input type="text" class="editor-input" value="${esc(entry[section.keyField] || '')}" oninput="window.updateKeyedMeta('${section.tab}', ${idx}, '${esc(section.keyField)}', this.value)" placeholder="${esc(section.placeholder || 'e.g. Dealing with M1s')}">
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
        const previewCard = document.querySelector(`.live-preview-pane #${section.tab}-content-${safeKey}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 100);
};

// --- MOVES ---
window.loadMatchupIntoEditor = function(idx) {
    if (window.currentMatchupIndex !== undefined && window.currentEditorDescData && window.currentEditorDescData.matchups[window.currentMatchupIndex]) {
        window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(window.getActiveBlocks()));
    }

    document.querySelectorAll('[id^="matchup-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`matchup-nav-${idx}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentMatchupIndex = idx;
    const matchup = window.currentEditorDescData.matchups[idx];
    const container = document.getElementById('matchup-editor-container');

    // Offered options come from the one definition in js/site_utils.js. The
    // stored value is resolved through it first, for two reasons: a matchup
    // written before the v0.13 rename still says "Unwinnable", and a matchup
    // whose tier is junk (one live entry reads "Aerial Circling tier") is not
    // in the list at all. In both cases an unresolved value would match no
    // option, so the browser would display the first one - showing a tier
    // nobody set, on a control that only writes when touched.
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
        const previewCard = document.querySelector(`.live-preview-pane #matchup-content-${(matchup.opponent||'').replace(/\s+/g, '-')}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// --- SUB-NAVIGATION: MOVES ---
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
        <div class="editor-section-banner editor-section-banner-spaced">
            <span class="editor-section-banner-text">1. STATS & FRAME DATA: ${moveStats?.name || moveId}</span>
        </div>
        <div id="daw-editor-target" class="daw-editor-target-spacing"></div>

        <div class="editor-section-banner">
            <span class="editor-section-banner-text">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initDawEditor('daw-editor-target', moveStats);
    initStrategyBlockBuilder('strategy-block-target', moveStrats || []);

    if (typeof window.triggerManualSync === 'function') {
        await window.triggerManualSync();
    }

    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
        if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
};

function initPerMoveEditor(moveId, statsData, strategyData) {
    const builder = document.getElementById('interactive-builder');
    builder.innerHTML = `
        <div class="editor-section-banner editor-section-banner-spaced">
            <span class="editor-section-banner-text">1. STATS & FRAME DATA</span>
        </div>
        <div id="daw-editor-target" class="daw-editor-target-spacing"></div>

        <div class="editor-section-banner">
            <span class="editor-section-banner-text">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initDawEditor('daw-editor-target', statsData);
    initStrategyBlockBuilder('strategy-block-target', strategyData || []);
    updateLivePreview();
}

// --- STRUCTURED-FORM SUPPORT (Profile / Playstyle) ---
// These two tabs edit a structured object rather than a block array, so they
// return early from loadOverviewSectionIntoEditor without ever reaching
// initBlockEditor - and with it they lost the Media Library button and the
// undo/redo stack every other editor tab has. Reported as two separate bugs;
// it is one gap, and this closes it for both tabs at once.

// Same markup and classes as the block editor's toolbar so the two are
// visually identical. No CLEAR ALL: there is no block list to clear, and
// wiping a whole profile from a toolbar button is not a thing anyone wants.
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

// A snapshot stack over a plain object, mirroring editor-blocks.js's block
// history (same 50-entry cap, same truncate-on-new-branch behaviour) but
// keyed on the form object, which is what these tabs actually edit.
// apply() receives the restored state and is responsible for writing it back
// and re-rendering.
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
        // Called after every re-render, because re-rendering replaces the
        // toolbar's buttons along with the rest of the form.
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
            // The gallery copies a URL to the clipboard on click rather than
            // writing back into a field, so it needs no target plumbing -
            // the same binding initBlockEditor uses.
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

    // Mutated in place rather than reassigned: the object identity is shared
    // with currentEditorDescData.profile.
    const history = createFormHistory(profileData, (restored) => {
        profileData.image = restored.image;
        profileData.stats = restored.stats || [];
        window.currentEditorDescData.profile = profileData;
        renderProfileForm();
        updateLivePreview();
    });

    const triggerSync = () => {
        window.currentEditorDescData.profile = profileData;
        clearTimeout(window.typingTimer);
        window.typingTimer = setTimeout(() => {
            // Snapshot on the same debounce as the preview, so typing a word
            // costs one history entry rather than one per keystroke.
            history.record(profileData);
            updateLivePreview();
        }, 400);
    };

    const renderProfileForm = () => {
        let statsHtml = '';
        profileData.stats.forEach((stat, idx) => {
            // Escaped: a reviewer intercepting a submission loads someone
            // else's data into this form, and an unescaped value= closes the
            // attribute on the first double quote.
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

                <div class="block-card">
                    <div class="block-header">
                        <span class="block-type-badge">CHARACTER STATS</span>
                        <button class="btn-sys btn-sys-green" id="btn-add-stat">+ ADD STAT</button>
                    </div>
                    <div id="profile-stats-container">${statsHtml}</div>
                </div>
            </div>
        `;

        bindStructuredFormToolbar(container, history);

        container.querySelector('#profile-image-input').addEventListener('input', (e) => {
            profileData.image = e.target.value; triggerSync();
            const preview = container.querySelector('#portrait-focus-img');
            if (preview) preview.src = e.target.value;
        });

        // Delegated, and the value comes from a whitelist rather than the
        // attribute being trusted - this string ends up inside a style
        // attribute on the live page.
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

        container.querySelectorAll('.btn-del-stat').forEach(btn => btn.addEventListener('click', (e) => {
            profileData.stats.splice(e.target.dataset.idx, 1); renderProfileForm(); triggerSync();
        }));

        container.querySelector('#btn-add-stat').addEventListener('click', () => {
            profileData.stats.push({ label: 'New Stat', value: 'Value' }); renderProfileForm(); triggerSync();
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
        // Escaped for the same reason as the profile form above - a reviewer
        // intercepting a submission renders someone else's text here.
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

        container.querySelectorAll('.btn-del-like').forEach(btn => btn.addEventListener('click', (e) => {
            playstyleData.likes.splice(e.target.dataset.idx, 1); renderForm(); triggerSync();
        }));
        container.querySelectorAll('.btn-del-dislike').forEach(btn => btn.addEventListener('click', (e) => {
            playstyleData.dislikes.splice(e.target.dataset.idx, 1); renderForm(); triggerSync();
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
