/**
 * Dogslamloop Wiki - Shared Site Utilities: media
 *
 * Media framing, blocked media, the shared tooltip and math. Loads after
 * site_data.js.
 */

// --- MEDIA FRAMING ---
// Skill-card media used to sit in a fixed 16:9 box whatever shape the source
// was, so a square still or a phone-captured clip got pillarboxed into a strip.
//
// The rule the owner chose is "square only when it fits": the box matches the
// source rather than the source being cropped to match the box. A 16:9 clip
// keeps its 16:9 box and loses nothing; a near-square still gets a square box;
// a tall capture gets a 3:4 box, which bounds the card height without
// discarding most of the frame.
//
// 16:9 stays the CSS default, so an unmeasured or broken source looks exactly
// as it does today and the common case never has to flip after layout.
window.MEDIA_WIDE_THRESHOLD = 1.5;
window.MEDIA_TALL_THRESHOLD = 0.75;

// 'auto' measures; the other three are the contributor overriding the measure,
// which matters for media whose subject sits off-centre.
window.MEDIA_FRAMING_OPTIONS = ['auto', 'wide', 'square', 'tall'];

// The nine-point focal grid for a cropped portrait, as literal
// object-position values. A whitelist rather than free text on purpose: this
// lands inside a style attribute, and escaping alone would not stop a crafted
// value from closing the declaration and adding its own.
window.PORTRAIT_FOCUS_VALUES = [
    'left top', 'center top', 'right top',
    'left center', 'center center', 'right center',
    'left bottom', 'center bottom', 'right bottom',
];

window.framingForRatio = function(ratio) {
    if (!ratio || !isFinite(ratio)) return null;
    if (ratio >= window.MEDIA_WIDE_THRESHOLD) return 'wide';
    if (ratio <= window.MEDIA_TALL_THRESHOLD) return 'tall';
    return 'square';
};

// `media` is the move's own media object: { src, framing, width, height }.
// Resolved in that order of confidence - an explicit framing, then stored
// dimensions, then measuring the file once it loads.
window.applyMediaFraming = function(mediaEl, wrapperEl, media) {
    if (!wrapperEl) return;
    const opts = (media && typeof media === 'object') ? media : { framing: media };

    const set = (name) => {
        wrapperEl.classList.remove('is-square', 'is-tall');
        if (name === 'square') wrapperEl.classList.add('is-square');
        else if (name === 'tall') wrapperEl.classList.add('is-tall');
        // 'wide' is the bare class, so there is nothing to add.
    };

    if (opts.framing && opts.framing !== 'auto' && window.MEDIA_FRAMING_OPTIONS.includes(opts.framing)) {
        set(opts.framing);
        return;
    }

    // Stored dimensions settle the box before the file has loaded, which
    // matters because skill media is lazy AND sits in a hidden tab: a lazy
    // image inside display:none never loads at all until the tab is opened, so
    // measurement alone means the box corrects itself in front of the reader
    // the first time they click Skills. Media uploaded through the library
    // records these; anything older falls through to measuring.
    const stored = window.framingForRatio(
        opts.width && opts.height ? Number(opts.width) / Number(opts.height) : null
    );
    if (stored) set(stored);

    if (!mediaEl) return;

    const measure = () => {
        // naturalWidth for <img>, videoWidth for <video> - both are 0 until the
        // source has actually loaded, and skill-card videos are lazy, so this
        // may not resolve until the card scrolls into view.
        const w = mediaEl.naturalWidth || mediaEl.videoWidth;
        const h = mediaEl.naturalHeight || mediaEl.videoHeight;
        const framing = window.framingForRatio(w && h ? w / h : null);
        if (framing) set(framing);
    };

    measure();
    mediaEl.addEventListener('load', measure);
    mediaEl.addEventListener('loadedmetadata', measure);
};

// window.FRAME_MOVE_CATEGORIES moved to js/utility/character_tabs.js, which loads
// before this file on every page. It is derived from the tab vocabulary there
// (the tabs marked `frameMoves`), so which tabs hold frame data is declared
// once, next to the tabs themselves.

