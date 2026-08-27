// v0.17 B-I, contributor side: "when a regular contributor does it, they create
// a new pending revision."
//
// THE SHAPE OF THE BUG, which is not the same as its trigger. Two flags carry
// one idea:
//
//   window.activeEditTicketId    - from the URL. Always set when ?editTicket= is.
//   window.interceptedTicketData - fetched from the queue. Can be null.
//
// The submit path routed on the SECOND. So any failure to load the ticket -
// whatever its cause - silently turned "update this ticket" into "create a new
// one", and the contributor got a second revision in the queue with no
// indication anything had gone wrong. An insert is not a degraded update; it is
// a different action against a queue a human reads.
//
// The specific trigger the owner hit is NOT established. It is not the race I
// first guessed - the session is awaited well before the fetch - and it is not
// ticket_open, since submissions.js builds the edit URL for both statuses.
// These tests make the failure mode impossible instead of guessing which door
// it comes through, which is why they drive the load failure directly rather
// than trying to reproduce a cause.
const { test, expect } = require('@playwright/test');

// A chainable stand-in for the Supabase query builder, with the one behaviour
// this file is about: pending_revisions refuses to load.
async function editorWithBrokenTicket(page, { failWith } = {}) {
  await page.addInitScript(({ failWith }) => {
    window.__inserts = [];
    window.__updates = [];

    const rowsFor = (table) => {
      if (table === 'page_data') {
        return { data: { page_id: 'boomcat', desc_data: { overview: [] }, frame_data: { m1s: [], skills: [], specials: [] } }, error: null };
      }
      if (table === 'user_roles') return { data: null, error: null };       // an ordinary contributor
      if (table === 'site_settings') return { data: null, error: null };
      // No row = an UNRESTRICTED page. This is read with maybeSingle(), and an
      // empty array here is truthy, which made Boomcat look trusted_editor-only
      // and refused the submit before the guard under test could run.
      if (table === 'page_permissions') return { data: null, error: null };
      if (table === 'pending_revisions') return { data: null, error: { message: failWith } };
      // Everything else answers with an empty LIST rather than null. Several
      // boot readers go straight to `.length`, and a null there throws during
      // page load - which would be this mock's bug showing up as the editor's.
      return { data: [], error: null };
    };

    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        single: async () => result,
        maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
        insert(payload) {
          window.__inserts.push(payload);
          return { select: () => ({ single: async () => ({ data: null, error: null }) }), then: (r) => Promise.resolve({ error: null }).then(r) };
        },
        update(payload) {
          window.__updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    };

    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'contributor-1', email: 'c@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, { failWith: failWith || 'JSON object requested, multiple (or no) rows returned' });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/edit.html?char=boomcat&type=character&editTicket=rev-that-will-not-load',
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.activeEditTicketId !== undefined, { timeout: 45000 });
  await page.waitForTimeout(900);
  return errors;
}

test('a ticket that will not load is recorded, not swallowed', async ({ page }) => {
  const errors = await editorWithBrokenTicket(page);

  const state = await page.evaluate(() => ({
    intent: window.activeEditTicketId,
    data: window.interceptedTicketData,
    err: window.interceptedTicketLoadError,
  }));

  expect(state.intent, 'the URL said which ticket this is').toBe('rev-that-will-not-load');
  expect(state.data, 'and it did not load').toBeNull();
  // The half that was missing entirely. Without this the editor knows the
  // intent, knows it failed, and says nothing.
  expect(state.err, 'the failure is kept so it can be reported').toBeTruthy();
  expect(errors, 'and nothing threw on the way').toEqual([]);
});

test('submitting an unloadable ticket inserts NOTHING', async ({ page }) => {
  // The consequence that matters. Everything else here is bookkeeping; this is
  // the assertion that the contributor does not end up with a second revision.
  await editorWithBrokenTicket(page);

  const alerted = await page.evaluate(async () => {
    let message = null;
    window.editorAlert = (m) => { message = m; };
    // The QA modal would block; the guard is meant to fire long before it.
    window.openQAModal = async () => ({ changelog: 'x', confidence: 'high', evidence: '' });

    document.getElementById('submit-payload-btn').click();
    await new Promise(r => setTimeout(r, 700));
    return { message, inserts: window.__inserts.length, updates: window.__updates.length };
  });

  expect(alerted.inserts, 'no second revision is created').toBe(0);
  expect(alerted.updates, 'and nothing is written over either').toBe(0);
  expect(alerted.message, 'the contributor is told why').toMatch(/could not be loaded/i);
  expect(alerted.message, 'and told nothing was submitted').toMatch(/nothing has been submitted/i);
});

test('the reported reason reaches the message', async ({ page }) => {
  // A bare "could not be loaded" is a dead end for whoever has to diagnose it -
  // the owner reported this bug from the outside, with no console open.
  await editorWithBrokenTicket(page, { failWith: 'permission denied for table pending_revisions' });

  const message = await page.evaluate(async () => {
    let m = null;
    window.editorAlert = (x) => { m = x; };
    window.openQAModal = async () => ({ changelog: 'x', confidence: 'high', evidence: '' });
    document.getElementById('submit-payload-btn').click();
    await new Promise(r => setTimeout(r, 700));
    return m;
  });

  expect(message).toContain('permission denied for table pending_revisions');
});
