/**
 * The owner tools page (owner.html): its gate, and the tools that are not split
 * into owner-*.js files: Personnel (roles, capabilities, account search), the page
 * registry, page restrictions, the FAQ, deleting an account, and media garbage
 * collection.
 * @since v0.4, as part of admin.js
 * @touches user_roles via list_personnel(), search_users(), assign_role_by_email()
 *   and set_user_capability(); site_pages, page_permissions, site_faq,
 *   anonymize_user_by_email(); the wiki-media bucket against page_data,
 *   pending_revisions and page_history; showAccessDenied and rolesMeet
 *   (site_utils.js)
 * @watch the gate is owner only and its own copy, not admin-core.js's: small
 *   duplication over one feature file depending on another. The owner-*.js files
 *   use its contentNotDeployedMessage. Every tool's RPC or RLS checks the caller
 *   itself.
 * @see docs/owner-tools.md
 */

// A page restored from the back-forward cache skips the gate, so it reloads.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});

document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    // One dropped request must not refuse the owner: retry once before the gate decides.
    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { window.showAccessDenied(); return; }

    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('role').eq('user_id', session.user.id));
    }

    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];

    // Owner only: an admin works the review queue and has no owner tools.
    if (error || !window.rolesMeet(roles, 'owner')) { window.showAccessDenied(); return; }

    currentAdminUserId = session.user.id;

    populateDirectoryOptions();

    ['new-page-name', 'new-page-type', 'new-page-directory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateNewPagePreview);
    });

    const typeEl = document.getElementById('new-page-type');
    if (typeEl) {
        typeEl.addEventListener('change', () => {
            populateDirectoryOptions();
            updateNewPagePreview();
            syncCategoryToType();
        });
    }

    wireCategoryField();
    syncCategoryToType();

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
    if (typeof loadStaffPerks === 'function') await loadStaffPerks();
    // Each tool is its own file, and a missing one must not take the page down.
    if (typeof loadPageExperts === 'function') await loadPageExperts();
});

// assign_role_by_email() sets the role: it clears the old one first, since an
// account holds one. An empty choice clears it, sent as NULL.

// 'viewer' is the soft ban, and labelled so it cannot pass for a default.
const ROLE_LABELS = {
    admin: 'Administrator',
    reviewer: 'Reviewer',
    trusted_editor: 'Trusted Editor',
    viewer: 'Viewer (blocked from submitting)',
};

// A capability can stand without a role, so a row may have none.
// Not `roleLabel`: applyRoleChange declares a local const by that name.
function roleLabelFor(role) {
    if (!role) return 'No role';
    return ROLE_LABELS[role] || role;
}

function roleBadgeClass(role) {
    return role ? `badge-role-${window.escapeHtml(role)}` : 'badge-role-none';
}

// The dropdown opens on what the person holds, in the list or not, because APPLY
// applies whatever shows. A role outside ROLE_LABELS is shown, never offered.
function roleOptionsHTML(currentRole) {
    const options = [];

    if (!currentRole) {
        options.push(`<option value="" selected>No role</option>`);
    } else if (!ROLE_LABELS[currentRole]) {
        options.push(`<option value="${window.escapeHtml(currentRole)}" selected>${window.escapeHtml(currentRole)}</option>`);
    }

    for (const [value, label] of Object.entries(ROLE_LABELS)) {
        options.push(
            `<option value="${window.escapeHtml(value)}" ${value === currentRole ? 'selected' : ''}>${window.escapeHtml(label)}</option>`
        );
    }

    // Only for someone with something to lose.
    if (currentRole) options.push(`<option value="">Revoke all access</option>`);

    return options.join('');
}

