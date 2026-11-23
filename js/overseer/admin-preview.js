/**
 * The Overseer's preview pane: opening a revision, the QA report, and the four
 * views of it (PENDING SUBMISSION, LIVE VERSION, DIFF VIEW side by side, and the
 * CHANGE LIST of every changed part).
 * @since v0.4, as part of admin.js
 * @touches page_data, pending_revisions, window.currentLive* and currentPending*,
 *   applyDeltaToData (site_data.js), loadPageDescriptions (page_render.js),
 *   renderStructuredDiff and setActiveRevisionTab (admin-diff.js),
 *   initPreviewStates (admin-modes.js), SideBySide.mount (side-by-side.js)
 * @watch switchVersionView is one function on purpose: its diff renderers close
 *   over its local variables. Every scope a submission can send needs a branch in
 *   renderDeltaDiff, or it shows as the raw fallback.
 * @see docs/overseer.md
 */

async function previewRevision(revId) {
    const rev = window.currentQueueData.find(r => r.id === revId);
    if (!rev) return;

    const { data: authorRoleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', rev.author_id);
    rev.author_roles = authorRoleData ? authorRoleData.map(r => r.role.toLowerCase()) : [];
    // From the page list, never the submission's page_type: that one is the
    // submitter's word, and it picks the renderer.
    const pageType = (await window.registeredPageType(rev.page_id)) || 'character';

    window.activePreviewRevId = rev.id;
    window.activePreviewCharId = rev.page_id;
    window.activePreviewPageType = pageType;
    document.getElementById('preview-status-text').innerHTML = `REVIEWING: <strong class="admin-preview-status-highlight">${window.escapeHtml(rev.page_id.toUpperCase())}</strong> (By ${window.escapeHtml(rev.author_name)})`;

    updateActionButtons(rev);
    renderQaReport(rev);
    if (typeof window.setQueueOpen === 'function') window.setQueueOpen(false);
    document.getElementById('preview-nav-sidebar').classList.remove('hidden');
    document.getElementById('preview-tab-nav').classList.remove('hidden');

    // A column list, so a new page_data column must be named here too.
    const { data: liveData } = await window.supabaseClient.from('page_data').select('desc_data, frame_data, tab_settings').eq('page_id', rev.page_id).single();
    window.currentLiveDescData = liveData ? liveData.desc_data : {};
    window.currentLiveFrameData = liveData ? liveData.frame_data : {};

    // Per revision: a reviewer works through different pages in one session.
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

    // Before anything renders: picks the state the preview opens on, draws the
    // toggle, and adds the Ultimate tab when this revision has one.
    if (typeof window.initPreviewStates === 'function') window.initPreviewStates(rev);

    if (typeof window.updateAdminSidebar === 'function') window.updateAdminSidebar();

    const toggleBar = document.getElementById('version-toggle-bar');
    if (toggleBar) toggleBar.classList.remove('hidden');

    // A clip and a revision share this pane, so opening one puts the other away.
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

        // A ticket with several scopes opens on the first tab it touched; the strip's
        // markers show the rest.
        const unwrapped = window.unwrapModeDelta(rev.target_scope, rev.target_key);

        let activeTabId = null;
        if (rev.target_scope === 'multi') {
            activeTabId = (window.changedTabs || [])[0] || 'overview';
        } else if (window.getKeyedSectionByScope(unwrapped.scope)) {
            // From the vocabulary: a tab name is not the scope plus an "s".
            activeTabId = window.getKeyedSectionByScope(unwrapped.scope).tab;
        } else if (unwrapped.scope === 'move') {
            activeTabId = unwrapped.key.split('::')[0];
        } else {
            activeTabId = 'overview';
        }

        window.setActiveRevisionTab(activeTabId);
    }

    switchVersionView(initMode);

    setTimeout(() => {
        const workspace = document.getElementById('ticket-workspace');
        const actionBtns = document.getElementById('preview-action-buttons');
        if (workspace && !workspace.classList.contains('hidden')) {
            workspace.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
        } else if (actionBtns) {
            actionBtns.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
        }
    }, 150);
}

