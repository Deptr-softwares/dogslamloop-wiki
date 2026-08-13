/**
 * Dogslamloop Wiki - Admin: Report Queue (v0.14 item 6)
 *
 * The model lives in supabase/migrations/20260813000002_content_reports.sql.
 *
 * Moderators removing posts they happen to see does not scale to 1.4M people.
 * This is the thing that turns moderation from patrolling into a queue, and it
 * is deliberately the same shape as the media queue beside it: load on demand,
 * filter by status, act per row.
 *
 * One number does most of the work here. list_content_reports returns
 * report_count - how many people reported the same post - and three reports on
 * one post is a completely different situation from one. It is computed
 * server-side because doing it in the client would be a query per row.
 *
 * Every string rendered below is attacker-reachable: a reporter's note, the
 * reported post's body, and both display names. All of it is escaped, and the
 * post body additionally goes through textContent rather than innerHTML - the
 * same rule js/discussions.js follows for the same text on the public side.
 */

let reportQueueRows = [];
let reportQueueLoaded = false;

const REPORT_REASON_LABELS = {
    spam: 'Spam',
    harassment: 'Harassment',
    off_topic: 'Off topic',
    other: 'Other',
};

function reportEscape(value) {
    return window.escapeHtml ? window.escapeHtml(value) : String(value == null ? '' : value);
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

    container.innerHTML = '<p class="loading-msg admin-loading-msg">Loading reports...</p>';

    const { data, error } = await window.supabaseClient.rpc('list_content_reports', { p_status: status });

    if (error) {
        // The normal state between writing a migration and the release that
        // applies it - says so plainly rather than showing a raw error.
        const notDeployed = error.code === 'PGRST202' || /schema cache/i.test(error.message || '');
        container.innerHTML = notDeployed
            ? `<p class="admin-error-text">The report queue isn't available yet - <code>list_content_reports</code> arrives with the next release.</p>`
            : `<p class="admin-error-text">Could not load reports: ${reportEscape(error.message)}</p>`;
        return;
    }

    reportQueueRows = data || [];
    reportQueueLoaded = true;
    renderReportQueue();
};

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
        card.id = `report-${reportEscape(row.id)}`;

        const head = document.createElement('div');
        head.className = 'report-card-head';
        head.innerHTML = `
            <span class="update-badge report-reason-badge">${reportEscape(REPORT_REASON_LABELS[row.reason] || row.reason)}</span>
            ${Number(row.report_count) > 1
                ? `<span class="update-badge report-count-badge">${reportEscape(String(row.report_count))} REPORTS</span>`
                : ''}
            <span class="report-page">${reportEscape((row.page_id || '').toUpperCase())}</span>
            <span class="report-time">${reportEscape(reportTimeAgo(row.created_at))}</span>
        `;
        card.appendChild(head);

        const meta = document.createElement('div');
        meta.className = 'report-meta';
        meta.textContent = `Reported by ${row.reporter_name || 'Unknown'} · post by ${row.post_author || 'Unknown'}`;
        card.appendChild(meta);

        if (row.note) {
            const note = document.createElement('div');
            note.className = 'report-note';
            // textContent: a reporter's free text is as attacker-reachable as
            // the post it complains about.
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
            quote.textContent = row.post_body || '[the post is gone]';
        }
        card.appendChild(quote);

        if (row.post_status && row.post_status !== 'visible') {
            const already = document.createElement('div');
            already.className = 'report-already';
            already.textContent = `Already ${row.post_status.replace(/_/g, ' ')}.`;
            card.appendChild(already);
        }

        if (row.status === 'open') {
            const actions = document.createElement('div');
            actions.className = 'report-card-actions';

            // data- attributes and a delegated listener, never an inline
            // onclick: ids and names from the database must not reach an
            // executable position.
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
                // Nothing to hide or remove if the post is already down.
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

// Acting on a report is two writes that must not drift apart: the post is
// moderated, and the report is closed. Doing them in this order means a
// failure leaves the report open with the post already down - visible work to
// finish - rather than a closed report over a post still on the page.
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
        // Cancelled. Nothing has been written yet, so nothing to undo.
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
