/**
 * Dogslamloop Wiki - Admin Overseer: Queue (TOC, queue list, action buttons, reset)
 */

// --- DYNAMIC TABLE OF CONTENTS ---
function updateAdminTOC() {
    const tocList = document.getElementById('dynamic-toc');
    if (!tocList) return;
    tocList.innerHTML = '';

    // Scoped to just the currently-visible pane, not the whole preview area -
    // #preview-content-area holds every tab (overview/m1s/skills/specials/
    // matchups/counterplay) plus the diff-mode container all at once, hidden
    // ones included, so querying the whole area indexed every heading on
    // every tab simultaneously instead of just the one being viewed. Can't
    // key off a shared "tab-content" class here - system-type revisions get
    // that class (js/description.js creates their tab containers fresh),
    // but character-type revisions reuse admin.html's pre-existing static
    // #tab-* divs, which never pick it up - so this keys off visibility
    // (:not(.hidden)) alone, which every pane relies on regardless of type.
    const activePane = document.querySelector('#preview-content-area > div:not(.hidden)') || document.getElementById('preview-content-area');
    const headers = activePane.querySelectorAll('h3.strategy-title, h3.diff-section-title, h3.card-header-title');

    if (headers.length === 0) {
        tocList.innerHTML = `<li><p class="admin-toc-empty">Nothing to index here.</p></li>`;
        return;
    }

    headers.forEach((h, i) => {
        const safeId = 'toc-target-admin-' + i;
        h.id = safeId;

        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'toc-btn';

        let cleanText = h.textContent.replace(/\(.*?\)/g, '').trim();
        a.textContent = cleanText || 'Section';

        a.onclick = (e) => {
            e.preventDefault();
            h.scrollIntoView({ behavior: 'smooth', block: 'center' });
            h.style.transition = 'color 0.3s ease';
            h.style.color = 'var(--accent-blue)';
            setTimeout(() => h.style.color = '', 800);
        };

        li.appendChild(a);
        tocList.appendChild(li);
    });
}

