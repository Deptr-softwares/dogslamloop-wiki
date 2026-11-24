// window.runDialog (js/utility/site_utils.js) runs every confirm, message and prompt
// box on the site. Each box keeps its own markup and look; the engine shows
// it, resolves with the value of the button pressed, and takes its listeners
// off again.
//
// Thirteen functions each did this themselves before 2026-11-20, and two
// families of them disagreed about a box that was already open: the onclick
// ones left the first question hanging, the addEventListener ones answered
// both questions with one click.
const { test, expect } = require('@playwright/test');

async function openBox(page) {
    await page.goto('/privacy-policy.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.runDialog === 'function');
    await page.evaluate(() => {
        const box = document.createElement('div');
        box.id = 'test-box';
        box.className = 'hidden';
        box.innerHTML = '<input id="test-input"><button id="test-ok">OK</button><button id="test-no">NO</button>';
        document.body.appendChild(box);
        window.__answers = [];
        window.__closes = 0;
        window.__ask = (opts = {}) => window.runDialog(box, {
            buttons: [[box.querySelector('#test-ok'), true], [box.querySelector('#test-no'), false]],
            cancel: false,
            onClose: () => { window.__closes++; },
            ...opts,
        }).then(answer => window.__answers.push(answer));
    });
    return page.locator('#test-box');
}

test('it shows the box, answers with the button pressed, and hides it', async ({ page }) => {
    const box = await openBox(page);
    await page.evaluate(() => { window.__ask(); });
    await expect(box).toBeVisible();
    await page.click('#test-ok');
    await expect(box).toBeHidden();
    expect(await page.evaluate(() => window.__answers)).toEqual([true]);
});

test('a second question on a box already showing is refused, so one click answers one question', async ({ page }) => {
    const box = await openBox(page);
    await page.evaluate(() => { window.__ask(); window.__ask(); });
    await expect.poll(() => page.evaluate(() => window.__answers)).toEqual([false]);
    await expect(box).toBeVisible();
    await page.click('#test-ok');
    await expect.poll(() => page.evaluate(() => window.__answers)).toEqual([false, true]);
    // Its listeners are off: asking again and pressing NO answers only that.
    await page.evaluate(() => { window.__ask(); });
    await page.click('#test-no');
    await expect.poll(() => page.evaluate(() => window.__answers)).toEqual([false, true, false]);
    // And a press on a box nobody is asking anything of closes nothing.
    const closes = await page.evaluate(() => window.__closes);
    await page.evaluate(() => document.getElementById('test-ok').click());
    expect(await page.evaluate(() => window.__closes)).toBe(closes);
});

test('Escape and the backdrop close it only when the box asks for them', async ({ page }) => {
    const box = await openBox(page);
    // The backdrop is the overlay itself, so the click is sent to it directly.
    const clickBackdrop = () => page.evaluate(() => document.getElementById('test-box').click());
    await page.evaluate(() => { window.__ask(); });
    await page.keyboard.press('Escape');
    await clickBackdrop();
    await expect(box).toBeVisible();
    expect(await page.evaluate(() => window.__answers)).toEqual([]);
    await page.click('#test-no');

    // Listening for Enter is not taking Escape.
    await page.evaluate(() => { window.__ask({ enter: true }); });
    await page.keyboard.press('Escape');
    await expect(box).toBeVisible();
    await page.click('#test-no');
    expect(await page.evaluate(() => window.__answers)).toEqual([false, false]);
    await page.evaluate(() => { window.__answers = []; });

    await page.evaluate(() => { window.__ask({ escape: true, backdrop: true }); });
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await page.evaluate(() => { window.__ask({ escape: true, backdrop: true }); });
    await clickBackdrop();
    await expect(box).toBeHidden();
    expect(await page.evaluate(() => window.__answers)).toEqual([false, false]);
});

test('Enter answers from where the box listens, and a value can be read at the press', async ({ page }) => {
    const box = await openBox(page);
    await page.evaluate(() => {
        const input = document.getElementById('test-input');
        window.__ask({
            buttons: [[document.getElementById('test-ok'), () => input.value.trim()]],
            cancel: null, escape: true, keyTarget: input, focus: input,
            enter: () => input.value.trim(),
        });
    });
    await expect(page.locator('#test-input')).toBeFocused();
    await page.keyboard.type('  a link  ');
    await page.keyboard.press('Enter');
    await expect(box).toBeHidden();
    expect(await page.evaluate(() => window.__answers)).toEqual(['a link']);
});

test('onClose runs when it closes, and when it is refused', async ({ page }) => {
    await openBox(page);
    const closes = await page.evaluate(async () => {
        let closed = 0;
        const box = document.getElementById('test-box');
        const ok = box.querySelector('#test-ok');
        const first = window.runDialog(box, { buttons: [[ok, 1]], onClose: () => { closed++; } });
        await window.runDialog(box, { buttons: [[ok, 2]], cancel: 'refused', onClose: () => { closed++; } });
        const afterRefusal = closed;
        ok.click();
        await first;
        return { afterRefusal, total: closed };
    });
    expect(closes).toEqual({ afterRefusal: 1, total: 2 });
});
