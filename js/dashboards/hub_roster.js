/**
 * The hub pages' directories: the character roster with its filters, icons and
 * hover banners, the dashboard's category columns, and the systems directory.
 * The home page, the Characters hub and the Systems hub load it; no other page does.
 * @since v0.4, as part of pagebuilder.js
 * @touches data/navigation.json, data/banners.json, #roster-filter-bar,
 *   #roster-grid, #roster-banner, rosterIconPath (site_lookups.js)
 * @watch OWN_COLUMN_CATEGORIES lists the categories the home page's own columns
 *   draw; the systems directory leaves those out, so a page is never in both
 * @see docs/home.md
 */
let masterRosterData = [];
// showHidden lets hidden characters in. WIP is not a filter: it says whether a
// page is finished, which is not a thing a reader filters on.
let currentFilters = { archetype: 'All', eaOnly: false, baseOnly: false, showHidden: false };

/** Loads the roster from data/navigation.json and wires its filters. */
window.initRosterFilters = async function() {
    const filterContainer = document.getElementById('roster-filter-bar');
    if (!filterContainer) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }
        
        masterRosterData = navData["Characters"] || [];
    } catch(e) { console.error("Roster Data Error:", e); return; }

    if (masterRosterData.length === 0) return;

    const archetypes = ['All', ...new Set(masterRosterData.map(c => c.archetype).filter(a => a && a !== "TBD"))];

    filterContainer.innerHTML = `
        <!-- editor-select is the opt-in marker window.initializeMangaSelects
             looks for, and this was once one of the only dropdowns on the site
             without it - so it alone still summoned the operating system's
             own dropdown over the wiki's palette. Paired with a layout class
             the same way #media-filter-select already is. -->
        <div class="filter-group"><span class="filter-label">Archetype</span><select id="filter-archetype" class="filter-select editor-select" aria-label="Archetype">${archetypes.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
        <div class="filter-group filter-group-right">
            <button id="filter-ea" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">EA Only</span></div></button>
            <button id="filter-base" class="filter-toggle btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">Base Only</span></div></button>
            <button id="filter-hidden" class="filter-toggle btn-manga btn-manga-slanted" data-tip="Characters playable only in a Private Server"><div class="btn-manga-content"><span class="btn-manga-text">Show Hidden</span></div></button>
        </div>
    `;

    document.getElementById('filter-archetype').addEventListener('change', (e) => { currentFilters.archetype = e.target.value; renderFilteredRoster(); });

    const setupToggle = (btnId, filterKey) => {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', () => {
            currentFilters[filterKey] = !currentFilters[filterKey];
            btn.classList.toggle('active', currentFilters[filterKey]);
            renderFilteredRoster();
        });
    };
    setupToggle('filter-ea', 'eaOnly'); setupToggle('filter-base', 'baseOnly'); setupToggle('filter-hidden', 'showHidden');

    renderFilteredRoster();
};

// The roster card's icon: its path is window.rosterIconPath (site_lookups.js), where
// text on any page can reach it too.

// Marks the cards whose icon loaded, and drops the ones that did not. The class is
// added on load, never written into the markup, so a missing icon leaves the plain
// card (its colour, the name centred): the fallback is the absence of an opt-in.
// Listeners, not inline handlers, and a cached image may be complete already.
window.markLoadedRosterIcons = function (root) {
    const scope = root || document;
    scope.querySelectorAll('.roster-card-icon').forEach(img => {
        const card = img.closest('.roster-card');
        const keep = () => { if (card) card.classList.add('has-icon'); };
        const drop = () => { img.remove(); };

        if (img.complete) {
            if (img.naturalWidth > 0) keep(); else drop();
            return;
        }
        img.addEventListener('load', keep, { once: true });
        img.addEventListener('error', drop, { once: true });
    });
};

// Hover banners: about 0.25s over a roster card opens the character's banner with
// the first line of their Overview, from data/banners.json (mirrored nightly by
// scripts/fetch-banners.js), so a hover asks Supabase for nothing. A line with no
// banner shows over the character's colour; neither shows no popup. A mouse or a
// keyboard only: a tap opens the page.
const ROSTER_BANNER_DELAY_MS = 250;
let rosterBanners = null;   // the promise of data/banners.json, fetched on the first hover
let rosterBannerFor = null; // the card a popup is coming for, or showing
let rosterBannerTimer = null;

