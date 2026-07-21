/**
 * Dogslamloop Wiki - Frame Data Engine
 */

const frameDataLegendHTML = `
    <section class="wiki-section legend-section">
        <h3 class="legend-title">Frame Data Color Legend</h3>
        <div class="legend-grid">
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(217.18, 100%, 50%);"></span><div><span class="legend-name">Startup</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(153.88, 100%, 50%);"></span><div><span class="legend-name">Misc</span>Variable frame data aka no hard number so it always come with a note</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(0, 100%, 45%);"></span><div><span class="legend-name">Active</span>Hitbox view ...</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(295, 89.76%, 50.2%);"></span><div><span class="legend-name">Recovery</span>aka Whiff endlag</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(111.06, 100%, 50%);"></span><div><span class="legend-name">Self Stun</span>for Grab moves mostly</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(34, 99%, 27%);"></span><div><span class="legend-name">InSkill Stun</span>A weird version of Self Stun, but you can move around</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(0, 70%, 35%);"></span><div><span class="legend-name">Target Stun</span>on Hit</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(319.73, 88.24%, 50%);"></span><div><span class="legend-name">Block Endlag</span>aka Extended Recovery</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(44, 100%, 50%);"></span><div><span class="legend-name">Inactive</span>Frames between Active frames</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #ffffff; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Complete I-Frames</span>aka Domain I-Frames</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #ec4899; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Swarm I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #f59e0b; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Explosion I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #3b82f6; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Bullet I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #94a3b8; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Melee I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: transparent; border: 2px solid #14b8a6; box-shadow: inset 0 0 0 2px rgba(0,0,0,0.4); box-sizing: border-box;"></span><div><span class="legend-name">Reverse Hitcancel</span></div></div>
        </div>
    </section>
`;

// Dictionary for standardized game windows (Overlays)
const windowTypes = {
    'reverse-hitcancel': { class: 'span-rhc', label: 'Reverse Hitcancel' },
    'iframe-melee': { class: 'span-iframe-melee', label: 'Melee I-Frames' },
    'iframe-bullet': { class: 'span-iframe-bullet', label: 'Bullet I-Frames' },
    'iframe-explosion': { class: 'span-iframe-explosion', label: 'Explosion I-Frames' },
    'iframe-swarm': { class: 'span-iframe-swarm', label: 'Swarm I-Frames' },
    'iframe-complete': { class: 'span-iframe-complete', label: 'Complete I-Frames' }
};

// --- GLOBAL MANGA TOOLTIP SETUP (Unified with description.js) ---
let frameTooltip = null;

function initTooltip() {
    if (!frameTooltip) {
        frameTooltip = document.getElementById('wiki-frame-tooltip');
        if (!frameTooltip) {
            frameTooltip = document.createElement('div');
            frameTooltip.id = 'wiki-frame-tooltip';
            
            // Explicitly define the heavy manga box styles here so it matches description.js!
            frameTooltip.style.position = 'fixed';
            frameTooltip.style.zIndex = '100000';
            frameTooltip.style.pointerEvents = 'none'; // Prevents it from stealing the hover cursor
            frameTooltip.style.background = 'var(--bg-main, #050505)';
            frameTooltip.style.border = '2px solid var(--border-color, #333)';
            frameTooltip.style.padding = '0.75rem 1rem';
            frameTooltip.style.boxShadow = '6px 6px 0px var(--manga-shadow, #000)';
            frameTooltip.style.maxWidth = '320px';
            frameTooltip.style.color = 'var(--text-white, #fff)';
            frameTooltip.style.fontFamily = 'var(--text-mono)';
            frameTooltip.style.fontSize = '0.75rem';
            frameTooltip.style.display = 'none'; // Hidden by default
            
            document.body.appendChild(frameTooltip);
        }
    }
}

