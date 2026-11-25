/**
 * The Media Library: uploads to the wiki-media bucket, the list of files with one
 * preview, search, and the picker the Gallery bin opens.
 * @since v0.4, as part of editor.js
 * @touches Storage bucket wiki-media, media_uploads (who uploaded what),
 *   get_public_profiles, can_upload_media, window.currentMediaFiles
 * @watch uploading needs the upload media permission, and Storage's own policy
 *   enforces it: this file only says so before somebody tries
 * @see docs/block-editor.md
 */

function convertToWebP(file, newName) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
                resolve(new File([blob], newName, { type: "image/webp" }));
            }, 'image/webp', 0.9);
        };
        img.onerror = () => reject(new Error("Invalid image file."));
    });
}

/**
 * A piece of media's size, { width, height } or null, from a File (an object URL,
 * no request) or a URL. null means "measure it when drawn".
 * @since v0.12
 */
window.measureMediaSource = function(source) {
    return new Promise((resolve) => {
        if (!source) { resolve(null); return; }

        const isFile = typeof source !== 'string';
        if (isFile && !source.type) { resolve(null); return; }

        const isVideo = isFile
            ? source.type.startsWith('video/')
            : ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].some(ext => String(source).split(/[?#]/)[0].toLowerCase().endsWith(ext));

        if (isFile && !isVideo && !source.type.startsWith('image/')) { resolve(null); return; }

        const url = isFile ? URL.createObjectURL(source) : source;
        const el = document.createElement(isVideo ? 'video' : 'img');
        const done = (value) => { if (isFile) URL.revokeObjectURL(url); resolve(value); };

        // Dimensions are an optimisation, not worth an upload that never finishes.
        const timer = setTimeout(() => done(null), 5000);

        const finish = () => {
            clearTimeout(timer);
            const width = el.naturalWidth || el.videoWidth;
            const height = el.naturalHeight || el.videoHeight;
            done(width && height ? { width, height } : null);
        };

        el.addEventListener(isVideo ? 'loadedmetadata' : 'load', finish, { once: true });
        el.addEventListener('error', () => { clearTimeout(timer); done(null); }, { once: true });

        if (isVideo) el.preload = 'metadata';
        el.src = url;
    });
};

// Storage refuses an upload without the permission; this says why first.
const MEDIA_UPLOAD_LOCKED_TEXT = 'Uploading needs the upload media permission. Trusted Editors and up have it, and the owner can give it to anyone else. Media already in the library can still be used.';
// The Playground sends nothing anywhere, and an upload would be live in the
// shared library at once.
const MEDIA_PLAYGROUND_TEXT = 'Uploading is off in the Playground. Media already in the library can still be used.';

// Asked on every open, so a permission ticked mid-session counts next time. Open
// unless the answer is false: Storage refuses anyway, so failing open costs only
// a clearer message.
async function mediaUploadAllowed() {
    if (!window.supabaseClient) return true;
    try {
        const { data, error } = await window.supabaseClient.rpc('can_upload_media');
        if (error) return true;
        return data !== false;
    } catch (e) {
        return true;
    }
}

// The library asks before uploading a clip over 2 MB or past 720p, and never
// refuses: a long clip can be heavy and still be the right file.
const MEDIA_HEAVY_BYTES = 2 * 1024 * 1024;
const MEDIA_HEAVY_SHORT_SIDE = 1080;
window.MEDIA_WEIGHT_ADVICE = 'A 720p export under 2 MB looks the same on a page and loads faster for readers.';

/**
 * What makes a file heavier than the wiki needs ("1920x1080, 4.9 MB"), or null.
 * The short side, so an upright phone capture counts as 1080p. Images are left
 * alone (they become WebP on the way up), and MP4 is refused anyway.
 * @since v0.20
 */
window.mediaWeightNote = async function(file) {
    if (!file || !file.type) return null;
    const isVideo = file.type.startsWith('video/');
    const isGif = file.type.includes('gif');
    if (!isVideo && !isGif) return null;
    if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '')) return null;

    const reasons = [];
    if (isVideo) {
        const dims = await window.measureMediaSource(file).catch(() => null);
        if (dims && Math.min(dims.width, dims.height) >= MEDIA_HEAVY_SHORT_SIDE) {
            reasons.push(`${dims.width}x${dims.height}`);
        }
    }
    if (file.size > MEDIA_HEAVY_BYTES) reasons.push(`${(file.size / 1048576).toFixed(1)} MB`);
    return reasons.length ? reasons.join(', ') : null;
};

