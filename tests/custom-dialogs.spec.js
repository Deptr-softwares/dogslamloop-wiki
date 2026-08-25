// v0.16 fine-tuning 6 and 7: two browser dialogs become the site's own modals.
//
//  6. Clear All Notifications used window.confirm().
//  7. The hyperlink button used window.prompt().
//
// Both tests register a `dialog` listener and assert it never fires. That is the
// actual claim - "we stopped using the browser's dialog" - and it is the one
// thing a screenshot of a nice-looking modal cannot tell you, since a native
// dialog appears outside the page entirely.
//
// Note that Playwright auto-dismisses dialogs when a listener is attached, so
// without these listeners a leftover confirm() would silently resolve to false
// and the test would look like it was exercising a cancel path.
const { test, expect } = require('@playwright/test');

// --- FINE-TUNING 7: THE LINK PROMPT ---

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

async function workspaceWithText(page) {
  const errors = [];
  const dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); });

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentEditorDescData = {
      overview: [{ type: 'paragraph', content: 'Read the guide here' }],
      strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile: { image: '', stats: [] }, playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('overview');
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  await page.waitForTimeout(600);

  // Select the last two words with the KEYBOARD, so the link has a label and we
  // can tell the inserted tags apart from the rest of the text.
  //
  // Selecting via setSelectionRange does not work here: the toolbar reads a
  // `lastSelection` that is only updated on mouseup and keyup, so a
  // programmatic range leaves it at {0,0} and the tag lands at the start of the
  // field wrapping nothing. That is how this fixture was written first, and the
  // resulting "[url=...][/url]Read the guide here" looked like a bug in the
  // change rather than in the test.
  await page.locator('#block-list .editor-textarea').click();
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 'guide here'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(200);

  return { errors, dialogs };
}

async function clickLinkButton(page) {
  await page.locator('.format-toolbar .format-btn[data-tag="url"]').first().click();
  await page.waitForTimeout(400);
}

test('the link button opens the site modal, not a browser prompt', async ({ page }) => {
  const { errors, dialogs } = await workspaceWithText(page);
  await clickLinkButton(page);

  const seen = await page.evaluate(() => {
    const modal = document.getElementById('editor-custom-modal');
    const input = modal.querySelector('.editor-modal-input');
    return {
      open: !modal.classList.contains('hidden'),
      hasInput: !!input,
      focused: document.activeElement === input,
      prompt: document.getElementById('editor-modal-text').textContent,
    };
  });

  expect(dialogs, 'no native prompt fired').toEqual([]);
  expect(seen.open, 'the site modal opened').toBe(true);
  expect(seen.hasInput, 'with a field to type the URL into').toBe(true);
  expect(seen.focused, 'and the caret already in it').toBe(true);
  expect(seen.prompt).toContain('URL');
  expect(errors).toEqual([]);
});

test('typing a URL and confirming wraps the selection', async ({ page }) => {
  const { errors, dialogs } = await workspaceWithText(page);
  await clickLinkButton(page);

  await page.locator('#editor-custom-modal .editor-modal-input').fill('/systems/writing_guide/');
  await page.locator('#editor-modal-confirm').click();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    value: document.querySelector('#block-list .editor-textarea').value,
    data: window.getActiveBlocks()[0].content,
    modalHidden: document.getElementById('editor-custom-modal').classList.contains('hidden'),
    inputGone: !document.querySelector('#editor-custom-modal .editor-modal-input'),
  }));

  expect(dialogs).toEqual([]);
  expect(after.value, 'the tag went in around the selection')
    .toContain('[url=/systems/writing_guide/]guide here[/url]');
  // Not just the textarea: the block data has to have been updated too, or the
  // link vanishes on the next re-render.
  expect(JSON.stringify(after.data), 'and reached the block data').toContain('[url=/systems/writing_guide/]');
  expect(after.modalHidden, 'the modal closed').toBe(true);
  // The modal is shared with customConfirm on two pages, so a leftover input
  // would turn up on every delete confirmation.
  expect(after.inputGone, 'and took its input away with it').toBe(true);
  expect(errors).toEqual([]);
});

test('cancelling the link modal inserts nothing', async ({ page }) => {
  const { dialogs } = await workspaceWithText(page);
  const before = await page.evaluate(() =>
    document.querySelector('#block-list .editor-textarea').value);

  await clickLinkButton(page);
  await page.locator('#editor-modal-cancel').click();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    value: document.querySelector('#block-list .editor-textarea').value,
    inputGone: !document.querySelector('#editor-custom-modal .editor-modal-input'),
  }));

  expect(dialogs).toEqual([]);
  expect(after.value, 'the text is untouched').toBe(before);
  expect(after.value, 'and no empty tag was left behind').not.toContain('[url');
  expect(after.inputGone).toBe(true);
});

