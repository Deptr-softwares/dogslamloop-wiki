/**
 * Tool pages (page_type 'tool'): a host, not a renderer. A tool registers its own
 * renderer against its page id (window.registerWikiTool), and this file builds the
 * frame around it with the page's intro and notes Blocks. A tool with no renderer
 * gets a launch link, with an embed above it when the page asks for one.
 * @since v0.12
 * @touches page_data.desc_data.tool (the tool's settings), desc_data.intro and notes
 * @watch a tool that fails to load or throws leaves its page with the link and the
 *   prose, never a blank screen
 * @see docs/page-shell.md
 */

window.WIKI_TOOLS = window.WIKI_TOOLS || {};

/**
 * Registers a tool's renderer for a page id: renderer(mount, { pageId, config }),
 * where config is page_data.desc_data.tool.
 */
window.registerWikiTool = function(pageId, renderer) {
    window.WIKI_TOOLS[pageId] = renderer;
};

// The fallback: a launch link, with an embed above it only when asked. A tool sent
// with X-Frame-Options draws a blank box the page cannot detect, so the link always
// shows.
function renderLinkedTool(mount, config) {
    if (!config.url) {
        mount.innerHTML = `<p class="empty-tab-msg">No tool linked yet. Press EDIT PAGE to add one.</p>`;
        return;
    }

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

/** Draws a tool page: its intro, the tool or the fallback, and its notes. */
window.renderToolPage = async function(pageId) {
    const main = document.querySelector('.main-content-area');
    if (!main) return;

    // The editor re-renders on every keystroke, and without this each pass
    // would stack another shell underneath the last.
    const previous = main.querySelector('.tool-shell');
    if (previous) previous.remove();

    const shell = document.createElement('div');
    shell.className = 'tool-shell';
    shell.innerHTML = `
        <div id="tool-intro" class="tool-intro"></div>
        <div id="tool-mount" class="tool-frame"></div>
        <div id="tool-notes" class="tool-notes"></div>
    `;
    main.appendChild(shell);

    // The editor's own object wins, as in description.js and framedata.js, so the
    // preview shows unsaved work.
    let data = window.currentEditorDescData || null;
    if (!data && window.supabaseClient) {
        const { data: row } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', pageId).maybeSingle();
        data = row ? row.desc_data : null;
        if (typeof window.rememberPageConfig === 'function') window.rememberPageConfig(pageId, data);
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
