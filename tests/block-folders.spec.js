// Block folders in the editor - v0.15 item 9.
//
// "Group blocks so a long page can be navigated instead of scrolled. Editor-
// facing only - no visitor sees it."
//
// Membership is a `folder` string on the block, which puts it in desc_data and
// therefore in contributor tickets. Two claims carry the whole feature and are
// the reason most of this file exists:
//
//   1. A VISITOR SEES NOTHING. Asserted by rendering the same blocks through
//      the real page renderer with and without folders and comparing the
//      output, not by reasoning about which fields the renderer reads.
//
//   2. THE CONTIGUITY INVARIANT. Array order is the order a reader reads, so a
//      folder is a contiguous run and every operation has to keep it that way.
//      Break it and the list renders two folders with the same name, which the
//      author has no way to tell apart.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=testchar&tab=overview';

async function boot(page) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.collectBlockFolders === 'function', { timeout: 15000 });
  // The same shorthand as P below, but reachable from inside page.evaluate -
  // a Node-scope helper is not in scope in the browser.
  await page.evaluate(() => {
    window.mk = (content, folder) => (folder
      ? { type: 'paragraph', content, folder }
      : { type: 'paragraph', content });
  });
}

// renderBlockList always targets #block-list by id regardless of the container
// it was given, so the page body is replaced rather than appended to - a second
// #block-list would collide with edit.html's own.
async function build(page, blocks) {
  await page.evaluate((b) => {
    document.body.innerHTML = '<div id="block-host"></div>';
    window.initStrategyBlockBuilder('block-host', b);
  }, blocks);
  await expect(page.locator('#block-list .block-card')).toHaveCount(blocks.length);
}

// Node-side, for the fixtures handed to build(). Its browser-side twin is
// window.mk, installed by boot().
const P = (content, folder) => (folder ? { type: 'paragraph', content, folder } : { type: 'paragraph', content });

// The picker is a custom dropdown, not a <select>, so it has to be opened
// before a row can be clicked - which is also the point of it.
async function pickFolder(page, index, rowSelector) {
  const card = page.locator(`#block-list .block-card[data-index="${index}"]`);
  await card.locator('.block-folder-trigger').click();
  await card.locator(rowSelector).click();
}

// Real mouse, not dispatched PointerEvents: startBlockPointerDrag calls
// setPointerCapture, which throws on synthetic events.
async function dragOnto(page, sourceHandle, target) {
  const settled = async (locator, label) => {
    let previous = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const box = await locator.boundingBox();
      if (previous && box && box.y === previous.y && box.height === previous.height) return box;
      previous = box;
      await page.waitForTimeout(40);
    }
    throw new Error(`${label} never settled`);
  };

  const from = await settled(sourceHandle, 'the drag handle');
  const to = await settled(target, 'the drop target');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 20); // past DRAG_THRESHOLD
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
}

// --- THE CLAIM THE WHOLE ITEM RESTS ON ---

test('a visitor sees nothing: the rendered page is identical with and without folders', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    // One of every block type that carries content, so this is not a claim
    // about paragraphs only.
    const bare = [
      { type: 'heading', content: 'Neutral', size: 'h3' },
      { type: 'paragraph', content: 'Poke, then run.' },
      { type: 'list', items: ['Whiff punish', 'Hold back'] },
      { type: 'table', headers: ['Move', 'Note'], rows: [['M1', 'safe']] },
      { type: 'combo', sequence: ['M1', 'Skill'], damage: '40', note: 'corner' },
      { type: 'callout', intent: 'tip', title: 'Tip', content: 'Watch the cooldown.' },
    ];
    const foldered = JSON.parse(JSON.stringify(bare));
    foldered[0].folder = 'Setups';
    foldered[1].folder = 'Setups';
    foldered[2].folder = 'Setups';
    foldered[3].folder = 'Enders';
    foldered[4].folder = 'Enders';

    return {
      bare: window.generateHTMLForBlocks(bare, ''),
      foldered: window.generateHTMLForBlocks(foldered, ''),
    };
  });

  expect(out.foldered).toBe(out.bare);
  // Guards the comparison itself: two empty strings would also be equal.
  expect(out.bare.length).toBeGreaterThan(100);
  expect(out.bare, 'the fixture really did render').toContain('Whiff punish');
  expect(out.foldered, 'the folder name never reaches the page').not.toContain('Setups');
});

