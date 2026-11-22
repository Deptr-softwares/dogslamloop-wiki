// Every custom property a stylesheet reads is defined somewhere the browser can
// see it.
//
// An undefined variable fails without a sound: the declaration computes to its
// inherited or initial value, which looks like somebody chose it. A review before
// v1.3 found four. --input-color-m1 had been dropped by the browser itself,
// behind a comment that closed early in style/ColorCoding.css, so every M1 combo
// chip painted in plain text colour from v0.18 FT1 on; --text-manga (7 uses),
// --accent-red and --bg-primary had never been defined at all.
//
// So the stylesheets are read through the CSSOM, the way the browser parsed
// them: a definition it threw away counts as missing, which reading the file as
// text cannot see. A variable a script sets at runtime (style.setProperty, or a
// style="--x: ..." it writes) counts as defined, found in js/ and the pages by
// name. A var() with a fallback says what happens when it is unset, so it is
// not counted.
//
// Not scope-aware: a variable defined on one selector and read under another
// passes. The claim is "defined somewhere", which is what the four failed.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const filesUnder = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'vendor' || entry.name === 'node_modules' ? [] : filesUnder(full, ext);
  return entry.name.endsWith(ext) ? [full] : [];
});

const SHEETS = filesUnder(path.join(ROOT, 'style'), '.css')
  .map(file => '/' + path.relative(ROOT, file).split(path.sep).join('/'));

// Names scripts and pages define. Comment lines are skipped, so a note that
// mentions a variable does not count as defining it.
function definedOutsideCss() {
  const names = new Set();
  const sources = [
    ...filesUnder(path.join(ROOT, 'js'), '.js'),
    ...fs.readdirSync(ROOT).filter(n => n.endsWith('.html')).map(n => path.join(ROOT, n)),
  ];
  for (const file of sources) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) names.add(m[1]);
      for (const m of line.matchAll(/(--[a-z][\w-]*)\s*:\s*(?:\$\{|url\(|[#\w'"(])/gi)) names.add(m[1]);
    }
  }
  return names;
}

test('every variable a stylesheet reads is defined', async ({ page }) => {
  // A stylesheet opened as a document: same origin, so its rules are readable,
  // and no page script runs to add or remove anything.
  await page.goto('/style/Common.css', { waitUntil: 'domcontentloaded' });

  const read = await page.evaluate(async (sheets) => {
    for (const href of sheets) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      const loaded = new Promise(resolve => { link.onload = () => resolve(true); link.onerror = () => resolve(false); });
      document.head.appendChild(link);
      if (!(await loaded)) return { failed: href };
    }

    const defined = new Set();
    const reads = [];
    const walk = (rules, sheet) => {
      for (const rule of rules) {
        if (rule.style) {
          for (let i = 0; i < rule.style.length; i++) {
            if (rule.style[i].startsWith('--')) defined.add(rule.style[i]);
          }
          // cssText keeps a shorthand written with var() as written; its
          // longhands read back empty while the value waits on the variable.
          for (const m of rule.style.cssText.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
            if (!m[2]) reads.push({ name: m[1], sheet, where: rule.selectorText || rule.keyText || rule.cssText.slice(0, 40) });
          }
        }
        if (rule.cssRules) walk(rule.cssRules, sheet);
      }
    };
    for (const s of document.styleSheets) {
      if (!s.href) continue;
      walk(s.cssRules, new URL(s.href).pathname);
    }
    return { defined: [...defined], reads };
  }, SHEETS);

  expect(read.failed, 'every stylesheet loads').toBeUndefined();
  expect(read.reads.length, 'the walk reached the rules').toBeGreaterThan(100);
  expect(read.defined, 'and saw definitions, the theme tokens among them').toContain('--bg-main');

  const defined = new Set([...read.defined, ...definedOutsideCss()]);
  const missing = read.reads
    .filter(r => !defined.has(r.name))
    .map(r => `${r.name} in ${r.sheet} (${r.where})`);
  expect([...new Set(missing)]).toEqual([]);
});
