// An author's second send updates their submission instead of making another
// (v1.1, the owner's W0: "when a regular user edit their own submission and
// update it, they uploaded another submission").
//
// What production showed (2026-10-16, Star Rage): the second row was an
// INSERT carrying everything in the first plus the revisions, 18 minutes
// later. The editor only inserts when it does not know which submission it is
// editing, so the author was in a plain editor session: either the one they
// had just submitted from, with the button still reading Submit, or one opened
// from the page with their local draft restored. It was never a role check;
// reviewers edit from the queue, which always names the ticket.
//
// So the fix closes each door:
//   * after a new submission, the editor carries on as an edit of it
//   * opening the editor where you have an open submission offers to continue
//   * editing a submission no longer writes the page's local draft
//   * an author's own update is rescanned in full, so an edit outside the
//     ticket's original scope is not dropped
const { test, expect } = require('@playwright/test');

const CLOUD = {
  desc: {
    profile: { name: 'Testchar' },
    playstyle: [], overview: [{ type: 'paragraph', content: 'Base overview.' }],
    strategy: [], extras: [],
    matchups: [{ opponent: 'Sukuna', tier: 'Equal', content: [] }],
    counterplay: [], moveStrategies: {},
  },
  frame: { m1s: [], skills: [], specials: [], ultimateAtk: [] },
};

// openRows: what a query for this author's open submissions on the page
// returns. ticket: what a .single() read of one submission returns.
async function openEditor(page, { openRows = [], ticket = null, url = '/edit.html?char=testchar&tab=overview' } = {}) {
  await page.addInitScript(({ cloud, openRows, ticket }) => {
    window.__inserted = [];
    window.__updated = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u-1', email: 'c@b.c' }, access_token: 't' } },
            });
            client.from = (table) => {
              if (table === 'page_data') {
                // A fresh copy per read, as a real fetch is. Handing out one
                // object let an edit in the editor change what the next read of
                // the live page returned.
                const row = () => JSON.parse(JSON.stringify({ desc_data: cloud.desc, frame_data: cloud.frame }));
                const c = { select() { return c; }, eq() { return c; },
                  single: async () => ({ data: row(), error: null }), maybeSingle: async () => ({ data: row(), error: null }) };
                return c;
              }
              if (table === 'pending_revisions') {
                const c = {
                  select() { return c; }, eq() { return c; }, in() { return c; },
                  order() { return c; }, limit() { return c; },
                  single: async () => ({ data: ticket, error: ticket ? null : { message: 'not found' } }),
                  then: (resolve) => resolve({ data: openRows, error: null }),
                  // The real call is .insert(rows).select(), answered with the rows made.
                  insert: (rows) => {
                    window.__inserted.push(...[].concat(rows));
                    return { select: async () => ({ data: [].concat(rows).map(r => ({
                      id: 'rev-new', status: 'pending', qa_metadata: {}, ...r })), error: null }) };
                  },
                  update: (payload) => ({ eq: async (col, val) => {
                    window.__updated.push({ payload, col, val });
                    return { error: null };
                  } }),
                };
                return c;
              }
              const chain = new Proxy({}, {
                get(_t, prop) {
                  if (prop === 'then') return (resolve) => resolve({ data: null, error: null });
                  if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                  return () => chain;
                },
              });
              return chain;
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { cloud: CLOUD, openRows, ticket });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

// The editor as a contributor leaves it before pressing the button: the QA
// modal and the cooldown are separate flows with their own coverage.
async function readyToSubmit(page) {
  await page.waitForFunction(() => window.currentEditorDescData && document.getElementById('submit-payload-btn'), null, { timeout: 45000 });
  await page.evaluate(() => {
    localStorage.removeItem('wiki_last_submit_time');
    window.openQAModal = async () => ({ changelog: 'test', confidence: 'high', evidence: '' });
    window.__alerts = [];
    window.editorAlert = (m) => window.__alerts.push(m);
    window.triggerManualSync = async () => {};
    // No open block section, so the edits below are made to the data
    // directly, the way tests/multi-tab-submission.spec.js makes them. With
    // Overview open, its block buffer would be written back over them.
    window.currentOverviewSection = null;
  });
}

async function submit(page) {
  await page.click('#submit-payload-btn');
  await expect(page.locator('#submit-payload-btn')).toBeEnabled({ timeout: 15000 });
  await page.waitForTimeout(400);
}

test('pressing the button again updates the submission it just made', async ({ page }) => {
  await openEditor(page);
  await readyToSubmit(page);

  await page.evaluate(() => { window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'First pass.' }]; });
  await submit(page);
  expect(await page.evaluate(() => window.__inserted.length), 'the first send is a new submission').toBe(1);

  // The editor now says what the next press does.
  await expect(page.locator('#submit-payload-btn')).toHaveClass(/btn-sys-purple/);
  expect(page.url()).toContain('editTicket=rev-new');

  // The author keeps going, on another tab too.
  await page.evaluate(() => {
    localStorage.removeItem('wiki_last_submit_time');
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Second pass.' }];
    window.currentEditorDescData.matchups[0].tier = 'Advantage';
  });
  await submit(page);

  const out = await page.evaluate(() => ({ inserted: window.__inserted.length, updated: window.__updated }));
  expect(out.inserted, 'no second submission').toBe(1);
  expect(out.updated).toHaveLength(1);
  expect(out.updated[0].col).toBe('id');
  expect(out.updated[0].val, 'it updates the one it made').toBe('rev-new');

  // Both edits are in the update: the overview from before and the matchup now.
  const p = out.updated[0].payload;
  const scopes = p.target_scope === 'multi' ? p.delta_payload.map(d => d.scope) : [p.target_scope];
  expect(scopes).toEqual(expect.arrayContaining(['overview', 'matchup']));
});

