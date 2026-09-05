/**
 * Dogslamloop Wiki - Owner Tools: Dashboard Text
 *
 * Plain fields for the prose on the three hub dashboards. Pick a dashboard,
 * pick a section, type, save.
 *
 * Hub text was originally routed through edit.html. That was wrong: the
 * editor is built around character and system pages, so it showed a generic
 * "Editing Section" title, leftover matchups/counterplay tab containers, and a
 * system-page preview that could never show the roster grid and widgets a
 * dashboard's text is actually read against.
 *
 * The first replacement over-corrected into an iframe preview of the real
 * dashboard. That was removed: the owner had raised the preview to explain why
 * the editor was the wrong tool, not to ask for one. A form is the whole ask.
 *
 * Storage is unchanged: page_data rows keyed by hub id, tabs used as named
 * slots. Admins write live data directly (the "Admin Write Live Data" policy
 * on page_data) rather than going through the review queue - hub copy is site
 * chrome, and an admin reviewing their own one-line edit is ceremony.
 */

// Declared here rather than read from the row, so a slot can be filled before
// it exists in the database.
const HUB_SLOTS = {
    'main-hub': { slots: [{ id: 'about', label: 'About Us' }] },
    'character-hub': { slots: [{ id: 'intro', label: 'Roster Overview' }] },
    'systems-hub': { slots: [{ id: 'intro', label: 'Introduction' }] },
};

let hubRows = {};        // pageId -> desc_data

function hubTextEls() {
    return {
        hub: document.getElementById('hub-text-select'),
        slot: document.getElementById('hub-slot-select'),
        body: document.getElementById('hub-text-body'),
        results: document.getElementById('hub-text-results'),
    };
}

/** Blank-line separated paragraphs, matching the FAQ card's convention. */
function textToBlocks(text) {
    return String(text || '')
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(content => ({ type: 'paragraph', align: 'left', content }));
}

function blocksToText(blocks) {
    return (Array.isArray(blocks) ? blocks : [])
        .filter(b => b && typeof b.content === 'string')
        .map(b => b.content)
        .join('\n\n');
}

function currentSlot() {
    const { hub, slot } = hubTextEls();
    const config = HUB_SLOTS[hub.value];
    return config.slots.find(s => s.id === slot.value) || config.slots[0];
}

async function loadHubText() {
    const { hub, results } = hubTextEls();
    if (!hub) return;

    const pageId = hub.value;
    if (hubRows[pageId] === undefined) {
        const { data, error } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', pageId).maybeSingle();

        if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Dashboard text'); return; }
        hubRows[pageId] = (data && data.desc_data) || { tabs: [] };
    }

    // Re-checked after the await for the same reason as loadPageMeta: the guard
    // above passed before the query, and owner.html's RBAC gate replaces the
    // page wholesale on a denied load. renderSlotOptions and fillSlotText both
    // re-query the DOM and both read `.value` unguarded, so one check here
    // covers the whole chain.
    if (!document.getElementById('hub-text-select')) return;

    results.innerHTML = '';
    renderSlotOptions();
    fillSlotText();
}

function renderSlotOptions() {
    const { hub, slot } = hubTextEls();
    const config = HUB_SLOTS[hub.value];
    slot.innerHTML = config.slots
        .map(s => `<option value="${ownerEscape(s.id)}">${ownerEscape(s.label)}</option>`)
        .join('');
}

function fillSlotText() {
    const { hub, body } = hubTextEls();
    const desc = hubRows[hub.value] || { tabs: [] };
    const tab = (desc.tabs || []).find(t => t && t.tabId === currentSlot().id);
    const blocks = tab ? (tab.sections || []).flatMap(s => (s && s.blocks) || []) : [];
    body.value = blocksToText(blocks);
}

async function saveHubText() {
    const { hub, body, results } = hubTextEls();
    const btn = document.getElementById('btn-save-hub-text');
    const pageId = hub.value;
    const slotId = currentSlot().id;

    const desc = JSON.parse(JSON.stringify(hubRows[pageId] || { tabs: [] }));
    if (!Array.isArray(desc.tabs)) desc.tabs = [];

    let tab = desc.tabs.find(t => t && t.tabId === slotId);
    if (!tab) {
        tab = { tabId: slotId, tabLabel: currentSlot().label, sections: [] };
        desc.tabs.push(tab);
    }
    // One section per slot: a hub slot is a single region, and preserving an
    // arbitrary number of sections here would give the owner a structure they
    // have no way to see or control from this form.
    tab.sections = [{
        sectionTitle: currentSlot().label,
        layout: 'full',
        width: 100,
        alignment: 'left',
        blocks: textToBlocks(body.value),
    }];

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('page_data')
        .upsert({ page_id: pageId, page_type: 'system', desc_data: desc }, { onConflict: 'page_id' });
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    hubRows[pageId] = desc;
    results.innerHTML = '<span class="owner-success-text">Saved. Live on the dashboard now.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const { hub, slot } = hubTextEls();
    if (!hub) return;   // not on owner.html

    hub.addEventListener('change', () => loadHubText());
    slot.addEventListener('change', () => fillSlotText());

    loadHubText();
});
