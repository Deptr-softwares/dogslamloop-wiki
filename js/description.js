/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 *
 * EVERY contributor-authored value below is escaped or validated on its way
 * into innerHTML. It was not, and that was a stored XSS: a submitted combo
 * step of `<img src=x onerror=...>` executed for every reader of the page, and
 * - worse - in the reviewer's authenticated session the moment they opened the
 * preview, before approving anything. Proven with a real repro, not inferred.
 *
 * A scan of live content (33 pages, 75 combo blocks) found zero HTML tags in
 * any contributor string, so nothing on the site depended on the old
 * behaviour. Rich text is produced by this renderer - [M1] becomes a <kbd>,
 * a content array becomes <br>-joined lines - not written by contributors, so
 * the order is always: escape the input, THEN add the generated markup.
 *
 * Three contexts, three different rules:
 *   text       -> escBlockText()
 *   attribute  -> escBlockText() as well; it escapes both quote characters
 *   CSS value  -> NEITHER is enough. Escaping quotes stops an attribute
 *                 breakout but still permits `100%; background: url(...)`, so
 *                 align and width are validated against allowlists instead.
 */

// NAMES ARE PREFIXED ON PURPOSE. Every js/ file here is a classic <script>
// sharing ONE global lexical scope, so a top-level `const esc` in two files
// that load on the same page is "Identifier 'esc' has already been declared"
// - which aborts the whole second file. That is not hypothetical: writing
// these as `esc` and `safeUrl` collided with js/editor-blocks.js and
// js/internalstyling.js and took the entire editor down with
// "Editor failed to initialize context", the same symptom as the 2026-08-10
// cache-skew incident. Caught only because the spec drove the real builder.
//
// window.escapeHtml lives in site_utils.js, which is stamped alongside this
// file's page but not this file; the fallback keeps a cache-skewed load
// rendering escaped text rather than throwing.
const escBlockText = (v) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(v === null || v === undefined ? '' : v)
    : String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

// CSS-value allowlists. Anything unrecognised falls back to the default rather
// than being passed through - a contributor cannot name a value this does not
// already know about, so there is nothing legitimate to lose.
const BLOCK_ALIGNMENTS = ['left', 'center', 'right', 'justify'];
const safeBlockAlign = (align) => (BLOCK_ALIGNMENTS.includes(align) ? align : null);

// e.g. 50%, 400px, 32rem. Deliberately no calc(), var() or url().
const safeBlockWidth = (width) => (/^\d+(\.\d+)?(%|px|rem|em|vw|vh)$/.test(String(width || '').trim())
    ? String(width).trim() : null);

// Blocked so a contributor cannot turn an image or video into script execution
// via `javascript:` - escaping does nothing about a URL scheme.
const safeBlockUrl = (url) => {
    const raw = String(url === null || url === undefined ? '' : url).trim();
    // eslint-disable-next-line no-script-url
    return /^\s*(javascript|data|vbscript):/i.test(raw.replace(/[\u0000-\u0020]/g, '')) ? '' : raw;
};

// --- MEDIA PLACEHOLDER (v0.15 item 12) ---
//
// An image block with no src used to emit `<img src="">`, which the browser
// draws as a broken box showing the alt text - the "empty box that says I am
// broken". A video or youtube block with nothing in it was worse: it emitted
// no markup at all, so the block vanished and an author editing a page could
// not see that it was there.
//
// Root-absolute because these pages sit at three different depths and the
// site is served from the domain root - the same assumption 404.html's
// <base href="/"> already makes.
const MEDIA_PLACEHOLDER_SRC = '/medias/images/DogslamloopIcon.webp';

window.wikiMediaPlaceholderHTML = function () {
    return `
        <div class="wiki-media-placeholder">
            <span class="wiki-media-placeholder-label">Placeholder</span>
            <img src="${MEDIA_PLACEHOLDER_SRC}" alt="" class="wiki-media-placeholder-icon" loading="lazy">
        </div>
    `;
};

// --- SUPABASE MEDIA LINKS (v0.15 item 11) ---
//
// A wiki-media link pasted into a table cell renders as media instead of as a
// URL. The bucket check is the SECURITY control, not a convenience: a cell
// that turned any URL into an <img> or <video> would let a contributor embed
// from anywhere and hotlink someone else's bandwidth through the wiki.
//
// The project URL is read rather than hardcoded, and `typeof` rather than a
// bare reference because SUPABASE_URL is a top-level const in site_utils.js -
// another file entirely, and one a cache-skewed load can be missing.
const WIKI_MEDIA_BUCKET_PATH = '/storage/v1/object/public/wiki-media/';
const WIKI_MEDIA_IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i;
const WIKI_MEDIA_VIDEO_RE = /\.(webm|mp4|m4v|mov|ogv)(\?|#|$)/i;

// 'image', 'video', or null for anything that is not one of ours.
window.wikiMediaKind = function (value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!raw || /\s/.test(raw)) return null;

    const base = typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '';
    if (!base) return null;
    if (raw.indexOf(base + WIKI_MEDIA_BUCKET_PATH) !== 0) return null;

    if (WIKI_MEDIA_IMAGE_RE.test(raw)) return 'image';
    if (WIKI_MEDIA_VIDEO_RE.test(raw)) return 'video';
    return null;
};

// --- THE VIDEO PLAYER (v0.15 item 10) ---
//
// Native <video> only, by the owner's call - YouTube's controls cannot be
// restyled from outside the iframe, and the alternatives were an external API
// on the busiest pages or a frame that promised more than it delivered.
//
// And only when the block asked for controls. A video block with controls OFF
// renders `autoplay loop muted playsinline`: a silent clip standing in for a
// GIF, which is a deliberate authoring choice on a lot of existing pages.
// Giving that a play button answers a question nobody asked.
//
// Painted with var(--accent-blue), which js/site_meta.js overrides on :root
// per character page - so the player re-themes itself and there is nothing
// here that knows about characters at all.
window.wikiVideoPlayerHTML = function (url, extraClass) {
    const safe = escBlockText(safeBlockUrl(url));
    if (!safe) return '';
    return `
        <div class="wiki-player${extraClass ? ' ' + escBlockText(extraClass) : ''}" data-wiki-player>
            <video data-lazy-src="${safe}" class="wiki-video-native" preload="none" playsinline></video>
            <div class="wiki-player-controls">
                <button type="button" class="wiki-player-btn wiki-player-toggle" data-player-toggle
                        aria-label="Play">
                    <span class="wiki-player-glyph" aria-hidden="true"></span>
                </button>
                <button type="button" class="wiki-player-btn wiki-player-mute" data-player-mute
                        aria-label="Mute">
                    <span class="wiki-player-sound" aria-hidden="true"></span>
                </button>
                <div class="wiki-player-track" data-player-track role="slider" tabindex="0"
                     aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <div class="wiki-player-fill" data-player-fill></div>
                </div>
            </div>
        </div>
    `;
};

// A cell or a card has no room for a player, so a video there is a button that
// opens one. Deliberately NOT a link to the storage URL, which is what the
// theorybox and the combo table used to do - that navigates the reader off the
// wiki to a bare video on a Supabase domain, with no way back but the back
// button (owner, 2026-08-18).
window.wikiVideoButtonHTML = function (url, label) {
    const safe = escBlockText(safeBlockUrl(url));
    if (!safe) return '';
    return `<button type="button" class="wiki-video-btn" data-wiki-video="${safe}">`
        + `<span class="wiki-video-btn-glyph" aria-hidden="true"></span>`
        + `${escBlockText(label || 'Watch')}</button>`;
};

// Helper to assign CSS classes, inline widths, and safe style merging for media
function getMediaAttributes(align, customWidth, extraStyles = '') {
    let alignClass = 'wiki-media-full';

    if (align === 'left') alignClass = 'wiki-media-left';
    else if (align === 'right') alignClass = 'wiki-media-right';
    else if (align === 'center') alignClass = 'wiki-media-center';

    return `class="wiki-media ${alignClass}" style="width: ${safeBlockWidth(customWidth) || '100%'}; ${extraStyles}"`;
}

// --- PLAYSTYLE COMPONENT GENERATOR ---
window.generatePlaystyleHTML = function(playstyle) {
    if (!playstyle || (!playstyle.likes?.length && !playstyle.dislikes?.length)) return '';
    
    const renderList = (items, icon, variant) => items.map(text => `
        <li class="playstyle-item">
            <span class="playstyle-icon ${variant}">${icon}</span>
            <span class="playstyle-item-text">${escBlockText(text)}</span>
        </li>
    `).join('');

    return `
        <div class="playstyle-container">
            <div class="playstyle-col likes">
                <h4 class="playstyle-header">PICK IF YOU LIKE</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.likes || [], '✓', 'likes')}
                </ul>
            </div>
            <div class="playstyle-col dislikes">
                <h4 class="playstyle-header">AVOID IF YOU DISLIKE</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.dislikes || [], '✖', 'dislikes')}
                </ul>
            </div>
        </div>
    `;
};

