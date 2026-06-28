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

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Grab the raw parameter first
    const pageIdRaw = urlParams.get('page') || urlParams.get('char'); 
    const pageType = urlParams.get('type') || 'character';
    const tabId = urlParams.get('tab') || 'overview';
    const moveId = urlParams.get('move');

    const titleEl = document.getElementById('editor-title');
    const subTitleEl = document.getElementById('editor-subtitle');

    if (!pageIdRaw || !tabId) {
        titleEl.textContent = "Error: Missing Context";
        subTitleEl.textContent = "Please initiate edits directly from a valid wiki page.";
        return;
    }

    const pageId = pageIdRaw.toLowerCase();
    
    if (pageType === 'system') {
        // Rip out the frame data tabs so system editors don't see them
        document.getElementById('tab-m1s')?.remove();
        document.getElementById('tab-skills')?.remove();
        document.getElementById('tab-specials')?.remove();
    }

    // Use original raw casing purely for visual display in the header
    const pageDisplay = pageIdRaw.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    const targetPreviewTab = document.getElementById(`tab-${tabId}`);
    if (targetPreviewTab) targetPreviewTab.style.display = 'block';

    try {
        // 1. FETCH DATA (Strictly Cloud-First)
        let descData = null;
        let frameData = null;
        
        try {
            let cloudData = null;
            
            // Explicitly ping the live database
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient
                    .from('page_data')
                    .select('*')
                    .eq('page_id', pageId) // Uses our new strict lowercase ID
                    .single();
                    
                if (!error && data) cloudData = data;
            }

            // If desc_data exists, keep it! If frame_data is null, just initialize empty arrays.
            if (cloudData && cloudData.desc_data) {
                console.log(`[Editor] Loaded ${pageId} strictly from Cloud.`);
                descData = cloudData.desc_data;
                frameData = cloudData.frame_data || { m1s: [], skills: [], specials: [] };
            } else {
                console.log(`[Editor] No cloud data found for ${pageId}. Initializing blank template.`);
                descData = {
                    profile: { stats: [], image: "" },
                    overview: [], strategy: [], extras: [],
                    matchups: [], counterplay: [], moveStrategies: {}
                };
                frameData = {
                    m1s: [], skills: [], specials: []
                };
            }
            
            // --- SNAPSHOT ORIGINAL CLOUD STATE FOR DIFFING ---
            window.originalCloudDescData = JSON.parse(JSON.stringify(descData));
            window.originalCloudFrameData = JSON.parse(JSON.stringify(frameData));
            window.isDiffModeActive = false;
            
            window.cachedMasterFrameData = window.cachedMasterFrameData || {};
            window.cachedMasterFrameData[pageId] = frameData;
            
        } catch (e) {
            console.error("Failed to initialize editor data:", e);
            window.editorAlert("Critical Error loading page data. Check console.");
            return;
        }

        // 2. BUILD THE PREVIEW DOM 
        if (['m1s', 'skills', 'specials'].includes(tabId) && typeof window.loadMoveSection === 'function') {
            // Find which move to isolate in the preview on boot
            let activeMoveId = moveId; 
            if (!activeMoveId && frameData && frameData[tabId] && frameData[tabId].length > 0) {
                activeMoveId = frameData[tabId][0].id;
            }
            // FIX 5: Pass the pageType into the move renderer
            try { await window.loadMoveSection(pageId, tabId, activeMoveId, pageType); } catch(e) { console.warn("Move section build skipped:", e); }
        }
        
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(pageId, pageType);
        }

        // 3. ROUTE TO THE CORRECT EDITOR
        window.currentEditorTabId = tabId;
        window.currentEditorCharId = pageId; 
        
        // SECURITY PATCH
        window.currentEditorDescData = descData;
        window.currentEditorFrameData = frameData;

        if (moveId) {
            titleEl.textContent = `Editing Move`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId} / ${moveId}`;
            
            const moveStats = frameData ? frameData[tabId]?.find(m => m.id === moveId) : null;
            const moveStrats = descData ? descData.moveStrategies?.[moveId] : null;
            
            initPerMoveEditor(moveId, moveStats, moveStrats);
            
            setTimeout(() => {
                const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
                if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        } else {
            titleEl.textContent = `Editing Section`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId}`;
            initFullTabEditor(pageId, tabId, descData, frameData);
        }

    } catch (error) {
        console.error("Editor failed to initialize context:", error);
        titleEl.textContent = "System Error";
        subTitleEl.textContent = "Check browser console for detailed logs.";
    }

    // --- SUBMIT PAYLOAD & QA PIPELINE ---
    const submitBtn = document.getElementById('submit-payload-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            
            // 1. Check global client
            if (!window.supabaseClient) {
                window.editorAlert("Database connection is offline!");
                return;
            }

            // 2. Ask Supabase if we have a valid logged-in session token
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) {
                window.openAuthModal();
                return; 
            }

            // --- TIERED STAFF PROTECTION ---
            // If the user is trying to edit the master template, check their clearance
            if (pageId.toLowerCase() === 'template' || pageId.toLowerCase() === 'tierlist') {
                
                // Use maybeSingle() to prevent hard crashes if 0 rows are found
                const { data: roleData, error: roleError } = await window.supabaseClient
                    .from('user_roles')
                    .select('role')
                    .eq('user_id', session.user.id)
                    .maybeSingle(); 
                    
                if (roleError) {
                    console.error("[Auth Debug] Supabase Fetch Error:", roleError);
                }
                
                // Aggressively sanitize the database string to strip accidental spaces or caps
                const rawRole = roleData?.role || 'guest';
                const userRole = rawRole.trim().toLowerCase(); 
                
                if (userRole !== 'admin') {
                    window.editorAlert("READ ONLY: This is a core systemic page. You may explore the editor tools, but you lack the administrative clearance to submit revisions to this document.");
                    return; // Hard stop
                }
            }

            // 3. FRONTEND RATE LIMITING LOGIC (3 Minutes)
            const COOLDOWN_MINUTES = 3; 
            const lastSubmitTime = localStorage.getItem('wiki_last_submit_time');
            if (lastSubmitTime) {
                const timeSinceLastSubmit = Date.now() - parseInt(lastSubmitTime, 10);
                const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
                
                if (timeSinceLastSubmit < cooldownMs) {
                    const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSubmit) / 1000);
                    const remainingMins = Math.floor(remainingSeconds / 60);
                    const remSecs = remainingSeconds % 60;
                    window.editorAlert(`Anti-Spam: Please wait ${remainingMins}m ${remSecs}s before submitting another revision.`);
                    return;
                }
            }

            // 4. Force a final sync to catch any typing that hasn't auto-saved
            if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

            // 5. Open the QA Modal Instead of Immediately Submitting
            document.getElementById('qa-modal-overlay').style.display = 'flex';
        });
    }

    // --- EXECUTE FINAL UPLOAD FROM QA MODAL ---
    const qaConfirmBtn = document.getElementById('btn-qa-confirm-submit');
    if (qaConfirmBtn) {
        qaConfirmBtn.addEventListener('click', async () => {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) return; // Failsafe

            // Gather QA Data
            const changelog = document.getElementById('qa-changelog').value.trim();
            const confidence = document.getElementById('qa-confidence').value;
            const evidence = document.getElementById('qa-evidence').value.trim();

            if (!changelog) {
                window.editorAlert("Please provide a brief changelog/summary of your edits.");
                return;
            }

            qaConfirmBtn.textContent = "UPLOADING...";
            qaConfirmBtn.disabled = true;

            // Package the payloa
            const payload = {
                page_id: pageId,
                page_type: pageType,
                desc_data: window.currentEditorDescData,
                frame_data: pageType === 'system' ? null : window.currentEditorFrameData,
                author_id: session.user.id,
                author_name: window.currentGlobalUsername || "Contributor",
                qa_metadata: {
                    changelog: changelog,
                    confidence: confidence,
                    evidence: evidence
                }
            };

            console.log("Pushing to Revision Queue...", payload);

            // INJECT TO WAITING ROOM
            const { data, error } = await window.supabaseClient
                .from('pending_revisions')
                .insert([payload]);

            qaConfirmBtn.disabled = false;
            qaConfirmBtn.textContent = "CONFIRM & UPLOAD";

            if (error) {
                console.error("Supabase Error:", error);
                window.editorAlert("Failed to save to database: " + error.message);
            } else {
                document.getElementById('qa-modal-overlay').style.display = 'none';
                
                // Visual Success Feedback on the Main Editor Button
                const fallbackText = "Submit to Queue";
                submitBtn.textContent = "SAVED TO CLOUD!";
                submitBtn.style.backgroundColor = "#22c55e"; 
                submitBtn.style.color = "#000";
                
                // Record the Anti-Spam Cooldown Time
                localStorage.setItem('wiki_last_submit_time', Date.now().toString());
                
                // Reset the QA form for the next edit
                document.getElementById('qa-changelog').value = '';
                document.getElementById('qa-evidence').value = '';
                document.getElementById('qa-confidence').value = 'medium';

                setTimeout(() => {
                    submitBtn.textContent = fallbackText;
                    submitBtn.style.backgroundColor = "";
                    submitBtn.style.color = "";
                }, 3000);
            }
        });
    }
});

