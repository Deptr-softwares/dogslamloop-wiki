/**
 * Page History: a page's past live versions, each compared with the live page
 * and restorable in one press. Opened from the open submission (PAGE HISTORY) or,
 * for any page, from the Page History tab.
 * @since v0.4, as part of admin.js
 * @touches page_history (written by archive_page_version on every page_data
 *   update), page_data, navigation.json, renderStructuredDiff (admin-diff.js),
 *   registeredPageType (site_utils.js)
 * @watch a restore is an ordinary page_data update, so the trigger snapshots the
 *   version it replaces and a restore can itself be undone. It skips review on
 *   purpose; only review staff may do it (RLS on page_data and page_history).
 * @see docs/overseer.md
 */

async function togglePageHistoryView() {
    const pageId = window.activePreviewCharId;
    if (!pageId) return;

    let container = document.getElementById('page-history-container');

    if (container && !container.classList.contains('hidden')) {
        container.classList.add('hidden');
        if (typeof switchVersionView === 'function') switchVersionView('pending');
        return;
    }

    await showPageHistory(pageId);
}

// For a page the caller names: the open submission's, or any from the tab.
async function showPageHistory(pageId) {
    await loadPageHistoryList(pageId, revealPageHistoryContainer());
}

function revealPageHistoryContainer() {
    let container = document.getElementById('page-history-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'page-history-container';
        container.className = 'tab-content';
        document.querySelector('.main-content-area').appendChild(container);
    }

    // The same sweep as the diff view: a character page's static #tab-* panes carry
    // neither class, so they are hidden by id too.
    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => el.classList.add('hidden'));
    const diffContainer = document.getElementById('admin-diff-container');
    if (diffContainer) diffContainer.classList.add('hidden');

    container.classList.remove('hidden');

    const historyBtn = document.getElementById('btn-view-history');
    if (historyBtn) historyBtn.className = 'btn-sys btn-sys-yellow version-toggle-btn';

    return container;
}

/**
 * The Page History tab's page picker: every live page, from navigation.json, so
 * an archived page is not offered. Filled the first time the tab opens.
 * @since v1.2
 * @watch admin-core.js shows the tab to review staff only, who are the ones the
 *   database lets read page_history
 */

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
        opt.textContent = page.name;
        select.appendChild(opt);
    });

    // The site's dropdown copied this select before the list arrived, so it is
    // rebuilt, as in populateQueuePageFilter.
    const built = select.nextElementSibling;
    if (built && built.classList.contains('manga-select-wrapper')) {
        built.remove();
        select.classList.remove('manga-initialized');
        window.initializeMangaSelects();
    }
}

// A second pick while the first loads must not have the first answer land on it.
let pageHistoryPick = 0;

window.openPageHistoryFor = async function(pageId) {
    if (!pageId) return;
    const pick = ++pageHistoryPick;

    // One thing in the pane, so no buttons are left acting on a page off screen.
    if (typeof window.closeMediaPreview === 'function') window.closeMediaPreview();
    resetPreviewState();
    if (typeof window.setQueueOpen === 'function') window.setQueueOpen(false);

    document.getElementById('preview-status-text').innerHTML = `PAGE HISTORY: <strong class="admin-preview-status-highlight">${window.escapeHtml(pageId.toUpperCase())}</strong>`;
    document.getElementById('preview-content-area').classList.add('active');

    // COMPARE TO LIVE reads these. A failed read stops here: an empty page would show
    // every field as removed.
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

    // On a phone the pane is off screen until the reviewer is taken to it.
    window.showMobilePreview();
};

document.addEventListener('DOMContentLoaded', () => {
    // `change`, not `input`: the site's dropdown only dispatches change.
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
    // The trigger copies page_data.last_editor_name; an older row holds its
    // placeholder.
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
    if (diffEl.dataset.rendered) return;

    // Whole page: page_history has no scope column.
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
        // The page list first: an old snapshot can carry a kind copied from a submission.
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

    // The list reloads with the version this restore replaced.
    const { data: freshLive } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
    window.currentLiveDescData = freshLive ? freshLive.desc_data : {};
    window.currentLiveFrameData = freshLive ? freshLive.frame_data : {};

    window.adminAlert('Version restored - the page is now live with this content.');

    const container = document.getElementById('page-history-container');
    if (container) await loadPageHistoryList(pageId, container);
}
