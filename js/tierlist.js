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
        
        const roster = navData["Characters"] || [];

        // Attach the mirrored portrait, so buildPortrait below takes its
        // `charMeta.image` path instead of guessing a Supabase URL from the
        // display name. The guess was wrong for five characters - Disaster
        // Plants, Locust Guy, Black Death, Boomcat and the template - whose
        // files end in "Portrait2.webp" or drop the suffix entirely, and the
        // <img> hides itself on error, so they rendered nothing at all.
        //
        // These are same-origin, which is also what makes the tier list
        // exportable: a cross-origin image taints a canvas and makes both
        // toBlob() and the clipboard write throw.
        try {
            const portraits = window.fetchJson
                ? await window.fetchJson(`${rootPath}data/portraits.json`, { cache: true })
                : await (await fetch(`${rootPath}data/portraits.json`)).json();

            for (const entry of roster) {
                const pageId = entry.cms_config && entry.cms_config.pageId;
                if (pageId && portraits[pageId]) entry.image = portraits[pageId];
            }
        } catch (e) {
            // Non-fatal on purpose. Without the manifest every portrait falls
            // back to the guessed cloud URL, which is what shipped before -
            // degraded, not broken.
            console.warn("Portrait manifest unavailable, falling back to guessed URLs:", e);
        }

        window.tierRoster = roster;
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
    const imgHTML = `<img src="${finalImgSrc}" onerror="this.style.display='none'" class="tier-portrait-img">`;

    return `
        <div class="tier-portrait ${isDraggable ? 'draggable-portrait' : ''}"
             data-char-id="${charId}"
             title="${charMeta.name}"
             style="background-color: ${charColor};"
             ${!isDraggable && charMeta.url ? `onclick="window.location.href='${rootPath}${charMeta.url}'"` : ''}>
            <span class="tier-portrait-name">
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
        <div class="tier-nav-overall-wrapper">
            <!-- Removed 'transform: scale' and used font-size/padding to preserve the slant -->
            <button id="nav-tier-${overallTab.id}" class="btn-manga btn-manga-slanted tier-nav-overall-btn" onclick="window.switchLiveTierTab(${overallIdx})">
                <div class="btn-manga-content">
                    <span class="btn-manga-text tier-nav-overall-text">${overallTab.label.toUpperCase()}</span>
                </div>
            </button>
        </div>
        <div class="tier-nav-matchup-row">
    `;

    // Render the Matchup Tabs with Character Colors
    data.tabs.forEach((tab, idx) => {
        if (idx === overallIdx) return; // Skip the overall tab we already rendered

        // Extract the character name (e.g. "vs Honored One" -> "Honored One") to find their color
        let charName = tab.label.replace(/^vs\.?\s+/i, '').trim();
        let charColor = (window.CHARACTER_COLORS && window.CHARACTER_COLORS[charName]) ? window.CHARACTER_COLORS[charName] : 'var(--border-color)';

        navHTML += `
            <button id="nav-tier-${tab.id}" class="btn-manga btn-manga-slanted tier-nav-matchup-btn" onclick="window.switchLiveTierTab(${idx})" style="--tier-nav-color: ${charColor};">
                <div class="btn-manga-content">
                    <span class="btn-manga-text tier-nav-matchup-text">${tab.label.toUpperCase()}</span>
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
    let listHTML = `<div class="tier-list-inner">`;

    if (!activeTab.tiers || activeTab.tiers.length === 0) {
        listHTML += `<div class="tier-list-empty">No tiers configured for this category.</div>`;
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
                <div class="tier-list-row">
                    <div class="tier-list-row-label" style="--tier-row-color: ${rowColor};">
                        <span class="tier-list-row-label-text">${tier.name}</span>
                    </div>
                    <div class="tier-list-row-chars">
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
                <div class="tier-changelog-entry">
                    <div class="tier-changelog-date">${log.date}</div>
                    <ul class="wiki-block-list space-y-2 text-gray-300 tier-changelog-notes">
                        ${log.notes.map(note => `<li>${note}</li>`).join('')}
                    </ul>
                </div>
            `;
        });
    } else {
        logHTML = `<div class="tier-changelog-empty">No changelogs recorded for this list.</div>`;
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
    let tabHTML = `<div class="daw-variant-tabs tier-editor-tabs-row">`;
    descData.tabs.forEach((tab, tIdx) => {
        let activeClass = tIdx === activeIdx ? 'active' : '';
        let removeBtnClass = tIdx === activeIdx ? 'on-active-tab' : '';

        tabHTML += `<div class="daw-tab-item">`;
        tabHTML += `<button class="daw-tab-btn daw-tab-btn-removable ${activeClass}" onclick="window.switchEditorTierTab(${tIdx})">${tab.label.toUpperCase()}</button>`;
        tabHTML += `<button class="daw-tab-remove-btn ${removeBtnClass}" onclick="window.removeEditorTierTab(${tIdx})" title="Delete Tab">✖</button>`;
        tabHTML += `</div>`;
    });
    tabHTML += `<button class="daw-tab-btn daw-add-btn btn-sys btn-sys-green" onclick="window.addEditorTierTab()">+ ADD TAB</button>`;
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
            <div class="tier-editor-row" style="border-left: 4px solid ${tier.color || '#555'};">

                <div class="tier-editor-row-header">
                    <input type="color" class="tier-color-input" value="${tier.color ? tier.color.startsWith('#') ? tier.color : '#555555' : '#555555'}" onchange="window.updateTierMeta(${tIdx}, 'color', this.value)">
                    <input type="text" class="editor-input tier-name-input" value="${tier.name || ''}" placeholder="Tier Name" oninput="window.updateTierMeta(${tIdx}, 'name', this.value)">
                    <div class="tier-row-btn-group">
                        <button class="btn-sys btn-sys-regular btn-sys-compact" onclick="window.moveTier(${tIdx}, -1)">▲</button>
                        <button class="btn-sys btn-sys-regular btn-sys-compact" onclick="window.moveTier(${tIdx}, 1)">▼</button>
                        <button class="btn-sys btn-sys-red btn-sys-compact" onclick="window.removeTier(${tIdx})">✖</button>
                    </div>
                </div>

                <div class="tier-dropzone tier-row-dropzone" data-tier-idx="${tIdx}">
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
            <div class="tier-changelog-card">
                <div class="tier-changelog-header-row">
                    <div class="tier-changelog-date-field">
                        <label class="editor-field-label-sm">Date / Title (e.g. 2026-06-20)</label>
                        <input type="text" class="editor-input tier-changelog-date-input" value="${log.date || ''}" oninput="window.updateTierChangelog(${lIdx}, 'date', this.value)">
                    </div>
                    <button class="btn-sys btn-sys-red btn-sys-compact tier-changelog-delete-btn" onclick="window.removeTierChangelog(${lIdx})">✖</button>
                </div>
                <div>
                    <label class="editor-field-label-sm">Patch Notes (New line for each bullet point)</label>
                    <textarea class="editor-textarea tier-changelog-textarea" oninput="window.updateTierChangelog(${lIdx}, 'notes', this.value)">${notesText}</textarea>
                </div>
            </div>
        `;
    });

    const addChangelogBtn = activeTab.changelog.length < 5
        ? `<button class="btn-sys btn-sys-green" onclick="window.addTierChangelog()">+ ADD LOG</button>`
        : `<span class="tier-max-logs-msg">MAX 5 LOGS REACHED</span>`;

    // 5. ASSEMBLE FULL EDITOR
    container.innerHTML = `
        ${tabHTML}

        <div class="editor-row tier-tab-meta-row">
            <div class="tier-tab-meta-field">
                <label class="editor-field-label-sm">Tab Name (Navigation)</label>
                <input type="text" class="editor-input" value="${activeTab.label || ''}" oninput="window.updateTierTabLabel(this.value)">
            </div>
            <div class="tier-tab-meta-field">
                <label class="editor-field-label-sm">Tab Slug ID (Internal)</label>
                <input type="text" class="editor-input" value="${activeTab.id || ''}" disabled>
            </div>
        </div>

        <div class="tier-unassigned-container">
            <div class="tier-unassigned-label-row">
                <span class="block-type-badge tier-section-badge">UNASSIGNED ROSTER</span>
            </div>
            <div class="tier-dropzone" data-tier-idx="unassigned">
                ${poolHTML}
            </div>
        </div>

        <div class="tier-section-header-row">
            <span class="tier-section-title">TIER ROWS</span>
            <button class="btn-sys btn-sys-green" onclick="window.addTier()">+ ADD TIER</button>
        </div>

        <div id="tier-rows-container">
            ${tiersHTML}
        </div>

        <div class="tier-section-header-row tier-section-header-row-spaced">
            <span class="tier-section-title">PUBLIC CHANGELOG</span>
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
// Pointer Events (not native HTML5 DnD) so the exact same code path drives
// mouse and touch - native DnD never fires from a touch gesture at all, which
// made this editor unusable on phones/tablets prior to this rewrite.
window.bindTierDragAndDrop = function(container) {
    const draggables = container.querySelectorAll('.draggable-portrait');
    const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

    draggables.forEach(el => {
        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();

            const charId = el.dataset.charId;
            const startX = e.clientX;
            const startY = e.clientY;
            let dragging = false;
            let ghost = null;
            let currentZone = null;
            let lastX = startX;
            let lastY = startY;
            let scrollRAF = null;
            let scrollParent = null;

            el.setPointerCapture(e.pointerId);

            function positionGhost() {
                ghost.style.left = `${lastX}px`;
                ghost.style.top = `${lastY}px`;
            }

            function updateDropzone() {
                const under = document.elementFromPoint(lastX, lastY);
                const zone = under ? under.closest('.tier-dropzone') : null;
                if (zone !== currentZone) {
                    if (currentZone) currentZone.classList.remove('drag-over');
                    if (zone) zone.classList.add('drag-over');
                    currentZone = zone;
                }
            }

            // The unassigned pool + tier rows can easily be taller than one
            // screen, especially on mobile - without this, dragging a
            // character from the top of the page down into a tier row (or
            // vice versa) is impossible if both ends aren't visible at once.
            // Re-checks the dropzone under the (stationary) pointer every
            // frame while scrolling, since the page moves under it even
            // though the pointer itself doesn't.
            //
            // edit.html uses an app-shell layout (body has overflow-y:
            // hidden; an inner panel does the actual scrolling), so this
            // walks up for the real scrollable ancestor instead of assuming
            // window/document scroll.
            function getScrollParent(node) {
                let ancestor = node.parentElement;
                while (ancestor) {
                    const style = getComputedStyle(ancestor);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight) {
                        return ancestor;
                    }
                    ancestor = ancestor.parentElement;
                }
                return document.scrollingElement || document.documentElement;
            }

            const EDGE_ZONE = 60;
            const MAX_SCROLL_SPEED = 16;
            function autoScrollTick() {
                if (!dragging) { scrollRAF = null; return; }
                const rect = scrollParent.getBoundingClientRect();
                const top = Math.max(rect.top, 0);
                const bottom = Math.min(rect.bottom, window.innerHeight);
                let delta = 0;
                if (lastY < top + EDGE_ZONE) delta = -MAX_SCROLL_SPEED * (1 - (lastY - top) / EDGE_ZONE);
                else if (lastY > bottom - EDGE_ZONE) delta = MAX_SCROLL_SPEED * (1 - (bottom - lastY) / EDGE_ZONE);

                if (delta !== 0) {
                    scrollParent.scrollTop += delta;
                    updateDropzone();
                }
                scrollRAF = requestAnimationFrame(autoScrollTick);
            }

            function startDrag() {
                dragging = true;
                el.classList.add('tier-portrait-dragging');
                scrollParent = getScrollParent(el);
                ghost = el.cloneNode(true);
                ghost.classList.add('tier-portrait-ghost');
                document.body.appendChild(ghost);
                positionGhost();
                scrollRAF = requestAnimationFrame(autoScrollTick);
            }

            function cleanup() {
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
                el.removeEventListener('pointercancel', onCancel);
                el.classList.remove('tier-portrait-dragging');
                if (ghost) { ghost.remove(); ghost = null; }
                if (currentZone) { currentZone.classList.remove('drag-over'); }
                if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
            }

            function onMove(ev) {
                lastX = ev.clientX;
                lastY = ev.clientY;

                if (!dragging) {
                    if (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD) {
                        startDrag();
                    } else {
                        return;
                    }
                }
                positionGhost();
                updateDropzone();
            }

            function onUp() {
                const droppedZone = currentZone;
                cleanup();
                if (dragging && droppedZone) {
                    window.moveCharToTier(charId, droppedZone.dataset.tierIdx);
                }
            }

            function onCancel() {
                cleanup();
            }

            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('pointercancel', onCancel);
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