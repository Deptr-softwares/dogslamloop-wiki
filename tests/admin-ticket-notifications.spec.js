// Coverage for v0.8's ticket notification events. Before this, approve and
// reject were the ONLY actions that ever wrote to user_notifications - a
// submission could be opened for discussion and replied to indefinitely with
// the author never told, since contributors have no live view of ticket chat
// (js/submissions.js only reads status/ticket_chat when they happen to visit).
//
// Deliberately scoped to ticket-open + the FIRST staff reply rather than every
// message, so an active back-and-forth doesn't turn into notification spam.
const { test, expect } = require('@playwright/test');

// Captures every user_notifications insert while stubbing the rest of the
// admin page's Supabase surface.
async function setupCapture(page, { ticketChat }) {
  return page.evaluate(({ ticketChat }) => {
    window.__inserts = [];
    window.supabaseClient = {
      from(table) {
        if (table === 'user_notifications') {
          return { insert: async (rows) => { window.__inserts.push(...rows); return { error: null }; } };
        }
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          in() { return chain; },
          update() { return chain; },
          order: async () => ({ data: [], error: null }),
          single: async () => ({ data: { ticket_chat: ticketChat }, error: null }),
          then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
        };
        return chain;
      },
    };
  }, { ticketChat });
}

test('real bug fix: opening a ticket notifies the submission author', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const inserts = await page.evaluate(async () => {
    window.__inserts = [];
    window.supabaseClient = {
      from(table) {
        if (table === 'user_notifications') {
          return { insert: async (rows) => { window.__inserts.push(...rows); return { error: null }; } };
        }
        const chain = { update() { return chain; }, eq: async () => ({ error: null }) };
        return chain;
      },
    };
    window.currentUserId = 'staff-person';
    window.activePreviewRevId = 'r1';
    window.currentQueueData = [{ id: 'r1', page_id: 'boomcat', author_id: 'contributor-1' }];

    window.adminConfirm = async () => true;
    window.loadQueue = async () => {};
    window.previewRevision = async () => {};

    await window.openTicketCurrentPreview();
    return window.__inserts;
  });

  expect(inserts).toHaveLength(1);
  expect(inserts[0].user_id).toBe('contributor-1');
  expect(inserts[0].message).toContain('BOOMCAT');
  expect(inserts[0].link).toBe('submissions.html');
});

test('opening a ticket on your own submission does not notify you', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const inserts = await page.evaluate(async () => {
    window.__inserts = [];
    window.supabaseClient = {
      from(table) {
        if (table === 'user_notifications') {
          return { insert: async (rows) => { window.__inserts.push(...rows); return { error: null }; } };
        }
        const chain = { update() { return chain; }, eq: async () => ({ error: null }) };
        return chain;
      },
    };
    window.currentUserId = 'me';
    window.activePreviewRevId = 'r1';
    window.currentQueueData = [{ id: 'r1', page_id: 'boomcat', author_id: 'me' }];

    window.adminConfirm = async () => true;
    window.loadQueue = async () => {};
    window.previewRevision = async () => {};

    await window.openTicketCurrentPreview();
    return window.__inserts;
  });

  expect(inserts).toEqual([]);
});

test('real bug fix: the first staff reply notifies the author', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  // Only the author has spoken so far, so this reply is the first from staff.
  await setupCapture(page, { ticketChat: [{ author: 'ContributorOne', text: 'here it is', timestamp: 1 }] });

  const inserts = await page.evaluate(async () => {
    document.body.innerHTML = '<input id="ticket-chat-input" value="looks good, one question" />';
    window.currentUserId = 'staff-person';
    window.currentUsername = 'StaffPerson';
    window.activePreviewRevId = 'r1';
    window.currentQueueData = [{
      id: 'r1', page_id: 'boomcat', author_id: 'contributor-1', author_name: 'ContributorOne',
      ticket_chat: [], supporters: [], opposers: [],
    }];
    window.renderTicketWorkspace = () => {};

    await window.postTicketMessage();
    return window.__inserts;
  });

  expect(inserts).toHaveLength(1);
  expect(inserts[0].user_id).toBe('contributor-1');
  expect(inserts[0].message).toContain('BOOMCAT');
});

test('subsequent staff replies do not notify again (no spam during an active discussion)', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  // A staff message already exists in the log, so this is a follow-up.
  await setupCapture(page, {
    ticketChat: [
      { author: 'ContributorOne', text: 'here it is', timestamp: 1 },
      { author: 'StaffPerson', text: 'one question', timestamp: 2 },
    ],
  });

  const inserts = await page.evaluate(async () => {
    document.body.innerHTML = '<input id="ticket-chat-input" value="and another thing" />';
    window.currentUserId = 'staff-person';
    window.currentUsername = 'StaffPerson';
    window.activePreviewRevId = 'r1';
    window.currentQueueData = [{
      id: 'r1', page_id: 'boomcat', author_id: 'contributor-1', author_name: 'ContributorOne',
      ticket_chat: [], supporters: [], opposers: [],
    }];
    window.renderTicketWorkspace = () => {};

    await window.postTicketMessage();
    return window.__inserts;
  });

  expect(inserts).toEqual([]);
});
