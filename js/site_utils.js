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

async function fetchNavigationData() {
    return fetchJson(`${getRootPath()}data/navigation.json?v=1.0`, { cache: true });
}

// --- DELTA INJECTION ENGINE ---
// Shared by admin.js, editor.js, and history.js, which each need to
// reconstruct a full description/frame-data object from a stored
// scoped patch (used for live preview, revision merging, and history
// replay respectively).
window.applyDeltaToData = function(baseDesc, baseFrame, scope, key, payload) {
    let newDesc = JSON.parse(JSON.stringify(baseDesc || {}));
    let newFrame = JSON.parse(JSON.stringify(baseFrame || {}));

    // --- SMART BATCH UNPACKER (handles bundled multi-field submissions) ---
    if (scope === 'multi' && Array.isArray(payload)) {
        payload.forEach(edit => {
            const res = window.applyDeltaToData(newDesc, newFrame, edit.scope, edit.key, edit.payload);
            newDesc = res.newDesc;
            newFrame = res.newFrame;
        });
        return { newDesc, newFrame };
    }

    // --- Safely intercept full modular replacements ---
    if (scope === 'system_data') {
        return { newDesc: JSON.parse(JSON.stringify(payload)), newFrame };
    }

    if (['profile', 'playstyle', 'overview', 'strategy'].includes(scope)) {
        newDesc[scope] = payload;
    }
    else if (scope === 'extra') {
        if (!newDesc.extras) newDesc.extras = [];
        if (payload === null) {
            newDesc.extras = newDesc.extras.filter(e => e.title !== key);
        } else {
            const idx = newDesc.extras.findIndex(e => e.title === key);
            if (idx > -1) newDesc.extras[idx] = payload; else newDesc.extras.push(payload);
        }
    }
    else if (scope === 'matchup') {
        if (!newDesc.matchups) newDesc.matchups = [];
        if (payload === null) {
            newDesc.matchups = newDesc.matchups.filter(m => m.opponent !== key);
        } else {
            const idx = newDesc.matchups.findIndex(m => m.opponent === key);
            if (idx > -1) newDesc.matchups[idx] = payload; else newDesc.matchups.push(payload);
        }
    }
    else if (scope === 'counterplay') {
        if (!newDesc.counterplay) newDesc.counterplay = [];
        if (payload === null) {
            newDesc.counterplay = newDesc.counterplay.filter(c => c.topic !== key);
        } else {
            const idx = newDesc.counterplay.findIndex(c => c.topic === key);
            if (idx > -1) newDesc.counterplay[idx] = payload; else newDesc.counterplay.push(payload);
        }
    }
    else if (scope === 'move') {
        const [cat, moveId] = key.split('::');
        if (payload === null) {
            if (newFrame[cat]) newFrame[cat] = newFrame[cat].filter(m => m.id !== moveId);
            if (newDesc.moveStrategies) delete newDesc.moveStrategies[moveId];
        } else {
            if (!newFrame[cat]) newFrame[cat] = [];
            const idx = newFrame[cat].findIndex(m => m.id === moveId);
            if (payload.frame_data) {
                if (idx > -1) newFrame[cat][idx] = payload.frame_data;
                else newFrame[cat].push(payload.frame_data);
            }
            if (!newDesc.moveStrategies) newDesc.moveStrategies = {};
            newDesc.moveStrategies[moveId] = payload.desc_data || [];
        }
    }

    return { newDesc, newFrame };
};

// --- SHARED MANGA TOOLTIP ---
// Used by description.js (inline callouts) and framedata.js (frame
// timeline phases) for the same hover tooltip, so both element types
// get identical styling regardless of which is hovered first.
let frameTooltip = null;

