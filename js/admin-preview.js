/**
 * Dogslamloop Wiki - Admin Overseer: Preview (revision preview, pending/live/
 * diff view switching)
 *
 * switchVersionView is kept as one function rather than split further -
 * its diff-branch renderers (renderDiffBlock, applyInlineDiffToBlocks,
 * renderDeltaDiff, formatScopeName) are closures over this function's own
 * local variables (diffContainer, diffRenderQueue, rev), not top-level
 * functions; separating them into another file would mean actually
 * refactoring them into parameterized functions, not just moving code.
 */

// --- 3. THE PREVIEW & TICKET ENGINE ---
async function previewRevision(revId) {
    const rev = window.currentQueueData.find(r => r.id === revId);
    if (!rev) return;

    const { data: authorRoleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', rev.author_id);
    rev.author_roles = authorRoleData ? authorRoleData.map(r => r.role.toLowerCase()) : [];

    window.activePreviewRevId = rev.id;
    window.activePreviewCharId = rev.page_id;
    window.activePreviewPageType = rev.page_type || 'character';
    document.getElementById('preview-status-text').innerHTML = `REVIEWING: <strong class="admin-preview-status-highlight">${rev.page_id.toUpperCase()}</strong> (By ${window.escapeHtml(rev.author_name)})`;

    updateActionButtons(rev);
    document.getElementById('preview-nav-sidebar').classList.remove('hidden');
    document.getElementById('preview-tab-nav').classList.remove('hidden');

    // tab_settings is named explicitly because this is a column list, not a
    // `select('*')` - the reader and the editor both take the whole row and
    // would have picked the new column up for free, and this one would not.
    const { data: liveData } = await window.supabaseClient.from('page_data').select('desc_data, frame_data, tab_settings').eq('page_id', rev.page_id).single();
    window.currentLiveDescData = liveData ? liveData.desc_data : {};
    window.currentLiveFrameData = liveData ? liveData.frame_data : {};

    // Which optional tabs this page has, before the strip or the diff renders.
    // Per revision rather than once at boot: a reviewer works through a queue
    // of different pages in one session, so leaving the previous page's answer
    // in place would show a Techs tab on a character that has none.
    if (typeof window.applyOptionalTabsFromPageRow === 'function') {
        window.applyOptionalTabsFromPageRow(liveData);
    }

    if (rev.is_delta) {
        const { newDesc, newFrame } = window.applyDeltaToData(
            window.currentLiveDescData,
            window.currentLiveFrameData,
            rev.target_scope,
            rev.target_key,
            rev.delta_payload
        );
        window.currentPendingDescData = newDesc;
        window.currentPendingFrameData = newFrame;
    } else {
        window.currentPendingDescData = rev.desc_data || {};
        window.currentPendingFrameData = rev.frame_data || {};
    }

    // Character states, after both versions are in memory and before anything
    // renders: picks which state the preview opens on, draws the state
    // toggle, and injects the Ultimate tab if this revision has one. See
    // js/admin-modes.js for why the preview needs its own copy of this rather
    // than js/character_modes.js.
    if (typeof window.initPreviewStates === 'function') window.initPreviewStates(rev);

    // --- Trigger Document Explorer Sidebar rebuild ---
    if (typeof window.updateAdminSidebar === 'function') window.updateAdminSidebar();

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.classList.remove('hidden');

    // A media clip and a revision share this pane, so opening one puts the
    // other away. Without this a reviewer picks a revision and gets the clip
    // they were last looking at, still sitting on top of it.
    if (typeof window.closeMediaPreview === 'function') window.closeMediaPreview();

    calculateTabDiffs(rev);

    if (window.activeChatChannel) { window.supabaseClient.removeChannel(window.activeChatChannel); }
    window.activeTypers.clear();
    if(typeof updateTypingText === 'function') updateTypingText();

    if (rev.status === 'ticket_open') {
        const ticketWorkspace = document.getElementById('ticket-workspace');
        ticketWorkspace.classList.remove('hidden');
        renderTicketWorkspace(rev, (rev.author_id === window.currentUserId), (rev.supporters || []).includes(window.currentUserId), (rev.opposers || []).includes(window.currentUserId));

        window.activeChatChannel = window.supabaseClient.channel('ticket-' + rev.id)
            .on('broadcast', { event: 'typing' }, payload => {
                if(payload.payload.user !== window.currentUsername) {
                    window.activeTypers.set(payload.payload.user, Date.now());
                    if(typeof updateTypingText === 'function') updateTypingText();
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_revisions', filter: 'id=eq.' + rev.id }, payload => {
                const updatedRev = payload.new;
                const localRev = window.currentQueueData.find(r => r.id === rev.id);

                if (localRev) {
                    localRev.supporters = updatedRev.supporters || [];
                    localRev.opposers = updatedRev.opposers || [];
                    localRev.ticket_chat = updatedRev.ticket_chat || [];

                    if (window.activePreviewRevId === rev.id) {
                        renderTicketWorkspace(localRev, (localRev.author_id === window.currentUserId), localRev.supporters.includes(window.currentUserId), localRev.opposers.includes(window.currentUserId));
                        updateActionButtons(localRev);
                    }
                }
            })
            .subscribe();
    } else {
        document.getElementById('ticket-workspace').classList.add('hidden');
    }

    const contentArea = document.getElementById('preview-content-area');
    contentArea.classList.add('active');

    let initMode = 'pending';
    if (rev.is_delta) {
        initMode = 'diff';

        // A merged or batched ticket carries several scopes, so there is no
        // single tab to open onto - land on the first one it touched and let
        // the strip's changed-tab markers show the rest. calculateTabDiffs
        // (js/admin-diff.js) already resolves every scope in a 'multi'
        // payload to its tab, so reuse that rather than re-deriving it.
        const unwrapped = window.unwrapModeDelta(rev.target_scope, rev.target_key);

        let activeTabId = null;
        if (rev.target_scope === 'multi') {
            activeTabId = (window.changedTabs || [])[0] || 'overview';
        } else if (window.getKeyedSectionByScope(unwrapped.scope)) {
            // Read from the vocabulary, not built by appending an 's'. That
            // turned 'counterplay' into 'counterplays' - not a tab - so a
            // counterplay ticket never opened onto its own tab and the
            // reviewer landed on Overview instead.
            activeTabId = window.getKeyedSectionByScope(unwrapped.scope).tab;
        } else if (unwrapped.scope === 'move') {
            activeTabId = unwrapped.key.split('::')[0];
        } else {
            activeTabId = 'overview';
        }

        window.setActiveRevisionTab(activeTabId);
    }

    switchVersionView(initMode);

    // --- QOL: AUTO-SCROLL TO TICKET WORKSPACE ---
    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        const actionBtns = document.getElementById('preview-action-buttons');
        // If there's an open ticket chat, snap to it. Otherwise, snap to the review buttons.
        if (workspace && !workspace.classList.contains('hidden')) {
            workspace.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (actionBtns) {
            actionBtns.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 150);
}

// --- VERSION COMPARISON ENGINE ---
async function switchVersionView(mode) {
    // Remembered so switching character state can redraw whichever comparison
    // the reviewer was already in (js/admin-modes.js) instead of snapping
    // them back to a default.
    window.activePreviewViewMode = mode;

    // Page History (js/admin-history.js) is a 4th, independently-toggled
    // pane rather than a mode in this function's own pending/live/diff
    // state machine (see the file header comment on why this function is
    // kept whole) - hide it and reset its button whenever any of the three
    // original modes gets picked, so switching away from history behaves
    // consistently no matter which of the three buttons was clicked.
    const historyContainer = document.getElementById('page-history-container');
    if (historyContainer) historyContainer.classList.add('hidden');
    const historyBtn = document.getElementById('btn-view-history');
    if (historyBtn) historyBtn.className = 'btn-sys btn-sys-regular version-toggle-btn';

    const btns = { 'pending': document.getElementById('btn-view-pending'), 'live': document.getElementById('btn-view-live'), 'diff': document.getElementById('btn-view-diff') };
    Object.values(btns).forEach(b => {
        if(!b) return;
        b.className = 'btn-sys btn-sys-regular version-toggle-btn';
    });

    if(btns[mode]) {
        if (mode === 'pending') btns[mode].classList.add('btn-sys-blue');
        if (mode === 'live') btns[mode].classList.add('btn-sys-green');
        if (mode === 'diff') btns[mode].classList.add('btn-sys-purple');
    }

    // The renderers narrow to a character state through this, exactly as the
    // live page does. currentEditorDescData is handed over already narrowed
    // (js/description.js treats an editor-supplied object as final), while the
    // frame cache stays whole because loadMoveSection resolves it itself.
    const previewMode = window.activePreviewMode || null;
    window.activeCharacterMode = previewMode;
    // resolveModeDesc rather than reaching into modeData directly, so the
    // preview inherits the one documented exception: a state that has not
    // overridden the portrait shows the character's, not an empty box. Reading
    // the bucket raw showed a state with no profile of its own as a page with
    // no character on it, which is not what approving it would produce.
    const narrow = (full) => (typeof window.resolveModeDesc === 'function'
        ? window.resolveModeDesc(full || {}, previewMode)
        : (window.isBaseMode(previewMode) ? full : ((full && full.modeData) || {})[previewMode] || {}));

    if (mode === 'pending') {
        window.currentEditorDescData = narrow(window.currentPendingDescData);
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentPendingFrameData;
    } else if (mode === 'live') {
        window.currentEditorDescData = narrow(window.currentLiveDescData);
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData[window.activePreviewCharId] = window.currentLiveFrameData;
    }
    if (mode === 'diff') {
        // Universal clear for both Character AND System dynamically generated tabs
        document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => {
            el.classList.add('hidden');
        });
        // Character-type revisions reuse admin.html's pre-existing static
        // #tab-* divs, which never carry the .tab-content/.wiki-tab-content
        // class the line above keys off (only dynamically-created
        // system-type tabs do - see js/description.js), so entering diff
        // mode never actually hid them: the old pending/live content and
        // the new diff comparison rendered stacked on top of each other.
        document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => {
            el.classList.add('hidden');
        });

        let diffContainer = document.getElementById('admin-diff-container');
        if (!diffContainer) {
            diffContainer = document.createElement('div');
            diffContainer.id = 'admin-diff-container';
            // .tab-content alone (not paired with .wiki-tab-content, unlike
            // js/description.js's unrelated system-page tab containers this
            // was copied from) - .tab-content is what the hide/show sweep
            // (this file, admin-preview.js:148/491) actually needs to key
            // off; .wiki-tab-content additionally carries a display:flex;
            // flex-wrap:wrap layout rule (style/Layout.css) that was never
            // wanted here and forced the title/location-label/diff-content
            // children into a wrapping row instead of normal vertical
            // stacking - a real bug, found via a live screenshot.
            diffContainer.className = 'tab-content';
            const mainArea = document.querySelector('.main-content-area');
            if (mainArea) mainArea.appendChild(diffContainer);
        }

        diffContainer.innerHTML = `<h2 class="section-title diff-view-title">REVISION COMPARISON</h2>`;
        diffContainer.classList.remove('hidden');

        const rev = window.currentQueueData.find(r => r.id === window.activePreviewRevId);
        if (!rev) return;

        let diffRenderQueue = [];

        const formatScopeName = (scope) => {
            const map = {
                'move': 'Move Strategy & Frames',
                'extra': 'Custom Tab',
                'profile': 'Profile Metadata',
                'playstyle': 'Playstyle',
                'overview': 'Overview',
                'strategy': 'General Strategy'
            };
            // Keyed sections name themselves (js/character_tabs.js), so a new
            // one shows the reviewer its real name rather than a raw scope.
            window.getKeyedSections().forEach(s => { map[s.scope] = s.entryLabel; });
            (window.FIXED_BLOCK_SECTIONS || []).forEach(s => { map[s.scope] = s.label; });
            Object.assign(map, {
                'gallery_item': 'Gallery Item',
                'gallery_intro': 'Introduction',
                'intro': 'Introduction',
                'notes': 'Notes',
                'tool_config': 'Tool Setup',
            });
            return map[scope] || scope;
        };

        const fixedSectionByScope = (scope) =>
            (window.FIXED_BLOCK_SECTIONS || []).find(s => s.scope === scope) || null;

        // The scopes a system or tier list page submits. They name a tab of the
        // page itself rather than one from the character vocabulary, so the
        // breadcrumb has to read their labels out of the data.
        const SYSTEM_SCOPES = ['system_section', 'system_tab', 'tierlist_tiers', 'tierlist_changelog'];

        // WHERE THIS CHANGE IS, in one shape for every page type.
        //
        // Character pages got a breadcrumb and system, tool, gallery and tier
        // list pages kept "[Tab] ➔ Section" baked into the block title - so the
        // same reviewer read two different vocabularies depending on which
        // queue item they opened, and only one of them named a place.
        const renderLocation = (crumbs) => {
            const parts = crumbs
                .filter(Boolean)
                .map(s => (window.escapeHtml ? window.escapeHtml(String(s)) : String(s)));
            if (!parts.length) return;
            diffContainer.innerHTML += `<div class="diff-location-label">`
                + `<span class="diff-location-lead">Changed:</span> `
                + parts.join(' <span class="diff-crumb-sep">›</span> ')
                + `</div>`;
        };

        // The Combo List's rows. Paired by POSITION, because that is what the
        // author edits - a combo table is an ordered list, and the route text
        // is the thing most likely to change, so keying on it would report
        // every edited combo as one removal plus one addition.
        //
        // Each changed row is named by its route rather than by index alone,
        // since the route is how an author recognises which combo they wrote.
        const renderComboRowsDiff = (section, oldRows, newRows) => {
            const max = Math.max(oldRows.length, newRows.length);
            let rendered = 0;

            for (let i = 0; i < max; i++) {
                const o = oldRows[i];
                const n = newRows[i];
                if (JSON.stringify(o) === JSON.stringify(n)) continue;

                const route = (n && n.combo) || (o && o.combo) || `Row ${i + 1}`;
                rendered++;

                if (o === undefined) renderDiffBlock(`Combo Added: ${route}`, null, n);
                else if (n === undefined) renderDiffBlock(`Combo Removed: ${route}`, o, null);
                else renderDiffBlock(`Combo: ${route}`, o, n);
            }

            // The table changed but no row did - a reorder, or the starter was
            // renamed. Saying so beats an empty panel that reads as a bug.
            if (!rendered && JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
                renderDiffBlock(`${section.entryLabel}: order changed`, oldRows, newRows, 'json');
            }
        };

        if (rev.is_delta) {
            const renderDeltaDiff = (rawScope, rawKey, payload) => {
                // A character-state edit wraps one of the scopes below, and the
                // live side it has to be compared against lives in modeData -
                // not at the top level. Comparing against the base kit would
                // show the reviewer a diff wrong in both directions: additions
                // that already exist, and deletions that never happened.
                const { modeId, scope, key } = window.unwrapModeDelta(rawScope, rawKey);
                const liveDesc = modeId ? ((window.currentLiveDescData.modeData || {})[modeId] || {}) : window.currentLiveDescData;
                const liveFrame = modeId ? ((window.currentLiveFrameData.modeData || {})[modeId] || {}) : window.currentLiveFrameData;
                const where = modeId ? modeId.toUpperCase() + ' / ' : '';

                // `key` was interpolated straight into `key.replace(...)`, which
                // threw on a null key and took the whole batch render down with
                // it - see the forEach below. The merge compiler emits null for
                // a base-kit section conflict where the editor emits 'full', so
                // every merged ticket containing one showed only the entries
                // ahead of it. Tickets already in the queue still carry null
                // keys, so this coercion is what makes them reviewable at all.
                // WHERE THIS CHANGE IS, in the words the reviewer sees on the
                // page itself. It used to read
                //   Suggested Edit Location: [ COMBOINTRO ➔ FULL ]
                // which names a delta scope and an internal placeholder - two
                // things that appear nowhere in the wiki. A reviewer cannot act
                // on that; they have to go and find what it means.
                //
                // Now: the TAB it lives under, the section's own name, and the
                // entry, e.g. "Combos › Read First". 'full' means the whole
                // section rather than one entry, so it is dropped rather than
                // printed - there is nothing after the section name to name.
                const tabLabels = window.getCharacterTabLabels ? window.getCharacterTabLabels() : {};
                const owningTab = (window.getKeyedSectionByScope && window.getKeyedSectionByScope(scope))
                    || fixedSectionByScope(scope);
                let tabName = owningTab ? tabLabels[owningTab.tab] : null;
                if (!tabName && ['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) {
                    tabName = tabLabels.overview;
                }
                if (!tabName && scope === 'move' && key) tabName = tabLabels[String(key).split('::')[0]];

                const rawKeyLabel = key === null || key === undefined ? 'full' : String(key);
                // A move's key is "skills::explosion" - the tab half is already
                // shown, so only the move itself is worth repeating.
                const entryName = rawKeyLabel === 'full' ? '' : rawKeyLabel.split('::').pop();

                // A system page's tabs are the PAGE'S OWN, not the character
                // vocabulary, so their names have to be read from the data.
                // Keys are derived, so the label is the human half and the key
                // is only how the two sides find each other.
                if (SYSTEM_SCOPES.includes(scope)) {
                    const tabKey = scope === 'system_section'
                        ? window.splitSystemKey(key).tabKey : String(key || '');
                    const tab = window.findSystemTab(liveDesc, tabKey);
                    const tabName = tab ? (tab.tabLabel || tab.tabId || tabKey) : tabKey;

                    let leaf = '';
                    if (scope === 'system_section') {
                        const found = window.indexSystemSections(liveDesc).find(e => e.key === key);
                        leaf = (payload && payload.sectionTitle)
                            || (found && found.section && found.section.sectionTitle)
                            || window.splitSystemKey(key).secKey;
                    } else if (scope === 'system_tab') leaf = 'Tab settings';
                    else if (scope === 'tierlist_tiers') leaf = 'Tiers';
                    else if (scope === 'tierlist_changelog') leaf = 'Changelog';

                    renderLocation([tabName, leaf]);
                } else {
                    renderLocation([where.replace(/ \/ $/, ''), tabName, formatScopeName(scope), entryName]);
                }

                if (['profile', 'playstyle', 'overview', 'strategy'].includes(scope)) {
                    renderDiffBlock(formatScopeName(scope), liveDesc[scope], payload);
                }
                else if (scope === 'extra') {
                    const oldExtra = liveDesc.extras?.find(e => e.title === key) || {};
                    if (payload === null) {
                        renderDiffBlock('Custom Tab Deleted', oldExtra, null, 'json');
                    } else {
                        if (oldExtra.title !== payload.title) renderDiffBlock('Custom Tab Title', { title: oldExtra.title }, { title: payload.title });
                        renderDiffBlock('Custom Tab Strategy', oldExtra.content || [], payload.content || []);
                    }
                }
                else if (scope === 'matchup') {
                    const oldMu = liveDesc.matchups?.find(m => m.opponent === key) || {};
                    if (payload === null) {
                        renderDiffBlock('Matchup Deleted', oldMu, null, 'json');
                    } else {
                        renderDiffBlock('Matchup Metadata', { opponent: oldMu.opponent, tier: oldMu.tier }, { opponent: payload.opponent, tier: payload.tier });
                        renderDiffBlock('Matchup Strategy', oldMu.content || [], payload.content || []);
                    }
                }
                // Every other keyed section, matchups aside - that branch above
                // stays written out because its metadata pairs opponent with
                // tier and reads better named. This covers counterplay, the new
                // Starter Guide, and anything added to the vocabulary later,
                // which otherwise renders as a raw JSON blob to the reviewer.
                else if (window.getKeyedSectionByScope(scope)) {
                    const section = window.getKeyedSectionByScope(scope);
                    const oldEntry = liveDesc[section.field]?.find(e => e[section.keyField] === key) || {};
                    if (payload === null) {
                        renderDiffBlock(`${section.entryLabel} Deleted`, oldEntry, null, 'json');
                    } else {
                        const meta = (e) => {
                            const m = { [section.keyField]: e[section.keyField] };
                            if (section.metaField) m[section.metaField] = e[section.metaField];
                            return m;
                        };
                        renderDiffBlock(`${section.entryLabel} Metadata`, meta(oldEntry), meta(payload));

                        // A section whose entries hold ROWS rather than blocks -
                        // the Combo List. Diffing `.content` here compared two
                        // empty arrays and returned before rendering anything,
                        // so every combo-table edit reviewed as no change at
                        // all while applying perfectly.
                        if (section.rowsField) {
                            renderComboRowsDiff(
                                section,
                                oldEntry[section.rowsField] || [],
                                payload[section.rowsField] || []
                            );
                        } else {
                            renderDiffBlock(`${section.entryLabel} Notes`, oldEntry.content || [], payload.content || []);
                        }
                    }
                }
                else if (scope === 'move') {
                    const [cat, moveId] = key.split('::');
                    const oldFrame = liveFrame[cat]?.find(m => m.id === moveId) || {};
                    const oldDesc = liveDesc.moveStrategies?.[moveId] || [];

                    if (payload === null) {
                        renderDiffBlock(`Move Deleted: ${moveId}`, oldFrame, null, 'json');
                    } else {
                        const newFrame = payload.frame_data || {};
                        renderDiffBlock('Move Stats & Frames', oldFrame, newFrame);
                        const newDesc = payload.desc_data || [];
                        renderDiffBlock('Move Strategy Text', oldDesc, newDesc);
                    }
                }
                // A fixed block section - "Read First" on the Combos tab, and
                // anything added to FIXED_BLOCK_SECTIONS later. Declared in
                // js/character_tabs.js, so this needs no per-section branch.
                else if (fixedSectionByScope(scope)) {
                    const section = fixedSectionByScope(scope);
                    renderDiffBlock(section.label, liveDesc[section.field] || [], payload || []);
                }
                // Gallery pages. One delta per item, keyed by name.
                else if (scope === 'gallery_item') {
                    const oldItem = liveDesc.items?.find(i => i.name === key) || {};
                    if (payload === null) {
                        renderDiffBlock(`Gallery Item Removed: ${key}`, oldItem, null, 'json');
                    } else {
                        renderDiffBlock('Gallery Item', oldItem, payload);
                    }
                }
                // The prose above a gallery, the notes below one, and a tool
                // page's configuration. All whole-value replacements.
                else if (scope === 'gallery_intro' || scope === 'intro') {
                    renderDiffBlock('Introduction', liveDesc.intro || [], payload || []);
                }
                else if (scope === 'notes') {
                    renderDiffBlock('Notes', liveDesc.notes || [], payload || []);
                }
                else if (scope === 'tool_config') {
                    renderDiffBlock('Tool Configuration', liveDesc.tool || {}, payload);
                }
                // One section of a system page. The prose diffs as prose; the
                // layout fields diff as fields, so a reviewer can tell "the
                // wording changed" from "somebody made it half-width".
                else if (scope === 'system_section') {
                    const found = window.indexSystemSections(liveDesc).find(e => e.key === key);
                    const before = (found && found.section) || {};
                    const title = (payload && payload.sectionTitle) || before.sectionTitle || 'Section';

                    if (payload === null) {
                        renderDiffBlock(`Section Removed: ${title}`, before, null, 'json');
                    } else {
                        if (before.sectionTitle !== payload.sectionTitle) {
                            renderDiffBlock('Section Name', { sectionTitle: before.sectionTitle }, { sectionTitle: payload.sectionTitle });
                        }
                        const layoutOf = (s) => ({ layout: s.layout, width: s.width, alignment: s.alignment });
                        renderDiffBlock('Layout', layoutOf(before), layoutOf(payload));
                        renderDiffBlock(title, before.blocks || [], payload.blocks || [], 'system-content');
                    }
                }
                // A tab's own metadata, and the ORDER of its sections. Order
                // arrives as a list of keys, so it is rendered as the names
                // those keys resolve to rather than as the keys themselves.
                else if (scope === 'system_tab') {
                    const tab = window.findSystemTab(liveDesc, key) || {};
                    if (payload === null) {
                        renderDiffBlock('Tab Removed', { tabLabel: tab.tabLabel }, null, 'json');
                    } else {
                        const meta = (t) => {
                            const m = {};
                            Object.keys(t || {}).forEach(k => {
                                if (k !== 'sections' && k !== 'tiers' && k !== 'changelog' && k !== 'order') m[k] = t[k];
                            });
                            return m;
                        };
                        renderDiffBlock('Tab Settings', meta(tab), meta(payload));

                        if (Array.isArray(payload.order)) {
                            const nameFor = (secKey) => {
                                const hit = window.indexSystemSections(liveDesc)
                                    .find(e => e.tabKey === key && e.secKey === secKey);
                                return (hit && hit.section && hit.section.sectionTitle) || secKey;
                            };
                            const beforeOrder = window.indexSystemSections(liveDesc)
                                .filter(e => e.tabKey === key).map(e => e.secKey);
                            renderDiffBlock('Section Order',
                                { order: beforeOrder.map(nameFor) },
                                { order: payload.order.map(nameFor) });
                        }
                    }
                }
                else if (scope === 'tierlist_tiers' || scope === 'tierlist_changelog') {
                    const tab = window.findSystemTab(liveDesc, key) || {};
                    const field = scope === 'tierlist_tiers' ? 'tiers' : 'changelog';
                    renderDiffBlock(field === 'tiers' ? 'Tiers' : 'Changelog', tab[field] || [], payload || [], 'json');
                }
                // NOTHING MATCHED, AND THAT MUST NEVER BE SILENT.
                //
                // Until this existed, an unhandled scope rendered its location
                // label and no diff at all - so the reviewer saw a heading
                // saying something changed, nothing underneath it, and had no
                // way to tell that apart from "nothing changed here". Seven
                // scopes were in that state: comboIntro, comboTable,
                // gallery_item, gallery_intro, intro, notes and tool_config.
                //
                // Approving what you were never shown is the same failure the
                // merged-ticket bug had, and it is worse here because it was
                // the STEADY state rather than an edge case. A raw dump is a
                // poor diff; it is still infinitely better than a blank space,
                // and the banner says plainly that this is the fallback.
                else {
                    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s));
                    diffContainer.innerHTML += `<div class="diff-unknown-scope">`
                        + `This change is shown in its raw form because the review screen has no`
                        + ` purpose-built view for "${esc(scope)}" yet. It is a real change and`
                        + ` it will be applied if you approve it.`
                        + `</div>`;
                    renderDiffBlock(formatScopeName(scope), null, payload, 'json');
                }
            };

            // Recursively execute the render function for Batched multi-tickets!
            if (rev.target_scope === 'multi') {
                diffContainer.innerHTML += `<div class="diff-batch-banner">BATCHED MULTI-PAYLOAD DETECTED (${rev.delta_payload.length} EDITS)</div>`;

                // One entry must not be able to hide the others. This loop was
                // a bare forEach, so a single throw inside renderDeltaDiff
                // abandoned every remaining edit - the banner still counted
                // them, so the ticket read as "5 EDITS" while showing 2, with
                // nothing to say the other 3 existed. A reviewer approving that
                // is approving changes they were never shown.
                rev.delta_payload.forEach((edit, i) => {
                    try {
                        renderDeltaDiff(edit.scope, edit.key, edit.payload);
                    } catch (err) {
                        console.error('[Diff] Edit', i + 1, 'failed to render:', err, edit);
                        const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s));
                        diffContainer.innerHTML += `<div class="diff-location-label">`
                            + `Edit ${i + 1} of ${rev.delta_payload.length} could not be displayed`
                            + ` (scope: ${esc(edit && edit.scope)}). It is still part of this ticket.`
                            + `</div>`;
                    }
                });
            } else if (rev.target_scope === 'system_data') {
                const oldTabs = window.currentLiveDescData.tabs || [];
                const newTabs = rev.delta_payload.tabs || [];
                const allTabIds = Array.from(new Set([...oldTabs.map(t=>t.tabId || t.id), ...newTabs.map(t=>t.tabId || t.id)]));

                allTabIds.forEach(tabId => {
                    const oTab = oldTabs.find(t => (t.tabId || t.id) === tabId) || { sections: [] };
                    const nTab = newTabs.find(t => (t.tabId || t.id) === tabId) || { sections: [] };
                    const tabLabel = nTab.tabLabel || nTab.label || oTab.tabLabel || oTab.label || tabId;

                    // The location goes in the breadcrumb, not into every block
                    // title. It used to read "[Basic Fundamentals] ➔
                    // Introduction" inside the heading itself, which put the
                    // tab name on screen once per block and still never said
                    // which page type it belonged to.
                    if ((oTab.tabLabel || oTab.label) !== (nTab.tabLabel || nTab.label)) {
                         renderLocation([tabLabel, 'Tab name']);
                         renderDiffBlock('Tab Name', { label: oTab.tabLabel || oTab.label }, { label: nTab.tabLabel || nTab.label });
                    }

                    if (window.activePreviewPageType === 'tierlist') {
                         if (JSON.stringify(oTab.tiers || []) !== JSON.stringify(nTab.tiers || [])) {
                              renderLocation([tabLabel, 'Tiers']);
                              renderDiffBlock('Tiers', oTab.tiers || [], nTab.tiers || [], 'json');
                         }
                         if (JSON.stringify(oTab.changelog || []) !== JSON.stringify(nTab.changelog || [])) {
                              renderLocation([tabLabel, 'Changelog']);
                              renderDiffBlock('Changelog', oTab.changelog || [], nTab.changelog || [], 'json');
                         }
                    } else {
                         const oSecs = oTab.sections || [];
                         const nSecs = nTab.sections || [];
                         const secMax = Math.max(oSecs.length, nSecs.length);

                         for(let i=0; i < secMax; i++) {
                              const oSec = oSecs[i] || {};
                              const nSec = nSecs[i] || {};
                              const secTitle = nSec.sectionTitle || oSec.sectionTitle || `Section ${i+1}`;
                              const layoutChanged = oSec.layout !== nSec.layout
                                  || oSec.width !== nSec.width || oSec.alignment !== nSec.alignment;
                              const blocksChanged = JSON.stringify(oSec.blocks || []) !== JSON.stringify(nSec.blocks || []);
                              if (!layoutChanged && !blocksChanged) continue;

                              renderLocation([tabLabel, secTitle]);
                              if (layoutChanged) {
                                   renderDiffBlock('Layout',
                                       { layout: oSec.layout, width: oSec.width, alignment: oSec.alignment },
                                       { layout: nSec.layout, width: nSec.width, alignment: nSec.alignment }
                                   );
                              }
                              if (blocksChanged) renderDiffBlock(secTitle, oSec.blocks || [], nSec.blocks || [], 'system-content');
                         }
                    }
                });
            } else {
                renderDeltaDiff(rev.target_scope, rev.target_key, rev.delta_payload);
            }
        } else {
            if (window.changedTabs.length === 0) {
                diffContainer.innerHTML += `<p class="diff-no-changes">No changes detected.</p>`;
                return;
            }
            window.changedTabs.forEach(tab => {
                const oldTab = getTabData(tab, 'live') || {};
                const newTab = getTabData(tab, 'pending') || {};

                if (tab === 'overview') {
                    renderDiffBlock('Profile Metadata', oldTab.profile, newTab.profile);
                    renderDiffBlock('Playstyle Details', oldTab.playstyle, newTab.playstyle);
                    renderDiffBlock('Character Overview', oldTab.overview, newTab.overview);
                    renderDiffBlock('General Strategy', oldTab.strategy, newTab.strategy);

                    const oldExt = oldTab.extras || [];
                    const newExt = newTab.extras || [];
                    const extMax = Math.max(oldExt.length, newExt.length);
                    for (let i = 0; i < extMax; i++) {
                        const oT = oldExt[i]?.title; const nT = newExt[i]?.title;
                        if (oT !== nT) renderDiffBlock(`Custom Tab Title (${i + 1})`, { title: oT }, { title: nT });
                        renderDiffBlock(`Custom Tab Strategy: ${nT || oT || i}`, oldExt[i]?.content || [], newExt[i]?.content || []);
                    }
                } else if (tab === 'matchups') {
                    const oldMu = Array.isArray(oldTab) ? oldTab : [];
                    const newMu = Array.isArray(newTab) ? newTab : [];
                    const muMax = Math.max(oldMu.length, newMu.length);
                    for (let i = 0; i < muMax; i++) {
                        const oM = oldMu[i]?.opponent; const nM = newMu[i]?.opponent;
                        if (oM !== nM || oldMu[i]?.tier !== newMu[i]?.tier) {
                            renderDiffBlock(`Matchup Metadata (${i + 1})`, { opponent: oM, tier: oldMu[i]?.tier }, { opponent: nM, tier: newMu[i]?.tier });
                        }
                        renderDiffBlock(`Matchup Strategy: ${nM || oM || 'Unknown'}`, oldMu[i]?.content || [], newMu[i]?.content || []);
                    }
                } else if (window.getKeyedSectionByTab(tab)) {
                    // Counterplay, Starter Guide, and anything keyed added
                    // later. Matchups keeps its own branch above.
                    const section = window.getKeyedSectionByTab(tab);
                    const oldList = Array.isArray(oldTab) ? oldTab : [];
                    const newList = Array.isArray(newTab) ? newTab : [];
                    const max = Math.max(oldList.length, newList.length);
                    for (let i = 0; i < max; i++) {
                        const oK = oldList[i]?.[section.keyField];
                        const nK = newList[i]?.[section.keyField];
                        const oMeta = section.metaField ? oldList[i]?.[section.metaField] : undefined;
                        const nMeta = section.metaField ? newList[i]?.[section.metaField] : undefined;
                        if (oK !== nK || oMeta !== nMeta) {
                            renderDiffBlock(`${section.entryLabel} Metadata (${i + 1})`,
                                { [section.keyField]: oK, ...(section.metaField ? { [section.metaField]: oMeta } : {}) },
                                { [section.keyField]: nK, ...(section.metaField ? { [section.metaField]: nMeta } : {}) });
                        }
                        renderDiffBlock(`${section.entryLabel} Strategy: ${nK || oK || 'Unknown'}`,
                            oldList[i]?.content || [], newList[i]?.content || []);
                    }
                }
                else if (window.FRAME_MOVE_CATEGORIES.includes(tab)) {
                    const oldMoves = Array.isArray(oldTab) ? oldTab : [];
                    const newMoves = Array.isArray(newTab) ? newTab : [];
                    const allMoveIds = Array.from(new Set([...oldMoves.map(m=>m.id), ...newMoves.map(m=>m.id)]));

                    // Narrowed to the state on screen, like getTabData above
                    // it. Reading the top level here compared a state's move
                    // strategies against the base kit's, which reported edits
                    // in both directions that nobody had made.
                    const scopedDesc = (full) => (typeof window.resolveModeDesc === 'function'
                        ? window.resolveModeDesc(full || {}, window.activePreviewMode || null)
                        : (full || {}));

                    allMoveIds.forEach(mId => {
                        const oM = oldMoves.find(m => m.id === mId) || {};
                        const nM = newMoves.find(m => m.id === mId) || {};
                        if (JSON.stringify(oM) !== JSON.stringify(nM)) {
                            renderDiffBlock(`Move Stats & Frames (${mId})`, oM, nM);
                        }

                        const oStrat = scopedDesc(window.currentLiveDescData).moveStrategies?.[mId] || [];
                        const nStrat = scopedDesc(window.currentPendingDescData).moveStrategies?.[mId] || [];
                        if (JSON.stringify(oStrat) !== JSON.stringify(nStrat)) {
                            renderDiffBlock(`Move Strategy Text (${mId})`, oStrat, nStrat);
                        }
                    });
                }
            });
        }

        // --- CORE DIFF RENDERER ---
        function renderDiffBlock(title, oldData, newData, context = '') {
            const oldStr = JSON.stringify(oldData || null);
            const newStr = JSON.stringify(newData || null);
            if (oldStr === newStr) return;

            const safeId = title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 10000);

            if (Array.isArray(oldData) || Array.isArray(newData)) {
                const oldBlocks = Array.isArray(oldData) ? oldData : [];
                const newBlocks = Array.isArray(newData) ? newData : [];

                const diffBlockContent = (b, oldB, newB) => {
                    if (b.type === 'paragraph' || b.type === 'heading' || b.type === 'callout') {
                        let oldText = Array.isArray(oldB.content) ? oldB.content.join('<br>') : (oldB.content || '');
                        let newText = Array.isArray(newB.content) ? newB.content.join('<br>') : (newB.content || '');
                        b.content = window.diffTextLCS(oldText, newText);
                        if (b.type === 'callout') b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                    }
                    else if (b.type === 'list') {
                        const oldItems = oldB.items || [];
                        const newItems = newB.items || [];
                        if (!b.items) b.items = [];
                        const maxLen = Math.max(oldItems.length, newItems.length);
                        for (let j = 0; j < maxLen; j++) {
                            b.items[j] = window.diffTextLCS(oldItems[j] || '', newItems[j] || '');
                        }
                    }
                    else if (b.type === 'combo') {
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        const maxLen = Math.max(oldSeq.length, newSeq.length);
                        for (let j = 0; j < maxLen; j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.note = window.diffTextLCS(oldB.note || '', newB.note || '');
                    }
                    else if (b.type === 'table') {
                        const oldHeaders = oldB.headers || [];
                        const newHeaders = newB.headers || [];
                        if (!b.headers) b.headers = [];
                        const hMax = Math.max(oldHeaders.length, newHeaders.length);
                        for (let j = 0; j < hMax; j++) {
                            b.headers[j] = window.diffTextLCS(oldHeaders[j] || '', newHeaders[j] || '');
                        }

                        const oldRows = oldB.rows || [];
                        const newRows = newB.rows || [];
                        if (!b.rows) b.rows = [];
                        const rMax = Math.max(oldRows.length, newRows.length);
                        for (let r = 0; r < rMax; r++) {
                            if (!b.rows[r]) b.rows[r] = [];
                            const oCols = oldRows[r] || [];
                            const nCols = newRows[r] || [];
                            const cMax = Math.max(oCols.length, nCols.length);
                            for (let c = 0; c < cMax; c++) {
                                b.rows[r][c] = window.diffTextLCS(oCols[c] || '', nCols[c] || '');
                            }
                        }
                    }
                    else if (b.type === 'accordion' || b.type === 'details') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                    }
                    // A combo card nests like an accordion, plus its own
                    // fields. Missing this means the reviewer sees the card
                    // unchanged while its route or damage was rewritten.
                    else if (b.type === 'theorybox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.oneliner = window.diffTextLCS(oldB.oneliner || '', newB.oneliner || '');
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.difficulty = window.diffTextLCS(oldB.difficulty || '', newB.difficulty || '');
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        for (let j = 0; j < Math.max(oldSeq.length, newSeq.length); j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                    }

                    if (b.caption !== undefined) b.caption = window.diffTextLCS(oldB.caption || '', newB.caption || '');
                    if (b.author !== undefined) b.author = window.diffTextLCS(oldB.author || '', newB.author || '');
                };

                const applyInlineDiffToBlocks = (oldArr, newArr) => {
                    const diffedBlocks = [];
                    const maxLen = Math.max((oldArr || []).length, (newArr || []).length);

                    for (let i = 0; i < maxLen; i++) {
                        const oldB = oldArr[i] || {};
                        const newB = newArr[i] || null;

                        if (newB && oldB.type && oldB.type !== newB.type) {
                            let delB = JSON.parse(JSON.stringify(oldB));
                            diffBlockContent(delB, oldB, {});
                            diffedBlocks.push(delB);

                            let addB = JSON.parse(JSON.stringify(newB));
                            diffBlockContent(addB, {}, newB);
                            diffedBlocks.push(addB);
                            continue;
                        }

                        let b = newB ? JSON.parse(JSON.stringify(newB)) : JSON.parse(JSON.stringify(oldB));
                        diffBlockContent(b, oldB, newB || {});
                        diffedBlocks.push(b);
                    }
                    return diffedBlocks;
                };

                const diffedBlocks = applyInlineDiffToBlocks(oldBlocks, newBlocks);

                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${title.toUpperCase()}</h3>
                        <div id="diff-inline-${safeId}" class="diff-inline-target"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks, context);
                    // The renderer has now escaped the contributor's text, once.
                    // Turn the diff markers it left alone into real tags.
                    if (typeof window.resolveDiffMarkers === 'function') {
                        window.resolveDiffMarkers(document.getElementById(`diff-inline-${safeId}`));
                    }
                });

            } else {
                // Structural field-by-field diff (move/frame data, profile/
                // playstyle metadata, matchup/counterplay metadata) - used to
                // be a raw two-column JSON dump here, which made a single
                // changed frame number buried in an object as hard to spot as
                // reading two unrelated walls of text. window.renderStructuredDiff
                // (js/admin-diff.js) escapes every value it renders - this was
                // the single highest-risk render in this file since it's the
                // one place a reviewer sees a contributor's data essentially
                // unprocessed.
                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${title.toUpperCase()}</h3>
                        ${window.renderStructuredDiff(oldData, newData)}
                    </div>
                `;
            }
        }

        diffRenderQueue.forEach(fn => fn());
        if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);

        // Render dynamic ToC for the Diff View!
        setTimeout(updateAdminTOC, 200);
        return;
    }

    // --- REBUILDING LIVE / PENDING VIEWS ---
    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.innerHTML = '');

    // Undo the diff-mode hide above (character-type #tab-overview et al. and
    // #admin-diff-container aren't reset by anything else - nothing else
    // ever un-hides #tab-overview after it, since the static markup only
    // ever relied on it starting unhidden by default). Restores the same
    // default (overview visible, everything else hidden) a fresh revision
    // load already starts with, so returning here from diff mode looks
    // identical to arriving here normally.
    const diffContainerToHide = document.getElementById('admin-diff-container');
    if (diffContainerToHide) diffContainerToHide.classList.add('hidden');
    const defaultTabId = window.getDefaultCharacterTabId();
    window.getCharacterTabIds({ includeInjected: true, editableOnly: true })
        .filter(tab => tab !== defaultTabId)
        .forEach(tab => {
            const el = document.getElementById(`tab-${tab}`);
            if (el) el.classList.add('hidden');
        });
    const overviewTabToShow = document.getElementById(`tab-${defaultTabId}`);
    if (overviewTabToShow) overviewTabToShow.classList.remove('hidden');

    window.currentEditorPageType = window.activePreviewPageType;

    if (window.activePreviewPageType === 'tierlist') {
        window.liveTierData = window.currentEditorDescData;

        // Inject the required containers so tierlist.js has somewhere to render!
        const overviewTab = document.getElementById('tab-overview');
        if (overviewTab) {
            overviewTab.innerHTML = `
                <div id="tier-tabs-container"></div>
                <div id="tier-list-ui"></div>
                <div id="changelog-container" class="admin-changelog-container"></div>
            `;
            overviewTab.classList.remove('hidden');
        }

        if (typeof window.loadTierList === 'function') {
            await window.loadTierList();
        } else {
            console.warn("tierlist.js is not loaded in Admin.html");
        }
        setTimeout(window.showChangedTabsPopup, 200);
    } else {
        if (typeof loadPageDescriptions === 'function') {
            await loadPageDescriptions(window.activePreviewCharId, window.activePreviewPageType);
            setTimeout(window.showChangedTabsPopup, 200);
        }

        if (window.activePreviewPageType !== 'system' && typeof loadMoveSection === 'function') {
            await loadMoveSection(window.activePreviewCharId, 'm1s');
            await loadMoveSection(window.activePreviewCharId, 'skills');
            await loadMoveSection(window.activePreviewCharId, 'specials');
            // Only when the tab exists - js/admin-modes.js injects it for a
            // revision that actually has ultimate moves, and loadMoveSection
            // bails on a missing container anyway.
            if (document.getElementById('tab-ultimateAtk')) {
                await loadMoveSection(window.activePreviewCharId, 'ultimateAtk');
            }
        }
    }

    // Always scan for new Headers after rendering finishes
    setTimeout(updateAdminTOC, 300);
}
