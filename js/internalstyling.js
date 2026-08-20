/**
 * Dogslamloop Wiki - Automated Contextual Text Colorizer & Shortcode Engine
 *
 * Turns contributor shortcodes ([b], [color=...], [url=...]) into markup, and
 * auto-highlights character names, frame-data terms and frame timings.
 *
 * WHAT THIS FILE IS AND WHY IT NEEDS CARE. It reads a block's innerHTML, runs
 * string replacements over it, and writes the result back. Every value it
 * interpolates comes from PAGE CONTENT, which is contributor-submitted. That
 * makes it an innerHTML sink with attacker-reachable input, which is the exact
 * case CLAUDE.md's escaping rule is about.
 *
 * Three holes were found and closed on 2026-08-14, all reachable from ordinary
 * page text and all live on the public site:
 *
 *   [url=javascript:alert(1)]click[/url]
 *       became <a href="javascript:alert(1)">, which runs on click.
 *
 *   [url=" onmouseover="...]hover[/url]
 *       the quote closed href= and the rest landed as a REAL onmouseover
 *       handler on the anchor. Confirmed against a running page, not reasoned
 *       about.
 *
 *   [color=red" onmouseover="...]x[/color]
 *       the same break-out, one attribute over, on the span.
 *
 * A reviewer could not have caught these by reading a diff: the submission
 * shows as the literal text "[url=...]", and the handler only exists after
 * this file has run.
 *
 * So every interpolation now goes through one of three gates - escAttr,
 * safeUrl, safeColor - and anything that fails renders as plain text rather
 * than as markup. Losing a colour is a rendering nit; the alternative is
 * executing somebody's script on a page 1.4M people are pointed at.
 */

// Attribute context: quotes are what let a value escape into a new attribute,
// and angle brackets are what let it escape the tag.
function escAttr(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Allowed: absolute http(s), mailto, a site-relative path, a fragment, or a
// bare relative path. Everything else is refused - which is the point, because
// javascript:, data: and vbscript: are the schemes that execute, and a
// whitelist cannot be outflanked by a scheme nobody thought of.
//
// Leading "//" is excluded deliberately: it is protocol-relative, so it
// inherits https here but is still an off-site jump that does not look like
// one in the source text.
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

// A colour is a small closed grammar, so it can be whitelisted outright rather
// than escaped. Anything outside it is somebody trying to leave the style
// attribute, not somebody with an unusual colour.
const SAFE_COLOR_PATTERN =
    /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/+-]+\)|var\(\s*--[\w-]+\s*\)|[a-z]{3,20})$/i;

function safeColor(raw) {
    const color = String(raw == null ? '' : raw).trim();
    return SAFE_COLOR_PATTERN.test(color) ? color : null;
}

// Spellings the community uses that are not the legend's own wording. Kept
// small and explicit: an alias is a claim that two phrases mean the same
// thing, which is a domain judgement rather than a formatting one.
const TERM_ALIASES = {
    'bg-tick-recov': ['Whiff Endlag'],
    'bg-tick-blockendlag': ['Extended Recovery'],
    'reverse-hitcancel': ['RHC'],
};

// A literal term becomes a tolerant pattern: spaces match runs of whitespace
// because KaTeX inserts non-breaking ones, and the hyphen in "I-Frames" is
// optional because people type it both ways.
function termPattern(text) {
    return String(text)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/ /g, '\\s+')
        .replace(/-/g, '[-\\s]?');
}

// Separators are REMOVED, not collapsed to a space. The pattern deliberately
// accepts "Bullet Iframes" as well as "Bullet I-Frames", so the key both spell
// has to be the same one - collapsing to a space gives "bullet i frames" and
// "bullet iframes", the lookup misses, and the term silently renders unstyled
// while every regex-level test still passes.
function normalizeTerm(text) {
    return String(text).toLowerCase().replace(/[\s-]+/g, '');
}

