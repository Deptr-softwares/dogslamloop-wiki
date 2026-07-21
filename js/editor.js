// --- EDITOR SYSTEM ---
window.editorAlert = function(message) {
    const modal = document.getElementById('editor-alert-modal');
    document.getElementById('editor-alert-msg').textContent = message;
    modal.style.display = 'flex';
};

// --- MOBILE VIEW TOGGLE ---
window.toggleMobilePreview = function() {
    const body = document.body;
    body.classList.toggle('mobile-preview-active');
    
    // Update the button text if it exists
    const btn = document.getElementById('mobile-preview-toggle');
    if (btn) {
        btn.textContent = body.classList.contains('mobile-preview-active') ? "HIDE PREVIEW" : "SHOW PREVIEW";
    }
};

// --- DELTA INJECTION HELPER (For Intercept Mode) ---
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    // --- SMART BATCH UNPACKER (Rate Limit Bypass) ---
    if (scope === 'multi' && Array.isArray(payload)) {
        payload.forEach(edit => {
            const res = window.applyDeltaToData(newDesc, newFrame, edit.scope, edit.key, edit.payload);
            newDesc = res.newDesc;
            newFrame = res.newFrame;
        });
        return { newDesc, newFrame };
    }

    // --- Safely intercept full modular replacements ---
    if (scope === 'system_data') {
        return { newDesc: JSON.parse(JSON.stringify(payload)), newFrame }; 
    }

    if (['profile', 'playstyle', 'overview', 'strategy'].includes(scope)) {
        newDesc[scope] = payload;
    }
    else if (scope === 'extra') { 
        if (!newDesc.extras) newDesc.extras = []; 
        if (payload === null) {
            newDesc.extras = newDesc.extras.filter(e => e.title !== key);
        } else {
            const idx = newDesc.extras.findIndex(e => e.title === key);
            if (idx > -1) newDesc.extras[idx] = payload; else newDesc.extras.push(payload);
        }
    }
    else if (scope === 'matchup') { 
        if (!newDesc.matchups) newDesc.matchups = []; 
        if (payload === null) {
            newDesc.matchups = newDesc.matchups.filter(m => m.opponent !== key);
        } else {
            const idx = newDesc.matchups.findIndex(m => m.opponent === key);
            if (idx > -1) newDesc.matchups[idx] = payload; else newDesc.matchups.push(payload);
        }
    }
    else if (scope === 'counterplay') { 
        if (!newDesc.counterplay) newDesc.counterplay = []; 
        if (payload === null) {
            newDesc.counterplay = newDesc.counterplay.filter(c => c.topic !== key);
        } else {
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
                if (idx > -1) newFrame[cat][idx] = payload.frame_data;
                else newFrame[cat].push(payload.frame_data);
            }
            if (!newDesc.moveStrategies) newDesc.moveStrategies = {};
            newDesc.moveStrategies[moveId] = payload.desc_data || [];
        }
    }

    return { newDesc, newFrame };
};

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

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Grab the raw parameters
    const pageIdRaw = urlParams.get('page') || urlParams.get('char'); 
    const pageType = urlParams.get('type') || 'character';

    window.currentEditorPageType = pageType;

    const tabId = urlParams.get('tab') || 'overview';
    const moveId = urlParams.get('move');
    
    const editTicketId = urlParams.get('editTicket'); 
    window.activeEditTicketId = editTicketId;
    window.interceptedTicketData = null;

    window.currentGlobalUsername = "Anonymous";
    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session && session.user) {
            window.currentGlobalUsername = typeof window.getDisplayName === 'function' 
                ? window.getDisplayName(session) 
                : session.user.email.split('@')[0];
        }
    }

    const titleEl = document.getElementById('editor-title');
    const subTitleEl = document.getElementById('editor-subtitle');

    if (!pageIdRaw || !tabId) {
        titleEl.textContent = "Error: Missing Context";
        subTitleEl.textContent = "Please initiate edits directly from a valid wiki page.";
        return;
    }

    const pageId = pageIdRaw.toLowerCase();
    
    if (pageType === 'system' || pageType === 'tierlist') {
        document.getElementById('tab-m1s')?.remove();
        document.getElementById('tab-skills')?.remove();
        document.getElementById('tab-specials')?.remove();
    }

    const pageDisplay = pageIdRaw.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    let exactCharName = pageDisplay;
    if (window.CHARACTER_COLORS) {
        const foundKey = Object.keys(window.CHARACTER_COLORS).find(k => k.toLowerCase() === pageIdRaw.replace(/_/g, ' ').toLowerCase());
        if (foundKey) exactCharName = foundKey;
    }

    const fakeTitle = document.createElement('div');
    fakeTitle.className = 'character-title';
    fakeTitle.style.display = 'none';
    fakeTitle.textContent = exactCharName;
    document.body.appendChild(fakeTitle);

    // --- QOL: CLARIFY CONFIDENCE LEVELS ---
    const confidenceSelect = document.getElementById('qa-confidence');
    if (confidenceSelect) {
        confidenceSelect.innerHTML = `
            <option value="high">HIGH - I am 100% certain. Verified in-game or via files.</option>
            <option value="medium" selected>MEDIUM - Fairly confident, based on strong observation.</option>
            <option value="low">LOW - I am guessing or estimating. Staff please verify.</option>
        `;
    }

    if (typeof window.applyCharacterTheme === 'function') {
        window.applyCharacterTheme();
    }
    
    const targetPreviewTab = document.getElementById(`tab-${tabId}`);
    if (targetPreviewTab) targetPreviewTab.style.display = 'block';

    try {
        // 1. FETCH DATA
        let descData = null;
        let frameData = null;
        
        try {
            let cloudData = null;
            
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient
                    .from('page_data')
                    .select('*')
                    .eq('page_id', pageId)
                    .single();
                    
                if (!error && data) cloudData = data;
                
                // IF INTERCEPTING: Fetch the target ticket from the queue
                if (editTicketId) {
                    const { data: tData, error: tErr } = await window.supabaseClient
                        .from('pending_revisions').select('*').eq('id', editTicketId).single();
                    if (!tErr && tData) window.interceptedTicketData = tData;
                }
            }

            let baseCloudDesc = null;
            let baseCloudFrame = null;

            if (cloudData && cloudData.desc_data) {
                baseCloudDesc = cloudData.desc_data;
                
                // --- AUTO-MIGRATION: Rescue Corrupted Data ---
                if (window.currentEditorPageType === 'system' && !baseCloudDesc.tabs) {
                    let rescued = [];
                    if (baseCloudDesc.overview) rescued.push(...baseCloudDesc.overview);
                    if (baseCloudDesc.strategy) rescued.push(...baseCloudDesc.strategy);
                    baseCloudDesc = {
                        tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Recovered Data', layout: 'full', blocks: rescued }] }]
                    };
                }
                
                baseCloudFrame = cloudData.frame_data || { m1s: [], skills: [], specials: [] };
            } else {
                if (window.currentEditorPageType === 'system') {
                    baseCloudDesc = { tabs: [{ tabId: "overview", tabLabel: "Overview", sections: [{ sectionTitle: "Introduction", layout: "full", blocks: [] }] }] };
                } else if (window.currentEditorPageType === 'tierlist') {
                    baseCloudDesc = { tabs: [{ id: "overall", label: "Overall", tiers: [], changelog: [] }] };
                } else {
                    baseCloudDesc = {
                        profile: { stats: [], image: "" }, playstyle: { likes: [], dislikes: [] },
                        overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {}
                    };
                }
                baseCloudFrame = { m1s: [], skills: [], specials: [] };
            }

            window.originalCloudDescData = JSON.parse(JSON.stringify(baseCloudDesc));
            window.originalCloudFrameData = JSON.parse(JSON.stringify(baseCloudFrame));

            const forceLoadDraft = urlParams.get('loadDraft') === 'true'; 
            const specificDraftKey = urlParams.get('draftKey');
            
            let defaultDraftKey = `wiki_draft_${pageId}_${tabId}`;
            if (moveId) defaultDraftKey += `_${moveId}`;

            const targetKey = specificDraftKey || defaultDraftKey;
            const rawDraft = localStorage.getItem(targetKey);
            let useDraft = false;

            // --- THE HANDSHAKE ROUTING ---
            if (window.interceptedTicketData) {
                if (window.interceptedTicketData.is_delta) {
                    const { newDesc, newFrame } = window.applyDeltaToData(
                        baseCloudDesc, baseCloudFrame, 
                        window.interceptedTicketData.target_scope, 
                        window.interceptedTicketData.target_key, 
                        window.interceptedTicketData.delta_payload
                    );
                    descData = newDesc;
                    frameData = newFrame;
                } else {
                    descData = window.interceptedTicketData.desc_data || baseCloudDesc;
                    frameData = window.interceptedTicketData.frame_data || baseCloudFrame;
                }
                useDraft = true; // Bypasses local draft logic
                console.log(`[Editor] Intercept Mode Active: Loaded Ticket ${editTicketId}`);
            } 
            else if (rawDraft) {
                try {
                    const parsedDraft = JSON.parse(rawDraft);
                    if (forceLoadDraft) {
                        useDraft = true;
                    } else {
                        const scopeName = `${tabId.toUpperCase()}${moveId ? ' / ' + moveId.toUpperCase() : ''}`;
                        const restore = await window.customConfirm(`An unsaved local draft was found for this specific section (${scopeName}).\n\nDo you want to restore your local progress, or load the live cloud version?`, "RESTORE DRAFT", false);
                        if (restore) useDraft = true;
                    }

                    if (useDraft) {
                        descData = parsedDraft.desc_data || baseCloudDesc;
                        frameData = parsedDraft.frame_data || baseCloudFrame;
                        window.currentDraftKey = targetKey; 
                        console.log(`[Editor] Restored local draft: ${targetKey}`);
                    }
                } catch (e) {
                    console.warn("Corrupt local draft found. Discarding.");
                    localStorage.removeItem(targetKey);
                }
            }

            if (!useDraft) {
                console.log(`[Editor] Loaded ${pageId} strictly from Cloud.`);
                descData = baseCloudDesc;
                frameData = baseCloudFrame;
            }
            
            window.isDiffModeActive = false;
            window.cachedMasterFrameData = window.cachedMasterFrameData || {};
            window.cachedMasterFrameData[pageId] = frameData;
            
        } catch (e) {
            console.error("Failed to initialize editor data:", e);
            window.editorAlert("Critical Error loading page data. Check console.");
            return;
        }

        // --- INTERCEPT UI OVERRIDES ---
        if (window.interceptedTicketData) {
            titleEl.innerHTML = `<span style="color: #a855f7;">Intercepting Submission</span>`;
            subTitleEl.textContent = `Reviewing and editing submission by ${window.interceptedTicketData.author_name}`;
        } else if (moveId) {
            titleEl.textContent = `Editing Move`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId} / ${moveId}`;
        } else {
            titleEl.textContent = `Editing Section`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId}`;
        }

        // 2. BUILD THE PREVIEW DOM 
        if (['m1s', 'skills', 'specials'].includes(tabId) && typeof window.loadMoveSection === 'function') {
            let activeMoveId = moveId; 
            if (!activeMoveId && frameData && frameData[tabId] && frameData[tabId].length > 0) {
                activeMoveId = frameData[tabId][0].id;
            }
            try { await window.loadMoveSection(pageId, tabId, activeMoveId, pageType); } catch(e) { console.warn("Move section build skipped:", e); }
        }
        
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(pageId, pageType);
        }

        // 3. ROUTE TO THE CORRECT EDITOR
        window.currentEditorTabId = tabId;
        window.currentEditorCharId = pageId; 
        window.currentEditorDescData = descData;
        window.currentEditorFrameData = frameData;

        if (moveId) {
            const moveStats = frameData ? frameData[tabId]?.find(m => m.id === moveId) : null;
            const moveStrats = descData ? descData.moveStrategies?.[moveId] : null;
            initPerMoveEditor(moveId, moveStats, moveStrats);
            setTimeout(() => {
                const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
                if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        } else {
            initFullTabEditor(pageId, tabId, descData, frameData);
        }

    } catch (error) {
        console.error("Editor failed to initialize context:", error);
        titleEl.textContent = "System Error";
        subTitleEl.textContent = "Check browser console for detailed logs.";
    }

    // --- QA MODAL ENGINE (SHORT / LONG / TECHNICAL) ---
    window.openQAModal = function(isIntercept) {
        return new Promise((resolve) => {
            let overlay = document.getElementById('dynamic-qa-modal-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'dynamic-qa-modal-overlay';
                overlay.className = 'editor-modal-overlay';
                overlay.style.zIndex = '10005';
                document.body.appendChild(overlay);
            }

            let currentForm = 'short'; 
            
            const renderForm = () => {
                let formHtml = '';
                let modalWidth = '400px';

                const tabsHtml = `
                    <div style="display:flex; gap:0.5rem; margin-bottom: 1rem;">
                        <button class="btn-sys ${currentForm === 'short' ? 'btn-sys-blue' : 'btn-sys-regular'}" style="flex:1; font-size:0.7rem;" id="qa-tab-short">Short</button>
                        <button class="btn-sys ${currentForm === 'long' ? 'btn-sys-blue' : 'btn-sys-regular'}" style="flex:1; font-size:0.7rem;" id="qa-tab-long">Long</button>
                        <button class="btn-sys ${currentForm === 'technical' ? 'btn-sys-blue' : 'btn-sys-regular'}" style="flex:1; font-size:0.7rem;" id="qa-tab-technical">Technical</button>
                    </div>
                `;

                if (currentForm === 'short') {
                    formHtml = `
                        <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">CHANGELOG SUMMARY (Max 50 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea" style="min-height: 80px;" placeholder="Briefly describe what you changed..."></textarea>
                        <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; margin-top: 0.75rem;">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'long') {
                    modalWidth = '600px';
                    formHtml = `
                        <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">DETAILED CHANGELOG (Max 500 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea" style="min-height: 150px;" placeholder="Provide a detailed explanation of your edits, reasoning, and context..."></textarea>
                        <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; margin-top: 0.75rem;">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'technical') {
                    modalWidth = '600px';
                    formHtml = `
                        <div style="display:flex; gap: 1rem; margin-bottom: 0.75rem;">
                            <div style="flex:1;">
                                <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">CONFIDENCE LEVEL</label>
                                <select id="qa-confidence" class="editor-select">
                                    <option value="N/A">N/A</option>
                                    <option value="High">High - 100% Certain (Tested in-game/files)</option>
                                    <option value="Medium">Medium - Fairly Confident</option>
                                    <option value="Low">Low - Guessing / Needs verification</option>
                                </select>
                            </div>
                            <div style="flex:1;">
                                <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">SOURCE / EVIDENCE (Optional)</label>
                                <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                            </div>
                        </div>
                        <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">TECHNICAL CHANGELOG</label>
                        <textarea id="qa-changelog" class="editor-textarea" style="min-height: 150px;" placeholder="Detail frame data changes, math, hitboxes, or engine mechanics..."></textarea>
                    `;
                }

                overlay.innerHTML = `
                    <div class="editor-modal-box auth-modal-box" style="border-top-color: var(--accent-blue); max-width: ${modalWidth}; width: 100%; transition: max-width 0.3s ease;">
                        <div class="auth-header">
                            <h3 style="color: var(--accent-blue); font-family: 'CC-Wild-Words', sans-serif;">QUALITY ASSURANCE</h3>
                        </div>
                        <div class="auth-body" style="padding: 1.5rem;">
                            ${tabsHtml}
                            <div id="qa-form-container" style="display: flex; flex-direction: column; text-align: left;">
                                ${formHtml}
                            </div>
                        </div>
                        <div class="editor-modal-actions" style="justify-content: flex-end; border-top: 1px dashed #333; padding-top: 1rem; margin-top: 0;">
                            <button id="btn-qa-cancel" class="system-page-btn">CANCEL</button>
                            <button id="btn-qa-confirm" class="submit-btn" style="color: var(--accent-blue); border-color: var(--accent-blue);">${isIntercept ? 'UPDATE SUBMISSION' : 'CONFIRM & UPLOAD'}</button>
                        </div>
                    </div>
                `;

                overlay.querySelector('#qa-tab-short').onclick = () => { currentForm = 'short'; renderForm(); };
                overlay.querySelector('#qa-tab-long').onclick = () => { currentForm = 'long'; renderForm(); };
                overlay.querySelector('#qa-tab-technical').onclick = () => { currentForm = 'technical'; renderForm(); };

                overlay.querySelector('#btn-qa-cancel').onclick = () => {
                    overlay.style.display = 'none';
                    resolve(null);
                };

                overlay.querySelector('#btn-qa-confirm').onclick = () => {
                    const changelog = overlay.querySelector('#qa-changelog').value.trim();
                    const confidence = overlay.querySelector('#qa-confidence') ? overlay.querySelector('#qa-confidence').value : 'N/A';
                    const evidence = overlay.querySelector('#qa-evidence') ? overlay.querySelector('#qa-evidence').value.trim() : '';
                    
                    const words = changelog.split(/\s+/).filter(w => w.length > 0).length;
                    if (currentForm === 'short' && words > 50) {
                        window.editorAlert(`Short form QA is limited to 50 words. You are currently at ${words} words. Please shorten it or use the Long form.`);
                        return;
                    }
                    if ((currentForm === 'long' || currentForm === 'technical') && words > 500) {
                        window.editorAlert(`This form is limited to 500 words. You are currently at ${words} words.`);
                        return;
                    }

                    if (!changelog) {
                        window.editorAlert("Please provide a changelog summary of your edits.");
                        return;
                    }

                    overlay.style.display = 'none';
                    resolve({ changelog, confidence, evidence });
                };
            };

            renderForm();
            overlay.style.display = 'flex';
        });
    };

    // --- SUBMIT PAYLOAD & UPLOAD PIPELINE ---
    const submitBtn = document.getElementById('submit-payload-btn');
    if (submitBtn) {
        if (window.activeEditTicketId) {
            submitBtn.textContent = "UPDATE SUBMISSION";
            submitBtn.classList.remove('btn-sys-blue');
            submitBtn.classList.add('btn-sys-purple');
        }

        submitBtn.addEventListener('click', async () => {
            if (!window.supabaseClient) { window.editorAlert("Database connection is offline!"); return; }
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) { window.openAuthModal(); return; }

            // --- EXCLUSIVE PAGE GUARD (Trusted Editor & Admin Only) ---
            const exclusivePages = ['template', 'tierlist', 'writing_guide', 'character_dashboard', 'side_dashboard'];
            
            if (exclusivePages.includes(pageId.toLowerCase())) {
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle(); 
                const userRole = (roleData?.role || 'guest').trim().toLowerCase(); 
                
                if (userRole !== 'admin' && userRole !== 'trusted_editor') {
                    window.editorAlert("READ ONLY: This is an exclusive systemic page. You require the 'Trusted Editor' or 'Admin' role to submit revisions here.");
                    return; 
                }
            }

            const COOLDOWN_MINUTES = 3; 
            const lastSubmitTime = localStorage.getItem('wiki_last_submit_time');
            if (lastSubmitTime && !window.activeEditTicketId) { 
                const timeSinceLastSubmit = Date.now() - parseInt(lastSubmitTime, 10);
                const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
                if (timeSinceLastSubmit < cooldownMs) {
                    const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSubmit) / 1000);
                    window.editorAlert(`Anti-Spam: Please wait ${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s before submitting another revision.`);
                    return;
                }
            }

            if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

            submitBtn.textContent = "CHECKING...";
            try {
                const { data: liveData, error: liveError } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
                if (!liveError && liveData && !window.activeEditTicketId) {
                    let hasCollision = false;
                    const tabId = window.currentEditorTabId;
                    const isDiff = (objA, objB) => JSON.stringify(objA || null) !== JSON.stringify(objB || null);

                    if (pageType === 'system' || pageType === 'tierlist') {
                        hasCollision = isDiff(liveData.desc_data, window.originalCloudDescData);
                    }

                    if (['m1s', 'skills', 'specials'].includes(tabId)) {
                        let moveId = new URLSearchParams(window.location.search).get('move');
                        if (!moveId) {
                            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                            if (activeBtn) moveId = activeBtn.id.replace('move-nav-', '');
                        }
                        if (moveId) {
                            hasCollision = isDiff(liveData.desc_data?.moveStrategies?.[moveId], window.originalCloudDescData?.moveStrategies?.[moveId]) || 
                                           isDiff((liveData.frame_data?.[tabId] || []).find(m => m.id === moveId), (window.originalCloudFrameData?.[tabId] || []).find(m => m.id === moveId));
                        }
                    } else if (tabId === 'overview') {
                        const sec = window.currentOverviewSection || 'overview';
                        if (sec === 'profile') hasCollision = isDiff(liveData.desc_data?.profile, window.originalCloudDescData?.profile);
                        else if (sec === 'playstyle') hasCollision = isDiff(liveData.desc_data?.playstyle, window.originalCloudDescData?.playstyle);
                        else if (sec === 'overview') hasCollision = isDiff(liveData.desc_data?.overview, window.originalCloudDescData?.overview);
                        else if (sec === 'strategy') hasCollision = isDiff(liveData.desc_data?.strategy, window.originalCloudDescData?.strategy);
                        else if (sec.startsWith('extra-')) {
                            const idx = parseInt(sec.split('-')[1]);
                            hasCollision = isDiff(liveData.desc_data?.extras?.[idx], window.originalCloudDescData?.extras?.[idx]);
                        }
                    } else if (tabId === 'matchups' && window.currentMatchupIndex !== undefined) {
                        hasCollision = isDiff(liveData.desc_data?.matchups?.[window.currentMatchupIndex], window.originalCloudDescData?.matchups?.[window.currentMatchupIndex]);
                    } else if (tabId === 'counterplay' && window.currentCounterplayIndex !== undefined) {
                        hasCollision = isDiff(liveData.desc_data?.counterplay?.[window.currentCounterplayIndex], window.originalCloudDescData?.counterplay?.[window.currentCounterplayIndex]);
                    }

                    if (hasCollision) {
                        const proceed = await window.customConfirm("WARNING: Another contributor's edits to this specific section were just approved while you were typing!\n\nIf you submit now, your changes will be queued and may overwrite theirs if approved by staff. Do you want to proceed and let staff resolve the conflict?", "PROCEED ANYWAY", true);
                        if (!proceed) {
                            submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                            return; 
                        }
                    }
                }
            } catch (e) { console.warn("Collision check failed, proceeding safely.", e); }

            submitBtn.textContent = "WAITING ON QA...";
            
            // 🚨 TRIGGER THE DYNAMIC QA MODAL 🚨
            const qaResult = await window.openQAModal(!!window.activeEditTicketId);
            
            if (!qaResult) {
                submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                return; // User cancelled
            }

            submitBtn.textContent = "UPLOADING...";
            submitBtn.disabled = true;

            const tabId = window.currentEditorTabId;
            let payloadsToInsert = [];
            
            const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);

            // A helper to quickly spawn standardized payload objects
            const buildPayload = (targetScope, targetKey, deltaPayload) => {
                return {
                    page_id: pageId,
                    page_type: pageType,
                    desc_data: window.currentEditorDescData, // Legacy fallback included
                    frame_data: pageType === 'system' ? null : window.currentEditorFrameData,
                    is_delta: true,
                    target_scope: targetScope,
                    target_key: targetKey,
                    delta_payload: deltaPayload,
                    author_id: session.user.id,
                    author_name: window.currentGlobalUsername || "Contributor",
                    qa_metadata: { changelog: qaResult.changelog, confidence: qaResult.confidence, evidence: qaResult.evidence }
                };
            };

            // 1. IF INTERCEPTING: Strictly update the single intercepted ticket
            if (window.interceptedTicketData) {
                const scope = window.interceptedTicketData.target_scope;
                const key = window.interceptedTicketData.target_key;
                let dPayload = {};
                
                if (scope === 'move') {
                    const [cat, mId] = key.split('::');
                    dPayload = {
                        frame_data: window.currentEditorFrameData[cat].find(m => m.id === mId),
                        desc_data: window.currentEditorDescData.moveStrategies[mId] || []
                    };
                } else if (scope === 'extra' || scope === 'matchup' || scope === 'counterplay') {
                    const arrMap = { 'extra': 'extras', 'matchup': 'matchups', 'counterplay': 'counterplay' };
                    dPayload = window.currentEditorDescData[arrMap[scope]][parseInt(key)];
                } else {
                    dPayload = window.currentEditorDescData[scope];
                }

                payloadsToInsert.push(buildPayload(scope, key, dPayload));
            } 
            // 2. NORMAL SUBMISSION: Multi-Payload Diff Scanner
            else {
                // --- System Payload ---
                if (pageType === 'system' || pageType === 'tierlist') {
                    await window.triggerManualSync(); 
                    // Only push if something actually changed!
                    if (isDiff(window.currentEditorDescData, window.originalCloudDescData)) {
                        payloadsToInsert.push(buildPayload('system_data', 'full', window.currentEditorDescData));
                    }
                }
                // --- CHARACTER PAYLOAD ENGINE ---
                else if (['m1s', 'skills', 'specials'].includes(tabId)) {
                    const localMoves = window.currentEditorFrameData[tabId] || [];
                    const cloudMoves = window.originalCloudFrameData[tabId] || [];
                    
                    localMoves.forEach(m => {
                        const oldFrame = cloudMoves.find(old => old.id === m.id);
                        const oldDesc = window.originalCloudDescData.moveStrategies?.[m.id];
                        const newDesc = window.currentEditorDescData.moveStrategies?.[m.id];

                        if (isDiff(m, oldFrame) || isDiff(newDesc, oldDesc)) {
                            payloadsToInsert.push(buildPayload('move', `${tabId}::${m.id}`, {
                                frame_data: m,
                                desc_data: newDesc || []
                            }));
                        }
                    });
                    
                    cloudMoves.forEach(oldM => {
                        if (!localMoves.find(m => m.id === oldM.id)) {
                            payloadsToInsert.push(buildPayload('move', `${tabId}::${oldM.id}`, null));
                        }
                    });
                } else if (tabId === 'overview') {
                    ['profile', 'playstyle', 'overview', 'strategy'].forEach(sec => {
                        if (isDiff(window.currentEditorDescData[sec], window.originalCloudDescData[sec])) {
                            payloadsToInsert.push(buildPayload(sec, 'full', window.currentEditorDescData[sec]));
                        }
                    });
                    
                    const localExtras = window.currentEditorDescData.extras || [];
                    const cloudExtras = window.originalCloudDescData.extras || [];
                    
                    localExtras.forEach(ext => {
                        const oldExt = cloudExtras.find(o => o.title === ext.title);
                        if (isDiff(ext, oldExt)) payloadsToInsert.push(buildPayload('extra', ext.title, ext));
                    });
                    
                    cloudExtras.forEach(oldExt => {
                        if (!localExtras.find(e => e.title === oldExt.title)) {
                            payloadsToInsert.push(buildPayload('extra', oldExt.title, null));
                        }
                    });
                } else if (tabId === 'matchups') {
                    const localMus = window.currentEditorDescData.matchups || [];
                    const cloudMus = window.originalCloudDescData.matchups || [];
                    
                    localMus.forEach(mu => {
                        const oldMu = cloudMus.find(o => o.opponent === mu.opponent);
                        if (isDiff(mu, oldMu)) payloadsToInsert.push(buildPayload('matchup', mu.opponent, mu));
                    });
                    
                    cloudMus.forEach(oldMu => {
                        if (!localMus.find(m => m.opponent === oldMu.opponent)) {
                            payloadsToInsert.push(buildPayload('matchup', oldMu.opponent, null));
                        }
                    });
                } else if (tabId === 'counterplay') {
                    const localCps = window.currentEditorDescData.counterplay || [];
                    const cloudCps = window.originalCloudDescData.counterplay || [];
                    
                    localCps.forEach(cp => {
                        const oldCp = cloudCps.find(o => o.topic === cp.topic);
                        if (isDiff(cp, oldCp)) payloadsToInsert.push(buildPayload('counterplay', cp.topic, cp));
                    });
                    
                    cloudCps.forEach(oldCp => {
                        if (!localCps.find(c => c.topic === oldCp.topic)) {
                            payloadsToInsert.push(buildPayload('counterplay', oldCp.topic, null));
                        }
                    });
                }

                if (payloadsToInsert.length === 0 && !window.interceptedTicketData) {
                    submitBtn.textContent = "Submit";
                    submitBtn.disabled = false;
                    window.editorAlert("No changes detected against the live database! Nothing to submit.");
                    return;
                }
            }

            // ==========================================
            // SMART BATCHING ENGINE (Rate Limit Bypass)
            // ==========================================
            let finalPayloads = [];
            if (payloadsToInsert.length > 1 && !window.interceptedTicketData) {
                // Combine all independent deltas into a single master ticket!
                const batchedDeltas = payloadsToInsert.map(p => ({
                    scope: p.target_scope,
                    key: p.target_key,
                    payload: p.delta_payload
                }));
                
                const masterTicket = buildPayload('multi', 'batch', batchedDeltas);
                finalPayloads = [masterTicket];
            } else {
                finalPayloads = payloadsToInsert;
            }

            let dbError = null;

            // --- DATABASE ROUTING ---
            if (window.interceptedTicketData) {
                const payload = finalPayloads[0];
                payload.author_id = window.interceptedTicketData.author_id;
                payload.author_name = window.interceptedTicketData.author_name;
                payload.status = window.interceptedTicketData.status; 
                
                const oldQa = window.interceptedTicketData.qa_metadata || {};
                payload.qa_metadata = oldQa;
                payload.qa_metadata.changelog = `${qaResult.changelog}\n\n(Staff Note: Minor edits applied by ${window.currentGlobalUsername || 'Staff'} prior to approval)\n\nOriginal Contributor Log:\n${oldQa.changelog || 'None'}`;
                
                const { error } = await window.supabaseClient.from('pending_revisions').update(payload).eq('id', window.activeEditTicketId);
                dbError = error;
            } else {
                console.log(`Pushing ${finalPayloads.length} Master Ticket(s) to Revision Queue...`);
                const { error } = await window.supabaseClient.from('pending_revisions').insert(finalPayloads);
                dbError = error;
            }

            submitBtn.disabled = false;

            if (dbError) {
                console.error("Supabase Error:", dbError);
                window.editorAlert("Failed to save to database: " + dbError.message);
                submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
            } else {
                if (window.currentDraftKey) {
                    localStorage.removeItem(window.currentDraftKey);
                } else {
                    const sweepTab = window.currentEditorTabId || 'overview';
                    let sweepMove = new URLSearchParams(window.location.search).get('move') || '';
                    if (!sweepMove) {
                        const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                        if (activeBtn && activeBtn.id.startsWith('move-nav-')) sweepMove = activeBtn.id.replace('move-nav-', '');
                    }
                    localStorage.removeItem(`wiki_draft_${pageId}_${sweepTab}${sweepMove ? '_' + sweepMove : ''}`);
                }

                const fallbackText = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                submitBtn.textContent = window.activeEditTicketId ? "UPDATED!" : "SUBMITTED!";
                submitBtn.style.backgroundColor = "#22c55e"; 
                submitBtn.style.color = "#000";
                
                localStorage.setItem('wiki_last_submit_time', Date.now().toString());
                
                setTimeout(() => {
                    submitBtn.textContent = fallbackText;
                    submitBtn.style.backgroundColor = "";
                    submitBtn.style.color = "";
                    
                    if (window.activeEditTicketId) {
                        window.editorAlert("Ticket successfully updated! You can now close this tab and return to the Admin Panel.");
                    }
                }, 3000);
            }
        });
    }
});

