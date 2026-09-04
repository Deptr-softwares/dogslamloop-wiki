/**
 * Dogslamloop Wiki - Owner Tools (Personnel Management, Media Garbage Collection)
 *
 * Split out of admin.js as part of the admin-page rework: these two tools
 * are admin-only and unrelated to the reviewer workflow admin.html/admin.js
 * are scoped to. Access here is admin-only, not admin/reviewer like
 * admin.html - kickUser/the RBAC-gate shape is intentionally duplicated
 * from admin.js rather than shared, matching this codebase's existing
 * precedent of small per-file duplication over new cross-file coupling
 * (see admin.js's own toggleMobilePreview, reimplemented rather than
 * pulling in editor.js for one function).
 */

// --- BFCACHE GUARD ---
// Same fix as admin.js's own bfcache guard (see that file's comment for
// the full incident writeup) - this page shares the identical RBAC-gate
// shape and is just as vulnerable to a stale back-forward-cache snapshot
// skipping the auth check entirely on back/forward navigation.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});

// --- RBAC GATEKEEPER (admin only) ---
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    // Same retry-before-denying resilience as admin-core.js's own gate - a
    // single dropped request here used to permanently kick a legitimate
    // admin to ACCESS DENIED with no recovery short of a manual refresh.
    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { kickUser(); return; }

    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('role').eq('user_id', session.user.id));
    }

    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];

    // Owner only, which is the whole point of v0.17's split: an admin works the
    // review queue and has no owner-tool access at all (owner, 2026-08-27).
    if (error || !window.rolesMeet(roles, 'owner')) { kickUser(); return; }

    // Lets loadPersonnel mark the signed-in admin and enforce the
    // self-demotion guard without a second lookup.
    currentAdminUserId = session.user.id;

    populateDirectoryOptions();

    ['new-page-name', 'new-page-type', 'new-page-directory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateNewPagePreview);
    });

    // Changing the page type re-suits the folder before the preview reads it.
    const typeEl = document.getElementById('new-page-type');
    if (typeEl) {
        typeEl.addEventListener('change', () => {
            populateDirectoryOptions();
            updateNewPagePreview();
            syncCategoryToType();
        });
    }

    wireCategoryField();
    // 'Character page' is the first option, so the form opens on it.
    syncCategoryToType();

    // Enter searches. A lookup field that only responds to a button is a field
    // people type into and then wonder about.
    const accountSearch = document.getElementById('account-search');
    if (accountSearch) {
        accountSearch.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            searchAccounts();
        });
    }

    await loadPersonnel();
    await loadSitePages();
    await loadPagePermissions();
    await loadFaqEntries();
    await loadCollaborators();
    if (typeof loadStaffPerks === 'function') await loadStaffPerks();
    // Same guard as above: these tools are separate files, and a missing one
    // must not take the rest of the page down.
    if (typeof loadPageExperts === 'function') await loadPageExperts();
});

function kickUser() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
}

// --- CUSTOM MODAL PROMISE (same contract as admin.js's adminConfirm) ---
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

