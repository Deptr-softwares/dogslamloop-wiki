/**
 * My Submissions (submissions.html): a contributor's own submissions, with their
 * status, the ticket's discussion and a reply box, EDIT and WITHDRAW. Open to
 * anyone signed in, whatever their role.
 * @since v0.6
 * @touches pending_revisions (the author's own rows), post_ticket_message(),
 *   registeredPageType (site_utils.js)
 * @watch a reply goes through the RPC, never a table write: pending_revisions
 *   grants all to authenticated, and RLS cannot limit which columns an update
 *   touches. Chat text is someone else's: escaped.
 * @see docs/records.md
 */

function showConfirm(message, confirmText = 'CONFIRM', isDanger = false) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML = `
        <div class="modal-box modal-md accent-blue">
            <div class="modal-header"><h3>PLEASE CONFIRM</h3></div>
            <div class="modal-body"><p>${window.escapeHtml(message)}</p></div>
            <div class="modal-footer">
                <button class="btn-sys btn-sys-regular" id="submissions-confirm-cancel">CANCEL</button>
                <button class="btn-sys ${isDanger ? 'btn-sys-red' : 'btn-sys-green'}" id="submissions-confirm-ok">${window.escapeHtml(confirmText)}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    return window.runDialog(overlay, {
        buttons: [
            [overlay.querySelector('#submissions-confirm-cancel'), false],
            [overlay.querySelector('#submissions-confirm-ok'), true],
        ],
        cancel: false,
        onClose: () => overlay.remove(),
    });
}

function showAlert(message) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML = `
        <div class="modal-box modal-md accent-blue">
            <div class="modal-header"><h3>NOTICE</h3></div>
            <div class="modal-body"><p>${window.escapeHtml(message)}</p></div>
            <div class="modal-footer">
                <button class="btn-sys btn-sys-regular" id="submissions-alert-ok">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    window.runDialog(overlay, {
        buttons: [[overlay.querySelector('#submissions-alert-ok')]],
        onClose: () => overlay.remove(),
    });
}

const STATUS_LABELS = {
    pending: { label: 'PENDING REVIEW', className: 'badge-status-pending' },
    ticket_open: { label: 'IN DISCUSSION', className: 'badge-status-ticket-open' },
    approved: { label: 'APPROVED', className: 'badge-status-approved' },
    rejected: { label: 'DECLINED', className: 'badge-status-rejected' },
    withdrawn: { label: 'WITHDRAWN', className: 'badge-status-withdrawn' },
};

// A changes-requested message is a more specific state than "in discussion", so
// it gets its own badge and callout.
function latestChangesRequested(rev) {
    const chat = rev.ticket_chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].type === 'changes_requested') return chat[i];
    }
    return null;
}

// Shown when there is a conversation to join: any message, or an open ticket not
// yet written in.
function renderTicketThread(rev) {
    const chat = rev.ticket_chat || [];
    const open = rev.status === 'pending' || rev.status === 'ticket_open';
    if (!chat.length && rev.status !== 'ticket_open') return '';

    const messages = chat.length
        ? chat.map(msg => {
            const time = new Date(msg.timestamp).toLocaleString([], {
                dateStyle: 'short', timeStyle: 'short',
            });
            // Three shapes, told apart by `type`; an untyped message is a staff line.
            if (msg.type === 'changes_requested') {
                return `<div class="ticket-thread-msg ticket-thread-changes">
                    <div class="ticket-thread-who">&#9873; CHANGES REQUESTED &middot; ${window.escapeHtml(msg.author)} &middot; ${window.escapeHtml(time)}</div>
                    <div class="ticket-thread-text">${window.escapeHtml(msg.text)}</div>
                </div>`;
            }
            const mine = msg.type === 'author';
            return `<div class="ticket-thread-msg ${mine ? 'ticket-thread-mine' : 'ticket-thread-staff'}">
                <div class="ticket-thread-who">${window.escapeHtml(msg.author)}${mine ? ' (you)' : ''} &middot; ${window.escapeHtml(time)}</div>
                <div class="ticket-thread-text">${window.escapeHtml(msg.text)}</div>
            </div>`;
        }).join('')
        : `<p class="ticket-thread-empty">A reviewer opened this for discussion. Nothing has been said yet.</p>`;

    // No reply box once the submission is closed: the RPC refuses it anyway.
    const replyBox = open ? `
        <div class="ticket-thread-reply">
            <textarea id="ticket-reply-${window.escapeHtml(rev.id)}" class="editor-input ticket-thread-input"
                      rows="2" maxlength="2000" placeholder="Reply to the reviewer..."></textarea>
            <button class="btn-sys btn-sys-blue" id="ticket-send-${window.escapeHtml(rev.id)}">SEND</button>
        </div>
        <p class="ticket-thread-status" id="ticket-status-${window.escapeHtml(rev.id)}"></p>` : '';

    return `
        <div class="ticket-thread">
            <h4 class="ticket-thread-title">Discussion</h4>
            <div class="ticket-thread-log">${messages}</div>
            ${replyBox}
        </div>`;
}