// --- THE MODEL ---

test('runs are contiguous, and every foldered block sits in exactly one', async ({ page }) => {
  await boot(page);

  // Checked in BOTH directions. "Every run I report is contiguous" and "every
  // block carrying a folder is inside a run" are different claims, and a
  // grouping that silently dropped a block would satisfy the first alone.
  const out = await page.evaluate(() => {
    const blocks = [
      mk('a', 'Setups'), mk('b', 'Setups'), mk('c'), mk('d', 'Enders'), mk('e'), mk('f', 'Enders'),
    ];
    const runs = window.collectBlockFolders(blocks);

    const covered = [];
    runs.forEach(r => { for (let i = r.start; i <= r.end; i++) covered.push(i); });

    return {
      names: runs.map(r => r.name),
      spans: runs.map(r => `${r.start}-${r.end}`),
      counts: runs.map(r => r.count),
      covered,
      everyCoveredBlockHasThatName: runs.every(r => {
        for (let i = r.start; i <= r.end; i++) if (blocks[i].folder !== r.name) return false;
        return true;
      }),
      everyFolderedBlockIsCovered: blocks.every((b, i) => !b.folder || covered.includes(i)),
      noLooseBlockIsCovered: blocks.every((b, i) => b.folder || !covered.includes(i)),
    };
  });

  // "Enders" appears twice because the array says so - two runs separated by a
  // loose block genuinely ARE two folders, and pretending otherwise would mean
  // reordering the page behind the author's back.
  expect(out.names).toEqual(['Setups', 'Enders', 'Enders']);
  expect(out.spans).toEqual(['0-1', '3-3', '5-5']);
  expect(out.counts).toEqual([2, 1, 1]);
  expect(out.everyCoveredBlockHasThatName).toBe(true);
  expect(out.everyFolderedBlockIsCovered).toBe(true);
  expect(out.noLooseBlockIsCovered).toBe(true);
});

test('joining a folder moves the block next to it, rather than leaving it stranded', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const blocks = [mk('a', 'Setups'), mk('b', 'Setups'), mk('c'), mk('d')];
    const landedAt = window.assignBlockToFolder(blocks, 3, 'Setups');
    return {
      landedAt,
      order: blocks.map(b => b.content),
      folders: blocks.map(b => b.folder || null),
      runs: window.collectBlockFolders(blocks).length,
    };
  });

  expect(out.landedAt).toBe(2);
  expect(out.order, 'd moved up to sit with the folder').toEqual(['a', 'b', 'd', 'c']);
  expect(out.folders).toEqual(['Setups', 'Setups', 'Setups', null]);
  expect(out.runs, 'still one folder, not two called Setups').toBe(1);
});

test('leaving from the middle steps out past the folder instead of splitting it', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const blocks = [mk('a', 'Setups'), mk('b', 'Setups'), mk('c', 'Setups'), mk('d')];
    const landedAt = window.assignBlockToFolder(blocks, 1, '');
    const runs = window.collectBlockFolders(blocks);
    return {
      landedAt,
      order: blocks.map(b => b.content),
      folders: blocks.map(b => b.folder || null),
      runNames: runs.map(r => r.name),
    };
  });

  expect(out.landedAt).toBe(2);
  expect(out.order, 'b stepped out to just after the run').toEqual(['a', 'c', 'b', 'd']);
  expect(out.folders).toEqual(['Setups', 'Setups', null, null]);
  // The whole point: naively deleting `folder` in place would leave
  // Setups / loose / Setups and render two folders with one name.
  expect(out.runNames).toEqual(['Setups']);
});

