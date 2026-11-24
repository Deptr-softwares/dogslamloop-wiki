/**
 * The media queue: every file in the wiki-media bucket with its status (unchecked,
 * approved, flagged) and where it is used, a clip opened only when a reviewer asks,
 * and deleting a file.
 * @since v0.13
 * @touches storage bucket wiki-media, media_moderation, media_usage(),
 *   currentUserCanDeleteMedia and adminPrompt (admin-core.js), setQueueCount
 * @watch "unused" means no reference was found, never "safe to delete":
 *   media_usage() can miss an unusual form, and the owner tools' garbage collector,
 *   which errs towards keeping files, is the one to believe. File names are
 *   contributor text.
 * @see docs/overseer.md
 */

const MEDIA_QUEUE_PAGE_SIZE = 200;

let mediaQueueRows = [];
let mediaQueueUsage = new Map();
let mediaQueueLoaded = false;

// Percent-encoding differs between rows, so both sides are decoded here against
// the bucket listing.
function decodeMediaRef(ref) {
    try {
        return decodeURIComponent(String(ref));
    } catch (e) {
        return String(ref);
    }
}

function formatBytes(bytes) {
    const size = Number(bytes);
    if (!isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} kB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Paged to the end: a listing cut short hides the newest files, the ones needing
// review.
async function listMediaObjects() {
    const files = [];
    for (let offset = 0; offset < 10000; offset += MEDIA_QUEUE_PAGE_SIZE) {
        const { data, error } = await window.supabaseClient.storage
            .from('wiki-media')
            .list('', { limit: MEDIA_QUEUE_PAGE_SIZE, offset, sortBy: { column: 'created_at', order: 'desc' } });

        if (error) throw new Error(`Could not list the media library - ${error.message}`);
        if (!data) throw new Error('Could not list the media library.');

        files.push(...data.filter(file => !file.name.startsWith('.')));
        if (data.length < MEDIA_QUEUE_PAGE_SIZE) return files;
    }
    throw new Error('The media library is larger than this queue will list at once.');
}

async function loadMediaUsage() {
    const usage = new Map();
    // Usage is advice, so a failure leaves it unknown rather than failing the queue.
    try {
        const { data, error } = await window.supabaseClient.rpc('media_usage');
        if (error || !Array.isArray(data)) return usage;
        data.forEach(row => {
            usage.set(decodeMediaRef(row.path), {
                livePages: Array.isArray(row.live_pages) ? row.live_pages : [],
                otherRefs: Number(row.other_refs) || 0,
            });
        });
    } catch (e) {
        /* usage stays empty */
    }
    return usage;
}

function usageOf(name) {
    return mediaQueueUsage.get(decodeMediaRef(name)) || { livePages: [], otherRefs: 0 };
}

function usageCategory(name) {
    const usage = usageOf(name);
    if (usage.livePages.length > 0) return 'live';
    if (usage.otherRefs > 0) return 'history';
    return 'unused';
}

window.loadMediaQueue = async function() {
    const container = document.getElementById('media-queue-container');
    if (!container) return;

    container.innerHTML = `<p class="loading-msg admin-loading-msg loading-msg-busy">Loading media...</p>`;

    try {
        const [files, moderation, usage] = await Promise.all([
            listMediaObjects(),
            window.supabaseClient.from('media_moderation').select('path, status, note, reviewed_at'),
            loadMediaUsage(),
        ]);

        if (moderation.error) throw new Error(`Could not read moderation records - ${moderation.error.message}`);

        mediaQueueUsage = usage;

        const byPath = new Map((moderation.data || []).map(row => [row.path, row]));
        mediaQueueRows = files.map(file => {
            const record = byPath.get(file.name);
            return {
                name: file.name,
                size: file.metadata ? file.metadata.size : null,
                createdAt: file.created_at || null,
                // No row is the unchecked state: the table overlays the bucket.
                status: record ? record.status : 'unchecked',
                note: record ? record.note : null,
            };
        });

        mediaQueueLoaded = true;
        window.renderMediaQueue();
    } catch (err) {
        container.innerHTML = `<p class="admin-error-text">${window.escapeHtml(err.message)}</p>`;
    }
};

window.renderMediaQueue = function() {
    const container = document.getElementById('media-queue-container');
    if (!container || !mediaQueueLoaded) return;

    const statusFilter = document.getElementById('media-queue-status')?.value || 'unchecked';
    const usageFilter = document.getElementById('media-queue-usage')?.value || 'all';
    if (typeof window.setQueueCount === 'function') {
        window.setQueueCount('media', mediaQueueRows.filter(row => row.status === 'unchecked').length);
    }

    const visible = mediaQueueRows.filter(row => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (usageFilter !== 'all' && usageCategory(row.name) !== usageFilter) return false;
        return true;
    });

    const counts = mediaQueueRows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
    }, {});

    const summary = `<p class="media-queue-summary">${mediaQueueRows.length} files &middot; `
        + `${counts.unchecked || 0} unchecked &middot; ${counts.flagged || 0} flagged</p>`;

    if (visible.length === 0) {
        container.innerHTML = summary + `<p class="admin-queue-empty-msg">Nothing matches this filter.</p>`;
        return;
    }

    container.innerHTML = summary + visible.map(row => {
        const usage = usageOf(row.name);
        const category = usageCategory(row.name);
        const usageLabel = category === 'live'
            ? `Used on ${usage.livePages.length} page${usage.livePages.length === 1 ? '' : 's'}`
            : (category === 'history' ? 'Only in history/pending' : 'Nothing references it');

        const pageList = usage.livePages.length
            ? `<span class="media-queue-pages">${window.escapeHtml(usage.livePages.join(', '))}</span>`
            : '';

        const meta = [formatBytes(row.size), row.createdAt ? String(row.createdAt).slice(0, 10) : '']
            .filter(Boolean).join(' · ');

        // data- attributes and a delegated listener: the file name is contributor text.
        return `
            <div class="media-queue-row media-queue-row-${window.escapeHtml(row.status)}" data-path="${window.escapeHtml(row.name)}">
                <div class="media-queue-head">
                    <span class="media-queue-name">${window.escapeHtml(row.name)}</span>
                    <span class="update-badge media-queue-status-${window.escapeHtml(row.status)}">${window.escapeHtml(row.status)}</span>
                </div>
                <div class="media-queue-meta">
                    <span class="media-queue-usage media-queue-usage-${category}">${window.escapeHtml(usageLabel)}</span>
                    ${meta ? `<span>${window.escapeHtml(meta)}</span>` : ''}
                </div>
                ${pageList}
                ${row.note && row.status === 'flagged' ? `<p class="media-queue-note">${window.escapeHtml(row.note)}</p>` : ''}
                <div class="media-queue-preview" data-loaded="false"></div>
                <div class="media-queue-actions">
                    <button class="btn-sys btn-sys-regular media-queue-btn" data-action="view">VIEW</button>
                    <button class="btn-sys btn-sys-green media-queue-btn" data-action="approve">APPROVE</button>
                    <button class="btn-sys btn-sys-red media-queue-btn" data-action="flag">FLAG</button>
                    ${row.status !== 'unchecked' ? `<button class="btn-sys btn-sys-regular media-queue-btn" data-action="reset">RESET</button>` : ''}
                    ${window.currentUserCanDeleteMedia
                        ? `<button class="btn-sys btn-sys-red media-queue-btn media-queue-delete" data-action="delete">DELETE</button>`
                        : ''}
                </div>
                <div class="media-queue-confirm hidden"></div>
            </div>`;
    }).join('');
};

