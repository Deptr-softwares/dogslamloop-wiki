/**
 * Dogslamloop Wiki - counting visitors (Umami Cloud), v1.2.
 *
 * The owner turned Cloudflare's Web Analytics off and counts visitors with
 * Umami Cloud instead (2026-11-17): KLIPY asks for monthly active users before
 * it issues a production API key. The owner's brief: "the least intrusive and
 * minimal things". So this asks Umami for page views and nothing more:
 *
 * - On reader pages only. This file is loaded by them and by nothing else:
 *   not the editor, the Overseer, the owner tools, the post editor or the tier
 *   editor (tests/analytics.spec.js).
 * - On dogslamloop.com only, so a local run, a preview or a test never counts
 *   and never loads Umami at all.
 * - Without the ?query or #hash of an address (search terms, page ids).
 * - Not at all for a browser that asks not to be tracked (Do Not Track).
 * - No speed data, no error reports, no click tracking (owner, 2026-11-17).
 *
 * Umami sets no cookies and stores nothing on the device; it only reads an
 * opt-out flag (localStorage `umami.disabled`). It counts a visitor with an
 * anonymous ID made from the IP address, the browser and a salt that changes
 * every month, so a month's Visitors is the MAU figure, and the IP itself is
 * not stored (docs.umami.is, Metric definitions).
 *
 * Loaded `async` and injecting Umami's script, which is async too, so neither
 * ever holds the page up: a slow analytics script once did (Cloudflare's, a
 * module, which DOMContentLoaded waits for).
 */
(function () {
    // The owner's Website ID from Umami Cloud (2026-11-17). Not a secret: it is
    // in the page source of every site that uses Umami. Emptying it turns the
    // counting off.
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
