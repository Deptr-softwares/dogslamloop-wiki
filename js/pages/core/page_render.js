/**
 * The page renderer. Turns a page's Blocks into HTML wherever Blocks show (reader
 * pages, the editor's preview, the review screens), and draws a character
 * page's tabs and a system page's tabs and sections. Also the video player, the
 * clip queue, video stills and the missing-media box.
 * @since v0.01
 * @touches page_data.desc_data, data/navigation.json, data/video-stills.json, the
 *   keyed sections and tab list in character_tabs.js
 * @watch every value from page data goes through window.escapeHtml, in text and
 *   in attributes. A CSS value is allowlisted instead (safeBlockAlign,
 *   safeBlockWidth): escaping does not stop `100%; background: url(...)`.
 * @watch every file a page loads shares one global scope, so a top-level name used
 *   twice stops the second file (tests/global-scope-collisions.spec.js). Hence
 *   the safeBlock prefix.
 * @see docs/character-page.md
 */

// An unknown CSS value falls back to the default: there is nothing legitimate to lose.
const BLOCK_ALIGNMENTS = ['left', 'center', 'right', 'justify'];
const safeBlockAlign = (align) => (BLOCK_ALIGNMENTS.includes(align) ? align : null);

// e.g. 50%, 400px, 32rem. Deliberately no calc(), var() or url().
const safeBlockWidth = (width) => (/^\d+(\.\d+)?(%|px|rem|em|vw|vh)$/.test(String(width || '').trim())
    ? String(width).trim() : null);

// A javascript:, data: or vbscript: address is dropped: escaping does nothing
// about a URL scheme.
const safeBlockUrl = (url) => {
    const raw = String(url === null || url === undefined ? '' : url).trim();
    return /^\s*(javascript|data|vbscript):/i.test(raw.replace(/[\u0000-\u0020]/g, '')) ? '' : raw;
};

// From the site's root: pages sit at three depths.
const MEDIA_PLACEHOLDER_SRC = '/medias/images/DogslamloopIcon.webp';

window.wikiMediaPlaceholderHTML = function () {
    return `
        <div class="wiki-media-placeholder">
            <span class="wiki-media-placeholder-label">Placeholder</span>
            <img src="${MEDIA_PLACEHOLDER_SRC}" alt="" class="wiki-media-placeholder-icon" loading="lazy">
        </div>
    `;
};

// Only our own wiki-media bucket: a cell that turned any address into media would
// let a contributor embed, and hotlink, from anywhere.
const WIKI_MEDIA_BUCKET_PATH = '/storage/v1/object/public/wiki-media/';
const WIKI_MEDIA_IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i;
const WIKI_MEDIA_VIDEO_RE = /\.(webm|mp4|m4v|mov|ogv)(\?|#|$)/i;

// 'image', 'video', or null for anything that is not in our bucket.
window.wikiMediaKind = function (value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!raw || /\s/.test(raw)) return null;

    // typeof: SUPABASE_URL is site_utils.js's, and a cache-skewed load can lack it.
    const base = typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '';
    if (!base) return null;
    if (raw.indexOf(base + WIKI_MEDIA_BUCKET_PATH) !== 0) return null;

    if (WIKI_MEDIA_IMAGE_RE.test(raw)) return 'image';
    if (WIKI_MEDIA_VIDEO_RE.test(raw)) return 'video';
    return null;
};

