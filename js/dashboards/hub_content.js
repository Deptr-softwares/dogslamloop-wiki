/**
 * The hub pages' authored parts (index.html, characters/index.html,
 * systems/index.html): their prose slots, section headings, the Game Info panel
 * and the ordered step lists, all from the CMS.
 * @since v0.11
 * @touches page_data (a hub's slots), the site_meta table, falling back to
 *   data/site_meta.json
 * @watch a hub is not a tabbed page: never call loadPageDescriptions here, which
 *   would append tab containers and wipe the roster and the directory. A slot
 *   renders into one container.
 * @see docs/home.md
 */

// One fetch per hub per page load, shared by its slots.
const hubDataCache = {};

/**
 * The site_meta table, read directly, falling back to data/site_meta.json: the
 * JSON is refreshed by the nightly job, so reading only it made an owner's save
 * change nothing on the site. Only the three hubs load this.
 */
let siteMetaPromise = null;

function fetchSiteMeta() {
    if (siteMetaPromise) return siteMetaPromise;

    siteMetaPromise = (async () => {
        const rootPath = window.getRootPath ? window.getRootPath() : './';

        if (window.supabaseClient) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('site_meta').select('hubs, game_info').limit(1).maybeSingle();

                if (!error && data) {
                    // Normalised to the JSON file's shape, so every caller
                    // below reads one thing regardless of where it came from.
                    return { hubs: data.hubs || {}, gameInfo: data.game_info || {} };
                }
            } catch (e) {
                // Falls through to the committed file.
            }
        }

        try {
            const json = await window.fetchJson(`${rootPath}data/site_meta.json`, { cache: true });
            return { hubs: json.hubs || {}, gameInfo: json.gameInfo || {} };
        } catch (e) {
            return { hubs: {}, gameInfo: {} };
        }
    })();

    return siteMetaPromise;
}

// The answer when the row could not be read at all, as opposed to there being
// no row: the first gets a line saying so, the second shows nothing.
const HUB_FETCH_FAILED = false;

async function fetchHubData(pageId) {
    if (hubDataCache[pageId] !== undefined) return hubDataCache[pageId];

    hubDataCache[pageId] = (async () => {
        if (!window.supabaseClient) return HUB_FETCH_FAILED;
        try {
            const { data, error } = await window.supabaseClient
                .from('page_data')
                .select('desc_data')
                .eq('page_id', pageId)
                .maybeSingle();

            if (error) {
                console.warn(`[Hub] Could not load content for "${pageId}":`, error.message);
                return HUB_FETCH_FAILED;
            }
            return (data && data.desc_data) || null;
        } catch (e) {
            console.warn(`[Hub] Could not load content for "${pageId}":`, e.message);
            return HUB_FETCH_FAILED;
        }
    })();

    return hubDataCache[pageId];
}

/** Every block in a slot, flattened across its sections. */
function blocksForSlot(descData, slotId) {
    if (!descData || !Array.isArray(descData.tabs)) return [];

    const tab = descData.tabs.find(t => t && t.tabId === slotId);
    if (!tab || !Array.isArray(tab.sections)) return [];

    return tab.sections.flatMap(section =>
        (section && Array.isArray(section.blocks)) ? section.blocks : []
    );
}

/**
 * Renders one authored slot into one container, returning whether it rendered
 * content. The CMS is the only copy: the container ships "Loading..." and this
 * always replaces it, with the content, a line saying it could not load, or nothing.
 */
window.renderHubSlot = async function(pageId, slotId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const descData = await fetchHubData(pageId);
    const blocks = blocksForSlot(descData, slotId);
    if (blocks.length === 0 || typeof window.generateHTMLForBlocks !== 'function') {
        container.innerHTML = descData === HUB_FETCH_FAILED || blocks.length
            ? '<p class="loading-msg">Could not load this text. Try reloading the page.</p>'
            : '';
        return false;
    }

    const body = document.createElement('div');
    body.innerHTML = window.generateHTMLForBlocks(blocks, '');

    container.innerHTML = '';
    container.appendChild(body);

    // Both steps mirror populateTextSection and renderPostBody. Callouts are
    // inert without their tooltip bound, and videos never load without this.
    body.querySelectorAll('.inline-callout-btn').forEach(btn => {
        const tooltip = btn.getAttribute('data-tooltip');
        if (tooltip && typeof window.bindTooltip === 'function') {
            window.bindTooltip(btn, decodeURIComponent(tooltip));
        }
    });
    if (typeof window.initLazyMedia === 'function') window.initLazyMedia(body);

    return true;
};

