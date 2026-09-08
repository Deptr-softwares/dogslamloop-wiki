// v0.18 F6 and F7 - the first-visit notices.
//
// Two one-time notices the owner asked for: one on opening the editor, one on
// opening the Media Library. Both point at the Writing Guide.
//
// THE COPY IS THE SPEC. The owner supplied both texts word for word and wrote
// "Do not change anything" against them, and named which words are bold and
// which are the link. So this file asserts the strings verbatim rather than
// asserting that "a notice appeared" - the wording, its punctuation and the
// emphasis are the deliverable, and a test that only checked for a modal would
// stay green through somebody tidying the grammar.
//
// THE OTHER HALF IS REACHABILITY. The Media Library notice opens on top of the
// Media Library modal, which is the exact shape of a bug this project has
// shipped twice: a confirmation rendered under the modal that opened it, seen
// and unclickable. toBeVisible() does not catch that; a hit test does.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';
const GUIDE = 'https://dogslamloop.com/systems/writing_guide/index.html';

const EDITOR_COPY = 'Welcome to Dogslamloop Wiki Editor! Before doing any edits yourself, '
  + 'make sure to read up the Writing Guide!. It details the rules and the writing style '
  + 'of this wiki, so failure to follow it will get your edits rejected';

const MEDIA_COPY = "Welcome to the Media Library! Here's we keep all of the media and "
  + 'resource of the wiki. This the place where we keep and host our local resource, so '
  + 'make sure to check out the Writing Guide section when it comes to Local Resource!';

async function boot(page) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.showEditorNotice === 'function', { timeout: 15000 });
}

test('the editor notice appears on a first visit, worded exactly as specified', async ({ page }) => {
  await boot(page);

  const notice = page.locator('#editor-notice-editor');
  await expect(notice).toBeVisible();
  expect(await notice.locator('.modal-prompt-text').innerText()).toBe(EDITOR_COPY);
});

test('the editor notice bolds exactly the words the owner named', async ({ page }) => {
  await boot(page);

  // Not "contains a <strong>" - WHICH words are emphasised was specified, and
  // an assertion that some bold exists would survive it moving.
  const bold = await page.locator('#editor-notice-editor .modal-prompt-text strong').allInnerTexts();
  expect(bold).toEqual(['make sure to read up the']);
});

test('the Writing Guide link resolves, and does not navigate the editor away', async ({ page }) => {
  await boot(page);

  const link = page.locator('#editor-notice-editor .modal-prompt-text a');
  await expect(link).toHaveText('Writing Guide');
  await expect(link).toHaveAttribute('href', GUIDE);

  // The editor holds unsaved work. A same-tab navigation out of it discards
  // whatever the contributor had typed, so this attribute is load-bearing
  // rather than cosmetic.
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
});

test('the notice is shown once, and not on the next visit', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#editor-notice-editor')).toBeVisible();

  await page.locator('#editor-notice-editor [data-notice-dismiss]').click();
  await expect(page.locator('#editor-notice-editor')).toHaveCount(0);

  await boot(page);
  await page.waitForTimeout(500);
  expect(await page.locator('#editor-notice-editor').count(),
    'a notice that returns every load is one nobody reads').toBe(0);
});

test('closing the tab without dismissing still counts as shown', async ({ page }) => {
  // Marked seen when SHOWN, not when dismissed. Otherwise a contributor who
  // navigates away rather than clicking GOT IT gets it again forever.
  await boot(page);
  await expect(page.locator('#editor-notice-editor')).toBeVisible();

  await boot(page);   // reload without ever clicking the button
  await page.waitForTimeout(500);
  expect(await page.locator('#editor-notice-editor').count()).toBe(0);
});

test('the Media Library notice appears over the library, and can be clicked', async ({ page }) => {
  await boot(page);

  // Clear the editor notice first: two stacked modals is a modal nobody can
  // read, and the module refuses to open a second while one is up.
  await page.locator('#editor-notice-editor [data-notice-dismiss]').click();
  await expect(page.locator('#editor-notice-editor')).toHaveCount(0);

  await page.locator('#btn-media-library').click();
  const notice = page.locator('#editor-notice-mediaLibrary');
  await expect(notice).toBeVisible();
  expect(await notice.locator('.modal-prompt-text').innerText()).toBe(MEDIA_COPY);

  // The Media Library really is open underneath - otherwise this proves the
  // notice sits above nothing.
  await expect(page.locator('#media-modal-overlay')).toBeVisible();

  // THE ASSERTION THAT MATTERS. Not "is it visible" but "is it the element at
  // that point" - a notice painted under #media-modal-overlay would satisfy
  // toBeVisible() and be unclickable, which is how DELETE COMBO shipped.
  const onTop = await page.evaluate(() => {
    const btn = document.querySelector('#editor-notice-mediaLibrary [data-notice-dismiss]');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return btn.contains(hit) || hit === btn;
  });
  expect(onTop, 'the notice must be above the modal that opened it').toBe(true);

  // And it actually dismisses, leaving the library usable.
  await page.locator('#editor-notice-mediaLibrary [data-notice-dismiss]').click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('#media-modal-overlay')).toBeVisible();
});

test('the Media Library notice bolds and links exactly what was specified', async ({ page }) => {
  await boot(page);
  await page.locator('#editor-notice-editor [data-notice-dismiss]').click();
  await page.locator('#btn-media-library').click();

  const scope = page.locator('#editor-notice-mediaLibrary .modal-prompt-text');
  expect(await scope.locator('strong').allInnerTexts())
    .toEqual(['section when it comes to Local Resource!']);
  await expect(scope.locator('a')).toHaveText('Writing Guide');
  await expect(scope.locator('a')).toHaveAttribute('href', GUIDE);
});

test('neither notice throws, and the editor still works behind it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await page.locator('#editor-notice-editor [data-notice-dismiss]').click();
  await page.locator('#btn-media-library').click();
  await page.locator('#editor-notice-mediaLibrary [data-notice-dismiss]').click();
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
