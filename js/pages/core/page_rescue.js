/**
 * The 404 rescue. On 404.html it asks site_pages what should live at the requested
 * address and, for a live page whose stub is not generated yet, draws that page
 * there with a "Not published yet" banner. A new page works the moment it is
 * created; regeneration then matters only for crawlers.
 * @since v0.12
 * @touches site_pages (page_id, name, url, page_type, status), buildPageSkeleton,
 *   runPageBoot
 * @watch the response is still a 404, so search engines and Discord previews do
 *   not index the page, and the banner says so. It writes nothing, and a failed
 *   lookup falls through to the ordinary 404.
 * @see docs/page-shell.md
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
            // try/catch as well as the error field: a client with no network throws. Either
            // way the address is unknown, and the ordinary 404 shows.
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

    function unpublishedBanner() {
        const banner = window.siteBanner({
            tone: 'yellow',
            title: 'Not published yet',
            text: 'This page exists and is editable, but its file has not been generated, '
                + 'so search engines and Discord previews cannot see it. It will publish itself on the next regeneration run.',
            className: 'rescue-banner',
        });
        banner.id = 'rescue-banner';
        return banner;
    }

    /**
     * Draws the page that lives at pathname, if site_pages has a live one there, and
     * returns whether it did.
     * @watch pathname is a parameter only so a spec can drive it: the test server
     *   serves its own error page, not 404.html
     */
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

        // '/': 404.html is served at any depth and carries <base href="/">.
        const skeleton = window.buildPageSkeleton(route, '/');
        if (!skeleton) return false;

        // Replace the 404's own chrome rather than nesting a second copy of it
        // inside the first. The scripts live further down the body and have
        // already run, so removing these takes nothing with it.
        document.querySelectorAll('.mobile-top-bar, .mobile-backdrop, .site-layout').forEach(el => el.remove());
        document.body.insertAdjacentHTML('afterbegin', skeleton);

        await window.runPageBoot(route);

        const main = document.querySelector('.main-content-area');
        if (main) main.insertBefore(unpublishedBanner(), main.firstChild);

        return true;
    };
})();
