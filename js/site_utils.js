/**
 * Dogslamloop Wiki - Shared Site Utilities
 */

const fetchPromiseCache = {};

function getRootPath() {
    const path = window.location.pathname;

    if (path.endsWith('/characters/index.html') || path.endsWith('/characters/')) return '../';
    if (path.includes('/characters/')) return '../../';
    if (path.endsWith('/systems/index.html') || path.endsWith('/systems/')) return '../';
    if (path.includes('/systems/')) return '../../';

    return './';
}

async function fetchJson(url, options = {}) {
    const cacheEnabled = Boolean(options.cache);
    const requestUrl = url.includes('?') ? url : `${url}?v=1.0`;

    if (cacheEnabled) {
        // Cache the Promise, not the resolved data, to prevent race conditions
        if (!fetchPromiseCache[requestUrl]) {
            fetchPromiseCache[requestUrl] = fetch(requestUrl).then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch JSON resource: ${requestUrl}`);
                }
                return response.json();
            }).catch(error => {
                // Clear cache on failure so it can retry later
                delete fetchPromiseCache[requestUrl];
                throw error;
            });
        }
        return fetchPromiseCache[requestUrl];
    }

    // Standard uncached fetch
    const response = await fetch(requestUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch JSON resource: ${requestUrl}`);
    }
    return response.json();
}

// --- CLOUD DATA FETCHING (SUPABASE) ---
window.fetchCloudCharacterData = async function(charId) {
    if (!window.supabaseClient) return null;
    
    try {
        const { data, error } = await window.supabaseClient
            .from('page_data')
            .select('*')
            .eq('page_id', charId.toLowerCase())
            .single();
            
        if (error || !data) return null;
        return data; // Returns { page_id, desc_data, frame_data }
    } catch (err) {
        console.error("Cloud fetch failed:", err);
        return null;
    }
};

// Override the Editor's fetch logic to check the cloud first
window.fetchCharacterData = async function(charId) {
    // 1. Try Cloud First
    const cloudData = await window.fetchCloudCharacterData(charId);
    if (cloudData && cloudData.desc_data && cloudData.frame_data) {
        console.log(`[Editor] Loaded ${charId} from Supabase Cloud.`);
        return { descData: cloudData.desc_data, frameData: cloudData.frame_data };
    }
    
    // 2. Fallback to local files if it hasn't been uploaded to the cloud yet
    console.log(`[Editor] Cloud data not found. Falling back to local files for ${charId}.`);
    const basePath = `${getRootPath()}characters/${charId.charAt(0).toUpperCase() + charId.slice(1)}/`;
    const [descData, frameData] = await Promise.all([
        fetchJson(`${basePath}${charId}_descriptions.json`),
        fetchJson(`${basePath}${charId}_framedata.json`)
    ]);
    
    return { descData, frameData };
};

async function fetchNavigationData() {
    return fetchJson(`${getRootPath()}data/navigation.json?v=1.0`, { cache: true });
}