// --- PERSONNEL MANAGEMENT ---
// assign_role_by_email() is a "set role" RPC (supabase/migrations/
// 20260801000000_role_model_fix.sql, applied 2026-08-01): it unconditionally
// clears the target's existing role, then assigns the new one - so a user
// can only ever hold one role at a time, matching the UNIQUE(user_id)
// constraint the same migration added. An empty target-role value means
// "clear all roles" - passed through as SQL NULL, not the string 'guest'
// the old (always-broken, since 'guest' was never a legal role value)
// dropdown option used to send.
// Escaping every interpolated value, including error.message and the RPC's
// own returned string - both of which echo the email typed into the form.
// Only an admin can reach this page, so this is self-XSS at worst, but the
// standard held everywhere else in this codebase is "escape at every
// innerHTML interpolation" and there is no reason for this file to be the
// exception. Flagged as deferred cleanup when the security hotfix shipped;
// done here now that the file is being rewritten anyway.
function ownerEscape(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 'contributor' was removed in v0.11 - it gated nothing, so holding it and
// holding no role at all were the same permission set. 'viewer' now means a
// soft ban: signed in, can read, cannot submit. Labelled explicitly so it
// cannot be mistaken for a neutral or default option in the dropdown.
const ROLE_LABELS = {
    admin: 'Administrator',
    reviewer: 'Reviewer',
    trusted_editor: 'Trusted Editor',
    viewer: 'Viewer (blocked from submitting)',
};

// A role is optional from 20260904000001 onward: a capability can stand on its
// own, so a row may carry a moderator and no role at all. Without this the
// badge rendered empty and the class came out as `badge-role-`.
// Not `roleLabel`: applyRoleChange below already declares a local const by that
// name, and a module-level function of the same name would sit in its shadow -
// legal today, a temporal-dead-zone error the first time somebody calls it from
// in there.
function roleLabelFor(role) {
    if (!role) return 'No role';
    return ROLE_LABELS[role] || role;
}

function roleBadgeClass(role) {
    return role ? `badge-role-${ownerEscape(role)}` : 'badge-role-none';
}

// The dropdown must always open showing what the person ACTUALLY has, because
// the button next to it applies whatever is showing.
//
// Two ways it could show something else. A roleless account matches none of
// ROLE_LABELS, so the select fell through to its first option - Administrator -
// and APPLY would have promoted somebody the owner only meant to look at. And
// 'owner' has never been in ROLE_LABELS, so an owner's row had the same
// problem whenever the last-owner guard did not happen to disable it.
//
// Both are fixed the same way: whatever the person holds is rendered as a
// selected option, in the list or not. Roles NOT in ROLE_LABELS stay
// unofferable - this makes the current value visible, it does not add a way to
// grant it.
function roleOptionsHTML(currentRole) {
    const options = [];

    if (!currentRole) {
        options.push(`<option value="" selected>No role</option>`);
    } else if (!ROLE_LABELS[currentRole]) {
        options.push(`<option value="${ownerEscape(currentRole)}" selected>${ownerEscape(currentRole)}</option>`);
    }

    for (const [value, label] of Object.entries(ROLE_LABELS)) {
        options.push(
            `<option value="${ownerEscape(value)}" ${value === currentRole ? 'selected' : ''}>${ownerEscape(label)}</option>`
        );
    }

    // Only meaningful for somebody who has something to lose. Offering it on a
    // roleless row would read as an action where there is none.
    if (currentRole) options.push(`<option value="">Revoke all access</option>`);

    return options.join('');
}

// Why a capability box is inert, as TEXT rather than only a title attribute.
//
// Owner-reported, 2026-09-04: "The button to grant 'moderate discussions' in
// the owner tools doesn't work (clicking on it and nothing happen)." It was
// working exactly as designed - the box is disabled for anyone who already has
// the capability by virtue of their role - but the only thing saying so was a
// tooltip, and a tooltip is invisible to somebody who has already clicked.
// Nothing about the logic changed here; the reason just became legible.
function capabilityState(person, capability) {
    if (capability === 'can_moderate' && window.roleMeets(person.role, 'reviewer')) {
        return { disabled: true, note: 'comes with the role' };
    }
    if (capability === 'can_delete_media' && window.roleMeets(person.role, 'admin')) {
        return { disabled: true, note: 'comes with the role' };
    }
    return { disabled: false, note: '' };
}

// Populated by loadPersonnel so the self-demotion guard below can recognise
// the signed-in admin without a second round trip.
let currentAdminUserId = null;
let adminCount = 0;

async function loadPersonnel() {
    const container = document.getElementById('personnel-roster');
    if (!container) return;

    container.innerHTML = `<p class="loading-msg">Loading roster...</p>`;

    const { data, error } = await window.supabaseClient.rpc('list_personnel');

    if (error) {
        // PGRST202 means the function is not in the schema cache - almost
        // always "this migration has not been applied yet", which is the
        // normal state between deploying the code and merging. Raw PostgREST
        // text here reads like a crash; say what it actually means.
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">The roster isn't available yet - the <code>list_personnel</code> database function hasn't been deployed. It arrives with the next migration.</p>`
            : `<p class="admin-error-text">Could not load the roster: ${ownerEscape(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No roles assigned yet.</p>`;
        return;
    }

    // Counts OWNERS, not admins. This guards against removing the last account
    // that can still reach this page - and after v0.17 an admin cannot, so
    // counting admins would leave the site with nobody able to assign roles.
    adminCount = data.filter(p => p.role === 'owner').length;

    container.innerHTML = data.map(personnelRowHTML).join('');
    bindPersonnelRows(container);
}
window.loadPersonnel = loadPersonnel;

// Shared by the roster and by the account search below, so somebody found by
// search gets exactly the same controls as somebody already on the roster -
// including the role dropdown, which is how a searched-for account gets its
// first role without a second, near-identical block of markup to keep in sync.
function personnelRowHTML(person) {
    {
        const isSelf = person.user_id === currentAdminUserId;
        // The last admin demoting themselves locks everyone out of this page
        // permanently - the only recovery is direct database access. Blocked
        // in the UI rather than left as a trap.
        const isLastAdmin = person.role === 'owner' && adminCount === 1;
        const moderateState = capabilityState(person, 'can_moderate');
        const deleteMediaState = capabilityState(person, 'can_delete_media');
        return `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge ${roleBadgeClass(person.role)}">${ownerEscape(roleLabelFor(person.role))}</span>
                ${person.display_name ? `<span class="personnel-name">${ownerEscape(person.display_name)}</span>` : ''}
                <span class="personnel-email">${ownerEscape(person.email)}${isSelf ? ' <span class="personnel-self">(you)</span>' : ''}</span>
            </div>
            <div class="personnel-row-actions">
                <select class="editor-input personnel-role-select" data-email="${ownerEscape(person.email)}" ${isLastAdmin ? 'disabled' : ''}>
                    ${roleOptionsHTML(person.role)}
                </select>
                <button class="btn-sys btn-sys-regular personnel-apply-btn"
                        data-email="${ownerEscape(person.email)}"
                        ${isLastAdmin ? 'disabled title="You are the only admin - promote someone else first."' : ''}>APPLY</button>
            </div>
            <!--
                Capabilities are extras on top of a role, never a second role:
                user_roles has UNIQUE(user_id) precisely because holding two
                broke get_my_role() for that user everywhere. A checkbox here
                writes a column, so that constraint is untouched.
            -->
            <label class="personnel-capability" title="Skips the 3-minute wait between submissions for this person only.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${ownerEscape(person.email)}"
                       data-capability="bypass_cooldown"
                       ${person.bypass_cooldown ? 'checked' : ''}>
                <span>Skip submission cooldown</span>
            </label>
            <!--
                The second capability, following the pattern the first one set.
                Admins and reviewers can already moderate by virtue of their
                role, so this box is what grants it to everybody else - which
                is the point: moderating threads should not require handing
                somebody the whole revision queue.
            -->
            <label class="personnel-capability" title="Lets this person hide or remove discussion posts. Admins and reviewers can already do this.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${ownerEscape(person.email)}"
                       data-capability="can_moderate"
                       ${person.can_moderate ? 'checked' : ''}
                       ${moderateState.disabled ? 'disabled' : ''}>
                <span>Moderate discussions${moderateState.note ? ` <span class="personnel-capability-note">(${ownerEscape(moderateState.note)})</span>` : ''}</span>
            </label>
            <!--
                Deliberately NOT implied by reviewer, unlike moderation. This
                is the only irreversible action on the site - the file is gone
                from storage - so it is granted one person at a time rather
                than arriving with a role.
            -->
            <label class="personnel-capability" title="Lets this person permanently delete files from the media bucket. Not implied by any role except admin.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${ownerEscape(person.email)}"
                       data-capability="can_delete_media"
                       ${person.can_delete_media ? 'checked' : ''}
                       ${deleteMediaState.disabled ? 'disabled' : ''}>
                <span>Delete media${deleteMediaState.note ? ` <span class="personnel-capability-note">(${ownerEscape(deleteMediaState.note)})</span>` : ''}</span>
            </label>
        </div>`;
    }
}

// Same delegated pattern as the APPLY button, and for the same reason:
// the email comes from auth.users and must never reach an inline handler.
function bindPersonnelRows(container) {
    container.querySelectorAll('.personnel-capability-box').forEach(box => {
        box.addEventListener('change', async () => {
            const email = box.dataset.email;
            const capability = box.dataset.capability;
            const enabled = box.checked;
            const results = document.getElementById('role-results');

            box.disabled = true;
            const { data, error } = await window.supabaseClient.rpc('set_user_capability', {
                target_email: email, capability, enabled,
            });
            box.disabled = false;

            if (error) {
                // Put the box back rather than leaving it showing a state the
                // database does not have - the same rule the staff perk switch
                // follows.
                box.checked = !enabled;
                const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
                results.innerHTML = notDeployed
                    ? `<span class="admin-error-text">Capabilities aren't available yet - the <code>set_user_capability</code> function hasn't been deployed. It arrives with the next migration.</span>`
                    : `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
                return;
            }

            results.innerHTML = `<span class="owner-success-text">${ownerEscape(data)}</span>`;
        });
    });

    // Delegated rather than inline onclick: the email is attacker-influenced
    // in principle (it comes from auth.users) and building it into an
    // onclick attribute is the exact pattern that made site_utils.js's
    // notification modal an XSS risk in v0.8.
    container.querySelectorAll('.personnel-apply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const select = container.querySelector(`.personnel-role-select[data-email="${CSS.escape(email)}"]`);
            applyRoleChange(email, select ? select.value : '');
        });
    });
}

// Finding somebody who is not on the roster yet.
//
// The roster is FROM user_roles, so it can only ever show people who already
// hold something. The owner's problem, in their words: "a new Vessel Expert
// come to me... he logged in using a burner mail expecting that I don't talk
// about it. Now it is impossible for me to shift through the list just to find
// the email to assign it to him."
//
// So this searches the DISPLAY NAME as well as the address, because the name is
// the only thing the owner actually knows in that situation. Results render
// through personnelRowHTML - the same row, with the same controls - so granting
// a role or a capability to somebody found here is the same gesture as doing it
// on the roster, rather than a second half-featured path.
async function searchAccounts() {
    const input = document.getElementById('account-search');
    const container = document.getElementById('account-search-results');
    if (!input || !container) return;

    const query = input.value.trim();

    // Matches the function's own floor, so the UI explains the rule rather than
    // returning silently and looking broken.
    if (query.length < 2) {
        container.innerHTML = `<p class="admin-tool-hint">Type at least two characters of an email address or a display name.</p>`;
        return;
    }

    container.innerHTML = `<p class="loading-msg">Searching...</p>`;

    const { data, error } = await window.supabaseClient.rpc('search_users', { search_query: query });

    if (error) {
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">Account search isn't available yet - the <code>search_users</code> database function hasn't been deployed. It arrives with the next migration.</p>`
            : `<p class="admin-error-text">Could not search: ${ownerEscape(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No account matches that.</p>`;
        return;
    }

    container.innerHTML = data.map(personnelRowHTML).join('');
    bindPersonnelRows(container);
}
window.searchAccounts = searchAccounts;

async function applyRoleChange(email, newRole) {
    const results = document.getElementById('role-results');
    const roleLabel = newRole ? (ROLE_LABELS[newRole] || newRole) : 'REVOKE ALL ACCESS';

    if (!(await adminConfirm(`Change ${email}'s clearance to ${roleLabel}?`))) return;

    results.innerHTML = 'Applying...';

    const { data, error } = await window.supabaseClient.rpc('assign_role_by_email', {
        target_email: email,
        assigned_role: newRole || null,
    });

    if (error) {
        results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">${ownerEscape(data)}</span>`;
    await loadPersonnel();
}

async function changeUserRole() {
    const email = document.getElementById('target-email').value.trim();
    const newRole = document.getElementById('target-role').value || null;
    const results = document.getElementById('role-results');

    if (!email) {
        results.innerHTML = `<span class="admin-error-text">Please enter an email address.</span>`;
        return;
    }

    await applyRoleChange(email, newRole || '');
    document.getElementById('target-email').value = '';
}

// --- PAGES ---
// site_pages is the registry data/navigation.json is generated from
// (20260808000003_site_pages.sql). Creating a page here is an insert; the
// regeneration workflow turns it into a nav entry and a stub file.
//
// Archiving rather than deleting is the default on purpose: an archived page
// keeps a tombstone stub so existing links and Discord embeds resolve instead
// of 404ing, and it simply stops appearing in menus.

const STATUS_LABELS = { live: 'Live', draft: 'Draft', archived: 'Archived' };

// Mirrors js/site_utils.js's buildPageUrl and the folder convention the
// generator expects: characters/Capitalized_snake/, systems/lower-slug/.
// Where a page lives, kept separate from how it renders.
//
// These were the same thing until now: page_type decided the directory, so
// "Others" and "Tools" pages were impossible without inventing render types
// for them. They are different questions. An Emotes page lives in others/ and
// renders exactly like a system page - tabs of blocks, which js/page_boot.js
// already treats as the default for anything that is not a character.
//
// Keeping page_type as-is also means no migration: the CHECK constraint on
// site_pages.page_type is untouched, and site_pages.url already stores the
// full path, so the directory needs no column of its own.
// A directory lists the types it can hold, not one type: others/ takes both
// ordinary system pages (gamemodes, easter eggs) and the gallery that Emotes
// needs. The first entry is the default when the type changes.
const PAGE_DIRECTORIES = {
    characters: { label: 'characters/ - character pages', pageTypes: ['character'] },
    systems: { label: 'systems/ - systems and guides', pageTypes: ['system'] },
    others: { label: 'others/ - gamemodes, emotes, easter eggs', pageTypes: ['system', 'gallery'] },
    tools: { label: 'tools/ - your own tools', pageTypes: ['tool'] },
};
window.PAGE_DIRECTORIES = PAGE_DIRECTORIES;

function derivePageIdentity(name, pageType, directory) {
    const pageId = String(name || '').toLowerCase().trim()
        .replace(/[^\w\s-]/g, '').replace(/[\s-]+/g, '_').replace(/^_|_$/g, '');
    if (!pageId) return null;

    // Defaulting from page_type keeps every existing caller working unchanged,
    // and gives a new type somewhere sensible to land when no folder is named.
    const dir = PAGE_DIRECTORIES[directory]
        ? directory
        : (Object.keys(PAGE_DIRECTORIES).find(d => PAGE_DIRECTORIES[d].pageTypes.includes(pageType)) || 'systems');

    // Character folders are Capitalised_like_this; everything else is
    // kebab-case. That split is historical but it is what the 22 existing
    // character URLs look like, so it stays.
    const folder = dir === 'characters'
        ? pageId.charAt(0).toUpperCase() + pageId.slice(1)
        : pageId.replace(/_/g, '-');
    const url = `${dir}/${folder}/index.html`;
    const navId = String(name).trim().replace(/\s+/g, '-');
    return { pageId, url, navId, directory: dir };
}
window.derivePageIdentity = derivePageIdentity;

// Fills the folder list, and keeps it in step with the page type: picking
// "Character page" should not leave the folder on tools/. Only nudges the
// selection when the current one does not suit the type, so an explicit
// choice of others/ for a system page survives.
function populateDirectoryOptions() {
    const select = document.getElementById('new-page-directory');
    const typeEl = document.getElementById('new-page-type');
    if (!select || !typeEl) return;

    const pageType = typeEl.value;
    const current = select.value;

    select.innerHTML = Object.entries(PAGE_DIRECTORIES)
        .map(([dir, meta]) => `<option value="${ownerEscape(dir)}">${ownerEscape(meta.label)}</option>`)
        .join('');

    const suits = current && PAGE_DIRECTORIES[current] && PAGE_DIRECTORIES[current].pageTypes.includes(pageType);
    select.value = suits
        ? current
        : Object.keys(PAGE_DIRECTORIES).find(d => PAGE_DIRECTORIES[d].pageTypes.includes(pageType)) || 'systems';
}

function updateNewPagePreview() {
    const el = document.getElementById('new-page-preview');
    if (!el) return;
    const name = document.getElementById('new-page-name').value;
    const type = document.getElementById('new-page-type').value;
    const directory = (document.getElementById('new-page-directory') || {}).value;
    const identity = derivePageIdentity(name, type, directory);
    el.innerHTML = identity
        ? `Will be created at <code>${ownerEscape(identity.url)}</code>`
        : '';
}

async function loadSitePages() {
    const container = document.getElementById('pages-list');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('site_pages').select('page_id, name, url, category, page_type, status, sort_order').order('category').order('sort_order');

    if (error) {
        const notDeployed = error.code === 'PGRST205' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">Page management isn't available yet - the <code>site_pages</code> table hasn't been deployed. It arrives with the next migration.</p>`
            : `<p class="admin-error-text">Could not load pages: ${ownerEscape(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No pages registered.</p>`;
        return;
    }

    container.innerHTML = data.map(page => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge badge-status-${ownerEscape(page.status)}">${ownerEscape(STATUS_LABELS[page.status] || page.status)}</span>
                <span class="personnel-email">${ownerEscape(page.name)}</span>
                <span class="page-row-path">${ownerEscape(page.url)}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular page-move-btn" data-page="${ownerEscape(page.page_id)}" data-dir="up" title="Move up">▲</button>
                <button class="btn-sys btn-sys-regular page-move-btn" data-page="${ownerEscape(page.page_id)}" data-dir="down" title="Move down">▼</button>
                ${page.status === 'archived'
                    ? `<button class="btn-sys btn-sys-green page-restore-btn" data-page="${ownerEscape(page.page_id)}">RESTORE</button>`
                    : `<button class="btn-sys btn-sys-yellow page-archive-btn" data-page="${ownerEscape(page.page_id)}">ARCHIVE</button>`}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.page-archive-btn').forEach(btn => {
        btn.addEventListener('click', () => setPageStatus(btn.dataset.page, 'archived'));
    });
    container.querySelectorAll('.page-restore-btn').forEach(btn => {
        btn.addEventListener('click', () => setPageStatus(btn.dataset.page, 'live'));
    });
    container.querySelectorAll('.page-move-btn').forEach(btn => {
        btn.addEventListener('click', () => movePage(btn.dataset.page, btn.dataset.dir));
    });

    cachedSitePages = data;
    // Order matters: both of these read knownCategories(), which derives from
    // the cache assigned on the line above.
    populateCategoryOptions();
    populatePositionOptions();
    updateCategoryNote();
}
window.loadSitePages = loadSitePages;

// Kept so the position dropdown and the move buttons can reason about
// neighbours without re-querying on every keystroke.
let cachedSitePages = [];

// Order within a category is sort_order, and the site's character list is
// meaningful rather than alphabetical - it mirrors in-game release order,
// full characters before base-only ones. So a new page frequently belongs in
// the middle, not at the end.
// The category field is free text with a datalist. site_pages.category has no
// CHECK constraint and navigation.json is keyed by the string verbatim
// (js/pagebuilder.js builds one sidebar group per key), so "Guides" and
// "guides " would render as two separate groups. Existing spellings are
// offered first, and canonicaliseCategory below adopts one on save.
function knownCategories() {
    return [...new Set(cachedSitePages.map(p => p.category).filter(Boolean))].sort();
}

function populateCategoryOptions() {
    const list = document.getElementById('page-category-options');
    if (!list) return;
    list.innerHTML = knownCategories()
        .map(c => `<option value="${ownerEscape(c)}"></option>`).join('');
}

// Trims, then adopts an existing category's exact spelling if one matches
// case-insensitively. Returns the canonical string, so a new category is only
// ever created when the owner genuinely typed something new.
function canonicaliseCategory(raw) {
    const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    const match = knownCategories().find(c => c.toLowerCase() === trimmed.toLowerCase());
    return match || trimmed;
}

// Says plainly when the typed value will create a new sidebar group, so that
// is a deliberate act rather than a typo nobody notices until the nav renders.
// A character page's category is not a choice, and offering one produced a
// broken site (owner, 2026-09-03: "Adding a character page require me to pick a
// category, but if I do, it will break the formatting").
//
// navigation.json is keyed by category and 'Characters' is load-bearing in
// three separate places: buildCharacterRoster reads navData["Characters"]
// literally (js/pagebuilder.js), buildSystemsDirectory renders every key EXCEPT
// that one, and the sidebar colours entries only under it. So a character filed
// under anything else vanished from the roster AND appeared as a stray category
// in Guides & Such - which is the formatting break, in both directions at once.
const CHARACTER_CATEGORY = 'Characters';

function categoryIsForced() {
    const typeEl = document.getElementById('new-page-type');
    return !!typeEl && typeEl.value === 'character';
}

// Pins the field to 'Characters' for a character page and hands it back
// otherwise. Called on every type change, so switching away restores whatever
// the owner had typed rather than leaving 'Characters' behind on a system page.
function syncCategoryToType() {
    const input = document.getElementById('new-page-category');
    if (!input) return;

    if (categoryIsForced()) {
        if (input.value !== CHARACTER_CATEGORY) input.dataset.previousCategory = input.value;
        input.value = CHARACTER_CATEGORY;
        input.readOnly = true;
        input.classList.add('owner-field-locked');
    } else if (input.readOnly) {
        input.readOnly = false;
        input.classList.remove('owner-field-locked');
        input.value = input.dataset.previousCategory || '';
        delete input.dataset.previousCategory;
    }
    updateCategoryNote();
    populatePositionOptions();
}

// Says plainly when the typed value will create a new sidebar group, so that
// is a deliberate act rather than a typo nobody notices until the nav renders.
function updateCategoryNote() {
    const note = document.getElementById('new-page-category-note');
    const input = document.getElementById('new-page-category');
    if (!note || !input) return;

    if (categoryIsForced()) {
        note.textContent = 'Character pages always go in Characters - the roster reads that name literally.';
        return;
    }

    const value = canonicaliseCategory(input.value);
    if (!value) { note.textContent = ''; return; }

    note.textContent = knownCategories().includes(value)
        ? `Goes into the existing "${value}" section.`
        : `New category. "${value}" becomes its own section in the sidebar.`;
}

// Changing category changes which pages the new one can sit after, and
// whether it is creating a section or joining one.
//
// 'input' rather than 'change': this is a text field with a datalist now, so
// it has to react to typing as well as to picking a suggestion. Named and
// exported rather than inlined into the DOMContentLoaded handler so the
// binding can be re-applied to a rebuilt form.
function wireCategoryField() {
    const categoryEl = document.getElementById('new-page-category');
    if (!categoryEl) return;
    categoryEl.addEventListener('input', () => {
        populatePositionOptions();
        updateCategoryNote();
    });
}

function populatePositionOptions() {
    const select = document.getElementById('new-page-position');
    const category = document.getElementById('new-page-category');
    if (!select || !category) return;

    const siblings = cachedSitePages.filter(p => p.category === canonicaliseCategory(category.value));
    const current = select.value;

    select.innerHTML = `<option value="">At the end of the category</option>`
        + siblings.map(p => `<option value="${ownerEscape(p.page_id)}">After: ${ownerEscape(p.name)}</option>`).join('');

    // Preserve the choice across a re-render if it is still valid.
    if (current && siblings.some(p => p.page_id === current)) select.value = current;
}

/**
 * Works out the sort_order for a page being inserted after `afterPageId`.
 *
 * sort_order is spaced by 10 so there is normally room to slot between two
 * neighbours. When there is not - repeated insertions in the same spot
 * eventually close the gap - the whole category is renumbered back to clean
 * spacing first. Returning a fractional or duplicate value instead would
 * quietly corrupt the ordering.
 */
async function resolveSortOrder(category, afterPageId) {
    const siblings = cachedSitePages
        .filter(p => p.category === category)
        .sort((a, b) => a.sort_order - b.sort_order);

    if (!afterPageId) {
        const last = siblings[siblings.length - 1];
        return { sortOrder: (last ? last.sort_order : -10) + 10, renumbered: false };
    }

    const idx = siblings.findIndex(p => p.page_id === afterPageId);
    if (idx === -1) {
        const last = siblings[siblings.length - 1];
        return { sortOrder: (last ? last.sort_order : -10) + 10, renumbered: false };
    }

    const before = siblings[idx];
    const after = siblings[idx + 1];

    if (!after) return { sortOrder: before.sort_order + 10, renumbered: false };

    const gap = after.sort_order - before.sort_order;
    if (gap > 1) {
        return { sortOrder: before.sort_order + Math.floor(gap / 2), renumbered: false };
    }

    // No room. Renumber the category to 0,10,20,... then insert into the
    // freshly-created gap.
    for (let i = 0; i < siblings.length; i++) {
        const desired = i * 10;
        if (siblings[i].sort_order !== desired) {
            await window.supabaseClient.from('site_pages')
                .update({ sort_order: desired }).eq('page_id', siblings[i].page_id);
            siblings[i].sort_order = desired;
        }
    }
    return { sortOrder: idx * 10 + 5, renumbered: true };
}

// Swaps a page with its neighbour. Simpler to reason about than recomputing
// the whole category, and it is the operation people actually want after
// realising something is one slot out of place.
async function movePage(pageId, direction) {
    const results = document.getElementById('pages-results');
    const page = cachedSitePages.find(p => p.page_id === pageId);
    if (!page) return;

    const siblings = cachedSitePages
        .filter(p => p.category === page.category)
        .sort((a, b) => a.sort_order - b.sort_order);

    const idx = siblings.findIndex(p => p.page_id === pageId);
    const swapWith = direction === 'up' ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return;

    results.innerHTML = 'Reordering...';

    const a = window.supabaseClient.from('site_pages').update({ sort_order: swapWith.sort_order }).eq('page_id', page.page_id);
    const b = window.supabaseClient.from('site_pages').update({ sort_order: page.sort_order }).eq('page_id', swapWith.page_id);
    const [{ error: errA }, { error: errB }] = await Promise.all([a, b]);

    if (errA || errB) {
        results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape((errA || errB).message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">Moved "${ownerEscape(page.name)}". Menus update after the next regeneration run.</span>`;
    await loadSitePages();
}

async function setPageStatus(pageId, status) {
    const results = document.getElementById('pages-results');
    const message = status === 'archived'
        ? `Archive "${pageId}"? It will disappear from the menus, but its page will stay reachable so existing links don't break.`
        : `Restore "${pageId}" to the menus?`;

    if (!(await adminConfirm(message))) return;

    results.innerHTML = 'Applying...';
    const { error } = await window.supabaseClient
        .from('site_pages').update({ status, updated_at: new Date().toISOString() }).eq('page_id', pageId);

    if (error) {
        results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${ownerEscape(pageId)}" is now ${ownerEscape(STATUS_LABELS[status])}. It updates on the site after the next regeneration run.</span>`;
    await loadSitePages();
}

async function createSitePage() {
    const results = document.getElementById('pages-results');
    const name = document.getElementById('new-page-name').value.trim();
    const pageType = document.getElementById('new-page-type').value;
    // Forced rather than read for a character page. The field is locked in the
    // form, but the form is a courtesy - this is the value that reaches the
    // database, and a character under any other category breaks the roster.
    const category = pageType === 'character'
        ? CHARACTER_CATEGORY
        : canonicaliseCategory(document.getElementById('new-page-category').value);

    if (!name) {
        results.innerHTML = `<span class="admin-error-text">Give the page a name.</span>`;
        return;
    }

    // Free text means it can be left empty, which a select could not do. An
    // empty category would key navigation.json on "" and render a nameless
    // sidebar group.
    if (!category) {
        results.innerHTML = `<span class="admin-error-text">Pick a category, or type a new one.</span>`;
        return;
    }

    const directory = (document.getElementById('new-page-directory') || {}).value;
    const identity = derivePageIdentity(name, pageType, directory);
    if (!identity) {
        results.innerHTML = `<span class="admin-error-text">That name has no usable characters for a URL - try adding letters or numbers.</span>`;
        return;
    }

    if (!(await adminConfirm(`Create "${name}" at ${identity.url}?`))) return;

    results.innerHTML = 'Creating...';

    // Position matters: the character list mirrors in-game release order
    // (full characters, then base-only), so a new page often belongs in the
    // middle rather than at the end.
    const afterPageId = document.getElementById('new-page-position').value;
    const { sortOrder: nextOrder } = await resolveSortOrder(category, afterPageId);

    const { error } = await window.supabaseClient.from('site_pages').insert([{
        page_id: identity.pageId,
        nav_id: identity.navId,
        name,
        url: identity.url,
        category,
        sort_order: nextOrder,
        page_type: pageType,
        edit_role: 'open',
        // New pages are works in progress by definition - this puts the WIP
        // badge on straight away rather than presenting an empty page as
        // finished.
        is_wip: true,
    }]);

    if (error) {
        const duplicate = /duplicate key|unique/i.test(error.message || '');
        results.innerHTML = `<span class="admin-error-text">${duplicate
            ? `A page already exists at that address (${ownerEscape(identity.url)}). Pick a different name.`
            : `Error: ${ownerEscape(error.message)}`}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">Created "${ownerEscape(name)}". It appears on the site after the next regeneration run.</span>`;
    document.getElementById('new-page-name').value = '';
    updateNewPagePreview();
    await loadSitePages();
}
window.createSitePage = createSitePage;

// --- PAGE RESTRICTIONS ---
// page_permissions gained a write path in v0.10
// (20260808000002_page_permissions_writable.sql), and required_role stopped
// being decorative in the same migration. Before that, the only rows that
// existed were three seeded by a migration, and the column nothing read.

const PERMISSION_ROLE_LABELS = {
    trusted_editor: 'Trusted Editor',
    admin: 'Administrator',
};

async function loadPagePermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('page_permissions').select('page_id, required_role').order('page_id');

    if (error) {
        container.innerHTML = `<p class="admin-error-text">Could not load restrictions: ${ownerEscape(error.message)}</p>`;
        return;
    }

    await populatePermissionPageOptions(data || []);

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No pages are restricted. Every page is open to signed-in contributors.</p>`;
        return;
    }

    container.innerHTML = data.map(row => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge badge-role-${ownerEscape(row.required_role)}">${ownerEscape(PERMISSION_ROLE_LABELS[row.required_role] || row.required_role)}</span>
                <span class="personnel-email">${ownerEscape(row.page_id)}</span>
            </div>
            <div class="personnel-row-actions">
                <select class="editor-input personnel-role-select" data-page="${ownerEscape(row.page_id)}">
                    ${Object.entries(PERMISSION_ROLE_LABELS).map(([value, label]) =>
                        `<option value="${ownerEscape(value)}" ${value === row.required_role ? 'selected' : ''}>${ownerEscape(label)}</option>`
                    ).join('')}
                </select>
                <button class="btn-sys btn-sys-regular permission-apply-btn" data-page="${ownerEscape(row.page_id)}">APPLY</button>
                <button class="btn-sys btn-sys-red permission-remove-btn" data-page="${ownerEscape(row.page_id)}">UNRESTRICT</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.permission-apply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pageId = btn.dataset.page;
            const select = container.querySelector(`.personnel-role-select[data-page="${CSS.escape(pageId)}"]`);
            setPagePermission(pageId, select ? select.value : 'trusted_editor');
        });
    });
    container.querySelectorAll('.permission-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => removePagePermission(btn.dataset.page));
    });
}
window.loadPagePermissions = loadPagePermissions;

// Offers only pages that exist and are not already restricted, so the form
// cannot create a row for a page id that was mistyped or has since been
// renamed - a stray row would silently lock a page nobody can find.
async function populatePermissionPageOptions(existing) {
    const select = document.getElementById('permission-page');
    if (!select) return;

    const taken = new Set((existing || []).map(r => r.page_id));
    let navData = null;
    try {
        navData = typeof window.fetchNavigationData === 'function' ? await window.fetchNavigationData() : null;
    } catch (e) {
        navData = null;
    }

    if (!navData) {
        select.innerHTML = `<option value="">(could not load page list)</option>`;
        return;
    }

    const options = Object.values(navData).flat()
        .filter(e => e.cms_config && e.cms_config.pageId && !taken.has(e.cms_config.pageId))
        // Every page type that has an editor behind it, which is the real
        // criterion for "can its editing be restricted". 'hub' and 'external'
        // are excluded because there is nothing to edit: a hub is
        // hand-authored and an external entry is a link with no page.
        //
        // gallery and tool were missing until 2026-08-12 - they shipped in
        // v0.12 with their own editors, and this list was not updated, so the
        // owner's Emotes gallery could never be locked to trusted editors.
        // Same omission that broke the regeneration validators.
        .filter(e => ['character', 'system', 'tierlist', 'gallery', 'tool'].includes(e.cms_config.pageType))
        .sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML = options.length === 0
        ? `<option value="">(every page is already restricted)</option>`
        : options.map(e => `<option value="${ownerEscape(e.cms_config.pageId)}">${ownerEscape(e.name)}</option>`).join('');
}

async function setPagePermission(pageId, requiredRole) {
    const results = document.getElementById('permission-results');
    const label = PERMISSION_ROLE_LABELS[requiredRole] || requiredRole;

    if (!(await adminConfirm(`Require ${label} clearance to edit "${pageId}"?`))) return;

    results.innerHTML = 'Applying...';
    const { error } = await window.supabaseClient
        .from('page_permissions')
        .upsert([{ page_id: pageId, required_role: requiredRole }], { onConflict: 'page_id' });

    if (error) {
        results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${ownerEscape(pageId)}" now requires ${ownerEscape(label)}.</span>`;
    await loadPagePermissions();
}

async function addPagePermission() {
    const pageId = document.getElementById('permission-page').value;
    const role = document.getElementById('permission-role').value;
    const results = document.getElementById('permission-results');

    if (!pageId) {
        results.innerHTML = `<span class="admin-error-text">Pick a page to restrict.</span>`;
        return;
    }
    await setPagePermission(pageId, role);
}
window.addPagePermission = addPagePermission;

async function removePagePermission(pageId) {
    const results = document.getElementById('permission-results');
    if (!(await adminConfirm(`Remove the restriction on "${pageId}"? Any signed-in contributor will be able to submit edits.`))) return;

    results.innerHTML = 'Removing...';
    const { error } = await window.supabaseClient.from('page_permissions').delete().eq('page_id', pageId);

    if (error) {
        results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${ownerEscape(pageId)}" is no longer restricted.</span>`;
    await loadPagePermissions();
}

// --- FAQ ---
// data/faq.json was a static file, so changing an answer meant a commit. The
// runtime still fetches plain JSON (js/home_widgets.js loadFAQ) - the
// regeneration workflow writes it back out from site_faq.

function contentNotDeployedMessage(error, what) {
    const notDeployed = error.code === 'PGRST205' || /schema cache/i.test(error.message || '');
    // PGRST202 is the same situation for a FUNCTION rather than a table, and it
    // is what an RPC-backed tool gets between deploying its code and the
    // release. It was missing here, which is why loadPersonnel carried its own
    // inline check - the shared helper only knew about tables, so every RPC tool
    // fell through to raw PostgREST text. The 205 sentence is unchanged on
    // purpose: it is asserted elsewhere.
    if (error.code === 'PGRST202') {
        return `<p class="admin-error-text">${what} isn't available yet - the database function it needs hasn't been deployed. It arrives with the next migration.</p>`;
    }
    return notDeployed
        ? `<p class="admin-error-text">${what} editing isn't available yet - its table hasn't been deployed. It arrives with the next migration.</p>`
        : `<p class="admin-error-text">Could not load: ${ownerEscape(error.message)}</p>`;
}

async function loadFaqEntries() {
    const container = document.getElementById('faq-admin-list');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('site_faq').select('id, question, paragraphs, sort_order').order('sort_order');

    if (error) { container.innerHTML = contentNotDeployedMessage(error, 'FAQ'); return; }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No FAQ entries yet.</p>`;
        return;
    }

    // The answer was previously write-once: this tool could add and delete a
    // question but never change one, so fixing a typo meant deleting the entry
    // and retyping it - which also moved it to the bottom, because a new row
    // gets a new sort_order.
    //
    // Edited in place rather than in a modal: the paragraph splitting is the
    // thing most likely to surprise, and seeing the answer in the same shape it
    // was written is what makes that legible.
    container.innerHTML = data.map(row => `
        <div class="personnel-row faq-row" data-id="${ownerEscape(row.id)}">
            <div class="personnel-row-main">
                <span class="personnel-email">${ownerEscape(row.question)}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular faq-edit-btn" data-id="${ownerEscape(row.id)}">EDIT</button>
                <button class="btn-sys btn-sys-red faq-delete-btn" data-id="${ownerEscape(row.id)}">DELETE</button>
            </div>
            <div class="owner-inline-editor" hidden>
                <label class="block-field-label-sm">QUESTION</label>
                <input type="text" class="editor-input admin-input-full faq-edit-question" value="${ownerEscape(row.question)}">
                <label class="block-field-label-sm">ANSWER</label>
                <textarea class="editor-textarea admin-input-full faq-edit-answer" rows="5">${ownerEscape((row.paragraphs || []).join('\n\n'))}</textarea>
                <p class="admin-tool-hint">A blank line starts a new paragraph.</p>
                <div class="owner-inline-editor-actions">
                    <button class="btn-sys btn-sys-green faq-save-btn" data-id="${ownerEscape(row.id)}">SAVE</button>
                    <button class="btn-sys btn-sys-regular faq-cancel-btn">CANCEL</button>
                </div>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.faq-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteFaqEntry(btn.dataset.id));
    });

    // hidden, not style.display: the harness toggles .hidden elsewhere in this
    // codebase and a stylesheet that later sets display on this class would win
    // against an inline style set the other way.
    container.querySelectorAll('.faq-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const editor = btn.closest('.faq-row').querySelector('.owner-inline-editor');
            editor.hidden = !editor.hidden;
        });
    });

    container.querySelectorAll('.faq-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Reloads rather than just hiding, so a cancelled edit cannot leave
            // edited text sitting in a closed box waiting to confuse the next
            // person who opens it.
            loadFaqEntries();
        });
    });

    container.querySelectorAll('.faq-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.faq-row');
            saveFaqEntry(
                btn.dataset.id,
                row.querySelector('.faq-edit-question').value,
                row.querySelector('.faq-edit-answer').value
            );
        });
    });
}