/**
 * The contributor's QA report, in its own panel for any open submission.
 * @since v1.2
 * @watch all of it is contributor text: escaped. The evidence is a link only
 *   when it is one whole http(s) address, with the address as its text, so a
 *   reviewer sees where it goes. Anything else is shown as written.
 */
function renderQaReport(rev) {
    const panel = document.getElementById('qa-report-panel');
    const report = document.getElementById('qa-report');
    if (!panel || !report) return;

    const qa = (rev && rev.qa_metadata) || {};
    const evidence = typeof qa.evidence === 'string' ? qa.evidence.trim() : '';
    let evidenceHtml = 'No evidence linked.';
    if (/^https?:\/\/\S+$/i.test(evidence)) {
        evidenceHtml = `<a href="${window.escapeHtml(evidence)}" target="_blank" rel="noopener noreferrer" class="ticket-qa-link qa-report-evidence">${window.escapeHtml(evidence)}</a>`;
    } else if (evidence) {
        evidenceHtml = `<span class="qa-report-value qa-report-evidence">${window.escapeHtml(evidence)}</span>`;
    }

    report.innerHTML = `
        <div class="ticket-qa-field"><strong class="ticket-qa-label">Changelog:</strong><br><span class="qa-report-value">${qa.changelog ? window.escapeHtml(qa.changelog) : 'No changelog provided.'}</span></div>
        <div class="ticket-qa-field"><strong class="ticket-qa-label">Confidence:</strong><br>${qa.confidence ? window.escapeHtml(qa.confidence) : 'Unrated'}</div>
        <div><strong class="ticket-qa-label">Evidence:</strong><br>${evidenceHtml}</div>
    `;
    panel.classList.remove('hidden');
}

/**
 * Switches the pane between PENDING SUBMISSION, LIVE VERSION, DIFF VIEW (side by
 * side) and the CHANGE LIST.
 * @watch Page History is its own pane, not a mode here, so every mode hides it
 */
