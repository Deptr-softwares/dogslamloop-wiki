// The sheets split from Layout.css load right after it, so a rule moved into one
// would now win a tie it used to lose to a later Layout.css rule. The rules for
// which that would show stay in Layout.css, and this holds them to it: on a real
// page, with its real stylesheets, an element carrying both classes resolves the
// way the later Layout.css rule says, measured against a plain element of that
// rule. The markup is placed by the test, so no page content is read.
const { test, expect } = require('@playwright/test');

async function place(page, url, html) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(markup => {
        const box = document.createElement('div');
        box.id = 'tie-probe';
        box.innerHTML = markup;
        document.querySelector('main').appendChild(box);
    }, html);
}

const style = (page, selector, prop) => page.locator(selector).evaluate((el, p) => getComputedStyle(el)[p], prop);

test('the Trivia list keeps a Block list\'s bottom margin', async ({ page }) => {
    await place(page, '/characters/Boomcat/index.html', `
        <ul class="wiki-block-list" id="plain"><li>a</li></ul>
        <ul class="wiki-block-list profile-trivia" id="trivia"><li>a</li></ul>`);
    const plain = await style(page, '#plain', 'marginBottom');
    expect(plain, 'a Block list has a bottom margin').not.toBe('0px');
    expect(await style(page, '#trivia', 'marginBottom')).toBe(plain);
});

test('a Trivia term takes the focus ring every control has', async ({ page }) => {
    await place(page, '/characters/Boomcat/index.html', `
        <button id="plain">a</button>
        <span class="profile-trivia-term" tabindex="0" id="term">b</span>`);
    // From the keyboard, so :focus-visible applies.
    await page.locator('#plain').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#term')).toBeFocused();
    const term = await style(page, '#term', 'outlineWidth');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#plain')).toBeFocused();
    expect(term).toBe(await style(page, '#plain', 'outlineWidth'));
});

test('a tab\'s contributors footer takes the spacing of the column it ends', async ({ page }) => {
    await place(page, '/characters/Boomcat/index.html', `
        <div class="space-y-6">
            <div>first</div>
            <div id="plain">second</div>
            <div class="aggregated-contributors-footer tab-contributors-footer" id="footer">footer</div>
        </div>`);
    expect(await style(page, '#footer', 'marginTop')).toBe(await style(page, '#plain', 'marginTop'));
});

test('on a phone, a system page\'s section takes a section\'s padding', async ({ page }) => {
    // Where Cards.css loads before Layout.css, as in the editor's and the
    // Overseer's previews of a system page and on a character page. Where it loads
    // after, as on a system page, its own .wiki-section padding decides instead.
    await page.setViewportSize({ width: 390, height: 844 });
    await place(page, '/characters/Boomcat/index.html', `
        <section class="wiki-section" id="plain">a</section>
        <section class="wiki-section system-content-grid-section" id="grid">b</section>`);
    const plain = await style(page, '#plain', 'paddingLeft');
    expect(plain, 'the phone padding applies').not.toBe('8px');
    expect(await style(page, '#grid', 'paddingLeft')).toBe(plain);
});
