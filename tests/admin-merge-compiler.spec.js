// Regression coverage for a real, historically-damaging bug in
// js/admin-merge-compiler.js's conflict detection (scanArray), documented
// in full in project memory (the "merge-compiler array-conflict" bug).
//
// The bug: scanArray compared each ticket's extras/matchups/counterplay
// array against live data BY RAW INDEX. If one pending ticket deletes an
// array item (shifting every later index down by one) while another ticket
// independently edits a different item, index-based comparison produces
// phantom conflicts mislabeled with the wrong item's identity - and picking
// a ticket's "version" for one of those phantom conflicts could silently
// overwrite (with `undefined`) a real, untouched item elsewhere in the
// array. This is the modern form of the "Smart Merge" bug the site owner
// described from the project's early history, where an accepted merge
// could delete unrelated content on the page.
//
// Fixed by matching array items by their real identity (title/opponent/
// topic - the same fields window.applyDeltaToData itself already keys off
// in site_utils.js) instead of position.
const { test, expect } = require('@playwright/test');

test('real bug fix: merge compiler detects array conflicts by identity, not position - a deletion in one ticket does not corrupt an unrelated item edited by another ticket', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    // admin.html's RBAC gate wiped document.body for this logged-out
    // visitor - reconstruct just the DOM openMergeCompiler actually reads.
    document.body.innerHTML = `
      <div id="compiler-modal-overlay" class="hidden">
        <h3>SMART COMPILER: <span id="compiler-char-name"></span></h3>
        <div id="compiler-modal-body"></div>
        <button id="btn-compiler-confirm"></button>
      </div>
    `;

    const liveDesc = {
      matchups: [
        { opponent: 'A', tier: 'even', content: ['A strategy'] },
        { opponent: 'B', tier: 'even', content: ['B strategy'] },
        { opponent: 'C', tier: 'even', content: ['C strategy'] },
      ]
    };
    const liveFrame = {};

    window.supabaseClient = {
      from(table) {
        if (table !== 'page_data') throw new Error('unexpected table: ' + table);
        return {
          select() { return this; },
          eq() { return this; },
          single: async () => ({ data: { desc_data: liveDesc, frame_data: liveFrame }, error: null }),
        };
      },
    };

    // Ticket 1: deletes the matchup vs "B" (a delta patch with a null payload).
    const ticket1 = {
      id: 'ticket-1', page_id: 'testchar', author_name: 'Alice', created_at: '2026-08-01T00:00:00Z',
      is_delta: true, target_scope: 'matchup', target_key: 'B', delta_payload: null,
      desc_data: {}, frame_data: {},
    };
    // Ticket 2: independently edits the matchup vs "C" - unrelated to ticket 1.
    const ticket2 = {
      id: 'ticket-2', page_id: 'testchar', author_name: 'Bob', created_at: '2026-08-02T00:00:00Z',
      is_delta: true, target_scope: 'matchup', target_key: 'C',
      delta_payload: { opponent: 'C', tier: 'even', content: ['C strategy EDITED'] },
      desc_data: {}, frame_data: {},
    };

    window.currentQueueData = [ticket1, ticket2];

    await window.openMergeCompiler('testchar');

    const cards = Array.from(document.querySelectorAll('.compiler-conflict-card')).map(card => {
      const select = card.querySelector('select');
      return {
        sectionId: select ? select.id.replace('compiler-sel-', '') : null,
        title: card.querySelector('.compiler-conflict-title')?.textContent || '',
        // Number of real choices excluding the always-present "[DISCARD] Keep current live data" option.
        ticketOptionCount: select ? select.options.length - 1 : 0,
      };
    });

    return { cards };
  });

  // Exactly two conflicts - one per actually-touched matchup. The old
  // index-based bug would produce extra phantom conflicts here (matchup C
  // shifted into B's old slot, plus a dangling comparison against nothing
  // at the array's old last index).
  expect(result.cards).toHaveLength(2);

  const bCard = result.cards.find(c => c.sectionId === 'matchups_B');
  const cCard = result.cards.find(c => c.sectionId === 'matchups_C');

  expect(bCard, 'conflict for the deleted matchup (B) should exist, correctly identified').toBeTruthy();
  expect(bCard.title).toContain('B');
  expect(bCard.ticketOptionCount).toBe(1);

  expect(cCard, 'conflict for the edited matchup (C) should exist, correctly identified').toBeTruthy();
  expect(cCard.title).toContain('C');
  expect(cCard.ticketOptionCount).toBe(1);
});
