// The gallery editor: a bin of items, and one modal that takes a file and a
// name. Deliberately not the block editor - a gallery item is two fields, and
// routing that through blocks/sections/tabs would be three screens of
// machinery for it.
//
// The load-bearing design decision is that each item submits as its own delta
// keyed by name. That is what makes a gallery safe with thirty contributors:
// two people adding different emotes touch different keys and cannot collide.
const { test, expect } = require('@playwright/test');

async function openGalleryEditor(page, cloudItems = []) {
  await page.goto('/edit.html?page=emotes&type=gallery', { waitUntil: 'networkidle' });
  await page.evaluate((items) => {
    window.currentEditorPageType = 'gallery';
    window.currentEditorCharId = 'emotes';
    window.currentEditorDescData = { items: JSON.parse(JSON.stringify(items)) };
    window.originalCloudDescData = { items: JSON.parse(JSON.stringify(items)) };
    window.currentEditorFrameData = {};
    window.saveLocalDraft = () => {};

    // Stand in for the network: the upload path is exercised separately.
    window.uploadWikiMedia = async (file) => ({ name: file.name, url: `/medias/uploaded/${file.name}` });

    initFullTabEditor('emotes', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
  }, cloudItems);
}

const EXISTING = [
  { name: 'Wave', src: '/medias/videos/wave.mp4', alt: 'Wave', note: '', tags: [] },
  { name: 'Sit', src: '/medias/images/sit.gif', alt: 'Sit', note: 'Loops', tags: [] },
];

test('a gallery page opens the item bin, not the block editor', async ({ page }) => {
  await openGalleryEditor(page, EXISTING);

  const result = await page.evaluate(() => ({
    bin: !!document.getElementById('gallery-bin-list'),
    rows: document.querySelectorAll('.gallery-bin-row').length,
    count: document.getElementById('gallery-bin-count').textContent,
    // The block editor's furniture must not be here.
    blockList: !!document.getElementById('block-list'),
    addBlock: !!document.querySelector('.add-block-toolbar'),
  }));

  expect(result.bin).toBe(true);
  expect(result.rows).toBe(2);
  expect(result.count).toBe('2 items');
  expect(result.blockList, 'no block editor on a gallery').toBe(false);
  expect(result.addBlock).toBe(false);
});

test('the add modal takes a file and a name, and guesses the name from the filename', async ({ page }) => {
  await openGalleryEditor(page, []);

  await page.click('button:has-text("+ ADD ITEM")');
  await expect(page.locator('#gallery-item-modal')).toBeVisible();

  // Two fields is the whole point - wave.mp4 is almost always "Wave", so the
  // common case should be one field.
  await page.setInputFiles('#gallery-item-file', {
    name: 'crossed_arms.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x'),
  });
  await expect(page.locator('#gallery-item-name')).toHaveValue('Crossed arms');

  await page.fill('#gallery-item-name', 'Crossed Arms');
  await page.click('#gallery-item-confirm');

  await expect(page.locator('#gallery-item-modal')).toBeHidden();

  const item = await page.evaluate(() => window.getGalleryEditorItems()[0]);
  expect(item.name).toBe('Crossed Arms');
  expect(item.src).toBe('/medias/uploaded/crossed_arms.mp4');
  expect(await page.locator('.gallery-bin-row').count()).toBe(1);
});

test('the modal refuses a duplicate name, because the name is the delta key', async ({ page }) => {
  await openGalleryEditor(page, EXISTING);

  await page.click('button:has-text("+ ADD ITEM")');
  await page.setInputFiles('#gallery-item-file', {
    name: 'wave2.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x'),
  });
  await page.fill('#gallery-item-name', 'wave');
  await page.click('#gallery-item-confirm');

  // Two items sharing a name would make the second silently overwrite the
  // first when the delta applies.
  await expect(page.locator('#gallery-item-status')).toContainText('already in this gallery');
  await expect(page.locator('#gallery-item-modal')).toBeVisible();
  expect(await page.evaluate(() => window.getGalleryEditorItems().length)).toBe(2);
});

