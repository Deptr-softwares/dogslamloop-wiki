/**
 * What a generated page runs once its skeleton is in: the sidebars, the tabs, the
 * content fetches, alerts and the discussion, per page kind (character, gallery or
 * tool, system).
 * @since v0.9
 * @touches setupTabs, loadMoveSection, initCharacterModes, loadPageDescriptions,
 *   loadPageAlerts, initPageDiscussions, renderGalleryPage, renderToolPage
 * @watch it stays the last script on a stub, so site_meta.js's DOMContentLoaded
 *   handler (the character theme) runs first. The character and system branches
 *   differ on purpose: a character page fires its fetches together and maps the
 *   contents after 500ms; a system page awaits them in order and waits 150ms.
 * @see docs/page-shell.md
 */

// A tool page lists its headings like a system page. With none (most tools), "On
// this page" is hidden, and its header row too when no edit button shares it.
function showToolContents() {
    if (typeof window.refreshTOC !== 'function') return;
    window.refreshTOC();

    const toc = document.getElementById('dynamic-toc');
    if (!toc || toc.querySelector('a')) return;

    toc.classList.add('hidden');
    const header = document.querySelector('.local-sidebar-right .sidebar-tab-header');
    if (!header) return;
    const title = header.querySelector('.sidebar-master-title');
    if (title) title.classList.add('hidden');
    const edit = document.getElementById('btn-edit-current-tab');
    if (!(edit && edit.classList.contains('is-active'))) header.classList.add('hidden');
}

/**
 * A character page's content: the tab strip, moves, modes and descriptions.
 * history.html draws a past version with these same steps (history.js). The live
 * page does not wait; the promise is for a caller that needs to.
 * @since v1.2
 */
window.bootCharacterContent = function (route) {
    const { pageId } = route;
    const pending = [];

    if (window.setupTabs) {
        // From the tab list page_router.js built the buttons from, so none is left
        // unbound. includeOptional: a Techs button shown a moment later must already
        // work, and binding a hidden button costs nothing.
        const tabIds = route.tabs
            ? route.tabs.map(t => t.id)
            : window.getCharacterTabIds({ includeOptional: true });
        window.setupTabs('nav', 'tab', tabIds, 'major', { address: true });
    }

    // The fetches go out together, not awaited.
    if (typeof window.loadMoveSection === 'function') {
        pending.push(window.loadMoveSection(pageId, 'skills'));
        pending.push(window.loadMoveSection(pageId, 'm1s'));
        pending.push(window.loadMoveSection(pageId, 'specials'));
    }

    // Beside them, not before: modes and the Ultimate tab are additions, and most
    // characters have neither.
    if (typeof window.initCharacterModes === 'function') {
        pending.push(window.initCharacterModes(pageId));
    }

    if (typeof window.loadPageDescriptions === 'function') {
        pending.push(window.loadPageDescriptions(pageId, 'character'));
    }

    return Promise.all(pending);
};

/**
 * The boot sequence for a route. A function, not only a DOMContentLoaded handler,
 * because page_rescue.js boots a 404 long after that event, once Supabase has said
 * what lives at the address.
 */
window.runPageBoot = async function (route) {
    if (!route) return;

    const { pageId, pageType } = route;

    if (pageType === 'character') {
        if (window.initSidebarToggle) window.initSidebarToggle();
        if (window.initMobileNav) window.initMobileNav();
        if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
        if (window.initAuthDock) window.initAuthDock();
        if (window.initTabEditorButtons) window.initTabEditorButtons(pageId, 'character');

        window.bootCharacterContent(route);

        if (typeof window.loadPageAlerts === 'function') {
            window.loadPageAlerts(pageId);
        }

        // Not awaited: the thread sits below the tabs, and a slow discussion query must
        // never delay the frame data.
        if (typeof window.initPageDiscussions === 'function') {
            window.initPageDiscussions(pageId);
        }

        // The contents are mapped once every Block is in.
        setTimeout(() => {
            if (window.refreshTOC) window.refreshTOC();
        }, 500);

        return;
    }

    // Gallery and tool pages: the system shell, filled by their own renderer rather
    // than description.js's tab engine.
    if (pageType === 'gallery' || pageType === 'tool') {
        if (window.initMobileNav) window.initMobileNav();

        const render = pageType === 'gallery' ? window.renderGalleryPage : window.renderToolPage;
        if (typeof render === 'function') await render(pageId);

        if (typeof window.loadPageAlerts === 'function') await window.loadPageAlerts(pageId);
        if (typeof window.initTabEditorButtons === 'function') {
            // Awaited on a tool page only: showToolContents reads whether the
            // edit button is showing.
            if (pageType === 'tool') await window.initTabEditorButtons(pageId, pageType);
            else window.initTabEditorButtons(pageId, pageType);
        }
        if (pageType === 'tool') showToolContents();

        if (typeof window.buildGlobalSidebarMenu === 'function') await window.buildGlobalSidebarMenu('global-sidebar-nav');
        if (typeof window.initAuthDock === 'function') await window.initAuthDock();
        if (typeof window.initSidebarToggle === 'function') window.initSidebarToggle();
        return;
    }

    // System pages: in order, awaited.
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

// Skipped without PAGE_ROUTE, as in page_router.js: page_rescue.js calls
// runPageBoot itself.
document.addEventListener('DOMContentLoaded', () => {
    if (window.PAGE_ROUTE) window.runPageBoot(window.PAGE_ROUTE);
});
