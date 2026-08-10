/**
 * Dogslamloop Wiki - 404 rescue: render a page that exists but has no file yet
 *
 * The problem this solves, in the owner's words: "I have no idea why there is
 * this regeneration thing here that is blocking my feedback loop."
 *
 * Creating a page writes a row to `site_pages` immediately. But GitHub Pages
 * serves a URL only if a real file sits at that path, and those files come
 * from scripts/generate-pages.js - which runs on a workflow, not on save. So
 * between creating a page and the next regeneration run, its URL 404s even
 * though the page fully exists and its content is editable.
 *
 * The diagnosis that matters: the gate was never navigation.json, which is why
 * moving the registry to the cloud would not have helped. It is the file.
 *
 * GitHub Pages serves 404.html for any unmatched path, so this asks the
 * registry what is supposed to live at the requested URL and, if the answer is
 * a live page, renders it right there. The page works the moment it is
 * created; regeneration then only matters for crawlers, which is exactly what
 * it is for.
 *
 * Deliberately NOT a substitute for regenerating:
 *   - The response is still HTTP 404, so search engines and Discord unfurlers
 *     will not index it. That is correct - an unpublished page should not be
 *     indexed - and it is why the banner says the page is not published yet
 *     rather than pretending everything is fine.
 *   - Nothing here writes anything. A failed lookup falls through to the
 *     ordinary 404, which is the honest answer when a URL really is wrong.
 */

(function () {
    // Every URL form the same page can be reached by. GitHub Pages resolves a
    // directory to its index.html, and people paste all three.
    function candidatePaths(pathname) {
        const clean = String(pathname || '').replace(/^\/+/, '').split(/[?#]/)[0];
        if (!clean) return [];

        const withoutIndex = clean.replace(/\/?index\.html$/, '');
        const bare = withoutIndex.replace(/\/+$/, '');
        if (!bare) return [];

        return Array.from(new Set([clean, `${bare}/index.html`, bare]));
    }

    window.rescueCandidatePaths = candidatePaths;

    async function findLivePage(pathname) {
        const candidates = candidatePaths(pathname);
        if (candidates.length === 0 || !window.supabaseClient) return null;

        let data, error;
        try {
            // try/catch as well as the error field: Supabase reports a query
            // failure in `error`, but a client that cannot reach the network at
            // all throws. Both mean the same thing here - we do not know what
            // is at this URL - and both must land on the ordinary 404 rather
            // than an unhandled rejection.
            ({ data, error } = await window.supabaseClient
                .from('site_pages')
                .select('page_id, name, url, page_type, status')
                .in('url', candidates));
        } catch (err) {
            console.warn('[404] Could not reach the page registry:', err);
            return null;
        }

        if (error || !Array.isArray(data)) return null;

        // Archived pages get a tombstone from the generator and must keep
        // getting one - rescuing them would undo an explicit decision.
        return data.find(row => row && row.status === 'live') || null;
    }

    window.findLivePageForPath = findLivePage;

    function unpublishedBanner(row) {
        const banner = document.createElement('div');
        banner.className = 'rescue-banner';
        banner.id = 'rescue-banner';

        // textContent throughout: name and url are owner-authored but reach
        // this through a database row, and the rule here is to escape at every
        // interpolation rather than reason about who typed what.
        const strong = document.createElement('strong');
        strong.textContent = 'Not published yet.';

        const text = document.createElement('span');
        text.textContent = ` This page exists and is editable, but its file has not been generated, `
            + `so search engines and Discord previews cannot see it. It will publish itself on the next regeneration run.`;

        banner.append(strong, text);
        return banner;
    }

    // pathname is a parameter, defaulting to the real one, purely so this is
    // drivable: the local test server serves its own error page rather than
    // 404.html, so a spec cannot reach this by navigating to a missing URL the
    // way GitHub Pages would. Everything below is the real path either way.
    window.initPageRescue = async function (pathname) {
        const row = await findLivePage(pathname || window.location.pathname);
        if (!row) return false;

        const route = {
            pageId: row.page_id,
            pageType: row.page_type,
            title: row.name || row.page_id,
        };
        window.PAGE_ROUTE = route;
        document.title = `${route.title} | Dogslamloop Wiki`;

        // '/' rather than the router's usual '../../': 404.html is served for
        // a URL at any depth and carries <base href="/">, so the only correct
        // root here is the site root.
        const skeleton = window.buildPageSkeleton(route, '/');
        if (!skeleton) return false;

        // Replace the 404's own chrome rather than nesting a second copy of it
        // inside the first. The scripts live further down the body and have
        // already run, so removing these takes nothing with it.
        document.querySelectorAll('.mobile-top-bar, .mobile-backdrop, .site-layout').forEach(el => el.remove());
        document.body.insertAdjacentHTML('afterbegin', skeleton);

        await window.runPageBoot(route);

        const main = document.querySelector('.main-content-area');
        if (main) main.insertBefore(unpublishedBanner(row), main.firstChild);

        return true;
    };
})();
