/**
 * Site Metadata and Game Info: the version and tagline, each hub dashboard's
 * title, description and headings, and the Game Info panel, all on the site_meta
 * row.
 * @since v0.11
 * @touches site_meta (to data/site_meta.json), contentNotDeployedMessage (owner.js),
 *   scripts/generate-hub-meta.js
 * @watch a hub's title and description reach the page only after a regeneration
 *   run: they are baked into its <head>, since link unfurlers run no JavaScript.
 *   The rest is read at runtime.
 * @see docs/owner-tools.md
 */

// Held between load and save: one row holds all three hubs, so saving sends the
// other two back unchanged.
let siteMetaRow = null;

async function loadSiteMeta() {
    const results = document.getElementById('site-meta-results');
    if (!results) return;

    const { data, error } = await window.supabaseClient
        .from('site_meta').select('*').limit(1).maybeSingle();

    // Gone if owner.js sent the visitor to ACCESS DENIED during the read.
    if (!results.isConnected) return;
    if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Site metadata'); return; }
    if (!data) { results.innerHTML = '<p class="admin-error-text">No site_meta row exists yet.</p>'; return; }

    siteMetaRow = data;
    results.innerHTML = '';

    document.getElementById('meta-version').value = data.version || '';
    document.getElementById('meta-tagline').value = data.tagline || '';

    renderHubMetaFields();
    renderGameInfoAdmin();
}

function currentHubId() {
    const select = document.getElementById('meta-hub-select');
    return select ? select.value : 'main-hub';
}

