/**
 * What a reviewer does to the open revision: INTERCEPT & EDIT, approve (MERGE TO
 * LIVE or FORCE APPROVE), reject or withdraw, OPEN TICKET and REQUEST CHANGES.
 * @since v0.4, as part of admin.js
 * @touches pending_revisions, page_data (archived to page_history by its trigger),
 *   user_notifications, applyDeltaToData (site_data.js), buildPageUrl and
 *   registeredPageType (site_utils.js), adminPrompt (admin-core.js)
 * @watch the page kind written to a live row comes from the page list, never the
 *   submission's page_type. A notification is skipped for an anonymized author
 *   (author_id NULL). RLS decides who may write; the buttons only decide what shows.
 * @see docs/overseer.md
 */

window.editCurrentTicket = async function() {
    if(!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if(!rev) return;

    if(!(await adminConfirm("Intercept this submission? This will open the Editor so you can modify the contributor's text directly."))) return;

    // The editor needs &type=, or it opens every page as a character. The kind comes
    // from the page list, not the submission's page_type.
    const pageType = (await window.registeredPageType(rev.page_id)) || 'character';
    let url = `edit.html?char=${encodeURIComponent(rev.page_id)}`
        + `&type=${encodeURIComponent(pageType)}`
        + `&editTicket=${encodeURIComponent(rev.id)}`;

    // The tab the reviewer is reading: a merged ticket spans several scopes, so no
    // single tab can be derived.
    const activeTabBtn = document.querySelector('#preview-tab-nav .btn-manga.active');
    const activeTab = activeTabBtn ? activeTabBtn.id.replace('nav-', '') : null;
    if (activeTab) url += `&tab=${encodeURIComponent(activeTab)}`;

    // And the state they are reading, so corrections land in it. A mode-scoped
    // ticket still overrides this in editor-modes.js.
    if (window.activePreviewMode) url += `&mode=${encodeURIComponent(window.activePreviewMode)}`;

    // A single-move ticket keeps its deep link to the move.
    if (rev.is_delta && rev.target_scope === 'move' && rev.target_key) {
        const [moveTab, moveId] = rev.target_key.split('::');
        if (moveTab === activeTab && moveId) url += `&move=${encodeURIComponent(moveId)}`;
    }

    window.open(url, '_blank');
};

async function approveCurrentPreview() {
    if(!window.activePreviewRevId) return;

    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    const msg = window.rolesMeet(window.currentUserRoles, 'admin')
        ? "Provide an optional staff note (or leave blank to force merge immediately):"
        : "Provide an optional staff note for the author (or leave blank):";

    const approvalNote = await window.adminPrompt(msg, "APPROVE REVISION", "MERGE TICKET", false, "Optional note for the author, e.g. what you verified...");
    if (approvalNote === null) return;

    const finalNote = approvalNote.trim() !== '' ? approvalNote.trim() : "Approved and merged.";

    let finalDesc = {};
    let finalFrame = {};

    const { data: freshLive, error: freshErr } = await window.supabaseClient
        .from('page_data').select('*').eq('page_id', revData.page_id).single();

    if (freshErr && freshErr.code !== 'PGRST116') {
        window.adminAlert("Fetch Failed: " + freshErr.message);
        return;
    }

    // Written onto the live row, so from the page list, then the live row, never the
    // submission's page_type.
    const pageType = (await window.registeredPageType(revData.page_id))
        || (freshLive && freshLive.page_type) || 'character';

    // trigger_archive_page_before_update keeps the old version in page_history.

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
        page_type: pageType,
        desc_data: finalDesc,
        frame_data: finalFrame,
        last_editor_name: window.currentUsername
    };

    const { error: liveError } = await window.supabaseClient.from('page_data').upsert([livePayload], { onConflict: 'page_id' });
    if (liveError) { window.adminAlert("Merge Failed: " + liveError.message); return; }

    const updatedQA = revData.qa_metadata || {};
    updatedQA.reviewed_by = window.currentUsername;

    if (approvalNote.trim() !== '') {
        updatedQA.changelog = (updatedQA.changelog || '') + `\n\n[Staff Note: ${finalNote}]`;
    }

    await window.supabaseClient.from('pending_revisions').update({
        status: 'approved',
        qa_metadata: updatedQA
    }).eq('id', window.activePreviewRevId);

    // The notification's link is clicked days later, so it is the page's real path.
    await window.primePageUrlIndex();
    const pageUrl = window.buildPageUrl(revData.page_id, pageType);

    // No author left to notify once an account is anonymized (author_id NULL).
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
        const reason = await window.adminPrompt(`Please provide a reason for declining this ${revData.page_id.toUpperCase()} revision:`, "REJECT REVISION", "DECLINE TICKET", true, "Explain why this revision was declined...");
        if (reason === null) return;
        finalReason = reason === '' ? 'No specific reason provided.' : reason;
        updatedQA.reviewed_by = window.currentUsername;
    } else {
        if(!(await window.adminConfirm("Withdraw your own submission?"))) return;
    }
    updatedQA.rejection_reason = finalReason;

    // A status, not a delete, so the submission and its discussion stay.
    const { error: updateError } = await window.supabaseClient.from('pending_revisions').update({
        status: isSelfWithdraw ? 'withdrawn' : 'rejected',
        qa_metadata: updatedQA
    }).eq('id', window.activePreviewRevId);

    if (updateError) {
        window.adminAlert("Error: Failed to update the revision's status.");
        return;
    }

    // The notification's link is clicked days later, so it is the page's real path.
    await window.primePageUrlIndex();
    // No kind passed: the submission's page_type is only its word.
    const pageUrl = window.buildPageUrl(revData.page_id);

    // Skipped for an anonymized author.
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

    await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', window.activePreviewRevId);

    if (revData && revData.author_id && revData.author_id !== window.currentUserId) {
        await window.supabaseClient.from('user_notifications').insert([{
            user_id: revData.author_id,
            message: `Staff opened a discussion on your "${revData.page_id.toUpperCase()}" revision. Check My Submissions to follow along.`,
            link: 'submissions.html'
        }]);
    }

    await loadQueue();

    await previewRevision(window.activePreviewRevId);

    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        if (workspace && !workspace.classList.contains('hidden')) {
            workspace.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });

            workspace.style.transition = 'box-shadow 0.3s ease';
            workspace.style.boxShadow = '0 0 20px var(--accent-blue)';
            setTimeout(() => { workspace.style.boxShadow = '0 4px 6px hsla(0, 0%, 0%, 0.3)'; }, 800);
        }
    }, 150);
}

/**
 * REQUEST CHANGES: written feedback to the author, which opens the ticket if it
 * is not open yet.
 * @watch its message carries type 'changes_requested', which renderTicketWorkspace
 *   draws apart; older messages have no type
 */
async function requestChanges() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (!rev) return;

    const note = await window.adminPrompt("What changes would you like the author to make?", "REQUEST CHANGES", "SEND REQUEST", false, "Describe what needs changing before this can be approved...");
    if (note === null || note.trim() === '') return;

    if (rev.status !== 'ticket_open') {
        await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', rev.id);
        rev.status = 'ticket_open';
    }

    const { data: liveRev, error: fetchErr } = await window.supabaseClient.from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];

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
            workspace.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            workspace.style.transition = 'box-shadow 0.3s ease';
            workspace.style.boxShadow = '0 0 20px var(--accent-yellow)';
            setTimeout(() => { workspace.style.boxShadow = '0 4px 6px hsla(0, 0%, 0%, 0.3)'; }, 800);
        }
    }, 150);
}
