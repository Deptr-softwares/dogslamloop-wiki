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

// The shared tooltip: one element for every tooltip on the page (callouts, Frame
// Track phases, accolades, tier list portraits, in-page links and every data-tip
// hint), pinned above what it explains, or below it when there is no room above.
let frameTooltip = null;
let tooltipOwner = null;   // what it explains while it shows
let describedByTip = null; // the element whose aria-describedby the tooltip set
let tooltipTimer = null;   // a hint's wait, or the moment before it hides

window.initTooltip = function() {
    if (frameTooltip) return;
    frameTooltip = document.getElementById('wiki-frame-tooltip');
    if (!frameTooltip) {
        frameTooltip = document.createElement('div');
        frameTooltip.id = 'wiki-frame-tooltip';
        document.body.appendChild(frameTooltip);
    }
    frameTooltip.setAttribute('role', 'tooltip');
    frameTooltip.hidden = true;
    // The pointer can move onto it to read a long one.
    frameTooltip.addEventListener('mouseenter', () => clearTimeout(tooltipTimer));
    frameTooltip.addEventListener('mouseleave', hideTooltipSoon);
};

// Puts the tooltip in the open box that holds node, or on the page: a box is in the
// top layer, so a tooltip outside it draws under it whatever its z-index.
function hostTooltipFor(node) {
    const host = (node && node.closest && node.closest('dialog[open]')) || document.body;
    if (frameTooltip.parentNode !== host) host.appendChild(frameTooltip);
}

// Centred above the anchor, below it when there is no room above, and kept on
// screen on a narrow phone.
function placeTooltip(anchor) {
    const gap = 8;
    const edge = 8;
    const a = anchor.getBoundingClientRect();
    const box = frameTooltip.getBoundingClientRect();
    let x = a.left + a.width / 2 - box.width / 2;
    let y = a.top - box.height - gap;
    if (y < edge) y = a.bottom + gap;
    x = Math.min(Math.max(x, edge), window.innerWidth - box.width - edge);
    y = Math.min(Math.max(y, edge), window.innerHeight - box.height - edge);
    frameTooltip.style.left = x + 'px';
    frameTooltip.style.top = y + 'px';
}

/**
 * Shows the shared tooltip pinned to anchor: content is HTML, or with text, plain
 * text. While it shows, the anchor is described by it for a screen reader.
 * @since v1.3
 * @watch HTML content is put in as it is: escape what goes into it
 */
window.showTooltipFor = function(anchor, content, { text = false } = {}) {
    window.initTooltip();
    clearTimeout(tooltipTimer);
    if (describedByTip && describedByTip !== anchor) describedByTip.removeAttribute('aria-describedby');
    hostTooltipFor(anchor);
    if (text) frameTooltip.textContent = content;
    else frameTooltip.innerHTML = content;
    frameTooltip.hidden = false;
    placeTooltip(anchor);
    tooltipOwner = anchor;
    if (!anchor.hasAttribute('aria-describedby')) {
        anchor.setAttribute('aria-describedby', frameTooltip.id);
        describedByTip = anchor;
    }
};

window.hideTooltip = function() {
    clearTimeout(tooltipTimer);
    if (frameTooltip) frameTooltip.hidden = true;
    if (describedByTip) describedByTip.removeAttribute('aria-describedby');
    describedByTip = null;
    tooltipOwner = null;
};

// A moment's grace, so the pointer can cross the gap onto the tooltip.
function hideTooltipSoon() {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(window.hideTooltip, 150);
}

/**
 * Shows titleHtml in the shared tooltip on hover, on keyboard focus and on a tap.
 * An element a keyboard cannot reach is given tabindex 0, since a tooltip that
 * only shows on hover is invisible without a mouse.
 * @watch titleHtml is HTML: escape what goes into it
 */
window.bindTooltip = function(element, titleHtml) {
    if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.tabIndex = 0;
    element.addEventListener('mouseenter', () => window.showTooltipFor(element, titleHtml));
    element.addEventListener('mouseleave', hideTooltipSoon);
    element.addEventListener('focus', () => {
        if (element.matches(':focus-visible')) window.showTooltipFor(element, titleHtml);
    });
    element.addEventListener('blur', () => { if (tooltipOwner === element) window.hideTooltip(); });
    element.addEventListener('touchend', (e) => {
        // The browser's mouse events after a touch would toggle it straight back.
        e.preventDefault();
        if (tooltipOwner === element && !frameTooltip.hidden) window.hideTooltip();
        else window.showTooltipFor(element, titleHtml);
    });
};

// Hints: an element with data-tip shows its text, or the HTML of its hidden
// [data-tip-body] child as the page drew it, format tags and all. After half a
// second's hover, or at once with data-tip-now; on keyboard focus; and on a tap when
// it is not a control (a tap on a button presses it). Delegated, so an element
// drawn again keeps its hint.
const TIP_HOLDER = '[data-tip]';
const tipHolder = (node) => (node && node.closest ? node.closest(TIP_HOLDER) : null);
const CONTROL = 'a[href], button, input, select, textarea, summary, label';
const tipBody = (el) => el.querySelector(':scope > [data-tip-body]');
const hasHint = (el) => !!(el.dataset.tip || tipBody(el));
const showHint = (el) => {
    const body = tipBody(el);
    if (body) window.showTooltipFor(el, body.innerHTML);
    else window.showTooltipFor(el, el.dataset.tip, { text: true });
};

// Pointer events, not mouse events: a tap fires the mouse events too, and would
// show a button's hint after it was pressed. A tap is the click listener's.
document.addEventListener('pointerover', (e) => {
    const el = tipHolder(e.target);
    if (e.pointerType === 'touch' || !el || el === tipHolder(e.relatedTarget) || !hasHint(el)) return;
    clearTimeout(tooltipTimer);
    if (el.hasAttribute('data-tip-now')) showHint(el);
    else tooltipTimer = setTimeout(() => showHint(el), 500);
});
document.addEventListener('pointerout', (e) => {
    const el = tipHolder(e.target);
    if (e.pointerType === 'touch' || !el || el === tipHolder(e.relatedTarget)) return;
    if (tooltipOwner === el) hideTooltipSoon();
    else clearTimeout(tooltipTimer);
});
document.addEventListener('focusin', (e) => {
    const el = tipHolder(e.target);
    if (el && el === e.target && hasHint(el) && el.matches(':focus-visible')) showHint(el);
});
document.addEventListener('focusout', (e) => {
    if (tooltipOwner && tooltipOwner === tipHolder(e.target)) window.hideTooltip();
});
document.addEventListener('click', (e) => {
    const el = tipHolder(e.target);
    if (el && hasHint(el) && !el.matches(CONTROL) && tooltipOwner !== el) showHint(el);
});

// A press anywhere but on the tooltip or what it explains closes it, as a tap does
// on a phone.
document.addEventListener('pointerdown', (e) => {
    if (!tooltipOwner || frameTooltip.contains(e.target) || tooltipOwner.contains(e.target)) return;
    window.hideTooltip();
}, true);

// Escape closes the tooltip and only the tooltip, as it closes an open dropdown
// before the box it is in.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !frameTooltip || frameTooltip.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    window.hideTooltip();
}, true);

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
