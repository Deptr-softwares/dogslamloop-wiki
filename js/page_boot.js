/**
 * Dogslamloop Wiki - Page Router (boot sequence)
 *
 * The second half of the router, holding what used to be the inline
 * <script> block at the bottom of every character/system page. Must stay the
 * LAST script on a stub: the old pages registered this handler after
 * js/site_meta.js registered its own, so applyCharacterTheme runs first, and
 * loading order is what preserves that for free.
 *
 * The two branches below are deliberately NOT merged. The character and
 * system pages had genuinely different boot sequences - the system one awaits
 * its fetches in order and uses a 150ms TOC delay, the character one fires
 * them concurrently and uses 500ms. Those differences are behavioural, and
 * flattening them into one "tidier" sequence would be an unreviewed change to
 * how every page loads.
 */

/**
 * The boot sequence, as a function.
 *
 * Callable rather than only DOMContentLoaded-driven because js/page_rescue.js
 * boots a page long after that event has fired: on a 404 the route is not
 * known until Supabase has been asked what lives at the requested URL.
 */
window.runPageBoot = async function (route) {
    if (!route) return;

    const { pageId, pageType } = route;

    if (pageType === 'character') {
        // 1. Boot the master global sidebars
        if (window.initSidebarToggle) window.initSidebarToggle();
        if (window.initMobileNav) window.initMobileNav();
        if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
        if (window.initAuthDock) window.initAuthDock();
        if (window.initTabEditorButtons) window.initTabEditorButtons(pageId, 'character');

        // 2. Inner tab navigation
        if (window.setupTabs) {
            const tabIds = (route.tabs || [
                { id: 'overview' }, { id: 'm1s' }, { id: 'skills' }, { id: 'specials' },
                { id: 'matchups' }, { id: 'counterplay' }, { id: 'gallery' },
            ]).map(t => t.id);
            window.setupTabs('nav', 'tab', tabIds, 'major');
        }

        // 3. Fire the data fetchers concurrently - no blocking await, matching
        //    the original character-page behaviour.
        if (typeof window.loadMoveSection === 'function') {
            window.loadMoveSection(pageId, 'skills');
            window.loadMoveSection(pageId, 'm1s');
            window.loadMoveSection(pageId, 'specials');
        }

        // Alongside them, not before: it decides whether this character has a
        // mode toggle or an Ultimate tab, and both are additions to a page
        // that renders perfectly well without them. Blocking the moveset on
        // that question would make every character page wait for an answer
        // that is "no" for all 22 of them today.
        if (typeof window.initCharacterModes === 'function') {
            window.initCharacterModes(pageId);
        }

        if (typeof window.loadPageDescriptions === 'function') {
            window.loadPageDescriptions(pageId, 'character');
        }

        if (typeof window.loadPageAlerts === 'function') {
            window.loadPageAlerts(pageId);
        }

        // Fired alongside the rest rather than awaited, for the same reason
        // the mode toggle is: the thread sits below the tabs and nothing above
        // it depends on the answer. A slow discussion query must never be what
        // delays the frame data somebody came here to read.
        if (typeof window.initPageDiscussions === 'function') {
            window.initPageDiscussions(pageId);
        }

        // 4. Delay the TOC mapping so every content block has been injected.
        setTimeout(() => {
            if (window.refreshTOC) window.refreshTOC();
        }, 500);

        return;
    }

    // --- GALLERY AND TOOL PAGES ---
    // Same shell as a system page, filled by their own renderer instead of
    // description.js's tab engine. Handled before the system branch rather
    // than inside it: both fetch the same page_data row but do entirely
    // different things with desc_data, and folding that into
    // loadPageDescriptions would mean a third mode in a function that already
    // has two.
    if (pageType === 'gallery' || pageType === 'tool') {
        if (window.initMobileNav) window.initMobileNav();

        const render = pageType === 'gallery' ? window.renderGalleryPage : window.renderToolPage;
        if (typeof render === 'function') await render(pageId);

        if (typeof window.loadPageAlerts === 'function') await window.loadPageAlerts(pageId);
        if (typeof window.initTabEditorButtons === 'function') window.initTabEditorButtons(pageId, pageType);

        if (typeof window.buildGlobalSidebarMenu === 'function') await window.buildGlobalSidebarMenu('global-sidebar-nav');
        if (typeof window.initAuthDock === 'function') await window.initAuthDock();
        if (typeof window.initSidebarToggle === 'function') window.initSidebarToggle();
        return;
    }

    // --- SYSTEM PAGES ---
    // Sequential and awaited, matching the original system-page behaviour.
    if (window.initMobileNav) window.initMobileNav();

    if (typeof window.loadPageDescriptions === 'function') {
        await window.loadPageDescriptions(pageId, 'system');
    }

    if (typeof window.loadPageAlerts === 'function') {
        await window.loadPageAlerts(pageId);
    }

    if (typeof window.refreshTOC === 'function') {
        setTimeout(window.refreshTOC, 150);
    }

    if (typeof window.initTabEditorButtons === 'function') {
        window.initTabEditorButtons(pageId, 'system');
    }

    if (typeof window.buildGlobalSidebarMenu === 'function') await window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (typeof window.initAuthDock === 'function') await window.initAuthDock();
    if (typeof window.initSidebarToggle === 'function') window.initSidebarToggle();
};

// Guarded on PAGE_ROUTE for the same reason js/page_router.js is: a page that
// resolves its own route later loads this file without one, and calls
// runPageBoot itself when it knows.
document.addEventListener('DOMContentLoaded', () => {
    if (window.PAGE_ROUTE) window.runPageBoot(window.PAGE_ROUTE);
});
