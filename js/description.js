/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

async function loadCharacterDescriptions(characterId) {
    try {
        const response = await fetch(`../data/descriptions/${characterId}_descriptions.json?t=${Date.now()}`);
        if (!response.ok) throw new Error(`Could not fetch descriptions configuration profile for ${characterId}.`);
        const data = await response.json();

        function populateTextSection(containerId, sectionTitle, paragraphs, bullets) {
            const container = document.getElementById(containerId);
            if (!container) return;

            container.innerHTML = '';
            // FIX: Use classList.add instead of className to preserve the 'hidden' class!
            container.classList.add('vessel-content', 'space-y-4'); 

            const hasParagraphs = paragraphs && paragraphs.length > 0;
            const hasBullets = bullets && bullets.length > 0;

            if (hasParagraphs || hasBullets) {
                const section = document.createElement('section');
                section.className = 'wiki-section';
                
                let contentHTML = `<h3 class="strategy-title" style="font-size: 1.25rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">${sectionTitle}</h3>`;
                
                if (hasParagraphs) {
                    paragraphs.forEach(text => {
                        contentHTML += `<p class="strategy-paragraph" style="margin-bottom: 0.75rem; line-height: 1.6;">${text}</p>`;
                    });
                }
                
                if (hasBullets) {
                    contentHTML += `<ul style="list-style-type: disc; padding-left: 1.25rem; margin-top: 0.75rem;" class="space-y-2 text-gray-300">`;
                    bullets.forEach(bullet => {
                        contentHTML += `<li>${bullet}</li>`;
                    });
                    contentHTML += `</ul>`;
                }

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

            // 1. Create Top Split Layout (Flexbox)
            const topSplit = document.createElement('div');
            topSplit.style.display = 'flex';
            topSplit.style.gap = '2rem';
            topSplit.style.flexWrap = 'wrap';

            // 2. Build Profile Card (Left Side)
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

            // 3. Build Overview Text Area (Right Side)
            const overviewTextWrapper = document.createElement('div');
            overviewTextWrapper.id = 'overview-text-subnode';
            overviewTextWrapper.style.flex = '2';
            overviewTextWrapper.style.minWidth = '300px';

            // Inject into Top Split
            topSplit.innerHTML = profileHTML;
            topSplit.appendChild(overviewTextWrapper);
            overviewContainer.appendChild(topSplit);

            // Populate Overview right side
            populateTextSection('overview-text-subnode', 'Character Overview', data.overview?.paragraphs, data.overview?.bullets);

            // 4. Build Strategy Area (Bottom)
            if (data.strategy?.paragraphs?.length > 0 || data.strategy?.bullets?.length > 0) {
                const stratWrapper = document.createElement('div');
                stratWrapper.id = 'overview-strategy-subnode';
                overviewContainer.appendChild(stratWrapper);
                populateTextSection('overview-strategy-subnode', 'General Strategy', data.strategy?.paragraphs, data.strategy?.bullets);
            }

            // 5. Build Extras / Trivia Area (Very Bottom)
            if (data.extras && data.extras.length > 0) {
                data.extras.forEach((extraItem, index) => {
                    const extraWrapper = document.createElement('div');
                    extraWrapper.id = `overview-extra-${index}`;
                    overviewContainer.appendChild(extraWrapper);
                    populateTextSection(`overview-extra-${index}`, extraItem.title, extraItem.paragraphs, extraItem.bullets);
                });
            }
        }

        // --- 2. MATCHUPS TAB ---
        const matchupsContainer = document.getElementById('tab-matchups');
        if (matchupsContainer) {
            matchupsContainer.innerHTML = '';
            matchupsContainer.classList.add('vessel-content');

            if (data.matchups && data.matchups.length > 0) {
                const section = document.createElement('section');
                section.className = 'wiki-section';
                
                let matchupsHTML = `<h3 class="strategy-title" style="font-size: 1.25rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Matchups</h3>`;
                matchupsHTML += `<div style="display: flex; flex-direction: column; gap: 1.5rem;">`;

                data.matchups.forEach(mu => {
                    // Mapping tiers to colors
                    const tierColors = {
                        "Unwinnable": "text-red-600",
                        "Extreme Disadvantage": "text-red-500",
                        "Disadvantage": "text-orange-400",
                        "Equal": "text-gray-400",
                        "Advantage": "text-green-400",
                        "Extreme Advantage": "text-green-500",
                        "Unloseable": "text-cyan-400"
                    };
                    const tierClass = tierColors[mu.tier] || "text-white";

                    // Construct base note text
                    const noteText = mu.notes 
                        ? (typeof mu.notes === 'string' ? mu.notes : (mu.notes.text || '')) 
                        : 'No notes recorded for this matchup.';
                    const mediaHTML = (mu.notes?.media) ? `<img src="${mu.notes.media.src}" alt="${mu.notes.media.alt}" style="width:100%; border-radius:4px; margin-top:1rem;">` : '';
                    
                    // Handle special sub-sections
                    let specialHTML = '';
                    if (mu.specialFocus) {
                        mu.specialFocus.forEach(spec => {
                            specialHTML += `<div style="margin-top:1rem; padding:0.5rem; border-left: 2px solid var(--border-color);">
                                <strong style="color:var(--text-white); display:block; margin-bottom:0.25rem;">${spec.title}</strong>
                                <p style="margin:0; font-size: 0.85rem; color: hsl(0, 0%, 64%);">${spec.text}</p>
                            </div>`;
                        });
                    }

                    matchupsHTML += `
                        <div style="border-left: 3px solid hsl(212, 12%, 21%); background: hsla(0, 0%, 100%, 0.02); padding: 1.25rem; border-radius: 0 4px 4px 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                                <strong style="color: var(--text-white); font-size: 1.1rem;">vs. ${mu.opponent}</strong>
                                <span style="font-size: 0.85rem; font-weight: bold; text-transform: uppercase;" class="${tierClass}">${mu.tier}</span>
                            </div>
                            <p class="strategy-paragraph" style="font-size: 0.95rem; line-height: 1.6; color: hsl(210, 17%, 82%);">${noteText}</p>
                            ${mediaHTML}
                            ${specialHTML}
                        </div>
                    `;
                });

                matchupsHTML += `</div>`;
                section.innerHTML = matchupsHTML;
                matchupsContainer.appendChild(section);
            }
        }

        // --- 3. COUNTERPLAY TAB ---
        populateTextSection('tab-counterplay', 'Counterplay & Weaknesses', data.counterplay?.paragraphs, data.counterplay?.bullets);

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

window.loadCharacterDescriptions = loadCharacterDescriptions;