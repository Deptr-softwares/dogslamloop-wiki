/**
 * The page builder: what surrounds a page's content. The skip link, the left
 * sidebar's menu and account dock, the phone drawers and bottom bar, the Edit and
 * History buttons, the roster grid with its icons and hover banners, the
 * dashboard columns and systems directory, the tab strips (setupTabs), section
 * anchors and in-page jumps, the table of contents, page alerts and the footer.
 * @since v0.01
 * @touches data/navigation.json, data/banners.json, user_roles, page_experts,
 *   user_notifications, cms_config.editRole, ?tab= and #sec- in the address
 * @watch the dock's OVERSEER button and admin.html's own gate (admin-core.js) let
 *   in the same people: change the two together
 * @see docs/page-shell.md
 */

/**
 * The skip-to-content link, added on every page by this file, which every page
 * loads. Without it, reaching a character page's first paragraph by keyboard means
 * tabbing through about 40 menu links.
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

/** The left sidebar's collapse button, with its label kept true to what it does. */
window.initSidebarToggle = function() {
    const toggleBtn = document.querySelector('.sidebar-toggle-btn');
    const sidebar = document.getElementById('master-sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
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

/**
 * The phone's two drawers over one backdrop: the site name opens the navigation
 * (left), the menu button the table of contents (right), so the control on each
 * side opens the drawer on that side. Also builds the bottom bar.
 */
window.initMobileNav = function() {
    const navBtn = document.getElementById('mobile-nav-toggle');
    const tocBtn = document.getElementById('mobile-menu-toggle');
    const left = document.getElementById('master-sidebar');
    const right = document.querySelector('.local-sidebar-right');
    const backdrop = document.getElementById('mobile-backdrop');

    if (!backdrop) return;

    // A page with no right sidebar hides the button: one that opens an empty drawer is
    // worse than none.
    if (tocBtn && !right) tocBtn.hidden = true;

    // A right sidebar with no contents (only Ko-fi and the Sitewide links) is called
    // the sidebar, not the table of contents.
    const drawerName = right && !right.querySelector('#dynamic-toc') ? 'sidebar' : 'table of contents';
    if (tocBtn) tocBtn.setAttribute('aria-label', `Open ${drawerName}`);

    // aria-controls needs a target with an id, and the right sidebar has none on any page.
    if (right) {
        if (!right.id) right.id = 'mobile-toc-drawer';
        if (tocBtn) tocBtn.setAttribute('aria-controls', right.id);
    }

    const panels = [
        { el: left, btn: navBtn, open: 'Open navigation menu', close: 'Close navigation menu' },
        { el: right, btn: tocBtn, open: `Open ${drawerName}`, close: `Close ${drawerName}` },
    ].filter(p => p.el && p.btn);

    // Only ever one at a time: they slide in from opposite edges over the same
    // backdrop, and two open at once would leave the reader looking at a strip
    // of page between them.
    const setOpen = (target, open) => {
        panels.forEach(p => {
            const isOpen = open && p === target;
            p.el.classList.toggle('mobile-open', isOpen);
            p.btn.setAttribute('aria-expanded', String(isOpen));
            p.btn.setAttribute('aria-label', isOpen ? p.close : p.open);
        });
        backdrop.classList.toggle('active', open);
    };

    panels.forEach(p => {
        p.btn.addEventListener('click', () => {
            // Toggle rather than always-open: the same control that opened it
            // is the one a thumb reaches for to put it away.
            setOpen(p, !p.el.classList.contains('mobile-open'));
        });
    });

    backdrop.addEventListener('click', () => setOpen(null, false));

    // Escape closes whichever is open. Without this the only way out is a tap
    // on the backdrop, which a keyboard user has no way to reach.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openPanel = panels.find(p => p.el.classList.contains('mobile-open'));
        if (!openPanel) return;
        setOpen(null, false);
        openPanel.btn.focus();
    });

    // Following a contents link should put the drawer away - otherwise the
    // reader lands on the heading they picked with it still covering the page.
    if (right) {
        right.addEventListener('click', (event) => {
            if (event.target.closest('a')) setOpen(null, false);
        });
    }

    const navPanel = panels.find(p => p.el === left);
    buildMobileBottomBar(navPanel ? () => setOpen(navPanel, true) : null);
};

// The bottom bar on a phone: search, the account, Site Settings and Ko-fi, on every
// page that starts the phone navigation (the editor and the review queue do not).
// Nothing in it is a second copy: each button calls what its desktop twin calls.
function buildMobileBottomBar(openNavDrawer) {
    if (document.getElementById('mobile-bottom-bar')) return;

    const icon = (id) => window.uiIconHTML(id);
    const ICONS = {
        search: icon('search'),
        kofi: icon('kofi'),
        settings: icon('dock-site-settings'),
    };
    const kofiLink = document.querySelector('a[href*="ko-fi.com" i]');

    const bar = document.createElement('nav');
    bar.id = 'mobile-bottom-bar';
    bar.className = 'mobile-bottom-bar';
    bar.setAttribute('aria-label', 'Quick access');
    bar.innerHTML = `
        <button type="button" class="mobile-bottom-btn" data-bottom="search">${ICONS.search}<span>Search</span></button>
        ${kofiLink ? `<a class="mobile-bottom-btn mobile-bottom-kofi" data-bottom="kofi" target="_blank" rel="noopener">${ICONS.kofi}<span>Ko-fi</span></a>` : ''}
        <button type="button" class="mobile-bottom-btn" data-bottom="settings">${ICONS.settings}<span>Settings</span></button>
        <button type="button" class="mobile-bottom-btn" data-bottom="account"><span class="mobile-bottom-icon"></span><span class="mobile-bottom-label">Account</span></button>`;
    if (kofiLink) bar.querySelector('[data-bottom="kofi"]').href = kofiLink.href;
    document.body.appendChild(bar);
    document.body.classList.add('has-mobile-bottom-bar');

    bar.querySelector('[data-bottom="search"]').addEventListener('click', () => {
        // Looked up at the tap: the search box is built after this bar on
        // some pages. Focused inside the tap itself, which is what lets a
        // phone bring its keyboard up.
        const input = document.getElementById('site-search-input');
        if (!input || !openNavDrawer) {
            const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
            window.location.href = `${rootPath}search.html`;
            return;
        }
        openNavDrawer();
        input.focus({ preventScroll: true });
    });
    bar.querySelector('[data-bottom="settings"]').addEventListener('click', () => {
        if (typeof window.openSiteSettings === 'function') window.openSiteSettings();
    });
    bar.querySelector('[data-bottom="account"]').addEventListener('click', () => {
        if (typeof window.openAuthModal === 'function') window.openAuthModal();
    });

    window.syncMobileBottomAccount();
}

// The account button shows who is signed in the way the dock does: the role's
// icon, and LOGIN for a guest. The dock learns that from a request, and may
// finish before or after the bar is built, so both ends call this.
let mobileBottomAccount = { icon: null, signedIn: false };
/** Shows the signed-in state on the bottom bar's account button; the dock calls it too. */
window.syncMobileBottomAccount = function(state) {
    if (state) mobileBottomAccount = state;
    const btn = document.querySelector('#mobile-bottom-bar [data-bottom="account"]');
    if (!btn) return;
    const icon = mobileBottomAccount.icon
        || (typeof window.roleIconHTML === 'function' ? window.roleIconHTML('guest') : '');
    btn.querySelector('.mobile-bottom-icon').innerHTML = icon;
    btn.querySelector('.mobile-bottom-label').textContent = mobileBottomAccount.signedIn ? 'Account' : 'Login';
};

