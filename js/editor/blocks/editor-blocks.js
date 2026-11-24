/**
 * The Block editor: the Workspace's list of Blocks and their forms, the format
 * toolbar, the colour popups, selection, copy and paste, and dragging to reorder.
 * edit.html, owner.html, post-editor.html and tier-editor.html load it.
 * @since v0.4, as part of editor.js
 * @touches currentStrategyBlocks, window.activeAccordionPath, blockTemplates,
 *   updateLivePreview (editor-sync.js), customConfirm (editor-dialogs.js),
 *   escapeHtml and safeColor (site_utils.js), localStorage dsl_recent_colors
 * @watch every contributor value here reaches innerHTML, most of them inside an
 *   attribute, so each one goes through escapeHtml. initStrategyBlockBuilder is
 *   one closure on purpose: its parts share its local variables.
 * @see docs/block-editor.md
 */

// Colour presets. Built when drawn, never while this file parses: FRAME_COLORS
// and WINDOW_COLORS are read from CSS variables that may not be applied yet.

// The neutral choices, apart from two dozen character colours.
const BASIC_PRESET_COLORS = [
    'hsl(3, 93%, 63%)', 'hsl(217, 91%, 60%)', 'hsl(127, 59%, 58%)', 'hsl(261, 86%, 86%)',
    'hsl(39, 100%, 50%)', 'hsl(180, 100%, 50%)', 'hsl(0, 0%, 50%)',
];

// Allowlisted, not escaped: these land in a style attribute, where an escaped
// value can still close the declaration and add its own.
const SAFE_CSS_COLOR = /^(#[0-9a-f]{3,8}|(?:hsla?|rgba?)\([0-9%.,\s/-]+\))$/i;

/**
 * The colour popup's preset groups: the basic seven, the characters' colours
 * and the frame-data colours.
 * @since v0.13
 */
function colorPresetGroups() {
    const fromDictionary = (dict) => Object.entries(dict || {}).map(([key, color]) => ({
        color: String(color || '').trim(),
        // A colour with no label still shows, under its key.
        label: (window.FRAME_COLOR_LABELS || {})[key] || key,
    }));

    const groups = [
        { label: 'Basic', swatches: BASIC_PRESET_COLORS.map(color => ({ color, label: color })) },
        {
            label: 'Characters',
            swatches: Object.entries(window.CHARACTER_COLORS || {})
                .map(([label, color]) => ({ color: String(color || '').trim(), label })),
        },
        {
            label: 'Frame types',
            swatches: [
                ...fromDictionary(window.FRAME_COLORS),
                ...fromDictionary(window.WINDOW_COLORS),
            ],
        },
    ];

    // A missing CSS variable reads as "", which would draw a swatch that does nothing.
    return groups
        .map(group => ({ ...group, swatches: group.swatches.filter(s => SAFE_CSS_COLOR.test(s.color)) }))
        .filter(group => group.swatches.length > 0);
}


// Gradient presets for [multicolor=]: two-stop pairs, plain hex so SAFE_CSS_COLOR
// passes them. More stops are the custom gradient's job, or typed by hand.
const GRADIENT_PRESETS = [
    { label: 'Cursed',   from: '#a855f7', to: '#22d3ee' },
    { label: 'Fire',     from: '#fbbf24', to: '#dc2626' },
    { label: 'Ice',      from: '#e0f2fe', to: '#2563eb' },
    { label: 'Toxic',    from: '#a3e635', to: '#15803d' },
    { label: 'Sunset',   from: '#fb923c', to: '#a855f7' },
    { label: 'Steel',    from: '#e5e7eb', to: '#4b5563' },
    { label: 'Blood',    from: '#ef4444', to: '#450a0a' },
    { label: 'Rainbow',  from: '#ef4444', to: '#3b82f6' },
];

/**
 * The gradient presets' row in a colour popup.
 * @since v0.19
 */
function gradientPresetsHTML() {
    const usable = GRADIENT_PRESETS.filter(g => SAFE_CSS_COLOR.test(g.from) && SAFE_CSS_COLOR.test(g.to));
    if (!usable.length) return '';

    // The attribute holds the tag's own value, so what is clicked is what is written.
    return `
                        <div class="format-color-popup-label">Gradients</div>
                        <div class="format-color-presets-row">
                            ${usable.map(g => `<button class="gradient-preset-btn"
                                data-gradient="${window.escapeHtml(`${g.from},${g.to}`)}"
                                style="background: linear-gradient(90deg, ${g.from}, ${g.to});"
                                title="${window.escapeHtml(`${g.label} gradient`)}"></button>`).join('')}
                        </div>`;
}

// A custom gradient of two to six stops, each set on the popup's picker. Shut
// until its heading is clicked: open, it pushed the presets under the tab
// buttons on a short screen.
const GRADIENT_MAX_STOPS = 6;
const GRADIENT_START = ['#a855f7', '#22d3ee'];

/**
 * The custom gradient's markup, and wireGradientBuilder below, which returns
 * the hook initColorPicker calls as the picker moves.
 * @since v1.1
 */
function gradientBuilderHTML() {
    return `
                        <button type="button" class="cp-label cp-gradient-toggle" data-gradient-toggle aria-expanded="false">Custom gradient <span aria-hidden="true">▸</span></button>
                        <div class="cp-gradient" data-gradient-builder hidden>
                            <div class="cp-gradient-stops" data-gradient-stops></div>
                            <div class="cp-gradient-strip" data-gradient-strip></div>
                            <button type="button" class="btn-sys btn-sys-green cp-apply" data-gradient-use>USE GRADIENT</button>
                        </div>`;
}

function wireGradientBuilder(container, onUse) {
    const root = container.querySelector('[data-gradient-builder]');
    const toggle = container.querySelector('[data-gradient-toggle]');
    const hexField = container.querySelector('#cp-hex');
    if (!root || !toggle || !hexField) return null;

    function setOpen(open) {
        root.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelector('span').textContent = open ? '▾' : '▸';
    }
    toggle.addEventListener('click', () => setOpen(root.hidden));

    const box = root.querySelector('[data-gradient-stops]');
    const strip = root.querySelector('[data-gradient-strip]');
    let stops = GRADIENT_START.slice();
    let active = -1;

    // Through the CSSOM, and only real colours: a stop can come from page data, and
    // "red), url(...)" would be a second background layer.
    const usable = (c) => !!window.safeColor(c) && CSS.supports('color', c);

    function paintStrip() {
        strip.style.background = '';
        strip.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    }

    function draw() {
        box.innerHTML = stops.map((_, i) => `
                <span class="cp-gradient-stop-wrap">
                    <button type="button" class="cp-gradient-stop${i === active ? ' is-active' : ''}" data-stop="${i}"
                            aria-label="Gradient color ${i + 1}" aria-pressed="${i === active}"></button>${stops.length > 2 ? `
                    <button type="button" class="cp-gradient-stop-remove" data-stop-remove="${i}"
                            aria-label="Remove gradient color ${i + 1}">✕</button>` : ''}
                </span>`).join('')
            + (stops.length < GRADIENT_MAX_STOPS
                ? '<button type="button" class="cp-gradient-add" data-stop-add aria-label="Add a color" title="Add a color">＋</button>'
                : '');
        box.querySelectorAll('[data-stop]').forEach((chip, i) => { chip.style.background = stops[i]; });
        paintStrip();
    }

    function edit(i) {
        active = i;
        hexField.value = stops[i];
        hexField.dispatchEvent(new Event('input'));
        draw();
    }

    root.addEventListener('click', (e) => {
        // A click here redraws the chips, so the "clicked outside?" listeners would see
        // a target no longer in the page and close the popup.
        e.stopPropagation();
        const chip = e.target.closest('[data-stop]');
        if (chip) { edit(Number(chip.getAttribute('data-stop'))); return; }
        const remove = e.target.closest('[data-stop-remove]');
        if (remove) {
            stops.splice(Number(remove.getAttribute('data-stop-remove')), 1);
            active = -1;
            draw();
            return;
        }
        if (e.target.closest('[data-stop-add]')) {
            stops.push(stops[stops.length - 1]);
            edit(stops.length - 1);
            return;
        }
        if (e.target.closest('[data-gradient-use]')) onUse(stops.slice());
    });

    draw();
    return {
        pickerChanged(hex) {
            if (active < 0 || !usable(hex)) return;
            stops[active] = hex;
            const chip = box.querySelector(`[data-stop="${active}"]`);
            if (chip) chip.style.background = hex;
            paintStrip();
        },
        // A word's own gradient, shown open, or the default, shut.
        load(colors) {
            const good = Array.isArray(colors) ? colors.filter(usable).slice(0, GRADIENT_MAX_STOPS) : [];
            stops = good.length >= 2 ? good : GRADIENT_START.slice();
            active = -1;
            draw();
            setOpen(good.length >= 2);
        },
    };
}

// The visual colour picker, in place of <input type="color">, which opens the
// system's own dialog and can take the text selection the toolbar is wrapping.
// Drawn with CSS gradients; its colour goes through applyFormat like a preset's.

function hsvToHex(h, s, v) {
    const f = (n) => {
        const k = (n + h / 60) % 6;
        const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
        return Math.round(x * 255).toString(16).padStart(2, '0');
    };
    return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex) {
    const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
    if (!match) return null;

    let digits = match[1];
    if (digits.length === 3) digits = digits.split('').map(c => c + c).join('');

    const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * A saturation and brightness square, a hue slider and a hex field in
 * `container`. onPick gets the colour chosen; onChange (optional) hears every
 * colour as the picker moves.
 * @since v0.14
 * @watch it looks only inside `container`, so two popups can repeat its ids
 */
function initColorPicker(container, onPick, onChange) {
    const surface = container.querySelector('#cp-surface');
    const surfaceThumb = container.querySelector('#cp-surface-thumb');
    const hue = container.querySelector('#cp-hue');
    const hueThumb = container.querySelector('#cp-hue-thumb');
    const preview = container.querySelector('#cp-preview');
    const hexField = container.querySelector('#cp-hex');
    const apply = container.querySelector('#cp-apply');

    if (!surface || !hue || !hexField || !apply) return;

    const state = { h: 0, s: 0, v: 1 };

    function paint(updateField = true) {
        const hex = hsvToHex(state.h, state.s, state.v);

        surface.style.backgroundColor = `hsl(${state.h}, 100%, 50%)`;
        surfaceThumb.style.left = `${state.s * 100}%`;
        surfaceThumb.style.top = `${(1 - state.v) * 100}%`;
        surfaceThumb.style.backgroundColor = hex;

        hueThumb.style.left = `${(state.h / 360) * 100}%`;
        hue.setAttribute('aria-valuenow', String(Math.round(state.h)));

        preview.style.backgroundColor = hex;
        if (updateField) hexField.value = hex;
        if (onChange) onChange(hex);
    }

    // Pointer events, so a stylus and a finger work too. Pointer capture keeps a
    // drag alive once the pointer leaves the small square.
    function drag(el, onMove) {
        const handle = (event) => {
            const rect = el.getBoundingClientRect();
            // A hidden popup measures 0x0, and 0/0 would make the hex "#NaNNaNNaN".
            if (!rect.width || !rect.height) return;

            const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
            onMove(x, y);
            paint();
        };

        el.addEventListener('pointerdown', (event) => {
            // The same guard the toolbar uses to keep the text selection.
            event.preventDefault();

            // The colour first: setPointerCapture throws for a pointer that is not active,
            // and that would end the handler before any colour was applied.
            handle(event);
            try { el.setPointerCapture(event.pointerId); } catch (e) { /* a click, not a drag */ }
        });
        el.addEventListener('pointermove', (event) => {
            if (el.hasPointerCapture && el.hasPointerCapture(event.pointerId)) handle(event);
        });
        el.addEventListener('pointerup', (event) => {
            try { el.releasePointerCapture(event.pointerId); } catch (e) { /* never captured */ }
        });
    }

    drag(surface, (x, y) => { state.s = x; state.v = 1 - y; });
    drag(hue, (x) => { state.h = x * 360; });

    // Without arrow keys the hue could not be reached without a pointer.
    hue.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') state.h = (state.h - step + 360) % 360;
        else if (event.key === 'ArrowRight') state.h = (state.h + step) % 360;
        else return;
        event.preventDefault();
        paint();
    });

    // A pasted hex drives the square rather than going around it.
    hexField.addEventListener('input', () => {
        const parsed = hexToHsv(hexField.value);
        if (!parsed) return;
        Object.assign(state, parsed);
        paint(false);
    });

    hexField.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        apply.click();
    });

    apply.addEventListener('click', () => {
        const hex = hexToHsv(hexField.value) ? hexField.value.trim() : hsvToHex(state.h, state.s, state.v);
        onPick(hex.startsWith('#') ? hex : `#${hex}`);
    });

    paint();
}

/**
 * The colour popup's preset groups as swatches. `afterFirst` goes between the
 * first group and the second (the gradient row, see its caller).
 * @since v0.13
 */
function colorPresetsHTML(afterFirst = '') {
    return colorPresetGroups().map((group, i) => `
                        <div class="format-color-popup-label">${window.escapeHtml(group.label)}</div>
                        <div class="format-color-presets-row">
                            ${group.swatches.map(swatch => `<button class="color-preset-btn" data-color="${window.escapeHtml(swatch.color)}" style="background: ${swatch.color};" title="${window.escapeHtml(swatch.label)}"></button>`).join('')}
                        </div>${i === 0 ? afterFirst : ''}`).join('');
}

// Recent colours: the last ten an editor applied, gradients too, newest first,
// saved per device. A colour with a preset is left out, and using one again
// moves it to the front. Compared once the browser has read both, since the
// presets are hsl() and the picker gives a hex.
const RECENT_COLORS_KEY = 'dsl_recent_colors';
const RECENT_COLORS_MAX = 10;
const STRICT_HEX = /^#[0-9a-f]{6}$/;
let recentColorsMemory = null;   // the list, while storage refuses writes
let colorReader = null;

// The browser's own reading of a colour as #rrggbb. Null for one it cannot
// parse, and for one with transparency, which no picker here makes.
function resolveHex(color) {
    const value = String(color || '').trim();
    if (!SAFE_CSS_COLOR.test(value) || !CSS.supports('color', value)) return null;
    if (!colorReader) colorReader = document.createElement('canvas').getContext('2d');
    if (!colorReader) return null;
    colorReader.fillStyle = value;
    const hex = String(colorReader.fillStyle).toLowerCase();
    return STRICT_HEX.test(hex) ? hex : null;
}

// Arrays of #rrggbb: one colour, or a gradient's stops. Anything else in
// storage was not written here, and is dropped.
function readRecentColors() {
    let list = recentColorsMemory;
    if (!list) {
        try { list = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) || '[]'); }
        catch (e) { list = []; /* blocked or unreadable: nothing recent yet */ }
    }
    if (!Array.isArray(list)) return [];
    return list.filter(entry => Array.isArray(entry) && entry.length >= 1 && entry.length <= GRADIENT_MAX_STOPS
        && entry.every(c => typeof c === 'string' && STRICT_HEX.test(c))).slice(0, RECENT_COLORS_MAX);
}

const sameStops = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);

function hasPreset(stops) {
    if (stops.length === 1) {
        return colorPresetGroups().some(group => group.swatches.some(s => resolveHex(s.color) === stops[0]));
    }
    return GRADIENT_PRESETS.some(g => sameStops([resolveHex(g.from), resolveHex(g.to)], stops));
}

/**
 * Records colours a popup applied (an array of stops), for the Recent row.
 * @since v1.1
 */
function rememberColors(colors) {
    const stops = (Array.isArray(colors) ? colors : []).map(resolveHex);
    if (!stops.length || stops.length > GRADIENT_MAX_STOPS || stops.includes(null) || hasPreset(stops)) return;
    const list = [stops, ...readRecentColors().filter(entry => !sameStops(entry, stops))].slice(0, RECENT_COLORS_MAX);
    try {
        window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list));
        recentColorsMemory = null;
    } catch (e) {
        recentColorsMemory = list;   // remembered on this page only
    }
}

/**
 * The Recent row, or "" while nothing is recent. Every value passed STRICT_HEX
 * on its way out of storage, so it is safe in a style attribute.
 * @since v1.1
 */
function recentColorsHTML(withGradients) {
    const entries = readRecentColors().filter(entry => withGradients || entry.length === 1);
    if (!entries.length) return '';
    return `
                        <div class="format-color-popup-label">Recent</div>
                        <div class="format-color-presets-row" data-recent-colors>
                            ${entries.map(entry => (entry.length === 1
                                ? `<button type="button" class="color-preset-btn" data-color="${entry[0]}" style="background: ${entry[0]};" title="${entry[0]}"></button>`
                                : `<button type="button" class="gradient-preset-btn" data-gradient="${entry.join(',')}" style="background: linear-gradient(90deg, ${entry.join(', ')});" title="Gradient ${entry.join(', ')}"></button>`)).join('')}
                        </div>`;
}

// A Heading Block's optional side bar, in any colour (block.sideBar, drawn by
// page_render.js).
function headingBarRowHTML(block) {
    const bar = typeof window.safeColor === 'function' ? window.safeColor(block.sideBar) : null;
    // safeColor, the renderer's own filter, so the value stays in the attribute.
    return `
                <div class="heading-bar-row">
                    <span class="editor-field-label-sm">Side bar</span>
                    <button type="button" class="heading-bar-swatch${bar ? '' : ' is-none'}" data-heading-bar
                            aria-label="Side bar color" aria-expanded="false"${bar ? ` style="background: ${bar};"` : ''}>${bar ? '' : 'None'}</button>
                </div>`;
}

// The popup behind a colour swatch (a heading's side bar, a folder's colour).
// Made on open and removed on close: its picker repeats the toolbar's ids.
let swatchPopup = null;   // { popup, swatch }

function closeSwatchPopup() {
    if (!swatchPopup) return;
    swatchPopup.swatch.setAttribute('aria-expanded', 'false');
    swatchPopup.popup.remove();
    swatchPopup = null;
}

// Below the swatch, in its row. The same swatch again closes it; onPick gets a
// colour, or null for NONE.
function openSwatchPopup(swatch, noneLabel, onPick) {
    const reopen = !swatchPopup || swatchPopup.popup.parentElement !== swatch.parentElement;
    closeSwatchPopup();
    if (!reopen) return;

    const pick = (color) => {
        closeSwatchPopup();
        if (color) rememberColors([color]);
        onPick(color);
    };
    const popup = document.createElement('div');
    popup.className = 'swatch-popup';
    popup.innerHTML = `
        <button type="button" class="btn-sys btn-sys-regular" data-swatch-none>${window.escapeHtml(noneLabel)}</button>
        <div class="format-color-presets-scroll">${recentColorsHTML(false)}${colorPresetsHTML()}</div>
        <div class="cp-label">Custom</div>
        <div class="cp-surface" id="cp-surface"><div class="cp-thumb" id="cp-surface-thumb"></div></div>
        <div class="cp-hue" id="cp-hue" role="slider" tabindex="0"
             aria-label="Hue" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">
            <div class="cp-thumb cp-hue-thumb" id="cp-hue-thumb"></div>
        </div>
        <div class="format-color-custom-row">
            <span class="cp-preview" id="cp-preview"></span>
            <input type="text" id="cp-hex" class="cp-hex" value="#ffffff"
                   maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color">
            <button type="button" class="btn-sys btn-sys-green cp-apply" id="cp-apply">USE</button>
        </div>`;
    popup.addEventListener('click', (e) => {
        if (e.target.closest('[data-swatch-none]')) { pick(null); return; }
        const preset = e.target.closest('.color-preset-btn');
        if (preset) pick(preset.getAttribute('data-color'));
    });
    swatch.parentElement.appendChild(popup);
    initColorPicker(popup, pick);
    swatchPopup = { popup, swatch };
    swatch.setAttribute('aria-expanded', 'true');
    popup.scrollIntoView({ block: 'nearest' });
}

// A click anywhere else puts it away.
document.addEventListener('click', (e) => {
    if (swatchPopup && !swatchPopup.popup.contains(e.target) && !e.target.closest('[data-heading-bar], [data-folder-color]')) {
        closeSwatchPopup();
    }
});

