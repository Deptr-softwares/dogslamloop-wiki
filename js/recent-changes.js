/**
 * Dogslamloop Wiki - Recent Changes (public sitewide feed of approved edits)
 *
 * Phase 4 of the reviewer-workflow redesign (v0.6 item 4). Every page's
 * own approval history was already public via history.html?page=X - this
 * is the sitewide equivalent, so a visitor (or a reviewer casually
 * monitoring activity) doesn't have to check every page one at a time.
 * Public, no RBAC gate, same idiom as history.html.
 */

const PAGE_SIZE = 20;
let currentOffset = 0;

// Duplicated from js/admin-core.js rather than shared, matching this
// codebase's existing precedent (see js/owner.js's kickUser, js/submissions.js)
// of small per-file duplication over new cross-file coupling.
function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.initSidebarToggle) window.initSidebarToggle();
    if (window.initMobileNav) window.initMobileNav();
    if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (window.initAuthDock) window.initAuthDock();

    await loadRecentChanges();
});

async function loadRecentChanges() {
    const listEl = document.getElementById('recent-changes-list');
    listEl.innerHTML = `<p class="loading-msg">Loading...</p>`;

    if (!window.supabaseClient) {
        listEl.innerHTML = `<div class="wiki-section"><p class="loading-msg">Database disconnected.</p></div>`;
        return;
    }

    const { data: revisions, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    if (error) {
        listEl.innerHTML = `<div class="wiki-section"><p class="loading-msg">Failed to load recent changes: ${escapeHtml(error.message)}</p></div>`;
        return;
    }

    if (!revisions || revisions.length === 0) {
        listEl.innerHTML = `<div class="wiki-section"><p>${currentOffset === 0 ? 'No approved edits yet.' : 'No more changes.'}</p></div>`;
        renderPagination(0);
        return;
    }

    // Every card links to its page by id, and where a page lives is data
    // rather than convention - see buildPageUrl in js/site_utils.js. Without
    // this, a change to a tool, a gallery or a system page under others/
    // rendered a link to a 404.
    await window.primePageUrlIndex();

    listEl.innerHTML = revisions.map(renderChangeCard).join('');
    renderPagination(revisions.length);
}

function renderPagination(fetchedCount) {
    const hasNewer = currentOffset > 0;
    const hasOlder = fetchedCount === PAGE_SIZE; // a full page came back - there might be more after it

    const html = `
        <button class="btn-sys btn-sys-regular rc-newer-btn" ${hasNewer ? '' : 'disabled'}>◀ NEWER</button>
        <span class="recent-changes-page-label">${fetchedCount > 0 ? `Showing changes ${currentOffset + 1}-${currentOffset + fetchedCount}` : ''}</span>
        <button class="btn-sys btn-sys-regular rc-older-btn" ${hasOlder ? '' : 'disabled'}>OLDER ▶</button>
    `;

    document.getElementById('recent-changes-pagination').innerHTML = html;
    document.getElementById('recent-changes-pagination-bottom').innerHTML = html;

    document.querySelectorAll('.rc-newer-btn').forEach(b => b.onclick = () => changePage(-1));
    document.querySelectorAll('.rc-older-btn').forEach(b => b.onclick = () => changePage(1));
}

async function changePage(direction) {
    currentOffset = Math.max(0, currentOffset + direction * PAGE_SIZE);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadRecentChanges();
}

function renderChangeCard(rev) {
    const dateStr = new Date(rev.created_at).toLocaleString();
    const qa = rev.qa_metadata || {};
    const reviewer = qa.reviewed_by || 'Legacy System';
    const pageUrl = window.buildPageUrl(rev.page_id, rev.page_type);
    const historyUrl = `history.html?page=${encodeURIComponent(rev.page_id)}`;

    let scopeText = rev.is_delta
        ? `${(rev.target_scope || '').toUpperCase()}${rev.target_key ? ': ' + rev.target_key : ''}`
        : 'FULL PAGE REWRITE';
    if (rev.target_scope === 'multi') scopeText = `BATCHED MULTI-EDIT (${(rev.delta_payload || []).length} targets)`;

    const changelog = qa.changelog ? escapeHtml(qa.changelog).replace(/\n/g, '<br>') : 'No notes provided.';

    return `
        <section class="wiki-section change-card">
            <div class="change-card-header">
                <div>
                    <a href="${escapeHtml(pageUrl)}" class="change-card-page-link">${escapeHtml((rev.page_id || '').replace(/_/g, ' ').toUpperCase())}</a>
                    <div class="change-card-scope">${escapeHtml(scopeText)}</div>
                </div>
                <div class="change-card-meta">
                    <div>${dateStr}</div>
                    <div>By: <strong>${escapeHtml(rev.author_name || 'Unknown')}</strong></div>
                    <div>Approved By: <strong class="reviewer">${escapeHtml(reviewer)}</strong></div>
                </div>
            </div>
            <div class="change-card-changelog">${changelog}</div>
            <a href="${escapeHtml(historyUrl)}" class="btn-ghost change-card-history-link">View full history for this page →</a>
        </section>
    `;
}
