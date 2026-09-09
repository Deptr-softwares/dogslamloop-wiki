// v0.18 F1: the QA notes are on the queue card, before the ticket is opened.
//
// A contributor writes a changelog, a confidence rating and optional evidence
// at submit time. None of it was visible until the ticket was OPENED, so the
// queue offered a page id, an author and a size - and a reviewer choosing what
// to work on next had to open each one to find out what it claimed to be, which
// is the decision the queue exists to support.
//
// THE ESCAPING TESTS ARE THE POINT OF THIS FILE, not a formality. This is
// contributor free text arriving on a STAFF page through innerHTML, which is
// the exact sink CLAUDE.md's rule is about, and v0.14 shipped three live stored
// XSS holes of precisely this shape. The payload here is watched for firing
// rather than grepped for, because an escaping test that only checks a
// substring is missing passes while the injection succeeds - that happened in
// silent release 2 and was caught only by asking what would have to break.
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

// The real renderQueue against the real admin.html, so every helper it reaches
// for - escapeHtml, unwrapModeDelta, timeSince - is the shipped one.
async function render(page, rows) {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    return page.evaluate((rows) => {
        document.body.innerHTML = `
            <select id="queue-filter-page"><option value="all">All pages</option></select>
            <select id="queue-filter-status"><option value="all">all</option></select>
            <div id="queue-container"></div>`;
        window.currentQueueData = rows;
        populateQueuePageFilter(rows);
        renderQueue();
        const c = document.getElementById('queue-container');
        return {
            html: c.innerHTML,
            note: (c.querySelector('.admin-queue-qa-note') || {}).textContent || '',
            noteCount: c.querySelectorAll('.admin-queue-qa').length,
            badges: [...c.querySelectorAll('[class*="badge-confidence"]')]
                .map(b => ({ cls: b.className, text: b.textContent.trim() })),
            evidence: (c.querySelector('.admin-queue-qa-evidence') || {}).textContent || '',
            evidenceTitle: (c.querySelector('.admin-queue-qa-evidence') || {}).title || '',
            links: c.querySelectorAll('.admin-queue-qa a').length,
        };
    }, rows);
}

test('the changelog is on the card, not only inside the ticket', async ({ page }) => {
    const out = await render(page, [rev({
        qa_metadata: { changelog: 'Corrected the 5M startup from 9 to 7.', confidence: 'high', evidence: '' },
    })]);

    expect(out.note).toBe('Corrected the 5M startup from 9 to 7.');
});

test('the confidence rating reads as a badge, coloured like the size badges', async ({ page }) => {
    const out = await render(page, [
        rev({ id: 'a', qa_metadata: { changelog: 'x', confidence: 'high' } }),
        rev({ id: 'b', qa_metadata: { changelog: 'y', confidence: 'low' } }),
    ]);

    expect(out.badges.map(b => b.text)).toEqual(['HIGH', 'LOW']);
    expect(out.badges[0].cls).toContain('badge-confidence-high');
    expect(out.badges[1].cls).toContain('badge-confidence-low');
});

test('a revision with no QA metadata shows nothing rather than "unknown"', async ({ page }) => {
    // Tickets and every revision written before the QA modal existed have no
    // qa_metadata at all. A badge on all of them would be noise across the
    // majority of the queue, and an empty bordered block would read as a note
    // somebody forgot to write.
    const out = await render(page, [rev()]);

    expect(out.noteCount).toBe(0);
    expect(out.badges).toEqual([]);
});

test('an unrecognised confidence invents no badge', async ({ page }) => {
    // The value arrives from a <select>, and a direct PostgREST call ignores
    // the select entirely. Mapped through a fixed table rather than
    // interpolated into a class name, so an unexpected value picks NO class
    // instead of minting one.
    const out = await render(page, [rev({
        qa_metadata: { changelog: 'x', confidence: 'extremely-high' },
    })]);

    expect(out.badges).toEqual([]);
    expect(out.html, 'and never lands in a class attribute').not.toContain('extremely-high');
});

test('a changelog full of markup renders as text and fires nothing', async ({ page }) => {
    const PAYLOAD = '<img src=x onerror="window.__xssFired=true">';
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    const out = await page.evaluate((payload) => {
        window.__xssFired = false;
        document.body.innerHTML = `
            <select id="queue-filter-page"><option value="all">All pages</option></select>
            <select id="queue-filter-status"><option value="all">all</option></select>
            <div id="queue-container"></div>`;
        window.currentQueueData = [{
            id: 'r1', page_id: 'boomcat', status: 'pending',
            author_name: 'contributor', author_id: 'u1', is_delta: true,
            delta_payload: [{ scope: 'move' }], target_scope: 'move', target_key: 'normals::5M',
            supporters: [], opposers: [], ticket_chat: [],
            created_at: '2026-09-01T10:00:00Z',
            qa_metadata: { changelog: payload, confidence: 'high', evidence: '' },
        }];
        populateQueuePageFilter(window.currentQueueData);
        renderQueue();
        const c = document.getElementById('queue-container');
        return {
            fired: window.__xssFired,
            injectedImg: c.querySelectorAll('.admin-queue-qa img').length,
            // The POSITIVE assertion: the tag survives as readable text. An
            // assertion that some substring is absent would also pass if the
            // note vanished entirely, which is not the same claim.
            text: (c.querySelector('.admin-queue-qa-note') || {}).textContent || '',
        };
    }, PAYLOAD);

    expect(out.fired, 'the payload executed').toBe(false);
    expect(out.injectedImg, 'it became a real element').toBe(0);
    expect(out.text, 'the note has to still read as what was written').toBe(PAYLOAD);
});

test('an author name full of markup is still escaped alongside it', async ({ page }) => {
    // The card grew a second contributor-authored field this version, so the
    // one it already had is re-checked next to it - a regression here would be
    // invisible until somebody used it.
    const out = await render(page, [rev({
        author_name: '<img src=x onerror="window.__xssFired=true">',
        qa_metadata: { changelog: 'ordinary note', confidence: 'high' },
    })]);

    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img');
});

test('cited evidence is reported, and is never a clickable link', async ({ page }) => {
    // Contributor-supplied URLs landing on a staff page, one click from the
    // review queue, is a phishing step a reviewer has every reason to trust.
    // That evidence WAS cited is what helps somebody choose what to open; the
    // URL itself is in the ticket, where it is read deliberately.
    const out = await render(page, [rev({
        qa_metadata: { changelog: 'note', confidence: 'medium', evidence: 'https://example.test/clip' },
    })]);

    expect(out.evidence).toContain('Evidence cited');
    expect(out.links, 'no anchor may be built from contributor input here').toBe(0);
    expect(out.evidenceTitle, 'the URL is readable on hover, not clickable').toContain('https://example.test/clip');
});

test('a note with no changelog and no evidence draws no empty block', async ({ page }) => {
    const out = await render(page, [rev({
        qa_metadata: { changelog: '   ', confidence: 'high', evidence: '' },
    })]);

    // The confidence badge still shows - it was stated. The bordered note block
    // does not, because there is nothing in it.
    expect(out.noteCount).toBe(0);
    expect(out.badges.map(b => b.text)).toEqual(['HIGH']);
});
