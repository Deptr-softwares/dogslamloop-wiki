/**
 * Dogslamloop Wiki - Shared Site Utilities
 *
 * What every other file leans on: the reader's settings, paths and page
 * URLs, the Supabase client, escaping, the role ladder, the system alert and
 * the dialog engine. Three files follow this one on every page that loads
 * it, in this order: site_data.js, site_media.js, site_account.js.
 */

// --- SITE SETTINGS (v1.1) ---
//
// A reader's own settings, kept per device in one JSON object, the same shape
// as the editor's Config (js/editor/core/editor-config.js), so a later setting is one more
// key rather than one more store. Signed in or not makes no difference;
// nothing here reaches the account or the database.
//
// html.reduce-motion is the ONE switch every "less motion" rule reads. It is
// on when the device asks for reduced motion or the reader ticked "Turn off
// animations", so the CSS states each rule once rather than once per source.
// First in the file so the class is on before anything starts moving.
(function () {
    const STORE_KEY = 'dsl_site_settings';
    // look: 'default' or 'classic' (v1.2). html.look-classic does nothing on a
    // page that does not load style/look-classic.css, which is how the editor
    // and staff pages keep the default look.
    const DEFAULTS = Object.freeze({ motionOff: false, look: 'default' });

    function readStore() {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            // Storage blocked, or a value nobody here wrote: the defaults.
            return {};
        }
    }

    let stored = readStore();
    const deviceReduce = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function get(key) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
        const value = stored[key];
        return typeof value === typeof DEFAULTS[key] ? value : DEFAULTS[key];
    }

    function apply() {
        document.documentElement.classList.toggle('reduce-motion',
            get('motionOff') || !!(deviceReduce && deviceReduce.matches));
        document.documentElement.classList.toggle('look-classic', get('look') === 'classic');
    }

    // Returns whether the value was saved, so the panel can say when it was
    // not. Applied either way: it still holds until the page is left.
    function set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || typeof value !== typeof DEFAULTS[key]) return false;
        stored = Object.assign({}, stored, { [key]: value });
        apply();
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
            return true;
        } catch (e) {
            return false;
        }
    }

    if (deviceReduce && typeof deviceReduce.addEventListener === 'function') deviceReduce.addEventListener('change', apply);
    apply();

    window.siteSettings = { get, set, DEFAULTS };

    // For a scroll a script starts. CSS's scroll-behavior does not reach
    // scrollTo or scrollIntoView, so until this a device asking for less
    // motion still got every scripted scroll smooth.
    window.scrollMotion = () => (document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth');
})();

// How wide a panel heading's words are, for the bar on its underline
// (style/Common.css, .section-title::after). Measured as the pointer enters a
// panel, so a heading filled in after the page loaded (applyHubHeadings) is
// measured as it reads now.
document.addEventListener('pointerenter', e => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches('.wiki-section, .wiki-card, .section-title')) return;
    const titles = el.matches('.section-title') ? [el] : el.querySelectorAll('.section-title');
    titles.forEach(title => {
        const words = document.createRange();
        words.selectNodeContents(title);
        title.style.setProperty('--title-words', `${Math.ceil(words.getBoundingClientRect().width)}px`);
    });
}, true);

// A slanted tab punches when a click puts it in place (v1.1,
// style/Buttons.css). Checked a frame later, after the page's own handler has
// made it .active, and that handler may have drawn the row again, in which
// case the tab is found by its id. A filter switched off is not .active, so
// it stays still.
document.addEventListener('click', e => {
    const clicked = e.target instanceof Element ? e.target.closest('.btn-manga-slanted') : null;
    if (!clicked) return;
    requestAnimationFrame(() => {
        const tab = clicked.isConnected ? clicked : (clicked.id && document.getElementById(clicked.id));
        if (!tab || !tab.classList.contains('active')) return;
        tab.classList.remove('tab-punch');
        void tab.offsetWidth; // restart it on a second click
        tab.classList.add('tab-punch');
        tab.addEventListener('animationend', () => tab.classList.remove('tab-punch'), { once: true });
    });
});

