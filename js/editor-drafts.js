/**
 * Dogslamloop Wiki - Editor: Local Draft System (auto-save to localStorage,
 * the Draft Manager modal)
 */

// What a draft holds, for the auto-save and for Save (v1.1) alike.
function editorDraftPayload() {
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
    return {
        timestamp: Date.now(),
        charId: window.currentEditorCharId,
        // The page's type, so RESUME opens a system or tool page as one: the
        // link carried no type before v1.1, and the editor reads a missing
        // type as a character page.
        pageType: window.currentEditorPageType || 'character',
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
}

// --- LOCAL AUTO-SAVE ENGINE ---
window.saveLocalDraft = function() {
    if (!window.currentEditorCharId) return;
    // Not while editing a submission (v1.1). The draft key is the page's, and a
    // submission's content saved under it came back later as "restore your
    // local progress?" on the page's own editor, where restoring it and
    // pressing Submit sent the whole submission a second time. A submission is
    // already saved in the queue; a draft of it is never offered back anyway.
    if (window.activeEditTicketId) return;

    const draftKey = `wiki_draft_${window.currentEditorCharId}`;
    try {
        localStorage.setItem(draftKey, JSON.stringify(editorDraftPayload()));
        window.currentDraftKey = draftKey;
    } catch (e) {
        console.warn("Auto-Save Failed: LocalStorage is full. Please discard old drafts in the Draft Manager.");
    }
};

// --- SAVE (v1.1) ---
//
// Owner, 2026-10-19: Sync and Save become two buttons, and Save writes "its
// own independent slot in Drafts". One slot per page, beside the auto-save,
// which keeps running: AUTO-SAVED is the latest edit, SAVED is the version the
// editor chose to keep. Its own key prefix, so nothing that reads the
// auto-save (the restore prompt on opening a page) takes it for one.
const SAVED_DRAFT_PREFIX = 'wiki_save_';

window.saveWorkspace = async function () {
    if (!window.currentEditorCharId) return false;
    // The same rule as the auto-save above.
    if (window.activeEditTicketId) {
        window.editorAlert('This is a submission, and the review queue keeps it already. UPDATE SUBMISSION sends your changes to it.');
        return false;
    }
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    try {
        localStorage.setItem(`${SAVED_DRAFT_PREFIX}${window.currentEditorCharId}`, JSON.stringify(editorDraftPayload()));
    } catch (e) {
        window.editorAlert('Could not save: this browser\'s storage is full. Discard old drafts in Drafts first.');
        return false;
    }
    const btn = document.getElementById('btn-save');
    if (btn) {
        btn.textContent = 'Saved!';
        clearTimeout(btn.savedTimer);
        btn.savedTimer = setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    }
    return true;
};

// --- LOCAL DRAFT MANAGER HUB ---
const DRAFT_KINDS = [
    { prefix: 'wiki_draft_', kind: 'auto', label: 'AUTO-SAVED', stamp: 'Last Auto-Saved' },
    { prefix: SAVED_DRAFT_PREFIX, kind: 'saved', label: 'SAVED', stamp: 'Saved' },
];
// The rows on screen, for the RESUME and DISCARD listener.
let draftManagerRows = [];

window.openDraftManager = function() {
    const container = document.getElementById('draft-list-container');
    const drafts = [];
    const esc = (s) => window.escapeHtml(String(s));

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const kind = DRAFT_KINDS.find(k => key.startsWith(k.prefix));
        if (!kind) continue;
        try {
            const data = JSON.parse(localStorage.getItem(key));
            const charId = String(data.charId || key.slice(kind.prefix.length).split('_')[0]);
            const tabId = String(data.tabId || 'overview');
            const moveId = String(data.moveId || '');
            const pageType = typeof data.pageType === 'string' ? data.pageType : '';
            drafts.push({ key, kind, charId, tabId, moveId, pageType, timestamp: Number(data.timestamp) || 0 });
        } catch (e) {
            console.warn(`[Drafts] Skipped an unreadable draft: ${key}`);
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

            // A saved version is never the one on screen: the auto-save is.
            const isCurrent = draft.kind.kind === 'auto' && (window.currentEditorCharId === draft.charId) && (currentTab === draft.tabId) && (currentMove === draft.moveId);

            // --- DRAFT UI ---
            // Everything here came out of localStorage, so it is escaped, and
            // the buttons carry the key as data for the listener below rather
            // than inside an onclick.
            html += `
                <div class="draft-row draft-row-${draft.kind.kind}">
                    <div>
                        <div class="draft-row-label">${draft.kind.label}</div>
                        <div class="draft-row-title">${esc(charDisplay)} <span class="draft-row-context">[ ${esc(contextDisplay)} ]</span></div>
                        <div class="draft-row-timestamp">${draft.kind.stamp}: ${esc(dateStr)}</div>
                    </div>
                    <div class="draft-row-actions">
                        ${!isCurrent ?
                            `<button class="submit-btn draft-resume-btn" data-draft-resume="${esc(draft.key)}">RESUME</button>` :
                            `<span class="draft-active-badge">CURRENTLY ACTIVE</span>`
                        }
                        <button class="btn-action-delete draft-discard-btn" data-draft-discard="${esc(draft.key)}">DISCARD</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    if (!container.dataset.wired) {
        container.dataset.wired = '1';
        container.addEventListener('click', onDraftListClick);
    }
    draftManagerRows = drafts;
    document.getElementById('draft-manager-modal').classList.remove('hidden');
};

async function onDraftListClick(e) {
    const discard = e.target.closest('[data-draft-discard]');
    if (discard) { window.deleteDraft(discard.getAttribute('data-draft-discard')); return; }

    const resume = e.target.closest('[data-draft-resume]');
    if (!resume) return;
    const key = resume.getAttribute('data-draft-resume');
    const draft = draftManagerRows.find(d => d.key === key);
    if (!draft) return;

    // Reopening this page's own saved version replaces what is on screen. The
    // auto-save keeps it until the first edit to the saved version.
    if (draft.kind.kind === 'saved' && draft.charId === window.currentEditorCharId) {
        const ok = await window.customConfirm('Open the version you saved?\n\nWhat is on screen now stays in AUTO-SAVED until you edit the saved version.', 'OPEN SAVED', false);
        if (!ok) return;
    }

    const params = new URLSearchParams({ char: draft.charId, tab: draft.tabId, loadDraft: 'true', draftKey: draft.key });
    if (draft.moveId) params.set('move', draft.moveId);
    if (draft.pageType && draft.pageType !== 'character') params.set('type', draft.pageType);
    window.location.href = `?${params.toString()}`;
}

window.deleteDraft = async function(key) {
    if (await window.confirmDelete("Permanently discard this local draft? This cannot be undone.", "DISCARD DRAFT")) {
        localStorage.removeItem(key);
        window.openDraftManager();
    }
};