// The native player, for a video Block with controls on and for the video modal.
// It paints with var(--accent-blue), which site_lookups.js sets per character, so it
// takes the character's colour by itself.
window.wikiVideoPlayerHTML = function (url, extraClass) {
    const safe = window.escapeHtml(safeBlockUrl(url));
    if (!safe) return '';
    return `
        <div class="wiki-player${extraClass ? ' ' + window.escapeHtml(extraClass) : ''}" data-wiki-player>
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

// A video in a table cell or a card: a button that opens the video modal.
window.wikiVideoButtonHTML = function (url, label) {
    const safe = window.escapeHtml(safeBlockUrl(url));
    if (!safe) return '';
    return `<button type="button" class="wiki-video-btn" data-wiki-video="${safe}">`
        + `<span class="wiki-video-btn-glyph" aria-hidden="true"></span>`
        + `${window.escapeHtml(label || 'Watch')}</button>`;
};

/**
 * An autoplaying muted clip with a corner button that opens it in the video
 * modal. The video Block, skill-card media, the character Gallery tab and gallery
 * pages all draw clips with it.
 * @since v0.20
 * @watch a failed or moderated clip replaces the whole .wiki-clip wrapper
 *   (showMissingMedia, blockedMediaTarget in site_media.js), so the button never
 *   outlives its clip
 */
window.wikiClipHTML = function (url, opts) {
    const safe = window.escapeHtml(safeBlockUrl(url));
    if (!safe) return '';
    const o = opts || {};
    const label = o.label ? ` aria-label="${window.escapeHtml(o.label)}"` : '';
    return `<div class="wiki-clip">`
        + `<video data-lazy-src="${safe}" class="${window.escapeHtml(o.className || 'wiki-video-native')}"${label}`
        + ` autoplay loop muted playsinline preload="none"></video>`
        + `<button type="button" class="wiki-clip-open" data-wiki-video="${safe}"`
        + ` aria-label="Open in player" title="Open in player">`
        + `<span class="wiki-clip-open-glyph" aria-hidden="true"></span></button>`
        + `</div>`;
};

// extraStyles is CSS written in this file, never page data.
function getMediaAttributes(align, customWidth, extraStyles = '') {
    let alignClass = 'wiki-media-full';

    if (align === 'left') alignClass = 'wiki-media-left';
    else if (align === 'right') alignClass = 'wiki-media-right';
    else if (align === 'center') alignClass = 'wiki-media-center';

    return `class="wiki-media ${alignClass}" style="width: ${safeBlockWidth(customWidth) || '100%'}; ${extraStyles}"`;
}

/**
 * The Overview's "Pick if you like" and "Avoid if you dislike" lists.
 * @since v0.4
 */
window.generatePlaystyleHTML = function(playstyle) {
    if (!playstyle || (!playstyle.likes?.length && !playstyle.dislikes?.length)) return '';
    
    const renderList = (items, icon, variant) => items.map(text => `
        <li class="playstyle-item">
            <span class="playstyle-icon ${variant}">${icon}</span>
            <span class="playstyle-item-text">${window.escapeHtml(text)}</span>
        </li>
    `).join('');

    return `
        <div class="playstyle-container">
            <div class="playstyle-col likes">
                <h4 class="playstyle-header">Pick if you like</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.likes || [], '✓', 'likes')}
                </ul>
            </div>
            <div class="playstyle-col dislikes">
                <h4 class="playstyle-header">Avoid if you dislike</h4>
                <ul class="playstyle-list">
                    ${renderList(playstyle.dislikes || [], '✖', 'dislikes')}
                </ul>
            </div>
        </div>
    `;
};

/**
 * The grids a Color Swatches Block can draw. The editor's dropdown reads this
 * list too.
 * @since v1.2
 */
window.COLOR_SWATCH_SETS = { characters: 'Character Themes', frames: 'Frame Data Types', overlays: 'Stackable Overlays' };

// The colour as an editor types it in [color=#...]: a canvas answers #rrggbb for
// any opaque colour. A value it cannot read leaves the sentinel, and shows no code.
let swatchCanvas = null;
function swatchHex(value) {
    if (!value) return '';
    swatchCanvas = swatchCanvas || document.createElement('canvas').getContext('2d');
    swatchCanvas.fillStyle = '#010203';
    swatchCanvas.fillStyle = String(value);
    const out = swatchCanvas.fillStyle;
    return out === '#010203' && String(value).trim().toLowerCase() !== '#010203' ? '' : out;
}

function swatchCardHTML(title, visual, code) {
    return `<div class="color-swatch-card">${visual}<div class="swatch-meta">`
        + `<span class="swatch-title">${window.escapeHtml(title)}</span>`
        + `<span class="swatch-code">${window.escapeHtml(code)}</span></div></div>`;
}

// The class names are site_lookups.js's own keys, never page data.
function colorSwatchesHTML(set) {
    const which = Object.prototype.hasOwnProperty.call(window.COLOR_SWATCH_SETS, set) ? set : 'characters';
    const labels = window.FRAME_COLOR_LABELS || {};
    if (which === 'frames') {
        const frames = window.FRAME_COLORS || {};
        const cards = Object.keys(frames).map(cls => swatchCardHTML(labels[cls] || cls,
            `<div class="swatch-color-block ${cls}"><div class="frame-tick"></div></div>`, swatchHex(frames[cls])));
        return `<div class="color-swatch-grid" data-swatch-set="frames">${cards.join('')}</div>`;
    }
    if (which === 'overlays') {
        const windows = window.WINDOW_COLORS || {};
        const cards = Object.keys(windows).map(key => swatchCardHTML(labels[key] || key,
            `<div class="swatch-overlay-well"><div class="window-overlay span-${key}"></div></div>`, swatchHex(windows[key])));
        return `<div class="color-swatch-grid" data-swatch-set="overlays">${cards.join('')}</div>`;
    }
    // The character grid needs the registry, which is fetched, so fillColorSwatches
    // draws it once this is on the page.
    return '<div class="color-swatch-grid" data-swatch-set="characters"><p class="loading-msg loading-msg-busy">Loading the character colors...</p></div>';
}

window.fillColorSwatches = async function (root) {
    const grids = Array.from((root || document).querySelectorAll('.color-swatch-grid[data-swatch-set="characters"]:not([data-filled])'));
    if (grids.length === 0) return;
    grids.forEach(grid => grid.setAttribute('data-filled', 'pending'));

    const roster = typeof window.loadCharacterRoster === 'function' ? await window.loadCharacterRoster() : new Map();
    const colors = window.CHARACTER_COLORS || {};
    const cards = [];
    roster.forEach(entry => {
        if (entry.hidden) return;
        const color = typeof window.safeColor === 'function' ? window.safeColor(colors[entry.name]) : null;
        if (!color) return;
        cards.push(swatchCardHTML(entry.name,
            `<div class="swatch-color-block" style="background-color: ${color};"></div>`, swatchHex(color)));
    });

    grids.forEach(grid => {
        grid.setAttribute('data-filled', 'true');
        grid.innerHTML = cards.length
            ? cards.join('')
            : '<p class="loading-msg">The character colors could not be loaded.</p>';
    });
};

/**
 * A Collaborator Block's badge colours (the Update Log's badges). The editor's
 * dropdown reads this list, and nothing outside it reaches the class.
 * @since v1.2
 */
window.COLLABORATOR_BADGES = { 'badge-general': 'Purple', 'badge-site': 'Green', 'badge-patch': 'Blue', 'badge-wip': 'Yellow', 'badge-ea': 'Orange' };

const collaboratorKind = (b) => (b && b.type === 'collaborator' ? (b.kind === 'line' ? 'line' : 'card') : null);

/**
 * Only an http(s) address becomes a link. The editor's form names the lines that
 * fail it, so none is dropped without a word.
 * @since v1.2
 */
window.isCollaboratorLink = (url) => /^https?:\/\/\S+$/i.test(String(url || '').trim());

function collaboratorCardHTML(b) {
    const name = window.escapeHtml(b.name || '');
    const badge = Object.prototype.hasOwnProperty.call(window.COLLABORATOR_BADGES, b.badge) ? b.badge : 'badge-general';
    // As given, like an Image Block's address: an avatar is a path from the site's
    // root (/medias/images/...).
    const avatar = safeBlockUrl(b.avatar);
    const links = (Array.isArray(b.links) ? b.links : [])
        .filter(l => l && window.isCollaboratorLink(l.url))
        .map(l => `<a href="${window.escapeHtml(String(l.url).trim())}" target="_blank" rel="noopener noreferrer" class="btn-sys btn-sys-blue collaborator-link">${window.escapeHtml(l.name || l.url)}</a>`)
        .join('');
    return '<div class="wiki-card collaborator-card"><div class="contributor-card"><div class="contributor-header">'
        + (avatar
            ? `<img src="${window.escapeHtml(avatar)}" alt="${name}" class="contributor-avatar" loading="lazy">`
            : '<div class="contributor-avatar-placeholder">N/A</div>')
        + `<div><h3 class="collaborator-name">${name}</h3>`
        + `<span class="update-badge ${badge}">${window.escapeHtml(b.role || '')}</span></div></div>`
        + `<p class="strategy-paragraph collaborator-description">${window.escapeHtml(b.description || '')}</p>`
        + (links ? `<div class="collaborator-links">${links}</div>` : '')
        + '</div></div>';
}

function collaboratorLineHTML(b) {
    return `<li class="collaborator-line"><strong class="collaborator-line-name">${window.escapeHtml(b.name || '')}</strong>`
        + (b.description ? ` - <span class="collaborator-line-reason">${window.escapeHtml(b.description)}</span>` : '')
        + '</li>';
}

/**
 * Every Block in a list to HTML. Nested Blocks (an accordion, a Section Box, a
 * Combo Card) come back through this same call.
 * @since v0.4
 * @touches window.previewBlockAnchor, defined only on edit.html, which marks where
 *   each Block starts for the Preview follows the Block setting
 * @watch only the outermost list is marked (blockRenderDepth): a Block's place in
 *   the Workspace is its place at the top level
 */
let blockRenderDepth = 0;
window.generateHTMLForBlocks = function (blocks, contextClass = '') {
    const anchor = blockRenderDepth === 0 && typeof window.previewBlockAnchor === 'function' ? window.previewBlockAnchor : null;
    blockRenderDepth++;
    try {
        return renderBlocksHTML(blocks, contextClass, anchor);
    } finally {
        blockRenderDepth--;
    }
};

function renderBlocksHTML(blocks, contextClass = '', anchor = null) {
    let contentHTML = '';
    let sectionAuthors = new Set();
    
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    blocks.forEach((block, blockIndex) => {
        if (!block) return;
        const blockStart = contentHTML.length;
        
        const alignAttr = getAlignStyle(block.align); 
        
        if (block.type === 'heading') {
            // safeColor admits no quote or semicolon, so the bar's colour cannot leave the
            // style attribute.
            const bar = typeof window.safeColor === 'function' ? window.safeColor(block.sideBar) : null;
            const headingClass = bar ? 'wiki-block-heading wiki-block-heading-bar' : 'wiki-block-heading';

            // Allowlisted: block.size is contributor-set and lands in the tag
            // NAME, so an unchecked value writes an arbitrary element.
            const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(block.size) ? block.size : 'h3';
            const headingStyle = getAlignStyle(block.align, bar ? `--heading-bar: ${bar};` : '');

            contentHTML += `<${tag} class="${headingClass}" ${headingStyle}>${window.escapeHtml(block.content)}</${tag}>`;
        }
        else if (block.type === 'paragraph') {
            // Escape FIRST, then join and add the generated markup - the <br>
            // and the <kbd> are this renderer's, not the contributor's.
            const rawText = Array.isArray(block.content)
                ? block.content.map(window.escapeHtml).join('<br>')
                : window.escapeHtml(block.content);

            // Keybinds. Escaping alters none of A-Z, digits, spaces and +, so [M1] is still found.
            let text = rawText.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');

            const pClass = contextClass ? 'strategy-paragraph card-text' : 'strategy-paragraph';
            contentHTML += `<p class="${pClass}" ${alignAttr}>${text}</p>`;
        }
        else if (block.type === 'list') {
            const lClass = (contextClass ? 'wiki-block-list space-y-2 card-text' : 'wiki-block-list space-y-2 text-gray-300')
                + (block.boxed ? ' wiki-block-list-boxed' : '');
            contentHTML += `<ul class="${lClass}" ${alignAttr}>`;
            block.items.forEach(item => { contentHTML += `<li>${window.escapeHtml(item)}</li>`; });
            contentHTML += `</ul>`;
        }
        else if (block.type === 'image') {
            // No address: the placeholder, never <img src="">, which draws a broken box.
            if (!safeBlockUrl(block.src)) {
                contentHTML += block.caption
                    ? `<figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')}>`
                      + window.wikiMediaPlaceholderHTML()
                      + `<figcaption class="wiki-figcaption">${window.escapeHtml(block.caption)}</figcaption></figure>`
                    : `<div ${getMediaAttributes(block.align, block.width)}>`
                      + window.wikiMediaPlaceholderHTML() + `</div>`;
            }
            else if (block.caption) {
                contentHTML += `
                    <figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')} >
                        <img src="${window.escapeHtml(safeBlockUrl(block.src))}" alt="${window.escapeHtml(block.alt || 'Wiki Image')}" class="wiki-block-image" loading="lazy">
                        <figcaption class="wiki-figcaption">
                            ${window.escapeHtml(block.caption)}
                        </figcaption>
                    </figure>
                `;
            } else {
                contentHTML += `<img src="${window.escapeHtml(safeBlockUrl(block.src))}" alt="${window.escapeHtml(block.alt || 'Wiki Image')}" ${getMediaAttributes(block.align, block.width, 'box-shadow: 4px 4px 0px var(--manga-shadow, #000);')} loading="lazy">`;
            }
        }
        else if (block.type === 'divider') {
            const bData = block.data || block;

            // Older dividers stored invisible: true instead of a style.
            let currentStyle = bData.style || (bData.invisible ? 'invisible' : 'diamond');
            let paddingClass = bData.padding || 'normal';

            const validPadding = ['none', 'small', 'normal', 'large', 'massive'];
            const padClass = `wiki-divider-pad-${validPadding.includes(paddingClass) ? paddingClass : 'normal'}`;

            let divHtml = '';

            switch (currentStyle) {
                case 'invisible':
                    divHtml = ``; // only the margin
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
        else if (block.type === 'author') {
            // Credited in the footer below.
        }
        else if (block.type === 'callout') {
            const bData = block.data || block; 
            
            const intentMap = {
                // Typed in normal case: the default look shows them in capitals
                // (.inline-callout-btn), the Classic look as written.
                'tip': { color: '#facc15', icon: '💡', label: 'Tip' },
                'warning': { color: '#fb923c', icon: '⚠️', label: 'Warning' },
                'danger': { color: '#ef4444', icon: '🚨', label: 'Danger' },
                'info': { color: '#22d3ee', icon: '📌', label: 'Info' }
            };
            const config = intentMap[bData.intent] || intentMap['info'];
            // Escape, then join. config.color is intentMap's, never the Block's.
            const text = Array.isArray(bData.content)
                ? bData.content.map(window.escapeHtml).join('<br>')
                : window.escapeHtml(bData.content || bData.text || '');

            let tooltipContent = '';
            if (bData.title) {
                tooltipContent += `<strong class="callout-tooltip-title" style="--tooltip-accent: ${config.color};">${window.escapeHtml(bData.title)}</strong>`;
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
        else if (block.type === 'table') {
            const bData = block.data || block;

            const headers = bData.headers || [];
            const rows = bData.rows || [];
            
            let tableContent = '<table class="update-table wiki-content-table">';

            if (headers.length > 0) {
                tableContent += `<thead><tr>`;
                headers.forEach(h => {
                    tableContent += `<th>${window.escapeHtml(h)}</th>`;
                });
                tableContent += `</tr></thead>`;
            }

            if (rows.length > 0) {
                tableContent += `<tbody>`;
                rows.forEach((row) => {
                    tableContent += `<tr>`;

                    // A cell holding one of our storage links shows the media: an image sized to the
                    // row, a video as a button, because a player does not fit in a cell.
                    row.forEach(cell => {
                        const kind = window.wikiMediaKind(cell);
                        if (kind === 'image') {
                            tableContent += `<td class="wiki-cell-media-td">`
                                + `<img src="${window.escapeHtml(safeBlockUrl(cell))}" alt=""`
                                + ` class="wiki-cell-media" loading="lazy"></td>`;
                            return;
                        }
                        if (kind === 'video') {
                            tableContent += `<td class="wiki-cell-media-td">`
                                + window.wikiVideoButtonHTML(cell, 'Play') + `</td>`;
                            return;
                        }
                        let parsedCell = window.escapeHtml(cell).replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                        tableContent += `<td>${parsedCell}</td>`;
                    });
                    tableContent += `</tr>`;
                });
                tableContent += `</tbody>`;
            } else {
                tableContent += '<tr><td class="wiki-table-empty-cell">Table data is empty.</td></tr>';
            }
            tableContent += '</table>';

            contentHTML += `
                <div class="wiki-table-wrapper">
                    ${tableContent}
                </div>
            `;
        }
        else if (block.type === 'youtube' || block.type === 'video' || block.type === 'embed') {
            const bData = block.data || block; 
            let mediaInnerHtml = '';

            if (block.type === 'youtube' || bData.videoId) {
                let videoId = String(bData.videoId || bData.url || '');
                const ytMatch = videoId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
                if (ytMatch) videoId = ytMatch[1];

                // Held to the 11-character id shape, so no contributor string reaches the src raw.
                if (!/^[\w-]{11}$/.test(videoId)) videoId = '';

                if (videoId) {
                    // The privacy-enhanced address: no cookies until the reader presses play. The
                    // Privacy Policy says so.
                    mediaInnerHtml = `
                        <iframe data-lazy-src="https://www.youtube-nocookie.com/embed/${videoId}" src="about:blank"
                                class="wiki-video-embed" title="YouTube video"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen>
                        </iframe>
                    `;
                }
            } 
            else if (block.type === 'video') {
                const videoUrl = bData.url || bData.src || '';
                if (videoUrl) {
                    // Controls on: the player. Off: a muted loop with a corner button (wikiClipHTML).
                    mediaInnerHtml = bData.controls
                        ? window.wikiVideoPlayerHTML(videoUrl)
                        : window.wikiClipHTML(videoUrl);
                }
            }

            // No address: the placeholder, so the author can see the Block is there.
            if (!mediaInnerHtml) {
                mediaInnerHtml = window.wikiMediaPlaceholderHTML();
            }

            if (mediaInnerHtml) {
                if (bData.caption) {
                    contentHTML += `
                        <figure ${getMediaAttributes(bData.align, bData.width, 'text-align: center;')} >
                            ${mediaInnerHtml}
                            <figcaption class="wiki-figcaption">
                                ${window.escapeHtml(bData.caption)}
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
        else if (block.type === 'accordion' || block.type === 'details') {
            const bData = block.data || block; 
            const title = bData.title || bData.summary || 'COLLAPSIBLE SECTION';

            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            contentHTML += `
                <div class="wiki-accordion-wrapper">
                    <details class="manga-accordion">
                        <summary class="wiki-accordion-summary" style="text-align: ${safeBlockAlign(bData.align) || 'left'};">
                            <span>${window.escapeHtml(title)}</span>
                            <span class="accordion-arrow">▼</span>
                        </summary>
                        <div class="wiki-accordion-body">
                            ${innerHTML}
                        </div>
                    </details>
                </div>
            `;
        }
        // The Section Box: a title, an introduction and switchable tabs, each holding Blocks.
        else if (block.type === 'sectionedbox') {
            const bData = block.data || block;
            const sections = Array.isArray(bData.sections) ? bData.sections : [];
            const introHTML = window.generateHTMLForBlocks(bData.intro || [], contextClass);

            // Boxed only inside a Combos or Techs group; anywhere else it would be a card in a
            // card. Asked of getDocumentSections, never by tab name, so a third document tab
            // gets the right behaviour.
            const boxed = typeof window.getDocumentSections === 'function'
                && !!window.getDocumentSections(contextClass);

            const panelsHTML = sections.map((sec, i) =>
                sboxPanelHTML(i, window.generateHTMLForBlocks(sec.content || [], contextClass))
            ).join('');

            // The click listener and the repaint restore key off `sbox-tabbed`. A multi-section
            // Combo Card carries it too, which is how one implementation serves both.
            contentHTML += `
                <section class="sbox sbox-tabbed${boxed ? ' sbox-boxed' : ''}" ${alignAttr}>
                    <h4 class="sbox-title">${window.escapeHtml(bData.title || 'Section Box')}</h4>
                    ${introHTML ? `<div class="sbox-intro">${introHTML}</div>` : ''}
                    ${sections.length ? sboxTabRowHTML(sections.map((sec, i) => sec.title || `Section ${i + 1}`)) : ''}
                    ${panelsHTML}
                </section>
            `;
        }
        // The Combo Card (stored as theorybox): a route, its numbers and a write-up in Blocks.
        else if (block.type === 'theorybox') {
            const bData = block.data || block;
            const sections = Array.isArray(bData.sections) ? bData.sections : [];

            // Multiple Sections: each tab is a whole variant (route, damage, clip, write-up).
            // The tab label and the card's title are separate fields, and the label falls back
            // to the title. A section with no route and no damage reads as prose (a Preface).
            if (bData.multiSections && sections.length) {
                // A label falling back to a styled name shows its plain text:
                // a tab is a button, and the styling pass never reaches it.
                const labels = sections.map((sec, i) => sec.label
                    || window.stripStyleShortcodes(sec.title).trim() || `Section ${i + 1}`);
                const panels = sections.map((sec, i) =>
                    sboxPanelHTML(i, theoryboxCardHTML(sec, contextClass))).join('');

                contentHTML += `
                    <div class="theorybox-sections sbox-tabbed" ${alignAttr}>
                        ${sboxTabRowHTML(labels)}
                        ${panels}
                    </div>
                `;
            } else {
                contentHTML += theoryboxCardHTML(bData, contextClass);
            }
        }
        else if (block.type === 'combo') {
            if ((block.sequence && block.sequence.length > 0) || window.comboNotationStyles(block).length > 1) {
                
                let justifyClass = 'flex-start';
                if (block.align === 'center') justifyClass = 'center';
                if (block.align === 'right') justifyClass = 'flex-end';

                let comboHTML = `<div class="combo-block">`;

                comboHTML += window.comboRouteHTML(block, {
                    style: `justify-content: ${justifyClass};`,
                    trailing: block.damage ? `<span class="combo-damage">${window.escapeHtml(block.damage)}</span>` : '',
                });

                if (block.note) {
                    comboHTML += `<div class="combo-note-row" style="justify-content: ${justifyClass};">`
                        + `<span class="combo-note">${window.escapeHtml(block.note)}</span></div>`;
                }

                comboHTML += `</div>`;
                contentHTML += comboHTML;
            }
        }
        else if (block.type === 'colorswatches') {
            contentHTML += colorSwatchesHTML(block.set);
        }
        else if (block.type === 'collaborator') {
            const kind = collaboratorKind(block);
            const [open, close] = kind === 'line'
                ? ['<ul class="wiki-block-list collaborator-thanks">', '</ul>']
                : ['<div class="grid-layout-3col collaborator-grid">', '</div>'];
            contentHTML += (collaboratorKind(blocks[blockIndex - 1]) !== kind ? open : '')
                + (kind === 'line' ? collaboratorLineHTML(block) : collaboratorCardHTML(block))
                + (collaboratorKind(blocks[blockIndex + 1]) !== kind ? close : '');
        }

        if (anchor) contentHTML = contentHTML.slice(0, blockStart) + anchor(contentHTML.slice(blockStart), blockIndex, block);

        if (block.author && block.author.trim() !== '') {
            // One Block can credit several authors, comma-separated.
            block.author.split(',').forEach(a => sectionAuthors.add(a.trim()));
        }
    });

    if (sectionAuthors.size > 0) {
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
}

/**
 * The difficulty scale, easiest first. The order is the sort key: "Demon Time"
 * sorts first alphabetically and last by difficulty.
 * @since v0.15
 */
window.COMBO_DIFFICULTIES = [
    'Very Easy', 'Easy', 'Medium', 'Slightly Hard',
    'Hard', 'Very Hard', 'Extremely Hard', 'Demon Time',
];

/**
 * The Combo List's columns, in order. A `conditional` column shows only when some
 * row fills it in; `sort: null` is a column with no meaningful order.
 * @since v0.15
 */
window.COMBO_COLUMNS = [
    { field: 'sequence',    label: 'Combo',       sort: 'route' },
    { field: 'damage',      label: 'Damage',      sort: 'leadingNumber' },
    { field: 'position',    label: 'Position',    sort: 'text' },
    { field: 'difficulty',  label: 'Difficulty',  sort: 'difficulty' },
    { field: 'practicality', label: 'Practicality', sort: 'text', conditional: true },
    { field: 'worksOn',     label: 'Works On',    sort: 'text' },
    { field: 'setup',       label: 'Setup',       sort: 'text', conditional: true },
    { field: 'controls',    label: 'Controls',    sort: null,   conditional: true },
    { field: 'gameVersion', label: 'Ver',         sort: null },
    { field: 'video',       label: 'Video',       sort: null },
    { field: 'notes',       label: 'Notes',       sort: 'text' },
];

/**
 * The value a Combo List column sorts by. Damage sorts on its leading number
 * ("4 (2+2)" before "38-46"), and a row with no number sorts last, not as zero.
 * @since v0.15
 */
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

// The columns a set of rows shows: every column, less the conditional ones no row
// fills. Called with every row of a tab, so all its tables share one shape.
window.comboVisibleColumns = function (rows) {
    const list = Array.isArray(rows) ? rows : [];
    return window.COMBO_COLUMNS.filter(col => {
        if (!col.conditional) return true;
        return list.some(r => r && String(r[col.field] || '').trim() !== '');
    });
};

// Notation styles. item.sequence is the first style, unlabelled, and
// item.notations holds [{ label, sequence }] beside it. A reader's choice is a
// label, matched ignoring case and extra spaces; it applies to every combo and is
// remembered.
const COMBO_NOTATION_STORE = 'dsl-combo-notation';
// Held in memory too, so switching still works for the rest of the visit when
// storage is blocked (a private window, cleared site data).
let comboNotationChoice = null;

/**
 * A notation label as a key: trimmed, spaces collapsed, lower case.
 * @since v0.20
 */
window.comboNotationKey = function (label) {
    return String(label === null || label === undefined ? '' : label)
        .trim().replace(/\s+/g, ' ').toLowerCase();
};

// The first style's steps exactly as stored, blanks included, so a combo with one
// style renders as it always has. An added style drops blank steps (a trailing
// comma in the Combo Block's field makes one).
function comboFirstSteps(sequence) {
    return Array.isArray(sequence) ? sequence : (sequence ? [sequence] : []);
}

// The styles a reader can switch between, the first style first. A style counts
// only with a label and a step; a repeated label keeps its first route.
window.comboNotationStyles = function (item) {
    const styles = [{ label: '', key: '', sequence: comboFirstSteps(item && item.sequence) }];
    const seen = new Set();
    (item && Array.isArray(item.notations) ? item.notations : []).forEach(n => {
        const label = String((n && n.label) || '').trim();
        const key = window.comboNotationKey(label);
        const steps = (n && Array.isArray(n.sequence) ? n.sequence : [])
            .filter(s => String(s === null || s === undefined ? '' : s).trim() !== '');
        if (!key || !steps.length || seen.has(key)) return;
        seen.add(key);
        styles.push({ label, key, sequence: steps });
    });
    return styles;
};

window.comboNotationPreference = function () {
    if (comboNotationChoice !== null) return comboNotationChoice;
    try { return window.localStorage.getItem(COMBO_NOTATION_STORE) || ''; } catch (e) { return ''; }
};

function saveComboNotationPreference(key) {
    comboNotationChoice = key || '';
    try {
        if (key) window.localStorage.setItem(COMBO_NOTATION_STORE, key);
        else window.localStorage.removeItem(COMBO_NOTATION_STORE);
    } catch (e) { /* the in-memory choice above still holds for this visit */ }
}

function comboNotationTitle(label, index, count) {
    return `Notation ${index + 1} of ${count}${label ? ': ' + label : ''}. Click the route to switch.`;
}

// The review screens mark a diff with control characters that resolveDiffMarkers
// (admin-diff.js) turns into <ins> and <del> by rewriting the HTML as a string.
// Inside an attribute they would break its quotes, so attributes get them
// stripped; the visible name keeps them.
const stripDiffMarks = (s) => String(s === null || s === undefined ? '' : s).replace(/[\u0011-\u0014]/g, '');

/**
 * Every notation style's label and steps, diffed by position like the route
 * beside them. The review queue (admin-preview.js) and the editor's diff
 * (editor-sync.js) both call it, so the two cannot disagree.
 * @since v0.20
 */
window.diffComboNotations = function (oldList, newList) {
    const before = Array.isArray(oldList) ? oldList : [];
    const after = Array.isArray(newList) ? newList : [];
    const out = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
        const o = before[i] || {};
        const n = after[i] || {};
        const oSteps = Array.isArray(o.sequence) ? o.sequence : [];
        const nSteps = Array.isArray(n.sequence) ? n.sequence : [];
        const steps = [];
        for (let k = 0; k < Math.max(oSteps.length, nSteps.length); k++) {
            steps[k] = window.diffTextLCS(oSteps[k] || '', nSteps[k] || '');
        }
        out.push({ label: window.diffTextLCS(o.label || '', n.label || ''), sequence: steps });
    }
    return out;
};

// The chips for every route. '>' as the community writes it by hand, aria-hidden so
// a screen reader does not say "greater than" between every step.
function comboStepsHTML(steps) {
    return steps.map((step, i) => `<span class="combo-node">${window.escapeHtml(step)}</span>`
        + (i < steps.length - 1 ? '<span class="combo-sep" aria-hidden="true">&gt;</span>' : '')).join('');
}

// A route row, for a Combo Block, a Combo Card and a Combo Row. `style` is a
// declaration the caller built from safe values, `trailing` is HTML after the steps
// (the damage). With notation styles every route is in the DOM and one is shown,
// so switching flips `hidden`, and the colour-coding pass has seen them all.
window.comboRouteHTML = function (item, opts) {
    const o = opts || {};
    const styles = window.comboNotationStyles(item);
    const cls = 'combo-container' + (o.className ? ' ' + o.className : '');
    const styleAttr = o.style ? ` style="${o.style}"` : '';
    const trailing = o.trailing || '';

    if (styles.length === 1) {
        return `<div class="${cls}"${styleAttr}>${comboStepsHTML(styles[0].sequence)}${trailing}</div>`;
    }

    const choice = window.comboNotationPreference();
    const active = Math.max(0, styles.findIndex(s => stripDiffMarks(s.key) === choice));
    const title = window.escapeHtml(comboNotationTitle(stripDiffMarks(styles[active].label), active, styles.length));

    const mark = '<span class="combo-notation-mark" aria-hidden="true">'
        + styles.map((s, i) => `<i${i === active ? ' class="is-on"' : ''}></i>`).join('')
        + '</span>';
    // `.combo-notation-name` is hidden on the page and shown on the review screens,
    // where every style is laid out with its name. The first style is named Route.
    const routes = styles.map((s, i) =>
        `<span class="combo-notation" data-notation-key="${window.escapeHtml(stripDiffMarks(s.key))}"`
        + ` data-notation-label="${window.escapeHtml(stripDiffMarks(s.label))}"${i === active ? '' : ' hidden'}>`
        + `<span class="combo-notation-name">${window.escapeHtml(s.label || 'Route')}</span>`
        + comboStepsHTML(s.sequence) + '</span>').join('');

    return `<div class="${cls} combo-has-notations"${styleAttr} role="button" tabindex="0"`
        + ` data-notation-active="${active}" title="${title}" aria-label="${title}">`
        + mark + routes + trailing + '</div>';
};

function showComboNotation(container, index) {
    const routes = container.querySelectorAll(':scope > .combo-notation');
    if (!routes.length) return;
    const at = Math.max(0, Math.min(index, routes.length - 1));
    routes.forEach((r, i) => { r.hidden = i !== at; });
    container.querySelectorAll(':scope > .combo-notation-mark > i')
        .forEach((m, i) => m.classList.toggle('is-on', i === at));
    container.setAttribute('data-notation-active', String(at));
    const text = comboNotationTitle(routes[at].getAttribute('data-notation-label') || '', at, routes.length);
    container.title = text;
    container.setAttribute('aria-label', text);
}

// Every combo on the page to the reader's choice: the style with that label
// where a combo has one, its first route where it does not.
window.applyComboNotationPreference = function (root) {
    const choice = window.comboNotationPreference();
    (root || document).querySelectorAll('.combo-has-notations').forEach(container => {
        const routes = [...container.querySelectorAll(':scope > .combo-notation')];
        showComboNotation(container, Math.max(0, routes.findIndex(r => r.getAttribute('data-notation-key') === choice)));
    });
};

// The next style of THIS combo becomes the reader's choice everywhere.
function cycleComboNotation(container) {
    const routes = container.querySelectorAll(':scope > .combo-notation');
    if (routes.length < 2) return;
    const current = parseInt(container.getAttribute('data-notation-active'), 10) || 0;
    const next = routes[(current + 1) % routes.length];
    saveComboNotationPreference(next.getAttribute('data-notation-key') || '');
    window.applyComboNotationPreference(document);
}

// The review screens lay every style out at once, so a click there has
// nothing to switch, and must not change the reviewer's own reading choice.
const inReviewDiff = (el) => !!el.closest('.diff-inline-target');

document.addEventListener('click', (e) => {
    const container = e.target.closest && e.target.closest('.combo-has-notations');
    if (!container || inReviewDiff(container)) return;
    // Dragging across the route to copy it is not a request to switch.
    const selection = window.getSelection ? String(window.getSelection()) : '';
    if (selection && container.contains(window.getSelection().anchorNode)) return;
    cycleComboNotation(container);
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const container = e.target.closest && e.target.closest('.combo-has-notations');
    // Only when the route itself has focus, never a field that happens to sit
    // inside something with the class.
    if (!container || container !== e.target || inReviewDiff(container)) return;
    e.preventDefault();
    cycleComboNotation(container);
});

// The Combo List's route cell. It takes the whole row, so the row's styles come along.
function renderComboRoute(row) {
    const styles = window.comboNotationStyles(row);
    if (styles.length === 1 && styles[0].sequence.length === 0) return '<span class="combo-route-empty">-</span>';
    return window.comboRouteHTML(row, { className: 'combo-route-inline' });
}

// Ult Gain and Evasive Gain are bold lines above the notes: two more columns on a
// ten-wide table, for two values that are usually blank, is a bad trade.
function renderComboNotes(row) {
    let html = '';
    [['ultGain', 'Ult Gain'], ['evasiveGain', 'Evasive Gain']].forEach(([field, label]) => {
        const value = String(row[field] || '').trim();
        if (value) html += `<div class="combo-resource"><strong>${label}:</strong> ${window.escapeHtml(value)}</div>`;
    });
    const notes = String(row.notes || '').trim();
    if (notes) html += `<div class="combo-note-text">${window.escapeHtml(notes)}</div>`;
    return html || '<span class="combo-cell-empty">-</span>';
}

function renderComboCell(row, column) {
    if (column.field === 'sequence') return renderComboRoute(row);
    if (column.field === 'notes') return renderComboNotes(row);

    const value = String(row[column.field] === null || row[column.field] === undefined ? '' : row[column.field]).trim();
    if (!value) return '<span class="combo-cell-empty">-</span>';

    if (column.field === 'video') {
        const href = safeBlockUrl(value);
        if (!href) return '<span class="combo-cell-empty">-</span>';
        return window.wikiVideoButtonHTML(href, 'Watch');
    }
    if (column.field === 'difficulty') {
        // Slot index rather than the label, so the ramp is a class and the
        // palette lives in CSS with every other colour on the site.
        const i = window.COMBO_DIFFICULTIES.indexOf(value);
        const slot = i === -1 ? '' : ` combo-difficulty-${i}`;
        return `<span class="combo-difficulty${slot}">${window.escapeHtml(value)}</span>`;
    }
    return window.escapeHtml(value);
}

/**
 * Fills a Combo List table's body, sorted. Sorting draws the rows again rather
 * than moving nodes, so a malformed row cannot leave the table half sorted.
 * @since v0.15
 */
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
                + ` data-label="${window.escapeHtml(col.label)}">${html}</td>`;
        }).join('');
        return `<tr class="combo-row">${cells}</tr>`;
    }).join('');
};

// One captioned, sortable table in the Combo List.
window.renderComboListTable = function (group, section) {
    const wrapper = document.createElement('section');
    wrapper.className = 'wiki-section wiki-section-clip combo-list-table';

    const name = group[section.keyField] || 'Untitled';
    wrapper.innerHTML = `
        <div class="card-header-flex">
            <h3 class="card-header-title">${window.escapeHtml(name)}</h3>
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

    // It scrolls inside its own box. Below the breakpoint, CSS turns each row into a
    // card, as it does for matchups: ten columns cannot fit a phone.
    const scroller = document.createElement('div');
    scroller.className = 'combo-table-scroll';

    const table = document.createElement('table');
    table.className = 'combo-table';
    table.innerHTML = `
        <thead>
            <tr>${columns.map(col => (col.sort
                ? `<th class="combo-th combo-th-sortable" data-sort-field="${window.escapeHtml(col.field)}"`
                  + ` role="button" tabindex="0" aria-sort="none">${window.escapeHtml(col.label)}`
                  + `<span class="combo-sort-arrow" aria-hidden="true"></span></th>`
                : `<th class="combo-th">${window.escapeHtml(col.label)}</th>`)).join('')}</tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    let sort = { column: null, dir: 'asc' };
    window.renderComboTableBody(tbody, rows, columns, sort);

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

    // Prose and Combo Cards under the table, if the group has any.
    if (Array.isArray(group.content) && group.content.length > 0) {
        const prose = document.createElement('div');
        prose.className = 'combos-content';
        // Prefixed with the tab: Combos and Techs can both have a table called "5H Starters".
        prose.id = `${section.tab}-content-${String(name).replace(/\s+/g, '-')}`;
        wrapper.appendChild(prose);
        populateTextSection(prose.id, '', group.content, section.tab);
        const injected = prose.querySelector('section.wiki-section');
        if (injected) injected.classList.remove('wiki-section');
    }

    return wrapper;
};

// What a reader set by clicking that only the DOM holds: which accordions are open,
// and which tab each Section Box or multi-section Combo Card shows. The editor
// repaints its preview on every keystroke, so both repaint paths
// (populateTextSection, renderDocumentTab) carry it over. Matched by position,
// never by title: the title is what changes while a section is renamed. A reorder
// at worst hands a box its neighbour's tab, which the next click corrects.
window.captureNestedViewState = function (container) {
    if (!container) return { open: [], tabs: [] };
    return {
        open: Array.prototype.map.call(container.querySelectorAll('details'), (d) => d.open),
        tabs: Array.prototype.map.call(container.querySelectorAll('.sbox-tabbed'), (box) => {
            const active = box.querySelector(':scope > .sbox-tabs > .sbox-tab.is-active');
            return active ? active.getAttribute('data-sbox-tab') : null;
        }),
    };
};

window.restoreNestedViewState = function (container, state) {
    if (!container || !state) return;

    // Only ever re-opens: a details element the author closed stays closed.
    if (state.open && state.open.length) {
        container.querySelectorAll('details').forEach((d, i) => {
            if (state.open[i]) d.open = true;
        });
    }

    // Skipped when the tab it names is gone: a box that has lost a section
    // falls back to its first, which is what a fresh render does anyway.
    if (state.tabs && state.tabs.length) {
        container.querySelectorAll('.sbox-tabbed').forEach((box, i) => {
            const want = state.tabs[i];
            if (want === null || want === undefined || want === '0') return;
            const btn = box.querySelector(`:scope > .sbox-tabs > [data-sbox-tab="${CSS.escape(want)}"]`);
            const panel = box.querySelector(`:scope > [data-sbox-panel="${CSS.escape(want)}"]`);
            if (!btn || !panel) return;
            box.querySelectorAll(':scope > .sbox-tabs > .sbox-tab').forEach(b =>
                b.classList.toggle('is-active', b === btn));
            box.querySelectorAll(':scope > [data-sbox-panel]').forEach(p =>
                p.classList.toggle('is-active', p === panel));
        });
    }
};

// A document tab (Combos, Techs), in three parts: the introduction (Read First),
// the author's groups (Combo Cards and prose), and the list (one sortable table per
// group). Every difference between the two tabs is a string in character_tabs.js;
// this function knows neither by name.
window.renderDocumentTab = function (tabId, data) {
    const sections = window.getDocumentSections ? window.getDocumentSections(tabId) : null;
    if (!sections) return;

    const container = document.getElementById(`tab-${tabId}`);
    if (!container) return;

    const { intro, groups, list } = sections;

    const viewState = window.captureNestedViewState(container);

    container.innerHTML = '';
    container.classList.add('space-y-6');

    const introBlocks = intro ? data[intro.field] : null;
    const groupList = groups ? data[groups.field] : null;
    const tables = list ? data[list.field] : null;

    if ((!introBlocks || !introBlocks.length)
        && (!groupList || !groupList.length)
        && (!tables || !tables.length)) {
        container.innerHTML = `<div class="empty-tab-msg">${window.escapeHtml(sections.tab.emptyMessage || 'Nothing written for this character yet.')}</div>`;
        return;
    }

    // Each part is a heading, not a card: the Combo Cards under it are the sections.
    const addHeading = (text, extraClass) => {
        const h = document.createElement('h3');
        h.className = `section-title section-title-clean combo-section-title${extraClass ? ` ${extraClass}` : ''}`;
        h.textContent = text;
        container.appendChild(h);
        return h;
    };

    // Read First stays a card: it holds prose, like Overview.
    if (introBlocks && introBlocks.length) {
        const section = document.createElement('section');
        section.className = 'wiki-section wiki-section-clip combo-intro';
        section.innerHTML = `<div class="card-header-flex"><h3 class="card-header-title">${window.escapeHtml(intro.label)}</h3></div>`;
        const body = document.createElement('div');
        body.className = 'combos-content';
        // Every id carries the tab: a character can have Combos and Techs open in one
        // document, and populateTextSection finds its target by id.
        body.id = `${tabId}-intro-content`;
        section.appendChild(body);
        container.appendChild(section);
        populateTextSection(body.id, '', introBlocks, tabId);
        const injected = body.querySelector('section.wiki-section');
        if (injected) injected.classList.remove('wiki-section');
    }

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
            body.innerHTML = `<p class="empty-notes-msg">${window.escapeHtml(groups.emptyEntryMessage)}</p>`;
        }
    });

    if (list && tables && tables.length) {
        const host = document.createElement('div');
        host.className = 'combo-list-section space-y-6';
        host.innerHTML = `<h3 class="section-title section-title-clean combo-section-title combo-list-title">${window.escapeHtml(list.label)}</h3>`;

        const allRows = tables.reduce((acc, t) => acc.concat((t && t[list.rowsField]) || []), []);
        const shared = { ...list, __columns: window.comboVisibleColumns(allRows) };

        tables.forEach(table => host.appendChild(window.renderComboListTable(table || {}, shared)));
        container.appendChild(host);
    }

    window.restoreNestedViewState(container, viewState);

    if (typeof window.consolidateTabContributors === 'function') {
        window.consolidateTabContributors(container);
    }
};

/**
 * A document tab's rendererFn for its keyed sections. One per tab, because a
 * rendererFn is looked up by name off window and called with the data alone
 * (editor-previews.js and loadPageDescriptions).
 * @since v0.15
 */
window.renderCombosTab = function (data) {
    window.renderDocumentTab('combos', data);
};

window.renderTechsTab = function (data) {
    window.renderDocumentTab('techs', data);
};

/**
 * A character's Gallery tab, from desc_data.gallery (the charGalleryItem keyed
 * section in character_tabs.js, which gives it submit, merge, diff and apply).
 * @since v0.18
 * @watch its card is a deliberate copy of gallery.js's, which is the gallery page
 *   type and is not loaded on a character page
 */
window.renderCharacterGalleryTab = function (data) {
    const container = document.getElementById('tab-gallery');
    if (!container) return;

    const section = window.getKeyedSectionByTab
        ? window.getKeyedSectionByTab('gallery') : null;
    const items = (data && data.gallery) || [];

    container.innerHTML = '';
    container.classList.add('vessel-content');

    if (!items.length) {
        container.innerHTML = `
            <div class="empty-tab-msg">
                ${window.escapeHtml((section && section.emptyMessage)
                    || 'No media has been added for this character yet.')}
            </div>`;
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    grid.id = 'character-gallery-grid';

    // One fragment, one reflow.
    const fragment = document.createDocumentFragment();
    items.forEach(item => fragment.appendChild(buildCharacterGalleryCard(item || {})));
    grid.appendChild(fragment);
    container.appendChild(grid);

    if (typeof window.initLazyMedia === 'function') window.initLazyMedia(grid);
    if (typeof window.consolidateTabContributors === 'function') {
        window.consolidateTabContributors(container);
    }
};

// The extension from the path, so a query or a fragment cannot make a video look
// like an image. The same rule as skill_card.js and gallery.js.
function isCharacterGalleryVideo(src) {
    const path = String(src || '').split(/[?#]/)[0].toLowerCase();
    return ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].some(ext => path.endsWith(ext));
}

function buildCharacterGalleryCard(item) {
    const card = document.createElement('figure');
    card.className = 'gallery-card';

    const media = document.createElement('div');
    media.className = 'gallery-card-media';

    if (item.src) {
        if (isCharacterGalleryVideo(item.src)) {
            // The shared clip. An aria-label, because <video> has no alt.
            media.innerHTML = window.wikiClipHTML(item.src, {
                className: 'gallery-media', label: item.alt || item.name || '',
            });
        } else {
            const img = document.createElement('img');
            img.src = item.src;
            img.className = 'gallery-media';
            img.loading = 'lazy';
            img.alt = item.alt || item.name || '';
            media.appendChild(img);
        }
    } else {
        media.innerHTML = `<div class="gallery-media-missing">[ No media ]</div>`;
    }

    card.appendChild(media);

    const caption = document.createElement('figcaption');
    caption.className = 'gallery-card-caption';

    // textContent throughout: every field here is contributor-written.
    const title = document.createElement('span');
    title.className = 'gallery-card-name';
    title.textContent = item.name || 'Untitled';
    caption.appendChild(title);

    if (item.note) {
        const note = document.createElement('span');
        note.className = 'gallery-card-note';
        note.textContent = item.note;
        caption.appendChild(note);
    }

    card.appendChild(caption);
    return card;
}

// A Combo Card, or one section of a multi-section card: they carry the same fields.
function theoryboxCardHTML(bData, contextClass) {

            // Derived from the title when blank, so every card can be linked to. Anything that
            // is not a word character is dropped, or the selector that scrolls to it breaks.
            const anchor = window.stripStyleShortcodes(bData.anchor || bData.title || '')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

            const difficulty = String(bData.difficulty || '').trim();
            const diffIndex = (window.COMBO_DIFFICULTIES || []).indexOf(difficulty);
            const diffHTML = difficulty
                ? `<span class="theorybox-difficulty combo-difficulty${diffIndex === -1 ? '' : ` combo-difficulty-${diffIndex}`}">${window.escapeHtml(difficulty)}</span>`
                : '';

            // Free text, so it is labelled: a bare "High" beside a difficulty
            // chip would read as a second difficulty.
            const practicality = String(bData.practicality || '').trim();
            const practicalityHTML = practicality
                ? `<span class="theorybox-practicality">Practicality: ${window.escapeHtml(practicality)}</span>`
                : '';

            // The same chips as everywhere else. A card with only a notation style still gets
            // the row, or the style has nowhere to switch.
            const steps = Array.isArray(bData.sequence) ? bData.sequence : [];
            const routeHTML = (steps.length || window.comboNotationStyles(bData).length > 1)
                ? window.comboRouteHTML(bData, {
                    className: 'theorybox-route',
                    trailing: bData.damage ? `<span class="combo-damage">${window.escapeHtml(bData.damage)}</span>` : '',
                })
                : '';

            const videoUrl = safeBlockUrl(bData.video || '');
            const videoHTML = videoUrl
                ? window.wikiVideoButtonHTML(videoUrl, 'Watch')
                : '';

            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            // The name is a heading, so the anchor sweep and the contents pick it up. "Combo"
            // stands in for no name and is marked to be left out, as collectSectionTargets
            // leaves it out of the data.
            const untitled = !window.stripStyleShortcodes(bData.title).trim();

            return `
                <section class="theorybox"${anchor ? ` id="combo-${window.escapeHtml(anchor)}"` : ''}>
                    <div class="theorybox-head">
                        <h4 class="theorybox-title${untitled ? ' is-untitled' : ''}">${window.escapeHtml(bData.title || 'Combo')}</h4>
                        ${diffHTML}
                        ${practicalityHTML}
                        ${videoHTML}
                    </div>
                    ${bData.oneliner ? `<p class="theorybox-oneliner">${window.escapeHtml(bData.oneliner)}</p>` : ''}
                    ${routeHTML}
                    ${innerHTML ? `<div class="theorybox-body">${innerHTML}</div>` : ''}
                </section>
            `;
}

// The tab row and panels, shared by the Section Box and a multi-section Combo Card:
// the click listener and the repaint restore both key off `.sbox-tabbed`.
function sboxTabRowHTML(labels) {
    return '<div class="sbox-tabs">' + labels.map((label, i) =>
        `<button type="button" class="sbox-tab${i === 0 ? ' is-active' : ''}"`
        + ` data-sbox-tab="${i}">${window.escapeHtml(label)}</button>`
    ).join('') + '</div>';
}

function sboxPanelHTML(i, inner) {
    return `<div class="sbox-panel${i === 0 ? ' is-active' : ''}" data-sbox-panel="${i}">${inner}</div>`;
}

// `extra` is CSS this file built from whitelisted values, never contributor
// text as typed.
function getAlignStyle(align, extra = '') {
    let styleStr = 'overflow-wrap: break-word; word-break: break-word;';
    // Allowlisted, not escaped - this is a CSS value, where escaping quotes
    // still leaves `left; background: url(...)` intact.
    const dir = safeBlockAlign(align);
    if (dir) styleStr += ` text-align: ${dir};`;
    if (extra) styleStr += ` ${extra}`;
    return `style="${styleStr}"`;
}

// One Contributors footer per tab. Each section and nested accordion makes its own;
// this collects their authors, removes them, and adds one list at the end, sorted,
// because a nested accordion's footer comes before its section's. Each tab's
// renderer calls it once it is done. Blog posts keep their own footer.
window.consolidateTabContributors = function(root) {
    if (!root) return;

    const footers = root.querySelectorAll('.aggregated-contributors-footer');
    if (footers.length === 0) return;

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
    // textContent per badge: a name is never markup.
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

/**
 * Draws a list of Blocks into the element with that id, under an optional title,
 * then binds callout tooltips, lazy media and colour swatches in it.
 * @since v0.01
 * @watch the editor repaints this on every keystroke; captureNestedViewState keeps
 *   the reader's open accordions and tabs
 */
function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const viewState = window.captureNestedViewState(container);

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
            section.innerHTML = `<h3 class="strategy-title">${window.escapeHtml(sectionTitle)}</h3>`;
        }

        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = window.generateHTMLForBlocks(blocks, contextClass);
        section.appendChild(bodyDiv);
        container.appendChild(section);

        window.restoreNestedViewState(container, viewState);

        const callouts = section.querySelectorAll('.inline-callout-btn');
        callouts.forEach(btn => {
            const decodedTooltip = decodeURIComponent(btn.getAttribute('data-tooltip'));
            window.bindTooltip(btn, decodedTooltip);
        });

        if (typeof window.initLazyMedia === 'function') {
            window.initLazyMedia(container);
        }

        if (typeof window.fillColorSwatches === 'function') window.fillColorSwatches(container);

    } else {
        container.innerHTML = `
            <div class="wiki-section-empty">
                "${window.escapeHtml(sectionTitle)}" analysis has not been written yet.
            </div>
        `;
    }
}

// A tab that is not mode-scoped (Gallery) is drawn once per page load, and a mode
// switch leaves it alone. Keyed by page, so another character draws it again. The
// editor's preview calls its renderer directly, so it still redraws on every
// keystroke.
let unscopedDrawnFor = null;
const unscopedDrawn = new Set();

function modeScopedTabIsDrawable(section, pageId) {
    const tab = (window.CHARACTER_TABS || []).find(t => t.id === section.tab);
    if (!tab || tab.modeScoped !== false) return true;

    if (unscopedDrawnFor !== pageId) {
        unscopedDrawnFor = pageId;
        unscopedDrawn.clear();
    }
    // The first render of the page draws it whatever the mode is - a shared
    // ?mode= link must still show the gallery.
    if (!unscopedDrawn.has(section.tab)) {
        unscopedDrawn.add(section.tab);
        return true;
    }
    return false;
}

// "Label | text": the label underlined, the text on hover or on a tap (focus). Only
// the first "|" splits; a line empty on one side of it shows as written.
function triviaItemHTML(line) {
    const at = line.indexOf('|');
    const label = at < 0 ? '' : line.slice(0, at).trim();
    const tip = at < 0 ? '' : line.slice(at + 1).trim();
    if (!label || !tip) return `<li>${window.escapeHtmlKeepBreaks(line)}</li>`;
    return `<li><span class="profile-trivia-term" tabindex="0">${window.escapeHtmlKeepBreaks(label)}`
        + `<span class="profile-trivia-tip" role="tooltip">${window.escapeHtmlKeepBreaks(tip)}</span></span></li>`;
}

/**
 * Quote, Trivia and Character Navigation in the profile card under a character's
 * stats. The reader page and the editor's preview both draw it here, so the two
 * cannot drift.
 * @since v1.1
 * @touches desc_data.profile, fillProfilePager
 * @watch a Trivia line splits at its first "|": "Label | text"
 */
window.profileDescriptionHTML = function (profile) {
    const p = profile || {};
    const quote = String(p.quote || '').trim();
    const speaker = String(p.quoteSpeaker || '').trim();
    const trivia = (Array.isArray(p.trivia) ? p.trivia : [])
        .map(t => String(t == null ? '' : t).trim()).filter(Boolean);

    let body = '';
    if (quote) {
        body += `<figure class="profile-quote"><blockquote><p>${window.escapeHtmlKeepBreaks(quote)}</p></blockquote>`
            + `${speaker ? `<figcaption><p>${window.escapeHtmlKeepBreaks(speaker)}</p></figcaption>` : ''}</figure>`;
    }
    if (trivia.length) {
        body += `<div class="profile-trivia-title">Trivia</div>`
            + `<ul class="wiki-block-list profile-trivia">${trivia.map(t => triviaItemHTML(t)).join('')}</ul>`;
    }
    // With nothing written, this is only Character Navigation, and stays
    // hidden until fillProfilePager has something to put in it.
    return `<div class="profile-desc"${body ? '' : ' hidden'}>${body}`
        + `<nav class="profile-pager" aria-label="Character navigation" data-profile-pager hidden></nav></div>`;
};

// The Characters page's order, without the characters it does not show, base-only
// characters last. A hidden character's own page gets no Previous or Next.
function profilePagerOrder(characters) {
    const shown = (Array.isArray(characters) ? characters : [])
        .filter(c => c && c.published !== false && !c.isHidden);
    return shown.filter(c => !c.isBaseOnly).concat(shown.filter(c => c.isBaseOnly));
}

/**
 * Fills Character Navigation (Previous and Next) in a profile card.
 * @since v1.1
 * @touches data/navigation.json, window.CHARACTER_COLORS, rosterIconPath
 * @watch fails quietly (the console only): the rest of the profile has drawn
 */
window.fillProfilePager = async function (root, pageId) {
    const box = root && root.querySelector('.profile-desc');
    const nav = box && box.querySelector('[data-profile-pager]');
    if (!nav || typeof window.fetchJson !== 'function') return;

    const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
    let navData;
    try {
        navData = await window.fetchJson(`${rootPath}data/navigation.json`, { cache: true });
    } catch (e) {
        // Deliberately quiet on the page: Previous and Next are a convenience,
        // and the rest of the profile has already rendered without them.
        console.warn('[Profile] Could not load the character list for Previous and Next:', e);
        return;
    }

    const order = profilePagerOrder(navData && navData.Characters);
    const at = order.findIndex(c => String((c.cms_config || {}).pageId || '').toLowerCase() === String(pageId || '').toLowerCase());
    if (at < 0) return;

    // Two tiles, each the character's icon framed in their colour, with their name. A
    // dark colour gets the [outline] tag's white outline, since the card behind it is
    // dark. No tile for a side with nobody.
    const tile = (c, dir, label) => {
        if (!c) return '';
        const color = (window.CHARACTER_COLORS || {})[c.name];
        const dark = color && typeof window.isDarkCharacterColor === 'function' && window.isDarkCharacterColor(color);
        const iconPath = typeof window.rosterIconPath === 'function' ? window.rosterIconPath((c.cms_config || {}).pageId) : null;
        const icon = iconPath ? `<img class="profile-pager-icon" src="${window.escapeHtml(rootPath + iconPath)}" alt="">` : '';
        const name = `<span class="profile-pager-name${dark ? ' sc-outline' : ''}">${window.escapeHtml(c.name)}</span>`;
        return `<a class="profile-pager-link profile-pager-${dir}" href="${window.escapeHtml(rootPath + c.url)}"${color ? ` style="--pager-color: ${window.escapeHtml(color)};"` : ''}>`
            + `<span class="profile-pager-dir">${label}</span>`
            + `<span class="profile-pager-who">${icon}${name}</span></a>`;
    };
    const prev = order[at - 1];
    const next = order[at + 1];
    if (!prev && !next) return;

    nav.innerHTML = `<div class="profile-pager-title">Character Navigation</div>`
        + `<div class="profile-pager-tiles">${tile(prev, 'prev', '&#8249; Previous')}${tile(next, 'next', 'Next &#8250;')}</div>`;
    // A character with no icon yet keeps just the name. Listeners, not inline handlers;
    // a cached broken image has failed before they attach.
    nav.querySelectorAll('img.profile-pager-icon').forEach(img => {
        if (img.complete && img.naturalWidth === 0) { img.remove(); return; }
        img.addEventListener('error', () => img.remove(), { once: true });
    });
    nav.hidden = false;
    box.hidden = false;
};

/**
 * Draws a page's content: a system page's tabs and sections, or a character page's
 * tabs for the active mode.
 * @since v0.4
 * @touches window.currentEditorDescData (the editor's data, already narrowed to a
 *   mode), fetchCloudCharacterData, applyOptionalTabsFromPageRow, resolveModeDesc;
 *   sets window.moveStrategiesDrawn and window.profilePagerFilled
 * @watch an error is only logged (the catch at the end), and the page stays empty
 */
async function loadPageDescriptions(pageId, pageType = 'character', modeId = null) {
    try {
        let data = null;

        // Set when the data came from the editor, which has narrowed it to the state being
        // edited (editor-modes.js). Narrowing it again would find nothing.
        let dataIsPreScoped = false;

        if (window.currentEditorDescData) {
            data = window.currentEditorDescData;
            dataIsPreScoped = true;
        }
        else {
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);

                // Outside the desc_data guard: a page with no content still has a tab strip, and
                // the Overseer's preview loads two pages in one session.
                if (typeof window.applyOptionalTabsFromPageRow === 'function') {
                    window.applyOptionalTabsFromPageRow(cloudData);
                }

                if (cloudData && cloudData.desc_data) {
                    data = cloudData.desc_data;
                    console.log(`[Cloud] Loaded ${pageId} descriptions.`);
                }
            }
        }

        if (!data) {
            if (pageType === 'system') {
                console.log(`[System] Initializing blank schema for new system page.`);
                data = { tabs: [] }; 
            } else {
                throw new Error("No descriptive data found.");
            }
        }

        // A system page: tabs of sections, each a list of Blocks.
        if (pageType === 'system') {
            const mainArea = document.querySelector('.main-content-area');
            if (!mainArea) return;

            // No tabs: one Overview tab, holding any old overview and strategy Blocks.
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

            // The stub's own #tab-overview and any strip from an earlier draw go first.
            const oldTarget = document.getElementById('tab-overview');
            if (oldTarget) oldTarget.remove();
            const oldNav = document.getElementById('system-dynamic-nav');
            if (oldNav) oldNav.remove();

            const isEditor = !!document.getElementById('interactive-builder');
            let navHTML = `<nav id="system-dynamic-nav" class="character-nav" style="display: ${isEditor ? 'none' : 'flex'}; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue); align-items: center;">`;
            
            const tabIdsForPageBuilder = [];

            data.tabs.forEach((tab, idx) => {
                const isActive = idx === 0 ? 'active' : '';
                navHTML += `<button id="nav-${window.escapeHtml(tab.tabId)}" class="btn-manga btn-manga-slanted ${isActive}"><div class="btn-manga-content"><span class="btn-manga-text">${window.escapeHtml(tab.tabLabel)}</span></div></button>`;
                tabIdsForPageBuilder.push(tab.tabId);
            });
            navHTML += `</nav>`;

            const header = mainArea.querySelector('.home-main-header');
            if (header) {
                header.insertAdjacentHTML('afterend', navHTML);
            } else {
                mainArea.insertAdjacentHTML('afterbegin', navHTML);
            }

            data.tabs.forEach((tab, idx) => {
                let tabContainer = document.getElementById(`tab-${tab.tabId}`);
                if (!tabContainer) {
                    tabContainer = document.createElement('div');
                    tabContainer.id = `tab-${tab.tabId}`;
                    tabContainer.className = 'tab-content wiki-tab-content';
                    if (idx !== 0) tabContainer.classList.add('hidden'); 
                    mainArea.appendChild(tabContainer);
                }
                
                tabContainer.innerHTML = '';

                if (tab.sections && tab.sections.length > 0) {
                    tab.sections.forEach((section, sIdx) => {
                        
                        let sWidth = section.width;
                        let sAlign = section.alignment;
                        let sBreak = section.forceBreak;

                        // Older sections stored a layout name instead of a width, alignment and break.
                        if (sWidth === undefined) {
                            if (section.layout === 'centered') { sWidth = 80; sAlign = 'center'; sBreak = true; }
                            else if (section.layout === 'split-left') { sWidth = 48; sAlign = 'left'; sBreak = false; }
                            else if (section.layout === 'split-right') { sWidth = 48; sAlign = 'right'; sBreak = false; }
                            else { sWidth = 100; sAlign = 'left'; sBreak = true; }
                            
                            section.width = sWidth; section.alignment = sAlign; section.forceBreak = sBreak;
                        }

                        if (sBreak && sIdx !== 0) {
                            const flexBreak = document.createElement('div');
                            flexBreak.className = 'flex-row-break';
                            tabContainer.appendChild(flexBreak);
                        }

                        const sectionNode = document.createElement('section');
                        sectionNode.className = 'wiki-section system-content-grid-section';

                        sectionNode.style.flex = `0 0 ${sWidth}%`;
                        sectionNode.style.maxWidth = `${sWidth}%`;

                        if (sAlign === 'center') {
                            sectionNode.style.marginLeft = 'auto';
                            sectionNode.style.marginRight = 'auto';
                        } else if (sAlign === 'right') {
                            sectionNode.style.marginLeft = 'auto';
                        } else if (sAlign === 'left') {
                            sectionNode.style.marginRight = 'auto';
                        }
                        
                        if (section.sectionTitle) {
                            sectionNode.innerHTML = `<h2 class="section-title mb-4">${window.escapeHtml(section.sectionTitle)}</h2>`;
                        }
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.id = `system-${tab.tabId}-sec-${sIdx}`;
                        sectionNode.appendChild(contentDiv);
                        tabContainer.appendChild(sectionNode);
                        
                        populateTextSection(contentDiv.id, '', section.blocks, 'system-content');
                    });
                    
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

            if (typeof window.setupTabs === 'function') {
                // The address only on the reader's page: the editor renders
                // this strip too, hidden, and its address is its own.
                window.setupTabs('nav', 'tab', tabIdsForPageBuilder, 'major', { address: !isEditor });
            }

            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

            window.renderMathIfAny(document.body);

            if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
            return;
        }
        else {
            // Narrowed to the active mode first: an ultimate mode carries its own overview,
            // matchups and counterplay. The base mode gets the data back unchanged.
            const activeMode = dataIsPreScoped ? null : (modeId || window.activeCharacterMode || null);
            if (typeof window.resolveModeDesc === 'function') {
                data = window.resolveModeDesc(data, activeMode);
            }

            // Overview tab.
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
                                    <span class="profile-stat-label">${window.escapeHtmlKeepBreaks(stat.label)}</span>
                                    <span class="profile-stat-val">${window.escapeHtmlKeepBreaks(stat.value)}</span>
                                </div>`;
                        });
                    }

                    // imageFocus is allowlisted, not escaped: it lands in a style attribute.
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
                            ${window.profileDescriptionHTML(data.profile)}
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
                // Kept for the Overseer's side-by-side, which waits for the
                // Previous / Next tiles before it compares two drawings.
                window.profilePagerFilled = window.fillProfilePager(overviewContainer, pageId);

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

            // Matchups tab.
            const matchupsContainer = document.getElementById('tab-matchups');
            if (matchupsContainer) {
                matchupsContainer.innerHTML = '';
                matchupsContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.matchups && data.matchups.length > 0) {
                    data.matchups.forEach(mu => {

                        // resolveMatchupTier (site_data.js) also maps the two renamed tier words, so older
                        // data still renders.
                        const tier = window.resolveMatchupTier(mu.tier);

                        const muSection = document.createElement('section');
                        muSection.className = 'wiki-section wiki-section-clip';

                        // The colour comes from the tier table, never from the stored string.
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

            // Tabs that draw themselves (a rendererFn in the keyed sections), once per renderer.
            const selfRendered = new Set();
            // Filtered by the tab list: a tab switched off keeps its sections, so a queued
            // delta still applies, but is not drawn (getCharacterTabIds, character_tabs.js).
            const drawableTabs = window.getCharacterTabIds
                ? window.getCharacterTabIds({ includeInjected: true })
                : null;
            (window.getKeyedSections ? window.getKeyedSections() : [])
                .filter(s => s.rendererFn && typeof window[s.rendererFn] === 'function')
                .filter(s => !drawableTabs || drawableTabs.includes(s.tab))
                // A modeScoped: false tab (Gallery) belongs to the character. A mode's desc_data
                // does not hold it, so drawing it again on a mode switch would blank it.
                .filter(s => modeScopedTabIsDrawable(s, pageId))
                .forEach(s => {
                    if (selfRendered.has(s.rendererFn)) return;
                    selfRendered.add(s.rendererFn);
                    window[s.rendererFn](data);
                });

            // Keyed tabs (Counterplay, Starter Guide): one renderer for every array of keyed
            // entries. Matchups is drawn above, because its card carries a tier colour.
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
                            ${window.escapeHtml(section.emptyMessage || 'Not written yet.')}
                        </div>
                    `;
                        return;
                    }

                    entries.forEach(entry => {
                        const entrySection = document.createElement('section');
                        entrySection.className = 'wiki-section wiki-section-clip';

                        // The meta colour comes from the section's fixed metaColors, so a contributor's
                        // value selects a colour and never supplies one.
                        const title = window.escapeHtml(entry[section.keyField] || 'Unknown');
                        let metaHTML = '';
                        if (section.metaField) {
                            const value = entry[section.metaField];
                            const colour = (section.metaColors || {})[value] || '#9ca3af';
                            metaHTML = `<span class="card-tier-label" style="color: ${colour};">${window.escapeHtml(value || '')}</span>`;
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
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">${window.escapeHtml(section.emptyEntryMessage || 'Nothing recorded yet.')}</p>`;
                        }
                    });

                    window.consolidateTabContributors(container);
                });

            // Move strategies (M1s, Skills, Specials).
            if (data.moveStrategies) {
                // A promise for the Overseer's side-by-side (admin-preview.js), which waits for
                // this drawing before it moves it aside.
                window.moveStrategiesDrawn = new Promise(resolve => setTimeout(() => {
                    try {
                        for (const [moveId, blocks] of Object.entries(data.moveStrategies)) {
                            populateTextSection(`strategy-${moveId}`, 'Move Overview and Strategy', blocks, 'move-strategy');
                        }
                        // After the same 300ms as the sections: skill_card.js builds the move cards on its
                        // own schedule.
                        window.FRAME_MOVE_CATEGORIES.forEach(tab => {
                            window.consolidateTabContributors(document.getElementById(`tab-${tab}`));
                        });
                        if (typeof applyInternalStyling === 'function') applyInternalStyling();
                        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
                    } finally {
                        resolve();
                    }
                }, 300));
            }
        }

        window.renderMathIfAny(document.body);
        
        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

// The clip queue. An autoplaying clip joins it one screen ahead of the reader, two
// start at a time, the one nearest the screen goes next, and a loop plays only
// while it is on screen. A clip frees its slot once it can play through. Other
// media keeps the simple rule: its source swapped in 300px ahead.
const CLIP_SLOTS = 2;
const CLIP_AHEAD_MARGIN = '100% 0px';
// A clip that neither plays through, stops fetching nor fails in this long frees
// its slot, so one stalled download cannot hold up every clip below it.
const CLIP_SLOT_TIMEOUT_MS = 8000;

const clipWaiting = new Set();
const clipLoading = new Map();    // clip -> the timeout that frees its slot
const clipOnScreen = new WeakSet();
let clipAheadObserver = null;
let clipScreenObserver = null;
let lazyMediaObserver = null;

// 0 on screen, otherwise how many pixels away. A clip with no box (its tab is
// hidden) is never picked.
function clipDistance(video) {
    const r = video.getBoundingClientRect();
    if (!r.width && !r.height) return Infinity;
    const h = window.innerHeight || document.documentElement.clientHeight;
    if (r.bottom < 0) return -r.bottom;
    if (r.top > h) return r.top - h;
    return 0;
}

function playClip(video) {
    // Refused on a phone in Low Power Mode, or cut short by the reader
    // scrolling past. Either way the corner button still opens the player.
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
}

function freeClipSlot(video) {
    if (!clipLoading.has(video)) return;
    clearTimeout(clipLoading.get(video));
    clipLoading.delete(video);
    pumpClipQueue();
}

function startClip(video) {
    const src = video.getAttribute('data-lazy-src');
    if (!src) return;
    clipAheadObserver.unobserve(video);

    const free = () => freeClipSlot(video);
    ['canplaythrough', 'suspend', 'error', 'abort'].forEach(type =>
        video.addEventListener(type, free, { once: true }));
    clipLoading.set(video, setTimeout(free, CLIP_SLOT_TIMEOUT_MS));

    // From here the queue decides when the clip plays, not the attribute:
    // autoplay would start a loop a screen down that nobody is watching.
    // preload="auto" because without autoplay, "none" fetches nothing until
    // play() is called on screen, which is the wait this exists to remove.
    video.autoplay = false;
    video.preload = 'auto';
    video.src = src;
    video.removeAttribute('data-lazy-src');
    if (clipOnScreen.has(video)) playClip(video);
}

function pumpClipQueue() {
    // A clip taken off the page stops counting: the editor repaints its
    // preview on every keystroke, and a gallery search rebuilds the grid.
    clipLoading.forEach((timer, video) => {
        if (!video.isConnected) { clearTimeout(timer); clipLoading.delete(video); }
    });
    clipWaiting.forEach(video => { if (!video.isConnected) clipWaiting.delete(video); });

    while (clipLoading.size < CLIP_SLOTS) {
        let next = null;
        let nearest = Infinity;
        clipWaiting.forEach(video => {
            const d = clipDistance(video);
            if (d < nearest) { nearest = d; next = video; }
        });
        if (!next) return;
        clipWaiting.delete(next);
        startClip(next);
    }
}

// The queue holds clips within a screen and not started. A clip the reader
// scrolled far past leaves it, rather than downloading later for nobody.
function onClipAhead(entries) {
    entries.forEach(({ target: video, isIntersecting }) => {
        if (!video.hasAttribute('data-lazy-src')) return;
        if (isIntersecting) clipWaiting.add(video);
        else clipWaiting.delete(video);
    });
    pumpClipQueue();
}

function onClipScreen(entries) {
    entries.forEach(({ target: video, isIntersecting }) => {
        const started = !video.hasAttribute('data-lazy-src');
        if (isIntersecting) {
            clipOnScreen.add(video);
            if (started) playClip(video);
        } else {
            clipOnScreen.delete(video);
            if (started && !video.paused) video.pause();
        }
    });
}

// Video stills (data/video-stills.json, from scripts/fetch-video-stills.js). A
// video gets its shape as soon as the list is here, and its first frame once it is
// within three screens. The list can arrive after the page has drawn.
const STILL_AHEAD_MARGIN = '300% 0px';
const STILL_PATH_RE = /^medias\/stills\/[0-9a-f]{16}\.webp$/;
let videoStills = null;
let videoStillsAsked = false;
let stillObserver = null;

// The video's file in the wiki-media bucket, decoded, as the job keys it.
function wikiMediaFileOf(src) {
    const value = String(src || '');
    const at = value.indexOf(WIKI_MEDIA_BUCKET_PATH);
    if (at === -1) return null;
    try { return decodeURIComponent(value.slice(at + WIKI_MEDIA_BUCKET_PATH.length).split(/[?#]/)[0]); } catch (e) { return null; }
}

function stillFor(video) {
    if (!videoStills) return null;
    const file = wikiMediaFileOf(video.getAttribute('data-lazy-src') || video.getAttribute('src'));
    const entry = file && Object.prototype.hasOwnProperty.call(videoStills, file) ? videoStills[file] : null;
    // The list is the job's own output, but its values still only ever name
    // a still of ours and a size.
    if (!entry || !STILL_PATH_RE.test(entry.still)) return null;
    if (!(Number.isInteger(entry.w) && entry.w > 0 && Number.isInteger(entry.h) && entry.h > 0)) return null;
    return entry;
}

function showStill(video) {
    const entry = stillFor(video);
    if (entry) video.poster = window.getRootPath() + entry.still;
}

function applyStills(root) {
    if (!videoStills) return;
    root.querySelectorAll('video').forEach((video) => {
        const entry = stillFor(video);
        if (!entry) return;
        // A ratio, not width and height attributes, which set a pixel height when a video
        // Block sets only its width. "auto" lets the video's own ratio win once it has one.
        video.style.aspectRatio = `auto ${entry.w} / ${entry.h}`;
        if (stillObserver) stillObserver.observe(video);
        else showStill(video);
    });
}

// Only a page showing one of our videos asks for the list: the home page draws its
// posts through initLazyMedia too.
function hasWikiVideo(root) {
    return Array.from(root.querySelectorAll('video'))
        .some((video) => wikiMediaFileOf(video.getAttribute('data-lazy-src') || video.getAttribute('src')));
}

function askForVideoStills() {
    // Both from site_utils.js, which a cache-skewed load can be missing.
    if (videoStillsAsked || typeof window.fetchJson !== 'function' || typeof window.getRootPath !== 'function') return;
    videoStillsAsked = true;
    // Deliberately quiet past the console: without the list, a video draws without
    // its still.
    window.fetchJson(`${window.getRootPath()}data/video-stills.json`, { cache: true })
        .then((list) => {
            videoStills = list && typeof list === 'object' ? list : {};
            applyStills(document);
        })
        .catch((err) => console.warn('[Media] No video stills this time:', err.message));
}

/**
 * Starts the media under rootElement: clips join the clip queue, other videos and
 * iframes get their source 300px ahead, and videos get their stills.
 * @since v0.4
 * @watch called on every render, and the editor renders on every keystroke. The
 *   observers are built once, and observing an element twice is a no-op.
 */
window.initLazyMedia = function(rootElement = document) {
    const lazyMedia = rootElement.querySelectorAll('video[data-lazy-src], iframe[data-lazy-src]');

    if (!stillObserver && 'IntersectionObserver' in window) {
        stillObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(({ target, isIntersecting }) => {
                if (!isIntersecting) return;
                showStill(target);
                observer.unobserve(target);
            });
        }, { rootMargin: STILL_AHEAD_MARGIN });
    }
    if (hasWikiVideo(rootElement)) askForVideoStills();
    applyStills(rootElement);

    if (!('IntersectionObserver' in window)) {
        // No IntersectionObserver: everything at once.
        lazyMedia.forEach(media => {
            media.src = media.getAttribute('data-lazy-src');
            media.removeAttribute('data-lazy-src');
        });
        return;
    }

    if (!lazyMediaObserver) {
        lazyMediaObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const media = entry.target;
                media.src = media.getAttribute('data-lazy-src');
                media.removeAttribute('data-lazy-src');
                observer.unobserve(media);
            });
        }, { rootMargin: '300px 0px' });
        clipAheadObserver = new IntersectionObserver(onClipAhead, { rootMargin: CLIP_AHEAD_MARGIN });
        clipScreenObserver = new IntersectionObserver(onClipScreen);
    }

    lazyMedia.forEach(media => {
        // An autoplaying video is a clip, and clips queue.
        if (media.tagName === 'VIDEO' && media.hasAttribute('autoplay')) {
            clipAheadObserver.observe(media);
            clipScreenObserver.observe(media);
        } else {
            lazyMediaObserver.observe(media);
        }
    });
};

