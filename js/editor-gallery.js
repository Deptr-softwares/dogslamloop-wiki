/**
 * Dogslamloop Wiki - Editor: Gallery pages (page_type 'gallery')
 *
 * Deliberately not the block editor. A gallery is a flat list of media with
 * names, and the contribution anyone actually wants to make is "here is a clip
 * of the Wave emote, it is called Wave". Routing that through blocks, sections
 * and tabs would be three screens of machinery for two fields.
 *
 * So: a bin of items, and one modal that takes a file and a name.
 *
 * Each item submits as its own delta (scope 'gallery_item', keyed by name),
 * which is what makes this safe at thirty contributors. Two people adding
 * different emotes touch different keys and can never collide, and a reviewer
 * approving one does not silently carry the other's half-finished work with
 * it. The whole-list alternative would make every submission a merge conflict
 * with every other.
 */

// The working copy the bin renders and the submit path reads. Held here
// rather than in currentEditorDescData.items directly so an abandoned modal
// leaves nothing behind.
let galleryEditorItems = [];

function galleryEditorEsc(str) {
    return window.escapeHtml(str);
}

function renderGalleryBin() {
    const list = document.getElementById('gallery-bin-list');
    const count = document.getElementById('gallery-bin-count');
    if (!list) return;

    if (count) count.textContent = `${galleryEditorItems.length} item${galleryEditorItems.length === 1 ? '' : 's'}`;

    if (galleryEditorItems.length === 0) {
        list.innerHTML = `<p class="empty-tab-msg editor-empty-dashed">Nothing here yet. Press + ADD ITEM to upload the first one.</p>`;
        return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();

    galleryEditorItems.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'gallery-bin-row';

        const thumb = document.createElement('div');
        thumb.className = 'gallery-bin-thumb';
        if (item.src && window.galleryInternals && window.galleryInternals.isVideoSrc(item.src)) {
            const v = document.createElement('video');
            v.src = item.src;
            v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
            thumb.appendChild(v);
        } else if (item.src) {
            const img = document.createElement('img');
            img.src = item.src;
            img.alt = '';
            img.loading = 'lazy';
            thumb.appendChild(img);
        }

        const fields = document.createElement('div');
        fields.className = 'gallery-bin-fields';

        // Name is the delta key, so renaming an item is a delete plus an add.
        // Said plainly rather than discovered later.
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'editor-input gallery-bin-name';
        nameInput.value = item.name || '';
        nameInput.placeholder = 'Name';
        nameInput.addEventListener('input', () => {
            galleryEditorItems[idx].name = nameInput.value;
            syncGalleryPreview();
        });

        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.className = 'editor-input gallery-bin-note';
        noteInput.value = item.note || '';
        noteInput.placeholder = 'Note (optional)';
        noteInput.addEventListener('input', () => {
            galleryEditorItems[idx].note = noteInput.value;
            syncGalleryPreview();
        });

        fields.appendChild(nameInput);
        fields.appendChild(noteInput);

        const remove = document.createElement('button');
        remove.className = 'btn-sys btn-sys-red gallery-bin-remove';
        remove.textContent = '✖';
        remove.title = 'Remove this item';
        remove.addEventListener('click', async () => {
            if (!(await window.customConfirm(`Remove "${item.name || 'this item'}" from the gallery?`))) return;
            galleryEditorItems.splice(idx, 1);
            renderGalleryBin();
            syncGalleryPreview();
        });

        row.appendChild(thumb);
        row.appendChild(fields);
        row.appendChild(remove);
        fragment.appendChild(row);
    });

    list.appendChild(fragment);
}

// Mirrors the bin into the live preview pane using the real gallery renderer,
// so what the contributor sees while editing is the page they are producing.
function syncGalleryPreview() {
    if (window.currentEditorDescData) {
        window.currentEditorDescData.items = JSON.parse(JSON.stringify(galleryEditorItems));
    }

    const pane = document.querySelector('.live-preview-pane .main-content-area')
        || document.querySelector('.live-preview-pane');
    if (!pane || !window.galleryInternals) return;

    let grid = document.getElementById('gallery-grid');
    if (!grid) {
        pane.innerHTML = `
            <div class="gallery-shell">
                <div class="gallery-toolbar">
                    <span class="gallery-search-label">Preview</span>
                    <span id="gallery-count" class="gallery-count"></span>
                </div>
                <div id="gallery-grid" class="gallery-grid"></div>
            </div>`;
        grid = document.getElementById('gallery-grid');
    }

    window.galleryItemsForTest = window.galleryInternals.indexItems(galleryEditorItems);
    window.galleryInternals.renderGrid(window.galleryItemsForTest);

    if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
}

