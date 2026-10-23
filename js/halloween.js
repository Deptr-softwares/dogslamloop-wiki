/**
 * Dogslamloop Wiki - The Halloween event (owner, 2026-10-23; no version)
 *
 * Once a reader has been through the Black Flash minigame, the site turns
 * "Pumpkin Night" for them (owner's pick from mockups): orange where the blue
 * accent was, and cobwebs at the edges of the page. It stays that way on their
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

    // The webs sit in the middle area, against the sidebars rather than inside
    // them (owner, 2026-10-23). The sidebars are measured rather than their
    // widths copied here, so a collapsed sidebar, or none on a phone, moves the
    // webs with it.
    function hugSidebars(webs) {
        const left = document.querySelector('.global-sidebar-left');
        const right = document.querySelector('.local-sidebar-right');
        const place = () => {
            const l = left ? left.getBoundingClientRect() : null;
            const r = right ? right.getBoundingClientRect() : null;
            webs.style.setProperty('--hw-left', `${l && l.width ? Math.max(0, l.right) : 0}px`);
            webs.style.setProperty('--hw-right', `${r && r.width ? Math.max(0, root.clientWidth - r.left) : 0}px`);
        };
        place();
        if (typeof ResizeObserver === 'function') {
            const watch = new ResizeObserver(place);
            [left, right].forEach(el => { if (el) watch.observe(el); });
        }
        window.addEventListener('resize', place);
    }

    function decorate() {
        if (!document.body || document.querySelector('.hw-webs')) return;
        const webs = document.createElement('div');
        webs.className = 'hw-webs';
        webs.setAttribute('aria-hidden', 'true');
        webs.innerHTML = `<div class="hw-web hw-web-top">${WEB}</div>`
            + `<div class="hw-web hw-web-bottom">${WEB}</div>`
            + `<div class="hw-spider">${SPIDER}</div>`;
        document.body.appendChild(webs);
        hugSidebars(webs);
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
    // Owner: "50% chance of happening upon any clicking action ... to make
    // sure people are actually paying attention in the site, so nothing
    // catches them off guard". A click is also what lets a browser play sound.
    const CHANCE = 0.5;

    // Doing nothing makes it worse (owner): the red at the sides and the
    // swaying grow at these idle times, to a violent jiggle before the loss.
    const HEAT_AFTER = [3000, 6000, 8000];

    // Once the fourth fist lands, the music and the game fade out over this
    // long before the scene (owner).
    const RESOLVE_MS = 700;
    // Lost, in ms from the scene: the avatar grows for about two seconds,
    // then its face fills the screen, then the Ko-fi button does.
    const FACE_AT = 2300;
    const KOFI_AT = 4100;
    const LOST_FADES_AT = 6100;
    const WON_FADES_AT = 2600;

    // Paths from this script's own address, so they hold on a page at any depth.
    const here = document.currentScript && document.currentScript.src;
    const asset = (p) => (here ? new URL(`../${p}`, here).href : p);
    const AVATAR = asset('medias/images/DeptrAvatar.webp');
    // The owner's screenshots: the Ko-fi button, and the game's own skill box.
    const KOFI = asset('medias/images/KoFiButton.png');
    const SKILL = asset('medias/images/InGameDivergentFistUI.png');
    // The owner's picks, free to use from Pixabay. The scream is pitched up,
    // towards Foxy's (owner), by playing it faster without keeping its pitch.
    const SCREAM = asset('medias/audios/HalloweenJumpscare.mp3');
    const SCREAM_PITCH = 1.35;
    const MUSIC = asset('medias/audios/tunetank-dark-tense-cinematic-chase-music-414691.mp3');
    // A Black Flash chain sound from the Roblox Creator Store, kept by the
    // owner's call (2026-10-23) after its off-Roblox licence was raised.
    const HIT = asset('medias/audios/8f73237e2303c812712cfba944ed5bf7.mp3');
    // The avatar's head in DeptrAvatar.webp, as fractions of it, and the width
    // it is drawn at before being stretched over the screen: few enough pixels
    // that they show (owner: "make it so large, my avatar appears pixelated
    // naturally").
    const HEAD = { x: 0.183, y: 0.007, w: 0.679, h: 0.483 };
    const HEAD_PIXELS = 160;

    let playing = false;

    // A sound that fails to load or play is deliberately quiet: the game goes
    // on without it.
    function sound(src, { loop = false, volume = 0.7 } = {}) {
        try {
            const a = new Audio(src);
            a.preload = 'auto';
            a.loop = loop;
            a.volume = volume;
            return a;
        } catch (e) {
            return null;
        }
    }
    function start(a) {
        if (!a) return;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    function stop(a) {
        if (a) a.pause();
    }
    // Down to silence over `ms`, then stopped.
    function fadeOut(a, ms) {
        if (!a) return;
        const steps = 10;
        const from = a.volume;
        let step = 0;
        const t = setInterval(() => {
            step += 1;
            a.volume = Math.max(0, from * (1 - step / steps));
            if (step >= steps) {
                clearInterval(t);
                a.pause();
            }
        }, ms / steps);
    }

    // The face, drawn small and stretched over the screen without smoothing.
    function pixelFace(img) {
        if (!img || !img.complete || !img.naturalWidth) return null;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const face = document.createElement('canvas');
        face.className = 'hw-face';
        face.width = HEAD_PIXELS;
        face.height = Math.round(HEAD_PIXELS * (HEAD.h * h) / (HEAD.w * w));
        face.getContext('2d').drawImage(img, HEAD.x * w, HEAD.y * h, HEAD.w * w, HEAD.h * h, 0, 0, face.width, face.height);
        return face;
    }

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
                <div class="hw-target"><img class="hw-skill" src="${SKILL}" alt="Divergent Fist, key 3"><div class="hw-dot"></div><div class="hw-ring"></div></div>
                <p class="hw-callout" aria-live="assertive"></p>
                <p class="hw-help">Space, 3, click, or tap!!!</p>
            </div>
            <button type="button" class="hw-skip">press x to skip</button>`;
        document.body.appendChild(overlay);
        const before = document.activeElement;
        const scrollWas = root.style.overflow;
        root.style.overflow = 'hidden';
        overlay.focus();

        const music = sound(MUSIC, { loop: true, volume: 0.5 });
        const scream = sound(SCREAM);
        if (scream) {
            scream.preservesPitch = false;
            scream.webkitPreservesPitch = false;
            scream.playbackRate = SCREAM_PITCH;
        }
        const hit = sound(HIT);
        start(music);
        // Loading from the start, so the face is ready by the time it is due.
        const avatar = new Image();
        avatar.src = AVATAR;

        const count = overlay.querySelector('.hw-count');
        const target = overlay.querySelector('.hw-target');
        const ring = overlay.querySelector('.hw-ring');
        const callout = overlay.querySelector('.hw-callout');
        const arena = overlay.querySelector('.hw-arena');

        let phase = 'intro';
        let thrownAt = 0;
        let fistTimer = null;
        let idleTimer = null;
        let lastPress = 0;
        let heatTimer = null;
        const sceneTimers = [];
        const later = (fn, ms) => sceneTimers.push(setTimeout(fn, ms));
        const results = [];

        const idle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(false), IDLE_LOSES);
        };

        // How long since the last press, as a level the CSS turns into redder
        // sides and harder swaying.
        const heat = () => {
            const quiet = performance.now() - lastPress;
            overlay.dataset.heat = String(HEAT_AFTER.filter(at => quiet >= at).length);
        };

        function act() {
            if (phase === 'ready' || phase === 'thrown') {
                lastPress = performance.now();
                heat();
                // The skill box dips under the press, like the key going down.
                target.classList.remove('is-pressed');
                void target.offsetWidth;
                target.classList.add('is-pressed');
            }
            if (phase === 'ready') {
                phase = 'thrown';
                thrownAt = performance.now();
                idle();
                callout.textContent = 'DIVERGENT FIST';
                callout.className = 'hw-callout';
                arena.classList.remove('is-flash', 'is-miss');
                // Restarted on every throw: the ring closes on the box at the beat.
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
            if (blackFlash && hit) {
                hit.currentTime = 0;
                start(hit);
            }
            setTimeout(() => {
                if (phase !== 'landed') return;
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
            if (e.key === 'x' || e.key === 'X') {
                e.preventDefault();
                e.stopPropagation();
                skip();
            } else if (e.code === 'Space' || e.key === ' ' || e.key === '3') {
                e.preventDefault();
                e.stopPropagation();
                act();
            }
        };
        const onPointer = (e) => {
            if (e.target.closest('.hw-skip')) return;
            e.preventDefault();
            act();
        };
        window.addEventListener('keydown', onKey, true);
        overlay.addEventListener('pointerdown', onPointer);
        overlay.querySelector('.hw-skip').addEventListener('click', skip);

        // The screen fades to black and the prompt in before anything counts.
        requestAnimationFrame(() => overlay.classList.add('is-dark'));
        setTimeout(() => {
            if (phase !== 'intro') return;
            phase = 'ready';
            overlay.classList.add('is-live');
            lastPress = performance.now();
            heat();
            heatTimer = setInterval(heat, 250);
            idle();
        }, 1600);

        function stopGame() {
            clearTimeout(fistTimer);
            clearTimeout(idleTimer);
            clearInterval(heatTimer);
            overlay.removeEventListener('pointerdown', onPointer);
        }

        function finish(won) {
            if (phase === 'over' || phase === 'leaving') return;
            phase = 'over';
            stopGame();
            // Played, whatever happens next: a tab closed mid-scare still counts.
            markDone();
            // The music and the game fade out, then the scene.
            fadeOut(music, RESOLVE_MS);
            overlay.classList.add('is-resolving');
            later(() => {
                overlay.classList.remove('is-resolving');
                if (won) won_(); else lost();
            }, RESOLVE_MS);
        }

        // Skipping goes straight to the new look, from the game or a scene.
        function skip() {
            if (phase === 'leaving') return;
            stopGame();
            sceneTimers.forEach(clearTimeout);
            markDone();
            fadeAway();
        }

        // The avatar holds the Ko-fi button like a sword, over the knife in
        // its hand (its grip is 18% across and 81% down the image).
        const figure = () => '<div class="hw-figure">'
            + `<img class="hw-avatar" src="${AVATAR}" alt="">`
            + `<img class="hw-sword" src="${KOFI}" alt="">`
            + '</div>';

        // Lost: far off, growing for about two seconds; then the face fills the
        // screen, begging; then the Ko-fi button takes the screen with a
        // scream, and about two seconds later it all fades away.
        function lost() {
            overlay.classList.add('is-scene');
            arena.innerHTML = `<div class="hw-scene hw-lost">${figure()}<p class="hw-beg">PLEASE DONATE...</p></div>`;
            const scene = arena.querySelector('.hw-scene');
            // Laid out at its far size first, or the growth has nothing to
            // grow from and jumps.
            void scene.offsetWidth;
            scene.classList.add('is-growing');
            later(() => {
                scene.classList.add('is-close');
                // On a slow line the picture may still be coming: drawn when it does.
                const draw = () => {
                    const face = pixelFace(avatar);
                    if (face && scene.isConnected) scene.prepend(face);
                };
                if (avatar.complete && avatar.naturalWidth) draw();
                else avatar.addEventListener('load', draw, { once: true });
            }, FACE_AT);
            later(() => {
                scene.insertAdjacentHTML('beforeend', `<img class="hw-kofi" src="${KOFI}" alt="Support Ko-fi">`);
                start(scream);
            }, KOFI_AT);
            later(fadeAway, LOST_FADES_AT);
        }

        // Won: only seen from far away, quietly asking.
        function won_() {
            overlay.classList.add('is-scene');
            arena.innerHTML = `<div class="hw-scene hw-won">${figure()}<p class="hw-ask">(psst... donate?)</p></div>`;
            later(fadeAway, WON_FADES_AT);
        }

        // Into the new look, underneath, as the game fades off it.
        function fadeAway() {
            phase = 'leaving';
            window.removeEventListener('keydown', onKey, true);
            stop(music);
            lookOn();
            overlay.classList.add('is-leaving');
            setTimeout(() => {
                stop(scream);
                overlay.remove();
                root.style.overflow = scrollWas;
                if (before && typeof before.focus === 'function') before.focus();
                playing = false;
            }, 1000);
        }
    }

    // A click anywhere wakes it half the time: not one into a text box or a
    // dialog. The click that does is spent on it, so a link does not lead
    // away mid-scare.
    function onClick(e) {
        if (playing || e.button !== 0) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .modal-overlay, #auth-modal')) return;
        if (Math.random() >= CHANCE) return;
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('click', onClick, true);
        play();
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
        window.addEventListener('click', onClick, true);
    });

    window.halloween = { lookOn, markDone, readDone, play };
})();
