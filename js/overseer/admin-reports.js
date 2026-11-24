/**
 * The report queue: reported discussion and forum posts, how many people reported
 * each, the post's earlier versions, and hide, remove or dismiss per report. The
 * same shape as the media queue: loaded on demand, filtered by status, acted on
 * per row.
 * @since v0.14
 * @touches list_content_reports() (with report_count and post_images),
 *   moderate_discussion_post(), resolve_content_report(), page_discussion_edits,
 *   storage buckets discussion-media and discord-media, adminPrompt and
 *   setQueueCount (admin-core.js)
 * @watch every string is someone else's (the note, the post, both names): post and
 *   note text go in by textContent, the rest through escapeHtml.
 * @see docs/overseer.md
 */

let reportQueueRows = [];
let reportQueueLoaded = false;
let reportEditsByPost = new Map();

const REPORT_REASON_LABELS = {
    spam: 'Spam',
    harassment: 'Harassment',
    off_topic: 'Off topic',
    other: 'Other',
};

// Absent on an older database, which reads as no images.
function reportImagePaths(row) {
    return (Array.isArray(row.post_images) ? row.post_images : [])
        .filter(p => typeof p === 'string' && reportImageBucket(p));
}

// An upload from the wiki or a copy the Discord relay made; a path matching
// neither is not drawn.
function reportImageBucket(path) {
    if (/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.(webp|jpg)$/.test(path)) return 'discussion-media';
    if (/^discord\/[0-9]{5,20}-[0-3]\.(png|jpg|webp|gif)$/.test(path)) return 'discord-media';
    return null;
}

// A forum post's key is 'forum:<uuid>', shown as FORUM.
function reportPageLabel(pageId) {
    const id = String(pageId || '');
    return id.startsWith('forum:') ? 'FORUM' : id.toUpperCase();
}

function reportTimeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!then) return '';
    const mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

window.loadReportQueue = async function () {
    const container = document.getElementById('report-queue-container');
    if (!container || !window.supabaseClient) return;

    const status = (document.getElementById('report-queue-status') || {}).value || 'open';

    container.innerHTML = '<p class="loading-msg admin-loading-msg loading-msg-busy">Loading reports...</p>';

    const { data, error } = await window.supabaseClient.rpc('list_content_reports', { p_status: status });

    if (error) {
        // Normal between a migration and the release that applies it, and said so.
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">The report queue isn't available yet - <code>list_content_reports</code> arrives with the next release.</p>`
            : `<p class="admin-error-text">Could not load reports: ${window.escapeHtml(error.message)}</p>`;
        return;
    }

    reportQueueRows = data || [];
    reportEditsByPost = await loadReportEdits(reportQueueRows);
    reportQueueLoaded = true;
    // Only open reports are "waiting".
    if (typeof window.setQueueCount === 'function' && status === 'open') window.setQueueCount('reports', reportQueueRows.length);
    renderReportQueue();
};

// A post can be edited after it is reported, so every card shows what it said
// before, in one read. The table is moderators only, and absent on an older
// database.
async function loadReportEdits(rows) {
    const byPost = new Map();
    const ids = [...new Set(rows.map(r => r.target_id).filter(Boolean))];
    if (!ids.length) return byPost;
    try {
        const { data, error } = await window.supabaseClient
            .from('page_discussion_edits')
            .select('post_id, body, edited_at, edited_by')
            .in('post_id', ids)
            .order('edited_at', { ascending: false });
        if (error || !Array.isArray(data)) return byPost;
        data.forEach(e => {
            if (!byPost.has(e.post_id)) byPost.set(e.post_id, []);
            byPost.get(e.post_id).push(e);
        });
    } catch (e) {
        // The cards still say what the post says now.
    }
    return byPost;
}

