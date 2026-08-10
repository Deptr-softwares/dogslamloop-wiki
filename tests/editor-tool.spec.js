// The tool-page editor.
//
// js/tool_page.js shipped a renderer that reads desc_data.tool and nothing
// ever wrote it, so a tool page could exist but never be pointed at anything.
//
// The claim worth protecting is the split: the config (where the tool lives,
// whether it embeds) and the prose (intro, notes) are separate scopes, because
// they belong to different people. A contributor fixing a typo in the intro
// must not be able to carry a change to the tool's URL along with it, and a
// reviewer approving one must not silently apply the other.
const { test, expect } = require('@playwright/test');

async function openToolEditor(page, desc = {}) {
  await page.goto('/edit.html?page=id-reader&type=tool', { waitUntil: 'networkidle' });
  await page.evaluate((desc) => {
    window.currentEditorPageType = 'tool';
    window.currentEditorCharId = 'id-reader';
    window.currentEditorTabId = 'overview';
    window.currentToolSection = 'intro';
    window.currentEditorDescData = desc;
    window.originalCloudDescData = JSON.parse(JSON.stringify(desc));
    initFullTabEditor('id-reader', 'overview', window.currentEditorDescData, {});
  }, desc);
}

test('a tool page gets its own setup form, not the character tab strip', async ({ page }) => {
  await openToolEditor(page, {});

  await expect(page.locator('#tool-url')).toBeVisible();
  await expect(page.locator('#editor-tab-nav')).toBeHidden();
});

test('the config form writes what the renderer reads', async ({ page }) => {
  await openToolEditor(page, {});

  await page.locator('#tool-url').fill('https://tools.example.test/id-reader');
  await page.locator('#tool-launch-label').fill('Open the ID Reader');
  await page.locator('#tool-embed').check();
  await page.locator('#tool-height').fill('900');

  const config = await page.evaluate(() => window.currentEditorDescData.tool);
  expect(config).toEqual({
    url: 'https://tools.example.test/id-reader',
    launchLabel: 'Open the ID Reader',
    embed: true,
    height: 900,
  });
});

test('the live preview shows the tool as configured, not as saved', async ({ page }) => {
  await openToolEditor(page, {});

  await page.locator('#tool-url').fill('https://tools.example.test/id-reader');
  await page.locator('#tool-launch-label').fill('Launch it');

  const launch = page.locator('.live-preview-pane .tool-launch-btn');
  await expect(launch).toHaveAttribute('href', 'https://tools.example.test/id-reader');
  await expect(launch).toHaveText('Launch it');

  // Embedding is opt-in, so nothing is framed until it is asked for.
  await expect(page.locator('.live-preview-pane .tool-embed')).toHaveCount(0);
  await page.locator('#tool-embed').check();
  await expect(page.locator('.live-preview-pane .tool-embed')).toHaveCount(1);
});

test('re-rendering the preview replaces the shell rather than stacking another', async ({ page }) => {
  // The editor re-renders on every keystroke, so this is the difference
  // between a preview and an ever-growing pile of previews.
  await openToolEditor(page, {});

  await page.locator('#tool-url').fill('https://tools.example.test/a');
  await page.locator('#tool-url').fill('https://tools.example.test/b');
  await page.locator('#tool-launch-label').fill('Go');

  await expect(page.locator('.live-preview-pane .tool-shell')).toHaveCount(1);
});

test('intro and notes are separate block sections behind one buffer', async ({ page }) => {
  await openToolEditor(page, {
    intro: [{ type: 'paragraph', content: 'What this tool is for.' }],
    notes: [{ type: 'paragraph', content: 'Known limitations.' }],
  });

  // The section switch has to flush the buffer, or whatever is being typed
  // lands in the section being switched to.
  const seen = await page.evaluate(async () => {
    const onIntro = JSON.parse(JSON.stringify(currentStrategyBlocks));
    await window.switchToolSection('notes');
    const onNotes = JSON.parse(JSON.stringify(currentStrategyBlocks));
    return { onIntro, onNotes };
  });

  expect(seen.onIntro).toEqual([{ type: 'paragraph', content: 'What this tool is for.' }]);
  expect(seen.onNotes).toEqual([{ type: 'paragraph', content: 'Known limitations.' }]);

  // And back, with the intro intact rather than overwritten by the notes.
  const backToIntro = await page.evaluate(async () => {
    await window.switchToolSection('intro');
    return window.currentEditorDescData.intro;
  });
  expect(backToIntro).toEqual([{ type: 'paragraph', content: 'What this tool is for.' }]);
});

