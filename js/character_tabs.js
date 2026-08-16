/**
 * Dogslamloop Wiki - The character tab vocabulary
 *
 * Which tabs a character page has, in the order they appear, with the
 * attributes every consumer derives its own subset from.
 *
 * WHY THIS FILE EXISTS
 *
 * The list was previously written out by hand at ~20 sites across 13 files -
 * ten JS modules and three HTML pages (admin.html, edit.html, and the stubs
 * page_router.js builds). None of those copies had drifted: each was a
 * deliberately different subset, and most carried a comment saying so. That is
 * precisely the problem. Adding one tab means working out, per site, which of
 * five overlapping subsets it belongs to, and nothing checks the answer. The
 * v0.15 Combos and Starter Guide tabs would have been ~40 hand edits.
 *
 * This project has already paid for that once with page types:
 * scripts/page-types.js's header records the type vocabulary living in three
 * places, drifting when v0.12 added `gallery` and `tool`, and taking the whole
 * regeneration job down until someone happened to create a gallery page.
 *
 * LOAD ORDER - this file must come FIRST
 *
 * page_router.js builds the DOM skeleton before site_utils.js or site_meta.js
 * have loaded (that is by design; see its header), so the vocabulary cannot
 * live in site_meta.js next to FRAME_COLORS - it would be undefined at exactly
 * the moment the tabs are built. Hence a standalone file with no dependencies,
 * loaded ahead of page_router.js on stubs and anywhere before the consumers on
 * admin.html and edit.html.
 *
 * THE TWO REAL TAB LISTS, per the owner (2026-08-16):
 *
 *   Full character   (isBaseOnly: false)  Overview & Strategy, M1s, Skills,
 *                                         Specials, Matchups, Counterplay,
 *                                         Gallery - repeated for every state.
 *
 *   Base-only        (isBaseOnly: true)   ...the same, plus Ultimate between
 *                                         Counterplay and Gallery, for their
 *                                         single kit.
 *
 * One ordered list reproduces both: `Ultimate` is marked `injected`, because it
 * is added at runtime by character_modes.js / admin-modes.js rather than
 * shipped in any static strip, and it sits at its real position here so that
 * "after Counterplay, before Gallery" is data rather than an insertAdjacent
 * call that has to be read to be known.
 */

(function () {
    // Attributes, and who reads them:
    //
    //   label        reader + reviewer strips
    //   editorLabel  edit.html's narrower strip, where the full label wraps.
    //                Falls back to `label`.
    //   panelClass   the panel div's classes, WITHOUT `hidden` - see isDefault
    //   isDefault    the tab that starts visible. Was separately hardcoded in
    //                page_router (by omitting `hidden`), in admin-preview.js's
    //                restore-from-diff-mode, and in admin.html's markup.
    //   injected     not present in any static strip; added at runtime
    //   baseOnlyTab  only exists when site_pages.is_base_only is set (or the
    //                character already has moves in it - see character_modes.js,
    //                which deliberately shows it either way so that mislabelled
    //                registry metadata can never hide real data)
    //   editable     has an editor and a reviewer representation. `gallery` does
    //                not: it renders empty on the reader page and is absent from
    //                every admin and editor list. That is why those lists were
    //                shorter, not drift.
    //   frameMoves   holds a frame-data move array (the old FRAME_MOVE_CATEGORIES)
    //   modeScoped   re-renders when the state toggle changes. `gallery` is the
    //                character's media, not one state's, so it stays put.
    const TABS = [
        {
            id: 'overview', label: 'Overview & Strategy', editorLabel: 'Overview',
            panelClass: 'tab-content', isDefault: true,
            editable: true, frameMoves: false, modeScoped: true,
        },
        {
            id: 'm1s', label: 'M1s',
            panelClass: 'tab-content',
            editable: true, frameMoves: true, modeScoped: true,
        },
        {
            id: 'skills', label: 'Skills',
            panelClass: 'vessel-content space-y-8',
            editable: true, frameMoves: true, modeScoped: true,
        },
        {
            id: 'specials', label: 'Specials',
            panelClass: 'tab-content',
            editable: true, frameMoves: true, modeScoped: true,
        },
        {
            id: 'matchups', label: 'Matchups',
            panelClass: 'vessel-content',
            editable: true, frameMoves: false, modeScoped: true,
        },
        {
            id: 'counterplay', label: 'Counterplay',
            panelClass: 'vessel-content',
            editable: true, frameMoves: false, modeScoped: true,
        },
        {
            id: 'ultimateAtk', label: 'Ultimate',
            panelClass: 'vessel-content',
            injected: true, baseOnlyTab: true,
            editable: true, frameMoves: true, modeScoped: false,
        },
        {
            id: 'gallery', label: 'Gallery',
            panelClass: 'vessel-content',
            editable: false, frameMoves: false, modeScoped: false,
        },
    ];

    // Frozen because this is a vocabulary, not state. A consumer that wants a
    // subset filters; one that mutates in place would corrupt every later
    // reader on the page, and those readers run at different times (page_boot,
    // the mode toggle, the reviewer opening a ticket).
    TABS.forEach(Object.freeze);
    window.CHARACTER_TABS = Object.freeze(TABS);

    /**
     * The tabs a given surface should show.
     *
     * @param {Object} [opts]
     * @param {boolean} [opts.includeInjected=false]  include `ultimateAtk`.
     *        False gives the static strip - what ships in the markup. True
     *        gives the full set, which is what anything reasoning about a
     *        loaded character (diffs, the editor) needs.
     * @param {boolean} [opts.editableOnly=false]     drop tabs with no editor
     *        or reviewer representation (`gallery`).
     * @param {boolean} [opts.frameMovesOnly=false]   only tabs holding a
     *        frame-data move array.
     */
    window.getCharacterTabs = function (opts) {
        const o = opts || {};
        return window.CHARACTER_TABS.filter(t => {
            if (!o.includeInjected && t.injected) return false;
            if (o.editableOnly && !t.editable) return false;
            if (o.frameMovesOnly && !t.frameMoves) return false;
            return true;
        });
    };

    /** Same filters, ids only - the shape most call sites actually want. */
    window.getCharacterTabIds = function (opts) {
        return window.getCharacterTabs(opts).map(t => t.id);
    };

    /** id -> label, for anything rendering a tab name it did not build. */
    window.getCharacterTabLabels = function () {
        const map = {};
        window.CHARACTER_TABS.forEach(t => { map[t.id] = t.label; });
        return map;
    };

    /** The tab that starts visible. */
    window.getDefaultCharacterTabId = function () {
        const hit = window.CHARACTER_TABS.find(t => t.isDefault);
        return hit ? hit.id : 'overview';
    };

    // The frame-data arrays that hold moves. `ultimateAtk` is the fourth, for
    // base-only characters: they have no modes to switch between, their
    // ultimate being a single big attack rather than a whole replacement kit,
    // so it renders as one extra tab instead.
    //
    // Defined here rather than in site_utils.js, where it used to live, for two
    // reasons. It is derived from the vocabulary, so it belongs beside it. And
    // this file loads first on every page, so it is available earlier than
    // before - which let seven `window.FRAME_MOVE_CATEGORIES || [...]` cache-skew
    // fallbacks be removed. Every one of those listed three categories against
    // the real four, so had any of them ever fired, a base-only character's
    // ultimate moves would have been silently dropped from the merge compiler,
    // the reviewer's diff and draft sync.
    window.FRAME_MOVE_CATEGORIES = window.getCharacterTabIds({
        includeInjected: true,
        frameMovesOnly: true,
    });
})();
