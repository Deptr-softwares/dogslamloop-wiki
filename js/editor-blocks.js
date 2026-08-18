
// Every contributor-authored value below reaches innerHTML, and most of them
// land in an ATTRIBUTE (`value="..."`), where an unescaped double quote ends
// the attribute and starts a new one. That was live: a block field of
// `" onfocus=alert(1) autofocus="` executed when the editor rendered it - and
// a reviewer intercepting a ticket opens exactly that editor on exactly that
// contributor's content.
//
// Named escField, NOT esc: these files are classic scripts sharing one global
// lexical scope, and a top-level `const esc` here collides with the one in
// js/description.js, js/dashboards.js and js/post-editor.js on every page that
// loads two of them - aborting this entire file. See the note in
// description.js, and tests/global-scope-collisions.spec.js, which now fails
// on any recurrence.
//
// window.escapeHtml escapes both quote characters as well as the angle
// brackets, so it is correct for text and attribute contexts alike. The
// fallback mirrors it for the cache-skew case site_utils.js is stamped for.
const escField = (v) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(v === null || v === undefined ? '' : v)
    : String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

/**
 * Dogslamloop Wiki - Editor: Content Block Builder (add/edit/reorder text,
 * media, and component blocks - the core WYSIWYG-ish editing surface used
 * across overview/strategy/matchups/counterplay/moves/system sections)
 *
 * initStrategyBlockBuilder is kept as one closure rather than split further -
 * its internals (the IntersectionObserver virtualization engine, focus
 * tracking, format/hotkey injection, hover copy/paste, the color popup, and
 * the full pointer-based drag-and-drop physics in computeDropTarget/
 * finishBlockDrop/startBlockPointerDrag+onMove/onUp/onCancel) all close over
 * this function's own local variables - splitting them apart would mean
 * actually refactoring into parameterized functions, not just moving code,
 * matching the precedent already set for admin-preview.js's switchVersionView
 * and editor-framedata.js's initDawEditor.
 */

// --- COLOUR PRESETS ---
//
// The picker used to offer seven hardcoded swatches while the site's two real
// palettes already existed and were used everywhere else, so colouring text to
// match a character or a frame phase meant reading a hex out of the CSS by
// hand.
//
// Built at render time rather than as a module constant. FRAME_COLORS and
// WINDOW_COLORS are read out of CSS custom properties by an IIFE in
// js/site_meta.js, so anything evaluated while this file parses can capture
// them before ColorCoding.css has been applied - a constant here would be a
// row of empty strings.

// The original seven. Kept as their own group because they are the neutral
// choices, and a writer who wants "just red" should not have to find one
// among two dozen character colours.
const BASIC_PRESET_COLORS = [
    'hsl(3, 93%, 63%)', 'hsl(217, 91%, 60%)', 'hsl(127, 59%, 58%)', 'hsl(261, 86%, 86%)',
    'hsl(39, 100%, 50%)', 'hsl(180, 100%, 50%)', 'hsl(0, 0%, 50%)',
];