function renderHubMetaFields() {
    if (!siteMetaRow) return;
    const hub = (siteMetaRow.hubs || {})[currentHubId()] || {};

    document.getElementById('meta-hub-title').value = hub.title || '';
    document.getElementById('meta-hub-description').value = hub.description || '';

    const container = document.getElementById('meta-hub-headings');
    const headings = hub.headings || {};
    const keys = Object.keys(headings).sort();

    if (keys.length === 0) {
        container.innerHTML = '<p class="loading-msg">This dashboard has no editable headings.</p>';
        return;
    }

    // The key is shown, not editable: it must match a data-heading-key in the page.
    container.innerHTML = keys.map(key => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="personnel-email">${window.escapeHtml(key)}</span>
            </div>
            <div class="personnel-row-actions">
                <input type="text" class="editor-input meta-heading-input"
                       data-heading-key="${window.escapeHtml(key)}" value="${window.escapeHtml(headings[key])}">
            </div>
        </div>
    `).join('');
}

async function saveSiteMeta() {
    const btn = document.getElementById('btn-save-site-meta');
    const results = document.getElementById('site-meta-results');
    if (!siteMetaRow) {
        results.innerHTML = '<p class="admin-error-text">Load the metadata first.</p>';
        return;
    }

    const hubId = currentHubId();
    const hubs = JSON.parse(JSON.stringify(siteMetaRow.hubs || {}));
    const hub = hubs[hubId] || (hubs[hubId] = {});

    hub.title = document.getElementById('meta-hub-title').value.trim();
    hub.description = document.getElementById('meta-hub-description').value.trim();

    const headings = {};
    document.querySelectorAll('.meta-heading-input').forEach(input => {
        headings[input.dataset.headingKey] = input.value;
    });
    if (Object.keys(headings).length > 0) hub.headings = headings;

    btn.disabled = true;
    const { error } = await window.supabaseClient.from('site_meta').update({
        version: document.getElementById('meta-version').value.trim(),
        tagline: document.getElementById('meta-tagline').value.trim(),
        hubs,
        updated_at: new Date().toISOString(),
    }).eq('id', true);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    siteMetaRow.hubs = hubs;
    results.innerHTML = '<span class="owner-success-text">Saved. Headings are live now; titles, descriptions, the version and the tagline appear after the next regeneration run.</span>';
}

function gameInfo() {
    const info = (siteMetaRow && siteMetaRow.game_info) || {};
    return {
        title: info.title || '',
        linksLabel: info.linksLabel || 'Official Links',
        fields: Array.isArray(info.fields) ? info.fields : [],
        links: Array.isArray(info.links) ? info.links : [],
    };
}

function renderGameInfoAdmin() {
    const info = gameInfo();

    document.getElementById('game-info-fields-admin').innerHTML = info.fields.map((field, i) => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <input type="text" class="editor-input gi-field-label" data-i="${i}" value="${window.escapeHtml(field.label)}" placeholder="Label">
                <input type="text" class="editor-input gi-field-value" data-i="${i}" value="${window.escapeHtml(field.value)}" placeholder="Value">
                <input type="text" class="editor-input gi-field-subtext" data-i="${i}" value="${window.escapeHtml(field.subtext || '')}" placeholder="Subtext (optional)">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red gi-field-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('') || '<p class="loading-msg">No facts yet.</p>';

    document.getElementById('game-info-links-admin').innerHTML = info.links.map((link, i) => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <input type="text" class="editor-input gi-link-name" data-i="${i}" value="${window.escapeHtml(link.name)}" placeholder="Official Discord">
                <input type="text" class="editor-input gi-link-url" data-i="${i}" value="${window.escapeHtml(link.url)}" placeholder="https://discord.gg/...">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red gi-link-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('') || '<p class="loading-msg">No links yet.</p>';

    // Reads the inputs first, so deleting one row keeps text typed into the others.
    document.querySelectorAll('.gi-field-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = collectGameInfo();
            next.fields.splice(Number(btn.dataset.i), 1);
            siteMetaRow.game_info = next;
            renderGameInfoAdmin();
        });
    });
    document.querySelectorAll('.gi-link-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = collectGameInfo();
            next.links.splice(Number(btn.dataset.i), 1);
            siteMetaRow.game_info = next;
            renderGameInfoAdmin();
        });
    });
}

function collectGameInfo() {
    const info = gameInfo();

    const fields = [];
    document.querySelectorAll('.gi-field-label').forEach(labelInput => {
        const i = labelInput.dataset.i;
        const valueInput = document.querySelector(`.gi-field-value[data-i="${i}"]`);
        const subtextInput = document.querySelector(`.gi-field-subtext[data-i="${i}"]`);

        const entry = { label: labelInput.value.trim(), value: valueInput ? valueInput.value.trim() : '' };
        if (subtextInput && subtextInput.value.trim()) entry.subtext = subtextInput.value.trim();
        if (entry.label || entry.value) fields.push(entry);
    });

    const links = [];
    document.querySelectorAll('.gi-link-name').forEach(nameInput => {
        const i = nameInput.dataset.i;
        const urlInput = document.querySelector(`.gi-link-url[data-i="${i}"]`);
        const name = nameInput.value.trim();
        const url = urlInput ? urlInput.value.trim() : '';
        if (name || url) links.push({ name, url });
    });

    return { title: info.title, linksLabel: info.linksLabel, fields, links };
}

function addGameInfoField() {
    if (!siteMetaRow) return;
    const next = collectGameInfo();
    next.fields.push({ label: '', value: '' });
    siteMetaRow.game_info = next;
    renderGameInfoAdmin();
}

function addGameInfoLink() {
    if (!siteMetaRow) return;
    const next = collectGameInfo();
    next.links.push({ name: '', url: '' });
    siteMetaRow.game_info = next;
    renderGameInfoAdmin();
}

async function saveGameInfo() {
    const btn = document.getElementById('btn-save-game-info');
    const results = document.getElementById('game-info-results');
    if (!siteMetaRow) {
        results.innerHTML = '<p class="admin-error-text">Load the metadata first.</p>';
        return;
    }

    const info = collectGameInfo();

    // Refused rather than rewritten to "#": a quiet rewrite looks like the save worked.
    const badLink = info.links.find(l => l.url && !/^https?:\/\//i.test(l.url));
    if (badLink) {
        results.innerHTML = `<p class="admin-error-text">"${window.escapeHtml(badLink.name || badLink.url)}" must start with http:// or https://.</p>`;
        return;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient.from('site_meta')
        .update({ game_info: info, updated_at: new Date().toISOString() })
        .eq('id', true);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    siteMetaRow.game_info = info;
    renderGameInfoAdmin();
    results.innerHTML = '<span class="owner-success-text">Saved. Live on the main dashboard now.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('meta-hub-select');
    if (!select) return;   // not on owner.html

    // Switching dashboards keeps the edits typed into this one.
    select.addEventListener('change', () => {
        if (!siteMetaRow) { renderHubMetaFields(); return; }

        const previous = select.dataset.previous || 'main-hub';
        const hubs = siteMetaRow.hubs || (siteMetaRow.hubs = {});
        const hub = hubs[previous] || (hubs[previous] = {});

        hub.title = document.getElementById('meta-hub-title').value.trim();
        hub.description = document.getElementById('meta-hub-description').value.trim();

        const headings = {};
        document.querySelectorAll('.meta-heading-input').forEach(input => {
            headings[input.dataset.headingKey] = input.value;
        });
        if (Object.keys(headings).length > 0) hub.headings = headings;

        select.dataset.previous = select.value;
        renderHubMetaFields();
    });
    select.dataset.previous = select.value;

    loadSiteMeta();
});
