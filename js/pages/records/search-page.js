/**
 * The Search page (search.html): where the wiki says something about a word. The
 * sidebar box takes you to a page or a section; this page shows those matches
 * first, then the prose that mentions it, with a snippet.
 * @since v0.19
 * @touches data/search-fulltext.json (fetched only here), window.__siteSearch
 *   (search.js), escapeHtml and escapeRegExp (site_utils.js)
 * @watch scoring, snippets and escaping come from search.js, so a query ranks the
 *   same in the box and on the page. Every snippet is contributor prose: escaped.
 * @see docs/records.md
 */

(function () {
    'use strict';

    const MAX_RESULTS = 60;
    const SNIPPET_RADIUS = 90;

    let fulltext = null;
    let fulltextFields = null;

    async function loadFulltext() {
        if (fulltext) return fulltext;
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const url = `${rootPath}data/search-fulltext.json`;
        const data = window.fetchJson
            ? await window.fetchJson(url, { cache: true })
            : await (await fetch(url)).json();

        if (!data || !Array.isArray(data.entries)) throw new Error('full-text index is malformed');

        fulltextFields = {};
        (data.fields || []).forEach((name, i) => { fulltextFields[name] = i; });
        fulltext = data;
        return fulltext;
    }

    /**
     * A window of text around the first match, the match marked, cut at word
     * boundaries: a section can run to thousands of characters.
     */
    function snippet(text, query) {
        const at = text.toLowerCase().indexOf(query);
        if (at === -1) return { before: text.slice(0, SNIPPET_RADIUS * 2), match: '', after: '' };

        let start = Math.max(0, at - SNIPPET_RADIUS);
        let end = Math.min(text.length, at + query.length + SNIPPET_RADIUS);
        if (start > 0) { const sp = text.indexOf(' ', start); if (sp !== -1 && sp < at) start = sp + 1; }
        if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at + query.length) end = sp; }

        return {
            before: (start > 0 ? '…' : '') + text.slice(start, at),
            match: text.slice(at, at + query.length),
            after: text.slice(at + query.length, end) + (end < text.length ? '…' : ''),
        };
    }

    function searchFulltext(rawQuery) {
        const query = String(rawQuery || '').trim().toLowerCase();
        if (!fulltext || query.length < 2) return [];

        const F = fulltextFields;
        const out = [];

        for (const row of fulltext.entries) {
            const text = row[F.text];
            const at = text.toLowerCase().indexOf(query);
            if (at === -1) continue;

            const page = fulltext.pages[row[F.page]];
            if (!page) continue;

            // Earlier in the section scores higher, and a whole word beats a match inside a
            // longer one: an order a reader can predict.
            const wholeWord = new RegExp(`\\b${window.escapeRegExp(query)}\\b`).test(text.toLowerCase());
            out.push({
                score: (wholeWord ? 40 : 0) - Math.min(at, 400) * 0.05,
                section: row[F.section],
                tabLabel: row[F.tabLabel],
                pageName: page.name,
                url: `${page.url}?tab=${encodeURIComponent(row[F.tab])}#${row[F.anchor]}`,
                snippet: snippet(text, query),
            });
        }

        out.sort((a, b) => b.score - a.score);
        return out;
    }

    function render(query) {
        const status = document.getElementById('search-page-status');
        const box = document.getElementById('search-page-results');
        const rootPath = window.getRootPath ? window.getRootPath() : './';

        if (!query || query.trim().length < 2) {
            status.textContent = 'Type at least two characters.';
            box.innerHTML = '';
            return;
        }

        // The search box's own matcher, so a query ranks the same in both places.
        const structural = window.__siteSearch ? window.__siteSearch.search(query) : [];
        const prose = searchFulltext(query).slice(0, MAX_RESULTS);

        const total = structural.length + prose.length;
        if (total === 0) {
            status.textContent = `Nothing matched “${query}”.`;
            box.innerHTML = '';
            return;
        }

        status.textContent = `${total} result${total === 1 ? '' : 's'} for “${query}”`;

        // Escaped at every interpolation: names, titles and prose are contributor text.
        const structuralHTML = structural.length ? `
            <h3 class="search-page-group">Pages and sections</h3>
            <ul class="search-page-list">
                ${structural.map(r => `
                    <li class="search-page-hit">
                        <a class="search-page-hit-link" href="${window.escapeHtml(rootPath + r.url)}">${window.escapeHtml(r.name)}</a>
                        <span class="search-page-hit-where">${r.kind === 'page'
                            ? window.escapeHtml(r.type || 'page')
                            : `${window.escapeHtml(r.pageName)} &middot; ${window.escapeHtml(r.tabLabel || r.tab)}`}</span>
                    </li>`).join('')}
            </ul>` : '';

        const proseHTML = prose.length ? `
            <h3 class="search-page-group">In the writing</h3>
            <ul class="search-page-list">
                ${prose.map(r => `
                    <li class="search-page-hit">
                        <a class="search-page-hit-link" href="${window.escapeHtml(rootPath + r.url)}">${window.escapeHtml(r.section)}</a>
                        <span class="search-page-hit-where">${window.escapeHtml(r.pageName)} &middot; ${window.escapeHtml(r.tabLabel)}</span>
                        <p class="search-page-snippet">${window.escapeHtml(r.snippet.before)}<mark>${window.escapeHtml(r.snippet.match)}</mark>${window.escapeHtml(r.snippet.after)}</p>
                    </li>`).join('')}
            </ul>` : '';

        box.innerHTML = structuralHTML + proseHTML;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (window.initSidebarToggle) window.initSidebarToggle();
        if (window.initMobileNav) window.initMobileNav();
        if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
        if (window.initAuthDock) window.initAuthDock();

        const input = document.getElementById('search-page-input');
        const form = document.getElementById('search-page-form');
        const status = document.getElementById('search-page-status');

        // ?q=, so a result page can be linked and shared.
        const params = new URLSearchParams(window.location.search);
        const initial = params.get('q') || '';
        if (initial) input.value = initial;

        try {
            await Promise.all([
                window.__siteSearch ? window.__siteSearch.loadIndex() : Promise.resolve(),
                loadFulltext(),
            ]);
        } catch (err) {
            status.textContent = 'The search index could not be loaded. Try reloading the page.';
            console.warn('search.html:', err);
            return;
        }

        status.textContent = initial ? '' : 'Type at least two characters.';
        if (initial) render(initial);

        let timer = null;
        const run = () => {
            const q = input.value;
            const url = new URL(window.location.href);
            if (q.trim()) url.searchParams.set('q', q); else url.searchParams.delete('q');
            window.history.replaceState({}, '', url);
            render(q);
        };

        input.addEventListener('input', () => {
            // Debounced: every keystroke scans all the prose, which a phone feels.
            clearTimeout(timer);
            timer = setTimeout(run, 120);
        });

        form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); run(); });

        // For the tests, which drive matching without the debounce.
        window.__searchPage = { render, searchFulltext, snippet, loadFulltext };
    });
})();