// --- DYNAMIC PATH RESOLUTION ---
async function fetchCharacterData(charId) {
    const root = window.getRootPath();
    const path = `${root}characters/${charId}/`;
    
    let descData = null;
    let frameData = null;
    
    if (typeof window.fetchJson === 'function') {
        try { descData = await window.fetchJson(`${path}${charId}_descriptions.json`); } catch(e) {}
        try { frameData = await window.fetchJson(`${path}${charId}_framedata.json`); } catch(e) {}
    }
    
    return { descData, frameData };
}

// --- CUSTOM MODAL ENGINE ---
window.customConfirm = function(message, confirmText = "DELETE", isDanger = true) {
    return new Promise((resolve) => {
        const modal = document.getElementById('editor-custom-modal');
        const textEl = document.getElementById('editor-modal-text');
        const btnCancel = document.getElementById('editor-modal-cancel');
        const btnConfirm = document.getElementById('editor-modal-confirm');

        textEl.textContent = message;
        btnConfirm.textContent = confirmText;

        if (isDanger) {
            btnConfirm.className = "submit-btn btn-danger-fill";
            btnConfirm.style = "";
        } else {
            btnConfirm.className = "submit-btn";
            btnConfirm.style.color = "var(--accent-blue)";
            btnConfirm.style.borderColor = "var(--accent-blue)";
            btnConfirm.style.backgroundColor = "transparent";
        }

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnCancel.removeEventListener('click', onCancel);
            btnConfirm.removeEventListener('click', onConfirm);
        };

        const onCancel = () => { cleanup(); resolve(false); };
        const onConfirm = () => { cleanup(); resolve(true); };

        btnCancel.addEventListener('click', onCancel);
        btnConfirm.addEventListener('click', onConfirm);
    });
};

// --- CUSTOM TAB MANAGEMENT ---
window.addExtraTab = async function() {
    await window.triggerManualSync();
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: "New Tab", content: [] });
    
    if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
    initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    loadOverviewSectionIntoEditor(`extra-${window.currentEditorDescData.extras.length - 1}`);
};

window.removeExtraTab = async function(idx) {
    if (await window.customConfirm("Delete this custom tab and all its contents?")) {
        await window.triggerManualSync();
        window.currentEditorDescData.extras.splice(idx, 1);
        if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
        initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
        loadOverviewSectionIntoEditor('overview');
    }
};

window.updateExtraTabTitle = function(idx, newTitle) {
    window.currentEditorDescData.extras[idx].title = newTitle;
    const btn = document.getElementById(`overview-nav-extra-${idx}`);
    if (btn) btn.firstChild.textContent = newTitle; 
    renderFullOverviewPreview();
};

