/**
 * Dogslamloop Wiki - Isolated Tier List Engine
 * Handles both Live Rendering and the Editor Drag-and-Drop Builder.
 */

window.tierRoster = [];

// --- CORE ROSTER MATCHER ---
// Fetches navigation.json to link Character IDs to their official names and colors
async function fetchTierRoster() {
    if (window.tierRoster.length > 0) return window.tierRoster;
    
    try {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }
        
        window.tierRoster = navData["Characters"] || [];
        return window.tierRoster;
    } catch (e) {
        console.error("Failed to load Roster for Tier List:", e);
        return [];
    }
}

window.getTierEditorContainer = function() {
    return document.getElementById('interactive-builder'); 
};

// --- PORTRAIT ENGINE ---
// Generates a standardized Character Portrait icon
function getCharPortraitHTML(charId, isDraggable = false) {
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
    
    // Normalize the ID for matching
    const normalizedSearchId = charId.toLowerCase().replace(/[-_ ]/g, '');
    const charMeta = window.tierRoster.find(c => c.id.toLowerCase().replace(/[-_ ]/g, '') === normalizedSearchId) 
                     || { name: charId.replace(/[-_]/g, ' ') };
    
    let charColor = '#333333';
    if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[charMeta.name]) {
        charColor = window.CHARACTER_COLORS[charMeta.name];
    }

    // AUTO-GENERATE SUPABASE CLOUD URL
    const cleanNameForUrl = charMeta.name.replace(/[^a-zA-Z0-9]/g, '');
    const cloudImageUrl = `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${cleanNameForUrl}Portrait.webp`;
    
    const finalImgSrc = charMeta.image ? `${rootPath}${charMeta.image}` : cloudImageUrl;

    // Image is layered on top. If it fails to load, it hides itself revealing the text!
    const imgHTML = `<img src="${finalImgSrc}" onerror="this.style.display='none'" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0; z-index:3; pointer-events:none;">`;

    return `
        <div class="tier-portrait ${isDraggable ? 'draggable-portrait' : ''}" 
             ${isDraggable ? 'draggable="true"' : ''}
             data-char-id="${charId}"
             title="${charMeta.name}"
             style="width: 60px; height: 60px; background-color: ${charColor}; position: relative; border: 2px solid var(--border-color); box-shadow: 3px 3px 0px var(--manga-shadow, #000); cursor: ${isDraggable ? 'grab' : 'pointer'}; overflow: hidden; display: flex; align-items: center; justify-content: center; text-align: center; flex-shrink: 0;"
             ${!isDraggable && charMeta.url ? `onclick="window.location.href='${rootPath}${charMeta.url}'"` : ''}>
            <span style="position: relative; z-index: 2; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.5rem; color: #fff; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; word-wrap: break-word; line-height: 1.1; padding: 2px;">
                ${charMeta.name}
            </span>
            ${imgHTML}
        </div>
    `;
}

// ==========================================
// 1. LIVE RENDERER
// ==========================================