function setHeadingBar(index, color) {
    const block = window.getActiveBlocks()[index];
    if (!block || block.type !== 'heading') return;
    if (color) block.sideBar = color;
    else delete block.sideBar;
    renderBlockList();
    updateLivePreview();
}

function openHeadingBarPopup(swatch) {
    const index = parseInt(swatch.closest('.block-card').getAttribute('data-index'), 10);
    openSwatchPopup(swatch, 'NO BAR', color => setHeadingBar(index, color));
}

// Readers never see a folder, but the preview is redrawn anyway: that call is
// what records the change for UNDO and the autosave.
function setFolderColor(name, color) {
    const safe = color ? window.safeColor(color) : null;
    if (color && !safe) return;
    window.setBlockFolderColor(window.getActiveBlocks(), name, safe);
    renderBlockList();
    updateLivePreview();
}

function openFolderColorPopup(swatch, name) {
    openSwatchPopup(swatch, 'NO COLOR', color => setFolderColor(name, color));
}

let currentStrategyBlocks = [];
let blockHistory = [];
let historyIndex = -1;

/**
 * Records the state a change starts from. History holds states, and UNDO steps
 * back to the one before the latest, so a change saves its start here and its
 * end through updateLivePreview(). Only UNDO and REDO pass true there.
 * @watch a change that skips either half makes UNDO take back the edit before it
 */
window.saveBlockHistory = function() {
    const newStateStr = JSON.stringify(currentStrategyBlocks);
    
    if (historyIndex >= 0 && JSON.stringify(blockHistory[historyIndex]) === newStateStr) return; 
    
    if (historyIndex < blockHistory.length - 1) {
        blockHistory = blockHistory.slice(0, historyIndex + 1);
    }
    
    blockHistory.push(JSON.parse(newStateStr));
    
    if (blockHistory.length > 50) blockHistory.shift(); 
    else historyIndex++;
    
    if (typeof window.updateHistoryButtons === 'function') window.updateHistoryButtons();
};

/**
 * Every "delete this?" in the editors asks here, so Config's switch turns them
 * all off at once. A prompt that asks a real question (restore a draft, replace
 * all) calls customConfirm itself and is never switched off.
 * @since v1.1
 * @watch owner.html and tier-editor.html have no customConfirm: the browser's
 *   own confirm stands in there
 */
window.confirmDelete = function (message, confirmText) {
    if (window.editorConfig && !window.editorConfig.get('confirmDeletes')) return Promise.resolve(true);
    // The modal is shared: a second question under the first would be answered by
    // its click.
    const modal = document.getElementById('editor-custom-modal');
    if (modal && modal.open) return Promise.resolve(false);
    if (typeof window.customConfirm === 'function' && modal) return window.customConfirm(message, confirmText || 'DELETE', true);
    return Promise.resolve(window.confirm(message));
};

document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const btnUndo = document.getElementById('btn-undo');
        if (btnUndo && !btnUndo.disabled) btnUndo.click();
    }
    if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        const btnRedo = document.getElementById('btn-redo');
        if (btnRedo && !btnRedo.disabled) btnRedo.click();
    }
});

/**
 * A fresh Block of `type`, with no author credit: credit is the contributor's
 * choice. Opened, since it was made to be written in.
 * @watch the name stays though it no longer adds an author: four callers, and a
 *   rename risks a clash in the shared global scope
 */
window.spawnBlockWithAuthor = function(type) {
    const block = JSON.parse(JSON.stringify(blockTemplates[type]));
    // Here rather than at each caller, so a new caller cannot forget it.
    if (typeof window.markEditorBlockNew === 'function') window.markEditorBlockNew(block);
    return block;
};

const blockTemplates = {
    heading: { type: 'heading', content: 'New Heading', align: 'left', size: 'h3' },
    paragraph: { type: 'paragraph', content: 'Write your strategy here...', align: 'left' },
    list: { type: 'list', items: ['List item 1', 'List item 2'], align: 'left', author: '', boxed: false },
    image: { type: 'image', src: '', alt: 'Image description', caption: '', align: 'center', width: '75%' },
    video: { type: 'video', src: '', align: 'center', width: '75%', controls: false, caption: '' }, 
    youtube: { type: 'youtube', videoId: '', align: 'center', width: '75%', caption: '' },
    callout: { type: 'callout', intent: 'info', title: 'Note', content: 'Important detail here', align: 'center' },
    combo: { type: 'combo', sequence: ['M1', 'M1', 'Skill'], damage: '0', align: 'left', note: '', author: '' },
    accordion: { type: 'accordion', title: 'Collapsible Section', content: [{ type: 'paragraph', content: ['Hidden text...'] }], align: 'center', author: '' },
    // A Combo Card nests Blocks in `content`, like an accordion, so it can hold its
    // own clips and write-up. One combo until Multiple Sections is switched on.
    theorybox: { type: 'theorybox', title: 'New Combo', oneliner: '', difficulty: '', practicality: '', sequence: [], damage: '', video: '', content: [], anchor: '', align: 'left', author: '', multiSections: false, sections: [] },
    divider: { type: 'divider', style: 'diamond', padding: 'normal' },
    author: { type: 'author', author: '' },
    table: { type: 'table', headers: ['Stat', 'Value'], rows: [['Damage', '10'], ['Startup', '5f']], align: 'center', author: '' },
    // A Section Box: `{ title, content }` per section, comboGroups' own shape, so the
    // diff and the renderer read it without a new container shape.
    sectionedbox: { type: 'sectionedbox', title: 'New Section Box', intro: [], sections: [{ title: 'Section 1', content: [] }], align: 'left', author: '' },
    // Which of the site's colour grids to draw. The colours are never stored.
    colorswatches: { type: 'colorswatches', set: 'characters' },
    // One person on the Collaborators page, a Card or a Thanks line. The home page's
    // Credits list is built from these.
    collaborator: { type: 'collaborator', kind: 'card', name: 'New Collaborator', role: '', badge: 'badge-general', avatar: '', description: '', links: [] },
};

// Offered on their own page only. The type dropdown asks the same question.
const PAGE_ONLY_BLOCKS = { colorswatches: 'color_codes', collaborator: 'collaborators' };

// One link per line, "Label | address"; a line with no bar is its own label.
function parseLinkLines(text) {
    return String(text || '').split('\n').map(line => {
        const bar = line.indexOf('|');
        const name = (bar === -1 ? '' : line.slice(0, bar)).trim();
        const url = (bar === -1 ? line : line.slice(bar + 1)).trim();
        return { name: name || url, url };
    }).filter(link => link.url);
}
const linkLinesText = (links) => (Array.isArray(links) ? links : []).map(l => `${l.name || ''} | ${l.url || ''}`).join('\n');

// The lines the page will not link, named under the field while typing.
function collaboratorLinkNote(links) {
    const isLink = window.isCollaboratorLink || (() => true);
    const bad = (Array.isArray(links) ? links : []).filter(l => !isLink(l.url)).map(l => l.url);
    return bad.length ? `Not shown, as only an http or https address links: ${bad.join(', ')}` : '';
}
window.blockOfferedHere = function (type) {
    const only = PAGE_ONLY_BLOCKS[type];
    return !only || only === window.currentEditorCharId;
};

// What each Block type is called on screen. The Add Block menu and every card's
// type dropdown read this one map, so they cannot disagree.
const BLOCK_TYPE_LABELS = {
    heading: 'Heading',
    paragraph: 'Paragraph',
    table: 'Table',
    list: 'List',
    image: 'Image',
    video: 'Video',
    youtube: 'YouTube',
    callout: 'Callout',
    combo: 'Combo',
    accordion: 'Accordion',
    theorybox: 'Combo Card',
    sectionedbox: 'Section Box',
    divider: 'Divider',
    author: 'Author',
    colorswatches: 'Color Swatches',
    collaborator: 'Collaborator',
};

/**
 * A Block type's name on screen, or its key when the map has none.
 * @since v0.16
 */
window.blockTypeLabel = function (type) {
    return BLOCK_TYPE_LABELS[type] || String(type || '').toUpperCase();
};

// The Add Block menu's groups, in order; only the grouping is chosen here.
const ADD_BLOCK_GROUPS = [
    { title: 'Text & Media', types: ['heading', 'paragraph', 'table', 'list', 'image', 'video', 'youtube'] },
    { title: 'Components', types: ['callout', 'combo', 'accordion', 'theorybox', 'sectionedbox', 'divider', 'author', 'colorswatches', 'collaborator'] },
];

/**
 * A text prompt in the site's own modal, for the toolbar's link button. It lives
 * here because post-editor.html loads this file without editor-core.js.
 * @since v0.16
 * @watch the input is made and removed per call: the modal is shared with every
 *   delete confirmation
 */
window.customPrompt = function (message, opts = {}) {
    const modal = document.getElementById('editor-custom-modal');
    const textEl = document.getElementById('editor-modal-text');
    const btnCancel = document.getElementById('editor-modal-cancel');
    const btnConfirm = document.getElementById('editor-modal-confirm');

    // No modal on this page: the link button still works.
    if (!modal || !textEl || !btnCancel || !btnConfirm) {
        return Promise.resolve(window.prompt(message));
    }
    if (modal.open) return Promise.resolve(null);

    const prevConfirmText = btnConfirm.textContent;
    const prevConfirmClass = btnConfirm.className;

    textEl.textContent = message;
    btnConfirm.textContent = opts.confirmText || 'INSERT';
    btnConfirm.className = 'btn-sys btn-sys-blue';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editor-input dialog-input';
    input.value = opts.value || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    textEl.insertAdjacentElement('afterend', input);

    const typed = () => input.value.trim() || null;
    // Enter accepts, Escape backs out, as window.prompt did. No click outside: it
    // holds what was typed.
    const answer = window.runDialog(modal, {
        buttons: [[btnCancel, null], [btnConfirm, typed]],
        cancel: null, enter: typed, keyTarget: input, focus: input,
        onClose: () => {
            input.remove();
            btnConfirm.textContent = prevConfirmText;
            btnConfirm.className = prevConfirmClass;
        },
    });
    input.select();
    return answer;
};

window.activeAccordionPath = [];

// Which section of a Combo Card the editor shows. Keyed by the Block and never
// stored, so readers never get it; UNDO replaces the Blocks and drops it.
const activeCardSection = new WeakMap();

/**
 * The Combo Card section on screen, and setEditorCardSection below.
 * @since v0.19
 */
window.editorCardSectionIndex = function (block) {
    const sections = (block && Array.isArray(block.sections)) ? block.sections : [];
    if (!sections.length) return -1;
    // The section it names may have been removed.
    return Math.max(0, Math.min(activeCardSection.get(block) || 0, sections.length - 1));
};

window.setEditorCardSection = function (block, index) {
    if (block && typeof block === 'object') activeCardSection.set(block, index);
};

/**
 * Where a Combo Card's fields write: the section on screen in Multiple Sections,
 * the card itself otherwise. Any other Block gets itself back.
 * @since v0.19
 */
window.editorCardFieldTarget = function (block) {
    if (!block || block.type !== 'theorybox' || !block.multiSections) return block;
    const at = window.editorCardSectionIndex(block);
    return at < 0 ? block : block.sections[at];
};


// The fields Multiple Sections moves between the card and its first section.
const CARD_TEXT_FIELDS = ['title', 'oneliner', 'difficulty', 'practicality', 'damage', 'video', 'anchor'];

/**
 * Multiple Sections on seeds the first section from the card, and off copies
 * the section on screen back up, so the switch loses nothing on screen. The
 * Combos and Techs card editor calls it too.
 * @since v0.19
 */
function seedCardSections(card, on) {
    if (!card || typeof card !== 'object') return;

    if (on) {
        if (Array.isArray(card.sections) && card.sections.length) return;
        // Empty: an optional override (a short tab name over a long heading), and the
        // reader falls back to the card's title. Seeded from the title, it kept a
        // default like "New Combo" for good.
        const seeded = { label: '' };
        CARD_TEXT_FIELDS.forEach(f => { seeded[f] = card[f] || ''; });
        seeded.sequence = Array.isArray(card.sequence) ? card.sequence.slice() : [];
        // Notation styles travel with the route.
        if (Array.isArray(card.notations) && card.notations.length) {
            seeded.notations = cloneComboNotations(card.notations);
        }
        seeded.content = Array.isArray(card.content) ? card.content : [];
        card.sections = [seeded];
        return;
    }

    const at = window.editorCardSectionIndex(card);
    if (at < 0) return;
    const sec = card.sections[at] || {};
    CARD_TEXT_FIELDS.forEach(f => { card[f] = sec[f] || ''; });
    card.sequence = Array.isArray(sec.sequence) ? sec.sequence.slice() : [];
    if (Array.isArray(sec.notations) && sec.notations.length) card.notations = cloneComboNotations(sec.notations);
    else delete card.notations;
    card.content = Array.isArray(sec.content) ? sec.content : [];
}

function cloneComboNotations(list) {
    return (Array.isArray(list) ? list : []).map(n => ({
        label: String((n && n.label) || ''),
        sequence: (n && Array.isArray(n.sequence)) ? n.sequence.slice() : [],
    }));
}

/**
 * A Combo's notation style fields, item.notations = [{ label, sequence }] beside
 * item.sequence. Four surfaces edit them (the Combo Block, the Combo Card, the
 * Combos and Techs card editor, the Combo Row modal), so the markup, the writes
 * and the add and remove rules are here once; each surface decides only which
 * item it edits. `lines` follows the surface's own route field: one step a line,
 * or comma separated on the Combo Block.
 * @since v0.20
 */
window.comboNotationFieldsHTML = function (item, opts) {
    const lines = !!(opts && opts.lines);
    const list = (item && Array.isArray(item.notations)) ? item.notations : [];

    const rows = list.map((n, i) => {
        const steps = Array.isArray(n && n.sequence) ? n.sequence : [];
        const route = lines
            ? `<textarea class="editor-textarea" data-nstyle-route="${i}" rows="3"
                   placeholder="The route in this style, one step per line">${window.escapeHtml(steps.join('\n'))}</textarea>`
            : `<input type="text" class="editor-input" data-nstyle-route="${i}" value="${window.escapeHtml(steps.join(', '))}"
                   placeholder="The route in this style (comma separated)">`;
        return `<div class="nstyle-row" data-nstyle-row="${i}">
                <div class="nstyle-row-head">
                    <input type="text" class="editor-input" data-nstyle-label="${i}" value="${window.escapeHtml((n && n.label) || '')}"
                           placeholder="Style name (e.g. Keyboard)">
                    <button type="button" class="btn-sys btn-sys-red" data-nstyle-remove="${i}"
                            title="Remove this notation style" aria-label="Remove this notation style">&#10006;</button>
                </div>
                ${route}
            </div>`;
    }).join('');

    return `<div class="nstyle-editor">
            <div class="nstyle-editor-label">NOTATION STYLES</div>
            ${rows || '<div class="nstyle-editor-empty">Optional. Readers click the route to switch styles.</div>'}
            <button type="button" class="btn-sys btn-sys-green" data-nstyle-add="1">+ ADD NOTATION STYLE</button>
        </div>`;
};

/**
 * Writes one style field into `item`, true when `el` was one. Runs on every
 * keystroke, so it never re-renders: that would take the caret away.
 * @since v0.20
 */
window.applyComboNotationInput = function (item, el) {
    if (!item || !el) return false;
    const labelAt = el.getAttribute('data-nstyle-label');
    const routeAt = el.getAttribute('data-nstyle-route');
    if (labelAt === null && routeAt === null) return false;

    const at = parseInt(labelAt !== null ? labelAt : routeAt, 10);
    if (!Array.isArray(item.notations) || !item.notations[at]) return true;

    if (labelAt !== null) {
        item.notations[at].label = el.value;
    } else {
        // Blank steps are dropped: a style is new data, with nothing older to match.
        const parts = el.tagName === 'TEXTAREA' ? el.value.split('\n') : el.value.split(',');
        item.notations[at].sequence = parts.map(s => s.trim()).filter(Boolean);
    }
    return true;
};

/**
 * Adds or removes a style from a click on `btn`. Returns the index to focus
 * (the new style's name), -1 after a removal, or null when `btn` was not ours.
 * @since v0.20
 */
window.applyComboNotationClick = function (item, btn) {
    if (!item || !btn) return null;
    if (btn.hasAttribute('data-nstyle-add')) {
        if (!Array.isArray(item.notations)) item.notations = [];
        item.notations.push({ label: '', sequence: [] });
        return item.notations.length - 1;
    }
    if (btn.hasAttribute('data-nstyle-remove')) {
        const at = parseInt(btn.getAttribute('data-nstyle-remove'), 10);
        if (Array.isArray(item.notations)) item.notations.splice(at, 1);
        // An empty list is dropped, so the combo saves as it did before.
        if (Array.isArray(item.notations) && !item.notations.length) delete item.notations;
        return -1;
    }
    return null;
};

window.focusComboNotationField = function (root, at) {
    if (!root || at === null || at < 0) return;
    const field = root.querySelector(`[data-nstyle-label="${at}"]`);
    if (field) field.focus();
};

// The style names this page already uses, under a style name field, most used
// first. A reader's choice follows the name, so "Keyboard" and "KBM" are two
// styles. Counted wherever `notations` appears in the page's data, so a new
// surface is not missed, and only from what renders.
function pageNotationNames() {
    const names = new Map();   // key -> { label, count }
    const seen = new WeakSet();
    const count = (list) => list.forEach(n => {
        const label = String((n && n.label) || '').trim().replace(/\s+/g, ' ');
        const key = window.comboNotationKey(label);
        if (!key) return;
        const entry = names.get(key) || { label, count: 0 };
        entry.count++;
        names.set(key, entry);
    });
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || seen.has(node) || depth > 40) return;
        seen.add(node);
        if (Array.isArray(node)) { node.forEach(child => walk(child, depth + 1)); return; }
        const multi = !!node.multiSections && Array.isArray(node.sections) && node.sections.length > 0;
        if (Array.isArray(node.notations) && !multi) count(node.notations);
        Object.keys(node).forEach(key => {
            if (key === 'notations') return;
            if (key === 'sections' && node.type === 'theorybox' && !multi) return;
            walk(node[key], depth + 1);
        });
    };
    walk(window.editorMasterDescData || window.currentEditorDescData, 0);
    return names;
}

function notationNameNote(names, typed) {
    const key = window.comboNotationKey(typed);
    if (!key || !names.length || names.some(n => window.comboNotationKey(n.label) === key)) return '';
    return `No other combo on this page uses "${typed.trim()}". Readers who picked ${names[0].label} won't see it.`;
}

// The other styles' names, for `field`: its own name is in the data too, once.
function showNotationNames(field) {
    const row = field.closest('.nstyle-row');
    // owner.html loads this file without page_render.js.
    if (!row || typeof window.comboNotationKey !== 'function') return;
    const counts = pageNotationNames();
    const own = counts.get(window.comboNotationKey(field.value));
    if (own && --own.count === 0) counts.delete(window.comboNotationKey(field.value));
    const names = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const old = row.querySelector('[data-nstyle-names]');
    if (old) old.remove();
    if (!names.length) return;

    const box = document.createElement('div');
    box.className = 'nstyle-names';
    box.setAttribute('data-nstyle-names', '');
    box.innerHTML = `<span class="nstyle-names-label">On this page:</span>${names.map((n, i) => `
            <button type="button" class="nstyle-name-chip" data-nstyle-name="${i}">${window.escapeHtml(n.label)}<span class="nstyle-name-count">${n.count}</span></button>`).join('')}
            <div class="nstyle-names-note" data-nstyle-note></div>`;
    box.notationNames = names;
    const head = row.querySelector('.nstyle-row-head');
    (head || field).insertAdjacentElement('afterend', box);
    box.querySelector('[data-nstyle-note]').textContent = notationNameNote(names, field.value);
}

document.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('[data-nstyle-label]')) showNotationNames(e.target);
});