// One combined pattern and ONE pass, rather than a replace per term.
//
// That is not a tidy-up, it is a correctness fix. The old code ran nine
// separate passes in list order, so "Recovery" (pass 3) matched inside
// "Extended Recovery" before pass 7 could claim the whole phrase - and pass 7
// then found a <span> in the middle of its own term and never matched at all.
// "Extended Recovery" has therefore been rendering as plain "Extended" plus a
// recovery-coloured "Recovery" for as long as the phrase has existed.
//
// A single global replace never re-scans what it just inserted, so one pass
// cannot wrap a term inside another one.
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

// --- [noauto] ---
//
// Auto-highlighting matches ordinary English - Register, Active, Misc,
// Recovery, Startup, Perfection are all real words, and the alias list adds
// Yuki, Todo, Charles and a sentence fragment. This is the author's way of
// saying "that one is not the character".
//
// Implemented by lifting the protected text out before the auto passes run and
// putting it back afterwards, because a regex over a string cannot be told to
// skip a region. The placeholder is plain ASCII and visible in source: a
// private-use codepoint reads as "cannot collide", but it is invisible in an
// editor and survives a paste as something nobody can see. The worst case here
// is not a security one either - content that literally contained the token
// would get some of its own text relocated, which is a rendering bug.
const NOAUTO_OPEN = '%%DSL_NOAUTO_';
const NOAUTO_CLOSE = '%%';

function liftNoAuto(content, store) {
    return content.replace(/\[noauto\]([\s\S]*?)\[\/noauto\]/gi, (whole, inner) => {
        store.push(inner);
        return `${NOAUTO_OPEN}${store.length - 1}${NOAUTO_CLOSE}`;
    });
}

function restoreNoAuto(content, store) {
    if (!store.length) return content;
    return content.replace(
        new RegExp(`${NOAUTO_OPEN}(\\d+)${NOAUTO_CLOSE}`, 'g'),
        (whole, index) => store[Number(index)] !== undefined ? store[Number(index)] : whole
    );
}

// --- MOVE NAMES, COLOURED BY INPUT SLOT (v0.15) ---
//
// JJS combos are written NAME-FIRST - "MURMURATE > R^ > AIR UPDRAFT", not
// "2 > R > 1" - so colouring notation means knowing which of the ten inputs
// each move NAME belongs to.
//
// The map is derived from frame_data's `input` field per character, with
// desc_data.characterSettings as a thin override (js/input_slots.js). Nothing
// is hand-listed here, for the same reason the frame terms above are derived
// from site_meta.js: a second copy drifts.
//
// Mode-aware: a character's ultimate state has different skills in the same
// slots, so the same name can be a different colour depending on which state
// the reader is looking at.
function currentPageMoveSlots() {
    if (typeof window.buildMoveSlotMap !== 'function') return null;

    const pageId = (window.PAGE_ROUTE && window.PAGE_ROUTE.pageId)
        || window.activePreviewCharId || window.currentEditorCharId;
    if (!pageId) return null;

    // admin.html holds neither of the first two. It loads a revision into
    // currentPending*/currentLive*, so notation in Diff View and in the
    // reviewer's preview was never coloured at all - the reader saw colours,
    // the person approving them saw plain text, which is the half that has to
    // spot a wrong input. Pending first: the reviewer is looking at the
    // PROPOSED version, so a move the ticket itself adds must colour too.
    let frame = (window.cachedMasterFrameData || {})[pageId]
        || window.currentEditorFrameData
        || window.currentPendingFrameData
        || window.currentLiveFrameData
        || null;
    if (!frame) return null;

    // The active state's slice, when there is one. resolveModeFrame is the
    // shared resolver; falling back to the master keeps a page with no states
    // working unchanged.
    const mode = window.activeCharacterMode || window.activePreviewMode;
    if (mode && !((window.isBaseMode && window.isBaseMode(mode)))
        && frame.modeData && frame.modeData[mode]) {
        frame = Object.assign({}, frame, frame.modeData[mode]);
    }

    // Same three sources, same order - characterSettings overrides live in
    // desc_data, so a reviewer must resolve names the same way a reader does.
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
        pattern: new RegExp(`(?<![\\w-])(${names.map(termPattern).join('|')})(?![\\w-])(?![^<]*>)`, 'gi'),
    };
}

