// Picks an option the way a person does on the site's dropdown, which hides the real
// <select> (window.initializeMangaSelects, site_utils.js): opens its button and
// clicks the row. Playwright's selectOption needs the select visible, so it cannot.
//
// select: a Locator for the <select>; value: the option's value, as selectOption takes.
async function pickOption(select, value) {
  const index = await select.evaluate((s, v) => [...s.options].findIndex(o => o.value === v), value);
  if (index < 0) throw new Error(`pickOption: no option with the value "${value}"`);
  const wrapper = select.locator('xpath=following-sibling::div[contains(concat(" ", @class, " "), " manga-select-wrapper ")][1]');
  await wrapper.locator('.manga-select-trigger').click();
  await wrapper.locator(`.manga-option[data-index="${index}"]`).click();
}

module.exports = { pickOption };
