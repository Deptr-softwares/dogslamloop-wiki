/**
 * The skeleton every generated page stub gets: the mobile bar, both sidebars, and
 * a character page's header, tab strip and panels, or a system page's header. A
 * stub sets window.PAGE_ROUTE in <head> and loads this as the first element in
 * <body>; page_boot.js, the last script, decides what runs.
 * @since v0.9
 * @touches window.PAGE_ROUTE, getCharacterTabs (character_tabs.js, which loads
 *   just before this file)
 * @watch it runs before site_utils.js and site_meta.js, so it keeps its own
 *   escaper and writes the icon markup itself. Hand-authored pages never set
 *   PAGE_ROUTE (tests/page-skeleton-parity.spec.js).
 * @see docs/page-shell.md
 */

window.buildPageSkeleton = function (route, rootPath) {
    if (!route || !route.pageId || !route.pageType) {
        console.error('[Router] window.PAGE_ROUTE missing or incomplete; page cannot render.');
        return null;
    }

    // Stubs sit two levels deep, written as a literal because getRootPath() has not
    // loaded yet. 404.html passes '/': it is served at any depth, with <base href="/">.
    const ROOT = rootPath || '../../';

    // includeOptional: this is markup, and the page row that says whether the
    // character has Techs is not fetched yet. The buttons ship for every character,
    // hidden (optionalHidden), and applyOptionalTabVisibility shows them once the
    // answer lands. route.tabs is an unused way for the generator to pass a page's
    // own list.
    const DEFAULT_CHARACTER_TABS = (window.getCharacterTabs
        ? window.getCharacterTabs({ includeOptional: true })
        : []
    ).map(t => ({
        id: t.id,
        label: t.label,
        classes: t.isDefault ? t.panelClass : `${t.panelClass} hidden`,
        optionalHidden: !!t.optional,
    }));

    if (!DEFAULT_CHARACTER_TABS.length && !route.tabs) {
        console.error('[Router] js/utility/character_tabs.js did not load before this script; the tab strip will be empty.');
    }

    const tabs = route.tabs || DEFAULT_CHARACTER_TABS;

    // Its own escaper, because site_utils.js has not loaded yet.
    function esc(str) {
        return String(str === null || str === undefined ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // The site's icons as window.uiIconHTML (site_meta.js) writes them, written out
    // here because that file loads later. An id is a file in medias/icons/.
    const uiIcon = (id) => `<span class="px-icon" aria-hidden="true" style="--px-icon: url('/medias/icons/${id}.png')"></span>`;
    const EDIT_ICON = uiIcon('edit');
    const KOFI_ICON = uiIcon('kofi');

    function mobileNav() {
        return `
    <div class="mobile-top-bar">
        <!-- A button, not a link home. On a phone the sidebar it opens carries
             its own "dogslamloop wiki" link to the Main Dashboard, so the bar
             linking there too was the site's second route to the same place -
             and it was spending the one control a reader could reach the
             navigation with. Owner's call, 2026-08-14.

             Left control opens the LEFT drawer, right control opens the RIGHT
             one, which is the only mapping a thumb can guess. -->
        <button type="button" class="mobile-logo-link" id="mobile-nav-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="master-sidebar">
            <img src="${ROOT}medias/images/DogslamloopIcon.webp" class="mobile-logo-img" alt="">
            <span class="mobile-site-title">dogslamloop wiki</span>
        </button>
        <button class="mobile-menu-btn" id="mobile-menu-toggle" aria-label="Open table of contents" aria-expanded="false">☰</button>
    </div>
    <div class="mobile-backdrop" id="mobile-backdrop"></div>`;
    }

    function leftSidebar() {
        return `
        <aside class="global-sidebar-left" id="master-sidebar" aria-label="Site navigation">
            <div class="sidebar-header-top">
                <img src="${ROOT}medias/images/DogslamloopIcon.webp" alt="Site Logo" class="sidebar-site-logo">
                <div class="sidebar-title-container">
                    <a href="${ROOT}index.html" class="site-title">dogslamloop wiki</a>
                    <p class="site-subtitle">Alpha v0.4</p>
                </div>
            </div>

            <button class="sidebar-toggle-btn" id="btn-sidebar-collapse" title="Collapse Sidebar" aria-label="Collapse sidebar">☰</button>

            <div class="sidebar-master-title">Navigation</div>

            <div id="global-sidebar-nav">
                <p class="loading-msg loading-msg-sm loading-msg-busy">Loading menu...</p>
            </div>

            <div id="sidebar-dynamic-dock" class="sidebar-dynamic-dock"></div>

            <div class="kofi-btn-wrapper kofi-btn-wrapper-spaced">
                <a href="https://Ko-fi.com/deptr_software_coffee_corner" target="_blank" class="btn-sys btn-sys-yellow kofi-btn-full">
                    ${KOFI_ICON}
                    <span class="kofi-text">SUPPORT KO-FI</span>
                </a>
            </div>
        </aside>`;
    }

    // The right sidebar is the table of contents and also the only home of the Edit
    // and History buttons, so a page with no contents list still gets it.
    function rightSidebar(label, withToc = true) {
        return `
        <aside class="local-sidebar-right" aria-label="${withToc ? 'On this page' : 'Page tools'}">
            <div class="sidebar-tab-header">
                <div class="sidebar-master-title">${esc(label)}</div>

                <button id="btn-edit-current-tab" class="btn-sys btn-sys-regular tab-editor-btn-sidebar">
                    ${EDIT_ICON}
                    EDIT ${label === 'On this tab' ? 'TAB' : 'PAGE'}
                </button>
            </div>
${withToc ? `
            <ul class="toc-list" id="dynamic-toc">
                <li><p class="loading-msg loading-msg-busy">Loading contents...</p></li>
            </ul>` : ''}
        </aside>`;
    }

    function characterMain() {
        const navButtons = tabs.map((t, i) => `
                    <button id="nav-${esc(t.id)}" class="btn-manga btn-manga-slanted${i === 0 ? ' active' : ''}${t.optionalHidden ? ' hidden' : ''}"><div class="btn-manga-content"><span class="btn-manga-text">${esc(t.label)}</span></div></button>`).join('');

        const tabDivs = tabs.map(t =>
            `            <div id="tab-${esc(t.id)}" class="${esc(t.classes)}"></div>`).join('\n');

        return `
        <main class="main-content-area space-y-6">

            <div class="back-home-wrapper">
                <a href="${ROOT}index.html" class="btn-ghost">← Back to Home</a>
            </div>

            <header class="character-header">
                <div id="character-alerts-container" class="character-alerts-container"></div>

                <h1 class="character-title">${esc(route.title || route.pageId)}</h1>

                <!-- The state chips and the jump-to-discussion button share a
                     row, but the button is a SIBLING of the bar rather than a
                     child of it. #character-mode-bar hides itself entirely for
                     a character with fewer than two states, which is 20 of the
                     22 - putting the button inside it would mean the button
                     only existed on the two characters that happen to have an
                     ultimate. -->
                <div class="character-toolbar">
                    <div id="character-mode-bar" class="character-mode-bar hidden" role="tablist" aria-label="Character mode"></div>

                    <button type="button" id="btn-jump-discussion" class="btn-sys btn-sys-regular btn-jump-discussion">
                        ${uiIcon('discussion')}
                        <span class="sr-only">Jump to the discussion</span>
                        <span id="jump-discussion-count" class="jump-discussion-count"></span>
                    </button>
                </div>

                <nav class="character-nav">${navButtons}</nav>
            </header>

${tabDivs}

            <!-- The discussion thread, below the tabs rather than as one more
                 tab. A tab is a section of the article; this is the readers
                 talking about it, and burying a conversation behind a button
                 nobody clicks is how a discussion feature dies quietly.
                 Filled by js/pages/community/discussions.js, which renders nothing at all if
                 the table is unreachable. -->
            <section id="discussion-section" class="discussion-section" aria-label="Discussion"></section>

        </main>`;
    }

    function systemMain() {
        // No tab divs here on purpose - description.js builds them from
        // desc_data.tabs[] and inserts its own nav after .home-main-header.
        return `
        <main class="main-content-area space-y-6">

            <div class="system-back-row">
                <a href="${ROOT}systems/index.html" class="btn-ghost">← Back to Systems Hub</a>
            </div>

            <header class="home-main-header">
                <h1 class="home-main-title" id="system-main-title">${esc(route.title || 'Loading...')}</h1>
            </header>

            <div id="character-alerts-container" class="character-alerts-container"></div>

        </main>`;
    }

    const isCharacter = route.pageType === 'character';

    // Gallery and tool pages use the system shell, and their own script fills the
    // body. A gallery has no headings to index, so its right sidebar has no contents
    // list, but it keeps the Edit button.
    const hasToc = route.pageType !== 'gallery';

    const skeleton = `${mobileNav()}

    <div class="site-layout">
${leftSidebar()}
${isCharacter ? characterMain() : systemMain()}
${rightSidebar(isCharacter ? 'On this tab' : (hasToc ? 'On this page' : 'This page'), hasToc)}
    </div>`;

    return skeleton;
};

// The stub's path: written before this <script> with insertAdjacentHTML, which
// leaves the parser's insertion point alone (innerHTML here would wipe the rest of
// the page). Skipped without PAGE_ROUTE: page_rescue.js decides its route later
// and calls buildPageSkeleton itself.
(function () {
    if (!window.PAGE_ROUTE) return;

    const skeleton = window.buildPageSkeleton(window.PAGE_ROUTE);
    if (skeleton) document.currentScript.insertAdjacentHTML('beforebegin', skeleton);
})();