// --- BLOCKED MEDIA ---
//
// A reviewer flagging a file has to actually get it off the page, and the
// pages render contributor media from seven different places across five
// files (skill cards, image blocks, video blocks, profile portraits, gallery
// items, roster cards, tier portraits). Editing each one means the next
// render site added forgets, and "forgot" here means flagged media keeps
// showing.
//
// So this works on the DOM rather than on the seven call sites: sweep what is
// already there, then watch for what arrives. Tab switches, lazy loads and
// mode toggles all rebuild media long after boot, and an observer catches
// those without every renderer having to know this feature exists.
//
// The cost is bounded by the thing that makes it acceptable: **if nothing is
// flagged, nothing runs.** No sweep, no observer, no listeners. That is the
// normal state of the site, and flagged media is meant to be rare.
//
// This is a rendering guard, not a security control. The file still sits at
// its public storage URL - anyone holding the direct link keeps it. Taking it
// down for real is deleting the object, which stays the owner's job.
const BLOCKED_MEDIA_NOTICE = 'Media removed by a moderator';

// The same fact, in one word, for the places where the full sentence does not
// fit: a video BUTTON in a table cell or on a combo card is a small control,
// and a full-width notice in its place is bulkier than the thing it replaced
// (owner, 2026-08-18).
const BLOCKED_MEDIA_LABEL = 'Blocked';

let blockedMediaPromise = null;

// Returns a Set of blocked object paths, and an empty one on any failure.
// Deliberately fail-open: a moderation table that cannot be read must not
// blank out every image on the wiki, which is the failure mode of guessing
// the other way.
window.fetchBlockedMedia = function() {
    if (blockedMediaPromise) return blockedMediaPromise;

    blockedMediaPromise = (async () => {
        try {
            if (!window.supabaseClient) return new Set();
            const { data, error } = await window.supabaseClient
                .from('media_moderation').select('path').eq('status', 'flagged');
            if (error || !Array.isArray(data)) return new Set();
            return new Set(data.map(row => row.path).filter(Boolean));
        } catch (e) {
            return new Set();
        }
    })();

    return blockedMediaPromise;
};

// Matches on the trailing path segment rather than the whole URL: the same
// object is referenced as a raw name, percent-encoded, and occasionally with
// a query string, and all three end in the object's own name.
window.isBlockedMediaSrc = function(src, blocked) {
    if (!src || !blocked || !blocked.size) return false;

    const withoutQuery = String(src).split(/[?#]/)[0];
    const lastSegment = withoutQuery.substring(withoutQuery.lastIndexOf('/') + 1);
    if (!lastSegment) return false;

    if (blocked.has(lastSegment)) return true;
    try {
        return blocked.has(decodeURIComponent(lastSegment));
    } catch (e) {
        // A malformed escape sequence is not a match, and must not throw
        // mid-sweep and leave the rest of the page unswept.
        return false;
    }
};

function replaceWithBlockedNotice(element) {
    if (!element || !element.parentNode) return;

    // A video button gets the compact form. The REMOVAL is identical either
    // way - the URL and the click target both go - so this is only a question
    // of what fits where the thing used to be.
    const inline = !!(element.matches && element.matches('[data-wiki-video]'));

    const notice = document.createElement(inline ? 'span' : 'div');
    notice.className = inline ? 'media-blocked-inline' : 'media-blocked-notice';
    // textContent, not innerHTML - and the string is a constant anyway.
    notice.textContent = inline ? BLOCKED_MEDIA_LABEL : BLOCKED_MEDIA_NOTICE;
    element.parentNode.replaceChild(notice, element);
}

// Every element that can name a media file, and every attribute it can name it
// in. data-lazy-src because videos carry their real URL there until something
// scrolls them into view; data-wiki-video because a video in a table cell or on
// a combo card is a BUTTON that opens a player (v0.15 item 11), and a button is
// not an <img> or a <video> so nothing here used to see it.
const BLOCKED_MEDIA_SELECTOR =
    'img[src], video[src], video[data-lazy-src], source[src], [data-wiki-video]';
const BLOCKED_MEDIA_ATTRS = ['src', 'data-lazy-src', 'data-wiki-video'];

function blockedMediaSrcOf(element) {
    for (let i = 0; i < BLOCKED_MEDIA_ATTRS.length; i++) {
        const value = element.getAttribute(BLOCKED_MEDIA_ATTRS[i]);
        if (value) return value;
    }
    return null;
}

// What actually comes off the page, which is not always the element that
// matched. A <source> lives inside the media element it belongs to, and a
// player's <video> lives inside a shell carrying its own play, sound and
// duration controls - replacing either one alone leaves working chrome wired
// to nothing, which reads as a broken player rather than a moderated one. An
// autoplaying clip (v0.20) sits in a wrapper with its corner button, and the
// two go together for the same reason.
function blockedMediaTarget(element) {
    let target = element;
    if (target.tagName === 'SOURCE' && target.parentNode) target = target.parentNode;
    const shell = target.closest ? target.closest('[data-wiki-player], .wiki-clip') : null;
    return shell || target;
}

window.sweepBlockedMedia = function(root, blocked) {
    if (!root || !blocked || !blocked.size) return 0;

    const candidates = root.querySelectorAll ? root.querySelectorAll(BLOCKED_MEDIA_SELECTOR) : [];

    let removed = 0;
    candidates.forEach(element => {
        if (!window.isBlockedMediaSrc(blockedMediaSrcOf(element), blocked)) return;
        // A shell replaced earlier in this same sweep is no longer on the
        // page, and replacing a detached node throws. Checked on the TARGET:
        // a clip's video and its corner button both match, and both name the
        // wrapper the video already took away.
        const target = blockedMediaTarget(element);
        if (!target.parentNode) return;
        replaceWithBlockedNotice(target);
        removed += 1;
    });
    return removed;
};

window.initBlockedMediaGuard = async function() {
    const blocked = await window.fetchBlockedMedia();
    if (!blocked.size) return null;

    window.sweepBlockedMedia(document, blocked);

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                window.sweepBlockedMedia(node, blocked);
                // The node itself, when media is appended directly rather
                // than as part of a rendered subtree.
                if (node.matches && node.matches(BLOCKED_MEDIA_SELECTOR)) {
                    if (window.isBlockedMediaSrc(blockedMediaSrcOf(node), blocked)) {
                        replaceWithBlockedNotice(blockedMediaTarget(node));
                    }
                }
            });
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
};

