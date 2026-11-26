/**
 * Discussion threads: a character page's thread under its tabs, and a Forum post's
 * conversation. Posts, replies, images, KLIPY GIFs and the GIF picker, emojis,
 * editing, reporting and moderation. On a character page it is loaded as the
 * thread nears the screen (js/pages/core/page_boot.js, which also runs the
 * jump-to-discussion button and its count); the Forum loads it with the page.
 * @since v0.14
 * @touches page_discussions, page_discussion_edits, user_roles, the
 *   discussion-media and discord-media buckets, the RPCs for reporting, moderating,
 *   editing and removing a post, get_page_experts, get_public_profiles, and KLIPY's
 *   API (only when a post is made, or from the GIF picker)
 * @watch the rules live in the database (authorship, the rate limit, the reply
 *   shape, the viewer ban); this file is the courtesy layer. A post is live the
 *   moment it is sent, so its text is never put in innerHTML: text nodes and real
 *   <br> nodes only.
 * @watch it never blocks the page: every failure here is a quiet message under the
 *   tabs
 * @see docs/discussions.md
 */

(function () {
    // Top-level posts a page, each with all its replies.
    const PAGE_SIZE = 100;
    const MAX_BODY = 4000;

    // Posts one person sends within this long of each other share one name line:
    // people send a thought as several short messages, and each as its own card reads
    // as a wall.
    const GROUP_WINDOW_MS = 7 * 60 * 1000;

    // The database's own limit, mirrored as a courtesy; the trigger enforces it.
    const POST_COOLDOWN_MS = 20000;

    // Both limits mirror the database: the count is page_discussions_images_check, the
    // size is discussion-media's own file_size_limit.
    const MAX_IMAGES = 4;
    const IMAGE_MAX_EDGE = 1600;
    const IMAGE_MAX_BYTES = 1024 * 1024;
    const IMAGE_BUCKET = 'discussion-media';

    // A stored path: the poster's id, then a name this page chose. Same rule as
    // the trigger's, so a row that somehow breaks it is not drawn at all.
    const IMAGE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.(webp|jpg)$/;

    // A picture the relay copied off Discord: its own bucket, named after the message.
    // The same rule as the shape trigger's and discord-relay-core.mjs's
    // COPIED_IMAGE_PATH.
    const DISCORD_IMAGE_PATH = /^discord\/[0-9]{5,20}-[0-3]\.(png|jpg|webp|gif)$/;
    const DISCORD_BUCKET = 'discord-media';

    // KLIPY's media hosts and path, exactly, so a post can never point a reader's
    // browser anywhere else.
    const KLIPY_MEDIA = /https:\/\/static2?\.klipy\.com\/ii\/[A-Za-z0-9/_-]+\.(gif|webp|mp4)(?![\w./-])/g;
    const KLIPY_MEDIA_EXACT = new RegExp(`^${KLIPY_MEDIA.source}$`);
    const MAX_GIFS = 4;

    // A KLIPY page link (klipy.com/gifs/<slug>, what Discord's GIF picker copies). The
    // page answers only crawlers, so the GIF is found through KLIPY's API once, when
    // the post is made, and the link is swapped for the GIF's own address before it is
    // saved: readers never call KLIPY. The key is visible in the page, like the anon
    // key (CLAUDE.md); a production key goes here and only here.
    const KLIPY_PAGE = /https?:\/\/(?:www\.)?klipy\.com\/gifs\/([A-Za-z0-9-]{1,120})[^\s]*/g;
    const KLIPY_API = 'https://api.klipy.com/api/v1/xdjct5ccuBWrbiAxgyaEgQdKcnFW5LIpjd1glWvPLALxPE6bNDPGsXXJaMPg9Xv7/gifs/';
    // MP4 first: far fewer bytes than the GIF, and it plays everywhere, iPhones
    // included. Then smaller sizes, then the heavier formats.
    const KLIPY_PICK = [['md', 'mp4'], ['hd', 'mp4'], ['sm', 'mp4'], ['md', 'webp'], ['sm', 'webp'], ['md', 'gif']];

    const state = {
        pageId: null,
        // Page 0 is the first in the thread's own order: the newest posts on a
        // character page, the oldest on a forum post.
        page: 0,
        pageCount: 1,
        session: null,
        role: undefined,   // undefined = not looked up, null = signed in with no role
        canModerate: false,
        canUploadMedia: false,
        lastPostAt: 0,
        replyingTo: null,
        // post id -> its image paths, as drawn. Removing your own post empties
        // the column server-side, so the paths to delete are read from here.
        imagesByPost: new Map(),
        // post id -> the row, as drawn: a reply's quote reads the
        // reply it answers from here, and the edit box starts from the words.
        postsById: new Map(),
        // How this page shows its thread. A character page keeps the defaults;
        // a forum post reads oldest first, with the reply box
        // after the conversation, the way a forum reads.
        opts: null,
        // The Rules page's address, or null while it does not exist.
        rulesUrl: null,
    };

    const DEFAULT_OPTS = {
        title: 'Discussion',
        order: 'newest',
        placeholder: 'Start a discussion about this character…',
        composerLast: false,
    };
    state.opts = { ...DEFAULT_OPTS };

    // Images picked in a composer and prepared, waiting for POST. Keyed by the
    // form, so a reply's attachments never leak into the top-level composer.
    const pendingImages = new WeakMap();
    // GIFs picked from KLIPY, the same way.
    const pendingGifs = new WeakMap();

    const client = () => window.supabaseClient;

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

    // Text into an element as text, line breaks as <br> nodes: escapeHtml plus
    // innerHTML would work, but puts an attacker-written string back in a sink, and
    // nodes cannot be got wrong the same way.
    function setTextWithBreaks(el, text) {
        el.textContent = '';
        String(text == null ? '' : text).split('\n').forEach((line, i) => {
            if (i > 0) el.appendChild(document.createElement('br'));
            el.appendChild(document.createTextNode(line));
        });
    }

    // A post's words with its emojis drawn (emoji.js); without that script, plain text.
    function setPostText(node, text) {
        if (window.DslEmoji) window.DslEmoji.renderText(node, text);
        else setTextWithBreaks(node, text);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // The author's name: a button when there is somebody to open, with the id in a
    // data attribute for the delegated listener. A plain span for a removed post (its
    // author is not named) and for a deleted account (author_id NULL).
    function authorNode(entry) {
        const removed = entry.status !== 'visible';
        const name = removed ? '-' : (entry.author_name || 'Unknown');

        // A message copied in from Discord: no wiki account to open, so the name is text,
        // then where it came from and the Discord handle, all set as text.
        if (!removed && entry.source === 'discord') {
            const span = el('span', 'discussion-author discussion-author-discord', name);
            span.appendChild(el('span', 'discussion-discord', 'DISCORD'));
            if (entry.discord_author_handle) {
                span.appendChild(el('span', 'discussion-handle', `@${entry.discord_author_handle}`));
            }
            return span;
        }

        if (removed || !entry.author_id) return el('span', 'discussion-author', name);

        const btn = el('button', 'discussion-author discussion-author-link', name);
        btn.type = 'button';
        btn.dataset.profileUser = entry.author_id;
        // The flair pass fills this in after the thread has rendered.
        btn.dataset.flairSlot = 'true';
        return btn;
    }

    // Each author's flair beside their name, after the thread is on screen: blocking
    // the thread on a profile request would trade what people came for for decoration.
    async function decorateFlairs(root) {
        if (typeof window.fetchPublicProfiles !== 'function') return;

        const slots = [...root.querySelectorAll('[data-profile-user]')];
        if (!slots.length) return;

        // Two requests for the whole thread, not per post, each allowed to fail alone.
        const [profiles, expertIds] = await Promise.all([
            window.fetchPublicProfiles(slots.map(s => s.dataset.profileUser)),
            fetchExpertIds(),
        ]);

        slots.forEach(slot => {
            const userId = slot.dataset.profileUser;

            // The EXPERT chip first, before the flair: the site vouching for somebody on this
            // page, apart from what they wrote about themselves. Only in threads on a page they
            // cover.
            if (expertIds.has(userId) && !slot.querySelector('.discussion-expert')) {
                slot.appendChild(el('span', 'discussion-expert', 'EXPERT'));
            }

            const p = profiles.get(userId);
            if (!p) return;
            if (p.flair && !slot.querySelector('.discussion-flair')) {
                slot.appendChild(el('span', 'discussion-flair', p.flair));
            }

            // The badges they show, after the flair: the flair is what they wrote, a badge is
            // what they did.
            if (typeof window.knownBadges === 'function' && !slot.querySelector('.user-badge')) {
                window.knownBadges(p.badges).forEach(id => slot.appendChild(window.badgeSlot(id, { named: true })));
            }
        });
    }

    // Who is an expert of this page: one call, since the thread knows its page_id.
    async function fetchExpertIds() {
        if (!client() || !state.pageId) return new Set();
        try {
            const { data, error } = await client()
                .rpc('get_page_experts', { target_page_id: state.pageId });
            if (error || !Array.isArray(data)) return new Set();
            return new Set(data.map(r => r.user_id));
        } catch (e) {
            // No RPC on this database: no chips, the same thread.
            return new Set();
        }
    }

    // The GIF a KLIPY page link points at, or null. KLIPY's answer is checked against
    // KLIPY_MEDIA like a pasted link, and no referrer tells KLIPY which page it was.
    async function klipyMediaFor(slug) {
        try {
            const res = await fetch(KLIPY_API + encodeURIComponent(slug),
                { referrerPolicy: 'no-referrer', credentials: 'omit' });
            if (!res.ok) return null;
            const json = await res.json();
            return klipyFileFor(json && json.data && json.data.file, KLIPY_PICK);
        } catch (e) { /* the link stays a link */ }
        return null;
    }

    // The first of `order`'s [size, format] pairs a KLIPY item has, and only
    // an address on KLIPY's own media hosts.
    function klipyFileFor(files, order) {
        for (const [size, format] of order) {
            const url = files && files[size] && files[size][format] && files[size][format].url;
            if (typeof url === 'string' && KLIPY_MEDIA_EXACT.test(url)) return url;
        }
        return null;
    }

    // Each KLIPY page link becomes its GIF, the first MAX_GIFS, one lookup at a time.
    // A link that cannot be resolved stays a link, and the post still goes up.
    async function resolveKlipyPages(body) {
        const found = [...String(body || '').matchAll(KLIPY_PAGE)].slice(0, MAX_GIFS);
        let out = body;
        let unresolved = 0;
        for (const match of found) {
            const media = await klipyMediaFor(match[1]);
            if (media) out = out.split(match[0]).join(media);
            else unresolved += 1;
        }
        // The addresses are longer than the links. Past the limit, nothing is
        // swapped rather than some of it.
        if (out.length > MAX_BODY) return { body, unresolved: found.length };
        return { body: out, unresolved };
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

    // What a post carries besides words: its images, then its KLIPY GIFs. Built with
    // createElement, every address set as a property after an exact pattern: this
    // draws unreviewed input on every character page.
    function renderPostMedia(entry) {
        // Each path is drawn from the bucket its own pattern names, and a path
        // matching neither is not drawn at all.
        const bucketFor = (p) => (IMAGE_PATH.test(p) ? IMAGE_BUCKET : DISCORD_IMAGE_PATH.test(p) ? DISCORD_BUCKET : null);
        const images = (Array.isArray(entry.images) ? entry.images : [])
            .filter(p => typeof p === 'string' && bucketFor(p))
            .slice(0, MAX_IMAGES);
        const gifs = klipyLinks(entry.body);
        if (!images.length && !gifs.length) return null;

        const box = el('div', 'discussion-media');

        images.forEach(path => {
            const url = client().storage.from(bucketFor(path)).getPublicUrl(path).data.publicUrl;
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
                // KLIPY's MP4 plays the part of a GIF: muted, looping, inline.
                node = document.createElement('video');
                node.muted = true;
                node.loop = true;
                node.autoplay = true;
                node.playsInline = true;
                node.setAttribute('playsinline', '');
                node.setAttribute('aria-label', 'GIF from KLIPY');
                // Into the clip queue (initLazyMedia), so a thread full of GIFs does not load them
                // all at once. A <video> has no referrerPolicy; the default sends KLIPY the site's
                // origin, never the page.
                if (typeof window.initLazyMedia === 'function') {
                    node.preload = 'none';
                    node.setAttribute('data-lazy-src', url);
                } else {
                    node.src = url;
                }
            } else {
                // Native lazy loading: an image off screen is not fetched.
                node = document.createElement('img');
                node.loading = 'lazy';
                node.decoding = 'async';
                node.alt = 'GIF from KLIPY';
                // KLIPY sees that a GIF was loaded, not which page it was on.
                node.referrerPolicy = 'no-referrer';
                node.src = url;
            }
            node.className = 'discussion-media-gif';
            box.appendChild(node);
        });

        if (gifs.length) box.appendChild(el('span', 'discussion-media-credit', 'GIF via KLIPY'));
        return box;
    }

    // An image is shrunk to IMAGE_MAX_EDGE on its long side and re-encoded in the
    // browser: WebP where the browser can encode it, JPEG where not (Safari, so every
    // browser on iOS, returns a PNG when asked for WebP). Probed once with a 1px WebP.
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

    // Best effort, never awaited by anything a reader waits on: a file left behind
    // costs a few hundred KB, not a broken post.
    async function discardImages(paths) {
        if (!paths || !paths.length || !client()) return;
        try { await client().storage.from(IMAGE_BUCKET).remove(paths); } catch (e) { /* see above */ }
    }

    function renderAttachments(form) {
        const strip = form.querySelector('.discussion-attachments');
        if (!strip) return;
        const list = pendingImages.get(form) || [];
        const gifs = pendingGifs.get(form) || [];
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
        gifs.forEach((gif, i) => {
            const cell = el('div', 'discussion-attachment discussion-attachment-gif');
            const img = document.createElement('img');
            img.referrerPolicy = 'no-referrer';
            img.src = gif.preview;
            img.alt = `GIF ${i + 1} to attach: ${gif.title}`;
            cell.appendChild(img);
            const x = el('button', 'discussion-attachment-remove', '×');
            x.type = 'button';
            x.dataset.removeGif = String(i);
            x.setAttribute('aria-label', `Remove GIF ${i + 1}`);
            cell.appendChild(x);
            strip.appendChild(cell);
        });
        strip.hidden = list.length + gifs.length === 0;
    }

    function clearAttachments(form) {
        (pendingImages.get(form) || []).forEach(item => URL.revokeObjectURL(item.previewUrl));
        pendingImages.delete(form);
        pendingGifs.delete(form);
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
                if (file.type === 'image/gif') note = 'A GIF is posted as a still image. For a moving one, use the GIF button.';
            } catch (err) {
                problem = err.message;
            }
        }
        pendingImages.set(form, list);
        renderAttachments(form);
        setStatus(problem || note, !!problem);
    }

    // The GIF picker, KLIPY's own search, to its production rules: the box says
    // "Search KLIPY", every request and picture goes straight from the reader's
    // browser to KLIPY, results show in KLIPY's order with nothing added or taken out.
    // Its strictest content filter, since many readers are children, and no user id.
    // A picked GIF is posted as its own address, like a pasted KLIPY link.
    const GIF_PAGE = 24;
    const GIF_SEARCH_DELAY_MS = 350;
    // Small and moving, for the grid and the attachment strip.
    const GIF_PREVIEW = [['xs', 'webp'], ['xs', 'gif'], ['sm', 'webp'], ['sm', 'gif']];
    const KLIPY_SLUG = /^[A-Za-z0-9-]{1,120}$/;

    async function klipyList(query, page) {
        const params = new URLSearchParams({ page: String(page), per_page: String(GIF_PAGE), content_filter: 'high' });
        if (query) params.set('q', query);
        const res = await fetch(`${KLIPY_API}${query ? 'search' : 'trending'}?${params}`,
            { referrerPolicy: 'no-referrer', credentials: 'omit' });
        if (!res.ok) throw new Error(`KLIPY answered ${res.status}`);
        const json = await res.json();
        const data = (json && json.data) || {};
        return { items: Array.isArray(data.data) ? data.data : [], more: data.has_next === true };
    }

    // KLIPY counts a GIF as shared when it is posted, with the words that found it and
    // nothing that says who. Deliberately quiet: a lost share costs the poster nothing.
    function reportShares(gifs) {
        gifs.forEach(gif => {
            fetch(`${KLIPY_API}share/${encodeURIComponent(gif.slug)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: gif.query }),
                referrerPolicy: 'no-referrer',
                credentials: 'omit',
                keepalive: true,
            }).catch(() => {});
        });
    }

    function closeGifPickers() {
        document.querySelectorAll('.gif-picker').forEach(panel => {
            if (panel.gifToggle) panel.gifToggle.setAttribute('aria-expanded', 'false');
            if (panel.gifSeen) panel.gifSeen.disconnect();
            panel.remove();
        });
    }

    function buildGifPicker(form, toggle) {
        const panel = el('div', 'gif-picker');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'GIFs from KLIPY');
        panel.gifToggle = toggle;

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'editor-input gif-search';
        search.placeholder = 'Search KLIPY';
        search.setAttribute('aria-label', 'Search KLIPY');
        search.autocomplete = 'off';

        const scroll = el('div', 'gif-scroll');
        const grid = el('div', 'gif-grid');
        // Where the next page is asked for, once it nears the view.
        const end = el('div', 'gif-end');
        scroll.append(grid, end);
        const note = el('p', 'gif-note');
        note.hidden = true;
        panel.append(search, scroll, note, el('p', 'gif-credit', 'Powered by KLIPY'));
        const showNote = (text) => { note.textContent = text || ''; note.hidden = !text; };

        // A picture's address is set as it scrolls into the picker's view: loading="lazy"
        // does not hold inside a scrolling box.
        const seen = new IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const target = entry.target;
            if (target === end) { load(false); return; }
            seen.unobserve(target);
            target.src = target.dataset.src;
            delete target.dataset.src;
        }), { root: scroll, rootMargin: '160px 0px' });
        panel.gifSeen = seen;

        // One list at a time: an answer for an older search is dropped.
        const list = { query: '', page: 0, more: true, loading: false, run: 0, gifs: [] };

        function cell(item) {
            const url = item && klipyFileFor(item.file, KLIPY_PICK);
            const preview = item && klipyFileFor(item.file, GIF_PREVIEW);
            // Nothing to draw: no address on KLIPY's media hosts.
            if (!url || !preview || !KLIPY_SLUG.test(String(item.slug))) return null;
            const title = (typeof item.title === 'string' && item.title.trim()) ? item.title.trim().slice(0, 100) : 'GIF';
            const btn = el('button', 'gif-cell');
            btn.type = 'button';
            btn.dataset.gifIndex = String(list.gifs.length);
            btn.dataset.tip = title;
            btn.setAttribute('aria-label', title);
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.dataset.src = preview;
            btn.appendChild(img);
            list.gifs.push({ url, preview, slug: item.slug, title, query: list.query });
            seen.observe(img);
            return btn;
        }

        async function load(fresh) {
            if (fresh) {
                list.run++;
                Object.assign(list, { page: 0, more: true, loading: false, gifs: [] });
                grid.textContent = '';
                scroll.scrollTop = 0;
                showNote('');
            }
            if (list.loading || !list.more) return;
            list.loading = true;
            const run = list.run;
            let answer;
            try {
                answer = await klipyList(list.query, list.page + 1);
            } catch (e) {
                if (run !== list.run) return;
                list.loading = false;
                console.error('[Discussions] KLIPY could not be reached:', e);
                showNote('KLIPY could not be reached. Try again in a moment.');
                return;
            }
            if (run !== list.run) return;
            list.loading = false;
            list.page += 1;
            list.more = answer.more;
            answer.items.forEach(item => {
                const node = cell(item);
                if (node) grid.appendChild(node);
            });
            if (!list.gifs.length) showNote(list.query ? 'No GIFs for that.' : 'KLIPY has nothing to show right now.');
        }

        let typing = null;
        search.addEventListener('input', () => {
            clearTimeout(typing);
            typing = setTimeout(() => {
                list.query = search.value.trim();
                load(true);
            }, GIF_SEARCH_DELAY_MS);
        });

        panel.addEventListener('click', (e) => {
            const pick = e.target.closest('[data-gif-index]');
            if (!pick) return;
            const chosen = pendingGifs.get(form) || [];
            if (chosen.length >= MAX_GIFS) { showNote(`Up to ${MAX_GIFS} GIFs a post.`); return; }
            chosen.push(list.gifs[Number(pick.dataset.gifIndex)]);
            pendingGifs.set(form, chosen);
            renderAttachments(form);
            closeGifPickers();
            toggle.focus();
        });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            closeGifPickers();
            toggle.focus();
        });

        load(true);
        seen.observe(end);
        return { panel, search };
    }

    // Opens KLIPY's picker at the end of the post box, or closes it.
    function toggleGifPicker(form, toggle) {
        const open = form.querySelector(':scope > .gif-picker');
        closeGifPickers();
        if (open) return;
        const { panel, search } = buildGifPicker(form, toggle);
        form.appendChild(panel);
        toggle.setAttribute('aria-expanded', 'true');
        // Not on a touch screen, where the keyboard would cover the grid.
        if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) search.focus();
    }

    // The Rules page (forum_rules), linked from the box that starts a conversation.
    // Its address comes from navigation.json, which lists live pages only, so there is
    // no link until the page is live.
    const RULES_PAGE_ID = 'forum_rules';
    let rulesLinkLoad = null;

    function loadRulesLink() {
        if (!rulesLinkLoad) {
            rulesLinkLoad = (async () => {
                try {
                    const nav = await fetchNavigationData();
                    for (const entries of Object.values(nav || {})) {
                        const hit = (entries || []).find(e => e && e.cms_config && e.cms_config.pageId === RULES_PAGE_ID && e.url);
                        if (hit) return `${getRootPath()}${hit.url}`;
                    }
                } catch (e) {
                    // No navigation, no link.
                }
                return null;
            })().then(url => { state.rulesUrl = url; });
        }
        return rulesLinkLoad;
    }

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
            // select('*'): this row gains a column with each capability, and a named list
            // would break the thread on a client newer than its database.
            const { data } = await client()
                .from('user_roles').select('*')
                .eq('user_id', state.session.user.id).maybeSingle();
            // null is signed in with no role, the ordinary contributor; undefined is nobody
            // signed in.
            state.role = data ? data.role : null;
            // Mirrors can_moderate() in SQL: admin and above, or the owner's tick. It only
            // decides which buttons to draw; the RPC refuses.
            state.canModerate = !!data && (
                window.roleMeets(data.role, 'admin') || data.can_moderate === true
            );
            // Mirrors can_upload_media(): Trusted Editor and up, or the owner's tick, and never
            // a viewer (a ban, so by name). It only decides whether the composer offers images.
            state.canUploadMedia = !!data && data.role !== 'viewer' && (
                window.roleMeets(data.role, 'trusted_editor') || data.can_upload_media === true
            );
        } catch (e) {
            state.role = null;
            state.canModerate = false;
            state.canUploadMedia = false;
        }
    }

    // The soft ban: a viewer can read and cannot post.
    const isBanned = () => state.role === 'viewer';
    const isSignedIn = () => !!state.session;

    async function fetchTopLevel(page) {
        // Ordered by created_at and id: range() needs a total order, or two posts with one
        // timestamp can swap places between pages. The count rides on the same request,
        // under the reader's own RLS, so a moderator's pages include hidden posts.
        const offset = page * PAGE_SIZE;
        const { data, error, count } = await client()
            .from('page_discussions')
            .select('*', { count: 'exact' })
            .eq('page_id', state.pageId)
            .is('parent_id', null)
            .order('created_at', { ascending: state.opts.order === 'oldest' })
            .order('id', { ascending: state.opts.order === 'oldest' })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;
        return { posts: data || [], count: typeof count === 'number' ? count : null };
    }

    // Which page a post is on, for a notification's #post- link: how many
    // top-level posts come before it in the thread's order. A reply is on its
    // post's page. Page 0 whenever it cannot be worked out.
    async function pageOf(postId) {
        try {
            const { data: target } = await client()
                .from('page_discussions')
                .select('id, parent_id, created_at')
                .eq('id', postId)
                .maybeSingle();
            if (!target) return 0;
            let anchor = target;
            if (target.parent_id) {
                const { data: parent } = await client()
                    .from('page_discussions')
                    .select('id, created_at')
                    .eq('id', target.parent_id)
                    .maybeSingle();
                if (!parent) return 0;
                anchor = parent;
            }
            const at = `"${anchor.created_at}"`;
            const op = state.opts.order === 'oldest' ? 'lt' : 'gt';
            const { count, error } = await client()
                .from('page_discussions')
                .select('id', { count: 'exact', head: true })
                .eq('page_id', state.pageId)
                .is('parent_id', null)
                .or(`created_at.${op}.${at},and(created_at.eq.${at},id.${op}.${anchor.id})`);
            if (error || typeof count !== 'number') return 0;
            return Math.floor(count / PAGE_SIZE);
        } catch (e) {
            return 0;
        }
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

    // Reporting turns moderation from patrolling into a queue. No "incorrect" reason:
    // on a frame-data wiki that is the commonest complaint and the least actionable, a
    // thread is where being wrong is argued, and a queue full of disagreements trains
    // moderators to skim past real harassment.
    const REPORT_REASONS = [
        { id: 'spam', label: 'Spam or advertising' },
        { id: 'harassment', label: 'Harassment or abuse' },
        { id: 'off_topic', label: 'Off topic for this page' },
        { id: 'other', label: 'Something else' },
    ];

    function renderReportForm(postId) {
        const form = el('form', 'discussion-report-form');
        // Not data-report-post: the delegated handler matches the nearest ancestor with
        // the trigger's attribute, so the same name on the form reopened it on Send.
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

        const anchor = formAnchor(target);
        const form = renderReportForm(postId);
        if (anchor) anchor.insertAdjacentElement('afterend', form);
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

        // Replaced, so nobody wonders whether it went. The same message for a new report
        // and a duplicate (the RPC's comment says why).
        form.replaceWith(el('div', 'discussion-report-sent', data || 'Thanks. A moderator will take a look.'));
    }

    // One builder for the moderation controls on posts and replies, so the two say the
    // same thing about who may do what. Report is offered on anything still visible
    // that is not yours, to anyone signed in and not banned, and not to a moderator on
    // a post they can act on directly.
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

    // The reason hide and remove require is asked inline, not by prompt(): a required
    // field Escape can dismiss is not required.
    function renderModerationForm(postId, action) {
        const form = el('form', 'discussion-mod-form');
        form.dataset.modPost = postId;
        form.dataset.modAction = action;

        // Validated by hand: native validation would show its own bubble instead of this
        // file's one status line.
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
            input.placeholder = 'Recorded in the moderation log; required';
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

    // A post's own words and buttons: straight inside it, or inside its line
    // when it is part of a stack. Never a later post's, which sits inside the
    // first one's card.
    function ownBody(target) {
        return target.querySelector(':scope > .discussion-body, :scope > .discussion-item-row > .discussion-body');
    }

    // Where a report or moderation form goes: under the post's buttons, or
    // under its whole line in a stack.
    function formAnchor(target) {
        const actions = target.querySelector(':scope > .discussion-post-actions, :scope > .discussion-item-row > .discussion-post-actions');
        if (!actions) return null;
        return actions.closest('.discussion-item-row') || actions;
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

    // Who said it, which decides whether a post joins the name line above it.
    // A Discord message is its Discord account, a wiki one its wiki account,
    // and a deleted account its name.
    function authorKey(entry) {
        if (entry.source === 'discord') return `d:${entry.discord_author_id || entry.author_name}`;
        return entry.author_id ? `w:${entry.author_id}` : `n:${entry.author_name}`;
    }

    // Whether a post goes under the previous post's name line, the previous
    // one being the one sent just before it. Same person, within
    // GROUP_WINDOW_MS, and both visible: a removed post's author is
    // deliberately not named, and grouping it under somebody's name would
    // name them. A hidden one keeps its own card and its marker.
    function joinsPrevious(entry, prev) {
        if (!prev) return false;
        if (entry.status !== 'visible' || prev.status !== 'visible') return false;
        if (authorKey(entry) !== authorKey(prev)) return false;
        const gap = new Date(entry.created_at).getTime() - new Date(prev.created_at).getTime();
        return gap >= 0 && gap <= GROUP_WINDOW_MS;
    }

    // A page's posts as runs, each oldest first, the runs in the thread's own
    // order. A run never crosses a page: the page is what was fetched.
    function runsOf(posts) {
        const chrono = posts.slice().sort((a, b) =>
            (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1)));
        const runs = [];
        chrono.forEach((post, i) => {
            if (i > 0 && joinsPrevious(post, chrono[i - 1])) runs[runs.length - 1].push(post);
            else runs.push([post]);
        });
        return state.opts.order === 'oldest' ? runs : runs.reverse();
    }

    // The round letter where Discord shows a picture: the site has no profile
    // pictures. The colour comes from who it is, so one person keeps one
    // colour down the thread. Text and a style property, never markup.
    function avatarNode(entry) {
        const removed = entry.status !== 'visible' && entry.status !== 'hidden';
        const name = removed ? '' : String(entry.author_name || '?');
        const letter = Array.from(name.trim())[0] || '?';
        const node = el('span', 'discussion-avatar', removed ? '' : letter.toUpperCase());
        node.setAttribute('aria-hidden', 'true');
        if (!removed) {
            // FNV-1a, so two keys one character apart ("w:u1", "w:u2") still
            // land far apart on the colour wheel. A plain running sum put them
            // one degree apart: two people, the same blue.
            let hash = 0x811c9dc5;
            for (const ch of authorKey(entry)) {
                hash ^= ch.charCodeAt(0);
                hash = Math.imul(hash, 0x01000193) >>> 0;
            }
            node.style.backgroundColor = `hsl(${hash % 360}, 45%, 42%)`;
        }
        return node;
    }

    // Whether it changed since: edited by its author on the wiki,
    // or on Discord. A moderator's mark is a button that opens what it said
    // before; everyone else only learns that it changed.
    function editedMark(entry) {
        const shown = entry.status === 'visible' || (entry.status === 'hidden' && state.canModerate);
        if (!shown || !entry.edited_at) return null;
        const label = entry.source === 'discord' ? 'edited on Discord' : 'edited';
        if (state.canModerate) {
            const btn = el('button', 'discussion-edited discussion-edited-open', label);
            btn.type = 'button';
            btn.dataset.tip = 'Show what this said before (moderators only)';
            btn.dataset.showEdits = entry.id;
            return btn;
        }
        return el('span', 'discussion-edited', label);
    }

    // Who, when, and whether it changed since.
    function postHead(entry) {
        const head = el('div', 'discussion-post-head');
        head.appendChild(authorNode(entry));
        head.appendChild(el('span', 'discussion-time', timeAgo(entry.created_at)));
        const mark = editedMark(entry);
        if (mark) head.appendChild(mark);
        return head;
    }

    // A reply to a reply says which one it answers: replies stay one step in, so this
    // line keeps a conversation inside a conversation readable. Under a stack, a reply
    // to one of its posts quotes which.
    function replyQuote(reply, quoteParent) {
        const answeredId = reply.reply_to || (quoteParent ? reply.parent_id : null);
        if (!answeredId) return null;
        const answered = state.postsById.get(answeredId);
        const quote = el('button', 'discussion-quote');
        quote.type = 'button';
        quote.dataset.jumpTo = answeredId;
        if (answered && answered.status === 'visible') {
            const words = textWithoutGifs(answered.body, klipyLinks(answered.body)).replace(/\s+/g, ' ').trim();
            const shortened = words.length > 100 ? `${words.slice(0, 99).trimEnd()}…` : words;
            quote.appendChild(el('span', 'discussion-quote-name', `↪ ${answered.author_name || 'Unknown'}:`));
            quote.appendChild(document.createTextNode(` ${shortened || '[a picture]'}`));
        } else {
            quote.textContent = '↪ a removed message';
        }
        return quote;
    }

    // Reply, Edit and Delete, for whoever may use them. Edit and Delete are the
    // author's own, and only on the wiki: a message copied from Discord has no
    // wiki author.
    function appendOwnActions(actions, entry) {
        if (entry.status !== 'visible') return;
        if (isSignedIn() && !isBanned()) {
            const replyBtn = el('button', 'discussion-action-btn', 'Reply');
            replyBtn.type = 'button';
            // data- attribute and a delegated listener: post ids and names are user-influenced.
            replyBtn.dataset.replyTo = entry.id;
            actions.appendChild(replyBtn);
        }
        const isMine = state.session && entry.author_id === state.session.user.id && entry.source !== 'discord';
        if (!isMine) return;
        if (!isBanned()) {
            const editBtn = el('button', 'discussion-action-btn', 'Edit');
            editBtn.type = 'button';
            editBtn.dataset.editPost = entry.id;
            actions.appendChild(editBtn);
        }
        const delBtn = el('button', 'discussion-action-btn discussion-action-danger', 'Delete');
        delBtn.type = 'button';
        delBtn.dataset.removePost = entry.id;
        actions.appendChild(delBtn);
    }

    function removedText(status) {
        if (status === 'removed_by_staff') return '[removed by a moderator]';
        if (status === 'removed_on_discord') return '[removed on Discord]';
        return '[removed by the author]';
    }

    // A run of posts from one person, as one card: the first post IS the card
    // (#post-<id>, with the name line), and each later one sits inside it with
    // its own words, buttons and a time that shows on hover. Every post stays
    // its own row, so deleting or editing one on Discord still reaches just
    // that one. The replies to any of them follow the last.
    function renderRun(run, repliesByParent) {
        const [first, ...rest] = run;
        const wrap = renderPost(first, [], { stacked: rest.length > 0 });

        rest.forEach(post => {
            const item = el('div', 'discussion-post-item');
            item.id = `post-${post.id}`;
            const when = el('span', 'discussion-item-time', timeAgo(post.created_at));
            when.dataset.tip = new Date(post.created_at).toLocaleString();
            item.appendChild(when);
            item.appendChild(itemRow(post));
            appendMedia(item, post);
            wrap.appendChild(item);
        });

        const replies = run.flatMap(p => repliesByParent.get(p.id) || [])
            .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        if (replies.length) {
            const list = el('div', 'discussion-replies');
            replies.forEach(reply => list.appendChild(renderReply(reply, rest.length > 0)));
            wrap.appendChild(list);
        }
        return wrap;
    }

    // In a stack, a post's words and its buttons share one line, so a run of
    // five short messages is not five rows of buttons.
    function itemRow(post) {
        const row = el('div', 'discussion-item-row');
        const body = el('div', 'discussion-body');
        setPostText(body, textWithoutGifs(post.body, klipyLinks(post.body)));
        row.appendChild(body);
        const mark = editedMark(post);
        if (mark) body.appendChild(mark);
        const actions = el('div', 'discussion-post-actions');
        appendOwnActions(actions, post);
        appendReportControl(actions, post);
        appendModerationControls(actions, post);
        if (actions.childNodes.length) row.appendChild(actions);
        return row;
    }

    function renderPost(post, replies, { stacked = false } = {}) {
        const removed = post.status !== 'visible';

        const wrap = el('article', 'discussion-post' + (removed ? ' discussion-post-removed' : '') + (stacked ? ' discussion-run' : ''));
        wrap.id = `post-${post.id}`;

        wrap.appendChild(avatarNode(post));

        if (stacked) {
            // Only a visible post joins a run, so this is always the plain case.
            const head = el('div', 'discussion-post-head');
            head.appendChild(authorNode(post));
            head.appendChild(el('span', 'discussion-time', timeAgo(post.created_at)));
            wrap.appendChild(head);
            wrap.appendChild(itemRow(post));
            appendMedia(wrap, post);
            return wrap;
        }

        wrap.appendChild(postHead(post));

        const body = el('div', 'discussion-body');
        if (post.status === 'hidden') {
            // Only a moderator can see this at all (the SELECT policy filters it out for
            // everyone else), so the body is shown under a marker. Appended, not
            // insertBefore(badge, body): body is not a child of wrap yet, and that throws.
            wrap.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
            setPostText(body, textWithoutGifs(post.body, klipyLinks(post.body)));
        } else if (removed) {
            body.classList.add('discussion-body-removed');
            body.textContent = removedText(post.status);
        } else {
            setPostText(body, textWithoutGifs(post.body, klipyLinks(post.body)));
        }
        wrap.appendChild(body);
        appendMedia(wrap, post);

        const actions = el('div', 'discussion-post-actions');
        appendOwnActions(actions, post);
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

    function renderReply(reply, quoteParent = false) {
        const removed = reply.status !== 'visible';
        const wrap = el('div', 'discussion-reply' + (removed ? ' discussion-post-removed' : ''));
        wrap.id = `post-${reply.id}`;

        const head = postHead(reply);
        head.prepend(avatarNode(reply));
        wrap.appendChild(head);

        const body = el('div', 'discussion-body');
        if (reply.status === 'hidden') {
            wrap.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
            setPostText(body, textWithoutGifs(reply.body, klipyLinks(reply.body)));
        } else if (removed) {
            body.classList.add('discussion-body-removed');
            body.textContent = removedText(reply.status);
        } else {
            setPostText(body, textWithoutGifs(reply.body, klipyLinks(reply.body)));
        }
        const quote = removed && reply.status !== 'hidden' ? null : replyQuote(reply, quoteParent);
        if (quote) wrap.appendChild(quote);
        wrap.appendChild(body);
        appendMedia(wrap, reply);

        const actions = el('div', 'discussion-post-actions');
        appendOwnActions(actions, reply);
        appendReportControl(actions, reply);
        appendModerationControls(actions, reply);

        if (actions.childNodes.length) wrap.appendChild(actions);

        return wrap;
    }

    // An empty thread is what most readers meet first: an invitation reads like a
    // place to write, "No posts yet" like an error.
    function renderEmptyState() {
        const box = el('div', 'discussion-empty');
        box.appendChild(el('p', 'discussion-empty-title', 'No discussion here yet.'));

        if (!isSignedIn()) {
            box.appendChild(el('p', 'discussion-empty-body',
                'Sign in to start one. Matchup disagreements, combo routes, or anything the page gets wrong.'));
        } else if (isBanned()) {
            box.appendChild(el('p', 'discussion-empty-body',
                'Your account can read discussions but not post in them.'));
        } else {
            box.appendChild(el('p', 'discussion-empty-body',
                'Start it. Matchup disagreements, combo routes, or anything this page gets wrong.'));
        }
        return box;
    }

    function renderComposer(parentId, overrides = {}) {
        const form = el('form', 'discussion-composer');
        form.dataset.parentId = parentId || '';

        if (parentId) {
            // A reply to a reply names the person, as text.
            const heading = el('div', 'discussion-composer-heading',
                overrides.replyingTo ? `Replying to ${overrides.replyingTo}` : 'Replying to this post');
            form.appendChild(heading);
        }

        const area = document.createElement('textarea');
        area.className = 'discussion-textarea';
        area.maxLength = MAX_BODY;
        area.rows = parentId ? 2 : 3;
        area.placeholder = parentId ? 'Write a reply…' : (overrides.placeholder || state.opts.placeholder);
        area.setAttribute('aria-label', parentId ? 'Reply' : 'New post');
        form.appendChild(area);

        // What goes with the words: images and picked GIFs, for anyone who can post.
        const strip = el('div', 'discussion-attachments');
        strip.hidden = true;
        form.appendChild(strip);

        // Images only for whoever may upload: a button the bucket then refuses would only
        // ever fail.
        if (state.canUploadMedia) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.hidden = true;
            input.className = 'discussion-image-input';
            form.appendChild(input);
        }

        const row = el('div', 'discussion-composer-row');

        const submit = el('button', 'btn-sys btn-sys-blue discussion-submit', parentId ? 'REPLY' : (overrides.submitLabel || 'POST'));
        submit.type = 'submit';
        row.appendChild(submit);

        if (state.canUploadMedia) {
            const attach = el('button', 'btn-sys btn-sys-regular discussion-attach', 'IMAGE');
            attach.type = 'button';
            attach.dataset.attachImage = 'true';
            attach.dataset.tip = `Attach up to ${MAX_IMAGES} images. You can also paste one into the box.`;
            row.appendChild(attach);
        }

        const gif = el('button', 'btn-sys btn-sys-regular discussion-gif-btn', 'GIF');
        gif.type = 'button';
        gif.dataset.gifToggle = 'true';
        gif.setAttribute('aria-expanded', 'false');
        gif.dataset.tip = `Add a GIF from KLIPY, up to ${MAX_GIFS} a post`;
        row.appendChild(gif);

        const emoji = emojiButton();
        if (emoji) row.appendChild(emoji);

        if (parentId) {
            const cancel = el('button', 'btn-sys btn-sys-regular discussion-cancel', 'CANCEL');
            cancel.type = 'button';
            cancel.dataset.cancelReply = 'true';
            row.appendChild(cancel);
        }

        row.appendChild(el('span', 'discussion-composer-status'));

        // On the box that starts a conversation, not on every reply box. A new
        // tab, so a half-written post is not lost.
        if (!parentId && state.rulesUrl) {
            const rules = el('a', 'discussion-rules-link', 'Rules');
            rules.href = state.rulesUrl;
            rules.target = '_blank';
            rules.rel = 'noopener';
            row.appendChild(rules);
        }
        form.appendChild(row);

        return form;
    }

    // Opens the emoji picker under its box (emoji.js). No script, no button.
    function emojiButton() {
        if (!window.DslEmoji) return null;
        const btn = el('button', 'btn-sys btn-sys-regular discussion-emoji-btn', 'EMOJI');
        btn.type = 'button';
        btn.dataset.emojiToggle = 'true';
        btn.setAttribute('aria-expanded', 'false');
        btn.dataset.tip = 'Add an emoji';
        return btn;
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
        document.querySelectorAll('.discussion-composer-status').forEach(node => {
            node.textContent = text || '';
            node.classList.toggle('discussion-status-error', !!isError);
        });
    }

    // Older and newer pages, above and below the list, only when there is more
    // than one. "Next" is older posts on a character page and newer ones on a
    // forum post, since each opens on its own first page.
    function renderPager(where) {
        const bar = el('div', `discussion-pager discussion-pager-${where}`);
        const newestFirst = state.opts.order !== 'oldest';
        const go = (label, page) => {
            const btn = el('button', 'btn-sys btn-sys-regular discussion-page-btn', label);
            btn.type = 'button';
            btn.dataset.pageGo = String(page);
            bar.appendChild(btn);
        };
        if (state.page > 0) go(newestFirst ? 'NEWER POSTS' : 'OLDER POSTS', state.page - 1);
        if (state.page < state.pageCount - 1) go(newestFirst ? 'OLDER POSTS' : 'NEWER POSTS', state.page + 1);
        bar.appendChild(el('span', 'discussion-page-label', `Page ${state.page + 1} of ${state.pageCount}`));
        return bar;
    }

    async function draw() {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        let posts;
        let count;
        try {
            ({ posts, count } = await fetchTopLevel(state.page));
        } catch (e) {
            // A database without the table yet (migrations apply on merge): said plainly,
            // rather than a broken section.
            root.innerHTML = '';
            root.appendChild(el('h2', 'section-title discussion-title', state.opts.title));
            const msg = (e && (e.code === 'PGRST205' || e.code === '42P01'))
                ? 'Discussions are not available on this page yet.'
                : 'Could not load the discussion. Try refreshing.';
            root.appendChild(el('p', 'discussion-error', msg));
            return;
        }

        state.pageCount = count !== null
            ? Math.max(1, Math.ceil(count / PAGE_SIZE))
            : (posts.length === PAGE_SIZE ? state.page + 2 : state.page + 1);

        // A page past the end (posts removed while it was open, or a forum
        // post's new reply sending it to the last page) turns to the last one.
        if (!posts.length && state.page > 0) {
            state.page = count !== null ? Math.min(state.page, state.pageCount) - 1 : 0;
            return draw();
        }

        const replies = await fetchReplies(posts.map(p => p.id)).catch(() => []);
        const byParent = new Map();
        replies.forEach(r => {
            if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
            byParent.get(r.parent_id).push(r);
        });

        // Before anything is drawn, so a reply's quote can find the post or
        // reply it answers wherever that sits in the list.
        state.postsById.clear();
        state.imagesByPost.clear();
        [...posts, ...replies].forEach(p => state.postsById.set(p.id, p));

        root.innerHTML = '';
        root.appendChild(el('h2', 'section-title discussion-title', state.opts.title));

        const box = isSignedIn() && !isBanned() ? renderComposer(null) : renderSignInPrompt();
        if (!state.opts.composerLast) root.appendChild(box);

        const paged = state.pageCount > 1;
        if (paged) root.appendChild(renderPager('top'));

        const list = el('div', 'discussion-list');
        root.appendChild(list);
        if (!posts.length) list.appendChild(renderEmptyState());
        runsOf(posts).forEach(run => list.appendChild(renderRun(run, byParent)));

        if (paged) root.appendChild(renderPager('bottom'));
        if (state.opts.composerLast) root.appendChild(box);

        // KLIPY clips join the page's clip queue (renderPostMedia).
        if (typeof window.initLazyMedia === 'function') window.initLazyMedia(list);

        // Not awaited: the thread is on screen, and the flairs are decoration.
        decorateFlairs(root);
    }

    async function submitPost(form) {
        const area = form.querySelector('.discussion-textarea');
        const submit = form.querySelector('.discussion-submit');
        if (!area) return;

        const body = area.value.trim();
        const attachments = pendingImages.get(form) || [];
        const gifs = pendingGifs.get(form) || [];
        if (!body && !attachments.length && !gifs.length) { setStatus('Write something first.', true); return; }

        const since = Date.now() - state.lastPostAt;
        if (state.lastPostAt && since < POST_COOLDOWN_MS) {
            setStatus(`Slow down, ${Math.ceil((POST_COOLDOWN_MS - since) / 1000)}s to go.`, true);
            return;
        }

        if (submit) submit.disabled = true;

        // KLIPY page links become their GIFs before anything is uploaded, so a
        // slow lookup never holds uploaded files in limbo.
        let postBody = body;
        let unresolvedGifs = 0;
        if (body.search(KLIPY_PAGE) !== -1) {
            setStatus('Finding the GIF…');
            ({ body: postBody, unresolved: unresolvedGifs } = await resolveKlipyPages(body));
        }

        // Picked GIFs go on the end, one address a line, as if pasted. Checked
        // before any upload, so a refusal here leaves nothing behind.
        if (gifs.length) {
            if (klipyLinks(postBody).length + gifs.length > MAX_GIFS) {
                if (submit) submit.disabled = false;
                setStatus(`Up to ${MAX_GIFS} GIFs a post.`, true);
                return;
            }
            const withGifs = [postBody, ...gifs.map(g => g.url)].filter(Boolean).join('\n');
            if (withGifs.length > MAX_BODY) {
                if (submit) submit.disabled = false;
                setStatus('The post is too long to add the GIFs to. Shorten it a little.', true);
                return;
            }
            postBody = withGifs;
        }

        // Images go up first, into the poster's own folder, and the post names them. If
        // anything after fails, the files are taken down again, so a refused post leaves
        // no orphans.
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

        // author_id and author_name are not sent: a BEFORE INSERT trigger sets both from
        // auth.uid(). `images` only when there are some. A composer another page mounts
        // (the Forum's NEW POST) carries its own insert, with the same limits.
        const custom = typeof form.discussionInsert === 'function' ? form.discussionInsert : null;
        let error;
        if (custom) {
            ({ error } = await custom({ body: postBody, images: paths }));
        } else {
            const row = { page_id: state.pageId, parent_id: parentId, body: postBody };
            if (paths.length) row.images = paths;
            ({ error } = await client().from('page_discussions').insert([row]));
        }

        if (submit) submit.disabled = false;

        if (error) {
            await discardImages(paths);
            // 53400 is the rate limit's own code; the message it carries is
            // already written for a person, so it is shown as-is.
            setStatus(error.message || 'Could not post.', true);
            return;
        }

        state.lastPostAt = Date.now();
        reportShares(gifs);
        if (custom) {
            clearAttachments(form);
            area.value = '';
            return;
        }
        clearAttachments(form);
        area.value = '';
        state.replyingTo = null;
        // A reply stays on this page, beside its post. A new post turns to
        // where it lands: the first page of a newest-first thread, the last
        // of a forum post (draw turns a page past the end to the last).
        if (!parentId) state.page = state.opts.order === 'oldest' ? Number.MAX_SAFE_INTEGER : 0;
        await draw();
        setStatus(unresolvedGifs
            ? 'Posted. A KLIPY link could not be turned into its GIF, so it shows as a link.'
            : '');
    }

    async function removePost(postId) {
        const ok = await window.siteConfirm('Delete your post? The text is removed for good; replies to it stay.',
            { title: 'DELETE POST', confirmText: 'DELETE POST' });
        if (!ok) return;

        // Read before the call: removal empties the column server-side.
        const images = (state.imagesByPost.get(postId) || []).filter(p => IMAGE_PATH.test(p));

        const { error } = await client().rpc('remove_my_discussion_post', { p_post_id: postId });
        if (error) { setStatus(error.message || 'Could not remove that post.', true); return; }

        // An author's removal is final, so the files go with the words. Only your own posts
        // have Delete, and the bucket deletes only from your own folder.
        discardImages(images);

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
        const anchor = formAnchor(target);
        if (anchor) anchor.insertAdjacentElement('afterend', form);
        else target.appendChild(form);

        const input = form.querySelector('.discussion-mod-reason');
        if (input) input.focus();
    }

    async function submitModeration(form) {
        const action = form.dataset.modAction;
        const postId = form.dataset.modPost;
        const input = form.querySelector('.discussion-mod-reason');
        const reason = input ? input.value.trim() : null;

        // Checked here so the message sits beside the field; the RPC refuses an empty
        // reason regardless.
        if (action !== 'restore' && !reason) {
            setStatus('A reason is required. It goes in the moderation log.', true);
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

        await draw();
        // The jump button's count, on a character page (js/pages/core/page_boot.js).
        if (typeof window.showDiscussionCount === 'function') window.showDiscussionCount(state.pageId);
    }

    function openReply(postId) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        const existing = root.querySelector('.discussion-composer[data-parent-id]:not([data-parent-id=""])');
        if (existing) existing.remove();

        const target = document.getElementById(`post-${postId}`);
        if (!target) return;

        // A reply to a reply goes at the end of the same
        // conversation; the database records which reply it answers. A reply
        // to a post in a stack goes at the end of the stack's card, since the
        // replies to all of them are listed there, each quoting its post.
        const onReply = target.classList.contains('discussion-reply');
        const card = onReply ? null : (target.closest('.discussion-post') || target);
        const answered = state.postsById.get(postId);
        let overrides = {};
        if (onReply && answered) {
            overrides = { replyingTo: answered.author_name || 'Unknown' };
        } else if (card && card.classList.contains('discussion-run') && answered) {
            const words = textWithoutGifs(answered.body, klipyLinks(answered.body)).replace(/\s+/g, ' ').trim();
            overrides = { replyingTo: `"${words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : (words || 'a picture')}"` };
        }
        const composer = renderComposer(postId, overrides);
        const replies = onReply ? target.closest('.discussion-replies') : card.querySelector(':scope > .discussion-replies');
        if (replies) replies.appendChild(composer);
        else card.appendChild(composer);

        state.replyingTo = postId;
        const area = composer.querySelector('.discussion-textarea');
        if (area) area.focus();
    }

    // Editing: the words only, under edit_my_discussion_post's rules (the author, a
    // visible post, the posting limits, one edit every 10 seconds). This draws the box.
    function openEdit(postId) {
        const target = document.getElementById(`post-${postId}`);
        const entry = state.postsById.get(postId);
        if (!target || !entry) return;

        document.querySelectorAll('.discussion-edit-form').forEach(closeEdit);

        const body = ownBody(target);
        if (!body) return;

        const form = el('form', 'discussion-edit-form');
        form.dataset.editing = postId;
        const area = document.createElement('textarea');
        area.className = 'discussion-edit-text';
        area.maxLength = MAX_BODY;
        area.rows = 3;
        area.value = entry.body || '';
        area.setAttribute('aria-label', 'Edit your post');
        form.appendChild(area);

        const row = el('div', 'discussion-composer-row');
        const save = el('button', 'btn-sys btn-sys-blue discussion-edit-save', 'SAVE');
        save.type = 'submit';
        const cancel = el('button', 'btn-sys btn-sys-regular discussion-cancel', 'CANCEL');
        cancel.type = 'button';
        cancel.dataset.cancelEdit = 'true';
        row.appendChild(save);
        const emoji = emojiButton();
        if (emoji) row.appendChild(emoji);
        row.appendChild(cancel);
        row.appendChild(el('span', 'discussion-composer-status'));
        form.appendChild(row);

        // Under the post's whole line in a stack, so the box gets the width.
        body.hidden = true;
        (body.closest('.discussion-item-row') || body).insertAdjacentElement('afterend', form);
        area.focus();
    }

    function closeEdit(form) {
        const target = document.getElementById(`post-${form.dataset.editing}`);
        const body = target && ownBody(target);
        if (body) body.hidden = false;
        form.remove();
    }

    async function submitEdit(form) {
        const postId = form.dataset.editing;
        const entry = state.postsById.get(postId);
        const area = form.querySelector('.discussion-edit-text');
        const save = form.querySelector('.discussion-edit-save');
        if (!entry || !area) return;

        const body = area.value.trim();
        const hasImages = Array.isArray(entry.images) && entry.images.length > 0;
        if (!body && !hasImages) { setStatus('Write something first.', true); return; }
        if (body === String(entry.body || '').trim()) { closeEdit(form); return; }

        if (save) save.disabled = true;

        // A KLIPY link typed in becomes its GIF, as when posting.
        let newBody = body;
        let unresolvedGifs = 0;
        if (body.search(KLIPY_PAGE) !== -1) {
            setStatus('Finding the GIF…');
            ({ body: newBody, unresolved: unresolvedGifs } = await resolveKlipyPages(body));
        }

        setStatus('Saving…');
        const { error } = await client().rpc('edit_my_discussion_post', { p_post_id: postId, p_body: newBody });
        if (save) save.disabled = false;
        if (error) { setStatus(error.message || 'Could not save the edit.', true); return; }

        await draw();
        setStatus(unresolvedGifs
            ? 'Saved. A KLIPY link could not be turned into its GIF, so it shows as a link.'
            : '');
    }

    // What a post said before, for a moderator, from page_discussion_edits, which only
    // a moderator can read.
    async function toggleEdits(postId) {
        const target = document.getElementById(`post-${postId}`);
        if (!target) return;
        const open = target.querySelector(':scope > .discussion-edits');
        if (open) { open.remove(); return; }

        const box = el('div', 'discussion-edits');
        box.appendChild(el('p', 'discussion-edits-title', 'Earlier versions (moderators only)'));
        const head = target.querySelector(':scope > .discussion-post-head');
        if (head) head.insertAdjacentElement('afterend', box);
        else target.prepend(box);

        const { data, error } = await client()
            .from('page_discussion_edits')
            .select('body, edited_at, edited_by')
            .eq('post_id', postId)
            .order('edited_at', { ascending: false });
        if (error) { box.appendChild(el('p', 'discussion-edits-empty', 'Could not load the earlier versions.')); return; }
        if (!data || !data.length) { box.appendChild(el('p', 'discussion-edits-empty', 'No earlier versions were kept.')); return; }

        data.forEach(v => {
            const item = el('div', 'discussion-edits-item');
            item.appendChild(el('span', 'discussion-edits-when',
                `Until ${timeAgo(v.edited_at)}${v.edited_by ? '' : ', changed on Discord'}:`));
            const text = el('div', 'discussion-edits-body');
            setTextWithBreaks(text, v.body);
            item.appendChild(text);
            box.appendChild(item);
        });
    }

    // One marker at a time, on the post itself: a single post's card, or its
    // own line inside a stack.
    function jumpTo(postId) {
        const target = document.getElementById(`post-${postId}`);
        if (!target) return;
        document.querySelectorAll('.discussion-post-linked')
            .forEach(node => node.classList.remove('discussion-post-linked'));
        target.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
        target.classList.add('discussion-post-linked');
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

            const gifToggle = e.target.closest('[data-gif-toggle]');
            if (gifToggle) {
                const form = gifToggle.closest('.discussion-composer');
                if (form) toggleGifPicker(form, gifToggle);
                return;
            }

            const dropGif = e.target.closest('[data-remove-gif]');
            if (dropGif) {
                const form = dropGif.closest('.discussion-composer');
                const list = (form && pendingGifs.get(form)) || [];
                list.splice(Number(dropGif.dataset.removeGif), 1);
                renderAttachments(form);
                return;
            }

            const emojiToggle = e.target.closest('[data-emoji-toggle]');
            if (emojiToggle) {
                const form = emojiToggle.closest('form');
                const area = form && form.querySelector('textarea');
                if (area) window.DslEmoji.togglePicker(form, area, emojiToggle);
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

            const edit = e.target.closest('[data-edit-post]');
            if (edit) { openEdit(edit.dataset.editPost); return; }

            const cancelEdit = e.target.closest('[data-cancel-edit]');
            if (cancelEdit) {
                const form = cancelEdit.closest('.discussion-edit-form');
                if (form) closeEdit(form);
                return;
            }

            const edits = e.target.closest('[data-show-edits]');
            if (edits) { await toggleEdits(edits.dataset.showEdits); return; }

            const jump = e.target.closest('[data-jump-to]');
            if (jump) { jumpTo(jump.dataset.jumpTo); return; }

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

            const pageGo = e.target.closest('[data-page-go]');
            if (pageGo) {
                state.page = Math.max(0, Number(pageGo.dataset.pageGo) || 0);
                await draw();
                const list = root.querySelector('.discussion-list');
                if (list) list.scrollIntoView({ behavior: window.scrollMotion(), block: 'start' });
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

            const editForm = e.target.closest('.discussion-edit-form');
            if (editForm) { e.preventDefault(); await submitEdit(editForm); return; }

            const form = e.target.closest('.discussion-composer');
            if (!form) return;
            e.preventDefault();
            await submitPost(form);
        });
    }

    // A notification links to characters/X/index.html#post-<id>, and the
    // browser resolves that fragment long before this section exists. Scrolls
    // to it once it does, so a reply notification lands on the reply. Its
    // page was worked out before the first draw (initPageDiscussions).
    function hashPostId() {
        const match = /^#post-([A-Za-z0-9-]{1,64})$/.exec(window.location.hash || '');
        return match ? match[1] : null;
    }

    function honourHashTarget() {
        const id = hashPostId();
        if (id) jumpTo(id);
    }

    /**
     * A composer outside a thread (the Forum's NEW POST). `leading` adds the caller's
     * fields; `insert({ body, images })` receives the prepared message and returns
     * { error }. Images, paste, KLIPY links and the limits work as in a thread.
     * Returns the form, or null when the reader cannot post (a prompt is drawn).
     * @since v1.0
     */
    window.mountDiscussionComposer = async function (container, { placeholder, submitLabel, leading = [], insert } = {}) {
        if (!container || !client()) return null;
        await Promise.all([loadViewer(), loadRulesLink()]);
        wire(container);
        if (!isSignedIn() || isBanned()) {
            container.appendChild(renderSignInPrompt());
            return null;
        }
        const form = renderComposer(null, { placeholder, submitLabel });
        [...leading].reverse().forEach(node => form.insertBefore(node, form.firstChild));
        form.discussionInsert = insert;
        container.appendChild(form);
        return form;
    };

    /** Who is reading, for a page that draws its own controls around a thread; every action is refused server-side. */
    window.discussionViewer = function () {
        return {
            signedIn: isSignedIn(),
            banned: isBanned(),
            canModerate: state.canModerate,
            userId: state.session ? state.session.user.id : null,
        };
    };

    window.initPageDiscussions = async function (pageId, opts = {}) {
        const root = document.getElementById('discussion-section');

        if (!root || !client() || !pageId) return;

        state.pageId = pageId;
        state.opts = { ...DEFAULT_OPTS, ...opts };
        state.page = 0;

        // A notification's link may point at a post on a later page, so the
        // first draw opens that page rather than the first.
        const linked = hashPostId();
        const [, , linkedPage] = await Promise.all([loadViewer(), loadRulesLink(), linked ? pageOf(linked) : 0]);
        state.page = linkedPage;
        wire(root);
        await draw();
        setTimeout(honourHashTarget, 300);
    };
})();