// Why a capability box is inert, as text: a tooltip is invisible to someone who
// has already clicked.
function capabilityState(person, capability) {
    // Admins moderate by role; a reviewer only by this tick, so their box is live.
    if (capability === 'can_moderate' && window.roleMeets(person.role, 'admin')) {
        return { disabled: true, note: 'comes with the role' };
    }
    if (capability === 'can_delete_media' && window.roleMeets(person.role, 'admin')) {
        return { disabled: true, note: 'comes with the role' };
    }
    if (capability === 'can_upload_media' && window.roleMeets(person.role, 'trusted_editor')) {
        return { disabled: true, note: 'comes with the role' };
    }
    // Left tickable, to set ahead of lifting a ban, but can_upload_media() refuses a
    // viewer, so the row says so. 'viewer' by name: it is a ban, not a rung.
    if (capability === 'can_upload_media' && person.role === 'viewer') {
        return { disabled: false, note: 'no effect while banned' };
    }
    return { disabled: false, note: '' };
}

let currentAdminUserId = null;
let adminCount = 0;

async function loadPersonnel() {
    const container = document.getElementById('personnel-roster');
    if (!container) return;

    container.innerHTML = `<p class="loading-msg loading-msg-busy">Loading roster...</p>`;

    const { data, error } = await window.supabaseClient.rpc('list_personnel');

    if (error) {
        // Normal between deploying the code and the release that applies its
        // migration, and said so.
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">The roster isn't available yet - the <code>list_personnel</code> database function hasn't been deployed. It arrives with the next migration.</p>`
            : `<p class="admin-error-text">Could not load the roster: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No roles assigned yet.</p>`;
        return;
    }

    // Counts owners: the last one demoting themselves would leave nobody able to
    // reach this page.
    adminCount = data.filter(p => p.role === 'owner').length;

    container.innerHTML = data.map(personnelRowHTML).join('');
    bindPersonnelRows(container);
}
window.loadPersonnel = loadPersonnel;

// The roster and the account search share one row, so a found account gets the
// same controls.
function personnelRowHTML(person) {
    {
        const isSelf = person.user_id === currentAdminUserId;
        // The last owner cannot demote themselves: the only way back is the database.
        const isLastAdmin = person.role === 'owner' && adminCount === 1;
        const moderateState = capabilityState(person, 'can_moderate');
        const deleteMediaState = capabilityState(person, 'can_delete_media');
        const uploadMediaState = capabilityState(person, 'can_upload_media');
        return `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge ${roleBadgeClass(person.role)}">${window.escapeHtml(roleLabelFor(person.role))}</span>
                ${person.display_name ? `<span class="personnel-name">${window.escapeHtml(person.display_name)}</span>` : ''}
                <span class="personnel-email">${window.escapeHtml(person.email)}${isSelf ? ' <span class="personnel-self">(you)</span>' : ''}</span>
            </div>
            <div class="personnel-row-actions">
                <select class="editor-input personnel-role-select" data-email="${window.escapeHtml(person.email)}" ${isLastAdmin ? 'disabled' : ''}>
                    ${roleOptionsHTML(person.role)}
                </select>
                <button class="btn-sys btn-sys-regular personnel-apply-btn"
                        data-email="${window.escapeHtml(person.email)}"
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
                       data-email="${window.escapeHtml(person.email)}"
                       data-capability="bypass_cooldown"
                       ${person.bypass_cooldown ? 'checked' : ''}>
                <span>Skip submission cooldown</span>
            </label>
            <!--
                The second capability, following the pattern the first one set.
                Admins can already moderate by virtue of their role, so this
                box is what grants it to everybody else, reviewers included
                (20261116000000): moderating threads and reviewing revisions
                are handed out separately, in both directions.
            -->
            <label class="personnel-capability" title="Lets this person hide or remove discussion posts and handle reports. Admins can already do this.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${window.escapeHtml(person.email)}"
                       data-capability="can_moderate"
                       ${person.can_moderate ? 'checked' : ''}
                       ${moderateState.disabled ? 'disabled' : ''}>
                <span>Moderate discussions${moderateState.note ? ` <span class="personnel-capability-note">(${window.escapeHtml(moderateState.note)})</span>` : ''}</span>
            </label>
            <!--
                Deliberately NOT implied by reviewer, unlike moderation. This
                is the only irreversible action on the site - the file is gone
                from storage - so it is granted one person at a time rather
                than arriving with a role.
            -->
            <label class="personnel-capability" title="Lets this person permanently delete files from the media bucket. Not implied by any role except admin.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${window.escapeHtml(person.email)}"
                       data-capability="can_delete_media"
                       ${person.can_delete_media ? 'checked' : ''}
                       ${deleteMediaState.disabled ? 'disabled' : ''}>
                <span>Delete media${deleteMediaState.note ? ` <span class="personnel-capability-note">(${window.escapeHtml(deleteMediaState.note)})</span>` : ''}</span>
            </label>
            <!--
                v0.20. One permission for both places media is added: the
                Media Library, and images in discussion posts. Trusted Editors
                and up have it by role; this box is how anybody else gets it.
            -->
            <label class="personnel-capability" title="Lets this person upload to the Media Library and attach images to discussion posts. Trusted Editors and up already can.">
                <input type="checkbox" class="personnel-capability-box"
                       data-email="${window.escapeHtml(person.email)}"
                       data-capability="can_upload_media"
                       ${person.can_upload_media ? 'checked' : ''}
                       ${uploadMediaState.disabled ? 'disabled' : ''}>
                <span>Upload media${uploadMediaState.note ? ` <span class="personnel-capability-note">(${window.escapeHtml(uploadMediaState.note)})</span>` : ''}</span>
            </label>
        </div>`;
    }
}