/**
 * The left sidebar's navigation menu from data/navigation.json, grouped by
 * category, with the search box above it.
 */
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

        // navigation.json comes from site_pages, and this menu is on every page: escaped at
        // every interpolation.

        let html = '';
        for (const [category, items] of Object.entries(navData)) {
            // A <button>, so it is reachable by keyboard and announced as a control.
            // aria-expanded carries what the caret shows.
            html += `<div class="sidebar-group-wrapper">`;
            html += `<button type="button" class="sidebar-nav-title sidebar-group-header" aria-expanded="false">
                        ${window.escapeHtml(category)} <span class="sidebar-group-caret" aria-hidden="true">▼</span>
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
                        <a href="${window.escapeHtml(rootPath + item.url)}" class="btn-nav">
                            <span class="toc-link-text" style="${colorStyle}">${window.escapeHtml(item.name)}</span>
                            ${badge}
                        </a>
                    </li>
                `;
            });
            html += `</ul></div>`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.sidebar-group-header').forEach(header => {
            header.addEventListener('click', () => {
                const list = header.nextElementSibling;
                if (!list) return;
                const open = list.classList.toggle('hidden') === false;
                header.setAttribute('aria-expanded', String(open));
            });
        });

        // The search box goes in after the menu, so failing to build it cannot cost the
        // navigation, and inside the try, so it is reported like the rest.
        if (typeof window.initSiteSearch === 'function') window.initSiteSearch(containerId);
    } catch (e) {
        console.error("Sidebar Menu Error:", e);
        container.innerHTML = `<p class="loading-msg loading-msg-error">Menu unavailable.</p>`;
    }
};

/**
 * The page's Edit and History buttons, in the table of contents (a drawer on a
 * phone, so one pair serves every width).
 * @touches navigation.json (cms_config.editRole), ?mode=
 * @watch a 'locked' page shows no Edit button; an 'elevated' one shows it and is
 *   gated at submit (editor-core.js's page_permissions check)
 */
window.initTabEditorButtons = async function(pageId, pageType = 'character') {
    const sidebarBtn = document.getElementById('btn-edit-current-tab');

    if (!pageId) return;

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

        // The character state goes along (?mode=), so Edit opens the state being read. The
        // in-memory value first: it is right before the first switch writes the
        // parameter. Base sends none, as character_modes.js does.
        const mode = window.activeCharacterMode
            || new URLSearchParams(window.location.search).get('mode');
        const onBase = typeof window.isBaseMode === 'function'
            ? window.isBaseMode(mode)
            : (!mode || mode === 'base');
        const modeParam = onBase ? '' : `&mode=${encodeURIComponent(mode)}`;

        window.location.href = `../../edit.html?page=${pageId}&type=${pageType}&tab=${activeTabId}${modeParam}`;
    };

    const handleHistoryClick = () => {
        window.location.href = `../../history.html?page=${pageId}`;
    };

    if (sidebarBtn) {
        sidebarBtn.classList.add('is-active');
        sidebarBtn.onclick = handleEditClick;

        const parentDiv = sidebarBtn.parentNode;

        parentDiv.classList.add('sidebar-tab-header-stacked');

        let btnGroup = document.getElementById('sidebar-btn-group');
        if (!btnGroup) {
            btnGroup = document.createElement('div');
            btnGroup.id = 'sidebar-btn-group';

            parentDiv.insertBefore(btnGroup, sidebarBtn);
            btnGroup.appendChild(sidebarBtn);

            // History shares .tab-editor-btn-sidebar with Edit (style/Layout.css), never a
            // copy of Edit's inline style.
            const histBtn = document.createElement('button');
            histBtn.id = 'btn-history-current-tab';
            histBtn.className = 'btn-sys btn-sys-regular tab-editor-btn-sidebar is-active';
            histBtn.innerHTML = `${window.uiIconHTML('history')} HISTORY`;
            histBtn.onclick = handleHistoryClick;

            btnGroup.insertBefore(histBtn, sidebarBtn);
        }
    }
};

// Ko-fi sits at the top of the right sidebar where a page has one, and stays on
// the left where it has not (the Forum, the legal pages, search, the hubs). The
// page's own link is moved, not rebuilt, so its address is written once per page.
function placeKofiOnTheRight() {
    const right = document.querySelector('.local-sidebar-right');
    if (!right || right.querySelector('.kofi-btn-wrapper')) return;
    const link = document.querySelector('.global-sidebar-left a[href*="Ko-fi"]');
    if (!link) return;

    const left = link.closest('.kofi-btn-wrapper');
    const wrap = document.createElement('div');
    wrap.className = 'kofi-btn-wrapper';
    link.className = 'btn-sys btn-sys-yellow kofi-btn-full';
    wrap.appendChild(link);
    right.prepend(wrap);
    if (left && !left.querySelector('a')) left.remove();
}

/**
 * The left sidebar's account dock: the sign-in state and role badge, OVERSEER,
 * the inbox, My Submissions, Site Settings and Ko-fi.
 * @touches user_roles, page_experts, user_notifications, claimPendingBadges
 */