function renderReportEdits(row) {
    const earlier = reportEditsByPost.get(row.target_id) || [];
    if (!earlier.length) return null;

    const box = document.createElement('details');
    box.className = 'report-edits';
    // An edit after the report matters most: the words the reporter saw may be gone.
    const afterReport = earlier.some(e => Date.parse(e.edited_at) > Date.parse(row.created_at));
    const summary = document.createElement('summary');
    summary.className = 'report-edits-summary';
    summary.textContent = `${afterReport ? 'EDITED AFTER THE REPORT' : 'EDITED'}: ${earlier.length} earlier version${earlier.length === 1 ? '' : 's'}`;
    box.appendChild(summary);

    earlier.forEach(e => {
        const when = document.createElement('div');
        when.className = 'report-edit-when';
        when.textContent = `Until ${reportTimeAgo(e.edited_at)}${e.edited_by ? '' : ', changed on Discord'}:`;
        const text = document.createElement('blockquote');
        text.className = 'report-quote';
        // textContent: earlier words are as hostile as current ones.
        text.textContent = e.body || '[no words]';
        box.appendChild(when);
        box.appendChild(text);
    });
    return box;
}

function renderReportQueue() {
    const container = document.getElementById('report-queue-container');
    if (!container) return;

    if (!reportQueueRows.length) {
        container.innerHTML = '<p class="admin-queue-empty-msg">Nothing reported. That is the good outcome.</p>';
        return;
    }

    container.innerHTML = '';

    reportQueueRows.forEach(row => {
        const card = document.createElement('div');
        card.className = 'report-card';
        card.id = `report-${window.escapeHtml(row.id)}`;

        const head = document.createElement('div');
        head.className = 'report-card-head';
        head.innerHTML = `
            <span class="update-badge report-reason-badge">${window.escapeHtml(REPORT_REASON_LABELS[row.reason] || row.reason)}</span>
            ${Number(row.report_count) > 1
                ? `<span class="update-badge report-count-badge">${window.escapeHtml(String(row.report_count))} REPORTS</span>`
                : ''}
            <span class="report-page">${window.escapeHtml(reportPageLabel(row.page_id))}</span>
            <span class="report-time">${window.escapeHtml(reportTimeAgo(row.created_at))}</span>
        `;
        card.appendChild(head);

        const meta = document.createElement('div');
        meta.className = 'report-meta';
        meta.textContent = `Reported by ${row.reporter_name || 'Unknown'} · post by ${row.post_author || 'Unknown'}`;
        card.appendChild(meta);

        if (row.note) {
            const note = document.createElement('div');
            note.className = 'report-note';
            // textContent: a reporter's note is as hostile as the post.
            note.textContent = `“${row.note}”`;
            card.appendChild(note);
        }

        const quote = document.createElement('blockquote');
        quote.className = 'report-quote';
        if (row.post_status && row.post_status !== 'visible') {
            quote.classList.add('report-quote-down');
            quote.textContent = row.post_body
                ? row.post_body
                : `[this post is already ${row.post_status.replace(/_/g, ' ')}]`;
        } else {
            const images = reportImagePaths(row);
            quote.textContent = row.post_body || (images.length ? '[images only]' : '[the post is gone]');
        }
        card.appendChild(quote);

        const edits = renderReportEdits(row);
        if (edits) card.appendChild(edits);

        // A moderator deciding about an image sees it. Paths are checked against the
        // trigger's rule, and every address is set as a property.
        const images = reportImagePaths(row);
        if (images.length && window.supabaseClient) {
            const strip = document.createElement('div');
            strip.className = 'report-images';
            images.forEach(path => {
                const url = window.supabaseClient.storage.from(reportImageBucket(path)).getPublicUrl(path).data.publicUrl;
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener';
                const img = document.createElement('img');
                img.src = url;
                img.loading = 'lazy';
                img.alt = 'Image attached to the reported post';
                link.appendChild(img);
                strip.appendChild(link);
            });
            card.appendChild(strip);
        }

        if (row.post_status && row.post_status !== 'visible') {
            const already = document.createElement('div');
            already.className = 'report-already';
            already.textContent = `Already ${row.post_status.replace(/_/g, ' ')}.`;
            card.appendChild(already);
        }

        if (row.status === 'open') {
            const actions = document.createElement('div');
            actions.className = 'report-card-actions';

            // data- attributes and a delegated listener: ids and names from the database
            // never reach an executable position.
            [
                { label: 'REMOVE POST', cls: 'btn-sys-red', act: 'remove' },
                { label: 'HIDE POST', cls: 'btn-sys-yellow', act: 'hide' },
                { label: 'DISMISS', cls: 'btn-sys-regular', act: 'dismiss' },
            ].forEach(({ label, cls, act }) => {
                const btn = document.createElement('button');
                btn.className = `btn-sys ${cls} report-action-btn`;
                btn.textContent = label;
                btn.dataset.reportId = row.id;
                btn.dataset.reportTarget = row.target_id || '';
                btn.dataset.reportAct = act;
                // Nothing to hide or remove when the post is already down.
                if (act !== 'dismiss' && row.post_status && row.post_status !== 'visible') btn.disabled = true;
                if (act !== 'dismiss' && !row.target_id) btn.disabled = true;
                actions.appendChild(btn);
            });

            const status = document.createElement('span');
            status.className = 'report-action-status';
            actions.appendChild(status);

            card.appendChild(actions);
        } else {
            const resolved = document.createElement('div');
            resolved.className = 'report-resolved';
            resolved.textContent = `${row.status === 'actioned' ? 'Actioned' : 'Dismissed'}.`;
            card.appendChild(resolved);
        }

        container.appendChild(card);
    });
}