// Delegated, like APPLY: the email must never reach an inline handler.
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
                // Back to what the database holds.
                box.checked = !enabled;
                const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
                results.innerHTML = notDeployed
                    ? `<span class="admin-error-text">Capabilities aren't available yet - the <code>set_user_capability</code> function hasn't been deployed. It arrives with the next migration.</span>`
                    : `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
                return;
            }

            results.innerHTML = `<span class="owner-success-text">${window.escapeHtml(data)}</span>`;
        });
    });

    // Delegated, never an inline onclick built around an email address.
    container.querySelectorAll('.personnel-apply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const select = container.querySelector(`.personnel-role-select[data-email="${CSS.escape(email)}"]`);
            applyRoleChange(email, select ? select.value : '');
        });
    });
}

// Anyone, not only role holders: the roster comes from user_roles. It searches
// the display name too, often the only thing the owner knows.
async function searchAccounts() {
    const input = document.getElementById('account-search');
    const container = document.getElementById('account-search-results');
    if (!input || !container) return;

    const query = input.value.trim();

    // The RPC's own floor, explained rather than silently refused.
    if (query.length < 2) {
        container.innerHTML = `<p class="admin-tool-hint">Type at least two characters of an email address or a display name.</p>`;
        return;
    }

    container.innerHTML = `<p class="loading-msg loading-msg-busy">Searching...</p>`;

    const { data, error } = await window.supabaseClient.rpc('search_users', { search_query: query });

    if (error) {
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">Account search isn't available yet - the <code>search_users</code> database function hasn't been deployed. It arrives with the next migration.</p>`
            : `<p class="admin-error-text">Could not search: ${window.escapeHtml(error.message)}</p>`;
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
        results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">${window.escapeHtml(data)}</span>`;
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

// site_pages is the registry navigation.json is generated from: a new page is an
// insert, and regeneration makes its nav entry and stub. Archiving is the
// default: an archived page keeps a stub, so old links and Discord embeds resolve.

const STATUS_LABELS = { live: 'Live', draft: 'Draft', archived: 'Archived' };