// Capture: the Workspace's own handler stops the event at the list.
document.addEventListener('input', (e) => {
    if (!e.target.matches || !e.target.matches('[data-nstyle-label]')) return;
    const box = e.target.closest('.nstyle-row') && e.target.closest('.nstyle-row').querySelector('[data-nstyle-names]');
    if (box) box.querySelector('[data-nstyle-note]').textContent = notationNameNote(box.notationNames, e.target.value);
}, true);

// Put away once focus leaves the name, its remove button and the chips.
document.addEventListener('focusout', (e) => {
    if (!e.target.matches || !e.target.closest('[data-nstyle-label], .nstyle-row-head, [data-nstyle-names]')) return;
    const row = e.target.closest('.nstyle-row');
    const next = e.relatedTarget;
    if (!row || (next && row.contains(next) && next.closest('.nstyle-row-head, [data-nstyle-names]'))) return;
    const box = row.querySelector('[data-nstyle-names]');
    if (box) box.remove();
});

// Through the field's own input handler, so every surface stores it as typing.
document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('.nstyle-name-chip')) e.preventDefault();
});
document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('.nstyle-name-chip');
    if (!chip) return;
    const box = chip.closest('[data-nstyle-names]');
    const field = box && box.closest('.nstyle-row').querySelector('[data-nstyle-label]');
    const name = box && box.notationNames[Number(chip.getAttribute('data-nstyle-name'))];
    if (!field || !name) return;
    field.value = name.label;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
});
// Said out loud: the Combos and Techs card editor calls it, and the switch must
// behave the same in both editors.
window.seedCardSections = seedCardSections;

/**
 * A Combo Card's name in a list of cards. With Multiple Sections on, its own
 * title is never shown, so the first section's (the tab a reader lands on).
 * @since v0.20
 */
window.comboCardLabel = function (card, fallbackIndex) {
    const nth = `Card ${(fallbackIndex || 0) + 1}`;
    if (!card || typeof card !== 'object') return nth;

    const sections = Array.isArray(card.sections) ? card.sections : [];
    const source = (card.multiSections && sections.length) ? (sections[0] || {}) : card;

    const steps = Array.isArray(source.sequence) ? source.sequence : [];
    // The heading first: the tab label is a short switcher. The reader's tab row
    // resolves the other way, which is right there.
    return source.title || source.label || steps.join(' > ') || nth;
};

/**
 * The Blocks array a path step means. A step is an index into `.content`, or
 * `{ index, field }` for a container with several arrays (a Section Box's intro
 * and sections).
 * @since v0.19
 * @watch `field` is matched against a fixed set, never resolved as a path into
 *   contributor data
 */
window.resolveNestedBlocks = function (host, field) {
    if (!host || typeof host !== 'object') return null;

    if (!field) {
        if (!Array.isArray(host.content)) host.content = [];
        return host.content;
    }
    if (field === 'intro') {
        if (!Array.isArray(host.intro)) host.intro = [];
        return host.intro;
    }

    const m = /^sections\.(\d+)\.content$/.exec(field);
    if (m) {
        const section = Array.isArray(host.sections) ? host.sections[Number(m[1])] : null;
        if (!section || typeof section !== 'object') return null;
        if (!Array.isArray(section.content)) section.content = [];
        return section.content;
    }
    return null;
};

/**
 * The Blocks array on screen, following window.activeAccordionPath.
 */
window.getActiveBlocks = function() {
    let blocks = currentStrategyBlocks;
    for (let i = 0; i < window.activeAccordionPath.length; i++) {
        const step = window.activeAccordionPath[i];
        const idx = (step && typeof step === 'object') ? step.index : step;

        if (!blocks[idx]) {
            window.activeAccordionPath = window.activeAccordionPath.slice(0, i);
            break;
        }

        // A section deleted while the author was inside it: cut the path short.
        const nested = window.resolveNestedBlocks(
            blocks[idx], (step && typeof step === 'object') ? step.field : null);
        if (!nested) {
            window.activeAccordionPath = window.activeAccordionPath.slice(0, i);
            break;
        }
        blocks = nested;
    }
    return blocks;
};

// A function, since a Section Box's step carries a field as well as an index.
window.enterBlockContainer = function (index, field) {
    window.activeAccordionPath.push(field ? { index, field } : index);
    renderBlockList();
};

// Which Blocks are shut. The Workspace opens every Block, and folders shut.
// Keyed by the Block, not its index (which moves on reorder) and not a flag on
// it (which would be saved into the page). Survives renderBlockList; UNDO
// replaces the Blocks and drops it.
const collapsedBlocks = new WeakSet();

window.isEditorBlockExpanded = function (block) {
    return !!block && !collapsedBlocks.has(block);
};

window.setEditorBlockExpanded = function (block, on) {
    if (!block || typeof block !== 'object') return;
    if (on) collapsedBlocks.delete(block);
    else collapsedBlocks.add(block);
};

// A new Block opens. Redundant while open is the default; kept for the intent.
window.markEditorBlockNew = function (block) {
    window.setEditorBlockExpanded(block, true);
    return block;
};

// Which Blocks are selected, keyed by the Block like the set above: moving,
// deleting and pasting change the indices around them. No order is stored;
// it is read from the live array each time, so "these five" stays the same five.
const selectedBlocks = new WeakSet();

window.isEditorBlockSelected = function (block) {
    return !!block && selectedBlocks.has(block);
};

window.setEditorBlockSelected = function (block, on) {
    if (!block || typeof block !== 'object') return;
    if (on) selectedBlocks.add(block);
    else selectedBlocks.delete(block);
};

window.toggleEditorBlockSelected = function (block) {
    if (!block || typeof block !== 'object') return false;
    const next = !selectedBlocks.has(block);
    window.setEditorBlockSelected(block, next);
    return next;
};

/**
 * The selected Blocks at the level on screen, as indices in document order,
 * so nothing acts on a Block inside an accordion that is not open.
 */
window.getSelectedBlockIndices = function () {
    const blocks = window.getActiveBlocks();
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
        if (selectedBlocks.has(blocks[i])) out.push(i);
    }
    return out;
};

window.clearEditorBlockSelection = function () {
    // Only this level: an outer selection is there again on the way back out.
    window.getActiveBlocks().forEach(b => selectedBlocks.delete(b));
};

// Module scope: the selection bar, the keyboard and a card's own buttons share
// these, so the three cannot mean different things.

// Folder membership is decided by the neighbours, so every position an
// operation touched is settled, once each.
function reconcileAround(blocks, indices) {
    if (typeof window.reconcileFolderAt !== 'function') return;
    [...new Set(indices)]
        .filter(i => i >= 0 && i < blocks.length)
        .sort((a, b) => a - b)
        .forEach(i => window.reconcileFolderAt(blocks, i));
}

// Always an array, even for one Block, so the clipboard has one shape.
window.copiedWikiBlocks = window.copiedWikiBlocks || [];

window.copySelectedBlocks = function () {
    const blocks = window.getActiveBlocks();
    const picked = window.getSelectedBlockIndices();
    if (!picked.length) return 0;
    window.copiedWikiBlocks = picked.map(i => JSON.parse(JSON.stringify(blocks[i])));
    return picked.length;
};

// After `afterIndex`, or at the end. Cloned on the way out too, so two pastes
// never share one object.
window.pasteCopiedBlocks = function (afterIndex) {
    const copied = window.copiedWikiBlocks;
    if (!Array.isArray(copied) || !copied.length) return 0;

    const blocks = window.getActiveBlocks();
    const clones = copied.map(b => JSON.parse(JSON.stringify(b)));
    const at = (afterIndex === null || afterIndex === undefined || afterIndex < 0)
        ? blocks.length
        : afterIndex + 1;

    window.saveBlockHistory();
    blocks.splice(at, 0, ...clones);
    reconcileAround(blocks, clones.map((_, k) => at + k).concat([at - 1, at + clones.length]));
    return clones.length;
};

window.deleteSelectedBlocks = function () {
    const blocks = window.getActiveBlocks();
    const picked = window.getSelectedBlockIndices();
    if (!picked.length) return 0;

    window.saveBlockHistory();
    // Descending, so removing one cannot renumber the ones still to remove.
    for (let k = picked.length - 1; k >= 0; k--) {
        window.setEditorBlockSelected(blocks[picked[k]], false);
        blocks.splice(picked[k], 1);
    }
    // Taking Blocks out can leave two halves of a folder touching.
    reconcileAround(blocks, [picked[0] - 1, picked[0]]);
    return picked.length;
};

// One wording for the bar, the Delete key and a selected card's delete button.
function selectionDeleteMessage() {
    const n = window.getSelectedBlockIndices().length;
    return n === 1 ? 'Delete the selected block?' : `Delete the ${n} selected blocks?`;
}

/**
 * Moves the selection by `dir` (-1 or 1): each selected Block steps over an
 * unselected neighbour, so a run moves as one and a gapped one closes up.
 * @since v0.19
 */
window.moveSelectedBlocks = function (dir) {
    if (dir !== -1 && dir !== 1) return false;
    const blocks = window.getActiveBlocks();
    const picked = window.getSelectedBlockIndices();
    if (!picked.length) return false;

    // Decided first: the history snapshot must be of the state being left, and a
    // selection against the end must not push an identical state.
    const canMove = picked.some(i => (dir === -1
        ? i !== 0 && !window.isEditorBlockSelected(blocks[i - 1])
        : i !== blocks.length - 1 && !window.isEditorBlockSelected(blocks[i + 1])));
    if (!canMove) return false;
    window.saveBlockHistory();

    const touched = [];
    const swap = (a, b) => {
        const tmp = blocks[a];
        blocks[a] = blocks[b];
        blocks[b] = tmp;
        touched.push(a, b);
    };

    if (dir === -1) {
        // The topmost decides whether the one behind it can follow.
        for (let k = 0; k < picked.length; k++) {
            const i = picked[k];
            if (i === 0 || window.isEditorBlockSelected(blocks[i - 1])) continue;
            swap(i - 1, i);
        }
    } else {
        for (let k = picked.length - 1; k >= 0; k--) {
            const i = picked[k];
            if (i === blocks.length - 1 || window.isEditorBlockSelected(blocks[i + 1])) continue;
            swap(i, i + 1);
        }
    }

    if (!touched.length) return false;
    reconcileAround(blocks, touched);
    return true;
};

/**
 * Draws the Block editor into `containerId` for `initialData`. opts.mode
 * 'gallery' gives the Gallery tab this footer (the format tools and the Media
 * Library) around its bin of media; the Block list then stays empty.
 * @watch the toolbar, colour picker and link picker all resolve through
 *   `container`, so the footer is reused whole rather than lifted out
 */
