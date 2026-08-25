/**
 * Dogslamloop Wiki - My Submissions (contributor self-service)
 *
 * First page in the codebase gated to "must be logged in, any role" - no
 * admin/reviewer check at all, unlike admin.html/owner.html. Lets a
 * contributor see, edit, and withdraw their own pending_revisions rows
 * without needing staff access, closing the gap where submitting an edit
 * used to be a one-way trip into a black box (see project memory: v0.6
 * item 4, "reviewer workflow/UI redesign", Phase 1).
 */

// Duplicated from js/admin-core.js rather than shared, matching this
// codebase's existing precedent (see js/owner.js's kickUser) of small
// per-file duplication over new cross-file coupling.
function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- LIGHTWEIGHT DSL MODAL HELPERS (dynamic, no static markup needed) ---
function showConfirm(message, confirmText = 'CONFIRM', isDanger = false) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box modal-md accent-blue">
                <div class="modal-header"><h3>PLEASE CONFIRM</h3></div>
                <div class="modal-body"><p>${escapeHtml(message)}</p></div>
                <div class="modal-footer">
                    <button class="btn-sys btn-sys-regular" id="submissions-confirm-cancel">CANCEL</button>
                    <button class="btn-sys ${isDanger ? 'btn-sys-red' : 'btn-sys-green'}" id="submissions-confirm-ok">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cleanup = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('#submissions-confirm-cancel').onclick = () => cleanup(false);
        overlay.querySelector('#submissions-confirm-ok').onclick = () => cleanup(true);
    });
}

function showAlert(message) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box modal-md accent-blue">
            <div class="modal-header"><h3>NOTICE</h3></div>
            <div class="modal-body"><p>${escapeHtml(message)}</p></div>
            <div class="modal-footer">
                <button class="btn-sys btn-sys-regular" id="submissions-alert-ok">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#submissions-alert-ok').onclick = () => overlay.remove();
}

const STATUS_LABELS = {
    pending: { label: 'PENDING REVIEW', className: 'badge-status-pending' },
    ticket_open: { label: 'IN DISCUSSION', className: 'badge-status-ticket-open' },
    approved: { label: 'APPROVED', className: 'badge-status-approved' },
    rejected: { label: 'DECLINED', className: 'badge-status-rejected' },
    withdrawn: { label: 'WITHDRAWN', className: 'badge-status-withdrawn' },
};

// A ticket_open submission with a changes_requested chat message is a more
// specific, actionable state than generic "in discussion" - surface it as
// its own badge/callout instead of making the contributor open the ticket
// to discover a reviewer is waiting on a specific fix.
function latestChangesRequested(rev) {
    const chat = rev.ticket_chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].type === 'changes_requested') return chat[i];
    }
    return null;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.initSidebarToggle) window.initSidebarToggle();
    if (window.initMobileNav) window.initMobileNav();
    if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (window.initAuthDock) window.initAuthDock();

    const listEl = document.getElementById('submissions-list');

    if (!window.supabaseClient) {
        listEl.innerHTML = `<div class="wiki-section login-required-card"><p class="loading-msg">Database disconnected.</p></div>`;
        return;
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        listEl.innerHTML = `
            <div class="wiki-section login-required-card">
                <p style="margin-bottom: 1rem;">You need to be logged in to see your submissions.</p>
                <button class="btn-sys btn-sys-blue" id="submissions-login-btn">LOG IN</button>
            </div>
        `;
        const loginBtn = document.getElementById('submissions-login-btn');
        if (loginBtn && window.openAuthModal) loginBtn.onclick = window.openAuthModal;
        return;
    }

    window.currentSessionUserId = session.user.id;
    await loadSubmissions();
});

