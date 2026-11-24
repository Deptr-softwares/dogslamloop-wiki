/**
 * The Post editor (post-editor.html): the blog and hotfix notes, written with the
 * wiki's own Block editor and saved straight to site_posts, with no review.
 * @since v0.10
 * @touches site_posts, user_roles, initStrategyBlockBuilder and currentStrategyBlocks
 *   (editor-blocks.js), showAccessDenied (site_utils.js)
 * @watch it does not load editor-core.js, whose start-up boots the page editor and
 *   throws without ?page=. Owner only, as site_posts' write policy (is_owner()).
 * @see docs/owner-tools.md
 */

window.currentEditingPostId = null;

// currentStrategyBlocks is a top-level let in a classic script, in the global
// lexical scope, not on window, so it is named bare.
function readBlocks() {
    try {
        return typeof currentStrategyBlocks !== 'undefined' ? currentStrategyBlocks : [];
    } catch (e) {
        return [];
    }
}

// From the title, and still editable: a published post's link must not change
// with its title.
window.slugify = function(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

function setStatus(message, isError) {
    const el = document.getElementById('post-editor-status');
    if (!el) return;
    el.textContent = message;
    el.className = isError ? 'post-editor-status is-error' : 'post-editor-status';
}

function formValues() {
    return {
        title: document.getElementById('post-title').value.trim(),
        slug: document.getElementById('post-slug').value.trim(),
        summary: document.getElementById('post-summary').value.trim(),
        kind: document.getElementById('post-kind').value,
    };
}

window.resetPostForm = function() {
    window.currentEditingPostId = null;
    document.getElementById('post-title').value = '';
    document.getElementById('post-slug').value = '';
    document.getElementById('post-summary').value = '';
    document.getElementById('post-kind').value = 'blog';
    document.getElementById('post-editor-mode').textContent = 'NEW POST';
    if (typeof initStrategyBlockBuilder === 'function') {
        initStrategyBlockBuilder('post-block-builder', []);
    }
    if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
    setStatus('');
};

window.loadPostAdminList = async function() {
    const container = document.getElementById('post-admin-list');
    if (!container || !window.supabaseClient) return;

    const { data, error } = await window.supabaseClient
        .from('site_posts')
        .select('id, kind, status, title, slug, published_at, updated_at')
        .order('updated_at', { ascending: false });

    if (error) {
        container.innerHTML = `<p class="post-error">Could not load posts: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No posts yet.</p>`;
        return;
    }

    container.innerHTML = data.map(post => `
        <div class="post-admin-row">
            <div class="post-admin-row-main">
                <span class="update-badge ${post.status === 'published' ? 'badge-site' : 'badge-general'}">${window.escapeHtml(post.status)}</span>
                <span class="update-badge badge-general">${window.escapeHtml(post.kind)}</span>
                <span class="post-admin-row-title">${window.escapeHtml(post.title)}</span>
            </div>
            <div class="post-admin-row-actions">
                <button class="btn-sys btn-sys-regular" data-post-action="edit">EDIT</button>
                <button class="btn-sys btn-sys-red" data-post-action="delete">DELETE</button>
            </div>
        </div>
    `).join('');

    // A listener, not an inline onclick: escaping inside a JS string inside an
    // attribute protects nothing.
    container.querySelectorAll('.post-admin-row').forEach((row, i) => {
        const id = data[i].id;
        row.querySelector('[data-post-action="edit"]').addEventListener('click', () => window.editPost(id));
        row.querySelector('[data-post-action="delete"]').addEventListener('click', () => window.deletePost(id));
    });
};

window.editPost = async function(id) {
    const { data, error } = await window.supabaseClient
        .from('site_posts').select('*').eq('id', id).single();

    if (error || !data) {
        setStatus('Could not load that post.', true);
        return;
    }

    window.currentEditingPostId = data.id;
    document.getElementById('post-title').value = data.title || '';
    document.getElementById('post-slug').value = data.slug || '';
    document.getElementById('post-summary').value = data.summary || '';
    document.getElementById('post-kind').value = data.kind || 'blog';
    document.getElementById('post-editor-mode').textContent = `EDITING: ${data.title}`;

    if (typeof initStrategyBlockBuilder === 'function') {
        initStrategyBlockBuilder('post-block-builder', Array.isArray(data.content) ? data.content : []);
    }
    if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
    setStatus(`Loaded "${data.title}".`);
    window.scrollTo({ top: 0, behavior: window.scrollMotion() });
};

async function savePost(status) {
    const values = formValues();

    if (!values.title) { setStatus('A title is required.', true); return; }

    const slug = values.slug || window.slugify(values.title);
    if (!slug) { setStatus('Could not derive a URL slug from that title - please set one manually.', true); return; }

    const payload = {
        title: values.title,
        slug,
        summary: values.summary || null,
        kind: values.kind,
        status,
        content: readBlocks(),
        author_name: window.currentGlobalUsername || 'Staff',
        updated_at: new Date().toISOString(),
    };

    // Set on first publish only, so an edit does not move a post to the top.
    if (status === 'published') {
        const existing = window.currentEditingPostId
            ? await window.supabaseClient.from('site_posts').select('published_at').eq('id', window.currentEditingPostId).single()
            : null;
        if (!existing || !existing.data || !existing.data.published_at) {
            payload.published_at = new Date().toISOString();
        }
    }

    setStatus('Saving...');

    const query = window.currentEditingPostId
        ? window.supabaseClient.from('site_posts').update(payload).eq('id', window.currentEditingPostId)
        : window.supabaseClient.from('site_posts').insert([payload]);

    const { error } = await query;

    if (error) {
        // The slug's unique constraint is the one a person hits, so it is named.
        const message = /duplicate key|unique/i.test(error.message || '')
            ? `A post with the URL slug "${slug}" already exists. Pick a different one.`
            : error.message;
        setStatus(`Save failed: ${message}`, true);
        return;
    }

    setStatus(status === 'published' ? 'Published.' : 'Saved as draft.');
    document.getElementById('post-slug').value = slug;
    await window.loadPostAdminList();
}

window.savePostDraft = () => savePost('draft');
window.publishPost = () => savePost('published');

window.deletePost = async function(id) {
    const confirmed = typeof window.customConfirm === 'function'
        ? await window.customConfirm('Permanently delete this post?', 'DELETE', true)
        : true;
    if (!confirmed) return;

    const { error } = await window.supabaseClient.from('site_posts').delete().eq('id', id);
    if (error) { setStatus(`Delete failed: ${error.message}`, true); return; }

    if (window.currentEditingPostId === id) window.resetPostForm();
    setStatus('Post deleted.');
    await window.loadPostAdminList();
};

// One dropped request must not refuse the owner: retry once before the gate decides.
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { window.showAccessDenied(); return; }

    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('role').eq('user_id', session.user.id));
    }

    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];
    // Owner only, as site_posts' write policy.
    if (error || !window.rolesMeet(roles, 'owner')) { window.showAccessDenied(); return; }

    window.currentGlobalUsername = window.getDisplayName ? window.getDisplayName(session) : 'Staff';

    // The slug follows the title until edited by hand.
    const titleInput = document.getElementById('post-title');
    const slugInput = document.getElementById('post-slug');
    let slugTouched = false;
    slugInput.addEventListener('input', () => { slugTouched = true; });
    titleInput.addEventListener('input', () => {
        if (!slugTouched && !window.currentEditingPostId) slugInput.value = window.slugify(titleInput.value);
    });

    ['post-title', 'post-summary'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
        });
    });

    window.resetPostForm();
    await window.loadPostAdminList();
});

// A page restored from the back-forward cache skips the gate, so it reloads.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});