// --- GLOBAL SUPABASE BACKEND ---
const SUPABASE_URL = 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// Attach client to the global window object so editor.js can use it later
window.supabaseClient = null;
try {
    if (window.supabase && SUPABASE_URL.startsWith('http')) {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.error("Failed to connect to global Supabase instance:", e);
}

// --- GLOBAL AUTHENTICATION & PROFILE MODAL INJECTOR ---
window.injectAuthModal = function() {
    // Prevent injecting it twice
    if (document.getElementById('auth-modal-overlay')) return;

    // 1. The original Auth Modal HTML
    const authModalHTML = `
    <div id="auth-modal-overlay" class="editor-modal-overlay" style="display: none;">
        <div class="editor-modal-box auth-modal-box">
            <div class="auth-header">
                <h3>SYSTEM ACCESS</h3>
                <span id="auth-status-indicator" class="status-dot offline"></span>
            </div>
            <div class="auth-body">
                <div class="oauth-grid" style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 2px dashed #333; padding-bottom: 1.5rem;">
                    <button class="oauth-btn" onclick="window.triggerOAuth('discord')">
                        <span class="oauth-icon"><svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-19.32-72.15ZM42.68,65.33C38,65.33,34.2,61.13,34.2,56s3.76-9.33,8.48-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Zm41.72,0c-4.73,0-8.52-4.2-8.52-9.33s3.75-9.33,8.52-9.33,8.55,4.19,8.48,9.33c0,5.14-3.79,9.33-8.48,9.33Z"/></svg></span> LOGIN WITH DISCORD
                    </button>
                    <button class="oauth-btn" onclick="window.triggerOAuth('github')">
                        <span class="oauth-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></span> LOGIN WITH GITHUB
                    </button>
                    <button class="oauth-btn" onclick="window.triggerOAuth('google')">
                        <span class="oauth-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg></span> LOGIN WITH GOOGLE
                    </button>
                </div>
                <div class="editor-row" style="flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; text-align: left;">MANUAL AUTHORIZATION</label>
                    <input type="email" id="auth-email" class="editor-input" placeholder="Email" style="margin: 0; margin-bottom: 0.5rem;">
                    <input type="password" id="auth-password" class="editor-input" placeholder="Password" style="margin: 0;">
                </div>
                <div id="auth-error-message" style="display: none; color: #ef4444; font-size: 0.75rem; font-family: var(--text-mono); text-align: left; margin-bottom: 1rem;">
                    Error: Invalid credentials.
                </div>
            </div>
            <div class="editor-modal-actions" style="border-top: 1px dashed #333; padding-top: 1rem; margin-top: 0;">
                <button id="btn-auth-cancel" class="system-page-btn" onclick="document.getElementById('auth-modal-overlay').style.display='none'">CANCEL</button>
                <button id="btn-auth-login" class="submit-btn" style="color: var(--accent-blue); border-color: var(--accent-blue);">AUTHENTICATE</button>
            </div>
        </div>
    </div>`;

    // 2. NEW: The Custom Profile Modal HTML
    const profileModalHTML = `
    <div id="profile-modal-overlay" class="editor-modal-overlay" style="display: none;">
        <div class="editor-modal-box auth-modal-box">
            <div class="auth-header">
                <h3>SYSTEM PROFILE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="auth-body">
                <p style="font-family: var(--text-mono); font-size: 0.75rem; color: #888; margin-top: 0; margin-bottom: 1.5rem; text-transform: uppercase;">
                    Logged in as: <strong id="profile-current-name" style="color: var(--text-white);"></strong>
                </p>
                <div class="editor-row" style="flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: #888; text-align: left;">NEW DISPLAY NAME</label>
                    <input type="text" id="profile-new-name" class="editor-input" placeholder="Enter custom display name..." style="margin: 0;">
                </div>
            </div>
            <div class="editor-modal-actions" style="border-top: 1px dashed #333; padding-top: 1rem; margin-top: 0; justify-content: space-between;">
                <button id="btn-profile-logout" class="submit-btn" style="color: #ef4444; border-color: #ef4444; padding: 0.4rem 0.75rem;">LOGOUT</button>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="system-page-btn" onclick="document.getElementById('profile-modal-overlay').style.display='none'">CANCEL</button>
                    <button id="btn-profile-save" class="submit-btn" style="color: var(--accent-blue); border-color: var(--accent-blue);">SAVE CHANGES</button>
                </div>
            </div>
        </div>
    </div>`;

    // The Custom System Alert Modal HTML
    const alertModalHTML = `
    <div id="alert-modal-overlay" class="editor-modal-overlay" style="display: none;">
        <div class="editor-modal-box auth-modal-box" style="border-top-color: #22c55e;">
            <div class="auth-header" style="border-bottom-color: #166534;">
                <h3 style="color: #22c55e;">SYSTEM MESSAGE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="auth-body" style="text-align: center; display: flex; flex-direction: column; align-items: center;">
                <p id="alert-modal-msg" style="font-family: var(--text-mono); font-size: 0.85rem; color: var(--text-white); margin: 0.5rem 0 1.5rem 0; line-height: 1.5;"></p>
                <button id="btn-alert-close" class="submit-btn" style="color: #22c55e; border-color: #22c55e; width: 100%;">ACKNOWLEDGE</button>
            </div>
        </div>
    </div>`;

    // Inject all three into the DOM
    const div = document.createElement('div');
    div.innerHTML = authModalHTML + profileModalHTML + alertModalHTML;
    while(div.firstChild) {
        document.body.appendChild(div.firstChild);
    }

    // 4. Bind Manual Login Button Logic
    const btnLogin = document.getElementById('btn-auth-login');
    if (btnLogin) {
        btnLogin.addEventListener('click', async () => {
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const err = document.getElementById('auth-error-message');
            
            if (!email || !password) { err.textContent = "Please enter both email and password."; err.style.display = 'block'; return; }
            err.style.display = 'none';
            btnLogin.textContent = "VERIFYING..."; btnLogin.disabled = true;
            
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email: email, password: password });
            btnLogin.disabled = false;

            if (error) {
                console.error("Auth Error:", error.message);
                err.textContent = "Error: Invalid credentials."; err.style.display = 'block';
                btnLogin.textContent = "AUTHENTICATE";
            } else {
                document.getElementById('auth-modal-overlay').style.display = 'none';
                btnLogin.textContent = "AUTHENTICATE";
                document.getElementById('auth-password').value = ''; 
                window.checkActiveSession(); 
                window.showSystemAlert("Authentication successful! You are now securely connected.");
            }
        });
    }

    // 5. Bind Profile Modal Logic (Save & Logout)
    const btnLogout = document.getElementById('btn-profile-logout');
    const btnSave = document.getElementById('btn-profile-save');

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            document.getElementById('profile-modal-overlay').style.display = 'none';
            await window.supabaseClient.auth.signOut();
            location.reload(); 
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const newNameInp = document.getElementById('profile-new-name');
            const newName = newNameInp.value.trim();
            const currentName = document.getElementById('profile-current-name').textContent;

            // Only update if they actually typed a new name
            if (newName && newName !== currentName) {
                btnSave.textContent = "SAVING...";
                btnSave.disabled = true;
                
                const { error } = await window.supabaseClient.auth.updateUser({
                    data: { display_name: newName }
                });
                
                btnSave.disabled = false;
                btnSave.textContent = "SAVE CHANGES";

                if (!error) {
                    document.getElementById('profile-modal-overlay').style.display = 'none';
                    window.checkActiveSession(); // Instantly update global UI to reflect new name
                } else {
                    alert("Failed to update name. Check console.");
                    console.error("Profile Update Error:", error);
                }
            } else {
                // If they didn't change anything, just close the modal
                document.getElementById('profile-modal-overlay').style.display = 'none';
            }
        });
    }

    // Bind System Alert Close Button
    const btnAlertClose = document.getElementById('btn-alert-close');
    if (btnAlertClose) {
        btnAlertClose.addEventListener('click', () => {
            document.getElementById('alert-modal-overlay').style.display = 'none';
        });
    }
};