test('the modal refuses an item with no file or no name', async ({ page }) => {
  await openGalleryEditor(page, []);
  await page.click('button:has-text("+ ADD ITEM")');

  await page.click('#gallery-item-confirm');
  await expect(page.locator('#gallery-item-status')).toContainText('Pick a file');

  await page.setInputFiles('#gallery-item-file', {
    name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x'),
  });
  await page.fill('#gallery-item-name', '   ');
  await page.click('#gallery-item-confirm');
  await expect(page.locator('#gallery-item-status')).toContainText('Give it a name');

  expect(await page.evaluate(() => window.getGalleryEditorItems().length)).toBe(0);
});

test('submitting emits one delta per changed item, not one payload for the whole list', async ({ page }) => {
  await openGalleryEditor(page, EXISTING);

  // Add one, edit one, delete one - the three things a contributor does.
  const payloads = await page.evaluate(() => {
    window.setGalleryEditorItems([
      { name: 'Wave', src: '/medias/videos/wave.mp4', alt: 'Wave', note: 'Now with a note', tags: [] },
      { name: 'Salute', src: '/medias/videos/salute.mp4', alt: 'Salute', note: '', tags: [] },
    ]); // 'Sit' is gone

    // The real function the submit handler calls, not a copy of it - the
    // handler itself is reachable only through auth, the QA modal and a live
    // insert, and a test that reimplements the logic tests nothing about it.
    return window.buildGalleryDeltas(
      window.getGalleryEditorItems(),
      window.originalCloudDescData.items,
    );
  });

  expect(payloads).toHaveLength(3);
  expect(payloads.map(p => `${p.key}:${p.payload === null ? 'delete' : 'set'}`).sort())
    .toEqual(['Salute:set', 'Sit:delete', 'Wave:set']);
});

test('two contributors adding different items do not overwrite each other', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // The reason for per-item deltas, asserted end to end through the real
  // delta engine rather than argued for in a comment.
  const applied = await page.evaluate(() => {
    // Alice's submission was compiled against a gallery holding only Wave.
    const alice = { scope: 'gallery_item', key: 'Salute', payload: { name: 'Salute', src: '/a.mp4' } };
    // Bob's landed first, so live data has moved on.
    const liveAfterBob = { items: [{ name: 'Wave', src: '/w.mp4' }, { name: 'Sit', src: '/s.gif' }] };

    const { newDesc } = window.applyDeltaToData(liveAfterBob, {}, alice.scope, alice.key, alice.payload);
    return newDesc.items.map(i => i.name);
  });

  expect(applied.sort(), "Bob's item survives Alice's approval").toEqual(['Salute', 'Sit', 'Wave']);
});

test('deleting an item from the bin removes it and updates the preview', async ({ page }) => {
  await openGalleryEditor(page, EXISTING);

  await page.evaluate(() => { window.customConfirm = async () => true; });
  await page.locator('.gallery-bin-row').first().locator('.gallery-bin-remove').click();

  const result = await page.evaluate(() => ({
    items: window.getGalleryEditorItems().map(i => i.name),
    rows: document.querySelectorAll('.gallery-bin-row').length,
    // The working copy the submit path reads must follow the bin.
    descItems: window.currentEditorDescData.items.map(i => i.name),
  }));

  expect(result.items).toEqual(['Sit']);
  expect(result.rows).toBe(1);
  expect(result.descItems).toEqual(['Sit']);
});

test('renaming in the bin writes through on every keystroke', async ({ page }) => {
  await openGalleryEditor(page, EXISTING);

  // Submit reads the working copy, not the DOM, so a name typed and not
  // blurred still has to be what gets sent.
  await page.locator('.gallery-bin-name').first().fill('Big Wave');

  const items = await page.evaluate(() => window.getGalleryEditorItems().map(i => i.name));
  expect(items).toEqual(['Big Wave', 'Sit']);
});
