/**
 * MERGE TICKETS: several open submissions on one page made into one ticket. It
 * lists every place two of them disagree with the live page, the reviewer picks a
 * version for each, and the choices ship as one batch of scoped deltas.
 * @since v0.4, as part of admin.js
 * @touches pending_revisions, page_data, applyDeltaToData (submission_delta.js),
 *   getKeyedSections (character_tabs.js), loadQueue (admin-queue.js)
 * @watch a merge ships deltas, never a snapshot: a snapshot taken now and applied at
 *   approval would overwrite everything approved meanwhile. A scope the scan
 *   misses never conflicts, and the second ticket overwrites the first.
 * @see docs/overseer.md
 */

window.openMergeCompiler = async function(pageId) {
    const modal = document.getElementById('compiler-modal-overlay');
    const body = document.getElementById('compiler-modal-body');
    const titleSpan = document.getElementById('compiler-char-name');
    const confirmBtn = document.getElementById('btn-compiler-confirm');

    titleSpan.textContent = pageId.toUpperCase();
    titleSpan.parentElement.innerHTML = `MERGE COMPILER: <span id="compiler-char-name" class="compiler-title-highlight">${window.escapeHtml(pageId.toUpperCase())}</span>`;

    body.innerHTML = `<p class="compiler-status-text">Analyzing revisions and fetching live database...</p>`;
    modal.classList.remove('hidden');
    confirmBtn.disabled = true;

    const { data: liveData, error: liveErr } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();

    if (liveErr && liveErr.code !== 'PGRST116') {
        window.adminAlert("System Error fetching baseline data: " + liveErr.message);
        return;
    }

    const liveDesc = (liveData && liveData.desc_data) ? liveData.desc_data : {};
    const liveFrame = (liveData && liveData.frame_data) ? liveData.frame_data : {};

    const tickets = window.currentQueueData.filter(r => r.page_id === pageId).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

    const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);
    const conflicts = [];

    // Each character state is scanned too, and each conflict carries its state.
    const narrow = (obj, modeId) => (modeId ? ((obj && obj.modeData) || {})[modeId] || {} : (obj || {}));

    const statesIn = (frame) => window.getCharacterModes(frame || {})
        .map(m => m.id)
        .filter(id => id && id !== 'base');

    const addConflict = (sectionId, sectionName, type, lData, lStratData = null, modeId = null) => {
        // Prefixed, so one section in two states is two conflicts with two ids.
        const scopedId = modeId ? `state_${String(modeId).replace(/[^a-zA-Z0-9]/g, '_')}__${sectionId}` : sectionId;
        let existing = conflicts.find(c => c.sectionId === scopedId);
        if (!existing) {
            existing = {
                sectionId: scopedId, modeId,
                sectionName: modeId ? `[${String(modeId).toUpperCase()}] ${sectionName}` : sectionName,
                type, liveData: lData, liveStratData: lStratData, options: [],
            };
            conflicts.push(existing);
        }
        return existing;
    };

    tickets.forEach(t => {
        let tFullDesc = t.desc_data || {};
        let tFullFrame = t.frame_data || {};

        if (t.is_delta) {
            const patched = window.applyDeltaToData(liveDesc, liveFrame, t.target_scope, t.target_key, t.delta_payload);
            tFullDesc = patched.newDesc;
            tFullFrame = patched.newFrame;
        }

        // The page's own settings, on every page type, before the system branch returns.
        if (isDiff(tFullDesc.pageConfig, liveDesc.pageConfig)) {
            addConflict('pageConfig', 'Page Settings (auto-color words and house style)', 'desc', liveDesc.pageConfig)
                .options.push({ ticket: t, data: tFullDesc.pageConfig });
        }

        // A system or tier list page holds tabs of sections, which the character scan
        // below would find no conflicts in.
        if (isSystemShaped(tFullDesc) || isSystemShaped(liveDesc)) {
            scanSystemPage(t, tFullDesc);
            return;
        }

        // Which states exist is page-level and travels on its own, or merged state
        // content has no toggle to reach it.
        if (isDiff(tFullFrame.modes, liveFrame.modes)) {
            addConflict('modes', 'Character States (which kits exist)', 'modes', liveFrame.modes)
                .options.push({ ticket: t, data: tFullFrame.modes });
        }

        // The union: a ticket may declare a state live has never had.
        const states = [null, ...new Set([...statesIn(liveFrame), ...statesIn(tFullFrame)])];

        states.forEach(modeId => scanOneState(t, modeId, tFullDesc, tFullFrame));
    });

    // From the data, not a page-type flag: a ticket does not always carry the type.
    function isSystemShaped(desc) {
        return !!(desc && Array.isArray(desc.tabs));
    }

    // Sections match by their derived key, as the editor and applyDeltaToData do, so
    // two people editing different sections do not conflict.
    function scanSystemPage(t, tDesc) {
        const liveTabs = window.indexSystemTabs(liveDesc);
        const liveSecs = window.indexSystemSections(liveDesc);
        const tTabs = window.indexSystemTabs(tDesc);
        const tSecs = window.indexSystemSections(tDesc);

        const allSecKeys = new Set([...liveSecs.map(s => s.key), ...tSecs.map(s => s.key)]);
        allSecKeys.forEach(key => {
            const lSec = liveSecs.find(s => s.key === key);
            const tSec = tSecs.find(s => s.key === key);
            if (!isDiff(tSec && tSec.section, lSec && lSec.section)) return;

            const tabKey = key.split('::')[0];
            const tabLabel = (liveTabs.find(x => x.tabKey === tabKey) || tTabs.find(x => x.tabKey === tabKey) || {});
            const tabName = (tabLabel.tab && (tabLabel.tab.tabLabel || tabLabel.tab.tabId)) || tabKey;
            const secName = (tSec && tSec.section && tSec.section.sectionTitle)
                || (lSec && lSec.section && lSec.section.sectionTitle) || key;

            addConflict(`system_section_${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
                `${tabName}: ${secName}`, 'system_section', lSec && lSec.section, { systemKey: key })
                .options.push({ ticket: t, data: tSec && tSec.section });
        });

        // The order of the tabs is one conflict for the page: two reorders are one
        // competing decision. A tab added or removed is a system_tab conflict instead.
        const liveOrder = liveTabs.map(x => x.tabKey);
        const tOrder = tTabs.map(x => x.tabKey);
        if (liveOrder.join(' ') !== tOrder.join(' ')
            && [...liveOrder].sort().join(' ') === [...tOrder].sort().join(' ')) {
            const nameFor = (k) => {
                const hit = tTabs.find(x => x.tabKey === k) || liveTabs.find(x => x.tabKey === k) || {};
                return (hit.tab && (hit.tab.tabLabel || hit.tab.tabId)) || k;
            };
            addConflict('system_tab_order', `Tab Order: ${tOrder.map(nameFor).join(' → ')}`,
                'system_tab_order', liveOrder)
                .options.push({ ticket: t, data: tOrder });
        }

        const allTabKeys = new Set([...liveTabs.map(x => x.tabKey), ...tTabs.map(x => x.tabKey)]);
        allTabKeys.forEach(tabKey => {
            const lTab = (liveTabs.find(x => x.tabKey === tabKey) || {}).tab;
            const tTab = (tTabs.find(x => x.tabKey === tabKey) || {}).tab;
            const name = (tTab && (tTab.tabLabel || tTab.tabId)) || (lTab && (lTab.tabLabel || lTab.tabId)) || tabKey;

            ['tiers', 'changelog'].forEach(field => {
                if (!isDiff(tTab && tTab[field], lTab && lTab[field])) return;
                addConflict(`system_${field}_${tabKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
                    `${name}: ${field === 'tiers' ? 'Tiers' : 'Changelog'}`, `tierlist_${field}`,
                    lTab && lTab[field], { systemKey: tabKey })
                    .options.push({ ticket: t, data: tTab && tTab[field] });
            });
        });
    }

    function scanOneState(t, modeId, tFullDesc, tFullFrame) {
        const tDesc = narrow(tFullDesc, modeId);
        const tFrame = narrow(tFullFrame, modeId);
        const lDesc = narrow(liveDesc, modeId);
        const lFrame = narrow(liveFrame, modeId);

        const liveDescData = lDesc;
        const liveFrameData = lFrame;

        if (isDiff(tDesc.profile, liveDescData.profile)) addConflict('profile', 'Profile Metadata', 'desc', liveDescData.profile, null, modeId).options.push({ ticket: t, data: tDesc.profile });
        if (isDiff(tDesc.playstyle, liveDescData.playstyle)) addConflict('playstyle', 'Playstyle Details', 'desc', liveDescData.playstyle, null, modeId).options.push({ ticket: t, data: tDesc.playstyle });
        if (isDiff(tDesc.overview, liveDescData.overview)) addConflict('overview', 'Character Overview', 'desc', liveDescData.overview, null, modeId).options.push({ ticket: t, data: tDesc.overview });
        if (isDiff(tDesc.strategy, liveDescData.strategy)) addConflict('strategy', 'General Strategy', 'desc', liveDescData.strategy, null, modeId).options.push({ ticket: t, data: tDesc.strategy });

        // By identity (keyProp), never position: a deletion shifting the array would
        // otherwise raise conflicts on items nobody touched, and picking one wrote
        // undefined into them.
        const scanArray = (arrName, labelName, tArr, lArr, keyProp) => {
            const tItems = tArr || [];
            const lItems = lArr || [];
            const allKeys = new Set([...tItems, ...lItems].map(item => item?.[keyProp]));

            allKeys.forEach(key => {
                const tItem = tItems.find(item => item?.[keyProp] === key);
                const lItem = lItems.find(item => item?.[keyProp] === key);
                if (isDiff(tItem, lItem)) {
                    const safeKey = String(key ?? 'untitled').replace(/[^a-zA-Z0-9]/g, '_');
                    addConflict(`${arrName}_${safeKey}`, `${labelName}: ${key || 'Untitled'}`, 'array_item', lItem, { arrName, key, keyProp }, modeId).options.push({ ticket: t, data: tItem });
                }
            });
        };

        scanArray('extras', 'Custom Tab', tDesc.extras, liveDescData.extras, 'title');
        // Every keyed section, so one added to the vocabulary is merged too.
        window.getKeyedSections().forEach(s => {
            scanArray(s.field, s.entryLabel, tDesc[s.field], liveDescData[s.field], s.keyField);
        });

        window.FRAME_MOVE_CATEGORIES.forEach(cat => {
            const tMoves = tFrame[cat] || [];
            const lMoves = liveFrameData[cat] || [];
            const allMoveIds = new Set([...tMoves.map(m=>m.id), ...lMoves.map(m=>m.id)]);

            allMoveIds.forEach(moveId => {
                const tMove = tMoves.find(m => m.id === moveId);
                const lMove = lMoves.find(m => m.id === moveId);
                const tStrat = (tDesc.moveStrategies || {})[moveId];
                const lStrat = (liveDescData.moveStrategies || {})[moveId];

                if (isDiff(tMove, lMove) || isDiff(tStrat, lStrat)) {
                    const conflict = addConflict(`move_${cat}_${moveId}`, `Move: ${cat.toUpperCase()} / ${moveId}`, 'move', { move: lMove, cat: cat }, lStrat, modeId);
                    // Recorded, since sectionId carries a state prefix and a move id may hold
                    // underscores.
                    conflict.moveId = moveId;
                    conflict.options.push({
                        ticket: t,
                        data: { move: tMove, cat: cat },
                        stratData: tStrat
                    });
                }
            });
        });
    }

    if (conflicts.length === 0) {
        body.innerHTML = `<p class="compiler-empty-text">No mergeable changes detected in these tickets. They may be functionally identical to the live database.</p>`;
        return;
    }

    let html = `<p class="compiler-instructions">Select the version to keep for each modified section. The compiler will merge your selections into a single unified ticket.</p>`;

    conflicts.forEach(c => {
        let selectHtml = `<select id="compiler-sel-${c.sectionId}" class="editor-select compiler-select">`;
        selectHtml += `<option value="live" class="compiler-discard-option">[DISCARD] Keep current live data</option>`;

        c.options.forEach((opt, idx) => {
            const isLast = (idx === c.options.length - 1);
            const dateStr = new Date(opt.ticket.created_at).toLocaleDateString();
            selectHtml += `<option value="${opt.ticket.id}" ${isLast ? 'selected' : ''}>[MERGE] By ${window.escapeHtml(opt.ticket.author_name)} (${dateStr})</option>`;
        });
        selectHtml += `</select>`;

        html += `
            <div class="compiler-conflict-card">
                <div class="compiler-conflict-title">${window.escapeHtml(c.sectionName)}</div>
                ${selectHtml}
            </div>
        `;
    });

    body.innerHTML = html;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "CREATE MERGED TICKET";

    confirmBtn.onclick = async () => {
        if (!(await window.adminConfirm(`Compile these selections into a single unified ticket for review?`))) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = "COMPILING...";

        const masterDesc = JSON.parse(JSON.stringify(liveDesc));
        const masterFrame = JSON.parse(JSON.stringify(liveFrame));
        const selectedTicketIds = new Set();
        const contributors = new Set();

        // One scoped patch per accepted conflict, as a 'multi' delta, the same batch
        // shape the editor sends.
        const batchedDeltas = [];

        // applyDeltaToData's array scopes are singular; declared, never made by trimming
        // an "s".
        const DELTA_SCOPE_FOR_ARRAY = { extras: 'extra' };
        window.getKeyedSections().forEach(s => { DELTA_SCOPE_FOR_ARRAY[s.field] = s.scope; });

        // A state's conflict ships wrapped in its state, as the editor's deltas are.
        const sliceOf = (master, modeId) => {
            if (!modeId) return master;
            if (!master.modeData) master.modeData = {};
            if (!master.modeData[modeId]) master.modeData[modeId] = {};
            return master.modeData[modeId];
        };
        // A singular scope's key is 'full', never null, as the editor sends it: a null
        // key broke the diff view.
        const normaliseKey = (key) => (key === null || key === undefined ? 'full' : key);

        const pushDelta = (modeId, scope, key, payload) => {
            batchedDeltas.push(modeId
                ? { scope: 'mode', key: `${modeId}::${scope}::${normaliseKey(key)}`, payload }
                : { scope, key: normaliseKey(key), payload });
        };

        conflicts.forEach(c => {
            const selVal = document.getElementById(`compiler-sel-${c.sectionId}`).value;
            if (selVal === 'live') return;

            const chosenOpt = c.options.find(o => o.ticket.id === selVal);
            if (!chosenOpt) return;

            selectedTicketIds.add(selVal);
            contributors.add(chosenOpt.ticket.author_name);

            const descSlice = sliceOf(masterDesc, c.modeId);
            const frameSlice = sliceOf(masterFrame, c.modeId);

            if (c.type === 'modes') {
                masterFrame.modes = chosenOpt.data;
                batchedDeltas.push({ scope: 'modes', key: 'full', payload: chosenOpt.data || null });
            }
            else if (c.type === 'desc') {
                const prop = c.modeId ? c.sectionId.split('__').pop() : c.sectionId;
                descSlice[prop] = chosenOpt.data;
                pushDelta(c.modeId, prop, null, chosenOpt.data);
            }
            // One system section from the chosen ticket, as the editor's scoped delta.
            else if (c.type === 'system_section') {
                const key = c.liveStratData.systemKey;
                const chosen = chosenOpt.data === undefined ? null : chosenOpt.data;
                // tabs replaced in place: masterDesc is a const, and sliceOf holds references
                // into it.
                const applied = window.applyDeltaToData(masterDesc, masterFrame, 'system_section', key, chosen);
                masterDesc.tabs = applied.newDesc.tabs;
                batchedDeltas.push({ scope: 'system_section', key, payload: chosen });
            }
            // Page-level, key 'full', and applied first, so a section conflict in the same
            // batch resolves against the new order.
            else if (c.type === 'system_tab_order') {
                const chosen = chosenOpt.data === undefined ? null : chosenOpt.data;
                const applied = window.applyDeltaToData(masterDesc, masterFrame, 'system_tab_order', 'full', chosen);
                masterDesc.tabs = applied.newDesc.tabs;
                batchedDeltas.push({ scope: 'system_tab_order', key: 'full', payload: chosen });
            }
            else if (c.type === 'tierlist_tiers' || c.type === 'tierlist_changelog') {
                const key = c.liveStratData.systemKey;
                const chosen = chosenOpt.data === undefined ? null : chosenOpt.data;
                const applied = window.applyDeltaToData(masterDesc, masterFrame, c.type, key, chosen);
                masterDesc.tabs = applied.newDesc.tabs;
                batchedDeltas.push({ scope: c.type, key, payload: chosen });
            }
            else if (c.type === 'array_item') {
                // By identity, like scanArray. No data on the chosen option means that ticket
                // deleted the item.
                const { arrName, key, keyProp } = c.liveStratData;
                if (!descSlice[arrName]) descSlice[arrName] = [];
                const existingIdx = descSlice[arrName].findIndex(item => item?.[keyProp] === key);
                if (chosenOpt.data === undefined) {
                    if (existingIdx > -1) descSlice[arrName].splice(existingIdx, 1);
                } else if (existingIdx > -1) {
                    descSlice[arrName][existingIdx] = chosenOpt.data;
                } else {
                    descSlice[arrName].push(chosenOpt.data);
                }

                // A deletion is null: undefined drops out of the JSON and would bring the item back.
                pushDelta(c.modeId, DELTA_SCOPE_FOR_ARRAY[arrName], key,
                    chosenOpt.data === undefined ? null : chosenOpt.data);
            }
            else if (c.type === 'move') {
                const cat = chosenOpt.data.cat;
                const moveData = chosenOpt.data.move;
                const stratData = chosenOpt.stratData;
                const moveId = c.moveId;

                if (!frameSlice[cat]) frameSlice[cat] = [];
                const existingIdx = frameSlice[cat].findIndex(m => m.id === moveId);

                if (moveData) {
                    if (existingIdx > -1) frameSlice[cat][existingIdx] = moveData;
                    else frameSlice[cat].push(moveData);
                } else {
                    if (existingIdx > -1) frameSlice[cat].splice(existingIdx, 1);
                }

                if (!descSlice.moveStrategies) descSlice.moveStrategies = {};
                if (stratData) descSlice.moveStrategies[moveId] = stratData;
                else delete descSlice.moveStrategies[moveId];

                // Keyed "category::moveId", like the editor's move deltas.
                pushDelta(c.modeId, 'move', `${cat}::${moveId}`,
                    moveData ? { frame_data: moveData, desc_data: stratData || [] } : null);
            }
        });

        if (selectedTicketIds.size === 0) {
            window.adminAlert("No tickets were selected. All conflicts were set to keep Live Data.");
            modal.classList.add('hidden');
            return;
        }

        const chosenTickets = tickets.filter(t => selectedTicketIds.has(t.id));
        const masterTicket = chosenTickets[chosenTickets.length - 1];
        const otherTicketIds = chosenTickets.filter(t => t.id !== masterTicket.id).map(t => t.id);

        const authorsList = Array.from(contributors).join(', ');
        const finalAuthorName = `Staff Merge (Credits: ${authorsList})`;

        // Every contributor's changelog and evidence carry through, attributed.
        const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
        const qaSources = chosenTickets.map(t => ({
            name: t.author_name || 'Contributor',
            qa: t.qa_metadata || {}
        }));

        const mergedChangelog = [
            `System Merge: unified edits from ${contributors.size} contributor${contributors.size === 1 ? '' : 's'}.`,
            ...qaSources.map(s => `--- ${s.name} ---\n${s.qa.changelog || '(no changelog provided)'}`)
        ].join('\n\n');

        const mergedEvidence = qaSources
            .filter(s => s.qa.evidence)
            .map(s => `--- ${s.name} ---\n${s.qa.evidence}`)
            .join('\n\n');

        // The lowest confidence of its sources: a merge is only as sure as its least sure part.
        const mergedConfidence = qaSources.reduce((lowest, s) => {
            const rank = CONFIDENCE_RANK[s.qa.confidence];
            if (rank === undefined) return lowest;
            return (lowest === null || rank < CONFIDENCE_RANK[lowest]) ? s.qa.confidence : lowest;
        }, null) || 'medium';

        const payload = {
            // The editor's fallback shape; delta_payload is what applies.
            desc_data: masterDesc,
            frame_data: masterFrame,
            is_delta: true,
            target_scope: 'multi',
            target_key: 'batch',
            delta_payload: batchedDeltas,
            author_id: window.currentUserId,
            author_name: finalAuthorName,
            status: 'ticket_open',
            qa_metadata: {
                changelog: mergedChangelog,
                confidence: mergedConfidence,
                evidence: mergedEvidence
            }
        };

        const { error: updateError } = await window.supabaseClient.from('pending_revisions').update(payload).eq('id', masterTicket.id);

        if (updateError) {
            window.adminAlert("Merge Failed: " + updateError.message);
            confirmBtn.disabled = false;
            confirmBtn.textContent = "CREATE MERGED TICKET";
            return;
        }

        if (otherTicketIds.length > 0) {
            await window.supabaseClient.from('pending_revisions').delete().in('id', otherTicketIds);
        }

        window.adminAlert(`Successfully merged ${selectedTicketIds.size} tickets!`);
        modal.classList.add('hidden');

        resetPreviewState();
        loadQueue();
    };
};
