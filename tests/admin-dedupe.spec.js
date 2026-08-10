// Coverage for Workstream B Tier 5 (admin.js, since split into
// admin-core/queue/diff/preview/tickets/actions/merge-compiler.js as part
// of the admin-page rework): inline styles extracted to CSS classes across
// the queue list, ticket workspace, diff view, and merge compiler. Most of
// that rendering only runs after a real
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
  // The gate retries a failed session/role check once (~600ms delay) before
  // giving up, so wait for the real access-denied screen first - otherwise
  // kickUser()'s innerHTML wipe can land mid-test and destroy this synthetic
  // element out from under the assertions below.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await page.locator('.access-denied-screen').waitFor({ state: 'visible', timeout: 3000 });
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

test('dynamically-created system-nav-btn (js/admin-diff.js updateAdminSidebar) gets its styling from a class, not inline', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  // Drives the real generator rather than a hand-built stand-in. These
  // buttons used to be bare <div class="nav-btn system-nav-btn"> styled by a
  // sidebar-scoped rule; they render in the top revision strip now and take
  // the same .btn-manga shape as the static character tabs beside them.
  const result = await page.evaluate(() => {
    document.body.innerHTML = `
      <nav id="preview-tab-nav" class="admin-preview-tab-nav">
        <button id="nav-overview" class="btn-manga btn-manga-slanted active"><div class="btn-manga-content"><span class="btn-manga-text">Overview</span></div></button>
      </nav>
    `;

    window.activePreviewPageType = 'system';
    window.currentPendingDescData = {
      // Contributor-submitted, so it must arrive as text and not as markup.
      tabs: [{ tabId: 'mechanics', tabLabel: '<img src=x onerror="window.__xss=1">Mechanics' }],
    };
    window.currentLiveDescData = {};

    window.updateAdminSidebar();

    const btn = document.getElementById('nav-mechanics');
    return {
      exists: !!btn,
      tagName: btn ? btn.tagName : null,
      inStrip: !!(btn && btn.closest('#preview-tab-nav')),
      isManga: !!(btn && btn.classList.contains('btn-manga')),
      hasInlineStyle: btn ? btn.hasAttribute('style') : true,
      cursor: btn ? getComputedStyle(btn).cursor : null,
      label: btn ? btn.textContent : null,
      injectedImg: !!(btn && btn.querySelector('img')),
      xss: !!window.__xss,
    };
  });

  expect(result.exists).toBe(true);
  expect(result.tagName, 'a real button, not a div dressed as one').toBe('BUTTON');
  expect(result.inStrip).toBe(true);
  expect(result.isManga, 'same shape as the static tabs beside it').toBe(true);
  expect(result.hasInlineStyle).toBe(false);
  expect(result.cursor).toBe('pointer');
  expect(result.label).toContain('Mechanics');
  expect(result.injectedImg, 'tab labels are contributor-submitted').toBe(false);
  expect(result.xss).toBe(false);
});

test('real bug fix: window.escapeHtml (js/admin-core.js) neutralizes markup instead of letting it execute - contributor-controlled strings (author name, ticket chat, QA metadata, raw diff JSON) all pass through it before reaching innerHTML', async ({ page }) => {
  // escapeHtml itself is defined at admin-core.js's top level, not inside
  // the RBAC-gated DOMContentLoaded handler, so it's callable even for a
  // logged-out visitor.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const payload = `<img src=x onerror="window.__xssFired = true">`;
    const container = document.createElement('div');
    container.innerHTML = window.escapeHtml(payload);
    document.body.appendChild(container);
    const renderedText = container.textContent;
    const hasRealImg = !!container.querySelector('img');
    container.remove();
    return { renderedText, hasRealImg, xssFired: window.__xssFired === true };
  });

  expect(result.xssFired).toBe(false);
  expect(result.hasRealImg).toBe(false);
  expect(result.renderedText).toBe('<img src=x onerror="window.__xssFired = true">');
});