// The bare keys themselves - "M1", "2", "R". Only ever applied INSIDE a combo
// chip: a lone "1" or "2" in prose is a number far more often than an input,
// and colouring those would tint every frame count and damage figure on the
// site.
//
// A trailing direction is part of the input, not a separate step: the owner
// writes "R^" constantly, and JJS's directions are the arrow glyphs and
// A/W/S/D. Without this "R^" fell through the whole-chip match and came out
// uncoloured while a bare "R" was fine - which is exactly the swap the owner
// asked to be sure of.
function inputKeyPattern() {
    const ids = (window.INPUT_SLOT_IDS || []).slice().sort((a, b) => b.length - a.length);
    if (!ids.length) return null;
    const keys = ids.map(termPattern).join('|');
    const direction = '(?:\\s*[+]?\\s*(?:[\\u2190-\\u2193\\u21D0-\\u21D3^v<>]|\\b[AWSD]\\b))*';
    return new RegExp(`^\\s*(${keys})${direction}\\s*$`, 'i');
}

// Move names AND bare keys, for matching inside one compound step. Names go
// first and longest-first, so "Air Updraft" is claimed before "Updraft" and
// before the bare "1" that a name might contain.
//
// The key half is bounded by non-alphanumerics, which is what keeps "(X3)" and
// "M1 x3" from lighting up their digits.
function compoundPattern(terms) {
    const names = Array.from(terms.lookup.keys()).sort((a, b) => b.length - a.length);
    const keys = (window.INPUT_SLOT_IDS || []).slice().sort((a, b) => b.length - a.length);
    if (!names.length && !keys.length) return null;

    // The names come from the map already normalised, which means space-joined.
    // Each space has to match a hyphen too, or a compound step containing the
    // frame data's own spelling - "Dive-Bomb (whiff)" - would find nothing
    // while the plain "Dive Bomb" matched.
    const separator = '[\\s\\u2010-\\u2015-]+';
    const flexible = (n) => termPattern(n).split(/\s+/).join(separator);
    const namePart = names.length ? `(?<![\\w-])(?:${names.map(flexible).join('|')})(?![\\w-])` : null;
    const keyPart = keys.length ? `(?<![A-Za-z0-9])(?:${keys.map(termPattern).join('|')})(?![A-Za-z0-9])` : null;

    return new RegExp([namePart, keyPart].filter(Boolean).join('|'), 'gi');
}