window.loadTierList = async function() {
    await fetchTierRoster();

    let data = null;
    const pageId = 'tierlist';

    // 1. Check Editor Cache first! (Critical for Live Preview Pane)
    if (window.currentEditorDescData) {
        data = window.currentEditorDescData;
    } else {
        // 2. Fetch from Cloud or Fallback
        if (typeof window.fetchCloudCharacterData === 'function') {
            const cloudData = await window.fetchCloudCharacterData(pageId);
            if (cloudData && cloudData.desc_data) data = cloudData.desc_data;
        }
        
        if (!data) {
            const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
            try {
                data = await window.fetchJson(`${rootPath}systems/tierlist/tierlist_data.json`);
            } catch (e) {
                document.getElementById('tier-list-ui').innerHTML = "<p class='empty-tab-msg'>Tier List data is missing or corrupted.</p>";
                return;
            }
        }
    }

    if (!data || !data.tabs || data.tabs.length === 0) {
        document.getElementById('tier-list-ui').innerHTML = "<p class='empty-tab-msg'>No tier lists available.</p>";
        return;
    }

    // Render Navigation Tabs (Hierarchical Layout)
    const navContainer = document.getElementById('tier-tabs-container');
    
    // Override the HTML flex wrapper so we can stack the big button on top
    navContainer.style.display = 'block';
    navContainer.style.borderBottom = 'none';
    navContainer.style.paddingBottom = '0';

    // Find the Overall tab to pin to the top
    let overallTab = data.tabs.find(t => t.id === 'overall' || t.label.toLowerCase() === 'overall');
    let overallIdx = data.tabs.indexOf(overallTab);
    if (overallIdx === -1) { overallTab = data.tabs[0]; overallIdx = 0; }

    let navHTML = `
        <div style="display: flex; justify-content: center; width: 100%; margin-bottom: 1.5rem;">
            <!-- Removed 'transform: scale' and used font-size/padding to preserve the slant -->
            <button id="nav-tier-${overallTab.id}" class="btn-manga btn-manga-slanted" onclick="window.switchLiveTierTab(${overallIdx})" style="padding: 0.85rem 3rem; border-color: var(--accent-blue);">
                <div class="btn-manga-content">
                    <span class="btn-manga-text" style="font-size: 1.2rem;">${overallTab.label.toUpperCase()}</span>
                </div>
            </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue);">
    `;

    // Render the Matchup Tabs with Character Colors
    data.tabs.forEach((tab, idx) => {
        if (idx === overallIdx) return; // Skip the overall tab we already rendered
        
        // Extract the character name (e.g. "vs Honored One" -> "Honored One") to find their color
        let charName = tab.label.replace(/^vs\.?\s+/i, '').trim();
        let charColor = (window.CHARACTER_COLORS && window.CHARACTER_COLORS[charName]) ? window.CHARACTER_COLORS[charName] : 'var(--border-color)';
        
        navHTML += `
            <button id="nav-tier-${tab.id}" class="btn-manga btn-manga-slanted" onclick="window.switchLiveTierTab(${idx})" style="border-color: ${charColor};">
                <div class="btn-manga-content">
                    <span class="btn-manga-text" style="color: ${charColor}; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;">${tab.label.toUpperCase()}</span>
                </div>
            </button>
        `;
    });

    navHTML += `</div>`;
    navContainer.innerHTML = navHTML;

    // Attach data globally for the tab switcher
    window.liveTierData = data;
    window.switchLiveTierTab(0);
};

window.switchLiveTierTab = function(tabIndex) {
    const data = window.liveTierData;
    if (!data || !data.tabs[tabIndex]) return;

    // Update Nav UI via exact IDs
    document.querySelectorAll('#tier-tabs-container .btn-manga').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nav-tier-${data.tabs[tabIndex].id}`);
    if (activeBtn) activeBtn.classList.add('active');

    const activeTab = data.tabs[tabIndex];
    const listContainer = document.getElementById('tier-list-ui');
    const logContainer = document.getElementById('changelog-container');

    // 1. Render Tiers
    let listHTML = `<div style="display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg-secondary); border: 2px solid var(--border-color); padding: 0.5rem; box-shadow: 6px 6px 0px var(--manga-shadow, #000);">`;
    
    if (!activeTab.tiers || activeTab.tiers.length === 0) {
        listHTML += `<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-family: var(--text-mono);">No tiers configured for this category.</div>`;
    } else {
        activeTab.tiers.forEach(tier => {
            const rowColor = tier.color || '#555555';
            let charsHTML = '';
            
            if (tier.characters && tier.characters.length > 0) {
                tier.characters.forEach(charId => {
                    charsHTML += getCharPortraitHTML(charId, false);
                });
            }

            listHTML += `
                <div style="display: flex; min-height: 80px; background: var(--bg-main); border: 1px solid var(--border-color);">
                    <div style="width: 100px; background-color: ${rowColor}; display: flex; align-items: center; justify-content: center; border-right: 2px solid var(--bg-secondary); flex-shrink: 0; box-shadow: inset -4px 0px 8px rgba(0,0,0,0.2);">
                        <span style="font-family: 'CC-Wild-Words', sans-serif; font-size: 1.5rem; color: #000; text-shadow: 1px 1px 0px rgba(255,255,255,0.5);">${tier.name}</span>
                    </div>
                    <div style="flex: 1; padding: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; align-content: flex-start;">
                        ${charsHTML}
                    </div>
                </div>
            `;
        });
    }
    listHTML += `</div>`;
    listContainer.innerHTML = listHTML;

    // 2. Render Changelog
    let logHTML = '';
    if (activeTab.changelog && activeTab.changelog.length > 0) {
        activeTab.changelog.forEach(log => {
            logHTML += `
                <div style="background: rgba(255,255,255,0.02); border-left: 3px solid var(--accent-blue); padding: 1rem;">
                    <div style="color: var(--accent-blue); font-family: var(--text-mono); font-size: 0.75rem; margin-bottom: 0.5rem; font-weight: bold;">${log.date}</div>
                    <ul class="wiki-block-list space-y-2 text-gray-300" style="margin:0; padding-left: 1rem;">
                        ${log.notes.map(note => `<li>${note}</li>`).join('')}
                    </ul>
                </div>
            `;
        });
    } else {
        logHTML = `<div style="color: var(--text-muted); font-family: var(--text-mono); font-style: italic;">No changelogs recorded for this list.</div>`;
    }
    logContainer.innerHTML = logHTML;

    // Attach ToC hook
    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
};