window.initTooltip = function() {
    if (!frameTooltip) {
        frameTooltip = document.getElementById('wiki-frame-tooltip');
        if (!frameTooltip) {
            frameTooltip = document.createElement('div');
            frameTooltip.id = 'wiki-frame-tooltip';

            frameTooltip.style.position = 'fixed';
            frameTooltip.style.zIndex = '100000';
            frameTooltip.style.pointerEvents = 'none'; // Prevents it from stealing the hover cursor
            frameTooltip.style.background = 'var(--bg-main, #050505)';
            frameTooltip.style.border = '2px solid var(--border-color, #333)';
            frameTooltip.style.padding = '0.75rem 1rem';
            frameTooltip.style.boxShadow = '6px 6px 0px var(--manga-shadow, #000)';
            // min() with a viewport-relative term so a long callout can never
            // be wider than the screen itself on a narrow phone - a fixed
            // 320px max-width left no room for positionTooltip's flip logic
            // to keep it on-screen once content pushed close to that width.
            frameTooltip.style.maxWidth = 'min(320px, calc(100vw - 2rem))';
            frameTooltip.style.color = 'var(--text-white, #fff)';
            frameTooltip.style.fontFamily = 'var(--text-mono)';
            frameTooltip.style.fontSize = '0.75rem';
            frameTooltip.style.display = 'none'; // Hidden by default

            document.body.appendChild(frameTooltip);
        }
    }
};

// Positions the shared tooltip near (x, y), flipping away from the right/bottom
// viewport edges. Shared by the mouse and touch bindings below.
function positionTooltip(x, y) {
    const box = frameTooltip.getBoundingClientRect();
    const margin = 8; // keeps it off the exact viewport edge

    if (x + 15 + box.width > window.innerWidth) x -= box.width + 15; else x += 15;
    if (y + 15 + box.height > window.innerHeight) y -= box.height + 15; else y += 15;

    // Final safety clamp: on a narrow phone, a long callout's tooltip can be
    // wide enough that flipping to the other side of the cursor still isn't
    // enough room - always pin it fully inside the viewport as a last resort,
    // regardless of how the flip above landed.
    x = Math.min(Math.max(x, margin), window.innerWidth - box.width - margin);
    y = Math.min(Math.max(y, margin), window.innerHeight - box.height - margin);

    frameTooltip.style.left = x + 'px';
    frameTooltip.style.top = y + 'px';
}

// Tapping outside whichever element currently owns the tooltip closes it.
// Registered once (lazily, alongside the tooltip element itself) rather than
// per-bindTooltip call, since bindTooltip runs once per phase/callout.
let tooltipOwner = null;
function closeTooltipIfOutside(target) {
    if (frameTooltip && tooltipOwner && !tooltipOwner.contains(target)) {
        frameTooltip.style.display = 'none';
        tooltipOwner = null;
    }
}

// Binds hover/move/leave listeners (desktop) plus a tap-to-toggle listener
// (touch, which never fires mouseenter/mousemove/mouseleave on real devices)
// that show titleHtml in the shared tooltip.
window.bindTooltip = function(element, titleHtml) {
    element.addEventListener('mouseenter', () => {
        window.initTooltip();
        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
    });

    element.addEventListener('mousemove', (e) => {
        if (frameTooltip) positionTooltip(e.clientX, e.clientY);
    });

    element.addEventListener('mouseleave', () => {
        if (frameTooltip) frameTooltip.style.display = 'none';
    });

    element.addEventListener('touchend', (e) => {
        // Prevents the browser's synthetic mouse/click compatibility events
        // from double-firing this same toggle right after touchend.
        e.preventDefault();
        window.initTooltip();

        if (!document._tooltipOutsideTapBound) {
            document.addEventListener('touchstart', (ev) => closeTooltipIfOutside(ev.target));
            document._tooltipOutsideTapBound = true;
        }

        if (tooltipOwner === element && frameTooltip.style.display === 'block') {
            frameTooltip.style.display = 'none';
            tooltipOwner = null;
            return;
        }

        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
        tooltipOwner = element;

        const touch = e.changedTouches[0];
        positionTooltip(touch.clientX, touch.clientY);
    });
};