// The Site settings panel, opened from the button beside the account button
// (js/pages/core/pagebuilder.js initAuthDock). Built on first open; every value in it is
// the site's own, so nothing is escaped.
window.openSiteSettings = function () {
    let overlay = document.getElementById('site-settings-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'site-settings-overlay';
        overlay.className = 'modal-overlay hidden';
        overlay.innerHTML = `
            <div class="modal-box modal-sm accent-blue" role="dialog" aria-modal="true" aria-labelledby="site-settings-title">
                <div class="modal-header"><h3 id="site-settings-title">Site settings</h3></div>
                <div class="modal-body site-settings-body">
                    <fieldset class="site-setting-group">
                        <legend class="site-setting-name">Look</legend>
                        <label class="site-setting" for="site-setting-look-default">
                            <input type="radio" name="site-setting-look" id="site-setting-look-default" value="default">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Default</span>
                                <span class="site-setting-hint">The site's usual look.</span>
                            </span>
                        </label>
                        <label class="site-setting" for="site-setting-look-classic">
                            <input type="radio" name="site-setting-look" id="site-setting-look-classic" value="classic">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Classic</span>
                                <span class="site-setting-hint">A plain, dark wiki look. The editor and staff pages keep the usual look.</span>
                            </span>
                        </label>
                    </fieldset>
                    <label class="site-setting" for="site-setting-motion-off">
                        <input type="checkbox" id="site-setting-motion-off">
                        <span class="site-setting-text">
                            <span class="site-setting-name">Turn off animations</span>
                            <span class="site-setting-hint">Stops hover lifts, button sweeps, flashes and smooth scrolling. If your device is set to reduce motion, the site already follows it.</span>
                        </span>
                    </label>
                    <p class="site-settings-note">Saved on this device only.</p>
                    <p class="site-settings-error" hidden>This browser blocked saving, so the setting only lasts until you leave this page.</p>
                </div>
                <div class="modal-footer"><button type="button" class="btn-sys btn-sys-regular" data-site-settings-close>CLOSE</button></div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.classList.add('hidden');
        overlay.addEventListener('click', e => {
            // The backdrop itself, or CLOSE.
            if (e.target === overlay || e.target.closest('[data-site-settings-close]')) close();
        });
        overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
        overlay.querySelector('#site-setting-motion-off').addEventListener('change', e => {
            const saved = window.siteSettings.set('motionOff', e.target.checked);
            overlay.querySelector('.site-settings-error').hidden = saved;
        });
        overlay.querySelector('.site-setting-group').addEventListener('change', e => {
            const saved = window.siteSettings.set('look', e.target.value);
            overlay.querySelector('.site-settings-error').hidden = saved;
        });
    }
    const look = window.siteSettings.get('look') === 'classic' ? 'classic' : 'default';
    overlay.querySelector(`#site-setting-look-${look}`).checked = true;
    overlay.querySelector('#site-setting-motion-off').checked = window.siteSettings.get('motionOff');
    overlay.classList.remove('hidden');
    overlay.querySelector(`#site-setting-look-${look}`).focus();
};

const fetchPromiseCache = {};

// Counts directory depth rather than naming the directories. The old version
// tested for '/characters/' and '/systems/' explicitly and returned './' for
// anything else - so a page under any new directory (others/, tools/) would
// resolve every data fetch and asset path against the wrong root and 404.
// Depth works for a directory that does not exist yet, which is the point.
//
// The site is served from the domain root (GitHub Pages with a custom domain,
// and the test server likewise), so path segments map directly to depth.
function getRootPath() {
    const segments = window.location.pathname.split('/').filter(Boolean);

    // Drop a trailing filename so /systems/hud/index.html and /systems/hud/
    // are the same depth. A dot is the only thing separating the two here:
    // directory names on this site never contain one.
    if (segments.length && segments[segments.length - 1].includes('.')) segments.pop();

    return segments.length ? '../'.repeat(segments.length) : './';
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

// --- PAGE URL BUILDER ---
// Returns a root-relative path (no '../' prefix - see markNotifRead, which
// prepends getRootPath() at click time). Callers that need a navigable
// path from the current page should do the same rather than baking a
// fixed depth into the stored value, since e.g. notification links are
// shown from every page on the site, at every folder depth.
// WHERE A PAGE LIVES IS DATA, NOT CONVENTION - and that changed under this
// function without it noticing. page_type used to decide the directory, so a
// system page was always systems/<id>/. Then others/ and tools/ arrived: an
// Emotes gallery lives in others/ and renders exactly like a system page, and
// site_pages.url has stored the real path ever since (see PAGE_DIRECTORIES in
// js/owner/owner.js, which spells out that these are two different questions).
//
// Deriving the path anyway sent every Recent Changes link and every approval
// notification for a tool, a gallery, or one of the system pages under others/
// to a 404. navigation.json already carries the answer, so look it up.
let pageUrlIndex = null;
// Each page's kind, read from the same two files in the same pass.
let pageTypeIndex = {};

/**
 * Loads the pageId -> url index buildPageUrl prefers. Idempotent, and the
 * fetches underneath are promise-cached, so awaiting this before each render
 * costs nothing after the first call.
 *
 * Await it before rendering anything that links to a page by id.
 */
window.primePageUrlIndex = async function() {
    if (pageUrlIndex) return pageUrlIndex;

    const index = {};
    const types = {};
    let navLoaded = false;
    try {
        const nav = await fetchNavigationData();
        for (const entries of Object.values(nav || {})) {
            for (const entry of entries || []) {
                const config = entry && entry.cms_config;
                const id = config && config.pageId;
                if (id && entry.url) index[id] = entry.url;
                if (id && config.pageType) types[id] = config.pageType;
            }
        }
        navLoaded = true;
    } catch (e) {
        // Leave pageUrlIndex null so a later call can retry rather than
        // caching an empty index and falling back forever.
        console.warn('[buildPageUrl] navigation.json unavailable; using the folder convention.', e);
    }

    // Archived pages are deliberately absent from navigation.json but keep a
    // tombstone stub at their stored URL, and an approved revision can still
    // point at one. Returns {} on any failure, so this cannot throw.
    const archived = await fetchArchivedPages();
    for (const [id, row] of Object.entries(archived)) {
        if (row && row.url && !index[id]) index[id] = row.url;
        if (row && row.pageType && !types[id]) types[id] = row.pageType;
    }

    if (navLoaded) {
        pageUrlIndex = index;
        pageTypeIndex = types;
    }
    return index;
};

// A page's kind (character, system, tierlist...) from the site's own page
// list, or null for a page the list does not know. A submission names its
// page's kind as well, but that is only the submitter's word, so the preview,
// History, the editor links and approval all ask here instead (owner,
// 2026-11-21).
window.registeredPageType = async function(pageId) {
    await window.primePageUrlIndex();
    return pageTypeIndex[pageId] || null;
};

window.buildPageUrl = function(pageId, pageType) {
    // The stored path wins wherever it is known.
    if (pageUrlIndex && pageUrlIndex[pageId]) return pageUrlIndex[pageId];

    // Convention fallback, for a caller that has not primed the index and for
    // a page id the registry has never heard of. Right for the two original
    // page kinds and wrong for anything in others/ or tools/ - which is the
    // whole reason the index exists, and why this is a last resort rather than
    // the answer.
    if (pageType === 'tierlist') return 'systems/tierlist/index.html';
    if (pageType === 'system') return `systems/${pageId}/index.html`;
    const folderName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    return `characters/${folderName}/index.html`;
};

// --- GLOBAL SUPABASE BACKEND ---
const SUPABASE_URL = 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// --- LOCAL-ONLY BACKEND OVERRIDE (v0.14) ---
//
// Points a locally served copy of the site at a different Supabase project -
// in practice a branching preview database - so a feature can be clicked
// through against real Postgres before its migration ever reaches production.
//
// This exists because of a gap the test suite cannot close. Every auth spec in
// this project mocks Supabase and never touches a database, so RLS predicates,
// grant gaps, trigger ordering and RPC guards are all unverified until
// somebody uses them. Supabase branching proves a migration APPLIES; it does
// not prove the feature WORKS, and those are different claims. Without this,
// the first real click on a release's worth of policies happens on production.
//
// GUARDED TWICE, and both guards are deliberate:
//
//   1. The hostname must be localhost or a loopback address. dogslamloop.com
//      can never satisfy this, whatever is in storage.
//   2. A localStorage key must be set by hand. Visiting a local copy does not
//      opt you in; you have to have asked for it.
//
// Neither guard depends on a build flag or an environment variable, because
// this site has neither - it is static files served as-is, so the check has to
// be something true of the running page.
//
// Usage, in the console of a locally served page:
//   localStorage.setItem('dsl_supabase_override',
//     JSON.stringify({ url: 'https://<ref>.supabase.co', key: '<anon key>' }));
//   location.reload();
//
// Clear it with localStorage.removeItem('dsl_supabase_override').
function resolveSupabaseTarget() {
    const target = { url: SUPABASE_URL, key: SUPABASE_KEY, overridden: false };

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
    if (!isLocal) return target;

    try {
        const raw = window.localStorage.getItem('dsl_supabase_override');
        if (!raw) return target;

        const parsed = JSON.parse(raw);
        // A malformed override must fall back to production rather than
        // leaving the page with no backend at all.
        if (!parsed || typeof parsed.url !== 'string' || typeof parsed.key !== 'string') return target;
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(parsed.url)) return target;

        target.url = parsed.url.replace(/\/$/, '');
        target.key = parsed.key;
        target.overridden = true;
    } catch (e) {
        // Storage can throw in a locked-down context. Production is the answer.
    }

    return target;
}

// An on-page banner, not just a console warning, and it was added after the
// override drew blood on its first day of use.
//
// What happened: a preview branch was created, tested, and then deleted - and
// the override stayed in localStorage pointing at a project that no longer
// existed. Every request failed, login stopped working, and nothing on screen
// said why. A console warning is invisible to somebody who is not already
// suspicious, and the whole failure mode of this feature is not being
// suspicious of a page that looks completely normal.
//
// So: impossible to miss, and one click to undo.
function showOverrideBanner(url) {
    const paint = () => {
        if (!document.body || document.getElementById('dsl-override-banner')) return;

        const bar = document.createElement('div');
        bar.id = 'dsl-override-banner';
        bar.setAttribute('role', 'status');
        bar.style.cssText = [
            'position:fixed', 'left:0', 'bottom:0', 'z-index:2147483647',
            'background:#eab308', 'color:#000', 'font-family:monospace',
            'font-size:11px', 'padding:6px 10px', 'display:flex',
            'align-items:center', 'gap:10px', 'max-width:100vw',
            'box-sizing:border-box', 'border-top:2px solid #000',
        ].join(';');

        let host = url;
        try { host = new URL(url).hostname; } catch (e) { /* keep the raw string */ }

        const label = document.createElement('strong');
        label.textContent = `LOCAL SUPABASE OVERRIDE → ${host}`;
        bar.appendChild(label);

        // The page most likely to be confusing, called out by name. index.html
        // is the only page on the site carrying a CSP, and its connect-src
        // pins the production project - so requests from here are blocked no
        // matter what the client was built with.
        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (csp && csp.getAttribute('content') && csp.getAttribute('content').includes('connect-src')
            && !csp.getAttribute('content').includes(host)) {
            const warn = document.createElement('span');
            warn.textContent = "— this page's CSP blocks it; use any other page";
            bar.appendChild(warn);
        }

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = 'USE PRODUCTION';
        clear.style.cssText = 'font:inherit;cursor:pointer;padding:2px 8px;border:2px solid #000;background:#fff';
        clear.addEventListener('click', () => {
            try { window.localStorage.removeItem('dsl_supabase_override'); } catch (e) { /* ignore */ }
            window.location.reload();
        });
        bar.appendChild(clear);

        document.body.appendChild(bar);
    };

    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint);
}

