/**
 * Dogslamloop Wiki - Admin Overseer: Page History (browse + restore past
 * live versions of the page currently being reviewed)
 *
 * Phase 5 (the last one) of the reviewer-workflow redesign. page_history
 * already snapshots the pre-update content of page_data on every live
 * change via the archive_page_version trigger - this is the first UI
 * anywhere that reads it to actually list/compare/restore a version,
 * closing the gap where undoing a bad live edit meant manually re-editing
 * the page by hand through the full review process again.
 *
 * Restore is instant, admin/reviewer only (inherited from admin.html's own
 * page-level RBAC gate - no extra check needed here), not routed back
 * through pending_revisions/review - matching Wikipedia's rollback-for-
 * trusted-users model. FORCE APPROVE already lets staff push arbitrary
 * content live directly, so restoring known-prior-good content isn't a new
 * trust boundary. Restoring is itself just a normal page_data UPDATE, so it
 * re-fires the same trigger and snapshots the pre-restore live content as
 * a new page_history row for free - a restore can itself be undone the
 * same way, no special-casing needed.
 */

async function togglePageHistoryView() {
    const pageId = window.activePreviewCharId;
    if (!pageId) return;

    let container = document.getElementById('page-history-container');

    if (container && !container.classList.contains('hidden')) {
        // Already showing - toggle off, back to the pending view.
        container.classList.add('hidden');
        if (typeof switchVersionView === 'function') switchVersionView('pending');
        return;
    }

    await showPageHistory(pageId);
}

// The list itself, for a page named by the caller: the PAGE HISTORY button
// above (the page of the open submission) and the Page History tab below (any
// page, with nothing open).
async function showPageHistory(pageId) {
    await loadPageHistoryList(pageId, revealPageHistoryContainer());
}

// Brings the history pane to the front of the review pane, making it the first
// time it is asked for.
function revealPageHistoryContainer() {
    let container = document.getElementById('page-history-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'page-history-container';
        container.className = 'tab-content';
        document.querySelector('.main-content-area').appendChild(container);
    }

    // Same "hide every other pane" sweep switchVersionView's diff mode uses.
    // System-type pages build their tabs (.wiki-tab-content); character-type
    // ones reuse admin.html's static #tab-* divs, which carry neither class.
    // This used to say they carry .tab-content and swept only the classes, so
    // on a whole-page submission (which opens on PENDING, not DIFF) the page
    // stayed on screen with the list of versions underneath it.
    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => el.classList.add('hidden'));
    const diffContainer = document.getElementById('admin-diff-container');
    if (diffContainer) diffContainer.classList.add('hidden');

    container.classList.remove('hidden');

    const historyBtn = document.getElementById('btn-view-history');
    if (historyBtn) historyBtn.className = 'btn-sys btn-sys-yellow version-toggle-btn';

    return container;
}

// --- THE PAGE HISTORY TAB (owner's Overseer card, v1.2) ---
//
// The list above hung off a button that only exists while a submission is
// open, so rolling a page back needed a submission on that page to be sitting
// in the queue. The owner picked "a page picker in the Overseer": a tab that
// opens the same list, with the same COMPARE TO LIVE and RESTORE, for any page.
//
// Review staff only (js/overseer/admin-core.js hides the tab from everyone else), which
// is who the database lets read page_history and write page_data.