// Helper function to manage tooltip positioning with Boundary Physics
function bindTooltip(element, titleHtml) {
    element.addEventListener('mouseenter', (e) => {
        initTooltip();
        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block'; // Force show
    });
    
    element.addEventListener('mousemove', (e) => {
        if(frameTooltip) {
            // Use clientX/Y instead of pageX/Y so scrolling doesn't break the fixed position!
            let x = e.clientX + 15;
            let y = e.clientY + 15;
            const box = frameTooltip.getBoundingClientRect();
            
            // Boundary Physics: Flip the box if it gets too close to the right/bottom edges
            if (x + box.width > window.innerWidth) {
                x = e.clientX - box.width - 15;
            }
            if (y + box.height > window.innerHeight) {
                y = e.clientY - box.height - 15;
            }
            
            frameTooltip.style.left = x + 'px';
            frameTooltip.style.top = y + 'px';
        }
    });
    
    element.addEventListener('mouseleave', () => {
        if(frameTooltip) {
            frameTooltip.style.display = 'none'; // Force hide
        }
    });
}
// Core frame section generator
function createPhase(phaseObj, totalScale) {
    const phase = document.createElement('div');
    phase.style.position = 'relative'; 
    let styleClass = phaseObj.styleClass || '';

    phase.className = `phase-section ${styleClass}`;
    phase.style.width = `${(phaseObj.duration / totalScale) * 100}%`;

    // --- STACKABLE OVERLAYS (Gradient Glows) ---
    let activeOverlays = [];
    if (phaseObj.overlays) activeOverlays.push(...phaseObj.overlays);
    if (phaseObj.overlay) activeOverlays.push(phaseObj.overlay);

    const hierarchy = ['iframe-melee', 'iframe-bullet', 'iframe-explosion', 'iframe-swarm', 'iframe-complete', 'reverse-hitcancel'];
    activeOverlays.sort((a, b) => hierarchy.indexOf(a) - hierarchy.indexOf(b));

    activeOverlays.forEach(overlayKey => {
        const winDef = windowTypes[overlayKey];
        if (winDef) {
            const overlayEl = document.createElement('div');
            overlayEl.className = `window-overlay ${winDef.class}`;
            phase.appendChild(overlayEl);
        }
    });

    // --- CUSTOM TOOLTIPS ---
    if (phaseObj.label) {
        let tooltipContent = `<strong>${phaseObj.label}</strong>`;
        
        if (activeOverlays.length > 0) {
            let uniqueOverlays = Array.from(new Set(activeOverlays));
            uniqueOverlays.forEach(o => {
                if (windowTypes[o]) {
                    tooltipContent += `<br><span class="tooltip-desc text-purple-400">Has ${windowTypes[o].label}</span>`;
                }
            });
        }
        bindTooltip(phase, tooltipContent);
    }

    for (let i = 0; i < phaseObj.duration; i++) {
        const tick = document.createElement('div');
        tick.className = 'frame-tick';
        phase.appendChild(tick);
    }
    
    return phase;
}

window.cachedMasterFrameData = window.cachedMasterFrameData || {}; 