async function loadSubmissions() {
    const listEl = document.getElementById('submissions-list');

    const { data: revisions, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .eq('author_id', window.currentSessionUserId)
        .order('created_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<div class="wiki-section login-required-card"><p class="loading-msg">Failed to load your submissions: ${escapeHtml(error.message)}</p></div>`;
        return;
    }

    if (!revisions || revisions.length === 0) {
        listEl.innerHTML = `<div class="wiki-section login-required-card"><p>You haven't submitted any edits yet.</p></div>`;
        return;
    }

    listEl.innerHTML = revisions.map(renderSubmissionCard).join('');

    revisions.forEach(rev => {
        const editBtn = document.getElementById(`submission-edit-${rev.id}`);
        if (editBtn) editBtn.onclick = () => editSubmission(rev);
        const withdrawBtn = document.getElementById(`submission-withdraw-${rev.id}`);
        if (withdrawBtn) withdrawBtn.onclick = () => withdrawSubmission(rev.id);
    });
}

function renderSubmissionCard(rev) {
    // Cloned, not a reference - this gets overridden per-card below for the
    // changes-requested case, and STATUS_LABELS is a shared constant reused
    // across every card render.
    const statusInfo = { ...(STATUS_LABELS[rev.status] || { label: (rev.status || 'UNKNOWN').toUpperCase(), className: 'badge-status-pending' }) };
    const canEdit = (rev.status === 'pending' || rev.status === 'ticket_open');

    const dateStr = new Date(rev.created_at).toLocaleString();

    let targetLabel;
    if (rev.is_delta) {
        const scopeLabel = (rev.target_scope || 'section').toUpperCase();
        targetLabel = rev.target_key ? `${scopeLabel}: ${escapeHtml(rev.target_key)}` : scopeLabel;
    } else {
        targetLabel = 'FULL PAGE REWRITE';
    }

    const qa = rev.qa_metadata || {};
    const changelog = qa.changelog ? `<div class="submission-changelog">${escapeHtml(qa.changelog)}</div>` : '';
    const rejectionReason = (rev.status === 'rejected' && qa.rejection_reason)
        ? `<div class="submission-rejection-reason"><strong>Staff Note:</strong> ${escapeHtml(qa.rejection_reason)}</div>`
        : '';

    // A ticket_open row with a changes-requested message is more specific
    // and actionable than the generic "IN DISCUSSION" badge - swap it in.
    const changesRequested = rev.status === 'ticket_open' ? latestChangesRequested(rev) : null;
    if (changesRequested) {
        statusInfo.label = 'CHANGES REQUESTED';
        statusInfo.className = 'badge-status-changes-requested';
    }
    const changesRequestedNote = changesRequested
        ? `<div class="submission-rejection-reason"><strong>Reviewer asked for:</strong> ${escapeHtml(changesRequested.text)}</div>`
        : '';

    const actions = canEdit ? `
        <div class="submission-actions">
            <button class="btn-sys btn-sys-blue" id="submission-edit-${rev.id}">EDIT</button>
            <button class="btn-sys btn-sys-red" id="submission-withdraw-${rev.id}">WITHDRAW</button>
        </div>
    ` : '';

    return `
        <section class="wiki-section submission-card">
            <div class="submission-card-header">
                <div>
                    <div class="submission-badges-row">
                        <span class="update-badge ${statusInfo.className}">${statusInfo.label}</span>
                        <span class="update-badge badge-site">${escapeHtml((rev.page_id || '').toUpperCase())}</span>
                        <span class="update-badge badge-patch">${targetLabel}</span>
                    </div>
                    <div class="submission-meta">Submitted ${dateStr}</div>
                </div>
            </div>
            ${changelog}
            ${rejectionReason}
            ${changesRequestedNote}
            ${actions}
        </section>
    `;
}

// Mirrors js/admin-actions.js's editCurrentTicket smart-routing logic (jump
// straight to the tab/move that was actually edited for a delta patch) -
// can't call that function directly, it lives on admin.html's page and
// reads admin-only globals (window.currentQueueData, adminConfirm).
// Split out from editSubmission so the routing can be tested without the
// navigation that used to be the only way to observe it.
//
// &type= is load-bearing and was missing (v0.16 bug 5). js/editor-core.js reads
// `urlParams.get('type') || 'character'`, so a submission against a system, tool
// or tier list page opened the editor in CHARACTER mode: a character tab strip
// over system data, and the intercepted ticket rendering into nothing. The id
// survived either way, which is why this looked like it worked right up until
// the page was not a character.
window.buildSubmissionEditUrl = function (rev) {
    const pageType = rev.page_type || 'character';
    let url = `edit.html?char=${encodeURIComponent(rev.page_id)}`
        + `&type=${encodeURIComponent(pageType)}`
        + `&editTicket=${encodeURIComponent(rev.id)}`;

    // The deep link below is character vocabulary - `matchups`, `counterplay`,
    // `m1s::5H`. A system page's scopes are system_tab / system_section, and its
    // editor builds its own tab list, so deriving a character tab for one would
    // be inventing a destination that does not exist.
    if (rev.is_delta && pageType === 'character') {
        let tab = 'overview';
        if (['matchup', 'counterplay'].includes(rev.target_scope)) tab = rev.target_scope + 's';
        else if (rev.target_scope === 'move') {
            tab = rev.target_key.split('::')[0];
            const moveId = rev.target_key.split('::')[1];
            url += `&tab=${encodeURIComponent(tab)}&move=${encodeURIComponent(moveId)}`;
        }
        if (rev.target_scope !== 'move') url += `&tab=${encodeURIComponent(tab)}`;
    }

    return url;
};

function editSubmission(rev) {
    window.location.href = window.buildSubmissionEditUrl(rev);
}

async function withdrawSubmission(revId) {
    const confirmed = await showConfirm('Withdraw this submission? It will be removed from the review queue - you can resubmit fresh later if you change your mind.', 'WITHDRAW', true);
    if (!confirmed) return;

    const { error } = await window.supabaseClient
        .from('pending_revisions')
        .update({ status: 'withdrawn' })
        .eq('id', revId)
        .eq('author_id', window.currentSessionUserId);

    if (error) {
        showAlert('Failed to withdraw: ' + error.message);
        return;
    }

    await loadSubmissions();
}