// --- THE RECURSIVE BLOCK ENGINE ---
// This standalone function can render blocks infinitely deep!
window.generateHTMLForBlocks = function(blocks, contextClass = '') { // FIXED 1: Added contextClass parameter
    let contentHTML = '';
    let sectionAuthors = new Set(); // FIXED 2: Initialized the authors array here!
    
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    blocks.forEach(block => {
        if (!block) return;
        
        // FIXED 3: Defined the alignment variable inside the loop so every block can use it!
        const alignAttr = getAlignStyle(block.align); 
        
        if (block.type === 'heading') {
            let headingClass = 'wiki-block-heading';
            if (contextClass) headingClass += ` ${contextClass}-heading`;
            
            // Allowlisted: block.size is contributor-set and lands in the tag
            // NAME, so an unchecked value writes an arbitrary element.
            const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(block.size) ? block.size : 'h3';

            contentHTML += `<${tag} class="${headingClass}" ${alignAttr}>${escBlockText(block.content)}</${tag}>`;
        }
        // --- PARAGRAPHS (With Inline Keybinds & URL Links) ---
        else if (block.type === 'paragraph') {
            // Escape FIRST, then join and add the generated markup - the <br>
            // and the <kbd> are this renderer's, not the contributor's.
            const rawText = Array.isArray(block.content)
                ? block.content.map(escBlockText).join('<br>')
                : escBlockText(block.content);

            // Convert keybinds. The pattern only matches A-Z, digits, spaces
            // and +, none of which escaping alters, so it still finds [M1].
            let text = rawText.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');

            const pClass = contextClass ? 'strategy-paragraph card-text' : 'strategy-paragraph';
            contentHTML += `<p class="${pClass}" ${alignAttr}>${text}</p>`;
        }
        else if (block.type === 'list') {
            const lClass = contextClass ? 'wiki-block-list space-y-2 card-text' : 'wiki-block-list space-y-2 text-gray-300';
            contentHTML += `<ul class="${lClass}" ${alignAttr}>`;
            block.items.forEach(item => { contentHTML += `<li>${escBlockText(item)}</li>`; });
            contentHTML += `</ul>`;
        }
        else if (block.type === 'image') {
            // An empty src reached the browser as `<img src="">`, which draws a
            // broken box showing the alt text - the "empty box that says I am
            // broken" (item 12).
            if (!safeBlockUrl(block.src)) {
                contentHTML += block.caption
                    ? `<figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')}>`
                      + window.wikiMediaPlaceholderHTML()
                      + `<figcaption class="wiki-figcaption">${escBlockText(block.caption)}</figcaption></figure>`
                    : `<div ${getMediaAttributes(block.align, block.width)}>`
                      + window.wikiMediaPlaceholderHTML() + `</div>`;
            }
            else if (block.caption) {
                contentHTML += `
                    <figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')} >
                        <img src="${escBlockText(safeBlockUrl(block.src))}" alt="${escBlockText(block.alt || 'Wiki Image')}" class="wiki-block-image" loading="lazy">
                        <figcaption class="wiki-figcaption">
                            ${escBlockText(block.caption)}
                        </figcaption>
                    </figure>
                `;
            } else {
                contentHTML += `<img src="${escBlockText(safeBlockUrl(block.src))}" alt="${escBlockText(block.alt || 'Wiki Image')}" ${getMediaAttributes(block.align, block.width, 'border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow, #000);')} loading="lazy">`;
            }
        }
        // --- DIVIDERS ---
        else if (block.type === 'divider') {
            const bData = block.data || block; // SAFE EXTRACTOR

            // Legacy fallback for old invisible blocks
            let currentStyle = bData.style || (bData.invisible ? 'invisible' : 'diamond');
            let paddingClass = bData.padding || 'normal';

            const validPadding = ['none', 'small', 'normal', 'large', 'massive'];
            const padClass = `wiki-divider-pad-${validPadding.includes(paddingClass) ? paddingClass : 'normal'}`;

            let divHtml = '';

            // Inject the exact HTML for the requested style
            switch (currentStyle) {
                case 'invisible':
                    divHtml = ``; // Just the margin container!
                    break;
                case 'solid':
                    divHtml = `<div class="wiki-divider-line-solid"></div>`;
                    break;
                case 'dashed':
                    divHtml = `<div class="wiki-divider-line-dashed"></div>`;
                    break;
                case 'dotted':
                    divHtml = `<div class="wiki-divider-line-dotted"></div>`;
                    break;
                case 'double':
                    divHtml = `<div class="wiki-divider-line-double"></div>`;
                    break;
                case 'circle':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-circle-dot"></div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'cross':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-cross-plus">+</div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'fade':
                    divHtml = `<div class="wiki-divider-line-fade"></div>`;
                    break;
                case 'slash':
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-slash-mark">///</div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
                case 'diamond':
                default:
                    divHtml = `
                        <div class="wiki-divider-segment"></div>
                        <div class="wiki-divider-diamond-mark"></div>
                        <div class="wiki-divider-segment"></div>
                    `;
                    break;
            }

            contentHTML += `<div class="wiki-divider ${padClass}">${divHtml}</div>`;
        }
        // --- STANDALONE AUTHOR BLOCK ---
        else if (block.type === 'author') {
            // (Handled below in the author aggregation step)
        }
        // --- INLINE CALLOUTS ---
        else if (block.type === 'callout') {
            const bData = block.data || block; 
            
            const intentMap = {
                'tip': { color: '#facc15', icon: '💡', label: 'TIP' },
                'warning': { color: '#fb923c', icon: '⚠️', label: 'WARNING' },
                'danger': { color: '#ef4444', icon: '🚨', label: 'DANGER' },
                'info': { color: '#22d3ee', icon: '📌', label: 'INFO' }
            };
            const config = intentMap[bData.intent] || intentMap['info'];
            // Same escape-then-join rule as paragraphs. config.color comes from
            // intentMap above, never from the block, so it needs nothing.
            const text = Array.isArray(bData.content)
                ? bData.content.map(escBlockText).join('<br>')
                : escBlockText(bData.content || bData.text || '');

            let tooltipContent = '';
            if (bData.title) {
                tooltipContent += `<strong class="callout-tooltip-title" style="--tooltip-accent: ${config.color};">${escBlockText(bData.title)}</strong>`;
            }

            tooltipContent += `<span class="tooltip-desc callout-tooltip-desc">${text}</span>`;

            contentHTML += `
                <div class="wiki-callout-wrapper" ${getAlignStyle(bData.align)}>
                    <span class="inline-callout-btn" style="--callout-color: ${config.color};" data-tooltip="${encodeURIComponent(tooltipContent)}">
                        <span class="callout-icon">${config.icon}</span>
                        <span class="callout-label">${config.label}</span>
                    </span>
                </div>
            `;
        }
        // --- DATA TABLES ---
        else if (block.type === 'table') {
            const bData = block.data || block; // SAFE EXTRACTOR

            const headers = bData.headers || [];
            const rows = bData.rows || [];
            
            let tableContent = '<table class="update-table wiki-content-table">';

            // Render Headers
            if (headers.length > 0) {
                tableContent += `<thead><tr>`;
                headers.forEach(h => {
                    tableContent += `<th>${escBlockText(h)}</th>`;
                });
                tableContent += `</tr></thead>`;
            }

            // Render Rows (alternating background + hover are handled by CSS: nth-child/:hover)
            if (rows.length > 0) {
                tableContent += `<tbody>`;
                rows.forEach((row) => {
                    tableContent += `<tr>`;

                    // Parse [M1] keybinds natively inside the cells - unless
                    // the cell is one of our own storage links, which renders
                    // as the media itself (item 11). An image is sized down to
                    // fit the row; a video gets a button, because a player does
                    // not fit in a table cell.
                    row.forEach(cell => {
                        const kind = window.wikiMediaKind(cell);
                        if (kind === 'image') {
                            tableContent += `<td class="wiki-cell-media-td">`
                                + `<img src="${escBlockText(safeBlockUrl(cell))}" alt=""`
                                + ` class="wiki-cell-media" loading="lazy"></td>`;
                            return;
                        }
                        if (kind === 'video') {
                            tableContent += `<td class="wiki-cell-media-td">`
                                + window.wikiVideoButtonHTML(cell, 'Play') + `</td>`;
                            return;
                        }
                        let parsedCell = escBlockText(cell).replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                        tableContent += `<td>${parsedCell}</td>`;
                    });
                    tableContent += `</tr>`;
                });
                tableContent += `</tbody>`;
            } else {
                tableContent += '<tr><td class="wiki-table-empty-cell">Table data is empty.</td></tr>';
            }
            tableContent += '</table>';

            // Wrapping container provides horizontal scrolling on mobile and the heavy manga shadow
            contentHTML += `
                <div class="wiki-table-wrapper">
                    ${tableContent}
                </div>
            `;
        }
        // --- YOUTUBE & NATIVE VIDEO EMBEDS ---
        else if (block.type === 'youtube' || block.type === 'video' || block.type === 'embed') {
            const bData = block.data || block; 
            let mediaInnerHtml = '';

            if (block.type === 'youtube' || bData.videoId) {
                let videoId = String(bData.videoId || bData.url || '');
                const ytMatch = videoId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
                if (ytMatch) videoId = ytMatch[1];

                // A bare id that did not come from the URL pattern above was
                // previously written into the iframe src untouched. Held to the
                // same 11-character shape the pattern extracts, so there is no
                // path where a contributor string reaches that attribute raw.
                if (!/^[\w-]{11}$/.test(videoId)) videoId = '';

                if (videoId) {
                    // Injecting data-lazy-src
                    mediaInnerHtml = `
                        <iframe data-lazy-src="https://www.youtube.com/embed/${videoId}" src="about:blank"
                                class="wiki-video-embed"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen>
                        </iframe>
                    `;
                }
            } 
            else if (block.type === 'video') {
                const videoUrl = bData.url || bData.src || '';
                if (videoUrl) {
                    // Controls ON gets the player (item 10). Controls OFF is an
                    // autoplaying muted loop - a clip standing in for a GIF -
                    // and is left exactly as it was.
                    mediaInnerHtml = bData.controls
                        ? window.wikiVideoPlayerHTML(videoUrl)
                        : `<video data-lazy-src="${escBlockText(safeBlockUrl(videoUrl))}" autoplay loop muted playsinline class="wiki-video-native" preload="none"></video>`;
                }
            }

            // Nothing to show: a linkless media block used to emit no markup at
            // all, so it disappeared from the page and the author could not see
            // it was there to fix (item 12).
            if (!mediaInnerHtml) {
                mediaInnerHtml = window.wikiMediaPlaceholderHTML();
            }

            if (mediaInnerHtml) {
                if (bData.caption) {
                    contentHTML += `
                        <figure ${getMediaAttributes(bData.align, bData.width, 'text-align: center;')} >
                            ${mediaInnerHtml}
                            <figcaption class="wiki-figcaption">
                                ${escBlockText(bData.caption)}
                            </figcaption>
                        </figure>
                    `;
                } else {
                    contentHTML += `
                        <div ${getMediaAttributes(bData.align, bData.width)}>
                            ${mediaInnerHtml}
                        </div>
                    `;
                }
            }
        }
        // --- ACCORDION  ---
        else if (block.type === 'accordion' || block.type === 'details') {
            const bData = block.data || block; 
            const title = bData.title || bData.summary || 'COLLAPSIBLE SECTION';

            // Recursively generate the inner content
            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            // The arrow is pinned via absolute positioning so it doesn't move when the title is centered!
            contentHTML += `
                <div class="wiki-accordion-wrapper">
                    <details class="manga-accordion">
                        <summary class="wiki-accordion-summary" style="text-align: ${safeBlockAlign(bData.align) || 'left'};">
                            <span>${escBlockText(title)}</span>
                            <span class="accordion-arrow">▼</span>
                        </summary>
                        <div class="wiki-accordion-body">
                            ${innerHTML}
                        </div>
                    </details>
                </div>
            `;
        }
        // --- THE COMBO CARD (TheoryBox) ---
        //
        // A combo and everything known about it: the route, its numbers, and a
        // write-up that is itself blocks - clips, sub-variants, an explanation
        // of why the timing is what it is. Nested exactly like an accordion,
        // which is what makes a combo GROUP a group rather than a list.
        else if (block.type === 'theorybox') {
            const bData = block.data || block;

            // Derived from the title when blank, so a card is linkable without
            // anyone having to think about anchors. Everything that is not a
            // word character is dropped: a raw title in an id breaks the
            // selector that would scroll to it.
            const anchor = String(bData.anchor || bData.title || '')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

            const difficulty = String(bData.difficulty || '').trim();
            const diffIndex = (window.COMBO_DIFFICULTIES || []).indexOf(difficulty);
            const diffHTML = difficulty
                ? `<span class="theorybox-difficulty combo-difficulty${diffIndex === -1 ? '' : ` combo-difficulty-${diffIndex}`}">${escBlockText(difficulty)}</span>`
                : '';

            // Same chips and separators as the legacy combo block and the
            // Combo List, so a route reads identically wherever it appears.
            const steps = Array.isArray(bData.sequence) ? bData.sequence : [];
            let routeHTML = '';
            if (steps.length) {
                routeHTML = '<div class="combo-container theorybox-route">';
                steps.forEach((step, i) => {
                    routeHTML += `<span class="combo-node">${escBlockText(step)}</span>`;
                    if (i < steps.length - 1) routeHTML += '<span class="combo-sep" aria-hidden="true">&gt;</span>';
                });
                if (bData.damage) routeHTML += `<span class="combo-damage">${escBlockText(bData.damage)}</span>`;
                routeHTML += '</div>';
            }

            // Opens the modal player rather than navigating to the file. The
            // link sent the reader off the wiki to a bare video on a Supabase
            // domain with no way back but the back button (owner, 2026-08-18).
            const videoUrl = safeBlockUrl(bData.video || '');
            const videoHTML = videoUrl
                ? window.wikiVideoButtonHTML(videoUrl, 'Watch')
                : '';

            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            contentHTML += `
                <section class="theorybox"${anchor ? ` id="combo-${escBlockText(anchor)}"` : ''}>
                    <div class="theorybox-head">
                        <h4 class="theorybox-title">${escBlockText(bData.title || 'Combo')}</h4>
                        ${diffHTML}
                        ${videoHTML}
                    </div>
                    ${bData.oneliner ? `<p class="theorybox-oneliner">${escBlockText(bData.oneliner)}</p>` : ''}
                    ${routeHTML}
                    ${innerHTML ? `<div class="theorybox-body">${innerHTML}</div>` : ''}
                </section>
            `;
        }
        // --- COMBO STRINGS ---
        else if (block.type === 'combo') {
            if (block.sequence && block.sequence.length > 0) {
                
                // Determine flex justification based on alignment
                let justifyClass = 'flex-start';
                if (block.align === 'center') justifyClass = 'center';
                if (block.align === 'right') justifyClass = 'flex-end';

                // Restructured, v0.15 item 1. The route and its damage are one
                // reading unit and now sit on one row; the note goes underneath
                // it, full width. Previously the damage was pushed to the far
                // right of the page with `margin-left: auto` and the note sat
                // beside it, so a reader had to cross the whole column to find
                // out what a combo did, and the note read as a caption on the
                // damage rather than on the combo.
                let comboHTML = `<div class="combo-block">`;
                comboHTML += `<div class="combo-container" style="justify-content: ${justifyClass};">`;

                block.sequence.forEach((move, index) => {
                    comboHTML += `<span class="combo-node">${escBlockText(move)}</span>`;

                    // '>' rather than an arrow glyph or an SVG, matching the
                    // notation the community and Dustloop both already write
                    // by hand. aria-hidden because a screen reader announcing
                    // "greater than" between every step of an eight-step route
                    // is noise; the steps read fine as a list without it.
                    if (index < block.sequence.length - 1) {
                        comboHTML += `<span class="combo-sep" aria-hidden="true">&gt;</span>`;
                    }
                });

                // Damage trails the route directly - a last element of the
                // sequence rather than a column at the page edge.
                if (block.damage) {
                    comboHTML += `<span class="combo-damage">${escBlockText(block.damage)}</span>`;
                }

                comboHTML += `</div>`;

                // Under the route, full width, so it reads as a condition on
                // the whole combo.
                if (block.note) {
                    comboHTML += `<div class="combo-note-row" style="justify-content: ${justifyClass};">`
                        + `<span class="combo-note">${escBlockText(block.note)}</span></div>`;
                }

                comboHTML += `</div>`;
                contentHTML += comboHTML;
            }
        }
        
        // --- AUTHOR AGGREGATION ---
        if (block.author && block.author.trim() !== '') {
            // Split by comma in case multiple authors collaborated on one block
            block.author.split(',').forEach(a => sectionAuthors.add(a.trim()));
        }
    });

    // --- AUTHOR FOOTER ---
    if (sectionAuthors.size > 0) {
        // Escaped, unlike the block content above it. Block content is
        // deliberately rich HTML - contributors write formatted prose, and
        // paragraphs even run a keybind substitution over it - but an author
        // name is an identity label, never markup. It rides along inside
        // submitted block data as block.author, so it is contributor-reachable
        // on every character and system page, and it was going into innerHTML
        // raw.
        const authorBadges = Array.from(sectionAuthors)
            .map(a => `<span class="author-badge">${window.escapeHtml(a)}</span>`)
            .join('');
        
        contentHTML += `
            <div class="aggregated-contributors-footer">
                <div class="contributors-header">
                    <span class="contributors-icon">👥</span>
                    <span class="contributors-text">Contributors</span>
                </div>
                <div class="contributors-list">${authorBadges}</div>
            </div>
        `;
    }

    contentHTML += `<div class="wiki-blocks-clearfix"></div>`;

    return contentHTML;
};

