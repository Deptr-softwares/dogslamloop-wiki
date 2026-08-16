// Every authored block has to look the same on every page type that renders
// one (owner-reported, 2026-08-15: "tools pages are missing some styling
// sheets, so some block or elements won't show up").
//
// The cause was a block split across two stylesheets. .combo-container and
// .combo-meta-group lived in Layout.css, which every page loads;
// .combo-node, .combo-arrow, .combo-damage and .combo-note lived in
// FrameData.css, which ONLY CHARACTER PAGES LOAD. So a combo authored on a
// guide, a gallery or a tool page rendered as a plain row of words. Same for
// .strategy-title.
//
// The first test is the durable one: it re-runs the audit rather than checking
// the five classes that happened to be wrong, so the next block whose styling
// drifts into a page-type-specific sheet fails here instead of being reported
// months later.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STYLE_DIR = path.join(__dirname, '..', 'style');
const ROOT = path.join(__dirname, '..');

// The stylesheets every page type that renders authored blocks loads. Derived
// below from the generated stubs rather than written out, so adding a sheet to
// the generator widens this automatically.
function universalSheets() {
    const pages = [
        'characters/Boomcat/index.html',
        'systems/hud/index.html',
        'others/emotes/index.html',
        'tools/free-submit-tier-list/index.html',
    ];

    const sets = pages.map(p => new Set(
        (fs.readFileSync(path.join(ROOT, p), 'utf8').match(/style\/([A-Za-z_-]+)\.css/g) || [])
            .map(m => m.replace(/^style\//, ''))
    ));

    return [...sets[0]].filter(sheet => sets.every(s => s.has(sheet)));
}

test('every authored block class is styled by a stylesheet all page types load', () => {
    const universal = universalSheets();
    expect(universal.length, 'the page types share no stylesheets at all').toBeGreaterThan(3);

    const sheets = fs.readdirSync(STYLE_DIR)
        .filter(f => f.endsWith('.css'))
        .map(f => ({ name: f, css: fs.readFileSync(path.join(STYLE_DIR, f), 'utf8') }));

    // The renderer that produces authored blocks on every page type.
    const src = fs.readFileSync(path.join(ROOT, 'js', 'description.js'), 'utf8');
    const body = src.slice(src.indexOf('generateHTMLForBlocks'));

    const classes = new Set();
    for (const attr of body.match(/class="[^"]+"/g) || []) {
        for (const cls of attr.slice(7, -1).split(/\s+/)) {
            if (cls && !cls.includes('$')) classes.add(cls);
        }
    }
    expect(classes.size, 'found no block classes - the renderer moved').toBeGreaterThan(20);

    const stranded = [];
    for (const cls of classes) {
        const pattern = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
        const definedIn = sheets.filter(s => pattern.test(s.css)).map(s => s.name);

        // A class nothing styles is fine - plenty are hooks for JS or for a
        // parent selector. A class styled ONLY by a sheet some page types do
        // not load is the bug.
        if (definedIn.length && !definedIn.some(name => universal.includes(name))) {
            stranded.push(`.${cls} -> only in ${definedIn.join(', ')}`);
        }
    }

    expect(stranded, 'these blocks render unstyled off a character page').toEqual([]);
});

// The behavioural half. The audit above reads files; this renders the thing.
test('a combo block looks the same on a tool page as on a character page', async ({ page }) => {
    const measure = async (url) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return page.evaluate(() => {
            const host = document.createElement('div');
            host.innerHTML = '<div class="combo-container">'
                + '<span class="combo-node">M1</span>'
                + '<span class="combo-note">jump cancel</span>'
                + '<span class="combo-damage">120</span>'
                + '</div><h4 class="strategy-title">Strategy</h4>';
            (document.querySelector('main') || document.body).appendChild(host);

            const read = (sel) => {
                const cs = getComputedStyle(host.querySelector(sel));
                return `${cs.fontFamily}|${cs.color}|${cs.borderBottomWidth}|${cs.padding}`;
            };
            return {
                node: read('.combo-node'),
                note: read('.combo-note'),
                damage: read('.combo-damage'),
                // Colour is deliberately left out of the title's signature.
                // .strategy-title is var(--accent-blue), and js/site_meta.js
                // re-points that per character - so a character page really
                // should render it in that character's colour and a tool page
                // in the site default. Comparing it would pin a bug as a fix.
                title: read('.strategy-title').split('|').filter((_, i) => i !== 1).join('|'),
                titleColor: getComputedStyle(host.querySelector('.strategy-title')).color,
                accent: getComputedStyle(document.documentElement)
                    .getPropertyValue('--accent-blue').trim(),
                // What the stylesheet declares combo steps should be set in,
                // so the assertion below reads the design rather than a name.
                mono: getComputedStyle(document.documentElement)
                    .getPropertyValue('--text-mono').trim(),
            };
        });
    };

    const character = await measure('/characters/Boomcat/index.html');
    const tool = await measure('/tools/free-submit-tier-list/index.html');
    const system = await measure('/systems/hud/index.html');

    // Asserted as agreement between page types, which is the actual claim.
    const shape = ({ titleColor, accent, ...rest }) => rest;
    expect(shape(tool)).toEqual(shape(character));
    expect(shape(system)).toEqual(shape(character));

    // ...and that the agreement is not "all four are unstyled everywhere".
    //
    // Compared against the --text-mono custom property rather than a font
    // name. This pinned 'CC-Wild-Words' and broke when v0.15 made combo steps
    // monospace - a deliberate design change, not a styling regression, which
    // is exactly what a literal font name cannot tell apart. The claim is that
    // the stylesheet applied at all, so read what the stylesheet declares.
    expect(character.node.split('|')[0]).toBe(character.mono);

    // Padding, not border width. A step used to carry its own border and this
    // asserted one existed; v0.15 moved the border to the surrounding
    // .combo-block, because one box is the design and a border per step drew a
    // box inside a box. Padding is what still proves the rule applied.
    expect(character.node.split('|')[3], 'the step is padded, so the rule applied')
        .not.toBe('0px');

    // The title is styled on every page type; only its accent differs, and it
    // differs because the page's own accent does.
    for (const page of [character, tool, system]) {
        expect(page.title).toContain('Finger-Paint');
        expect(page.titleColor).not.toBe('rgb(0, 0, 0)');
    }
    expect(character.accent, 'a character page re-points the accent to its own colour')
        .not.toBe(tool.accent);
});
