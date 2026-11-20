// The home page's FAQ draws each question and answer as text. They come from
// the site_faq table through data/faq.json, which only the owner writes, but
// the page treats database text as hostile all the same: the only markup an
// answer gets is the span that marks an @mention.
const { test, expect } = require('@playwright/test');

const QUESTION = 'What is <b data-pwn="1">this</b> & why?';
const ANSWER = 'Ask @Deptr about <img src=x data-pwn="1"> & "quotes"';

test('a FAQ question and answer show as text, and an @mention is still marked', async ({ page }) => {
    await page.route('**/data/faq.json**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ faqs: [{ question: QUESTION, paragraphs: [ANSWER] }] }),
    }));
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    const faq = page.locator('#faq-dynamic-container .faq-details');
    await expect(faq).toHaveCount(1, { timeout: 15000 });
    expect(await page.locator('#faq-dynamic-container [data-pwn]').count(), 'no markup became an element').toBe(0);

    await expect(faq.locator('.faq-summary span').first()).toHaveText(QUESTION);
    await expect(faq.locator('.faq-content p')).toHaveText(ANSWER);
    await expect(faq.locator('.faq-content p span'), 'the mention keeps its mark').toHaveText('@Deptr');
});
