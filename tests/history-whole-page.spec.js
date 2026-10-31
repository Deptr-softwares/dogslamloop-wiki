// history.html shows the whole page as it was after a revision (owner,
// 2026-10-29: "The whole page as it was").
//
// Before: a revision was drawn by applying its delta to an EMPTY page, through
// a hand-written subset of the renderers. So a Techs, Combos or state edit drew
// "no renderable content", a Starter Guide edit an empty tab, every untouched
// section said "has not been written yet", and every frame data tab showed the
// LIVE page's moves (framedata.js never read what history.js set).
//
// Now: a revision approved since 20261029000001 is drawn from the snapshot the
// database returns (get_page_after_revision), through the live page's own
// markup and boot steps. An older one has no approval time, so it is drawn from
// its delta and says so, and what it did not touch is left out.
//
// CAN: which data is drawn (the snapshot, the delta, never the live page), what
// a partial view leaves out and keeps, the state bar on a state edit, and the
// addresses NEWER/OLDER go to. CANNOT: that the database pairs a revision with
// the right snapshot; that was probed on the PR's preview database.
const { test, expect } = require('@playwright/test');

const PAGE = 'boomcat';

const move = (id, name) => ({
  id, name, stats: [],
  variants: { standard: { label: 'Standard', totalScale: 10, bars: [{ type: 'single', phases: [{ duration: 10, styleClass: 'bg-tick-start', label: 'S' }] }] } },
});

// Today's page: different from every version below, so a test that draws it
// by mistake shows the wrong words.
const LIVE = {
  page_id: PAGE, page_type: 'character',
  desc_data: { overview: [{ type: 'paragraph', content: 'Live overview text' }] },
  frame_data: {
    skills: [move('live_a', 'Live Move A'), move('live_b', 'Live Move B')],
    modes: [{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'King of Curses' }],
  },
};

const rev = (over) => ({
  page_id: PAGE, page_type: 'character', status: 'approved', author_name: 'Someone',
  qa_metadata: { reviewed_by: 'Staff', changelog: 'A change' }, is_delta: true,
  created_at: '2026-10-29T10:00:00Z', approved_at: null, ...over,
});

async function openHistory(page, { revisions, snapshot = null, query = '' }) {
  await page.addInitScript(({ revisions, snapshot, live }) => {
    window.__rpcCalls = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (!lib || !lib.createClient || lib.__patched) return;
        lib.__patched = true;
        const orig = lib.createClient.bind(lib);
        lib.createClient = (...args) => {
          const client = orig(...args);
          client.auth.getSession = async () => ({ data: { session: null } });
          client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
          const thenable = (result) => {
            const chain = {
              select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
              single: async () => result, maybeSingle: async () => result,
              then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
            };
            return chain;
          };
          client.from = (table) => {
            if (table === 'approved_revisions') return thenable({ data: revisions.map(r => ({ ...r })), error: null });
            if (table === 'page_data') return thenable({ data: JSON.parse(JSON.stringify(live)), error: null });
            return thenable({ data: [], error: null });
          };
          client.rpc = async (name, args) => {
            window.__rpcCalls.push({ name, args });
            if (name === 'get_page_after_revision') return { data: snapshot, error: null };
            return { data: [], error: null };
          };
          return client;
        };
      },
    });
  }, { revisions, snapshot, live: LIVE });
  await page.goto(`/history.html?page=${PAGE}${query}`, { waitUntil: 'networkidle' });
  await expect(page.locator('#history-meta-card')).toContainText('Version', { timeout: 15000 });
}

const visibleTabs = (page) => page.locator('#history-content-area .character-nav button[id^="nav-"]:not(.hidden)')
  .evaluateAll(buttons => buttons.map(b => b.id.slice(4)));
const partialNote = (page) => page.locator('#history-content-area .history-partial-note');

