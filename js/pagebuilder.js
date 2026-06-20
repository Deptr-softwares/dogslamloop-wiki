/**
 * Dogslamloop Wiki - Page Builder & Navigation Module
 */

function setupTabs(buttonGroupType, contentPrefix, tabIds, tabLevel = 'minor') {
    tabIds.forEach(tabId => {
        const button = document.getElementById(`${buttonGroupType}-${tabId}`);
        if (!button) return;

        button.addEventListener('click', () => {
            tabIds.forEach(id => {
                const btn = document.getElementById(`${buttonGroupType}-${id}`);
                const content = document.getElementById(`${contentPrefix}-${id}`);
                
                if (btn) btn.classList.remove('active');
                if (content) {
                    content.classList.add('hidden');
                    content.classList.remove('space-y-8');
                }
            });

            button.classList.add('active');
            
            const targetContent = document.getElementById(`${contentPrefix}-${tabId}`);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                if (buttonGroupType === 'nav' && tabId === 'skills') {
                    targetContent.classList.add('space-y-8');
                }

                if (tabLevel === 'major' && typeof refreshTOC === 'function') {
                    refreshTOC();
                }
            }
        });
    });
}

function generateTOC(container) {
    const tocContainer = document.getElementById('dynamic-toc');
    if (!tocContainer || !container) return;

    const headings = container.querySelectorAll('h2, h3, .matchup-card-title, .counterplay-card-title, .character-title, .strategy-title');
    
    if (headings.length === 0) {
        tocContainer.innerHTML = '<li><p class="toc-empty-msg">Loading or empty...</p></li>';
        return;
    }

    tocContainer.innerHTML = '';
    const slugify = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    headings.forEach(heading => {
        const headingText = heading.textContent.replace('▼', '').trim();
        if (!headingText) return;
        if (headingText === "Move Overview and Strategy" || headingText === "Move Overview & Strategy") return; 

        if (!heading.id) {
            if (heading.classList.contains('matchup-card-title')) heading.id = 'matchup-' + slugify(headingText);
            else if (heading.classList.contains('counterplay-card-title')) heading.id = 'counterplay-' + slugify(headingText);
            else heading.id = slugify(headingText);
        }

        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${heading.id}`;
        a.className = 'toc-btn';
        a.textContent = headingText;
        
        li.appendChild(a);
        tocContainer.appendChild(li);
    });
}

function refreshTOC() {
    const tocContainer = document.getElementById('dynamic-toc');
    if (!tocContainer) return;

    const activeTab = document.querySelector('.main-content-area > .tab-content:not(.hidden), .main-content-area > .vessel-content:not(.hidden)');
    
    if (activeTab) {
        generateTOC(activeTab);
    } else {
        const mainArea = document.querySelector('.main-content-area');
        if (mainArea) generateTOC(mainArea);
    }
}

function initDynamicTOC() {
    if (!document.getElementById('dynamic-toc')) return;

    const observer = new MutationObserver(refreshTOC);
    const mainArea = document.querySelector('.main-content-area');
    if (mainArea) {
        observer.observe(mainArea, { childList: true, subtree: true });
    }

    refreshTOC(); 
}

let masterRosterData = [];
let currentFilters = {
    archetype: 'All',
    tier: 'All',
    eaOnly: false,
    baseOnly: false,
    hideWip: false
};

async function initRosterFilters() {
    const filterContainer = document.getElementById('roster-filter-bar');
    if (!filterContainer) return;

    if (masterRosterData.length === 0) {
        const navData = await window.fetchNavigationData();
        masterRosterData = navData["Characters"];
    }

    const archetypes = ['All', ...new Set(masterRosterData.map(c => c.archetype).filter(a => a && a !== "TBD"))];
    const tiers = ['All', ...new Set(masterRosterData.map(c => c.tier).filter(t => t && t !== "TBD"))];

    filterContainer.innerHTML = `
        <div class="filter-group">
            <span class="filter-label">Archetype</span>
            <select id="filter-archetype" class="filter-select">
                ${archetypes.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select>
        </div>
        <div class="filter-group">
            <span class="filter-label">Tier</span>
            <select id="filter-tier" class="filter-select">
                ${tiers.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
        </div>
        <div class="filter-group" style="margin-left: auto;">
            <button id="filter-ea" class="filter-toggle">EA Only</button>
            <button id="filter-base" class="filter-toggle">Base Only</button>
            <button id="filter-wip" class="filter-toggle">Hide WIP Entries</button>
        </div>
    `;

    document.getElementById('filter-archetype').addEventListener('change', (e) => {
        currentFilters.archetype = e.target.value;
        renderFilteredRoster();
    });

    document.getElementById('filter-tier').addEventListener('change', (e) => {
        currentFilters.tier = e.target.value;
        renderFilteredRoster();
    });

    const setupToggle = (btnId, filterKey) => {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', () => {
            currentFilters[filterKey] = !currentFilters[filterKey];
            btn.classList.toggle('active', currentFilters[filterKey]);
            renderFilteredRoster();
        });
    };

    setupToggle('filter-ea', 'eaOnly');
    setupToggle('filter-base', 'baseOnly');
    setupToggle('filter-wip', 'hideWip');

    renderFilteredRoster();
}

function renderFilteredRoster() {
    const rosterGrid = document.querySelector('.roster-grid');
    if (!rosterGrid) return;

    rosterGrid.innerHTML = '';

    const filteredChars = masterRosterData.filter(char => {
        if (currentFilters.archetype !== 'All' && char.archetype !== currentFilters.archetype) return false;
        if (currentFilters.tier !== 'All' && char.tier !== currentFilters.tier) return false;
        if (currentFilters.eaOnly && !char.isEA) return false;
        if (currentFilters.baseOnly && !char.isBaseOnly) return false;
        if (currentFilters.hideWip && char.isWip) return false;
        
        return true; 
    });

    if (filteredChars.length === 0) {
        rosterGrid.innerHTML = `<div class="empty-tab-msg" style="width: 100%;">No characters found matching these filters.</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    filteredChars.forEach(char => {
        const card = document.createElement('a');
        card.href = char.url;
        card.className = 'roster-card';
        card.id = `${char.id}-button`; 

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[char.name]) {
            card.style.backgroundColor = window.CHARACTER_COLORS[char.name];
        }

        if (char.isEA) {
            const eaStar = document.createElement('span');
            eaStar.className = 'ea-star-indicator';
            eaStar.textContent = '*';
            card.appendChild(eaStar);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'roster-card-text';
        
        if (char.isBaseOnly) {
            textSpan.classList.add('base-only-text');
        }
        
        textSpan.innerHTML = char.isWip ? `${char.name}<br>(WIP)` : char.name;

        card.appendChild(textSpan);
        fragment.appendChild(card);
    });

    rosterGrid.appendChild(fragment);
}

function initApp() {
    const sidebarNav = document.getElementById('global-sidebar-nav');
    const systemsGrid = document.getElementById('systems-grid');
    const rosterGrid = document.querySelector('.roster-grid');
    const tierListUI = document.getElementById('tier-list-ui');

    if (sidebarNav) void loadMasterSidebar();
    if (systemsGrid) void loadSystemsGrid();
    if (rosterGrid) void initRosterFilters();
    if (tierListUI) void initTierList();

    initDynamicTOC();
    initSidebarState();
    initMobileNav();
}

document.addEventListener('DOMContentLoaded', initApp);

async function loadSystemsGrid() {
    try {
        const navData = await window.fetchNavigationData();
        const sysContainer = document.getElementById('systems-grid');
        if (!sysContainer) return;

        sysContainer.innerHTML = '';
        sysContainer.className = 'systems-grid-container';

        for (const [categoryName, links] of Object.entries(navData)) {
            if (categoryName === "Characters") continue;
            
            const categoryWrapper = document.createElement('div');
            
            const header = document.createElement('h3');
            header.className = 'system-category-header';
            header.textContent = categoryName;
            categoryWrapper.appendChild(header);

            const buttonGrid = document.createElement('div');
            buttonGrid.className = 'system-button-grid';

            links.forEach(sys => {
                const btn = document.createElement('a');

                const isExternal = sys.url.startsWith('http') || sys.url.startsWith('#');
                btn.href = isExternal ? sys.url : `${window.getRootPath()}${sys.url}`;
                
                btn.className = 'system-page-btn';
                btn.textContent = sys.name;
                buttonGrid.appendChild(btn);
            });

            categoryWrapper.appendChild(buttonGrid);
            sysContainer.appendChild(categoryWrapper);
        }
    } catch (error) {
        console.error("Failed to compile systems layout grid component:", error);
    }
}

async function loadMasterSidebar() {
    const sidebar = document.getElementById('global-sidebar-nav');
    if (!sidebar) return;

    let rootPath = window.getRootPath();

    try {
        const navData = await window.fetchNavigationData();
        sidebar.innerHTML = '';

        const fragment = document.createDocumentFragment();

        const homeBtn = document.createElement('a');
        homeBtn.href = `${rootPath}index.html`; 
        homeBtn.className = 'sidebar-link sidebar-link-home';
        homeBtn.textContent = 'Home';
        fragment.appendChild(homeBtn);

        const characterColors = window.CHARACTER_COLORS || {};

        const buildCategory = (title, links) => {
            const details = document.createElement('details');
            details.className = 'sidebar-nav-details';
            
            const summary = document.createElement('summary');
            summary.className = 'sidebar-link faq-summary sidebar-category-summary'; 
            
            summary.innerHTML = `${title} 
                <svg class="nav-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            const linkContainer = document.createElement('div');
            linkContainer.className = 'sidebar-nav-group';

            let hubUrl = '';
            if (title === 'Characters') hubUrl = 'characters/index.html';
            else if (title === 'System Pages') hubUrl = 'systems/index.html';

            if (hubUrl) {
                const hubA = document.createElement('a');
                hubA.href = `${rootPath}${hubUrl}`;
                hubA.className = 'sidebar-link sidebar-sublink';
                hubA.style.color = 'var(--text-muted)';
                hubA.style.borderBottom = '1px dashed var(--border-color)';
                hubA.style.paddingBottom = '0.5rem';
                hubA.style.marginBottom = '0.25rem';
                hubA.innerHTML = `${title} General`;
                
                hubA.addEventListener('mouseover', () => hubA.style.color = 'var(--accent-blue)');
                hubA.addEventListener('mouseout', () => hubA.style.color = 'var(--text-muted)');

                linkContainer.appendChild(hubA);
            }

            links.forEach(link => {
                const a = document.createElement('a');
                
                const isExternal = link.url.startsWith('http') || link.url.startsWith('#');
                a.href = isExternal ? link.url : `${rootPath}${link.url}`;
                
                a.className = 'sidebar-link sidebar-sublink';
                
                if (title === 'Characters' && characterColors[link.name]) {
                    a.classList.add('sidebar-character-link');
                    a.style.setProperty('color', characterColors[link.name], 'important');
                }

                a.textContent = link.name;
                linkContainer.appendChild(a);
            });

            details.appendChild(summary);
            details.appendChild(linkContainer);
            fragment.appendChild(details);
        };

        for (const [category, links] of Object.entries(navData)) {
            buildCategory(category, links);
        }

        sidebar.appendChild(fragment);

    } catch (error) {
        console.error("Failed to build master sidebar:", error);
    }
}

function initSidebarState() {
    const sidebar = document.getElementById('master-sidebar');
    const toggleBtn = document.querySelector('.sidebar-toggle-btn');

    if (!sidebar || !toggleBtn) return;

    if (localStorage.getItem('wikiSidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    toggleBtn.removeAttribute('onclick');
    
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('wikiSidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
}

async function loadPageAlerts(pageId) {
    const mainArea = document.querySelector('.main-content-area');
    if (!mainArea) return;

    let alertsHTML = '';

    try {
        const navData = await window.fetchNavigationData();
        let pageEntry = null;
        
        for (const category in navData) {
            const found = navData[category].find(item => 
                (item.id && item.id.toLowerCase() === pageId.toLowerCase()) || 
                (item.name && item.name.toLowerCase() === pageId.toLowerCase())
            );
            
            if (found) {
                pageEntry = found;
                break;
            }
        }

        if (pageEntry) {
            if (pageEntry.isOutdated) {
                alertsHTML += `
                    <div class="wiki-alert alert-outdated">
                        <div class="wiki-alert-icon">🕰️</div>
                        <div class="wiki-alert-content">
                            <h4>Outdated Information</h4>
                            <p>This page reflects an older version of the game. The data, frame numbers, and strategies here may no longer be accurate or useful.</p>
                        </div>
                    </div>`;
            }

            if (pageEntry.isEA) {
                alertsHTML += `
                    <div class="wiki-alert alert-ea">
                        <div class="wiki-alert-icon">⚠️</div>
                        <div class="wiki-alert-content">
                            <h4>Early Access Content</h4>
                            <p>This content relates to an Early Access character. Data and strategies is highly subjected to unannounced (and sometimes rapid) changes. So don't rely too hard on them.</p>
                        </div>
                    </div>`;
            }

            if (pageEntry.isWip) {
                alertsHTML += `
                    <div class="wiki-alert alert-wip">
                        <div class="wiki-alert-icon">🚧</div>
                        <div class="wiki-alert-content">
                            <h4>Work In Progress</h4>
                            <p>This page is currently a WIP. Wanting to contribute to the site? Reach out to <a href="${window.getRootPath()}systems/collaborators/index.html">our contributors</a> via Discord or their attached socials.</p>
                        </div>
                    </div>`;
            }

            if (pageEntry.isUnverified) {
                alertsHTML += `
                    <div class="wiki-alert alert-unverified">
                        <div class="wiki-alert-icon">🔬</div>
                        <div class="wiki-alert-content">
                            <h4>Needs Verification</h4>
                            <p>The frame data, and such on this page have not yet been peer-reviewed, which might get changed or be wrong (pick your poison).</p>
                        </div>
                    </div>`;
            }

            if (pageEntry.isSubjective) {
                alertsHTML += `
                    <div class="wiki-alert alert-subjective">
                        <div class="wiki-alert-icon">💭</div>
                        <div class="wiki-alert-content">
                            <h4>Subjective Content</h4>
                            <p>This page contains opinions!!! Opinions that are not objective, and might not be true for players with different experiences. So please, don't start any beef, let's resolve whatever disagreements via running 1s?.</p>
                        </div>
                    </div>`;
            }

            if (pageEntry.isMissingMedia) {
                alertsHTML += `
                    <div class="wiki-alert alert-medialess">
                        <div class="wiki-alert-icon">🎞️</div>
                        <div class="wiki-alert-content">
                            <h4>Missing Media</h4>
                            <p>This entry is missing necessary visual media (GIFs, images, or video clips for strategies). If you can capture pics or record clean 60FPS 1-5 seconds footage using the fandom wiki outfits, please consider contributing.</p>
                        </div>
                    </div>`;
            }
        }

        if (alertsHTML !== '') {
            const alertsContainer = document.createElement('div');
            alertsContainer.className = 'character-alerts-container';
            alertsContainer.innerHTML = alertsHTML;
            mainArea.insertBefore(alertsContainer, mainArea.firstChild);
        }

    } catch (error) {
        console.error("Failed to compile page warning banners:", error);
    }
}

window.loadPageAlerts = loadPageAlerts;

function initMobileNav() {
    const sidebar = document.getElementById('master-sidebar');
    if (!sidebar) return;

    const topBar = document.createElement('header');
    topBar.className = 'mobile-top-bar';
    
    let rootPath = window.getRootPath();

    topBar.innerHTML = `
        <a href="${rootPath}index.html" class="mobile-logo-link">
            <img src="${rootPath}medias/images/DogslamloopIcon.webp" alt="Site Logo" class="mobile-logo-img">
            <span class="site-title mobile-site-title">dogslamloop</span>
        </a>
        <button class="mobile-menu-btn">☰</button>
    `;
    
    const siteLayout = document.querySelector('.site-layout');
    if (siteLayout && siteLayout.parentNode) {
        siteLayout.parentNode.insertBefore(topBar, siteLayout);
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-backdrop';
    document.body.appendChild(backdrop);

    const menuBtn = topBar.querySelector('.mobile-menu-btn');

    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        backdrop.classList.add('active');
        document.body.style.overflow = 'hidden'; 
    });

    backdrop.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        backdrop.classList.remove('active');
        document.body.style.overflow = ''; 
    });
}

async function loadCollaborators() {
    const coreGrid = document.getElementById('core-team-grid');
    const thanksList = document.getElementById('special-thanks-list');
    if (!coreGrid && !thanksList) return;

    try {
        const response = await fetch('collaborators_data.json?v=1.0');
        if (!response.ok) throw new Error("Failed to load collaborators data.");
        const data = await response.json();

        if (coreGrid && data.mainContributors) {
            coreGrid.innerHTML = '';
            data.mainContributors.forEach(c => {
                const avatarHTML = c.avatar 
                    ? `<img src="${c.avatar}" alt="Avatar" class="contributor-avatar">`
                    : `<div class="contributor-avatar-placeholder">No Img</div>`;
                
                const nameClass = c.isLead ? "contributor-name-lead" : "contributor-name-standard";
                
                let linksHTML = '<div class="contributor-links">';
                if (c.links && c.links.length > 0) {
                    c.links.forEach(link => {
                        linksHTML += `<a href="${link.url}" target="_blank" class="system-page-btn contributor-btn">${link.name}</a>`;
                    });
                }
                linksHTML += '</div>';

                coreGrid.innerHTML += `
                    <div class="wiki-section contributor-card">
                        <div class="contributor-header">
                            ${avatarHTML}
                            <div>
                                <h4 class="contributor-name ${nameClass}">${c.name}</h4>
                                <span class="update-badge ${c.badgeType}" style="margin-top: 0.35rem;">${c.role}</span>
                            </div>
                        </div>
                        <div class="contributor-desc">${c.description}</div>
                        ${linksHTML}
                    </div>
                `;
            });
        }

        if (thanksList && data.specialThanks) {
            thanksList.innerHTML = '';
            data.specialThanks.forEach(t => {
                thanksList.innerHTML += `<li><strong>${t.name}</strong> — ${t.reason}</li>`;
            });
        }

    } catch (error) {
        console.error("Failed to render collaborators engine:", error);
    }
}

async function initTierList() {
    const listUI = document.getElementById('tier-list-ui');
    const tabsContainer = document.getElementById('tier-tabs-container');
    const changelogUI = document.getElementById('changelog-container');
    if (!listUI) return;

    let tierData = null;
    let characterRoster = [];

    try {
        // 1. Fetch Navigation safely using the centralized utility
        const navData = await window.fetchNavigationData();

        // 2. Fetch Tier Data (this runs on the tierlist page, so relative fetch works perfectly)
        const tierRes = await fetch('tierlist_data.json');
        if (!tierRes.ok) throw new Error(`Could not find tierlist_data.json`);
        tierData = await tierRes.json();

        // Filter valid roster (Exclude Template and Boomcat)
        characterRoster = navData["Characters"].filter(c => 
            c.id !== "Boomcat" && c.name !== "Template"
        );

        function renderTab(tabId) {
            document.querySelectorAll('.tier-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tabId === tabId);
            });

            const tab = tierData.tabs.find(t => t.id === tabId);
            if (!tab) return;

            listUI.innerHTML = '';
            let placedCharacterIds = new Set();

            // Render Defined Tiers
            tab.tiers.forEach(tier => {
                const row = document.createElement('div');
                row.className = 'tier-row';
                
                const label = document.createElement('div');
                label.className = 'tier-label';
                label.style.backgroundColor = tier.color || 'hsl(0, 0%, 50%)';
                label.textContent = tier.name;

                const charContainer = document.createElement('div');
                charContainer.className = 'tier-characters';

                tier.characters.forEach(charId => {
                    placedCharacterIds.add(charId);
                    const charData = characterRoster.find(c => c.id === charId);
                    if (charData) {
                        charContainer.appendChild(createCharCard(charData));
                    }
                });

                row.appendChild(label);
                row.appendChild(charContainer);
                listUI.appendChild(row);
            });

            // Render Unranked / TBD Pool
            const unrankedChars = characterRoster.filter(c => !placedCharacterIds.has(c.id));
            if (unrankedChars.length > 0) {
                const unrankedRow = document.createElement('div');
                unrankedRow.className = 'tier-row';
                
                const unrankedLabel = document.createElement('div');
                unrankedLabel.className = 'tier-label';
                unrankedLabel.style.backgroundColor = 'hsl(212, 10%, 40%)';
                unrankedLabel.style.color = '#fff';
                unrankedLabel.textContent = 'Unranked';

                const unrankedContainer = document.createElement('div');
                unrankedContainer.className = 'tier-characters';

                unrankedChars.forEach(charData => {
                    unrankedContainer.appendChild(createCharCard(charData));
                });

                unrankedRow.appendChild(unrankedLabel);
                unrankedRow.appendChild(unrankedContainer);
                listUI.appendChild(unrankedRow);
            }

            // Render Changelogs
            changelogUI.innerHTML = '';
            if (tab.changelog && tab.changelog.length > 0) {
                tab.changelog.forEach(log => {
                    const logBox = document.createElement('div');
                    logBox.className = 'changelog-box';
                    
                    const dateHeading = document.createElement('h3');
                    dateHeading.style.color = 'hsl(212, 80%, 60%)';
                    dateHeading.style.marginTop = '0';
                    dateHeading.textContent = `Update: ${log.date}`;
                    logBox.appendChild(dateHeading);

                    const list = document.createElement('ul');
                    list.style.color = 'hsl(0, 0%, 80%)';
                    list.style.fontSize = '0.9rem';
                    list.style.margin = '0';
                    list.style.paddingLeft = '1.5rem';

                    log.notes.forEach(note => {
                        const li = document.createElement('li');
                        li.textContent = note;
                        li.style.marginBottom = '0.5rem';
                        list.appendChild(li);
                    });

                    logBox.appendChild(list);
                    changelogUI.appendChild(logBox);
                });
            } else {
                changelogUI.innerHTML = '<p class="text-gray-300">No logs available for this tab.</p>';
            }
        }

        function createCharCard(charData) {
            const card = document.createElement('a');
            card.className = 'tier-char-card';
            card.href = `${window.getRootPath()}${charData.url}`;
            
            const safeName = charData.name.replace(/\s+/g, '');
            const imgPath = `${window.getRootPath()}medias/images/${safeName}Portrait.webp`;

            const img = document.createElement('img');
            img.src = imgPath;
            img.alt = charData.name;
            img.loading = "lazy";
            
            img.onerror = function() {
                this.src = `${window.getRootPath()}medias/images/DogslamloopIcon.webp`;
            };

            const tooltip = document.createElement('div');
            tooltip.className = 'tier-char-tooltip';
            tooltip.textContent = charData.name;

            card.appendChild(img);
            card.appendChild(tooltip);
            return card;
        }

        // Build tabs
        tabsContainer.innerHTML = '';
        tierData.tabs.forEach(tab => {
            const btn = document.createElement('button');
            btn.className = 'tier-tab-btn';
            btn.textContent = tab.label;
            
            // Extract the character name by stripping the "vs " prefix
            let charName = tab.label.replace(/^vs\s+/i, '').trim();
            
            // Check if the site meta has a color for this character and apply it as a CSS variable
            if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[charName]) {
                btn.style.setProperty('--tab-bg', window.CHARACTER_COLORS[charName]);
            }

            btn.onclick = () => renderTab(tab.id);
            btn.dataset.tabId = tab.id;
            tabsContainer.appendChild(btn);
        });

        if(tierData.tabs.length > 0) {
            renderTab(tierData.tabs[0].id);
        }

    } catch (err) {
        listUI.innerHTML = `<p style="color: hsl(0, 80%, 60%); padding: 1rem; font-weight: bold;">Failed to load tier list data: ${err.message}</p>`;
        console.error("Tier List Init Error:", err);
    }
}

window.loadCollaborators = loadCollaborators;
window.setupTabs = setupTabs;