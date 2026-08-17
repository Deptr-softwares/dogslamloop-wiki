/**
 * Dogslamloop Wiki - Editor: Sync & Diff Engine (pushes the in-memory block
 * buffer back into desc_data/frame_data, rebuilds the live preview, and
 * renders the pending-vs-live diff comparison)
 *
 * triggerManualSync and updateLivePreview are kept together deliberately -
 * both re-branch on pageType/tabId almost identically and both decide where
 * the block-buffer state (currentStrategyBlocks, declared in
 * js/editor-blocks.js) gets written back into desc_data; splitting them
 * apart by page-type would separate code that has to stay in sync with
 * itself.
 */

// Writes the block buffer back into whichever entry of a keyed section is
// open (js/character_tabs.js). currentStrategyBlocks is only ever written into
// desc_data on sync, so skipping this drops whatever the contributor is typing
// right now. Two separate sync paths need it, hence module scope.
//
// Guarded on the entry still existing: removeKeyedEntry clears the index, but a
// sync racing a delete could otherwise write blocks into a slot that now holds
// a different topic.
//
// Named with the section prefix rather than `flush` because every js/ file here
// shares one global lexical scope - see tests/global-scope-collisions.spec.js.
function flushKeyedSection(id, blocks) {
    const section = window.getKeyedSectionByTab ? window.getKeyedSectionByTab(id) : null;
    const idx = (window.currentKeyedIndex || {})[id];
    if (!section || idx === undefined || !window.currentEditorDescData) return;
    const entry = (window.currentEditorDescData[section.field] || [])[idx];
    if (!entry) return;
    entry.content = JSON.parse(JSON.stringify(blocks));
}


// --- INLINE TEXT DIFF ALGORITHM (SMART GROUPING) ---
window.diffTextLCS = function(oldStr, newStr) {
    oldStr = String(oldStr || ''); 
    newStr = String(newStr || '');
    if (oldStr === newStr) return newStr;
    if (!oldStr) return `<ins class="diff-add">${newStr}</ins>`;
    if (!newStr) return `<del class="diff-del">${oldStr}</del>`;

    const a = oldStr.split(/(\s+)/).filter(val => val.length > 0);
    const b = newStr.split(/(\s+)/).filter(val => val.length > 0);
    const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1] + 1;
            else matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
    }

    let i = a.length, j = b.length;
    const rawOps = [];
    
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            rawOps.unshift({ type: 'eq', text: a[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            rawOps.unshift({ type: 'ins', text: b[j - 1] }); j--;
        } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            rawOps.unshift({ type: 'del', text: a[i - 1] }); i--;
        }
    }

    for (let k = 1; k < rawOps.length - 1; k++) {
        if (rawOps[k].type === 'eq' && (!rawOps[k].text.trim() || rawOps[k].text.length === 1)) {
            if (rawOps[k-1].type !== 'eq' && rawOps[k+1].type !== 'eq') rawOps[k].type = 'trivial';
        }
    }

    let finalHtml = '';
    let currentDels = ''; let currentInss = '';
    const flushEdits = () => {
        if (currentDels) finalHtml += `<del class="diff-del">${currentDels}</del>`;
        if (currentInss) finalHtml += `<ins class="diff-add">${currentInss}</ins>`;
        currentDels = ''; currentInss = '';
    };

    for (const op of rawOps) {
        if (op.type === 'eq') { flushEdits(); finalHtml += op.text; } 
        else if (op.type === 'del') { currentDels += op.text; } 
        else if (op.type === 'ins') { currentInss += op.text; } 
        else if (op.type === 'trivial') { currentDels += op.text; currentInss += op.text; }
    }
    flushEdits(); 
    return finalHtml;
};

