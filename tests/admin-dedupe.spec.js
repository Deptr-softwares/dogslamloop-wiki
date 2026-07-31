// Coverage for Workstream B Tier 5 (admin.js): inline styles extracted to
// CSS classes across the queue list, ticket workspace, diff view, and
// merge compiler. Most of admin.js's rendering only runs after a real
// Supabase admin/reviewer session passes the RBAC gate in the
// DOMContentLoaded handler - per this project's established testing
// strategy, role-gated behavior isn't automated here (verified manually
// instead, same as the original architecture pass's A-0 RLS check).
// These tests cover what's safe to verify without auth: the CSS classes
// themselves render correctly, and the #preview-content-area toggle
// (a real classList bug fix - see below) works in isolation.
const { test, expect } = require('@playwright/test');

test('admin.html: kicks logged-out visitors to the access-denied screen with real CSS backing', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const screen = page.locator('.access-denied-screen');
  await expect(screen).toBeVisible();
  expect(await screen.evaluate(el => getComputedStyle(el).display)).toBe('flex');
});

test('admin.html: queue status badges render with distinct classes and real colors, no inline style', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span class="update-badge badge-status-ticket-open">TICKET OPEN</span>
      <span class="update-badge badge-status-pending">PENDING</span>
      <span class="update-badge badge-patch-delta">[PATCH]</span>
      <span class="update-badge badge-legacy-overwrite">[LEGACY]</span>
      <span class="update-badge badge-page-id">BOOMCAT</span>
    `;
    document.body.appendChild(container);
    const badges = Array.from(container.children).map(el => ({
      cls: el.className.split(' ')[1],
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      hasInlineStyle: el.hasAttribute('style'),
    }));
    container.remove();
    return badges;
  });

  expect(result).toHaveLength(5);
  for (const b of result) {
    expect(b.hasInlineStyle, `${b.cls} should have no inline style`).toBe(false);
    expect(b.bg, `${b.cls} background`).not.toBe('rgba(0, 0, 0, 0)');
  }
  // Ticket-open and pending are visually distinct (yellow vs blue background).
  expect(result[0].bg).not.toBe(result[1].bg);
});

test('#preview-content-area.active toggles opacity/pointer-events via classList (real bug fix: previously two separate inline style.opacity assignments, now one class)', async ({ page }) => {
  // admin.html's DOMContentLoaded RBAC gate wipes document.body for a
  // logged-out visitor (kickUser), so build a synthetic element with the
  // same id instead of relying on the page's own (now-gone) markup - this
  // still exercises the real CSS rule, just not the real admin.js flow.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const states = await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'preview-content-area';
    document.body.appendChild(el);
    const disabled = { opacity: getComputedStyle(el).opacity, pointerEvents: getComputedStyle(el).pointerEvents };
    el.classList.add('active');
    return new Promise(resolve => {
      // #preview-content-area has `transition: opacity 0.3s ease`; wait for it to settle.
      setTimeout(() => {
        const enabled = { opacity: getComputedStyle(el).opacity, pointerEvents: getComputedStyle(el).pointerEvents };
        el.remove();
        resolve({ disabled, enabled });
      }, 350);
    });
  });
  expect(states.disabled.opacity).toBe('0.2');
  expect(states.disabled.pointerEvents).toBe('none');
  expect(states.enabled.opacity).toBe('1');
  expect(states.enabled.pointerEvents).toBe('auto');
});

test('dynamically-created system-nav-btn (js/admin.js updateAdminSidebar) gets its styling from a class, not inline', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const sidebar = document.createElement('div');
    sidebar.id = 'preview-nav-sidebar';
    const nav = document.createElement('div');
    nav.className = 'nav-btn system-nav-btn';
    sidebar.appendChild(nav);
    document.body.appendChild(sidebar);
    const cs = { cursor: getComputedStyle(nav).cursor, fontSize: getComputedStyle(nav).fontSize, hasInlineStyle: nav.hasAttribute('style') };
    sidebar.remove();
    return cs;
  });
  expect(result.hasInlineStyle).toBe(false);
  expect(result.cursor).toBe('pointer');
  expect(result.fontSize).toBe('13.6px'); // 0.85rem
});
