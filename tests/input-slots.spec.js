// Colouring combo notation by input slot.
//
// JJS combos are written NAME-FIRST - "MURMURATE > R^ > AIR UPDRAFT", not
// "2 > R > 1" - so colouring a route means knowing which of the ten inputs
// each move NAME belongs to, per character.
//
// DERIVED, NOT AUTHORED. That mapping already exists in frame_data's `input`
// field; a hand-written map beside it would be a second copy of the same fact,
// and the two would drift the first time someone edited a move. Measured on
// the live roster: 519 moves, 76% resolve from `input` alone, 33 multi-key,
// 90 with no input at all. `desc_data.characterSettings` is the thin override
// for the last group and for community shorthand.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Both modules against one window, in the order every page loads them:
// input_slots.js reads the tab vocabulary for which categories hold moves,
// rather than keeping its own copy of that list.
const slots = (() => {
  const w = {};
  ['character_tabs.js', 'input_slots.js'].forEach(file => {
    new Function('window', fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'))(w);
  });
  return w;
})();

// Frame data in the shapes the live roster actually uses - three different
// input conventions, because all three are real.
const FRAME = {
  m1s: [
    { id: 'first-m1', name: 'First M1', input: 'M1' },
    // The uppercut is an M1, not a jump: Space is a MODIFIER here.
    { id: 'uppercut', name: 'Uppercut', input: 'Space + M1' },
  ],
  skills: [
    { id: 'a', name: 'Impetus Updraft', input: '1' },
    { id: 'b', name: 'Air Updraft', input: '1' },
    { id: 'c', name: 'Circling', input: '2' },
    // Vessel writes them this way.
    { id: 'd', name: 'Divergent Fist', input: '3 Key' },
    { id: 'e', name: 'Aerial Crushing Blow', input: 'Air + 2 Key' },
    // Star Rage's whole kit looks like this - the override's reason to exist.
    { id: 'f', name: 'Garuda Stab', input: '' },
  ],
  specials: [
    { id: 'g', name: 'Flock', input: 'Q' },
    { id: 'h', name: 'Combat Instinct', input: 'R Key' },
    // A move that leads into another: the FIRST key is the move's own.
    { id: 'i', name: 'Discard', input: 'R into Any 4 Keys' },
  ],
};

test('the ten slots are declared, and every one has a colour in CSS', () => {
  expect(slots.INPUT_SLOT_IDS).toEqual(['M1', '1', '2', '3', '4', 'R', 'Q', 'F', 'Space', 'Shift']);

  // The palette lives in CSS, the same way FRAME_COLORS does - CSS is this
  // site's single source of truth for colour, and the color-codes page reads
  // it. A slot declared here with no token there renders unstyled.
  const css = fs.readFileSync(path.join(ROOT, 'style', 'ColorCoding.css'), 'utf8');
  const missing = [];
  slots.INPUT_SLOTS.forEach(s => {
    const token = `--input-color-${s.id.toLowerCase()}`;
    if (!css.includes(token)) missing.push(token);
    if (!new RegExp(`\\.${s.cls}\\b`).test(css)) missing.push(`.${s.cls}`);
  });
  expect(missing).toEqual([]);

  // Every slot is outlined, always - owner, 2026-08-17. An outline's job is to
  // keep the text readable against whatever is behind it, and a light slot on
  // a light page is exactly as unreadable as the reverse.
  slots.INPUT_SLOTS.forEach(s => {
    expect(['light', 'dark'], `${s.id} needs an outline side`).toContain(s.outline);
  });
});

test('an input string resolves to one slot, modifiers aside', () => {
  const r = slots.resolveInputSlot;

  expect(r('1')).toBe('1');
  expect(r('2 Key')).toBe('2');
  expect(r('R Key')).toBe('R');
  expect(r('Q')).toBe('Q');

  // Space and Shift are slots in their own right AND modifiers. "Space + M1"
  // is the uppercut - an M1 - so the modifier drops out.
  expect(r('Space + M1'), 'the uppercut is an M1, not a jump').toBe('M1');
  expect(r('Air + 1 Key')).toBe('1');
  expect(r('Hold M1')).toBe('M1');
  // ...but Space alone is still Space.
  expect(r('Space')).toBe('Space');
  expect(r('Shift')).toBe('Shift');

  // A move that leads into another is named by the key that STARTS it.
  expect(r('R into Any 4 Keys')).toBe('R');
  expect(r('4 + 1 key')).toBe('4');

  // 90 moves on the live roster have no input at all. Those must resolve to
  // nothing rather than guess - a wrong colour is worse than none.
  expect(r('')).toBeNull();
  expect(r(null)).toBeNull();
  expect(r('Garuda Stab')).toBeNull();

  // Boundaries: "1" must not match inside "M1", "R" not inside "Release".
  expect(r('M1')).toBe('M1');
  expect(r('Release')).toBeNull();
});

test('the map derives from frame data without anyone authoring it', () => {
  const map = slots.deriveMoveSlots(FRAME);

  expect(map.get('first m1')).toBe('M1');
  expect(map.get('uppercut'), 'Space + M1 is an M1').toBe('M1');
  expect(map.get('impetus updraft')).toBe('1');
  expect(map.get('air updraft')).toBe('1');
  expect(map.get('circling')).toBe('2');
  expect(map.get('divergent fist')).toBe('3');
  expect(map.get('aerial crushing blow')).toBe('2');
  expect(map.get('flock')).toBe('Q');
  expect(map.get('combat instinct')).toBe('R');
  expect(map.get('discard')).toBe('R');

  // A blank input yields nothing rather than a guess.
  expect(map.has('garuda stab')).toBe(false);
});

test('characterSettings fills the gaps and names the shorthand', () => {
  const desc = {
    characterSettings: {
      // The 90 blank-input moves.
      slots: { 'Garuda Stab': '4' },
      // The one thing derivation genuinely cannot produce.
      aliases: { 'Garuda': 'Garuda Stab', 'Updraft': 'Impetus Updraft' },
    },
  };
  const map = slots.buildMoveSlotMap(FRAME, desc);

  expect(map.get('garuda stab'), 'an override fills a blank input').toBe('4');
  expect(map.get('garuda'), 'an alias inherits its target slot').toBe('4');
  // An alias may point at a DERIVED move, not just at another override.
  expect(map.get('updraft')).toBe('1');

  // Derivation still wins where it works - an override is a supplement, not a
  // replacement.
  expect(map.get('circling')).toBe('2');

  // An unknown slot id is ignored rather than written through.
  const bad = slots.buildMoveSlotMap(FRAME, { characterSettings: { slots: { 'X': 'Z' } } });
  expect(bad.has('x')).toBe(false);
});

test('a real character page colours its own route', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Crow Charmer, because its live frame data uses three input conventions.
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const chips = await page.evaluate(() => {
    window.renderCombosTab({
      comboGroups: [{
        title: 'True Combos',
        content: [{
          type: 'theorybox', title: 'Test',
          sequence: ['M1', 'Impetus Updraft', 'Circling', 'Flock', 'R', '(X3)'],
        }],
      }],
    });
    window.applyInternalStyling();
    return [...document.querySelectorAll('#tab-combos .combo-node')].map(n => ({
      text: n.textContent,
      slot: [...n.classList].find(c => c.startsWith('is-') && c !== 'is-slotted') || null,
    }));
  });

  expect(chips.find(c => c.text === 'M1').slot).toBe('is-m1');
  expect(chips.find(c => c.text === 'Impetus Updraft').slot, 'derived from input "1"').toBe('is-1');
  expect(chips.find(c => c.text === 'Circling').slot).toBe('is-2');
  expect(chips.find(c => c.text === 'Flock').slot, 'a special on Q').toBe('is-q');
  expect(chips.find(c => c.text === 'R').slot, 'a bare key inside a chip is that slot').toBe('is-r');
  // Contributors write things like "(X3)" and "(PICK THE ONE YOU USED)". Those
  // are not moves, and guessing a colour for them would be worse than none.
  expect(chips.find(c => c.text === '(X3)').slot, 'unknown text stays uncoloured').toBeNull();

  expect(errors).toEqual([]);
});