// Helper to apply dynamic text alignment and prevent long-word overflow
// --- THE COMBO TABLE (v0.15 item 3) ---
//
// Adapted from Dustloop's combo table, in our own chrome. A character's combos
// are grouped by STARTER - the owner's live pages use True / Simpler /
// Advanced rather than the reference's Beginner / Core / Specialized, because
// the group names are the author's - and each group draws one sortable table.
//
// Not a block type. `desc_data.combos` is a keyed array exactly like matchups
// and counterplay (js/character_tabs.js), so submit, merge, diff and the
// editor's group nav all come from the shared machinery; only the rendering
// below is bespoke.

// The owner's own scale. ORDER IS MEANING: this array is the sort key, because
// "Demon Time" sorts FIRST alphabetically and LAST by difficulty.
window.COMBO_DIFFICULTIES = [
    'Very Easy', 'Easy', 'Medium', 'Slightly Hard',
    'Hard', 'Very Hard', 'Extremely Hard', 'Demon Time',
];

// Columns, in order. `conditional` ones are dropped unless some row in the
// group fills them in - the reference does this for Setup, and the owner asked
// for Controls to ship for console players without costing ten-wide tables any
// horizontal space until it earns it.
//
// `sort: null` means the column has no meaningful order (a link, a version
// string), which is the reference's behaviour too.
window.COMBO_COLUMNS = [
    { field: 'sequence',    label: 'Combo',       sort: 'route' },
    { field: 'damage',      label: 'Damage',      sort: 'leadingNumber' },
    { field: 'position',    label: 'Position',    sort: 'text' },
    { field: 'difficulty',  label: 'Difficulty',  sort: 'difficulty' },
    { field: 'worksOn',     label: 'Works On',    sort: 'text' },
    { field: 'setup',       label: 'Setup',       sort: 'text', conditional: true },
    { field: 'controls',    label: 'Controls',    sort: null,   conditional: true },
    { field: 'gameVersion', label: 'Ver',         sort: null },
    { field: 'video',       label: 'Video',       sort: null },
    { field: 'notes',       label: 'Notes',       sort: 'text' },
];