window.initAuthDock = async function() {
    // First, before any request: the button never shows on the left and then
    // jumps.
    placeKofiOnTheRight();

    let container = document.getElementById('sidebar-dynamic-dock')
                 || document.getElementById('auth-dock-container')
                 || document.getElementById('auth-btn-container');
                 
    if (!container) return;

    let existingKofi = container.querySelector('.kofi-btn-wrapper, a[href*="Ko-fi"]');

    // 'none', not 'viewer', for a guest: viewer is a real role, a soft ban.
    let userRole = 'none'; let username = 'LOGIN'; let unreadCount = 0;
    // A capability, not a role - see the OVERSEER button below.
    let canModerate = false;
    // Neither a role nor a capability: a row in page_experts. Also the OVERSEER
    // button - see below.
    let isExpert = false;
    if (window.supabaseClient) {
        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (session && session.user) {
                // A badge won signed out is kept the moment its winner is
                // signed in. Not awaited: the dock does not wait on it.
                if (typeof window.claimPendingBadges === 'function') window.claimPendingBadges();

                username = typeof window.getDisplayName === 'function' ? window.getDisplayName(session) : session.user.email.split('@')[0];
                
                // select('*'): the OVERSEER button below is gated on a
                // capability column as well as on the role, and naming columns
                // here would break the whole dock on any deploy where this
                // file is newer than the database.
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('*').eq('user_id', session.user.id).single();
                if (roleData) userRole = roleData.role;
                if (roleData && roleData.can_moderate === true) canModerate = true;

                // Asked only when the role has not earned the button already, so staff pay
                // nothing for it; admin-core.js skips it the same way.
                if (!window.roleMeets(userRole, 'reviewer') && !canModerate) {
                    const { data: expertPages } = await window.supabaseClient
                        .rpc('get_user_expert_pages', { target_user_id: session.user.id });
                    isExpert = Array.isArray(expertPages) && expertPages.length > 0;
                }
                
                // user_notifications is the inbox's table.
                const { count } = await window.supabaseClient.from('user_notifications').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('is_read', false);
                unreadCount = count || 0;
            }
        } catch (e) { console.warn("Auth sync skipped."); }
    }

    // The site's icons (window.UI_ICONS, site_lookups.js). A role's badge is
    // window.ROLE_BADGES (site_account.js), shared with the profile modal.
    const svgGear = window.uiIconHTML('dock-overseer');
    const svgMail = window.uiIconHTML('dock-inbox');

    // The badge is matched by role name, not rank: an icon is an identity, not a bar
    // somebody clears, and roleMeets would give the owner the admin's shield.
    // window.roleBadge falls back to the signed-in badge for anything unknown.
    const dockBadge = window.roleBadge(username === 'LOGIN' ? 'guest' : userRole);
    const loginIcon = window.roleIconHTML(username === 'LOGIN' ? 'guest' : userRole);
    const dynamicColorClass = `btn-sys-${dockBadge.color}`;

    // .btn-manga-icon and .btn-manga-text spans let Layout.css collapse the dock.
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
    let html = '';

    // OVERSEER, for exactly the people admin.html's own gate (admin-core.js) lets in:
    // a reviewer or above, a moderator (can_moderate) or a page expert. The two lists
    // change together, or the button dead-ends at access denied. can_moderate is a
    // capability, never a second role: user_roles holds one row per user.
    if (window.roleMeets(userRole, 'reviewer') || canModerate || isExpert) {
        html += `
            <button id="dock-btn-edit" class="btn-sys btn-sys-purple dock-action-btn" onclick="window.location.href='${rootPath}admin.html'">
                <span class="btn-manga-icon dock-action-icon">${svgGear}</span>
                <span class="btn-manga-text dock-action-text">Overseer</span>
            </button>`;
    }

    if (username !== 'LOGIN') {
        let badgeHtml = unreadCount > 0 ? `<div class="dock-badge"></div>` : ``;
        html += `
            <button id="dock-btn-inbox" class="btn-sys btn-sys-blue dock-action-btn dock-btn-inbox">
                <span class="btn-manga-icon dock-action-icon">${svgMail}</span>
                <span class="btn-manga-text dock-action-text">Inbox</span>
                ${badgeHtml}
            </button>`;
    }

    // My Submissions: any signed-in user.
    if (username !== 'LOGIN') {
        const svgSubmissions = window.uiIconHTML('dock-submissions');
        html += `
            <button id="dock-btn-submissions" class="btn-sys btn-sys-regular dock-action-btn" onclick="window.location.href='${rootPath}submissions.html'">
                <span class="btn-manga-icon dock-action-icon">${svgSubmissions}</span>
                <span class="btn-manga-text dock-action-text">My submissions</span>
            </button>`;
    }

    // The account button shares its row with Site Settings: a row of its own would push
    // the account out of sight on a short screen. Sliders, because OVERSEER is the gear.
    const svgSliders = window.uiIconHTML('dock-site-settings');
    html += `
        <div class="dock-auth-row">
            <button id="dock-btn-auth" class="btn-sys ${dynamicColorClass} dock-action-btn">
                <span class="btn-manga-icon dock-action-icon">${loginIcon}</span>
                <span class="btn-manga-text dock-action-text">${username === 'LOGIN' ? 'Login' : window.escapeHtml(username)}</span>
            </button>
            <button type="button" id="dock-btn-settings" class="btn-sys btn-sys-regular dock-settings-btn" title="Site settings" aria-label="Site settings">
                <span class="btn-manga-icon dock-action-icon">${svgSliders}</span>
            </button>
        </div>`;

    container.innerHTML = html;

    if (existingKofi) {
        let targetNode = existingKofi.tagName === 'A' ? existingKofi : existingKofi.querySelector('a');
        if (targetNode) {
            targetNode.className = 'btn-sys btn-sys-yellow dock-action-btn';
            if (!targetNode.querySelector('.btn-manga-icon')) {
                const svgCoffee = window.uiIconHTML('kofi');
                targetNode.innerHTML = `
                    <span class="btn-manga-icon dock-action-icon">${svgCoffee}</span>
                    <span class="kofi-text btn-manga-text">SUPPORT KO-FI</span>
                `;
            }
        }
        container.appendChild(existingKofi);
    }
    
    const btnAuth = document.getElementById('dock-btn-auth');
    if (btnAuth && typeof window.openAuthModal === 'function') btnAuth.onclick = window.openAuthModal;
    const btnSettings = document.getElementById('dock-btn-settings');
    if (btnSettings) btnSettings.onclick = () => window.openSiteSettings();
    window.syncMobileBottomAccount({ icon: loginIcon, signedIn: username !== 'LOGIN' });

    // Opens the inbox modal site_account.js builds (initNotifications).
    const btnInbox = document.getElementById('dock-btn-inbox');
    if (btnInbox) {
        btnInbox.onclick = () => {
            if (typeof window.openNotificationModal === 'function') window.openNotificationModal();
        };
    }
};

let masterRosterData = [];
// showHidden lets hidden characters in. WIP is not a filter: it says whether a
// page is finished, which is not a thing a reader filters on.
let currentFilters = { archetype: 'All', eaOnly: false, baseOnly: false, showHidden: false };

/** Loads the roster from data/navigation.json and wires its filters. */
window.initRosterFilters = async function() {
    const filterContainer = document.getElementById('roster-filter-bar');
    if (!filterContainer) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }
        
        masterRosterData = navData["Characters"] || [];
    } catch(e) { console.error("Roster Data Error:", e); return; }

    if (masterRosterData.length === 0) return;

    const archetypes = ['All', ...new Set(masterRosterData.map(c => c.archetype).filter(a => a && a !== "TBD"))];

    filterContainer.innerHTML = `
        <!-- editor-select is the opt-in marker window.initializeMangaSelects
             looks for, and this was once one of the only dropdowns on the site
             without it - so it alone still summoned the operating system's
             own dropdown over the wiki's palette. Paired with a layout class
             the same way #media-filter-select already is. -->
        <div class="filter-group"><span class="filter-label">Archetype</span><select id="filter-archetype" class="filter-select editor-select">${archetypes.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
        <div class="filter-group filter-group-right">
            <button id="filter-ea" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">EA Only</span></div></button>
            <button id="filter-base" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">Base Only</span></div></button>
            <button id="filter-hidden" class="filter-toggle btn-manga btn-manga-slanted" title="Characters playable only in a Private Server"><div class="btn-manga-content"><span class="btn-manga-text">Show Hidden</span></div></button>
        </div>
    `;

    document.getElementById('filter-archetype').addEventListener('change', (e) => { currentFilters.archetype = e.target.value; renderFilteredRoster(); });

    const setupToggle = (btnId, filterKey) => {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', () => {
            currentFilters[filterKey] = !currentFilters[filterKey];
            btn.classList.toggle('active', currentFilters[filterKey]);
            renderFilteredRoster();
        });
    };
    setupToggle('filter-ea', 'eaOnly'); setupToggle('filter-base', 'baseOnly'); setupToggle('filter-hidden', 'showHidden');

    renderFilteredRoster();
};

// The roster card's icon: its path is window.rosterIconPath (site_lookups.js), where
// text on any page can reach it too.

