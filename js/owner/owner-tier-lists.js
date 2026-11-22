/**
 * Tier Lists: the Tier List page's introduction, who has a list, archiving and
 * deleting one, and the Free Submit Tier List's settings and reset.
 * @since v0.14
 * @touches tier_page_settings, list_tier_lists(), assign_tier_list(),
 *   set_tier_list_status(), delete_tier_list(), reset_free_submit_tier_list(),
 *   initStrategyBlockBuilder and currentStrategyBlocks (editor-blocks.js)
 * @watch assigning a list also grants trusted_editor, never downgrades a role,
 *   and the RPC refuses a viewer. The introduction uses the one Block editor's
 *   buffer, so this page never opens a second Block editor.
 * @see docs/owner-tools.md
 */

let tierPageIntroLoaded = false;

function tierToolSay(containerId, message, isError) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = isError
        ? `<span class="admin-error-text">${window.escapeHtml(message)}</span>`
        : `<span class="owner-success-text">${window.escapeHtml(message)}</span>`;
}

// Normal between a migration and the release that applies it, and said so.
function tierNotDeployed(error) {
    return error && (error.code === 'PGRST202' || error.code === 'PGRST205'
        || /schema cache/i.test(error.message || ''));
}

window.loadTierPageIntro = async function () {
    const host = document.getElementById('tier-page-intro-editor');
    if (!host || !window.supabaseClient) return;
    if (typeof initStrategyBlockBuilder !== 'function') return;

    const { data, error } = await window.supabaseClient
        .from('tier_page_settings').select('intro').maybeSingle();

    if (error) {
        tierToolSay('tier-page-intro-results', tierNotDeployed(error)
            ? "The page introduction arrives with the next release."
            : `Could not load it: ${error.message}`, true);
        return;
    }

    initStrategyBlockBuilder('tier-page-intro-editor', (data && data.intro) || []);
    tierPageIntroLoaded = true;
};

async function saveTierPageIntro() {
    if (!tierPageIntroLoaded) { tierToolSay('tier-page-intro-results', 'Nothing loaded to save.', true); return; }

    // The whole list, flushed first: getActiveBlocks() is only the open box's list
    // inside a Section Box or a Dropdown.
    if (typeof currentStrategyBlocks === 'undefined') {
        tierToolSay('tier-page-intro-results', 'The block editor did not load, so there is nothing to save.', true);
        return;
    }
    const blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));

    const { error } = await window.supabaseClient
        .from('tier_page_settings')
        .update({ intro: blocks, updated_at: new Date().toISOString() })
        .eq('id', true);

    if (error) {
        tierToolSay('tier-page-intro-results', tierNotDeployed(error)
            ? "The page introduction arrives with the next release."
            : `Save failed: ${error.message}`, true);
        return;
    }

    tierToolSay('tier-page-intro-results', 'Saved. It shows until somebody picks a list.');
}

window.loadTierListRoster = async function () {
    const container = document.getElementById('tier-assign-roster');
    if (!container || !window.supabaseClient) return;

    const { data, error } = await window.supabaseClient.rpc('list_tier_lists');

    if (error) {
        container.innerHTML = tierNotDeployed(error)
            ? `<p class="admin-error-text">Tier list assignments arrive with the next release.</p>`
            : `<p class="admin-error-text">Could not load: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    if (!data || !data.length) {
        container.innerHTML = `<p class="admin-queue-empty-msg">Nobody has a tier list yet.</p>`;
        return;
    }

    // Escaped at every interpolation: names and emails are account-supplied.
    container.innerHTML = data.map(row => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge">${window.escapeHtml(row.status)}</span>
                <span class="personnel-email">${window.escapeHtml(row.author_name)}
                    <span class="personnel-self">${window.escapeHtml(row.email || 'no account')}</span>
                </span>
            </div>
            <div class="personnel-row-actions">
                <a class="btn-sys btn-sys-regular" href="tier-editor.html?list=${encodeURIComponent(row.slug)}">OPEN</a>
                <a class="btn-sys btn-sys-regular" href="systems/tierlist/index.html?list=${encodeURIComponent(row.slug)}">VIEW</a>
                ${row.status === 'archived'
                    ? `<button class="btn-sys btn-sys-green tier-status-btn" data-slug="${window.escapeHtml(row.slug)}" data-status="published">RESTORE</button>
                       <button class="btn-sys btn-sys-red tier-delete-btn" data-slug="${window.escapeHtml(row.slug)}">DELETE</button>`
                    : `<button class="btn-sys btn-sys-red tier-status-btn" data-slug="${window.escapeHtml(row.slug)}" data-status="archived">ARCHIVE</button>`}
            </div>
        </div>`).join('');

    // Delegated, not inline: the slug round-trips through the database.
    container.querySelectorAll('.tier-status-btn').forEach(btn => {
        btn.addEventListener('click', () => setTierListStatus(btn.dataset.slug, btn.dataset.status));
    });

    container.querySelectorAll('.tier-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteTierList(btn.dataset.slug));
    });
};

