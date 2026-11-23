/**
 * Character states in the Overseer's preview: the state toggle, the Ultimate tab
 * for the state on screen, and a marker on each state the revision changed, so
 * "nothing changed here" is told apart from "this is the wrong state".
 * @since v0.14
 * @touches window.activePreviewMode, window.changedModes, getCharacterModes,
 *   resolveModeFrame and resolveModeDesc (site_data.js), unwrapModeDelta (submission_delta.js),
 *   setupTabs (page_shell.js), switchVersionView (admin-preview.js)
 * @watch not character_modes.js: that one is built for the live page (the address
 *   bar, its own fetch), and this one draws two versions held in memory.
 * @see docs/overseer.md
 */

(function () {
    const ULTIMATE_TAB_ID = 'ultimateAtk';
    const ULTIMATE_TAB_LABEL = 'Ultimate';

    // overseer.html's strip: the editable tabs, optional ones included, since this
    // runs before any revision says which it has. Registered again when Ultimate is
    // added, so buttons bound at boot hide it. It repeats admin-core.js's list on
    // purpose, so this call does not depend on that one running first.
    const ADMIN_CHARACTER_TABS = window.getCharacterTabIds({ editableOnly: true, includeOptional: true });

    const BASE = () => window.BASE_MODE_ID || 'base';
    const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === 'base'));

    const sameState = (a, b) => ((isBase(a) && isBase(b)) || a === b);

    // Every state either version declares, live first: a revision that deletes a
    // state must let the reviewer open it first.
    function previewModes() {
        const read = (frame) => (typeof window.getCharacterModes === 'function'
            ? window.getCharacterModes(frame || {})
            : []);

        const out = [];
        [window.currentLiveFrameData, window.currentPendingFrameData].forEach(frame => {
            read(frame).forEach(m => { if (!out.some(x => x.id === m.id)) out.push(m); });
        });
        return out;
    }

    // The base kit is the top level without the state buckets, or every state edit
    // would read as a base edit too.
    function scopedDesc(full, modeId) {
        const base = full || {};
        if (!isBase(modeId)) return (base.modeData || {})[modeId] || {};
        const out = Object.assign({}, base);
        delete out.modeData;
        return out;
    }

    function scopedFrame(full, modeId) {
        const base = full || {};
        if (!isBase(modeId)) return (base.modeData || {})[modeId] || {};
        const out = Object.assign({}, base);
        delete out.modeData;
        delete out.modes;
        return out;
    }

    /**
     * Which states the revision touches: the dot on the toggle's chips and the "also
     * changed in" line.
     */
    window.computeChangedModes = function(rev) {
        const changed = [];
        const mark = (modeId) => {
            const id = isBase(modeId) ? BASE() : modeId;
            if (!changed.includes(id)) changed.push(id);
        };

        if (window.activePreviewPageType !== 'character') return changed;

        if (rev && rev.is_delta) {
            const edits = (rev.target_scope === 'multi' && Array.isArray(rev.delta_payload))
                ? rev.delta_payload.map(e => ({ scope: e && e.scope, key: e && e.key }))
                : [{ scope: rev.target_scope, key: rev.target_key }];

            edits.forEach(({ scope, key }) => {
                mark(window.unwrapModeDelta(scope, key).modeId);
            });
            return changed;
        }

        // A full overwrite has no scope to read, so each state is compared.
        const ids = previewModes().map(m => m.id);
        if (!ids.some(isBase)) ids.unshift(BASE());

        ids.forEach(id => {
            const descChanged = JSON.stringify(scopedDesc(window.currentLiveDescData, id))
                !== JSON.stringify(scopedDesc(window.currentPendingDescData, id));
            const frameChanged = JSON.stringify(scopedFrame(window.currentLiveFrameData, id))
                !== JSON.stringify(scopedFrame(window.currentPendingFrameData, id));
            if (descChanged || frameChanged) mark(id);
        });

        return changed;
    };

    function wireModeBar(bar) {
        if (bar.dataset.wired === 'true') return;
        bar.dataset.wired = 'true';

        // data-mode-id and one delegated listener: the id and label are contributor text.
        bar.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-mode-id]');
            if (!chip || !bar.contains(chip)) return;
            window.switchPreviewMode(chip.dataset.modeId);
        });
    }

    window.renderPreviewModeBar = function() {
        const bar = document.getElementById('preview-mode-bar');
        if (!bar) return;

        const modes = previewModes();
        if (window.activePreviewPageType !== 'character' || modes.length < 2) {
            bar.classList.add('hidden');
            bar.innerHTML = '';
            return;
        }

        const active = window.activePreviewMode || null;
        const changed = window.changedModes || [];

        bar.classList.remove('hidden');
        bar.innerHTML = modes.map(m => {
            const on = sameState(m.id, active);
            const hasChanges = changed.some(id => sameState(id, m.id));
            return `<button type="button" role="tab" aria-selected="${on ? 'true' : 'false'}"` +
                ` class="character-mode-chip${on ? ' active' : ''}${hasChanges ? ' tab-changed' : ''}"` +
                ` data-mode-id="${window.escapeHtml(m.id)}">${window.escapeHtml(m.label)}</button>`;
        }).join('');

        wireModeBar(bar);
    };

    window.switchPreviewMode = async function(modeId) {
        const next = isBase(modeId) ? null : modeId;
        if (sameState(next, window.activePreviewMode || null)) return;

        window.activePreviewMode = next;
        window.activeCharacterMode = next;

        // The Ultimate tab belongs to the state on screen.
        window.syncPreviewUltimateTab();

        const rev = (window.currentQueueData || []).find(r => r.id === window.activePreviewRevId);
        if (rev && typeof calculateTabDiffs === 'function') calculateTabDiffs(rev);

        window.renderPreviewModeBar();

        // The same view redraws: switching state asks about the same comparison.
        if (typeof window.switchVersionView === 'function') {
            await window.switchVersionView(window.activePreviewViewMode || 'pending');
        }
    };

    // Shown when either version has ultimate moves in the state on screen. Unlike
    // the live page, no empty Ultimate tab: a reviewer has nothing to fill.
    function ultimateMoveCount(frame, modeId) {
        const scoped = (typeof window.resolveModeFrame === 'function')
            ? window.resolveModeFrame(frame || {}, modeId)
            : (frame || {});
        const moves = scoped[ULTIMATE_TAB_ID];
        return Array.isArray(moves) ? moves.length : 0;
    }

    window.previewHasUltimate = function() {
        if (window.activePreviewPageType !== 'character') return false;
        const mode = window.activePreviewMode || null;
        return ultimateMoveCount(window.currentLiveFrameData, mode) > 0
            || ultimateMoveCount(window.currentPendingFrameData, mode) > 0;
    };

    window.syncPreviewUltimateTab = function() {
        const nav = document.getElementById('preview-tab-nav');
        if (!nav) return false;

        const btn = document.getElementById(`nav-${ULTIMATE_TAB_ID}`);
        const panel = document.getElementById(`tab-${ULTIMATE_TAB_ID}`);
        const wanted = window.previewHasUltimate();

        if (!wanted) {
            // setupTabs keeps 'ultimateAtk' registered, and every lookup there is
            // null-guarded, so removing the nodes is safe.
            const wasActive = btn && btn.classList.contains('active');
            if (btn) btn.remove();
            if (panel) panel.remove();
            if (wasActive && typeof window.setActiveRevisionTab === 'function') {
                window.setActiveRevisionTab('overview');
            }
            return false;
        }

        if (btn && panel) return true;

        if (!btn) {
            const created = document.createElement('button');
            created.id = `nav-${ULTIMATE_TAB_ID}`;
            created.className = 'btn-manga btn-manga-slanted';
            created.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${window.escapeHtml(ULTIMATE_TAB_LABEL)}</span></div>`;

            const counterplayBtn = document.getElementById('nav-counterplay');
            if (counterplayBtn) counterplayBtn.insertAdjacentElement('afterend', created);
            else nav.appendChild(created);

            created.addEventListener('click', () => {
                if (typeof updateAdminTOC === 'function') setTimeout(updateAdminTOC, 150);
            });
        }

        if (!panel) {
            const created = document.createElement('div');
            created.id = `tab-${ULTIMATE_TAB_ID}`;
            created.className = 'hidden';

            const counterplayPanel = document.getElementById('tab-counterplay');
            if (counterplayPanel) counterplayPanel.insertAdjacentElement('afterend', created);
            else document.getElementById('preview-content-area')?.appendChild(created);
        }

        if (typeof window.setupTabs === 'function') {
            window.setupTabs('nav', 'tab', ADMIN_CHARACTER_TABS.concat(ULTIMATE_TAB_ID), 'major');
        }
        return true;
    };

    /**
     * Called by previewRevision once both versions are in memory: picks the state to
     * open on, builds the toggle and the Ultimate tab, and sets
     * window.activePreviewMode for every renderer after it.
     */
    window.initPreviewStates = function(rev) {
        window.activePreviewMode = null;
        window.changedModes = [];

        if (window.activePreviewPageType !== 'character') {
            window.activeCharacterMode = null;
            window.renderPreviewModeBar();
            window.syncPreviewUltimateTab();
            return;
        }

        // A delta names its state, so the preview opens on it rather than the base kit.
        let target = null;
        if (rev && rev.is_delta) {
            if (rev.target_scope === 'mode') {
                target = window.unwrapModeDelta(rev.target_scope, rev.target_key).modeId;
            } else if (rev.target_scope === 'multi' && Array.isArray(rev.delta_payload)) {
                const stateEdit = rev.delta_payload.find(e => e && e.scope === 'mode');
                if (stateEdit) target = window.unwrapModeDelta(stateEdit.scope, stateEdit.key).modeId;
            }
        }

        window.changedModes = window.computeChangedModes(rev);

        // A full overwrite that changed exactly one state, not the base, opens on it too.
        if (!target && window.changedModes.length === 1 && !isBase(window.changedModes[0])) {
            target = window.changedModes[0];
        }

        window.activePreviewMode = isBase(target) ? null : target;
        window.activeCharacterMode = window.activePreviewMode;

        window.renderPreviewModeBar();
        window.syncPreviewUltimateTab();
    };
})();
