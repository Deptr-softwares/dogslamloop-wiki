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

// v0.17 F13: the contributor can answer the discussion on their own submission.
//
// The owner: "There should be no reason why they get a notification of 'Staff
// are discussing your submission'" without being able to reply. The
// notification has existed since v0.13 and the reply has not.
//
// Shown when there is a conversation to join - any message, or an open ticket
// that has not been written in yet. A pending row nobody has said anything
// about gets nothing, because there is nothing to answer.
function renderTicketThread(rev) {
    const chat = rev.ticket_chat || [];
    const open = rev.status === 'pending' || rev.status === 'ticket_open';
    if (!chat.length && rev.status !== 'ticket_open') return '';

    const messages = chat.length
        ? chat.map(msg => {
            const time = new Date(msg.timestamp).toLocaleString([], {
                dateStyle: 'short', timeStyle: 'short',
            });
            // Three shapes, and `type` is what tells them apart - additive, the
            // way requestChanges established it. A message with no type at all
            // is a staff line from before this shipped.
            if (msg.type === 'changes_requested') {
                return `<div class="ticket-thread-msg ticket-thread-changes">
                    <div class="ticket-thread-who">&#9873; CHANGES REQUESTED &middot; ${escapeHtml(msg.author)} &middot; ${escapeHtml(time)}</div>
                    <div class="ticket-thread-text">${escapeHtml(msg.text)}</div>
                </div>`;
            }
            const mine = msg.type === 'author';
            return `<div class="ticket-thread-msg ${mine ? 'ticket-thread-mine' : 'ticket-thread-staff'}">
                <div class="ticket-thread-who">${escapeHtml(msg.author)}${mine ? ' (you)' : ''} &middot; ${escapeHtml(time)}</div>
                <div class="ticket-thread-text">${escapeHtml(msg.text)}</div>
            </div>`;
        }).join('')
        : `<p class="ticket-thread-empty">A reviewer opened this for discussion. Nothing has been said yet.</p>`;

    // No reply box once the submission is closed - the RPC refuses it anyway,
    // and offering a control that cannot work is worse than not offering one.
    const replyBox = open ? `
        <div class="ticket-thread-reply">
            <textarea id="ticket-reply-${escapeHtml(rev.id)}" class="editor-input ticket-thread-input"
                      rows="2" maxlength="2000" placeholder="Reply to the reviewer..."></textarea>
            <button class="btn-sys btn-sys-blue" id="ticket-send-${escapeHtml(rev.id)}">SEND</button>
        </div>
        <p class="ticket-thread-status" id="ticket-status-${escapeHtml(rev.id)}"></p>` : '';

    return `
        <div class="ticket-thread">
            <h4 class="ticket-thread-title">Discussion</h4>
            <div class="ticket-thread-log">${messages}</div>
            ${replyBox}
        </div>`;
}

// One narrow RPC, never a table write. pending_revisions carries GRANT ALL to
// authenticated and RLS cannot restrict WHICH COLUMNS an update touches, so an
// author appending to ticket_chat through the table is an author who could
// write every other column in the same statement.
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
        // PGRST202 is "this migration has not been applied yet", which is the
        // normal state between deploying this code and the release.
        if (status) {
            status.textContent = (error.code === 'PGRST202' || /schema cache/i.test(error.message || ''))
                ? 'Replying is not available yet - it arrives with the next update.'
                : `Could not send: ${error.message}`;
        }
        return;
    }

    // Append what the SERVER returned rather than what was typed. The author
    // name and timestamp are resolved server-side, so echoing the local guess
    // would show a different message from the one everybody else sees.
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
        const sendBtn = document.getElementById(`ticket-send-${rev.id}`);
        if (sendBtn) sendBtn.onclick = () => sendTicketReply(rev);
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
            ${renderTicketThread(rev)}
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
