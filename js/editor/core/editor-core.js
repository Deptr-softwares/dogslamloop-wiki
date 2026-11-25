/**
 * The editor's start-up and Submit: the collapsible header and the Workspace
 * splitter, loading the page (and a ticket, or a draft), routing to the tab's
 * editor, the QA modal, and the Submit pipeline that turns every change into
 * deltas for the review queue.
 * @since v0.4, as part of editor.js
 * @touches page_data, pending_revisions, page_permissions, user_roles,
 *   site_settings, window.currentEditorDescData and currentEditorFrameData,
 *   editorMasterDescData (editor-modes.js), localStorage dsl_editor_*
 * @watch the role and cooldown checks here only choose the message: RLS and
 *   check_revision_rate_limit() are the boundary, and the two must agree. An
 *   intercept whose ticket did not load is refused, never sent as a new
 *   submission.
 * @see docs/editor.md
 */
// The header and the splitter remember their state per browser: a preference
// about a screen, read before the editor draws.
const EDITOR_CHROME_KEY = 'dsl_editor_chrome_collapsed';
const EDITOR_TIP_KEY = 'dsl_editor_tip_dismissed';
const EDITOR_SPLIT_KEY = 'dsl_editor_split_pct';

// 30/70 is the default: the preview shows the page at a reader's proportions, and
// a wider Workspace is a trade the writer opts into.
const EDITOR_SPLIT_DEFAULT = 30;
// Floors in pixels: a percentage comfortable at 1920 is unusable at 1280.
const EDITOR_SPLIT_MIN_PX = 300;
const EDITOR_PREVIEW_MIN_PX = 360;
// A drag this close to the default snaps onto it exactly: "roughly 30%" is not a
// reader's proportions. Percent, so the pull feels the same on any width.
const EDITOR_SPLIT_SNAP_PCT = 2;

// localStorage throws in some setups (private mode, site data blocked): the
// editor still works and only forgets.
function editorPrefRead(key) {
    try { return window.localStorage.getItem(key) === '1'; } catch (e) { return false; }
}

function editorPrefWrite(key, on) {
    try {
        if (on) window.localStorage.setItem(key, '1');
        else window.localStorage.removeItem(key);
    } catch (e) { /* the control still works this session */ }
}

window.setEditorChromeCollapsed = function (collapsed) {
    const header = document.getElementById('editor-header');
    const toggle = document.getElementById('btn-collapse-chrome');
    if (!header || !toggle) return;

    header.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Expand the editor header' : 'Collapse the editor header';
    editorPrefWrite(EDITOR_CHROME_KEY, collapsed);
};

window.setEditorTipDismissed = function (dismissed) {
    const tip = document.getElementById('editor-scope-tip');
    if (!tip) return;
    tip.classList.toggle('hidden', dismissed);
    editorPrefWrite(EDITOR_TIP_KEY, dismissed);
};

function editorPrefReadNum(key, fallback) {
    try {
        const n = parseFloat(window.localStorage.getItem(key));
        return Number.isFinite(n) ? n : fallback;
    } catch (e) { return fallback; }
}

function editorPrefWriteNum(key, n) {
    try { window.localStorage.setItem(key, String(n)); } catch (e) { /* forgets, still works */ }
}

/**
 * A split percentage clamped to both panes' floors in pixels: a Workspace under
 * about 300px cannot hold the cards, and a preview under about 360px is none.
 * @since v0.16
 */
window.clampEditorSplit = function (pct, layoutWidth) {
    if (!layoutWidth) return pct;
    const minPct = (EDITOR_SPLIT_MIN_PX / layoutWidth) * 100;
    const maxPct = ((layoutWidth - EDITOR_PREVIEW_MIN_PX) / layoutWidth) * 100;
    // Too narrow for both floors: the default is the least bad answer.
    if (minPct > maxPct) return EDITOR_SPLIT_DEFAULT;
    return Math.min(Math.max(pct, minPct), maxPct);
};

window.setEditorSplit = function (pct, persist) {
    const layout = document.querySelector('.editor-layout-split');
    if (!layout) return;
    const clamped = window.clampEditorSplit(pct, layout.getBoundingClientRect().width);
    layout.style.setProperty('--editor-split', clamped.toFixed(3) + '%');
    // The separator tells a screen reader the Workspace's share, in percent.
    const splitter = document.getElementById('editor-splitter');
    if (splitter) splitter.setAttribute('aria-valuenow', String(Math.round(clamped)));
    if (persist) editorPrefWriteNum(EDITOR_SPLIT_KEY, Math.round(clamped * 1000) / 1000);
};