async function loadMoveSection(pageId, sectionType, targetMoveId = null, pageType = 'character') {
    if (pageType === 'system') return; 

    try {
        let data = null;
        
        // 1. Check Editor Cache
        if (window.cachedMasterFrameData && window.cachedMasterFrameData[pageId]) {
            data = window.cachedMasterFrameData[pageId];
        } 
        // 2. Check Supabase
        else {
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);
                if (cloudData && cloudData.frame_data) {
                    data = cloudData.frame_data;
                    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
                    window.cachedMasterFrameData[pageId] = data; 
                    console.log(`[Cloud] Loaded ${pageId} frame data.`);
                }
            }

            // 3. FALLBACK
            if (!data) {
                const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
                const fdPath = `${rootPath}characters/${pageId.charAt(0).toUpperCase() + pageId.slice(1)}/${pageId}_framedata.json`;
                data = await window.fetchJson(fdPath);
                window.cachedMasterFrameData = window.cachedMasterFrameData || {};
                window.cachedMasterFrameData[pageId] = data;
            }
        }

        if (!data) throw new Error("No frame data found.");

        const container = document.getElementById(`tab-${sectionType}`);
        if (!container) return;

        let movesArray = data[sectionType] || [];

        // If the editor passes a specific move ID, strip out the others so only that move renders.
        if (targetMoveId) {
            movesArray = movesArray.filter(move => move.id === targetMoveId);
        }

        container.innerHTML = ''; 

        const hasFrameData = movesArray.some(move => move.variants);
        if (hasFrameData) {
            container.innerHTML = frameDataLegendHTML;
        }

        movesArray.forEach(move => {
            const card = document.createElement('section');
            card.className = 'skill-entry-card';

            // --- 1. STATS FALLBACK ---
            let statsHTML = '';
            if (move.stats && move.stats.length > 0) {
                move.stats.forEach(stat => {
                    // FIXED: Replaced Tailwind with explicit CSS color
                    const highlightStyle = stat.isHighlighted ? 'color: #ef4444;' : '';
                    statsHTML += `
                        <div class="stat-row">
                            <span class="stat-label">${stat.label}</span> 
                            <span class="stat-value" style="${highlightStyle}">${stat.value}</span>
                        </div>`;
                });
            } else {
                statsHTML = `<div class="stat-row stat-row-empty">No stats recorded</div>`;
            }

            // --- 2. MEDIA & VIDEO FALLBACK ---
            let mediaContent = `<div class="skill-media-missing">[ Missing Media ]</div>`;
            if (move.media?.src) {
                const srcLower = move.media.src.toLowerCase();
                const isVideo = srcLower.endsWith('.mp4') || srcLower.endsWith('.webm');
                const filename = move.media.src.split('/').pop();
                
                if (isVideo) {
                    // Injecting lazy-loading to prevent memory nukes!
                    mediaContent = `
                        <video data-lazy-src="${move.media.src}" class="skill-media-img" autoplay loop muted playsinline style="object-fit: cover;" preload="none"></video>
                        <span class="skill-media-filename">${filename}</span>`;
                } else {
                    mediaContent = `
                        <img data-lazy-src="${move.media.src}" alt="${move.media.alt || ''}" class="skill-media-img">
                        <span class="skill-media-filename">${filename}</span>`;
                }
            }

            card.innerHTML = `
                <div class="skill-entry-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 class="skill-title">${move.name || 'Unknown Move'}</h2>
                        <span class="skill-subtitle">Input: ${move.input || 'N/A'} | Skill Type: ${move.type || 'N/A'} | Damage Type: ${move.damageType || 'N/A'} | ${move.variant || ''}</span>
                    </div>

                    <button class="btn-sys btn-sys-regular" 
                            onclick="window.location.href='../../edit.html?page=${pageId}&type=${pageType}&tab=${sectionType}&move=${move.id}'" 
                            style="display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        Edit Move
                    </button>
                </div>
                <div class="skill-entry-body">
                    <div class="skill-left-col">
                        <div class="skill-media-wrapper ${!move.media?.src ? 'skill-media-wrapper-empty' : ''}">
                            ${mediaContent}
                        </div>
                        <div class="skill-stats-box">${statsHTML}</div>
                    </div>
                    <div class="skill-right-col" id="right-col-${move.id}"></div>
                </div>
            `;

            container.appendChild(card);
            
            const rightCol = document.getElementById(`right-col-${move.id}`);
            const pendingTabs = [];

            // --- 3. RECURSIVE FRAME DATA ENGINE ---
            function buildNestedTabs(dataNode, prefixId, wrapperElement) {

                // LEAF NODE: Render actual frame data
                if (dataNode.bars) {
                    let autoLegendItems = [];
                    let seenPhases = new Set();

                    // --- NEW: SCROLL WRAPPER TO PREVENT OVER-COMPRESSION ---
                    const scrollWrapper = document.createElement('div');
                    scrollWrapper.className = 'frame-scroll-wrapper';
                    scrollWrapper.style.overflowX = 'auto';
                    scrollWrapper.style.paddingBottom = '0.5rem';

                    // Enforce a minimum of 5px per frame so borders never swallow the tick
                    const safeMinWidth = `${dataNode.totalScale * 5}px`;

                    dataNode.bars.forEach(bar => {
                        const barGroup = document.createElement('div');
                        if (bar.type === 'target') barGroup.className = 'bar-group-target';

                        // 1. Conditionally Build Header (Top)
                        const headerText = bar.headerInfo || bar.title || dataNode.headerInfo || '';
                        if (headerText.trim() !== '') {
                            const infoHeader = document.createElement('div');
                            infoHeader.className = 'bar-header-info';
                            if (bar.type === 'target') infoHeader.classList.add('bar-header-target');
                            infoHeader.innerHTML = `<span class="${bar.headerClass || ''}">${headerText}</span>`;
                            barGroup.appendChild(infoHeader);
                        }
                        
                        // 2. Build Timeline (Middle)
                        const timelineContainer = document.createElement('div');
                        timelineContainer.className = 'frame-bar-container';
                        timelineContainer.style.position = 'relative'; 
                        timelineContainer.style.minWidth = safeMinWidth;

                        bar.phases.forEach(phase => {
                            const phaseEl = createPhase(phase, dataNode.totalScale);
                            timelineContainer.appendChild(phaseEl);

                            // --- AUTO-LEGEND COLLECTOR (Standard Phase) ---
                            if (phase.styleClass && phase.styleClass !== 'bg-transparent' && !phase.hideFromLegend) {
                                
                                // Determine the final visible text FIRST
                                let legendText = phase.legendDesc ? phase.legendDesc : phase.label;
                                
                                // NEW: Use the final text to check for duplicates, not the hidden label!
                                const uniqueKey = phase.styleClass + '-' + legendText;
                                
                                if (!seenPhases.has(uniqueKey)) {
                                    seenPhases.add(uniqueKey);
                                    
                                    const safeColors = window.FRAME_COLORS || {};
                                    autoLegendItems.push({
                                        color: safeColors[phase.styleClass] || '#ffffff',
                                        text: legendText
                                    });
                                }
                            }

                            // --- AUTO-LEGEND COLLECTOR (Windows/Overlays) ---
                            let activeWindows = [];
                            if (phase.overlays) activeWindows.push(...phase.overlays);
                            if (phase.overlay) activeWindows.push(phase.overlay);

                            activeWindows.forEach(winKey => {
                                const winDef = windowTypes[winKey];
                                if (winDef) {
                                    const uniqueKey = 'window-' + winKey;
                                    if (!seenPhases.has(uniqueKey)) {
                                        seenPhases.add(uniqueKey);
                                        const safeWindowColors = window.WINDOW_COLORS || {};
                                        autoLegendItems.push({
                                            color: safeWindowColors[winKey] || '#ffffff',
                                            text: winDef.label,
                                            isWindow: true,
                                            cssClass: winDef.class
                                        });
                                    }
                                }
                            });
                        });
                        
                        barGroup.appendChild(timelineContainer);

                        // 3. Conditionally Build Footer (Bottom)
                        if (bar.footerInfo && bar.footerInfo.trim() !== '') {
                            const infoFooter = document.createElement('div');
                            infoFooter.className = 'bar-header-info'; // Reusing font styling class
                            infoFooter.style.marginTop = '0.25rem';  // Give it a gap from the timeline
                            infoFooter.style.marginBottom = '0.5rem';
                            infoFooter.innerHTML = `<span class="${bar.headerClass || ''}">${bar.footerInfo}</span>`;
                            barGroup.appendChild(infoFooter);
                        }
                        
                        scrollWrapper.appendChild(barGroup);
                    });

                    const rulerContainer = document.createElement('div');
                    rulerContainer.className = 'frame-ruler';

                    // Apply the EXACT SAME minimum width to the ruler so it scales perfectly with the bars
                    rulerContainer.style.minWidth = safeMinWidth;
                    
                    const tickInterval = dataNode.totalScale > 100 ? 20 : 10;
                    
                    for (let i = 0; i <= dataNode.totalScale; i += tickInterval) {
                        const tickMark = document.createElement('div');
                        tickMark.className = 'ruler-tick';
                        tickMark.style.left = `${(i / dataNode.totalScale) * 100}%`;
                        tickMark.innerHTML = `<div class="ruler-notch"></div><span class="ruler-label">${i}</span>`;
                        rulerContainer.appendChild(tickMark);
                    }
                    
                    scrollWrapper.appendChild(rulerContainer);

                    // Finally, append the full scroll wrapper to the view
                    wrapperElement.appendChild(scrollWrapper);

                    // Render Legend
                    const legendData = (dataNode.inlineLegend && dataNode.inlineLegend.length > 0) 
                        ? dataNode.inlineLegend 
                        : autoLegendItems;

                    if (legendData.length > 0) {

                        const legendGrid = document.createElement('div');

                        legendGrid.style.cssText = "display: flex; flex-direction: column; gap: 0.35rem; padding: 0 1.5rem 1.5rem 1.5rem; font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-primary); line-height: 1.4;";

                        legendData.forEach(item => {
                            const legendItem = document.createElement('div');

                            legendItem.style.cssText = "display: flex; align-items: flex-start; gap: 0.4rem;";

                            if (item.isWindow) {
                                legendItem.innerHTML = `<span style="width: 0.6rem; height: 0.6rem; background: transparent; border: 2px solid ${item.color}; box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.4); flex-shrink: 0; margin-top: 0.15rem;"></span><span>${item.text}</span>`;
                            } else {
                                legendItem.innerHTML = `<span style="width: 0.6rem; height: 0.6rem; background: ${item.color}; border: 1px solid #000; flex-shrink: 0; margin-top: 0.15rem;"></span><span>${item.text}</span>`;
                            }
                            legendGrid.appendChild(legendItem);
                        });
                        wrapperElement.appendChild(legendGrid);
                    }
                    return;
                }

                // BRANCH NODE: Generate a new row of tabs
                if (dataNode.variants) {
                    const keys = Object.keys(dataNode.variants);
                    if (keys.length === 0) return;

                    const tabBar = document.createElement('div');
                    tabBar.className = 'skill-tab-bar';
                    
                    if (prefixId !== move.id) {
                        tabBar.classList.add('skill-tab-bar-nested');
                    }

                    const viewsWrapper = document.createElement('div');
                    viewsWrapper.className = 'views-wrapper';

                    keys.forEach((key, index) => {
                        const childNode = dataNode.variants[key];
                        const childId = `${prefixId}-${key}`;

                        const btn = document.createElement('button');
                        btn.id = `tab-${childId}`;
                        btn.className = `btn-manga btn-manga-slanted btn-manga-gray ${index === 0 ? 'active' : ''}`;
                        btn.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${childNode.label || key}</span></div>`;
                        tabBar.appendChild(btn);

                        const viewSection = document.createElement('div');
                        viewSection.id = `view-${childId}`;
                        viewSection.className = `view-section ${index === 0 ? '' : 'hidden'}`;

                        // --- NATIVE TAB SWITCHER ---
                        // Instantly hides/shows the preloaded timelines without recalculating
                        btn.addEventListener('click', () => {
                            Array.from(tabBar.children).forEach(b => b.classList.remove('active'));
                            Array.from(viewsWrapper.children).forEach(v => v.classList.add('hidden'));
                            btn.classList.add('active');
                            viewSection.classList.remove('hidden');
                        });

                        buildNestedTabs(childNode, childId, viewSection);
                        viewsWrapper.appendChild(viewSection);
                    });

                    wrapperElement.appendChild(tabBar);
                    wrapperElement.appendChild(viewsWrapper);
                }
            }

            if (move.variants && Object.keys(move.variants).length > 0) {
                // Generates the entire recursive tree at once
                buildNestedTabs({ variants: move.variants }, move.id, rightCol);
            } else {
                rightCol.innerHTML = `
                    <div class="empty-tab-msg empty-frame-data-msg">
                        Frame data has not been mapped for this move yet.
                    </div>
                `;
            }
            
            // --- 4. STRATEGY INJECTION TARGET ---
            const strategyTarget = document.createElement('div');
            strategyTarget.id = `strategy-${move.id}`;
            card.appendChild(strategyTarget);
        });



    } catch (error) {
        console.error(`Failed handling live frame engine synchronization updates for ${sectionType}:`, error);
    }

    // AWAKEN THE LAZY OBSERVER
    if (typeof window.initLazyMedia === 'function') {
        const container = document.getElementById(`tab-${sectionType}`);
        if (container) window.initLazyMedia(container);
    }

    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
}

async function loadCharacterSkills(characterId) {
    return loadMoveSection(characterId, 'skills');
}

window.createPhase = createPhase;
window.loadMoveSection = loadMoveSection;
window.loadCharacterSkills = loadCharacterSkills;