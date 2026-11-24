// Every block type the editor can create, with markup in every text field,
// rendered the two ways the site renders blocks: the reader's renderer (and
// the styling pass every page runs after it), and the editor's own block
// list, where a reviewer opens a submission. No submitted markup may run or
// become an element in either.
//
// The blocks come from the editor's own templates, so a type added later is
// covered without anyone coming back here. block-escaping.spec.js names its
// fields by hand; this one does not need to know them.
const { test, expect } = require('@playwright/test');

// Closes an attribute ("'>) before it opens elements, so it escapes a
// value="..." as well as a text node.
const PAYLOAD = '"\'><b data-pwn="1">x</b><img src=x onerror="window.__PWN=(window.__PWN||0)+1">';

// Runs in the page. Each template is taken as the editor makes it and as an
// author fills it in (sample text, a file name where a URL goes), then tried
// with every text field holding the payload at once, and with each field
// holding it alone: a field set to junk can send the renderer down a
// different branch, so one field at a time reaches the ordinary path too. A
// block keeps its type; an empty list of child blocks gets one; a card is
// also tried with its sections on.
function fuzzedBlocks(payload) {
    const realistic = (value, key) => {
        if (typeof value === 'string') {
            if (key === 'type' || value) return value;
            return /src|url|video|image/i.test(key || '') ? 'clip.webp' : 'sample';
        }
        if (Array.isArray(value)) {
            if (!value.length && key === 'content') return [{ type: 'paragraph', content: 'sample' }];
            if (!value.length && key === 'sequence') return ['M1', 'Skill'];
            return value.map(v => realistic(v, null));
        }
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) out[k] = realistic(v, k);
            return out;
        }
        return value;
    };
    // Paths to every string that is not a type.
    const paths = (value, at = []) => {
        if (typeof value === 'string') return at[at.length - 1] === 'type' ? [] : [at];
        if (Array.isArray(value)) return value.flatMap((v, i) => paths(v, [...at, i]));
        if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => paths(v, [...at, k]));
        return [];
    };
    const setAt = (obj, at) => { let o = obj; at.slice(0, -1).forEach(k => { o = o[k]; }); o[at[at.length - 1]] = payload; return obj; };
    const copy = (v) => JSON.parse(JSON.stringify(v));

    // Both as the editor makes it (an image with no file yet takes its own
    // branch) and filled in.
    const fresh = Object.keys(blockTemplates).map(t => window.spawnBlockWithAuthor(t));
    const card = window.spawnBlockWithAuthor('theorybox');
    card.multiSections = true;
    if (typeof window.seedCardSections === 'function') window.seedCardSections(card);
    fresh.push(card);
    const bases = [...fresh, ...fresh.map(b => realistic(b, null))];

    const blocks = [];
    for (const base of bases) {
        const all = copy(base);
        paths(base).forEach(at => setAt(all, at));
        blocks.push(all);
        for (const at of paths(base)) blocks.push(setAt(copy(base), at));
    }
    blocks.push({ type: payload, content: payload });
    return { types: Object.keys(blockTemplates), blocks };
}

async function openEditor(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function'
        && typeof window.generateHTMLForBlocks === 'function', { timeout: 15000 });
    return errors;
}

const fired = (page) => page.evaluate(() => window.__PWN || 0);

test('the reader renderer turns no field of any block into markup', async ({ page }) => {
    const errors = await openEditor(page);
    const out = await page.evaluate(([fuzzSrc, payload]) => {
        const { types, blocks } = new Function(`return (${fuzzSrc})`)()(payload);
        document.body.innerHTML = '<div id="fuzz-host" class="main-content-area"></div>';
        const host = document.getElementById('fuzz-host');
        host.innerHTML = window.generateHTMLForBlocks(blocks);
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
        return {
            types,
            injected: host.querySelectorAll('img[src="x"], [data-pwn]').length,
            shownAsText: host.textContent.split(payload).length - 1,
        };
    }, [fuzzedBlocks.toString(), PAYLOAD]);
    await page.waitForTimeout(500);

    expect(out.types.length, 'the editor offers its block types').toBeGreaterThan(10);
    // The payload reached the page, as text: at least once per type.
    expect(out.shownAsText).toBeGreaterThanOrEqual(out.types.length);
    expect(await fired(page), 'no submitted markup may run').toBe(0);
    expect(out.injected, 'no submitted markup may become an element').toBe(0);
    expect(errors).toEqual([]);
});

test('the editor turns no field of any block into markup', async ({ page }) => {
    const errors = await openEditor(page);
    const out = await page.evaluate(([fuzzSrc, payload]) => {
        const { types, blocks } = new Function(`return (${fuzzSrc})`)()(payload);
        document.body.innerHTML = '<div id="block-host"></div>';
        window.initStrategyBlockBuilder('block-host', blocks);
        (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
        window.renderBlockList();
        const list = document.getElementById('block-list');
        const fields = [...list.querySelectorAll('input, textarea')].filter(el => el.value.includes(payload)).length;
        return {
            cards: list.querySelectorAll('.block-card').length,
            wanted: blocks.length,
            types: types.length,
            injected: list.querySelectorAll('img[src="x"], [data-pwn]').length,
            fields,
            shownAsText: list.textContent.split(payload).length - 1,
        };
    }, [fuzzedBlocks.toString(), PAYLOAD]);
    await page.waitForTimeout(500);

    expect(out.cards, 'every block got a card').toBe(out.wanted);
    // The payload reached the cards: in their fields, and once as the unknown
    // type's name.
    expect(out.fields).toBeGreaterThanOrEqual(out.types);
    expect(out.shownAsText).toBeGreaterThanOrEqual(1);
    expect(await fired(page), 'no submitted markup may run').toBe(0);
    expect(out.injected, 'no submitted markup may become an element').toBe(0);
    expect(errors).toEqual([]);
});
