// The report queue (v0.14 item 6).
//
// Reporting is what turns moderation from patrolling into a queue - moderators
// removing posts they happen to see does not scale to 1.4M people. This spec
// covers the reviewer's half: what the queue shows, and that acting on a
// report does both halves of the job.
//
// As everywhere else in this project, can_moderate() and the RPCs' own caller
// checks are unreachable from a browser and are probed live instead.
const { test, expect } = require('@playwright/test');

const report = (over = {}) => ({
    id: over.id || 'r1',
    created_at: '2026-08-13T12:00:00Z',
    target_id: 'post-1',
    page_id: 'honored_one',
    reporter_name: 'frameperfect',
    reason: 'harassment',
    note: null,
    status: 'open',
    post_body: 'the reported text',
    post_status: 'visible',
    post_author: 'mango_kun',
    report_count: 1,
    ...over,
});

async function openQueue(page, { rows = [], rpcError = null, modError = null, resolveError = null } = {}) {
    await page.addInitScript(({ rows, rpcError, modError, resolveError }) => {
        window.__rpcCalls = [];
        window.__prompts = [];

        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u-mod', email: 'mod@site.test' }, access_token: 't' } },
                    });
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
                        }
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        if (name === 'list_content_reports') {
                            return rpcError ? { data: null, error: rpcError } : { data: rows, error: null };
                        }
                        if (name === 'moderate_discussion_post') {
                            return modError ? { data: null, error: modError } : { data: 'ok', error: null };
                        }
                        if (name === 'resolve_content_report') {
                            return resolveError ? { data: null, error: resolveError } : { data: 'ok', error: null };
                        }
                        return { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, { rows, rpcError, modError, resolveError });

    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    // adminPrompt is the shared modal helper; stubbed so the reason step is
    // driven rather than waiting on a dialog this spec is not testing.
    await page.evaluate(() => {
        // Cancel is its own flag rather than __promptReply = null: `null ??
        // 'a reason'` falls through to the default, so a null reply silently
        // became a real one and the cancel test was proving nothing.
        window.adminPrompt = async (msg) => {
            window.__prompts.push(msg);
            if (window.__promptCancel) return null;
            return window.__promptReply ?? 'a reason';
        };
    });
    await page.evaluate(() => window.loadReportQueue());
}

test('the queue sits alongside the other two, not on its own screen', async ({ page, request }) => {
    // Three queues in one column on purpose: they are all "things waiting for
    // a reviewer", and splitting them across screens means forgetting one.
    const html = await (await request.get('/admin.html')).text();
    await page.goto('about:blank');

    const layout = await page.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const queue = doc.getElementById('queue-container');
        const media = doc.getElementById('media-queue-container');
        const reports = doc.getElementById('report-queue-container');
        return {
            allPresent: !!(queue && media && reports),
            sameColumn: !!(queue && reports && queue.parentElement === reports.parentElement),
            reportsLast: !!(media && reports &&
                (media.compareDocumentPosition(reports) & Node.DOCUMENT_POSITION_FOLLOWING)),
            hasFilter: !!doc.getElementById('report-queue-status'),
        };
    }, html);

    expect(layout.allPresent).toBe(true);
    expect(layout.sameColumn).toBe(true);
    expect(layout.reportsLast).toBe(true);
    expect(layout.hasFilter).toBe(true);
});

test('an empty queue is phrased as the good outcome', async ({ page }) => {
    await openQueue(page, { rows: [] });
    await expect(page.locator('#report-queue-container')).toContainText('good outcome');
});

test('a report shows the complaint and the text it is about', async ({ page }) => {
    await openQueue(page, { rows: [report({ note: 'kept following me across pages' })] });

    const card = page.locator('.report-card');
    await expect(card).toContainText('Harassment');
    await expect(card).toContainText('HONORED_ONE');
    await expect(card).toContainText('frameperfect');
    await expect(card).toContainText('mango_kun');
    await expect(card.locator('.report-note')).toContainText('kept following me across pages');
    await expect(card.locator('.report-quote')).toHaveText('the reported text');
});

test('several reports on one post is called out, one is not', async ({ page }) => {
    // The single most useful signal in the queue: three reports on one post is
    // a different situation from one, and it should be readable without
    // counting rows.
    await openQueue(page, {
        rows: [report({ id: 'r1', report_count: 4 }), report({ id: 'r2', target_id: 'post-2', report_count: 1 })],
    });

    await expect(page.locator('#report-r1 .report-count-badge')).toContainText('4 REPORTS');
    await expect(page.locator('#report-r2 .report-count-badge')).toHaveCount(0);
});

