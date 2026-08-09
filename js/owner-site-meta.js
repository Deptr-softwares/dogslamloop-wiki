/**
 * Dogslamloop Wiki - Owner Tools: Site Metadata & Game Info
 *
 * Split from owner.js rather than appended to it, matching the admin-*.js and
 * editor-*.js precedent: owner.js was already 900 lines of unrelated tools.
 * Depends on owner.js for ownerEscape and contentNotDeployedMessage, which is
 * the same direction the other owner tools already lean.
 *
 * site_meta is a singleton row holding three kinds of thing that reach the
 * site by three different routes:
 *
 *   version / tagline  -> data/site_meta.json, read at runtime by site_meta.js
 *   hub headings       -> data/site_meta.json, read at runtime by hub_content.js
 *   hub title / desc   -> data/site_meta.json, then baked into each hub page's
 *                         <head> by scripts/generate-hub-meta.js
 *
 * Only the last needs a regeneration run before it shows up, because Discord,
 * Twitter and Facebook unfurlers do not execute JavaScript and so cannot be
 * served a runtime-injected tag. owner.html's hint text tells the owner that;
 * this comment records why it is true.
 */

// Held between load and save because the dashboard selector switches three
// sets of fields against one database row - saving has to send the other two
// hubs back unchanged rather than blanking them.
let siteMetaRow = null;

async function loadSiteMeta() {
    const results = document.getElementById('site-meta-results');
    if (!results) return;

    const { data, error } = await window.supabaseClient
        .from('site_meta').select('*').limit(1).maybeSingle();

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

    // The key is shown but deliberately not editable: it has to match a
    // data-heading-key in the page markup, so a typo here would silently stop
    // a heading applying with nothing on screen to explain why.
    container.innerHTML = keys.map(key => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="personnel-email">${ownerEscape(key)}</span>
            </div>
            <div class="personnel-row-actions">
                <input type="text" class="editor-input meta-heading-input"
                       data-heading-key="${ownerEscape(key)}" value="${ownerEscape(headings[key])}">
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
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
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
                <input type="text" class="editor-input gi-field-label" data-i="${i}" value="${ownerEscape(field.label)}" placeholder="Label">
                <input type="text" class="editor-input gi-field-value" data-i="${i}" value="${ownerEscape(field.value)}" placeholder="Value">
                <input type="text" class="editor-input gi-field-subtext" data-i="${i}" value="${ownerEscape(field.subtext || '')}" placeholder="Subtext (optional)">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red gi-field-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('') || '<p class="loading-msg">No facts yet.</p>';

    document.getElementById('game-info-links-admin').innerHTML = info.links.map((link, i) => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <input type="text" class="editor-input gi-link-name" data-i="${i}" value="${ownerEscape(link.name)}" placeholder="Official Discord">
                <input type="text" class="editor-input gi-link-url" data-i="${i}" value="${ownerEscape(link.url)}" placeholder="https://discord.gg/...">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-red gi-link-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('') || '<p class="loading-msg">No links yet.</p>';

    // Re-read the inputs before splicing, so edits typed into other rows are
    // not thrown away by deleting one.
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

/** Reads the form back into the stored shape. */
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

    // Validated here as well as at render time. hub_content.js already refuses
    // any non-http scheme when painting the panel, so a bad URL cannot become
    // an executable href - but silently rewriting it to "#" would look like
    // the save had worked, which is worse than refusing it outright.
    const badLink = info.links.find(l => l.url && !/^https?:\/\//i.test(l.url));
    if (badLink) {
        results.innerHTML = `<p class="admin-error-text">"${ownerEscape(badLink.name || badLink.url)}" must start with http:// or https://.</p>`;
        return;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient.from('site_meta')
        .update({ game_info: info, updated_at: new Date().toISOString() })
        .eq('id', true);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    siteMetaRow.game_info = info;
    renderGameInfoAdmin();
    results.innerHTML = '<span class="owner-success-text">Saved. Live on the main dashboard now.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('meta-hub-select');
    if (!select) return;   // not on owner.html

    // Switching dashboards must not lose edits typed into the current one.
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
