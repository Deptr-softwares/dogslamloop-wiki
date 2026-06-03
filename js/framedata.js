/**
 * Dogslamloop Wiki - Frame Data Engine
 */

// Core frame section generator supporting your frame-tick CSS design pattern
function createPhase(duration, totalScale, styleClass, label) {
    const phase = document.createElement('div');
    phase.className = `phase-section ${styleClass}`;
    phase.style.width = `${(duration / totalScale) * 100}%`;
    
    if (label) {
        phase.setAttribute('title', label);
    }

    // Programmatically push individual sub-ticks to create your pixel layout grid line style
    for (let i = 0; i < duration; i++) {
        const tick = document.createElement('div');
        tick.className = 'frame-tick';
        phase.appendChild(tick);
    }
    
    return phase;
}

async function loadCharacterSkills(characterId) {
    try {
        // FIX 1: Added '?t=' + Date.now() to bypass aggressive browser caching instantly!
        const response = await fetch(`../data/skills/${characterId}_skills.json?t=${Date.now()}`);
        if (!response.ok) throw new Error("Could not fetch character frame data configuration profile.");
        const data = await response.json();
        
        const container = document.getElementById('tab-skills');
        if (!container) return;

        // Retain your Legend Block element if it exists, clear out old static placeholders
        const legendSection = container.querySelector('.legend-section');
        container.innerHTML = '';
        if (legendSection) container.appendChild(legendSection);

        data.skills.forEach(skill => {
            // Create Card Container
            const card = document.createElement('section');
            card.className = 'skill-entry-card';

            // Build Left Side Media & Side Stats Panels
            let statsHTML = '';
            if (skill.stats) {
                skill.stats.forEach(stat => {
                    const textClass = stat.isHighlighted ? 'class="text-purple-400"' : '';
                    statsHTML += `
                        <div class="stat-row">
                            <span class="stat-label">${stat.label}</span> 
                            <span class="stat-value" ${textClass}>${stat.value}</span>
                        </div>`;
                });
            }

            card.innerHTML = `
                <div class="skill-entry-header">
                    <div>
                        <h2 class="skill-title">${skill.name}</h2>
                        <span class="skill-subtitle">Input: ${skill.input} | Skill Type: ${skill.type} | ${skill.variant || ''}</span>
                    </div>
                </div>
                <div class="skill-entry-body">
                    <div class="skill-left-col">
                        <div class="skill-media-wrapper">
                            <img src="${skill.media?.src || ''}" alt="${skill.media?.alt || ''}" class="skill-media-img">
                            <span class="skill-media-filename">${skill.media?.src ? skill.media.src.split('/').pop() : ''}</span>
                        </div>
                        <div class="skill-stats-box">${statsHTML}</div>
                    </div>
                    <div class="skill-right-col">
                        <div class="skill-tab-bar" id="tabbar-${skill.id}"></div>
                        <div class="views-wrapper" id="views-${skill.id}"></div>
                    </div>
                </div>
            `;

            container.appendChild(card);

            const tabBar = document.getElementById(`tabbar-${skill.id}`);
            const viewsWrapper = document.getElementById(`views-${skill.id}`);
            const variantKeys = Object.keys(skill.variants);

            // Process View Layout Options (Whiff / Hit / Block)
            variantKeys.forEach((key, index) => {
                const variant = skill.variants[key];

                const btn = document.createElement('button');
                btn.id = `tab-${skill.id}-${key}`;
                btn.className = `skill-tab-btn ${index === 0 ? 'active' : ''}`;
                btn.textContent = variant.label;
                tabBar.appendChild(btn);

                const viewSection = document.createElement('div');
                viewSection.id = `view-${skill.id}-${key}`;
                viewSection.className = `view-section ${index === 0 ? '' : 'hidden'}`;

                variant.bars.forEach(bar => {
                    const barGroup = document.createElement('div');
                    if (bar.type === 'target') barGroup.style.marginTop = '0';

                    const infoHeader = document.createElement('div');
                    infoHeader.className = 'bar-header-info';
                    if (bar.type === 'target') infoHeader.style.marginTop = '0.25rem';
                    
                    const headerText = bar.headerInfo || bar.title || variant.headerInfo || '';
                    let headerContent = `<span class="${bar.headerClass || ''}">${headerText}</span>`;
                    
                    // FIX 2: Smart advantage coloring logic
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

                // Dynamic Sub-tab Legend Renderer
                if (variant.inlineLegend && variant.inlineLegend.length > 0) {
                    const divider = document.createElement('hr');
                    divider.className = 'view-divider';
                    viewSection.appendChild(divider);

                    const legendGrid = document.createElement('div');
                    legendGrid.className = 'view-legend-grid';

                    variant.inlineLegend.forEach(item => {
                        const legendItem = document.createElement('span');
                        legendItem.className = 'legend-inline-item';
                        legendItem.innerHTML = `
                            <span class="dot" style="background-color: ${item.color}; flex-shrink: 0;"></span>
                            <span>${item.text}</span>
                        `;
                        legendGrid.appendChild(legendItem);
                    });

                    viewSection.appendChild(legendGrid);
                }

                viewsWrapper.appendChild(viewSection);
            });

            if (typeof window.setupTabs === 'function') {
                window.setupTabs(`tab-${skill.id}`, `view-${skill.id}`, variantKeys);
            }

            // Append Bottom Text Strategy Panel Layout
            if (skill.strategyText) {
                const strategySection = document.createElement('section');
                strategySection.className = 'skill-strategy-section';
                
                let bulletsHTML = '';
                if (skill.bulletPoints) {
                    skill.bulletPoints.forEach(pt => bulletsHTML += `<li>${pt}</li>`);
                }

                strategySection.innerHTML = `
                    <h3 class="strategy-title">Skill Overview & Strategy</h3>
                    <div class="strategy-content">
                        <p>${skill.strategyText}</p>
                        <ul>${bulletsHTML}</ul>
                    </div>
                `;
                container.appendChild(strategySection);
            }
        });

    } catch (error) {
        console.error("Failed handling live frame engine synchronization updates:", error);
    }
}

window.createPhase = createPhase;
window.loadCharacterSkills = loadCharacterSkills;