function loadRosterBanners() {
    if (!rosterBanners) {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';
        rosterBanners = window.fetchJson(`${rootPath}data/banners.json`, { cache: true }).catch(err => {
            // A roster without its banners is still a roster: the popups just
            // do not open.
            console.warn('The hover banners could not be loaded:', err.message);
            return {};
        });
    }
    return rosterBanners;
}

function rosterBannerElement() {
    let el = document.getElementById('roster-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'roster-banner';
        el.className = 'roster-banner';
        el.setAttribute('role', 'tooltip');
        el.hidden = true;
        document.body.appendChild(el);
    }
    return el;
}

function hideRosterBanner() {
    clearTimeout(rosterBannerTimer);
    if (rosterBannerFor) rosterBannerFor.removeAttribute('aria-describedby');
    rosterBannerFor = null;
    const el = document.getElementById('roster-banner');
    if (el) el.hidden = true;
}

// Above the card when there is room, below it when not, and kept on screen.
function placeRosterBanner(el, card) {
    const edge = 16;
    const gap = 8;
    const box = card.getBoundingClientRect();
    let top = box.top - el.offsetHeight - gap;
    if (top < edge) top = box.bottom + gap;
    const left = Math.max(edge, Math.min(box.left + box.width / 2 - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - edge));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
}

async function showRosterBanner(card) {
    const entry = (await loadRosterBanners())[card.dataset.pageId];
    // Left meanwhile, or nothing to show.
    if (rosterBannerFor !== card || !entry || (!entry.image && !entry.overview)) return;

    const el = rosterBannerElement();
    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';
    el.style.setProperty('--banner-color', card.style.getPropertyValue('--char-color') || 'var(--border-color)');
    el.replaceChildren();

    if (entry.image) {
        const img = document.createElement('img');
        img.className = 'roster-banner-image';
        img.src = rootPath + entry.image;
        img.alt = '';
        el.appendChild(img);
    } else {
        const band = document.createElement('div');
        band.className = 'roster-banner-band';
        el.appendChild(band);
    }
    // textContent throughout: the line is contributor text.
    const body = document.createElement('div');
    body.className = 'roster-banner-body';
    const name = document.createElement('div');
    name.className = 'roster-banner-name';
    name.textContent = (card.querySelector('.roster-card-text') || card).textContent.trim();
    body.appendChild(name);
    if (entry.overview) {
        const line = document.createElement('p');
        line.className = 'roster-banner-overview';
        line.textContent = entry.overview;
        body.appendChild(line);
    }
    el.appendChild(body);

    el.hidden = false;
    placeRosterBanner(el, card);
    card.setAttribute('aria-describedby', 'roster-banner');
}

// Bound once per grid: the grid's contents are rebuilt on every filter
// change, the grid is not.
function bindRosterBanners(grid) {
    if (grid.dataset.bannersBound) return;
    grid.dataset.bannersBound = 'true';

    const comeFor = (card) => {
        hideRosterBanner();
        rosterBannerFor = card;
        loadRosterBanners();
        rosterBannerTimer = setTimeout(() => showRosterBanner(card), ROSTER_BANNER_DELAY_MS);
    };

    grid.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        const card = e.target.closest('.roster-card');
        if (card && card !== rosterBannerFor) comeFor(card);
    });
    grid.addEventListener('pointerout', (e) => {
        const card = e.target.closest('.roster-card');
        if (card && !card.contains(e.relatedTarget)) hideRosterBanner();
    });
    grid.addEventListener('focusin', (e) => {
        const card = e.target.closest('.roster-card');
        if (card && card.matches(':focus-visible')) comeFor(card);
    });
    grid.addEventListener('focusout', (e) => {
        if (e.target.closest('.roster-card')) hideRosterBanner();
    });
    // A popup that is showing follows its card when the page scrolls. One still to
    // come is not cancelled by a scroll: reaching a card often is a scroll, and its
    // last event lands after the pointer has.
    window.addEventListener('scroll', () => {
        const el = document.getElementById('roster-banner');
        if (el && !el.hidden && rosterBannerFor) placeRosterBanner(el, rosterBannerFor);
    }, { passive: true });
}

