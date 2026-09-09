// The character Gallery tab (v0.18 F9).
//
// The tab existed from v0.12 to v0.18 as a registry placeholder that rendered
// nothing, and js/page_router.js said so in a comment. Making it real is one
// registry entry plus a renderer and an editor; everything between - submit,
// merge, diff, apply - is the keyed-section pipeline, which is exactly the
// claim this file has to check rather than trust.
//
// THE FAILURE THIS PROTECTS AGAINST IS SILENT. Starter Guide shipped with a
// submit scan, a merge compiler entry, a diff and a renderer, and the one
// branch that WRITES the value did not know its scope existed: the reviewer
// got a success modal and nothing was saved. So the apply step is asserted
// first here, and asserted positively.
//
// The second hazard is that this project now has TWO galleries. `gallery_item`
// belongs to the gallery PAGE TYPE and writes desc.items; `charGalleryItem`
// belongs to a character's tab and writes desc.gallery. They are one underscore
// apart and a delta filed under the wrong one would apply cleanly into a field
// nothing reads.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const vocab = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();

const ITEMS = [
  { name: 'Wall Combo', src: 'https://example.test/wall.mp4', alt: 'wall combo', tags: ['combo'], note: 'Corner only' },
  { name: 'Idle Pose', src: 'https://example.test/idle.png', alt: 'idle', tags: [], note: '' },
];

// --- THE REGISTRY ---

test('the gallery is declared on its tab, not in the shared extras list', () => {
  const section = vocab.getKeyedSectionByTab('gallery');

  // getKeyedSectionByTab matches on field === tab id, so this resolving at all
  // is the assertion: declared in EXTRA_KEYED_SECTIONS it would be findable by
  // scope and invisible here, and the editor's dispatch would have had to test
  // the tab id by name.
  expect(section, 'the gallery tab resolves as its own keyed section').toBeTruthy();
  expect(section.field).toBe('gallery');
  expect(section.keyField).toBe('name');
  expect(section.scope).toBe('charGalleryItem');
});

test('the character gallery and the page-type gallery are different scopes', () => {
  // The whole reason the scope is not called `gallery_item`.
  const section = vocab.getKeyedSectionByScope('charGalleryItem');
  expect(section.field).toBe('gallery');
  expect(vocab.getKeyedSectionByScope('gallery_item'), 'the page type is not a keyed section').toBeNull();

  // And a reviewer must be able to tell them apart in a queue that shows both.
  expect(section.entryLabel).toBe('Character Gallery Item');
  expect(section.entryLabel).not.toBe('Gallery Item');
});

test('the tab is editable, which is what puts it in both strips', () => {
  const tab = vocab.CHARACTER_TABS.find(t => t.id === 'gallery');
  expect(tab.editable).toBe(true);
  expect(vocab.getCharacterTabIds({ editableOnly: true })).toContain('gallery');
  // Not mode-scoped: a character's media is the character's, not one state's.
  expect(tab.modeScoped).toBe(false);
});

// --- APPLYING AN APPROVED EDIT (the Starter Guide check) ---

test('an approved gallery delta actually writes, and writes to the right field', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate((items) => {
    const base = { gallery: [items[0]] };

    const added = window.applyDeltaToData(
      JSON.parse(JSON.stringify(base)), null, 'charGalleryItem', items[1].name, items[1]
    );
    const edited = window.applyDeltaToData(
      JSON.parse(JSON.stringify(base)), null, 'charGalleryItem', items[0].name,
      { ...items[0], note: 'CHANGED' }
    );
    const removed = window.applyDeltaToData(
      JSON.parse(JSON.stringify(base)), null, 'charGalleryItem', items[0].name, null
    );

    // applyDeltaToData returns { newDesc, newFrame }.
    return {
      added: added.newDesc.gallery,
      addedItems: added.newDesc.items,
      edited: edited.newDesc.gallery,
      removed: removed.newDesc.gallery,
    };
  }, ITEMS);

  // Positive first: the insert landed, keyed by name, alongside the existing one.
  expect(result.added.map(i => i.name)).toEqual(['Wall Combo', 'Idle Pose']);
  expect(result.edited[0].note, 'an edit patches in place rather than appending').toBe('CHANGED');
  expect(result.edited).toHaveLength(1);
  expect(result.removed, 'a null payload deletes').toEqual([]);

  // And NOT into desc.items, which is the page-type gallery's field. Paired
  // with the positive above so it cannot pass by the delta doing nothing.
  expect(result.addedItems, 'charGalleryItem must not touch the page-type field').toBeUndefined();
});