function initFullTabEditor(charId, tabId, descData, frameData) {
    const builder = document.getElementById('interactive-builder');

    window.currentEditorFrameData = frameData;
    window.currentEditorDescData = descData || {};
    window.currentEditorTabId = tabId;
    window.currentEditorCharId = charId;

    // --- Reroute to the new System Builder UI ---
    if (window.currentEditorPageType === 'system') {
        if (window.currentSystemTabIdx === undefined) {
            // Read the URL parameter so "EDIT TAB" opens the exact custom tab you clicked!
            const foundIdx = (window.currentEditorDescData.tabs || []).findIndex(t => t.tabId === tabId);
            window.currentSystemTabIdx = foundIdx > -1 ? foundIdx : 0;
        }
        if (window.currentSystemSecIdx === undefined) window.currentSystemSecIdx = 0;
        window.renderSystemEditor(builder);
        return;
    } else if (window.currentEditorPageType === 'tierlist') {
        // 1. Lock the builder strictly to the sidebar!
        if (typeof window.initTierListEditor === 'function') {
            window.initTierListEditor(builder.id, window.currentEditorDescData);
        }
        
        // 2. Kill the Live Preview pane and replace it with a static notice
        const previewPane = document.querySelector('.live-preview-pane .main-content-area') || document.querySelector('.live-preview-pane');
        if (previewPane) {
            previewPane.innerHTML = `
                <div style="padding: 2rem; color: #888; text-align: center; border: 1px dashed #333; margin-top: 4rem; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
                    <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">🚫</div>
                    <h2 style="color: var(--accent-blue); font-family: 'CC-Wild-Words', sans-serif; letter-spacing: 1px;">LIVE PREVIEW DISABLED</h2>
                    <p style="font-family: var(--text-mono); font-size: 0.85rem; max-width: 400px; line-height: 1.5;">The Tier List editor is used on the side. Live Preview is disabled because this shit is so fucking buggy.<br>I want to RAAAAAAAAAAAAAAHHHHHHHH</p>
                </div>
            `;
        }
        return;
    }

    const frameTabs = ['m1s', 'skills', 'specials'];

    window.currentEditorFrameData = frameData;
    window.currentEditorDescData = descData || {};
    window.currentEditorTabId = tabId;
    window.currentEditorCharId = charId;

    if (frameTabs.includes(tabId)) {
        const moves = frameData ? (frameData[tabId] || []) : [];
        
        let navHTML = `<div class="daw-variant-tabs" style="margin-bottom: 0.5rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center;">`;
        if (moves.length === 0) {
            navHTML += `<span style="color:var(--text-muted); font-size: 0.75rem; padding: 0.5rem;">No moves mapped in this category yet.</span>`;
        } else {
            moves.forEach((m, idx) => {
                navHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
                navHTML += `<button class="daw-tab-btn ${idx === 0 ? 'active' : ''}" id="move-nav-${m.id}" onclick="loadMoveIntoEditor('${m.id}')" style="padding-right: 1.5rem;">${m.name || m.id}</button>`;
                navHTML += `<button onclick="window.removeMove('${m.id}')" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Remove Move">✖</button>`;
                navHTML += `</div>`;
            });
        }

        navHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem;" onclick="window.addMove()">+ ADD MOVE</button>`;
        navHTML += `</div>`;
        
        builder.innerHTML = `
            ${navHTML}
            <div id="move-editor-container"></div>
        `;
        
        if (moves.length > 0) {
            loadMoveIntoEditor(moves[0].id);
        } else {
            document.getElementById('move-editor-container').innerHTML = `<div class="empty-tab-msg" style="padding: 2rem; border: 1px dashed #333; background: transparent; text-align: center;">Click + ADD MOVE to begin mapping data.</div>`;
        }

    } else if (tabId === 'overview') {
        if (!window.currentEditorDescData.overview) window.currentEditorDescData.overview = [];
        if (!window.currentEditorDescData.strategy) window.currentEditorDescData.strategy = [];
        if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];

        let navHTML = `<div class="daw-variant-tabs" style="margin-bottom: 0.5rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center;">`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-profile" onclick="loadOverviewSectionIntoEditor('profile')">Profile Card</button>`;
        navHTML += `<button class="daw-tab-btn active" id="overview-nav-overview" onclick="loadOverviewSectionIntoEditor('overview')">Character Overview</button>`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-playstyle" onclick="loadOverviewSectionIntoEditor('playstyle')">Playstyle</button>`;
        navHTML += `<button class="daw-tab-btn" id="overview-nav-strategy" onclick="loadOverviewSectionIntoEditor('strategy')">General Strategy</button>`;
        
        window.currentEditorDescData.extras.forEach((ext, idx) => {
            navHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
            navHTML += `<button class="daw-tab-btn" id="overview-nav-extra-${idx}" onclick="loadOverviewSectionIntoEditor('extra-${idx}')" style="padding-right: 1.5rem;">${ext.title}</button>`;
            navHTML += `<button onclick="removeExtraTab(${idx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Remove Tab">✖</button>`;
            navHTML += `</div>`;
        });

        navHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem;" onclick="addExtraTab()">+ ADD TAB</button>`;
        navHTML += `</div>`;
        
        builder.innerHTML = `
            ${navHTML}
            <div id="overview-editor-container"></div>
        `;
        
        loadOverviewSectionIntoEditor('overview');

    } else if (tabId === 'matchups') {
        if (!window.currentEditorDescData.matchups) window.currentEditorDescData.matchups = [];
        
        let navHTML = `<div class="daw-variant-tabs" style="margin-bottom: 0.5rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center; flex-shrink: 0;">`;
        if (window.currentEditorDescData.matchups.length === 0) {
             navHTML += `<span style="color:var(--text-muted); font-size: 0.75rem; padding: 0.5rem;">No matchups defined yet.</span>`;
        } else {
            window.currentEditorDescData.matchups.forEach((mu, idx) => {
                let muName = mu.opponent || `Matchup ${idx + 1}`;
                navHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
                navHTML += `<button class="daw-tab-btn" id="matchup-nav-${idx}" onclick="window.loadMatchupIntoEditor(${idx})" style="padding-right: 1.5rem;">vs. ${muName}</button>`;
                navHTML += `<button onclick="window.removeMatchup(${idx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Remove Matchup">✖</button>`;
                navHTML += `</div>`;
            });
        }

        navHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem;" onclick="window.addMatchup()">+ ADD MATCHUP</button>`;
        navHTML += `</div>`;
        
        builder.innerHTML = `
            ${navHTML}
            <div id="matchup-editor-container"></div>
        `;
        
        if (window.currentEditorDescData.matchups.length > 0) {
            window.loadMatchupIntoEditor(0);
        } else {
            document.getElementById('matchup-editor-container').innerHTML = `<div class="empty-tab-msg">Create a matchup to begin editing.</div>`;
            if (typeof renderMatchupsPreview === 'function') renderMatchupsPreview();
        }

    } else if (tabId === 'counterplay') {
        if (!window.currentEditorDescData.counterplay) window.currentEditorDescData.counterplay = [];
        
        let navHTML = `<div class="daw-variant-tabs" style="margin-bottom: 0.5rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center; flex-shrink: 0;">`;
        if (window.currentEditorDescData.counterplay.length === 0) {
             navHTML += `<span style="color:var(--text-muted); font-size: 0.75rem; padding: 0.5rem;">No counterplay topics defined yet.</span>`;
        } else {
            window.currentEditorDescData.counterplay.forEach((cp, idx) => {
                let cpName = cp.topic || `Topic ${idx + 1}`;
                navHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
                navHTML += `<button class="daw-tab-btn" id="counterplay-nav-${idx}" onclick="window.loadCounterplayIntoEditor(${idx})" style="padding-right: 1.5rem;">${cpName}</button>`;
                navHTML += `<button onclick="window.removeCounterplayTopic(${idx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Remove Topic">✖</button>`;
                navHTML += `</div>`;
            });
        }

        navHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem;" onclick="window.addCounterplayTopic()">+ ADD TOPIC</button>`;
        navHTML += `</div>`;
        
        builder.innerHTML = `
            ${navHTML}
            <div id="counterplay-editor-container"></div>
        `;
        
        if (window.currentEditorDescData.counterplay.length > 0) {
            window.loadCounterplayIntoEditor(0);
        } else {
            document.getElementById('counterplay-editor-container').innerHTML = `<div class="empty-tab-msg">Create a topic to begin editing.</div>`;
            if (typeof renderCounterplayPreview === 'function') renderCounterplayPreview();
        }

    } else {
        builder.innerHTML = `
            <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; margin-top: 0.5rem; display: flex; align-items: center;">
                <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">EDITING: ${tabId}</span>
            </div>
            <div id="strategy-block-target"></div>
        `;
        let contentData = descData ? (descData[tabId] || []) : [];
        initStrategyBlockBuilder('strategy-block-target', contentData);
        updateLivePreview(); 
    }
}

window.addMove = async function() {
    // 1. Force the user to define the exact ID
    const newMoveMeta = await window.promptForMoveId();
    if (!newMoveMeta) return; // User cancelled

    await window.triggerManualSync();
    const tabId = window.currentEditorTabId;
    
    // 2. Ensure arrays exist
    if (!window.currentEditorFrameData) window.currentEditorFrameData = {};
    if (!window.currentEditorFrameData[tabId]) window.currentEditorFrameData[tabId] = [];
    if (!window.currentEditorDescData.moveStrategies) window.currentEditorDescData.moveStrategies = {};
    
    // 3. Inject a fresh, blank move template using their chosen ID
    window.currentEditorFrameData[tabId].push({
        id: newMoveMeta.id,
        name: newMoveMeta.name,
        input: "M1",
        type: "Attack",
        damageType: "Melee",
        media: { src: "", alt: "" },
        stats: [],
        variants: {},
        totalScale: 100,
        bars: [{ type: "single", headerInfo: "Track 1", phases: [] }]
    });
    
    window.currentEditorDescData.moveStrategies[newMoveMeta.id] = [];
    
    // 4. Reload the UI and instantly switch to the new move
    initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMoveIntoEditor(newMoveMeta.id);
};

window.removeMove = async function(moveId) {
    if (await window.customConfirm("Delete this entire move (stats, frame data, and strategy)?")) {
        await window.triggerManualSync();
        const tabId = window.currentEditorTabId;
        const arr = window.currentEditorFrameData[tabId];
        
        // 1. Delete from Frame Data
        const idx = arr.findIndex(m => m.id === moveId);
        if (idx > -1) arr.splice(idx, 1);
        
        // 2. Delete from Description Data
        if (window.currentEditorDescData.moveStrategies && window.currentEditorDescData.moveStrategies[moveId]) {
            delete window.currentEditorDescData.moveStrategies[moveId];
        }
        
        // 3. CRITICAL: Immediately purge the deleted move from the Live Preview DOM
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
        if (previewCard) previewCard.remove();
        
        // 4. Reload the UI
        initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    }
};