test("an author's update keeps an edit outside the ticket's first scope", async ({ page }) => {
  // Opened from My Submissions on a ticket that only touched the overview.
  const own = {
    id: 'rev-own', page_id: 'testchar', page_type: 'character', author_id: 'u-1', author_name: 'c',
    status: 'pending', qa_metadata: {}, is_delta: true, target_scope: 'overview', target_key: 'full',
    delta_payload: [{ type: 'paragraph', content: 'Ticket overview.' }],
  };
  await openEditor(page, { ticket: own, url: '/edit.html?char=testchar&tab=overview&editTicket=rev-own' });
  await readyToSubmit(page);

  await page.evaluate(() => { window.currentEditorDescData.matchups[0].tier = 'Advantage'; });
  await submit(page);

  const updated = await page.evaluate(() => window.__updated);
  expect(updated).toHaveLength(1);
  const p = updated[0].payload;
  const scopes = p.target_scope === 'multi' ? p.delta_payload.map(d => d.scope) : [p.target_scope];
  // Rebuilding only the ticket's scope used to drop the matchup silently.
  expect(scopes).toEqual(expect.arrayContaining(['overview', 'matchup']));
});

test("editing a submission does not write the page's local draft", async ({ page }) => {
  await openEditor(page);
  await readyToSubmit(page);

  const keys = await page.evaluate(() => {
    localStorage.removeItem('wiki_draft_testchar');
    window.activeEditTicketId = 'rev-own';
    window.saveLocalDraft();
    const whileEditing = localStorage.getItem('wiki_draft_testchar');
    window.activeEditTicketId = null;
    window.saveLocalDraft();
    const onThePage = localStorage.getItem('wiki_draft_testchar');
    return { whileEditing, onThePage: !!onThePage };
  });
  expect(keys.whileEditing).toBeNull();
  expect(keys.onThePage, 'a normal session still keeps its draft').toBe(true);
});

test('opening the editor where you have an open submission offers to continue it', async ({ page }) => {
  await openEditor(page, {
    openRows: [{ id: 'rev-open', author_id: 'u-1', status: 'pending', created_at: '2026-10-16T19:02:06Z' }],
  });

  const modal = page.locator('#editor-custom-modal');
  await expect(modal).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#editor-modal-text')).toContainText('already have a submission');
  await expect(page.locator('#editor-modal-cancel')).toHaveText('START A NEW ONE');

  await page.locator('#editor-modal-confirm').click();
  await page.waitForURL(/editTicket=rev-open/);
});

test('starting a new one leaves the editor as an ordinary new submission', async ({ page }) => {
  await openEditor(page, {
    openRows: [{ id: 'rev-open', author_id: 'u-1', status: 'pending', created_at: '2026-10-16T19:02:06Z' }],
  });
  await expect(page.locator('#editor-custom-modal')).toBeVisible({ timeout: 45000 });
  await page.locator('#editor-modal-cancel').click();

  await page.waitForFunction(() => window.currentEditorDescData, null, { timeout: 45000 });
  expect(page.url()).not.toContain('editTicket');
  await expect(page.locator('#submit-payload-btn')).not.toHaveClass(/btn-sys-purple/);
});

test('someone else\'s open submission is not offered', async ({ page }) => {
  // The query is filtered by author on the server; this is the client refusing
  // a row that is not the signed-in author's, whatever the server answered.
  await openEditor(page, {
    openRows: [{ id: 'rev-theirs', author_id: 'someone-else', status: 'pending', created_at: '2026-10-16T19:02:06Z' }],
  });
  await page.waitForFunction(() => window.currentEditorDescData, null, { timeout: 45000 });
  await expect(page.locator('#editor-custom-modal')).toBeHidden();
});

test('leaving the editor from your own submission goes to My Submissions', async ({ page }) => {
  await openEditor(page);
  await readyToSubmit(page);
  const where = await page.evaluate(() => {
    window.interceptedTicketData = { id: 'rev-own', author_id: 'u-1' };
    const own = window.editorExitDestination('?char=testchar&editTicket=rev-own');
    window.interceptedTicketData = { id: 'rev-x', author_id: 'someone-else' };
    const staff = window.editorExitDestination('?char=testchar&editTicket=rev-x');
    return { own, staff };
  });
  expect(where.own).toBe('submissions.html');
  expect(where.staff, 'a reviewer still goes back to the queue').toBe('admin.html');
});