window.applyInputSlotColours = function (root) {
    const scope = root || document;
    const terms = currentPageMoveSlots();
    const keyPattern = inputKeyPattern();

    // 1. Combo chips. A chip is one step, so it is matched WHOLE against the
    //    key list first - "2" as a chip is Skill 2, unambiguously - and only
    //    then against move names.
    //
    // A chip is only marked DONE once the move map exists. The styling pass
    // runs on DOM changes, and the first one fires before the character's
    // frame data has landed - so marking unconditionally left every chip
    // flagged as processed with no colour, and nothing ever looked again.
    // That is why a plain "MURMURATE" stayed uncoloured while "BIRD
    // CONTROL(S)", rendered later, came out orange.
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

        // A COMPOUND step - "R (Upward, Cancel Murmurate)", "GARUDA STAB OR
        // RISING RAGE", "BIRD CONTROL(S)". The chip cannot take one colour, so
        // every move name AND every bare key inside it is coloured in place.
        //
        // Keys have to be in this pass, not only in the whole-chip match
        // above. Without them the leading "R" of "R (Upward, Cancel
        // Murmurate)" was never considered and the parenthetical Murmurate was
        // the only thing that coloured - which reads as the annotation
        // stealing the step's own colour.
        const compound = compoundPattern(terms);
        if (!compound) return;
        compound.lastIndex = 0;

        let matched = false;
        const replaced = escAttr(text).replace(compound, (match) => {
            const id = terms.lookup.get(window.normaliseMoveName(match));
            const slot = window.getInputSlot(id || match);
            if (!slot) return match;
            matched = true;
            return `<span class="sc-auto ${slot.cls}">${match}</span>`;
        });

        // Wrapped in ONE inline child rather than written straight in.
        // .combo-node is display:inline-flex, so a mix of text nodes and spans
        // becomes a row of FLEX ITEMS - and a flex container discards the
        // whitespace between its items. "Cancel Murmurate" rendered as
        // "CancelMurmurate" until this wrapper put it all back in normal
        // inline flow.
        if (matched) chip.innerHTML = `<span class="combo-node-text">${replaced}</span>`;
    });

    // 2. Move names in prose - but ONLY inside a DOCUMENT TAB (Combos, Techs).
    //
    // Owner, 2026-08-17: slot colouring stays in combo blocks and the Combos
    // tab. Site-wide it would tint the frame-data pages, where every move name
    // appears dozens of times, and turn a reference table into a rainbow. A
    // combo block carries its own colour anywhere because a route IS notation;
    // prose only counts as notation when it is combo prose.
    //
    // Techs is the same kind of prose - routes, cancels and move names written
    // as notation - so it gets the same treatment. Derived from the registry
    // rather than listing the two tabs, so this cannot be the one place a third
    // document tab is forgotten.
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

    hosts.forEach(host => {
        host.querySelectorAll('.is-styled:not(.is-slotted-prose)').forEach(block => {
            block.classList.add('is-slotted-prose');
            const before = block.innerHTML;
            terms.pattern.lastIndex = 0;
            const after = before.replace(terms.pattern, (match) => {
                const id = terms.lookup.get(window.normaliseMoveName(match));
                const slot = id && window.getInputSlot(id);
                return slot ? `<span class="sc-auto ${slot.cls}">${match}</span>` : match;
            });
            if (after !== before) block.innerHTML = after;
        });
    });
};

