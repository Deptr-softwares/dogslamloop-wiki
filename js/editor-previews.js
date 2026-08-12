/**
 * Dogslamloop Wiki - Editor: Live Preview Renderers (overview/matchups/
 * counterplay - rebuilds the character page's read-only preview panels from
 * the in-memory edit buffer)
 */

function renderFullOverviewPreview() {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const overviewContainer = document.getElementById('tab-overview');
    if (!overviewContainer) return;

    overviewContainer.innerHTML = '';
    overviewContainer.classList.add('vessel-content', 'space-y-6');

    const topSplit = document.createElement('div');
    topSplit.className = 'profile-top-split';

    let profileHTML = '';
    if (descData.profile) {
        let statsHTML = '';
        if (descData.profile.stats) {
            descData.profile.stats.forEach(stat => {
                statsHTML += `
                    <div class="profile-stat-row">
                        <span class="profile-stat-label">${stat.label}</span>
                        <span class="profile-stat-val">${stat.value}</span>
                    </div>`;
            });
        }
        const imgHTML = descData.profile.image 
            ? `<img src="${descData.profile.image}" class="profile-portrait" alt="Character Portrait">` 
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

    if (descData.playstyle && (descData.playstyle.likes?.length > 0 || descData.playstyle.dislikes?.length > 0)) {
         const playstyleDiv = document.createElement('div');
         playstyleDiv.innerHTML = window.generatePlaystyleHTML(descData.playstyle);
         rightColumn.appendChild(playstyleDiv);
    }

    topSplit.innerHTML = profileHTML;
    topSplit.appendChild(rightColumn);
    overviewContainer.appendChild(topSplit);

    if (typeof window.populateTextSection === 'function') {
        window.populateTextSection('overview-text-subnode', 'Character Overview', descData.overview || []);
    }

    if (descData.strategy) {
        const stratWrapper = document.createElement('div');
        stratWrapper.id = 'overview-strategy-subnode';
        overviewContainer.appendChild(stratWrapper);
        if (typeof window.populateTextSection === 'function') {
            window.populateTextSection('overview-strategy-subnode', 'General Strategy', descData.strategy);
        }
    }

    if (descData.extras && descData.extras.length > 0) {
        descData.extras.forEach((extraItem, index) => {
            const extraWrapper = document.createElement('div');
            extraWrapper.id = `overview-extra-${index}`;
            overviewContainer.appendChild(extraWrapper);
            if (typeof window.populateTextSection === 'function') {
                window.populateTextSection(`overview-extra-${index}`, extraItem.title, extraItem.content || []);
            }
        });
    }

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

function renderMatchupsPreview() {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const matchupsContainer = document.getElementById('tab-matchups');
    if (!matchupsContainer) return;

    matchupsContainer.innerHTML = '';
    matchupsContainer.classList.add('vessel-content', 'space-y-6');

    if (!descData.matchups || descData.matchups.length === 0) {
        matchupsContainer.innerHTML = `<div class="empty-tab-msg">Matchup analysis has not been written yet.</div>`;
        return;
    }

    descData.matchups.forEach(mu => {
        // Same single definition the live page reads (js/site_utils.js), so
        // the preview cannot disagree with what publishing will produce.
        const tier = window.resolveMatchupTier(mu.tier);
        const safeOpponent = (mu.opponent || 'Unknown').replace(/\s+/g, '-');

        const muSection = document.createElement('section');
        muSection.className = 'wiki-section'; 
        muSection.style.overflow = 'hidden'; 

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
        contentWrapper.id = `matchup-content-${safeOpponent}`;
        muSection.appendChild(contentWrapper);

        if (typeof window.populateTextSection === 'function') {
            if (mu.content && mu.content.length > 0) {
                window.populateTextSection(contentWrapper.id, '', mu.content, 'matchup');
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

function renderCounterplayPreview() {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const cpContainer = document.getElementById('tab-counterplay');
    if (!cpContainer) return;

    cpContainer.innerHTML = '';
    cpContainer.classList.add('vessel-content', 'space-y-6');

    if (!descData.counterplay || descData.counterplay.length === 0) {
        cpContainer.innerHTML = `<div class="empty-tab-msg">Counterplay analysis has not been written yet.</div>`;
        return;
    }

    descData.counterplay.forEach(cp => {
        const importanceColors = {
            "Crucial": "#ef4444", "High": "#fb923c",
            "Moderate": "#facc15", "Low": "#4ade80",
            "Situational": "#22d3ee"
        };
        const impColor = importanceColors[cp.importance] || "#9ca3af";
        const safeTopic = (cp.topic || 'Unknown').replace(/\s+/g, '-');

        const cpSection = document.createElement('section');
        cpSection.className = 'wiki-section'; 
        cpSection.style.overflow = 'hidden';

        let cpHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">${cp.topic || 'Unknown'}</h3>
                <span class="card-tier-label" style="color: ${impColor};">${cp.importance || 'Moderate'}</span>
            </div>
        `;

        cpSection.innerHTML = cpHTML;
        cpContainer.appendChild(cpSection);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'counterplay-content';
        contentWrapper.id = `counterplay-content-${safeTopic}`;
        cpSection.appendChild(contentWrapper);

        if (typeof window.populateTextSection === 'function') {
            if (cp.content && cp.content.length > 0) {
                window.populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

