/**
 * Dogslamloop Wiki - Admin Overseer: Merge Compiler (combine multiple
 * pending revisions on one page into one unified ticket)
 */

// --- THE MERGE COMPILER ENGINE ---
window.openMergeCompiler = async function(pageId) {
    const modal = document.getElementById('compiler-modal-overlay');
    const body = document.getElementById('compiler-modal-body');
    const titleSpan = document.getElementById('compiler-char-name');
    const confirmBtn = document.getElementById('btn-compiler-confirm');

    titleSpan.textContent = pageId.toUpperCase();
    titleSpan.parentElement.innerHTML = `MERGE COMPILER: <span id="compiler-char-name" class="compiler-title-highlight">${pageId.toUpperCase()}</span>`;

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

    const addConflict = (sectionId, sectionName, type, lData, lStratData = null) => {
        let existing = conflicts.find(c => c.sectionId === sectionId);
        if (!existing) {
            existing = { sectionId, sectionName, type, liveData: lData, liveStratData: lStratData, options: [] };
            conflicts.push(existing);
        }
        return existing;
    };

    tickets.forEach(t => {
        let tDesc = t.desc_data || {};
        let tFrame = t.frame_data || {};

        if (t.is_delta) {
            const patched = window.applyDeltaToData(liveDesc, liveFrame, t.target_scope, t.target_key, t.delta_payload);
            tDesc = patched.newDesc;
            tFrame = patched.newFrame;
        }

        if (isDiff(tDesc.profile, liveDesc.profile)) addConflict('profile', 'Profile Metadata', 'desc', liveDesc.profile).options.push({ ticket: t, data: tDesc.profile });
        if (isDiff(tDesc.playstyle, liveDesc.playstyle)) addConflict('playstyle', 'Playstyle Details', 'desc', liveDesc.playstyle).options.push({ ticket: t, data: tDesc.playstyle });
        if (isDiff(tDesc.overview, liveDesc.overview)) addConflict('overview', 'Character Overview', 'desc', liveDesc.overview).options.push({ ticket: t, data: tDesc.overview });
        if (isDiff(tDesc.strategy, liveDesc.strategy)) addConflict('strategy', 'General Strategy', 'desc', liveDesc.strategy).options.push({ ticket: t, data: tDesc.strategy });

        // Identity-based (matches window.applyDeltaToData's own extras/
        // matchups/counterplay handling in site_utils.js - findIndex by
        // keyProp, not array position), not positional. Comparing by raw
        // index here used to mean: if one ticket deletes item #2 out of 5
        // (shifting everything after it down by one) while another ticket
        // only edits item #4, scanning ticket A index-by-index against live
        // flagged every position from 2 onward as "changed" - including a
        // phantom conflict at the live array's last index, where ticket A's
        // shorter array has nothing. Picking that ticket's "version" for the
        // phantom conflict silently wrote undefined into a real, untouched
        // item elsewhere in the array - an accepted merge deleting content
        // nobody asked to touch. Matching by identity makes that structurally
        // impossible: each conflict is keyed by the item's real identity
        // (title/opponent/topic), so an unrelated shift elsewhere in the
        // array can never manifest as a conflict on this item.
        const scanArray = (arrName, labelName, tArr, lArr, keyProp) => {
            const tItems = tArr || [];
            const lItems = lArr || [];
            const allKeys = new Set([...tItems, ...lItems].map(item => item?.[keyProp]));

            allKeys.forEach(key => {
                const tItem = tItems.find(item => item?.[keyProp] === key);
                const lItem = lItems.find(item => item?.[keyProp] === key);
                if (isDiff(tItem, lItem)) {
                    const safeKey = String(key ?? 'untitled').replace(/[^a-zA-Z0-9]/g, '_');
                    addConflict(`${arrName}_${safeKey}`, `${labelName}: ${key || 'Untitled'}`, 'array_item', lItem, { arrName, key, keyProp }).options.push({ ticket: t, data: tItem });
                }
            });
        };

        scanArray('extras', 'Custom Tab', tDesc.extras, liveDesc.extras, 'title');
        scanArray('matchups', 'Matchup', tDesc.matchups, liveDesc.matchups, 'opponent');
        scanArray('counterplay', 'Counterplay', tDesc.counterplay, liveDesc.counterplay, 'topic');

        ['m1s', 'skills', 'specials'].forEach(cat => {
            const tMoves = tFrame[cat] || [];
            const lMoves = liveFrame[cat] || [];
            const allMoveIds = new Set([...tMoves.map(m=>m.id), ...lMoves.map(m=>m.id)]);

            allMoveIds.forEach(moveId => {
                const tMove = tMoves.find(m => m.id === moveId);
                const lMove = lMoves.find(m => m.id === moveId);
                const tStrat = (tDesc.moveStrategies || {})[moveId];
                const lStrat = (liveDesc.moveStrategies || {})[moveId];

                if (isDiff(tMove, lMove) || isDiff(tStrat, lStrat)) {
                    addConflict(`move_${cat}_${moveId}`, `Move: ${cat.toUpperCase()} / ${moveId}`, 'move', { move: lMove, cat: cat }, lStrat).options.push({
                        ticket: t,
                        data: { move: tMove, cat: cat },
                        stratData: tStrat
                    });
                }
            });
        });
    });

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

        // The merged ticket ships as a multi-scope delta, not a snapshot.
        // A snapshot is taken here, at compile time, and applied later, at
        // approval time - so every submission approved in that window is
        // silently overwritten by stale data. Emitting one scoped patch per
        // accepted conflict means approval injects exactly the sections that
        // were chosen and leaves everything else at whatever it is by then.
        //
        // 'multi' is not a new format: js/editor-core.js already batches a
        // contributor's independent edits this way, window.applyDeltaToData
        // unpacks it recursively (js/site_utils.js), and the diff, preview,
        // history and recent-changes views all branch on it already.
        const batchedDeltas = [];

        // applyDeltaToData's array scopes are singular; the compiler's are the
        // property names they live under.
        const DELTA_SCOPE_FOR_ARRAY = { extras: 'extra', matchups: 'matchup', counterplay: 'counterplay' };

        conflicts.forEach(c => {
            const selVal = document.getElementById(`compiler-sel-${c.sectionId}`).value;
            if (selVal === 'live') return;

            const chosenOpt = c.options.find(o => o.ticket.id === selVal);
            if (!chosenOpt) return;

            selectedTicketIds.add(selVal);
            contributors.add(chosenOpt.ticket.author_name);

            if (c.type === 'desc') {
                masterDesc[c.sectionId] = chosenOpt.data;
                batchedDeltas.push({ scope: c.sectionId, key: null, payload: chosenOpt.data });
            }
            else if (c.type === 'array_item') {
                // Identity-based, matching scanArray above - find by keyProp,
                // not position. chosenOpt.data being undefined means the
                // chosen ticket's version of this item is "deleted" (its
                // post-delta array had nothing for this identity), which
                // splice() now handles explicitly instead of silently
                // writing undefined into whatever happened to sit at a given
                // index.
                const { arrName, key, keyProp } = c.liveStratData;
                if (!masterDesc[arrName]) masterDesc[arrName] = [];
                const existingIdx = masterDesc[arrName].findIndex(item => item?.[keyProp] === key);
                if (chosenOpt.data === undefined) {
                    if (existingIdx > -1) masterDesc[arrName].splice(existingIdx, 1);
                } else if (existingIdx > -1) {
                    masterDesc[arrName][existingIdx] = chosenOpt.data;
                } else {
                    masterDesc[arrName].push(chosenOpt.data);
                }

                // undefined means the chosen ticket had no version of this item,
                // i.e. it deleted it. applyDeltaToData reads null as "delete";
                // undefined would drop out of the JSON payload entirely and
                // apply as a no-op, quietly resurrecting the deleted item.
                batchedDeltas.push({
                    scope: DELTA_SCOPE_FOR_ARRAY[arrName],
                    key,
                    payload: chosenOpt.data === undefined ? null : chosenOpt.data
                });
            }
            else if (c.type === 'move') {
                const cat = chosenOpt.data.cat;
                const moveData = chosenOpt.data.move;
                const stratData = chosenOpt.stratData;

                const prefix = `move_${cat}_`;
                const moveId = c.sectionId.substring(prefix.length);

                if (!masterFrame[cat]) masterFrame[cat] = [];
                const existingIdx = masterFrame[cat].findIndex(m => m.id === moveId);

                if (moveData) {
                    if (existingIdx > -1) masterFrame[cat][existingIdx] = moveData;
                    else masterFrame[cat].push(moveData);
                } else {
                    if (existingIdx > -1) masterFrame[cat].splice(existingIdx, 1);
                }

                if (!masterDesc.moveStrategies) masterDesc.moveStrategies = {};
                if (stratData) masterDesc.moveStrategies[moveId] = stratData;
                else delete masterDesc.moveStrategies[moveId];

                // Same {frame_data, desc_data} shape the editor's own move
                // deltas use, keyed "category::moveId" - applyDeltaToData
                // splits on "::" to find the category array.
                batchedDeltas.push({
                    scope: 'move',
                    key: `${cat}::${moveId}`,
                    payload: moveData ? { frame_data: moveData, desc_data: stratData || [] } : null
                });
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

        // Every contributor's changelog and evidence carries through, attributed.
        // This used to be replaced by a one-line synthetic summary, which threw
        // away the audit trail of who verified what and kept only the last
        // ticket's evidence - the exact thing a reviewer needs to judge a merge.
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

        // The merge is only as trustworthy as its least certain source, so take
        // the lowest rather than asserting "high" over someone's own "low".
        const mergedConfidence = qaSources.reduce((lowest, s) => {
            const rank = CONFIDENCE_RANK[s.qa.confidence];
            if (rank === undefined) return lowest;
            return (lowest === null || rank < CONFIDENCE_RANK[lowest]) ? s.qa.confidence : lowest;
        }, null) || 'medium';

        const payload = {
            // Kept as the legacy fallback, matching the shape editor-core.js's
            // buildPayload emits - delta_payload is what actually applies.
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
