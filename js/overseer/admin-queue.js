/**
 * The revision queue: its cards grouped by page, its filters, the preview's
 * table of contents, the action buttons for the open revision, and closing it.
 * @since v0.4, as part of admin.js
 * @touches pending_revisions (with qa_metadata, supporters, opposers),
 *   window.currentQueueData, previewRevision (admin-preview.js), openMergeCompiler
 *   (admin-merge-compiler.js), setQueueCount (admin-core.js), unwrapModeDelta
 * @watch page_id, author names and QA notes are contributor text: escaped, and a
 *   button gets a listener rather than an inline onclick carrying them. The
 *   buttons only decide what to show; RLS gates the writes behind them.
 * @see docs/overseer.md
 */

function updateAdminTOC() {
    const tocList = document.getElementById('dynamic-toc');
    if (!tocList) return;
    tocList.innerHTML = '';

    // Only the pane on screen: the preview area holds every tab and the diff at
    // once, and only visibility tells them apart for both page types.
    const visiblePane = document.querySelector('#preview-content-area > div:not(.hidden)') || document.getElementById('preview-content-area');
    // The side by side draws every heading twice; the list leads to the submission's.
    const activePane = visiblePane.querySelector('.sbs-col-right') || visiblePane;
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
            h.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            h.style.transition = 'color 0.3s ease';
            h.style.color = 'var(--accent-blue)';
            setTimeout(() => h.style.color = '', 800);
        };

        li.appendChild(a);
        tocList.appendChild(li);
    });
}

/**
 * Brings the queue column out or puts it away. Opening a submission or a page's
 * history puts it away, so the pane has the whole width.
 * @since v1.2
 * @watch admin.css limits this to wide screens and to anyone who reviews
 */
window.setQueueOpen = function (open) {
    document.body.classList.toggle('queue-collapsed', !open);
    const toggle = document.getElementById('queue-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
};

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('queue-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
        window.setQueueOpen(document.body.classList.contains('queue-collapsed'));
    });
});

async function loadQueue() {
    const container = document.getElementById('queue-container');
    container.innerHTML = `<p class="loading-msg admin-loading-msg">Scanning database...</p>`;

    const { data, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .in('status', ['pending', 'ticket_open'])
        .order('created_at', { ascending: true });

    if (error) { container.innerHTML = `<p class="admin-error-text">Error: ${window.escapeHtml(error.message)}</p>`; return; }

    window.currentQueueData = data || [];
    populateQueuePageFilter(window.currentQueueData);
    renderQueue();
}

// From the rows that came back, not navigation.json: an expert receives only
// their own pages, and every other page would filter to an empty queue.
function populateQueuePageFilter(rows) {
    const select = document.getElementById('queue-filter-page');
    if (!select) return;

    const previous = select.value;
    const pages = [...new Set(rows.map(r => r.page_id))].sort();

    select.innerHTML = '<option value="all">All pages</option>';
    pages.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id.replace(/_/g, ' ');
        select.appendChild(opt);
    });

    if (previous && pages.includes(previous)) select.value = previous;

    // The site's dropdown copied this select's options before the queue arrived,
    // so it is rebuilt. One not built yet will copy these when it is.
    const built = select.nextElementSibling;
    if (built && built.classList.contains('manga-select-wrapper')) {
        built.remove();
        select.classList.remove('manga-initialized');
        window.initializeMangaSelects();
    }
}

