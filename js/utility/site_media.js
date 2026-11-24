/**
 * Media helpers every page shares: media framing (a Skill Card's box shaped to its
 * media), the blocked-media guard, the shared tooltip, and math (KaTeX, fetched
 * only where a page has some). Loads after site_data.js.
 * @since v0.3, as part of site_utils.js
 * @touches media_moderation (flagged files), the KaTeX CDN (only for $...$ text)
 * @watch the blocked-media guard is a rendering guard, not a security control: a
 *   file stays at its public address until it is deleted
 * @see docs/shared-code.md
 */

// Media framing: a Skill Card's box takes its media's shape, square only when it
// fits. 16:9 stays 16:9, a near-square still gets a square box, a tall capture 3:4.
// 16:9 is the CSS default, so unmeasured or broken media keeps that box.
window.MEDIA_WIDE_THRESHOLD = 1.5;
window.MEDIA_TALL_THRESHOLD = 0.75;

// 'auto' measures; the other three are the contributor overriding the measure,
// which matters for media whose subject sits off-centre.
window.MEDIA_FRAMING_OPTIONS = ['auto', 'wide', 'square', 'tall'];

// The nine-point focal grid for a cropped portrait, as literal object-position
// values: allowlisted, because it lands in a style attribute.
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

/**
 * Shapes a Skill Card's media box to its media: an explicit framing, else stored
 * dimensions, else the file's own once it loads. media is { src, framing, width,
 * height }.
 */
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

    // Stored dimensions settle the box before the file loads: skill media is lazy and
    // sits in a hidden tab, so measuring alone would correct the box in front of the
    // reader. Older media without them is measured.
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

// Blocked media: flagged files come off the page by working on the DOM, not on the
// places media renders, so a new one cannot forget. A sweep, then an observer for
// what arrives later (tab switches, lazy loads, mode toggles). If nothing is
// flagged, nothing runs.
const BLOCKED_MEDIA_NOTICE = 'Media removed by a moderator';

// One word where the sentence does not fit: a video button in a table cell or on a
// Combo Card.
const BLOCKED_MEDIA_LABEL = 'Blocked';

let blockedMediaPromise = null;

/**
 * The blocked object paths as a Set, empty on any failure: a moderation table that
 * cannot be read must not blank every image on the wiki.
 */
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

/**
 * Whether src names a blocked object, matched on its last path segment, since the
 * same object is referenced raw, percent-encoded or with a query.
 */
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

    // A video button gets the short form; the removal is the same either way.
    const inline = !!(element.matches && element.matches('[data-wiki-video]'));

    const notice = document.createElement(inline ? 'span' : 'div');
    notice.className = inline ? 'media-blocked-inline' : 'media-blocked-notice';
    notice.textContent = inline ? BLOCKED_MEDIA_LABEL : BLOCKED_MEDIA_NOTICE;
    element.parentNode.replaceChild(notice, element);
}

// Every element and attribute that can name a media file: data-lazy-src (a video's
// address until it is near the screen) and data-wiki-video (a video button in a
// cell or a card).
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

// What comes off the page, which is not always the element that matched: a
// <source>'s video, a player's whole shell, a clip with its corner button.
// Replacing one part would leave controls wired to nothing.
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
        // A target replaced earlier in this sweep is off the page, and replacing a detached
        // node throws: a clip's video and its corner button both name the same wrapper.
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

// The shared tooltip, for callouts (page_render.js) and Frame Track phases
// (skill_card.js), so both look the same.
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
            // min() with the viewport, so a long callout is never wider than a narrow phone.
            frameTooltip.style.maxWidth = 'min(320px, calc(100vw - 2rem))';
            frameTooltip.style.color = 'var(--text-white, #fff)';
            frameTooltip.style.fontFamily = 'var(--text-mono)';
            frameTooltip.style.fontSize = '0.75rem';
            frameTooltip.style.display = 'none';

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

    // The last resort on a narrow phone: pinned inside the viewport, however the flip
    // landed.
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

/**
 * Shows titleHtml in the shared tooltip on hover (desktop) or a tap (touch, which
 * fires no mouse events).
 * @watch titleHtml is HTML: escape what goes into it
 */
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

/**
 * The same tooltip for a delegated hover with no element bound: in-page links are
 * drawn again with the text around them, so a binding would be lost.
 */
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

// Math: KaTeX is fetched the first time a text node holds a $...$ pair, the only
// text auto-render can turn into math, so a page without math never fetches it.
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
