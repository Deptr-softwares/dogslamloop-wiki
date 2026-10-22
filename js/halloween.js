/**
 * Dogslamloop Wiki - The Halloween event (owner, 2026-10-23; no version)
 *
 * Once a reader has been through the Black Flash minigame, the site turns
 * "Pumpkin Night" for them (owner's pick from mockups): orange where the blue
 * accent was, and cobwebs in the screen's corners. It stays that way on their
 * device, and all of it ends by itself at the start of November 1, the
 * reader's own time.
 *
 * Loaded in <head>, before there is a body, so a reader who has played gets
 * the look on the first paint rather than a flash of the usual colours.
 * Character pages keep their own colours: applyCharacterTheme (js/site_meta.js)
 * writes them onto <html> inline, which beats any class.
 */
(function () {
    'use strict';

    const ENDS = new Date(2026, 10, 1).getTime();
    const DONE_KEY = 'dsl_halloween_done';
    const root = document.documentElement;

    if (!(Date.now() < ENDS)) return;

    // true or false, or null when the browser blocks storage.
    function readDone() {
        try {
            return window.localStorage.getItem(DONE_KEY) === '1';
        } catch (e) {
            return null;
        }
    }

    function markDone() {
        try {
            window.localStorage.setItem(DONE_KEY, '1');
        } catch (e) {
            // Deliberately quiet: storage is blocked, so the look still turns
            // on for this page and the game cannot be remembered anyway.
        }
    }

    // One corner's web, drawn from its corner outwards: five spokes and four
    // sagging rings. A second corner is the same drawing mirrored in CSS.
    const WEB = '<svg viewBox="0 0 140 140" fill="none" focusable="false">'
        + '<path d="M0 0L140 0M0 0L133.1 43.3M0 0L113.3 82.3M0 0L82.3 113.3M0 0L43.3 133.1M0 0L0 140"/>'
        + '<path d="M35 0Q29.4 4.6 33.3 10.8Q26.5 13.5 28.3 20.6Q21 21 20.6 28.3Q13.5 26.5 10.8 33.3Q4.6 29.4 0 35"/>'
        + '<path d="M65 0Q54.6 8.6 61.8 20.1Q49.2 25.1 52.6 38.2Q39.1 39.1 38.2 52.6Q25.1 49.2 20.1 61.8Q8.6 54.6 0 65"/>'
        + '<path d="M95 0Q79.8 12.6 90.3 29.4Q71.9 36.7 76.9 55.8Q57.1 57.1 55.8 76.9Q36.7 71.9 29.4 90.3Q12.6 79.8 0 95"/>'
        + '<path d="M125 0Q105 16.6 118.9 38.6Q94.7 48.2 101.1 73.5Q75.1 75.1 73.5 101.1Q48.2 94.7 38.6 118.9Q16.6 105 0 125"/>'
        + '</svg>';
    const SPIDER = '<svg viewBox="0 0 40 120" fill="none" focusable="false">'
        + '<path class="hw-thread" d="M20 0L20 88"/>'
        + '<path d="M13 96Q4 90 2 82M12 100Q2 100 0 94M12 104Q2 108 1 114M14 107Q8 114 7 120M27 96Q36 90 38 82M28 100Q38 100 40 94M28 104Q38 108 39 114M26 107Q32 114 33 120"/>'
        + '<circle class="hw-spider-body" cx="20" cy="90" r="4.5"/><circle class="hw-spider-body" cx="20" cy="101" r="8"/>'
        + '</svg>';

    function decorate() {
        if (!document.body || document.querySelector('.hw-webs')) return;
        const webs = document.createElement('div');
        webs.className = 'hw-webs';
        webs.setAttribute('aria-hidden', 'true');
        webs.innerHTML = `<div class="hw-web hw-web-top">${WEB}</div>`
            + `<div class="hw-web hw-web-bottom">${WEB}</div>`
            + `<div class="hw-spider">${SPIDER}</div>`;
        document.body.appendChild(webs);
    }

    function lookOn() {
        root.classList.add('halloween');
        decorate();
    }

    // Storage blocked means the game could never be remembered, and would pop
    // up on every page; those readers get the look without it.
    if (readDone() !== false) root.classList.add('halloween');

    document.addEventListener('DOMContentLoaded', () => {
        if (root.classList.contains('halloween')) decorate();
    });

    window.halloween = { lookOn, markDone, readDone };
})();
