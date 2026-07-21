/**
 * Dogslamloop Wiki - Page Builder & Navigation Module
 * V0.4 DSL Standardized Engine
 */

// ==========================================
// 1. SIDEBAR & NAVIGATION BUILDERS
// ==========================================

window.initSidebarToggle = function() {
    const toggleBtn = document.querySelector('.sidebar-toggle-btn');
    const sidebar = document.getElementById('master-sidebar');
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => { 
            // The True Despawn Toggle
            sidebar.classList.toggle('collapsed'); 
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

        let html = '';
        for (const [category, items] of Object.entries(navData)) {
            html += `<div class="sidebar-group-wrapper" style="margin-bottom: 0.75rem;">`;
            html += `<div class="sidebar-nav-title" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0;" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        ${category} <span style="font-size: 0.5rem; color: var(--text-muted);">▼</span>
                     </div>`;
            html += `<ul class="toc-list hidden" style="margin-top: 0.5rem;">`;

            items.forEach(item => {
                let badge = '';
                if (item.isWip) badge = ` <span class="update-badge badge-general" style="background-color: var(--accent-yellow); color: #000; margin-left: 0.5rem;">WIP</span>`;
                if (item.isEA) badge = ` <span class="update-badge badge-general" style="background-color: hsl(28, 99%, 53%); margin-left: 0.5rem;">EA</span>`;

                let colorStyle = '';
                if (category === 'Characters' && window.CHARACTER_COLORS && window.CHARACTER_COLORS[item.name]) {
                    colorStyle = `color: ${window.CHARACTER_COLORS[item.name]}; font-weight: bold;`;
                }

                // FIXED: Explicitly removed text-decoration to kill the underline
                html += `
                    <li>
                        <a href="${rootPath}${item.url}" class="btn-nav" style="text-decoration: none !important;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; ${colorStyle}">${item.name}</span>
                            ${badge}
                        </a>
                    </li>
                `;
            });
            html += `</ul></div>`;
        }
        container.innerHTML = html;
    } catch (e) {
        console.error("Sidebar Menu Error:", e);
        container.innerHTML = `<p class="loading-msg" style="color: #ef4444;">Menu unavailable.</p>`;
    }
};