function initStrategyBlockBuilder(containerId, initialData, opts) {
    const container = document.getElementById(containerId);
    const mode = (opts && opts.mode) || 'blocks';
    window.editorBuilderMode = mode;
    currentStrategyBlocks = initialData ? JSON.parse(JSON.stringify(initialData)) : [];

    // Config > Open sections minimized. These are fresh copies, so nothing else shuts.
    if (window.editorConfig && window.editorConfig.get('openMinimized')) {
        currentStrategyBlocks.forEach(block => window.setEditorBlockExpanded(block, false));
    }

    window.activeAccordionPath = [];

    // Folders open per section: a new section starts with every folder shut, which
    // is also what makes a bare folder name a safe key.
    if (typeof window.resetBlockFolderState === 'function') window.resetBlockFolderState();

    blockHistory = [JSON.parse(JSON.stringify(currentStrategyBlocks))];
    historyIndex = 0;

    container.innerHTML = `
        <!-- MEDIA LIBRARY has moved to the footer beside ADD BLOCK (v0.16
             fine-tuning 7). The modifier class is what keeps undo/redo/clear
             on the right now that nothing balances them on the left - the
             shared .strategy-toolbar-row is space-between, and it still serves
             the structured-form toolbar in js/editor/tabs/editor-tabs.js, which keeps its
             own MEDIA LIBRARY because it has no footer to move it to. -->
        <div class="strategy-toolbar-row strategy-toolbar-row-end">
            <div class="strategy-toolbar-actions">
                <button class="btn-sys btn-sys-regular" id="btn-undo" title="Undo (Ctrl+Z)" disabled>⮌ UNDO</button>
                <button class="btn-sys btn-sys-regular" id="btn-redo" title="Redo (Ctrl+Y)" disabled>⮎ REDO</button>
                <button class="btn-sys btn-sys-red" id="btn-clear-all" title="Clear All Blocks">✖ CLEAR ALL</button>
                <!-- v1.1: the only way to make a first folder used to be a
                     block's folder dropdown, which the Config panel can hide. -->
                <button class="btn-sys btn-sys-regular" id="btn-create-folder" title="Create an empty folder at the end of the list">&#65291; CREATE FOLDER</button>
            </div>
        </div>

        <div id="block-list" class="block-editor-container block-editor-container-blocklist"></div>

        <div class="add-block-toolbar">
            <div class="format-toolbar" title="Highlight text in a block, then click to apply styling">
                <button class="format-btn" data-tag="b" title="Bold">B</button>
                <button class="format-btn format-btn-italic" data-tag="i" title="Italic">I</button>
                <button class="format-btn format-btn-underline" data-tag="u" title="Underline">U</button>
                <button class="format-btn format-btn-strikethrough" data-tag="s" title="Strikethrough">S</button>
                <button class="format-btn format-btn-code" data-tag="code" title="Inline Code">&lt;&gt;</button>
                <button class="format-btn" data-tag="url" title="Turn text into a link">🔗</button>
                <!-- A link to another section of THIS page. Separate from the
                     link button because the thing being chosen is different: a
                     URL is typed, a section is picked from what exists. Typing
                     the anchor by hand means knowing the slug rule, which no
                     contributor should have to. -->
                <div class="format-jump-wrapper">
                    <button class="format-btn format-btn-jump" id="btn-format-jump"
                            title="Link to a section on this page">⚓</button>
                    <div id="format-jump-popup" class="format-jump-popup hidden">
                        <div class="format-jump-label">Link to a section</div>
                        <input type="text" id="format-jump-search" class="format-jump-search"
                               placeholder="Search sections…" autocomplete="off">
                        <div id="format-jump-list" class="format-jump-list"></div>
                    </div>
                </div>
                <!-- Mini icons in text (v1.2): the owner's accolade icons and
                     the characters' roster icons, picked here rather than
                     typed as [icon=...]. -->
                <div class="format-jump-wrapper">
                    <button class="format-btn format-btn-icon" id="btn-format-icon"
                            title="Put an icon in the text">🖼</button>
                    <div id="format-icon-popup" class="format-jump-popup format-icon-popup hidden">
                        <div class="format-jump-label">Put an icon in the text</div>
                        <input type="text" id="format-icon-search" class="format-jump-search"
                               placeholder="Search icons…" autocomplete="off">
                        <div id="format-icon-list" class="format-jump-list"></div>
                    </div>
                </div>
                <!-- The two shortcodes v0.14 added to js/pages/core/format_tags.js.
                     They rendered on the page from the day they shipped and
                     had no way to be typed except by hand, which is the same
                     as not existing for most contributors. -->
                <button class="format-btn format-btn-kbd" data-tag="kbd" title="Key or input, e.g. M1">⌨</button>
                <button class="format-btn format-btn-noauto" data-tag="noauto" title="Stop automatic colouring here, for when a character name is just a word">🚫</button>
                <button class="format-btn format-btn-outline" data-tag="outline" title="White outline around the text"><span class="sc-outline">A</span></button>

                <div class="format-color-wrapper">
                    <button class="format-btn format-btn-color-trigger" id="btn-format-color" title="Apply Color to Highlighted Text">
                        <div class="format-color-swatch-icon"></div> 🎨
                    </button>
                    <div id="format-color-popup" class="format-color-popup hidden">
                        <!-- Only the swatches scroll. The custom picker below
                             is pinned, because it used to be inside the
                             scrolling region: the popup caps at 320px, the
                             ~45 preset swatches already fill that, and the
                             surface and the USE button sat under the fold.
                             Opening the picker showed nothing but swatches. -->
                        <!-- Gradients sit SECOND: Basic is what contributors
                             reach for constantly and keeps the top, and a
                             specialty tool one row down is still the first
                             thing anybody scanning this popup sees.
                             Not a workaround - the clipping that made the top
                             row unclickable is fixed in keepColorPopupOnScreen
                             below, so any position would work. -->
                        <div class="format-color-presets-scroll">
                        <div data-recent-slot></div>
                        ${colorPresetsHTML(gradientPresetsHTML())}
                        </div>
                        <!-- A saturation/brightness surface and a hue slider,
                             replacing <input type="color">. That input opens
                             the OPERATING SYSTEM's colour dialog on top of the
                             wiki - a different palette, a different set of
                             conventions, and on some platforms a modal that
                             steals the selection the toolbar is about to wrap.
                             Owner's call, 2026-08-13. -->
                        <!-- Its own class, not .format-color-popup-label: that
                             one labels a SWATCH GROUP, and there are exactly
                             three of those. Reusing it made the picker read as
                             a fourth palette. -->
                        <div class="cp-label">Custom</div>
                        <div class="cp-surface" id="cp-surface">
                            <div class="cp-thumb" id="cp-surface-thumb"></div>
                        </div>
                        <div class="cp-hue" id="cp-hue" role="slider" tabindex="0"
                             aria-label="Hue" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">
                            <div class="cp-thumb cp-hue-thumb" id="cp-hue-thumb"></div>
                        </div>
                        <div class="format-color-custom-row">
                            <span class="cp-preview" id="cp-preview"></span>
                            <input type="text" id="cp-hex" class="cp-hex" value="#ffffff"
                                   maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour">
                            <button type="button" class="btn-sys btn-sys-green cp-apply" id="cp-apply">USE</button>
                        </div>
                        ${gradientBuilderHTML()}
                    </div>
                </div>
            </div>

            <!-- Stacked, ADD BLOCK on top (owner, 2026-10-19). -->
            <div class="add-block-footer-actions">
            <div class="add-block-menu-wrapper">
                <div class="add-block-popup" id="add-block-popup">
                    ${ADD_BLOCK_GROUPS.map((group, gi) => `
                    <div class="add-block-popup-title${gi ? ' add-block-popup-title-spaced' : ''}">${window.escapeHtml(group.title)}</div>
                    ${group.types.filter(window.blockOfferedHere).map(t =>
                        `<button class="btn-sys btn-sys-regular add-block-btn" data-type="${window.escapeHtml(t)}">+ ${window.escapeHtml(window.blockTypeLabel(t))}</button>`
                    ).join('')}`).join('')}
                </div>
                <button class="btn-sys btn-sys-green btn-add-block-toggle" id="btn-toggle-add-menu">
                    <span class="add-block-icon">⨁</span> ADD BLOCK
                </button>
            </div>
            <button class="btn-sys btn-sys-blue" id="btn-media-library" title="Open Media Manager">📁 MEDIA LIBRARY</button>
            </div>
        </div>
    `;

    // Gallery mode: UNDO, REDO and CLEAR ALL are Block history, which a bin does not
    // write, so they go. ADD BLOCK is greyed, not removed: a missing button reads as
    // a broken one.
    if (mode === 'gallery') {
        // style.display, not `hidden`: .strategy-toolbar-row sets display, which beats
        // the browser's own [hidden] rule.
        const blockOnlyRow = container.querySelector('.strategy-toolbar-row');
        if (blockOnlyRow) blockOnlyRow.style.display = 'none';

        const addBlockBtn = container.querySelector('#btn-toggle-add-menu');
        if (addBlockBtn) {
            addBlockBtn.disabled = true;
            addBlockBtn.title = 'A gallery holds media items, not blocks.';
        }
    }

    const btnUndo = container.querySelector('#btn-undo');
    const btnRedo = container.querySelector('#btn-redo');
    
    window.updateHistoryButtons = function() {
        if(btnUndo) btnUndo.disabled = historyIndex <= 0;
        if(btnRedo) btnRedo.disabled = historyIndex >= blockHistory.length - 1;
    };
    window.updateHistoryButtons();

    btnUndo.addEventListener('click', () => {
        if (historyIndex > 0) {
            historyIndex--;
            currentStrategyBlocks = JSON.parse(JSON.stringify(blockHistory[historyIndex]));
            renderBlockList();
            updateLivePreview(true); 
            window.updateHistoryButtons();
        }
    });

    btnRedo.addEventListener('click', () => {
        if (historyIndex < blockHistory.length - 1) {
            historyIndex++;
            currentStrategyBlocks = JSON.parse(JSON.stringify(blockHistory[historyIndex]));
            renderBlockList();
            updateLivePreview(true); 
            window.updateHistoryButtons();
        }
    });

    container.querySelector('#btn-clear-all').addEventListener('click', async () => {
        const activeBlocks = window.getActiveBlocks();
        if (activeBlocks.length > 0 && await window.confirmDelete("Delete all blocks in this section?")) {
            activeBlocks.length = 0;
            renderBlockList();
            updateLivePreview(); 
        }
    });

    // An empty folder is session state until a Block joins it, so the preview stays.
    const btnCreateFolder = container.querySelector('#btn-create-folder');
    if (btnCreateFolder) {
        btnCreateFolder.addEventListener('click', () => {
            if (typeof window.addPendingBlockFolder !== 'function') return;
            window.addPendingBlockFolder(window.getActiveBlocks(), null);
            renderBlockList();
        });
    }

    const btnMediaLib = container.querySelector('#btn-media-library');
    if (btnMediaLib) {
        btnMediaLib.addEventListener('click', () => {
            document.getElementById('media-modal-overlay').classList.remove('hidden');
            if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
        });
    }

    const blockList = document.getElementById('block-list');

    // Ctrl-click on a card's header selects it. Registered first and stopping
    // immediate propagation: every click listener here is on #block-list, and one
    // gesture must not also open a folder picker. Controls in the header are left
    // out by name, and the body's Ctrl-click belongs to the textarea.
    blockList.addEventListener('click', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        const header = e.target.closest('.block-header');
        if (!header) return;
        if (e.target.closest('button, select, input, textarea, .drag-handle')) return;

        const card = header.closest('.block-card');
        if (!card || !card.hasAttribute('data-index')) return;

        const index = parseInt(card.getAttribute('data-index'), 10);
        const block = window.getActiveBlocks()[index];
        if (!block) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        const on = window.toggleEditorBlockSelected(block);
        card.classList.toggle('block-card-selected', on);
        renderBlockSelectionBar();
    });

    // The selection bar's buttons. stopImmediatePropagation: the general handler
    // below is on this same element and reads closest('.block-card'), which is null
    // for the bar, so it would throw once per button.
    blockList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-selection-action]');
        if (!btn) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        switch (btn.getAttribute('data-selection-action')) {
            case 'clear':
                window.clearEditorBlockSelection();
                renderBlockList();
                break;
            case 'copy':
                if (window.copySelectedBlocks()) flashSelectedCards();
                break;
            case 'delete':
                if (!(await window.confirmDelete(selectionDeleteMessage()))) break;
                if (window.deleteSelectedBlocks()) {
                    renderBlockList();
                    updateLivePreview();
                }
                break;
            case 'up':
            case 'down':
                if (window.moveSelectedBlocks(btn.getAttribute('data-selection-action') === 'up' ? -1 : 1)) {
                    renderBlockList();
                    updateLivePreview();
                }
                break;
        }
    });

    // Copy changes nothing on screen, so the cards it took flash.
    function flashSelectedCards() {
        blockList.querySelectorAll('.block-card-selected').forEach(card => {
            card.classList.add('block-card-copied');
            setTimeout(() => card.classList.remove('block-card-copied'), 400);
        });
    }
    // Section Box controls, ahead of the general handler, which would fire for
    // these too.
    blockList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-sbox-intro], [data-sbox-edit], [data-sbox-remove], [data-sbox-add]');
        if (!btn) return;

        const card = btn.closest('.block-card');
        if (!card) return;
        const index = parseInt(card.getAttribute('data-index'), 10);
        const block = window.getActiveBlocks()[index];
        if (!block || block.type !== 'sectionedbox') return;

        e.preventDefault();
        e.stopImmediatePropagation(); // the general handler is on this element too

        // Going in changes no data, so no history snapshot.
        if (btn.hasAttribute('data-sbox-intro')) {
            window.enterBlockContainer(index, 'intro');
            return;
        }
        if (btn.hasAttribute('data-sbox-edit')) {
            const at = parseInt(btn.getAttribute('data-sbox-edit'), 10);
            window.enterBlockContainer(index, `sections.${at}.content`);
            return;
        }

        if (btn.hasAttribute('data-sbox-remove')
            && !(await window.confirmDelete('Delete this section and every block in it?'))) return;

        window.saveBlockHistory();
        if (btn.hasAttribute('data-sbox-add')) {
            if (!Array.isArray(block.sections)) block.sections = [];
            block.sections.push({ title: `Section ${block.sections.length + 1}`, content: [] });
        } else {
            const at = parseInt(btn.getAttribute('data-sbox-remove'), 10);
            if (Array.isArray(block.sections)) block.sections.splice(at, 1);
        }
        renderBlockList();
        updateLivePreview();
    });

    // Combo Card sections, the same way. The one on screen is never stored.
    blockList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cardsec], [data-cardsec-add], [data-cardsec-remove], [data-cardsec-edit]');
        if (!btn) return;

        const card = btn.closest('.block-card');
        if (!card) return;
        const index = parseInt(card.getAttribute('data-index'), 10);
        const block = window.getActiveBlocks()[index];
        if (!block || block.type !== 'theorybox') return;

        e.preventDefault();
        e.stopImmediatePropagation(); // the general handler is on this element too

        // Descending and switching tab change no data, so neither snapshots.
        if (btn.hasAttribute('data-cardsec-edit')) {
            const at = parseInt(btn.getAttribute('data-cardsec-edit'), 10);
            window.enterBlockContainer(index, at >= 0 ? `sections.${at}.content` : null);
            return;
        }
        if (btn.hasAttribute('data-cardsec')) {
            window.setEditorCardSection(block, parseInt(btn.getAttribute('data-cardsec'), 10));
            renderBlockList();
            return;
        }

        if (btn.hasAttribute('data-cardsec-remove')
            && !(await window.confirmDelete('Delete this section of the card and everything in it?'))) return;

        window.saveBlockHistory();
        if (btn.hasAttribute('data-cardsec-add')) {
            if (!Array.isArray(block.sections)) block.sections = [];
            block.sections.push({ label: `Section ${block.sections.length + 1}`, title: '', sequence: [], content: [] });
            // Open on the new one: it was added to be written in.
            window.setEditorCardSection(block, block.sections.length - 1);
        } else {
            const at = parseInt(btn.getAttribute('data-cardsec-remove'), 10);
            if (Array.isArray(block.sections) && block.sections.length > 1) {
                block.sections.splice(at, 1);
                window.setEditorCardSection(block, Math.max(0, at - 1));
            }
        }
        renderBlockList();
        updateLivePreview();
    });

    // A section's tab label. No re-render while typing: it would take the focus.
    blockList.addEventListener('input', (e) => {
        const field = e.target.closest('[data-cardsec-label]');
        if (!field) return;

        const card = field.closest('.block-card');
        if (!card) return;
        const block = window.getActiveBlocks()[parseInt(card.getAttribute('data-index'), 10)];
        if (!block || block.type !== 'theorybox' || !Array.isArray(block.sections)) return;

        const at = parseInt(field.getAttribute('data-cardsec-label'), 10);
        if (!block.sections[at]) return;
        block.sections[at].label = field.value;
        updateLivePreview();
    });

    // Notation styles on the Combo Block and Combo Card forms. Ahead of the general
    // input handler, which writes `target[data-field]`, and these fields have none.
    const notationTarget = (el) => {
        const card = el.closest('.block-card');
        if (!card) return null;
        const block = window.getActiveBlocks()[parseInt(card.getAttribute('data-index'), 10)];
        if (!block || (block.type !== 'combo' && block.type !== 'theorybox')) return null;
        // A Combo Card in Multiple Sections edits the section on screen.
        return window.editorCardFieldTarget(block);
    };

    blockList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-nstyle-add], [data-nstyle-remove]');
        if (!btn) return;
        const item = notationTarget(btn);
        if (!item) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        if (btn.hasAttribute('data-nstyle-remove')
            && !(await window.confirmDelete('Delete this notation style?'))) return;

        window.saveBlockHistory();
        const index = btn.closest('.block-card').getAttribute('data-index');
        const focusAt = window.applyComboNotationClick(item, btn);
        renderBlockList();
        updateLivePreview();
        window.focusComboNotationField(blockList.querySelector(`.block-card[data-index="${index}"]`), focusAt);
    });

    let notationTypingTimer;
    blockList.addEventListener('input', (e) => {
        const item = (e.target.matches && e.target.matches('[data-nstyle-label], [data-nstyle-route]'))
            ? notationTarget(e.target) : null;
        if (!item) return;
        e.stopImmediatePropagation();
        if (e.target.classList.contains('editor-textarea')) window.autoSizeEditorTextarea(e.target);
        window.applyComboNotationInput(item, e.target);
        clearTimeout(notationTypingTimer);
        notationTypingTimer = setTimeout(() => { notationTypingTimer = null; updateLivePreview(); }, 400);
    });

    // The names under a style field are counted from the page's data, which only
    // gets a just-typed name once the wait above runs out. Runs before the
    // document's focusin listener draws them.
    blockList.addEventListener('focusin', (e) => {
        if (!notationTypingTimer || !e.target.matches('[data-nstyle-label]')) return;
        clearTimeout(notationTypingTimer);
        notationTypingTimer = null;
        updateLivePreview();
    });

    // A section's title. No renderBlockList: it would take the focus and the caret.
    blockList.addEventListener('input', (e) => {
        const field = e.target.closest('[data-sbox-title]');
        if (!field) return;

        const card = field.closest('.block-card');
        if (!card) return;
        const block = window.getActiveBlocks()[parseInt(card.getAttribute('data-index'), 10)];
        if (!block || !Array.isArray(block.sections)) return;

        const at = parseInt(field.getAttribute('data-sbox-title'), 10);
        if (!block.sections[at]) return;
        block.sections[at].title = field.value;
        updateLivePreview();
    });

    if (window.editorBlockObserver) window.editorBlockObserver.disconnect();
    
    window.editorBlockObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            if (entry.isIntersecting) {
                card.classList.remove('virtual-unloaded');
                card.style.height = ''; 
            } else {
                const rect = card.getBoundingClientRect();
                if (rect.height > 50) { 
                    card.style.height = rect.height + 'px';
                    card.classList.add('virtual-unloaded');
                }
            }
        });
    }, { 
        // Whatever scrolls the Workspace: Config's sticky settings move the scroll, and
        // a root that does not scroll counts every card as on screen.
        root: (typeof window.editorScrollBox === 'function' && window.editorScrollBox())
            || document.getElementById('interactive-builder'), 
        rootMargin: '800px 0px' 
    });

    let lastFocusedInput = null;
    let lastSelection = { start: 0, end: 0 };
    
    // On the whole builder: the Gallery bin is a sibling of #block-list. The guard
    // below decides, not the host.
    container.addEventListener('focusin', (e) => {
        // Inside a card or a Gallery bin row only: the toolbar writes into whatever was
        // last focused, and a folder's name is not content.
        if (!e.target.closest) return;
        if (!e.target.closest('.block-card') && !e.target.closest('.gallery-bin-row')) return;
        if(e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
            lastFocusedInput = e.target;
        }
    });
    const saveSelection = (e) => {
        if(e.target === lastFocusedInput) {
            lastSelection.start = lastFocusedInput.selectionStart;
            lastSelection.end = lastFocusedInput.selectionEnd;
        }
    };
    container.addEventListener('mouseup', saveSelection);
    container.addEventListener('keyup', saveSelection);

    // Applies a Ctrl+key format to a field already found to be content.
    const formatHotkey = (e) => {
        let formatTag = null;
        if (e.key.toLowerCase() === 'b') formatTag = 'b';
        else if (e.key.toLowerCase() === 'i') formatTag = 'i';
        else if (e.key.toLowerCase() === 'u') formatTag = 'u';
        else if (e.key === '5') formatTag = 's';
        else if (e.key.toLowerCase() === 'c' && e.shiftKey) formatTag = 'code';
        else if (e.key.toLowerCase() === 'k') formatTag = 'url';

        if (formatTag) {
            e.preventDefault(); // not the browser's own save or bold
            
            lastFocusedInput = e.target;
            lastSelection.start = e.target.selectionStart;
            lastSelection.end = e.target.selectionEnd;
            applyFormat(formatTag);
        }
    };

    container.addEventListener('keydown', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
        if (!isInput) return;
        // Content fields only: this listener covers the whole builder, colour hex and
        // link search included.
        if (!e.target.closest('.block-card') && !e.target.closest('.gallery-bin-row')) return;

        formatHotkey(e);
    });

    // Fields outside the builder carry `data-format-field` (the Combo Card's Name,
    // drawn above its write-up). On `document`, and replaced on every init, so a tab
    // switch never leaves one holding the previous builder.
    const outsideField = (el) => !!(el && el.matches && el.matches('[data-format-field]')
        && !container.contains(el));
    if (window._formatFieldHandlers) {
        Object.entries(window._formatFieldHandlers)
            .forEach(([type, fn]) => document.removeEventListener(type, fn));
    }
    window._formatFieldHandlers = {
        focusin: (e) => { if (outsideField(e.target)) lastFocusedInput = e.target; },
        mouseup: (e) => { if (outsideField(e.target)) saveSelection(e); },
        keyup: (e) => { if (outsideField(e.target)) saveSelection(e); },
        keydown: (e) => {
            if ((e.ctrlKey || e.metaKey) && outsideField(e.target)) formatHotkey(e);
        },
    };
    Object.entries(window._formatFieldHandlers)
        .forEach(([type, fn]) => document.addEventListener(type, fn));

    // Hover copy and paste. The previous tab's listener goes first.
    if (window._blockCopyPasteHandler) {
        document.removeEventListener('keydown', window._blockCopyPasteHandler);
    }
    
    window._blockCopyPasteHandler = (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        // Blocks only: a paste here would redraw #block-list over the Gallery bin.
        if (window.editorBuilderMode === 'gallery') return;

        const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

        // A focused field keeps the browser's own text copy and paste.
        if (!isInput) {
            // #block-list only: other tabs draw .block-card too, and would index the wrong array.
            const hovered = () => document.querySelector('#block-list .block-card:hover');

            if (e.key.toLowerCase() === 'c' && !e.shiftKey) {
                // A selection wins over the hover: once an author has said which Blocks, the
                // one under the pointer must not overrule them.
                if (window.copySelectedBlocks()) {
                    e.preventDefault();
                    flashSelectedCards();
                    return;
                }

                const card = hovered();
                if (card) {
                    const index = parseInt(card.getAttribute('data-index'));
                    const block = window.getActiveBlocks()[index];
                    if (!block) return;
                    window.copiedWikiBlocks = [JSON.parse(JSON.stringify(block))];

                    card.classList.add('block-card-copied');
                    setTimeout(() => card.classList.remove('block-card-copied'), 400);
                    e.preventDefault();
                }
            }
            else if (e.key.toLowerCase() === 'v' && !e.shiftKey) {
                if (Array.isArray(window.copiedWikiBlocks) && window.copiedWikiBlocks.length) {
                    e.preventDefault();

                    const card = hovered();
                    // Under the hovered card, or at the end.
                    const after = card ? parseInt(card.getAttribute('data-index')) : -1;
                    if (window.pasteCopiedBlocks(after)) {
                        renderBlockList();
                        updateLivePreview();
                    }
                }
            }
        }
    };
    
    document.addEventListener('keydown', window._blockCopyPasteHandler);

    // Delete removes the selection, after asking. Its own handler, cleared and
    // registered on each init. Never Backspace: to many people it means "go back".
    if (window._blockSelectionKeyHandler) {
        document.removeEventListener('keydown', window._blockSelectionKeyHandler);
    }

    window._blockSelectionKeyHandler = (e) => {
        if (window.editorBuilderMode === 'gallery') return;
        if (e.key !== 'Delete' || e.ctrlKey || e.metaKey || e.altKey) return;

        const el = document.activeElement;
        if (el && (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable)) return;
        if (!window.getSelectedBlockIndices().length) return;

        e.preventDefault();
        window.confirmDelete(selectionDeleteMessage()).then((ok) => {
            if (ok && window.deleteSelectedBlocks()) {
                renderBlockList();
                updateLivePreview();
            }
        });
    };

    document.addEventListener('keydown', window._blockSelectionKeyHandler);

    const formatToolbar = container.querySelector('.format-toolbar');
    
    formatToolbar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.format-btn') || e.target.closest('.color-preset-btn')) e.preventDefault(); 
    });

    const applyFormat = async (tag, value = null, fallbackText = '') => {
        if (!lastFocusedInput) return;
        // Taken before the await: the link prompt is a modal, and focus moves meanwhile.
        const field = lastFocusedInput;
        const start = lastSelection.start !== undefined ? lastSelection.start : field.selectionStart;
        const end = lastSelection.end !== undefined ? lastSelection.end : field.selectionEnd;
        const text = field.value;
        // A section link with nothing highlighted is named after its section, never an
        // empty link nobody can see.
        const selectedText = text.substring(start, end) || fallbackText;

        let openTag = `[${tag}]`;

        if (tag === 'url' && !value) {
            const linkTarget = await window.customPrompt(
                'Enter the URL or relative path:', { placeholder: 'https://example.com  or  /characters/Boomcat/' });
            if (!linkTarget) return;
            openTag = `[url=${linkTarget}]`;
        } else if (value) {
            openTag = `[${tag}=${value}]`;
        }

        let closeTag = `[/${tag}]`;

        const newText = text.substring(0, start) + openTag + selectedText + closeTag + text.substring(end);
        field.value = newText;

        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
        // From the inserted text, so the caret is right when the fallback gave the label.
        field.setSelectionRange(start + openTag.length, start + openTag.length + selectedText.length);
    };

    // A tag that wraps nothing (a mini icon) goes in at the caret, before any
    // highlighted text, and the caret ends after it.
    const insertTag = (tag) => {
        if (!lastFocusedInput) return;
        const field = lastFocusedInput;
        const at = lastSelection.start !== undefined ? lastSelection.start : field.selectionStart;
        field.value = field.value.substring(0, at) + tag + field.value.substring(at);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
        field.setSelectionRange(at + tag.length, at + tag.length);
        lastSelection.start = lastSelection.end = at + tag.length;
    };

    formatToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.format-btn');
        if (btn && btn.hasAttribute('data-tag')) applyFormat(btn.getAttribute('data-tag'));
    });

    const colorBtn = container.querySelector('#btn-format-color');
    const colorPopup = container.querySelector('#format-color-popup');

    // Pulls the popup back inside whatever clips it. Measured, since the overflow
    // depends on where the button sits and how wide the pane is. Left is reset
    // first, and it only ever pulls left.
    function keepColorPopupOnScreen(popup) {
        popup.style.left = '';

        let clipper = popup.parentElement;
        while (clipper && clipper !== document.body) {
            const style = getComputedStyle(clipper);
            if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) break;
            clipper = clipper.parentElement;
        }
        const bounds = (clipper && clipper !== document.body)
            ? clipper.getBoundingClientRect()
            : { left: 0, right: window.innerWidth, top: 0 };
        const limit = Math.min(bounds.right, window.innerWidth) - 8;

        const overflow = popup.getBoundingClientRect().right - limit;
        if (overflow > 0) popup.style.left = `${-overflow}px`;

        // Upward too: the popup opens above its button in a scrolling pane, so the
        // presets' scroll region is capped to the room above. Measured, since the
        // swatches grow with the roster; the custom picker below it stays in view.
        const scroll = popup.querySelector('.format-color-presets-scroll');
        if (!scroll) return;

        scroll.style.maxHeight = '';
        const top = popup.getBoundingClientRect().top;
        const ceiling = Math.max(bounds.top, 0) + 8;
        if (top < ceiling) {
            const room = scroll.getBoundingClientRect().height - (ceiling - top);
            // Below this it would be a useless sliver: better clipped.
            scroll.style.maxHeight = `${Math.max(room, 80)}px`;
        }
    }

    if (colorBtn && colorPopup) {
        // Filled on open, so it is measured with the Recent row in it.
        const recentSlot = colorPopup.querySelector('[data-recent-slot]');
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPopup.classList.toggle('hidden');
            if (colorPopup.classList.contains('hidden')) return;
            if (recentSlot) recentSlot.innerHTML = recentColorsHTML(true);
            keepColorPopupOnScreen(colorPopup);
        });

        colorPopup.addEventListener('click', (e) => {
            // Not .color-preset-btn: every member of that class carries data-color (a test
            // checks), and the plain-colour handler would wrap a gradient in an empty [color=].
            const gradient = e.target.closest('.gradient-preset-btn');
            if (gradient) {
                const value = gradient.getAttribute('data-gradient');
                rememberColors(value.split(','));
                applyFormat('multicolor', value);
                colorPopup.classList.add('hidden');
                return;
            }

            const preset = e.target.closest('.color-preset-btn');
            if (preset) {
                rememberColors([preset.getAttribute('data-color')]);
                applyFormat('color', preset.getAttribute('data-color'));
                colorPopup.classList.add('hidden');
            }
        });

        // The popup, not the container: a side bar or folder popup repeats the ids.
        const gradientBuilder = wireGradientBuilder(colorPopup, (stops) => {
            rememberColors(stops);
            applyFormat('multicolor', stops.join(','));
            colorPopup.classList.add('hidden');
        });

        initColorPicker(container, (hex) => {
            rememberColors([hex]);
            applyFormat('color', hex);
            colorPopup.classList.add('hidden');
        }, gradientBuilder ? gradientBuilder.pickerChanged : null);

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-color-popup') && !e.target.closest('#btn-format-color')) {
                colorPopup.classList.add('hidden');
            }
        });
    }

    // The section link picker, from collectSectionTargets over desc_data: the editor
    // draws only the tab being edited, so a list from the page would stay in that tab.
    const jumpBtn = container.querySelector('#btn-format-jump');
    const jumpPopup = container.querySelector('#format-jump-popup');
    const jumpList = container.querySelector('#format-jump-list');
    const jumpSearch = container.querySelector('#format-jump-search');

    if (jumpBtn && jumpPopup && jumpList) {

        // A section title is contributor-written: data- attributes and a delegated
        // listener, never an inline handler.
        const itemHTML = (target, cls) =>
            `<button type="button" class="${cls}"
                     data-anchor="${window.escapeHtml(target.id)}"
                     data-title="${window.escapeHtml(target.title)}">${window.escapeHtml(target.title)}</button>`;

        const renderJumpList = (filter) => {
            const data = window.currentEditorDescData || window.editorMasterDescData || {};
            const frame = window.currentEditorFrameData || window.editorMasterFrameData || {};
            const all = typeof window.collectSectionTargets === 'function'
                ? window.collectSectionTargets(data, frame)
                : [];

            const needle = String(filter || '').trim().toLowerCase();
            const hit = (text) => text.toLowerCase().includes(needle);

            // A section stays when one of its headings matches, or the match would vanish
            // inside it.
            const shown = !needle ? all : all
                .map(t => {
                    const kids = t.children.filter(c => hit(c.title));
                    if (hit(t.title) || hit(t.tabLabel)) return { ...t, matchedChildren: kids };
                    if (kids.length) return { ...t, matchedChildren: kids, childOnly: true };
                    return null;
                })
                .filter(Boolean);

            if (!shown.length) {
                jumpList.innerHTML = `<p class="format-jump-empty">${
                    all.length ? 'No section matches that.' : 'This page has no named sections yet.'
                }</p>`;
                return;
            }

            // Two levels, like the table of contents, but shut by default: a filled-in page
            // has over a hundred headings, and the picker is for finding one.
            let html = '';
            let lastTab = null;
            shown.forEach(target => {
                if (target.tab !== lastTab) {
                    html += `<div class="format-jump-group">${window.escapeHtml(target.tabLabel)}</div>`;
                    lastTab = target.tab;
                }

                const children = needle ? (target.matchedChildren || []) : target.children;
                // Open when the search found the children, or the match would be hidden.
                const open = !!needle && children.length > 0;

                html += '<div class="format-jump-row">';
                html += itemHTML(target, 'format-jump-item');
                if (children.length) {
                    html += `<button type="button" class="format-jump-toggle" aria-expanded="${open}"
                                     aria-label="Sections inside ${window.escapeHtml(target.title)}">▼</button>`;
                }
                html += '</div>';

                if (children.length) {
                    html += `<div class="format-jump-children${open ? '' : ' hidden'}">`
                          + children.map(c => itemHTML(c, 'format-jump-item format-jump-item-minor')).join('')
                          + '</div>';
                }
            });
            jumpList.innerHTML = html;
        };

        jumpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = jumpPopup.classList.contains('hidden');
            jumpPopup.classList.toggle('hidden');
            if (!opening) return;
            if (jumpSearch) jumpSearch.value = '';
            renderJumpList('');
            keepColorPopupOnScreen(jumpPopup);
        });

        // The toolbar's mousedown guard covers .format-btn only, and the selection this
        // wraps dies once focus moves.
        jumpPopup.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.format-jump-search')) e.preventDefault();
        });

        if (jumpSearch) {
            jumpSearch.addEventListener('input', () => renderJumpList(jumpSearch.value));
        }

        jumpList.addEventListener('click', (e) => {
            const toggle = e.target.closest('.format-jump-toggle');
            if (toggle) {
                const children = toggle.parentElement && toggle.parentElement.nextElementSibling;
                if (!children) return;
                const open = children.classList.toggle('hidden') === false;
                toggle.setAttribute('aria-expanded', String(open));
                return;
            }

            const item = e.target.closest('.format-jump-item');
            if (!item) return;
            applyFormat('url', `#${item.getAttribute('data-anchor')}`, item.getAttribute('data-title'));
            jumpPopup.classList.add('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-jump-popup') && !e.target.closest('#btn-format-jump')) {
                jumpPopup.classList.add('hidden');
            }
        });
    }

    // The icon picker: the groups format_tags.js draws for [icon=]. A character
    // with no icon uploaded is left out, since its tag would come back as text.
    const iconBtn = container.querySelector('#btn-format-icon');
    const iconPopup = container.querySelector('#format-icon-popup');
    const iconList = container.querySelector('#format-icon-list');
    const iconSearch = container.querySelector('#format-icon-search');

    if (iconBtn && iconPopup && iconList) {
        // null until the roster and its icons are in, then [{ id, name, src }].
        let characters = null;
        let charactersFailed = false;

        const iconLoads = (src) => new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = src;
        });
        const loadCharacters = async () => {
            const roster = await window.loadCharacterRoster();
            const rows = [...roster.entries()]
                .filter(([, entry]) => !entry.hidden)
                .map(([id, entry]) => ({ id, name: entry.name, src: '/' + window.rosterIconPath(id) }));
            const uploaded = await Promise.all(rows.map(row => iconLoads(row.src)));
            return rows.filter((row, i) => uploaded[i]);
        };

        const renderIconList = (filter) => {
            const needle = String(filter || '').trim().toLowerCase();
            const hit = (name) => !needle || String(name).toLowerCase().includes(needle);
            const accolades = (window.ACCOLADES || []).filter(a => hit(a.name));
            const people = (characters || []).filter(c => hit(c.name));
            const site = (window.UI_ICONS || []).filter(i => hit(i.name) || hit(i.id));

            let html = '';
            if (accolades.length) {
                html += '<div class="format-jump-group">Accolades</div>' + accolades.map(a =>
                    `<button type="button" class="format-jump-item format-icon-item" data-icon="accolade/${window.escapeHtml(a.id)}">`
                    + `<span class="format-icon-glyph" style="color: ${window.escapeHtml(a.color)}">${window.accoladeIconHTML(a)}</span>`
                    + `<span>${window.escapeHtml(a.name)}</span></button>`).join('');
            }
            if (people.length) {
                html += '<div class="format-jump-group">Characters</div>' + people.map(c =>
                    `<button type="button" class="format-jump-item format-icon-item" data-icon="character/${window.escapeHtml(c.id)}">`
                    + `<img class="format-icon-character" src="${window.escapeHtml(c.src)}" alt="">`
                    + `<span>${window.escapeHtml(c.name)}</span></button>`).join('');
            } else if (!needle && (charactersFailed || !characters)) {
                html += '<div class="format-jump-group">Characters</div>' + (charactersFailed
                    ? '<p class="format-jump-empty">The characters could not be loaded.</p>'
                    : '<p class="loading-msg loading-msg-busy">Loading the characters...</p>');
            }
            // The site's own icons, [icon=ui/<id>], after the characters.
            if (site.length) {
                html += '<div class="format-jump-group">UI</div>' + site.map(i =>
                    `<button type="button" class="format-jump-item format-icon-item" data-icon="ui/${window.escapeHtml(i.id)}">`
                    + `<span class="format-icon-glyph">${window.uiIconHTML(i.id)}</span>`
                    + `<span>${window.escapeHtml(i.name)}</span></button>`).join('');
            }
            iconList.innerHTML = html || '<p class="format-jump-empty">No icon matches that.</p>';
        };

        iconBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = iconPopup.classList.contains('hidden');
            iconPopup.classList.toggle('hidden');
            if (!opening) return;
            if (iconSearch) iconSearch.value = '';
            renderIconList('');
            keepColorPopupOnScreen(iconPopup);
            if (characters || charactersFailed) return;
            loadCharacters().then(list => { characters = list; }, err => {
                console.error('The icon picker could not load the characters:', err);
                charactersFailed = true;
            }).then(() => {
                if (!iconPopup.classList.contains('hidden')) renderIconList(iconSearch ? iconSearch.value : '');
            });
        });

        // The selection the icon goes in at dies once focus moves.
        iconPopup.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.format-jump-search')) e.preventDefault();
        });
        if (iconSearch) iconSearch.addEventListener('input', () => renderIconList(iconSearch.value));

        iconList.addEventListener('click', (e) => {
            const item = e.target.closest('.format-icon-item');
            if (!item) return;
            insertTag(`[icon=${item.getAttribute('data-icon')}]`);
            iconPopup.classList.add('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-icon-popup') && !e.target.closest('#btn-format-icon')) {
                iconPopup.classList.add('hidden');
            }
        });
    }

    const btnToggleMenu = container.querySelector('#btn-toggle-add-menu');
    const popupMenu = container.querySelector('#add-block-popup');
    
    btnToggleMenu.addEventListener('click', () => {
        popupMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-block-menu-wrapper')) {
            popupMenu.classList.remove('active');
        }
    });

    blockList.addEventListener('change', (e) => {
        if (e.target.classList.contains('block-folder-name-input')
            && typeof window.renameBlockFolder === 'function') {
            // On change, not input: per keystroke it would rewrite every Block in the run
            // and redraw the list under the caret.
            const activeBlocks = window.getActiveBlocks();
            const from = e.target.getAttribute('data-folder');
            const to = window.normalizeFolderName(e.target.value);

            if (!to || to === from) { e.target.value = from; return; }

            window.saveBlockHistory();
            if (!window.renameBlockFolder(activeBlocks, from, to)) {
                // owner.html and tier-editor.html have no editorAlert; the field snapping back
                // is the feedback everywhere.
                if (typeof window.editorAlert === 'function') {
                    window.editorAlert(`This section already has a folder called "${to}". Pick a different name.`);
                }
                e.target.value = from;
                return;
            }

            // Read the open state, then set it, so a renamed folder stays as it was.
            const wasOpen = !window.isBlockFolderCollapsed(from);
            window.setBlockFolderCollapsed(from, true);
            window.setBlockFolderCollapsed(to, !wasOpen);
            renderBlockList();
            updateLivePreview();
            return;
        }

        if (e.target.classList.contains('block-type-selector')) {
            const activeBlocks = window.getActiveBlocks(); 
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const newType = e.target.value;
            const oldBlock = activeBlocks[index]; 

            let newBlock = window.spawnBlockWithAuthor(newType);
            if (oldBlock.author !== undefined && newBlock.author !== undefined) {
                newBlock.author = oldBlock.author; 
            }
            
            let oldText = "";
            if (oldBlock.content !== undefined && !Array.isArray(oldBlock.content[0])) {
                oldText = Array.isArray(oldBlock.content) ? oldBlock.content.join('\n') : oldBlock.content;
            } else if (oldBlock.items !== undefined) {
                oldText = Array.isArray(oldBlock.items) ? oldBlock.items.join('\n') : oldBlock.items;
            }

            if (oldText) {
                if (newType === 'paragraph' || newType === 'callout') newBlock.content = oldText.split('\n');
                else if (newType === 'heading') newBlock.content = oldText.replace(/\n/g, ' '); 
                else if (newType === 'list') newBlock.items = oldText.split('\n').filter(i => i.trim() !== '');
                else if (newType === 'accordion') newBlock.content[0].content = oldText.split('\n');
            }

            activeBlocks[index] = newBlock; 
            renderBlockList();
            updateLivePreview();
            return; 
        }

        if (e.target.classList.contains('editor-select') && e.target.hasAttribute('data-field')) {
            const card = e.target.closest('.block-card');
            if (!card) return;
            const index = parseInt(card.getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');
            const block = window.getActiveBlocks()[index];

            // A Collaborator's kind decides its form's fields, so it redraws.
            if (field === 'kind' && block.type === 'collaborator') {
                block.kind = e.target.value === 'line' ? 'line' : 'card';
                renderBlockList();
                updateLivePreview();
                return;
            }

            block[field] = e.target.value;

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => { updateLivePreview(); }, 400);
        }
    });

    popupMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-block-btn')) {
            const type = e.target.getAttribute('data-type');
            const newBlock = window.spawnBlockWithAuthor(type);

            window.getActiveBlocks().push(newBlock); 
            
            renderBlockList();
            updateLivePreview();
            popupMenu.classList.remove('active'); 
        }
    });

    // Dragging, with pointer events so mouse and touch share one path (native drag
    // and drop never fires from touch). An Add Block button spawns a Block, a card's
    // handle moves one, and both feed the same drop logic.
    const DRAG_THRESHOLD = 6; // px of movement before a press is a drag, not a tap
    // The left-edge grab strip when the handle is hidden. Must match the width of
    // .block-card::before in style/editor.css.
    const BLOCK_DRAG_EDGE_PX = 12;

    // The order of the tests is the design: the nesting strip is inside a card, so
    // it comes first; a folder header is outside every card, so it comes last.
    const NO_DROP = {
        card: null, dropIndex: null, isBottom: false,
        folderHead: null, headEl: null, nestInto: null, nestEl: null,
    };

    // allowNest is false for a whole folder, which cannot go inside a Block.
    function computeDropTarget(clientX, clientY, allowNest = true) {
        const under = document.elementFromPoint(clientX, clientY);
        if (!under) return NO_DROP;

        // An accordion's or a Combo Card's "EDIT INNER BLOCKS" strip: a drop there goes
        // inside that Block.
        const nest = allowNest && under.closest('.accordion-inner-block-wrapper');
        if (nest) {
            const host = nest.closest('.block-card');
            if (host) {
                return Object.assign({}, NO_DROP, {
                    nestInto: parseInt(host.getAttribute('data-index')),
                    nestEl: nest,
                });
            }
        }

        const card = under.closest('.block-card');
        if (!card) {
            // A folder header is a target: the only way into a shut folder.
            const head = under.closest('.block-folder-head');
            const shell = head ? head.closest('.block-folder') : null;
            return Object.assign({}, NO_DROP, {
                folderHead: shell ? shell.getAttribute('data-folder') : null,
                headEl: head || null,
            });
        }

        const bounding = card.getBoundingClientRect();
        const isBottom = clientY > bounding.y + bounding.height / 2;
        const cardIndex = parseInt(card.getAttribute('data-index'));
        return Object.assign({}, NO_DROP, {
            card,
            dropIndex: isBottom ? cardIndex + 1 : cardIndex,
            isBottom,
        });
    }

    // Marks where a Block landed, a frame later so it lands on the new card. With
    // wholeFolder, the folder flashes, since a shut one shows no cards.
    function flashMovedBlock(index, wholeFolder = false) {
        requestAnimationFrame(() => {
            const found = document.querySelector(`#block-list .block-card[data-index="${index}"]`);
            const card = wholeFolder && found ? found.closest('.block-folder') : found;
            if (!card) return;
            card.classList.remove('block-just-moved');
            void card.offsetWidth; // restarts the animation if the same card moves twice
            card.classList.add('block-just-moved');
            setTimeout(() => card.classList.remove('block-just-moved'), 1400);
        });
    }

    // Where a dragged folder would land: the slot before which it goes, out of any
    // other folder, and what to mark there. Null over nothing, or where it already is.
    function folderDropAt(clientX, clientY, ownRun) {
        const target = computeDropTarget(clientX, clientY, false);
        let raw = null;
        if (target.card) raw = target.dropIndex;
        else if (target.headEl) {
            // A folder's header: just above that folder.
            const first = target.headEl.closest('.block-folder').querySelector('.block-card[data-index]');
            if (first) raw = parseInt(first.getAttribute('data-index'), 10);
        }
        if (raw === null) return null;

        const blocks = window.getActiveBlocks();
        const slot = window.folderDropSlot(blocks, raw);
        if (ownRun && slot >= ownRun.start && slot <= ownRun.end + 1) return null;

        const atEnd = slot >= blocks.length;
        const card = blockList.querySelector(`.block-card[data-index="${atEnd ? blocks.length - 1 : slot}"]`);
        if (!card) return null;
        return {
            slot,
            mark: card.closest('.block-folder') || card,
            edge: atEnd ? 'drag-over-bottom' : 'drag-over-top',
        };
    }

    function finishFolderDrop(payload, slot) {
        if (slot === null) return;
        const activeBlocks = window.getActiveBlocks();
        const run = window.blockFolderRunContaining(activeBlocks, payload.folderFrom);
        if (!run || (slot >= run.start && slot <= run.end + 1)) return;
        // The state before the move, so UNDO steps back over exactly this move.
        window.saveBlockHistory();
        const landedAt = window.moveBlockFolder(activeBlocks, payload.folderFrom, slot);
        renderBlockList();
        updateLivePreview();
        flashMovedBlock(landedAt, true);
    }

    // A drag moves an array element and says nothing of folders, so every landing
    // is settled: dropped between two members it joins, dragged clear it leaves.
    // Otherwise the run splits into two folders with one name.
    function settleFolderAt(blocks, index) {
        if (index < 0) return;
        if (typeof window.reconcileFolderAt === 'function') {
            window.reconcileFolderAt(blocks, index);
        }
    }

    // A Block a drop can go inside: one with a `content` array, so a new container
    // type works here without a change.
    function nestHost(blocks, index) {
        if (index === null || index === undefined || index < 0) return null;
        const host = blocks[index];
        if (!host) return null;
        if (!Array.isArray(host.content)) return null;
        return host;
    }

    function finishBlockDrop(payload, dropIndex, folderHead, nestInto) {
        const activeBlocks = window.getActiveBlocks();

        if (payload.blockType) {
            window.saveBlockHistory(); // before the change
            const newBlock = window.spawnBlockWithAuthor(payload.blockType);
            let landedAt;
            if (nestHost(activeBlocks, nestInto)) {
                activeBlocks[nestInto].content.push(newBlock);
                landedAt = nestInto;
            } else if (folderHead) {
                const run = typeof window.blockFolderRunNamed === 'function'
                    ? window.blockFolderRunNamed(activeBlocks, folderHead)
                    : null;
                landedAt = run ? run.start : activeBlocks.length;
                newBlock.folder = folderHead;
                const folderColor = typeof window.blockFolderColor === 'function'
                    ? window.blockFolderColor(activeBlocks, folderHead) : '';
                if (folderColor) newBlock.folderColor = folderColor;
                activeBlocks.splice(landedAt, 0, newBlock);
            } else if (dropIndex === null) {
                activeBlocks.push(newBlock);
                landedAt = activeBlocks.length - 1;
            } else {
                activeBlocks.splice(dropIndex, 0, newBlock);
                landedAt = dropIndex;
                settleFolderAt(activeBlocks, landedAt);
            }
            renderBlockList();
            updateLivePreview();
            flashMovedBlock(landedAt);
        } else if (nestHost(activeBlocks, nestInto) && payload.fromIndex !== nestInto) {
            // Into an accordion: a level of its own, unlike a folder.
            window.saveBlockHistory();
            const item = activeBlocks.splice(payload.fromIndex, 1)[0];
            // A folder belongs to the level the Block left.
            delete item.folder;
            delete item.folderColor;
            const hostIndex = payload.fromIndex < nestInto ? nestInto - 1 : nestInto;
            activeBlocks[hostIndex].content.push(item);
            renderBlockList();
            updateLivePreview();
            flashMovedBlock(hostIndex);
        } else if (folderHead && typeof window.dropBlockIntoFolderHead === 'function') {
            window.saveBlockHistory();
            const landedAt = window.dropBlockIntoFolderHead(activeBlocks, payload.fromIndex, folderHead);
            if (landedAt < 0) return;
            renderBlockList();
            updateLivePreview();
            flashMovedBlock(landedAt);
        } else if (dropIndex !== null) {
            let target = dropIndex;
            if (payload.fromIndex < target) target--;
            if (payload.fromIndex !== target) {
                window.saveBlockHistory();
                const item = activeBlocks.splice(payload.fromIndex, 1)[0];
                activeBlocks.splice(target, 0, item);
                settleFolderAt(activeBlocks, target);
                renderBlockList();
                updateLivePreview();
                flashMovedBlock(target);
            }
        }
        // Empty space under the pointer: nothing happens.
    }

    // A drag ends in a click on the element it began on (the pointer was captured),
    // and on an Add Block button that click adds a second Block. Swallowed for this
    // gesture only: it comes in the same dispatch as the pointerup.
    function swallowClickAfterDrag(el) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    }

    // The whole drag for one pointerdown. It takes the browser's own event, since
    // setPointerCapture throws on a synthetic one, so the Add Block buttons and the
    // delegated card handles can share it. ghostLabel is the pill by the pointer.
    function startBlockPointerDrag(e, el, payload, ghostLabel) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX, startY = e.clientY;
        let dragging = false;
        let ghost = null;
        let currentCard = null;
        let lastDropIndex = null;
        let sourceCard = null;
        let currentHead = null;
        let lastFolderHead = null;
        let currentNest = null;
        let lastNestInto = null;
        // A whole folder drops between Blocks and folders, never into either.
        const movingFolder = payload.folderFrom !== undefined;
        const ownRun = movingFolder ? window.blockFolderRunContaining(window.getActiveBlocks(), payload.folderFrom) : null;
        let currentMark = null;
        let lastSlot = null;

        el.setPointerCapture(e.pointerId);

        function positionGhost(ev) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
        }

        function updateHighlight(ev) {
            if (movingFolder) {
                const drop = folderDropAt(ev.clientX, ev.clientY, ownRun);
                if (currentMark) currentMark.classList.remove('drag-over-top', 'drag-over-bottom');
                currentMark = drop ? drop.mark : null;
                if (currentMark) currentMark.classList.add(drop.edge);
                lastSlot = drop ? drop.slot : null;
                return;
            }
            const { card, dropIndex, isBottom, folderHead, headEl, nestInto, nestEl } = computeDropTarget(ev.clientX, ev.clientY);
            if (card !== currentCard) {
                if (currentCard) currentCard.classList.remove('drag-over-top', 'drag-over-bottom');
                currentCard = card;
            }
            if (card) {
                card.classList.toggle('drag-over-bottom', isBottom);
                card.classList.toggle('drag-over-top', !isBottom);
            }
            if (headEl !== currentHead) {
                if (currentHead) currentHead.classList.remove('drag-over-folder');
                currentHead = headEl;
                if (currentHead) currentHead.classList.add('drag-over-folder');
            }
            if (nestEl !== currentNest) {
                if (currentNest) currentNest.classList.remove('drag-over-nest');
                currentNest = nestEl;
                // Never a Block's own nesting strip: that drop is refused.
                if (currentNest && payload.fromIndex !== nestInto) {
                    currentNest.classList.add('drag-over-nest');
                }
            }
            lastDropIndex = dropIndex;
            lastFolderHead = folderHead;
            lastNestInto = nestInto;
        }

        function startDrag(ev) {
            dragging = true;
            popupMenu.classList.remove('active');
            if (payload.fromIndex !== undefined) {
                sourceCard = blockList.querySelector(`.block-card[data-index="${payload.fromIndex}"]`);
                if (sourceCard) sourceCard.classList.add('block-card-dragging');
            } else if (movingFolder) {
                const member = blockList.querySelector(`.block-card[data-index="${payload.folderFrom}"]`);
                sourceCard = member ? member.closest('.block-folder') : null;
                if (sourceCard) sourceCard.classList.add('block-card-dragging');
            }
            ghost = document.createElement('div');
            ghost.className = 'block-drag-ghost';
            ghost.textContent = ghostLabel;
            document.body.appendChild(ghost);
            positionGhost(ev);
        }

        function cleanup() {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onCancel);
            if (sourceCard) sourceCard.classList.remove('block-card-dragging');
            if (ghost) { ghost.remove(); ghost = null; }
            if (currentCard) currentCard.classList.remove('drag-over-top', 'drag-over-bottom');
            if (currentHead) currentHead.classList.remove('drag-over-folder');
            if (currentNest) currentNest.classList.remove('drag-over-nest');
            if (currentMark) currentMark.classList.remove('drag-over-top', 'drag-over-bottom');
        }

        function onMove(ev) {
            if (!dragging) {
                if (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD) {
                    startDrag(ev);
                } else {
                    return;
                }
            }
            positionGhost(ev);
            updateHighlight(ev);
        }

        function onUp() {
            const dropIndex = lastDropIndex;
            const folderHead = lastFolderHead;
            const nestInto = lastNestInto;
            const slot = lastSlot;
            cleanup();
            if (dragging) {
                swallowClickAfterDrag(el);
                if (movingFolder) finishFolderDrop(payload, slot);
                else finishBlockDrop(payload, dropIndex, folderHead, nestInto);
            }
        }

        function onCancel() {
            cleanup();
        }

        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onCancel);
    }

    popupMenu.querySelectorAll('.add-block-btn').forEach(btn => {
        const blockType = btn.getAttribute('data-type');
        btn.addEventListener('pointerdown', (e) => {
            startBlockPointerDrag(e, btn, { blockType }, `+ ${blockType}`);
        });
    });

    // Delegated: a card's handle is redrawn with it. With handles hidden in Config,
    // a card's left edge is the handle: the strip is the card's border and padding.
    blockList.addEventListener('pointerdown', (e) => {
        // A whole folder: the handle on its header, or with handles hidden the
        // header's left edge.
        const folderHead = e.target.closest('.block-folder-head');
        if (folderHead) {
            const shell = folderHead.closest('.block-folder');
            const member = shell.querySelector('.block-card[data-index]');
            const handle = e.target.closest('.block-folder-handle');
            const onEdge = !handle && e.target === folderHead
                && window.editorConfig && window.editorConfig.get('hideDragHandle')
                && e.clientX - shell.getBoundingClientRect().left <= BLOCK_DRAG_EDGE_PX;
            if (!member || (!handle && !onEdge)) return;
            startBlockPointerDrag(e, handle || folderHead, { folderFrom: parseInt(member.getAttribute('data-index'), 10) }, 'Move folder');
            return;
        }

        const handle = e.target.closest('.drag-handle');
        const card = (handle || e.target).closest('.block-card');
        if (!card) return;
        const onEdge = !handle && e.target === card
            && window.editorConfig && window.editorConfig.get('hideDragHandle')
            && e.clientX - card.getBoundingClientRect().left <= BLOCK_DRAG_EDGE_PX;
        if (!handle && !onEdge) return;
        startBlockPointerDrag(e, handle || card, { fromIndex: parseInt(card.getAttribute('data-index')) }, 'Move block');
    });

    // The folder picker. Its own listener: the big click handler below reads
    // .block-card by data-index, which this needs neither of.
    blockList.addEventListener('click', (e) => {
        const trigger = e.target.closest('.block-folder-trigger');
        if (trigger) {
            const wrapper = trigger.closest('.block-folder-picker');
            const wasOpen = wrapper.classList.contains('open');
            blockList.querySelectorAll('.block-folder-picker.open')
                .forEach(w => w.classList.remove('open'));
            wrapper.classList.toggle('open', !wasOpen);
            return;
        }

        const option = e.target.closest('.folder-option');
        if (!option || typeof window.assignBlockToFolder !== 'function') return;

        const card = option.closest('.block-card');
        if (!card) return;

        const activeBlocks = window.getActiveBlocks();
        const index = parseInt(card.getAttribute('data-index'));
        const action = option.getAttribute('data-folder-action');

        // From a data attribute: the row's text is escaped for display.
        let name = '';
        if (action === 'pick') name = option.getAttribute('data-folder-name');
        else if (action === 'new') name = window.nextFolderName(activeBlocks, 'New Folder');

        window.saveBlockHistory();
        const landedAt = window.assignBlockToFolder(activeBlocks, index, name);
        renderBlockList();
        updateLivePreview();
        if (landedAt >= 0) flashMovedBlock(landedAt);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.block-folder-picker')) {
            document.querySelectorAll('.block-folder-picker.open')
                .forEach(w => w.classList.remove('open'));
        }
    });

    // The picked table cell: focusing a cell picks it, and any other field lets it
    // go. Buttons do neither, or -Row would drop the pick it acts on.
    blockList.addEventListener('focusin', (e) => {
        const cell = e.target.closest('.table-cell-input, .table-header-input');
        if (!cell && !e.target.closest('input, textarea, select')) return;

        const had = editorTablePick && editorTablePick.block;
        if (cell) {
            const card = cell.closest('.block-card');
            const block = window.getActiveBlocks()[parseInt(card.getAttribute('data-index'), 10)];
            const row = cell.classList.contains('table-header-input') ? null : parseInt(cell.getAttribute('data-row'), 10);
            editorTablePick = { block, row, col: parseInt(cell.getAttribute('data-col'), 10) };
            paintTablePick(card, block);
        } else {
            editorTablePick = null;
        }
        if (had && had !== (editorTablePick && editorTablePick.block)) {
            const oldCard = cardForEditorBlock(had);
            if (oldCard) paintTablePick(oldCard, had);
        }
    });

    let typingTimer;

    blockList.addEventListener('input', (e) => {
        if (e.target.classList.contains('editor-textarea')) {
            window.autoSizeEditorTextarea(e.target);
        }

        if (e.target.classList.contains('editor-input') || e.target.classList.contains('editor-textarea') || e.target.classList.contains('editor-select') || e.target.type === 'checkbox' || e.target.classList.contains('table-header-input') || e.target.classList.contains('table-cell-input')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');

            const activeBlocks = window.getActiveBlocks();

            if (e.target.classList.contains('table-header-input')) {
                const col = parseInt(e.target.getAttribute('data-col'));
                activeBlocks[index].headers[col] = e.target.value;
                updateLivePreview(); return;
            } 
            if (e.target.classList.contains('table-cell-input')) {
                const row = parseInt(e.target.getAttribute('data-row'));
                const col = parseInt(e.target.getAttribute('data-col'));
                activeBlocks[index].rows[row][col] = e.target.value;
                updateLivePreview(); return;
            }

            // The Multiple Sections switch belongs to the card, never to the section on
            // screen, and it redraws the form.
            if (field === 'multiSections') {
                const card = activeBlocks[index];
                card.multiSections = e.target.checked;
                seedCardSections(card, e.target.checked);
                renderBlockList();
                updateLivePreview();
                return;
            }

            // A Combo Card in Multiple Sections edits the section on screen.
            const target = window.editorCardFieldTarget(activeBlocks[index]);

            if (field === 'content-array') target.content = e.target.value.split('\n');
            else if (field === 'links-lines') {
                target.links = parseLinkLines(e.target.value);
                const note = e.target.closest('.block-card').querySelector('[data-links-note]');
                if (note) { note.textContent = collaboratorLinkNote(target.links); note.hidden = !note.textContent; }
            }
            // A route is an array of steps, one a line. Blank lines are dropped.
            else if (field === 'sequence-lines') target.sequence = e.target.value.split('\n').map(v => v.trim()).filter(Boolean);
            else if (field === 'list-items') target.items = e.target.value.split('\n').filter(i => i.trim() !== '');
            else if (field === 'combo-sequence') target.sequence = e.target.value.split(',').map(s => s.trim());
            else if (e.target.type === 'checkbox') target[field] = e.target.checked;
            else target[field] = e.target.value;

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                updateLivePreview(); 
            }, 400); 
        }
    });

    // Async for the delete confirmations only; the rest ends before the first await.
    blockList.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        // The swatch popup handles its own buttons (above).
        if (btn.closest('.swatch-popup')) return;
        if (btn.matches('[data-heading-bar]')) { openHeadingBarPopup(btn); return; }

        const activeBlocks = window.getActiveBlocks();
        window.saveBlockHistory();

        // Folder controls are in the shell's header, outside every card, so they go
        // before the data-index lookup, which would throw. A card's own button is inside
        // .block-folder too, hence the second half of the test.
        const folderShell = btn.closest('.block-folder');
        if (folderShell && !btn.closest('.block-card')) {
            const folderName = folderShell.getAttribute('data-folder');

            if (btn.matches('[data-folder-color]')) {
                openFolderColorPopup(btn, folderName);
                return;
            }

            if (btn.classList.contains('block-folder-toggle')) {
                if (typeof window.toggleBlockFolderCollapsed === 'function') {
                    window.toggleBlockFolderCollapsed(folderName);
                    renderBlockList();
                }
                return;
            }

            if (btn.classList.contains('block-folder-ungroup')
                && typeof window.ungroupBlockFolder === 'function') {
                window.ungroupBlockFolder(activeBlocks, folderName);
                renderBlockList();
                updateLivePreview();
                return;
            }

            // An empty folder touches no Block, so the preview stays.
            if (btn.classList.contains('block-folder-add')
                && typeof window.addPendingBlockFolder === 'function') {
                window.addPendingBlockFolder(activeBlocks, folderName);
                renderBlockList();
                return;
            }

            if (btn.classList.contains('block-folder-discard')
                && typeof window.dropPendingBlockFolder === 'function') {
                window.dropPendingBlockFolder(folderName);
                renderBlockList();
                return;
            }
            return;
        }

        // The table buttons act at the picked cell, or at the end with none picked.
        const tableAction = ['add-row', 'add-col', 'del-row', 'del-col']
            .find(kind => btn.classList.contains(`btn-table-${kind}`));
        if (tableAction) {
            const index = parseInt(btn.closest('.block-card').getAttribute('data-index'), 10);
            const table = activeBlocks[index];
            const pick = tablePickFor(table);
            const pickedRow = pick ? pick.row : null;
            const pickedCol = pick ? pick.col : null;

            if (tableAction === 'add-row') {
                // Below the picked cell; a header cell's "below" is the first row.
                const at = pick ? (pickedRow === null ? 0 : pickedRow + 1) : table.rows.length;
                table.rows.splice(at, 0, new Array(table.headers.length).fill(''));
                if (pick) editorTablePick = { block: table, row: at, col: pickedCol };
            } else if (tableAction === 'add-col') {
                const at = pickedCol !== null ? pickedCol + 1 : table.headers.length;
                table.headers.splice(at, 0, 'New');
                table.rows.forEach(r => r.splice(at, 0, ''));
                if (pick) editorTablePick = { block: table, row: pickedRow, col: at };
            } else if (tableAction === 'del-row') {
                const at = pickedRow !== null ? pickedRow : table.rows.length - 1;
                const message = pickedRow !== null ? `Delete row ${at + 1} of this table?` : 'Delete the bottom row of this table?';
                if (table.rows.length > 1 && await window.confirmDelete(message)) {
                    table.rows.splice(at, 1);
                    // The pick stays on the same place, now the next row.
                    if (pickedRow !== null) editorTablePick = { block: table, row: Math.min(at, table.rows.length - 1), col: pickedCol };
                }
            } else {
                const at = pickedCol !== null ? pickedCol : table.headers.length - 1;
                const message = pickedCol !== null ? `Delete column ${at + 1} of this table?` : 'Delete the right-hand column of this table?';
                if (table.headers.length > 1 && await window.confirmDelete(message)) {
                    table.headers.splice(at, 1);
                    table.rows.forEach(r => r.splice(at, 1));
                    if (pickedCol !== null) editorTablePick = { block: table, row: pickedRow, col: Math.min(at, table.headers.length - 1) };
                }
            }

            const before = tableButtonsTop(index);
            renderBlockList();
            keepTableButtonsInPlace(index, before);
            updateLivePreview();
            return;
        }

        if (btn.classList.contains('btn-collapse')) {
            const card = btn.closest('.block-card');
            const body = card.querySelector('.block-body');
            body.classList.toggle('minimized');
            card.classList.toggle('collapsed');
            btn.textContent = body.classList.contains('minimized') ? '□' : '-';

            // Recorded, or the next renderBlockList reopens it.
            const collapsedIdx = parseInt(card.getAttribute('data-index'), 10);
            const collapsedBlock = window.getActiveBlocks()[collapsedIdx];
            const nowOpen = !body.classList.contains('minimized');
            window.setEditorBlockExpanded(collapsedBlock, nowOpen);

            // Sized now: a textarea inside display:none reports a scrollHeight of 0.
            if (nowOpen) window.autoSizeEditorTextareasIn(card);
            return;
        }
        
        const index = parseInt(btn.closest('.block-card').getAttribute('data-index'));

        if (btn.classList.contains('align-btn')) {
            activeBlocks[index].align = btn.getAttribute('data-val'); 
            renderBlockList();
            updateLivePreview();
            return;
        }
        
        if (btn.classList.contains('btn-insert-below')) {
            const newBlock = window.spawnBlockWithAuthor('paragraph');
            activeBlocks.splice(index + 1, 0, newBlock);
            renderBlockList();
            updateLivePreview();
            return;
        }

        // A card in the selection hands its up, down and delete to the whole selection,
        // as a file manager does. A card outside it acts on itself.
        const wantsUp = btn.classList.contains('btn-up');
        const wantsDown = btn.classList.contains('btn-down');
        const wantsDelete = btn.classList.contains('btn-delete');

        if ((wantsUp || wantsDown || wantsDelete)
            && window.isEditorBlockSelected(activeBlocks[index])) {
            if (wantsDelete && !(await window.confirmDelete(selectionDeleteMessage()))) return;
            const changed = wantsDelete
                ? !!window.deleteSelectedBlocks()
                : window.moveSelectedBlocks(wantsUp ? -1 : 1);
            if (changed) {
                renderBlockList();
                updateLivePreview();
            }
            // Either way: a selection against the end must not move this card out of its run.
            return;
        }

        let movedTo = -1;
        if (btn.classList.contains('btn-up') && index > 0) {
            [activeBlocks[index - 1], activeBlocks[index]] = [activeBlocks[index], activeBlocks[index - 1]];
            movedTo = index - 1;
        } else if (btn.classList.contains('btn-down') && index < activeBlocks.length - 1) {
            [activeBlocks[index], activeBlocks[index + 1]] = [activeBlocks[index + 1], activeBlocks[index]];
            movedTo = index + 1;
        } else if (btn.classList.contains('btn-delete')) {
            const label = window.blockTypeLabel(activeBlocks[index].type);
            if (!(await window.confirmDelete(`Delete this ${label} block?`))) return;
            activeBlocks.splice(index, 1);
        } else {
            return;
        }

        // A swap moves both Blocks, and either can have crossed a folder's edge.
        if (movedTo >= 0) {
            settleFolderAt(activeBlocks, movedTo);
            settleFolderAt(activeBlocks, index);
        }

        renderBlockList();
        updateLivePreview();
    });

    renderBlockList();
}

