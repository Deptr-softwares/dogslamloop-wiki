/**
 * Dogslamloop Wiki - Gallery pages (page_type 'gallery')
 *
 * A deliberately simpler thing than a system page. A system page is tabs of
 * authored blocks; a gallery is one flat, searchable list of media items. The
 * first is Emotes, where the content is ~100 short clips and the only
 * navigation anyone wants is "type the name".
 *
 * Data shape, stored in page_data.desc_data:
 *
 *   {
 *     intro: [ ...blocks ],          // optional, rendered by description.js
 *     items: [
 *       { name, src, alt, tags: [], note }
 *     ]
 *   }
 *
 * `items` is flat on purpose. Tabs would mean deciding categories up front for
 * something people search rather than browse, and a category that holds three
 * emotes is worse than no category.
 *
 * Everything here assumes "massive amount of gif/video" as the normal case:
 * media is lazy, filtering is done against a prebuilt index rather than the
 * DOM, and the grid is rebuilt from a document fragment rather than by
 * innerHTML concatenation.
 */

// Kept module-level so filtering never re-reads the network or re-parses the
// payload - the search box fires on every keystroke.
let galleryItems = [];
let galleryPageId = null;

function galleryEsc(str) {
    return window.escapeHtml(str);
}

// Matches the detection js/framedata.js uses: read the extension off the path,
// not the whole URL, so a query string or fragment does not make a video look
// like an image.
function isVideoSrc(src) {
    const path = String(src || '').split(/[?#]/)[0].toLowerCase();
    return ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].some(ext => path.endsWith(ext));
}

// One searchable string per item, built once. Searching re-reads this rather
// than touching the DOM, which is what keeps typing responsive at a few
// hundred items.
function indexItems(items) {
    return items.map(item => ({
        ...item,
        _haystack: [item.name, item.note, ...(item.tags || [])]
            .filter(Boolean).join(' ').toLowerCase(),
    }));
}

function buildGalleryCard(item) {
    const card = document.createElement('figure');
    card.className = 'gallery-card';

    const media = document.createElement('div');
    media.className = 'gallery-card-media';

    if (item.src) {
        if (isVideoSrc(item.src)) {
            const video = document.createElement('video');
            // data-lazy-src, not src: initLazyMedia (js/description.js) swaps
            // it in on approach. A gallery is the one page where loading every
            // clip at once genuinely matters.
            video.setAttribute('data-lazy-src', item.src);
            video.className = 'gallery-media';
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'none';
            // <video> has no alt attribute - the same trap that made skill-card
            // alt text look like it was not saving.
            if (item.alt || item.name) video.setAttribute('aria-label', item.alt || item.name);
            media.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = item.src;
            img.className = 'gallery-media';
            img.loading = 'lazy';
            img.alt = item.alt || item.name || '';
            media.appendChild(img);
        }
    } else {
        media.innerHTML = `<div class="gallery-media-missing">[ No media ]</div>`;
    }

    card.appendChild(media);

    const caption = document.createElement('figcaption');
    caption.className = 'gallery-card-caption';

    const title = document.createElement('span');
    title.className = 'gallery-card-name';
    // textContent throughout: item names are contributor-submitted.
    title.textContent = item.name || 'Untitled';
    caption.appendChild(title);

    if (item.note) {
        const note = document.createElement('span');
        note.className = 'gallery-card-note';
        note.textContent = item.note;
        caption.appendChild(note);
    }

    card.appendChild(caption);
    return card;
}

function renderGrid(items) {
    const grid = document.getElementById('gallery-grid');
    const count = document.getElementById('gallery-count');
    if (!grid) return;

    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = `<p class="empty-tab-msg">Nothing matches that search.</p>`;
        if (count) count.textContent = '';
        return;
    }

    // One fragment, one reflow - the difference is visible at a few hundred
    // cards.
    const fragment = document.createDocumentFragment();
    items.forEach(item => fragment.appendChild(buildGalleryCard(item)));
    grid.appendChild(fragment);

    if (count) {
        count.textContent = items.length === galleryItems.length
            ? `${items.length} total`
            : `${items.length} of ${galleryItems.length}`;
    }

    // Re-armed after every render: the observer only tracks the elements that
    // existed when it was set up, and filtering replaces all of them.
    if (typeof window.initLazyMedia === 'function') window.initLazyMedia(grid);
}

function applyGalleryFilter(query) {
    const q = String(query || '').trim().toLowerCase();
    renderGrid(q ? galleryItems.filter(item => item._haystack.includes(q)) : galleryItems);
}

window.renderGalleryPage = async function(pageId) {
    galleryPageId = pageId;

    const main = document.querySelector('.main-content-area');
    if (!main) return;

    const shell = document.createElement('div');
    shell.className = 'gallery-shell';
    shell.innerHTML = `
        <div id="gallery-intro" class="gallery-intro"></div>
        <div class="gallery-toolbar">
            <label class="gallery-search-label" for="gallery-search">Search</label>
            <input type="search" id="gallery-search" class="editor-input gallery-search"
                   placeholder="Type a name..." autocomplete="off" spellcheck="false">
            <span id="gallery-count" class="gallery-count"></span>
        </div>
        <div id="gallery-grid" class="gallery-grid"></div>
    `;
    main.appendChild(shell);

    let data = null;
    if (window.supabaseClient) {
        const { data: row } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', pageId).maybeSingle();
        data = row ? row.desc_data : null;
    }

    const intro = (data && Array.isArray(data.intro)) ? data.intro : [];
    const items = (data && Array.isArray(data.items)) ? data.items : [];

    if (intro.length && typeof window.generateHTMLForBlocks === 'function') {
        document.getElementById('gallery-intro').innerHTML = window.generateHTMLForBlocks(intro, '');
    }

    galleryItems = indexItems(items);

    if (galleryItems.length === 0) {
        document.getElementById('gallery-grid').innerHTML =
            `<p class="empty-tab-msg">Nothing here yet. Press EDIT PAGE to add the first entry.</p>`;
        return;
    }

    renderGrid(galleryItems);

    const search = document.getElementById('gallery-search');
    if (search) {
        search.addEventListener('input', () => applyGalleryFilter(search.value));
        // Escape clears, which is what a search box that filters live should do.
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { search.value = ''; applyGalleryFilter(''); }
        });
    }
};

// Exported for tests and for the editor's preview, which renders the same grid
// from unsaved data rather than from the database.
window.galleryInternals = { indexItems, applyGalleryFilter, renderGrid, isVideoSrc, buildGalleryCard };
Object.defineProperty(window, 'galleryItemsForTest', {
    get: () => galleryItems,
    set: (v) => { galleryItems = v; },
});