// Marks the cards whose icon loaded, and drops the ones that did not. The class is
// added on load, never written into the markup, so a missing icon leaves the plain
// card (its colour, the name centred): the fallback is the absence of an opt-in.
// Listeners, not inline handlers, and a cached image may be complete already.
window.markLoadedRosterIcons = function (root) {
    const scope = root || document;
    scope.querySelectorAll('.roster-card-icon').forEach(img => {
        const card = img.closest('.roster-card');
        const keep = () => { if (card) card.classList.add('has-icon'); };
        const drop = () => { img.remove(); };

        if (img.complete) {
            if (img.naturalWidth > 0) keep(); else drop();
            return;
        }
        img.addEventListener('load', keep, { once: true });
        img.addEventListener('error', drop, { once: true });
    });
};

// Hover banners: about 0.25s over a roster card opens the character's banner with
// the first line of their Overview, from data/banners.json (mirrored nightly by
// scripts/fetch-banners.js), so a hover asks Supabase for nothing. A line with no
// banner shows over the character's colour; neither shows no popup. A mouse or a
// keyboard only: a tap opens the page.
const ROSTER_BANNER_DELAY_MS = 250;
let rosterBanners = null;   // the promise of data/banners.json, fetched on the first hover
let rosterBannerFor = null; // the card a popup is coming for, or showing
let rosterBannerTimer = null;

function loadRosterBanners() {
    if (!rosterBanners) {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';
        rosterBanners = window.fetchJson(`${rootPath}data/banners.json`, { cache: true }).catch(err => {
            // A roster without its banners is still a roster: the popups just
            // do not open.
            console.warn('The hover banners could not be loaded:', err.message);
            return {};
        });
    }
    return rosterBanners;
}

function rosterBannerElement() {
    let el = document.getElementById('roster-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'roster-banner';
        el.className = 'roster-banner';
        el.setAttribute('role', 'tooltip');
        el.hidden = true;
        document.body.appendChild(el);
    }
    return el;
}

function hideRosterBanner() {
    clearTimeout(rosterBannerTimer);
    if (rosterBannerFor) rosterBannerFor.removeAttribute('aria-describedby');
    rosterBannerFor = null;
    const el = document.getElementById('roster-banner');
    if (el) el.hidden = true;
}

// Above the card when there is room, below it when not, and kept on screen.
function placeRosterBanner(el, card) {
    const edge = 16;
    const gap = 8;
    const box = card.getBoundingClientRect();
    let top = box.top - el.offsetHeight - gap;
    if (top < edge) top = box.bottom + gap;
    const left = Math.max(edge, Math.min(box.left + box.width / 2 - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - edge));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
}

async function showRosterBanner(card) {
    const entry = (await loadRosterBanners())[card.dataset.pageId];
    // Left meanwhile, or nothing to show.
    if (rosterBannerFor !== card || !entry || (!entry.image && !entry.overview)) return;

    const el = rosterBannerElement();
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';
    el.style.setProperty('--banner-color', card.style.getPropertyValue('--char-color') || 'var(--border-color)');
    el.replaceChildren();

    if (entry.image) {
        const img = document.createElement('img');
        img.className = 'roster-banner-image';
        img.src = rootPath + entry.image;
        img.alt = '';
        el.appendChild(img);
    } else {
        const band = document.createElement('div');
        band.className = 'roster-banner-band';
        el.appendChild(band);
    }
    // textContent throughout: the line is contributor text.
    const body = document.createElement('div');
    body.className = 'roster-banner-body';
    const name = document.createElement('div');
    name.className = 'roster-banner-name';
    name.textContent = (card.querySelector('.roster-card-text') || card).textContent.trim();
    body.appendChild(name);
    if (entry.overview) {
        const line = document.createElement('p');
        line.className = 'roster-banner-overview';
        line.textContent = entry.overview;
        body.appendChild(line);
    }
    el.appendChild(body);

    el.hidden = false;
    placeRosterBanner(el, card);
    card.setAttribute('aria-describedby', 'roster-banner');
}

// Bound once per grid: the grid's contents are rebuilt on every filter
// change, the grid is not.
function bindRosterBanners(grid) {
    if (grid.dataset.bannersBound) return;
    grid.dataset.bannersBound = 'true';

    const comeFor = (card) => {
        hideRosterBanner();
        rosterBannerFor = card;
        loadRosterBanners();
        rosterBannerTimer = setTimeout(() => showRosterBanner(card), ROSTER_BANNER_DELAY_MS);
    };

    grid.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        const card = e.target.closest('.roster-card');
        if (card && card !== rosterBannerFor) comeFor(card);
    });
    grid.addEventListener('pointerout', (e) => {
        const card = e.target.closest('.roster-card');
        if (card && !card.contains(e.relatedTarget)) hideRosterBanner();
    });
    grid.addEventListener('focusin', (e) => {
        const card = e.target.closest('.roster-card');
        if (card && card.matches(':focus-visible')) comeFor(card);
    });
    grid.addEventListener('focusout', (e) => {
        if (e.target.closest('.roster-card')) hideRosterBanner();
    });
    // A popup that is showing follows its card when the page scrolls. One still to
    // come is not cancelled by a scroll: reaching a card often is a scroll, and its
    // last event lands after the pointer has.
    window.addEventListener('scroll', () => {
        const el = document.getElementById('roster-banner');
        if (el && !el.hidden && rosterBannerFor) placeRosterBanner(el, rosterBannerFor);
    }, { passive: true });
}

/** Draws the roster grid for the filters set. */
window.renderFilteredRoster = function() {
    const rosterGrid = document.getElementById('roster-grid') || document.querySelector('.roster-grid');
    if (!rosterGrid) return;
    hideRosterBanner();
    rosterGrid.innerHTML = '';

    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';

    const filteredChars = masterRosterData.filter(char => {
        if (char.published === false) return false;
        if (currentFilters.archetype !== 'All' && char.archetype !== currentFilters.archetype) return false;
        if (currentFilters.eaOnly && !char.isEA) return false;
        if (currentFilters.baseOnly && !char.isBaseOnly) return false;
        // Hidden characters are out unless the toggle lets them in. `isHidden` is absent on
        // an ordinary entry (fetch-registry omits false flags), so this tests truthiness.
        if (!currentFilters.showHidden && char.isHidden) return false;
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

        // Names, addresses and image paths come from site_pages: escaped at every
        // interpolation.

        // WIP is its own corner marker, beside the Early Access star, not part of the
        // name: the name is hidden until hover.
        const iconSrc = window.rosterIconPath((char.cms_config || {}).pageId);

        // The colour goes out as a custom property, not background-color: it is the
        // card's background without an icon, the border with one, and the name slit's
        // fill, and an inline background-color would beat every rule that changes one.
        html += `
            <a href="${window.escapeHtml(rootPath + char.url)}" class="roster-card" data-page-id="${window.escapeHtml((char.cms_config || {}).pageId || '')}" style="--char-color: ${charColor};">
                ${char.isEA ? `<span class="ea-star-indicator" title="Early Access" style="color: ${textColor};">★</span>` : ''}
                ${char.isWip ? `<span class="roster-wip-indicator" title="Work In Progress" aria-label="Work In Progress">🚧</span>` : ''}
                ${char.image ? `<img src="${window.escapeHtml(char.image)}" alt="${window.escapeHtml(char.name)}" class="roster-card-bg-image">` : ''}
                ${iconSrc ? `<img src="${window.escapeHtml(rootPath + iconSrc)}" alt="" aria-hidden="true" class="roster-card-icon" loading="lazy">` : ''}
                <div class="roster-card-text" style="color: ${textColor};">${window.escapeHtml(char.name)}</div>
            </a>
        `;
    });
    rosterGrid.innerHTML = html;
    window.markLoadedRosterIcons(rosterGrid);
    bindRosterBanners(rosterGrid);
};

