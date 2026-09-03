/**
 * Dogslamloop Wiki - Owner Tools: Page Experts (v0.17 F5)
 *
 * Split from owner.js like the other owner-*.js modules, and depends on it for
 * ownerEscape and contentNotDeployedMessage.
 *
 * WHY THIS IS AN OWNER TOOL AND NOT AN ADMIN ONE
 *
 * The owner's rule (2026-08-27): which page a tool lives on decides who owns
 * it, not how much damage it can do. Personnel and capabilities are owner
 * tools, and granting somebody review rights over a page is a personnel
 * decision rather than a queue action - so it lives here, and
 * assign_page_expert() refuses anybody who is not the owner regardless of what
 * this page draws.
 *
 * BY EMAIL, LIKE PERSONNEL
 *
 * An expert may hold no role at all - that is the entire point of the feature,
 * and the reason page_experts is a table rather than a column on user_roles,
 * which is NOT NULL on role. So they appear in no roster, and an email address
 * is the only handle the owner has for them.
 */

// The page list comes from site_pages, which is what data/navigation.json is
// generated from. Read here rather than from the JSON so a page the owner
// created a minute ago is offerable immediately.
let expertPageList = [];

async function loadPageExperts() {
    const container = document.getElementById('page-experts-roster');
    if (!container) return;

    container.innerHTML = `<p class="loading-msg">Loading experts...</p>`;

    await loadExpertPageOptions();

    const { data, error } = await window.supabaseClient.rpc('list_page_experts');

    if (error) {
        // PGRST202 / schema cache means "this migration has not been applied
        // yet", which is the normal state between deploying the code and the
        // release. Raw PostgREST text reads like a crash.
        container.innerHTML = contentNotDeployedMessage(error, 'Expert roster');
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">Nobody is an expert of any page yet.</p>`;
        return;
    }

    // Grouped by page, because the question the owner asks is "who covers
    // Boomcat", not "what does this person cover".
    const byPage = {};
    data.forEach(row => {
        (byPage[row.page_id] = byPage[row.page_id] || []).push(row);
    });

    container.innerHTML = Object.keys(byPage).sort().map(pageId => `
        <div class="expert-group">
            <h4 class="expert-group-title">${ownerEscape(pageId.replace(/_/g, ' '))}</h4>
            ${byPage[pageId].map(row => `
                <div class="personnel-row">
                    <div class="personnel-row-main">
                        <span class="personnel-email">${ownerEscape(row.email)}</span>
                    </div>
                    <div class="personnel-row-actions">
                        <button class="btn-sys btn-sys-red expert-revoke-btn"
                                data-email="${ownerEscape(row.email)}"
                                data-page="${ownerEscape(row.page_id)}">REVOKE</button>
                    </div>
                </div>`).join('')}
        </div>`).join('');

    // Delegated by data- attribute, never an inline onclick built around an
    // email address. Contributor-supplied values in an onclick is the habit
    // this codebase does not keep.
    container.querySelectorAll('.expert-revoke-btn').forEach(btn => {
        btn.addEventListener('click', () => revokePageExpert(btn.dataset.email, btn.dataset.page));
    });
}

async function loadExpertPageOptions() {
    const select = document.getElementById('expert-page');
    if (!select || expertPageList.length) return;

    const { data, error } = await window.supabaseClient
        .from('site_pages').select('page_id, name, category').order('category').order('name');

    if (error || !data) return;
    expertPageList = data;

    select.innerHTML = '';
    data.forEach(page => {
        const opt = document.createElement('option');
        opt.value = page.page_id;
        // textContent: a page name is owner-authored but still database content.
        opt.textContent = page.category ? `${page.category} — ${page.name}` : page.name;
        select.appendChild(opt);
    });
}

async function grantPageExpert() {
    const email = (document.getElementById('expert-email').value || '').trim();
    const pageId = document.getElementById('expert-page').value;
    const results = document.getElementById('page-experts-results');
    if (!results) return;

    if (!email) { results.innerHTML = `<p class="admin-error-text">Enter an email address.</p>`; return; }
    if (!pageId) { results.innerHTML = `<p class="admin-error-text">Pick a page.</p>`; return; }

    results.innerHTML = `<p class="loading-msg">Granting...</p>`;

    const { data, error } = await window.supabaseClient
        .rpc('assign_page_expert', { target_email: email, target_page_id: pageId });

    if (error) {
        results.innerHTML = contentNotDeployedMessage(error, 'Expert assignment');
        return;
    }

    // The RPC returns a sentence rather than throwing for "no such user" - the
    // owner mistyping an address is not an exception. It still starts with
    // "Error:" in that case, so colour by the answer rather than assuming.
    const failed = String(data || '').startsWith('Error:');
    results.innerHTML = `<p class="${failed ? 'admin-error-text' : 'owner-success-text'}">${ownerEscape(data)}</p>`;

    if (!failed) {
        document.getElementById('expert-email').value = '';
        await loadPageExperts();
    }
}

async function revokePageExpert(email, pageId) {
    const results = document.getElementById('page-experts-results');
    if (!results) return;

    // adminConfirm is reimplemented in owner.js rather than imported from
    // admin-core.js, per this project's preference for small duplication over
    // cross-file coupling.
    const ok = await adminConfirm(`Remove ${email} as an expert of ${pageId.replace(/_/g, ' ')}?`);
    if (!ok) return;

    results.innerHTML = `<p class="loading-msg">Revoking...</p>`;

    const { data, error } = await window.supabaseClient
        .rpc('revoke_page_expert', { target_email: email, target_page_id: pageId });

    if (error) {
        results.innerHTML = contentNotDeployedMessage(error, 'Expert revocation');
        return;
    }

    results.innerHTML = `<p class="owner-success-text">${ownerEscape(data)}</p>`;
    await loadPageExperts();
}
