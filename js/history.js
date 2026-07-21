window.historyRevisions = [];
window.currentHistoryIndex = 0;

// --- DELTA INJECTION ENGINE (Required to unpack partial patches) ---
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    if (scope === 'multi' && Array.isArray(payload)) {
        payload.forEach(edit => {
            const res = window.applyDeltaToData(newDesc, newFrame, edit.scope, edit.key, edit.payload);
            newDesc = res.newDesc; newFrame = res.newFrame;
        });
        return { newDesc, newFrame };
    }

    if (scope === 'system_data') return { newDesc: payload, newFrame };

    if (['profile', 'playstyle', 'overview', 'strategy'].includes(scope)) newDesc[scope] = payload;
    else if (scope === 'extra') { 
        if (!newDesc.extras) newDesc.extras = []; 
        if (payload === null) newDesc.extras = newDesc.extras.filter(e => e.title !== key);
        else {
            const idx = newDesc.extras.findIndex(e => e.title === key);
            if (idx > -1) newDesc.extras[idx] = payload; else newDesc.extras.push(payload);
        }
    }
    else if (scope === 'matchup') { 
        if (!newDesc.matchups) newDesc.matchups = []; 
        if (payload === null) newDesc.matchups = newDesc.matchups.filter(m => m.opponent !== key);
        else {
            const idx = newDesc.matchups.findIndex(m => m.opponent === key);
            if (idx > -1) newDesc.matchups[idx] = payload; else newDesc.matchups.push(payload);
        }
    }
    else if (scope === 'counterplay') { 
        if (!newDesc.counterplay) newDesc.counterplay = []; 
        if (payload === null) newDesc.counterplay = newDesc.counterplay.filter(c => c.topic !== key);
        else {
            const idx = newDesc.counterplay.findIndex(c => c.topic === key);
            if (idx > -1) newDesc.counterplay[idx] = payload; else newDesc.counterplay.push(payload);
        }
    }
    else if (scope === 'move') {
        const [cat, moveId] = key.split('::');
        if (payload === null) {
            if (newFrame[cat]) newFrame[cat] = newFrame[cat].filter(m => m.id !== moveId);
            if (newDesc.moveStrategies) delete newDesc.moveStrategies[moveId];
        } else {
            if (!newFrame[cat]) newFrame[cat] = [];
            const idx = newFrame[cat].findIndex(m => m.id === moveId);
            if (payload.frame_data) {
                if (idx > -1) newFrame[cat][idx] = payload.frame_data; else newFrame[cat].push(payload.frame_data);
            }
            if (!newDesc.moveStrategies) newDesc.moveStrategies = {};
            newDesc.moveStrategies[moveId] = payload.desc_data || [];
        }
    }
    return { newDesc, newFrame };
};

// --- RELATIVE PATH CLEANER ---
// Converts "../../medias/..." to "medias/..." so images load correctly from the root directory!
const cleanPaths = (obj) => {
    if (typeof obj === 'string') return obj.replace(/\.\.\/\.\.\//g, '');
    if (Array.isArray(obj)) return obj.map(cleanPaths);
    if (typeof obj === 'object' && obj !== null) {
        const newObj = {};
        for (let key in obj) newObj[key] = cleanPaths(obj[key]);
        return newObj;
    }
    return obj;
};

document.addEventListener('DOMContentLoaded', async () => {
    if (window.initSidebarToggle) window.initSidebarToggle();
    if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (window.initSidebarEditButton) window.initSidebarEditButton(); 

    const urlParams = new URLSearchParams(window.location.search);
    const pageId = urlParams.get('page');
    
    if (!pageId) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg">No page specified in URL.</div>`;
        return;
    }
    
    let exactCharName = pageId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (window.CHARACTER_COLORS) {
        const foundKey = Object.keys(window.CHARACTER_COLORS).find(k => k.toLowerCase() === pageId.replace(/_/g, ' ').toLowerCase());
        if (foundKey) exactCharName = foundKey;
    }

    // 1. INJECT NATIVE CHARACTER THEME
    // Set the title exactly to the character name FIRST so the theme engine finds it!
    const titleEl = document.getElementById('history-page-title');
    titleEl.textContent = exactCharName; 
    
    if (typeof window.applyCharacterTheme === 'function') {
        window.applyCharacterTheme();
    }
    
    // Once colors are applied, append the "HISTORY" text
    titleEl.textContent = `${exactCharName} HISTORY`;

    if (!window.supabaseClient) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg">Database disconnected. Cannot fetch ledger.</div>`;
        return;
    }

    // 2. FETCH ARRAY OF METADATA (Fast network request)
    const { data: revs, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .eq('page_id', pageId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

    if (error || !revs || revs.length === 0) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg" style="border: 1px dashed #333; padding: 3rem;">No history recorded for this page yet.</div>`;
        return;
    }

    window.historyRevisions = revs;
    window.currentHistoryIndex = 0;
    
    // 3. RENDER THE INITIAL PAGE
    window.renderRevision(0);
});

