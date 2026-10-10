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
    // v1.0 Part 3 (owner, 2026-10-10): a thread reads like a Discord channel.
    // Every message in time order, newest at the bottom of a box that opens
    // there, and 100 messages a page, counting replies, so a long thread loads
    // one page at a time.
    const PAGE_SIZE = 100;
    // Messages from one person this close together share one name line, the
    // window Discord itself uses. People there send several short messages in
    // a row because the name is not repeated on every one.
    const GROUP_WINDOW_MS = 7 * 60 * 1000;
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

    // A picture copied off Discord by the relay (v1.0 batch 1): its own
    // bucket, named after the message. Same rule as the shape trigger's and
    // supabase/functions/_shared/discord-relay-core.mjs's COPIED_IMAGE_PATH.
    const DISCORD_IMAGE_PATH = /^discord\/[0-9]{5,20}-[0-3]\.(png|jpg|webp|gif)$/;
    const DISCORD_BUCKET = 'discord-media';

    // KLIPY's media servers, read off klipy.com on 2026-09-28: every GIF, WebP
    // and MP4 on its home page was served from these two hosts, under /ii/.
    // Exact hosts and path, so a post can never point a reader's browser
    // anywhere else.
    const KLIPY_MEDIA = /https:\/\/static2?\.klipy\.com\/ii\/[A-Za-z0-9/_-]+\.(gif|webp|mp4)(?![\w./-])/g;
    const KLIPY_MEDIA_EXACT = new RegExp(`^${KLIPY_MEDIA.source}$`);
    const MAX_GIFS = 4;

    // A KLIPY PAGE link, klipy.com/gifs/<slug>, which is what Discord's GIF
    // picker copies (owner, 2026-10-01). The page itself answers only crawlers,
    // so the GIF is found through KLIPY's API instead, ONCE, when the post is
    // made: the page link in the text is swapped for the GIF's own address
    // before it is saved. Readers never call KLIPY, so a thread of forty GIFs
    // costs no lookups at all.
    //
    // The key is the owner's, and a browser calls the API, so it is visible to
    // anyone reading the site's traffic: the owner's choice, made 2026-10-02,
    // the same standing as the Supabase anon key. A test key allows 100
    // lookups an hour.
    const KLIPY_PAGE = /https?:\/\/(?:www\.)?klipy\.com\/gifs\/([A-Za-z0-9-]{1,120})[^\s]*/g;
    const KLIPY_API = 'https://api.klipy.com/api/v1/xdjct5ccuBWrbiAxgyaEgQdKcnFW5LIpjd1glWvPLALxPE6bNDPGsXXJaMPg9Xv7/gifs/';
    // MP4 first: on 2026-10-02 one GIF's HD .gif was 22.6 MB and its MP4
    // 0.58 MB, and MP4 plays everywhere, iPhones included. Then smaller sizes,
    // then the still-heavier formats.
    const KLIPY_PICK = [['md', 'mp4'], ['hd', 'mp4'], ['sm', 'mp4'], ['md', 'webp'], ['sm', 'webp'], ['md', 'gif']];

    const state = {
        pageId: null,
        // 0 is the newest page; higher numbers go back in time.
        page: 0,
        pageCount: 1,
        // Whether the box should stay at its newest message while pictures
        // and GIFs load and grow it. Cleared as soon as the reader scrolls up.
        stickToBottom: true,
        session: null,
        role: undefined,   // undefined = not looked up, null = signed in with no role
        canModerate: false,
        canUploadMedia: false,
        lastPostAt: 0,
        // The message the main box is replying to, or null.
        replyingTo: null,
        // post id -> its image paths, as drawn. Removing your own post empties
        // the column server-side, so the paths to delete are read from here.
        imagesByPost: new Map(),
        // post id -> the row, as drawn (batch 3): a reply's quote reads the
        // message it answers from here, and the edit box starts from the words.
        // Also holds the messages replies on this page answer from older pages.
        postsById: new Map(),
        // The thread's title and the box's placeholder. A character page and a
        // forum post read the same way since Part 3; only the words differ.
        opts: null,
        // The Rules page's address, or null while it does not exist (batch 4).
        rulesUrl: null,
    };

    const DEFAULT_OPTS = {
        title: 'Discussion',
        placeholder: 'Start a discussion about this character…',
    };
    state.opts = { ...DEFAULT_OPTS };

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

        // A message copied in from the Discord forum (v1.0 batch 1). There is
        // no wiki account to open, so the name is plain text, followed by
        // where it came from and the person's Discord handle. Every part is
        // set as text: all of it was typed by somebody on Discord.
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

    // The GIF a KLIPY page link points at, as an address the renderer will
    // draw, or null. KLIPY's answer is checked against KLIPY_MEDIA exactly like
    // a pasted link: a third party's response gets no more trust than a post.
    // No referrer, so KLIPY is not told which page the poster was on.
    async function klipyMediaFor(slug) {
        try {
            const res = await fetch(KLIPY_API + encodeURIComponent(slug),
                { referrerPolicy: 'no-referrer', credentials: 'omit' });
            if (!res.ok) return null;
            const json = await res.json();
            const files = json && json.data && json.data.file;
            if (!files) return null;
            for (const [size, format] of KLIPY_PICK) {
                const url = files[size] && files[size][format] && files[size][format].url;
                if (typeof url === 'string' && KLIPY_MEDIA_EXACT.test(url)) return url;
            }
        } catch (e) { /* the link stays a link */ }
        return null;
    }

    // Swaps each KLIPY page link in a post for its GIF, the first MAX_GIFS of
    // them, one lookup at a time. A link that cannot be resolved stays as it
    // is, and the post still goes up: a GIF is never worth losing what was
    // written around it.
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

    // What a post carries besides words: its uploaded images, then its KLIPY
    // GIFs. Every node is built with createElement and every address is set as
    // a property, never interpolated, and each one has passed an exact pattern
    // above: this renders unreviewed input on every character page.
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
                // KLIPY's MP4 of a GIF is a fraction of the GIF's bytes. Muted,
                // looping and inline: it plays the part of a GIF, nothing more.
                node = document.createElement('video');
                node.muted = true;
                node.loop = true;
                node.autoplay = true;
                node.playsInline = true;
                node.setAttribute('playsinline', '');
                node.setAttribute('aria-label', 'GIF from KLIPY');
                // Into the clip queue, not straight to its source (owner,
                // 2026-10-02: a thread full of GIFs must not load them all at
                // once). draw() hands the list to initLazyMedia: two at a
                // time, nearest first, paused off screen. A <video> has no
                // referrerPolicy; the browser's default sends KLIPY the site's
                // origin and never the page.
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

    // --- THE RULES PAGE (v1.0 batch 4, D1) ---
    //
    // A CMS page the owner made, "Forum Rules", so its id is `forum_rules`. Its
    // address is read from navigation.json, which lists live pages only: until
    // the page is live there is no link, rather than a link to nothing.
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

    // Oldest first, ties broken by id: the order the box shows them in.
    function chronological(a, b) {
        return String(a.created_at).localeCompare(String(b.created_at))
            || String(a.id).localeCompare(String(b.id));
    }

    // One page of the thread: posts and replies together, since Part 3 shows
    // them as one timeline. Fetched newest first so page 0 is the newest 100,
    // then put back in time order here, so the order never depends on how the
    // response arrived.
    //
    // Ordered by created_at AND id. range() needs a total order to paginate
    // correctly, and two messages sharing a timestamp would otherwise be able
    // to swap places between pages - showing one twice and hiding the other.
    //
    // The count rides on the same request. It is counted under the reader's
    // own RLS, so a moderator's pages include hidden messages and everyone
    // else's do not, and both page through what they can actually see.
    async function fetchPage(page) {
        const { data, error, count } = await client()
            .from('page_discussions')
            .select('*', { count: 'exact' })
            .eq('page_id', state.pageId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (error) throw error;
        const rows = (data || []).slice().sort(chronological);
        return { rows, count: typeof count === 'number' ? count : null };
    }

    // The messages that replies on this page answer, when they sit on an older
    // page, so each reply's quote can still show who and what it answers. One
    // request for the whole page, and a failure only costs the quotes.
    async function fetchAnswered(rows) {
        const missing = [...new Set(rows
            .map(r => r.reply_to || r.parent_id)
            .filter(id => id && !state.postsById.has(id)))];
        if (!missing.length) return [];
        try {
            const { data, error } = await client()
                .from('page_discussions')
                .select('*')
                .in('id', missing);
            if (error) return [];
            return (data || []).filter(r => missing.includes(r.id));
        } catch (e) {
            return [];
        }
    }

    // Which page a message is on: how many messages are newer than it,
    // counted in the same order fetchPage pages in. For a notification's
    // #post- link, and for a reply quote whose message is on another page.
    // Page 0 whenever it cannot be worked out, which is where it most likely
    // is anyway.
    async function pageOf(postId) {
        try {
            const { data: target } = await client()
                .from('page_discussions')
                .select('id, created_at')
                .eq('id', postId)
                .maybeSingle();
            if (!target) return 0;
            const at = `"${target.created_at}"`;
            const { count, error } = await client()
                .from('page_discussions')
                .select('id', { count: 'exact', head: true })
                .eq('page_id', state.pageId)
                .or(`created_at.gt.${at},and(created_at.eq.${at},id.gt.${target.id})`);
            if (error || typeof count !== 'number') return 0;
            return Math.floor(count / PAGE_SIZE);
        } catch (e) {
            return 0;
        }
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

    // Who said it, which decides whether a message joins the name line above
    // it. A Discord message is its Discord account, a wiki one its wiki
    // account, and a deleted account its name.
    function authorKey(entry) {
        if (entry.source === 'discord') return `d:${entry.discord_author_id || entry.author_name}`;
        return entry.author_id ? `w:${entry.author_id}` : `n:${entry.author_name}`;
    }

    // Whether a message goes under the previous one's name line (Part 3).
    // Same person, within GROUP_WINDOW_MS, and neither is a reply or out of
    // the ordinary: a reply carries its own quote and name, as on Discord, and
    // a removed or hidden message always gets a line of its own. A removed
    // message's author is deliberately not named, and grouping it under
    // somebody's name would name them.
    function joinsPrevious(entry, prev) {
        if (!prev) return false;
        if (entry.parent_id) return false;
        if (entry.status !== 'visible' || prev.status !== 'visible') return false;
        if (authorKey(entry) !== authorKey(prev)) return false;
        const gap = new Date(entry.created_at).getTime() - new Date(prev.created_at).getTime();
        return gap >= 0 && gap <= GROUP_WINDOW_MS;
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

    // Who and when. A message under someone's name line gets no name of its
    // own, only its time, which shows beside it on hover.
    function postHead(entry, grouped) {
        if (grouped) {
            const head = el('div', 'discussion-post-head discussion-post-head-grouped');
            head.appendChild(el('span', 'discussion-time', timeAgo(entry.created_at)));
            return head;
        }
        const head = el('div', 'discussion-post-head');
        head.appendChild(authorNode(entry));
        head.appendChild(el('span', 'discussion-time', timeAgo(entry.created_at)));
        return head;
    }

    // Whether it changed since: edited by its author on the wiki (batch 3), or
    // on Discord. At the end of the words, as Discord marks it. A moderator's
    // mark is a button that opens what it said before; everyone else only
    // learns that it changed.
    function editedMark(entry) {
        const shown = entry.status === 'visible' || (entry.status === 'hidden' && state.canModerate);
        if (!shown || !entry.edited_at) return null;
        const label = entry.source === 'discord' ? 'edited on Discord' : 'edited';
        if (state.canModerate) {
            const btn = el('button', 'discussion-edited discussion-edited-open', label);
            btn.type = 'button';
            btn.title = 'Show what this said before (moderators only)';
            btn.dataset.showEdits = entry.id;
            return btn;
        }
        return el('span', 'discussion-edited', label);
    }

    // Which message a reply answers (batch 3; every reply since Part 3, now
    // that replies sit in the timeline rather than under their post). A
    // button, because it jumps to that message, wherever it is. Every part is
    // text.
    function replyQuote(reply) {
        const answeredId = reply.reply_to || reply.parent_id;
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
        } else if (answered) {
            quote.textContent = '↪ a removed message';
        } else {
            // Not found at all: hidden from this reader, or the lookup failed.
            // Not "removed", which would claim something nobody checked.
            quote.textContent = '↪ an earlier message';
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
            // data- attribute plus a delegated listener, never an inline
            // onclick: post ids and author names are user-influenced and an
            // onclick would put them in an executable position.
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

    // One message in the timeline (Part 3). Posts and replies are drawn the
    // same way; a reply only adds its quote line on top, as on Discord.
    // `grouped` puts it under the previous message's name line.
    function renderMessage(entry, grouped) {
        const removed = entry.status !== 'visible';
        const isReply = !!entry.parent_id;

        const cls = ['discussion-post'];
        if (grouped) cls.push('discussion-post-grouped');
        if (isReply) cls.push('discussion-post-reply');
        if (removed) cls.push('discussion-post-removed');
        const wrap = el('article', cls.join(' '));
        wrap.id = `post-${entry.id}`;

        // Above the name line, as Discord places it. A removed reply drops it,
        // like its words.
        const quote = isReply && (!removed || entry.status === 'hidden') ? replyQuote(entry) : null;
        if (quote) wrap.appendChild(quote);

        if (!grouped) wrap.appendChild(avatarNode(entry));
        wrap.appendChild(postHead(entry, grouped));

        const body = el('div', 'discussion-body');
        if (entry.status === 'hidden') {
            // Only a moderator can see this at all - the SELECT policy filters
            // the row out for everyone else - so the body is shown intact
            // under a marker rather than replaced by a placeholder.
            //
            // Appended, not insertBefore(badge, body): body is not a child of
            // wrap yet at this point, and insertBefore against a non-child
            // throws - taking the whole thread render down with it.
            wrap.appendChild(el('span', 'discussion-hidden-badge', 'HIDDEN FROM READERS'));
            setTextWithBreaks(body, textWithoutGifs(entry.body, klipyLinks(entry.body)));
        } else if (removed) {
            body.classList.add('discussion-body-removed');
            body.textContent = removedText(entry.status);
        } else {
            setTextWithBreaks(body, textWithoutGifs(entry.body, klipyLinks(entry.body)));
        }
        wrap.appendChild(body);
        // Beside the words rather than in them, so the words stay exactly
        // what was written; the stylesheet runs the two on together.
        const mark = editedMark(entry);
        if (mark) wrap.appendChild(mark);
        appendMedia(wrap, entry);

        const actions = el('div', 'discussion-post-actions');
        appendOwnActions(actions, entry);
        appendReportControl(actions, entry);
        appendModerationControls(actions, entry);

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

    // The one box a thread has, under the messages (Part 3). Replying no
    // longer opens a second box under the message: it puts a "Replying to"
    // bar on this one, as Discord does, and the message goes to the bottom of
    // the timeline with its quote. `thread` is false for a box mounted outside
    // a thread (the forum's NEW POST), which can never be replying.
    function renderComposer(overrides = {}, thread = true) {
        const form = el('form', 'discussion-composer');
        form.dataset.parentId = '';

        if (thread) {
            form.dataset.threadComposer = 'true';
            // The name is set as text, like every name on the page.
            const bar = el('div', 'discussion-reply-bar');
            bar.hidden = true;
            bar.appendChild(el('span', 'discussion-composer-heading'));
            const cancel = el('button', 'discussion-reply-cancel', '✕');
            cancel.type = 'button';
            cancel.dataset.cancelReply = 'true';
            cancel.setAttribute('aria-label', 'Stop replying');
            bar.appendChild(cancel);
            form.appendChild(bar);
        }

        const area = document.createElement('textarea');
        area.className = 'discussion-textarea';
        area.maxLength = MAX_BODY;
        area.rows = 2;
        area.placeholder = overrides.placeholder || state.opts.placeholder;
        area.setAttribute('aria-label', 'New message');
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

        const submit = el('button', 'btn-sys btn-sys-blue discussion-submit', overrides.submitLabel || 'POST');
        submit.type = 'submit';
        row.appendChild(submit);

        if (state.canUploadMedia) {
            const attach = el('button', 'btn-sys btn-sys-regular discussion-attach', 'IMAGE');
            attach.type = 'button';
            attach.dataset.attachImage = 'true';
            attach.title = `Attach up to ${MAX_IMAGES} images. You can also paste one into the box.`;
            row.appendChild(attach);
        }

        row.appendChild(el('span', 'discussion-composer-status'));

        // A new tab, so a half-written message is not lost.
        if (state.rulesUrl) {
            const rules = el('a', 'discussion-rules-link', 'Rules');
            rules.href = state.rulesUrl;
            rules.target = '_blank';
            rules.rel = 'noopener';
            row.appendChild(rules);
        }
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
        document.querySelectorAll('.discussion-composer-status').forEach(node => {
            node.textContent = text || '';
            node.classList.toggle('discussion-status-error', !!isError);
        });
    }

    // --- THE MAIN DRAW ---

    // The parts of a thread that outlive a redraw (Part 3): the title, the
    // scroll box and the message box under it. Built once, so turning a page
    // or moderating a message never throws away what somebody was typing.
    function ensureFrame(root) {
        const existing = root.querySelector(':scope > .discussion-scroll');
        if (existing) return existing;

        root.innerHTML = '';
        root.appendChild(el('h2', 'section-title discussion-title', state.opts.title));

        const scroller = el('div', 'discussion-scroll');
        // A log: new messages arrive at the end. Focusable, so a keyboard can
        // scroll it.
        scroller.setAttribute('role', 'log');
        scroller.setAttribute('aria-label', `${state.opts.title}: messages`);
        scroller.tabIndex = 0;
        const inner = el('div', 'discussion-scroll-inner');
        scroller.appendChild(inner);
        root.appendChild(scroller);

        root.appendChild(isSignedIn() && !isBanned() ? renderComposer() : renderSignInPrompt());

        // Within 40px of the end counts as reading the newest message.
        scroller.addEventListener('scroll', () => {
            state.stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
        });
        // Pictures and GIFs load after the box has opened at its end and push
        // the end further down. Follow it while the reader is still there.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => {
                if (state.stickToBottom) scroller.scrollTop = scroller.scrollHeight;
            }).observe(inner);
        }
        return scroller;
    }

    // Older and newer pages, at the top and the bottom of the box. Page 1 is
    // the newest, the one a thread opens on.
    function renderPager(direction) {
        const bar = el('div', `discussion-pager discussion-pager-${direction}`);
        const go = (label, page) => {
            const btn = el('button', 'btn-sys btn-sys-regular discussion-page-btn', label);
            btn.type = 'button';
            btn.dataset.pageGo = String(page);
            bar.appendChild(btn);
        };
        if (direction === 'older') {
            go('OLDER MESSAGES', state.page + 1);
        } else {
            go('NEWER MESSAGES', state.page - 1);
            if (state.page > 1) go('JUMP TO PRESENT', 0);
        }
        bar.appendChild(el('span', 'discussion-page-label', `Page ${state.page + 1} of ${state.pageCount}`));
        return bar;
    }

    // `position` is where the box should be afterwards: at its newest message
    // ('bottom'), its oldest ('top'), or where the reader left it ('keep').
    async function draw({ position = 'bottom' } = {}) {
        const root = document.getElementById('discussion-section');
        if (!root) return;

        let rows;
        let count;
        try {
            ({ rows, count } = await fetchPage(state.page));
        } catch (e) {
            // The normal state between pushing this branch and merging it -
            // migrations apply on merge, so the table genuinely does not exist
            // yet. Says so plainly rather than rendering a broken section.
            root.innerHTML = '';
            root.appendChild(el('h2', 'section-title discussion-title', state.opts.title));
            const msg = (e && (e.code === 'PGRST205' || e.code === '42P01'))
                ? 'Discussions are not available on this page yet.'
                : 'Could not load the discussion. Try refreshing.';
            root.appendChild(el('p', 'discussion-error', msg));
            return;
        }

        // A page that has emptied since (messages removed while it was open)
        // falls back to the newest one rather than showing nothing.
        if (!rows.length && state.page > 0) {
            state.page = 0;
            return draw({ position: 'bottom' });
        }

        state.pageCount = count !== null
            ? Math.max(1, Math.ceil(count / PAGE_SIZE))
            : (rows.length === PAGE_SIZE ? state.page + 2 : state.page + 1);

        // Before anything is drawn, so a reply's quote can find the message it
        // answers, on this page or an older one.
        state.postsById.clear();
        state.imagesByPost.clear();
        rows.forEach(r => state.postsById.set(r.id, r));
        (await fetchAnswered(rows)).forEach(r => {
            if (!state.postsById.has(r.id)) state.postsById.set(r.id, r);
        });

        const scroller = ensureFrame(root);
        const inner = scroller.querySelector('.discussion-scroll-inner');
        const keptTop = scroller.scrollTop;
        const wasAtBottom = state.stickToBottom;

        inner.innerHTML = '';
        if (state.page < state.pageCount - 1) inner.appendChild(renderPager('older'));

        const list = el('div', 'discussion-list');
        if (!rows.length) list.appendChild(renderEmptyState());
        let prev = null;
        rows.forEach(row => {
            list.appendChild(renderMessage(row, joinsPrevious(row, prev)));
            prev = row;
        });
        inner.appendChild(list);

        if (state.page > 0) inner.appendChild(renderPager('newer'));

        // KLIPY clips join the page's clip queue (renderPostMedia).
        if (typeof window.initLazyMedia === 'function') window.initLazyMedia(list);

        // Not awaited: the thread is already on screen and the flairs arrive
        // when they arrive. Awaiting here would hold the render open on a
        // request that is decoration, and before the release this RPC does not
        // exist in production at all.
        decorateFlairs(root);

        if (position === 'top') {
            state.stickToBottom = false;
            scroller.scrollTop = 0;
        } else if (position === 'keep' && !wasAtBottom) {
            state.stickToBottom = false;
            scroller.scrollTop = keptTop;
        } else {
            state.stickToBottom = true;
            scroller.scrollTop = scroller.scrollHeight;
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

        // KLIPY page links become their GIFs before anything is uploaded, so a
        // slow lookup never holds uploaded files in limbo.
        let postBody = body;
        let unresolvedGifs = 0;
        if (body.search(KLIPY_PAGE) !== -1) {
            setStatus('Finding the GIF…');
            ({ body: postBody, unresolved: unresolvedGifs } = await resolveKlipyPages(body));
        }

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
        // A composer mounted by another page (the forum's NEW POST) carries its
        // own insert; the images, KLIPY links and the limits above are the same.
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
        if (custom) {
            clearAttachments(form);
            area.value = '';
            return;
        }
        clearAttachments(form);
        area.value = '';
        cancelReply(form);
        // A new message is the newest one, so the box goes to it, from
        // whichever page the reader was on.
        state.page = 0;
        await draw({ position: 'bottom' });
        setStatus(unresolvedGifs
            ? 'Posted. A KLIPY link could not be turned into its GIF, so it shows as a link.'
            : '');
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

        await draw({ position: 'keep' });
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

        await draw({ position: 'keep' });
        updateJumpCount();
    }

    // Reply puts a "Replying to" bar on the thread's one box (Part 3). The
    // message goes in with parent_id set to whatever is being answered, post
    // or reply: the shape trigger files a reply to a reply under its post and
    // records which reply it answers (reply_to), so the client never has to.
    function openReply(postId) {
        const root = document.getElementById('discussion-section');
        const form = root && root.querySelector('.discussion-composer[data-thread-composer]');
        if (!form) return;

        const answered = state.postsById.get(postId);
        form.dataset.parentId = postId;
        state.replyingTo = postId;

        const bar = form.querySelector('.discussion-reply-bar');
        if (bar) {
            bar.querySelector('.discussion-composer-heading').textContent =
                `Replying to ${answered ? (answered.author_name || 'Unknown') : 'a message'}`;
            bar.hidden = false;
        }
        const area = form.querySelector('.discussion-textarea');
        if (area) area.focus();
    }

    function cancelReply(form) {
        if (!form || !form.dataset.threadComposer) return;
        form.dataset.parentId = '';
        state.replyingTo = null;
        const bar = form.querySelector('.discussion-reply-bar');
        if (bar) bar.hidden = true;
    }

    // --- EDITING (batch 3) ---
    //
    // The words only (owner, 2026-10-04). The rules are edit_my_discussion_post's:
    // the author, a visible post, the same limits as posting, one edit every
    // 10 seconds. This only draws the box.
    function openEdit(postId) {
        const target = document.getElementById(`post-${postId}`);
        const entry = state.postsById.get(postId);
        if (!target || !entry) return;

        document.querySelectorAll('.discussion-edit-form').forEach(closeEdit);

        const body = target.querySelector(':scope > .discussion-body');
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
        row.appendChild(cancel);
        row.appendChild(el('span', 'discussion-composer-status'));
        form.appendChild(row);

        body.hidden = true;
        // The "(edited)" beside the words goes with them while the box is open.
        const mark = target.querySelector(':scope > .discussion-edited');
        if (mark) mark.hidden = true;
        body.insertAdjacentElement('afterend', form);
        area.focus();
    }

    function closeEdit(form) {
        const body = form.previousElementSibling;
        if (body && body.classList.contains('discussion-body')) body.hidden = false;
        const article = form.closest('.discussion-post');
        const mark = article && article.querySelector(':scope > .discussion-edited');
        if (mark) mark.hidden = false;
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

        await draw({ position: 'keep' });
        setStatus(unresolvedGifs
            ? 'Saved. A KLIPY link could not be turned into its GIF, so it shows as a link.'
            : '');
    }

    // What a post said before, for a moderator (batch 3). Read straight from
    // page_discussion_edits, which only a moderator can read at all.
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

    // Puts a message in the middle of the box under the marker, turning to its
    // page first when it is on another one (a reply quoting a message from an
    // older page, or a notification's link).
    function markAndScroll(target) {
        state.stickToBottom = false;
        document.querySelectorAll('.discussion-post-linked')
            .forEach(node => node.classList.remove('discussion-post-linked'));
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('discussion-post-linked');
    }

    async function jumpTo(postId) {
        let target = document.getElementById(`post-${postId}`);
        if (!target) {
            const page = await pageOf(postId);
            if (page !== state.page) {
                state.page = page;
                await draw({ position: 'keep' });
            }
            target = document.getElementById(`post-${postId}`);
        }
        if (target) markAndScroll(target);
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
                cancelReply(cancel.closest('.discussion-composer'));
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

            // Older pages open at their newest message, so the conversation
            // carries on from where the newer page began; newer pages open at
            // their oldest, for the same reason. The present opens at the end.
            const pageBtn = e.target.closest('[data-page-go]');
            if (pageBtn) {
                const to = Math.max(0, Number(pageBtn.dataset.pageGo) || 0);
                const older = to > state.page;
                state.page = to;
                await draw({ position: older || to === 0 ? 'bottom' : 'top' });
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
        const target = id && document.getElementById(`post-${id}`);
        if (target) markAndScroll(target);
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

    // A composer outside a thread: the forum's NEW POST (v1.0 batch 2). The
    // caller adds its own fields with `leading` and receives the prepared
    // message in `insert({ body, images })`, which returns { error }. Images,
    // paste, KLIPY links and the limits work as in a thread. Returns the form,
    // or null when the reader cannot post (a prompt is drawn instead).
    window.mountDiscussionComposer = async function (container, { placeholder, submitLabel, leading = [], insert } = {}) {
        if (!container || !client()) return null;
        await Promise.all([loadViewer(), loadRulesLink()]);
        wire(container);
        if (!isSignedIn() || isBanned()) {
            container.appendChild(renderSignInPrompt());
            return null;
        }
        const form = renderComposer({ placeholder, submitLabel }, false);
        [...leading].reverse().forEach(node => form.insertBefore(node, form.firstChild));
        form.discussionInsert = insert;
        container.appendChild(form);
        return form;
    };

    // Who is reading, for a page that draws its own controls around a thread.
    // Only decides what to draw; every action is refused server-side.
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

        // The button is wired even when the section is missing, so a page that
        // somehow has one without the other still behaves predictably.
        wireJumpButton();

        if (!root || !client() || !pageId) return;

        state.pageId = pageId;
        state.opts = { ...DEFAULT_OPTS, ...opts };
        state.page = 0;
        state.stickToBottom = true;
        state.replyingTo = null;
        // A fresh frame for this thread's title and box.
        root.innerHTML = '';

        await Promise.all([loadViewer(), loadRulesLink()]);
        wire(root);
        const linked = hashPostId();
        if (linked) state.page = await pageOf(linked);
        await draw({ position: 'bottom' });
        updateJumpCount();
        setTimeout(honourHashTarget, 300);
    };
})();