// Elements rather than innerHTML, and .src, so the address is never markup.
function buildMediaElement(path, className) {
    const { data } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(path);
    const isVideo = /\.(webm|mp4|mov|ogv)$/i.test(path);

    const media = document.createElement(isVideo ? 'video' : 'img');
    media.className = className;
    media.src = data ? data.publicUrl : '';
    if (isVideo) {
        media.controls = true;
        media.muted = true;
        media.loop = true;
    } else {
        media.alt = path;
    }
    return media;
}

// admin.css's 900px split, asked at click time, so a rotated tablet gets the
// layout for its new width.
function hasPreviewPane() {
    return window.matchMedia('(min-width: 901px)').matches
        && !!document.getElementById('media-preview-panel');
}

window.closeMediaPreview = function () {
    const panel = document.getElementById('media-preview-panel');
    if (!panel) return;
    // Emptied, not hidden: a hidden <video> keeps playing.
    document.getElementById('media-preview-stage').innerHTML = '';
    panel.classList.add('hidden');
    document.body.classList.remove('media-preview-open');
};

function showMediaInPane(path) {
    const panel = document.getElementById('media-preview-panel');
    const stage = document.getElementById('media-preview-stage');
    if (!panel || !stage) return false;

    document.getElementById('media-preview-name').textContent = path;
    stage.innerHTML = '';
    stage.appendChild(buildMediaElement(path, 'media-preview-media'));

    panel.classList.remove('hidden');
    // One thing in the pane: the revision preview hides while a clip is open.
    document.body.classList.add('media-preview-open');

    panel.scrollIntoView({ block: 'nearest' });
    return true;
}

