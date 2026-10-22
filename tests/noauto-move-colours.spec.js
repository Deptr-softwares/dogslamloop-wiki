// [noauto] stops move-name colouring in the Combos and Techs tabs too (owner's
// wishlist, 2026-10-18: "Make [noauto] works with move auto coloring in the
// Combos/Techs tab").
//
// It already stopped every other kind of auto-colouring. The move-name pass is
// the one that runs later, over the rendered text, where the [noauto] tag no
// longer exists, so it coloured protected words anyway. The protected text now
// comes back inside a marker span, and that pass skips what is inside it.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The frozen Crow Charmer row (see tests/input-slots.spec.js for why it is
// frozen). Circling is its Skill 2.
const CROW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'crow-charmer-page-data.json'), 'utf8'));

async function openCrowCharmer(page) {
  await page.route('**/rest/v1/page_data**', route => {
    if (!route.request().url().includes('page_id=eq.crow_charmer')) return route.continue();
    const one = /vnd.pgrst.object/.test(route.request().headers()['accept'] || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? CROW : [CROW]) });
  });
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

test('a move name inside [noauto] stays plain in the Combos tab; the same name outside is coloured', async ({ page }) => {
  await openCrowCharmer(page);

  const out = await page.evaluate(() => {
    window.renderCombosTab({
      comboGroups: [{ title: 'T', content: [
        { type: 'paragraph', content: 'Keep [noauto]Circling[/noauto] the target, then Circling is the follow-up.' },
      ] }],
    });
    window.applyInternalStyling();

    const para = [...document.querySelectorAll('#tab-combos .is-styled')]
      .find(el => el.textContent.includes('Keep Circling the target'));
    const coloured = [...para.querySelectorAll('.is-2')].map(s => s.textContent);
    const protectedText = para.querySelector('.sc-noauto');
    return {
      text: para.textContent,
      coloured,
      protectedText: protectedText && protectedText.textContent,
      protectedColoured: protectedText ? protectedText.querySelectorAll('[class*="is-"]').length : -1,
    };
  });

  expect(out.text, 'the words are all still there, tag gone').toBe('Keep Circling the target, then Circling is the follow-up.');
  expect(out.protectedText).toBe('Circling');
  expect(out.protectedColoured, 'nothing inside [noauto] is coloured').toBe(0);
  expect(out.coloured, 'the unprotected one still is').toEqual(['Circling']);
});