// --- MASTER MANUAL SYNC ---
window.triggerManualSync = async function() {
    // Safely sync the system blocks ---
    if (window.currentEditorPageType === 'system') {
        if (window.currentEditorDescData && window.currentEditorDescData.tabs) {
            let tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
            if (tab && tab.sections && tab.sections[window.currentSystemSecIdx]) {
                tab.sections[window.currentSystemSecIdx].blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
            }
        }
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return; // CRITICAL: Exit early so the Character logic below doesn't trigger!
    } else if (window.currentEditorPageType === 'tierlist') {
        // Tierlist handles its own data binding natively via oninput
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return; 
    } else if (window.currentEditorPageType === 'tool') {
        // Intro and notes are ordinary block arrays behind one buffer, so the
        // flush has to know which of the two is on screen.
        if (typeof window.flushToolBlocks === 'function') window.flushToolBlocks();
        if (typeof window.renderToolPage === 'function' && window.currentEditorCharId) {
            window.renderToolPage(window.currentEditorCharId);
        }
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return;
    }

    // --- CHARACTER SYNC LOGIC ---
    const tabId = window.currentEditorTabId;
    const frameTabs = window.FRAME_MOVE_CATEGORIES;

    if (frameTabs.includes(tabId) && typeof window.loadMoveSection === 'function') {
        let activeMoveId = new URLSearchParams(window.location.search).get('move'); 
        
        if (!activeMoveId) {
            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
            if (activeBtn) activeMoveId = activeBtn.id.replace('move-nav-', '');
        }
        
        if (activeMoveId) {
            await window.loadMoveSection(window.currentEditorCharId, tabId, activeMoveId);
        }
    }

    if (tabId === 'overview' && typeof renderFullOverviewPreview === 'function') {
        const sectionId = window.currentOverviewSection || 'overview';
        if (sectionId === 'overview') window.currentEditorDescData.overview = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (sectionId === 'strategy') window.currentEditorDescData.strategy = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (sectionId.startsWith('extra-')) window.currentEditorDescData.extras[parseInt(sectionId.split('-')[1])].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        
        renderFullOverviewPreview();
    } else if (tabId === 'matchups' && typeof renderMatchupsPreview === 'function') {
        if (window.currentEditorDescData && window.currentMatchupIndex !== undefined) {
            window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
        renderMatchupsPreview();
    } else if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tabId)) {
        // Any keyed section (js/character_tabs.js). Flushes the open entry's
        // blocks back into it before redrawing, which is what stops the buffer
        // being dropped when the contributor switches away.
        flushKeyedSection(tabId, currentStrategyBlocks);
        window.renderKeyedSectionPreview(tabId);
    } else if (typeof updateLivePreview === 'function') {
        updateLivePreview();
    }
    
    if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
};

