/**
 * The editor's guided tour and the Manual of Style. The tour spotlights each
 * part of the editor in turn and reads out what it does: once per browser, from
 * GOT IT on the editor's notice, and from the MoS modal's REWATCH TUTORIAL.
 * @since v0.19
 * @touches page_data for writing_guide (both read it, one fetch),
 *   localStorage dsl_editor_tutorial_seen, applyInternalStyling (internalstyling.js)
 * @watch no word of the script is in this file: the steps come from the Writing
 *   Guide's "How to use the editor?" section, one per h3 heading, in the guide's
 *   order, so a heading added there is a step here. Images are skipped. A step
 *   whose target is missing on this page type is drawn centred.
 * @see docs/editor.md
 */

(function () {
    'use strict';

    const SEEN_KEY = 'dsl_editor_tutorial_seen';

    // The notices' address too; a copy beats a cross-file dependency for one string.
    const GUIDE_URL = 'https://dogslamloop.com/systems/writing_guide/index.html';

    // Heading text (tags stripped, lowercased) -> what to spotlight. Keyed on the
    // guide's wording, so reordering the guide cannot re-point a spotlight.
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
        catch (e) { /* shows once more, which is harmless */ }
    }

    // Tags are styled after this is in the page: escaped text in, styled markup out.
    // A tour about writing must never show a raw [b].
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

            // An h4 stays inside its step: "The QA" is part of the Workspace Header.
            if (block.type === 'heading') {
                current.body.push(`<h4 class="tutorial-subheading">${window.escapeHtml(stripCodes(blockText(block)))}</h4>`);
            } else if (block.type === 'paragraph') {
                const text = blockText(block);
                if (text.trim()) current.body.push(`<p class="strategy-paragraph">${window.escapeHtml(text)}</p>`);
            } else if (block.type === 'list') {
                const items = (block.items || []).filter(i => String(i || '').trim());
                if (items.length) {
                    current.body.push(`<ul class="wiki-block-list">${
                        items.map(i => `<li>${window.escapeHtml(i)}</li>`).join('')}</ul>`);
                }
            }
            // Images, videos and dividers: the screenshots are of the editor the tour
            // stands in front of.
        }

        return out.filter(s => s.body.length);
    }

    // One fetch for the tour and the MoS, kept for the page's life.
    let guideTabs = null;

    async function loadGuideSection(pattern) {
        if (!guideTabs) {
            if (!window.supabaseClient) throw new Error('not connected');
            const { data, error } = await window.supabaseClient
                .from('page_data').select('desc_data').eq('page_id', 'writing_guide').maybeSingle();
            if (error) throw error;

            const tabs = ((data || {}).desc_data || {}).tabs || [];
            if (!tabs.length) throw new Error('the Writing Guide has no tabs');
            guideTabs = tabs;
        }

        // Any tab: the guide is reorganised through the site, so a section is found by
        // its title wherever it is.
        for (const tab of guideTabs) {
            const section = ((tab && tab.sections) || []).find(s => s && pattern.test(s.sectionTitle || ''));
            if (section) return section;
        }
        throw new Error('the Writing Guide is missing that section');
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

        // offsetParent is null for display:none (the tab strip on a system page).
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

        target.scrollIntoView({ block: 'nearest', behavior: window.scrollMotion() });
    }

    function render() {
        const step = steps[at];
        const box = overlay.querySelector('.tutorial-box');

        box.innerHTML = `
            <div class="tutorial-progress">Step ${at + 1} of ${steps.length}</div>
            <h3 class="tutorial-title">${window.escapeHtml(step.title)}</h3>
            <div class="tutorial-body">${step.body.join('')}</div>
            <div class="tutorial-actions">
                <button type="button" class="btn-sys btn-sys-regular" data-tutorial="skip">SKIP</button>
                <div class="tutorial-actions-right">
                    <button type="button" class="btn-sys btn-sys-regular" data-tutorial="back"${at === 0 ? ' disabled' : ''}>BACK</button>
                    <button type="button" class="btn-sys btn-sys-green" data-tutorial="next">${
                        at === steps.length - 1 ? 'DONE' : 'NEXT'}</button>
                </div>
            </div>`;

        // The guide's text carries tags, and this surface must not show them raw.
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
     * Opens the tour; `force` replays it for someone who has seen it (REWATCH).
     * Resolves true when it opened.
     */
    window.startEditorTutorial = async function (opts = {}) {
        if (overlay) return false;
        if (!opts.force && hasSeen()) return false;

        try {
            await loadSteps();
        } catch (e) {
            // Silent unless asked for: on a first visit an error box in front of the editor
            // is worse than no tour, and REWATCH is owed an answer.
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

        // Opens paused if a notice is up: the tour waits on its fetch, so it can arrive
        // on top of a notice opened meanwhile.
        if (document.querySelector('.editor-notice-overlay')) overlay.classList.add('is-paused');

        document.body.appendChild(overlay);

        // Delegated: the box is redrawn per step.
        overlay.addEventListener('click', (e) => {
            const action = e.target.closest('[data-tutorial]');
            if (!action) return;
            const what = action.getAttribute('data-tutorial');
            if (what === 'skip') close();
            if (what === 'back') step(-1);
            if (what === 'next') step(1);
        });

        window.addEventListener('resize', positionSpotlight);
        // Capture: the editor's panes scroll, not the window, and the cut-out would drift.
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
     * Steps out of the way for a modal and back afterwards: the tour's box sits where
     * a notice's GOT IT lands. True if it paused something, so the caller owes a
     * resume.
     */
    window.pauseEditorTutorial = function () {
        if (!overlay || overlay.classList.contains('is-paused')) return false;
        overlay.classList.add('is-paused');
        return true;
    };

    window.resumeEditorTutorial = function () {
        if (!overlay) return false;
        overlay.classList.remove('is-paused');
        // The page may have moved behind the modal.
        positionSpotlight();
        return true;
    };


    // The Manual of Style: a red MoS button opens the Writing Guide's "Universal
    // Rules > Basics" without leaving the editor, with the language standard and the
    // way back into the tour. The rules come from the guide, so a contributor and a
    // reviewer read the same words. The language standard is the one thing written
    // here, since the guide states none.
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
                // From the guide's own heading to the next one: the Basics only.
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

        // Escaped, then styled: "[s]Yuji[/s], Vessel" is the rule showing itself.
        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box mos-modal-box">
                <div class="auth-header"><h3>MANUAL OF STYLE</h3></div>
                <div class="auth-body mos-body">
                    <h4 class="mos-heading">The language</h4>
                    ${LANGUAGE_STANDARD.map(p => `<p class="strategy-paragraph">${p}</p>`).join('')}

                    <h4 class="mos-heading">The basics</h4>
                    <ul class="wiki-block-list">${items.map(i => `<li>${window.escapeHtml(i)}</li>`).join('')}</ul>

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
            // Closed first, or the tour would spotlight something this modal covers.
            shut();
            window.replayEditorTutorial();
        });
        document.addEventListener('keydown', onMosKey);

        const ok = box.querySelector('[data-mos="ok"]');
        if (ok && typeof ok.focus === 'function') ok.focus();
        return true;
    };

    // For tests: the parsing is the real logic, and checking it through the database
    // would test Supabase.
    window.__editorTutorial = { buildSteps, readBasics, SPOTLIGHTS, LANGUAGE_STANDARD };
})();
