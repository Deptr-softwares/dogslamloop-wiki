/**
 * Dogslamloop Wiki - Site Posts (blog + hotfix notes)
 *
 * Reader side of the site_posts table. Posts store the same block array the
 * wiki already uses, so rendering is js/description.js's generateHTMLForBlocks
 * plus the two post-steps that function does not do for you (binding callout
 * tooltips and arming lazy media) - see populateTextSection in that file for
 * the original of this sequence.
 *
 * Rendered content is staff-authored, but every value that comes from a post's
 * metadata (title, summary, author) is escaped anyway, matching the standard
 * the rest of this codebase holds.
 */

window.POSTS_PAGE_SIZE = 10;

function postEscape(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function postDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Injects a post's block content into a container, reproducing the callout
 * and lazy-media wiring populateTextSection does. Without those two steps
 * callouts render as dead buttons and videos never load.
 */
window.renderPostBody = function(container, blocks) {
    if (!container) return;

    const body = document.createElement('div');
    body.className = 'wiki-section post-body';
    body.innerHTML = window.generateHTMLForBlocks(Array.isArray(blocks) ? blocks : [], '');
    container.appendChild(body);

    body.querySelectorAll('.inline-callout-btn').forEach(btn => {
        const tooltip = btn.getAttribute('data-tooltip');
        if (tooltip && typeof window.bindTooltip === 'function') {
            window.bindTooltip(btn, decodeURIComponent(tooltip));
        }
    });

    if (typeof window.initLazyMedia === 'function') window.initLazyMedia(body);
};

async function fetchPosts({ kind, limit, slug }) {
    if (!window.supabaseClient) return { data: null, error: new Error('Database connection is offline.') };

    let query = window.supabaseClient
        .from('site_posts')
        .select('id, kind, status, title, slug, summary, content, author_name, published_at')
        .eq('status', 'published');

    if (kind) query = query.eq('kind', kind);
    if (slug) query = query.eq('slug', slug);

    // Nulls last so a published post with no published_at still appears
    // rather than silently sorting off the end of the list.
    query = query.order('published_at', { ascending: false, nullsFirst: false });
    if (limit) query = query.limit(limit);

    return query;
}

/**
 * Renders a list of post cards. Used by blog.html and the homepage widget.
 */
window.loadPostList = async function(containerId, { kind = 'blog', limit = window.POSTS_PAGE_SIZE, emptyMessage } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<p class="loading-msg">Loading posts...</p>`;

    const { data, error } = await fetchPosts({ kind, limit });

    if (error) {
        // console.warn, not console.error: posts are optional content, and a
        // page that renders fine without them has not encountered an error
        // condition. This also matters for deployment ordering - the
        // site_posts migration lands with the merge, so between deploying the
        // code and applying the migration every page load would otherwise
        // report a failure for a table that simply does not exist yet.
        console.warn('Posts unavailable:', error.message || error);
        container.innerHTML = `<div class="wiki-section-empty">${postEscape(emptyMessage || 'Nothing posted yet.')}</div>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<div class="wiki-section-empty">${postEscape(emptyMessage || 'Nothing posted yet.')}</div>`;
        return;
    }

    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';

    container.innerHTML = data.map(post => `
        <article class="post-card">
            <a class="post-card-link" href="${rootPath}blog.html?post=${encodeURIComponent(post.slug)}">
                <h3 class="post-card-title">${postEscape(post.title)}</h3>
            </a>
            <div class="post-card-meta">
                ${post.published_at ? `<span class="post-card-date">${postEscape(postDate(post.published_at))}</span>` : ''}
                ${post.author_name ? `<span class="post-card-author">by ${postEscape(post.author_name)}</span>` : ''}
            </div>
            ${post.summary ? `<p class="post-card-summary">${postEscape(post.summary)}</p>` : ''}
        </article>
    `).join('');
};

/**
 * Renders one full post, resolved by ?post=<slug>.
 * Returns true if a post was found, so the caller can fall back to the list.
 */
window.loadSinglePost = async function(containerId, slug) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    container.innerHTML = `<p class="loading-msg">Loading post...</p>`;

    const { data, error } = await fetchPosts({ slug, limit: 1 });

    if (error) {
        console.warn('Post unavailable:', error.message || error);
        // Returning false rather than rendering an error lets blog.html fall
        // through to its list, which shows the friendly empty state.
        return false;
    }

    const post = data && data[0];
    if (!post) return false;

    container.innerHTML = `
        <header class="post-header">
            <h1 class="post-title">${postEscape(post.title)}</h1>
            <div class="post-meta">
                ${post.published_at ? `<span class="post-card-date">${postEscape(postDate(post.published_at))}</span>` : ''}
                ${post.author_name ? `<span class="post-card-author">by ${postEscape(post.author_name)}</span>` : ''}
            </div>
        </header>
    `;

    window.renderPostBody(container, post.content);

    document.title = `${post.title} | Dogslamloop Wiki`;
    return true;
};

/**
 * Hotfix notes for the Update Log page, rendered to look like the versioned
 * entries already there rather than as a separate-looking feed.
 */
window.loadHotfixPosts = async function(containerId, limit = 20) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { data, error } = await fetchPosts({ kind: 'hotfix', limit });

    // Hotfixes are supplementary - if they fail, the page's real changelog
    // content is still there, so fail quiet rather than showing an error.
    if (error || !data || data.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = data.map(post => `
        <details class="update-log-item hotfix-log-item">
            <summary class="update-log-summary">
                <div class="update-log-meta">
                    <span>${postEscape(postDate(post.published_at))}</span>
                    <span class="update-badge badge-hotfix">hotfix</span>
                    <span class="expand-hint">▼</span>
                </div>
                <h3 class="update-title">${postEscape(post.title)}</h3>
            </summary>
            <div class="update-log-body" id="hotfix-body-${postEscape(post.id)}"></div>
        </details>
    `).join('');

    // Block content is injected after the shell exists so the callout/lazy
    // wiring can find its elements.
    data.forEach(post => {
        const body = document.getElementById(`hotfix-body-${post.id}`);
        if (body) window.renderPostBody(body, post.content);
    });
};
