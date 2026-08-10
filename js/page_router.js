/**
 * Dogslamloop Wiki - Page Router (skeleton builder)
 *
 * Every character and system page used to be a hand-authored ~160-line HTML
 * file whose only real variance was the page id and display title. This file
 * holds that markup once. A page stub sets window.PAGE_ROUTE in <head>, loads
 * this script as the first element in <body>, and gets the full skeleton.
 *
 * Deliberately NOT covered by this router (they stay hand-authored, and
 * tests/page-skeleton-parity.spec.js asserts they never define PAGE_ROUTE):
 *   characters/Template  - documentation page in a character page's clothes
 *   systems/collaborators - own fetch engine, own containers
 *   systems/tierlist      - own pageType, loads tierlist.js
 *   systems/updatelog     - driven by home_widgets.js
 *   systems/color-codes   - hand-authored swatch markup
 *
 * Pairs with js/page_boot.js, which runs the per-type boot sequence as the
 * LAST script on the page. The split matters: this file decides what the DOM
 * looks like, that one decides what runs, and keeping boot last preserves the
 * DOMContentLoaded handler ordering the old inline scripts had (site_meta.js
 * registers first, so applyCharacterTheme still runs before the boot).
 */

(function () {
    const route = window.PAGE_ROUTE;
    if (!route || !route.pageId || !route.pageType) {
        console.error('[Router] window.PAGE_ROUTE missing or incomplete; page cannot render.');
        return;
    }

    // Stubs live two levels deep (characters/<Name>/, systems/<slug>/). Kept
    // as a literal rather than derived, because getRootPath() (site_utils.js)
    // has not loaded yet at this point - this script runs before it by design.
    const ROOT = '../../';

    // The 7 character tabs, hardcoded here instead of copy-pasted into 22
    // files. `gallery` currently has no handler anywhere and renders empty -
    // it is kept deliberately: the owner intends to build it, and the router
    // is now the single place that will need to change when they do.
    //
    // The PAGE_ROUTE.tabs escape hatch is intentionally unused today. It lets
    // the generator start emitting per-page tab lists later without reworking
    // this module. Unifying character tabs with desc_data.tabs[] the way
    // system pages already work is a much larger data-model change (see
    // description.js:640-828, which is shape-driven rather than tab-driven)
    // and is explicitly out of scope for v0.9.
    const DEFAULT_CHARACTER_TABS = [
        { id: 'overview', label: 'Overview & Strategy', classes: 'tab-content' },
        { id: 'm1s', label: 'M1s', classes: 'tab-content hidden' },
        { id: 'skills', label: 'Skills', classes: 'vessel-content space-y-8 hidden' },
        { id: 'specials', label: 'Specials', classes: 'tab-content hidden' },
        { id: 'matchups', label: 'Matchups', classes: 'vessel-content hidden' },
        { id: 'counterplay', label: 'Counterplay', classes: 'vessel-content hidden' },
        { id: 'gallery', label: 'Gallery', classes: 'vessel-content hidden' },
    ];

    const tabs = route.tabs || DEFAULT_CHARACTER_TABS;

    // Content is owner/contributor-authored and arrives via the generator, but
    // escaping here costs nothing and keeps the "escape at every innerHTML
    // interpolation" standard this codebase holds everywhere else intact.
    function esc(str) {
        return String(str === null || str === undefined ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const EDIT_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    const EDIT_ICON_LG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    const KOFI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>';

    function mobileNav() {
        return `
    <div class="mobile-top-bar">
        <a href="${ROOT}index.html" class="mobile-logo-link">
            <img src="${ROOT}medias/images/DogslamloopIcon.webp" class="mobile-logo-img" alt="Logo">
            <span class="mobile-site-title">dogslamloop wiki</span>
        </a>
        <button class="mobile-menu-btn" id="mobile-menu-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="master-sidebar">☰</button>
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
                <p class="loading-msg loading-msg-sm">Loading menu...</p>
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

    function rightSidebar(label) {
        return `
        <aside class="local-sidebar-right" aria-label="On this page">
            <div class="sidebar-tab-header">
                <div class="sidebar-master-title">${esc(label)}</div>

                <button id="btn-edit-current-tab" class="btn-sys btn-sys-regular tab-editor-btn-sidebar">
                    ${EDIT_ICON}
                    EDIT ${label === 'On this tab' ? 'TAB' : 'PAGE'}
                </button>
            </div>

            <ul class="toc-list" id="dynamic-toc">
                <li><p class="loading-msg">Loading contents...</p></li>
            </ul>
        </aside>`;
    }

    function characterMain() {
        const navButtons = tabs.map((t, i) => `
                    <button id="nav-${esc(t.id)}" class="btn-manga btn-manga-slanted${i === 0 ? ' active' : ''}"><div class="btn-manga-content"><span class="btn-manga-text">${esc(t.label)}</span></div></button>`).join('');

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

                <div id="character-mode-bar" class="character-mode-bar hidden" role="tablist" aria-label="Character mode"></div>

                <nav class="character-nav">${navButtons}

                    <button id="btn-edit-current-tab-mobile" class="btn-sys btn-sys-regular tab-editor-btn-mobile">
                        ${EDIT_ICON_LG}
                        EDIT TAB
                    </button>
                </nav>
            </header>

${tabDivs}

        </main>`;
    }

    function systemMain() {
        // No tab divs here on purpose - description.js builds them from
        // desc_data.tabs[] and inserts its own nav after .home-main-header.
        return `
        <main class="main-content-area space-y-6">

            <div class="system-back-row">
                <a href="${ROOT}systems/index.html" class="btn-ghost">← Back to Systems Hub</a>

                <button id="btn-edit-current-tab-mobile" class="btn-sys btn-sys-regular tab-editor-btn-mobile">
                    ${EDIT_ICON}
                    EDIT PAGE
                </button>
            </div>

            <header class="home-main-header">
                <h1 class="home-main-title" id="system-main-title">${esc(route.title || 'Loading...')}</h1>
            </header>

            <div id="character-alerts-container" class="character-alerts-container"></div>

        </main>`;
    }

    const isCharacter = route.pageType === 'character';

    // Gallery and tool pages reuse the system shell: a back link, a title and
    // the alerts container, with the body filled at runtime. What differs is
    // which script fills it (js/gallery.js, js/tool_page.js), not the frame
    // around it - so there is nothing here for them to override.
    //
    // The right sidebar is a table of contents over headings, which a gallery
    // does not have: its own search box is how you find something in it.
    const hasToc = route.pageType !== 'gallery';

    const skeleton = `${mobileNav()}

    <div class="site-layout">
${leftSidebar()}
${isCharacter ? characterMain() : systemMain()}
${hasToc ? rightSidebar(isCharacter ? 'On this tab' : 'On this page') : ''}
    </div>`;

    // insertAdjacentHTML('beforebegin') on the currently-executing script is
    // the safe mid-parse insertion: it writes before this <script> element
    // without disturbing the parser's insertion point. Assigning to
    // document.body.innerHTML here would destroy the not-yet-parsed rest of
    // the document, including the script tags below this one.
    document.currentScript.insertAdjacentHTML('beforebegin', skeleton);
})();