// The whole bucket: Storage answers one page per request, so it pages to the
// end. It stops at a short page, or a page with no new name, so an API that
// ignores offset cannot loop.
const MEDIA_LIST_PAGE = 1000;
async function listWikiMediaBucket() {
    const files = [];
    const seen = new Set();
    for (let offset = 0; ; offset += MEDIA_LIST_PAGE) {
        const { data, error } = await window.supabaseClient.storage.from('wiki-media')
            .list('', { limit: MEDIA_LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) return { data: null, error };
        const page = data || [];
        const fresh = page.filter(f => !seen.has(f.name));
        fresh.forEach(f => { seen.add(f.name); files.push(f); });
        if (page.length < MEDIA_LIST_PAGE || fresh.length === 0) return { data: files, error: null };
    }
}

function mediaKind(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.webm') || lower.endsWith('.mp4')) return 'VIDEO';
    if (lower.endsWith('.gif')) return 'GIF';
    return 'IMAGE';
}

const MEDIA_PREVIEW_EMPTY = '<p class="media-lib-preview-empty">Pick a file to preview it here.</p>';

/**
 * Uploads one file to the wiki-media bucket and returns its public URL. Videos
 * and GIFs keep their extension, and only still images become WebP (a GIF would
 * lose its animation); a failed conversion uploads the original. A name already
 * in the bucket is refused, since pages link the old file. `alsoKnown` is the
 * batch's names so far, which the bucket listing was taken before. onStatus
 * (optional) shows progress.
 * @since v0.12
 */
window.uploadWikiMedia = async function(file, onStatus = () => {}, alsoKnown = []) {
    // Here rather than only on the drop zone: the Gallery bin uploads too.
    if (window.editorPlayground) return { error: MEDIA_PLAYGROUND_TEXT };
    if (!window.supabaseClient) return { error: 'Not connected to the database.' };

    const lastDotIndex = file.name.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
    const originalExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex).toLowerCase() : '';

    const isVideo = file.type.startsWith('video/');
    const isGif = file.type.includes('gif');

    // MP4 is refused at upload only: every MP4 already on the wiki still plays and
    // is listed. Tested on the extension too, since a renamed file can arrive with an
    // empty or wrong type.
    if (file.type === 'video/mp4' || originalExt === '.mp4') {
        return { error: `MP4 uploads are turned off - convert the clip to WebM first.

A WebM of the same clip is usually 4-5x smaller and plays exactly the same on the site. MP4s already on the wiki keep working; this only applies to new uploads.` };
    }

    const needsConversion = !isVideo && !isGif && originalExt !== '.webp';
    let finalName = baseName + (needsConversion ? '.webp' : originalExt);

    // The known-file list may be empty (the Gallery editor can open without the
    // library), so it is fetched: the overwrite guard protects content already live.
    let known = window.currentMediaFiles;
    if (!Array.isArray(known) || known.length === 0) {
        const { data } = await listWikiMediaBucket();
        known = data || [];
    }
    const taken = [...known.map(f => f.name), ...alsoKnown];
    if (taken.some(name => String(name).toLowerCase() === finalName.toLowerCase())) {
        return { error: `A file named "${finalName}" already exists in the Cloud.

Rename your file (e.g. append "_v2") before uploading, so you do not break pages already using the old one.` };
    }

    let finalFile = file;
    try {
        if (needsConversion) {
            onStatus('Converting image to WEBP...');
            try {
                finalFile = await convertToWebP(file, finalName);
            } catch (convErr) {
                console.warn("WebP conversion failed, falling back to original file:", convErr);
                finalFile = file;
                finalName = file.name;
            }
        }

        onStatus('Uploading to Cloud...');
        const { error } = await window.supabaseClient.storage.from('wiki-media').upload(finalName, finalFile);
        // Storage's "row-level security" refusal tells nobody what to do. Here, since
        // the Gallery bin reaches it without the library's lock.
        if (error && /row-level security|unauthori[sz]ed|\b403\b/i.test(`${error.message} ${error.statusCode || ''}`)) {
            return { error: MEDIA_UPLOAD_LOCKED_TEXT };
        }
        if (error) return { error: 'Upload failed: ' + error.message };

        const { data: publicUrlData } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(finalName);

        // Who uploaded it, after the upload and not awaited into the result: the file is
        // already in, and a failed credit must not fail it (a missing row reads
        // "Unknown"). uploaded_by is sent, since the policy checks uploaded_by = auth.uid().
        try {
            const { data: sessionData } = await window.supabaseClient.auth.getSession();
            const uploaderId = sessionData && sessionData.session && sessionData.session.user
                ? sessionData.session.user.id : null;
            if (uploaderId) {
                const { error: creditError } = await window.supabaseClient
                    .from('media_uploads')
                    .insert({ path: finalName, uploaded_by: uploaderId });
                if (creditError) console.warn('Upload succeeded; could not record the uploader:', creditError.message);
            }
        } catch (creditErr) {
            console.warn('Upload succeeded; could not record the uploader:', creditErr);
        }

        // The size goes with the file, so a Skill Card picks its box shape before the
        // media loads. From the local file, so no request; a failure is not worth
        // failing the upload.
        const dimensions = await window.measureMediaSource(finalFile).catch(() => null);

        return {
            name: finalName,
            url: publicUrlData ? publicUrlData.publicUrl : '',
            width: dimensions ? dimensions.width : null,
            height: dimensions ? dimensions.height : null,
        };
    } catch (err) {
        console.error(err);
        return { error: 'Action failed: ' + err.message };
    }
};