test('the confirm button is restored for the next plain confirmation', async ({ page }) => {
  // customPrompt repaints the shared confirm button blue and relabels it
  // INSERT. If it does not put it back, the next delete confirmation asks you
  // to press a blue INSERT to destroy something.
  await workspaceWithText(page);
  const before = await page.evaluate(() => {
    const b = document.getElementById('editor-modal-confirm');
    return { text: b.textContent, cls: b.className };
  });

  await clickLinkButton(page);
  await page.locator('#editor-modal-cancel').click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const b = document.getElementById('editor-modal-confirm');
    return { text: b.textContent, cls: b.className };
  });

  expect(after, 'the shared button is exactly as it was').toEqual(before);
});

// --- FINE-TUNING 6: CLEAR ALL NOTIFICATIONS ---

// A public page, deliberately: site_utils.js runs on every page, and the whole
// reason this needed its own confirmation is that the editor's one does not
// exist out here.
const PUBLIC_PAGE = '/characters/Boomcat/index.html';

async function inboxFixture(page) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); });
  await page.goto(PUBLIC_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.clearAllNotifications === 'function', { timeout: 45000 });

  // The inbox modal as renderNotifications builds it, so the function under
  // test finds the node it actually wipes.
  await page.evaluate(() => {
    const modal = document.createElement('div');
    modal.id = 'site-notification-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-box"><div class="modal-body"><div class="notif-item">A notification</div></div></div>';
    document.body.appendChild(modal);
  });
  return dialogs;
}

test('clearing the inbox asks first, in the site modal', async ({ page }) => {
  const dialogs = await inboxFixture(page);

  await page.evaluate(() => { window.__cleared = window.clearAllNotifications(); });
  await page.waitForTimeout(400);

  const seen = await page.evaluate(() => {
    const modal = document.getElementById('site-confirm-modal');
    return {
      exists: !!modal,
      open: modal ? !modal.classList.contains('hidden') : false,
      title: modal ? modal.querySelector('#site-confirm-title').textContent : null,
      inboxStillThere: !!document.querySelector('#site-notification-modal .notif-item'),
    };
  });

  expect(dialogs, 'no native confirm fired').toEqual([]);
  expect(seen.exists, 'the site confirmation was built').toBe(true);
  expect(seen.open, 'and is showing').toBe(true);
  expect(seen.title).toContain('CLEAR ALL');
  // The important half: nothing is destroyed while the question is still open.
  expect(seen.inboxStillThere, 'the inbox is untouched until you answer').toBe(true);
});

test('cancelling leaves the inbox alone', async ({ page }) => {
  await inboxFixture(page);
  await page.evaluate(() => { window.clearAllNotifications(); });
  await page.waitForTimeout(400);

  await page.locator('#site-confirm-cancel').click();
  await page.waitForTimeout(400);

  const seen = await page.evaluate(() => ({
    stillThere: !!document.querySelector('#site-notification-modal .notif-item'),
    modalHidden: document.getElementById('site-confirm-modal').classList.contains('hidden'),
  }));

  expect(seen.stillThere, 'the notification survived').toBe(true);
  expect(seen.modalHidden, 'and the confirmation closed').toBe(true);
});

test('confirming wipes the inbox', async ({ page }) => {
  // The other direction. A confirmation that never proceeds is not a
  // confirmation, and asserting only the cancel path would pass on one.
  await inboxFixture(page);
  await page.evaluate(() => { window.clearAllNotifications(); });
  await page.waitForTimeout(400);

  await page.locator('#site-confirm-ok').click();
  await page.waitForTimeout(600);

  const seen = await page.evaluate(() => ({
    stillThere: !!document.querySelector('#site-notification-modal .notif-item'),
    body: document.querySelector('#site-notification-modal .modal-body').textContent,
  }));

  expect(seen.stillThere, 'the notification is gone').toBe(false);
  expect(seen.body).toContain('empty');
});

test('Escape cancels rather than confirming', async ({ page }) => {
  // It is a destructive action, so every ambiguous way out has to mean no.
  await inboxFixture(page);
  await page.evaluate(() => { window.clearAllNotifications(); });
  await page.waitForTimeout(400);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const seen = await page.evaluate(() => ({
    stillThere: !!document.querySelector('#site-notification-modal .notif-item'),
    modalHidden: document.getElementById('site-confirm-modal').classList.contains('hidden'),
  }));

  expect(seen.stillThere, 'Escape did not clear the inbox').toBe(true);
  expect(seen.modalHidden, 'but did close the confirmation').toBe(true);
});
