// v0.17 F5: filtering the revision queue.
//
// The owner's source list said the queue "is already built to filter character
// submission". It was not - js/admin-queue.js contained the string "filter"
// zero times across 270 lines. This is that filtering, patterned on
// js/admin-media-queue.js, which had two working dropdowns all along.
//
// It matters more with experts than it did without them. An expert receives
// only their own pages, because the "Staff can view queue" policy filters the
// rows before this client sees them - so the page dropdown is built from what
// came back rather than from navigation.json, and a reviewer with the whole
// queue gets a real filter instead of a wall.
//
// The most important test here is the MERGE one. Everything else is visibly
// wrong when it breaks; a merge button that counts the filtered rows promises
// to merge two tickets and then merges three.
const { test, expect } = require('@playwright/test');

const rev = (over = {}) => ({
    id: over.id || 'r1',
    page_id: 'boomcat',
    status: 'pending',
    author_name: 'contributor',
    author_id: 'u1',
    is_delta: true,
    delta_payload: [{ scope: 'move' }],
    target_scope: 'move',
    target_key: 'normals::5M',
    supporters: [], opposers: [], ticket_chat: [],
    created_at: '2026-09-01T10:00:00Z',
    ...over,
});

// The real renderQueue, against the real admin.html so every helper it reaches
// for (escapeHtml, unwrapModeDelta, timeSince) is the shipped one.
async function render(page, rows, { pageFilter = 'all', statusFilter = 'all' } = {}) {
    return page.evaluate(({ rows, pageFilter, statusFilter }) => {
        document.body.innerHTML = `
            <select id="queue-filter-page"><option value="all">All pages</option></select>
            <select id="queue-filter-status"><option value="all">Pending and tickets</option></select>
            <div id="queue-container"></div>`;
        window.currentQueueData = rows;
        populateQueuePageFilter(rows);
        document.getElementById('queue-filter-page').value = pageFilter;
        // The status options are fixed markup, so they have to exist to be set.
        const st = document.getElementById('queue-filter-status');
        ['pending', 'ticket_open'].forEach(v => {
            const o = document.createElement('option'); o.value = v; st.appendChild(o);
        });
        st.value = statusFilter;

        renderQueue();
        const container = document.getElementById('queue-container');
        return {
            html: container.innerHTML,
            groups: [...container.querySelectorAll('.admin-queue-group-title')].map(h => h.textContent),
            cards: container.querySelectorAll('.update-log-item').length,
            summary: (container.querySelector('.queue-summary') || {}).textContent || '',
            mergeButtons: [...container.querySelectorAll('.admin-merge-btn')].map(b => b.textContent.trim()),
            pageOptions: [...document.querySelectorAll('#queue-filter-page option')].map(o => o.value),
        };
    }, { rows, pageFilter, statusFilter });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
});

test('with no filter, everything waiting is drawn', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', page_id: 'boomcat' }),
        rev({ id: 'b', page_id: 'sukuna' }),
    ]);
    expect(out.cards).toBe(2);
    expect(out.groups.length).toBe(2);
    expect(out.summary).toBe('2 waiting');
});

test('filtering by page shows only that page', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', page_id: 'boomcat' }),
        rev({ id: 'b', page_id: 'sukuna' }),
        rev({ id: 'c', page_id: 'boomcat' }),
    ], { pageFilter: 'boomcat' });

    expect(out.cards).toBe(2);
    expect(out.groups).toEqual(['boomcat']);
    // The count says what was hidden, so a short queue does not read as a bug.
    expect(out.summary).toBe('2 of 3 waiting');
});

test('filtering by status shows only that status', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', status: 'pending' }),
        rev({ id: 'b', status: 'ticket_open' }),
    ], { statusFilter: 'ticket_open' });

    expect(out.cards).toBe(1);
    expect(out.html).toContain('TICKET OPEN');
    expect(out.summary).toBe('1 of 2 waiting');
});

test('the two filters intersect rather than replace each other', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', page_id: 'boomcat', status: 'pending' }),
        rev({ id: 'b', page_id: 'boomcat', status: 'ticket_open' }),
        rev({ id: 'c', page_id: 'sukuna', status: 'ticket_open' }),
    ], { pageFilter: 'boomcat', statusFilter: 'ticket_open' });

    expect(out.cards).toBe(1);
    expect(out.groups).toEqual(['boomcat']);
});

// --- THE ONE THAT IS NOT VISIBLY WRONG ---

test('MERGE counts every ticket on the page, not the filtered ones', async ({ page }) => {
    // openMergeCompiler loads all of a page's tickets itself. A count taken
    // from the filtered list would offer "MERGE TICKETS (2)" and then merge
    // three - the reviewer would not find out until after.
    const out = await render(page, [
        rev({ id: 'a', page_id: 'boomcat', status: 'pending' }),
        rev({ id: 'b', page_id: 'boomcat', status: 'pending' }),
        rev({ id: 'c', page_id: 'boomcat', status: 'ticket_open' }),
    ], { statusFilter: 'pending' });

    expect(out.cards, 'two shown').toBe(2);
    expect(out.mergeButtons.length).toBe(1);
    expect(out.mergeButtons[0], 'but three would be merged').toContain('(3)');
});

