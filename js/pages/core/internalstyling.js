/**
 * The format tags ([b], [color=], [url=], [multicolor=], [icon=], [noauto] and the
 * rest) and the automatic colours: character names, frame-data terms, frame
 * timings, a page's own words, and move names by input slot. Runs over every text
 * Block on the page, and again whenever content lands.
 * @since v0.01
 * @touches CHARACTER_COLORS, CHARACTER_ALIASES, FRAME_COLORS, WINDOW_COLORS and
 *   ACCOLADES (site_meta.js), desc_data.pageConfig.words, data/navigation.json,
 *   buildMoveSlotMap (input_slots.js)
 * @watch it reads a Block's innerHTML, rewrites it as a string and writes it back,
 *   so every value it puts in goes through escapeHtml, safeUrl or safeColor, and
 *   one that fails stays plain text
 * @watch a Block is styled once (.is-styled): running the tags twice would eat
 *   their own output
 * @see docs/format-tags.md
 */

// Allowed: http(s), mailto, a site path, a fragment, or a bare relative path. An
// allowlist, because javascript:, data: and vbscript: execute, and a scheme nobody
// thought of cannot slip past one. "//" is refused: an off-site jump that does not
// look like one.
const SAFE_URL_PATTERN = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+|#[^\s]*|\/(?!\/)[^\s]*|[\w.~-][^\s:]*)$/i;

function safeUrl(raw) {
    const url = String(raw == null ? '' : raw).trim();
    if (!url || !SAFE_URL_PATTERN.test(url)) return null;
    // A colon before the first slash is a scheme this whitelist did not match.
    const firstSlash = url.indexOf('/');
    const firstColon = url.indexOf(':');
    if (firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash)
        && !/^(?:https?|mailto):/i.test(url)) return null;
    return url;
}

// A colour is a small closed grammar, so it is allowlisted, not escaped: anything
// outside it is trying to leave the style attribute.
const SAFE_COLOR_PATTERN =
    /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/+-]+\)|var\(\s*--[\w-]+\s*\)|[a-z]{3,20})$/i;

/**
 * The colour if it is one (hex, rgb(), hsl(), var(--x) or a name), otherwise null.
 * For any stored colour that lands in a style attribute.
 * @since v0.14
 */
function safeColor(raw) {
    const color = String(raw == null ? '' : raw).trim();
    return SAFE_COLOR_PATTERN.test(color) ? color : null;
}
window.safeColor = safeColor;


// [multicolor=a,b,...] sweeps the text from the first colour to the last, one span
// per visible character. Each stop goes through a probe element and comes back as
// rgb(), because var(--x) and named colours cannot be read as numbers here. One
// probe, parented to <html> so custom properties resolve against the real cascade.
let colorProbe = null;

