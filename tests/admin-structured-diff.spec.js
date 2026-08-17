// Coverage for Phase 2 of the reviewer-workflow redesign: queue triage
// signals (target-key + size badges) and structured-data diffing (frame
// data/metadata used to render as two raw JSON blobs, now a real field-
// level diff matching the visual language of the existing prose LCS diff).
const { test, expect } = require('@playwright/test');

test('renderStructuredDiff: highlights changed/added/removed fields, skips unchanged ones', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const oldFrame = { startup: 5, active: 3, recovery: 12, onBlock: '-2', unchangedField: 'same' };
    const newFrame = { startup: 6, active: 3, recovery: 12, onHit: '+4', unchangedField: 'same' };

    const html = window.renderStructuredDiff(oldFrame, newFrame);

    // Field names render as WORDS since v0.15 item 6 ("onBlock" -> "On Block"),
    // so these match the rendered label. Two of these assertions previously
    // checked the raw schema key: after the rename they would have passed
    // because the key was spelled differently, not because the field was
    // skipped - vacuously true, and no longer testing anything.
    return {
      html,
      changedFieldShowsOldAndNew: html.includes('<del class="diff-del">5</del>') && html.includes('<ins class="diff-add">6</ins>'),
      unchangedFieldNotRendered: !html.includes('Unchanged Field'),
      unchangedActiveFieldNotRendered: !html.includes('>Active:<'),
      removedFieldShowsAsDeletion: html.includes('<del class="diff-del">-2</del>') && html.includes('On Block'),
      addedFieldShowsAsAddition: html.includes('<ins class="diff-add">+4</ins>') && html.includes('On Hit'),
    };
  });

  expect(result.changedFieldShowsOldAndNew).toBe(true);
  expect(result.unchangedFieldNotRendered).toBe(true);
  expect(result.unchangedActiveFieldNotRendered).toBe(true);
  expect(result.removedFieldShowsAsDeletion).toBe(true);
  expect(result.addedFieldShowsAsAddition).toBe(true);
});

test('renderStructuredDiff: escapes field values (no raw HTML injection from submitted content)', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const html = window.renderStructuredDiff({ note: 'safe' }, { note: '<img src=x onerror=alert(1)>' });
    return { html, containsRawImgTag: html.includes('<img src=x') };
  });

  expect(result.containsRawImgTag).toBe(false);
  expect(result.html).toContain('&lt;img');
});

test('renderStructuredDiff: recurses into nested plain objects', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const html = window.renderStructuredDiff(
      { position: { x: 1, y: 2 } },
      { position: { x: 1, y: 5 } }
    );
    return {
      html,
      nestedWrapperPresent: html.includes('diff-field-nested'),
      changedNestedFieldShown: html.includes('<del class="diff-del">2</del>') && html.includes('<ins class="diff-add">5</ins>'),
      unchangedNestedFieldSkipped: !html.includes('>x:<'),
    };
  });

  expect(result.nestedWrapperPresent).toBe(true);
  expect(result.changedNestedFieldShown).toBe(true);
  expect(result.unchangedNestedFieldSkipped).toBe(true);
});

test('renderStructuredDiff: whole-object deletion (newData null) shows every field as removed', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const html = window.renderStructuredDiff({ startup: 5, active: 3 }, null);
    return {
      startupRemoved: html.includes('<del class="diff-del">5</del>'),
      activeRemoved: html.includes('<del class="diff-del">3</del>'),
      noAdditions: !html.includes('diff-add'),
    };
  });

  expect(result.startupRemoved).toBe(true);
  expect(result.activeRemoved).toBe(true);
  expect(result.noAdditions).toBe(true);
});

test('admin queue card: shows the actual target key and a size badge, not just the scope', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="queue-container"></div>';

    const revisions = [
      {
        id: 'rev-1', page_id: 'boomcat', author_name: 'Alice', status: 'pending',
        created_at: '2026-08-01T00:00:00Z', is_delta: true, target_scope: 'matchup', target_key: 'vs Crow Charmer',
        delta_payload: { content: 'A fairly short strategy note.' },
        supporters: [], ticket_chat: [],
      },
      {
        id: 'rev-2', page_id: 'boomcat', author_name: 'Bob', status: 'pending',
        created_at: '2026-08-01T00:00:00Z', is_delta: true, target_scope: 'move', target_key: 'm1s::5H',
        delta_payload: { content: 'Also short.' },
        supporters: [], ticket_chat: [],
      },
    ];

    window.supabaseClient = {
      from(table) {
        return { select() { return this; }, in() { return this; }, order: async () => ({ data: revisions, error: null }) };
      },
    };

    await window.loadQueue();

    const html = document.getElementById('queue-container').innerHTML;
    return {
      matchupTargetKeyShown: html.includes('vs Crow Charmer'),
      moveTargetFormatted: html.includes('M1S: 5H'),
      hasSizeBadge: /badge-size-[sml]/.test(html),
    };
  });

  expect(result.matchupTargetKeyShown).toBe(true);
  expect(result.moveTargetFormatted).toBe(true);
  expect(result.hasSizeBadge).toBe(true);
});
