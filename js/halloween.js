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

    // The Update Log listens for this, to show the Halloween entry once the
    // look is on.
    function lookOn() {
        root.classList.add('halloween');
        decorate();
        document.dispatchEvent(new CustomEvent('halloween:look'));
    }

    // Storage blocked means the game could never be remembered, and would pop
    // up on every page; those readers get the look without it.
    if (readDone() !== false) root.classList.add('halloween');

    // --- THE MINIGAME (owner's design, 2026-10-23) ---
    //
    // "HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED". Space, a click, a tap
    // or the 3 key throws a Divergent Fist; pressing again about 0.3s later
    // lands a Black Flash, as in the game. Four fists, and only the fourth
    // decides: "If they miss or hit the first three it doesn't matter (create
    // tension and such)".
    const BLACK_FLASH = [220, 380];   // ms after the throw that count as a Black Flash
    const FISTS = 4;
    const FIST_LANDS = 800;           // no second press by then: the fist lands without one
    const IDLE_LOSES = 10000;         // nothing pressed for this long loses
    const CHANCE = 0.05;              // owner: "5% chance every 1 second"

    // Paths from this script's own address, so they hold on a page at any depth.
    const here = document.currentScript && document.currentScript.src;
    const asset = (p) => (here ? new URL(`../${p}`, here).href : p);
    const AVATAR = asset('medias/images/DeptrAvatar.webp');
    // The owner's pick, a free-to-use sound effect.
    const SCREAM = asset('medias/audios/HalloweenJumpscare.mp3');

    const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" focusable="false" aria-hidden="true">'
        + '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>'
        + '<line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>';

    let playing = false;

    function play() {
        if (playing || !document.body) return;
        playing = true;

        const overlay = document.createElement('div');
        overlay.className = 'hw-game';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'hw-tip');
        overlay.tabIndex = -1;
        overlay.innerHTML = `
            <p class="hw-tip" id="hw-tip">HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED</p>
            <div class="hw-arena">
                <p class="hw-count" aria-live="polite">FIST 1 / ${FISTS}</p>
                <div class="hw-target"><div class="hw-ring"></div><div class="hw-core"></div></div>
                <p class="hw-callout" aria-live="assertive"></p>
                <p class="hw-help">Space, 3, click or tap throws a Divergent Fist. Press again on the beat for a Black Flash.</p>
            </div>`;
        document.body.appendChild(overlay);
        const before = document.activeElement;
        const scrollWas = root.style.overflow;
        root.style.overflow = 'hidden';
        overlay.focus();

        // Loaded now, played at the jumpscare. A browser plays it only after
        // the reader has pressed something, which the game asks for.
        let scream = null;
        try {
            scream = new Audio(SCREAM);
            scream.preload = 'auto';
            scream.volume = 0.7;
        } catch (e) {
            scream = null;
        }

        const count = overlay.querySelector('.hw-count');
        const ring = overlay.querySelector('.hw-ring');
        const callout = overlay.querySelector('.hw-callout');
        const arena = overlay.querySelector('.hw-arena');

        let phase = 'intro';
        let thrownAt = 0;
        let fistTimer = null;
        let idleTimer = null;
        const results = [];

        const idle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(false), IDLE_LOSES);
        };

        function act() {
            if (phase === 'ready') {
                phase = 'thrown';
                thrownAt = performance.now();
                idle();
                callout.textContent = 'DIVERGENT FIST';
                callout.className = 'hw-callout';
                arena.classList.remove('is-flash', 'is-miss');
                // Restarted on every throw: the ring closes on the core at the beat.
                ring.classList.remove('is-closing');
                void ring.offsetWidth;
                ring.classList.add('is-closing');
                fistTimer = setTimeout(() => land(false), FIST_LANDS);
            } else if (phase === 'thrown') {
                const at = performance.now() - thrownAt;
                land(at >= BLACK_FLASH[0] && at <= BLACK_FLASH[1]);
            }
        }

        function land(blackFlash) {
            clearTimeout(fistTimer);
            phase = 'landed';
            results.push(blackFlash);
            callout.textContent = blackFlash ? 'BLACK FLASH!' : 'MISS';
            callout.className = `hw-callout ${blackFlash ? 'is-flash' : 'is-miss'}`;
            arena.classList.add(blackFlash ? 'is-flash' : 'is-miss');
            setTimeout(() => {
                if (results.length === FISTS) {
                    finish(results[FISTS - 1]);
                    return;
                }
                count.textContent = `FIST ${results.length + 1} / ${FISTS}`;
                phase = 'ready';
            }, 650);
        }

        const onKey = (e) => {
            if (e.repeat) return;
            if (e.code === 'Space' || e.key === ' ' || e.key === '3') {
                e.preventDefault();
                e.stopPropagation();
                act();
            }
        };
        const onPointer = (e) => {
            e.preventDefault();
            act();
        };
        window.addEventListener('keydown', onKey, true);
        overlay.addEventListener('pointerdown', onPointer);

        // The screen turns dark and the prompt fades in before anything counts.
        requestAnimationFrame(() => overlay.classList.add('is-dark'));
        setTimeout(() => {
            if (phase !== 'intro') return;
            phase = 'ready';
            overlay.classList.add('is-live');
            idle();
        }, 1600);

        function finish(won) {
            if (phase === 'over') return;
            phase = 'over';
            clearTimeout(fistTimer);
            clearTimeout(idleTimer);
            window.removeEventListener('keydown', onKey, true);
            overlay.removeEventListener('pointerdown', onPointer);
            // Played, whatever happens next: a tab closed mid-scare still counts.
            markDone();
            if (won) won_(); else lost();
        }

        // Scenes. The avatar holds the Ko-fi button like a sword, over the
        // knife in its hand (its grip is 18% across and 81% down the image).
        const figure = (extra) => `<div class="hw-figure ${extra}">`
            + `<img src="${AVATAR}" alt="">`
            + `<span class="hw-sword btn-sys btn-sys-yellow">${CUP}<span class="kofi-text">SUPPORT KO-FI</span></span>`
            + '</div>';

        // Lost: far off, growing slowly to about a sixth of the screen; then
        // all at once filling it, begging; then the Ko-fi button takes the
        // screen with a scream; about two seconds later it all fades away.
        function lost() {
            overlay.classList.add('is-scene');
            arena.innerHTML = `<div class="hw-scene hw-lost">${figure('is-far')}<p class="hw-beg">PLEASE DONATE...</p></div>`;
            const scene = arena.querySelector('.hw-scene');
            // Laid out at its far size first, or the growth has nothing to
            // grow from and jumps.
            void scene.offsetWidth;
            scene.classList.add('is-growing');
            setTimeout(() => scene.classList.add('is-close'), 3800);
            setTimeout(() => {
                scene.insertAdjacentHTML('beforeend', `<div class="hw-kofi">${CUP}<span class="kofi-text">SUPPORT KO-FI</span></div>`);
                if (scream) {
                    // Deliberately quiet on failure: a browser that has not seen a
                    // press yet refuses to play sound, and the scare goes on silent.
                    const p = scream.play();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                }
            }, 5600);
            setTimeout(fadeAway, 7600);
        }

        // Won: only seen from far away, quietly asking.
        function won_() {
            overlay.classList.add('is-scene');
            arena.innerHTML = `<div class="hw-scene hw-won">${figure('is-tiny')}<p class="hw-ask">(psst... donate?)</p></div>`;
            setTimeout(fadeAway, 2600);
        }

        // Into the new look, underneath, as the game fades off it.
        function fadeAway() {
            lookOn();
            overlay.classList.add('is-leaving');
            setTimeout(() => {
                overlay.remove();
                root.style.overflow = scrollWas;
                if (before && typeof before.focus === 'function') before.focus();
                playing = false;
            }, 1000);
        }
    }

    // Not while the reader is typing or a dialog is open, and not in a tab
    // nobody is looking at.
    function busy() {
        if (document.hidden) return true;
        const el = document.activeElement;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
        return [...document.querySelectorAll('.modal-overlay, #auth-modal')]
            .some(m => getComputedStyle(m).display !== 'none');
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (root.classList.contains('halloween')) {
            decorate();
            return;
        }
        // Automated browsers never get it, or every test on the site would
        // meet it at random. The game's own tests say they are not one.
        if (navigator.webdriver) return;
        // A reader who asked for less motion is spared the scare and gets the
        // look straight away. Site settings still lets them play it.
        if (root.classList.contains('reduce-motion')) {
            markDone();
            lookOn();
            return;
        }
        const timer = setInterval(() => {
            if (playing || busy()) return;
            if (Math.random() < CHANCE) {
                clearInterval(timer);
                play();
            }
        }, 1000);
    });

    window.halloween = { lookOn, markDone, readDone, play };
})();
