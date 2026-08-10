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

function initDawEditor(containerId, moveData) {
    const container = document.getElementById(containerId);
    if (!moveData) {
        container.innerHTML = `<p class="daw-empty-notice">No frame data configured for this move yet.</p>`;
        return;
    }

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
        let metaHtml = `
            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header"><span class="block-type-badge">MOVE METADATA</span></div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="name" value="${moveData.name || ''}" placeholder="Move Name"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="input" value="${moveData.input || ''}" placeholder="Input (e.g. M1)"></div>
                    </div>
                    <div class="editor-row">
                        <div><input type="text" class="editor-input meta-inp" data-field="type" value="${moveData.type || ''}" placeholder="Skill Type (e.g. Basic Attack)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="damageType" value="${moveData.damageType || ''}" placeholder="Damage Type (e.g. Melee, Bullet)"></div>
                        <div><input type="text" class="editor-input meta-inp" data-field="variant" value="${moveData.variant || ''}" placeholder="Variant (e.g. Standard)"></div>
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
                            <select id="move-media-framing" class="editor-input meta-inp" data-field="media.framing">
                                <option value="auto"${!moveData.media.framing || moveData.media.framing === 'auto' ? ' selected' : ''}>Auto — match the file</option>
                                <option value="wide"${moveData.media.framing === 'wide' ? ' selected' : ''}>Wide (16:9)</option>
                                <option value="square"${moveData.media.framing === 'square' ? ' selected' : ''}>Square (1:1)</option>
                                <option value="tall"${moveData.media.framing === 'tall' ? ' selected' : ''}>Tall (3:4)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;

        let statsHtml = '';
        moveData.stats.forEach((stat, idx) => {
            statsHtml += `
                <div class="editor-row editor-row-spaced-sm">
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="label" value="${stat.label}" placeholder="Stat Name"></div>
                    <div><input type="text" class="editor-input stat-inp" data-idx="${idx}" data-field="value" value="${stat.value}" placeholder="Stat Value"></div>
                    <div class="daw-stat-actions">
                        <label class="editor-checkbox-label"><input type="checkbox" class="stat-highlight" data-idx="${idx}" ${stat.isHighlighted ? 'checked' : ''}> Highlight</label>
                        <button class="add-block-btn btn-action-delete btn-del-stat daw-stat-del-btn" data-idx="${idx}" title="Remove Stat">✖</button>
                    </div>
                </div>
            `;
        });
        let statsCard = `
            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header">
                        <span class="block-type-badge">MOVE STATS</span>
                        <button class="add-block-btn daw-add-stat-btn" id="btn-add-movestat">+ ADD STAT</button>
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
                variantTabsHtml += `<button class="daw-tab-btn ${isActive ? 'active' : ''}" onclick='window.setDawPath(${pathStr})'>${v.label || k}</button>`;
            });

            let parentPathStr = JSON.stringify(activePath.slice(0, depth));
            variantTabsHtml += `<button class="daw-tab-btn daw-tab-btn-add-variant" onclick='window.addDawVariant(${parentPathStr})'>+ ADD VARIANT</button></div>`;

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

        if (currentObj && currentObj.bars) {
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
                        <div class="daw-phase-block ${isSelected ? 'selected' : ''}${estimate ? ' daw-phase-estimated' : ''}"
                                style="width: ${widthPct}%; background-color: ${phaseColor};"
                                onclick="window.selectDawPhase(${bIdx}, ${pIdx})">
                            <span class="daw-phase-block-duration">${estimate ? '~' + window.escapeHtml(estimate.label) : p.duration + 'f'}</span>
                        </div>
                    `;
                });

                tracksHtml += `
                    <div class="daw-track-wrapper">
                        <div class="daw-track-header-row">

                            <div class="daw-track-input-row">
                                <input type="text" class="editor-input daw-track-inp daw-track-inp-flex" data-bidx="${bIdx}" data-field="headerInfo" value="${bar.headerInfo || ''}" placeholder="Header Title (Top)">
                                <button onclick="window.addDawPhase(${bIdx})" class="btn-sys btn-sys-green" title="Add Phase">+</button>
                                <button onclick="window.deleteDawTrack(${bIdx})" class="btn-sys btn-sys-red" title="Delete Track">✖</button>
                            </div>

                            <div class="daw-track-input-row">
                                <input type="text" class="editor-input daw-track-inp daw-track-inp-flex" data-bidx="${bIdx}" data-field="footerInfo" value="${bar.footerInfo || ''}" placeholder="Footer Title (Bottom)">
                                <select class="editor-select daw-track-color daw-track-color-select ${bar.headerClass || ''}" data-bidx="${bIdx}">
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
                    { id: 'iframe-swarm', label: 'Swarm I-Frames' },
                    { id: 'reverse-hitcancel', label: 'Reverse Hitcancel' }
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
                                    <option value="counted" ${!p.estimate ? 'selected' : ''}>Counted - exact frames</option>
                                    <option value="estimated" ${p.estimate ? 'selected' : ''}>Estimated - how it feels</option>
                                </select>
                            </div>
                            <div>
                                <label class="editor-field-label-sm" id="insp-amount-label">${p.estimate ? 'Estimate' : 'Duration (Frames)'}</label>
                                <input type="number" class="editor-input ${p.estimate ? 'hidden' : ''}" id="insp-duration" value="${p.duration || 0}">
                                <select class="editor-select ${p.estimate ? '' : 'hidden'}" id="insp-estimate">
                                    ${(window.FRAME_ESTIMATES || []).map(e =>
                                        `<option value="${e.id}" ${p.estimate === e.id ? 'selected' : ''}>${window.escapeHtml(e.label)}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="editor-field-label-sm">Frame Type</label>
                                <!-- Must stay in step with the nine tick types the
                                     site's own legend defines (js/framedata.js) and
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
                                <input type="text" class="editor-input" id="insp-label" value="${p.label || ''}">
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
                                <input type="text" class="editor-input" id="insp-legend" value="${p.legendDesc || ''}" placeholder="e.g. Has Super Armor">
                            </div>
                        </div>
                    </div>
                `;
            }

            dawHtml = `
                <div class="daw-container">
                    <div class="daw-container-header-row">
                        <div class="editor-row daw-container-header-meta">
                            <input type="text" class="editor-input daw-variant-label-inp" placeholder="Variant Label" id="daw-variant-label" value="${currentObj.label || ''}">
                            <input type="number" class="editor-input daw-variant-scale-inp" placeholder="Scale" id="daw-variant-scale" value="${totalScale}">
                        </div>
                        <div class="daw-container-header-actions">
                            <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red" title="Delete this Variant completely">✖ DELETE</button>
                            <button onclick="window.addDawTrack()" class="btn-sys btn-sys-blue">+ Add Track</button>
                        </div>
                    </div>
                    <div class="daw-timeline-wrapper">
                        ${tracksHtml}
                    </div>
                    ${inspectorHtml}
                </div>
            `;
        } else if (hasVariants) {
            dawHtml = `
                <div class="daw-container daw-branch-empty-notice">
                    <p class="daw-branch-title">Variant Branch</p>

                    <div class="daw-branch-label-row">
                        <input type="text" class="editor-input daw-branch-label-inp" placeholder="Branch Name" id="daw-variant-label" value="${currentObj.label || ''}">
                    </div>

                    <p class="daw-branch-hint">Select a sub-variant from the tabs above to view or edit its timeline.</p>
                    <div class="daw-branch-actions-row">
                        <button onclick="window.deleteDawVariant()" class="add-block-btn daw-delete-branch-btn">Delete Entire Branch</button>
                    </div>
                </div>
            `;
        } else if (activePath.length > 0) {
            dawHtml = `
                <div class="daw-container daw-branch-empty-notice">

                    <div class="daw-branch-label-row">
                        <input type="text" class="editor-input daw-branch-label-inp" placeholder="Variant Name" id="daw-variant-label" value="${currentObj.label || ''}">
                    </div>

                    <p class="daw-branch-hint">This variant is currently empty.</p>
                    <div class="daw-branch-actions-row">
                        <button onclick="window.initDawLeaf()" class="btn-sys btn-sys-blue daw-narrow-btn">Initialize Timeline</button>
                        <button onclick="window.initDawBranch()" class="btn-sys btn-sys-regular daw-narrow-btn">Create Sub-Variants</button>
                        <button onclick="window.deleteDawVariant()" class="btn-sys btn-sys-red">Delete Variant</button>
                    </div>
                </div>
            `;
        }

        container.innerHTML = metaHtml + statsCard + variantTabsHtml + dawHtml;
        bindDawEvents(container, currentObj);
    }

    // Stale dimensions are worse than none - they would frame the box for the
    // previous file - so they are cleared the moment the src changes and only
    // rewritten once the new source actually measures. A src typed one
    // character at a time therefore spends most of its life with no dimensions
    // rather than the wrong ones.
    let dimensionTimer = null;
    function captureMediaDimensions(moveData, src) {
        moveData.media.width = null;
        moveData.media.height = null;

        clearTimeout(dimensionTimer);
        if (!src || typeof window.measureMediaSource !== 'function') return;

        dimensionTimer = setTimeout(async () => {
            const size = await window.measureMediaSource(src).catch(() => null);
            // The field may have moved on while the network was busy.
            if (!size || moveData.media.src !== src) return;
            moveData.media.width = size.width;
            moveData.media.height = size.height;
        }, 600);
    }

    function bindDawEvents(container, currentObj) {
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
                if (field === 'media.src') captureMediaDimensions(moveData, e.target.value);
            });
        });

        container.querySelectorAll('.stat-inp').forEach(inp => {
            inp.addEventListener('input', (e) => { moveData.stats[e.target.dataset.idx][e.target.dataset.field] = e.target.value; });
        });

        container.querySelectorAll('.stat-highlight').forEach(inp => {
            inp.addEventListener('change', (e) => { moveData.stats[e.target.dataset.idx].isHighlighted = e.target.checked; });
        });

        container.querySelectorAll('.btn-del-stat').forEach(btn => {
            btn.addEventListener('click', (e) => {
                moveData.stats.splice(e.target.dataset.idx, 1);
                renderDaw();
            });
        });

        const btnAddStat = container.querySelector('#btn-add-movestat');
        if(btnAddStat) btnAddStat.addEventListener('click', () => {
            moveData.stats.push({ label: 'New Stat', value: 'Value' });
            renderDaw();
        });

        if (!currentObj) return;

        const varLabel = container.querySelector('#daw-variant-label');
        if (varLabel) varLabel.addEventListener('input', (e) => {
            currentObj.label = e.target.value;
            const activeBtns = container.querySelectorAll('.daw-variant-tabs .active');
            if(activeBtns.length > 0) activeBtns[activeBtns.length - 1].textContent = e.target.value;
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

        const inspMode = container.querySelector('#insp-measure-mode');
        const inspEstimate = container.querySelector('#insp-estimate');

        if (inspMode) inspMode.addEventListener('change', (e) => {
            const phase = currentObj.bars[selectedBarIdx].phases[selectedPhaseIdx];

            if (e.target.value === 'estimated') {
                // Seeded from the frame count already entered, so switching to
                // an estimate keeps the shape of the bar rather than snapping
                // it to whatever happens to be first in the list. The number is
                // then dropped: keeping it would leave a count in the data that
                // nothing displays and a reviewer might trust.
                phase.estimate = closestEstimate(phase.duration);
                delete phase.duration;
            } else {
                // The other direction restores a real number from the estimate's
                // nominal weight - a starting point to correct, not a claim.
                const estimate = window.frameEstimate(phase.estimate);
                phase.duration = estimate ? estimate.frames : 0;
                delete phase.estimate;
            }
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
        parentNode.variants[newKey] = { label: "New Variant" };
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
        if(await window.customConfirm("Delete this variant completely?")) {
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
        if(await window.customConfirm("Delete this entire track?")) {
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

    window.deleteDawPhase = function() {
        if(selectedBarIdx !== null && selectedPhaseIdx !== null) {
            getCurrentDawNode().bars[selectedBarIdx].phases.splice(selectedPhaseIdx, 1);
            selectedPhaseIdx = null;
            renderDaw();
        }
    };

    renderDaw();
}