// Attach client to the global window object so editor.js can use it later
window.supabaseClient = null;
try {
    const target = resolveSupabaseTarget();
    if (window.supabase && target.url.startsWith('http')) {
        window.supabaseClient = window.supabase.createClient(target.url, target.key);
        window.supabaseIsOverridden = target.overridden;
        if (target.overridden) {
            // Loud on purpose. Testing against a preview database and thinking
            // it is production - or the reverse - is the one way this helps
            // nobody, so it says so on every single page load.
            console.warn(`[Supabase] LOCAL OVERRIDE ACTIVE -> ${target.url}. This is not production.`);
            showOverrideBanner(target.url);
        }
    }
} catch (e) {
    console.error("Failed to connect to global Supabase instance:", e);
}

// --- GLOBAL SYSTEM ALERT ---
window.showSystemAlert = function(message) {
    window.injectAuthModal(); // Ensure it exists in the DOM
    const msgEl = document.getElementById('alert-modal-msg');
    if (msgEl) msgEl.textContent = message;
    window.runDialog(document.getElementById('alert-modal-overlay'), {
        buttons: [[document.getElementById('btn-alert-close')]],
    });
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

        // Sync trigger text if the DAW programmatic logic changes value. The
        // highlighted option too: a value set from code used to leave the open
        // list marking the old option (the tier editor's Character art,
        // 2026-10-01).
        select.addEventListener('change', () => {
            trigger.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';
            optionsContainer.querySelectorAll('.manga-option').forEach((el, i) =>
                el.classList.toggle('selected', i === select.selectedIndex));
        });
    });
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

    // Started here rather than from page_boot.js because this file is the only
    // one loaded by every page - the hand-authored ones (tier list,
    // collaborators, the hubs) never go through the boot sequence, and
    // flagged media has to come off those too. Returns immediately when
    // nothing is flagged, which is the normal case.
    if (typeof window.initBlockedMediaGuard === 'function') window.initBlockedMediaGuard();

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

