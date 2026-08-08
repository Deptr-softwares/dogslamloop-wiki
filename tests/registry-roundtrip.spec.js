// Guards the highest-blast-radius generated artifact in the repo.
//
// data/navigation.json drives every list on the site - the global sidebar,
// the character roster grid, the systems directory. As of v0.10 it is
// generated from the site_pages table, which means a bug in buildNavigation
// silently rewrites the site's entire navigation.
//
// The protection is a round-trip: feeding the registry back through
// buildNavigation must reproduce the committed file exactly. If the table and
// the file ever disagree, this fails before anything is deployed.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { buildNavigation, validateNavigation } = require('../scripts/fetch-registry.js');
const nav = require('../data/navigation.json');

// Mirrors exactly what 20260808000003_site_pages.sql seeds, derived from the
// same source the migration used.
function registryRowsFromNav(navigation) {
  const rows = [];
  for (const [category, items] of Object.entries(navigation)) {
    let order = 0;
    for (const e of items) {
      const c = e.cms_config || {};
      rows.push({
        page_id: c.pageId, nav_id: e.id, name: e.name, url: e.url, category,
        sort_order: order,
        page_type: c.pageType || 'character', edit_role: c.editRole || 'open',
        is_wip: !!e.isWip, is_ea: !!e.isEA, is_base_only: !!e.isBaseOnly,
        is_missing_media: !!e.isMissingMedia, is_subjective: !!e.isSubjective,
        archetype: e.archetype || null, tier: e.tier || null, release_date: e.releaseDate || null,
        status: 'live',
      });
      order += 10;
    }
  }
  return rows;
}

test('the registry round-trips navigation.json byte-for-byte', () => {
  const regenerated = JSON.stringify(buildNavigation(registryRowsFromNav(nav)), null, 2) + '\n';
  const committed = fs.readFileSync(path.join(__dirname, '..', 'data', 'navigation.json'), 'utf8');
  expect(regenerated).toBe(committed);
});

test('generated navigation passes the same rules validate-navigation.js enforces', () => {
  expect(validateNavigation(buildNavigation(registryRowsFromNav(nav)))).toEqual([]);
});

test('draft and archived pages are kept out of the menus', () => {
  const rows = registryRowsFromNav(nav);
  const liveCount = Object.values(buildNavigation(rows)).flat().length;

  rows[0].status = 'draft';
  rows[1].status = 'archived';
  const reduced = Object.values(buildNavigation(rows)).flat();

  // An archived page keeps its stub as a tombstone so old links resolve, but
  // it should not still be advertised in the sidebar.
  expect(reduced).toHaveLength(liveCount - 2);
  expect(reduced.map(e => e.id)).not.toContain(nav.Characters[0].id);
});

test('categories keep their intended order rather than whatever the query returned', () => {
  const rows = registryRowsFromNav(nav);
  // Reversed input must still produce the site's real category order.
  const out = buildNavigation([...rows].reverse());
  expect(Object.keys(out)).toEqual(['Characters', 'System Pages', 'Site Info', 'Guides']);
});

test('sort_order decides position within a category, not insertion order', () => {
  const rows = registryRowsFromNav(nav).filter(r => r.category === 'Characters');
  const shuffled = [...rows].sort(() => 0.5 - Math.random());
  const out = buildNavigation(shuffled);
  expect(out.Characters.map(e => e.id)).toEqual(nav.Characters.map(e => e.id));
});

test('a page with no optional flags emits none of them', () => {
  // The flags are consumed by truthiness everywhere (js/pagebuilder.js), so
  // omitting is equivalent to false - but emitting `false` for all five on
  // every entry would bloat the file and invite the drift this replaced.
  const out = buildNavigation([{
    page_id: 'x', nav_id: 'X', name: 'X', url: 'characters/X/index.html',
    category: 'Characters', sort_order: 0, page_type: 'character', edit_role: 'open',
    is_wip: false, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false,
    archetype: null, tier: null, release_date: null, status: 'live',
  }]);
  expect(out.Characters[0]).toEqual({
    id: 'X', name: 'X', url: 'characters/X/index.html',
    cms_config: { pageType: 'character', pageId: 'x', editRole: 'open' },
  });
});
