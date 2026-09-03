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
    populateQueuePageFilter(window.currentQueueData);
    renderQueue();
}

// The page dropdown is built from WHAT CAME BACK, not from navigation.json.
//
// That is the whole difference the expert system makes here. An expert receives
// only their own pages - the "Staff can view queue" policy filters the rows
// before this client ever sees them - so offering the full roster would list
// forty pages whose selection can only ever produce an empty queue.
function populateQueuePageFilter(rows) {
    const select = document.getElementById('queue-filter-page');
    if (!select) return;

    const previous = select.value;
    const pages = [...new Set(rows.map(r => r.page_id))].sort();

    select.innerHTML = '<option value="all">All pages</option>';
    pages.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        // textContent, not innerHTML: page_id is owner-authored but it is still
        // a value from the database being put into the DOM.
        opt.textContent = id.replace(/_/g, ' ');
        select.appendChild(opt);
    });

    // Keep a reviewer where they were across a refresh, unless the page they
    // were filtered to has emptied.
    if (previous && pages.includes(previous)) select.value = previous;
}

function renderQueue() {
    const container = document.getElementById('queue-container');
    if (!container) return;

    const all = window.currentQueueData || [];
    const pageFilter = document.getElementById('queue-filter-page')?.value || 'all';
    const statusFilter = document.getElementById('queue-filter-status')?.value || 'all';

    const rows = all.filter(rev =>
        (pageFilter === 'all' || rev.page_id === pageFilter)
        && (statusFilter === 'all' || rev.status === statusFilter));

    container.innerHTML = '';

    // Two different empty states. "Nothing is waiting" and "nothing matches
    // what you asked for" send a reviewer to different places, and the media
    // queue makes the same distinction.
    if (all.length === 0) {
        container.innerHTML = `<div class="empty-tab-msg admin-queue-empty-msg">No pending revisions or open tickets.</div>`;
        return;
    }
    if (rows.length === 0) {
        container.innerHTML = `<p class="admin-queue-empty-msg">Nothing matches this filter.</p>`;
        return;
    }

    const summary = document.createElement('p');
    summary.className = 'queue-summary';
    summary.textContent = rows.length === all.length
        ? `${all.length} waiting`
        : `${rows.length} of ${all.length} waiting`;
    container.appendChild(summary);

    const groupedQueue = {};
    rows.forEach(rev => {
        if (!groupedQueue[rev.page_id]) groupedQueue[rev.page_id] = [];
        groupedQueue[rev.page_id].push(rev);
    });

    for (const [pageId, tickets] of Object.entries(groupedQueue)) {

        const header = document.createElement('div');
        header.className = 'admin-queue-group-header';

        // Counted against the UNFILTERED set on purpose. openMergeCompiler
        // loads every ticket for the page itself, so a count taken from the
        // filtered list would promise to merge two and then merge three.
        const totalForPage = all.filter(r => r.page_id === pageId).length;

        let mergeBtnHtml = '';
        if (totalForPage > 1) {
            mergeBtnHtml = `<button onclick="window.openMergeCompiler('${pageId}')" class="btn-sys btn-sys-purple admin-merge-btn">✦ MERGE TICKETS (${totalForPage})</button>`;
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
            // A character-state edit is wrapped, so the raw scope reads "MODE"
            // for every one of them. Unwrap and name the state instead: which
            // kit an edit targets is the first thing a reviewer needs.
            const unwrapped = window.unwrapModeDelta(rev.target_scope, rev.target_key);
            const statePrefix = unwrapped.modeId ? `${unwrapped.modeId.toUpperCase()} / ` : '';

            let targetLabel = unwrapped.scope ? unwrapped.scope.toUpperCase() : '';
            if (rev.target_scope === 'multi') {
                // A batched or merged ticket carries a list of scopes, so there
                // is no single target to name - count them instead, matching the
                // "BATCHED MULTI-EDIT (N targets)" wording history.html and
                // recent-changes.html already use. "MULTI: batch" said nothing.
                const targetCount = Array.isArray(rev.delta_payload) ? rev.delta_payload.length : 0;
                targetLabel = `${targetCount} TARGET${targetCount === 1 ? '' : 'S'}`;
            } else if (rev.target_key) {
                if (unwrapped.scope === 'move' && unwrapped.key.includes('::')) {
                    const [moveCategory, moveId] = unwrapped.key.split('::');
                    targetLabel = `${statePrefix}${moveCategory.toUpperCase()}: ${moveId}`;
                } else {
                    targetLabel = `${statePrefix}${targetLabel}: ${unwrapped.key}`;
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
    // Admin AND owner. The force actions, self-approval, tickets, change
    // requests and intercepts are exactly what v0.17 gave the new admin role
    // (owner, 2026-08-26), and the rank test keeps the owner - who outranks
    // admin - holding everything an admin holds.
    const isAdmin = window.rolesMeet(window.currentUserRoles, 'admin');

    // --- TRUSTED EDITOR PERK ---
    // At or above trusted_editor, so reviewer and admin get it too (v0.16
    // bug 6). It used to test the literal 'trusted_editor', which is why a
    // reviewer's own submission still needed two supporters despite the
    // decision that they have a trusted editor's perks.
    //
    // This threshold is a WORKFLOW convention, not a security boundary: it
    // decides whether the MERGE button is rendered, and the write behind it is
    // gated separately by the "Admin Write Live Data" policy. Relaxing it here
    // grants nobody any access they did not already have.
    const isTrusted = (rev.author_roles || []).some(r =>
        window.roleMeets(r, 'trusted_editor'));
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
    // Hoisted out of the branches below (v0.17). It was written inline in two
    // of the three, and the third - the admin one - simply never got a copy,
    // which is how the owner ended up unable to open a ticket at all. One
    // definition, so a branch can only be missing it on purpose.
    //
    // Status-gated because opening a ticket is a one-time transition: the
    // button would be a no-op on a row already in discussion.
    const openTicketBtn = rev.status !== 'ticket_open'
        ? `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`
        : '';

    if (isAdmin) {
        buttonsHTML += editBtn;
        buttonsHTML += requestChangesBtn;
        // The collaborative actions come before the two force actions, which
        // end the revision outright. Same reasoning as the danger row on the
        // Free Submit reset: the irreversible control should not sit where the
        // reversible one is expected.
        buttonsHTML += openTicketBtn;
        buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">FORCE APPROVE</button>`;
        buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">FORCE REJECT</button>`;
    } else {
        if (isOwnSubmission) {
            buttonsHTML += editBtn;
            buttonsHTML += openTicketBtn;
            buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">WITHDRAW</button>`;
        } else {
            buttonsHTML += editBtn;
            buttonsHTML += requestChangesBtn;
            if (hasEnoughSupport) buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">MERGE TO LIVE</button>`;
            buttonsHTML += openTicketBtn;
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

    window.getCharacterTabIds({ editableOnly: true }).forEach(tab => {
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

// v0.17 F5: the revision queue's filters.
//
// `change`, not `input`: initializeMangaSelects replaces these with a custom
// dropdown that only ever dispatches change. The media queue's binding carries
// the same note, and it is the reason a filter that looks wired can silently do
// nothing.
document.addEventListener('DOMContentLoaded', () => {
    ['queue-filter-page', 'queue-filter-status'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.addEventListener('change', renderQueue);
    });
});