// Archived, not deleted: the public read policy is status = 'published', so the
// list leaves the site, and it and its change history stay for RESTORE.
async function setTierListStatus(slug, status) {
    const archiving = status === 'archived';

    const ok = await window.adminConfirm(archiving
        ? `Archive the list at ?list=${slug}? It comes off the site immediately. Nothing is deleted - the list and its change history stay, and you can restore it here.`
        : `Publish the list at ?list=${slug} again? It goes back on the site immediately.`);
    if (!ok) return;

    tierToolSay('tier-assign-results', archiving ? 'Archiving...' : 'Restoring...');

    const { data, error } = await window.supabaseClient
        .rpc('set_tier_list_status', { p_slug: slug, p_status: status });

    if (error) {
        tierToolSay('tier-assign-results', tierNotDeployed(error)
            ? 'Archiving arrives with the next release.'
            : `Could not change it: ${error.message}`, true);
        return;
    }

    tierToolSay('tier-assign-results', data || 'Done.');
    window.loadTierListRoster();
}
window.setTierListStatus = setTierListStatus;

// Deleting is offered only on an archived list, so removing a live one takes two
// steps. delete_tier_list refuses the same. The confirmation names the change
// history, which goes with it.
async function deleteTierList(slug) {
    const ok = await window.adminConfirm(
        `Permanently delete the list at ?list=${slug}? This destroys the list AND every change note explaining every tier move on it. It cannot be undone - if you only want it off the site, it is already archived.`);
    if (!ok) return;

    tierToolSay('tier-assign-results', 'Deleting...');

    const { data, error } = await window.supabaseClient
        .rpc('delete_tier_list', { p_slug: slug });

    if (error) {
        tierToolSay('tier-assign-results', tierNotDeployed(error)
            ? 'Deleting a tier list arrives with the next release.'
            : error.message, true);
        return;
    }

    tierToolSay('tier-assign-results', data || 'Deleted.');
    window.loadTierListRoster();
}
window.deleteTierList = deleteTierList;

async function assignTierList() {
    const email = (document.getElementById('tier-assign-email') || {}).value || '';
    const slug = (document.getElementById('tier-assign-slug') || {}).value || '';

    if (!email.trim() || !slug.trim()) {
        tierToolSay('tier-assign-results', 'An email and a slug are both required.', true);
        return;
    }

    const { data, error } = await window.supabaseClient.rpc('assign_tier_list', {
        p_email: email.trim(),
        p_slug: slug.trim().toLowerCase(),
        p_blurb: null,
    });

    if (error) {
        tierToolSay('tier-assign-results', tierNotDeployed(error)
            ? 'Tier list assignment arrives with the next release.'
            : error.message, true);
        return;
    }

    tierToolSay('tier-assign-results', data || 'Assigned.');
    document.getElementById('tier-assign-email').value = '';
    document.getElementById('tier-assign-slug').value = '';
    window.loadTierListRoster();
}

// The Free Submit Tier List's knobs are settings, so voting can be closed from
// here within a minute during a brigade.

