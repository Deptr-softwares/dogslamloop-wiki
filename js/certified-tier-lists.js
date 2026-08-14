/**
 * Dogslamloop Wiki - Certified Tier Lists (v0.14 item 3)
 *
 * The page held 22 tabs - one Overall plus 21 "vs <character>" tabs - and now
 * holds one tier list per assigned individual, credited by name. The model is
 * in supabase/migrations/20260813000005_certified_tier_lists.sql.
 *
 * WHY A NAMED LIST. Frame data is measurable and a tier list is opinion, and a
 * single unattributed ranking quietly presents the second as the first -
 * "the wiki says this character is S tier" is an argument nobody can win. A
 * named list is a claim somebody is accountable for, which is both more honest
 * and less brigade-able than an official-looking consensus.
 *
 * WHICH IS WHY A READER LANDS ON NOBODY. No list loads until a name is
 * clicked. That is the feature, not a loading state: there is no unattributed
 * default to mistake for the wiki's own opinion.
 *
 * A separate file from js/tierlist.js on purpose. That one still renders the
 * old desc_data.tabs shape for the admin preview and the existing editor, and
 * the old data is deliberately left in page_data rather than migrated away -
 * so both renderers have to keep working, and merging them would mean one
 * function with two data models and two permission stories.
 *
 * Lazy by construction: the picker needs a name and a timestamp per list, and
 * the placements are fetched only when a name is clicked. That falls out of
 * landing on nobody rather than being an optimisation on top of it.
 */

