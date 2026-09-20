/**
 * Dogslamloop Wiki - Editor: the guided tour and the Manual of Style
 * (v0.19 F2 and F3)
 *
 * A JRPG-style tour that spotlights each part of the editor in turn and reads
 * out what it does. Runs once per browser on a first visit, again from the
 * "GOT IT" button on the v0.18 editor notice, and on demand from the MoS
 * modal's "REWATCH TUTORIAL" (v0.19 F3).
 *
 * Both live here because they read the SAME Writing Guide tab and share the
 * rewatch wiring - splitting them would mean two fetches of one row and a
 * cross-file call for one button.
 *
 * THE SCRIPT IS NOT IN THIS FILE, AND THAT IS THE POINT
 *
 * Every word comes from the Writing Guide - page_data for `writing_guide`,
 * tab `basics`, section "How to use the editor?" - which is the same text a
 * contributor is told to read and which the owner edits through the site. A
 * copy in here would be a second source that goes stale silently, and the
 * Writing Guide is the one that decides whether an edit gets accepted.
 *
 * So the steps are DERIVED: the section's own `h3` headings are the steps, in
 * the order the guide puts them, and everything between two headings is that
 * step's body. Adding a sixth element to the guide adds a sixth step here with
 * no code change. The owner listed five - Workspace Header, Workspace
 * Navigation, Workspace, Workspace Footer, Preview Panel - and the guide's
 * headings are exactly those.
 *
 * Images in the guide are SKIPPED. They are screenshots of the editor, and the
 * tour is pointing at the real thing a few pixels away.
 *
 * WHAT IT POINTS AT
 *
 * SPOTLIGHTS maps a heading to a selector. A heading with no selector still
 * gets a step, centred, with no cut-out - which is what the guide's "UI"
 * preamble is. A selector that matches nothing does the same, because two of
 * these genuinely do not exist on every page type: the tab strip is hidden on
 * system and tool pages, and the footer is built at runtime by
 * editor-blocks.js and is absent until a block editor mounts.
 */