test('a page with one ticket offers no merge, filtered or not', async ({ page }) => {
    const out = await render(page, [rev({ id: 'a', page_id: 'boomcat' })]);
    expect(out.mergeButtons).toEqual([]);
});

// --- THE EXPERT CASE ---

test('the page dropdown lists what came back, not the whole roster', async ({ page }) => {
    // An expert of one character receives one page. Offering forty would be
    // offering thirty-nine selections that can only ever produce an empty
    // queue, and would also tell them which pages exist that they cannot see.
    const out = await render(page, [
        rev({ id: 'a', page_id: 'boomcat' }),
        rev({ id: 'b', page_id: 'boomcat' }),
    ]);
    expect(out.pageOptions).toEqual(['all', 'boomcat']);
});

test('the dropdown de-duplicates and sorts', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', page_id: 'sukuna' }),
        rev({ id: 'b', page_id: 'boomcat' }),
        rev({ id: 'c', page_id: 'sukuna' }),
    ]);
    expect(out.pageOptions).toEqual(['all', 'boomcat', 'sukuna']);
});

test('a refresh keeps the reviewer where they were', async ({ page }) => {
    // Reviewing a page means loading, filtering, acting, refreshing, repeating.
    // Losing the filter on every refresh would make it useless for the job it
    // exists to do.
    const kept = await page.evaluate(() => {
        document.body.innerHTML = `
            <select id="queue-filter-page"><option value="all">All pages</option></select>
            <div id="queue-container"></div>`;
        const rows = [{ page_id: 'boomcat' }, { page_id: 'sukuna' }];
        populateQueuePageFilter(rows);
        document.getElementById('queue-filter-page').value = 'sukuna';
        populateQueuePageFilter(rows);                       // the refresh
        return document.getElementById('queue-filter-page').value;
    });
    expect(kept).toBe('sukuna');
});

test('a filter pointing at an emptied page falls back to all', async ({ page }) => {
    const after = await page.evaluate(() => {
        document.body.innerHTML = `
            <select id="queue-filter-page"><option value="all">All pages</option></select>
            <div id="queue-container"></div>`;
        populateQueuePageFilter([{ page_id: 'boomcat' }, { page_id: 'sukuna' }]);
        document.getElementById('queue-filter-page').value = 'sukuna';
        populateQueuePageFilter([{ page_id: 'boomcat' }]);   // sukuna cleared
        return document.getElementById('queue-filter-page').value;
    });
    expect(after, 'not left pointing at a page that is gone').toBe('all');
});

// --- THE TWO EMPTY STATES ---

test('an empty queue and an empty filter say different things', async ({ page }) => {
    const nothingWaiting = await render(page, []);
    expect(nothingWaiting.html).toContain('No pending revisions or open tickets');

    // Reached through the STATUS filter, not the page one. The first version of
    // this test asked for page 'sukuna' when only 'boomcat' had rows - and a
    // <select> ignores a value with no matching <option>, so the filter stayed
    // on 'all' and the assertion was measuring nothing. It is also not a state
    // a user can reach: populateQueuePageFilter only ever lists pages that have
    // rows. This combination is reachable and is the real case.
    const nothingMatches = await render(page,
        [rev({ page_id: 'boomcat', status: 'pending' })],
        { pageFilter: 'boomcat', statusFilter: 'ticket_open' });

    expect(nothingMatches.cards).toBe(0);
    expect(nothingMatches.html).toContain('Nothing matches this filter');
    // They send a reviewer to different places, so they must not be the same
    // sentence.
    expect(nothingMatches.html).not.toContain('No pending revisions');
});

// --- THE WIRING ---

test('admin.html carries both filters and they are bound', async ({ page }) => {
    // A filter that renders and is not wired looks exactly like a working one
    // until somebody uses it.
    //
    // Read from the SERVED markup rather than the DOM. admin.html's RBAC gate
    // replaces the page for an unauthenticated visitor, and these tests drive
    // renderQueue directly rather than signing in - so a DOM query here finds
    // nothing and would fail for a reason that has nothing to do with filters.
    const { html, js } = await page.evaluate(async () => ({
        html: await (await fetch('/admin.html')).text(),
        js: await (await fetch('/js/admin-queue.js')).text(),
    }));

    expect(html).toContain('id="queue-filter-page"');
    expect(html).toContain('id="queue-filter-status"');

    // The media queue's binding carries a note that initializeMangaSelects
    // replaces these with a custom dropdown that only ever dispatches `change`.
    // Listening for `input` would be a filter that silently does nothing.
    expect(js).toMatch(/addEventListener\('change', renderQueue\)/);
    expect(js, 'not input - the custom dropdown never fires it')
        .not.toMatch(/addEventListener\('input', renderQueue\)/);

    // And the status options are the ones the queue actually holds: loadQueue
    // fetches exactly these two statuses, so a third option would filter to a
    // permanently empty list.
    const block = html.slice(html.indexOf('id="queue-filter-status"'));
    const values = [...block.slice(0, block.indexOf('</select>'))
        .matchAll(/value="([a-z_]+)"/g)].map(m => m[1]);
    expect(values).toEqual(['all', 'pending', 'ticket_open']);
    expect(js).toMatch(/\.in\('status', \['pending', 'ticket_open'\]\)/);
});