/**
 * Section headings from site_meta, at runtime, since no unfurler reads a heading.
 * Only elements with data-heading-key are rewritten, and only when site_meta has a
 * value.
 */
window.applyHubHeadings = async function(pageId) {
    const targets = document.querySelectorAll('[data-heading-key]');
    if (targets.length === 0) return 0;

    const meta = await fetchSiteMeta();
    const headings = ((meta.hubs || {})[pageId] || {}).headings || {};
    let applied = 0;

    targets.forEach(el => {
        const value = headings[el.dataset.headingKey];
        // textContent: a heading is a string.
        if (typeof value === 'string' && value.trim() !== '') {
            el.textContent = value;
            applied++;
        }
    });
    return applied;
};

/**
 * The Game Info panel from site_meta's structured fields, not Blocks, which would
 * flatten its labelled layout. site_meta is the only copy.
 */
window.renderGameInfo = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const meta = await fetchSiteMeta();
    const info = meta.gameInfo || {};
    const fields = Array.isArray(info.fields) ? info.fields : [];
    const links = Array.isArray(info.links) ? info.links : [];
    if (fields.length === 0 && links.length === 0) {
        container.innerHTML = '';
        return false;
    }

    // Only http(s) survives. These URLs are admin-authored, but an href is the
    // one field here that becomes executable if it starts with "javascript:",
    // and a scheme allowlist costs nothing.
    const safeHref = (url) => {
        const raw = String(url == null ? '' : url).trim();
        return /^https?:\/\//i.test(raw) ? raw : '#';
    };

    let html = fields.map(field => `
        <div>
            <span class="game-info-label">${window.escapeHtml(field.label)}</span>
            <span class="text-gray-300">${window.escapeHtml(field.value)}</span>
            ${field.subtext ? `<span class="game-info-subtext">${window.escapeHtml(field.subtext)}</span>` : ''}
        </div>
    `).join('');

    if (links.length > 0) {
        html += `
            <div class="game-info-footer">
                <span class="game-info-label mb-2">${window.escapeHtml(info.linksLabel || 'Official Links')}</span>
                <div class="space-y-2">
                    ${links.map(link => `
                        <a href="${window.escapeHtml(safeHref(link.url))}" target="_blank" rel="noopener noreferrer" class="game-info-link">▶ ${window.escapeHtml(link.name)}</a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
    return true;
};

/**
 * An ordered step list (Start Here, How to Contribute) from site_meta, curated in
 * the owner tools: which guide to read first is the whole value.
 */
window.renderHubList = async function(pageId, listId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const meta = await fetchSiteMeta();
    const lists = ((meta.hubs || {})[pageId] || {}).lists || {};
    const steps = Array.isArray(lists[listId]) ? lists[listId] : [];
    if (steps.length === 0) {
        container.innerHTML = '';
        return false;
    }

    // Only relative paths and http(s). A step's url is owner-authored, but an
    // href is where a bad value becomes executable rather than merely broken.
    const safeHref = (url) => {
        const raw = String(url == null ? '' : url).trim();
        if (raw === '') return null;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;   // any other scheme
        return raw;
    };

    container.innerHTML = steps.map(step => {
        const href = safeHref(step.url);
        // A step with no link is still a step - "Sign in" is an instruction,
        // not a page.
        const title = href
            ? `<a href="${window.escapeHtml(href)}" class="reading-step-title">${window.escapeHtml(step.title)}</a>`
            : `<span class="reading-step-title">${window.escapeHtml(step.title)}</span>`;
        return `
            <li class="reading-step">
                ${title}
                ${step.description ? `<span class="reading-step-desc">${window.escapeHtml(step.description)}</span>` : ''}
            </li>
        `;
    }).join('');

    return true;
};

window.__hubInternals = { blocksForSlot };
