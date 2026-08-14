/**
 * Dogslamloop Wiki - Page Builder & Navigation Module
 * V0.4 DSL Standardized Engine
 */

// ==========================================
// 1. SIDEBAR & NAVIGATION BUILDERS
// ==========================================

/**
 * Skip-to-content link, injected on every page.
 *
 * Done here rather than in each page's markup because every page loads this
 * file, and there are 30 generated stubs plus a dozen hand-authored pages -
 * a link that exists on 41 of 42 pages is worse than useless, because a
 * keyboard user learns to expect it.
 *
 * Without it, reaching the first paragraph of a character page means tabbing
 * through the whole sidebar menu - roughly 40 links - on every single page.
 */
window.initSkipLink = function() {
    if (document.querySelector('.skip-link')) return;

    const main = document.querySelector('main.main-content-area') || document.querySelector('main');
    if (!main) return;

    if (!main.id) main.id = 'main-content';

    const link = document.createElement('a');
    link.className = 'skip-link';
    link.href = `#${main.id}`;
    link.textContent = 'Skip to content';

    // A plain in-page href moves the reading position but not always keyboard
    // focus, so the next Tab can resume from the top of the page again.
    link.addEventListener('click', (event) => {
        event.preventDefault();
        main.setAttribute('tabindex', '-1');
        main.focus();
        main.scrollIntoView();
    });

    document.body.insertBefore(link, document.body.firstChild);
};

window.initSidebarToggle = function() {
    const toggleBtn = document.querySelector('.sidebar-toggle-btn');
    const sidebar = document.getElementById('master-sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            // The True Despawn Toggle
            const collapsed = sidebar.classList.toggle('collapsed');
            // The button's label is "Collapse sidebar" in the markup; once it
            // has collapsed the sidebar it does the opposite, and a screen
            // reader would otherwise keep announcing the wrong action.
            toggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
            toggleBtn.setAttribute('aria-expanded', String(!collapsed));
        });
        toggleBtn.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
    }
};

window.initMobileNav = function() {
    const mobileMenuBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('master-sidebar');
    const backdrop = document.getElementById('mobile-backdrop');

    if (mobileMenuBtn && sidebar && backdrop) {
        const setOpen = (open) => {
            sidebar.classList.toggle('mobile-open', open);
            backdrop.classList.toggle('active', open);
            mobileMenuBtn.setAttribute('aria-expanded', String(open));
            mobileMenuBtn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
        };

        mobileMenuBtn.addEventListener('click', () => setOpen(true));
        backdrop.addEventListener('click', () => setOpen(false));

        // Escape closes it. Without this the only way out is a tap on the
        // backdrop, which a keyboard user has no way to reach.
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
                setOpen(false);
                mobileMenuBtn.focus();
            }
        });
    }
};

window.buildGlobalSidebarMenu = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const legacyNavHeaders = document.querySelectorAll('.sidebar-nav-title');
    legacyNavHeaders.forEach(el => {
        if (el.textContent.trim().toUpperCase() === 'NAVIGATION') {
            el.className = 'sidebar-master-title';
            el.style.textTransform = 'uppercase';
        }
    });

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        if (!navData) throw new Error("Navigation configuration missing.");

        // navigation.json is owner-editable via site_pages as of v0.10, and
        // this menu renders on every page on the site - the widest reach of
        // the three consumers of that file. Escaped at every interpolation.
        //
        // The header's onclick stays: it interpolates nothing, so it is static
        // markup rather than the user-influenced-handler pattern CLAUDE.md
        // rules out.
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

        let html = '';
        for (const [category, items] of Object.entries(navData)) {
            // A <button> rather than a <div>: it is operated by click, so it
            // has to be reachable by keyboard and announced as a control.
            // aria-expanded carries the open/closed state, which the caret
            // conveys visually and conveyed to nobody else.
            html += `<div class="sidebar-group-wrapper">`;
            html += `<button type="button" class="sidebar-nav-title sidebar-group-header" aria-expanded="false">
                        ${esc(category)} <span class="sidebar-group-caret" aria-hidden="true">▼</span>
                     </button>`;
            html += `<ul class="toc-list hidden">`;

            items.forEach(item => {
                let badge = '';
                if (item.isWip) badge = ` <span class="update-badge badge-wip update-badge-inline">WIP</span>`;
                if (item.isEA) badge = ` <span class="update-badge badge-ea update-badge-inline">EA</span>`;

                let colorStyle = '';
                if (category === 'Characters' && window.CHARACTER_COLORS && window.CHARACTER_COLORS[item.name]) {
                    colorStyle = `color: ${window.CHARACTER_COLORS[item.name]}; font-weight: bold;`;
                }

                html += `
                    <li>
                        <a href="${esc(rootPath + item.url)}" class="btn-nav">
                            <span class="toc-link-text" style="${colorStyle}">${esc(item.name)}</span>
                            ${badge}
                        </a>
                    </li>
                `;
            });
            html += `</ul></div>`;
        }
        container.innerHTML = html;

        // Delegated, replacing the inline onclick these headers used to carry.
        container.querySelectorAll('.sidebar-group-header').forEach(header => {
            header.addEventListener('click', () => {
                const list = header.nextElementSibling;
                if (!list) return;
                const open = list.classList.toggle('hidden') === false;
                header.setAttribute('aria-expanded', String(open));
            });
        });
    } catch (e) {
        console.error("Sidebar Menu Error:", e);
        container.innerHTML = `<p class="loading-msg loading-msg-error">Menu unavailable.</p>`;
    }
};

