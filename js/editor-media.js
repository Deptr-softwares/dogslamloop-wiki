/**
 * Dogslamloop Wiki - Editor: Media Library (upload, gallery, WebP conversion)
 */

// --- MEDIA LIBRARY SYSTEM ---
window.initMediaLibrary = function() {
    const dropZone = document.getElementById('media-upload-zone');
    const fileInput = document.getElementById('media-file-input');
    const gallery = document.getElementById('media-gallery-grid');
    const btnRefresh = document.getElementById('btn-media-refresh');

    if (!dropZone || !gallery) return;

    window.currentMediaFiles = [];

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
    async function handleUpload(file) {
        if (!window.supabaseClient) return;

        // Extract base name and original extension
        const lastDotIndex = file.name.lastIndexOf('.');
        const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
        const originalExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex).toLowerCase() : '';

        const isVideo = file.type.startsWith('video/');
        const isGif = file.type.includes('gif');

        // Preserve original extensions for videos and GIFs. Only convert static images to .webp.
        let newExt = originalExt;
        if (!isVideo && !isGif && originalExt !== '.webp') {
            newExt = '.webp';
        }

        let finalName = baseName + newExt;

        // 1. GATEKEEPER: Prevent Overwrites
        const exists = window.currentMediaFiles.some(f => f.name.toLowerCase() === finalName.toLowerCase());
        if (exists) {
            window.editorAlert(`A file named "${finalName}" already exists in the Cloud!\n\nPlease rename your file on your computer (e.g., append "_v2" or "_updated" to the end) before uploading to ensure you do not break live Wiki pages.`);
            return;
        }

        const dropZone = document.getElementById('media-upload-zone');
        const uploadText = document.getElementById('media-upload-text');
        const oldText = uploadText.textContent;
        uploadText.style.color = "var(--accent-blue)";

        let finalFile = file;

        try {
            // 2. CONVERSION ROUTING (Images Only)
            if (!isVideo && !isGif && originalExt !== '.webp') {
                uploadText.textContent = "Converting Image to WEBP...";
                try {
                    finalFile = await convertToWebP(file, finalName);
                } catch (convErr) {
                    console.warn("WebP conversion failed, falling back to original file:", convErr);
                    finalFile = file;
                    finalName = file.name; // Revert to original extension on failure
                }
            }

            // 3. SECURE CLOUD UPLOAD
            uploadText.textContent = "Uploading to Cloud...";
            const { error } = await window.supabaseClient.storage.from('wiki-media').upload(finalName, finalFile);

            if (error) {
                console.error("Upload error:", error);
                window.editorAlert("Upload failed: " + error.message);
            } else {
                window.loadMediaGallery(); // Instantly refresh the grid
            }
        } catch (err) {
            console.error(err);
            window.editorAlert("Action Failed: " + err.message);
        }

        uploadText.textContent = oldText;
        uploadText.style.color = "";
    }

    btnRefresh.addEventListener('click', window.loadMediaGallery);
    document.getElementById('media-search-input').addEventListener('input', window.renderMediaGrid);
    document.getElementById('media-filter-select').addEventListener('change', window.renderMediaGrid);

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleUpload(e.target.files[0]);
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
        if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.initMediaLibrary();
});
