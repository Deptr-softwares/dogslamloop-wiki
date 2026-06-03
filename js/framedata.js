/**
 * Dogslamloop Wiki - Frame Data Engine
 */

const frameDataLegendHTML = `
    <section class="wiki-section legend-section" style="margin-bottom: 2rem;">
        <h3 class="legend-title">Frame Data Color Legend</h3>
        <div class="legend-grid">
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(217.18, 100%, 50%);"></span><div><span class="legend-name">Startup</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(153.88, 100%, 50%);"></span><div><span class="legend-name">Misc</span>Variable frame data aka no hard number so it always come with a note</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(0, 100%, 45%);"></span><div><span class="legend-name">Active</span>Hitbox view ...</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(295, 89.76%, 50.2%);"></span><div><span class="legend-name">Recovery</span>aka Whiff endlag</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(111.06, 100%, 50%);"></span><div><span class="legend-name">Self Stun</span></div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(34, 99%, 27%);"></span><div><span class="legend-name">InSkill Stun</span>A weird version of Self Stun, but you can move around</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(0, 70%, 35%);"></span><div><span class="legend-name">Target Stun</span>on Hit</div></div>
            <div class="legend-item"><span class="legend-swatch" style="background-color: hsl(319.73, 88.24%, 50%);"></span><div><span class="legend-name">Block Endlag</span>aka Extended Recovery</div></div>
        </div>
    </section>
`;

