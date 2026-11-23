/**
 * Sync and the preview: the Block buffer written back into the page's data, the
 * live preview redrawn, and VIEW DIFF (side by side, or the change list).
 * @since v0.4, as part of editor.js
 * @touches currentStrategyBlocks (editor-blocks.js), window.currentEditorDescData
 *   and currentEditorFrameData, loadPageDescriptions (page_render.js),
 *   approved_revisions, diff-markers.js, side-by-side.js
 * @watch triggerManualSync and updateLivePreview branch on the page type and tab
 *   almost alike, and both decide where the buffer is written back: they stay
 *   together so they cannot drift
 * @see docs/editor.md
 */

// Writes the buffer back into the open entry of a keyed section (character_tabs.js):
// the buffer reaches desc_data only on sync. Checked that the entry still
// exists, since a sync racing a delete could write into another topic. Not named
// `flush`: every file here shares one global scope.
function flushKeyedSection(id, blocks) {
    const section = window.getKeyedSectionByTab ? window.getKeyedSectionByTab(id) : null;
    const idx = (window.currentKeyedIndex || {})[id];
    if (!section || idx === undefined || !window.currentEditorDescData) return;
    const entry = (window.currentEditorDescData[section.field] || [])[idx];
    if (!entry) return;
    entry.content = JSON.parse(JSON.stringify(blocks));
}


// diffTextLCS and resolveDiffMarkers come from diff-markers.js, the file the
// review queue loads too.

// Preview only on Sync (Config): an edit still reaches the data, the UNDO history
// and the draft, and only the redraw waits. Everything through triggerManualSync
// draws (Sync and every section switch), so the preview never shows another place.
let previewSyncDepth = 0;
// A held edit leaves the preview behind for its own section only, so the next
// draw is a whole one: a single-section repaint would skip that section.
let previewMissedDraw = false;
function previewHeld() {
    return previewSyncDepth === 0 && !!window.editorConfig && window.editorConfig.get('previewOnSync') === true;
}

/**
 * Draws the preview now, also when Config holds it for Sync.
 * @since v1.1
 */
window.drawLivePreviewNow = function (skipHistory = false) {
    previewSyncDepth++;
    try {
        updateLivePreview(skipHistory);
    } finally {
        previewSyncDepth--;
    }
};

/**
 * The Sync button. A system page's triggerManualSync only flushes, so the redraw
 * is asked for here.
 * @since v1.1
 */
window.syncWorkspace = async function () {
    await window.triggerManualSync();
    if (window.currentEditorPageType === 'system') window.drawLivePreviewNow(true);
};

/**
 * Writes the Block buffer back into the section on screen, then redraws.
 */
window.triggerManualSync = async function () {
    previewSyncDepth++;
    try {
        await syncEditorBuffer();
    } finally {
        previewSyncDepth--;
    }
};

async function syncEditorBuffer() {
    if (window.currentEditorPageType === 'system') {
        if (window.currentEditorDescData && window.currentEditorDescData.tabs) {
            let tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
            if (tab && tab.sections && tab.sections[window.currentSystemSecIdx]) {
                tab.sections[window.currentSystemSecIdx].blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
            }
        }
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return; // the character branch below must not run
    } else if (window.currentEditorPageType === 'tierlist') {
        // The tier list binds its own data on input.
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return; 
    } else if (window.currentEditorPageType === 'tool') {
        // Intro and notes are two Block arrays behind one buffer, so the flush asks
        // which is on screen.
        if (typeof window.flushToolBlocks === 'function') window.flushToolBlocks();
        if (typeof window.renderToolPage === 'function' && window.currentEditorCharId) {
            window.renderToolPage(window.currentEditorCharId);
        }
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return;
    }

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
    } else if (window.getDocumentSections && window.getDocumentSections(tabId)) {
        // A document tab (Combos, Techs): the buffer belongs to whichever of its three
        // sections is open, and the tab is composed, not one Block list. The generic
        // branch would replace the tab with a bare Block dump.
        if (typeof window.flushDocumentSection === 'function') window.flushDocumentSection();
        window.renderDocumentPreview(tabId);
    } else if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tabId)) {
        // Any keyed section: the open entry's Blocks go back into it before the redraw.
        flushKeyedSection(tabId, currentStrategyBlocks);
        window.renderKeyedSectionPreview(tabId);
    } else if (typeof updateLivePreview === 'function') {
        updateLivePreview();
    }
    
    if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
}