// One narrow RPC, never a table write: an author appending to ticket_chat through
// the table could write every other column in the same statement.
async function sendTicketReply(rev) {
    const input = document.getElementById(`ticket-reply-${rev.id}`);
    const status = document.getElementById(`ticket-status-${rev.id}`);
    const btn = document.getElementById(`ticket-send-${rev.id}`);
    if (!input || !btn) return;

    const text = input.value.trim();
    if (!text) { if (status) status.textContent = 'Write something first.'; return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'SENDING...';
    if (status) status.textContent = '';

    const { data, error } = await window.supabaseClient.rpc('post_ticket_message', {
        target_revision_id: rev.id,
        message_text: text,
    });

    btn.disabled = false;
    btn.textContent = original;

    if (error) {
        // Normal between deploying this code and the release that applies its migration.
        if (status) {
            status.textContent = (error.code === 'PGRST202' || /schema cache/i.test(error.message || ''))
                ? 'Replying is not available yet - it arrives with the next update.'
                : `Could not send: ${error.message}`;
        }
        return;
    }

    // What the server returned, not what was typed: it sets the author's name and the
    // time.
    input.value = '';
    rev.ticket_chat = [...(rev.ticket_chat || []), data];
    const log = document.querySelector(`#ticket-reply-${rev.id}`)
        ?.closest('.ticket-thread')?.querySelector('.ticket-thread-log');
    if (log) {
        const empty = log.querySelector('.ticket-thread-empty');
        if (empty) empty.remove();
        const wrap = document.createElement('div');
        wrap.className = 'ticket-thread-msg ticket-thread-mine';
        const who = document.createElement('div');
        who.className = 'ticket-thread-who';
        who.textContent = `${data.author} (you) · ${new Date(data.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
        const body = document.createElement('div');
        body.className = 'ticket-thread-text';
        body.textContent = data.text;
        wrap.appendChild(who); wrap.appendChild(body);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
    }
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
        listEl.innerHTML = `<div class="wiki-section login-required-card"><p class="loading-msg">Failed to load your submissions: ${window.escapeHtml(error.message)}</p></div>`;
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
        const sendBtn = document.getElementById(`ticket-send-${rev.id}`);
        if (sendBtn) sendBtn.onclick = () => sendTicketReply(rev);
    });
}

function renderSubmissionCard(rev) {
    // Cloned: it is changed per card below, and STATUS_LABELS is shared.
    const statusInfo = { ...(STATUS_LABELS[rev.status] || { label: (rev.status || 'UNKNOWN').toUpperCase(), className: 'badge-status-pending' }) };
    const canEdit = (rev.status === 'pending' || rev.status === 'ticket_open');

    const dateStr = new Date(rev.created_at).toLocaleString();

    let targetLabel;
    if (rev.is_delta) {
        const scopeLabel = (rev.target_scope || 'section').toUpperCase();
        targetLabel = rev.target_key ? `${scopeLabel}: ${window.escapeHtml(rev.target_key)}` : scopeLabel;
    } else {
        targetLabel = 'FULL PAGE REWRITE';
    }

    const qa = rev.qa_metadata || {};
    const changelog = qa.changelog ? `<div class="submission-changelog">${window.escapeHtml(qa.changelog)}</div>` : '';
    const rejectionReason = (rev.status === 'rejected' && qa.rejection_reason)
        ? `<div class="submission-rejection-reason"><strong>Staff Note:</strong> ${window.escapeHtml(qa.rejection_reason)}</div>`
        : '';

    const changesRequested = rev.status === 'ticket_open' ? latestChangesRequested(rev) : null;
    if (changesRequested) {
        statusInfo.label = 'CHANGES REQUESTED';
        statusInfo.className = 'badge-status-changes-requested';
    }
    const changesRequestedNote = changesRequested
        ? `<div class="submission-rejection-reason"><strong>Reviewer asked for:</strong> ${window.escapeHtml(changesRequested.text)}</div>`
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
                        <span class="update-badge badge-site">${window.escapeHtml((rev.page_id || '').toUpperCase())}</span>
                        <span class="update-badge badge-patch">${targetLabel}</span>
                    </div>
                    <div class="submission-meta">Submitted ${dateStr}</div>
                </div>
            </div>
            ${changelog}
            ${rejectionReason}
            ${changesRequestedNote}
            ${renderTicketThread(rev)}
            ${actions}
        </section>
    `;
}

/**
 * The editor link for one submission: its page, its kind (&type=, or every page
 * opens as a character) and, for a character's delta, the tab or move it changed.
 * @since v0.16
 * @watch a copy of the routing in editCurrentTicket (admin-actions.js), which lives
 *   on overseer.html. The kind comes from the page list, never the submission's
 *   page_type.
 */
window.buildSubmissionEditUrl = async function (rev) {
    const pageType = (await window.registeredPageType(rev.page_id)) || 'character';
    let url = `edit.html?char=${encodeURIComponent(rev.page_id)}`
        + `&type=${encodeURIComponent(pageType)}`
        + `&editTicket=${encodeURIComponent(rev.id)}`;

    // The deep link is character vocabulary; a system page's editor builds its own
    // tabs, so none is made up for one.
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

async function editSubmission(rev) {
    window.location.href = await window.buildSubmissionEditUrl(rev);
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
