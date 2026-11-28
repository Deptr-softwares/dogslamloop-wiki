/**
 * What every other file leans on, loaded on every page right after the Supabase
 * library: the reader's Site Settings, paths and page addresses, the Supabase client
 * and its local-only override, the escapers, the role ladder, the system alert, the
 * dropdowns, the dialog engine, the toasts, the banner and the tab strips' roles and keys.
 * site_data.js, site_media.js and site_account.js follow it, in that order.
 * @since v0.3
 * @touches localStorage (dsl_site_settings, dsl_supabase_override),
 *   data/navigation.json and data/archived-pages.json (page addresses)
 * @watch ROLE_RANK mirrors role_rank() in SQL: change both together. The SQL one is
 *   the boundary; this one decides what the interface shows.
 * @see docs/shared-code.md
 */

// Site Settings: a reader's own settings, per device, in one JSON object shaped
// like the editor's Config, so a new setting is one more key. Nothing reaches the
// account or the database. window.applySiteSettings, in every page's <head>
// (scripts/page-scripts.js), has already applied them before the first paint; this
// store checks each value and applies again after a change. html.reduce-motion is
// the one switch every "less motion" rule reads: on when the device asks for it or
// the reader ticked "Turn off animations".
(function () {
    const STORE_KEY = 'dsl_site_settings';
    // look: 'default' or 'classic' (v1.2). html.look-classic switches off every
    // sheet's Dogslamloop part, on every page (docs/looks.md).
    // fontTitle, fontLabel, fontBody: '' (the look's own) or a key of FACES.
    // countVisits: whether js/others/analytics.js loads Umami on this device.
    const DEFAULTS = Object.freeze({ motionOff: false, look: 'default', fontTitle: '', fontLabel: '', fontBody: '', countVisits: true });
    // The faces each font can take, by key: the page reads a face's families from
    // --face-<key> (style/Common.css). Named here once, for the store and the box.
    const FACES = Object.freeze({ 'finger-paint': 'Finger Paint', 'wild-words': 'CC Wild Words', serif: 'Serif', sans: 'Sans-serif', mono: 'Monospace' });
    // The values a setting may hold, where it is a choice.
    const faceKeys = ['', ...Object.keys(FACES)];
    const CHOICES = Object.freeze({ look: ['default', 'classic'], fontTitle: faceKeys, fontLabel: faceKeys, fontBody: faceKeys });

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

    // A value of the default's type, and one of its choices: a face taken away
    // later reads as the look's own.
    function valid(key, value) {
        return typeof value === typeof DEFAULTS[key] && (!CHOICES[key] || CHOICES[key].includes(value));
    }

    function get(key) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
        return valid(key, stored[key]) ? stored[key] : DEFAULTS[key];
    }

    function apply() {
        const checked = {};
        Object.keys(DEFAULTS).forEach(key => { checked[key] = get(key); });
        window.applySiteSettings(checked);
    }

    // Returns whether the value was saved, so the panel can say when it was
    // not. Applied either way: it still holds until the page is left.
    function set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || !valid(key, value)) return false;
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

    window.siteSettings = { get, set, DEFAULTS, FACES };

    // For a scroll a script starts. CSS's scroll-behavior does not reach
    // scrollTo or scrollIntoView, so until this a device asking for less
    // motion still got every scripted scroll smooth.
    window.scrollMotion = () => (document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth');
})();

// How wide a panel heading's words are, for the bar on its underline
// (style/Common.css, .section-title::after), measured as the pointer enters, so a
// heading filled in later is measured as it reads now.
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

// A slanted tab punches when a click puts it in place (style/Buttons.css), checked
// a frame later, after the page's handler has made it .active (or drawn the row
// again, so it is found by id). A filter switched off is not .active.
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

/**
 * Opens the Site Settings box (the button beside the account button). The box is
 * js/utility/site_settings.js, loaded the first time it opens. A failure says so
 * rather than doing nothing.
 */
window.openSiteSettings = function () {
    return window.loadSiteFile('js/utility/site_settings.js').then(() => window.showSiteSettings(), error => {
        console.error('[Settings] Could not load Site Settings:', error);
        window.showSystemAlert('Could not open Site settings. Try refreshing.');
    });
};

const fetchPromiseCache = {};

