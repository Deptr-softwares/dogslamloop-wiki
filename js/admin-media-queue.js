/**
 * Dogslamloop Wiki - Admin: Media Moderation Queue
 *
 * The reviewer side of v0.13 item 1. The model lives in
 * supabase/migrations/20260812000002_media_moderation.sql; the enforcement
 * that obeys it lives in js/site_utils.js.
 *
 * Two decisions shape this file, both the owner's:
 *
 *   1. **Media is not loaded until asked for.** The queue shows names, sizes
 *      and badges; the file itself downloads only when a reviewer opens that
 *      row. Unchecked media is by definition the newest media, which here
 *      means freshly recorded skill clips - the heaviest things in the
 *      bucket. Rendering twenty of them to decide whether to look at one is
 *      the wrong default.
 *
 *   2. **Usage is a first-class filter**, not a detail. "Nothing references
 *      this" is the most useful sorting question in a 316-file bucket, and
 *      the answer already existed - it just had nowhere to be shown.
 *
 * On "unused": it means nothing was FOUND, not "safe to delete". media_usage()
 * finds references by extracting them, which can miss an unusual form; the
 * garbage collector uses conservative substring matching for the same question
 * precisely because its mistakes have to fall the other way. The two numbers
 * can disagree, and when they do the collector is the one to believe.
 */

const MEDIA_QUEUE_PAGE_SIZE = 200;

let mediaQueueRows = [];
let mediaQueueUsage = new Map();
let mediaQueueLoaded = false;

// Percent-encoding is not normalised in SQL - the same object appears raw in
// some rows and encoded in others, so both sides are decoded here against the
// bucket listing rather than guessing at a decoder in Postgres.
function decodeMediaRef(ref) {
    try {
        return decodeURIComponent(String(ref));
    } catch (e) {
        return String(ref);
    }
}

function mediaQueueEscape(value) {
    return window.escapeHtml ? window.escapeHtml(value) : String(value == null ? '' : value);
}

function formatBytes(bytes) {
    const size = Number(bytes);
    if (!isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} kB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Paged to exhaustion, same reasoning as the garbage collector: a listing cut
// short at a fixed limit silently hides the newest files, which in this
// bucket are exactly the ones needing review.
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
    // Advisory, so a failure degrades to "usage unknown" rather than failing
    // the whole queue - a reviewer can still moderate without it.
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

    container.innerHTML = `<p class="loading-msg admin-loading-msg">Loading media...</p>`;

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
                // Absence of a row IS the unchecked state - the table is an
                // overlay on the bucket, not a register of it.
                status: record ? record.status : 'unchecked',
                note: record ? record.note : null,
            };
        });

        mediaQueueLoaded = true;
        window.renderMediaQueue();
    } catch (err) {
        container.innerHTML = `<p class="admin-error-text">${mediaQueueEscape(err.message)}</p>`;
    }
};

window.renderMediaQueue = function() {
    const container = document.getElementById('media-queue-container');
    if (!container || !mediaQueueLoaded) return;

    const statusFilter = document.getElementById('media-queue-status')?.value || 'unchecked';
    const usageFilter = document.getElementById('media-queue-usage')?.value || 'all';

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
            ? `<span class="media-queue-pages">${mediaQueueEscape(usage.livePages.join(', '))}</span>`
            : '';

        const meta = [formatBytes(row.size), row.createdAt ? String(row.createdAt).slice(0, 10) : '']
            .filter(Boolean).join(' · ');

        // data- attributes with a delegated listener, never an inline onclick:
        // the file name is contributor-supplied.
        return `
            <div class="media-queue-row media-queue-row-${mediaQueueEscape(row.status)}" data-path="${mediaQueueEscape(row.name)}">
                <div class="media-queue-head">
                    <span class="media-queue-name">${mediaQueueEscape(row.name)}</span>
                    <span class="update-badge media-queue-status-${mediaQueueEscape(row.status)}">${mediaQueueEscape(row.status)}</span>
                </div>
                <div class="media-queue-meta">
                    <span class="media-queue-usage media-queue-usage-${category}">${mediaQueueEscape(usageLabel)}</span>
                    ${meta ? `<span>${mediaQueueEscape(meta)}</span>` : ''}
                </div>
                ${pageList}
                ${row.note && row.status === 'flagged' ? `<p class="media-queue-note">${mediaQueueEscape(row.note)}</p>` : ''}
                <div class="media-queue-preview" data-loaded="false"></div>
                <div class="media-queue-actions">
                    <button class="btn-sys btn-sys-regular media-queue-btn" data-action="view">VIEW</button>
                    <button class="btn-sys btn-sys-green media-queue-btn" data-action="approve">APPROVE</button>
                    <button class="btn-sys btn-sys-red media-queue-btn" data-action="flag">FLAG</button>
                    ${row.status !== 'unchecked' ? `<button class="btn-sys btn-sys-regular media-queue-btn" data-action="reset">RESET</button>` : ''}
                </div>
            </div>`;
    }).join('');
};

// The click-to-reveal half of the owner's first decision. Nothing is fetched
// until this runs, and it runs once per row.
function revealMedia(row, path) {
    const target = row.querySelector('.media-queue-preview');
    if (!target) return;

    if (target.dataset.loaded === 'true') {
        target.innerHTML = '';
        target.dataset.loaded = 'false';
        return;
    }

    const { data } = window.supabaseClient.storage.from('wiki-media').getPublicUrl(path);
    const url = data ? data.publicUrl : '';
    const isVideo = /\.(webm|mp4|mov|ogv)$/i.test(path);

    // Built as elements rather than innerHTML so the URL is never parsed as
    // markup, and set through .src so it cannot carry attributes.
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.className = 'media-queue-media';
    media.src = url;
    if (isVideo) {
        media.controls = true;
        media.muted = true;
        media.loop = true;
    } else {
        media.alt = path;
    }

    target.innerHTML = '';
    target.appendChild(media);
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
    // Deleting the row is how a file returns to unchecked.
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
        // The note is public on a flagged row - the policy has to expose
        // flagged rows for the site to know what to hide - so the prompt says
        // so rather than letting someone find out later.
        const note = await window.adminPrompt(
            'Why is this being flagged? This note is visible to anyone, so keep it factual.',
            'FLAG MEDIA', 'FLAG', true, 'e.g. wrong character, duplicate clip');
        if (note === null) return;

        if (await setMediaStatus(path, 'flagged', note)) {
            updateLocalRow(path, 'flagged', note);
            window.renderMediaQueue();
            window.adminAlert('Flagged. It will stop rendering on the site, but the file still exists at its storage URL - deleting it is the owner\'s call.');
        }
        return;
    }

    if (action === 'reset') {
        if (await clearMediaStatus(path)) {
            updateLocalRow(path, 'unchecked', null);
            window.renderMediaQueue();
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    ['media-queue-status', 'media-queue-usage'].forEach(id => {
        const select = document.getElementById(id);
        // change, not input: initializeMangaSelects replaces these with a
        // custom dropdown that only ever dispatches change.
        if (select) select.addEventListener('change', window.renderMediaQueue);
    });
});
