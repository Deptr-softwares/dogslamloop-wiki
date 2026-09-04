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

// --- STALE-DEPENDENCY STAND-INS ---
// GitHub Pages serves js/ with max-age=3600, so the first load after a deploy
// can pair a fresh admin-*.js with an hour-old js/site_utils.js. On 2026-08-10
// exactly that took the whole editor down: a new module called a new shared
// helper that the cached copy did not have yet, and the TypeError went straight
// through the boot try/catch.
//
// js/site_utils.js now carries a content-hash query so this should not recur -
// these are the second line of defence, and they are the real implementations
// verbatim, so behaviour is identical either way. They install only when
// missing and disappear the moment the cache catches up. This file is the
// right home: it is the first of admin.html's script set to load.
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

// Mobile-only header dropdown holding OWNER TOOLS/RECENT CHANGES/HUB (the
// panel is display:none outside admin.css's max-width:900px block, so this is
// inert on desktop even though the handler is always registered).
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

// placeholder is a parameter because all three moderation actions share this
// one modal, and its textarea used to carry the reject wording ("Explain why
// this revision was declined...") hardcoded in admin.html. Approving a
// revision therefore asked the reviewer to justify a decline, in red. Working
// through a queue at speed, that is wording someone eventually acts on.
window.adminPrompt = function(message, title = "SYSTEM PROMPT", confirmText = "CONFIRM", isDanger = false, placeholder = "Type your note here...") {
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
        if (input) {
            input.value = '';
            input.placeholder = placeholder;
        }
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

    // A single dropped request on either call below (a flaky connection, or
    // this page loading right after the bfcache-guard reload above) used to
    // permanently kick a legitimate staff member to ACCESS DENIED with no
    // recovery short of a manual refresh - retry once after a short delay
    // before concluding access should actually be denied. A genuinely
    // logged-out/unauthorized user still fails the retry the same way.
    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { kickUser(); return; }

    // Fetch ALL roles assigned to the user.
    //
    // select('*') rather than select('role'): capabilities are columns on this
    // row, and this gate now reads can_moderate as well. Naming columns would
    // mean editing this query every time a capability is added, and getting a
    // 400 on the deploy where the client is newer than the database - which on
    // this page means locking staff out.
    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('*').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('*').eq('user_id', session.user.id));
    }

    const roleRow = (roleData && roleData.length > 0) ? roleData[0] : null;
    const roles = roleRow ? roleData.map(r => r.role.toLowerCase()) : ['guest'];

    // Moderators get in, and this is deliberately a CAPABILITY rather than a
    // new role - user_roles has UNIQUE(user_id) precisely because a second row
    // broke get_my_role() for that user everywhere.
    //
    // The owner's reasoning, 2026-08-13: this is THE staff page, so somebody
    // who moderates belongs on it. What they should not see is the revision
    // queue and the media queue, because neither is their job.
    const canModerate = !!roleRow && roleRow.can_moderate === true;
    // Reviewer and above - which now means reviewer, admin AND owner. Mirrors
    // public.is_staff() (20260827000001).
    const isReviewStaff = window.rolesMeet(roles, 'reviewer');

    // The third way in, and the one this gate did not know about until
    // 2026-09-04.
    //
    // v0.17 gave a page expert review rights over their own pages: the queue
    // policies read can_review_page(page_id), which is is_staff() OR an expert
    // row for that page (20260903000001). The SQL half shipped and worked. This
    // half never learned the word "expert", so an expert with no role failed
    // `!isReviewStaff && !canModerate` and was kicked to ACCESS DENIED - their
    // badge visible on their profile the whole time. Reported by the owner
    // after making somebody a Disaster Plants expert.
    //
    // Skipped for review staff because can_review_page() already returns true
    // for them; asking would cost a round trip to learn nothing.
    let expertPages = [];
    if (!isReviewStaff) {
        const { data: pages } = await window.supabaseClient
            .rpc('get_user_expert_pages', { target_user_id: session.user.id });
        if (Array.isArray(pages)) expertPages = pages;
    }
    const isExpert = expertPages.length > 0;

    // Deliberately narrower than moderation, and mirrors public.can_delete_media():
    // admin or the explicit flag, with no fall-back to reviewer. Reviewing a
    // revision and destroying a file are different amounts of trust, and this
    // is the only irreversible action in the panel.
    // Mirrors public.can_delete_media(): admin and above, or the per-user flag.
    // The media queue lives on THIS page, and what decides who owns a tool is
    // which page it is on rather than how irreversible it is (owner,
    // 2026-08-27). The flag still matters - it is how a reviewer, who is below
    // this bar, gets the power one person at a time.
    window.currentUserCanDeleteMedia = window.rolesMeet(roles, 'admin')
        || (!!roleRow && roleRow.can_delete_media === true);

    if (error || (!isReviewStaff && !canModerate && !isExpert)) { kickUser(); return; }

    window.currentUserId = session.user.id;
    window.currentUserRoles = roles;
    window.currentUserCanModerate = canModerate || isReviewStaff;
    window.currentUserExpertPages = expertPages.map(p => p.page_id);
    // Moderator-only: in the building, but not on the review team.
    window.currentUserIsModeratorOnly = !isReviewStaff && canModerate && !isExpert;
    // Expert-only: here for their own pages' revisions and nothing else.
    window.currentUserIsExpertOnly = !isReviewStaff && !canModerate && isExpert;

    // What this person is here to do, as three independent answers rather than
    // one label - because the three ways in compose. An expert who also holds
    // the moderation capability is here for revisions AND reports, and a pair
    // of mutually-exclusive "only" flags could not say that.
    //
    // Presentation, not security: every table below has its own RLS, and the
    // revision queue an expert can read is already narrowed to their pages by
    // can_review_page(). Hiding is about not showing somebody a job that is not
    // theirs.
    const seesRevisions = isReviewStaff || isExpert;
    const seesMedia     = isReviewStaff;
    const seesReports   = isReviewStaff || canModerate;
    window.currentUserSeesRevisions = seesRevisions;
    window.currentUserSeesMedia = seesMedia;
    window.currentUserSeesReports = seesReports;
    window.currentUsername = window.getDisplayName ? window.getDisplayName(session) : "Staff";

    // Scope the page down before anything loads, so nobody sees a queue flash
    // into view and disappear.
    //
    // This is presentation, not security. pending_revisions and the media
    // tables have their own RLS, and a narrowed account cannot read them
    // whatever this does - hiding them is about not showing somebody a job
    // that is not theirs, not about preventing access.
    if (!seesRevisions || !seesMedia || !seesReports) {
        applyScope({ seesRevisions, seesMedia, seesReports });
    }

    // Personnel Management / Media GC moved to owner.html (admin-only) -
    // this just reveals the nav link to get there, not an inline tools panel.
    if (window.rolesMeet(roles, 'owner')) {
        const ownerLink = document.getElementById('owner-tools-link');
        if (ownerLink) ownerLink.classList.remove('hidden');
    }

    // The static strip in admin.html - Ultimate is injected later by
    // js/admin-modes.js, and Gallery has no reviewer view.
    //
    // includeOptional: this runs at BOOT, and an optional tab's flag arrives
    // per revision, in previewRevision. Binding only the enabled ones would be
    // binding against a flag that has not been fetched yet - so a Techs button
    // un-hidden a moment later by applyOptionalTabVisibility sat there doing
    // nothing when clicked, was never hidden by any other tab's sweep (setupTabs
    // only hides ids in its own group, so it rendered underneath whatever came
    // next), and never had .active removed. All three were reported together.
    // js/page_boot.js fixed exactly this on the reader page; this surface was
    // missed. setupTabs is idempotent and additive, so binding a button that
    // stays hidden costs nothing.
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

    // A moderator has no revision queue to load, and calling it would put an
    // RLS denial in the panel where their reports should be.
    // An expert loads it too - their pages' revisions are the reason they are
    // here, and can_review_page() has already narrowed what comes back.
    if (window.currentUserSeesRevisions) loadQueue();
});

