/**
 * Dogslamloop Wiki - Editor: Live Preview Renderers (overview/matchups/
 * counterplay - rebuilds the character page's read-only preview panels from
 * the in-memory edit buffer)
 */

// populateTextSection wraps whatever it renders in its own
// <section class="wiki-section"> (js/description.js). These previews append it
// INSIDE a card that is already a .wiki-section, so the card gets drawn twice -
// a bordered box inside a bordered box, which is what the owner reported on
// 2026-08-16.
//
// The reader has stripped this since v0.13; the editor's preview never did, for
// matchups OR counterplay. It only became visible when Starter Guide made
// someone look at an empty topic, where the inner box has nothing in it to
// distract from the extra border.
//
// Stripping the class rather than unwrapping the node: the element carries the
// contextClass hook (.matchup-heading, .counterplay-heading) that styles the
// headings inside it, so removing the node would take the heading rules with it.
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

// The editor's live preview of a keyed section (js/character_tabs.js).
//
// This was renderCounterplayPreview with 'counterplay' written through it.
// Starter Guide is the same shape, and a second copy is how the two drift -
// the reader's renderer and this one already have to agree, and now there is
// one of each rather than one of each PER SECTION.
//
// Deliberately mirrors description.js's keyed-section renderer, including the
// escaping: a topic reaches innerHTML here too, and this is the surface a
// REVIEWER looks at while deciding whether to approve it.
function renderKeyedSectionPreview(tabId) {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const section = window.getKeyedSectionByTab ? window.getKeyedSectionByTab(tabId) : null;
    if (!section) return;

    const container = document.getElementById(`tab-${section.tab}`);
    if (!container) return;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

    container.innerHTML = '';
    container.classList.add('vessel-content', 'space-y-6');

    const entries = descData[section.field];
    if (!entries || entries.length === 0) {
        container.innerHTML = `<div class="empty-tab-msg">${esc(section.emptyMessage || 'Not written yet.')}</div>`;
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
            // Selected by the value, never supplied by it.
            const colour = (section.metaColors || {})[value] || '#9ca3af';
            metaHTML = `<span class="card-tier-label" style="color: ${colour};">${esc(value || '')}</span>`;
        }

        entrySection.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">${esc(key)}</h3>
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
                contentWrapper.innerHTML = `<p class="empty-notes-msg">${esc(section.emptyEntryMessage || 'Nothing recorded yet.')}</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}
window.renderKeyedSectionPreview = renderKeyedSectionPreview;

