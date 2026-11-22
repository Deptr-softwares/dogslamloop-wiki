/**
 * Character modes and the Ultimate tab. A full character's ultimate states swap
 * its whole moveset, so a toggle above the tab strip picks the state and the tabs
 * draw again under it (Gallery stays put). A base-only character's ultimate is one
 * attack, so it gets an Ultimate tab after Counterplay instead.
 * @since v0.12
 * @touches frame_data.modeData (getCharacterModes), data/navigation.json
 *   (isBaseOnly), ?mode= in the address, window.activeCharacterMode
 * @watch both are added at runtime, not generated into the stub, so a new mode
 *   shows once it is approved. This file loads before page_boot.js, so ?mode= is
 *   set before the first fetch and a shared link never draws the base kit first.
 * @see docs/character-page.md
 */

(function () {
    const ULTIMATE_TAB_ID = 'ultimateAtk';
    const ULTIMATE_TAB_LABEL = 'Ultimate';

    // The static strip, registered again with the Ultimate tab so the buttons bound at
    // boot hide it too. includeOptional, as page_boot.js passes it, or a Techs tab
    // would lose its binding. Without character_tabs.js (a stale cached stub), the
    // strip page_router built is the answer.
    const staticTabIds = () => (window.getCharacterTabIds
        ? window.getCharacterTabIds({ includeOptional: true })
        : Array.from(document.querySelectorAll('.character-nav button[id^="nav-"]'))
            .map(b => b.id.slice(4))
            .filter(id => id !== ULTIMATE_TAB_ID));

    // Read before DOMContentLoaded on purpose - see the header note. An
    // undeclared mode is corrected in initCharacterModes once the data lands.
    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    if (requestedMode) window.activeCharacterMode = requestedMode;

    // site_utils.js may be an older cached copy than this file: local fallbacks for
    // the trivial predicates, and init bails, so the skew costs the toggle, not the page.
    const isBase = (m) => (typeof window.isBaseMode === 'function' ? window.isBaseMode(m) : (!m || m === 'base'));

    async function findNavEntry(pageId) {
        if (typeof window.fetchNavigationData !== 'function') return null;
        try {
            const nav = await window.fetchNavigationData();
            if (!nav) return null;
            for (const entries of Object.values(nav)) {
                if (!Array.isArray(entries)) continue;
                const hit = entries.find(e => e && e.cms_config && e.cms_config.pageId === pageId);
                if (hit) return hit;
            }
        } catch (e) {
            console.warn('[Modes] Could not read the page registry:', e);
        }
        return null;
    }

    function injectUltimateTab() {
        if (document.getElementById(`tab-${ULTIMATE_TAB_ID}`)) return false;

        const counterplayBtn = document.getElementById('nav-counterplay');
        const nav = document.querySelector('.character-nav');
        if (!nav) return false;

        const btn = document.createElement('button');
        btn.id = `nav-${ULTIMATE_TAB_ID}`;
        btn.className = 'btn-manga btn-manga-slanted';
        btn.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${window.escapeHtml(ULTIMATE_TAB_LABEL)}</span></div>`;

        // After Counterplay, leaving Gallery last: past the media, an Ultimate tab would be
        // the one tab nobody scrolls to.
        if (counterplayBtn) counterplayBtn.insertAdjacentElement('afterend', btn);
        else nav.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = `tab-${ULTIMATE_TAB_ID}`;
        panel.className = 'vessel-content hidden';

        const counterplayPanel = document.getElementById('tab-counterplay');
        if (counterplayPanel) counterplayPanel.insertAdjacentElement('afterend', panel);
        else document.querySelector('.main-content-area')?.appendChild(panel);

        if (typeof window.setupTabs === 'function') {
            window.setupTabs('nav', 'tab', staticTabIds().concat(ULTIMATE_TAB_ID), 'major');
        }
        return true;
    }

    function renderModeBar(modes, activeId) {
        const bar = document.getElementById('character-mode-bar');
        if (!bar) return;

        if (!modes || modes.length < 2) {
            bar.classList.add('hidden');
            bar.innerHTML = '';
            return;
        }

        bar.classList.remove('hidden');
        bar.innerHTML = modes.map(m => {
            const isActive = m.id === activeId;
            return `<button type="button" role="tab" aria-selected="${isActive ? 'true' : 'false'}"` +
                ` class="character-mode-chip${isActive ? ' active' : ''}"` +
                ` data-mode-id="${window.escapeHtml(m.id)}">${window.escapeHtml(m.label)}</button>`;
        }).join('');
    }

    // null, undefined and 'base' all name the same state - the top-level data.
    // Comparing them raw would make a bare page URL look like a mode change
    // away from `base` and redraw the whole page for nothing.
    const sameMode = (a, b) => (isBase(a) && isBase(b)) || a === b;

    /**
     * Switches the page to a mode: draws the move tabs and the descriptions again for
     * it, and writes ?mode= (dropped for base, so the address stays the bare one).
     */
    window.switchCharacterMode = async function(modeId) {
        if (sameMode(modeId, window.activeCharacterMode)) return;

        const route = window.PAGE_ROUTE;
        if (!route || !route.pageId) return;

        window.activeCharacterMode = modeId;
        renderModeBar(window.declaredCharacterModes, modeId);

        // The same shape as page_boot.js's character boot: the move tabs fired without
        // waiting, the descriptions beside them (loadPageDescriptions waits 300ms for the
        // cards).
        if (typeof window.loadMoveSection === 'function') {
            (window.FRAME_MOVE_CATEGORIES || []).forEach(cat => {
                if (document.getElementById(`tab-${cat}`)) {
                    window.loadMoveSection(route.pageId, cat, null, 'character', modeId);
                }
            });
        }

        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(route.pageId, 'character', modeId);
        }

        const url = new URL(window.location.href);
        if (isBase(modeId)) url.searchParams.delete('mode');
        else url.searchParams.set('mode', modeId);
        window.history.replaceState({}, '', url);

        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 400);
    };

    function wireModeBar() {
        const bar = document.getElementById('character-mode-bar');
        if (!bar || bar.dataset.wired === 'true') return;
        bar.dataset.wired = 'true';

        bar.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-mode-id]');
            if (!chip || !bar.contains(chip)) return;
            window.switchCharacterMode(chip.dataset.modeId);
        });
    }

    /**
     * Reads the character's modes and base-only flag, adds the Ultimate tab where it
     * applies, and draws the toggle for two or more modes.
     * @watch a ?mode= this character does not have draws the page again for base
     */
    window.initCharacterModes = async function(pageId) {
        if (typeof window.getCharacterModes !== 'function') {
            console.warn('[Modes] site_utils.js is older than this file (likely a cached copy). The state toggle is off for this load; reload to restore it.');
            return;
        }

        const [cloud, navEntry] = await Promise.all([
            typeof window.fetchCloudCharacterData === 'function' ? window.fetchCloudCharacterData(pageId) : null,
            findNavEntry(pageId),
        ]);

        const frameData = (cloud && cloud.frame_data)
            || (window.cachedMasterFrameData && window.cachedMasterFrameData[pageId])
            || {};

        const modes = typeof window.getCharacterModes === 'function' ? window.getCharacterModes(frameData) : [];
        window.declaredCharacterModes = modes;

        // A base-only character gets the tab even when it is empty, so the team sees there
        // is something to fill; so does any page with ultimate moves, so a wrong registry
        // flag never hides data.
        const hasUltimateMoves = Array.isArray(frameData[ULTIMATE_TAB_ID]) && frameData[ULTIMATE_TAB_ID].length > 0;
        if ((navEntry && navEntry.isBaseOnly) || hasUltimateMoves) {
            if (injectUltimateTab() && typeof window.loadMoveSection === 'function') {
                window.loadMoveSection(pageId, ULTIMATE_TAB_ID, null, 'character', window.activeCharacterMode);
            }
        }

        if (modes.length < 2) {
            renderModeBar(modes, null);
            // A stale or typed ?mode= on a character with no modes: the boot drew against it
            // and the page is blank, so it is drawn again for base.
            await window.switchCharacterMode(null);
            return;
        }

        const isDeclared = modes.some(m => m.id === window.activeCharacterMode);
        const activeId = isDeclared ? window.activeCharacterMode : modes[0].id;

        renderModeBar(modes, activeId);
        wireModeBar();

        // The same correction for a ?mode= this character does not have. No ?mode= at all
        // is a no-op.
        await window.switchCharacterMode(activeId);
    };
})();
