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
        if (error) return { error: 'Upload failed: ' + error.message };

        const { data: publicUrlData } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(finalName);

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
        window.renderMediaGrid();
    };

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

            let mediaHTML = isVideo
                ? `<video src="${url}" loop muted playsinline preload="metadata" class="media-thumbnail-media"></video>`
                : `<img src="${url}" class="media-thumbnail-media">`;

            const badgeHTML = (isVideo || isGif)
                ? `<div class="media-thumbnail-badge">${isVideo ? 'VIDEO' : 'GIF'}</div>`
                : '';

            card.innerHTML = `
                ${mediaHTML}
                ${badgeHTML}
                <div class="copy-toast hidden">COPIED URL!</div>
                <div class="media-thumbnail-filename">
                    ${file.name}
                </div>
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

        // Names accepted so far this run. The bucket listing the guard uses
        // was taken before any of them existed.
        const uploadedNames = [];

        for (let i = 0; i < files.length; i++) {
            const entry = entries[i];
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

    btnRefresh.addEventListener('click', window.loadMediaGallery);
    document.getElementById('media-search-input').addEventListener('input', window.renderMediaGrid);
    document.getElementById('media-filter-select').addEventListener('change', window.renderMediaGrid);

    dropZone.addEventListener('click', () => {
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
        handleUploads(Array.from(e.dataTransfer.files));
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.initMediaLibrary();
});
