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

                <div class="format-color-wrapper">
                    <button class="format-btn format-btn-color-trigger" id="btn-format-color" title="Apply Color to Highlighted Text">
                        <div class="format-color-swatch-icon"></div> 🎨
                    </button>
                    <div id="format-color-popup" class="format-color-popup hidden">
                        ${colorPresetsHTML()}
                        <div class="format-color-custom-row">
                            <span class="format-color-custom-label">Custom Hex</span>
                            <input type="color" id="format-custom-color" value="#ffffff" class="format-color-custom-input">
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

    const applyFormat = (tag, value = null) => {
        if (!lastFocusedInput) return;
        const start = lastSelection.start !== undefined ? lastSelection.start : lastFocusedInput.selectionStart;
        const end = lastSelection.end !== undefined ? lastSelection.end : lastFocusedInput.selectionEnd;
        const text = lastFocusedInput.value;
        const selectedText = text.substring(start, end);
        
        let openTag = `[${tag}]`;
        
        if (tag === 'url') {
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
        lastFocusedInput.setSelectionRange(start + openTag.length, end + openTag.length);
    };

    formatToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.format-btn');
        if (btn && btn.hasAttribute('data-tag')) applyFormat(btn.getAttribute('data-tag'));
    });

    // --- COLOR POPUP LOGIC ---
    const colorBtn = container.querySelector('#btn-format-color');
    const colorPopup = container.querySelector('#format-color-popup');

    if (colorBtn && colorPopup) {
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPopup.classList.toggle('hidden');
        });

        colorPopup.addEventListener('click', (e) => {
            const preset = e.target.closest('.color-preset-btn');
            if (preset) {
                applyFormat('color', preset.getAttribute('data-color'));
                colorPopup.classList.add('hidden');
            }
        });

        const customColorInput = container.querySelector('#format-custom-color');
        customColorInput.addEventListener('change', (e) => {
            applyFormat('color', e.target.value);
            colorPopup.classList.add('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-color-popup') && !e.target.closest('#btn-format-color')) {
                colorPopup.classList.add('hidden');
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

    function computeDropTarget(clientX, clientY) {
        const under = document.elementFromPoint(clientX, clientY);
        const card = under ? under.closest('.block-card') : null;
        if (!card) return { card: null, dropIndex: null, isBottom: false };
        const bounding = card.getBoundingClientRect();
        const isBottom = clientY > bounding.y + bounding.height / 2;
        const cardIndex = parseInt(card.getAttribute('data-index'));
        return { card, dropIndex: isBottom ? cardIndex + 1 : cardIndex, isBottom };
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

    function finishBlockDrop(payload, dropIndex) {
        const activeBlocks = window.getActiveBlocks();

        if (payload.blockType) {
            window.saveBlockHistory(); // Save BEFORE mutating
            const newBlock = window.spawnBlockWithAuthor(payload.blockType);
            let landedAt;
            if (dropIndex === null) {
                activeBlocks.push(newBlock);
                landedAt = activeBlocks.length - 1;
            } else {
                activeBlocks.splice(dropIndex, 0, newBlock);
                landedAt = dropIndex;
            }
            renderBlockList();
            updateLivePreview(true); // Tell it to skip saving history again
            flashMovedBlock(landedAt);
        } else if (dropIndex !== null) {
            let target = dropIndex;
            if (payload.fromIndex < target) target--;
            if (payload.fromIndex !== target) {
                window.saveBlockHistory();
                const item = activeBlocks.splice(payload.fromIndex, 1)[0];
                activeBlocks.splice(target, 0, item);
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

        el.setPointerCapture(e.pointerId);

        function positionGhost(ev) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
        }

        function updateHighlight(ev) {
            const { card, dropIndex, isBottom } = computeDropTarget(ev.clientX, ev.clientY);
            if (card !== currentCard) {
                if (currentCard) currentCard.classList.remove('drag-over-top', 'drag-over-bottom');
                currentCard = card;
            }
            if (card) {
                card.classList.toggle('drag-over-bottom', isBottom);
                card.classList.toggle('drag-over-top', !isBottom);
            }
            lastDropIndex = dropIndex;
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
            cleanup();
            if (dragging) finishBlockDrop(payload, dropIndex);
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

    let typingTimer;

    blockList.addEventListener('input', (e) => {
        if (e.target.classList.contains('editor-textarea')) {
            e.target.style.height = 'auto';
            e.target.style.height = (e.target.scrollHeight) + 'px';
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

        if (btn.classList.contains('btn-up') && index > 0) {
            [activeBlocks[index - 1], activeBlocks[index]] = [activeBlocks[index], activeBlocks[index - 1]];
        } else if (btn.classList.contains('btn-down') && index < activeBlocks.length - 1) {
            [activeBlocks[index], activeBlocks[index + 1]] = [activeBlocks[index + 1], activeBlocks[index]];
        } else if (btn.classList.contains('btn-delete')) {
            activeBlocks.splice(index, 1); 
        } else {
            return; 
        }
        
        renderBlockList();
        updateLivePreview();
    });

    renderBlockList();
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

    activeBlocks.forEach((block, index) => {
        const card = document.createElement('div');
        card.className = 'block-card';
        card.setAttribute('data-index', index);

            const typeOptions = Object.keys(blockTemplates).map(t => 
                `<option value="${t}" ${block.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`
            ).join('');

            let html = `
                <div class="block-header">
                    <div class="block-type-row">
                        <span class="drag-handle" title="Drag to reorder">⠿</span>
                        <select class="editor-select block-type-selector">
                            ${typeOptions}
                        </select>
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
                <input type="text" class="editor-input block-heading-input" data-field="content" value="${block.content}" placeholder="Heading Text">
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
                <textarea class="editor-textarea" data-field="content-array" placeholder="Enter paragraph. Use new lines to break array elements. Tip: Use [M1] for keybinds.">${textValue}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'list') {
            const listValue = Array.isArray(block.items) ? block.items.join('\n') : block.items;
            html += `
                <textarea class="editor-textarea" data-field="list-items" placeholder="Enter list items. Use a new line for each bullet point.">${listValue}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'image') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${block.src || ''}" placeholder="Image Path/URL (e.g. VesselPortrait.webp)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="alt" value="${block.alt || ''}" placeholder="Alt Text (Required for accessibility)"></div>
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 50% or 400px)"></div>
                </div>
            `;
        }
        else if (block.type === 'video') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${block.src}" placeholder="Video URL (e.g. /medias/videos/NoNeutralCS.webm)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 50%)"></div>
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
                <input type="text" class="editor-input" data-field="videoId" value="${block.videoId || ''}" placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 75%)"></div>
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
                <input type="text" class="editor-input" data-field="combo-sequence" value="${seq}" placeholder="Sequence (Comma separated: M1, M1, Skill)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="damage" value="${block.damage || ''}" placeholder="Damage text (e.g. 40 DMG)"></div>
                    <div><input type="text" class="editor-input" data-field="note" value="${block.note || ''}" placeholder="Condition/Note (e.g. Corner Only)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'table') {
            let tableHTML = `<div class="block-table-wrapper"><table class="block-table">`;

            tableHTML += `<tr>`;
            block.headers.forEach((h, c) => {
                tableHTML += `<td><input type="text" class="editor-input table-header-input" data-col="${c}" value="${h}" placeholder="Header"></td>`;
            });
            tableHTML += `</tr>`;

            block.rows.forEach((r, rIdx) => {
                tableHTML += `<tr>`;
                r.forEach((cell, cIdx) => {
                    tableHTML += `<td><input type="text" class="editor-input table-cell-input" data-row="${rIdx}" data-col="${cIdx}" value="${cell}" placeholder="..."></td>`;
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
                <input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)">
            `;
        }
        else if (block.type === 'accordion') {
            const innerCount = block.content ? block.content.length : 0;
            html += `
                <input type="text" class="editor-input" data-field="title" value="${block.title || ''}" placeholder="Accordion Title">
                <div class="editor-row editor-row-spaced-md">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div class="accordion-inner-block-wrapper">
                    <button class="btn-sys btn-sys-purple" onclick="window.activeAccordionPath.push(${index}); renderBlockList();">
                        ⮑ EDIT INNER BLOCKS (${innerCount})
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
                    <div><input type="text" class="editor-input" data-field="title" value="${block.title || ''}" placeholder="Callout Title"></div>
                    <div>${getAlignUI(block.align, 'center')}</div>
                </div>
                <textarea class="editor-textarea" data-field="content-array" placeholder="Tooltip text...">${textValue}</textarea>
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
                    <input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Contributor Name(s) (Comma separated)">
                </div>
            `;
        }
        else {
            html += `<p class="block-unsupported-msg">Complex block type (${block.type}) detected. Render raw JSON view here if needed.</p>`;
        }

        html += `</div>`;
        card.innerHTML = html;
        listContainer.appendChild(card);
    });

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