// Media that fails to load becomes the "[ Missing Media ]" box, so a reader can
// tell missing from slow. One capture-phase listener catches every renderer's
// media: error does not bubble, but it does pass through capture. Opt-in by class,
// because portraits, roster icons and tier-list art have their own fallbacks.
const MISSING_MEDIA_TARGETS = [
    'img.wiki-block-image', 'img.wiki-media', 'img.wiki-cell-media',
    'video.wiki-video-native',
    'img.skill-media-img', 'video.skill-media-img',
    'img.gallery-media', 'video.gallery-media',
    'img.discussion-media-img', 'img.discussion-media-gif', 'video.discussion-media-gif',
].join(', ');

function showMissingMedia(el) {
    if (!el || !el.isConnected || !el.matches(MISSING_MEDIA_TARGETS)) return;
    // A media element with no source has not failed, it has not started.
    const src = el.currentSrc || el.getAttribute('src') || '';
    if (!src) return;

    const notice = document.createElement('div');
    notice.className = 'media-missing-notice';
    notice.textContent = '[ Missing Media ]';
    notice.setAttribute('role', 'img');
    notice.setAttribute('aria-label', 'Missing media');
    // The file's name on hover, so whoever fixes the page knows which one.
    // A property, never markup: the address came from page content.
    try { notice.title = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || ''); } catch (e) { notice.title = ''; }

    // An image block's own alignment and width carry over, so the box sits
    // where the image would have.
    el.classList.forEach(c => { if (/^wiki-media(-|$)/.test(c)) notice.classList.add(c); });
    if (el.style && el.style.width) notice.style.width = el.style.width;

    // A thread image sits inside a link to itself; a link to a missing file
    // goes nowhere, so the notice replaces the link. A clip takes its corner
    // button with it, for the same reason: a player for nothing.
    const link = el.parentElement && el.parentElement.matches('a.discussion-media-link') ? el.parentElement : null;
    const clip = el.closest('.wiki-clip');
    (clip || link || el).replaceWith(notice);
}