test('slot colouring stays inside combo contexts', async ({ page }) => {
  // Owner, 2026-08-17: this belongs in combo blocks and the Combos tab, and
  // nowhere else. Site-wide it would tint the frame-data pages, where every
  // move name appears dozens of times, and turn a reference table into a
  // rainbow.
  //
  // Two separate rules, and both matter:
  //   a bare KEY only counts inside a chip - "1" and "2" are frame counts and
  //     damage figures in prose far more often than inputs;
  //   a move NAME only counts inside the Combos tab.
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const say = (parentId, text) => {
      const p = document.createElement('p');
      p.className = 'strategy-paragraph';
      p.textContent = text;
      document.getElementById(parentId).appendChild(p);
      return p;
    };

    window.renderCombosTab({
      comboGroups: [{ title: 'T', content: [{ type: 'paragraph', content: 'Circling is the follow-up.' }] }],
    });

    const outside = say('tab-overview', 'It does 2 damage over 1 second, and Circling is strong.');
    window.applyInternalStyling();

    return {
      // Nothing outside the Combos tab is touched - not the numbers, not the
      // move name.
      outside: outside.querySelectorAll('[class*="is-"]').length,
      // Inside it, the move name is coloured.
      inside: document.querySelectorAll('#tab-combos .is-2').length,
    };
  });

  expect(result.outside, 'prose outside the Combos tab is left alone').toBe(0);
  expect(result.inside, 'a move name inside the Combos tab is coloured').toBeGreaterThan(0);
});

