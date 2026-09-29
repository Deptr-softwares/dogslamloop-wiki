/**
 * Dogslamloop Wiki - Editor: Media Library (upload, gallery, WebP conversion)
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
 * The pixel dimensions of a piece of media, as { width, height } or null.
 *
 * Accepts a File (measured from an object URL, so it costs no extra request)
 * or a URL string (measured from the network, which is what the move editor
 * needs because the media library hands out URLs to paste rather than
 * inserting files directly).
 *
 * Videos need a <video> and its loadedmetadata event; images need an <img> and
 * its load event - there is no one element that answers for both. Anything the
 * browser cannot decode resolves to null, which callers treat as "measure it
 * at render time instead".
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

        // A file that never fires either event would leave the upload hanging
        // forever, and dimensions are an optimisation - not worth blocking on.
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

/**
 * Uploads one file to the wiki-media bucket and returns its public URL.
 *
 * Extracted from the Media Library's own drop zone so the gallery editor can
 * upload without reimplementing any of it. Three rules matter and all of them
 * are easy to get subtly wrong twice:
 *
 *   - Videos and GIFs keep their original extension; only static images are
 *     converted to WebP. Converting a GIF would kill the animation, and
 *     "convert everything" is the obvious wrong simplification.
 *   - An upload that would overwrite an existing filename is refused, because
 *     the old name is already live on wiki pages pointing at the old content.
 *   - A failed conversion falls back to the original file rather than
 *     aborting - a slightly larger image beats no image.
 *
 * onStatus is optional and exists so a caller can show progress in whatever
 * element it owns.
 */
// alsoKnown is the batch's own history: names uploaded earlier in the same
// run, which the bucket listing below was taken before. Without it, two
// images called logo.png and logo.jpg both resolve to logo.webp and the
// second one gets a raw storage error instead of the guard's explanation.
// v0.20: uploading needs the upload media permission. Trusted Editor and up
// have it by role; the owner can tick it for anyone else. Storage enforces it
// (the "Auth Upload" policy); this file only says so before somebody tries.
const MEDIA_UPLOAD_LOCKED_TEXT = 'Uploading needs the upload media permission. Trusted Editors and up have it, and the owner can give it to anyone else. Media already in the library can still be used.';

// Asked every time the library opens rather than once per page, so a
// permission the owner ticks mid-session takes effect on the next open.
//
// Open unless the answer is an explicit false. Before the release that adds
// it, the function does not exist (PGRST202) and uploading is not gated at
// all; after it, Storage refuses anyway, so failing open costs a clearer
// message and nothing else.
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

// --- MEDIA WEIGHT (v0.20 V2 fix 4) ---
//
// Measured on 2026-09-28: every working clip on Puppet Master's Overview was
// 1920x1080, 0.3 to 4.9 MB each, shown in a column about 800px wide on a
// desktop and 350px on a phone. The pixels past 720p are never seen, and a
// reader waits for them anyway. So the library asks before uploading a clip
// that heavy. It asks and never refuses: a long clip can be over 2 MB and
// still be the right file.
const MEDIA_HEAVY_BYTES = 2 * 1024 * 1024;
const MEDIA_HEAVY_SHORT_SIDE = 1080;
window.MEDIA_WEIGHT_ADVICE = 'A 720p export under 2 MB looks the same on a page and loads faster for readers.';

// What makes a file heavier than the wiki needs ("1920x1080, 4.9 MB"), or
// null. The short side, so a phone capture held upright (1080x1920) counts as
// 1080p too. Static images are left alone: they become WebP on the way up, so
// their size here says nothing about what reaches the bucket. MP4 is refused
// by uploadWikiMedia anyway, and a weight note on it would only be noise.
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

