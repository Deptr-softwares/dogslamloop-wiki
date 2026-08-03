// Coverage for Phase 5 (the last one) of the reviewer-workflow redesign:
// browsing and restoring past live versions of a page from page_history,
// which previously had no UI anywhere - undoing a bad live edit meant
// manually re-editing the page by hand through the full review process
// again, despite the data to do it properly already existing.
const { test, expect } = require('@playwright/test');

test('togglePageHistoryView: lists page_history rows for the active page, newest first', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        document.body.innerHTML = '';
        document.body.innerHTML = `<div class="main-content-area"></div>`;
        window.activePreviewCharId = 'boomcat';

        const rows = [
            { id: 'h1', page_id: 'boomcat', desc_data: {}, frame_data: {}, updated_by_user: 'Alice', version_timestamp: '2026-08-01T00:00:00Z', page_type: 'character' },
            { id: 'h2', page_id: 'boomcat', desc_data: {}, frame_data: {}, updated_by_user: 'System Trigger', version_timestamp: '2026-07-01T00:00:00Z', page_type: 'character' },
        ];

        let capturedEq = null;
        window.supabaseClient = {
            from(table) {
                if (table !== 'page_history') throw new Error('unexpected table: ' + table);
                return {
                    select() { return this; },
                    eq(col, val) { capturedEq = [col, val]; return this; },
                    order: async () => ({ data: rows, error: null }),
                };
            },
        };

        await window.togglePageHistoryView();

        const container = document.getElementById('page-history-container');
        return {
            capturedEq,
            containerVisible: container && !container.classList.contains('hidden'),
            html: container ? container.innerHTML : '',
        };
    });

    expect(result.capturedEq).toEqual(['page_id', 'boomcat']);
    expect(result.containerVisible).toBe(true);
    expect(result.html).toContain('Alice');
    expect(result.html).toContain('System Trigger');
});

test('togglePageHistoryView: toggling again hides it and returns to the pending view', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        document.body.innerHTML = `
            <div class="main-content-area">
                <button id="btn-view-pending" class="btn-sys btn-sys-regular version-toggle-btn pending">PENDING SUBMISSION</button>
                <button id="btn-view-live" class="btn-sys btn-sys-regular version-toggle-btn live">LIVE VERSION</button>
                <button id="btn-view-diff" class="btn-sys btn-sys-regular version-toggle-btn diff">DIFF VIEW</button>
                <button id="btn-view-history" class="btn-sys btn-sys-regular version-toggle-btn history">PAGE HISTORY</button>
            </div>
        `;
        window.activePreviewCharId = 'boomcat';
        window.currentPendingDescData = {};
        window.currentPendingFrameData = {};

        window.supabaseClient = {
            from() {
                return { select() { return this; }, eq() { return this; }, order: async () => ({ data: [], error: null }) };
            },
        };

        await window.togglePageHistoryView(); // show
        const shownClass = document.getElementById('page-history-container').classList.contains('hidden');

        await window.togglePageHistoryView(); // hide again, falls back to switchVersionView('pending')
        const hiddenAfterToggle = document.getElementById('page-history-container').classList.contains('hidden');
        const pendingBtnActive = document.getElementById('btn-view-pending').classList.contains('btn-sys-blue');

        return { shownClass, hiddenAfterToggle, pendingBtnActive };
    });

    expect(result.shownClass).toBe(false);
    expect(result.hiddenAfterToggle).toBe(true);
    expect(result.pendingBtnActive).toBe(true);
});