test('a step keeps its colour when the contributor adds a note to it', async ({ page }) => {
  // "MURMURATE(MISS)" and "BIRD CONTROL(S)" are how the owner actually writes
  // them. The whole-chip match fails on those, so the name inside has to be
  // found instead - and a plain "MURMURATE" must still colour, which it did
  // not: the styling pass runs before frame data lands, and marking every chip
  // processed on that first pass left them flagged with no colour forever.
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const chips = await page.evaluate(() => {
    window.renderCombosTab({
      comboGroups: [{
        title: 'T',
        content: [{
          type: 'theorybox', title: 'Test',
          // R^ is how the owner writes a directional input, constantly.
          sequence: ['Murmurate', 'R↑', 'Air Updraft', 'Bird Control(s)', 'M1', 'R'],
        }],
      }],
    });
    window.applyInternalStyling();
    return [...document.querySelectorAll('#tab-combos .combo-node')].map(n => ({
      text: n.textContent,
      whole: [...n.classList].find(c => c.startsWith('is-') && c !== 'is-slotted') || null,
      inner: [...n.querySelectorAll('[class*="is-"]')].map(e => e.className.match(/is-[\w]+/)[0]),
    }));
  });

  const at = (t) => chips.find(c => c.text === t);
  expect(at('Murmurate').whole, 'a bare move name colours the whole chip').toBeTruthy();
  expect(at('Air Updraft').whole).toBe('is-1');
  // A trailing direction is part of the input, not a separate step.
  expect(at('R↑').whole, 'R↑ is still R').toBe('is-r');
  // The two the owner asked to be certain of, because contributors swap them.
  expect(at('M1').whole).toBe('is-m1');
  expect(at('R').whole).toBe('is-r');
  // A note appended to a step leaves the NAME coloured inside it.
  expect(at('Bird Control(s)').inner.length, 'the name inside is found').toBeGreaterThan(0);
});

test('the same name can be a different slot in a different state', async ({ page }) => {
  // A character's ultimate state has different skills in the same slots, so
  // the map has to be per-state. Derivation handles this for free; a flat
  // hand-authored map could not.
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(() => {
    const base = { skills: [{ id: 'x', name: 'Shared Name', input: '1' }] };
    const ult = { skills: [{ id: 'x', name: 'Shared Name', input: '3' }] };
    return {
      base: window.deriveMoveSlots(base).get('shared name'),
      ult: window.deriveMoveSlots(ult).get('shared name'),
    };
  });

  expect(result.base).toBe('1');
  expect(result.ult).toBe('3');
});