test('acting on a report moderates the post and closes the report', async ({ page }) => {
    // Two writes that must not drift apart. Order matters: a failure has to
    // leave the report open over a post already down - visible work to finish
    // - rather than a closed report over a post still on the page.
    await openQueue(page, { rows: [report({ id: 'r1', target_id: 'post-1' })] });

    await page.evaluate(() => { window.__promptReply = 'Targeted harassment'; });
    await page.click('#report-r1 [data-report-act="remove"]');

    await expect.poll(async () =>
        (await page.evaluate(() => window.__rpcCalls.map(c => c.name)))
    ).toContain('resolve_content_report');

    const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name !== 'list_content_reports'));
    expect(calls[0]).toEqual({
        name: 'moderate_discussion_post',
        params: { p_post_id: 'post-1', p_action: 'remove', p_reason: 'Targeted harassment' },
    });
    expect(calls[1]).toEqual({
        name: 'resolve_content_report',
        params: { p_report_id: 'r1', p_status: 'actioned', p_note: null },
    });
});

test('dismissing closes the report without touching the post', async ({ page }) => {
    await openQueue(page, { rows: [report({ id: 'r1' })] });

    await page.click('#report-r1 [data-report-act="dismiss"]');

    await expect.poll(async () =>
        (await page.evaluate(() => window.__rpcCalls.map(c => c.name)))
    ).toContain('resolve_content_report');

    const names = await page.evaluate(() => window.__rpcCalls.map(c => c.name));
    expect(names, 'the post is fine - only the report is closed').not.toContain('moderate_discussion_post');

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'resolve_content_report'));
    expect(call.params.p_status).toBe('dismissed');
});

test('cancelling the reason prompt writes nothing at all', async ({ page }) => {
    await openQueue(page, { rows: [report({ id: 'r1' })] });

    await page.evaluate(() => { window.__promptCancel = true; });
    await page.click('#report-r1 [data-report-act="remove"]');

    const names = await page.evaluate(() => window.__rpcCalls.map(c => c.name));
    expect(names).not.toContain('moderate_discussion_post');
    expect(names).not.toContain('resolve_content_report');
    // ...and the buttons come back, rather than the row being left dead.
    await expect(page.locator('#report-r1 [data-report-act="dismiss"]')).toBeEnabled();
});

test('a post already down cannot be moderated again, but can still be dismissed', async ({ page }) => {
    await openQueue(page, { rows: [report({ id: 'r1', post_status: 'removed_by_staff', post_body: '' })] });

    await expect(page.locator('#report-r1 [data-report-act="remove"]')).toBeDisabled();
    await expect(page.locator('#report-r1 [data-report-act="hide"]')).toBeDisabled();
    await expect(page.locator('#report-r1 [data-report-act="dismiss"]')).toBeEnabled();
    await expect(page.locator('#report-r1 .report-already')).toContainText('removed by staff');
});

test('a failed close says the post was still handled', async ({ page }) => {
    // The honest message for the one interleaving that can happen: the post is
    // down, the report is not closed. Saying "failed" would imply neither
    // happened and invite the moderator to do it twice.
    await openQueue(page, {
        rows: [report({ id: 'r1' })],
        resolveError: { message: 'network died' },
    });

    await page.evaluate(() => { window.__promptReply = 'spam'; });
    await page.click('#report-r1 [data-report-act="hide"]');

    await expect(page.locator('#report-r1 .report-action-status')).toContainText('Post handled');
});

test('a missing migration says so rather than showing a raw error', async ({ page }) => {
    await openQueue(page, { rpcError: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(page.locator('#report-queue-container')).toContainText("isn't available yet");
});

test('reporter notes and post bodies are never parsed as markup', async ({ page }) => {
    // Both are written by ordinary users and both land in a moderator's
    // authenticated admin session, which is the worst place on the site to
    // render untrusted markup.
    await openQueue(page, {
        rows: [report({
            id: 'r1',
            note: '<img src=x onerror="window.__pwned=1">',
            post_body: '<script>window.__pwned2=1</script>hostile',
            reporter_name: '<b>bold</b>reporter',
        })],
    });

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        pwned2: !!window.__pwned2,
        imgs: document.querySelectorAll('#report-queue-container img').length,
        bolds: document.querySelectorAll('#report-queue-container b').length,
        scripts: document.querySelectorAll('#report-queue-container script').length,
        quote: document.querySelector('.report-quote').textContent,
    }));

    expect(result.pwned).toBe(false);
    expect(result.pwned2).toBe(false);
    expect(result.imgs).toBe(0);
    expect(result.bolds).toBe(0);
    expect(result.scripts).toBe(0);
    expect(result.quote).toContain('<script>');
});
