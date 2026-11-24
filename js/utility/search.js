/**
 * The search box in the left sidebar: a typeahead over data/search-index.json, with
 * every page name, section heading and move name, each result linked to its tab
 * and section. Body text is search.html's, which has its own index.
 * @since v0.19
 * @touches data/search-index.json (fetched on first focus, then kept for the page),
 *   buildGlobalSidebarMenu (which calls initSiteSearch)
 * @watch a result's anchor comes from collectSectionTargets, the function behind
 *   the page's own anchors, so ?tab=...#sec-... lands on a real element
 * @see docs/page-shell.md
 */

(function () {
    'use strict';

    let index = null;          // { fields, pages, entries } once loaded
    let loading = null;        // in-flight promise, so two focuses fetch once
    let results = [];
    let activeIdx = -1;

    // Positions in an entry array. The file declares these in `fields`; read
    // from there rather than hard-coding, so a column added to the generator
    // does not silently shift what this reads.
    let F = { title: 0, tab: 1, tabLabel: 2, anchor: 3, page: 4, parent: 5 };

    async function loadIndex() {
        if (index) return index;
        if (loading) return loading;

        const rootPath = window.getRootPath ? window.getRootPath() : './';
        loading = (async () => {
            const url = `${rootPath}data/search-index.json`;
            const data = window.fetchJson
                ? await window.fetchJson(url, { cache: true })
                : await (await fetch(url)).json();

            if (!data || !Array.isArray(data.entries) || !Array.isArray(data.pages)) {
                throw new Error('search index is malformed');
            }
            if (Array.isArray(data.fields)) {
                const pos = {};
                data.fields.forEach((name, i) => { pos[name] = i; });
                // Only adopt it if every field this code needs is present -
                // a partial map would read undefined positions as titles.
                if (['title', 'tab', 'tabLabel', 'anchor', 'page', 'parent']
                    .every(k => typeof pos[k] === 'number')) F = pos;
            }
            index = data;
            return index;
        })();

        try { return await loading; } finally { loading = null; }
    }

    /**
     * One candidate's score against the query, or -1. Ranked, not filtered: exact,
     * then starts with, then a word starts with, then anywhere.
     */
    function score(text, query) {
        const t = text.toLowerCase();
        if (t === query) return 100;
        if (t.startsWith(query)) return 80 - Math.min(t.length - query.length, 20) * 0.5;
        // Word-start: "dom" should find "Domain Expansion" but also "Reverse
        // Domain", and both beat a match in the middle of a word.
        const wordStart = t.indexOf(' ' + query);
        if (wordStart !== -1) return 60 - Math.min(wordStart, 20) * 0.5;
        const anywhere = t.indexOf(query);
        if (anywhere !== -1) return 30 - Math.min(anywhere, 20) * 0.5;
        return -1;
    }

    function search(rawQuery) {
        const query = String(rawQuery || '').trim().toLowerCase();
        if (!index || query.length < 2) return [];

        const out = [];

        // Pages first and weighted up. Searching a character's name almost
        // always means "take me to that character", not "show me the twelve
        // sections that mention them".
        index.pages.forEach((page, i) => {
            const s = score(page.name, query);
            if (s >= 0) out.push({ kind: 'page', score: s + 25, name: page.name, type: page.type, page: i, url: page.url });
        });

        index.entries.forEach(entry => {
            const s = score(entry[F.title], query);
            if (s < 0) return;
            const page = index.pages[entry[F.page]];
            if (!page) return;
            out.push({
                kind: 'section',
                score: s,
                name: entry[F.title],
                parent: entry[F.parent],
                tab: entry[F.tab],
                tabLabel: entry[F.tabLabel],
                pageName: page.name,
                url: `${page.url}?tab=${encodeURIComponent(entry[F.tab])}#${entry[F.anchor]}`,
            });
        });

        out.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
        return out.slice(0, 12);
    }

    // The way from the box to search.html: the box indexes no body text, so "no
    // matches" often means "it is in a paragraph". Shown on every render, the empty one
    // too.
    function moreLink(rootPath, query) {
        return `<a class="site-search-more" href="${window.escapeHtml(rootPath)}search.html?q=${encodeURIComponent(query)}">
                    Search all writing for “${window.escapeHtml(query)}” &rarr;
                </a>`;
    }

    function render(panel, rootPath, query) {
        if (!results.length) {
            panel.innerHTML = '<div class="site-search-empty">No pages or sections matched.</div>'
                + moreLink(rootPath, query);
            panel.classList.remove('hidden');
            return;
        }

        // Titles and names come from page_data through the index, unescaped.
        panel.innerHTML = results.map((r, i) => {
            const where = r.kind === 'page'
                ? `<span class="site-search-kind">${window.escapeHtml(r.type || 'page')}</span>`
                : `<span class="site-search-where">${window.escapeHtml(r.pageName)} &middot; ${window.escapeHtml(r.tabLabel || r.tab)}</span>`;
            const sub = r.kind === 'section' && r.parent
                ? `<span class="site-search-parent">in ${window.escapeHtml(r.parent)}</span>`
                : '';
            return `
                <a class="site-search-hit${i === activeIdx ? ' is-active' : ''}"
                   href="${window.escapeHtml(rootPath + r.url)}" data-hit="${i}">
                    <span class="site-search-title">${window.escapeHtml(r.name)}</span>
                    ${sub}
                    ${where}
                </a>`;
        }).join('') + moreLink(rootPath, query);
        panel.classList.remove('hidden');
    }

    /**
     * Builds the search box above the navigation list. Added by script rather than
     * shipped in every page's markup, so it is written once; buildGlobalSidebarMenu
     * calls it on every page.
     */
    window.initSiteSearch = function (navContainerId) {
        const nav = document.getElementById(navContainerId || 'global-sidebar-nav');
        // A page with no sidebar (404, an embed) simply has no search. Silent:
        // there is nothing for the reader to act on.
        if (!nav || document.getElementById('site-search-input')) return;

        const rootPath = window.getRootPath ? window.getRootPath() : './';

        const wrap = document.createElement('div');
        wrap.className = 'site-search';
        wrap.innerHTML = `
            <label class="sr-only" for="site-search-input">Search the wiki</label>
            <input type="search" id="site-search-input" class="site-search-input"
                   placeholder="Search the wiki..." autocomplete="off" spellcheck="false"
                   role="combobox" aria-autocomplete="list"
                   aria-controls="site-search-results" aria-expanded="false">
            <div id="site-search-results" class="site-search-results hidden" role="listbox"></div>`;
        nav.parentNode.insertBefore(wrap, nav);

        const input = wrap.querySelector('#site-search-input');
        const panel = wrap.querySelector('#site-search-results');

        const close = () => {
            panel.classList.add('hidden');
            input.setAttribute('aria-expanded', 'false');
            activeIdx = -1;
        };

        const run = () => {
            results = search(input.value);
            activeIdx = results.length ? 0 : -1;
            if (!input.value.trim()) { close(); return; }
            render(panel, rootPath, input.value.trim());
            input.setAttribute('aria-expanded', 'true');
        };

        // First focus pays for the index; every keystroke after is local.
        input.addEventListener('focus', () => {
            loadIndex().then(() => { if (input.value.trim()) run(); })
                .catch(err => console.warn('Search index unavailable:', err));
        }, { once: false });

        input.addEventListener('input', () => {
            if (!index) { loadIndex().then(run).catch(() => {}); return; }
            run();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { close(); input.blur(); return; }
            if (!results.length) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
                render(panel, rootPath, input.value.trim());
                return;
            }
            if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault();
                window.location.href = rootPath + results[activeIdx].url;
            }
        });

        panel.addEventListener('mousedown', (e) => {
            const hit = e.target.closest('.site-search-hit');
            if (!hit) return;
            const i = parseInt(hit.getAttribute('data-hit'), 10);
            if (!Number.isNaN(i) && results[i]) {
                e.preventDefault();
                window.location.href = rootPath + results[i].url;
            }
        });

        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) close();
        });
    };

    // Exposed for tests and for search.html (F1b), which needs the same
    // matching over a different index rather than a second implementation.
    window.__siteSearch = { loadIndex, search, score };
})();
