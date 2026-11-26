/**
 * The system page editor: tabs, sections and their Blocks for pages that are not
 * characters (guides, Terminologies, the tier list's own tabs), and the deltas a
 * system or tier list page submits.
 * @since v0.4, as part of editor.js
 * @touches desc_data.tabs, indexSystemSections (submission_delta.js), reorderStripControls
 *   and setReorderRefresh (editor-reorder.js), the Block editor
 * @watch a system page submits one delta per section, tab metadata and tier table,
 *   never the whole document: two tickets for one page each carrying a snapshot
 *   would revert each other
 * @see docs/editor.md
 */

window.renderSystemEditor = function(container) {
    // Not while VIEW DIFF has another version in the editor's place: this reloads the
    // Workspace from the page's data.
    if (typeof window.afterDrawingApart === 'function' && window.afterDrawingApart(() => window.renderSystemEditor(container))) return;
    let descData = window.currentEditorDescData;
    if (!descData.tabs || descData.tabs.length === 0) {
        descData.tabs = [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'New Section', layout: 'full', blocks: [] }] }];
    }

    let tabHTML = window.reorderStripControls('desc.tabs');
    tabHTML += `<div class="sub-tabs sub-tabs-scroll editor-nav-row">`;
    descData.tabs.forEach((tab, tIdx) => {
        const active = tIdx === window.currentSystemTabIdx ? ' is-active' : '';
        tabHTML += `<div class="sub-tab-item">`;
        tabHTML += `<button class="sub-tab sub-tab-removable${active}" onclick="window.switchSystemTab(${tIdx})">${window.escapeHtml(tab.tabLabel)}</button>`;
        tabHTML += `<button class="sub-tab-remove" onclick="window.removeSystemTab(${tIdx})" data-tip="Delete Tab" aria-label="Delete Tab">✖</button>`;
        tabHTML += `</div>`;
    });
    window.registerInserter('desc.tabs', () => window.addSystemTab());
    tabHTML += `<button class="btn-sys btn-sys-green sub-tabs-action" onclick="window.addSystemTab()">+ ADD TAB</button>`;
    tabHTML += `</div>`;

    let activeTab = descData.tabs[window.currentSystemTabIdx];
    if (!activeTab) { container.innerHTML = tabHTML; return; }

    let secHTML = window.reorderStripControls(`desc.tabs.${window.currentSystemTabIdx}.sections`);
    secHTML += `<div class="sub-tabs sub-tabs-scroll system-section-tabs-row">`;
    if (!activeTab.sections) activeTab.sections = [];
    activeTab.sections.forEach((sec, sIdx) => {
        const active = sIdx === window.currentSystemSecIdx ? ' is-active' : '';
        secHTML += `<div class="sub-tab-item">`;
        secHTML += `<button class="sub-tab sub-tab-removable system-section-tab-btn${active}" onclick="window.switchSystemSection(${sIdx})">${window.escapeHtml(sec.sectionTitle || 'Section ' + (sIdx+1))}</button>`;
        // A move ships as an order change, not as every section's content.
        secHTML += `<button class="sub-tab-remove" onclick="window.removeSystemSection(${sIdx})" data-tip="Delete Section" aria-label="Delete Section">✖</button>`;
        secHTML += `</div>`;
    });
    window.registerInserter(`desc.tabs.${window.currentSystemTabIdx}.sections`, () => window.addSystemSection());
    secHTML += `<button class="btn-sys btn-sys-purple sub-tabs-action" onclick="window.addSystemSection()">+ ADD SECTION</button>`;
    secHTML += `</div>`;

    let activeSec = activeTab.sections[window.currentSystemSecIdx];
    let editorArea = '';

    if (activeSec) {
        // Older sections stored a layout name instead of a width.
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
                            <input type="text" class="editor-input" value="${window.escapeHtml(activeTab.tabLabel)}" oninput="window.updateSystemMeta('tabLabel', this.value)">
                        </div>
                        <div>
                            <label class="block-field-label-sm">Section Title (Header)</label>
                            <input type="text" class="editor-input" value="${window.escapeHtml(activeSec.sectionTitle)}" oninput="window.updateSystemMeta('sectionTitle', this.value)">
                        </div>
                    </div>
                    <div class="editor-row editor-row-divider">
                        <div>
                            <label class="block-field-label-sm">Width (%)</label>
                            <input type="number" class="editor-input" min="10" max="100" step="5" value="${window.escapeHtml(secWidth)}" oninput="window.updateSystemMeta('width', this.value, false, true)">
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

// This editor redraws itself rather than through initFullTabEditor, so the
// reorder bar is told how.
if (typeof window.setReorderRefresh === 'function') {
    window.setReorderRefresh(function () {
        // Declines on every other page type: #interactive-builder is shared, and a
        // reorder on a character page would draw this editor over it.
        const type = window.currentEditorPageType;
        if (type !== 'system' && type !== 'tierlist') return false;

        const host = document.getElementById('interactive-builder');
        if (!host || typeof window.renderSystemEditor !== 'function') return false;
        window.renderSystemEditor(host);
        return true;
    });
}

// Switching draws the preview even under Preview only on Sync, and VIEW DIFF
// follows the tab, as on a character page.
window.switchSystemTab = function(idx) {
    window.currentSystemTabIdx = idx; window.currentSystemSecIdx = 0;
    window.renderSystemEditor(document.getElementById('interactive-builder'));
    window.drawLivePreviewNow();
    if (window.isDiffModeActive && typeof window.showEditorSideBySide === 'function') window.showEditorSideBySide();
};
window.switchSystemSection = function(idx) { window.currentSystemSecIdx = idx; window.renderSystemEditor(document.getElementById('interactive-builder')); window.drawLivePreviewNow(); };

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
    if (await window.confirmDelete("Delete this ENTIRE tab and all its sections?")) {
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
    if (await window.confirmDelete("Delete this section and all its blocks?")) {
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

        // The id follows the label only while the tab is new. A tab in the cloud keeps
        // its id: renaming it must not change what it is, or a submission would re-send
        // every section under it. It is the DOM id too, so links to it hold.
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

/**
 * The deltas a system or tier list page submits, one per section, tab metadata
 * and tier table. Keys come from indexSystemSections (submission_delta.js).
 * @since v0.15
 */
window.buildSystemDeltas = function(local, cloud, pageType) {
    const differs = (a, b) => JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b);
    const deltas = [];

    const localTabs = window.indexSystemTabs(local || {});
    const cloudTabs = window.indexSystemTabs(cloud || {});
    const localSecs = window.indexSystemSections(local || {});
    const cloudSecs = window.indexSystemSections(cloud || {});

    // Content travels in its own scopes, never in the tab's metadata, or a reorder
    // or rename would carry an old copy and undo what landed in between.
    const CONTENT_FIELDS = ['sections', 'tiers', 'changelog'];
    const tabMeta = (tab, sectionKeys) => {
        const meta = {};
        Object.keys(tab || {}).forEach(k => { if (!CONTENT_FIELDS.includes(k)) meta[k] = tab[k]; });
        // The order is a list of keys: carrying content, a move could overwrite another
        // edit to that section.
        meta.order = sectionKeys;
        return meta;
    };

    // The order of the deltas matters: approval applies them in turn, and a tab's
    // metadata places its sections by key. So a new tab first, then the sections,
    // then an existing tab's metadata, then the tab order.
    const newTabDeltas = [];
    const changedTabDeltas = [];
    localTabs.forEach(({ tabKey, tab }) => {
        const before = cloudTabs.find(t => t.tabKey === tabKey);
        const localOrder = localSecs.filter(s => s.tabKey === tabKey).map(s => s.secKey);
        const cloudOrder = cloudSecs.filter(s => s.tabKey === tabKey).map(s => s.secKey);

        const localMeta = tabMeta(tab, localOrder);
        const cloudMeta = before ? tabMeta(before.tab, cloudOrder) : null;

        if (differs(localMeta, cloudMeta)) {
            (before ? changedTabDeltas : newTabDeltas).push({ scope: 'system_tab', key: tabKey, payload: localMeta });
        }
    });
    deltas.push(...newTabDeltas);

    cloudTabs.forEach(({ tabKey }) => {
        if (!localTabs.some(t => t.tabKey === tabKey)) {
            deltas.push({ scope: 'system_tab', key: tabKey, payload: null });
        }
    });

    // Tier list tabs hold tiers and a changelog, not sections: covered below.
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

    // After the sections, so every section it names is there to place.
    deltas.push(...changedTabDeltas);

    // The order of the tabs: a tab that only moved has an identical partner and
    // would produce nothing. Sent only when the author's order differs from where
    // approval would leave the tabs without it, so an add at the end sends none.
    const localTabKeys = localTabs.map(t => t.tabKey);
    const isCloudTab = (key) => cloudTabs.some(t => t.tabKey === key);
    const withoutOrder = cloudTabs.map(t => t.tabKey).filter(k => localTabKeys.includes(k))
        .concat(localTabKeys.filter(k => !isCloudTab(k)));
    if (localTabKeys.join(' ') !== withoutOrder.join(' ')) {
        deltas.push({ scope: 'system_tab_order', key: 'full', payload: localTabKeys });
    }

    // Tier lists are not split per tier: moving a character from A to S changes two
    // tiers at once.
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
