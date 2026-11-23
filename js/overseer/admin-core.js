/**
 * The Overseer's core: the state every admin-*.js file shares, the message and
 * prompt boxes, the queue tabs, and the gate that decides who gets in and which
 * queues they see. admin.html loads it first of its own scripts.
 * @since v0.4, as part of admin.js
 * @touches user_roles (role, can_moderate, can_delete_media), get_user_expert_pages(),
 *   the window.current* state, rolesMeet and showAccessDenied (site_utils.js),
 *   getCharacterTabIds (character_tabs.js), loadQueue (admin-queue.js)
 * @watch the gate only decides what to show: RLS on every table is the boundary.
 *   Its three ways in (review staff, moderators, page experts) must agree with
 *   is_staff(), can_moderate() and can_review_page(). Everything this page shows
 *   was written by someone else, so every innerHTML value goes through escapeHtml.
 * @see docs/overseer.md
 */

// Copies of three site_data.js helpers, installed only when an older cached
// site_data.js lacks them. They must match the originals.
if (typeof window.isBaseMode !== 'function') {
    window.isBaseMode = (modeId) => !modeId || modeId === 'base';
}
if (typeof window.getCharacterModes !== 'function') {
    window.getCharacterModes = (frameData) => {
        const modes = frameData && Array.isArray(frameData.modes) ? frameData.modes : [];
        return modes.filter(m => m && m.id).map(m => ({ id: String(m.id), label: String(m.label || m.id) }));
    };
}
if (typeof window.unwrapModeDelta !== 'function') {
    window.unwrapModeDelta = (scope, key) => {
        if (scope !== 'mode' || typeof key !== 'string') return { modeId: null, scope, key };
        const parts = key.split('::');
        const modeId = parts.shift();
        const innerScope = parts.shift() || '';
        return { modeId, scope: innerScope, key: parts.join('::') || 'full' };
    };
}

window.currentQueueData = [];
window.activePreviewRevId = null;
window.activePreviewCharId = null;
window.currentUserId = null;
window.currentUsername = "Staff";

window.currentLiveDescData = {};
window.currentLiveFrameData = {};
window.currentPendingDescData = {};
window.currentPendingFrameData = {};

window.activeChatChannel = null;
window.activeTypers = new Map();
window.changedTabs = [];

/**
 * Opens and closes the phone header's menu: OWNER TOOLS, RECENT CHANGES and HUB.
 * @since v0.8
 * @watch admin.css shows the menu only under 900px wide
 */
