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

// --- RECLAIMING EDITOR SPACE (owner's fine-tuning item, 2026-08-14) ---
//
// Two controls that answer the same complaint: the top of the editor was
// spending vertical space on things a contributor reads once and then writes
// underneath for an hour.
//
// Both remember their state in localStorage, which is per-browser rather than
// per-account on purpose - this is a preference about a screen, not a fact
// about a person, and storing it server-side would mean a round trip before
// the editor could draw itself.
const EDITOR_CHROME_KEY = 'dsl_editor_chrome_collapsed';
const EDITOR_TIP_KEY = 'dsl_editor_tip_dismissed';

// localStorage throws outright in a few real configurations - Safari's private
// mode historically, and any browser with site data blocked. A contributor
// with cookies off should still get a working editor, just one that forgets.
function editorPrefRead(key) {
    try { return window.localStorage.getItem(key) === '1'; } catch (e) { return false; }
}

function editorPrefWrite(key, on) {
    try {
        if (on) window.localStorage.setItem(key, '1');
        else window.localStorage.removeItem(key);
    } catch (e) { /* preference is lost, the control still works this session */ }
}

window.setEditorChromeCollapsed = function (collapsed) {
    const header = document.getElementById('editor-header');
    const toggle = document.getElementById('btn-collapse-chrome');
    if (!header || !toggle) return;

    header.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Expand the editor header' : 'Collapse the editor header';
    editorPrefWrite(EDITOR_CHROME_KEY, collapsed);
};

window.setEditorTipDismissed = function (dismissed) {
    const tip = document.getElementById('editor-scope-tip');
    if (!tip) return;
    tip.classList.toggle('hidden', dismissed);
    editorPrefWrite(EDITOR_TIP_KEY, dismissed);
};

window.initEditorChrome = function () {
    const toggle = document.getElementById('btn-collapse-chrome');
    const dismiss = document.getElementById('btn-dismiss-tip');
    if (!toggle && !dismiss) return;

    // Applied before any listener is bound, so the editor opens the way it was
    // left rather than flashing the full header first.
    window.setEditorChromeCollapsed(editorPrefRead(EDITOR_CHROME_KEY));
    window.setEditorTipDismissed(editorPrefRead(EDITOR_TIP_KEY));

    if (toggle) {
        toggle.addEventListener('click', () => {
            const header = document.getElementById('editor-header');
            window.setEditorChromeCollapsed(!header.classList.contains('is-collapsed'));
        });
    }

    if (dismiss) dismiss.addEventListener('click', () => window.setEditorTipDismissed(true));
};

document.addEventListener('DOMContentLoaded', window.initEditorChrome);

// --- LEAVING THE EDITOR ---
// Cancel used to be a bare window.history.back(). A reviewer intercepting a
// ticket arrives via window.open(..., '_blank') from admin.html, and a fresh
// tab has no history entry to go back to - so the button did nothing at all,
// which is exactly how it was reported. Each step in cancelEditor below is a
// real exit; the chain only exists because no single one covers every way in.
// Where cancel lands when there is no history and no opener - a deep link
// straight into the editor, from a bookmark or a pasted URL. Separate from
// cancelEditor so the choice can be asserted without stubbing navigation.
window.editorExitDestination = function(search = window.location.search) {
    const params = new URLSearchParams(search);
    const pageId = params.get('page') || params.get('char');
    const pageType = params.get('type') || 'character';

    // Staff go back to the queue they were working; everyone else to the page.
    if (params.get('editTicket')) return 'admin.html';
    if (pageId) return `${pageType === 'character' ? 'characters' : 'systems'}/${encodeURIComponent(pageId)}/`;
    return 'index.html';
};

