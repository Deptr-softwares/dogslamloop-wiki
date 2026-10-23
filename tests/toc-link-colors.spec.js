// The right sidebar's buttons are white, whatever order a page loads its
// stylesheets in (owner, 2026-10-23: "These buttons on the ToC shouldn't have
// a muted gray color", with the Main Dashboard and the Writing Guide).
//
// The contents styles (Layout.css) and .btn-nav (Buttons.css) are one class
// each, so the later stylesheet won. The Main Dashboard loads Layout.css last
// and drew its contents white; the generated system pages and forum.html load
// it first, so .btn-nav's muted gray, padding and size won there: gray
// headings, sub-headings that were not indented, and a group heading running
// under its own arrow. The Sitewide links were plain .btn-nav, gray everywhere.
//
// The entries are this test's own, added to the real sidebar, so nothing here
// depends on which headings a page has.
const { test, expect } = require('@playwright/test');

// One page of each load order. The first assertion checks they still differ.
const PAGES = ['/', '/forum.html'];

async function measure(page, url) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const sheets = [...document.querySelectorAll('link[rel=stylesheet]')]
      .map(l => l.getAttribute('href').replace(/\?.*$/, '').split('/').pop());
    const box = document.querySelector('.local-sidebar-right');
    box.insertAdjacentHTML('beforeend', `
      <ul class="toc-list">
        <li><div class="toc-group-row"><a href="#" class="btn-nav toc-link-major-toggle" id="zzq-toggle"><span class="toc-link-text">Zzq Group</span></a></div></li>
        <li><a href="#" class="btn-nav toc-link-minor" id="zzq-minor">Zzq Sub</a></li>
        <li><a href="#" class="btn-nav toc-link-major" id="zzq-major">Zzq Heading</a></li>
      </ul>`);
    // What the theme resolves to, so the test follows the palette.
    const probe = document.createElement('span');
    box.appendChild(probe);
    probe.style.color = 'var(--text-white)';
    const white = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-muted)';
    const muted = getComputedStyle(probe).color;
    const css = (id) => getComputedStyle(document.getElementById(id));
    const sitewide = box.querySelector(':scope > a.btn-nav');
    return {
      layoutFirst: sheets.indexOf('Layout.css') < sheets.indexOf('Buttons.css'),
      white, muted,
      sitewide: getComputedStyle(sitewide).color,
      major: css('zzq-major').color,
      toggle: css('zzq-toggle').color,
      togglePadRight: css('zzq-toggle').paddingRight,
      minor: css('zzq-minor').color,
      minorPadLeft: css('zzq-minor').paddingLeft,
      minorSize: css('zzq-minor').fontSize,
      majorPadLeft: css('zzq-major').paddingLeft,
      majorSize: css('zzq-major').fontSize,
    };
  });
}

test('the two pages load the stylesheets in opposite orders', async ({ page }) => {
  const orders = [];
  for (const url of PAGES) orders.push((await measure(page, url)).layoutFirst);
  expect(orders, 'one page of each order, or this file tests one case twice').toEqual([false, true]);
});

for (const url of PAGES) {
  test(`headings and the Sitewide links are white, sub-headings stay dimmer and indented: ${url}`, async ({ page }) => {
    const m = await measure(page, url);

    expect(m.sitewide, 'Sitewide link').toBe(m.white);
    expect(m.major, 'a heading').toBe(m.white);
    expect(m.toggle, 'a heading with sub-headings').toBe(m.white);
    expect(m.minor, 'a sub-heading').toBe(m.muted);

    // Structure, not pixels: indented past a heading, smaller, and the group
    // heading keeps clear of its arrow.
    expect(parseFloat(m.minorPadLeft)).toBeGreaterThan(parseFloat(m.majorPadLeft));
    expect(parseFloat(m.minorSize)).toBeLessThan(parseFloat(m.majorSize));
    expect(parseFloat(m.togglePadRight)).toBeGreaterThan(parseFloat(m.majorPadLeft));
  });
}
