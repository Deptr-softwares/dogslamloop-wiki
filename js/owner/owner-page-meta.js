/**
 * Page Details: the flags and labels that decide how a page is presented (the
 * WIP, EA and Hidden badges, the roster filters, a character's archetype, release
 * date and colour) and which optional tabs a character has.
 * @since v0.11
 * @touches site_pages (to navigation.json at the next regeneration),
 *   page_data.tab_settings, the optional tabs in character_tabs.js,
 *   parseCharacterColor (site_meta.js)
 * @watch archetype and release_date are emitted only for characters
 *   (fetch-registry.js), so the form hides them for other pages. A colour is
 *   stored in a form the site reads: hex or hsl().
 * @see docs/owner-tools.md
 */

// Shown for every page type.
const PAGE_FLAGS = [
    { column: 'is_wip', label: 'Work in progress' },
    // Apart from is_wip: WIP is whether a page is finished, Hidden is where the
    // character can be played.
    { column: 'is_hidden', label: 'Hidden (private server only)' },
    { column: 'is_ea', label: 'Early access' },
    { column: 'is_base_only', label: 'Base-only character' },
    { column: 'is_missing_media', label: 'Missing media' },
    { column: 'is_subjective', label: 'Subjective content' },
];

let pageMetaRows = [];

// From page_data, which is saved apart from site_pages and reaches the site on
// the next load, not the next regeneration.
let pageMetaTabSettings = {};

async function loadPageMeta() {
    const select = document.getElementById('page-meta-select');
    const results = document.getElementById('page-meta-results');
    if (!select) return;

    const { data, error } = await window.supabaseClient
        .from('site_pages')
        .select('page_id, name, page_type, category, status, is_wip, is_hidden, is_ea, is_base_only, is_missing_media, is_subjective, archetype, release_date, color')
        .order('category')
        .order('sort_order');

    if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Page details'); return; }

    // Not awaited with the query above: a page may have no page_data row yet, and
    // the card must work without this table.
    pageMetaTabSettings = {};
    try {
        const { data: tabRows, error: tabErr } = await window.supabaseClient
            .from('page_data').select('page_id, tab_settings');
        if (!tabErr && tabRows) {
            tabRows.forEach(row => { pageMetaTabSettings[row.page_id] = row.tab_settings || {}; });
        }
    } catch (e) {
        console.warn('[Owner] Optional tab settings unavailable:', e);
    }

    pageMetaRows = data || [];

    // Checked again after the await: the gate replaces the page on a refused load,
    // and a helper below would throw.
    if (!document.getElementById('page-meta-select')) return;

    results.innerHTML = '';

    // Archived and draft pages too: their details are what you fix before bringing
    // one back.
    select.innerHTML = pageMetaRows.map(row => `
        <option value="${window.escapeHtml(row.page_id)}">${window.escapeHtml(row.name)}${row.status !== 'live' ? ` (${window.escapeHtml(row.status)})` : ''}</option>
    `).join('');

    renderPageMetaFields();
}

function currentPageMetaRow() {
    const select = document.getElementById('page-meta-select');
    if (!select) return null;
    return pageMetaRows.find(r => r.page_id === select.value) || null;
}

// The browser's own colour parser: it knows every form the renderer does.
function isValidCssColor(value) {
    if (typeof CSS !== 'undefined' && CSS.supports) return CSS.supports('color', value);

    // Without CSS.supports, the style system rejects an invalid value.
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = value;
    return probe.style.color !== '';
}

// The site reads two forms, hex and hsl(n, n%, n%) (parseCharacterColor). One of
// them is kept as typed; anything else is painted to one pixel, read back and
// stored as hsl(). A colour with transparency returns null: nobody picked it.
const SITE_COLOR_FORMS = /^(#([0-9a-f]{3}|[0-9a-f]{6})|hsl\(\d+,\s*[\d.]+%,\s*[\d.]+%\))$/i;

function toSiteColor(value) {
    if (SITE_COLOR_FORMS.test(value)) return value;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a !== 255) return null;

    const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    const parts = window.parseCharacterColor(hex);
    return `hsl(${Math.round(parts.h)}, ${Math.round(parts.s)}%, ${Math.round(parts.l)}%)`;
}