window.cancelEditor = function() {
    // Opened by script from the review queue: closing reveals admin.html
    // underneath, which is where the reviewer wants to be.
    if (window.opener && !window.opener.closed) {
        window.close();
        return;
    }

    // Navigated to normally - length 1 means this tab has been nowhere else.
    if (window.history.length > 1) {
        window.history.back();
        return;
    }

    window.location.href = window.editorExitDestination();
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

        // Before the preview is built, so a ?mode= link opens the editor on
        // the state it names rather than rendering the base kit and then
        // snapping. This takes ownership of window.currentEditorDescData and
        // currentEditorFrameData: from here they are views onto the master
        // objects, and for the base mode they are the master objects.
        if (typeof window.initEditorModes === 'function') {
            await window.initEditorModes(pageId, descData, frameData);
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
        // Reads the mode view rather than the master: on a character with
        // states, the first move of the *active* state is the one to open.
        const modeFrame = window.currentEditorFrameData || frameData;
        if ((window.FRAME_MOVE_CATEGORIES || []).includes(tabId) && typeof window.loadMoveSection === 'function') {
            let activeMoveId = moveId;
            if (!activeMoveId && modeFrame && modeFrame[tabId] && modeFrame[tabId].length > 0) {
                activeMoveId = modeFrame[tabId][0].id;
            }
            try { await window.loadMoveSection(pageId, tabId, activeMoveId, pageType); } catch(e) { console.warn("Move section build skipped:", e); }
        }
        
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(pageId, pageType);
        }

        // 3. ROUTE TO THE CORRECT EDITOR
        window.currentEditorTabId = tabId;
        window.currentEditorCharId = pageId;

        // applyEditorModeView owns these two now, and re-points them at the
        // active state's slice. Assigning the masters here instead would undo
        // the view and send every edit into the base kit.
        if (typeof window.applyEditorModeView === 'function') {
            window.applyEditorModeView();
        } else {
            window.currentEditorDescData = descData;
            window.currentEditorFrameData = frameData;
        }

        const editDesc = window.currentEditorDescData;
        const editFrame = window.currentEditorFrameData;

        if (moveId) {
            // This branch skips initFullTabEditor, which is where the tab
            // strip normally syncs itself - so do it here too, or deep-
            // linking to a single move leaves the strip unrendered.
            if (typeof window.renderEditorTabNav === 'function') window.renderEditorTabNav(tabId);

            const moveStats = editFrame ? editFrame[tabId]?.find(m => m.id === moveId) : null;
            const moveStrats = editDesc ? editDesc.moveStrategies?.[moveId] : null;
            initPerMoveEditor(moveId, moveStats, moveStrats);
            setTimeout(() => {
                const previewCard = document.querySelector(`.live-preview-pane #strategy-${moveId}`);
                if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        } else {
            initFullTabEditor(pageId, tabId, editDesc, editFrame);
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
            // A 'viewer' is soft-banned: signed in and able to read, but
            // blocked from submitting anything (see the "Guests can submit
            // revisions" policy). Checked here so they are told before filling
            // in the QA modal, rather than hitting an opaque RLS rejection at
            // the very end. The database is still the real boundary.
            const { data: ownRole } = await window.supabaseClient
                .from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
            if ((ownRole?.role || '').trim().toLowerCase() === 'viewer') {
                window.editorAlert("Your account can't submit edits right now. If you think that's a mistake, get in touch on Discord.");
                return;
            }

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

            // Mirrors check_revision_rate_limit()'s bypass exactly
            // (supabase/migrations/20260810000000_staff_cooldown_perk.sql).
            // The trigger is the real boundary; this is only about which
            // message the contributor sees. If the two disagree, staff either
            // get a friendly wait the server would have allowed, or a raw
            // Postgres exception where they expected the friendly wait.
            const STAFF_ROLES = ['trusted_editor', 'reviewer', 'admin'];
            let skipsCooldown = false;
            if (STAFF_ROLES.includes((ownRole?.role || '').trim().toLowerCase())) {
                const { data: settings } = await window.supabaseClient
                    .from('site_settings').select('staff_bypass_submission_cooldown').maybeSingle();
                // Absent row or a failed read means enforce, matching the
                // trigger's COALESCE.
                skipsCooldown = settings?.staff_bypass_submission_cooldown === true;
            }

            const COOLDOWN_MINUTES = 3;
            const lastSubmitTime = localStorage.getItem('wiki_last_submit_time');
            if (lastSubmitTime && !window.activeEditTicketId && !skipsCooldown) {
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

                    // originalCloudDescData is the *active state's* slice, so
                    // the row just read has to be narrowed the same way before
                    // the two are compared - otherwise editing an ultimate
                    // state compares its matchups against the base kit's and
                    // warns about a collision on every single submission.
                    // Both resolvers hand the object straight back for the
                    // base mode, which is every page with no states.
                    const mode = window.editorActiveMode;
                    const onBase = typeof window.isBaseMode === 'function'
                        ? window.isBaseMode(mode) : (!mode || mode === 'base');
                    const liveDesc = onBase ? liveData.desc_data : (liveData.desc_data?.modeData || {})[mode] || {};
                    const liveFrame = onBase ? liveData.frame_data : (liveData.frame_data?.modeData || {})[mode] || {};

                    if (pageType === 'system' || pageType === 'tierlist') {
                        hasCollision = isDiff(liveDesc, window.originalCloudDescData);
                    }

                    if ((window.FRAME_MOVE_CATEGORIES || []).includes(tabId)) {
                        let moveId = new URLSearchParams(window.location.search).get('move');
                        if (!moveId) {
                            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                            if (activeBtn) moveId = activeBtn.id.replace('move-nav-', '');
                        }
                        if (moveId) {
                            hasCollision = isDiff(liveDesc?.moveStrategies?.[moveId], window.originalCloudDescData?.moveStrategies?.[moveId]) || 
                                           isDiff((liveFrame?.[tabId] || []).find(m => m.id === moveId), (window.originalCloudFrameData?.[tabId] || []).find(m => m.id === moveId));
                        }
                    } else if (tabId === 'overview') {
                        const sec = window.currentOverviewSection || 'overview';
                        if (sec === 'profile') hasCollision = isDiff(liveDesc?.profile, window.originalCloudDescData?.profile);
                        else if (sec === 'playstyle') hasCollision = isDiff(liveDesc?.playstyle, window.originalCloudDescData?.playstyle);
                        else if (sec === 'overview') hasCollision = isDiff(liveDesc?.overview, window.originalCloudDescData?.overview);
                        else if (sec === 'strategy') hasCollision = isDiff(liveDesc?.strategy, window.originalCloudDescData?.strategy);
                        else if (sec.startsWith('extra-')) {
                            const idx = parseInt(sec.split('-')[1]);
                            hasCollision = isDiff(liveDesc?.extras?.[idx], window.originalCloudDescData?.extras?.[idx]);
                        }
                    } else if (tabId === 'matchups' && window.currentMatchupIndex !== undefined) {
                        hasCollision = isDiff(liveDesc?.matchups?.[window.currentMatchupIndex], window.originalCloudDescData?.matchups?.[window.currentMatchupIndex]);
                    } else if (window.getKeyedSectionByTab(tabId) && tabId !== 'matchups'
                            && window.currentKeyedIndex?.[tabId] !== undefined) {
                        const field = window.getKeyedSectionByTab(tabId).field;
                        const i = window.currentKeyedIndex[tabId];
                        hasCollision = isDiff(liveDesc?.[field]?.[i], window.originalCloudDescData?.[field]?.[i]);
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
                // A character-state edit is wrapped here, once, and unwrapped
                // once in applyDeltaToData. 'multi' is the envelope around
                // deltas that have each already been wrapped, so wrapping it
                // again would nest a batch inside a state.
                // 'modes' is the page-level list of which states exist - it
                // belongs to the character, not to any one of them.
                const unwrappable = targetScope === 'multi' || targetScope === 'modes';
                const scoped = (unwrappable || typeof window.scopeEditorDelta !== 'function')
                    ? { scope: targetScope, key: targetKey }
                    : window.scopeEditorDelta(targetScope, targetKey);

                return {
                    page_id: pageId,
                    page_type: pageType,
                    // The legacy fallback is the whole page, not the slice of
                    // it currently being edited - anything reading this field
                    // instead of the delta expects a complete object.
                    desc_data: window.editorMasterDescData || window.currentEditorDescData,
                    frame_data: pageType === 'system' ? null : (window.editorMasterFrameData || window.currentEditorFrameData),
                    is_delta: true,
                    target_scope: scoped.scope,
                    target_key: scoped.key,
                    delta_payload: deltaPayload,
                    author_id: session.user.id,
                    author_name: window.currentGlobalUsername || "Contributor",
                    qa_metadata: { changelog: qaResult.changelog, confidence: qaResult.confidence, evidence: qaResult.evidence }
                };
            };

            // 1. IF INTERCEPTING: Strictly update the single intercepted ticket
            if (window.interceptedTicketData) {
                let scope = window.interceptedTicketData.target_scope;
                let key = window.interceptedTicketData.target_key;

                // Unwrap a character-state ticket back to the plain scope it
                // wraps. initEditorModes has already switched the editor into
                // that state, so currentEditor* below are the right slice and
                // buildPayload re-wraps on the way out.
                if (scope === 'mode' && typeof key === 'string') {
                    const parts = key.split('::');
                    parts.shift();
                    scope = parts.shift();
                    key = parts.join('::') || 'full';
                }

                let dPayload = {};

                if (scope === 'move') {
                    const [cat, mId] = key.split('::');
                    dPayload = {
                        frame_data: window.currentEditorFrameData[cat].find(m => m.id === mId),
                        desc_data: window.currentEditorDescData.moveStrategies[mId] || []
                    };
                } else if (scope === 'extra' || window.getKeyedSectionByScope(scope)) {
                    // 'extra' is not a tab, so it stays named here; every other
                    // array scope resolves through the vocabulary.
                    const section = window.getKeyedSectionByScope(scope);
                    dPayload = window.currentEditorDescData[section ? section.field : 'extras'][parseInt(key)];
                } else {
                    dPayload = window.currentEditorDescData[scope];
                }

                payloadsToInsert.push(buildPayload(scope, key, dPayload));
            } 
            // 2. NORMAL SUBMISSION: Multi-Payload Diff Scanner
            else {
                // --- Which states exist ---
                // Page-level, so it is scanned before the per-tab branches
                // rather than under one of them. Without this a contributor
                // could add an ultimate state, write a full kit into it, and
                // have every content delta land in modeData while the
                // declaration never shipped - leaving the work in the database
                // with no toggle on the page to reach it.
                if (!['system', 'tierlist', 'gallery', 'tool'].includes(pageType)) {
                    const localModes = (window.editorMasterFrameData || {}).modes;
                    const cloudModes = (window.originalCloudMasterFrame || {}).modes;
                    if (isDiff(localModes, cloudModes)) {
                        payloadsToInsert.push(buildPayload('modes', 'full', localModes || null));
                    }
                }

                // --- Gallery Payload ---
                // One delta per item, keyed by name, rather than one payload
                // carrying the whole list. That is what makes a gallery safe
                // with thirty contributors: two people adding different
                // emotes touch different keys and can never collide, and a
                // reviewer approving one does not drag the other's
                // half-finished work along with it.
                if (pageType === 'gallery') {
                    const localItems = (typeof window.getGalleryEditorItems === 'function'
                        ? window.getGalleryEditorItems() : []) || [];
                    const cloudItems = (window.originalCloudDescData && window.originalCloudDescData.items) || [];

                    window.buildGalleryDeltas(localItems, cloudItems).forEach(d => {
                        payloadsToInsert.push(buildPayload(d.scope, d.key, d.payload));
                    });
                }
                // --- Tool Payload ---
                // Config and prose ship as separate scopes: the config is the
                // owner's and the prose is everyone's, so a contributor fixing
                // the intro must not be able to carry a URL change with it.
                else if (pageType === 'tool') {
                    await window.triggerManualSync();
                    window.buildToolDeltas(window.currentEditorDescData, window.originalCloudDescData)
                        .forEach(d => payloadsToInsert.push(buildPayload(d.scope, d.key, d.payload)));
                }
                // --- System Payload ---
                else if (pageType === 'system' || pageType === 'tierlist') {
                    await window.triggerManualSync(); 
                    // Only push if something actually changed!
                    if (isDiff(window.currentEditorDescData, window.originalCloudDescData)) {
                        payloadsToInsert.push(buildPayload('system_data', 'full', window.currentEditorDescData));
                    }
                }
                // --- CHARACTER PAYLOAD ENGINE ---
                //
                // Scans EVERY tab, not just the open one. This used to be a
                // chain of `else if (tabId === ...)`, so a contributor who
                // edited Overview, then Skills, then Matchups and pressed
                // Submit once shipped only whatever tab happened to be open -
                // the other two were silently dropped. The v0.12 "One tab per
                // submission" notice was the stopgap; this retires it.
                //
                // Nothing had to be fetched to make this work: the editor
                // already holds the whole desc_data/frame_data object and only
                // switches which slice it renders, and switchEditorTab flushes
                // the open block buffer before moving. So every tab's edits are
                // already in memory by the time Submit is pressed - the scan
                // just never looked at them.
                //
                // Still one delta per section, so the reviewer side is
                // unchanged: several deltas from one submission become a
                // `multi` ticket, which admin already compiles and renders.
                else {
                    const scanMoveTab = (moveTab) => {
                        const localMoves = (window.currentEditorFrameData || {})[moveTab] || [];
                        const cloudMoves = (window.originalCloudFrameData || {})[moveTab] || [];

                        localMoves.forEach(m => {
                            const oldFrame = cloudMoves.find(old => old.id === m.id);
                            const oldDesc = window.originalCloudDescData.moveStrategies?.[m.id];
                            const newDesc = window.currentEditorDescData.moveStrategies?.[m.id];

                            if (isDiff(m, oldFrame) || isDiff(newDesc, oldDesc)) {
                                payloadsToInsert.push(buildPayload('move', `${moveTab}::${m.id}`, {
                                    frame_data: m,
                                    desc_data: newDesc || []
                                }));
                            }
                        });

                        cloudMoves.forEach(oldM => {
                            if (!localMoves.find(m => m.id === oldM.id)) {
                                payloadsToInsert.push(buildPayload('move', `${moveTab}::${oldM.id}`, null));
                            }
                        });
                    };

                    const scanOverview = () => {
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
                    };

                    // Every keyed section is the same shape, keyed by a
                    // different field. See js/character_tabs.js.
                    const scanKeyedList = (field, keyField, scope) => {
                        const local = window.currentEditorDescData[field] || [];
                        const cloud = window.originalCloudDescData[field] || [];

                        local.forEach(entry => {
                            const old = cloud.find(o => o[keyField] === entry[keyField]);
                            if (isDiff(entry, old)) payloadsToInsert.push(buildPayload(scope, entry[keyField], entry));
                        });

                        cloud.forEach(old => {
                            if (!local.find(e => e[keyField] === old[keyField])) {
                                payloadsToInsert.push(buildPayload(scope, old[keyField], null));
                            }
                        });
                    };

                    const scanEveryTab = () => {
                        (window.FRAME_MOVE_CATEGORIES || []).forEach(scanMoveTab);
                        scanOverview();
                        // Driven by the vocabulary, so a section added there is
                        // swept here without a second edit. Missing one is
                        // silent - the edits simply never become deltas.
                        (window.getKeyedSections ? window.getKeyedSections() : []).forEach(
                            s => scanKeyedList(s.field, s.keyField, s.scope));
                    };

                    // ...AND EVERY CHARACTER STATE, not just the open one.
                    //
                    // The tab scan above was v0.13's fix. It missed that every
                    // one of those scans reads currentEditorDescData /
                    // currentEditorFrameData, and applyEditorModeView points
                    // those at the ACTIVE STATE's slice - so it swept every tab
                    // inside one state. A contributor who edited the base kit
                    // and two ultimates and pressed Submit once shipped only
                    // whichever state was open; the rest stayed in
                    // editorMasterDescData, rode along in the desc_data
                    // fallback, and were never applied, because the reviewer
                    // applies the delta.
                    //
                    // Same bug as v0.13, one axis over, and the same fix: run
                    // the scan once per state with the views re-pointed for
                    // each pass. scopeEditorDelta already reads
                    // editorActiveMode, so each pass tags its own deltas and
                    // the nine scopes still never learn states exist.
                    //
                    // The states come from the DATA, not from the declared
                    // `modes` list. Dropping a contributor's work is the bug
                    // being fixed, so a state with a bucket but no declaration
                    // must still be scanned - and a declared state nobody ever
                    // opened has no bucket and therefore nothing to find.
                    // Reading modeData rather than declaring it also avoids
                    // writableView creating empty buckets as a side effect of
                    // scanning.
                    const collectStates = () => {
                        const base = typeof window.BASE_MODE_ID === 'string' ? window.BASE_MODE_ID : 'base';
                        const ids = [base];
                        const seen = new Set(ids);
                        [window.editorMasterDescData, window.editorMasterFrameData].forEach(master => {
                            Object.keys((master && master.modeData) || {}).forEach(id => {
                                if (!seen.has(id)) { seen.add(id); ids.push(id); }
                            });
                        });
                        return ids;
                    };

                    const states = collectStates();

                    if (states.length <= 1 || typeof window.applyEditorModeView !== 'function') {
                        // Every page with no states, which is most of them.
                        scanEveryTab();
                    } else {
                        const savedMode = window.editorActiveMode;
                        try {
                            states.forEach(modeId => {
                                window.editorActiveMode = modeId;
                                window.applyEditorModeView();
                                scanEveryTab();
                            });
                        } finally {
                            // Restored even if a scan throws. Leaving the
                            // editor pointed at the last state scanned would
                            // silently move the user somewhere they never
                            // navigated, mid-submit.
                            window.editorActiveMode = savedMode;
                            window.applyEditorModeView();
                        }
                    }
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
