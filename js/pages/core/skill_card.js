/**
 * The Skill Card: each move's box on a character page, with its stats, media,
 * accolades and Frame Track (the timeline of its phases, under Micro Variant tabs).
 * @since v0.01
 * @touches page_data.frame_data, window.cachedMasterFrameData, FRAME_COLORS,
 *   WINDOW_COLORS and ACCOLADES (site_lookups.js), wikiClipHTML (page_render.js)
 * @watch the editor's Frame Data tab uses this file's scales and phase maths
 *   (FRAME_ESTIMATES, phaseWeight), so a phase measures the same in both
 * @see docs/character-page.md
 */

const frameDataLegendHTML = `
    <section class="wiki-section legend-section">
        <h3 class="legend-title">Frame Data Color Legend</h3>
        <div class="legend-grid">
            <div class="legend-item"><span class="legend-swatch bg-tick-start"></span><div><span class="legend-name">Startup</span></div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-misc"></span><div><span class="legend-name">Misc</span>Variable frame data aka no hard number so it always comes with a note</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-active"></span><div><span class="legend-name">Active</span>Hitbox view ...</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-recov"></span><div><span class="legend-name">Recovery</span>aka Whiff endlag</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-selfstun"></span><div><span class="legend-name">Self Stun</span>for Grab moves mostly</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-inskillstun"></span><div><span class="legend-name">InSkill Stun</span>A weird version of Self Stun, but you can move around</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-targetstun"></span><div><span class="legend-name">Target Stun</span>on Hit</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-blockendlag"></span><div><span class="legend-name">Block Endlag</span>aka Block Stun</div></div>
            <div class="legend-item"><span class="legend-swatch bg-tick-inactive"></span><div><span class="legend-name">Inactive</span>Frames between Active frames</div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-complete"></span><div><span class="legend-name">Complete I-Frames</span>aka Domain I-Frames</div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-swarm"></span><div><span class="legend-name">Swarm I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-explosion"></span><div><span class="legend-name">Explosion I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-bullet"></span><div><span class="legend-name">Bullet I-Frames</span></div></div>
            <div class="legend-item"><span class="legend-swatch span-iframe-melee"></span><div><span class="legend-name">Melee I-Frames</span></div></div>
        </div>

        <!-- The one thing on this page that is a convention rather than a
             colour. It has to be stated once, or a reader has no way to learn
             that a smooth block means "nobody counted this". -->
        <p class="legend-estimate-note">
            <span class="legend-swatch legend-swatch-estimate bg-tick-recov"></span>
            A bar divided into single frames was <strong>counted</strong>. A smooth block with no
            divisions was not: it is either an <strong>estimate</strong> or a length
            <strong>timed in seconds</strong>. Hover over it to see which.
        </p>
    </section>
`;

// The overlays a phase can carry. A retired one that an old revision names draws nothing.
const windowTypes = {
    'iframe-melee': { class: 'span-iframe-melee', label: 'Melee I-Frames' },
    'iframe-bullet': { class: 'span-iframe-bullet', label: 'Bullet I-Frames' },
    'iframe-explosion': { class: 'span-iframe-explosion', label: 'Explosion I-Frames' },
    'iframe-swarm': { class: 'span-iframe-swarm', label: 'Swarm I-Frames' },
    'iframe-complete': { class: 'span-iframe-complete', label: 'Complete I-Frames' }
};

// The accolades and their icons are in site_lookups.js, since any page's text can show the icons.

/**
 * Accolade groups of which no two can be true of one move. The editor unticks the
 * rest of a group when one is ticked (editor-framedata.js).
 * @since v1.2
 */
window.ACCOLADE_OPPOSITES = [
    ['punishable-on-block', 'safe-on-block'],
    ['punishable-on-whiff', 'safe-on-whiff'],
    ['punishable-on-hit', 'safe-on-hit'],
    ['hit-only-air-ragdoll', 'hit-ragdoll', 'cannot-hit-ragdoll'],
    ['uncancelable', 'semi-uncancelable'],
];

/**
 * A move's accolades as window.ACCOLADES entries, in that list's order. An id that
 * is not one of them is left out, never shown bare.
 * @since v1.2
 */
