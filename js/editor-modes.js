/**
 * Dogslamloop Wiki - Editor: character modes
 *
 * The editor side of js/character_modes.js. Same toggle, in the same shape and
 * the same place, because the live page is what contributors are looking at
 * when they decide what to write.
 *
 * The whole design rests on one trick: the editor never learns about modes.
 * window.currentEditorDescData and window.currentEditorFrameData are re-pointed
 * at the active mode's slice of the master objects, and every existing writer
 * - the block buffer, the move editor, the matchup list, the sync engine -
 * keeps writing through them exactly as before. The slice is a live reference
 * into the master, so those writes land in the right place with no plumbing.
 *
 * For the base mode the slice IS the master, by identity. That is what makes
 * this free for the 22 characters that have no modes: same objects, same
 * writes, same everything.
 *
 * Only two things had to know: the draft/submit path, which must persist the
 * master rather than the slice, and the delta builder, which wraps each scope
 * so a mode edit lands in modeData instead of over the base kit.
 *
 * Wrapped in an IIFE because every script on this page shares one global
 * scope, and js/post-editor.js and js/dashboards.js each already declare a
 * top-level `esc`.
 */

(function () {
    // Anything that is not a system, tierlist or gallery page is a character
    // page - the editor's own convention (see initFullTabEditor).
    const NON_CHARACTER_TYPES = new Set(['system', 'tierlist', 'gallery', 'tool']);

    function editorSupportsModes() {
        return !NON_CHARACTER_TYPES.has(window.currentEditorPageType);
    }

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

    // Local fallbacks for the two trivial predicates this module leans on, so
    // an hour-old cached site_utils.js cannot throw partway through a render.
    // A one-line duplicate of a one-line predicate is cheaper than a module
    // that dies when its dependency is a deploy behind.
    const BASE = () => (typeof window.BASE_MODE_ID === 'string' ? window.BASE_MODE_ID : 'base');
    const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === BASE()));

    // --- STATE ---
    // The masters. currentEditor* are views onto these.
    window.editorMasterDescData = null;
    window.editorMasterFrameData = null;
    window.originalCloudMasterDesc = null;
    window.originalCloudMasterFrame = null;

    window.editorActiveMode = null;
    window.editorIsBaseOnlyCharacter = false;

    // --- VIEWS ---
    // Writable: creates the bucket, because this is the object the user is
    // about to type into. Read-only: never creates, so the pristine cloud copy
    // stays pristine and "this mode had nothing live" reads as an empty object.
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

    window.applyEditorModeView = function() {
        const modeId = window.editorActiveMode;

        window.currentEditorDescData = writableView(window.editorMasterDescData, modeId);
        window.currentEditorFrameData = writableView(window.editorMasterFrameData, modeId);
        window.originalCloudDescData = readonlyView(window.originalCloudMasterDesc, modeId);
        window.originalCloudFrameData = readonlyView(window.originalCloudMasterFrame, modeId);

        // js/framedata.js resolves the preview's move arrays through this,
        // exactly as the live page does - the editor preview and the real page
        // therefore render a mode by the same code path rather than two that
        // can drift.
        window.activeCharacterMode = modeId;
    };

    // --- DELTA SCOPING ---
    // A base-mode edit emits the plain scope it always did, so every ticket
    // already in the queue keeps applying. A mode edit is wrapped once here
    // and unwrapped once in applyDeltaToData - the nine scopes in between
    // never learn modes exist.
    window.scopeEditorDelta = function(scope, key) {
        if (isBase(window.editorActiveMode)) return { scope, key };
        return { scope: 'mode', key: `${window.editorActiveMode}::${scope}::${key}` };
    };

    // --- MODE MANAGEMENT ---
    function declaredModes() {
        if (typeof window.getCharacterModes !== 'function') return [];
        return window.getCharacterModes(window.editorMasterFrameData || {});
    }

    // site_utils.js is cached for an hour by GitHub Pages, and this file is
    // new - so the first load after a deploy can pair a fresh copy of this
    // file with an hour-old copy of that one. Calling into it bare threw
    // straight through editor-core.js's boot try/catch and took the whole
    // editor down with it ("Editor failed to initialize context", reported on
    // the live site 2026-08-10). Every other cross-file call in this codebase
    // is written `if (typeof window.x === 'function')` for exactly this
    // reason; these two modules skipped it.
    function sharedHelpersReady() {
        return typeof window.getCharacterModes === 'function'
            && typeof window.isBaseMode === 'function'
            && typeof window.BASE_MODE_ID === 'string';
    }

    // Ids are the delta keys and the ?mode= in shared links, so they are fixed
    // at creation and a later rename only ever touches the label. Renaming a
    // state must not orphan its content.
    function nextModeId(existing) {
        const taken = new Set(existing.map(m => m.id));
        if (!taken.has('ultimate')) return 'ultimate';
        for (let n = 2; n < 99; n++) {
            if (!taken.has(`ultimate-${n}`)) return `ultimate-${n}`;
        }
        return `ultimate-${Date.now()}`;
    }

    window.addEditorMode = async function() {
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

        const master = window.editorMasterFrameData;
        if (!master) return;

        // The first added state implies the base one, which until now was just
        // "the top level, with nothing declared about it". Declare it too, or
        // the toggle has one button and no way back to the base kit.
        if (!Array.isArray(master.modes) || master.modes.length === 0) {
            master.modes = [{ id: BASE(), label: 'Base Kit' }];
        }

        const existing = declaredModes();
        if (existing.length >= 4) {
            window.editorAlert('A character can have at most four states. Rename or remove one first.');
            return;
        }

        const id = nextModeId(existing);
        master.modes.push({ id, label: existing.length === 1 ? 'Ultimate' : `Ultimate ${existing.length}` });

        await window.setEditorMode(id);
    };

    window.renameEditorMode = function(label) {
        const master = window.editorMasterFrameData;
        if (!master || !Array.isArray(master.modes)) return;

        const entry = master.modes.find(m => m.id === window.editorActiveMode);
        if (!entry) return;

        entry.label = label;

        // Only the chip's text, never a redraw: this runs on every keystroke
        // in the name field, and rebuilding the controls would destroy the
        // input being typed into.
        const chip = document.querySelector(`#editor-mode-bar [data-mode-id="${CSS.escape(entry.id)}"]`);
        if (chip) chip.textContent = label;

        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    };

    window.deleteEditorMode = async function() {
        if (isBase(window.editorActiveMode)) return;

        const doomed = window.editorActiveMode;
        const label = (declaredModes().find(m => m.id === doomed) || {}).label || doomed;

        const ok = await window.customConfirm(
            `Delete the "${label}" state and everything written for it?\n\nIts moves, overview, matchups and counterplay all go with it. The base kit is untouched.`,
            'DELETE STATE', true
        );
        if (!ok) return;

        const frame = window.editorMasterFrameData;
        const desc = window.editorMasterDescData;

        if (frame) {
            if (Array.isArray(frame.modes)) frame.modes = frame.modes.filter(m => m.id !== doomed);
            if (frame.modeData) delete frame.modeData[doomed];
            // One state left is no states at all - drop the declaration so the
            // page goes back to being a plain character rather than showing a
            // toggle with a single button on it.
            if (Array.isArray(frame.modes) && frame.modes.length < 2) delete frame.modes;
        }
        if (desc && desc.modeData) delete desc.modeData[doomed];

        await window.setEditorMode(BASE());
    };

    // --- SWITCHING ---
    window.setEditorMode = async function(modeId) {
        if (modeId === window.editorActiveMode) return;

        // Flush before crossing: currentStrategyBlocks is a buffer that only
        // reaches desc_data on sync, so switching without this drops whatever
        // is being typed right now - into the wrong state, at that.
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

        // Same reset as switchEditorTab, for the same reason: every sub-tab
        // loader flushes the *previous* selection's blocks on entry, and the
        // previous selection belongs to the state being left.
        window.currentOverviewSection = null;
        window.currentMatchupIndex = undefined;
        window.currentCounterplayIndex = undefined;

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

    // --- UI ---
    function renderEditorModeBar() {
        const bar = document.getElementById('editor-mode-bar');
        const controls = document.getElementById('editor-mode-controls');
        if (!bar) return;

        // A base-only character has exactly one kit by definition; their
        // ultimate is the extra tab, not a state.
        if (!editorSupportsModes() || window.editorIsBaseOnlyCharacter) {
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
                ` aria-pressed="${isActive ? 'true' : 'false'}" data-mode-id="${esc(m.id)}">${esc(m.label)}</button>`;
        }).join('');

        // The add button carries no mode id, so the delegated handler can tell
        // it apart without a second listener.
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
                <input type="text" id="editor-mode-name" value="${esc(label)}" maxlength="40">
            </label>
            <span class="editor-mode-id-hint">?mode=${esc(active)}</span>
            <button type="button" id="editor-mode-delete" class="btn-action-delete">DELETE STATE</button>
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
            if (add && bar.contains(add)) { window.addEditorMode(); return; }

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

    // The Ultimate tab button ships in edit.html but stays hidden: it applies
    // only to base-only characters, and offering it on a full character would
    // invite writing an ultimate into a page whose ultimate is a state.
    function revealUltimateTab(show) {
        const btn = document.getElementById('edit-nav-ultimateAtk');
        if (btn) btn.classList.toggle('hidden', !show);
    }

    // --- BOOT ---
    // Called by js/editor-core.js once desc/frame data are loaded and before
    // the builder is routed, so the first initFullTabEditor already sees the
    // right slice.
    window.initEditorModes = async function(pageId, descData, frameData) {
        window.editorMasterDescData = descData;
        window.editorMasterFrameData = frameData;
        window.originalCloudMasterDesc = window.originalCloudDescData;
        window.originalCloudMasterFrame = window.originalCloudFrameData;

        // A stale cached site_utils.js means states cannot work this load.
        // Leaving currentEditor* exactly as editor-core.js set them - the whole
        // page objects - degrades to the pre-states editor, which edits the
        // base kit correctly. The next reload picks up the fresh file.
        if (!sharedHelpersReady()) {
            console.warn('[Editor] Shared helpers are older than this file (likely a cached copy). Character states are off for this load; reload to restore them.');
            window.editorActiveMode = BASE();
            return;
        }

        if (!editorSupportsModes()) {
            window.editorActiveMode = BASE();
            return;
        }

        window.editorIsBaseOnlyCharacter = await isBaseOnly(pageId);

        const modes = declaredModes();

        // A reviewer intercepting a ticket must land on the state that ticket
        // edits, not on the base kit - otherwise their corrections are written
        // into the wrong state and submitted back over the base one. The
        // ticket wins over ?mode= because admin.html opens the editor by
        // ticket id and never appends a mode.
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