// Nothing is fetched until a reviewer opens the row.
function revealMedia(row, path) {
    // Wide screens open the clip in the pane; a phone opens it in the row.
    if (hasPreviewPane()) {
        showMediaInPane(path);
        return;
    }

    const target = row.querySelector('.media-queue-preview');
    if (!target) return;

    if (target.dataset.loaded === 'true') {
        target.innerHTML = '';
        target.dataset.loaded = 'false';
        return;
    }

    target.innerHTML = '';
    target.appendChild(buildMediaElement(path, 'media-queue-media'));
    target.dataset.loaded = 'true';
}

async function setMediaStatus(path, status, note) {
    const session = await window.supabaseClient.auth.getSession();
    const userId = session?.data?.session?.user?.id || null;

    const { error } = await window.supabaseClient
        .from('media_moderation')
        .upsert({ path, status, note: note || null, reviewed_by: userId, reviewed_at: new Date().toISOString() },
                { onConflict: 'path' });

    if (error) {
        window.adminAlert(`Could not save: ${error.message}`);
        return false;
    }
    return true;
}

async function clearMediaStatus(path) {
    // Deleting the row returns the file to unchecked.
    const { error } = await window.supabaseClient.from('media_moderation').delete().eq('path', path);
    if (error) {
        window.adminAlert(`Could not clear: ${error.message}`);
        return false;
    }
    return true;
}

function updateLocalRow(path, status, note) {
    const row = mediaQueueRows.find(entry => entry.name === path);
    if (row) {
        row.status = status;
        row.note = note || null;
    }
}

document.addEventListener('click', async (event) => {
    const button = event.target.closest('.media-queue-btn');
    if (!button) return;

    const row = button.closest('.media-queue-row');
    if (!row) return;

    const path = row.dataset.path;
    const action = button.dataset.action;

    if (action === 'view') { revealMedia(row, path); return; }

    if (action === 'approve') {
        if (await setMediaStatus(path, 'approved', null)) {
            updateLocalRow(path, 'approved', null);
            window.renderMediaQueue();
        }
        return;
    }

    if (action === 'flag') {
        // A flagged row's note is public (the site reads flagged rows to hide them), so
        // the prompt says so.
        const note = await window.adminPrompt(
            'Why is this being flagged? This note is visible to anyone, so keep it factual.',
            'FLAG MEDIA', 'FLAG', true, 'e.g. wrong character, duplicate clip');
        if (note === null) return;

        if (await setMediaStatus(path, 'flagged', note)) {
            updateLocalRow(path, 'flagged', note);
            window.renderMediaQueue();
            window.adminAlert('Flagged. It will stop rendering on the site, but the file still exists at its storage URL. Use DELETE to remove it for good.');
        }
        return;
    }

    if (action === 'reset') {
        if (await clearMediaStatus(path)) {
            updateLocalRow(path, 'unchecked', null);
            window.renderMediaQueue();
        }
        return;
    }

    if (action === 'delete') { openDeleteConfirm(row, path); return; }
    if (action === 'delete-cancel') { closeDeleteConfirm(row); return; }
    if (action === 'delete-confirm') { await deleteMedia(row, path); return; }
});