window.orderedAccolades = function (ids) {
    const picked = new Set(Array.isArray(ids) ? ids : []);
    return window.ACCOLADES.filter(a => picked.has(a.id));
};

// The badges under a move's name, or nothing, so a move with none takes no
// room. Their hover is bound once the card is in the page.
function accoladesHTML(ids) {
    const list = window.orderedAccolades(ids);
    if (!list.length) return '';
    const badges = list.map(a => `<li class="skill-accolade" data-accolade="${window.escapeHtml(a.id)}" style="--accolade-color: ${window.escapeHtml(a.color)}">${window.accoladeIconHTML(a)}${window.escapeHtml(a.name)}</li>`);
    return `<ul class="skill-accolades">${badges.join('')}</ul>`;
}

/**
 * The estimate scale, for a phase someone can describe without counting frames:
 * seven steps, from nothing to unrecoverable. `frames` is a nominal weight for
 * layout only, never shown as a number.
 * @since v0.12
 * @watch an estimated phase draws with no tick divisions: the ticks mean
 *   "counted", so their absence says "estimated"
 */
window.FRAME_ESTIMATES = [
    { id: 'none', label: 'Non-existent', frames: 0 },
    { id: 'very-short', label: 'Very short', frames: 3 },
    { id: 'short', label: 'Short', frames: 8 },
    { id: 'mid', label: 'Mid', frames: 16 },
    { id: 'high', label: 'High', frames: 28 },
    { id: 'very-high', label: 'Very high', frames: 45 },
    { id: 'rip', label: 'RIP', frames: 70 },
];

/**
 * The FRAME_ESTIMATES entry with that id, or null.
 * @since v0.12
 */
window.frameEstimate = function(id) {
    if (!id) return null;
    return (window.FRAME_ESTIMATES || []).find(e => e.id === id) || null;
};

/**
 * JJS runs at 60fps server-side, so a timed phase converts to frames exactly.
 * @since v0.19
 */
window.FRAMES_PER_SECOND = 60;

/**
 * A phase's typed seconds, or null.
 * @since v0.19
 */
window.phaseSeconds = function(phaseObj) {
    const raw = Number(phaseObj && phaseObj.seconds);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
};

/**
 * The frames a phase takes on the timeline: its seconds, else its estimate, else
 * its counted frames. Seconds come first, as the more specific claim.
 * @since v0.12
 */
window.phaseWeight = function(phaseObj) {
    const seconds = window.phaseSeconds(phaseObj);
    if (seconds !== null) return seconds * window.FRAMES_PER_SECOND;

    const estimate = window.frameEstimate(phaseObj && phaseObj.estimate);
    if (estimate) return estimate.frames;
    return Number(phaseObj && phaseObj.duration) || 0;
};

/**
 * "2s", "1.5s": trailing zeroes dropped, since "2.0s" reads as a measurement.
 * @since v0.19
 */
window.formatPhaseSeconds = function(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return '';
    return `${Number(n.toFixed(2))}s`;
};