// --- 2. FETCH QUEUE ---
async function loadQueue() {
    const container = document.getElementById('queue-container');
    container.innerHTML = `<p class="loading-msg admin-loading-msg">Scanning database...</p>`;

    const { data, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .in('status', ['pending', 'ticket_open'])
        .order('created_at', { ascending: true });

    if (error) { container.innerHTML = `<p class="admin-error-text">Error: ${error.message}</p>`; return; }

    window.currentQueueData = data || [];

    if (window.currentQueueData.length === 0) {
        container.innerHTML = `<div class="empty-tab-msg admin-queue-empty-msg">No pending revisions or open tickets.</div>`;
        return;
    }

    container.innerHTML = '';

    const groupedQueue = {};
    window.currentQueueData.forEach(rev => {
        if (!groupedQueue[rev.page_id]) groupedQueue[rev.page_id] = [];
        groupedQueue[rev.page_id].push(rev);
    });

    for (const [pageId, tickets] of Object.entries(groupedQueue)) {

        const header = document.createElement('div');
        header.className = 'admin-queue-group-header';

        let mergeBtnHtml = '';
        if (tickets.length > 1) {
            mergeBtnHtml = `<button onclick="window.openMergeCompiler('${pageId}')" class="btn-sys btn-sys-purple admin-merge-btn">✦ MERGE TICKETS (${tickets.length})</button>`;
        }

        header.innerHTML = `
            <h3 class="admin-queue-group-title">${pageId.replace(/_/g, ' ')}</h3>
            ${mergeBtnHtml}
        `;
        container.appendChild(header);

        tickets.forEach(rev => {
            rev.supporters = rev.supporters || [];
            rev.ticket_chat = rev.ticket_chat || [];

            const exactDate = new Date(rev.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
            const relativeTime = timeSince(rev.created_at);

            const statusBadge = rev.status === 'ticket_open'
                ? `<span class="update-badge badge-status-ticket-open">TICKET OPEN</span>`
                : `<span class="update-badge badge-status-pending">PENDING</span>`;

            // Show the actual target, not just the scope, where it's readable -
            // "MOVE: 5H" beats "[PATCH: MOVE]" when the queue has ten pending
            // move edits on the same character and they all look identical
            // until opened.
            let targetLabel = rev.target_scope ? rev.target_scope.toUpperCase() : '';
            if (rev.target_scope === 'multi') {
                // A batched or merged ticket carries a list of scopes, so there
                // is no single target to name - count them instead, matching the
                // "BATCHED MULTI-EDIT (N targets)" wording history.html and
                // recent-changes.html already use. "MULTI: batch" said nothing.
                const targetCount = Array.isArray(rev.delta_payload) ? rev.delta_payload.length : 0;
                targetLabel = `${targetCount} TARGET${targetCount === 1 ? '' : 'S'}`;
            } else if (rev.target_key) {
                if (rev.target_scope === 'move' && rev.target_key.includes('::')) {
                    const [moveCategory, moveId] = rev.target_key.split('::');
                    targetLabel = `${moveCategory.toUpperCase()}: ${moveId}`;
                } else {
                    targetLabel = `${targetLabel}: ${rev.target_key}`;
                }
            }
            const deltaBadge = rev.is_delta
                ? `<span class="update-badge badge-patch-delta">[PATCH: ${window.escapeHtml(targetLabel)}]</span>`
                : `<span class="update-badge badge-legacy-overwrite">[LEGACY OVERWRITE]</span>`;

            // Cheap, approximate risk/size hint - serialized byte length of just
            // the changed content, computed once at queue-load time (no extra
            // query, not a real diff-against-live-data size).
            const sizeSource = rev.is_delta ? rev.delta_payload : { desc: rev.desc_data, frame: rev.frame_data };
            const sizeBytes = JSON.stringify(sizeSource || {}).length;
            const sizeTier = sizeBytes > 3000 ? 'l' : (sizeBytes > 500 ? 'm' : 's');
            const sizeBadge = `<span class="update-badge badge-size-${sizeTier}" title="${sizeBytes} bytes of changed content">${sizeTier.toUpperCase()}</span>`;

            const card = document.createElement('div');
            card.className = 'update-log-item';
            card.innerHTML = `
                <div class="admin-queue-card-header">
                    <div class="admin-queue-card-info">
                        <div class="admin-queue-badges-row">
                            ${statusBadge}
                            <span class="update-badge badge-page-id">${rev.page_id.toUpperCase()}</span>
                            ${deltaBadge}
                            ${sizeBadge}
                        </div>
                        <h3 class="update-title">REVISION SUBMISSION</h3>
                        <div class="update-log-meta">
                            By: <strong class="admin-queue-author-name">${window.escapeHtml(rev.author_name)}</strong><br>
                            <span class="admin-queue-time-relative">${relativeTime}</span> <span class="admin-queue-time-exact">(${exactDate})</span>
                        </div>
                    </div>
                    <button onclick="previewRevision('${rev.id}')" class="btn-sys btn-sys-blue admin-review-btn">REVIEW</button>
                </div>
            `;
            container.appendChild(card);
        });
    }
}

// --- DYNAMIC BUTTON HELPER ---
function updateActionButtons(rev) {
    const actionContainer = document.getElementById('preview-action-buttons');
    const isOwnSubmission = (rev.author_id === window.currentUserId);
    const isAdmin = (window.currentUserRoles || []).includes('admin');

    // --- TRUSTED EDITOR PERK ---
    const isTrusted = (rev.author_roles || []).includes('trusted_editor');
    const requiredSupport = isTrusted ? 1 : 2; // Trusted gets a discount

    const supportersCount = (rev.supporters || []).length;
    const opposersCount = (rev.opposers || []).length;
    const netScore = supportersCount - opposersCount;

    const hasEnoughSupport = (netScore >= requiredSupport);
    const hasEnoughOppose = (netScore <= -2);

    let buttonsHTML = '';

    // The Intercept button (Available to all staff and the original author)
    const editBtn = `<button onclick="editCurrentTicket()" class="btn-sys btn-sys-purple">INTERCEPT & EDIT</button>`;
    // Lighter middle path than INTERCEPT & EDIT (which makes the reviewer the
    // co-author) or a binary approve/reject - sends written feedback back to
    // the author instead. Not gated on ticket status like OPEN TICKET below,
    // since asking for a second round of changes on an already-open ticket
    // is a normal, repeatable action, not a one-time state transition. Never
    // shown to the author reviewing their own submission - doesn't make
    // sense to request changes from yourself.
    const requestChangesBtn = `<button onclick="requestChanges()" class="btn-sys btn-sys-yellow">REQUEST CHANGES</button>`;

    if (isAdmin) {
        buttonsHTML += editBtn;
        buttonsHTML += requestChangesBtn;
        buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">FORCE APPROVE</button>`;
        buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">FORCE REJECT</button>`;
    } else {
        if (isOwnSubmission) {
            buttonsHTML += editBtn;
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`;
            buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">WITHDRAW</button>`;
        } else {
            buttonsHTML += editBtn;
            buttonsHTML += requestChangesBtn;
            if (hasEnoughSupport) buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">MERGE TO LIVE</button>`;
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`;
            if (hasEnoughOppose) buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">REJECT</button>`;
        }
    }
    actionContainer.innerHTML = buttonsHTML;
    actionContainer.classList.remove('hidden');
}

function resetPreviewState() {
    window.activePreviewRevId = null;
    window.activePreviewCharId = null;
    document.getElementById('preview-status-text').textContent = "Select a revision from the queue to preview...";
    document.getElementById('preview-action-buttons').classList.add('hidden');
    document.getElementById('preview-nav-sidebar').classList.add('hidden');
    document.getElementById('ticket-workspace').classList.add('hidden');

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.classList.add('hidden');

    const contentArea = document.getElementById('preview-content-area');
    contentArea.classList.remove('active');

    const changedTabsPopup = document.getElementById('changed-tabs-popup');
    if (changedTabsPopup) changedTabsPopup.remove();

    const tabNav = document.getElementById('preview-tab-nav');
    if (tabNav) tabNav.classList.add('hidden');

    ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tab => {
        const el = document.getElementById(`tab-${tab}`);
        const btn = document.getElementById(`nav-${tab}`);
        if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
        if (btn) {
            btn.classList.remove('active');
            btn.classList.remove('tab-changed'); // Markers belong to the revision just closed
            btn.classList.remove('hidden'); // Restore default display visibility
        }
    });

    // Remove dynamically generated system tabs
    document.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    document.getElementById('tab-overview').classList.remove('hidden');
    document.getElementById('nav-overview').classList.add('active');
    document.getElementById('dynamic-toc').innerHTML = '<li><p class="admin-toc-empty">Navigation unavailable.</p></li>';
}