// Universal Tab Editor Buttons (Handles Desktop Sidebar & Mobile Nav)
window.initTabEditorButtons = async function(pageId, pageType = 'character') {
    const sidebarBtn = document.getElementById('btn-edit-current-tab');
    const mobileBtn = document.getElementById('btn-edit-current-tab-mobile');

    if (!pageId) return;

    // Pages with cms_config.editRole === 'locked' have no editing pathway at
    // all (e.g. the changelog/collaborators pages aren't wired to the CMS) -
    // don't show a button that leads nowhere. 'open'/'elevated' pages still
    // show it; elevated ones are blocked at submit time instead (see
    // js/editor-core.js's page_permissions check, in its submit-pipeline
    // DOMContentLoaded handler), matching how staff-only pages
    // work in most CMSes - browsable, gated on save.
    try {
        const navData = typeof window.fetchNavigationData === 'function' ? await window.fetchNavigationData() : null;
        if (navData) {
            const entry = Object.values(navData).flat().find(e => e.cms_config && e.cms_config.pageId === pageId);
            if (entry && entry.cms_config.editRole === 'locked') return;
        }
    } catch (e) {
        console.error('Failed to check page editability:', e);
    }

    const handleEditClick = () => {
        const activeTabEl = document.querySelector('nav.character-nav .btn-manga.active');
        let activeTabId = 'overview'; 
        if (activeTabEl) {
            activeTabId = activeTabEl.id.replace('nav-', ''); 
        }
        window.location.href = `../../edit.html?page=${pageId}&type=${pageType}&tab=${activeTabId}`;
    };

    const handleHistoryClick = () => {
        window.location.href = `../../history.html?page=${pageId}`;
    };

    // 1. Hook up the Desktop Right Sidebar Buttons (Stacked Layout)
    if (sidebarBtn) {
        sidebarBtn.classList.add('is-active');
        sidebarBtn.onclick = handleEditClick;

        const parentDiv = sidebarBtn.parentNode;

        // Restructure the parent container so the title sits on top of the buttons
        parentDiv.classList.add('sidebar-tab-header-stacked');

        let btnGroup = document.getElementById('sidebar-btn-group');
        if (!btnGroup) {
            btnGroup = document.createElement('div');
            btnGroup.id = 'sidebar-btn-group';

            // Move the Edit button into the new wrapper
            parentDiv.insertBefore(btnGroup, sidebarBtn);
            btnGroup.appendChild(sidebarBtn);

            // Create the History button. Shares .tab-editor-btn-sidebar
            // with the Edit button directly (style/Layout.css) instead of
            // cloning sidebarBtn.style.cssText at creation time - that
            // clone was fragile and, on system pages, actually carried a
            // stale display: none onto this button permanently (see the
            // matching fix in the mobile block below for the same bug).
            const histBtn = document.createElement('button');
            histBtn.id = 'btn-history-current-tab';
            histBtn.className = 'btn-sys btn-sys-regular tab-editor-btn-sidebar is-active';
            histBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> HISTORY`;
            histBtn.onclick = handleHistoryClick;

            btnGroup.insertBefore(histBtn, sidebarBtn);
        }
    }

    // 2. Hook up the Mobile Nav Buttons (Grouped Layout)
    if (mobileBtn) {
        mobileBtn.classList.add('is-active');
        mobileBtn.onclick = handleEditClick;

        const parentDiv = mobileBtn.parentNode;

        let mobBtnGroup = document.getElementById('mobile-btn-group');
        if (!mobBtnGroup) {
            mobBtnGroup = document.createElement('div');
            mobBtnGroup.id = 'mobile-btn-group';

            parentDiv.insertBefore(mobBtnGroup, mobileBtn);
            mobBtnGroup.appendChild(mobileBtn);

            // Real bug fixed here: this used to clone mobileBtn.style.cssText,
            // which on system pages included a leftover inline
            // "display: none" (present on those pages' static markup).
            // #btn-edit-current-tab-mobile had a matching ID-specific CSS
            // override to force it visible, but #btn-history-current-tab-mobile
            // had no such override - so the cloned inline style permanently
            // hid the History button on every system page except tierlist
            // (the one page whose markup happened not to include it).
            // Sharing .tab-editor-btn-mobile (style/Layout.css) instead of
            // cloning makes both buttons' visibility rule live in one place.
            const histBtnMob = document.createElement('button');
            histBtnMob.id = 'btn-history-current-tab-mobile';
            histBtnMob.className = 'btn-sys btn-sys-regular tab-editor-btn-mobile is-active';
            histBtnMob.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> HISTORY`;
            histBtnMob.onclick = handleHistoryClick;

            mobBtnGroup.insertBefore(histBtnMob, mobileBtn);
        }
    }
};