// Textarea sizing, in one place for typing and for rendering: grow to fit, then
// stop at the cap and scroll. A field inside a shut Block (display:none) cannot
// be measured, so it is skipped and the expand handler sizes it.
const EDITOR_TEXTAREA_MAX_PX = 260;

// The nearest ancestor that scrolls, to put its position back after measuring.
function scrollableAncestorOf(el) {
    for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight <= n.clientHeight) continue;
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return n;
    }
    return null;
}

// Measuring collapses the field first (height:auto is its `rows` height, not its
// content's). Scrolled to the bottom, that shrinks the scroll range for a layout
// pass, the browser clamps scrollTop, and every keystroke would push the page up.
// So the scroll position is put back in the same task, before any frame paints.
function measureAndSize(ta) {
    const scroller = scrollableAncestorOf(ta);
    const keepTop = scroller ? scroller.scrollTop : 0;

    ta.style.height = 'auto';
    const wanted = ta.scrollHeight;
    ta.style.height = Math.min(wanted, EDITOR_TEXTAREA_MAX_PX) + 'px';
    ta.style.overflowY = wanted > EDITOR_TEXTAREA_MAX_PX ? 'auto' : 'hidden';

    if (scroller && scroller.scrollTop !== keepTop) scroller.scrollTop = keepTop;
}

