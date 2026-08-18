// Two overflow bugs the owner found by looking at the site (2026-08-18).
//
// Both are the same family - a box wider than the space it was given - and
// both are asserted as GEOMETRY against a sibling or a parent, never as a
// pixel count, because font metrics differ by OS and these have to hold on a
// Linux CI runner as well as here.
const { test, expect } = require('@playwright/test');

test('the contributors footer stays inside its column', async ({ page }) => {
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });

    // width: 100% plus 1.25rem of padding each side plus a 2px border, with no
    // global border-box, put this ~44px past its column - far enough to sit
    // under the table of contents.
    const out = await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'footer-host';
        host.style.width = '600px';
        document.body.appendChild(host);
        host.innerHTML = `
            <div class="aggregated-contributors-footer tab-contributors-footer">
                <div class="contributors-header">Contributors</div>
                <div class="contributors-list"><span class="author-badge">Somebody</span></div>
            </div>`;
        const footer = host.querySelector('.aggregated-contributors-footer');
        return {
            host: Math.round(host.getBoundingClientRect().width),
            footer: Math.round(footer.getBoundingClientRect().width),
        };
    });

    // The claim is a relationship, not a number: whatever the column is, the
    // footer fits inside it.
    expect(out.footer).toBeLessThanOrEqual(out.host);
    expect(out.host, 'the fixture really did lay out').toBe(600);
});

test('a long ticket tag wraps instead of pushing the review button out', async ({ page }) => {
    await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body');

    const out = await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'queue-host';
        host.style.width = '320px'; // the real sidebar width
        document.body.appendChild(host);
        host.innerHTML = `
            <div class="update-log-item">
                <div class="admin-queue-card-header">
                    <div class="admin-queue-card-info">
                        <div class="admin-queue-badges-row">
                            <span class="update-badge badge-status-ticket-open">TICKET OPEN</span>
                            <span class="update-badge badge-page-id">DEFENSE_ATTORNEY</span>
                            <span class="update-badge">-PATCH: 10 TARGETS-</span>
                            <span class="update-badge">L</span>
                        </div>
                        <h3 class="update-title">REVISION SUBMISSION</h3>
                    </div>
                    <button class="btn-sys btn-sys-blue admin-review-btn">REVIEW</button>
                </div>
            </div>`;

        const card = host.querySelector('.update-log-item');
        const button = host.querySelector('.admin-review-btn');

        // Into view before measuring. elementFromPoint takes VIEWPORT
        // coordinates, and this host is appended to the end of a long page -
        // so the hit test was landing on whatever happened to be at those
        // coordinates on screen rather than on the button.
        card.scrollIntoView({ block: 'center' });

        const cardBox = card.getBoundingClientRect();
        const btnBox = button.getBoundingClientRect();

        // What decides whether it is clickable is which element is on top at
        // that point - a button hanging outside the card is still "visible".
        const hit = document.elementFromPoint(
            btnBox.left + btnBox.width / 2, btnBox.top + btnBox.height / 2);

        return {
            cardRight: Math.round(cardBox.right),
            btnRight: Math.round(btnBox.right),
            btnWidth: Math.round(btnBox.width),
            reachable: hit === button || button.contains(hit),
        };
    });

    expect(out.btnRight, 'the button stays inside the card').toBeLessThanOrEqual(out.cardRight);
    expect(out.reachable, 'and can actually be clicked').toBe(true);
    // The badges yield, not the button: a REVIEW squeezed to nothing would
    // satisfy the bound above while being useless.
    expect(out.btnWidth).toBeGreaterThan(30);
});
