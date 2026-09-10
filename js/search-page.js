/**
 * Dogslamloop Wiki - search.html (v0.19 F1b, full-text results)
 *
 * The other half of the split the owner asked for: the sidebar box answers
 * "take me to that page or section", this page answers "where does the wiki
 * say something about X".
 *
 * It searches BOTH indexes and shows them together - structural hits first,
 * because a page or a section is a better answer than a paragraph whenever one
 * matches, then the prose. Searching only full text here would make the
 * dedicated search page worse than the box in the sidebar at finding a
 * character, which is the most common thing anybody looks for.
 *
 * The full-text index is 332 KB raw / 105 KB gzipped and is fetched ONLY here.
 * That is the whole reason it is a second file: paying it on every page view,
 * for a feature most visits never touch, is what the split avoids.
 *
 * Scoring, snippet extraction and escaping are shared with js/search.js via
 * window.__siteSearch rather than reimplemented - two rankers that disagree
 * would make the same query mean different things in the box and on the page.
 */

(function () {
    'use strict';

    const MAX_RESULTS = 60;
    const SNIPPET_RADIUS = 90;

    let fulltext = null;
    let fulltextFields = null;

    const esc = (v) => (typeof window.escapeHtml === 'function'
        ? window.escapeHtml(v)
        : String(v == null ? '' : v).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

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
     * A window of text around the first match, with the match marked.
     *
     * Built by slicing rather than by replacing across the whole blob: a
     * section can be several thousand characters, and a result list that
     * printed all of it would be unreadable and enormous. Word boundaries are
     * respected at both ends so the snippet does not start mid-word.
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

            // Earlier in the section scores higher, and a whole-word match beats
            // one inside a longer word. Deliberately simple: the alternative is
            // a real relevance model, and with 595 sections a plain ordering
            // that the reader can predict beats one they cannot.
            const wholeWord = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text.toLowerCase());
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

        // Structural first - the searchbar's own matcher, so the same query
        // ranks the same way in both places.
        const structural = window.__siteSearch ? window.__siteSearch.search(query) : [];
        const prose = searchFulltext(query).slice(0, MAX_RESULTS);

        const total = structural.length + prose.length;
        if (total === 0) {
            status.textContent = `Nothing matched “${query}”.`;
            box.innerHTML = '';
            return;
        }

        status.textContent = `${total} result${total === 1 ? '' : 's'} for “${query}”`;

        // Escaped at every interpolation. Page names, section titles and body
        // text are all contributor-authored, and the snippet is a slice of raw
        // prose - the highest-volume untrusted string on the site.
        const structuralHTML = structural.length ? `
            <h3 class="search-page-group">Pages and sections</h3>
            <ul class="search-page-list">
                ${structural.map(r => `
                    <li class="search-page-hit">
                        <a class="search-page-hit-link" href="${esc(rootPath + r.url)}">${esc(r.name)}</a>
                        <span class="search-page-hit-where">${r.kind === 'page'
                            ? esc(r.type || 'page')
                            : `${esc(r.pageName)} &middot; ${esc(r.tabLabel || r.tab)}`}</span>
                    </li>`).join('')}
            </ul>` : '';

        const proseHTML = prose.length ? `
            <h3 class="search-page-group">In the writing</h3>
            <ul class="search-page-list">
                ${prose.map(r => `
                    <li class="search-page-hit">
                        <a class="search-page-hit-link" href="${esc(rootPath + r.url)}">${esc(r.section)}</a>
                        <span class="search-page-hit-where">${esc(r.pageName)} &middot; ${esc(r.tabLabel)}</span>
                        <p class="search-page-snippet">${esc(r.snippet.before)}<mark>${esc(r.snippet.match)}</mark>${esc(r.snippet.after)}</p>
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

        // ?q= so a result page can be linked and shared, and so the sidebar box
        // can hand a query over to this page later without a second design.
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
            // Debounced: every keystroke scans 595 sections of prose, and on a
            // phone that is enough work to make typing feel sticky.
            clearTimeout(timer);
            timer = setTimeout(run, 120);
        });

        form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); run(); });

        // Exposed for tests, which need to drive matching without the debounce.
        window.__searchPage = { render, searchFulltext, snippet, loadFulltext };
    });
})();