// Same paragraph rule as addFaqEntry, and deliberately the same validation:
// an edit that empties an answer would render a question with nothing under it.
async function saveFaqEntry(id, question, answer) {
    const results = document.getElementById('faq-results');
    const trimmed = question.trim();

    if (!trimmed) { results.innerHTML = `<span class="admin-error-text">A question cannot be empty.</span>`; return; }

    const paragraphs = answer.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) { results.innerHTML = `<span class="admin-error-text">An answer cannot be empty.</span>`; return; }

    results.innerHTML = 'Saving...';

    const { error } = await window.supabaseClient
        .from('site_faq').update({ question: trimmed, paragraphs }).eq('id', id);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Saved. It reaches the site on the next regeneration.</span>`;
    await loadFaqEntries();
}
window.saveFaqEntry = saveFaqEntry;
window.loadFaqEntries = loadFaqEntries;

async function addFaqEntry() {
    const results = document.getElementById('faq-results');
    const question = document.getElementById('new-faq-question').value.trim();
    const answer = document.getElementById('new-faq-answer').value;

    if (!question) { results.innerHTML = `<span class="admin-error-text">Enter a question.</span>`; return; }

    // Blank lines separate paragraphs, matching how the renderer emits one
    // <p> per array entry.
    const paragraphs = answer.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) { results.innerHTML = `<span class="admin-error-text">Enter an answer.</span>`; return; }

    const { data: last } = await window.supabaseClient
        .from('site_faq').select('sort_order').order('sort_order', { ascending: false }).limit(1);
    const sortOrder = (last && last[0] ? last[0].sort_order : -10) + 10;

    const { error } = await window.supabaseClient
        .from('site_faq').insert([{ question, paragraphs, sort_order: sortOrder }]);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Added. It appears on the site after the next regeneration run.</span>`;
    document.getElementById('new-faq-question').value = '';
    document.getElementById('new-faq-answer').value = '';
    await loadFaqEntries();
}
window.addFaqEntry = addFaqEntry;

