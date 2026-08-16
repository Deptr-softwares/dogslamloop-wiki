// The Combo Card (TheoryBox) - v0.15 item 4.
//
// A combo group is `{ title, content: [blocks] }`, which on its own is just a
// named container - structurally identical to a matchup. The Combo Card is
// what makes it a COMBO group: a card carrying the route and its numbers, plus
// a write-up that is itself blocks, nested exactly like an accordion.
//
// A new block type costs six sites in four files, and the last two are the
// ones that hurt: miss them and the block renders for readers but is invisible
// to the reviewer approving it, or is silently lost on draft sync.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CARD = {
  type: 'theorybox',
  title: 'Corner BnB',
  oneliner: 'The one you land 90% of the time.',
  difficulty: 'Medium',
  sequence: ['M1', 'M1', 'MURMURATE', 'R↑'],
  damage: '38-46',
  video: 'https://youtu.be/abc123',
  content: [{ type: 'paragraph', content: 'Delay the third M1 or the route drops.' }],
};

test('all six sites handle the block, or it breaks somewhere invisible', () => {
  // Derived from the file list rather than asserted by rendering, because two
  // of the six only ever run inside a reviewer's session or a draft sync -
  // exactly the two that are easiest to forget and hardest to notice.
  const sites = {
    'js/editor-blocks.js': [
      /theorybox: \{ type: 'theorybox'/,          // 1. registry default shape
      /data-type="theorybox"/,                     // 2. the picker button
      /block\.type === 'theorybox'/,               // 3. the editor form
      /field === 'sequence-lines'/,                // the route is an ARRAY
    ],
    'js/description.js': [/block\.type === 'theorybox'/],   // 4. reader
    'js/admin-preview.js': [/b\.type === 'theorybox'/],     // 5. reviewer preview
    'js/editor-sync.js': [/b\.type === 'theorybox'/],       // 6. draft sync
  };

  const missing = [];
  for (const [file, patterns] of Object.entries(sites)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    patterns.forEach(p => { if (!p.test(src)) missing.push(`${file} :: ${p}`); });
  }
  expect(missing, 'a block type handled at fewer than six sites fails silently').toEqual([]);
});

test('the card renders its route, numbers and nested write-up', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const card = await page.evaluate((block) => {
    const host = document.createElement('div');
    host.id = 'tb-host';
    document.querySelector('main').appendChild(host);
    host.innerHTML = window.generateHTMLForBlocks([block]);
    const box = host.querySelector('.theorybox');
    return {
      title: box.querySelector('.theorybox-title')?.textContent,
      oneliner: box.querySelector('.theorybox-oneliner')?.textContent,
      difficulty: box.querySelector('.theorybox-difficulty')?.textContent,
      // The ramp class, so difficulty reads the same here as in the table.
      difficultyClass: [...(box.querySelector('.theorybox-difficulty')?.classList || [])]
        .find(c => /^combo-difficulty-\d+$/.test(c)),
      chips: [...box.querySelectorAll('.theorybox-route .combo-node')].map(n => n.textContent),
      seps: [...box.querySelectorAll('.theorybox-route .combo-sep')].map(s => s.textContent.trim()),
      damage: box.querySelector('.combo-damage')?.textContent,
      video: box.querySelector('.theorybox-video')?.getAttribute('href'),
      // The write-up is real blocks, not a string.
      bodyParagraph: box.querySelector('.theorybox-body p')?.textContent,
      anchor: box.getAttribute('id'),
    };
  }, CARD);

  expect(card.title).toBe('Corner BnB');
  expect(card.oneliner).toBe('The one you land 90% of the time.');
  expect(card.difficulty).toBe('Medium');
  expect(card.difficultyClass, 'difficulty uses the same ordinal ramp as the table').toBe('combo-difficulty-2');
  expect(card.chips).toEqual(['M1', 'M1', 'MURMURATE', 'R↑']);
  expect(card.seps).toEqual(['>', '>', '>']);
  expect(card.damage).toBe('38-46');
  expect(card.video).toBe('https://youtu.be/abc123');
  expect(card.bodyParagraph).toContain('Delay the third M1');
  // Derived from the title, so a card is linkable without anyone thinking
  // about anchors.
  expect(card.anchor).toBe('combo-corner-bnb');
  expect(errors).toEqual([]);
});