// Whitelisted rather than escaped, because these land inside a style
// attribute where escaping alone would not stop a value closing the
// declaration and adding its own. Everything here comes from our own
// dictionaries today; the check costs one line and survives someone editing a
// CSS custom property later.
const SAFE_CSS_COLOR = /^(#[0-9a-f]{3,8}|(?:hsla?|rgba?)\([0-9%.,\s/-]+\))$/i;

function colorPresetGroups() {
    const fromDictionary = (dict) => Object.entries(dict || {}).map(([key, color]) => ({
        color: String(color || '').trim(),
        // Falls back to the key so a colour added to the dictionary without a
        // label still appears, rather than silently vanishing from the picker.
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

    // A missing CSS variable reads as an empty string, which would render an
    // invisible swatch that applies no colour when clicked.
    return groups
        .map(group => ({ ...group, swatches: group.swatches.filter(s => SAFE_CSS_COLOR.test(s.color)) }))
        .filter(group => group.swatches.length > 0);
}

// --- THE VISUAL COLOUR PICKER (owner's fine-tuning item, 2026-08-13) ---
//
// Replaces <input type="color">, which opens the OPERATING SYSTEM's colour
// dialog on top of the wiki: a different palette, different conventions, and
// on some platforms a modal that steals the text selection the toolbar is
// about to wrap.
//
// A saturation/brightness surface plus a hue slider, drawn with CSS gradients
// rather than a canvas - the maths is four lines and a canvas would be a
// second way to draw the same square.
//
// The output goes through the same applyFormat('color', hex) path the preset
// swatches use, so the write side was already built and tested.

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

function initColorPicker(container, onPick) {
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
    }

    // Pointer events rather than mouse events, so a stylus and a finger work
    // too; setPointerCapture is what keeps a drag alive after the pointer
    // leaves the small square.
    function drag(el, onMove) {
        const handle = (event) => {
            const rect = el.getBoundingClientRect();
            // A hidden popup measures 0x0, and 0/0 is NaN - which would reach
            // the hex through Math.round and produce "#NaNNaNNaN". Nothing
            // should move while the surface is not on screen anyway.
            if (!rect.width || !rect.height) return;

            const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
            onMove(x, y);
            paint();
        };

        el.addEventListener('pointerdown', (event) => {
            // The toolbar already suppresses mousedown to protect the text
            // selection; this is the same guard for the drag itself.
            event.preventDefault();

            // The colour is applied FIRST and the capture attempted after.
            // setPointerCapture throws when the id is not an active pointer,
            // and doing it first meant that throw aborted the handler before
            // it had done anything - one click, no colour, and an exception in
            // the console rather than a visible failure.
            handle(event);
            try { el.setPointerCapture(event.pointerId); } catch (e) { /* drag is click-only */ }
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

    // Keyboard, because a drag surface with no arrow keys is unusable without
    // a pointer and this is the only way to reach a hue.
    hue.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') state.h = (state.h - step + 360) % 360;
        else if (event.key === 'ArrowRight') state.h = (state.h + step) % 360;
        else return;
        event.preventDefault();
        paint();
    });

    // Typing a hex is still allowed - it is how somebody pastes a colour from
    // somewhere else, and it drives the surface rather than bypassing it.
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

function colorPresetsHTML() {
    return colorPresetGroups().map(group => `
                        <div class="format-color-popup-label">${window.escapeHtml(group.label)}</div>
                        <div class="format-color-presets-row">
                            ${group.swatches.map(swatch => `<button class="color-preset-btn" data-color="${window.escapeHtml(swatch.color)}" style="background: ${swatch.color};" title="${window.escapeHtml(swatch.label)}"></button>`).join('')}
                        </div>`).join('');
}

// --- BLOCK BUILDER STATE ---
let currentStrategyBlocks = [];
let blockHistory = [];
let historyIndex = -1;

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

// --- AUTO-AUTHOR INJECTOR ---
window.spawnBlockWithAuthor = function(type) {
    const newBlock = JSON.parse(JSON.stringify(blockTemplates[type]));
    
    if (newBlock.author !== undefined && window.currentGlobalUsername && window.currentGlobalUsername !== "Anonymous") {
        newBlock.author = window.currentGlobalUsername;
    }
    
    return newBlock;
};

const blockTemplates = {
    heading: { type: 'heading', content: 'New Heading', align: 'left', size: 'h3' },
    paragraph: { type: 'paragraph', content: 'Write your strategy here...', align: 'left' },
    list: { type: 'list', items: ['List item 1', 'List item 2'], align: 'left', author: '' },
    image: { type: 'image', src: '', alt: 'Image description', caption: '', align: 'center', width: '75%' },
    video: { type: 'video', src: '', align: 'center', width: '75%', controls: false, caption: '' }, 
    youtube: { type: 'youtube', videoId: '', align: 'center', width: '75%', caption: '' },
    callout: { type: 'callout', intent: 'info', title: 'Note', content: 'Important detail here', align: 'center' },
    combo: { type: 'combo', sequence: ['M1', 'M1', 'Skill'], damage: '0', align: 'left', note: '', author: '' },
    accordion: { type: 'accordion', title: 'Collapsible Section', content: [{ type: 'paragraph', content: ['Hidden text...'] }], align: 'center', author: '' },
    // A combo card: the route and its numbers, then a write-up about it.
    // `content` makes it nest exactly like an accordion, which is what lets a
    // card hold its own clips, sub-variants and explanation - and what makes a
    // combo GROUP a group rather than a list.
    theorybox: { type: 'theorybox', title: 'New Combo', oneliner: '', difficulty: '', sequence: [], damage: '', video: '', content: [], anchor: '', align: 'left', author: '' },
    divider: { type: 'divider', style: 'diamond', padding: 'normal' },
    author: { type: 'author', author: '' },
    table: { type: 'table', headers: ['Stat', 'Value'], rows: [['Damage', '10'], ['Startup', '5f']], align: 'center', author: '' },
};

// --- RECURSIVE EDITOR PATH TRACKING ---
window.activeAccordionPath = []; 

window.getActiveBlocks = function() {
    let blocks = currentStrategyBlocks;
    for (let i = 0; i < window.activeAccordionPath.length; i++) {
        const idx = window.activeAccordionPath[i];
        
        if (!blocks[idx]) {
            window.activeAccordionPath = window.activeAccordionPath.slice(0, i);
            break;
        }
        if (!blocks[idx].content) blocks[idx].content = [];
        blocks = blocks[idx].content;
    }
    return blocks;
};

function initStrategyBlockBuilder(containerId, initialData) {
    const container = document.getElementById(containerId);
    currentStrategyBlocks = initialData ? JSON.parse(JSON.stringify(initialData)) : [];

    window.activeAccordionPath = [];

    // Which folders are closed is per-section view state. Opening a different
    // section starts everything expanded rather than inheriting a collapse the
    // author set somewhere else, which is also what makes a bare folder name a
    // safe key for it.
    if (typeof window.resetBlockFolderState === 'function') window.resetBlockFolderState();

    blockHistory = [JSON.parse(JSON.stringify(currentStrategyBlocks))];
    historyIndex = 0;

    container.innerHTML = `
        <div class="strategy-toolbar-row">
            <div>
                <button class="btn-sys btn-sys-blue" id="btn-media-library" title="Open Media Manager">📁 MEDIA LIBRARY</button>
            </div>
            <div class="strategy-toolbar-actions">
                <button class="btn-sys btn-sys-regular" id="btn-undo" title="Undo (Ctrl+Z)" disabled>⮌ UNDO</button>
                <button class="btn-sys btn-sys-regular" id="btn-redo" title="Redo (Ctrl+Y)" disabled>⮎ REDO</button>
                <button class="btn-sys btn-sys-red" id="btn-clear-all" title="Clear All Blocks">✖ CLEAR ALL</button>
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
                <!-- The two shortcodes v0.14 added to js/internalstyling.js.
                     They rendered on the page from the day they shipped and
                     had no way to be typed except by hand, which is the same
                     as not existing for most contributors. -->
                <button class="format-btn format-btn-kbd" data-tag="kbd" title="Key or input, e.g. M1">⌨</button>
                <button class="format-btn format-btn-noauto" data-tag="noauto" title="Stop automatic colouring here — for when a character name is just a word">🚫</button>

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
                        <div class="format-color-presets-scroll">
                        ${colorPresetsHTML()}
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
                    </div>
                </div>
            </div>

            <div class="add-block-menu-wrapper">
                <div class="add-block-popup" id="add-block-popup">
                    <div class="add-block-popup-title">Text & Media</div>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="heading">+ Heading</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="paragraph">+ Paragraph</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="table">+ Table</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="list">+ List</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="image">+ Image</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="video">+ Video</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="youtube">+ YouTube</button>
                    <div class="add-block-popup-title add-block-popup-title-spaced">Components</div>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="callout">+ Callout</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="combo">+ Combo</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="accordion">+ Accordion</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="theorybox">+ Combo Card</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="divider">+ Divider</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="author">+ Author</button>
                </div>
                <button class="btn-sys btn-sys-green btn-add-block-toggle" id="btn-toggle-add-menu">
                    <span class="add-block-icon">⨁</span> ADD BLOCK
                </button>
            </div>
        </div>
    `;

    // --- HISTORY BINDINGS ---
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
        if (activeBlocks.length > 0 && await window.customConfirm("Delete all blocks in this section?")) {
            activeBlocks.length = 0;
            renderBlockList();
            updateLivePreview(); 
        }
    });

    // --- MEDIA LIBRARY BINDING ---
    const btnMediaLib = container.querySelector('#btn-media-library');
    if (btnMediaLib) {
        btnMediaLib.addEventListener('click', () => {
            document.getElementById('media-modal-overlay').classList.remove('hidden');
            if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
        });
    }

    const blockList = document.getElementById('block-list');

    // --- VIRTUALIZATION ENGINE ---
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
        root: document.getElementById('interactive-builder'), 
        rootMargin: '800px 0px' 
    });

    // --- 1. FOCUS TRACKER (For Text Formatting) ---
    let lastFocusedInput = null;
    let lastSelection = { start: 0, end: 0 };
    
    blockList.addEventListener('focusin', (e) => {
        // Inside a CARD only. The folder header carries a name input that lives
        // in this list but is not block content, and the format toolbar writes
        // shortcodes into whatever was last focused - so Bold on a selected
        // folder name would have written [b]...[/b] into organisation nobody
        // reads.
        if (!e.target.closest || !e.target.closest('.block-card')) return;
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
    blockList.addEventListener('mouseup', saveSelection);
    blockList.addEventListener('keyup', saveSelection);

    // --- 2. FORMAT INJECTOR & HOTKEYS ---
    blockList.addEventListener('keydown', (e) => {
        // We only care about Ctrl or Meta (Cmd on Mac)
        if (!e.ctrlKey && !e.metaKey) return;
        
        // Formatting strictly targets text areas and inputs
        const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
        if (!isInput) return;

        let formatTag = null;
        if (e.key.toLowerCase() === 'b') formatTag = 'b';
        else if (e.key.toLowerCase() === 'i') formatTag = 'i';
        else if (e.key.toLowerCase() === 'u') formatTag = 'u';
        else if (e.key === '5') formatTag = 's';
        else if (e.key.toLowerCase() === 'c' && e.shiftKey) formatTag = 'code';
        else if (e.key.toLowerCase() === 'k') formatTag = 'url';

        if (formatTag) {
            e.preventDefault(); // Stop native browser saving/bolding
            
            // Force capture the exact selection range right before injection
            lastFocusedInput = e.target;
            lastSelection.start = e.target.selectionStart;
            lastSelection.end = e.target.selectionEnd;
            applyFormat(formatTag);
        }
    });

    // --- HOVER BLOCK COPY/PASTE ENGINE ---
    // Clears any ghost listeners from previous tab switches
    if (window._blockCopyPasteHandler) {
        document.removeEventListener('keydown', window._blockCopyPasteHandler);
    }
    
    window._blockCopyPasteHandler = (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        
        const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
        
        // If an input is focused, let native text copy/paste happen normally
        if (!isInput) {
            if (e.key.toLowerCase() === 'c' && !e.shiftKey) {
                // Find whatever card the user's mouse is hovering over
                const card = document.querySelector('.block-card:hover');
                if (card) {
                    const index = parseInt(card.getAttribute('data-index'));
                    window.copiedWikiBlock = JSON.parse(JSON.stringify(window.getActiveBlocks()[index]));
                    
                    // Visual feedback Flash
                    card.style.outline = '2px solid var(--accent-blue)';
                    card.style.outlineOffset = '2px';
                    setTimeout(() => { card.style.outline = 'none'; card.style.outlineOffset = '0'; }, 300);
                    e.preventDefault();
                }
            }
            else if (e.key.toLowerCase() === 'v' && !e.shiftKey) {
                if (window.copiedWikiBlock) {
                    e.preventDefault();
                    
                    // Deep clone to prevent reference linking
                    const newBlock = JSON.parse(JSON.stringify(window.copiedWikiBlock));
                    const activeBlocks = window.getActiveBlocks();
                    
                    const card = document.querySelector('.block-card:hover');
                    if (card) {
                        const index = parseInt(card.getAttribute('data-index'));
                        // Splice it directly below the hovered card
                        activeBlocks.splice(index + 1, 0, newBlock);
                    } else {
                        // If hovering in empty space, append to the bottom
                        activeBlocks.push(newBlock);
                    }
                    
                    renderBlockList();
                    updateLivePreview();
                }
            }
        }
    };
    
    document.addEventListener('keydown', window._blockCopyPasteHandler);

    const formatToolbar = container.querySelector('.format-toolbar');
    
    formatToolbar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.format-btn') || e.target.closest('.color-preset-btn')) e.preventDefault(); 
    });

    const applyFormat = (tag, value = null, fallbackText = '') => {
        if (!lastFocusedInput) return;
        const start = lastSelection.start !== undefined ? lastSelection.start : lastFocusedInput.selectionStart;
        const end = lastSelection.end !== undefined ? lastSelection.end : lastFocusedInput.selectionEnd;
        const text = lastFocusedInput.value;
        // A section link with nothing highlighted names the section it points
        // at, rather than producing an empty [url=#x][/url] the reader cannot
        // see or click.
        const selectedText = text.substring(start, end) || fallbackText;

        let openTag = `[${tag}]`;

        if (tag === 'url' && !value) {
            const linkTarget = prompt("Enter the URL or relative path:");
            if (!linkTarget) return;
            openTag = `[url=${linkTarget}]`;
        } else if (value) {
            openTag = `[${tag}=${value}]`;
        }

        let closeTag = `[/${tag}]`;

        const newText = text.substring(0, start) + openTag + selectedText + closeTag + text.substring(end);
        lastFocusedInput.value = newText;
        
        lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
        lastFocusedInput.focus();
        // Measured from the inserted text, not from `end`. They are the same
        // whenever something was highlighted, and differ exactly when the
        // fallback above supplied the label - where using `end` would leave
        // the caret short of the text it just wrote.
        lastFocusedInput.setSelectionRange(start + openTag.length, start + openTag.length + selectedText.length);
    };

    formatToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.format-btn');
        if (btn && btn.hasAttribute('data-tag')) applyFormat(btn.getAttribute('data-tag'));
    });

    // --- COLOR POPUP LOGIC ---
    const colorBtn = container.querySelector('#btn-format-color');
    const colorPopup = container.querySelector('#format-color-popup');

    // Pulls the popup back inside whatever clips it.
    //
    // Measured rather than assumed, after a first attempt fixed the wrong
    // thing: the popup opens at the toolbar button and runs 275px wide, while
    // the editor pane that clips it is ~383px - so from a button partway
    // along the toolbar it overflowed by ~108px and the last swatch column
    // was cut off. It was NOT the popup's own scrollbar, which is what the
    // earlier CSS change guessed at.
    //
    // Done here rather than in CSS because the overflow depends on where the
    // button sits and how wide the pane is, neither of which a static rule
    // knows. left is reset first so reopening never compounds a previous
    // shift, and the clamp is one-directional: it only ever pulls left, so a
    // popup that already fits is untouched.
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
            : { left: 0, right: window.innerWidth };
        const limit = Math.min(bounds.right, window.innerWidth) - 8;

        const overflow = popup.getBoundingClientRect().right - limit;
        if (overflow > 0) popup.style.left = `${-overflow}px`;
    }

    if (colorBtn && colorPopup) {
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPopup.classList.toggle('hidden');
            if (!colorPopup.classList.contains('hidden')) keepColorPopupOnScreen(colorPopup);
        });

        colorPopup.addEventListener('click', (e) => {
            const preset = e.target.closest('.color-preset-btn');
            if (preset) {
                applyFormat('color', preset.getAttribute('data-color'));
                colorPopup.classList.add('hidden');
            }
        });

        initColorPicker(container, (hex) => {
            applyFormat('color', hex);
            colorPopup.classList.add('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-color-popup') && !e.target.closest('#btn-format-color')) {
                colorPopup.classList.add('hidden');
            }
        });
    }

    // --- SECTION LINK PICKER ---
    //
    // The list comes from collectSectionTargets, which reads desc_data rather
    // than the preview: the editor renders only the tab being edited, so a
    // DOM-derived list would offer links within the current tab and nowhere
    // else - the opposite of what an in-page link is for.
    const jumpBtn = container.querySelector('#btn-format-jump');
    const jumpPopup = container.querySelector('#format-jump-popup');
    const jumpList = container.querySelector('#format-jump-list');
    const jumpSearch = container.querySelector('#format-jump-search');

    if (jumpBtn && jumpPopup && jumpList) {
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

        // data- attributes with a delegated listener throughout: a section
        // title is contributor-written and must never reach an inline handler.
        const itemHTML = (target, cls) =>
            `<button type="button" class="${cls}"
                     data-anchor="${esc(target.id)}"
                     data-title="${esc(target.title)}">${esc(target.title)}</button>`;

        const renderJumpList = (filter) => {
            const data = window.currentEditorDescData || window.editorMasterDescData || {};
            const frame = window.currentEditorFrameData || window.editorMasterFrameData || {};
            const all = typeof window.collectSectionTargets === 'function'
                ? window.collectSectionTargets(data, frame)
                : [];

            const needle = String(filter || '').trim().toLowerCase();
            const hit = (text) => text.toLowerCase().includes(needle);

            // A major stays when it matches OR one of its sub-headings does -
            // otherwise searching for a sub-heading returns nothing, because
            // the thing that matched is nested inside something that did not.
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

            // Two levels, like the table of contents: a section, and the
            // headings inside it behind a caret. Collapsed by default, which is
            // where this departs from the ToC on purpose - a filled-in page has
            // well over a hundred headings, and the picker exists to find one
            // quickly rather than to be read through.
            let html = '';
            let lastTab = null;
            shown.forEach(target => {
                if (target.tab !== lastTab) {
                    html += `<div class="format-jump-group">${esc(target.tabLabel)}</div>`;
                    lastTab = target.tab;
                }

                const children = needle ? (target.matchedChildren || []) : target.children;
                // Expanded when the search is what surfaced the children -
                // collapsing the only match would hide the thing found.
                const open = !!needle && children.length > 0;

                html += '<div class="format-jump-row">';
                html += itemHTML(target, 'format-jump-item');
                if (children.length) {
                    html += `<button type="button" class="format-jump-toggle" aria-expanded="${open}"
                                     aria-label="Sections inside ${esc(target.title)}">▼</button>`;
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

        // The toolbar's own mousedown guard covers .format-btn only, and the
        // selection this is about to wrap dies the moment focus moves.
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

    // --- 3. POPUP MENU LOGIC ---
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

    // --- SMART BLOCK CONVERSION & DROPDOWN SYNC ---
    blockList.addEventListener('change', (e) => {
        if (e.target.classList.contains('block-folder-name-input')
            && typeof window.renameBlockFolder === 'function') {
            // On change, not input: renaming per keystroke would rewrite every
            // block in the run on every letter, and re-render the list out
            // from under the caret.
            const activeBlocks = window.getActiveBlocks();
            const from = e.target.getAttribute('data-folder');
            const to = window.normalizeFolderName(e.target.value);

            if (!to || to === from) { e.target.value = from; return; }

            window.saveBlockHistory();
            if (!window.renameBlockFolder(activeBlocks, from, to)) {
                // Guarded, like the same call in editor-find-replace.js: this
                // file is loaded by owner.html and tier-editor.html, neither of
                // which loads editor-core.js, so editorAlert is undefined
                // there. The field snapping back is the feedback that survives
                // on every host page; the message is the bonus where there is
                // a modal to put it in.
                if (typeof window.editorAlert === 'function') {
                    window.editorAlert(`This section already has a folder called "${to}". Pick a different name.`);
                }
                e.target.value = from;
                return;
            }

            // Carry the collapsed state across, or renaming silently reopens a
            // folder the author had closed.
            if (window.isBlockFolderCollapsed(from)) {
                window.setBlockFolderCollapsed(from, false);
                window.setBlockFolderCollapsed(to, true);
            }
            renderBlockList();
            updateLivePreview(true);
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

            window.getActiveBlocks()[index][field] = e.target.value; 

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

    // --- DRAG AND DROP PHYSICS ---
    // Pointer Events (not native HTML5 DnD) so the exact same code path
    // drives mouse and touch - native DnD never fires from a touch gesture
    // at all. Two sources feed the same drop logic: a toolbar .add-block-btn
    // (spawns a new block) or a card's .drag-handle (reorders it). The tap
    // fallback for adding a block (popupMenu 'click' above) and the ▲/▼
    // move buttons already cover touch without dragging at all - this only
    // fixes the drag gesture itself.
    const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

    // Three kinds of destination, and the order of the tests is the design:
    // the nesting zone sits INSIDE a card, so it has to be checked before the
    // card itself or it could never be aimed at; the folder header sits
    // outside every card, so it is what the card lookup falls through to.
    const NO_DROP = {
        card: null, dropIndex: null, isBottom: false,
        folderHead: null, headEl: null, nestInto: null, nestEl: null,
    };

    function computeDropTarget(clientX, clientY) {
        const under = document.elementFromPoint(clientX, clientY);
        if (!under) return NO_DROP;

        // The "EDIT INNER BLOCKS" strip on an accordion, and the identical one
        // on a theorybox - both use this class, so both accept a drop without
        // either being named here. Dropping on it means "put this block INSIDE
        // that one", which is why it cannot be the card's own reorder target.
        const nest = under.closest('.accordion-inner-block-wrapper');
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
            // A folder header is a real target, not empty space. It is the
            // only way INTO a collapsed folder, which by definition shows no
            // cards to drop between.
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

    // Marks where a block landed. Without it a reorder gives no feedback
    // beyond the list re-rendering, and in a long section that means hunting
    // for the block you just moved. Applied after a frame so the class lands
    // on the freshly-rendered card rather than the one it replaced.
    function flashMovedBlock(index) {
        requestAnimationFrame(() => {
            const card = document.querySelector(`#block-list .block-card[data-index="${index}"]`);
            if (!card) return;
            card.classList.remove('block-just-moved');
            void card.offsetWidth; // restart the animation if the same card moves twice
            card.classList.add('block-just-moved');
            setTimeout(() => card.classList.remove('block-just-moved'), 1400);
        });
    }

    // A drag moves an array element and says nothing about folder membership,
    // so every landing has to be reconciled: dropped between two members of a
    // folder a block joins it, dragged clear of one it leaves. Without this a
    // block can render inside a folder while carrying no `folder` value,
    // which splits the run into two folders sharing a name.
    function settleFolderAt(blocks, index) {
        if (index < 0) return;
        if (typeof window.reconcileFolderAt === 'function') {
            window.reconcileFolderAt(blocks, index);
        }
    }

    // A container block a drop can go inside: an accordion or a theorybox,
    // both of which hold a `content` array of blocks. Checked on the object
    // rather than by type name, so a container added later works without
    // anyone coming back here.
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
            window.saveBlockHistory(); // Save BEFORE mutating
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
            updateLivePreview(true); // Tell it to skip saving history again
            flashMovedBlock(landedAt);
        } else if (nestHost(activeBlocks, nestInto) && payload.fromIndex !== nestInto) {
            // The same gesture as dropping into a folder, with a different
            // destination: a folder is a view over THIS level, while an
            // accordion is a level of its own. Reaching it used to mean
            // drilling in with "EDIT INNER BLOCKS" and rebuilding the block
            // by hand.
            window.saveBlockHistory();
            const item = activeBlocks.splice(payload.fromIndex, 1)[0];
            // Folder membership belongs to the level the block just left.
            // Carried along it would show up inside the accordion as a folder
            // of one, named after somewhere the author cannot see.
            delete item.folder;
            const hostIndex = payload.fromIndex < nestInto ? nestInto - 1 : nestInto;
            activeBlocks[hostIndex].content.push(item);
            renderBlockList();
            updateLivePreview(true);
            flashMovedBlock(hostIndex);
        } else if (folderHead && typeof window.dropBlockIntoFolderHead === 'function') {
            window.saveBlockHistory();
            const landedAt = window.dropBlockIntoFolderHead(activeBlocks, payload.fromIndex, folderHead);
            if (landedAt < 0) return;
            renderBlockList();
            updateLivePreview(true);
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
                updateLivePreview(true);
                flashMovedBlock(target);
            }
        }
        // Reordering onto empty space (no card under the pointer) is a no-op,
        // same as the previous native-DnD drop handler.
    }

    // ghostLabel: text shown in the small pill that follows the pointer.
    // Runs the full drag lifecycle for one pointerdown. Takes the real,
    // trusted pointerdown event directly (rather than being an
    // addEventListener wrapper) so it can be reused both for a direct
    // listener (add-block-btn) and a delegated one (drag-handle, which only
    // exists inside re-rendered .block-card elements) without ever
    // redispatching a synthetic PointerEvent - setPointerCapture() throws on
    // synthetic/untrusted pointer events, so the capturing element must
    // receive the browser's own original event.
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

        el.setPointerCapture(e.pointerId);

        function positionGhost(ev) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
        }

        function updateHighlight(ev) {
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
                // Never highlight a block's own nesting zone - dropping it
                // into itself is refused at the drop, so offering it is a lie.
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
            cleanup();
            if (dragging) finishBlockDrop(payload, dropIndex, folderHead, nestInto);
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

    // Delegated: .drag-handle only exists inside re-rendered .block-card
    // elements, so this listens on the persistent blockList container
    // instead of re-binding per card on every render.
    blockList.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const card = handle.closest('.block-card');
        if (!card) return;
        startBlockPointerDrag(e, handle, { fromIndex: parseInt(card.getAttribute('data-index')) }, 'Move block');
    });

    // --- FOLDER PICKER ---
    //
    // Its own delegated listener rather than a branch of the big click handler
    // below, because that one opens with closest('button') and then resolves
    // .block-card by data-index - this dropdown needs neither, and its rows are
    // rebuilt on every render so per-element binding would leak.
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

        // The name is carried in a data attribute rather than read off the
        // row's text, which is escaped for display and would come back
        // decoded-but-not-identical for a name containing markup.
        let name = '';
        if (action === 'pick') name = option.getAttribute('data-folder-name');
        else if (action === 'new') name = window.nextFolderName(activeBlocks, 'New Folder');

        window.saveBlockHistory();
        const landedAt = window.assignBlockToFolder(activeBlocks, index, name);
        renderBlockList();
        updateLivePreview(true);
        if (landedAt >= 0) flashMovedBlock(landedAt);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.block-folder-picker')) {
            document.querySelectorAll('.block-folder-picker.open')
                .forEach(w => w.classList.remove('open'));
        }
    });

    let typingTimer;

    blockList.addEventListener('input', (e) => {
        if (e.target.classList.contains('editor-textarea')) {
            // Grow to fit, then STOP and scroll. Uncapped, a long combo route
            // pushed the field taller than the pane and there was no way to
            // scroll it - owner, 2026-08-17. The cap is in px rather than rows
            // because these fields sit in three different panes at three
            // different widths.
            const MAX = 260;
            e.target.style.height = 'auto';
            const wanted = e.target.scrollHeight;
            e.target.style.height = Math.min(wanted, MAX) + 'px';
            e.target.style.overflowY = wanted > MAX ? 'auto' : 'hidden';
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

            if (field === 'content-array') activeBlocks[index].content = e.target.value.split('\n');
            // A combo route is an ARRAY of steps, edited one per line. Blank
            // lines are dropped rather than becoming empty chips in the route.
            else if (field === 'sequence-lines') activeBlocks[index].sequence = e.target.value.split('\n').map(v => v.trim()).filter(Boolean);
            else if (field === 'list-items') activeBlocks[index].items = e.target.value.split('\n').filter(i => i.trim() !== '');
            else if (field === 'combo-sequence') activeBlocks[index].sequence = e.target.value.split(',').map(s => s.trim());
            else if (e.target.type === 'checkbox') activeBlocks[index][field] = e.target.checked;
            else activeBlocks[index][field] = e.target.value;

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                updateLivePreview(); 
            }, 400); 
        }
    });

    blockList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        const activeBlocks = window.getActiveBlocks();
        window.saveBlockHistory();

        // Folder controls sit in the shell HEADER, outside any .block-card, so
        // they have to be handled before the data-index lookup further down -
        // that line calls .getAttribute on a null closest() and throws. The
        // second half of the test matters just as much: cards are rendered
        // INSIDE .block-folder, so a card's own ✖ matches closest('.block-folder')
        // too.
        const folderShell = btn.closest('.block-folder');
        if (folderShell && !btn.closest('.block-card')) {
            const folderName = folderShell.getAttribute('data-folder');

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
                updateLivePreview(true);
                return;
            }

            // Making and discarding an EMPTY folder touches no block, so
            // neither one refreshes the preview - there is nothing for it to
            // render differently.
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

        if (e.target.classList.contains('btn-table-add-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const cols = activeBlocks[index].headers.length;
            activeBlocks[index].rows.push(new Array(cols).fill(''));
            renderBlockList(); updateLivePreview(true);
        } else if (e.target.classList.contains('btn-table-add-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            activeBlocks[index].headers.push('New');
            activeBlocks[index].rows.forEach(r => r.push(''));
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (activeBlocks[index].rows.length > 1) activeBlocks[index].rows.pop();
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (activeBlocks[index].headers.length > 1) {
                activeBlocks[index].headers.pop();
                activeBlocks[index].rows.forEach(r => r.pop());
            }
            renderBlockList(); updateLivePreview();
        }

        if (btn.classList.contains('btn-collapse')) {
            const card = btn.closest('.block-card');
            const body = card.querySelector('.block-body');
            body.classList.toggle('minimized');
            card.classList.toggle('collapsed');
            btn.textContent = body.classList.contains('minimized') ? '□' : '—';
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

        let movedTo = -1;
        if (btn.classList.contains('btn-up') && index > 0) {
            [activeBlocks[index - 1], activeBlocks[index]] = [activeBlocks[index], activeBlocks[index - 1]];
            movedTo = index - 1;
        } else if (btn.classList.contains('btn-down') && index < activeBlocks.length - 1) {
            [activeBlocks[index], activeBlocks[index + 1]] = [activeBlocks[index + 1], activeBlocks[index]];
            movedTo = index + 1;
        } else if (btn.classList.contains('btn-delete')) {
            activeBlocks.splice(index, 1);
        } else {
            return;
        }

        // A swap moves BOTH blocks, and either one can have crossed a folder
        // boundary - stepping a member down past a loose block takes it out of
        // the folder, and the loose block it traded places with is now inside.
        if (movedTo >= 0) {
            settleFolderAt(activeBlocks, movedTo);
            settleFolderAt(activeBlocks, index);
        }

        renderBlockList();
        updateLivePreview();
    });

    renderBlockList();
}