function kickUser() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
}

// Narrows the Overseer to the queues this person is actually here for.
//
// Was applyModeratorScope, which took no arguments because there was only one
// narrowed user. There are two now - a moderator and a page expert - and they
// are not opposites: somebody can hold both, and hiding by role label would
// take the revision queue away from an expert the moment they were also asked
// to moderate.
//
// Hides rather than deletes, so nothing else on the page has to learn that
// these containers might be absent - loadQueue, renderMediaQueue and the
// preview engine all still find their elements and write into them harmlessly.
// Deleting them would turn every unguarded getElementById in five files into a
// null dereference for one class of user.
function applyScope({ seesRevisions, seesMedia, seesReports }) {
    // Kept as the moderator's own class name: style/admin.css hangs a rule off
    // it, and this is still exactly the case it described - in the building,
    // but not reviewing revisions.
    if (!seesRevisions) document.body.classList.add('admin-moderator-only');

    // Each header is the element immediately before its container, so both are
    // found from the container rather than by adding ids to markup that has none.
    const hidden = [
        [!seesRevisions, 'queue-container'],
        [!seesMedia, 'media-queue-container'],
        [!seesReports, 'report-queue-container'],
    ];

    hidden.forEach(([hide, id]) => {
        if (!hide) return;
        const container = document.getElementById(id);
        if (!container) return;
        container.classList.add('hidden');

        let node = container.previousElementSibling;
        while (node && !node.classList.contains('admin-split-header')) {
            node.classList.add('hidden');
            node = node.previousElementSibling;
        }
        if (node) node.classList.add('hidden');
    });

    // The preview pane exists to review revisions. Left in place - see the
    // note above on why nothing is deleted - but told what it is for, rather
    // than sitting there saying "Select a revision..." to somebody who will
    // never be shown one. An expert DOES review revisions, so they keep it.
    if (!seesRevisions) {
        const status = document.getElementById('preview-status-text');
        if (status) status.textContent = 'Moderation view — reports are handled from the queue on the left.';
    }

    // Load the reports immediately. For a moderator with no revision queue this
    // is the entire page, and making them press Load first would be asking them
    // to open the thing they came for.
    if (seesReports && !seesRevisions && typeof window.loadReportQueue === 'function') {
        window.loadReportQueue();
    }
}

function updateTypingText() {
    const el = document.getElementById('ticket-typing-indicator');
    if (!el) return;
    if (window.activeTypers.size === 0) el.textContent = '';
    else if (window.activeTypers.size === 1) el.textContent = Array.from(window.activeTypers.keys())[0] + ' is typing...';
    else el.textContent = 'Multiple people are typing...';
}
