/**
 * Dogslamloop Wiki - Tool pages (page_type 'tool')
 *
 * `tools/` holds the site owner's own tools, as opposed to a system page that
 * links out to someone else's. That distinction is the whole reason this type
 * exists, so the page leads with the tool itself rather than with prose about
 * it.
 *
 * Data shape, stored in page_data.desc_data:
 *
 *   {
 *     tool: {
 *       url,              // where the tool lives
 *       embed: true|false,// render it inline, or link out to it
 *       height,           // iframe height in px, default 720
 *       launchLabel,      // button text, default "Open the tool"
 *     },
 *     intro: [ ...blocks ],  // what it does, rendered above
 *     notes: [ ...blocks ],  // caveats and usage, rendered below
 *   }
 *
 * Embedding is opt-in rather than automatic. A tool hosted somewhere that
 * sends X-Frame-Options renders as a permanently blank box with no error the
 * page can catch, which is worse than a link - so the page only embeds when
 * someone has said it works.
 */

window.renderToolPage = async function(pageId) {
    const main = document.querySelector('.main-content-area');
    if (!main) return;

    const shell = document.createElement('div');
    shell.className = 'tool-shell';
    shell.innerHTML = `
        <div id="tool-intro" class="tool-intro"></div>
        <div id="tool-frame" class="tool-frame"></div>
        <div id="tool-notes" class="tool-notes"></div>
    `;
    main.appendChild(shell);

    let data = null;
    if (window.supabaseClient) {
        const { data: row } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', pageId).maybeSingle();
        data = row ? row.desc_data : null;
    }

    const blocks = (key) => (data && Array.isArray(data[key])) ? data[key] : [];
    const renderBlocks = (elId, list) => {
        if (!list.length || typeof window.generateHTMLForBlocks !== 'function') return;
        document.getElementById(elId).innerHTML = window.generateHTMLForBlocks(list, '');
    };

    renderBlocks('tool-intro', blocks('intro'));
    renderBlocks('tool-notes', blocks('notes'));

    const tool = (data && data.tool) || {};
    const frame = document.getElementById('tool-frame');

    if (!tool.url) {
        frame.innerHTML = `<p class="empty-tab-msg">No tool linked yet. Press EDIT PAGE to add one.</p>`;
        return;
    }

    // Built as nodes rather than innerHTML: the URL is owner-authored, but it
    // goes into an href and a src, and this codebase's rule is to escape at
    // every interpolation rather than reason about who typed what.
    if (tool.embed) {
        const iframe = document.createElement('iframe');
        iframe.src = tool.url;
        iframe.className = 'tool-embed';
        iframe.height = String(parseInt(tool.height, 10) || 720);
        iframe.loading = 'lazy';
        iframe.title = window.PAGE_ROUTE ? window.PAGE_ROUTE.title : 'Tool';
        // The tool is the owner's, but an iframe is still a different origin:
        // allow it to run and keep its own storage, nothing more.
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
        frame.appendChild(iframe);
    }

    // The launch link is rendered either way. With an embed it is the escape
    // hatch for anyone whose browser blocks third-party frames; without one it
    // is the page's entire point.
    const launch = document.createElement('a');
    launch.href = tool.url;
    launch.className = 'btn-manga btn-manga-slanted tool-launch-btn';
    launch.target = '_blank';
    launch.rel = 'noopener noreferrer';
    launch.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text"></span></div>`;
    launch.querySelector('.btn-manga-text').textContent = tool.launchLabel || 'Open the tool';
    frame.appendChild(launch);
};