// "38-46" and "4 (2+2)" are both live values. Lexical order puts "4 (2+2)"
// above "38-46", which is wrong by every reading, so damage sorts on the
// leading integer and rows with no number sort last rather than as zero.
window.comboSortValue = function (row, column) {
    const raw = row ? row[column.field] : undefined;

    if (column.sort === 'difficulty') {
        const i = window.COMBO_DIFFICULTIES.indexOf(raw);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    }
    if (column.sort === 'leadingNumber') {
        const m = /-?\d+(\.\d+)?/.exec(String(raw === null || raw === undefined ? '' : raw));
        return m ? parseFloat(m[0]) : Number.MAX_SAFE_INTEGER;
    }
    if (column.sort === 'route') {
        return (Array.isArray(raw) ? raw.join(' > ') : String(raw || '')).toLowerCase();
    }
    return String(raw === null || raw === undefined ? '' : raw).toLowerCase();
};

// Which optional columns have been earned.
//
// Computed across every group in the tab rather than per group. Per group, a
// reader scrolling down sees columns appear and disappear between two tables
// that are meant to be read the same way - one group grew a Setup column and
// the next grew Controls instead, which looks like a bug even though each
// table was individually correct.
window.comboVisibleColumns = function (rows) {
    const list = Array.isArray(rows) ? rows : [];
    return window.COMBO_COLUMNS.filter(col => {
        if (!col.conditional) return true;
        return list.some(r => r && String(r[col.field] || '').trim() !== '');
    });
};

// One route, rendered as the same chips the legacy combo block uses, so a
// route reads identically whether it is inline in prose or a row in a table.
function renderComboRoute(sequence) {
    const steps = Array.isArray(sequence) ? sequence : (sequence ? [sequence] : []);
    if (steps.length === 0) return '<span class="combo-route-empty">-</span>';

    let html = '<div class="combo-container combo-route-inline">';
    steps.forEach((step, i) => {
        html += `<span class="combo-node">${escBlockText(step)}</span>`;
        if (i < steps.length - 1) html += '<span class="combo-sep" aria-hidden="true">&gt;</span>';
    });
    return html + '</div>';
}

// Ult Gain and Evasive Gain are the owner's two resources, replacing the
// reference's Tension/Blood/Stamina. They are bold prefixes above the notes
// rather than columns of their own - two more columns on a ten-wide table for
// two values that are usually blank is a bad trade.
function renderComboNotes(row) {
    let html = '';
    [['ultGain', 'Ult Gain'], ['evasiveGain', 'Evasive Gain']].forEach(([field, label]) => {
        const value = String(row[field] || '').trim();
        if (value) html += `<div class="combo-resource"><strong>${label}:</strong> ${escBlockText(value)}</div>`;
    });
    const notes = String(row.notes || '').trim();
    if (notes) html += `<div class="combo-note-text">${escBlockText(notes)}</div>`;
    return html || '<span class="combo-cell-empty">-</span>';
}

function renderComboCell(row, column) {
    if (column.field === 'sequence') return renderComboRoute(row.sequence);
    if (column.field === 'notes') return renderComboNotes(row);

    const value = String(row[column.field] === null || row[column.field] === undefined ? '' : row[column.field]).trim();
    if (!value) return '<span class="combo-cell-empty">-</span>';

    if (column.field === 'video') {
        const href = safeBlockUrl(value);
        if (!href) return '<span class="combo-cell-empty">-</span>';
        // Same change as the theorybox above, and the same reason: a combo
        // table cell is the cramped-space case item 11 was written for.
        return window.wikiVideoButtonHTML(href, 'Watch');
    }
    if (column.field === 'difficulty') {
        // Slot index rather than the label, so the ramp is a class and the
        // palette lives in CSS with every other colour on the site.
        const i = window.COMBO_DIFFICULTIES.indexOf(value);
        const slot = i === -1 ? '' : ` combo-difficulty-${i}`;
        return `<span class="combo-difficulty${slot}">${escBlockText(value)}</span>`;
    }
    return escBlockText(value);
}

// Sorting is applied by re-rendering the body rather than by moving nodes:
// each cell is generated markup, and re-generating is both simpler and immune
// to a half-sorted DOM if a row is malformed.
window.renderComboTableBody = function (tbody, rows, columns, sort) {
    const list = (Array.isArray(rows) ? rows : []).slice();

    if (sort && sort.column) {
        const column = columns.find(c => c.field === sort.column);
        if (column && column.sort) {
            list.sort((a, b) => {
                const av = window.comboSortValue(a, column);
                const bv = window.comboSortValue(b, column);
                if (av < bv) return sort.dir === 'desc' ? 1 : -1;
                if (av > bv) return sort.dir === 'desc' ? -1 : 1;
                return 0;
            });
        }
    }

    tbody.innerHTML = list.map(row => {
        const cells = columns.map(col => {
            const html = renderComboCell(row || {}, col);
            // Tagged rather than inferred in CSS: on mobile an empty cell is
            // a labelled row saying "-", and ten of those per card buries the
            // three fields that were actually filled in.
            const empty = html.indexOf('combo-cell-empty') > -1 || html.indexOf('combo-route-empty') > -1;
            return `<td class="combo-cell combo-cell-${col.field}${empty ? ' combo-cell-is-empty' : ''}"`
                + ` data-label="${escBlockText(col.label)}">${html}</td>`;
        }).join('');
        return `<tr class="combo-row">${cells}</tr>`;
    }).join('');
};

