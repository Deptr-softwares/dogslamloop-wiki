/**
 * Dogslamloop Wiki - Owner Tools: Staff Perks
 *
 * Split from owner.js for the same reason the other owner-*.js modules were,
 * and depends on it for ownerEscape and contentNotDeployedMessage.
 *
 * One switch so far: whether Trusted Editors, Reviewers and Admins skip the
 * 3-minute submission cooldown. The owner asked for a toggle rather than a
 * constant, so it can be pulled without a migration if a staff account is
 * ever compromised.
 *
 * Worth being clear about what this toggle is: it flips a row that
 * check_revision_rate_limit() reads on every insert
 * (supabase/migrations/20260810000000_staff_cooldown_perk.sql), so it changes
 * what the *database* enforces. js/editor-core.js reads the same row purely to
 * decide which message to show. That is the opposite direction from most of
 * this page, where the database holds content and the site renders it.
 */

async function loadStaffPerks() {
    const box = document.getElementById('perk-cooldown-bypass');
    const results = document.getElementById('staff-perks-results');
    if (!box || !results) return;

    const { data, error } = await window.supabaseClient
        .from('site_settings').select('staff_bypass_submission_cooldown').maybeSingle();

    if (error) {
        box.disabled = true;
        results.innerHTML = contentNotDeployedMessage(error, 'Staff perk');
        return;
    }

    box.disabled = false;
    // No row is the same as off, matching the trigger's own COALESCE.
    box.checked = data?.staff_bypass_submission_cooldown === true;
    results.innerHTML = '';
}

async function saveStaffPerk(enabled) {
    const box = document.getElementById('perk-cooldown-bypass');
    const results = document.getElementById('staff-perks-results');
    if (!results) return;

    results.innerHTML = `<p class="loading-msg">Saving...</p>`;

    // Upsert on the singleton id rather than update, so a missing row is
    // created instead of silently matching nothing and reporting success.
    const { error } = await window.supabaseClient
        .from('site_settings')
        .upsert([{ id: true, staff_bypass_submission_cooldown: enabled, updated_at: new Date().toISOString() }], { onConflict: 'id' });

    if (error) {
        // Put the checkbox back where it was: leaving it showing a state the
        // database rejected is how someone ends up believing a limit is off
        // when it is on.
        if (box) box.checked = !enabled;
        results.innerHTML = `<p class="admin-error-text">Could not save: ${ownerEscape(error.message)}</p>`;
        return;
    }

    results.innerHTML = enabled
        ? '<span class="owner-success-text">Saved. Staff can submit without waiting; everyone else still waits 3 minutes.</span>'
        : '<span class="owner-success-text">Saved. The 3-minute cooldown now applies to everyone, staff included.</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('perk-cooldown-bypass');
    if (box) box.addEventListener('change', () => saveStaffPerk(box.checked));
});

window.loadStaffPerks = loadStaffPerks;
window.saveStaffPerk = saveStaffPerk;