test('a block dragged into the middle of a folder joins it', async ({ page }) => {
  await boot(page);

  const folders = await page.evaluate(() => {
    // What a drag leaves behind: the array element moved, `folder` untouched.
    const blocks = [mk('a', 'Setups'), mk('c'), mk('b', 'Setups')];
    window.reconcileFolderAt(blocks, 1);
    return blocks.map(b => b.folder || null);
  });

  expect(folders).toEqual(['Setups', 'Setups', 'Setups']);
});

test('a block dragged clear of its folder leaves it', async ({ page }) => {
  await boot(page);

  const folders = await page.evaluate(() => {
    const blocks = [mk('a', 'Setups'), mk('b', 'Setups'), mk('x'), mk('c', 'Setups')];
    window.reconcileFolderAt(blocks, 3);
    return blocks.map(b => b.folder || null);
  });

  expect(folders).toEqual(['Setups', 'Setups', null, null]);
});

test('a one-block folder survives being moved', async ({ page }) => {
  await boot(page);

  // The case the obvious rule destroys. "Touching no other member, so it was
  // dragged out" is right for a folder with other members and wrong for a
  // folder of one - which would make a solo folder impossible to reposition.
  const folders = await page.evaluate(() => {
    const blocks = [mk('x'), mk('only', 'Notes'), mk('y')];
    window.reconcileFolderAt(blocks, 1);
    return blocks.map(b => b.folder || null);
  });

  expect(folders).toEqual([null, 'Notes', null]);
});

test('renaming rewrites every member, and refuses a name already in use', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const blocks = [mk('a', 'Setups'), mk('b', 'Setups'), mk('c', 'Enders')];
    const clash = window.renameBlockFolder(blocks, 'Setups', 'Enders');
    const foldersAfterClash = blocks.map(b => b.folder);
    const ok = window.renameBlockFolder(blocks, 'Setups', 'Openers');
    return { clash, ok, foldersAfterClash, folders: blocks.map(b => b.folder) };
  });

  expect(out.clash, 'a duplicate name is refused').toBe(false);
  expect(out.foldersAfterClash, 'and changes nothing').toEqual(['Setups', 'Setups', 'Enders']);
  expect(out.ok).toBe(true);
  expect(out.folders).toEqual(['Openers', 'Openers', 'Enders']);
});

test('ungrouping keeps every block', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const blocks = [mk('a', 'Setups'), mk('b', 'Setups'), mk('c')];
    const removed = window.ungroupBlockFolder(blocks, 'Setups');
    return { removed, order: blocks.map(b => b.content), folders: blocks.map(b => b.folder || null) };
  });

  expect(out.removed).toBe(2);
  expect(out.order, 'a folder is organisation - dissolving it is not a delete').toEqual(['a', 'b', 'c']);
  expect(out.folders).toEqual([null, null, null]);
});

test('dropping on the header puts the block at the TOP of the folder', async ({ page }) => {
  await boot(page);

  // Distinct from assignBlockToFolder, which appends. Dropping onto a header
  // is a deliberate aim at the folder itself, and the end of a long folder is
  // not where you were pointing.
  const out = await page.evaluate(() => {
    const below = [mk('a', 'Setups'), mk('b', 'Setups'), mk('c')];
    const fromBelow = window.dropBlockIntoFolderHead(below, 2, 'Setups');

    const above = [mk('c'), mk('a', 'Setups'), mk('b', 'Setups')];
    const fromAbove = window.dropBlockIntoFolderHead(above, 0, 'Setups');

    return {
      fromBelow, fromAbove,
      belowOrder: below.map(b => b.content),
      aboveOrder: above.map(b => b.content),
      belowRuns: window.collectBlockFolders(below).map(r => `${r.name}:${r.start}-${r.end}`),
      aboveRuns: window.collectBlockFolders(above).map(r => `${r.name}:${r.start}-${r.end}`),
    };
  });

  expect(out.fromBelow).toBe(0);
  expect(out.belowOrder).toEqual(['c', 'a', 'b']);
  expect(out.belowRuns, 'one folder, and c is first in it').toEqual(['Setups:0-2']);

  // Approaching from above is the case where the splice-out shifts the run
  // underneath the insertion point.
  expect(out.fromAbove).toBe(0);
  expect(out.aboveOrder).toEqual(['c', 'a', 'b']);
  expect(out.aboveRuns).toEqual(['Setups:0-2']);
});