// Disarms the picker and empties the preview: run on the dialog's close event, so
// Escape does it too. A closed library still downloads a clip it holds, and the next
// open must not offer the last file's button.
function resetMediaLibrary() {
    window.mediaPickHandler = null;
    window.mediaSelectedName = null;
    const preview = document.getElementById('media-lib-preview');
    if (preview) preview.innerHTML = MEDIA_PREVIEW_EMPTY;
}

/**
 * Opens the Media Library, from the Block toolbar, a structured tab's toolbar or
 * the picker. A box opened over another sits on top by opening last.
 * @since v1.3
 */
window.openMediaLibrary = function () {
    const overlay = document.getElementById('media-modal-overlay');
    if (!overlay) return;
    if (!overlay.dataset.wired) {
        overlay.dataset.wired = '1';
        overlay.addEventListener('close', resetMediaLibrary);
    }
    // No click outside: an upload or a pick can be under way.
    window.openDialog(overlay);
    if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
};

/**
 * Opens the Media Library to pick a file already uploaded (the Gallery bin):
 * the file's button hands its URL to onPick instead of copying it.
 * @since v0.18
 * @watch the handler is one-shot: cleared when it fires and on close, or the next
 *   ordinary open would become a picker
 */
window.openMediaLibraryPicker = function (onPick) {
    window.mediaPickHandler = typeof onPick === 'function' ? onPick : null;
    window.openMediaLibrary();
};

/**
 * Closes the library; the close event disarms the picker. Disarmed here as well, so
 * a pick handed over just before is the last one.
 * @since v0.18
 */
window.closeMediaLibrary = function () {
    resetMediaLibrary();
    const overlay = document.getElementById('media-modal-overlay');
    if (overlay) overlay.close();
};