// Categories with their own Main Dashboard column, so the "Guides & Such" box
// leaves them out. The Others column is sub-grouped by site_pages.category
// (Gamemodes, Servers, Misc). A group added here appears in the column and leaves
// the directory in one move; a category in one list and not the other shows twice.
window.OTHERS_SUBGROUPS = ['Gamemodes', 'Servers', 'Misc'];
// The Tools column, by who a tool is for: Tools for anything general, Creators for
// tools on what people build, Community for tools anyone can just use. They match
// the rows' categories; one the column does not list falls into the directory.
window.TOOLS_SUBGROUPS = ['Tools', 'Creators', 'Community'];

window.OWN_COLUMN_CATEGORIES = [...window.OTHERS_SUBGROUPS, ...window.TOOLS_SUBGROUPS];

/**
 * One or more categories' pages as a column of buttons, the same links the systems
 * directory draws. A category with no pages yet shows a short line, not an empty box.
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

        const populated = groups
            .map(name => ({ name, items: (navData && navData[name]) || [] }))
            .filter(g => g.items.length > 0);

        if (populated.length === 0) {
            container.innerHTML = `<p class="loading-msg loading-msg-md">Nothing here yet.</p>`;
            return;
        }

        // A heading only when there is more than one populated group to tell apart: a lone
        // "Tools" heading in a section titled Tools is noise.
        const showHeadings = populated.length > 1;

        // An empty group draws nothing, not a bare heading. data-href and a delegated
        // listener: the names and addresses come from site_pages.
        container.innerHTML = populated.map(group => {
            const heading = showHeadings
                ? `<h3 class="column-subgroup-title">${window.escapeHtml(group.name)}</h3>`
                : '';

            // No WIP badge in the columns; the sidebar menu, where a reader picks from the full
            // list, still has it.
            const buttons = group.items.map(item => `
                <button class="btn-manga btn-manga-box system-directory-btn" data-href="${window.escapeHtml(rootPath + item.url)}">
                    <div class="btn-manga-content">
                        <span class="btn-manga-text">${window.escapeHtml(item.name)}</span>
                    </div>
                </button>`).join('');

            return `${heading}<div class="system-button-grid system-button-grid-compact">${buttons}</div>`;
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

// The directory's order: Guides first and System Pages last, everything between in
// navigation.json's order (site_pages.sort_order), so a new category needs no code.
window.SYSTEMS_CATEGORY_FIRST = ['Guides'];
window.SYSTEMS_CATEGORY_LAST = ['System Pages'];

/** Category names in the directory's order (SYSTEMS_CATEGORY_FIRST and _LAST). */
window.orderSystemsCategories = function (names) {
    const rank = (name) => {
        const first = window.SYSTEMS_CATEGORY_FIRST.indexOf(name);
        if (first !== -1) return first - 1000;
        const last = window.SYSTEMS_CATEGORY_LAST.indexOf(name);
        if (last !== -1) return last + 1000;
        return 0;
    };
    // Array#sort is stable, so everything unpinned keeps navigation.json's own
    // order relative to its neighbours rather than being shuffled.
    return [...names].sort((a, b) => rank(a) - rank(b));
};

/**
 * Draws the systems directory.
 * @param {string} containerId
 * @param {{compact?: boolean}} [options] compact: two columns, unslanted, for the
 *   home page's narrow column. Opt-in, because the full-width Systems Hub draws it
 *   too.
 */