function renderQueue() {
    const container = document.getElementById('queue-container');
    if (!container) return;

    const all = window.currentQueueData || [];
    if (typeof window.setQueueCount === 'function') window.setQueueCount('revisions', all.length);
    const pageFilter = document.getElementById('queue-filter-page')?.value || 'all';
    const statusFilter = document.getElementById('queue-filter-status')?.value || 'all';

    const rows = all.filter(rev =>
        (pageFilter === 'all' || rev.page_id === pageFilter)
        && (statusFilter === 'all' || rev.status === statusFilter));

    container.innerHTML = '';

    // "Nothing is waiting" and "nothing matches" send a reviewer different places.
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

        // The whole page's count, not the filtered one: openMergeCompiler merges every
        // ticket on the page.
        const totalForPage = all.filter(r => r.page_id === pageId).length;

        header.innerHTML = `
            <h3 class="admin-queue-group-title">${window.escapeHtml(pageId.replace(/_/g, ' '))}</h3>
        `;
        if (totalForPage > 1) {
            const mergeBtn = document.createElement('button');
            mergeBtn.className = 'btn-sys btn-sys-purple admin-merge-btn';
            mergeBtn.textContent = `✦ MERGE TICKETS (${totalForPage})`;
            mergeBtn.addEventListener('click', () => window.openMergeCompiler(pageId));
            header.appendChild(mergeBtn);
        }
        container.appendChild(header);

        tickets.forEach(rev => {
            rev.supporters = rev.supporters || [];
            rev.ticket_chat = rev.ticket_chat || [];

            const exactDate = new Date(rev.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
            const relativeTime = timeSince(rev.created_at);

            const statusBadge = rev.status === 'ticket_open'
                ? `<span class="update-badge badge-status-ticket-open">TICKET OPEN</span>`
                : `<span class="update-badge badge-status-pending">PENDING</span>`;

            // The target itself ("MOVE: 5H"), so ten edits on one character tell apart, and
            // a character state's edit names its state.
            const unwrapped = window.unwrapModeDelta(rev.target_scope, rev.target_key);
            const statePrefix = unwrapped.modeId ? `${unwrapped.modeId.toUpperCase()} / ` : '';

            let targetLabel = unwrapped.scope ? unwrapped.scope.toUpperCase() : '';
            if (rev.target_scope === 'multi') {
                // A batched or merged ticket has no single target, so it counts them.
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

            // A rough size hint, taken once at load from the changed content alone.
            const sizeSource = rev.is_delta ? rev.delta_payload : { desc: rev.desc_data, frame: rev.frame_data };
            const sizeBytes = JSON.stringify(sizeSource || {}).length;
            const sizeTier = sizeBytes > 3000 ? 'l' : (sizeBytes > 500 ? 'm' : 's');
            const sizeBadge = `<span class="update-badge badge-size-${sizeTier}" data-tip="${sizeBytes} bytes of changed content">${sizeTier.toUpperCase()}</span>`;

            const card = document.createElement('div');
            card.className = 'update-log-item';
            card.innerHTML = `
                <div class="admin-queue-card-header">
                    <div class="admin-queue-card-info">
                        <div class="admin-queue-badges-row">
                            ${statusBadge}
                            <span class="update-badge badge-page-id">${window.escapeHtml(rev.page_id.toUpperCase())}</span>
                            ${deltaBadge}
                            ${sizeBadge}
                            ${confidenceBadge(rev)}
                        </div>
                        <h3 class="update-title">REVISION SUBMISSION</h3>
                        <div class="update-log-meta">
                            By: <strong class="admin-queue-author-name">${window.escapeHtml(rev.author_name)}</strong><br>
                            <span class="admin-queue-time-relative">${relativeTime}</span> <span class="admin-queue-time-exact">(${exactDate})</span>
                        </div>
                        ${qaNote(rev)}
                    </div>
                    <button class="btn-sys btn-sys-blue admin-review-btn">REVIEW</button>
                </div>
            `;
            card.querySelector('.admin-review-btn').addEventListener('click', () => previewRevision(rev.id));
            container.appendChild(card);
        });
    }
}

// The contributor's changelog, confidence and evidence, on the card, so a
// reviewer can choose what to open next. All contributor text: escaped, and
// confidence goes through a fixed table, never into a class name.
const QA_CONFIDENCE = {
    high: { cls: 'badge-confidence-high', label: 'HIGH' },
    medium: { cls: 'badge-confidence-medium', label: 'MEDIUM' },
    low: { cls: 'badge-confidence-low', label: 'LOW' },
    'n/a': { cls: 'badge-confidence-na', label: 'N/A' },
};

function confidenceBadge(rev) {
    const qa = rev && rev.qa_metadata;
    const level = qa && typeof qa.confidence === 'string' ? qa.confidence.toLowerCase() : null;
    const known = level && Object.prototype.hasOwnProperty.call(QA_CONFIDENCE, level)
        ? QA_CONFIDENCE[level] : null;
    // Silent when absent: older revisions and tickets have no QA notes.
    if (!known) return '';
    return `<span class="update-badge ${known.cls}" data-tip="Data confidence, stated by the contributor">${known.label}</span>`;
}

function qaNote(rev) {
    const qa = rev && rev.qa_metadata;
    if (!qa) return '';

    const changelog = typeof qa.changelog === 'string' ? qa.changelog.trim() : '';
    const evidence = typeof qa.evidence === 'string' ? qa.evidence.trim() : '';
    if (!changelog && !evidence) return '';

    let html = '<div class="admin-queue-qa">';
    if (changelog) {
        // Clamped in CSS, so the whole note stays selectable and findable.
        html += `<p class="admin-queue-qa-note">${window.escapeHtml(changelog)}</p>`;
    }
    if (evidence) {
        // Not a link: one click from a staff page to a contributor's address is a
        // phishing step. The address is in the ticket.
        html += `<p class="admin-queue-qa-evidence" data-tip="${window.escapeHtml(evidence)}">Evidence cited</p>`;
    }
    return html + '</div>';
}

function updateActionButtons(rev) {
    const actionContainer = document.getElementById('preview-action-buttons');
    const isOwnSubmission = (rev.author_id === window.currentUserId);
    const isAdmin = window.rolesMeet(window.currentUserRoles, 'admin');

    // At or above trusted_editor, by rank. A workflow rule, not a boundary: the
    // live write is gated by RLS.
    const isTrusted = (rev.author_roles || []).some(r =>
        window.roleMeets(r, 'trusted_editor'));
    const requiredSupport = isTrusted ? 1 : 2;

    const supportersCount = (rev.supporters || []).length;
    const opposersCount = (rev.opposers || []).length;
    const netScore = supportersCount - opposersCount;

    const hasEnoughSupport = (netScore >= requiredSupport);
    const hasEnoughOppose = (netScore <= -2);

    let buttonsHTML = '';

    const editBtn = `<button onclick="editCurrentTicket()" class="btn-sys btn-sys-purple">INTERCEPT & EDIT</button>`;
    // Written feedback back to the author, repeatable, and never offered on your
    // own submission.
    const requestChangesBtn = `<button onclick="requestChanges()" class="btn-sys btn-sys-yellow">REQUEST CHANGES</button>`;
    // One definition for every branch below, so a branch lacks it only on purpose.
    // A row already in discussion has nothing to open.
    const openTicketBtn = rev.status !== 'ticket_open'
        ? `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`
        : '';

    if (isAdmin) {
        buttonsHTML += editBtn;
        buttonsHTML += requestChangesBtn;
        // The collaborative actions come before the force actions, which end the
        // revision outright.
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
    const qaReport = document.getElementById('qa-report-panel');
    if (qaReport) qaReport.classList.add('hidden');
    // The list of past versions belongs to what was open, like the rest.
    const pageHistory = document.getElementById('page-history-container');
    if (pageHistory) pageHistory.classList.add('hidden');

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.classList.add('hidden');

    const contentArea = document.getElementById('preview-content-area');
    contentArea.classList.remove('active');

    const tabNav = document.getElementById('preview-tab-nav');
    if (tabNav) tabNav.classList.add('hidden');

    window.getCharacterTabIds({ editableOnly: true }).forEach(tab => {
        const el = document.getElementById(`tab-${tab}`);
        const btn = document.getElementById(`nav-${tab}`);
        if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
        if (btn) {
            btn.classList.remove('active');
            btn.classList.remove('tab-changed'); // Markers belong to the revision just closed
            btn.classList.remove('hidden');
        }
    });

    document.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    document.getElementById('tab-overview').classList.remove('hidden');
    document.getElementById('nav-overview').classList.add('active');
    document.getElementById('dynamic-toc').innerHTML = '<li><p class="admin-toc-empty">Navigation unavailable.</p></li>';
}

// `change`, not `input`: the site's custom dropdown only dispatches change.
document.addEventListener('DOMContentLoaded', () => {
    ['queue-filter-page', 'queue-filter-status'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.addEventListener('change', renderQueue);
    });
});
