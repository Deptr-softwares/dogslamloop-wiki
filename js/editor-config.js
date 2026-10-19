/**
 * THE CONFIG PANEL (v1.1)
 *
 * Owner, 2026-10-18: "Config lets editor choose setting for their editor and
 * perform mass action", in three parts, Editor, Actions and Page.
 *
 * Editor: "Settings saved per device", one JSON object in localStorage, read
 * once at load. Most settings are a class on <body> and style/editor.css does
 * the rest. Sticky is the exception, because it needs measured offsets.
 *
 * Page: settings that belong to the PAGE and travel with it through review
 * (see PAGE SETTINGS below).
 *
 * Loaded by edit.html only. The delete confirmations it can switch off live in
 * js/editor-blocks.js (window.confirmDelete), which every editor page loads;
 * they read the switch through window.editorConfig when this file is present.
 */
(function () {
    const STORE_KEY = 'dsl_editor_config';

    // The owner's defaults. stickHeader and stickPageNav being on is how the
    // editor always behaved: those two sit above the area that scrolls.
    //
    // confirmDeletes keeps its stored name and meaning under its v1.1 label,
    // "Skip delete confirmations": the box is ticked when it is false, so a
    // device that already turned the prompts off still has them off.
    const DEFAULTS = Object.freeze({
        hideBlockType: false,
        hideDragHandle: false,
        hideFolderPicker: false,
        formattingOnTop: false,
        compactBlocks: false,
        openMinimized: false,
        stickHeader: true,
        stickPageNav: true,
        stickSectionNav: false,
        stickActions: false,
        disablePreview: false,
        previewFollows: false,
        previewOnSync: false,
        confirmDeletes: true,
    });

    // The settings CSS can carry on its own, by the class each one sets.
    const BODY_CLASSES = {
        hideBlockType: 'cfg-hide-block-type',
        hideDragHandle: 'cfg-hide-drag-handle',
        hideFolderPicker: 'cfg-hide-folder-picker',
        formattingOnTop: 'cfg-format-top',
        compactBlocks: 'cfg-compact-blocks',
        disablePreview: 'cfg-no-preview',
    };

    function readStore() {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            // Storage blocked, or a value nobody here wrote: the defaults, and
            // the editor still works.
            return {};
        }
    }

    let stored = readStore();

    function get(key) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
        const value = stored[key];
        return typeof value === typeof DEFAULTS[key] ? value : DEFAULTS[key];
    }

    function set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || typeof value !== typeof DEFAULTS[key]) return;
        stored = Object.assign({}, stored, { [key]: value });
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
        } catch (e) { /* remembered for this session only */ }
        apply();
    }

    window.editorConfig = { get, set, DEFAULTS };

    // --- STICKY TOP ELEMENTS ---
    //
    // At the owner's defaults nothing here runs and the layout is the one the
    // editor always had: the header and the tab strip sit ABOVE
    // #interactive-builder, which is what scrolls. Any other choice needs the
    // header to be able to scroll away, so the whole workspace scrolls instead
    // (body.cfg-workspace-scrolls), and each bar that stays is stacked under
    // the ones above it at a measured offset.
    //
    // Each group lists its elements top to bottom. The section nav is only the
    // tab's own row (a direct child of the builder): the rows inside a group or
    // a card are a level below it, and pinning those as well would eat the
    // workspace.
    const STICKY_GROUPS = [
        { key: 'stickHeader', find: () => ['editor-header', 'editor-scope-tip'].map(id => document.getElementById(id)) },
        { key: 'stickPageNav', find: () => ['editor-mode-bar', 'editor-mode-controls', 'editor-tab-nav'].map(id => document.getElementById(id)) },
        { key: 'stickSectionNav', find: () => Array.from(document.querySelectorAll('#interactive-builder > .daw-editor-nav-row')) },
        { key: 'stickActions', find: () => {
            const undo = document.getElementById('btn-undo');
            return [undo && undo.closest('.strategy-toolbar-row')];
        } },
    ];

    function customSticky() {
        return STICKY_GROUPS.some(g => get(g.key) !== DEFAULTS[g.key]);
    }

    function workspace() {
        return document.querySelector('.editor-layout-split > .editor-workspace');
    }

    // The element that scrolls the workspace, for js/editor-blocks.js's card
    // virtualization. Null means the usual one, #interactive-builder.
    window.editorScrollBox = function () {
        return customSticky() ? workspace() : null;
    };

    function layoutSticky() {
        const custom = customSticky() && !!workspace();
        document.body.classList.toggle('cfg-workspace-scrolls', custom);
        document.querySelectorAll('.cfg-stuck').forEach(el => {
            el.classList.remove('cfg-stuck');
            el.style.top = '';
        });
        if (!custom) return;

        let top = 0;
        STICKY_GROUPS.forEach(group => {
            if (!get(group.key)) return;
            group.find().forEach(el => {
                // Missing, or display:none (a dismissed tip, a page with no tabs).
                if (!el || !el.getClientRects().length) return;
                el.classList.add('cfg-stuck');
                el.style.top = `${top}px`;
                top += el.getBoundingClientRect().height;
            });
        });
    }

    // Re-stacked whenever something it measured can have changed: the header
    // folds, a tab re-renders the builder (a new section nav and a new actions
    // row), the window resizes. One pass per frame however many fire.
    let stickyQueued = false;
    function queueSticky() {
        if (stickyQueued) return;
        stickyQueued = true;
        requestAnimationFrame(() => {
            stickyQueued = false;
            if (customSticky() || document.body.classList.contains('cfg-workspace-scrolls')) layoutSticky();
        });
    }

    function watchSticky() {
        if (typeof ResizeObserver === 'function') {
            const sizes = new ResizeObserver(queueSticky);
            ['editor-header', 'editor-scope-tip', 'editor-mode-bar', 'editor-mode-controls', 'editor-tab-nav']
                .forEach(id => { const el = document.getElementById(id); if (el) sizes.observe(el); });
        }
        const builder = document.getElementById('interactive-builder');
        if (builder) new MutationObserver(queueSticky).observe(builder, { childList: true, subtree: true });
        window.addEventListener('resize', queueSticky);
    }

    function apply() {
        if (!document.body) return;
        Object.keys(BODY_CLASSES).forEach(key => document.body.classList.toggle(BODY_CLASSES[key], get(key)));
        if (get('previewFollows')) window.previewBlockAnchor = anchorBlock;
        else delete window.previewBlockAnchor;
        layoutSticky();
    }

    // --- PREVIEW FOLLOWS THE BLOCK ---
    //
    // The block renderer (js/description.js) hands each top-level Block's
    // markup to window.previewBlockAnchor, which marks its first element with
    // the Block's position and a fingerprint of its data. Position alone is
    // not enough: the Overview tab draws Overview, General Strategy and every
    // custom tab in one preview, and each has a Block 0. The fingerprint picks
    // the one whose data is the Block being edited.
    function blockSignature(block) {
        const text = JSON.stringify(block) || '';
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    }

    function anchorBlock(html, index, block) {
        return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-preview-block="${Number(index)}" data-preview-sig="${blockSignature(block)}"`);
    }

    // Once per Block: moving between the fields of one Block, or typing in it,
    // does not scroll the preview out from under the author again.
    let followedBlock = null;
    function followBlock(e) {
        if (!get('previewFollows') || get('disablePreview')) return;
        const card = e.target && e.target.closest && e.target.closest('#block-list .block-card[data-index]');
        if (!card || typeof currentStrategyBlocks === 'undefined') return;

        // Inside an accordion, the list on screen is nested, and the preview
        // marks only the top level: follow the accordion that holds it.
        const path = window.activeAccordionPath || [];
        const step = path[0];
        const index = path.length ? (typeof step === 'object' ? step.index : step) : Number(card.getAttribute('data-index'));
        const block = currentStrategyBlocks[index];
        if (!block || block === followedBlock) return;
        followedBlock = block;

        const pane = document.querySelector('.live-preview-pane');
        if (!pane) return;
        const shown = Array.from(pane.querySelectorAll(`[data-preview-block="${index}"]`)).filter(el => el.getClientRects().length);
        const sig = blockSignature(block);
        // A preview waiting for Sync was drawn from older data, so a lone
        // Block at that position is taken when no fingerprint matches.
        const target = shown.find(el => el.getAttribute('data-preview-sig') === sig) || (shown.length === 1 ? shown[0] : null);
        if (!target) return;

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // The same flash a section switch gives its section.
        target.style.outline = '2px solid var(--accent-blue)';
        target.style.outlineOffset = '2px';
        setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 800);
    }

    document.addEventListener('focusin', followBlock);
    document.addEventListener('click', followBlock);

    // --- MASS MINIMIZE / MAXIMIZE ---
    //
    // The blocks of the list on screen, through the same state each block's own
    // minimize button writes. Maximize opens folders too: a block maximized
    // inside a shut folder is still out of sight, which is not what the button
    // promised. Returns how many blocks it touched, so the panel can say when
    // there were none.
    function setAllBlocksOpen(open) {
        const list = document.getElementById('block-list');
        if (!list || typeof window.getActiveBlocks !== 'function' || typeof window.setEditorBlockExpanded !== 'function') return 0;
        const blocks = window.getActiveBlocks() || [];
        if (!blocks.length) return 0;

        blocks.forEach(block => window.setEditorBlockExpanded(block, open));
        if (open && typeof window.setBlockFolderCollapsed === 'function') {
            list.querySelectorAll('.block-folder').forEach(folder =>
                window.setBlockFolderCollapsed(folder.getAttribute('data-folder'), false));
        }
        window.renderBlockList();
        return blocks.length;
    }

    window.setAllEditorBlocksOpen = setAllBlocksOpen;

    // --- PAGE SETTINGS (v1.1) ---
    //
    // Owner, 2026-10-18: auto-colour words "JUST FOR THAT PAGE", and a "Page
    // house style document" that "would also appear as a red-colored button
    // next to MoS". Unlike everything above, these belong to the page: they
    // live in desc_data.pageConfig and travel in a submission as their own
    // scope, so anyone can change them and a reviewer sees the change first.
    // Page-level on a character with states, like the list of states itself.
    //
    // Gallery and tier list pages have no prose for words to colour.
    window.PAGE_CONFIG_PAGE_TYPES = ['character', 'system', 'tool'];

    function pageDesc() {
        return window.editorMasterDescData || null;
    }

    function pageSettingsHere() {
        return window.PAGE_CONFIG_PAGE_TYPES.includes(window.currentEditorPageType || 'character') && !!pageDesc();
    }

    // A copy to edit, so typing never writes half a word list into the page.
    function readPageConfig() {
        const config = (pageDesc() || {}).pageConfig || {};
        return {
            words: (Array.isArray(config.words) ? config.words : []).map(w => ({
                word: String((w && w.word) || ''),
                colors: Array.isArray(w && w.colors) ? w.colors.slice() : [],
            })),
            houseStyle: typeof config.houseStyle === 'string' ? config.houseStyle : '',
        };
    }

    // An empty config is removed rather than stored, so clearing everything
    // leaves the page's data as it was and Submit finds nothing to send.
    function writePageConfig(state) {
        const desc = pageDesc();
        if (!desc) return;
        const words = state.words
            .map(w => ({ word: w.word.trim().replace(/\s+/g, ' '), colors: w.colors }))
            .filter(w => w.word && w.colors.length)
            .slice(0, window.PAGE_WORD_LIMIT);
        const houseStyle = state.houseStyle.trim() ? state.houseStyle : '';

        if (!words.length && !houseStyle) delete desc.pageConfig;
        else desc.pageConfig = { words, houseStyle };

        if (typeof window.refreshPageWords === 'function') window.refreshPageWords();
        refreshHouseStyleButton();
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    }

    // On every page that has a Config > Page, written or not (owner,
    // 2026-10-19: "always visible even if nothing is written yet").
    function refreshHouseStyleButton() {
        const btn = document.getElementById('btn-house-style');
        if (!btn) return;
        btn.classList.toggle('hidden', !pageSettingsHere());
    }
    window.refreshHouseStyleButton = refreshHouseStyleButton;

    window.openHouseStyle = function () {
        if (document.getElementById('editor-house-style-modal')) return false;
        if (typeof window.generateHTMLForBlocks !== 'function') return false;
        const blocks = window.houseStyleBlocks(readPageConfig().houseStyle);
        const body = blocks.length
            ? `<div class="house-style-text">${window.generateHTMLForBlocks(blocks, '')}</div>
               <p class="mos-footnote">Written by this page's editors for the ones who come after them. Change it in Config &gt; Page.</p>`
            : `<p class="house-style-empty">This page's house style hasn't been written yet.</p>
               <p class="mos-footnote">Anyone can write it in Config &gt; Page.</p>`;

        const box = document.createElement('div');
        box.className = 'editor-modal-overlay editor-notice-overlay';
        box.id = 'editor-house-style-modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'House Style');

        // The block renderer escapes the text, and the styling pass then turns
        // its format tags into formatting, the same contract as a page.
        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box mos-modal-box">
                <div class="auth-header"><h3>HOUSE STYLE</h3></div>
                <div class="auth-body mos-body">
                    ${body}
                    <div class="modal-actions-centered mos-actions">
                        <button type="button" class="btn-sys btn-sys-green" data-house-style-ok>OK</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

        const shut = () => {
            if (box.parentNode) box.parentNode.removeChild(box);
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') shut(); }
        box.addEventListener('click', (e) => { if (e.target.closest('[data-house-style-ok]')) shut(); });
        document.addEventListener('keydown', onKey);

        const ok = box.querySelector('[data-house-style-ok]');
        if (ok) ok.focus();
        return true;
    };

    function pagePanelHTML() {
        return `
            <div class="config-panel hidden" data-config-panel="page">
                <p class="config-option-hint">These belong to this page, not your device. They go out with your next submission and are reviewed like any other edit.</p>
                <fieldset class="config-group">
                    <legend class="config-option-label">Auto-color words</legend>
                    <span class="config-option-hint">These custom words will be colored everywhere on this page. Whole words only, in the exact case typed ("Domain", not "domain"). [noauto=all] can stop it, and built-in auto-colors (character names, frame data, moves) are prioritized over this.</span>
                    <div class="config-words" data-config-words></div>
                    <div class="config-actions">
                        <button type="button" class="btn-sys btn-sys-regular" data-word-add>+ ADD WORD</button>
                        <span class="config-option-hint" data-word-count></span>
                    </div>
                </fieldset>
                <fieldset class="config-group">
                    <legend class="config-option-label">House style</legend>
                    <span class="config-option-hint">How this page is written, for the editors who come after you. Format tags work here. It opens from the House Style button next to MoS.</span>
                    <textarea class="editor-textarea config-house-style" data-house-style rows="6" spellcheck="true"></textarea>
                </fieldset>
            </div>`;
    }

    // One colour popup for the whole list, moved to whichever row opened it:
    // fifty rows of ~45 swatches each is a lot of DOM for one open picker.
    // The picker's markup is js/editor-blocks.js's, and its IDs repeat the
    // toolbar's, which is safe because initColorPicker only looks inside the
    // container it is handed (the tier editor does the same).
    function wordColorPopup() {
        const el = document.createElement('div');
        el.className = 'config-word-popup hidden';
        el.innerHTML = `
            <div class="format-color-presets-scroll">${typeof colorPresetsHTML === 'function' ? colorPresetsHTML(gradientPresetsHTML()) : ''}</div>
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
            </div>
            <div class="cp-label">Custom gradient</div>
            <div class="format-color-custom-row">
                <input type="text" class="cp-hex config-word-gradient" data-word-gradient placeholder="#a855f7, #22d3ee"
                       spellcheck="false" autocomplete="off" aria-label="Gradient colors, separated by commas">
                <button type="button" class="btn-sys btn-sys-green cp-apply" data-word-gradient-apply>USE</button>
            </div>
            <p class="config-option-hint config-action-note" data-word-gradient-error aria-live="polite"></p>`;
        return el;
    }

    function wirePagePanel(panel) {
        const state = readPageConfig();
        const list = panel.querySelector('[data-config-words]');
        const count = panel.querySelector('[data-word-count]');
        const addBtn = panel.querySelector('[data-word-add]');
        const house = panel.querySelector('[data-house-style]');
        const popup = wordColorPopup();
        const gradientError = popup.querySelector('[data-word-gradient-error]');
        let popupIndex = -1;

        house.value = state.houseStyle;
        house.addEventListener('input', () => {
            state.houseStyle = house.value;
            writePageConfig(state);
        });

        // Through the CSSOM, never a style attribute: an unparseable value is
        // dropped by the browser rather than written into markup. Cleared
        // first, because a dropped value would leave the previous colour.
        function paintSwatch(swatch, colors) {
            const safe = colors.filter(c => window.safeColor(c));
            swatch.style.background = '';
            swatch.style.background = safe.length > 1 ? `linear-gradient(90deg, ${safe.join(', ')})` : (safe[0] || '');
        }

        const tidy = (word) => word.trim().replace(/\s+/g, ' ');

        function noteFor(i) {
            const word = tidy(state.words[i].word);
            if (!word) return '';
            if (state.words.findIndex(w => tidy(w.word) === word) !== i) return 'Listed twice. The first one is used.';
            const hit = typeof window.pageWordBuiltIn === 'function' ? window.pageWordBuiltIn(word) : null;
            if (!hit) return '';
            if (hit.kind === 'move') return `"${hit.term}" is a move, so it keeps its move color in the Combos and Techs tabs.`;
            return `"${hit.term}" already has a built-in color, and built-in colors win.`;
        }

        function refreshNotes() {
            list.querySelectorAll('.config-word-row').forEach((row, i) => {
                row.querySelector('[data-word-note]').textContent = noteFor(i);
            });
        }

        function closePopup() {
            popup.classList.add('hidden');
            popupIndex = -1;
            list.querySelectorAll('[data-word-swatch]').forEach(s => s.setAttribute('aria-expanded', 'false'));
        }

        function renderRows() {
            closePopup();
            popup.remove();
            list.innerHTML = state.words.map((w, i) => `
                <div class="config-word-row" data-word-index="${i}">
                    <div class="config-word-main">
                        <button type="button" class="config-word-swatch" data-word-swatch aria-label="Color for this word" aria-expanded="false"></button>
                        <input type="text" class="editor-input config-word-text" data-word-text value="${esc(w.word)}"
                               placeholder="Word or phrase" aria-label="Word" spellcheck="false" autocomplete="off">
                        <button type="button" class="btn-sys btn-sys-red config-word-remove" data-word-remove title="Delete this word">✖</button>
                    </div>
                    <span class="config-option-hint config-word-note" data-word-note></span>
                </div>`).join('');
            list.querySelectorAll('.config-word-row').forEach((row, i) => {
                paintSwatch(row.querySelector('[data-word-swatch]'), state.words[i].colors);
            });
            refreshNotes();
            addBtn.disabled = state.words.length >= window.PAGE_WORD_LIMIT;
            count.textContent = `${state.words.length} of ${window.PAGE_WORD_LIMIT}`;
        }

        function setColors(colors) {
            if (popupIndex < 0 || !state.words[popupIndex]) return;
            state.words[popupIndex].colors = colors;
            const row = list.querySelector(`[data-word-index="${popupIndex}"]`);
            if (row) paintSwatch(row.querySelector('[data-word-swatch]'), colors);
            writePageConfig(state);
            closePopup();
        }

        addBtn.addEventListener('click', () => {
            if (state.words.length >= window.PAGE_WORD_LIMIT) return;
            // Starts with the first Basic swatch, so a new word does something
            // the moment it is typed.
            const groups = typeof colorPresetGroups === 'function' ? colorPresetGroups() : [];
            const first = groups[0] && groups[0].swatches[0] ? groups[0].swatches[0].color : '#ffffff';
            state.words.push({ word: '', colors: [first] });
            renderRows();
            const inputs = list.querySelectorAll('[data-word-text]');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });

        list.addEventListener('input', (e) => {
            const input = e.target.closest('[data-word-text]');
            if (!input) return;
            const i = Number(input.closest('.config-word-row').getAttribute('data-word-index'));
            state.words[i].word = input.value;
            writePageConfig(state);
            refreshNotes();
        });

        list.addEventListener('click', async (e) => {
            const row = e.target.closest('.config-word-row');
            if (!row || popup.contains(e.target)) return;
            const i = Number(row.getAttribute('data-word-index'));

            if (e.target.closest('[data-word-remove]')) {
                if (tidy(state.words[i].word) && !(await window.confirmDelete('Delete this word?'))) return;
                state.words.splice(i, 1);
                writePageConfig(state);
                renderRows();
                return;
            }

            const swatch = e.target.closest('[data-word-swatch]');
            if (swatch) {
                const reopen = popupIndex !== i;
                closePopup();
                if (!reopen) return;
                popupIndex = i;
                row.appendChild(popup);
                gradientError.textContent = '';
                const gradientField = popup.querySelector('[data-word-gradient]');
                const colors = state.words[i].colors;
                gradientField.value = colors.length > 1 ? colors.join(', ') : '';
                popup.classList.remove('hidden');
                swatch.setAttribute('aria-expanded', 'true');
                popup.scrollIntoView({ block: 'nearest' });
            }
        });

        popup.addEventListener('click', (e) => {
            const gradient = e.target.closest('.gradient-preset-btn');
            if (gradient) { setColors(gradient.getAttribute('data-gradient').split(',')); return; }

            const preset = e.target.closest('.color-preset-btn');
            if (preset) { setColors([preset.getAttribute('data-color')]); return; }

            if (e.target.closest('[data-word-gradient-apply]')) {
                // The [multicolor] grammar: two or more colours, all valid.
                // safeColor admits any short word as a colour name, so the
                // browser is asked too, the same check the renderer's probe
                // makes: "nope" passes the grammar and colours nothing.
                const stops = popup.querySelector('[data-word-gradient]').value
                    .split(',').map(s => s.trim()).filter(Boolean);
                const isColor = (s) => window.safeColor(s) && CSS.supports('color', s);
                if (stops.length < 2 || !stops.every(isColor)) {
                    gradientError.textContent = 'Type two or more colors, separated by commas, like #a855f7, #22d3ee.';
                    return;
                }
                setColors(stops);
            }
        });

        if (typeof initColorPicker === 'function') initColorPicker(popup, (hex) => setColors([hex]));

        // A click anywhere else in the panel puts the popup away.
        panel.addEventListener('click', (e) => {
            if (popupIndex >= 0 && !popup.contains(e.target) && !e.target.closest('[data-word-swatch]')) closePopup();
        });

        renderRows();
    }

    // --- THE PANEL ---

    const esc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s));

    // The Editor tab's three sections (owner, 2026-10-19: "Workspace, Block,
    // and Preview Panel"). `invert` ticks the box when the stored value is
    // false (see DEFAULTS).
    const WORKSPACE_OPTIONS = [
        { key: 'confirmDeletes', invert: true, label: 'Skip delete confirmations', hint: 'Disable the delete confirmation prompt for most of the destructive actions. Only recommended for experienced editors.' },
    ];

    const BLOCK_OPTIONS = [
        { key: 'hideBlockType', label: 'Hide Block Type dropdown', hint: 'Each Block now only shows its type instead of a dropdown.' },
        { key: 'hideDragHandle', label: 'Hide Drag-and-drop area', hint: 'Move a Block by grabbing its left edge instead.' },
        { key: 'hideFolderPicker', label: 'Hide Block Folder dropdown', hint: 'Each Block no longer shows the folder dropdown menu. Put a Block in a folder by dragging it onto the folder.' },
        { key: 'formattingOnTop', label: 'Formatting on top', hint: 'Alignment, and the options beside it, sit above a Block\'s content.' },
        { key: 'compactBlocks', label: 'Compact Blocks', hint: 'Less padding and smaller text on each Block, so more of them fit on screen.' },
        { key: 'openMinimized', label: 'Open sections minimized', hint: 'Every section opens with its Blocks minimized, the same as MINIMIZE ALL in Actions.' },
    ];

    const PREVIEW_OPTIONS = [
        { key: 'disablePreview', label: 'Disable Preview Panel', hint: 'The Workspace takes the whole screen. Only for experienced editors who know what they are doing.' },
        { key: 'previewFollows', label: 'Preview follows the Block', hint: 'Clicking into a Block scrolls the Preview Panel to where that Block is.' },
        { key: 'previewOnSync', label: 'Preview only on Sync', hint: 'The Preview Panel waits for SYNC instead of redrawing on every edit. Switching section still redraws it.' },
    ];

    const STICKY_OPTIONS = [
        { key: 'stickHeader', label: 'Workspace Header' },
        { key: 'stickPageNav', label: 'Page navigation buttons' },
        { key: 'stickSectionNav', label: 'Sections navigation buttons' },
        { key: 'stickActions', label: 'Workspace basic actions (Undo, Redo, Clear All, Create Folder)' },
    ];

    function checkbox(opt) {
        const ticked = opt.invert ? !get(opt.key) : get(opt.key);
        return `
            <label class="config-option">
                <input type="checkbox" data-config-key="${esc(opt.key)}" ${opt.invert ? 'data-config-invert' : ''} ${ticked ? 'checked' : ''}>
                <span class="config-option-text">
                    <span class="config-option-label">${esc(opt.label)}</span>
                    ${opt.hint ? `<span class="config-option-hint">${esc(opt.hint)}</span>` : ''}
                </span>
            </label>`;
    }

    window.openEditorConfig = function () {
        if (document.getElementById('editor-config-modal')) return false;

        const box = document.createElement('div');
        box.className = 'editor-modal-overlay editor-notice-overlay';
        box.id = 'editor-config-modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'Config');

        const withPage = pageSettingsHere();

        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box config-modal-box">
                <div class="auth-header"><h3>CONFIG</h3></div>
                <div class="auth-body config-body">
                    <div class="daw-variant-tabs config-tabs" role="tablist">
                        <button type="button" class="daw-tab-btn active" role="tab" aria-selected="true" data-config-tab="editor">Editor</button>
                        <button type="button" class="daw-tab-btn" role="tab" aria-selected="false" data-config-tab="actions">Actions</button>
                        ${withPage ? '<button type="button" class="daw-tab-btn" role="tab" aria-selected="false" data-config-tab="page">Page</button>' : ''}
                    </div>

                    <div class="config-panel" data-config-panel="editor">
                        <section class="config-section" data-config-section="workspace">
                            <h4 class="config-section-title">Workspace</h4>
                            <fieldset class="config-group">
                                <legend class="config-option-label">Sticky top elements</legend>
                                <span class="config-option-hint">Ticked ones stay on screen while the Workspace scrolls down.</span>
                                ${STICKY_OPTIONS.map(checkbox).join('')}
                            </fieldset>
                            ${WORKSPACE_OPTIONS.map(checkbox).join('')}
                        </section>
                        <section class="config-section" data-config-section="block">
                            <h4 class="config-section-title">Block</h4>
                            ${BLOCK_OPTIONS.map(checkbox).join('')}
                        </section>
                        <section class="config-section" data-config-section="preview">
                            <h4 class="config-section-title">Preview Panel</h4>
                            ${PREVIEW_OPTIONS.map(checkbox).join('')}
                        </section>
                        <p class="config-footnote">Saved on this device only.</p>
                    </div>

                    <div class="config-panel hidden" data-config-panel="actions">
                        <p class="config-option-hint">For the Blocks in the section on screen.</p>
                        <div class="config-actions">
                            <button type="button" class="btn-sys btn-sys-regular" data-config-action="minimize">MINIMIZE ALL</button>
                            <button type="button" class="btn-sys btn-sys-regular" data-config-action="maximize">MAXIMIZE ALL</button>
                        </div>
                        <p class="config-option-hint config-action-note" data-config-note aria-live="polite"></p>
                    </div>

                    ${withPage ? pagePanelHTML() : ''}

                    <div class="modal-actions-centered">
                        <button type="button" class="btn-sys btn-sys-green" data-config-close>DONE</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);
        if (withPage) wirePagePanel(box.querySelector('[data-config-panel="page"]'));

        const shut = () => {
            if (box.parentNode) box.parentNode.removeChild(box);
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') shut(); }

        box.addEventListener('change', (e) => {
            const input = e.target.closest('[data-config-key]');
            if (!input) return;
            const key = input.getAttribute('data-config-key');
            set(key, input.hasAttribute('data-config-invert') ? !input.checked : input.checked);
            // The preview on screen was drawn before the marks existed, or
            // was held for a Sync that turning the hold off now stands in for.
            // Gallery and tier list pages have no preview this draws.
            if ((key === 'previewFollows' || key === 'previewOnSync') && window.currentEditorDescData
                && ['character', 'system', 'tool'].includes(window.currentEditorPageType || 'character')
                && typeof window.drawLivePreviewNow === 'function') window.drawLivePreviewNow(true);
        });

        box.addEventListener('click', (e) => {
            if (e.target.closest('[data-config-close]')) { shut(); return; }

            const tab = e.target.closest('[data-config-tab]');
            if (tab) {
                const name = tab.getAttribute('data-config-tab');
                box.querySelectorAll('[data-config-tab]').forEach(t => {
                    const on = t === tab;
                    t.classList.toggle('active', on);
                    t.setAttribute('aria-selected', String(on));
                });
                box.querySelectorAll('[data-config-panel]').forEach(p =>
                    p.classList.toggle('hidden', p.getAttribute('data-config-panel') !== name));
                return;
            }

            const action = e.target.closest('[data-config-action]');
            if (action) {
                const open = action.getAttribute('data-config-action') === 'maximize';
                const count = setAllBlocksOpen(open);
                const note = box.querySelector('[data-config-note]');
                note.textContent = count
                    ? `${open ? 'Maximized' : 'Minimized'} ${count} Block${count === 1 ? '' : 's'}.`
                    : 'There are no Blocks in the section on screen.';
            }
        });

        document.addEventListener('keydown', onKey);
        const done = box.querySelector('[data-config-close]');
        if (done) done.focus();
        return true;
    };

    // Applied now rather than on DOMContentLoaded: this file loads at the end
    // of <body>, so the classes are on before the first paint and the editor
    // never flashes its default layout first.
    apply();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { watchSticky(); queueSticky(); });
    } else {
        watchSticky();
        queueSticky();
    }
})();