document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || !t.tagName) return;
    // A <source> child fails on itself; its video is what the reader sees.
    showMissingMedia(t.tagName === 'SOURCE' ? t.parentElement : t);
}, true);

// The player's controls: listeners on the document, because players are drawn into
// innerHTML by many callers, drawn again on every editor keystroke, and created
// inside a modal.

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

// Built on first use and reused: most readers never open one.
function wikiVideoModal() {
    let modal = document.getElementById('wiki-video-modal');
    if (modal) return modal;

    // The site's dialog, in the player's own look: it is a player, not a box.
    modal = document.createElement('dialog');
    modal.id = 'wiki-video-modal';
    modal.className = 'site-dialog video-dialog';
    modal.setAttribute('aria-label', 'Video');
    modal.innerHTML = `
        <button type="button" class="wiki-video-modal-close" data-dialog-close
                aria-label="Close">&#10007;</button>
        <div class="wiki-video-modal-body"></div>
    `;
    document.body.appendChild(modal);

    // Emptied rather than just closed, however it closes: a paused video left in
    // the DOM keeps its buffer, and reopening on a different clip would flash the
    // old frame.
    modal.addEventListener('close', () => {
        modal.querySelector('.wiki-video-modal-body').innerHTML = '';
    });
    return modal;
}

