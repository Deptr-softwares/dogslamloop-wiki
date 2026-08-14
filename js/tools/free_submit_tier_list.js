/**
 * Dogslamloop Wiki - Free Submit Tier List (v0.14 item 4)
 *
 * The community's own ranking, beside the certified per-person lists. The model
 * is in supabase/migrations/20260814000001_free_submit_tier_list.sql, and the
 * reasoning behind every limit is there rather than repeated here.
 *
 * Registered against the tool host rather than being a page of its own:
 * js/tool_page.js builds the frame and the authored intro/notes around this,
 * so the owner can still explain the tool in the wiki's own voice without
 * touching this file.
 *
 * TWO THINGS THIS PAGE SHOWS THAT MOST TIER LISTS DO NOT, and both are
 * deliberate:
 *
 *   THE SAMPLE SIZE, on every character. "S tier" from nine people and "S tier"
 *   from four hundred are different claims, and a page that renders them
 *   identically is hiding the only number that tells them apart. A character
 *   under the floor is shown in its own row, unranked, rather than quietly
 *   omitted - an absent character reads as an oversight, and a character
 *   labelled "not enough votes yet" reads as an invitation.
 *
 *   THE DISTRIBUTION, for whichever character is selected. A median reports the
 *   middle, and a genuinely split community and a unanimous one have the same
 *   middle. The bars are what let a reader tell those apart, and they are also
 *   what makes a successful brigade legible instead of laundered.
 *
 * THE GATE IS ASKED ABOUT BEFORE THE BALLOT IS DRAWN, never discovered at
 * submit time. free_submit_eligibility() returns the reason as prose, so a
 * refusal reads as an explanation rather than an error. The RPC re-checks
 * everything it says - this copy only decides what to draw.
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

    // The normal state between writing a migration and the release that applies
    // it, said plainly rather than as a raw error.
    function notDeployed(error) {
        return !!error && (error.code === 'PGRST202' || error.code === 'PGRST205'
            || /schema cache/i.test(error.message || ''));
    }

    // --- LOADING ---

    async function loadRoster() {
        if (state.roster.size) return;
        try {
            const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
            const nav = window.fetchJson
                ? await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true })
                : await (await fetch(`${rootPath}data/navigation.json`)).json();

            (nav.Characters || []).forEach(entry => {
                const pageId = entry.cms_config && entry.cms_config.pageId;
                if (!pageId) return;
                state.roster.set(pageId, { name: entry.name, url: entry.url, image: entry.image });
            });
        } catch (e) {
            console.warn('[FreeSubmit] Could not read the roster:', e);
        }
    }

    // navigation.json is the authority for which characters exist, the same as
    // it is for the certified lists. The database validates against site_pages
    // when a vote is written; this is only about what to draw.
    function rosterIds() {
        return Array.from(state.roster.keys());
    }

    function portrait(pageId) {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };

        const wrap = el('span', 'tier-portrait');
        wrap.title = meta.name;

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) {
            wrap.style.backgroundColor = window.CHARACTER_COLORS[meta.name];
        }

        // The name sits underneath and shows through if the portrait 404s, so
        // an unresolved key is visible rather than silently blank.
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
        // Returns a one-row table, which PostgREST hands back as an array.
        state.gate = error ? null : (Array.isArray(gate) ? gate[0] : gate);

        state.myVotes.clear();
        state.draft.clear();
        if (!state.session) return;

        const { data: mine } = await client()
            .from('free_submit_votes').select('character_id, tier')
            .eq('user_id', state.session.user.id);
        (mine || []).forEach(v => state.myVotes.set(v.character_id, v.tier));
    }

    // --- THE RANKING ---

    function rankedEntry(pageId) {
        const row = state.rankings.get(pageId);
        const btn = el('button', 'fs-entry');
        btn.type = 'button';
        btn.dataset.character = pageId;
        if (state.selected === pageId) btn.classList.add('fs-entry-selected');

        btn.appendChild(portrait(pageId));

        // The sample size, on the face of every character rather than in a
        // tooltip. It is the number that makes the placement readable at all.
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

        // Within a tier, strongest first and so left to right across the row.
        // Sorted by the continuous median rather than a mean - see the
        // migration for why. Ties fall back to the sample size, so of two
        // characters the community rates identically the better-attested one
        // leads.
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

        // Shown rather than hidden. A character with eight votes is not ranked
        // by this page, and saying so is both honest and the clearest possible
        // prompt to go and vote.
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

    // The distribution, for one character at a time. One panel rather than a
    // chart under all twenty-two: a median only needs interrogating when a
    // reader doubts a specific placement.
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

    // --- THE BALLOT ---

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

        // Explicitly "no opinion" rather than an unset default, so clearing a
        // rating you already gave is a thing you can actually do.
        const clear = el('button', 'fs-choice fs-choice-clear', '—');
        clear.type = 'button';
        clear.dataset.vote = pageId;
        clear.dataset.tier = '';
        clear.title = 'No opinion';
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

            // Why the gate exists, said once and without accusing the reader of
            // anything. Somebody refused by a rule they cannot see assumes the
            // page is broken.
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

    // --- SAVING ---

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

            // Withdrawal is a direct delete on the caller's own rows, which is
            // allowed even when voting is closed - taking your opinion back
            // should never be harder than giving it.
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

        // Reloaded rather than patched locally: the ranking has changed, and
        // the whole value of this page is that the number shown is the number
        // the database computed.
        await loadViewer();
        await loadRankings();
        render();
    }

    // --- RENDER ---

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

    // One delegated listener for the whole tool. Every control carries its
    // subject in a data- attribute, so nothing user-influenced is ever built
    // into markup.
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

        await loadScale();
        const rankingError = await loadRankings();
        await loadViewer();

        if (rankingError && notDeployed(rankingError)) {
            mount.appendChild(el('p', 'loading-msg',
                'The community ranking arrives with the next release.'));
            return;
        }

        // The scale comes from the database, and without it there are no rows
        // to draw the board into.
        if (!state.scale.length) {
            mount.appendChild(el('p', 'loading-msg',
                'The community ranking arrives with the next release.'));
            return;
        }

        wire(mount);
        render();
    });
})();
