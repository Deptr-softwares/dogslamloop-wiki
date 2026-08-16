/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

// Helper to assign CSS classes, inline widths, and safe style merging for media
function getMediaAttributes(align, customWidth, extraStyles = '') {
    let alignClass = 'wiki-media-full';
    
    if (align === 'left') alignClass = 'wiki-media-left';
    else if (align === 'right') alignClass = 'wiki-media-right';
    else if (align === 'center') alignClass = 'wiki-media-center';

    return `class="wiki-media ${alignClass}" style="width: ${customWidth || '100%'}; ${extraStyles}"`;
}

// --- PLAYSTYLE COMPONENT GENERATOR ---
window.generatePlaystyleHTML = function(playstyle) {
    if (!playstyle || (!playstyle.likes?.length && !playstyle.dislikes?.length)) return '';
    
    const renderList = (items, icon, variant) => items.map(text => `
        <li class="playstyle-item">
            <span class="playstyle-icon ${variant}">${icon}</span>
            <span class="playstyle-item-text">${text}</span>
        </li>
    `).join('');

    return `
        <div class="playstyle-container">
            <div class="playstyle-col likes">
                <h4 class="playstyle-header">PICK IF YOU LIKE</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.likes || [], '✓', 'likes')}
                </ul>
            </div>
            <div class="playstyle-col dislikes">
                <h4 class="playstyle-header">AVOID IF YOU DISLIKE</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.dislikes || [], '✖', 'dislikes')}
                </ul>
            </div>
        </div>
    `;
};