// One captioned table in the Combo List.
window.renderComboListTable = function (group, section) {
    const wrapper = document.createElement('section');
    wrapper.className = 'wiki-section wiki-section-clip combo-list-table';

    const name = group[section.keyField] || 'Untitled';
    wrapper.innerHTML = `
        <div class="card-header-flex">
            <h3 class="card-header-title">${escBlockText(name)}</h3>
        </div>
    `;

    const rows = Array.isArray(group[section.rowsField]) ? group[section.rowsField] : [];
    if (rows.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-notes-msg';
        empty.textContent = section.emptyEntryMessage || 'No combos in this group yet.';
        wrapper.appendChild(empty);
        return wrapper;
    }

    const columns = section.__columns || window.comboVisibleColumns(rows);

    // The table scrolls inside its own container rather than pushing the page
    // sideways. Below the breakpoint CSS turns each row into a card - the same
    // treatment matchups already get on mobile - because ten columns cannot fit
    // a phone and the route is the part that must stay readable.
    const scroller = document.createElement('div');
    scroller.className = 'combo-table-scroll';

    const table = document.createElement('table');
    table.className = 'combo-table';
    table.innerHTML = `
        <thead>
            <tr>${columns.map(col => (col.sort
                ? `<th class="combo-th combo-th-sortable" data-sort-field="${escBlockText(col.field)}"`
                  + ` role="button" tabindex="0" aria-sort="none">${escBlockText(col.label)}`
                  + `<span class="combo-sort-arrow" aria-hidden="true"></span></th>`
                : `<th class="combo-th">${escBlockText(col.label)}</th>`)).join('')}</tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    let sort = { column: null, dir: 'asc' };
    window.renderComboTableBody(tbody, rows, columns, sort);

    // One delegated listener, never an inline onclick - the field names are
    // ours, but the pattern is the site's rule and this markup sits beside
    // contributor content.
    table.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('.combo-th-sortable');
        if (!th) return;
        const field = th.getAttribute('data-sort-field');
        sort = (sort.column === field && sort.dir === 'asc')
            ? { column: field, dir: 'desc' }
            : { column: field, dir: 'asc' };

        table.querySelectorAll('.combo-th-sortable').forEach(h => {
            const active = h.getAttribute('data-sort-field') === sort.column;
            h.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
            h.classList.toggle('is-sorted', active);
            h.classList.toggle('is-desc', active && sort.dir === 'desc');
        });

        window.renderComboTableBody(tbody, rows, columns, sort);
    });

    scroller.appendChild(table);
    wrapper.appendChild(scroller);

    // Prose and TheoryBoxes under the table, if the group carries any.
    if (Array.isArray(group.content) && group.content.length > 0) {
        const prose = document.createElement('div');
        prose.className = 'combos-content';
        // Prefixed with the tab, because Combos and Techs can both be on the
        // same character and both draw a table called "5H Starters". Without
        // it the second one's prose renders into the first one's container.
        prose.id = `${section.tab}-content-${String(name).replace(/\s+/g, '-')}`;
        wrapper.appendChild(prose);
        populateTextSection(prose.id, '', group.content, section.tab);
        const injected = prose.querySelector('section.wiki-section');
        if (injected) injected.classList.remove('wiki-section');
    }

    return wrapper;
};

// A DOCUMENT TAB, in the order the reference reads:
//
//   Read First          comboIntro   prose, methodology, notation legend
//   <Group Title>       comboGroups  TheoryBox cards, prose, inline combos
//   Combo List          comboList    one captioned sortable table per starter
//
// ...and Techs, which is the same three parts under the owner's other
// vocabulary - Technical Overview, Tech Groups, Tech List (keyed by theory
// rather than by starter). Every difference between the two tabs is a string in
// js/character_tabs.js; this function does not know either tab by name.
//
// Composed here rather than by the shared keyed renderer, because the tab is a
// DOCUMENT of three parts - the same decomposition the Overview tab already
// has (overview + strategy + extras), not one keyed array.
//
// The first attempt made the table a group's content, which left nowhere for
// the cards to live and put the reference index in the middle of the prose.
window.renderDocumentTab = function (tabId, data) {
    const sections = window.getDocumentSections ? window.getDocumentSections(tabId) : null;
    if (!sections) return;

    const container = document.getElementById(`tab-${tabId}`);
    if (!container) return;

    const { intro, groups, list } = sections;

    container.innerHTML = '';
    container.classList.add('space-y-6');

    const introBlocks = intro ? data[intro.field] : null;
    const groupList = groups ? data[groups.field] : null;
    const tables = list ? data[list.field] : null;

    if ((!introBlocks || !introBlocks.length)
        && (!groupList || !groupList.length)
        && (!tables || !tables.length)) {
        container.innerHTML = `<div class="empty-tab-msg">${escBlockText(sections.tab.emptyMessage || 'Nothing written for this character yet.')}</div>`;
        return;
    }

    // The three parts are DOCUMENT SECTIONS, so each gets a heading rather
    // than a card. Owner, 2026-08-16: a group wrapped in .wiki-section makes
    // every TheoryBox inside it a card within a card, when the cards are
    // supposed to BE the sections. The reference agrees - `==Beginner Combos==`
    // is a heading, and the boxes under it are the combos.
    const addHeading = (text, extraClass) => {
        const h = document.createElement('h3');
        h.className = `section-title section-title-clean combo-section-title${extraClass ? ` ${extraClass}` : ''}`;
        h.textContent = text;
        container.appendChild(h);
        return h;
    };

    // --- Read First ---
    //
    // Stays a CARD, unlike the groups. It is a mandatory prose section like
    // Overview or General Strategy - it holds paragraphs, not combo cards, so
    // there is nothing inside it that needs to be its own section. Owner,
    // 2026-08-16: only the groups needed the wrapper removed.
    if (introBlocks && introBlocks.length) {
        const section = document.createElement('section');
        section.className = 'wiki-section wiki-section-clip combo-intro';
        section.innerHTML = `<div class="card-header-flex"><h3 class="card-header-title">${escBlockText(intro.label)}</h3></div>`;
        const body = document.createElement('div');
        body.className = 'combos-content';
        // Every id below carries the tab, because a character can have both
        // Combos and Techs open in the same document and populateTextSection
        // resolves its target by getElementById. Sharing 'combo-intro-content'
        // between them would render the second tab's prose into the first's.
        body.id = `${tabId}-intro-content`;
        section.appendChild(body);
        container.appendChild(section);
        populateTextSection(body.id, '', introBlocks, tabId);
        const injected = body.querySelector('section.wiki-section');
        if (injected) injected.classList.remove('wiki-section');
    }

    // --- The author's groups ---
    (groupList || []).forEach((group, idx) => {
        if (!group) return;
        addHeading(group[groups.keyField] || 'Untitled', 'combo-group-title');

        const body = document.createElement('div');
        body.className = 'combos-content combo-group';
        // Indexed, not keyed by title: a title is contributor text and two
        // groups may share one, which would collide the ids and make
        // populateTextSection render into the first one twice.
        body.id = `${tabId}-group-content-${idx}`;
        container.appendChild(body);

        if (Array.isArray(group.content) && group.content.length) {
            populateTextSection(body.id, '', group.content, tabId);
            const injected = body.querySelector('section.wiki-section');
            if (injected) injected.classList.remove('wiki-section');
        } else {
            body.innerHTML = `<p class="empty-notes-msg">${escBlockText(groups.emptyEntryMessage)}</p>`;
        }
    });

    // --- Combo List / Tech List, last ---
    if (list && tables && tables.length) {
        const host = document.createElement('div');
        host.className = 'combo-list-section space-y-6';
        host.innerHTML = `<h3 class="section-title section-title-clean combo-section-title combo-list-title">${escBlockText(list.label)}</h3>`;

        // Every row in the SECTION decides the columns, so all its tables share
        // a shape. Per table, one grows a Setup column and the next grows
        // Controls, which reads as a bug even though each is individually right.
        const allRows = tables.reduce((acc, t) => acc.concat((t && t[list.rowsField]) || []), []);
        const shared = { ...list, __columns: window.comboVisibleColumns(allRows) };

        tables.forEach(table => host.appendChild(window.renderComboListTable(table || {}, shared)));
        container.appendChild(host);
    }

    if (typeof window.consolidateTabContributors === 'function') {
        window.consolidateTabContributors(container);
    }
};

// The registry's rendererFn for each document tab's list section, so the
// editor's live preview and description.js's own boot can redraw the whole tab
// from one entry point. Named per tab rather than passed a tab id, because
// rendererFn is looked up by NAME off window and called with the data alone -
// see js/editor-previews.js and the self-rendered loop below.
window.renderCombosTab = function (data) {
    window.renderDocumentTab('combos', data);
};

window.renderTechsTab = function (data) {
    window.renderDocumentTab('techs', data);
};

function getAlignStyle(align) {
    let styleStr = 'overflow-wrap: break-word; word-break: break-word;';
    // Allowlisted, not escaped - this is a CSS value, where escaping quotes
    // still leaves `left; background: url(...)` intact.
    const dir = safeBlockAlign(align);
    if (dir) styleStr += ` text-align: ${dir};`;
    return `style="${styleStr}"`;
}

// Raises contributor credit from per-section to per-tab.
//
// generateHTMLForBlocks already aggregates authors, but only within one call -
// so a tab built from several sections got a footer per section, and an
// accordion got another one nested inside it, since the recursive call starts
// its own author set. Five badges partway down the Overview tab is noise, and
// the same name repeated in three footers is worse.
//
// Done as a DOM pass over the finished tab rather than by threading an author
// set through every caller: the sections are built by four different code
// paths (overview, matchups, counterplay, move strategies), some of them
// asynchronously, and this way each one only has to say "I'm done" rather than
// hand its authors back. It also picks up the nested accordion footers, which
// a caller-level version would miss.
//
// Deliberately not applied to blog posts (js/posts.js) - a post has one author
// and its footer belongs where it is.
window.consolidateTabContributors = function(root) {
    if (!root) return;

    const footers = root.querySelectorAll('.aggregated-contributors-footer');
    if (footers.length === 0) return;

    // Set, because the same person usually wrote several sections of a tab.
    //
    // Sorted rather than left in document order: a nested accordion emits its
    // footer inside the accordion body, which lands *before* the enclosing
    // section's own footer, so document order does not match authoring order
    // and never can. Alphabetical is at least honest about being a credits
    // list rather than a sequence.
    const authors = new Set();
    footers.forEach(footer => {
        footer.querySelectorAll('.author-badge').forEach(badge => {
            const name = badge.textContent.trim();
            if (name) authors.add(name);
        });
        footer.remove();
    });

    const ordered = Array.from(authors).sort((a, b) => a.localeCompare(b));

    if (authors.size === 0) return;

    const footer = document.createElement('div');
    footer.className = 'aggregated-contributors-footer tab-contributors-footer';
    // textContent per badge, so a contributor name is never parsed as markup -
    // same reason generateHTMLForBlocks escapes them.
    const header = document.createElement('div');
    header.className = 'contributors-header';
    header.innerHTML = `<span class="contributors-icon">👥</span><span class="contributors-text">Contributors</span>`;
    const list = document.createElement('div');
    list.className = 'contributors-list';
    ordered.forEach(name => {
        const badge = document.createElement('span');
        badge.className = 'author-badge';
        badge.textContent = name;
        list.appendChild(badge);
    });
    footer.appendChild(header);
    footer.appendChild(list);
    root.appendChild(footer);
};

function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.classList.remove('vessel-content');
    container.classList.add('content-section-wrapper');

    if (blocks && blocks.length > 0) {

        const section = document.createElement('section');
        
        if (contextClass === 'move-strategy') {
            section.className = 'skill-strategy-section';
        } else if (contextClass === 'system-content') {
            section.className = 'system-content-wrapper'; 
        } else {
            section.className = `wiki-section ${contextClass}`.trim();
        }
        
        if (sectionTitle) {
            section.innerHTML = `<h3 class="strategy-title">${sectionTitle}</h3>`;
        }

        // 1. Generate the HTML using our recursive engine
        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = window.generateHTMLForBlocks(blocks, contextClass);
        section.appendChild(bodyDiv);
        container.appendChild(section);

        // 2. Bind the tooltips (shared engine, see site_utils.js)
        const callouts = section.querySelectorAll('.inline-callout-btn');
        callouts.forEach(btn => {
            const decodedTooltip = decodeURIComponent(btn.getAttribute('data-tooltip'));
            window.bindTooltip(btn, decodedTooltip);
        });

        // 3. Initialize Lazy Loading for newly injected videos
        if (typeof window.initLazyMedia === 'function') {
            window.initLazyMedia(container);
        }

    } else {
        container.innerHTML = `
            <div class="wiki-section-empty">
                "${sectionTitle}" analysis has not been written yet.
            </div>
        `;
    }
}

async function loadPageDescriptions(pageId, pageType = 'character', modeId = null) {
    try {
        let data = null;

        // Set when the object came from the editor, which has already narrowed
        // it to the state being edited (js/editor-modes.js). Resolving it a
        // second time below would look for a modeData bucket inside a bucket
        // and render the preview empty.
        let dataIsPreScoped = false;

        // 1. Check Editor Cache (For Live Preview pane)
        if (window.currentEditorDescData) {
            data = window.currentEditorDescData;
            dataIsPreScoped = true;
        }
        else {
            // 2. Check Supabase Cloud Database
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);

                // Which optional tabs this page has, before anything renders.
                // Outside the desc_data guard on purpose: a page with no
                // descriptions still has a tab strip, and leaving the flag
                // unset there would leave a previous page's answer in place on
                // any surface that loads two pages in one session (the admin
                // preview does exactly that).
                if (typeof window.applyOptionalTabsFromPageRow === 'function') {
                    window.applyOptionalTabsFromPageRow(cloudData);
                }

                if (cloudData && cloudData.desc_data) {
                    data = cloudData.desc_data;
                    console.log(`[Cloud] Loaded ${pageId} descriptions.`);
                }
            }
            
            // 3. FALLBACK: Dynamic Pathing based on pageType!
            if (!data) {
                const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
                let descPath = '';
                
                if (pageType === 'system') {
                    descPath = `${rootPath}systems/${pageId}/${pageId}_descriptions.json`;
                } else {
                    descPath = `${rootPath}characters/${pageId.charAt(0).toUpperCase() + pageId.slice(1)}/${pageId}_descriptions.json`;
                }
                
                // CRITICAL FIX: Wrapped in try/catch so a missing local JSON file doesn't crash the engine!
                try {
                    data = await window.fetchJson(descPath);
                    console.log(`[Local] Loaded ${pageId} descriptions from ${pageType} directory.`);
                } catch (e) {
                    console.warn(`[Local] No local JSON found for ${pageId}.`);
                }
            }
        }

        // --- PREVENT FATAL CRASH IF NO DATA EXISTS ---
        if (!data) {
            if (pageType === 'system') {
                console.log(`[System] Initializing blank schema for new system page.`);
                data = { tabs: [] }; 
            } else {
                throw new Error("No descriptive data found.");
            }
        }

        // =====================================================================
        // THE SYSTEM PAGE ENGINE (Dynamic Tabs & Sections)
        // =====================================================================
        if (pageType === 'system') {
            const mainArea = document.querySelector('.main-content-area');
            if (!mainArea) return;

            // --- AUTO-MIGRATION: Initialize default tab or rescue old corrupted data ---
            if (!data.tabs || data.tabs.length === 0) {
                let rescuedBlocks = [];
                if (data.overview && data.overview.length > 0) rescuedBlocks.push(...data.overview);
                if (data.strategy && data.strategy.length > 0) rescuedBlocks.push(...data.strategy);
                
                data = {
                    tabs: [{
                        tabId: 'overview',
                        tabLabel: 'Overview',
                        sections: [{ 
                            sectionTitle: rescuedBlocks.length > 0 ? 'Recovered Data' : 'Introduction', 
                            layout: 'full', 
                            blocks: rescuedBlocks 
                        }]
                    }]
                };
            }

            // 1. Wipe out any hardcoded legacy containers and old dynamic navs
            const oldTarget = document.getElementById('tab-overview');
            if (oldTarget) oldTarget.remove();
            const oldNav = document.getElementById('system-dynamic-nav');
            if (oldNav) oldNav.remove();

            // 2. Build the interactive Manga Tab Navigation Bar
            const isEditor = !!document.getElementById('interactive-builder');
            let navHTML = `<nav id="system-dynamic-nav" class="character-nav" style="display: ${isEditor ? 'none' : 'flex'}; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue); align-items: center;">`;
            
            const tabIdsForPageBuilder = []; // Passed to setupTabs()

            data.tabs.forEach((tab, idx) => {
                const isActive = idx === 0 ? 'active' : '';
                navHTML += `<button id="nav-${tab.tabId}" class="btn-manga btn-manga-slanted ${isActive}"><div class="btn-manga-content"><span class="btn-manga-text">${tab.tabLabel}</span></div></button>`;
                tabIdsForPageBuilder.push(tab.tabId);
            });
            navHTML += `</nav>`;

            // Inject the nav directly beneath the page header
            const header = mainArea.querySelector('.home-main-header');
            if (header) {
                header.insertAdjacentHTML('afterend', navHTML);
            } else {
                mainArea.insertAdjacentHTML('afterbegin', navHTML);
            }

            // 3. Generate the Tab Containers and Content
            data.tabs.forEach((tab, idx) => {
                let tabContainer = document.getElementById(`tab-${tab.tabId}`);
                if (!tabContainer) {
                    tabContainer = document.createElement('div');
                    tabContainer.id = `tab-${tab.tabId}`;
                    // Removed space-y-6 so Flexbox can properly control vertical margins
                    tabContainer.className = 'tab-content wiki-tab-content';
                    if (idx !== 0) tabContainer.classList.add('hidden'); 
                    mainArea.appendChild(tabContainer);
                }
                
                tabContainer.innerHTML = '';

                if (tab.sections && tab.sections.length > 0) {
                    tab.sections.forEach((section, sIdx) => {
                        
                        // --- MIGRATION & CALCULATION ENGINE ---
                        let sWidth = section.width;
                        let sAlign = section.alignment;
                        let sBreak = section.forceBreak;

                        // Seamlessly converts old database data to the new dynamic schema
                        if (sWidth === undefined) {
                            if (section.layout === 'centered') { sWidth = 80; sAlign = 'center'; sBreak = true; }
                            else if (section.layout === 'split-left') { sWidth = 48; sAlign = 'left'; sBreak = false; }
                            else if (section.layout === 'split-right') { sWidth = 48; sAlign = 'right'; sBreak = false; }
                            else { sWidth = 100; sAlign = 'left'; sBreak = true; }
                            
                            section.width = sWidth; section.alignment = sAlign; section.forceBreak = sBreak;
                        }

                        // --- THE ROW BREAKER ---
                        if (sBreak && sIdx !== 0) {
                            const flexBreak = document.createElement('div');
                            flexBreak.className = 'flex-row-break';
                            tabContainer.appendChild(flexBreak);
                        }

                        const sectionNode = document.createElement('section');
                        sectionNode.className = 'wiki-section system-content-grid-section';

                        // --- DYNAMIC GEOMETRY APPLICATION ---
                        sectionNode.style.flex = `0 0 ${sWidth}%`;
                        sectionNode.style.maxWidth = `${sWidth}%`;

                        // Auto-Margin alignment physics 
                        if (sAlign === 'center') {
                            sectionNode.style.marginLeft = 'auto';
                            sectionNode.style.marginRight = 'auto';
                        } else if (sAlign === 'right') {
                            sectionNode.style.marginLeft = 'auto';
                        } else if (sAlign === 'left') {
                            sectionNode.style.marginRight = 'auto';
                        }
                        
                        if (section.sectionTitle) {
                            sectionNode.innerHTML = `<h2 class="section-title mb-4">${section.sectionTitle}</h2>`;
                        }
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.id = `system-${tab.tabId}-sec-${sIdx}`;
                        sectionNode.appendChild(contentDiv);
                        tabContainer.appendChild(sectionNode);
                        
                        populateTextSection(contentDiv.id, '', section.blocks, 'system-content');
                    });
                    
                    // Flexbox safe clear-fix
                    const clearFix = document.createElement('div');
                    clearFix.className = 'flex-row-break';
                    tabContainer.appendChild(clearFix);

                    // After the clear-fix, so the footer sits below the
                    // floated section content rather than beside it.
                    window.consolidateTabContributors(tabContainer);
                } else {
                    tabContainer.innerHTML = `<div class="wiki-section-empty wiki-section-empty-flex">This section has not been written yet.</div>`;
                }
            });

            // --- 4. NATIVE PAGEBUILDER DELEGATION ---
            if (typeof window.setupTabs === 'function') {
                window.setupTabs('nav', 'tab', tabIdsForPageBuilder, 'major');
            }

            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
            
            if (window.renderMathInElement) {
                renderMathInElement(document.body, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
            
            if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
            return; // EXIT EARLY to guarantee Character logic never runs
        }
        // =====================================================================
        // THE CHARACTER PAGE ENGINE (Legacy Strict Architecture)
        // =====================================================================
        else {
            // Narrow `data` to the active character mode before anything below
            // reads it. A full character's ultimate modes carry their own
            // overview, matchups and counterplay, and every reference in this
            // branch should see that state's write-up rather than the base
            // kit's. resolveModeDesc hands `data` straight back for the base
            // mode - which is every character that declares no modes - so this
            // is a no-op for all 22 pages that exist today.
            const activeMode = dataIsPreScoped ? null : (modeId || window.activeCharacterMode || null);
            if (typeof window.resolveModeDesc === 'function') {
                data = window.resolveModeDesc(data, activeMode);
            }

            // --- 1. OVERVIEW & STRATEGY TAB ---
            const overviewContainer = document.getElementById('tab-overview');
            if (overviewContainer) {
                overviewContainer.innerHTML = '';
                overviewContainer.classList.add('vessel-content', 'space-y-6');

                const topSplit = document.createElement('div');
                topSplit.className = 'profile-top-split';

                let profileHTML = '';
                if (data.profile) {
                    let statsHTML = '';
                    if (data.profile.stats) {
                        data.profile.stats.forEach(stat => {
                            statsHTML += `
                                <div class="profile-stat-row">
                                    <span class="profile-stat-label">${stat.label}</span>
                                    <span class="profile-stat-val">${stat.value}</span>
                                </div>`;
                        });
                    }

                    // The portrait is a fixed square, so the crop has to be
                    // aimable - imageFocus is the nine-point choice made in the
                    // editor, fed to object-position through a custom property.
                    // Whitelisted rather than escaped: this string lands inside
                    // a style attribute, where escaping alone does not stop a
                    // crafted value from closing the declaration and adding its
                    // own.
                    const focus = (window.PORTRAIT_FOCUS_VALUES || []).includes(data.profile.imageFocus)
                        ? data.profile.imageFocus
                        : null;
                    const focusStyle = focus ? ` style="--portrait-focus: ${focus};"` : '';

                    const imgHTML = data.profile.image
                        ? `<img src="${window.escapeHtml(data.profile.image)}" class="profile-portrait" alt="Character Portrait"${focusStyle}>`
                        : `<div class="profile-portrait-missing">[No Portrait]</div>`;

                    profileHTML = `
                        <aside class="wiki-section profile-card">
                            ${imgHTML}
                            <div class="profile-stats-container">${statsHTML}</div>
                        </aside>
                    `;
                }

                const rightColumn = document.createElement('div');
                rightColumn.className = 'profile-text-wrapper';

                const overviewTextWrapper = document.createElement('div');
                overviewTextWrapper.id = 'overview-text-subnode';
                
                rightColumn.appendChild(overviewTextWrapper);

                if (data.playstyle && (data.playstyle.likes?.length > 0 || data.playstyle.dislikes?.length > 0)) {
                     const playstyleDiv = document.createElement('div');
                     playstyleDiv.innerHTML = window.generatePlaystyleHTML(data.playstyle);
                     rightColumn.appendChild(playstyleDiv);
                }

                topSplit.innerHTML = profileHTML;
                topSplit.appendChild(rightColumn);
                overviewContainer.appendChild(topSplit);

                populateTextSection('overview-text-subnode', 'Character Overview', data.overview);
                if (data.strategy && data.strategy.length > 0) {
                    const stratWrapper = document.createElement('div');
                    stratWrapper.id = 'overview-strategy-subnode';
                    overviewContainer.appendChild(stratWrapper);
                    populateTextSection('overview-strategy-subnode', 'General Strategy', data.strategy);
                }

                if (data.extras && data.extras.length > 0) {
                    data.extras.forEach((extraItem, index) => {
                        const extraWrapper = document.createElement('div');
                        extraWrapper.id = `overview-extra-${index}`;
                        overviewContainer.appendChild(extraWrapper);
                        
                        if (extraItem.content) {
                            populateTextSection(`overview-extra-${index}`, extraItem.title, extraItem.content);
                        }
                    });
                }

                window.consolidateTabContributors(overviewContainer);
            }

            // --- 2. MATCHUPS TAB ---
            const matchupsContainer = document.getElementById('tab-matchups');
            if (matchupsContainer) {
                matchupsContainer.innerHTML = '';
                matchupsContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.matchups && data.matchups.length > 0) {
                    data.matchups.forEach(mu => {

                        // window.MATCHUP_TIERS (js/site_utils.js) is the one
                        // definition; resolveMatchupTier also maps the two
                        // words v0.13 renamed, so history replay and anything
                        // submitted before the rename still renders.
                        const tier = window.resolveMatchupTier(mu.tier);

                        const muSection = document.createElement('section');
                        muSection.className = 'wiki-section wiki-section-clip';

                        // The colour comes from the tier table, never from the
                        // stored string, so nothing contributor-written lands
                        // inside a style attribute. The two visible strings are
                        // escaped - both are contributor-submitted.
                        let muHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">vs. ${window.escapeHtml(mu.opponent || 'Unknown')}</h3>
                                <span class="card-tier-label" style="color: ${tier.color};">${window.escapeHtml(tier.id)}</span>
                            </div>
                        `;

                        muSection.innerHTML = muHTML;
                        matchupsContainer.appendChild(muSection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'matchup-content';
                        contentWrapper.id = `matchup-content-${(mu.opponent || 'Unknown').replace(/\s+/g, '-')}`;
                        muSection.appendChild(contentWrapper);

                        if (mu.content && mu.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', mu.content, 'matchup');

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
                        }
                    });

                    window.consolidateTabContributors(matchupsContainer);
                }
            }

            // --- 3a. SECTIONS THAT RENDER THEMSELVES ---
            // Resolved from the vocabulary, so adding one is a registry entry
            // rather than another branch here. De-duplicated by function,
            // because several sections of one tab share a composer.
            const selfRendered = new Set();
            // Filtered by the tab list, not by the section list: an OPTIONAL
            // tab switched off still has its sections in the vocabulary - the
            // pipeline needs them so an already-queued delta still applies -
            // but nothing should draw it. getCharacterTabIds is where that
            // decision lives (js/character_tabs.js).
            const drawableTabs = window.getCharacterTabIds
                ? window.getCharacterTabIds({ includeInjected: true })
                : null;
            (window.getKeyedSections ? window.getKeyedSections() : [])
                .filter(s => s.rendererFn && typeof window[s.rendererFn] === 'function')
                .filter(s => !drawableTabs || drawableTabs.includes(s.tab))
                .forEach(s => {
                    if (selfRendered.has(s.rendererFn)) return;
                    selfRendered.add(s.rendererFn);
                    window[s.rendererFn](data);
                });

            // --- 3. KEYED SECTIONS (Counterplay, Starter Guide) ---
            //
            // One renderer for every tab whose data is an array of keyed
            // entries (js/character_tabs.js). Counterplay was this code with
            // 'counterplay' written through it; Starter Guide is the same
            // shape, so it renders here rather than as a second copy.
            //
            // MATCHUPS IS DELIBERATELY NOT HERE. Its card carries a tier
            // colour and links to the opponent's own page - that is a
            // different card, not this one with different words, and folding
            // it in would mean a renderer full of `if (section.tab === ...)`.
            (window.getKeyedSections ? window.getKeyedSections() : [])
                .filter(section => !section.customRenderer)
                .forEach(section => {
                    const container = document.getElementById(`tab-${section.tab}`);
                    if (!container) return;

                    container.innerHTML = '';
                    container.classList.add('vessel-content', 'space-y-6');

                    const entries = data[section.field];
                    if (!entries || entries.length === 0) {
                        container.innerHTML = `
                        <div class="empty-tab-msg">
                            ${escBlockText(section.emptyMessage || 'Not written yet.')}
                        </div>
                    `;
                        return;
                    }

                    entries.forEach(entry => {
                        const entrySection = document.createElement('section');
                        entrySection.className = 'wiki-section wiki-section-clip';

                        // Escaped, 2026-08-15. Both values are
                        // contributor-submitted and land in an innerHTML sink,
                        // so "<img src=x onerror=...>" as a topic executed on
                        // the live page.
                        //
                        // The meta colour is not escaped because it is not
                        // interpolated: it comes from the fixed metaColors map
                        // in the vocabulary with a fixed fallback, so the
                        // contributor's value SELECTS a colour rather than
                        // supplying one.
                        const title = escBlockText(entry[section.keyField] || 'Unknown');
                        let metaHTML = '';
                        if (section.metaField) {
                            const value = entry[section.metaField];
                            const colour = (section.metaColors || {})[value] || '#9ca3af';
                            metaHTML = `<span class="card-tier-label" style="color: ${colour};">${escBlockText(value || '')}</span>`;
                        }

                        entrySection.innerHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">${title}</h3>
                                ${metaHTML}
                            </div>
                        `;
                        container.appendChild(entrySection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = `${section.tab}-content`;
                        contentWrapper.id = `${section.tab}-content-${(entry[section.keyField] || 'Unknown').replace(/\s+/g, '-')}`;
                        entrySection.appendChild(contentWrapper);

                        if (entry.content && entry.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', entry.content, section.tab);

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">${escBlockText(section.emptyEntryMessage || 'Nothing recorded yet.')}</p>`;
                        }
                    });

                    window.consolidateTabContributors(container);
                });

            // --- 4. MOVE STRATEGIES (M1s, Skills, Specials) ---
            if (data.moveStrategies) {
                setTimeout(() => {
                    for (const [moveId, blocks] of Object.entries(data.moveStrategies)) {
                        populateTextSection(`strategy-${moveId}`, 'Move Overview and Strategy', blocks, 'move-strategy');
                    }
                    // Deferred behind the same 300ms wait as the sections
                    // themselves, since the move cards these render into are
                    // built by js/framedata.js on its own schedule.
                    window.FRAME_MOVE_CATEGORIES.forEach(tab => {
                        window.consolidateTabContributors(document.getElementById(`tab-${tab}`));
                    });
                    if (typeof applyInternalStyling === 'function') applyInternalStyling();
                    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
                }, 300); 
            }
        } // End of else block (Character Engine)

        // --- Trigger KaTeX to render LaTeX automatically ---
        if (window.renderMathInElement) {
            renderMathInElement(document.body, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
        
        // --- Auto-Refresh ToC when rendering finishes ---
        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

// --- LAZY MEDIA OBSERVER ---
window.initLazyMedia = function(rootElement = document) {
    const lazyMedia = rootElement.querySelectorAll('video[data-lazy-src], iframe[data-lazy-src]');
    
    if ('IntersectionObserver' in window) {
        const mediaObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const media = entry.target;
                    // Swap the lazy attribute to the real source
                    media.src = media.getAttribute('data-lazy-src');
                    media.removeAttribute('data-lazy-src');
                    
                    // If it's a video meant to auto-play, trigger it once loaded
                    if (media.tagName === 'VIDEO' && media.hasAttribute('autoplay')) {
                        media.play().catch(e => console.warn("Autoplay prevented:", e));
                    }
                    observer.unobserve(media);
                }
            });
        }, { rootMargin: "300px 0px" }); // Start loading 300px BEFORE it enters the screen

        lazyMedia.forEach(media => mediaObserver.observe(media));
    } else {
        // Fallback for ancient browsers
        lazyMedia.forEach(media => {
            media.src = media.getAttribute('data-lazy-src');
            media.removeAttribute('data-lazy-src');
        });
    }
};