// Where a page lives, kept apart from how it renders: others/ and tools/ hold
// pages that render as system pages. A folder lists the types it can hold, the
// first the default. It matches buildPageUrl (site_utils.js) and the generator.
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

    const dir = PAGE_DIRECTORIES[directory]
        ? directory
        : (Object.keys(PAGE_DIRECTORIES).find(d => PAGE_DIRECTORIES[d].pageTypes.includes(pageType)) || 'systems');

    // Character folders are Capitalised_like_this, the rest kebab-case.
    const folder = dir === 'characters'
        ? pageId.charAt(0).toUpperCase() + pageId.slice(1)
        : pageId.replace(/_/g, '-');
    const url = `${dir}/${folder}/index.html`;
    const navId = String(name).trim().replace(/\s+/g, '-');
    return { pageId, url, navId, directory: dir };
}
window.derivePageIdentity = derivePageIdentity;

// Keeps the folder suited to the page type, and leaves an explicit choice that
// still suits it.
function populateDirectoryOptions() {
    const select = document.getElementById('new-page-directory');
    const typeEl = document.getElementById('new-page-type');
    if (!select || !typeEl) return;

    const pageType = typeEl.value;
    const current = select.value;

    select.innerHTML = Object.entries(PAGE_DIRECTORIES)
        .map(([dir, meta]) => `<option value="${window.escapeHtml(dir)}">${window.escapeHtml(meta.label)}</option>`)
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
        ? `Will be created at <code>${window.escapeHtml(identity.url)}</code>`
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
            : `<p class="admin-error-text">Could not load pages: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No pages registered.</p>`;
        return;
    }

    // Grouped by category in <details>, collapsed, so the browser handles the
    // keyboard and find-in-page. The move and archive buttons are bound by class.
    const groups = new Map();
    for (const page of data) {
        const key = page.category || 'Uncategorised';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(page);
    }

    container.innerHTML = [...groups.entries()].map(([category, pages]) => `
        <details class="page-group" data-category="${window.escapeHtml(category)}">
            <summary class="page-group-summary">
                <span class="page-group-name">${window.escapeHtml(category)}</span>
                <span class="page-group-count">${pages.length}</span>
            </summary>
            ${pages.map(page => `
                <div class="personnel-row page-row"
                     data-search="${window.escapeHtml(`${page.name} ${page.url} ${category}`.toLowerCase())}">
                    <div class="personnel-row-main">
                        <span class="update-badge badge-status-${window.escapeHtml(page.status)}">${window.escapeHtml(STATUS_LABELS[page.status] || page.status)}</span>
                        <span class="personnel-email">${window.escapeHtml(page.name)}</span>
                        <span class="page-row-path">${window.escapeHtml(page.url)}</span>
                    </div>
                    <div class="personnel-row-actions">
                        <button class="btn-sys btn-sys-regular page-move-btn" data-page="${window.escapeHtml(page.page_id)}" data-dir="up" title="Move up">▲</button>
                        <button class="btn-sys btn-sys-regular page-move-btn" data-page="${window.escapeHtml(page.page_id)}" data-dir="down" title="Move down">▼</button>
                        ${page.status === 'archived'
                            ? `<button class="btn-sys btn-sys-green page-restore-btn" data-page="${window.escapeHtml(page.page_id)}">RESTORE</button>`
                            : `<button class="btn-sys btn-sys-yellow page-archive-btn" data-page="${window.escapeHtml(page.page_id)}">ARCHIVE</button>`}
                    </div>
                </div>
            `).join('')}
        </details>
    `).join('');

    // The filter survives a reload after an archive or a move.
    filterSitePages();

    container.querySelectorAll('.page-archive-btn').forEach(btn => {
        btn.addEventListener('click', () => setPageStatus(btn.dataset.page, 'archived'));
    });
    container.querySelectorAll('.page-restore-btn').forEach(btn => {
        btn.addEventListener('click', () => setPageStatus(btn.dataset.page, 'live'));
    });
    container.querySelectorAll('.page-move-btn').forEach(btn => {
        btn.addEventListener('click', () => movePage(btn.dataset.page, btn.dataset.dir));
    });

    const filter = document.getElementById('pages-filter');
    // Bound once: loadSitePages runs again after every archive and move.
    if (filter && !filter.dataset.bound) {
        filter.dataset.bound = '1';
        filter.addEventListener('input', filterSitePages);
    }

    cachedSitePages = data;
    // Both read knownCategories(), from the cache set on the line above.
    populateCategoryOptions();
    populatePositionOptions();
    updateCategoryNote();
}

