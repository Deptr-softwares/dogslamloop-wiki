/**
 * Dogslamloop Wiki - Frame Data Engine
 */

const frameDataLegendHTML = `
    <section class="wiki-section legend-section">
        <h3 class="legend-title">Frame Data Color Legend</h3>
        <div class="legend-grid">
            <div class="legend-item"><span class="legend-swatch bg-tick-start"></span><div><span class="legend-name">Startup</span></div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-misc"></span><div><span class="legend-name">Misc</span>Variable frame data aka no hard number so it always come with a note</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-active"></span><div><span class="legend-name">Active</span>Hitbox view ...</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-recov"></span><div><span class="legend-name">Recovery</span>aka Whiff endlag</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-selfstun"></span><div><span class="legend-name">Self Stun</span>for Grab moves mostly</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-inskillstun"></span><div><span class="legend-name">InSkill Stun</span>A weird version of Self Stun, but you can move around</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-targetstun"></span><div><span class="legend-name">Target Stun</span>on Hit</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-blockendlag"></span><div><span class="legend-name">Block Endlag</span>aka Extended Recovery</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-inactive"></span><div><span class="legend-name">Inactive</span>Frames between Active frames</div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-complete"></span><div><span class="legend-name">Complete I-Frames</span>aka Domain I-Frames</div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-swarm"></span><div><span class="legend-name">Swarm I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-explosion"></span><div><span class="legend-name">Explosion I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-bullet"></span><div><span class="legend-name">Bullet I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-melee"></span><div><span class="legend-name">Melee I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-rhc"></span><div><span class="legend-name">Reverse Hitcancel</span></div></div>
        </div>

        <!-- The one thing on this page that is a convention rather than a
             colour. It has to be stated once, or a reader has no way to learn
             that a smooth block means "nobody counted this". -->
        <p class="legend-estimate-note">
            <span class="legend-swatch legend-swatch-estimate bg-tick-recov"></span>
            A bar divided into single frames was <strong>counted</strong>. A smooth block with no
            divisions is an <strong>estimate</strong>, hover over it for more.
        </p>
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

// initTooltip/bindTooltip are defined once, in site_utils.js (loaded before
// this file), and shared with description.js's inline callout tooltips.

// Core frame section generator
// --- QUALITATIVE FRAME DATA ---
// A pro who knows how an endlag *feels* should be able to record it without
// counting frames. Seven steps, the owner's own wording, ordered from nothing
// to unrecoverable.
//
// `frames` is a nominal weight for layout only. It exists so an estimated
// phase occupies believable space next to measured ones - it is never shown as
// a number and must never be read as one, which is exactly why an estimated
// phase renders with no tick divisions: the ticks are the visual language for
// "counted", so their absence says "estimated" with no legend required. That
// is the owner's design, and it is better than a marker plus styling because
// it also withholds the per-frame view, which would be meaningless here.
window.FRAME_ESTIMATES = [
    { id: 'none', label: 'Non-existent', frames: 0 },
    { id: 'very-short', label: 'Very short', frames: 3 },
    { id: 'short', label: 'Short', frames: 8 },
    { id: 'mid', label: 'Mid', frames: 16 },
    { id: 'high', label: 'High', frames: 28 },
    { id: 'very-high', label: 'Very high', frames: 45 },
    { id: 'rip', label: 'RIP', frames: 70 },
];

window.frameEstimate = function(id) {
    if (!id) return null;
    return (window.FRAME_ESTIMATES || []).find(e => e.id === id) || null;
};

// The frames a phase occupies on the timeline, measured or estimated.
window.phaseWeight = function(phaseObj) {
    const estimate = window.frameEstimate(phaseObj && phaseObj.estimate);
    if (estimate) return estimate.frames;
    return Number(phaseObj && phaseObj.duration) || 0;
};

function createPhase(phaseObj, totalScale) {
    const phase = document.createElement('div');
    phase.style.position = 'relative';
    let styleClass = phaseObj.styleClass || '';

    const estimate = window.frameEstimate(phaseObj.estimate);

    phase.className = `phase-section ${styleClass}${estimate ? ' phase-estimated' : ''}`;
    phase.style.width = `${(window.phaseWeight(phaseObj) / totalScale) * 100}%`;

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
    if (phaseObj.label || estimate) {
        let tooltipContent = `<strong>${phaseObj.label || (estimate ? estimate.label : '')}</strong>`;

        // Said in words as well as shown by the missing divisions. Somebody
        // reading a hover has already decided they want the detail, and the
        // one detail an estimate must not hide is that it is an estimate.
        if (estimate) {
            tooltipContent += `<br><span class="tooltip-desc tooltip-desc-estimate">Estimated: ${estimate.label.toLowerCase()} - not frame-counted</span>`;
        }
        
        if (activeOverlays.length > 0) {
            let uniqueOverlays = Array.from(new Set(activeOverlays));
            uniqueOverlays.forEach(o => {
                if (windowTypes[o]) {
                    tooltipContent += `<br><span class="tooltip-desc text-purple-400">Has ${windowTypes[o].label}</span>`;
                }
            });
        }
        window.bindTooltip(phase, tooltipContent);
    }

    // No ticks for an estimate - that absence IS the marker. Drawing them would
    // claim a per-frame breakdown nobody measured.
    if (!estimate) {
        for (let i = 0; i < phaseObj.duration; i++) {
            const tick = document.createElement('div');
            tick.className = 'frame-tick';
            phase.appendChild(tick);
        }
    }

    return phase;
}

window.cachedMasterFrameData = window.cachedMasterFrameData || {}; 

async function loadMoveSection(pageId, sectionType, targetMoveId = null, pageType = 'character', modeId = null) {
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

        // A full character's ultimate modes replace the whole moveset, so which
        // array this tab renders depends on the active mode. resolveModeFrame
        // hands back `data` itself for the base mode, which is every character
        // that declares no modes - so this is a no-op for all of them.
        const activeMode = modeId || window.activeCharacterMode || null;
        const scopedData = typeof window.resolveModeFrame === 'function'
            ? window.resolveModeFrame(data, activeMode)
            : data;

        let movesArray = scopedData[sectionType] || [];

        // If the editor passes a specific move ID, strip out the others so only that move renders.
        if (targetMoveId) {
            movesArray = movesArray.filter(move => move.id === targetMoveId);
        }

        container.innerHTML = '';

        // An empty move tab used to render as a blank white void with no
        // explanation - indistinguishable from a page that failed to load.
        // It became worth naming once modes arrived: switching to an ultimate
        // state whose Skills have not been written yet is a normal, expected
        // thing to land on, not a broken page.
        // No early return: the legend below is skipped on its own for an empty
        // array, the render loop does nothing, and the lazy-media and TOC
        // passes after the try block still need to run.
        if (movesArray.length === 0 && !targetMoveId) {
            container.innerHTML = `<div class="empty-tab-msg">Nothing has been recorded here yet.</div>`;
        }

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
                // Extension is read off the path, not the whole URL. A raw
                // endsWith missed anything carrying a query string or
                // fragment - "clip.mp4?t=123" is ordinary for storage URLs -
                // and only knew mp4/webm, while the media library accepts
                // anything video/*. Those all fell through to the <img>
                // branch, which cannot play a video: that is why mp4 looked
                // unsupported in skill cards.
                const path = move.media.src.split(/[?#]/)[0].toLowerCase();
                const isVideo = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].some(ext => path.endsWith(ext));
                // .gif stays an image on purpose - it animates on its own.
                const filename = path.split('/').pop();
                const esc = window.escapeHtml;
                const altText = move.media.alt || '';

                if (isVideo) {
                    // Injecting lazy-loading to prevent memory nukes!
                    //
                    // aria-label, not alt: <video> has no alt attribute, so
                    // alt text entered against a video-media move used to go
                    // nowhere at all - which is how "alt text does not
                    // persist" was reported. It persisted fine in the data;
                    // it just had nothing to render into. Plenty of skill
                    // media is .mp4/.webm, so this was the common case.
                    mediaContent = `
                        <video data-lazy-src="${esc(move.media.src)}" class="skill-media-img"${altText ? ` aria-label="${esc(altText)}"` : ''} autoplay loop muted playsinline style="object-fit: cover;" preload="none"></video>
                        <span class="skill-media-filename">${esc(filename)}</span>`;
                } else {
                    // Native loading="lazy" with a real src, matching how
                    // description.js renders wiki images. This carried
                    // data-lazy-src before, but initLazyMedia only ever
                    // promoted video[data-lazy-src] and iframe[data-lazy-src]
                    // - never img - so every static image in a skill card
                    // rendered with no source at all.
                    mediaContent = `
                        <img src="${esc(move.media.src)}" alt="${esc(altText)}" class="skill-media-img" loading="lazy">
                        <span class="skill-media-filename">${esc(filename)}</span>`;
                }
            }

            card.innerHTML = `
                <div class="skill-entry-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 class="skill-title">${window.escapeHtml(move.name || 'Unknown Move')}</h2>
                        <span class="skill-subtitle">Input: ${window.escapeHtml(move.input || 'N/A')} | Skill Type: ${window.escapeHtml(move.type || 'N/A')} | Damage Type: ${window.escapeHtml(move.damageType || 'N/A')} | ${window.escapeHtml(move.variant || '')}</span>
                    </div>

                    <!-- move.id is contributor-submitted and used to be built
                         straight into an inline onclick, where a quote closed
                         the handler and ran whatever followed, on every
                         character page. Wired below from a data attribute
                         instead, per the project's own rule. -->
                    <button class="btn-sys btn-sys-regular skill-edit-move-btn"
                            data-move-id="${window.escapeHtml(move.id || '')}"
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

            // Shape the box to the media rather than cropping the media to the
            // box. Runs after append so the element is measurable, and hooks
            // load/loadedmetadata because a lazy video reports nothing until
            // the card scrolls into view.
            if (typeof window.applyMediaFraming === 'function') {
                window.applyMediaFraming(
                    card.querySelector('.skill-media-img'),
                    card.querySelector('.skill-media-wrapper'),
                    move.media
                );
            }

            const editBtn = card.querySelector('.skill-edit-move-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const params = new URLSearchParams({
                        page: pageId, type: pageType, tab: sectionType, move: editBtn.dataset.moveId || '',
                    });
                    window.location.href = `../../edit.html?${params}`;
                });
            }

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

window.createPhase = createPhase;
window.loadMoveSection = loadMoveSection;