window.renderRevision = async function(index) {
    const rev = window.historyRevisions[index];
    const total = window.historyRevisions.length;
    const dateStr = new Date(rev.created_at).toLocaleString();
    const qa = rev.qa_metadata || {};
    const reviewer = qa.reviewed_by || 'Legacy System';

    let scopeText = rev.is_delta ? `Target Scope: ${rev.target_scope.toUpperCase()} [${rev.target_key}]` : `Target Scope: FULL OVERWRITE`;
    if (rev.target_scope === 'multi') scopeText = `Target Scope: BATCHED MULTI-EDIT (${rev.delta_payload.length} targets)`;

    // --- RENDER PAGINATION & METADATA CARD ---
    const metaCard = document.getElementById('history-meta-card');
    metaCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; background: var(--bg-main); padding: 0.5rem 1rem; border: 1px solid var(--border-color); border-radius: 4px;">
            <button class="btn-sys btn-sys-regular" onclick="window.changeHistoryPage(-1)" ${index === 0 ? 'disabled' : ''}>◀ NEWER</button>
            <span style="font-family: var(--text-mono); font-size: 0.85rem; color: var(--text-white);">Version ${total - index} of ${total}</span>
            <button class="btn-sys btn-sys-regular" onclick="window.changeHistoryPage(1)" ${index === total - 1 ? 'disabled' : ''}>OLDER ▶</button>
        </div>
        
        <div class="wiki-section" style="border-left: 4px solid var(--accent-blue); padding: 1.5rem; background: var(--bg-secondary); border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px dashed var(--border-color); flex-wrap: wrap; gap: 1rem;">
                <div>
                    <h3 style="margin: 0; color: var(--text-white); font-family: 'CC-Wild-Words', sans-serif; font-size: 1.2rem;">REVISION <span style="color:#a855f7;">#${rev.id.substring(0,8).toUpperCase()}</span></h3>
                    <div style="font-size: 0.75rem; color: var(--accent-blue); font-family: var(--text-mono); margin-top: 0.25rem;">${dateStr}</div>
                </div>
                <div style="text-align: right; font-size: 0.75rem; font-family: var(--text-mono); color: var(--text-muted);">
                    <div style="margin-bottom: 0.25rem;">Author: <strong style="color: #fff; font-size: 0.85rem;">${rev.author_name}</strong></div>
                    <div>Approved By: <strong style="color: #34d399; font-size: 0.85rem;">${reviewer}</strong></div>
                </div>
            </div>
            
            <div style="font-size: 0.85rem; color: #d1d5db; line-height: 1.6; font-family: var(--text-mono);">
                <div style="margin-bottom: 0.75rem; display: inline-block; background: #222; padding: 0.25rem 0.5rem; border-radius: 2px; color: #a855f7;">${scopeText}</div><br>
                <strong style="color: #fff; text-transform: uppercase;">Public Changelog:</strong><br>
                ${(qa.changelog || 'No notes provided.').replace(/\n/g, '<br>')}
            </div>
        </div>
    `;

    // --- RECONSTRUCT THE PAYLOAD ---
    window.currentEditorPageType = rev.page_type || 'character';
    window.activePreviewCharId = rev.page_id;

    let renderDesc = {}; let renderFrame = {};
    if (rev.is_delta) {
        const res = window.applyDeltaToData({}, {}, rev.target_scope, rev.target_key, rev.delta_payload);
        renderDesc = res.newDesc; renderFrame = res.newFrame;
    } else {
        renderDesc = rev.desc_data || {}; renderFrame = rev.frame_data || {};
    }

    // Set Global Context & Clean paths to prevent 404 errors!
    window.currentEditorDescData = cleanPaths(renderDesc);
    window.currentEditorFrameData = cleanPaths(renderFrame);

    // --- DYNAMICALLY RENDER TABS ---
    const mainArea = document.getElementById('history-content-area');
    mainArea.innerHTML = '';
    
    if (window.currentEditorPageType === 'system') {
        const tabs = window.currentEditorDescData.tabs || [];
        if (tabs.length === 0) {
            mainArea.innerHTML = '<div class="empty-tab-msg">No readable content found in this payload.</div>';
            return;
        }

        // Do NOT build the tabs here! Let description.js build the dynamic system UI natively.
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(rev.page_id, 'system');
            
            // Catch the auto-generated Navigation Bar and move it down into the History container
            const sysNav = document.getElementById('system-dynamic-nav');
            if (sysNav) {
                sysNav.style.marginTop = '0'; // Remove top margin to sit flush under the history card
                mainArea.appendChild(sysNav);
            }
            
            // Catch all the auto-generated Tab Content Containers and move them into the History container
            document.querySelectorAll('main.main-content-area > .tab-content').forEach(tab => {
                if (tab.parentElement !== mainArea) {
                    mainArea.appendChild(tab);
                }
            });
        }
        
    } else {
        let validTabs = [];
        if (renderDesc.profile || renderDesc.playstyle || renderDesc.overview || renderDesc.strategy || (renderDesc.extras && renderDesc.extras.length)) validTabs.push('overview');
        if (renderFrame.m1s && renderFrame.m1s.length) validTabs.push('m1s');
        if (renderFrame.skills && renderFrame.skills.length) validTabs.push('skills');
        if (renderFrame.specials && renderFrame.specials.length) validTabs.push('specials');
        if (renderDesc.matchups && renderDesc.matchups.length) validTabs.push('matchups');
        if (renderDesc.counterplay && renderDesc.counterplay.length) validTabs.push('counterplay');
        
        // Failsafe map if it's a single move edit
        if (rev.is_delta && rev.target_scope === 'move') {
            const cat = rev.target_key.split('::')[0];
            if (!validTabs.includes(cat)) validTabs.push(cat);
        }
        
        if (validTabs.length === 0) {
            mainArea.innerHTML = '<div class="empty-tab-msg">This revision contains no renderable content (e.g. metadata change or deletion).</div>';
        } else {
            let tabsHtml = '<nav class="character-nav" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1.5rem; border-bottom:2px solid var(--accent-blue); padding-bottom:1rem;">';
            let contentHtml = '';
            validTabs.forEach((t, i) => {
                const label = t === 'm1s' ? 'M1s' : (t.charAt(0).toUpperCase() + t.slice(1));
                tabsHtml += `<button id="nav-${t}" class="btn-manga btn-manga-slanted ${i===0?'active':''}" onclick="window.switchHistoryTab('${t}')"><div class="btn-manga-content"><span class="btn-manga-text">${label}</span></div></button>`;
                contentHtml += `<div id="tab-${t}" class="tab-content ${i===0?'':'hidden'} vessel-content space-y-6"></div>`;
            });
            tabsHtml += '</nav>';
            mainArea.innerHTML = tabsHtml + contentHtml;
            
            // Execute site renderers natively (Awaited to ensure DOM stability)
            if (validTabs.includes('overview') || validTabs.includes('matchups') || validTabs.includes('counterplay')) {
                if (typeof window.loadPageDescriptions === 'function') await window.loadPageDescriptions(rev.page_id, 'character');
            }
            
            for (const cat of ['m1s', 'skills', 'specials']) {
                if (validTabs.includes(cat) && typeof window.loadMoveSection === 'function') {
                    await window.loadMoveSection(rev.page_id, cat, null, 'character');
                }
            }
        }
    }
    
    setTimeout(() => { if (typeof window.refreshTOC === 'function') window.refreshTOC(); }, 300);
};

window.changeHistoryPage = function(direction) {
    const newIndex = window.currentHistoryIndex + direction;
    if (newIndex >= 0 && newIndex < window.historyRevisions.length) {
        window.currentHistoryIndex = newIndex;
        window.renderRevision(newIndex);
    }
};

window.switchHistoryTab = function(tabId) {
    document.querySelectorAll('.character-nav .btn-manga').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#history-content-area .tab-content').forEach(tab => tab.classList.add('hidden'));
    
    const btn = document.getElementById(`nav-${tabId}`);
    const tab = document.getElementById(`tab-${tabId}`);
    
    if (btn) btn.classList.add('active');
    if (tab) tab.classList.remove('hidden');
    
    setTimeout(() => { if (typeof window.refreshTOC === 'function') window.refreshTOC(); }, 50);
};