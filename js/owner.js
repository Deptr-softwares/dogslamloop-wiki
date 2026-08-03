/**
 * Dogslamloop Wiki - Owner Tools (Personnel Management, Media Garbage Collection)
 *
 * Split out of admin.js as part of the admin-page rework: these two tools
 * are admin-only and unrelated to the reviewer workflow admin.html/admin.js
 * are scoped to. Access here is admin-only, not admin/reviewer like
 * admin.html - kickUser/the RBAC-gate shape is intentionally duplicated
 * from admin.js rather than shared, matching this codebase's existing
 * precedent of small per-file duplication over new cross-file coupling
 * (see admin.js's own toggleMobilePreview, reimplemented rather than
 * pulling in editor.js for one function).
 */

// --- BFCACHE GUARD ---
// Same fix as admin.js's own bfcache guard (see that file's comment for
// the full incident writeup) - this page shares the identical RBAC-gate
// shape and is just as vulnerable to a stale back-forward-cache snapshot
// skipping the auth check entirely on back/forward navigation.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});

// --- RBAC GATEKEEPER (admin only) ---
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) { kickUser(); return; }

    const { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);

    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];

    if (error || !roles.includes('admin')) { kickUser(); return; }
});

function kickUser() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
}

// --- CUSTOM MODAL PROMISE (same contract as admin.js's adminConfirm) ---
window.adminConfirm = function(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('admin-confirm-modal');
        document.getElementById('admin-confirm-msg').textContent = message;
        modal.classList.remove('hidden');

        const btnOk = document.getElementById('btn-admin-confirm-ok');
        const btnCancel = document.getElementById('btn-admin-confirm-cancel');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
};

// --- PERSONNEL MANAGEMENT ---
// assign_role_by_email() is a "set role" RPC (supabase/migrations/
// 20260801000000_role_model_fix.sql, applied 2026-08-01): it unconditionally
// clears the target's existing role, then assigns the new one - so a user
// can only ever hold one role at a time, matching the UNIQUE(user_id)
// constraint the same migration added. An empty target-role value means
// "clear all roles" - passed through as SQL NULL, not the string 'guest'
// the old (always-broken, since 'guest' was never a legal role value)
// dropdown option used to send.
async function changeUserRole() {
    const email = document.getElementById('target-email').value.trim();
    const newRole = document.getElementById('target-role').value || null;
    const results = document.getElementById('role-results');

    if (!email) { results.innerHTML = "<span style='color:#ef4444'>Please enter an email address.</span>"; return; }
    const roleLabel = newRole ? newRole.toUpperCase() : 'REVOKE ALL ACCESS';
    if (!(await adminConfirm(`Are you sure you want to change ${email}'s clearance to ${roleLabel}?`))) return;

    results.innerHTML = "Processing override...";

    const { data, error } = await window.supabaseClient.rpc('assign_role_by_email', { target_email: email, assigned_role: newRole });

    if (error) {
        results.innerHTML = `<span style='color:#ef4444'>Error: ${error.message}</span>`;
    } else {
        results.innerHTML = `<span style='color:#22c55e'>${data}</span>`;
        document.getElementById('target-email').value = '';
    }
}

// --- MEDIA GARBAGE COLLECTION ---
async function runGarbageCollector() {
    const btn = document.getElementById('btn-run-gc');
    const results = document.getElementById('gc-results');

    if(!(await adminConfirm("SYSTEM WARNING: Scan and permanently delete any unlinked cloud files?"))) return;

    btn.textContent = "SCANNING..."; btn.disabled = true;
    results.innerHTML = "Fetching files from cloud storage...<br>";

    try {
        const { data: storageFiles, error: storageErr } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
        if (storageErr) throw storageErr;

        const actualFiles = storageFiles.filter(f => !f.name.startsWith('.'));
        if (actualFiles.length === 0) {
            results.innerHTML += "<span style='color:#22c55e'>Bucket is empty. Clean.</span>";
            btn.textContent = "SCAN & PURGE MEDIA"; btn.disabled = false;
            return;
        }

        results.innerHTML += "Analyzing Live, Pending, and History data...<br>";

        // Fetch as raw text using Supabase text casting to prevent massive JSON object parsing
        const [ {data: liveData}, {data: pendingData}, {data: historyData} ] = await Promise.all([
            window.supabaseClient.from('page_data').select('desc_data::text, frame_data::text'),
            window.supabaseClient.from('pending_revisions').select('desc_data::text, frame_data::text, delta_payload::text'),
            window.supabaseClient.from('page_history').select('desc_data::text, frame_data::text')
        ]);

        // Safely extract and concatenate without triggering JSON.stringify Memory Leaks
        let massiveDataString = "";

        (liveData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || ''); });
        (pendingData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || '') + (row.delta_payload || ''); });
        (historyData || []).forEach(row => { massiveDataString += (row.desc_data || '') + (row.frame_data || ''); });

        const orphanedFiles = actualFiles.filter(file => {
            const rawName = file.name;
            const encodedURI = encodeURI(rawName);
            const encodedComponent = encodeURIComponent(rawName);
            const spaceEncoded = rawName.replace(/ /g, '%20');

            return !massiveDataString.includes(rawName) &&
                   !massiveDataString.includes(encodedURI) &&
                   !massiveDataString.includes(encodedComponent) &&
                   !massiveDataString.includes(spaceEncoded);
        });

        if (orphanedFiles.length === 0) {
            results.innerHTML += "<span style='color:#22c55e'>All files actively linked.</span>";
        } else {
            const fileNamesToDelete = orphanedFiles.map(f => f.name);
            const { error: delErr } = await window.supabaseClient.storage.from('wiki-media').remove(fileNamesToDelete);
            if (delErr) throw delErr;
            results.innerHTML += `<span style='color:#22c55e'>Deleted ${orphanedFiles.length} orphaned files.</span>`;
        }
    } catch (err) {
        results.innerHTML += `<span style='color:#ef4444'>Error: ${err.message}</span>`;
    }
    btn.textContent = "SCAN & PURGE MEDIA"; btn.disabled = false;
}