// The shell drawn around one folder run.
//
// The name is an INPUT rather than a label plus a rename button. Renaming is
// the most common thing done to a folder after making it, and the editor has
// editorAlert and customConfirm but no text prompt at all - adding one modal
// for this would make folder naming the only prompt on the site.
//
// Every interpolation here is contributor-authored and lands in an attribute,
// so it goes through escField exactly like the block fields below it.
function folderShellHTML(run, isCollapsed, isEmpty) {
    const count = isEmpty ? 'empty' : `${run.count} block${run.count === 1 ? '' : 's'}`;

    // An empty folder is not in the data, so there is nothing to keep and
    // nothing to ungroup - removing it is a discard, and saying UNGROUP there
    // would promise a rescue of blocks that do not exist.
    const removeBtn = isEmpty
        ? `<button class="btn-sys btn-sys-regular block-folder-discard"
                   title="Discard this empty folder">&#10007; REMOVE</button>`
        : `<button class="btn-sys btn-sys-regular block-folder-ungroup"
                   title="Remove the folder and keep every block in it">&#9003; UNGROUP</button>`;

    const body = isEmpty
        ? `<div class="block-folder-empty">Drag a block onto this header, or choose this folder on any block.</div>`
        : '';

    return `
        <div class="block-folder-head">
            <button class="btn-sys btn-sys-regular block-folder-toggle"
                    title="${isCollapsed ? 'Expand' : 'Collapse'} this folder"
                    aria-expanded="${isCollapsed ? 'false' : 'true'}">${isCollapsed ? '&#9656;' : '&#9662;'}</button>
            <input type="text" class="block-folder-name-input" value="${escField(run.name)}"
                   data-folder="${escField(run.name)}" maxlength="60"
                   aria-label="Folder name" title="Rename this folder">
            <span class="block-folder-count">${count}</span>
            <button class="btn-sys btn-sys-regular block-folder-add"
                    title="Create another folder after this one">&#65291; FOLDER</button>
            ${removeBtn}
        </div>
        <div class="block-folder-body">${body}</div>
    `;
}

