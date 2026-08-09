/**
 * Dogslamloop Wiki - Owner Tools: Page Details.
 *
 * The flags and labels that drive how a page is presented rather than what it
 * says: the WIP and EA badges in the sidebar, the roster filters, and a
 * character's archetype / tier / release date.
 *
 * All of them are site_pages columns, and until now the only way to change one
 * was a SQL edit. They surface through data/navigation.json, so - like every
 * other registry change - they reach the site on the next regeneration run
 * rather than immediately.
 *
 * Which fields apply depends on the page type. archetype, tier and
 * release_date are emitted only for characters (scripts/fetch-registry.js
 * omits them for everything else, deliberately, so the JSON does not grow
 * columns that mean nothing), so the form hides them for a system page rather
 * than offering an edit that would be silently dropped.
 */

// Column -> label. Shown for every page type; these are all meaningful on a
// system page too, even where the roster filters only read them for
// characters.
const PAGE_FLAGS = [
    { column: 'is_wip', label: 'Work in progress' },
    { column: 'is_ea', label: 'Early access' },
    { column: 'is_base_only', label: 'Base-only character' },
    { column: 'is_missing_media', label: 'Missing media' },
    { column: 'is_subjective', label: 'Subjective content' },
];

let pageMetaRows = [];

async function loadPageMeta() {
    const select = document.getElementById('page-meta-select');
    const results = document.getElementById('page-meta-results');
    if (!select) return;

    const { data, error } = await window.supabaseClient
        .from('site_pages')
        .select('page_id, name, page_type, category, status, is_wip, is_ea, is_base_only, is_missing_media, is_subjective, archetype, tier, release_date')
        .order('category')
        .order('sort_order');

    if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Page details'); return; }

    pageMetaRows = data || [];
    results.innerHTML = '';

    // Archived and draft pages are included on purpose: their details are
    // exactly what you would want to fix before bringing one back.
    select.innerHTML = pageMetaRows.map(row => `
        <option value="${ownerEscape(row.page_id)}">${ownerEscape(row.name)}${row.status !== 'live' ? ` (${ownerEscape(row.status)})` : ''}</option>
    `).join('');

    renderPageMetaFields();
}

function currentPageMetaRow() {
    const select = document.getElementById('page-meta-select');
    return pageMetaRows.find(r => r.page_id === select.value) || null;
}

function renderPageMetaFields() {
    const row = currentPageMetaRow();
    const flags = document.getElementById('page-meta-flags');
    const characterFields = document.getElementById('page-meta-character-fields');
    if (!row) { flags.innerHTML = ''; return; }

    flags.innerHTML = PAGE_FLAGS.map(flag => `
        <label class="page-meta-flag">
            <input type="checkbox" class="page-meta-checkbox" data-column="${ownerEscape(flag.column)}"${row[flag.column] ? ' checked' : ''}>
            <span>${ownerEscape(flag.label)}</span>
        </label>
    `).join('');

    const isCharacter = row.page_type === 'character';
    characterFields.hidden = !isCharacter;
    if (isCharacter) {
        document.getElementById('page-meta-archetype').value = row.archetype || '';
        document.getElementById('page-meta-tier').value = row.tier || '';
        document.getElementById('page-meta-release').value = row.release_date || '';
    }
}

async function savePageMeta() {
    const btn = document.getElementById('btn-save-page-meta');
    const results = document.getElementById('page-meta-results');
    const row = currentPageMetaRow();
    if (!row) { results.innerHTML = '<p class="admin-error-text">Pick a page first.</p>'; return; }

    const payload = { updated_at: new Date().toISOString() };
    document.querySelectorAll('.page-meta-checkbox').forEach(box => {
        payload[box.dataset.column] = box.checked;
    });

    if (row.page_type === 'character') {
        // Empty string -> NULL, not "". fetch-registry omits a field when it is
        // falsy, so both work today - but a row of empty strings reads as data
        // that exists and is blank, rather than data that was never set.
        const value = (id) => document.getElementById(id).value.trim() || null;
        payload.archetype = value('page-meta-archetype');
        payload.tier = value('page-meta-tier');
        payload.release_date = value('page-meta-release');
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('site_pages').update(payload).eq('page_id', row.page_id);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    Object.assign(row, payload);
    results.innerHTML = `<span class="owner-success-text">Saved. "${ownerEscape(row.name)}" updates on the site after the next regeneration run.</span>`;
}

document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('page-meta-select');
    if (!select) return;   // not on owner.html

    select.addEventListener('change', renderPageMetaFields);
    loadPageMeta();
});