// --- ESCAPING, AND THE ACCESS-DENIED SCREEN ---
//
// The one HTML escaper, called as window.escapeHtml everywhere. Only
// page_router.js keeps a copy, because it runs before this file loads
// (tests/one-escape-helper.spec.js). It escapes both quote characters as well
// as & < >, so it is safe in text and in attribute values alike; null and
// undefined become ''.
window.escapeHtml = function(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Contributor text that may carry the one tag editors type on purpose: <br>,
// for a line break inside a stat value ("5 for kick<br>9 for distortion").
// On 2026-10-18 production held 133 of them and no other tag anywhere in frame
// data or profile stats. Everything is escaped, then only that tag is put back,
// so a value can still break a line and can no longer add an element.
window.escapeHtmlKeepBreaks = function(str) {
    return window.escapeHtml(str).replace(/&lt;\s*\/?\s*br\s*\/?\s*&gt;/gi, '<br>');
};

// Escapes every character a RegExp reads as syntax, so the text matches as
// written.
window.escapeRegExp = function(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// What a staff page's gate shows someone it turns away. It replaces the whole
// page, so nothing the gate protects stays on screen.
window.showAccessDenied = function() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
};

// --- THE ROLE LADDER ---
//
// Orders the role names, mirroring public.role_rank() in
// supabase/migrations/20260825000001_role_rank.sql (v0.16 bug 6).
//
// It exists because every perk in this codebase used to test a literal role
// name, so nothing anywhere stated that a reviewer outranks a trusted editor -
// which is why the decision that reviewers have a trusted editor's perks
// reached one of the three places it should have.
//
// Keep the two in step. They are deliberately the same ladder rather than the
// same code: SQL cannot call this, and a perk enforced only here would be a
// suggestion. Where a rule matters, the database version is the boundary and
// this one decides what the interface shows.
// owner outranks admin as of v0.17. Until then "admin" WAS the owner; the two
// were split when a second staff member joined, and the SQL half of this lives
// in role_rank() (supabase/migrations/20260827000003_owner_role.sql). Both
// ladders must carry the same numbers, or the interface promises access the
// database refuses.
window.ROLE_RANK = { owner: 5, admin: 4, reviewer: 3, trusted_editor: 2, viewer: 1 };

window.roleRank = function (roleName) {
    // 0 for null, undefined, '' and any unknown string - the same total
    // behaviour the SQL CASE gets from its ELSE branch. Comparisons against
    // this are then always meaningful, which is the point.
    return window.ROLE_RANK[String(roleName || '').trim().toLowerCase()] || 0;
};

// "Does this person clear the bar the page asks for?" Written once so a fourth
// perk cannot be added while forgetting one of the roles that should have it.
window.roleMeets = function (roleName, requiredRole) {
    return window.roleRank(roleName) >= window.roleRank(requiredRole);
};

// The same question against the ARRAY the pages actually hold.
//
// user_roles has UNIQUE(user_id) so there is only ever one, but every caller
// stores it as a list and `roles.includes('admin')` is the shape this replaces
// - a literal test that silently stopped matching the owner the moment the
// role was renamed. `some` rather than `[0]` so a stale multi-entry array
// still answers correctly instead of reading whichever happened to be first.
window.rolesMeet = function (roles, requiredRole) {
    return (roles || []).some(r => window.roleMeets(r, requiredRole));
};

// --- DIALOGS ---
//
// Runs every confirm, message and prompt box on the site. Each box keeps its
// own markup and look; this shows it, resolves with the value of the button
// pressed, and takes its listeners off again (tests/dialog-engine.spec.js).
//
//   buttons    [[element, value]]; a function value is called at the press
//   cancel     what Escape, a backdrop click or a refused open resolves to
//   escape, backdrop   true to close on them
//   enter      what Enter resolves to; keyTarget is where keys are listened
//              for (default: document)
//   focus      the element focused once the box shows
//   onClose    undoes the caller's setup; runs on close and on a refusal
//
// One question per box: a box already showing refuses the new one with
// `cancel`, so a double click can never run an action twice. A message box
// does not return the promise: nothing waits for a reader to acknowledge one.
window.runDialog = function (overlay, opts = {}) {
    const { buttons = [], cancel, escape, backdrop, enter, keyTarget = document, focus, onClose } = opts;
    if (!overlay.classList.contains('hidden')) {
        if (onClose) onClose();
        return Promise.resolve(cancel);
    }
    return new Promise((resolve) => {
        const listeners = [];
        const listen = (target, type, handler) => {
            target.addEventListener(type, handler);
            listeners.push(() => target.removeEventListener(type, handler));
        };
        const close = (value) => {
            const answer = typeof value === 'function' ? value() : value;
            overlay.classList.add('hidden');
            listeners.forEach(off => off());
            if (onClose) onClose();
            resolve(answer);
        };
        buttons.forEach(([button, value]) => listen(button, 'click', () => close(value)));
        if (backdrop) listen(overlay, 'click', (e) => { if (e.target === overlay) close(cancel); });
        if (escape || enter !== undefined) {
            listen(keyTarget, 'keydown', (e) => {
                if (escape && e.key === 'Escape') { e.preventDefault(); close(cancel); }
                else if (enter !== undefined && e.key === 'Enter') { e.preventDefault(); close(enter); }
            });
        }
        overlay.classList.remove('hidden');
        if (focus) focus.focus();
    });
};

// The staff pages' confirm box, #admin-confirm-modal on admin.html and
// owner.html.
window.adminConfirm = function (message) {
    document.getElementById('admin-confirm-msg').textContent = message;
    return window.runDialog(document.getElementById('admin-confirm-modal'), {
        buttons: [
            [document.getElementById('btn-admin-confirm-ok'), true],
            [document.getElementById('btn-admin-confirm-cancel'), false],
        ],
        cancel: false,
    });
};

// A confirmation for code that runs on every page, in a box of its own built
// once from the .modal-overlay / .modal-box classes the notification inbox
// uses: the editor's box is only on edit.html and post-editor.html.
window.siteConfirm = function (message, opts = {}) {
    let modal = document.getElementById('site-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'site-confirm-modal';
        modal.className = 'modal-overlay hidden';
        modal.innerHTML = `
            <div class="modal-box accent-red modal-sm">
                <div class="modal-header"><h3 id="site-confirm-title">CONFIRM</h3></div>
                <div class="modal-body site-confirm-body">
                    <p id="site-confirm-text" class="site-confirm-text"></p>
                    <div class="site-confirm-actions">
                        <button id="site-confirm-cancel" class="btn-sys btn-sys-regular">CANCEL</button>
                        <button id="site-confirm-ok" class="btn-sys btn-sys-red">CONFIRM</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#site-confirm-title');
    const textEl = modal.querySelector('#site-confirm-text');
    const btnCancel = modal.querySelector('#site-confirm-cancel');
    const btnOk = modal.querySelector('#site-confirm-ok');

    // textContent, not innerHTML: the only current caller passes a fixed string,
    // but a confirmation is exactly the kind of thing that later gets handed a
    // page title or a contributor's name.
    titleEl.textContent = opts.title || 'CONFIRM';
    textEl.textContent = message;
    btnOk.textContent = opts.confirmText || 'CONFIRM';

    // Backdrop and Escape both cancel. This is a destructive action, so every
    // ambiguous exit resolves to "no".
    return window.runDialog(modal, {
        buttons: [[btnCancel, false], [btnOk, true]],
        cancel: false, escape: true, backdrop: true, focus: btnOk,
    });
};

// --- THE MOBILE PREVIEW SWITCH ---
// edit.html, admin.html and post-editor.html show the work and its preview
// side by side, and below 900px one at a time. body.mobile-preview-active is
// the class editor.css and admin.css switch on; #mobile-preview-toggle says
// what pressing it does. Each page goes back to something different, so its
// button carries that wording in data-hide-text.
window.toggleMobilePreview = function() {
    const shown = document.body.classList.toggle('mobile-preview-active');
    const btn = document.getElementById('mobile-preview-toggle');
    if (btn) btn.textContent = shown ? btn.dataset.hideText : 'SHOW PREVIEW';
};

// Takes a reviewer to the preview when something opens in it. Nothing happens
// where the switch is not shown (a wide screen) or the preview already is.
window.showMobilePreview = function() {
    const btn = document.getElementById('mobile-preview-toggle');
    if (!btn || getComputedStyle(btn).display === 'none') return;
    if (!document.body.classList.contains('mobile-preview-active')) window.toggleMobilePreview();
};

// --- GLOBALS THE OTHER FILES CALL ---
window.getRootPath = getRootPath;
window.fetchJson = fetchJson;
window.fetchNavigationData = fetchNavigationData;
