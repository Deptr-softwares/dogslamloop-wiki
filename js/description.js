/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

// Helper to assign CSS classes and dynamic inline widths for media
function getMediaAttributes(align, customWidth) {
    let alignClass = 'wiki-media-full';
    let defaultWidth = '100%';

    if (align === 'left') {
        alignClass = 'wiki-media-left';
        defaultWidth = '45%';
    } else if (align === 'right') {
        alignClass = 'wiki-media-right';
        defaultWidth = '45%';
    } else if (align === 'center') {
        alignClass = 'wiki-media-center';
        defaultWidth = '75%';
    }

    const width = customWidth || defaultWidth;
    return `class="wiki-media ${alignClass}" style="width: ${width};"`;
}

// Helper to apply dynamic text alignment if requested
function getAlignStyle(align) {
    return align ? `style="text-align: ${align};"` : '';
}

async function loadCharacterDescriptions(characterId) {
    try {
        const response = await fetch(`./${characterId}_descriptions.json?v=1.0`);
        if (!response.ok) throw new Error(`Could not fetch descriptions configuration profile for ${characterId}.`);
        const data = await window.fetchJson(`./${characterId}_descriptions.json`);
        if (!data) throw new Error(`Could not fetch descriptions configuration profile for ${characterId}.`);
        
        function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
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
                    const alignAttr = getAlignStyle(block.align);

                    if (block.type === 'heading') {
                        let headingClass = 'wiki-block-heading';
                        if (contextClass) headingClass += ` ${contextClass}-heading`;
                        contentHTML += `<h4 class="${headingClass}" ${alignAttr}>${block.content}</h4>`;
                    } 
                    else if (block.type === 'paragraph') {
                        const text = Array.isArray(block.content) ? block.content.join(' ') : block.content;
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
                    
                    if (block.author) {
                        contentHTML += `<div class="author-credit-block">— Contributed by ${block.author}</div>`;
                    }
                });

                section.innerHTML = contentHTML;
                container.appendChild(section);
            } else {
                // Now perfectly hooks into your native UI.css .empty-tab-msg class
                container.innerHTML = `
                    <div class="empty-tab-msg">
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
                        <div class="matchup-content">
                    `;

                    muSection.innerHTML = muHTML;
                    matchupsContainer.appendChild(muSection);

                    const contentWrapper = document.createElement('div');
                    contentWrapper.id = `matchup-content-${mu.opponent.replace(/\s+/g, '-')}`;
                    muSection.appendChild(contentWrapper);

                    if (mu.content && mu.content.length > 0) {
                        populateTextSection(contentWrapper.id, '', mu.content, 'matchup');
                        
                        // Clean up the empty h3 injected by the populate helper
                        const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                        if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                    } else {
                        contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
                    }

                    if (mu.author) {
                        const authorDiv = document.createElement('div');
                        authorDiv.className = 'author-credit-section';
                        authorDiv.textContent = `— Matchup details by ${mu.author}`;
                        muSection.appendChild(authorDiv);
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
                        <div class="counterplay-content">
                    `;

                    cpSection.innerHTML = cpHTML;
                    counterplayContainer.appendChild(cpSection);

                    const contentWrapper = document.createElement('div');
                    contentWrapper.id = `counterplay-content-${cp.topic.replace(/\s+/g, '-')}`;
                    cpSection.appendChild(contentWrapper);

                    if (cp.content && cp.content.length > 0) {
                        populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');
                        
                        const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                        if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                    } else {
                        contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
                    }

                    if (cp.author) {
                        const authorDiv = document.createElement('div');
                        authorDiv.className = 'author-credit-section';
                        authorDiv.textContent = `— Counterplay notes by ${cp.author}`;
                        cpSection.appendChild(authorDiv);
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