async function deleteFaqEntry(id) {
    const results = document.getElementById('faq-results');
    if (!(await adminConfirm('Delete this FAQ entry?'))) return;

    const { error } = await window.supabaseClient.from('site_faq').delete().eq('id', id);
    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Deleted.</span>`;
    await loadFaqEntries();
}

// --- CREDITS / COLLABORATORS ---
// Single source for both the Collaborators page and the main dashboard's
// Credits list, which used to be a hand-maintained duplicate in index.html.

// The badge COLOUR. `role` is the text inside it - "Frame Data & Testing" -
// and badge_type picks which of Badges.css's five it is drawn in. Two fields
// that sound like one, so they are labelled by what they do rather than by
// their column names.
const CREDIT_BADGES = {
    'badge-general': 'Purple (default)',
    'badge-site': 'Green',
    'badge-patch': 'Blue',
    'badge-wip': 'Yellow',
    'badge-ea': 'Orange',
};

// Stored as [{name, url}], edited as one "Name | URL" line each. A JSON
// textarea would be the honest representation of the column and the wrong thing
// to hand somebody adding a Discord link.
function formatCollaboratorLinks(links) {
    if (!Array.isArray(links)) return '';
    return links.map(l => `${(l && l.name) || ''} | ${(l && l.url) || ''}`).join('\n');
}

function parseCollaboratorLinks(text) {
    const links = [];
    const rejected = [];

    for (const line of String(text || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const split = trimmed.indexOf('|');
        const name = split === -1 ? '' : trimmed.slice(0, split).trim();
        const url = split === -1 ? trimmed : trimmed.slice(split + 1).trim();

        // http(s) only. systems/collaborators/index.html builds link.url
        // straight into an href, so a javascript: URL there would be a live
        // script on a public page - and this tool is the first thing that ever
        // let these be typed in, which makes the check this function's job.
        if (!/^https?:\/\//i.test(url)) { rejected.push(trimmed); continue; }
        links.push({ name: name || url, url });
    }

    return { links, rejected };
}

const CREDIT_FIELDS = 'id, name, role, description, avatar, badge_type, is_lead, links, section, sort_order';

async function loadCollaborators() {
    const container = document.getElementById('credits-admin-list');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('site_collaborators').select(CREDIT_FIELDS).order('sort_order');

    if (error) { container.innerHTML = contentNotDeployedMessage(error, 'Credits'); return; }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">Nobody credited yet.</p>`;
        return;
    }

    // Every column the collaborators page actually renders is editable here.
    // The table has carried role, avatar, badge_type, is_lead and links since
    // 20260808000005; this tool only ever read four of them, so the rest could
    // be seen on the site and changed nowhere.
    container.innerHTML = data.map(row => `
        <div class="personnel-row credit-row" data-id="${ownerEscape(row.id)}">
            <div class="personnel-row-main">
                <span class="update-badge ${row.section === 'main' ? 'badge-role-admin' : 'badge-role-contributor'}">${row.section === 'main' ? 'Contributor' : 'Thanks'}</span>
                <span class="personnel-email">${ownerEscape(row.name)}${row.role ? ` <span class="personnel-self">${ownerEscape(row.role)}</span>` : ''}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular credit-edit-btn">EDIT</button>
                <button class="btn-sys btn-sys-red credit-delete-btn" data-id="${ownerEscape(row.id)}">REMOVE</button>
            </div>
            <div class="owner-inline-editor" hidden>
                <label class="block-field-label-sm">NAME</label>
                <input type="text" class="editor-input admin-input-full credit-f-name" value="${ownerEscape(row.name)}">

                <label class="block-field-label-sm">TAG &mdash; the text in the badge</label>
                <input type="text" class="editor-input admin-input-full credit-f-role" value="${ownerEscape(row.role)}" placeholder="Frame Data &amp; Testing">

                <label class="block-field-label-sm">TAG COLOUR</label>
                <select class="editor-input admin-input-full select credit-f-badge">
                    ${Object.entries(CREDIT_BADGES).map(([value, label]) =>
                        `<option value="${ownerEscape(value)}" ${value === (row.badge_type || 'badge-general') ? 'selected' : ''}>${ownerEscape(label)}</option>`
                    ).join('')}
                </select>

                <label class="block-field-label-sm">ICON &mdash; image path or URL</label>
                <input type="text" class="editor-input admin-input-full credit-f-avatar" value="${ownerEscape(row.avatar)}" placeholder="/medias/images/Something.webp">

                <label class="block-field-label-sm">DESCRIPTION</label>
                <textarea class="editor-textarea admin-input-full credit-f-desc" rows="3">${ownerEscape(row.description)}</textarea>

                <label class="block-field-label-sm">LINKS &mdash; one per line, "Name | https://..."</label>
                <textarea class="editor-textarea admin-input-full credit-f-links" rows="3" placeholder="GitHub | https://github.com/someone">${ownerEscape(formatCollaboratorLinks(row.links))}</textarea>

                <label class="block-field-label-sm">SECTION</label>
                <select class="editor-input admin-input-full select credit-f-section">
                    <option value="main" ${row.section === 'main' ? 'selected' : ''}>Contributor card</option>
                    <option value="thanks" ${row.section === 'thanks' ? 'selected' : ''}>Special thanks line</option>
                </select>

                <label class="page-meta-flag">
                    <input type="checkbox" class="credit-f-lead" ${row.is_lead ? 'checked' : ''}>
                    <span>Lead &mdash; shown first, above the others</span>
                </label>

                <div class="owner-inline-editor-actions">
                    <button class="btn-sys btn-sys-green credit-save-btn" data-id="${ownerEscape(row.id)}">SAVE</button>
                    <button class="btn-sys btn-sys-regular credit-cancel-btn">CANCEL</button>
                </div>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.credit-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCollaborator(btn.dataset.id));
    });

    container.querySelectorAll('.credit-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const editor = btn.closest('.credit-row').querySelector('.owner-inline-editor');
            editor.hidden = !editor.hidden;
        });
    });

    // Reloads rather than hiding, so cancelled text cannot sit in a closed box.
    container.querySelectorAll('.credit-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => loadCollaborators());
    });

    container.querySelectorAll('.credit-save-btn').forEach(btn => {
        btn.addEventListener('click', () => saveCollaborator(btn.dataset.id, btn.closest('.credit-row')));
    });
}

async function saveCollaborator(id, row) {
    const results = document.getElementById('credits-results');
    const name = row.querySelector('.credit-f-name').value.trim();

    if (!name) { results.innerHTML = `<span class="admin-error-text">A name cannot be empty.</span>`; return; }

    const { links, rejected } = parseCollaboratorLinks(row.querySelector('.credit-f-links').value);
    if (rejected.length > 0) {
        // Named rather than dropped silently: a link that vanishes on save
        // looks like the save failed.
        results.innerHTML = `<span class="admin-error-text">These need to start with http:// or https:// &mdash; ${ownerEscape(rejected.join(', '))}</span>`;
        return;
    }

    results.innerHTML = 'Saving...';

    const { error } = await window.supabaseClient
        .from('site_collaborators')
        .update({
            name,
            role: row.querySelector('.credit-f-role').value.trim() || null,
            badge_type: row.querySelector('.credit-f-badge').value,
            avatar: row.querySelector('.credit-f-avatar').value.trim() || null,
            description: row.querySelector('.credit-f-desc').value.trim() || null,
            links,
            section: row.querySelector('.credit-f-section').value,
            is_lead: row.querySelector('.credit-f-lead').checked,
        })
        .eq('id', id);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Saved ${ownerEscape(name)}. It reaches the site on the next regeneration.</span>`;
    await loadCollaborators();
}
window.saveCollaborator = saveCollaborator;
window.loadCollaborators = loadCollaborators;

async function addCollaborator() {
    const results = document.getElementById('credits-results');
    const name = document.getElementById('new-credit-name').value.trim();
    const description = document.getElementById('new-credit-desc').value.trim();
    const section = document.getElementById('new-credit-section').value;

    if (!name) { results.innerHTML = `<span class="admin-error-text">Enter a name.</span>`; return; }

    // Same parser and the same http(s) rule as the row editor - a link typed
    // here must not be held to a looser standard than one edited there.
    const { links, rejected } = parseCollaboratorLinks((document.getElementById('new-credit-links') || {}).value);
    if (rejected.length > 0) {
        results.innerHTML = `<span class="admin-error-text">These need to start with http:// or https:// &mdash; ${ownerEscape(rejected.join(', '))}</span>`;
        return;
    }

    const fieldValue = (id) => ((document.getElementById(id) || {}).value || '').trim();

    const { data: last } = await window.supabaseClient
        .from('site_collaborators').select('sort_order').eq('section', section).order('sort_order', { ascending: false }).limit(1);
    const sortOrder = (last && last[0] ? last[0].sort_order : -10) + 10;

    const { error } = await window.supabaseClient
        .from('site_collaborators').insert([{
            name,
            description,
            section,
            sort_order: sortOrder,
            role: fieldValue('new-credit-role') || null,
            badge_type: fieldValue('new-credit-badge') || 'badge-general',
            avatar: fieldValue('new-credit-avatar') || null,
            links,
        }]);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Added ${ownerEscape(name)}.</span>`;
    ['new-credit-name', 'new-credit-desc', 'new-credit-role', 'new-credit-avatar', 'new-credit-links'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    await loadCollaborators();
}
window.addCollaborator = addCollaborator;

async function deleteCollaborator(id) {
    const results = document.getElementById('credits-results');
    if (!(await adminConfirm('Remove this person from the credits?'))) return;

    const { error } = await window.supabaseClient.from('site_collaborators').delete().eq('id', id);
    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Removed.</span>`;
    await loadCollaborators();
}