// Its own confirmation, not adminPrompt: the only action here that cannot be
// undone shows the file's name and what was found using it together.
function openDeleteConfirm(row, path) {
    const box = row.querySelector('.media-queue-confirm');
    if (!box) return;

    // One confirmation open at a time, so a stray click cannot confirm another row.
    document.querySelectorAll('.media-queue-confirm').forEach(other => {
        if (other !== box) { other.classList.add('hidden'); other.innerHTML = ''; }
    });

    const usage = usageOf(path);
    const liveCount = usage.livePages.length;

    box.classList.remove('hidden');
    box.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'media-queue-confirm-title';
    title.textContent = `Delete ${path}?`;
    box.appendChild(title);

    const warn = document.createElement('p');
    warn.className = 'media-queue-confirm-body';
    if (liveCount > 0) {
        warn.classList.add('media-queue-confirm-danger');
        warn.textContent = `This file is used on ${liveCount} live page${liveCount === 1 ? '' : 's'}: `
            + `${usage.livePages.join(', ')}. Deleting it will break ${liveCount === 1 ? 'that page' : 'those pages'}.`;
    } else if (usage.otherRefs > 0) {
        warn.textContent = 'No live page uses this, but it still appears in page history or a pending revision. '
            + 'Restoring one of those later would restore a broken reference.';
    } else {
        warn.textContent = 'Nothing was found referencing this file. That is not the same as nothing using it; '
            + 'references are found by extraction, which can miss an unusual form.';
    }
    box.appendChild(warn);

    const final = document.createElement('p');
    final.className = 'media-queue-confirm-final';
    final.textContent = 'The file is removed from storage permanently. This cannot be undone.';
    box.appendChild(final);

    const actions = document.createElement('div');
    actions.className = 'media-queue-actions';

    const confirm = document.createElement('button');
    confirm.className = 'btn-sys btn-sys-red media-queue-btn';
    confirm.dataset.action = 'delete-confirm';
    confirm.textContent = liveCount > 0 ? 'DELETE ANYWAY' : 'DELETE PERMANENTLY';
    actions.appendChild(confirm);

    const cancel = document.createElement('button');
    cancel.className = 'btn-sys btn-sys-regular media-queue-btn';
    cancel.dataset.action = 'delete-cancel';
    cancel.textContent = 'CANCEL';
    actions.appendChild(cancel);

    const status = document.createElement('span');
    status.className = 'media-queue-confirm-status';
    actions.appendChild(status);

    box.appendChild(actions);
}

function closeDeleteConfirm(row) {
    const box = row.querySelector('.media-queue-confirm');
    if (!box) return;
    box.classList.add('hidden');
    box.innerHTML = '';
}

// Storage first, then the record: a failed storage delete leaves everything as it
// was, and a failed record after it says so rather than inviting a second try.
async function deleteMedia(row, path) {
    const box = row.querySelector('.media-queue-confirm');
    const status = box ? box.querySelector('.media-queue-confirm-status') : null;
    const buttons = box ? box.querySelectorAll('.media-queue-btn') : [];

    const say = (text, isError) => {
        if (!status) return;
        status.textContent = text || '';
        status.classList.toggle('admin-error-text', !!isError);
    };

    buttons.forEach(b => { b.disabled = true; });
    say('Deleting…');

    const { error: storageError } = await window.supabaseClient.storage
        .from('wiki-media').remove([path]);

    if (storageError) {
        buttons.forEach(b => { b.disabled = false; });
        say(storageError.message || 'Storage refused the delete.', true);
        return;
    }

    const usage = usageOf(path);
    const note = usage.livePages.length
        ? `Was used on: ${usage.livePages.join(', ')}`
        : (usage.otherRefs > 0 ? 'Referenced only in history or pending revisions' : 'No references found');

    const { error: recordError } = await window.supabaseClient
        .rpc('record_media_deletion', { p_path: path, p_note: note });

    // Gone from storage either way, so it leaves the list either way.
    mediaQueueRows = mediaQueueRows.filter(r => r.name !== path);
    mediaQueueUsage.delete(decodeMediaRef(path));
    window.renderMediaQueue();

    if (recordError) {
        window.adminAlert(
            `The file was deleted, but its queue record could not be settled: ${recordError.message}\n\n`
            + 'The file is gone. Press Load to refresh the queue.'
        );
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['media-queue-status', 'media-queue-usage'].forEach(id => {
        const select = document.getElementById(id);
        // `change`, not `input`: the site's custom dropdown only dispatches change.
        if (select) select.addEventListener('change', window.renderMediaQueue);
    });

    const close = document.getElementById('media-preview-close');
    if (close) close.addEventListener('click', window.closeMediaPreview);

    // Escape, since the panel covers the pane the reviewer was reading.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const panel = document.getElementById('media-preview-panel');
        if (panel && !panel.classList.contains('hidden')) window.closeMediaPreview();
    });
});