// --- SHARED MANGA TOOLTIP ---
// Used by description.js (inline callouts) and framedata.js (frame
// timeline phases) for the same hover tooltip, so both element types
// get identical styling regardless of which is hovered first.
let frameTooltip = null;

window.initTooltip = function() {
    if (!frameTooltip) {
        frameTooltip = document.getElementById('wiki-frame-tooltip');
        if (!frameTooltip) {
            frameTooltip = document.createElement('div');
            frameTooltip.id = 'wiki-frame-tooltip';

            frameTooltip.style.position = 'fixed';
            frameTooltip.style.zIndex = '100000';
            frameTooltip.style.pointerEvents = 'none'; // Prevents it from stealing the hover cursor
            frameTooltip.style.background = 'var(--bg-main, #050505)';
            frameTooltip.style.border = '2px solid var(--border-color, #333)';
            frameTooltip.style.padding = '0.75rem 1rem';
            frameTooltip.style.boxShadow = '6px 6px 0px var(--manga-shadow, #000)';
            // min() with a viewport-relative term so a long callout can never
            // be wider than the screen itself on a narrow phone - a fixed
            // 320px max-width left no room for positionTooltip's flip logic
            // to keep it on-screen once content pushed close to that width.
            frameTooltip.style.maxWidth = 'min(320px, calc(100vw - 2rem))';
            frameTooltip.style.color = 'var(--text-white, #fff)';
            frameTooltip.style.fontFamily = 'var(--text-mono)';
            frameTooltip.style.fontSize = '0.75rem';
            frameTooltip.style.display = 'none'; // Hidden by default

            document.body.appendChild(frameTooltip);
        }
    }
};

// Positions the shared tooltip near (x, y), flipping away from the right/bottom
// viewport edges. Shared by the mouse and touch bindings below.
function positionTooltip(x, y) {
    const box = frameTooltip.getBoundingClientRect();
    const margin = 8; // keeps it off the exact viewport edge

    if (x + 15 + box.width > window.innerWidth) x -= box.width + 15; else x += 15;
    if (y + 15 + box.height > window.innerHeight) y -= box.height + 15; else y += 15;

    // Final safety clamp: on a narrow phone, a long callout's tooltip can be
    // wide enough that flipping to the other side of the cursor still isn't
    // enough room - always pin it fully inside the viewport as a last resort,
    // regardless of how the flip above landed.
    x = Math.min(Math.max(x, margin), window.innerWidth - box.width - margin);
    y = Math.min(Math.max(y, margin), window.innerHeight - box.height - margin);

    frameTooltip.style.left = x + 'px';
    frameTooltip.style.top = y + 'px';
}