/** Draws the roster grid for the filters set. */
window.renderFilteredRoster = function() {
    const rosterGrid = document.getElementById('roster-grid') || document.querySelector('.roster-grid');
    if (!rosterGrid) return;
    hideRosterBanner();
    rosterGrid.innerHTML = '';

    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../';

    const filteredChars = masterRosterData.filter(char => {
        if (char.published === false) return false;
        if (currentFilters.archetype !== 'All' && char.archetype !== currentFilters.archetype) return false;
        if (currentFilters.eaOnly && !char.isEA) return false;
        if (currentFilters.baseOnly && !char.isBaseOnly) return false;
        // Hidden characters are out unless the toggle lets them in. `isHidden` is absent on
        // an ordinary entry (fetch-registry omits false flags), so this tests truthiness.
        if (!currentFilters.showHidden && char.isHidden) return false;
        return true;
    });

    if (filteredChars.length === 0) {
        rosterGrid.innerHTML = `<div class="empty-tab-msg roster-empty-msg">No characters found matching these filters.</div>`;
        return;
    }

    let html = '';
    filteredChars.forEach(char => {
        let charColor = 'var(--bg-main)';
        let textColor = 'var(--text-white)';

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[char.name]) {
            charColor = window.CHARACTER_COLORS[char.name];
        }

        if (char.isBaseOnly) {
            textColor = '#a1a1aa';
        }

        // Names, addresses and image paths come from site_pages: escaped at every
        // interpolation.

        // WIP is its own corner marker, beside the Early Access star, not part of the
        // name: the name is hidden until hover.
        const iconSrc = window.rosterIconPath((char.cms_config || {}).pageId);

        // The colour goes out as a custom property, not background-color: it is the
        // card's background without an icon, the border with one, and the name slit's
        // fill, and an inline background-color would beat every rule that changes one.
        html += `
            <a href="${window.escapeHtml(rootPath + char.url)}" class="roster-card" data-page-id="${window.escapeHtml((char.cms_config || {}).pageId || '')}" style="--char-color: ${charColor};">
                ${char.isEA ? `<span class="ea-star-indicator" data-tip="Early Access" style="color: ${textColor};">★</span>` : ''}
                ${char.isWip ? `<span class="roster-wip-indicator" data-tip="Work In Progress" aria-label="Work In Progress">🚧</span>` : ''}
                ${char.image ? `<img src="${window.escapeHtml(char.image)}" alt="${window.escapeHtml(char.name)}" class="roster-card-bg-image">` : ''}
                ${iconSrc ? `<img src="${window.escapeHtml(rootPath + iconSrc)}" alt="" aria-hidden="true" class="roster-card-icon" loading="lazy">` : ''}
                <div class="roster-card-text" style="color: ${textColor};">${window.escapeHtml(char.name)}</div>
            </a>
        `;
    });
    rosterGrid.innerHTML = html;
    window.markLoadedRosterIcons(rosterGrid);
    bindRosterBanners(rosterGrid);
};

// Categories with their own Main Dashboard column, so the "Guides & Such" box
// leaves them out. The Others column is sub-grouped by site_pages.category
// (Gamemodes, Servers, Misc). A group added here appears in the column and leaves
// the directory in one move; a category in one list and not the other shows twice.
window.OTHERS_SUBGROUPS = ['Gamemodes', 'Servers', 'Misc'];
// The Tools column, by who a tool is for: Tools for anything general, Creators for
// tools on what people build, Community for tools anyone can just use. They match
// the rows' categories; one the column does not list falls into the directory.
window.TOOLS_SUBGROUPS = ['Tools', 'Creators', 'Community'];

window.OWN_COLUMN_CATEGORIES = [...window.OTHERS_SUBGROUPS, ...window.TOOLS_SUBGROUPS];

/**
 * One or more categories' pages as a column of buttons, the same links the systems
 * directory draws. A category with no pages yet shows a short line, not an empty box.
 */
