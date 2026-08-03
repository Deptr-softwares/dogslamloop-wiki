/**
 * Dogslamloop Wiki - Editor: System Page Engine (V0.4 dynamic system pages -
 * tabs/sections/blocks for non-character pages like framedata guides,
 * terminologies, the tier list's own descriptive tabs, etc.)
 */

// =====================================================================
// V0.4 DYNAMIC SYSTEM PAGE ENGINE
// =====================================================================

window.renderSystemEditor = function(container) {
    let descData = window.currentEditorDescData;
    if (!descData.tabs || descData.tabs.length === 0) {
        descData.tabs = [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'New Section', layout: 'full', blocks: [] }] }];
    }

    // 1. RENDER MAIN TABS
    let tabHTML = `<div class="daw-variant-tabs daw-editor-nav-row">`;
    descData.tabs.forEach((tab, tIdx) => {
        let active = tIdx === window.currentSystemTabIdx ? 'active' : '';
        tabHTML += `<div class="daw-tab-item">`;
        tabHTML += `<button class="daw-tab-btn daw-tab-btn-removable ${active}" onclick="window.switchSystemTab(${tIdx})">${tab.tabLabel}</button>`;
        tabHTML += `<button class="daw-tab-remove-btn" onclick="window.removeSystemTab(${tIdx})" title="Delete Tab">✖</button>`;
        tabHTML += `</div>`;
    });
    tabHTML += `<button class="daw-tab-btn btn-sys btn-sys-green system-tab-add-btn" onclick="window.addSystemTab()">+ ADD TAB</button>`;
    tabHTML += `</div>`;

    let activeTab = descData.tabs[window.currentSystemTabIdx];
    if (!activeTab) { container.innerHTML = tabHTML; return; }

    // 2. RENDER SECTIONS WITHIN ACTIVE TAB
    let secHTML = `<div class="daw-variant-tabs system-section-tabs-row">`;
    if (!activeTab.sections) activeTab.sections = [];
    activeTab.sections.forEach((sec, sIdx) => {
        let active = sIdx === window.currentSystemSecIdx ? 'active' : '';
        secHTML += `<div class="daw-tab-item">`;
        secHTML += `<button class="daw-tab-btn daw-tab-btn-removable system-section-tab-btn ${active}" onclick="window.switchSystemSection(${sIdx})">${sec.sectionTitle || 'Section ' + (sIdx+1)}</button>`;
        secHTML += `<button class="daw-tab-remove-btn" onclick="window.removeSystemSection(${sIdx})" title="Delete Section">✖</button>`;
        secHTML += `</div>`;
    });
    secHTML += `<button class="daw-tab-btn btn-sys btn-sys-purple system-tab-add-btn" onclick="window.addSystemSection()">+ ADD SECTION</button>`;
    secHTML += `</div>`;

    // 3. RENDER METADATA & BLOCK BUILDER
    let activeSec = activeTab.sections[window.currentSystemSecIdx];
    let editorArea = '';

    if (activeSec) {
        // MIGRATION HELPER
        let secWidth = activeSec.width !== undefined ? activeSec.width : (activeSec.layout === 'split-left' || activeSec.layout === 'split-right' ? 48 : (activeSec.layout === 'centered' ? 80 : 100));
        let secAlign = activeSec.alignment || (activeSec.layout === 'centered' ? 'center' : (activeSec.layout === 'split-right' ? 'right' : 'left'));
        let secBreak = activeSec.forceBreak !== undefined ? activeSec.forceBreak : (activeSec.layout === 'split-left' || activeSec.layout === 'split-right' ? false : true);

        editorArea = `
            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">LAYOUT & METADATA</span></div>
                    <div class="editor-row">
                        <div>
                            <label class="block-field-label-sm">Tab Name (Navigation)</label>
                            <input type="text" class="editor-input" value="${activeTab.tabLabel}" oninput="window.updateSystemMeta('tabLabel', this.value)">
                        </div>
                        <div>
                            <label class="block-field-label-sm">Section Title (Header)</label>
                            <input type="text" class="editor-input" value="${activeSec.sectionTitle}" oninput="window.updateSystemMeta('sectionTitle', this.value)">
                        </div>
                    </div>
                    <div class="editor-row editor-row-divider">
                        <div>
                            <label class="block-field-label-sm">Width (%)</label>
                            <input type="number" class="editor-input" min="10" max="100" step="5" value="${secWidth}" oninput="window.updateSystemMeta('width', this.value, false, true)">
                        </div>
                        <div>
                            <label class="block-field-label-sm">Alignment</label>
                            <select class="editor-select" onchange="window.updateSystemMeta('alignment', this.value)">
                                <option value="left" ${secAlign==='left'?'selected':''}>Left</option>
                                <option value="center" ${secAlign==='center'?'selected':''}>Center</option>
                                <option value="right" ${secAlign==='right'?'selected':''}>Right</option>
                            </select>
                        </div>
                        <div class="system-checkbox-row">
                            <label class="system-checkbox-label">
                                <input type="checkbox" onchange="window.updateSystemMeta('forceBreak', this.checked, true)" ${secBreak ? 'checked' : ''}>
                                Force New Row (Cut Down)
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div id="strategy-block-target"></div>
        `;
    } else {
        editorArea = `<div class="empty-tab-msg">No sections in this tab. Click + ADD SECTION to start.</div>`;
    }

    container.innerHTML = tabHTML + secHTML + editorArea;
    if (activeSec) initStrategyBlockBuilder('strategy-block-target', activeSec.blocks || []);
};