// The post is moderated first and the report closed second, so a failure leaves
// an open report over a post already down: visible work, not a hidden one.
async function actOnReport(btn) {
    const { reportId, reportTarget, reportAct } = btn.dataset;
    const card = document.getElementById(`report-${reportId}`);
    const statusEl = card ? card.querySelector('.report-action-status') : null;

    const setBusy = (busy) => {
        if (!card) return;
        card.querySelectorAll('.report-action-btn').forEach(b => { b.disabled = busy; });
    };

    const say = (text, isError) => {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.classList.toggle('admin-error-text', !!isError);
    };

    setBusy(true);

    if (reportAct === 'hide' || reportAct === 'remove') {
        const reason = await window.adminPrompt(
            `Reason for ${reportAct === 'hide' ? 'hiding' : 'removing'} this post - recorded in the moderation log:`,
            reportAct === 'hide' ? 'HIDE POST' : 'REMOVE POST',
            'CONFIRM', true, 'e.g. Targeted harassment'
        );
        if (reason === null) { setBusy(false); say(''); return; }

        if (!reason.trim()) { setBusy(false); say('A reason is required.', true); return; }

        say('Applying…');
        const { error: modError } = await window.supabaseClient.rpc('moderate_discussion_post', {
            p_post_id: reportTarget, p_action: reportAct, p_reason: reason.trim(),
        });

        if (modError) { setBusy(false); say(modError.message || 'Could not moderate that post.', true); return; }
    }

    say('Closing report…');
    const { error: resolveError } = await window.supabaseClient.rpc('resolve_content_report', {
        p_report_id: reportId,
        p_status: reportAct === 'dismiss' ? 'dismissed' : 'actioned',
        p_note: null,
    });

    setBusy(false);

    if (resolveError) {
        say(`Post handled, but the report did not close: ${resolveError.message}`, true);
        return;
    }

    await window.loadReportQueue();
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('report-queue-container');
    if (container) {
        container.addEventListener('click', async (e) => {
            const btn = e.target.closest('.report-action-btn');
            if (btn && !btn.disabled) await actOnReport(btn);
        });
    }

    const filter = document.getElementById('report-queue-status');
    if (filter) {
        filter.addEventListener('change', () => {
            if (reportQueueLoaded) window.loadReportQueue();
        });
    }
});