// Every live page, by name. From navigation.json, which the page already has:
// an archived page is not in it, and is not offered. Filled the first time the
// tab is opened.
async function loadHistoryPagePicker() {
    const select = document.getElementById('history-page-picker');
    if (!select) return;

    let pages;
    try {
        const nav = await window.fetchNavigationData();
        pages = Object.values(nav || {}).flat()
            .filter(entry => entry && entry.cms_config && entry.cms_config.pageId)
            .map(entry => ({ id: entry.cms_config.pageId, name: entry.name || entry.cms_config.pageId }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        console.error('[Page History] The page list could not be read:', e);
        const note = document.getElementById('history-picker-note');
        if (note) note.textContent = 'The page list could not be loaded. Reload the page to try again.';
        return;
    }

    select.innerHTML = '<option value="">Pick a page...</option>';
    pages.forEach(page => {
        const opt = document.createElement('option');
        opt.value = page.id;
        // textContent: a name from the registry is still a value going into the DOM.
        opt.textContent = page.name;
        select.appendChild(opt);
    });

    // The site's dropdown copies a <select>'s options once, when it builds
    // itself, which is before this list arrives. Rebuilt here, the same way
    // populateQueuePageFilter (js/overseer/admin-queue.js) does for the same reason.
    const built = select.nextElementSibling;
    if (built && built.classList.contains('manga-select-wrapper')) {
        built.remove();
        select.classList.remove('manga-initialized');
        window.initializeMangaSelects();
    }
}

// The pick that is on screen. A second page picked while the first is still
// loading must not have the first one's answer land on top of it.
let pageHistoryPick = 0;

window.openPageHistoryFor = async function(pageId) {
    if (!pageId) return;
    const pick = ++pageHistoryPick;

    // One thing in the pane: the open submission and any clip are put away, so
    // its buttons are not left acting on a page that is no longer on screen.
    if (typeof window.closeMediaPreview === 'function') window.closeMediaPreview();
    resetPreviewState();
    // Its versions open in the pane, which gets the whole width (js/overseer/admin-queue.js).
    if (typeof window.setQueueOpen === 'function') window.setQueueOpen(false);

    document.getElementById('preview-status-text').innerHTML = `PAGE HISTORY: <strong class="admin-preview-status-highlight">${window.escapeHtml(pageId.toUpperCase())}</strong>`;
    document.getElementById('preview-content-area').classList.add('active');

    // COMPARE TO LIVE reads these, and no submission is there to have set
    // them. A failed read stops here: comparing against an empty page would
    // show every field as removed.
    const { data: live, error } = await window.supabaseClient
        .from('page_data').select('desc_data, frame_data').eq('page_id', pageId).maybeSingle();
    if (pick !== pageHistoryPick) return;
    if (error) {
        revealPageHistoryContainer().innerHTML = `<div class="wiki-section"><p class="loading-msg">Failed to load the live page: ${window.escapeHtml(error.message)}</p></div>`;
        return;
    }
    window.currentLiveDescData = live ? live.desc_data : {};
    window.currentLiveFrameData = live ? live.frame_data : {};

    await showPageHistory(pageId);

    // On a phone the pane is off-screen until the reviewer switches to it, so
    // picking a page has to take them there (as opening a clip does).
    window.showMobilePreview();
};

document.addEventListener('DOMContentLoaded', () => {
    // `change`, not `input`: the site's dropdown only ever dispatches change.
    const picker = document.getElementById('history-page-picker');
    if (picker) picker.addEventListener('change', () => window.openPageHistoryFor(picker.value));
});

async function loadPageHistoryList(pageId, container) {
    container.innerHTML = `<p class="loading-msg loading-msg-busy">Loading page history...</p>`;

    const { data: rows, error } = await window.supabaseClient
        .from('page_history')
        .select('*')
        .eq('page_id', pageId)
        .order('version_timestamp', { ascending: false });

    if (error) {
        container.innerHTML = `<div class="wiki-section"><p class="loading-msg">Failed to load page history: ${window.escapeHtml(error.message)}</p></div>`;
        return;
    }

    if (!rows || rows.length === 0) {
        container.innerHTML = `<div class="wiki-section"><p>No past live versions recorded for this page yet - the archive only fills in once a live edit actually happens.</p></div>`;
        return;
    }

    container.innerHTML = rows.map((row, i) => renderPageHistoryCard(row, i)).join('');

    rows.forEach((row, i) => {
        const compareBtn = document.getElementById(`ph-compare-${i}`);
        if (compareBtn) compareBtn.onclick = () => togglePageHistoryDiff(i, row);
        const restoreBtn = document.getElementById(`ph-restore-${i}`);
        if (restoreBtn) restoreBtn.onclick = () => restorePageHistoryVersion(row, pageId);
    });
}

function renderPageHistoryCard(row, index) {
    const dateStr = new Date(row.version_timestamp).toLocaleString();
    // last_editor_name only started being set by approveCurrentPreview as of
    // Phase 0 of this redesign - older rows (and any direct-DB change) still
    // read the trigger's original hardcoded placeholder.
    const editor = row.updated_by_user || 'Unknown';

    return `
        <section class="wiki-section page-history-card">
            <div class="page-history-card-header">
                <div>
                    <h3 class="page-history-card-title">VERSION FROM ${window.escapeHtml(dateStr)}</h3>
                    <div class="page-history-card-editor">Live at the time - edited by: <strong>${window.escapeHtml(editor)}</strong></div>
                </div>
                <div class="page-history-card-actions">
                    <button id="ph-compare-${index}" class="btn-sys btn-sys-purple">COMPARE TO LIVE</button>
                    <button id="ph-restore-${index}" class="btn-sys btn-sys-red btn-danger-fill">RESTORE THIS VERSION</button>
                </div>
            </div>
            <div id="ph-diff-${index}" class="page-history-diff hidden"></div>
        </section>
    `;
}

function togglePageHistoryDiff(index, row) {
    const diffEl = document.getElementById(`ph-diff-${index}`);
    if (!diffEl) return;

    if (!diffEl.classList.contains('hidden')) {
        diffEl.classList.add('hidden');
        return;
    }
    diffEl.classList.remove('hidden');
    if (diffEl.dataset.rendered) return; // already built once this list-load, just toggling visibility

    // page_history has no tab/section-scope column (unlike pending_revisions'
    // delta system) - the comparison is always whole-page, not scoped to one
    // tab. Same structural-diff engine Phase 2 built for move/frame-data -
    // reused here instead of a raw JSON dump for the same legibility reason.
    const descDiff = window.renderStructuredDiff(row.desc_data || {}, window.currentLiveDescData || {});
    const frameDiff = window.renderStructuredDiff(row.frame_data || {}, window.currentLiveFrameData || {});

    diffEl.innerHTML = `
        <div class="diff-container">
            <h3 class="diff-section-title">THIS VERSION → CURRENT LIVE (DESCRIPTION DATA)</h3>
            ${descDiff}
        </div>
        <div class="diff-container">
            <h3 class="diff-section-title">THIS VERSION → CURRENT LIVE (FRAME DATA)</h3>
            ${frameDiff}
        </div>
    `;
    diffEl.dataset.rendered = 'true';
}

async function restorePageHistoryVersion(row, pageId) {
    const dateStr = new Date(row.version_timestamp).toLocaleString();
    const confirmed = await adminConfirm(
        `Restore the version from ${dateStr}? This immediately overwrites the current live page - same trust level as FORCE APPROVE, no review cycle. ` +
        `The current live content will itself be saved as a new history entry first, so this can be undone the same way if needed.`
    );
    if (!confirmed) return;

    const payload = {
        page_id: pageId,
        // The page list first: an old snapshot can carry a kind an approval
        // copied from a submission.
        page_type: (await window.registeredPageType(pageId)) || row.page_type || 'character',
        desc_data: row.desc_data,
        frame_data: row.frame_data,
        last_editor_name: `${window.currentUsername} (restored ${dateStr})`
    };

    const { error } = await window.supabaseClient.from('page_data').upsert([payload], { onConflict: 'page_id' });

    if (error) {
        window.adminAlert('Restore failed: ' + error.message);
        return;
    }

    // Refresh the cached live data (used by both this view's diff comparisons
    // and the pending/live/diff toggle) and reload the list - it now
    // includes a new entry for the content that was just overwritten.
    const { data: freshLive } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
    window.currentLiveDescData = freshLive ? freshLive.desc_data : {};
    window.currentLiveFrameData = freshLive ? freshLive.frame_data : {};

    window.adminAlert('Version restored - the page is now live with this content.');

    const container = document.getElementById('page-history-container');
    if (container) await loadPageHistoryList(pageId, container);
}