// --- GLOBAL SYSTEM ALERT ---
window.showSystemAlert = function(message) {
    window.injectAuthModal(); // Ensure it exists in the DOM
    const msgEl = document.getElementById('alert-modal-msg');
    if (msgEl) msgEl.textContent = message;
    document.getElementById('alert-modal-overlay').style.display = 'flex';
};

// --- USERNAME & PROFILE SYSTEM ---
window.currentGlobalUsername = "Anonymous"; // Global cache for the editor to use

window.getDisplayName = function(session) {
    if (!session || !session.user) return "Anonymous";
    const meta = session.user.user_metadata;
    // Priority: Custom Display Name -> Discord/GitHub Name -> Email Prefix
    return meta.display_name || meta.full_name || meta.user_name || session.user.email.split('@')[0];
};

window.openAuthModal = async function() {
    if (!window.supabaseClient) return;
    
    // Ensure the HTML exists in the DOM first
    window.injectAuthModal(); 

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    // IF LOGGED IN: Open the Custom Profile Manager
    if (session) {
        const username = window.getDisplayName(session);
        document.getElementById('profile-current-name').textContent = username;
        
        // Pre-fill the input box with their current name so it's easy to edit
        const nameInput = document.getElementById('profile-new-name');
        nameInput.value = username;
        
        document.getElementById('profile-modal-overlay').style.display = 'flex';
        nameInput.focus(); 
        return; 
    }

    // IF NOT LOGGED IN: Open the Auth Modal
    document.getElementById('auth-modal-overlay').style.display = 'flex';
};

window.triggerOAuth = async function(providerName) {
    if (!window.supabaseClient) return;
    const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: providerName,
        options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
    });
    if (error) { console.error("OAuth Error:", error.message); alert("Failed to connect to " + providerName); }
};

window.checkActiveSession = async () => {
    if (!window.supabaseClient) return;

    // 1. Fetch Session Data
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    let role = 'guest';
    let unreadCount = 0;

    if (session) {
        window.currentGlobalUsername = window.getDisplayName(session);
        
        // Fetch Role & Unread count simultaneously for maximum speed
        const [roleRes, notifRes] = await Promise.all([
            window.supabaseClient.rpc('get_my_role'),
            window.supabaseClient.from('user_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', session.user.id)
                .eq('is_read', false)
        ]);
        
        if (roleRes.data) role = roleRes.data;
        if (notifRes.count) unreadCount = notifRes.count;
    } else {
        window.currentGlobalUsername = "Anonymous";
    }

    // 2. Find the container (Fallback to class if ID is missing in old files)
    let container = document.getElementById('auth-btn-container');
    if (!container) {
        container = document.querySelector('.sidebar-auth-widget');
        if (container) container.id = 'auth-btn-container';
    }

    // 3. Delegate to the new PageBuilder Engine!
    if (typeof window.buildSidebarDock === 'function') {
        window.buildSidebarDock('auth-btn-container', session, role, unreadCount);
    }
};

