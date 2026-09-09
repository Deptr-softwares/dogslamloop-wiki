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

// --- THE WORKSPACE FOOTER ON THE BIN (v0.18 F9, owner's addition) ---
//
// Two asks, one mechanism: the quick styling tools so a media title or note can
// be styled like any other prose, and the Media Library so an existing file can
// be RE-USED rather than uploaded a second time.
//
// The footer is reused by calling initStrategyBlockBuilder in 'gallery' mode
// rather than by lifting the toolbar out of it, so the risk is not that the
// buttons are missing - it is that block machinery still thinks it is driving.

test('the gallery bin gets the workspace footer, with ADD BLOCK greyed out', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await expect(page.locator('#interactive-builder .format-toolbar')).toBeVisible();
  await expect(page.locator('#btn-media-library')).toBeVisible();

  // Greyed, not gone: the footer's shape is the thing being reused, and a
  // missing button reads as a broken one.
  await expect(page.locator('#btn-toggle-add-menu')).toBeDisabled();

  // UNDO / REDO / CLEAR ALL are the block history, which a bin never writes to.
  await expect(page.locator('#interactive-builder .strategy-toolbar-row')).toBeHidden();

  // The bin is a SIBLING of #block-list, not inside it. Asserted structurally
  // because it is load-bearing: every delegated block listener reads
  // `e.target.closest('.block-card').getAttribute(...)`, so a bin row inside
  // #block-list throws on the first click. That is not a style preference -
  // it is the bug this arrangement exists to avoid.
  const placement = await page.evaluate(() => {
    const list = document.getElementById('block-list');
    const bin = document.getElementById('char-gallery-bin-list');
    return { insideBlockList: !!(list && bin && list.contains(bin)) };
  });
  expect(placement.insideBlockList, 'the bin must not live inside #block-list').toBe(false);

  expect(errors).toEqual([]);
});

test('a styling button writes a shortcode into a bin field and through to desc_data', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    window.currentEditorDescData.gallery = [
      { name: 'Wall Combo', src: 'https://example.test/wall.mp4', alt: '', note: '', tags: [] },
    ];
    window.renderCharacterGalleryEditor(document.getElementById('interactive-builder'));
  });

  // Select the whole name, the way a contributor would before pressing Bold.
  // The keyup is what the toolbar's saveSelection listens for - without it the
  // range it writes into is whatever was recorded last, which is the bug that
  // would make this feature apply Bold to nothing.
  await page.evaluate(() => {
    const field = document.querySelector('#char-gallery-bin-list .gallery-bin-name');
    field.focus();
    field.setSelectionRange(0, field.value.length);
    field.dispatchEvent(new Event('keyup', { bubbles: true }));
  });

  await page.click('.format-toolbar .format-btn[data-tag="b"]');
  await page.waitForTimeout(200);

  const out = await page.evaluate(() => ({
    field: document.querySelector('#char-gallery-bin-list .gallery-bin-name').value,
    stored: (window.currentEditorDescData.gallery || []).map(i => i.name),
  }));

  expect(out.field).toBe('[b]Wall Combo[/b]');
  // The write-through is the half that matters: the input event the toolbar
  // dispatches is what the bin listens to, so a toolbar that edited the DOM
  // and not the model would look identical here and submit the old name.
  expect(out.stored).toEqual(['[b]Wall Combo[/b]']);

  expect(errors).toEqual([]);
});