// Across name, url and category, opening a group with a match and hiding one
// without, so an empty result does not look like a list of categories.
function filterSitePages() {
    const filter = document.getElementById('pages-filter');
    const container = document.getElementById('pages-list');
    if (!container) return;

    const needle = ((filter && filter.value) || '').trim().toLowerCase();

    container.querySelectorAll('.page-group').forEach(group => {
        let matches = 0;

        group.querySelectorAll('.page-row').forEach(row => {
            const hit = !needle || (row.dataset.search || '').includes(needle);
            row.hidden = !hit;
            if (hit) matches += 1;
        });

        group.hidden = matches === 0;
        // Open only while filtering.
        group.open = needle.length > 0 && matches > 0;
    });
}
window.filterSitePages = filterSitePages;
window.loadSitePages = loadSitePages;

let cachedSitePages = [];

// Order within a category is sort_order, and the character list follows in-game
// release order, so a new page often goes in the middle. The category is free
// text with a datalist, and navigation.json is keyed by it verbatim, so
// existing spellings are offered first.
function knownCategories() {
    return [...new Set(cachedSitePages.map(p => p.category).filter(Boolean))].sort();
}

function populateCategoryOptions() {
    const list = document.getElementById('page-category-options');
    if (!list) return;
    list.innerHTML = knownCategories()
        .map(c => `<option value="${window.escapeHtml(c)}"></option>`).join('');
}

// Trims, and adopts an existing category's spelling when it matches ignoring
// case, so a new category is made only on purpose.
function canonicaliseCategory(raw) {
    const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    const match = knownCategories().find(c => c.toLowerCase() === trimmed.toLowerCase());
    return match || trimmed;
}

// A character page's category is always 'Characters': the roster, the systems
// directory and the sidebar's colours all read that key by name.
const CHARACTER_CATEGORY = 'Characters';

function categoryIsForced() {
    const typeEl = document.getElementById('new-page-type');
    return !!typeEl && typeEl.value === 'character';
}

// Pinned for a character page; switching away restores what was typed.
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

// Says when the typed value will make a new sidebar group.
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

// 'input', not 'change': a text field with a datalist reacts to typing. Named, so
// a rebuilt form can be wired again.
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
        + siblings.map(p => `<option value="${window.escapeHtml(p.page_id)}">After: ${window.escapeHtml(p.name)}</option>`).join('');

    if (current && siblings.some(p => p.page_id === current)) select.value = current;
}