test('switchVersionView: switching to pending/live/diff hides the page-history pane and resets its button', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        document.body.innerHTML = `
            <div class="main-content-area">
                <div id="tab-overview" class="tab-content"></div>
                <div id="page-history-container" class="tab-content"></div>
                <button id="btn-view-pending" class="btn-sys btn-sys-blue version-toggle-btn pending">PENDING SUBMISSION</button>
                <button id="btn-view-live" class="btn-sys btn-sys-regular version-toggle-btn live">LIVE VERSION</button>
                <button id="btn-view-diff" class="btn-sys btn-sys-regular version-toggle-btn diff">DIFF VIEW</button>
                <button id="btn-view-history" class="btn-sys btn-sys-yellow version-toggle-btn history">PAGE HISTORY</button>
            </div>
        `;
        window.activePreviewCharId = 'boomcat';
        window.currentPendingDescData = {};
        window.currentPendingFrameData = {};

        await window.switchVersionView('pending');

        return {
            historyContainerHidden: document.getElementById('page-history-container').classList.contains('hidden'),
            historyBtnReset: !document.getElementById('btn-view-history').classList.contains('btn-sys-yellow'),
        };
    });

    expect(result.historyContainerHidden).toBe(true);
    expect(result.historyBtnReset).toBe(true);
});

test('togglePageHistoryDiff: compares a history row against current live data using renderStructuredDiff', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(() => {
        document.body.innerHTML = `<div id="ph-diff-0" class="page-history-diff hidden"></div>`;
        window.currentLiveDescData = { profile: { archetype: 'Zoner' } };
        window.currentLiveFrameData = {};

        const row = { desc_data: { profile: { archetype: 'Rushdown' } }, frame_data: {} };
        window.togglePageHistoryDiff(0, row);

        const diffEl = document.getElementById('ph-diff-0');
        return {
            visibleAfterFirstClick: !diffEl.classList.contains('hidden'),
            html: diffEl.innerHTML,
        };
    });

    expect(result.visibleAfterFirstClick).toBe(true);
    expect(result.html).toContain('<del class="diff-del">Rushdown</del>');
    expect(result.html).toContain('<ins class="diff-add">Zoner</ins>');
});

test('restorePageHistoryVersion: upserts page_data with the selected version\'s content and reloads the list', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        document.body.innerHTML = `<div id="page-history-container" class="tab-content"></div>`;
        window.currentUsername = 'TestReviewer';

        let capturedUpsert = null;
        let reloadedListEq = null;

        window.supabaseClient = {
            from(table) {
                if (table === 'page_data') {
                    return {
                        upsert(payload, options) { capturedUpsert = payload[0]; return { error: null }; },
                        select() { return this; },
                        eq() { return this; },
                        single: async () => ({ data: { desc_data: { restored: true }, frame_data: {} }, error: null }),
                    };
                }
                if (table === 'page_history') {
                    return {
                        select() { return this; },
                        eq(col, val) { reloadedListEq = [col, val]; return this; },
                        order: async () => ({ data: [], error: null }),
                    };
                }
                throw new Error('unexpected table: ' + table);
            },
        };
        window.adminConfirm = async () => true;
        window.adminAlert = () => {};

        const row = { page_id: 'boomcat', page_type: 'character', desc_data: { restored: true }, frame_data: {}, version_timestamp: '2026-08-01T00:00:00Z' };
        await window.restorePageHistoryVersion(row, 'boomcat');

        return {
            capturedUpsert,
            liveDataRefreshed: JSON.stringify(window.currentLiveDescData) === JSON.stringify({ restored: true }),
            reloadedListEq,
        };
    });

    expect(result.capturedUpsert).toMatchObject({
        page_id: 'boomcat',
        page_type: 'character',
        desc_data: { restored: true },
        frame_data: {},
    });
    expect(result.capturedUpsert.last_editor_name).toContain('TestReviewer');
    expect(result.liveDataRefreshed).toBe(true);
    expect(result.reloadedListEq).toEqual(['page_id', 'boomcat']);
});

test('restorePageHistoryVersion: cancelling the confirm does nothing', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        let supabaseWasCalled = false;
        window.supabaseClient = { from() { supabaseWasCalled = true; return {}; } };
        window.adminConfirm = async () => false;

        await window.restorePageHistoryVersion({ page_id: 'boomcat', desc_data: {}, frame_data: {}, version_timestamp: Date.now() }, 'boomcat');

        return { supabaseWasCalled };
    });

    expect(result.supabaseWasCalled).toBe(false);
});
