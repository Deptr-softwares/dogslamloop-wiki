// Coverage for v0.10's FAQ and credits editing.
//
// data/faq.json and systems/collaborators/collaborators_data.json were static
// files, so changing an answer or adding a contributor meant a commit. They
// are now generated from site_faq and site_collaborators. The runtime still
// fetches plain JSON, so the generated shapes must match what
// js/home_widgets.js and the collaborators page already read - this is a
// write-back, not a redesign, and the round-trip below is what proves it.
const { test, expect } = require('@playwright/test');

const { buildFaq, buildCollaborators } = require('../scripts/fetch-content.js');
const faq = require('../data/faq.json');
const collaborators = require('../systems/collaborators/collaborators_data.json');

function faqRows(data) {
  return data.faqs.map((f, i) => ({ question: f.question, paragraphs: f.paragraphs, sort_order: i * 10 }));
}

function collaboratorRows(data) {
  return [
    ...data.mainContributors.map((c, i) => ({
      name: c.name, role: c.role, description: c.description, avatar: c.avatar,
      badge_type: c.badgeType, is_lead: !!c.isLead, links: c.links, section: 'main', sort_order: i * 10,
    })),
    ...data.specialThanks.map((c, i) => ({
      name: c.name, role: null, description: c.reason, avatar: null,
      badge_type: null, is_lead: false, links: [], section: 'thanks', sort_order: i * 10,
    })),
  ];
}

test('the FAQ round-trips its committed JSON exactly', () => {
  expect(buildFaq(faqRows(faq))).toEqual(faq);
});

test('collaborators round-trip their committed JSON exactly', () => {
  expect(buildCollaborators(collaboratorRows(collaborators))).toEqual(collaborators);
});

test('the two collaborator sections keep their different shapes', () => {
  // mainContributors are full cards, specialThanks are {name, reason} lines.
  // Normalising them into one shape would mean teaching the collaborators
  // page a new format for no benefit.
  const out = buildCollaborators(collaboratorRows(collaborators));
  expect(Object.keys(out.mainContributors[0]).sort()).toEqual(
    ['avatar', 'badgeType', 'description', 'isLead', 'links', 'name', 'role']
  );
  expect(Object.keys(out.specialThanks[0]).sort()).toEqual(['name', 'reason']);
});

test('sort_order decides order, not the order rows arrive in', () => {
  const shuffled = [...faqRows(faq)].reverse();
  expect(buildFaq(shuffled).faqs.map(f => f.question)).toEqual(faq.faqs.map(f => f.question));
});

test('the homepage credits render from the same source as the collaborators page', async ({ page }) => {
  // index.html used to carry a hardcoded <ul> duplicating this data by hand,
  // and the two had already drifted - the hardcoded list credited people the
  // JSON did not, and vice versa.
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#credits-dynamic-list .credit-name')).map(el => el.textContent.trim()));

  expect(names.length).toBeGreaterThan(0);
  // Everyone in the shared file should appear, and nobody else.
  const expected = [
    ...collaborators.mainContributors.map(c => `@${c.name}`),
    ...collaborators.specialThanks.map(c => `@${c.name}`),
  ];
  expect(names).toEqual(expected);
});

test('credit names are escaped', async ({ page }) => {
  // Trailing * matters: fetchJson appends a cache-busting query string, so a
  // pattern without it silently never matches and the real data loads.
  await page.route('**/collaborators_data.json*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      mainContributors: [{ name: '<img src=x onerror="window.__xss=1">', role: 'Tester', links: [] }],
      specialThanks: [],
    }),
  }));

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const html = await page.locator('#credits-dynamic-list').innerHTML();
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img');
});
