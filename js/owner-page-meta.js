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
    // Private-server-only (v0.16 feature 3). Separate from is_wip on purpose:
    // work-in-progress is about whether a page is FINISHED, hidden is about
    // where the character can be PLAYED, and a page can be either without being
    // the other.
    { column: 'is_hidden', label: 'Hidden (private server only)' },
    { column: 'is_ea', label: 'Early access' },
    { column: 'is_base_only', label: 'Base-only character' },
    { column: 'is_missing_media', label: 'Missing media' },
    { column: 'is_subjective', label: 'Subjective content' },
];

let pageMetaRows = [];

// page_id -> tab_settings, read from page_data rather than site_pages. Kept
// separate because the two tables are saved separately: site_pages reaches the
// site at the next regeneration, page_data on the next page load.
let pageMetaTabSettings = {};

async function loadPageMeta() {
    const select = document.getElementById('page-meta-select');
    const results = document.getElementById('page-meta-results');
    if (!select) return;

    const { data, error } = await window.supabaseClient
        .from('site_pages')
        .select('page_id, name, page_type, category, status, is_wip, is_hidden, is_ea, is_base_only, is_missing_media, is_subjective, archetype, tier, release_date, color')
        .order('category')
        .order('sort_order');

    if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Page details'); return; }

    // Not awaited alongside the query above: a page with no page_data row yet
    // is normal (a page created here has one only once somebody edits it), and
    // the whole card must still work when this table is unreachable - the
    // migration adding tab_settings lands with a release, so between merging
    // this and that release the column genuinely does not exist.
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

// The browser's own colour parser, borrowed. Returns false for anything it
// cannot render, which is exactly the question being asked - and unlike a regex
// it already knows about hsl(), rgb(), #rgb, #rrggbbaa and every named colour.
function isValidCssColor(value) {
    if (typeof CSS !== 'undefined' && CSS.supports) return CSS.supports('color', value);

    // Fallback for a browser without CSS.supports: let the style system reject
    // it. Assigning an invalid value to a style property leaves it unchanged,
    // so a non-empty result means it parsed.
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = value;
    return probe.style.color !== '';
}

// A swatch beside the field, because a hex string is not a colour to a person
// and the whole point of this feature is picking one that looks right.
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

    // The native picker only speaks #rrggbb, so it follows the text field when
    // it can and is simply left alone when it cannot - an hsl() value stays
    // readable in the text field rather than being silently rewritten to hex.
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
        document.getElementById('page-meta-color').value = row.color || '';
        syncColorPreview();
    }

    renderPageMetaTabs(row, isCharacter);
}

// One checkbox per OPTIONAL tab in the vocabulary, read from
// js/character_tabs.js rather than naming Techs. A second optional tab is then
// a registry entry and nothing else - which is the whole reason the flag is a
// jsonb object keyed by tab id instead of a techs_enabled column.
function renderPageMetaTabs(row, isCharacter) {
    const block = document.getElementById('page-meta-tabs-block');
    const host = document.getElementById('page-meta-tabs');
    if (!block || !host) return;

    const optional = window.getOptionalCharacterTabs ? window.getOptionalCharacterTabs() : [];

    // Character pages only: the tab vocabulary is a character's, so offering
    // it on a system page would be an edit that means nothing.
    block.hidden = !isCharacter || optional.length === 0;
    if (block.hidden) { host.innerHTML = ''; return; }

    const settings = pageMetaTabSettings[row.page_id] || {};
    host.innerHTML = optional.map(tab => `
        <label class="page-meta-flag">
            <input type="checkbox" class="page-meta-tab-checkbox" data-tab="${ownerEscape(tab.id)}"${settings[tab.id] === true ? ' checked' : ''}>
            <span>${ownerEscape(tab.label)} tab</span>
        </label>
    `).join('');
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

        // Checked with the browser's own parser rather than a regex. The
        // existing dictionary is hsl(), the picker writes #rrggbb, and somebody
        // will eventually type `rebeccapurple` - CSS.supports understands every
        // form the renderer does, and a regex would reject a valid colour the
        // first time it met one it had not thought of.
        //
        // Refused rather than written, because a colour the browser cannot
        // parse reaches ten consumers and renders as nothing on all of them.
        const color = value('page-meta-color');
        if (color && !isValidCssColor(color)) {
            results.innerHTML = `<span class="admin-error-text">${ownerEscape(color)} is not a colour the browser understands. Try #ff8080 or hsl(0, 100%, 75%).</span>`;
            return;
        }
        payload.color = color;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('site_pages').update(payload).eq('page_id', row.page_id);

    // Optional tabs go to a different table, so they are a second write. Done
    // after the first succeeds rather than in parallel: if site_pages fails
    // there is nothing to report about tabs, and two independent failures in
    // one message is not something anyone can act on.
    let tabError = null;
    if (!error) tabError = await savePageMetaTabs(row);

    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    Object.assign(row, payload);

    if (tabError) {
        results.innerHTML = `<p class="admin-error-text">Details saved, but the optional tabs did not: ${ownerEscape(tabError.message)}</p>`;
        return;
    }

    const tabsShown = !document.getElementById('page-meta-tabs-block').hidden;
    results.innerHTML = `<span class="owner-success-text">Saved. "${ownerEscape(row.name)}" updates on the site after the next regeneration run`
        + (tabsShown ? `; optional tabs take effect on the next page load.` : `.`)
        + `</span>`;
}

/**
 * Writes the optional-tab flags into page_data.tab_settings.
 *
 * Merged into whatever is already there rather than replacing it, so a tab id
 * this build does not know about - one added by a newer deploy while this tab
 * was open - is not silently dropped by an older client.
 *
 * upsert with the page_id, because a character nobody has edited yet has no
 * page_data row at all. desc_data and frame_data are left out of the payload
 * on purpose: PostgREST's ON CONFLICT DO UPDATE only writes the columns it is
 * given, so this cannot clobber a page's content.
 */
async function savePageMetaTabs(row) {
    const boxes = Array.from(document.querySelectorAll('.page-meta-tab-checkbox'));
    if (!boxes.length) return null;

    const stored = pageMetaTabSettings[row.page_id] || {};

    // Nothing to do unless a box actually MOVED. Writing on every SAVE DETAILS
    // click would touch page_data as a side effect of saving site_pages fields
    // that have nothing to do with tabs - and for a page with no page_data row
    // yet, the upsert would CREATE one with desc_data and frame_data NULL.
    // That is exactly the shape that made the Main Dashboard unsaveable
    // (20260818000001): a row NULL in either column could not be updated by
    // anything until the trigger was fixed. Saving a page's archetype should
    // not quietly manufacture one.
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

    // The swatch follows the text field, and the picker writes into it. The
    // text field stays the value: it is the only one of the three that can hold
    // an hsl().
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