// --- PAGE URL BUILDER ---
// Returns a root-relative path (no '../' prefix - see markNotifRead, which
// prepends getRootPath() at click time). Callers that need a navigable
// path from the current page should do the same rather than baking a
// fixed depth into the stored value, since e.g. notification links are
// shown from every page on the site, at every folder depth.
window.buildPageUrl = function(pageId, pageType) {
    if (pageType === 'tierlist') return 'systems/tierlist/index.html';
    if (pageType === 'system') return `systems/${pageId}/index.html`;
    const folderName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    return `characters/${folderName}/index.html`;
};

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
    if (document.getElementById('auth-modal-overlay')) return;

    // 1. The Better Auth Modal (Login & Register Tabs)
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
                    <input type="text" id="auth-name-register" class="editor-input" placeholder="Display Name (Public)" style="margin-bottom: 0.25rem;">
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

    // 2. The Custom Profile Modal
    const profileModalHTML = `
    <div id="profile-modal-overlay" class="modal-overlay hidden">
        <div class="modal-box modal-sm accent-purple">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>SYSTEM PROFILE</h3>
                <span class="status-dot online"></span>
            </div>
            <div class="modal-body">
                <p style="font-family: var(--text-mono); font-size: 0.75rem; color: var(--text-muted); margin-top: 0; margin-bottom: 1.5rem; text-transform: uppercase;">
                    Logged in as: <strong id="profile-current-name" style="color: var(--text-white);"></strong>
                </p>
                <div class="editor-row" style="flex-direction: column; gap: 0.5rem;">
                    <label style="font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-muted); text-align: left;">NEW DISPLAY NAME</label>
                    <input type="text" id="profile-new-name" class="editor-input" placeholder="Enter custom display name...">
                </div>
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

    // 3. The Custom System Alert Modal
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

    // Inject all three into the DOM
    const div = document.createElement('div');
    div.innerHTML = authModalHTML + profileModalHTML + alertModalHTML;
    while(div.firstChild) document.body.appendChild(div.firstChild);

    // --- LOGIC: TABS ---
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

    // --- LOGIC: LOGIN ---
    document.getElementById('btn-auth-action-login').addEventListener('click', async (e) => {
        const email = document.getElementById('auth-email-login').value;
        const password = document.getElementById('auth-password-login').value;
        const btn = e.target;
        
        if (!email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "Please enter both email and password."; return; 
        }
        
        btn.textContent = "VERIFYING..."; btn.disabled = true;
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
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

    // --- LOGIC: REGISTER ---
    document.getElementById('btn-auth-action-register').addEventListener('click', async (e) => {
        const name = document.getElementById('auth-name-register').value.trim();
        const email = document.getElementById('auth-email-register').value.trim();
        const password = document.getElementById('auth-password-register').value;
        const btn = e.target;
        
        if (!name || !email || !password) {
            feedbackMsg.classList.remove('hidden'); feedbackMsg.style.color = '#ef4444'; feedbackMsg.style.background = 'rgba(239,68,68,0.1)';
            feedbackMsg.textContent = "All fields are required to register."; return; 
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
            
            // Auto-login fallback if verification isn't strictly required
            if (data.session) {
                setTimeout(() => {
                    document.getElementById('auth-modal-overlay').classList.add('hidden');
                    window.checkActiveSession();
                }, 2000);
            }
        }
    });

    // 5. Bind Profile Modal Logic (Save & Logout)
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
            const newNameInp = document.getElementById('profile-new-name');
            const newName = newNameInp.value.trim();
            const currentName = document.getElementById('profile-current-name').textContent;

            if (newName && newName !== currentName) {
                btnSave.textContent = "SAVING..."; btnSave.disabled = true;
                const { error } = await window.supabaseClient.auth.updateUser({ data: { display_name: newName } });
                btnSave.disabled = false; btnSave.textContent = "SAVE CHANGES";

                if (!error) {
                    document.getElementById('profile-modal-overlay').classList.add('hidden');
                    window.checkActiveSession(); 
                } else {
                    alert("Failed to update name. Check console."); console.error(error);
                }
            } else {
                document.getElementById('profile-modal-overlay').classList.add('hidden');
            }
        });
    }

    // Bind System Alert Close Button
    document.getElementById('btn-alert-close')?.addEventListener('click', () => {
        document.getElementById('alert-modal-overlay').classList.add('hidden');
    });
};

// --- GLOBAL SYSTEM ALERT ---
window.showSystemAlert = function(message) {
    window.injectAuthModal(); // Ensure it exists in the DOM
    const msgEl = document.getElementById('alert-modal-msg');
    if (msgEl) msgEl.textContent = message;
    document.getElementById('alert-modal-overlay').classList.remove('hidden');
};

// --- USERNAME & PROFILE SYSTEM ---
window.currentGlobalUsername = "Anonymous"; // Global cache for the editor to use

window.getDisplayName = function(session) {
    if (!session || !session.user) return "Anonymous";
    
    // Fallback to empty object if metadata is null
    const meta = session.user.user_metadata || {};
    
    // Priority: 1. Custom Profile Name -> 2. OAuth Full Name -> 3. Old Discord Claim -> 4. Email Prefix
    return meta.display_name || meta.full_name || meta.custom_claims?.global_name || meta.user_name || session.user.email.split('@')[0];
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
        
        document.getElementById('profile-modal-overlay').classList.remove('hidden');
        nameInput.focus(); 
        return; 
    }

    // IF NOT LOGGED IN: Open the Auth Modal
    document.getElementById('auth-modal-overlay').classList.remove('hidden');
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
    
    if (session) {
        window.currentGlobalUsername = window.getDisplayName(session);
    } else {
        window.currentGlobalUsername = "Anonymous";
    }

    // 2. Delegate to the unified PageBuilder Dock Engine!
    if (typeof window.initSidebarEditButton === 'function') {
        await window.initSidebarEditButton();
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
            // Read the resolved color rather than option.style.color: options
            // are colored via CSS classes (e.g. the DAW track-color dropdown's
            // .daw-option-* classes), not inline styles, so the inline-only
            // check used to always miss them.
            const optColor = getComputedStyle(option).color;
            if (optColor) optDiv.style.color = optColor;
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

    // Build the invisible Modal Container safely into Tier 1 Architecture
    let modal = document.getElementById('site-notification-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-notification-modal';
        modal.className = 'modal-overlay hidden'; // FIXED: Strict DSL overlay
        document.body.appendChild(modal);
    }

    let notifHTML = notifs.length === 0 
        ? `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted); font-family: var(--text-mono); font-size: 0.75rem;">Inbox is empty.</div>`
        : notifs.map(n => `
            <div class="notif-item ${n.is_read ? 'read' : 'unread'}" id="notif-row-${n.id}"
                 style="padding: 1rem 1.5rem; border-bottom: 1px dashed var(--border-color); background: ${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}; cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden;" 
                 onclick="markNotifRead('${n.id}', '${n.link || ''}')"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'" 
                 onmouseout="this.style.background='${n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)'}'">
                
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.65rem; color: ${n.is_read ? 'var(--text-muted)' : 'var(--accent-blue)'}; font-family: var(--text-mono);">${new Date(n.created_at).toLocaleDateString()}</span>
                    
                    <div style="display: flex; gap: 0.75rem; align-items: center;">
                        ${!n.is_read ? `<span id="notif-dot-${n.id}" class="status-dot online" style="background: var(--accent-blue); color: var(--accent-blue); width: 8px; height: 8px;"></span>` : ''}
                        <button onclick="deleteNotification('${n.id}', event)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:0; display:flex; transition:color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted)'" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.85rem; color: ${n.is_read ? 'var(--text-primary)' : 'var(--text-white)'}; line-height: 1.5; padding-right: 1rem;">${n.message}</p>
            </div>
        `).join('');

    // Inject exact DSL Geometry
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
    if (dot) dot.classList.add('hidden');

    // 2. Fire database update in the background
    if (window.supabaseClient) {
        window.supabaseClient.from('user_notifications').update({ is_read: true }).eq('id', id).then(() => {
            // Re-run the session checker to update the red bell badge count on the sidebar!
            window.checkActiveSession();
        });
    }
    
    // 3. Navigate if a link was provided
    // Links are stored root-relative (see window.buildPageUrl) since
    // notifications are shown from every page at every folder depth -
    // resolve against the CURRENT page's root, not wherever the link
    // was originally constructed from.
    if (link && link !== 'null' && link !== '') {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
        window.location.href = rootPath + link;
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