function resolveColorChannels(color) {
    if (typeof document === 'undefined') return null;
    if (!colorProbe) {
        colorProbe = document.createElement('span');
        // Out of flow and out of the accessibility tree: this element exists
        // only to be measured, and it must never affect layout or be read out.
        colorProbe.setAttribute('aria-hidden', 'true');
        colorProbe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
        document.documentElement.appendChild(colorProbe);
    }
    // Cleared first: an invalid value leaves the PREVIOUS colour in place,
    // so without this a bad stop would silently inherit the one before it.
    colorProbe.style.color = '';
    colorProbe.style.color = color;
    if (!colorProbe.style.color) return null;

    const computed = getComputedStyle(colorProbe).color;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(computed || '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Splits converted HTML into per-character spans along a gradient. It walks the
 * string, because it runs on half-built HTML, and keeps these whole: tags (nested
 * tags are converted first), entities (one character to a reader), spaces (left
 * unwrapped), and the [noauto] and [url] tags that convert after it. Only visible
 * characters count, so the sweep is even.
 */
function splitGradient(html, stops) {
    const units = [];
    let i = 0;
    while (i < html.length) {
        const ch = html[i];
        if (ch === '<') {
            const close = html.indexOf('>', i);
            if (close === -1) { units.push({ raw: html.slice(i), visible: false }); break; }
            units.push({ raw: html.slice(i, close + 1), visible: false });
            i = close + 1;
            continue;
        }
        if (ch === '[') {
            const later = /^\[(?:\/?noauto|noauto=all|url=[^\]]+|\/url)\]/i.exec(html.slice(i));
            if (later) {
                units.push({ raw: later[0], visible: false });
                i += later[0].length;
                continue;
            }
        }
        if (ch === '&') {
            const semi = html.indexOf(';', i);
            // A bare ampersand is just a character; only a short, well-formed
            // reference is treated as one unit.
            if (semi !== -1 && semi - i <= 10 && /^&#?\w+;$/.test(html.slice(i, semi + 1))) {
                units.push({ raw: html.slice(i, semi + 1), visible: true });
                i = semi + 1;
                continue;
            }
        }
        units.push({ raw: ch, visible: !/\s/.test(ch) });
        i += 1;
    }

    const total = units.filter(u => u.visible).length;
    if (total === 0) return html;

    const lerp = (a, b, t) => Math.round(a + (b - a) * t);

    let seen = 0;
    return units.map(unit => {
        if (!unit.visible) return unit.raw;

        // One visible character takes the first stop, rather than dividing by zero.
        const t = total === 1 ? 0 : seen / (total - 1);
        seen += 1;

        // Which pair of stops this character falls between, and how far along.
        const span = 1 / (stops.length - 1);
        let idx = Math.min(Math.floor(t / span), stops.length - 2);
        const local = span === 0 ? 0 : (t - idx * span) / span;

        const from = stops[idx];
        const to = stops[idx + 1];
        const rgb = `rgb(${lerp(from[0], to[0], local)}, ${lerp(from[1], to[1], local)}, ${lerp(from[2], to[2], local)})`;

        return `<span class="sc-mc" style="color: ${rgb};">${unit.raw}</span>`;
    }).join('');
}

// Spellings the community uses beside the legend's own wording. Kept small: an
// alias says two phrases mean the same thing, which is a game judgement. Block
// Endlag is the blocker's stun; the attacker's endlag on block is Recovery.
const TERM_ALIASES = {
    'bg-tick-recov': ['Whiff Endlag', 'Extended Recovery'],
    'bg-tick-blockendlag': ['Block Stun'],
};

// A literal term becomes a tolerant pattern: spaces match runs of whitespace
// because KaTeX inserts non-breaking ones, and the hyphen in "I-Frames" is
// optional because people type it both ways.
function termPattern(text) {
    return window.escapeRegExp(text)
        .replace(/ /g, '\\s+')
        .replace(/-/g, '[-\\s]?');
}

// Separators are removed, not collapsed: the pattern accepts "Bullet Iframes" and
// "Bullet I-Frames", so both must make the same key.
function normalizeTerm(text) {
    return String(text).toLowerCase().replace(/[\s-]+/g, '');
}

// One combined pattern, one pass: a global replace never re-scans what it inserted,
// so a term cannot be wrapped inside a longer one ("Recovery" in "Extended Recovery").
function buildHighlightTerms() {
    const colors = Object.assign({}, window.FRAME_COLORS || {}, window.WINDOW_COLORS || {});
    const labels = window.FRAME_COLOR_LABELS || {};

    const byName = new Map();
    Object.keys(colors).forEach(token => {
        const color = safeColor(colors[token]);
        if (!color) return;
        [labels[token]].concat(TERM_ALIASES[token] || []).forEach(name => {
            if (name) byName.set(normalizeTerm(name), { name, color });
        });
    });

    // Longest first: JS alternation is first-match, not longest-match, so
    // without this "Recovery" would win over "Extended Recovery" again.
    const entries = Array.from(byName.values()).sort((a, b) => b.name.length - a.name.length);
    if (!entries.length) return null;

    return {
        lookup: byName,
        pattern: new RegExp(`\\b(${entries.map(e => termPattern(e.name)).join('|')})\\b(?![^<]*>)`, 'gi'),
    };
}

// Canonical names plus every alias, in one pass for the same reason the frame
// terms are: alternation is first-match, so "Yuji" would otherwise win over
// "Itadori Yuji" and leave "Itadori" bare, and a per-name replace would let a
// short alias re-wrap text a long one had already claimed.
function buildCharacterTerms() {
    const colors = window.CHARACTER_COLORS || {};
    const aliases = window.CHARACTER_ALIASES || {};

    const byName = new Map();
    Object.keys(colors).forEach(canonical => {
        const color = safeColor(colors[canonical]);
        if (!color) return;
        [canonical].concat(aliases[canonical] || []).forEach(name => {
            if (name) byName.set(normalizeTerm(name), { canonical, color });
        });
    });

    const names = [];
    Object.keys(colors).forEach(canonical => {
        [canonical].concat(aliases[canonical] || []).forEach(n => { if (n) names.push(n); });
    });
    if (!names.length) return null;

    names.sort((a, b) => b.length - a.length);
    return {
        lookup: byName,
        // Case-sensitive on purpose: "Register", "Perfection" and "Active" are
        // ordinary words, and matching them case-insensitively would tint
        // half the prose on the site. A name written lowercase goes unstyled,
        // which is the safe direction to fail in.
        pattern: new RegExp(`\\b(${names.map(termPattern).join('|')})\\b(?![^<]*>)`, 'g'),
    };
}

// [noauto] lifts its text out before the automatic colours run and puts it back
// after, since a regex over a string cannot skip a region. The placeholder is plain
// ASCII, so it shows in source. [noauto=all] also stops the page's own words; plain
// [noauto] stops the built-in colours only.
const NOAUTO_OPEN = '%%DSL_NOAUTO_';
const NOAUTO_CLOSE = '%%';

function liftNoAuto(content, store) {
    return content.replace(/\[noauto(=all)?\]([\s\S]*?)\[\/noauto\]/gi, (whole, all, inner) => {
        store.push({ inner, all: !!all });
        return `${NOAUTO_OPEN}${store.length - 1}${NOAUTO_CLOSE}`;
    });
}

// Put back inside a marker span: the move-name pass (applyInputSlotColours) runs
// later, where the tag is gone, and the span is how it sees the protected words.
function restoreNoAuto(content, store) {
    if (!store.length) return content;
    return content.replace(
        new RegExp(`${NOAUTO_OPEN}(\\d+)${NOAUTO_CLOSE}`, 'g'),
        (whole, index) => {
            const region = store[Number(index)];
            if (!region) return whole;
            return `<span class="sc-noauto${region.all ? ' sc-noauto-all' : ''}">${region.inner}</span>`;
        }
    );
}

/**
 * Page words: up to this many words in desc_data.pageConfig.words, each with one
 * colour or a gradient, coloured on that page only (the editor's Config > Page).
 * @since v1.1
 * @watch whole words in their exact case. Built-in colours win where the two meet:
 *   page words paint only the text the other passes left plain, over text nodes,
 *   because the HTML string cannot tell inside an automatic colour from outside one
 */
window.PAGE_WORD_LIMIT = 50;

// Whose words: the page in the editor, the version a reviewer is looking at,
// or the page being read. Never another page's.
function currentPageConfig() {
    // The whole page, not the character state being edited: the settings
    // belong to the page.
    if (window.editorMasterDescData) return window.editorMasterDescData.pageConfig || null;
    // The Overseer: Diff View is the proposed version, so it takes those words.
    if (window.activePreviewRevId) {
        const desc = window.activePreviewViewMode === 'live'
            ? window.currentLiveDescData : window.currentPendingDescData;
        return (desc && desc.pageConfig) || null;
    }
    const pageId = window.PAGE_ROUTE && window.PAGE_ROUTE.pageId;
    return (pageId && (window.readerPageConfigs || {})[pageId]) || null;
}

// How innerHTML serialises text, so a word matches the text it will sit in.
function escPageText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rebuilt only when the list changes: a gradient's stops are resolved through
// the colour probe, which costs a style recalculation per stop, and this runs
// on every DOM change the editor's preview makes.
let pageWordsCache = { key: null, value: null };

function buildPageWords() {
    const config = currentPageConfig();
    const list = config && Array.isArray(config.words) ? config.words.slice(0, window.PAGE_WORD_LIMIT) : [];
    const key = JSON.stringify(list);
    if (key === pageWordsCache.key) return pageWordsCache.value;

    const byText = new Map();
    list.forEach(entry => {
        const word = escPageText(String((entry && entry.word) || '').trim().replace(/\s+/g, ' '));
        // The first listing wins, so a word listed twice has one answer.
        if (!word || byText.has(word)) return;
        // Refused whole on any bad colour, the [multicolor] rule above.
        const colors = Array.isArray(entry.colors) ? entry.colors.map(safeColor) : [];
        if (!colors.length || colors.includes(null)) return;
        if (colors.length === 1) {
            byText.set(word, { color: colors[0] });
            return;
        }
        const stops = colors.map(resolveColorChannels);
        if (!stops.includes(null)) byText.set(word, { stops });
    });

    let value = null;
    if (byText.size) {
        // Longest first, because alternation is first-match. Never straight
        // after an "&", so a word like "amp" cannot split an escaped "&amp;".
        const source = Array.from(byText.keys())
            .sort((a, b) => b.length - a.length)
            .map(w => w.split(' ').map(part => window.escapeRegExp(part)).join('\\s+'))
            .join('|');
        value = { lookup: byText, pattern: new RegExp(`(?<![\\w&])(${source})(?!\\w)`, 'g') };
    }
    pageWordsCache = { key, value };
    return value;
}

// Text inside these already has its colour, or was protected by [noauto=all].
const PAGE_WORD_SKIP = '.sc-auto, .sc-timing, .sc-noauto-all';

function paintPageWords(block, words) {
    if (!words) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const owner = node.parentElement && node.parentElement.closest(PAGE_WORD_SKIP);
            return owner && block.contains(owner) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
        const before = escPageText(node.nodeValue);
        words.pattern.lastIndex = 0;
        let matched = false;
        const after = before.replace(words.pattern, (match) => {
            const entry = words.lookup.get(match.replace(/\s+/g, ' '));
            if (!entry) return match;
            matched = true;
            return entry.stops
                ? `<span class="sc-auto sc-page-word sc-page-gradient">${splitGradient(match, entry.stops)}</span>`
                : `<span class="sc-auto sc-page-word" style="color: ${window.escapeHtml(entry.color)};">${match}</span>`;
        });
        if (!matched) return;
        const tpl = document.createElement('template');
        tpl.innerHTML = after;
        node.replaceWith(tpl.content);
    });
}

