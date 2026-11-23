/**
 * The Config panel, in three parts. Editor: settings saved per device, one JSON
 * object in localStorage, most of them a class on <body> that editor.css does
 * the rest for. Actions: mass minimize and maximize, and the Edit Conflict
 * Check. Page: settings that belong to the page and travel with it through
 * review (desc_data.pageConfig).
 * @since v1.1
 * @touches localStorage dsl_editor_config, desc_data.pageConfig,
 *   get_open_submission_scopes, collectEditorDeltas (editor-core.js), the colour
 *   popup (editor-blocks.js), window.editorConfig
 * @watch edit.html loads this file alone: confirmDelete (editor-blocks.js) reads
 *   the switch through window.editorConfig where it exists
 * @see docs/editor.md
 */
(function () {
    const STORE_KEY = 'dsl_editor_config';

    // The defaults. Sticky header and section nav on is how the editor always
    // behaved. confirmDeletes keeps its stored name under the label "Skip delete
    // confirmations", ticked when it is false, so a device that turned the prompts
    // off still has them off.
    const DEFAULTS = Object.freeze({
        hideBlockType: false,
        hideDragHandle: false,
        hideFolderPicker: false,
        formattingOnTop: false,
        compactBlocks: false,
        openMinimized: false,
        stickHeader: true,
        stickPageNav: true,
        stickSectionNav: false,
        stickActions: false,
        disablePreview: false,
        previewFollows: false,
        previewOnSync: false,
        previewJump: true,
        confirmDeletes: true,
    });

    // The settings CSS carries on its own, by the class each one sets.
    const BODY_CLASSES = {
        hideBlockType: 'cfg-hide-block-type',
        hideDragHandle: 'cfg-hide-drag-handle',
        hideFolderPicker: 'cfg-hide-folder-picker',
        formattingOnTop: 'cfg-format-top',
        compactBlocks: 'cfg-compact-blocks',
        disablePreview: 'cfg-no-preview',
        previewJump: 'cfg-preview-jump',
    };

    function readStore() {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            // Storage blocked, or a value nobody here wrote: the defaults.
            return {};
        }
    }

    let stored = readStore();

    function get(key) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
        const value = stored[key];
        return typeof value === typeof DEFAULTS[key] ? value : DEFAULTS[key];
    }

    function set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || typeof value !== typeof DEFAULTS[key]) return;
        stored = Object.assign({}, stored, { [key]: value });
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
        } catch (e) { /* remembered for this session only */ }
        apply();
    }

    window.editorConfig = { get, set, DEFAULTS };

    // Sticky top elements. At the defaults nothing here runs: the header and the tab
    // strip sit above #interactive-builder, which scrolls. Otherwise the whole
    // Workspace scrolls (body.cfg-workspace-scrolls), and each bar that stays is
    // stacked under the ones above at a measured offset. The section nav is the
    // tab's own row only: pinning the rows inside a group would eat the Workspace.
    const STICKY_GROUPS = [
        { key: 'stickHeader', find: () => ['editor-header', 'editor-scope-tip'].map(id => document.getElementById(id)) },
        { key: 'stickPageNav', find: () => ['editor-mode-bar', 'editor-mode-controls', 'editor-tab-nav'].map(id => document.getElementById(id)) },
        { key: 'stickSectionNav', find: () => Array.from(document.querySelectorAll('#interactive-builder > .daw-editor-nav-row')) },
        { key: 'stickActions', find: () => {
            const undo = document.getElementById('btn-undo');
            return [undo && undo.closest('.strategy-toolbar-row')];
        } },
    ];

    function customSticky() {
        return STICKY_GROUPS.some(g => get(g.key) !== DEFAULTS[g.key]);
    }

    function workspace() {
        return document.querySelector('.editor-layout-split > .editor-workspace');
    }

    /**
     * The element that scrolls the Workspace, for the Block list's card
     * virtualization. null means the usual one, #interactive-builder.
     */
    window.editorScrollBox = function () {
        return customSticky() ? workspace() : null;
    };

    function layoutSticky() {
        const custom = customSticky() && !!workspace();
        document.body.classList.toggle('cfg-workspace-scrolls', custom);
        document.querySelectorAll('.cfg-stuck').forEach(el => {
            el.classList.remove('cfg-stuck');
            el.style.top = '';
        });
        if (!custom) return;

        let top = 0;
        STICKY_GROUPS.forEach(group => {
            if (!get(group.key)) return;
            group.find().forEach(el => {
                // Missing, or display:none (a dismissed tip, a page with no tabs).
                if (!el || !el.getClientRects().length) return;
                el.classList.add('cfg-stuck');
                el.style.top = `${top}px`;
                top += el.getBoundingClientRect().height;
            });
        });
    }

    // Re-stacked when something measured can have changed (the header folds, a tab
    // redraws, the window resizes), once per frame.
    let stickyQueued = false;
    function queueSticky() {
        if (stickyQueued) return;
        stickyQueued = true;
        requestAnimationFrame(() => {
            stickyQueued = false;
            if (customSticky() || document.body.classList.contains('cfg-workspace-scrolls')) layoutSticky();
            pinFooter();
        });
    }

    // The Workspace footer rests at the bottom of the Workspace even on a short
    // section: the empty space goes above it. Measured, not a flex column, which
    // moved fifty other elements (sibling margins stop collapsing in flex).
    const shown = (el) => !!el && el.getClientRects().length > 0 && !['absolute', 'fixed'].includes(getComputedStyle(el).position);

    function lastShownChild(el) {
        for (let child = el.lastElementChild; child; child = child.previousElementSibling) if (shown(child)) return child;
        return null;
    }

    function prevShownSibling(el) {
        for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) if (shown(sib)) return sib;
        return null;
    }

    // Sized by what holds the footer, so a growing Block moves it a frame later. A
    // size it set itself settles on the second pass, which writes nothing.
    let footerSizes = null;
    let footerWatched = [];
    function watchFooter(footer, scroller) {
        if (typeof ResizeObserver !== 'function') return;
        if (!footerSizes) footerSizes = new ResizeObserver(queueSticky);
        const chain = [scroller];
        for (let el = footer.parentElement; el && el !== scroller; el = el.parentElement) chain.push(el);
        footerWatched.filter(el => !chain.includes(el)).forEach(el => footerSizes.unobserve(el));
        chain.filter(el => !footerWatched.includes(el)).forEach(el => footerSizes.observe(el));
        footerWatched = chain;
    }

    // Written only when it moves the footer, or anything answering a change in the
    // Workspace could flip it between two places many times a second. A footer sent
    // back to where it just was three times in two seconds stays unpinned for that
    // section: a still one beats a jittering one. Typing moves it one way only.
    const PIN_BOUNCES = 3;
    const PIN_WINDOW_MS = 2000;
    const pinHistory = new WeakMap();
    const pinAbandoned = new WeakSet();

    function pinFooter() {
        const builder = document.getElementById('interactive-builder');
        const footers = builder ? builder.querySelectorAll('.add-block-toolbar') : [];
        if (footers.length !== 1) return;
        const footer = footers[0];
        if (pinAbandoned.has(footer)) return;

        const scroller = document.body.classList.contains('cfg-workspace-scrolls') ? workspace() : builder;
        if (!scroller || !shown(footer)) return;
        watchFooter(footer, scroller);

        const last = lastShownChild(scroller);
        if (!last) return;
        const inner = scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight
            - parseFloat(getComputedStyle(scroller).paddingBottom);
        const end = last.getBoundingClientRect().bottom + parseFloat(getComputedStyle(last).marginBottom);

        // The gap above the footer now plus the room still below it. The Block list's
        // bottom margin collapses with it, so a section too tall gets none.
        const prev = prevShownSibling(footer);
        const gap = prev ? footer.getBoundingClientRect().top - prev.getBoundingClientRect().bottom : 0;
        const room = gap + inner - end;
        const target = room < 1 ? 0 : room;
        const have = footer.style.marginTop === '' ? 0 : parseFloat(footer.style.marginTop) || 0;
        if (Math.abs(target - have) < 1) return;

        const now = performance.now();
        const seen = pinHistory.get(footer) || { margins: [have], bounces: [] };
        const before = seen.margins[seen.margins.length - 2];
        if (before !== undefined && Math.abs(before - target) < 1) seen.bounces.push(now);
        seen.bounces = seen.bounces.filter(t => now - t < PIN_WINDOW_MS);
        if (seen.bounces.length >= PIN_BOUNCES) {
            pinAbandoned.add(footer);
            footer.style.marginTop = '';
            return;
        }
        seen.margins = seen.margins.concat(target).slice(-2);
        pinHistory.set(footer, seen);
        footer.style.marginTop = target ? `${target}px` : '';
    }

    function watchSticky() {
        if (typeof ResizeObserver === 'function') {
            const sizes = new ResizeObserver(queueSticky);
            ['editor-header', 'editor-scope-tip', 'editor-mode-bar', 'editor-mode-controls', 'editor-tab-nav']
                .forEach(id => { const el = document.getElementById(id); if (el) sizes.observe(el); });
            // The Workspace itself: the header folding, a resize, a change in what scrolls.
            [document.getElementById('interactive-builder'), workspace()].forEach(el => { if (el) sizes.observe(el); });
        }
        const builder = document.getElementById('interactive-builder');
        if (builder) new MutationObserver(queueSticky).observe(builder, { childList: true, subtree: true });
        window.addEventListener('resize', queueSticky);
    }

    function apply() {
        if (!document.body) return;
        Object.keys(BODY_CLASSES).forEach(key => document.body.classList.toggle(BODY_CLASSES[key], get(key)));
        // The marks on each Block serve following it and jumping to it.
        if (get('previewFollows') || get('previewJump')) window.previewBlockAnchor = anchorBlock;
        else delete window.previewBlockAnchor;
        layoutSticky();
        // A setting can change the section's height (Compact Blocks) or what scrolls.
        queueSticky();
    }

    // The preview follows the Block being edited. page_render.js marks each top-level
    // Block's first element with its position and a fingerprint of its data: the
    // Overview tab draws several sections in one preview, each with a Block 0.
    function blockSignature(block) {
        const text = JSON.stringify(block) || '';
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    }

    function anchorBlock(html, index, block) {
        return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-preview-block="${Number(index)}" data-preview-sig="${blockSignature(block)}"`);
    }

    // Once per Block: moving between its fields does not scroll the preview again.
    let followedBlock = null;
    function followBlock(e) {
        if (!get('previewFollows') || get('disablePreview')) return;
        const card = e.target && e.target.closest && e.target.closest('#block-list .block-card[data-index]');
        if (!card || typeof currentStrategyBlocks === 'undefined') return;

        // Inside an accordion, follow the accordion: the preview marks the top level only.
        const path = window.activeAccordionPath || [];
        const step = path[0];
        const index = path.length ? (typeof step === 'object' ? step.index : step) : Number(card.getAttribute('data-index'));
        const block = currentStrategyBlocks[index];
        if (!block || block === followedBlock) return;
        followedBlock = block;

        const pane = document.querySelector('.live-preview-pane');
        if (!pane) return;
        const shown = Array.from(pane.querySelectorAll(`[data-preview-block="${index}"]`)).filter(el => el.getClientRects().length);
        const sig = blockSignature(block);
        // A preview waiting for Sync was drawn from older data: a lone Block at that
        // position is taken when no fingerprint matches.
        const target = shown.find(el => el.getAttribute('data-preview-sig') === sig) || (shown.length === 1 ? shown[0] : null);
        if (!target) return;

        target.scrollIntoView({ behavior: window.scrollMotion(), block: 'center' });
        // The same flash a section switch gives its section.
        target.style.outline = '2px solid var(--accent-blue)';
        target.style.outlineOffset = '2px';
        setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 800);
    }

    document.addEventListener('focusin', followBlock);
    document.addEventListener('click', followBlock);

    // Click a Block in the preview to edit it: found by the same marks, by data. A
    // Block inside an accordion opens its accordion. What already does something on
    // a click keeps doing it, and so does selecting text. Other sections are found on
    // the tabs below; on the rest, only the open section's Blocks jump.
    const PREVIEW_CONTROLS = 'a, button, summary, input, select, textarea, label, video, audio, iframe, '
        + '[role="button"], [data-player-toggle], [data-sbox-tab]';

    // The sections of the tab on screen that hold Blocks, and the loader each one's
    // own button calls.
    function jumpSections() {
        const d = window.currentEditorDescData || {};
        const tab = window.currentEditorTabId;
        const type = window.currentEditorPageType || 'character';
        if (type === 'system') {
            const shown = (d.tabs || [])[window.currentSystemTabIdx];
            return ((shown && shown.sections) || []).map((s, i) => ({ blocks: s && s.blocks, open: () => window.switchSystemSection(i) }));
        }
        if (type !== 'character') return [];
        if (tab === 'overview') {
            const open = (id) => () => window.loadOverviewSectionIntoEditor(id);
            return [{ blocks: d.overview, open: open('overview') }, { blocks: d.strategy, open: open('strategy') }]
                .concat((d.extras || []).map((x, i) => ({ blocks: x && x.content, open: open(`extra-${i}`) })));
        }
        if (tab === 'matchups') {
            return (d.matchups || []).map((m, i) => ({ blocks: m && m.content, open: () => window.loadMatchupIntoEditor(i) }));
        }
        if (window.usesSharedKeyedUI && window.usesSharedKeyedUI(tab)) {
            const section = window.getKeyedSectionByTab(tab);
            return (d[section.field] || []).map((e, i) => ({ blocks: e && e.content, open: () => window.loadKeyedEntryIntoEditor(tab, i) }));
        }
        return [];
    }

    // The Block's card opened: out of an accordion's list, its folder and itself
    // opened, scrolled to and flashed like a moved Block.
    function showCard(index) {
        if (Array.isArray(window.activeAccordionPath)) window.activeAccordionPath.length = 0;
        const block = window.getActiveBlocks()[index];
        if (!block) return;
        const folder = typeof window.blockFolderName === 'function' ? window.blockFolderName(block) : '';
        if (folder) window.setBlockFolderCollapsed(folder, false);
        window.setEditorBlockExpanded(block, true);
        window.renderBlockList();

        const card = document.querySelector(`#block-list .block-card[data-index="${index}"]`);
        if (!card) return;
        card.scrollIntoView({ block: 'center' });
        card.classList.remove('block-just-moved');
        void card.offsetWidth;
        card.classList.add('block-just-moved');
        setTimeout(() => card.classList.remove('block-just-moved'), 1400);
    }

    function jumpToBlock(e) {
        if (!get('previewJump') || get('disablePreview') || !e.target.closest) return;
        const pane = document.querySelector('.live-preview-pane');
        const mark = e.target.closest('[data-preview-block]');
        if (!pane || !mark || !pane.contains(mark) || e.target.closest(PREVIEW_CONTROLS)) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && pane.contains(selection.anchorNode)) return;
        if (typeof currentStrategyBlocks === 'undefined') return;

        const index = Number(mark.getAttribute('data-preview-block'));
        const sig = mark.getAttribute('data-preview-sig');
        const holds = (blocks) => Array.isArray(blocks) && !!blocks[index] && blockSignature(blocks[index]) === sig;

        // The open section first, from the Workspace's copy, newer than the page data
        // until it syncs. Overview's Profile Card keeps no list.
        if (holds(currentStrategyBlocks) && document.getElementById('block-list')) {
            showCard(index);
            return;
        }
        const section = jumpSections().find(s => holds(s.blocks));
        if (!section) return;
        section.open();
        showCard(index);
    }

    document.addEventListener('click', jumpToBlock);

    // Mass minimize and maximize, through each Block's own state. Maximize opens
    // folders too, or the Block would still be out of sight. Returns how many it
    // touched.
    function setAllBlocksOpen(open) {
        const list = document.getElementById('block-list');
        if (!list || typeof window.getActiveBlocks !== 'function' || typeof window.setEditorBlockExpanded !== 'function') return 0;
        const blocks = window.getActiveBlocks() || [];
        if (!blocks.length) return 0;

        blocks.forEach(block => window.setEditorBlockExpanded(block, open));
        if (open && typeof window.setBlockFolderCollapsed === 'function') {
            list.querySelectorAll('.block-folder').forEach(folder =>
                window.setBlockFolderCollapsed(folder.getAttribute('data-folder'), false));
        }
        window.renderBlockList();
        return blocks.length;
    }

    window.setAllEditorBlocksOpen = setAllBlocksOpen;

    // The Edit Conflict Check: Submit's own list of edits against the queue's, from
    // get_open_submission_scopes, since an editor cannot read others' submissions
    // (it says where, who and when, never what). Two edits clash when they name the
    // same scope and key, a character state's wrapping included. A whole-page upload
    // clashes with everything.

    // A part of the page in words, from the vocabularies the tabs are named by.
    function describePart(scope, key) {
        if (!scope) return 'the whole page';
        const k = String(key == null ? '' : key);
        if (scope === 'mode') {
            const [mode, inner, ...rest] = k.split('::');
            const modes = window.getCharacterModes(window.editorMasterFrameData || {});
            const state = (modes.find(m => m.id === mode) || {}).label || mode;
            return `${describePart(inner, rest.join('::'))} (${state} state)`;
        }
        const tabLabels = typeof window.getCharacterTabLabels === 'function' ? window.getCharacterTabLabels() : {};
        const named = {
            profile: 'Profile Card', playstyle: 'Playstyle', overview: 'Character Overview', strategy: 'General Strategy',
            modes: 'the list of states', pageConfig: 'Page settings', tool_config: 'Tool setup',
            system_tab_order: 'the order of the tabs', intro: 'Introduction', notes: 'Notes',
        };
        if (named[scope]) return named[scope];
        if (scope === 'extra') return `Custom tab "${k}"`;
        if (scope === 'move') {
            const [cat, id] = k.split('::');
            const move = ((window.editorMasterFrameData || {})[cat] || []).find(m => m && m.id === id);
            return `${tabLabels[cat] || cat}: ${(move && move.name) || id}`;
        }
        if (scope === 'order') return `the order of ${k}`;
        if (scope === 'system_section') return `Section "${k.split('::').slice(1).join('::') || k}" in tab "${k.split('::')[0]}"`;
        if (scope === 'system_tab') return `Tab "${k}"`;
        if (scope === 'gallery_item') return `Gallery item "${k}"`;
        const keyed = (typeof window.getKeyedSections === 'function' ? window.getKeyedSections() : []).find(s => s.scope === scope);
        if (keyed) return `${keyed.entryLabel} "${k}"`;
        const fixed = (window.FIXED_BLOCK_SECTIONS || []).find(s => s.scope === scope);
        if (fixed) return fixed.label;
        return k && k !== 'full' ? `${scope} "${k}"` : scope;
    }

    async function runConflictCheck(out, btn) {
        const say = (text) => { out.innerHTML = `<p class="config-option-hint">${window.escapeHtml(text)}</p>`; };
        const pageId = window.currentEditorCharId;
        if (!pageId || !window.supabaseClient || typeof window.collectEditorDeltas !== 'function') {
            say('The check is not available on this page.');
            return;
        }
        if (!window.currentGlobalUserId) {
            say('Sign in to check.');
            return;
        }

        btn.disabled = true;
        say('Checking...');
        try {
            // What is being typed counts, as Submit flushes first.
            if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
            const mine = await window.collectEditorDeltas();
            if (!mine.length) {
                say('You have no unsent edits on this page, so nothing can clash with them.');
                return;
            }

            const { data, error } = await window.supabaseClient.rpc('get_open_submission_scopes', { p_page_id: pageId });
            if (error) {
                say(`Could not check: ${error.message || 'the request failed'}.`);
                return;
            }

            // Never the submission being edited, against itself.
            const rows = (Array.isArray(data) ? data : []).filter(r => r && r.revision_id !== window.activeEditTicketId);
            const subs = new Map();
            rows.forEach(r => {
                if (!subs.has(r.revision_id)) subs.set(r.revision_id, { who: r.author_name || 'Anonymous', when: r.created_at, mine: !!r.is_mine, parts: [] });
                const clashes = r.scope == null || mine.some(d => d.scope === r.scope && d.key === r.key);
                const part = describePart(r.scope, r.key);
                if (clashes && !subs.get(r.revision_id).parts.includes(part)) subs.get(r.revision_id).parts.push(part);
            });

            const clashing = [...subs.values()].filter(s => s.parts.length);
            if (!subs.size) {
                say('No submissions are waiting for review on this page.');
                return;
            }
            if (!clashing.length) {
                say(`${subs.size} submission${subs.size === 1 ? ' is' : 's are'} waiting for review on this page, and none of them changes what you changed.`);
                return;
            }

            const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(); };
            out.innerHTML = `
                <p class="config-option-hint">${clashing.length === 1 ? 'This submission changes' : `These ${clashing.length} submissions change`} the same part as your edits:</p>
                <ul class="config-conflict-list">
                    ${clashing.map(s => `
                        <li data-conflict-item>
                            <strong>${window.escapeHtml(s.who)}</strong>${s.mine ? ' (you)' : ''}, sent ${window.escapeHtml(when(s.when))}:
                            ${window.escapeHtml(s.parts.join(', '))}
                        </li>`).join('')}
                </ul>`;
        } catch (e) {
            say(`Could not check: ${e.message || e}.`);
        } finally {
            btn.disabled = false;
        }
    }

    // Page settings: words this page colours, and its house style document (a red
    // button beside MoS). They live in desc_data.pageConfig and go in a submission
    // as their own scope, so a reviewer sees the change first. Page-level on a
    // character with states. Gallery and tier list pages have no prose to colour.
    window.PAGE_CONFIG_PAGE_TYPES = ['character', 'system', 'tool'];

    function pageDesc() {
        return window.editorMasterDescData || null;
    }

    function pageSettingsHere() {
        return window.PAGE_CONFIG_PAGE_TYPES.includes(window.currentEditorPageType || 'character') && !!pageDesc();
    }

    // A copy to edit, so typing never writes half a word list into the page.
    function readPageConfig() {
        const config = (pageDesc() || {}).pageConfig || {};
        return {
            words: (Array.isArray(config.words) ? config.words : []).map(w => ({
                word: String((w && w.word) || ''),
                colors: Array.isArray(w && w.colors) ? w.colors.slice() : [],
            })),
            houseStyle: typeof config.houseStyle === 'string' ? config.houseStyle : '',
        };
    }

    // An empty config is removed, so clearing everything leaves the data as it was.
    function writePageConfig(state) {
        const desc = pageDesc();
        if (!desc) return;
        const words = state.words
            .map(w => ({ word: w.word.trim().replace(/\s+/g, ' '), colors: w.colors }))
            .filter(w => w.word && w.colors.length)
            .slice(0, window.PAGE_WORD_LIMIT);
        const houseStyle = state.houseStyle.trim() ? state.houseStyle : '';

        if (!words.length && !houseStyle) delete desc.pageConfig;
        else desc.pageConfig = { words, houseStyle };

        if (typeof window.refreshPageWords === 'function') window.refreshPageWords();
        refreshHouseStyleButton();
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
    }

    /**
     * Shows the House Style button on every page with a Config > Page, written or not.
     */
    function refreshHouseStyleButton() {
        const btn = document.getElementById('btn-house-style');
        if (!btn) return;
        btn.classList.toggle('hidden', !pageSettingsHere());
    }
    window.refreshHouseStyleButton = refreshHouseStyleButton;

    window.openHouseStyle = function () {
        if (document.getElementById('editor-house-style-modal')) return false;
        if (typeof window.generateHTMLForBlocks !== 'function') return false;
        const blocks = window.houseStyleBlocks(readPageConfig().houseStyle);
        const body = blocks.length
            ? `<div class="house-style-text">${window.generateHTMLForBlocks(blocks, '')}</div>
               <p class="mos-footnote">Written by this page's editors for the ones who come after them. Change it in Config &gt; Page.</p>`
            : `<p class="house-style-empty">This page's house style hasn't been written yet.</p>
               <p class="mos-footnote">Anyone can write it in Config &gt; Page.</p>`;

        const box = document.createElement('div');
        box.className = 'editor-modal-overlay editor-notice-overlay';
        box.id = 'editor-house-style-modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'House Style');

        // The renderer escapes the text, then the styling pass turns its tags into
        // formatting, as on a page.
        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box mos-modal-box">
                <div class="auth-header"><h3>HOUSE STYLE</h3></div>
                <div class="auth-body mos-body">
                    ${body}
                    <div class="modal-actions-centered mos-actions">
                        <button type="button" class="btn-sys btn-sys-green" data-house-style-ok>OK</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);
        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();

        const shut = () => {
            if (box.parentNode) box.parentNode.removeChild(box);
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') shut(); }
        box.addEventListener('click', (e) => { if (e.target.closest('[data-house-style-ok]')) shut(); });
        document.addEventListener('keydown', onKey);

        const ok = box.querySelector('[data-house-style-ok]');
        if (ok) ok.focus();
        return true;
    };

    function pagePanelHTML() {
        return `
            <div class="config-panel hidden" data-config-panel="page">
                <p class="config-option-hint">These belong to this page, not your device. They go out with your next submission and are reviewed like any other edit.</p>
                <fieldset class="config-group">
                    <legend class="config-option-label">Auto-color words</legend>
                    <span class="config-option-hint">These custom words will be colored everywhere on this page. Whole words only, in the exact case typed ("Domain", not "domain"). [noauto=all] can stop it, and built-in auto-colors (character names, frame data, moves) are prioritized over this.</span>
                    <div class="config-words" data-config-words></div>
                    <div class="config-actions">
                        <button type="button" class="btn-sys btn-sys-regular" data-word-add>+ ADD WORD</button>
                        <span class="config-option-hint" data-word-count></span>
                    </div>
                </fieldset>
                <fieldset class="config-group">
                    <legend class="config-option-label">House style</legend>
                    <span class="config-option-hint">How this page is written, for the editors who come after you. Format tags work here. It opens from the House Style button next to MoS.</span>
                    <textarea class="editor-textarea config-house-style" data-house-style rows="6" spellcheck="true"></textarea>
                </fieldset>
            </div>`;
    }

    // One colour popup for the whole list, moved to the row that opened it. Its
    // markup is the Block editor's, ids included: initColorPicker looks only inside
    // the container it is handed.
    function wordColorPopup() {
        const el = document.createElement('div');
        el.className = 'config-word-popup hidden';
        el.innerHTML = `
            <div class="format-color-presets-scroll"><div data-recent-slot></div>${typeof colorPresetsHTML === 'function' ? colorPresetsHTML(gradientPresetsHTML()) : ''}</div>
            <div class="cp-label">Custom</div>
            <div class="cp-surface" id="cp-surface"><div class="cp-thumb" id="cp-surface-thumb"></div></div>
            <div class="cp-hue" id="cp-hue" role="slider" tabindex="0"
                 aria-label="Hue" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">
                <div class="cp-thumb cp-hue-thumb" id="cp-hue-thumb"></div>
            </div>
            <div class="format-color-custom-row">
                <span class="cp-preview" id="cp-preview"></span>
                <input type="text" id="cp-hex" class="cp-hex" value="#ffffff"
                       maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color">
                <button type="button" class="btn-sys btn-sys-green cp-apply" id="cp-apply">USE</button>
            </div>
            ${typeof gradientBuilderHTML === 'function' ? gradientBuilderHTML() : ''}`;
        return el;
    }

    function wirePagePanel(panel) {
        const state = readPageConfig();
        const list = panel.querySelector('[data-config-words]');
        const count = panel.querySelector('[data-word-count]');
        const addBtn = panel.querySelector('[data-word-add]');
        const house = panel.querySelector('[data-house-style]');
        const popup = wordColorPopup();
        let popupIndex = -1;

        house.value = state.houseStyle;
        house.addEventListener('input', () => {
            state.houseStyle = house.value;
            writePageConfig(state);
        });

        // Through the CSSOM, never a style attribute, cleared first: the browser drops a
        // bad value, which would leave the last colour.
        function paintSwatch(swatch, colors) {
            const safe = colors.filter(c => window.safeColor(c));
            swatch.style.background = '';
            swatch.style.background = safe.length > 1 ? `linear-gradient(90deg, ${safe.join(', ')})` : (safe[0] || '');
        }

        const tidy = (word) => word.trim().replace(/\s+/g, ' ');

        function noteFor(i) {
            const word = tidy(state.words[i].word);
            if (!word) return '';
            if (state.words.findIndex(w => tidy(w.word) === word) !== i) return 'Listed twice. The first one is used.';
            const hit = typeof window.pageWordBuiltIn === 'function' ? window.pageWordBuiltIn(word) : null;
            if (!hit) return '';
            if (hit.kind === 'move') return `"${hit.term}" is a move, so it keeps its move color in the Combos and Techs tabs.`;
            return `"${hit.term}" already has a built-in color, and built-in colors win.`;
        }

        function refreshNotes() {
            list.querySelectorAll('.config-word-row').forEach((row, i) => {
                row.querySelector('[data-word-note]').textContent = noteFor(i);
            });
        }

        function closePopup() {
            popup.classList.add('hidden');
            popupIndex = -1;
            list.querySelectorAll('[data-word-swatch]').forEach(s => s.setAttribute('aria-expanded', 'false'));
        }

        function renderRows() {
            closePopup();
            popup.remove();
            list.innerHTML = state.words.map((w, i) => `
                <div class="config-word-row" data-word-index="${i}">
                    <div class="config-word-main">
                        <button type="button" class="config-word-swatch" data-word-swatch aria-label="Color for this word" aria-expanded="false"></button>
                        <input type="text" class="editor-input config-word-text" data-word-text value="${window.escapeHtml(w.word)}"
                               placeholder="Word or phrase" aria-label="Word" spellcheck="false" autocomplete="off">
                        <button type="button" class="btn-sys btn-sys-red config-word-remove" data-word-remove title="Delete this word">✖</button>
                    </div>
                    <span class="config-option-hint config-word-note" data-word-note></span>
                </div>`).join('');
            list.querySelectorAll('.config-word-row').forEach((row, i) => {
                paintSwatch(row.querySelector('[data-word-swatch]'), state.words[i].colors);
            });
            refreshNotes();
            addBtn.disabled = state.words.length >= window.PAGE_WORD_LIMIT;
            count.textContent = `${state.words.length} of ${window.PAGE_WORD_LIMIT}`;
        }

        function setColors(colors) {
            if (popupIndex < 0 || !state.words[popupIndex]) return;
            if (typeof rememberColors === 'function') rememberColors(colors);
            state.words[popupIndex].colors = colors;
            const row = list.querySelector(`[data-word-index="${popupIndex}"]`);
            if (row) paintSwatch(row.querySelector('[data-word-swatch]'), colors);
            writePageConfig(state);
            closePopup();
        }

        addBtn.addEventListener('click', () => {
            if (state.words.length >= window.PAGE_WORD_LIMIT) return;
            // The first Basic swatch, so a new word does something at once.
            const groups = typeof colorPresetGroups === 'function' ? colorPresetGroups() : [];
            const first = groups[0] && groups[0].swatches[0] ? groups[0].swatches[0].color : '#ffffff';
            state.words.push({ word: '', colors: [first] });
            renderRows();
            const inputs = list.querySelectorAll('[data-word-text]');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });

        list.addEventListener('input', (e) => {
            const input = e.target.closest('[data-word-text]');
            if (!input) return;
            const i = Number(input.closest('.config-word-row').getAttribute('data-word-index'));
            state.words[i].word = input.value;
            writePageConfig(state);
            refreshNotes();
        });

        list.addEventListener('click', async (e) => {
            const row = e.target.closest('.config-word-row');
            if (!row || popup.contains(e.target)) return;
            const i = Number(row.getAttribute('data-word-index'));

            if (e.target.closest('[data-word-remove]')) {
                if (tidy(state.words[i].word) && !(await window.confirmDelete('Delete this word?'))) return;
                state.words.splice(i, 1);
                writePageConfig(state);
                renderRows();
                return;
            }

            const swatch = e.target.closest('[data-word-swatch]');
            if (swatch) {
                const reopen = popupIndex !== i;
                closePopup();
                if (!reopen) return;
                popupIndex = i;
                row.appendChild(popup);
                // A word with a gradient opens on it.
                const colors = state.words[i].colors;
                if (gradientBuilder) gradientBuilder.load(colors.length > 1 ? colors : null);
                const recentSlot = popup.querySelector('[data-recent-slot]');
                if (recentSlot && typeof recentColorsHTML === 'function') recentSlot.innerHTML = recentColorsHTML(true);
                popup.classList.remove('hidden');
                swatch.setAttribute('aria-expanded', 'true');
                popup.scrollIntoView({ block: 'nearest' });
            }
        });

        popup.addEventListener('click', (e) => {
            const gradient = e.target.closest('.gradient-preset-btn');
            if (gradient) { setColors(gradient.getAttribute('data-gradient').split(',')); return; }

            const preset = e.target.closest('.color-preset-btn');
            if (preset) { setColors([preset.getAttribute('data-color')]); return; }
        });

        // The custom gradient's stops all come from the picker: nothing left to check.
        const gradientBuilder = typeof wireGradientBuilder === 'function' ? wireGradientBuilder(popup, setColors) : null;
        if (typeof initColorPicker === 'function') {
            initColorPicker(popup, (hex) => setColors([hex]), gradientBuilder ? gradientBuilder.pickerChanged : null);
        }

        // A click anywhere else in the panel puts the popup away.
        panel.addEventListener('click', (e) => {
            if (popupIndex >= 0 && !popup.contains(e.target) && !e.target.closest('[data-word-swatch]')) closePopup();
        });

        renderRows();
    }

    // The Editor tab's three sections: Workspace, Block and Preview Panel. `invert`
    // ticks the box when the stored value is false.
    const WORKSPACE_OPTIONS = [
        { key: 'confirmDeletes', invert: true, label: 'Skip delete confirmations', hint: 'Disable the delete confirmation prompt for most of the destructive actions. Only recommended for experienced editors.' },
    ];

    const BLOCK_OPTIONS = [
        { key: 'hideBlockType', label: 'Hide Block Type dropdown', hint: 'Each Block now only shows its type instead of a dropdown.' },
        { key: 'hideDragHandle', label: 'Hide Drag-and-drop area', hint: 'Move a Block by grabbing its left edge instead.' },
        { key: 'hideFolderPicker', label: 'Hide Block Folder dropdown', hint: 'Each Block no longer shows the folder dropdown menu. Put a Block in a folder by dragging it onto the folder.' },
        { key: 'formattingOnTop', label: 'Formatting on top', hint: 'Alignment, and the options beside it, sit above a Block\'s content.' },
        { key: 'compactBlocks', label: 'Compact Blocks', hint: 'Less padding and smaller text on each Block, so more of them fit on screen.' },
        { key: 'openMinimized', label: 'Open sections minimized', hint: 'Every section opens with its Blocks minimized, the same as MINIMIZE ALL in Actions.' },
    ];

    const PREVIEW_OPTIONS = [
        { key: 'disablePreview', label: 'Disable Preview Panel', hint: 'The Workspace takes the whole screen. Only for experienced editors who know what they are doing.' },
        { key: 'previewFollows', label: 'Preview follows the Block', hint: 'Clicking into a Block scrolls the Preview Panel to where that Block is.' },
        { key: 'previewOnSync', label: 'Preview only on Sync', hint: 'The Preview Panel waits for SYNC instead of redrawing on every edit. Switching section still redraws it.' },
        { key: 'previewJump', label: 'Click a Block to edit it', hint: 'Clicking a Block in the Preview Panel opens it in the Workspace.' },
    ];

    const STICKY_OPTIONS = [
        { key: 'stickHeader', label: 'Workspace Header' },
        { key: 'stickPageNav', label: 'Page navigation buttons' },
        { key: 'stickSectionNav', label: 'Sections navigation buttons' },
        { key: 'stickActions', label: 'Workspace basic actions (Undo, Redo, Clear All, Create Folder)' },
    ];

    function checkbox(opt) {
        const ticked = opt.invert ? !get(opt.key) : get(opt.key);
        return `
            <label class="config-option">
                <input type="checkbox" data-config-key="${window.escapeHtml(opt.key)}" ${opt.invert ? 'data-config-invert' : ''} ${ticked ? 'checked' : ''}>
                <span class="config-option-text">
                    <span class="config-option-label">${window.escapeHtml(opt.label)}</span>
                    ${opt.hint ? `<span class="config-option-hint">${window.escapeHtml(opt.hint)}</span>` : ''}
                </span>
            </label>`;
    }

    window.openEditorConfig = function () {
        if (document.getElementById('editor-config-modal')) return false;

        const box = document.createElement('div');
        box.className = 'editor-modal-overlay editor-notice-overlay';
        box.id = 'editor-config-modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'Config');

        const withPage = pageSettingsHere();

        box.innerHTML = `
            <div class="editor-modal-box auth-modal-box config-modal-box">
                <div class="auth-header"><h3>CONFIG</h3></div>
                <div class="auth-body config-body">
                    <div class="daw-variant-tabs config-tabs" role="tablist">
                        <button type="button" class="daw-tab-btn active" role="tab" aria-selected="true" data-config-tab="editor">Editor</button>
                        <button type="button" class="daw-tab-btn" role="tab" aria-selected="false" data-config-tab="actions">Actions</button>
                        ${withPage ? '<button type="button" class="daw-tab-btn" role="tab" aria-selected="false" data-config-tab="page">Page</button>' : ''}
                    </div>

                    <div class="config-panel" data-config-panel="editor">
                        <section class="config-section" data-config-section="workspace">
                            <h4 class="config-section-title">Workspace</h4>
                            <fieldset class="config-group">
                                <legend class="config-option-label">Sticky top elements</legend>
                                <span class="config-option-hint">Ticked ones stay on screen while the Workspace scrolls down.</span>
                                ${STICKY_OPTIONS.map(checkbox).join('')}
                            </fieldset>
                            ${WORKSPACE_OPTIONS.map(checkbox).join('')}
                        </section>
                        <section class="config-section" data-config-section="block">
                            <h4 class="config-section-title">Block</h4>
                            ${BLOCK_OPTIONS.map(checkbox).join('')}
                        </section>
                        <section class="config-section" data-config-section="preview">
                            <h4 class="config-section-title">Preview Panel</h4>
                            ${PREVIEW_OPTIONS.map(checkbox).join('')}
                        </section>
                        <p class="config-footnote">Saved on this device only.</p>
                    </div>

                    <div class="config-panel hidden" data-config-panel="actions">
                        <fieldset class="config-group">
                            <legend class="config-option-label">Blocks</legend>
                            <span class="config-option-hint">For the Blocks in the section on screen.</span>
                            <div class="config-actions">
                                <button type="button" class="btn-sys btn-sys-regular" data-config-action="minimize">MINIMIZE ALL</button>
                                <button type="button" class="btn-sys btn-sys-regular" data-config-action="maximize">MAXIMIZE ALL</button>
                            </div>
                            <p class="config-option-hint config-action-note" data-config-note aria-live="polite"></p>
                        </fieldset>${window.editorPlayground ? '' : `
                        <fieldset class="config-group">
                            <legend class="config-option-label">Edit Conflict Check</legend>
                            <span class="config-option-hint">Compares your unsent edits with this page's submissions waiting for review, and lists the ones that change the same part. It shows who and when, never what they wrote.</span>
                            <div class="config-actions">
                                <button type="button" class="btn-sys btn-sys-regular" data-conflict-run>CHECK FOR CONFLICTS</button>
                            </div>
                            <div class="config-conflict-result" data-conflict-result aria-live="polite"></div>
                        </fieldset>`}
                    </div>

                    ${withPage ? pagePanelHTML() : ''}

                    <div class="modal-actions-centered">
                        <button type="button" class="btn-sys btn-sys-green" data-config-close>DONE</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(box);
        if (withPage) wirePagePanel(box.querySelector('[data-config-panel="page"]'));

        const shut = () => {
            if (box.parentNode) box.parentNode.removeChild(box);
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') shut(); }

        box.addEventListener('change', (e) => {
            const input = e.target.closest('[data-config-key]');
            if (!input) return;
            const key = input.getAttribute('data-config-key');
            set(key, input.hasAttribute('data-config-invert') ? !input.checked : input.checked);
            // The preview on screen was drawn before the marks, or held for a Sync this now
            // stands in for. Gallery and tier list pages have no such preview.
            if ((key === 'previewFollows' || key === 'previewOnSync' || key === 'previewJump') && window.currentEditorDescData
                && ['character', 'system', 'tool'].includes(window.currentEditorPageType || 'character')
                && typeof window.drawLivePreviewNow === 'function') window.drawLivePreviewNow(true);
        });

        box.addEventListener('click', (e) => {
            if (e.target.closest('[data-config-close]')) { shut(); return; }

            const tab = e.target.closest('[data-config-tab]');
            if (tab) {
                const name = tab.getAttribute('data-config-tab');
                box.querySelectorAll('[data-config-tab]').forEach(t => {
                    const on = t === tab;
                    t.classList.toggle('active', on);
                    t.setAttribute('aria-selected', String(on));
                });
                box.querySelectorAll('[data-config-panel]').forEach(p =>
                    p.classList.toggle('hidden', p.getAttribute('data-config-panel') !== name));
                return;
            }

            const check = e.target.closest('[data-conflict-run]');
            if (check) {
                runConflictCheck(box.querySelector('[data-conflict-result]'), check);
                return;
            }

            const action = e.target.closest('[data-config-action]');
            if (action) {
                const open = action.getAttribute('data-config-action') === 'maximize';
                const count = setAllBlocksOpen(open);
                const note = box.querySelector('[data-config-note]');
                note.textContent = count
                    ? `${open ? 'Maximized' : 'Minimized'} ${count} Block${count === 1 ? '' : 's'}.`
                    : 'There are no Blocks in the section on screen.';
            }
        });

        document.addEventListener('keydown', onKey);
        const done = box.querySelector('[data-config-close]');
        if (done) done.focus();
        return true;
    };

    // Now, not on DOMContentLoaded: this file is at the end of <body>, so the classes
    // are on before the first paint.
    apply();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { watchSticky(); queueSticky(); });
    } else {
        watchSticky();
        queueSticky();
    }
})();