// Builds the sidebar's auth/profile dock (login state, role icon, OVERSEER
// link, INBOX button, Ko-fi restore) - NOT an "edit this page" button,
// despite this function's former name (initSidebarEditButton). That's
// initTabEditorButtons above, which builds the actual per-page Edit/History
// buttons into a separate DOM container. Renamed 2026-08-02 after the two
// were confused for each other - see project memory for the backstory.
window.initAuthDock = async function() {
    let container = document.getElementById('sidebar-dynamic-dock')
                 || document.getElementById('auth-dock-container')
                 || document.getElementById('auth-btn-container');
                 
    if (!container) return;

    let existingKofi = container.querySelector('.kofi-btn-wrapper, a[href*="Ko-fi"]');

    // --- AUTHENTICATION & SIDEBAR DOCK ---
    // 'none' rather than 'viewer' as the logged-out default: as of v0.11
    // 'viewer' is a real role meaning "signed in but cannot submit", so using
    // it as the anonymous placeholder would label every visitor with the ban
    // role. Only drives the dock icon today, but it is the kind of default
    // that quietly becomes a real bug the first time something gates on it.
    let userRole = 'none'; let username = 'LOGIN'; let unreadCount = 0;
    // A capability, not a role - see the OVERSEER button below.
    let canModerate = false;
    if (window.supabaseClient) {
        try {
            // Fetch the FULL session so we can pass it to our universal name extractor
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (session && session.user) {
                // Uses the unified Site Utils function to grab your exact Profile Name
                username = typeof window.getDisplayName === 'function' ? window.getDisplayName(session) : session.user.email.split('@')[0];
                
                // select('*'): the OVERSEER button below is gated on a
                // capability column as well as on the role, and naming columns
                // here would break the whole dock on any deploy where this
                // file is newer than the database.
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('*').eq('user_id', session.user.id).single();
                if (roleData) userRole = roleData.role;
                if (roleData && roleData.can_moderate === true) canModerate = true;
                
                // user_notifications, not system_inbox - the latter has no
                // migration and has never existed, so this count was always 0
                // and the badge never appeared no matter how many real
                // notifications were waiting.
                const { count } = await window.supabaseClient.from('user_notifications').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('is_read', false);
                unreadCount = count || 0;
            }
        } catch (e) { console.warn("Auth sync skipped."); }
    }

    // --- V0.4 FULL ROLE ICON SUITE (2.5px Geometric SVG) ---
    // 1. Guest / Logged Out (Standard User)
    const svgUser = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
    // 2. Authenticated Normal User (User + Checkmark)
    const svgAuth = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>`;
    // 3. Reviewer (The Eye / Observer)
    const svgReviewer = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    // 4. Trusted Editor (The Pen / Signature)
    const svgTrusted = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
    // 5. Admin (The Crown)
    const svgAdmin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M2 9l4.5 6L9 7l5 10 3.5-8L22 9"></path><path d="M2 9h20v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"></path></svg>`;

    // Core App Icons
    const svgGear = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    const svgMail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;

    // --- ASSIGN ROLES & COLORS ---
    let loginIcon = svgUser; 
    let dynamicColorClass = "btn-sys-regular"; 

    if (username !== 'LOGIN') {
        const role = userRole.toLowerCase();
        if (role === 'admin') { loginIcon = svgAdmin; dynamicColorClass = "btn-sys-purple"; } 
        else if (role === 'trusted_editor') { loginIcon = svgTrusted; dynamicColorClass = "btn-sys-yellow"; }
        else if (role === 'reviewer') { loginIcon = svgReviewer; dynamicColorClass = "btn-sys-blue"; } 
        else { loginIcon = svgAuth; dynamicColorClass = "btn-sys-green"; }
    }

    // --- CRITICAL DOM STRUCTURE FIX ---
    // Uses .btn-manga-icon and .btn-manga-text span wrappers so Layout.css knows how to collapse it natively
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
    let html = '';

    // 1. OVERSEER PANEL (Pathing Fixed)
    // Must match admin.html's own RBAC gate (js/admin-core.js) exactly.
    // Previously this also listed contributor/trusted_editor, which showed a
    // working-looking button that dead-ended at admin.html's access-denied
    // screen - so the two lists drifting apart has cost this project once
    // already, and they are changed together or not at all.
    //
    // can_moderate joined the list on 2026-08-13. It is a capability rather
    // than a role: user_roles has UNIQUE(user_id) because a second row broke
    // get_my_role() for that user everywhere, so "let this person moderate"
    // must never become a second role. admin-core.js scopes what they see once
    // they arrive - reports only, no revision or media queue.
    const elevatedRoles = ['admin', 'reviewer'];
    if (elevatedRoles.includes(userRole.toLowerCase()) || canModerate) {
        html += `
            <button id="dock-btn-edit" class="btn-sys btn-sys-purple dock-action-btn" onclick="window.location.href='${rootPath}admin.html'">
                <span class="btn-manga-icon dock-action-icon">${svgGear}</span>
                <span class="btn-manga-text dock-action-text">OVERSEER</span>
            </button>`;
    }

    // 2. SYSTEM INBOX
    if (username !== 'LOGIN') {
        let badgeHtml = unreadCount > 0 ? `<div class="dock-badge"></div>` : ``;
        html += `
            <button id="dock-btn-inbox" class="btn-sys btn-sys-blue dock-action-btn dock-btn-inbox">
                <span class="btn-manga-icon dock-action-icon">${svgMail}</span>
                <span class="btn-manga-text dock-action-text">INBOX</span>
                ${badgeHtml}
            </button>`;
    }

    // 3. MY SUBMISSIONS (self-service - any logged-in user, not role-gated)
    if (username !== 'LOGIN') {
        const svgSubmissions = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>`;
        html += `
            <button id="dock-btn-submissions" class="btn-sys btn-sys-regular dock-action-btn" onclick="window.location.href='${rootPath}submissions.html'">
                <span class="btn-manga-icon dock-action-icon">${svgSubmissions}</span>
                <span class="btn-manga-text dock-action-text">MY SUBMISSIONS</span>
            </button>`;
    }

    // 4. PROFILE / LOGIN
    html += `
        <button id="dock-btn-auth" class="btn-sys ${dynamicColorClass} dock-action-btn">
            <span class="btn-manga-icon dock-action-icon">${loginIcon}</span>
            <span class="btn-manga-text dock-action-text">${username.toUpperCase()}</span>
        </button>`;

    container.innerHTML = html;

    // --- RESTORE KO-FI ---
    if (existingKofi) {
        let targetNode = existingKofi.tagName === 'A' ? existingKofi : existingKofi.querySelector('a');
        if (targetNode) {
            targetNode.className = 'btn-sys btn-sys-yellow dock-action-btn';
            if (!targetNode.querySelector('.btn-manga-icon')) {
                const svgCoffee = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" class="dock-role-icon"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
                targetNode.innerHTML = `
                    <span class="btn-manga-icon dock-action-icon">${svgCoffee}</span>
                    <span class="kofi-text btn-manga-text">SUPPORT KO-FI</span>
                `;
            }
        }
        container.appendChild(existingKofi);
    }
    
    // Bind click events (unchanged logic)
    const btnAuth = document.getElementById('dock-btn-auth');
    if (btnAuth && typeof window.openAuthModal === 'function') btnAuth.onclick = window.openAuthModal;

    // Opens the real inbox modal built by js/site_utils.js's initNotifications.
    // This used to build a second modal here, with the same literal
    // id="site-notification-modal", reading the nonexistent system_inbox table -
    // so the bell always reported an empty inbox while the working
    // user_notifications data sat behind a modal nothing ever opened.
    const btnInbox = document.getElementById('dock-btn-inbox');
    if (btnInbox) {
        btnInbox.onclick = () => {
            if (typeof window.openNotificationModal === 'function') window.openNotificationModal();
        };
    }
};

// ==========================================
// 2. DATA GRID BUILDERS & FILTERS
// ==========================================

let masterRosterData = [];
let currentFilters = { archetype: 'All', tier: 'All', eaOnly: false, baseOnly: false, hideWip: false };

window.initRosterFilters = async function() {
    const filterContainer = document.getElementById('roster-filter-bar');
    if (!filterContainer) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }
        
        // ACCESSED CORRECTLY FROM NAVIGATION.JSON
        masterRosterData = navData["Characters"] || [];
    } catch(e) { console.error("Roster Data Error:", e); return; }

    if (masterRosterData.length === 0) return;

    const archetypes = ['All', ...new Set(masterRosterData.map(c => c.archetype).filter(a => a && a !== "TBD"))];
    const tiers = ['All', ...new Set(masterRosterData.map(c => c.tier).filter(t => t && t !== "TBD"))];

    filterContainer.innerHTML = `
        <!-- editor-select is the opt-in marker window.initializeMangaSelects
             looks for, and these two were the only dropdowns on the site
             without it - so they alone still summoned the operating system's
             own dropdown over the wiki's palette. Paired with a layout class
             the same way #media-filter-select already is. -->
        <div class="filter-group"><span class="filter-label">Archetype</span><select id="filter-archetype" class="filter-select editor-select">${archetypes.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
        <div class="filter-group"><span class="filter-label">Tier</span><select id="filter-tier" class="filter-select editor-select">${tiers.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
        <div class="filter-group filter-group-right">
            <button id="filter-ea" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">EA Only</span></div></button>
            <button id="filter-base" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">Base Only</span></div></button>
            <button id="filter-wip" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">Hide WIP</span></div></button>
        </div>
    `;

    document.getElementById('filter-archetype').addEventListener('change', (e) => { currentFilters.archetype = e.target.value; renderFilteredRoster(); });
    document.getElementById('filter-tier').addEventListener('change', (e) => { currentFilters.tier = e.target.value; renderFilteredRoster(); });

    const setupToggle = (btnId, filterKey) => {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', () => {
            currentFilters[filterKey] = !currentFilters[filterKey];
            btn.classList.toggle('active', currentFilters[filterKey]);
            renderFilteredRoster();
        });
    };
    setupToggle('filter-ea', 'eaOnly'); setupToggle('filter-base', 'baseOnly'); setupToggle('filter-wip', 'hideWip');

    renderFilteredRoster();
};

window.renderFilteredRoster = function() {
    const rosterGrid = document.getElementById('roster-grid') || document.querySelector('.roster-grid');
    if (!rosterGrid) return;
    rosterGrid.innerHTML = '';

    // --- Grab the root path to prevent duplicate directory stacking ---
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';

    const filteredChars = masterRosterData.filter(char => {
        if (char.published === false) return false;
        if (currentFilters.archetype !== 'All' && char.archetype !== currentFilters.archetype) return false;
        if (currentFilters.tier !== 'All' && char.tier !== currentFilters.tier) return false;
        if (currentFilters.eaOnly && !char.isEA) return false;
        if (currentFilters.baseOnly && !char.isBaseOnly) return false;
        if (currentFilters.hideWip && char.isWip) return false;
        return true; 
    });

    if (filteredChars.length === 0) {
        rosterGrid.innerHTML = `<div class="empty-tab-msg roster-empty-msg">No characters found matching these filters.</div>`;
        return;
    }

    let html = '';
    filteredChars.forEach(char => {
        let charColor = 'var(--bg-main)';
        let textColor = 'var(--text-white)';

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[char.name]) {
            charColor = window.CHARACTER_COLORS[char.name];
        }

        if (char.isBaseOnly) {
            textColor = '#a1a1aa';
        }

        // --- Prepend the rootPath to the href ---
        // Names, URLs and image paths are all owner-editable through
        // owner.html as of v0.10, so they are escaped at every interpolation
        // rather than trusted for being "internal" data.
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

        html += `
            <a href="${esc(rootPath + char.url)}" class="roster-card" style="background-color: ${charColor};">
                ${char.isEA ? `<span class="ea-star-indicator" title="Early Access" style="color: ${textColor};">★</span>` : ''}
                ${char.image ? `<img src="${esc(char.image)}" alt="${esc(char.name)}" class="roster-card-bg-image">` : ''}
                <div class="roster-card-text" style="color: ${textColor};">
                    ${esc(char.name)}
                    ${char.isWip ? `<br><span class="roster-wip-tag">(WIP)</span>` : ''}
                </div>
            </a>
        `;
    });
    rosterGrid.innerHTML = html;
};

// Categories that get their own Main Dashboard column, so they are not also
// listed inside the "Guides & Such" box. Named here rather than in index.html
// because both consumers - that box and the columns themselves - have to agree
// on the same list.
//
// The Others column is sub-grouped: one column, several labelled groups, each
// group a `site_pages.category`. There is no separate "Others" category -
// a page belongs to Gamemodes, Servers or Misc directly, which is why the one
// page created so far was already filed correctly.
//
// Adding a group here is the whole change: it appears in the column and
// disappears from the Side Dashboard's directory in one move. That second half
// is the part that bites - a category the column renders but this list omits
// would appear twice on the same screen.
window.OTHERS_SUBGROUPS = ['Gamemodes', 'Servers', 'Misc'];
// Sub-grouped by who the tool is for, the same mechanism the Others column
// uses. 'Tools' stays first for anything general; 'Creators' is for tools that
// operate on things people build (the Skill Builder ID Reader decodes moveset
// ids), and 'Community' for tools anyone visiting the site can just use.
//
// These have to match the categories on the rows, not the other way round: a
// category the column does not list falls through to the Side Dashboard's
// generic directory, which is where both tool pages landed before this.
window.TOOLS_SUBGROUPS = ['Tools', 'Creators', 'Community'];

window.OWN_COLUMN_CATEGORIES = [...window.OTHERS_SUBGROUPS, ...window.TOOLS_SUBGROUPS];

/**
 * Renders one category's pages as a column of buttons.
 *
 * Same shape as the buttons inside buildSystemsDirectory, because these are
 * the same thing - a link to a page - just grouped into their own dashboard
 * column instead of a shared box.
 *
 * A category with no pages yet renders a short line rather than an empty box,
 * so a column that is coming but not filled reads as deliberate.
 */
window.buildCategoryColumn = async function(containerId, categories) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Accepts one category or several. Several renders each as a labelled
    // sub-group inside the one column.
    const groups = Array.isArray(categories) ? categories : [categories];

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

        const populated = groups
            .map(name => ({ name, items: (navData && navData[name]) || [] }))
            .filter(g => g.items.length > 0);

        if (populated.length === 0) {
            container.innerHTML = `<p class="loading-msg loading-msg-md">Nothing here yet.</p>`;
            return;
        }

        // A heading only when there is more than one group to tell apart. A
        // lone "Tools" heading inside a section already titled Tools is noise.
        //
        // Counted on what is POPULATED, not what is declared. Declaring three
        // Tools sub-groups while only one has pages would otherwise put that
        // redundant heading back - which is the state this column is in
        // whenever a category exists but nobody has filed a page under it yet.
        const showHeadings = populated.length > 1;

        // An empty group renders nothing at all rather than a bare heading -
        // a promise of content is worse than silence.
        // data-href + a delegated listener, not an inline onclick: these names
        // and URLs come from site_pages, which an admin edits.
        container.innerHTML = populated.map(group => {
            const heading = showHeadings
                ? `<h3 class="column-subgroup-title">${esc(group.name)}</h3>`
                : '';

            const buttons = group.items.map(item => {
                let badge = '';
                if (item.isWip) badge = ` <span class="update-badge badge-wip update-badge-inline">WIP</span>`;
                return `
                <button class="btn-manga btn-manga-slanted system-directory-btn" data-href="${esc(rootPath + item.url)}">
                    <div class="btn-manga-content">
                        <span class="btn-manga-text">${esc(item.name)}${badge}</span>
                    </div>
                </button>`;
            }).join('');

            return `${heading}<div class="system-button-grid">${buttons}</div>`;
        }).join('');

        container.querySelectorAll('.system-directory-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const href = btn.dataset.href;
                if (href) window.location.href = href;
            });
        });
    } catch (e) {
        console.error(`Category column "${groups.join(', ')}" failed:`, e);
        container.innerHTML = `<p class="loading-msg loading-msg-error">Unavailable.</p>`;
    }
};

window.buildSystemsDirectory = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        // Category names are owner-authored too - they come straight from
        // site_pages.category - so they get the same treatment as page names.
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

        let html = '<div class="systems-grid-container">';
        // Others and Tools have their own Main Dashboard columns, so they are
        // excluded here rather than being listed twice on the same page.
        const categories = Object.keys(navData)
            .filter(k => k !== 'Characters' && !window.OWN_COLUMN_CATEGORIES.includes(k));

        categories.forEach((category) => {
            const items = navData[category];
            html += `
                <div class="system-category-block">
                    <h3 class="sidebar-master-title">${esc(category)}</h3>

                    <div class="system-button-grid">
            `;
            items.forEach(sys => {
                // Swapped flat gray boxes for slanted interactive manga buttons natively inheriting the blue hover glow.
                //
                // data-href + a delegated listener rather than an inline
                // onclick: since v0.10 these names and URLs come from
                // site_pages, which an admin edits through owner.html, so a
                // page named with an apostrophe used to break the handler
                // outright. Building owner-supplied values into an inline
                // onclick is the pattern CLAUDE.md rules out.
                html += `
                    <button class="btn-manga btn-manga-slanted system-directory-btn" data-href="${esc(rootPath + sys.url)}">
                        <div class="btn-manga-content">
                            <span class="btn-manga-text">${esc(sys.name)}</span>
                        </div>
                    </button>
                `;
            });
            html += `</div></div>`;
        });
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.system-directory-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const href = btn.dataset.href;
                if (href) window.location.href = href;
            });
        });
    } catch(e) {
        console.error("Systems Grid Error:", e);
    }
};

// ==========================================
// 3. UTILITIES & CHARACTER PAGE ENGINES
// ==========================================

// Restored: Tab switching logic for the Character Pages
// Tab groups are registered rather than closed over, because a tab can now
// arrive after the group is first wired: the Ultimate tab is injected at
// runtime by js/character_modes.js once the data says the character is
// base-only, which is long after page_boot.js set the strip up. Re-calling
// setupTabs with the fuller list extends the group in place - the click
// handler reads the live id list, so the buttons bound first still know to
// hide the tab added later.
//
// Boundness is marked on the button element, not held in a set here, so that
// a rebuilt strip (admin.html replaces its whole tab DOM per revision) gets
// fresh listeners on its fresh nodes instead of being wrongly skipped.
const tabGroupRegistry = new Map();

window.setupTabs = function(buttonGroupType, contentPrefix, tabIds, tabLevel = 'minor') {
    const groupKey = `${buttonGroupType}|${contentPrefix}`;

    let group = tabGroupRegistry.get(groupKey);
    if (!group) {
        group = { ids: [] };
        tabGroupRegistry.set(groupKey, group);
    }
    tabIds.forEach(id => { if (!group.ids.includes(id)) group.ids.push(id); });

    group.ids.forEach(tabId => {
        const button = document.getElementById(`${buttonGroupType}-${tabId}`);
        if (!button) return;
        if (button.dataset.tabBound === groupKey) return;
        button.dataset.tabBound = groupKey;

        button.addEventListener('click', () => {
            // Hide all tabs. Read from the group, not the tabIds this call was
            // given - a later registration may have added more.
            group.ids.forEach(id => {
                const btn = document.getElementById(`${buttonGroupType}-${id}`);
                const content = document.getElementById(`${contentPrefix}-${id}`);

                if (btn) btn.classList.remove('active');
                if (content) content.classList.add('hidden');
            });

            // Activate clicked tab
            button.classList.add('active');
            const targetContent = document.getElementById(`${contentPrefix}-${tabId}`);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                
                // Refresh the ToC for the new tab after a tiny delay so the DOM un-hides first
                if (tabLevel === 'major' && typeof window.refreshTOC === 'function') {
                    setTimeout(window.refreshTOC, 50);
                }
            }
        });
    });
};

// Context-Aware, Expansive & Collapsible Table of Contents Generator
window.refreshTOC = function() {
    const tocContainer = document.getElementById('dynamic-toc');
    if (!tocContainer) return;

    // 1. Target the active tab (Character Pages) OR the main content area (Dashboards)
    // Scoped to .main-content-area rather than assuming it's <main> itself -
    // true on character/system pages, but on admin.html .main-content-area
    // (#preview-content-area) sits three levels deep inside a differently-
    // classed <main> (.live-preview-pane), so the old "main > ..." selector
    // never matched there and silently fell through to indexing every tab
    // at once (hidden ones included), rendering every heading on the page
    // as a TOC entry instead of just the active tab's.
    let targetArea = document.querySelector('.main-content-area > div[id^="tab-"]:not(.hidden)');

    if (!targetArea) {
        targetArea = document.querySelector('.main-content-area');
    }

    if (!targetArea) {
        tocContainer.innerHTML = '<li><p class="loading-msg loading-msg-toc">Nothing to index here.</p></li>';
        return;
    }

    // 2. The Expansive Header System
    // Added '.section-title' so it can index Dashboard headers!
    const headers = targetArea.querySelectorAll('.section-title, .skill-title, .strategy-title, .card-header-title, .wiki-block-heading');

    if (headers.length === 0) {
        tocContainer.innerHTML = '<li><p class="loading-msg loading-msg-toc">Nothing to index here.</p></li>';
        return;
    }

    // 3. Build the Hierarchical Tree
    //
    // Labels are read with textContent and written back with innerHTML below,
    // which is a double-decode: a heading whose text is the literal string
    // "<img src=x onerror=...>" would be inert in the heading and live in the
    // ToC. Headings reach this from two directions - CMS block content, and
    // (as of v0.11) owner-set section titles from site_meta - so the label is
    // escaped here. A ToC entry is a label, not markup; a heading containing
    // <b>Bold</b> already arrives as "Bold" via textContent, so this changes
    // nothing for legitimate content.
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

    let tocStructure = [];
    let currentGroup = null;

    headers.forEach((header, index) => {
        if (header.textContent.trim() === 'Move Overview and Strategy') return;

        // Dynamic Anchor Generation
        if (!header.id) {
            const slug = header.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
            header.id = `toc-${slug}-${index}`;
        }
        
        const isMinor = header.classList.contains('wiki-block-heading');

        // A heading can contain controls - the dashboards nest a "View More"
        // link inside their section titles - and their text is not part of the
        // heading. Without this the homepage ToC reads "Characters View More
        // ➔". Falls back to the full text for a heading that is itself a link,
        // where stripping would leave nothing.
        const labelSource = header.cloneNode(true);
        labelSource.querySelectorAll('a, button').forEach(el => el.remove());
        const label = labelSource.textContent.trim() || header.textContent.trim();

        const itemData = { id: header.id, text: label };

        if (!isMinor) {
            // Create a new major group
            currentGroup = { ...itemData, children: [] };
            tocStructure.push(currentGroup);
        } else {
            // Add to the current major group, or create an orphan if it's floating alone
            if (currentGroup) {
                currentGroup.children.push(itemData);
            } else {
                tocStructure.push({ ...itemData, children: [], isOrphan: true });
            }
        }
    });

    // 4. Render the Tree to HTML with Collapsible Accordions
    let tocHtml = '';
    tocStructure.forEach(group => {
        if (group.isOrphan) {
            // Fallback for orphaned minor headers
            tocHtml += `
                <li>
                    <a href="#${esc(group.id)}" class="btn-nav toc-link-minor" onclick="smoothScroll(event, '${esc(group.id)}')">
                        <span class="toc-link-text">${esc(group.text)}</span>
                    </a>
                </li>
            `;
        } else {
            if (group.children.length > 0) {
                // Parent Header WITH a Toggle Button
                tocHtml += `
                    <li>
                        <div class="toc-group-row">
                            <a href="#${esc(group.id)}" class="btn-nav toc-link-major-toggle" onclick="smoothScroll(event, '${esc(group.id)}')">
                                <span class="toc-link-text">${esc(group.text)}</span>
                            </a>
                            <button type="button" class="toc-toggle-btn" aria-expanded="true"
                                    aria-label="Toggle subsections of ${esc(group.text)}">
                                <span aria-hidden="true">▼</span>
                            </button>
                        </div>
                        <ul class="toc-sublist">
                `;

                // Render the Nested Children
                group.children.forEach(child => {
                    tocHtml += `
                        <li>
                            <a href="#${esc(child.id)}" class="btn-nav toc-link-minor" onclick="smoothScroll(event, '${esc(child.id)}')">
                                <span class="toc-link-text">${esc(child.text)}</span>
                            </a>
                        </li>
                    `;
                });

                tocHtml += `</ul></li>`;
            } else {
                // Standard Parent Header (No Children, No Toggle Arrow)
                tocHtml += `
                    <li>
                        <a href="#${esc(group.id)}" class="btn-nav toc-link-major" onclick="smoothScroll(event, '${esc(group.id)}')">
                            <span class="toc-link-text">${esc(group.text)}</span>
                        </a>
                    </li>
                `;
            }
        }
    });
    
    tocContainer.innerHTML = tocHtml;

    // Delegated, replacing the inline onclick these toggles used to carry, and
    // keeping aria-expanded in step with the caret.
    tocContainer.querySelectorAll('.toc-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sublist = btn.parentElement && btn.parentElement.nextElementSibling;
            if (!sublist) return;
            const open = sublist.classList.toggle('hidden') === false;
            btn.setAttribute('aria-expanded', String(open));
        });
    });
};

// Smooth scroll with offset to prevent headers from hiding under the top of the screen
window.smoothScroll = function(e, targetId) {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
        const offset = 40; // Gives breathing room above the header
        const elementPosition = target.getBoundingClientRect().top + window.scrollY;
        
        window.scrollTo({
            top: elementPosition - offset,
            behavior: 'smooth'
        });
        history.pushState(null, null, `#${targetId}`);
    }
};

// Restored: Wiki Alert Generator
window.showWikiAlert = function(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const alertMap = {
        'wip': { icon: '🚧', class: 'alert-wip', title: 'Work In Progress' },
        'medialess': { icon: '🎥', class: 'alert-medialess', title: 'Media Missing' },
        'ea': { icon: '⭐', class: 'alert-ea', title: 'Early Access Content' },
        'unverified': { icon: '⚠️', class: 'alert-unverified', title: 'Unverified Data' },
        'subjective': { icon: '👁️', class: 'alert-subjective', title: 'Subjective Strategy' },
        'outdated': { icon: '🕒', class: 'alert-outdated', title: 'Outdated Patch' }
    };

    const config = alertMap[type] || alertMap['wip'];

    // Uses += so multiple alerts stack perfectly
    container.innerHTML += `
        <div class="wiki-alert ${config.class}">
            <div class="wiki-alert-icon">${config.icon}</div>
            <div class="wiki-alert-content">
                <h4>${config.title}</h4>
                <p>${message}</p>
            </div>
        </div>
    `;
};

// Restored: Auto-fetching Alerts based on Navigation.json
window.loadPageAlerts = async function(pageId) {
    const container = document.getElementById('character-alerts-container');
    if (!container) return;
    container.innerHTML = ''; 
    
    try {
        const rootPath = window.getRootPath ? window.getRootPath() : '../../';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        let targetEntry = null;
        for (const [cat, items] of Object.entries(navData)) {
            const found = items.find(i => i.cms_config && i.cms_config.pageId === pageId);
            if (found) { targetEntry = found; break; }
        }
        
        if (!targetEntry) return;

        // Triggers the UI components automatically based on the JSON booleans
        if (targetEntry.isWip) window.showWikiAlert('character-alerts-container', 'wip', 'This page is actively being drafted. Data may be incomplete or subject to change.');
        if (targetEntry.isEA) window.showWikiAlert('character-alerts-container', 'ea', 'This character is currently in Early Access. Strategies and frame data will likely change constantly.');
        if (targetEntry.isMissingMedia) window.showWikiAlert('character-alerts-container', 'medialess', 'Some videos or images are missing from this page. We are working on recording them!');
    } catch (e) {
        console.error("Failed to load page alerts:", e);
    }
};

// ==========================================
// 6. SITEWIDE FOOTER
// ==========================================

// Injected rather than duplicated into 41 HTML files. The .site-layout guard
// is what keeps it off edit.html/admin.html/owner.html: those three are the
// only pages without that wrapper, and they load editor.css, whose
// unconditional `body { overflow: hidden }` means anything appended to <body>
// there could never be scrolled to anyway.
// The skip link is injected here rather than from each page's own boot block,
// so it cannot be present on 41 pages and missing from the 42nd - which is
// worse than not having one, because a keyboard user learns to expect it.
document.addEventListener('DOMContentLoaded', () => {
    if (window.initSkipLink) window.initSkipLink();
});

window.buildSiteFooter = function() {
    if (document.getElementById('site-footer')) return;
    if (!document.querySelector('.site-layout')) return;

    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';

    const footer = document.createElement('footer');
    footer.id = 'site-footer';
    footer.className = 'site-footer';
    footer.innerHTML = `
        <div class="site-footer-inner">
            <span class="site-footer-copy">&copy; ${new Date().getFullYear()} Deptr</span>
            <a href="${rootPath}privacy-policy.html" class="site-footer-link">Privacy Policy</a>
            <a href="${rootPath}LICENSE" class="site-footer-link">License (MIT)</a>
            <span class="site-footer-note">A fan-made wiki. Not affiliated with the game's developers.</span>
        </div>
    `;
    document.body.appendChild(footer);
};

// This file's functions are otherwise all called explicitly by each page's own
// inline script. The footer self-fires instead, matching site_utils.js's own
// listener, so it lands everywhere without editing every page.
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.buildSiteFooter === 'function') window.buildSiteFooter();
});
