/**
 * Dashboard Steps: the Side Dashboard's two numbered lists, Start Here and How to
 * Contribute, chosen and ordered by the owner. The order in the form is the order
 * on the page.
 * @since v0.11
 * @touches site_meta.hubs[hub].lists (read at runtime from data/site_meta.json by
 *   renderHubList in hub_content.js)
 * @watch owner-site-meta.js saves the same hubs column, each card from the copy it
 *   loaded. A step with no url is plain text ("Sign in" is an instruction, not a
 *   page); a url must be http(s), as renderHubList requires.
 * @see docs/owner-tools.md
 */

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

    // Gone if owner.js sent the visitor to ACCESS DENIED during the read.
    if (!results.isConnected) return;
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
                <input type="text" class="editor-input hub-step-title" data-i="${i}" value="${window.escapeHtml(step.title)}" placeholder="Step title">
                <input type="text" class="editor-input hub-step-url" data-i="${i}" value="${window.escapeHtml(step.url || '')}" placeholder="Link (blank for an instruction)">
                <input type="text" class="editor-input hub-step-desc" data-i="${i}" value="${window.escapeHtml(step.description || '')}" placeholder="One line on what it covers">
            </div>
            <div class="personnel-row-actions">
                <button class="btn-sys btn-sys-regular hub-step-up" data-i="${i}"${i === 0 ? ' disabled' : ''}>&uarr;</button>
                <button class="btn-sys btn-sys-regular hub-step-down" data-i="${i}"${i === steps.length - 1 ? ' disabled' : ''}>&darr;</button>
                <button class="btn-sys btn-sys-red hub-step-delete" data-i="${i}">DELETE</button>
            </div>
        </div>
    `).join('');

    // Every handler reads the form first, so moving or deleting one row keeps text
    // typed into another.
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
        // An emptied row is a removed row.
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

    // The same rule renderHubList paints by, refused at save so a typo shows.
    const bad = currentSteps().find(s => s.url && /^[a-z][a-z0-9+.-]*:/i.test(s.url) && !/^https?:\/\//i.test(s.url));
    if (bad) {
        results.innerHTML = `<p class="admin-error-text">"${window.escapeHtml(bad.title || bad.url)}" must be a page path or an http(s) link.</p>`;
        return;
    }

    btn.disabled = true;
    const { error } = await window.supabaseClient
        .from('site_meta').update({ hubs: hubListWorking, updated_at: new Date().toISOString() }).eq('id', true);
    btn.disabled = false;

    if (error) {
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    results.innerHTML = '<span class="owner-success-text">Saved. Live on the Side Dashboard now.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const { select } = hubListEls();
    if (!select) return;   // not on owner.html

    select.addEventListener('change', () => {
        // Keeps the edits to the list being left.
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
