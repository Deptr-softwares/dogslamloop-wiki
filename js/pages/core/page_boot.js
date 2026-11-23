/**
 * What a generated page runs once its skeleton is in: the sidebars, the tabs, the
 * content fetches, alerts and the discussion, per page kind (character, gallery or
 * tool, system).
 * @since v0.9
 * @touches setupTabs, loadMoveSection, initCharacterModes, loadPageDescriptions,
 *   loadPageAlerts, initPageDiscussions (loaded by loadSiteFile as the thread
 *   nears), renderGalleryPage, renderToolPage
 * @watch it stays the last script on a stub, so site_lookups.js's DOMContentLoaded
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
 * The post count on a character page's jump-to-discussion button, the reason to
 * press it, shown before the thread has loaded. Nothing for an empty thread, since
 * a zero reads as a dead feature.
 * @since v0.14, in discussions.js
 * @touches page_discussions (a count of its visible posts), #jump-discussion-count
 */
window.showDiscussionCount = async function (pageId) {
    const label = document.getElementById('jump-discussion-count');
    if (!label || !window.supabaseClient || !pageId) return;

    let count = null;
    try {
        const res = await window.supabaseClient
            .from('page_discussions')
            .select('id', { count: 'exact', head: true })
            .eq('page_id', pageId)
            .eq('status', 'visible');
        if (!res.error) count = res.count;
    } catch (e) {
        // A hint on a button: without it the button still works.
        count = null;
    }

    label.textContent = typeof count === 'number' && count > 0 ? String(count) : '';
};

const DISCUSSION_FILES = ['js/utility/emoji.js', 'js/pages/community/discussions.js'];
const POST_LINK = /^#post-[A-Za-z0-9-]{1,64}$/;

// The thread's scripts load when the reader is about a screen from it, or at once
// for a link to a post. The count and the jump button work from the start.
function bootDiscussion(pageId) {
    const section = document.getElementById('discussion-section');
    if (!section) return;

    let started = false;
    const onHash = () => { if (POST_LINK.test(window.location.hash)) start(); };
    function start() {
        if (started) return;
        started = true;
        window.removeEventListener('hashchange', onHash);
        DISCUSSION_FILES.reduce((loaded, file) => loaded.then(() => window.loadSiteFile(file)), Promise.resolve())
            .then(() => window.initPageDiscussions(pageId))
            .catch(error => {
                console.error('[Discussion] Could not load the thread:', error);
                const title = document.createElement('h2');
                title.className = 'section-title discussion-title';
                title.textContent = 'Discussion';
                const message = document.createElement('p');
                message.className = 'discussion-error';
                message.textContent = 'Could not load the discussion. Try refreshing.';
                section.replaceChildren(title, message);
            });
    }

    const jump = document.getElementById('btn-jump-discussion');
    if (jump) {
        // Going to the thread brings it near, which starts it.
        jump.addEventListener('click', () => {
            section.scrollIntoView({ behavior: window.scrollMotion(), block: 'start' });
        });
    }
    window.showDiscussionCount(pageId);

    if (POST_LINK.test(window.location.hash) || !('IntersectionObserver' in window)) {
        start();
        return;
    }
    window.addEventListener('hashchange', onHash);
    const near = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        near.disconnect();
        start();
    }, { rootMargin: '100% 0px' });
    near.observe(section);
}

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
        bootDiscussion(pageId);

        // The contents are mapped once every Block is in.
        setTimeout(() => {
            if (window.refreshTOC) window.refreshTOC();
        }, 500);

        return;
    }

    // Gallery and tool pages: the system shell, filled by their own renderer rather
    // than page_render.js's tab engine.
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