// By directory depth, never by directory name, so a new folder (others/, tools/)
// resolves too. The site is served from the domain root, so segments are depth.
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

    const response = await fetch(requestUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch JSON resource: ${requestUrl}`);
    }
    return response.json();
}

const siteFileLoads = new Map();

/**
 * Loads one of the site's own scripts or stylesheets after the page has, once,
 * with the ?v= stamp this page's own tags carry, so a file loaded later is never
 * an older copy than the page around it.
 * @param {string} file a path from the site root, 'js/...' or 'style/...'
 * @returns {Promise<void>} settles when the file has loaded; rejects if it cannot,
 *   and the next call tries again
 * @watch the address and stamp are read from this file's own script tag, so it
 *   works at any depth and on 404.html, which is served at any address
 */
window.loadSiteFile = function (file) {
    if (siteFileLoads.has(file)) return siteFileLoads.get(file);
    const own = document.querySelector('script[src*="js/utility/site_utils.js"]');
    const url = new URL(own.src);
    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('js/utility/site_utils.js')) + file;
    const loading = new Promise((resolve, reject) => {
        const isStyle = file.endsWith('.css');
        const el = document.createElement(isStyle ? 'link' : 'script');
        if (isStyle) {
            el.rel = 'stylesheet';
            el.href = url.href;
        } else {
            el.src = url.href;
        }
        el.onload = () => resolve();
        el.onerror = () => {
            siteFileLoads.delete(file);
            reject(new Error(`Could not load ${file}`));
        };
        document.head.appendChild(el);
    });
    siteFileLoads.set(file, loading);
    return loading;
};

async function fetchNavigationData() {
    return fetchJson(`${getRootPath()}data/navigation.json?v=1.0`, { cache: true });
}

// Page addresses come from navigation.json (site_pages.url), never from the page
// type: a gallery or a tool lives in others/ or tools/. They are root-relative, and
// a caller adds getRootPath() at click time, since a link shows at every depth.
let pageUrlIndex = null;
// Each page's kind, read from the same two files in the same pass.
let pageTypeIndex = {};

/**
 * Loads the page id -> address index buildPageUrl prefers. Cheap after the first
 * call; await it before drawing anything that links to a page by id.
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

/**
 * A page's kind from the site's own page list, or null. A submission names its
 * page's kind too, but that is the submitter's word, so the preview, History, the
 * editor links and approval ask here.
 */
window.registeredPageType = async function(pageId) {
    await window.primePageUrlIndex();
    return pageTypeIndex[pageId] || null;
};

window.buildPageUrl = function(pageId, pageType) {
    // The stored path wins wherever it is known.
    if (pageUrlIndex && pageUrlIndex[pageId]) return pageUrlIndex[pageId];

    // The folder convention, as a last resort: right for character and system pages,
    // wrong for others/ and tools/.
    if (pageType === 'tierlist') return 'systems/tierlist/index.html';
    if (pageType === 'system') return `systems/${pageId}/index.html`;
    const folderName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    return `characters/${folderName}/index.html`;
};

const SUPABASE_URL = 'https://gtqswjspxymjdopljmfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cXN3anNweHltamRvcGxqbWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ1MDIsImV4cCI6MjA5NzkxMDUwMn0.6RsP5Ue1m9X8iGecXa245S3fEdYnDqML-QLux1KUAuw';

// A local-only backend override: points a locally served copy at another Supabase
// project (a preview branch), so a feature can be clicked through against real
// Postgres before its migration reaches production. Guarded twice: the host must
// be localhost or a loopback address, and a localStorage key must be set by hand.
//   localStorage.setItem('dsl_supabase_override',
//     JSON.stringify({ url: 'https://<ref>.supabase.co', key: '<anon key>' }));
// Cleared with localStorage.removeItem('dsl_supabase_override').
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

// A banner on the page, not only a console warning: an override left pointing at a
// deleted preview breaks every request while the page looks normal. One click
// undoes it.
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

        // index.html carries the site's only CSP, whose connect-src pins production, so
        // requests from it are blocked whatever the client points at.
        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (csp && csp.getAttribute('content') && csp.getAttribute('content').includes('connect-src')
            && !csp.getAttribute('content').includes(host)) {
            const warn = document.createElement('span');
            warn.textContent = "This page's CSP blocks it; use any other page";
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

window.supabaseClient = null;
try {
    const target = resolveSupabaseTarget();
    if (window.supabase && target.url.startsWith('http')) {
        window.supabaseClient = window.supabase.createClient(target.url, target.key);
        window.supabaseIsOverridden = target.overridden;
        if (target.overridden) {
            // Loud on purpose, on every page load: a preview mistaken for production, or the
            // reverse, helps nobody.
            console.warn(`[Supabase] LOCAL OVERRIDE ACTIVE -> ${target.url}. This is not production.`);
            showOverrideBanner(target.url);
        }
    }
} catch (e) {
    console.error("Failed to connect to global Supabase instance:", e);
}

/** Shows a message in the site's alert box, whose markup the sign-in modal carries. */
window.showSystemAlert = function(message) {
    window.injectAuthModal();
    const msgEl = document.getElementById('alert-modal-msg');
    if (msgEl) msgEl.textContent = message;
    window.runDialog(document.getElementById('alert-modal-overlay'), {
        buttons: [[document.getElementById('btn-alert-close')]],
        backdrop: true,
    });
};

// The site's dropdown: a .manga-select-wrapper holding a button (role combobox) and
// its list (.manga-select-options, role listbox) of .manga-option rows. Each
// select.editor-select gets one; the Block folder picker draws its own rows on the
// same parts and gets the same keys.
const DROPDOWN_BUTTON = '.manga-select-wrapper > [role="combobox"]';
const dropdownSelects = new WeakMap();
let dropdownCount = 0;

// The rows the keys can reach: a disabled option (a "Category" placeholder) is shown
// and skipped.
const dropdownRows = (wrapper) => [...wrapper.querySelectorAll('.manga-select-options .manga-option:not([aria-disabled="true"])')];

// The ids aria-controls and aria-activedescendant point at, given on first use.
function giveDropdownIds(wrapper) {
    const button = wrapper.querySelector('[role="combobox"]');
    const list = wrapper.querySelector('.manga-select-options');
    if (!list.id) list.id = `site-dropdown-${++dropdownCount}`;
    if (button) button.setAttribute('aria-controls', list.id);
    dropdownRows(wrapper).forEach((row, i) => { if (!row.id) row.id = `${list.id}-${i}`; });
}

function markActiveRow(wrapper, row) {
    const button = wrapper.querySelector('[role="combobox"]');
    dropdownRows(wrapper).forEach(r => r.classList.toggle('is-active', r === row));
    if (row) {
        button.setAttribute('aria-activedescendant', row.id);
        // Scrolled inside the list only: scrollIntoView would move the page too.
        const list = row.closest('.manga-select-options');
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
        }
    } else {
        button.removeAttribute('aria-activedescendant');
    }
}

// The rows, read from the <select> again each time it opens, so options a page
// adds after the first draw show.
function fillDropdown(wrapper) {
    const select = dropdownSelects.get(wrapper);
    if (!select) return;
    const list = wrapper.querySelector('.manga-select-options');
    list.replaceChildren(...Array.from(select.options).map((option, index) => {
        const row = document.createElement('div');
        row.className = 'manga-option';
        row.setAttribute('role', 'option');
        row.dataset.index = index;
        const picked = index === select.selectedIndex;
        row.classList.toggle('selected', picked);
        row.setAttribute('aria-selected', picked ? 'true' : 'false');
        // The resolved colour, not option.style.color: options are coloured by classes.
        const color = getComputedStyle(option).color;
        if (color) row.style.color = color;
        row.textContent = option.textContent;
        if (option.disabled) row.setAttribute('aria-disabled', 'true');
        return row;
    }));
}

function showDropdownValue(wrapper) {
    const select = dropdownSelects.get(wrapper);
    const button = wrapper.querySelector('.manga-select-trigger');
    button.textContent = select.options[select.selectedIndex]?.textContent || 'Select...';
    button.disabled = select.disabled;
    wrapper.querySelectorAll('.manga-select-options .manga-option').forEach(row => {
        const picked = Number(row.dataset.index) === select.selectedIndex;
        row.classList.toggle('selected', picked);
        row.setAttribute('aria-selected', picked ? 'true' : 'false');
    });
}

/**
 * Opens or closes a site dropdown, and closes any other open one.
 * @since v1.3
 * @watch the Block folder picker opens and closes through this too, so
 *   aria-expanded always says what is on screen
 */
window.setDropdownOpen = function (wrapper, open) {
    const button = wrapper.querySelector('[role="combobox"]');
    if (open) {
        document.querySelectorAll('.manga-select-wrapper.open').forEach(w => {
            if (w !== wrapper) window.setDropdownOpen(w, false);
        });
        fillDropdown(wrapper);
        giveDropdownIds(wrapper);
    }
    wrapper.classList.toggle('open', open);
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) dropdownTyped = '';
    if (!open && button) markActiveRow(wrapper, null);
    if (open && button) {
        const rows = dropdownRows(wrapper);
        markActiveRow(wrapper, rows.find(r => r.classList.contains('selected')) || rows[0] || null);
    }
};

/**
 * Draws every select.editor-select as the site's own dropdown, beside the real
 * <select>, which stays hidden, keeps the value and fires change. The keys are the
 * browser's own dropdown's: Tab reaches the button; Enter, Space or an arrow opens
 * it; the arrows, Home, End and typed letters move; Enter or Space picks; Escape
 * and Tab close it.
 * @since v0.4, changed v1.3
 * @watch it dispatches change, never input
 */
window.initializeMangaSelects = function() {
    document.querySelectorAll('select.editor-select:not(.manga-initialized)').forEach(select => {
        select.classList.add('manga-initialized');

        const wrapper = document.createElement('div');
        wrapper.className = 'manga-select-wrapper';
        dropdownSelects.set(wrapper, select);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'manga-select-trigger';
        button.setAttribute('role', 'combobox');
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        // The select's own label names the button, since the select is hidden. A
        // <label> written just before it without `for` counts: the editor's forms
        // are laid out that way.
        const before = select.previousElementSibling;
        const labels = select.labels && select.labels.length ? [...select.labels]
            : (before && before.tagName === 'LABEL' && !before.htmlFor ? [before] : []);
        if (labels.length) {
            labels.forEach(label => { if (!label.id) label.id = `site-dropdown-label-${++dropdownCount}`; });
            button.setAttribute('aria-labelledby', labels.map(l => l.id).join(' '));
        } else if (select.getAttribute('aria-label')) {
            button.setAttribute('aria-label', select.getAttribute('aria-label'));
        }

        const list = document.createElement('div');
        list.className = 'manga-select-options';
        list.setAttribute('role', 'listbox');

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            window.setDropdownOpen(wrapper, !wrapper.classList.contains('open'));
        });

        list.addEventListener('click', (e) => {
            const row = e.target.closest('.manga-option');
            // A click that picks nothing (a disabled row, which lets the pointer
            // through to the list, or the list's edge) gives the focus back to the
            // button, so the keys go on working.
            if (!row) { button.focus({ preventScroll: true }); return; }
            e.stopPropagation();
            select.selectedIndex = Number(row.dataset.index);
            window.setDropdownOpen(wrapper, false);
            // The native change event, so the page's own listeners run.
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        wrapper.appendChild(button);
        wrapper.appendChild(list);
        select.parentNode.insertBefore(wrapper, select.nextSibling);
        fillDropdown(wrapper);
        giveDropdownIds(wrapper);
        showDropdownValue(wrapper);

        // Follows a value set from code, which fires no event, options a page fills in
        // later, and the select being disabled.
        for (const prop of ['value', 'selectedIndex']) {
            const real = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
            Object.defineProperty(select, prop, {
                configurable: true,
                get() { return real.get.call(this); },
                set(v) { real.set.call(this, v); showDropdownValue(wrapper); },
            });
        }
        select.addEventListener('change', () => showDropdownValue(wrapper));
        new MutationObserver(() => showDropdownValue(wrapper))
            .observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    });
};

// A press on a row keeps the focus on the dropdown's button. Rows only: the list's
// scrollbar still drags.
document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('.manga-select-options .manga-option')) e.preventDefault();
});

// Capture phase, to close dropdowns before drag-and-drop eats the click.
document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.manga-select-wrapper')) {
        document.querySelectorAll('.manga-select-wrapper.open').forEach(w => window.setDropdownOpen(w, false));
    }
}, true);

// The keys, for every dropdown on the page. Capture phase, and stopped there, so a
// box's Enter or Escape never also answers for a key the dropdown used.
let dropdownTyped = '';
let dropdownTypedAt = 0;
document.addEventListener('keydown', (e) => {
    const button = e.target.closest && e.target.closest(DROPDOWN_BUTTON);
    if (!button || button.disabled || e.ctrlKey || e.metaKey) return;
    const wrapper = button.parentElement;
    const open = wrapper.classList.contains('open');
    const used = () => { e.preventDefault(); e.stopPropagation(); };
    const letter = e.key.length === 1 && !e.altKey;
    const typing = letter && (e.key !== ' ' || (dropdownTyped && Date.now() - dropdownTypedAt < 500));

    if (!open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key) || typing) {
            used();
            window.setDropdownOpen(wrapper, true);
            const rows = dropdownRows(wrapper);
            if (e.key === 'Home') markActiveRow(wrapper, rows[0] || null);
            if (e.key === 'End') markActiveRow(wrapper, rows[rows.length - 1] || null);
            if (typing) typeToRow(wrapper, e.key);
        }
        return;
    }

    const rows = dropdownRows(wrapper);
    const at = rows.findIndex(r => r.classList.contains('is-active'));
    const moveTo = (i) => markActiveRow(wrapper, rows[Math.max(0, Math.min(rows.length - 1, i))] || null);
    if (e.key === 'ArrowDown') { used(); moveTo(at + 1); }
    else if (e.key === 'ArrowUp') { used(); moveTo(at - 1); }
    else if (e.key === 'Home' || e.key === 'PageUp') { used(); moveTo(0); }
    else if (e.key === 'End' || e.key === 'PageDown') { used(); moveTo(rows.length - 1); }
    else if (typing) { used(); typeToRow(wrapper, e.key); }
    else if (e.key === 'Enter' || e.key === ' ') {
        used();
        if (at >= 0) rows[at].click();
        else window.setDropdownOpen(wrapper, false);
    }
    else if (e.key === 'Escape') { used(); window.setDropdownOpen(wrapper, false); }
    else if (e.key === 'Tab') window.setDropdownOpen(wrapper, false);
}, true);

// Typed letters within half a second of each other spell one search: the first row
// after the current one that starts with them, or with one letter typed again.
function typeToRow(wrapper, key) {
    const now = Date.now();
    dropdownTyped = now - dropdownTypedAt < 500 ? dropdownTyped + key.toLowerCase() : key.toLowerCase();
    dropdownTypedAt = now;
    const rows = dropdownRows(wrapper);
    const at = rows.findIndex(r => r.classList.contains('is-active'));
    const same = dropdownTyped.split('').every(c => c === dropdownTyped[0]);
    const search = same ? dropdownTyped[0] : dropdownTyped;
    const start = same || dropdownTyped.length === 1 ? at + 1 : at;
    const ordered = rows.slice(start).concat(rows.slice(0, start));
    const hit = ordered.find(r => r.textContent.trim().toLowerCase().startsWith(search));
    if (hit) markActiveRow(wrapper, hit);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(window.initializeMangaSelects, 100);

    // Started here because this is the one file every page loads, the hand-authored
    // ones included, and flagged media has to come off those too. It returns at once
    // when nothing is flagged.
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

/**
 * The one HTML escaper (tests/one-escape-helper.spec.js): & < > and both quotes, so
 * it is safe in text and in attribute values; null and undefined become ''.
 * page_router.js keeps its own copy, because it runs before this file loads.
 */
window.escapeHtml = function(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * escapeHtml, then the one tag editors type on purpose put back: <br>, for a line
 * break inside a stat value ("5 for kick<br>9 for distortion").
 * @since v1.1
 */
window.escapeHtmlKeepBreaks = function(str) {
    return window.escapeHtml(str).replace(/&lt;\s*\/?\s*br\s*\/?\s*&gt;/gi, '<br>');
};

/** Escapes every character a RegExp reads as syntax, so text matches as written. */
window.escapeRegExp = function(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/** What a staff page's gate shows someone it turns away: it replaces the whole page. */
window.showAccessDenied = function() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
};

/**
 * The role ladder, mirroring role_rank() in SQL. The two carry the same numbers, or
 * the interface promises access the database refuses; the SQL one is the boundary.
 * Never test a role by name (CLAUDE.md, Roles).
 * @since v0.16
 */
window.ROLE_RANK = { owner: 5, admin: 4, reviewer: 3, trusted_editor: 2, viewer: 1 };

window.roleRank = function (roleName) {
    // 0 for null, undefined, '' and any unknown string - the same total
    // behaviour the SQL CASE gets from its ELSE branch. Comparisons against
    // this are then always meaningful, which is the point.
    return window.ROLE_RANK[String(roleName || '').trim().toLowerCase()] || 0;
};

/**
 * Whether a role clears the bar a page asks for, by rank.
 * @since v0.16
 */
window.roleMeets = function (roleName, requiredRole) {
    return window.roleRank(roleName) >= window.roleRank(requiredRole);
};

/**
 * roleMeets over a list of roles, the shape pages hold them in: true when any
 * clears the bar.
 * @since v0.16
 */
window.rolesMeet = function (roles, requiredRole) {
    return (roles || []).some(r => window.roleMeets(r, requiredRole));
};

/**
 * Opens a box (a dialog.site-dialog) over the page. The browser's own modal dialog
 * closes it on Escape, keeps the page behind from being clicked and gives focus back
 * to what opened it; this adds the scroll lock's room for the scrollbar, and with
 * light, a click outside closing it, for a box with nothing typed in it.
 * @since v1.3
 * @watch it returns false for a box already open, and changes nothing
 */
window.openDialog = function (dialog, { light = false } = {}) {
    if (!dialog || dialog.open) return false;
    const html = document.documentElement;
    // Read before the lock hides the scrollbar, so only for the first box: once
    // locked, the root's clientWidth counts the kept room as page.
    if (!document.querySelector('dialog.site-dialog[open]')) {
        html.classList.toggle('dialog-keeps-gutter', window.innerWidth > html.clientWidth);
    }

    // Outside means the press and the release both landed on the backdrop, so a
    // drag that starts in a field and ends outside never closes it.
    const outside = (e) => {
        if (e.target !== dialog) return false;
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e) => { pressedOutside = outside(e); };
    const onClick = (e) => { if (light && pressedOutside && outside(e)) dialog.close(); };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('click', onClick);
        const at = openBoxes.indexOf(dialog);
        if (at >= 0) openBoxes.splice(at, 1);
        placeToasts();
    }, { once: true });

    dialog.showModal();
    openBoxes.push(dialog);
    placeToasts();
    return true;
};

// The open boxes, the last opened last. A toast lives in the top one: everything
// outside a modal box is inert, even a popover drawn over it, so a toast left on
// the page could be seen there and not clicked.
const openBoxes = [];

// Any button marked data-dialog-close closes the box it is in.
document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-dialog-close]');
    const dialog = button && button.closest('dialog');
    if (dialog && dialog.open) dialog.close();
});

/**
 * Runs every confirm, message and prompt box on the site: opens the box, resolves
 * with the value of the button pressed, and takes its listeners off again.
 *   buttons    [[element, value]]; a function value is called at the press
 *   cancel     what Escape, a click outside or a refused open resolves to
 *   backdrop   true to close on a click outside (a box with nothing typed in it)
 *   enter      what Enter resolves to; keyTarget is where keys are listened for
 *   focus      the element focused once the box shows
 *   onClose    undoes the caller's setup; runs on close and on a refusal
 * @watch one question per box: a box already open refuses a new one with
 *   `cancel`, so a double click can never run an action twice
 */
window.runDialog = function (dialog, opts = {}) {
    const { buttons = [], cancel, backdrop, enter, keyTarget = document, focus, onClose } = opts;
    if (dialog.open) {
        if (onClose) onClose();
        return Promise.resolve(cancel);
    }
    return new Promise((resolve) => {
        const listeners = [];
        const listen = (target, type, handler) => {
            target.addEventListener(type, handler);
            listeners.push(() => target.removeEventListener(type, handler));
        };
        let settled = false;
        const finish = (answer) => {
            if (settled) return;
            settled = true;
            listeners.forEach(off => off());
            if (onClose) onClose();
            resolve(answer);
        };
        // A button or Enter answers at the press: the value is read before onClose
        // can take the field away, and the caller does not wait for the close event.
        const answerWith = (value) => {
            if (settled) return;
            const answer = typeof value === 'function' ? value() : value;
            dialog.close();
            finish(answer);
        };
        buttons.forEach(([button, value]) => listen(button, 'click', () => answerWith(value)));
        if (enter !== undefined) {
            listen(keyTarget, 'keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); answerWith(enter); }
            });
        }
        // Escape and a click outside close it without a button: `cancel`.
        listen(dialog, 'close', () => finish(cancel));
        window.openDialog(dialog, { light: !!backdrop });
        if (focus) focus.focus();
    });
};

/** The staff pages' confirm box (#admin-confirm-modal on overseer.html and owner.html). */
window.adminConfirm = function (message) {
    document.getElementById('admin-confirm-msg').textContent = message;
    return window.runDialog(document.getElementById('admin-confirm-modal'), {
        buttons: [
            [document.getElementById('btn-admin-confirm-ok'), true],
            [document.getElementById('btn-admin-confirm-cancel'), false],
        ],
        cancel: false, backdrop: true,
    });
};

// The question box every page can use, built on first use (siteConfirm, sitePrompt).
function siteQuestionDialog() {
    let dialog = document.getElementById('site-confirm-modal');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'site-confirm-modal';
    dialog.className = 'site-dialog';
    dialog.setAttribute('aria-labelledby', 'site-confirm-title');
    dialog.innerHTML = `
        <div class="dialog-header"><h3 id="site-confirm-title">CONFIRM</h3></div>
        <div class="dialog-body dialog-question">
            <p id="site-confirm-text" class="dialog-text"></p>
            <div class="dialog-actions">
                <button type="button" id="site-confirm-cancel" class="btn-sys btn-sys-regular">CANCEL</button>
                <button type="button" id="site-confirm-ok" class="btn-sys">CONFIRM</button>
            </div>
        </div>`;
    document.body.appendChild(dialog);
    return dialog;
}

/**
 * A confirm box for code that runs on any page, for a destructive action: every
 * way out but CONFIRM resolves false.
 * @since v0.16
 */
window.siteConfirm = function (message, opts = {}) {
    const dialog = siteQuestionDialog();
    if (dialog.open) return Promise.resolve(false);
    const btnOk = dialog.querySelector('#site-confirm-ok');
    dialog.classList.add('tone-red');
    dialog.querySelector('#site-confirm-title').textContent = opts.title || 'CONFIRM';
    dialog.querySelector('#site-confirm-text').textContent = message;
    btnOk.textContent = opts.confirmText || 'CONFIRM';
    btnOk.className = 'btn-sys btn-sys-red btn-danger-fill';

    return window.runDialog(dialog, {
        buttons: [[dialog.querySelector('#site-confirm-cancel'), false], [btnOk, true]],
        cancel: false, backdrop: true, focus: btnOk,
        onClose: () => dialog.classList.remove('tone-red'),
    });
};

/**
 * A prompt for code that runs on any page: resolves the trimmed text, or null when
 * it is called off or left empty. Enter accepts.
 * @since v1.3
 */
window.sitePrompt = function (message, opts = {}) {
    const dialog = siteQuestionDialog();
    if (dialog.open) return Promise.resolve(null);
    const textEl = dialog.querySelector('#site-confirm-text');
    const btnOk = dialog.querySelector('#site-confirm-ok');
    dialog.querySelector('#site-confirm-title').textContent = opts.title || 'ENTER A VALUE';
    textEl.textContent = message;
    btnOk.textContent = opts.confirmText || 'OK';
    btnOk.className = 'btn-sys btn-sys-blue';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editor-input dialog-input';
    input.value = opts.value || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    textEl.after(input);

    const typed = () => input.value.trim() || null;
    // No click outside: it holds what was typed.
    return window.runDialog(dialog, {
        buttons: [[dialog.querySelector('#site-confirm-cancel'), null], [btnOk, typed]],
        cancel: null, enter: typed, keyTarget: input, focus: input,
        onClose: () => input.remove(),
    });
};

// The toasts' shelf, a popover made on first use, and the line inside it that a
// screen reader announces.
let toastShelf = null;
let toastSay = null;
const MOST_TOASTS = 3;

function toastHome() {
    for (let i = openBoxes.length - 1; i >= 0; i--) {
        if (openBoxes[i].open) return openBoxes[i];
    }
    return document.body;
}

// Moving a popover hides it, and showing it again puts it on top of the box that
// just opened.
function placeToasts() {
    if (!toastShelf) return;
    const home = toastHome();
    if (toastShelf.parentNode !== home) home.appendChild(toastShelf);
    if (typeof toastShelf.showPopover !== 'function') return;
    const holds = !!toastShelf.querySelector('.site-toast');
    const showing = toastShelf.matches(':popover-open');
    if (holds && !showing) toastShelf.showPopover();
    else if (!holds && showing) toastShelf.hidePopover();
}

/**
 * A short message in the top right corner that goes by itself: hovering it or
 * focusing in it keeps it, and its close button takes it away. Newest on top, three
 * at most. Over an open box it shows inside the box, so it can still be clicked.
 *   head      the small line above the message ('DONE')
 *   tone      'done' (green), 'badge' or 'gold'
 *   lead      a node drawn before the words (a badge)
 *   note      a muted line under the message
 *   action    { label, onClick }: a button that closes the toast, then runs onClick
 *   duration  milliseconds before it goes (5000)
 *   className more classes on the toast
 * @since v1.3
 * @watch errors and warnings stay boxes (showSystemAlert, editorAlert, adminAlert):
 *   a toast is for a message that only says something worked
 */
window.showToast = function (message, opts = {}) {
    const { head = 'DONE', tone = 'done', lead = null, note = '', action = null, duration = 5000, className = '' } = opts;
    if (!document.body) return null;
    if (!toastShelf) {
        toastShelf = document.createElement('div');
        toastShelf.className = 'site-toasts';
        toastShelf.setAttribute('popover', 'manual');
        toastSay = document.createElement('div');
        toastSay.className = 'sr-only';
        toastSay.setAttribute('role', 'status');
        toastShelf.appendChild(toastSay);
    }

    const toast = document.createElement('div');
    toast.className = `site-toast toast-${tone} is-new ${className}`.trim();
    toast.addEventListener('animationend', () => toast.classList.remove('is-new'), { once: true });
    if (lead) toast.appendChild(lead);

    const words = document.createElement('div');
    words.className = 'site-toast-text';
    const headEl = document.createElement('span');
    headEl.className = 'site-toast-head';
    headEl.textContent = head;
    const msgEl = document.createElement('span');
    msgEl.className = 'site-toast-msg';
    msgEl.textContent = message;
    words.append(headEl, msgEl);
    if (note) {
        const noteEl = document.createElement('span');
        noteEl.className = 'site-toast-note';
        noteEl.textContent = note;
        words.appendChild(noteEl);
    }
    toast.appendChild(words);

    let timer = null;
    let hovered = false;
    let focused = false;
    const dismiss = () => {
        clearTimeout(timer);
        if (!toast.isConnected) return;
        toast.remove();
        placeToasts();
    };
    const arm = () => {
        clearTimeout(timer);
        if (!hovered && !focused) timer = setTimeout(dismiss, duration);
    };
    toast.addEventListener('pointerenter', () => { hovered = true; clearTimeout(timer); });
    toast.addEventListener('pointerleave', () => { hovered = false; arm(); });
    toast.addEventListener('focusin', () => { focused = true; clearTimeout(timer); });
    toast.addEventListener('focusout', (e) => {
        if (toast.contains(e.relatedTarget)) return;
        focused = false;
        arm();
    });

    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-sys btn-sys-regular site-toast-action';
        button.textContent = action.label;
        button.addEventListener('click', () => { dismiss(); action.onClick(); });
        toast.appendChild(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'site-toast-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✖';
    close.addEventListener('click', dismiss);
    toast.appendChild(close);

    toastSay.after(toast);
    toastShelf.querySelectorAll('.site-toast').forEach((old, i) => { if (i >= MOST_TOASTS) old.remove(); });
    placeToasts();
    // Said a moment after the shelf shows: a live region's words are announced when
    // they change while it is on the page.
    toastSay.textContent = '';
    setTimeout(() => { toastSay.textContent = `${head}: ${message}`; }, 100);
    arm();
    return toast;
};

/**
 * A notice that stays on the page: a coloured bar on its left, an icon if it has
 * one, a title and a line of text. Returns the element for the caller to place.
 *   tone       yellow, orange, red, magenta, cyan, grey or green (style/Alerts.css)
 *   small      the editor's and the Overseer's narrow columns
 *   className  more classes, for the caller's spacing and its tests
 * @since v1.3
 */
window.siteBanner = function ({ tone = 'yellow', icon = '', title = '', text = '', small = false, className = '' } = {}) {
    const banner = document.createElement('div');
    banner.className = `site-banner banner-${tone}${small ? ' site-banner-small' : ''} ${className}`.trim();
    banner.setAttribute('role', 'note');
    if (icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'site-banner-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.textContent = icon;
        banner.appendChild(iconEl);
    }
    const body = document.createElement('div');
    body.className = 'site-banner-body';
    const titleEl = document.createElement('strong');
    titleEl.className = 'site-banner-title';
    titleEl.textContent = title;
    const textEl = document.createElement('p');
    textEl.className = 'site-banner-text';
    textEl.textContent = text;
    body.append(titleEl, textEl);
    banner.appendChild(body);
    return banner;
};

// Tab strips, for the keyboard and the screen reader (W3C's tabs pattern): a
// [role="tablist"] whose buttons are its tabs. Which tab is picked is its class,
// .is-active (the site's tab strip) or .active (the page tabs and the mode chips),
// whoever set it; aria-selected and the strip's one Tab stop follow it here.
const TAB_PICKED = ['is-active', 'active'];
const keyClicks = new WeakSet();

const shown = (el) => el.getClientRects().length > 0;

function tabsOf(list) {
    return [...list.querySelectorAll('button')].filter(b =>
        b.closest('[role="tablist"]') === list && !b.classList.contains('sub-tab-remove'));
}

function syncTabList(list) {
    const tabs = tabsOf(list);
    const picked = tabs.find(t => TAB_PICKED.some(c => t.classList.contains(c)));
    const stop = picked && !picked.hidden ? picked : tabs.find(t => !t.hidden && !t.classList.contains('hidden'));
    const set = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
    tabs.forEach(tab => {
        set(tab, 'role', 'tab');
        set(tab, 'aria-selected', String(tab === picked));
        set(tab, 'tabindex', tab === stop ? '0' : '-1');
        // Whatever holds a tab inside the strip is only layout to a screen reader.
        for (let up = tab.parentElement; up && up !== list; up = up.parentElement) set(up, 'role', 'presentation');
        // A tab's remove button is the mouse's: the keyboard removes the tab with Delete.
        const remove = tab.closest('.sub-tab-item') && tab.closest('.sub-tab-item').querySelector('.sub-tab-remove');
        if (remove) {
            set(remove, 'aria-hidden', 'true');
            set(remove, 'tabindex', '-1');
            set(tab, 'aria-keyshortcuts', 'Delete');
        }
    });
}

const tabWatch = new MutationObserver((records) => {
    const lists = new Set();
    for (const record of records) {
        const node = record.target;
        if (record.type === 'attributes') {
            const list = node.closest && node.closest('[role="tablist"]');
            if (list) lists.add(list);
            continue;
        }
        record.addedNodes.forEach(added => {
            if (added.nodeType !== 1) return;
            const own = added.closest('[role="tablist"]');
            if (own) lists.add(own);
            added.querySelectorAll('[role="tablist"]').forEach(l => lists.add(l));
        });
    }
    lists.forEach(syncTabList);
});
tabWatch.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'role'],
});
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[role="tablist"]').forEach(syncTabList);
});

/**
 * Whether a click on a tab was the reader's own: a real click, or one the arrow keys
 * made. Code that picks a tab for the reader (a section link's jump) is neither.
 * @since v1.3
 */
window.clickedByReader = (event) => event.isTrusted || keyClicks.has(event);

// A strip its own click draws again comes back as new buttons, and a removed tab is
// gone: once focus has fallen to the page, the strip of the same name takes it. A box
// the action asked in (are you sure?) is waited out; focus put anywhere else ends it.
function refocusStrip(label, gone) {
    const until = Date.now() + 10000;
    const look = () => {
        if (Date.now() > until) return;
        const active = document.activeElement;
        const lost = !active || active === document.body || active === gone;
        if (!lost && !active.closest('dialog[open]')) return;
        if (lost) {
            const list = label && [...document.querySelectorAll('[role="tablist"]')]
                .find(l => l.getAttribute('aria-label') === label && shown(l));
            const stop = list && list.querySelector('[role="tab"][tabindex="0"]');
            if (stop && stop !== gone) { stop.focus(); return; }
        }
        requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
}

// The arrow keys move along a strip and open each tab they reach; Home and End go to
// its ends; Delete removes a tab that has a remove button. Tab leaves the strip.
document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
    const list = tab && tab.closest('[role="tablist"]');
    if (!list) return;
    const label = list.getAttribute('aria-label');

    if (e.key === 'Delete') {
        const item = tab.closest('.sub-tab-item');
        const remove = item && item.querySelector('.sub-tab-remove');
        if (!remove) return;
        e.preventDefault();
        remove.click();
        refocusStrip(label, tab);
        return;
    }

    const tabs = tabsOf(list).filter(shown);
    const at = tabs.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(at + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(at - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next || at < 0) return;
    e.preventDefault();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    keyClicks.add(click);
    next.dispatchEvent(click);
    if (next.isConnected) next.focus();
    else refocusStrip(label, next);
});

/**
 * The mobile preview switch on edit.html, overseer.html and post-editor.html: below
 * 900px, the work or its preview (body.mobile-preview-active). The button's
 * data-hide-text says what pressing it does.
 */
window.toggleMobilePreview = function() {
    const shown = document.body.classList.toggle('mobile-preview-active');
    const btn = document.getElementById('mobile-preview-toggle');
    if (btn) btn.textContent = shown ? btn.dataset.hideText : 'SHOW PREVIEW';
};

/** Shows the preview when something opens in it; nothing on a wide screen. */
window.showMobilePreview = function() {
    const btn = document.getElementById('mobile-preview-toggle');
    if (!btn || getComputedStyle(btn).display === 'none') return;
    if (!document.body.classList.contains('mobile-preview-active')) window.toggleMobilePreview();
};

window.getRootPath = getRootPath;
window.fetchJson = fetchJson;
window.fetchNavigationData = fetchNavigationData;