/**
 * Paints page words again after Config > Page changes the list. A Block is styled
 * once, so this repaints in place; a solid word's children are kept, since a move's
 * colour may sit inside it.
 * @since v1.1
 */
window.refreshPageWords = function () {
    document.querySelectorAll('.sc-page-word').forEach(span => {
        const parent = span.parentNode;
        if (span.classList.contains('sc-page-gradient')) span.replaceWith(document.createTextNode(span.textContent));
        else span.replaceWith(...span.childNodes);
        if (parent) parent.normalize();
    });
    const words = buildPageWords();
    if (!words) return;
    document.querySelectorAll('.is-styled').forEach(block => paintPageWords(block, words));
};

/**
 * The built-in colour or move name a page word runs into, or null, so Config > Page
 * can say the word will not colour there.
 * @since v1.1
 */
window.pageWordBuiltIn = function (word) {
    const text = String(word || '').trim();
    if (!text) return null;
    const first = (terms) => {
        if (!terms) return null;
        terms.pattern.lastIndex = 0;
        const hit = terms.pattern.exec(text);
        return hit ? hit[0] : null;
    };
    const builtIn = first(buildCharacterTerms()) || first(buildHighlightTerms());
    if (builtIn) return { kind: 'builtin', term: builtIn };
    const move = first(currentPageMoveSlots());
    return move ? { kind: 'move', term: move } : null;
};

