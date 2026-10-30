/**
 * Dogslamloop Wiki - history.html
 *
 * Renders the approved-revision ledger for one page: ?page=<page_id>, newest
 * first, one revision per page load (?rev=<id>), with NEWER/OLDER links.
 *
 * A revision approved since 20261029000001 shows the WHOLE page as it was
 * right after it (get_page_after_revision). One approved before that has no
 * approval time, so it shows what it changed, and says so.
 *
 * WHAT IT IS, AND WHAT IT IS NOT
 *
 * This is a READER of the same data admin.html reviews, on a page any visitor
 * can open. It reads approved_revisions, a view of approved submissions without
 * their review chat or votes (20261030000000), so the database is what keeps
 * unapproved work and the review discussion out of it, not this file.
 *
 * HOW IT REACHES THE REST OF THE SITE
 *
 * It owns no renderer. A revision is reconstructed into the shape the live
 * page renderers already expect, and then handed to them:
 *
 *   applyDeltaToData   site_utils.js   rebuilds a delta revision into full
 *                                      desc/frame data (defined once there,
 *                                      loaded before this file)
 *   fetchCloudCharacterData            site_utils.js. Every renderer reads the
 *                                      page through it, so servePageAs answers
 *                                      for this page with the historical
 *                                      content, and the live page's own code
 *                                      draws it
 *   buildPageSkeleton                  page_router.js, the live page's markup
 *   bootCharacterContent               page_boot.js, the live page's steps:
 *                                      tabs, moves, states, descriptions
 *   currentEditorDescData              tierlist.js still reads this, so the
 *                                      tier list branch sets it
 *   applyCharacterTheme                site_meta.js, so a historical page wears
 *                                      the character's colour like the live one
 *
 * That reuse is the point: a "history renderer" of its own would drift from
 * what the live pages show, and the diff a reviewer approved would stop
 * matching the diff a reader can inspect.
 *
 * THE INPUT THAT IS NOT TRUSTED
 *
 * Revision fields are contributor-submitted, so the card escapes them. Tab
 * ids now come from the vocabulary alone (page_router.js): a move delta's
 * target_key used to add a tab here, through an inline onclick until
 * 2026-09-06, which was executable.
 *
 * escapeHtml is duplicated here rather than imported, matching this codebase's
 * precedent (owner.js, submissions.js, recent-changes.js) of small per-file
 * duplication over new cross-file coupling: admin-core.js is not loaded on this
 * page.
 */

window.historyRevisions = [];
window.currentHistoryIndex = 0;

// The page's display name, for the route the live renderers read (see
// drawCharacterPage).
let historyPageName = null;

// applyDeltaToData is defined once, in site_utils.js (loaded before this file).

