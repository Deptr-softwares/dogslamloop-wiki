/**
 * Dashboard Text: plain fields for the prose on the three hub dashboards. Pick a
 * dashboard, pick a section, type, save.
 * @since v0.11
 * @touches page_data (one row per hub id, its tabs used as named slots)
 * @watch it writes live data directly, under "Admin Write Live Data", with no
 *   review: hub copy is site chrome
 * @see docs/owner-tools.md
 */

// Declared here, so a slot can be filled before its row exists.
const HUB_SLOTS = {
    'main-hub': { slots: [{ id: 'about', label: 'About Us' }] },
    'character-hub': { slots: [{ id: 'intro', label: 'Roster Overview' }] },
    'systems-hub': { slots: [{ id: 'intro', label: 'Introduction' }] },
};

let hubRows = {};

function hubTextEls() {
    return {
        hub: document.getElementById('hub-text-select'),
        slot: document.getElementById('hub-slot-select'),
        body: document.getElementById('hub-text-body'),
        results: document.getElementById('hub-text-results'),
    };
}

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

    // Checked again after the await: the gate replaces the page on a refused load.
    if (!document.getElementById('hub-text-select')) return;

    results.innerHTML = '';
    renderSlotOptions();
    fillSlotText();
}

function renderSlotOptions() {
    const { hub, slot } = hubTextEls();
    const config = HUB_SLOTS[hub.value];
    slot.innerHTML = config.slots
        .map(s => `<option value="${window.escapeHtml(s.id)}">${window.escapeHtml(s.label)}</option>`)
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
    // One section per slot: a slot is one region, and more would be structure the
    // form cannot show.
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
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
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