async function switchVersionView(mode) {
    // Remembered, so switching character state redraws the same view.
    window.activePreviewViewMode = mode;

    const historyContainer = document.getElementById('page-history-container');
    if (historyContainer) historyContainer.classList.add('hidden');
    const historyBtn = document.getElementById('btn-view-history');
    if (historyBtn) historyBtn.className = 'btn-sys btn-sys-regular version-toggle-btn';

    const btns = { 'pending': document.getElementById('btn-view-pending'), 'live': document.getElementById('btn-view-live'), 'diff': document.getElementById('btn-view-diff') };
    Object.values(btns).forEach(b => {
        if(!b) return;
        b.className = 'btn-sys btn-sys-regular version-toggle-btn';
    });

    if (mode === 'pending' && btns.pending) btns.pending.classList.add('btn-sys-blue');
    if (mode === 'live' && btns.live) btns.live.classList.add('btn-sys-green');
    // The change list is the side by side's other half, so DIFF VIEW stays lit.
    if ((mode === 'diff' || mode === 'list') && btns.diff) btns.diff.classList.add('btn-sys-purple');

    // A side by side still lining up lets go.
    sideBySideRun++;
    if (sideBySide) { sideBySide.destroy(); sideBySide = null; }
    // Two pages wide while it is up (admin.css).
    document.body.classList.toggle('sbs-active', mode === 'diff');

    if (mode === 'diff') {
        await renderSideBySideDiff();
        return;
    }

    // For what a page does not draw (an editor folder, a setting).
    if (mode === 'list') {
        document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => {
            el.classList.add('hidden');
        });
        // A character revision uses admin.html's own #tab-* panes, which carry neither
        // class above, so they are hidden by id.
        document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => {
            el.classList.add('hidden');
        });

        let diffContainer = document.getElementById('admin-diff-container');
        if (!diffContainer) {
            diffContainer = document.createElement('div');
            diffContainer.id = 'admin-diff-container';
            // Not .wiki-tab-content as well: that one lays its children out in a wrapping row.
            diffContainer.className = 'tab-content';
            const mainArea = document.querySelector('.main-content-area');
            if (mainArea) mainArea.appendChild(diffContainer);
        }

        diffContainer.innerHTML = `<h2 class="section-title diff-view-title">CHANGE LIST</h2>`;
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
            // Keyed sections name themselves, so a new one shows its real name.
            window.getKeyedSections().forEach(s => { map[s.scope] = s.entryLabel; });
            (window.FIXED_BLOCK_SECTIONS || []).forEach(s => { map[s.scope] = s.label; });
            Object.assign(map, {
                'gallery_item': 'Gallery Item',
                'gallery_intro': 'Introduction',
                'intro': 'Introduction',
                'notes': 'Notes',
                'tool_config': 'Tool Setup',
                'order': 'Order',
                'pageConfig': 'Page Settings',
            });
            return map[scope] || scope;
        };

        // "frame.skills" to "Skills": an order delta's key is a dotted path, named here
        // as the strip names it.
        const orderListLabel = (key) => {
            const [root, field] = String(key || '').split('.');
            if (root === 'frame') {
                return (window.getCharacterTabLabels ? window.getCharacterTabLabels()[field] : null) || field;
            }
            if (field === 'extras') return 'Custom Tabs';
            const section = window.getKeyedSectionByField && window.getKeyedSectionByField(field);
            return section ? section.label : field;
        };

        const fixedSectionByScope = (scope) =>
            (window.FIXED_BLOCK_SECTIONS || []).find(s => s.scope === scope) || null;

        // A system or tier list page's scopes name the page's own tabs, read from its data.
        const SYSTEM_SCOPES = ['system_section', 'system_tab', 'tierlist_tiers', 'tierlist_changelog'];

        // Where the change is, in one shape for every page type.
        const renderLocation = (crumbs) => {
            const parts = crumbs
                .filter(Boolean)
                .map(s => window.escapeHtml(s));
            if (!parts.length) return;
            diffContainer.innerHTML += `<div class="diff-location-label">`
                + `<span class="diff-location-lead">Changed:</span> `
                + parts.join(' <span class="diff-crumb-sep">›</span> ')
                + `</div>`;
        };

        // Combo List rows pair by position, since a route is the part most likely to
        // change; each changed row is named by its route.
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

            // A reorder or a renamed starter changes the table and no row: said, not left blank.
            if (!rendered && JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
                renderDiffBlock(`${section.entryLabel}: order changed`, oldRows, newRows, 'json');
            }
        };

        if (rev.is_delta) {
            const renderDeltaDiff = (rawScope, rawKey, payload) => {
                // A character state's edit compares against that state's live data in modeData,
                // never the base kit.
                const { modeId, scope, key } = window.unwrapModeDelta(rawScope, rawKey);
                const liveDesc = modeId ? ((window.currentLiveDescData.modeData || {})[modeId] || {}) : window.currentLiveDescData;
                const liveFrame = modeId ? ((window.currentLiveFrameData.modeData || {})[modeId] || {}) : window.currentLiveFrameData;
                const where = modeId ? modeId.toUpperCase() + ' / ' : '';

                // A key may be null (older merged tickets), so it is never used as a string
                // unchecked. The location reads as the page does: tab, section, entry
                // ("Combos › Read First"), and 'full' names no entry.
                const tabLabels = window.getCharacterTabLabels ? window.getCharacterTabLabels() : {};
                const owningTab = (window.getKeyedSectionByScope && window.getKeyedSectionByScope(scope))
                    || fixedSectionByScope(scope);
                let tabName = owningTab ? tabLabels[owningTab.tab] : null;
                if (!tabName && ['profile', 'playstyle', 'overview', 'strategy', 'extra'].includes(scope)) {
                    tabName = tabLabels.overview;
                }
                if (!tabName && scope === 'move' && key) tabName = tabLabels[String(key).split('::')[0]];

                const rawKeyLabel = key === null || key === undefined ? 'full' : String(key);
                const entryName = rawKeyLabel === 'full' ? '' : rawKeyLabel.split('::').pop();

                // A system page's tabs are its own, so their names come from the data.
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
                // Every other keyed section. Matchups keeps its own branch above.
                else if (window.getKeyedSectionByScope(scope)) {
                    const section = window.getKeyedSectionByScope(scope);
                    const oldEntry = liveDesc[section.field]?.find(e => e[section.keyField] === key) || {};
                    if (payload === null) {
                        renderDiffBlock(`${section.entryLabel} Deleted`, oldEntry, null, 'json');
                    }
                    // An entry that is one flat object (a gallery item) diffs whole, declared in the
                    // registry, never tested by name.
                    else if (section.wholeEntryDiff) {
                        renderDiffBlock(section.entryLabel, oldEntry, payload, 'json');
                    }
                    else {
                        const meta = (e) => {
                            const m = { [section.keyField]: e[section.keyField] };
                            if (section.metaField) m[section.metaField] = e[section.metaField];
                            return m;
                        };
                        renderDiffBlock(`${section.entryLabel} Metadata`, meta(oldEntry), meta(payload));

                        // A section whose entries hold rows (the Combo List): diffing `.content` would
                        // compare two empty arrays.
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
                // An order change moves entries without changing one, so it shows the two
                // sequences and which entries moved.
                else if (scope === 'order') {
                    const listKey = key;
                    const before = (() => {
                        const [root, ...rest] = String(listKey).split('.');
                        let node = root === 'frame' ? liveFrame : liveDesc;
                        for (const p of rest) node = node ? node[/^\d+$/.test(p) ? Number(p) : p] : null;
                        if (!Array.isArray(node)) return [];
                        return node.map(e => {
                            if (!e || typeof e !== 'object') return null;
                            for (const f of ['name', 'id', 'title', 'opponent', 'topic', 'starter', 'theory']) {
                                if (e[f]) return String(e[f]);
                            }
                            return null;
                        }).filter(Boolean);
                    })();

                    const after = Array.isArray(payload) ? payload.map(String) : [];

                    const moved = after
                        .map((name, i) => ({ name, from: before.indexOf(name), to: i }))
                        .filter(m => m.from !== -1 && m.from !== m.to);

                    renderDiffBlock(`${orderListLabel(listKey)} order`,
                        { order: before }, { order: after });

                    if (moved.length) {
                        const rows = moved
                            .map(m => `${window.escapeHtml(m.name)}: ${m.from + 1} → ${m.to + 1}`)
                            .join('<br>');
                        diffContainer.innerHTML += `<div class="diff-location-label">`
                            + `<span class="diff-location-lead">Moved:</span> ${rows}</div>`;
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
                // A fixed Block section (FIXED_BLOCK_SECTIONS, character_tabs.js).
                else if (fixedSectionByScope(scope)) {
                    const section = fixedSectionByScope(scope);
                    renderDiffBlock(section.label, liveDesc[section.field] || [], payload || []);
                }
                // A gallery page: one delta per item, keyed by name.
                else if (scope === 'gallery_item') {
                    const oldItem = liveDesc.items?.find(i => i.name === key) || {};
                    if (payload === null) {
                        renderDiffBlock(`Gallery Item Removed: ${key}`, oldItem, null, 'json');
                    } else {
                        renderDiffBlock('Gallery Item', oldItem, payload);
                    }
                }
                // Whole-value replacements.
                else if (scope === 'gallery_intro' || scope === 'intro') {
                    renderDiffBlock('Introduction', liveDesc.intro || [], payload || []);
                }
                else if (scope === 'notes') {
                    renderDiffBlock('Notes', liveDesc.notes || [], payload || []);
                }
                else if (scope === 'tool_config') {
                    renderDiffBlock('Tool Configuration', liveDesc.tool || {}, payload);
                }
                // The page's own settings: the words painted in their colours, and the house
                // style as prose.
                else if (scope === 'pageConfig') {
                    const wordLines = (cfg) => ((cfg && Array.isArray(cfg.words)) ? cfg.words : [])
                        .filter(w => w && w.word)
                        // [noauto], so a hex like #f00 is not read as a frame count.
                        .map(w => `${w.word}: [noauto]${(w.colors || []).join(' → ')}[/noauto]`);
                    const asList = (cfg) => {
                        const items = wordLines(cfg);
                        return items.length ? [{ type: 'list', items }] : [];
                    };
                    renderDiffBlock('Auto-Color Words', asList(liveDesc.pageConfig), asList(payload));
                    renderDiffBlock('House Style',
                        window.houseStyleBlocks(liveDesc.pageConfig && liveDesc.pageConfig.houseStyle),
                        window.houseStyleBlocks(payload && payload.houseStyle));
                }
                // The prose diffs as prose and the layout fields as fields, so a reviewer tells
                // a wording change from a width change.
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
                // A tab's metadata and its section order, as the names the keys resolve to.
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
                // The order of the tabs, as their labels: a renamed tab's key differs from its name.
                else if (scope === 'system_tab_order') {
                    const indexed = window.indexSystemTabs(liveDesc);
                    const nameFor = (tabKey) => {
                        const hit = indexed.find(t => t.tabKey === tabKey);
                        return (hit && hit.tab && hit.tab.tabLabel) || tabKey;
                    };
                    renderDiffBlock('Tab Order',
                        { order: indexed.map(t => nameFor(t.tabKey)) },
                        { order: (payload || []).map(nameFor) });
                }
                else if (scope === 'tierlist_tiers' || scope === 'tierlist_changelog') {
                    const tab = window.findSystemTab(liveDesc, key) || {};
                    const field = scope === 'tierlist_tiers' ? 'tiers' : 'changelog';
                    renderDiffBlock(field === 'tiers' ? 'Tiers' : 'Changelog', tab[field] || [], payload || [], 'json');
                }
                // Nothing matched: never silent. A raw dump with a banner, since a heading over
                // a blank space reads as "nothing changed".
                else {
                    diffContainer.innerHTML += `<div class="diff-unknown-scope">`
                        + `This change is shown in its raw form because the review screen has no`
                        + ` purpose-built view for "${window.escapeHtml(scope)}" yet. It is a real change and`
                        + ` it will be applied if you approve it.`
                        + `</div>`;
                    renderDiffBlock(formatScopeName(scope), null, payload, 'json');
                }
            };

            if (rev.target_scope === 'multi') {
                diffContainer.innerHTML += `<div class="diff-batch-banner">BATCHED MULTI-PAYLOAD DETECTED (${rev.delta_payload.length} EDITS)</div>`;

                // One entry that throws must not hide the rest of the ticket.
                rev.delta_payload.forEach((edit, i) => {
                    try {
                        renderDeltaDiff(edit.scope, edit.key, edit.payload);
                    } catch (err) {
                        console.error('[Diff] Edit', i + 1, 'failed to render:', err, edit);
                        diffContainer.innerHTML += `<div class="diff-location-label">`
                            + `Edit ${i + 1} of ${rev.delta_payload.length} could not be displayed`
                            + ` (scope: ${window.escapeHtml(edit && edit.scope)}). It is still part of this ticket.`
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

                    // The location goes in the breadcrumb, not into every block title.
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
                    // Counterplay, Starter Guide and any keyed section added later.
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

                    // Narrowed to the state on screen, like getTabData.
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
                        // Through the helper both review screens share.
                        if (oldB.notations || newB.notations) b.notations = window.diffComboNotations(oldB.notations, newB.notations);
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
                    // A Combo Card nests like an accordion, plus its own fields.
                    else if (b.type === 'theorybox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.oneliner = window.diffTextLCS(oldB.oneliner || '', newB.oneliner || '');
                        b.damage = window.diffTextLCS(oldB.damage || '', newB.damage || '');
                        b.difficulty = window.diffTextLCS(oldB.difficulty || '', newB.difficulty || '');
                        b.practicality = window.diffTextLCS(oldB.practicality || '', newB.practicality || '');
                        const oldSeq = oldB.sequence || [];
                        const newSeq = newB.sequence || [];
                        if (!b.sequence) b.sequence = [];
                        for (let j = 0; j < Math.max(oldSeq.length, newSeq.length); j++) {
                            b.sequence[j] = window.diffTextLCS(oldSeq[j] || '', newSeq[j] || '');
                        }
                        if (oldB.notations || newB.notations) b.notations = window.diffComboNotations(oldB.notations, newB.notations);
                        b.content = applyInlineDiffToBlocks(oldB.content || [], newB.content || []);
                        // A card in Multiple Sections mode holds a whole variant per tab, each diffed
                        // like a card.
                        const oldCardSecs = oldB.sections || [];
                        const newCardSecs = newB.sections || [];
                        if (!Array.isArray(b.sections)) b.sections = [];
                        for (let j = 0; j < Math.max(oldCardSecs.length, newCardSecs.length); j++) {
                            const oSec = oldCardSecs[j] || {};
                            const nSec = newCardSecs[j] || {};
                            if (!b.sections[j]) b.sections[j] = {};
                            b.sections[j].label = window.diffTextLCS(oSec.label || '', nSec.label || '');
                            b.sections[j].title = window.diffTextLCS(oSec.title || '', nSec.title || '');
                            b.sections[j].oneliner = window.diffTextLCS(oSec.oneliner || '', nSec.oneliner || '');
                            b.sections[j].damage = window.diffTextLCS(oSec.damage || '', nSec.damage || '');
                            b.sections[j].difficulty = window.diffTextLCS(oSec.difficulty || '', nSec.difficulty || '');
                            b.sections[j].practicality = window.diffTextLCS(oSec.practicality || '', nSec.practicality || '');
                            const oSeq = oSec.sequence || [];
                            const nSeq = nSec.sequence || [];
                            b.sections[j].sequence = [];
                            for (let k = 0; k < Math.max(oSeq.length, nSeq.length); k++) {
                                b.sections[j].sequence[k] = window.diffTextLCS(oSeq[k] || '', nSeq[k] || '');
                            }
                            if (oSec.notations || nSec.notations) b.sections[j].notations = window.diffComboNotations(oSec.notations, nSec.notations);
                            b.sections[j].content = applyInlineDiffToBlocks(oSec.content || [], nSec.content || []);
                        }
                    }
                    // A Section Box nests twice: its introduction and one content array per section.
                    else if (b.type === 'sectionedbox') {
                        b.title = window.diffTextLCS(oldB.title || '', newB.title || '');
                        b.intro = applyInlineDiffToBlocks(oldB.intro || [], newB.intro || []);

                        const oldSec = oldB.sections || [];
                        const newSec = newB.sections || [];
                        if (!Array.isArray(b.sections)) b.sections = [];
                        for (let j = 0; j < Math.max(oldSec.length, newSec.length); j++) {
                            const oSec = oldSec[j] || {};
                            const nSec = newSec[j] || {};
                            if (!b.sections[j]) b.sections[j] = {};
                            b.sections[j].title = window.diffTextLCS(oSec.title || '', nSec.title || '');
                            b.sections[j].content = applyInlineDiffToBlocks(oSec.content || [], nSec.content || []);
                        }
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
                        <h3 class="diff-section-title">${window.escapeHtml(title.toUpperCase())}</h3>
                        <div id="diff-inline-${safeId}" class="diff-inline-target"></div>
                    </div>
                `;
                diffRenderQueue.push(() => {
                    if (typeof window.populateTextSection === 'function') window.populateTextSection(`diff-inline-${safeId}`, '', diffedBlocks, context);
                    // The renderer has escaped the text once; the diff markers it left become tags.
                    // Unguarded on purpose, like editor-sync.js, so a missing helper is loud.
                    window.resolveDiffMarkers(document.getElementById(`diff-inline-${safeId}`));
                });

            } else {
                // renderStructuredDiff escapes every value: this is where a reviewer sees a
                // contributor's data least processed.
                diffContainer.innerHTML += `
                    <div class="diff-container">
                        <h3 class="diff-section-title">${window.escapeHtml(title.toUpperCase())}</h3>
                        ${window.renderStructuredDiff(oldData, newData)}
                    </div>
                `;
            }
        }

        diffRenderQueue.forEach(fn => fn());
        if(typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);

        setTimeout(updateAdminTOC, 200);
        return;
    }

    await renderPreviewVersion(mode);

    setTimeout(updateAdminTOC, 300);
}

/**
 * Draws one version (live or pending) as the page draws it, for the two plain
 * views and each half of the side by side. Resolves once the move strategies
 * are in.
 * @since v1.2
 * @watch onlyTab (the side by side) leaves out the move tabs it was not asked for
 */
async function renderPreviewVersion(mode, onlyTab = null) {
    // The renderers narrow to a character state as the live page does: the desc data
    // arrives narrowed, and the frame data stays whole for loadMoveSection.
    const previewMode = window.activePreviewMode || null;
    window.activeCharacterMode = previewMode;
    // Through resolveModeDesc, so a state without its own portrait shows the
    // character's, as approving it would.
    const narrow = (full) => (typeof window.resolveModeDesc === 'function'
        ? window.resolveModeDesc(full || {}, previewMode)
        : (window.isBaseMode(previewMode) ? full : ((full && full.modeData) || {})[previewMode] || {}));

    const pending = mode === 'pending';
    window.currentEditorDescData = narrow(pending ? window.currentPendingDescData : window.currentLiveDescData);
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData[window.activePreviewCharId] = pending ? window.currentPendingFrameData : window.currentLiveFrameData;

    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.innerHTML = '');

    // Undoes the diff view's hiding, back to a fresh revision's default.
    const diffContainerToHide = document.getElementById('admin-diff-container');
    if (diffContainerToHide) diffContainerToHide.classList.add('hidden');

    // Back to the tab the strip names, not the default: the diff view hides every
    // pane, so the strip is the only record of where the reviewer was.
    const activeNavBtn = document.querySelector('#preview-tab-nav .btn-manga.active');
    const stripTabId = activeNavBtn ? activeNavBtn.id.replace(/^nav-/, '') : null;
    // The default when this page lacks the strip's tab.
    const restoreTabId = (stripTabId && document.getElementById(`tab-${stripTabId}`))
        ? stripTabId
        : window.getDefaultCharacterTabId();

    window.getCharacterTabIds({ includeInjected: true, editableOnly: true })
        .filter(tab => tab !== restoreTabId)
        .forEach(tab => {
            const el = document.getElementById(`tab-${tab}`);
            if (el) el.classList.add('hidden');
        });
    const tabToShow = document.getElementById(`tab-${restoreTabId}`);
    if (tabToShow) tabToShow.classList.remove('hidden');

    // setActiveRevisionTab moves the strip and the pane together. The sweep above
    // stays for when it returns early.
    if (typeof window.setActiveRevisionTab === 'function') {
        window.setActiveRevisionTab(restoreTabId);
    }

    window.currentEditorPageType = window.activePreviewPageType;

    if (window.activePreviewPageType === 'tierlist') {
        window.liveTierData = window.currentEditorDescData;

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
    } else {
        if (typeof loadPageDescriptions === 'function') {
            await loadPageDescriptions(window.activePreviewCharId, window.activePreviewPageType);
        }

        if (window.activePreviewPageType !== 'system' && typeof loadMoveSection === 'function') {
            // The side by side asks for one tab, and drawing every move tab twice was most
            // of its wait.
            const moveTabs = window.FRAME_MOVE_CATEGORIES.filter(tab => !onlyTab || tab === onlyTab);
            for (const tab of moveTabs) {
                // Only when the tab exists: admin-modes.js adds Ultimate when a revision has it.
                if (tab === 'ultimateAtk' && !document.getElementById('tab-ultimateAtk')) continue;
                await loadMoveSection(window.activePreviewCharId, tab);
            }
        }
    }

    // A move's strategy text arrives 300ms later, and only a move tab has cards.
    const movesOnScreen = !onlyTab || (window.FRAME_MOVE_CATEGORIES || []).includes(onlyTab);
    if (movesOnScreen && window.moveStrategiesDrawn) await window.moveStrategiesDrawn;
    // The profile card's pager waits on navigation.json. It catches its own fetch,
    // and a failure must not stop the page drawing.
    if (window.profilePagerFilled) await Promise.resolve(window.profilePagerFilled).catch(() => {});
    // The format tags styled now, not on a timer, so each half is compared as a
    // reader sees it.
    if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
}

// The side by side: the open tab drawn live then pending, each lifted out of its
// pane before the next, so no renderer finds the other's elements by id.
let sideBySide = null;
let sideBySideRun = 0;

function openRevisionTabId() {
    const btn = document.querySelector('#preview-tab-nav .btn-manga.active');
    const id = btn ? btn.id.replace(/^nav-/, '') : null;
    return id && document.getElementById(`tab-${id}`) ? id : window.getDefaultCharacterTabId();
}

// Into a holder that keeps the pane's layout classes but not its id.
function liftTabContent(tabId) {
    const holder = document.createElement('div');
    const pane = document.getElementById(`tab-${tabId}`);
    if (!pane) return holder;
    holder.className = pane.className;
    holder.classList.remove('hidden', 'active', 'tab-content');
    holder.classList.add('sbs-version');
    while (pane.firstChild) holder.appendChild(pane.firstChild);
    return holder;
}

function showDiffContainer() {
    document.querySelectorAll('.tab-content, .wiki-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('#preview-content-area > div[id^="tab-"]').forEach(el => el.classList.add('hidden'));
    let host = document.getElementById('admin-diff-container');
    if (!host) {
        host = document.createElement('div');
        host.id = 'admin-diff-container';
        host.className = 'tab-content';
        const mainArea = document.querySelector('.main-content-area');
        if (mainArea) mainArea.appendChild(host);
    }
    host.classList.remove('hidden');
    return host;
}

async function renderSideBySideDiff() {
    // A tier list keeps the change list: its board redraws by id, which two copies
    // would confuse.
    if (window.activePreviewPageType === 'tierlist') {
        await switchVersionView('list');
        return;
    }

    const run = sideBySideRun;
    const tabId = openRevisionTabId();
    showDiffContainer().innerHTML = '<p class="sbs-note">Drawing both versions...</p>';

    await renderPreviewVersion('live', tabId);
    if (run !== sideBySideRun) return;
    const left = liftTabContent(tabId);

    await renderPreviewVersion('pending', tabId);
    if (run !== sideBySideRun) return;
    const right = liftTabContent(tabId);

    const host = showDiffContainer();
    const list = document.createElement('button');
    list.type = 'button';
    list.id = 'btn-view-list';
    list.className = 'btn-sys btn-sys-regular';
    list.textContent = 'CHANGE LIST';
    list.addEventListener('click', () => switchVersionView('list'));

    sideBySide = window.SideBySide.mount(host, left, right, {
        dataChanged: (window.changedTabs || []).includes(tabId),
        extraButtons: [list],
    });
    if (typeof window.applyInternalStyling === 'function') setTimeout(window.applyInternalStyling, 50);
    setTimeout(updateAdminTOC, 200);
}

// A tab picked while DIFF VIEW is open shows that tab side by side, after
// setupTabs has switched the panes.
document.addEventListener('DOMContentLoaded', () => {
    const strip = document.getElementById('preview-tab-nav');
    if (!strip) return;
    strip.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-manga') || window.activePreviewViewMode !== 'diff') return;
        setTimeout(() => switchVersionView('diff'), 0);
    });
});
