/**
 * Dogslamloop Wiki - Admin Overseer: Actions (intercept, approve, reject,
 * open ticket)
 */

// --- INTERCEPT & EDIT ENGINE ---
window.editCurrentTicket = async function() {
    if(!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if(!rev) return;

    if(!(await adminConfirm("Intercept this submission? This will open the Editor so you can modify the contributor's text directly."))) return;

    // Attach the special editTicket flag
    let url = `edit.html?char=${rev.page_id}&editTicket=${rev.id}`;

    // Smart Routing: If it's a Delta Patch, jump exactly to the tab/move they edited!
    if (rev.is_delta) {
        let tab = 'overview';
        if (['matchup', 'counterplay'].includes(rev.target_scope)) tab = rev.target_scope + 's';
        else if (rev.target_scope === 'move') {
            tab = rev.target_key.split('::')[0];
            const moveId = rev.target_key.split('::')[1];
            url += `&tab=${tab}&move=${moveId}`;
        }
        if (rev.target_scope !== 'move') url += `&tab=${tab}`;
    }

    // Launch the Editor in a new tab
    window.open(url, '_blank');
};

// --- 5. MODERATION ACTIONS (DELTA SPLICE ENGINE) ---
async function approveCurrentPreview() {
    if(!window.activePreviewRevId) return;

    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    // 1. PROMPT THE REVIEWER FOR REASONING
    const msg = window.currentUserRoles && window.currentUserRoles.includes('admin')
        ? "Provide an optional staff note (or leave blank to force merge immediately):"
        : "Provide an optional staff note for the author (or leave blank):";

    const approvalNote = await window.adminPrompt(msg, "APPROVE REVISION", "MERGE TICKET", false);
    if (approvalNote === null) return; // User clicked Cancel

    const finalNote = approvalNote.trim() !== '' ? approvalNote.trim() : "Approved and merged.";

    let finalDesc = {};
    let finalFrame = {};

    const { data: freshLive, error: freshErr } = await window.supabaseClient
        .from('page_data').select('*').eq('page_id', revData.page_id).single();

    if (freshErr && freshErr.code !== 'PGRST116') {
        window.adminAlert("Fetch Failed: " + freshErr.message);
        return;
    }

    // Your Supabase trigger "trigger_archive_page_before_update" handles the backup automatically.

    const liveDesc = freshLive ? freshLive.desc_data : {};
    const liveFrame = freshLive ? freshLive.frame_data : {};

    if (revData.is_delta) {
        const { newDesc, newFrame } = window.applyDeltaToData(
            liveDesc, liveFrame,
            revData.target_scope, revData.target_key, revData.delta_payload
        );
        finalDesc = newDesc;
        finalFrame = newFrame;
    } else {
        finalDesc = revData.desc_data || {};
        finalFrame = revData.frame_data || {};
    }

    const livePayload = {
        page_id: revData.page_id,
        page_type: revData.page_type,
        desc_data: finalDesc,
        frame_data: finalFrame,
        last_editor_name: window.currentUsername
    };

    const { error: liveError } = await window.supabaseClient.from('page_data').upsert([livePayload], { onConflict: 'page_id' });
    if (liveError) { window.adminAlert("Merge Failed: " + liveError.message); return; }

    // 2. TRACK THE REVIEWER & INJECT REASONING
    const updatedQA = revData.qa_metadata || {};
    updatedQA.reviewed_by = window.currentUsername; // Explicitly tracks the exact staff member!

    if (approvalNote.trim() !== '') {
        updatedQA.changelog = (updatedQA.changelog || '') + `\n\n[Staff Note: ${finalNote}]`;
    }

    await window.supabaseClient.from('pending_revisions').update({
        status: 'approved',
        qa_metadata: updatedQA
    }).eq('id', window.activePreviewRevId);

    const pageUrl = window.buildPageUrl(revData.page_id, revData.page_type);

    // Update Notification to include the Staff Note
    // author_id is NULL when the author's account has been anonymized -
    // there is nobody left to notify, and the insert would violate
    // user_notifications.user_id's foreign key.
    if (revData.author_id) await window.supabaseClient.from('user_notifications').insert([{
        user_id: revData.author_id,
        message: `Your revision for "${revData.page_id.toUpperCase()}" has been approved! Staff Note: "${finalNote}"`,
        link: pageUrl
    }]);

    window.adminAlert("Revision approved and merged to live database!");
    resetPreviewState(); loadQueue();
}

async function rejectCurrentPreview() {
    if(!window.activePreviewRevId) return;
    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    const isSelfWithdraw = (revData.author_id === window.currentUserId);
    let finalReason = "Withdrawn by author.";
    const updatedQA = revData.qa_metadata || {};

    if (!isSelfWithdraw) {
        const reason = await window.adminPrompt(`Please provide a reason for declining this ${revData.page_id.toUpperCase()} revision:`, "REJECT REVISION", "DECLINE TICKET", true);
        if (reason === null) return;
        finalReason = reason === '' ? 'No specific reason provided.' : reason;
        updatedQA.reviewed_by = window.currentUsername;
    } else {
        if(!(await window.adminConfirm("Withdraw your own submission?"))) return;
    }
    updatedQA.rejection_reason = finalReason;

    // Soft status change, not a delete - keeps ticket_chat/qa_metadata around as
    // institutional memory instead of erasing the submission and its discussion.
    const { error: updateError } = await window.supabaseClient.from('pending_revisions').update({
        status: isSelfWithdraw ? 'withdrawn' : 'rejected',
        qa_metadata: updatedQA
    }).eq('id', window.activePreviewRevId);

    if (updateError) {
        window.adminAlert("Error: Failed to update the revision's status.");
        return;
    }

    const pageUrl = window.buildPageUrl(revData.page_id, revData.page_type);

    // Skipped for an anonymized author - see the approve path above.
    if (revData.author_id) await window.supabaseClient.from('user_notifications').insert([{
        user_id: revData.author_id,
        message: `Your revision for "${revData.page_id.toUpperCase()}" was declined. Staff Note: "${finalReason}"`,
        link: pageUrl
    }]);

    window.adminAlert("Revision declined and author notified.");
    resetPreviewState();
    loadQueue();
}

async function openTicketCurrentPreview() {
    if(!window.activePreviewRevId) return;
    if(!(await adminConfirm("Open a discussion ticket for this revision?"))) return;

    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    // Update the database
    await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', window.activePreviewRevId);

    // Until v0.8 nothing told the author a ticket had been opened - approve
    // and reject were the only events that ever notified, so a submission
    // could sit under discussion indefinitely with the author unaware.
    if (revData && revData.author_id && revData.author_id !== window.currentUserId) {
        await window.supabaseClient.from('user_notifications').insert([{
            user_id: revData.author_id,
            message: `Staff opened a discussion on your "${revData.page_id.toUpperCase()}" revision. Check My Submissions to follow along.`,
            link: 'submissions.html'
        }]);
    }

    // Silently reload the queue to update the badges in the background
    await loadQueue();

    // Force the preview to re-render, which builds the ticket workspace
    await previewRevision(window.activePreviewRevId);

    // Snap the camera down to the workspace and flash it
    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        if (workspace && !workspace.classList.contains('hidden')) {
            workspace.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Flash the borders so the user's eyes are drawn to the newly opened workspace
            workspace.style.transition = 'box-shadow 0.3s ease';
            workspace.style.boxShadow = '0 0 20px var(--accent-blue)';
            setTimeout(() => { workspace.style.boxShadow = '0 4px 6px hsla(0, 0%, 0%, 0.3)'; }, 800);
        }
    }, 150);
}

