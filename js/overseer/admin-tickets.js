/**
 * A revision's ticket: the vote (SUPPORT, OPPOSE) with the score it needs, and
 * the chat between staff and the contributor.
 * @since v0.4, as part of admin.js
 * @touches pending_revisions (supporters, opposers, ticket_chat),
 *   post_ticket_message(), user_notifications, updateActionButtons (admin-queue.js)
 * @watch the score it needs must match updateActionButtons in admin-queue.js: this
 *   one prints it, that one shows MERGE. Chat text and names are contributor
 *   text: escaped.
 * @see docs/overseer.md
 */

function renderTicketWorkspace(rev, isOwnSubmission, hasSupported, hasOpposed) {
    const supportText = document.getElementById('ticket-support-text');
    const opposeText = document.getElementById('ticket-oppose-text');
    const supportActions = document.getElementById('ticket-support-actions');
    const chatLog = document.getElementById('ticket-chat-log');

    rev.supporters = rev.supporters || [];
    rev.opposers = rev.opposers || [];

    // At or above trusted_editor, matching admin-queue.js.
    const isTrusted = (rev.author_roles || []).some(r =>
        window.roleMeets(r, 'trusted_editor'));
    const requiredSupport = isTrusted ? 1 : 2;
    const netScore = rev.supporters.length - rev.opposers.length;

    let scoreColor = "var(--text-white)";
    if (netScore > 0) scoreColor = "#22c55e";
    if (netScore < 0) scoreColor = "#ef4444";

    supportText.innerHTML = `Net Approval Score: <strong class="ticket-score-value" style="color:${scoreColor};">${netScore > 0 ? '+' : ''}${netScore}</strong>`;

    // "Staff", since reviewers and admins get the perk too.
    const perkHtml = isTrusted ? ` <span class="ticket-perk-note">(Staff Perk Applied)</span>` : '';
    opposeText.innerHTML = `<span class="ticket-requirement-text">Requires +${requiredSupport} to Merge, or -2 to Reject${perkHtml}</span>`;

    if (isOwnSubmission) {
        supportActions.innerHTML = `<span class="ticket-own-submission-note">Cannot vote on own submission.</span>`;
    } else {
        const supBtn = hasSupported
            ? `<button type="button" onclick="toggleSupportToTicket()" class="btn-sys btn-sys-regular ticket-vote-btn">UN-SUPPORT</button>`
            : `<button type="button" onclick="toggleSupportToTicket()" class="btn-sys btn-sys-green ticket-vote-btn">SUPPORT</button>`;

        const oppBtn = hasOpposed
            ? `<button type="button" onclick="toggleOpposeToTicket()" class="btn-sys btn-sys-regular ticket-vote-btn">REMOVE OPPOSE</button>`
            : `<button type="button" onclick="toggleOpposeToTicket()" class="btn-sys btn-sys-yellow ticket-vote-btn">OPPOSE</button>`;

        supportActions.innerHTML = `<div class="ticket-vote-actions-row">${supBtn}${oppBtn}</div>`;
    }

    chatLog.innerHTML = '';
    if (rev.ticket_chat.length === 0) {
        chatLog.innerHTML = `<span class="ticket-chat-empty">No messages yet.</span>`;
    } else {
        rev.ticket_chat.forEach(msg => {
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            if (msg.type === 'changes_requested') {
                chatLog.innerHTML += `
                    <div class="ticket-chat-changes-requested">
                        <div class="ticket-chat-changes-requested-label">⚑ CHANGES REQUESTED by ${window.escapeHtml(msg.author)} · ${timeStr}</div>
                        <div class="ticket-chat-changes-requested-text">${window.escapeHtml(msg.text)}</div>
                    </div>`;
            } else if (msg.type === 'author') {
                // The contributor's own replies are typed, so a reviewer tells the two sides
                // apart. Untyped messages are staff lines.
                chatLog.innerHTML += `
                    <div class="ticket-chat-from-author">
                        <strong class="ticket-chat-author-badge">[${timeStr}] ${window.escapeHtml(msg.author)} (contributor):</strong>
                        ${window.escapeHtml(msg.text)}
                    </div>`;
            } else {
                chatLog.innerHTML += `<div><strong class="ticket-chat-author">[${timeStr}] ${window.escapeHtml(msg.author)}:</strong> ${window.escapeHtml(msg.text)}</div>`;
            }
        });
        chatLog.scrollTop = chatLog.scrollHeight;
    }
}

async function toggleSupportToTicket() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (rev.author_id === window.currentUserId) return;

    const { data: liveRev } = await window.supabaseClient.from('pending_revisions').select('supporters, opposers').eq('id', rev.id).single();
    let newSupporters = liveRev.supporters || [];
    let newOpposers = liveRev.opposers || [];

    if (newSupporters.includes(window.currentUserId)) {
        newSupporters = newSupporters.filter(id => id !== window.currentUserId);
    } else {
        newSupporters.push(window.currentUserId);
        newOpposers = newOpposers.filter(id => id !== window.currentUserId);
    }

    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);

    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    // Only the vote buttons: a full previewRevision reset the reviewer's view on
    // every vote.
    updateActionButtons(rev);
}

async function toggleOpposeToTicket() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (rev.author_id === window.currentUserId) return;

    const { data: liveRev } = await window.supabaseClient.from('pending_revisions').select('supporters, opposers').eq('id', rev.id).single();
    let newSupporters = liveRev.supporters || [];
    let newOpposers = liveRev.opposers || [];

    if (newOpposers.includes(window.currentUserId)) {
        newOpposers = newOpposers.filter(id => id !== window.currentUserId);
    } else {
        newOpposers.push(window.currentUserId);
        newSupporters = newSupporters.filter(id => id !== window.currentUserId);
    }

    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);

    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    updateActionButtons(rev);
}

async function postTicketMessage() {
    if (!window.activePreviewRevId) return;
    const input = document.getElementById('ticket-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    // Read only for the notification below. The RPC appends in SQL, so two replies
    // at once both land.
    const { data: liveRev, error: fetchErr } = await window.supabaseClient.from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];

    // The RPC sets the author's name, so a message cannot claim to be someone else.
    const { data: newMessage, error } = await window.supabaseClient.rpc('post_ticket_message', {
        target_revision_id: rev.id,
        message_text: text,
    });

    input.disabled = false;
    input.value = '';

    if (error) {
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        adminAlert(notDeployed
            ? "Ticket replies aren't available yet - the database function arrives with the next migration."
            : "Failed to send message: " + error.message);
        return;
    }

    const newChat = [...currentChat, newMessage];

    // The author is notified on the first staff reply only, and never once their
    // account is anonymized (author_id NULL).
    const isAuthorsOwnTicket = rev.author_id === window.currentUserId;
    const hadPriorStaffReply = currentChat.some(m => m.author !== rev.author_name);
    if (rev.author_id && !isAuthorsOwnTicket && !hadPriorStaffReply) {
        await window.supabaseClient.from('user_notifications').insert([{
            user_id: rev.author_id,
            message: `Staff replied to the discussion on your "${rev.page_id.toUpperCase()}" revision.`,
            link: 'submissions.html'
        }]);
    }

    rev.ticket_chat = newChat;
    renderTicketWorkspace(rev, rev.author_id === window.currentUserId, (rev.supporters || []).includes(window.currentUserId), (rev.opposers || []).includes(window.currentUserId));
    setTimeout(() => document.getElementById('ticket-chat-input').focus(), 10);
}