// --- MOVE ID GATEKEEPER ---
window.promptForMoveId = function() {
    return new Promise((resolve) => {
        let overlay = document.getElementById('move-id-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'move-id-modal';
            overlay.className = 'editor-modal-overlay';
            overlay.style.zIndex = '10006'; // Forces it over everything
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div class="editor-modal-box auth-modal-box" style="border-top-color: #22c55e; max-width: 400px; width: 100%;">
                <div class="auth-header">
                    <h3 style="color: #22c55e; font-family: 'CC-Wild-Words', sans-serif;">ADD NEW MOVE</h3>
                </div>
                <div class="auth-body" style="padding: 1.5rem;">
                    <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left;">
                        <div>
                            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">MOVE DISPLAY NAME</label>
                            <input type="text" id="new-move-name" class="editor-input" placeholder="e.g. Cursed Strike" style="margin-top: 0.25rem;">
                        </div>
                        <div>
                            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">TECHNICAL ID (No spaces, lowercase)</label>
                            <input type="text" id="new-move-id" class="editor-input" placeholder="e.g. cursed_strike" style="margin-top: 0.25rem;">
                        </div>
                    </div>
                </div>
                <div class="editor-modal-actions" style="justify-content: flex-end; border-top: 1px dashed #333; padding-top: 1rem; margin-top: 0;">
                    <button id="btn-move-cancel" class="system-page-btn">CANCEL</button>
                    <button id="btn-move-confirm" class="submit-btn" style="color: #22c55e; border-color: #22c55e;">INITIALIZE</button>
                </div>
            </div>
        `;

        overlay.style.display = 'flex';

        // Auto-fill the Technical ID based on what they type in the Name box
        const nameInp = overlay.querySelector('#new-move-name');
        const idInp = overlay.querySelector('#new-move-id');
        
        nameInp.addEventListener('input', (e) => {
            if (!idInp.dataset.manuallyEdited) {
                idInp.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            }
        });
        
        idInp.addEventListener('input', () => { idInp.dataset.manuallyEdited = 'true'; });

        overlay.querySelector('#btn-move-cancel').onclick = () => {
            overlay.style.display = 'none';
            resolve(null);
        };

        overlay.querySelector('#btn-move-confirm').onclick = () => {
            const mName = nameInp.value.trim();
            const mId = idInp.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
            
            if (!mName || !mId) {
                window.editorAlert("Both the Name and the Technical ID are required!");
                return;
            }

            // Failsafe: Prevent duplicate IDs inside the same tab
            const tabId = window.currentEditorTabId;
            const existingMoves = window.currentEditorFrameData[tabId] || [];
            if (existingMoves.some(m => m.id === mId)) {
                window.editorAlert(`A move with the exact ID "${mId}" already exists in this tab!`);
                return;
            }

            overlay.style.display = 'none';
            resolve({ name: mName, id: mId });
        };
    });
};

// --- SUB-NAVIGATION: OVERVIEW ---
window.loadOverviewSectionIntoEditor = function(sectionId) {
    const oldSectionId = window.currentOverviewSection;
    if (oldSectionId && window.currentEditorDescData) {
        if (oldSectionId === 'overview') window.currentEditorDescData.overview = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (oldSectionId === 'strategy') window.currentEditorDescData.strategy = JSON.parse(JSON.stringify(currentStrategyBlocks));
        else if (oldSectionId.startsWith('extra-')) window.currentEditorDescData.extras[parseInt(oldSectionId.split('-')[1])].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
    }

    document.querySelectorAll('[id^="overview-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`overview-nav-${sectionId}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentOverviewSection = sectionId;
    const descData = window.currentEditorDescData || {};
    const container = document.getElementById('overview-editor-container');

    if (sectionId === 'profile') {
        container.innerHTML = `
            <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
                <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">EDITING: PROFILE CARD</span>
            </div>
            <div id="profile-editor-target"></div>
        `;
        initProfileEditor('profile-editor-target', descData.profile);
        renderFullOverviewPreview(); 
        
        setTimeout(() => {
            const previewCard = document.querySelector('.live-preview-pane .profile-card');
            if (previewCard) {
                previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                previewCard.style.outline = '2px solid var(--accent-blue)';
                previewCard.style.outlineOffset = '2px';
                setTimeout(() => { previewCard.style.outline = 'none'; }, 800);
            }
        }, 150);
        return; 
    }

    if (sectionId === 'playstyle') {
        container.innerHTML = `
            <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
                <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">EDITING: PLAYSTYLE</span>
            </div>
            <div id="playstyle-editor-target"></div>
        `;
        initPlaystyleEditor('playstyle-editor-target', descData.playstyle);
        renderFullOverviewPreview();
        return; 
    }

    let contentData = [];
    let sectionTitle = "";
    let titleHTML = "";

    if (sectionId === 'overview') {
        contentData = descData.overview || [];
        sectionTitle = "Character Overview";
        titleHTML = `<span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">EDITING: ${sectionTitle}</span>`;
    } else if (sectionId === 'strategy') {
        contentData = descData.strategy || [];
        sectionTitle = "General Strategy";
        titleHTML = `<span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">EDITING: ${sectionTitle}</span>`;
    } else if (sectionId.startsWith('extra-')) {
        const idx = parseInt(sectionId.split('-')[1]);
        contentData = descData.extras[idx].content || [];
        sectionTitle = descData.extras[idx].title || `Extra ${idx}`;
        titleHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem; width: 100%;">
                <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;">EDITING:</span>
                <input type="text" class="editor-input" style="margin: 0; max-width: 300px; font-size: 0.85rem; font-family: var(--text-mono); border-radius: 0; padding: 0.4rem 0.6rem; text-transform: uppercase;" value="${sectionTitle}" oninput="window.updateExtraTabTitle(${idx}, this.value)" placeholder="Custom Tab Name">
            </div>
        `;
    }

    container.innerHTML = `
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
            ${titleHTML}
        </div>
        <div id="strategy-block-target"></div>
    `;
    
    initStrategyBlockBuilder('strategy-block-target', contentData);
    renderFullOverviewPreview(); 
    
    setTimeout(() => {
        let targetId = 'overview-text-subnode';
        if (sectionId === 'strategy') targetId = 'overview-strategy-subnode';
        if (sectionId.startsWith('extra-')) targetId = `overview-extra-${sectionId.split('-')[1]}`;
        
        const previewCard = document.querySelector(`.live-preview-pane #${targetId}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.style.outline = '2px solid var(--accent-blue)';
            previewCard.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// --- SUB-NAVIGATION: MATCHUPS ---
window.addMatchup = async function() {
    await window.triggerManualSync();
    window.currentEditorDescData.matchups.push({
        opponent: "New Character", tier: "Equal", content: [], author: ""
    });
    initFullTabEditor(window.currentEditorCharId, 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadMatchupIntoEditor(window.currentEditorDescData.matchups.length - 1);
};

window.removeMatchup = async function(idx) {
    if (await window.customConfirm("Delete this entire matchup?")) {
        window.currentEditorDescData.matchups.splice(idx, 1);
        initFullTabEditor(window.currentEditorCharId, 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
        if (window.currentEditorDescData.matchups.length > 0) window.loadMatchupIntoEditor(0);
        else renderMatchupsPreview();
    }
};

window.updateMatchupMeta = function(idx, field, value) {
    window.currentEditorDescData.matchups[idx][field] = value;
    if (field === 'opponent') {
        const btn = document.getElementById(`matchup-nav-${idx}`);
        if (btn) btn.firstChild.textContent = `vs. ${value || 'Unknown'}`;
    }
    renderMatchupsPreview();
};

// --- SUB-NAVIGATION: COUNTERPLAY ---
window.addCounterplayTopic = async function() {
    await window.triggerManualSync();
    window.currentEditorDescData.counterplay.push({
        topic: "New Topic", importance: "Moderate", content: [], author: ""
    });
    initFullTabEditor(window.currentEditorCharId, 'counterplay', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadCounterplayIntoEditor(window.currentEditorDescData.counterplay.length - 1);
};

window.removeCounterplayTopic = async function(idx) {
    if (await window.customConfirm("Delete this entire counterplay topic?")) {
        window.currentEditorDescData.counterplay.splice(idx, 1);
        initFullTabEditor(window.currentEditorCharId, 'counterplay', window.currentEditorDescData, window.currentEditorFrameData);
        if (window.currentEditorDescData.counterplay.length > 0) window.loadCounterplayIntoEditor(0);
        else renderCounterplayPreview();
    }
};

window.updateCounterplayMeta = function(idx, field, value) {
    window.currentEditorDescData.counterplay[idx][field] = value;
    if (field === 'topic') {
        const btn = document.getElementById(`counterplay-nav-${idx}`);
        if (btn) btn.firstChild.textContent = value || 'Unknown Topic';
    }
    renderCounterplayPreview();
};

window.loadCounterplayIntoEditor = function(idx) {
    if (window.currentCounterplayIndex !== undefined && window.currentEditorDescData && window.currentEditorDescData.counterplay[window.currentCounterplayIndex]) {
        window.currentEditorDescData.counterplay[window.currentCounterplayIndex].content = JSON.parse(JSON.stringify(window.getActiveBlocks()));
    }

    document.querySelectorAll('[id^="counterplay-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`counterplay-nav-${idx}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentCounterplayIndex = idx;
    const cp = window.currentEditorDescData.counterplay[idx];
    const container = document.getElementById('counterplay-editor-container');

    const importanceOptions = ["Crucial", "High", "Moderate", "Low", "Situational"];
    let impHTML = importanceOptions.map(t => `<option value="${t}" ${cp.importance === t ? 'selected' : ''}>${t}</option>`).join('');

    container.innerHTML = `
        <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1rem;">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">TOPIC METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Topic Name</label>
                        <input type="text" class="editor-input" value="${cp.topic || ''}" oninput="window.updateCounterplayMeta(${idx}, 'topic', this.value)" placeholder="e.g. Dealing with M1s">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Importance</label>
                        <select class="editor-select" onchange="window.updateCounterplayMeta(${idx}, 'importance', this.value)">
                            ${impHTML}
                        </select>
                    </div>
                    </div>
            </div>
        </div>
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">STRATEGY BLOCKS</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initStrategyBlockBuilder('strategy-block-target', cp.content || []);
    renderCounterplayPreview();

    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #counterplay-content-${(cp.topic||'Unknown').replace(/\s+/g, '-')}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// --- MOVES ---
window.loadMatchupIntoEditor = function(idx) {
    if (window.currentMatchupIndex !== undefined && window.currentEditorDescData && window.currentEditorDescData.matchups[window.currentMatchupIndex]) {
        window.currentEditorDescData.matchups[window.currentMatchupIndex].content = JSON.parse(JSON.stringify(window.getActiveBlocks()));
    }

    document.querySelectorAll('[id^="matchup-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`matchup-nav-${idx}`);
    if(activeBtn) activeBtn.classList.add('active');

    window.currentMatchupIndex = idx;
    const matchup = window.currentEditorDescData.matchups[idx];
    const container = document.getElementById('matchup-editor-container');

    const tierOptions = ["Unwinnable", "Extreme Disadvantage", "Disadvantage", "Equal", "Advantage", "Extreme Advantage", "Unloseable"];
    let tierHTML = tierOptions.map(t => `<option value="${t}" ${matchup.tier === t ? 'selected' : ''}>${t}</option>`).join('');

    container.innerHTML = `
        <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1rem;">
            <div class="block-card">
                <div class="block-header"><span class="block-type-badge">MATCHUP METADATA</span></div>
                <div class="editor-row">
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Opponent Name</label>
                        <input type="text" class="editor-input" value="${matchup.opponent || ''}" oninput="window.updateMatchupMeta(${idx}, 'opponent', this.value)" placeholder="e.g. Gojo">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Difficulty Tier</label>
                        <select class="editor-select" onchange="window.updateMatchupMeta(${idx}, 'tier', this.value)">
                            ${tierHTML}
                        </select>
                    </div>
                    </div>
            </div>
        </div>
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">STRATEGY BLOCKS</span>
        </div>
        <div id="strategy-block-target"></div>
    `;

    initStrategyBlockBuilder('strategy-block-target', matchup.content || []);
    renderMatchupsPreview();

    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #matchup-content-${(matchup.opponent||'').replace(/\s+/g, '-')}`);
        if (previewCard) {
            previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            previewCard.parentElement.style.outline = '2px solid var(--accent-blue)';
            previewCard.parentElement.style.outlineOffset = '2px';
            setTimeout(() => { previewCard.parentElement.style.outline = 'none'; }, 800);
        }
    }, 150);
};

// --- SUB-NAVIGATION: MOVES ---
window.loadMoveIntoEditor = async function(moveId) {
    const oldActiveBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
    if (oldActiveBtn && window.currentEditorDescData) {
        const oldMoveId = oldActiveBtn.id.replace('move-nav-', '');
        
        if (oldMoveId !== moveId) {
            if (!window.currentEditorDescData.moveStrategies) window.currentEditorDescData.moveStrategies = {};
            window.currentEditorDescData.moveStrategies[oldMoveId] = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
    }

    document.querySelectorAll('[id^="move-nav-"]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`move-nav-${moveId}`);
    if(activeBtn) activeBtn.classList.add('active');

    const frameData = window.currentEditorFrameData || {};
    const descData = window.currentEditorDescData || {};
    const tabId = window.currentEditorTabId;

    const moveStats = frameData?.[tabId]?.find(m => m.id === moveId);
    const moveStrats = descData?.moveStrategies?.[moveId];

    const container = document.getElementById('move-editor-container');
    container.innerHTML = `
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; margin-top: 0.5rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">1. STATS & FRAME DATA: ${moveStats?.name || moveId}</span>
        </div>
        <div id="daw-editor-target" style="padding-bottom: 1rem;"></div>
        
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;
    
    initDawEditor('daw-editor-target', moveStats);
    initStrategyBlockBuilder('strategy-block-target', moveStrats || []);
    
    if (typeof window.triggerManualSync === 'function') {
        await window.triggerManualSync();
    }
    
    setTimeout(() => {
        const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
        if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
};

function initPerMoveEditor(moveId, statsData, strategyData) {
    const builder = document.getElementById('interactive-builder');
    builder.innerHTML = `
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; margin-top: 0.5rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">1. STATS & FRAME DATA</span>
        </div>
        <div id="daw-editor-target" style="padding-bottom: 1rem;"></div>
        
        <div style="background: #0a0a0a; border-top: 1px solid #222; border-bottom: 1px solid #222; border-left: 3px solid var(--accent-blue); padding: 0.75rem 1.5rem; margin-left: -1.5rem; margin-right: -1.5rem; margin-bottom: 1rem; display: flex; align-items: center;">
            <span style="color: var(--accent-blue); font-family: var(--text-manga); font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin:0;">2. MOVE STRATEGIES</span>
        </div>
        <div id="strategy-block-target"></div>
    `;
    
    initDawEditor('daw-editor-target', statsData);
    initStrategyBlockBuilder('strategy-block-target', strategyData || []);
    updateLivePreview(); 
}

// --- DAW FRAME EDITOR ENGINE ---
function initDawEditor(containerId, moveData) {
    const container = document.getElementById(containerId);
    if (!moveData) {
        container.innerHTML = `<p style="color:var(--text-muted); font-size: 0.85rem; padding-bottom: 1rem;">No frame data configured for this move yet.</p>`;
        return;
    }

    if (!moveData.media) moveData.media = { src: "", alt: "" };
    if (!moveData.stats) moveData.stats = [];
    if (!moveData.variants) moveData.variants = {};

    let activePath = [];
    let firstKey = Object.keys(moveData.variants)[0];
    if (firstKey) activePath = [firstKey];
    
    let selectedBarIdx = null;
    let selectedPhaseIdx = null;

    function getCurrentDawNode() {
        let node = moveData;
        activePath.forEach(k => { if(node.variants) node = node.variants[k]; });
        return node;
    }

    function renderDaw() {
        let metaHtml = `
            <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1rem;">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">MOVE METADATA</span></div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="name" value="${moveData.name || ''}" placeholder="Move Name"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="input" value="${moveData.input || ''}" placeholder="Input (e.g. M1)"></div>
                    </div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="type" value="${moveData.type || ''}" placeholder="Skill Type (e.g. Basic Attack)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="damageType" value="${moveData.damageType || ''}" placeholder="Damage Type (e.g. Melee, Bullet)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="variant" value="${moveData.variant || ''}" placeholder="Variant (e.g. Standard)"></div>
                    </div>
                    <div class="editor-row mt-2">
                        <div><input type="text" class="editor-input meta-inp" data-field="media.src" value="${moveData.media.src || ''}" placeholder="Media Src (e.g. /medias/images/m1.png)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="media.alt" value="${moveData.media.alt || ''}" placeholder="Media Alt Text"></div>
                    </div>
                </div>
            </div>
        `;

        let statsHtml = '';
        moveData.stats.forEach((stat, idx) => {
            statsHtml += `
                <div class="editor-row" style="margin-bottom: 0.25rem;">
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="label" value="${stat.label}" placeholder="Stat Name"></div>
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="value" value="${stat.value}" placeholder="Stat Value"></div>
                    <div style="display:flex; align-items:center; gap:0.5rem; width:auto; flex: 0 0 auto;">
                        <label style="color:var(--text-muted); font-size:0.75rem;"><input type="checkbox" class="stat-highlight" data-idx="${idx}" ${stat.isHighlighted ? 'checked' : ''}> Highlight</label>
                        <button class="add-block-btn btn-action-delete btn-del-stat" data-idx="${idx}" style="padding: 0.3rem 0.5rem;" title="Remove Stat">✖</button>
                    </div>
                </div>
            `;
        });
        let statsCard = `
            <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1rem;">
                <div class="block-card">
                    <div class="block-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="block-type-badge">MOVE STATS</span>
                        <button class="add-block-btn" id="btn-add-movestat" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">+ ADD STAT</button>
                    </div>
                    <div id="move-stats-container">${statsHtml}</div>
                </div>
            </div>
        `;

        let variantTabsHtml = `<div class="daw-variant-wrapper" style="margin-bottom: 1rem;">`;
        let walkNode = moveData;

        for (let depth = 0; depth <= activePath.length; depth++) {
            if (!walkNode.variants) break;
            
            let keys = Object.keys(walkNode.variants);
            let activeKey = activePath[depth]; 
            
            variantTabsHtml += `<div class="daw-variant-tabs" style="margin-left: ${depth * 1}rem; padding-left: ${depth > 0 ? '0.5rem' : '0'}; border-left: ${depth > 0 ? '2px solid #333' : 'none'}; border-bottom: ${depth === activePath.length ? '1px solid #222' : 'none'};">`;
            
            keys.forEach(k => {
                let v = walkNode.variants[k];
                let isActive = (k === activeKey);
                let pathStr = JSON.stringify(activePath.slice(0, depth).concat(k));
                variantTabsHtml += `<button class="daw-tab-btn ${isActive ? 'active' : ''}" onclick='window.setDawPath(${pathStr})'>${v.label || k}</button>`;
            });
            
            let parentPathStr = JSON.stringify(activePath.slice(0, depth));
            variantTabsHtml += `<button class="daw-tab-btn" style="color: #34d399; font-size:0.65rem;" onclick='window.addDawVariant(${parentPathStr})'>+ ADD VARIANT</button></div>`;

            if (activeKey && walkNode.variants[activeKey]) {
                walkNode = walkNode.variants[activeKey];
            } else {
                break; 
            }
        }
        variantTabsHtml += `</div>`;

        let dawHtml = '';
        let currentObj = getCurrentDawNode();
        let hasVariants = currentObj && currentObj.variants && Object.keys(currentObj.variants).length > 0;

        if (currentObj && currentObj.bars) {
            let totalScale = currentObj.totalScale || 100;
            let tracksHtml = '';
            
            currentObj.bars.forEach((bar, bIdx) => {
                let phasesHtml = '';
                if (!bar.phases) bar.phases = [];
                
                bar.phases.forEach((p, pIdx) => {
                    let widthPct = (p.duration / totalScale) * 100;
                    let isSelected = (bIdx === selectedBarIdx && pIdx === selectedPhaseIdx);
                    
                    let bgClassMap = {
                        "bg-tick-start": "#3b82f6", "bg-tick-active": "#ef4444",
                        "bg-tick-recov": "#d946ef", "bg-tick-blockendlag": "#ec4899",
                        "bg-tick-selfstun": "#22c55e", "bg-tick-targetstun": "#b91c1c",
                        "bg-tick-misc": "#10b981", "bg-transparent": "transparent"
                    };
                    let phaseColor = bgClassMap[p.styleClass] || "#555";
                    
                    phasesHtml += `
                        <div class="daw-phase-block ${isSelected ? 'selected' : ''}" 
                                style="width: ${widthPct}%; background-color: ${phaseColor};"
                                onclick="window.selectDawPhase(${bIdx}, ${pIdx})">
                            <span style="pointer-events:none;">${p.duration}f</span>
                        </div>
                    `;
                });

                tracksHtml += `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="display:flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.25rem;">
                            
                            <div style="display:flex; gap: 0.25rem; align-items: center;">
                                <input type="text" class="editor-input daw-track-inp" data-bidx="${bIdx}" data-field="headerInfo" value="${bar.headerInfo || ''}" placeholder="Header Title (Top)" style="margin:0; flex: 1;">
                                <button onclick="window.addDawPhase(${bIdx})" class="btn-sys btn-sys-green" title="Add Phase">+</button>
                                <button onclick="window.deleteDawTrack(${bIdx})" class="btn-sys btn-sys-red" title="Delete Track">✖</button>
                            </div>
                            
                            <div style="display:flex; gap: 0.25rem; align-items: center;">
                                <input type="text" class="editor-input daw-track-inp" data-bidx="${bIdx}" data-field="footerInfo" value="${bar.footerInfo || ''}" placeholder="Footer Title (Bottom)" style="margin:0; flex: 1;">
                                <select class="editor-select daw-track-color ${bar.headerClass || ''}" data-bidx="${bIdx}" style="margin:0; width: 125px; flex: none; font-weight: bold;">
                                    <option value="" style="color: #ffffff;" ${!bar.headerClass ? 'selected' : ''}>Default</option>
                                    <option value="text-red-400" style="color: hsl(3, 93%, 63%);" ${bar.headerClass === 'text-red-400' ? 'selected' : ''}>Red (L)</option>
                                    <option value="text-red-600" style="color: hsl(0, 100%, 50%);" ${bar.headerClass === 'text-red-600' ? 'selected' : ''}>Red (D)</option>
                                    <option value="text-blue-400" style="color: #3b82f6;" ${bar.headerClass === 'text-blue-400' ? 'selected' : ''}>Blue</option>
                                    <option value="text-green-400" style="color: hsl(127, 59%, 58%);" ${bar.headerClass === 'text-green-400' ? 'selected' : ''}>Green (L)</option>
                                    <option value="text-green-500" style="color: hsl(120, 100%, 25%);" ${bar.headerClass === 'text-green-500' ? 'selected' : ''}>Green (D)</option>
                                    <option value="text-purple-400" style="color: hsl(261, 71%, 51%);" ${bar.headerClass === 'text-purple-400' ? 'selected' : ''}>Purple</option>
                                    <option value="text-orange-400" style="color: hsl(39, 100%, 50%);" ${bar.headerClass === 'text-orange-400' ? 'selected' : ''}>Orange</option>
                                    <option value="text-cyan-400" style="color: hsl(180, 100%, 50%);" ${bar.headerClass === 'text-cyan-400' ? 'selected' : ''}>Cyan</option>
                                    <option value="text-gray-400" style="color: hsl(0, 0%, 50%);" ${bar.headerClass === 'text-gray-400' ? 'selected' : ''}>Gray</option>
                                </select>
                            </div>
                            
                        </div>
                        <div class="daw-track">${phasesHtml}</div>
                    </div>
                `;
            });

            let inspectorHtml = '';
            if (selectedBarIdx !== null && selectedPhaseIdx !== null && currentObj.bars[selectedBarIdx]?.phases[selectedPhaseIdx]) {
                let p = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];
                let pOverlays = p.overlays || [];
                
                const overlayOptions = [
                    { id: 'iframe-complete', label: 'Complete I-Frames' },
                    { id: 'iframe-melee', label: 'Melee I-Frames' },
                    { id: 'iframe-bullet', label: 'Bullet I-Frames' },
                    { id: 'iframe-explosion', label: 'Explosion I-Frames' },
                    { id: 'iframe-swarm', label: 'Swarm I-Frames' },
                    { id: 'reverse-hitcancel', label: 'Reverse Hitcancel' }
                ];

                let overlaysHtml = overlayOptions.map(opt => `
                    <label style="display:flex; align-items:center; color:#d1d5db; font-size:0.7rem; margin-bottom:0.25rem; cursor:pointer;">
                        <input type="checkbox" class="insp-overlay-cb" value="${opt.id}" ${pOverlays.includes(opt.id) ? 'checked' : ''}>
                        ${opt.label}
                    </label>
                `).join('');

                inspectorHtml = `
                    <div class="daw-inspector" style="margin-top: 1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                            <span class="block-type-badge">PHASE INSPECTOR</span>
                            <button onclick="window.deleteDawPhase()" class="btn-sys btn-sys-red">✖ DELETE PHASE</button>
                        </div>
                        <div class="editor-row">
                            <div>
                                <label style="font-size:0.65rem; color:#888;">Duration (Frames)</label>
                                <input type="number" class="editor-input" id="insp-duration" value="${p.duration}">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#888;">Frame Type</label>
                                <select class="editor-select" id="insp-class">
                                    <option value="bg-tick-start" ${p.styleClass==='bg-tick-start'?'selected':''}>Startup (Blue)</option>
                                    <option value="bg-tick-active" ${p.styleClass==='bg-tick-active'?'selected':''}>Active (Red)</option>
                                    <option value="bg-tick-recov" ${p.styleClass==='bg-tick-recov'?'selected':''}>Recovery (Purple)</option>
                                    <option value="bg-tick-blockendlag" ${p.styleClass==='bg-tick-blockendlag'?'selected':''}>Block Endlag (Pink)</option>
                                    <option value="bg-tick-selfstun" ${p.styleClass==='bg-tick-selfstun'?'selected':''}>Self Stun (Green)</option>
                                    <option value="bg-tick-targetstun" ${p.styleClass==='bg-tick-targetstun'?'selected':''}>Target Stun (Dark Red)</option>
                                    <option value="bg-tick-misc" ${p.styleClass==='bg-tick-misc'?'selected':''}>Misc (Teal)</option>
                                    <option value="bg-transparent" ${p.styleClass==='bg-transparent'?'selected':''}>Transparent / Gap</option>
                                </select>
                            </div>
                        </div>
                        <div class="editor-row">
                            <div>
                                <label style="font-size:0.65rem; color:#888;">Tooltip</label>
                                <input type="text" class="editor-input" id="insp-label" value="${p.label || ''}">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#888; display:block; margin-bottom: 0.25rem;">Overlays</label>
                                <details class="editor-input" style="padding: 0.3rem 0.4rem; cursor: pointer; height: auto;">
                                    <summary style="font-size: 0.75rem; color: #d1d5db; font-family: var(--text-mono); list-style-position: inside;">Select Overlays (${pOverlays.length})</summary>
                                    <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed #333; display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem;">
                                        ${overlaysHtml}
                                    </div>
                                </details>
                            </div>
                        </div>
                        <div class="editor-row">
                            <div style="flex: 1;">
                                <label style="font-size:0.65rem; color:#888;">Legend Description (Overrides the normal tooltip in the bottom Legend)</label>
                                <input type="text" class="editor-input" id="insp-legend" value="${p.legendDesc || ''}" placeholder="e.g. Has Super Armor">
                            </div>
                        </div>
                    </div>
                `;
            }

            dawHtml = `
                <div class="daw-container">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem; align-items:center;">
                        <div class="editor-row" style="width: 250px; margin: 0;">
                            <input type="text" class="editor-input" style="margin:0;" placeholder="Variant Label" id="daw-variant-label" value="${currentObj.label || ''}">
                            <input type="number" class="editor-input" style="margin:0; width:80px;" placeholder="Scale" id="daw-variant-scale" value="${totalScale}">
                        </div>
                        <div style="display:flex; gap: 0.25rem;">
                            <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red" title="Delete this Variant completely">✖ DELETE</button>
                            <button onclick="window.addDawTrack()" class="btn-sys btn-sys-blue">+ Add Track</button>
                        </div>
                    </div>
                    <div class="daw-timeline-wrapper">
                        ${tracksHtml}
                    </div>
                    ${inspectorHtml}
                </div>
            `;
        } else if (hasVariants) {
            dawHtml = `
                <div class="daw-container" style="text-align: center; padding: 3rem 1rem;">
                    <p style="color:var(--accent-blue); font-family:var(--text-manga); font-size: 1.1rem; margin-bottom:1rem; text-transform: uppercase;">Variant Branch</p>
                    
                    <div style="display: flex; justify-content: center; margin-bottom: 1.5rem;">
                        <input type="text" class="editor-input" style="max-width: 250px; text-align: center; font-size: 0.9rem;" placeholder="Branch Name" id="daw-variant-label" value="${currentObj.label || ''}">
                    </div>

                    <p style="color:var(--text-muted); font-family:var(--text-mono); margin-bottom:1.5rem;">Select a sub-variant from the tabs above to view or edit its timeline.</p>
                    <div style="display:flex; gap:1rem; justify-content:center;">
                        <button onclick="window.deleteDawVariant()" class="add-block-btn" style="color:#ef4444; border-color:#ef4444;">Delete Entire Branch</button>
                    </div>
                </div>
            `;
        } else if (activePath.length > 0) {
            dawHtml = `
                <div class="daw-container" style="text-align: center; padding: 3rem 1rem;">
                    
                    <div style="display: flex; justify-content: center; margin-bottom: 1.5rem;">
                        <input type="text" class="editor-input" style="max-width: 250px; text-align: center; font-size: 0.9rem;" placeholder="Variant Name" id="daw-variant-label" value="${currentObj.label || ''}">
                    </div>

                    <p style="color:var(--text-muted); font-family:var(--text-mono); margin-bottom:1.5rem;">This variant is currently empty.</p>
                    <div style="display:flex; gap:1rem; justify-content:center;">
                        <button onclick="window.initDawLeaf()" class="btn-sys btn-sys-blue" style="max-width:200px;">Initialize Timeline</button>
                        <button onclick="window.initDawBranch()" class="btn-sys btn-sys-regular" style="max-width:200px;">Create Sub-Variants</button>
                        <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red">Delete Variant</button>
                    </div>
                </div>
            `;
        }

        container.innerHTML = metaHtml + statsCard + variantTabsHtml + dawHtml;
        bindDawEvents(container, currentObj);
    }

    function bindDawEvents(container, currentObj) {
        container.querySelectorAll('.meta-inp').forEach(inp => {
            inp.addEventListener('input', (e) => {
                let field = e.target.dataset.field;
                if(field.startsWith('media.')) moveData.media[field.split('.')[1]] = e.target.value;
                else moveData[field] = e.target.value;
            });
        });

        container.querySelectorAll('.stat-inp').forEach(inp => {
            inp.addEventListener('input', (e) => { moveData.stats[e.target.dataset.idx][e.target.dataset.field] = e.target.value; });
        });

        container.querySelectorAll('.stat-highlight').forEach(inp => {
            inp.addEventListener('change', (e) => { moveData.stats[e.target.dataset.idx].isHighlighted = e.target.checked; });
        });

        container.querySelectorAll('.btn-del-stat').forEach(btn => {
            btn.addEventListener('click', (e) => {
                moveData.stats.splice(e.target.dataset.idx, 1);
                renderDaw();
            });
        });

        const btnAddStat = container.querySelector('#btn-add-movestat');
        if(btnAddStat) btnAddStat.addEventListener('click', () => {
            moveData.stats.push({ label: 'New Stat', value: 'Value' });
            renderDaw();
        });

        if (!currentObj) return;

        const varLabel = container.querySelector('#daw-variant-label');
        if (varLabel) varLabel.addEventListener('input', (e) => {
            currentObj.label = e.target.value;
            const activeBtns = container.querySelectorAll('.daw-variant-tabs .active');
            if(activeBtns.length > 0) activeBtns[activeBtns.length - 1].textContent = e.target.value;
        });

        const varScale = container.querySelector('#daw-variant-scale');
        if (varScale) {
            varScale.addEventListener('input', (e) => { currentObj.totalScale = parseInt(e.target.value) || 100; });
            varScale.addEventListener('blur', renderDaw);
        }

        container.querySelectorAll('.daw-track-inp').forEach(inp => {
            inp.addEventListener('input', (e) => { currentObj.bars[e.target.dataset.bidx][e.target.dataset.field] = e.target.value; });
        });
        
        container.querySelectorAll('.daw-track-color').forEach(sel => {
            sel.addEventListener('change', (e) => {
                let bIdx = e.target.dataset.bidx;
                let val = e.target.value;

                e.target.className = `editor-select daw-track-color ${val}`;
                
                if (val) {
                    currentObj.bars[bIdx].headerClass = val;
                } else {
                    delete currentObj.bars[bIdx].headerClass;
                }
            });
        });

        const inspDur = container.querySelector('#insp-duration');
        const inspClass = container.querySelector('#insp-class');
        const inspLabel = container.querySelector('#insp-label');
        const inspLegend = container.querySelector('#insp-legend'); 

        if (inspDur) inspDur.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].duration = parseInt(e.target.value) || 0;
            renderDaw();
        });
        if (inspClass) inspClass.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].styleClass = e.target.value;
            renderDaw();
        });
        if (inspLabel) inspLabel.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].label = e.target.value;
            renderDaw();
        });

        if (inspLegend) inspLegend.addEventListener('change', (e) => {
            let val = e.target.value.trim();
            if(val) {
                currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].legendDesc = val;
            } else {
                delete currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].legendDesc;
            }
            renderDaw();
        });

        container.querySelectorAll('.insp-overlay-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                let phase = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];
                if (!phase.overlays) phase.overlays = [];
                
                let val = e.target.value;
                if (e.target.checked) {
                    if (!phase.overlays.includes(val)) phase.overlays.push(val);
                } else {
                    phase.overlays = phase.overlays.filter(o => o !== val);
                }
                
                if (phase.overlays.length === 0) delete phase.overlays;
                
                renderDaw();
            });
        });
    }

    window.setDawPath = function(pathArr) {
        activePath = pathArr;
        selectedBarIdx = null; selectedPhaseIdx = null;
        renderDaw();
    };

    window.addDawVariant = function(parentPathArr) {
        let parentNode = moveData;
        parentPathArr.forEach(k => { parentNode = parentNode.variants[k]; });
        if (!parentNode.variants) parentNode.variants = {};
        let newKey = 'var_' + Date.now();
        parentNode.variants[newKey] = { label: "New Variant" };
        window.setDawPath([...parentPathArr, newKey]);
    };

    window.initDawLeaf = function() {
        let node = getCurrentDawNode();
        node.totalScale = 100;
        node.bars = [{ type: "single", headerInfo: "Track 1", phases: [] }];
        renderDaw();
    };

    window.initDawBranch = function() {
        let node = getCurrentDawNode();
        node.variants = {};
        window.addDawVariant(activePath);
    };

    window.deleteDawVariant = async function() {
        if(activePath.length === 0) return;
        let parentNode = moveData;
        for(let i=0; i<activePath.length-1; i++) { parentNode = parentNode.variants[activePath[i]]; }
        let keyToDelete = activePath[activePath.length-1];
        if(await window.customConfirm("Delete this variant completely?")) {
            delete parentNode.variants[keyToDelete];
            activePath.pop(); 
            renderDaw();
        }
    };

    window.addDawTrack = function() {
        let node = getCurrentDawNode();
        if(!node) return;
        node.bars.push({ type: "single", headerInfo: "New Track", phases: [] });
        renderDaw();
    };

    window.deleteDawTrack = async function(bIdx) {
        if(await window.customConfirm("Delete this entire track?")) {
            getCurrentDawNode().bars.splice(bIdx, 1);
            if(selectedBarIdx === parseInt(bIdx)) { selectedBarIdx = null; selectedPhaseIdx = null; }
            renderDaw();
        }
    };

    window.addDawPhase = function(bIdx) {
        getCurrentDawNode().bars[bIdx].phases.push({ duration: 10, styleClass: "bg-tick-start", label: "New Phase" });
        renderDaw();
    };

    window.selectDawPhase = function(bIdx, pIdx) {
        selectedBarIdx = bIdx; selectedPhaseIdx = pIdx;
        renderDaw();
    };

    window.deleteDawPhase = function() {
        if(selectedBarIdx !== null && selectedPhaseIdx !== null) {
            getCurrentDawNode().bars[selectedBarIdx].phases.splice(selectedPhaseIdx, 1);
            selectedPhaseIdx = null;
            renderDaw();
        }
    };

    renderDaw();
}

function initProfileEditor(containerId, profileData) {
    const container = document.getElementById(containerId);
    if (!profileData) profileData = {};
    if (!profileData.stats) profileData.stats = [];
    
    const triggerSync = () => {
        window.currentEditorDescData.profile = profileData;
        clearTimeout(window.typingTimer);
        window.typingTimer = setTimeout(() => { updateLivePreview(); }, 400);
    };

    const renderProfileForm = () => {
        let statsHtml = '';
        profileData.stats.forEach((stat, idx) => {
            statsHtml += `
                <div class="editor-row" style="margin-bottom: 0.25rem;">
                    <div><input type="text" class="editor-input stat-label" data-idx="${idx}" value="${stat.label}" placeholder="Label (e.g. Archetype)"></div>
                    <div><input type="text" class="editor-input stat-val" data-idx="${idx}" value="${stat.value}" placeholder="Value (e.g. M1 Merchant)"></div>
                    <button class="btn-sys btn-sys-red btn-del-stat" data-idx="${idx}" title="Remove Stat">✖</button>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="block-editor-container" style="margin-top: 0;">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">PORTRAIT IMAGE</span></div>
                    <input type="text" class="editor-input" id="profile-image-input" value="${profileData.image || ''}" placeholder="Image Path/URL (e.g. /medias/images/Portrait.webp)">
                </div>
                
                <div class="block-card">
                    <div class="block-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="block-type-badge">CHARACTER STATS</span>
                        <button class="btn-sys btn-sys-green" id="btn-add-stat">+ ADD STAT</button>
                    </div>
                    <div id="profile-stats-container">${statsHtml}</div>
                </div>
            </div>
        `;

        container.querySelector('#profile-image-input').addEventListener('input', (e) => {
            profileData.image = e.target.value; triggerSync();
        });

        container.querySelectorAll('.stat-label').forEach(inp => inp.addEventListener('input', (e) => {
            profileData.stats[e.target.dataset.idx].label = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.stat-val').forEach(inp => inp.addEventListener('input', (e) => {
            profileData.stats[e.target.dataset.idx].value = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.btn-del-stat').forEach(btn => btn.addEventListener('click', (e) => {
            profileData.stats.splice(e.target.dataset.idx, 1); renderProfileForm(); triggerSync();
        }));

        container.querySelector('#btn-add-stat').addEventListener('click', () => {
            profileData.stats.push({ label: 'New Stat', value: 'Value' }); renderProfileForm(); triggerSync();
        });
    };

    renderProfileForm();
}

function initPlaystyleEditor(containerId, playstyleData) {
    const container = document.getElementById(containerId);
    if (!playstyleData) playstyleData = { likes: [], dislikes: [] };
    if (!playstyleData.likes) playstyleData.likes = [];
    if (!playstyleData.dislikes) playstyleData.dislikes = [];

    const triggerSync = () => {
        window.currentEditorDescData.playstyle = playstyleData;
        clearTimeout(window.typingTimer);
        window.typingTimer = setTimeout(() => { updateLivePreview(); }, 400);
    };

    const renderForm = () => {
        let likesHtml = playstyleData.likes.map((item, idx) => `
            <div class="editor-row" style="margin-bottom: 0.25rem;">
                <input type="text" class="editor-input like-inp" data-idx="${idx}" value="${item}" placeholder="e.g. Fast-paced rushdown">
                <button class="btn-sys btn-sys-red btn-del-like" data-idx="${idx}">✖</button>
            </div>`).join('');

        let dislikesHtml = playstyleData.dislikes.map((item, idx) => `
            <div class="editor-row" style="margin-bottom: 0.25rem;">
                <input type="text" class="editor-input dislike-inp" data-idx="${idx}" value="${item}" placeholder="e.g. Long-ranged zoning">
                <button class="btn-sys btn-sys-red btn-del-dislike" data-idx="${idx}">✖</button>
            </div>`).join('');

        container.innerHTML = `
            <div class="block-editor-container" style="margin-top: 0; display: flex; gap: 1rem; flex-wrap: wrap;">
                <div class="block-card" style="flex: 1; min-width: 300px;">
                    <div class="block-header" style="display: flex; justify-content: space-between;">
                        <span class="block-type-badge" style="color:#22c55e;">PICK IF YOU LIKE...</span>
                        <button class="btn-sys btn-sys-green" id="btn-add-like">+ ADD</button>
                    </div>
                    <div id="likes-container">${likesHtml}</div>
                </div>
                <div class="block-card" style="flex: 1; min-width: 300px;">
                    <div class="block-header" style="display: flex; justify-content: space-between;">
                        <span class="block-type-badge" style="color:#ef4444;">AVOID IF YOU DISLIKE...</span>
                        <button class="btn-sys btn-sys-red" id="btn-add-dislike">+ ADD</button>
                    </div>
                    <div id="dislikes-container">${dislikesHtml}</div>
                </div>
            </div>
        `;

        container.querySelectorAll('.like-inp').forEach(inp => inp.addEventListener('input', (e) => {
            playstyleData.likes[e.target.dataset.idx] = e.target.value; triggerSync();
        }));
        container.querySelectorAll('.dislike-inp').forEach(inp => inp.addEventListener('input', (e) => {
            playstyleData.dislikes[e.target.dataset.idx] = e.target.value; triggerSync();
        }));

        container.querySelectorAll('.btn-del-like').forEach(btn => btn.addEventListener('click', (e) => {
            playstyleData.likes.splice(e.target.dataset.idx, 1); renderForm(); triggerSync();
        }));
        container.querySelectorAll('.btn-del-dislike').forEach(btn => btn.addEventListener('click', (e) => {
            playstyleData.dislikes.splice(e.target.dataset.idx, 1); renderForm(); triggerSync();
        }));

        container.querySelector('#btn-add-like').addEventListener('click', () => {
            playstyleData.likes.push(""); renderForm(); triggerSync();
        });
        container.querySelector('#btn-add-dislike').addEventListener('click', () => {
            playstyleData.dislikes.push(""); renderForm(); triggerSync();
        });
    };
    renderForm();
}

// --- BLOCK BUILDER STATE ---
let currentStrategyBlocks = [];
let blockHistory = [];
let historyIndex = -1;

window.saveBlockHistory = function() {
    const newStateStr = JSON.stringify(currentStrategyBlocks);
    
    if (historyIndex >= 0 && JSON.stringify(blockHistory[historyIndex]) === newStateStr) return; 
    
    if (historyIndex < blockHistory.length - 1) {
        blockHistory = blockHistory.slice(0, historyIndex + 1);
    }
    
    blockHistory.push(JSON.parse(newStateStr));
    
    if (blockHistory.length > 50) blockHistory.shift(); 
    else historyIndex++;
    
    if (typeof window.updateHistoryButtons === 'function') window.updateHistoryButtons();
};

document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const btnUndo = document.getElementById('btn-undo');
        if (btnUndo && !btnUndo.disabled) btnUndo.click();
    }
    if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        const btnRedo = document.getElementById('btn-redo');
        if (btnRedo && !btnRedo.disabled) btnRedo.click();
    }
});

// --- AUTO-AUTHOR INJECTOR ---
window.spawnBlockWithAuthor = function(type) {
    const newBlock = JSON.parse(JSON.stringify(blockTemplates[type]));
    
    if (newBlock.author !== undefined && window.currentGlobalUsername && window.currentGlobalUsername !== "Anonymous") {
        newBlock.author = window.currentGlobalUsername;
    }
    
    return newBlock;
};

const blockTemplates = {
    heading: { type: 'heading', content: 'New Heading', align: 'left', size: 'h3' },
    paragraph: { type: 'paragraph', content: 'Write your strategy here...', align: 'left' },
    list: { type: 'list', items: ['List item 1', 'List item 2'], align: 'left', author: '' },
    image: { type: 'image', src: '', alt: 'Image description', caption: '', align: 'center', width: '75%' },
    video: { type: 'video', src: '', align: 'center', width: '75%', controls: false, caption: '' }, 
    youtube: { type: 'youtube', videoId: '', align: 'center', width: '75%', caption: '' },
    callout: { type: 'callout', intent: 'info', title: 'Note', content: 'Important detail here', align: 'center' },
    combo: { type: 'combo', sequence: ['M1', 'M1', 'Skill'], damage: '0', align: 'left', note: '', author: '' },
    accordion: { type: 'accordion', title: 'Collapsible Section', content: [{ type: 'paragraph', content: ['Hidden text...'] }], align: 'center', author: '' },
    divider: { type: 'divider', style: 'diamond', padding: 'normal' },
    author: { type: 'author', author: '' },
    table: { type: 'table', headers: ['Stat', 'Value'], rows: [['Damage', '10'], ['Startup', '5f']], align: 'center', author: '' },
};

// --- RECURSIVE EDITOR PATH TRACKING ---
window.activeAccordionPath = []; 

window.getActiveBlocks = function() {
    let blocks = currentStrategyBlocks;
    for (let i = 0; i < window.activeAccordionPath.length; i++) {
        const idx = window.activeAccordionPath[i];
        
        if (!blocks[idx]) {
            window.activeAccordionPath = window.activeAccordionPath.slice(0, i);
            break;
        }
        if (!blocks[idx].content) blocks[idx].content = [];
        blocks = blocks[idx].content;
    }
    return blocks;
};

function initStrategyBlockBuilder(containerId, initialData) {
    const container = document.getElementById(containerId);
    currentStrategyBlocks = initialData ? JSON.parse(JSON.stringify(initialData)) : [];

    window.activeAccordionPath = [];
    
    blockHistory = [JSON.parse(JSON.stringify(currentStrategyBlocks))];
    historyIndex = 0;

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div>
                <button class="btn-sys btn-sys-blue" id="btn-media-library" title="Open Media Manager">📁 MEDIA LIBRARY</button>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn-sys btn-sys-regular" id="btn-undo" title="Undo (Ctrl+Z)" disabled>⮌ UNDO</button>
                <button class="btn-sys btn-sys-regular" id="btn-redo" title="Redo (Ctrl+Y)" disabled>⮎ REDO</button>
                <button class="btn-sys btn-sys-red" id="btn-clear-all" title="Clear All Blocks">✖ CLEAR ALL</button>
            </div>
        </div>
        
        <div id="block-list" class="block-editor-container" style="margin-top: 0; margin-bottom: 3rem;"></div>
        
        <div class="add-block-toolbar" style="display: flex; justify-content: space-between; align-items: center;">
            <div class="format-toolbar" title="Highlight text in a block, then click to apply styling">
                <button class="format-btn" data-tag="b" title="Bold">B</button>
                <button class="format-btn" data-tag="i" title="Italic" style="font-style: italic;">I</button>
                <button class="format-btn" data-tag="u" title="Underline" style="text-decoration: underline;">U</button>
                <button class="format-btn" data-tag="s" title="Strikethrough" style="text-decoration: line-through;">S</button>
                <button class="format-btn" data-tag="code" title="Inline Code" style="font-size: 0.65rem;">&lt;&gt;</button>
                <button class="format-btn" data-tag="url" title="Turn text into a link">🔗</button>
                
                <div style="position: relative; display: inline-flex; align-items: center;">
                    <button class="format-btn" id="btn-format-color" title="Apply Color to Highlighted Text" style="display: flex; align-items: center; gap: 0.35rem; padding: 0 0.5rem;">
                        <div style="width: 12px; height: 12px; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); border-radius: 50%;"></div> 🎨
                    </button>
                    <div id="format-color-popup" style="display: none; position: absolute; bottom: calc(100% + 5px); left: 0; background: #0a0a0a; border: 1px solid #333; padding: 0.5rem; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.8); z-index: 100; min-width: 140px;">
                        <div style="font-size: 0.65rem; color: #888; margin-bottom: 0.4rem; text-transform: uppercase;">Presets</div>
                        <div style="display: flex; gap: 4px; margin-bottom: 0.5rem; flex-wrap: wrap;">
                            <button class="color-preset-btn" data-color="hsl(3, 93%, 63%)" style="background: hsl(3, 93%, 63%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(217, 91%, 60%)" style="background: hsl(217, 91%, 60%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(127, 59%, 58%)" style="background: hsl(127, 59%, 58%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(261, 86%, 86%)" style="background: hsl(261, 86%, 86%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(39, 100%, 50%)" style="background: hsl(39, 100%, 50%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(180, 100%, 50%)" style="background: hsl(180, 100%, 50%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                            <button class="color-preset-btn" data-color="hsl(0, 0%, 50%)" style="background: hsl(0, 0%, 50%); width: 20px; height: 20px; border-radius: 4px; border: 1px solid #222; cursor: pointer;"></button>
                        </div>
                        <div style="border-top: 1px solid #333; padding-top: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 0.75rem; color: #ccc;">Custom Hex</span>
                            <input type="color" id="format-custom-color" value="#ffffff" style="background: none; border: none; width: 24px; height: 24px; cursor: pointer; padding: 0; outline: none;">
                        </div>
                    </div>
                </div>
            </div>

            <div class="add-block-menu-wrapper">
                <div class="add-block-popup" id="add-block-popup">
                    <div class="add-block-popup-title">Text & Media</div>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="heading" draggable="true">+ Heading</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="paragraph" draggable="true">+ Paragraph</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="table" draggable="true">+ Table</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="list" draggable="true">+ List</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="image" draggable="true">+ Image</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="video" draggable="true">+ Video</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="youtube" draggable="true">+ YouTube</button>
                    <div class="add-block-popup-title" style="margin-top: 0.5rem;">Components</div>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="callout" draggable="true">+ Callout</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="combo" draggable="true">+ Combo</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="accordion" draggable="true">+ Accordion</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="divider" draggable="true">+ Divider</button>
                    <button class="btn-sys btn-sys-regular add-block-btn" data-type="author" draggable="true">+ Author</button>
                </div>
                <button class="btn-sys btn-sys-green" id="btn-toggle-add-menu" style="gap: 0.5rem;">
                    <span style="font-size: 1.25rem; line-height: 0.8; font-weight: normal;">⨁</span> ADD BLOCK
                </button>
            </div>
        </div>
    `;

    let draggedItemIndex = null;
    let draggedBlockType = null;

    // --- HISTORY BINDINGS ---
    const btnUndo = container.querySelector('#btn-undo');
    const btnRedo = container.querySelector('#btn-redo');
    
    window.updateHistoryButtons = function() {
        if(btnUndo) btnUndo.disabled = historyIndex <= 0;
        if(btnRedo) btnRedo.disabled = historyIndex >= blockHistory.length - 1;
    };
    window.updateHistoryButtons();

    btnUndo.addEventListener('click', () => {
        if (historyIndex > 0) {
            historyIndex--;
            currentStrategyBlocks = JSON.parse(JSON.stringify(blockHistory[historyIndex]));
            renderBlockList();
            updateLivePreview(true); 
            window.updateHistoryButtons();
        }
    });

    btnRedo.addEventListener('click', () => {
        if (historyIndex < blockHistory.length - 1) {
            historyIndex++;
            currentStrategyBlocks = JSON.parse(JSON.stringify(blockHistory[historyIndex]));
            renderBlockList();
            updateLivePreview(true); 
            window.updateHistoryButtons();
        }
    });

    container.querySelector('#btn-clear-all').addEventListener('click', async () => {
        const activeBlocks = window.getActiveBlocks();
        if (activeBlocks.length > 0 && await window.customConfirm("Delete all blocks in this section?")) {
            activeBlocks.length = 0;
            renderBlockList();
            updateLivePreview(); 
        }
    });

    // --- MEDIA LIBRARY BINDING ---
    const btnMediaLib = container.querySelector('#btn-media-library');
    if (btnMediaLib) {
        btnMediaLib.addEventListener('click', () => {
            document.getElementById('media-modal-overlay').style.display = 'flex';
            if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
        });
    }

    const blockList = document.getElementById('block-list');

    // --- VIRTUALIZATION ENGINE ---
    if (window.editorBlockObserver) window.editorBlockObserver.disconnect();
    
    window.editorBlockObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            if (entry.isIntersecting) {
                card.classList.remove('virtual-unloaded');
                card.style.height = ''; 
            } else {
                const rect = card.getBoundingClientRect();
                if (rect.height > 50) { 
                    card.style.height = rect.height + 'px';
                    card.classList.add('virtual-unloaded');
                }
            }
        });
    }, { 
        root: document.getElementById('interactive-builder'), 
        rootMargin: '800px 0px' 
    });

    // --- 1. FOCUS TRACKER (For Text Formatting) ---
    let lastFocusedInput = null;
    let lastSelection = { start: 0, end: 0 };
    
    blockList.addEventListener('focusin', (e) => {
        if(e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
            lastFocusedInput = e.target;
        }
    });
    const saveSelection = (e) => {
        if(e.target === lastFocusedInput) {
            lastSelection.start = lastFocusedInput.selectionStart;
            lastSelection.end = lastFocusedInput.selectionEnd;
        }
    };
    blockList.addEventListener('mouseup', saveSelection);
    blockList.addEventListener('keyup', saveSelection);

    // --- 2. FORMAT INJECTOR & HOTKEYS ---
    blockList.addEventListener('keydown', (e) => {
        // We only care about Ctrl or Meta (Cmd on Mac)
        if (!e.ctrlKey && !e.metaKey) return;
        
        // Formatting strictly targets text areas and inputs
        const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
        if (!isInput) return;

        let formatTag = null;
        if (e.key.toLowerCase() === 'b') formatTag = 'b';
        else if (e.key.toLowerCase() === 'i') formatTag = 'i';
        else if (e.key.toLowerCase() === 'u') formatTag = 'u';
        else if (e.key === '5') formatTag = 's';
        else if (e.key.toLowerCase() === 'c' && e.shiftKey) formatTag = 'code';
        else if (e.key.toLowerCase() === 'k') formatTag = 'url';

        if (formatTag) {
            e.preventDefault(); // Stop native browser saving/bolding
            
            // Force capture the exact selection range right before injection
            lastFocusedInput = e.target;
            lastSelection.start = e.target.selectionStart;
            lastSelection.end = e.target.selectionEnd;
            applyFormat(formatTag);
        }
    });

    // --- HOVER BLOCK COPY/PASTE ENGINE ---
    // Clears any ghost listeners from previous tab switches
    if (window._blockCopyPasteHandler) {
        document.removeEventListener('keydown', window._blockCopyPasteHandler);
    }
    
    window._blockCopyPasteHandler = (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        
        const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
        
        // If an input is focused, let native text copy/paste happen normally
        if (!isInput) {
            if (e.key.toLowerCase() === 'c' && !e.shiftKey) {
                // Find whatever card the user's mouse is hovering over
                const card = document.querySelector('.block-card:hover');
                if (card) {
                    const index = parseInt(card.getAttribute('data-index'));
                    window.copiedWikiBlock = JSON.parse(JSON.stringify(window.getActiveBlocks()[index]));
                    
                    // Visual feedback Flash
                    card.style.outline = '2px solid var(--accent-blue)';
                    card.style.outlineOffset = '2px';
                    setTimeout(() => { card.style.outline = 'none'; card.style.outlineOffset = '0'; }, 300);
                    e.preventDefault();
                }
            }
            else if (e.key.toLowerCase() === 'v' && !e.shiftKey) {
                if (window.copiedWikiBlock) {
                    e.preventDefault();
                    
                    // Deep clone to prevent reference linking
                    const newBlock = JSON.parse(JSON.stringify(window.copiedWikiBlock));
                    const activeBlocks = window.getActiveBlocks();
                    
                    const card = document.querySelector('.block-card:hover');
                    if (card) {
                        const index = parseInt(card.getAttribute('data-index'));
                        // Splice it directly below the hovered card
                        activeBlocks.splice(index + 1, 0, newBlock);
                    } else {
                        // If hovering in empty space, append to the bottom
                        activeBlocks.push(newBlock);
                    }
                    
                    renderBlockList();
                    updateLivePreview();
                }
            }
        }
    };
    
    document.addEventListener('keydown', window._blockCopyPasteHandler);

    const formatToolbar = container.querySelector('.format-toolbar');
    
    formatToolbar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.format-btn') || e.target.closest('.color-preset-btn')) e.preventDefault(); 
    });

    const applyFormat = (tag, value = null) => {
        if (!lastFocusedInput) return;
        const start = lastSelection.start !== undefined ? lastSelection.start : lastFocusedInput.selectionStart;
        const end = lastSelection.end !== undefined ? lastSelection.end : lastFocusedInput.selectionEnd;
        const text = lastFocusedInput.value;
        const selectedText = text.substring(start, end);
        
        let openTag = `[${tag}]`;
        
        if (tag === 'url') {
            const linkTarget = prompt("Enter the URL or relative path:");
            if (!linkTarget) return; 
            openTag = `[url=${linkTarget}]`;
        } else if (value) {
            openTag = `[${tag}=${value}]`;
        }
        
        let closeTag = `[/${tag}]`;
        
        const newText = text.substring(0, start) + openTag + selectedText + closeTag + text.substring(end);
        lastFocusedInput.value = newText;
        
        lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
        lastFocusedInput.focus();
        lastFocusedInput.setSelectionRange(start + openTag.length, end + openTag.length);
    };

    formatToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.format-btn');
        if (btn && btn.hasAttribute('data-tag')) applyFormat(btn.getAttribute('data-tag'));
    });

    // --- COLOR POPUP LOGIC ---
    const colorBtn = container.querySelector('#btn-format-color');
    const colorPopup = container.querySelector('#format-color-popup');

    if (colorBtn && colorPopup) {
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPopup.style.display = colorPopup.style.display === 'none' ? 'block' : 'none';
        });

        colorPopup.addEventListener('click', (e) => {
            const preset = e.target.closest('.color-preset-btn');
            if (preset) {
                applyFormat('color', preset.getAttribute('data-color'));
                colorPopup.style.display = 'none';
            }
        });

        const customColorInput = container.querySelector('#format-custom-color');
        customColorInput.addEventListener('change', (e) => {
            applyFormat('color', e.target.value);
            colorPopup.style.display = 'none';
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#format-color-popup') && !e.target.closest('#btn-format-color')) {
                colorPopup.style.display = 'none';
            }
        });
    }

    // --- 3. POPUP MENU LOGIC ---
    const btnToggleMenu = container.querySelector('#btn-toggle-add-menu');
    const popupMenu = container.querySelector('#add-block-popup');
    
    btnToggleMenu.addEventListener('click', () => {
        popupMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-block-menu-wrapper')) {
            popupMenu.classList.remove('active');
        }
    });

    // --- SMART BLOCK CONVERSION & DROPDOWN SYNC ---
    blockList.addEventListener('change', (e) => {
        if (e.target.classList.contains('block-type-selector')) {
            const activeBlocks = window.getActiveBlocks(); 
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const newType = e.target.value;
            const oldBlock = activeBlocks[index]; 

            let newBlock = window.spawnBlockWithAuthor(newType);
            if (oldBlock.author !== undefined && newBlock.author !== undefined) {
                newBlock.author = oldBlock.author; 
            }
            
            let oldText = "";
            if (oldBlock.content !== undefined && !Array.isArray(oldBlock.content[0])) {
                oldText = Array.isArray(oldBlock.content) ? oldBlock.content.join('\n') : oldBlock.content;
            } else if (oldBlock.items !== undefined) {
                oldText = Array.isArray(oldBlock.items) ? oldBlock.items.join('\n') : oldBlock.items;
            }

            if (oldText) {
                if (newType === 'paragraph' || newType === 'callout') newBlock.content = oldText.split('\n');
                else if (newType === 'heading') newBlock.content = oldText.replace(/\n/g, ' '); 
                else if (newType === 'list') newBlock.items = oldText.split('\n').filter(i => i.trim() !== '');
                else if (newType === 'accordion') newBlock.content[0].content = oldText.split('\n');
            }

            activeBlocks[index] = newBlock; 
            renderBlockList();
            updateLivePreview();
            return; 
        }

        if (e.target.classList.contains('editor-select') && e.target.hasAttribute('data-field')) {
            const card = e.target.closest('.block-card');
            if (!card) return;
            const index = parseInt(card.getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');

            window.getActiveBlocks()[index][field] = e.target.value; 

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => { updateLivePreview(); }, 400);
        }
    });

    popupMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-block-btn')) {
            const type = e.target.getAttribute('data-type');
            const newBlock = window.spawnBlockWithAuthor(type);

            window.getActiveBlocks().push(newBlock); 
            
            renderBlockList();
            updateLivePreview();
            popupMenu.classList.remove('active'); 
        }
    });

    popupMenu.querySelectorAll('.add-block-btn').forEach(btn => {
        btn.addEventListener('dragstart', (e) => {
            draggedBlockType = e.target.getAttribute('data-type');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', 'toolbar-btn'); 
            popupMenu.classList.remove('active'); 
        });
        btn.addEventListener('dragend', () => {
            draggedBlockType = null;
            blockList.querySelectorAll('.block-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
        });
    });

    // --- DRAG AND DROP PHYSICS ---
    blockList.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('drag-handle')) {
            const card = e.target.closest('.block-card');
            if (card) card.setAttribute('draggable', 'true');
        }
    });

    blockList.addEventListener('mouseup', () => {
        blockList.querySelectorAll('.block-card').forEach(c => c.removeAttribute('draggable'));
    });

    blockList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.block-card');
        if(card) {
            if(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) {
                e.preventDefault();
                return;
            }
            draggedItemIndex = parseInt(card.getAttribute('data-index'));
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'card');
            setTimeout(() => card.style.opacity = '0.4', 0);
        }
    });

    blockList.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        const card = e.target.closest('.block-card');
        if(card) {
            const bounding = card.getBoundingClientRect();
            const offset = bounding.y + (bounding.height / 2);
            if (e.clientY > offset) {
                card.classList.add('drag-over-bottom');
                card.classList.remove('drag-over-top');
            } else {
                card.classList.add('drag-over-top');
                card.classList.remove('drag-over-bottom');
            }
        }
    });

    blockList.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.block-card');
        if(card) card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    blockList.addEventListener('dragend', (e) => {
        const card = e.target.closest('.block-card');
        if(card) card.style.opacity = '1';
        draggedItemIndex = null;
        blockList.querySelectorAll('.block-card').forEach(c => {
            c.classList.remove('drag-over-top', 'drag-over-bottom');
            c.removeAttribute('draggable'); 
        });
    });

    blockList.addEventListener('drop', (e) => {
        e.preventDefault();
        
        const activeBlocks = window.getActiveBlocks(); 
        
        const card = e.target.closest('.block-card');
        blockList.querySelectorAll('.block-card').forEach(c => {
            c.classList.remove('drag-over-top', 'drag-over-bottom');
            c.removeAttribute('draggable'); 
        });

        if (card) {
            let dropIndex = parseInt(card.getAttribute('data-index'));
            const bounding = card.getBoundingClientRect();
            const offset = bounding.y + (bounding.height / 2);
            
            if (e.clientY > offset) dropIndex++; 

            if (draggedBlockType) {
                window.saveBlockHistory(); // Save BEFORE mutating
                const newBlock = window.spawnBlockWithAuthor(draggedBlockType);
                activeBlocks.splice(dropIndex, 0, newBlock);
                renderBlockList();
                updateLivePreview(true); // Tell it to skip saving history again
            } 
            else if (draggedItemIndex !== null) {
                if (draggedItemIndex < dropIndex) dropIndex--; 
                if (draggedItemIndex !== dropIndex) {
                    window.saveBlockHistory();
                    const item = activeBlocks.splice(draggedItemIndex, 1)[0];
                    activeBlocks.splice(dropIndex, 0, item);
                    renderBlockList();
                    updateLivePreview(true);
                }
            }
        } else if (draggedBlockType) {
                window.saveBlockHistory();
                const newBlock = window.spawnBlockWithAuthor(draggedBlockType);
                activeBlocks.push(newBlock);
                renderBlockList();
                updateLivePreview(true);
        }
        
        draggedItemIndex = null;
        draggedBlockType = null;
    });

    let typingTimer;

    blockList.addEventListener('input', (e) => {
        if (e.target.classList.contains('editor-textarea')) {
            e.target.style.height = 'auto';
            e.target.style.height = (e.target.scrollHeight) + 'px';
        }

        if (e.target.classList.contains('editor-input') || e.target.classList.contains('editor-textarea') || e.target.classList.contains('editor-select') || e.target.type === 'checkbox' || e.target.classList.contains('table-header-input') || e.target.classList.contains('table-cell-input')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');

            const activeBlocks = window.getActiveBlocks();

            if (e.target.classList.contains('table-header-input')) {
                const col = parseInt(e.target.getAttribute('data-col'));
                activeBlocks[index].headers[col] = e.target.value;
                updateLivePreview(); return;
            } 
            if (e.target.classList.contains('table-cell-input')) {
                const row = parseInt(e.target.getAttribute('data-row'));
                const col = parseInt(e.target.getAttribute('data-col'));
                activeBlocks[index].rows[row][col] = e.target.value;
                updateLivePreview(); return;
            }

            if (field === 'content-array') activeBlocks[index].content = e.target.value.split('\n');
            else if (field === 'list-items') activeBlocks[index].items = e.target.value.split('\n').filter(i => i.trim() !== '');
            else if (field === 'combo-sequence') activeBlocks[index].sequence = e.target.value.split(',').map(s => s.trim());
            else if (e.target.type === 'checkbox') activeBlocks[index][field] = e.target.checked;
            else activeBlocks[index][field] = e.target.value;

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                updateLivePreview(); 
            }, 400); 
        }
    });

    blockList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        const activeBlocks = window.getActiveBlocks(); 
        window.saveBlockHistory();

        if (e.target.classList.contains('btn-table-add-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const cols = activeBlocks[index].headers.length;
            activeBlocks[index].rows.push(new Array(cols).fill(''));
            renderBlockList(); updateLivePreview(true);
        } else if (e.target.classList.contains('btn-table-add-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            activeBlocks[index].headers.push('New');
            activeBlocks[index].rows.forEach(r => r.push(''));
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (activeBlocks[index].rows.length > 1) activeBlocks[index].rows.pop();
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (activeBlocks[index].headers.length > 1) {
                activeBlocks[index].headers.pop();
                activeBlocks[index].rows.forEach(r => r.pop());
            }
            renderBlockList(); updateLivePreview();
        }

        if (btn.classList.contains('btn-collapse')) {
            const card = btn.closest('.block-card');
            const body = card.querySelector('.block-body');
            body.classList.toggle('minimized');
            card.classList.toggle('collapsed');
            btn.textContent = body.classList.contains('minimized') ? '□' : '—';
            return;
        }
        
        const index = parseInt(btn.closest('.block-card').getAttribute('data-index'));

        if (btn.classList.contains('align-btn')) {
            activeBlocks[index].align = btn.getAttribute('data-val'); 
            renderBlockList();
            updateLivePreview();
            return;
        }
        
        if (btn.classList.contains('btn-insert-below')) {
            const newBlock = window.spawnBlockWithAuthor('paragraph');
            activeBlocks.splice(index + 1, 0, newBlock);
            renderBlockList();
            updateLivePreview();
            return;
        }

        if (btn.classList.contains('btn-up') && index > 0) {
            [activeBlocks[index - 1], activeBlocks[index]] = [activeBlocks[index], activeBlocks[index - 1]];
        } else if (btn.classList.contains('btn-down') && index < activeBlocks.length - 1) {
            [activeBlocks[index], activeBlocks[index + 1]] = [activeBlocks[index + 1], activeBlocks[index]];
        } else if (btn.classList.contains('btn-delete')) {
            activeBlocks.splice(index, 1); 
        } else {
            return; 
        }
        
        renderBlockList();
        updateLivePreview();
    });

    renderBlockList();
}