// --- RENDERING AND INTERACTION ---

test('cards inside a folder keep their real array index', async ({ page }) => {
  await boot(page);
  await build(page, [P('a'), P('b', 'Setups'), P('c', 'Setups'), P('d')]);

  // Every handler in editor-blocks.js resolves the block it acts on through
  // data-index. A grouping that renumbered cards would break delete, move,
  // type-change and every field write at once, silently editing the wrong
  // block rather than throwing.
  const out = await page.evaluate(() => {
    const shell = document.querySelector('#block-list .block-folder');
    const inside = [...shell.querySelectorAll('.block-card')].map(c => c.getAttribute('data-index'));
    const all = [...document.querySelectorAll('#block-list .block-card')].map(c => c.getAttribute('data-index'));
    return { inside, all, folderName: shell.getAttribute('data-folder'), shells: document.querySelectorAll('#block-list .block-folder').length };
  });

  expect(out.shells).toBe(1);
  expect(out.folderName).toBe('Setups');
  expect(out.inside, 'the folder holds blocks 1 and 2, numbered as such').toEqual(['1', '2']);
  expect(out.all, 'and the list still runs 0..3 in order').toEqual(['0', '1', '2', '3']);
});

test('collapsing a folder actually hides its blocks, and survives a re-render', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a'), P('b', 'Setups'), P('c', 'Setups')]);

  const card = page.locator('#block-list .block-folder .block-card').first();
  await expect(card).toBeVisible();

  await page.locator('#block-list .block-folder-toggle').click();

  // The computed value, not the class: the class is what should CAUSE this,
  // and asserting the cause is how v0.15 shipped nine green tests over a
  // visibly broken feature.
  const hidden = await page.evaluate(() => {
    const body = document.querySelector('#block-list .block-folder-body');
    return getComputedStyle(body).display;
  });
  expect(hidden).toBe('none');
  expect(errors, 'the toggle sits outside any .block-card, where the data-index lookup throws').toEqual([]);

  // A collapse that did not survive renderBlockList would be useless - the
  // list re-renders on nearly every edit.
  await page.evaluate(() => window.renderBlockList());
  const stillHidden = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#block-list .block-folder-body')).display);
  expect(stillHidden).toBe('none');
});

test('a block can be dragged onto the header of a COLLAPSED folder', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', 'Setups'), P('b', 'Setups'), P('c')]);

  // The case that made the header a drop target at all: collapsed, the folder
  // shows no cards, so computeDropTarget's .block-card lookup finds nothing
  // and every drop near it would be a silent no-op.
  await page.locator('#block-list .block-folder-toggle').click();
  // Hidden, not removed - a collapse is CSS, so the cards are still in the DOM
  // and toHaveCount(0) would be asserting the wrong thing entirely.
  await expect(page.locator('#block-list .block-folder .block-card').first()).not.toBeVisible();

  // Real mouse, not dispatched PointerEvents: startBlockPointerDrag calls
  // setPointerCapture, which throws on synthetic events.
  const settled = async (locator, label) => {
    let previous = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const box = await locator.boundingBox();
      if (previous && box && box.y === previous.y && box.height === previous.height) return box;
      previous = box;
      await page.waitForTimeout(40);
    }
    throw new Error(`${label} never settled`);
  };

  const handle = page.locator('#block-list .block-card[data-index="2"] .drag-handle');
  const head = page.locator('#block-list .block-folder-head');

  const handleBox = await settled(handle, 'the drag handle');
  const headBox = await settled(head, 'the folder header');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 20); // past DRAG_THRESHOLD
  await page.mouse.move(headBox.x + headBox.width / 2, headBox.y + headBox.height / 2, { steps: 5 });
  await page.mouse.up();

  const out = await page.evaluate(() => ({
    order: window.getActiveBlocks().map(b => b.content),
    folders: window.getActiveBlocks().map(b => b.folder || null),
  }));

  expect(errors).toEqual([]);
  expect(out.folders, 'it joined the folder it was dropped on').toEqual(['Setups', 'Setups', 'Setups']);
  expect(out.order, 'and landed at the top of it').toEqual(['c', 'a', 'b']);
});