// --- MANGA DROPDOWN ENGINE (BULLETPROOF HYBRID) ---
window.initializeMangaSelects = function() {
    document.querySelectorAll('select.editor-select:not(.manga-initialized)').forEach(select => {
        select.classList.add('manga-initialized');

        const wrapper = document.createElement('div');
        wrapper.className = 'manga-select-wrapper';

        const trigger = document.createElement('div');
        trigger.className = 'manga-select-trigger';
        trigger.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'manga-select-options';

        Array.from(select.options).forEach((option, index) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'manga-option';
            if (option.selected) optDiv.classList.add('selected');
            if (option.style.color) optDiv.style.color = option.style.color;
            optDiv.textContent = option.textContent;

            optDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                select.selectedIndex = index;
                trigger.textContent = option.textContent;

                // CRITICAL FIX: Trigger native change event so DAW updates
                select.dispatchEvent(new Event('change', { bubbles: true }));

                optionsContainer.querySelectorAll('.manga-option').forEach(el => el.classList.remove('selected'));
                optDiv.classList.add('selected');
                wrapper.classList.remove('open');
            });
            optionsContainer.appendChild(optDiv);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.manga-select-wrapper.open').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });

        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsContainer);
        select.parentNode.insertBefore(wrapper, select.nextSibling);

        // Sync trigger text if the DAW programmatic logic changes value
        select.addEventListener('change', () => {
            trigger.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';
        });
    });
};

// --- SUPABASE CLOUD DATA FETCHER ---
window.fetchCloudCharacterData = async function(pageId) {
    // Failsafe: If Supabase isn't connected, immediately fall back to local files
    if (!window.supabaseClient) return null;
    
    try {
        // Using the updated universal routing schema we built!
        const { data, error } = await window.supabaseClient
            .from('page_data')
            .select('*')
            .eq('page_id', pageId)
            .single();

        if (error) {
            // PGRST116 is Supabase's code for "No rows found". 
            // This just means the character is completely blank/new, so we silently return null.
            if (error.code !== 'PGRST116') {
                console.error("Database fetch error:", error.message);
            }
            return null;
        }
        
        return data;
        
    } catch (err) {
        console.error("Unexpected cloud connection error:", err);
        return null;
    }
};

// Use Capture phase to close dropdowns before drag-and-drop eats the click
document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.manga-select-wrapper')) {
        document.querySelectorAll('.manga-select-wrapper.open').forEach(w => {
            w.classList.remove('open');
        });
    }
}, true);

// Initial run & Dynamic Observer
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(window.initializeMangaSelects, 100);

    const observer = new MutationObserver((mutations) => {
        let shouldInit = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1) { shouldInit = true; break; }
                }
            }
        });
        if (shouldInit) window.initializeMangaSelects();
    });

    observer.observe(document.body, { childList: true, subtree: true });
});

document.addEventListener('DOMContentLoaded', async () => {
    // Await the auth check so we have session data
    await window.checkActiveSession(); 
    // Then build the inbox
    if (typeof window.initNotifications === 'function') {
        await window.initNotifications();
    }
});

