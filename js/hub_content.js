/**
 * Dogslamloop Wiki - Hub dashboard prose, rendered from the CMS.
 *
 * The three hub dashboards had their intro copy written directly into the
 * markup, so changing a sentence meant a commit. This renders it from
 * page_data instead, reusing the pipeline every other body of text on the site
 * already goes through.
 *
 * A hub is not a tabbed page, so this deliberately does NOT call
 * loadPageDescriptions(): that function appends tab containers to
 * .main-content-area and would take the whole page over, wiping the roster
 * grid and the systems directory with it. Instead a hub's tabs are treated as
 * named slots, and one slot renders into one container - the same thing
 * posts.js's renderPostBody does for a blog post.
 *
 * Loaded on index.html, characters/index.html and systems/index.html, which
 * are all hand-authored (NEVER_TOUCH in scripts/generate-pages.js).
 */

// One fetch per hub per page load. Several slots on the same page share a row,
// and each of them calling Supabase separately would be three round trips for
// one object.
const hubDataCache = {};

async function fetchHubData(pageId) {
    if (hubDataCache[pageId] !== undefined) return hubDataCache[pageId];

    hubDataCache[pageId] = (async () => {
        if (!window.supabaseClient) return null;
        try {
            const { data, error } = await window.supabaseClient
                .from('page_data')
                .select('desc_data')
                .eq('page_id', pageId)
                .maybeSingle();

            if (error || !data) return null;
            return data.desc_data || null;
        } catch (e) {
            // Never surfaced to the visitor. The container keeps whatever
            // static markup it shipped with, which is the whole point of the
            // fallback design below.
            console.warn(`[Hub] Could not load content for "${pageId}":`, e.message);
            return null;
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
 * Render one authored slot into one container.
 *
 * Returns true if it replaced the container's contents.
 *
 * The container's existing markup is the fallback and is left untouched unless
 * there is real content to put in its place. That matters more than it looks:
 * these are the first paragraphs on the three most-visited pages on the site,
 * and "Supabase is briefly unreachable" should not read as "this wiki is
 * empty". It also means the seeded copy and the shipped HTML can diverge
 * without a visitor ever seeing a blank panel.
 */
window.renderHubSlot = async function(pageId, slotId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const descData = await fetchHubData(pageId);
    const blocks = blocksForSlot(descData, slotId);
    if (blocks.length === 0) return false;

    if (typeof window.generateHTMLForBlocks !== 'function') {
        console.warn('[Hub] description.js is not loaded; keeping static copy.');
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
 * Convenience for a page rendering several slots at once.
 *
 * Concurrent rather than sequential: they share one cached fetch, so awaiting
 * them in order would only add latency.
 */
window.renderHubSlots = async function(pageId, slots) {
    return Promise.all(
        Object.entries(slots).map(([slotId, containerId]) =>
            window.renderHubSlot(pageId, slotId, containerId)
        )
    );
};

// --- SECTION HEADINGS -------------------------------------------------
//
// Rendered at runtime, not through the marked region that handles <title> and
// OG tags. Headings are body content: no unfurler reads them, so the
// build-time machinery buys nothing, and the static markup already in the page
// works as the fallback. A heading is only replaced when site_meta actually
// carries a value for its key.
//
// Elements opt in with data-heading-key, so this can never rewrite a heading
// that was not meant to be editable.
window.applyHubHeadings = async function(pageId) {
    const targets = document.querySelectorAll('[data-heading-key]');
    if (targets.length === 0) return 0;

    let meta;
    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        meta = await window.fetchJson(`${rootPath}data/site_meta.json`, { cache: true });
    } catch (e) {
        return 0;   // keep the static headings
    }

    const headings = ((meta.hubs || {})[pageId] || {}).headings || {};
    let applied = 0;

    targets.forEach(el => {
        const value = headings[el.dataset.headingKey];
        // textContent, not innerHTML: a heading is a string, and this is the
        // one place owner-authored text meets the DOM without going through
        // the block renderer's escaping.
        if (typeof value === 'string' && value.trim() !== '') {
            el.textContent = value;
            applied++;
        }
    });
    return applied;
};

// --- GAME INFO PANEL --------------------------------------------------
//
// Structured fields rather than authored blocks. The block editor is built for
// prose, and pushing a labelled field list through it would produce a
// paragraph that only looks like one - losing .game-info-label, the subtext
// styling and the mobile layout.
//
// Same fallback rule as everything else here: the static markup stays unless
// there is real data to replace it with.
window.renderGameInfo = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    let meta;
    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        meta = await window.fetchJson(`${rootPath}data/site_meta.json`, { cache: true });
    } catch (e) {
        return false;
    }

    const info = meta.gameInfo || {};
    const fields = Array.isArray(info.fields) ? info.fields : [];
    const links = Array.isArray(info.links) ? info.links : [];
    if (fields.length === 0 && links.length === 0) return false;

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

    // Only http(s) survives. These URLs are admin-authored, but an href is the
    // one field here that becomes executable if it starts with "javascript:",
    // and a scheme allowlist costs nothing.
    const safeHref = (url) => {
        const raw = String(url == null ? '' : url).trim();
        return /^https?:\/\//i.test(raw) ? raw : '#';
    };

    let html = fields.map(field => `
        <div>
            <span class="game-info-label">${esc(field.label)}</span>
            <span class="text-gray-300">${esc(field.value)}</span>
            ${field.subtext ? `<span class="game-info-subtext">${esc(field.subtext)}</span>` : ''}
        </div>
    `).join('');

    if (links.length > 0) {
        html += `
            <div class="game-info-footer">
                <span class="game-info-label mb-2">${esc(info.linksLabel || 'Official Links')}</span>
                <div class="space-y-2">
                    ${links.map(link => `
                        <a href="${esc(safeHref(link.url))}" target="_blank" rel="noopener noreferrer" class="game-info-link">▶ ${esc(link.name)}</a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
    return true;
};

// --- LIVE PREVIEW RECEIVER --------------------------------------------
//
// owner.html embeds the real dashboard in an iframe and posts edits into it as
// they are typed. The point is that there is no separate preview renderer to
// drift: what you see is this page, with its actual roster grid, FAQ and
// Credits around the text being edited.
//
// This replaced editing hub text through edit.html. The editor could load and
// save a hub row correctly, but its preview builds a system-page layout, so it
// structurally could not show the dashboard's other sections - and it carried
// leftover matchups/counterplay containers that mean nothing on a hub.
//
// Three guards, in order of what each stops:
//   1. Same-origin only. A cross-origin frame must not be able to paint
//      content into a page on this domain.
//   2. Framed only. Nothing should be able to drive a dashboard a visitor is
//      reading at the top level; this is an authoring aid, not a feature.
//   3. Preview never writes. It paints the DOM and nothing else - saving is a
//      separate, explicit action in owner.html.
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (window.parent === window) return;

    const msg = event.data;
    if (!msg || msg.type !== 'dsl-hub-preview') return;

    if (Array.isArray(msg.blocks) && msg.containerId) {
        const container = document.getElementById(msg.containerId);
        if (container && typeof window.generateHTMLForBlocks === 'function') {
            const body = document.createElement('div');
            body.innerHTML = window.generateHTMLForBlocks(msg.blocks, '');
            container.innerHTML = '';
            container.appendChild(body);
            if (typeof window.initLazyMedia === 'function') window.initLazyMedia(body);
        }
    }

    if (msg.headings && typeof msg.headings === 'object') {
        document.querySelectorAll('[data-heading-key]').forEach(el => {
            const value = msg.headings[el.dataset.headingKey];
            if (typeof value === 'string' && value.trim() !== '') el.textContent = value;
        });
    }

    // Tell the parent the frame is listening, so it can stop waiting on load
    // timing rather than guessing at it.
    if (msg.ping) event.source.postMessage({ type: 'dsl-hub-preview-ready' }, event.origin);
});

window.__hubInternals = { blocksForSlot };