(function () {
    const state = {
        lists: [],
        roster: new Map(),   // page_id -> { name, url, image }
        activeSlug: null,
        loaded: new Map(),   // slug -> full row
    };

    const client = () => window.supabaseClient;
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function timeAgo(iso) {
        const then = new Date(iso).getTime();
        if (!then) return '';
        const days = Math.floor((Date.now() - then) / 86400000);
        if (days < 1) return 'updated today';
        if (days === 1) return 'updated yesterday';
        if (days < 30) return `updated ${days} days ago`;
        if (days < 365) return `updated ${Math.floor(days / 30)} months ago`;
        return `updated ${new Date(iso).toLocaleDateString()}`;
    }

    // --- ROSTER ---
    //
    // Keyed by page_id, which is what the new tiers store. The old tabs stored
    // navigation display slugs and relied on a normalizer that lowercased and
    // stripped punctuation; three entries only matched because the display
    // slug happened to agree. The migration rewrote them to the canonical key,
    // so this lookup is exact.
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
            console.warn('[TierLists] Could not read the roster:', e);
        }
    }

    function portrait(pageId) {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };

        const wrap = el('a', 'tier-portrait');
        wrap.href = meta.url ? rootPath + meta.url : '#';
        wrap.title = meta.name;

        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) {
            wrap.style.backgroundColor = window.CHARACTER_COLORS[meta.name];
        }

        // The name sits underneath and shows through if the portrait 404s,
        // which is the same trick the old renderer used and the reason an
        // unresolved key is visible rather than silently blank.
        wrap.appendChild(el('span', 'tier-portrait-name', meta.name));

        const img = document.createElement('img');
        img.className = 'tier-portrait-img';
        img.loading = 'lazy';
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        img.src = meta.image
            ? rootPath + meta.image
            : `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${encodeURIComponent(String(meta.name).replace(/[^a-zA-Z0-9]/g, ''))}Portrait.webp`;
        wrap.appendChild(img);

        return wrap;
    }

    // --- THE PAGE INTRODUCTION ---
    //
    // Owner-editable, and hidden the moment a person is picked. That hiding is
    // the point rather than a tidy-up: while somebody's list is open, the
    // introduction above it should be theirs, not the page's. Two introductions
    // stacked would make every list read as a subsection of the owner's page,
    // which is the opposite of what attributing them was for.
    function setPageIntroVisible(visible) {
        const section = document.getElementById('tier-page-intro');
        if (section) section.classList.toggle('hidden', !visible);
    }

    async function loadPageIntro() {
        const body = document.getElementById('tier-page-intro-body');
        if (!body || typeof window.generateHTMLForBlocks !== 'function') return;

        try {
            const { data, error } = await client()
                .from('tier_page_settings').select('intro').maybeSingle();
            // The markup already in the page is the fallback and matches what
            // the migration seeds, so a failed fetch leaves the reader with the
            // right words rather than a blank band.
            if (error || !data || !Array.isArray(data.intro) || !data.intro.length) return;
            body.innerHTML = window.generateHTMLForBlocks(data.intro);
            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
        } catch (e) {
            /* keep the fallback */
        }
    }

    // --- THE PICKER ---
    function renderPicker() {
        const nav = document.getElementById('tier-tabs-container');
        if (!nav) return;

        nav.innerHTML = '';
        nav.style.display = 'flex';

        if (!state.lists.length) {
            nav.appendChild(el('p', 'loading-msg', 'No tier lists have been published yet.'));
            return;
        }

        state.lists.forEach(list => {
            const btn = el('button', 'btn-manga btn-manga-slanted ctl-author-btn');
            btn.type = 'button';
            if (list.slug === state.activeSlug) btn.classList.add('active');
            // data- attribute plus one delegated listener: author names are
            // user-supplied and must never reach an inline handler.
            btn.dataset.listSlug = list.slug;

            const content = el('div', 'btn-manga-content');
            content.appendChild(el('span', 'btn-manga-text', list.author_name));
            // Gives a returning reader a reason to pick one list out of
            // several, which is the whole job of this row.
            content.appendChild(el('span', 'ctl-author-updated', timeAgo(list.updated_at)));
            btn.appendChild(content);

            nav.appendChild(btn);
        });
    }

    // The state a reader arrives in, and it is deliberate rather than empty.
    function renderNobodySelected() {
        const ui = document.getElementById('tier-list-ui');
        if (!ui) return;

        setPageIntroVisible(true);

        ui.innerHTML = '';
        const box = el('div', 'ctl-nobody');
        box.appendChild(el('p', 'ctl-nobody-title', 'Pick someone to read their list.'));
        box.appendChild(el('p', 'ctl-nobody-body',
            'Every list here belongs to one person and says so. There is no combined ranking, '
            + 'because a tier list is an opinion and averaging opinions into an official one is how '
            + 'a wiki starts arguing with itself.'));
        ui.appendChild(box);

        const log = document.getElementById('changelog-container');
        if (log) log.innerHTML = '';

        const section = document.getElementById('changelog-section');
        if (section) section.classList.add('hidden');
    }

    // --- ONE LIST ---
    async function showList(slug) {
        const ui = document.getElementById('tier-list-ui');
        if (!ui) return;

        state.activeSlug = slug;
        renderPicker();

        ui.innerHTML = '';
        ui.appendChild(el('p', 'loading-msg', 'Loading…'));

        let row = state.loaded.get(slug);
        if (!row) {
            const { data, error } = await client()
                .from('tier_lists')
                .select('*')
                .eq('slug', slug)
                .maybeSingle();

            if (error || !data) {
                ui.innerHTML = '';
                ui.appendChild(el('p', 'empty-tab-msg', 'That list could not be loaded.'));
                return;
            }
            row = data;
            state.loaded.set(slug, row);
        }

        setPageIntroVisible(false);

        ui.innerHTML = '';

        const header = el('div', 'ctl-header');
        header.appendChild(el('h2', 'ctl-author', row.author_name));
        if (row.blurb) header.appendChild(el('p', 'ctl-blurb', row.blurb));
        header.appendChild(el('span', 'ctl-updated', timeAgo(row.updated_at)));
        ui.appendChild(header);

        // Their introduction, above the tiers. Written by them and nobody
        // else - it never passes through the reviewer queue, because a signed
        // tier list is opinion rather than wiki content somebody approves.
        const intro = Array.isArray(row.intro) ? row.intro : [];
        if (intro.length && typeof window.generateHTMLForBlocks === 'function') {
            const box = el('section', 'ctl-intro');
            box.appendChild(el('h3', 'ctl-subheading', 'Tier List Introduction'));
            const body = el('div', 'ctl-intro-body');
            body.innerHTML = window.generateHTMLForBlocks(intro);
            box.appendChild(body);
            ui.appendChild(box);
            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
        }

        const tiers = Array.isArray(row.tiers) ? row.tiers : [];
        if (!tiers.length) {
            ui.appendChild(el('p', 'empty-tab-msg', 'This list has not been filled in yet.'));
        }

        tiers.forEach(tier => {
            const rowEl = el('div', 'ctl-row');

            const label = el('div', 'ctl-label', tier.name || '');
            if (tier.color) label.style.backgroundColor = tier.color;
            rowEl.appendChild(label);

            const chars = el('div', 'ctl-chars');
            (tier.characters || []).forEach(pageId => chars.appendChild(portrait(pageId)));
            if (!(tier.characters || []).length) {
                chars.appendChild(el('span', 'ctl-empty-note', 'nobody'));
            }
            rowEl.appendChild(chars);

            ui.appendChild(rowEl);
        });

        await renderChangelogAndReasoning(row);
    }

    async function renderChangelogAndReasoning(row) {
        const container = document.getElementById('changelog-container');
        const section = document.getElementById('changelog-section');
        if (!container) return;

        if (section) section.classList.remove('hidden');
        container.innerHTML = '';

        // Reasoning first: it is the argument, and the changelog is the
        // record of acting on it.
        const reasoning = Array.isArray(row.reasoning) ? row.reasoning : [];
        if (reasoning.length && typeof window.generateHTMLForBlocks === 'function') {
            const box = el('div', 'ctl-reasoning');
            box.appendChild(el('h3', 'ctl-subheading', 'Reasoning'));
            const body = el('div', 'ctl-reasoning-body');
            // The one innerHTML here, and it is the site's own block renderer
            // over content only an assigned author can write - the same path
            // every wiki page already uses for the same data.
            body.innerHTML = window.generateHTMLForBlocks(reasoning);
            box.appendChild(body);
            container.appendChild(box);
            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
        }

        const { data: changes } = await client()
            .from('tier_list_changes')
            .select('*')
            .eq('list_id', row.id)
            .order('created_at', { ascending: false })
            .limit(100);

        const box = el('div', 'ctl-changelog');
        box.appendChild(el('h3', 'ctl-subheading', 'Changelog'));

        if (!changes || !changes.length) {
            box.appendChild(el('p', 'ctl-empty-note', 'No moves recorded yet.'));
            container.appendChild(box);
            return;
        }

        changes.forEach(change => {
            const entry = el('div', 'ctl-change');

            const meta = el('div', 'ctl-change-head');
            const who = state.roster.get(change.character_id);
            meta.appendChild(el('span', 'ctl-change-char', who ? who.name : change.character_id));

            const move = change.from_tier && change.to_tier
                ? `${change.from_tier} → ${change.to_tier}`
                : (change.to_tier ? `added to ${change.to_tier}` : `removed from ${change.from_tier || '—'}`);
            meta.appendChild(el('span', 'ctl-change-move', move));
            meta.appendChild(el('span', 'ctl-change-date', new Date(change.created_at).toLocaleDateString()));
            entry.appendChild(meta);

            // Required by the schema, so it is always here to render.
            entry.appendChild(el('p', 'ctl-change-note', change.note));

            box.appendChild(entry);
        });

        container.appendChild(box);
    }

    // --- BOOT ---
    window.loadCertifiedTierLists = async function () {
        const ui = document.getElementById('tier-list-ui');
        if (!ui || !client()) return;

        await loadRoster();
        loadPageIntro();

        // Only what the picker needs. The placements are the bulk of the data
        // and are fetched per list on click.
        const { data, error } = await client()
            .from('tier_lists')
            .select('id, slug, author_name, blurb, updated_at, status')
            .eq('status', 'published')
            .order('updated_at', { ascending: false });

        if (error) {
            const nav = document.getElementById('tier-tabs-container');
            if (nav) nav.innerHTML = '';
            ui.innerHTML = '';
            // The normal state between writing a migration and the release
            // that applies it.
            const missing = error.code === 'PGRST205' || /schema cache/i.test(error.message || '');
            ui.appendChild(el('p', 'empty-tab-msg', missing
                ? 'The certified tier lists arrive with the next release.'
                : 'Tier lists could not be loaded.'));
            return;
        }

        state.lists = data || [];
        renderPicker();
        renderNobodySelected();

        const nav = document.getElementById('tier-tabs-container');
        if (nav && nav.dataset.wired !== 'true') {
            nav.dataset.wired = 'true';
            nav.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-list-slug]');
                if (!btn || !nav.contains(btn)) return;
                showList(btn.dataset.listSlug);
            });
        }

        // A shared link opens on the list it names. Read after the picker is
        // built so the chip is already there to mark active.
        const requested = new URLSearchParams(window.location.search).get('list');
        if (requested && state.lists.some(l => l.slug === requested)) await showList(requested);
    };

    window.showCertifiedTierList = showList;
})();
