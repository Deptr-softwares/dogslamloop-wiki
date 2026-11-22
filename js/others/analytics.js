/**
 * Visitor counting (Umami Cloud), on reader pages only: page views and nothing
 * more, on dogslamloop.com only, without the ?query or #hash, and not for a
 * browser that sends Do Not Track. No speed data, errors or clicks.
 * @since v1.2
 * @touches the Umami Cloud script; localStorage umami.disabled (Umami's opt-out)
 * @watch the privacy policy says what is collected, so a change here changes the
 *   policy too. Loaded async, adding an async script, so it never holds the page up.
 * @see docs/shared-code.md
 */
(function () {
    // The Website ID from Umami Cloud: not a secret, it is in every Umami site's
    // source. Empty turns the counting off.
    const WEBSITE_ID = 'd53106ba-6b61-4ad7-8ae1-24ce62d4c32d';
    const SITE = 'dogslamloop.com';

    if (!WEBSITE_ID || window.location.hostname !== SITE) return;

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