test('the per-card dropdown files a block into a folder', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', 'Setups'), P('b'), P('c')]);

  // Driven through the real control rather than by calling the model: the
  // picker sits inside #block-list, where a delegated input handler resolves
  // .block-card and writes data-field onto the block. A control that looked
  // right and corrupted the block would pass every model test above.
  await pickFolder(page, 2, '.folder-option-item');

  const out = await page.evaluate(() => {
    const blocks = window.getActiveBlocks();
    return {
      order: blocks.map(b => b.content),
      folders: blocks.map(b => b.folder || null),
      keys: [...new Set(blocks.flatMap(b => Object.keys(b)))].sort(),
      cardsInShell: document.querySelectorAll('#block-list .block-folder .block-card').length,
    };
  });

  expect(errors).toEqual([]);
  expect(out.folders).toEqual(['Setups', 'Setups', null]);
  expect(out.order, 'c moved up to join the folder').toEqual(['a', 'c', 'b']);
  expect(out.cardsInShell).toBe(2);
  // No stray field written by a handler that mistook this for a block input.
  expect(out.keys).toEqual(['content', 'folder', 'type']);
});

test('"New folder" makes one rather than clearing the block', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a'), P('b')]);

  // "Create new folder" is a row that is not a folder, which is the whole
  // reason this is a custom dropdown - as a native select it read as a third
  // near-identical folder, and picking it looked like picking one.
  await pickFolder(page, 0, '.folder-option-new');

  const out = await page.evaluate(() => ({
    folders: window.getActiveBlocks().map(b => b.folder || null),
    shells: document.querySelectorAll('#block-list .block-folder').length,
  }));

  expect(errors).toEqual([]);
  expect(out.folders).toEqual(['New Folder', null]);
  expect(out.shells).toBe(1);
});

// --- THE DROPDOWN TELLS ITS THREE KINDS OF ROW APART ---

test('the picker distinguishes "no folder" and "create new" from actual folders', async ({ page }) => {
  await boot(page);
  await build(page, [P('a', 'Setups'), P('b', 'Enders'), P('c')]);

  await page.locator('#block-list .block-card[data-index="2"] .block-folder-trigger').click();

  const out = await page.evaluate(() => {
    // Scoped through .block-folder-picker: initializeMangaSelects converts the
    // block-type <select> in the same row into its own .manga-select-options,
    // and an unscoped query finds that one first.
    const menu = document.querySelector(
      '#block-list .block-card[data-index="2"] .block-folder-picker .manga-select-options');
    const read = (sel) => {
      const el = menu.querySelector(sel);
      if (!el) return null;
      return {
        text: el.textContent.trim(),
        colour: getComputedStyle(el).color,
        marker: getComputedStyle(el, '::before').content,
      };
    };
    return {
      folders: menu.querySelectorAll('.folder-option-item').length,
      none: read('.folder-option-none'),
      create: read('.folder-option-new'),
      item: read('.folder-option-item'),
      sepIsNotAChoice: !menu.querySelector('.folder-option-sep.folder-option'),
    };
  });

  expect(out.folders, 'one row per real folder').toBe(2);

  // The rendered consequence, not the class that should cause it: as a native
  // select all three rows painted identically, which is the bug being fixed.
  expect(out.none.colour).not.toBe(out.item.colour);
  expect(out.create.colour).not.toBe(out.item.colour);
  expect(out.none.colour).not.toBe(out.create.colour);

  // And each kind carries its own mark rather than all three reading as folders.
  expect(out.item.marker, 'a folder is marked as one').toContain('📁');
  expect(out.none.marker).not.toContain('📁');
  expect(out.create.marker).not.toContain('📁');

  expect(out.sepIsNotAChoice, 'the group label is not selectable').toBe(true);
});