window.buildSystemsDirectory = async function(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const compact = !!(options && options.compact);
    const gridClass = compact ? 'system-button-grid system-button-grid-compact' : 'system-button-grid';
    const shapeClass = compact ? 'btn-manga-box' : 'btn-manga-slanted';

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        // Category names come from site_pages.category too: escaped like page names.

        let html = `<div class="systems-grid-container${compact ? ' systems-grid-container-compact' : ''}">`;
        // Others and Tools have their own Main Dashboard columns, so they are left out here.
        const categories = window.orderSystemsCategories(
            Object.keys(navData)
                .filter(k => k !== 'Characters' && !window.OWN_COLUMN_CATEGORIES.includes(k)));

        categories.forEach((category) => {
            const items = navData[category];
            html += `
                <div class="system-category-block">
                    <h3 class="sidebar-master-title">${window.escapeHtml(category)}</h3>

                    <div class="${gridClass}">
            `;
            items.forEach(sys => {
                // data-href and a delegated listener: the names and addresses come from site_pages.
                html += `
                    <button class="btn-manga ${shapeClass} system-directory-btn" data-href="${window.escapeHtml(rootPath + sys.url)}">
                        <div class="btn-manga-content">
                            <span class="btn-manga-text">${window.escapeHtml(sys.name)}</span>
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

// Tab groups are registered, not closed over, because a tab can arrive after its
// group is wired (the Ultimate tab, character_modes.js). Calling setupTabs again
// with the longer list extends the group, and the click handler reads the live
// list. Boundness is marked on the button, so a rebuilt strip (admin.html's, per
// revision) gets fresh listeners.
const tabGroupRegistry = new Map();

// The tab in the address: a reader page's main strip writes ?tab=<id> on every
// switch, so Back, a refresh and a shared link reopen it. Replaced, never pushed,
// so Back leaves the page. The first tab writes nothing. Opt-in through `address`:
// the editor's and admin.html's strips are theirs.
const TAB_PARAM = 'tab';
const TAB_FIND_POLL_MS = 100;
const TAB_FIND_MS = 15000;

function writeTabToAddress(group, tabId, byReader) {
    const url = new URL(window.location.href);
    if (tabId === group.ids[0]) url.searchParams.delete(TAB_PARAM);
    else url.searchParams.set(TAB_PARAM, tabId);
    // A reader's own click leaves the section they had jumped to, so a refresh
    // must not send them back to it. A section link's jump clicks the button
    // itself (jumpToAnchor), and the hash it is landing on stays.
    if (byReader) url.hash = '';
    if (url.href !== window.location.href) history.replaceState(history.state, '', url.href);
}

// Polled, like an arriving #sec- link, because a tab can arrive late: Techs is
// un-hidden once the page row says so, and the Ultimate tab is added after the
// modes load. The reader's own click first ends the wait. A tab that never
// shows leaves the page on its first tab.
function openTabFromAddress(group, buttonGroupType) {
    if (group.addressSettled) return;
    group.addressSettled = true;
    const wanted = new URLSearchParams(window.location.search).get(TAB_PARAM);
    if (!wanted || wanted === group.ids[0]) return;

    const started = Date.now();
    const tryOpen = () => {
        if (group.readerChoseTab || Date.now() - started > TAB_FIND_MS) {
            clearInterval(timer);
            return;
        }
        const btn = document.getElementById(`${buttonGroupType}-${wanted}`);
        if (!group.ids.includes(wanted) || !btn || btn.classList.contains('hidden') || !btn.getClientRects().length) return;
        clearInterval(timer);
        btn.click();
    };
    const timer = setInterval(tryOpen, TAB_FIND_POLL_MS);
    tryOpen();
}

/**
 * Wires a tab strip: buttons `<buttonGroupType>-<id>`, panels `<contentPrefix>-<id>`.
 * Calling it again with more ids extends the group. opts.address writes the open
 * tab to ?tab= (reader pages only).
 */
window.setupTabs = function(buttonGroupType, contentPrefix, tabIds, tabLevel = 'minor', opts = {}) {
    const groupKey = `${buttonGroupType}|${contentPrefix}`;

    let group = tabGroupRegistry.get(groupKey);
    if (!group) {
        group = { ids: [] };
        tabGroupRegistry.set(groupKey, group);
    }
    tabIds.forEach(id => { if (!group.ids.includes(id)) group.ids.push(id); });
    // Kept on the group: the Ultimate tab's later registration
    // (js/pages/core/character_modes.js) does not pass it again.
    if (opts.address) group.address = true;

    group.ids.forEach(tabId => {
        const button = document.getElementById(`${buttonGroupType}-${tabId}`);
        if (!button) return;
        if (button.dataset.tabBound === groupKey) return;
        button.dataset.tabBound = groupKey;

        button.addEventListener('click', (event) => {
            if (event.isTrusted) group.readerChoseTab = true;
            if (group.address) writeTabToAddress(group, tabId, event.isTrusted);
            // Read from the group, not this call's tabIds: a later registration may have
            // added more.
            group.ids.forEach(id => {
                const btn = document.getElementById(`${buttonGroupType}-${id}`);
                const content = document.getElementById(`${contentPrefix}-${id}`);

                if (btn) btn.classList.remove('active');
                if (content) content.classList.add('hidden');
            });

            button.classList.add('active');
            const targetContent = document.getElementById(`${contentPrefix}-${tabId}`);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                
                // The contents for the new tab, after a moment, so the panel is showing first.
                if (tabLevel === 'major' && typeof window.refreshTOC === 'function') {
                    setTimeout(window.refreshTOC, 50);
                }
            }
        });
    });

    if (group.address) openTabFromAddress(group, buttonGroupType);
};

// Section anchors: every indexable heading gets a stable id from its own text, so a
// link still points at its section after another is inserted above it. The sweep
// covers every tab, not only the visible one, so a link from Skills to an Overview
// section finds an id before Overview is opened.
const ANCHOR_PREFIX = 'sec-';
// A Combo Card's name is a heading too, and each section's name on a multi-section
// card. A card with no name shows "Combo", which names nothing: marked is-untitled
// and left out.
const ANCHOR_HEADING_SELECTOR =
    '.section-title, .skill-title, .strategy-title, .card-header-title, .wiki-block-heading,'
    + ' .theorybox-title:not(.is-untitled)';
// The two kinds the contents nests under the heading above them.
const ANCHOR_MINOR_CLASSES = ['wiki-block-heading', 'theorybox-title'];

// Breathing room above a heading that has been jumped to. Shared by a jump and
// by the arrival follower below, which have to agree on where "landed" is.
const ANCHOR_SCROLL_OFFSET = 40;

// Format tags out first: the walk behind the picker and the search index reads text
// that still has them.
window.sectionAnchorSlug = function(text) {
    return window.stripStyleShortcodes(text)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

// A heading's label leaves out its controls (a dashboard's "View More" link), but
// not a link the author wrote, nor a character mention's link: "vs. Honored One"
// keeps the name. Shared with the contents, so its label and the slug agree.
function anchorLabel(header) {
    const labelSource = header.cloneNode(true);
    labelSource.querySelectorAll('button, a[class*="btn-"]').forEach(el => el.remove());
    // Shortcodes out too, for a heading swept before the styling pass reached it.
    return window.stripStyleShortcodes(labelSource.textContent).trim()
        || window.stripStyleShortcodes(header.textContent).trim();
}

/** Gives every indexable heading under root (the content area by default) its sec- id. */
window.assignSectionAnchors = function(root) {
    const scope = root
        || document.querySelector('.main-content-area')
        || document.querySelector('main');
    if (!scope) return;

    const headers = scope.querySelectorAll(ANCHOR_HEADING_SELECTOR);
    const used = new Set();
    headers.forEach(h => { if (h.id) used.add(h.id); });

    const generic = window.GENERIC_SECTION_TITLES || [];

    headers.forEach(header => {
        if (header.id) return;

        const label = anchorLabel(header);
        // "Move Overview and Strategy" is above every move's write-up and names nothing;
        // skipped here as in the contents, so it uses up no ids.
        if (generic.includes(label)) return;

        const slug = window.sectionAnchorSlug(label);
        if (!slug) return;

        // Two sections can share a name ("Notes" under two skills): the first keeps the
        // clean id, and the rest are numbered in page order.
        let id = ANCHOR_PREFIX + slug;
        let n = 2;
        while (used.has(id) || document.getElementById(id)) {
            id = `${ANCHOR_PREFIX}${slug}-${n++}`;
        }

        header.id = id;
        used.add(id);
    });
};

// The element a fragment names, or null. Shared by jumpToAnchor and the
// arrival follower, so both resolve a link the same way. Expects ids to have
// been assigned already.
function findAnchorTarget(id) {
    let target = document.getElementById(id);

    // Links copied out of the address bar before anchors became stable carry
    // the old positional form. Recover the slug from it and try the stable id.
    if (!target) {
        const legacy = /^toc-(.+)-\d+$/.exec(id);
        if (legacy) target = document.getElementById(ANCHOR_PREFIX + legacy[1]);
    }
    // And a hand-written `#Triple Drill Tech` is what somebody will type
    // before they discover the picker, so slugify it and try that too.
    if (!target && id.indexOf(ANCHOR_PREFIX) !== 0) {
        const slug = window.sectionAnchorSlug(id);
        if (slug) target = document.getElementById(ANCHOR_PREFIX + slug);
    }
    return target;
}

function anchorIdOf(rawId) {
    return String(rawId == null ? '' : rawId).replace(/^#/, '').trim();
}

// Makes a heading showable where it is: opens every closed accordion above it, and
// switches every Section Box or multi-section card above it to its tab, by
// clicking the tab's own button.
function revealAnchorTarget(target) {
    let node = target.parentElement;
    while (node) {
        if (node.tagName === 'DETAILS') node.open = true;
        if (node.hasAttribute && node.hasAttribute('data-sbox-panel') && !node.classList.contains('is-active')) {
            const box = node.parentElement;
            const idx = node.getAttribute('data-sbox-panel');
            const btn = box && box.querySelector(`:scope > .sbox-tabs > [data-sbox-tab="${CSS.escape(idx)}"]`);
            if (btn) btn.click();
        }
        node = node.parentElement;
    }
}

// Runs `run` once the window stops scrolling: on scrollend where the browser has
// it, after 150ms without a scroll event where it does not, and after 150ms when
// nothing scrolled.
function afterScrollSettles(run) {
    let done = false;
    let timer = null;
    const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('scrollend', finish);
        run();
    };
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(finish, 150); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', finish);
    timer = setTimeout(finish, 150);
}

/**
 * Goes to a fragment's section, switching tab and opening accordions on the way.
 * Returns true or false, never the element: false when the target is not on the
 * page, as for a link into another character state, which is not in the DOM.
 */
window.jumpToAnchor = function(rawId, options) {
    const opts = options || {};
    const id = anchorIdOf(rawId);
    if (!id) return false;

    window.assignSectionAnchors();

    const target = findAnchorTarget(id);
    if (!target) return false;

    // The real tab button, not an unhidden panel, so the strip's own bookkeeping runs
    // as for a reader's click.
    const panel = target.closest('[id^="tab-"]');
    const switchedTab = !!(panel && panel.classList.contains('hidden'));
    if (switchedTab) {
        const btn = document.getElementById(`nav-${panel.id.slice(4)}`);
        if (btn) btn.click();
    }

    // A heading inside a closed accordion, or on a tab of a box that is not
    // showing, is scrolled to correctly and then not there, because the body
    // it lives in has no height.
    revealAnchorTarget(target);

    const scroll = () => {
        const top = target.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top - ANCHOR_SCROLL_OFFSET, behavior: opts.behavior || window.scrollMotion() });

        if (opts.updateHash !== false) {
            history.pushState(null, null, `#${id}`);
        }
        // Marks where the reader landed, once the scroll has stopped: the wipe lasts 0.7s,
        // and a smooth scroll outlasted it.
        afterScrollSettles(() => {
            // The wipe covers the words, wherever they sit in the heading
            // (style/Common.css, .anchor-flash::before).
            const words = document.createRange();
            words.selectNodeContents(target);
            const wordsBox = words.getBoundingClientRect();
            target.style.setProperty('--flash-left', `${wordsBox.left - target.getBoundingClientRect().left}px`);
            target.style.setProperty('--flash-width', `${wordsBox.width}px`);
            target.classList.remove('anchor-flash');
            void target.offsetWidth; // a second jump to the same heading plays it again
            target.classList.add('anchor-flash');
            setTimeout(() => target.classList.remove('anchor-flash'), 1600);
        });
    };

    // The panel has to actually be visible before its position can be measured.
    if (switchedTab) setTimeout(scroll, 60);
    else scroll();

    return true;
};

/** Builds the table of contents for the active tab, or for the content area. */
window.refreshTOC = function() {
    const tocContainer = document.getElementById('dynamic-toc');
    if (!tocContainer) return;

    // The active tab on a character page, or the content area. Scoped to
    // .main-content-area, because on admin.html it sits deep inside a differently
    // classed <main>.
    let targetArea = document.querySelector('.main-content-area > div[id^="tab-"]:not(.hidden)');

    if (!targetArea) {
        targetArea = document.querySelector('.main-content-area');
    }

    if (!targetArea) {
        tocContainer.innerHTML = '<li><p class="loading-msg loading-msg-toc">Nothing to index here.</p></li>';
        return;
    }

    // The anchor sweep's own selector, so the contents never list a heading with no id.
    const headers = targetArea.querySelectorAll(ANCHOR_HEADING_SELECTOR);

    if (headers.length === 0) {
        tocContainer.innerHTML = '<li><p class="loading-msg loading-msg-toc">Nothing to index here.</p></li>';
        return;
    }

    // Labels are read with textContent and written with innerHTML, so they are escaped:
    // a heading whose text is "<img src=x onerror=...>" is inert there and would be
    // live here.

    let tocStructure = [];
    let currentGroup = null;

    window.assignSectionAnchors();

    headers.forEach((header) => {
        if (header.textContent.trim() === 'Move Overview and Strategy') return;
        if (!header.id) return;
        // A section the page has hidden (.hidden, or the hidden attribute) is not listed: a
        // link to it scrolls nowhere. A closed accordion or a box's other tab is opened by
        // the jump, so it stays.
        const hiddenBy = header.closest('.hidden, [hidden]');
        if (hiddenBy && targetArea.contains(hiddenBy)) return;

        const isMinor = ANCHOR_MINOR_CLASSES.some(c => header.classList.contains(c));
        const itemData = { id: header.id, text: anchorLabel(header) };

        if (!isMinor) {
            currentGroup = { ...itemData, children: [] };
            tocStructure.push(currentGroup);
        } else {
            // Into the current major group, or alone as an orphan.
            if (currentGroup) {
                currentGroup.children.push(itemData);
            } else {
                tocStructure.push({ ...itemData, children: [], isOrphan: true });
            }
        }
    });

    let tocHtml = '';
    tocStructure.forEach(group => {
        if (group.isOrphan) {
            tocHtml += `
                <li>
                    <a href="#${window.escapeHtml(group.id)}" class="btn-nav toc-link-minor" onclick="smoothScroll(event, '${window.escapeHtml(group.id)}')">
                        <span class="toc-link-text">${window.escapeHtml(group.text)}</span>
                    </a>
                </li>
            `;
        } else {
            if (group.children.length > 0) {
                tocHtml += `
                    <li>
                        <div class="toc-group-row">
                            <a href="#${window.escapeHtml(group.id)}" class="btn-nav toc-link-major-toggle" onclick="smoothScroll(event, '${window.escapeHtml(group.id)}')">
                                <span class="toc-link-text">${window.escapeHtml(group.text)}</span>
                            </a>
                            <button type="button" class="toc-toggle-btn" aria-expanded="true"
                                    aria-label="Toggle subsections of ${window.escapeHtml(group.text)}">
                                <span aria-hidden="true">▼</span>
                            </button>
                        </div>
                        <ul class="toc-sublist">
                `;

                group.children.forEach(child => {
                    tocHtml += `
                        <li>
                            <a href="#${window.escapeHtml(child.id)}" class="btn-nav toc-link-minor" onclick="smoothScroll(event, '${window.escapeHtml(child.id)}')">
                                <span class="toc-link-text">${window.escapeHtml(child.text)}</span>
                            </a>
                        </li>
                    `;
                });

                tocHtml += `</ul></li>`;
            } else {
                tocHtml += `
                    <li>
                        <a href="#${window.escapeHtml(group.id)}" class="btn-nav toc-link-major" onclick="smoothScroll(event, '${window.escapeHtml(group.id)}')">
                            <span class="toc-link-text">${window.escapeHtml(group.text)}</span>
                        </a>
                    </li>
                `;
            }
        }
    });
    
    tocContainer.innerHTML = tocHtml;

    // Delegated, keeping aria-expanded in step with the caret.
    tocContainer.querySelectorAll('.toc-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sublist = btn.parentElement && btn.parentElement.nextElementSibling;
            if (!sublist) return;
            const open = sublist.classList.toggle('hidden') === false;
            btn.setAttribute('aria-expanded', String(open));
        });
    });
};