function renderBlockList() {
    const listContainer = document.getElementById('block-list');
    listContainer.innerHTML = '';

    const activeBlocks = window.getActiveBlocks();

    const getAlignUI = (alignVal, defaultAlign = 'left') => {
        const align = alignVal || defaultAlign;
        return `
            <div class="align-group">
                <button class="align-btn ${align === 'left' ? 'active' : ''}" data-val="left" title="Align/Float Left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
                <button class="align-btn ${align === 'center' ? 'active' : ''}" data-val="center" title="Align/Float Center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="18" y1="12" x2="6" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
                <button class="align-btn ${align === 'right' ? 'active' : ''}" data-val="right" title="Align/Float Right">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
                </button>
            </div>
        `;
    };

    if (window.activeAccordionPath.length > 0) {
        let parentBlock = currentStrategyBlocks;
        for (let i = 0; i < window.activeAccordionPath.length - 1; i++) {
            parentBlock = parentBlock[window.activeAccordionPath[i]].content;
        }
        const activeIdx = window.activeAccordionPath[window.activeAccordionPath.length - 1];
        const parentTitle = parentBlock[activeIdx].title || 'Accordion';
        
        const backBtnHTML = `
            <div style="background: rgba(168, 85, 247, 0.1); border: 1px dashed #a855f7; padding: 0.75rem 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="color: #a855f7; font-family: var(--text-mono); font-size: 0.75rem; text-transform: uppercase;">EDITING INNER BLOCKS:</span>
                    <div style="color: #fff; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.9rem;">${parentTitle}</div>
                </div>
                <button class="btn-sys btn-sys-purple btn-purple-fill" onclick="window.activeAccordionPath.pop(); renderBlockList();">⮑ BACK TO PARENT</button>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', backBtnHTML);
    }

    activeBlocks.forEach((block, index) => {
        const card = document.createElement('div');
        card.className = 'block-card';
        card.setAttribute('data-index', index);

            const typeOptions = Object.keys(blockTemplates).map(t => 
                `<option value="${t}" ${block.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`
            ).join('');

            let html = `
                <div class="block-header">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="drag-handle" title="Drag to reorder" style="color: #666; font-size: 1rem; line-height: 1; cursor: grab;">⠿</span>
                        <select class="editor-select block-type-selector" style="cursor: pointer; border: none; outline: none; padding-right: 0.2rem;">
                            ${typeOptions}
                        </select>
                    </div>
                <div class="block-actions">
                    <button class="btn-sys btn-sys-green btn-insert-below" title="Insert Paragraph Below">⨁</button>
                    <button class="btn-sys btn-sys-regular btn-collapse" title="Minimize/Expand">—</button>
                    <button class="btn-sys btn-sys-regular btn-up" title="Move Up">▲</button>
                    <button class="btn-sys btn-sys-regular btn-down" title="Move Down">▼</button>
                    <button class="btn-sys btn-sys-red btn-delete" title="Delete">✖</button>
                </div>
            </div>
            <div class="block-body">
        `;

        if (block.type === 'heading') {
            html += `
                <input type="text" class="editor-input" data-field="content" value="${block.content}" placeholder="Heading Text" style="font-family: var(--text-manga); font-size: 1.1rem; color: #fff;">
                <div class="editor-row">
                    <div>
                        <select class="editor-select" data-field="size">
                            <option value="h2" ${block.size === 'h2' ? 'selected' : ''}>Main Section (H2)</option>
                            <option value="h3" ${(!block.size || block.size === 'h3') ? 'selected' : ''}>Subsection (H3)</option>
                            <option value="h4" ${block.size === 'h4' ? 'selected' : ''}>Minor (H4)</option>
                        </select>
                    </div>
                    <div>${getAlignUI(block.align, 'left')}</div>
                </div>
            `;
        }
        else if (block.type === 'paragraph') {
            const textValue = Array.isArray(block.content) ? block.content.join('\n') : block.content;
            html += `
                <textarea class="editor-textarea" data-field="content-array" placeholder="Enter paragraph. Use new lines to break array elements. Tip: Use [M1] for keybinds.">${textValue}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'list') {
            const listValue = Array.isArray(block.items) ? block.items.join('\n') : block.items;
            html += `
                <textarea class="editor-textarea" data-field="list-items" placeholder="Enter list items. Use a new line for each bullet point.">${listValue}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'image') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${block.src || ''}" placeholder="Image Path/URL (e.g. VesselPortrait.webp)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="alt" value="${block.alt || ''}" placeholder="Alt Text (Required for accessibility)"></div>
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 50% or 400px)"></div>
                </div>
            `;
        }
        else if (block.type === 'video') {
            html += `
                <input type="text" class="editor-input" data-field="src" value="${block.src}" placeholder="Video URL (e.g. /medias/videos/NoNeutralCS.webm)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 50%)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div style="display:flex; align-items:center;">
                        <label style="color:var(--text-muted); font-size:0.85rem; margin:0;"><input type="checkbox" data-field="controls" ${block.controls ? 'checked' : ''}> Show Controls</label>
                    </div>
                </div>
            `;
        }
        else if (block.type === 'youtube') {
            html += `
                <input type="text" class="editor-input" data-field="videoId" value="${block.videoId || ''}" placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="caption" value="${block.caption || ''}" placeholder="Caption (Optional)"></div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 75%)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div></div>
                </div>
            `;
        }
        else if (block.type === 'combo') {
            const seq = block.sequence ? block.sequence.join(', ') : '';
            html += `
                <input type="text" class="editor-input" data-field="combo-sequence" value="${seq}" placeholder="Sequence (Comma separated: M1, M1, Skill)">
                <div class="editor-row">
                    <div><input type="text" class="editor-input" data-field="damage" value="${block.damage || ''}" placeholder="Damage text (e.g. 40 DMG)"></div>
                    <div><input type="text" class="editor-input" data-field="note" value="${block.note || ''}" placeholder="Condition/Note (e.g. Corner Only)"></div>
                </div>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'left')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
            `;
        }
        else if (block.type === 'table') {
            let tableHTML = `<div style="overflow-x: auto; margin-bottom: 0.5rem; border: 1px solid #333; border-radius: 4px;"><table style="width: 100%; border-collapse: collapse;">`;
            
            tableHTML += `<tr>`;
            block.headers.forEach((h, c) => {
                tableHTML += `<td><input type="text" class="editor-input table-header-input" data-col="${c}" value="${h}" placeholder="Header" style="margin:0; border-radius:0; border:none; border-bottom: 2px solid #444; border-right: 1px solid #333; font-weight: bold; background: rgba(0,0,0,0.4); text-align: center;"></td>`;
            });
            tableHTML += `</tr>`;
            
            block.rows.forEach((r, rIdx) => {
                tableHTML += `<tr>`;
                r.forEach((cell, cIdx) => {
                    tableHTML += `<td><input type="text" class="editor-input table-cell-input" data-row="${rIdx}" data-col="${cIdx}" value="${cell}" placeholder="..." style="margin:0; border-radius:0; border:none; border-bottom: 1px solid #222; border-right: 1px solid #333;"></td>`;
                });
                tableHTML += `</tr>`;
            });
            tableHTML += `</table></div>`;
            
            html += `
                ${tableHTML}
                <div style="display:flex; gap:0.25rem; margin-bottom: 0.5rem; border-radius: 0rem">
                    <button class="btn-sys btn-sys-regular btn-table-add-row" style="flex:1;" title="Add Row Below">⊞ +Row</button>
                    <button class="btn-sys btn-sys-regular btn-table-add-col" style="flex:1;" title="Add Column Right">⊞ +Col</button>
                    <button class="btn-sys btn-sys-red btn-table-del-row" style="flex:1;" title="Delete Bottom Row">⊟ -Row</button>
                    <button class="btn-sys btn-sys-red btn-table-del-col" style="flex:1;" title="Delete Right Column">⊟ -Col</button>
                </div>
                <input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)">
            `;
        }
        else if (block.type === 'accordion') {
            const innerCount = block.content ? block.content.length : 0;
            html += `
                <input type="text" class="editor-input" data-field="title" value="${block.title || ''}" placeholder="Accordion Title">
                <div class="editor-row" style="margin-bottom: 0.5rem;">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
                </div>
                <div style="padding: 1rem; border: 1px dashed #444; background: rgba(0,0,0,0.3); text-align: center; margin-bottom: 0.5rem;">
                    <button class="btn-sys btn-sys-purple" onclick="window.activeAccordionPath.push(${index}); renderBlockList();">
                        ⮑ EDIT INNER BLOCKS (${innerCount})
                    </button>
                </div>
            `;
        }
        else if (block.type === 'callout') {
            const textValue = Array.isArray(block.content) ? block.content.join('\n') : block.content;
            html += `
                <div class="editor-row">
                    <div>
                        <select class="editor-select" data-field="intent">
                            <option value="info" ${block.intent === 'info' ? 'selected' : ''}>Info (Cyan)</option>
                            <option value="tip" ${block.intent === 'tip' ? 'selected' : ''}>Tip (Yellow)</option>
                            <option value="warning" ${block.intent === 'warning' ? 'selected' : ''}>Warning (Orange)</option>
                            <option value="danger" ${block.intent === 'danger' ? 'selected' : ''}>Danger (Red)</option>
                        </select>
                    </div>
                    <div><input type="text" class="editor-input" data-field="title" value="${block.title || ''}" placeholder="Callout Title"></div>
                    <div>${getAlignUI(block.align, 'center')}</div>
                </div>
                <textarea class="editor-textarea" data-field="content-array" placeholder="Tooltip text...">${textValue}</textarea>
            `;
        }
        else if (block.type === 'divider') {
            const currentStyle = block.style || (block.invisible ? 'invisible' : 'diamond');
            const currentPad = block.padding || 'normal';
            
            html += `
                <div class="editor-row">
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Divider Style</label>
                        <select class="editor-select" data-field="style">
                            <option value="diamond" ${currentStyle === 'diamond' ? 'selected' : ''}>Diamond (Default)</option>
                            <option value="solid" ${currentStyle === 'solid' ? 'selected' : ''}>Solid Line</option>
                            <option value="dashed" ${currentStyle === 'dashed' ? 'selected' : ''}>Dashed Line</option>
                            <option value="dotted" ${currentStyle === 'dotted' ? 'selected' : ''}>Dotted Line</option>
                            <option value="double" ${currentStyle === 'double' ? 'selected' : ''}>Double Line</option>
                            <option value="circle" ${currentStyle === 'circle' ? 'selected' : ''}>Center Circle</option>
                            <option value="cross" ${currentStyle === 'cross' ? 'selected' : ''}>Center Cross</option>
                            <option value="fade" ${currentStyle === 'fade' ? 'selected' : ''}>Cinematic Fade</option>
                            <option value="slash" ${currentStyle === 'slash' ? 'selected' : ''}>Slashes (///)</option>
                            <option value="invisible" ${currentStyle === 'invisible' ? 'selected' : ''}>Invisible (Spacer)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#888;">Vertical Padding</label>
                        <select class="editor-select" data-field="padding">
                            <option value="none" ${currentPad === 'none' ? 'selected' : ''}>None (0rem)</option>
                            <option value="small" ${currentPad === 'small' ? 'selected' : ''}>Small (1rem)</option>
                            <option value="normal" ${currentPad === 'normal' ? 'selected' : ''}>Normal (2.5rem)</option>
                            <option value="large" ${currentPad === 'large' ? 'selected' : ''}>Large (4rem)</option>
                            <option value="massive" ${currentPad === 'massive' ? 'selected' : ''}>Massive (6rem)</option>
                        </select>
                    </div>
                </div>
            `;
        }
        else if (block.type === 'author') {
            html += `
                <div class="editor-row" style="margin: 0;">
                    <input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Contributor Name(s) (Comma separated)">
                </div>
            `;
        }
        else {
            html += `<p style="color: var(--text-muted); font-style: italic;">Complex block type (${block.type}) detected. Render raw JSON view here if needed.</p>`;
        }

        html += `</div>`;
        card.innerHTML = html;
        listContainer.appendChild(card);
    });

    listContainer.querySelectorAll('.editor-textarea').forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
    });

    if (window.editorBlockObserver) {
        listContainer.querySelectorAll('.block-card').forEach(card => {
            window.editorBlockObserver.observe(card);
        });
    }

    if (typeof window.initializeMangaSelects === 'function') {
        window.initializeMangaSelects(); 
    } else if (typeof window.applyInternalStyling === 'function') {
        window.applyInternalStyling(); 
    }
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
            <aside class="wiki-section profile-card" style="align-self: flex-start;">
                ${imgHTML}
                <div class="profile-stats-container">${statsHTML}</div>
            </aside>
        `;
    }

    const rightColumn = document.createElement('div');
    rightColumn.className = 'profile-text-wrapper'; 
    rightColumn.style.display = 'flex';
    rightColumn.style.flexDirection = 'column';

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
        const tierColors = {
            "Unwinnable": "#dc2626", "Extreme Disadvantage": "#ef4444",
            "Disadvantage": "#fb923c", "Equal": "#9ca3af",
            "Advantage": "#4ade80", "Extreme Advantage": "#22c55e",
            "Unloseable": "#22d3ee"
        };
        const tierColor = tierColors[mu.tier] || "#ffffff";
        const safeOpponent = (mu.opponent || 'Unknown').replace(/\s+/g, '-');

        const muSection = document.createElement('section');
        muSection.className = 'wiki-section'; 
        muSection.style.overflow = 'hidden'; 

        let muHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">vs. ${mu.opponent || 'Unknown'}</h3>
                <span class="card-tier-label" style="color: ${tierColor};">${mu.tier || 'Equal'}</span>
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
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

function renderCounterplayPreview() {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const cpContainer = document.getElementById('tab-counterplay');
    if (!cpContainer) return;

    cpContainer.innerHTML = '';
    cpContainer.classList.add('vessel-content', 'space-y-6');

    if (!descData.counterplay || descData.counterplay.length === 0) {
        cpContainer.innerHTML = `<div class="empty-tab-msg">Counterplay analysis has not been written yet.</div>`;
        return;
    }

    descData.counterplay.forEach(cp => {
        const importanceColors = {
            "Crucial": "#ef4444", "High": "#fb923c",
            "Moderate": "#facc15", "Low": "#4ade80",
            "Situational": "#22d3ee"
        };
        const impColor = importanceColors[cp.importance] || "#9ca3af";
        const safeTopic = (cp.topic || 'Unknown').replace(/\s+/g, '-');

        const cpSection = document.createElement('section');
        cpSection.className = 'wiki-section'; 
        cpSection.style.overflow = 'hidden';

        let cpHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">${cp.topic || 'Unknown'}</h3>
                <span class="card-tier-label" style="color: ${impColor};">${cp.importance || 'Moderate'}</span>
            </div>
        `;

        cpSection.innerHTML = cpHTML;
        cpContainer.appendChild(cpSection);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'counterplay-content';
        contentWrapper.id = `counterplay-content-${safeTopic}`;
        cpSection.appendChild(contentWrapper);

        if (typeof window.populateTextSection === 'function') {
            if (cp.content && cp.content.length > 0) {
                window.populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');
                const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
            } else {
                contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
            }
        }
    });

    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

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
    }

    // --- CHARACTER SYNC LOGIC ---
    const tabId = window.currentEditorTabId;
    const frameTabs = ['m1s', 'skills', 'specials'];

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
    } else if (tabId === 'counterplay' && typeof renderCounterplayPreview === 'function') {
        if (window.currentEditorDescData && window.currentCounterplayIndex !== undefined) {
            window.currentEditorDescData.counterplay[window.currentCounterplayIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
        renderCounterplayPreview();
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
    const tabId = urlParams.get('tab');
    const frameTabs = ['m1s', 'skills', 'specials'];

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

    } else if (tabId === 'counterplay') {
        if (window.currentEditorDescData && window.currentCounterplayIndex !== undefined && window.currentEditorDescData.counterplay[window.currentCounterplayIndex]) {
            window.currentEditorDescData.counterplay[window.currentCounterplayIndex].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }
        if (typeof renderCounterplayPreview === 'function') renderCounterplayPreview();

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

// --- LOCAL AUTO-SAVE ENGINE ---
window.saveLocalDraft = function() {
    if (!window.currentEditorCharId) return;
    
    const tabId = window.currentEditorTabId || 'overview';
    let moveId = '';
    
    const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
    if (activeBtn && activeBtn.id.startsWith('move-nav-')) {
        moveId = activeBtn.id.replace('move-nav-', '');
    } else if (new URLSearchParams(window.location.search).get('move')) {
        moveId = new URLSearchParams(window.location.search).get('move');
    }

    const draftKey = `wiki_draft_${window.currentEditorCharId}_${tabId}${moveId ? '_' + moveId : ''}`;
    
    const draftData = {
        timestamp: Date.now(),
        charId: window.currentEditorCharId,
        tabId: tabId,
        moveId: moveId,
        desc_data: window.currentEditorDescData,
        frame_data: window.currentEditorFrameData
    };
    
    try {
        localStorage.setItem(draftKey, JSON.stringify(draftData));
        window.currentDraftKey = draftKey; 
    } catch (e) {
        console.warn("Auto-Save Failed: LocalStorage is full. Please discard old drafts in the Draft Manager.");
    }
};

// --- MEDIA LIBRARY SYSTEM ---
window.initMediaLibrary = function() {
    const dropZone = document.getElementById('media-upload-zone');
    const fileInput = document.getElementById('media-file-input');
    const gallery = document.getElementById('media-gallery-grid');
    const btnRefresh = document.getElementById('btn-media-refresh');

    if (!dropZone || !gallery) return;

    window.currentMediaFiles = []; 

    function convertToWebP(file, newName) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                    resolve(new File([blob], newName, { type: "image/webp" }));
                }, 'image/webp', 0.9);
            };
            img.onerror = () => reject(new Error("Invalid image file."));
        });
    }

    window.currentMediaPage = 1;
    window.mediaItemsPerPage = 24; 

    window.loadMediaGallery = async function() {
        const grid = document.getElementById('media-gallery-grid');
        if (!grid) return;
        
        grid.innerHTML = '<div style="color:#888; font-family:var(--text-mono); font-size:0.75rem; padding: 2rem; text-align:center; grid-column: 1 / -1;">Connecting to Cloud Storage...</div>';
        
        if (!window.supabaseClient) return;

        const { data, error } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
        if (error) {
            grid.innerHTML = `<div style="color:#ef4444; grid-column: 1 / -1;">Error: ${error.message}</div>`;
            return;
        }

        window.currentMediaFiles = data.filter(f => !f.name.startsWith('.'));
        window.currentMediaPage = 1; 
        window.renderMediaGrid(); 
    };

    window.renderMediaGrid = function() {
        const grid = document.getElementById('media-gallery-grid');
        const searchQuery = (document.getElementById('media-search-input')?.value || '').toLowerCase();
        const filterType = document.getElementById('media-filter-select')?.value || 'all';

        if (!grid) return;

        const filteredFiles = window.currentMediaFiles.filter(file => {
            const name = file.name.toLowerCase();
            const isAnimated = name.endsWith('.webm') || name.endsWith('.mp4') || name.endsWith('.gif');
            
            if (searchQuery && !name.includes(searchQuery)) return false;
            if (filterType === 'video' && !isAnimated) return false;
            if (filterType === 'image' && isAnimated) return false;

            return true;
        });

        const totalItems = filteredFiles.length;
        const totalPages = Math.ceil(totalItems / window.mediaItemsPerPage) || 1;
        
        if (window.currentMediaPage > totalPages) window.currentMediaPage = totalPages;

        const startIndex = (window.currentMediaPage - 1) * window.mediaItemsPerPage;
        const endIndex = startIndex + window.mediaItemsPerPage;
        
        const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

        document.getElementById('media-page-indicator').textContent = `PAGE ${window.currentMediaPage}/${totalPages}`;
        
        const btnPrev = document.getElementById('btn-media-prev');
        const btnNext = document.getElementById('btn-media-next');
        
        btnPrev.disabled = window.currentMediaPage === 1;
        btnNext.disabled = window.currentMediaPage === totalPages;
        
        btnPrev.style.opacity = btnPrev.disabled ? '0.3' : '1';
        btnNext.style.opacity = btnNext.disabled ? '0.3' : '1';

        if (paginatedFiles.length === 0) {
            grid.innerHTML = '<div style="color:#888; font-family:var(--text-mono); font-size:0.75rem; padding: 2rem; text-align:center; grid-column: 1 / -1;">No media matches your search criteria.</div>';
            return;
        }

        grid.innerHTML = '';

        paginatedFiles.forEach(file => {
            const { data: publicUrlData } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(file.name);
            const url = publicUrlData.publicUrl;

            const card = document.createElement('div');
            card.className = 'media-thumbnail-card';
            
            card.onclick = () => {
                navigator.clipboard.writeText(url).then(() => {
                    const toast = card.querySelector('.copy-toast');
                    if (toast) {
                        toast.style.display = 'flex';
                        setTimeout(() => toast.style.display = 'none', 1200);
                    }
                }).catch(err => {
                    alert("Clipboard access denied. Manual URL: " + url);
                });
            };

            const isVideo = file.name.endsWith('.webm') || file.name.endsWith('.mp4');
            const isGif = file.name.endsWith('.gif');

            let mediaHTML = isVideo 
                ? `<video src="${url}" loop muted playsinline preload="metadata" style="width:100%; height:100%; object-fit:cover; pointer-events:none;"></video>`
                : `<img src="${url}" style="width:100%; height:100%; object-fit:cover; pointer-events:none;">`;

            const badgeHTML = (isVideo || isGif) 
                ? `<div style="position:absolute; top:4px; right:4px; background:rgba(0,0,0,0.85); color:var(--accent-blue); font-size:0.55rem; padding:2px 4px; font-family:var(--text-mono); border:1px solid var(--accent-blue); z-index:5;">${isVideo ? 'VIDEO' : 'GIF'}</div>` 
                : '';

            card.innerHTML = `
                ${mediaHTML}
                ${badgeHTML}
                <div class="copy-toast" style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(34, 197, 94, 0.9); color:#000; display:none; align-items:center; justify-content:center; font-family:'CC-Wild-Words', sans-serif; font-size:0.8rem; z-index:10; pointer-events:none;">COPIED URL!</div>
                <div style="position: absolute; bottom: 0; left: 0; width: 100%; background: rgba(0,0,0,0.85); color: #fff; font-size: 0.65rem; font-family: var(--text-mono); padding: 4px 6px; box-sizing: border-box; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px solid #333; z-index:5;">
                    ${file.name}
                </div>
            `;
            
            if (isVideo) {
                const vidEl = card.querySelector('video');
                card.addEventListener('mouseenter', () => {
                    if (vidEl) vidEl.play().catch(e => console.warn("Hover play blocked by browser:", e));
                });
                card.addEventListener('mouseleave', () => {
                    if (vidEl) vidEl.pause();
                });
            }
            
            grid.appendChild(card);
        });
    };

    document.getElementById('btn-media-prev').addEventListener('click', () => {
        if (window.currentMediaPage > 1) {
            window.currentMediaPage--;
            window.renderMediaGrid();
        }
    });

    document.getElementById('btn-media-next').addEventListener('click', () => {
        window.currentMediaPage++;
        window.renderMediaGrid();
    });

    document.getElementById('media-search-input').addEventListener('input', () => {
        window.currentMediaPage = 1;
        window.renderMediaGrid();
    });
    document.getElementById('media-filter-select').addEventListener('change', () => {
        window.currentMediaPage = 1;
        window.renderMediaGrid();
    });

    // Upload Logic
    async function handleUpload(file) {
        if (!window.supabaseClient) return;

        // Extract base name and original extension
        const lastDotIndex = file.name.lastIndexOf('.');
        const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
        const originalExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex).toLowerCase() : '';
        
        const isVideo = file.type.startsWith('video/');
        const isGif = file.type.includes('gif');
        
        // Preserve original extensions for videos and GIFs. Only convert static images to .webp.
        let newExt = originalExt;
        if (!isVideo && !isGif && originalExt !== '.webp') {
            newExt = '.webp'; 
        }

        let finalName = baseName + newExt;

        // 1. GATEKEEPER: Prevent Overwrites
        const exists = window.currentMediaFiles.some(f => f.name.toLowerCase() === finalName.toLowerCase());
        if (exists) {
            window.editorAlert(`A file named "${finalName}" already exists in the Cloud!\n\nPlease rename your file on your computer (e.g., append "_v2" or "_updated" to the end) before uploading to ensure you do not break live Wiki pages.`);
            return;
        }

        const dropZone = document.getElementById('media-upload-zone');
        const uploadText = document.getElementById('media-upload-text');
        const oldText = uploadText.textContent;
        uploadText.style.color = "var(--accent-blue)";
        
        let finalFile = file;

        try {
            // 2. CONVERSION ROUTING (Images Only)
            if (!isVideo && !isGif && originalExt !== '.webp') {
                uploadText.textContent = "Converting Image to WEBP...";
                try {
                    finalFile = await convertToWebP(file, finalName);
                } catch (convErr) {
                    console.warn("WebP conversion failed, falling back to original file:", convErr);
                    finalFile = file; 
                    finalName = file.name; // Revert to original extension on failure
                }
            } 

            // 3. SECURE CLOUD UPLOAD
            uploadText.textContent = "Uploading to Cloud...";
            const { error } = await window.supabaseClient.storage.from('wiki-media').upload(finalName, finalFile);

            if (error) {
                console.error("Upload error:", error);
                window.editorAlert("Upload failed: " + error.message);
            } else {
                window.loadMediaGallery(); // Instantly refresh the grid
            }
        } catch (err) {
            console.error(err);
            window.editorAlert("Action Failed: " + err.message);
        }

        uploadText.textContent = oldText;
        uploadText.style.color = "";
    }

    btnRefresh.addEventListener('click', window.loadMediaGallery);
    document.getElementById('media-search-input').addEventListener('input', window.renderMediaGrid);
    document.getElementById('media-filter-select').addEventListener('change', window.renderMediaGrid);

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleUpload(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#34d399';
        dropZone.style.background = 'rgba(52, 211, 153, 0.05)';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
        if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.initMediaLibrary();
});

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
        if (standardCont) standardCont.style.display = 'block';
    }
};