/**
 * Sizes one textarea to its content, up to EDITOR_TEXTAREA_MAX_PX.
 * @since v0.16
 */
window.autoSizeEditorTextarea = function (ta) {
    if (!ta || ta.offsetParent === null) return;
    measureAndSize(ta);
};

window.autoSizeEditorTextareasIn = function (root) {
    if (!root) return;
    const fields = root.querySelectorAll('.editor-textarea');
    if (!fields.length) return;
    // One save and restore around the whole sweep: the clamp would add up per field.
    const scroller = scrollableAncestorOf(fields[0]);
    const keepTop = scroller ? scroller.scrollTop : 0;
    fields.forEach(window.autoSizeEditorTextarea);
    if (scroller && scroller.scrollTop !== keepTop) scroller.scrollTop = keepTop;
};

// A one-line field (a move name, a table cell, a combo's damage) widens over its
// neighbours while being edited and its text overflows, so it can be read. A
// negative margin gives back the width it adds, so nothing moves, and it is the
// same element throughout, so its handlers keep working. It stays inside the box
// that clips it and goes back to its size on blur.
const GROW_FIELD = 'input.editor-input[type="text"]';

function clipBoundsOf(el) {
    let left = 0;
    let right = document.documentElement.clientWidth;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') {
            const r = p.getBoundingClientRect();
            left = Math.max(left, r.left);
            right = Math.min(right, r.right);
        }
    }
    return { left, right };
}

