/**
 * Dogslamloop Wiki - Admin Overseer Logic (Master Version)
 */

window.currentQueueData = [];
window.activePreviewRevId = null;
window.activePreviewCharId = null;
window.currentUserId = null;
window.currentUserRole = null;
window.currentUsername = "Staff";

// Core Data State
window.currentLiveDescData = {};
window.currentLiveFrameData = {};
window.currentPendingDescData = {};
window.currentPendingFrameData = {};

window.activeChatChannel = null;
window.activeTypers = new Map();
window.changedTabs = [];

// --- TIME FORMATTER HELPER ---
function timeSince(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " mins ago";
    return Math.floor(seconds) + " secs ago";
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
            rawOps.unshift({ type: 'ins', text: b[j - 1] });
            j--;
        } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            rawOps.unshift({ type: 'del', text: a[i - 1] });
            i--;
        }
    }

    for (let k = 1; k < rawOps.length - 1; k++) {
        if (rawOps[k].type === 'eq' && (!rawOps[k].text.trim() || rawOps[k].text.length === 1)) {
            if (rawOps[k-1].type !== 'eq' && rawOps[k+1].type !== 'eq') {
                rawOps[k].type = 'trivial';
            }
        }
    }

    let finalHtml = '';
    let currentDels = '';
    let currentInss = '';

    const flushEdits = () => {
        if (currentDels) finalHtml += `<del class="diff-del">${currentDels}</del>`;
        if (currentInss) finalHtml += `<ins class="diff-add">${currentInss}</ins>`;
        currentDels = '';
        currentInss = '';
    };

    for (const op of rawOps) {
        if (op.type === 'eq') {
            flushEdits();
            finalHtml += op.text;
        } else if (op.type === 'del') {
            currentDels += op.text;
        } else if (op.type === 'ins') {
            currentInss += op.text;
        } else if (op.type === 'trivial') {
            currentDels += op.text;
            currentInss += op.text;
        }
    }
    flushEdits(); 

    return finalHtml;
};

// --- THE DELTA INJECTION ENGINE ---
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    // --- SMART BATCH UNPACKER ---
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

// --- CUSTOM MODAL PROMISES ---
window.adminAlert = function(message) {
    const modal = document.getElementById('admin-alert-modal');
    document.getElementById('admin-alert-msg').textContent = message;
    modal.style.display = 'flex';
    document.getElementById('btn-admin-alert-ok').onclick = () => { modal.style.display = 'none'; };
};