// ==========================================
// 2. EDITOR BUILDER
// ==========================================

window.initTierListEditor = async function(containerId, descData) {
    await fetchTierRoster();
    
    // Auto-Migrate or Initialize
    if (!descData.tabs) {
        descData.tabs = [{ id: 'overall', label: 'Overall', tiers: [], changelog: [] }];
    }
    
    window.currentEditorDescData = descData;
    window.currentSystemTabIdx = window.currentSystemTabIdx || 0; // Reusing system tab tracker for state
    if (window.currentSystemTabIdx >= descData.tabs.length) window.currentSystemTabIdx = 0;

    const container = document.getElementById(containerId);
    if (!container) return;

    window.renderTierEditorUI(container);
};

window.renderTierEditorUI = function(container) {
    const descData = window.currentEditorDescData;
    const activeIdx = window.currentSystemTabIdx;
    const activeTab = descData.tabs[activeIdx];

    // 1. TABS NAVIGATION (Styled to match screenshot)
    let tabHTML = `<div class="daw-variant-tabs" style="margin-bottom: 1rem; overflow-x: auto; padding-bottom: 0.5rem; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 0.25rem;">`;
    descData.tabs.forEach((tab, tIdx) => {
        let activeClass = tIdx === activeIdx ? 'active' : '';
        let activeStyle = tIdx === activeIdx ? 'background: var(--accent-blue); color: #000; font-weight: bold;' : '';
        
        tabHTML += `<div style="display:inline-flex; align-items:center; position:relative;">`;
        tabHTML += `<button class="daw-tab-btn ${activeClass}" onclick="window.switchEditorTierTab(${tIdx})" style="padding: 0.5rem 2rem 0.5rem 1rem; border-radius: 2px; ${activeStyle}">${tab.label.toUpperCase()}</button>`;
        tabHTML += `<button onclick="window.removeEditorTierTab(${tIdx})" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; color: ${tIdx === activeIdx ? '#000' : '#ef4444'}; font-size:12px; cursor:pointer;" title="Delete Tab">✖</button>`;
        tabHTML += `</div>`;
    });
    tabHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem; padding: 0.5rem 1rem;" onclick="window.addEditorTierTab()">+ ADD TAB</button>`;
    tabHTML += `</div>`;

    if (!activeTab) {
        container.innerHTML = tabHTML;
        return;
    }

    // 2. CALCULATE UNASSIGNED POOL
    let assignedIds = [];
    if (activeTab.tiers) {
        activeTab.tiers.forEach(t => { if (t.characters) assignedIds.push(...t.characters); });
    }
    
    const unassignedChars = window.tierRoster.filter(c => !assignedIds.includes(c.id));
    let poolHTML = '';
    unassignedChars.forEach(c => { poolHTML += getCharPortraitHTML(c.id, true); });

    // 3. RENDER TIERS (STACKED LAYOUT FROM SCREENSHOT)
    let tiersHTML = '';
    if (!activeTab.tiers) activeTab.tiers = [];
    
    activeTab.tiers.forEach((tier, tIdx) => {
        let charsHTML = '';
        if (tier.characters) {
            tier.characters.forEach(cId => { charsHTML += getCharPortraitHTML(cId, true); });
        }

        tiersHTML += `
            <div style="margin-bottom: 1.5rem; border-left: 4px solid ${tier.color || '#555'}; padding-left: 0.5rem;">
                
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                    <input type="color" value="${tier.color ? tier.color.startsWith('#') ? tier.color : '#555555' : '#555555'}" onchange="window.updateTierMeta(${tIdx}, 'color', this.value)" style="width: 32px; height: 32px; cursor: pointer; border: 1px solid #333; padding: 0; background: none; flex-shrink: 0; border-radius: 4px;">
                    <input type="text" class="editor-input" value="${tier.name || ''}" placeholder="Tier Name" oninput="window.updateTierMeta(${tIdx}, 'name', this.value)" style="margin:0; font-family: 'CC-Wild-Words', sans-serif; font-size: 1.1rem; flex: 1; background: #0a0a0a;">
                    <div style="display: flex; gap: 0.25rem;">
                        <button class="btn-sys btn-sys-regular" style="padding: 0.3rem 0.5rem;" onclick="window.moveTier(${tIdx}, -1)">▲</button>
                        <button class="btn-sys btn-sys-regular" style="padding: 0.3rem 0.5rem;" onclick="window.moveTier(${tIdx}, 1)">▼</button>
                        <button class="btn-sys btn-sys-red" style="padding: 0.3rem 0.5rem;" onclick="window.removeTier(${tIdx})">✖</button>
                    </div>
                </div>

                <div class="tier-dropzone" data-tier-idx="${tIdx}" style="background: rgba(0,0,0,0.2); border: 1px dashed #333; border-radius: 4px; padding: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-content: flex-start; min-height: 90px;">
                    ${charsHTML}
                </div>
            </div>
        `;
    });

    // 4. RENDER CHANGELOGS (Max 5)
    let changelogHTML = '';
    if (!activeTab.changelog) activeTab.changelog = [];
    
    // Auto-trim to 5 max if somehow exceeded
    if (activeTab.changelog.length > 5) activeTab.changelog = activeTab.changelog.slice(0, 5);

    activeTab.changelog.forEach((log, lIdx) => {
        const notesText = Array.isArray(log.notes) ? log.notes.join('\n') : (log.notes || '');
        changelogHTML += `
            <div class="block-card" style="margin-bottom: 0.75rem; padding: 0.75rem; background: rgba(0,0,0,0.2); border-left: 4px solid var(--accent-blue);">
                <div style="display: flex; gap: 0.5rem; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div style="flex: 1;">
                        <label style="font-size:0.65rem; color:#888;">Date / Title (e.g. 2026-06-20)</label>
                        <input type="text" class="editor-input" value="${log.date || ''}" oninput="window.updateTierChangelog(${lIdx}, 'date', this.value)" style="margin:0; font-family: var(--text-mono); font-size: 0.85rem;">
                    </div>
                    <button class="btn-sys btn-sys-red" style="padding: 0.3rem 0.5rem; margin-top: 1.2rem;" onclick="window.removeTierChangelog(${lIdx})">✖</button>
                </div>
                <div>
                    <label style="font-size:0.65rem; color:#888;">Patch Notes (New line for each bullet point)</label>
                    <textarea class="editor-textarea" oninput="window.updateTierChangelog(${lIdx}, 'notes', this.value)" style="min-height: 80px; margin:0;">${notesText}</textarea>
                </div>
            </div>
        `;
    });

    const addChangelogBtn = activeTab.changelog.length < 5 
        ? `<button class="btn-sys btn-sys-green" onclick="window.addTierChangelog()">+ ADD LOG</button>` 
        : `<span style="color: #ef4444; font-size: 0.75rem; font-family: var(--text-mono); font-weight: bold;">MAX 5 LOGS REACHED</span>`;

    // 5. ASSEMBLE FULL EDITOR
    container.innerHTML = `
        ${tabHTML}
        
        <div class="editor-row" style="margin-bottom: 1.5rem;">
            <div style="flex: 1;">
                <label style="font-size:0.65rem; color:#888;">Tab Name (Navigation)</label>
                <input type="text" class="editor-input" value="${activeTab.label || ''}" oninput="window.updateTierTabLabel(this.value)">
            </div>
            <div style="flex: 1;">
                <label style="font-size:0.65rem; color:#888;">Tab Slug ID (Internal)</label>
                <input type="text" class="editor-input" value="${activeTab.id || ''}" disabled style="opacity: 0.5;">
            </div>
        </div>

        <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1.5rem; border-top: 1px dashed #333; padding-top: 1rem;">
            <div style="margin-bottom: 0.75rem;">
                <span style="background: #fff; color: #000; font-family: var(--text-mono); font-size: 0.65rem; font-weight: bold; padding: 0.15rem 0.4rem; letter-spacing: 1px;">UNASSIGNED ROSTER</span>
            </div>
            <div class="tier-dropzone" data-tier-idx="unassigned" style="min-height: 80px; display: flex; flex-wrap: wrap; gap: 0.5rem; align-content: flex-start;">
                ${poolHTML}
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.2rem; font-weight: bold; text-transform: uppercase;">TIER ROWS</span>
            <button class="btn-sys btn-sys-green" onclick="window.addTier()">+ ADD TIER</button>
        </div>
        
        <div id="tier-rows-container">
            ${tiersHTML}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; margin-top: 2rem;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.2rem; font-weight: bold; text-transform: uppercase;">PUBLIC CHANGELOG</span>
            ${addChangelogBtn}
        </div>
        <div id="tier-changelog-container">
            ${changelogHTML}
        </div>
    `;

    // 6. BIND DRAG AND DROP PHYSICS
    window.bindTierDragAndDrop(container);
};

