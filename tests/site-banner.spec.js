// The site's banner (window.siteBanner, js/utility/site_utils.js): one look for a
// notice that stays on the page, a coloured bar on its left (the owner's pick, "Left
// bar"). There were four: the page alerts (a coloured border all round and a hard
// shadow), the rescued page's dashed line, the Playground's boxed line and the
// Overseer's dashed batch line. Their own specs check the other three
// (page-rescue, editor-playground, merged-ticket-diff); this one the page alerts.
const { test, expect } = require('@playwright/test');

// The page's own list, with all three alert flags on every page as it arrives, so no
// test hangs on which page the owner has flagged. Matched with or without the ?v=
// stamp the page asks for it with.
function flagEveryPage(page) {
  return page.route(/\/data\/navigation\.json(\?|$)/, async (route) => {
    const response = await route.fetch();
    const nav = await response.json();
    Object.values(nav).flat().forEach(entry => Object.assign(entry, { isWip: true, isEA: true, isMissingMedia: true }));
    await route.fulfill({ response, json: nav });
  });
}

// A colour as the browser computes it.
const resolve = (page, colour) => page.evaluate((c) => {
  const probe = document.createElement('span');
  probe.style.color = c;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}, colour);

test('the page alerts are the site banner: a coloured bar on the left, the title in its colour', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await flagEveryPage(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const banners = page.locator('#character-alerts-container .site-banner');
  await expect(banners).toHaveCount(3, { timeout: 30000 });
  await expect(banners.locator('.site-banner-title')).toHaveText(['Work In Progress', 'Early Access Content', 'Media Missing']);
  await expect(banners.first().locator('.site-banner-text')).toHaveText('This page is actively being drafted. Data may be incomplete or subject to change.');

  const looks = await banners.evaluateAll(els => els.map(el => {
    const s = getComputedStyle(el);
    return {
      bar: s.borderLeftColor, barWidth: s.borderLeftWidth, edge: s.borderTopColor, edgeWidth: s.borderTopWidth,
      shadow: s.boxShadow, title: getComputedStyle(el.querySelector('.site-banner-title')).color,
      role: el.getAttribute('role'), iconHidden: el.querySelector('.site-banner-icon').getAttribute('aria-hidden'),
    };
  }));
  const yellow = await resolve(page, 'var(--accent-yellow)');
  const grey = await resolve(page, 'var(--border-color)');
  expect(looks[0].bar, 'Work In Progress is yellow').toBe(yellow);
  expect(new Set(looks.map(l => l.bar)).size, 'each alert its own colour').toBe(3);
  for (const look of looks) {
    expect(look.barWidth).toBe('5px');
    expect(look.edge, 'a thin grey border round the rest').toBe(grey);
    expect(look.edgeWidth).toBe('1px');
    expect(look.shadow).toBe('none');
    expect(look.title, 'the title in the bar colour').toBe(look.bar);
    expect(look.role).toBe('note');
    expect(look.iconHidden).toBe('true');
  }
  expect(errors).toEqual([]);
});

test('a banner\'s words are text, never markup', async ({ page }) => {
  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.siteBanner === 'function');
  const out = await page.evaluate(() => {
    const banner = window.siteBanner({ title: '<b>T</b>', text: '<img src=x onerror="window.__hit=1">' });
    document.body.appendChild(banner);
    return { img: banner.querySelector('img'), text: banner.querySelector('.site-banner-text').textContent };
  });
  expect(out.img).toBeNull();
  expect(out.text).toBe('<img src=x onerror="window.__hit=1">');
});
