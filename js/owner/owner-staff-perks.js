/**
 * Staff Perks: whether trusted editors, reviewers and admins skip the submission
 * cooldown. A switch rather than a constant, so it can be turned off without a
 * migration.
 * @since v0.12
 * @touches site_settings.staff_bypass_submission_cooldown, contentNotDeployedMessage
 *   (owner.js)
 * @watch the database enforces it: check_revision_rate_limit() reads this row on
 *   every submission. The editor reads it only to choose its message.
 * @see docs/owner-tools.md
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
    // No row is off, as the trigger's own COALESCE reads it.
    box.checked = data?.staff_bypass_submission_cooldown === true;
    results.innerHTML = '';
}

async function saveStaffPerk(enabled) {
    const box = document.getElementById('perk-cooldown-bypass');
    const results = document.getElementById('staff-perks-results');
    if (!results) return;

    results.innerHTML = `<p class="loading-msg loading-msg-busy">Saving...</p>`;

    // An upsert, so a missing row is made rather than silently matching nothing.
    const { error } = await window.supabaseClient
        .from('site_settings')
        .upsert([{ id: true, staff_bypass_submission_cooldown: enabled, updated_at: new Date().toISOString() }], { onConflict: 'id' });

    if (error) {
        // Back to what the database holds, so nobody believes a limit is off when it is on.
        if (box) box.checked = !enabled;
        results.innerHTML = `<p class="admin-error-text">Could not save: ${window.escapeHtml(error.message)}</p>`;
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