// --- DRAG AND DROP PHYSICS ENGINE ---
window.bindTierDragAndDrop = function(container) {
    const draggables = container.querySelectorAll('.draggable-portrait');
    const dropzones = container.querySelectorAll('.tier-dropzone');

    draggables.forEach(el => {
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', e.target.closest('.draggable-portrait').dataset.charId);
            setTimeout(() => e.target.style.opacity = '0.5', 0);
        });
        el.addEventListener('dragend', (e) => {
            e.target.style.opacity = '1';
            dropzones.forEach(z => z.style.backgroundColor = '');
        });
    });

    dropzones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.backgroundColor = 'rgba(168, 85, 247, 0.1)'; // Purple highlight
        });
        zone.addEventListener('dragleave', () => {
            zone.style.backgroundColor = '';
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.backgroundColor = '';
            
            const charId = e.dataTransfer.getData('text/plain');
            const targetTierIdx = zone.dataset.tierIdx;
            
            if (charId) {
                window.moveCharToTier(charId, targetTierIdx);
            }
        });
    });
};

window.moveCharToTier = async function(charId, targetTierIdx) {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    
    // Remove from ALL existing tiers in this tab first
    if (activeTab.tiers) {
        activeTab.tiers.forEach(t => {
            if (t.characters) {
                t.characters = t.characters.filter(id => id !== charId);
            }
        });
    }

    // Add to target tier (if not dropped in 'unassigned')
    if (targetTierIdx !== 'unassigned') {
        const targetTier = activeTab.tiers[parseInt(targetTierIdx)];
        if (!targetTier.characters) targetTier.characters = [];
        targetTier.characters.push(charId);
    }

    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    window.renderTierEditorUI(document.getElementById('interactive-builder'));
};