// --- REQUEST CHANGES (lighter middle path than approve/reject/intercept) ---
async function requestChanges() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (!rev) return;

    const note = await window.adminPrompt("What changes would you like the author to make?", "REQUEST CHANGES", "SEND REQUEST", false);
    if (note === null || note.trim() === '') return; // Cancel, or nothing actually written

    // Ensure the ticket is open so the author (and other staff) can see the
    // request and discuss it - same status transition openTicketCurrentPreview
    // uses, just folded in here instead of requiring a separate click first.
    if (rev.status !== 'ticket_open') {
        await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', rev.id);
        rev.status = 'ticket_open';
    }

    const { data: liveRev, error: fetchErr } = await window.supabaseClient.from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];

    // type: 'changes_requested' is additive - every existing message simply
    // has no `type` field, so old rows still render exactly as before.
    // renderTicketWorkspace (js/admin-tickets.js) gives this a distinct look.
    const newMessage = { author: window.currentUsername, text: note.trim(), timestamp: Date.now(), type: 'changes_requested' };
    const newChat = [...currentChat, newMessage];

    const { error } = await window.supabaseClient.from('pending_revisions').update({ ticket_chat: newChat }).eq('id', rev.id);
    if (error) { window.adminAlert("Failed to send request: " + error.message); return; }

    rev.ticket_chat = newChat;

    await loadQueue();
    await previewRevision(window.activePreviewRevId);

    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        if (workspace && !workspace.classList.contains('hidden')) {
            workspace.scrollIntoView({ behavior: 'smooth', block: 'center' });
            workspace.style.transition = 'box-shadow 0.3s ease';
            workspace.style.boxShadow = '0 0 20px var(--accent-yellow)';
            setTimeout(() => { workspace.style.boxShadow = '0 4px 6px hsla(0, 0%, 0%, 0.3)'; }, 800);
        }
    }, 150);
}