// --- RELATIVE PATH CLEANER ---
// Converts "../../medias/..." to "medias/..." so images load correctly from the root directory!
const cleanPaths = (obj) => {
    if (typeof obj === 'string') return obj.replace(/\.\.\/\.\.\//g, '');
    if (Array.isArray(obj)) return obj.map(cleanPaths);
    if (typeof obj === 'object' && obj !== null) {
        const newObj = {};
        for (let key in obj) newObj[key] = cleanPaths(obj[key]);
        return newObj;
    }
    return obj;
};

document.addEventListener('DOMContentLoaded', async () => {
    if (window.initSidebarToggle) window.initSidebarToggle();
    if (window.initMobileNav) window.initMobileNav();
    if (window.buildGlobalSidebarMenu) window.buildGlobalSidebarMenu('global-sidebar-nav');
    if (window.initAuthDock) window.initAuthDock();

    const urlParams = new URLSearchParams(window.location.search);
    const pageId = urlParams.get('page');
    
    if (!pageId) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg">No page specified in URL.</div>`;
        return;
    }
    
    let exactCharName = pageId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (window.CHARACTER_COLORS) {
        const foundKey = Object.keys(window.CHARACTER_COLORS).find(k => k.toLowerCase() === pageId.replace(/_/g, ' ').toLowerCase());
        if (foundKey) exactCharName = foundKey;
    }

    // 1. INJECT NATIVE CHARACTER THEME
    // Set the title exactly to the character name FIRST so the theme engine finds it!
    const titleEl = document.getElementById('history-page-title');
    titleEl.textContent = exactCharName; 
    
    if (typeof window.applyCharacterTheme === 'function') {
        window.applyCharacterTheme();
    }
    
    // Once colors are applied, append the "HISTORY" text
    titleEl.textContent = `${exactCharName} HISTORY`;
    historyPageName = exactCharName;

    if (!window.supabaseClient) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg">Database disconnected. Cannot fetch ledger.</div>`;
        return;
    }

    // 2. FETCH ARRAY OF METADATA (Fast network request)
    const { data: revs, error } = await window.supabaseClient
        .from('approved_revisions')
        .select('*')
        .eq('page_id', pageId)
        .order('created_at', { ascending: false });

    if (error || !revs || revs.length === 0) {
        document.getElementById('history-meta-card').innerHTML = `<div class="empty-tab-msg" style="border: 1px dashed #333; padding: 3rem;">No history recorded for this page yet.</div>`;
        return;
    }

    window.historyRevisions = revs;

    // 3. RENDER ONE REVISION. One per page load, picked by ?rev=<id>: the
    // live page's renderers draw into fixed ids and keep their own caches, so
    // a second revision in the same document would be drawn over the first.
    const wanted = urlParams.get('rev');
    const found = wanted ? revs.findIndex(r => r.id === wanted) : 0;
    window.currentHistoryIndex = found >= 0 ? found : 0;
    window.renderRevision(window.currentHistoryIndex);
});

