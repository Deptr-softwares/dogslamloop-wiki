/**
 * Dogslamloop Wiki - Admin Overseer: character states in the preview
 *
 * Character states shipped in v0.12 and the reviewer's preview was never
 * taught about them. Everything below exists to close one gap: a revision
 * that edits a state rendered as *unchanged*, because the preview only ever
 * drew the base kit and offered no way to leave it.
 *
 * That is worse than a rendering bug. A reviewer who cannot see the change is
 * approving blind, and Diff View is a fallback for checking detail - not a
 * substitute for seeing the page. Same family as the v0.12 merge-compiler
 * P0: nothing is destroyed outright, the review process just quietly stops
 * being a review.
 *
 * Three things are needed, and they are all here rather than in
 * js/character_modes.js:
 *
 *   - a state toggle, so a reviewer can look at any state the revision or the
 *     live page declares;
 *   - the Ultimate tab, which base-only characters keep their whole ultimate
 *     in and which admin.html's static tab strip has no button for;
 *   - a marker saying which states changed, so "nothing changed here" is
 *     distinguishable from "you are looking at the wrong state".
 *
 * character_modes.js is not reused because it is built around the live page:
 * it reads window.PAGE_ROUTE, rewrites ?mode= in the address bar, and fetches
 * its own data from the cloud. The preview has none of that - it renders two
 * in-memory versions (pending and live) of a page that does not exist yet.
 * The shared half is the part that is genuinely shared already:
 * getCharacterModes, resolveModeFrame, resolveModeDesc and unwrapModeDelta in
 * js/site_utils.js.
 */

(function () {
    const ULTIMATE_TAB_ID = 'ultimateAtk';
    const ULTIMATE_TAB_LABEL = 'Ultimate';

    // The static strip in admin.html. Re-registering the whole list when the
    // Ultimate tab is injected is what teaches the six buttons bound at boot
    // to also hide it when they are clicked (see setupTabs, js/pagebuilder.js).
    const ADMIN_CHARACTER_TABS = ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'];

    const BASE = () => window.BASE_MODE_ID || 'base';
    const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === 'base'));
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s === null || s === undefined ? '' : s));

    // null, undefined and 'base' all name the same state.
    const sameState = (a, b) => ((isBase(a) && isBase(b)) || a === b);

    // Every state either version declares, live first. The union rather than
    // just the pending side, because a revision that *deletes* a state still
    // has to be reviewable: the reviewer needs to open the thing being removed
    // and see what is in it before agreeing to lose it.
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
    window.previewCharacterModes = previewModes;

    function stateLabel(modeId) {
        const hit = previewModes().find(m => sameState(m.id, modeId));
        return (hit && hit.label) || (isBase(modeId) ? 'Base Kit' : String(modeId));
    }
    window.previewStateLabel = stateLabel;

    // The base kit is the top level minus the state buckets. Comparing the
    // whole object instead would report every state edit as a base edit too,
    // which is the reverse of the bug this file fixes.
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

    // Which states this revision actually touches. Drives the dot on the
    // chips and the "also changed in" line in the popup - the two things that
    // tell a reviewer looking at an unchanged base kit that the edit is real
    // and lives somewhere else.
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

        // A full overwrite carries no scope to read, so compare state by
        // state. Includes base, which is the only state the old preview could
        // show at all.
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

    // --- THE STATE TOGGLE ---
    function wireModeBar(bar) {
        if (bar.dataset.wired === 'true') return;
        bar.dataset.wired = 'true';

        // data-mode-id plus one delegated listener, never an inline onclick -
        // the id and label are contributor-authored and reach this markup.
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
                ` data-mode-id="${esc(m.id)}">${esc(m.label)}</button>`;
        }).join('');

        wireModeBar(bar);
    };

    window.switchPreviewMode = async function(modeId) {
        const next = isBase(modeId) ? null : modeId;
        if (sameState(next, window.activePreviewMode || null)) return;

        window.activePreviewMode = next;
        window.activeCharacterMode = next;

        // The Ultimate tab belongs to whichever state is on screen, so it can
        // appear and disappear as states are switched.
        window.syncPreviewUltimateTab();

        const rev = (window.currentQueueData || []).find(r => r.id === window.activePreviewRevId);
        if (rev && typeof calculateTabDiffs === 'function') calculateTabDiffs(rev, false);

        window.renderPreviewModeBar();

        // Redraw whichever of pending/live/diff the reviewer was already in,
        // rather than snapping them back to a default - switching state is a
        // question about the same comparison, not a new one.
        if (typeof window.switchVersionView === 'function') {
            await window.switchVersionView(window.activePreviewViewMode || 'pending');
        }
    };

    // --- THE ULTIMATE TAB ---
    //
    // Shown when either version has ultimate moves in the state being viewed.
    // This deliberately differs from the live page, which also shows an empty
    // Ultimate tab for any character the registry marks base-only: there, an
    // empty tab is how the team sees there is something to fill. A reviewer is
    // not filling anything, and an always-present empty tab in a review strip
    // is one more place to check that never has anything in it.
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
            // setupTabs keeps 'ultimateAtk' in its id list once registered,
            // but every lookup there is null-guarded, so removing the nodes is
            // safe and leaves no dangling handler.
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
            created.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${esc(ULTIMATE_TAB_LABEL)}</span></div>`;

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

    // --- ENTRY POINT ---
    //
    // Called by previewRevision once both versions are in memory. Picks the
    // state to open on, builds the toggle and the Ultimate tab, and leaves
    // window.activePreviewMode set for every renderer downstream.
    window.initPreviewStates = function(rev) {
        window.activePreviewMode = null;
        window.changedModes = [];

        if (window.activePreviewPageType !== 'character') {
            window.activeCharacterMode = null;
            window.renderPreviewModeBar();
            window.syncPreviewUltimateTab();
            return;
        }

        // A delta names the state it edits, so open on it. Without this a
        // reviewer handed an ultimate-state edit is shown the base kit, where
        // nothing has changed - the worst possible thing to put in front of
        // someone about to click Approve.
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

        // A full overwrite carries no scope to read. If it changed exactly one
        // state and that state is not the base kit, open on it - same reasoning
        // as the delta case, reached by comparison instead of by declaration.
        if (!target && window.changedModes.length === 1 && !isBase(window.changedModes[0])) {
            target = window.changedModes[0];
        }

        window.activePreviewMode = isBase(target) ? null : target;
        window.activeCharacterMode = window.activePreviewMode;

        window.renderPreviewModeBar();
        window.syncPreviewUltimateTab();
    };
})();