// --- VIDEO PLAYER BEHAVIOUR (v0.15 item 10) ---
//
// One delegated listener on the document rather than per-player wiring: these
// players are rendered into innerHTML by a dozen callers, re-rendered on every
// editor keystroke, and created inside a modal that does not exist yet at load
// time. Binding per element would leak a listener on each of those.

function playerOf(el) {
    return el ? el.closest('[data-wiki-player]') : null;
}

function playerVideo(player) {
    return player ? player.querySelector('video') : null;
}

// The lazy observer has not necessarily reached this player yet - it only
// swaps the source when the video scrolls into view, and pressing play IS the
// reader asking for it now.
function ensurePlayerSource(video) {
    if (!video) return;
    const lazy = video.getAttribute('data-lazy-src');
    if (!lazy) return;
    video.src = lazy;
    video.removeAttribute('data-lazy-src');
}

function paintPlayerState(player) {
    const video = playerVideo(player);
    const toggle = player.querySelector('[data-player-toggle]');
    if (!video || !toggle) return;
    const playing = !video.paused && !video.ended;
    player.classList.toggle('is-playing', playing);
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function paintPlayerSound(player) {
    const video = playerVideo(player);
    const mute = player.querySelector('[data-player-mute]');
    if (!video || !mute) return;
    // volume 0 counts as muted: the two are different flags on the element and
    // a button that says "unmute" on a silent video is just wrong.
    const silent = video.muted || video.volume === 0;
    player.classList.toggle('is-muted', silent);
    mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
}

function paintPlayerProgress(player) {
    const video = playerVideo(player);
    const fill = player.querySelector('[data-player-fill]');
    const track = player.querySelector('[data-player-track]');
    if (!video || !fill) return;
    // A stream still loading reports duration NaN or Infinity, and a width of
    // "NaN%" silently leaves the bar wherever it was.
    const total = video.duration;
    const pct = (isFinite(total) && total > 0)
        ? Math.max(0, Math.min(100, (video.currentTime / total) * 100))
        : 0;
    fill.style.width = pct + '%';
    if (track) track.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function seekPlayer(player, clientX) {
    const video = playerVideo(player);
    const track = player.querySelector('[data-player-track]');
    if (!video || !track) return;

    const box = track.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));

    // The source is lazy, so the FIRST thing a reader does to a player can
    // easily be scrub a video the browser has not opened yet - duration is
    // NaN, and simply returning made the bar look dead. Remember where they
    // aimed and apply it when the metadata lands.
    ensurePlayerSource(video);
    const total = video.duration;
    if (!isFinite(total) || total <= 0) {
        player.dataset.pendingSeek = String(ratio);
        // preload="none" means the browser fetches NOTHING until playback is
        // asked for, so on its own the metadata would never arrive and the
        // pending seek would never fire. Asking for metadata is the smallest
        // request that makes the bar work before the first play.
        if (video.preload !== 'metadata' && video.preload !== 'auto') {
            video.preload = 'metadata';
            video.load();
        }
        return;
    }

    video.currentTime = ratio * total;
    paintPlayerProgress(player);
}

