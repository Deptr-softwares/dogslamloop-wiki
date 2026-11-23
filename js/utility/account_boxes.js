/**
 * The account boxes a reader opens: their own profile (name, bio, flair, password,
 * signing out), another reader's public profile, and the inbox. Loaded the first time
 * one opens, by openAuthModal, openPublicProfile and openNotificationModal in
 * site_account.js, which stay on every page.
 * @since v0.4, as part of site_utils.js
 * @touches Supabase Auth (the name, the password, signing out), user_profiles (bio,
 *   flair, badges), user_roles, user_notifications, get_public_profiles,
 *   get_user_expert_pages, the badges and role badges (site_account.js)
 * @watch a public profile shows another person's words: every field goes in as text
 * @see docs/shared-code.md
 */

/** Adds the profile and public profile boxes to the page, once. */
window.injectAccountBoxes = function () {
    if (document.getElementById('profile-modal-overlay')) return;
    window.injectAuthModal();

    const profileModalHTML = `
    <div id="profile-modal-overlay" class="modal-overlay hidden">
        <div class="modal-box modal-lg accent-purple">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>SYSTEM PROFILE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body">
                <div class="profile-identity">
                    <span id="profile-standing-icon" class="profile-standing-icon"></span>
                    <div class="profile-identity-text">
                        <strong id="profile-current-name"></strong>
                        <span id="profile-standing-label" class="profile-standing-label"></span>
                    </div>
                </div>

                <div class="profile-field">
                    <label for="profile-new-name">DISPLAY NAME</label>
                    <input type="text" id="profile-new-name" class="editor-input" maxlength="32" placeholder="Enter custom display name...">
                </div>

                <div class="profile-field">
                    <label for="profile-flair">FLAIR <span id="profile-flair-count" class="profile-count"></span></label>
                    <input type="text" id="profile-flair" class="editor-input" maxlength="32" placeholder="Vessel main, boomcat...">
                    <p class="profile-hint">Shown beside your name wherever you post.</p>
                </div>

                <div class="profile-field hidden" id="profile-badges-field" role="group" aria-labelledby="profile-badges-title">
                    <span class="profile-field-title" id="profile-badges-title">BADGES</span>
                    <div id="profile-badges-list" class="profile-badges"></div>
                </div>

                <div class="profile-field">
                    <label for="profile-bio">ABOUT YOU <span id="profile-bio-count" class="profile-count"></span></label>
                    <textarea id="profile-bio" class="editor-input profile-bio" maxlength="500" rows="4" placeholder="Describe yourself here and such"></textarea>
                </div>

                <div class="profile-field">
                    <label class="profile-toggle" for="profile-private">
                        <input type="checkbox" id="profile-private">
                        <span>Keep my description private</span>
                    </label>
                </div>

                <div class="profile-field hidden" id="profile-password-field">
                    <label for="profile-new-password">CHANGE PASSWORD</label>
                    <div class="profile-inline-row">
                        <input type="password" id="profile-new-password" class="editor-input" placeholder="New password..." autocomplete="new-password">
                        <button id="btn-profile-password" class="btn-sys btn-sys-regular" type="button">UPDATE</button>
                    </div>
                </div>
                <p class="profile-hint hidden" id="profile-oauth-note"></p>

                <p class="profile-feedback hidden" id="profile-feedback"></p>
            </div>
            <div class="modal-footer" style="justify-content: space-between;">
                <button id="btn-profile-logout" class="btn-sys btn-sys-red">LOGOUT</button>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-sys btn-sys-regular" onclick="document.getElementById('profile-modal-overlay').classList.add('hidden')">CANCEL</button>
                    <button id="btn-profile-save" class="btn-sys btn-sys-purple">SAVE CHANGES</button>
                </div>
            </div>
        </div>
    </div>`;

    // Somebody else's profile, read-only, opened by clicking a name: its own overlay,
    // not a mode of the profile form (which is bound to the signed-in user and has
    // LOGOUT). It borrows .profile-identity, so a person looks the same either way.
    // tier-priority, so it opens over a discussion thread's own modals.
    const publicProfileHTML = `
    <div id="public-profile-overlay" class="modal-overlay tier-priority hidden">
        <div class="modal-box modal-sm accent-blue">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>PROFILE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body">
                <div class="profile-identity" id="pubprofile-identity">
                    <span id="pubprofile-icon" class="profile-standing-icon"></span>
                    <div class="profile-identity-text">
                        <strong id="pubprofile-name"></strong>
                        <span id="pubprofile-standing" class="profile-standing-label"></span>
                    </div>
                </div>
                <p id="pubprofile-flair" class="pubprofile-flair hidden"></p>
                <div id="pubprofile-badges" class="pubprofile-badges hidden">
                    <span class="pubprofile-badges-label" id="pubprofile-badges-title">Badges</span>
                    <ul id="pubprofile-badges-list" class="pubprofile-badges-list" aria-labelledby="pubprofile-badges-title"></ul>
                </div>
                <div id="pubprofile-expertise" class="pubprofile-expertise hidden">
                    <span class="pubprofile-expertise-label">Expert of</span>
                    <span id="pubprofile-expertise-pages"></span>
                </div>
                <p id="pubprofile-bio" class="pubprofile-bio"></p>
                <p id="pubprofile-joined" class="profile-hint"></p>
            </div>
            <div class="modal-footer centered-actions">
                <button class="btn-sys btn-sys-regular" style="width: 100%;" onclick="document.getElementById('public-profile-overlay').classList.add('hidden')">CLOSE</button>
            </div>
        </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = profileModalHTML + publicProfileHTML;
    while (div.firstChild) document.body.appendChild(div.firstChild);

    const btnLogout = document.getElementById('btn-profile-logout');
    const btnSave = document.getElementById('btn-profile-save');

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            document.getElementById('profile-modal-overlay').classList.add('hidden');
            await window.supabaseClient.auth.signOut();
            location.reload(); 
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const newName = document.getElementById('profile-new-name').value.trim();
            const currentName = document.getElementById('profile-current-name').textContent;
            const bio = document.getElementById('profile-bio').value.trim();
            // The database refuses a newline in a flair; this covers any path into the field
            // that a text input does not already strip.
            const flair = document.getElementById('profile-flair').value.replace(/[\r\n]+/g, ' ').trim();
            const isPrivate = document.getElementById('profile-private').checked;

            if (newName.length > window.DISPLAY_NAME_MAX) {
                window.setProfileFeedback(
                    `Display names are limited to ${window.DISPLAY_NAME_MAX} characters.`, false);
                return;
            }

            btnSave.textContent = "SAVING..."; btnSave.disabled = true;
            const problems = [];

            // The display name lives in auth metadata, not user_profiles, so there is no second
            // copy to keep in step.
            if (newName && newName !== currentName) {
                const { error } = await window.supabaseClient.auth.updateUser({ data: { display_name: newName } });
                if (error) problems.push("display name: " + error.message);
            }

            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (session) {
                const profileRow = {
                    user_id: session.user.id,
                    bio: bio || null,
                    flair: flair || null,
                    is_private: isPrivate
                };
                // Hidden badges are sent only once the loaded row is known to have the column, or
                // the whole save fails on a database without it.
                const badgesField = document.getElementById('profile-badges-field');
                const withBadges = !!badgesField && badgesField.dataset.ready === 'true';
                if (withBadges) {
                    let keep = [];
                    try { keep = JSON.parse(badgesField.dataset.keepHidden || '[]'); } catch (e) { keep = []; }
                    profileRow.hidden_badges = keep.concat(
                        [...badgesField.querySelectorAll('input[data-badge-id]')]
                            .filter(box => !box.checked).map(box => box.dataset.badgeId));
                }

                // upsert: the row is made on first save, since there is no trigger on auth.users. A
                // row with badges is UPDATEd, because an upsert cannot carry hidden_badges.
                const { error } = withBadges
                    ? await window.supabaseClient
                        .from('user_profiles')
                        .update(profileRow)
                        .eq('user_id', session.user.id)
                    : await window.supabaseClient
                        .from('user_profiles')
                        .upsert(profileRow, { onConflict: 'user_id' });

                if (error) {
                    // 42501 is RLS refusing the row, which for this table has one cause; saying so beats
                    // a Postgres string.
                    problems.push(error.code === '42501'
                        ? "your account cannot post content on the site at the moment"
                        : "profile: " + error.message);
                }
            }

            btnSave.disabled = false; btnSave.textContent = "SAVE CHANGES";

            if (problems.length) {
                window.setProfileFeedback("Could not save. " + problems.join("; ") + ".", false);
                return;
            }
            document.getElementById('profile-modal-overlay').classList.add('hidden');
            window.checkActiveSession();
        });
    }

    // Changing the password has its own button and confirmation: it cannot be undone by
    // editing a field again.
    const btnPassword = document.getElementById('btn-profile-password');
    if (btnPassword) {
        btnPassword.addEventListener('click', async () => {
            const input = document.getElementById('profile-new-password');
            const next = input.value;
            if (!next) { window.setProfileFeedback("Enter a new password first.", false); return; }
            if (next.length < 6) { window.setProfileFeedback("Passwords need at least 6 characters.", false); return; }

            btnPassword.textContent = "..."; btnPassword.disabled = true;
            const { error } = await window.supabaseClient.auth.updateUser({ password: next });
            btnPassword.disabled = false; btnPassword.textContent = "UPDATE";

            if (error) { window.setProfileFeedback("Could not change password: " + error.message, false); return; }
            input.value = '';
            window.setProfileFeedback("Password updated.", true);
        });
    }

    // Live character counts. The caps are CHECK constraints too: maxlength is a
    // courtesy, PostgREST is the real door.
    const bindCount = (fieldId, countId, max) => {
        const field = document.getElementById(fieldId);
        const out = document.getElementById(countId);
        if (!field || !out) return;
        const paint = () => {
            out.textContent = `${field.value.length}/${max}`;
            out.classList.toggle('profile-count-full', field.value.length >= max);
        };
        field.addEventListener('input', paint);
        paint();
    };
    bindCount('profile-bio', 'profile-bio-count', 500);
    bindCount('profile-flair', 'profile-flair-count', 32);
};

/** One line of feedback inside the profile modal, never alert(). */
window.setProfileFeedback = function (message, ok) {
    const el = document.getElementById('profile-feedback');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    el.classList.toggle('profile-feedback-bad', !!message && !ok);
    el.classList.toggle('profile-feedback-ok', !!message && !!ok);
};

/**
 * Fills the profile modal with what is stored, every time it opens: the role can
 * change under the reader (the owner assigns them from another tab).
 */
window.hydrateProfileModal = async function (session) {
    if (!session || !window.supabaseClient) return;

    let role = 'member';
    try {
        const { data } = await window.supabaseClient
            .from('user_roles').select('*').eq('user_id', session.user.id).single();
        if (data && data.role) role = data.role;
    } catch (e) {
        // Having no role row is the normal state for most accounts, not an error.
    }

    const badge = window.roleBadge(role);
    const iconEl = document.getElementById('profile-standing-icon');
    const labelEl = document.getElementById('profile-standing-label');
    if (iconEl) {
        // Built from the fixed ROLE_BADGES table; nothing here is user text.
        iconEl.innerHTML = window.roleIconHTML(role, 'profile-role-icon');
        iconEl.className = `profile-standing-icon profile-standing-${badge.color}`;
    }
    if (labelEl) labelEl.textContent = badge.label;

    const bioEl = document.getElementById('profile-bio');
    const flairEl = document.getElementById('profile-flair');
    const privEl = document.getElementById('profile-private');
    let row = null;
    try {
        const { data } = await window.supabaseClient
            .from('user_profiles').select('*').eq('user_id', session.user.id).single();
        row = data;
    } catch (e) {
        // No row yet is the normal state: user_profiles has no signup trigger,
        // so a profile exists only once it has been saved once. Empty fields,
        // not an error message.
    }
    if (bioEl) bioEl.value = (row && row.bio) || '';
    if (flairEl) flairEl.value = (row && row.flair) || '';
    if (privEl) privEl.checked = !!(row && row.is_private);
    // Repaint the counters against what was just loaded.
    [bioEl, flairEl].forEach(el => el && el.dispatchEvent(new Event('input')));

    // Every badge they hold, each with SHOW, so a person picks which to show.
    const badgesField = document.getElementById('profile-badges-field');
    const badgesList = document.getElementById('profile-badges-list');
    if (badgesField && badgesList) {
        badgesList.textContent = '';
        // Before the release the columns do not exist: the field stays hidden,
        // and the save sends nothing about badges.
        const ready = !!row && Array.isArray(row.badges);
        const held = ready ? window.knownBadges(row.badges) : [];
        const hidden = ready && Array.isArray(row.hidden_badges) ? row.hidden_badges : [];
        badgesField.dataset.ready = String(ready);
        // A hidden badge this page cannot draw (a newer one) stays hidden.
        badgesField.dataset.keepHidden = JSON.stringify(hidden.filter(id => !held.includes(id)));
        badgesField.classList.toggle('hidden', !held.length);
        held.forEach(id => {
            const rowEl = document.createElement('label');
            rowEl.className = 'profile-badge-row';
            rowEl.appendChild(window.badgeSlot(id, { size: 'medium' }));
            rowEl.appendChild(window.badgeWords(id));
            const show = document.createElement('span');
            show.className = 'profile-badge-show';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.dataset.badgeId = id;
            box.checked = !hidden.includes(id);
            show.append(box, 'SHOW');
            rowEl.appendChild(show);
            badgesList.appendChild(rowEl);
        });
    }

    // A password only for accounts that have one: Discord and Google accounts have
    // none here. identities[] is the reliable source; app_metadata.provider names only
    // the latest sign-in.
    const identities = session.user.identities || [];
    const hasPassword = identities.length
        ? identities.some(i => i.provider === 'email')
        : (session.user.app_metadata || {}).provider === 'email';

    const pwField = document.getElementById('profile-password-field');
    const oauthNote = document.getElementById('profile-oauth-note');
    if (pwField) pwField.classList.toggle('hidden', !hasPassword);
    if (oauthNote) {
        oauthNote.classList.toggle('hidden', hasPassword);
        if (!hasPassword) {
            // "You sign in with discord" reads as a typo. These are brand names.
            const names = identities.map(i => i.provider).filter(Boolean)
                .map(p => p.charAt(0).toUpperCase() + p.slice(1));
            oauthNote.textContent = `You sign in with ${names.length ? names.join(' and ') : 'an external provider'}, so your password is managed there.`;
        }
    }
};

/** The signed-in reader's own profile box, filled and opened. */
window.showProfileBox = async function (session) {
    window.injectAccountBoxes();
    const username = window.getDisplayName(session);
    document.getElementById('profile-current-name').textContent = username;

    const nameInput = document.getElementById('profile-new-name');
    nameInput.value = username;

    window.setProfileFeedback('', true);
    await window.hydrateProfileModal(session);

    document.getElementById('profile-modal-overlay').classList.remove('hidden');
    nameInput.focus();

    // Always opened at the top: the header sits outside the scrolling body, and the
    // identity strip under it (the name and standing) must never need scrolling to.
    // Unconditional, since focus, zoom and the open animation can each move it.
    document.querySelector('#profile-modal-overlay .modal-body').scrollTop = 0;
};

window.showPublicProfile = async function (userId) {
    if (!userId) return;
    window.injectAccountBoxes();
    const overlay = document.getElementById('public-profile-overlay');
    if (!overlay) return;

    const nameEl = document.getElementById('pubprofile-name');
    const standingEl = document.getElementById('pubprofile-standing');
    const iconEl = document.getElementById('pubprofile-icon');
    const flairEl = document.getElementById('pubprofile-flair');
    const badgesEl = document.getElementById('pubprofile-badges');
    const badgesList = document.getElementById('pubprofile-badges-list');
    const bioEl = document.getElementById('pubprofile-bio');
    const joinedEl = document.getElementById('pubprofile-joined');

    // Opened on the click, not after the request: a modal that appears half a second
    // later reads as a dead button and gets clicked again.
    nameEl.textContent = 'Loading...';
    standingEl.textContent = '';
    iconEl.innerHTML = '';
    iconEl.className = 'profile-standing-icon';
    flairEl.classList.add('hidden');
    badgesEl.classList.add('hidden');
    badgesList.textContent = '';
    bioEl.textContent = '';
    joinedEl.textContent = '';
    overlay.classList.remove('hidden');

    // Clicking a second name before the first resolves must not have the first
    // response overwrite the second.
    const token = (window.__pubProfileToken = (window.__pubProfileToken || 0) + 1);
    const p = (await window.fetchPublicProfiles([userId])).get(userId);
    if (token !== window.__pubProfileToken) return;

    if (!p) {
        nameEl.textContent = 'Unknown';
        bioEl.textContent = 'This account no longer exists.';
        return;
    }

    nameEl.textContent = p.display_name || 'Anonymous';

    const standing = p.standing || 'member';
    const badge = window.roleBadge(standing);
    iconEl.innerHTML = window.roleIconHTML(standing, 'profile-role-icon');
    iconEl.className = `profile-standing-icon profile-standing-${badge.color}`;
    standingEl.textContent = badge.label;

    // textContent throughout: a flair and a bio are contributor-written text,
    // and this modal is reachable from any thread on the site.
    if (p.flair) {
        flairEl.textContent = p.flair;
        flairEl.classList.remove('hidden');
    }

    // The badges they show, named, with how each was earned. Hidden ones never leave the
    // database.
    const shown = window.knownBadges(p.badges);
    shown.forEach(id => {
        const item = document.createElement('li');
        item.className = 'pubprofile-badge';
        item.append(window.badgeSlot(id, { size: 'medium' }), window.badgeWords(id));
        badgesList.appendChild(item);
    });
    badgesEl.classList.toggle('hidden', !shown.length);

    // A private description is said to exist rather than shown as a blank. The bio never
    // left the database: get_public_profiles nulls it.
    bioEl.textContent = p.bio || (p.is_private
        ? 'This description is private.'
        : 'No description yet.');
    bioEl.classList.toggle('pubprofile-bio-empty', !p.bio);

    if (p.joined_at) {
        const d = new Date(p.joined_at);
        joinedEl.textContent = isNaN(d.getTime()) ? ''
            : `Joined ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}`;
    }

    // Expertise last and on its own: a second request, so a failure costs a line, not
    // the modal.
    const expertiseEl = document.getElementById('pubprofile-expertise');
    const pagesEl = document.getElementById('pubprofile-expertise-pages');
    if (!expertiseEl || !pagesEl) return;
    expertiseEl.classList.add('hidden');
    pagesEl.textContent = '';

    try {
        const { data, error } = await window.supabaseClient
            .rpc('get_user_expert_pages', { target_user_id: userId });
        if (token !== window.__pubProfileToken) return;
        if (error || !Array.isArray(data) || !data.length) return;

        // Page names, not ids: "crow_charmer" is not what the page is called anywhere a
        // reader looks.
        pagesEl.textContent = data.map(r => r.page_name || r.page_id).join(' · ');
        expertiseEl.classList.remove('hidden');
    } catch (e) {
        // Hidden, as for somebody who is an expert of nothing.
    }
};

window.initNotifications = async function() {
    if (!window.supabaseClient) return;
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) return; 

    const { data: notifs, error } = await window.supabaseClient
        .from('user_notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(15); 

    if (error) { console.error("Inbox Error:", error); return; }

    let modal = document.getElementById('site-notification-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-notification-modal';
        modal.className = 'modal-overlay hidden';
        document.body.appendChild(modal);
    }

    let notifHTML = notifs.length === 0 
        ? `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted); font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`
        : notifs.map(n => `
            <div class="notif-item ${n.is_read ? 'read' : 'unread'}" id="notif-row-${window.escapeHtml(n.id)}"
                 data-notif-id="${window.escapeHtml(n.id)}" data-notif-link="${window.escapeHtml(n.link || '')}"
                 style="padding: 1rem 1.5rem; border-bottom: 1px dashed var(--border-color); background: ${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}; cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden;"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                 onmouseout="this.style.background='${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}'">

                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.65rem; color: ${n.is_read ? 'var(--text-muted)' : 'var(--accent-blue)'}; font-family: var(--text-mono);">${new Date(n.created_at).toLocaleDateString()}</span>

                    <div style="display: flex; gap: 0.75rem; align-items: center;">
                        ${!n.is_read ? `<span id="notif-dot-${window.escapeHtml(n.id)}" class="status-dot online" style="background: var(--accent-blue); color: var(--accent-blue); width: 8px; height: 8px;"></span>` : ''}
                        <button data-notif-delete="${window.escapeHtml(n.id)}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:0; display:flex; transition:color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted)'" title="Delete">
                            ${window.uiIconHTML('delete')}
                        </button>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.85rem; color: ${n.is_read ? 'var(--text-primary)' : 'var(--text-white)'}; line-height: 1.5; padding-right: 1rem;">${window.escapeHtml(n.message)}</p>
            </div>
        `).join('');

    modal.innerHTML = `
        <div class="modal-box modal-md accent-blue">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <h3>SYSTEM INBOX</h3>
                    ${notifs.length > 0 ? `<button onclick="clearAllNotifications()" style="background: none; border: none; color: #ef4444; font-size: 0.65rem; font-family: var(--text-mono); cursor: pointer; text-decoration: underline; opacity: 0.8;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">CLEAR ALL</button>` : ''}
                </div>
            </div>
            <div class="modal-body" style="padding: 0; overflow-x: hidden;">
                ${notifHTML}
            </div>
            <div class="modal-footer">
                <button class="btn-sys btn-sys-regular" onclick="document.getElementById('site-notification-modal').classList.add('hidden')">CLOSE</button>
            </div>
        </div>
    `;

    // Delegated, not inline: the row id and link are stored values, and an onclick=""
    // built from them is an injection surface escaping does not close (the browser
    // unescapes it before the JS parser sees it).
    modal.onclick = (event) => {
        const deleteBtn = event.target.closest('[data-notif-delete]');
        if (deleteBtn) {
            window.deleteNotification(deleteBtn.getAttribute('data-notif-delete'), event);
            return;
        }
        const row = event.target.closest('[data-notif-id]');
        if (row) {
            window.markNotifRead(row.getAttribute('data-notif-id'), row.getAttribute('data-notif-link'));
        }
    };
};

window.showInbox = async function() {
    if (typeof window.initNotifications === 'function') {
        await window.initNotifications();
    }
    const modal = document.getElementById('site-notification-modal');
    if (modal) modal.classList.remove('hidden');
};

window.markNotifRead = async function(id, link) {
    const row = document.getElementById(`notif-row-${id}`);
    const dot = document.getElementById(`notif-dot-${id}`);
    
    if (row) {
        row.style.background = 'transparent';
        row.classList.remove('unread');
        row.classList.add('read');
    }
    if (dot) dot.classList.add('hidden');

    if (window.supabaseClient) {
        window.supabaseClient.from('user_notifications').update({ is_read: true }).eq('id', id).then(() => {
            // The bell's count, again.
            window.checkActiveSession();
        });
    }
    
    // Links are stored root-relative (buildPageUrl): resolved against this page's root.
    if (link && link !== 'null' && link !== '') {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
        window.location.href = rootPath + link;
    }
};

window.deleteNotification = async function(id, event) {
    // Or the row's own click marks it read.
    event.stopPropagation(); 
    
    const row = document.getElementById(`notif-row-${id}`);
    if (row) {
        row.style.height = row.offsetHeight + 'px';
        row.offsetHeight;
        row.style.padding = '0px';
        row.style.height = '0px';
        row.style.opacity = '0';
        row.style.border = 'none';
        setTimeout(() => row.remove(), 200);
    }

    if (window.supabaseClient) {
        await window.supabaseClient.from('user_notifications').delete().eq('id', id);
        
        // The bell's count, again.
        window.checkActiveSession(); 
    }
};

window.clearAllNotifications = async function() {
    const ok = await window.siteConfirm(
        'This clears your entire inbox. Notifications cannot be brought back.',
        { title: 'CLEAR ALL NOTIFICATIONS', confirmText: 'CLEAR ALL' });
    if (!ok) return;


    const body = document.querySelector('#site-notification-modal .modal-body');
    const clearBtn = document.querySelector('#site-notification-modal button[onclick="clearAllNotifications()"]');
    
    if (body) {
        body.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: #555; font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`;
    }
    if (clearBtn) clearBtn.remove();

    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            await window.supabaseClient.from('user_notifications').delete().eq('user_id', session.user.id);
            window.checkActiveSession(); 
        }
    }
};
