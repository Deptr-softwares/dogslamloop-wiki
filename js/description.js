/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

// Helper to assign CSS classes and dynamic inline widths for media
function getMediaAttributes(align, customWidth) {
    let alignClass = 'wiki-media-full';
    
    // Determine the class based on alignment
    if (align === 'left') alignClass = 'wiki-media-left';
    else if (align === 'right') alignClass = 'wiki-media-right';
    else if (align === 'center') alignClass = 'wiki-media-center';

    // Build the string: class first, then inline width
    return `class="wiki-media ${alignClass}" style="width: ${customWidth || '100%'};"`;
}

// Helper to apply dynamic text alignment and prevent long-word overflow
function getAlignStyle(align) {
    let styleStr = 'overflow-wrap: break-word; word-break: break-word;';
    if (align) styleStr += ` text-align: ${align};`;
    return `style="${styleStr}"`;
}

function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.classList.add('vessel-content', 'space-y-4'); 

    if (blocks && blocks.length > 0) {
        const section = document.createElement('section');

        if (contextClass === 'matchup' || contextClass === 'counterplay') {
            section.className = 'strategy-content'; // Clean, flat, wrapper-less class
        } else {
            section.className = 'wiki-section';
            if (contextClass) section.classList.add(contextClass);
        }           
        let contentHTML = `<h3 class="strategy-title" style="font-size: 1.15rem;">${sectionTitle}</h3>`;

        const sectionAuthors = new Set();
                
        blocks.forEach(block => {
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
                // Fixed broken double quotes syntax from old inline strings
                contentHTML += `<img src="${block.src}" alt="${block.alt || 'Wiki Image'}" ${getMediaAttributes(block.align, block.width)} loading="lazy">`;
            }
            else if (block.type === 'video') {
                const posterAttr = block.poster ? `poster="${block.poster}"` : '';

                if (block.controls) {
                    contentHTML += `<video src="${block.src}" ${posterAttr} ${getMediaAttributes(block.align, block.width)} controls preload="none"></video>`;
                } else {
                    contentHTML += `<video src="${block.src}" ${posterAttr} ${getMediaAttributes(block.align, block.width)} autoplay loop muted playsinline preload="metadata"></video>`;
                }
            }
            // --- DIVIDERS ---
            else if (block.type === 'divider') {
                if (block.invisible) {
                    // Acts as a pure spacer and float-clearer
                    contentHTML += `<div style="clear: both; padding-top: 1.5rem;"></div>`;
                } else {
                    // Standard visible line (Styles handled by UI.css)
                    contentHTML += `<hr class="view-divider">`;
                }
            }
            // --- STANDALONE AUTHOR BLOCK ---
            else if (block.type === 'author') {
            }
            // --- INLINE CALLOUTS ---
            else if (block.type === 'callout') {
                // Map intents to simple text colors and icons
                const intentMap = {
                    'tip': { class: 'text-yellow-400', icon: '💡', label: 'Tip' },
                    'warning': { class: 'text-orange-400', icon: '⚠️', label: 'Warning' },
                    'danger': { class: 'text-red-500', icon: '🚨', label: 'Danger' },
                    'info': { class: 'text-cyan-400', icon: '📌', label: 'Info' }
                };
                const config = intentMap[block.intent] || intentMap['info'];
                const text = Array.isArray(block.content) ? block.content.join('<br>') : block.content;

                // Build the HTML payload for the tooltip
                    let tooltipContent = '';
                    if (block.title) tooltipContent += `<strong style="color: currentColor;">${block.title}</strong><br>`;
                    tooltipContent += `<span class="tooltip-desc">${text}</span>`;

                    // Wrapped in an alignment container so the button can be centered/right-aligned
                    contentHTML += `
                        <div ${alignAttr} style="margin: 0.5rem 0;">
                            <span class="inline-callout-btn ${config.class}" data-tooltip="${encodeURIComponent(tooltipContent)}">
                                ${config.icon} ${config.label}
                            </span>
                        </div>
                    `;
            }
            // --- DATA TABLES ---
            else if (block.type === 'table') {
                let tableHTML = `<div style="overflow-x: auto; margin: 1.5rem 0; border: 1px solid var(--border-color); border-radius: 6px;"><table class="update-table" style="width: 100%; text-align: left; border-collapse: collapse;">`;
                
                if (block.headers && block.headers.length > 0) {
                    tableHTML += `<thead><tr style="background: rgba(0,0,0,0.5);">`;
                    block.headers.forEach(h => { 
                        tableHTML += `<th style="padding: 0.75rem 1rem; border-bottom: 2px solid var(--border-color); font-family: var(--text-mono); color: var(--accent-blue); text-transform: uppercase; font-size: 0.85rem;">${h}</th>`; 
                    });
                    tableHTML += `</tr></thead>`;
                }
                
                if (block.rows && block.rows.length > 0) {
                    tableHTML += `<tbody>`;
                    block.rows.forEach(row => {
                        tableHTML += `<tr style="transition: background 0.1s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">`;
                        row.forEach(cell => {
                            // FIXED: Only parse keybinds here. internalstyling.js handles [color], [b], [url] automatically!
                            let parsedCell = cell.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                            tableHTML += `<td style="padding: 0.75rem 1rem; border-bottom: 1px solid #222; font-size: 0.9rem;">${parsedCell}</td>`;
                        });
                        tableHTML += `</tr>`;
                    });
                    tableHTML += `</tbody>`;
                }
                
                tableHTML += `</table></div>`;
                contentHTML += tableHTML;
            }

            // --- YOUTUBE EMBEDS ---
            else if (block.type === 'youtube') {
                contentHTML += `<iframe src="https://www.youtube.com/embed/${block.videoId}" ${getMediaAttributes(block.align, block.width)} frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="aspect-ratio: 16/9; border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow);"></iframe>`;
            }
            // --- ACCORDIONS (Collapsible Deep Dives) ---
            else if (block.type === 'accordion') {

                let text = '';
                if (Array.isArray(block.content)) {
                    if (block.content.length > 0 && block.content[0].type === 'paragraph') {
                        // Extract from the nested paragraph and apply the [M1] keybind badges
                        const rawText = Array.isArray(block.content[0].content) ? block.content[0].content.join('<br>') : block.content[0].content;
                        text = rawText.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                    } else if (typeof block.content[0] === 'string') {
                        // Fallback for older flat string arrays
                        text = block.content.join('<br>');
                    }
                } else {
                    text = block.content || '';
                }
                
                let alignClass = 'accordion-full';
                let widthStyle = 'width: 100%;';
                // Apply flexible wrapping widths based on alignment
                if (block.align === 'left') { 
                    alignClass = 'accordion-left'; 
                    widthStyle = `width: ${block.width || '45%'};`; 
                } else if (block.align === 'right') { 
                    alignClass = 'accordion-right'; 
                    widthStyle = `width: ${block.width || '45%'};`; 
                } else if (block.align === 'center') { 
                    alignClass = 'accordion-center'; 
                    widthStyle = `width: ${block.width || '75%'};`; 
                } else if (block.width) {
                    widthStyle = `width: ${block.width};`;
                }

                contentHTML += `
                    <details class="wiki-accordion ${alignClass}" style="${widthStyle}">
                        <summary class="wiki-accordion-summary">
                            <span class="accordion-icon">►</span> ${block.title}
                        </summary>
                        <div class="wiki-accordion-content">
                            <p style="margin:0;">${text}</p>
                        </div>
                    </details>
                `;
            }
            // --- COMBO STRINGS ---
            else if (block.type === 'combo') {
                if (block.sequence && block.sequence.length > 0) {
                    
                    // Determine flex justification based on alignment
                    let justifyClass = 'flex-start';
                    if (block.align === 'center') justifyClass = 'center';
                    if (block.align === 'right') justifyClass = 'flex-end';

                    let comboHTML = `<div class="combo-container" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: ${justifyClass}; gap: 0.5rem; margin: 1.5rem 0;">`;
                    
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
                        comboHTML += `<div style="display:flex; align-items:center; gap:0.75rem; ${pushRight}">`;
                        
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
            // Wrap each author in a badge span
            const authorBadges = Array.from(sectionAuthors)
                .map(a => `<span class="author-badge">${a}</span>`)
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

        // --- CLEARFIX TO PREVENT FLOAT ESCAPE ---
        // Forces the parent container to wrap completely around left/right aligned images!
        contentHTML += `<div style="clear: both; display: table;"></div>`;

        section.innerHTML = contentHTML;
        container.appendChild(section);

        // --- BIND CALLOUT TOOLTIPS ---
        const callouts = section.querySelectorAll('.inline-callout-btn');
        callouts.forEach(btn => {
            const decodedTooltip = decodeURIComponent(btn.getAttribute('data-tooltip'));
            
            btn.addEventListener('mouseenter', (e) => {
                // Ensure tooltip div exists (reusing your framedata logic)
                let frameTooltip = document.getElementById('wiki-frame-tooltip');
                if (!frameTooltip) {
                    frameTooltip = document.createElement('div');
                    frameTooltip.id = 'wiki-frame-tooltip';
                    frameTooltip.className = 'manga-tooltip';
                    document.body.appendChild(frameTooltip);
                }
                frameTooltip.innerHTML = decodedTooltip;
                frameTooltip.classList.add('visible');
            });
            
            btn.addEventListener('mousemove', (e) => {
                const frameTooltip = document.getElementById('wiki-frame-tooltip');
                if(frameTooltip) {
                    frameTooltip.style.left = (e.pageX + 15) + 'px';
                    frameTooltip.style.top = (e.pageY + 15) + 'px';
                }
            });
            
            btn.addEventListener('mouseleave', () => {
                const frameTooltip = document.getElementById('wiki-frame-tooltip');
                if(frameTooltip) frameTooltip.classList.remove('visible');
            });
        });
    } else {
        // Now perfectly hooks into your native UI.css .empty-tab-msg class
        container.innerHTML = `
            <div class="empty-tab-msg">
                "${sectionTitle}" analysis has not been written yet.
            </div>
        `;
    }
}

async function loadPageDescriptions(pageId, pageType = 'character') {
    try {
        let data = null;
        
        // 1. Check Editor Cache (For Live Preview pane)
        if (window.currentEditorDescData) {
            data = window.currentEditorDescData;
        } 
        // 2. Check Supabase Cloud Database (Ensure your fetchCloudCharacterData uses page_id in its SQL!)
        else {
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
                
                data = await window.fetchJson(descPath);
                console.log(`[Local] Loaded ${pageId} descriptions from ${pageType} directory.`);
            }
        }

        if (!data) throw new Error("No descriptive data found.");

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

                const imgHTML = data.profile.image 
                    ? `<img src="${data.profile.image}" class="profile-portrait" alt="Character Portrait">` 
                    : `<div class="profile-portrait-missing">[No Portrait]</div>`;

                profileHTML = `
                    <aside class="wiki-section profile-card">
                        ${imgHTML}
                        <div class="profile-stats-container">${statsHTML}</div>
                    </aside>
                `;
            }

            const overviewTextWrapper = document.createElement('div');
            overviewTextWrapper.id = 'overview-text-subnode';
            overviewTextWrapper.className = 'profile-text-wrapper';

            topSplit.innerHTML = profileHTML;
            topSplit.appendChild(overviewTextWrapper);
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
        }

        // --- 2. MATCHUPS TAB ---
        const matchupsContainer = document.getElementById('tab-matchups');
        if (matchupsContainer) {
            matchupsContainer.innerHTML = '';
            matchupsContainer.classList.add('vessel-content', 'space-y-6'); 

            if (data.matchups && data.matchups.length > 0) {
                data.matchups.forEach(mu => {
                    const tierColors = {
                        "Unwinnable": "text-red-600", "Extreme Disadvantage": "text-red-500",
                        "Disadvantage": "text-orange-400", "Equal": "text-gray-400",
                        "Advantage": "text-green-400", "Extreme Advantage": "text-green-500",
                        "Unloseable": "text-cyan-400"
                    };
                    const tierClass = tierColors[mu.tier] || "text-white";

                    const muSection = document.createElement('section');
                    muSection.className = 'wiki-section'; 
                    muSection.style.overflow = 'hidden'; 

                    let muHTML = `
                        <div class="card-header-flex">
                            <h3 class="card-header-title">vs. ${mu.opponent}</h3>
                            <span class="card-tier-label ${tierClass}">${mu.tier}</span>
                        </div>
                    `;

                    muSection.innerHTML = muHTML;
                    matchupsContainer.appendChild(muSection);

                    const contentWrapper = document.createElement('div');
                    contentWrapper.className = 'matchup-content'; // Added class here instead
                    contentWrapper.id = `matchup-content-${(mu.opponent || 'Unknown').replace(/\s+/g, '-')}`;
                    muSection.appendChild(contentWrapper);

                    if (mu.content && mu.content.length > 0) {
                        populateTextSection(contentWrapper.id, '', mu.content, 'matchup');
                        
                        // Clean up the empty h3 injected by the populate helper
                        const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                        if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                    } else {
                        contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
                    }
                });
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
                        "Crucial": "text-red-500", "High": "text-orange-400",
                        "Moderate": "text-yellow-400", "Low": "text-green-400",
                        "Situational": "text-cyan-400"
                    };
                    const importanceClass = importanceColors[cp.importance] || "text-gray-400";

                    const cpSection = document.createElement('section');
                    cpSection.className = 'wiki-section'; 
                    cpSection.style.overflow = 'hidden';

                    let cpHTML = `
                        <div class="card-header-flex">
                            <h3 class="card-header-title">${cp.topic}</h3>
                            <span class="card-tier-label ${importanceClass}">${cp.importance}</span>
                        </div>
                    `;

                    cpSection.innerHTML = cpHTML;
                    counterplayContainer.appendChild(cpSection);

                    const contentWrapper = document.createElement('div');
                    contentWrapper.className = 'counterplay-content'; // Added class here instead
                    contentWrapper.id = `counterplay-content-${(cp.topic || 'Unknown').replace(/\s+/g, '-')}`;
                    cpSection.appendChild(contentWrapper);

                    if (cp.content && cp.content.length > 0) {
                        populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');
                        
                        const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                        if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                    } else {
                        contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
                    }
                });
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
                    populateTextSection(`strategy-${moveId}`, 'Move Overview and Strategy', blocks);

                    const strategyContainer = document.getElementById(`strategy-${moveId}`);
                    if (strategyContainer) {
                        strategyContainer.style.marginBottom = '3rem';
                    }
                }
                
                if (typeof applyInternalStyling === 'function') {
                    applyInternalStyling();
                }
                if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
            }, 300); 
        }

        

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

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

window.loadPageDescriptions = loadPageDescriptions;
window.loadCharacterDescriptions = loadPageDescriptions;
window.populateTextSection = populateTextSection;