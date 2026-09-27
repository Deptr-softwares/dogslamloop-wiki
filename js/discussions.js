/**
 * Dogslamloop Wiki - Per-character discussion threads (v0.14 item 1)
 *
 * The first feature on this site with an open write path. Everything before it
 * reaches the public only after a reviewer agrees; a post here is live the
 * moment it is sent, on a page a 1.4M-member Discord is pointed at.
 *
 * The rules that matter are in the database, not here
 * (supabase/migrations/20260813000000_page_discussions.sql): authorship, the
 * rate limit, the one-level reply shape and the viewer ban are all enforced
 * server-side. Everything in this file is the courtesy layer - telling someone
 * they cannot post before they type three paragraphs, rather than after.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It never renders a post body with innerHTML. Post text is the most
 *     attacker-reachable string on the site: unreviewed, public immediately,
 *     and written by anyone with an account. It goes through textContent, and
 *     line breaks are built as real <br> nodes rather than by interpolating
 *     the text and hoping escapeHtml was called.
 *   - It never blocks the page. A character page renders its frame data
 *     whether or not the thread loads, so every failure here degrades to a
 *     quiet message under the tabs.
 */

(function () {
    const PAGE_SIZE = 20;
    const MAX_BODY = 4000;

    // Mirrors the migration's own limit. Client-side only as a courtesy - the
    // trigger is what actually enforces it.
    const POST_COOLDOWN_MS = 20000;

    // --- IMAGES AND GIFS (v0.20) ---
    //
    // Both limits mirror the database, where the real rules live: the count is
    // page_discussions_images_check, the size is discussion-media's own
    // file_size_limit (supabase/migrations/20260928000000).
    const MAX_IMAGES = 4;
    const IMAGE_MAX_EDGE = 1600;
    const IMAGE_MAX_BYTES = 1024 * 1024;
    const IMAGE_BUCKET = 'discussion-media';

    // A stored path: the poster's id, then a name this page chose. Same rule as
    // the trigger's, so a row that somehow breaks it is not drawn at all.
    const IMAGE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.(webp|jpg)$/;

    // KLIPY's media servers, read off klipy.com on 2026-09-28: every GIF, WebP
    // and MP4 on its home page was served from these two hosts, under /ii/.
    // Exact hosts and path, so a post can never point a reader's browser
    // anywhere else. A KLIPY PAGE link (klipy.com/gifs/...) stays text: the page
    // refuses scripted requests, so there is no way to find its GIF from here.
    const KLIPY_MEDIA = /https:\/\/static2?\.klipy\.com\/ii\/[A-Za-z0-9/_-]+\.(gif|webp|mp4)(?![\w./-])/g;
    const MAX_GIFS = 4;

    const state = {
        pageId: null,
        offset: 0,
        session: null,
        role: undefined,   // undefined = not looked up, null = signed in with no role
        canModerate: false,
        canUploadMedia: false,
        exhausted: false,
        lastPostAt: 0,
        replyingTo: null,
        // post id -> its image paths, as drawn. Removing your own post empties
        // the column server-side, so the paths to delete are read from here.
        imagesByPost: new Map(),
    };

    // Images picked in a composer and prepared, waiting for POST. Keyed by the
    // form, so a reply's attachments never leak into the top-level composer.
    const pendingImages = new WeakMap();

    const client = () => window.supabaseClient;

    // --- SMALL HELPERS ---

    function timeAgo(iso) {
        const then = new Date(iso).getTime();
        if (!then) return '';
        const secs = Math.floor((Date.now() - then) / 1000);
        if (secs < 60) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return new Date(iso).toLocaleDateString();
    }

    // Text into an element as text, with line breaks preserved. Not
    // `escapeHtml(body).replace(/\n/g, '<br>')` - that works, but it puts an
    // attacker-authored string back into an innerHTML sink, and the next person
    // to touch this file has to notice the escape to know it is safe. Nodes
    // cannot be got wrong the same way.
    function setTextWithBreaks(el, text) {
        el.textContent = '';
        String(text == null ? '' : text).split('\n').forEach((line, i) => {
            if (i > 0) el.appendChild(document.createElement('br'));
            el.appendChild(document.createTextNode(line));
        });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // The author's name, clickable when there is somebody to open.
    //
    // A button rather than a span with a handler: it is a real control, so it
    // should be reachable by keyboard and announced as one. The id goes in a
    // data attribute and is read by the delegated listener already on root -
    // never built into an inline onclick, because author_id sits next to
    // author_name and the habit is what matters.
    //
    // Falls back to a plain span in the two cases where there is nothing to
    // open: a removed post (whose author is deliberately not named) and a post
    // whose author_id is NULL, which is what page_discussions' ON DELETE SET
    // NULL leaves behind after an account is deleted.
    function authorNode(entry) {
        const removed = entry.status !== 'visible';
        const name = removed ? '—' : (entry.author_name || 'Unknown');

        if (removed || !entry.author_id) return el('span', 'discussion-author', name);

        const btn = el('button', 'discussion-author discussion-author-link', name);
        btn.type = 'button';
        btn.dataset.profileUser = entry.author_id;
        // The flair pass fills this in after the thread has rendered.
        btn.dataset.flairSlot = 'true';
        return btn;
    }

    // Draws each author's flair beside their name, after the thread is on
    // screen. Deliberately a second pass rather than part of the render: the
    // posts are already in hand, and blocking the whole thread on a profile
    // request would trade something people came for against decoration.
    async function decorateFlairs(root) {
        if (typeof window.fetchPublicProfiles !== 'function') return;

        const slots = [...root.querySelectorAll('[data-profile-user]')];
        if (!slots.length) return;

        // Two requests, both for the whole thread rather than per post, and
        // both allowed to fail independently. Neither is worth a blank section.
        const [profiles, expertIds] = await Promise.all([
            window.fetchPublicProfiles(slots.map(s => s.dataset.profileUser)),
            fetchExpertIds(),
        ]);

        slots.forEach(slot => {
            const userId = slot.dataset.profileUser;

            // The EXPERT chip goes FIRST, before the flair. It is the site
            // vouching for somebody on this specific page; the flair is what
            // they wrote about themselves, and the two should not read as one
            // label. It appears only in threads on a page they actually cover -
            // an expert of Crow Charmer is an ordinary poster on Sukuna.
            if (expertIds.has(userId) && !slot.querySelector('.discussion-expert')) {
                slot.appendChild(el('span', 'discussion-expert', 'EXPERT'));
            }

            const p = profiles.get(userId);
            if (!p || !p.flair) return;
            if (slot.querySelector('.discussion-flair')) return;
            // textContent, via el(): the flair is contributor-written and this
            // renders on every thread on the site.
            slot.appendChild(el('span', 'discussion-flair', p.flair));
        });
    }

    // Who is an expert of THIS page. The thread already knows its page_id, so
    // this is the cheap direction - one call, no per-author lookup.
    async function fetchExpertIds() {
        if (!client() || !state.pageId) return new Set();
        try {
            const { data, error } = await client()
                .rpc('get_page_experts', { target_page_id: state.pageId });
            if (error || !Array.isArray(data)) return new Set();
            return new Set(data.map(r => r.user_id));
        } catch (e) {
            // Before the release this RPC does not exist. No chips, same thread.
            return new Set();
        }
    }

    // KLIPY media links in a post's text, the first MAX_GIFS of them.
    function klipyLinks(text) {
        return [...String(text || '').matchAll(KLIPY_MEDIA)].map(m => m[0]).slice(0, MAX_GIFS);
    }

    // The text with the links that are drawn as GIFs taken out, so a post that
    // is only a GIF does not also print its address.
    function textWithoutGifs(text, gifs) {
        let out = String(text || '');
        gifs.forEach(url => { out = out.split(url).join(''); });
        return out.replace(/[ \t]+$/gm, '').trim();
    }

    // What a post carries besides words: its uploaded images, then its KLIPY
    // GIFs. Every node is built with createElement and every address is set as
    // a property, never interpolated, and each one has passed an exact pattern
    // above: this renders unreviewed input on every character page.
    function renderPostMedia(entry) {
        const images = (Array.isArray(entry.images) ? entry.images : [])
            .filter(p => typeof p === 'string' && IMAGE_PATH.test(p))
            .slice(0, MAX_IMAGES);
        const gifs = klipyLinks(entry.body);
        if (!images.length && !gifs.length) return null;

        const box = el('div', 'discussion-media');

        images.forEach(path => {
            const url = client().storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
            const link = el('a', 'discussion-media-link');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.setAttribute('aria-label', 'Open the full image');
            const img = document.createElement('img');
            img.className = 'discussion-media-img';
            img.src = url;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = 'Image attached to the post';
            link.appendChild(img);
            box.appendChild(link);
        });

        gifs.forEach(url => {
            let node;
            if (url.endsWith('.mp4')) {
                // KLIPY's MP4 of a GIF is a fraction of the GIF's bytes. Muted,
                // looping and inline: it plays the part of a GIF, nothing more.
                node = document.createElement('video');
                node.muted = true;
                node.loop = true;
                node.autoplay = true;
                node.playsInline = true;
                node.setAttribute('playsinline', '');
                node.setAttribute('aria-label', 'GIF from KLIPY');
            } else {
                node = document.createElement('img');
                node.loading = 'lazy';
                node.decoding = 'async';
                node.alt = 'GIF from KLIPY';
            }
            node.className = 'discussion-media-gif';
            // KLIPY sees that a GIF was loaded, not which page it was on.
            node.referrerPolicy = 'no-referrer';
            node.src = url;
            box.appendChild(node);
        });

        if (gifs.length) box.appendChild(el('span', 'discussion-media-credit', 'GIF via KLIPY'));
        return box;
    }

    // --- PREPARING AN IMAGE FOR UPLOAD ---
    //
    // Shrunk to IMAGE_MAX_EDGE on its long side and re-encoded in the browser,
    // so a 12-megapixel phone photo arrives as a few hundred KB. WebP where the
    // browser can encode it; JPEG where it cannot, which is Safari and so every
    // browser on iOS: asked for WebP, Safari's canvas silently returns a PNG.
    // Probed once, by asking for a 1px WebP and reading back what came out.
    let webpEncodes = null;

    function canvasToBlob(canvas, type, quality) {
        return new Promise(resolve => canvas.toBlob(resolve, type, quality));
    }

    async function canEncodeWebp() {
        if (webpEncodes !== null) return webpEncodes;
        const probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        const blob = await canvasToBlob(probe, 'image/webp', 0.8);
        webpEncodes = !!blob && blob.type === 'image/webp';
        return webpEncodes;
    }

    async function prepareImage(file) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (e) {
            throw new Error('That image could not be read. PNG, JPEG and WebP all work.');
        }

        const type = (await canEncodeWebp()) ? 'image/webp' : 'image/jpeg';
        const ext = type === 'image/webp' ? 'webp' : 'jpg';
        let scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));

        // Quality first, then size: a sharp smaller image beats a blotchy big
        // one, but most images fit at the first quality and never get here.
        for (let attempt = 0; attempt < 5; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const ctx = canvas.getContext('2d');
            // JPEG has no transparency, and a transparent pixel would otherwise
            // come out black by accident rather than on purpose.
            if (type === 'image/jpeg') {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

            for (const quality of [0.85, 0.72, 0.6]) {
                const blob = await canvasToBlob(canvas, type, quality);
                if (blob && blob.type === type && blob.size <= IMAGE_MAX_BYTES) {
                    if (bitmap.close) bitmap.close();
                    return { blob, ext, previewUrl: URL.createObjectURL(blob) };
                }
            }
            scale *= 0.75;
        }
        if (bitmap.close) bitmap.close();
        throw new Error('That image is too large, even after shrinking it.');
    }

    // Random, so two uploads can never collide and a name says nothing about
    // its poster or content. The trigger allows letters, digits, - and _.
    function newImageName() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }

    // Best effort, and never awaited into anything a reader waits on: a file
    // left behind costs a few hundred KB, not a broken post.
    async function discardImages(paths) {
        if (!paths || !paths.length || !client()) return;
        try { await client().storage.from(IMAGE_BUCKET).remove(paths); } catch (e) { /* see above */ }
    }

    function renderAttachments(form) {
        const strip = form.querySelector('.discussion-attachments');
        if (!strip) return;
        const list = pendingImages.get(form) || [];
        strip.textContent = '';
        list.forEach((item, i) => {
            const cell = el('div', 'discussion-attachment');
            const img = document.createElement('img');
            img.src = item.previewUrl;
            img.alt = `Image ${i + 1} to attach`;
            cell.appendChild(img);
            const x = el('button', 'discussion-attachment-remove', '×');
            x.type = 'button';
            x.dataset.removeAttachment = String(i);
            x.setAttribute('aria-label', `Remove image ${i + 1}`);
            cell.appendChild(x);
            strip.appendChild(cell);
        });
        strip.hidden = list.length === 0;
    }

    function clearAttachments(form) {
        (pendingImages.get(form) || []).forEach(item => URL.revokeObjectURL(item.previewUrl));
        pendingImages.delete(form);
        renderAttachments(form);
    }

    async function addImages(form, files) {
        const images = files.filter(f => f && /^image\//.test(f.type));
        if (!images.length) return;

        const list = pendingImages.get(form) || [];
        const room = MAX_IMAGES - list.length;
        if (room <= 0) { setStatus(`Up to ${MAX_IMAGES} images a post.`, true); return; }

        setStatus('Preparing images…');
        let problem = images.length > room ? `Up to ${MAX_IMAGES} images a post; the rest were left out.` : '';
        let note = '';
        for (const file of images.slice(0, room)) {
            try {
                list.push(await prepareImage(file));
                if (file.type === 'image/gif') note = 'A GIF is posted as a still image. For a moving one, paste a KLIPY link.';
            } catch (err) {
                problem = err.message;
            }
        }
        pendingImages.set(form, list);
        renderAttachments(form);
        setStatus(problem || note, !!problem);
    }

    // --- WHO IS READING ---

    async function loadViewer() {
        if (!client()) return;
        try {
            const { data } = await client().auth.getSession();
            state.session = data ? data.session : null;
        } catch (e) {
            state.session = null;
        }

        if (!state.session) { state.role = undefined; state.canModerate = false; state.canUploadMedia = false; return; }

        try {
            // select('*') rather than naming columns: this row gains a column
            // every time a capability is added, and an explicit list would
            // break the whole thread render on any deploy where the client is
            // newer than the database.
            const { data } = await client()
                .from('user_roles').select('*')
                .eq('user_id', state.session.user.id).maybeSingle();
            // null is a real answer and a common one: signed in, no role, which
            // is every ordinary contributor. Distinct from `undefined`, which
            // means nobody is signed in.
            state.role = data ? data.role : null;
            // Mirrors public.can_moderate() in the migration. The client copy
            // only decides which buttons to draw; the RPC is what refuses.
            state.canModerate = !!data && (
                window.roleMeets(data.role, 'reviewer') || data.can_moderate === true
            );
            // Mirrors public.can_upload_media(): Trusted Editor and up, or the
            // owner's tick, and never a viewer, who is banned by name because a
            // ban is not a rung. Decides only whether the composer offers
            // images; the bucket and the trigger are what refuse.
            state.canUploadMedia = !!data && data.role !== 'viewer' && (
                window.roleMeets(data.role, 'trusted_editor') || data.can_upload_media === true
            );
        } catch (e) {
            state.role = null;
            state.canModerate = false;
            state.canUploadMedia = false;
        }
    }

    // The soft ban. 'viewer' is documented as "signed in, can read, cannot
    // submit", and if threads do not honour it the ban stops meaning anything
    // the moment they ship.
    const isBanned = () => state.role === 'viewer';
    const isSignedIn = () => !!state.session;

    // --- DATA ---

    async function fetchTopLevel(offset) {
        // Ordered by created_at AND id. range() needs a total order to
        // paginate correctly, and two posts sharing a timestamp would
        // otherwise be able to swap places between pages - showing one twice
        // and hiding the other.
        const { data, error } = await client()
            .from('page_discussions')
            .select('*')
            .eq('page_id', state.pageId)
            .is('parent_id', null)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;
        return data || [];
    }

    async function fetchReplies(parentIds) {
        if (!parentIds.length) return [];
        const { data, error } = await client()
            .from('page_discussions')
            .select('*')
            .in('parent_id', parentIds)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;
        return data || [];
    }

    // --- RENDERING ---

    // --- REPORTING ---
    //
    // Moderators removing posts they happen to see does not scale to 1.4M
    // people. This is what turns moderation from patrolling into a queue.
    //
    // Deliberately no "incorrect" category. On a frame-data wiki "this is
    // wrong" is the most common complaint and the least actionable by
    // moderation - a thread is exactly where being wrong should be argued
    // with. Offering it would fill the queue with disagreements and train
    // moderators to skim, which is how a real harassment report gets missed.
    const REPORT_REASONS = [
        { id: 'spam', label: 'Spam or advertising' },
        { id: 'harassment', label: 'Harassment or abuse' },
        { id: 'off_topic', label: 'Off topic for this page' },
        { id: 'other', label: 'Something else' },
    ];

    function renderReportForm(postId) {
        const form = el('form', 'discussion-report-form');
        // Deliberately NOT data-report-post: that is the trigger button's
        // attribute, and the delegated click handler matches the nearest
        // ancestor carrying it. With the same name on both, clicking Send
        // inside the form matched the form and re-opened it instead of
        // submitting - the submit event never fired at all.
        form.dataset.reportFor = postId;
        form.noValidate = true;

        form.appendChild(el('div', 'discussion-mod-heading', 'Report this post'));

        const select = document.createElement('select');
        select.className = 'discussion-report-reason';
        select.setAttribute('aria-label', 'Reason');
        REPORT_REASONS.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = r.label;
            select.appendChild(opt);
        });
        form.appendChild(select);

        const note = document.createElement('input');
        note.type = 'text';
        note.className = 'discussion-report-note';
        note.maxLength = 500;
        note.placeholder = 'Anything else the moderators should know (optional)';
        note.setAttribute('aria-label', 'Additional detail');
        form.appendChild(note);

        const row = el('div', 'discussion-composer-row');
        const go = el('button', 'btn-sys btn-sys-yellow discussion-report-confirm', 'SEND REPORT');
        go.type = 'submit';
        row.appendChild(go);

        const cancel = el('button', 'btn-sys btn-sys-regular', 'CANCEL');
        cancel.type = 'button';
        cancel.dataset.cancelReport = 'true';
        row.appendChild(cancel);

        row.appendChild(el('span', 'discussion-composer-status'));
        form.appendChild(row);
        return form;
    }

    function openReportForm(postId) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        const existing = root.querySelector('.discussion-report-form');
        if (existing) existing.remove();

        const target = document.getElementById(`post-${postId}`);
        if (!target) return;

        const actions = target.querySelector('.discussion-post-actions');
        const form = renderReportForm(postId);
        if (actions) actions.insertAdjacentElement('afterend', form);
        else target.appendChild(form);

        const select = form.querySelector('.discussion-report-reason');
        if (select) select.focus();
    }

    async function submitReport(form) {
        const postId = form.dataset.reportFor;
        const reason = form.querySelector('.discussion-report-reason').value;
        const note = form.querySelector('.discussion-report-note').value.trim();

        const confirmBtn = form.querySelector('.discussion-report-confirm');
        if (confirmBtn) confirmBtn.disabled = true;
        setStatus('Sending…');

        const { data, error } = await client().rpc('report_discussion_post', {
            p_post_id: postId,
            p_reason: reason,
            p_note: note || null,
        });

        if (confirmBtn) confirmBtn.disabled = false;

        if (error) { setStatus(error.message || 'Could not send that report.', true); return; }

        // Replaced rather than left open, so nobody sits there wondering
        // whether it went. The message is the same whether this was a new
        // report or a duplicate - see the RPC's comment on why.
        form.replaceWith(el('div', 'discussion-report-sent', data || 'Thanks — a moderator will take a look.'));
    }

    // --- MODERATION CONTROLS ---
    //
    // One builder for posts and replies. They diverged once already on the
    // delete button and the two copies have to say the same thing about who
    // may do what, so there is only one copy of it.
    // Offered on anything still visible that is not yours, to anyone signed in
    // who is not soft-banned. Not offered to moderators on posts they can
    // already act on directly - reporting something to yourself is a queue
    // entry nobody needs.
    function appendReportControl(actions, entry) {
        if (!isSignedIn() || isBanned() || state.canModerate) return;
        if (entry.status !== 'visible') return;
        if (state.session && entry.author_id === state.session.user.id) return;

        const btn = el('button', 'discussion-action-btn', 'Report');
        btn.type = 'button';
        btn.dataset.reportPost = entry.id;
        actions.appendChild(btn);
    }

    function appendModerationControls(actions, entry) {
        if (!state.canModerate) return;

        const hidden = entry.status === 'hidden';
        const removed = entry.status === 'removed_by_staff' || entry.status === 'hidden';

        if (!removed && entry.status === 'visible') {
            const hide = el('button', 'discussion-action-btn discussion-action-mod', 'Hide');
            hide.type = 'button';
            hide.dataset.moderate = entry.id;
            hide.dataset.modAction = 'hide';
            actions.appendChild(hide);

            const remove = el('button', 'discussion-action-btn discussion-action-danger', 'Remove');
            remove.type = 'button';
            remove.dataset.moderate = entry.id;
            remove.dataset.modAction = 'remove';
            actions.appendChild(remove);
        }

        // Restore is offered for anything staff took down. Deliberately not for
        // 'removed_by_author': staff putting somebody's words back after they
        // chose to withdraw them is not moderation.
        if (hidden || entry.status === 'removed_by_staff') {
            const restore = el('button', 'discussion-action-btn discussion-action-mod', 'Restore');
            restore.type = 'button';
            restore.dataset.moderate = entry.id;
            restore.dataset.modAction = 'restore';
            actions.appendChild(restore);
        }
    }

    // A reason is required by the RPC for hide and remove, so it is asked for
    // inline rather than through a dialog. Native prompt() is the only
    // alternative available on a character page - editor-core.js's modal
    // helpers are not loaded here - and a required field somebody can dismiss
    // with Escape is not really required.
    function renderModerationForm(postId, action) {
        const form = el('form', 'discussion-mod-form');
        form.dataset.modPost = postId;
        form.dataset.modAction = action;

        // The input below is marked required for assistive technology, but
        // native validation would swallow the submit event before the handler
        // runs - so the "reason is required" message would appear in a browser
        // bubble while every other message in this file appears in the status
        // line. One error channel, so the field is validated by hand.
        form.noValidate = true;

        const label = action === 'restore'
            ? 'Put this post back?'
            : `Reason for ${action === 'hide' ? 'hiding' : 'removing'} this post`;
        form.appendChild(el('div', 'discussion-mod-heading', label));

        if (action !== 'restore') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'discussion-mod-reason';
            input.maxLength = 300;
            input.required = true;
            input.placeholder = 'Recorded in the moderation log — required';
            input.setAttribute('aria-label', 'Moderation reason');
            form.appendChild(input);
        }

        const row = el('div', 'discussion-composer-row');
        const go = el('button', 'btn-sys btn-sys-red discussion-mod-confirm', action.toUpperCase());
        go.type = 'submit';
        row.appendChild(go);

        const cancel = el('button', 'btn-sys btn-sys-regular', 'CANCEL');
        cancel.type = 'button';
        cancel.dataset.cancelMod = 'true';
        row.appendChild(cancel);

        row.appendChild(el('span', 'discussion-composer-status'));
        form.appendChild(row);
        return form;
    }

    // A removed post draws no media, whatever its row says: removal empties the
    // column server-side, and this holds even for a row removed before that
    // rule existed. A hidden one keeps it, because only a moderator can see it.
    function appendMedia(wrap, entry) {
        if (entry.status !== 'visible' && entry.status !== 'hidden') return;
        state.imagesByPost.set(entry.id, Array.isArray(entry.images) ? entry.images.slice() : []);
        const media = renderPostMedia(entry);
        if (media) wrap.appendChild(media);
    }

    function renderPost(post, replies) {
        const removed = post.status !== 'visible';

        const wrap = el('article', 'discussion-post' + (removed ? ' discussion-post-removed' : ''));
        wrap.id = `post-${post.id}`;

        const head = el('div', 'discussion-post-head');
        head.appendChild(authorNode(post));
        head.appendChild(el('span', 'discussion-time', timeAgo(post.created_at)));
        wrap.appendChild(head);

        const body = el('div', 'discussion-body');
        if (post.status === 'hidden') {
            // Only a moderator can see this at all - the SELECT policy filters
            // the row out for everyone else - so the body is shown intact
            // under a marker rather than replaced by a placeholder.
            //
            // Appended, not insertBefore(badge, body): body is not a child of
            // wrap yet at this point, and insertBefore against a non-child
            // throws - taking the whole thread render down with it.
            wrap.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
            setTextWithBreaks(body, textWithoutGifs(post.body, klipyLinks(post.body)));
        } else if (removed) {
            body.classList.add('discussion-body-removed');
            body.textContent = post.status === 'removed_by_staff'
                ? '[removed by a moderator]'
                : '[removed by the author]';
        } else {
            setTextWithBreaks(body, textWithoutGifs(post.body, klipyLinks(post.body)));
        }
        wrap.appendChild(body);
        appendMedia(wrap, post);

        const actions = el('div', 'discussion-post-actions');

        if (isSignedIn() && !isBanned() && post.status === 'visible') {
            const replyBtn = el('button', 'discussion-action-btn', 'Reply');
            replyBtn.type = 'button';
            // data- attribute plus a delegated listener, never an inline
            // onclick: post ids and author names are user-influenced and an
            // onclick would put them in an executable position.
            replyBtn.dataset.replyTo = post.id;
            actions.appendChild(replyBtn);
        }

        const isMine = post.status === 'visible' && state.session && post.author_id === state.session.user.id;
        if (isMine) {
            const delBtn = el('button', 'discussion-action-btn discussion-action-danger', 'Delete');
            delBtn.type = 'button';
            delBtn.dataset.removePost = post.id;
            actions.appendChild(delBtn);
        }

        appendReportControl(actions, post);
        appendModerationControls(actions, post);

        if (actions.childNodes.length) wrap.appendChild(actions);

        if (replies.length) {
            const list = el('div', 'discussion-replies');
            replies.forEach(reply => list.appendChild(renderReply(reply)));
            wrap.appendChild(list);
        }

        return wrap;
    }

    function renderReply(reply) {
        const removed = reply.status !== 'visible';
        const wrap = el('div', 'discussion-reply' + (removed ? ' discussion-post-removed' : ''));
        wrap.id = `post-${reply.id}`;

        const head = el('div', 'discussion-post-head');
        head.appendChild(authorNode(reply));
        head.appendChild(el('span', 'discussion-time', timeAgo(reply.created_at)));
        wrap.appendChild(head);

        const body = el('div', 'discussion-body');
        if (reply.status === 'hidden') {
            wrap.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
            setTextWithBreaks(body, textWithoutGifs(reply.body, klipyLinks(reply.body)));
        } else if (removed) {
            body.classList.add('discussion-body-removed');
            body.textContent = reply.status === 'removed_by_staff'
                ? '[removed by a moderator]'
                : '[removed by the author]';
        } else {
            setTextWithBreaks(body, textWithoutGifs(reply.body, klipyLinks(reply.body)));
        }
        wrap.appendChild(body);
        appendMedia(wrap, reply);

        const actions = el('div', 'discussion-post-actions');

        if (reply.status === 'visible' && state.session && reply.author_id === state.session.user.id) {
            const delBtn = el('button', 'discussion-action-btn discussion-action-danger', 'Delete');
            delBtn.type = 'button';
            delBtn.dataset.removePost = reply.id;
            actions.appendChild(delBtn);
        }

        appendReportControl(actions, reply);
        appendModerationControls(actions, reply);

        if (actions.childNodes.length) wrap.appendChild(actions);

        return wrap;
    }

    // An empty thread is the state most readers will meet first, and it is the
    // one that decides whether the feature looks alive or broken. "No posts
    // yet" reads like an error; an invitation reads like a place to write.
    function renderEmptyState() {
        const box = el('div', 'discussion-empty');
        box.appendChild(el('p', 'discussion-empty-title', 'No discussion here yet.'));

        if (!isSignedIn()) {
            box.appendChild(el('p', 'discussion-empty-body',
                'Sign in to start one — matchup disagreements, combo routes, or anything the page gets wrong.'));
        } else if (isBanned()) {
            box.appendChild(el('p', 'discussion-empty-body',
                'Your account can read discussions but not post in them.'));
        } else {
            box.appendChild(el('p', 'discussion-empty-body',
                'Start it — matchup disagreements, combo routes, or anything this page gets wrong.'));
        }
        return box;
    }

    function renderComposer(parentId) {
        const form = el('form', 'discussion-composer');
        form.dataset.parentId = parentId || '';

        if (parentId) {
            const heading = el('div', 'discussion-composer-heading', 'Replying to this post');
            form.appendChild(heading);
        }

        const area = document.createElement('textarea');
        area.className = 'discussion-textarea';
        area.maxLength = MAX_BODY;
        area.rows = parentId ? 2 : 3;
        area.placeholder = parentId ? 'Write a reply…' : 'Start a discussion about this character…';
        area.setAttribute('aria-label', parentId ? 'Reply' : 'New post');
        form.appendChild(area);

        // Images, for whoever has the upload media permission. Nobody else sees
        // a button: offering one that the bucket then refuses would be a
        // control that only ever fails.
        if (state.canUploadMedia) {
            const strip = el('div', 'discussion-attachments');
            strip.hidden = true;
            form.appendChild(strip);

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.hidden = true;
            input.className = 'discussion-image-input';
            form.appendChild(input);
        }

        const row = el('div', 'discussion-composer-row');

        const submit = el('button', 'btn-sys btn-sys-blue discussion-submit', parentId ? 'REPLY' : 'POST');
        submit.type = 'submit';
        row.appendChild(submit);

        if (state.canUploadMedia) {
            const attach = el('button', 'btn-sys btn-sys-regular discussion-attach', 'IMAGE');
            attach.type = 'button';
            attach.dataset.attachImage = 'true';
            attach.title = `Attach up to ${MAX_IMAGES} images. You can also paste one into the box.`;
            row.appendChild(attach);
        }

        if (parentId) {
            const cancel = el('button', 'btn-sys btn-sys-regular discussion-cancel', 'CANCEL');
            cancel.type = 'button';
            cancel.dataset.cancelReply = 'true';
            row.appendChild(cancel);
        }

        row.appendChild(el('span', 'discussion-composer-status'));
        form.appendChild(row);

        return form;
    }

    function renderSignInPrompt() {
        const box = el('div', 'discussion-signin');
        if (isBanned()) {
            box.appendChild(el('p', 'discussion-signin-text',
                'Your account can read discussions but not post in them.'));
            return box;
        }
        box.appendChild(el('p', 'discussion-signin-text', 'Sign in to join the discussion.'));
        const btn = el('button', 'btn-sys btn-sys-regular', 'SIGN IN');
        btn.type = 'button';
        btn.dataset.discussionSignin = 'true';
        box.appendChild(btn);
        return box;
    }

    function setStatus(text, isError) {
        const root = document.getElementById('discussion-section');
        if (!root) return;
        root.querySelectorAll('.discussion-composer-status').forEach(node => {
            node.textContent = text || '';
            node.classList.toggle('discussion-status-error', !!isError);
        });
    }

    // --- THE MAIN DRAW ---

    async function draw({ append = false } = {}) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        let posts;
        try {
            posts = await fetchTopLevel(state.offset);
        } catch (e) {
            // The normal state between pushing this branch and merging it -
            // migrations apply on merge, so the table genuinely does not exist
            // yet. Says so plainly rather than rendering a broken section.
            root.innerHTML = '';
            root.appendChild(el('h2', 'section-title discussion-title', 'Discussion'));
            const msg = (e && (e.code === 'PGRST205' || e.code === '42P01'))
                ? 'Discussions are not available on this page yet.'
                : 'Could not load the discussion. Try refreshing.';
            root.appendChild(el('p', 'discussion-error', msg));
            return;
        }

        const replies = await fetchReplies(posts.map(p => p.id)).catch(() => []);
        const byParent = new Map();
        replies.forEach(r => {
            if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
            byParent.get(r.parent_id).push(r);
        });

        if (posts.length < PAGE_SIZE) state.exhausted = true;

        let list = root.querySelector('.discussion-list');

        if (!append) {
            state.imagesByPost.clear();
            root.innerHTML = '';
            root.appendChild(el('h2', 'section-title discussion-title', 'Discussion'));

            if (isSignedIn() && !isBanned()) root.appendChild(renderComposer(null));
            else root.appendChild(renderSignInPrompt());

            list = el('div', 'discussion-list');
            root.appendChild(list);

            if (!posts.length) list.appendChild(renderEmptyState());
        }

        posts.forEach(p => list.appendChild(renderPost(p, byParent.get(p.id) || [])));

        // Not awaited: the thread is already on screen and the flairs arrive
        // when they arrive. Awaiting here would hold the render open on a
        // request that is decoration, and before the release this RPC does not
        // exist in production at all.
        decorateFlairs(root);

        const oldMore = root.querySelector('.discussion-more');
        if (oldMore) oldMore.remove();

        if (!state.exhausted) {
            const more = el('button', 'btn-sys btn-sys-regular discussion-more', 'LOAD OLDER POSTS');
            more.type = 'button';
            more.dataset.loadMore = 'true';
            root.appendChild(more);
        }
    }

    // --- ACTIONS ---

    async function submitPost(form) {
        const area = form.querySelector('.discussion-textarea');
        const submit = form.querySelector('.discussion-submit');
        if (!area) return;

        const body = area.value.trim();
        const attachments = pendingImages.get(form) || [];
        if (!body && !attachments.length) { setStatus('Write something first.', true); return; }

        const since = Date.now() - state.lastPostAt;
        if (state.lastPostAt && since < POST_COOLDOWN_MS) {
            setStatus(`Slow down — ${Math.ceil((POST_COOLDOWN_MS - since) / 1000)}s to go.`, true);
            return;
        }

        if (submit) submit.disabled = true;

        // Images go up FIRST, into the poster's own folder, and the post names
        // them. If anything after that fails, the files are taken back down,
        // so a refused post never leaves orphans in the bucket.
        const paths = [];
        if (attachments.length && state.session) {
            setStatus('Uploading images…');
            for (const item of attachments) {
                const path = `${state.session.user.id}/${newImageName()}.${item.ext}`;
                const { error: upErr } = await client().storage.from(IMAGE_BUCKET)
                    .upload(path, item.blob, { contentType: item.blob.type, cacheControl: '31536000' });
                if (upErr) {
                    await discardImages(paths);
                    if (submit) submit.disabled = false;
                    setStatus(/row-level security|unauthori[sz]ed/i.test(upErr.message || '')
                        ? 'Attaching images needs the upload media permission.'
                        : `An image could not be uploaded: ${upErr.message || 'unknown error'}`, true);
                    return;
                }
                paths.push(path);
            }
        }

        setStatus('Posting…');

        const parentId = form.dataset.parentId || null;

        // author_id and author_name are deliberately not sent. A BEFORE INSERT
        // trigger overwrites both from auth.uid(), so sending them would be
        // decoration that looks like it matters - and the day someone removes
        // the trigger, code that never claimed authorship keeps being safe.
        //
        // `images` only when there are some, so a words-only post is the same
        // request it always was.
        const row = { page_id: state.pageId, parent_id: parentId, body };
        if (paths.length) row.images = paths;
        const { error } = await client().from('page_discussions').insert([row]);

        if (submit) submit.disabled = false;

        if (error) {
            await discardImages(paths);
            // 53400 is the rate limit's own code; the message it carries is
            // already written for a person, so it is shown as-is.
            setStatus(error.message || 'Could not post.', true);
            return;
        }

        state.lastPostAt = Date.now();
        clearAttachments(form);
        area.value = '';
        state.replyingTo = null;
        state.offset = 0;
        state.exhausted = false;
        await draw();
        setStatus('');
    }

    async function removePost(postId) {
        const ok = window.customConfirm
            ? await window.customConfirm('Delete your post? The text is removed for good — replies to it stay.', 'DELETE POST', true)
            : window.confirm('Delete your post? The text is removed for good.');
        if (!ok) return;

        // Read before the call: removal empties the column server-side.
        const images = (state.imagesByPost.get(postId) || []).filter(p => IMAGE_PATH.test(p));

        const { error } = await client().rpc('remove_my_discussion_post', { p_post_id: postId });
        if (error) { setStatus(error.message || 'Could not remove that post.', true); return; }

        // An author's removal is final, so the files go with the words. Only
        // YOUR posts have a Delete button, and the bucket only lets you delete
        // from your own folder, so this can never reach anyone else's image.
        discardImages(images);

        state.offset = 0;
        state.exhausted = false;
        await draw();
    }

    function openModerationForm(postId, action) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        const existing = root.querySelector('.discussion-mod-form');
        if (existing) existing.remove();

        const target = document.getElementById(`post-${postId}`);
        if (!target) return;

        const form = renderModerationForm(postId, action);
        const actions = target.querySelector('.discussion-post-actions');
        if (actions) actions.insertAdjacentElement('afterend', form);
        else target.appendChild(form);

        const input = form.querySelector('.discussion-mod-reason');
        if (input) input.focus();
    }

    async function submitModeration(form) {
        const action = form.dataset.modAction;
        const postId = form.dataset.modPost;
        const input = form.querySelector('.discussion-mod-reason');
        const reason = input ? input.value.trim() : null;

        // Checked here so the message arrives beside the field rather than as
        // a database error. The RPC refuses an empty reason regardless - this
        // is the courtesy copy, not the rule.
        if (action !== 'restore' && !reason) {
            setStatus('A reason is required — it goes in the moderation log.', true);
            return;
        }

        const confirmBtn = form.querySelector('.discussion-mod-confirm');
        if (confirmBtn) confirmBtn.disabled = true;
        setStatus('Applying…');

        const { error } = await client().rpc('moderate_discussion_post', {
            p_post_id: postId,
            p_action: action,
            p_reason: reason || null,
        });

        if (confirmBtn) confirmBtn.disabled = false;

        if (error) { setStatus(error.message || 'Could not moderate that post.', true); return; }

        state.offset = 0;
        state.exhausted = false;
        await draw();
        updateJumpCount();
    }

    function openReply(postId) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        const existing = root.querySelector('.discussion-composer[data-parent-id]:not([data-parent-id=""])');
        if (existing) existing.remove();

        const target = document.getElementById(`post-${postId}`);
        if (!target) return;

        const composer = renderComposer(postId);
        const replies = target.querySelector('.discussion-replies');
        if (replies) replies.appendChild(composer);
        else target.appendChild(composer);

        state.replyingTo = postId;
        const area = composer.querySelector('.discussion-textarea');
        if (area) area.focus();
    }

    // One delegated listener for the whole section, so posts drawn later are
    // wired for free and nothing has to be re-bound after a redraw.
    function wire(root) {
        if (root.dataset.wired === 'true') return;
        root.dataset.wired = 'true';

        root.addEventListener('click', async (e) => {
            // First, because an author button sits inside the post head and
            // must not be swallowed by anything below it.
            const profile = e.target.closest('[data-profile-user]');
            if (profile) {
                if (typeof window.openPublicProfile === 'function') {
                    window.openPublicProfile(profile.dataset.profileUser);
                }
                return;
            }

            const attach = e.target.closest('[data-attach-image]');
            if (attach) {
                const form = attach.closest('.discussion-composer');
                const input = form && form.querySelector('.discussion-image-input');
                if (input) input.click();
                return;
            }

            const dropAttachment = e.target.closest('[data-remove-attachment]');
            if (dropAttachment) {
                const form = dropAttachment.closest('.discussion-composer');
                const list = (form && pendingImages.get(form)) || [];
                const [gone] = list.splice(Number(dropAttachment.dataset.removeAttachment), 1);
                if (gone) URL.revokeObjectURL(gone.previewUrl);
                renderAttachments(form);
                return;
            }

            const reply = e.target.closest('[data-reply-to]');
            if (reply) { openReply(reply.dataset.replyTo); return; }

            const cancel = e.target.closest('[data-cancel-reply]');
            if (cancel) {
                const form = cancel.closest('.discussion-composer');
                if (form) form.remove();
                state.replyingTo = null;
                return;
            }

            const remove = e.target.closest('[data-remove-post]');
            if (remove) { await removePost(remove.dataset.removePost); return; }

            const report = e.target.closest('[data-report-post]');
            if (report) { openReportForm(report.dataset.reportPost); return; }

            const cancelReport = e.target.closest('[data-cancel-report]');
            if (cancelReport) {
                const form = cancelReport.closest('.discussion-report-form');
                if (form) form.remove();
                return;
            }

            const moderate = e.target.closest('[data-moderate]');
            if (moderate) { openModerationForm(moderate.dataset.moderate, moderate.dataset.modAction); return; }

            const cancelMod = e.target.closest('[data-cancel-mod]');
            if (cancelMod) {
                const form = cancelMod.closest('.discussion-mod-form');
                if (form) form.remove();
                return;
            }

            const more = e.target.closest('[data-load-more]');
            if (more) {
                state.offset += PAGE_SIZE;
                await draw({ append: true });
                return;
            }

            const signin = e.target.closest('[data-discussion-signin]');
            if (signin && typeof window.openAuthModal === 'function') window.openAuthModal();
        });

        root.addEventListener('change', async (e) => {
            const input = e.target.closest('.discussion-image-input');
            if (!input) return;
            const files = Array.from(input.files || []);
            // Cleared first, so picking the same file again after removing it
            // still fires a change.
            input.value = '';
            await addImages(input.closest('.discussion-composer'), files);
        });

        // Pasting a screenshot straight into the box, which is how most people
        // already share one. Only images are taken; pasted text is left alone.
        root.addEventListener('paste', async (e) => {
            const area = e.target.closest('.discussion-textarea');
            if (!area || !state.canUploadMedia) return;
            const files = Array.from((e.clipboardData && e.clipboardData.files) || [])
                .filter(f => /^image\//.test(f.type));
            if (!files.length) return;
            e.preventDefault();
            await addImages(area.closest('.discussion-composer'), files);
        });

        root.addEventListener('submit', async (e) => {
            const rep = e.target.closest('.discussion-report-form');
            if (rep) { e.preventDefault(); await submitReport(rep); return; }

            const mod = e.target.closest('.discussion-mod-form');
            if (mod) { e.preventDefault(); await submitModeration(mod); return; }

            const form = e.target.closest('.discussion-composer');
            if (!form) return;
            e.preventDefault();
            await submitPost(form);
        });
    }

    // A notification links to characters/X/index.html#post-<id>, and the
    // browser resolves that fragment long before this section exists. Scrolls
    // to it once it does, so a reply notification lands on the reply.
    function honourHashTarget() {
        const hash = window.location.hash;
        if (!hash || !hash.startsWith('#post-')) return;
        const target = document.getElementById(hash.slice(1));
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('discussion-post-linked');
    }

    // --- THE JUMP BUTTON ---
    //
    // Wired before anything is fetched, so scrolling works even when the
    // thread itself fails to load. A control that does nothing because a query
    // failed is worse than no control.
    function wireJumpButton() {
        const btn = document.getElementById('btn-jump-discussion');
        if (!btn || btn.dataset.wired === 'true') return;
        btn.dataset.wired = 'true';

        btn.addEventListener('click', () => {
            const target = document.getElementById('discussion-section');
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    // A bare icon gives nobody a reason to press it. The count is the whole
    // argument for going down there, so the button carries it - and says
    // nothing at all rather than "0" when the thread is empty, because an
    // explicit zero reads as a dead feature.
    async function updateJumpCount() {
        const label = document.getElementById('jump-discussion-count');
        const btn = document.getElementById('btn-jump-discussion');
        if (!label) return;

        let count = null;
        try {
            const res = await client()
                .from('page_discussions')
                .select('id', { count: 'exact', head: true })
                .eq('page_id', state.pageId)
                .eq('status', 'visible');
            if (!res.error) count = res.count;
        } catch (e) {
            count = null;
        }

        if (typeof count !== 'number' || count <= 0) {
            label.textContent = '';
            if (btn) btn.setAttribute('aria-label', 'Jump to the discussion');
            return;
        }

        label.textContent = String(count);
        if (btn) btn.setAttribute('aria-label', `Jump to the discussion (${count})`);
    }

    window.initPageDiscussions = async function (pageId) {
        const root = document.getElementById('discussion-section');

        // The button is wired even when the section is missing, so a page that
        // somehow has one without the other still behaves predictably.
        wireJumpButton();

        if (!root || !client() || !pageId) return;

        state.pageId = pageId;
        state.offset = 0;
        state.exhausted = false;

        await loadViewer();
        wire(root);
        await draw();
        updateJumpCount();
        setTimeout(honourHashTarget, 300);
    };
})();