function shrinkEditorField(el) {
    if (!el.classList.contains('editor-input-grown')) return;
    el.classList.remove('editor-input-grown');
    el.style.removeProperty('width');
    el.style.removeProperty('margin-right');
    el.style.removeProperty('left');
}

window.growEditorField = function (el) {
    shrinkEditorField(el);
    if (el.scrollWidth <= el.clientWidth + 1) return;

    const rect = el.getBoundingClientRect();
    const bounds = clipBoundsOf(el);
    const room = bounds.right - bounds.left - 8;
    // Borders and padding are outside clientWidth; 16px keeps the caret off the edge.
    const width = Math.min(el.scrollWidth + (rect.width - el.clientWidth) + 16, room);
    if (width <= rect.width) return;

    const pastRight = rect.left + width - (bounds.right - 4);
    const shift = pastRight > 0 ? Math.min(pastRight, Math.max(0, rect.left - bounds.left - 4)) : 0;

    el.classList.add('editor-input-grown');
    el.style.width = `${width}px`;
    el.style.marginRight = `${rect.width - width}px`;
    el.style.left = `${-shift}px`;
};

document.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches(GROW_FIELD)) window.growEditorField(e.target);
});
document.addEventListener('input', (e) => {
    if (e.target === document.activeElement && e.target.matches && e.target.matches(GROW_FIELD)) {
        window.growEditorField(e.target);
    }
});
document.addEventListener('focusout', (e) => {
    if (e.target.matches && e.target.matches(GROW_FIELD)) shrinkEditorField(e.target);
});