(function () {
    'use strict';

    const SEEN_KEY = 'dsl_editor_tutorial_seen';

    // Same URL js/editor-notices.js points its two notices at, and for the same
    // reason: the guide is what decides whether an edit is accepted. Duplicated
    // rather than shared, which is this project's stated preference over a new
    // cross-file dependency for one string.
    const GUIDE_URL = 'https://dogslamloop.com/systems/writing_guide/index.html';

    // Heading text (shortcodes stripped, lowercased) -> what to spotlight.
    // Keyed on the guide's own wording so the mapping is visible in one place
    // rather than inferred from step order, which would silently re-point every
    // spotlight the day somebody reorders the guide.
    const SPOTLIGHTS = {
        'workspace header': '#editor-header',
        'workspace navigation': '#editor-tab-nav',
        'workspace': '#interactive-builder',
        'workspace footer': '.add-block-toolbar',
        'preview panel': '.live-preview-pane',
    };

    let steps = [];
    let at = 0;
    let overlay = null;

    function hasSeen() {
        try { return window.localStorage.getItem(SEEN_KEY) === '1'; }
        catch (e) { return false; }
    }
    function markSeen() {
        try { window.localStorage.setItem(SEEN_KEY, '1'); }
        catch (e) { /* shows once more; the harmless direction */ }
    }

    const esc = (v) => (typeof window.escapeHtml === 'function'
        ? window.escapeHtml(v)
        : String(v == null ? '' : v).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

    // Shortcodes are converted by js/internalstyling.js AFTER this is in the
    // DOM, so what goes in is escaped text and what comes out is styled markup.
    // Stripping them here instead would show a contributor `[b]` in a tour
    // about how to write, which is the one place it must not appear.
    const stripCodes = (v) => String(v == null ? '' : v).replace(/\[\/?[a-z][^\]]*\]/gi, '').trim();

    const blockText = (b) => (Array.isArray(b.content) ? b.content.join(' ') : String(b.content || ''));

    /** The guide's section, cut into steps at its own h3 headings. */
    function buildSteps(section) {
        const out = [];
        let current = null;

        for (const block of (section.blocks || [])) {
            if (!block || typeof block !== 'object') continue;

            if (block.type === 'heading' && (block.size === 'h3' || !block.size)) {
                const title = stripCodes(blockText(block));
                if (!title) continue;
                current = { title, selector: SPOTLIGHTS[title.toLowerCase()] || null, body: [] };
                out.push(current);
                continue;
            }
            if (!current) continue;

            // h4 stays inside its step rather than starting one: "The QA" is
            // part of the Workspace Header, and the owner's list has five
            // elements, not six.
            if (block.type === 'heading') {
                current.body.push(`<h4 class="tutorial-subheading">${esc(stripCodes(blockText(block)))}</h4>`);
            } else if (block.type === 'paragraph') {
                const text = blockText(block);
                if (text.trim()) current.body.push(`<p class="strategy-paragraph">${esc(text)}</p>`);
            } else if (block.type === 'list') {
                const items = (block.items || []).filter(i => String(i || '').trim());
                if (items.length) {
                    current.body.push(`<ul class="wiki-block-list">${
                        items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`);
                }
            }
            // image, video, divider: skipped. The guide's screenshots are of
            // the editor this tour is standing in front of.
        }

        return out.filter(s => s.body.length);
    }

    // One fetch for both features, cached for the life of the page. The tour
    // and the Manual of Style read two different sections of the same tab, and
    // fetching it twice would be two round trips for one row.
    let guideTab = null;

    async function loadGuideSection(pattern) {
        if (!guideTab) {
            if (!window.supabaseClient) throw new Error('not connected');
            const { data, error } = await window.supabaseClient
                .from('page_data').select('desc_data').eq('page_id', 'writing_guide').maybeSingle();
            if (error) throw error;

            const tabs = ((data || {}).desc_data || {}).tabs || [];
            guideTab = tabs.find(t => t && t.tabId === 'basics') || null;
            if (!guideTab) throw new Error('the Writing Guide has no Basics tab');
        }

        const section = (guideTab.sections || []).find(s => s && pattern.test(s.sectionTitle || ''));
        if (!section) throw new Error('the Writing Guide is missing that section');
        return section;
    }

    async function loadSteps() {
        if (steps.length) return steps;

        const section = await loadGuideSection(/how to use the editor/i);
        steps = buildSteps(section);
        if (!steps.length) throw new Error('the editor section is empty');
        return steps;
    }

    /** Moves the cut-out over the step's target, or hides it when there is none. */
    function positionSpotlight() {
        const step = steps[at];
        const hole = overlay.querySelector('.tutorial-hole');
        const target = step.selector ? document.querySelector(step.selector) : null;

        // offsetParent is null for a display:none element - the tab strip on a
        // system page is exactly that - so a target can exist and still have
        // nothing to point at.
        const visible = target && target.offsetParent !== null;
        if (!visible) {
            hole.classList.add('hidden');
            overlay.classList.add('is-centred');
            return;
        }

        const r = target.getBoundingClientRect();
        const pad = 6;
        hole.classList.remove('hidden');
        overlay.classList.remove('is-centred');
        hole.style.top = `${r.top - pad}px`;
        hole.style.left = `${r.left - pad}px`;
        hole.style.width = `${r.width + pad * 2}px`;
        hole.style.height = `${r.height + pad * 2}px`;

        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function render() {
        const step = steps[at];
        const box = overlay.querySelector('.tutorial-box');

        box.innerHTML = `
            <div class="tutorial-progress">Step ${at + 1} of ${steps.length}</div>
            <h3 class="tutorial-title">${esc(step.title)}</h3>
            <div class="tutorial-body">${step.body.join('')}</div>
            <div class="tutorial-actions">
                <button type="button" class="btn-sys btn-sys-regular" data-tutorial="skip">SKIP</button>
                <div class="tutorial-actions-right">
                    <button type="button" class="btn-sys btn-sys-regular" data-tutorial="back"${at === 0 ? ' disabled' : ''}>BACK</button>
                    <button type="button" class="btn-sys btn-sys-green" data-tutorial="next">${
                        at === steps.length - 1 ? 'DONE' : 'NEXT'}</button>
                </div>
            </div>`;

        // The guide's text carries shortcodes, and this is the one surface that
        // must not show them raw - it is a tour about how to write.
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

        positionSpotlight();
        const next = box.querySelector('[data-tutorial="next"]');
        if (next && typeof next.focus === 'function') next.focus();
    }

    function close() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        window.removeEventListener('resize', positionSpotlight);
        window.removeEventListener('scroll', positionSpotlight, true);
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (!overlay) return;
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    }

    function step(delta) {
        const nextAt = at + delta;
        if (nextAt < 0) return;
        if (nextAt >= steps.length) { close(); return; }
        at = nextAt;
        render();
    }

    /**
     * Opens the tour. `force` replays it for somebody who has already seen it,
     * which is what the MoS modal's REWATCH button passes.
     *
     * Resolves to true when it actually opened, so a caller can tell "shown"
     * from "already seen" without reading localStorage itself.
     */
    window.startEditorTutorial = async function (opts = {}) {
        if (overlay) return false;
        if (!opts.force && hasSeen()) return false;

        try {
            await loadSteps();
        } catch (e) {
            // Silent unless asked for explicitly. On a first visit this is an
            // extra nobody requested, and an error box in front of the editor
            // would be worse than no tour; from REWATCH somebody pressed a
            // button and is owed an answer.
            if (opts.force && typeof window.editorAlert === 'function') {
                window.editorAlert('The tutorial could not be loaded - ' + e.message);
            } else {
                console.warn('Editor tutorial unavailable:', e);
            }
            return false;
        }

        at = 0;
        markSeen();

        overlay = document.createElement('div');
        overlay.className = 'tutorial-overlay';
        overlay.id = 'editor-tutorial';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Editor tutorial');
        overlay.innerHTML = '<div class="tutorial-hole hidden"></div><div class="tutorial-box"></div>';

        // Opens PAUSED if a notice is already up. The tour is async - it waits
        // on the Writing Guide fetch before it can draw anything - so the
        // ordering is not the one it looks like from the call site: pressing
        // GOT IT starts the tour, the contributor opens the Media Library
        // while it is still loading, and the tour then arrives ON TOP of that
        // notice. Pausing only from the notice side handled the other ordering
        // and missed this one entirely, which is what the probe showed.
        if (document.querySelector('.editor-notice-overlay')) overlay.classList.add('is-paused');

        document.body.appendChild(overlay);

        // Delegated: the box is re-rendered per step, so a listener bound to a
        // button would be gone by the time it was needed.
        overlay.addEventListener('click', (e) => {
            const action = e.target.closest('[data-tutorial]');
            if (!action) return;
            const what = action.getAttribute('data-tutorial');
            if (what === 'skip') close();
            if (what === 'back') step(-1);
            if (what === 'next') step(1);
        });

        window.addEventListener('resize', positionSpotlight);
        // Capture: the editor's panes scroll, not the window, so a bubbling
        // listener on window would never see it and the cut-out would drift
        // away from what it is pointing at.
        window.addEventListener('scroll', positionSpotlight, true);
        document.addEventListener('keydown', onKeydown);

        render();
        return true;
    };

    /** The MoS modal's REWATCH TUTORIAL. */
    window.replayEditorTutorial = function () {
        return window.startEditorTutorial({ force: true });
    };

    /**
     * Steps out of the way for a modal, and steps back afterwards.
     *
     * The tour's text box sits at the bottom of the screen, which is exactly
     * where the v0.18 notices put their GOT IT button - so a notice raised
     * during the tour rendered visible and could not be clicked. Caught by
     * tests/editor-notices.spec.js timing out on that click.
     *
     * Pausing rather than refusing the notice, which was the first fix and was
     * worse: it meant a first-time contributor never saw the Media Library
     * notice at all, because the tour is always open by the time they get
     * there. Both of these are the owner's features and neither should cost
     * the other.
     *
     * Returns true if it actually paused something, so a caller knows whether
     * it owes a resume.
     */
    window.pauseEditorTutorial = function () {
        if (!overlay || overlay.classList.contains('is-paused')) return false;
        overlay.classList.add('is-paused');
        return true;
    };

    window.resumeEditorTutorial = function () {
        if (!overlay) return false;
        overlay.classList.remove('is-paused');
        // The page may have scrolled or resized behind the modal.
        positionSpotlight();
        return true;
    };


    // --- THE MANUAL OF STYLE (v0.19 F3) -----------------------------------
    //
    // A red MoS button in the Workspace Header opens the Writing Guide's
    // "Universal Rules > Basics" without leaving the editor, plus a statement
    // of the language standard, plus a way back into the tour.
    //
    // Same sourcing rule as the tour above: the rules come from the guide, not
    // from this file. A contributor who reads the modal and a reviewer who
    // rejects against the guide have to be reading the same words, and two
    // copies of a style guide is how they stop being.
    //
    // The ONE thing authored here is the language standard, because the guide
    // does not state one and the owner asked for help with it ("I actually
    // don't know much about this"). "Written in English" is not a rule anybody
    // can follow or enforce; a variety plus a baseline is. The last sentence is
    // the one that does the work in practice - it settles whether a move is
    // "Domain Expansion" or "domain expansion", which no general style guide
    // can answer for a Roblox fighter.
    //
    // American English because the guide's own Basics writes "capitalize".
    // Trivially changed here if the owner wants otherwise.
    const LANGUAGE_STANDARD = [
        'This wiki is written in <strong>American English</strong>, following '
        + "Wikipedia's Manual of Style for capitalization, headings and numbers.",
        'Game terms keep the spelling and casing they have <strong>in-game</strong> '
        + '("Domain Expansion" &gt; "domain expansion")',
    ];

    /** The guide's "Basics" list, as an array of raw item strings. */
    function readBasics(section) {
        const blocks = (section && section.blocks) || [];
        let inBasics = false;
        const items = [];

        for (const block of blocks) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'heading') {
                // Anchored on the guide's own heading, and STOPS at the next
                // one: "Character Pages" and "Ground for Rejection" follow it
                // in the same section, and the owner asked for the Basics.
                inBasics = /^basics$/i.test(stripCodes(blockText(block)));
                continue;
            }
            if (!inBasics) continue;
            if (block.type === 'list') items.push(...(block.items || []).filter(i => String(i || '').trim()));
        }
        return items;
    }

    async function loadBasics() {
        const section = await loadGuideSection(/universal rules/i);
        const items = readBasics(section);
        if (!items.length) throw new Error('the Writing Guide has no Basics list yet');
        return items;
    }

    window.openStyleManual = async function () {
        if (document.getElementById('editor-mos-modal')) return false;

        let items;
        try {
            items = await loadBasics();
        } catch (e) {
            if (typeof window.editorAlert === 'function') {
                window.editorAlert('The Manual of Style could not be loaded - ' + e.message);
            }
            return false;
        }

        const box = document.createElement('div');
        box.className = 'editor-modal-overlay editor-notice-overlay';
        box.id = 'editor-mos-modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'Manual of Style');

        // Escaped, then styled: the guide's items carry shortcodes and the
        // strikethroughs in them are load-bearing - "[s]Yuji[/s], Vessel" is
        // the rule demonstrating itself.
        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box mos-modal-box">
                <div class="auth-header"><h3>MANUAL OF STYLE</h3></div>
                <div class="auth-body mos-body">
                    <h4 class="mos-heading">The language</h4>
                    ${LANGUAGE_STANDARD.map(p => `<p class="strategy-paragraph">${p}</p>`).join('')}

                    <h4 class="mos-heading">The basics</h4>
                    <ul class="wiki-block-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>

                    <p class="mos-footnote">
                        These come from the
                        <a href="${GUIDE_URL}" target="_blank" rel="noopener">Writing Guide</a>,
                        which is the full version and the one edits are judged against.
                    </p>

                    <div class="modal-actions-centered mos-actions">
                        <button type="button" class="btn-sys btn-sys-regular" data-mos="rewatch">REWATCH TUTORIAL</button>
                        <button type="button" class="btn-sys btn-sys-green" data-mos="ok">OK</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

        const shut = () => { if (box.parentNode) box.parentNode.removeChild(box); document.removeEventListener('keydown', onMosKey); };
        function onMosKey(e) { if (e.key === 'Escape') shut(); }

        box.addEventListener('click', (e) => {
            const action = e.target.closest('[data-mos]');
            if (!action) return;
            if (action.getAttribute('data-mos') === 'ok') { shut(); return; }
            // Closed FIRST: the tour spotlights the editor behind this modal,
            // and leaving it up would point a cut-out at something covered.
            shut();
            window.replayEditorTutorial();
        });
        document.addEventListener('keydown', onMosKey);

        const ok = box.querySelector('[data-mos="ok"]');
        if (ok && typeof ok.focus === 'function') ok.focus();
        return true;
    };

    // Exposed for tests: the parse is the half with real logic in it, and
    // driving it through the database to check a heading became a step would
    // be testing Supabase.
    window.__editorTutorial = { buildSteps, readBasics, SPOTLIGHTS, LANGUAGE_STANDARD };
})();
