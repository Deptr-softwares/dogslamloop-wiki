// Coverage for Phase 3 of the reviewer-workflow redesign: a "request
// changes" middle path between binary approve/reject and INTERCEPT & EDIT
// (which makes the reviewer the co-author instead of sending feedback back
// to the original author).
const { test, expect } = require('@playwright/test');

test('updateActionButtons: REQUEST CHANGES shows for admin and reviewer-on-someone-elses-work, not on your own submission', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    document.body.innerHTML = '<div id="preview-action-buttons"></div>';

    const baseRev = { id: 'r1', author_id: 'someone-else', supporters: [], opposers: [], status: 'pending' };

    // Admin
    window.currentUserId = 'me';
    window.currentUserRoles = ['admin'];
    updateActionButtons(baseRev);
    const adminHtml = document.getElementById('preview-action-buttons').innerHTML;

    // Reviewer looking at someone else's submission
    window.currentUserRoles = ['reviewer'];
    updateActionButtons(baseRev);
    const reviewerOnOthersHtml = document.getElementById('preview-action-buttons').innerHTML;

    // Reviewer looking at their OWN submission
    const ownRev = { ...baseRev, author_id: 'me' };
    updateActionButtons(ownRev);
    const reviewerOnOwnHtml = document.getElementById('preview-action-buttons').innerHTML;

    return {
      adminHasRequestChanges: adminHtml.includes('REQUEST CHANGES'),
      reviewerOnOthersHasRequestChanges: reviewerOnOthersHtml.includes('REQUEST CHANGES'),
      reviewerOnOwnHasNoRequestChanges: !reviewerOnOwnHtml.includes('REQUEST CHANGES'),
    };
  });

  expect(result.adminHasRequestChanges).toBe(true);
  expect(result.reviewerOnOthersHasRequestChanges).toBe(true);
  expect(result.reviewerOnOwnHasNoRequestChanges).toBe(true);
});

test('requestChanges: posts a changes_requested-flagged message and opens the ticket if not already open', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="ticket-workspace" class="hidden"></div>';

    const rev = { id: 'r1', page_id: 'boomcat', author_id: 'someone-else', status: 'pending', ticket_chat: [], supporters: [], opposers: [] };
    let capturedUpdates = [];

    window.supabaseClient = {
      from(table) {
        return {
          update(payload) {
            capturedUpdates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
          select() { return this; },
          eq() { return this; },
          single: async () => ({ data: { ticket_chat: rev.ticket_chat }, error: null }),
        };
      },
    };

    window.currentQueueData = [rev];
    window.activePreviewRevId = 'r1';
    window.currentUsername = 'TestReviewer';
    window.adminPrompt = async () => 'Please double-check the frame data on this move.';
    // Not relevant to this test's assertion - stub the UI refresh calls away.
    window.loadQueue = async () => {};
    window.previewRevision = async () => {};

    await window.requestChanges();

    const statusUpdate = capturedUpdates.find(u => u.status === 'ticket_open');
    const chatUpdate = capturedUpdates.find(u => u.ticket_chat);
    const postedMessage = chatUpdate ? chatUpdate.ticket_chat[chatUpdate.ticket_chat.length - 1] : null;

    return {
      statusWasOpened: !!statusUpdate,
      postedMessage,
      revStatusUpdatedLocally: rev.status,
    };
  });

  expect(result.statusWasOpened).toBe(true);
  expect(result.postedMessage).toMatchObject({
    author: 'TestReviewer',
    text: 'Please double-check the frame data on this move.',
    type: 'changes_requested',
  });
  expect(result.revStatusUpdatedLocally).toBe('ticket_open');
});

test('requestChanges: cancelling the prompt does nothing', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const rev = { id: 'r1', page_id: 'boomcat', author_id: 'someone-else', status: 'pending', ticket_chat: [] };
    let supabaseWasCalled = false;

    window.supabaseClient = { from() { supabaseWasCalled = true; return {}; } };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'r1';
    window.adminPrompt = async () => null; // Cancel

    await window.requestChanges();

    return { supabaseWasCalled };
  });

  expect(result.supabaseWasCalled).toBe(false);
});

test('renderTicketWorkspace: a changes_requested message gets distinct styling, not a plain chat line', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    document.body.innerHTML = `
      <span id="ticket-support-text"></span>
      <span id="ticket-oppose-text"></span>
      <div id="ticket-support-actions"></div>
      <div id="ticket-chat-log"></div>
      <div id="ticket-qa-report"></div>
    `;

    const rev = {
      id: 'r1', author_roles: [], supporters: [], opposers: [], qa_metadata: {},
      ticket_chat: [
        { author: 'Alice', text: 'Just a normal comment.', timestamp: Date.now() },
        { author: 'Bob', text: 'Please fix the damage value.', timestamp: Date.now(), type: 'changes_requested' },
      ],
    };

    renderTicketWorkspace(rev, false, false, false);
    const chatHtml = document.getElementById('ticket-chat-log').innerHTML;

    return {
      hasChangesRequestedBlock: chatHtml.includes('ticket-chat-changes-requested'),
      hasChangesRequestedLabel: chatHtml.includes('CHANGES REQUESTED'),
      normalMessageStillPlain: chatHtml.includes('Just a normal comment.') && !chatHtml.includes('ticket-chat-changes-requested-label">⚑ CHANGES REQUESTED by Alice'),
    };
  });

  expect(result.hasChangesRequestedBlock).toBe(true);
  expect(result.hasChangesRequestedLabel).toBe(true);
  expect(result.normalMessageStillPlain).toBe(true);
});

test('submissions.html: a ticket_open row with a changes_requested message shows a specific badge/note, not generic "IN DISCUSSION"', async ({ page }) => {
  await page.goto('/submissions.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const revisions = [
      {
        id: 'r-plain-discussion', page_id: 'boomcat', author_id: 'me', status: 'ticket_open', is_delta: true,
        target_scope: 'matchup', target_key: 'vs Boomcat', created_at: '2026-08-01T00:00:00Z', qa_metadata: {},
        ticket_chat: [{ author: 'Alice', text: 'Just discussing.', timestamp: Date.now() }],
      },
      {
        id: 'r-changes-requested', page_id: 'boomcat', author_id: 'me', status: 'ticket_open', is_delta: true,
        target_scope: 'move', target_key: 'm1s::5H', created_at: '2026-08-01T00:00:00Z', qa_metadata: {},
        ticket_chat: [{ author: 'Bob', text: 'Please double-check the damage value.', timestamp: Date.now(), type: 'changes_requested' }],
      },
    ];

    window.supabaseClient = {
      from() {
        return { select() { return this; }, eq() { return this; }, order: async () => ({ data: revisions, error: null }) };
      },
    };
    window.currentSessionUserId = 'me';

    await window.loadSubmissions();
    const html = document.getElementById('submissions-list').innerHTML;

    return {
      plainDiscussionStillGeneric: html.includes('IN DISCUSSION'),
      changesRequestedBadgeShown: html.includes('CHANGES REQUESTED'),
      changesRequestedNoteShown: html.includes('Please double-check the damage value.'),
    };
  });

  expect(result.plainDiscussionStillGeneric).toBe(true);
  expect(result.changesRequestedBadgeShown).toBe(true);
  expect(result.changesRequestedNoteShown).toBe(true);
});
