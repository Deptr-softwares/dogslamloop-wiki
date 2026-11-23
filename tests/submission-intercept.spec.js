// v0.16 bug 5: "Intercept-and-edit does not work on your own submission."
//
// The EDIT button on submissions.html built `edit.html?char=<id>&editTicket=<id>`
// and never passed the page type. js/editor/core/editor-core.js reads
// `urlParams.get('type') || 'character'`, so a submission against a system, tool
// or tier list page opened the editor in CHARACTER mode: a character tab strip
// over system data, and the intercepted ticket rendering into nothing.
//
// The page id survived either way, which is exactly why this looked like it
// worked - right up until the page was not a character.
//
// js/overseer/admin-actions.js had the identical omission, so a reviewer intercepting the
// same ticket from overseer.html hit it too. Both are fixed; the admin half is in
// tests/page-kind-from-list.spec.js.
//
// Since 2026-11-21 the kind comes from the site's page list, never from the
// row (owner: the submission's page_type is only the submitter's word). The
// list here is a frozen fixture, so no expectation rests on the owner's pages.
const { test, expect } = require('@playwright/test');

const entry = (pageId, pageType, url) => ({ id: pageId, name: pageId, url, cms_config: { pageId, pageType, editRole: 'open' } });
const PAGE_LIST = {
  Characters: [entry('boomcat', 'character', 'characters/Boomcat/index.html')],
  Guides: [
    entry('writing_guide', 'system', 'systems/writing_guide/index.html'),
    entry('tierlist', 'tierlist', 'systems/tierlist/index.html'),
  ],
  Community: [entry('id_reader', 'tool', 'tools/id-reader/index.html')],
};

async function loadSubmissions(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/navigation.json**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(PAGE_LIST),
  }));
  await page.route('**/data/archived-pages.json**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));
  await page.goto('/submissions.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSubmissionEditUrl === 'function', { timeout: 45000 });
  return errors;
}

const build = (page, rev) => page.evaluate(r => window.buildSubmissionEditUrl(r), rev);

test('a system-page submission opens the editor as a system page', async ({ page }) => {
  const errors = await loadSubmissions(page);

  const url = await build(page, {
    id: 'abc-123', page_id: 'writing_guide', page_type: 'system',
    is_delta: true, target_scope: 'system_section', target_key: 'guide::intro',
  });

  const q = new URLSearchParams(url.split('?')[1]);
  expect(q.get('type'), 'the editor is told what kind of page this is').toBe('system');
  expect(q.get('char')).toBe('writing_guide');
  expect(q.get('editTicket')).toBe('abc-123');
  // A system page's editor builds its own tabs; deriving a character tab for it
  // would be inventing a destination that does not exist.
  expect(q.get('tab'), 'and is not sent to a character tab').toBeNull();
  expect(errors).toEqual([]);
});

test('a tool and a tier list submission open as their kind too', async ({ page }) => {
  await loadSubmissions(page);
  for (const [pageId, pageType] of [['id_reader', 'tool'], ['tierlist', 'tierlist']]) {
    const url = await build(page, { id: 'i', page_id: pageId, page_type: pageType, is_delta: false });
    expect(new URLSearchParams(url.split('?')[1]).get('type'), `${pageType} survives`).toBe(pageType);
  }
});

test('a submission opens as its page kind, not the kind it names', async ({ page }) => {
  await loadSubmissions(page);
  const kind = async (pageId, named) => new URLSearchParams((await build(page, {
    id: 'w', page_id: pageId, page_type: named, is_delta: false,
  })).split('?')[1]).get('type');
  expect(await kind('writing_guide', 'tierlist')).toBe('system');
  expect(await kind('tierlist', 'character')).toBe('tierlist');
});

test('character routing is unchanged, deep link and all', async ({ page }) => {
  // The half that already worked. A fix that sent every ticket to the editor's
  // default tab would satisfy the tests above and quietly undo the smart routing
  // that puts a reviewer on the move they are correcting.
  await loadSubmissions(page);

  const move = new URLSearchParams((await build(page, {
    id: 'r1', page_id: 'boomcat', page_type: 'character',
    is_delta: true, target_scope: 'move', target_key: 'skills::divine-flame',
  })).split('?')[1]);
  expect(move.get('type')).toBe('character');
  expect(move.get('tab'), 'straight to the move category').toBe('skills');
  expect(move.get('move'), 'and the move itself').toBe('divine-flame');

  const matchup = new URLSearchParams((await build(page, {
    id: 'r2', page_id: 'boomcat', page_type: 'character',
    is_delta: true, target_scope: 'matchup', target_key: 'vs Crow Charmer',
  })).split('?')[1]);
  expect(matchup.get('tab'), 'matchup -> matchups').toBe('matchups');

  const overview = new URLSearchParams((await build(page, {
    id: 'r3', page_id: 'boomcat', page_type: 'character',
    is_delta: true, target_scope: 'overview', target_key: 'full',
  })).split('?')[1]);
  expect(overview.get('tab')).toBe('overview');
});

test('a page the list does not know opens as a character', async ({ page }) => {
  // The old default for a row with no kind, kept for a page with no entry:
  // the kind the row names is not a fallback.
  await loadSubmissions(page);
  const q = new URLSearchParams((await build(page, {
    id: 'old', page_id: 'unlisted', page_type: 'system', is_delta: false,
  })).split('?')[1]);
  expect(q.get('type')).toBe('character');
});

test('ids are escaped into the URL, not concatenated into it', async ({ page }) => {
  // page_id comes from a row a contributor caused to exist. Nothing here is
  // rendered as HTML, but an unescaped & or # silently truncates the query and
  // sends the editor somewhere else entirely.
  await loadSubmissions(page);
  const q = new URLSearchParams((await build(page, {
    id: 'x&tab=skills', page_id: 'a b&type=admin', page_type: 'character', is_delta: false,
  })).split('?')[1]);

  expect(q.get('char'), 'the whole id arrives as one value').toBe('a b&type=admin');
  expect(q.get('editTicket')).toBe('x&tab=skills');
  expect(q.get('type'), 'and cannot be overridden from the data').toBe('character');
});