// Move names coloured by input slot. JJS combos are written name-first ("MURMURATE
// > R^ > AIR UPDRAFT"), so colouring needs each name's slot. The map comes from
// frame_data's `input` (input_slots.js), and follows the active mode.
function currentPageMoveSlots() {
    if (typeof window.buildMoveSlotMap !== 'function') return null;

    const pageId = (window.PAGE_ROUTE && window.PAGE_ROUTE.pageId)
        || window.activePreviewCharId || window.currentEditorCharId;
    if (!pageId) return null;

    // The Overseer loads a revision into currentPending* and currentLive*. Pending
    // first: the reviewer is looking at the proposed version, so a move it adds colours
    // too.
    let frame = (window.cachedMasterFrameData || {})[pageId]
        || window.currentEditorFrameData
        || window.currentPendingFrameData
        || window.currentLiveFrameData
        || null;
    if (!frame) return null;

    // The active state's slice, when there is one; a page with no states uses the master.
    const mode = window.activeCharacterMode || window.activePreviewMode;
    if (mode && !((window.isBaseMode && window.isBaseMode(mode)))
        && frame.modeData && frame.modeData[mode]) {
        frame = Object.assign({}, frame, frame.modeData[mode]);
    }

    // The same sources in the same order: characterSettings overrides live in
    // desc_data, so a reviewer resolves names the way a reader does.
    const desc = window.currentPageDescData
        || window.currentEditorDescData
        || window.currentPendingDescData
        || window.currentLiveDescData
        || null;
    const map = window.buildMoveSlotMap(frame, desc);
    if (!map || map.size === 0) return null;

    // Longest first: alternation is first-match, so "Cursed Strikes" would
    // otherwise win over "Aerial Cursed Strikes" and leave "Aerial" bare.
    // Vessel has both, so this is not hypothetical.
    const names = Array.from(map.keys()).sort((a, b) => b.length - a.length);

    return {
        lookup: map,
        pattern: new RegExp(`(?<![\\w-])(${names.map(moveNamePattern).join('|')})(?![\\w-])(?![^<]*>)`, 'gi'),
    };
}

// A move name as written. The map's names are normalised (a hyphen is a space
// there), so each space matches a run of spaces and hyphens. Split before
// termPattern, whose output has no spaces left to split on.
const MOVE_NAME_SEPARATOR = '[\\s\\u2010-\\u2015-]+';
function moveNamePattern(name) {
    return String(name).split(/\s+/).map(termPattern).join(MOVE_NAME_SEPARATOR);
}

// The bare keys ("M1", "2", "R"), only ever inside a combo chip: a lone "2" in prose
// is a number far more often than an input. A trailing direction is part of the
// input ("R^", the arrows, A/W/S/D).
function inputKeyPattern() {
    const ids = (window.INPUT_SLOT_IDS || []).slice().sort((a, b) => b.length - a.length);
    if (!ids.length) return null;
    const keys = ids.map(termPattern).join('|');
    const direction = '(?:\\s*[+]?\\s*(?:[\\u2190-\\u2193\\u21D0-\\u21D3^v<>]|\\b[AWSD]\\b))*';
    return new RegExp(`^\\s*(${keys})${direction}\\s*$`, 'i');
}