// The one modal: a file and a name. Everything else about an item is
// optional and editable in the bin afterwards.
window.openGalleryItemModal = function() {
    const overlay = document.getElementById('gallery-item-modal');
    if (!overlay) return;

    const fileInput = document.getElementById('gallery-item-file');
    const nameInput = document.getElementById('gallery-item-name');
    const status = document.getElementById('gallery-item-status');
    const confirm = document.getElementById('gallery-item-confirm');
    const cancel = document.getElementById('gallery-item-cancel');

    fileInput.value = '';
    nameInput.value = '';
    status.textContent = '';
    confirm.disabled = false;
    overlay.classList.remove('hidden');
    nameInput.focus();

    // Guessing the name from the filename is the difference between two
    // fields and one for the common case - wave.mp4 is almost always "Wave".
    fileInput.onchange = () => {
        const file = fileInput.files[0];
        if (!file || nameInput.value.trim()) return;
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        nameInput.value = base.charAt(0).toUpperCase() + base.slice(1);
    };

    const close = () => {
        overlay.classList.add('hidden');
        confirm.onclick = null;
        cancel.onclick = null;
        fileInput.onchange = null;
    };

    cancel.onclick = close;

    confirm.onclick = async () => {
        const file = fileInput.files[0];
        const name = nameInput.value.trim();

        if (!file) { status.textContent = 'Pick a file first.'; return; }
        if (!name) { status.textContent = 'Give it a name.'; return; }
        if (galleryEditorItems.some(i => (i.name || '').toLowerCase() === name.toLowerCase())) {
            // The name is the delta key, so two items sharing one would make
            // the second silently overwrite the first at approval time.
            status.textContent = `"${name}" is already in this gallery. Pick a different name.`;
            return;
        }

        confirm.disabled = true;
        const result = await window.uploadWikiMedia(file, (s) => { status.textContent = s; });

        if (result.error) {
            status.textContent = result.error;
            confirm.disabled = false;
            return;
        }

        galleryEditorItems.push({ name, src: result.url, alt: name, note: '', tags: [] });
        renderGalleryBin();
        syncGalleryPreview();
        close();
    };
};

window.renderGalleryEditor = function(builder) {
    const desc = window.currentEditorDescData || {};
    galleryEditorItems = Array.isArray(desc.items) ? JSON.parse(JSON.stringify(desc.items)) : [];

    builder.innerHTML = `
        <div class="editor-section-banner editor-section-banner-spaced">
            <span class="editor-section-banner-text">GALLERY ITEMS</span>
        </div>
        <div class="gallery-bin-toolbar">
            <button class="btn-sys btn-sys-green" onclick="window.openGalleryItemModal()">+ ADD ITEM</button>
            <span id="gallery-bin-count" class="gallery-bin-count"></span>
        </div>
        <div id="gallery-bin-list" class="gallery-bin-list"></div>
    `;

    renderGalleryBin();
    syncGalleryPreview();
};

/**
 * Works out what changed, as one delta per item.
 *
 * Lives here rather than inline in editor-core.js's submit handler so it can
 * be driven directly - that handler is otherwise reachable only through auth,
 * the QA modal and a live insert, which means the interesting logic would be
 * tested by a copy of itself.
 *
 * Returns [{ scope, key, payload }], payload null meaning "delete this one".
 */
window.buildGalleryDeltas = function(localItems, cloudItems) {
    const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);
    const local = Array.isArray(localItems) ? localItems : [];
    const cloud = Array.isArray(cloudItems) ? cloudItems : [];
    const deltas = [];

    local.forEach(item => {
        // An unnamed item has no key to patch, so it cannot be submitted at
        // all - skipped rather than sent as a delta keyed on "".
        if (!item.name || !item.name.trim()) return;
        const old = cloud.find(o => o.name === item.name);
        if (isDiff(item, old)) deltas.push({ scope: 'gallery_item', key: item.name, payload: item });
    });

    cloud.forEach(old => {
        if (!local.find(i => i.name === old.name)) {
            deltas.push({ scope: 'gallery_item', key: old.name, payload: null });
        }
    });

    return deltas;
};

// Submit reads this rather than the DOM, so a half-typed name in the bin is
// still what gets sent - the inputs write through on every keystroke.
window.getGalleryEditorItems = function() {
    return galleryEditorItems;
};
window.setGalleryEditorItems = function(items) {
    galleryEditorItems = Array.isArray(items) ? items : [];
};