/**
 * Whether the system page's preview still matches this tab's data in all but
 * Block content, which gates the single-section repaint. A whole-tab check:
 * deleting a section shifts every index after it. False on anything it cannot
 * verify, which costs one full redraw.
 * @since v0.18
 */
window.systemPreviewMatchesData = function (tab) {
    if (!tab || !Array.isArray(tab.sections) || !tab.sections.length) return false;

    const container = document.getElementById(`tab-${tab.tabId}`);
    // Hidden means a tab switch, which must also move the nav highlight.
    if (!container || container.classList.contains('hidden')) return false;

    const rendered = container.querySelectorAll('.wiki-section');
    if (rendered.length !== tab.sections.length) return false;

    return tab.sections.every((section, idx) => {
        const content = document.getElementById(`system-${tab.tabId}-sec-${idx}`);
        if (!content || !content.parentElement) return false;

        const node = content.parentElement;
        if (!node.classList.contains('wiki-section')) return false;

        // textContent, so it compares with the raw title: escaped output would differ
        // for every title with an ampersand.
        const heading = node.querySelector('h2.section-title');
        if ((heading ? heading.textContent : '') !== (section.sectionTitle || '')) return false;

        // The renderer writes geometry inline, so it reads back exactly.
        const width = section.width === undefined ? null : `0 0 ${section.width}%`;
        if (width !== null && node.style.flex !== width) return false;

        return true;
    });
};

/**
 * Writes the buffer into the page's data, records history (unless skipHistory),
 * saves the draft and redraws the preview. The Block editor calls it after
 * every change.
 */
