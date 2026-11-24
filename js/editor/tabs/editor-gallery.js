/**
 * Gallery editing: a bin of items and one modal that takes a file and a name,
 * for a gallery page and for a character's Gallery tab. Not the Block editor: a
 * gallery is a flat list of named media.
 * @since v0.12
 * @touches desc_data.items (a gallery page), desc_data.gallery (the Gallery tab),
 *   uploadWikiMedia and openMediaLibraryPicker (editor-media.js), gallery.js's
 *   renderer for the preview
 * @watch each item submits as its own delta (scope 'gallery_item', keyed by
 *   name), so two people adding different items never collide. The name is the
 *   key: renaming is a delete plus an add, and two items cannot share one.
 * @see docs/editor.md
 */

// The working copy the bin draws and Submit reads, so an abandoned modal leaves
// nothing behind.
let galleryEditorItems = [];

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

        // The name is the delta key, so renaming is a delete plus an add; the field says so.
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
            if (!(await window.confirmDelete(`Remove "${item.name || 'this item'}" from the gallery?`))) return;
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

// The live preview through the real gallery renderer.
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

// The one modal: a file and a name, the rest editable in the bin afterwards. It
// takes where the item lands, for the Gallery tab too. `ctx.items()` is read when
// ADD is pressed, so the duplicate check sees the list as it is then.
function openMediaItemModal(ctx) {
    const overlay = document.getElementById('gallery-item-modal');
    if (!overlay) return;

    const fileInput = document.getElementById('gallery-item-file');
    const nameInput = document.getElementById('gallery-item-name');
    const status = document.getElementById('gallery-item-status');
    const confirm = document.getElementById('gallery-item-confirm');
    const cancel = document.getElementById('gallery-item-cancel');
    const pickBtn = document.getElementById('gallery-item-pick');
    const picked = document.getElementById('gallery-item-picked');

    // A URL picked from the Media Library instead of a file. Reset on every open.
    let pickedUrl = '';

    fileInput.value = '';
    nameInput.value = '';
    status.textContent = '';
    if (picked) picked.textContent = '';
    confirm.disabled = false;
    overlay.classList.remove('hidden');
    nameInput.focus();

    // "Wave" from wave.mp4 or .../wave_emote.webp, as for a picked file.
    const nameFromFilename = (raw) => {
        const base = String(raw || '').split(/[?#]/)[0].split('/').pop()
            .replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
    };

    if (pickBtn) {
        pickBtn.onclick = () => {
            if (typeof window.openMediaLibraryPicker !== 'function') return;
            window.openMediaLibraryPicker((url) => {
                pickedUrl = url;
                // Clearing the file makes the two routes exclusive: a pick after choosing a file
                // must not upload it and then ignore it.
                fileInput.value = '';
                if (picked) picked.textContent = `Using: ${url.split('/').pop()}`;
                if (!nameInput.value.trim()) nameInput.value = nameFromFilename(url);
                status.textContent = '';
            });
        };
    }

    // The name from the filename: wave.mp4 is almost always "Wave".
    fileInput.onchange = () => {
        const file = fileInput.files[0];
        // Choosing a file abandons a pick.
        if (file) {
            pickedUrl = '';
            if (picked) picked.textContent = '';
        }
        status.textContent = '';
        // The library's weight advice, at pick time, while a lighter file can still be
        // chosen. Checked on arrival, so a slow measurement cannot talk over a newer pick
        // or the upload's status.
        if (file && typeof window.mediaWeightNote === 'function') {
            window.mediaWeightNote(file).then((note) => {
                if (note && fileInput.files[0] === file && !status.textContent) {
                    status.textContent = `Heavier than the wiki needs (${note}). ${window.MEDIA_WEIGHT_ADVICE}`;
                }
            }).catch(() => {});
        }
        if (!file || nameInput.value.trim()) return;
        nameInput.value = nameFromFilename(file.name);
    };

    const close = () => {
        overlay.classList.add('hidden');
        confirm.onclick = null;
        cancel.onclick = null;
        fileInput.onchange = null;
        if (pickBtn) pickBtn.onclick = null;
    };

    cancel.onclick = close;

    confirm.onclick = async () => {
        const file = fileInput.files[0];
        const name = nameInput.value.trim();

        if (!file && !pickedUrl) { status.textContent = 'Pick a file, or choose one from the library.'; return; }
        if (!name) { status.textContent = 'Give it a name.'; return; }
        if (ctx.items().some(i => (i.name || '').toLowerCase() === name.toLowerCase())) {
            // Two items sharing a name would make the second overwrite the first on approval.
            status.textContent = `"${name}" is already in this gallery. Pick a different name.`;
            return;
        }

        confirm.disabled = true;

        // A picked file is already in the bucket: uploading it again would put a second
        // copy in the library.
        let src = pickedUrl;
        if (!src) {
            const result = await window.uploadWikiMedia(file, (s) => { status.textContent = s; });
            if (result.error) {
                status.textContent = result.error;
                confirm.disabled = false;
                return;
            }
            src = result.url;
        }

        ctx.onAdd({ name, src, alt: name, note: '', tags: [] });
        close();
    };
}

window.openGalleryItemModal = function() {
    openMediaItemModal({
        items: () => galleryEditorItems,
        onAdd: (item) => {
            galleryEditorItems.push(item);
            renderGalleryBin();
            syncGalleryPreview();
        },
    });
};

/**
 * Draws a gallery page's bin and its preview.
 */
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
 * What changed, one delta per item, [{ scope, key, payload }]; payload null
 * deletes. Here so it can be tested directly.
 */
window.buildGalleryDeltas = function(localItems, cloudItems) {
    const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);
    const local = Array.isArray(localItems) ? localItems : [];
    const cloud = Array.isArray(cloudItems) ? cloudItems : [];
    const deltas = [];

    local.forEach(item => {
        // An unnamed item has no key, so it is never sent.
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

/**
 * The bin's items for Submit, which reads this, not the page: the fields write
 * through on every keystroke.
 */
window.getGalleryEditorItems = function() {
    return galleryEditorItems;
};
window.setGalleryEditorItems = function(items) {
    galleryEditorItems = Array.isArray(items) ? items : [];
};


// A character's Gallery tab: the same bin and modal. It writes into
// window.currentEditorDescData.gallery directly, because the keyed-section scan
// in collectEditorDeltas reads that: a working copy would edit and preview
// cleanly and submit nothing.
function characterGalleryItems() {
    const desc = window.currentEditorDescData || {};
    if (!Array.isArray(desc.gallery)) desc.gallery = [];
    return desc.gallery;
}

function syncCharacterGalleryPreview() {
    if (typeof window.renderCharacterGalleryTab === 'function') {
        window.renderCharacterGalleryTab(window.currentEditorDescData || {});
    }
    if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
}

function renderCharacterGalleryBin() {
    const list = document.getElementById('char-gallery-bin-list');
    const count = document.getElementById('char-gallery-bin-count');
    if (!list) return;

    const items = characterGalleryItems();
    if (count) count.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
        list.innerHTML = `<p class="empty-tab-msg editor-empty-dashed">Nothing here yet. Press + ADD MEDIA to upload the first clip.</p>`;
        return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();

    items.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'gallery-bin-row';

        const thumb = document.createElement('div');
        thumb.className = 'gallery-bin-thumb';
        // isVideoSrc is in gallery.js, which the editor does not load for a character page.
        const isVideo = window.galleryInternals
            ? window.galleryInternals.isVideoSrc(item.src)
            : /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(item.src || '').split(/[?#]/)[0]);
        if (item.src && isVideo) {
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

        // The name is the delta key, as in the page's bin.
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'editor-input gallery-bin-name';
        nameInput.value = item.name || '';
        nameInput.placeholder = 'Name';
        nameInput.addEventListener('input', () => {
            characterGalleryItems()[idx].name = nameInput.value;
            syncCharacterGalleryPreview();
        });

        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.className = 'editor-input gallery-bin-note';
        noteInput.value = item.note || '';
        noteInput.placeholder = 'Note (optional)';
        noteInput.addEventListener('input', () => {
            characterGalleryItems()[idx].note = noteInput.value;
            syncCharacterGalleryPreview();
        });

        fields.appendChild(nameInput);
        fields.appendChild(noteInput);

        const remove = document.createElement('button');
        remove.className = 'btn-sys btn-sys-red gallery-bin-remove';
        remove.textContent = '✖';
        remove.title = 'Remove this item';
        remove.addEventListener('click', async () => {
            if (!(await window.confirmDelete(`Remove "${item.name || 'this item'}" from this character's gallery?`))) return;
            characterGalleryItems().splice(idx, 1);
            renderCharacterGalleryBin();
            syncCharacterGalleryPreview();
        });

        row.appendChild(thumb);
        row.appendChild(fields);
        row.appendChild(remove);
        fragment.appendChild(row);
    });

    list.appendChild(fragment);
}

window.openCharacterGalleryItemModal = function() {
    openMediaItemModal({
        items: characterGalleryItems,
        onAdd: (item) => {
            characterGalleryItems().push(item);
            renderCharacterGalleryBin();
            syncCharacterGalleryPreview();
        },
    });
};

/**
 * Draws a character's Gallery tab editor: the bin inside the usual Workspace
 * footer.
 * @since v0.18
 */
window.renderCharacterGalleryEditor = function(builder) {
    if (!builder) return;
    const section = window.getKeyedSectionByTab ? window.getKeyedSectionByTab('gallery') : null;
    const noun = (section && section.unitNoun) || 'Gallery Item';

    // The usual Workspace footer around the bin (the format tools, and the Media
    // Library to reuse a file). initStrategyBlockBuilder draws an empty Block list
    // last, so the bin goes in after it.
    if (typeof initStrategyBlockBuilder === 'function') {
        initStrategyBlockBuilder(builder.id, [], { mode: 'gallery' });
    }

    // Beside #block-list, never in it: every listener there reads
    // closest('.block-card'), which would be null for a bin row and throw. The Block
    // list is hidden, not emptied.
    const blockList = document.getElementById('block-list');
    const footer = builder.querySelector('.add-block-toolbar');

    let host = document.getElementById('char-gallery-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'char-gallery-host';
        // Before the footer: bin, then tools.
        if (footer) builder.insertBefore(host, footer);
        else builder.appendChild(host);
    }
    // style.display: .block-editor-container sets display and borders, so `hidden`
    // would leave an empty bordered strip.
    if (blockList) blockList.style.display = 'none';

    host.innerHTML = `
        <div class="editor-section-banner editor-section-banner-spaced">
            <span class="editor-section-banner-text">GALLERY</span>
        </div>
        <div class="gallery-bin-toolbar">
            <button class="btn-sys btn-sys-green" id="char-gallery-add">+ ADD MEDIA</button>
            <span id="char-gallery-bin-count" class="gallery-bin-count"></span>
        </div>
        <div id="char-gallery-bin-list" class="gallery-bin-list"></div>
    `;

    // A listener, never an inline onclick.
    const addBtn = document.getElementById('char-gallery-add');
    if (addBtn) {
        addBtn.title = `Add a ${noun}`;
        addBtn.addEventListener('click', () => window.openCharacterGalleryItemModal());
    }

    renderCharacterGalleryBin();
    syncCharacterGalleryPreview();
};
