/**
 * Accounts: signing in and registering, the profile modal, other people's
 * profiles, badges, role badges and the notification inbox. Loads last of the
 * four parts, so its session check runs after site_utils.js's.
 * @since v0.3, as part of site_utils.js
 * @touches Supabase Auth (user_metadata.display_name), user_profiles (bio, flair,
 *   badges), user_roles, user_notifications, claim_badge, get_public_profiles,
 *   get_user_expert_pages, localStorage dsl_badges_pending
 * @watch SITE_BADGES and claim_badge() in SQL list the same badges: change them
 *   together
 * @see docs/shared-code.md
 */

window.injectAuthModal = function() {
    if (document.getElementById('auth-modal-overlay')) return;

    const authModalHTML = `
    <div id="auth-modal-overlay" class="modal-overlay hidden">
        <div class="modal-box modal-sm accent-blue">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: none; padding-bottom: 0;">
                <h3>SYSTEM ACCESS</h3>
                <span id="auth-status-indicator" class="status-dot offline"></span>
            </div>
            
            <div class="auth-tabs" style="display: flex; border-bottom: 2px solid var(--border-color); margin-bottom: 1.5rem; padding: 0 1.5rem;">
                <button id="auth-tab-login" class="btn-ghost active" style="flex: 1; border-bottom: none; opacity: 1; border-radius: 0; padding: 1rem 0;">LOGIN</button>
                <button id="auth-tab-register" class="btn-ghost" style="flex: 1; border-bottom: none; opacity: 0.5; border-radius: 0; padding: 1rem 0;">REGISTER</button>
            </div>

            <div class="modal-body" style="padding-top: 0;">
                <!-- v1.0 Part 3 (owner, 2026-10-08). Terms linked only from a
                     footer are often held to bind nobody; courts look for a
                     notice where the person signs in. Above every button, so it
                     covers both tabs and all three providers. New tab, so the
                     modal is still open when they come back. -->
                <p class="auth-terms-notice" id="auth-terms-notice">
                    By logging in or registering, you agree to the
                    <a href="${getRootPath()}terms.html" target="_blank" rel="noopener">Terms of Service</a>
                    and the
                    <a href="${getRootPath()}privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>,
                    and confirm you are 13 or older.
                </p>
                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 2px dashed var(--border-color); padding-bottom: 1.5rem;">
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('discord')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-19.32-72.15ZM42.68,65.33C38,65.33,34.2,61.13,34.2,56s3.76-9.33,8.48-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Zm41.72,0c-4.73,0-8.52-4.2-8.52-9.33s3.75-9.33,8.52-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Z"/></svg></span> LOGIN WITH DISCORD
                    </button>
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('github')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></span> LOGIN WITH GITHUB
                    </button>
                    <button class="btn-sys btn-sys-regular" style="width: 100%; display: flex; gap: 0.75rem;" onclick="window.triggerOAuth('google')">
                        <span style="display: flex; align-items: center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg></span> LOGIN WITH GOOGLE
                    </button>
                </div>

                <!-- LOGIN VIEW -->
                <div id="auth-view-login" class="editor-row" style="flex-direction: column; gap: 0.5rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-muted); text-align: left;">MANUAL LOGIN</label>
                    <input type="email" id="auth-email-login" class="editor-input" placeholder="Email Address" style="margin-bottom: 0.25rem;">
                    <input type="password" id="auth-password-login" class="editor-input" placeholder="Password">
                    <button id="btn-auth-action-login" class="btn-sys btn-sys-blue" style="margin-top: 0.5rem; width: 100%;">AUTHENTICATE</button>
                </div>

                <!-- REGISTER VIEW -->
                <div id="auth-view-register" class="editor-row hidden" style="flex-direction: column; gap: 0.5rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-muted); text-align: left;">CREATE ACCOUNT</label>
                    <input type="text" id="auth-name-register" class="editor-input" maxlength="32" placeholder="Display Name (Public)" style="margin-bottom: 0.25rem;">
                    <input type="email" id="auth-email-register" class="editor-input" placeholder="Email Address" style="margin-bottom: 0.25rem;">
                    <input type="password" id="auth-password-register" class="editor-input" placeholder="Password (Min 6 Characters)">
                    <button id="btn-auth-action-register" class="btn-sys btn-sys-green" style="margin-top: 0.5rem; width: 100%;">REGISTER ACCOUNT</button>
                </div>

                <div id="auth-feedback-message" class="hidden" style="font-size: 0.75rem; font-family: var(--text-mono); text-align: left; margin-top: 0.75rem; padding: 0.5rem; border-radius: 4px;"></div>
            </div>
            <div class="modal-footer" style="justify-content: center;">
                <button class="btn-sys btn-sys-regular" style="width: 100%;" onclick="document.getElementById('auth-modal-overlay').classList.add('hidden')">CANCEL</button>
            </div>
        </div>
    </div>`;

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

    const alertModalHTML = `
    <div id="alert-modal-overlay" class="modal-overlay tier-priority hidden">
        <div class="modal-box modal-sm accent-green">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>SYSTEM MESSAGE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body centered-text">
                <p id="alert-modal-msg" style="font-family: var(--text-mono); font-size: 0.85rem; color: var(--text-white); margin: 0 0 1rem 0; line-height: 1.5;"></p>
            </div>
            <div class="modal-footer centered-actions">
                <button id="btn-alert-close" class="btn-sys btn-sys-green" style="width: 100%;">ACKNOWLEDGE</button>
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
    div.innerHTML = authModalHTML + profileModalHTML + alertModalHTML + publicProfileHTML;
    while(div.firstChild) document.body.appendChild(div.firstChild);

    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const viewLogin = document.getElementById('auth-view-login');
    const viewRegister = document.getElementById('auth-view-register');
    const feedbackMsg = document.getElementById('auth-feedback-message');

    tabLogin.onclick = () => {
        tabLogin.classList.add('active'); tabLogin.style.opacity = '1';
        tabRegister.classList.remove('active'); tabRegister.style.opacity = '0.5';
        viewLogin.classList.remove('hidden'); viewRegister.classList.add('hidden');
        feedbackMsg.classList.add('hidden');
    };

    tabRegister.onclick = () => {
        tabRegister.classList.add('active'); tabRegister.style.opacity = '1';
        tabLogin.classList.remove('active'); tabLogin.style.opacity = '0.5';
        viewRegister.classList.remove('hidden'); viewLogin.classList.add('hidden');
        feedbackMsg.classList.add('hidden');
    };

    document.getElementById('btn-auth-action-login').addEventListener('click', async (e) => {
        const email = document.getElementById('auth-email-login').value;
        const password = document.getElementById('auth-password-login').value;
        const btn = e.target;
        
        if (!email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Please enter both email and password."; return; 
        }
        
        btn.textContent = "VERIFYING..."; btn.disabled = true;
        const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        btn.disabled = false; btn.textContent = "AUTHENTICATE";

        if (error) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Error: " + error.message;
        } else {
            document.getElementById('auth-modal-overlay').classList.add('hidden');
            document.getElementById('auth-password-login').value = ''; 
            window.checkActiveSession(); 
            window.showSystemAlert("Authentication successful! You are now securely connected.");
        }
    });

    document.getElementById('btn-auth-action-register').addEventListener('click', async (e) => {
        const name = document.getElementById('auth-name-register').value.trim();
        const email = document.getElementById('auth-email-register').value.trim();
        const password = document.getElementById('auth-password-register').value;
        const btn = e.target;
        
        if (!name || !email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "All fields are required to register."; return; 
        }

        // maxlength stops typing past the cap; this catches a paste, and says
        // so rather than silently truncating somebody's name.
        if (name.length > window.DISPLAY_NAME_MAX) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = `Display names are limited to ${window.DISPLAY_NAME_MAX} characters.`; return;
        }
        
        btn.textContent = "CREATING..."; btn.disabled = true;
        const { data, error } = await window.supabaseClient.auth.signUp({
            email, password, options: { data: { display_name: name, full_name: name } }
        });
        btn.disabled = false; btn.textContent = "REGISTER ACCOUNT";

        if (error) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Error: " + error.message;
        } else {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#22c55e'; feedbackMsg.style.background = 'rgba(34,197,94,0.1)';
            feedbackMsg.textContent = "Success! Your account has been created. If email verification is enabled on your server, please check your inbox.";
            document.getElementById('auth-password-register').value = '';
            
            // Signed straight in when the project does not require email verification.
            if (data.session) {
                setTimeout(() => {
                    document.getElementById('auth-modal-overlay').classList.add('hidden');
                    window.checkActiveSession();
                }, 2000);
            }
        }
    });

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

window.currentGlobalUsername = "Anonymous";
/** The name to show for a session: display name, OAuth name, Discord name, then the email's prefix. */

window.getDisplayName = function(session) {
    if (!session || !session.user) return "Anonymous";
    
    const meta = session.user.user_metadata || {};
    
    return meta.display_name || meta.full_name || meta.custom_claims?.global_name || meta.user_name || session.user.email.split('@')[0];
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

// Somebody else's profile, cached for the page load: a thread asks for the same
// authors twice, and nobody's standing changes while a thread is read.
window.__publicProfileCache = window.__publicProfileCache || new Map();

/**
 * Public profiles for many people in one request, one per thread rather than one
 * per post.
 * @since v0.17
 */
window.fetchPublicProfiles = async function (userIds) {
    const wanted = [...new Set((userIds || []).filter(Boolean))];
    const missing = wanted.filter(id => !window.__publicProfileCache.has(id));

    if (missing.length && window.supabaseClient) {
        try {
            const { data, error } = await window.supabaseClient
                .rpc('get_public_profiles', { target_user_ids: missing });
            if (!error && Array.isArray(data)) {
                data.forEach(row => window.__publicProfileCache.set(row.user_id, row));
            }
            // Misses are cached too: a deleted account would otherwise be asked for again on
            // every render.
            missing.forEach(id => {
                if (!window.__publicProfileCache.has(id)) window.__publicProfileCache.set(id, null);
            });
        } catch (e) {
            // The thread draws without flairs rather than not at all, on a database without
            // this RPC.
        }
    }

    const out = new Map();
    wanted.forEach(id => out.set(id, window.__publicProfileCache.get(id) || null));
    return out;
};

window.openPublicProfile = async function (userId) {
    if (!userId) return;
    window.injectAuthModal();
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

/**
 * What each badge id means. Drawn as a skill slot from the game with its picture
 * in it.
 * @since v1.1
 * @watch which ids can be claimed, and until when, is claim_badge() in SQL: the
 *   two lists agree
 */
window.SITE_BADGES = {
    'halloween-2026-gold': {
        name: 'DSL Halloween 2026 - Gold Ver',
        how: 'Hit the final Black Flash on the first try',
        icon: 'medias/images/GoldenPumpkin2026.png',
        tier: 'gold',
        keepBy: 'November 7',
    },
    'halloween-2026': {
        name: 'DSL Halloween 2026',
        how: 'Hit the final Black Flash on a later try',
        icon: 'medias/images/Pumpkin2026.png',
        tier: 'plain',
        keepBy: 'November 7',
    },
};

// Only the ids this page can draw, in their order: one from a newer badge, or
// anything else the database hands back, is left out rather than drawn broken.
window.knownBadges = function (ids) {
    return (Array.isArray(ids) ? ids : [])
        .filter(id => Object.prototype.hasOwnProperty.call(window.SITE_BADGES, id));
};

// One badge as a skill slot, with the game's "3" key on the larger sizes.
// `named`: the slot is all there is of it (beside a name), so it carries the
// name itself, for hover and for screen readers.
window.badgeSlot = function (id, { size = 'small', named = false } = {}) {
    const def = window.SITE_BADGES[id];
    const slot = document.createElement('span');
    slot.className = `user-badge user-badge-${size} user-badge-${def.tier}`;
    if (size !== 'small') {
        const key = document.createElement('span');
        key.className = 'user-badge-key';
        key.setAttribute('aria-hidden', 'true');
        key.textContent = '3';
        slot.appendChild(key);
    }
    const img = document.createElement('img');
    img.src = getRootPath() + def.icon;
    img.alt = named ? def.name : '';
    slot.appendChild(img);
    if (named) slot.title = def.name;
    return slot;
};

// Its name, and how it is earned.
window.badgeWords = function (id) {
    const def = window.SITE_BADGES[id];
    const words = document.createElement('span');
    words.className = 'badge-words';
    const name = document.createElement('strong');
    name.textContent = def.name;
    const how = document.createElement('span');
    how.textContent = def.how;
    words.append(name, how);
    return words;
};

// A badge won signed out waits on the device until its winner signs in.
const BADGES_PENDING_KEY = 'dsl_badges_pending';
function readPendingBadges() {
    try {
        return window.knownBadges(JSON.parse(window.localStorage.getItem(BADGES_PENDING_KEY) || '[]'));
    } catch (e) {
        return [];
    }
}
function writePendingBadges(ids) {
    try {
        if (ids.length) window.localStorage.setItem(BADGES_PENDING_KEY, JSON.stringify(ids));
        else window.localStorage.removeItem(BADGES_PENDING_KEY);
    } catch (e) {
        // Deliberately quiet: storage is blocked, so a badge won signed out
        // cannot wait. One won signed in is still claimed straight away.
    }
}

// "BADGE EARNED" in the corner: kept, or how to keep it.
function showBadgeToast(id, kept) {
    const def = window.SITE_BADGES[id];
    if (!def || !document.body) return;
    document.querySelectorAll('.badge-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `badge-toast badge-toast-${def.tier}`;
    toast.setAttribute('role', 'status');
    toast.appendChild(window.badgeSlot(id, { size: 'medium' }));

    const text = document.createElement('div');
    text.className = 'badge-toast-text';
    const head = document.createElement('span');
    head.className = 'badge-toast-head';
    head.textContent = 'BADGE EARNED';
    const name = document.createElement('strong');
    name.textContent = def.name;
    const note = document.createElement('span');
    note.className = 'badge-toast-note';
    note.textContent = kept ? 'On your profile now.' : `Sign in by ${def.keepBy} to keep it.`;
    text.append(head, name, note);
    toast.appendChild(text);

    if (!kept) {
        const login = document.createElement('button');
        login.type = 'button';
        login.className = 'btn-sys btn-sys-regular badge-toast-login';
        login.textContent = 'LOGIN';
        login.addEventListener('click', () => {
            toast.remove();
            window.openAuthModal();
        });
        toast.appendChild(login);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'badge-toast-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✖';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(close);

    document.body.appendChild(toast);
    // Longer when there is something to do about it.
    setTimeout(() => toast.remove(), kept ? 8000 : 20000);
}

// Saves every badge waiting on this device to the signed-in account, with a
// toast for each. Runs on every page load (initAuthDock, which a sign-in runs
// too) and on a win. One at a time, so two callers never claim twice.
let badgeClaims = Promise.resolve();
window.claimPendingBadges = function (extra = []) {
    const run = badgeClaims.then(() => claimBadgesNow(extra));
    badgeClaims = run.catch(() => {});
    return run;
};
async function claimBadgesNow(extra) {
    const ids = [...new Set([...readPendingBadges(), ...window.knownBadges(extra)])];
    if (!ids.length || !window.supabaseClient) return { signedIn: false, claimed: [] };
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) return { signedIn: false, claimed: [] };

    const claimed = [];
    const waiting = [];
    for (const id of ids) {
        const { error } = await window.supabaseClient.rpc('claim_badge', { badge_id: id });
        if (!error) {
            claimed.push(id);
        } else if (error.code === '42501' || error.code === '22023') {
            // Refused by the database (claims closed, a soft-banned account):
            // it never will be kept, so it stops waiting.
            console.warn(`Badge ${id} not kept: ${error.message}`);
        } else {
            // Offline, or a site newer than its database: try again next page.
            waiting.push(id);
        }
    }
    writePendingBadges(waiting);
    claimed.forEach(id => showBadgeToast(id, true));
    return { signedIn: true, claimed };
}

/** Awards a badge: claimed now when signed in, otherwise kept on the device until a sign-in. */
window.earnBadge = async function (id) {
    if (!window.knownBadges([id]).length) return;
    writePendingBadges([...new Set([...readPendingBadges(), id])]);
    const { signedIn } = await window.claimPendingBadges([id]);
    if (!signedIn) showBadgeToast(id, false);
};

window.openAuthModal = async function() {
    if (!window.supabaseClient) return;
    
    window.injectAuthModal(); 

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    if (session) {
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
        return;
    }

    document.getElementById('auth-modal-overlay').classList.remove('hidden');
};

window.triggerOAuth = async function(providerName) {
    if (!window.supabaseClient) return;
    const { error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: providerName,
        options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
    });
    if (error) { console.error("OAuth Error:", error.message); alert("Failed to connect to " + providerName); }
};

window.checkActiveSession = async () => {
    if (!window.supabaseClient) return;

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    if (session) {
        window.currentGlobalUsername = window.getDisplayName(session);
    } else {
        window.currentGlobalUsername = "Anonymous";
    }

    if (typeof window.initAuthDock === 'function') {
        await window.initAuthDock();
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    await window.checkActiveSession(); 
    if (typeof window.initNotifications === 'function') {
        await window.initNotifications();
    }
});

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

/**
 * Opens the inbox, fetching it fresh each time, so it never depends on load order
 * and is never a snapshot from page load.
 */
window.openNotificationModal = async function() {
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

// Display names are capped at 32 characters. Client-side only: the name lives in
// auth metadata, where a CHECK is impossible, and a trigger on auth.users that
// raises would take signup down. The bio and flair caps are database constraints.
window.DISPLAY_NAME_MAX = 32;

/**
 * The role badges, one table for the dock and the profile. Keyed by role name, not
 * rank: an icon is an identity, and roleMeets would give the owner the admin's
 * shield.
 * @since v0.17
 */
window.ROLE_BADGES = {
    owner: { label: 'Owner', color: 'purple', icon: 'role-owner' },
    admin: { label: 'Admin', color: 'red', icon: 'role-admin' },
    reviewer: { label: 'Reviewer', color: 'blue', icon: 'role-reviewer' },
    trusted_editor: { label: 'Trusted Editor', color: 'yellow', icon: 'role-trusted-editor' },
    // Signed in with no role, and also a viewer: a soft ban with a badge of its own would
    // publish a moderation decision on the person's profile. get_public_profile() nulls
    // the standing for the same reason.
    member: { label: 'Member', color: 'green', icon: 'role--member' },
    guest: { label: 'Guest', color: 'regular', icon: 'role--guest' },
};

/** The badge for a role name; anything unknown gets the signed-in badge, never a senior one. */
window.roleBadge = function (roleName) {
    const key = String(roleName || '').trim().toLowerCase();
    return window.ROLE_BADGES[key] || window.ROLE_BADGES.member;
};

/** A role's icon, for whoever draws a badge (the dock, the profile). */
window.roleIconHTML = function (roleName, className) {
    return window.uiIconHTML(window.roleBadge(roleName).icon, { className });
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