test('a revision approved since full-page history shows the whole page as it was', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHistory(page, {
    revisions: [rev({ id: 'r-new', approved_at: '2026-10-29T10:05:00Z', target_scope: 'overview', target_key: 'full', delta_payload: [] })],
    snapshot: {
      source: 'snapshot',
      desc_data: { overview: [{ type: 'paragraph', content: 'Snapshot overview text' }] },
      frame_data: { skills: [move('snap', 'Snapshot Move')] },
    },
  });

  await expect(page.locator('#tab-overview')).toContainText('Snapshot overview text');
  await expect(partialNote(page)).toHaveCount(0);

  await page.locator('#nav-skills').click();
  await expect(page.locator('#tab-skills')).toContainText('Snapshot Move');
  await expect(page.locator('#tab-skills')).not.toContainText('Live Move');

  expect(await page.evaluate(() => window.__rpcCalls))
    .toEqual([{ name: 'get_page_after_revision', args: { target_revision_id: 'r-new' } }]);
  // The parts of today's page that do not belong to a past version.
  await expect(page.locator('#history-content-area #discussion-section, #history-content-area #btn-jump-discussion')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an older revision says it is partial, shows what it changed, and leaves out the rest', async ({ page }) => {
  await openHistory(page, {
    revisions: [rev({
      id: 'r-old', target_scope: 'multi', target_key: 'batch',
      delta_payload: [
        // A topic that is ONE heading block: content, not an empty section.
        { scope: 'starterGuide', key: 'Heading Only', payload: { topic: 'Heading Only', author: '', content: [{ type: 'heading', size: 'h3', align: 'left', content: 'Just A Heading' }] } },
        { scope: 'counterplay', key: 'Block It', payload: { topic: 'Block It', author: '', content: [{ type: 'paragraph', content: 'Hold block on the third hit.' }] } },
      ],
    })],
  });

  await expect(partialNote(page)).toHaveText('This is an old edit with a different data structure, so the site can only show what was changed within it instead of a full page.');
  await expect.poll(() => visibleTabs(page)).toEqual(['starterGuide', 'counterplay']);
  await expect(page.locator('#history-content-area .empty-tab-msg, #history-content-area .wiki-section-empty')).toHaveCount(0);
  await expect(page.locator('#history-content-area')).not.toContainText('not been written');

  await expect(page.locator('#tab-starterGuide')).toBeVisible();
  await expect(page.locator('#tab-starterGuide')).toContainText('Just A Heading');
  await page.locator('#nav-counterplay').click();
  await expect(page.locator('#tab-counterplay')).toContainText('Hold block on the third hit.');
  // Not reached for an older revision: it has no approval time to ask with.
  expect(await page.evaluate(() => window.__rpcCalls)).toEqual([]);
});

test('a move revision draws its own move, not today\'s moves', async ({ page }) => {
  await openHistory(page, {
    revisions: [rev({ id: 'r-move', target_scope: 'move', target_key: 'skills::rev_move', delta_payload: { frame_data: move('rev_move', 'Revision Move'), desc_data: [] } })],
  });

  await expect.poll(() => visibleTabs(page)).toEqual(['skills']);
  await expect(page.locator('#tab-skills')).toContainText('Revision Move');
  await expect(page.locator('#tab-skills')).not.toContainText('Live Move');
});

test('a state edit shows the state bar, and its tab comes back on that state', async ({ page }) => {
  await openHistory(page, {
    revisions: [rev({
      id: 'r-state', target_scope: 'multi', target_key: 'batch',
      delta_payload: [{ scope: 'mode', key: 'ultimate::move::m1s::ult_m1', payload: { frame_data: move('ult_m1', 'Ultimate M1'), desc_data: [] } }],
    })],
  });

  // The delta holds the state's content but not the list of states; without
  // the list there is no bar and the edit cannot be reached.
  const bar = page.locator('#character-mode-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('button')).toHaveText(['Base Kit', 'King of Curses']);
  // Nothing in the base kit changed.
  await expect.poll(() => visibleTabs(page)).toEqual([]);

  await bar.locator('button', { hasText: 'King of Curses' }).click();
  await expect.poll(() => visibleTabs(page)).toEqual(['m1s']);
  await expect(page.locator('#tab-m1s')).toBeVisible();
  await expect(page.locator('#tab-m1s')).toContainText('Ultimate M1');
});

test('each revision has its own address, and NEWER and OLDER go there', async ({ page }) => {
  await openHistory(page, {
    revisions: [
      rev({ id: 'r-2', created_at: '2026-10-29T12:00:00Z', target_scope: 'overview', target_key: 'full', delta_payload: [{ type: 'paragraph', content: 'Second' }] }),
      rev({ id: 'r-1', created_at: '2026-10-29T11:00:00Z', target_scope: 'overview', target_key: 'full', delta_payload: [{ type: 'paragraph', content: 'First' }] }),
    ],
    query: '&rev=r-1',
  });

  await expect(page.locator('#history-meta-card')).toContainText('Version 1 of 2');
  await expect(page.locator('#tab-overview')).toContainText('First');
  await expect(page.locator('#history-meta-card a', { hasText: 'NEWER' })).toHaveAttribute('href', `history.html?page=${PAGE}&rev=r-2`);
  await expect(page.locator('#history-meta-card button', { hasText: 'OLDER' })).toBeDisabled();

  await page.locator('#history-meta-card a', { hasText: 'NEWER' }).click();
  await expect(page).toHaveURL(/rev=r-2/);
  await expect(page.locator('#history-meta-card')).toContainText('Version 2 of 2');
  await expect(page.locator('#tab-overview')).toContainText('Second');
});