// --- THE READER ---

test('the tab renders a card per item, and says so when empty', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const rendered = await page.evaluate((items) => {
    window.renderCharacterGalleryTab({ gallery: items });
    const host = document.getElementById('tab-gallery');
    const cards = [...host.querySelectorAll('.gallery-card')];
    return {
      count: cards.length,
      names: cards.map(c => c.querySelector('.gallery-card-name')?.textContent),
      // A .mp4 must become a <video> with data-lazy-src, not an <img> - the
      // extension is read off the path so a query string cannot fool it.
      video: !!host.querySelector('video[data-lazy-src]'),
      img: !!host.querySelector('img.gallery-media'),
      note: host.querySelector('.gallery-card-note')?.textContent,
    };
  }, ITEMS);

  expect(rendered.count).toBe(2);
  expect(rendered.names).toEqual(['Wall Combo', 'Idle Pose']);
  expect(rendered.video, 'the .mp4 renders lazily as video').toBe(true);
  expect(rendered.img, 'the .png renders as an image').toBe(true);
  expect(rendered.note).toBe('Corner only');

  const empty = await page.evaluate(() => {
    window.renderCharacterGalleryTab({ gallery: [] });
    const host = document.getElementById('tab-gallery');
    return {
      msg: host.querySelector('.empty-tab-msg')?.textContent.trim(),
      cards: host.querySelectorAll('.gallery-card').length,
    };
  });

  expect(empty.cards).toBe(0);
  expect(empty.msg, 'an empty tab says so rather than sitting blank').toContain('No media');

  expect(errors).toEqual([]);
});

test('an item name is never parsed as markup', async ({ page }) => {
  // Contributor-submitted and rendered on a public page. Asserting the tag
  // SURVIVES as text, not that some substring is absent - an absence assertion
  // here would pass if the name vanished entirely.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const out = await page.evaluate(() => {
    window.renderCharacterGalleryTab({
      gallery: [{ name: '<img src=x onerror=alert(1)>', src: 'a.png', note: '<b>bold</b>' }],
    });
    const host = document.getElementById('tab-gallery');
    return {
      name: host.querySelector('.gallery-card-name')?.textContent,
      note: host.querySelector('.gallery-card-note')?.textContent,
      injectedImgs: host.querySelectorAll('img[onerror]').length,
      injectedBold: host.querySelectorAll('.gallery-card-note b').length,
    };
  });

  expect(out.name, 'the tag is shown as text').toBe('<img src=x onerror=alert(1)>');
  expect(out.note).toBe('<b>bold</b>');
  expect(out.injectedImgs).toBe(0);
  expect(out.injectedBold).toBe(0);
});

// --- THE EDITOR ---

test('the editor mounts the gallery bin and its add control is clickable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // toBeVisible() is not "the user can click it" - twice in this project a
  // visible button sat under something. Clicking is the assertion.
  const add = page.locator('#char-gallery-add');
  await expect(add).toBeVisible();

  await page.evaluate(() => {
    // Stub the network boundary only. The modal, the duplicate check and the
    // write into desc_data are all the real thing.
    window.uploadWikiMedia = async () => ({ url: 'https://example.test/added.mp4' });
  });

  await add.click();
  await expect(page.locator('#gallery-item-modal')).toBeVisible();

  // A real file. The modal checks for one BEFORE it checks the name, so a test
  // that only types a name is exercising the "Pick a file first" branch and
  // proving nothing about the upload path.
  await page.setInputFiles('#gallery-item-file', {
    name: 'launcher.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake'),
  });
  await page.fill('#gallery-item-name', 'Launcher');
  await page.click('#gallery-item-confirm');
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    stored: (window.currentEditorDescData.gallery || []).map(i => i.name),
    rows: document.querySelectorAll('#char-gallery-bin-list .gallery-bin-row').length,
    previewCards: document.querySelectorAll('#tab-gallery .gallery-card').length,
    modalOpen: !document.getElementById('gallery-item-modal').classList.contains('hidden'),
  }));

  // THE IMPORTANT ONE: written into currentEditorDescData.gallery, which is
  // what scanKeyedList reads. A working copy would render the bin and the
  // preview exactly like this and submit nothing.
  expect(state.stored).toEqual(['Launcher']);
  expect(state.rows, 'the bin shows the row').toBe(1);
  expect(state.previewCards, 'and the live preview shows the card').toBe(1);
  expect(state.modalOpen, 'the modal closes on success').toBe(false);

  expect(errors).toEqual([]);
});