function updateLivePreview(skipHistory = false) {
    // Not while VIEW DIFF has another version in the editor's place
    // (drawTabApart): this would write the Workspace into that version.
    if (window.afterDrawingApart(() => updateLivePreview(skipHistory))) return;
    const draw = !previewHeld();
    if (!draw) previewMissedDraw = true;
    if (!skipHistory && typeof window.saveBlockHistory === 'function') {
        window.saveBlockHistory();
    }

    if (window.currentEditorPageType === 'tool') {
        if (typeof window.flushToolBlocks === 'function') window.flushToolBlocks();
        if (draw && typeof window.renderToolPage === 'function' && window.currentEditorCharId) {
            window.renderToolPage(window.currentEditorCharId);
        }
        if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        return;
    }

    if (window.currentEditorPageType === 'system' || window.currentEditorPageType === 'tierlist') {
        if (window.currentEditorPageType === 'system') {
            let syncedTab = null;
            if (window.currentEditorDescData && window.currentEditorDescData.tabs) {
                let tab = window.currentEditorDescData.tabs[window.currentSystemTabIdx];
                if (tab && tab.sections && tab.sections[window.currentSystemSecIdx]) {
                    tab.sections[window.currentSystemSecIdx].blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
                    syncedTab = tab;
                }
            }

            if (!draw) {
                if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
                return;
            }

            // A system page repaints only the section being edited: a full rebuild per
            // keystroke re-rendered the whole document. Only while the structural check
            // above passes, so anything structural takes the full rebuild. A missed case
            // costs a redraw, never a stale preview.
            if (syncedTab && !previewMissedDraw && window.systemPreviewMatchesData(syncedTab)
                && typeof window.populateTextSection === 'function') {
                window.populateTextSection(
                    `system-${syncedTab.tabId}-sec-${window.currentSystemSecIdx}`,
                    '',
                    syncedTab.sections[window.currentSystemSecIdx].blocks,
                    'system-content');
                if (!skipHistory && typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
                return;
            }

            previewMissedDraw = false;
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
        return; // the character branch below must not run
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
    // The tab triggerManualSync reads, with editor-core.js's own default: a raw
    // ?tab= gave null when the URL had none, and built a phantom section from the
    // previous section's Blocks.
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

        if (draw && activeMoveId && typeof window.populateTextSection === 'function') {
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

        if (draw) renderFullOverviewPreview();

    } else if (tabId === 'matchups') {
        if (window.currentEditorDescData && window.currentMatchupIndex !== undefined && window.currentEditorDescData.matchups[window.currentMatchupIndex]) {
            window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
        if (draw && typeof renderMatchupsPreview === 'function') renderMatchupsPreview();

    } else if (window.getDocumentSections && window.getDocumentSections(tabId)) {
        // As in triggerManualSync: this runs on every keystroke in a Block.
        if (typeof window.flushDocumentSection === 'function') window.flushDocumentSection();
        if (draw && typeof window.renderDocumentPreview === 'function') window.renderDocumentPreview(tabId);

    } else if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tabId)) {
        flushKeyedSection(tabId, currentStrategyBlocks);
        if (draw && typeof window.renderKeyedSectionPreview === 'function') window.renderKeyedSectionPreview(tabId);

    } else if (draw) {
        // The buffer straight into the preview, with no data to write it into.
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
    if (!draw) return;

    if (previewPane) {
        setTimeout(() => {
            previewPane.querySelectorAll('details').forEach(d => {
                const title = d.querySelector('summary')?.textContent.trim();
                const match = openAccordions.find(o => o.title === title && o.isOpen);
                if (match) d.open = true;
            });
        }, 50);
    }

    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
    
    // Math in the live preview, fetched the first time there is some.
    setTimeout(() => window.renderMathIfAny(document.querySelector('.live-preview-pane')), 150);
}

/**
 * VIEW DIFF: a "Compare with" picker over the side by side the Overseer uses
 * (side-by-side.js). The left side is the live page, or a past version from the
 * approved edits the site knows the whole page after; the right side is the page
 * in this editor. CHANGE LIST is the list (renderDiffView).
 */
window.toggleDiffMode = async function() {
    window.isDiffModeActive = !window.isDiffModeActive;
    const btn = document.getElementById('btn-toggle-diff');

    if (window.isDiffModeActive) {
        btn.className = "btn-sys btn-sys-purple btn-purple-fill";
        btn.textContent = "EXIT DIFF";
        await window.showEditorSideBySide();
    } else {
        btn.className = "btn-sys btn-sys-purple";
        btn.textContent = "VIEW DIFF";

        editorSideBySideRun++;
        if (editorSideBySide) { editorSideBySide.destroy(); editorSideBySide = null; }
        workspaceKeptOpen = false;
        foldWorkspace(false);
        const diffCont = document.getElementById('diff-view-container');
        if (diffCont) diffCont.remove();

        const standardCont = document.getElementById('standard-preview-container');
        if (standardCont) standardCont.classList.remove('hidden');
    }
};

let editorSideBySide = null;
let editorSideBySideRun = 0;

// While the side by side is up, the Workspace folds away, so each half gets half
// the window. The bar's WORKSPACE button brings it back for this VIEW DIFF; a
// view without that button unfolds it, since EXIT DIFF is in it.
let workspaceKeptOpen = false;
function foldWorkspace(fold) {
    const layout = document.querySelector('.editor-layout-split');
    if (layout) layout.classList.toggle('sbs-workspace-folded', fold);
}

// Set while drawTabApart has the preview's ids parked and another version in the
// editor's place. A typing pause that runs out then (the forms wait 400ms) would
// write the Workspace into that version, so what those timers call waits and
// runs in order afterwards. afterDrawingApart returns true when it waited.
let drawingApart = false;
const waitingForEditorData = [];
window.afterDrawingApart = function (fn) {
    if (!drawingApart) return false;
    waitingForEditorData.push(fn);
    return true;
};
let compareWith = 'live';
let pastVersions = null;
const pastVersionPages = new Map();

// Only the editor's own data from here: a state's slice, as editor-modes.js cuts it.
function editorModeSlice(master) {
    const mode = window.editorActiveMode;
    if (!master || !mode || (typeof window.isBaseMode === 'function' && window.isBaseMode(mode))) return master || {};
    return (master.modeData && master.modeData[mode]) || {};
}

function editorDiffHost() {
    const standard = document.getElementById('standard-preview-container');
    if (standard) standard.classList.add('hidden');
    let host = document.getElementById('diff-view-container');
    if (!host) {
        host = document.createElement('div');
        host.id = 'diff-view-container';
        host.className = 'main-content-area';
        document.querySelector('main.main-content').appendChild(host);
    }
    host.innerHTML = '';
    return host;
}

function editorDiffTabId() {
    if (window.currentEditorPageType === 'system') {
        const tab = ((window.currentEditorDescData || {}).tabs || [])[window.currentSystemTabIdx];
        return tab ? tab.tabId : null;
    }
    return window.currentEditorTabId || 'overview';
}

// Where an approved edit was, in the tab strip's words.
function pastVersionPlace(rev) {
    if (!rev.is_delta) return 'whole page';
    if (rev.target_scope === 'multi') return 'several places';
    const { scope, key } = typeof window.unwrapModeDelta === 'function'
        ? window.unwrapModeDelta(rev.target_scope, rev.target_key)
        : { scope: rev.target_scope, key: rev.target_key };
    const labels = typeof window.getCharacterTabLabels === 'function' ? window.getCharacterTabLabels() : {};
    if (scope === 'move' && key) return labels[String(key).split('::')[0]] || 'a move';
    const keyed = window.getKeyedSectionByScope && window.getKeyedSectionByScope(scope);
    if (keyed) return labels[keyed.tab] || keyed.label;
    const fixed = (window.FIXED_BLOCK_SECTIONS || []).find(f => f.scope === scope);
    if (fixed) return labels[fixed.tab] || fixed.label;
    if (['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) return labels.overview || 'Overview';
    if (scope === 'system_section' || scope === 'system_tab') {
        const tabKey = scope === 'system_section' && window.splitSystemKey ? window.splitSystemKey(key).tabKey : key;
        const tab = window.findSystemTab && window.findSystemTab(window.currentEditorDescData || {}, tabKey);
        return (tab && (tab.tabLabel || tab.tabId)) || 'a tab';
    }
    if (scope === 'pageConfig') return 'Page Settings';
    return String(scope);
}

const pastVersionDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// The approved edits the site knows the whole page after (approved_at set, from
// migration 20261029000001 on). Older ones only know what they changed, and stay
// on the History page.
async function loadPastVersions() {
    if (pastVersions) return pastVersions;
    const { data, error } = await window.supabaseClient
        .from('approved_revisions')
        .select('id, author_name, approved_at, is_delta, target_scope, target_key')
        .eq('page_id', window.currentEditorCharId)
        .not('approved_at', 'is', null)
        .order('approved_at', { ascending: false })
        .limit(50);
    if (error) {
        // Not kept, so the next VIEW DIFF asks again.
        console.warn('[Editor] Past versions could not be listed:', error.message);
        return [];
    }
    pastVersions = (data || []).map(rev => ({
        id: rev.id,
        date: pastVersionDate(rev.approved_at),
        label: `${pastVersionDate(rev.approved_at)}, ${rev.author_name || 'someone'} (${pastVersionPlace(rev)})`,
    }));
    return pastVersions;
}

// The left side: the live page as loaded, or a past version.
async function comparedVersion(id) {
    if (id === 'live') {
        return { desc: window.originalCloudDescData || {}, frame: window.originalCloudMasterFrame || window.originalCloudFrameData || {} };
    }
    if (!pastVersionPages.has(id)) {
        const { data, error } = await window.supabaseClient.rpc('get_page_after_revision', { target_revision_id: id });
        if (error || !data) return { error: error ? error.message : 'the site does not have the whole page after that edit' };
        pastVersionPages.set(id, data);
    }
    const page = pastVersionPages.get(id);
    const desc = window.currentEditorPageType === 'system' ? (page.desc_data || {}) : editorModeSlice(page.desc_data || {});
    return { desc, frame: page.frame_data || {} };
}

// One version of a tab in a box of its own, so the preview stays as it was. While
// it draws, every id in the preview is parked and this box is first in the pane,
// so a renderer looking an id up finds this copy. `version` null is the editor's.
async function drawTabApart(tabId, version) {
    const charId = window.currentEditorCharId;
    const pageType = window.currentEditorPageType || 'character';
    const main = document.querySelector('.live-preview-pane main.main-content');
    const standard = document.getElementById('standard-preview-container');
    const holder = document.createElement('div');
    if (!main || !standard) return holder;

    drawingApart = true;
    const parked = Array.from(standard.querySelectorAll('[id]'));
    parked.forEach(el => { el.dataset.sbsParked = el.id; el.removeAttribute('id'); });

    const host = document.createElement('div');
    host.className = 'main-content-area sbs-render-host';
    if (pageType !== 'system') {
        const box = document.createElement('div');
        box.id = `tab-${tabId}`;
        const twin = parked.find(el => el.dataset.sbsParked === `tab-${tabId}`);
        box.className = twin ? twin.className : 'tab-content';
        box.classList.remove('hidden');
        host.appendChild(box);
    }
    main.insertBefore(host, main.firstChild);

    const saved = {
        desc: window.currentEditorDescData,
        frameView: window.currentEditorFrameData,
        frame: (window.cachedMasterFrameData || {})[charId],
    };
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    if (version) {
        window.currentEditorDescData = version.desc;
        window.currentEditorFrameData = editorModeSlice(version.frame);
        window.cachedMasterFrameData[charId] = version.frame;
    }
    try {
        const movesOnScreen = (window.FRAME_MOVE_CATEGORIES || []).includes(tabId);
        if (movesOnScreen && typeof window.loadMoveSection === 'function') await window.loadMoveSection(charId, tabId);
        if (typeof window.loadPageDescriptions === 'function') await window.loadPageDescriptions(charId, pageType);
        // Move strategies and the profile card's Previous and Next tiles come in after
        // the rest (page_render.js).
        if (movesOnScreen && window.moveStrategiesDrawn) await window.moveStrategiesDrawn;
        if (window.profilePagerFilled) await Promise.resolve(window.profilePagerFilled).catch(() => {});
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

        const drawn = document.getElementById(`tab-${tabId}`);
        if (drawn) {
            holder.className = drawn.className;
            holder.classList.remove('hidden', 'active', 'tab-content');
            holder.classList.add('sbs-version');
            while (drawn.firstChild) holder.appendChild(drawn.firstChild);
        }
        return holder;
    } finally {
        window.currentEditorDescData = saved.desc;
        window.currentEditorFrameData = saved.frameView;
        window.cachedMasterFrameData[charId] = saved.frame;
        host.remove();
        parked.forEach(el => { el.id = el.dataset.sbsParked; delete el.dataset.sbsParked; });
        drawingApart = false;
        waitingForEditorData.splice(0).forEach(fn => fn());
    }
}

function comparePicker() {
    const wrap = document.createElement('label');
    wrap.className = 'sbs-compare';
    wrap.append('Compare with ');
    const select = document.createElement('select');
    select.id = 'sbs-compare-with';
    select.className = 'editor-select';
    // new Option sets text, never markup: an author's name is contributor text.
    select.append(new Option('The live page', 'live'));
    (pastVersions || []).forEach(v => select.append(new Option(v.label, v.id)));
    if (!(pastVersions || []).length) {
        const none = new Option('No past versions since Oct 29, 2026', '');
        none.disabled = true;
        select.append(none);
    }
    select.value = compareWith;
    // `change`: the site's dropdown only dispatches change.
    select.addEventListener('change', () => {
        if (!select.value) return;
        compareWith = select.value;
        window.showEditorSideBySide();
    });
    wrap.appendChild(select);
    return wrap;
}

// The list behind the side by side, and the way back from it.
function changeListButton() {
    const list = document.createElement('button');
    list.type = 'button';
    list.className = 'btn-sys btn-sys-regular';
    list.textContent = 'CHANGE LIST';
    list.addEventListener('click', () => {
        editorSideBySideRun++;
        if (editorSideBySide) { editorSideBySide.destroy(); editorSideBySide = null; }
        foldWorkspace(false);
        window.renderDiffView();
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'btn-sys btn-sys-purple';
        back.textContent = 'SIDE BY SIDE';
        back.addEventListener('click', () => window.showEditorSideBySide());
        const container = document.getElementById('diff-view-container');
        if (container) container.prepend(back);
    });
    return list;
}

/**
 * Draws the side by side. A version that will not draw says so, with the list and
 * the picker still in reach.
 * @since v1.2
 */
window.showEditorSideBySide = async function () {
    const run = ++editorSideBySideRun;
    try {
        await drawEditorSideBySide(run);
    } catch (err) {
        console.error('[Editor] The side by side could not be drawn:', err);
        if (run !== editorSideBySideRun) return;
        const workspace = document.querySelector('.editor-workspace');
        if (workspace) workspace.inert = false;
        foldWorkspace(false);
        const host = editorDiffHost();
        host.innerHTML = '';
        const note = document.createElement('p');
        note.className = 'sbs-note';
        note.textContent = `The two versions could not be drawn side by side: ${(err && err.message) || err}.`;
        host.append(comparePicker(), changeListButton(), note);
    }
};

async function drawEditorSideBySide(run) {
    if (editorSideBySide) { editorSideBySide.destroy(); editorSideBySide = null; }
    const host = editorDiffHost();

    // A tier list, a tool, a gallery are not drawn tab by tab: they keep the list.
    if (!['character', 'system'].includes(window.currentEditorPageType || 'character')) {
        window.renderDiffView();
        return;
    }
    host.innerHTML = '<p class="sbs-note">Drawing both versions...</p>';

    // Saved first, so both sides are drawn from what was typed.
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    await loadPastVersions();
    const base = await comparedVersion(compareWith);
    if (run !== editorSideBySideRun) return;
    if (base.error) {
        foldWorkspace(false);
        host.innerHTML = '';
        const note = document.createElement('p');
        note.className = 'sbs-note';
        note.textContent = `That version could not be loaded: ${base.error}.`;
        host.append(comparePicker(), note);
        return;
    }

    const tabId = editorDiffTabId();
    // Nothing typed while both are drawn can land in the wrong one.
    const workspace = document.querySelector('.editor-workspace');
    if (workspace) workspace.inert = true;
    let left;
    let right;
    try {
        left = await drawTabApart(tabId, base);
        right = await drawTabApart(tabId, null);
    } finally {
        if (workspace) workspace.inert = false;
    }
    if (run !== editorSideBySideRun) return;

    const past = (pastVersions || []).find(v => v.id === compareWith);
    const labels = past
        ? { left: past.date.toUpperCase(), leftHint: 'red: not in your editor', right: 'YOUR EDITOR', rightHint: 'green: new since then', onlyRight: 'Not in that version', onlyLeft: 'Not in your editor' }
        : { left: 'LIVE PAGE', leftHint: 'red: goes', right: 'YOUR EDITOR', rightHint: 'green: comes', onlyRight: 'Not on the live page', onlyLeft: 'Not in your editor' };

    const extra = [comparePicker()];
    // The list compares with the live page only.
    if (!past) extra.push(changeListButton());

    const workspaceBtn = document.createElement('button');
    workspaceBtn.type = 'button';
    workspaceBtn.className = 'btn-sys btn-sys-regular sbs-workspace-toggle';
    const showWorkspaceState = () => {
        workspaceBtn.textContent = workspaceKeptOpen ? 'HIDE WORKSPACE' : '◀ WORKSPACE';
        workspaceBtn.setAttribute('aria-expanded', String(workspaceKeptOpen));
    };
    workspaceBtn.addEventListener('click', () => {
        workspaceKeptOpen = !workspaceKeptOpen;
        foldWorkspace(!workspaceKeptOpen);
        showWorkspaceState();
    });
    showWorkspaceState();
    foldWorkspace(!workspaceKeptOpen);

    editorSideBySide = window.SideBySide.mount(host, left, right, { labels, leadButtons: [workspaceBtn], extraButtons: extra });
}

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
                        // Notation styles, through the helper both review screens share.
                        if (oldB.notations || newB.notations) b.notations = window.diffComboNotations(oldB.notations, newB.notations);
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
                    // A Combo Card nests like an accordion, plus its own fields: without this the
                    // card shows unchanged while its route was rewritten.
                    else if (b.type === 'theorybox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.oneliner = window.diffTextLCS(oldB.oneliner || '', newB.oneliner || '');
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.difficulty = window.diffTextLCS(oldB.difficulty || '', newB.difficulty || '');
                        b.practicality = window.diffTextLCS(oldB.practicality || '', newB.practicality || '');
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        for (let j = 0; j < Math.max(oldSeq.length, newSeq.length); j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        if (oldB.notations || newB.notations) b.notations = window.diffComboNotations(oldB.notations, newB.notations);
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                        // In Multiple Sections each tab is a whole variant, diffed like a card.
                        const oldCardSecs = oldB.sections || [];
                        const newCardSecs = newB.sections || [];
                        if (!Array.isArray(b.sections)) b.sections = [];
                        for (let j = 0; j < Math.max(oldCardSecs.length, newCardSecs.length); j++) {
                            const oSec = oldCardSecs[j] || {};
                            const nSec = newCardSecs[j] || {};
                            if (!b.sections[j]) b.sections[j] = {};
                            b.sections[j].label = window.diffTextLCS(oSec.label || '', nSec.label || '');
                            b.sections[j].title = window.diffTextLCS(oSec.title || '', nSec.title || '');
                            b.sections[j].oneliner = window.diffTextLCS(oSec.oneliner || '', nSec.oneliner || '');
                            b.sections[j].damage = window.diffTextLCS(oSec.damage || '', nSec.damage || '');
                            b.sections[j].difficulty = window.diffTextLCS(oSec.difficulty || '', nSec.difficulty || '');
                            b.sections[j].practicality = window.diffTextLCS(oSec.practicality || '', nSec.practicality || '');
                            const oSeq = oSec.sequence || [];
                            const nSeq = nSec.sequence || [];
                            b.sections[j].sequence = [];
                            for (let k = 0; k < Math.max(oSeq.length, nSeq.length); k++) {
                                b.sections[j].sequence[k] = window.diffTextLCS(oSeq[k] || '', nSeq[k] || '');
                            }
                            if (oSec.notations || nSec.notations) b.sections[j].notations = window.diffComboNotations(oSec.notations, nSec.notations);
                            b.sections[j].content = applyInlineDiffToBlocks(oSec.content || [], nSec.content || []);
                        }
                    }
                    // A Section Box nests twice: an introduction and one array per section.
                    else if (b.type === 'sectionedbox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.intro = applyInlineDiffToBlocks(oldB.intro || [], newB.intro || []);

                        const oldSec = oldB.sections || [];
                        const newSec = newB.sections || [];
                        if (!Array.isArray(b.sections)) b.sections = [];
                        for (let j = 0; j < Math.max(oldSec.length, newSec.length); j++) {
                            const oSec = oldSec[j] || {};
                            const nSec = newSec[j] || {};
                            if (!b.sections[j]) b.sections[j] = {};
                            b.sections[j].title = window.diffTextLCS(oSec.title || '', nSec.title || '');
                            b.sections[j].content = applyInlineDiffToBlocks(oSec.content || [], nSec.content || []);
                        }
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

                // A section's name and the JSON below carry contributor text: both escaped.
                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${window.escapeHtml(sectionName.toUpperCase())}</h3>
                        <div id="diff-inline-${safeId}" class="diff-inline-target"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks);
                    // As in the reviewer's view: the renderer escapes the text, then the markers
                    // become tags. No typeof guard: a missing diff-markers.js should throw where
                    // someone sees it.
                    window.resolveDiffMarkers(document.getElementById(`diff-inline-${safeId}`));
                });
            } else {
                // The diff-stacked-* classes the Overseer's raw view uses (admin-preview.js).
                diffContainer.innerHTML += `
                    <div class="diff-container diff-container-raw">
                        <h3 class="diff-section-title">${window.escapeHtml(sectionName.toUpperCase())}</h3>
                        <div class="diff-stacked-old">
                            <div class="diff-stacked-label old">[-] LIVE CLOUD DATA</div>
                            <pre class="diff-stacked-pre old">${window.escapeHtml(String(JSON.stringify(oldData, null, 2)))}</pre>
                        </div>
                        <div class="diff-stacked-new">
                            <div class="diff-stacked-label new">[+] SUGGESTED REVISION</div>
                            <pre class="diff-stacked-pre new">${window.escapeHtml(String(JSON.stringify(newData, null, 2)))}</pre>
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
    // Every keyed section, so a new one shows in the summary read before Submit:
    // one missing here would submit unseen.
    (window.getKeyedSections ? window.getKeyedSections() : []).forEach(s => {
        compareArrayOfObjects(s.entryLabel, window.originalCloudDescData[s.field],
            window.currentEditorDescData[s.field], s.keyField, 'blocks');
    });

    // Order: the submit scan (editor-core.js) and this summary both decide whether a
    // reorder counts, and must agree, or the editor submits a reorder while saying
    // nothing changed. A list that gained or lost an entry is reported above.
    const compareOrder = (label, oldList, newList, keyField) => {
        const o = (oldList || []).map(e => (e ? e[keyField] : null)).filter(v => v != null).map(String);
        const n = (newList || []).map(e => (e ? e[keyField] : null)).filter(v => v != null).map(String);
        if (o.length !== n.length || !o.length) return;
        if (o.join(' ') === n.join(' ')) return;
        if ([...o].sort().join(' ') !== [...n].sort().join(' ')) return;
        compareAndRender(`${label} order`, { order: o }, { order: n }, 'json');
    };

    compareOrder('Custom Tab', window.originalCloudDescData.extras, window.currentEditorDescData.extras, 'title');
    (window.getKeyedSections ? window.getKeyedSections() : []).forEach(sec => {
        compareOrder(sec.entryLabel, window.originalCloudDescData[sec.field],
            window.currentEditorDescData[sec.field], sec.keyField);
    });
    (window.FRAME_MOVE_CATEGORIES || []).forEach(cat => {
        const labels = window.getCharacterTabLabels ? window.getCharacterTabLabels() : {};
        compareOrder(labels[cat] || cat, (window.originalCloudFrameData || {})[cat],
            (window.currentEditorFrameData || {})[cat], 'id');
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