function applyPendingSeek(player) {
    const video = playerVideo(player);
    if (!video || !player.dataset.pendingSeek) return;
    const ratio = parseFloat(player.dataset.pendingSeek);
    const total = video.duration;
    if (!isFinite(total) || total <= 0 || !isFinite(ratio)) return;
    delete player.dataset.pendingSeek;
    video.currentTime = ratio * total;
}

document.addEventListener('click', (e) => {
    const openBtn = e.target.closest ? e.target.closest('[data-wiki-video]') : null;
    if (openBtn) {
        window.openWikiVideoModal(openBtn.getAttribute('data-wiki-video'));
        return;
    }

    const toggle = e.target.closest ? e.target.closest('[data-player-toggle]') : null;
    if (toggle) {
        const player = playerOf(toggle);
        const video = playerVideo(player);
        if (!video) return;
        ensurePlayerSource(video);
        if (video.paused || video.ended) video.play().catch(() => { /* the reader can press it again */ });
        else video.pause();
        return;
    }

    const mute = e.target.closest ? e.target.closest('[data-player-mute]') : null;
    if (mute) {
        const player = playerOf(mute);
        const video = playerVideo(player);
        if (!video) return;
        // Unmuting a video whose volume was dragged to zero elsewhere has to
        // restore a level too, or the button appears to do nothing.
        video.muted = !(video.muted || video.volume === 0);
        if (!video.muted && video.volume === 0) video.volume = 1;
        paintPlayerSound(player);
        return;
    }

    const track = e.target.closest ? e.target.closest('[data-player-track]') : null;
    if (track) seekPlayer(playerOf(track), e.clientX);
});