function syncColorPreview() {
    const input = document.getElementById('page-meta-color');
    const swatch = document.getElementById('page-meta-color-swatch');
    const picker = document.getElementById('page-meta-color-picker');
    if (!input || !swatch) return;

    const value = input.value.trim();
    const valid = value !== '' && isValidCssColor(value);

    swatch.style.background = valid ? value : 'transparent';
    swatch.classList.toggle('page-meta-color-swatch-empty', !valid);
    swatch.title = value === '' ? 'No colour set' : (valid ? value : `${value} is not a colour`);

    // The native picker speaks only #rrggbb, so it follows the text when it can, and
    // an hsl() value stays as typed.
    if (picker && valid && /^#[0-9a-f]{6}$/i.test(value)) picker.value = value;
}
window.syncColorPreview = syncColorPreview;

function renderPageMetaFields() {
    const row = currentPageMetaRow();
    const flags = document.getElementById('page-meta-flags');
    const characterFields = document.getElementById('page-meta-character-fields');
    if (!row) { flags.innerHTML = ''; return; }

    flags.innerHTML = PAGE_FLAGS.map(flag => `
        <label class="page-meta-flag">
            <input type="checkbox" class="page-meta-checkbox" data-column="${window.escapeHtml(flag.column)}"${row[flag.column] ? ' checked' : ''}>
            <span>${window.escapeHtml(flag.label)}</span>
        </label>
    `).join('');

    const isCharacter = row.page_type === 'character';
    characterFields.hidden = !isCharacter;
    if (isCharacter) {
        document.getElementById('page-meta-archetype').value = row.archetype || '';
        document.getElementById('page-meta-release').value = row.release_date || '';
        document.getElementById('page-meta-color').value = row.color || '';
        syncColorPreview();
    }

    renderPageMetaTabs(row, isCharacter);
}

// One checkbox per optional tab in the vocabulary, so a second optional tab is a
// registry entry and nothing more.
function renderPageMetaTabs(row, isCharacter) {
    const block = document.getElementById('page-meta-tabs-block');
    const host = document.getElementById('page-meta-tabs');
    if (!block || !host) return;

    const optional = window.getOptionalCharacterTabs ? window.getOptionalCharacterTabs() : [];

    block.hidden = !isCharacter || optional.length === 0;
    if (block.hidden) { host.innerHTML = ''; return; }

    const settings = pageMetaTabSettings[row.page_id] || {};
    host.innerHTML = optional.map(tab => `
        <label class="page-meta-flag">
            <input type="checkbox" class="page-meta-tab-checkbox" data-tab="${window.escapeHtml(tab.id)}"${settings[tab.id] === true ? ' checked' : ''}>
            <span>${window.escapeHtml(tab.label)} tab</span>
        </label>
    `).join('');
}

async function savePageMeta() {
    const btn = document.getElementById('btn-save-page-meta');
    const results = document.getElementById('page-meta-results');
    const row = currentPageMetaRow();
    if (!row) { results.innerHTML = '<p class="admin-error-text">Pick a page first.</p>'; return; }

    const payload = { updated_at: new Date().toISOString() };
    let convertedFrom = null;
    document.querySelectorAll('.page-meta-checkbox').forEach(box => {
        payload[box.dataset.column] = box.checked;
    });

    if (row.page_type === 'character') {
        // Empty is NULL, not "": never set, not set to blank.
        const value = (id) => document.getElementById(id).value.trim() || null;
        payload.archetype = value('page-meta-archetype');
        payload.release_date = value('page-meta-release');

        // Refused rather than written: a colour the browser cannot parse renders as
        // nothing everywhere it is read.
        const typed = value('page-meta-color');
        if (typed && !isValidCssColor(typed)) {
            results.innerHTML = `<span class="admin-error-text">${window.escapeHtml(typed)} is not a colour the browser understands. Try #ff8080 or hsl(0, 100%, 75%).</span>`;
            return;
        }
        const color = typed ? toSiteColor(typed) : null;
        if (typed && !color) {
            results.innerHTML = `<span class="admin-error-text">${window.escapeHtml(typed)} is see-through, and a page colour cannot be. Try #ff8080 or hsl(0, 100%, 75%).</span>`;
            return;
        }
        if (color !== typed) {
            document.getElementById('page-meta-color').value = color || '';
            syncColorPreview();
            convertedFrom = typed;
        }
        payload.color = color;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('site_pages').update(payload).eq('page_id', row.page_id);

    // A second write to another table, after the first succeeds, so one failure is
    // reported at a time.
    let tabError = null;
    if (!error) tabError = await savePageMetaTabs(row);

    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    Object.assign(row, payload);

    if (tabError) {
        results.innerHTML = `<p class="admin-error-text">Details saved, but the optional tabs did not: ${window.escapeHtml(tabError.message)}</p>`;
        return;
    }

    const tabsShown = !document.getElementById('page-meta-tabs-block').hidden;
    results.innerHTML = `<span class="owner-success-text">Saved. "${window.escapeHtml(row.name)}" updates on the site after the next regeneration run`
        + (tabsShown ? `; optional tabs take effect on the next page load.` : `.`)
        + (convertedFrom ? ` The colour ${window.escapeHtml(convertedFrom)} is stored as ${window.escapeHtml(payload.color)}, which is the form the site reads.` : ``)
        + `</span>`;
}

/**
 * Writes the optional-tab flags into page_data.tab_settings, merged with what is
 * there, so a tab id from a newer deploy survives. An upsert that names only
 * page_id and tab_settings, so it cannot touch a page's content.
 */
async function savePageMetaTabs(row) {
    const boxes = Array.from(document.querySelectorAll('.page-meta-tab-checkbox'));
    if (!boxes.length) return null;

    const stored = pageMetaTabSettings[row.page_id] || {};

    // Only when a box moved: an upsert on a page with no row would make one with
    // desc_data and frame_data NULL.
    const changed = boxes.some(box => (stored[box.dataset.tab] === true) !== box.checked);
    if (!changed) return null;

    const settings = { ...stored };
    boxes.forEach(box => { settings[box.dataset.tab] = box.checked; });

    const { error } = await window.supabaseClient
        .from('page_data')
        .upsert([{ page_id: row.page_id, page_type: row.page_type, tab_settings: settings }], { onConflict: 'page_id' });

    if (!error) pageMetaTabSettings[row.page_id] = settings;
    return error || null;
}

document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('page-meta-select');
    if (!select) return;   // not on owner.html

    select.addEventListener('change', renderPageMetaFields);

    // The text field stays the value: only it can hold hsl().
    const colorInput = document.getElementById('page-meta-color');
    if (colorInput) colorInput.addEventListener('input', syncColorPreview);

    const colorPicker = document.getElementById('page-meta-color-picker');
    if (colorPicker && colorInput) {
        colorPicker.addEventListener('input', () => {
            colorInput.value = colorPicker.value;
            syncColorPreview();
        });
    }

    loadPageMeta();
});
