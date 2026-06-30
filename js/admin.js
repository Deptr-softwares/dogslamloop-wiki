/**
 * Dogslamloop Wiki - Admin Overseer Logic
 */

window.currentQueueData = [];
window.activePreviewRevId = null;
window.activePreviewCharId = null;
window.currentUserId = null;
window.currentUserRole = null;
window.currentUsername = "Staff";
window.currentLiveDescData = {};
window.currentLiveFrameData = {};
window.currentPendingDescData = {};
window.currentPendingFrameData = {};
window.activeChatChannel = null;
window.activeTypers = new Map();
window.changedTabs = [];

// --- CUSTOM MODAL PROMISES ---
window.adminAlert = function(message) {
    const modal = document.getElementById('admin-alert-modal');
    document.getElementById('admin-alert-msg').textContent = message;
    modal.style.display = 'flex';
    document.getElementById('btn-admin-alert-ok').onclick = () => { modal.style.display = 'none'; };
};

window.adminPrompt = function(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('admin-prompt-modal');
        document.getElementById('admin-prompt-msg').textContent = message;
        const input = document.getElementById('admin-prompt-input');
        input.value = ''; 
        modal.style.display = 'flex';

        const btnOk = document.getElementById('btn-admin-prompt-ok');
        const btnCancel = document.getElementById('btn-admin-prompt-cancel');

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnCancel.onclick = () => { cleanup(); resolve(null); }; 
        btnOk.onclick = () => { cleanup(); resolve(input.value.trim()); };
    });
};

window.adminConfirm = function(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('admin-confirm-modal');
        document.getElementById('admin-confirm-msg').textContent = message;
        modal.style.display = 'flex';

        const btnOk = document.getElementById('btn-admin-confirm-ok');
        const btnCancel = document.getElementById('btn-admin-confirm-cancel');

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
};

// --- 1. RBAC SECURITY GATEKEEPER ---
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) { kickUser(); return; }

    const { data: role, error } = await window.supabaseClient.rpc('get_my_role');
    if (error || (role !== 'admin' && role !== 'reviewer')) { kickUser(); return; }

    window.currentUserId = session.user.id;
    window.currentUserRole = role; 
    window.currentUsername = window.getDisplayName ? window.getDisplayName(session) : "Staff";
    
    if (role === 'admin') document.getElementById('admin-only-tools').style.display = 'block';
    if (typeof setupTabs === 'function') setupTabs('nav', 'tab', ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'], 'major');

    // --- WORKFLOW KEY LISTENERS ---
    
    // Broadcast typing status to Supabase Realtime
    document.getElementById('ticket-chat-input').addEventListener('input', function() {
        if (window.activeChatChannel) {
            window.activeChatChannel.send({ type: 'broadcast', event: 'typing', payload: { user: window.currentUsername } });
        }
    });

    // Cleanup stale typers every second
    setInterval(() => {
        let changed = false;
        const now = Date.now();
        for (let [user, time] of window.activeTypers.entries()) {
            if (now - time > 3000) { window.activeTypers.delete(user); changed = true; }
        }
        if (changed) updateTypingText();
    }, 1000);

    // Global Keybinds
    document.addEventListener('keydown', function(e) {
        // Escape to close preview
        if (e.key === 'Escape' && window.activePreviewRevId) {
            resetPreviewState();
        }
        
        // '/' to quick-focus chat 
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            const ticketWorkspace = document.getElementById('ticket-workspace');
            if (ticketWorkspace && ticketWorkspace.style.display !== 'none') {
                e.preventDefault(); 
                document.getElementById('ticket-chat-input').focus();
            }
        }

        // Ctrl + Enter to instantly Toggle Support on a Ticket
        if (e.ctrlKey && e.key === 'Enter' && window.activePreviewRevId) {
            const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
            if (rev && rev.status === 'ticket_open') {
                e.preventDefault();
                toggleSupportToTicket();
            }
        }
    });

    loadQueue();
});

function kickUser() {
    document.body.innerHTML = `<div style="height:100vh; width:100vw; display:flex; align-items:center; justify-content:center; flex-direction:column; background:#050505;"><h1 style="color:#ef4444; font-family:'CC-Wild-Words', sans-serif;">ACCESS DENIED</h1></div>`;
}

function updateTypingText() {
    const el = document.getElementById('ticket-typing-indicator');
    if (!el) return;
    if (window.activeTypers.size === 0) el.textContent = '';
    else if (window.activeTypers.size === 1) el.textContent = Array.from(window.activeTypers.keys())[0] + ' is typing...';
    else el.textContent = 'Multiple people are typing...';
}