// Move names and bare keys, for matching inside one compound step. Names first and
// longest first, so "Air Updraft" is claimed before "Updraft" or a "1" in a name.
// The keys are bounded by non-alphanumerics, so "(X3)" and "M1 x3" keep their digits.
function compoundPattern(terms) {
    const names = Array.from(terms.lookup.keys()).sort((a, b) => b.length - a.length);
    const keys = (window.INPUT_SLOT_IDS || []).slice().sort((a, b) => b.length - a.length);
    if (!names.length && !keys.length) return null;

    // Each space matches a hyphen too, or "Dive-Bomb (whiff)" finds nothing.
    const namePart = names.length ? `(?<![\\w-])(?:${names.map(moveNamePattern).join('|')})(?![\\w-])` : null;
    const keyPart = keys.length ? `(?<![A-Za-z0-9])(?:${keys.map(termPattern).join('|')})(?![A-Za-z0-9])` : null;

    return new RegExp([namePart, keyPart].filter(Boolean).join('|'), 'gi');
}

// Colours combo chips by input slot, and move names in Combos and Techs prose.
window.applyInputSlotColours = function (root) {
    const scope = root || document;
    const terms = currentPageMoveSlots();
    const keyPattern = inputKeyPattern();

    // Combo chips. A chip is one step, matched whole against the keys first ("2" as a
    // chip is Skill 2), then against move names. A chip is marked done only once the
    // move map exists: the first styling pass runs before the frame data lands.
    scope.querySelectorAll('.combo-node:not(.is-slotted)').forEach(chip => {
        if (terms) chip.classList.add('is-slotted');
        const text = chip.textContent || '';

        if (keyPattern) {
            const whole = keyPattern.exec(text.trim());
            if (whole) {
                const slot = window.getInputSlot(whole[1]);
                if (slot) { chip.classList.add(slot.cls); return; }
            }
        }

        if (!terms) return;
        const direct = terms.lookup.get(window.normaliseMoveName(text));
        if (direct) {
            const slot = window.getInputSlot(direct);
            if (slot) chip.classList.add(slot.cls);
            return;
        }

        // A compound step ("R (Upward, Cancel Murmurate)", "BIRD CONTROL(S)") cannot take
        // one colour, so every move name and bare key in it is coloured in place.
        const compound = compoundPattern(terms);
        if (!compound) return;
        compound.lastIndex = 0;

        let matched = false;
        const replaced = window.escapeHtml(text).replace(compound, (match) => {
            const id = terms.lookup.get(window.normaliseMoveName(match));
            const slot = window.getInputSlot(id || match);
            if (!slot) return match;
            matched = true;
            return `<span class="sc-auto ${slot.cls}">${match}</span>`;
        });

        // Wrapped in one inline child: .combo-node is inline-flex, and a flex container
        // drops the whitespace between its items ("CancelMurmurate").
        if (matched) chip.innerHTML = `<span class="combo-node-text">${replaced}</span>`;
    });

    // Move names in prose, only inside a document tab (Combos, Techs): site-wide they
    // would tint the frame-data pages, where every name appears dozens of times. The
    // tabs come from the registry, so a third document tab is not forgotten.
    if (!terms) return;
    if (!scope.querySelector) return;

    const documentTabIds = window.getDocumentTabIds ? window.getDocumentTabIds() : ['combos'];
    const hosts = [];
    documentTabIds.forEach(tabId => {
        if (scope.id === `tab-${tabId}`) hosts.push(scope);
        else {
            const found = scope.querySelector(`#tab-${tabId}`);
            if (found) hosts.push(found);
        }
    });
    if (!hosts.length) return;

    // Text node by text node, so a [noauto] region (.sc-noauto) can be skipped.
    hosts.forEach(host => {
        host.querySelectorAll('.is-styled:not(.is-slotted-prose)').forEach(block => {
            block.classList.add('is-slotted-prose');

            // A page word that is a move name gives way to the move's colour, as built-in
            // colours win over page words. Inside [noauto] the move colour is stopped, so the
            // page word stays.
            let unwrapped = false;
            block.querySelectorAll('.sc-page-word').forEach(word => {
                if (word.closest('.sc-noauto')) return;
                if (!terms.lookup.get(window.normaliseMoveName(word.textContent))) return;
                word.replaceWith(document.createTextNode(word.textContent));
                unwrapped = true;
            });
            if (unwrapped) block.normalize();

            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => node.parentElement && node.parentElement.closest('.sc-noauto')
                    ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
            });
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            textNodes.forEach(node => {
                // escPageText, not escapeHtml: it escapes the way innerHTML
                // writes text (&, < and > only), so a move name with an
                // apostrophe still matches.
                const before = escPageText(node.nodeValue);
                terms.pattern.lastIndex = 0;
                let matched = false;
                const after = before.replace(terms.pattern, (match) => {
                    const id = terms.lookup.get(window.normaliseMoveName(match));
                    const slot = id && window.getInputSlot(id);
                    if (!slot) return match;
                    matched = true;
                    return `<span class="sc-auto ${slot.cls}">${match}</span>`;
                });
                if (!matched) return;
                const tpl = document.createElement('template');
                tpl.innerHTML = after;
                node.replaceWith(tpl.content);
            });
        });
    });
};