// --- DYNAMIC PATH RESOLUTION ---
async function fetchCharacterData(charId) {
    const root = window.getRootPath();
    const path = `${root}characters/${charId}/`;
    
    // Allow failures to return null gracefully instead of crashing the editor
    let descData = null;
    let frameData = null;
    
    if (typeof window.fetchJson === 'function') {
        try { descData = await window.fetchJson(`${path}${charId}_descriptions.json`); } catch(e) {}
        try { frameData = await window.fetchJson(`${path}${charId}_framedata.json`); } catch(e) {}
    }
    
    return { descData, frameData };
}

// --- CUSTOM MODAL ENGINE ---
window.customConfirm = function(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('editor-custom-modal');
        const textEl = document.getElementById('editor-modal-text');
        const btnCancel = document.getElementById('editor-modal-cancel');
        const btnConfirm = document.getElementById('editor-modal-confirm');

        textEl.textContent = message;
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
window.addExtraTab = function() {
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: "New Tab", content: [] });
    
    if(typeof renderFullOverviewPreview === 'function') renderFullOverviewPreview();
    initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    loadOverviewSectionIntoEditor(`extra-${window.currentEditorDescData.extras.length - 1}`);
};

window.removeExtraTab = async function(idx) {
    if (await window.customConfirm("Delete this custom tab and all its contents?")) {
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
        navHTML += `<button class="daw-tab-btn btn-action-add" style="font-size: 0.65rem;">+ ADD MOVE</button>`;
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
        navHTML += `<button class="daw-tab-btn" id="overview-nav-strategy" onclick="loadOverviewSectionIntoEditor('strategy')">General Strategy</button>`;
        
        window.currentEditorDescData.extras.forEach((ext, idx) => {
            navHTML += `<div style="display:inline-flex; align-items:center; position:relative; margin-bottom: -1px;">`;
            navHTML += `<button class="daw-tab-btn" id="overview-nav-extra-${idx}" onclick="loadOverviewSectionIntoEditor('extra-${idx}')" style="padding-right: 1.5rem;">${ext.title}</button>`;
            navHTML += `<button onclick="removeExtraTab(${idx})" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; color:#ef4444; font-size:10px; cursor:pointer;" title="Remove Tab">✖</button>`;
            navHTML += `</div>`;
        });

        navHTML += `<button class="daw-tab-btn btn-action-add" style="font-size: 0.65rem; onclick="addExtraTab()">+ ADD TAB</button>`;
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
        navHTML += `<button class="daw-tab-btn btn-action-add" style="font-size: 0.65rem; onclick="window.addMatchup()">+ ADD MATCHUP</button>`;
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
        navHTML += `<button class="daw-tab-btn btn-action-add" style="font-size: 0.65rem; onclick="window.addCounterplayTopic()">+ ADD TOPIC</button>`;
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
        // Standard single-block sections
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

window.removeMove = async function(moveId) {
    if (await window.customConfirm("Delete this entire move (stats, frame data, and strategy)?")) {
        const tabId = window.currentEditorTabId;
        const arr = window.currentEditorFrameData[tabId];
        const idx = arr.findIndex(m => m.id === moveId);
        if (idx > -1) arr.splice(idx, 1);
        
        // Also cleanup the text strategy block so it doesn't leave ghost data in the DB
        if (window.currentEditorDescData.moveStrategies && window.currentEditorDescData.moveStrategies[moveId]) {
            delete window.currentEditorDescData.moveStrategies[moveId];
        }
        
        initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
    }
};

// --- SUB-NAVIGATION: OVERVIEW ---
window.loadOverviewSectionIntoEditor = function(sectionId) {
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
        renderFullOverviewPreview(); // FIX: Trigger load sync instantly!
        
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
    renderFullOverviewPreview(); // FIX: Initial preview render on switch!
    
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
window.addMatchup = function() {
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
window.addCounterplayTopic = function() {
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
    // SECURITY PATCH: Only force save if we are ACTUALLY switching between two different moves!
    const oldActiveBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
    if (oldActiveBtn && window.currentEditorDescData) {
        const oldMoveId = oldActiveBtn.id.replace('move-nav-', '');
        
        // Prevent empty-array overwrites on initial page boot
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
    
    // CRITICAL FIX: Automatically sync and isolate the preview when switching moves
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

    // Tracks the hierarchical depth: e.g. ['hit', 'counter_hit']
    let activePath = [];
    let firstKey = Object.keys(moveData.variants)[0];
    if (firstKey) activePath = [firstKey];
    
    let selectedBarIdx = null;
    let selectedPhaseIdx = null;

    // Safely retrieves the exact nested object based on activePath
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
                        <div><input type="text" class="editor-input meta-inp" data-field="type" value="${moveData.type || ''}" placeholder="Type (e.g. Basic Attack)"></div>
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

        // --- RECURSIVE VARIANT TAB BUILDER ---
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
                                <button onclick="window.addDawPhase(${bIdx})" class="add-block-btn btn-action-add" style="margin:0;" title="Add Phase">+</button>
                                <button onclick="window.deleteDawTrack(${bIdx})" class="add-block-btn btn-action-delete" style="margin:0; padding: 0.25rem 0.5rem;" title="Delete Track">✖</button>
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
                
                // Define our allowed overlays
                const overlayOptions = [
                    { id: 'iframe-complete', label: 'Complete I-Frames' },
                    { id: 'iframe-melee', label: 'Melee I-Frames' },
                    { id: 'iframe-bullet', label: 'Bullet I-Frames' },
                    { id: 'iframe-explosion', label: 'Explosion I-Frames' },
                    { id: 'iframe-swarm', label: 'Swarm I-Frames' },
                    { id: 'reverse-hitcancel', label: 'Reverse Hitcancel' }
                ];

                // Generate the checkboxes
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
                            <button onclick="window.deleteDawPhase()" class="add-block-btn btn-action-delete" style="color:#ef4444; border-color:#222;">✖ DELETE PHASE</button>
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
                            <button onclick="window.deleteDawVariant()" class="add-block-btn btn-action-delete" style="color:#ef4444; border-color:#ef4444;" title="Delete this Variant completely">✖ DELETE</button>
                            <button onclick="window.addDawTrack()" class="add-block-btn" style="color:var(--accent-blue); border-color:var(--accent-blue);">+ Add Track</button>
                        </div>
                    </div>
                    <div class="daw-timeline-wrapper">
                        ${tracksHtml}
                    </div>
                    ${inspectorHtml}
                </div>
            `;
        } else if (hasVariants) {
            // Locks out timeline creation if this is a parent branch
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
            // This variant exists but is completely empty (no bars, no sub-variants)
            dawHtml = `
                <div class="daw-container" style="text-align: center; padding: 3rem 1rem;">
                    
                    <div style="display: flex; justify-content: center; margin-bottom: 1.5rem;">
                        <input type="text" class="editor-input" style="max-width: 250px; text-align: center; font-size: 0.9rem;" placeholder="Variant Name" id="daw-variant-label" value="${currentObj.label || ''}">
                    </div>

                    <p style="color:var(--text-muted); font-family:var(--text-mono); margin-bottom:1.5rem;">This variant is currently empty.</p>
                    <div style="display:flex; gap:1rem; justify-content:center;">
                        <button onclick="window.initDawLeaf()" class="submit-btn" style="max-width:200px;">Initialize Timeline</button>
                        <button onclick="window.initDawBranch()" class="system-page-btn" style="max-width:200px;">Create Sub-Variants</button>
                        <button onclick="window.deleteDawVariant()" class="add-block-btn" style="color:#ef4444; border-color:#ef4444;">Delete Variant</button>
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

        // Bindings targeting the currently viewed node
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
        const inspLegend = container.querySelector('#insp-legend'); // <-- New Hook

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
                
                // Clean up the array if it's completely empty
                if (phase.overlays.length === 0) delete phase.overlays;
                
                renderDaw();
            });
        });
    }

    // Global DAW Navigation Mutators
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
    
    const renderProfileForm = () => {
        let statsHtml = '';
        profileData.stats.forEach((stat, idx) => {
            statsHtml += `
                <div class="editor-row" style="margin-bottom: 0.25rem;">
                    <div><input type="text" class="editor-input stat-label" data-idx="${idx}" value="${stat.label}" placeholder="Label (e.g. Archetype)"></div>
                    <div><input type="text" class="editor-input stat-val" data-idx="${idx}" value="${stat.value}" placeholder="Value (e.g. M1 Merchant)"></div>
                    <button class="add-block-btn btn-action-delete btn-del-stat" data-idx="${idx}" style="padding: 0.3rem 0.5rem;" title="Remove Stat">✖</button>
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
                        <button class="add-block-btn" id="btn-add-stat" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">+ ADD STAT</button>
                    </div>
                    <div id="profile-stats-container">${statsHtml}</div>
                </div>
            </div>
        `;

        container.querySelector('#profile-image-input').addEventListener('input', (e) => {
            profileData.image = e.target.value;
            window.currentEditorDescData.profile = profileData;
        });

        container.querySelectorAll('.stat-label').forEach(inp => {
            inp.addEventListener('input', (e) => {
                profileData.stats[e.target.dataset.idx].label = e.target.value;
                window.currentEditorDescData.profile = profileData;
            });
        });

        container.querySelectorAll('.stat-val').forEach(inp => {
            inp.addEventListener('input', (e) => {
                profileData.stats[e.target.dataset.idx].value = e.target.value;
                window.currentEditorDescData.profile = profileData;
            });
        });

        container.querySelectorAll('.btn-del-stat').forEach(btn => {
            btn.addEventListener('click', (e) => {
                profileData.stats.splice(e.target.dataset.idx, 1);
                window.currentEditorDescData.profile = profileData;
                renderProfileForm();
            });
        });

        container.querySelector('#btn-add-stat').addEventListener('click', () => {
            profileData.stats.push({ label: 'New Stat', value: 'Value' });
            window.currentEditorDescData.profile = profileData;
            renderProfileForm();
        });
    };

    renderProfileForm();
}

// --- BLOCK BUILDER STATE ---
let currentStrategyBlocks = [];
let blockHistory = [];
let historyIndex = -1;

window.saveBlockHistory = function() {
    const newStateStr = JSON.stringify(currentStrategyBlocks);
    
    // Prevent saving consecutive duplicate states (e.g., on boot)
    if (historyIndex >= 0 && JSON.stringify(blockHistory[historyIndex]) === newStateStr) return; 
    
    // If we undo'd and then make a new change, snip the future redo timeline
    if (historyIndex < blockHistory.length - 1) {
        blockHistory = blockHistory.slice(0, historyIndex + 1);
    }
    
    blockHistory.push(JSON.parse(newStateStr));
    
    // Keep a maximum of 50 history steps to prevent memory lag
    if (blockHistory.length > 50) blockHistory.shift(); 
    else historyIndex++;
    
    if (typeof window.updateHistoryButtons === 'function') window.updateHistoryButtons();
};

document.addEventListener('keydown', (e) => {
    // Ignore custom shortcuts if user is natively typing in a text field
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
    // 1. Grab the raw template
    const newBlock = JSON.parse(JSON.stringify(blockTemplates[type]));
    
    // 2. If the block has an author field, AND a user is logged in, auto-fill it!
    if (newBlock.author !== undefined && window.currentGlobalUsername && window.currentGlobalUsername !== "Anonymous") {
        newBlock.author = window.currentGlobalUsername;
    }
    
    return newBlock;
};

// 1. Added the missing templates
const blockTemplates = {
    heading: { type: 'heading', content: 'New Heading', align: 'left', size: 'h3' },
    paragraph: { type: 'paragraph', content: 'Write your strategy here...', align: 'left' },
    list: { type: 'list', items: ['List item 1', 'List item 2'], align: 'left', author: '' },
    image: { type: 'image', src: '', alt: 'Image description', caption: '', align: 'center', width: '75%' },
    video: { type: 'video', src: '', align: 'center', width: '75%', controls: false }, 
    youtube: { type: 'youtube', videoId: '', align: 'center', width: '75%' },
    callout: { type: 'callout', intent: 'info', title: 'Note', content: 'Important detail here', align: 'center' },
    combo: { type: 'combo', sequence: ['M1', 'M1', 'Skill'], damage: '0', align: 'left', note: '', author: '' },
    accordion: { type: 'accordion', title: 'Collapsible Section', content: [{ type: 'paragraph', content: ['Hidden text...'] }], align: 'center', author: '' },
    divider: { type: 'divider', invisible: false },
    author: { type: 'author', author: '' },
    table: { type: 'table', headers: ['Stat', 'Value'], rows: [['Damage', '10'], ['Startup', '5f']], align: 'center', author: '' },
};

function initStrategyBlockBuilder(containerId, initialData) {
    const container = document.getElementById(containerId);
    currentStrategyBlocks = initialData ? JSON.parse(JSON.stringify(initialData)) : [];
    
    // Reset History on Boot
    blockHistory = [JSON.parse(JSON.stringify(currentStrategyBlocks))];
    historyIndex = 0;

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div>
                <button class="add-block-btn" id="btn-media-library" style="color:var(--accent-blue); border-color:#333;" title="Open Media Manager">📁 MEDIA LIBRARY</button>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="add-block-btn" id="btn-undo" title="Undo (Ctrl+Z)" disabled>⮌ UNDO</button>
                <button class="add-block-btn" id="btn-redo" title="Redo (Ctrl+Y)" disabled>⮎ REDO</button>
                <button class="add-block-btn" id="btn-clear-all" style="color:#ef4444; border-color:#333;" title="Clear All Blocks">✖ CLEAR ALL</button>
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
                    <button class="add-block-btn" data-type="heading" draggable="true">+ Heading</button>
                    <button class="add-block-btn" data-type="paragraph" draggable="true">+ Paragraph</button>
                    <button class="add-block-btn" data-type="table" draggable="true">+ Table</button>
                    <button class="add-block-btn" data-type="list" draggable="true">+ List</button>
                    <button class="add-block-btn" data-type="image" draggable="true">+ Image</button>
                    <button class="add-block-btn" data-type="video" draggable="true">+ Video</button>
                    <button class="add-block-btn" data-type="youtube" draggable="true">+ YouTube</button>
                    <div class="add-block-popup-title" style="margin-top: 0.5rem;">Components</div>
                    <button class="add-block-btn" data-type="callout" draggable="true">+ Callout</button>
                    <button class="add-block-btn" data-type="combo" draggable="true">+ Combo</button>
                    <button class="add-block-btn" data-type="accordion" draggable="true">+ Accordion</button>
                    <button class="add-block-btn" data-type="divider" draggable="true">+ Divider</button>
                    <button class="add-block-btn" data-type="author" draggable="true">+ Author</button>
                </div>
                <button class="submit-btn" id="btn-toggle-add-menu" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 1rem;">
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
            updateLivePreview(true); // Flag: True = Skip saving a duplicate history state!
            window.updateHistoryButtons();
        }
    });

    btnRedo.addEventListener('click', () => {
        if (historyIndex < blockHistory.length - 1) {
            historyIndex++;
            currentStrategyBlocks = JSON.parse(JSON.stringify(blockHistory[historyIndex]));
            renderBlockList();
            updateLivePreview(true); // Flag: True = Skip saving a duplicate history state!
            window.updateHistoryButtons();
        }
    });

    container.querySelector('#btn-clear-all').addEventListener('click', async () => {
        if (currentStrategyBlocks.length > 0 && await window.customConfirm("Delete all blocks in this section?")) {
            currentStrategyBlocks = [];
            renderBlockList();
            updateLivePreview(); // Auto-saves history
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
    // Clears any old observers when navigating between tabs
    if (window.editorBlockObserver) window.editorBlockObserver.disconnect();
    
    window.editorBlockObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            if (entry.isIntersecting) {
                // When scrolling into view: Restore rendering and unlock height
                card.classList.remove('virtual-unloaded');
                card.style.height = ''; 
            } else {
                // When scrolling out of view: Lock the exact pixel height, then unload
                const rect = card.getBoundingClientRect();
                if (rect.height > 50) { 
                    card.style.height = rect.height + 'px';
                    card.classList.add('virtual-unloaded');
                }
            }
        });
    }, { 
        root: document.getElementById('interactive-builder'), 
        // Loads blocks 800px before you actually reach them so you never see them pop in
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

    // --- 2. FORMAT INJECTOR ---
    const formatToolbar = container.querySelector('.format-toolbar');
    
    // Prevents clicking the formatting buttons from stealing focus away from the text area
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
        
        // Handle URL specifically
        if (tag === 'url') {
            const linkTarget = prompt("Enter the URL or relative path:");
            if (!linkTarget) return; // Cancelled
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

    // Standard B/I/U/S/Code logic
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

        // Preset Squares
        colorPopup.addEventListener('click', (e) => {
            const preset = e.target.closest('.color-preset-btn');
            if (preset) {
                applyFormat('color', preset.getAttribute('data-color'));
                colorPopup.style.display = 'none';
            }
        });

        // Custom OS Color Wheel Input
        const customColorInput = container.querySelector('#format-custom-color');
        customColorInput.addEventListener('change', (e) => {
            applyFormat('color', e.target.value);
            colorPopup.style.display = 'none';
        });

        // Click outside to close
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

    // Close menu when clicking outside of it
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-block-menu-wrapper')) {
            popupMenu.classList.remove('active');
        }
    });

    // --- SMART BLOCK CONVERSION ---
    blockList.addEventListener('change', (e) => {
        if (e.target.classList.contains('block-type-selector')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const newType = e.target.value;
            const oldBlock = currentStrategyBlocks[index];

            // 1. Grab a fresh template for the new type
            let newBlock = window.spawnBlockWithAuthor(newType);
            // Preserve the old author if we are just converting the block type
            if (oldBlock.author !== undefined && newBlock.author !== undefined) {
                newBlock.author = oldBlock.author; 
            }
            // 2. Extract existing text safely, regardless of how the old block stored it
            let oldText = "";
            if (oldBlock.content !== undefined && !Array.isArray(oldBlock.content[0])) {
                oldText = Array.isArray(oldBlock.content) ? oldBlock.content.join('\n') : oldBlock.content;
            } else if (oldBlock.items !== undefined) {
                oldText = Array.isArray(oldBlock.items) ? oldBlock.items.join('\n') : oldBlock.items;
            }

            // 3. Inject the text into the new block's correct data structure
            if (oldText) {
                if (newType === 'paragraph' || newType === 'callout') {
                    newBlock.content = oldText.split('\n');
                } else if (newType === 'heading') {
                    newBlock.content = oldText.replace(/\n/g, ' '); // Flatten to single line
                } else if (newType === 'list') {
                    newBlock.items = oldText.split('\n').filter(i => i.trim() !== '');
                } else if (newType === 'accordion') {
                    newBlock.content[0].content = oldText.split('\n');
                }
            }

            // 4. Swap and Sync
            currentStrategyBlocks[index] = newBlock;
            renderBlockList();
            updateLivePreview();
        }
    });

    popupMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-block-btn')) {
            const type = e.target.getAttribute('data-type');
            const newBlock = window.spawnBlockWithAuthor(type);
            currentStrategyBlocks.push(newBlock);
            renderBlockList();
            updateLivePreview();
            popupMenu.classList.remove('active'); // Auto-close
        }
    });

    popupMenu.querySelectorAll('.add-block-btn').forEach(btn => {
        btn.addEventListener('dragstart', (e) => {
            draggedBlockType = e.target.getAttribute('data-type');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', 'toolbar-btn'); 
            popupMenu.classList.remove('active'); // Hide menu while dragging
        });
        btn.addEventListener('dragend', () => {
            draggedBlockType = null;
            blockList.querySelectorAll('.block-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
        });
    });

    // --- DRAG AND DROP PHYSICS ---
    // Only makes the card draggable when actively clicking the grip handle
    blockList.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('drag-handle')) {
            const card = e.target.closest('.block-card');
            if (card) card.setAttribute('draggable', 'true');
        }
    });

    // Strips the draggable attribute the moment you let go of the mouse
    blockList.addEventListener('mouseup', () => {
        blockList.querySelectorAll('.block-card').forEach(c => c.removeAttribute('draggable'));
    });

    blockList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.block-card');
        if(card) {
            // Prevent dragging if interacting with inputs inside the card
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
            // Shows line above or below based on mouse position
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
            c.removeAttribute('draggable'); // Safety cleanup
        });
    });

    blockList.addEventListener('drop', (e) => {
        e.preventDefault();
        const card = e.target.closest('.block-card');
        blockList.querySelectorAll('.block-card').forEach(c => {
            c.classList.remove('drag-over-top', 'drag-over-bottom');
            c.removeAttribute('draggable'); // Safety cleanup
        });

        if (card) {
            let dropIndex = parseInt(card.getAttribute('data-index'));
            const bounding = card.getBoundingClientRect();
            const offset = bounding.y + (bounding.height / 2);
            
            // Drop below if dragged past the center point
            if (e.clientY > offset) dropIndex++; 

            if (draggedBlockType) {
                // 1. Inserted dragged block from Toolbar
                const newBlock = window.spawnBlockWithAuthor(draggedBlockType);
                currentStrategyBlocks.splice(dropIndex, 0, newBlock);
                renderBlockList();
                updateLivePreview();
            } 
            else if (draggedItemIndex !== null) {
                // 2. Reordered existing card
                if (draggedItemIndex < dropIndex) dropIndex--; 
                if (draggedItemIndex !== dropIndex) {
                    const item = currentStrategyBlocks.splice(draggedItemIndex, 1)[0];
                    currentStrategyBlocks.splice(dropIndex, 0, item);
                    renderBlockList();
                    updateLivePreview();
                }
            }
        } else if (draggedBlockType) {
                // Dropped into empty space in the container
                const newBlock = window.spawnBlockWithAuthor(draggedBlockType);
                currentStrategyBlocks.push(newBlock);
                renderBlockList();
                updateLivePreview();
        }
        
        draggedItemIndex = null;
        draggedBlockType = null;
    });

    // Timer to prevent lag while typing
    let typingTimer;

    blockList.addEventListener('input', (e) => {
        // Auto-Expanding Textareas
        if (e.target.classList.contains('editor-textarea')) {
            e.target.style.height = 'auto';
            e.target.style.height = (e.target.scrollHeight) + 'px';
        }

        if (e.target.classList.contains('editor-input') || e.target.classList.contains('editor-textarea') || e.target.classList.contains('editor-select') || e.target.type === 'checkbox' || e.target.classList.contains('table-header-input') || e.target.classList.contains('table-cell-input')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');

            // --- TABLE SPREADSHEET SYNC LOGIC ---
            if (e.target.classList.contains('table-header-input')) {
                const col = parseInt(e.target.getAttribute('data-col'));
                currentStrategyBlocks[index].headers[col] = e.target.value;
                updateLivePreview();
                return; // Stop here for tables
            } 
            if (e.target.classList.contains('table-cell-input')) {
                const row = parseInt(e.target.getAttribute('data-row'));
                const col = parseInt(e.target.getAttribute('data-col'));
                currentStrategyBlocks[index].rows[row][col] = e.target.value;
                updateLivePreview();
                return; // Stop here for tables
            }

            if (field === 'content-array') {
                currentStrategyBlocks[index].content = e.target.value.split('\n');
            } else if (field === 'list-items') {
                currentStrategyBlocks[index].items = e.target.value.split('\n').filter(i => i.trim() !== '');
            } else if (field === 'accordion-text') {
                currentStrategyBlocks[index].content = [{ type: 'paragraph', content: e.target.value.split('\n') }];
            } else if (field === 'combo-sequence') {
                currentStrategyBlocks[index].sequence = e.target.value.split(',').map(s => s.trim());
            } else if (e.target.type === 'checkbox') {
                currentStrategyBlocks[index][field] = e.target.checked;
            } else {
                currentStrategyBlocks[index][field] = e.target.value;
            }

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                updateLivePreview(); // Lightning fast, never touches frame data!
            }, 400); // Waits 400ms after you stop typing
        }
    });

    blockList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        // --- TABLE SPREADSHEET RESIZE LOGIC ---
        if (e.target.classList.contains('btn-table-add-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            const cols = currentStrategyBlocks[index].headers.length;
            currentStrategyBlocks[index].rows.push(new Array(cols).fill(''));
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-add-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            currentStrategyBlocks[index].headers.push('New');
            currentStrategyBlocks[index].rows.forEach(r => r.push(''));
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-row')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (currentStrategyBlocks[index].rows.length > 1) currentStrategyBlocks[index].rows.pop();
            renderBlockList(); updateLivePreview();
        } else if (e.target.classList.contains('btn-table-del-col')) {
            const index = parseInt(e.target.closest('.block-card').getAttribute('data-index'));
            if (currentStrategyBlocks[index].headers.length > 1) {
                currentStrategyBlocks[index].headers.pop();
                currentStrategyBlocks[index].rows.forEach(r => r.pop());
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
            currentStrategyBlocks[index].align = btn.getAttribute('data-val');
            renderBlockList();
            updateLivePreview();
            return;
        }
        
        // The Quick-Insert Paragraph Button
        if (btn.classList.contains('btn-insert-below')) {
            const newBlock = window.spawnBlockWithAuthor('paragraph');
            currentStrategyBlocks.splice(index + 1, 0, newBlock);
            renderBlockList();
            updateLivePreview();
            return;
        }

        if (btn.classList.contains('btn-up') && index > 0) {
            [currentStrategyBlocks[index - 1], currentStrategyBlocks[index]] = [currentStrategyBlocks[index], currentStrategyBlocks[index - 1]];
        } else if (btn.classList.contains('btn-down') && index < currentStrategyBlocks.length - 1) {
            [currentStrategyBlocks[index], currentStrategyBlocks[index + 1]] = [currentStrategyBlocks[index + 1], currentStrategyBlocks[index]];
        } else if (btn.classList.contains('btn-delete')) {
            currentStrategyBlocks.splice(index, 1);
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

    // Helper function to generate alignment icons
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

    currentStrategyBlocks.forEach((block, index) => {
        const card = document.createElement('div');
        card.className = 'block-card';
        card.setAttribute('data-index', index);

        // Generate dropdown options from your templates
            const typeOptions = Object.keys(blockTemplates).map(t => 
                `<option value="${t}" ${block.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`
            ).join('');

            let html = `
                <div class="block-header">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="drag-handle" title="Drag to reorder" style="color: #666; font-size: 1rem; line-height: 1; cursor: grab;">⠿</span>
                        <select class="block-type-badge block-type-selector" style="cursor: pointer; border: none; outline: none; padding-right: 0.2rem;">
                            ${typeOptions}
                        </select>
                    </div>
                <div class="block-actions">
                    <button class="btn-insert-below" style="color:#34d399; font-size:0.85rem;" title="Insert Paragraph Below">⨁</button>
                    <button class="btn-collapse" title="Minimize/Expand">—</button>
                    <button class="btn-up" title="Move Up">▲</button>
                    <button class="btn-down" title="Move Down">▼</button>
                    <button class="btn-delete btn-action-delete" title="Delete">✖</button>
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
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 50%)"></div>
                </div>
                <label style="color:var(--text-muted); font-size:0.85rem;"><input type="checkbox" data-field="controls" ${block.controls ? 'checked' : ''}> Show Video Controls</label>
            `;
        }
        else if (block.type === 'youtube') {
            html += `
                <input type="text" class="editor-input" data-field="videoId" value="${block.videoId || ''}" placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)">
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="width" value="${block.width || '100%'}" placeholder="Width (e.g. 75%)"></div>
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
            
            // Build Headers
            tableHTML += `<tr>`;
            block.headers.forEach((h, c) => {
                tableHTML += `<td><input type="text" class="editor-input table-header-input" data-col="${c}" value="${h}" placeholder="Header" style="margin:0; border-radius:0; border:none; border-bottom: 2px solid #444; border-right: 1px solid #333; font-weight: bold; background: rgba(0,0,0,0.4); text-align: center;"></td>`;
            });
            tableHTML += `</tr>`;
            
            // Build Rows
            block.rows.forEach((r, rIdx) => {
                tableHTML += `<tr>`;
                r.forEach((cell, cIdx) => {
                    tableHTML += `<td><input type="text" class="editor-input table-cell-input" data-row="${rIdx}" data-col="${cIdx}" value="${cell}" placeholder="..." style="margin:0; border-radius:0; border:none; border-bottom: 1px solid #222; border-right: 1px solid #333;"></td>`;
                });
                tableHTML += `</tr>`;
            });
            tableHTML += `</table></div>`;
            
            // Build Controls
            html += `
                ${tableHTML}
                <div style="display:flex; gap:0.25rem; margin-bottom: 0.5rem; border-radius: 0rem">
                    <button class="add-block-btn btn-table-add-row" style="flex:1; border-color:#333; color:var(--text-white);" title="Add Row Below">⊞ +Row</button>
                    <button class="add-block-btn btn-table-add-col" style="flex:1; border-color:#333; color:var(--text-white);" title="Add Column Right">⊞ +Col</button>
                    <button class="add-block-btn btn-table-del-row btn-action-delete" style="flex:1; border-color:#333; color:#ef4444;" title="Delete Bottom Row">⊟ -Row</button>
                    <button class="add-block-btn btn-table-del-col btn-action-delete" style="flex:1; border-color:#333; color:#ef4444;" title="Delete Right Column">⊟ -Col</button>
                </div>
                <input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)">
            `;
        }
        else if (block.type === 'accordion') {
            let textContent = '';
            if (block.content && block.content.length > 0 && block.content[0].type === 'paragraph') {
                textContent = Array.isArray(block.content[0].content) ? block.content[0].content.join('\n') : block.content[0].content;
            }
            html += `
                <input type="text" class="editor-input" data-field="title" value="${block.title || ''}" placeholder="Accordion Title">
                <textarea class="editor-textarea" data-field="accordion-text" placeholder="Collapsible text content...">${textContent}</textarea>
                <div class="editor-row">
                    <div>${getAlignUI(block.align, 'center')}</div>
                    <div><input type="text" class="editor-input" data-field="author" value="${block.author || ''}" placeholder="Author Credit (Optional)"></div>
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
            html += `<label style="color:var(--text-muted); font-size:0.85rem;"><input type="checkbox" data-field="invisible" ${block.invisible ? 'checked' : ''}> Invisible (Spacer only)</label>`;
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

    // Instantly resize all textareas on render!
    listContainer.querySelectorAll('.editor-textarea').forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
    });

    // --- HOOK VIRTUALIZATION ---
    if (window.editorBlockObserver) {
        listContainer.querySelectorAll('.block-card').forEach(card => {
            window.editorBlockObserver.observe(card);
        });
    }
}
// --- MASTER RENDERER FOR OVERVIEW TAB ---
function renderFullOverviewPreview() {
    const descData = window.currentEditorDescData;
    if (!descData) return;

    const overviewContainer = document.getElementById('tab-overview');
    if (!overviewContainer) return;

    // 1. Reset Container
    overviewContainer.innerHTML = '';
    overviewContainer.classList.add('vessel-content', 'space-y-6');

    // 2. Build Profile Card & Top Split
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
            <aside class="wiki-section profile-card">
                ${imgHTML}
                <div class="profile-stats-container">${statsHTML}</div>
            </aside>
        `;
    }

    const overviewTextWrapper = document.createElement('div');
    overviewTextWrapper.id = 'overview-text-subnode';
    overviewTextWrapper.className = 'profile-text-wrapper';

    topSplit.innerHTML = profileHTML;
    topSplit.appendChild(overviewTextWrapper);
    overviewContainer.appendChild(topSplit);

    if (typeof window.populateTextSection === 'function') {
        window.populateTextSection('overview-text-subnode', 'Character Overview', descData.overview || []);
    }

    // 3. Build General Strategy (Always built to allow live editing even if empty)
    if (descData.strategy) {
        const stratWrapper = document.createElement('div');
        stratWrapper.id = 'overview-strategy-subnode';
        overviewContainer.appendChild(stratWrapper);
        if (typeof window.populateTextSection === 'function') {
            window.populateTextSection('overview-strategy-subnode', 'General Strategy', descData.strategy);
        }
    }

    // 4. Build Extras (Trivia, Passives, etc.)
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

// --- MASTER RENDERER FOR MATCHUPS TAB ---
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
            "Unwinnable": "text-red-600", "Extreme Disadvantage": "text-red-500",
            "Disadvantage": "text-orange-400", "Equal": "text-gray-400",
            "Advantage": "text-green-400", "Extreme Advantage": "text-green-500",
            "Unloseable": "text-cyan-400"
        };
        const tierClass = tierColors[mu.tier] || "text-white";
        const safeOpponent = (mu.opponent || 'Unknown').replace(/\s+/g, '-');

        const muSection = document.createElement('section');
        muSection.className = 'wiki-section'; 
        muSection.style.overflow = 'hidden'; 

        let muHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">vs. ${mu.opponent || 'Unknown'}</h3>
                <span class="card-tier-label ${tierClass}">${mu.tier || 'Equal'}</span>
            </div>
        `;

        muSection.innerHTML = muHTML;
        matchupsContainer.appendChild(muSection);

        // Properly create the wrapper container using DOM methods to prevent query selector bugs
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

// --- MASTER RENDERER FOR COUNTERPLAY TAB ---
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
            "Crucial": "text-red-500", "High": "text-orange-400",
            "Moderate": "text-yellow-400", "Low": "text-green-400",
            "Situational": "text-cyan-400"
        };
        const importanceClass = importanceColors[cp.importance] || "text-gray-400";
        const safeTopic = (cp.topic || 'Unknown').replace(/\s+/g, '-');

        const cpSection = document.createElement('section');
        cpSection.className = 'wiki-section'; 
        cpSection.style.overflow = 'hidden';

        let cpHTML = `
            <div class="card-header-flex">
                <h3 class="card-header-title">${cp.topic || 'Unknown'}</h3>
                <span class="card-tier-label ${importanceClass}">${cp.importance || 'Moderate'}</span>
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
    const tabId = window.currentEditorTabId;
    const frameTabs = ['m1s', 'skills', 'specials'];

    // 1. If we are on a frame data tab, we MUST rebuild the heavy framedata.js DOM first.
    if (frameTabs.includes(tabId) && typeof window.loadMoveSection === 'function') {
        // Determine the currently active move
        let activeMoveId = new URLSearchParams(window.location.search).get('move'); 
        if (activeMoveId) {
            await window.loadMoveSection(window.currentEditorCharId, tabId, activeMoveId);
        }
        if (!activeMoveId) {
            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
            if (activeBtn) activeMoveId = activeBtn.id.replace('move-nav-', '');
        }
        
        // Pass it to the engine to isolate the preview!
        await window.loadMoveSection(window.currentEditorCharId, tabId, activeMoveId);
    }

    // 2. Now run the standard text/profile sync to populate the newly built DOM
    if (tabId === 'overview' && typeof renderFullOverviewPreview === 'function') {
        // Ensure state is synced to master object first
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
};

// --- LIVE SYNC & STATE MANAGEMENT ---
function updateLivePreview(skipHistory = false) {
    
    // Automatically save a snapshot of the blocks before syncing the preview
    if (!skipHistory && typeof window.saveBlockHistory === 'function') {
        window.saveBlockHistory();
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
        
        // CRITICAL: Sync active block changes back into the master JSON object
        if (activeMoveId && window.currentEditorDescData) {
            // SECURITY PATCH
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

            window.populateTextSection(targetId, 'Move Overview and Strategy', currentStrategyBlocks);
            if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50); 
        }

    } else if (tabId === 'overview') {
        const sectionId = window.currentOverviewSection || 'overview';

        // CRITICAL: Sync active block changes back into the master JSON object
        if (sectionId === 'overview') {
            if (window.currentEditorDescData) window.currentEditorDescData.overview = JSON.parse(JSON.stringify(currentStrategyBlocks));
        } else if (sectionId === 'strategy') {
            if (window.currentEditorDescData) window.currentEditorDescData.strategy = JSON.parse(JSON.stringify(currentStrategyBlocks));
        } else if (sectionId.startsWith('extra-')) {
            const idx = parseInt(sectionId.split('-')[1]);
            if (window.currentEditorDescData) window.currentEditorDescData.extras[idx].content = JSON.parse(JSON.stringify(currentStrategyBlocks));
        }

        // Completely rebuild the entire tab (Profile, Strategy, Extras) at once
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
        // Fallback for anything else
        // Fallback for Counterplay
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
}

// --- MEDIA LIBRARY SYSTEM ---
window.initMediaLibrary = function() {
    const dropZone = document.getElementById('media-upload-zone');
    const fileInput = document.getElementById('media-file-input');
    const gallery = document.getElementById('media-gallery-grid');
    const btnRefresh = document.getElementById('btn-media-refresh');

    if (!dropZone || !gallery) return;

    // --- MEDIA LIBRARY LOGIC ---
    window.currentMediaFiles = []; // Global cache so we don't spam Supabase when searching

    // --- FORMAT CONVERSION ENGINES ---
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

    function convertToWebM(file, newName, progressCallback) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.muted = true;
            video.playsInline = true;

            video.onloadedmetadata = () => {
                video.play().catch(e => reject(new Error("Browser blocked video conversion pipeline.")));
                
                let stream;
                if (video.captureStream) stream = video.captureStream();
                else if (video.mozCaptureStream) stream = video.mozCaptureStream();
                else return reject(new Error("Video conversion not supported in this browser. Please manually convert to .webm before uploading."));

                const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                const chunks = [];
                recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve(new File([blob], newName, { type: 'video/webm' }));
                };

                recorder.start();
                
                const duration = video.duration;
                const interval = setInterval(() => {
                    if (duration) progressCallback(Math.min(100, Math.round((video.currentTime / duration) * 100)));
                }, 200);

                video.onended = () => {
                    clearInterval(interval);
                    recorder.stop();
                };
            };
            video.onerror = () => reject(new Error("Failed to read video file."));
        });
    }

// --- PAGINATION STATE ---
window.currentMediaPage = 1;
window.mediaItemsPerPage = 24; // Best for 2, 3, 4, 6, or 8 column grid layouts

window.loadMediaGallery = async function() {
    const grid = document.getElementById('media-gallery-grid');
    if (!grid) return;
    
    grid.innerHTML = '<div style="color:#888; font-family:var(--text-mono); font-size:0.75rem; padding: 2rem; text-align:center; grid-column: 1 / -1;">Connecting to Cloud Storage...</div>';
    
    if (!window.supabaseClient) return;

    // Backend Optimization: We pull the lightweight metadata max 1000 at a time.
    const { data, error } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
    if (error) {
        grid.innerHTML = `<div style="color:#ef4444; grid-column: 1 / -1;">Error: ${error.message}</div>`;
        return;
    }

    window.currentMediaFiles = data.filter(f => !f.name.startsWith('.'));
    window.currentMediaPage = 1; // Reset to page 1 on fresh load
    window.renderMediaGrid(); 
};

window.renderMediaGrid = function() {
    const grid = document.getElementById('media-gallery-grid');
    const searchQuery = (document.getElementById('media-search-input')?.value || '').toLowerCase();
    const filterType = document.getElementById('media-filter-select')?.value || 'all';

    if (!grid) return;

    // 1. Apply Filters
    const filteredFiles = window.currentMediaFiles.filter(file => {
        const name = file.name.toLowerCase();
        const isAnimated = name.endsWith('.webm') || name.endsWith('.mp4') || name.endsWith('.gif');
        
        if (searchQuery && !name.includes(searchQuery)) return false;
        if (filterType === 'video' && !isAnimated) return false;
        if (filterType === 'image' && isAnimated) return false;

        return true;
    });

    // 2. Pagination Math
    const totalItems = filteredFiles.length;
    const totalPages = Math.ceil(totalItems / window.mediaItemsPerPage) || 1;
    
    // Safety catch if a filter reduces pages below current page
    if (window.currentMediaPage > totalPages) window.currentMediaPage = totalPages;

    const startIndex = (window.currentMediaPage - 1) * window.mediaItemsPerPage;
    const endIndex = startIndex + window.mediaItemsPerPage;
    
    // Frontend Optimization: Only slice the 24 items we actually need to render
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    // 3. Update DOM Pagination Controls
    document.getElementById('media-page-indicator').textContent = `PAGE ${window.currentMediaPage}/${totalPages}`;
    
    const btnPrev = document.getElementById('btn-media-prev');
    const btnNext = document.getElementById('btn-media-next');
    
    btnPrev.disabled = window.currentMediaPage === 1;
    btnNext.disabled = window.currentMediaPage === totalPages;
    
    // Apply a visual fade to disabled buttons
    btnPrev.style.opacity = btnPrev.disabled ? '0.3' : '1';
    btnNext.style.opacity = btnNext.disabled ? '0.3' : '1';

    // 4. Render Grid
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
        
        // --- Play Video exclusively on Hover ---
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

// Bind Page Buttons
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

// Also, reset the page to 1 whenever a user TYPES in the search or CHANGES the filter dropdown!
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

    // Extract base name and determine final extension
    const lastDotIndex = file.name.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
    
    const isVideo = file.type.startsWith('video/');
    const isGif = file.type.includes('gif');
    
    let newExt = '';
    if (isVideo) newExt = '.webm';
    else if (isGif) newExt = '.gif'; // GIFs skip conversion to preserve animation frames
    else newExt = '.webp';

    const finalName = baseName + newExt;

    // 1. GATEKEEPER: Prevent Overwrites (Checks the local cache instantly!)
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
        // 2. CONVERSION ROUTING (WITH SAFE FALLBACKS)
        if (!isVideo && !isGif && !file.type.includes('webp')) {
            uploadText.textContent = "Converting Image to WEBP...";
            try {
                finalFile = await convertToWebP(file, finalName);
            } catch (convErr) {
                console.warn("WebP conversion failed, falling back to original file:", convErr);
                finalFile = file; // Fallback to original image
                finalName = file.name; 
            }
        } else if (isVideo && !file.type.includes('webm')) {
            uploadText.textContent = "Attempting WEBM Conversion...";
            try {
                finalFile = await convertToWebM(file, finalName, (pct) => {
                    uploadText.textContent = `Converting Video to WEBM (Realtime)... ${pct}%`;
                });
            } catch (convErr) {
                console.warn("WebM conversion blocked or unsupported, falling back to original file:", convErr);
                finalFile = file; // Fallback to original MP4/MOV
                finalName = file.name; 
            }
        }

        // 3. SECURE CLOUD UPLOAD
        uploadText.textContent = "Uploading to Cloud...";
        const { error } = await window.supabaseClient.storage.from('wiki-media').upload(finalName, finalFile);

        if (error) {
            console.error("Upload error:", error);
            window.editorAlert("Upload failed: " + error.message);
        } else {
            window.loadMediaGallery(); // Instantly refresh the grid to show the new file
        }
    } catch (err) {
        console.error(err);
        window.editorAlert("Action Failed: " + err.message);
    }

    uploadText.textContent = oldText;
    uploadText.style.color = "";
}

// Event Listeners
btnRefresh.addEventListener('click', window.loadMediaGallery);
document.getElementById('media-search-input').addEventListener('input', window.renderMediaGrid);
document.getElementById('media-filter-select').addEventListener('change', window.renderMediaGrid);

// --- Proxy the click from the stylized zone to the hidden file input ---
dropZone.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUpload(e.target.files[0]);
});


// Visual Drag & Drop Physics
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

// Initialize the engine!
document.addEventListener('DOMContentLoaded', () => {
window.initMediaLibrary();
});

// --- DIFF COMPARISON ENGINE ---
window.toggleDiffMode = async function() {
    window.isDiffModeActive = !window.isDiffModeActive;
    const btn = document.getElementById('btn-toggle-diff');
    
    // Force a data sync so the diff engine captures the absolute latest typing
    if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
    
    if (window.isDiffModeActive) {
        btn.style.background = '#a855f7';
        btn.style.color = '#000';
        btn.textContent = '[-] CLOSE DIFF';
        renderDiffView();
    } else {
        btn.style.background = 'transparent';
        btn.style.color = '#a855f7';
        btn.textContent = '[+] DIFF VIEW';
        
        // Remove diff container and unhide normal preview
        const diffCont = document.getElementById('diff-view-container');
        if (diffCont) diffCont.remove();
        document.querySelector('.main-content-area').style.display = 'block';
    }
}

// --- VISUAL DIFF COMPARISON ENGINE ---
window.renderDiffView = function() {
    // Hide normal live preview
    document.querySelector('.main-content-area').style.display = 'none';
    
    let diffContainer = document.getElementById('diff-view-container');
    if (!diffContainer) {
        diffContainer = document.createElement('div');
        diffContainer.id = 'diff-view-container';
        diffContainer.className = 'main-content-area';
        document.querySelector('.mock-window-content').appendChild(diffContainer);
    }
    
    diffContainer.innerHTML = '<h2 class="section-title">UNSAVED CHANGES (VISUAL DIFF)</h2>';
    let changesFound = false;
    let diffRenderQueue = []; // Holds rendering functions until the DOM is attached

    // The core comparison and DOM generation logic
    const compareAndRender = (sectionName, oldData, newData, type = 'blocks') => {
        const oldStr = JSON.stringify(oldData || null);
        const newStr = JSON.stringify(newData || null);

        if (oldStr !== newStr) {
            changesFound = true;
            const safeId = sectionName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 10000);

            let oldHtml = '<i style="color:#ef4444; opacity:0.7; font-size: 0.8rem;">(Empty or Deleted)</i>';
            let newHtml = '<i style="color:#22c55e; opacity:0.7; font-size: 0.8rem;">(Empty or Deleted)</i>';

            if (type === 'blocks') {
                const oldBlocks = Array.isArray(oldData) ? oldData : [];
                const newBlocks = Array.isArray(newData) ? newData : [];

                if (oldBlocks.length > 0) {
                    oldHtml = `<div id="diff-old-${safeId}" class="wiki-section" style="margin-top: 1rem; border-color: #ef4444; background: transparent; pointer-events: none;"></div>`;
                    // Queue the native description.js renderer
                    diffRenderQueue.push(() => {
                        if(typeof window.populateTextSection === 'function') window.populateTextSection(`diff-old-${safeId}`, '', oldBlocks);
                    });
                }
                if (newBlocks.length > 0) {
                    newHtml = `<div id="diff-new-${safeId}" class="wiki-section" style="margin-top: 1rem; border-color: #22c55e; background: transparent; pointer-events: none;"></div>`;
                    diffRenderQueue.push(() => {
                        if(typeof window.populateTextSection === 'function') window.populateTextSection(`diff-new-${safeId}`, '', newBlocks);
                    });
                }
            } else if (type === 'profile') {
                const renderProfile = (p) => {
                    if (!p || Object.keys(p).length === 0) return '';
                    let s = `<div style="display:flex; gap:1rem; align-items:flex-start; margin-top:1rem;">`;
                    if (p.image) s += `<img src="${p.image}" style="width: 80px; height: 80px; object-fit: cover; border: 2px solid #333;">`;
                    s += `<div style="flex:1; font-family:var(--text-mono); font-size:0.75rem; color:var(--text-primary);">`;
                    (p.stats || []).forEach(st => { s += `<div style="border-bottom:1px dashed #444; padding:0.25rem 0;"><strong>${st.label}:</strong> ${st.value}</div>`; });
                    s += `</div></div>`;
                    return s;
                };
                if(oldData) oldHtml = renderProfile(oldData);
                if(newData) newHtml = renderProfile(newData);
            } else {
                // Fallback for Frame Data: Keeps it as JSON since visualizing DAW logic statically is too messy
                if(oldData) oldHtml = `<pre style="margin-top: 1rem; font-family: var(--text-mono); font-size: 0.65rem; white-space: pre-wrap;">${JSON.stringify(oldData, null, 2)}</pre>`;
                if(newData) newHtml = `<pre style="margin-top: 1rem; font-family: var(--text-mono); font-size: 0.65rem; white-space: pre-wrap;">${JSON.stringify(newData, null, 2)}</pre>`;
            }

            diffContainer.innerHTML += `
                <div class="diff-container" style="padding: 1.5rem; margin-bottom: 2rem;">
                    <h3 class="diff-section-title" style="margin-bottom: 0.5rem;">${sectionName.toUpperCase()}</h3>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <div class="diff-block-old" style="flex: 1; min-width: 300px; padding: 1rem; background: hsla(0, 100%, 50%, 0.05); border-left: 3px solid #ef4444;">
                            <strong style="color: #ef4444; font-family:var(--text-mono); font-size:0.75rem;">[-] LIVE CLOUD DATA (REMOVED/OLD):</strong>
                            ${oldHtml}
                        </div>
                        <div class="diff-block-new" style="flex: 1; min-width: 300px; padding: 1rem; background: hsla(120, 100%, 25%, 0.05); border-left: 3px solid #22c55e;">
                            <strong style="color: #22c55e; font-family:var(--text-mono); font-size:0.75rem;">[+] PENDING DATA (ADDED/NEW):</strong>
                            ${newHtml}
                        </div>
                    </div>
                </div>
            `;
        }
    };

    // Deep-diff helper to isolate exact Matchups/Topics/Moves instead of comparing the whole array blindly
    const compareArrayOfObjects = (sectionPrefix, oldArr, newArr, keyProp, type) => {
        const oldMap = new Map((oldArr || []).map(item => [item[keyProp] || 'Unknown', item]));
        const newMap = new Map((newArr || []).map(item => [item[keyProp] || 'Unknown', item]));
        const allKeys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));

        allKeys.forEach(key => {
            const oldItem = oldMap.get(key);
            const newItem = newMap.get(key);
            
            if (type === 'blocks') {
                compareAndRender(`${sectionPrefix}: ${key}`, oldItem ? oldItem.content : null, newItem ? newItem.content : null, 'blocks');
            } else {
                compareAndRender(`${sectionPrefix}: ${key}`, oldItem, newItem, 'json');
            }
        });
    };

    // 1. Static Sections
    compareAndRender('Profile Metadata', window.originalCloudDescData.profile, window.currentEditorDescData.profile, 'profile');
    compareAndRender('Character Overview', window.originalCloudDescData.overview, window.currentEditorDescData.overview, 'blocks');
    compareAndRender('General Strategy', window.originalCloudDescData.strategy, window.currentEditorDescData.strategy, 'blocks');

    // 2. Dynamic Array Sections (Matchups, Counterplay, Extras)
    compareArrayOfObjects('Custom Tab', window.originalCloudDescData.extras, window.currentEditorDescData.extras, 'title', 'blocks');
    compareArrayOfObjects('Matchup', window.originalCloudDescData.matchups, window.currentEditorDescData.matchups, 'opponent', 'blocks');
    compareArrayOfObjects('Counterplay Topic', window.originalCloudDescData.counterplay, window.currentEditorDescData.counterplay, 'topic', 'blocks');

    // 3. Move Strategies (Nested deeply inside DescData)
    const oldStrats = window.originalCloudDescData.moveStrategies || {};
    const newStrats = window.currentEditorDescData.moveStrategies || {};
    const allMoveKeys = Array.from(new Set([...Object.keys(oldStrats), ...Object.keys(newStrats)]));
    allMoveKeys.forEach(key => { compareAndRender(`Move Strategy: ${key}`, oldStrats[key], newStrats[key], 'blocks'); });

    // 4. Frame Data
    compareArrayOfObjects('Frame Data (M1)', window.originalCloudFrameData.m1s, window.currentEditorFrameData.m1s, 'id', 'json');
    compareArrayOfObjects('Frame Data (Skill)', window.originalCloudFrameData.skills, window.currentEditorFrameData.skills, 'id', 'json');
    compareArrayOfObjects('Frame Data (Special)', window.originalCloudFrameData.specials, window.currentEditorFrameData.specials, 'id', 'json');

    if (!changesFound) {
        diffContainer.innerHTML += `<p style="color:var(--text-muted); font-style:italic; border: 1px dashed #333; padding: 2rem; text-align: center;">No changes detected against the live database.</p>`;
    }

    // Execute visual block rendering queue AFTER the DOM is fully attached
    diffRenderQueue.forEach(fn => fn());
    if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
}

document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.btn-action-add');
    if (!addBtn) return;
    
    const btnText = addBtn.textContent.trim().toUpperCase();
    
    // Catch the specific sidebar buttons
    if (btnText.includes('ADD TAB') || btnText.includes('ADD MATCHUP') || btnText.includes('ADD TOPIC') || btnText.includes('ADD COUNTERPLAY') || btnText.includes('ADD MOVE')) {
        e.preventDefault();
        e.stopPropagation(); // Kills the broken underlying script instantly
        
        openCustomAddModal(btnText);
    }
}, true); // TRUE = Capture Phase (Intercepts from the top-down)

function openCustomAddModal(type) {
    // 1. Build the modal UI if it doesn't exist
    let overlay = document.getElementById('custom-add-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'custom-add-modal-overlay';
        overlay.className = 'editor-modal-overlay';
        overlay.style.zIndex = '10005';
        overlay.innerHTML = `
            <div class="editor-modal-box auth-modal-box" style="border-top-color: var(--accent-blue);">
                <div class="auth-header">
                    <h3 id="custom-add-title" style="color: var(--accent-blue);">ADD NEW SECTION</h3>
                </div>
                <div class="auth-body" style="padding: 1.5rem;">
                    <div id="custom-add-inputs" style="display: flex; flex-direction: column; gap: 0.75rem; text-align: left;">
                        </div>
                </div>
                <div class="editor-modal-actions" style="justify-content: flex-end; border-top: 1px dashed #333; padding-top: 1rem; margin-top: 0;">
                    <button class="system-page-btn" onclick="document.getElementById('custom-add-modal-overlay').style.display='none'">CANCEL</button>
                    <button id="btn-custom-add-confirm" class="submit-btn" style="color: var(--accent-blue); border-color: var(--accent-blue);">CREATE</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    const inputsContainer = document.getElementById('custom-add-inputs');
    const confirmBtn = document.getElementById('btn-custom-add-confirm');
    
    // 2. Generate the specific form based on what button was clicked
    if (type.includes('TAB')) {
        inputsContainer.innerHTML = `
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">CUSTOM TAB TITLE</label>
            <input type="text" id="inp-custom-title" class="editor-input" placeholder="e.g., Lore, Passives, Trivia">
        `;
        confirmBtn.onclick = () => {
            const title = document.getElementById('inp-custom-title').value.trim();
            if (!title) return;
            
            if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
            window.currentEditorDescData.extras.push({ title: title, content: [] });
            
            finalizeAddition();
        };
    } 
    else if (type.includes('MATCHUP')) {
        inputsContainer.innerHTML = `
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">OPPONENT NAME</label>
            <input type="text" id="inp-custom-opp" class="editor-input" placeholder="e.g., Honored One">
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; margin-top: 0.5rem;">DIFFICULTY TIER</label>
            <select id="inp-custom-tier" class="editor-select">
                <option value="Equal">Equal</option>
                <option value="Extreme Disadvantage">Extreme Disadvantage</option>
                <option value="Disadvantage">Disadvantage</option>
                <option value="Advantage">Advantage</option>
                <option value="Extreme Advantage">Extreme Advantage</option>
                <option value="Unloseable">Unloseable</option>
                <option value="Unwinnable">Unwinnable</option>
            </select>
        `;
        confirmBtn.onclick = () => {
            const opp = document.getElementById('inp-custom-opp').value.trim();
            const tier = document.getElementById('inp-custom-tier').value;
            if (!opp) return;
            
            if (!window.currentEditorDescData.matchups) window.currentEditorDescData.matchups = [];
            window.currentEditorDescData.matchups.push({ opponent: opp, tier: tier, content: [] });
            
            finalizeAddition();
        };
    } 
    else if (type.includes('TOPIC') || type.includes('COUNTERPLAY')) {
        inputsContainer.innerHTML = `
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">COUNTERPLAY TOPIC</label>
            <input type="text" id="inp-custom-topic" class="editor-input" placeholder="e.g., Evading the Domain">
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; margin-top: 0.5rem;">IMPORTANCE LEVEL</label>
            <select id="inp-custom-imp" class="editor-select">
                <option value="Moderate">Moderate</option>
                <option value="Crucial">Crucial</option>
                <option value="High">High</option>
                <option value="Low">Low</option>
                <option value="Situational">Situational</option>
            </select>
        `;
        confirmBtn.onclick = () => {
            const topic = document.getElementById('inp-custom-topic').value.trim();
            const imp = document.getElementById('inp-custom-imp').value;
            if (!topic) return;
            
            if (!window.currentEditorDescData.counterplay) window.currentEditorDescData.counterplay = [];
            window.currentEditorDescData.counterplay.push({ topic: topic, importance: imp, content: [] });
            
            finalizeAddition();
        };
    }
    else if (type.includes('MOVE')) {
        inputsContainer.innerHTML = `
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888;">MOVE ID (Internal, No Spaces)</label>
            <input type="text" id="inp-custom-move-id" class="editor-input" placeholder="e.g., skill_1">
            <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; margin-top: 0.5rem;">MOVE NAME (Display)</label>
            <input type="text" id="inp-custom-move-name" class="editor-input" placeholder="e.g., Domain Expansion">
        `;
        confirmBtn.onclick = () => {
            // Force strict formatting for the internal ID
            const id = document.getElementById('inp-custom-move-id').value.trim().replace(/\s+/g, '_').toLowerCase();
            const name = document.getElementById('inp-custom-move-name').value.trim();
            if (!id || !name) return;
            
            const tabId = window.currentEditorTabId;
            if (!window.currentEditorFrameData[tabId]) window.currentEditorFrameData[tabId] = [];
            
            if (window.currentEditorFrameData[tabId].some(m => m.id === id)) {
                window.editorAlert("A move with this ID already exists in this tab.");
                return;
            }

            // Spawn the blank template
            window.currentEditorFrameData[tabId].push({
                id: id, name: name, input: "", type: "", variant: "Standard",
                media: { src: "", alt: "" }, stats: [], variants: {}
            });
            
            overlay.style.display = 'none';
            initFullTabEditor(window.currentEditorCharId, tabId, window.currentEditorDescData, window.currentEditorFrameData);
            window.loadMoveIntoEditor(id); // Auto-jump to the new move
        };
    }
    
    // 3. Command the renderer to redraw the screen
    function finalizeAddition() {
        overlay.style.display = 'none';
        if (typeof initFullTabEditor === 'function') {
            initFullTabEditor(window.currentEditorCharId, window.currentEditorTabId, window.currentEditorDescData, window.currentEditorFrameData);
        }
    }
    
    // 4. Show modal and focus the input automatically
    overlay.style.display = 'flex';
    setTimeout(() => {
        const firstInput = inputsContainer.querySelector('input');
        if (firstInput) firstInput.focus();
    }, 50);
}