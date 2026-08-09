/**
 * Dogslamloop Wiki - Owner Tools: Dashboard Text
 *
 * Editing for the prose on the three hub dashboards, with a live preview of
 * the real page beside it.
 *
 * This replaced routing hub text through edit.html. The editor loaded and
 * saved a hub row correctly, but it is built around character and system
 * pages: it showed leftover matchups/counterplay tab containers, a generic
 * "Editing Section" title, and - the reason that mattered - a preview that
 * renders a system-page layout. A dashboard's whole point is the sections
 * around the text, and the editor structurally could not show them.
 *
 * So the preview here is an iframe of the actual dashboard, and edits are
 * posted into it as they are typed. There is no second renderer to drift out
 * of sync with the real page, because there is no second renderer.
 *
 * Storage is unchanged: page_data rows keyed by hub id, tabs used as named
 * slots. Admins write live data directly here (the "Admin Write Live Data"
 * policy on page_data), rather than going through the review queue - hub copy
 * is site chrome, and an admin reviewing their own one-line edit is ceremony.
 */

// Declared here rather than read from the row, so a slot can be filled before
// it exists in the database. Stage 3 adds the Side Dashboard's reading path
// and contribute sections by extending this list.
const HUB_SLOTS = {
    'main-hub': {
        file: 'index.html',
        slots: [{ id: 'about', label: 'About Us', container: 'about-body' }],
    },
    'character-hub': {
        file: 'characters/index.html',
        slots: [{ id: 'intro', label: 'Roster Overview', container: 'about-section' }],
    },
    'systems-hub': {
        file: 'systems/index.html',
        slots: [{ id: 'intro', label: 'Introduction', container: 'about-section' }],
    },
};

let hubRows = {};        // pageId -> desc_data
let previewTimer = null;

function hubTextEls() {
    return {
        hub: document.getElementById('hub-text-select'),
        slot: document.getElementById('hub-slot-select'),
        body: document.getElementById('hub-text-body'),
        frame: document.getElementById('hub-preview-frame'),
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

    results.innerHTML = '';
    renderSlotOptions();
    fillSlotText();
    refreshHubPreview();
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

/**
 * Points the iframe at the right dashboard and pushes the current text in.
 *
 * Reloads only when the page actually changes - re-pointing the frame on every
 * keystroke would restart the roster and widget fetches each time.
 */
function refreshHubPreview() {
    const { hub, frame } = hubTextEls();
    if (!frame) return;

    const wanted = HUB_SLOTS[hub.value].file;
    if (frame.dataset.showing !== wanted) {
        frame.dataset.showing = wanted;
        frame.src = wanted;
        frame.addEventListener('load', () => postPreview(), { once: true });
        return;
    }
    postPreview();
}

function postPreview() {
    const { body, frame } = hubTextEls();
    if (!frame || !frame.contentWindow) return;

    const payload = {
        type: 'dsl-hub-preview',
        containerId: currentSlot().container,
        blocks: textToBlocks(body.value),
    };

    // Headings come from the Site Metadata card when it is loaded, so the
    // preview reflects every unsaved change on the page rather than just this
    // card's.
    const headings = {};
    document.querySelectorAll('.meta-heading-input').forEach(input => {
        headings[input.dataset.headingKey] = input.value;
    });
    if (Object.keys(headings).length > 0) payload.headings = headings;

    frame.contentWindow.postMessage(payload, window.location.origin);
}

function scheduleHubPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(postPreview, 300);
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
    const { hub, slot, body } = hubTextEls();
    if (!hub) return;   // not on owner.html

    hub.addEventListener('change', () => loadHubText());
    slot.addEventListener('change', () => { fillSlotText(); refreshHubPreview(); });
    body.addEventListener('input', scheduleHubPreview);

    loadHubText();
});
