/**
 * Dogslamloop Wiki - Admin Overseer: Tickets (discuss-and-vote workspace)
 */

// --- 4. TICKET LOGIC (VOTING & CHAT) ---
function renderTicketWorkspace(rev, isOwnSubmission, hasSupported, hasOpposed) {
    const supportText = document.getElementById('ticket-support-text');
    const opposeText = document.getElementById('ticket-oppose-text');
    const supportActions = document.getElementById('ticket-support-actions');
    const chatLog = document.getElementById('ticket-chat-log');

    rev.supporters = rev.supporters || [];
    rev.opposers = rev.opposers || [];

    // --- NET SCORE UI WITH PERKS ---
    const isTrusted = (rev.author_roles || []).includes('trusted_editor');
    const requiredSupport = isTrusted ? 1 : 2;
    const netScore = rev.supporters.length - rev.opposers.length;

    let scoreColor = "var(--text-white)";
    if (netScore > 0) scoreColor = "#22c55e";
    if (netScore < 0) scoreColor = "#ef4444";

    supportText.innerHTML = `Net Approval Score: <strong class="ticket-score-value" style="color:${scoreColor};">${netScore > 0 ? '+' : ''}${netScore}</strong>`;

    const perkHtml = isTrusted ? ` <span class="ticket-perk-note">(Trusted Editor Perk Applied)</span>` : '';
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

    const qa = rev.qa_metadata || {};
    // changelog/confidence/evidence are all typed by whoever submitted the
    // revision - not staff - so they're escaped like the chat log below.
    // evidence additionally only renders as a clickable link for http(s)
    // URLs (rejects e.g. a javascript: URI slipped into the field).
    const isSafeEvidenceUrl = qa.evidence && /^https?:\/\//i.test(qa.evidence);
    const evidenceHtml = isSafeEvidenceUrl
        ? `<a href="${window.escapeHtml(qa.evidence)}" target="_blank" rel="noopener noreferrer" class="ticket-qa-link">[View Attached Link]</a>`
        : (qa.evidence ? 'Evidence link is not a valid http(s) URL.' : 'No evidence linked.');
    const qaHtml = `
        <div class="ticket-qa-field"><strong class="ticket-qa-label">Changelog:</strong><br>${qa.changelog ? window.escapeHtml(qa.changelog) : 'No changelog provided.'}</div>
        <div class="ticket-qa-field"><strong class="ticket-qa-label">Confidence:</strong><br>${qa.confidence ? window.escapeHtml(qa.confidence) : 'Unrated'}</div>
        <div><strong class="ticket-qa-label">Evidence:</strong><br>${evidenceHtml}</div>
    `;
    document.getElementById('ticket-qa-report').innerHTML = qaHtml;

    chatLog.innerHTML = '';
    if (rev.ticket_chat.length === 0) {
        chatLog.innerHTML = `<span class="ticket-chat-empty">No messages yet.</span>`;
    } else {
        rev.ticket_chat.forEach(msg => {
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            // type: 'changes_requested' (js/admin-actions.js's requestChanges)
            // gets a distinct look so it reads as a first-class request, not
            // just another passing chat line - existing messages have no
            // `type` field at all and fall through to the plain rendering.
            if (msg.type === 'changes_requested') {
                chatLog.innerHTML += `
                    <div class="ticket-chat-changes-requested">
                        <div class="ticket-chat-changes-requested-label">⚑ CHANGES REQUESTED by ${window.escapeHtml(msg.author)} · ${timeStr}</div>
                        <div class="ticket-chat-changes-requested-text">${window.escapeHtml(msg.text)}</div>
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
    // Refresh just the vote-dependent action buttons (MERGE TO LIVE/REJECT
    // thresholds) - same lightweight pattern previewRevision's own realtime
    // listener uses for a vote change from another reviewer. Previously
    // called the full previewRevision() here, which re-fetched live/pending
    // page data, recalculated the whole diff, and reset whichever view
    // (pending/live/diff) the reviewer had open back to the default every
    // time anyone voted - a real "voting knocks you back to the top"
    // regression for something that only changed vote counts.
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

    const { data: liveRev, error: fetchErr } = await window.supabaseClient.from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];

    const newMessage = { author: window.currentUsername, text: text, timestamp: Date.now() };
    const newChat = [...currentChat, newMessage];

    const { error } = await window.supabaseClient.from('pending_revisions').update({ ticket_chat: newChat }).eq('id', rev.id);

    input.disabled = false;
    input.value = '';

    if (error) { adminAlert("Failed to send message: " + error.message); return; }

    // Notify the author on the FIRST staff reply only - enough of a nudge to
    // come look, without a notification per message once a real back-and-forth
    // is under way. "First" = no prior message from anyone but the author.
    const isAuthorsOwnTicket = rev.author_id === window.currentUserId;
    const hadPriorStaffReply = currentChat.some(m => m.author !== rev.author_name);
    if (!isAuthorsOwnTicket && !hadPriorStaffReply) {
        await window.supabaseClient.from('user_notifications').insert([{
            user_id: rev.author_id,
            message: `Staff replied to the discussion on your "${rev.page_id.toUpperCase()}" revision.`,
            link: 'submissions.html'
        }]);
    }

    rev.ticket_chat = newChat;
    // Previously missing the 4th (hasOpposed) argument, so the OPPOSE/REMOVE
    // OPPOSE button always reset to its default "OPPOSE" state after every
    // chat message, even for a reviewer who'd already opposed the ticket.
    renderTicketWorkspace(rev, rev.author_id === window.currentUserId, (rev.supporters || []).includes(window.currentUserId), (rev.opposers || []).includes(window.currentUserId));
    setTimeout(() => document.getElementById('ticket-chat-input').focus(), 10);
}