window.buildCategoryColumn = async function(containerId, categories) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Accepts one category or several. Several renders each as a labelled
    // sub-group inside the one column.
    const groups = Array.isArray(categories) ? categories : [categories];

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });

        const populated = groups
            .map(name => ({ name, items: (navData && navData[name]) || [] }))
            .filter(g => g.items.length > 0);

        if (populated.length === 0) {
            container.innerHTML = `<p class="loading-msg loading-msg-md">Nothing here yet.</p>`;
            return;
        }

        // A heading only when there is more than one populated group to tell apart: a lone
        // "Tools" heading in a section titled Tools is noise.
        const showHeadings = populated.length > 1;

        // An empty group draws nothing, not a bare heading. data-href and a delegated
        // listener: the names and addresses come from site_pages.
        container.innerHTML = populated.map(group => {
            const heading = showHeadings
                ? `<h3 class="column-subgroup-title">${window.escapeHtml(group.name)}</h3>`
                : '';

            // No WIP badge in the columns; the sidebar menu, where a reader picks from the full
            // list, still has it.
            const buttons = group.items.map(item => `
                <button class="btn-manga btn-manga-box system-directory-btn" data-href="${window.escapeHtml(rootPath + item.url)}">
                    <div class="btn-manga-content">
                        <span class="btn-manga-text">${window.escapeHtml(item.name)}</span>
                    </div>
                </button>`).join('');

            return `${heading}<div class="system-button-grid system-button-grid-compact">${buttons}</div>`;
        }).join('');

        container.querySelectorAll('.system-directory-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const href = btn.dataset.href;
                if (href) window.location.href = href;
            });
        });
    } catch (e) {
        console.error(`Category column "${groups.join(', ')}" failed:`, e);
        container.innerHTML = `<p class="loading-msg loading-msg-error">Unavailable.</p>`;
    }
};

// The directory's order: Guides first and System Pages last, everything between in
// navigation.json's order (site_pages.sort_order), so a new category needs no code.
window.SYSTEMS_CATEGORY_FIRST = ['Guides'];
window.SYSTEMS_CATEGORY_LAST = ['System Pages'];

/** Category names in the directory's order (SYSTEMS_CATEGORY_FIRST and _LAST). */
window.orderSystemsCategories = function (names) {
    const rank = (name) => {
        const first = window.SYSTEMS_CATEGORY_FIRST.indexOf(name);
        if (first !== -1) return first - 1000;
        const last = window.SYSTEMS_CATEGORY_LAST.indexOf(name);
        if (last !== -1) return last + 1000;
        return 0;
    };
    // Array#sort is stable, so everything unpinned keeps navigation.json's own
    // order relative to its neighbours rather than being shuffled.
    return [...names].sort((a, b) => rank(a) - rank(b));
};

/**
 * Draws the systems directory.
 * @param {string} containerId
 * @param {{compact?: boolean}} [options] compact: two columns, unslanted, for the
 *   home page's narrow column. Opt-in, because the full-width Systems Hub draws it
 *   too.
 */
window.buildSystemsDirectory = async function(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const compact = !!(options && options.compact);
    const gridClass = compact ? 'system-button-grid system-button-grid-compact' : 'system-button-grid';
    const shapeClass = compact ? 'btn-manga-box' : 'btn-manga-slanted';

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        let navData;
        if (window.fetchJson) navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
        else { const res = await fetch(`${rootPath}data/navigation.json`); navData = await res.json(); }

        // Category names come from site_pages.category too: escaped like page names.

        let html = `<div class="systems-grid-container${compact ? ' systems-grid-container-compact' : ''}">`;
        // Others and Tools have their own Main Dashboard columns, so they are left out here.
        const categories = window.orderSystemsCategories(
            Object.keys(navData)
                .filter(k => k !== 'Characters' && !window.OWN_COLUMN_CATEGORIES.includes(k)));

        categories.forEach((category) => {
            const items = navData[category];
            html += `
                <div class="system-category-block">
                    <h3 class="sidebar-master-title">${window.escapeHtml(category)}</h3>

                    <div class="${gridClass}">
            `;
            items.forEach(sys => {
                // data-href and a delegated listener: the names and addresses come from site_pages.
                html += `
                    <button class="btn-manga ${shapeClass} system-directory-btn" data-href="${window.escapeHtml(rootPath + sys.url)}">
                        <div class="btn-manga-content">
                            <span class="btn-manga-text">${window.escapeHtml(sys.name)}</span>
                        </div>
                    </button>
                `;
            });
            html += `</div></div>`;
        });
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.system-directory-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const href = btn.dataset.href;
                if (href) window.location.href = href;
            });
        });
    } catch(e) {
        console.error("Systems Grid Error:", e);
    }
};