window.initEditorSplitter = function () {
    const splitter = document.getElementById('editor-splitter');
    const layout = document.querySelector('.editor-layout-split');
    if (!splitter || !layout) return;

    window.setEditorSplit(editorPrefReadNum(EDITOR_SPLIT_KEY, EDITOR_SPLIT_DEFAULT), false);

    let dragging = false;

    const applyFromX = (clientX) => {
        const r = layout.getBoundingClientRect();
        if (!r.width) return;
        const raw = ((clientX - r.left) / r.width) * 100;
        // Only while dragging: the keyboard's 1% steps could never leave the default.
        const snapped = Math.abs(raw - EDITOR_SPLIT_DEFAULT) <= EDITOR_SPLIT_SNAP_PCT
            ? EDITOR_SPLIT_DEFAULT : raw;
        splitter.classList.toggle('is-snapped', snapped === EDITOR_SPLIT_DEFAULT);
        window.setEditorSplit(snapped, false);
    };

    // Pointer events cover a trackpad, a mouse and a stylus, and pointer capture
    // keeps the drag once the cursor outruns the 5px bar.
    splitter.addEventListener('pointerdown', (e) => {
        dragging = true;
        splitter.setPointerCapture(e.pointerId);
        splitter.classList.add('is-dragging');
        layout.classList.add('is-resizing');
        e.preventDefault();
    });

    splitter.addEventListener('pointermove', (e) => {
        if (dragging) applyFromX(e.clientX);
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { splitter.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
        splitter.classList.remove('is-dragging');
        splitter.classList.remove('is-snapped');
        layout.classList.remove('is-resizing');
        // Saved once, at the end, not inside the drag loop.
        const current = parseFloat(getComputedStyle(layout).getPropertyValue('--editor-split'));
        window.setEditorSplit(Number.isFinite(current) ? current : EDITOR_SPLIT_DEFAULT, true);
    };
    splitter.addEventListener('pointerup', endDrag);
    splitter.addEventListener('pointercancel', endDrag);

    // Back to a reader's proportions in one gesture.
    splitter.addEventListener('dblclick', () => window.setEditorSplit(EDITOR_SPLIT_DEFAULT, true));

    // A focusable separator must answer the arrow keys.
    splitter.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 5 : 1;
        const current = parseFloat(getComputedStyle(layout).getPropertyValue('--editor-split')) || EDITOR_SPLIT_DEFAULT;
        if (e.key === 'ArrowLeft') { window.setEditorSplit(current - step, true); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { window.setEditorSplit(current + step, true); e.preventDefault(); }
        else if (e.key === 'Home') { window.setEditorSplit(EDITOR_SPLIT_DEFAULT, true); e.preventDefault(); }
    });

    // A stored percentage can break the floors after a resize.
    window.addEventListener('resize', () => {
        const current = parseFloat(getComputedStyle(layout).getPropertyValue('--editor-split'));
        if (Number.isFinite(current)) window.setEditorSplit(current, false);
    });
};

/**
 * Wires the header's collapse button and the splitter. The Playground calls it
 * too.
 * @since v0.14
 */
window.initEditorChrome = function () {
    window.initEditorSplitter();

    const toggle = document.getElementById('btn-collapse-chrome');
    const dismiss = document.getElementById('btn-dismiss-tip');
    if (!toggle && !dismiss) return;

    // Before any listener, so the editor opens as it was left.
    window.setEditorChromeCollapsed(editorPrefRead(EDITOR_CHROME_KEY));
    window.setEditorTipDismissed(editorPrefRead(EDITOR_TIP_KEY));

    if (toggle) {
        toggle.addEventListener('click', () => {
            const header = document.getElementById('editor-header');
            window.setEditorChromeCollapsed(!header.classList.contains('is-collapsed'));
        });
    }

    if (dismiss) dismiss.addEventListener('click', () => window.setEditorTipDismissed(true));
};

document.addEventListener('DOMContentLoaded', window.initEditorChrome);

// Leaving the editor. A reviewer intercepting a ticket arrives in a new tab with
// no history, so each step in cancelEditor is a real exit, and none covers every
// way in alone. This picks where a deep link with no history goes.
window.editorExitDestination = function(search = window.location.search) {
    const params = new URLSearchParams(search);
    const pageId = params.get('page') || params.get('char');
    const pageType = params.get('type') || 'character';

    // The Playground goes back to its own page.
    if (params.has('playground')) return 'tools/editor-playground/';

    // Staff go back to the queue, an author editing their own submission to My
    // Submissions (the Overseer turns a contributor away), everyone else to the page.
    if (params.get('editTicket')) {
        const own = window.interceptedTicketData && window.currentGlobalUserId
            && window.interceptedTicketData.author_id === window.currentGlobalUserId;
        return own ? 'submissions.html' : 'overseer.html';
    }
    if (pageId) return `${pageType === 'character' ? 'characters' : 'systems'}/${encodeURIComponent(pageId)}/`;
    return 'index.html';
};

/**
 * After a new submission, the editor carries on as an edit of it: the ticket id
 * in the URL (so a reload continues it), the row, and the purple UPDATE button.
 * Pressing Submit again would otherwise send a second submission.
 * @since v1.1
 */
window.adoptOwnSubmission = function(row) {
    window.activeEditTicketId = row.id;
    window.interceptedTicketData = row;

    const url = new URL(window.location.href);
    url.searchParams.set('editTicket', row.id);
    window.history.replaceState({}, '', url);

    const btn = document.getElementById('submit-payload-btn');
    if (btn) {
        btn.classList.remove('btn-sys-blue');
        btn.classList.add('btn-sys-purple');
    }
    const subtitle = document.getElementById('editor-subtitle');
    if (subtitle) subtitle.textContent = 'Editing your submission. Sending again updates it instead of making a new one.';
};

/**
 * The delta for an intercepted ticket, rebuilt from the editor. null when the
 * ticket has no single scope: a 'multi' batch (the editor's own, or the merge
 * compiler's) or a legacy whole-page upload. The caller then scans as Submit does.
 * @since v0.17
 * @watch never return undefined: JSON.stringify drops it from the update, which
 *   then succeeds and changes nothing
 */
window.buildInterceptDelta = function (ticket) {
    if (!ticket) return null;

    // A legacy whole-page upload: nothing scoped to rebuild.
    if (!ticket.is_delta) return null;

    let scope = ticket.target_scope;
    let key = ticket.target_key;

    // A batch has no single target.
    if (scope === 'multi') return null;

    // A character state's ticket unwraps to the plain scope. initEditorModes has
    // already opened that state, and buildPayload wraps it again.
    if (scope === 'mode' && typeof key === 'string') {
        const parts = key.split('::');
        parts.shift();
        scope = parts.shift();
        key = parts.join('::') || 'full';
    }

    if (!scope) return null;

    let delta;
    if (scope === 'move') {
        const [cat, mId] = String(key).split('::');
        const bucket = (window.currentEditorFrameData || {})[cat];
        if (!Array.isArray(bucket)) return null;
        delta = {
            frame_data: bucket.find(m => m.id === mId),
            desc_data: (window.currentEditorDescData.moveStrategies || {})[mId] || []
        };
    } else if (scope === 'extra' || window.getKeyedSectionByScope(scope)) {
        // 'extra' is not a tab; every other array scope resolves through the vocabulary.
        const section = window.getKeyedSectionByScope(scope);
        const field = section ? section.field : 'extras';
        const list = window.currentEditorDescData[field];
        if (!Array.isArray(list)) return null;
        delta = list[parseInt(key, 10)];
    } else {
        delta = window.currentEditorDescData[scope];
    }

    // An undefined delta is a write that does nothing, so it never reaches the update.
    if (delta === undefined) return null;

    return { scope, key, delta };
};

/**
 * Leaves the editor: closes a tab the queue opened, goes back where there is
 * history, or goes to editorExitDestination.
 * @since v0.12
 */
window.cancelEditor = function() {
    // Opened from the review queue: closing shows the Overseer underneath.
    if (window.opener && !window.opener.closed) {
        window.close();
        return;
    }

    // Length 1: this tab has been nowhere else.
    if (window.history.length > 1) {
        window.history.back();
        return;
    }

    window.location.href = window.editorExitDestination();
};

// A character state's edit is wrapped once here and unwrapped once in
// applyDeltaToData. 'multi' holds deltas already wrapped, and 'modes' and
// 'pageConfig' belong to the character, not to one state.
function scopeSubmissionDelta(scope, key) {
    const unwrappable = scope === 'multi' || scope === 'modes' || scope === 'pageConfig';
    return (unwrappable || typeof window.scopeEditorDelta !== 'function')
        ? { scope, key }
        : window.scopeEditorDelta(scope, key);
}

/**
 * Every change on screen as Submit sends it, [{ scope, key, payload }] against
 * the page as loaded, each wrapped for its character state. Config's Edit
 * Conflict Check reads this same list.
 * @since v1.1
 * @watch async: a system, tier list or tool page flushes its Block buffer first
 */
window.collectEditorDeltas = async function () {
    const pageType = window.currentEditorPageType || 'character';
    const isDiff = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);
    const deltas = [];
    // Wrapped as found: the state scan opens each state in turn.
    const add = (scope, key, payload) => {
        const scoped = scopeSubmissionDelta(scope, key);
        deltas.push({ scope: scoped.scope, key: scoped.key, payload });
    };

    // Which states exist, scanned at page level: otherwise a new state's content
    // could ship without the declaration, out of reach of any toggle.
    if (!['system', 'tierlist', 'gallery', 'tool'].includes(pageType)) {
        const localModes = (window.editorMasterFrameData || {}).modes;
        const cloudModes = (window.originalCloudMasterFrame || {}).modes;
        if (isDiff(localModes, cloudModes)) {
            add('modes', 'full', localModes || null);
        }
    }

    // The page's own settings, read from the masters: on a character with states,
    // currentEditorDescData is one state's slice.
    if ((window.PAGE_CONFIG_PAGE_TYPES || []).includes(pageType)) {
        const localConfig = (window.editorMasterDescData || window.currentEditorDescData || {}).pageConfig;
        const cloudConfig = (window.originalCloudMasterDesc || window.originalCloudDescData || {}).pageConfig;
        if (isDiff(localConfig, cloudConfig)) {
            add('pageConfig', 'full', localConfig || null);
        }
    }

    // A gallery: one delta per item, keyed by name, so two people adding different
    // items never collide, and approving one never carries the other.
    if (pageType === 'gallery') {
        const localItems = (typeof window.getGalleryEditorItems === 'function'
            ? window.getGalleryEditorItems() : []) || [];
        const cloudItems = (window.originalCloudDescData && window.originalCloudDescData.items) || [];

        window.buildGalleryDeltas(localItems, cloudItems).forEach(d => {
            add(d.scope, d.key, d.payload);
        });
    }
    // A tool page: config and prose are separate scopes, since the config is the
    // owner's and the prose everyone's.
    else if (pageType === 'tool') {
        await window.triggerManualSync();
        window.buildToolDeltas(window.currentEditorDescData, window.originalCloudDescData)
            .forEach(d => add(d.scope, d.key, d.payload));
    }
    // A system or tier list page: one delta per section, tab metadata and tier
    // table, never the whole document (see buildSystemDeltas).
    else if (pageType === 'system' || pageType === 'tierlist') {
        await window.triggerManualSync();
        window.buildSystemDeltas(window.currentEditorDescData, window.originalCloudDescData, pageType)
            .forEach(d => add(d.scope, d.key, d.payload));
    }
    // A character: every tab is scanned, not only the open one, from the data the
    // editor already holds (switchEditorTab flushes the buffer before moving). One
    // delta per section, so several become a 'multi' ticket.
    else {
        const scanMoveTab = (moveTab) => {
            const localMoves = (window.currentEditorFrameData || {})[moveTab] || [];
            const cloudMoves = (window.originalCloudFrameData || {})[moveTab] || [];

            localMoves.forEach(m => {
                const oldFrame = cloudMoves.find(old => old.id === m.id);
                const oldDesc = window.originalCloudDescData.moveStrategies?.[m.id];
                const newDesc = window.currentEditorDescData.moveStrategies?.[m.id];

                if (isDiff(m, oldFrame) || isDiff(newDesc, oldDesc)) {
                    add('move', `${moveTab}::${m.id}`, {
                        frame_data: m,
                        desc_data: newDesc || []
                    });
                }
            });

            cloudMoves.forEach(oldM => {
                if (!localMoves.find(m => m.id === oldM.id)) {
                    add('move', `${moveTab}::${oldM.id}`, null);
                }
            });
        };

        const scanOverview = () => {
            ['profile', 'playstyle', 'overview', 'strategy'].forEach(sec => {
                if (isDiff(window.currentEditorDescData[sec], window.originalCloudDescData[sec])) {
                    add(sec, 'full', window.currentEditorDescData[sec]);
                }
            });

            const localExtras = window.currentEditorDescData.extras || [];
            const cloudExtras = window.originalCloudDescData.extras || [];

            localExtras.forEach(ext => {
                const oldExt = cloudExtras.find(o => o.title === ext.title);
                if (isDiff(ext, oldExt)) add('extra', ext.title, ext);
            });

            cloudExtras.forEach(oldExt => {
                if (!localExtras.find(e => e.title === oldExt.title)) {
                    add('extra', oldExt.title, null);
                }
            });
        };

        // Every keyed section has one shape, keyed by a different field
        // (character_tabs.js).
        const scanKeyedList = (field, keyField, scope) => {
            const local = window.currentEditorDescData[field] || [];
            const cloud = window.originalCloudDescData[field] || [];

            local.forEach(entry => {
                const old = cloud.find(o => o[keyField] === entry[keyField]);
                if (isDiff(entry, old)) add(scope, entry[keyField], entry);
            });

            cloud.forEach(old => {
                if (!local.find(e => e[keyField] === old[keyField])) {
                    add(scope, old[keyField], null);
                }
            });
        };

        // Order. The scans pair entries by identity, so a list whose entries only moved
        // would report "no changes". One payload per list names the new sequence, only
        // when it differs, keyed by the path editor-reorder.js names the strip by.
        const scanOrder = (spec, localList, cloudList, identity) => {
            const local = (localList || []).map(identity);
            const cloud = (cloudList || []).map(identity);

            // Only when every entry has a unique identity (combo group titles may repeat):
            // otherwise nothing is recorded, since a lost reorder is visible and repeatable
            // and a shuffled page is neither. applyDeltaToData refuses the same shapes.
            const usable = (arr) => arr.length > 0
                && arr.every(v => v !== null && v !== undefined && v !== '')
                && new Set(arr.map(String)).size === arr.length;
            if (!usable(local) || !usable(cloud)) return;

            const l = local.map(String);
            const c = cloud.map(String);

            // Same members only: an added or removed entry is the entry scans' job.
            if (l.length !== c.length) return;
            if (l.join(' ') === c.join(' ')) return;
            if ([...l].sort().join(' ') !== [...c].sort().join(' ')) return;

            add('order', spec, l);
        };

        const scanEveryOrder = () => {
            const desc = window.currentEditorDescData || {};
            const cloudDesc = window.originalCloudDescData || {};
            const frame = window.currentEditorFrameData || {};
            const cloudFrame = window.originalCloudFrameData || {};

            (window.FRAME_MOVE_CATEGORIES || []).forEach(cat => {
                scanOrder(`frame.${cat}`, frame[cat], cloudFrame[cat], m => (m ? m.id : null));
            });

            // From the vocabulary, so a new keyed section is reorderable with no change here.
            (window.getKeyedSections ? window.getKeyedSections() : []).forEach(s => {
                scanOrder(`desc.${s.field}`, desc[s.field], cloudDesc[s.field],
                    e => (e ? e[s.keyField] : null));
            });

            // The Overview tab's custom tabs, author-ordered and not a keyed section.
            scanOrder('desc.extras', desc.extras, cloudDesc.extras, e => (e ? e.title : null));
        };

        const scanEveryTab = () => {
            (window.FRAME_MOVE_CATEGORIES || []).forEach(scanMoveTab);
            scanOverview();
            scanEveryOrder();
            // From the vocabulary: a section missed here would never become a delta.
            (window.getKeyedSections ? window.getKeyedSections() : []).forEach(
                s => scanKeyedList(s.field, s.keyField, s.scope));

            // Fixed Block sections (comboIntro): a plain Blocks array under its own scope.
            (window.FIXED_BLOCK_SECTIONS || []).forEach(f => {
                const local = window.currentEditorDescData[f.field];
                const cloud = window.originalCloudDescData[f.field];
                if (isDiff(local, cloud)) {
                    add(f.scope, 'full', local || []);
                }
            });
        };

        // Every character state, not only the open one: the scans read
        // currentEditorDescData, which points at the active state, so the scan runs once
        // per state. The states come from the data (modeData), so a state with content
        // but no declaration is still scanned, and scanning creates no empty buckets.
        const collectStates = () => {
            const base = window.BASE_MODE_ID;
            const ids = [base];
            const seen = new Set(ids);
            [window.editorMasterDescData, window.editorMasterFrameData].forEach(master => {
                Object.keys((master && master.modeData) || {}).forEach(id => {
                    if (!seen.has(id)) { seen.add(id); ids.push(id); }
                });
            });
            return ids;
        };

        const states = collectStates();

        if (states.length <= 1 || typeof window.applyEditorModeView !== 'function') {
            // Every page with no states, which is most of them.
            scanEveryTab();
        } else {
            const savedMode = window.editorActiveMode;
            try {
                states.forEach(modeId => {
                    window.editorActiveMode = modeId;
                    window.applyEditorModeView();
                    scanEveryTab();
                });
            } finally {
                // Put back even if a scan throws, or the editor would move mid-submit.
                window.editorActiveMode = savedMode;
                window.applyEditorModeView();
            }
        }
    }

    return deltas;
};


