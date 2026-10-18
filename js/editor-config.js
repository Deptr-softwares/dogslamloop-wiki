/**
 * THE CONFIG PANEL (v1.1)
 *
 * Owner, 2026-10-18: "Config lets editor choose setting for their editor and
 * perform mass action", in three parts, Editor, Actions and Page. Editor and
 * Actions are here. Page holds settings that belong to a page and travel with
 * it through review, so it lands separately.
 *
 * "Settings saved per device": one JSON object in localStorage, read once at
 * load. Most settings are a class on <body> and style/editor.css does the
 * rest. Sticky is the exception, because it needs measured offsets.
 *
 * Loaded by edit.html only. The delete confirmations it can switch off live in
 * js/editor-blocks.js (window.confirmDelete), which every editor page loads;
 * they read the switch through window.editorConfig when this file is present.
 */
(function () {
    const STORE_KEY = 'dsl_editor_config';

    // The owner's defaults. stickHeader and stickPageNav being on is how the
    // editor always behaved: those two sit above the area that scrolls.
    const DEFAULTS = Object.freeze({
        hideBlockType: false,
        hideDragHandle: false,
        hideFolderPicker: false,
        formattingOnTop: false,
        stickHeader: true,
        stickPageNav: true,
        stickSectionNav: false,
        stickActions: false,
        disablePreview: false,
        confirmDeletes: true,
    });

    // The settings CSS can carry on its own, by the class each one sets.
    const BODY_CLASSES = {
        hideBlockType: 'cfg-hide-block-type',
        hideDragHandle: 'cfg-hide-drag-handle',
        hideFolderPicker: 'cfg-hide-folder-picker',
        formattingOnTop: 'cfg-format-top',
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
        layoutSticky();
    }

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

    // --- THE PANEL ---

    const esc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s));

    const EDITOR_OPTIONS = [
        { key: 'hideBlockType', label: 'Hide Block Type dropdown', hint: 'Each Block shows its type instead of a dropdown that changes it.' },
        { key: 'hideDragHandle', label: 'Hide Drag-and-drop area', hint: 'Move a Block by grabbing its left edge instead.' },
        { key: 'hideFolderPicker', label: 'Hide Block Folder dropdown', hint: 'Put a Block in a folder by dragging it onto the folder. CREATE FOLDER makes a new one.' },
        { key: 'formattingOnTop', label: 'Formatting on top', hint: 'Alignment, and the options beside it, sit above a Block\'s content.' },
        { key: 'disablePreview', label: 'Disable Preview Panel', hint: 'The Workspace takes the whole screen. Only for experienced editors who know what they are doing.' },
        { key: 'confirmDeletes', label: 'Ask before deleting', hint: 'Every delete in the editor asks first. Turned off, deleting happens on the first click.' },
    ];

    const STICKY_OPTIONS = [
        { key: 'stickHeader', label: 'Workspace Header' },
        { key: 'stickPageNav', label: 'Page navigation buttons' },
        { key: 'stickSectionNav', label: 'Sections navigation buttons' },
        { key: 'stickActions', label: 'Workspace basic actions (Undo, Redo, Clear All, Create Folder)' },
    ];

    function checkbox(opt) {
        return `
            <label class="config-option">
                <input type="checkbox" data-config-key="${esc(opt.key)}" ${get(opt.key) ? 'checked' : ''}>
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

        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box config-modal-box">
                <div class="auth-header"><h3>CONFIG</h3></div>
                <div class="auth-body config-body">
                    <div class="daw-variant-tabs config-tabs" role="tablist">
                        <button type="button" class="daw-tab-btn active" role="tab" aria-selected="true" data-config-tab="editor">Editor</button>
                        <button type="button" class="daw-tab-btn" role="tab" aria-selected="false" data-config-tab="actions">Actions</button>
                    </div>

                    <div class="config-panel" data-config-panel="editor">
                        ${EDITOR_OPTIONS.slice(0, 4).map(checkbox).join('')}
                        <fieldset class="config-group">
                            <legend class="config-option-label">Sticky top elements</legend>
                            <span class="config-option-hint">Ticked ones stay on screen while the Workspace scrolls.</span>
                            ${STICKY_OPTIONS.map(checkbox).join('')}
                        </fieldset>
                        ${EDITOR_OPTIONS.slice(4).map(checkbox).join('')}
                    </div>

                    <div class="config-panel hidden" data-config-panel="actions">
                        <p class="config-option-hint">For the Blocks in the section on screen.</p>
                        <div class="config-actions">
                            <button type="button" class="btn-sys btn-sys-regular" data-config-action="minimize">MINIMIZE ALL</button>
                            <button type="button" class="btn-sys btn-sys-regular" data-config-action="maximize">MAXIMIZE ALL</button>
                        </div>
                        <p class="config-option-hint config-action-note" data-config-note aria-live="polite"></p>
                    </div>

                    <p class="config-footnote">Saved on this device only.</p>
                    <div class="modal-actions-centered">
                        <button type="button" class="btn-sys btn-sys-green" data-config-close>DONE</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);

        const shut = () => {
            if (box.parentNode) box.parentNode.removeChild(box);
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') shut(); }

        box.addEventListener('change', (e) => {
            const input = e.target.closest('[data-config-key]');
            if (input) set(input.getAttribute('data-config-key'), input.checked);
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
