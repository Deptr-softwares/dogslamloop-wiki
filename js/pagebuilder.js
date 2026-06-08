/**
 * Dogslamloop Wiki - Page Builder & Navigation Module
 */

async function fetchNavigationData() {
    const inSubfolder = window.location.pathname.includes('/systems/') || window.location.pathname.includes('/characters/');
    const dataPath = inSubfolder ? '../data/' : 'data/';
    
    const response = await fetch(`${dataPath}navigation.json?t=${Date.now()}`);
    if (!response.ok) throw new Error('Failed to load navigation.json');
    
    return await response.json();
}

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

                // FIX: Only trigger a TOC rebuild if this is a 'major' page tab!
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

    // Grab all typical headings from the target container
    const headings = container.querySelectorAll('h2, h3, .matchup-card-title, .counterplay-card-title, .character-title, .strategy-title');
    
    if (headings.length === 0) {
        tocContainer.innerHTML = '<li><p style="color: hsl(212, 9%, 58%); font-style: italic; font-size: 0.75rem; padding: 0.25rem 0.75rem;">Loading or empty...</p></li>';
        return;
    }

    tocContainer.innerHTML = '';
    const slugify = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    headings.forEach(heading => {

        const headingText = heading.textContent.replace('▼', '').trim();
        
        if (!headingText) return;

        if (headingText === "Move Overview and Strategy" || headingText === "Move Overview & Strategy") {
            return; 
        }

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

    // Trigger the global refresh whenever elements change
    const observer = new MutationObserver(refreshTOC);
    const mainArea = document.querySelector('.main-content-area');
    if (mainArea) {
        observer.observe(mainArea, { childList: true, subtree: true });
    }

    refreshTOC(); 
}

async function loadRosterGrid() {
    try {
        const navData = await fetchNavigationData();
        const characters = navData["Characters"];
        
        const rosterGrid = document.querySelector('.roster-grid');
        if (!rosterGrid || !characters) return;

        rosterGrid.innerHTML = '';

        characters.forEach(char => {
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
            rosterGrid.appendChild(card);
        });
    } catch (error) {
        console.error("Failed to compile roster layout grid component:", error);
    }
}

async function loadSystemsGrid() {
    try {
        const navData = await fetchNavigationData();
        const sysContainer = document.getElementById('systems-grid');
        if (!sysContainer) return;

        sysContainer.innerHTML = '';
        sysContainer.style.display = 'flex';
        sysContainer.style.flexDirection = 'column';
        sysContainer.style.gap = '1rem';

        // Loop through the master JSON, ignoring the Characters array
        for (const [categoryName, links] of Object.entries(navData)) {
            if (categoryName === "Characters") continue;
            
            const categoryWrapper = document.createElement('div');
            
            const header = document.createElement('h3');
            header.style.cssText = "font-size: 0.75rem; font-weight: 600; color: hsl(212, 9%, 58%); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.25rem;";
            header.textContent = categoryName;
            categoryWrapper.appendChild(header);

            const buttonGrid = document.createElement('div');
            buttonGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.5rem;";

            links.forEach(sys => {
                const btn = document.createElement('a');
                btn.href = sys.url;
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

    const inSubfolder = window.location.pathname.includes('/systems/') || window.location.pathname.includes('/characters/');
    const rootPath = inSubfolder ? '../' : '';

    try {
        const navData = await fetchNavigationData();
        sidebar.innerHTML = '';

        const homeBtn = document.createElement('a');
        homeBtn.href = `${rootPath}index.html`; 
        homeBtn.className = 'sidebar-link';
        homeBtn.style.cssText = 'background: var(--bg-secondary); color: var(--text-white); margin-bottom: 0.5rem;';
        homeBtn.textContent = 'Home';
        sidebar.appendChild(homeBtn);

        const characterColors = window.CHARACTER_COLORS || {};

        const buildCategory = (title, links) => {
            const details = document.createElement('details');
            details.style.cssText = 'margin-bottom: 0.25rem;';
            
            const summary = document.createElement('summary');
            summary.className = 'sidebar-link faq-summary'; 
            summary.style.cssText = 'cursor: pointer; padding: 0.4rem 0.75rem; border: none; margin: 0;';
            
            summary.innerHTML = `${title} 
                <svg class="nav-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; color: hsl(212, 9%, 58%);"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            const linkContainer = document.createElement('div');
            linkContainer.style.cssText = 'display: flex; flex-direction: column; padding-left: 0.75rem; margin-top: 0.25rem; margin-bottom: 0.5rem; border-left: 1px solid var(--border-color); margin-left: 0.75rem;';

            links.forEach(link => {
                const a = document.createElement('a');
                
                const isExternal = link.url.startsWith('http') || link.url.startsWith('#');
                a.href = isExternal ? link.url : `${rootPath}${link.url}`;
                
                a.className = 'sidebar-link';
                
                let baseStyle = 'font-size: 0.75rem; padding: 0.35rem 0.5rem; margin-bottom: 0;';
                
                if (title === 'Characters' && characterColors[link.name]) {
                    baseStyle += ` 
                        color: ${characterColors[link.name]} !important; 
                        font-weight: bold; 
                        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0px 2px 2px rgba(0,0,0,0.5); 
                        letter-spacing: 0.02em;
                    `;
                }

                a.style.cssText = baseStyle;
                a.textContent = link.name;
                linkContainer.appendChild(a);
            });

            details.appendChild(summary);
            details.appendChild(linkContainer);
            sidebar.appendChild(details);

            details.addEventListener('toggle', (e) => {
                const arrow = details.querySelector('.nav-arrow');
                if (details.open) {
                    arrow.style.transform = 'rotate(180deg)';
                } else {
                    arrow.style.transform = 'rotate(0deg)';
                }
            });
        };

        for (const [category, links] of Object.entries(navData)) {
            buildCategory(category, links);
        }

    } catch (error) {
        console.error("Failed to build master sidebar:", error);
    }
}

function initSidebarState() {
    const sidebar = document.getElementById('master-sidebar');
    const toggleBtn = document.querySelector('.sidebar-toggle-btn');

    if (!sidebar || !toggleBtn) return;

    // 1. Read from localStorage on page load and apply if needed
    if (localStorage.getItem('wikiSidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    // 2. Remove inline onclick just in case it was left in the HTML
    toggleBtn.removeAttribute('onclick');
    
    // 3. Attach persistent click listener
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        // Save the new state directly into the browser's local storage
        localStorage.setItem('wikiSidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
}

function initMobileNav() {
    const sidebar = document.getElementById('master-sidebar');
    if (!sidebar) return;

    // Create the Mobile Top Bar on the fly
    const topBar = document.createElement('header');
    topBar.className = 'mobile-top-bar';
    
    // Checks if we are in a subfolder so the home link routes correctly
    const inSubfolder = window.location.pathname.includes('/systems/') || window.location.pathname.includes('/characters/');
    const rootPath = inSubfolder ? '../' : '';

    topBar.innerHTML = `
        <a href="${rootPath}index.html" style="display: flex; align-items: center; gap: 0.75rem; text-decoration: none;">
            <img src="/medias/images/DestroymanFront.jpg" alt="Site Logo" style="width: 32px; height: 32px; border: 2px solid var(--border-color); box-shadow: 2px 2px 0px #000; border-radius: 0; object-fit: cover;">
            <span class="site-title" style="font-size: 1.25rem; margin: 0; line-height: 1;">dogslamloop</span>
        </a>
        <button class="mobile-menu-btn" style="background: none; border: none; color: var(--text-white); font-size: 1.75rem; cursor: pointer; padding: 0;">☰</button>
    `;
    
    // Inject it into the page directly above the main layout
    const siteLayout = document.querySelector('.site-layout');
    if (siteLayout && siteLayout.parentNode) {
        siteLayout.parentNode.insertBefore(topBar, siteLayout);
    }

    // Create the dark backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-backdrop';
    document.body.appendChild(backdrop);

    // Event Listeners for opening and closing
    const menuBtn = topBar.querySelector('.mobile-menu-btn');

    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        backdrop.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevents scrolling the background
    });

    backdrop.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        backdrop.classList.remove('active');
        document.body.style.overflow = ''; // Restores scrolling
    });
}

if (document.getElementById('global-sidebar-nav')) {
    document.addEventListener('DOMContentLoaded', loadMasterSidebar);
}
if (document.getElementById('systems-grid')) {
    document.addEventListener('DOMContentLoaded', loadSystemsGrid);
}
if (document.querySelector('.roster-grid')) {
    document.addEventListener('DOMContentLoaded', loadRosterGrid);
}

document.addEventListener('DOMContentLoaded', initDynamicTOC);
document.addEventListener('DOMContentLoaded', initSidebarState);

document.addEventListener('DOMContentLoaded', initMobileNav);

window.setupTabs = setupTabs;