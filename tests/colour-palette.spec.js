// The palette (C-3c, the owner's pick "Exact", 2026-11-26): the colours the
// stylesheets share are variables, defined once at the top of Common.css, and a
// sheet reads the variable rather than writing the colour again. A colour written
// out twice drifts, and a look or a Site Settings theme can only re-point what is
// a variable. Colours used rarely, like the character and frame-data hues, keep
// their values and are not checked here.
//
// Node only: it reads the sheets in style/, which are hand-written, so it is not
// part of the content gate.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STYLE = path.join(__dirname, '..', 'style');
const read = f => fs.readFileSync(path.join(STYLE, f), 'utf8');

// Comments and strings blanked to spaces, so offsets still match the text.
function mask(text) {
    let out = '';
    for (let i = 0; i < text.length;) {
        if (text[i] === '/' && text[i + 1] === '*') {
            const j = text.indexOf('*/', i + 2);
            const e = j < 0 ? text.length : j + 2;
            out += text.slice(i, e).replace(/[^\n]/g, ' ');
            i = e;
            continue;
        }
        if (text[i] === '"' || text[i] === "'") {
            const q = text[i];
            let j = i + 1;
            while (j < text.length && text[j] !== q) { if (text[j] === '\\') j++; j++; }
            out += ' '.repeat(j + 1 - i);
            i = j + 1;
            continue;
        }
        out += text[i++];
    }
    return out;
}

// One spelling per colour: lower case, no spaces, #rgb when it is one, rgb() as hex.
const hex2 = n => n.toString(16).padStart(2, '0');
function canon(x) {
    let v = x.toLowerCase().replace(/\s+/g, '');
    if (v === 'black') return '#000';
    if (v === 'white') return '#fff';
    let m = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (m) v = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
    m = v.match(/^rgba?\((\d+),(\d+),(\d+)(?:,(?:1|1\.0+))?\)$/);
    if (m) v = `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
    m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
    if (m && m.slice(1).every(p => p[0] === p[1])) v = `#${m[1][0]}${m[2][0]}${m[3][0]}`;
    return v.replace(/,\./g, ',0.');
}

// The palette, as Common.css states it: the :root block under its comment.
function palette() {
    const common = read('Common.css');
    const at = common.indexOf('/* The palette:');
    const block = common.slice(at, common.indexOf('}', at));
    return [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => ({ name: m[1], value: canon(m[2]) }));
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|(?<![-\w])(?:black|white)(?![-\w])/g;

// Every place a sheet writes one of these colours, apart from the palette's own
// block, a custom property named after a palette colour (the staff pages' Classic
// map in editor.css, a theme's map in Common.css) and a @property's initial-value,
// which cannot read a variable.
function literals(names, values) {
    const found = [];
    for (const f of fs.readdirSync(STYLE).filter(f => f.endsWith('.css'))) {
        const text = read(f);
        const m = mask(text);
        const skip = [...m.matchAll(/@property[^{]*\{[^}]*\}/g)].map(x => [x.index, x.index + x[0].length]);
        if (f === 'Common.css') {
            const at = text.indexOf('/* The palette:');
            skip.push([at, text.indexOf('}', at)]);
        }
        for (const x of m.matchAll(COLOUR)) {
            if (!values.has(canon(x[0]))) continue;
            if (skip.some(([a, b]) => x.index >= a && x.index < b)) continue;
            const decl = m.slice(Math.max(m.lastIndexOf(';', x.index), m.lastIndexOf('{', x.index)) + 1, x.index);
            const own = decl.match(/^\s*(--[\w-]+)\s*:/);
            if (own && names.has(own[1])) continue;
            // A selector, not a value (an #id that happens to spell a colour).
            if (m.lastIndexOf('}', x.index) > m.lastIndexOf('{', x.index) && !decl.includes(':')) continue;
            found.push(`style/${f}:${text.slice(0, x.index).split('\n').length} ${x[0]}`);
        }
    }
    return found;
}

test('the palette names each shared colour once, at the top of Common.css', () => {
    const list = palette();
    expect(list.length, 'the palette block was not found under its comment').toBeGreaterThan(0);
    const names = list.map(p => p.name);
    const values = list.map(p => p.value);
    expect(new Set(names).size, 'a name is defined twice').toBe(names.length);
    expect(new Set(values).size, 'a colour has two names').toBe(values.length);
});

test('no stylesheet writes a palette colour as a literal', () => {
    const list = palette();
    const found = literals(new Set(list.map(p => p.name)), new Set(list.map(p => p.value)));
    expect(found, 'read the palette variable instead (Common.css, "The palette")').toEqual([]);
});
