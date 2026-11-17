// The QA report, on every submission (owner's Overseer card, v1.2).
//
// "There is no way to view the full QA, unless you need to open a ticket." A
// contributor writes a changelog, a confidence rating and evidence when they
// submit. The queue card shows the changelog clamped and only says evidence
// was cited (tests/queue-qa-notes.spec.js); the whole report was drawn inside
// the ticket workspace, so a submission nobody had opened a ticket on never
// showed it. It sits in the review pane now, for whichever submission is open.
//
// EVERYTHING IN THE REPORT IS CONTRIBUTOR TEXT ON A STAFF PAGE. The confidence
// arrives from a <select> that a direct REST insert can ignore, and the
// evidence is free text that becomes a link. So the escaping is watched for
// firing, not grepped for, and only a whole http(s) address is ever a link.
const { test, expect } = require('@playwright/test');

const EVIL = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

const rev = (over = {}) => ({
    id: '00000000-0000-4000-8000-000000000001',
    page_id: 'boomcat', page_type: 'character', status: 'pending',
    author_id: 'u-author', author_name: 'Someone',
    created_at: '2026-11-17T10:00:00Z',
    is_delta: true, target_scope: 'overview', target_key: 'full', delta_payload: [],
    qa_metadata: {
        changelog: 'Fixed the startup on 5M.',
        confidence: 'high',
        evidence: 'https://example.com/clip',
    },
    supporters: [], opposers: [], ticket_chat: [],
    ...over,
});

// The real admin.html as an admin, with the queue's rows mocked. The realtime
// channel an open ticket subscribes to is stubbed, so nothing here reaches the
// real Supabase.
async function openQueue(page, rows) {
    await page.addInitScript((rows) => {
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
                    client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-staff', email: 'staff@example.com' }, access_token: 'tok' } } });
                    const thenable = (result) => {
                        const chain = {
                            select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; },
                            single: async () => result, maybeSingle: async () => result,
                            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
                        };
                        return chain;
                    };
                    client.from = (table) => {
                        if (table === 'user_roles') return thenable({ data: [{ role: 'admin' }], error: null });
                        if (table === 'pending_revisions') return thenable({ data: rows.map(r => ({ ...r })), error: null });
                        if (table === 'page_data') return thenable({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
                        return thenable({ data: [], error: null });
                    };
                    const channel = { on() { return channel; }, subscribe() { return channel; } };
                    client.channel = () => channel;
                    client.removeChannel = () => {};
                    return client;
                };
            },
        });
    }, rows);
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#queue-container .update-log-item')).toHaveCount(rows.length, { timeout: 15000 });
}

// By the page it is for: the queue groups and sorts its cards, so an index is
// not a stable way to name one.
const review = (page, pageId = 'boomcat') => page.locator('#queue-container .admin-queue-card-header')
    .filter({ has: page.locator('.badge-page-id', { hasText: new RegExp('^' + pageId + '$', 'i') }) })
    .locator('.admin-review-btn').click();
const report = (page) => page.locator('#qa-report-panel');

test('a submission with no ticket shows its whole QA report when it is opened', async ({ page }) => {
    await openQueue(page, [rev()]);
    await expect(report(page), 'nothing is open yet').toBeHidden();

    await review(page);

    await expect(report(page)).toBeVisible();
    await expect(page.locator('#ticket-workspace')).toBeHidden();
    await expect(report(page)).toContainText('Fixed the startup on 5M.');
    await expect(report(page)).toContainText('high');
    // The address is the link's text, so a reviewer sees where it goes
    // before pressing it.
    const link = report(page).locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', 'https://example.com/clip');
    await expect(link).toHaveText('https://example.com/clip');
    await expect(link).toHaveAttribute('rel', /noopener/);
});

test('an open ticket shows the same report, and only once', async ({ page }) => {
    await openQueue(page, [rev({ status: 'ticket_open' })]);
    await review(page);

    await expect(page.locator('#ticket-workspace')).toBeVisible();
    await expect(report(page)).toBeVisible();
    await expect(report(page)).toContainText('Fixed the startup on 5M.');
    await expect(page.getByRole('heading', { name: 'QA REPORT' })).toHaveCount(1);
});

test('opening another submission replaces the report, and Escape puts it away', async ({ page }) => {
    await openQueue(page, [
        rev(),
        rev({ id: '00000000-0000-4000-8000-000000000002', page_id: 'vessel', qa_metadata: { changelog: 'Rewrote the Vessel overview.' } }),
    ]);

    await review(page, 'boomcat');
    await expect(report(page)).toContainText('Fixed the startup on 5M.');

    await review(page, 'vessel');
    await expect(report(page)).toContainText('Rewrote the Vessel overview.');
    await expect(report(page)).not.toContainText('Fixed the startup on 5M.');
    await expect(report(page).locator('a'), 'the first one\'s link went with it').toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(report(page)).toBeHidden();
});

test('a submission from before the QA form says what is missing', async ({ page }) => {
    await openQueue(page, [rev({ qa_metadata: null })]);
    await review(page);

    await expect(report(page)).toContainText('No changelog provided.');
    await expect(report(page)).toContainText('Unrated');
    await expect(report(page)).toContainText('No evidence linked.');
});

test('evidence that is not one web address is shown as text, never as a link', async ({ page }) => {
    // A merged ticket's evidence is every contributor's, one block each
    // (js/admin-merge-compiler.js), and a contributor can type a sentence. Both
    // used to read "not a valid http(s) URL" and hide what was written.
    const samples = [
        'javascript:alert(1)',
        'Recorded in a private server at 60fps.',
        'https://example.com/a and https://example.com/b',
        '--- Someone ---\nhttps://example.com/clip',
    ];
    await openQueue(page, samples.map((evidence, i) => rev({
        id: `00000000-0000-4000-8000-00000000000${i + 1}`,
        page_id: `page${i + 1}`,
        qa_metadata: { changelog: `change ${i + 1}`, evidence },
    })));

    for (const [i, evidence] of samples.entries()) {
        await review(page, `page${i + 1}`);
        await expect(report(page)).toContainText(`change ${i + 1}`);
        await expect(report(page).locator('a'), evidence).toHaveCount(0);
        expect(await report(page).locator('.qa-report-evidence').innerText()).toBe(evidence);
    }
});

test('contributor text in the report is text, not markup', async ({ page }) => {
    await openQueue(page, [rev({ qa_metadata: { changelog: EVIL, confidence: EVIL, evidence: EVIL } })]);
    await review(page);

    await expect(report(page)).toBeVisible();
    await expect(report(page)).toContainText(EVIL);
    expect(await report(page).locator('img').count(), 'no element was made from the QA').toBe(0);
    expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});