test('the folder picker and the block-type dropdown do not sit on top of each other', async ({ page }) => {
  await boot(page);
  await build(page, [{ type: 'heading', content: 'The Unbeatable', size: 'h3', folder: 'Setups' }, P('b')]);

  // initializeMangaSelects swaps the type <select> for a wrapper of a different
  // width, so the row is not final until that has run.
  await expect(page.locator('#block-list .manga-select-trigger').first()).toBeVisible();

  const out = await page.evaluate(() => {
    const card = document.querySelector('#block-list .block-card[data-index="0"]');
    const typeWrap = card.querySelector('.block-type-row .manga-select-wrapper:not(.block-folder-picker)');
    const typeTrigger = typeWrap.querySelector('.manga-select-trigger');
    const pickTrigger = card.querySelector('.block-folder-trigger');

    // What decides a click is which element is on top at that point. Both of
    // these were reachable-looking and one was covered - the same shape as the
    // confirm-modal and reorder-control bugs earlier in v0.15.
    const hits = (el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (el === top || el.contains(top) || top.contains(el));
    };

    const a = typeTrigger.getBoundingClientRect();
    const b = pickTrigger.getBoundingClientRect();
    const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    return {
      typeWidth: Math.round(typeWrap.getBoundingClientRect().width),
      typeClipped: typeTrigger.scrollWidth > typeTrigger.clientWidth,
      overlaps,
      typeClickable: hits(typeTrigger),
      pickerClickable: hits(pickTrigger),
    };
  });

  // The defect itself: .manga-select-wrapper is `flex: 1` with `min-width: 0`,
  // which is a zero basis free to collapse, and in a row that shrink-wraps it
  // resolved to exactly 0 - while its trigger, being position:relative rather
  // than clipped, carried on drawing across the folder picker.
  expect(out.typeWidth, 'the type dropdown has a width at all').toBeGreaterThan(0);
  expect(out.overlaps, 'the two controls occupy separate boxes').toBe(false);
  expect(out.typeClipped, 'and the type label is not cut off').toBe(false);
  expect(out.typeClickable).toBe(true);
  expect(out.pickerClickable).toBe(true);
});

// --- EMPTY FOLDERS ---

test('the header + makes an empty folder after this one, and it is not in the data', async ({ page }) => {
  await boot(page);
  await build(page, [P('a', 'Setups'), P('b')]);

  await page.locator('#block-list .block-folder-add').click();

  const out = await page.evaluate(() => ({
    shells: [...document.querySelectorAll('#block-list .block-folder')]
      .map(s => `${s.getAttribute('data-folder')}${s.classList.contains('is-empty') ? ':empty' : ''}`),
    // An empty folder has no member to carry its name, so it CANNOT be in
    // desc_data - it is session state until a block joins it.
    folders: window.getActiveBlocks().map(b => b.folder || null),
  }));

  expect(out.shells).toEqual(['Setups', 'New Folder:empty']);
  expect(out.folders, 'no block was touched').toEqual(['Setups', null]);
});

// An empty folder is drawn after the folder it was made from, so filing a block
// into it has to MOVE that block there. Creating the folder wherever the block
// already sat would put it somewhere the author was not pointing.
//
// Both fixtures below are chosen so the block is NOT already in the right
// place. The first version of this test filed a block that happened to sit
// exactly where the folder was drawn, so "move it there" and "create it in
// place" produced identical output - it passed against a build that ignored the
// anchor completely, and only reverting the code showed it.

test('filing a block from ABOVE into an empty folder moves it down to that folder', async ({ page }) => {
  await boot(page);
  await build(page, [P('above'), P('anchor', 'Setups'), P('mid')]);

  await page.locator('#block-list .block-folder-add').click();
  await pickFolder(page, 0, '.folder-option-item[data-folder-name="New Folder"]');

  const out = await page.evaluate(() => ({
    order: window.getActiveBlocks().map(b => b.content),
    folders: window.getActiveBlocks().map(b => b.folder || null),
    empties: document.querySelectorAll('#block-list .block-folder.is-empty').length,
  }));

  expect(out.order, 'it travelled past the anchor folder').toEqual(['anchor', 'above', 'mid']);
  expect(out.folders).toEqual(['Setups', 'New Folder', null]);
  expect(out.empties, 'it is a real folder now, not an empty one').toBe(0);
});