// A shut Block's one-line label, from the field its type keeps its meaning in (a
// table's headers, an image's caption, a container's title): "PARAGRAPH" five
// times in a row identifies nothing.
function blockSummary(block) {
    if (!block || typeof block !== 'object') return '';

    const firstText = (arr) => (Array.isArray(arr) && arr.length ? String(arr[0] || '') : '');
    const fileName = (src) => String(src || '').split('/').pop().split('?')[0];

    let text = '';
    switch (block.type) {
        case 'heading':
        case 'paragraph':
            text = block.content;
            break;
        case 'list':
            text = firstText(block.items);
            break;
        case 'table':
            text = firstText(block.headers);
            break;
        case 'image':
        case 'video':
        case 'youtube':
            text = block.caption || block.alt || fileName(block.src || block.url);
            break;
        case 'callout':
        case 'accordion':
        case 'theorybox':
            text = block.title;
            break;
        case 'author':
            text = block.author;
            break;
        case 'colorswatches': {
            const sets = window.COLOR_SWATCH_SETS || {};
            text = sets[block.set] || sets.characters;
            break;
        }
        case 'collaborator':
            text = block.name;
            break;
        default:
            text = block.title || block.content || '';
    }

    text = String(text == null ? '' : text)
        // Tags are stripped: in a dense list they are noise.
        .replace(/\[\/?[a-z][^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

// A Table Block's picked cell: -Row and -Col remove its row and column, +Row and
// +Col insert below and right of it, and with nothing picked all four act at the
// end. One pick in the Workspace, kept beside the data: it names the Block, so a
// re-render keeps it and an UNDO lets it go.
let editorTablePick = null; // { block, row, col }; row is null for a header cell

function tablePickFor(block) {
    if (!editorTablePick || editorTablePick.block !== block) return null;
    const { row, col } = editorTablePick;
    // A row or column can be gone from under the pick.
    const r = row !== null && row < block.rows.length ? row : null;
    const c = col !== null && col < block.headers.length ? col : null;
    return r === null && c === null ? null : { row: r, col: c };
}

// row is null for a header cell, which shares the picked column only.
function tablePickedClass(pick, row, col) {
    if (!pick) return '';
    return (row !== null && pick.row === row) || pick.col === col ? 'table-picked' : '';
}

function tableDeleteButtons(pick) {
    const row = pick && pick.row !== null ? pick.row + 1 : null;
    const col = pick && pick.col !== null ? pick.col + 1 : null;
    return {
        row: row ? { label: `⊟ -Row ${row}`, title: `Delete row ${row}` } : { label: '⊟ -Row', title: 'Delete Bottom Row' },
        col: col ? { label: `⊟ -Col ${col}`, title: `Delete column ${col}` } : { label: '⊟ -Col', title: 'Delete Right Column' },
    };
}

function cardForEditorBlock(block) {
    const blocks = window.getActiveBlocks();
    return Array.from(document.querySelectorAll('#block-list .block-card[data-index]'))
        .find(card => blocks[parseInt(card.getAttribute('data-index'), 10)] === block) || null;
}

// Drawn onto the table on screen. No re-render: it would take the caret out of
// the cell just clicked.
function paintTablePick(card, block) {
    const pick = tablePickFor(block);
    card.querySelectorAll('.block-table td').forEach(td => {
        const input = td.querySelector('input');
        if (!input) return;
        const row = input.classList.contains('table-header-input') ? null : parseInt(input.getAttribute('data-row'), 10);
        td.classList.toggle('table-picked', !!tablePickedClass(pick, row, parseInt(input.getAttribute('data-col'), 10)));
    });
    const del = tableDeleteButtons(pick);
    [['.btn-table-del-row', del.row], ['.btn-table-del-col', del.col]].forEach(([selector, look]) => {
        const button = card.querySelector(selector);
        if (!button) return;
        button.textContent = look.label;
        button.title = look.title;
    });
}

// The table buttons stay under the pointer: the table grows or shrinks above
// them, so the page scrolls by however far they moved, in the same task.
// Measured on the row of buttons, since a hovered button is lifted 1px.
function tableButtonsTop(index) {
    const row = document.querySelector(`#block-list .block-card[data-index="${index}"] .block-table-actions-row`);
    return row ? row.getBoundingClientRect().top : null;
}

// Every press aims at the spot the first one did: a scroll position is whole
// pixels and a row need not be, so aiming from the last landing adds up the
// misses. A scroll of a pixel or more in between starts a new aim.
let tableButtonsAim = null;

function keepTableButtonsInPlace(index, before) {
    const after = tableButtonsTop(index);
    if (before === null || after === null) return;
    if (tableButtonsAim && tableButtonsAim.index === index && Math.abs(tableButtonsAim.top - before) < 1) before = tableButtonsAim.top;
    tableButtonsAim = { index, top: before };
    if (after === before) return;
    const scroller = scrollableAncestorOf(document.querySelector(`#block-list .block-card[data-index="${index}"]`));
    if (scroller) scroller.scrollTop += after - before;
    else window.scrollBy(0, after - before);
}

// The shell around one folder run. The name is an input: renaming is the most
// common thing done to a folder. Every value here is contributor-written and
// lands in an attribute, so it is escaped; `color` has been through safeColor.
function folderShellHTML(run, isCollapsed, isEmpty, color) {
    const count = isEmpty ? 'empty' : `${run.count} block${run.count === 1 ? '' : 's'}`;

    // An empty folder has no Blocks to carry a colour.
    const colorSwatch = isEmpty ? '' : `
            <button type="button" class="block-folder-color${color ? '' : ' is-none'}" data-folder-color
                    title="Folder color" aria-label="Folder color" aria-expanded="false"${color ? ` style="background: ${color};"` : ''}></button>`;

    // An empty folder is not in the data, so removing it is a discard, not an
    // UNGROUP. Side buttons are glyphs, with title and aria-label so each has a
    // name; + FOLDER says what it makes, since a bare + was taken for the dropdown.
    const removeBtn = isEmpty
        ? `<button class="btn-sys btn-sys-regular block-folder-discard"
                   title="Discard this empty folder"
                   aria-label="Discard this empty folder">&#10007;</button>`
        : `<button class="btn-sys btn-sys-regular block-folder-ungroup"
                   title="Remove the folder and keep every block in it"
                   aria-label="Ungroup this folder, keeping its blocks">&#9003;</button>`;

    const body = isEmpty
        ? `<div class="block-folder-empty">Drag a block onto this header, or choose this folder on any block.</div>`
        : '';

    // Moves the whole folder. An empty one has nothing to move.
    const handle = isEmpty ? '' : `
            <span class="drag-handle block-folder-handle" title="Drag to move this folder">⠿</span>`;

    return `
        <div class="block-folder-head">${handle}
            <button class="btn-sys btn-sys-regular block-folder-toggle"
                    title="${isCollapsed ? 'Expand' : 'Collapse'} this folder"
                    aria-expanded="${isCollapsed ? 'false' : 'true'}">${isCollapsed ? '&#9656;' : '&#9662;'}</button>
            <input type="text" class="block-folder-name-input" value="${window.escapeHtml(run.name)}"
                   data-folder="${window.escapeHtml(run.name)}" maxlength="60"
                   aria-label="Folder name" title="Rename this folder">${colorSwatch}
            <span class="block-folder-count">${count}</span>
            <button class="btn-sys btn-sys-regular block-folder-add"
                    title="Create another folder after this one"
                    aria-label="Create another folder after this one">&#65291; FOLDER</button>
            ${removeBtn}
        </div>
        <div class="block-folder-body">${body}</div>
    `;
}

// The selection bar, drawn while something is selected: Ctrl-click cannot be
// discovered, so the bar is what says a selection exists and what it can do.
// Rebuilt in place, so toggling one card leaves the others alone.
function renderBlockSelectionBar() {
    const list = document.getElementById('block-list');
    if (!list) return;

    const existing = document.getElementById('block-selection-bar');
    const picked = typeof window.getSelectedBlockIndices === 'function'
        ? window.getSelectedBlockIndices()
        : [];

    if (!picked.length) {
        if (existing) existing.remove();
        return;
    }

    const bar = existing || document.createElement('div');
    if (!existing) {
        bar.id = 'block-selection-bar';
        bar.className = 'block-selection-bar';
    }
    // A count, not names: numbers need no escaping.
    bar.innerHTML = `
        <span class="block-selection-count">${picked.length} SELECTED</span>
        <div class="block-selection-actions">
            <button type="button" class="btn-sys btn-sys-regular" data-selection-action="up" title="Move the selection up">▲</button>
            <button type="button" class="btn-sys btn-sys-regular" data-selection-action="down" title="Move the selection down">▼</button>
            <button type="button" class="btn-sys btn-sys-regular" data-selection-action="copy" title="Copy the selection">COPY</button>
            <button type="button" class="btn-sys btn-sys-red" data-selection-action="delete" title="Delete the selection">DELETE</button>
            <button type="button" class="btn-sys btn-sys-regular" data-selection-action="clear" title="Clear the selection">CLEAR</button>
        </div>
    `;
    // Always the first row, also after a re-render.
    if (list.firstChild !== bar) list.insertBefore(bar, list.firstChild);
}

/**
 * Draws the Blocks on screen into #block-list, inside their folders, with the
 * selection bar on top.
 * @watch each card keeps its real array index in data-index, which every handler
 *   here reads, so folders never renumber Blocks
 */
function renderBlockList() {
    const listContainer = document.getElementById('block-list');
    listContainer.innerHTML = '';

    const activeBlocks = window.getActiveBlocks();

    const getAlignUI = (alignVal, defaultAlign = 'left') => {
        const align = alignVal || defaultAlign;
        return `
            <div class="align-group">
                <button class="align-btn ${align === 'left' ? 'active' : ''}" data-val="left" title="Align/Float Left">
                    ${window.uiIconHTML('align-left')}
                </button>
                <button class="align-btn ${align === 'center' ? 'active' : ''}" data-val="center" title="Align/Float Center">
                    ${window.uiIconHTML('align-center')}
                </button>
                <button class="align-btn ${align === 'right' ? 'active' : ''}" data-val="right" title="Align/Float Right">
                    ${window.uiIconHTML('align-right')}
                </button>
            </div>
        `;
    };

    if (window.activeAccordionPath.length > 0) {
        // Through getActiveBlocks' own resolver, so the banner and the list agree on
        // which level is on screen.
        let blocks = currentStrategyBlocks;
        let parentTitle = 'Accordion';
        let partLabel = '';

        for (let i = 0; i < window.activeAccordionPath.length; i++) {
            const step = window.activeAccordionPath[i];
            const idx = (step && typeof step === 'object') ? step.index : step;
            const host = blocks[idx];
            if (!host) break;

            const field = (step && typeof step === 'object') ? step.field : null;
            if (i === window.activeAccordionPath.length - 1) {
                parentTitle = host.title || 'Accordion';
                // Which part of a Section Box: an index alone names only the box.
                if (field === 'intro') {
                    partLabel = 'Introduction';
                } else if (field) {
                    const m = /^sections\.(\d+)\.content$/.exec(field);
                    const sec = m && Array.isArray(host.sections) ? host.sections[Number(m[1])] : null;
                    // The tab label first: the banner says which tab you are in.
                    if (sec) partLabel = sec.label || sec.title || `Section ${Number(m[1]) + 1}`;
                }
            }

            const nested = window.resolveNestedBlocks(host, field);
            if (!nested) break;
            blocks = nested;
        }

        // Escaped: the title is contributor-written and goes into insertAdjacentHTML.
        const heading = partLabel
            ? `${window.escapeHtml(parentTitle)} <span class="accordion-back-part">${window.escapeHtml(partLabel)}</span>`
            : window.escapeHtml(parentTitle);

        const backBtnHTML = `
            <div class="accordion-back-banner">
                <div>
                    <span class="accordion-back-label">EDITING INNER BLOCKS:</span>
                    <div class="accordion-back-title">${heading}</div>
                </div>
                <button class="btn-sys btn-sys-purple btn-purple-fill" onclick="window.activeAccordionPath.pop(); renderBlockList();">⮑ BACK TO PARENT</button>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', backBtnHTML);
    }

    // Block folders are contiguous runs, so the shell opens at run.start and closes
    // at run.end while each card keeps its real index.
    const folderRuns = typeof window.collectBlockFolders === 'function'
        ? window.collectBlockFolders(activeBlocks)
        : [];
    const opensAt = new Map();
    const closesAt = new Map();
    folderRuns.forEach(run => { opensAt.set(run.start, run); closesAt.set(run.end, run); });
    const folderNames = folderRuns.map(run => run.name);

    // Empty folders are session state, drawn after the folder they came from,
    // matched by name so a reorder cannot strand one. One whose anchor is gone
    // falls to the end.
    const pendingFolders = typeof window.pendingBlockFolders === 'function'
        ? window.pendingBlockFolders()
        : [];
    const realNames = new Set(folderNames);
    const pendingAfter = new Map();
    const pendingOrphans = [];
    pendingFolders.forEach(spec => {
        if (spec.after && realNames.has(spec.after)) {
            if (!pendingAfter.has(spec.after)) pendingAfter.set(spec.after, []);
            pendingAfter.get(spec.after).push(spec);
        } else {
            pendingOrphans.push(spec);
        }
    });

    const emitEmptyFolder = (spec) => {
        const isCollapsed = typeof window.isBlockFolderCollapsed === 'function'
            && window.isBlockFolderCollapsed(spec.name);
        const shell = document.createElement('div');
        shell.className = 'block-folder is-empty' + (isCollapsed ? ' is-collapsed' : '');
        shell.setAttribute('data-folder', spec.name);
        shell.innerHTML = folderShellHTML({ name: spec.name, count: 0 }, isCollapsed, true);
        listContainer.appendChild(shell);
    };

    // The list itself, or the open folder's body.
    let appendTarget = listContainer;

    // The way into a folder without dragging: a custom dropdown, so "no folder" and
    // "create new folder" do not look like two more folders, on the site's
    // .manga-select-* shell.
    const folderPickerHTML = (block) => {
        const own = typeof window.blockFolderName === 'function' ? window.blockFolderName(block) : '';
        const choices = [...new Set(folderNames.concat(pendingFolders.map(p => p.name)))];

        let rows = `<button type="button" class="manga-option folder-option folder-option-none${own ? '' : ' selected'}"
                            data-folder-action="none">No folder</button>`;
        if (choices.length) {
            rows += `<div class="folder-option-sep">Folders</div>`;
            rows += choices.map(n =>
                `<button type="button" class="manga-option folder-option folder-option-item${n === own ? ' selected' : ''}"
                         data-folder-action="pick" data-folder-name="${window.escapeHtml(n)}">${window.escapeHtml(n)}</button>`
            ).join('');
        }
        rows += `<button type="button" class="manga-option folder-option folder-option-new"
                         data-folder-action="new">&#65291; Create new folder</button>`;

        return `
            <div class="manga-select-wrapper block-folder-picker">
                <button type="button" class="block-folder-trigger${own ? ' has-folder' : ''}"
                        title="Put this block in a folder">${own ? window.escapeHtml(own) : 'No folder'}</button>
                <div class="manga-select-options">${rows}</div>
            </div>
        `;
    };

    activeBlocks.forEach((block, index) => {
        const isOpen = window.isEditorBlockExpanded(block);
        const card = document.createElement('div');
        card.className = 'block-card'
            + (isOpen ? '' : ' collapsed')
            + (window.isEditorBlockSelected(block) ? ' block-card-selected' : '');
        card.setAttribute('data-index', index);

            // A Block that is somehow off its page still names its own type.
            const typeOptions = Object.keys(blockTemplates).filter(t => window.blockOfferedHere(t) || t === block.type).map(t =>
                `<option value="${window.escapeHtml(t)}" ${block.type === t ? 'selected' : ''}>${window.escapeHtml(window.blockTypeLabel(t))}</option>`
            ).join('');

            let html = `
                <div class="block-header">
                    <div class="block-type-row">
                        <span class="drag-handle" title="Drag to reorder">⠿</span>
                        <select class="editor-select block-type-selector">
                            ${typeOptions}
                        </select>
                        <span class="block-type-badge block-type-label">${window.escapeHtml(window.blockTypeLabel(block.type))}</span>
                        ${folderPickerHTML(block)}
                    </div>
                <span class="block-card-summary" title="${window.escapeHtml(blockSummary(block))}">${window.escapeHtml(blockSummary(block))}</span>
                <div class="block-actions">
                    <button class="btn-sys btn-sys-green btn-insert-below" title="Insert Paragraph Below">⨁</button>
                    <button class="btn-sys btn-sys-regular btn-collapse" title="Minimize/Expand">${isOpen ? '-' : '□'}</button>
                    <button class="btn-sys btn-sys-regular btn-up" title="Move Up">▲</button>
                    <button class="btn-sys btn-sys-regular btn-down" title="Move Down">▼</button>
                    <button class="btn-sys btn-sys-red btn-delete" title="Delete">✖</button>
                </div>
            </div>
            <div class="block-body${isOpen ? '' : ' minimized'}">
        `;

        if (block.type === 'heading') {
            html += `
                <input type="text" class="editor-input block-heading-input" data-field="content" value="${window.escapeHtml(block.content)}" placeholder="Heading Text">
                <div class="editor-row">
                    <div>
                        <select class="editor-select" data-field="size">
                            <option value="h2" ${block.size === 'h2' ? 'selected' : ''}>Main Section (H2)</option>
                            <option value="h3" ${(!block.size || block.size === 'h3') ? 'selected' : ''}>Subsection (H3)</option>
                            <option value="h4" ${block.size === 'h4' ? 'selected' : ''}>Minor (H4)</option>
                        </select>
                    </div>
                    <div>${getAlignUI(block.align, 'left')}</div>
                </div>
                ${headingBarRowHTML(block)}
            `;
        }
        else if (block.type === 'paragraph') {
            const textValue = Array.isArray(block.content) ? block.content.join('\n') : block.content;
            html += `
                <textarea class="editor-textarea" data-field="content-array" placeholder="Enter paragraph. Use new lines to break array elements. Tip: Use [M1] for keybinds.">${window.escapeHtml(textValue)}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'list') {
            const listValue = Array.isArray(block.items) ? block.items.join('\n') : block.items;
            html += `
                <textarea class="editor-textarea" data-field="list-items" placeholder="Enter list items. Use a new line for each bullet point.">${window.escapeHtml(listValue)}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <label class="block-video-controls-label"><input type="checkbox" data-field="boxed" ${block.boxed ? 'checked' : ''}> Box this list</label>
            `;
        }
        else if (block.type === 'image') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${window.escapeHtml(block.src || '')}" placeholder="Image Path/URL (e.g. VesselPortrait.webp)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="alt" value="${window.escapeHtml(block.alt || '')}" placeholder="Alt Text (Required for accessibility)"></div>
                    <div><input type="text" class="editor-input" data-field="caption" value="${window.escapeHtml(block.caption || '')}" placeholder="Caption (Optional)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${window.escapeHtml(block.width || '100%')}" placeholder="Width (e.g. 50% or 400px)"></div>
                </div>
            `;
        }
        else if (block.type === 'video') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${window.escapeHtml(block.src)}" placeholder="Video URL (e.g. /medias/videos/NoNeutralCS.webm)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${window.escapeHtml(block.caption || '')}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${window.escapeHtml(block.width || '100%')}" placeholder="Width (e.g. 50%)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div class="block-video-controls-row">
                        <label class="block-video-controls-label"><input type="checkbox" data-field="controls" ${block.controls ? 'checked' : ''}> Show Controls</label>
                    </div>
                </div>
            `;
        }
        else if (block.type === 'youtube') {
            html += `
                <input type="text" class="editor-input" data-field="videoId" value="${window.escapeHtml(block.videoId || '')}" placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${window.escapeHtml(block.caption || '')}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${window.escapeHtml(block.width || '100%')}" placeholder="Width (e.g. 75%)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div></div>
                </div>
            `;
        }
        else if (block.type === 'combo') {
            const seq = block.sequence ? block.sequence.join(', ') : '';
            html += `
                <input type="text" class="editor-input" data-field="combo-sequence" value="${window.escapeHtml(seq)}" placeholder="Sequence (Comma separated: M1, M1, Skill)">
                ${window.comboNotationFieldsHTML(block, { lines: false })}
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="damage" value="${window.escapeHtml(block.damage || '')}" placeholder="Damage text (e.g. 40 DMG)"></div>
                    <div><input type="text" class="editor-input" data-field="note" value="${window.escapeHtml(block.note || '')}" placeholder="Condition/Note (e.g. Corner Only)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'table') {
            let tableHTML = `<div class="block-table-wrapper"><table class="block-table">`;
            const pick = tablePickFor(block);
            const del = tableDeleteButtons(pick);

            tableHTML += `<tr>`;
            block.headers.forEach((h, c) => {
                tableHTML += `<td class="${tablePickedClass(pick, null, c)}"><input type="text" class="editor-input table-header-input" data-col="${c}" value="${window.escapeHtml(h)}" placeholder="Header"></td>`;
            });
            tableHTML += `</tr>`;

            block.rows.forEach((r, rIdx) => {
                tableHTML += `<tr>`;
                r.forEach((cell, cIdx) => {
                    tableHTML += `<td class="${tablePickedClass(pick, rIdx, cIdx)}"><input type="text" class="editor-input table-cell-input" data-row="${rIdx}" data-col="${cIdx}" value="${window.escapeHtml(cell)}" placeholder="..."></td>`;
                });
                tableHTML += `</tr>`;
            });
            tableHTML += `</table></div>`;

            html += `
                ${tableHTML}
                <div class="block-table-actions-row">
                    <button class="btn-sys btn-sys-regular btn-table-add-row" title="Add Row Below">⊞ +Row</button>
                    <button class="btn-sys btn-sys-regular btn-table-add-col" title="Add Column Right">⊞ +Col</button>
                    <button class="btn-sys btn-sys-red btn-table-del-row" title="${del.row.title}">${del.row.label}</button>
                    <button class="btn-sys btn-sys-red btn-table-del-col" title="${del.col.title}">${del.col.label}</button>
                </div>
                <input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)">
            `;
        }
        else if (block.type === 'accordion') {
            const innerCount = block.content ? block.content.length : 0;
            html += `
                <input type="text" class="editor-input" data-field="title" value="${window.escapeHtml(block.title || '')}" placeholder="Accordion Title">
                <div class="editor-row editor-row-spaced-md">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" onclick="window.activeAccordionPath.push(${index}); renderBlockList();">
                        ⮑ EDIT INNER BLOCKS (${innerCount})
                    </button>
                </div>
            `;
        }
        // The Section Box: a title, one introduction and N sections. The introduction
        // and each section hold Blocks, reached the way an accordion's are, with the
        // step naming which array.
        else if (block.type === 'sectionedbox') {
            const sections = Array.isArray(block.sections) ? block.sections : [];
            const introCount = Array.isArray(block.intro) ? block.intro.length : 0;

            const rows = sections.map((section, sIdx) => `
                <div class="sbox-editor-row">
                    <input type="text" class="editor-input" data-sbox-title="${sIdx}"
                           value="${window.escapeHtml(section.title || '')}" placeholder="Section ${sIdx + 1}">
                    <button class="btn-sys btn-sys-purple" data-sbox-edit="${sIdx}">
                        ⮑ CONTENTS (${Array.isArray(section.content) ? section.content.length : 0})
                    </button>
                    <button class="btn-sys btn-sys-red" data-sbox-remove="${sIdx}" title="Remove this section">✖</button>
                </div>
            `).join('');

            html += `
                <input type="text" class="editor-input" data-field="title" value="${window.escapeHtml(block.title || '')}" placeholder="Section Box Title">
                <div class="editor-row editor-row-spaced-md">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" data-sbox-intro="${index}">
                        ⮑ EDIT INTRODUCTION (${introCount})
                    </button>
                </div>
                <div class="sbox-editor-sections">
                    <div class="sbox-editor-label">SECTIONS</div>
                    ${rows || '<div class="sbox-editor-empty">No sections yet - the box needs at least one tab to show.</div>'}
                    <button class="btn-sys btn-sys-green" data-sbox-add="${index}">+ ADD SECTION</button>
                </div>
            `;
        }
        else if (block.type === 'theorybox') {
            const multi = !!block.multiSections;
            const sections = Array.isArray(block.sections) ? block.sections : [];
            const secIdx = multi ? window.editorCardSectionIndex(block) : -1;
            // With the switch on, the fields edit the section on screen; off, the card.
            const card = (secIdx >= 0) ? sections[secIdx] : block;

            const innerCount = card.content ? card.content.length : 0;
            const route = Array.isArray(card.sequence) ? card.sequence.join('\n') : '';
            const difficulties = ['', ...(window.COMBO_DIFFICULTIES || [])]
                .map(d => `<option value="${window.escapeHtml(d)}" ${card.difficulty === d ? 'selected' : ''}>${window.escapeHtml(d || '- none -')}</option>`)
                .join('');

            // The tab strip. The label is its own field: a short tab name over a long heading.
            const strip = (multi && sections.length) ? `
                <div class="cardsec-strip">
                    <div class="cardsec-label">SECTIONS</div>
                    <div class="cardsec-tabs">
                        ${sections.map((sec, i) =>
                            `<button class="btn-sys ${i === secIdx ? 'btn-sys-blue' : 'btn-sys-regular'} cardsec-tab" data-cardsec="${i}">`
                            + `${window.escapeHtml(sec.label || sec.title || `Section ${i + 1}`)}</button>`).join('')}
                        <button class="btn-sys btn-sys-green" data-cardsec-add="1" title="Add a section">+</button>
                        ${sections.length > 1 ? `<button class="btn-sys btn-sys-red" data-cardsec-remove="${secIdx}" title="Remove this section">&#10006;</button>` : ''}
                    </div>
                    <input type="text" class="editor-input" data-cardsec-label="${secIdx}"
                           value="${window.escapeHtml(card.label || '')}" placeholder="Tab label (e.g. In Corner 6H)">
                </div>` : '';

            html += `
                <label class="block-video-controls-label cardsec-switch">
                    <input type="checkbox" data-field="multiSections" ${multi ? 'checked' : ''}> Multiple Sections
                </label>
                ${strip}
                <input type="text" class="editor-input" data-field="title" value="${window.escapeHtml(card.title || '')}" placeholder="Combo name (e.g. Corner BnB)">
                <input type="text" class="editor-input" data-field="oneliner" value="${window.escapeHtml(card.oneliner || '')}" placeholder="One line: what this combo is for">
                <div class="editor-row editor-row-spaced-md">
                    <div>
                        <label class="editor-field-label-sm">Route - one step per line</label>
                        <textarea class="editor-textarea" data-field="sequence-lines" rows="4">${window.escapeHtml(route)}</textarea>
                    </div>
                </div>
                ${window.comboNotationFieldsHTML(card, { lines: true })}
                <div class="editor-row editor-row-spaced-md">
                    <div><input type="text" class="editor-input" data-field="damage" value="${window.escapeHtml(card.damage || '')}" placeholder="Damage (e.g. 38-46)"></div>
                    <div><select class="editor-select" data-field="difficulty">${difficulties}</select></div>
                    <div><input type="text" class="editor-input" data-field="practicality" value="${window.escapeHtml(card.practicality || '')}" placeholder="Practicality (anything)"></div>
                </div>
                <div class="editor-row editor-row-spaced-md">
                    <div><input type="text" class="editor-input" data-field="video" value="${window.escapeHtml(card.video || '')}" placeholder="Video URL (optional)"></div>
                    <div><input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" data-cardsec-edit="${secIdx}">
                        &#11157; EDIT THE WRITE-UP (${innerCount})
                    </button>
                </div>
            `;
        }
        else if (block.type === 'callout') {
            const textValue = Array.isArray(block.content) ? block.content.join('\n') : block.content;
            html += `
                <div class="editor-row">
                    <div>
                        <select class="editor-select" data-field="intent">
                            <option value="info" ${block.intent === 'info' ? 'selected' : ''}>Info (Cyan)</option>
                            <option value="tip" ${block.intent === 'tip' ? 'selected' : ''}>Tip (Yellow)</option>
                            <option value="warning" ${block.intent === 'warning' ? 'selected' : ''}>Warning (Orange)</option>
                            <option value="danger" ${block.intent === 'danger' ? 'selected' : ''}>Danger (Red)</option>
                        </select>
                    </div>
                    <div><input type="text" class="editor-input" data-field="title" value="${window.escapeHtml(block.title || '')}" placeholder="Callout Title"></div>
                    <div>${getAlignUI(block.align, 'center')}</div>
                </div>
                <textarea class="editor-textarea" data-field="content-array" placeholder="Tooltip text...">${window.escapeHtml(textValue)}</textarea>
            `;
        }
        else if (block.type === 'divider') {
            const currentStyle = block.style || (block.invisible ? 'invisible' : 'diamond');
            const currentPad = block.padding || 'normal';
            
            html += `
                <div class="editor-row">
                    <div>
                        <label class="block-field-label-sm">Divider Style</label>
                        <select class="editor-select" data-field="style">
                            <option value="diamond" ${currentStyle === 'diamond' ? 'selected' : ''}>Diamond (Default)</option>
                            <option value="solid" ${currentStyle === 'solid' ? 'selected' : ''}>Solid Line</option>
                            <option value="dashed" ${currentStyle === 'dashed' ? 'selected' : ''}>Dashed Line</option>
                            <option value="dotted" ${currentStyle === 'dotted' ? 'selected' : ''}>Dotted Line</option>
                            <option value="double" ${currentStyle === 'double' ? 'selected' : ''}>Double Line</option>
                            <option value="circle" ${currentStyle === 'circle' ? 'selected' : ''}>Center Circle</option>
                            <option value="cross" ${currentStyle === 'cross' ? 'selected' : ''}>Center Cross</option>
                            <option value="fade" ${currentStyle === 'fade' ? 'selected' : ''}>Cinematic Fade</option>
                            <option value="slash" ${currentStyle === 'slash' ? 'selected' : ''}>Slashes (///)</option>
                            <option value="invisible" ${currentStyle === 'invisible' ? 'selected' : ''}>Invisible (Spacer)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block-field-label-sm">Vertical Padding</label>
                        <select class="editor-select" data-field="padding">
                            <option value="none" ${currentPad === 'none' ? 'selected' : ''}>None (0rem)</option>
                            <option value="small" ${currentPad === 'small' ? 'selected' : ''}>Small (1rem)</option>
                            <option value="normal" ${currentPad === 'normal' ? 'selected' : ''}>Normal (2.5rem)</option>
                            <option value="large" ${currentPad === 'large' ? 'selected' : ''}>Large (4rem)</option>
                            <option value="massive" ${currentPad === 'massive' ? 'selected' : ''}>Massive (6rem)</option>
                        </select>
                    </div>
                </div>
            `;
        }
        else if (block.type === 'author') {
            html += `
                <div class="editor-row editor-row-nomargin">
                    <input type="text" class="editor-input" data-field="author" value="${window.escapeHtml(block.author || '')}" placeholder="Contributor Name(s) (Comma separated)">
                </div>
            `;
        }
        else if (block.type === 'collaborator') {
            const isLine = block.kind === 'line';
            const badges = window.COLLABORATOR_BADGES || {};
            const badge = badges[block.badge] ? block.badge : 'badge-general';
            html += `
                <div class="editor-row">
                    <div>
                        <label class="block-field-label-sm">Shown as</label>
                        <select class="editor-select" data-field="kind">
                            <option value="card" ${isLine ? '' : 'selected'}>Main contributor (full card)</option>
                            <option value="line" ${isLine ? 'selected' : ''}>Special thanks (one line)</option>
                        </select>
                    </div>
                    <div><input type="text" class="editor-input" data-field="name" value="${window.escapeHtml(block.name || '')}" placeholder="Name"></div>
                </div>
            `;
            if (isLine) {
                html += `<textarea class="editor-textarea" data-field="description" placeholder="Why they are thanked">${window.escapeHtml(block.description || '')}</textarea>`;
            } else {
                html += `
                    <div class="editor-row">
                        <div><input type="text" class="editor-input" data-field="role" value="${window.escapeHtml(block.role || '')}" placeholder="Tag, e.g. Frame Data &amp; Testing"></div>
                        <div>
                            <label class="block-field-label-sm">Tag color</label>
                            <select class="editor-select" data-field="badge">
                                ${Object.entries(badges).map(([value, label]) =>
                                    `<option value="${window.escapeHtml(value)}" ${badge === value ? 'selected' : ''}>${window.escapeHtml(label)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <input type="text" class="editor-input" data-field="avatar" value="${window.escapeHtml(block.avatar || '')}" placeholder="Icon path, e.g. /medias/images/Something.webp, or a Media Library address">
                    <textarea class="editor-textarea" data-field="description" placeholder="What they did">${window.escapeHtml(block.description || '')}</textarea>
                    <textarea class="editor-textarea" data-field="links-lines" placeholder="Links, one per line: GitHub | https://github.com/someone">${window.escapeHtml(linkLinesText(block.links))}</textarea>
                    <p class="collaborator-links-note" data-links-note ${collaboratorLinkNote(block.links) ? '' : 'hidden'}>${window.escapeHtml(collaboratorLinkNote(block.links))}</p>
                `;
            }
        }
        else if (block.type === 'colorswatches') {
            const sets = window.COLOR_SWATCH_SETS || {};
            const set = sets[block.set] ? block.set : 'characters';
            html += `
                <div class="editor-row editor-row-nomargin">
                    <div>
                        <label class="block-field-label-sm">Swatches</label>
                        <select class="editor-select" data-field="set">
                            ${Object.entries(sets).map(([value, label]) =>
                                `<option value="${window.escapeHtml(value)}" ${set === value ? 'selected' : ''}>${window.escapeHtml(label)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            `;
        }
        else {
            html += `<p class="block-unsupported-msg">Complex block type (${window.escapeHtml(block.type)}) detected. Render raw JSON view here if needed.</p>`;
        }

        html += `</div>`;
        card.innerHTML = html;

        const opening = opensAt.get(index);
        if (opening) {
            const isCollapsed = typeof window.isBlockFolderCollapsed === 'function'
                && window.isBlockFolderCollapsed(opening.name);
            const shell = document.createElement('div');
            shell.className = 'block-folder' + (isCollapsed ? ' is-collapsed' : '');
            // setAttribute, not innerHTML: no escaping, and every folder handler reads it.
            shell.setAttribute('data-folder', opening.name);
            // The bar down the folder's left edge, in its colour.
            const color = window.safeColor(activeBlocks[opening.start].folderColor);
            if (color) {
                shell.classList.add('has-color');
                shell.style.setProperty('--folder-color', color);
            }
            shell.innerHTML = folderShellHTML(opening, isCollapsed, false, color);
            listContainer.appendChild(shell);
            appendTarget = shell.querySelector('.block-folder-body');
        }

        appendTarget.appendChild(card);

        const closing = closesAt.get(index);
        if (closing) {
            appendTarget = listContainer;
            const waiting = pendingAfter.get(closing.name);
            if (waiting) {
                waiting.forEach(emitEmptyFolder);
                pendingAfter.delete(closing.name);
            }
        }
    });

    pendingOrphans.forEach(emitEmptyFolder);

    // Only what is on screen; a shut Block's fields are sized when it opens.
    window.autoSizeEditorTextareasIn(listContainer);

    if (window.editorBlockObserver) {
        listContainer.querySelectorAll('.block-card').forEach(card => {
            window.editorBlockObserver.observe(card);
        });
    }

    // After the cards, so it goes back on top of the rebuilt list. A selection
    // survives the re-render, so the bar does too.
    renderBlockSelectionBar();

    if (typeof window.initializeMangaSelects === 'function') {
        window.initializeMangaSelects(); 
    } else if (typeof window.applyInternalStyling === 'function') {
        window.applyInternalStyling(); 
    }
}

