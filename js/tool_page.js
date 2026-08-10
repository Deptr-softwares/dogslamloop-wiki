/**
 * Dogslamloop Wiki - Tool pages (page_type 'tool')
 *
 * A host, not a renderer. `tools/` holds the owner's own tools, and a tool is
 * an application rather than a document - the two planned ones have almost
 * nothing in common:
 *
 *   Certified Tier List - accepts every submission and averages them into a
 *                         community ranking. Its own data model, its own
 *                         submission flow, its own anti-brigading rules.
 *   Skill Builder ID Reader
 *                       - already built and hosted elsewhere; genuinely just
 *                         a link.
 *
 * Forums are deliberately not here. That scope was downscaled to per-character
 * discussion threads, which belong on a character page rather than in a
 * site-wide tool.
 *
 * So each tool registers its own renderer against its page id, and this file
 * only builds the frame around it and picks who fills it. The link/embed
 * shell below is the fallback, not the model - it exists because the ID
 * Reader really is only a link, and because a tool that has not been written
 * yet should say so rather than render nothing.
 *
 * Registering a tool:
 *
 *   window.registerWikiTool('certified_tierlist', async (mount, ctx) => { ... });
 *
 * `mount` is an empty div inside the page shell. `ctx` carries { pageId,
 * config } where config is page_data.desc_data.tool, so a tool can be
 * configured from the owner tools without a code change.
 *
 * The registry is deliberately a plain object rather than a build-time import
 * map: this codebase has no bundler, and a tool's script is loaded by its own
 * generated stub. A tool that fails to load leaves its page with the fallback
 * rather than a blank screen.
 */

window.WIKI_TOOLS = window.WIKI_TOOLS || {};

window.registerWikiTool = function(pageId, renderer) {
    window.WIKI_TOOLS[pageId] = renderer;
};

// The fallback: a link, optionally with an embed above it.
//
// Embedding is opt-in rather than automatic. A tool served with
// X-Frame-Options renders as a permanently blank box that the page has no way
// to detect, so the launch link renders either way - with an embed it is the
// escape hatch for anyone whose browser blocks third-party frames, and
// without one it is the page's entire point.
function renderLinkedTool(mount, config) {
    if (!config.url) {
        mount.innerHTML = `<p class="empty-tab-msg">No tool linked yet. Press EDIT PAGE to add one.</p>`;
        return;
    }

    // Built as nodes rather than innerHTML: the URL is owner-authored, but it
    // goes into an href and a src, and the rule here is to escape at every
    // interpolation rather than reason about who typed what.
    if (config.embed) {
        const iframe = document.createElement('iframe');
        iframe.src = config.url;
        iframe.className = 'tool-embed';
        iframe.height = String(parseInt(config.height, 10) || 720);
        iframe.loading = 'lazy';
        iframe.title = window.PAGE_ROUTE ? window.PAGE_ROUTE.title : 'Tool';
        // The tool is the owner's, but an iframe is still a different origin.
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
        mount.appendChild(iframe);
    }

    const launch = document.createElement('a');
    launch.href = config.url;
    launch.className = 'btn-manga btn-manga-slanted tool-launch-btn';
    launch.target = '_blank';
    launch.rel = 'noopener noreferrer';
    launch.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text"></span></div>`;
    launch.querySelector('.btn-manga-text').textContent = config.launchLabel || 'Open the tool';
    mount.appendChild(launch);
}

window.renderToolPage = async function(pageId) {
    const main = document.querySelector('.main-content-area');
    if (!main) return;

    const shell = document.createElement('div');
    shell.className = 'tool-shell';
    shell.innerHTML = `
        <div id="tool-intro" class="tool-intro"></div>
        <div id="tool-mount" class="tool-frame"></div>
        <div id="tool-notes" class="tool-notes"></div>
    `;
    main.appendChild(shell);

    let data = null;
    if (window.supabaseClient) {
        const { data: row } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', pageId).maybeSingle();
        data = row ? row.desc_data : null;
    }

    // intro and notes are ordinary authored blocks, so a tool page can still
    // explain itself in the wiki's own voice around whatever it hosts.
    const blocks = (key) => (data && Array.isArray(data[key])) ? data[key] : [];
    const renderBlocks = (elId, list) => {
        if (!list.length || typeof window.generateHTMLForBlocks !== 'function') return;
        document.getElementById(elId).innerHTML = window.generateHTMLForBlocks(list, '');
    };

    renderBlocks('tool-intro', blocks('intro'));
    renderBlocks('tool-notes', blocks('notes'));

    const config = (data && data.tool) || {};
    const mount = document.getElementById('tool-mount');
    const tool = window.WIKI_TOOLS[pageId];

    if (typeof tool === 'function') {
        try {
            await tool(mount, { pageId, config });
        } catch (err) {
            // A tool throwing must not take the page's prose down with it -
            // the intro above often explains what the tool is for.
            console.error(`Tool "${pageId}" failed to render:`, err);
            mount.innerHTML = `<p class="admin-error-text">This tool failed to load. Try refreshing; if it keeps happening, report it on Discord.</p>`;
            renderLinkedTool(mount, config);
        }
        return;
    }

    renderLinkedTool(mount, config);
};