// Mini icons: [icon=accolade/<id>], [icon=character/<page id>] and [icon=ui/<name>].
// The name is a closed grammar checked before anything is built, and a name this
// file does not know stays as the typed tag, so the mistake shows in the preview.
const TEXT_ICON_SOURCE = String.raw`\[icon=([a-z]+)\/([a-z0-9_-]{1,64})\]`;
const TEXT_ICON_TAG = new RegExp(TEXT_ICON_SOURCE, 'gi');

/**
 * Whether a whole tag is a mini icon, by the same grammar, so the editor's writing
 * checks keep no copy of it.
 * @since v1.2
 */
window.isTextIconTag = (tag) => new RegExp(`^${TEXT_ICON_SOURCE}$`, 'i').test(String(tag));

function textIconHTML(tag, group, name) {
    if (group === 'accolade') {
        const accolade = (window.ACCOLADES || []).find(a => a.id === name);
        return accolade && typeof window.accoladeIconHTML === 'function'
            ? window.accoladeIconHTML(accolade, { inText: true }) || null
            : null;
    }
    if (group === 'character') {
        const file = typeof window.rosterIconPath === 'function' ? window.rosterIconPath(name) : null;
        if (!file) return null;
        // Named once the roster is in (nameCharacterIcons below): the tag
        // carries the page id, which never changes, and a reader knows the name.
        return `<img class="text-icon text-icon-character" src="/${window.escapeHtml(file)}" alt=""`
             + ` data-character-id="${window.escapeHtml(name)}" data-icon-tag="${window.escapeHtml(tag)}" loading="lazy">`;
    }
    // The site's icons, in the colour of the text around them.
    if (group === 'ui') {
        return typeof window.uiIconHTML === 'function' ? window.uiIconHTML(name, { inText: true }) || null : null;
    }
    return null;
}

// A character's icon is found by the roster's file convention, so a page id
// with no file behind it (a typo, or a character whose icon is not uploaded
// yet) only shows once its image fails. It then goes back to the tag as typed.
function watchTextIcon(img) {
    const restore = () => img.replaceWith(document.createTextNode(img.dataset.iconTag || ''));
    if (img.complete) {
        if (!img.naturalWidth) restore();
        return;
    }
    img.addEventListener('error', restore, { once: true });
}

/**
 * Styles every text Block on the page not styled yet: format tags first, then the
 * automatic colours (characters, frame terms, timings, page words), then input-slot
 * colours (the wrapper at the end of this file).
 * @since v0.01
 * @watch called from a dozen places and by a MutationObserver on <main>; each Block
 *   is marked .is-styled and never styled twice
 */
