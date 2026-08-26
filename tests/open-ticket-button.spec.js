// v0.17 FT-T: the owner could not open a discussion ticket at all.
//
// updateActionButtons branches three ways, and OPEN TICKET was written inline
// in two of them. The admin branch - which is the owner's - got FORCE APPROVE
// and FORCE REJECT and nothing else, so the only route to ticket_open was
// REQUEST CHANGES, which opens the ticket as a side effect and forces you to
// write a change request you may not have wanted to send.
//
// Nothing gated this server-side. openTicketCurrentPreview() is an ordinary
// status update the owner already had permission to make. A missing button,
// not a missing capability - which is why the fix is a hoisted const and these
// tests are about all three branches agreeing, not about permissions.
const { test, expect } = require('@playwright/test');

// Every case runs against the real updateActionButtons in a real admin.html.
async function buttonsFor(page, { roles, ownSubmission, status }) {
  return page.evaluate(({ roles, ownSubmission, status }) => {
    document.body.innerHTML = '<div id="preview-action-buttons"></div>';
    window.currentUserId = 'me';
    window.currentUserRoles = roles;
    updateActionButtons({
      id: 'r1',
      author_id: ownSubmission ? 'me' : 'someone-else',
      supporters: [], opposers: [], status,
    });
    return document.getElementById('preview-action-buttons').innerHTML;
  }, { roles, ownSubmission, status });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
});

test('every reviewing branch can open a ticket on a pending revision', async ({ page }) => {
  // The bug, stated as the property that was violated. Asserting only the
  // admin case would pass again the next time someone adds a fourth branch.
  const cases = [
    ['admin', { roles: ['admin'], ownSubmission: false, status: 'pending' }],
    ['reviewer on someone else', { roles: ['reviewer'], ownSubmission: false, status: 'pending' }],
    ['author on their own', { roles: [], ownSubmission: true, status: 'pending' }],
  ];

  for (const [label, cfg] of cases) {
    const html = await buttonsFor(page, cfg);
    expect(html, `${label} can open a ticket`).toContain('OPEN TICKET');
    expect(html, `${label} gets a working handler`).toContain('openTicketCurrentPreview()');
  }
});

test('the admin keeps every action it already had', async ({ page }) => {
  // A fix that adds a button by dropping another one is a worse bug than the
  // one it closes, and the branch was edited by hand.
  //
  // Keyed on the handler rather than the label: innerHTML serializes the
  // ampersand, so "INTERCEPT & EDIT" reads back as "INTERCEPT &amp; EDIT" and
  // the obvious assertion fails against correct code. The handler is also the
  // thing that actually has to survive an edit - a renamed label is cosmetic,
  // a dropped onclick is the bug.
  const html = await buttonsFor(page, { roles: ['admin'], ownSubmission: false, status: 'pending' });
  for (const [label, handler] of [
    ['INTERCEPT & EDIT', 'editCurrentTicket()'],
    ['REQUEST CHANGES', 'requestChanges()'],
    ['FORCE APPROVE', 'approveCurrentPreview()'],
    ['FORCE REJECT', 'rejectCurrentPreview()'],
  ]) {
    expect(html, `admin still has ${label}`).toContain(handler);
  }
  // The two force actions share their handlers with MERGE TO LIVE and WITHDRAW
  // in the other branches, so the labels are checked too - they are what
  // distinguishes an override from an ordinary action.
  expect(html).toContain('FORCE APPROVE');
  expect(html).toContain('FORCE REJECT');
});

test('OPEN TICKET sits before the two force actions', async ({ page }) => {
  // Same reasoning as the danger row on the Free Submit reset: the collaborative
  // action should not be the thing you reach past FORCE REJECT to find, and an
  // irreversible control should not sit where a reversible one is expected.
  const html = await buttonsFor(page, { roles: ['admin'], ownSubmission: false, status: 'pending' });

  const at = html.indexOf('OPEN TICKET');
  // Asserted before the comparisons, and this is not ceremony: indexOf returns
  // -1 when the button is absent, and -1 is less than every real index - so the
  // two orderings below PASS on a branch with no OPEN TICKET at all. Caught by
  // falsifying this file against the pre-fix code, where three of four tests
  // stayed green.
  expect(at, 'the button is present before its position means anything')
    .toBeGreaterThan(-1);

  expect(at).toBeLessThan(html.indexOf('FORCE APPROVE'));
  expect(at).toBeLessThan(html.indexOf('FORCE REJECT'));
});

test('nobody is offered a ticket that is already open', async ({ page }) => {
  // The status gate, which is the reason the button is conditional rather than
  // unconditional - it would be a no-op on a row already in discussion. Checked
  // across all three branches because the hoist moved this condition out of
  // two of them and into one place, and a hoist is exactly where a condition
  // gets dropped.
  const cases = [
    ['admin', { roles: ['admin'], ownSubmission: false, status: 'ticket_open' }],
    ['reviewer on someone else', { roles: ['reviewer'], ownSubmission: false, status: 'ticket_open' }],
    ['author on their own', { roles: [], ownSubmission: true, status: 'ticket_open' }],
  ];

  for (const [label, cfg] of cases) {
    const html = await buttonsFor(page, cfg);
    expect(html, `${label} is not offered OPEN TICKET twice`).not.toContain('OPEN TICKET');
    // And the branch still rendered - an empty container would satisfy the
    // assertion above while proving nothing. Keyed on the handler because
    // innerHTML escapes the ampersand in the label.
    expect(html, `${label} still gets its other actions`).toContain('editCurrentTicket()');
  }
});