function applyInternalStyling() {
    // 1. Select targets
    const textBlocks = document.querySelectorAll('.wiki-text:not(.is-styled), .vessel-content p:not(.is-styled), .vessel-content li:not(.is-styled), .strategy-paragraph:not(.is-styled), .vessel-content h2:not(.is-styled), .vessel-content h3:not(.is-styled), .vessel-content h4:not(.is-styled), .update-table th:not(.is-styled), .update-table td:not(.is-styled)');
    
    // 2. Characters, canonical names and every alias the community uses.
    const characterColors = window.CHARACTER_COLORS || {};
    const characterTerms = buildCharacterTerms();

    // 3. Frame data and overlay-window terms.
    //
    // DERIVED from site_meta.js rather than listed here, 2026-08-14. The old
    // hardcoded array was a second copy of FRAME_COLOR_LABELS, and the copies
    // had already drifted: every one of the six OVERLAY WINDOW colours -
    // Reverse Hitcancel and the five I-Frame kinds - has existed in
    // WINDOW_COLORS and been offered in the frame-data legend for versions,
    // and none of them was ever highlighted in prose, because nobody thought
    // to add a tenth line to a list that looked complete.
    //
    // Deriving it means the next colour token added to site_meta.js is
    // highlighted the day it lands.
    const highlightTerms = buildHighlightTerms();

    // Detect current character header title context
    const pageTitleEl = document.querySelector('.character-title');
    let currentCharColor = 'var(--text-white)'; // Fallback
    if (pageTitleEl && characterColors[pageTitleEl.textContent.trim()]) {
        currentCharColor = characterColors[pageTitleEl.textContent.trim()];
    }

    textBlocks.forEach(block => {
        block.classList.add('is-styled');
        let content = block.innerHTML;

        // --- STEP A: Custom Shortcodes (Stackable & Nested) ---
        // A do-while loop ensures that nested tags (e.g. [color=red][b][i]Text[/i][/b][/color]) 
        // are processed from the inside out until no more tags are left.
        let previousContent;
        do {
            previousContent = content;
            
            // Standard formatting. Classes rather than inline styles since
            // 2026-08-14 - see style/Common.css. These carry no contributor
            // input at all, so they are the easy half.
            content = content.replace(/\[b\]((?:(?!\[b\])[\s\S])*?)\[\/b\]/gi, '<strong class="sc-b">$1</strong>');
            content = content.replace(/\[i\]((?:(?!\[i\])[\s\S])*?)\[\/i\]/gi, '<em class="sc-i">$1</em>');
            content = content.replace(/\[u\]((?:(?!\[u\])[\s\S])*?)\[\/u\]/gi, '<span class="sc-u">$1</span>');
            content = content.replace(/\[s\]((?:(?!\[s\])[\s\S])*?)\[\/s\]/gi, '<span class="sc-s">$1</span>');
            content = content.replace(/\[code\]((?:(?!\[code\])[\s\S])*?)\[\/code\]/gi, '<code class="sc-code">$1</code>');
            // A fighting-game wiki types M1, M2, E, R and F constantly, and
            // they read as prose today. <kbd> is the element for it, so screen
            // readers and search engines get the meaning too.
            content = content.replace(/\[kbd\]((?:(?!\[kbd\])[\s\S])*?)\[\/kbd\]/gi, '<kbd class="sc-kbd">$1</kbd>');

            // Colour: the value is contributor text going into a style
            // attribute. Refused rather than escaped, because a colour is a
            // closed grammar and anything outside it is not a colour.
            // Refusing keeps the words and drops the tint.
            content = content.replace(/\[color=([^\]]+)\]((?:(?!\[color=)[\s\S])*?)\[\/color\]/gi,
                (whole, rawColor, inner) => {
                    const color = safeColor(rawColor);
                    return color
                        ? `<span class="sc-color" style="color: ${escAttr(color)};">${inner}</span>`
                        : inner;
                });

            // Hyperlink: the value is contributor text going into an href.
            // A refused URL renders as its own label - the reader still sees
            // what was written, just not as something clickable.
            //
            // rel added at the same time: target="_blank" without it hands the
            // opened page a window.opener reference back to the wiki.
            //
            // A fragment is an IN-PAGE link and is handled separately: it gets
            // no target="_blank", because opening a second copy of the page
            // scrolled to a section is not what "jump to the Tech section"
            // means. js/pagebuilder.js picks these up by class and resolves
            // them, which is what lets one cross a tab boundary - the plain
            // browser behaviour cannot, since the target tab is display:none
            // until something clicks it.
            content = content.replace(/\[url=([^\]]+)\]((?:(?!\[url=)[\s\S])*?)\[\/url\]/gi,
                (whole, rawUrl, label) => {
                    const url = safeUrl(rawUrl);
                    if (!url) return label;
                    if (url.charAt(0) === '#') {
                        return `<a href="${escAttr(url)}" class="wiki-link wiki-link-jump">${label}</a>`;
                    }
                    return `<a href="${escAttr(url)}" class="wiki-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
                });

        } while (content !== previousContent);

        // Everything below auto-matches ordinary English, so [noauto] regions
        // come out here and go back in at the end.
        const protectedRegions = [];
        content = liftNoAuto(content, protectedRegions);

        // --- STEP B: Auto-Highlight Characters and their aliases ---
        // The colours are owner-configured rather than contributor-typed, so
        // this is not the same risk as [color=] above - but it is the same
        // sink, and a validated value costs nothing.
        //
        // data-character carries the CANONICAL name, which is what linking
        // below resolves against. Without it an alias would have to be looked
        // up a second time from its own rendered text.
        if (characterTerms) {
            content = content.replace(characterTerms.pattern, (match) => {
                const entry = characterTerms.lookup.get(normalizeTerm(match));
                if (!entry) return match;
                return `<span class="sc-auto sc-char" data-character="${escAttr(entry.canonical)}"`
                     + ` style="color: ${escAttr(entry.color)};">${match}</span>`;
            });
        }

        // --- STEP C: Auto-Highlight Frame Data and Overlay Window Terms ---
        if (highlightTerms) {
            content = content.replace(highlightTerms.pattern, (match) => {
                const entry = highlightTerms.lookup.get(normalizeTerm(match));
                if (!entry) return match;
                return `<span class="sc-auto" style="color: ${escAttr(entry.color)};">${match}</span>`;
            });
        }

        // --- STEP D: Single-Pass Conditional Frame Timing Engine ---
        //
        // RANGES ARE FIRST IN THE ALTERNATION, and that ordering is the fix.
        // "5-8f" is how an active window is normally written, and the +/-
        // alternatives match the "-8f" inside it - so it rendered as a plain
        // "5" followed by a red, disadvantage-coloured "-8f".
        //
        // It has to be ONE pass, not a range pass followed by a timing pass:
        // a second pass finds "-8f" inside the span the first one just wrote,
        // because the (?![^<]*>) guard only protects attribute text and "</"
        // satisfies it immediately. A single global replace never re-scans its
        // own output, and first-match alternation then means "5-8f" is claimed
        // whole before "-8f" is ever considered.
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
                finalColor = 'hsl(127, 59%, 58%)';  // Generic Green Advantage
            } else if (!isRange && match.includes('-')) {
                finalColor = 'hsl(3, 93%, 63%)';    // Generic Red Disadvantage
            }

            const color = safeColor(finalColor) || 'var(--text-white)';
            return `<span class="sc-timing" style="color: ${escAttr(color)};">${match}</span>`;
        });

        content = restoreNoAuto(content, protectedRegions);

        // Apply changes back to DOM
        block.innerHTML = content;
    });
}

// --- LINKING CHARACTER MENTIONS TO THEIR PAGES ---
//
// A mention got a colour and nothing else, so a reader who met "Higuruma" in
// somebody's matchup notes had to go and find the page by hand. The roster and
// its URLs are already in navigation.json.
//
// A SEPARATE DOM PASS, not another string replacement, and that is the whole
// design. applyInternalStyling is called synchronously from a dozen places and
// its output is not re-enterable - blocks are marked is-styled precisely
// because running the shortcode conversion twice would eat its own output. So
// linking cannot wait inside it for a fetch.
//
// Instead step B leaves a marked span behind, and this walks those spans
// whenever the roster is available. It is idempotent: a span it has already
// wrapped carries sc-linked and is skipped, so it is safe to run on every
// observer tick and safe to run before the roster has loaded (it does nothing).
let characterPageUrls = null;

async function loadCharacterPageUrls() {
    if (characterPageUrls) return characterPageUrls;
    try {
        const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : './';
        const nav = window.fetchJson
            ? await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true })
            : await (await fetch(`${rootPath}data/navigation.json`)).json();

        const map = new Map();
        (nav.Characters || []).forEach(entry => {
            if (entry && entry.name && entry.url) map.set(entry.name, rootPath + entry.url);
        });
        characterPageUrls = map;
    } catch (e) {
        // A wiki that cannot reach its own roster still renders; the mentions
        // just stay unlinked.
        characterPageUrls = new Map();
    }
    return characterPageUrls;
}

function linkCharacterMentions() {
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

// Start watching the main content area once the DOM is ready
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