test('two items cannot share a name, because the name is the delta key', async ({ page }) => {
  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    window.uploadWikiMedia = async () => ({ url: 'https://example.test/x.mp4' });
    window.currentEditorDescData.gallery = [{ name: 'Launcher', src: 'a.mp4', note: '' }];
  });

  await page.click('#char-gallery-add');
  await page.setInputFiles('#gallery-item-file', {
    name: 'dupe.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake'),
  });
  await page.fill('#gallery-item-name', 'launcher');
  await page.click('#gallery-item-confirm');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    status: document.getElementById('gallery-item-status').textContent,
    stored: (window.currentEditorDescData.gallery || []).length,
  }));

  // Case-insensitive: two items differing only in case would still collide at
  // approval time, where the second silently overwrites the first.
  expect(state.status).toContain('already in this gallery');
  expect(state.stored, 'and nothing was added').toBe(1);
});

test('editing and removing a row writes through to desc_data', async ({ page }) => {
  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate((items) => {
    window.customConfirm = async () => true;
    window.currentEditorDescData.gallery = JSON.parse(JSON.stringify(items));
    window.renderCharacterGalleryEditor(document.getElementById('interactive-builder'));
  }, ITEMS);
  await page.waitForTimeout(300);

  await page.locator('#char-gallery-bin-list .gallery-bin-note').first().fill('Now midscreen');
  await page.waitForTimeout(250);

  const edited = await page.evaluate(() => ({
    note: window.currentEditorDescData.gallery[0].note,
    previewNote: document.querySelector('#tab-gallery .gallery-card-note')?.textContent,
  }));

  expect(edited.note).toBe('Now midscreen');
  expect(edited.previewNote, 'the preview follows the input').toBe('Now midscreen');

  await page.locator('#char-gallery-bin-list .gallery-bin-remove').first().click();
  await page.waitForTimeout(300);

  const removed = await page.evaluate(() => ({
    names: (window.currentEditorDescData.gallery || []).map(i => i.name),
    rows: document.querySelectorAll('#char-gallery-bin-list .gallery-bin-row').length,
  }));

  expect(removed.names).toEqual(['Idle Pose']);
  expect(removed.rows).toBe(1);
});

// --- THE REVIEWER ---

test('the diff shows what changed about the media, not just the name', async ({ page }) => {
  // The generic keyed branch renders "<label> Metadata" from the key field and
  // then diffs entry.content - which a gallery item does not have. That would
  // show the reviewer the name and two empty arrays, which is precisely how
  // the Combo List reviewed as "no change" while applying perfectly. The
  // section declares wholeEntryDiff to avoid it.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await page.evaluate(async (items) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    window.currentQueueData = [{
      id: 'g1', page_id: 'boomcat', page_type: 'character', is_delta: true,
      target_scope: 'charGalleryItem', target_key: 'Wall Combo',
      delta_payload: { ...items[0], note: 'CHANGED NOTE', src: 'https://example.test/new.mp4' },
    }];
    window.activePreviewRevId = 'g1';
    window.activePreviewCharId = 'boomcat';
    window.activePreviewPageType = 'character';
    window.activePreviewMode = null;
    const live = { gallery: [items[0]] };
    window.currentLiveDescData = JSON.parse(JSON.stringify(live));
    window.currentPendingDescData = JSON.parse(JSON.stringify(live));
    window.currentLiveFrameData = {};
    window.currentPendingFrameData = {};

    await switchVersionView('diff');
    await new Promise(r => setTimeout(r, 250));
    const c = document.getElementById('admin-diff-container');
    return { blocks: c.querySelectorAll('.diff-container').length, text: c.innerText };
  }, ITEMS);

  expect(out.blocks, 'the reviewer sees something at all').toBeGreaterThan(0);
  expect(out.text, 'and it names the section').toContain('Character Gallery Item');
  expect(out.text, 'the changed note is in the diff').toContain('CHANGED NOTE');
  expect(out.text, 'and so is the changed media').toContain('new.mp4');
});