test('filing a block from BELOW into an empty folder moves it up to that folder', async ({ page }) => {
  await boot(page);
  await build(page, [P('anchor', 'Setups'), P('mid'), P('below')]);

  await page.locator('#block-list .block-folder-add').click();
  await pickFolder(page, 2, '.folder-option-item[data-folder-name="New Folder"]');

  const out = await page.evaluate(() => ({
    order: window.getActiveBlocks().map(b => b.content),
    folders: window.getActiveBlocks().map(b => b.folder || null),
  }));

  // The other direction, because the splice-out shifts the anchor only when
  // the block started above it - the two cases take different arithmetic.
  expect(out.order).toEqual(['anchor', 'below', 'mid']);
  expect(out.folders).toEqual(['Setups', 'New Folder', null]);
});

test('an empty folder can be discarded, and a name it holds cannot be reused', async ({ page }) => {
  await boot(page);
  await build(page, [P('a', 'Setups'), P('b')]);

  await page.locator('#block-list .block-folder-add').click();

  // While it exists it owns its name - otherwise renaming onto it would make
  // two folders called the same thing, the exact state the run model refuses.
  const taken = await page.evaluate(() =>
    window.blockFolderNameTaken(window.getActiveBlocks(), 'New Folder'));
  expect(taken).toBe(true);

  await page.locator('#block-list .block-folder.is-empty .block-folder-discard').click();

  await expect(page.locator('#block-list .block-folder.is-empty')).toHaveCount(0);
  await expect(page.locator('#block-list .block-folder')).toHaveCount(1);

  const freed = await page.evaluate(() =>
    window.blockFolderNameTaken(window.getActiveBlocks(), 'New Folder'));
  expect(freed, 'and gives it back on discard').toBe(false);
});

// --- NESTING INTO A CONTAINER BLOCK ---

test('a block dragged onto an accordion goes inside it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [
    { type: 'accordion', title: 'Tech', content: [] },
    P('moves inside', 'Setups'),
  ]);

  await dragOnto(
    page,
    page.locator('#block-list .block-card[data-index="1"] .drag-handle'),
    page.locator('#block-list .block-card[data-index="0"] .accordion-inner-block-wrapper'),
  );

  const out = await page.evaluate(() => {
    const blocks = window.getActiveBlocks();
    return {
      outer: blocks.map(b => b.content && b.content.length !== undefined ? b.type : b.type),
      count: blocks.length,
      inner: (blocks[0].content || []).map(b => b.content),
      innerFolder: (blocks[0].content || []).map(b => b.folder || null),
    };
  });

  expect(errors).toEqual([]);
  expect(out.count, 'it left this level').toBe(1);
  expect(out.inner, 'and landed in the accordion').toEqual(['moves inside']);
  // Its folder described where it used to live. Carried along it would render
  // inside the accordion as a folder of one, named after somewhere invisible.
  expect(out.innerFolder).toEqual([null]);
});

test('a theorybox takes a nested drop the same way, without being named anywhere', async ({ page }) => {
  await boot(page);
  await build(page, [
    { type: 'theorybox', title: 'Corner BnB', sequence: [], content: [] },
    P('the write-up'),
  ]);

  // Both containers render the same .accordion-inner-block-wrapper, so the
  // drop target is shared rather than listed per type - a container added
  // later works without anyone coming back to it.
  await dragOnto(
    page,
    page.locator('#block-list .block-card[data-index="1"] .drag-handle'),
    page.locator('#block-list .block-card[data-index="0"] .accordion-inner-block-wrapper'),
  );

  const out = await page.evaluate(() => {
    const blocks = window.getActiveBlocks();
    return { count: blocks.length, inner: (blocks[0].content || []).map(b => b.content) };
  });

  expect(out.count).toBe(1);
  expect(out.inner).toEqual(['the write-up']);
});

