// --- EDITOR SYSTEM ---
window.editorAlert = function(message) {
    const modal = document.getElementById('editor-alert-modal');
    document.getElementById('editor-alert-msg').textContent = message;
    modal.classList.remove('hidden');
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

// applyDeltaToData is defined once, in site_utils.js (loaded before this file).
// diffTextLCS, triggerManualSync, updateLivePreview, toggleDiffMode, and
// renderDiffView all moved to js/editor-sync.js.

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
    window.currentGlobalUserId = null;
    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session && session.user) {
            window.currentGlobalUsername = typeof window.getDisplayName === 'function'
                ? window.getDisplayName(session)
                : session.user.email.split('@')[0];
            window.currentGlobalUserId = session.user.id;
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
    fakeTitle.classList.add('hidden');
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
    if (targetPreviewTab) targetPreviewTab.classList.remove('hidden');

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

            // Scoped per-character, not per-tab/move - window.currentEditorDescData
            // is always the FULL character object regardless of which tab/move is
            // active, so a per-tab/move key just created a new, never-cleaned-up
            // localStorage entry every time the user switched tabs within one
            // session (fixed 2026-08-02 - see js/editor-drafts.js saveLocalDraft).
            const defaultDraftKey = `wiki_draft_${pageId}`;

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
                        const restore = await window.customConfirm(`An unsaved local draft was found for this character.\n\nDo you want to restore your local progress, or load the live cloud version?`, "RESTORE DRAFT", false);
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
            titleEl.innerHTML = `<span class="editor-intercept-label">Intercepting Submission</span>`;
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
                overlay.className = 'editor-modal-overlay qa-modal-elevated';
                document.body.appendChild(overlay);
            }

            let currentForm = 'short'; 
            
            const renderForm = () => {
                let formHtml = '';
                let modalWidth = '400px';

                const tabsHtml = `
                    <div class="qa-tabs-row">
                        <button class="btn-sys ${currentForm === 'short' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-short">Short</button>
                        <button class="btn-sys ${currentForm === 'long' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-long">Long</button>
                        <button class="btn-sys ${currentForm === 'technical' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-technical">Technical</button>
                    </div>
                `;

                if (currentForm === 'short') {
                    formHtml = `
                        <label class="qa-field-label">CHANGELOG SUMMARY (Max 50 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-short" placeholder="Briefly describe what you changed..."></textarea>
                        <label class="qa-field-label qa-field-label-spaced">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'long') {
                    modalWidth = '600px';
                    formHtml = `
                        <label class="qa-field-label">DETAILED CHANGELOG (Max 500 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-long" placeholder="Provide a detailed explanation of your edits, reasoning, and context..."></textarea>
                        <label class="qa-field-label qa-field-label-spaced">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'technical') {
                    modalWidth = '600px';
                    formHtml = `
                        <div class="qa-field-row">
                            <div class="qa-field-col">
                                <label class="qa-field-label">CONFIDENCE LEVEL</label>
                                <select id="qa-confidence" class="editor-select">
                                    <option value="N/A">N/A</option>
                                    <option value="High">High - 100% Certain (Tested in-game/files)</option>
                                    <option value="Medium">Medium - Fairly Confident</option>
                                    <option value="Low">Low - Guessing / Needs verification</option>
                                </select>
                            </div>
                            <div class="qa-field-col">
                                <label class="qa-field-label">SOURCE / EVIDENCE (Optional)</label>
                                <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                            </div>
                        </div>
                        <label class="qa-field-label">TECHNICAL CHANGELOG</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-long" placeholder="Detail frame data changes, math, hitboxes, or engine mechanics..."></textarea>
                    `;
                }

                overlay.innerHTML = `
                    <div class="editor-modal-box auth-modal-box qa-modal-box" style="max-width: ${modalWidth};">
                        <div class="auth-header">
                            <h3 class="qa-modal-title">QUALITY ASSURANCE</h3>
                        </div>
                        <div class="auth-body">
                            ${tabsHtml}
                            <div id="qa-form-container" class="qa-form-container">
                                ${formHtml}
                            </div>
                        </div>
                        <div class="editor-modal-actions qa-modal-actions-divided">
                            <button id="btn-qa-cancel" class="system-page-btn">CANCEL</button>
                            <button id="btn-qa-confirm" class="submit-btn">${isIntercept ? 'UPDATE SUBMISSION' : 'CONFIRM & UPLOAD'}</button>
                        </div>
                    </div>
                `;

                overlay.querySelector('#qa-tab-short').onclick = () => { currentForm = 'short'; renderForm(); };
                overlay.querySelector('#qa-tab-long').onclick = () => { currentForm = 'long'; renderForm(); };
                overlay.querySelector('#qa-tab-technical').onclick = () => { currentForm = 'technical'; renderForm(); };

                overlay.querySelector('#btn-qa-cancel').onclick = () => {
                    overlay.classList.add('hidden');
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

                    overlay.classList.add('hidden');
                    resolve({ changelog, confidence, evidence });
                };
            };

            renderForm();
            overlay.classList.remove('hidden');
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
            // Mirrors the server-side check in the pending_revisions RLS policy
            // (supabase/migrations/20260731000000_page_permissions.sql) - this is
            // just UX, the database is the real boundary. Reading from
            // page_permissions instead of a hardcoded array means adding a new
            // restricted page is a table row, not a code change.
            // Selects required_role, not just page_id: as of v0.10 that column
            // actually gates submission (see the "Guests can submit revisions"
            // policy in 20260808000002_page_permissions_writable.sql). This
            // check must mirror the policy exactly - if it is looser the user
            // gets an opaque RLS rejection after filling in the QA modal, and
            // if it is tighter they are blocked from something the database
            // would have allowed.
            const { data: permissionRow } = await window.supabaseClient
                .from('page_permissions').select('page_id, required_role')
                .eq('page_id', pageId.toLowerCase()).maybeSingle();

            if (permissionRow) {
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
                const userRole = (roleData?.role || 'guest').trim().toLowerCase();
                const requiredRole = (permissionRow.required_role || 'trusted_editor').trim().toLowerCase();

                // Admin clears every level; trusted_editor clears only pages
                // asking for trusted_editor.
                const allowed = userRole === 'admin'
                    || (requiredRole === 'trusted_editor' && userRole === 'trusted_editor');

                if (!allowed) {
                    window.editorAlert(requiredRole === 'admin'
                        ? "READ ONLY: This page is restricted to Admins."
                        : "READ ONLY: This is an exclusive systemic page. You require the 'Trusted Editor' or 'Admin' role to submit revisions here.");
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

                // A contributor resuming/editing their own still-pending submission
                // (e.g. from submissions.html) isn't a staff takeover - only wrap
                // the changelog with the "Staff Note" framing when someone other
                // than the original author is the one editing it.
                const isSelfEdit = window.currentGlobalUserId && window.currentGlobalUserId === window.interceptedTicketData.author_id;
                if (isSelfEdit) {
                    payload.qa_metadata.changelog = qaResult.changelog;
                } else {
                    payload.qa_metadata.changelog = `${qaResult.changelog}\n\n(Staff Note: Minor edits applied by ${window.currentGlobalUsername || 'Staff'} prior to approval)\n\nOriginal Contributor Log:\n${oldQa.changelog || 'None'}`;
                }

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
                // Drafts are keyed per-character now (wiki_draft_{pageId}), so
                // there's only ever one possible key to clean up - no need to
                // reconstruct a tab/move-scoped key from DOM state as a fallback
                // when window.currentDraftKey isn't set (simplified 2026-08-02,
                // alongside the draft-key-scoping fix in js/editor-drafts.js).
                localStorage.removeItem(window.currentDraftKey || `wiki_draft_${pageId}`);

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
        } else {
            btnConfirm.className = "submit-btn submit-btn-outline";
        }

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnCancel.removeEventListener('click', onCancel);
            btnConfirm.removeEventListener('click', onConfirm);
        };

        const onCancel = () => { cleanup(); resolve(false); };
        const onConfirm = () => { cleanup(); resolve(true); };

        btnCancel.addEventListener('click', onCancel);
        btnConfirm.addEventListener('click', onConfirm);
    });
};

// --- CUSTOM TAB MANAGEMENT + MOVE ID GATEKEEPER + SUB-NAVIGATION (overview/matchups/counterplay/moves) + PROFILE/PLAYSTYLE: moved to js/editor-tabs.js ---

// --- BLOCK BUILDER STATE + CONTENT BLOCK BUILDER: moved to js/editor-blocks.js ---

// --- LIVE PREVIEW RENDERERS (overview/matchups/counterplay): moved to js/editor-previews.js ---

// --- MASTER MANUAL SYNC + LIVE SYNC & STATE MANAGEMENT + VISUAL DIFF COMPARISON ENGINE: moved to js/editor-sync.js ---

// --- LOCAL AUTO-SAVE ENGINE + LOCAL DRAFT MANAGER HUB: moved to js/editor-drafts.js ---

// --- MEDIA LIBRARY SYSTEM: moved to js/editor-media.js ---

// --- V0.4 DYNAMIC SYSTEM PAGE ENGINE: moved to js/editor-system.js ---
