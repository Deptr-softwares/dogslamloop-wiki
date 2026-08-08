// Coverage for the v0.9 posts system (blog + hotfix notes).
//
// Posts store the same block array the wiki uses, so rendering goes through
// js/description.js's generateHTMLForBlocks. The tests that matter most here
// are the ones covering what that function does NOT do for you: binding
// callout tooltips and arming lazy media. Skipping those steps produces dead
// callout buttons and videos that never load - visible only by clicking, so
// easy to ship broken.
const { test, expect } = require('@playwright/test');

const SAMPLE_BLOCKS = [
  { type: 'heading', size: 'h3', content: 'What changed', align: 'left' },
  { type: 'paragraph', content: 'Vessel got a frame data pass.', align: 'left' },
];

const POST = {
  id: 'p-1', kind: 'blog', status: 'published',
  title: 'A first post', slug: 'a-first-post',
  summary: 'Testing the posts system.',
  content: SAMPLE_BLOCKS, author_name: 'Deptr',
  published_at: '2026-08-08T00:00:00Z',
};

// Mocks the query builder chain posts.js uses:
//   .from().select().eq().eq().order().limit()
// The chain is awaitable at the end of any path, matching supabase-js.
async function mockPosts(page, rows) {
  await page.addInitScript((rows) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table !== 'site_posts') return origFrom(table);
              const filters = {};
              const chain = {
                select() { return chain; },
                eq(col, val) { filters[col] = val; return chain; },
                order() { return chain; },
                limit(n) { filters.__limit = n; return chain; },
                then(resolve, reject) {
                  let data = rows.filter(r => r.status === 'published');
                  if (filters.kind) data = data.filter(r => r.kind === filters.kind);
                  if (filters.slug) data = data.filter(r => r.slug === filters.slug);
                  if (filters.__limit) data = data.slice(0, filters.__limit);
                  window.__lastPostQuery = { ...filters };
                  return Promise.resolve({ data, error: null }).then(resolve, reject);
                },
              };
              return chain;
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, rows);
}

test('blog.html lists published posts', async ({ page }) => {
  await mockPosts(page, [POST]);
  await page.goto('/blog.html', { waitUntil: 'networkidle' });

  await expect(page.locator('.post-card-title')).toHaveText('A first post');
  await expect(page.locator('.post-card-summary')).toContainText('Testing the posts system');
  await expect(page.locator('.post-card-link')).toHaveAttribute('href', /blog\.html\?post=a-first-post/);
});

test('blog.html renders a single post body from its blocks', async ({ page }) => {
  await mockPosts(page, [POST]);
  await page.goto('/blog.html?post=a-first-post', { waitUntil: 'networkidle' });

  await expect(page.locator('.post-title')).toHaveText('A first post');
  // Proves the block renderer actually ran, rather than the raw array being
  // dumped or skipped.
  await expect(page.locator('.post-body h3')).toHaveText('What changed');
  await expect(page.locator('.post-body')).toContainText('Vessel got a frame data pass');
  // The generic page heading would duplicate the post's own title.
  await expect(page.locator('#blog-page-header')).toBeHidden();
});

test('blog.html falls back to the list for an unknown slug instead of erroring', async ({ page }) => {
  await mockPosts(page, [POST]);
  await page.goto('/blog.html?post=does-not-exist', { waitUntil: 'networkidle' });

  await expect(page.locator('.wiki-section-empty')).toContainText('could not be found');
  await expect(page.locator('.post-card-title')).toHaveText('A first post');
});

test('drafts are never listed', async ({ page }) => {
  await mockPosts(page, [
    POST,
    { ...POST, id: 'p-2', slug: 'secret-draft', title: 'Unfinished draft', status: 'draft' },
  ]);
  await page.goto('/blog.html', { waitUntil: 'networkidle' });

  await expect(page.locator('.post-card-title')).toHaveCount(1);
  await expect(page.locator('#blog-content')).not.toContainText('Unfinished draft');
  // The query must filter server-side too, not just in rendering.
  const q = await page.evaluate(() => window.__lastPostQuery);
  expect(q.status).toBe('published');
});