// --- THE RECURSIVE BLOCK ENGINE ---
// This standalone function can render blocks infinitely deep!
window.generateHTMLForBlocks = function(blocks, contextClass = '') { // FIXED 1: Added contextClass parameter
    let contentHTML = '';
    let sectionAuthors = new Set(); // FIXED 2: Initialized the authors array here!
    
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    blocks.forEach(block => {
        if (!block) return;
        
        // FIXED 3: Defined the alignment variable inside the loop so every block can use it!
        const alignAttr = getAlignStyle(block.align); 
        
        if (block.type === 'heading') {
            let headingClass = 'wiki-block-heading';
            if (contextClass) headingClass += ` ${contextClass}-heading`;
            
            const tag = block.size || 'h3';
            
            contentHTML += `<${tag} class="${headingClass}" ${alignAttr}>${block.content}</${tag}>`;
        }
        // --- PARAGRAPHS (With Inline Keybinds & URL Links) ---
        else if (block.type === 'paragraph') {
            const rawText = Array.isArray(block.content) ? block.content.join('<br>') : block.content;
            
            // Convert keybinds
            let text = rawText.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
            
            const pClass = contextClass ? 'strategy-paragraph card-text' : 'strategy-paragraph';
            contentHTML += `<p class="${pClass}" ${alignAttr}>${text}</p>`;
        }
        else if (block.type === 'list') {
            const lClass = contextClass ? 'wiki-block-list space-y-2 card-text' : 'wiki-block-list space-y-2 text-gray-300';
            contentHTML += `<ul class="${lClass}" ${alignAttr}>`;
            block.items.forEach(item => { contentHTML += `<li>${item}</li>`; });
            contentHTML += `</ul>`;
        }
        else if (block.type === 'image') {
            if (block.caption) {
                contentHTML += `
                    <figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')} >
                        <img src="${block.src}" alt="${block.alt || 'Wiki Image'}" class="wiki-block-image" loading="lazy">
                        <figcaption class="wiki-figcaption">
                            ${block.caption}
                        </figcaption>
                    </figure>
                `;
            } else {
                contentHTML += `<img src="${block.src}" alt="${block.alt || 'Wiki Image'}" ${getMediaAttributes(block.align, block.width, 'border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow, #000);')} loading="lazy">`;
            }
        }
        // --- DIVIDERS ---
        else if (block.type === 'divider') {
            const bData = block.data || block; // SAFE EXTRACTOR

            // Legacy fallback for old invisible blocks
            let currentStyle = bData.style || (bData.invisible ? 'invisible' : 'diamond');
            let paddingClass = bData.padding || 'normal';

            const validPadding = ['none', 'small', 'normal', 'large', 'massive'];
            const padClass = `wiki-divider-pad-${validPadding.includes(paddingClass) ? paddingClass : 'normal'}`;

            let divHtml = '';

            // Inject the exact HTML for the requested style
            switch (currentStyle) {
                case 'invisible':
                    divHtml = ``; // Just the margin container!
                    break;
                case 'solid':
                    divHtml = `<div class="wiki-divider-line-solid"></div>`;
                    break;
                case 'dashed':
                    divHtml = `<div class="wiki-divider-line-dashed"></div>`;
                    break;
                case 'dotted':
                    divHtml = `<div class="wiki-divider-line-dotted"></div>`;
                    break;
                case 'double':
                    divHtml = `<div class="wiki-divider-line-double"></div>`;
                    break;
                case 'circle':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-circle-dot"></div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'cross':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-cross-plus">+</div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'fade':
                    divHtml = `<div class="wiki-divider-line-fade"></div>`;
                    break;
                case 'slash':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-slash-mark">///</div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'diamond':
                default:
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-diamond-mark"></div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
            }

            contentHTML += `<div class="wiki-divider ${padClass}">${divHtml}</div>`;
        }
        // --- STANDALONE AUTHOR BLOCK ---
        else if (block.type === 'author') {
            // (Handled below in the author aggregation step)
        }
        // --- INLINE CALLOUTS ---
        else if (block.type === 'callout') {
            const bData = block.data || block; 
            
            const intentMap = {
                'tip': { color: '#facc15', icon: '💡', label: 'TIP' },
                'warning': { color: '#fb923c', icon: '⚠️', label: 'WARNING' },
                'danger': { color: '#ef4444', icon: '🚨', label: 'DANGER' },
                'info': { color: '#22d3ee', icon: '📌', label: 'INFO' }
            };
            const config = intentMap[bData.intent] || intentMap['info'];
            const text = Array.isArray(bData.content) ? bData.content.join('<br>') : (bData.content || bData.text || '');

            let tooltipContent = '';
            if (bData.title) {
                tooltipContent += `<strong class="callout-tooltip-title" style="--tooltip-accent: ${config.color};">${bData.title}</strong>`;
            }

            tooltipContent += `<span class="tooltip-desc callout-tooltip-desc">${text}</span>`;

            contentHTML += `
                <div class="wiki-callout-wrapper" ${getAlignStyle(bData.align)}>
                    <span class="inline-callout-btn" style="--callout-color: ${config.color};" data-tooltip="${encodeURIComponent(tooltipContent)}">
                        <span class="callout-icon">${config.icon}</span>
                        <span class="callout-label">${config.label}</span>
                    </span>
                </div>
            `;
        }
        // --- DATA TABLES ---
        else if (block.type === 'table') {
            const bData = block.data || block; // SAFE EXTRACTOR

            const headers = bData.headers || [];
            const rows = bData.rows || [];
            
            let tableContent = '<table class="update-table wiki-content-table">';

            // Render Headers
            if (headers.length > 0) {
                tableContent += `<thead><tr>`;
                headers.forEach(h => {
                    tableContent += `<th>${h}</th>`;
                });
                tableContent += `</tr></thead>`;
            }

            // Render Rows (alternating background + hover are handled by CSS: nth-child/:hover)
            if (rows.length > 0) {
                tableContent += `<tbody>`;
                rows.forEach((row) => {
                    tableContent += `<tr>`;

                    // Parse [M1] keybinds natively inside the cells
                    row.forEach(cell => {
                        let parsedCell = (cell || '').replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                        tableContent += `<td>${parsedCell}</td>`;
                    });
                    tableContent += `</tr>`;
                });
                tableContent += `</tbody>`;
            } else {
                tableContent += '<tr><td class="wiki-table-empty-cell">Table data is empty.</td></tr>';
            }
            tableContent += '</table>';

            // Wrapping container provides horizontal scrolling on mobile and the heavy manga shadow
            contentHTML += `
                <div class="wiki-table-wrapper">
                    ${tableContent}
                </div>
            `;
        }
        // --- YOUTUBE & NATIVE VIDEO EMBEDS ---
        else if (block.type === 'youtube' || block.type === 'video' || block.type === 'embed') {
            const bData = block.data || block; 
            let mediaInnerHtml = '';

            if (block.type === 'youtube' || bData.videoId) {
                let videoId = bData.videoId || bData.url || '';
                const ytMatch = videoId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
                if (ytMatch) videoId = ytMatch[1];
                
                if (videoId) {
                    // Injecting data-lazy-src
                    mediaInnerHtml = `
                        <iframe data-lazy-src="https://www.youtube.com/embed/${videoId}" src="about:blank"
                                class="wiki-video-embed"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen>
                        </iframe>
                    `;
                }
            } 
            else if (block.type === 'video') {
                const videoUrl = bData.url || bData.src || '';
                if (videoUrl) {
                    const controlsAttr = bData.controls ? 'controls' : 'autoplay loop muted playsinline';
                    // Injecting data-lazy-src and preload="none"
                    mediaInnerHtml = `<video data-lazy-src="${videoUrl}" ${controlsAttr} class="wiki-video-native" preload="none"></video>`;
                }
            }

            if (mediaInnerHtml) {
                if (bData.caption) {
                    contentHTML += `
                        <figure ${getMediaAttributes(bData.align, bData.width, 'text-align: center;')} >
                            ${mediaInnerHtml}
                            <figcaption class="wiki-figcaption">
                                ${bData.caption}
                            </figcaption>
                        </figure>
                    `;
                } else {
                    contentHTML += `
                        <div ${getMediaAttributes(bData.align, bData.width)}>
                            ${mediaInnerHtml}
                        </div>
                    `;
                }
            }
        }
        // --- ACCORDION  ---
        else if (block.type === 'accordion' || block.type === 'details') {
            const bData = block.data || block; 
            const title = bData.title || bData.summary || 'COLLAPSIBLE SECTION';

            // Recursively generate the inner content
            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            // The arrow is pinned via absolute positioning so it doesn't move when the title is centered!
            contentHTML += `
                <div class="wiki-accordion-wrapper">
                    <details class="manga-accordion">
                        <summary class="wiki-accordion-summary" style="text-align: ${bData.align || 'left'};">
                            <span>${title}</span>
                            <span class="accordion-arrow">▼</span>
                        </summary>
                        <div class="wiki-accordion-body">
                            ${innerHTML}
                        </div>
                    </details>
                </div>
            `;
        }
        // --- COMBO STRINGS ---
        else if (block.type === 'combo') {
            if (block.sequence && block.sequence.length > 0) {
                
                // Determine flex justification based on alignment
                let justifyClass = 'flex-start';
                if (block.align === 'center') justifyClass = 'center';
                if (block.align === 'right') justifyClass = 'flex-end';

                let comboHTML = `<div class="combo-container" style="justify-content: ${justifyClass};">`;
                
                block.sequence.forEach((move, index) => {
                    // Use the new Keycap aesthetic
                    comboHTML += `<span class="combo-node">${move}</span>`;
                    
                    // Thicker, sharper arrows
                    if (index < block.sequence.length - 1) {
                        comboHTML += `<svg class="combo-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
                    }
                });

                if (block.note || block.damage) {
                    // If aligned left, push the damage to the far right. Otherwise, keep it grouped together.
                    const pushRight = block.align === 'left' ? 'margin-left: auto;' : '';
                    comboHTML += `<div class="combo-meta-group" style="${pushRight}">`;
                    
                    if (block.note) {
                        comboHTML += `<span class="combo-note">${block.note}</span>`;
                    }
                    if (block.damage) {
                        comboHTML += `<span class="combo-damage">${block.damage}</span>`;
                    }
                    
                    comboHTML += `</div>`;
                }

                comboHTML += `</div>`;
                contentHTML += comboHTML;
            }
        }
        
        // --- AUTHOR AGGREGATION ---
        if (block.author && block.author.trim() !== '') {
            // Split by comma in case multiple authors collaborated on one block
            block.author.split(',').forEach(a => sectionAuthors.add(a.trim()));
        }
    });

    // --- AUTHOR FOOTER ---
    if (sectionAuthors.size > 0) {
        // Escaped, unlike the block content above it. Block content is
        // deliberately rich HTML - contributors write formatted prose, and
        // paragraphs even run a keybind substitution over it - but an author
        // name is an identity label, never markup. It rides along inside
        // submitted block data as block.author, so it is contributor-reachable
        // on every character and system page, and it was going into innerHTML
        // raw.
        const authorBadges = Array.from(sectionAuthors)
            .map(a => `<span class="author-badge">${window.escapeHtml(a)}</span>`)
            .join('');
        
        contentHTML += `
            <div class="aggregated-contributors-footer">
                <div class="contributors-header">
                    <span class="contributors-icon">👥</span>
                    <span class="contributors-text">Contributors</span>
                </div>
                <div class="contributors-list">${authorBadges}</div>
            </div>
        `;
    }

    contentHTML += `<div class="wiki-blocks-clearfix"></div>`;

    return contentHTML;
};

// Helper to apply dynamic text alignment and prevent long-word overflow
function getAlignStyle(align) {
    let styleStr = 'overflow-wrap: break-word; word-break: break-word;';
    if (align) styleStr += ` text-align: ${align};`;
    return `style="${styleStr}"`;
}

// Raises contributor credit from per-section to per-tab.
//
// generateHTMLForBlocks already aggregates authors, but only within one call -
// so a tab built from several sections got a footer per section, and an
// accordion got another one nested inside it, since the recursive call starts
// its own author set. Five badges partway down the Overview tab is noise, and
// the same name repeated in three footers is worse.
//
// Done as a DOM pass over the finished tab rather than by threading an author
// set through every caller: the sections are built by four different code
// paths (overview, matchups, counterplay, move strategies), some of them
// asynchronously, and this way each one only has to say "I'm done" rather than
// hand its authors back. It also picks up the nested accordion footers, which
// a caller-level version would miss.
//
// Deliberately not applied to blog posts (js/posts.js) - a post has one author
// and its footer belongs where it is.
window.consolidateTabContributors = function(root) {
    if (!root) return;

    const footers = root.querySelectorAll('.aggregated-contributors-footer');
    if (footers.length === 0) return;

    // Set, because the same person usually wrote several sections of a tab.
    //
    // Sorted rather than left in document order: a nested accordion emits its
    // footer inside the accordion body, which lands *before* the enclosing
    // section's own footer, so document order does not match authoring order
    // and never can. Alphabetical is at least honest about being a credits
    // list rather than a sequence.
    const authors = new Set();
    footers.forEach(footer => {
        footer.querySelectorAll('.author-badge').forEach(badge => {
            const name = badge.textContent.trim();
            if (name) authors.add(name);
        });
        footer.remove();
    });

    const ordered = Array.from(authors).sort((a, b) => a.localeCompare(b));

    if (authors.size === 0) return;

    const footer = document.createElement('div');
    footer.className = 'aggregated-contributors-footer tab-contributors-footer';
    // textContent per badge, so a contributor name is never parsed as markup -
    // same reason generateHTMLForBlocks escapes them.
    const header = document.createElement('div');
    header.className = 'contributors-header';
    header.innerHTML = `<span class="contributors-icon">👥</span><span class="contributors-text">Contributors</span>`;
    const list = document.createElement('div');
    list.className = 'contributors-list';
    ordered.forEach(name => {
        const badge = document.createElement('span');
        badge.className = 'author-badge';
        badge.textContent = name;
        list.appendChild(badge);
    });
    footer.appendChild(header);
    footer.appendChild(list);
    root.appendChild(footer);
};

function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.classList.remove('vessel-content');
    container.classList.add('content-section-wrapper');

    if (blocks && blocks.length > 0) {

        const section = document.createElement('section');
        
        if (contextClass === 'move-strategy') {
            section.className = 'skill-strategy-section';
        } else if (contextClass === 'system-content') {
            section.className = 'system-content-wrapper'; 
        } else {
            section.className = `wiki-section ${contextClass}`.trim();
        }
        
        if (sectionTitle) {
            section.innerHTML = `<h3 class="strategy-title">${sectionTitle}</h3>`;
        }

        // 1. Generate the HTML using our recursive engine
        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = window.generateHTMLForBlocks(blocks, contextClass);
        section.appendChild(bodyDiv);
        container.appendChild(section);

        // 2. Bind the tooltips (shared engine, see site_utils.js)
        const callouts = section.querySelectorAll('.inline-callout-btn');
        callouts.forEach(btn => {
            const decodedTooltip = decodeURIComponent(btn.getAttribute('data-tooltip'));
            window.bindTooltip(btn, decodedTooltip);
        });

        // 3. Initialize Lazy Loading for newly injected videos
        if (typeof window.initLazyMedia === 'function') {
            window.initLazyMedia(container);
        }

    } else {
        container.innerHTML = `
            <div class="wiki-section-empty">
                "${sectionTitle}" analysis has not been written yet.
            </div>
        `;
    }
}

async function loadPageDescriptions(pageId, pageType = 'character', modeId = null) {
    try {
        let data = null;

        // Set when the object came from the editor, which has already narrowed
        // it to the state being edited (js/editor-modes.js). Resolving it a
        // second time below would look for a modeData bucket inside a bucket
        // and render the preview empty.
        let dataIsPreScoped = false;

        // 1. Check Editor Cache (For Live Preview pane)
        if (window.currentEditorDescData) {
            data = window.currentEditorDescData;
            dataIsPreScoped = true;
        }
        else {
            // 2. Check Supabase Cloud Database
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);
                if (cloudData && cloudData.desc_data) {
                    data = cloudData.desc_data;
                    console.log(`[Cloud] Loaded ${pageId} descriptions.`);
                }
            }
            
            // 3. FALLBACK: Dynamic Pathing based on pageType!
            if (!data) {
                const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
                let descPath = '';
                
                if (pageType === 'system') {
                    descPath = `${rootPath}systems/${pageId}/${pageId}_descriptions.json`;
                } else {
                    descPath = `${rootPath}characters/${pageId.charAt(0).toUpperCase() + pageId.slice(1)}/${pageId}_descriptions.json`;
                }
                
                // CRITICAL FIX: Wrapped in try/catch so a missing local JSON file doesn't crash the engine!
                try {
                    data = await window.fetchJson(descPath);
                    console.log(`[Local] Loaded ${pageId} descriptions from ${pageType} directory.`);
                } catch (e) {
                    console.warn(`[Local] No local JSON found for ${pageId}.`);
                }
            }
        }

        // --- PREVENT FATAL CRASH IF NO DATA EXISTS ---
        if (!data) {
            if (pageType === 'system') {
                console.log(`[System] Initializing blank schema for new system page.`);
                data = { tabs: [] }; 
            } else {
                throw new Error("No descriptive data found.");
            }
        }

        // =====================================================================
        // THE SYSTEM PAGE ENGINE (Dynamic Tabs & Sections)
        // =====================================================================
        if (pageType === 'system') {
            const mainArea = document.querySelector('.main-content-area');
            if (!mainArea) return;

            // --- AUTO-MIGRATION: Initialize default tab or rescue old corrupted data ---
            if (!data.tabs || data.tabs.length === 0) {
                let rescuedBlocks = [];
                if (data.overview && data.overview.length > 0) rescuedBlocks.push(...data.overview);
                if (data.strategy && data.strategy.length > 0) rescuedBlocks.push(...data.strategy);
                
                data = {
                    tabs: [{
                        tabId: 'overview',
                        tabLabel: 'Overview',
                        sections: [{ 
                            sectionTitle: rescuedBlocks.length > 0 ? 'Recovered Data' : 'Introduction', 
                            layout: 'full', 
                            blocks: rescuedBlocks 
                        }]
                    }]
                };
            }

            // 1. Wipe out any hardcoded legacy containers and old dynamic navs
            const oldTarget = document.getElementById('tab-overview');
            if (oldTarget) oldTarget.remove();
            const oldNav = document.getElementById('system-dynamic-nav');
            if (oldNav) oldNav.remove();

            // 2. Build the interactive Manga Tab Navigation Bar
            const isEditor = !!document.getElementById('interactive-builder');
            let navHTML = `<nav id="system-dynamic-nav" class="character-nav" style="display: ${isEditor ? 'none' : 'flex'}; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue); align-items: center;">`;
            
            const tabIdsForPageBuilder = []; // Passed to setupTabs()

            data.tabs.forEach((tab, idx) => {
                const isActive = idx === 0 ? 'active' : '';
                navHTML += `<button id="nav-${tab.tabId}" class="btn-manga btn-manga-slanted ${isActive}"><div class="btn-manga-content"><span class="btn-manga-text">${tab.tabLabel}</span></div></button>`;
                tabIdsForPageBuilder.push(tab.tabId);
            });
            navHTML += `</nav>`;

            // Inject the nav directly beneath the page header
            const header = mainArea.querySelector('.home-main-header');
            if (header) {
                header.insertAdjacentHTML('afterend', navHTML);
            } else {
                mainArea.insertAdjacentHTML('afterbegin', navHTML);
            }

            // 3. Generate the Tab Containers and Content
            data.tabs.forEach((tab, idx) => {
                let tabContainer = document.getElementById(`tab-${tab.tabId}`);
                if (!tabContainer) {
                    tabContainer = document.createElement('div');
                    tabContainer.id = `tab-${tab.tabId}`;
                    // Removed space-y-6 so Flexbox can properly control vertical margins
                    tabContainer.className = 'tab-content wiki-tab-content';
                    if (idx !== 0) tabContainer.classList.add('hidden'); 
                    mainArea.appendChild(tabContainer);
                }
                
                tabContainer.innerHTML = '';

                if (tab.sections && tab.sections.length > 0) {
                    tab.sections.forEach((section, sIdx) => {
                        
                        // --- MIGRATION & CALCULATION ENGINE ---
                        let sWidth = section.width;
                        let sAlign = section.alignment;
                        let sBreak = section.forceBreak;

                        // Seamlessly converts old database data to the new dynamic schema
                        if (sWidth === undefined) {
                            if (section.layout === 'centered') { sWidth = 80; sAlign = 'center'; sBreak = true; }
                            else if (section.layout === 'split-left') { sWidth = 48; sAlign = 'left'; sBreak = false; }
                            else if (section.layout === 'split-right') { sWidth = 48; sAlign = 'right'; sBreak = false; }
                            else { sWidth = 100; sAlign = 'left'; sBreak = true; }
                            
                            section.width = sWidth; section.alignment = sAlign; section.forceBreak = sBreak;
                        }

                        // --- THE ROW BREAKER ---
                        if (sBreak && sIdx !== 0) {
                            const flexBreak = document.createElement('div');
                            flexBreak.className = 'flex-row-break';
                            tabContainer.appendChild(flexBreak);
                        }

                        const sectionNode = document.createElement('section');
                        sectionNode.className = 'wiki-section system-content-grid-section';

                        // --- DYNAMIC GEOMETRY APPLICATION ---
                        sectionNode.style.flex = `0 0 ${sWidth}%`;
                        sectionNode.style.maxWidth = `${sWidth}%`;

                        // Auto-Margin alignment physics 
                        if (sAlign === 'center') {
                            sectionNode.style.marginLeft = 'auto';
                            sectionNode.style.marginRight = 'auto';
                        } else if (sAlign === 'right') {
                            sectionNode.style.marginLeft = 'auto';
                        } else if (sAlign === 'left') {
                            sectionNode.style.marginRight = 'auto';
                        }
                        
                        if (section.sectionTitle) {
                            sectionNode.innerHTML = `<h2 class="section-title mb-4">${section.sectionTitle}</h2>`;
                        }
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.id = `system-${tab.tabId}-sec-${sIdx}`;
                        sectionNode.appendChild(contentDiv);
                        tabContainer.appendChild(sectionNode);
                        
                        populateTextSection(contentDiv.id, '', section.blocks, 'system-content');
                    });
                    
                    // Flexbox safe clear-fix
                    const clearFix = document.createElement('div');
                    clearFix.className = 'flex-row-break';
                    tabContainer.appendChild(clearFix);

                    // After the clear-fix, so the footer sits below the
                    // floated section content rather than beside it.
                    window.consolidateTabContributors(tabContainer);
                } else {
                    tabContainer.innerHTML = `<div class="wiki-section-empty wiki-section-empty-flex">This section has not been written yet.</div>`;
                }
            });

            // --- 4. NATIVE PAGEBUILDER DELEGATION ---
            if (typeof window.setupTabs === 'function') {
                window.setupTabs('nav', 'tab', tabIdsForPageBuilder, 'major');
            }

            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
            
            if (window.renderMathInElement) {
                renderMathInElement(document.body, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
            
            if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
            return; // EXIT EARLY to guarantee Character logic never runs
        }
        // =====================================================================
        // THE CHARACTER PAGE ENGINE (Legacy Strict Architecture)
        // =====================================================================
        else {
            // Narrow `data` to the active character mode before anything below
            // reads it. A full character's ultimate modes carry their own
            // overview, matchups and counterplay, and every reference in this
            // branch should see that state's write-up rather than the base
            // kit's. resolveModeDesc hands `data` straight back for the base
            // mode - which is every character that declares no modes - so this
            // is a no-op for all 22 pages that exist today.
            const activeMode = dataIsPreScoped ? null : (modeId || window.activeCharacterMode || null);
            if (typeof window.resolveModeDesc === 'function') {
                data = window.resolveModeDesc(data, activeMode);
            }

            // --- 1. OVERVIEW & STRATEGY TAB ---
            const overviewContainer = document.getElementById('tab-overview');
            if (overviewContainer) {
                overviewContainer.innerHTML = '';
                overviewContainer.classList.add('vessel-content', 'space-y-6');

                const topSplit = document.createElement('div');
                topSplit.className = 'profile-top-split';

                let profileHTML = '';
                if (data.profile) {
                    let statsHTML = '';
                    if (data.profile.stats) {
                        data.profile.stats.forEach(stat => {
                            statsHTML += `
                                <div class="profile-stat-row">
                                    <span class="profile-stat-label">${stat.label}</span>
                                    <span class="profile-stat-val">${stat.value}</span>
                                </div>`;
                        });
                    }

                    // The portrait is a fixed square, so the crop has to be
                    // aimable - imageFocus is the nine-point choice made in the
                    // editor, fed to object-position through a custom property.
                    // Whitelisted rather than escaped: this string lands inside
                    // a style attribute, where escaping alone does not stop a
                    // crafted value from closing the declaration and adding its
                    // own.
                    const focus = (window.PORTRAIT_FOCUS_VALUES || []).includes(data.profile.imageFocus)
                        ? data.profile.imageFocus
                        : null;
                    const focusStyle = focus ? ` style="--portrait-focus: ${focus};"` : '';

                    const imgHTML = data.profile.image
                        ? `<img src="${window.escapeHtml(data.profile.image)}" class="profile-portrait" alt="Character Portrait"${focusStyle}>`
                        : `<div class="profile-portrait-missing">[No Portrait]</div>`;

                    profileHTML = `
                        <aside class="wiki-section profile-card">
                            ${imgHTML}
                            <div class="profile-stats-container">${statsHTML}</div>
                        </aside>
                    `;
                }

                const rightColumn = document.createElement('div');
                rightColumn.className = 'profile-text-wrapper';

                const overviewTextWrapper = document.createElement('div');
                overviewTextWrapper.id = 'overview-text-subnode';
                
                rightColumn.appendChild(overviewTextWrapper);

                if (data.playstyle && (data.playstyle.likes?.length > 0 || data.playstyle.dislikes?.length > 0)) {
                     const playstyleDiv = document.createElement('div');
                     playstyleDiv.innerHTML = window.generatePlaystyleHTML(data.playstyle);
                     rightColumn.appendChild(playstyleDiv);
                }

                topSplit.innerHTML = profileHTML;
                topSplit.appendChild(rightColumn);
                overviewContainer.appendChild(topSplit);

                populateTextSection('overview-text-subnode', 'Character Overview', data.overview);
                if (data.strategy && data.strategy.length > 0) {
                    const stratWrapper = document.createElement('div');
                    stratWrapper.id = 'overview-strategy-subnode';
                    overviewContainer.appendChild(stratWrapper);
                    populateTextSection('overview-strategy-subnode', 'General Strategy', data.strategy);
                }

                if (data.extras && data.extras.length > 0) {
                    data.extras.forEach((extraItem, index) => {
                        const extraWrapper = document.createElement('div');
                        extraWrapper.id = `overview-extra-${index}`;
                        overviewContainer.appendChild(extraWrapper);
                        
                        if (extraItem.content) {
                            populateTextSection(`overview-extra-${index}`, extraItem.title, extraItem.content);
                        }
                    });
                }

                window.consolidateTabContributors(overviewContainer);
            }

            // --- 2. MATCHUPS TAB ---
            const matchupsContainer = document.getElementById('tab-matchups');
            if (matchupsContainer) {
                matchupsContainer.innerHTML = '';
                matchupsContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.matchups && data.matchups.length > 0) {
                    data.matchups.forEach(mu => {

                        // window.MATCHUP_TIERS (js/site_utils.js) is the one
                        // definition; resolveMatchupTier also maps the two
                        // words v0.13 renamed, so history replay and anything
                        // submitted before the rename still renders.
                        const tier = window.resolveMatchupTier(mu.tier);

                        const muSection = document.createElement('section');
                        muSection.className = 'wiki-section wiki-section-clip';

                        // The colour comes from the tier table, never from the
                        // stored string, so nothing contributor-written lands
                        // inside a style attribute. The two visible strings are
                        // escaped - both are contributor-submitted.
                        let muHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">vs. ${window.escapeHtml(mu.opponent || 'Unknown')}</h3>
                                <span class="card-tier-label" style="color: ${tier.color};">${window.escapeHtml(tier.id)}</span>
                            </div>
                        `;

                        muSection.innerHTML = muHTML;
                        matchupsContainer.appendChild(muSection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'matchup-content';
                        contentWrapper.id = `matchup-content-${(mu.opponent || 'Unknown').replace(/\s+/g, '-')}`;
                        muSection.appendChild(contentWrapper);

                        if (mu.content && mu.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', mu.content, 'matchup');

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
                        }
                    });

                    window.consolidateTabContributors(matchupsContainer);
                }
            }

            // --- 3. COUNTERPLAY TAB ---
            const counterplayContainer = document.getElementById('tab-counterplay');
            if (counterplayContainer) {
                counterplayContainer.innerHTML = '';
                counterplayContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.counterplay && data.counterplay.length > 0) {
                    data.counterplay.forEach(cp => {

                        const importanceColors = {
                            "Crucial": "#ef4444", "High": "#fb923c",
                            "Moderate": "#facc15", "Low": "#4ade80",
                            "Situational": "#22d3ee"
                        };
                        const impColor = importanceColors[cp.importance] || "#9ca3af";

                        const cpSection = document.createElement('section');
                        cpSection.className = 'wiki-section wiki-section-clip';

                        // Escaped, 2026-08-15. This is the same card shape as
                        // the matchup one twenty lines up, which was escaped
                        // in v0.13 while this was deliberately left alone to
                        // keep that PR to its two items. Both values are
                        // contributor-submitted and land in an innerHTML sink,
                        // so "<img src=x onerror=...>" as a counterplay topic
                        // executed on the live page.
                        //
                        // impColor is not escaped because it is not
                        // interpolated: it comes from the hardcoded map above
                        // with a fixed fallback, so cp.importance selects a
                        // colour rather than supplying one.
                        let cpHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">${window.escapeHtml(cp.topic || 'Unknown')}</h3>
                                <span class="card-tier-label" style="color: ${impColor};">${window.escapeHtml(cp.importance || '')}</span>
                            </div>
                        `;

                        cpSection.innerHTML = cpHTML;
                        counterplayContainer.appendChild(cpSection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'counterplay-content';
                        contentWrapper.id = `counterplay-content-${(cp.topic || 'Unknown').replace(/\s+/g, '-')}`;
                        cpSection.appendChild(contentWrapper);

                        if (cp.content && cp.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
                        }
                    });

                    window.consolidateTabContributors(counterplayContainer);
                } else {
                     counterplayContainer.innerHTML = `
                        <div class="empty-tab-msg">
                            Counterplay analysis has not been written yet.
                        </div>
                    `;
                }
            }

            // --- 4. MOVE STRATEGIES (M1s, Skills, Specials) ---
            if (data.moveStrategies) {
                setTimeout(() => {
                    for (const [moveId, blocks] of Object.entries(data.moveStrategies)) {
                        populateTextSection(`strategy-${moveId}`, 'Move Overview and Strategy', blocks, 'move-strategy');
                    }
                    // Deferred behind the same 300ms wait as the sections
                    // themselves, since the move cards these render into are
                    // built by js/framedata.js on its own schedule.
                    window.FRAME_MOVE_CATEGORIES.forEach(tab => {
                        window.consolidateTabContributors(document.getElementById(`tab-${tab}`));
                    });
                    if (typeof applyInternalStyling === 'function') applyInternalStyling();
                    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
                }, 300); 
            }
        } // End of else block (Character Engine)

        // --- Trigger KaTeX to render LaTeX automatically ---
        if (window.renderMathInElement) {
            renderMathInElement(document.body, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
        
        // --- Auto-Refresh ToC when rendering finishes ---
        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

// --- LAZY MEDIA OBSERVER ---
window.initLazyMedia = function(rootElement = document) {
    const lazyMedia = rootElement.querySelectorAll('video[data-lazy-src], iframe[data-lazy-src]');
    
    if ('IntersectionObserver' in window) {
        const mediaObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const media = entry.target;
                    // Swap the lazy attribute to the real source
                    media.src = media.getAttribute('data-lazy-src');
                    media.removeAttribute('data-lazy-src');
                    
                    // If it's a video meant to auto-play, trigger it once loaded
                    if (media.tagName === 'VIDEO' && media.hasAttribute('autoplay')) {
                        media.play().catch(e => console.warn("Autoplay prevented:", e));
                    }
                    observer.unobserve(media);
                }
            });
        }, { rootMargin: "300px 0px" }); // Start loading 300px BEFORE it enters the screen

        lazyMedia.forEach(media => mediaObserver.observe(media));
    } else {
        // Fallback for ancient browsers
        lazyMedia.forEach(media => {
            media.src = media.getAttribute('data-lazy-src');
            media.removeAttribute('data-lazy-src');
        });
    }
};

window.loadPageDescriptions = loadPageDescriptions;
window.populateTextSection = populateTextSection;