/**
 * The sort_order for a page inserted after afterPageId. Spaced by 10; when two
 * neighbours have no gap left, the category is renumbered first rather than
 * given a fractional or duplicate value.
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

// Swaps a page with its neighbour.
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
        results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml((errA || errB).message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">Moved "${window.escapeHtml(page.name)}". Menus update after the next regeneration run.</span>`;
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
        results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${window.escapeHtml(pageId)}" is now ${window.escapeHtml(STATUS_LABELS[status])}. It updates on the site after the next regeneration run.</span>`;
    await loadSitePages();
}

async function createSitePage() {
    const results = document.getElementById('pages-results');
    const name = document.getElementById('new-page-name').value.trim();
    const pageType = document.getElementById('new-page-type').value;
    // Forced for a character page: the locked field is a courtesy, and this is the
    // value the database gets.
    const category = pageType === 'character'
        ? CHARACTER_CATEGORY
        : canonicaliseCategory(document.getElementById('new-page-category').value);

    if (!name) {
        results.innerHTML = `<span class="admin-error-text">Give the page a name.</span>`;
        return;
    }

    // An empty category would key navigation.json on "".
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
        // A new page is a work in progress, so it gets the WIP badge.
        is_wip: true,
    }]);

    if (error) {
        const duplicate = /duplicate key|unique/i.test(error.message || '');
        results.innerHTML = `<span class="admin-error-text">${duplicate
            ? `A page already exists at that address (${window.escapeHtml(identity.url)}). Pick a different name.`
            : `Error: ${window.escapeHtml(error.message)}`}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">Created "${window.escapeHtml(name)}". It appears on the site after the next regeneration run.</span>`;
    document.getElementById('new-page-name').value = '';
    updateNewPagePreview();
    await loadSitePages();
}
window.createSitePage = createSitePage;

// Page restrictions: page_permissions, whose required_role decides who may submit.

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
        container.innerHTML = `<p class="admin-error-text">Could not load restrictions: ${window.escapeHtml(error.message)}</p>`;
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
                <span class="update-badge badge-role-${window.escapeHtml(row.required_role)}">${window.escapeHtml(PERMISSION_ROLE_LABELS[row.required_role] || row.required_role)}</span>
                <span class="personnel-email">${window.escapeHtml(row.page_id)}</span>
            </div>
            <div class="personnel-row-actions">
                <select class="editor-input personnel-role-select" data-page="${window.escapeHtml(row.page_id)}">
                    ${Object.entries(PERMISSION_ROLE_LABELS).map(([value, label]) =>
                        `<option value="${window.escapeHtml(value)}" ${value === row.required_role ? 'selected' : ''}>${window.escapeHtml(label)}</option>`
                    ).join('')}
                </select>
                <button class="btn-sys btn-sys-regular permission-apply-btn" data-page="${window.escapeHtml(row.page_id)}">APPLY</button>
                <button class="btn-sys btn-sys-red permission-remove-btn" data-page="${window.escapeHtml(row.page_id)}">UNRESTRICT</button>
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

// Only pages that exist and are not restricted yet, so a mistyped id cannot lock
// a page nobody can find.
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
        // Every page type with an editor behind it. A hub is hand-written and an
        // external entry is a link.
        .filter(e => ['character', 'system', 'tierlist', 'gallery', 'tool'].includes(e.cms_config.pageType))
        .sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML = options.length === 0
        ? `<option value="">(every page is already restricted)</option>`
        : options.map(e => `<option value="${window.escapeHtml(e.cms_config.pageId)}">${window.escapeHtml(e.name)}</option>`).join('');
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
        results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${window.escapeHtml(pageId)}" now requires ${window.escapeHtml(label)}.</span>`;
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
        results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
        return;
    }
    results.innerHTML = `<span class="owner-success-text">"${window.escapeHtml(pageId)}" is no longer restricted.</span>`;
    await loadPagePermissions();
}

// The FAQ: site_faq, written out to data/faq.json by regeneration.

function contentNotDeployedMessage(error, what) {
    const notDeployed = error.code === 'PGRST205' || /schema cache/i.test(error.message || '');
    // The same situation for an RPC (PGRST202). The 205 sentence is asserted
    // elsewhere, so it stays.
    if (error.code === 'PGRST202') {
        return `<p class="admin-error-text">${what} isn't available yet - the database function it needs hasn't been deployed. It arrives with the next migration.</p>`;
    }
    return notDeployed
        ? `<p class="admin-error-text">${what} editing isn't available yet - its table hasn't been deployed. It arrives with the next migration.</p>`
        : `<p class="admin-error-text">Could not load: ${window.escapeHtml(error.message)}</p>`;
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

    // Edited in place, so an answer is seen in the shape it was written.
    container.innerHTML = data.map(row => `
        <div class="personnel-row faq-row" data-id="${window.escapeHtml(row.id)}">
            <div class="personnel-row-main">
                <span class="personnel-email">${window.escapeHtml(row.question)}</span>
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular faq-edit-btn" data-id="${window.escapeHtml(row.id)}">EDIT</button>
                <button class="btn-sys btn-sys-red faq-delete-btn" data-id="${window.escapeHtml(row.id)}">DELETE</button>
            </div>
            <div class="owner-inline-editor" hidden>
                <label class="block-field-label-sm">QUESTION</label>
                <input type="text" class="editor-input admin-input-full faq-edit-question" value="${window.escapeHtml(row.question)}">
                <label class="block-field-label-sm">ANSWER</label>
                <textarea class="editor-textarea admin-input-full faq-edit-answer" rows="5">${window.escapeHtml((row.paragraphs || []).join('\n\n'))}</textarea>
                <p class="admin-tool-hint">A blank line starts a new paragraph.</p>
                <div class="owner-inline-editor-actions">
                    <button class="btn-sys btn-sys-green faq-save-btn" data-id="${window.escapeHtml(row.id)}">SAVE</button>
                    <button class="btn-sys btn-sys-regular faq-cancel-btn">CANCEL</button>
                </div>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.faq-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteFaqEntry(btn.dataset.id));
    });

    // hidden, not style.display, so a later display rule cannot win.
    container.querySelectorAll('.faq-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const editor = btn.closest('.faq-row').querySelector('.owner-inline-editor');
            editor.hidden = !editor.hidden;
        });
    });

    container.querySelectorAll('.faq-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Reloaded, so a cancelled edit leaves no text in a closed box.
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

// The same paragraph rule and validation as addFaqEntry: an empty answer is
// refused.
async function saveFaqEntry(id, question, answer) {
    const results = document.getElementById('faq-results');
    const trimmed = question.trim();

    if (!trimmed) { results.innerHTML = `<span class="admin-error-text">A question cannot be empty.</span>`; return; }

    const paragraphs = answer.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) { results.innerHTML = `<span class="admin-error-text">An answer cannot be empty.</span>`; return; }

    results.innerHTML = 'Saving...';

    const { error } = await window.supabaseClient
        .from('site_faq').update({ question: trimmed, paragraphs }).eq('id', id);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`; return; }

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

    // Blank lines split paragraphs: one <p> per entry.
    const paragraphs = answer.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) { results.innerHTML = `<span class="admin-error-text">Enter an answer.</span>`; return; }

    const { data: last } = await window.supabaseClient
        .from('site_faq').select('sort_order').order('sort_order', { ascending: false }).limit(1);
    const sortOrder = (last && last[0] ? last[0].sort_order : -10) + 10;

    const { error } = await window.supabaseClient
        .from('site_faq').insert([{ question, paragraphs, sort_order: sortOrder }]);

    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`; return; }

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
    if (error) { results.innerHTML = `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`; return; }

    results.innerHTML = `<span class="owner-success-text">Deleted.</span>`;
    await loadFaqEntries();
}

// Deleting an account anonymizes it: the account and email go, past edits stay,
// re-attributed. A plain delete is blocked by pending_revisions' foreign key.

async function anonymizeAccount() {
    const input = document.getElementById('delete-account-email');
    const results = document.getElementById('delete-account-results');
    const email = input.value.trim();

    if (!email) {
        results.innerHTML = `<span class="admin-error-text">Enter the account's email address.</span>`;
        return;
    }

    // Says what survives, so nobody expects a full erasure.
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
            : `<span class="admin-error-text">Error: ${window.escapeHtml(error.message)}</span>`;
        return;
    }

    results.innerHTML = `<span class="owner-success-text">${window.escapeHtml(data)}</span>`;
    input.value = '';
    await loadPersonnel();
}
window.anonymizeAccount = anonymizeAccount;

// Media garbage collection works by elimination: a file named nowhere in the
// page data goes. A failed or short read looks the same as "nothing uses this",
// which would delete the library. So every read is checked and paged to the end,
// an empty corpus is refused, and scanning and deleting are separate clicks.
// Matching errs towards keeping: a name inside a longer one counts as used.

// PostgREST caps rows per request, a server setting, so pages are explicit.
const GC_PAGE_SIZE = 200;

// A runaway stop, so a read that stops advancing fails instead of hanging.
const GC_MAX_ROWS = 50000;

// Past this share of the library a sweep looks like a broken scan, and the
// confirmation says so.
const GC_BULK_SHARE = 0.25;

// What the last scan found, so the click that deletes is never the click that
// decided; cleared whenever the bucket may have changed.
let gcOrphans = null;

// Ordered: an unordered range() can shift between pages, and a reference that
// slips through becomes a deleted file.
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

// Every form a name takes in stored JSON, raw or encoded.
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

    // Cast to text in SQL: only a substring search is wanted.
    const [live, pending, history] = await Promise.all([
        gcFetchAllRows('page_data', 'desc_data::text, frame_data::text'),
        gcFetchAllRows('pending_revisions', 'desc_data::text, frame_data::text, delta_payload::text'),
        gcFetchAllRows('page_history', 'desc_data::text, frame_data::text'),
    ]);

    // A wiki with live pages cannot reference nothing: the scan is wrong, not the
    // library.
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

    const unmatched = new Map(files.map(f => [f.name, gcNameVariants(f.name)]));
    for (const chunk of chunks) {
        for (const [name, variants] of unmatched) {
            if (variants.some(variant => chunk.includes(variant))) unmatched.delete(name);
        }
        if (unmatched.size === 0) break;
    }

    return { files, orphans: files.filter(f => unmatched.has(f.name)) };
}

// The one place that says whether there is anything to delete, so the button
// cannot outlive its list.
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

    gcSetOrphans(null);

    btn.textContent = 'SCANNING...';
    btn.disabled = true;
    results.innerHTML = '';
    const report = (line) => { results.innerHTML += `${window.escapeHtml(line)}<br>`; };

    try {
        const { files, orphans } = await gcFindOrphans(report);

        if (files.length === 0) {
            results.innerHTML += `<span class="owner-success-text">The media library is empty.</span>`;
        } else if (orphans.length === 0) {
            results.innerHTML += `<span class="owner-success-text">All ${files.length} files are still linked. Nothing to clean up.</span>`;
        } else {
            const list = orphans.map(f => `<li>${window.escapeHtml(f.name)}</li>`).join('');
            results.innerHTML +=
                `<span class="gc-orphan-count">${orphans.length} of ${files.length} files are unused:</span>` +
                `<ul class="gc-orphan-list">${list}</ul>`;
            gcSetOrphans(orphans, files.length);
        }
    } catch (err) {
        results.innerHTML += `<span class="admin-error-text">Stopped, nothing deleted: ${window.escapeHtml(err.message)}</span>`;
    }

    btn.textContent = 'SCAN FOR UNUSED MEDIA';
    btn.disabled = false;
}
window.runGarbageCollector = runGarbageCollector;

async function purgeOrphanedMedia() {
    const purgeBtn = document.getElementById('btn-purge-gc');
    const results = document.getElementById('gc-results');

    // No list, no deletion, including a list already spent.
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

    // Spent either way: after a partial delete the list no longer describes the
    // library.
    gcSetOrphans(null);
    purgeBtn.disabled = false;

    if (error) {
        results.innerHTML += `<span class="admin-error-text">Deletion failed: ${window.escapeHtml(error.message)}</span>`;
        return;
    }

    // remove() reports what it removed, not always all it was given.
    const removed = Array.isArray(data) ? data.length : names.length;
    results.innerHTML += removed < names.length
        ? `<span class="admin-error-text">Deleted ${removed} of ${names.length} files. Scan again to see what is left.</span>`
        : `<span class="owner-success-text">Deleted ${removed} unused ${removed === 1 ? 'file' : 'files'}.</span>`;
}
window.purgeOrphanedMedia = purgeOrphanedMedia;
