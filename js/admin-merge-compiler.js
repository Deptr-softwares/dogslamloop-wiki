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

        conflicts.forEach(c => {
            const selVal = document.getElementById(`compiler-sel-${c.sectionId}`).value;
            if (selVal === 'live') return;

            const chosenOpt = c.options.find(o => o.ticket.id === selVal);
            if (!chosenOpt) return;

            selectedTicketIds.add(selVal);
            contributors.add(chosenOpt.ticket.author_name);

            if (c.type === 'desc') {
                masterDesc[c.sectionId] = chosenOpt.data;
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

        const payload = {
            desc_data: masterDesc,
            frame_data: masterFrame,
            is_delta: false,
            target_scope: null,
            target_key: null,
            author_id: window.currentUserId,
            author_name: finalAuthorName,
            status: 'ticket_open',
            qa_metadata: {
                changelog: `System Merge: Unified edits from ${contributors.size} contributors.`,
                confidence: "high",
                evidence: masterTicket.qa_metadata?.evidence || ""
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