window.switchSystemTab = function(idx) { window.currentSystemTabIdx = idx; window.currentSystemSecIdx = 0; window.renderSystemEditor(document.getElementById('interactive-builder')); updateLivePreview(); };
window.switchSystemSection = function(idx) { window.currentSystemSecIdx = idx; window.renderSystemEditor(document.getElementById('interactive-builder')); updateLivePreview(); };

window.addSystemTab = async function() {
    await window.triggerManualSync();
    let newId = 'tab-' + Math.floor(Math.random() * 10000);
    window.currentEditorDescData.tabs.push({ tabId: newId, tabLabel: "New Tab", sections: [{ sectionTitle: "Introduction", layout: "full", blocks: [] }] });
    window.currentSystemTabIdx = window.currentEditorDescData.tabs.length - 1;
    window.currentSystemSecIdx = 0;
    window.renderSystemEditor(document.getElementById('interactive-builder'));
    updateLivePreview();
};

window.removeSystemTab = async function(idx) {
    if (await window.customConfirm("Delete this ENTIRE tab and all its sections?")) {
        window.currentEditorDescData.tabs.splice(idx, 1);
        window.currentSystemTabIdx = 0; window.currentSystemSecIdx = 0;
        window.renderSystemEditor(document.getElementById('interactive-builder'));
        updateLivePreview();
    }
};

window.addSystemSection = async function() {
    await window.triggerManualSync();
    window.currentEditorDescData.tabs[window.currentSystemTabIdx].sections.push({ sectionTitle: "New Section", layout: "full", blocks: [] });
    window.currentSystemSecIdx = window.currentEditorDescData.tabs[window.currentSystemTabIdx].sections.length - 1;
    window.renderSystemEditor(document.getElementById('interactive-builder'));
    updateLivePreview();
};

window.removeSystemSection = async function(idx) {
    if (await window.customConfirm("Delete this section and all its blocks?")) {
        window.currentEditorDescData.tabs[window.currentSystemTabIdx].sections.splice(idx, 1);
        window.currentSystemSecIdx = 0;
        window.renderSystemEditor(document.getElementById('interactive-builder'));
        updateLivePreview();
    }
};

window.updateSystemMeta = function(field, value, isCheckbox = false, isNumber = false) {
    let tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
    if (field === 'tabLabel') {
        tab.tabLabel = value;
        tab.tabId = value.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(); // Auto-slug the ID
    } else {
        let parsedVal = value;
        if (isCheckbox) parsedVal = !!value;
        else if (isNumber) parsedVal = parseFloat(value) || 100;

        tab.sections[window.currentSystemSecIdx][field] = parsedVal;
    }
    clearTimeout(window.typingTimer);
    window.typingTimer = setTimeout(() => {
        window.renderSystemEditor(document.getElementById('interactive-builder'));
        updateLivePreview();
    }, 400);
};
