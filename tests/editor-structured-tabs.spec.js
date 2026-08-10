// The Profile and Playstyle tabs edit a structured object rather than a
// block array, so they return early from loadOverviewSectionIntoEditor and
// never reach initBlockEditor. Three separately-reported symptoms came out
// of that one fact, plus one that came from updateLivePreview resolving the
// current tab differently from everything else in the editor.
const { test, expect } = require('@playwright/test');

async function openOverviewEditor(page, descData) {
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
  await page.evaluate((desc) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    // The page's own boot ran and failed to load data (no session), leaving
    // sub-tab state set with an empty block buffer. Clear it so the seeded
    // content is not flushed over before the test starts.
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentCounterplayIndex = undefined;
    window.currentEditorDescData = desc;
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
  }, descData);
}

const BASE_DESC = {
  overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
  profile: { image: '/medias/images/Portrait.webp', stats: [{ label: 'Archetype', value: 'Rushdown' }] },
  playstyle: { likes: ['Fast pressure'], dislikes: ['Zoning'] },
};

test('Profile gets the Media Library and undo/redo every other tab has', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await openOverviewEditor(page, JSON.parse(JSON.stringify(BASE_DESC)));
  await page.evaluate(() => window.loadOverviewSectionIntoEditor('profile'));

  const ui = await page.evaluate(() => {
    const c = document.getElementById('overview-editor-container');
    return {
      media: !!c.querySelector('[data-form-media]'),
      undo: !!c.querySelector('[data-form-undo]'),
      redo: !!c.querySelector('[data-form-redo]'),
      // Nothing to undo yet, so both start disabled - same as the block editor.
      undoDisabled: c.querySelector('[data-form-undo]')?.disabled,
      redoDisabled: c.querySelector('[data-form-redo]')?.disabled,
      // The form itself still renders.
      imageInput: !!c.querySelector('#profile-image-input'),
    };
  });

  expect(ui.media).toBe(true);
  expect(ui.undo).toBe(true);
  expect(ui.redo).toBe(true);
  expect(ui.undoDisabled).toBe(true);
  expect(ui.redoDisabled).toBe(true);
  expect(ui.imageInput).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('Playstyle gets the same toolbar', async ({ page }) => {
  await openOverviewEditor(page, JSON.parse(JSON.stringify(BASE_DESC)));
  await page.evaluate(() => window.loadOverviewSectionIntoEditor('playstyle'));

  const ui = await page.evaluate(() => {
    const c = document.getElementById('overview-editor-container');
    return {
      media: !!c.querySelector('[data-form-media]'),
      undo: !!c.querySelector('[data-form-undo]'),
      redo: !!c.querySelector('[data-form-redo]'),
      likes: c.querySelectorAll('.like-inp').length,
    };
  });

  expect(ui.media).toBe(true);
  expect(ui.undo).toBe(true);
  expect(ui.redo).toBe(true);
  expect(ui.likes).toBe(1);
});

test('the Media Library button actually opens the gallery', async ({ page }) => {
  await openOverviewEditor(page, JSON.parse(JSON.stringify(BASE_DESC)));
  await page.evaluate(() => {
    window.loadOverviewSectionIntoEditor('profile');
    // Stub the network-backed gallery load; the claim under test is that the
    // button reaches it and reveals the modal.
    window.loadMediaGallery = () => { window.__galleryLoaded = true; };
  });

  await page.click('#overview-editor-container [data-form-media]');

  const result = await page.evaluate(() => ({
    modalVisible: !document.getElementById('media-modal-overlay').classList.contains('hidden'),
    galleryLoaded: !!window.__galleryLoaded,
  }));

  expect(result.modalVisible, 'the modal that was previously unreachable from this tab').toBe(true);
  expect(result.galleryLoaded).toBe(true);
});

test('undo reverts a Profile edit and redo reapplies it', async ({ page }) => {
  await openOverviewEditor(page, JSON.parse(JSON.stringify(BASE_DESC)));

  const result = await page.evaluate(async () => {
    window.loadOverviewSectionIntoEditor('profile');
    const container = document.getElementById('overview-editor-container');
    const wait = () => new Promise(r => setTimeout(r, 550)); // past the 400ms debounce

    const input = container.querySelector('#profile-image-input');
    input.value = '/medias/images/Changed.webp';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();

    const afterEdit = window.currentEditorDescData.profile.image;
    const undoEnabled = !container.querySelector('[data-form-undo]').disabled;

    container.querySelector('[data-form-undo]').click();
    const afterUndo = window.currentEditorDescData.profile.image;
    // The form re-renders on undo, so the field must show the restored value.
    const fieldAfterUndo = document.getElementById('profile-image-input').value;

    document.getElementById('overview-editor-container').querySelector('[data-form-redo]').click();
    const afterRedo = window.currentEditorDescData.profile.image;

    return { afterEdit, undoEnabled, afterUndo, fieldAfterUndo, afterRedo };
  });

  expect(result.afterEdit).toBe('/medias/images/Changed.webp');
  expect(result.undoEnabled, 'undo becomes available once there is something to undo').toBe(true);
  expect(result.afterUndo).toBe('/medias/images/Portrait.webp');
  expect(result.fieldAfterUndo, 'the visible field follows the restored state').toBe('/medias/images/Portrait.webp');
  expect(result.afterRedo).toBe('/medias/images/Changed.webp');
});

test('Profile and Playstyle escape submitted values instead of breaking out of value=', async ({ page }) => {
  const hostile = '" autofocus onfocus="window.__formXss=1" x="';

  const desc = JSON.parse(JSON.stringify(BASE_DESC));
  desc.profile.stats = [{ label: hostile, value: 'Rushdown' }];
  desc.profile.image = hostile;
  desc.playstyle.likes = [hostile];

  await openOverviewEditor(page, desc);

  // A reviewer intercepting a submission renders the *submitter's* text in
  // this form, so these values are attacker-reachable against staff.
  const profile = await page.evaluate((expected) => {
    window.loadOverviewSectionIntoEditor('profile');
    const c = document.getElementById('overview-editor-container');
    return {
      // The value survives intact as a value, not as markup.
      label: c.querySelector('.stat-label')?.value,
      image: c.querySelector('#profile-image-input')?.value,
      strayAttr: c.querySelector('.stat-label')?.hasAttribute('onfocus'),
      xss: !!window.__formXss,
      matches: c.querySelector('.stat-label')?.value === expected,
    };
  }, hostile);

  expect(profile.matches, 'the text round-trips exactly').toBe(true);
  expect(profile.label).toBe(hostile);
  expect(profile.image).toBe(hostile);
  expect(profile.strayAttr, 'no attribute was smuggled in').toBe(false);
  expect(profile.xss).toBe(false);

  const playstyle = await page.evaluate(() => {
    window.loadOverviewSectionIntoEditor('playstyle');
    const c = document.getElementById('overview-editor-container');
    return {
      like: c.querySelector('.like-inp')?.value,
      strayAttr: c.querySelector('.like-inp')?.hasAttribute('onfocus'),
      xss: !!window.__formXss,
    };
  });

  expect(playstyle.like).toBe(hostile);
  expect(playstyle.strayAttr).toBe(false);
  expect(playstyle.xss).toBe(false);
});

test('no phantom "Editing null" section when the URL carries no ?tab=', async ({ page }) => {
  // updateLivePreview read urlParams.get('tab') raw while editor-core.js
  // booted with `urlParams.get('tab') || 'overview'`. Opening the editor
  // without a ?tab= gave the two different answers: null matched no branch,
  // fell through to the generic else, and built a "tab-null" section titled
  // "Editing null" out of the block buffer - which still held the previous
  // section's blocks, hence "it copies the last section's contents".
  await page.goto('/edit.html?char=testchar', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = 'overview';
    window.currentEditorDescData = {
      overview: [{ type: 'paragraph', content: 'Real overview content' }],
      strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    window.currentEditorTabId = 'overview';

    updateLivePreview(true);

    return {
      urlHasTab: new URLSearchParams(window.location.search).has('tab'),
      phantomSection: !!document.getElementById('tab-null'),
      bodyMentionsNull: document.body.textContent.includes('Editing null'),
    };
  });

  expect(result.urlHasTab, 'the URL genuinely has no tab param - that is the trigger').toBe(false);
  expect(result.phantomSection, 'no tab-null element is created').toBe(false);
  expect(result.bodyMentionsNull).toBe(false);
});
