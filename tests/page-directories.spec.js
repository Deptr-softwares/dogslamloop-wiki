// Where a page lives and how it renders used to be the same decision:
// page_type picked the directory, so an "Others" or "Tools" page could not be
// created at all without inventing a render type for it. They are different
// questions - an Emotes page lives in others/ and renders exactly like a
// system page, which js/page_boot.js already treats as the default for
// anything that is not a character.
//
// Splitting them means no migration: site_pages.page_type keeps its CHECK
// constraint, and site_pages.url already stores the full path.
const { test, expect } = require('@playwright/test');
const { PAGE_DIRECTORIES } = require('../scripts/generate-pages.js');

test('the generator and the owner tools agree on which directories exist', async ({ page }) => {
  // Two independent lists that must match. They are in different languages
  // and different files, so nothing but a test can hold them together.
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  const fromOwner = await page.evaluate(() => Object.keys(window.PAGE_DIRECTORIES));

  expect(fromOwner.sort()).toEqual([...PAGE_DIRECTORIES].sort());
  expect(fromOwner).toContain('others');
  expect(fromOwner).toContain('tools');
});

test('derivePageIdentity puts a page in the folder it was given', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const urls = await page.evaluate(() => ({
    character: window.derivePageIdentity('Crow Charmer', 'character', 'characters').url,
    system: window.derivePageIdentity('M1 Trading', 'system', 'systems').url,
    other: window.derivePageIdentity('Emotes', 'system', 'others').url,
    tool: window.derivePageIdentity('ID Reader', 'system', 'tools').url,
  }));

  // Character folders stay Capitalised_like_this; everything else kebab-case,
  // matching the 22 URLs that already exist.
  expect(urls.character).toBe('characters/Crow_charmer/index.html');
  expect(urls.system).toBe('systems/m1-trading/index.html');
  expect(urls.other).toBe('others/emotes/index.html');
  expect(urls.tool).toBe('tools/id-reader/index.html');
});

test('omitting the folder falls back to the old page_type behaviour', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  // Every existing caller passed two arguments. They must keep working.
  const urls = await page.evaluate(() => ({
    character: window.derivePageIdentity('Sukuna', 'character').url,
    system: window.derivePageIdentity('HUD', 'system').url,
    bogus: window.derivePageIdentity('Thing', 'system', 'not-a-real-folder').url,
  }));

  expect(urls.character).toBe('characters/Sukuna/index.html');
  expect(urls.system).toBe('systems/hud/index.html');
  expect(urls.bogus, 'an unknown folder falls back rather than writing anywhere').toBe('systems/thing/index.html');
});

test('the folder list re-suits itself when the page type changes', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <input id="new-page-name">
      <select id="new-page-type">
        <option value="character">Character page</option>
        <option value="system">System / guide page</option>
      </select>
      <select id="new-page-directory"></select>
      <p id="new-page-preview"></p>
    `;
    populateDirectoryOptions();
    const initial = document.getElementById('new-page-directory').value;

    // Picking a system type should move off characters/...
    document.getElementById('new-page-type').value = 'system';
    populateDirectoryOptions();
    const afterSystem = document.getElementById('new-page-directory').value;

    // ...but a deliberate choice of others/ must survive a redundant refresh.
    document.getElementById('new-page-directory').value = 'others';
    populateDirectoryOptions();
    const afterExplicit = document.getElementById('new-page-directory').value;

    // Switching back to character has to abandon others/, which cannot hold one.
    document.getElementById('new-page-type').value = 'character';
    populateDirectoryOptions();
    const afterBackToCharacter = document.getElementById('new-page-directory').value;

    return { initial, afterSystem, afterExplicit, afterBackToCharacter };
  });

  expect(result.initial).toBe('characters');
  expect(result.afterSystem).toBe('systems');
  expect(result.afterExplicit, 'an explicit choice is not overwritten').toBe('others');
  expect(result.afterBackToCharacter, 'others/ cannot hold a character page').toBe('characters');
});

test('the create preview shows the real path, folder included', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const preview = await page.evaluate(() => {
    document.body.innerHTML = `
      <input id="new-page-name" value="Emotes">
      <select id="new-page-type"><option value="system" selected>system</option></select>
      <select id="new-page-directory"><option value="others" selected>others</option></select>
      <p id="new-page-preview"></p>
    `;
    updateNewPagePreview();
    return document.getElementById('new-page-preview').textContent;
  });

  expect(preview).toContain('others/emotes/index.html');
});
