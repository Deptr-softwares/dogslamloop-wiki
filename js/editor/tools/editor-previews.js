/**
 * The editor's preview of the Overview, Matchups and keyed sections, redrawn
 * from the edit buffer with the reader's own renderers where they exist.
 * @since v0.4, as part of editor.js
 * @touches populateTextSection and the keyed-section renderers (page_render.js),
 *   resolveMatchupTier (site_utils.js), getKeyedSection (character_tabs.js)
 * @watch every topic reaches innerHTML here too, and a reviewer reads this
 *   preview to decide on a ticket, so it escapes as the reader does
 * @see docs/editor.md
 */

// populateTextSection wraps what it draws in its own .wiki-section, and these
// previews put it inside a card that is one already: a box inside a box. The
// class is stripped, not the node, as the reader page does.
function unwrapInjectedSection(contentWrapper) {
    const injected = contentWrapper.querySelector('section.wiki-section');
    if (injected) injected.classList.remove('wiki-section');
}


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
                        <span class="profile-stat-label">${window.escapeHtmlKeepBreaks(stat.label)}</span>
                        <span class="profile-stat-val">${window.escapeHtmlKeepBreaks(stat.value)}</span>
                    </div>`;
            });
        }
        const imgHTML = descData.profile.image
            ? `<img src="${window.escapeHtml(descData.profile.image)}" class="profile-portrait" alt="Character Portrait">`
            : `<div class="profile-portrait-missing">[No Portrait]</div>`;

        profileHTML = `
            <aside class="wiki-section profile-card">
                ${imgHTML}
                <div class="profile-stats-container">${statsHTML}</div>
                ${typeof window.profileDescriptionHTML === 'function' ? window.profileDescriptionHTML(descData.profile) : ''}
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
    if (typeof window.fillProfilePager === 'function') window.fillProfilePager(overviewContainer, window.currentEditorCharId);

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
        // The live page's definition, so the preview agrees with what publishing makes.
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
                unwrapInjectedSection(contentWrapper);
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

/**
 * The preview of any keyed section (character_tabs.js), one renderer for all of
 * them, mirroring page_render.js's keyed-section renderer.
 * @since v0.15
 */
function renderKeyedSectionPreview(tabId) {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const section = window.getKeyedSectionByTab ? window.getKeyedSectionByTab(tabId) : null;
    if (!section) return;

    const container = document.getElementById(`tab-${section.tab}`);
    if (!container) return;

    // A section with its own renderer draws itself, as on the live page.
    if (section.rendererFn && typeof window[section.rendererFn] === 'function') {
        window[section.rendererFn](descData);
        if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
        return;
    }

    container.innerHTML = '';
    container.classList.add('vessel-content', 'space-y-6');

    const entries = descData[section.field];
    if (!entries || entries.length === 0) {
        container.innerHTML = `<div class="empty-tab-msg">${window.escapeHtml(section.emptyMessage || 'Not written yet.')}</div>`;
        return;
    }

    entries.forEach(entry => {
        const key = entry[section.keyField] || 'Unknown';
        const safeKey = String(key).replace(/\s+/g, '-');

        const entrySection = document.createElement('section');
        entrySection.className = 'wiki-section';
        entrySection.style.overflow = 'hidden';

        let metaHTML = '';
        if (section.metaField) {
            const value = entry[section.metaField];
            // Picked by the value, never supplied by it.
            const colour = (section.metaColors || {})[value] || '#9ca3af';
            metaHTML = `<span class="card-tier-label" style="color: ${colour};">${window.escapeHtml(value || '')}</span>`;
        }

        entrySection.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">${window.escapeHtml(key)}</h3>
                ${metaHTML}
            </div>
        `;
        container.appendChild(entrySection);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = `${section.tab}-content`;
        contentWrapper.id = `${section.tab}-content-${safeKey}`;
        entrySection.appendChild(contentWrapper);

        if (typeof window.populateTextSection === 'function') {
            if (entry.content && entry.content.length > 0) {
                window.populateTextSection(contentWrapper.id, '', entry.content, section.tab);
                unwrapInjectedSection(contentWrapper);
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">${window.escapeHtml(section.emptyEntryMessage || 'Nothing recorded yet.')}</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}
window.renderKeyedSectionPreview = renderKeyedSectionPreview;