test('post metadata is escaped', async ({ page }) => {
  await mockPosts(page, [{
    ...POST,
    title: '<img src=x onerror="window.__xss=1">',
    summary: '<script>window.__xss2=1</script>',
    author_name: '<b>not bold</b>',
  }]);

  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto('/blog.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.evaluate(() => window.__xss2)).toBeUndefined();
  const html = await page.locator('#blog-content').innerHTML();
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img');
});

test('callout blocks in a post get their tooltip bound', async ({ page }) => {
  // generateHTMLForBlocks emits the callout button but does NOT bind it -
  // posts.js has to reproduce populateTextSection's binding step or the
  // button renders and does nothing.
  await mockPosts(page, [{
    ...POST,
    content: [{ type: 'callout', intent: 'tip', title: 'Tip', content: 'Hidden detail', align: 'left' }],
  }]);
  await page.goto('/blog.html?post=a-first-post', { waitUntil: 'networkidle' });

  const btn = page.locator('.inline-callout-btn').first();
  await expect(btn).toBeAttached();

  // bindTooltip's mouseenter handler calls initTooltip(), which creates
  // #wiki-frame-tooltip, then fills it and sets display:block. Asserting on
  // that specific element is what makes this test real - an earlier version
  // counted tooltip-ish elements before/after and passed even with the
  // binding deleted.
  const result = await page.evaluate(() => {
    const existedBefore = !!document.getElementById('wiki-frame-tooltip');
    document.querySelector('.inline-callout-btn')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const tip = document.getElementById('wiki-frame-tooltip');
    return {
      existedBefore,
      appeared: !!tip,
      visible: tip ? tip.style.display === 'block' : false,
      text: tip ? tip.textContent : '',
    };
  });

  expect(result.existedBefore).toBe(false);
  expect(result.appeared).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.text).toContain('Hidden detail');
});

test('the update log renders hotfix notes above the versioned entries', async ({ page }) => {
  await mockPosts(page, [
    { ...POST, id: 'h-1', kind: 'hotfix', slug: 'quick-fix', title: 'Fixed a broken image' },
  ]);
  await page.goto('/systems/updatelog/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#hotfix-container .update-title')).toHaveText('Fixed a broken image');
  await expect(page.locator('#hotfix-container .badge-hotfix')).toBeVisible();

  // Hotfix notes must not displace the real versioned changelog.
  await expect(page.locator('#changelog-container')).toContainText('Beta v0.8');
});

test('the update log stays intact when there are no hotfix notes', async ({ page }) => {
  await mockPosts(page, []);
  await page.goto('/systems/updatelog/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#hotfix-container')).toBeEmpty();
  await expect(page.locator('#changelog-container')).toContainText('Beta v0.8');
});

test('the homepage shows the latest posts', async ({ page }) => {
  await mockPosts(page, [POST]);
  await page.goto('/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#home-blog-posts .post-card-title')).toHaveText('A first post');
  const q = await page.evaluate(() => window.__lastPostQuery);
  expect(q.kind).toBe('blog');
});

test('post-editor.html denies access to non-admins', async ({ page }) => {
  // The page writes directly to site_posts with no review step, so its gate
  // matters more than a read-only page's.
  await page.goto('/post-editor.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.access-denied-screen')).toHaveCount(1, { timeout: 5000 });
});

test('slugify produces url-safe slugs and survives awkward titles', async ({ page }) => {
  await page.goto('/post-editor.html', { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(() => ({
    simple: window.slugify('Frame Data Pass on Vessel'),
    punctuation: window.slugify("Vessel's 5H -- what changed?!"),
    collapsing: window.slugify('  Multiple   spaces  '),
    unicode: window.slugify('Héllo Wörld'),
    empty: window.slugify(''),
  }));

  expect(results.simple).toBe('frame-data-pass-on-vessel');
  expect(results.punctuation).toBe('vessels-5h-what-changed');
  expect(results.collapsing).toBe('multiple-spaces');
  // Accented characters are stripped rather than transliterated - acceptable
  // for an owner-editable field that is shown and can be corrected by hand.
  expect(results.unicode).toBe('hllo-wrld');
  expect(results.empty).toBe('');
});