document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    const pageIdRaw = urlParams.get('page') || urlParams.get('char'); 
    const pageType = urlParams.get('type') || 'character';

    window.currentEditorPageType = pageType;

    // `let`: a ?tab= this character does not have is corrected once the row lands
    // (below), or its edits would submit deltas nobody can see.
    let tabId = urlParams.get('tab') || 'overview';
    const moveId = urlParams.get('move');
    
    const editTicketId = urlParams.get('editTicket'); 
    window.activeEditTicketId = editTicketId;
    window.interceptedTicketData = null;
    // Cleared with the data it explains.
    window.interceptedTicketLoadError = null;

    window.currentGlobalUsername = "Anonymous";
    window.currentGlobalUserId = null;
    if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session && session.user) {
            window.currentGlobalUsername = typeof window.getDisplayName === 'function'
                ? window.getDisplayName(session)
                : session.user.email.split('@')[0];
            window.currentGlobalUserId = session.user.id;
        }
    }

    const titleEl = document.getElementById('editor-title');
    const subTitleEl = document.getElementById('editor-subtitle');

    if (!pageIdRaw || !tabId) {
        titleEl.textContent = "Error: Missing Context";
        subTitleEl.textContent = "Please initiate edits directly from a valid wiki page.";
        return;
    }

    const pageId = pageIdRaw.toLowerCase();

    // Told on the way in as well as at Submit, so nobody below the page's role writes
    // a whole edit first. Signed out, they are asked to sign in at Submit; the
    // Playground submits nothing.
    if (window.currentGlobalUserId && !urlParams.has('playground')) {
        if (!(await window.warnIfBelowPageRole(pageId))) {
            window.cancelEditor();
            return;
        }
    }

    if (pageType === 'system' || pageType === 'tierlist') {
        document.getElementById('tab-m1s')?.remove();
        document.getElementById('tab-skills')?.remove();
        document.getElementById('tab-specials')?.remove();
    }

    const pageDisplay = pageIdRaw.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    let exactCharName = pageDisplay;
    if (window.CHARACTER_COLORS) {
        const foundKey = Object.keys(window.CHARACTER_COLORS).find(k => k.toLowerCase() === pageIdRaw.replace(/_/g, ' ').toLowerCase());
        if (foundKey) exactCharName = foundKey;
    }

    const fakeTitle = document.createElement('div');
    fakeTitle.className = 'character-title';
    fakeTitle.classList.add('hidden');
    fakeTitle.textContent = exactCharName;
    document.body.appendChild(fakeTitle);

    if (typeof window.applyCharacterTheme === 'function') {
        window.applyCharacterTheme();
    }
    
    const targetPreviewTab = document.getElementById(`tab-${tabId}`);
    if (targetPreviewTab) targetPreviewTab.classList.remove('hidden');

    try {
        let descData = null;
        let frameData = null;
        
        try {
            let cloudData = null;
            
            if (window.supabaseClient) {
                // The Playground's blank page has no row to fetch.
                if (!(window.editorPlayground && window.editorPlayground.blankPage)) {
                    const { data, error } = await window.supabaseClient
                        .from('page_data')
                        .select('*')
                        .eq('page_id', pageId)
                        .single();

                    if (!error && data) cloudData = data;
                }

                // Which optional tabs this character has, before any tab strip is built, so the
                // editor never offers a tab the page does not show.
                if (typeof window.applyOptionalTabsFromPageRow === 'function') {
                    window.applyOptionalTabsFromPageRow(cloudData);

                    // A ?tab= this character lacks falls back to the default, like an undeclared
                    // ?mode= (character_modes.js).
                    const reachable = window.getCharacterTabIds({ includeInjected: true, editableOnly: true });
                    if (pageType === 'character' && !reachable.includes(tabId)) {
                        tabId = window.getDefaultCharacterTabId();
                    }
                }
                
                // Intercepting: the ticket is fetched, and a failure is recorded and enforced at
                // Submit. The URL says what the person meant, and a session that silently
                // became a new submission would put a second revision in the queue.
                if (editTicketId) {
                    const { data: tData, error: tErr } = await window.supabaseClient
                        .from('pending_revisions').select('*').eq('id', editTicketId).single();
                    if (!tErr && tData) {
                        window.interceptedTicketData = tData;
                    } else {
                        window.interceptedTicketLoadError = (tErr && tErr.message) || 'not found';
                        console.error(`[Editor] Ticket ${editTicketId} did not load:`, tErr);
                    }
                }
            }

            let baseCloudDesc = null;
            let baseCloudFrame = null;

            if (cloudData && cloudData.desc_data) {
                baseCloudDesc = cloudData.desc_data;
                
                // Rescue: a system page with no tabs.
                if (window.currentEditorPageType === 'system' && !baseCloudDesc.tabs) {
                    let rescued = [];
                    if (baseCloudDesc.overview) rescued.push(...baseCloudDesc.overview);
                    if (baseCloudDesc.strategy) rescued.push(...baseCloudDesc.strategy);
                    baseCloudDesc = {
                        tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Recovered Data', layout: 'full', blocks: rescued }] }]
                    };
                }
                
                baseCloudFrame = cloudData.frame_data || { m1s: [], skills: [], specials: [] };
            } else {
                if (window.currentEditorPageType === 'system') {
                    baseCloudDesc = { tabs: [{ tabId: "overview", tabLabel: "Overview", sections: [{ sectionTitle: "Introduction", layout: "full", blocks: [] }] }] };
                } else if (window.currentEditorPageType === 'tierlist') {
                    baseCloudDesc = { tabs: [{ id: "overall", label: "Overall", tiers: [], changelog: [] }] };
                } else {
                    baseCloudDesc = {
                        profile: { stats: [], image: "" }, playstyle: { likes: [], dislikes: [] },
                        overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {}
                    };
                }
                baseCloudFrame = { m1s: [], skills: [], specials: [] };
            }

            window.originalCloudDescData = JSON.parse(JSON.stringify(baseCloudDesc));
            window.originalCloudFrameData = JSON.parse(JSON.stringify(baseCloudFrame));

            const forceLoadDraft = urlParams.get('loadDraft') === 'true';
            const specificDraftKey = urlParams.get('draftKey');

            // An open submission on this page: the editor asks whether to continue it
            // (through ?editTicket=, like EDIT on My Submissions), since a new one would
            // repeat its content. Silent on failure on purpose: it is an offer, and a failed
            // query must not stand between someone and the editor.
            if (!window.editorPlayground && !editTicketId && !forceLoadDraft && !specificDraftKey && window.currentGlobalUserId) {
                try {
                    const { data: open } = await window.supabaseClient
                        .from('pending_revisions')
                        .select('id, author_id, created_at, status')
                        .eq('page_id', pageId)
                        .eq('author_id', window.currentGlobalUserId)
                        .in('status', ['pending', 'ticket_open'])
                        .order('created_at', { ascending: false })
                        .limit(1);
                    const mine = (Array.isArray(open) ? open : []).find(r => r
                        && r.id && r.author_id === window.currentGlobalUserId
                        && ['pending', 'ticket_open'].includes(r.status));
                    if (mine) {
                        const when = new Date(mine.created_at).toLocaleString();
                        const continueIt = await window.customConfirm(
                            `You already have a submission waiting for review on this page (sent ${when}).\n\n`
                            + 'Edit that one, so your changes stay in a single submission, or start a new one?',
                            'EDIT MY SUBMISSION', false, 'START A NEW ONE');
                        if (continueIt) {
                            const next = new URL(window.location.href);
                            next.searchParams.set('editTicket', mine.id);
                            window.location.href = next.toString();
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[Editor] Could not check for an open submission:', e);
                }
            }

            // One draft per page: the editor always holds the whole page, whatever tab is open.
            const defaultDraftKey = `wiki_draft_${pageId}`;

            const targetKey = specificDraftKey || defaultDraftKey;
            const rawDraft = localStorage.getItem(targetKey);
            let useDraft = false;

            // The handshake. The Playground keeps one draft of its own and never asks about
            // the page's.
            if (window.editorPlayground) {
                const kept = window.editorPlayground.draft;
                if (kept) {
                    descData = kept.desc_data;
                    frameData = kept.frame_data || baseCloudFrame;
                    useDraft = true;
                }
            }
            else if (window.interceptedTicketData) {
                if (window.interceptedTicketData.is_delta) {
                    const { newDesc, newFrame } = window.applyDeltaToData(
                        baseCloudDesc, baseCloudFrame, 
                        window.interceptedTicketData.target_scope, 
                        window.interceptedTicketData.target_key, 
                        window.interceptedTicketData.delta_payload
                    );
                    descData = newDesc;
                    frameData = newFrame;
                } else {
                    descData = window.interceptedTicketData.desc_data || baseCloudDesc;
                    frameData = window.interceptedTicketData.frame_data || baseCloudFrame;
                }
                useDraft = true; // skips the local draft logic
                console.log(`[Editor] Intercept Mode Active: Loaded Ticket ${editTicketId}`);
            } 
            else if (rawDraft) {
                try {
                    const parsedDraft = JSON.parse(rawDraft);
                    if (forceLoadDraft) {
                        useDraft = true;
                    } else {
                        // A draft saved before this browser submitted the page holds changes already in
                        // the queue.
                        const submittedAt = typeof window.draftSubmittedAt === 'function'
                            ? window.draftSubmittedAt(pageId, parsedDraft.timestamp) : 0;
                        const restore = await window.customConfirm(submittedAt
                            ? `A local draft was found for this character.\n\n${window.duplicateDraftWarning(submittedAt)}\n\nDo you want to restore it anyway, or load the live cloud version?`
                            : `An unsaved local draft was found for this character.\n\nDo you want to restore your local progress, or load the live cloud version?`, "RESTORE DRAFT", false);
                        if (restore) useDraft = true;
                    }

                    if (useDraft) {
                        descData = parsedDraft.desc_data || baseCloudDesc;
                        frameData = parsedDraft.frame_data || baseCloudFrame;
                        console.log(`[Editor] Restored local draft: ${targetKey}`);
                    }
                } catch (e) {
                    console.warn("Corrupt local draft found. Discarding.");
                    localStorage.removeItem(targetKey);
                }
            }

            if (!useDraft) {
                console.log(`[Editor] Loaded ${pageId} strictly from Cloud.`);
                descData = baseCloudDesc;
                frameData = baseCloudFrame;
            }
            
            window.isDiffModeActive = false;
            window.cachedMasterFrameData = window.cachedMasterFrameData || {};
            window.cachedMasterFrameData[pageId] = frameData;
            
        } catch (e) {
            console.error("Failed to initialize editor data:", e);
            window.editorAlert("Critical Error loading page data. Check console.");
            return;
        }

        // Before the preview, so a ?mode= link opens on its state. From here
        // currentEditorDescData and currentEditorFrameData are views onto the masters.
        if (typeof window.initEditorModes === 'function') {
            await window.initEditorModes(pageId, descData, frameData);
        }
        if (typeof window.refreshHouseStyleButton === 'function') window.refreshHouseStyleButton();

        if (window.interceptedTicketData) {
            titleEl.innerHTML = `<span class="editor-intercept-label">Intercepting Submission</span>`;
            subTitleEl.textContent = `Reviewing and editing submission by ${window.interceptedTicketData.author_name}`;
        } else if (moveId) {
            titleEl.textContent = `Editing Move`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId} / ${moveId}`;
        } else {
            titleEl.textContent = `Editing Section`;
            subTitleEl.textContent = `${pageDisplay} / ${tabId}`;
        }

        // The active state's first move is the one to open.
        const modeFrame = window.currentEditorFrameData || frameData;
        if ((window.FRAME_MOVE_CATEGORIES || []).includes(tabId) && typeof window.loadMoveSection === 'function') {
            let activeMoveId = moveId;
            if (!activeMoveId && modeFrame && modeFrame[tabId] && modeFrame[tabId].length > 0) {
                activeMoveId = modeFrame[tabId][0].id;
            }
            try { await window.loadMoveSection(pageId, tabId, activeMoveId, pageType); } catch(e) { console.warn("Move section build skipped:", e); }
        }
        
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(pageId, pageType);
        }

        window.currentEditorTabId = tabId;
        window.currentEditorCharId = pageId;

        // applyEditorModeView points these at the active state; the masters here would
        // send every edit into the base kit.
        if (typeof window.applyEditorModeView === 'function') {
            window.applyEditorModeView();
        } else {
            window.currentEditorDescData = descData;
            window.currentEditorFrameData = frameData;
        }

        const editDesc = window.currentEditorDescData;
        const editFrame = window.currentEditorFrameData;

        if (moveId) {
            // This branch skips initFullTabEditor, which renders the tab strip.
            if (typeof window.renderEditorTabNav === 'function') window.renderEditorTabNav(tabId);

            const moveStats = editFrame ? editFrame[tabId]?.find(m => m.id === moveId) : null;
            const moveStrats = editDesc ? editDesc.moveStrategies?.[moveId] : null;
            initPerMoveEditor(moveId, moveStats, moveStrats);
            setTimeout(() => {
                const previewCard = document.querySelector(`.live-preview-pane #strategy-${CSS.escape(String(moveId))}`);
                if (previewCard) previewCard.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
            }, 300);
        } else {
            initFullTabEditor(pageId, tabId, editDesc, editFrame);
        }

        if (window.editorPlayground && typeof window.playgroundBooted === 'function') await window.playgroundBooted();

    } catch (error) {
        console.error("Editor failed to initialize context:", error);
        titleEl.textContent = "System Error";
        subTitleEl.textContent = "Check browser console for detailed logs.";
    }

    window.openQAModal = function(isIntercept) {
        return new Promise((resolve) => {
            let overlay = document.getElementById('dynamic-qa-modal-overlay');
            if (!overlay) {
                overlay = document.createElement('dialog');
                overlay.id = 'dynamic-qa-modal-overlay';
                overlay.className = 'site-dialog';
                overlay.setAttribute('aria-labelledby', 'qa-modal-title');
                document.body.appendChild(overlay);
            }
            if (overlay.open) { resolve(null); return; }

            // Every way out but CONFIRM is a cancel, Escape included, or the submit
            // would wait on this box for good.
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                overlay.close();
                resolve(value);
            };
            overlay.addEventListener('close', () => finish(null), { once: true });

            let currentForm = 'short';

            const renderForm = () => {
                let formHtml = '';

                const tabsHtml = `
                    <div class="qa-tabs-row">
                        <button class="btn-sys ${currentForm === 'short' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-short">Short</button>
                        <button class="btn-sys ${currentForm === 'long' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-long">Long</button>
                        <button class="btn-sys ${currentForm === 'technical' ? 'btn-sys-blue' : 'btn-sys-regular'} qa-tab-btn" id="qa-tab-technical">Technical</button>
                    </div>
                `;

                if (currentForm === 'short') {
                    formHtml = `
                        <label class="qa-field-label">CHANGELOG SUMMARY (Max 50 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-short" placeholder="Briefly describe what you changed..."></textarea>
                        <label class="qa-field-label qa-field-label-spaced">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'long') {
                    formHtml = `
                        <label class="qa-field-label">DETAILED CHANGELOG (Max 500 Words)</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-long" placeholder="Provide a detailed explanation of your edits, reasoning, and context..."></textarea>
                        <label class="qa-field-label qa-field-label-spaced">SOURCE / EVIDENCE (Optional)</label>
                        <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                    `;
                } else if (currentForm === 'technical') {
                    formHtml = `
                        <div class="qa-field-row">
                            <div class="qa-field-col">
                                <label class="qa-field-label">CONFIDENCE LEVEL</label>
                                <select id="qa-confidence" class="editor-select">
                                    <option value="N/A">N/A</option>
                                    <option value="High">High - 100% Certain (Tested in-game/files)</option>
                                    <option value="Medium">Medium - Fairly Confident</option>
                                    <option value="Low">Low - Guessing / Needs verification</option>
                                </select>
                            </div>
                            <div class="qa-field-col">
                                <label class="qa-field-label">SOURCE / EVIDENCE (Optional)</label>
                                <input type="text" id="qa-evidence" class="editor-input" placeholder="URL or link to proof...">
                            </div>
                        </div>
                        <label class="qa-field-label">TECHNICAL CHANGELOG</label>
                        <textarea id="qa-changelog" class="editor-textarea qa-textarea-long" placeholder="Detail frame data changes, math, hitboxes, or engine mechanics..."></textarea>
                    `;
                }

                // The Long and Technical forms hold the longer changelog.
                overlay.classList.toggle('dialog-lg', currentForm !== 'short');
                overlay.innerHTML = `
                    <div class="dialog-header"><h3 id="qa-modal-title">QUALITY ASSURANCE</h3></div>
                    <div class="dialog-body">
                        ${tabsHtml}
                        <div id="qa-form-container" class="qa-form-container">
                            ${formHtml}
                        </div>
                    </div>
                    <div class="dialog-footer">
                        <button id="btn-qa-cancel" class="btn-sys btn-sys-regular">CANCEL</button>
                        <button id="btn-qa-confirm" class="btn-sys btn-sys-blue">${isIntercept ? 'UPDATE SUBMISSION' : 'CONFIRM & UPLOAD'}</button>
                    </div>
                `;

                overlay.querySelector('#qa-tab-short').onclick = () => { currentForm = 'short'; renderForm(); };
                overlay.querySelector('#qa-tab-long').onclick = () => { currentForm = 'long'; renderForm(); };
                overlay.querySelector('#qa-tab-technical').onclick = () => { currentForm = 'technical'; renderForm(); };

                overlay.querySelector('#btn-qa-cancel').onclick = () => finish(null);

                overlay.querySelector('#btn-qa-confirm').onclick = () => {
                    const changelog = overlay.querySelector('#qa-changelog').value.trim();
                    const confidence = overlay.querySelector('#qa-confidence') ? overlay.querySelector('#qa-confidence').value : 'N/A';
                    const evidence = overlay.querySelector('#qa-evidence') ? overlay.querySelector('#qa-evidence').value.trim() : '';
                    
                    const words = changelog.split(/\s+/).filter(w => w.length > 0).length;
                    if (currentForm === 'short' && words > 50) {
                        window.editorAlert(`Short form QA is limited to 50 words. You are currently at ${words} words. Please shorten it or use the Long form.`);
                        return;
                    }
                    if ((currentForm === 'long' || currentForm === 'technical') && words > 500) {
                        window.editorAlert(`This form is limited to 500 words. You are currently at ${words} words.`);
                        return;
                    }

                    if (!changelog) {
                        window.editorAlert("Please provide a changelog summary of your edits.");
                        return;
                    }

                    finish({ changelog, confidence, evidence });
                };
            };

            renderForm();
            // No click outside: it holds the changelog being typed.
            window.openDialog(overlay);
        });
    };

    const submitBtn = document.getElementById('submit-payload-btn');
    // Never wired in the Playground, where the button is Pull.
    if (submitBtn && !window.editorPlayground) {
        if (window.activeEditTicketId) {
            submitBtn.textContent = "UPDATE SUBMISSION";
            submitBtn.classList.remove('btn-sys-blue');
            submitBtn.classList.add('btn-sys-purple');
        }

        submitBtn.addEventListener('click', async () => {
            if (!window.supabaseClient) { window.editorAlert("Database connection is offline!"); return; }
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) { window.openAuthModal(); return; }

            // The exclusive page guard, from page_permissions, so a restricted page is a
            // row, not code. It only chooses the message (asked before the QA modal, not an
            // RLS refusal after it): the policy is the boundary, so the two must agree. A
            // viewer is soft-banned and told here.
            const { data: ownRole } = await window.supabaseClient
                .from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
            if ((ownRole?.role || '').trim().toLowerCase() === 'viewer') {
                window.editorAlert("Your account can't submit edits right now. If you think that's a mistake, get in touch on Discord.");
                return;
            }

            const { data: permissionRow } = await window.supabaseClient
                .from('page_permissions').select('page_id, required_role')
                .eq('page_id', pageId.toLowerCase()).maybeSingle();

            if (permissionRow) {
                const { data: roleData } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
                const userRole = (roleData?.role || 'guest').trim().toLowerCase();
                const requiredRole = (permissionRow.required_role || 'trusted_editor').trim().toLowerCase();

                // Rank, never role names: a page asking for trusted_editor admits everyone
                // above it. Without site_utils.js, only the owner passes: the safe way to be wrong.
                const allowed = typeof window.roleMeets === 'function'
                    ? window.roleMeets(userRole, requiredRole)
                    : userRole === 'owner';

                if (!allowed) {
                    // required_role is trusted_editor, admin or owner.
                    const restrictedTo = {
                        owner: "READ ONLY: This page is restricted to the site owner.",
                        admin: "READ ONLY: This page is restricted to Admins and the site owner.",
                    };
                    window.editorAlert(restrictedTo[requiredRole]
                        || "READ ONLY: This is an exclusive systemic page. You require the 'Trusted Editor', 'Reviewer' or 'Admin' role to submit revisions here.");
                    return;
                }
            }

            // The cooldown bypass, by rank, as check_revision_rate_limit() decides it. The
            // trigger is the boundary; this only picks the message.
            let skipsCooldown = false;
            if (window.roleMeets(ownRole?.role, 'trusted_editor')) {
                const { data: settings } = await window.supabaseClient
                    .from('site_settings').select('staff_bypass_submission_cooldown').maybeSingle();
                // No row or a failed read means enforce, as the trigger's COALESCE does.
                skipsCooldown = settings?.staff_bypass_submission_cooldown === true;
            }

            // An intercept whose ticket never loaded is refused before anything is scanned:
            // routed on the URL's intent, since inserting is a different action, not a
            // lesser update. Here, because an empty scan would report the wrong problem.
            if (window.activeEditTicketId && !window.interceptedTicketData) {
                window.editorAlert(
                    "This submission could not be loaded, so it cannot be updated"
                    + (window.interceptedTicketLoadError ? ` (${window.interceptedTicketLoadError})` : '')
                    + ". Nothing has been submitted. Reopen it from My Submissions and try again."
                );
                return;
            }

            const COOLDOWN_MINUTES = 3;
            const lastSubmitTime = localStorage.getItem('wiki_last_submit_time');
            if (lastSubmitTime && !window.activeEditTicketId && !skipsCooldown) {
                const timeSinceLastSubmit = Date.now() - parseInt(lastSubmitTime, 10);
                const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
                if (timeSinceLastSubmit < cooldownMs) {
                    const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSubmit) / 1000);
                    window.editorAlert(`Anti-Spam: Please wait ${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s before submitting another revision.`);
                    return;
                }
            }

            if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();

            submitBtn.textContent = "CHECKING...";
            try {
                const { data: liveData, error: liveError } = await window.supabaseClient.from('page_data').select('desc_data, frame_data').eq('page_id', pageId).single();
                if (!liveError && liveData && !window.activeEditTicketId) {
                    let hasCollision = false;
                    const tabId = window.currentEditorTabId;
                    const isDiff = (objA, objB) => JSON.stringify(objA || null) !== JSON.stringify(objB || null);

                    // originalCloudDescData is the active state's slice, so the row just read is
                    // narrowed the same way, or every state would warn of a collision.
                    const mode = window.editorActiveMode;
                    const onBase = window.isBaseMode(mode);
                    const liveDesc = onBase ? liveData.desc_data : (liveData.desc_data?.modeData || {})[mode] || {};
                    const liveFrame = onBase ? liveData.frame_data : (liveData.frame_data?.modeData || {})[mode] || {};

                    if (pageType === 'system' || pageType === 'tierlist') {
                        hasCollision = isDiff(liveDesc, window.originalCloudDescData);
                    }

                    if ((window.FRAME_MOVE_CATEGORIES || []).includes(tabId)) {
                        let moveId = new URLSearchParams(window.location.search).get('move');
                        if (!moveId) {
                            const activeBtn = document.querySelector('.daw-variant-tabs .daw-tab-btn.active');
                            if (activeBtn) moveId = activeBtn.id.replace('move-nav-', '');
                        }
                        if (moveId) {
                            hasCollision = isDiff(liveDesc?.moveStrategies?.[moveId], window.originalCloudDescData?.moveStrategies?.[moveId]) || 
                                           isDiff((liveFrame?.[tabId] || []).find(m => m.id === moveId), (window.originalCloudFrameData?.[tabId] || []).find(m => m.id === moveId));
                        }
                    } else if (tabId === 'overview') {
                        const sec = window.currentOverviewSection || 'overview';
                        if (sec === 'profile') hasCollision = isDiff(liveDesc?.profile, window.originalCloudDescData?.profile);
                        else if (sec === 'playstyle') hasCollision = isDiff(liveDesc?.playstyle, window.originalCloudDescData?.playstyle);
                        else if (sec === 'overview') hasCollision = isDiff(liveDesc?.overview, window.originalCloudDescData?.overview);
                        else if (sec === 'strategy') hasCollision = isDiff(liveDesc?.strategy, window.originalCloudDescData?.strategy);
                        else if (sec.startsWith('extra-')) {
                            const idx = parseInt(sec.split('-')[1]);
                            hasCollision = isDiff(liveDesc?.extras?.[idx], window.originalCloudDescData?.extras?.[idx]);
                        }
                    } else if (tabId === 'matchups' && window.currentMatchupIndex !== undefined) {
                        hasCollision = isDiff(liveDesc?.matchups?.[window.currentMatchupIndex], window.originalCloudDescData?.matchups?.[window.currentMatchupIndex]);
                    } else if (window.usesSharedKeyedUI(tabId)
                            && window.currentKeyedIndex?.[tabId] !== undefined) {
                        const field = window.getKeyedSectionByTab(tabId).field;
                        const i = window.currentKeyedIndex[tabId];
                        hasCollision = isDiff(liveDesc?.[field]?.[i], window.originalCloudDescData?.[field]?.[i]);
                    }

                    if (hasCollision) {
                        const proceed = await window.customConfirm("WARNING: Another contributor's edits to this specific section were just approved while you were typing!\n\nIf you submit now, your changes will be queued and may overwrite theirs if approved by staff. Do you want to proceed and let staff resolve the conflict?", "PROCEED ANYWAY", true);
                        if (!proceed) {
                            submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                            return; 
                        }
                    }
                }
            } catch (e) { console.warn("Collision check failed, proceeding safely.", e); }

            // Character names and broken format tags in what this submission changes,
            // shown once more; the editor may still send.
            if (typeof window.confirmWritingChecks === 'function' && !(await window.confirmWritingChecks())) {
                submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                return;
            }

            submitBtn.textContent = "WAITING ON QA...";
            
            const qaResult = await window.openQAModal(!!window.activeEditTicketId);
            
            if (!qaResult) {
                submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                return; // cancelled
            }

            submitBtn.textContent = "UPLOADING...";
            submitBtn.disabled = true;

            let payloadsToInsert = [];

            // A row for the queue. rowFor takes a scope already wrapped for its state.
            const rowFor = (targetScope, targetKey, deltaPayload) => ({
                page_id: pageId,
                page_type: pageType,
                // The legacy fallback is the whole page: whatever reads it expects one.
                desc_data: window.editorMasterDescData || window.currentEditorDescData,
                frame_data: pageType === 'system' ? null : (window.editorMasterFrameData || window.currentEditorFrameData),
                is_delta: true,
                target_scope: targetScope,
                target_key: targetKey,
                delta_payload: deltaPayload,
                author_id: session.user.id,
                author_name: window.currentGlobalUsername || "Contributor",
                qa_metadata: { changelog: qaResult.changelog, confidence: qaResult.confidence, evidence: qaResult.evidence }
            });
            const buildPayload = (targetScope, targetKey, deltaPayload) => {
                const scoped = scopeSubmissionDelta(targetScope, targetKey);
                return rowFor(scoped.scope, scoped.key, deltaPayload);
            };

            // An intercept with one rebuildable scope rebuilds exactly that. A 'multi' or
            // legacy ticket falls through to the scanner below. An author updating their own
            // submission is scanned like a new one, since they may have changed a section
            // the ticket did not touch.
            const isSelfEdit = !!(window.interceptedTicketData && window.currentGlobalUserId
                && window.currentGlobalUserId === window.interceptedTicketData.author_id);
            const interceptDelta = window.interceptedTicketData && !isSelfEdit
                ? window.buildInterceptDelta(window.interceptedTicketData)
                : null;

            if (interceptDelta) {
                payloadsToInsert.push(
                    buildPayload(interceptDelta.scope, interceptDelta.key, interceptDelta.delta));
            }
            // A normal submission, or an intercept the branch above could not scope.
            else {
                (await window.collectEditorDeltas())
                    .forEach(d => payloadsToInsert.push(rowFor(d.scope, d.key, d.payload)));

                // A 'multi' or legacy intercept can scan empty, and "nothing to submit" is the truth.
                if (payloadsToInsert.length === 0) {
                    submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
                    submitBtn.disabled = false;
                    window.editorAlert("No changes detected against the live database! Nothing to submit.");
                    return;
                }
            }

            // Batching: several deltas become one 'multi' ticket, during an intercept too.
            let finalPayloads = [];
            if (payloadsToInsert.length > 1) {
                const batchedDeltas = payloadsToInsert.map(p => ({
                    scope: p.target_scope,
                    key: p.target_key,
                    payload: p.delta_payload
                }));
                
                const masterTicket = buildPayload('multi', 'batch', batchedDeltas);
                finalPayloads = [masterTicket];
            } else {
                finalPayloads = payloadsToInsert;
            }

            let dbError = null;
            const wasUpdate = !!window.interceptedTicketData;
            let newTicket = null;

            // The case with intent but no data was refused at the top, so these agree.
            if (window.interceptedTicketData) {
                const payload = finalPayloads[0];
                payload.author_id = window.interceptedTicketData.author_id;
                payload.author_name = window.interceptedTicketData.author_name;
                payload.status = window.interceptedTicketData.status;

                const oldQa = window.interceptedTicketData.qa_metadata || {};
                payload.qa_metadata = oldQa;

                // Only someone other than the author gets the "Staff Note" framing.
                if (isSelfEdit) {
                    payload.qa_metadata.changelog = qaResult.changelog;
                } else {
                    payload.qa_metadata.changelog = `${qaResult.changelog}\n\n(Staff Note: Minor edits applied by ${window.currentGlobalUsername || 'Staff'} prior to approval)\n\nOriginal Contributor Log:\n${oldQa.changelog || 'None'}`;
                }

                const { error } = await window.supabaseClient.from('pending_revisions').update(payload).eq('id', window.activeEditTicketId);
                dbError = error;
            } else {
                console.log(`Pushing ${finalPayloads.length} Master Ticket(s) to Revision Queue...`);
                // .select() returns the new row, so the editor can carry on as an edit of it.
                const { data: inserted, error } = await window.supabaseClient
                    .from('pending_revisions').insert(finalPayloads).select();
                dbError = error;
                if (!error && Array.isArray(inserted) && inserted.length === 1) newTicket = inserted[0];
            }

            submitBtn.disabled = false;

            if (dbError) {
                console.error("Supabase Error:", dbError);
                window.editorAlert("Failed to save to database: " + dbError.message);
                submitBtn.textContent = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";
            } else {
                // Drafts are kept. What is recorded is when this browser sent the page, and a
                // draft saved before then warns that sending it again duplicates it.
                window.markPageSubmitted(pageId);

                submitBtn.textContent = wasUpdate ? "UPDATED!" : "SUBMITTED!";
                submitBtn.style.backgroundColor = "#22c55e";
                submitBtn.style.color = "#000";

                // From here, the button updates the submission it just made.
                if (newTicket) window.adoptOwnSubmission(newTicket);
                const fallbackText = window.activeEditTicketId ? "UPDATE SUBMISSION" : "Submit";

                localStorage.setItem('wiki_last_submit_time', Date.now().toString());

                setTimeout(() => {
                    submitBtn.textContent = fallbackText;
                    submitBtn.style.backgroundColor = "";
                    submitBtn.style.color = "";

                    if (wasUpdate) {
                        window.editorAlert(isSelfEdit
                            ? "Your submission is updated."
                            : "Ticket successfully updated! You can now close this tab and return to the Admin Panel.");
                    }
                }, 3000);
            }
        });
    }
});

/**
 * True to carry on into the editor. It makes the submit guard's own two reads
 * and roleMeets, so the warning and the refusal agree. A failed read carries on
 * without a warning on purpose: the submit guard reads again and says why.
 * @since v1.2
 */
window.warnIfBelowPageRole = async function(pageId) {
    const [{ data: permissionRow }, { data: roleData }] = await Promise.all([
        window.supabaseClient.from('page_permissions').select('required_role').eq('page_id', pageId).maybeSingle(),
        window.supabaseClient.from('user_roles').select('role').eq('user_id', window.currentGlobalUserId).maybeSingle(),
    ]);
    if (!permissionRow) return true;

    const requiredRole = (permissionRow.required_role || 'trusted_editor').trim().toLowerCase();
    if (window.roleMeets(roleData?.role, requiredRole)) return true;

    const ROLE_NAMES = { trusted_editor: 'Trusted Editor', reviewer: 'Reviewer', admin: 'Administrator' };
    const restriction = requiredRole === 'owner'
        ? 'This page is restricted to the site owner.'
        : `This page is restricted to the ${ROLE_NAMES[requiredRole] || requiredRole} role and above.`;
    return window.customConfirm(
        `You do not have high enough clearance to submit an edit for this page. ${restriction} Do you still wish to edit the page?`,
        'EDIT ANYWAY', false, 'GO BACK');
};