// --- 2. FETCH QUEUE ---
async function loadQueue() {
    const container = document.getElementById('queue-container');
    container.innerHTML = `<p class="loading-msg" style="font-size: 0.75rem;">Scanning database...</p>`;

    const { data, error } = await window.supabaseClient
        .from('pending_revisions')
        .select('*')
        .in('status', ['pending', 'ticket_open'])
        .order('created_at', { ascending: true });

    if (error) { container.innerHTML = `<p style="color:#ef4444; font-size: 0.75rem;">Error: ${error.message}</p>`; return; }

    window.currentQueueData = data || [];

    if (window.currentQueueData.length === 0) {
        container.innerHTML = `<div class="empty-tab-msg" style="border: 1px dashed #333; padding: 1.5rem 1rem; font-size: 0.7rem;">No pending revisions or open tickets.</div>`;
        return;
    }

    container.innerHTML = '';
    
    // SMART GROUPING: Organize tickets by character ID
    const groupedQueue = {};
    window.currentQueueData.forEach(rev => {
        if (!groupedQueue[rev.page_id]) groupedQueue[rev.page_id] = [];
        groupedQueue[rev.page_id].push(rev);
    });

    for (const [pageId, tickets] of Object.entries(groupedQueue)) {
        
        // Render Character Header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'flex-end';
        header.style.borderBottom = '2px solid var(--accent-blue)';
        header.style.paddingBottom = '0.5rem';
        header.style.marginBottom = '1rem';
        header.style.marginTop = '2rem';

        let mergeBtnHtml = '';
        if (tickets.length > 1 && window.currentUserRole === 'admin') {
            mergeBtnHtml = `<button onclick="window.openSmartCompiler('${pageId}')" class="submit-btn" style="color:#a855f7; border-color:#a855f7; font-size:0.65rem; padding: 0.3rem 0.6rem; box-shadow: 2px 2px 0px rgba(168,85,247,0.3); transition: all 0.1s;">✦ SMART MERGE (${tickets.length})</button>`;
        }

        header.innerHTML = `
            <h3 style="font-family:'CC-Wild-Words', sans-serif; font-size:1.1rem; color:var(--text-white); margin:0; text-transform: uppercase;">${pageId.replace(/_/g, ' ')}</h3>
            ${mergeBtnHtml}
        `;
        container.appendChild(header);

        // Render Individual Tickets
        tickets.forEach(rev => {
            rev.supporters = rev.supporters || [];
            rev.ticket_chat = rev.ticket_chat || [];

            const dateStr = new Date(rev.created_at).toLocaleDateString();
            const statusBadge = rev.status === 'ticket_open' 
                ? `<span class="update-badge" style="background: #eab308; color: #000; margin-bottom:0.25rem; font-size:0.5rem; border: none;">TICKET OPEN</span>`
                : `<span class="update-badge badge-patch" style="margin-bottom:0.25rem; font-size:0.5rem; background: var(--accent-blue); color: #000; border: none;">PENDING</span>`;

            const card = document.createElement('div');
            card.className = 'update-log-item';
            card.style.padding = '0.75rem';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            ${statusBadge}
                            <span class="update-badge" style="margin-bottom:0.25rem; font-size:0.5rem; background: #333; color: #fff; border: 1px solid #555;">${rev.page_id.toUpperCase()}</span>
                        </div>
                        <h3 class="update-title" style="font-size: 0.75rem; margin: 0;">Revision Submission</h3>
                        <div class="update-log-meta" style="margin-top:0.25rem; font-size: 0.6rem;">By: <strong style="color:var(--text-white);">${rev.author_name}</strong> | ${dateStr}</div>
                    </div>
                    <button onclick="previewRevision('${rev.id}')" class="submit-btn" style="color:var(--accent-blue); border-color:var(--accent-blue); font-size: 0.6rem; padding: 0.2rem 0.5rem;">REVIEW</button>
                </div>
            `;
            container.appendChild(card);
        });
    }
}

// --- DYNAMIC BUTTON HELPER ---
function updateActionButtons(rev) {
    const actionContainer = document.getElementById('preview-action-buttons');
    const isOwnSubmission = (rev.author_id === window.currentUserId);
    const isAdmin = (window.currentUserRole === 'admin');
    const hasEnoughSupport = ((rev.supporters || []).length >= 1);
    const hasEnoughOppose = ((rev.opposers || []).length >= 2);

    let buttonsHTML = '';
    if (isAdmin) {
        buttonsHTML += `<button onclick="approveCurrentPreview()" class="submit-btn" style="color:#22c55e; border-color:#22c55e;">FORCE APPROVE</button>`;
        buttonsHTML += `<button onclick="rejectCurrentPreview()" class="add-block-btn" style="color:#ef4444; border-color:#333;">FORCE REJECT</button>`;
    } else {
        if (isOwnSubmission) {
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="submit-btn" style="color:#eab308; border-color:#eab308;">OPEN TICKET</button>`;
            buttonsHTML += `<button onclick="rejectCurrentPreview()" class="add-block-btn" style="color:#ef4444; border-color:#333;">WITHDRAW</button>`;
        } else {
            if (hasEnoughSupport) buttonsHTML += `<button onclick="approveCurrentPreview()" class="submit-btn" style="color:#22c55e; border-color:#22c55e;">MERGE TO LIVE</button>`;
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="submit-btn" style="color:#eab308; border-color:#eab308;">OPEN TICKET</button>`;
            if (hasEnoughOppose) buttonsHTML += `<button onclick="rejectCurrentPreview()" class="add-block-btn" style="color:#ef4444; border-color:#333;">REJECT</button>`;
        }
    }
    actionContainer.innerHTML = buttonsHTML;
    actionContainer.style.display = 'flex';
}

// --- DIFF CALCULATION HELPERS ---
function getTabData(tab, mode) {
    const isFrame = ['m1s', 'skills', 'specials'].includes(tab);
    
    // Safety check: Ensure the global objects exist before trying to read them
    const liveDesc = window.currentLiveDescData || {};
    const liveFrame = window.currentLiveFrameData || {};
    const pendDesc = window.currentPendingDescData || {};
    const pendFrame = window.currentPendingFrameData || {};

    const dataObj = mode === 'live' 
        ? (isFrame ? liveFrame : liveDesc) 
        : (isFrame ? pendFrame : pendDesc);
    
    if (tab === 'overview') return { profile: dataObj.profile, overview: dataObj.overview, strategy: dataObj.strategy, extras: dataObj.extras };
    return dataObj[tab] || null;
}

function calculateTabDiffs() {
    window.changedTabs = [];
    const tabs = ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'];
    
    tabs.forEach(tab => {
        const liveStr = JSON.stringify(getTabData(tab, 'live') || {});
        const pendStr = JSON.stringify(getTabData(tab, 'pending') || {});

        if (liveStr !== pendStr) {
            window.changedTabs.push(tab);
            const btn = document.getElementById(`nav-${tab}`);
            if (btn && !btn.querySelector('.tab-changed-indicator')) {
                btn.innerHTML += `<span class="tab-changed-indicator" title="Modifications Detected">●</span>`;
            }
        }
    });
}

// --- 3. THE PREVIEW & TICKET ENGINE (WITH REALTIME SYNC) ---
async function previewRevision(revId) {
    const rev = window.currentQueueData.find(r => r.id === revId);
    if (!rev) return;

    window.activePreviewRevId = rev.id;
    window.activePreviewCharId = rev.page_id;
    document.getElementById('preview-status-text').innerHTML = `REVIEWING: <strong style="color: var(--text-white);">${rev.page_id.toUpperCase()}</strong> (By ${rev.author_name})`;
    
    updateActionButtons(rev);
    document.getElementById('preview-nav-sidebar').style.display = 'block';

    // 1. Fetch Live DB Data for the Comparison Tool
    const { data: liveData } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', rev.page_id).single();
    window.currentLiveDescData = liveData ? liveData.desc_data : {};
    window.currentLiveFrameData = liveData ? liveData.frame_data : {};
    window.currentPendingDescData = rev.desc_data;
    window.currentPendingFrameData = rev.frame_data;

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.style.display = 'flex';

    calculateTabDiffs();

    // 2. Realtime Ticket Subscriptions
    if (window.activeChatChannel) { window.supabaseClient.removeChannel(window.activeChatChannel); }
    window.activeTypers.clear();
    if(typeof updateTypingText === 'function') updateTypingText();

    if (rev.status === 'ticket_open') {
        const ticketWorkspace = document.getElementById('ticket-workspace');
        ticketWorkspace.style.display = 'flex';
        renderTicketWorkspace(rev, (rev.author_id === window.currentUserId), (rev.supporters || []).includes(window.currentUserId), (rev.opposers || []).includes(window.currentUserId));
        
        // Connect to Realtime Typing Broadcast AND Live Database Changes
        window.activeChatChannel = window.supabaseClient.channel('ticket-' + rev.id)
            .on('broadcast', { event: 'typing' }, payload => {
                if(payload.payload.user !== window.currentUsername) {
                    window.activeTypers.set(payload.payload.user, Date.now());
                    if(typeof updateTypingText === 'function') updateTypingText();
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_revisions', filter: 'id=eq.' + rev.id }, payload => {
                const updatedRev = payload.new;
                const localRev = window.currentQueueData.find(r => r.id === rev.id);
                
                if (localRev) {
                    // Update Local Cache instantly
                    localRev.supporters = updatedRev.supporters || [];
                    localRev.opposers = updatedRev.opposers || [];
                    localRev.ticket_chat = updatedRev.ticket_chat || [];
                    
                    // If we are currently looking at this ticket, update the UI live!
                    if (window.activePreviewRevId === rev.id) {
                        renderTicketWorkspace(localRev, (localRev.author_id === window.currentUserId), localRev.supporters.includes(window.currentUserId), localRev.opposers.includes(window.currentUserId));
                        updateActionButtons(localRev);
                    }
                }
            })
            .subscribe();

    } else {
        document.getElementById('ticket-workspace').style.display = 'none';
    }
    
    const contentArea = document.getElementById('preview-content-area');
    contentArea.style.opacity = '1';
    contentArea.style.pointerEvents = 'auto';

    // 3. Boot up the comparison tool in "Pending" mode
    switchVersionView('pending');
}

// --- 3. VERSION COMPARISON ENGINE ---
async function switchVersionView(mode) {
    // UI Button Updates
    const btns = { 'pending': document.getElementById('btn-view-pending'), 'live': document.getElementById('btn-view-live'), 'diff': document.getElementById('btn-view-diff') };
    Object.values(btns).forEach(b => {
        if(!b) return;
        b.className = 'system-page-btn';
        b.style.color = ''; b.style.borderColor = '';
    });
    
    if(btns[mode]) {
        btns[mode].className = 'submit-btn';
        if (mode === 'pending') { btns[mode].style.color = 'var(--accent-blue)'; btns[mode].style.borderColor = 'var(--accent-blue)'; }
        if (mode === 'live') { btns[mode].style.color = '#22c55e'; btns[mode].style.borderColor = '#22c55e'; }
        if (mode === 'diff') { btns[mode].style.color = '#a855f7'; btns[mode].style.borderColor = '#a855f7'; }
    }

    // Hijack Engine Cache based on mode
    if (mode === 'pending') {
        window.currentEditorDescData = window.currentPendingDescData;
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentPendingFrameData;
    } else if (mode === 'live') {
        window.currentEditorDescData = window.currentLiveDescData;
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentLiveFrameData;
    } else if (mode === 'diff') {
        // Hide normal tabs
        ['m1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(t => {
            const el = document.getElementById(`tab-${t}`);
            if(el) { el.innerHTML = ''; el.classList.add('hidden'); }
        });

        const diffContainer = document.getElementById('tab-overview');
        diffContainer.innerHTML = `<h2 class="section-title">VERSION COMPARISON (VISUAL DIFF)</h2>`;
        diffContainer.classList.remove('hidden');
        
        if (window.changedTabs.length === 0) {
            diffContainer.innerHTML += `<p style="color:var(--text-muted); font-style:italic;">No changes detected between Live and Pending.</p>`;
            return;
        }

        let diffRenderQueue = [];

        const compareAndRender = (sectionName, oldData, newData, type = 'blocks') => {
            const oldStr = JSON.stringify(oldData || null);
            const newStr = JSON.stringify(newData || null);

            if (oldStr !== newStr) {
                const safeId = sectionName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 10000);
                let oldHtml = '<i style="color:#ef4444; opacity:0.7; font-size: 0.8rem;">(Empty or Deleted)</i>';
                let newHtml = '<i style="color:#22c55e; opacity:0.7; font-size: 0.8rem;">(Empty or Deleted)</i>';

                if (type === 'blocks') {
                    const oldBlocks = Array.isArray(oldData) ? oldData : [];
                    const newBlocks = Array.isArray(newData) ? newData : [];

                    if (oldBlocks.length > 0) {
                        oldHtml = `<div id="diff-old-${safeId}" class="wiki-section" style="margin-top: 1rem; border-color: #ef4444; background: transparent; pointer-events: none;"></div>`;
                        diffRenderQueue.push(() => { if(typeof window.populateTextSection === 'function') window.populateTextSection(`diff-old-${safeId}`, '', oldBlocks); });
                    }
                    if (newBlocks.length > 0) {
                        newHtml = `<div id="diff-new-${safeId}" class="wiki-section" style="margin-top: 1rem; border-color: #22c55e; background: transparent; pointer-events: none;"></div>`;
                        diffRenderQueue.push(() => { if(typeof window.populateTextSection === 'function') window.populateTextSection(`diff-new-${safeId}`, '', newBlocks); });
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
                    if(oldData) oldHtml = `<pre style="margin-top: 1rem; font-family: var(--text-mono); font-size: 0.65rem; white-space: pre-wrap;">${JSON.stringify(oldData, null, 2)}</pre>`;
                    if(newData) newHtml = `<pre style="margin-top: 1rem; font-family: var(--text-mono); font-size: 0.65rem; white-space: pre-wrap;">${JSON.stringify(newData, null, 2)}</pre>`;
                }

                diffContainer.innerHTML += `
                    <div class="diff-container" style="padding: 1.5rem; margin-bottom: 2rem;">
                        <h3 class="diff-section-title" style="margin-bottom: 0.5rem;">${sectionName.toUpperCase()}</h3>
                        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                            <div class="diff-block-old" style="flex: 1; min-width: 300px; padding: 1rem; background: hsla(0, 100%, 50%, 0.05); border-left: 3px solid #ef4444;">
                                <strong style="color: #ef4444; font-family:var(--text-mono); font-size:0.75rem;">[-] LIVE CLOUD DATA (OLD):</strong>
                                ${oldHtml}
                            </div>
                            <div class="diff-block-new" style="flex: 1; min-width: 300px; padding: 1rem; background: hsla(120, 100%, 25%, 0.05); border-left: 3px solid #22c55e;">
                                <strong style="color: #22c55e; font-family:var(--text-mono); font-size:0.75rem;">[+] PENDING DATA (NEW):</strong>
                                ${newHtml}
                            </div>
                        </div>
                    </div>
                `;
            }
        };

        const compareArrayOfObjects = (sectionPrefix, oldArr, newArr, keyProp, type) => {
            const oldMap = new Map((oldArr || []).map(item => [item[keyProp] || 'Unknown', item]));
            const newMap = new Map((newArr || []).map(item => [item[keyProp] || 'Unknown', item]));
            const allKeys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));

            allKeys.forEach(key => {
                const oldItem = oldMap.get(key);
                const newItem = newMap.get(key);
                if (type === 'blocks') compareAndRender(`${sectionPrefix}: ${key}`, oldItem ? oldItem.content : null, newItem ? newItem.content : null, 'blocks');
                else compareAndRender(`${sectionPrefix}: ${key}`, oldItem, newItem, 'json');
            });
        };

        window.changedTabs.forEach(tab => {
            const oldTab = getTabData(tab, 'live') || {};
            const newTab = getTabData(tab, 'pending') || {};

            if (tab === 'overview') {
                compareAndRender('Profile Metadata', oldTab.profile, newTab.profile, 'profile');
                compareAndRender('Character Overview', oldTab.overview, newTab.overview, 'blocks');
                compareAndRender('General Strategy', oldTab.strategy, newTab.strategy, 'blocks');
                compareArrayOfObjects('Custom Tab', oldTab.extras, newTab.extras, 'title', 'blocks');
                
                const oldStrats = oldTab.moveStrategies || {};
                const newStrats = newTab.moveStrategies || {};
                const allKeys = Array.from(new Set([...Object.keys(oldStrats), ...Object.keys(newStrats)]));
                allKeys.forEach(k => compareAndRender(`Move Strategy: ${k}`, oldStrats[k], newStrats[k], 'blocks'));
            } else if (tab === 'matchups') {
                compareArrayOfObjects('Matchup', oldTab, newTab, 'opponent', 'blocks');
            } else if (tab === 'counterplay') {
                compareArrayOfObjects('Counterplay Topic', oldTab, newTab, 'topic', 'blocks');
            } else if (['m1s', 'skills', 'specials'].includes(tab)) {
                compareArrayOfObjects(`Frame Data (${tab})`, oldTab, newTab, 'id', 'json');
            }
        });
        
        diffRenderQueue.forEach(fn => fn());
        if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
        return; 
    }

    // Fire rendering Engines (For Live / Pending views only)
    ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tab => {
        const el = document.getElementById(`tab-${tab}`);
        if (el) el.innerHTML = ''; 
    });

    if (typeof loadCharacterDescriptions === 'function') await loadCharacterDescriptions(window.activePreviewCharId);
    if (typeof loadMoveSection === 'function') {
        await loadMoveSection(window.activePreviewCharId, 'm1s');
        await loadMoveSection(window.activePreviewCharId, 'skills');
        await loadMoveSection(window.activePreviewCharId, 'specials');
    }
}

// --- 4. TICKET LOGIC (VOTING & CHAT) ---
function renderTicketWorkspace(rev, isOwnSubmission, hasSupported, hasOpposed) {
    const supportText = document.getElementById('ticket-support-text');
    const opposeText = document.getElementById('ticket-oppose-text');
    const supportActions = document.getElementById('ticket-support-actions');
    const chatLog = document.getElementById('ticket-chat-log');
    
    rev.opposers = rev.opposers || [];
    supportText.innerHTML = `Supports: <strong style="color:var(--text-white)">${rev.supporters.length}</strong> / 1 Required`;
    opposeText.innerHTML = `Opposes: <strong style="color:var(--text-white)">${rev.opposers.length}</strong> / 2 Required`;
    
    if (isOwnSubmission) {
        supportActions.innerHTML = `<span style="color:#ef4444; font-size:0.65rem; font-family:var(--text-mono);">Cannot vote on own submission.</span>`;
    } else {
        const supBtn = hasSupported 
            ? `<button type="button" onclick="toggleSupportToTicket()" class="add-block-btn" style="flex:1; color:#ef4444; border-color:#333; font-size:0.6rem; padding:0.4rem;">UN-SUPPORT</button>`
            : `<button type="button" onclick="toggleSupportToTicket()" class="submit-btn" style="flex:1; color:#22c55e; border-color:#22c55e; font-size:0.6rem; padding:0.4rem;">SUPPORT</button>`;
            
        const oppBtn = hasOpposed 
            ? `<button type="button" onclick="toggleOpposeToTicket()" class="add-block-btn" style="flex:1; color:#ef4444; border-color:#333; font-size:0.6rem; padding:0.4rem;">REMOVE OPPOSE</button>`
            : `<button type="button" onclick="toggleOpposeToTicket()" class="submit-btn" style="flex:1; color:#eab308; border-color:#eab308; font-size:0.6rem; padding:0.4rem;">OPPOSE</button>`;

        supportActions.innerHTML = `<div style="display:flex; gap:0.5rem; width:100%;">${supBtn}${oppBtn}</div>`;
    }

    // --- INJECT QA METADATA ---
    const qa = rev.qa_metadata || {};
    const qaHtml = `
        <div style="margin-bottom: 0.5rem;"><strong style="color:var(--text-white);">Changelog:</strong><br>${qa.changelog || 'No changelog provided.'}</div>
        <div style="margin-bottom: 0.5rem;"><strong style="color:var(--text-white);">Confidence:</strong><br>${qa.confidence || 'Unrated'}</div>
        <div><strong style="color:var(--text-white);">Evidence:</strong><br>${qa.evidence ? `<a href="${qa.evidence}" target="_blank" style="color:var(--accent-blue); text-decoration:underline;">[View Attached Link]</a>` : 'No evidence linked.'}</div>
    `;
    document.getElementById('ticket-qa-report').innerHTML = qaHtml;

    chatLog.innerHTML = '';
    if (rev.ticket_chat.length === 0) {
        chatLog.innerHTML = `<span style="color:#555; font-style:italic;">No messages yet.</span>`;
    } else {
        rev.ticket_chat.forEach(msg => {
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            chatLog.innerHTML += `<div><strong style="color:var(--accent-blue)">[${timeStr}] ${msg.author}:</strong> ${msg.text}</div>`;
        });
        chatLog.scrollTop = chatLog.scrollHeight;
    }
}

async function toggleSupportToTicket() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (rev.author_id === window.currentUserId) return;

    const { data: liveRev } = await window.supabaseClient.from('pending_revisions').select('supporters, opposers').eq('id', rev.id).single();
    let newSupporters = liveRev.supporters || [];
    let newOpposers = liveRev.opposers || [];
    
    if (newSupporters.includes(window.currentUserId)) {
        newSupporters = newSupporters.filter(id => id !== window.currentUserId); // Un-support
    } else {
        newSupporters.push(window.currentUserId); // Support
        newOpposers = newOpposers.filter(id => id !== window.currentUserId); // Removes oppose if switching sides
    }
    
    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);
    
    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    previewRevision(rev.id); // Triggers the button visibility logic
}

async function toggleOpposeToTicket() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (rev.author_id === window.currentUserId) return;

    const { data: liveRev } = await window.supabaseClient.from('pending_revisions').select('supporters, opposers').eq('id', rev.id).single();
    let newSupporters = liveRev.supporters || [];
    let newOpposers = liveRev.opposers || [];
    
    if (newOpposers.includes(window.currentUserId)) {
        newOpposers = newOpposers.filter(id => id !== window.currentUserId); // Remove Oppose
    } else {
        newOpposers.push(window.currentUserId); // Oppose
        newSupporters = newSupporters.filter(id => id !== window.currentUserId); // Removes support if switching sides
    }
    
    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);
    
    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    previewRevision(rev.id); // Triggers the button visibility logic
}

async function postTicketMessage() {
    if (!window.activePreviewRevId) return;
    const input = document.getElementById('ticket-chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    input.disabled = true;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    
    // 1. Fetch live DB state to prevent desync/overwrites!
    const { data: liveRev, error: fetchErr } = await window.supabaseClient
        .from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];
    
    const newMessage = {
        author: window.currentUsername,
        text: text,
        timestamp: Date.now()
    };
    
    const newChat = [...currentChat, newMessage];
    
    // 2. Push to DB
    const { error } = await window.supabaseClient.from('pending_revisions')
        .update({ ticket_chat: newChat }).eq('id', rev.id);
        
    input.disabled = false;
    input.value = '';
    
    if (error) { adminAlert("Failed to send message: " + error.message); return; }
    
    // 3. Update Local Cache (Without reloading the queue!)
    rev.ticket_chat = newChat;
    
    // 4. Visually update the Workspace chat log instantly
    renderTicketWorkspace(rev, rev.author_id === window.currentUserId, (rev.supporters || []).includes(window.currentUserId));
    
    // Optional: Return focus to input for rapid typing
    setTimeout(() => document.getElementById('ticket-chat-input').focus(), 10);
}

// --- 5. MODERATION ACTIONS (MERGE/REJECT) ---
async function approveCurrentPreview() {
    if(!window.activePreviewRevId) return;
    const msg = window.currentUserRole === 'admin' ? "FORCE APPROVE: Overwrite the live wiki page?" : "MERGE: This ticket has enough support. Push to live wiki?";
    
    if(!(await adminConfirm(msg))) return;

    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    const livePayload = { 
        page_id: revData.page_id, 
        page_type: revData.page_type, 
        desc_data: revData.desc_data, 
        frame_data: revData.frame_data 
    };

    const { error: liveError } = await window.supabaseClient.from('page_data').upsert([livePayload], { onConflict: 'page_id' });
    if (liveError) { window.adminAlert("Merge Failed: " + liveError.message); return; }

    await window.supabaseClient.from('pending_revisions').update({ status: 'approved', ticket_chat: [], supporters: [] }).eq('id', window.activePreviewRevId);
    
    // --- DISPATCH NOTIFICATION ---
    const pageUrl = revData.page_type === 'system' 
        ? `../../systems/${revData.page_id}/index.html` 
        : `../../characters/${revData.page_id.charAt(0).toUpperCase() + revData.page_id.slice(1)}/index.html`;

    await window.supabaseClient.from('user_notifications').insert([{
        user_id: revData.author_id,
        message: `Your revision for "${revData.page_id.toUpperCase()}" has been approved and merged!`,
        link: pageUrl
    }]);

    window.adminAlert("Revision approved and merged to live database!");
    resetPreviewState(); loadQueue();
}

async function rejectCurrentPreview() {
    if(!window.activePreviewRevId) return;
    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    
    let finalReason = "Withdrawn by author.";
    
    // If rejecting someone ELSE's ticket, force the admin to provide a reason
    if (revData.author_id !== window.currentUserId) {
        const reason = await window.adminPrompt(`Please provide a reason for declining this ${revData.page_id.toUpperCase()} revision:`);
        if (reason === null) return; // Admin clicked Cancel
        finalReason = reason === '' ? 'No specific reason provided.' : reason;
    } else {
        if(!(await window.adminConfirm("Withdraw your own submission?"))) return;
    }

    const { error: deleteError } = await window.supabaseClient
        .from('pending_revisions')
        .delete()
        .eq('id', window.activePreviewRevId);

    if (deleteError) {
        console.error("Failed to delete ticket:", deleteError);
        window.adminAlert("Error: Failed to discard the revision from the database.");
        return;
    }

    // --- DISPATCH NOTIFICATION ---
    const pageUrl = revData.page_type === 'system' 
        ? `../../systems/${revData.page_id}/index.html` 
        : `../../characters/${revData.page_id.charAt(0).toUpperCase() + revData.page_id.slice(1)}/index.html`;

    await window.supabaseClient.from('user_notifications').insert([{
        user_id: revData.author_id,
        message: `Your revision for "${revData.page_id.toUpperCase()}" was declined. Staff Note: "${finalReason}"`,
        link: pageUrl
    }]);

    window.adminAlert("Revision permanently discarded and author notified.");
    resetPreviewState(); 
    loadQueue();
}

async function openTicketCurrentPreview() {
    if(!window.activePreviewRevId) return;
    
    if(!(await adminConfirm("Open a discussion ticket for this revision?"))) return;
    
    await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', window.activePreviewRevId);
    adminAlert("Ticket opened successfully.");
    
    resetPreviewState(); loadQueue();
}

function resetPreviewState() {
    window.activePreviewRevId = null;
    window.activePreviewCharId = null;
    document.getElementById('preview-status-text').textContent = "Select a revision from the queue to preview...";
    document.getElementById('preview-action-buttons').style.display = 'none';
    document.getElementById('preview-nav-sidebar').style.display = 'none';
    document.getElementById('ticket-workspace').style.display = 'none';

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.style.display = 'none';
    
    const contentArea = document.getElementById('preview-content-area');
    contentArea.style.opacity = '0.2';
    contentArea.style.pointerEvents = 'none';
    
    ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tab => {
        const el = document.getElementById(`tab-${tab}`);
        const btn = document.getElementById(`nav-${tab}`);
        if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
        if (btn) {
            btn.classList.remove('active');
            const indicator = btn.querySelector('.tab-changed-indicator');
            if (indicator) indicator.remove();
        }
    });

    document.getElementById('tab-overview').classList.remove('hidden');
    document.getElementById('nav-overview').classList.add('active');
    document.getElementById('dynamic-toc').innerHTML = '<li><p style="color: var(--text-muted); font-style: italic; font-size: 0.75rem; padding: 0.25rem 0.75rem;">Navigation unavailable.</p></li>';
}

// --- 6. KILL ORPHANS ---
async function runGarbageCollector() {
    const btn = document.getElementById('btn-run-gc');
    const results = document.getElementById('gc-results');
    
    if(!(await adminConfirm("SYSTEM WARNING: Scan and permanently delete any unlinked cloud files?"))) return;
    
    btn.textContent = "SCANNING..."; btn.disabled = true;
    results.innerHTML = "Fetching files from cloud storage...<br>";

    try {
        const { data: storageFiles, error: storageErr } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
        if (storageErr) throw storageErr;
        
        const actualFiles = storageFiles.filter(f => !f.name.startsWith('.'));
        if (actualFiles.length === 0) {
            results.innerHTML += "<span style='color:#22c55e'>Bucket is empty. Clean.</span>";
            btn.textContent = "SCAN & PURGE MEDIA"; btn.disabled = false;
            return;
        }

        results.innerHTML += "Analyzing Live and Pending data...<br>";

        const [ {data: liveData}, {data: pendingData} ] = await Promise.all([
            window.supabaseClient.from('page_data').select('desc_data, frame_data'),
            window.supabaseClient.from('pending_revisions').select('desc_data, frame_data')
        ]);

        const massiveDataString = JSON.stringify(liveData || []) + JSON.stringify(pendingData || []);
        const orphanedFiles = actualFiles.filter(file => !massiveDataString.includes(file.name));

        if (orphanedFiles.length === 0) {
            results.innerHTML += "<span style='color:#22c55e'>All files actively linked.</span>";
        } else {
            const fileNamesToDelete = orphanedFiles.map(f => f.name);
            const { error: delErr } = await window.supabaseClient.storage.from('wiki-media').remove(fileNamesToDelete);
            if (delErr) throw delErr;
            results.innerHTML += `<span style='color:#22c55e'>Deleted ${orphanedFiles.length} orphaned files.</span>`;
        }
    } catch (err) {
        results.innerHTML += `<span style='color:#ef4444'>Error: ${err.message}</span>`;
    }
    btn.textContent = "SCAN & PURGE MEDIA"; btn.disabled = false;
}

// --- 7. PERSONNEL MANAGEMENT ---
async function changeUserRole() {
    const email = document.getElementById('target-email').value.trim();
    const newRole = document.getElementById('target-role').value;
    const results = document.getElementById('role-results');

    if (!email) { results.innerHTML = "<span style='color:#ef4444'>Please enter an email address.</span>"; return; }
    if (!(await adminConfirm(`Are you sure you want to change ${email}'s clearance to ${newRole.toUpperCase()}?`))) return;

    results.innerHTML = "Processing override...";

    const { data, error } = await window.supabaseClient.rpc('assign_role_by_email', { target_email: email, assigned_role: newRole });

    if (error) {
        results.innerHTML = `<span style='color:#ef4444'>Error: ${error.message}</span>`;
    } else {
        results.innerHTML = `<span style='color:#22c55e'>${data}</span>`;
        document.getElementById('target-email').value = '';
    }
}

// --- 8. SMART MERGE COMPILER ENGINE ---
window.openSmartCompiler = async function(pageId) {
    const modal = document.getElementById('compiler-modal-overlay');
    const body = document.getElementById('compiler-modal-body');
    const titleSpan = document.getElementById('compiler-char-name');
    const confirmBtn = document.getElementById('btn-compiler-confirm');
    
    titleSpan.textContent = pageId.toUpperCase();
    body.innerHTML = `<p style="color:var(--text-muted); font-style:italic; text-align: center; padding: 2rem;">Analyzing revisions and fetching live database...</p>`;
    modal.style.display = 'flex';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';

    // 1. Fetch current Live Data to use as our base
    const { data: liveData, error: liveErr } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
    
    const liveDesc = (liveData && liveData.desc_data) ? liveData.desc_data : {};
    const liveFrame = (liveData && liveData.frame_data) ? liveData.frame_data : {};

    // 2. Fetch all tickets for this character and sort oldest -> newest
    const tickets = window.currentQueueData.filter(r => r.page_id === pageId).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

    // 3. Find Conflicts (Sections that differ from the live DB)
    const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);
    const conflicts = []; 
    
    const addConflict = (sectionId, sectionName, type, lData, lStratData = null) => {
        let existing = conflicts.find(c => c.sectionId === sectionId);
        if (!existing) {
            existing = { sectionId, sectionName, type, liveData: lData, liveStratData: lStratData, options: [] };
            conflicts.push(existing);
        }
        return existing;
    };

    tickets.forEach(t => {
        const tDesc = t.desc_data || {};
        const tFrame = t.frame_data || {};

        if (isDiff(tDesc.profile, liveDesc.profile)) addConflict('profile', 'Profile Metadata', 'desc', liveDesc.profile).options.push({ ticket: t, data: tDesc.profile });
        if (isDiff(tDesc.overview, liveDesc.overview)) addConflict('overview', 'Character Overview', 'desc', liveDesc.overview).options.push({ ticket: t, data: tDesc.overview });
        if (isDiff(tDesc.strategy, liveDesc.strategy)) addConflict('strategy', 'General Strategy', 'desc', liveDesc.strategy).options.push({ ticket: t, data: tDesc.strategy });
        if (isDiff(tDesc.extras, liveDesc.extras)) addConflict('extras', 'Custom Tabs (Extras)', 'desc', liveDesc.extras).options.push({ ticket: t, data: tDesc.extras });
        if (isDiff(tDesc.matchups, liveDesc.matchups)) addConflict('matchups', 'Matchups', 'desc', liveDesc.matchups).options.push({ ticket: t, data: tDesc.matchups });
        if (isDiff(tDesc.counterplay, liveDesc.counterplay)) addConflict('counterplay', 'Counterplay', 'desc', liveDesc.counterplay).options.push({ ticket: t, data: tDesc.counterplay });

        // Iterate deep into the individual moves
        ['m1s', 'skills', 'specials'].forEach(cat => {
            const tMoves = tFrame[cat] || [];
            const lMoves = liveFrame[cat] || [];
            const allMoveIds = new Set([...tMoves.map(m=>m.id), ...lMoves.map(m=>m.id)]);

            allMoveIds.forEach(moveId => {
                const tMove = tMoves.find(m => m.id === moveId);
                const lMove = lMoves.find(m => m.id === moveId);
                const tStrat = (tDesc.moveStrategies || {})[moveId];
                const lStrat = (liveDesc.moveStrategies || {})[moveId];

                if (isDiff(tMove, lMove) || isDiff(tStrat, lStrat)) {
                    addConflict(`move_${cat}_${moveId}`, `Move: ${cat.toUpperCase()} / ${moveId}`, 'move', { move: lMove, cat: cat }, lStrat).options.push({
                        ticket: t,
                        data: { move: tMove, cat: cat },
                        stratData: tStrat
                    });
                }
            });
        });
    });

    // 4. Render the UI Checklist
    if (conflicts.length === 0) {
        body.innerHTML = `<p style="color:var(--text-muted); padding: 2rem; border: 1px dashed #333; text-align: center;">No mergeable changes detected in these tickets. They may be functionally identical to the live database.</p>`;
        return; 
    }

    let html = `<p style="font-family:var(--text-mono); font-size:0.75rem; color:#888; margin-bottom:1.5rem; line-height:1.5;">Select the version to keep for each modified section. The compiler will merge your selections into a new Master Ticket, approve the chosen source tickets, and leave any completely discarded tickets in the pending queue.</p>`;

    conflicts.forEach(c => {
        let selectHtml = `<select id="compiler-sel-${c.sectionId}" class="editor-select" style="margin-bottom: 0; border-color: #a855f7; background: rgba(168,85,247,0.1); color: #fff; font-weight: bold;">`;
        selectHtml += `<option value="live" style="color:#888; font-weight: normal;">[DISCARD] Keep current live data</option>`;

        c.options.forEach((opt, idx) => {
            const isLast = (idx === c.options.length - 1);
            const dateStr = new Date(opt.ticket.created_at).toLocaleDateString();
            // Pre-selects the newest ticket by default
            selectHtml += `<option value="${opt.ticket.id}" ${isLast ? 'selected' : ''}>[MERGE] By ${opt.ticket.author_name} (${dateStr})</option>`;
        });
        selectHtml += `</select>`;

        html += `
            <div style="background: rgba(255,255,255,0.02); border: 1px solid #333; padding: 0.75rem; margin-bottom: 0.75rem; border-left: 3px solid #a855f7;">
                <div style="font-family:'CC-Wild-Words', sans-serif; font-size:0.8rem; color:#fff; margin-bottom:0.5rem; text-transform: uppercase;">${c.sectionName}</div>
                ${selectHtml}
            </div>
        `;
    });

    body.innerHTML = html;
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';

    // 5. Build Master Payload and Push to Queue
    confirmBtn.onclick = async () => {
        if (!(await window.adminConfirm(`Compile these selections into a new Master Ticket for review?`))) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = "COMPILING TICKET...";

        const masterDesc = JSON.parse(JSON.stringify(liveDesc));
        const masterFrame = JSON.parse(JSON.stringify(liveFrame));
        const selectedTicketIds = new Set();

        conflicts.forEach(c => {
            const selVal = document.getElementById(`compiler-sel-${c.sectionId}`).value;
            if (selVal === 'live') return; // Do nothing, keep live DB version

            const chosenOpt = c.options.find(o => o.ticket.id === selVal);
            if (!chosenOpt) return;

            // Track that this ticket was explicitly selected for at least one conflict
            selectedTicketIds.add(selVal);

            // Inject Text Data
            if (c.type === 'desc') {
                masterDesc[c.sectionId] = chosenOpt.data;
            } 
            // Inject Frame/Move Data
            else if (c.type === 'move') {
                const cat = chosenOpt.data.cat;
                const moveData = chosenOpt.data.move;
                const stratData = chosenOpt.stratData;
                
                const prefix = `move_${cat}_`;
                const moveId = c.sectionId.substring(prefix.length);

                if (!masterFrame[cat]) masterFrame[cat] = [];
                const existingIdx = masterFrame[cat].findIndex(m => m.id === moveId);

                // Add or Replace Move Stats
                if (moveData) {
                    if (existingIdx > -1) masterFrame[cat][existingIdx] = moveData;
                    else masterFrame[cat].push(moveData);
                } else {
                    if (existingIdx > -1) masterFrame[cat].splice(existingIdx, 1);
                }

                // Add or Replace Move Strategy Blocks
                if (!masterDesc.moveStrategies) masterDesc.moveStrategies = {};
                if (stratData) masterDesc.moveStrategies[moveId] = stratData;
                else delete masterDesc.moveStrategies[moveId];
            }
        });

        // Safety catch if the admin discards everything
        if (selectedTicketIds.size === 0) {
            window.adminAlert("No tickets were selected. All conflicts were set to keep Live Data.");
            modal.style.display = 'none';
            confirmBtn.textContent = "COMPILE MASTER TICKET";
            return;
        }

        // --- THE ANTI-SPAM BYPASS FIX ---
        // Instead of INSERTING a new row, we hijack the newest selected ticket 
        // and UPDATE it to become the host for the Master Ticket.
        const chosenTickets = tickets.filter(t => selectedTicketIds.has(t.id));
        const masterTicket = chosenTickets[chosenTickets.length - 1]; 
        const otherTicketIds = chosenTickets.filter(t => t.id !== masterTicket.id).map(t => t.id);

        const payload = {
            desc_data: masterDesc,
            frame_data: masterFrame,
            author_id: window.currentUserId,
            author_name: window.currentUsername + " (Compiler)",
            status: 'ticket_open', 
            qa_metadata: {
                changelog: `System Merge: Compiled from ${selectedTicketIds.size} different submissions.`,
                confidence: "high",
                evidence: masterTicket.qa_metadata?.evidence || ""
            }
        };

        // 1. Transform the host ticket into the Master Ticket
        const { error: updateError } = await window.supabaseClient
            .from('pending_revisions')
            .update(payload)
            .eq('id', masterTicket.id);
        
        if (updateError) { 
            window.adminAlert("Merge Failed: " + updateError.message); 
            confirmBtn.disabled = false;
            confirmBtn.textContent = "COMPILE MASTER TICKET";
            return; 
        }

        // 2. Mark the OTHER explicitly selected source tickets as officially merged
        if (otherTicketIds.length > 0) {
            await window.supabaseClient.from('pending_revisions')
                .update({ status: 'approved', ticket_chat: [], supporters: [] })
                .in('id', otherTicketIds);
        }

        // 3. Map Notifications for the chosen authors
        const pageUrl = tickets[0].page_type === 'system' 
            ? `../../systems/${pageId}/index.html` 
            : `../../characters/${pageId.charAt(0).toUpperCase() + pageId.slice(1)}/index.html`;

        const notifications = chosenTickets.map(t => ({
            user_id: t.author_id,
            message: `Your revision for "${pageId.toUpperCase()}" was included in a Master Merge ticket for staff review!`,
            link: pageUrl
        }));

        const uniqueNotifications = Array.from(new Map(notifications.map(item => [item.user_id, item])).values());
        await window.supabaseClient.from('user_notifications').insert(uniqueNotifications);

        window.adminAlert(`Successfully compiled ${selectedTicketIds.size} tickets into a new Master Ticket! Unselected edits remain in the queue.`);
        modal.style.display = 'none';
        confirmBtn.textContent = "COMPILE MASTER TICKET";
        
        resetPreviewState(); 
        loadQueue();
    };
};