function applyInternalStyling() {
    // Headings and list items are matched by their own class as well: in a .tab-content
    // panel (Overview, Combos, M1s) nothing reaches them through .vessel-content. The
    // .vessel-content entries stay for system pages and move cards, whose prose has no
    // Block class.
    const textBlocks = document.querySelectorAll(
        '.wiki-text:not(.is-styled), .strategy-paragraph:not(.is-styled),'
        + ' .wiki-block-heading:not(.is-styled), .wiki-block-list li:not(.is-styled),'
        + ' .vessel-content p:not(.is-styled), .vessel-content li:not(.is-styled),'
        + ' .vessel-content h2:not(.is-styled), .vessel-content h3:not(.is-styled),'
        + ' .vessel-content h4:not(.is-styled),'
        // Gallery captions: built with textContent, so what this reads back is escaped.
        + ' .gallery-card-name:not(.is-styled), .gallery-card-note:not(.is-styled),'
        // A Combo Card's name, and each section's: escaped when drawn.
        + ' .theorybox-title:not(.is-styled),'
        + ' .update-table th:not(.is-styled), .update-table td:not(.is-styled)');
    
    const characterColors = window.CHARACTER_COLORS || {};
    const characterTerms = buildCharacterTerms();

    const highlightTerms = buildHighlightTerms();

    const pageWords = textBlocks.length ? buildPageWords() : null;

    // Timings take the page character's colour.
    const pageTitleEl = document.querySelector('.character-title');
    let currentCharColor = 'var(--text-white)';
    if (pageTitleEl && characterColors[pageTitleEl.textContent.trim()]) {
        currentCharColor = characterColors[pageTitleEl.textContent.trim()];
    }

    textBlocks.forEach(block => {
        block.classList.add('is-styled');
        let content = block.innerHTML;

        // Mini icons first, so every pass below meets them as markup and steps over them.
        content = content.replace(TEXT_ICON_TAG,
            (tag, group, name) => textIconHTML(tag, group.toLowerCase(), name.toLowerCase()) || tag);

        // Tags, inside out: the loop runs until nothing changes, so nested tags convert.
        let previousContent;
        do {
            previousContent = content;
            
            content = content.replace(/\[b\]((?:(?!\[b\])[\s\S])*?)\[\/b\]/gi, '<strong class="sc-b">$1</strong>');
            content = content.replace(/\[i\]((?:(?!\[i\])[\s\S])*?)\[\/i\]/gi, '<em class="sc-i">$1</em>');
            content = content.replace(/\[u\]((?:(?!\[u\])[\s\S])*?)\[\/u\]/gi, '<span class="sc-u">$1</span>');
            content = content.replace(/\[s\]((?:(?!\[s\])[\s\S])*?)\[\/s\]/gi, '<span class="sc-s">$1</span>');
            content = content.replace(/\[code\]((?:(?!\[code\])[\s\S])*?)\[\/code\]/gi, '<code class="sc-code">$1</code>');
            // <kbd>, so screen readers and search engines get the meaning too.
            content = content.replace(/\[kbd\]((?:(?!\[kbd\])[\s\S])*?)\[\/kbd\]/gi, '<kbd class="sc-kbd">$1</kbd>');
            // A white outline, drawn the way the site outlines a dark character name
            // (style/Common.css).
            content = content.replace(/\[outline\]((?:(?!\[outline\])[\s\S])*?)\[\/outline\]/gi, '<span class="sc-outline">$1</span>');

            // A colour goes into a style attribute: refused, not escaped, when it is not one.
            // Refusing keeps the words and drops the tint.
            content = content.replace(/\[color=([^\]]+)\]((?:(?!\[color=)[\s\S])*?)\[\/color\]/gi,
                (whole, rawColor, inner) => {
                    const color = safeColor(rawColor);
                    return color
                        ? `<span class="sc-color" style="color: ${window.escapeHtml(color)};">${inner}</span>`
                        : inner;
                });

            // The same colour grammar, two or more stops. Refused whole, never per stop:
            // dropping one bad stop of three draws a gradient nobody asked for.
            content = content.replace(/\[multicolor=([^\]]+)\]((?:(?!\[multicolor=)[\s\S])*?)\[\/multicolor\]/gi,
                (whole, rawStops, inner) => {
                    const raw = rawStops.split(',');
                    if (raw.length < 2) return inner;

                    const stops = [];
                    for (const one of raw) {
                        const safe = safeColor(one);
                        const rgb = safe ? resolveColorChannels(safe) : null;
                        if (!rgb) return inner;
                        stops.push(rgb);
                    }
                    return splitGradient(inner, stops);
                });

            // A refused address renders as its label. rel, because target="_blank" without it
            // hands the opened page window.opener. A fragment is an in-page link with no
            // target: pagebuilder.js resolves .wiki-link-jump, across tabs too.
            content = content.replace(/\[url=([^\]]+)\]((?:(?!\[url=)[\s\S])*?)\[\/url\]/gi,
                (whole, rawUrl, label) => {
                    // Read back out of innerHTML, where a typed & < > are
                    // entities: decoded here, so the escape below is the only one.
                    const url = safeUrl(rawUrl.replace(/&(amp|lt|gt);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>' })[e]));
                    if (!url) return label;
                    if (url.charAt(0) === '#') {
                        return `<a href="${window.escapeHtml(url)}" class="wiki-link wiki-link-jump">${label}</a>`;
                    }
                    return `<a href="${window.escapeHtml(url)}" class="wiki-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
                });

        } while (content !== previousContent);

        // Everything below auto-matches ordinary English, so [noauto] regions
        // come out here and go back in at the end.
        const protectedRegions = [];
        content = liftNoAuto(content, protectedRegions);

        // Character names. data-character carries the canonical name, for linking below. A
        // name whose own colour is dark gets sc-char-dark, which Common.css outlines in
        // white only on a dark character page. Darkness comes from isDarkCharacterColor, so
        // the title, --character-ink and this never disagree.
        if (characterTerms) {
            content = content.replace(characterTerms.pattern, (match) => {
                const entry = characterTerms.lookup.get(normalizeTerm(match));
                if (!entry) return match;
                const dark = typeof window.isDarkCharacterColor === 'function'
                    && window.isDarkCharacterColor(entry.color);
                return `<span class="sc-auto sc-char${dark ? ' sc-char-dark' : ''}"`
                     + ` data-character="${window.escapeHtml(entry.canonical)}"`
                     + ` style="color: ${window.escapeHtml(entry.color)};">${match}</span>`;
            });
        }

        // Frame-data and overlay terms.
        if (highlightTerms) {
            content = content.replace(highlightTerms.pattern, (match) => {
                const entry = highlightTerms.lookup.get(normalizeTerm(match));
                if (!entry) return match;
                return `<span class="sc-auto" style="color: ${window.escapeHtml(entry.color)};">${match}</span>`;
            });
        }

        // Frame timings, in one pass with ranges first: "5-8f" is an active window, and a
        // second pass would find the "-8f" inside the first one's span.
        const timingRegex = new RegExp(
            '('
            + '\\(?\\b\\d+\\s*-\\s*\\d+f\\b\\)?|\\(?\\bf\\d+\\s*-\\s*\\d+\\b\\)?'  // ranges, first
            + '|\\([-+]?\\d+f\\)|\\([-+]?f\\d+\\)'
            + '|\\b\\d+f\\b|\\bf\\d+\\b|[-+]\\d+f\\b|[-+]f\\d+\\b'
            + ')(?![^<]*>)', 'gi');

        content = content.replace(timingRegex, (match) => {
            let finalColor = currentCharColor;

            // A range is neither advantage nor disadvantage - the hyphen in
            // "5-8f" is a span, not a minus - so it keeps the page's colour.
            const isRange = /\d\s*-\s*\d/.test(match);

            if (!isRange && match.includes('+')) {
                finalColor = 'hsl(127, 59%, 58%)';
            } else if (!isRange && match.includes('-')) {
                finalColor = 'hsl(3, 93%, 63%)';
            }

            const color = safeColor(finalColor) || 'var(--text-white)';
            return `<span class="sc-timing" style="color: ${window.escapeHtml(color)};">${match}</span>`;
        });

        content = restoreNoAuto(content, protectedRegions);

        block.innerHTML = content;
        block.querySelectorAll('img.text-icon-character').forEach(watchTextIcon);
        paintPageWords(block, pageWords);
    });
}

// Character mentions link to their pages, in a separate DOM pass: the styling pass
// is synchronous and must not run twice, so it cannot wait for the roster. Step B
// leaves marked spans, and this wraps them whenever the roster is here. It is safe
// on every observer tick: a wrapped span carries sc-linked.
let characterPageUrls = null;
let characterNamesById = null;

async function loadCharacterPageUrls() {
    if (characterPageUrls) return characterPageUrls;
    try {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
        const nav = window.fetchJson
            ? await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true })
            : await (await fetch(`${rootPath}data/navigation.json`)).json();

        const map = new Map();
        const names = new Map();
        (nav.Characters || []).forEach(entry => {
            if (entry && entry.name && entry.url) map.set(entry.name, rootPath + entry.url);
            const pageId = entry && entry.cms_config && entry.cms_config.pageId;
            if (pageId && entry.name) names.set(pageId, entry.name);
        });
        characterPageUrls = map;
        characterNamesById = names;
    } catch (e) {
        // A wiki that cannot reach its own roster still renders; the mentions
        // just stay unlinked, and the icons unnamed.
        characterPageUrls = new Map();
        characterNamesById = new Map();
    }
    return characterPageUrls;
}

// A character's icon in text is named once the roster is in, for a screen
// reader and on hover. Part of the same pass as the links, so wherever
// mentions get linked, icons get named.
function nameCharacterIcons() {
    if (!characterNamesById || !characterNamesById.size) return;
    document.querySelectorAll('img.text-icon-character:not([title])').forEach(img => {
        const name = characterNamesById.get(img.dataset.characterId);
        if (!name) return;
        img.title = name;
        img.alt = name;
    });
}

function linkCharacterMentions() {
    nameCharacterIcons();
    if (!characterPageUrls || !characterPageUrls.size) return;

    document.querySelectorAll('.sc-char:not(.sc-linked)').forEach(span => {
        span.classList.add('sc-linked');

        const url = characterPageUrls.get(span.dataset.character || '');
        if (!url) return;

        // Never nest an anchor inside an anchor: a mention inside a [url=]
        // link is already going somewhere the author chose.
        if (span.closest('a')) return;

        // On the character's own page, linking to where you already are is
        // noise rather than navigation.
        if (window.PAGE_ROUTE && window.PAGE_ROUTE.title === span.dataset.character) return;

        const link = document.createElement('a');
        link.className = 'sc-char-link';
        link.href = url;
        link.title = span.dataset.character;

        span.parentNode.insertBefore(link, span);
        link.appendChild(span);
    });
}

window.linkCharacterMentions = linkCharacterMentions;

document.addEventListener('DOMContentLoaded', () => {
    applyInternalStyling();
    loadCharacterPageUrls().then(linkCharacterMentions);
});

const observer = new MutationObserver((mutations) => {
    let shouldRestyle = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            shouldRestyle = true;
            break;
        }
    }
    if (shouldRestyle) {
        applyInternalStyling();
        // Content rendered after boot - a tab switch, the editor's live
        // preview - gets its mentions linked too.
        linkCharacterMentions();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.querySelector('main');
    if (mainContent) {
        observer.observe(mainContent, { childList: true, subtree: true });
    }
});

// Input-slot colouring runs after the styling pass, because it looks for
// .is-styled prose and for the combo chips the renderers emit.
const _dslApplyInternalStyling = applyInternalStyling;
applyInternalStyling = function () {
    const result = _dslApplyInternalStyling.apply(this, arguments);
    try {
        if (typeof window.applyInputSlotColours === 'function') window.applyInputSlotColours();
    } catch (e) {
        // Colouring is decoration; losing it must never cost the page its prose.
        console.warn('[Notation] input slot colouring failed:', e);
    }
    return result;
};

window.applyInternalStyling = applyInternalStyling;