window.renderRevision = async function(index) {
    const rev = window.historyRevisions[index];
    const total = window.historyRevisions.length;
    const dateStr = new Date(rev.created_at).toLocaleString();
    const qa = rev.qa_metadata || {};
    const reviewer = qa.reviewed_by || 'Legacy System';

    let scopeText = rev.is_delta ? `Target Scope: ${escapeHtml(rev.target_scope.toUpperCase())} [${escapeHtml(rev.target_key)}]` : `Target Scope: FULL OVERWRITE`;
    if (rev.target_scope === 'multi') scopeText = `Target Scope: BATCHED MULTI-EDIT (${rev.delta_payload.length} targets)`;

    // --- RENDER PAGINATION & METADATA CARD ---
    const metaCard = document.getElementById('history-meta-card');
    metaCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; background: var(--bg-main); padding: 0.5rem 1rem; border: 1px solid var(--border-color); border-radius: 4px;">
            ${historyStep(index - 1, '◀ NEWER')}
            <span style="font-family: var(--text-mono); font-size: 0.85rem; color: var(--text-white);">Version ${total - index} of ${total}</span>
            ${historyStep(index + 1, 'OLDER ▶')}
        </div>
        
        <div class="wiki-section" style="border-left: 4px solid var(--accent-blue); padding: 1.5rem; background: var(--bg-secondary); border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px dashed var(--border-color); flex-wrap: wrap; gap: 1rem;">
                <div>
                    <h3 style="margin: 0; color: var(--text-white); font-family: 'CC-Wild-Words', sans-serif; font-size: 1.2rem;">REVISION <span style="color:#a855f7;">#${rev.id.substring(0,8).toUpperCase()}</span></h3>
                    <div style="font-size: 0.75rem; color: var(--accent-blue); font-family: var(--text-mono); margin-top: 0.25rem;">${dateStr}</div>
                </div>
                <div style="text-align: right; font-size: 0.75rem; font-family: var(--text-mono); color: var(--text-muted);">
                    <div style="margin-bottom: 0.25rem;">Author: <strong style="color: #fff; font-size: 0.85rem;">${escapeHtml(rev.author_name)}</strong></div>
                    <div>Approved By: <strong style="color: #34d399; font-size: 0.85rem;">${escapeHtml(reviewer)}</strong></div>
                </div>
            </div>

            <div style="font-size: 0.85rem; color: #d1d5db; line-height: 1.6; font-family: var(--text-mono);">
                <div style="margin-bottom: 0.75rem; display: inline-block; background: #222; padding: 0.25rem 0.5rem; border-radius: 2px; color: #a855f7;">${scopeText}</div><br>
                <strong style="color: #fff; text-transform: uppercase;">Public Changelog:</strong><br>
                ${escapeHtml(qa.changelog || 'No notes provided.').replace(/\n/g, '<br>')}
            </div>
        </div>
    `;

    // --- RECONSTRUCT THE PAYLOAD ---
    window.currentEditorPageType = rev.page_type || 'character';
    window.activePreviewCharId = rev.page_id;

    const mainArea = document.getElementById('history-content-area');
    mainArea.innerHTML = `<p class="loading-msg loading-msg-busy">Loading this version...</p>`;

    if (window.currentEditorPageType === 'tierlist') {
        // tierlist.js reads its data from currentEditorDescData, as it always
        // has here.
        let tierDesc = rev.desc_data || {};
        if (rev.is_delta) tierDesc = window.applyDeltaToData({}, {}, rev.target_scope, rev.target_key, rev.delta_payload).newDesc;
        window.currentEditorDescData = cleanPaths(tierDesc);

        // Unlike the 'system' branch, tierlist.js's loadTierList() looks up
        // its containers by a fixed set of global IDs (not a scoped query),
        // so we can build them directly inside history's own container
        // instead of building elsewhere and re-parenting.
        mainArea.innerHTML = `
            <nav id="tier-tabs-container" class="character-nav" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue); align-items: center;">
                <p class="loading-msg loading-msg-busy" style="margin:0;">Loading tabs...</p>
            </nav>
            <div class="tier-list-container" id="tier-list-ui">
                <p class="loading-msg loading-msg-busy">Loading tier list data...</p>
            </div>
            <h2 class="section-title mb-4" style="text-transform: uppercase; margin-top: 2rem;">Reasoning & Changelogs</h2>
            <div id="changelog-container" style="display: flex; flex-direction: column; gap: 1rem;"></div>
        `;

        if (typeof window.loadTierList === 'function') {
            await window.loadTierList();
        } else {
            mainArea.innerHTML = '<div class="empty-tab-msg">Tier list renderer failed to load.</div>';
        }
        return;
    }

    // The whole page as it was right after this revision (owner, 2026-10-29),
    // from the snapshots the database keeps of every live change. Only a
    // revision approved since 20261029000001 knows when it was approved; for
    // the ones before, its delta is all there is, and the page says so. A full
    // overwrite already is a whole page.
    const whole = await wholePageAfter(rev);
    const partial = !whole && rev.is_delta;

    let renderDesc;
    let renderFrame;
    if (whole) {
        renderDesc = whole.desc_data || {};
        renderFrame = whole.frame_data || {};
    } else if (rev.is_delta) {
        const res = window.applyDeltaToData({}, {}, rev.target_scope, rev.target_key, rev.delta_payload);
        renderDesc = res.newDesc;
        renderFrame = res.newFrame;
    } else {
        renderDesc = rev.desc_data || {};
        renderFrame = rev.frame_data || {};
    }
    servePageAs(rev.page_id, cleanPaths(renderDesc), cleanPaths(renderFrame));

    mainArea.innerHTML = '';
    if (partial) mainArea.appendChild(partialNote());

    if (window.currentEditorPageType === 'system') {
        const tabs = renderDesc.tabs || [];
        if (tabs.length === 0) {
            mainArea.innerHTML = '<div class="empty-tab-msg">No readable content found in this payload.</div>';
            return;
        }

        // Read by internalstyling.js for the page's own colour words.
        window.PAGE_ROUTE = { pageId: rev.page_id, pageType: 'system', title: historyPageName };

        // Do NOT build the tabs here! Let description.js build the dynamic system UI natively.
        if (typeof window.loadPageDescriptions === 'function') {
            await window.loadPageDescriptions(rev.page_id, 'system');

            // Catch the auto-generated Navigation Bar and move it down into the History container
            const sysNav = document.getElementById('system-dynamic-nav');
            if (sysNav) {
                sysNav.style.marginTop = '0'; // Remove top margin to sit flush under the history card
                mainArea.appendChild(sysNav);
            }

            // Catch all the auto-generated Tab Content Containers and move them into the History container
            document.querySelectorAll('main.main-content-area > .tab-content').forEach(tab => {
                if (tab.parentElement !== mainArea) {
                    mainArea.appendChild(tab);
                }
            });
        }
    } else {
        await drawCharacterPage(rev.page_id, mainArea);
    }

    if (partial) {
        await quiet(mainArea);
        leaveOutWhatItDidNotTouch(mainArea);
        pruneAgainAfterEachStateSwitch(mainArea);
    }

    setTimeout(() => { if (typeof window.refreshTOC === 'function') window.refreshTOC(); }, 300);
};

// The link to another revision of this page, or a disabled button at either
// end. A link rather than an in-place redraw: see the boot above.
function historyStep(index, label) {
    const target = window.historyRevisions[index];
    if (!target) return `<button class="btn-sys btn-sys-regular" disabled>${label}</button>`;
    const pageId = new URLSearchParams(window.location.search).get('page');
    const href = `history.html?page=${encodeURIComponent(pageId)}&rev=${encodeURIComponent(target.id)}`;
    return `<a class="btn-sys btn-sys-regular" href="${escapeHtml(href)}">${label}</a>`;
}

// NULL from the database means "not one it can answer for": a revision from
// before approvals were timestamped. Until 20261029000001 reaches production
// the function does not exist either, and that is the same answer.
async function wholePageAfter(rev) {
    if (!rev.approved_at || !window.supabaseClient) return null;
    const { data, error } = await window.supabaseClient.rpc('get_page_after_revision', { target_revision_id: rev.id });
    if (error) {
        console.warn('[History] Could not load the whole page for this revision; showing what it changed instead.', error.message);
        return null;
    }
    return data || null;
}

// Every renderer reads a page through window.fetchCloudCharacterData
// (js/site_utils.js), so answering for this page with the historical content
// draws a past version with the live page's own code. The rest of the row
// (which optional tabs the page has) is today's: page_history keeps content
// only.
//
// It used to set currentEditorDescData and currentEditorFrameData instead,
// and framedata.js reads neither: it fetched the live page, so every frame
// data tab in History showed today's moves (a revision that changed only
// Lapse Blue drew all seven of Honored One's current skills).
function servePageAs(pageId, desc, frame) {
    const fetchLive = window.fetchCloudCharacterData;
    window.fetchCloudCharacterData = async function(id) {
        const live = await fetchLive(id);
        if (id !== pageId) return live;
        window.rememberPageConfig(pageId, desc);
        // A delta that edits a state (Ultimate and such) carries that state's
        // content in modeData but not the list of states, which is
        // frame_data.modes. Without the list the state bar never appears and
        // the edit is invisible (25 revisions), so a version missing it
        // borrows today's. A whole snapshot always has its own.
        const liveModes = live && live.frame_data && live.frame_data.modes;
        const withModes = !frame.modes && frame.modeData && liveModes ? { ...frame, modes: liveModes } : frame;
        return { ...(live || { page_id: pageId }), desc_data: desc, frame_data: withModes };
    };
    window.cachedMasterFrameData = {};
}

// The live page's own markup (js/page_router.js) and boot steps
// (bootCharacterContent, js/page_boot.js). Left out: what belongs to the page
// today rather than to that version (the discussion and its button, alerts,
// the way home), and the title, which history.html's header already says.
async function drawCharacterPage(pageId, mainArea) {
    // window.PAGE_ROUTE as the live page has it: switchCharacterMode returns
    // without one, and internalstyling.js reads it for the page's colour
    // words and to leave the character's own name unlinked. Set after load,
    // so page_router.js and page_boot.js, which act on it at load, never see it.
    const route = { pageId, pageType: 'character', title: historyPageName };
    window.PAGE_ROUTE = route;
    const skeleton = document.createElement('template');
    skeleton.innerHTML = window.buildPageSkeleton(route, './');
    const main = skeleton.content.querySelector('main');
    main.querySelectorAll('.back-home-wrapper, #discussion-section, #btn-jump-discussion, #character-alerts-container, .character-title')
        .forEach(node => node.remove());
    mainArea.append(...main.childNodes);
    await window.bootCharacterContent(route);
}

// The owner's line, 2026-10-29.
const PARTIAL_NOTE = 'This is an old edit with a different data structure, so the site can only show what was changed within it instead of a full page.';

function partialNote() {
    const note = document.createElement('p');
    note.className = 'history-partial-note';
    note.style.cssText = 'color: var(--text-muted); font-family: var(--text-mono); font-size: 0.85rem; border: 1px dashed var(--border-color); padding: 0.75rem 1rem; margin-bottom: 1.5rem;';
    note.textContent = PARTIAL_NOTE;
    return note;
}

// An old revision is drawn from its delta alone, so every section it did not
// touch renders as "not written yet". That is false: it was written, this
// edit just did not change it. So those are left out, then any section left
// with only its heading, then any tab left with nothing in it.
function leaveOutWhatItDidNotTouch(area) {
    area.querySelectorAll('.empty-tab-msg, .wiki-section-empty').forEach(node => node.remove());

    // Empty means nothing but the renderer's own titles for the section or
    // card. A Heading Block (.wiki-block-heading) is content: a Starter Guide
    // topic or an extra can be one heading and nothing else.
    const isEmpty = (el) => {
        if (el.querySelector('img, video, iframe, table, canvas')) return false;
        const copy = el.cloneNode(true);
        copy.querySelectorAll('.strategy-title, .section-title, .card-header-title').forEach(h => h.remove());
        return copy.textContent.trim() === '';
    };
    area.querySelectorAll('.wiki-section').forEach(section => { if (isEmpty(section)) section.remove(); });

    // Marked, so a state switch can bring back these and only these: a tab
    // hidden for its own reasons (a character without Techs) stays hidden.
    const buttons = [...area.querySelectorAll('.character-nav button[id^="nav-"]')];
    buttons.forEach(btn => {
        const panel = document.getElementById(`tab-${btn.id.slice(4)}`);
        if (panel && isEmpty(panel) && !btn.classList.contains('hidden')) {
            btn.classList.add('hidden');
            btn.dataset.historyPruned = 'true';
            panel.classList.add('hidden');
        }
    });

    // If the tab on show was one of them, show the first one left.
    const left = buttons.filter(btn => !btn.classList.contains('hidden'));
    if (left.length && !left.some(btn => btn.classList.contains('active'))) left[0].click();
}

// A state switch redraws every tab for that state, so the placeholders come
// back and a tab pruned for one state may hold the edit in the next (a
// revision that changed only an Ultimate). The pruned tabs return before the
// switch, and the pruning runs again once the redraw has gone quiet.
function pruneAgainAfterEachStateSwitch(area) {
    const switchMode = window.switchCharacterMode;
    if (typeof switchMode !== 'function') return;
    window.switchCharacterMode = async function(modeId) {
        area.querySelectorAll('[data-history-pruned]').forEach(btn => {
            btn.classList.remove('hidden');
            delete btn.dataset.historyPruned;
        });
        await switchMode(modeId);
        await quiet(area);
        leaveOutWhatItDidNotTouch(area);
    };
}

// Resolves once nothing inside el has changed for a moment. The renderers
// write in several passes (descriptions add move strategies 300ms late), so
// "the boot promise resolved" is not "the page is drawn".
function quiet(el, ms = 250) {
    return new Promise(resolve => {
        let timer;
        const done = () => { observer.disconnect(); resolve(); };
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ms); });
        observer.observe(el, { childList: true, subtree: true, characterData: true });
        timer = setTimeout(done, ms);
    });
}