// --- LIVE SYNC & STATE MANAGEMENT ---
function updateLivePreview(skipHistory = false) {
    if (!skipHistory && typeof window.saveBlockHistory === 'function') {
        window.saveBlockHistory();
    }

    if (window.currentEditorPageType === 'tool') {
        if (typeof window.flushToolBlocks === 'function') window.flushToolBlocks();
        if (typeof window.renderToolPage === 'function' && window.currentEditorCharId) {
            window.renderToolPage(window.currentEditorCharId);
        }
        if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return;
    }

    // --- Safely sync the blocks and bypass Character Preview logic ---
    if (window.currentEditorPageType === 'system' || window.currentEditorPageType === 'tierlist') {
        if (window.currentEditorPageType === 'system') {
            if (window.currentEditorDescData && window.currentEditorDescData.tabs) {
                let tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
                if (tab && tab.sections && tab.sections[window.currentSystemSecIdx]) {
                    tab.sections[window.currentSystemSecIdx].blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
                }
            }
            if (typeof window.loadPageDescriptions === 'function') window.loadPageDescriptions(window.currentEditorCharId, 'system');
            setTimeout(() => {
                if (window.currentEditorDescData && window.currentEditorDescData.tabs) {
                    const activeTabId = window.currentEditorDescData.tabs[window.currentSystemTabIdx]?.tabId;
                    if (activeTabId) {
                        const previewPane = document.querySelector('.live-preview-pane');
                        if (previewPane) {
                            previewPane.querySelectorAll('#system-dynamic-nav .btn-manga').forEach(btn => btn.classList.remove('active'));
                            const navBtn = previewPane.querySelector(`#nav-${activeTabId}`);
                            if (navBtn) navBtn.classList.add('active');
                            
                            previewPane.querySelectorAll('.main-content-area > .tab-content').forEach(tab => tab.classList.add('hidden'));
                            const contentTab = previewPane.querySelector(`#tab-${activeTabId}`);
                            if (contentTab) contentTab.classList.remove('hidden');
                        }
                    }
                }
            }, 150);
        } else if (window.currentEditorPageType === 'tierlist') {
            if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
            return; 
        }
        
        if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return; // CRITICAL
    }

    const previewPane = document.querySelector('.live-preview-pane');
    let openAccordions = [];
    if (previewPane) {
        openAccordions = Array.from(previewPane.querySelectorAll('details')).map(d => ({
            title: d.querySelector('summary')?.textContent.trim(),
            isOpen: d.open
        }));
    }

    const urlParams = new URLSearchParams(window.location.search);
    // window.currentEditorTabId is the authoritative tab, the same thing
    // triggerManualSync above reads. This used to take urlParams.get('tab')
    // raw, which disagreed with editor-core.js's own `urlParams.get('tab') ||
    // 'overview'` boot default - so opening the editor without a ?tab= gave
    // the editor 'overview' and gave this function null. null matched no
    // branch below, fell through to the generic else, and built a phantom
    // "tab-null" section titled "Editing null" out of currentStrategyBlocks,
    // which still held the previous section's blocks. That is the reported
    // uneditable section that copied the last section's contents, and the
    // reason the preview looked like it was not picking up new content when
    // intercepting a ticket that carried no &tab=.
    const tabId = window.currentEditorTabId || urlParams.get('tab') || 'overview';
    const frameTabs = window.FRAME_MOVE_CATEGORIES;

    if (frameTabs.includes(tabId)) {
        let activeMoveId = urlParams.get('move'); 
        if (!activeMoveId && window.currentEditorTabId) {
            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
            if (activeBtn) activeMoveId = activeBtn.id.replace('move-nav-', '');
        }
        
        if (activeMoveId && window.currentEditorDescData) {
            if (!window.currentEditorDescData.moveStrategies) {
                window.currentEditorDescData.moveStrategies = {};
            }
            window.currentEditorDescData.moveStrategies[activeMoveId] = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }

        if (activeMoveId && typeof window.populateTextSection === 'function') {
            const targetId = `strategy-${activeMoveId}`;
            let previewTarget = document.getElementById(targetId);
            
            if (!previewTarget) {
                previewTarget = document.createElement('div');
                previewTarget.id = targetId;
                const fallbackContainer = document.getElementById(`tab-${tabId}`) || document.querySelector('.live-preview-pane .main-content-area');
                if (fallbackContainer) fallbackContainer.appendChild(previewTarget);
            }

            window.populateTextSection(targetId, 'Move Overview and Strategy', currentStrategyBlocks, 'move-strategy');
            if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
        }

    } else if (tabId === 'overview') {
        const sectionId = window.currentOverviewSection || 'overview';

        if (sectionId === 'overview') {
            if (window.currentEditorDescData) window.currentEditorDescData.overview = JSON.parse(JSON.stringify(currentStrategyBlocks));
        } else if (sectionId === 'strategy') {
            if (window.currentEditorDescData) window.currentEditorDescData.strategy = JSON.parse(JSON.stringify(currentStrategyBlocks));
        } else if (sectionId.startsWith('extra-')) {
            const idx = parseInt(sectionId.split('-')[1]);
            if (window.currentEditorDescData) window.currentEditorDescData.extras[idx].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }

        renderFullOverviewPreview();

    } else if (tabId === 'matchups') {
        if (window.currentEditorDescData && window.currentMatchupIndex !== undefined && window.currentEditorDescData.matchups[window.currentMatchupIndex]) {
            window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
        if (typeof renderMatchupsPreview === 'function') renderMatchupsPreview();

    } else if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tabId)) {
        flushKeyedSection(tabId, currentStrategyBlocks);
        if (typeof window.renderKeyedSectionPreview === 'function') window.renderKeyedSectionPreview(tabId);

    } else {
        if (typeof window.populateTextSection === 'function') {
            const targetId = `tab-${tabId}`;
            let previewTarget = document.getElementById(targetId);
            
            if (!previewTarget) {
                previewTarget = document.createElement('div');
                previewTarget.id = targetId;
                const fallbackContainer = document.querySelector('.live-preview-pane .main-content-area');
                if (fallbackContainer) fallbackContainer.appendChild(previewTarget);
            }

            const sectionTitle = `Editing ${tabId}`;
            window.populateTextSection(targetId, sectionTitle, currentStrategyBlocks);
            if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50); 
        }
    }
    
    if (!skipHistory && typeof window.saveLocalDraft === 'function') {
        window.saveLocalDraft();
    }

    if (previewPane) {
        setTimeout(() => {
            previewPane.querySelectorAll('details').forEach(d => {
                const title = d.querySelector('summary')?.textContent.trim();
                const match = openAccordions.find(o => o.title === title && o.isOpen);
                if (match) d.open = true;
            });
        }, 50);
    }

    // --- REFRESH EXTERNAL UI HOOKS ---
    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
    
    // Trigger KaTeX to render LaTeX automatically in the live preview
    if (window.renderMathInElement) {
        setTimeout(() => {
            renderMathInElement(document.querySelector('.live-preview-pane'), {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }, 150);
    }
}

// --- VISUAL DIFF COMPARISON ENGINE ---
window.toggleDiffMode = function() {
    window.isDiffModeActive = !window.isDiffModeActive;
    const btn = document.getElementById('btn-toggle-diff');
    
    if (window.isDiffModeActive) {
        btn.className = "btn-sys btn-sys-purple btn-purple-fill";
        btn.textContent = "EXIT DIFF";
        window.renderDiffView();
    } else {
        btn.className = "btn-sys btn-sys-purple";
        btn.textContent = "VIEW DIFF";
        
        const diffCont = document.getElementById('diff-view-container');
        if (diffCont) diffCont.remove();
        
        const standardCont = document.getElementById('standard-preview-container');
        if (standardCont) standardCont.classList.remove('hidden');
    }
};

// --- VISUAL DIFF COMPARISON ENGINE ---
window.renderDiffView = function() {
    document.getElementById('standard-preview-container').classList.add('hidden');
    
    let diffContainer = document.getElementById('diff-view-container');
    if (!diffContainer) {
        diffContainer = document.createElement('div');
        diffContainer.id = 'diff-view-container';
        diffContainer.className = 'main-content-area';
        
        document.querySelector('main.main-content').appendChild(diffContainer);
    }
    
    diffContainer.innerHTML = '<h2 class="section-title">REVISION COMPARISON</h2>';
    let changesFound = false;
    let diffRenderQueue = []; 

    const compareAndRender = (sectionName, oldData, newData, type = 'blocks') => {
        const oldStr = JSON.stringify(oldData || null);
        const newStr = JSON.stringify(newData || null);

        if (oldStr !== newStr) {
            changesFound = true;
            const safeId = sectionName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 10000);

            if (type === 'blocks') {
                const oldBlocks = Array.isArray(oldData) ? oldData : [];
                const newBlocks = Array.isArray(newData) ? newData : [];

                const diffBlockContent = (b, oldB, newB) => {
                    if (b.type === 'paragraph' || b.type === 'heading' || b.type === 'callout') {
                        let oldText = Array.isArray(oldB.content) ? oldB.content.join('<br>') : (oldB.content || '');
                        let newText = Array.isArray(newB.content) ? newB.content.join('<br>') : (newB.content || '');
                        b.content = window.diffTextLCS(oldText, newText);
                        if (b.type === 'callout') b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                    }
                    else if (b.type === 'list') {
                        const oldItems = oldB.items || [];
                        const newItems = newB.items || [];
                        if (!b.items) b.items = [];
                        const maxLen = Math.max(oldItems.length, newItems.length);
                        for (let j = 0; j < maxLen; j++) {
                            b.items[j] = window.diffTextLCS(oldItems[j] || '', newItems[j] || '');
                        }
                    }
                    else if (b.type === 'combo') {
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        const maxLen = Math.max(oldSeq.length, newSeq.length);
                        for (let j = 0; j < maxLen; j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.note = window.diffTextLCS(oldB.note || '', newB.note || '');
                    }
                    else if (b.type === 'table') {
                        const oldHeaders = oldB.headers || [];
                        const newHeaders = newB.headers || [];
                        if (!b.headers) b.headers = [];
                        const hMax = Math.max(oldHeaders.length, newHeaders.length);
                        for (let j = 0; j < hMax; j++) {
                            b.headers[j] = window.diffTextLCS(oldHeaders[j] || '', newHeaders[j] || '');
                        }
                        
                        const oldRows = oldB.rows || [];
                        const newRows = newB.rows || [];
                        if (!b.rows) b.rows = [];
                        const rMax = Math.max(oldRows.length, newRows.length);
                        for (let r = 0; r < rMax; r++) {
                            if (!b.rows[r]) b.rows[r] = [];
                            const oCols = oldRows[r] || [];
                            const nCols = newRows[r] || [];
                            const cMax = Math.max(oCols.length, nCols.length);
                            for (let c = 0; c < cMax; c++) {
                                b.rows[r][c] = window.diffTextLCS(oCols[c] || '', nCols[c] || '');
                            }
                        }
                    }
                    else if (b.type === 'accordion' || b.type === 'details') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                    }
                    // A combo card nests like an accordion, plus its own
                    // fields. Missing this means the reviewer sees the card
                    // unchanged while its route or damage was rewritten.
                    else if (b.type === 'theorybox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.oneliner = window.diffTextLCS(oldB.oneliner || '', newB.oneliner || '');
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.difficulty = window.diffTextLCS(oldB.difficulty || '', newB.difficulty || '');
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        for (let j = 0; j < Math.max(oldSeq.length, newSeq.length); j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                    }
                    
                    if (b.caption !== undefined) b.caption = window.diffTextLCS(oldB.caption || '', newB.caption || '');
                    if (b.author !== undefined) b.author = window.diffTextLCS(oldB.author || '', newB.author || '');
                };

                const applyInlineDiffToBlocks = (oldArr, newArr) => {
                    const diffedBlocks = [];
                    const maxLen = Math.max((oldArr || []).length, (newArr || []).length);
                    
                    for (let i = 0; i < maxLen; i++) {
                        const oldB = oldArr[i] || {};
                        const newB = newArr[i] || null;
                        
                        if (newB && oldB.type && oldB.type !== newB.type) {
                            let delB = JSON.parse(JSON.stringify(oldB));
                            diffBlockContent(delB, oldB, {});
                            diffedBlocks.push(delB);
                            
                            let addB = JSON.parse(JSON.stringify(newB));
                            diffBlockContent(addB, {}, newB);
                            diffedBlocks.push(addB);
                            continue;
                        }

                        let b = newB ? JSON.parse(JSON.stringify(newB)) : JSON.parse(JSON.stringify(oldB));
                        diffBlockContent(b, oldB, newB || {});
                        diffedBlocks.push(b);
                    }
                    return diffedBlocks;
                };

                const diffedBlocks = applyInlineDiffToBlocks(oldBlocks, newBlocks);

                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${sectionName.toUpperCase()}</h3>
                        <div id="diff-inline-${safeId}" class="diff-inline-target"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks);
                });
            } else {
                // Same diff-stacked-* classes admin.html's own raw/JSON diff view
                // uses (js/admin-preview.js, switchVersionView) - kept in sync rather than a
                // parallel editor-only copy, and diff-container-raw is the
                // only genuinely different piece (this branch's border/
                // box-shadow differ from the inline-blocks branch above).
                diffContainer.innerHTML += `
                    <div class="diff-container diff-container-raw">
                        <h3 class="diff-section-title">${sectionName.toUpperCase()}</h3>
                        <div class="diff-stacked-old">
                            <div class="diff-stacked-label old">[-] LIVE CLOUD DATA</div>
                            <pre class="diff-stacked-pre old">${JSON.stringify(oldData, null, 2)}</pre>
                        </div>
                        <div class="diff-stacked-new">
                            <div class="diff-stacked-label new">[+] SUGGESTED REVISION</div>
                            <pre class="diff-stacked-pre new">${JSON.stringify(newData, null, 2)}</pre>
                        </div>
                    </div>
                `;
            }
        }
    };

    const compareArrayOfObjects = (sectionPrefix, oldArr, newArr, keyProp, type) => {
        const oldMap = new Map((oldArr || []).map(item => [item[keyProp] || 'Unknown', item]));
        const newMap = new Map((newArr || []).map(item => [item[keyProp] || 'Unknown', item]));
        const allKeys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
        allKeys.forEach(key => {
            if (type === 'blocks') compareAndRender(`${sectionPrefix}: ${key}`, oldMap.get(key)?.content, newMap.get(key)?.content, 'blocks');
            else compareAndRender(`${sectionPrefix}: ${key}`, oldMap.get(key), newMap.get(key), 'json');
        });
    };

    compareAndRender('Profile Metadata', window.originalCloudDescData.profile, window.currentEditorDescData.profile, 'profile');
    compareAndRender('Playstyle Data', window.originalCloudDescData.playstyle, window.currentEditorDescData.playstyle, 'json');
    compareAndRender('Character Overview', window.originalCloudDescData.overview, window.currentEditorDescData.overview, 'blocks');
    compareAndRender('General Strategy', window.originalCloudDescData.strategy, window.currentEditorDescData.strategy, 'blocks');
    compareArrayOfObjects('Custom Tab', window.originalCloudDescData.extras, window.currentEditorDescData.extras, 'title', 'blocks');
    compareArrayOfObjects('Matchup', window.originalCloudDescData.matchups, window.currentEditorDescData.matchups, 'opponent', 'blocks');
    // Every keyed section, so a new one appears in the change summary the
    // contributor reads before submitting. One missing from here submits
    // silently, which is the worst version of this bug.
    (window.getKeyedSections ? window.getKeyedSections() : []).forEach(s => {
        compareArrayOfObjects(s.entryLabel, window.originalCloudDescData[s.field],
            window.currentEditorDescData[s.field], s.keyField, 'blocks');
    });

    const oldStrats = window.originalCloudDescData.moveStrategies || {};
    const newStrats = window.currentEditorDescData.moveStrategies || {};
    Array.from(new Set([...Object.keys(oldStrats), ...Object.keys(newStrats)])).forEach(k => { 
        compareAndRender(`Move Strategy: ${k}`, oldStrats[k], newStrats[k], 'blocks'); 
    });

    compareArrayOfObjects('Frame Data (M1)', window.originalCloudFrameData.m1s, window.currentEditorFrameData.m1s, 'id', 'json');
    compareArrayOfObjects('Frame Data (Skill)', window.originalCloudFrameData.skills, window.currentEditorFrameData.skills, 'id', 'json');
    compareArrayOfObjects('Frame Data (Special)', window.originalCloudFrameData.specials, window.currentEditorFrameData.specials, 'id', 'json');

    if (!changesFound) diffContainer.innerHTML += `<p class="editor-diff-empty-msg">No changes detected against the live database.</p>`;

    diffRenderQueue.forEach(fn => fn());
    if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
};