window.loadFreeSubmitSettings = async function () {
    const openField = document.getElementById('fs-setting-open');
    if (!openField || !window.supabaseClient) return;

    const { data, error } = await window.supabaseClient
        .from('tier_page_settings')
        .select('free_submit_open, free_submit_min_age_days, free_submit_min_contributions, free_submit_min_votes, free_submit_tie_break')
        .maybeSingle();

    if (error || !data) {
        tierToolSay('fs-setting-results', tierNotDeployed(error)
            ? 'The community ranking arrives with the next release.'
            : `Could not load: ${error ? error.message : 'no settings row'}`, true);
        return;
    }

    openField.value = data.free_submit_open ? 'true' : 'false';
    document.getElementById('fs-setting-age').value = data.free_submit_min_age_days;
    document.getElementById('fs-setting-contrib').value = data.free_submit_min_contributions;
    document.getElementById('fs-setting-floor').value = data.free_submit_min_votes;
    // Defaulted here too: a client newer than the database reads undefined, which
    // would save 'undefined'.
    document.getElementById('fs-setting-tie').value = data.free_submit_tie_break === 'higher' ? 'higher' : 'lower';
};

async function saveFreeSubmitSettings() {
    const num = (id, floor) => {
        const raw = parseInt((document.getElementById(id) || {}).value, 10);
        return Number.isFinite(raw) && raw >= floor ? raw : null;
    };

    const age = num('fs-setting-age', 0);
    const contrib = num('fs-setting-contrib', 0);
    const votes = num('fs-setting-floor', 1);

    // Refused, not coerced: a blank age written as 0 opens voting to every account.
    if (age === null || contrib === null || votes === null) {
        tierToolSay('fs-setting-results', 'Every number must be filled in, and the vote floor must be at least 1.', true);
        return;
    }

    // Allowed values only: the column's CHECK would surface as a raw Postgres error.
    const tie = (document.getElementById('fs-setting-tie') || {}).value === 'higher' ? 'higher' : 'lower';

    const { error } = await window.supabaseClient
        .from('tier_page_settings')
        .update({
            free_submit_open: (document.getElementById('fs-setting-open') || {}).value === 'true',
            free_submit_min_age_days: age,
            free_submit_min_contributions: contrib,
            free_submit_min_votes: votes,
            free_submit_tie_break: tie,
            updated_at: new Date().toISOString(),
        })
        .eq('id', true);

    if (error) {
        tierToolSay('fs-setting-results', tierNotDeployed(error)
            ? 'The community ranking arrives with the next release.'
            : `Save failed: ${error.message}`, true);
        return;
    }

    tierToolSay('fs-setting-results', 'Saved. It applies to the next vote.');
}

// Cannot be undone: the votes are what the median is made of. Behind the site's
// own confirm, which names the consequence.
async function resetFreeSubmitTierList() {
    const ok = await window.adminConfirm(
        'Delete every vote in the Free Submit Tier List?\n\n'
        + 'The community ranking will be empty until people vote again. The tier '
        + 'scale and the eligibility settings are kept.\n\nThis cannot be undone.');
    if (!ok) return;

    const btn = document.getElementById('btn-reset-free-submit');
    if (btn) btn.disabled = true;

    // The RPC refuses anyone but the owner (is_owner()); the page's gate is a courtesy.
    const { data, error } = await window.supabaseClient.rpc('reset_free_submit_tier_list');

    if (btn) btn.disabled = false;

    if (error) {
        tierToolSay('fs-reset-results', tierNotDeployed(error)
            ? 'The reset tool arrives with the next release.'
            : `Reset failed: ${error.message}`, true);
        return;
    }

    // It reports how many votes it removed, rather than just "done".
    tierToolSay('fs-reset-results', String(data || 'Reset complete.'));
}

document.addEventListener('DOMContentLoaded', () => {
    const save = document.getElementById('btn-save-tier-page-intro');
    if (save) save.addEventListener('click', saveTierPageIntro);

    const reset = document.getElementById('btn-reset-free-submit');
    if (reset) reset.addEventListener('click', resetFreeSubmitTierList);

    const assign = document.getElementById('btn-assign-tier-list');
    if (assign) assign.addEventListener('click', assignTierList);

    const saveFs = document.getElementById('btn-save-free-submit');
    if (saveFs) saveFs.addEventListener('click', saveFreeSubmitSettings);

    // Loaded when the group first opens: the Block editor is heavy.
    const nav = document.getElementById('owner-nav');
    if (nav) {
        nav.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-group="tierlists"]');
            if (!btn) return;
            if (!tierPageIntroLoaded) window.loadTierPageIntro();
            window.loadTierListRoster();
            window.loadFreeSubmitSettings();
        });
    }
});