test('a caption renders styling shortcodes, and still refuses raw HTML', async ({ page }) => {
  // The reader half. Without this the styling tools above would write
  // shortcodes the reader sees as literal [b]...[/b], which is worse than not
  // offering them at all.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const out = await page.evaluate(() => {
    window.renderCharacterGalleryTab({
      gallery: [{
        name: '[b]Wall Combo[/b]',
        src: 'https://example.test/wall.mp4',
        note: '<b>raw</b> and [i]soft[/i]',
      }],
    });
    window.applyInternalStyling();
    const host = document.getElementById('tab-gallery');
    return {
      boldText: host.querySelector('.gallery-card-name strong.sc-b')?.textContent,
      italicText: host.querySelector('.gallery-card-note em.sc-i')?.textContent,
      rawBold: host.querySelectorAll('.gallery-card-note b').length,
      noteText: host.querySelector('.gallery-card-note')?.textContent,
    };
  });

  expect(out.boldText, 'the shortcode became real markup').toBe('Wall Combo');
  expect(out.italicText).toBe('soft');
  // Positive form: the tag SURVIVES as text. An absence assertion here would
  // pass if the note vanished entirely.
  expect(out.noteText).toContain('<b>raw</b>');
  expect(out.rawBold, 'contributor HTML is still text, not markup').toBe(0);
});

test('the Media Library opens ABOVE the item modal, and a pick re-uses instead of re-uploading', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=boomcat&type=character&tab=gallery', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    // The network boundary only. Counting uploads is the point of this test.
    window.__uploads = 0;
    window.uploadWikiMedia = async () => {
      window.__uploads++;
      return { url: 'https://example.test/should-not-happen.mp4' };
    };
    // The storage boundary, so the REAL loadMediaGallery and renderMediaGrid
    // run and produce a real card to click. Stubbing loadMediaGallery itself
    // would leave the grid empty and force the test to invoke the pick handler
    // by hand - which is not what a click does, and would skip the disarm that
    // lives in the card's own click path.
    window.supabaseClient = window.supabaseClient || {};
    window.supabaseClient.storage = {
      from: () => ({
        list: async () => ({ data: [{ name: 'reused.webp' }], error: null }),
        getPublicUrl: (n) => ({ data: { publicUrl: 'https://example.test/' + n } }),
      }),
    };
  });

  await page.click('#char-gallery-add');
  await expect(page.locator('#gallery-item-modal')).toBeVisible();
  await page.click('#gallery-item-pick');
  await page.waitForTimeout(200);

  // RESOLVED z-index, not the presence of a rule. The library is a tier-1
  // overlay at 9000 and the modal that opens it sets 10005 inline, so opened
  // as-is it renders fully and is completely unclickable - visible, present,
  // and underneath its own caller. toBeVisible() passes on exactly that.
  const z = await page.evaluate(() => ({
    lib: parseInt(getComputedStyle(document.getElementById('media-modal-overlay')).zIndex, 10),
    modal: parseInt(getComputedStyle(document.getElementById('gallery-item-modal')).zIndex, 10),
    armed: typeof window.mediaPickHandler === 'function',
  }));
  expect(z.armed, 'the picker is armed while the library is open').toBe(true);
  expect(z.lib).toBeGreaterThan(z.modal);

  // The real control. Clicking the card is what proves the picker outranks
  // the modal - if the lift were missing this click would hit the item modal
  // instead and time out, which no z-index assertion alone would catch.
  await page.click('.media-thumbnail-card');
  await page.waitForTimeout(200);

  const afterPick = await page.evaluate(() => ({
    name: document.getElementById('gallery-item-name').value,
    armed: typeof window.mediaPickHandler === 'function',
    libZ: document.getElementById('media-modal-overlay').style.zIndex,
  }));
  expect(afterPick.name, 'the name is guessed from the picked filename').toBe('Reused');
  expect(afterPick.armed, 'a one-shot handler is disarmed once it fires').toBe(false);
  expect(afterPick.libZ, 'and the lift is dropped, so the library stacks normally next time').toBe('');

  await page.click('#gallery-item-confirm');
  await page.waitForTimeout(300);

  const stored = await page.evaluate(() => ({
    items: (window.currentEditorDescData.gallery || []).map(i => ({ name: i.name, src: i.src })),
    uploads: window.__uploads,
  }));

  expect(stored.items).toEqual([{ name: 'Reused', src: 'https://example.test/reused.webp' }]);
  // The whole point of re-use: a file already in the bucket is not sent again.
  expect(stored.uploads, 'a picked file is never re-uploaded').toBe(0);

  expect(errors).toEqual([]);
});
