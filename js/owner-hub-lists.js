/**
 * Dogslamloop Wiki - Owner Tools: Dashboard Steps.
 *
 * The Side Dashboard's two numbered lists - Start Here, and How to Contribute.
 *
 * Curated, not generated. navigation.json knows which guides exist but has no
 * opinion on which to read first, and that opinion is the whole value of the
 * section: a generated version would just be the registry in a different
 * shape. So these are owner-edited, and the order in the form is the order on
 * the page.
 *
 * Stored under site_meta.hubs[hub].lists, alongside the titles, descriptions
 * and headings that card already manages. Read at runtime from
 * data/site_meta.json by js/hub_content.js's renderHubList - so unlike the
 * <title>/OG block, these appear as soon as they are saved.
 *
 * A step with a blank url renders as plain text rather than a link, because
 * "Sign in" is an instruction, not a page.
 */

// Reuses siteMetaRow from js/owner-site-meta.js, which loads the same
// singleton. Two cards editing one row could drift, so this one re-reads
// before saving rather than trusting a copy taken at page load.
let hubListWorking = null;

const HUB_LISTS_PAGE = 'systems-hub';

function hubListEls() {
    return {
        select: document.getElementById('hub-list-select'),
        steps: document.getElementById('hub-list-steps'),
        results: document.getElementById('hub-list-results'),
    };
}

async function loadHubLists() {
    const { results } = hubListEls();
    if (!results) return;

    const { data, error } = await window.supabaseClient
        .from('site_meta').select('hubs').limit(1).maybeSingle();

    if (error) { results.innerHTML = contentNotDeployedMessage(error, 'Dashboard steps'); return; }

    hubListWorking = (data && data.hubs) || {};
    results.innerHTML = '';
    renderHubListSteps();
}

function currentSteps() {
    const { select } = hubListEls();
    const hub = (hubListWorking || {})[HUB_LISTS_PAGE] || {};
    const lists = hub.lists || {};
    const steps = lists[select.value];
    return Array.isArray(steps) ? steps : [];
}

function renderHubListSteps() {
    const { steps: container } = hubListEls();
    const steps = currentSteps();

    if (steps.length === 0) {
        container.innerHTML = '<p class="loading-msg">No steps yet.</p>';
        return;
    }

    container.innerHTML = steps.map((step, i) => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <input type="text" class="editor-input hub-step-title" data-i="${i}" value="${ownerEscape(step.title)}" placeholder="Step title">
                <input type="text" class="editor-input hub-step-url" data-i="${i}" value="${ownerEscape(step.url || '')}" placeholder="Link (blank for an instruction)">
                <input type="text" class="editor-input hub-step-desc" data-i="${i}" value="${ownerEscape(step.description || '')}" placeholder="One line on what it covers">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular hub-step-up" data-i="${i}"${i === 0 ? ' disabled' : ''}>&uarr;</button>
                <button class="btn-sys btn-sys-regular hub-step-down" data-i="${i}"${i === steps.length - 1 ? ' disabled' : ''}>&darr;</button>
                <button class="btn-sys btn-sys-red hub-step-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('');

    // Every handler re-reads the form first, so reordering or deleting one row
    // cannot discard text typed into another.
    container.querySelectorAll('.hub-step-up').forEach(btn => {
        btn.addEventListener('click', () => moveHubStep(Number(btn.dataset.i), -1));
    });
    container.querySelectorAll('.hub-step-down').forEach(btn => {
        btn.addEventListener('click', () => moveHubStep(Number(btn.dataset.i), 1));
    });
    container.querySelectorAll('.hub-step-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const steps = collectHubSteps();
            steps.splice(Number(btn.dataset.i), 1);
            setCurrentSteps(steps);
            renderHubListSteps();
        });
    });
}

/** Reads the form back into an ordered array. */
function collectHubSteps() {
    const { steps: container } = hubListEls();
    const out = [];

    container.querySelectorAll('.hub-step-title').forEach(titleInput => {
        const i = titleInput.dataset.i;
        const url = container.querySelector(`.hub-step-url[data-i="${i}"]`);
        const desc = container.querySelector(`.hub-step-desc[data-i="${i}"]`);

        const step = {
            title: titleInput.value.trim(),
            url: url ? url.value.trim() : '',
            description: desc ? desc.value.trim() : '',
        };
        // A row with nothing in it is a row the owner emptied to remove it.
        if (step.title || step.url || step.description) out.push(step);
    });

    return out;
}

function setCurrentSteps(steps) {
    const { select } = hubListEls();
    if (!hubListWorking[HUB_LISTS_PAGE]) hubListWorking[HUB_LISTS_PAGE] = {};
    const hub = hubListWorking[HUB_LISTS_PAGE];
    if (!hub.lists) hub.lists = {};
    hub.lists[select.value] = steps;
}

function moveHubStep(index, delta) {
    const steps = collectHubSteps();
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;

    [steps[index], steps[target]] = [steps[target], steps[index]];
    setCurrentSteps(steps);
    renderHubListSteps();
}

function addHubListStep() {
    if (!hubListWorking) return;
    const steps = collectHubSteps();
    steps.push({ title: '', url: '', description: '' });
    setCurrentSteps(steps);
    renderHubListSteps();
}

async function saveHubLists() {
    const btn = document.getElementById('btn-save-hub-lists');
    const { results } = hubListEls();
    if (!hubListWorking) {
        results.innerHTML = '<p class="admin-error-text">Load the steps first.</p>';
        return;
    }

    setCurrentSteps(collectHubSteps());

    // Same rule renderHubList enforces when painting. Rejecting here rather
    // than silently dropping the link means a typo is visible at save time.
    const bad = currentSteps().find(s => s.url && /^[a-z][a-z0-9+.-]*:/i.test(s.url) && !/^https?:\/\//i.test(s.url));
    if (bad) {
        results.innerHTML = `<p class="admin-error-text">"${ownerEscape(bad.title || bad.url)}" must be a page path or an http(s) link.</p>`;
        return;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('site_meta').update({ hubs: hubListWorking, updated_at: new Date().toISOString() }).eq('id', true);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    results.innerHTML = '<span class="owner-success-text">Saved. Live on the Side Dashboard now.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const { select } = hubListEls();
    if (!select) return;   // not on owner.html

    select.addEventListener('change', () => {
        // Keep edits to the list being navigated away from.
        if (hubListWorking) {
            const previous = select.dataset.previous || 'startHere';
            const steps = collectHubSteps();
            if (!hubListWorking[HUB_LISTS_PAGE]) hubListWorking[HUB_LISTS_PAGE] = {};
            const hub = hubListWorking[HUB_LISTS_PAGE];
            if (!hub.lists) hub.lists = {};
            hub.lists[previous] = steps;
        }
        select.dataset.previous = select.value;
        renderHubListSteps();
    });
    select.dataset.previous = select.value;

    loadHubLists();
});
