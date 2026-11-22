/**
 * Recent Changes (recent-changes.html): every approved edit across the wiki,
 * newest first, 20 a page, each linking to its page. Public, like a page's own
 * history.
 * @since v0.6
 * @touches approved_revisions, primePageUrlIndex and buildPageUrl (site_utils.js)
 * @watch a link is the page's real path from the page list (others/ and tools/
 *   pages included), never a folder guessed from the submission's page_type
 * @see docs/records.md
 */

const PAGE_SIZE = 20;
let currentOffset = 0;

document.addEventListener('DOMContentLoaded', async () => {
    if (window.initSidebarToggle) window.initSidebarToggle();
    if (window.initMobileNav) window.initMobileNav();
    if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (window.initAuthDock) window.initAuthDock();

    await loadRecentChanges();
});

async function loadRecentChanges() {
    const listEl = document.getElementById('recent-changes-list');
    listEl.innerHTML = `<p class="loading-msg loading-msg-busy">Loading...</p>`;

    if (!window.supabaseClient) {
        listEl.innerHTML = `<div class="wiki-section"><p class="loading-msg">Database disconnected.</p></div>`;
        return;
    }

    const { data: revisions, error } = await window.supabaseClient
        .from('approved_revisions')
        .select('*')
        .order('created_at', { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    if (error) {
        listEl.innerHTML = `<div class="wiki-section"><p class="loading-msg">Failed to load recent changes: ${window.escapeHtml(error.message)}</p></div>`;
        return;
    }

    if (!revisions || revisions.length === 0) {
        listEl.innerHTML = `<div class="wiki-section"><p>${currentOffset === 0 ? 'No approved edits yet.' : 'No more changes.'}</p></div>`;
        renderPagination(0);
        return;
    }

    // Where a page lives is data, so the index is primed before any link is built.
    await window.primePageUrlIndex();

    listEl.innerHTML = revisions.map(renderChangeCard).join('');
    renderPagination(revisions.length);
}

function renderPagination(fetchedCount) {
    const hasNewer = currentOffset > 0;
    const hasOlder = fetchedCount === PAGE_SIZE;

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
    window.scrollTo({ top: 0, behavior: window.scrollMotion() });
    await loadRecentChanges();
}

function renderChangeCard(rev) {
    const dateStr = new Date(rev.created_at).toLocaleString();
    const qa = rev.qa_metadata || {};
    const reviewer = qa.reviewed_by || 'Legacy System';
    // No kind passed: the revision's page_type is only the submitter's word.
    const pageUrl = window.buildPageUrl(rev.page_id);
    const historyUrl = `history.html?page=${encodeURIComponent(rev.page_id)}`;

    let scopeText = rev.is_delta
        ? `${(rev.target_scope || '').toUpperCase()}${rev.target_key ? ': ' + rev.target_key : ''}`
        : 'FULL PAGE REWRITE';
    if (rev.target_scope === 'multi') scopeText = `BATCHED MULTI-EDIT (${(rev.delta_payload || []).length} targets)`;

    const changelog = qa.changelog ? window.escapeHtml(qa.changelog).replace(/\n/g, '<br>') : 'No notes provided.';

    return `
        <section class="wiki-section change-card">
            <div class="change-card-header">
                <div>
                    <a href="${window.escapeHtml(pageUrl)}" class="change-card-page-link">${window.escapeHtml((rev.page_id || '').replace(/_/g, ' ').toUpperCase())}</a>
                    <div class="change-card-scope">${window.escapeHtml(scopeText)}</div>
                </div>
                <div class="change-card-meta">
                    <div>${dateStr}</div>
                    <div>By: <strong>${window.escapeHtml(rev.author_name || 'Unknown')}</strong></div>
                    <div>Approved By: <strong class="reviewer">${window.escapeHtml(reviewer)}</strong></div>
                </div>
            </div>
            <div class="change-card-changelog">${changelog}</div>
            <a href="${window.escapeHtml(historyUrl)}" class="btn-ghost change-card-history-link">View full history for this page →</a>
        </section>
    `;
}