// --- TAB MUTATIONS ---
window.switchEditorTierTab = function(idx) {
    window.currentSystemTabIdx = idx;
    window.renderTierEditorUI(document.getElementById('interactive-builder'));
};

window.addEditorTierTab = async function() {
    if (!window.currentEditorDescData.tabs) window.currentEditorDescData.tabs = [];
    const newId = 'tab-' + Math.floor(Math.random() * 1000);
    window.currentEditorDescData.tabs.push({ id: newId, label: 'New List', tiers: [], changelog: [] });
    window.currentSystemTabIdx = window.currentEditorDescData.tabs.length - 1;
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    window.renderTierEditorUI(document.getElementById('interactive-builder'));
};

window.removeEditorTierTab = async function(idx) {
    if (confirm("Delete this entire Tier List tab?")) {
        window.currentEditorDescData.tabs.splice(idx, 1);
        window.currentSystemTabIdx = 0;
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        window.renderTierEditorUI(document.getElementById('interactive-builder'));
    }
};

window.updateTierTabLabel = function(val) {
    const tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    tab.label = val;
    tab.id = val.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Prevents re-rendering the whole UI and stealing focus
    const activeTabBtn = document.querySelector('.daw-tab-btn.active');
    if (activeTabBtn) activeTabBtn.textContent = val.toUpperCase();

    clearTimeout(window.typingTimer);
    window.typingTimer = setTimeout(async () => { 
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    }, 500);
};