// --- VISUAL DIFF COMPARISON ENGINE ---
window.renderDiffView = function() {
    document.getElementById('standard-preview-container').style.display = 'none';
    
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
                    <div class="diff-container" style="padding: 1.5rem; margin-bottom: 2rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-left: 3px solid #a855f7; box-shadow: 4px 4px 0px var(--manga-shadow);">
                        <h3 class="diff-section-title" style="color: #a855f7; border-bottom: 1px dashed #333; padding-bottom: 0.5rem; margin-top:0;">${sectionName.toUpperCase()}</h3>
                        <div id="diff-inline-${safeId}" style="width: 100%;"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks);
                });
            } else {
                diffContainer.innerHTML += `
                    <div class="diff-container" style="padding: 1.5rem; margin-bottom: 2rem; background: var(--bg-secondary); border: 2px solid var(--border-color); box-shadow: 6px 6px 0px var(--manga-shadow);">
                        <h3 class="diff-section-title" style="color: #a855f7; border-bottom: 1px dashed #333; padding-bottom: 0.5rem; margin-top:0;">${sectionName.toUpperCase()}</h3>
                        <div style="border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.05); padding: 1rem; margin-bottom: 0.5rem;">
                            <div style="color: #ef4444; font-family: var(--text-mono); font-size: 0.7rem; font-weight: bold; margin-bottom: 1rem;">[-] LIVE CLOUD DATA</div>
                            <pre style="font-family:var(--text-mono); font-size:0.65rem; color:#fca5a5; margin:0;">${JSON.stringify(oldData, null, 2)}</pre>
                        </div>
                        <div style="border: 1px solid #22c55e; background: rgba(34, 197, 94, 0.05); padding: 1rem;">
                            <div style="color: #22c55e; font-family: var(--text-mono); font-size: 0.7rem; font-weight: bold; margin-bottom: 1rem;">[+] SUGGESTED REVISION</div>
                            <pre style="font-family:var(--text-mono); font-size:0.65rem; color:#86efac; margin:0;">${JSON.stringify(newData, null, 2)}</pre>
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
    compareArrayOfObjects('Counterplay Topic', window.originalCloudDescData.counterplay, window.currentEditorDescData.counterplay, 'topic', 'blocks');

    const oldStrats = window.originalCloudDescData.moveStrategies || {};
    const newStrats = window.currentEditorDescData.moveStrategies || {};
    Array.from(new Set([...Object.keys(oldStrats), ...Object.keys(newStrats)])).forEach(k => { 
        compareAndRender(`Move Strategy: ${k}`, oldStrats[k], newStrats[k], 'blocks'); 
    });

    compareArrayOfObjects('Frame Data (M1)', window.originalCloudFrameData.m1s, window.currentEditorFrameData.m1s, 'id', 'json');
    compareArrayOfObjects('Frame Data (Skill)', window.originalCloudFrameData.skills, window.currentEditorFrameData.skills, 'id', 'json');
    compareArrayOfObjects('Frame Data (Special)', window.originalCloudFrameData.specials, window.currentEditorFrameData.specials, 'id', 'json');

    if (!changesFound) diffContainer.innerHTML += `<p style="color:var(--text-muted); font-style:italic; border: 1px dashed #333; padding: 2rem; text-align: center;">No changes detected against the live database.</p>`;

    diffRenderQueue.forEach(fn => fn());
    if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
};

// --- LOCAL DRAFT MANAGER HUB ---
window.openDraftManager = function() {
    const container = document.getElementById('draft-list-container');
    const drafts = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('wiki_draft_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                const charId = data.charId || key.replace('wiki_draft_', '').split('_')[0];
                const tabId = data.tabId || 'overview';
                const moveId = data.moveId || '';
                drafts.push({ key, charId, tabId, moveId, timestamp: data.timestamp });
            } catch(e) {}
        }
    }

    drafts.sort((a, b) => b.timestamp - a.timestamp);

    if (drafts.length === 0) {
        container.innerHTML = '<div style="color: #666; font-family: var(--text-mono); font-size: 0.8rem; text-align: center; padding: 2rem 0; border: 1px dashed #333;">No local drafts found. Your workspace is clean!</div>';
    } else {
        let html = '';
        drafts.forEach(draft => {
            const dateStr = new Date(draft.timestamp).toLocaleString();
            const charDisplay = draft.charId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            
            let contextDisplay = draft.tabId.toUpperCase();
            if (draft.moveId) contextDisplay += ` / ${draft.moveId.toUpperCase()}`;
            
            const currentTab = window.currentEditorTabId || 'overview';
            let currentMove = new URLSearchParams(window.location.search).get('move') || '';
            if (!currentMove) {
                const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                if (activeBtn && activeBtn.id.startsWith('move-nav-')) currentMove = activeBtn.id.replace('move-nav-', '');
            }
            
            const isCurrent = (window.currentEditorCharId === draft.charId) && (currentTab === draft.tabId) && (currentMove === draft.moveId);
            
            let resumeUrl = `?char=${draft.charId}&tab=${draft.tabId}&loadDraft=true&draftKey=${draft.key}`;
            if (draft.moveId) resumeUrl += `&move=${draft.moveId}`;

            // --- DRAFT UI ---
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #050505; border: 1px solid #333; padding: 1rem; margin-bottom: 0.5rem; border-left: 3px solid var(--accent-blue);">
                    <div>
                        <div style="color: var(--accent-blue); font-family: 'CC-Wild-Words', sans-serif; font-size: 0.9rem; text-transform: uppercase; margin-bottom: 0.25rem;">DRAFT ${drafts.length - drafts.indexOf(draft)}</div>
                        <div style="color: #fff; font-family: var(--text-mono); font-size: 0.8rem; margin-bottom: 0.25rem; font-weight: bold;">${charDisplay} <span style="color: #888; font-weight: normal;">— [ ${contextDisplay} ]</span></div>
                        <div style="color: #666; font-family: var(--text-mono); font-size: 0.65rem;">Last Auto-Saved: ${dateStr}</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        ${!isCurrent ? 
                            `<button class="submit-btn" style="color: var(--accent-blue); border-color: var(--accent-blue); padding: 0.4rem 0.8rem; font-size: 0.65rem; box-shadow: none;" onclick="window.location.href='${resumeUrl}'">RESUME</button>` : 
                            `<span style="color: #22c55e; font-family: var(--text-mono); font-size: 0.65rem; padding: 0.4rem 0.8rem; border: 1px solid #22c55e;">CURRENTLY ACTIVE</span>`
                        }
                        <button class="btn-action-delete" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 0.4rem 0.8rem; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.65rem; cursor: pointer;" onclick="window.deleteDraft('${draft.key}')">DISCARD</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    document.getElementById('draft-manager-modal').style.display = 'flex';
};

window.deleteDraft = async function(key) {
    if (await window.customConfirm("Permanently discard this local draft? This cannot be undone.", "DISCARD DRAFT", true)) {
        localStorage.removeItem(key);
        window.openDraftManager(); 
    }
};

// =====================================================================
// V0.4 DYNAMIC SYSTEM PAGE ENGINE
// =====================================================================

window.renderSystemEditor = function(container) {
    let descData = window.currentEditorDescData;
    if (!descData.tabs || descData.tabs.length === 0) {
        descData.tabs = [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'New Section', layout: 'full', blocks: [] }] }];
    }
    
    // 1. RENDER MAIN TABS
    let tabHTML = `<div class="daw-variant-tabs" style="margin-bottom: 0.5rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center;">`;
    descData.tabs.forEach((tab, tIdx) => {
        let active = tIdx === window.currentSystemTabIdx ? 'active' : '';
        tabHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
        tabHTML += `<button class="daw-tab-btn ${active}" onclick="window.switchSystemTab(${tIdx})" style="padding-right: 1.5rem;">${tab.tabLabel}</button>`;
        tabHTML += `<button onclick="window.removeSystemTab(${tIdx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Delete Tab">✖</button>`;
        tabHTML += `</div>`;
    });
    tabHTML += `<button class="daw-tab-btn btn-sys btn-sys-green" style="font-size: 0.65rem;" onclick="window.addSystemTab()">+ ADD TAB</button>`;
    tabHTML += `</div>`;

    let activeTab = descData.tabs[window.currentSystemTabIdx];
    if (!activeTab) { container.innerHTML = tabHTML; return; }

    // 2. RENDER SECTIONS WITHIN ACTIVE TAB
    let secHTML = `<div class="daw-variant-tabs" style="margin-bottom: 1rem; overflow-x: auto; padding-bottom: 0; border-bottom: 1px solid #333; display: flex; align-items: center; background: rgba(0,0,0,0.2);">`;
    if (!activeTab.sections) activeTab.sections = [];
    activeTab.sections.forEach((sec, sIdx) => {
        let active = sIdx === window.currentSystemSecIdx ? 'active' : '';
        secHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
        secHTML += `<button class="daw-tab-btn ${active}" onclick="window.switchSystemSection(${sIdx})" style="padding-right: 1.5rem; font-size: 0.7rem; color: #a855f7;">${sec.sectionTitle || 'Section ' + (sIdx+1)}</button>`;
        secHTML += `<button onclick="window.removeSystemSection(${sIdx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Delete Section">✖</button>`;
        secHTML += `</div>`;
    });
    secHTML += `<button class="daw-tab-btn btn-sys btn-sys-purple" style="font-size: 0.65rem;" onclick="window.addSystemSection()">+ ADD SECTION</button>`;
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
            <div class="block-editor-container" style="margin-top: 0; margin-bottom: 1rem;">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">LAYOUT & METADATA</span></div>
                    <div class="editor-row">
                        <div>
                            <label style="font-size:0.65rem; color:#888;">Tab Name (Navigation)</label>
                            <input type="text" class="editor-input" value="${activeTab.tabLabel}" oninput="window.updateSystemMeta('tabLabel', this.value)">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#888;">Section Title (Header)</label>
                            <input type="text" class="editor-input" value="${activeSec.sectionTitle}" oninput="window.updateSystemMeta('sectionTitle', this.value)">
                        </div>
                    </div>
                    <div class="editor-row" style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed #333;">
                        <div>
                            <label style="font-size:0.65rem; color:#888;">Width (%)</label>
                            <input type="number" class="editor-input" min="10" max="100" step="5" value="${secWidth}" oninput="window.updateSystemMeta('width', this.value, false, true)">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#888;">Alignment</label>
                            <select class="editor-select" onchange="window.updateSystemMeta('alignment', this.value)">
                                <option value="left" ${secAlign==='left'?'selected':''}>Left</option>
                                <option value="center" ${secAlign==='center'?'selected':''}>Center</option>
                                <option value="right" ${secAlign==='right'?'selected':''}>Right</option>
                            </select>
                        </div>
                        <div style="display:flex; align-items:center;">
                            <label style="color:var(--text-muted); font-size:0.85rem; margin:0; cursor:pointer;">
                                <input type="checkbox" onchange="window.updateSystemMeta('forceBreak', this.checked, true)" ${secBreak ? 'checked' : ''} style="margin-right: 0.25rem;"> 
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