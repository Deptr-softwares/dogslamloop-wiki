/**
 * Dogslamloop Wiki - Editor: Local Draft System (auto-save to localStorage,
 * the Draft Manager modal)
 */

// --- LOCAL AUTO-SAVE ENGINE ---
window.saveLocalDraft = function() {
    if (!window.currentEditorCharId) return;

    const tabId = window.currentEditorTabId || 'overview';
    let moveId = '';

    const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
    if (activeBtn && activeBtn.id.startsWith('move-nav-')) {
        moveId = activeBtn.id.replace('move-nav-', '');
    } else if (new URLSearchParams(window.location.search).get('move')) {
        moveId = new URLSearchParams(window.location.search).get('move');
    }

    // Scoped per-character, not per-tab/move (fixed 2026-08-02). This is the
    // single source of truth for the key shape - window.currentEditorDescData
    // is always the FULL character object regardless of which tab is active,
    // so a per-tab/move key just created a new, never-swept localStorage entry
    // every time the user switched tabs within one session, leaving stale
    // duplicates behind that only ever got cleaned up if the user happened to
    // submit while that exact tab/move was still the active one. tabId/moveId
    // are still recorded in the payload below so resuming a draft can jump
    // back to the last-active tab - it just can't offer a *choice* of which
    // earlier tab to resume into anymore, since there's only one draft per
    // character now, not one per tab visited.
    const draftKey = `wiki_draft_${window.currentEditorCharId}`;

    const draftData = {
        timestamp: Date.now(),
        charId: window.currentEditorCharId,
        tabId: tabId,
        moveId: moveId,
        // The master, not the slice. On a character with ultimate states
        // currentEditorDescData is a view onto one of them, and saving that
        // would restore a draft containing only that state - silently losing
        // the base kit and every other state the moment it was reloaded.
        // Identical objects for a character with no states.
        desc_data: window.editorMasterDescData || window.currentEditorDescData,
        frame_data: window.editorMasterFrameData || window.currentEditorFrameData,
        mode: window.editorActiveMode || null
    };

    try {
        localStorage.setItem(draftKey, JSON.stringify(draftData));
        window.currentDraftKey = draftKey;
    } catch (e) {
        console.warn("Auto-Save Failed: LocalStorage is full. Please discard old drafts in the Draft Manager.");
    }
};

// --- LOCAL DRAFT MANAGER HUB ---
window.openDraftManager = function() {
    const container = document.getElementById('draft-list-container');
    const drafts = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('wiki_draft_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                const charId = data.charId || key.replace('wiki_draft_', '').split('_')[0];
                const tabId = data.tabId || 'overview';
                const moveId = data.moveId || '';
                drafts.push({ key, charId, tabId, moveId, timestamp: data.timestamp });
            } catch(e) {}
        }
    }

    drafts.sort((a, b) => b.timestamp - a.timestamp);

    if (drafts.length === 0) {
        container.innerHTML = '<div class="draft-empty-msg">No local drafts found. Your workspace is clean!</div>';
    } else {
        let html = '';
        drafts.forEach(draft => {
            const dateStr = new Date(draft.timestamp).toLocaleString();
            const charDisplay = draft.charId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

            let contextDisplay = draft.tabId.toUpperCase();
            if (draft.moveId) contextDisplay += ` / ${draft.moveId.toUpperCase()}`;

            const currentTab = window.currentEditorTabId || 'overview';
            let currentMove = new URLSearchParams(window.location.search).get('move') || '';
            if (!currentMove) {
                const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                if (activeBtn && activeBtn.id.startsWith('move-nav-')) currentMove = activeBtn.id.replace('move-nav-', '');
            }

            const isCurrent = (window.currentEditorCharId === draft.charId) && (currentTab === draft.tabId) && (currentMove === draft.moveId);

            let resumeUrl = `?char=${draft.charId}&tab=${draft.tabId}&loadDraft=true&draftKey=${draft.key}`;
            if (draft.moveId) resumeUrl += `&move=${draft.moveId}`;

            // --- DRAFT UI ---
            html += `
                <div class="draft-row">
                    <div>
                        <div class="draft-row-label">DRAFT ${drafts.length - drafts.indexOf(draft)}</div>
                        <div class="draft-row-title">${charDisplay} <span class="draft-row-context">— [ ${contextDisplay} ]</span></div>
                        <div class="draft-row-timestamp">Last Auto-Saved: ${dateStr}</div>
                    </div>
                    <div class="draft-row-actions">
                        ${!isCurrent ?
                            `<button class="submit-btn draft-resume-btn" onclick="window.location.href='${resumeUrl}'">RESUME</button>` :
                            `<span class="draft-active-badge">CURRENTLY ACTIVE</span>`
                        }
                        <button class="btn-action-delete draft-discard-btn" onclick="window.deleteDraft('${draft.key}')">DISCARD</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    document.getElementById('draft-manager-modal').classList.remove('hidden');
};

window.deleteDraft = async function(key) {
    if (await window.customConfirm("Permanently discard this local draft? This cannot be undone.", "DISCARD DRAFT", true)) {
        localStorage.removeItem(key);
        window.openDraftManager();
    }
};