// A contents entry goes through jumpToAnchor, so it behaves like an in-page link.
window.smoothScroll = function(e, targetId) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    window.jumpToAnchor(targetId);
};

// Arriving by link (#sec-... in the address). Look, land, then follow: poll until
// the target exists (content is fetched after boot, at different times per page
// kind), jump, then keep it at its mark while content above it grows, moving
// instantly, never smoothly. The reader's own scroll, key, click or touch ends it:
// pulling someone back after they started reading is worse than landing short.
const HASH_POLL_MS = 100;
const HASH_FIND_MS = 15000;
const HASH_HOLD_MS = 10000;
const HASH_READER_INPUT = ['wheel', 'touchstart', 'keydown', 'mousedown'];

function resolveInitialHash() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    // A reply link belongs to js/pages/community/discussions.js, which centres the reply
    // rather than topping it. Following it here would fight that scroll.
    if (hash.startsWith('#post-')) return;

    const id = anchorIdOf(hash);
    const started = Date.now();
    let target = null;
    let landedAt = 0;
    let ownScrollUntil = 0;
    let timer = null;

    // Where the page has to be for the target to sit at the offset, clamped to
    // what the document can scroll to. A heading near the end can never reach
    // the top, and chasing that would read as the reader having moved.
    const wanted = () => {
        const top = target.getBoundingClientRect().top + window.scrollY - ANCHOR_SCROLL_OFFSET;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        return Math.max(0, Math.min(top, max));
    };
    // False while the target sits in a hidden tab or a closed accordion, where
    // its position reads as 0 and following it would scroll to nowhere.
    const laidOut = () => target.isConnected && target.getClientRects().length > 0;

    const release = () => {
        clearInterval(timer);
        HASH_READER_INPUT.forEach(type => window.removeEventListener(type, release, true));
        window.removeEventListener('scroll', onScroll);
    };

    // A scrollbar drag fires none of the input events above, so a scroll that
    // leaves the target off its mark, and did not come from here, is the
    // reader too. Scroll anchoring moves the page WITH the target, so it never
    // trips this.
    function onScroll() {
        if (performance.now() < ownScrollUntil || !target || !laidOut()) return;
        if (Math.abs(window.scrollY - wanted()) > 2) release();
    }

    const tick = () => {
        const now = Date.now();
        if (!target) {
            if (now - started > HASH_FIND_MS) { release(); return; }
            // jumpToAnchor switches tab and opens accordions; never rewrite
            // the hash we are already sitting on.
            if (!window.jumpToAnchor(hash, { updateHash: false, behavior: 'auto' })) return;
            target = findAnchorTarget(id);
            landedAt = now;
            // Covers jumpToAnchor's own scroll, which waits 60ms after a tab
            // switch so the panel can be measured.
            ownScrollUntil = performance.now() + 300;
            window.__anchorHashResolved = true;
            window.addEventListener('scroll', onScroll, { passive: true });
            return;
        }
        if (now - landedAt > HASH_HOLD_MS) { release(); return; }
        // A tab that re-renders replaces its headings with new elements under
        // the same ids, so follow the id rather than the node.
        if (!target.isConnected) {
            window.assignSectionAnchors();
            target = findAnchorTarget(id);
            if (!target) { release(); return; }
            // The repaint put its box back on its first tab.
            revealAnchorTarget(target);
        }
        if (!laidOut()) return;
        const y = wanted();
        if (Math.abs(window.scrollY - y) > 2) {
            ownScrollUntil = performance.now() + 200;
            window.scrollTo({ top: y, behavior: 'auto' });
        }
    };

    HASH_READER_INPUT.forEach(type => window.addEventListener(type, release, { capture: true, passive: true }));
    timer = setInterval(tick, HASH_POLL_MS);
    tick();
}