window.uploadWikiMedia = async function(file, onStatus = () => {}, alsoKnown = []) {
    if (!window.supabaseClient) return { error: 'Not connected to the database.' };

    const lastDotIndex = file.name.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
    const originalExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex).toLowerCase() : '';

    const isVideo = file.type.startsWith('video/');
    const isGif = file.type.includes('gif');

    // MP4 uploads are refused (owner, 2026-08-12). This is an upload gate and
    // nothing else: every MP4 already on the wiki keeps playing, the library
    // still lists them, and no renderer changed. The site did not stop
    // supporting the format - it stopped accepting new ones.
    //
    // The reason is bytes. Measured across the whole library on 2026-08-11,
    // MP4 was 18% of the files and 56% of the total size, averaging 4.6x a
    // WebM. Format is a far bigger lever here than any size cap.
    //
    // Tested on the extension as well as the type, because a file renamed by
    // hand arrives with an empty or mismatched type and a MIME-only check
    // would wave it through.
    if (file.type === 'video/mp4' || originalExt === '.mp4') {
        return { error: `MP4 uploads are turned off - convert the clip to WebM first.

A WebM of the same clip is usually 4-5x smaller and plays exactly the same on the site. MP4s already on the wiki keep working; this only applies to new uploads.` };
    }

    const needsConversion = !isVideo && !isGif && originalExt !== '.webp';
    let finalName = baseName + (needsConversion ? '.webp' : originalExt);

    // The gallery editor can be open without the Media Library ever having
    // been rendered, so the known-file list may not be populated. Fetch it
    // rather than skipping the overwrite guard, which is the one check here
    // that protects content already live.
    let known = window.currentMediaFiles;
    if (!Array.isArray(known) || known.length === 0) {
        const { data } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
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
        // Storage refusing on the upload permission (v0.20) says "new row
        // violates row-level security policy", which tells nobody what to do.
        // The Gallery bin reaches this without the Media Library's lock, so the
        // sentence lives here rather than only on the drop zone.
        if (error && /row-level security|unauthori[sz]ed|\b403\b/i.test(`${error.message} ${error.statusCode || ''}`)) {
            return { error: MEDIA_UPLOAD_LOCKED_TEXT };
        }
        if (error) return { error: 'Upload failed: ' + error.message };

        const { data: publicUrlData } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(finalName);

        // v0.19 F8: record who uploaded this, so the library can credit them.
        //
        // AFTER the upload and deliberately not awaited into the result: the
        // file is already in the bucket by this point, and a failure to write
        // the credit must not report a successful upload as failed. A missing
        // row renders as "Unknown", which is the same state as every file
        // uploaded before this shipped - a degraded credit, not a lost file.
        //
        // uploaded_by is sent explicitly rather than left to a default, because
        // the RLS policy is WITH CHECK (uploaded_by = auth.uid()) - a row with
        // no uploader would be refused by its own guard.
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

        // Dimensions travel with the file so a skill card can pick its box
        // shape before the media has loaded. Without them the box starts 16:9
        // and corrects itself in front of the reader the first time they open
        // the tab - skill media is lazy and lives inside a hidden tab, so it
        // genuinely does not load until then. Measured from the local file, so
        // it costs no extra request; a failure here is not worth failing an
        // upload over, hence the null fallback.
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

// --- MEDIA LIBRARY SYSTEM ---

/**
 * The Media Library is a copy-a-URL tool everywhere it appears. The Gallery
 * bin (v0.18 F9) opens it for a different reason - to RE-USE a file that is
 * already uploaded - so clicking a card there has to hand the URL back rather
 * than put it on the clipboard, where a bin with no URL field could not
 * receive it.
 *
 * The handler is one-shot and armed per open. It is cleared the moment it
 * fires AND on close, because a handler left armed would silently turn the
 * next ordinary open - the block editor's footer button, one tab away - into
 * a picker that swallows the click and closes the library.
 */
window.openMediaLibraryPicker = function (onPick) {
    window.mediaPickHandler = typeof onPick === 'function' ? onPick : null;
    const overlay = document.getElementById('media-modal-overlay');
    if (overlay) {
        // The library is a tier-1 overlay (z-index 9000, style/Modals.css:19)
        // and the Gallery item modal that opens it sets 10005 inline. Opened
        // as-is it lands UNDERNEATH its own caller: fully rendered, visibly
        // there, and every card unclickable. That is the failure this repo has
        // already shipped twice, so the picker is lifted above the modal that
        // opened it and put back on close.
        overlay.style.zIndex = '10010';
        overlay.classList.remove('hidden');
    }
    if (typeof window.loadMediaGallery === 'function') window.loadMediaGallery();
};

// Every close path goes through here, including the modal's own Close button
// and a successful pick, so there is one place that disarms the handler and
// drops the lift rather than one per caller.
window.closeMediaLibrary = function () {
    window.mediaPickHandler = null;
    const overlay = document.getElementById('media-modal-overlay');
    if (overlay) {
        overlay.style.zIndex = '';
        overlay.classList.add('hidden');
    }
};

window.initMediaLibrary = function() {
    const dropZone = document.getElementById('media-upload-zone');
    const fileInput = document.getElementById('media-file-input');
    const gallery = document.getElementById('media-gallery-grid');
    const btnRefresh = document.getElementById('btn-media-refresh');

    if (!dropZone || !gallery) return;

    window.currentMediaFiles = [];


    window.currentMediaPage = 1;
    window.mediaItemsPerPage = 24;

    window.loadMediaGallery = async function() {
        const grid = document.getElementById('media-gallery-grid');
        if (!grid) return;

        grid.innerHTML = '<div class="media-status-msg">Connecting to Cloud Storage...</div>';

        if (!window.supabaseClient) return;

        const { data, error } = await window.supabaseClient.storage.from('wiki-media').list('', { limit: 1000 });
        if (error) {
            grid.innerHTML = `<div class="media-error-msg">Error: ${error.message}</div>`;
            return;
        }

        window.currentMediaFiles = data.filter(f => !f.name.startsWith('.'));
        window.currentMediaPage = 1;

        // Not awaited into the grid: the files are why the library was
        // opened, and they stay usable whatever the answer is.
        applyUploadPermission();

        // Render FIRST, then fill the credits in. The grid is the reason the
        // modal was opened and it does not need a name to be useful, so making
        // it wait on two more requests would trade the thing people came for
        // against a caption. loadUploaderCredits re-renders when it lands.
        window.renderMediaGrid();
        loadUploaderCredits();
    };

    // path -> display name, for whatever the last load resolved. A plain object
    // rather than a Map because renderMediaGrid reads it per card and this is
    // the shape the rest of this file already passes around.
    window.mediaUploaderNames = {};

    // v0.19 F8. Two requests, in sequence because the second needs the first's
    // ids: who uploaded each file, then what those people are called.
    //
    // Failure is silent by design. A credit is supplementary - the library
    // worked without it for five versions - and an error banner over a working
    // media picker would be the loudest possible way to report the least
    // important thing on screen. Same call the terminology peek makes on the
    // systems hub.
    async function loadUploaderCredits() {
        try {
            const { data: rows, error } = await window.supabaseClient
                .from('media_uploads').select('path, uploaded_by');
            if (error || !rows || !rows.length) return;

            // De-duplicated: get_public_profiles is bounded to 200 ids, and a
            // bucket of 1000 files uploaded by four people is four ids, not a
            // thousand. Nulls dropped - an ON DELETE SET NULL row is a real
            // upload by a deleted account, and asking for a NULL profile would
            // waste the request rather than fail it.
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

    window.renderMediaGrid = function() {
        const grid = document.getElementById('media-gallery-grid');
        const searchQuery = (document.getElementById('media-search-input')?.value || '').toLowerCase();
        const filterType = document.getElementById('media-filter-select')?.value || 'all';

        if (!grid) return;

        const filteredFiles = window.currentMediaFiles.filter(file => {
            const name = file.name.toLowerCase();
            const isAnimated = name.endsWith('.webm') || name.endsWith('.mp4') || name.endsWith('.gif');

            if (searchQuery && !name.includes(searchQuery)) return false;
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

        grid.innerHTML = '';

        paginatedFiles.forEach(file => {
            const { data: publicUrlData } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(file.name);
            const url = publicUrlData.publicUrl;

            const card = document.createElement('div');
            card.className = 'media-thumbnail-card';

            card.onclick = () => {
                // Picking wins over copying when the library was opened by
                // openMediaLibraryPicker. Read and cleared before the handler
                // runs, so a handler that throws cannot leave the library
                // armed for the next caller.
                if (typeof window.mediaPickHandler === 'function') {
                    const pick = window.mediaPickHandler;
                    // Captured first, then closed: closeMediaLibrary is what
                    // disarms the handler, so a handler that throws still
                    // cannot leave the library armed for the next caller.
                    window.closeMediaLibrary();
                    pick(url, file);
                    return;
                }

                navigator.clipboard.writeText(url).then(() => {
                    const toast = card.querySelector('.copy-toast');
                    if (toast) {
                        toast.classList.remove('hidden');
                        setTimeout(() => toast.classList.add('hidden'), 1200);
                    }
                }).catch(err => {
                    alert("Clipboard access denied. Manual URL: " + url);
                });
            };

            const isVideo = file.name.endsWith('.webm') || file.name.endsWith('.mp4');
            const isGif = file.name.endsWith('.gif');

            // The URL is built from the filename by getPublicUrl, so it is as
            // attacker-influenced as the name is - and it lands in an ATTRIBUTE
            // here, where a bare double quote closes src and everything after
            // it becomes markup. Found by the escaping test below: a file named
            // with an onerror handler produced an <img> that had lost its own
            // class, because the attribute had been broken out of.
            //
            // Real Storage percent-encodes what it returns, so this is defence
            // in depth rather than a live hole - but "the layer below happens to
            // sanitise" is not the standard this project keeps.
            const safeUrl = window.escapeHtml(url);

            let mediaHTML = isVideo
                ? `<video src="${safeUrl}" loop muted playsinline preload="metadata" class="media-thumbnail-media"></video>`
                // loading="lazy" is the whole of the library's loading fix -
                // it already pages at 24 and videos already use
                // preload="metadata", so this was the one place still
                // fetching everything on the page up front. Deliberately not
                // click-to-reveal like the moderation queue: picking media
                // means looking at it, and hiding it behind a click would
                // trade real usability for a saving already mostly banked.
                : `<img src="${safeUrl}" class="media-thumbnail-media" loading="lazy">`;

            const badgeHTML = (isVideo || isGif)
                ? `<div class="media-thumbnail-badge">${isVideo ? 'VIDEO' : 'GIF'}</div>`
                : '';

            // v0.19 F8. Absent for every file uploaded before the credit
            // shipped, and for one whose uploader deleted their account - both
            // are honest gaps rather than guesses, so the line is omitted
            // entirely rather than reading "Unknown". A caption that says
            // nothing is worse than no caption.
            const uploader = window.mediaUploaderNames[file.name];
            const uploaderHTML = uploader
                ? `<div class="media-thumbnail-uploader">by ${window.escapeHtml(uploader)}</div>`
                : '';

            // file.name is ESCAPED here. It comes from the uploader's disk, and
            // this is the same value the upload queue below has always escaped
            // - the two disagreed, and this was the half that did not. A
            // display name is escaped for the same reason: get_public_profiles
            // reads it from raw_user_meta_data, which is whatever the person
            // typed at sign-up.
            card.innerHTML = `
                ${mediaHTML}
                ${badgeHTML}
                <div class="copy-toast hidden">COPIED URL!</div>
                <div class="media-thumbnail-filename">
                    ${window.escapeHtml(file.name)}
                </div>
                ${uploaderHTML}
            `;

            if (isVideo) {
                const vidEl = card.querySelector('video');
                card.addEventListener('mouseenter', () => {
                    if (vidEl) vidEl.play().catch(e => console.warn("Hover play blocked by browser:", e));
                });
                card.addEventListener('mouseleave', () => {
                    if (vidEl) vidEl.pause();
                });
            }

            grid.appendChild(card);
        });
    };

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

    // Upload Logic
    // Thin UI wrapper. All the actual rules - extension handling, WebP
    // conversion, the overwrite guard - live in window.uploadWikiMedia above
    // so the gallery editor can upload without reimplementing any of it.
    //
    // The handler used to read files[0] and drop the rest, on a library whose
    // whole use is bulk: seven clips uploaded one at a time inside fifty
    // minutes, measured 2026-08-09.
    //
    // Sequential rather than parallel, deliberately. The overwrite guard reads
    // a snapshot of the bucket, so uploads in flight together can both pass it
    // for the same name; and the WebP conversion is canvas work competing for
    // the same main thread anyway.
    let uploadInProgress = false;

    function renderUploadQueue(entries) {
        const box = document.getElementById('media-upload-queue');
        if (!box) return;

        box.hidden = entries.length === 0;
        // File names come from the uploader's disk, so they are escaped like
        // any other value reaching innerHTML.
        box.innerHTML = entries.map(entry => `
            <div class="media-upload-row media-upload-row-${entry.state}">
                <span class="media-upload-row-name">${window.escapeHtml(entry.name)}</span>
                <span class="media-upload-row-detail">${window.escapeHtml(entry.detail)}</span>
            </div>
        `).join('');
    }

    // The weight question (v0.20 V2 fix 4), asked inside the library rather
    // than in the editor's confirmation modal: that one is the red delete
    // dialog, and this is advice, not a warning about losing anything. Above
    // the queue rather than in it, because the queue scrolls and the buttons
    // must not scroll away. Resolves true for "upload anyway".
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

        // A second batch starting mid-run would interleave with the first and
        // race the same overwrite guard.
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

        // Weighed before anything uploads, all at once, so one question covers
        // the whole drop. Skipping only skips the heavy files; the rest go up.
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

        // Names accepted so far this run. The bucket listing the guard uses
        // was taken before any of them existed.
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

            // One rejected file does not cancel the rest. A duplicate name
            // halfway through a run of ten used to mean starting the run over.
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

        // Once, at the end - refreshing per file re-lists the whole bucket
        // between every upload.
        if (uploadedNames.length > 0) await window.loadMediaGallery();

        const failed = entries.filter(entry => entry.state === 'failed');
        if (failed.length > 0) {
            window.editorAlert(
                `${uploadedNames.length} of ${files.length} uploaded.\n\nNot uploaded:\n` +
                failed.map(entry => `• ${entry.name} - ${entry.detail}`).join('\n')
            );
        }
    }

    // The zone's original words, kept so a lock lifted by a later open (the
    // owner ticked the box mid-session) restores them.
    const uploadTextNode = document.getElementById('media-upload-text');
    const unlockedText = uploadTextNode ? uploadTextNode.textContent : '';
    let uploadLocked = false;

    async function applyUploadPermission() {
        uploadLocked = !(await mediaUploadAllowed());
        dropZone.classList.toggle('media-upload-zone-locked', uploadLocked);
        dropZone.setAttribute('aria-disabled', uploadLocked ? 'true' : 'false');
        if (uploadTextNode) uploadTextNode.textContent = uploadLocked ? MEDIA_UPLOAD_LOCKED_TEXT : unlockedText;
    }

    btnRefresh.addEventListener('click', window.loadMediaGallery);
    document.getElementById('media-search-input').addEventListener('input', window.renderMediaGrid);
    document.getElementById('media-filter-select').addEventListener('change', window.renderMediaGrid);

    dropZone.addEventListener('click', () => {
        if (uploadLocked) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        // Cleared before handling, so picking the same file again still fires
        // a change event - otherwise a retry after a failure looks dead.
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
