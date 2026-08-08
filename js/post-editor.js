/**
 * Dogslamloop Wiki - Post Editor (blog + hotfix notes)
 *
 * Admin-only authoring for the site_posts table. Reuses the wiki's own block
 * builder (js/editor-blocks.js) rather than introducing a second content
 * format, so posts support the same paragraphs, headings, images, callouts,
 * tables and [color=]/[b]/[url=] shortcodes as page content.
 *
 * Deliberately does NOT load js/editor-core.js. That file's DOMContentLoaded
 * handler boots the full page-revision editor and throws outright without a
 * ?page= parameter and an #editor-title element. Its two genuinely shared
 * helpers (editorAlert, customConfirm) are small enough to provide locally,
 * which is a much smaller surface than adopting the whole revision pipeline.
 *
 * Writes straight to site_posts - no revision queue. Posts are the owner's
 * own writing, not a contributor submission, and the table's RLS is
 * admin-only to match.
 */

window.currentEditingPostId = null;

// editor-blocks.js reads/writes `currentStrategyBlocks`, a top-level `let` in
// a classic script. It lives in the global lexical scope rather than on
// window, so it is referenced by bare name here - the same way
// js/editor-tabs.js and js/editor-sync.js do it.
function readBlocks() {
    try {
        return typeof currentStrategyBlocks !== 'undefined' ? currentStrategyBlocks : [];
    } catch (e) {
        return [];
    }
}

function esc(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// URL-safe, stable, and predictable from the title so the owner rarely has to
// think about it - but still editable, because changing a published post's
// title should not silently break its existing links.
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
        container.innerHTML = `<p class="post-error">Could not load posts: ${esc(error.message)}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="loading-msg">No posts yet.</p>`;
        return;
    }

    container.innerHTML = data.map(post => `
        <div class="post-admin-row">
            <div class="post-admin-row-main">
                <span class="update-badge ${post.status === 'published' ? 'badge-site' : 'badge-general'}">${esc(post.status)}</span>
                <span class="update-badge badge-general">${esc(post.kind)}</span>
                <span class="post-admin-row-title">${esc(post.title)}</span>
            </div>
            <div class="post-admin-row-actions">
                <button class="btn-sys btn-sys-regular" onclick="window.editPost('${esc(post.id)}')">EDIT</button>
                <button class="btn-sys btn-sys-red" onclick="window.deletePost('${esc(post.id)}')">DELETE</button>
            </div>
        </div>
    `).join('');
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
    setStatus(`Loaded "${data.title}".`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // Set on first publish only, so re-editing a published post does not keep
    // moving it to the top of the list.
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
        // The slug unique constraint is the one a person will actually hit,
        // so name it rather than showing a raw Postgres error.
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

// --- RBAC GATE ---
// Admin only, matching site_posts' write policy. Same retry-before-denying
// shape as js/admin-core.js and js/owner.js: a single dropped request should
// not permanently lock a legitimate admin out.
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient) return;

    let { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await window.supabaseClient.auth.getSession());
    }
    if (!session) { kickUser(); return; }

    let { data: roleData, error } = await window.supabaseClient
        .from('user_roles').select('role').eq('user_id', session.user.id);
    if (error) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: roleData, error } = await window.supabaseClient
            .from('user_roles').select('role').eq('user_id', session.user.id));
    }

    const roles = (roleData && roleData.length > 0) ? roleData.map(r => r.role.toLowerCase()) : ['guest'];
    if (error || !roles.includes('admin')) { kickUser(); return; }

    window.currentGlobalUsername = window.getDisplayName ? window.getDisplayName(session) : 'Staff';

    // Auto-fill the slug from the title until the owner edits it by hand -
    // after that, leave it alone so a title tweak cannot silently change a
    // published post's URL.
    const titleInput = document.getElementById('post-title');
    const slugInput = document.getElementById('post-slug');
    let slugTouched = false;
    slugInput.addEventListener('input', () => { slugTouched = true; });
    titleInput.addEventListener('input', () => {
        if (!slugTouched && !window.currentEditingPostId) slugInput.value = window.slugify(titleInput.value);
    });

    window.resetPostForm();
    await window.loadPostAdminList();
});

function kickUser() {
    document.body.innerHTML = `<div class="access-denied-screen"><h1 class="access-denied-title">ACCESS DENIED</h1></div>`;
}

// Same bfcache guard as admin.html/owner.html: a back-forward restore skips
// DOMContentLoaded entirely, so the gate above would never re-run.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
});
