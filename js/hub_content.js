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

window.__hubInternals = { blocksForSlot };
