// Every stylesheet's rules sit inside a cascade layer, and the order of the layers
// is stated once, at the top of style/Common.css (docs/looks.md).
//
// A rule outside every layer wins over every layered rule, whatever its selector,
// so one sheet added without its wrapper would quietly win every tie on every page
// that loads it. And a layer's place is set where its name first appears: a sheet
// that named a layer before Common.css's statement could reorder them. So each
// sheet is parsed the way the browser parses it, and every page kind's first
// stylesheet is Common.css.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PAGE_STYLES } = require('../scripts/page-scripts.js');

const STYLE = path.join(__dirname, '..', 'style');
const sheets = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory()
  ? sheets(path.join(dir, entry.name), `${prefix}${entry.name}/`)
  : entry.name.endsWith('.css') ? [`${prefix}${entry.name}`] : []));

test('every rule in every stylesheet is inside a layer, and only Common.css orders the layers', async ({ page }) => {
  const files = sheets(STYLE);
  const texts = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(STYLE, f), 'utf8')]));
  const parsed = await page.evaluate((texts) => {
    const out = {};
    for (const [file, text] of Object.entries(texts)) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      out[file] = [...sheet.cssRules].map(rule => ({
        kind: rule.constructor.name,
        names: rule.nameList ? [...rule.nameList] : (rule.name !== undefined && rule.constructor.name === 'CSSLayerBlockRule' ? [rule.name] : []),
        inside: rule.cssRules ? rule.cssRules.length : 0,
        text: rule.cssText.slice(0, 60),
      }));
    }
    return out;
  }, texts);

  const outside = [];
  const used = new Set();
  const statements = [];
  for (const [file, rules] of Object.entries(parsed)) {
    rules.forEach((rule, i) => {
      if (rule.kind === 'CSSLayerStatementRule') statements.push({ file, i, names: rule.names });
      else if (rule.kind === 'CSSLayerBlockRule') rule.names.forEach(n => used.add(n));
      else outside.push(`${file}: ${rule.text}`);
    });
  }
  expect(outside, 'rules outside every layer').toEqual([]);
  expect(statements.map(s => `${s.file} rule ${s.i}`), 'one statement of the order, first in Common.css').toEqual(['Common.css rule 0']);
  const order = statements[0].names;
  expect([...used].filter(n => !order.includes(n)), 'every layer a sheet uses is in the statement').toEqual([]);
  expect(parsed['Common.css'].filter(r => r.kind === 'CSSLayerBlockRule').every(r => r.inside > 0), 'Common.css\'s own rules are in a layer too').toBe(true);
});

test('every kind of page loads Common.css first, so the order is stated before any layer is used', () => {
  const first = Object.fromEntries(Object.entries(PAGE_STYLES).map(([kind, list]) => [kind, list[0]]));
  const notFirst = Object.entries(first).filter(([, sheet]) => sheet !== 'Common.css').map(([kind, sheet]) => `${kind}: ${sheet}`);
  expect(notFirst).toEqual([]);
});
