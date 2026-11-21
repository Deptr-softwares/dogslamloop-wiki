/**
 * Dogslamloop Wiki - Editor: DAW Frame-Data Editor (variant-tree timeline
 * builder for move frame data - startup/active/recovery phases, tracks,
 * overlays)
 *
 * initDawEditor is kept as one closure rather than split further -
 * getCurrentDawNode/renderDaw/bindDawEvents and the whole window.setDawPath/
 * addDawVariant/deleteDawVariant/addDawTrack/deleteDawTrack/addDawPhase/
 * selectDawPhase/deleteDawPhase/initDawLeaf/initDawBranch family all close
 * over this function's own local variables (moveData, activePath,
 * selectedBarIdx/PhaseIdx) - splitting them apart would mean actually
 * refactoring into parameterized functions, not just moving code, matching
 * the precedent already set for admin-preview.js's switchVersionView.
 */

// --- DAW FRAME EDITOR ENGINE ---

// Edits here change the move in place and never pass through the Block buffer's
// live preview, which is what writes the draft. So every change is saved here
// instead, on the same short timer as a Block edit, so typing does not write
// on every key. A field edit arrives as input/change on the container; every
// other change ends in renderDaw().
let frameDraftTimer = null;
function saveFrameDraftSoon() {
    clearTimeout(frameDraftTimer);
    frameDraftTimer = setTimeout(() => {
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    }, 400);
}
const draftSavingContainers = new WeakSet();

const DAW_TRACK_COLOR_CLASSES = ['text-red-400', 'text-red-600', 'text-blue-400', 'text-green-400', 'text-green-500', 'text-purple-400', 'text-orange-400', 'text-cyan-400', 'text-gray-400'];

// The estimate whose nominal weight sits closest to a frame count, used when a
// contributor switches a phase from counted to estimated. Nearest rather than
// first, so the bar keeps its shape across the switch.
function closestEstimate(frames) {
    const scale = window.FRAME_ESTIMATES || [];
    if (scale.length === 0) return 'mid';

    const target = Number(frames) || 0;
    return scale.reduce((best, entry) =>
        Math.abs(entry.frames - target) < Math.abs(best.frames - target) ? entry : best
    ).id;
}

// The move's accolades as chips, all of them in the owner's order
// (js/pages/core/framedata.js), icon and name, pressed when the move has one and then in
// its own color, as its badge is on the page. Their hover says what each means,
// as the badge does.
function accoladeChipsHTML(ids) {
    const has = new Set(Array.isArray(ids) ? ids : []);
    return (window.ACCOLADES || []).map(a => `<button type="button" class="accolade-chip" data-accolade="${window.escapeHtml(a.id)}" aria-pressed="${has.has(a.id)}" title="${window.escapeHtml(a.description)}" style="--accolade-color: ${window.escapeHtml(a.color)}">${window.accoladeIconHTML(a)}${window.escapeHtml(a.name)}</button>`).join('');
}

// Ticking one of a group that cannot all be true of one move unticks the rest
// of the group. Stored in the owner's order, and not at all once none is
// ticked, so a move ticked and unticked again is the same data as one never
// touched, and a submission shows no change.
function toggleAccolade(moveData, id) {
    const has = new Set(Array.isArray(moveData.accolades) ? moveData.accolades : []);
    if (has.has(id)) {
        has.delete(id);
    } else {
        (window.ACCOLADE_OPPOSITES || []).filter(group => group.includes(id)).forEach(group => group.forEach(other => has.delete(other)));
        has.add(id);
    }
    const ordered = window.orderedAccolades([...has]).map(a => a.id);
    if (ordered.length) moveData.accolades = ordered;
    else delete moveData.accolades;
}

