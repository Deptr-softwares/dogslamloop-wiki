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
        </div>
    </section>
`;

// Core frame section generator
function createPhase(duration, totalScale, styleClass, label) {
    const phase = document.createElement('div');
    phase.className = `phase-section ${styleClass}`;
    // Width is kept inline because it relies on dynamic math calculations
    phase.style.width = `${(duration / totalScale) * 100}%`;
    
    if (label) {
        phase.setAttribute('title', label);
    }

    for (let i = 0; i < duration; i++) {
        const tick = document.createElement('div');
        tick.className = 'frame-tick';
        phase.appendChild(tick);
    }
    
    return phase;
}

let cachedMasterFrameData = {}; 

async function loadMoveSection(characterId, sectionType) {
    try {
        let data;
        
        if (cachedMasterFrameData[characterId]) {
            data = cachedMasterFrameData[characterId];
        } else {
            data = await window.fetchJson(`./${characterId}_framedata.json`);
            if (!data) throw new Error(`Could not fetch master frame data for ${characterId}.`);
            
            cachedMasterFrameData[characterId] = data;
        }
        
        const container = document.getElementById(`tab-${sectionType}`);
        if (!container) return;

        const movesArray = data[sectionType] || [];
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
                    const textClass = stat.isHighlighted ? 'class="text-purple-400"' : '';
                    statsHTML += `
                        <div class="stat-row">
                            <span class="stat-label">${stat.label}</span> 
                            <span class="stat-value" ${textClass}>${stat.value}</span>
                        </div>`;
                });
            } else {
                statsHTML = `<div class="stat-row stat-row-empty">No stats recorded</div>`;
            }

            // --- 2. MEDIA FALLBACK ---
            const mediaContent = move.media?.src 
                ? `<img src="${move.media.src}" alt="${move.media.alt || ''}" class="skill-media-img">
                   <span class="skill-media-filename">${move.media.src.split('/').pop()}</span>`
                : `<div class="skill-media-missing">
                       [ Missing Media ]
                   </div>`;

            card.innerHTML = `
                <div class="skill-entry-header">
                    <div>
                        <h2 class="skill-title">${move.name || 'Unknown Move'}</h2>
                        <span class="skill-subtitle">Input: ${move.input || 'N/A'} | Skill Type: ${move.type || 'N/A'} | ${move.variant || ''}</span>
                    </div>
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
                    dataNode.bars.forEach(bar => {
                        const barGroup = document.createElement('div');
                        if (bar.type === 'target') barGroup.className = 'bar-group-target';

                        const infoHeader = document.createElement('div');
                        infoHeader.className = 'bar-header-info';
                        if (bar.type === 'target') infoHeader.classList.add('bar-header-target');
                        
                        const headerText = bar.headerInfo || bar.title || dataNode.headerInfo || '';
                        let headerContent = `<span class="${bar.headerClass || ''}">${headerText}</span>`;
                        
                        if (bar.advantageText) {
                            const advantageColor = bar.advantageText.includes('-') ? 'text-red-400' : 'text-green-400';
                            headerContent += `<span class="${advantageColor} font-bold tracking-wider">${bar.advantageText}</span>`;
                        }
                        infoHeader.innerHTML = headerContent;
                        
                        const timelineContainer = document.createElement('div');
                        timelineContainer.className = 'frame-bar-container';

                        bar.phases.forEach(phase => {
                            const phaseEl = createPhase(phase.duration, dataNode.totalScale, phase.styleClass, phase.label);
                            timelineContainer.appendChild(phaseEl);
                        });

                        if (bar.type === 'target') {
                            barGroup.appendChild(timelineContainer);
                            barGroup.appendChild(infoHeader);
                        } else {
                            barGroup.appendChild(infoHeader);
                            barGroup.appendChild(timelineContainer);
                        }
                        wrapperElement.appendChild(barGroup);
                    });

                    if (dataNode.inlineLegend && dataNode.inlineLegend.length > 0) {
                        const divider = document.createElement('hr');
                        divider.className = 'view-divider';
                        wrapperElement.appendChild(divider);

                        const legendGrid = document.createElement('div');
                        legendGrid.className = 'view-legend-grid';

                        dataNode.inlineLegend.forEach(item => {
                            const legendItem = document.createElement('span');
                            legendItem.className = 'legend-inline-item';
                            // Background-color is kept inline because it relies on JSON specific data
                            legendItem.innerHTML = `<span class="dot" style="background-color: ${item.color};"></span><span>${item.text}</span>`;
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
                        btn.className = `skill-tab-btn ${index === 0 ? 'active' : ''}`;
                        btn.textContent = childNode.label || key;
                        tabBar.appendChild(btn);

                        const viewSection = document.createElement('div');
                        viewSection.id = `view-${childId}`;
                        viewSection.className = `view-section ${index === 0 ? '' : 'hidden'}`;

                        buildNestedTabs(childNode, childId, viewSection);

                        viewsWrapper.appendChild(viewSection);
                    });

                    wrapperElement.appendChild(tabBar);
                    wrapperElement.appendChild(viewsWrapper);

                    if (typeof window.setupTabs === 'function') {
                        pendingTabs.push({ prefix: prefixId, keys: keys });
                    }
                }
            }

            if (move.variants && Object.keys(move.variants).length > 0) {
                buildNestedTabs({ variants: move.variants }, move.id, rightCol);
                
                if (typeof window.setupTabs === 'function') {
                    pendingTabs.forEach(tab => {
                        window.setupTabs(`tab-${tab.prefix}`, `view-${tab.prefix}`, tab.keys);
                    });
                }
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
            container.appendChild(strategyTarget);
        });

    } catch (error) {
        console.error(`Failed handling live frame engine synchronization updates for ${sectionType}:`, error);
    }
}

async function loadCharacterSkills(characterId) {
    return loadMoveSection(characterId, 'skills');
}

window.createPhase = createPhase;
window.loadMoveSection = loadMoveSection;
window.loadCharacterSkills = loadCharacterSkills;