window.toggleAdminMobileMenu = function() {
    const panel = document.getElementById('admin-secondary-actions');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');

    const btn = document.getElementById('admin-mobile-menu-toggle');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

document.addEventListener('click', (event) => {
    const panel = document.getElementById('admin-secondary-actions');
    if (!panel || !panel.classList.contains('open')) return;

    const btn = document.getElementById('admin-mobile-menu-toggle');
    // The toggle's own handler runs first and would immediately be undone here.
    if (panel.contains(event.target) || (btn && btn.contains(event.target))) return;

    panel.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
});

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

window.adminAlert = function(message) {
    document.getElementById('admin-alert-msg').textContent = message;
    window.runDialog(document.getElementById('admin-alert-modal'), {
        buttons: [[document.getElementById('btn-admin-alert-ok')]],
    });
};

/**
 * The Overseer's note box. Resolves to the trimmed note, or null on cancel.
 * @watch approve, reject and request changes share it, so each passes its own
 *   placeholder
 */
window.adminPrompt = function(message, title = "SYSTEM PROMPT", confirmText = "CONFIRM", isDanger = false, placeholder = "Type your note here...") {
    const modal = document.getElementById('admin-prompt-modal');

    const modalBox = modal.firstElementChild;
    const titleEl = modalBox ? modalBox.querySelector('h3') : null;
    const msgEl = document.getElementById('admin-prompt-msg');
    const input = document.getElementById('admin-prompt-input');
    const btnOk = document.getElementById('btn-admin-prompt-ok');
    const btnCancel = document.getElementById('btn-admin-prompt-cancel');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (input) {
        input.value = '';
        input.placeholder = placeholder;
    }
    if (btnOk) btnOk.textContent = confirmText;

    if (modalBox) {
        modalBox.classList.remove('accent-red', 'accent-green');
        modalBox.classList.add(isDanger ? 'accent-red' : 'accent-green');
    }
    if (btnOk) {
        btnOk.className = `btn-sys ${isDanger ? 'btn-sys-red btn-danger-fill' : 'btn-sys-green'}`;
    }

    return window.runDialog(modal, {
        buttons: [[btnCancel, null], [btnOk, () => input.value.trim()]],
        cancel: null,
    });
};

// A page restored from the back-forward cache skips the gate below, and a
// reviewer was refused after going back. A restore reloads instead.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});

document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    // One dropped request must not refuse a staff member: retry once before the gate
    // decides.
    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { window.showAccessDenied(); return; }

    // Every column, since capabilities are columns: naming them would 400 on a
    // deploy where the client is newer than the database, and lock staff out.
    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('*').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('*').eq('user_id', session.user.id));
    }

    const roleRow = (roleData && roleData.length > 0) ? roleData[0] : null;
    const roles = roleRow ? roleData.map(r => r.role.toLowerCase()) : ['guest'];

    // Moderation is a capability, not a role: user_roles allows one row per user.
    const canModerate = !!roleRow && roleRow.can_moderate === true;
    // Mirrors public.is_staff().
    const isReviewStaff = window.rolesMeet(roles, 'reviewer');

    // A page expert reviews their own pages (can_review_page()). Review staff
    // already can, so they are not asked.
    let expertPages = [];
    if (!isReviewStaff) {
        const { data: pages } = await window.supabaseClient
            .rpc('get_user_expert_pages', { target_user_id: session.user.id });
        if (Array.isArray(pages)) expertPages = pages;
    }
    const isExpert = expertPages.length > 0;

    // Mirrors public.can_delete_media(): admin and above, or the account's own flag.
    window.currentUserCanDeleteMedia = window.rolesMeet(roles, 'admin')
        || (!!roleRow && roleRow.can_delete_media === true);

    if (error || (!isReviewStaff && !canModerate && !isExpert)) { window.showAccessDenied(); return; }

    window.currentUserId = session.user.id;
    window.currentUserRoles = roles;
    // Mirrors public.can_moderate(): admin and above, or the account's own tick.
    const moderates = canModerate || window.rolesMeet(roles, 'admin');
    window.currentUserCanModerate = moderates;

    // Three answers rather than one label, because the ways in combine: an expert
    // who also moderates sees revisions and reports.
    const seesRevisions = isReviewStaff || isExpert;
    const seesMedia     = isReviewStaff;
    const seesReports   = moderates;
    // Restoring a live page is the review team's power (page_data and page_history
    // RLS).
    const seesHistory   = isReviewStaff;
    window.currentUserSeesRevisions = seesRevisions;
    window.currentUsername = window.getDisplayName ? window.getDisplayName(session) : "Staff";

    // Before anything loads, so no queue flashes into view and disappears.
    if (!seesRevisions || !seesMedia || !seesReports || !seesHistory) {
        applyScope({ seesRevisions, seesMedia, seesReports, seesHistory });
    }

    if (window.rolesMeet(roles, 'owner')) {
        const ownerLink = document.getElementById('owner-tools-link');
        if (ownerLink) ownerLink.classList.remove('hidden');
    }

    // At boot, before any revision has said which optional tabs it has, so every
    // tab is bound: a button shown later still works.
    const adminTabIds = window.getCharacterTabIds({ editableOnly: true, includeOptional: true });

    if (typeof setupTabs === 'function') {
        setupTabs('nav', 'tab', adminTabIds, 'major');

        adminTabIds.forEach(tabId => {
            const btn = document.getElementById(`nav-${tabId}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    setTimeout(updateAdminTOC, 150);
                });
            }
        });
    }

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

    // A moderator has no revision queue, and loading it would show an RLS refusal.
    if (window.currentUserSeesRevisions) loadQueue();
});

// One queue on screen at a time. A queue that loads on demand loads the first
// time its tab opens.
const QUEUE_LOADERS = {
    media: () => (typeof loadMediaQueue === 'function' ? loadMediaQueue() : null),
    reports: () => (typeof window.loadReportQueue === 'function' ? window.loadReportQueue() : null),
    history: () => (typeof loadHistoryPagePicker === 'function' ? loadHistoryPagePicker() : null),
};
const queuePanelsOpened = new Set();

window.showQueuePanel = function(name) {
    const tab = document.querySelector(`[data-queue-tab="${name}"]`);
    const panel = document.querySelector(`[data-queue-panel="${name}"]`);
    if (!tab || !panel || tab.hidden) return;

    document.querySelectorAll('[data-queue-tab]').forEach(t => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-queue-panel]').forEach(p => p.classList.toggle('hidden', p !== panel));

    if (!queuePanelsOpened.has(name) && QUEUE_LOADERS[name]) QUEUE_LOADERS[name]();
    queuePanelsOpened.add(name);
};

/**
 * Shows how many are waiting on a queue's tab, once that queue has loaded.
 * @since v1.2
 */
window.setQueueCount = function(name, count) {
    const el = document.querySelector(`[data-queue-count="${name}"]`);
    if (el) el.textContent = Number.isFinite(count) && count > 0 ? String(count) : '';
};

document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-queue-tab]');
    if (tab) window.showQueuePanel(tab.dataset.queueTab);
});

// Narrows the Overseer to the queues this person is here for. It hides rather
// than deletes, so code that writes into a hidden panel still finds it.
function applyScope({ seesRevisions, seesMedia, seesReports, seesHistory }) {
    // admin.css styles the page for anyone who does not review revisions by this.
    if (!seesRevisions) document.body.classList.add('admin-moderator-only');

    const seen = { revisions: seesRevisions, media: seesMedia, reports: seesReports, history: seesHistory };
    Object.entries(seen).forEach(([name, shown]) => {
        if (shown) return;
        const tab = document.querySelector(`[data-queue-tab="${name}"]`);
        const panel = document.querySelector(`[data-queue-panel="${name}"]`);
        if (tab) tab.hidden = true;
        if (panel) panel.classList.add('hidden');
    });
    // The first queue left opens, so a moderator lands on Reports.
    const stillOpen = document.querySelector('.admin-queue-tab.active:not([hidden])');
    const first = Object.keys(seen).find(name => seen[name]);
    if (!stillOpen && first) window.showQueuePanel(first);

    if (!seesRevisions) {
        const status = document.getElementById('preview-status-text');
        if (status) status.textContent = 'Moderation view. Reports are handled from the queue on the left.';
    }
}

function updateTypingText() {
    const el = document.getElementById('ticket-typing-indicator');
    if (!el) return;
    if (window.activeTypers.size === 0) el.textContent = '';
    else if (window.activeTypers.size === 1) el.textContent = Array.from(window.activeTypers.keys())[0] + ' is typing...';
    else el.textContent = 'Multiple people are typing...';
}