document.addEventListener('DOMContentLoaded', resolveInitialHash);

// A second link to the same page changes only the hash, which fires no
// navigation - so without this the second link does nothing.
window.addEventListener('hashchange', () => {
    window.jumpToAnchor(window.location.hash, { updateHash: false });
});

// Contributor-written in-page links, marked by format_tags.js. Delegated on
// the class, so the contents' links, which call smoothScroll, are not handled twice.
document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a.wiki-link-jump');
    if (!link) return;
    e.preventDefault();
    if (typeof window.hideTooltip === 'function') window.hideTooltip();
    window.jumpToAnchor(link.getAttribute('href'));
});

// Where a jump link goes, shown on hover. Read on hover, because the ids are
// minted after the render and minted again when a tab redraws. The tab is named
// only when the section is on another one.
function jumpLinkDestination(link) {
    const target = findAnchorTarget(anchorIdOf(link.getAttribute('href')));
    if (!target) return '';
    const section = anchorLabel(target);
    const there = target.closest('[id^="tab-"]');
    const tabBtn = there && there !== link.closest('[id^="tab-"]')
        ? document.getElementById(`nav-${there.id.slice('tab-'.length)}`)
        : null;
    const tab = tabBtn ? tabBtn.textContent.trim() : '';
    return tab ? `${tab} › ${section}` : section;
}

const jumpLinkAt = (node) => (node && node.closest ? node.closest('a.wiki-link-jump') : null);

document.addEventListener('mouseover', (e) => {
    const link = jumpLinkAt(e.target);
    if (!link || link === jumpLinkAt(e.relatedTarget) || typeof window.showTooltipAt !== 'function') return;
    const where = jumpLinkDestination(link);
    if (where) window.showTooltipAt(window.escapeHtml(where), e.clientX, e.clientY);
});

document.addEventListener('mousemove', (e) => {
    if (jumpLinkAt(e.target) && typeof window.moveTooltipTo === 'function') window.moveTooltipTo(e.clientX, e.clientY);
});

document.addEventListener('mouseout', (e) => {
    const link = jumpLinkAt(e.target);
    if (!link || link === jumpLinkAt(e.relatedTarget) || typeof window.hideTooltip !== 'function') return;
    window.hideTooltip();
});

/** Adds an alert box (wip, ea and the like) to a container. */
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

/** The page's alerts from its navigation.json flags (WIP, Early Access, missing media). */
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
        for (const items of Object.values(navData)) {
            const found = items.find(i => i.cms_config && i.cms_config.pageId === pageId);
            if (found) { targetEntry = found; break; }
        }
        
        if (!targetEntry) return;

        if (targetEntry.isWip) window.showWikiAlert('character-alerts-container', 'wip', 'This page is actively being drafted. Data may be incomplete or subject to change.');
        if (targetEntry.isEA) window.showWikiAlert('character-alerts-container', 'ea', 'This character is currently in Early Access. Strategies and frame data will likely change constantly.');
        if (targetEntry.isMissingMedia) window.showWikiAlert('character-alerts-container', 'medialess', 'Some videos or images are missing from this page. We are working on recording them!');
    } catch (e) {
        console.error("Failed to load page alerts:", e);
    }
};

// The footer, added by script rather than copied into every page. The .site-layout
// guard keeps it off edit.html, admin.html and owner.html, whose editor.css sets
// body { overflow: hidden }. The skip link is added here too, so no page lacks it.
document.addEventListener('DOMContentLoaded', () => {
    if (window.initSkipLink) window.initSkipLink();
});

/** The sitewide footer, on every page with .site-layout. */
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
            <a href="${rootPath}terms.html" class="site-footer-link">Terms of Service</a>
            <!-- Two licences now: MIT for the code, CC BY-NC-SA 4.0 for the
                 content. CONTENT-LICENSE.md is the one a reader wants, and it
                 states both and links to LICENSE, so the footer carries one
                 link rather than two. GitHub's view of it, because the site
                 serves the file as raw Markdown (v1.0 Part 3). -->
            <a href="https://github.com/Deptr-softwares/dogslamloop-wiki/blob/main/CONTENT-LICENSE.md" target="_blank" rel="noopener" class="site-footer-link">Licence</a>
            <span class="site-footer-note">A fan-made wiki. Not affiliated with the game's developers.</span>
        </div>
    `;
    document.body.appendChild(footer);
};

// The footer fires itself on DOMContentLoaded, as site_utils.js's listener does,
// so it lands everywhere without a line on every page.
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.buildSiteFooter === 'function') window.buildSiteFooter();
});