// Tapping outside whichever element currently owns the tooltip closes it.
// Registered once (lazily, alongside the tooltip element itself) rather than
// per-bindTooltip call, since bindTooltip runs once per phase/callout.
let tooltipOwner = null;
function closeTooltipIfOutside(target) {
    if (frameTooltip && tooltipOwner && !tooltipOwner.contains(target)) {
        frameTooltip.style.display = 'none';
        tooltipOwner = null;
    }
}

// Binds hover/move/leave listeners (desktop) plus a tap-to-toggle listener
// (touch, which never fires mouseenter/mousemove/mouseleave on real devices)
// that show titleHtml in the shared tooltip.
window.bindTooltip = function(element, titleHtml) {
    element.addEventListener('mouseenter', () => {
        window.initTooltip();
        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
    });

    element.addEventListener('mousemove', (e) => {
        if (frameTooltip) positionTooltip(e.clientX, e.clientY);
    });

    element.addEventListener('mouseleave', () => {
        if (frameTooltip) frameTooltip.style.display = 'none';
    });

    element.addEventListener('touchend', (e) => {
        // Prevents the browser's synthetic mouse/click compatibility events
        // from double-firing this same toggle right after touchend.
        e.preventDefault();
        window.initTooltip();

        if (!document._tooltipOutsideTapBound) {
            document.addEventListener('touchstart', (ev) => closeTooltipIfOutside(ev.target));
            document._tooltipOutsideTapBound = true;
        }

        if (tooltipOwner === element && frameTooltip.style.display === 'block') {
            frameTooltip.style.display = 'none';
            tooltipOwner = null;
            return;
        }

        frameTooltip.innerHTML = titleHtml;
        frameTooltip.style.display = 'block';
        tooltipOwner = element;

        const touch = e.changedTouches[0];
        positionTooltip(touch.clientX, touch.clientY);
    });
};

// The same tooltip for a delegated hover, where nothing is bound to one
// element: in-page links (js/pages/core/pagebuilder.js) are re-rendered with the text
// around them, so a per-element binding would be lost on every repaint.
window.showTooltipAt = function(html, x, y) {
    window.initTooltip();
    frameTooltip.innerHTML = html;
    frameTooltip.style.display = 'block';
    positionTooltip(x, y);
};

window.moveTooltipTo = function(x, y) {
    if (frameTooltip && frameTooltip.style.display === 'block') positionTooltip(x, y);
};

window.hideTooltip = function() {
    if (frameTooltip) frameTooltip.style.display = 'none';
};

// --- MATH ---
//
// KATEX, ONLY WHERE THERE IS MATH (v1.1 batch 9). It shipped in 28 pages' heads
// since the first upload and no page used it (2026-10-22: one `$` in all the
// indexed text), so every character page paid 81 KB and a walk of the whole
// page per render. Now it is fetched the first time a text node holds a
// $...$ pair, which is the only text auto-render can turn into math anyway:
// it reads one text node at a time.
const KATEX_DIST = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/';
const MATH_DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
];
const MATH_PAIR = /\$[^$]+\$/;
const NOT_PROSE = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
let katexLoading = null;

function hasMath(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (MATH_PAIR.test(node.nodeValue) && !NOT_PROSE.has(node.parentNode.nodeName)) return true;
    }
    return false;
}

function loadKatex() {
    if (!katexLoading) {
        const add = src => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${src}`));
            document.head.appendChild(script);
        });
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `${KATEX_DIST}katex.min.css`;
        document.head.appendChild(css);
        katexLoading = add(`${KATEX_DIST}katex.min.js`)
            .then(() => add(`${KATEX_DIST}contrib/auto-render.min.js`))
            .catch(e => {
                // The math stays as its $...$ text; the next render tries again.
                katexLoading = null;
                throw e;
            });
    }
    return katexLoading;
}

window.renderMathIfAny = async function(root) {
    if (!root || !hasMath(root)) return false;
    try {
        await loadKatex();
    } catch (e) {
        console.error('Math could not be drawn:', e.message);
        return false;
    }
    window.renderMathInElement(root, { delimiters: MATH_DELIMITERS, throwOnError: false });
    return true;
};
