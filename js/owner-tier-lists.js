/**
 * Dogslamloop Wiki - Owner Tools: Tier Lists
 *
 * Split from owner.js like the other owner-*.js modules, and depends on it for
 * ownerEscape.
 *
 * Two controls that belong together:
 *
 *   1. The page's own introduction, shown before anybody is picked and hidden
 *      the moment somebody is. Stored in tier_page_settings, a singleton.
 *   2. Who has a tier list. Assigning one also grants trusted_editor, because
 *      those are one decision - the owner picked somebody to write on the wiki
 *      under their own name - and leaving the role to a second manual step is
 *      how a new author ends up assigned but unable to do anything.
 *
 * The role is granted, never downgraded: an admin or reviewer who gets a list
 * keeps what they had. A 'viewer' is refused outright by the RPC, because
 * viewer is the soft ban and handing a banned account a public platform is a
 * contradiction far more likely to be a mistyped email.
 *
 * The introduction reuses initStrategyBlockBuilder, which keeps a single
 * module-level buffer - so this page must never open a second block editor
 * beside it.
 */

let tierPageIntroLoaded = false;

function tierListEscape(value) {
    return window.ownerEscape ? window.ownerEscape(value) : String(value == null ? '' : value);
}

function tierToolSay(containerId, message, isError) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = isError
        ? `<span class="admin-error-text">${tierListEscape(message)}</span>`
        : `<span class="owner-success-text">${tierListEscape(message)}</span>`;
}

// The normal state between writing a migration and the release that applies
// it, said plainly rather than as a raw error.
function tierNotDeployed(error) {
    return error && (error.code === 'PGRST202' || error.code === 'PGRST205'
        || /schema cache/i.test(error.message || ''));
}

// --- THE PAGE INTRODUCTION ---

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

    // The buffer only reaches a caller when read out - the same flush every
    // other editor surface does before it writes.
    const blocks = typeof window.getActiveBlocks === 'function'
        ? JSON.parse(JSON.stringify(window.getActiveBlocks()))
        : [];

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

// --- WHO HAS A TIER LIST ---

window.loadTierListRoster = async function () {
    const container = document.getElementById('tier-assign-roster');
    if (!container || !window.supabaseClient) return;

    const { data, error } = await window.supabaseClient.rpc('list_tier_lists');

    if (error) {
        container.innerHTML = tierNotDeployed(error)
            ? `<p class="admin-error-text">Tier list assignments arrive with the next release.</p>`
            : `<p class="admin-error-text">Could not load: ${tierListEscape(error.message)}</p>`;
        return;
    }

    if (!data || !data.length) {
        container.innerHTML = `<p class="admin-queue-empty-msg">Nobody has a tier list yet.</p>`;
        return;
    }

    // Built with escaping at every interpolation: author names and emails are
    // account-supplied, and this renders in an admin's authenticated session.
    container.innerHTML = data.map(row => `
        <div class="personnel-row">
            <div class="personnel-row-main">
                <span class="update-badge">${tierListEscape(row.status)}</span>
                <span class="personnel-email">${tierListEscape(row.author_name)}
                    <span class="personnel-self">${tierListEscape(row.email || 'no account')}</span>
                </span>
            </div>
            <div class="personnel-row-actions">
                <a class="btn-sys btn-sys-regular" href="tier-editor.html?list=${encodeURIComponent(row.slug)}">OPEN</a>
                <a class="btn-sys btn-sys-regular" href="systems/tierlist/index.html?list=${encodeURIComponent(row.slug)}">VIEW</a>
            </div>
        </div>`).join('');
};

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

document.addEventListener('DOMContentLoaded', () => {
    const save = document.getElementById('btn-save-tier-page-intro');
    if (save) save.addEventListener('click', saveTierPageIntro);

    const assign = document.getElementById('btn-assign-tier-list');
    if (assign) assign.addEventListener('click', assignTierList);

    // Loaded when the group is first opened rather than at boot: the block
    // editor is heavy, and the whole point of the owner-group split is that a
    // panel nobody opens costs nothing.
    const nav = document.getElementById('owner-nav');
    if (nav) {
        nav.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-group="tierlists"]');
            if (!btn) return;
            if (!tierPageIntroLoaded) window.loadTierPageIntro();
            window.loadTierListRoster();
        });
    }
});
