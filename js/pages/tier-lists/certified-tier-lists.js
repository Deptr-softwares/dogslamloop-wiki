/**
 * Certified Tier Lists, the Tier List page: one tier list per assigned person,
 * credited by name. A reader picks a name and nothing loads until then, so there is
 * no unattributed list to mistake for the wiki's own opinion. Each list's
 * placements are fetched when its name is clicked.
 * @since v0.14
 * @touches tier_lists, tier_list_changes, tier_page_settings, loadCharacterRoster
 *   (site_data.js)
 * @watch kept apart from tierlist.js, which renders the older desc_data.tabs shape
 *   still in page_data: two data models and two permission stories
 * @see docs/tier-lists.md
 */

(function () {
    const state = {
        lists: [],
        roster: new Map(),   // page_id -> { name, url, image }
        activeSlug: null,
        loaded: new Map(),   // slug -> full row
        entryByKey: new Map(), // the open list's entries by key
    };

    const client = () => window.supabaseClient;

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

    // Keyed by page_id, which the tiers store, through loadCharacterRoster, shared by
    // every tier list.
    async function loadRoster() {
        if (state.roster.size) return;
        state.roster = await window.loadCharacterRoster();
    }

    // `style` is the list's own art_style, 'portrait' or 'icon', passed per call since
    // two lists in one session can differ. An unknown value draws the portrait (the
    // database CHECK keeps them out). `raw` is one tiers[].characters entry: a page_id,
    // a badged character or a copy (tierListEntry); anything else is not drawn.
    function portrait(raw, style) {
        const entry = window.tierListEntry(raw);
        if (!entry) return null;
        const pageId = entry.id;
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };
        const useIcon = style === 'icon';

        const wrap = el('a', 'tier-portrait');
        if (useIcon) wrap.classList.add('tier-portrait-icon');
        wrap.href = meta.url ? rootPath + meta.url : '#';
        wrap.title = meta.name;
        // So the changelog can find this portrait once it has loaded, by key, so each copy
        // carries its own last move.
        wrap.dataset.ctlChar = entry.key;

        // In icon mode the colour moves from the fill to the border, as on the roster
        // cards, as a custom property, since an inline style would beat Layout.css.
        const charColor = window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name];
        if (charColor) {
            if (useIcon) wrap.style.setProperty('--char-color', charColor);
            else wrap.style.backgroundColor = charColor;
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

        // The icon path from rosterIconPath, as on the roster, so an icon the owner adds
        // shows here at once. No icon: the img hides and the name shows.
        const iconPath = useIcon && typeof window.rosterIconPath === 'function'
            ? window.rosterIconPath(pageId)
            : null;
        // Hides the name, which showed through the icon's clear parts
        // (style/Layout.css). Only once it has loaded, so a missing icon still
        // shows the name.
        if (iconPath) img.addEventListener('load', () => wrap.classList.add('is-icon-loaded'));

        img.src = iconPath
            ? rootPath + iconPath
            : (meta.image
                ? rootPath + meta.image
                : `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${encodeURIComponent(String(meta.name).replace(/[^a-zA-Z0-9]/g, ''))}Portrait.webp`);
        wrap.appendChild(img);

        const badge = window.tierBadgeElement(entry);
        if (badge) wrap.appendChild(badge);

        return wrap;
    }

    // A changelog row names its character the way the board shows it: a copy
    // by its badge ("Vessel [Ult]"), and a copy deleted since as "(copy)".
    function labelledName(key) {
        const entry = state.entryByKey.get(key);
        const id = entry ? entry.id : String(key).split('#')[0];
        const who = state.roster.get(id);
        const name = who ? who.name : id;
        if (entry && entry.label) return `${name} [${entry.label}]`;
        return String(key).includes('#') ? `${name} (copy)` : name;
    }

    // How one move reads, in one place, for the changelog and the portrait tooltip. A
    // NULL from_tier is newly placed, a NULL to_tier removed.
    function moveLabel(change) {
        if (change.from_tier && change.to_tier) return `${change.from_tier} → ${change.to_tier}`;
        if (change.to_tier) return `added to ${change.to_tier}`;
        return `removed from ${change.from_tier || '-'}`;
    }

    // Hovering a portrait shows its character's most recent move, from the changelog
    // rows in hand: they arrive newest first, so the first one seen is the latest. No
    // change recorded: no tooltip.
    function attachPortraitChangeTooltips(changes) {
        const ui = document.getElementById('tier-list-ui');
        if (!ui || typeof window.bindTooltip !== 'function') return;

        const latest = new Map();
        (changes || []).forEach(change => {
            if (!latest.has(change.character_id)) latest.set(change.character_id, change);
        });

        ui.querySelectorAll('[data-ctl-char]').forEach(portraitEl => {
            const change = latest.get(portraitEl.dataset.ctlChar);
            if (!change) return;

            const when = new Date(change.created_at);
            const date = isNaN(when) ? '' : when.toLocaleDateString();

            // bindTooltip assigns innerHTML, so every value here is escaped.
            // The note and the author name are written by whoever owns the
            // list, which makes them contributor content on a public page.
            let html = `<div class="ctl-tip-move">${window.escapeHtml(moveLabel(change))}</div>`;
            if (date) html += `<div class="ctl-tip-date">${window.escapeHtml(date)}</div>`;
            html += `<div class="ctl-tip-note">${window.escapeHtml(change.note)}</div>`;
            if (change.author_name) {
                html += `<div class="ctl-tip-author">- ${window.escapeHtml(change.author_name)}</div>`;
            }

            // The native tooltip would otherwise sit on top of this one. The
            // name is not lost: it is rendered under the portrait already.
            portraitEl.removeAttribute('title');
            window.bindTooltip(portraitEl, html);
        });
    }

    // The page's introduction, hidden while a person's list is open: the introduction
    // above a list should be theirs.
    function setPageIntroVisible(visible) {
        const section = document.getElementById('tier-page-intro');
        if (section) section.classList.toggle('hidden', !visible);
    }

    // The sidebar's contents, after every change to what is showing.
    function refreshContents() {
        if (typeof window.refreshTOC === 'function') window.refreshTOC();
    }

    // The introduction lives only in tier_page_settings. The page ships "Loading...",
    // and this always replaces it: the introduction, nothing, or a line when it cannot
    // be read.
    async function loadPageIntro() {
        const body = document.getElementById('tier-page-intro-body');
        if (!body) return;
        const failed = () => {
            body.innerHTML = '<p class="loading-msg">Could not load this text. Try reloading the page.</p>';
        };
        if (typeof window.generateHTMLForBlocks !== 'function') { failed(); return; }

        try {
            const { data, error } = await client()
                .from('tier_page_settings').select('intro').maybeSingle();
            if (error) { failed(); return; }
            if (!data || !Array.isArray(data.intro) || !data.intro.length) { body.innerHTML = ''; return; }
            body.innerHTML = window.generateHTMLForBlocks(data.intro);
            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
        } catch (e) {
            failed();
        } finally {
            refreshContents();
        }
    }

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
        ui.appendChild(box);

        const log = document.getElementById('changelog-container');
        if (log) log.innerHTML = '';

        const section = document.getElementById('changelog-section');
        if (section) section.classList.add('hidden');
        refreshContents();
    }

    async function showList(slug) {
        const ui = document.getElementById('tier-list-ui');
        if (!ui) return;

        state.activeSlug = slug;
        renderPicker();

        ui.innerHTML = '';
        ui.appendChild(el('p', 'loading-msg loading-msg-busy', 'Loading…'));

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

        const stamp = el('div', 'ctl-stamp');
        stamp.appendChild(el('span', 'ctl-updated', timeAgo(row.updated_at)));
        // The game version beside "updated 3 weeks ago": a reader deciding whether a
        // ranking holds needs the patch it was written against. Absent when the author has
        // not said.
        if (row.game_version) {
            stamp.appendChild(el('span', 'ctl-game-version', row.game_version));
        }
        header.appendChild(stamp);
        ui.appendChild(header);

        // Their introduction, above the tiers, written by them alone: a signed tier list is
        // opinion, so it never passes through the review queue.
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

        const labels = [];
        // Every entry on this list by its key, for the changelog's names.
        state.entryByKey = new Map();
        tiers.forEach(tier => {
            const rowEl = el('div', 'ctl-row');

            const label = el('div', 'ctl-label', tier.name || '');
            if (tier.color) label.style.backgroundColor = tier.color;
            rowEl.appendChild(label);
            labels.push(label);

            const chars = el('div', 'ctl-chars');
            (Array.isArray(tier.characters) ? tier.characters : []).forEach(raw => {
                const node = portrait(raw, row.art_style);
                if (!node) return;
                const entry = window.tierListEntry(raw);
                state.entryByKey.set(entry.key, entry);
                chars.appendChild(node);
            });
            if (!chars.children.length) {
                chars.appendChild(el('span', 'ctl-empty-note', 'nobody'));
            }
            rowEl.appendChild(chars);

            ui.appendChild(rowEl);
        });

        fitTierLabels();

        await renderChangelogAndReasoning(row);
        refreshContents();
    }

    // Long tier names fit on one line, one size for every tier, since the labels are a
    // scale. A deliberate twin of tier-editor.js's: the two files share no dependency,
    // and site_utils.js, which every page loads, is no place for it.
    const TIER_LABEL_MAX_REM = 1.5;
    const TIER_LABEL_MIN_REM = 0.6;

    // Measured with a Range over the text rather than by scrollWidth: the box
    // is a centred flex container, so an oversized name spills out of BOTH
    // sides and scrollWidth counts only the right-hand half.
    function labelOverflows(label) {
        const style = getComputedStyle(label);
        const available = label.clientWidth
            - parseFloat(style.paddingLeft || 0)
            - parseFloat(style.paddingRight || 0);
        if (!(available > 0)) return false;

        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getBoundingClientRect().width > available + 1;
    }

    function tierLabels() {
        return Array.prototype.slice.call(
            document.querySelectorAll('#tier-list-ui .ctl-row .ctl-label'));
    }

    function fitTierLabels() {
        const labels = tierLabels();
        if (!labels.length) return;

        labels.forEach(label => {
            label.style.fontSize = '';
            label.style.whiteSpace = 'nowrap';
        });

        const tooWide = () => labels.some(labelOverflows);

        let size = TIER_LABEL_MAX_REM;
        while (tooWide() && size > TIER_LABEL_MIN_REM) {
            size = Math.round((size - 0.1) * 10) / 10;
            labels.forEach(label => { label.style.fontSize = size + 'rem'; });
        }

        if (tooWide()) {
            labels.forEach(label => { label.style.whiteSpace = ''; });
        }
    }

    // Fitted again once the web font is in, and on resize: measured against the
    // fallback font, a long name settles on the wrong size.
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(() => fitTierLabels());
    }
    let ctlRefitTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(ctlRefitTimer);
        ctlRefitTimer = setTimeout(fitTierLabels, 120);
    });

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

        // One query for the whole board's tooltips, newest first, of its own since the
        // changelog went to pages, so a character whose last move is on page 3 still gets
        // one.
        const { data: recent } = await client()
            .from('tier_list_changes')
            .select('character_id, from_tier, to_tier, note, author_name, created_at')
            .eq('list_id', row.id)
            .order('created_at', { ascending: false })
            .limit(100);
        attachPortraitChangeTooltips(recent);

        const box = el('div', 'ctl-changelog');
        box.appendChild(el('h3', 'ctl-subheading', 'Changelog'));
        container.appendChild(box);
        await drawChangelogPage(box, row.id, 0);
    }

    // The changelog, 20 moves a page, newest first.
    const CHANGELOG_PAGE_SIZE = 20;

    async function drawChangelogPage(box, listId, page) {
        // Ordered by created_at AND id, so two moves saved in the same instant
        // cannot swap pages. The count rides on the same request.
        const { data, count } = await client()
            .from('tier_list_changes')
            .select('*', { count: 'exact' })
            .eq('list_id', listId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(page * CHANGELOG_PAGE_SIZE, page * CHANGELOG_PAGE_SIZE + CHANGELOG_PAGE_SIZE - 1);
        const changes = data || [];

        box.querySelectorAll(':scope > .ctl-change, :scope > .ctl-empty-note, :scope > .ctl-pager')
            .forEach(node => node.remove());

        // A page emptied since it was offered goes back to the newest.
        if (!changes.length && page > 0) return drawChangelogPage(box, listId, 0);
        if (!changes.length) {
            box.appendChild(el('p', 'ctl-empty-note', 'No moves recorded yet.'));
            return;
        }

        changes.forEach(change => {
            const entry = el('div', 'ctl-change');

            const meta = el('div', 'ctl-change-head');
            meta.appendChild(el('span', 'ctl-change-char', labelledName(change.character_id)));

            meta.appendChild(el('span', 'ctl-change-move', moveLabel(change)));
            meta.appendChild(el('span', 'ctl-change-date', new Date(change.created_at).toLocaleDateString()));
            entry.appendChild(meta);

            // Required by the schema, so it is always here to render.
            entry.appendChild(el('p', 'ctl-change-note', change.note));

            box.appendChild(entry);
        });

        const pages = typeof count === 'number'
            ? Math.max(1, Math.ceil(count / CHANGELOG_PAGE_SIZE))
            : (changes.length === CHANGELOG_PAGE_SIZE ? page + 2 : page + 1);
        if (pages < 2) return;

        // Listeners on the buttons themselves: they are built here, with the
        // list's id in hand, and never carry anything user-written.
        const pager = el('div', 'ctl-pager');
        const go = (label, to) => {
            const btn = el('button', 'btn-sys btn-sys-regular ctl-page-btn', label);
            btn.type = 'button';
            btn.addEventListener('click', async () => {
                await drawChangelogPage(box, listId, to);
                box.scrollIntoView({ behavior: window.scrollMotion(), block: 'start' });
            });
            pager.appendChild(btn);
        };
        if (page > 0) go('NEWER', page - 1);
        pager.appendChild(el('span', 'ctl-page-label', `Page ${page + 1} of ${pages}`));
        if (page < pages - 1) go('OLDER', page + 1);
        box.appendChild(pager);
    }

    window.loadCertifiedTierLists = async function () {
        const ui = document.getElementById('tier-list-ui');
        if (!ui) return;
        // First, before anything can return: the introduction ships
        // "Loading..." and has to be replaced whatever happens below.
        loadPageIntro();
        if (!client()) return;

        await loadRoster();

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
})();