// --- TIER ROW MUTATIONS ---
window.addTier = async function() {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    if (!activeTab.tiers) activeTab.tiers = [];
    activeTab.tiers.push({ name: 'New Tier', color: '#ff0000', characters: [] });
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    window.renderTierEditorUI(document.getElementById('interactive-builder'));
};

window.removeTier = async function(idx) {
    if (confirm("Delete this tier? Characters inside will be returned to the Unassigned Pool.")) {
        const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
        activeTab.tiers.splice(idx, 1);
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        window.renderTierEditorUI(document.getElementById('interactive-builder'));
    }
};

window.moveTier = async function(idx, direction) {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    const targetIdx = idx + direction;
    if (targetIdx >= 0 && targetIdx < activeTab.tiers.length) {
        const temp = activeTab.tiers[idx];
        activeTab.tiers[idx] = activeTab.tiers[targetIdx];
        activeTab.tiers[targetIdx] = temp;
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        window.renderTierEditorUI(document.getElementById('interactive-builder'));
    }
};

window.updateTierMeta = function(idx, field, val) {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    activeTab.tiers[idx][field] = val;
    
    // INSTANT DOM UPDATE FOR COLOR BORDERS
    if (field === 'color') {
        // Find the specific card to update its border color immediately
        const allCards = document.getElementById('tier-rows-container').querySelectorAll('.block-card');
        if (allCards[idx]) allCards[idx].style.borderLeftColor = val;
    }

    clearTimeout(window.typingTimer);
    window.typingTimer = setTimeout(async () => { 
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    }, 400);
};

// --- CHANGELOG MUTATIONS ---
window.addTierChangelog = async function() {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    if (!activeTab.changelog) activeTab.changelog = [];
    if (activeTab.changelog.length >= 5) return;
    
    const today = new Date().toISOString().split('T')[0];
    activeTab.changelog.unshift({ date: today, notes: ["New update details..."] });
    
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    window.renderTierEditorUI(document.getElementById('interactive-builder'));
};

window.removeTierChangelog = async function(idx) {
    if (confirm("Delete this changelog entry?")) {
        const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
        activeTab.changelog.splice(idx, 1);
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        window.renderTierEditorUI(document.getElementById('interactive-builder'));
    }
};

window.updateTierChangelog = function(idx, field, val) {
    const activeTab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    if (field === 'notes') {
        activeTab.changelog[idx][field] = val.split('\n');
    } else {
        activeTab.changelog[idx][field] = val;
    }
    
    clearTimeout(window.typingTimer);
    window.typingTimer = setTimeout(async () => { 
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    }, 400);
};