window.adminPrompt = function(message, title = "SYSTEM PROMPT", confirmText = "CONFIRM", isDanger = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('admin-prompt-modal');
        
        // The modal box is always the first child of the overlay
        const modalBox = modal.firstElementChild; 
        const titleEl = modalBox ? modalBox.querySelector('h3') : null;
        const msgEl = document.getElementById('admin-prompt-msg');
        const input = document.getElementById('admin-prompt-input');
        const btnOk = document.getElementById('btn-admin-prompt-ok');
        const btnCancel = document.getElementById('btn-admin-prompt-cancel');

        // Dynamic Text Injection
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (input) input.value = ''; 
        if (btnOk) btnOk.textContent = confirmText;

        // Safe Class Replacement
        if (modalBox) {
            modalBox.classList.remove('accent-red', 'accent-green');
            modalBox.classList.add(isDanger ? 'accent-red' : 'accent-green');
        }
        if (btnOk) {
            btnOk.className = `btn-sys ${isDanger ? 'btn-sys-red btn-danger-fill' : 'btn-sys-green'}`;
        }

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            if (btnOk) btnOk.onclick = null;
            if (btnCancel) btnCancel.onclick = null;
        };

        if (btnCancel) btnCancel.onclick = () => { cleanup(); resolve(null); }; 
        if (btnOk) btnOk.onclick = () => { cleanup(); resolve(input.value.trim()); };
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

    // Fetch ALL roles assigned to the user
    const { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);
        
    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];
    
    // Check if the array contains at least one of the required access roles
    if (error || (!roles.includes('admin') && !roles.includes('reviewer'))) { kickUser(); return; }

    window.currentUserId = session.user.id;
    window.currentUserRoles = roles;
    window.currentUsername = window.getDisplayName ? window.getDisplayName(session) : "Staff";
    
    if (roles.includes('admin')) document.getElementById('admin-only-tools').style.display = 'block';
    
    if (typeof setupTabs === 'function') {
        setupTabs('nav', 'tab', ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'], 'major');
        
        ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tabId => {
            const btn = document.getElementById(`nav-${tabId}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    setTimeout(updateAdminTOC, 150); 
                });
            }
        });
    }

    // --- WORKFLOW KEY LISTENERS ---
    let typingThrottle = false;
    document.getElementById('ticket-chat-input').addEventListener('input', function() {
        if (window.activeChatChannel && !typingThrottle) {
            typingThrottle = true;
            window.activeChatChannel.send({ type: 'broadcast', event: 'typing', payload: { user: window.currentUsername } });
            setTimeout(() => { typingThrottle = false; }, 2000); 
        }
    });

    setInterval(() => {
        let changed = false;
        const now = Date.now();
        for (let [user, time] of window.activeTypers.entries()) {
            if (now - time > 3000) { window.activeTypers.delete(user); changed = true; }
        }
        if (changed) updateTypingText();
    }, 1000);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && window.activePreviewRevId) resetPreviewState();
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            const ticketWorkspace = document.getElementById('ticket-workspace');
            if (ticketWorkspace && ticketWorkspace.style.display !== 'none') {
                e.preventDefault(); 
                document.getElementById('ticket-chat-input').focus();
            }
        }
        if (e.ctrlKey && e.key === 'Enter' && window.activePreviewRevId) {
            const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
            if (rev && rev.status === 'ticket_open') {
                e.preventDefault(); toggleSupportToTicket();
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

// --- DYNAMIC TABLE OF CONTENTS ---
function updateAdminTOC() {
    const tocList = document.getElementById('dynamic-toc');
    if (!tocList) return;
    tocList.innerHTML = '';
    
    const headers = document.querySelectorAll('#preview-content-area h3.strategy-title, #preview-content-area h3.diff-section-title, #preview-content-area h3.card-header-title');
    
    if (headers.length === 0) {
        tocList.innerHTML = `<li><p class="admin-toc-empty">Nothing to index here.</p></li>`;
        return;
    }

    headers.forEach((h, i) => {
        const safeId = 'toc-target-admin-' + i;
        h.id = safeId;
        
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'toc-btn';
        
        let cleanText = h.textContent.replace(/\(.*?\)/g, '').trim(); 
        a.textContent = cleanText || 'Section'; 
        
        a.onclick = (e) => {
            e.preventDefault();
            h.scrollIntoView({ behavior: 'smooth', block: 'center' });
            h.style.transition = 'color 0.3s ease';
            h.style.color = 'var(--accent-blue)';
            setTimeout(() => h.style.color = '', 800);
        };
        
        li.appendChild(a);
        tocList.appendChild(li);
    });
}

// --- 2. FETCH QUEUE ---
async function loadQueue() {
    const container = document.getElementById('queue-container');
    container.innerHTML = `<p class="loading-msg admin-loading-msg">Scanning database...</p>`;

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
    
    const groupedQueue = {};
    window.currentQueueData.forEach(rev => {
        if (!groupedQueue[rev.page_id]) groupedQueue[rev.page_id] = [];
        groupedQueue[rev.page_id].push(rev);
    });

    for (const [pageId, tickets] of Object.entries(groupedQueue)) {
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'flex-end';
        header.style.borderBottom = '1px solid var(--accent-blue)';
        header.style.paddingBottom = '0.5rem';
        header.style.marginBottom = '1rem';
        header.style.marginTop = '2rem';

        let mergeBtnHtml = '';
        if (tickets.length > 1) {
            mergeBtnHtml = `<button onclick="window.openMergeCompiler('${pageId}')" class="btn-sys btn-sys-purple" style="font-size:0.65rem; padding: 0.3rem 0.6rem;">✦ MERGE TICKETS (${tickets.length})</button>`;
        }

        header.innerHTML = `
            <h3 style="font-family:'CC-Wild-Words', sans-serif; font-size:1rem; color:var(--text-white); margin:0; text-transform: uppercase;">${pageId.replace(/_/g, ' ')}</h3>
            ${mergeBtnHtml}
        `;
        container.appendChild(header);

        tickets.forEach(rev => {
            rev.supporters = rev.supporters || [];
            rev.ticket_chat = rev.ticket_chat || [];

            const exactDate = new Date(rev.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
            const relativeTime = timeSince(rev.created_at);
            
            const statusBadge = rev.status === 'ticket_open' 
                ? `<span class="update-badge" style="background: #eab308; color: #000; font-size:0.55rem; border: none; padding: 0.15rem 0.4rem;">TICKET OPEN</span>`
                : `<span class="update-badge badge-patch" style="font-size:0.55rem; background: var(--accent-blue); color: #000; border: none; padding: 0.15rem 0.4rem;">PENDING</span>`;

            const deltaBadge = rev.is_delta
                ? `<span class="update-badge" style="background: rgba(168,85,247,0.1); color: #a855f7; border: 1px solid #a855f7; font-size: 0.55rem; padding: 0.1rem 0.4rem;">[PATCH: ${rev.target_scope.toUpperCase()}]</span>`
                : `<span class="update-badge" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid #ef4444; font-size: 0.55rem; padding: 0.1rem 0.4rem;">[LEGACY OVERWRITE]</span>`;

            const card = document.createElement('div');
            card.className = 'update-log-item';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                        <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
                            ${statusBadge}
                            <span class="update-badge" style="font-size:0.5rem; background: #333; color: #fff; border: 1px solid #555; padding: 0.15rem 0.4rem;">${rev.page_id.toUpperCase()}</span>
                            ${deltaBadge}
                        </div>
                        <h3 class="update-title" style="font-size: 0.85rem; margin: 0; font-family: 'CC-Wild-Words', sans-serif;">REVISION SUBMISSION</h3>
                        <div class="update-log-meta" style="font-size: 0.65rem; color: #888;">
                            By: <strong style="color:var(--text-white);">${rev.author_name}</strong><br>
                            <span style="color: var(--accent-blue);">${relativeTime}</span> <span style="opacity: 0.5;">(${exactDate})</span>
                        </div>
                    </div>
                    <button onclick="previewRevision('${rev.id}')" class="btn-sys btn-sys-blue" style="font-size: 0.6rem; padding: 0.3rem 0.6rem; margin-top: 0.2rem;">REVIEW</button>
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
    const isAdmin = (window.currentUserRoles || []).includes('admin');
    
    // --- TRUSTED EDITOR PERK ---
    const isTrusted = (rev.author_roles || []).includes('trusted_editor');
    const requiredSupport = isTrusted ? 1 : 2; // Trusted gets a discount

    const supportersCount = (rev.supporters || []).length;
    const opposersCount = (rev.opposers || []).length;
    const netScore = supportersCount - opposersCount;
    
    const hasEnoughSupport = (netScore >= requiredSupport);
    const hasEnoughOppose = (netScore <= -2);

    let buttonsHTML = '';
    
    // The Intercept button (Available to all staff and the original author)
    const editBtn = `<button onclick="editCurrentTicket()" class="btn-sys btn-sys-purple">INTERCEPT & EDIT</button>`;

    if (isAdmin) {
        buttonsHTML += editBtn;
        buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">FORCE APPROVE</button>`;
        buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">FORCE REJECT</button>`;
    } else {
        if (isOwnSubmission) {
            buttonsHTML += editBtn; 
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`;
            buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">WITHDRAW</button>`;
        } else {
            buttonsHTML += editBtn;
            if (hasEnoughSupport) buttonsHTML += `<button onclick="approveCurrentPreview()" class="btn-sys btn-sys-green">MERGE TO LIVE</button>`;
            if (rev.status !== 'ticket_open') buttonsHTML += `<button onclick="openTicketCurrentPreview()" class="btn-sys btn-sys-yellow">OPEN TICKET</button>`;
            if (hasEnoughOppose) buttonsHTML += `<button onclick="rejectCurrentPreview()" class="btn-sys btn-sys-red btn-danger-fill">REJECT</button>`;
        }
    }
    actionContainer.innerHTML = buttonsHTML;
    actionContainer.style.display = 'flex';
}

// --- INTERCEPT & EDIT ENGINE ---
window.editCurrentTicket = async function() {
    if(!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if(!rev) return;

    if(!(await adminConfirm("Intercept this submission? This will open the Editor so you can modify the contributor's text directly."))) return;

    // Attach the special editTicket flag
    let url = `edit.html?char=${rev.page_id}&editTicket=${rev.id}`;
    
    // Smart Routing: If it's a Delta Patch, jump exactly to the tab/move they edited!
    if (rev.is_delta) {
        let tab = 'overview';
        if (['matchup', 'counterplay'].includes(rev.target_scope)) tab = rev.target_scope + 's';
        else if (rev.target_scope === 'move') {
            tab = rev.target_key.split('::')[0];
            const moveId = rev.target_key.split('::')[1];
            url += `&tab=${tab}&move=${moveId}`;
        }
        if (rev.target_scope !== 'move') url += `&tab=${tab}`;
    }

    // Launch the Editor in a new tab
    window.open(url, '_blank');
};

// --- SMART DELTA HIGHLIGHTER ---
function getTabData(tab, mode) {
    const isFrame = ['m1s', 'skills', 'specials'].includes(tab);
    const liveDesc = window.currentLiveDescData || {};
    const liveFrame = window.currentLiveFrameData || {};
    const pendDesc = window.currentPendingDescData || {};
    const pendFrame = window.currentPendingFrameData || {};

    const dataObj = mode === 'live' ? (isFrame ? liveFrame : liveDesc) : (isFrame ? pendFrame : pendDesc);
    
    if (tab === 'overview') return { profile: dataObj.profile, playstyle: dataObj.playstyle, overview: dataObj.overview, strategy: dataObj.strategy, extras: dataObj.extras };
    return dataObj[tab] || null;
}

// --- SMART DELTA HIGHLIGHTER ---
window.attachTabIndicators = function() {
    document.querySelectorAll('.tab-changed-indicator').forEach(el => el.remove());
    (window.changedTabs || []).forEach(tab => {
        const btn = document.getElementById(`nav-${tab}`);
        if (btn && !btn.querySelector('.tab-changed-indicator')) {
            btn.innerHTML += `<span class="tab-changed-indicator" title="Modifications Detected">●</span>`;
        }
    });
};

function getTabData(tab, mode) {
    const isFrame = ['m1s', 'skills', 'specials'].includes(tab);
    const liveDesc = window.currentLiveDescData || {};
    const liveFrame = window.currentLiveFrameData || {};
    const pendDesc = window.currentPendingDescData || {};
    const pendFrame = window.currentPendingFrameData || {};

    const dataObj = mode === 'live' ? (isFrame ? liveFrame : liveDesc) : (isFrame ? pendFrame : pendDesc);
    
    if (tab === 'overview') return { profile: dataObj.profile, playstyle: dataObj.playstyle, overview: dataObj.overview, strategy: dataObj.strategy, extras: dataObj.extras };
    return dataObj[tab] || null;
}

function calculateTabDiffs(rev) {
    window.changedTabs = [];
    
    if (window.activePreviewPageType === 'system' || window.activePreviewPageType === 'tierlist') {
        const oldTabs = window.currentLiveDescData.tabs || [];
        const newTabs = window.currentPendingDescData.tabs || [];
        const allTabIds = Array.from(new Set([...oldTabs.map(t=>t.tabId || t.id), ...newTabs.map(t=>t.tabId || t.id)]));
        
        allTabIds.forEach(tabId => {
            const oTab = oldTabs.find(t => (t.tabId || t.id) === tabId);
            const nTab = newTabs.find(t => (t.tabId || t.id) === tabId);
            if (JSON.stringify(oTab) !== JSON.stringify(nTab)) window.changedTabs.push(tabId);
        });
    } else {
        if (rev && rev.is_delta) {
            const addScopeTab = (scope, key) => {
                let targetTab = 'overview';
                if (['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) targetTab = 'overview';
                else if (scope === 'matchup') targetTab = 'matchups';
                else if (scope === 'counterplay') targetTab = 'counterplay';
                else if (scope === 'move') targetTab = key.split('::')[0]; 
                
                if (!window.changedTabs.includes(targetTab)) window.changedTabs.push(targetTab);
            };

            if (rev.target_scope === 'multi') rev.delta_payload.forEach(edit => addScopeTab(edit.scope, edit.key));
            else addScopeTab(rev.target_scope, rev.target_key);
        } else {
            const tabs = ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'];
            tabs.forEach(tab => {
                const liveStr = JSON.stringify(getTabData(tab, 'live') || {});
                const pendStr = JSON.stringify(getTabData(tab, 'pending') || {});
                if (liveStr !== pendStr) window.changedTabs.push(tab);
            });
        }
    }

    window.attachTabIndicators();
}

// --- DYNAMIC DOCUMENT EXPLORER ---
window.updateAdminSidebar = function() {
    const navOverviewBtn = document.getElementById('nav-overview');
    const navContainer = navOverviewBtn ? navOverviewBtn.parentElement : null;
    if (!navContainer) return;

    // Clean up any old dynamically generated system tabs
    navContainer.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    if (window.activePreviewPageType === 'system') {
        // Hide standard character tabs
        ['overview', 'm1s', 'skills', 'specials', 'matchups', 'counterplay'].forEach(tab => {
            const btn = document.getElementById(`nav-${tab}`);
            if (btn) btn.style.display = 'none';
        });

        // Rebuild with system tabs
        const sysTabs = window.currentPendingDescData.tabs || window.currentLiveDescData.tabs || [];
        const tabIds = [];

        sysTabs.forEach((tab, idx) => {
            tabIds.push(tab.tabId);
            const btn = document.createElement('div');
            btn.id = `nav-${tab.tabId}`;
            btn.className = `nav-btn system-nav-btn ${idx === 0 ? 'active' : ''}`;
            btn.textContent = tab.tabLabel || tab.tabId;
            
            // Replicate the admin sidebar styling
            btn.style.cursor = 'pointer';
            btn.style.padding = '0.75rem 1rem';
            btn.style.borderBottom = '1px solid #222';
            btn.style.color = '#d1d5db';
            btn.style.fontSize = '0.85rem';
            
            navContainer.appendChild(btn);

            btn.addEventListener('click', () => {
                setTimeout(updateAdminTOC, 150);
            });
        });

        // Wire them up to standard pagebuilder tab switching logic
        if (typeof setupTabs === 'function') {
            setupTabs('nav', 'tab', tabIds, 'major');
        }
    }
};

// --- 3. THE PREVIEW & TICKET ENGINE ---
async function previewRevision(revId) {
    const rev = window.currentQueueData.find(r => r.id === revId);
    if (!rev) return;

    const { data: authorRoleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', rev.author_id);
    rev.author_roles = authorRoleData ? authorRoleData.map(r => r.role.toLowerCase()) : [];

    window.activePreviewRevId = rev.id;
    window.activePreviewCharId = rev.page_id;
    window.activePreviewPageType = rev.page_type || 'character';
    document.getElementById('preview-status-text').innerHTML = `REVIEWING: <strong style="color: var(--text-white);">${rev.page_id.toUpperCase()}</strong> (By ${rev.author_name})`;
    
    updateActionButtons(rev);
    document.getElementById('preview-nav-sidebar').style.display = 'block';

    const { data: liveData } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', rev.page_id).single();
    window.currentLiveDescData = liveData ? liveData.desc_data : {};
    window.currentLiveFrameData = liveData ? liveData.frame_data : {};

    if (rev.is_delta) {
        const { newDesc, newFrame } = window.applyDeltaToData(
            window.currentLiveDescData, 
            window.currentLiveFrameData, 
            rev.target_scope, 
            rev.target_key, 
            rev.delta_payload
        );
        window.currentPendingDescData = newDesc;
        window.currentPendingFrameData = newFrame;
    } else {
        window.currentPendingDescData = rev.desc_data || {};
        window.currentPendingFrameData = rev.frame_data || {};
    }

    // --- Trigger Document Explorer Sidebar rebuild ---
    if (typeof window.updateAdminSidebar === 'function') window.updateAdminSidebar();

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.style.display = 'flex';

    calculateTabDiffs(rev);

    if (window.activeChatChannel) { window.supabaseClient.removeChannel(window.activeChatChannel); }
    window.activeTypers.clear();
    if(typeof updateTypingText === 'function') updateTypingText();

    if (rev.status === 'ticket_open') {
        const ticketWorkspace = document.getElementById('ticket-workspace');
        ticketWorkspace.style.display = 'flex';
        renderTicketWorkspace(rev, (rev.author_id === window.currentUserId), (rev.supporters || []).includes(window.currentUserId), (rev.opposers || []).includes(window.currentUserId));
        
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
                    localRev.supporters = updatedRev.supporters || [];
                    localRev.opposers = updatedRev.opposers || [];
                    localRev.ticket_chat = updatedRev.ticket_chat || [];
                    
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

    let initMode = 'pending';
    if (rev.is_delta) {
        initMode = 'diff';
        
        let activeTabId = 'overview';
        if (['matchup', 'counterplay'].includes(rev.target_scope)) activeTabId = `${rev.target_scope}s`;
        else if (rev.target_scope === 'move') activeTabId = rev.target_key.split('::')[0];
        
        document.querySelectorAll('#preview-nav-sidebar .nav-btn').forEach(btn => btn.classList.remove('active'));
        const autoTab = document.getElementById(`nav-${activeTabId}`);
        if (autoTab) autoTab.classList.add('active');
    }

    switchVersionView(initMode);

    // --- QOL: AUTO-SCROLL TO TICKET WORKSPACE ---
    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        const actionBtns = document.getElementById('preview-action-buttons');
        // If there's an open ticket chat, snap to it. Otherwise, snap to the review buttons.
        if (workspace && workspace.style.display !== 'none') {
            workspace.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (actionBtns) {
            actionBtns.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 150);
}

// --- VERSION COMPARISON ENGINE ---
async function switchVersionView(mode) {
    const btns = { 'pending': document.getElementById('btn-view-pending'), 'live': document.getElementById('btn-view-live'), 'diff': document.getElementById('btn-view-diff') };
    Object.values(btns).forEach(b => {
        if(!b) return;
        b.className = 'btn-sys btn-sys-regular version-toggle-btn';
    });
    
    if(btns[mode]) {
        if (mode === 'pending') btns[mode].classList.add('btn-sys-blue');
        if (mode === 'live') btns[mode].classList.add('btn-sys-green');
        if (mode === 'diff') btns[mode].classList.add('btn-sys-purple');
    }

    if (mode === 'pending') {
        window.currentEditorDescData = window.currentPendingDescData;
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentPendingFrameData;
    } else if (mode === 'live') {
        window.currentEditorDescData = window.currentLiveDescData;
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentLiveFrameData;
    }
    if (mode === 'diff') {
        // Universal clear for both Character AND System dynamically generated tabs
        document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => {
            el.classList.add('hidden'); 
        });

        let diffContainer = document.getElementById('admin-diff-container');
        if (!diffContainer) {
            diffContainer = document.createElement('div');
            diffContainer.id = 'admin-diff-container';
            diffContainer.className = 'tab-content wiki-tab-content';
            const mainArea = document.querySelector('.main-content-area');
            if (mainArea) mainArea.appendChild(diffContainer);
        }
        
        diffContainer.innerHTML = `<h2 class="section-title" style="color: #a855f7;">REVISION COMPARISON</h2>`;
        diffContainer.classList.remove('hidden');
        
        const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
        if (!rev) return;
        
        let diffRenderQueue = [];

        const formatScopeName = (scope) => {
            const map = {
                'move': 'Move Strategy & Frames',
                'matchup': 'Matchup',
                'counterplay': 'Counterplay',
                'extra': 'Custom Tab',
                'profile': 'Profile Metadata',
                'playstyle': 'Playstyle',
                'overview': 'Overview',
                'strategy': 'General Strategy'
            };
            return map[scope] || scope;
        };

        if (rev.is_delta) {
            const renderDeltaDiff = (scope, key, payload) => {
                diffContainer.innerHTML += `<div style="font-family:var(--text-mono); font-size:0.75rem; color:#888; margin-bottom: 1.5rem; margin-top: 2rem;">Suggested Edit Location: [ ${formatScopeName(scope).toUpperCase()} ➔ ${key.replace('::', ': ').toUpperCase()} ]</div>`;

                if (['profile', 'playstyle', 'overview', 'strategy'].includes(scope)) {
                    renderDiffBlock(formatScopeName(scope), window.currentLiveDescData[scope], payload);
                } 
                else if (scope === 'extra') {
                    const oldExtra = window.currentLiveDescData.extras?.find(e => e.title === key) || {};
                    if (payload === null) {
                        renderDiffBlock('Custom Tab Deleted', oldExtra, null, 'json');
                    } else {
                        if (oldExtra.title !== payload.title) renderDiffBlock('Custom Tab Title', { title: oldExtra.title }, { title: payload.title });
                        renderDiffBlock('Custom Tab Strategy', oldExtra.content || [], payload.content || []);
                    }
                } 
                else if (scope === 'matchup') {
                    const oldMu = window.currentLiveDescData.matchups?.find(m => m.opponent === key) || {};
                    if (payload === null) {
                        renderDiffBlock('Matchup Deleted', oldMu, null, 'json');
                    } else {
                        renderDiffBlock('Matchup Metadata', { opponent: oldMu.opponent, tier: oldMu.tier }, { opponent: payload.opponent, tier: payload.tier });
                        renderDiffBlock('Matchup Strategy', oldMu.content || [], payload.content || []);
                    }
                } 
                else if (scope === 'counterplay') {
                    const oldCp = window.currentLiveDescData.counterplay?.find(c => c.topic === key) || {};
                    if (payload === null) {
                        renderDiffBlock('Counterplay Deleted', oldCp, null, 'json');
                    } else {
                        renderDiffBlock('Counterplay Metadata', { topic: oldCp.topic, importance: oldCp.importance }, { topic: payload.topic, importance: payload.importance });
                        renderDiffBlock('Counterplay Strategy', oldCp.content || [], payload.content || []);
                    }
                } 
                else if (scope === 'move') {
                    const [cat, moveId] = key.split('::');
                    const oldFrame = window.currentLiveFrameData[cat]?.find(m => m.id === moveId) || {};
                    const oldDesc = window.currentLiveDescData.moveStrategies?.[moveId] || [];
                    
                    if (payload === null) {
                        renderDiffBlock(`Move Deleted: ${moveId}`, oldFrame, null, 'json');
                    } else {
                        const newFrame = payload.frame_data || {};
                        renderDiffBlock('Move Stats & Frames', oldFrame, newFrame);
                        const newDesc = payload.desc_data || [];
                        renderDiffBlock('Move Strategy Text', oldDesc, newDesc);
                    }
                }
            };

            // Recursively execute the render function for Batched multi-tickets!
            if (rev.target_scope === 'multi') {
                diffContainer.innerHTML += `<div style="font-family:var(--text-mono); font-size:0.85rem; color:#22c55e; margin-bottom: 1rem; border: 1px dashed #22c55e; padding: 0.75rem; text-align: center;">BATCHED MULTI-PAYLOAD DETECTED (${rev.delta_payload.length} EDITS)</div>`;
                rev.delta_payload.forEach(edit => renderDeltaDiff(edit.scope, edit.key, edit.payload));
            } else if (rev.target_scope === 'system_data') {
                const oldTabs = window.currentLiveDescData.tabs || [];
                const newTabs = rev.delta_payload.tabs || [];
                const allTabIds = Array.from(new Set([...oldTabs.map(t=>t.tabId || t.id), ...newTabs.map(t=>t.tabId || t.id)]));

                allTabIds.forEach(tabId => {
                    const oTab = oldTabs.find(t => (t.tabId || t.id) === tabId) || { sections: [] };
                    const nTab = newTabs.find(t => (t.tabId || t.id) === tabId) || { sections: [] };
                    const tabLabel = nTab.tabLabel || nTab.label || oTab.tabLabel || oTab.label || tabId;

                    if ((oTab.tabLabel || oTab.label) !== (nTab.tabLabel || nTab.label)) {
                         renderDiffBlock(`Tab: ${tabId} Metadata`, { label: oTab.tabLabel || oTab.label }, { label: nTab.tabLabel || nTab.label });
                    }

                    if (window.activePreviewPageType === 'tierlist') {
                         renderDiffBlock(`[${tabLabel}] ➔ Tiers`, oTab.tiers || [], nTab.tiers || [], 'json');
                         renderDiffBlock(`[${tabLabel}] ➔ Changelog`, oTab.changelog || [], nTab.changelog || [], 'json');
                    } else {
                         const oSecs = oTab.sections || [];
                         const nSecs = nTab.sections || [];
                         const secMax = Math.max(oSecs.length, nSecs.length);

                         for(let i=0; i < secMax; i++) {
                              const oSec = oSecs[i] || {};
                              const nSec = nSecs[i] || {};
                              const secTitle = nSec.sectionTitle || oSec.sectionTitle || `Section ${i+1}`;

                              if (oSec.layout !== nSec.layout || oSec.width !== nSec.width || oSec.alignment !== nSec.alignment) {
                                   renderDiffBlock(`Layout: [${tabLabel}] ➔ ${secTitle}`, 
                                       { layout: oSec.layout, width: oSec.width, alignment: oSec.alignment }, 
                                       { layout: nSec.layout, width: nSec.width, alignment: nSec.alignment }
                                   );
                              }
                              renderDiffBlock(`[${tabLabel}] ➔ ${secTitle}`, oSec.blocks || [], nSec.blocks || []);
                         }
                    }
                });
            } else {
                renderDeltaDiff(rev.target_scope, rev.target_key, rev.delta_payload);
            }
        } else {
            if (window.changedTabs.length === 0) {
                diffContainer.innerHTML += `<p style="color:var(--text-muted); font-style:italic;">No changes detected.</p>`;
                return;
            }
            window.changedTabs.forEach(tab => {
                const oldTab = getTabData(tab, 'live') || {};
                const newTab = getTabData(tab, 'pending') || {};

                if (tab === 'overview') {
                    renderDiffBlock('Profile Metadata', oldTab.profile, newTab.profile);
                    renderDiffBlock('Playstyle Details', oldTab.playstyle, newTab.playstyle);
                    renderDiffBlock('Character Overview', oldTab.overview, newTab.overview);
                    renderDiffBlock('General Strategy', oldTab.strategy, newTab.strategy);
                    
                    const oldExt = oldTab.extras || [];
                    const newExt = newTab.extras || [];
                    const extMax = Math.max(oldExt.length, newExt.length);
                    for (let i = 0; i < extMax; i++) {
                        const oT = oldExt[i]?.title; const nT = newExt[i]?.title;
                        if (oT !== nT) renderDiffBlock(`Custom Tab Title (${i + 1})`, { title: oT }, { title: nT });
                        renderDiffBlock(`Custom Tab Strategy: ${nT || oT || i}`, oldExt[i]?.content || [], newExt[i]?.content || []);
                    }
                } else if (tab === 'matchups') {
                    const oldMu = Array.isArray(oldTab) ? oldTab : [];
                    const newMu = Array.isArray(newTab) ? newTab : [];
                    const muMax = Math.max(oldMu.length, newMu.length);
                    for (let i = 0; i < muMax; i++) {
                        const oM = oldMu[i]?.opponent; const nM = newMu[i]?.opponent;
                        if (oM !== nM || oldMu[i]?.tier !== newMu[i]?.tier) {
                            renderDiffBlock(`Matchup Metadata (${i + 1})`, { opponent: oM, tier: oldMu[i]?.tier }, { opponent: nM, tier: newMu[i]?.tier });
                        }
                        renderDiffBlock(`Matchup Strategy: ${nM || oM || 'Unknown'}`, oldMu[i]?.content || [], newMu[i]?.content || []);
                    }
                } else if (tab === 'counterplay') {
                    const oldCp = Array.isArray(oldTab) ? oldTab : [];
                    const newCp = Array.isArray(newTab) ? newTab : [];
                    const cpMax = Math.max(oldCp.length, newCp.length);
                    for (let i = 0; i < cpMax; i++) {
                        const oC = oldCp[i]?.topic; const nC = newCp[i]?.topic;
                        if (oC !== nC || oldCp[i]?.importance !== newCp[i]?.importance) {
                            renderDiffBlock(`Counterplay Metadata (${i + 1})`, { topic: oC, importance: oldCp[i]?.importance }, { topic: nC, importance: newCp[i]?.importance });
                        }
                        renderDiffBlock(`Counterplay Strategy: ${nC || oC || 'Unknown'}`, oldCp[i]?.content || [], newCp[i]?.content || []);
                    }
                }
                else if (['m1s', 'skills', 'specials'].includes(tab)) {
                    const oldMoves = Array.isArray(oldTab) ? oldTab : [];
                    const newMoves = Array.isArray(newTab) ? newTab : [];
                    const allMoveIds = Array.from(new Set([...oldMoves.map(m=>m.id), ...newMoves.map(m=>m.id)]));
                    
                    allMoveIds.forEach(mId => {
                        const oM = oldMoves.find(m => m.id === mId) || {};
                        const nM = newMoves.find(m => m.id === mId) || {};
                        if (JSON.stringify(oM) !== JSON.stringify(nM)) {
                            renderDiffBlock(`Move Stats & Frames (${mId})`, oM, nM);
                        }
                        
                        const oStrat = window.currentLiveDescData.moveStrategies?.[mId] || [];
                        const nStrat = window.currentPendingDescData.moveStrategies?.[mId] || [];
                        if (JSON.stringify(oStrat) !== JSON.stringify(nStrat)) {
                            renderDiffBlock(`Move Strategy Text (${mId})`, oStrat, nStrat);
                        }
                    });
                }
            });
        }

        // --- CORE DIFF RENDERER ---
        function renderDiffBlock(title, oldData, newData, context = '') {
            const oldStr = JSON.stringify(oldData || null);
            const newStr = JSON.stringify(newData || null);
            if (oldStr === newStr) return; 

            const safeId = title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 10000);
            
            if (Array.isArray(oldData) || Array.isArray(newData)) {
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
                    <div class="diff-container">
                        <h3 class="diff-section-title">${title.toUpperCase()}</h3>
                        <div id="diff-inline-${safeId}" style="width: 100%;"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks, context);
                });
                
            } else {
                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${title.toUpperCase()}</h3>
                        <div class="diff-stacked-old"><div class="diff-stacked-label old">[-] CURRENT VERSION</div><pre style="font-family:var(--text-mono); font-size:0.65rem; color:#fca5a5; margin:0;">${JSON.stringify(oldData, null, 2)}</pre></div>
                        <div class="diff-stacked-new"><div class="diff-stacked-label new">[+] SUGGESTED REVISION</div><pre style="font-family:var(--text-mono); font-size:0.65rem; color:#86efac; margin:0;">${JSON.stringify(newData, null, 2)}</pre></div>
                    </div>
                `;
            }
        }

        diffRenderQueue.forEach(fn => fn());
        if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
        
        // Render dynamic ToC for the Diff View!
        setTimeout(updateAdminTOC, 200);
        return; 
    }

    // --- REBUILDING LIVE / PENDING VIEWS ---
    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.innerHTML = '');

    window.currentEditorPageType = window.activePreviewPageType; 
    
    if (window.activePreviewPageType === 'tierlist') {
        window.liveTierData = window.currentEditorDescData; 
        
        // Inject the required containers so tierlist.js has somewhere to render!
        const overviewTab = document.getElementById('tab-overview');
        if (overviewTab) {
            overviewTab.innerHTML = `
                <div id="tier-tabs-container"></div>
                <div id="tier-list-ui"></div>
                <div id="changelog-container" style="margin-top: 2rem;"></div>
            `;
            overviewTab.classList.remove('hidden');
        }

        if (typeof window.loadTierList === 'function') {
            await window.loadTierList();
        } else {
            console.warn("tierlist.js is not loaded in Admin.html");
        }
        setTimeout(window.attachTabIndicators, 200);
    } else {
        if (typeof loadPageDescriptions === 'function') {
            await loadPageDescriptions(window.activePreviewCharId, window.activePreviewPageType);
            setTimeout(window.attachTabIndicators, 200); 
        }

        if (window.activePreviewPageType !== 'system' && typeof loadMoveSection === 'function') {
            await loadMoveSection(window.activePreviewCharId, 'm1s');
            await loadMoveSection(window.activePreviewCharId, 'skills');
            await loadMoveSection(window.activePreviewCharId, 'specials');
        }
    }

    // Always scan for new Headers after rendering finishes
    setTimeout(updateAdminTOC, 300);
}

// --- 4. TICKET LOGIC (VOTING & CHAT) ---
function renderTicketWorkspace(rev, isOwnSubmission, hasSupported, hasOpposed) {
    const supportText = document.getElementById('ticket-support-text');
    const opposeText = document.getElementById('ticket-oppose-text');
    const supportActions = document.getElementById('ticket-support-actions');
    const chatLog = document.getElementById('ticket-chat-log');
    
    rev.supporters = rev.supporters || [];
    rev.opposers = rev.opposers || [];
    
    // --- NET SCORE UI WITH PERKS ---
    const isTrusted = (rev.author_roles || []).includes('trusted_editor');
    const requiredSupport = isTrusted ? 1 : 2;
    const netScore = rev.supporters.length - rev.opposers.length;
    
    let scoreColor = "var(--text-white)";
    if (netScore > 0) scoreColor = "#22c55e"; 
    if (netScore < 0) scoreColor = "#ef4444"; 
    
    supportText.innerHTML = `Net Approval Score: <strong style="color:${scoreColor}; font-size: 1.1rem;">${netScore > 0 ? '+' : ''}${netScore}</strong>`;
    
    const perkHtml = isTrusted ? ` <span style="color:#a855f7; font-weight:bold;">(Trusted Editor Perk Applied)</span>` : '';
    opposeText.innerHTML = `<span style="color:#888; font-size: 0.75rem;">Requires +${requiredSupport} to Merge, or -2 to Reject${perkHtml}</span>`;
    
    if (isOwnSubmission) {
        supportActions.innerHTML = `<span style="color:#ef4444; font-size:0.65rem; font-family:var(--text-mono);">Cannot vote on own submission.</span>`;
    } else {
        const supBtn = hasSupported 
            ? `<button type="button" onclick="toggleSupportToTicket()" class="btn-sys btn-sys-regular" style="flex:1;">UN-SUPPORT</button>`
            : `<button type="button" onclick="toggleSupportToTicket()" class="btn-sys btn-sys-green" style="flex:1;">SUPPORT</button>`;
            
        const oppBtn = hasOpposed 
            ? `<button type="button" onclick="toggleOpposeToTicket()" class="btn-sys btn-sys-regular" style="flex:1;">REMOVE OPPOSE</button>`
            : `<button type="button" onclick="toggleOpposeToTicket()" class="btn-sys btn-sys-yellow" style="flex:1;">OPPOSE</button>`;

        supportActions.innerHTML = `<div style="display:flex; gap:0.5rem; width:100%;">${supBtn}${oppBtn}</div>`;
    }

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
        newSupporters = newSupporters.filter(id => id !== window.currentUserId); 
    } else {
        newSupporters.push(window.currentUserId); 
        newOpposers = newOpposers.filter(id => id !== window.currentUserId); 
    }
    
    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);
    
    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    await previewRevision(rev.id);
    previewRevision(rev.id); 
}

async function toggleOpposeToTicket() {
    if (!window.activePreviewRevId) return;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    if (rev.author_id === window.currentUserId) return;

    const { data: liveRev } = await window.supabaseClient.from('pending_revisions').select('supporters, opposers').eq('id', rev.id).single();
    let newSupporters = liveRev.supporters || [];
    let newOpposers = liveRev.opposers || [];
    
    if (newOpposers.includes(window.currentUserId)) {
        newOpposers = newOpposers.filter(id => id !== window.currentUserId); 
    } else {
        newOpposers.push(window.currentUserId); 
        newSupporters = newSupporters.filter(id => id !== window.currentUserId); 
    }
    
    await window.supabaseClient.from('pending_revisions').update({ supporters: newSupporters, opposers: newOpposers }).eq('id', rev.id);
    
    rev.supporters = newSupporters; rev.opposers = newOpposers;
    renderTicketWorkspace(rev, false, newSupporters.includes(window.currentUserId), newOpposers.includes(window.currentUserId));
    await previewRevision(rev.id);
    previewRevision(rev.id); 
}

async function postTicketMessage() {
    if (!window.activePreviewRevId) return;
    const input = document.getElementById('ticket-chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    input.disabled = true;
    const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    
    const { data: liveRev, error: fetchErr } = await window.supabaseClient.from('pending_revisions').select('ticket_chat').eq('id', rev.id).single();
    const currentChat = (!fetchErr && liveRev.ticket_chat) ? liveRev.ticket_chat : [];
    
    const newMessage = { author: window.currentUsername, text: text, timestamp: Date.now() };
    const newChat = [...currentChat, newMessage];
    
    const { error } = await window.supabaseClient.from('pending_revisions').update({ ticket_chat: newChat }).eq('id', rev.id);
        
    input.disabled = false;
    input.value = '';
    
    if (error) { adminAlert("Failed to send message: " + error.message); return; }
    
    rev.ticket_chat = newChat;
    renderTicketWorkspace(rev, rev.author_id === window.currentUserId, (rev.supporters || []).includes(window.currentUserId));
    setTimeout(() => document.getElementById('ticket-chat-input').focus(), 10);
}

// --- 5. MODERATION ACTIONS (DELTA SPLICE ENGINE) ---
async function approveCurrentPreview() {
    if(!window.activePreviewRevId) return;

    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);

    // 1. PROMPT THE REVIEWER FOR REASONING
    const msg = window.currentUserRoles && window.currentUserRoles.includes('admin')
        ? "Provide an optional staff note (or leave blank to force merge immediately):"
        : "Provide an optional staff note for the author (or leave blank):";

    const approvalNote = await window.adminPrompt(msg, "APPROVE REVISION", "MERGE TICKET", false);
    if (approvalNote === null) return; // User clicked Cancel

    const finalNote = approvalNote.trim() !== '' ? approvalNote.trim() : "Approved and merged.";

    let finalDesc = {};
    let finalFrame = {};

    const { data: freshLive, error: freshErr } = await window.supabaseClient
        .from('page_data').select('*').eq('page_id', revData.page_id).single();
        
    if (freshErr && freshErr.code !== 'PGRST116') { 
        window.adminAlert("Fetch Failed: " + freshErr.message); 
        return; 
    } 

    if (freshLive) {
        const historyPayload = {
            page_id: freshLive.page_id,
            page_type: freshLive.page_type || 'character',
            desc_data: freshLive.desc_data,
            frame_data: freshLive.frame_data,
            updated_by_user: window.currentUsername,
            replaced_by_rev: revData.id 
        };
        
        // Block the entire merge if the history fails to archive safely
        const { error: histErr } = await window.supabaseClient.from('page_history').insert([historyPayload]);
        if (histErr) {
            window.adminAlert("System Merge Aborted: Failed to safely archive the previous version. " + histErr.message);
            return;
        }
    }

    const liveDesc = freshLive ? freshLive.desc_data : {};
    const liveFrame = freshLive ? freshLive.frame_data : {};

    if (revData.is_delta) {
        const { newDesc, newFrame } = window.applyDeltaToData(
            liveDesc, liveFrame, 
            revData.target_scope, revData.target_key, revData.delta_payload
        );
        finalDesc = newDesc;
        finalFrame = newFrame;
    } else {
        finalDesc = revData.desc_data || {};
        finalFrame = revData.frame_data || {};
    }

    const livePayload = { 
        page_id: revData.page_id, 
        page_type: revData.page_type, 
        desc_data: finalDesc, 
        frame_data: finalFrame 
    };

    const { error: liveError } = await window.supabaseClient.from('page_data').upsert([livePayload], { onConflict: 'page_id' });
    if (liveError) { window.adminAlert("Merge Failed: " + liveError.message); return; }

    // 2. TRACK THE REVIEWER & INJECT REASONING
    const updatedQA = revData.qa_metadata || {};
    updatedQA.reviewed_by = window.currentUsername; // Explicitly tracks the exact staff member!

    if (approvalNote.trim() !== '') {
        updatedQA.changelog = (updatedQA.changelog || '') + `\n\n[Staff Note: ${finalNote}]`;
    }

    await window.supabaseClient.from('pending_revisions').update({ 
        status: 'approved', 
        qa_metadata: updatedQA,
        ticket_chat: [], 
        supporters: [], 
        opposers: [] 
    }).eq('id', window.activePreviewRevId);
    
    const pageUrl = revData.page_type === 'system' 
        ? `../../systems/${revData.page_id}/index.html` 
        : `../../characters/${revData.page_id.charAt(0).toUpperCase() + revData.page_id.slice(1)}/index.html`;

    // Update Notification to include the Staff Note
    await window.supabaseClient.from('user_notifications').insert([{
        user_id: revData.author_id,
        message: `Your revision for "${revData.page_id.toUpperCase()}" has been approved! Staff Note: "${finalNote}"`,
        link: pageUrl
    }]);

    window.adminAlert("Revision approved and merged to live database!");
    resetPreviewState(); loadQueue();
}

async function rejectCurrentPreview() {
    if(!window.activePreviewRevId) return;
    const revData = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
    
    let finalReason = "Withdrawn by author.";
    
    if (revData.author_id !== window.currentUserId) {
        const reason = await window.adminPrompt(`Please provide a reason for declining this ${revData.page_id.toUpperCase()} revision:`, "REJECT REVISION", "DECLINE TICKET", true);
        if (reason === null) return; 
        finalReason = reason === '' ? 'No specific reason provided.' : reason;
    } else {
        if(!(await window.adminConfirm("Withdraw your own submission?"))) return;
    }

    const { error: deleteError } = await window.supabaseClient.from('pending_revisions').delete().eq('id', window.activePreviewRevId);

    if (deleteError) {
        window.adminAlert("Error: Failed to discard the revision from the database.");
        return;
    }

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
    
    // Update the database
    await window.supabaseClient.from('pending_revisions').update({ status: 'ticket_open' }).eq('id', window.activePreviewRevId);
    
    // Silently reload the queue to update the badges in the background
    await loadQueue();
    
    // Force the preview to re-render, which builds the ticket workspace
    await previewRevision(window.activePreviewRevId);

    // Snap the camera down to the workspace and flash it
    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        if (workspace && workspace.style.display !== 'none') {
            workspace.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Flash the borders so the user's eyes are drawn to the newly opened workspace
            workspace.style.transition = 'box-shadow 0.3s ease';
            workspace.style.boxShadow = '0 0 20px var(--accent-blue)';
            setTimeout(() => { workspace.style.boxShadow = '0 4px 6px hsla(0, 0%, 0%, 0.3)'; }, 800);
        }
    }, 150);
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
            btn.style.display = ''; // Restore default display visibility
            const indicator = btn.querySelector('.tab-changed-indicator');
            if (indicator) indicator.remove();
        }
    });

    // Remove dynamically generated system tabs
    document.querySelectorAll('.system-nav-btn').forEach(btn => btn.remove());

    document.getElementById('tab-overview').classList.remove('hidden');
    document.getElementById('nav-overview').classList.add('active');
    document.getElementById('dynamic-toc').innerHTML = '<li><p class="admin-toc-empty">Navigation unavailable.</p></li>';
}

// --- 6. KILL ORPHANS (FORTIFIED) ---
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

        results.innerHTML += "Analyzing Live, Pending, and History data...<br>";

        // Fetch as raw text using Supabase text casting to prevent massive JSON object parsing
        const [ {data: liveData}, {data: pendingData}, {data: historyData} ] = await Promise.all([
            window.supabaseClient.from('page_data').select('desc_data::text, frame_data::text'),
            window.supabaseClient.from('pending_revisions').select('desc_data::text, frame_data::text, delta_payload::text'),
            window.supabaseClient.from('page_history').select('desc_data::text, frame_data::text')
        ]);

        // Safely extract and concatenate without triggering JSON.stringify Memory Leaks
        let massiveDataString = "";
        
        (liveData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || ''); });
        (pendingData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || '') + (row.delta_payload || ''); });
        (historyData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || ''); });

        const orphanedFiles = actualFiles.filter(file => {
            const rawName = file.name;
            const encodedURI = encodeURI(rawName);
            const encodedComponent = encodeURIComponent(rawName);
            const spaceEncoded = rawName.replace(/ /g, '%20');

            return !massiveDataString.includes(rawName) && 
                   !massiveDataString.includes(encodedURI) && 
                   !massiveDataString.includes(encodedComponent) &&
                   !massiveDataString.includes(spaceEncoded);
        });

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

// --- 8. THE MERGE COMPILER ENGINE ---
window.openMergeCompiler = async function(pageId) {
    const modal = document.getElementById('compiler-modal-overlay');
    const body = document.getElementById('compiler-modal-body');
    const titleSpan = document.getElementById('compiler-char-name');
    const confirmBtn = document.getElementById('btn-compiler-confirm');
    
    titleSpan.textContent = pageId.toUpperCase();
    titleSpan.parentElement.innerHTML = `MERGE COMPILER: <span id="compiler-char-name" style="color: #fff;">${pageId.toUpperCase()}</span>`;
    
    body.innerHTML = `<p style="color:var(--text-muted); font-style:italic; text-align: center; padding: 2rem;">Analyzing revisions and fetching live database...</p>`;
    modal.style.display = 'flex';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';

    const { data: liveData, error: liveErr } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
    
    if (liveErr && liveErr.code !== 'PGRST116') {
        window.adminAlert("System Error fetching baseline data: " + liveErr.message);
        return;
    }
    
    const liveDesc = (liveData && liveData.desc_data) ? liveData.desc_data : {};
    const liveFrame = (liveData && liveData.frame_data) ? liveData.frame_data : {};

    const tickets = window.currentQueueData.filter(r => r.page_id === pageId).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

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
        let tDesc = t.desc_data || {};
        let tFrame = t.frame_data || {};

        if (t.is_delta) {
            const patched = window.applyDeltaToData(liveDesc, liveFrame, t.target_scope, t.target_key, t.delta_payload);
            tDesc = patched.newDesc;
            tFrame = patched.newFrame;
        }

        if (isDiff(tDesc.profile, liveDesc.profile)) addConflict('profile', 'Profile Metadata', 'desc', liveDesc.profile).options.push({ ticket: t, data: tDesc.profile });
        if (isDiff(tDesc.playstyle, liveDesc.playstyle)) addConflict('playstyle', 'Playstyle Details', 'desc', liveDesc.playstyle).options.push({ ticket: t, data: tDesc.playstyle });
        if (isDiff(tDesc.overview, liveDesc.overview)) addConflict('overview', 'Character Overview', 'desc', liveDesc.overview).options.push({ ticket: t, data: tDesc.overview });
        if (isDiff(tDesc.strategy, liveDesc.strategy)) addConflict('strategy', 'General Strategy', 'desc', liveDesc.strategy).options.push({ ticket: t, data: tDesc.strategy });
        
        const scanArray = (arrName, labelName, tArr, lArr, keyProp) => {
            const maxLen = Math.max((tArr || []).length, (lArr || []).length);
            for (let i = 0; i < maxLen; i++) {
                if (isDiff(tArr?.[i], lArr?.[i])) {
                    const identifier = tArr?.[i]?.[keyProp] || lArr?.[i]?.[keyProp] || `Index ${i}`;
                    addConflict(`${arrName}_${i}`, `${labelName}: ${identifier}`, 'array_item', lArr?.[i], { arrName, index: i }).options.push({ ticket: t, data: tArr?.[i] });
                }
            }
        };

        scanArray('extras', 'Custom Tab', tDesc.extras, liveDesc.extras, 'title');
        scanArray('matchups', 'Matchup', tDesc.matchups, liveDesc.matchups, 'opponent');
        scanArray('counterplay', 'Counterplay', tDesc.counterplay, liveDesc.counterplay, 'topic');

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

    if (conflicts.length === 0) {
        body.innerHTML = `<p style="color:var(--text-muted); padding: 2rem; border: 1px dashed #333; text-align: center;">No mergeable changes detected in these tickets. They may be functionally identical to the live database.</p>`;
        return; 
    }

    let html = `<p style="font-family:var(--text-mono); font-size:0.75rem; color:#888; margin-bottom:1.5rem; line-height:1.5;">Select the version to keep for each modified section. The compiler will merge your selections into a single unified ticket.</p>`;

    conflicts.forEach(c => {
        let selectHtml = `<select id="compiler-sel-${c.sectionId}" class="editor-select" style="margin-bottom: 0; border-color: #a855f7; background: rgba(168,85,247,0.1); color: #fff; font-weight: bold;">`;
        selectHtml += `<option value="live" style="color:#888; font-weight: normal;">[DISCARD] Keep current live data</option>`;

        c.options.forEach((opt, idx) => {
            const isLast = (idx === c.options.length - 1);
            const dateStr = new Date(opt.ticket.created_at).toLocaleDateString();
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
    confirmBtn.textContent = "CREATE MERGED TICKET";

    confirmBtn.onclick = async () => {
        if (!(await window.adminConfirm(`Compile these selections into a single unified ticket for review?`))) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = "COMPILING...";

        const masterDesc = JSON.parse(JSON.stringify(liveDesc));
        const masterFrame = JSON.parse(JSON.stringify(liveFrame));
        const selectedTicketIds = new Set();
        const contributors = new Set();

        conflicts.forEach(c => {
            const selVal = document.getElementById(`compiler-sel-${c.sectionId}`).value;
            if (selVal === 'live') return; 

            const chosenOpt = c.options.find(o => o.ticket.id === selVal);
            if (!chosenOpt) return;

            selectedTicketIds.add(selVal);
            contributors.add(chosenOpt.ticket.author_name); 

            if (c.type === 'desc') {
                masterDesc[c.sectionId] = chosenOpt.data;
            } 
            else if (c.type === 'array_item') {
                const arrName = c.liveStratData.arrName; 
                const targetIdx = c.liveStratData.index; 
                if (!masterDesc[arrName]) masterDesc[arrName] = [];
                masterDesc[arrName][targetIdx] = chosenOpt.data;
            }
            else if (c.type === 'move') {
                const cat = chosenOpt.data.cat;
                const moveData = chosenOpt.data.move;
                const stratData = chosenOpt.stratData;
                
                const prefix = `move_${cat}_`;
                const moveId = c.sectionId.substring(prefix.length);

                if (!masterFrame[cat]) masterFrame[cat] = [];
                const existingIdx = masterFrame[cat].findIndex(m => m.id === moveId);

                if (moveData) {
                    if (existingIdx > -1) masterFrame[cat][existingIdx] = moveData;
                    else masterFrame[cat].push(moveData);
                } else {
                    if (existingIdx > -1) masterFrame[cat].splice(existingIdx, 1);
                }

                if (!masterDesc.moveStrategies) masterDesc.moveStrategies = {};
                if (stratData) masterDesc.moveStrategies[moveId] = stratData;
                else delete masterDesc.moveStrategies[moveId];
            }
        });

        if (selectedTicketIds.size === 0) {
            window.adminAlert("No tickets were selected. All conflicts were set to keep Live Data.");
            modal.style.display = 'none';
            return;
        }

        const chosenTickets = tickets.filter(t => selectedTicketIds.has(t.id));
        const masterTicket = chosenTickets[chosenTickets.length - 1]; 
        const otherTicketIds = chosenTickets.filter(t => t.id !== masterTicket.id).map(t => t.id);

        const authorsList = Array.from(contributors).join(', ');
        const finalAuthorName = `Staff Merge (Credits: ${authorsList})`;

        const payload = {
            desc_data: masterDesc,
            frame_data: masterFrame,
            is_delta: false, 
            target_scope: null,
            target_key: null,
            author_id: window.currentUserId,
            author_name: finalAuthorName,
            status: 'ticket_open', 
            qa_metadata: {
                changelog: `System Merge: Unified edits from ${contributors.size} contributors.`,
                confidence: "high",
                evidence: masterTicket.qa_metadata?.evidence || ""
            }
        };

        const { error: updateError } = await window.supabaseClient.from('pending_revisions').update(payload).eq('id', masterTicket.id);
        
        if (updateError) { 
            window.adminAlert("Merge Failed: " + updateError.message); 
            confirmBtn.disabled = false;
            confirmBtn.textContent = "CREATE MERGED TICKET";
            return; 
        }

        if (otherTicketIds.length > 0) {
            await window.supabaseClient.from('pending_revisions').delete().in('id', otherTicketIds);
        }

        window.adminAlert(`Successfully merged ${selectedTicketIds.size} tickets!`);
        modal.style.display = 'none';
        
        resetPreviewState(); 
        loadQueue();
    };
};