window.openWikiVideoModal = function (url) {
    const src = safeBlockUrl(url);
    if (!src) return null;

    const modal = wikiVideoModal();
    const body = modal.querySelector('.wiki-video-modal-body');
    body.innerHTML = window.wikiVideoPlayerHTML(src, 'wiki-player-modal');
    window.openDialog(modal, { light: true });

    const video = body.querySelector('video');
    if (video) {
        ensurePlayerSource(video);
        video.play().catch(() => { /* the play button is right there */ });
    }
    return modal;
};

window.loadPageDescriptions = loadPageDescriptions;
window.populateTextSection = populateTextSection;

// Section Box tabs: one listener, bound once, because the editor's preview replaces
// the buttons on every keystroke.
if (!window.__sboxTabsBound) {
    window.__sboxTabsBound = true;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sbox-tab]');
        if (!btn) return;
        const box = btn.closest('.sbox-tabbed');
        if (!box) return;

        const idx = btn.getAttribute('data-sbox-tab');
        // Scoped to THIS box: nested boxes are possible, since a tab's contents
        // are blocks and a Section Box is a block.
        box.querySelectorAll(':scope > .sbox-tabs > [data-sbox-tab]').forEach(b =>
            b.classList.toggle('is-active', b === btn));
        box.querySelectorAll(':scope > [data-sbox-panel]').forEach(p =>
            p.classList.toggle('is-active', p.getAttribute('data-sbox-panel') === idx));
    });
}