// Universal Tab Editor Buttons (Handles Desktop Sidebar & Mobile Nav)
window.initTabEditorButtons = function(pageId, pageType = 'character') {
    const sidebarBtn = document.getElementById('btn-edit-current-tab');
    const mobileBtn = document.getElementById('btn-edit-current-tab-mobile');
    
    if (!pageId) return;

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
        sidebarBtn.style.display = 'flex'; 
        sidebarBtn.onclick = handleEditClick;

        const parentDiv = sidebarBtn.parentNode;
        
        // Restructure the parent container so the title sits on top of the buttons
        parentDiv.style.flexDirection = 'column';
        parentDiv.style.alignItems = 'stretch';
        parentDiv.style.gap = '0.75rem';

        let btnGroup = document.getElementById('sidebar-btn-group');
        if (!btnGroup) {
            btnGroup = document.createElement('div');
            btnGroup.id = 'sidebar-btn-group';
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '0.5rem';
            btnGroup.style.width = '100%';

            // Move the Edit button into the new wrapper
            parentDiv.insertBefore(btnGroup, sidebarBtn);
            btnGroup.appendChild(sidebarBtn);

            // Create the History button
            const histBtn = document.createElement('button');
            histBtn.id = 'btn-history-current-tab';
            histBtn.className = 'btn-sys btn-sys-regular';
            histBtn.style.cssText = sidebarBtn.style.cssText;
            histBtn.style.flex = '1'; // Forces buttons to share width equally
            sidebarBtn.style.flex = '1';
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
            mobBtnGroup.style.display = 'flex';
            mobBtnGroup.style.gap = '0.5rem';

            parentDiv.insertBefore(mobBtnGroup, mobileBtn);
            mobBtnGroup.appendChild(mobileBtn);

            const histBtnMob = document.createElement('button');
            histBtnMob.id = 'btn-history-current-tab-mobile';
            histBtnMob.className = 'btn-sys btn-sys-regular is-active';
            histBtnMob.style.cssText = mobileBtn.style.cssText;
            histBtnMob.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> HISTORY`;
            histBtnMob.onclick = handleHistoryClick;
            
            mobBtnGroup.insertBefore(histBtnMob, mobileBtn);
        }
    }
};

window.initSidebarEditButton = async function(pageId = null, pageType = 'character') {
    let container = document.getElementById('sidebar-dynamic-dock') 
                 || document.getElementById('auth-dock-container')
                 || document.getElementById('auth-btn-container');
                 
    if (!container) return;

    let existingKofi = container.querySelector('.kofi-btn-wrapper, a[href*="Ko-fi"]');

    // --- AUTHENTICATION & SIDEBAR DOCK ---
    let userRole = 'viewer'; let username = 'LOGIN'; let unreadCount = 0;
    if (window.supabaseClient) {
        try {
            // Fetch the FULL session so we can pass it to our universal name extractor
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (session && session.user) {
                // Uses the unified Site Utils function to grab your exact Profile Name
                username = typeof window.getDisplayName === 'function' ? window.getDisplayName(session) : session.user.email.split('@')[0];
                
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', session.user.id).single();
                if (roleData) userRole = roleData.role;
                
                const { count } = await window.supabaseClient.from('system_inbox').select('*', { count: 'exact', head: true }).eq('recipient_id', session.user.id).eq('is_read', false);
                unreadCount = count || 0;
            }
        } catch (e) { console.warn("Auth sync skipped."); }
    }

    // --- V0.4 FULL ROLE ICON SUITE (2.5px Geometric SVG) ---
    // 1. Guest / Logged Out (Standard User)
    const svgUser = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
    // 2. Authenticated Normal User (User + Checkmark)
    const svgAuth = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>`;
    // 3. Reviewer (The Eye / Observer)
    const svgReviewer = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    // 4. Trusted Editor (The Pen / Signature)
    const svgTrusted = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
    // 5. Admin (The Crown)
    const svgAdmin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M2 9l4.5 6L9 7l5 10 3.5-8L22 9"></path><path d="M2 9h20v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"></path></svg>`;
    
    // Core App Icons
    const svgGear = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    const svgMail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;

    // --- ASSIGN ROLES & COLORS ---
    let loginIcon = svgUser; 
    let dynamicColorClass = "btn-sys-regular"; 

    if (username !== 'LOGIN') {
        const role = userRole.toLowerCase();
        if (role === 'admin') { loginIcon = svgAdmin; dynamicColorClass = "btn-sys-purple"; } 
        else if (role === 'trusted_editor') { loginIcon = svgTrusted; dynamicColorClass = "btn-sys-yellow"; }
        else if (role === 'reviewer' || role === 'contributor') { loginIcon = svgReviewer; dynamicColorClass = "btn-sys-blue"; } 
        else { loginIcon = svgAuth; dynamicColorClass = "btn-sys-green"; }
    }

    // --- CRITICAL DOM STRUCTURE FIX ---
    // Uses .btn-manga-icon and .btn-manga-text span wrappers so Layout.css knows how to collapse it natively
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
    let html = '';
    const btnStyle = "width: 100%; padding: 0.75rem; font-size: 0.85rem; display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; white-space: nowrap;";
    const iconStyle = "display: flex; align-items: center; justify-content: center;";
    
    // 1. OVERSEER PANEL (Pathing Fixed)
    const elevatedRoles = ['admin', 'reviewer', 'contributor', 'trusted_editor'];
    if (elevatedRoles.includes(userRole.toLowerCase())) {
        html += `
            <button id="dock-btn-edit" class="btn-sys btn-sys-purple" style="${btnStyle}" onclick="window.location.href='${rootPath}admin.html'">
                <span class="btn-manga-icon" style="${iconStyle}">${svgGear}</span>
                <span class="btn-manga-text" style="overflow: hidden; text-overflow: ellipsis;">OVERSEER</span>
            </button>`;
    }

    // 2. SYSTEM INBOX
    if (username !== 'LOGIN') {
        let badgeHtml = unreadCount > 0 ? `<div class="dock-badge" style="position: absolute; top: -4px; right: -4px;"></div>` : ``;
        html += `
            <button id="dock-btn-inbox" class="btn-sys btn-sys-blue" style="${btnStyle} position: relative;">
                <span class="btn-manga-icon" style="${iconStyle}">${svgMail}</span>
                <span class="btn-manga-text" style="overflow: hidden; text-overflow: ellipsis;">INBOX</span>
                ${badgeHtml}
            </button>`;
    }

    // 3. PROFILE / LOGIN
    html += `
        <button id="dock-btn-auth" class="btn-sys ${dynamicColorClass}" style="${btnStyle}">
            <span class="btn-manga-icon" style="${iconStyle}">${loginIcon}</span>
            <span class="btn-manga-text" style="overflow: hidden; text-overflow: ellipsis;">${username.toUpperCase()}</span>
        </button>`;
    
    container.innerHTML = html;

    // --- RESTORE KO-FI ---
    if (existingKofi) {
        let targetNode = existingKofi.tagName === 'A' ? existingKofi : existingKofi.querySelector('a');
        if (targetNode) {
            targetNode.className = 'btn-sys btn-sys-yellow';
            targetNode.style.cssText = btnStyle + ' text-decoration: none;';
            if (!targetNode.querySelector('.btn-manga-icon')) {
                const svgCoffee = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" style="width: 1.2rem; height: 1.2rem;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
                targetNode.innerHTML = `
                    <span class="btn-manga-icon" style="${iconStyle}">${svgCoffee}</span>
                    <span class="kofi-text btn-manga-text" style="font-family: 'CC-Wild-Words', sans-serif;">SUPPORT KO-FI</span>
                `;
            }
        }
        container.appendChild(existingKofi);
    }
    
    // Bind click events (unchanged logic)
    const btnAuth = document.getElementById('dock-btn-auth');
    if (btnAuth && typeof window.openAuthModal === 'function') btnAuth.onclick = window.openAuthModal;

    const btnInbox = document.getElementById('dock-btn-inbox');
    if (btnInbox) {
        btnInbox.onclick = async () => { 
            const modalHtml = `
                <div id="site-notification-modal" class="modal-overlay" style="display: flex;">
                    <div class="modal-box modal-md accent-blue">
                        <div class="modal-header"><h3>SYSTEM INBOX</h3></div>
                        <div class="modal-body" id="inbox-dynamic-body"><p class='loading-msg'>Fetching messages...</p></div>
                        <div class="modal-footer">
                            <button id="close-inbox-btn" class="btn-sys btn-sys-regular">CLOSE</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            document.getElementById('close-inbox-btn').onclick = () => document.getElementById('site-notification-modal').remove();

            if (window.supabaseClient) {
                const { data: { user } } = await window.supabaseClient.auth.getUser();
                if (user) {
                    const { data: messages } = await window.supabaseClient.from('system_inbox').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false });
                    if (!messages || messages.length === 0) {
                        document.getElementById('inbox-dynamic-body').innerHTML = "<p class='loading-msg'>No new messages.</p>";
                    } else {
                        let msgsHtml = `<div class="space-y-2">`;
                        messages.forEach(m => {
                            const bg = m.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.1)';
                            const border = m.is_read ? 'var(--border-color)' : 'var(--accent-blue)';
                            msgsHtml += `
                                <div style="background: ${bg}; border: 1px solid ${border}; padding: 0.75rem; border-radius: 4px;">
                                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem;">${new Date(m.created_at).toLocaleDateString()}</div>
                                    <div style="font-size: 0.85rem; color: var(--text-white);">${m.message}</div>
                                </div>
                            `;
                        });
                        msgsHtml += `</div>`;
                        document.getElementById('inbox-dynamic-body').innerHTML = msgsHtml;
                        await window.supabaseClient.from('system_inbox').update({ is_read: true }).eq('recipient_id', user.id);
                        const badge = document.querySelector('#dock-btn-inbox .dock-badge');
                        if (badge) badge.remove();
                    }
                }
            }
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
        <div class="filter-group"><span class="filter-label">Archetype</span><select id="filter-archetype" class="filter-select">${archetypes.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
        <div class="filter-group"><span class="filter-label">Tier</span><select id="filter-tier" class="filter-select">${tiers.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
        <div class="filter-group" style="margin-left: auto;">
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
        rosterGrid.innerHTML = `<div class="empty-tab-msg" style="width: 100%; text-align: center; color: var(--text-muted); font-family: var(--text-mono);">No characters found matching these filters.</div>`;
        return;
    }

    let html = '';
    filteredChars.forEach(char => {
        let charColor = 'var(--bg-main)';
        let textColor = 'var(--text-white)';
        let textOutline = 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 2px 2px 0px rgba(0,0,0,0.8);';

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[char.name]) {
            charColor = window.CHARACTER_COLORS[char.name];
        }

        if (char.isBaseOnly) {
            textColor = '#a1a1aa'; 
        }

        // --- Prepend the rootPath to the href ---
        html += `
            <a href="${rootPath}${char.url}" class="roster-card" style="background-color: ${charColor};">
                ${char.isEA ? `<span class="ea-star-indicator" title="Early Access" style="color: ${textColor}; ${textOutline}">★</span>` : ''}
                ${char.image ? `<img src="${char.image}" alt="${char.name}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; opacity: 0.5; filter: grayscale(100%); transition: opacity 0.2s;">` : ''}
                <div class="roster-card-text" style="position: relative; z-index: 2; width: 100%; white-space: normal; padding: 0 0.25rem; color: ${textColor}; ${textOutline} font-weight: bold;">
                    ${char.name}
                    ${char.isWip ? `<br><span style="font-size: 0.55rem; font-family: var(--text-mono);">(WIP)</span>` : ''}
                </div>
            </a>
        `;
    });
    rosterGrid.innerHTML = html;
};

window.buildSystemsDirectory = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        // --- Increased gap between categories for breathing room ---
        let html = '<div class="systems-grid-container" style="display: flex; flex-direction: column; gap: 2.5rem;">';
        const categories = Object.keys(navData).filter(k => k !== 'Characters');
        
        categories.forEach((category) => {
            const items = navData[category];
            html += `
                <div class="system-category-block">
                    <h3 class="sidebar-master-title" style="margin-top: 0; margin-bottom: 1.25rem; border-bottom: 2px dashed var(--border-color);">${category}</h3>

                    <div class="system-button-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.25rem;">
            `;
            items.forEach(sys => {
                // Swapped flat gray boxes for slanted interactive manga buttons natively inheriting the blue hover glow
                html += `
                    <button class="btn-manga btn-manga-slanted" style="width: 100%; padding: 0.6rem 1rem;" onclick="window.location.href='${rootPath}${sys.url}'">
                        <div class="btn-manga-content" style="justify-content: center;">
                            <span class="btn-manga-text" style="font-size: 0.85rem; letter-spacing: 1px;">${sys.name}</span>
                        </div>
                    </button>
                `;
            });
            html += `</div></div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch(e) {
        console.error("Systems Grid Error:", e);
    }
};

// ==========================================
// 3. UTILITIES & CHARACTER PAGE ENGINES
// ==========================================

// Restored: Tab switching logic for the Character Pages
window.setupTabs = function(buttonGroupType, contentPrefix, tabIds, tabLevel = 'minor') {
    tabIds.forEach(tabId => {
        const button = document.getElementById(`${buttonGroupType}-${tabId}`);
        if (!button) return;

        button.addEventListener('click', () => {
            // Hide all tabs
            tabIds.forEach(id => {
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
    let targetArea = document.querySelector('main > div[id^="tab-"]:not(.hidden)');
    
    if (!targetArea) {
        targetArea = document.querySelector('.main-content-area');
    }

    if (!targetArea) {
        tocContainer.innerHTML = '<li><p class="loading-msg" style="padding: 0.25rem 0.75rem;">Nothing to index here.</p></li>';
        return;
    }

    // 2. The Expansive Header System
    // Added '.section-title' so it can index Dashboard headers!
    const headers = targetArea.querySelectorAll('.section-title, .skill-title, .strategy-title, .card-header-title, .wiki-block-heading');
    
    if (headers.length === 0) {
        tocContainer.innerHTML = '<li><p class="loading-msg" style="padding: 0.25rem 0.75rem;">Nothing to index here.</p></li>';
        return;
    }

    // 3. Build the Hierarchical Tree
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
        const itemData = { id: header.id, text: header.textContent.trim() };

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
                    <a href="#${group.id}" class="btn-nav" style="text-decoration: none !important; padding-left: 1.5rem; font-size: 0.7rem; color: var(--text-muted); opacity: 0.7;" onclick="smoothScroll(event, '${group.id}')">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${group.text}</span>
                    </a>
                </li>
            `;
        } else {
            if (group.children.length > 0) {
                // Parent Header WITH a Toggle Button
                tocHtml += `
                    <li>
                        <div style="display: flex; position: relative;">
                            <a href="#${group.id}" class="btn-nav" style="text-decoration: none !important; font-size: 0.75rem; color: var(--text-white); padding-right: 2rem;" onclick="smoothScroll(event, '${group.id}')">
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${group.text}</span>
                            </a>
                            <button style="position: absolute; right: 0; top: 0; bottom: 1px; background: none; border: none; color: var(--text-muted); padding: 0 0.5rem; cursor: pointer; font-size: 0.5rem; z-index: 2; transition: color 0.2s;" onmouseover="this.style.color='var(--text-white)'" onmouseout="this.style.color='var(--text-muted)'" onclick="this.parentElement.nextElementSibling.classList.toggle('hidden')">
                                ▼
                            </button>
                        </div>
                        <ul class="toc-sublist" style="list-style: none; padding: 0; margin: 0;">
                `;
                
                // Render the Nested Children
                group.children.forEach(child => {
                    tocHtml += `
                        <li>
                            <a href="#${child.id}" class="btn-nav" style="text-decoration: none !important; padding-left: 1.5rem; font-size: 0.7rem; color: var(--text-muted); opacity: 0.7;" onclick="smoothScroll(event, '${child.id}')">
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${child.text}</span>
                            </a>
                        </li>
                    `;
                });
                
                tocHtml += `</ul></li>`;
            } else {
                // Standard Parent Header (No Children, No Toggle Arrow)
                tocHtml += `
                    <li>
                        <a href="#${group.id}" class="btn-nav" style="text-decoration: none !important; font-size: 0.75rem; color: var(--text-white);" onclick="smoothScroll(event, '${group.id}')">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${group.text}</span>
                        </a>
                    </li>
                `;
            }
        }
    });
    
    tocContainer.innerHTML = tocHtml;
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
            const found = items.find(i => i.id === pageId);
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