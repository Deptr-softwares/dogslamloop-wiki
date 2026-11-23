/**
 * Character states in the editor: the same toggle as the live page
 * (character_modes.js), in the same place, so contributors write what they see.
 * The editor never learns about states: window.currentEditorDescData and
 * currentEditorFrameData point at the active state's slice of the masters, a
 * live reference, so every writer lands in the right place unchanged. For the
 * base state the slice is the master itself.
 * @since v0.12
 * @touches window.editorMasterDescData and editorMasterFrameData, frame_data.modes,
 *   modeData, ?mode=, window.interceptedTicketData
 * @watch only two paths know about states: drafts and Submit persist the
 *   masters, and scopeEditorDelta wraps each scope so a state's edit lands in
 *   modeData. An IIFE, since other files declare a top-level `esc`.
 * @see docs/editor.md
 */

(function () {
    // Anything that is not a system, tier list, gallery or tool page is a character.
    const NON_CHARACTER_TYPES = new Set(['system', 'tierlist', 'gallery', 'tool']);

    function editorSupportsModes() {
        return !NON_CHARACTER_TYPES.has(window.currentEditorPageType);
    }

    const BASE = () => window.BASE_MODE_ID;
    const isBase = (m) => window.isBaseMode(m);

    // The masters; currentEditor* are views onto them.
    window.editorMasterDescData = null;
    window.editorMasterFrameData = null;
    window.originalCloudMasterDesc = null;
    window.originalCloudMasterFrame = null;

    window.editorActiveMode = null;
    window.editorIsBaseOnlyCharacter = false;

    // Writable creates the state's bucket, since it is about to be typed into.
    // Read-only never does, so the cloud copy stays as it was.
    function writableView(master, modeId) {
        if (!master) return {};
        if (isBase(modeId)) return master;
        if (!master.modeData) master.modeData = {};
        if (!master.modeData[modeId]) master.modeData[modeId] = {};
        return master.modeData[modeId];
    }

    function readonlyView(master, modeId) {
        if (!master) return {};
        if (isBase(modeId)) return master;
        return (master.modeData && master.modeData[modeId]) || {};
    }

    /**
     * Points currentEditorDescData and currentEditorFrameData at the active state.
     */
    window.applyEditorModeView = function() {
        const modeId = window.editorActiveMode;

        window.currentEditorDescData = writableView(window.editorMasterDescData, modeId);
        window.currentEditorFrameData = writableView(window.editorMasterFrameData, modeId);
        window.originalCloudDescData = readonlyView(window.originalCloudMasterDesc, modeId);
        window.originalCloudFrameData = readonlyView(window.originalCloudMasterFrame, modeId);

        // skill_card.js resolves the preview's moves through this, as the live page does,
        // so both render a state by one code path.
        window.activeCharacterMode = modeId;
    };

    /**
     * The scope a delta is sent under: plain for the base state, so every ticket in
     * the queue keeps applying, and wrapped once for any other (applyDeltaToData
     * unwraps it), so the scopes in between never learn states exist.
     */
    window.scopeEditorDelta = function(scope, key) {
        if (isBase(window.editorActiveMode)) return { scope, key };
        return { scope: 'mode', key: `${window.editorActiveMode}::${scope}::${key}` };
    };

    function declaredModes() {
        return window.getCharacterModes(window.editorMasterFrameData || {});
    }

    // Ids are the delta keys and the ?mode= in shared links, fixed at creation: a
    // rename touches the label only, so no content is orphaned.
    function nextModeId(existing, stem) {
        const taken = new Set(existing.map(m => m.id));
        if (!taken.has(stem)) return stem;
        for (let n = 2; n < 99; n++) {
            if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
        }
        return `${stem}-${Date.now()}`;
    }

    // A full character's other states are its ultimates. A base-only character's
    // ultimate is its own tab, so its states are other forms (an install).
    function newStateNaming() {
        return window.editorIsBaseOnlyCharacter
            ? { stem: 'state', word: 'New State' }
            : { stem: 'ultimate', word: 'Ultimate' };
    }

    const MAX_STATES = 4;
    const TOO_MANY_STATES = 'A character can have at most four states. Rename or remove one first.';

    // A deep copy of the base kit's moves, with their strategy notes. From here they
    // are the state's own: a later fix to the base kit does not reach them.
    function copyBaseKitInto(modeId) {
        const frame = window.editorMasterFrameData || {};
        const desc = window.editorMasterDescData || {};
        const frameSlice = writableView(frame, modeId);
        const clone = (v) => JSON.parse(JSON.stringify(v));

        const ids = new Set();
        window.FRAME_MOVE_CATEGORIES.forEach(cat => {
            if (!Array.isArray(frame[cat]) || frame[cat].length === 0) return;
            frameSlice[cat] = clone(frame[cat]);
            frame[cat].forEach(m => { if (m && m.id) ids.add(m.id); });
        });

        const notes = desc.moveStrategies || {};
        const copied = Object.keys(notes).filter(id => ids.has(id));
        if (copied.length === 0) return;
        const descSlice = writableView(desc, modeId);
        descSlice.moveStrategies = {};
        copied.forEach(id => { descSlice.moveStrategies[id] = clone(notes[id]); });
    }

    // start: 'empty' (every tab blank) or 'copy' (the base kit's moves); + STATE asks.
    window.addEditorMode = async function(start = 'empty') {
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

        const master = window.editorMasterFrameData;
        if (!master) return;

        // The first added state declares the base one too, or the toggle would have one
        // button and no way back.
        if (!Array.isArray(master.modes) || master.modes.length === 0) {
            master.modes = [{ id: BASE(), label: 'Base Kit' }];
        }

        const existing = declaredModes();
        if (existing.length >= MAX_STATES) {
            window.editorAlert(TOO_MANY_STATES);
            return;
        }

        const { stem, word } = newStateNaming();
        const id = nextModeId(existing, stem);
        master.modes.push({ id, label: existing.length === 1 ? word : `${word} ${existing.length}` });
        if (start === 'copy') copyBaseKitInto(id);

        await window.setEditorMode(id);
    };

    // An ultimate replaces the whole kit, so it starts empty; an install is mostly
    // the kit buffed, quicker as a copy. Asked first, so CANCEL changes nothing.
    async function addStateFromBar() {
        if (declaredModes().length >= MAX_STATES) {
            window.editorAlert(TOO_MANY_STATES);
            return;
        }
        let start = 'empty';
        if (typeof window.customConfirm === 'function') {
            const answer = await window.customConfirm(
                "How should the new state start? COPY BASE KIT starts it with a copy of the base kit's moves, so only what changes in this state needs editing. The copy does not follow later edits to the base kit.",
                'COPY BASE KIT', false, null, 'START EMPTY'
            );
            if (answer === false) return;
            start = answer === 'alt' ? 'empty' : 'copy';
        }
        await window.addEditorMode(start);
    }

    window.renameEditorMode = function(label) {
        const master = window.editorMasterFrameData;
        if (!master || !Array.isArray(master.modes)) return;

        const entry = master.modes.find(m => m.id === window.editorActiveMode);
        if (!entry) return;

        entry.label = label;

        // The chip's text only: this runs per keystroke, and a redraw would destroy the
        // field being typed in.
        const chip = document.querySelector(`#editor-mode-bar [data-mode-id="${CSS.escape(entry.id)}"]`);
        if (chip) chip.textContent = label;

        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    };

    window.deleteEditorMode = async function() {
        if (isBase(window.editorActiveMode)) return;

        const doomed = window.editorActiveMode;
        const label = (declaredModes().find(m => m.id === doomed) || {}).label || doomed;

        const ok = await window.confirmDelete(
            `Delete the "${label}" state and everything written for it?\n\nIts moves, overview, matchups and counterplay all go with it. The base kit is untouched.`,
            'DELETE STATE'
        );
        if (!ok) return;

        const frame = window.editorMasterFrameData;
        const desc = window.editorMasterDescData;

        if (frame) {
            if (Array.isArray(frame.modes)) frame.modes = frame.modes.filter(m => m.id !== doomed);
            if (frame.modeData) delete frame.modeData[doomed];
            // One state left is none: the declaration goes, and with it the toggle.
            if (Array.isArray(frame.modes) && frame.modes.length < 2) delete frame.modes;
        }
        if (desc && desc.modeData) delete desc.modeData[doomed];

        await window.setEditorMode(BASE());
    };

    window.setEditorMode = async function(modeId) {
        if (modeId === window.editorActiveMode) return;

        // Flushed first: the Block buffer reaches desc_data only on sync, and would land
        // in the wrong state.
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

        // The reset switchEditorTab does, through the shared function: each loader
        // flushes the previous selection's Blocks on entry, and that selection belongs
        // to the state being left.
        window.clearEditorSubSelection();

        window.editorActiveMode = isBase(modeId) ? BASE() : modeId;
        window.applyEditorModeView();

        renderEditorModeBar();

        const tabId = window.currentEditorTabId || 'overview';

        if (typeof initFullTabEditor === 'function') {
            initFullTabEditor(
                window.currentEditorCharId, tabId,
                window.currentEditorDescData, window.currentEditorFrameData
            );
        }

        if (typeof window.loadMoveSection === 'function' && (window.FRAME_MOVE_CATEGORIES || []).includes(tabId)) {
            await window.loadMoveSection(window.currentEditorCharId, tabId, null, 'character');
        }
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(window.currentEditorCharId, 'character');
        }

        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    };

    function renderEditorModeBar() {
        const bar = document.getElementById('editor-mode-bar');
        const controls = document.getElementById('editor-mode-controls');
        if (!bar) return;

        // A base-only character's ultimate is a tab, not a state, but it can still have
        // states: other forms, like an install.
        if (!editorSupportsModes()) {
            bar.classList.add('hidden');
            if (controls) controls.classList.add('hidden');
            return;
        }

        const modes = declaredModes();
        const active = window.editorActiveMode || BASE();

        bar.classList.remove('hidden');

        const chips = modes.map(m => {
            const isActive = m.id === active;
            return `<button type="button" class="character-mode-chip${isActive ? ' active' : ''}"` +
                ` aria-pressed="${isActive ? 'true' : 'false'}" data-mode-id="${window.escapeHtml(m.id)}">${window.escapeHtml(m.label)}</button>`;
        }).join('');

        // The add button carries no mode id, so the delegated handler tells it apart.
        bar.innerHTML = `${chips}<button type="button" class="character-mode-chip editor-mode-add" data-mode-add="true">+ STATE</button>`;

        if (!controls) return;

        if (modes.length === 0 || isBase(active)) {
            controls.classList.add('hidden');
            controls.innerHTML = '';
            return;
        }

        const label = (modes.find(m => m.id === active) || {}).label || '';
        controls.classList.remove('hidden');
        controls.innerHTML = `
            <label class="editor-mode-label-field">
                <span>State name</span>
                <input type="text" id="editor-mode-name" value="${window.escapeHtml(label)}" maxlength="40">
            </label>
            <span class="editor-mode-id-hint">?mode=${window.escapeHtml(active)}</span>
            <button type="button" id="editor-mode-delete" class="btn-sys btn-sys-red">DELETE STATE</button>
        `;

        document.getElementById('editor-mode-name').addEventListener('input', (e) => {
            window.renameEditorMode(e.target.value);
        });
        document.getElementById('editor-mode-delete').addEventListener('click', () => window.deleteEditorMode());
    }

    window.renderEditorModeBar = renderEditorModeBar;

    function wireModeBar() {
        const bar = document.getElementById('editor-mode-bar');
        if (!bar || bar.dataset.wired === 'true') return;
        bar.dataset.wired = 'true';

        bar.addEventListener('click', (e) => {
            const add = e.target.closest('[data-mode-add]');
            if (add && bar.contains(add)) { addStateFromBar(); return; }

            const chip = e.target.closest('[data-mode-id]');
            if (chip && bar.contains(chip)) window.setEditorMode(chip.dataset.modeId);
        });
    }

    async function isBaseOnly(pageId) {
        if (typeof window.fetchNavigationData !== 'function') return false;
        try {
            const nav = await window.fetchNavigationData();
            for (const entries of Object.values(nav || {})) {
                if (!Array.isArray(entries)) continue;
                const hit = entries.find(e => e && e.cms_config && e.cms_config.pageId === pageId);
                if (hit) return !!hit.isBaseOnly;
            }
        } catch (e) {
            console.warn('[Editor] Could not read the page registry:', e);
        }
        return false;
    }

    // The Ultimate tab is only for base-only characters: on a full character its
    // ultimate is a state.
    function revealUltimateTab(show) {
        const btn = document.getElementById('edit-nav-ultimateAtk');
        if (btn) btn.classList.toggle('hidden', !show);
    }

    /**
     * Sets up states once the page's data is loaded and before the builder is
     * routed, so the first initFullTabEditor sees the right slice.
     */
    window.initEditorModes = async function(pageId, descData, frameData) {
        window.editorMasterDescData = descData;
        window.editorMasterFrameData = frameData;
        window.originalCloudMasterDesc = window.originalCloudDescData;
        window.originalCloudMasterFrame = window.originalCloudFrameData;

        if (!editorSupportsModes()) {
            window.editorActiveMode = BASE();
            return;
        }

        window.editorIsBaseOnlyCharacter = await isBaseOnly(pageId);

        const modes = declaredModes();

        // A reviewer intercepting a ticket lands on the state it edits, or their
        // corrections would go into the wrong state. The ticket wins over ?mode=.
        const intercepted = window.interceptedTicketData;
        const fromTicket = (intercepted && intercepted.target_scope === 'mode' && typeof intercepted.target_key === 'string')
            ? intercepted.target_key.split('::')[0]
            : null;

        const requested = fromTicket || new URLSearchParams(window.location.search).get('mode');
        const valid = modes.some(m => m.id === requested);

        window.editorActiveMode = valid ? requested : BASE();
        window.applyEditorModeView();

        renderEditorModeBar();
        wireModeBar();
        revealUltimateTab(window.editorIsBaseOnlyCharacter);
    };
})();
