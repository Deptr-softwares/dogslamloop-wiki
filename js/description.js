/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

// Helper to compute media layout styles based on alignment and custom width
function getMediaStyle(align, customWidth) {
    let style = 'border-radius:4px; border:1px solid var(--border-color); ';
    
    // Apply custom width if provided, otherwise use standard structural defaults
    if (align === 'left') {
        let w = customWidth || '45%';
        style += `float: left; width: ${w}; margin: 0.5rem 1.5rem 1rem 0;`;
    } else if (align === 'right') {
        let w = customWidth || '45%';
        style += `float: right; width: ${w}; margin: 0.5rem 0 1rem 1.5rem;`;
    } else if (align === 'center') {
        let w = customWidth || '75%';
        style += `display: block; width: ${w}; margin: 1.5rem auto;`;
    } else {
        let w = customWidth || '100%';
        style += `width: ${w}; margin: 1.5rem 0;`; 
    }
    return style;
}

async function loadCharacterDescriptions(characterId) {
    try {
        const response = await fetch(`../data/descriptions/${characterId}_descriptions.json?t=${Date.now()}`);
        if (!response.ok) throw new Error(`Could not fetch descriptions configuration profile for ${characterId}.`);
        const data = await response.json();

        function populateTextSection(containerId, sectionTitle, blocks) {
            const container = document.getElementById(containerId);
            if (!container) return;

            container.innerHTML = '';
            container.classList.add('vessel-content', 'space-y-4'); 

            if (blocks && blocks.length > 0) {
                const section = document.createElement('section');
                section.className = 'wiki-section';
                section.style.overflow = 'hidden'; 
                
                let contentHTML = `<h3 class="strategy-title" style="font-size: 1.15rem;">${sectionTitle}</h3>`;
                
                blocks.forEach(block => {
                    const alignStyle = block.align ? `text-align: ${block.align};` : '';

                    if (block.type === 'heading') {
                        contentHTML += `<h4 style="color: var(--text-white); font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; ${alignStyle}">${block.content}</h4>`;
                    } 
                    else if (block.type === 'paragraph') {
                        const text = Array.isArray(block.content) ? block.content.join(' ') : block.content;
                        contentHTML += `<p class="strategy-paragraph" style="margin-bottom: 0.75rem; line-height: 1.6; ${alignStyle}">${text}</p>`;
                    } 
                    else if (block.type === 'list') {
                        contentHTML += `<ul style="list-style-type: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; ${alignStyle}" class="space-y-2 text-gray-300">`;
                        block.items.forEach(item => { contentHTML += `<li>${item}</li>`; });
                        contentHTML += `</ul>`;
                    }
                    else if (block.type === 'image') {
                        contentHTML += `<img src="${block.src}" alt="${block.alt || 'Wiki Image'}" style="${getMediaStyle(block.align, block.width)}">`;
                    }
                    else if (block.type === 'video') {
                        const attributes = block.controls ? 'controls' : 'autoplay loop muted playsinline';
                        contentHTML += `<video src="${block.src}" style="${getMediaStyle(block.align, block.width)}" ${attributes}></video>`;
                    }
                    
                    // NEW: Block-level author credit
                    if (block.author) {
                        contentHTML += `<div style="text-align: right; font-size: 0.75rem; color: var(--text-muted); font-style: italic; margin-top: -0.25rem; margin-bottom: 0.75rem;">— Contributed by ${block.author}</div>`;
                    }
                });

                section.innerHTML = contentHTML;
                container.appendChild(section);
            } else {
                container.innerHTML = `
                    <div class="empty-tab-msg" style="border: 1px dashed var(--border-color); background: transparent; padding: 2rem; border-radius: 4px; text-align: center; color: #8b949e;">
                        "${sectionTitle}" analysis has not been written yet.
                    </div>
                `;
            }
        }

        // --- 1. OVERVIEW & STRATEGY TAB ---
        const overviewContainer = document.getElementById('tab-overview');
        if (overviewContainer) {
            overviewContainer.innerHTML = '';
            overviewContainer.classList.add('vessel-content', 'space-y-6');

            const topSplit = document.createElement('div');
            topSplit.style.display = 'flex';
            topSplit.style.gap = '2rem';
            topSplit.style.flexWrap = 'wrap';

            let profileHTML = '';
            if (data.profile) {
                let statsHTML = '';
                if (data.profile.stats) {
                    data.profile.stats.forEach(stat => {
                        statsHTML += `
                            <div style="display:flex; justify-content:space-between; padding:0.5rem 0; border-bottom:1px solid var(--border-color);">
                                <span style="color:#8b949e; font-size:0.9rem;">${stat.label}</span>
                                <span style="color:var(--text-white); font-weight:bold; font-size:0.9rem;">${stat.value}</span>
                            </div>`;
                    });
                }

                const imgHTML = data.profile.image 
                    ? `<img src="${data.profile.image}" style="width:100%; border-radius:4px; margin-bottom:1rem; border:1px solid var(--border-color);" alt="Character Portrait">` 
                    : `<div style="width:100%; height:200px; border:1px dashed var(--border-color); display:flex; align-items:center; justify-content:center; color:#8b949e; margin-bottom:1rem;">[No Portrait]</div>`;

                profileHTML = `
                    <aside class="wiki-section profile-card" style="flex: 1; min-width: 250px; max-width: 320px; align-self: flex-start;">
                        ${imgHTML}
                        <div class="profile-stats-container">${statsHTML}</div>
                    </aside>
                `;
            }

            const overviewTextWrapper = document.createElement('div');
            overviewTextWrapper.id = 'overview-text-subnode';
            overviewTextWrapper.style.flex = '2';
            overviewTextWrapper.style.minWidth = '300px';

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
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 1rem;">
                            <h3 style="color: var(--text-white); font-size: 1.5rem; margin: 0; font-weight: bold;">vs. ${mu.opponent}</h3>
                            <span style="font-size: 0.85rem; font-weight: bold; text-transform: uppercase;" class="${tierClass}">${mu.tier}</span>
                        </div>
                        <div class="matchup-content">
                    `;

                    if (mu.content && mu.content.length > 0) {
                        mu.content.forEach(block => {
                            const alignStyle = block.align ? `text-align: ${block.align};` : '';

                            if (block.type === 'heading') {
                                muHTML += `<h4 style="color: var(--text-white); font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; border-left: 3px solid hsl(212, 12%, 21%); padding-left: 0.75rem; ${alignStyle}">${block.content}</h4>`;
                            } 
                            else if (block.type === 'paragraph') {
                                const text = Array.isArray(block.content) ? block.content.join(' ') : block.content;
                                muHTML += `<p class="strategy-paragraph" style="margin-bottom: 0.75rem; line-height: 1.6; color: hsl(210, 17%, 82%); ${alignStyle}">${text}</p>`;
                            } 
                            else if (block.type === 'list') {
                                muHTML += `<ul style="list-style-type: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; color: hsl(210, 17%, 82%); ${alignStyle}" class="space-y-2">`;
                                block.items.forEach(item => { muHTML += `<li>${item}</li>`; });
                                muHTML += `</ul>`;
                            }
                            else if (block.type === 'image') {
                                muHTML += `<img src="${block.src}" alt="${block.alt || 'Matchup Image'}" style="${getMediaStyle(block.align, block.width)}">`;
                            }
                            else if (block.type === 'video') {
                                const attributes = block.controls ? 'controls' : 'autoplay loop muted playsinline';
                                muHTML += `<video src="${block.src}" style="${getMediaStyle(block.align, block.width)}" ${attributes}></video>`;
                            }
                            
                            // NEW: Block-level author credit
                            if (block.author) {
                                muHTML += `<div style="text-align: right; font-size: 0.75rem; color: var(--text-muted); font-style: italic; margin-top: -0.25rem; margin-bottom: 0.75rem;">— Contributed by ${block.author}</div>`;
                            }
                        });
                    } else {
                        muHTML += `<p style="color: #8b949e; font-style: italic;">No notes recorded for this matchup.</p>`;
                    }

                    // NEW: Section-level author credit (placed right under the content)
                    if (mu.author) {
                        muHTML += `<div style="text-align: right; font-size: 0.8rem; color: var(--accent-blue); font-family: var(--text-mono); margin-top: 1rem; border-top: 1px dashed var(--border-color); padding-top: 0.5rem;">— Matchup details by ${mu.author}</div>`;
                    }

                    muHTML += `</div>`;
                    muSection.innerHTML = muHTML;
                    matchupsContainer.appendChild(muSection);
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
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 1rem;">
                            <h3 style="color: var(--text-white); font-size: 1.5rem; margin: 0; font-weight: bold;">${cp.topic}</h3>
                            <span style="font-size: 0.85rem; font-weight: bold; text-transform: uppercase;" class="${importanceClass}">${cp.importance}</span>
                        </div>
                        <div class="counterplay-content">
                    `;

                    if (cp.content && cp.content.length > 0) {
                        cp.content.forEach(block => {
                            const alignStyle = block.align ? `text-align: ${block.align};` : '';

                            if (block.type === 'heading') {
                                cpHTML += `<h4 style="color: var(--text-white); font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; border-left: 3px solid hsl(0, 60%, 50%); padding-left: 0.75rem; ${alignStyle}">${block.content}</h4>`;
                            } 
                            else if (block.type === 'paragraph') {
                                const text = Array.isArray(block.content) ? block.content.join(' ') : block.content;
                                cpHTML += `<p class="strategy-paragraph" style="margin-bottom: 0.75rem; line-height: 1.6; color: hsl(210, 17%, 82%); ${alignStyle}">${text}</p>`;
                            } 
                            else if (block.type === 'list') {
                                cpHTML += `<ul style="list-style-type: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; color: hsl(210, 17%, 82%); ${alignStyle}" class="space-y-2">`;
                                block.items.forEach(item => { cpHTML += `<li>${item}</li>`; });
                                cpHTML += `</ul>`;
                            }
                            else if (block.type === 'image') {
                                cpHTML += `<img src="${block.src}" alt="${block.alt || 'Counterplay Image'}" style="${getMediaStyle(block.align, block.width)}">`;
                            }
                            else if (block.type === 'video') {
                                const attributes = block.controls ? 'controls' : 'autoplay loop muted playsinline';
                                cpHTML += `<video src="${block.src}" style="${getMediaStyle(block.align, block.width)}" ${attributes}></video>`;
                            }
                            
                            // NEW: Block-level author credit
                            if (block.author) {
                                cpHTML += `<div style="text-align: right; font-size: 0.75rem; color: var(--text-muted); font-style: italic; margin-top: -0.25rem; margin-bottom: 0.75rem;">— Contributed by ${block.author}</div>`;
                            }
                        });
                    } else {
                        cpHTML += `<p style="color: #8b949e; font-style: italic;">No specific counterplay details recorded.</p>`;
                    }

                    // Section-level author credit (placed right under the content)
                    if (cp.author) {
                        cpHTML += `<div style="text-align: right; font-size: 0.8rem; color: var(--accent-blue); font-family: var(--text-mono); margin-top: 1rem; border-top: 1px dashed var(--border-color); padding-top: 0.5rem;">— Counterplay notes by ${cp.author}</div>`;
                    }

                    cpHTML += `</div>`;
                    cpSection.innerHTML = cpHTML;
                    counterplayContainer.appendChild(cpSection);
                });
            } else {
                 counterplayContainer.innerHTML = `
                    <div class="empty-tab-msg" style="border: 1px dashed var(--border-color); background: transparent; padding: 2rem; border-radius: 4px; text-align: center; color: #8b949e;">
                        Counterplay analysis has not been written yet.
                    </div>
                `;
            }
        }

        // --- 4. MOVE STRATEGIES (M1s, Skills, Specials) ---
        if (data.moveStrategies) {
            setTimeout(() => {
                for (const [moveId, blocks] of Object.entries(data.moveStrategies)) {
                    populateTextSection(`strategy-${moveId}`, 'Move Overview & Strategy', blocks);

                    const strategyContainer = document.getElementById(`strategy-${moveId}`);
                    if (strategyContainer) {
                        strategyContainer.style.marginBottom = '3rem';
                    }
                }
                
                if (typeof applyInternalStyling === 'function') {
                    applyInternalStyling();
                }
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

window.loadCharacterDescriptions = loadCharacterDescriptions;