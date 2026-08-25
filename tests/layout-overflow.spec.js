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
        // Narrower than the 320px sidebar, because the badges row already
        // wraps: its min-content is ONE badge wide, so at 320px there is room
        // for the widest tag and the button both and the bug never appears.
        // The owner's screenshot is the squeezed case, and this is it.
        host.style.width = '190px';
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
            // The HOST, not the card. The card has no width of its own and
            // grows with its content, so "the button is inside the card" was
            // true however far both of them overflowed - it passed with the
            // fix reverted, which is how I found it was measuring nothing.
            hostRight: Math.round(host.getBoundingClientRect().right),
            cardRight: Math.round(cardBox.right),
            btnRight: Math.round(btnBox.right),
            btnWidth: Math.round(btnBox.width),
            reachable: hit === button || button.contains(hit),
        };
    });

    expect(out.btnRight, 'the button stays inside the sidebar width').toBeLessThanOrEqual(out.hostRight);
    expect(out.cardRight, 'and so does the card').toBeLessThanOrEqual(out.hostRight);
    expect(out.reachable, 'and can actually be clicked').toBe(true);
    // The badges yield, not the button: a REVIEW squeezed to nothing would
    // satisfy the bound above while being useless.
    expect(out.btnWidth).toBeGreaterThan(30);
});

// v0.16 bug 4, the owner again: "the purple tag on a Revision Card overflows to
// the right when it gets long. Seen editing a single section of a tab in
// Writing Guide."
//
// The test above covers the badges ROW wrapping. This is the other half, and
// the row wrapping cannot help with it: ONE badge whose own text will not
// break. Badges.css gives every .update-badge `white-space: nowrap`, which is
// right for the hand-written ones - WIP, EA, TICKET OPEN, S/M/L - but
// .badge-patch-delta carries `[PATCH: <scope>: <key>]`, and a system-section
// key is two slugified titles joined by `::`. Measured before the fix: 402px
// wide inside a 190px column, and the same 402px inside a 320px one, because
// nowrap means it never shrinks at all.
const LONG_PATCH_LABEL =
    'SYSTEM_SECTION: writing-a-character-page::how-to-write-a-character-overview-section';

for (const width of [320, 190]) {
    test(`a long patch tag wraps inside the card at ${width}px`, async ({ page }) => {
        await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('body');

        const out = await page.evaluate(({ LONG_PATCH_LABEL, width }) => {
            const host = document.createElement('div');
            host.style.width = width + 'px';
            document.body.appendChild(host);
            host.innerHTML = `
                <div class="update-log-item">
                    <div class="admin-queue-card-header">
                        <div class="admin-queue-card-info">
                            <div class="admin-queue-badges-row">
                                <span class="update-badge badge-status-ticket-open">TICKET OPEN</span>
                                <span class="update-badge badge-page-id">WRITING_GUIDE</span>
                                <span class="update-badge badge-patch-delta">[PATCH: ${LONG_PATCH_LABEL}]</span>
                                <span class="update-badge badge-size-l">L</span>
                            </div>
                            <h3 class="update-title">REVISION SUBMISSION</h3>
                        </div>
                        <button class="btn-sys btn-sys-blue admin-review-btn">REVIEW</button>
                    </div>
                </div>`;
            const card = host.querySelector('.update-log-item');
            const badge = host.querySelector('.badge-patch-delta');
            const shortBadge = host.querySelector('.badge-size-l');
            card.scrollIntoView({ block: 'center' });
            return {
                hostRight: Math.round(host.getBoundingClientRect().right),
                badgeRight: Math.round(badge.getBoundingClientRect().right),
                cardRight: Math.round(card.getBoundingClientRect().right),
                // The short badges must NOT have been collateral damage: a fix
                // that dropped nowrap from the shared base would break "L" and
                // "TICKET OPEN" onto two lines each across the whole site.
                shortWraps: getComputedStyle(shortBadge).whiteSpace,
            };
        }, { LONG_PATCH_LABEL, width });

        expect(out.badgeRight, 'the tag stays inside its column').toBeLessThanOrEqual(out.hostRight);
        expect(out.cardRight, 'and so does the card').toBeLessThanOrEqual(out.hostRight);
        expect(out.shortWraps, 'the shared badge base keeps nowrap for the short ones').toBe('nowrap');
    });
}
