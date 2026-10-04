// The Forum (v1.0 batch 2). Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 2,
// the Forum".
//
// forum.html          the posts, most recently active first, by category
// forum.html?post=id  one post: its title and category, then its conversation
//
// A post's conversation is page_discussions under page_id 'forum:<id>', drawn
// by js/discussions.js, the same component as a character thread. This file
// draws only what a thread does not have: the list, the title and category,
// the new-post form, and moderation of a whole post.
//
// Everything a reader or a Discord member typed is set as text, never markup:
// titles, names and handles are all attacker-reachable.
(function () {
    // The owner's six, 2026-10-04, in their order. The database refuses any
    // other (forum_threads_tag_check); a test checks this list against it.
    const FORUM_TAGS = ['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'];
    const PAGE_SIZE = 20;
    const MAX_TITLE = 100;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    const client = () => window.supabaseClient;
    const state = { tag: null, offset: 0, exhausted: false };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function timeAgo(iso) {
        const then = Date.parse(iso);
        if (Number.isNaN(then)) return '';
        const s = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (s < 60) return 'just now';
        const m = Math.round(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.round(m / 60);
        if (h < 24) return `${h}h ago`;
        const d = Math.round(h / 24);
        if (d < 30) return `${d}d ago`;
        return new Date(then).toLocaleDateString();
    }

    const tagClass = (tag) => `forum-tag forum-tag-${String(tag || '').toLowerCase().replace(/[^a-z]+/g, '-')}`;

    // Who started a post: the name, then the DISCORD chip and handle when it
    // was started on Discord, as a thread draws a Discord message.
    function starter(row) {
        const span = el('span', 'forum-author', row.author_name || 'Unknown');
        if (row.source === 'discord') {
            span.appendChild(el('span', 'discussion-discord', 'DISCORD'));
            if (row.discord_author_handle) span.appendChild(el('span', 'discussion-handle', `@${row.discord_author_handle}`));
        }
        return span;
    }

    // --- THE LIST ---

    async function fetchPage() {
        let q = client()
            .from('forum_threads')
            .select('id, title, tag, source, author_name, discord_author_handle, status, created_at, last_post_at, post_count')
            // A removed post leaves the list; its own page says what happened.
            // A hidden one is returned only to moderators, by RLS.
            .in('status', ['visible', 'hidden'])
            .order('last_post_at', { ascending: false })
            .order('id', { ascending: false })
            .range(state.offset, state.offset + PAGE_SIZE - 1);
        if (state.tag) q = q.eq('tag', state.tag);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
    }

    function renderRow(row) {
        const a = el('a', 'forum-row');
        a.href = `forum.html?post=${encodeURIComponent(row.id)}`;

        const top = el('div', 'forum-row-top');
        top.appendChild(el('span', tagClass(row.tag), row.tag));
        if (row.status === 'hidden') top.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
        top.appendChild(el('span', 'forum-row-title', row.title));
        a.appendChild(top);

        const meta = el('div', 'forum-row-meta');
        meta.appendChild(starter(row));
        const replies = Math.max(0, (row.post_count || 0) - 1);
        meta.appendChild(el('span', 'forum-row-count', replies === 1 ? '1 reply' : `${replies} replies`));
        meta.appendChild(el('span', 'forum-row-time', timeAgo(row.last_post_at)));
        a.appendChild(meta);
        return a;
    }

    async function drawList(listBox, { append = false } = {}) {
        let rows;
        try {
            rows = await fetchPage();
        } catch (e) {
            listBox.innerHTML = '';
            const missing = e && (e.code === 'PGRST205' || e.code === '42P01');
            listBox.appendChild(el('p', 'forum-empty', missing ? 'The forum is not open yet.' : 'Could not load the forum. Try refreshing.'));
            return;
        }

        if (!append) listBox.innerHTML = '';
        const old = listBox.parentNode.querySelector('.forum-more');
        if (old) old.remove();

        if (!append && !rows.length) {
            listBox.appendChild(el('p', 'forum-empty', state.tag ? `No ${state.tag} posts yet.` : 'No posts yet. Start the first one.'));
        }
        rows.forEach(r => listBox.appendChild(renderRow(r)));

        state.exhausted = rows.length < PAGE_SIZE;
        if (!state.exhausted) {
            const more = el('button', 'btn-sys btn-sys-regular forum-more', 'LOAD MORE');
            more.type = 'button';
            more.addEventListener('click', async () => {
                state.offset += PAGE_SIZE;
                await drawList(listBox, { append: true });
            });
            listBox.insertAdjacentElement('afterend', more);
        }
    }

    function renderFilters(listBox) {
        const bar = el('div', 'forum-filters');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Filter by category');
        [null, ...FORUM_TAGS].forEach(tag => {
            const b = el('button', 'btn-sys btn-sys-regular forum-filter', tag || 'All');
            b.type = 'button';
            b.dataset.tag = tag || '';
            b.setAttribute('aria-pressed', String(tag === state.tag));
            b.addEventListener('click', async () => {
                state.tag = tag;
                state.offset = 0;
                bar.querySelectorAll('.forum-filter').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
                await drawList(listBox);
            });
            bar.appendChild(b);
        });
        return bar;
    }

    // NEW POST: a title and a category above the thread composer, which
    // brings images, paste and KLIPY links with it. The post and its opening
    // message are made together by create_forum_post.
    async function renderNewPost(panel) {
        const title = document.createElement('input');
        title.type = 'text';
        title.className = 'editor-input forum-title-input';
        title.maxLength = MAX_TITLE;
        title.placeholder = 'Title';
        title.setAttribute('aria-label', 'Title');

        const tag = document.createElement('select');
        tag.className = 'editor-input forum-tag-select';
        tag.setAttribute('aria-label', 'Category');
        const none = el('option', null, 'Category');
        none.value = '';
        none.disabled = true;
        none.selected = true;
        tag.appendChild(none);
        FORUM_TAGS.forEach(t => {
            const o = el('option', null, t);
            o.value = t;
            tag.appendChild(o);
        });

        const fields = el('div', 'forum-new-fields');
        fields.appendChild(title);
        fields.appendChild(tag);

        await window.mountDiscussionComposer(panel, {
            placeholder: 'Write the opening message…',
            submitLabel: 'POST',
            leading: [fields],
            insert: async ({ body, images }) => {
                const t = title.value.trim();
                if (!t) return { error: { message: 'Give the post a title.' } };
                if (!tag.value) return { error: { message: 'Pick a category.' } };
                const { data, error } = await client().rpc('create_forum_post', {
                    p_title: t, p_tag: tag.value, p_body: body, p_images: images,
                });
                if (error) return { error };
                window.location.href = `forum.html?post=${encodeURIComponent(data)}`;
                return { error: null };
            },
        });
    }

    async function showList(root) {
        const header = el('header', 'home-main-header forum-header');
        header.appendChild(el('h1', 'home-main-title', 'Forum'));
        const newBtn = el('button', 'btn-sys btn-sys-blue forum-new-btn', 'NEW POST');
        newBtn.type = 'button';
        newBtn.setAttribute('aria-expanded', 'false');
        header.appendChild(newBtn);
        root.appendChild(header);

        const panel = el('div', 'forum-new-panel');
        panel.hidden = true;
        root.appendChild(panel);

        let mounted = false;
        newBtn.addEventListener('click', async () => {
            panel.hidden = !panel.hidden;
            newBtn.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden && !mounted) {
                mounted = true;
                await renderNewPost(panel);
            }
            const first = panel.querySelector('.forum-title-input');
            if (!panel.hidden && first) first.focus();
        });

        const listBox = el('div', 'forum-list');
        root.appendChild(renderFilters(listBox));
        root.appendChild(listBox);
        await drawList(listBox);
    }

    // --- ONE POST ---

    function renderModeration(box, row) {
        const viewer = typeof window.discussionViewer === 'function' ? window.discussionViewer() : null;
        if (!viewer || !viewer.canModerate) return;

        const bar = el('div', 'forum-mod');
        const actions = row.status === 'visible' ? ['hide', 'remove'] : ['restore'];
        if (row.status === 'hidden') actions.push('remove');

        const form = el('form', 'forum-mod-form');
        form.hidden = true;
        const reason = document.createElement('input');
        reason.type = 'text';
        reason.className = 'editor-input';
        reason.maxLength = 300;
        reason.placeholder = 'Reason (kept in the moderation log)';
        reason.setAttribute('aria-label', 'Reason');
        const go = el('button', 'btn-sys btn-sys-red', 'CONFIRM');
        go.type = 'submit';
        const status = el('span', 'forum-mod-status');
        form.appendChild(reason);
        form.appendChild(go);
        form.appendChild(status);

        actions.forEach(action => {
            const b = el('button', 'btn-sys btn-sys-regular', action.toUpperCase());
            b.type = 'button';
            b.addEventListener('click', () => {
                form.dataset.action = action;
                form.hidden = false;
                reason.hidden = action === 'restore';
                go.textContent = `${action.toUpperCase()} POST`;
                if (!reason.hidden) reason.focus();
            });
            bar.appendChild(b);
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            go.disabled = true;
            const { error } = await client().rpc('moderate_forum_thread', {
                p_thread_id: row.id, p_action: form.dataset.action, p_reason: reason.value.trim(),
            });
            go.disabled = false;
            if (error) { status.textContent = error.message || 'Could not do that.'; return; }
            window.location.reload();
        });

        box.appendChild(bar);
        box.appendChild(form);
    }

    // Batch 3: the person who started a post can change its title and
    // category. The rules are edit_my_forum_post's, including one rename every
    // 5 minutes; this only draws the form.
    function renderTitleEdit(head, row) {
        const viewer = typeof window.discussionViewer === 'function' ? window.discussionViewer() : null;
        if (!viewer || viewer.banned || !viewer.userId) return;
        if (row.source !== 'site' || row.status !== 'visible' || row.author_id !== viewer.userId) return;

        const open = el('button', 'btn-sys btn-sys-regular forum-edit-btn', 'EDIT');
        open.type = 'button';

        const form = el('form', 'forum-edit-form');
        form.hidden = true;
        const title = document.createElement('input');
        title.type = 'text';
        title.className = 'editor-input forum-title-input';
        title.maxLength = MAX_TITLE;
        title.value = row.title;
        title.setAttribute('aria-label', 'Title');
        const tag = document.createElement('select');
        tag.className = 'editor-input forum-tag-select';
        tag.setAttribute('aria-label', 'Category');
        FORUM_TAGS.forEach(t => {
            const o = el('option', null, t);
            o.value = t;
            o.selected = t === row.tag;
            tag.appendChild(o);
        });
        const save = el('button', 'btn-sys btn-sys-blue', 'SAVE');
        save.type = 'submit';
        const cancel = el('button', 'btn-sys btn-sys-regular', 'CANCEL');
        cancel.type = 'button';
        const status = el('span', 'forum-mod-status');
        [title, tag, save, cancel, status].forEach(n => form.appendChild(n));

        open.addEventListener('click', () => {
            form.hidden = false;
            open.hidden = true;
            title.focus();
        });
        cancel.addEventListener('click', () => {
            form.hidden = true;
            open.hidden = false;
            status.textContent = '';
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const t = title.value.trim();
            if (!t) { status.textContent = 'Give the post a title.'; return; }
            if (t === row.title && tag.value === row.tag) { cancel.click(); return; }
            save.disabled = true;
            const { error } = await client().rpc('edit_my_forum_post', { p_thread_id: row.id, p_title: t, p_tag: tag.value });
            save.disabled = false;
            if (error) { status.textContent = error.message || 'Could not save that.'; return; }
            window.location.reload();
        });

        head.appendChild(open);
        head.appendChild(form);
    }

    // Batch 3: what a post was called before, for a moderator: renamed on the
    // wiki or on Discord. forum_thread_edits is readable by moderators alone.
    async function renderTitleHistory(head, meta, row) {
        const viewer = typeof window.discussionViewer === 'function' ? window.discussionViewer() : null;
        if (!viewer || !viewer.canModerate) return;
        const { data, error } = await client().from('forum_thread_edits')
            .select('title, tag, edited_at, edited_by')
            .eq('thread_id', row.id)
            .order('edited_at', { ascending: false });
        if (error || !data || !data.length) return;

        const btn = el('button', 'discussion-edited discussion-edited-open', 'title edited');
        btn.type = 'button';
        btn.title = 'Show what this post was called before (moderators only)';
        const box = el('div', 'discussion-edits');
        box.hidden = true;
        box.appendChild(el('p', 'discussion-edits-title', 'Earlier titles (moderators only)'));
        data.forEach(v => {
            const item = el('div', 'discussion-edits-item');
            item.appendChild(el('span', 'discussion-edits-when',
                `Until ${timeAgo(v.edited_at)}${v.edited_by ? '' : ', changed on Discord'}:`));
            item.appendChild(el('div', 'discussion-edits-body', `[${v.tag}] ${v.title}`));
            box.appendChild(item);
        });
        btn.addEventListener('click', () => { box.hidden = !box.hidden; });
        meta.appendChild(btn);
        head.appendChild(box);
    }

    async function showPost(root, id) {
        const back = document.getElementById('forum-back');
        if (back) { back.href = 'forum.html'; back.textContent = '← Forum'; }

        const { data: row, error } = UUID.test(id)
            ? await client().from('forum_threads')
                .select('id, title, tag, source, author_id, author_name, discord_author_handle, status, created_at')
                .eq('id', id).maybeSingle()
            : { data: null, error: null };

        if (error || !row) {
            root.appendChild(el('p', 'forum-empty', error ? 'Could not load this post. Try refreshing.' : 'That post could not be found.'));
            return;
        }

        const head = el('header', 'forum-post-header');
        const removed = row.status === 'removed' || row.status === 'removed_on_discord';
        if (removed) {
            head.appendChild(el('h1', 'home-main-title forum-post-title forum-post-removed',
                row.status === 'removed' ? '[removed by a moderator]' : '[removed on Discord]'));
        } else {
            head.appendChild(el('h1', 'home-main-title forum-post-title', row.title));
            document.title = `${row.title} | Forum | Dogslamloop Wiki`;
        }

        const meta = el('div', 'forum-post-meta');
        meta.appendChild(el('span', tagClass(row.tag), row.tag));
        if (row.status === 'hidden') meta.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
        if (!removed) meta.appendChild(starter(row));
        meta.appendChild(el('span', 'forum-row-time', timeAgo(row.created_at)));
        head.appendChild(meta);
        root.appendChild(head);

        if (removed) return;

        const section = document.getElementById('discussion-section');
        section.hidden = false;
        await window.initPageDiscussions(`forum:${row.id}`, {
            title: 'Discussion',
            order: 'oldest',
            placeholder: 'Write a message…',
            moreLabel: 'LOAD MORE',
            composerLast: true,
        });
        // After the component has learned who is reading.
        renderTitleEdit(head, row);
        renderModeration(head, row);
        await renderTitleHistory(head, meta, row);
    }

    window.initForum = async function () {
        const root = document.getElementById('forum-root');
        if (!root || !client()) return;
        const id = new URLSearchParams(window.location.search).get('post');
        if (id) await showPost(root, id);
        else await showList(root);
    };

    window.__forumInternals = { FORUM_TAGS, MAX_TITLE };
})();