test('a card nests inside a card, because the body is blocks', async ({ page }) => {
  // The property that makes a combo GROUP a group. If the body were a string
  // this would be impossible, and a card could not hold its own variants.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const depth = await page.evaluate((block) => {
    const outer = JSON.parse(JSON.stringify(block));
    outer.title = 'Outer';
    outer.content = [{ ...JSON.parse(JSON.stringify(block)), title: 'Inner variant' }];

    const host = document.createElement('div');
    document.querySelector('main').appendChild(host);
    host.innerHTML = window.generateHTMLForBlocks([outer]);
    return {
      nested: host.querySelectorAll('.theorybox .theorybox').length,
      titles: [...host.querySelectorAll('.theorybox-title')].map(t => t.textContent),
      // The ids must differ, or an anchor link lands on the wrong card.
      ids: [...host.querySelectorAll('.theorybox')].map(b => b.id),
    };
  }, CARD);

  expect(depth.nested).toBe(1);
  expect(depth.titles).toEqual(['Outer', 'Inner variant']);
  expect(new Set(depth.ids).size, 'nested cards need distinct anchors').toBe(2);
});

test('nothing on the card is parsed as markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const payload = '<img src=x onerror="window.__PWN=1">';
    const host = document.createElement('div');
    host.id = 'tb-xss';
    document.querySelector('main').appendChild(host);
    host.innerHTML = window.generateHTMLForBlocks([{
      type: 'theorybox',
      title: payload, oneliner: payload, difficulty: payload, damage: payload,
      sequence: [payload],
      // Not an escaping problem - a scheme check, the same one every other
      // block URL goes through.
      video: 'javascript:window.__PWN=1',
      // The anchor lands in an id ATTRIBUTE, where a quote breaks out.
      anchor: '" onmouseover="window.__PWN=1',
      content: [{ type: 'paragraph', content: payload }],
    }]);
    const box = host.querySelector('.theorybox');
    return {
      injected: host.querySelectorAll('img').length,
      videoRendered: !!host.querySelector('.theorybox-video'),
      id: box.getAttribute('id'),
      strayAttrs: box.getAttributeNames().filter(a => a !== 'class' && a !== 'id'),
    };
  });
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => !!window.__PWN)).toBe(false);
  expect(result.injected).toBe(0);
  expect(result.videoRendered, 'a javascript: video link is dropped').toBe(false);
  expect(result.strayAttrs, 'the anchor must not manufacture attributes').toEqual([]);
  // Underscores go too - the class is [a-z0-9], not \w. Worth pinning: the
  // point is that NOTHING but letters, digits and hyphens survives into an id.
  expect(result.id, 'the anchor is reduced to letters, digits and hyphens').toBe('combo-onmouseover-window-pwn-1');
  expect(result.id).toMatch(/^combo-[a-z0-9-]*$/);
  expect(errors).toEqual([]);
});

test('the editor offers the card and writes its route as an array', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // A card lives inside a group, which is where the block builder is.
  await page.locator('[onclick*="addComboGroup"]').click();
  await page.waitForTimeout(400);

  // The real control, not a guess: the picker is behind ADD BLOCK.
  await page.locator('#btn-toggle-add-menu').click();
  await page.waitForTimeout(250);
  const picker = page.locator('[data-type="theorybox"]');
  await expect(picker, 'the block picker offers a Combo Card').toHaveCount(1);
  await picker.click();
  await page.waitForTimeout(400);

  await page.locator('[data-field="sequence-lines"]').fill('M1\n\nMURMURATE\nR↑');
  await page.locator('[data-field="damage"]').fill('38-46');
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const groups = window.currentEditorDescData.comboGroups || [];
    const blocks = (window.getActiveBlocks && window.getActiveBlocks()) || [];
    const card = blocks.find(b => b && b.type === 'theorybox');
    return {
      groups: groups.length,
      card: card ? { sequence: card.sequence, damage: card.damage, hasContent: Array.isArray(card.content) } : null,
      previewCards: document.querySelectorAll('#tab-combos .theorybox').length,
    };
  });

  expect(state.card, 'the card was added to the group').toBeTruthy();
  // Blank lines dropped rather than becoming empty chips.
  expect(state.card.sequence).toEqual(['M1', 'MURMURATE', 'R↑']);
  expect(state.card.damage).toBe('38-46');
  expect(state.card.hasContent, 'content is an array so the card can nest').toBe(true);
  expect(state.previewCards, 'the live preview shows it').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
