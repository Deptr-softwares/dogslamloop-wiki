/**
 * The Free Submit Tier List: the community's own ranking, beside the certified
 * per-person lists. Each character shows its sample size, a selected one shows
 * how the votes spread, and the ballot says first whether the reader may vote.
 * @since v0.14
 * @touches free_submit_tiers, free_submit_votes, get_free_submit_rankings(),
 *   free_submit_eligibility(), submit_tier_votes(), loadCharacterRoster
 *   (site_data.js), registerWikiTool (tool_page.js)
 * @watch the reasoning behind every limit is in its migration
 *   (20260814000001_free_submit_tier_list.sql). The gate is asked before the
 *   ballot is drawn, and the RPC checks everything again.
 * @see docs/tier-lists.md
 */

(function () {
    const PAGE_ID = 'free_submit_tier_list';

    const state = {
        roster: new Map(),    // page_id -> { name, url, image }
        scale: [],            // [{ tier, rank, color }] best first
        rankings: new Map(),  // page_id -> ranking row
        myVotes: new Map(),   // page_id -> tier, as last saved
        draft: new Map(),     // page_id -> tier | null (null = withdraw)
        gate: null,
        session: null,
        selected: null,
        mount: null,
    };

    const client = () => window.supabaseClient;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // Normal between a migration and the release that applies it, and said so.
    function notDeployed(error) {
        return !!error && (error.code === 'PGRST202' || error.code === 'PGRST205'
            || /schema cache/i.test(error.message || ''));
    }

    // The roster loader every tier list shares.
    async function loadRoster() {
        if (state.roster.size) return;
        state.roster = await window.loadCharacterRoster();
    }

    // navigation.json says which characters exist; the database checks a vote
    // against site_pages when it is written.
    function rosterIds() {
        return Array.from(state.roster.keys());
    }

    function portrait(pageId) {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };

        const wrap = el('span', 'tier-portrait');
        wrap.dataset.tip = meta.name;

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) {
            wrap.style.backgroundColor = window.CHARACTER_COLORS[meta.name];
        }

        // The name sits underneath and shows if the portrait fails, so a missing one is
        // visible.
        wrap.appendChild(el('span', 'tier-portrait-name', meta.name));

        const img = document.createElement('img');
        img.className = 'tier-portrait-img';
        img.loading = 'lazy';
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        if (meta.image) img.src = rootPath + meta.image;
        wrap.appendChild(img);

        return wrap;
    }

    async function loadScale() {
        if (state.scale.length) return;
        const { data, error } = await client()
            .from('free_submit_tiers').select('tier, rank, color').order('rank', { ascending: false });
        if (error || !data) return;
        state.scale = data;
    }

    async function loadRankings() {
        state.rankings.clear();
        const { data, error } = await client().rpc('get_free_submit_rankings');
        if (error) return error;
        (data || []).forEach(row => state.rankings.set(row.character_id, row));
        return null;
    }

    async function loadViewer() {
        try {
            const { data } = await client().auth.getSession();
            state.session = data ? data.session : null;
        } catch (e) {
            state.session = null;
        }

        const { data: gate, error } = await client().rpc('free_submit_eligibility');
        // A one-row table, which PostgREST returns as an array.
        state.gate = error ? null : (Array.isArray(gate) ? gate[0] : gate);

        state.myVotes.clear();
        state.draft.clear();
        if (!state.session) return;

        const { data: mine } = await client()
            .from('free_submit_votes').select('character_id, tier')
            .eq('user_id', state.session.user.id);
        (mine || []).forEach(v => state.myVotes.set(v.character_id, v.tier));
    }

    function rankedEntry(pageId) {
        const row = state.rankings.get(pageId);
        const btn = el('button', 'fs-entry');
        btn.type = 'button';
        btn.dataset.character = pageId;
        if (state.selected === pageId) btn.classList.add('fs-entry-selected');

        btn.appendChild(portrait(pageId));

        // The sample size, on the face of every character: it makes the placement
        // readable at all.
        const count = row ? row.vote_count : 0;
        btn.appendChild(el('span', 'fs-entry-count', `${count} vote${count === 1 ? '' : 's'}`));

        return btn;
    }

    function renderBoard(host) {
        host.textContent = '';

        const ranked = new Map();   // tier -> [pageId]
        const unranked = [];
        const unvoted = [];

        rosterIds().forEach(id => {
            const row = state.rankings.get(id);
            if (!row || !row.vote_count) { unvoted.push(id); return; }
            if (!row.ranked) { unranked.push(id); return; }
            if (!ranked.has(row.median_tier)) ranked.set(row.median_tier, []);
            ranked.get(row.median_tier).push(id);
        });

        // Strongest first within a tier, by the continuous median (the migration says
        // why); a tie goes to the larger sample.
        ranked.forEach(list => list.sort((a, b) => {
            const ra = Number((state.rankings.get(a) || {}).median_rank) || 0;
            const rb = Number((state.rankings.get(b) || {}).median_rank) || 0;
            if (rb !== ra) return rb - ra;
            return (state.rankings.get(b).vote_count) - (state.rankings.get(a).vote_count);
        }));

        state.scale.forEach(tier => {
            const row = el('div', 'fs-tier-row');

            const label = el('div', 'fs-tier-label', tier.tier);
            label.style.backgroundColor = tier.color;
            row.appendChild(label);

            const body = el('div', 'fs-tier-body');
            (ranked.get(tier.tier) || []).forEach(id => body.appendChild(rankedEntry(id)));
            if (!(ranked.get(tier.tier) || []).length) {
                body.appendChild(el('span', 'fs-tier-empty', 'Nobody yet.'));
            }
            row.appendChild(body);

            host.appendChild(row);
        });

        // Shown, not hidden: a character under the floor is unranked, and saying so
        // invites a vote.
        if (unranked.length || unvoted.length) {
            const floor = state.gate && state.gate.min_votes_to_rank;
            const row = el('div', 'fs-tier-row fs-tier-row-pending');
            row.appendChild(el('div', 'fs-tier-label fs-tier-label-pending', '?'));

            const body = el('div', 'fs-tier-body');
            const note = el('p', 'fs-pending-note', floor
                ? `Not enough votes to place yet - ${floor} needed.`
                : 'Not enough votes to place yet.');
            body.appendChild(note);

            const strip = el('div', 'fs-pending-strip');
            unranked.concat(unvoted).forEach(id => strip.appendChild(rankedEntry(id)));
            body.appendChild(strip);

            row.appendChild(body);
            host.appendChild(row);
        }
    }

    // The spread of one character's votes, since a median only needs questioning
    // when a reader doubts a placement.
    function renderDetail(host) {
        host.textContent = '';
        if (!state.selected) {
            host.appendChild(el('p', 'fs-detail-hint',
                'Pick a character to see how the votes were spread.'));
            return;
        }

        const id = state.selected;
        const meta = state.roster.get(id) || { name: id };
        const row = state.rankings.get(id);
        const total = row ? row.vote_count : 0;

        host.appendChild(el('h3', 'fs-detail-title', meta.name));

        const summary = el('p', 'fs-detail-summary');
        if (!total) {
            summary.textContent = 'No votes yet.';
        } else if (row.ranked) {
            summary.textContent = `Median ${row.median_tier}, from ${total} vote${total === 1 ? '' : 's'}.`;
        } else {
            summary.textContent = `${total} vote${total === 1 ? '' : 's'} so far - not enough to place.`;
        }
        host.appendChild(summary);

        if (!total) return;

        const dist = (row && row.distribution) || {};
        const chart = el('div', 'fs-chart');

        state.scale.forEach(tier => {
            const n = Number(dist[tier.tier]) || 0;
            const line = el('div', 'fs-chart-line');

            const key = el('span', 'fs-chart-key', tier.tier);
            key.style.backgroundColor = tier.color;
            line.appendChild(key);

            const track = el('span', 'fs-chart-track');
            const fill = el('span', 'fs-chart-fill');
            fill.style.width = `${total ? Math.round((n / total) * 100) : 0}%`;
            fill.style.backgroundColor = tier.color;
            track.appendChild(fill);
            line.appendChild(track);

            line.appendChild(el('span', 'fs-chart-count', String(n)));
            chart.appendChild(line);
        });

        host.appendChild(chart);
    }

    function ballotRow(pageId) {
        const meta = state.roster.get(pageId) || { name: pageId };
        const row = el('div', 'fs-ballot-row');

        const who = el('div', 'fs-ballot-who');
        who.appendChild(portrait(pageId));
        who.appendChild(el('span', 'fs-ballot-name', meta.name));
        row.appendChild(who);

        const current = state.draft.has(pageId)
            ? state.draft.get(pageId)
            : (state.myVotes.get(pageId) || null);

        const choices = el('div', 'fs-ballot-choices');
        state.scale.forEach(tier => {
            const b = el('button', 'fs-choice', tier.tier);
            b.type = 'button';
            b.dataset.vote = pageId;
            b.dataset.tier = tier.tier;
            b.style.borderColor = tier.color;
            if (current === tier.tier) {
                b.classList.add('fs-choice-on');
                b.style.backgroundColor = tier.color;
            }
            b.setAttribute('aria-pressed', current === tier.tier ? 'true' : 'false');
            choices.appendChild(b);
        });

        // An explicit "no opinion", so a rating given can be taken back.
        const clear = el('button', 'fs-choice fs-choice-clear', '-');
        clear.type = 'button';
        clear.dataset.vote = pageId;
        clear.dataset.tier = '';
        clear.dataset.tip = 'No opinion';
        clear.setAttribute('aria-label', 'No opinion');
        if (!current) clear.classList.add('fs-choice-on');
        choices.appendChild(clear);

        row.appendChild(choices);
        return row;
    }

    function pendingChanges() {
        const upserts = [];
        const removals = [];
        state.draft.forEach((tier, id) => {
            const saved = state.myVotes.get(id) || null;
            if (tier === saved) return;
            if (tier) upserts.push({ character_id: id, tier });
            else if (saved) removals.push(id);
        });
        return { upserts, removals };
    }

    function renderBallot(host) {
        host.textContent = '';

        host.appendChild(el('h3', 'fs-section-title', 'Your ratings'));

        const gate = state.gate;

        if (!gate) {
            host.appendChild(el('p', 'admin-error-text',
                'The community ranking arrives with the next release.'));
            return;
        }

        if (!gate.eligible) {
            const msg = el('p', 'fs-gate-note', gate.reason || 'You cannot vote yet.');
            host.appendChild(msg);

            // Why the gate exists, said once and without accusing anyone.
            host.appendChild(el('p', 'fs-gate-why',
                'Ratings are limited to established accounts so a ranking reflects the community rather than whoever made the most accounts that afternoon.'));

            if (!state.session) {
                const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
                const link = el('a', 'btn-sys btn-sys-regular', 'SIGN IN');
                link.href = `${rootPath}account.html`;
                host.appendChild(link);
            }
            return;
        }

        host.appendChild(el('p', 'fs-ballot-hint',
            'Rate as many or as few as you like. Leaving somebody unrated is a real answer, and a better one than guessing.'));

        const list = el('div', 'fs-ballot');
        rosterIds().forEach(id => list.appendChild(ballotRow(id)));
        host.appendChild(list);

        const bar = el('div', 'fs-ballot-actions');
        const { upserts, removals } = pendingChanges();
        const n = upserts.length + removals.length;

        const save = el('button', 'btn-sys btn-sys-primary', n ? `SAVE ${n} CHANGE${n === 1 ? '' : 'S'}` : 'SAVE');
        save.type = 'button';
        save.id = 'fs-save';
        save.disabled = !n;
        bar.appendChild(save);

        bar.appendChild(el('span', 'fs-ballot-status', ''));
        host.appendChild(bar);
    }

    async function save() {
        const { upserts, removals } = pendingChanges();
        if (!upserts.length && !removals.length) return;

        const status = state.mount.querySelector('.fs-ballot-status');
        const button = state.mount.querySelector('#fs-save');
        if (button) button.disabled = true;
        if (status) status.textContent = 'Saving...';

        try {
            if (upserts.length) {
                const { data, error } = await client().rpc('submit_tier_votes', { p_votes: upserts });
                if (error) throw error;
                if (status) status.textContent = data || 'Saved.';
            }

            // A withdrawal deletes the caller's own rows, allowed even when voting is closed.
            if (removals.length) {
                const { error } = await client()
                    .from('free_submit_votes').delete()
                    .eq('user_id', state.session.user.id)
                    .in('character_id', removals);
                if (error) throw error;
                if (status && !upserts.length) status.textContent = 'Ratings removed.';
            }
        } catch (error) {
            if (status) {
                status.textContent = notDeployed(error)
                    ? 'The community ranking arrives with the next release.'
                    : (error.message || 'Could not save.');
                status.classList.add('admin-error-text');
            }
            if (button) button.disabled = false;
            return;
        }

        // Reloaded, not patched: the number shown is the one the database computed.
        await loadViewer();
        await loadRankings();
        render();
    }

    function render() {
        const mount = state.mount;
        if (!mount) return;
        mount.textContent = '';

        const board = el('section', 'fs-board-section');
        board.appendChild(el('h3', 'fs-section-title', 'What the community says'));
        const boardHost = el('div', 'fs-board');
        board.appendChild(boardHost);
        mount.appendChild(board);

        const detail = el('section', 'fs-detail');
        mount.appendChild(detail);

        const ballot = el('section', 'fs-ballot-section');
        mount.appendChild(ballot);

        renderBoard(boardHost);
        renderDetail(detail);
        renderBallot(ballot);
    }

    // One delegated listener: every control carries its subject in a data- attribute.
    function wire(mount) {
        mount.addEventListener('click', (e) => {
            const entry = e.target.closest('.fs-entry');
            if (entry && mount.contains(entry)) {
                const id = entry.dataset.character;
                state.selected = (state.selected === id) ? null : id;
                render();
                return;
            }

            const choice = e.target.closest('.fs-choice');
            if (choice && mount.contains(choice)) {
                const id = choice.dataset.vote;
                state.draft.set(id, choice.dataset.tier || null);
                render();
                return;
            }

            const saveBtn = e.target.closest('#fs-save');
            if (saveBtn && mount.contains(saveBtn)) save();
        });
    }

    window.registerWikiTool(PAGE_ID, async (mount) => {
        state.mount = mount;
        mount.classList.add('fs-tool');

        await loadRoster();

        if (!client()) {
            mount.appendChild(el('p', 'admin-error-text', 'Could not reach the wiki backend.'));
            return;
        }

        // Asked for together, since none needs another: one wait on the database, not
        // three.
        const [, rankingError] = await Promise.all([loadScale(), loadRankings(), loadViewer()]);

        if (rankingError && notDeployed(rankingError)) {
            mount.appendChild(el('p', 'loading-msg',
                'The community ranking arrives with the next release.'));
            return;
        }

        // Without the scale from the database there are no rows to draw.
        if (!state.scale.length) {
            mount.appendChild(el('p', 'loading-msg',
                'The community ranking arrives with the next release.'));
            return;
        }

        wire(mount);
        render();
    });
})();
