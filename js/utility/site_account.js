/**
 * Accounts: signing in and registering, the site's alert box, public profile
 * lookups, badges and role badges, and the openers for the profile, a public
 * profile and the inbox, whose boxes are js/utility/account_boxes.js, loaded the
 * first time one opens. Loads last of the four parts, so its session check runs
 * after site_utils.js's.
 * @since v0.3, as part of site_utils.js
 * @touches Supabase Auth (sign-in, registering, the session's display name),
 *   claim_badge, get_public_profiles, localStorage dsl_badges_pending,
 *   js/utility/account_boxes.js (loaded by loadSiteFile)
 * @watch SITE_BADGES and claim_badge() in SQL list the same badges: change them
 *   together
 * @see docs/shared-code.md
 */

window.injectAuthModal = function() {
    if (document.getElementById('auth-modal-overlay')) return;

    const authModalHTML = `
    <dialog id="auth-modal-overlay" class="site-dialog" aria-labelledby="auth-modal-title">
            <div class="dialog-header">
                <h3 id="auth-modal-title">SYSTEM ACCESS</h3>
                <span id="auth-status-indicator" class="status-dot offline"></span>
            </div>

            <div class="sub-tabs auth-tabs" style="margin-bottom: 1.5rem; padding: 1rem 1.5rem 0;">
                <button type="button" id="auth-tab-login" class="sub-tab is-active">LOGIN</button>
                <button type="button" id="auth-tab-register" class="sub-tab">REGISTER</button>
            </div>

            <div class="dialog-body" style="padding-top: 0;">
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
            <div class="dialog-footer">
                <button type="button" class="btn-sys btn-sys-regular" style="width: 100%;" data-dialog-close>CANCEL</button>
            </div>
    </dialog>`;

    const alertModalHTML = `
    <dialog id="alert-modal-overlay" class="site-dialog tone-green" aria-labelledby="alert-modal-title">
        <div class="dialog-header">
            <h3 id="alert-modal-title">SYSTEM MESSAGE</h3>
            <span class="status-dot online"></span>
        </div>
        <div class="dialog-body dialog-question">
            <p id="alert-modal-msg" class="dialog-text"></p>
            <div class="dialog-actions">
                <button type="button" id="btn-alert-close" class="btn-sys btn-sys-green">ACKNOWLEDGE</button>
            </div>
        </div>
    </dialog>`;

    const div = document.createElement('div');
    div.innerHTML = authModalHTML + alertModalHTML;
    while(div.firstChild) document.body.appendChild(div.firstChild);

    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const viewLogin = document.getElementById('auth-view-login');
    const viewRegister = document.getElementById('auth-view-register');
    const feedbackMsg = document.getElementById('auth-feedback-message');

    tabLogin.onclick = () => {
        tabLogin.classList.add('is-active');
        tabRegister.classList.remove('is-active');
        viewLogin.classList.remove('hidden'); viewRegister.classList.add('hidden');
        feedbackMsg.classList.add('hidden');
    };

    tabRegister.onclick = () => {
        tabRegister.classList.add('is-active');
        tabLogin.classList.remove('is-active');
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
            document.getElementById('auth-modal-overlay').close();
            document.getElementById('auth-password-login').value = ''; 
            window.checkActiveSession(); 
            window.showToast("Authentication successful! You are now securely connected.");
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
                    document.getElementById('auth-modal-overlay').close();
                    window.checkActiveSession();
                }, 2000);
            }
        }
    });

};

window.currentGlobalUsername = "Anonymous";
/** The name to show for a session: display name, OAuth name, Discord name, then the email's prefix. */

window.getDisplayName = function(session) {
    if (!session || !session.user) return "Anonymous";
    
    const meta = session.user.user_metadata || {};
    
    return meta.display_name || meta.full_name || meta.custom_claims?.global_name || meta.user_name || session.user.email.split('@')[0];
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

// The profile, a public profile and the inbox are js/utility/account_boxes.js,
// loaded the first time one opens. A failure says so rather than doing nothing.
function withAccountBoxes(open) {
    return window.loadSiteFile('js/utility/account_boxes.js').then(open, error => {
        console.error('[Account] Could not load the account boxes:', error);
        window.showSystemAlert('Could not open that. Try refreshing.');
    });
}

/** Opens another reader's public profile. */
window.openPublicProfile = function (userId) {
    return withAccountBoxes(() => window.showPublicProfile(userId));
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
    if (named) slot.dataset.tip = def.name;
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

// "BADGE EARNED" as a toast: kept, or how to keep it.
function showBadgeToast(id, kept) {
    const def = window.SITE_BADGES[id];
    if (!def) return;
    window.showToast(def.name, {
        head: 'BADGE EARNED',
        tone: def.tier === 'gold' ? 'gold' : 'badge',
        lead: window.badgeSlot(id, { size: 'medium' }),
        note: kept ? 'On your profile now.' : `Sign in by ${def.keepBy} to keep it.`,
        action: kept ? null : { label: 'LOGIN', onClick: () => window.openAuthModal() },
        // Longer when there is something to do about it.
        duration: kept ? 8000 : 20000,
        className: 'badge-toast',
    });
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
    
    if (session) return withAccountBoxes(() => window.showProfileBox(session));

    window.openDialog(document.getElementById('auth-modal-overlay'));
};

window.triggerOAuth = async function(providerName) {
    if (!window.supabaseClient) return;
    const { error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: providerName,
        options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
    });
    if (error) { console.error("OAuth Error:", error.message); window.showSystemAlert("Failed to connect to " + providerName); }
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
});

/**
 * Opens the inbox, fetched fresh each time, so it is never a snapshot from page load.
 * The dock's unread dot is its own count (initAuthDock).
 */
window.openNotificationModal = function () {
    return withAccountBoxes(() => window.showInbox());
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