document.addEventListener('volumechange', (e) => {
    const player = playerOf(e.target);
    if (player) paintPlayerSound(player);
}, true);

// Capture phase: play, pause and timeupdate do not bubble, so a delegated
// listener never sees them any other way.
['play', 'pause', 'ended'].forEach((type) => {
    document.addEventListener(type, (e) => {
        const player = playerOf(e.target);
        if (player) paintPlayerState(player);
    }, true);
});

['timeupdate', 'loadedmetadata', 'durationchange', 'seeked'].forEach((type) => {
    document.addEventListener(type, (e) => {
        const player = playerOf(e.target);
        if (!player) return;
        applyPendingSeek(player);
        paintPlayerProgress(player);
    }, true);
});

// --- THE VIDEO MODAL (v0.15 item 11) ---
//
// Built on first use and reused after, rather than shipped in the markup of
// every page: forty-odd generated stubs would each need it, and most readers
// never open one.
function wikiVideoModal() {
    let modal = document.getElementById('wiki-video-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'wiki-video-modal';
    modal.className = 'wiki-video-modal hidden';
    modal.innerHTML = `
        <div class="wiki-video-modal-backdrop" data-video-modal-close></div>
        <div class="wiki-video-modal-panel" role="dialog" aria-modal="true" aria-label="Video">
            <button type="button" class="wiki-video-modal-close" data-video-modal-close
                    aria-label="Close">&#10007;</button>
            <div class="wiki-video-modal-body"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-video-modal-close]')) window.closeWikiVideoModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.closeWikiVideoModal();
    });
    return modal;
}

window.openWikiVideoModal = function (url) {
    const src = safeBlockUrl(url);
    if (!src) return null;

    const modal = wikiVideoModal();
    const body = modal.querySelector('.wiki-video-modal-body');
    body.innerHTML = window.wikiVideoPlayerHTML(src, 'wiki-player-modal');
    modal.classList.remove('hidden');

    const video = body.querySelector('video');
    if (video) {
        ensurePlayerSource(video);
        video.play().catch(() => { /* the play button is right there */ });
    }
    return modal;
};

window.closeWikiVideoModal = function () {
    const modal = document.getElementById('wiki-video-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    // Emptied rather than just hidden: a paused video left in the DOM keeps
    // its buffer, and reopening on a different clip would flash the old frame.
    const body = modal.querySelector('.wiki-video-modal-body');
    if (body) body.innerHTML = '';
};

window.loadPageDescriptions = loadPageDescriptions;
window.populateTextSection = populateTextSection;