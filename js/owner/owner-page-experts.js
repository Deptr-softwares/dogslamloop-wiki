/**
 * Page Experts: who reviews which page, granted by email, listed by page.
 * @since v0.17
 * @touches list_page_experts(), assign_page_expert(), revoke_page_expert(),
 *   site_pages, contentNotDeployedMessage (owner.js)
 * @watch assign_page_expert() refuses anyone but the owner, whatever this page
 *   draws. An expert may hold no role, so appears on no roster: an email is the
 *   only handle.
 * @see docs/owner-tools.md
 */

// From site_pages, not navigation.json, so a page made a minute ago is offered.
let expertPageList = [];

async function loadPageExperts() {
    const container = document.getElementById('page-experts-roster');
    if (!container) return;

    container.innerHTML = `<p class="loading-msg loading-msg-busy">Loading experts...</p>`;

    await loadExpertPageOptions();

    const { data, error } = await window.supabaseClient.rpc('list_page_experts');

    if (error) {
        container.innerHTML = contentNotDeployedMessage(error, 'Expert roster');
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">Nobody is an expert of any page yet.</p>`;
        return;
    }

    // By page: the question is "who covers Boomcat".
    const byPage = {};
    data.forEach(row => {
        (byPage[row.page_id] = byPage[row.page_id] || []).push(row);
    });

    container.innerHTML = Object.keys(byPage).sort().map(pageId => `
        <div class="expert-group">
            <h4 class="expert-group-title">${window.escapeHtml(pageId.replace(/_/g, ' '))}</h4>
            ${byPage[pageId].map(row => `
                <div class="personnel-row">
                    <div class="personnel-row-main">
                        <span class="personnel-email">${window.escapeHtml(row.email)}</span>
                    </div>
                    <div class="personnel-row-actions">
                        <button class="btn-sys btn-sys-red expert-revoke-btn"
                                data-email="${window.escapeHtml(row.email)}"
                                data-page="${window.escapeHtml(row.page_id)}">REVOKE</button>
                    </div>
                </div>`).join('')}
        </div>`).join('');

    // Delegated by data- attribute, never an inline onclick built around an email.
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

    results.innerHTML = `<p class="loading-msg loading-msg-busy">Granting...</p>`;

    const { data, error } = await window.supabaseClient
        .rpc('assign_page_expert', { target_email: email, target_page_id: pageId });

    if (error) {
        results.innerHTML = contentNotDeployedMessage(error, 'Expert assignment');
        return;
    }

    // "No such user" comes back as a sentence starting "Error:", not a throw.
    const failed = String(data || '').startsWith('Error:');
    results.innerHTML = `<p class="${failed ? 'admin-error-text' : 'owner-success-text'}">${window.escapeHtml(data)}</p>`;

    if (!failed) {
        document.getElementById('expert-email').value = '';
        await loadPageExperts();
    }
}

async function revokePageExpert(email, pageId) {
    const results = document.getElementById('page-experts-results');
    if (!results) return;

    const ok = await adminConfirm(`Remove ${email} as an expert of ${pageId.replace(/_/g, ' ')}?`);
    if (!ok) return;

    results.innerHTML = `<p class="loading-msg loading-msg-busy">Revoking...</p>`;

    const { data, error } = await window.supabaseClient
        .rpc('revoke_page_expert', { target_email: email, target_page_id: pageId });

    if (error) {
        results.innerHTML = contentNotDeployedMessage(error, 'Expert revocation');
        return;
    }

    results.innerHTML = `<p class="owner-success-text">${window.escapeHtml(data)}</p>`;
    await loadPageExperts();
}