window.initNotifications = async function() {
    if (!window.supabaseClient) return;
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) return; 

    // Fetch Full Notifications for the Modal
    const { data: notifs, error } = await window.supabaseClient
        .from('user_notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(15); 

    if (error) { console.error("Inbox Error:", error); return; }

    // Build the invisible Modal Container
    let modal = document.getElementById('site-notification-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-notification-modal';
        modal.className = 'editor-modal-overlay';
        modal.style = "display: none; z-index: 10005; justify-content: center; align-items: flex-start; padding-top: 5rem;";
        document.body.appendChild(modal);
    }

    let notifHTML = notifs.length === 0 
        ? `<div style="text-align: center; padding: 2.5rem; color: #555; font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`
        : notifs.map(n => `
            <div class="notif-item ${n.is_read ? 'read' : 'unread'}" id="notif-row-${n.id}"
                 style="padding: 1rem; border-bottom: 1px dashed #333; background: ${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}; cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden;" 
                 onclick="markNotifRead('${n.id}', '${n.link || ''}')"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'" 
                 onmouseout="this.style.background='${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}'">
                
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem;">
                    <span style="font-size: 0.65rem; color: ${n.is_read ? '#666' : 'var(--accent-blue)'}; font-family: var(--text-mono);">${new Date(n.created_at).toLocaleDateString()}</span>
                    
                    <div style="display: flex; gap: 0.75rem; align-items: center;">
                        ${!n.is_read ? `<span id="notif-dot-${n.id}" style="width: 6px; height: 6px; background: var(--accent-blue); border-radius: 50%; box-shadow: 0 0 4px var(--accent-blue);"></span>` : ''}
                        <button onclick="deleteNotification('${n.id}', event)" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:0; display:flex; opacity:0.5; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.8rem; color: ${n.is_read ? 'var(--text-muted)' : 'var(--text-white)'}; line-height: 1.5; font-family: sans-serif; padding-right: 1rem;">${n.message}</p>
            </div>
        `).join('');

    modal.innerHTML = `
        <div class="editor-modal-box auth-modal-box" style="width: 400px; max-height: 70vh; display: flex; flex-direction: column; padding: 0;">
            <div class="auth-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding: 1rem 1.5rem; background: #050505;">
                
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <h3 style="margin: 0; font-size: 1rem; color: var(--text-white);">INBOX</h3>
                    ${notifs.length > 0 ? `<button onclick="clearAllNotifications()" style="background: none; border: none; color: #ef4444; font-size: 0.65rem; font-family: var(--text-mono); cursor: pointer; text-decoration: underline; opacity: 0.8;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">CLEAR ALL</button>` : ''}
                </div>
                
                <button onclick="document.getElementById('site-notification-modal').style.display='none'" style="background:none; border:none; color: #888; cursor:pointer; font-size: 1.2rem;">&times;</button>
            </div>
            <div class="auth-body" style="padding: 0; overflow-y: auto; flex: 1; background: var(--bg-darker);">
                ${notifHTML}
            </div>
        </div>
    `;
};

window.markNotifRead = async function(id, link) {
    // 1. Optimistic UI Update (Makes it feel instant to the user)
    const row = document.getElementById(`notif-row-${id}`);
    const dot = document.getElementById(`notif-dot-${id}`);
    
    if (row) {
        row.style.background = 'transparent';
        row.classList.remove('unread');
        row.classList.add('read');
    }
    if (dot) dot.style.display = 'none';

    // 2. Fire database update in the background
    if (window.supabaseClient) {
        window.supabaseClient.from('user_notifications').update({ is_read: true }).eq('id', id).then(() => {
            // Re-run the session checker to update the red bell badge count on the sidebar!
            window.checkActiveSession();
        });
    }
    
    // 3. Navigate if a link was provided
    if (link && link !== 'null' && link !== '') {
        window.location.href = link;
    }
};

// --- NOTIFICATION DELETION SYSTEM ---

window.deleteNotification = async function(id, event) {
    // CRITICAL: Stop the click from bubbling down and triggering "markNotifRead"
    event.stopPropagation(); 
    
    // 1. Optimistic UI Animation (Smooth collapse)
    const row = document.getElementById(`notif-row-${id}`);
    if (row) {
        row.style.height = row.offsetHeight + 'px'; // Lock current height
        row.offsetHeight; // Force browser reflow
        row.style.padding = '0px';
        row.style.height = '0px';
        row.style.opacity = '0';
        row.style.border = 'none';
        setTimeout(() => row.remove(), 200); // Remove node after CSS transition
    }

    // 2. Database Execution
    if (window.supabaseClient) {
        await window.supabaseClient.from('user_notifications').delete().eq('id', id);
        
        // Recalculate the red bell badge count on the sidebar dock!
        window.checkActiveSession(); 
    }
};

window.clearAllNotifications = async function() {
    if (!confirm("Are you sure you want to clear your entire inbox?")) return;
    
    // 1. Optimistic UI Wipe
    const body = document.querySelector('#site-notification-modal .auth-body');
    const clearBtn = document.querySelector('#site-notification-modal button[onclick="clearAllNotifications()"]');
    
    if (body) {
        body.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: #555; font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`;
    }
    if (clearBtn) clearBtn.remove(); // Remove the clear button itself

    // 2. Database Execution
    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            await window.supabaseClient.from('user_notifications').delete().eq('user_id', session.user.id);
            window.checkActiveSession(); 
        }
    }
};

window.getRootPath = getRootPath;
window.fetchJson = fetchJson;
window.fetchNavigationData = fetchNavigationData;