function renderBlockList() {
    const listContainer = document.getElementById('block-list');
    listContainer.innerHTML = '';

    const activeBlocks = window.getActiveBlocks();

    const getAlignUI = (alignVal, defaultAlign = 'left') => {
        const align = alignVal || defaultAlign;
        return `
            <div class="align-group">
                <button class="align-btn ${align === 'left' ? 'active' : ''}" data-val="left" title="Align/Float Left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
                <button class="align-btn ${align === 'center' ? 'active' : ''}" data-val="center" title="Align/Float Center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="18" y1="12" x2="6" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
                <button class="align-btn ${align === 'right' ? 'active' : ''}" data-val="right" title="Align/Float Right">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
            </div>
        `;
    };

    if (window.activeAccordionPath.length > 0) {
        let parentBlock = currentStrategyBlocks;
        for (let i = 0; i < window.activeAccordionPath.length - 1; i++) {
            parentBlock = parentBlock[window.activeAccordionPath[i]].content;
        }
        const activeIdx = window.activeAccordionPath[window.activeAccordionPath.length - 1];
        const parentTitle = parentBlock[activeIdx].title || 'Accordion';
        
        const backBtnHTML = `
            <div class="accordion-back-banner">
                <div>
                    <span class="accordion-back-label">EDITING INNER BLOCKS:</span>
                    <div class="accordion-back-title">${parentTitle}</div>
                </div>
                <button class="btn-sys btn-sys-purple btn-purple-fill" onclick="window.activeAccordionPath.pop(); renderBlockList();">⮑ BACK TO PARENT</button>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', backBtnHTML);
    }

    // --- BLOCK FOLDERS (v0.15 item 9) ---
    //
    // A folder is a contiguous run, so its shell can be opened at run.start and
    // closed at run.end while each card keeps its REAL array index in
    // data-index. Every handler in this file reads that attribute, and a
    // grouping that renumbered blocks would break all of them at once.
    const folderRuns = typeof window.collectBlockFolders === 'function'
        ? window.collectBlockFolders(activeBlocks)
        : [];
    const opensAt = new Map();
    const closesAt = new Map();
    folderRuns.forEach(run => { opensAt.set(run.start, run); closesAt.set(run.end, run); });
    const folderNames = folderRuns.map(run => run.name);

    // Empty folders, which are session state rather than data - a folder with
    // no blocks has no `folder` string anywhere to be found in. Each is drawn
    // after the folder it was created from, matched BY NAME so that reordering
    // blocks cannot strand it; one whose anchor has since been dissolved or
    // renamed away falls to the end rather than disappearing.
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

    // Where the next card goes: the list itself, or the open folder's body.
    let appendTarget = listContainer;

    // The non-drag path into a folder, and a custom dropdown rather than a
    // <select> so that "no folder" and "create new folder" can look like what
    // they are instead of like two more folders - as a native select they were
    // three near-identical rows (owner, 2026-08-18). Built from the same
    // .manga-select-* shell every other dropdown on the site uses, with its own
    // classes on the two rows that are not folders.
    const folderPickerHTML = (block) => {
        const own = typeof window.blockFolderName === 'function' ? window.blockFolderName(block) : '';
        const choices = [...new Set(folderNames.concat(pendingFolders.map(p => p.name)))];

        let rows = `<button type="button" class="manga-option folder-option folder-option-none${own ? '' : ' selected'}"
                            data-folder-action="none">No folder</button>`;
        if (choices.length) {
            rows += `<div class="folder-option-sep">Folders</div>`;
            rows += choices.map(n =>
                `<button type="button" class="manga-option folder-option folder-option-item${n === own ? ' selected' : ''}"
                         data-folder-action="pick" data-folder-name="${escField(n)}">${escField(n)}</button>`
            ).join('');
        }
        rows += `<button type="button" class="manga-option folder-option folder-option-new"
                         data-folder-action="new">&#65291; Create new folder</button>`;

        return `
            <div class="manga-select-wrapper block-folder-picker">
                <button type="button" class="block-folder-trigger${own ? ' has-folder' : ''}"
                        title="Put this block in a folder">${own ? escField(own) : 'No folder'}</button>
                <div class="manga-select-options">${rows}</div>
            </div>
        `;
    };

    activeBlocks.forEach((block, index) => {
        const card = document.createElement('div');
        card.className = 'block-card';
        card.setAttribute('data-index', index);

            const typeOptions = Object.keys(blockTemplates).map(t =>
                `<option value="${escField(t)}" ${block.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`
            ).join('');

            let html = `
                <div class="block-header">
                    <div class="block-type-row">
                        <span class="drag-handle" title="Drag to reorder">⠿</span>
                        <select class="editor-select block-type-selector">
                            ${typeOptions}
                        </select>
                        ${folderPickerHTML(block)}
                    </div>
                <div class="block-actions">
                    <button class="btn-sys btn-sys-green btn-insert-below" title="Insert Paragraph Below">⨁</button>
                    <button class="btn-sys btn-sys-regular btn-collapse" title="Minimize/Expand">—</button>
                    <button class="btn-sys btn-sys-regular btn-up" title="Move Up">▲</button>
                    <button class="btn-sys btn-sys-regular btn-down" title="Move Down">▼</button>
                    <button class="btn-sys btn-sys-red btn-delete" title="Delete">✖</button>
                </div>
            </div>
            <div class="block-body">
        `;

        if (block.type === 'heading') {
            html += `
                <input type="text" class="editor-input block-heading-input" data-field="content" value="${escField(block.content)}" placeholder="Heading Text">
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
            `;
        }
        else if (block.type === 'paragraph') {
            const textValue = Array.isArray(block.content) ? block.content.join('\n') : block.content;
            html += `
                <textarea class="editor-textarea" data-field="content-array" placeholder="Enter paragraph. Use new lines to break array elements. Tip: Use [M1] for keybinds.">${escField(textValue)}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'list') {
            const listValue = Array.isArray(block.items) ? block.items.join('\n') : block.items;
            html += `
                <textarea class="editor-textarea" data-field="list-items" placeholder="Enter list items. Use a new line for each bullet point.">${escField(listValue)}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'image') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${escField(block.src || '')}" placeholder="Image Path/URL (e.g. VesselPortrait.webp)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="alt" value="${escField(block.alt || '')}" placeholder="Alt Text (Required for accessibility)"></div>
                    <div><input type="text" class="editor-input" data-field="caption" value="${escField(block.caption || '')}" placeholder="Caption (Optional)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${escField(block.width || '100%')}" placeholder="Width (e.g. 50% or 400px)"></div>
                </div>
            `;
        }
        else if (block.type === 'video') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${escField(block.src)}" placeholder="Video URL (e.g. /medias/videos/NoNeutralCS.webm)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${escField(block.caption || '')}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${escField(block.width || '100%')}" placeholder="Width (e.g. 50%)"></div>
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
                <input type="text" class="editor-input" data-field="videoId" value="${escField(block.videoId || '')}" placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${escField(block.caption || '')}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${escField(block.width || '100%')}" placeholder="Width (e.g. 75%)"></div>
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
                <input type="text" class="editor-input" data-field="combo-sequence" value="${escField(seq)}" placeholder="Sequence (Comma separated: M1, M1, Skill)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="damage" value="${escField(block.damage || '')}" placeholder="Damage text (e.g. 40 DMG)"></div>
                    <div><input type="text" class="editor-input" data-field="note" value="${escField(block.note || '')}" placeholder="Condition/Note (e.g. Corner Only)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'table') {
            let tableHTML = `<div class="block-table-wrapper"><table class="block-table">`;

            tableHTML += `<tr>`;
            block.headers.forEach((h, c) => {
                tableHTML += `<td><input type="text" class="editor-input table-header-input" data-col="${c}" value="${escField(h)}" placeholder="Header"></td>`;
            });
            tableHTML += `</tr>`;

            block.rows.forEach((r, rIdx) => {
                tableHTML += `<tr>`;
                r.forEach((cell, cIdx) => {
                    tableHTML += `<td><input type="text" class="editor-input table-cell-input" data-row="${rIdx}" data-col="${cIdx}" value="${escField(cell)}" placeholder="..."></td>`;
                });
                tableHTML += `</tr>`;
            });
            tableHTML += `</table></div>`;

            html += `
                ${tableHTML}
                <div class="block-table-actions-row">
                    <button class="btn-sys btn-sys-regular btn-table-add-row" title="Add Row Below">⊞ +Row</button>
                    <button class="btn-sys btn-sys-regular btn-table-add-col" title="Add Column Right">⊞ +Col</button>
                    <button class="btn-sys btn-sys-red btn-table-del-row" title="Delete Bottom Row">⊟ -Row</button>
                    <button class="btn-sys btn-sys-red btn-table-del-col" title="Delete Right Column">⊟ -Col</button>
                </div>
                <input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)">
            `;
        }
        else if (block.type === 'accordion') {
            const innerCount = block.content ? block.content.length : 0;
            html += `
                <input type="text" class="editor-input" data-field="title" value="${escField(block.title || '')}" placeholder="Accordion Title">
                <div class="editor-row editor-row-spaced-md">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" onclick="window.activeAccordionPath.push(${index}); renderBlockList();">
                        ⮑ EDIT INNER BLOCKS (${innerCount})
                    </button>
                </div>
            `;
        }
        else if (block.type === 'theorybox') {
            const innerCount = block.content ? block.content.length : 0;
            const route = Array.isArray(block.sequence) ? block.sequence.join('\n') : '';
            const difficulties = ['', ...(window.COMBO_DIFFICULTIES || [])]
                .map(d => `<option value="${escField(d)}" ${block.difficulty === d ? 'selected' : ''}>${escField(d || '- none -')}</option>`)
                .join('');

            html += `
                <input type="text" class="editor-input" data-field="title" value="${escField(block.title || '')}" placeholder="Combo name (e.g. Corner BnB)">
                <input type="text" class="editor-input" data-field="oneliner" value="${escField(block.oneliner || '')}" placeholder="One line: what this combo is for">
                <div class="editor-row editor-row-spaced-md">
                    <div>
                        <label class="editor-field-label-sm">Route - one step per line</label>
                        <textarea class="editor-textarea" data-field="sequence-lines" rows="4">${escField(route)}</textarea>
                    </div>
                </div>
                <div class="editor-row editor-row-spaced-md">
                    <div><input type="text" class="editor-input" data-field="damage" value="${escField(block.damage || '')}" placeholder="Damage (e.g. 38-46)"></div>
                    <div><select class="editor-select" data-field="difficulty">${difficulties}</select></div>
                </div>
                <div class="editor-row editor-row-spaced-md">
                    <div><input type="text" class="editor-input" data-field="video" value="${escField(block.video || '')}" placeholder="Video URL (optional)"></div>
                    <div><input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" onclick="window.activeAccordionPath.push(${index}); renderBlockList();">
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
                    <div><input type="text" class="editor-input" data-field="title" value="${escField(block.title || '')}" placeholder="Callout Title"></div>
                    <div>${getAlignUI(block.align, 'center')}</div>
                </div>
                <textarea class="editor-textarea" data-field="content-array" placeholder="Tooltip text...">${escField(textValue)}</textarea>
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
                    <input type="text" class="editor-input" data-field="author" value="${escField(block.author || '')}" placeholder="Contributor Name(s) (Comma separated)">
                </div>
            `;
        }
        else {
            html += `<p class="block-unsupported-msg">Complex block type (${block.type}) detected. Render raw JSON view here if needed.</p>`;
        }

        html += `</div>`;
        card.innerHTML = html;

        const opening = opensAt.get(index);
        if (opening) {
            const isCollapsed = typeof window.isBlockFolderCollapsed === 'function'
                && window.isBlockFolderCollapsed(opening.name);
            const shell = document.createElement('div');
            shell.className = 'block-folder' + (isCollapsed ? ' is-collapsed' : '');
            // setAttribute, not innerHTML: no escaping needed, and this is the
            // value every folder handler reads back.
            shell.setAttribute('data-folder', opening.name);
            shell.innerHTML = folderShellHTML(opening, isCollapsed, false);
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

    listContainer.querySelectorAll('.editor-textarea').forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
    });

    if (window.editorBlockObserver) {
        listContainer.querySelectorAll('.block-card').forEach(card => {
            window.editorBlockObserver.observe(card);
        });
    }

    if (typeof window.initializeMangaSelects === 'function') {
        window.initializeMangaSelects(); 
    } else if (typeof window.applyInternalStyling === 'function') {
        window.applyInternalStyling(); 
    }
}

