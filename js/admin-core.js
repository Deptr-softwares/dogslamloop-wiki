/**
 * Dogslamloop Wiki - Admin Overseer: Core (state, RBAC gate, shared modals)
 *
 * First file loaded of admin.html's reviewer-workflow script set - defines
 * the window.* globals every other admin-*.js file reads/writes, plus the
 * RBAC gate that kicks off the whole page (loadQueue, defined in
 * admin-queue.js which loads after this file - fine, since it's only
 * called once DOMContentLoaded actually fires, by which point every
 * admin-*.js file has already registered its top-level functions).
 */

window.currentQueueData = [];
window.activePreviewRevId = null;
window.activePreviewCharId = null;
window.currentUserId = null;
window.currentUsername = "Staff";

// Core Data State
window.currentLiveDescData = {};
window.currentLiveFrameData = {};
window.currentPendingDescData = {};
window.currentPendingFrameData = {};

window.activeChatChannel = null;
window.activeTypers = new Map();
window.changedTabs = [];

// This page's entire purpose is showing reviewers content submitted by
// other, less-trusted accounts - author names, ticket chat, QA metadata,
// and raw revision content are all attacker-reachable strings that
// admin-queue.js/admin-preview.js/admin-tickets.js/admin-merge-compiler.js
// build directly into innerHTML. Escape at every such interpolation point
// rather than trusting the data (a malicious revision or chat message
// shouldn't be able to run script in a reviewer's authenticated session).
window.escapeHtml = function(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// admin.html doesn't load editor.js (which is where edit.html's version of
// this lives) - reimplemented here rather than pulling in the whole file
// for one function. Shares the same class/element-id contract
// (body.mobile-preview-active, #mobile-preview-toggle) that editor.css's
// existing @media (max-width: 900px) rules already key off, so no new CSS
// mechanism is needed, just this wiring plus the markup in admin.html.
window.toggleMobilePreview = function() {
    const body = document.body;
    body.classList.toggle('mobile-preview-active');

    const btn = document.getElementById('mobile-preview-toggle');
    if (btn) {
        btn.textContent = body.classList.contains('mobile-preview-active') ? "BACK TO QUEUE" : "SHOW PREVIEW";
    }
};

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

// --- THE DELTA INJECTION ENGINE ---
// applyDeltaToData is defined once, in site_utils.js (loaded before this file).

// --- CUSTOM MODAL PROMISES ---
window.adminAlert = function(message) {
    const modal = document.getElementById('admin-alert-modal');
    document.getElementById('admin-alert-msg').textContent = message;
    modal.classList.remove('hidden');
    document.getElementById('btn-admin-alert-ok').onclick = () => { modal.classList.add('hidden'); };
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

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
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
        modal.classList.remove('hidden');

        const btnOk = document.getElementById('btn-admin-confirm-ok');
        const btnCancel = document.getElementById('btn-admin-confirm-cancel');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
};

// --- BFCACHE GUARD ---
// The browser's back-forward cache can restore this page as a frozen
// snapshot on back/forward navigation (e.g. reviewer clicks a link to
// another page, then hits the browser/in-page back button) WITHOUT
// re-running DOMContentLoaded or the RBAC gate below at all - a real bug
// reported live: a legitimate reviewer got kicked to ACCESS DENIED after
// navigating back from recent-changes.html, every time, but a manual
// refresh (which always does a real reload) fixed it every time - the
// textbook signature of a stale bfcache snapshot rather than an actual
// auth failure. pageshow's event.persisted is true only on a bfcache
// restore (never on a normal first load), so this forces a real reload
// exactly when needed and is a no-op otherwise.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});

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

    // Personnel Management / Media GC moved to owner.html (admin-only) -
    // this just reveals the nav link to get there, not an inline tools panel.
    if (roles.includes('admin')) {
        const ownerLink = document.getElementById('owner-tools-link');
        if (ownerLink) ownerLink.classList.remove('hidden');
    }

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
            if (ticketWorkspace && !ticketWorkspace.classList.contains('hidden')) {
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
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
}

function updateTypingText() {
    const el = document.getElementById('ticket-typing-indicator');
    if (!el) return;
    if (window.activeTypers.size === 0) el.textContent = '';
    else if (window.activeTypers.size === 1) el.textContent = Array.from(window.activeTypers.keys())[0] + ' is typing...';
    else el.textContent = 'Multiple people are typing...';
}
