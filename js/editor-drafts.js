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

// "Boomcat" from boomcat, "Black Death" from black_death.
function draftPageName(charId) {
    return String(charId).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// --- WHAT THIS BROWSER HAS ALREADY SUBMITTED (v1.1) ---
//
// Owner, 2026-10-19: a successful Submit keeps every draft, and an editor who
// opens one again is warned instead. Submit records when the page was sent
// from this browser. A draft saved before that moment holds changes that are
// in the queue already, so sending it again would duplicate the submission.
const SUBMITTED_PREFIX = 'wiki_submitted_';

window.markPageSubmitted = function (pageId) {
    try {
        localStorage.setItem(`${SUBMITTED_PREFIX}${pageId}`, String(Date.now()));
    } catch (e) {
        console.warn('[Drafts] Could not record the submission time, so its drafts will not warn:', e);
    }
};

// When this browser submitted the page, if a draft saved at `timestamp` was
// saved before then; 0 if it was not.
window.draftSubmittedAt = function (pageId, timestamp) {
    let at = 0;
    try { at = Number(localStorage.getItem(`${SUBMITTED_PREFIX}${pageId}`)) || 0; } catch (e) { at = 0; }
    return at && (Number(timestamp) || 0) <= at ? at : 0;
};

window.duplicateDraftWarning = function (at) {
    return `This draft was saved before you submitted this page on ${new Date(at).toLocaleString()}. Submitting it again sends the same changes to the review queue a second time.`;
};

// --- FIVE AUTO-SAVES (v1.1) ---
//
// Owner, 2026-10-19, once Submit stopped clearing drafts: "a max limit of 5
// auto-save slots for every editor". Room is made when a page gets its first
// auto-save. One already submitted goes first, since its changes are in the
// queue; unsent work goes only when all five are unsent, the oldest first, and
// the editor is told which. SAVED versions are never dropped: the editor chose
// to keep them.
const AUTO_DRAFT_PREFIX = 'wiki_draft_';
const AUTO_SAVE_LIMIT = 5;

function makeRoomForAutoSave(draftKey) {
    if (localStorage.getItem(draftKey) !== null) return;
    const others = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(AUTO_DRAFT_PREFIX) || key === draftKey) continue;
        let data = null;
        try { data = JSON.parse(localStorage.getItem(key)); } catch (e) { data = null; }
        const pageId = String((data && data.charId) || key.slice(AUTO_DRAFT_PREFIX.length));
        const timestamp = Number(data && data.timestamp) || 0;
        others.push({ key, pageId, timestamp, submitted: !!window.draftSubmittedAt(pageId, timestamp) });
    }
    if (others.length < AUTO_SAVE_LIMIT) return;

    others.sort((a, b) => (Number(b.submitted) - Number(a.submitted)) || (a.timestamp - b.timestamp));
    const dropped = others.slice(0, others.length - (AUTO_SAVE_LIMIT - 1));
    dropped.forEach(d => localStorage.removeItem(d.key));

    const unsent = dropped.filter(d => !d.submitted);
    if (unsent.length && typeof window.editorAlert === 'function') {
        const which = unsent.map(d => `${draftPageName(d.pageId)} (auto-saved ${new Date(d.timestamp).toLocaleString()})`).join(', ');
        window.editorAlert(`This browser keeps ${AUTO_SAVE_LIMIT} auto-saves, so the oldest unsent one was removed to make room: ${which}. Save keeps a version until you discard it.`);
    }
}

// --- LOCAL AUTO-SAVE ENGINE ---
window.saveLocalDraft = function() {
    if (!window.currentEditorCharId) return;
    // The Playground's one draft, under its own key and outside the five
    // auto-save slots: practising on a page must never touch its real draft
    // (js/editor-playground.js).
    if (window.editorPlayground) {
        try {
            localStorage.setItem(window.editorPlayground.draftKey, JSON.stringify(editorDraftPayload()));
        } catch (e) {
            console.warn('[Playground] Could not keep the Playground in this browser:', e);
        }
        return;
    }
    // Not while editing a submission (v1.1). The draft key is the page's, and a
    // submission's content saved under it came back later as "restore your
    // local progress?" on the page's own editor, where restoring it and
    // pressing Submit sent the whole submission a second time. A submission is
    // already saved in the queue; a draft of it is never offered back anyway.
    if (window.activeEditTicketId) return;

    const draftKey = `${AUTO_DRAFT_PREFIX}${window.currentEditorCharId}`;
    try {
        makeRoomForAutoSave(draftKey);
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
    // Its button is hidden there; the Playground keeps itself.
    if (!window.currentEditorCharId || window.editorPlayground) return false;
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
    { prefix: AUTO_DRAFT_PREFIX, kind: 'auto', label: 'AUTO-SAVED', stamp: 'Last Auto-Saved' },
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
            const charDisplay = draftPageName(draft.charId);
            const submittedAt = window.draftSubmittedAt(draft.charId, draft.timestamp);

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
                        ${submittedAt ? `<div class="draft-row-submitted">Page submitted after this was saved: ${esc(new Date(submittedAt).toLocaleString())}</div>` : ''}
                    </div>
                    <div class="draft-row-actions">
                        ${!isCurrent ?
                            `<button class="btn-sys btn-sys-blue draft-resume-btn" data-draft-resume="${esc(draft.key)}">RESUME</button>` :
                            `<span class="draft-active-badge">CURRENTLY ACTIVE</span>`
                        }
                        <button class="btn-sys btn-sys-red draft-discard-btn" data-draft-discard="${esc(draft.key)}">DISCARD</button>
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

    // A draft of changes already in the queue warns first: opening it is
    // allowed, sending it again duplicates the submission.
    const submittedAt = window.draftSubmittedAt(draft.charId, draft.timestamp);
    if (submittedAt) {
        const ok = await window.customConfirm(`${window.duplicateDraftWarning(submittedAt)}\n\nOpen it anyway?`, 'OPEN ANYWAY', true);
        if (!ok) return;
    }
    // Reopening this page's own saved version replaces what is on screen. The
    // auto-save keeps it until the first edit to the saved version.
    else if (draft.kind.kind === 'saved' && draft.charId === window.currentEditorCharId) {
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