test('a container cannot be dropped into itself', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [{ type: 'accordion', title: 'Tech', content: [] }, P('b')]);

  await dragOnto(
    page,
    page.locator('#block-list .block-card[data-index="0"] .drag-handle'),
    page.locator('#block-list .block-card[data-index="0"] .accordion-inner-block-wrapper'),
  );

  const out = await page.evaluate(() => {
    const blocks = window.getActiveBlocks();
    return { count: blocks.length, innerCount: (blocks[0].content || []).length };
  });

  expect(errors).toEqual([]);
  expect(out.count, 'nothing was swallowed').toBe(2);
  expect(out.innerCount).toBe(0);
});

test('ungrouping from the header keeps every card on screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', 'Setups'), P('b', 'Setups'), P('c')]);

  await page.locator('#block-list .block-folder-ungroup').click();

  await expect(page.locator('#block-list .block-folder')).toHaveCount(0);
  await expect(page.locator('#block-list .block-card')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('renaming to a name already in use is refused and the field snaps back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', 'Setups'), P('b', 'Enders')]);

  // Stubbed rather than asserted through #editor-alert-modal, because the
  // modal is edit.html's. owner.html and tier-editor.html load this same block
  // builder WITHOUT editor-core.js, so the unguarded call this replaced threw
  // there - which is what the first version of this test caught.
  await page.evaluate(() => {
    window.__alerts = [];
    window.editorAlert = (m) => window.__alerts.push(m);
  });

  const input = page.locator('#block-list .block-folder-name-input').first();
  await input.fill('Enders');
  await input.blur();

  await expect(input).toHaveValue('Setups');
  expect(errors).toEqual([]);

  const out = await page.evaluate(() => ({
    folders: window.getActiveBlocks().map(b => b.folder),
    alerts: window.__alerts,
  }));
  expect(out.folders, 'neither folder was touched').toEqual(['Setups', 'Enders']);
  expect(out.alerts.join(' ')).toContain('already has a folder called "Enders"');
});

test('the rename clash does not throw on a page with no alert modal', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', 'Setups'), P('b', 'Enders')]);

  // owner.html and tier-editor.html load editor-blocks.js and never load
  // editor-core.js, so window.editorAlert genuinely is undefined on both.
  await page.evaluate(() => { delete window.editorAlert; });

  const input = page.locator('#block-list .block-folder-name-input').first();
  await input.fill('Enders');
  await input.blur();

  await expect(input).toHaveValue('Setups');
  expect(errors, 'no alert modal is not a reason to break the editor').toEqual([]);
});

test('a folder name is escaped, not executed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await build(page, [P('a', '" onfocus=alert(1) autofocus="'), P('b')]);

  // The exact attribute-escape shape called out at the top of
  // editor-blocks.js, which was live once. Asserting the value SURVIVES
  // rather than that a substring is missing - an escaping bug that dropped
  // the field entirely would also pass a not.toContain check.
  const value = await page.locator('#block-list .block-folder-name-input').inputValue();
  expect(value).toBe('" onfocus=alert(1) autofocus="');
  expect(errors).toEqual([]);
});

// --- THE REST OF THE PIPELINE ---

test('find and replace does not rewrite folder names', async ({ page }) => {
  await boot(page);

  const paths = await page.evaluate(() => {
    const data = {
      overview: [
        { type: 'paragraph', content: 'Ryu is strong', folder: 'Ryu routes' },
      ],
    };
    return window.findEditorMatches(data, 'Ryu', { wholeWord: false }).map(m => m.path.join('.'));
  });

  // A folder is organisation, not page text. Renaming a character should not
  // silently regroup the block list as a side effect.
  expect(paths).toEqual(['overview.0.content']);
});

test('Diff View names the folder field in words', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const html = await page.evaluate(() =>
    window.renderStructuredDiff(
      { type: 'paragraph', folder: 'Setups' },
      { type: 'paragraph', folder: 'Enders' },
    ));

  // Shown, not hidden: joining a folder MOVES the block, and a reviewer
  // looking at a reordering with no stated reason is worse off than one
  // reading a line of metadata.
  expect(html).toContain('Editor Folder');
  expect(html).toContain('<del class="diff-del">Setups</del>');
  expect(html).toContain('<ins class="diff-add">Enders</ins>');
});