function createPhase(phaseObj, totalScale) {
    const phase = document.createElement('div');
    phase.style.position = 'relative';
    let styleClass = phaseObj.styleClass || '';

    const estimate = window.frameEstimate(phaseObj.estimate);
    // Seconds win over an estimate for width, so they win here too, or the block would
    // say "estimated" at a timed width.
    const seconds = window.phaseSeconds(phaseObj);
    const solid = seconds !== null || !!estimate;

    phase.className = `phase-section ${styleClass}`
        + (solid ? ' phase-solid' : '')
        + (seconds !== null ? ' phase-seconds' : (estimate ? ' phase-estimated' : ''));
    phase.style.width = `${(window.phaseWeight(phaseObj) / totalScale) * 100}%`;

    let activeOverlays = [];
    if (phaseObj.overlays) activeOverlays.push(...phaseObj.overlays);
    if (phaseObj.overlay) activeOverlays.push(phaseObj.overlay);

    const hierarchy = ['iframe-melee', 'iframe-bullet', 'iframe-explosion', 'iframe-swarm', 'iframe-complete'];
    activeOverlays.sort((a, b) => hierarchy.indexOf(a) - hierarchy.indexOf(b));

    activeOverlays.forEach(overlayKey => {
        const winDef = windowTypes[overlayKey];
        if (winDef) {
            const overlayEl = document.createElement('div');
            overlayEl.className = `window-overlay ${winDef.class}`;
            phase.appendChild(overlayEl);
        }
    });

    if (phaseObj.label || estimate || seconds !== null) {
        // The tooltip is written as HTML (window.bindTooltip), and the label is
        // contributor text.
        let tooltipContent = `<strong>${window.escapeHtmlKeepBreaks(phaseObj.label || (estimate ? estimate.label : ''))}</strong>`;

        // Said in words too: the hover is where someone asks for the detail, and here the
        // detail is the unit. The frame figure too, since the timeline is drawn in frames.
        if (seconds !== null) {
            tooltipContent += `<br><span class="tooltip-desc tooltip-desc-seconds">`
                + `Timed: ${window.formatPhaseSeconds(seconds)}`
                + ` - ${seconds * window.FRAMES_PER_SECOND} frames at ${window.FRAMES_PER_SECOND}fps</span>`;
        }

        // The one detail an estimate must not hide is that it is an estimate.
        if (estimate && seconds === null) {
            tooltipContent += `<br><span class="tooltip-desc tooltip-desc-estimate">Estimated: ${estimate.label.toLowerCase()} - not frame-counted</span>`;
        }
        
        if (activeOverlays.length > 0) {
            let uniqueOverlays = Array.from(new Set(activeOverlays));
            uniqueOverlays.forEach(o => {
                if (windowTypes[o]) {
                    tooltipContent += `<br><span class="tooltip-desc text-purple-400">Has ${windowTypes[o].label}</span>`;
                }
            });
        }
        window.bindTooltip(phase, tooltipContent);
    }

    // No ticks for an estimate or a timed phase: that absence is the marker.
    if (!solid) {
        for (let i = 0; i < phaseObj.duration; i++) {
            const tick = document.createElement('div');
            tick.className = 'frame-tick';
            phase.appendChild(tick);
        }
    }

    return phase;
}

/**
 * Frame data by page id, filled by the first fetch. The editor, the review screens
 * and History put the data being edited or shown here, so the Skill Cards draw that.
 * @since v0.3
 */
window.cachedMasterFrameData = window.cachedMasterFrameData || {}; 