test('config and prose ship as separate deltas', async ({ page }) => {
  await openToolEditor(page, { intro: [{ type: 'paragraph', content: 'Original.' }] });

  const deltas = await page.evaluate(() => {
    const cloud = JSON.parse(JSON.stringify(window.currentEditorDescData));
    const local = JSON.parse(JSON.stringify(cloud));
    local.tool = { url: 'https://tools.example.test/x', embed: false };
    local.intro = [{ type: 'paragraph', content: 'Rewritten.' }];
    local.notes = [{ type: 'paragraph', content: 'Added.' }];
    return window.buildToolDeltas(local, cloud);
  });

  expect(deltas.map(d => d.scope).sort()).toEqual(['intro', 'notes', 'tool_config']);
});

test('an unchanged section submits nothing at all', async ({ page }) => {
  await openToolEditor(page, {
    tool: { url: 'https://tools.example.test/x' },
    intro: [{ type: 'paragraph', content: 'Same.' }],
  });

  const deltas = await page.evaluate(() => {
    const cloud = JSON.parse(JSON.stringify(window.currentEditorDescData));
    const local = JSON.parse(JSON.stringify(cloud));
    local.notes = [{ type: 'paragraph', content: 'Only this is new.' }];
    return window.buildToolDeltas(local, cloud);
  });

  // Only the notes. A prose edit that also re-submitted the config would let a
  // reviewer approve a URL change they never looked at.
  expect(deltas).toHaveLength(1);
  expect(deltas[0].scope).toBe('notes');
});

test('each delta lands in its own key when applied', async ({ page }) => {
  await openToolEditor(page, {});

  const applied = await page.evaluate(() => {
    const live = { tool: { url: 'https://old.example.test' }, intro: [{ type: 'paragraph', content: 'Old intro.' }] };
    let out = { newDesc: live, newFrame: {} };

    const deltas = [
      { scope: 'tool_config', key: 'full', payload: { url: 'https://new.example.test', embed: true } },
      { scope: 'notes', key: 'full', payload: [{ type: 'paragraph', content: 'New notes.' }] },
    ];
    deltas.forEach(d => {
      out = window.applyDeltaToData(out.newDesc, out.newFrame, d.scope, d.key, d.payload);
    });
    return out.newDesc;
  });

  expect(applied.tool).toEqual({ url: 'https://new.example.test', embed: true });
  expect(applied.notes).toEqual([{ type: 'paragraph', content: 'New notes.' }]);
  // Untouched by either delta.
  expect(applied.intro).toEqual([{ type: 'paragraph', content: 'Old intro.' }]);
});

test('the older gallery_intro scope still applies', async ({ page }) => {
  // Tickets carrying it may already be sitting in the queue.
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const applied = await page.evaluate(() =>
    window.applyDeltaToData({}, {}, 'gallery_intro', 'full', [{ type: 'paragraph', content: 'Legacy.' }]).newDesc);

  expect(applied.intro).toEqual([{ type: 'paragraph', content: 'Legacy.' }]);
});

test('a tool with its own renderer says the link settings do not apply to it', async ({ page }) => {
  await page.goto('/edit.html?page=certified-tierlist&type=tool', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.registerWikiTool('certified-tierlist', (mount) => { mount.textContent = 'built-in'; });
    window.currentEditorPageType = 'tool';
    window.currentEditorCharId = 'certified-tierlist';
    window.currentToolSection = 'intro';
    window.currentEditorDescData = {};
    initFullTabEditor('certified-tierlist', 'overview', window.currentEditorDescData, {});
  });

  await expect(page.locator('.block-type-badge', { hasText: 'TOOL OPTIONS' })).toBeVisible();
  await expect(page.locator('#interactive-builder')).toContainText('its own built-in tool');
});