// Core frame section generator
function createPhase(duration, totalScale, styleClass, label) {
    const phase = document.createElement('div');
    phase.className = `phase-section ${styleClass}`;
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

async function loadMoveSection(characterId, sectionType) {
    try {
        // Dynamically fetches the correct file based on the section passed in
        const response = await fetch(`../data/${sectionType}/${characterId}_${sectionType}.json?t=${Date.now()}`);
        if (!response.ok) throw new Error(`Could not fetch ${sectionType} profile.`);
        const data = await response.json();
        
        // Dynamically targets the correct HTML tab
        const container = document.getElementById(`tab-${sectionType}`);
        if (!container) return;

        // Access the correct array in the JSON (e.g., data.skills, data.m1s)
        const movesArray = data[sectionType] || [];

        // Clear out any empty fallback messages in the HTML container
        container.innerHTML = ''; 

        // Does ANY move in this specific array have a 'variants' block?
        const hasFrameData = movesArray.some(move => move.variants);

        // If yes, inject the JavaScript legend at the very top of the tab
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
                statsHTML = `<div class="stat-row" style="justify-content:center; color:hsl(215, 8%, 47%); font-style:italic;">No stats recorded</div>`;
            }

            // --- 2. MEDIA FALLBACK ---
            const mediaContent = move.media?.src 
                ? `<img src="${move.media.src}" alt="${move.media.alt || ''}" class="skill-media-img">
                   <span class="skill-media-filename">${move.media.src.split('/').pop()}</span>`
                : `<div style="display:flex; height:100%; width:100%; align-items:center; justify-content:center; border: 1px dashed var(--border-color); color: hsl(215, 8%, 47%); font-family: var(--text-mono); font-size: 0.875rem;">
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
                        <div class="skill-media-wrapper" ${!move.media?.src ? 'style="background: transparent;"' : ''}>
                            ${mediaContent}
                        </div>
                        <div class="skill-stats-box">${statsHTML}</div>
                    </div>
                    <div class="skill-right-col">
                        <div class="skill-tab-bar" id="tabbar-${move.id}"></div>
                        <div class="views-wrapper" id="views-${move.id}"></div>
                    </div>
                </div>
            `;

            container.appendChild(card);

            const tabBar = document.getElementById(`tabbar-${move.id}`);
            const viewsWrapper = document.getElementById(`views-${move.id}`);
            const variantKeys = move.variants ? Object.keys(move.variants) : [];

            // --- 3. FRAME DATA FALLBACK ---
            if (variantKeys.length > 0) {
                variantKeys.forEach((key, index) => {
                    const variant = move.variants[key];
                    const btn = document.createElement('button');
                    btn.id = `tab-${move.id}-${key}`;
                    btn.className = `skill-tab-btn ${index === 0 ? 'active' : ''}`;
                    btn.textContent = variant.label;
                    tabBar.appendChild(btn);

                    const viewSection = document.createElement('div');
                    viewSection.id = `view-${move.id}-${key}`;
                    viewSection.className = `view-section ${index === 0 ? '' : 'hidden'}`;

                    variant.bars.forEach(bar => {
                        const barGroup = document.createElement('div');
                        if (bar.type === 'target') barGroup.style.marginTop = '0';

                        const infoHeader = document.createElement('div');
                        infoHeader.className = 'bar-header-info';
                        if (bar.type === 'target') infoHeader.style.marginTop = '0.25rem';
                        
                        const headerText = bar.headerInfo || bar.title || variant.headerInfo || '';
                        let headerContent = `<span class="${bar.headerClass || ''}">${headerText}</span>`;
                        
                        if (bar.advantageText) {
                            const advantageColor = bar.advantageText.includes('-') ? 'text-red-400' : 'text-green-400';
                            headerContent += `<span class="${advantageColor} font-bold tracking-wider">${bar.advantageText}</span>`;
                        }
                        infoHeader.innerHTML = headerContent;
                        
                        const timelineContainer = document.createElement('div');
                        timelineContainer.className = 'frame-bar-container';

                        bar.phases.forEach(phase => {
                            const phaseEl = createPhase(phase.duration, variant.totalScale, phase.styleClass, phase.label);
                            timelineContainer.appendChild(phaseEl);
                        });

                        if (bar.type === 'target') {
                            barGroup.appendChild(timelineContainer);
                            barGroup.appendChild(infoHeader);
                        } else {
                            barGroup.appendChild(infoHeader);
                            barGroup.appendChild(timelineContainer);
                        }

                        viewSection.appendChild(barGroup);
                    });

                    if (variant.inlineLegend && variant.inlineLegend.length > 0) {
                        const divider = document.createElement('hr');
                        divider.className = 'view-divider';
                        viewSection.appendChild(divider);

                        const legendGrid = document.createElement('div');
                        legendGrid.className = 'view-legend-grid';

                        variant.inlineLegend.forEach(item => {
                            const legendItem = document.createElement('span');
                            legendItem.className = 'legend-inline-item';
                            legendItem.innerHTML = `<span class="dot" style="background-color: ${item.color}; flex-shrink: 0;"></span><span>${item.text}</span>`;
                            legendGrid.appendChild(legendItem);
                        });

                        viewSection.appendChild(legendGrid);
                    }

                    viewsWrapper.appendChild(viewSection);
                });

                if (typeof window.setupTabs === 'function') {
                    window.setupTabs(`tab-${move.id}`, `view-${move.id}`, variantKeys);
                }
            } else {
                // Renders an empty placeholder if variants are missing
                tabBar.style.display = 'none';
                viewsWrapper.innerHTML = `
                    <div class="empty-tab-msg" style="margin-top:0; border:1px dashed var(--border-color); background:transparent; padding: 2rem;">
                        Frame data has not been mapped for this move yet.
                    </div>
                `;
            }

            // --- 4. STRATEGY FALLBACK ---
            const strategySection = document.createElement('section');
            strategySection.className = 'skill-strategy-section';
            
            const hasStrategy = move.strategyParagraphs && move.strategyParagraphs.length > 0;
            const hasBullets = move.bulletPoints && move.bulletPoints.length > 0;

            if (hasStrategy || hasBullets) {
                let paragraphsHTML = '';
                if (hasStrategy) {
                    move.strategyParagraphs.forEach(text => {
                        paragraphsHTML += `<p class="strategy-paragraph">${text}</p>`;
                    });
                }

                let bulletsHTML = '';
                if (hasBullets) {
                    move.bulletPoints.forEach(pt => bulletsHTML += `<li>${pt}</li>`);
                }

                strategySection.innerHTML = `
                    <h3 class="strategy-title">Skill Overview & Strategy</h3>
                    <div class="strategy-content">
                        ${paragraphsHTML}
                        ${hasBullets ? `<ul>${bulletsHTML}</ul>` : ''}
                    </div>
                `;
            } else {
                // Renders an empty placeholder if no strategy is written
                strategySection.innerHTML = `
                    <h3 class="strategy-title">Skill Overview & Strategy</h3>
                    <div class="empty-tab-msg" style="margin-top:0.5rem; border:1px dashed var(--border-color); background:transparent; padding: 1.5rem;">
                        Overview and strategy have not been written yet.
                    </div>
                `;
            }
            container.appendChild(strategySection);
        });

    } catch (error) {
        console.error(`Failed handling live frame engine synchronization updates for ${sectionType}:`, error);
    }
}

// Legacy function kept intact to ensure your current HTML files don't break
async function loadCharacterSkills(characterId) {
    return loadMoveSection(characterId, 'skills');
}

window.createPhase = createPhase;
window.loadMoveSection = loadMoveSection;
window.loadCharacterSkills = loadCharacterSkills;