function initDawEditor(containerId, moveData) {
    const container = document.getElementById(containerId);
    if (!moveData) {
        container.innerHTML = `<p class="daw-empty-notice">No frame data configured for this move yet.</p>`;
        return;
    }

    if (!draftSavingContainers.has(container)) {
        draftSavingContainers.add(container);
        container.addEventListener('input', saveFrameDraftSoon);
        container.addEventListener('change', saveFrameDraftSoon);
    }
    // The first draw only shows the move; each later one follows a change, or a
    // selection, which saves a draft identical to what is on screen.
    let drawnOnce = false;

    if (!moveData.media) moveData.media = { src: "", alt: "" };
    if (!moveData.stats) moveData.stats = [];
    if (!moveData.variants) moveData.variants = {};

    let activePath = [];
    let firstKey = Object.keys(moveData.variants)[0];
    if (firstKey) activePath = [firstKey];

    let selectedBarIdx = null;
    let selectedPhaseIdx = null;

    function getCurrentDawNode() {
        let node = moveData;
        activePath.forEach(k => { if(node.variants) node = node.variants[k]; });
        return node;
    }

    function renderDaw() {
        // Every stored string below is contributor text written into innerHTML,
        // so it is escaped where it is interpolated. A reviewer opening a ticket
        // here is the person a crafted value would run as.
        let metaHtml = `
            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">MOVE METADATA</span></div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="name" value="${window.escapeHtml(moveData.name || '')}" placeholder="Move Name"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="input" value="${window.escapeHtml(moveData.input || '')}" placeholder="Input (e.g. M1)"></div>
                    </div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="type" value="${window.escapeHtml(moveData.type || '')}" placeholder="Skill Type (e.g. Basic Attack)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="damageType" value="${window.escapeHtml(moveData.damageType || '')}" placeholder="Damage Type (e.g. Melee, Bullet)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="variant" value="${window.escapeHtml(moveData.variant || '')}" placeholder="Variant (e.g. Standard)"></div>
                    </div>
                    <div class="editor-row mt-2">
                        <div><input type="text" class="editor-input meta-inp" data-field="media.src" value="${window.escapeHtml(moveData.media.src || '')}" placeholder="Media Src (e.g. /medias/images/m1.png)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="media.alt" value="${window.escapeHtml(moveData.media.alt || '')}" placeholder="Media Alt Text"></div>
                    </div>
                    <!-- Auto measures the file and picks the box that fits it.
                         The override is for media whose subject sits off to one
                         side, where the measurement is right about the shape
                         and wrong about what matters in it. -->
                    <div class="editor-row mt-2">
                        <div>
                            <label class="editor-field-label" for="move-media-framing">Media box shape</label>
                            <select id="move-media-framing" class="editor-select" data-field="media.framing">
                                <option value="auto"${!moveData.media.framing || moveData.media.framing === 'auto' ? ' selected' : ''}>Auto — match the file</option>
                                <option value="wide"${moveData.media.framing === 'wide' ? ' selected' : ''}>Wide (16:9)</option>
                                <option value="square"${moveData.media.framing === 'square' ? ' selected' : ''}>Square (1:1)</option>
                                <option value="tall"${moveData.media.framing === 'tall' ? ' selected' : ''}>Tall (3:4)</option>
                            </select>
                        </div>
                    </div>
                    <!-- For a passive or anything else with nothing to measure
                         (owner, 2026-11-16). The tracks are kept, only not
                         drawn, so a tick by mistake costs nothing. -->
                    <div class="editor-row mt-2">
                        <div>
                            <label class="editor-checkbox-label"><input type="checkbox" id="move-no-frame-data" ${moveData.noFrameData === true ? 'checked' : ''}> No frame data</label>
                            <p class="daw-no-frames-hint">For a move with nothing to measure, like a passive. Its Skill Card shows the description where the Frame Track would be.</p>
                        </div>
                    </div>
                    <!-- The badges under the move's name on its Skill Card
                         (owner's Kanban card "Skill Card accolades", v1.2). -->
                    <div class="editor-row mt-2">
                        <div>
                            <span class="editor-field-label">Accolades</span>
                            <div class="accolade-picker" role="group" aria-label="Accolades">${accoladeChipsHTML(moveData.accolades)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        let statsHtml = '';
        moveData.stats.forEach((stat, idx) => {
            statsHtml += `
                <div class="editor-row editor-row-spaced-sm">
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="label" value="${window.escapeHtml(stat.label)}" placeholder="Stat Name"></div>
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="value" value="${window.escapeHtml(stat.value)}" placeholder="Stat Value"></div>
                    <div class="daw-stat-actions">
                        <label class="editor-checkbox-label"><input type="checkbox" class="stat-highlight" data-idx="${idx}" ${stat.isHighlighted ? 'checked' : ''}> Highlight</label>
                        <button class="btn-sys btn-sys-red btn-del-stat daw-stat-del-btn" data-idx="${idx}" title="Remove Stat">✖</button>
                    </div>
                </div>
            `;
        });
        let statsCard = `
            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header">
                        <span class="block-type-badge">MOVE STATS</span>
                        <button class="btn-sys btn-sys-regular daw-add-stat-btn" id="btn-add-movestat">+ ADD STAT</button>
                    </div>
                    <div id="move-stats-container">${statsHtml}</div>
                </div>
            </div>
        `;

        let variantTabsHtml = `<div class="daw-variant-wrapper">`;
        let walkNode = moveData;

        for (let depth = 0; depth <= activePath.length; depth++) {
            if (!walkNode.variants) break;

            let keys = Object.keys(walkNode.variants);
            let activeKey = activePath[depth];

            variantTabsHtml += `<div class="daw-variant-tabs" style="margin-left: ${depth * 1}rem; padding-left: ${depth > 0 ? '0.5rem' : '0'}; border-left: ${depth > 0 ? '2px solid #333' : 'none'}; border-bottom: ${depth === activePath.length ? '1px solid #222' : 'none'};">`;

            keys.forEach(k => {
                let v = walkNode.variants[k];
                let isActive = (k === activeKey);
                let pathStr = JSON.stringify(activePath.slice(0, depth).concat(k));
                variantTabsHtml += `<button class="daw-tab-btn ${isActive ? 'active' : ''}" data-daw-path="${window.escapeHtml(pathStr)}">${window.escapeHtml(v.label || k)}</button>`;
            });

            let parentPathStr = JSON.stringify(activePath.slice(0, depth));
            variantTabsHtml += `<button class="daw-tab-btn daw-tab-btn-add-variant" data-daw-add-variant="${window.escapeHtml(parentPathStr)}">+ ADD MICRO VARIANT</button></div>`;

            if (activeKey && walkNode.variants[activeKey]) {
                walkNode = walkNode.variants[activeKey];
            } else {
                break;
            }
        }
        variantTabsHtml += `</div>`;

        let dawHtml = '';
        let currentObj = getCurrentDawNode();
        let hasVariants = currentObj && currentObj.variants && Object.keys(currentObj.variants).length > 0;

        if (moveData.noFrameData === true) {
            // The Micro Variant tabs go with the timeline: there is nothing to
            // pick while the Frame Track is off.
            variantTabsHtml = '';
            dawHtml = `
                <div class="daw-container daw-branch-empty-notice daw-no-frames-notice">
                    <p class="daw-branch-hint">Frame data is turned off for this move. Nothing is deleted: untick "No frame data" to bring the Frame Track back.</p>
                </div>
            `;
        } else if (currentObj && currentObj.bars) {
            let totalScale = currentObj.totalScale || 100;
            let tracksHtml = '';

            currentObj.bars.forEach((bar, bIdx) => {
                let phasesHtml = '';
                if (!bar.phases) bar.phases = [];

                bar.phases.forEach((p, pIdx) => {
                    // An estimated phase has no frame count, so its width comes
                    // from the nominal weight of its label and its block reads
                    // "~Short" rather than a number it does not have.
                    const estimate = typeof window.frameEstimate === 'function' ? window.frameEstimate(p.estimate) : null;
                    // A timed phase reads in its own unit for the same reason
                    // an estimate does: showing "120f" for a typed 2 would
                    // present a conversion as the thing the author wrote.
                    const seconds = typeof window.phaseSeconds === 'function' ? window.phaseSeconds(p) : null;
                    const weight = typeof window.phaseWeight === 'function' ? window.phaseWeight(p) : (p.duration || 0);
                    let widthPct = (weight / totalScale) * 100;
                    let isSelected = (bIdx === selectedBarIdx && pIdx === selectedPhaseIdx);

                    let bgClassMap = {
                        "bg-tick-start": "#3b82f6", "bg-tick-active": "#ef4444",
                        "bg-tick-recov": "#d946ef", "bg-tick-blockendlag": "#ec4899",
                        "bg-tick-selfstun": "#22c55e", "bg-tick-targetstun": "#b91c1c",
                        "bg-tick-misc": "#10b981", "bg-transparent": "transparent"
                    };
                    let phaseColor = bgClassMap[p.styleClass] || "#555";

                    phasesHtml += `
                        <div class="daw-phase-block ${isSelected ? 'selected' : ''}${(estimate || seconds !== null) ? ' daw-phase-estimated' : ''}"
                                style="width: ${widthPct}%; background-color: ${phaseColor};"
                                onclick="window.selectDawPhase(${bIdx}, ${pIdx})">
                            <span class="daw-phase-block-duration">${
                                seconds !== null
                                    ? window.escapeHtml(window.formatPhaseSeconds(seconds))
                                    : (estimate ? '~' + window.escapeHtml(estimate.label) : window.escapeHtml(p.duration) + 'f')
                            }</span>
                        </div>
                    `;
                });

                tracksHtml += `
                    <div class="daw-track-wrapper">
                        <div class="daw-track-header-row">

                            <div class="daw-track-input-row">
                                <input type="text" class="editor-input daw-track-inp daw-track-inp-flex" data-bidx="${bIdx}" data-field="headerInfo" value="${window.escapeHtml(bar.headerInfo || '')}" placeholder="Header Title (Top)">
                                <button onclick="window.addDawPhase(${bIdx})" class="btn-sys btn-sys-green" title="Add Phase">+</button>
                                <button onclick="window.deleteDawTrack(${bIdx})" class="btn-sys btn-sys-red" title="Delete Track">✖</button>
                            </div>

                            <div class="daw-track-input-row">
                                <input type="text" class="editor-input daw-track-inp daw-track-inp-flex" data-bidx="${bIdx}" data-field="footerInfo" value="${window.escapeHtml(bar.footerInfo || '')}" placeholder="Footer Title (Bottom)">
                                <select class="editor-select daw-track-color daw-track-color-select ${window.escapeHtml(bar.headerClass || '')}" data-bidx="${bIdx}">
                                    <option value="" class="daw-option-default" ${!bar.headerClass ? 'selected' : ''}>Default</option>
                                    <option value="text-red-400" class="daw-option-red-400" ${bar.headerClass === 'text-red-400' ? 'selected' : ''}>Red (L)</option>
                                    <option value="text-red-600" class="daw-option-red-600" ${bar.headerClass === 'text-red-600' ? 'selected' : ''}>Red (D)</option>
                                    <option value="text-blue-400" class="daw-option-blue-400" ${bar.headerClass === 'text-blue-400' ? 'selected' : ''}>Blue</option>
                                    <option value="text-green-400" class="daw-option-green-400" ${bar.headerClass === 'text-green-400' ? 'selected' : ''}>Green (L)</option>
                                    <option value="text-green-500" class="daw-option-green-500" ${bar.headerClass === 'text-green-500' ? 'selected' : ''}>Green (D)</option>
                                    <option value="text-purple-400" class="daw-option-purple-400" ${bar.headerClass === 'text-purple-400' ? 'selected' : ''}>Purple</option>
                                    <option value="text-orange-400" class="daw-option-orange-400" ${bar.headerClass === 'text-orange-400' ? 'selected' : ''}>Orange</option>
                                    <option value="text-cyan-400" class="daw-option-cyan-400" ${bar.headerClass === 'text-cyan-400' ? 'selected' : ''}>Cyan</option>
                                    <option value="text-gray-400" class="daw-option-gray-400" ${bar.headerClass === 'text-gray-400' ? 'selected' : ''}>Gray</option>
                                </select>
                            </div>

                        </div>
                        <div class="daw-track" style="min-width: ${totalScale * 5}px;">${phasesHtml}</div>
                    </div>
                `;
            });

            let inspectorHtml = '';
            if (selectedBarIdx !== null && selectedPhaseIdx !== null && currentObj.bars[selectedBarIdx]?.phases[selectedPhaseIdx]) {
                let p = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];
                let pOverlays = p.overlays || [];

                const overlayOptions = [
                    { id: 'iframe-complete', label: 'Complete I-Frames' },
                    { id: 'iframe-melee', label: 'Melee I-Frames' },
                    { id: 'iframe-bullet', label: 'Bullet I-Frames' },
                    { id: 'iframe-explosion', label: 'Explosion I-Frames' },
                    { id: 'iframe-swarm', label: 'Swarm I-Frames' }
                ];

                let overlaysHtml = overlayOptions.map(opt => `
                    <label class="daw-overlay-label">
                        <input type="checkbox" class="insp-overlay-cb" value="${opt.id}" ${pOverlays.includes(opt.id) ? 'checked' : ''}>
                        ${opt.label}
                    </label>
                `).join('');

                inspectorHtml = `
                    <div class="daw-inspector daw-inspector-spaced">
                        <div class="daw-inspector-header">
                            <span class="block-type-badge">PHASE INSPECTOR</span>
                            <button onclick="window.deleteDawPhase()" class="btn-sys btn-sys-red">✖ DELETE PHASE</button>
                        </div>
                        <div class="editor-row">
                            <div>
                                <!-- Not everyone counts frames. A player who
                                     knows how an endlag feels can record that
                                     instead, and the bar renders it as a solid
                                     block with no divisions so a reader can
                                     always tell the two apart. -->
                                <label class="editor-field-label-sm">How this was recorded</label>
                                <select class="editor-select" id="insp-measure-mode">
                                    <option value="counted" ${(!p.estimate && !window.phaseSeconds(p)) ? 'selected' : ''}>Counted - exact frames</option>
                                    <option value="estimated" ${(p.estimate && !window.phaseSeconds(p)) ? 'selected' : ''}>Estimated - how it feels</option>
                                    <option value="timed" ${window.phaseSeconds(p) ? 'selected' : ''}>Timed - in seconds</option>
                                </select>
                            </div>
                            <div>
                                <!-- Only the control for the mode in use is
                                     rendered. Rendering both and hiding one
                                     does not work here: initializeMangaSelects
                                     replaces a .editor-select with a sibling
                                     wrapper, so a hidden class on the select
                                     itself left its custom dropdown on screen -
                                     which is why an estimate picker appeared
                                     next to a frame count. -->
                                <label class="editor-field-label-sm">${
                                    window.phaseSeconds(p) ? 'Duration (Seconds)' : (p.estimate ? 'Estimate' : 'Duration (Frames)')
                                }</label>
                                ${window.phaseSeconds(p) ? `
                                <!-- step 0.05 rather than 0.01: at 60fps a
                                     frame is 0.0167s, so finer steps offer a
                                     precision the unit cannot carry. -->
                                <input type="number" min="0" step="0.05" class="editor-input" id="insp-seconds" value="${window.phaseSeconds(p)}">`
                                : (p.estimate ? `
                                <select class="editor-select" id="insp-estimate">
                                    ${(window.FRAME_ESTIMATES || []).map(e =>
                                        `<option value="${e.id}" ${p.estimate === e.id ? 'selected' : ''}>${window.escapeHtml(e.label)}</option>`
                                    ).join('')}
                                </select>` : `
                                <input type="number" class="editor-input" id="insp-duration" value="${window.escapeHtml(p.duration || 0)}">`)}
                            </div>
                        </div>
                        <div class="editor-row">
                            <div>
                                <label class="editor-field-label-sm">Frame Type</label>
                                <!-- Must stay in step with the nine tick types the
                                     site's own legend defines (js/pages/core/framedata.js) and
                                     systems/color-codes documents. InSkill Stun and
                                     Inactive were both styled and documented but had
                                     no way to be authored, so contributors either
                                     omitted them or recorded something else. -->
                                <select class="editor-select" id="insp-class">
                                    <option value="bg-tick-start" ${p.styleClass==='bg-tick-start'?'selected':''}>Startup (Blue)</option>
                                    <option value="bg-tick-active" ${p.styleClass==='bg-tick-active'?'selected':''}>Active (Red)</option>
                                    <option value="bg-tick-inactive" ${p.styleClass==='bg-tick-inactive'?'selected':''}>Inactive (Yellow) - between Active frames</option>
                                    <option value="bg-tick-recov" ${p.styleClass==='bg-tick-recov'?'selected':''}>Recovery (Purple)</option>
                                    <option value="bg-tick-blockendlag" ${p.styleClass==='bg-tick-blockendlag'?'selected':''}>Block Endlag (Pink)</option>
                                    <option value="bg-tick-selfstun" ${p.styleClass==='bg-tick-selfstun'?'selected':''}>Self Stun (Green)</option>
                                    <option value="bg-tick-inskillstun" ${p.styleClass==='bg-tick-inskillstun'?'selected':''}>InSkill Stun (Dark Orange) - can still move</option>
                                    <option value="bg-tick-targetstun" ${p.styleClass==='bg-tick-targetstun'?'selected':''}>Target Stun (Dark Red)</option>
                                    <option value="bg-tick-misc" ${p.styleClass==='bg-tick-misc'?'selected':''}>Misc (Teal)</option>
                                    <option value="bg-transparent" ${p.styleClass==='bg-transparent'?'selected':''}>Transparent / Gap</option>
                                </select>
                            </div>
                        </div>
                        <div class="editor-row">
                            <div>
                                <label class="editor-field-label-sm">Tooltip</label>
                                <input type="text" class="editor-input" id="insp-label" value="${window.escapeHtml(p.label || '')}">
                            </div>
                            <div>
                                <label class="editor-field-label-sm daw-overlay-label-block">Overlays</label>
                                <details class="editor-input daw-overlay-details">
                                    <summary class="daw-overlay-summary">Select Overlays (${pOverlays.length})</summary>
                                    <div class="daw-overlay-grid">
                                        ${overlaysHtml}
                                    </div>
                                </details>
                            </div>
                        </div>
                        <div class="editor-row">
                            <div class="daw-inspector-field-flex1">
                                <label class="editor-field-label-sm">Legend Description (Overrides the normal tooltip in the bottom Legend)</label>
                                <input type="text" class="editor-input" id="insp-legend" value="${window.escapeHtml(p.legendDesc || '')}" placeholder="e.g. Has Super Armor">
                            </div>
                        </div>
                    </div>
                `;
            }

            dawHtml = `
                <div class="daw-container">
                    <div class="daw-container-header-row">
                        <div class="editor-row daw-container-header-meta">
                            <input type="text" class="editor-input daw-variant-label-inp" placeholder="Micro Variant Label" id="daw-variant-label" value="${window.escapeHtml(currentObj.label || '')}">
                            <input type="number" class="editor-input daw-variant-scale-inp" placeholder="Scale" id="daw-variant-scale" value="${window.escapeHtml(totalScale)}">
                        </div>
                        <div class="daw-container-header-actions">
                            <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red" title="Delete this Micro Variant completely">✖ DELETE</button>
                            <button onclick="window.addDawTrack()" class="btn-sys btn-sys-blue">+ Add Track</button>
                        </div>
                    </div>
                    <!-- This timeline's own media (owner, 2026-11-16): the
                         Skill Card shows it while this Micro Variant is the one
                         on show. Left empty, the card keeps the move's media. -->
                    <div class="editor-row daw-variant-media-row">
                        <div><input type="text" class="editor-input daw-variant-media-inp" data-field="src" value="${window.escapeHtml(currentObj.media?.src || '')}" placeholder="Micro Variant Media Src (empty: the move's media)"></div>
                        <div><input type="text" class="editor-input daw-variant-media-inp" data-field="alt" value="${window.escapeHtml(currentObj.media?.alt || '')}" placeholder="Micro Variant Media Alt Text"></div>
                    </div>
                    <div class="daw-timeline-wrapper" data-timeline-path="${window.escapeHtml(JSON.stringify(activePath))}">
                        ${tracksHtml}
                    </div>
                    ${inspectorHtml}
                </div>
            `;
        } else if (hasVariants) {
            dawHtml = `
                <div class="daw-container daw-branch-empty-notice">
                    <p class="daw-branch-title">Micro Variant Branch</p>

                    <div class="daw-branch-label-row">
                        <input type="text" class="editor-input daw-branch-label-inp" placeholder="Branch Name" id="daw-variant-label" value="${window.escapeHtml(currentObj.label || '')}">
                    </div>

                    <p class="daw-branch-hint">Select a Sub-Micro Variant from the tabs above to view or edit its timeline.</p>
                    <div class="daw-branch-actions-row">
                        <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red daw-delete-branch-btn">Delete Entire Branch</button>
                    </div>
                </div>
            `;
        } else if (activePath.length > 0) {
            dawHtml = `
                <div class="daw-container daw-branch-empty-notice">

                    <div class="daw-branch-label-row">
                        <input type="text" class="editor-input daw-branch-label-inp" placeholder="Micro Variant Name" id="daw-variant-label" value="${window.escapeHtml(currentObj.label || '')}">
                    </div>

                    <p class="daw-branch-hint">This Micro Variant is currently empty.</p>
                    <div class="daw-branch-actions-row">
                        <button onclick="window.initDawLeaf()" class="btn-sys btn-sys-blue daw-narrow-btn">Initialize Timeline</button>
                        <button onclick="window.initDawBranch()" class="btn-sys btn-sys-regular daw-narrow-btn">Create Sub-Micro Variants</button>
                        <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red">Delete Micro Variant</button>
                    </div>
                </div>
            `;
        }

        // Every click in the timeline (selecting a phase, adding one) rebuilds
        // it, and a rebuilt scroll box starts at 0. On a long move that threw
        // the editor back to frame 0 on every click. The position is kept when
        // the same timeline is redrawn, and only then: a different variant is a
        // different timeline and starts at its own beginning.
        const oldTimeline = container.querySelector('.daw-timeline-wrapper');
        const keptScroll = oldTimeline && oldTimeline.dataset.timelinePath === JSON.stringify(activePath)
            ? oldTimeline.scrollLeft : 0;

        container.innerHTML = metaHtml + statsCard + variantTabsHtml + dawHtml;
        bindDawEvents(container, currentObj);

        const newTimeline = container.querySelector('.daw-timeline-wrapper');
        if (newTimeline && keptScroll) newTimeline.scrollLeft = keptScroll;

        if (drawnOnce) saveFrameDraftSoon();
        drawnOnce = true;
    }

    // Stale dimensions are worse than none - they would frame the box for the
    // previous file - so they are cleared the moment the src changes and only
    // rewritten once the new source actually measures. A src typed one
    // character at a time therefore spends most of its life with no dimensions
    // rather than the wrong ones.
    //
    // `media` is the move's media object or a Micro Variant's, each with its
    // own timer so typing in one does not cancel the other's measurement.
    const dimensionTimers = new WeakMap();
    function captureMediaDimensions(media, src) {
        media.width = null;
        media.height = null;

        clearTimeout(dimensionTimers.get(media));
        if (!src || typeof window.measureMediaSource !== 'function') return;

        dimensionTimers.set(media, setTimeout(async () => {
            const size = await window.measureMediaSource(src).catch(() => null);
            // The field may have moved on while the network was busy.
            if (!size || media.src !== src) return;
            media.width = size.width;
            media.height = size.height;
        }, 600));
    }

    function bindDawEvents(container, currentObj) {
        // Variant paths are built from stored variant keys, so they ride in
        // data- attributes rather than an inline onclick (CLAUDE.md).
        container.querySelectorAll('[data-daw-path]').forEach(btn =>
            btn.addEventListener('click', () => window.setDawPath(JSON.parse(btn.dataset.dawPath))));
        container.querySelectorAll('[data-daw-add-variant]').forEach(btn =>
            btn.addEventListener('click', () => window.addDawVariant(JSON.parse(btn.dataset.dawAddVariant))));

        container.querySelectorAll('.meta-inp').forEach(inp => {
            inp.addEventListener('input', (e) => {
                let field = e.target.dataset.field;
                if(field.startsWith('media.')) moveData.media[field.split('.')[1]] = e.target.value;
                else moveData[field] = e.target.value;

                // Recording the media's real size here is what lets a skill
                // card pick its box shape before the file has loaded. It has
                // to happen at paste time: the media library hands out URLs to
                // copy rather than inserting files, so the upload path never
                // sees this move. Debounced, because this fires per keystroke
                // and each attempt is a network request.
                if (field === 'media.src') captureMediaDimensions(moveData.media, e.target.value);
            });
        });

        container.querySelectorAll('.stat-inp').forEach(inp => {
            inp.addEventListener('input', (e) => { moveData.stats[e.target.dataset.idx][e.target.dataset.field] = e.target.value; });
        });

        container.querySelectorAll('.stat-highlight').forEach(inp => {
            inp.addEventListener('change', (e) => { moveData.stats[e.target.dataset.idx].isHighlighted = e.target.checked; });
        });

        container.querySelectorAll('.btn-del-stat').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!(await window.confirmDelete('Delete this stat?'))) return;
                moveData.stats.splice(btn.dataset.idx, 1);
                renderDaw();
            });
        });

        const btnAddStat = container.querySelector('#btn-add-movestat');
        if(btnAddStat) btnAddStat.addEventListener('click', () => {
            moveData.stats.push({ label: 'New Stat', value: 'Value' });
            renderDaw();
        });

        container.querySelectorAll('.accolade-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                toggleAccolade(moveData, chip.dataset.accolade);
                renderDaw();
            });
        });

        if (!currentObj) return;

        const varLabel = container.querySelector('#daw-variant-label');
        if (varLabel) varLabel.addEventListener('input', (e) => {
            currentObj.label = e.target.value;
            const activeBtns = container.querySelectorAll('.daw-variant-tabs .active');
            if(activeBtns.length > 0) activeBtns[activeBtns.length - 1].textContent = e.target.value;
        });

        // Stored on the timeline only while it has something in it, so a
        // Micro Variant nobody gave media to keeps its shape.
        container.querySelectorAll('.daw-variant-media-inp').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const media = currentObj.media || (currentObj.media = { src: '', alt: '' });
                media[e.target.dataset.field] = e.target.value;
                if (e.target.dataset.field === 'src') captureMediaDimensions(media, e.target.value);
                if (!media.src && !media.alt) delete currentObj.media;
            });
        });

        const varScale = container.querySelector('#daw-variant-scale');
        if (varScale) {
            varScale.addEventListener('input', (e) => { currentObj.totalScale = parseInt(e.target.value) || 100; });
            varScale.addEventListener('blur', renderDaw);
        }

        container.querySelectorAll('.daw-track-inp').forEach(inp => {
            inp.addEventListener('input', (e) => { currentObj.bars[e.target.dataset.bidx][e.target.dataset.field] = e.target.value; });
        });

        container.querySelectorAll('.daw-track-color').forEach(sel => {
            sel.addEventListener('change', (e) => {
                let bIdx = e.target.dataset.bidx;
                let val = e.target.value;

                // Swap only the semantic color-marker class in place (classList,
                // not a className rebuild) so unrelated classes survive - most
                // importantly .manga-initialized, which site_utils.js's dropdown
                // engine relies on to avoid re-wrapping this <select> on every
                // DOM mutation (a rebuild silently dropping it caused the select
                // to get wrapped a second time on every color change).
                DAW_TRACK_COLOR_CLASSES.forEach(c => e.target.classList.remove(c));
                if (val) e.target.classList.add(val);

                if (val) {
                    currentObj.bars[bIdx].headerClass = val;
                } else {
                    delete currentObj.bars[bIdx].headerClass;
                }
            });
        });

        const inspDur = container.querySelector('#insp-duration');
        const inspClass = container.querySelector('#insp-class');
        const inspLabel = container.querySelector('#insp-label');
        const inspLegend = container.querySelector('#insp-legend');

        if (inspDur) inspDur.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].duration = parseInt(e.target.value) || 0;
            renderDaw();
        });

        // Bound on `change`, not with the .meta-inp `input` handlers above:
        // initializeMangaSelects hides the native <select> behind a custom
        // dropdown that only ever dispatches `change`.
        // Stored only when ticked, so a move nobody touched keeps its shape and
        // a submission shows no change.
        const noFrames = container.querySelector('#move-no-frame-data');
        if (noFrames) noFrames.addEventListener('change', (e) => {
            if (e.target.checked) moveData.noFrameData = true;
            else delete moveData.noFrameData;
            renderDaw();
        });

        const framingSel = container.querySelector('#move-media-framing');
        if (framingSel) framingSel.addEventListener('change', (e) => {
            moveData.media.framing = e.target.value;
        });

        const inspMode = container.querySelector('#insp-measure-mode');
        const inspEstimate = container.querySelector('#insp-estimate');

        if (inspMode) inspMode.addEventListener('change', (e) => {
            const phase = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];

            // What the phase is worth RIGHT NOW, in frames. That is the one
            // currency the three modes share, so a switch keeps the shape of
            // the bar rather than snapping it to whatever happens to be first
            // in a list - which is what the counted/estimated pair already did
            // between themselves, generalised now that there are three.
            const frames = Math.round(window.phaseWeight(phase)) || 0;

            // Only ever ONE of the three is stored. Keeping the others would
            // leave a count in the data that nothing displays and a reviewer
            // might reasonably trust.
            delete phase.duration;
            delete phase.estimate;
            delete phase.seconds;

            if (e.target.value === 'estimated') {
                phase.estimate = closestEstimate(frames);
            } else if (e.target.value === 'timed') {
                // Two decimals, for the same reason the input steps by 0.05.
                phase.seconds = Number((frames / window.FRAMES_PER_SECOND).toFixed(2)) || 0;
            } else {
                // A starting point to correct, not a claim.
                phase.duration = frames;
            }
            renderDaw();
        });

        const inspSeconds = container.querySelector('#insp-seconds');
        if (inspSeconds) inspSeconds.addEventListener('change', (e) => {
            const value = Number(e.target.value);
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].seconds =
                Number.isFinite(value) && value > 0 ? value : 0;
            renderDaw();
        });

        if (inspEstimate) inspEstimate.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].estimate = e.target.value;
            renderDaw();
        });
        if (inspClass) inspClass.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].styleClass = e.target.value;
            renderDaw();
        });
        if (inspLabel) inspLabel.addEventListener('change', (e) => {
            currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].label = e.target.value;
            renderDaw();
        });

        if (inspLegend) inspLegend.addEventListener('change', (e) => {
            let val = e.target.value.trim();
            if(val) {
                currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].legendDesc = val;
            } else {
                delete currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx].legendDesc;
            }
            renderDaw();
        });

        container.querySelectorAll('.insp-overlay-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                let phase = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];
                if (!phase.overlays) phase.overlays = [];

                let val = e.target.value;
                if (e.target.checked) {
                    if (!phase.overlays.includes(val)) phase.overlays.push(val);
                } else {
                    phase.overlays = phase.overlays.filter(o => o !== val);
                }

                if (phase.overlays.length === 0) delete phase.overlays;

                renderDaw();
            });
        });
    }

    window.setDawPath = function(pathArr) {
        activePath = pathArr;
        selectedBarIdx = null; selectedPhaseIdx = null;
        renderDaw();
    };

    window.addDawVariant = function(parentPathArr) {
        let parentNode = moveData;
        parentPathArr.forEach(k => { parentNode = parentNode.variants[k]; });
        if (!parentNode.variants) parentNode.variants = {};
        let newKey = 'var_' + Date.now();
        parentNode.variants[newKey] = { label: "New Micro Variant" };
        window.setDawPath([...parentPathArr, newKey]);
    };

    window.initDawLeaf = function() {
        let node = getCurrentDawNode();
        node.totalScale = 100;
        node.bars = [{ type: "single", headerInfo: "Track 1", phases: [] }];
        renderDaw();
    };

    window.initDawBranch = function() {
        let node = getCurrentDawNode();
        node.variants = {};
        window.addDawVariant(activePath);
    };

    window.deleteDawVariant = async function() {
        if(activePath.length === 0) return;
        let parentNode = moveData;
        for(let i=0; i<activePath.length-1; i++) { parentNode = parentNode.variants[activePath[i]]; }
        let keyToDelete = activePath[activePath.length-1];
        if(await window.confirmDelete("Delete this Micro Variant completely?")) {
            delete parentNode.variants[keyToDelete];
            activePath.pop();
            renderDaw();
        }
    };

    window.addDawTrack = function() {
        let node = getCurrentDawNode();
        if(!node) return;
        node.bars.push({ type: "single", headerInfo: "New Track", phases: [] });
        renderDaw();
    };

    window.deleteDawTrack = async function(bIdx) {
        if(await window.confirmDelete("Delete this entire track?")) {
            getCurrentDawNode().bars.splice(bIdx, 1);
            if(selectedBarIdx === parseInt(bIdx)) { selectedBarIdx = null; selectedPhaseIdx = null; }
            renderDaw();
        }
    };

    window.addDawPhase = function(bIdx) {
        getCurrentDawNode().bars[bIdx].phases.push({ duration: 10, styleClass: "bg-tick-start", label: "New Phase" });
        renderDaw();
    };

    window.selectDawPhase = function(bIdx, pIdx) {
        selectedBarIdx = bIdx; selectedPhaseIdx = pIdx;
        renderDaw();
    };

    window.deleteDawPhase = async function() {
        if(selectedBarIdx !== null && selectedPhaseIdx !== null) {
            if (!(await window.confirmDelete('Delete this phase?'))) return;
            getCurrentDawNode().bars[selectedBarIdx].phases.splice(selectedPhaseIdx, 1);
            selectedPhaseIdx = null;
            renderDaw();
        }
    };

    renderDaw();
}
