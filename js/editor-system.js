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
    window.registerInserter('desc.tabs', () => window.addSystemTab());
    tabHTML += `<button class="daw-tab-btn btn-sys btn-sys-green system-tab-add-btn" onclick="window.addSystemTab()">+ ADD TAB</button>`;
    tabHTML += window.reorderStripControls('desc.tabs');
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
        // Reordering here is exactly what item 6b's `order` delta carries, so a
        // move ships as an order change rather than as every section's content.
        secHTML += `<button class="daw-tab-remove-btn" onclick="window.removeSystemSection(${sIdx})" title="Delete Section">✖</button>`;
        secHTML += `</div>`;
    });
    window.registerInserter(`desc.tabs.${window.currentSystemTabIdx}.sections`, () => window.addSystemSection());
    secHTML += `<button class="daw-tab-btn btn-sys btn-sys-purple system-tab-add-btn" onclick="window.addSystemSection()">+ ADD SECTION</button>`;
    secHTML += window.reorderStripControls(`desc.tabs.${window.currentSystemTabIdx}.sections`);
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

// The system editor rebuilds itself rather than going through
// initFullTabEditor, so the reorder module is told how to refresh it.
if (typeof window.setReorderRefresh === 'function') {
    window.setReorderRefresh(function () {
        // Declines on every other page type. #interactive-builder is the shared
        // builder host, so without this check a reorder on a CHARACTER page
        // would draw the system editor over it.
        const type = window.currentEditorPageType;
        if (type !== 'system' && type !== 'tierlist') return false;

        const host = document.getElementById('interactive-builder');
        if (!host || typeof window.renderSystemEditor !== 'function') return false;
        window.renderSystemEditor(host);
        return true;
    });
}

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

        // THE ID ONLY TRACKS THE LABEL WHILE THE TAB IS NEW.
        //
        // This used to re-slug on every keystroke, which made tabId a display
        // name wearing an id's clothes: renaming a tab changed its identity, so
        // a submission had to re-send every section underneath it - and a
        // re-sent section carries the contributor's copy of prose somebody else
        // may have edited in the meantime. That is the whole-document bug
        // reappearing one level down.
        //
        // A tab that already exists in the cloud keeps its id forever. A tab
        // created in this session has no identity to protect yet, so it still
        // gets a readable id from whatever it ends up being called. It is also
        // the DOM id, so the same rule keeps `#tab-basics` from moving under
        // anyone who linked to it.
        const cloudTabs = (window.originalCloudDescData && window.originalCloudDescData.tabs) || [];
        const existsInCloud = cloudTabs.some(t => t && t.tabId === tab.tabId);
        if (!existsInCloud) {
            tab.tabId = value.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        }
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

// =====================================================================
// SUBMISSION: ONE DELTA PER SECTION, NOT ONE PAYLOAD PER PAGE
// =====================================================================
//
// Every system and tier list submission used to ship the whole desc_data as a
// single `system_data / full` payload, which meant approving two tickets for
// one page silently reverted the first: each carried a snapshot of the page as
// its author found it, and the second wrote that snapshot over the first's
// approved change. Proven end to end before this was written.
//
// Gallery and tool pages were already scoped. The tool branch's own comment
// gives the reason, and it applies here word for word: "the config is the
// owner's and the prose is everyone's, so a contributor fixing the intro must
// not be able to carry a URL change with it."
//
// Keys are derived by window.indexSystemSections (js/site_utils.js) - see the
// note there on why nothing here stores an id.
window.buildSystemDeltas = function(local, cloud, pageType) {
    const differs = (a, b) => JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b);
    const deltas = [];

    const localTabs = window.indexSystemTabs(local || {});
    const cloudTabs = window.indexSystemTabs(cloud || {});
    const localSecs = window.indexSystemSections(local || {});
    const cloudSecs = window.indexSystemSections(cloud || {});

    // Content lives in its own scopes, never in the tab's metadata: `sections`
    // ships per section, `tiers` and `changelog` per tab below. Copying them in
    // here as well would send the same edit twice, and the metadata copy would
    // be the stale one - a reorder or a rename would carry an old set of tiers
    // along with it and undo whatever had landed in between.
    const CONTENT_FIELDS = ['sections', 'tiers', 'changelog'];
    const tabMeta = (tab, sectionKeys) => {
        const meta = {};
        Object.keys(tab || {}).forEach(k => { if (!CONTENT_FIELDS.includes(k)) meta[k] = tab[k]; });
        // The order travels as a list of KEYS. A reorder that carried section
        // content would let moving a section overwrite an edit somebody else
        // made to it in the meantime - the whole-document bug in miniature.
        meta.order = sectionKeys;
        return meta;
    };

    // --- Tabs: metadata, section order, additions and removals ---
    localTabs.forEach(({ tabKey, tab }) => {
        const before = cloudTabs.find(t => t.tabKey === tabKey);
        const localOrder = localSecs.filter(s => s.tabKey === tabKey).map(s => s.secKey);
        const cloudOrder = cloudSecs.filter(s => s.tabKey === tabKey).map(s => s.secKey);

        const localMeta = tabMeta(tab, localOrder);
        const cloudMeta = before ? tabMeta(before.tab, cloudOrder) : null;

        if (differs(localMeta, cloudMeta)) {
            deltas.push({ scope: 'system_tab', key: tabKey, payload: localMeta });
        }
    });

    cloudTabs.forEach(({ tabKey }) => {
        if (!localTabs.some(t => t.tabKey === tabKey)) {
            deltas.push({ scope: 'system_tab', key: tabKey, payload: null });
        }
    });

    // --- Sections ---
    // Tier list tabs hold tiers and a changelog rather than sections, so this
    // loop simply finds nothing for them and the branch below covers them.
    localSecs.forEach(({ key, section }) => {
        const before = cloudSecs.find(s => s.key === key);
        if (differs(section, before ? before.section : null)) {
            deltas.push({ scope: 'system_section', key, payload: section });
        }
    });

    cloudSecs.forEach(({ key }) => {
        if (!localSecs.some(s => s.key === key)) {
            deltas.push({ scope: 'system_section', key, payload: null });
        }
    });

    // --- Tier lists ---
    // Not split per tier: moving a character from A to S changes two tiers at
    // once, so a per-tier scope would manufacture a conflict out of one
    // ordinary edit.
    if (pageType === 'tierlist') {
        localTabs.forEach(({ tabKey, tab }) => {
            const before = cloudTabs.find(t => t.tabKey === tabKey);
            const oldTab = before ? before.tab : {};
            if (differs(tab.tiers, oldTab.tiers)) {
                deltas.push({ scope: 'tierlist_tiers', key: tabKey, payload: tab.tiers || [] });
            }
            if (differs(tab.changelog, oldTab.changelog)) {
                deltas.push({ scope: 'tierlist_changelog', key: tabKey, payload: tab.changelog || [] });
            }
        });
    }

    return deltas;
};
