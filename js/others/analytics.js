/**
 * Visitor counting (Umami Cloud), on reader pages only: page views and nothing
 * more, on dogslamloop.com only, without the ?query or #hash, not for a browser
 * that sends Do Not Track, and not for a reader who unticked "Count my visits" in
 * Site Settings, for whom Umami is never loaded. No speed data, errors or clicks.
 * @since v1.2
 * @touches the Umami Cloud script, window.siteSettings (countVisits)
 * @watch the privacy policy says what is collected, so a change here changes the
 *   policy too. Deferred after site_utils.js, so the setting is there to read; it
 *   only adds Umami's script, async, so it never holds the page up.
 * @see docs/shared-code.md
 */
(function () {
    // The Website ID from Umami Cloud: not a secret, it is in every Umami site's
    // source. Empty turns the counting off.
    const WEBSITE_ID = 'd53106ba-6b61-4ad7-8ae1-24ce62d4c32d';
    const SITE = 'dogslamloop.com';

    if (!WEBSITE_ID || window.location.hostname !== SITE || !window.siteSettings.get('countVisits')) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://cloud.umami.is/script.js';
    script.setAttribute('data-website-id', WEBSITE_ID);
    script.setAttribute('data-domains', SITE);
    script.setAttribute('data-exclude-search', 'true');
    script.setAttribute('data-exclude-hash', 'true');
    script.setAttribute('data-do-not-track', 'true');
    document.head.appendChild(script);
})();
