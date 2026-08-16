/**
 * Dogslamloop Wiki - Character modes and the Ultimate tab
 *
 * Two features that answer the same question - "which kit is this page talking
 * about?" - and split by how the character is built:
 *
 *   Full characters swap their entire moveset when they go ultimate, so the
 *   tabs stay and their contents change. A toggle above the tab strip picks
 *   the state; Overview, M1s, Skills, Specials, Matchups and Counterplay all
 *   re-render underneath it. Gallery does not - it is the character's media,
 *   not one state's, and it stays put across every switch.
 *
 *   Base-only characters have no second kit. Their ultimate is a single big
 *   attack, so it gets one extra tab after Counterplay rather than a toggle
 *   over a whole duplicate page.
 *
 * Both are injected at runtime rather than generated into the page stub. That
 * is deliberate: a stub only changes when the generator runs, and the whole
 * point here is that adding an ultimate mode in the editor shows up on the
 * page as soon as it is approved - not on the next regeneration.
 *
 * Loads before js/page_boot.js so ?mode= is already in place when the boot
 * sequence fires its first fetch, which is what stops a shared link rendering
 * the base kit and then visibly snapping to the ultimate.
 */

(function () {
    const ULTIMATE_TAB_ID = 'ultimateAtk';
    const ULTIMATE_TAB_LABEL = 'Ultimate';

    // The full strip as page_router.js builds it - the static tabs, so not
    // ULTIMATE_TAB_ID, which this file is the one injecting. Re-registering the
    // whole list (rather than just the new id) is what teaches the buttons
    // bound at boot to also hide the Ultimate tab when they are clicked.
    //
    // Falls back to reading the strip page_router just built rather than to a
    // second copy of the list. Same GitHub Pages cache-skew case as isBase
    // below: a stub cached from before character_tabs.js existed will not have
    // loaded it, and in that case the DOM is the honest answer - whatever the
    // stale router actually rendered is what these buttons have to match.
    const staticTabIds = () => (window.getCharacterTabIds
        ? window.getCharacterTabIds()
        : Array.from(document.querySelectorAll('.character-nav button[id^="nav-"]'))
            .map(b => b.id.slice(4))
            .filter(id => id !== ULTIMATE_TAB_ID));

    // Read before DOMContentLoaded on purpose - see the header note. An
    // undeclared mode is corrected in initCharacterModes once the data lands.
    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    if (requestedMode) window.activeCharacterMode = requestedMode;

    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s === null || s === undefined ? '' : s));

    // js/site_utils.js is cached for an hour by GitHub Pages while this file is
    // new, so the first load after a deploy can pair a fresh copy of this file
    // with an hour-old copy of that one. Local fallbacks for the two trivial
    // predicates, and a hard bail in init below, so that skew costs the toggle
    // rather than the page.
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

    // --- THE ULTIMATE TAB ---
    function injectUltimateTab() {
        if (document.getElementById(`tab-${ULTIMATE_TAB_ID}`)) return false;

        const counterplayBtn = document.getElementById('nav-counterplay');
        const nav = document.querySelector('.character-nav');
        if (!nav) return false;

        const btn = document.createElement('button');
        btn.id = `nav-${ULTIMATE_TAB_ID}`;
        btn.className = 'btn-manga btn-manga-slanted';
        btn.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${esc(ULTIMATE_TAB_LABEL)}</span></div>`;

        // After Counterplay, which leaves Gallery last. Gallery is the media
        // dump and reads as the end of the page; an Ultimate tab past it would
        // be the one tab people never scroll to.
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

    // --- THE MODE TOGGLE ---
    function renderModeBar(modes, activeId) {
        const bar = document.getElementById('character-mode-bar');
        if (!bar) return;

        if (!modes || modes.length < 2) {
            bar.classList.add('hidden');
            bar.innerHTML = '';
            return;
        }

        bar.classList.remove('hidden');
        // data-mode-id plus one delegated listener, never an inline onclick -
        // the id and label are contributor-authored and reach this string.
        bar.innerHTML = modes.map(m => {
            const isActive = m.id === activeId;
            return `<button type="button" role="tab" aria-selected="${isActive ? 'true' : 'false'}"` +
                ` class="character-mode-chip${isActive ? ' active' : ''}"` +
                ` data-mode-id="${esc(m.id)}">${esc(m.label)}</button>`;
        }).join('');
    }

    // null, undefined and 'base' all name the same state - the top-level data.
    // Comparing them raw would make a bare page URL look like a mode change
    // away from `base` and redraw the whole page for nothing.
    const sameMode = (a, b) => (isBase(a) && isBase(b)) || a === b;

    window.switchCharacterMode = async function(modeId) {
        if (sameMode(modeId, window.activeCharacterMode)) return;

        const route = window.PAGE_ROUTE;
        if (!route || !route.pageId) return;

        window.activeCharacterMode = modeId;
        renderModeBar(window.declaredCharacterModes, modeId);

        // Same shape as the character boot in js/page_boot.js: the move
        // sections are fired without awaiting and the descriptions go out
        // alongside them, because loadPageDescriptions waits 300ms before
        // writing move strategies into the cards framedata.js is building.
        // Awaiting here instead would be a different load order than every
        // character page has had, for no gain.
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

        // A shared link should open on the state the sharer was reading. Base
        // drops the parameter rather than writing ?mode=base, so the canonical
        // URL of a character page stays the bare one.
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

        // The Ultimate tab shows for a base-only character even with nothing in
        // it yet - an empty tab is how the team sees there is something to
        // fill. It also shows for any page that already has ultimate moves
        // written, so mislabelled registry metadata can never hide real data.
        const hasUltimateMoves = Array.isArray(frameData[ULTIMATE_TAB_ID]) && frameData[ULTIMATE_TAB_ID].length > 0;
        if ((navEntry && navEntry.isBaseOnly) || hasUltimateMoves) {
            if (injectUltimateTab() && typeof window.loadMoveSection === 'function') {
                window.loadMoveSection(pageId, ULTIMATE_TAB_ID, null, 'character', window.activeCharacterMode);
            }
        }

        if (modes.length < 2) {
            renderModeBar(modes, null);
            // Reachable from a hand-typed or stale ?mode= on a character that
            // has no modes. The boot already rendered against that name, and
            // every resolver went looking for a modeData bucket that does not
            // exist - so the page is sitting there blank and has to be redrawn
            // against the base kit, not merely re-pointed at it.
            await window.switchCharacterMode(null);
            return;
        }

        const isDeclared = modes.some(m => m.id === window.activeCharacterMode);
        const activeId = isDeclared ? window.activeCharacterMode : modes[0].id;

        renderModeBar(modes, activeId);
        wireModeBar();

        // Same blank-page correction as above, for a ?mode= that names a mode
        // this particular character does not have. sameMode makes the ordinary
        // case - no ?mode= at all, landing on base - a no-op.
        await window.switchCharacterMode(activeId);
    };
})();