window.initMediaLibrary = function() {
    const dropZone = document.getElementById('media-upload-zone');
    const fileInput = document.getElementById('media-file-input');
    const gallery = document.getElementById('media-gallery-grid');
    const btnRefresh = document.getElementById('btn-media-refresh');

    if (!dropZone || !gallery) return;

    window.currentMediaFiles = [];


    window.currentMediaPage = 1;
    // Rows of names are cheap, so a page holds 50.
    window.mediaItemsPerPage = 50;
    window.mediaSelectedName = null;

    window.loadMediaGallery = async function() {
        const grid = document.getElementById('media-gallery-grid');
        if (!grid) return;

        grid.innerHTML = '<div class="media-status-msg">Connecting to Cloud Storage...</div>';
        window.mediaSelectedName = null;
        renderMediaPreview(null);

        if (!window.supabaseClient) return;

        const { data, error } = await listWikiMediaBucket();
        if (error) {
            grid.innerHTML = `<div class="media-error-msg">Error: ${window.escapeHtml(error.message)}</div>`;
            return;
        }

        window.currentMediaFiles = data.filter(f => !f.name.startsWith('.'));
        window.currentMediaPage = 1;

        // Not awaited: the files are usable whatever the answer.
        applyUploadPermission();

        // The list first, the credits after: the list does not need names to be useful.
        // loadUploaderCredits redraws when they land.
        window.renderMediaGrid();
        loadUploaderCredits();
    };

    // path -> display name, from the last load.
    window.mediaUploaderNames = {};

    // Who uploaded each file, then what they are called (the second needs the
    // first's ids). Fails silently on purpose: a credit is a caption, and an error
    // banner over a working library would shout about the least important thing.
    async function loadUploaderCredits() {
        try {
            const { data: rows, error } = await window.supabaseClient
                .from('media_uploads').select('path, uploaded_by');
            if (error || !rows || !rows.length) return;

            // Unique ids: get_public_profiles takes 200 at most. NULLs dropped: an upload by
            // a deleted account.
            const ids = [...new Set(rows.map(r => r.uploaded_by).filter(Boolean))];
            if (!ids.length) return;

            const { data: profiles, error: profileError } = await window.supabaseClient
                .rpc('get_public_profiles', { target_user_ids: ids });
            if (profileError || !profiles) return;

            const nameById = {};
            profiles.forEach(p => { nameById[p.user_id] = p.display_name; });

            const byPath = {};
            rows.forEach(r => {
                const name = r.uploaded_by ? nameById[r.uploaded_by] : null;
                if (name) byPath[r.path] = name;
            });

            window.mediaUploaderNames = byPath;
            window.renderMediaGrid();
        } catch (err) {
            console.warn('Could not load uploader credits:', err);
        }
    }

    // Words search the file name, and "@" the uploader: matched from the name's
    // start, longest first, so "@Hired Killer kick" works and the rest searches the
    // file name. A file with no recorded uploader never matches an @ search.
    function mediaSearch(raw) {
        const query = String(raw || '').trim().toLowerCase();
        if (!query.startsWith('@')) return { uploader: null, words: query };
        const rest = query.slice(1).trimStart();
        const known = [...new Set(Object.values(window.mediaUploaderNames).map(n => String(n).toLowerCase()))]
            .sort((a, b) => b.length - a.length);
        const whole = known.find(n => rest === n || rest.startsWith(`${n} `));
        if (whole) return { uploader: (by) => by === whole, words: rest.slice(whole.length).trim() };
        return { uploader: (by) => by.startsWith(rest), words: '' };
    }

    window.renderMediaGrid = function() {
        const grid = document.getElementById('media-gallery-grid');
        const search = mediaSearch(document.getElementById('media-search-input')?.value);
        const filterType = document.getElementById('media-filter-select')?.value || 'all';

        if (!grid) return;

        const filteredFiles = window.currentMediaFiles.filter(file => {
            const name = file.name.toLowerCase();
            const isAnimated = mediaKind(file.name) !== 'IMAGE';

            if (search.uploader) {
                const by = window.mediaUploaderNames[file.name];
                if (!by || !search.uploader(String(by).toLowerCase())) return false;
            }
            if (search.words && !name.includes(search.words)) return false;
            if (filterType === 'video' && !isAnimated) return false;
            if (filterType === 'image' && isAnimated) return false;

            return true;
        });

        const totalItems = filteredFiles.length;
        const totalPages = Math.ceil(totalItems / window.mediaItemsPerPage) || 1;

        if (window.currentMediaPage > totalPages) window.currentMediaPage = totalPages;

        const startIndex = (window.currentMediaPage - 1) * window.mediaItemsPerPage;
        const endIndex = startIndex + window.mediaItemsPerPage;

        const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

        document.getElementById('media-page-indicator').textContent = `PAGE ${window.currentMediaPage}/${totalPages}`;

        const btnPrev = document.getElementById('btn-media-prev');
        const btnNext = document.getElementById('btn-media-next');

        btnPrev.disabled = window.currentMediaPage === 1;
        btnNext.disabled = window.currentMediaPage === totalPages;

        if (paginatedFiles.length === 0) {
            grid.innerHTML = '<div class="media-status-msg">No media matches your search criteria.</div>';
            return;
        }

        // Names only: nothing is fetched until a row is picked, and then only that file.
        // The file name and the uploader's name are escaped: one comes from a disk, the
        // other is whatever the person typed.
        grid.innerHTML = paginatedFiles.map(file => {
            const uploader = window.mediaUploaderNames[file.name];
            const selected = file.name === window.mediaSelectedName;
            const name = window.escapeHtml(file.name);
            return `<button type="button" class="media-row${selected ? ' is-selected' : ''}" aria-pressed="${selected}" data-media-name="${name}" title="${name}">
                <span class="media-row-name">${name}</span>
                <span class="media-row-type">${mediaKind(file.name)}</span>
                ${uploader ? `<span class="media-row-uploader">by ${window.escapeHtml(uploader)}</span>` : ''}
            </button>`;
        }).join('');
    };

    function publicUrlOf(file) {
        return window.supabaseClient.storage.from('wiki-media').getPublicUrl(file.name).data.publicUrl;
    }

    // The file being looked at. Its button is the only way to use it: COPY LINK, or
    // USE THIS when the picker opened the library.
    function renderMediaPreview(file) {
        const box = document.getElementById('media-lib-preview');
        if (!box) return;
        if (!file) { box.innerHTML = MEDIA_PREVIEW_EMPTY; return; }

        // Escaped into the attribute like the name: a quote would close src.
        const url = window.escapeHtml(publicUrlOf(file));
        const media = mediaKind(file.name) === 'VIDEO'
            ? `<video src="${url}" class="media-lib-preview-media" controls autoplay muted loop playsinline></video>`
            : `<img src="${url}" class="media-lib-preview-media" alt="">`;
        const uploader = window.mediaUploaderNames[file.name];
        const action = typeof window.mediaPickHandler === 'function'
            ? '<button type="button" class="btn-sys btn-sys-green" data-media-use>USE THIS</button>'
            : '<button type="button" class="btn-sys btn-sys-blue" data-media-copy>COPY LINK</button>';
        box.innerHTML = `
            <div class="media-lib-preview-frame">${media}</div>
            <p class="media-lib-preview-name">${window.escapeHtml(file.name)}</p>
            ${uploader ? `<p class="media-lib-preview-uploader">by ${window.escapeHtml(uploader)}</p>` : ''}
            <div class="media-lib-preview-actions">${action}</div>`;
    }

    // One listener each, for whatever the list and the preview hold now.
    gallery.addEventListener('click', (e) => {
        const btn = e.target.closest('.media-row');
        if (!btn) return;
        const file = window.currentMediaFiles.find(f => f.name === btn.dataset.mediaName);
        if (!file) return;
        window.mediaSelectedName = file.name;
        gallery.querySelectorAll('.media-row').forEach(r => {
            const on = r === btn;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-pressed', String(on));
        });
        renderMediaPreview(file);
    });

    const previewBox = document.getElementById('media-lib-preview');
    if (previewBox) previewBox.addEventListener('click', (e) => {
        const file = window.currentMediaFiles.find(f => f.name === window.mediaSelectedName);
        if (!file) return;
        const url = publicUrlOf(file);

        if (e.target.closest('[data-media-use]')) {
            if (typeof window.mediaPickHandler !== 'function') return;
            // Taken, then closed: closeMediaLibrary disarms the handler, so one that throws
            // cannot leave the library armed.
            const pick = window.mediaPickHandler;
            window.closeMediaLibrary();
            pick(url, file);
            return;
        }

        const copy = e.target.closest('[data-media-copy]');
        if (!copy) return;
        navigator.clipboard.writeText(url).then(() => {
            copy.textContent = 'COPIED!';
            setTimeout(() => { if (copy.isConnected) copy.textContent = 'COPY LINK'; }, 1200);
        }).catch(() => {
            const say = typeof window.editorAlert === 'function' ? window.editorAlert : window.showSystemAlert;
            say("Clipboard access denied. Manual URL: " + url);
        });
    });

    document.getElementById('btn-media-prev').addEventListener('click', () => {
        if (window.currentMediaPage > 1) {
            window.currentMediaPage--;
            window.renderMediaGrid();
        }
    });

    document.getElementById('btn-media-next').addEventListener('click', () => {
        window.currentMediaPage++;
        window.renderMediaGrid();
    });

    document.getElementById('media-search-input').addEventListener('input', () => {
        window.currentMediaPage = 1;
        window.renderMediaGrid();
    });
    document.getElementById('media-filter-select').addEventListener('change', () => {
        window.currentMediaPage = 1;
        window.renderMediaGrid();
    });

    // Uploading several files, one after another: the overwrite guard reads one
    // snapshot of the bucket, so two at once could both pass it for one name, and
    // the WebP conversion shares the main thread anyway. The rules are in
    // uploadWikiMedia.
    let uploadInProgress = false;

    function renderUploadQueue(entries) {
        const box = document.getElementById('media-upload-queue');
        if (!box) return;

        box.hidden = entries.length === 0;
        // File names come from the uploader's disk, so they are escaped.
        box.innerHTML = entries.map(entry => `
            <div class="media-upload-row media-upload-row-${entry.state}">
                <span class="media-upload-row-name">${window.escapeHtml(entry.name)}</span>
                <span class="media-upload-row-detail">${window.escapeHtml(entry.detail)}</span>
            </div>
        `).join('');
    }

    // The weight question, in the library rather than the red delete dialog (it is
    // advice), and above the queue so its buttons do not scroll away. True for
    // "upload anyway".
    let heavyChoice = null;
    function askAboutHeavy(count, firstName) {
        const queue = document.getElementById('media-upload-queue');
        let ask = document.getElementById('media-upload-ask');
        if (!ask && queue) {
            ask = document.createElement('div');
            ask.id = 'media-upload-ask';
            ask.className = 'media-upload-ask';
            queue.parentNode.insertBefore(ask, queue);
            ask.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-heavy-choice]');
                if (!btn || !heavyChoice) return;
                const resolve = heavyChoice;
                heavyChoice = null;
                ask.hidden = true;
                resolve(btn.getAttribute('data-heavy-choice') === 'upload');
            });
        }
        if (!ask) return Promise.resolve(true);

        const who = count === 1 ? `"${firstName}" is` : `${count} of these are`;
        ask.innerHTML = `
            <p class="media-upload-ask-text">${window.escapeHtml(`${who} heavier than the wiki needs. ${window.MEDIA_WEIGHT_ADVICE}`)}</p>
            <div class="media-upload-ask-actions">
                <button type="button" class="btn-sys btn-sys-regular" data-heavy-choice="skip">SKIP ${count === 1 ? 'IT' : 'THEM'}</button>
                <button type="button" class="btn-sys btn-sys-yellow" data-heavy-choice="upload">UPLOAD ANYWAY</button>
            </div>`;
        ask.hidden = false;
        return new Promise((resolve) => { heavyChoice = resolve; });
    }

    async function handleUploads(files) {
        if (!files.length) return;

        // A second batch mid-run would race the same overwrite guard.
        if (uploadInProgress) {
            window.editorAlert('An upload is already running. Wait for it to finish before starting another.');
            return;
        }
        uploadInProgress = true;

        const uploadText = document.getElementById('media-upload-text');
        const oldText = uploadText ? uploadText.textContent : '';
        if (uploadText) uploadText.style.color = "var(--accent-blue)";

        const entries = files.map(file => ({ name: file.name, state: 'queued', detail: 'Waiting' }));
        renderUploadQueue(entries);

        // One question covers the whole drop. Skipping skips only the heavy files.
        const notes = await Promise.all(files.map(f => window.mediaWeightNote(f).catch(() => null)));
        const heavy = entries.filter((entry, i) => notes[i]);
        if (heavy.length) {
            entries.forEach((entry, i) => { if (notes[i]) { entry.state = 'heavy'; entry.detail = notes[i]; } });
            renderUploadQueue(entries);
            const uploadAnyway = await askAboutHeavy(heavy.length, heavy[0].name);
            heavy.forEach(entry => {
                if (uploadAnyway) { entry.state = 'queued'; entry.detail = 'Waiting'; }
                else { entry.state = 'skipped'; entry.detail = `Skipped: ${entry.detail}`; }
            });
            renderUploadQueue(entries);
        }

        // Names accepted this run; the bucket listing was taken before them.
        const uploadedNames = [];

        for (let i = 0; i < files.length; i++) {
            const entry = entries[i];
            if (entry.state === 'skipped') continue;
            entry.state = 'working';
            entry.detail = 'Starting...';
            renderUploadQueue(entries);
            if (uploadText) uploadText.textContent = `Uploading ${i + 1} of ${files.length}...`;

            const result = await window.uploadWikiMedia(
                files[i],
                (status) => { entry.detail = status; renderUploadQueue(entries); },
                uploadedNames
            );

            // One refused file does not cancel the rest.
            if (result.error) {
                entry.state = 'failed';
                entry.detail = String(result.error).split('\n')[0];
            } else {
                entry.state = 'done';
                entry.detail = result.name;
                uploadedNames.push(result.name);
            }
            renderUploadQueue(entries);
        }

        if (uploadText) { uploadText.textContent = oldText; uploadText.style.color = ""; }
        uploadInProgress = false;

        // Once, at the end: per file would list the whole bucket each time.
        if (uploadedNames.length > 0) await window.loadMediaGallery();

        const failed = entries.filter(entry => entry.state === 'failed');
        if (failed.length > 0) {
            window.editorAlert(
                `${uploadedNames.length} of ${files.length} uploaded.\n\nNot uploaded:\n` +
                failed.map(entry => `• ${entry.name} - ${entry.detail}`).join('\n')
            );
        }
    }

    // The zone's own words, put back when a later open lifts the lock.
    const uploadTextNode = document.getElementById('media-upload-text');
    const unlockedText = uploadTextNode ? uploadTextNode.textContent : '';
    let uploadLocked = false;

    async function applyUploadPermission() {
        uploadLocked = !!window.editorPlayground || !(await mediaUploadAllowed());
        dropZone.classList.toggle('media-upload-zone-locked', uploadLocked);
        dropZone.setAttribute('aria-disabled', uploadLocked ? 'true' : 'false');
        const lockedText = window.editorPlayground ? MEDIA_PLAYGROUND_TEXT : MEDIA_UPLOAD_LOCKED_TEXT;
        if (uploadTextNode) uploadTextNode.textContent = uploadLocked ? lockedText : unlockedText;
    }

    btnRefresh.addEventListener('click', window.loadMediaGallery);

    dropZone.addEventListener('click', () => {
        if (uploadLocked) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        // Cleared first, so picking the same file again still fires change.
        e.target.value = '';
        handleUploads(files);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('media-upload-zone-dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('media-upload-zone-dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('media-upload-zone-dragover');
        if (uploadLocked) return;
        handleUploads(Array.from(e.dataTransfer.files));
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.initMediaLibrary();
});