// A Skill Card's media box: the move's media, or the media of the Micro Variant on
// show, or the Missing Media notice.
function skillMediaHTML(media) {
    let mediaContent = `<div class="skill-media-missing">[ Missing Media ]</div>`;
    if (media?.src) {
        // The extension from the path, not the whole address: storage links carry a query
        // ("clip.mp4?t=123").
        const path = media.src.split(/[?#]/)[0].toLowerCase();
        const isVideo = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].some(ext => path.endsWith(ext));
        // .gif stays an image on purpose - it animates on its own.
        const filename = path.split('/').pop();
        const altText = media.alt || '';

        if (isVideo) {
            // The shared clip (wikiClipHTML). An aria-label, because <video> has no alt.
            mediaContent = window.wikiClipHTML(media.src, {
                className: 'skill-media-img', label: altText,
            }) + `
                <span class="skill-media-filename">${window.escapeHtml(filename)}</span>`;
        } else {
            // A real src with loading="lazy": initLazyMedia starts only videos and iframes.
            mediaContent = `
                <img src="${window.escapeHtml(media.src)}" alt="${window.escapeHtml(altText)}" class="skill-media-img" loading="lazy">
                <span class="skill-media-filename">${window.escapeHtml(filename)}</span>`;
        }
    }
    return mediaContent;
}

/**
 * Draws one move tab (M1s, Skills, Specials and the rest) of a character page: the
 * legend and a Skill Card per move, for the active mode.
 * @since v0.01
 * @touches window.cachedMasterFrameData, fetchCloudCharacterData, resolveModeFrame;
 *   leaves a strategy-<moveId> box for page_render.js to fill
 * @watch with targetMoveId only that move is drawn (the editor's preview); an error
 *   is only logged
 */
async function loadMoveSection(pageId, sectionType, targetMoveId = null, pageType = 'character', modeId = null) {
    if (pageType === 'system') return;

    try {
        let data = null;
        
        if (window.cachedMasterFrameData && window.cachedMasterFrameData[pageId]) {
            data = window.cachedMasterFrameData[pageId];
        } 
        else {
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);
                if (cloudData && cloudData.frame_data) {
                    data = cloudData.frame_data;
                    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
                    window.cachedMasterFrameData[pageId] = data; 
                    console.log(`[Cloud] Loaded ${pageId} frame data.`);
                }
            }
        }

        if (!data) throw new Error("No frame data found.");

        const container = document.getElementById(`tab-${sectionType}`);
        if (!container) return;

        // A full character's ultimate mode replaces the whole moveset. The base mode gets the
        // data back unchanged.
        const activeMode = modeId || window.activeCharacterMode || null;
        const scopedData = typeof window.resolveModeFrame === 'function'
            ? window.resolveModeFrame(data, activeMode)
            : data;

        let movesArray = scopedData[sectionType] || [];

        if (targetMoveId) {
            movesArray = movesArray.filter(move => move.id === targetMoveId);
        }

        container.innerHTML = '';

        // Said, so an empty tab (often an ultimate mode not written yet) does not look like a
        // failed load. No early return: the lazy-media and contents passes below still run.
        if (movesArray.length === 0 && !targetMoveId) {
            container.innerHTML = `<div class="empty-tab-msg">Nothing has been recorded here yet.</div>`;
        }

        // A move an editor marked "No frame data" (a passive, a dash variant)
        // has nothing the legend explains, whatever old tracks it still stores.
        const hasFrameData = movesArray.some(move => move.variants && move.noFrameData !== true);
        if (hasFrameData) {
            container.innerHTML = frameDataLegendHTML;
        }

        movesArray.forEach(move => {
            const card = document.createElement('section');
            card.className = 'skill-entry-card';
            // No frame data: the description takes the Frame Track's space, and nothing says
            // frame data is missing. Stored tracks are kept, so unticking brings them back.
            const noFrameData = move.noFrameData === true;
            if (noFrameData) card.classList.add('skill-entry-card-no-frames');

            let statsHTML = '';
            if (move.stats && move.stats.length > 0) {
                move.stats.forEach(stat => {
                    const highlightStyle = stat.isHighlighted ? 'color: #ef4444;' : '';
                    // Contributor text, written into innerHTML: escaped, with
                    // the <br> editors use for a second line kept.
                    statsHTML += `
                        <div class="stat-row">
                            <span class="stat-label">${window.escapeHtmlKeepBreaks(stat.label)}</span>
                            <span class="stat-value" style="${highlightStyle}">${window.escapeHtmlKeepBreaks(stat.value)}</span>
                        </div>`;
                });
            } else {
                statsHTML = `<div class="stat-row stat-row-empty">No stats recorded</div>`;
            }

            const mediaContent = skillMediaHTML(move.media);

            card.innerHTML = `
                <div class="skill-entry-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 class="skill-title">${window.escapeHtml(move.name || 'Unknown Move')}</h2>
                        <span class="skill-subtitle">Input: ${window.escapeHtml(move.input || 'N/A')} | Skill Type: ${window.escapeHtml(move.type || 'N/A')} | Damage Type: ${window.escapeHtml(move.damageType || 'N/A')} | ${window.escapeHtml(move.variant || '')}</span>
                        ${accoladesHTML(move.accolades)}
                    </div>

                    <!-- move.id is contributor-submitted and used to be built
                         straight into an inline onclick, where a quote closed
                         the handler and ran whatever followed, on every
                         character page. Wired below from a data attribute
                         instead, per the project's own rule. -->
                    <button class="btn-sys btn-sys-regular skill-edit-move-btn"
                            data-move-id="${window.escapeHtml(move.id || '')}"
                            style="display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem;">
                        ${window.uiIconHTML('edit')}
                        Edit Move
                    </button>
                </div>
                <div class="skill-entry-body">
                    <div class="skill-left-col">
                        <div class="skill-media-wrapper ${!move.media?.src ? 'skill-media-wrapper-empty' : ''}">
                            ${mediaContent}
                        </div>
                        <div class="skill-stats-box">${statsHTML}</div>
                    </div>
                    <div class="skill-right-col" id="right-col-${window.escapeHtml(move.id || '')}"></div>
                </div>
            `;

            container.appendChild(card);

            // Hovering (or tapping) a badge shows its name and what it means.
            card.querySelectorAll('.skill-accolade').forEach(badge => {
                const accolade = window.ACCOLADES.find(a => a.id === badge.dataset.accolade);
                if (accolade) window.bindTooltip(badge, `<strong>${window.escapeHtml(accolade.name)}</strong><br><span class="tooltip-desc">${window.escapeHtml(accolade.description)}</span>`);
            });

            // Shape the box to the media rather than cropping the media to the
            // box. Runs after append so the element is measurable, and hooks
            // load/loadedmetadata because a lazy video reports nothing until
            // the card scrolls into view.
            if (typeof window.applyMediaFraming === 'function') {
                window.applyMediaFraming(
                    card.querySelector('.skill-media-img'),
                    card.querySelector('.skill-media-wrapper'),
                    move.media
                );
            }

            const editBtn = card.querySelector('.skill-edit-move-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const params = new URLSearchParams({
                        page: pageId, type: pageType, tab: sectionType, move: editBtn.dataset.moveId || '',
                    });
                    window.location.href = `../../edit.html?${params}`;
                });
            }

            const rightCol = document.getElementById(`right-col-${move.id}`);

            // Each timeline (a leaf of the tree, however deep) can carry its own media, and the
            // box on the left follows the one on show.
            const leafViews = new Map();
            const mediaWrapper = card.querySelector('.skill-media-wrapper');
            let shownSrc = move.media?.src || '';
            function syncMediaToVariant() {
                let leaf = null;
                for (const [view, node] of leafViews) {
                    // On show: neither it nor a tab above it is hidden.
                    if (!view.closest('.view-section.hidden')) { leaf = node; break; }
                }
                const own = leaf && leaf.media && leaf.media.src ? leaf.media : null;
                // The move's "Media box shape" is one setting for the whole card.
                const media = own ? { ...own, framing: move.media?.framing } : move.media;
                const src = media?.src || '';
                // Same file as before: left alone, so a video is not restarted.
                if (src === shownSrc) return;
                shownSrc = src;

                mediaWrapper.innerHTML = skillMediaHTML(media);
                mediaWrapper.classList.toggle('skill-media-wrapper-empty', !src);
                mediaWrapper.classList.remove('is-square', 'is-tall');
                if (typeof window.applyMediaFraming === 'function') {
                    window.applyMediaFraming(mediaWrapper.querySelector('.skill-media-img'), mediaWrapper, media);
                }
                if (typeof window.initLazyMedia === 'function') window.initLazyMedia(mediaWrapper);
            }

            // The Frame Track: rows of Micro Variant tabs, down to the timelines.
            function buildNestedTabs(dataNode, prefixId, wrapperElement) {

                // A leaf: the timelines.
                if (dataNode.bars) {
                    leafViews.set(wrapperElement, dataNode);
                    let autoLegendItems = [];
                    let seenPhases = new Set();

                    // It scrolls sideways rather than squeezing the frames.
                    const scrollWrapper = document.createElement('div');
                    scrollWrapper.className = 'frame-scroll-wrapper';
                    scrollWrapper.style.overflowX = 'auto';
                    scrollWrapper.style.paddingBottom = '0.5rem';

                    // Enforce a minimum of 5px per frame so borders never swallow the tick
                    const safeMinWidth = `${dataNode.totalScale * 5}px`;

                    dataNode.bars.forEach(bar => {
                        // headerClass is one of the editor's colour classes
                        // (text-red-400 and so on), but it is stored data and
                        // lands inside a class attribute.
                        const headerClass = String(bar.headerClass || '').replace(/[^\w -]/g, '');
                        const barGroup = document.createElement('div');
                        if (bar.type === 'target') barGroup.className = 'bar-group-target';

                        const headerText = bar.headerInfo || bar.title || dataNode.headerInfo || '';
                        if (headerText.trim() !== '') {
                            const infoHeader = document.createElement('div');
                            infoHeader.className = 'bar-header-info';
                            if (bar.type === 'target') infoHeader.classList.add('bar-header-target');
                            infoHeader.innerHTML = `<span class="${headerClass}">${window.escapeHtmlKeepBreaks(headerText)}</span>`;
                            barGroup.appendChild(infoHeader);
                        }
                        
                        const timelineContainer = document.createElement('div');
                        timelineContainer.className = 'frame-bar-container';
                        timelineContainer.style.position = 'relative'; 
                        timelineContainer.style.minWidth = safeMinWidth;

                        bar.phases.forEach(phase => {
                            const phaseEl = createPhase(phase, dataNode.totalScale);
                            timelineContainer.appendChild(phaseEl);

                            // The legend, collected from the phases shown.
                            if (phase.styleClass && phase.styleClass !== 'bg-transparent' && !phase.hideFromLegend) {
                                
                                let legendText = phase.legendDesc ? phase.legendDesc : phase.label;
                                
                                // Deduplicated by the text shown, not the hidden label.
                                const uniqueKey = phase.styleClass + '-' + legendText;
                                
                                if (!seenPhases.has(uniqueKey)) {
                                    seenPhases.add(uniqueKey);
                                    
                                    const safeColors = window.FRAME_COLORS || {};
                                    autoLegendItems.push({
                                        color: safeColors[phase.styleClass] || '#ffffff',
                                        text: legendText
                                    });
                                }
                            }

                            let activeWindows = [];
                            if (phase.overlays) activeWindows.push(...phase.overlays);
                            if (phase.overlay) activeWindows.push(phase.overlay);

                            activeWindows.forEach(winKey => {
                                const winDef = windowTypes[winKey];
                                if (winDef) {
                                    const uniqueKey = 'window-' + winKey;
                                    if (!seenPhases.has(uniqueKey)) {
                                        seenPhases.add(uniqueKey);
                                        const safeWindowColors = window.WINDOW_COLORS || {};
                                        autoLegendItems.push({
                                            color: safeWindowColors[winKey] || '#ffffff',
                                            text: winDef.label,
                                            isWindow: true,
                                            cssClass: winDef.class
                                        });
                                    }
                                }
                            });
                        });
                        
                        barGroup.appendChild(timelineContainer);

                        if (bar.footerInfo && bar.footerInfo.trim() !== '') {
                            const infoFooter = document.createElement('div');
                            infoFooter.className = 'bar-header-info';
                            infoFooter.style.marginTop = '0.25rem';
                            infoFooter.style.marginBottom = '0.5rem';
                            infoFooter.innerHTML = `<span class="${headerClass}">${window.escapeHtmlKeepBreaks(bar.footerInfo)}</span>`;
                            barGroup.appendChild(infoFooter);
                        }
                        
                        scrollWrapper.appendChild(barGroup);
                    });

                    const rulerContainer = document.createElement('div');
                    rulerContainer.className = 'frame-ruler';

                    // The ruler takes the bars' minimum width, so it scales with them.
                    rulerContainer.style.minWidth = safeMinWidth;
                    
                    const tickInterval = dataNode.totalScale > 100 ? 20 : 10;
                    
                    for (let i = 0; i <= dataNode.totalScale; i += tickInterval) {
                        const tickMark = document.createElement('div');
                        tickMark.className = 'ruler-tick';
                        tickMark.style.left = `${(i / dataNode.totalScale) * 100}%`;
                        tickMark.innerHTML = `<div class="ruler-notch"></div><span class="ruler-label">${i}</span>`;
                        rulerContainer.appendChild(tickMark);
                    }
                    
                    scrollWrapper.appendChild(rulerContainer);

                    wrapperElement.appendChild(scrollWrapper);

                    // An inlineLegend written in the editor wins over the collected one.
                    const legendData = (dataNode.inlineLegend && dataNode.inlineLegend.length > 0) 
                        ? dataNode.inlineLegend 
                        : autoLegendItems;

                    if (legendData.length > 0) {

                        const legendGrid = document.createElement('div');

                        legendGrid.style.cssText = "display: flex; flex-direction: column; gap: 0.35rem; padding: 0 1.5rem 1.5rem 1.5rem; font-family: var(--text-mono); font-size: 0.65rem; color: var(--text-primary); line-height: 1.4;";

                        legendData.forEach(item => {
                            const legendItem = document.createElement('div');

                            legendItem.style.cssText = "display: flex; align-items: flex-start; gap: 0.4rem;";

                            // An inlineLegend is stored data, colour and text
                            // both, so the colour is whitelisted (it lands in a
                            // style attribute) and the text escaped.
                            const color = (typeof window.safeColor === 'function' && window.safeColor(item.color)) || '#ffffff';
                            const text = window.escapeHtmlKeepBreaks(item.text);

                            if (item.isWindow) {
                                legendItem.innerHTML = `<span style="width: 0.6rem; height: 0.6rem; background: transparent; border: 2px solid ${color}; box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.4); flex-shrink: 0; margin-top: 0.15rem;"></span><span>${text}</span>`;
                            } else {
                                legendItem.innerHTML = `<span style="width: 0.6rem; height: 0.6rem; background: ${color}; border: 1px solid #000; flex-shrink: 0; margin-top: 0.15rem;"></span><span>${text}</span>`;
                            }
                            legendGrid.appendChild(legendItem);
                        });
                        wrapperElement.appendChild(legendGrid);
                    }
                    return;
                }

                // A branch: a row of Micro Variant tabs.
                if (dataNode.variants) {
                    const keys = Object.keys(dataNode.variants);
                    if (keys.length === 0) return;

                    const tabBar = document.createElement('div');
                    tabBar.className = 'skill-tab-bar';
                    
                    if (prefixId !== move.id) {
                        tabBar.classList.add('skill-tab-bar-nested');
                    }

                    const viewsWrapper = document.createElement('div');
                    viewsWrapper.className = 'views-wrapper';

                    keys.forEach((key, index) => {
                        const childNode = dataNode.variants[key];
                        const childId = `${prefixId}-${key}`;

                        const btn = document.createElement('button');
                        btn.id = `tab-${childId}`;
                        btn.className = `btn-manga btn-manga-slanted btn-manga-gray ${index === 0 ? 'active' : ''}`;
                        btn.innerHTML = `<div class="btn-manga-content"><span class="btn-manga-text">${window.escapeHtmlKeepBreaks(childNode.label || key)}</span></div>`;
                        tabBar.appendChild(btn);

                        const viewSection = document.createElement('div');
                        viewSection.id = `view-${childId}`;
                        viewSection.className = `view-section ${index === 0 ? '' : 'hidden'}`;

                        // Every timeline is built up front; a tab only shows and hides them.
                        btn.addEventListener('click', () => {
                            Array.from(tabBar.children).forEach(b => b.classList.remove('active'));
                            Array.from(viewsWrapper.children).forEach(v => v.classList.add('hidden'));
                            btn.classList.add('active');
                            viewSection.classList.remove('hidden');
                            syncMediaToVariant();
                        });

                        buildNestedTabs(childNode, childId, viewSection);
                        viewsWrapper.appendChild(viewSection);
                    });

                    wrapperElement.appendChild(tabBar);
                    wrapperElement.appendChild(viewsWrapper);
                }
            }

            if (noFrameData) {
                // Left empty here: the description is put in below.
            } else if (move.variants && Object.keys(move.variants).length > 0) {
                buildNestedTabs({ variants: move.variants }, move.id, rightCol);
                syncMediaToVariant();
            } else {
                rightCol.innerHTML = `
                    <div class="empty-tab-msg empty-frame-data-msg">
                        Frame data has not been mapped for this move yet.
                    </div>
                `;
            }
            
            // page_render.js puts the move's strategy here.
            const strategyTarget = document.createElement('div');
            strategyTarget.id = `strategy-${move.id}`;
            (noFrameData ? rightCol : card).appendChild(strategyTarget);
        });



    } catch (error) {
        console.error(`Failed handling live frame engine synchronization updates for ${sectionType}:`, error);
    }

    if (typeof window.initLazyMedia === 'function') {
        const container = document.getElementById(`tab-${sectionType}`);
        if (container) window.initLazyMedia(container);
    }

    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
}

window.createPhase = createPhase;
window.loadMoveSection = loadMoveSection;