// --- ACCOUNT DELETION (ANONYMIZE) ---
// Owner-confirmed semantics: the account and email go, past edits stay and
// are re-attributed. See 20260808000004_anonymize_user.sql - a plain delete
// is impossible anyway, because pending_revisions.author_id's foreign key has
// no ON DELETE clause and blocks it.

async function anonymizeAccount() {
    const input = document.getElementById('delete-account-email');
    const results = document.getElementById('delete-account-results');
    const email = input.value.trim();

    if (!email) {
        results.innerHTML = `<span class="admin-error-text">Enter the account's email address.</span>`;
        return;
    }

    // Deliberately spells out what survives. The failure mode to avoid is an
    // admin expecting a full erasure and being surprised later that the
    // contributor's edits are still on the wiki under a placeholder.
    const confirmed = await adminConfirm(
        `Delete the account for ${email}?\n\n` +
        `The account and email are removed permanently. Their past edits stay on the wiki, ` +
        `shown as "Deleted user". This cannot be undone.`
    );
    if (!confirmed) return;

    results.innerHTML = 'Deleting...';

    const { data, error } = await window.supabaseClient.rpc('anonymize_user_by_email', { target_email: email });

    if (error) {
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        results.innerHTML = notDeployed
            ? `<span class="admin-error-text">Account deletion isn't available yet - the database function hasn't been deployed. It arrives with the next migration.</span>`
            : `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">${ownerEscape(data)}</span>`;
    input.value = '';
    await loadPersonnel();
}
window.anonymizeAccount = anonymizeAccount;

// --- MEDIA GARBAGE COLLECTION ---
//
// This tool works by elimination: a file whose name appears nowhere in the
// page data is unused, so it can go. Every hazard here lives in that
// inversion. A reference query that fails, or one that quietly returns only
// its first page, is indistinguishable from "nothing references this file" -
// and the answer it produces is "delete the entire media library". The first
// version of this checked neither case and reported the result in green, as a
// success.
//
// So nothing is deleted except on evidence actually held:
//
//   * every read is error-checked, and a failed read aborts the whole run
//   * every read is paged to exhaustion, so a server-side row cap can never
//     be mistaken for the end of the table
//   * the corpus is sanity-checked before it is trusted - a wiki with live
//     pages cannot legitimately reference nothing
//   * scanning and deleting are separate clicks, and the confirmation names
//     the count
//
// The name matching itself is unchanged, and deliberately errs towards
// keeping files: a short name occurring inside a longer one counts as
// referenced, which wastes storage rather than losing it.

// PostgREST caps rows per request and that cap is a server setting this repo
// does not control, so pages are requested explicitly rather than assuming
// one request returns a whole table.
const GC_PAGE_SIZE = 200;

// A runaway stop. If paging ever stops advancing, this ends the loop with an
// error instead of hanging the browser or scanning against a partial read.
const GC_MAX_ROWS = 50000;

// Past this share of the library a sweep stops looking like cleanup and
// starts looking like a broken scan. Still allowed - a first run can
// legitimately be large - but the confirmation has to say so.
const GC_BULK_SHARE = 0.25;

// What the last scan found. Held so that the click which deletes is never the
// click which decided what to delete, and cleared the moment the bucket may
// have changed underneath it.
let gcOrphans = null;

// Ordered, because an unordered range() is not stable between requests: rows
// can shift between pages, and a reference that slips through the gap becomes
// a file deleted as an orphan. All three tables have an `id`.
async function gcFetchAllRows(table, columns) {
    const rows = [];
    for (let from = 0; from < GC_MAX_ROWS; from += GC_PAGE_SIZE) {
        const { data, error } = await window.supabaseClient
            .from(table)
            .select(columns)
            .order('id', { ascending: true })
            .range(from, from + GC_PAGE_SIZE - 1);

        if (error) throw new Error(`Could not read ${table} - ${error.message}`);
        if (!data) throw new Error(`Could not read ${table} - the request came back with nothing.`);

        rows.push(...data);
        if (data.length < GC_PAGE_SIZE) return rows;
    }
    throw new Error(`${table} returned more rows than this tool will scan at once.`);
}

async function gcListBucket() {
    const files = [];
    for (let offset = 0; offset < GC_MAX_ROWS; offset += GC_PAGE_SIZE) {
        const { data, error } = await window.supabaseClient.storage
            .from('wiki-media')
            .list('', { limit: GC_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });

        if (error) throw new Error(`Could not list the media library - ${error.message}`);
        if (!data) throw new Error('Could not list the media library - the request came back with nothing.');

        files.push(...data);
        if (data.length < GC_PAGE_SIZE) return files;
    }
    throw new Error('The media library holds more files than this tool will scan at once.');
}

// Every form a file name takes in stored JSON - some URLs are saved raw,
// others encoded, depending on which editor wrote them.
function gcNameVariants(name) {
    return [...new Set([
        name,
        encodeURI(name),
        encodeURIComponent(name),
        name.replace(/ /g, '%20'),
    ])];
}

async function gcFindOrphans(report) {
    report('Listing the media library...');
    const files = (await gcListBucket()).filter(f => !f.name.startsWith('.'));
    if (files.length === 0) return { files: [], orphans: [] };

    report(`${files.length} files found. Reading live, pending and history data...`);

    // Cast to text server-side: these are large JSONB columns and the only
    // thing wanted from them is a substring search.
    const [live, pending, history] = await Promise.all([
        gcFetchAllRows('page_data', 'desc_data::text, frame_data::text'),
        gcFetchAllRows('pending_revisions', 'desc_data::text, frame_data::text, delta_payload::text'),
        gcFetchAllRows('page_history', 'desc_data::text, frame_data::text'),
    ]);

    // A wiki with live pages cannot reference nothing. If it reads that way
    // the scan is wrong, not the library - and acting on it would take every
    // file in one click.
    if (live.length === 0) {
        throw new Error('No live page data came back. Refusing to read an empty result as an empty wiki.');
    }

    const chunks = [];
    const collect = (rows, fields) => rows.forEach(row => {
        const text = fields.map(field => row[field] || '').join('');
        if (text) chunks.push(text);
    });
    collect(live, ['desc_data', 'frame_data']);
    collect(pending, ['desc_data', 'frame_data', 'delta_payload']);
    collect(history, ['desc_data', 'frame_data']);

    if (chunks.length === 0) {
        throw new Error('The page data came back empty. Refusing to read that as "nothing is referenced".');
    }

    report(`Checking ${files.length} files against ${chunks.length} records...`);

    // Names drop out of the map as they are found, so nothing is searched for
    // twice and a library that is entirely in use finishes early.
    const unmatched = new Map(files.map(f => [f.name, gcNameVariants(f.name)]));
    for (const chunk of chunks) {
        for (const [name, variants] of unmatched) {
            if (variants.some(variant => chunk.includes(variant))) unmatched.delete(name);
        }
        if (unmatched.size === 0) break;
    }

    return { files, orphans: files.filter(f => unmatched.has(f.name)) };
}

// Single point of truth for "is there anything to delete". Every path that
// invalidates the scan calls this with null, so the delete button cannot
// outlive the list that justified it.
function gcSetOrphans(orphans, bucketSize) {
    gcOrphans = (orphans && orphans.length) ? { files: orphans, bucketSize } : null;

    const purgeBtn = document.getElementById('btn-purge-gc');
    if (!purgeBtn) return;

    purgeBtn.hidden = !gcOrphans;
    if (gcOrphans) {
        purgeBtn.textContent = `DELETE ${orphans.length} UNUSED ${orphans.length === 1 ? 'FILE' : 'FILES'}`;
    }
}

async function runGarbageCollector() {
    const btn = document.getElementById('btn-run-gc');
    const results = document.getElementById('gc-results');

    // Any earlier finding is void the moment a new scan starts.
    gcSetOrphans(null);

    btn.textContent = 'SCANNING...';
    btn.disabled = true;
    results.innerHTML = '';
    const report = (line) => { results.innerHTML += `${ownerEscape(line)}<br>`; };

    try {
        const { files, orphans } = await gcFindOrphans(report);

        if (files.length === 0) {
            results.innerHTML += `<span class="owner-success-text">The media library is empty.</span>`;
        } else if (orphans.length === 0) {
            results.innerHTML += `<span class="owner-success-text">All ${files.length} files are still linked. Nothing to clean up.</span>`;
        } else {
            const list = orphans.map(f => `<li>${ownerEscape(f.name)}</li>`).join('');
            results.innerHTML +=
                `<span class="gc-orphan-count">${orphans.length} of ${files.length} files are unused:</span>` +
                `<ul class="gc-orphan-list">${list}</ul>`;
            gcSetOrphans(orphans, files.length);
        }
    } catch (err) {
        results.innerHTML += `<span class="admin-error-text">Stopped, nothing deleted: ${ownerEscape(err.message)}</span>`;
    }

    btn.textContent = 'SCAN FOR UNUSED MEDIA';
    btn.disabled = false;
}
window.runGarbageCollector = runGarbageCollector;

async function purgeOrphanedMedia() {
    const purgeBtn = document.getElementById('btn-purge-gc');
    const results = document.getElementById('gc-results');

    // The scan's list is the only thing that authorises a deletion. No list,
    // no deletion - including a list already spent on an earlier purge.
    if (!gcOrphans) {
        results.innerHTML += `<span class="admin-error-text">Nothing to delete. Run a scan first.</span>`;
        return;
    }

    const { files, bucketSize } = gcOrphans;
    const share = bucketSize ? files.length / bucketSize : 0;
    const bulkWarning = share > GC_BULK_SHARE
        ? `\n\nThat is ${Math.round(share * 100)}% of the media library (${files.length} of ${bucketSize} files). ` +
          `A scan flagging most of the library is usually a broken scan rather than a dirty library, so check the list first.`
        : '';

    const confirmed = await adminConfirm(
        `Permanently delete ${files.length} unused ${files.length === 1 ? 'file' : 'files'}?\n\n` +
        `No live page, pending revision or history entry links to them. This cannot be undone.` +
        bulkWarning
    );
    if (!confirmed) return;

    purgeBtn.disabled = true;
    purgeBtn.textContent = 'DELETING...';

    const names = files.map(f => f.name);
    const { data, error } = await window.supabaseClient.storage.from('wiki-media').remove(names);

    // Spent either way: after a partial delete the list no longer describes
    // the library, so the next delete has to be earned by a fresh scan.
    gcSetOrphans(null);
    purgeBtn.disabled = false;

    if (error) {
        results.innerHTML += `<span class="admin-error-text">Deletion failed: ${ownerEscape(error.message)}</span>`;
        return;
    }

    // remove() reports what it actually removed, which is not always
    // everything it was handed.
    const removed = Array.isArray(data) ? data.length : names.length;
    results.innerHTML += removed < names.length
        ? `<span class="admin-error-text">Deleted ${removed} of ${names.length} files. Scan again to see what is left.</span>`
        : `<span class="owner-success-text">Deleted ${removed} unused ${removed === 1 ? 'file' : 'files'}.</span>`;
}
window.purgeOrphanedMedia = purgeOrphanedMedia;
