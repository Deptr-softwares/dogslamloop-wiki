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

    if (error || !roles.includes('admin')) { kickUser(); return; }

    // Lets loadPersonnel mark the signed-in admin and enforce the
    // self-demotion guard without a second lookup.
    currentAdminUserId = session.user.id;

    ['new-page-name', 'new-page-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateNewPagePreview);
    });

    // Changing category changes which pages the new one can sit after.
    const categoryEl = document.getElementById('new-page-category');
    if (categoryEl) categoryEl.addEventListener('change', populatePositionOptions);

    await loadPersonnel();
    await loadSitePages();
    await loadPagePermissions();
    await loadFaqEntries();
    await loadCollaborators();
    if (typeof loadStaffPerks === 'function') await loadStaffPerks();
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

    adminCount = data.filter(p => p.role === 'admin').length;

    container.innerHTML = data.map(person => {
        const isSelf = person.user_id === currentAdminUserId;
        // The last admin demoting themselves locks everyone out of this page
        // permanently - the only recovery is direct database access. Blocked
        // in the UI rather than left as a trap.
        const isLastAdmin = person.role === 'admin' && adminCount === 1;
        return `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge badge-role-${ownerEscape(person.role)}">${ownerEscape(ROLE_LABELS[person.role] || person.role)}</span>
                <span class="personnel-email">${ownerEscape(person.email)}${isSelf ? ' <span class="personnel-self">(you)</span>' : ''}</span>
            </div>
            <div class="personnel-row-actions">
                <select class="editor-input personnel-role-select" data-email="${ownerEscape(person.email)}" ${isLastAdmin ? 'disabled' : ''}>
                    ${Object.entries(ROLE_LABELS).map(([value, label]) =>
                        `<option value="${ownerEscape(value)}" ${value === person.role ? 'selected' : ''}>${ownerEscape(label)}</option>`
                    ).join('')}
                    <option value="">Revoke all access</option>
                </select>
                <button class="btn-sys btn-sys-regular personnel-apply-btn"
                        data-email="${ownerEscape(person.email)}"
                        ${isLastAdmin ? 'disabled title="You are the only admin - promote someone else first."' : ''}>APPLY</button>
            </div>
        </div>`;
    }).join('');

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
window.loadPersonnel = loadPersonnel;

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
function derivePageIdentity(name, pageType) {
    const pageId = String(name || '').toLowerCase().trim()
        .replace(/[^\w\s-]/g, '').replace(/[\s-]+/g, '_').replace(/^_|_$/g, '');
    if (!pageId) return null;

    const folder = pageType === 'character'
        ? pageId.charAt(0).toUpperCase() + pageId.slice(1)
        : pageId.replace(/_/g, '-');
    const url = pageType === 'character'
        ? `characters/${folder}/index.html`
        : `systems/${folder}/index.html`;
    const navId = String(name).trim().replace(/\s+/g, '-');
    return { pageId, url, navId };
}
window.derivePageIdentity = derivePageIdentity;

function updateNewPagePreview() {
    const el = document.getElementById('new-page-preview');
    if (!el) return;
    const name = document.getElementById('new-page-name').value;
    const type = document.getElementById('new-page-type').value;
    const identity = derivePageIdentity(name, type);
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
    populatePositionOptions();
}
window.loadSitePages = loadSitePages;

// Kept so the position dropdown and the move buttons can reason about
// neighbours without re-querying on every keystroke.
let cachedSitePages = [];

// Order within a category is sort_order, and the site's character list is
// meaningful rather than alphabetical - it mirrors in-game release order,
// full characters before base-only ones. So a new page frequently belongs in
// the middle, not at the end.
function populatePositionOptions() {
    const select = document.getElementById('new-page-position');
    const category = document.getElementById('new-page-category');
    if (!select || !category) return;

    const siblings = cachedSitePages.filter(p => p.category === category.value);
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
    const category = document.getElementById('new-page-category').value;

    if (!name) {
        results.innerHTML = `<span class="admin-error-text">Give the page a name.</span>`;
        return;
    }

    const identity = derivePageIdentity(name, pageType);
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
        .filter(e => ['character', 'system', 'tierlist'].includes(e.cms_config.pageType))
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

    container.innerHTML = data.map(row => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="personnel-email">${ownerEscape(row.question)}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red faq-delete-btn" data-id="${ownerEscape(row.id)}">DELETE</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.faq-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteFaqEntry(btn.dataset.id));
    });
}
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

async function loadCollaborators() {
    const container = document.getElementById('credits-admin-list');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('site_collaborators').select('id, name, description, section, sort_order').order('sort_order');

    if (error) { container.innerHTML = contentNotDeployedMessage(error, 'Credits'); return; }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">Nobody credited yet.</p>`;
        return;
    }

    container.innerHTML = data.map(row => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge ${row.section === 'main' ? 'badge-role-admin' : 'badge-role-contributor'}">${row.section === 'main' ? 'Contributor' : 'Thanks'}</span>
                <span class="personnel-email">${ownerEscape(row.name)}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red credit-delete-btn" data-id="${ownerEscape(row.id)}">REMOVE</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.credit-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCollaborator(btn.dataset.id));
    });
}
window.loadCollaborators = loadCollaborators;

async function addCollaborator() {
    const results = document.getElementById('credits-results');
    const name = document.getElementById('new-credit-name').value.trim();
    const description = document.getElementById('new-credit-desc').value.trim();
    const section = document.getElementById('new-credit-section').value;

    if (!name) { results.innerHTML = `<span class="admin-error-text">Enter a name.</span>`; return; }

    const { data: last } = await window.supabaseClient
        .from('site_collaborators').select('sort_order').eq('section', section).order('sort_order', { ascending: false }).limit(1);
    const sortOrder = (last && last[0] ? last[0].sort_order : -10) + 10;

    const { error } = await window.supabaseClient
        .from('site_collaborators').insert([{ name, description, section, sort_order: sortOrder }]);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${ownerEscape(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Added ${ownerEscape(name)}.</span>`;
    document.getElementById('new-credit-name').value = '';
    document.getElementById('new-credit-desc').value = '';
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
