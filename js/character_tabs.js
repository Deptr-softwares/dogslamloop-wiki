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
 *   Full character   (isBaseOnly: false)  Overview & Strategy, Combos, Starter
 *                                         Guide, M1s, Skills, Specials,
 *                                         Matchups, Counterplay, Gallery
 *                                         - repeated for every state.
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
 *
 * ...plus `Techs` between Combos and Starter Guide, for the characters the
 * owner switches it on for (2026-08-18). It is marked `optional`, and it is the
 * only kind of tab whose presence depends on the character rather than on the
 * vocabulary - see the optional-tab block below.
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
        // Combos and Starter Guide sit between Overview and M1s deliberately:
        // both are things a reader wants before the frame-data tabs, and the
        // owner's vocabulary puts them there. Their content is v0.15 items 2
        // and 3 - the tabs themselves render empty until those land, the same
        // way `gallery` has since v0.12.
        {
            id: 'combos', label: 'Combos',
            panelClass: 'tab-content',
            editable: true, frameMoves: false, modeScoped: true,
            // NOT keyed itself. The tab is a document of three parts -
            // comboIntro, comboGroups and comboList - declared in
            // EXTRA_KEYED_SECTIONS and COMBO_INTRO below, the same way the
            // Overview tab is overview + strategy + extras rather than one
            // keyed array.
            //
            // `documentTab` names that shape so the renderer and the editor can
            // ask for it rather than testing `tabId === 'combos'`. See
            // getDocumentSections below.
            documentTab: true,
            emptyMessage: 'No combos have been written for this character yet.',
        },
        // Techs is Combos' shape with Combos' vocabulary changed, and it is
        // OPTIONAL: off for every character until the owner turns it on in the
        // owner tools. `optional` is the whole feature - see the optional-tab
        // block under getCharacterTabs, which is the ONE place the flag is
        // applied. A condition repeated at the fourteen call sites that read
        // this registry is the mistake the registry was extracted to prevent.
        {
            id: 'techs', label: 'Techs',
            panelClass: 'tab-content',
            editable: true, frameMoves: false, modeScoped: true,
            documentTab: true,
            emptyMessage: 'No techs have been written for this character yet.',
            optional: true,
        },
        {
            id: 'starterGuide', label: 'Starter Guide',
            panelClass: 'vessel-content',
            editable: true, frameMoves: false, modeScoped: true,
            // metaField is deliberately absent: matchups carry a tier and
            // counterplay an importance, but the owner asked for Starter
            // Guide to be Counterplay's SHAPE, not to invent a second
            // meaning for that select. Adding one later is one line here.
            keyed: {
                keyField: 'topic', scope: 'starterGuide', entryLabel: 'Starter Guide Topic',
                emptyMessage: 'A starter guide for this character has not been written yet.',
                emptyEntryMessage: 'No details recorded for this topic yet.',
            },
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
            keyed: {
                keyField: 'opponent', scope: 'matchup', entryLabel: 'Matchup',
                metaField: 'tier',
                // The rendered heading is "vs. Crow Charmer", not "Crow
                // Charmer" (js/description.js:1348), and the anchor is derived
                // from the heading. Declared rather than special-cased in
                // collectSectionTargets, so the two cannot drift apart -
                // matchups were the ONE section whose picker ids missed, and
                // every one of the twenty missed.
                headingPrefix: 'vs. ',
                // Its card links to the opponent's page and its editor lists
                // the roster, so both halves are a different screen rather
                // than the shared one with different words.
                customRenderer: true, customEditor: true,
            },
        },
        {
            id: 'counterplay', label: 'Counterplay',
            panelClass: 'vessel-content',
            editable: true, frameMoves: false, modeScoped: true,
            keyed: {
                keyField: 'topic', scope: 'counterplay', entryLabel: 'Counterplay',
                metaField: 'importance',
                // The importance labels and their colours. Selected BY the
                // value, never supplied by it, so a contributor picks a colour
                // rather than writing one.
                metaColors: {
                    'Crucial': '#ef4444', 'High': '#fb923c', 'Moderate': '#facc15',
                    'Low': '#4ade80', 'Situational': '#22d3ee',
                },
                emptyMessage: 'Counterplay analysis has not been written yet.',
                emptyEntryMessage: 'No specific counterplay details recorded.',
            },
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
    TABS.forEach(t => { if (t.keyed) Object.freeze(t.keyed); Object.freeze(t); });
    window.CHARACTER_TABS = Object.freeze(TABS);

    // --- OPTIONAL TABS ---
    //
    // A tab marked `optional` does not exist for a character until the owner
    // switches it on. The answer lives in page_data.tab_settings, keyed by tab
    // id (supabase/migrations/20260818000002_page_optional_tabs.sql), and every
    // surface that loads a page row hands it to setOptionalCharacterTabs below.
    //
    // ONE FILTER, IN getCharacterTabs. The owner's requirement was that a tab
    // switched off is invisible "even in the editor and the admin preview" -
    // which means the flag has to reach the registry's CONSUMERS, not just the
    // reader's renderer. There are fourteen of them, and a condition repeated
    // fourteen times is the thing this module exists to stop. So the filter
    // sits at the single point every one of them derives its list from, and no
    // consumer knows optional tabs exist.
    //
    // Default OFF, and off is also what a surface that never calls the setter
    // gets. That direction matters: a page whose fetch failed shows one tab too
    // few, which is recoverable, rather than an empty tab nobody can fill.
    let enabledOptionalTabs = [];

    /**
     * Records which optional tabs this page has.
     *
     * Accepts the page_data.tab_settings object verbatim - {"techs": true} -
     * or a plain array of ids, because the admin preview reasons in ids. A
     * null, an array, a string or a missing column all mean "none": the column
     * has a CHECK constraint keeping it an object, but a cached page or a
     * failed fetch must fail closed rather than throw.
     */
    window.setOptionalCharacterTabs = function (settings) {
        const optionalIds = window.CHARACTER_TABS.filter(t => t.optional).map(t => t.id);

        let requested;
        if (Array.isArray(settings)) requested = settings;
        else if (settings && typeof settings === 'object') {
            requested = Object.keys(settings).filter(k => settings[k] === true);
        } else requested = [];

        // Intersected with the vocabulary, so a stale key left in the column by
        // a tab that was later removed cannot resurrect a tab that no longer
        // exists, and a key naming a NON-optional tab cannot turn one off by
        // implication.
        enabledOptionalTabs = requested.filter(id => optionalIds.includes(id));
        return enabledOptionalTabs.slice();
    };

    /** Which optional tabs are on right now. */
    window.getEnabledOptionalTabs = function () {
        return enabledOptionalTabs.slice();
    };

    /**
     * Every optional tab in the vocabulary, on or off.
     *
     * For the owner tools, which draw one checkbox per optional tab. Reading
     * this rather than naming Techs is what makes a second optional tab a
     * registry entry and nothing else.
     */
    window.getOptionalCharacterTabs = function () {
        return window.CHARACTER_TABS.filter(t => t.optional);
    };

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
     * @param {boolean} [opts.includeOptional=false]  include optional tabs this
     *        page has switched OFF. Only the three surfaces that BUILD markup
     *        want this - page_router.js, and the button/panel checks in
     *        tests/character-tab-vocabulary.spec.js - because the markup ships
     *        for every character and visibility is decided afterwards. Anything
     *        deciding what a reader, an editor or a reviewer can reach must not
     *        pass it.
     */
    window.getCharacterTabs = function (opts) {
        const o = opts || {};
        return window.CHARACTER_TABS.filter(t => {
            if (!o.includeInjected && t.injected) return false;
            if (o.editableOnly && !t.editable) return false;
            if (o.frameMovesOnly && !t.frameMoves) return false;
            if (t.optional && !o.includeOptional && !enabledOptionalTabs.includes(t.id)) return false;
            return true;
        });
    };

    /** Same filters, ids only - the shape most call sites actually want. */
    window.getCharacterTabIds = function (opts) {
        return window.getCharacterTabs(opts).map(t => t.id);
    };

    /**
     * Shows or hides the buttons for optional tabs, wherever they are drawn.
     *
     * The strip is built before the page row has loaded - page_router.js runs
     * as the first element in <body>, and admin.html and edit.html ship their
     * strips as static markup - so an optional tab's button always EXISTS and
     * this decides whether it can be seen. That is the same arrangement
     * edit.html already uses for the Ultimate button, which ships `hidden` and
     * is un-hidden by js/editor-modes.js for a base-only character.
     *
     * Both id conventions, because the two admin surfaces disagree and always
     * have: the reader page and admin.html use `nav-<id>`, edit.html uses
     * `edit-nav-<id>`. Querying for both is three lines here against a second
     * copy of this function living in the editor.
     *
     * DOM work in a file whose header says it has no dependencies: it is called
     * by consumers long after load, never at load, and it is here because this
     * is the one module that knows which tabs are optional. Putting it in a
     * consumer would be the fourteen-call-sites mistake in a different shape.
     */
    window.applyOptionalTabVisibility = function () {
        if (typeof document === 'undefined') return;

        window.getOptionalCharacterTabs().forEach(tab => {
            const on = enabledOptionalTabs.includes(tab.id);

            [`nav-${tab.id}`, `edit-nav-${tab.id}`].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.toggle('hidden', !on);
            });

            // The panel is hidden when the tab is off, and otherwise left
            // alone: setupTabs owns which panel is showing once the tab is
            // real, and forcing it visible here would open Techs over whatever
            // the reader was actually looking at.
            const panel = document.getElementById(`tab-${tab.id}`);
            if (panel && !on) panel.classList.add('hidden');
        });
    };

    /**
     * Reads the flag off a page_data row and applies it, in one call.
     *
     * Every surface that loads a page row calls exactly this - the reader
     * (js/description.js), the editor (js/editor-core.js) and the reviewer's
     * preview (js/admin-preview.js) - so none of them has to know the column
     * name or remember the second step.
     */
    window.applyOptionalTabsFromPageRow = function (row) {
        window.setOptionalCharacterTabs(row ? row.tab_settings : null);
        window.applyOptionalTabVisibility();
        return window.getEnabledOptionalTabs();
    };

    // --- SECTIONS THAT RENDER INSIDE A TAB RATHER THAN BEING ONE ---
    //
    // A DOCUMENT TAB is a document, not a list: prose, then author-named groups
    // of cards, then the reference table. Same decomposition the Overview tab
    // already has (overview + strategy + extras), and the same one the
    // reference uses. Combos and Techs are both this shape.
    //
    //   comboIntro   [blocks]                        fixed, "Read First"
    //   comboGroups  [{ title, content: [blocks] }]   N, keyed by title
    //   comboList    [{ starter, rows: [...] }]       N, keyed by starter
    //
    //   techIntro    [blocks]                        fixed, "Technical Overview"
    //   techGroups   [{ title, content: [blocks] }]   N, keyed by title
    //   techList     [{ theory, rows: [...] }]        N, keyed by theory
    //
    // Groups are AUTHOR-NAMED. The reference calls them Beginner / Core /
    // Specialized; the owner's live pages say True / Simpler / Advanced.
    // Hardcoding the reference's names would import a vocabulary this
    // community does not use, which is the exact failure CLAUDE.md warns about.
    //
    // The list is keyed by STARTER, and that is what keeps review readable:
    // the reference has 127 rows for one character, so as a single 'full'
    // delta a reviewer faces all of them at once. Keyed by starter they see
    // "5H Starters changed" - the granularity matchups get per opponent.
    //
    // `tab` names where a section RENDERS, so the diff can still attribute a
    // change to the Combos tab. Everything else in the pipeline keys off
    // `scope` and `field`, neither of which cares whether it is a tab.
    // `role` names which of the three parts a section is, so the composer that
    // draws a document tab and the editor that edits one can ask for "this
    // tab's groups" rather than testing `tabId === 'combos'`. That test was
    // written at ~20 sites across description.js and editor-tabs.js, and
    // copying all of them for Techs would have been the second vocabulary in
    // this file - the exact thing its header is about.
    const EXTRA_KEYED_SECTIONS = [
        {
            tab: 'combos',
            role: 'groups',
            field: 'comboGroups',
            keyField: 'title',
            scope: 'comboGroup',
            entryLabel: 'Combo Group',
            label: 'Combo Group',
            // Rendered by the tab composer and edited by the combos sub-tab
            // strip, because the tab is a DOCUMENT (intro + groups + list),
            // not a list of entries. It still needs the shared pipeline -
            // submit, merge, diff, apply - which is why it is declared here.
            customRenderer: true, customEditor: true,
            // What ONE entry inside a group is called, in the editor: "COMBO
            // CARDS", "Delete this combo card?". Declared rather than written
            // into editor-tabs.js, because Techs calls the same thing a tech.
            unitNoun: 'Combo',
            emptyEntryMessage: 'Nothing written in this group yet.',
        },
        {
            tab: 'combos',
            role: 'list',
            field: 'comboList',
            keyField: 'starter',
            scope: 'comboTable',
            entryLabel: 'Combo List Table',
            label: 'Combo List',
            // This section draws its own heading above its tables
            // (js/description.js:865); matchups and counterplay do not, their
            // entries ARE the headings. Declared so collectSectionTargets can
            // offer it as a link target without knowing about combos.
            containerHeading: true,
            rowsField: 'rows',
            customRenderer: true,
            customEditor: true,
            rendererFn: 'renderCombosTab',
            // What ONE table is called. A Combo List is divided by the move
            // that starts the combo; a Tech List is divided by the theory the
            // techs belong to (owner, 2026-08-18). Same machinery, and the noun
            // is the only thing that separates them.
            entryNoun: 'Starter', entryNounPlural: 'starters',
            emptyEntryMessage: 'No combos under this starter yet.',
        },

        // --- THE TECHS TAB ---
        //
        // Structurally identical to the two above, with the owner's vocabulary
        // (2026-08-18): Read First becomes Technical Overview, Combo Groups
        // become Tech Groups, Combo List becomes Tech List. Everything that
        // differs between the two tabs is a string in these three entries, and
        // that is the point - no renderer, editor, diff, merge or submit branch
        // knows Techs exists.
        //
        // Separate FIELDS, not a shared array with a discriminator: a tech and
        // a combo are different documents, and a contributor editing one must
        // never produce a delta that touches the other. Separate SCOPES for the
        // same reason - a reviewer approving "Tech Group: Wall Techs" should
        // never be able to overwrite a combo group of the same name.
        {
            tab: 'techs',
            role: 'groups',
            field: 'techGroups',
            keyField: 'title',
            scope: 'techGroup',
            entryLabel: 'Tech Group',
            label: 'Tech Group',
            customRenderer: true, customEditor: true,
            unitNoun: 'Tech',
            emptyEntryMessage: 'Nothing written in this group yet.',
        },
        {
            tab: 'techs',
            role: 'list',
            field: 'techList',
            // `theory`, not `starter`. A tech is not a combo route, so the
            // thing a Tech List table is divided by is the theory behind the
            // techs in it - the owner's word, 2026-08-18. Because the field
            // differs as well as the label, a Tech List row can never be read
            // by anything expecting a combo table.
            keyField: 'theory',
            scope: 'techTable',
            entryLabel: 'Tech List Table',
            label: 'Tech List',
            containerHeading: true,
            rowsField: 'rows',
            customRenderer: true,
            customEditor: true,
            rendererFn: 'renderTechsTab',
            entryNoun: 'Theory', entryNounPlural: 'theories',
            emptyEntryMessage: 'No techs under this theory yet.',
        },
    ];
    EXTRA_KEYED_SECTIONS.forEach(Object.freeze);

    // Fixed block sections - a plain [blocks] array under its own scope, the
    // same shape as `overview` and `strategy`. Declared so the submit scan and
    // applyDeltaToData pick them up without another hardcoded name.
    window.FIXED_BLOCK_SECTIONS = Object.freeze([
        Object.freeze({ tab: 'combos', role: 'intro', field: 'comboIntro', scope: 'comboIntro', label: 'Read First' }),
        Object.freeze({ tab: 'techs', role: 'intro', field: 'techIntro', scope: 'techIntro', label: 'Technical Overview' }),
    ]);

    // --- KEYED SECTIONS ---
    //
    // A KEYED SECTION is a tab whose data is an array of entries identified by
    // one field, each holding its own blocks:
    //
    //     desc_data[tab.id] = [ { <keyField>: 'Vessel', content: [blocks] } ]
    //
    // Matchups and Counterplay were the only two, and the pipeline handled
    // them by NAME at about ten `if (scope === 'matchup') … else if (scope ===
    // 'counterplay')` branches - the submit scan, the merge compiler, the
    // reviewer's diff, its label map and its renderer. Adding Starter Guide as
    // a third copy meant finding all ten, and MISSING one is silent: the
    // reviewer approves a ticket whose Starter Guide edits are never applied.
    // That is bug 4's exact shape, which cost a release.
    //
    // `keyed` lives on the tab rather than in a second list because it is a
    // property OF the tab, and two lists that must agree are the problem this
    // module exists to remove.
    //
    // `scope` is the delta scope, and it is NOT always the tab id: matchups
    // uses the singular 'matchup'. Deriving it by appending or trimming an 's'
    // is what produced the 'counterplays' tab id in admin-preview.js - a tab
    // that does not exist, so opening a counterplay ticket never landed on it.
    // It is declared, not computed.

    /**
     * Every keyed array in desc_data, in vocabulary order.
     *
     * Tabs whose own content is keyed, then the sections that render inside a
     * tab without being one. Both need the same pipeline, which is the only
     * thing this list is for.
     */
    window.getKeyedSections = function () {
        return window.CHARACTER_TABS.filter(t => t.keyed)
            .map(t => ({ tab: t.id, field: t.id, label: t.label, ...t.keyed }))
            .concat(EXTRA_KEYED_SECTIONS);
    };

    /** Every keyed section rendered inside a given tab, including its own. */
    window.getKeyedSectionsForTab = function (tabId) {
        return window.getKeyedSections().filter(s => s.tab === tabId);
    };

    /**
     * The three parts of a DOCUMENT TAB - Combos, Techs - by role.
     *
     * Returns { intro, groups, list } or null if the tab is not one. Every
     * caller wants all three at once (the composer draws them in order, the
     * editor's sub-tab strip offers all three), so handing back the trio beats
     * three lookups that could each independently be given the wrong tab.
     *
     * NOT filtered by the optional flag, deliberately. This answers "what shape
     * is this tab", which does not change when a character has the tab switched
     * off - and the pipeline that applies an approved delta has to keep working
     * for a page whose flag was turned off after the ticket was raised.
     * Dropping the section here would make that delta apply silently to
     * nothing, which is bug 4's exact shape. Visibility is getCharacterTabs'
     * job and only getCharacterTabs' job.
     */
    window.getDocumentSections = function (tabId) {
        const tab = window.CHARACTER_TABS.find(t => t.id === tabId);
        if (!tab || !tab.documentTab) return null;

        const intro = (window.FIXED_BLOCK_SECTIONS || [])
            .find(s => s.tab === tabId && s.role === 'intro') || null;
        const keyed = window.getKeyedSectionsForTab(tabId);

        return {
            tab,
            intro,
            groups: keyed.find(s => s.role === 'groups') || null,
            list: keyed.find(s => s.role === 'list') || null,
        };
    };

    /** Every document tab, honouring the optional flag - Combos, and Techs when on. */
    window.getDocumentTabIds = function () {
        return window.getCharacterTabs({ includeInjected: true })
            .filter(t => t.documentTab)
            .map(t => t.id);
    };

    /**
     * The keyed sections that use the SHARED renderer and editor.
     *
     * Matchups and Combos declare `customRenderer` because their screens are
     * genuinely different - a matchup card links to the opponent's page, a
     * combo group draws a sortable table - rather than the shared one with
     * different words. This was written as `tab !== 'matchups'` at five sites;
     * the third such section is where that becomes a list to maintain.
     */
    window.getSharedKeyedSections = function () {
        return window.getKeyedSections().filter(s => !s.customRenderer);
    };

    /** Whether a tab uses the shared renderer/editor. */
    window.usesSharedKeyedUI = function (tabId) {
        const section = window.getKeyedSectionByTab(tabId);
        // Renderer and editor are separate decisions. Combos needs its own
        // table on the reader page but is an ordinary named entry to edit, so
        // it opts out of one and not the other.
        return !!section && !section.customEditor;
    };

    /** Look one up by its delta scope ('matchup', 'counterplay', …). */
    window.getKeyedSectionByScope = function (scope) {
        return window.getKeyedSections().find(s => s.scope === scope) || null;
    };

    /**
     * A tab's OWN keyed section - the one whose field IS the tab id.
     *
     * Matched on field rather than tab, because more than one section can
     * render inside a tab: without this, getKeyedSectionByTab('combos') could
     * return the Combo List and the editor would open the wrong screen for a
     * combo group.
     */
    window.getKeyedSectionByTab = function (tabId) {
        return window.getKeyedSections().find(s => s.tab === tabId && s.field === tabId) || null;
    };

    /** Look one up by its desc_data field. */
    window.getKeyedSectionByField = function (field) {
        return window.getKeyedSections().find(s => s.field === field) || null;
    };

    // --- LINK TARGETS ---
    //
    // Every section on a character page that an in-page link can point at,
    // read from desc_data rather than from the DOM.
    //
    // It has to come from the data, because the editor only ever renders the
    // ONE tab being edited - so a picker that read the preview could offer
    // links within the current tab and nowhere else, which is the opposite of
    // the case this feature exists for.
    //
    // Driven by the registry above, so a tab added later shows up here without
    // anybody remembering to come back. The three hand-listed titles are the
    // Overview tab's fixed sections, which are literals at their render sites
    // in js/description.js rather than registry entries.
    //
    // Walk order mirrors the rendered page - tabs in registry order, and
    // within a tab the section title before the blocks underneath it - because
    // duplicate names are numbered by position. tests/in-page-links.spec.js
    // asserts the ids this produces are the ids the page actually renders.
    const OVERVIEW_FIXED = [
        { field: 'overview', title: 'Character Overview' },
        { field: 'strategy', title: 'General Strategy' },
    ];

    // Every move card renders this same title above its write-up, so on a tab
    // with four M1s it appears four times and names nothing. The ToC has always
    // skipped it by name; assignSectionAnchors skips it for the same reason,
    // and it is listed here so the two agree.
    window.GENERIC_SECTION_TITLES = Object.freeze(['Move Overview and Strategy']);

    // Sections that are page FURNITURE - always present, not editable content,
    // and outside the tab strip. They still carry a heading and are still a
    // reasonable thing to link to, so the picker offers them; they are listed
    // last because that is where they render.
    const STRUCTURAL_SECTIONS = Object.freeze([
        Object.freeze({ tab: 'page', tabLabel: 'This Page', title: 'Discussion' }),
    ]);

    function collectHeadings(blocks, push, depth) {
        if (!Array.isArray(blocks) || (depth || 0) > 6) return;
        blocks.forEach(block => {
            if (!block || typeof block !== 'object') return;
            if (block.type === 'heading' && block.content) push(block.content);
            // Blocks nest: an accordion, and now a Combo Card, carry their own.
            if (Array.isArray(block.content)) collectHeadings(block.content, push, (depth || 0) + 1);
        });
    }

    /**
     * Returns MAJOR sections, each with the minor headings nested under it -
     * the same two-level shape the ToC renders, so the picker can be browsed
     * the same way rather than as one flat list of a hundred entries.
     *
     * Takes frame data as well as desc data, because M1s, Skills and Specials
     * are not in desc_data at all: a move's heading is its NAME, which lives in
     * frame_data, and only the write-up underneath it is desc_data
     * (`moveStrategies[moveId]`). Reading desc_data alone offered no way to
     * link to a skill - the thing this wiki is mostly about.
     */
    window.collectSectionTargets = function (descData, frameData) {
        const data = descData || {};
        const frame = frameData || {};
        const targets = [];
        const counts = Object.create(null);

        const slugify = (text) => (window.sectionAnchorSlug
            ? window.sectionAnchorSlug(text)
            : String(text == null ? '' : text).trim().toLowerCase()
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

        const labels = window.getCharacterTabLabels();
        const skipTitles = window.GENERIC_SECTION_TITLES;

        // Mints the next id for a title, mirroring assignSectionAnchors: the
        // first keeps the clean id and later ones are numbered in document
        // order. Which is why the walk below follows the rendered order of the
        // page rather than any order convenient here.
        const mint = (title) => {
            const text = String(title == null ? '' : title).trim();
            if (!text || skipTitles.includes(text)) return null;
            const slug = slugify(text);
            if (!slug) return null;
            counts[slug] = (counts[slug] || 0) + 1;
            return {
                id: counts[slug] === 1 ? `sec-${slug}` : `sec-${slug}-${counts[slug]}`,
                title: text,
            };
        };

        const addMajor = (tabId, title) => {
            const entry = mint(title);
            if (!entry) return null;
            entry.tab = tabId;
            entry.tabLabel = labels[tabId] || tabId;
            entry.children = [];
            targets.push(entry);
            return entry;
        };

        // A minor heading belongs to the major section above it. With none -
        // a page whose first heading is a block heading - it stands alone,
        // exactly as the ToC treats an orphan.
        const addMinor = (tabId, parent, title) => {
            const entry = mint(title);
            if (!entry) return;
            if (parent) { parent.children.push(entry); return; }
            entry.tab = tabId;
            entry.tabLabel = labels[tabId] || tabId;
            entry.children = [];
            targets.push(entry);
        };

        const frameCategories = window.FRAME_MOVE_CATEGORIES || [];

        window.getCharacterTabIds({ includeInjected: true }).forEach(tabId => {
            if (tabId === 'overview') {
                OVERVIEW_FIXED.forEach(fixed => {
                    const blocks = data[fixed.field];
                    if (!Array.isArray(blocks) || !blocks.length) return;
                    const parent = addMajor(tabId, fixed.title);
                    collectHeadings(blocks, t => addMinor(tabId, parent, t));
                });
                (data.extras || []).forEach(extra => {
                    if (!extra) return;
                    const parent = addMajor(tabId, extra.title);
                    collectHeadings(extra.content, t => addMinor(tabId, parent, t));
                });
            }

            // M1s, Skills, Specials, Ultimate - a card per move, titled with
            // the move's name, and the strategy blocks rendered inside it.
            if (frameCategories.includes(tabId)) {
                const moves = Array.isArray(frame[tabId]) ? frame[tabId] : [];
                moves.forEach(move => {
                    if (!move) return;
                    const parent = addMajor(tabId, move.name);
                    const strategies = (data.moveStrategies || {})[move.id];
                    collectHeadings(strategies, t => addMinor(tabId, parent, t));
                });
            }

            // Sections that are a fixed block list inside a tab - Read First.
            (window.FIXED_BLOCK_SECTIONS || [])
                .filter(s => s.tab === tabId)
                .forEach(section => {
                    const blocks = data[section.field];
                    if (!Array.isArray(blocks) || !blocks.length) return;
                    const parent = addMajor(tabId, section.label);
                    collectHeadings(blocks, t => addMinor(tabId, parent, t));
                });

            // And the keyed ones - matchups, counterplay, starter guide, combo
            // groups, the combo list - each entry named by its own key field.
            window.getKeyedSectionsForTab(tabId).forEach(section => {
                const entries = data[section.field] || [];
                // A section that draws its own heading above its entries -
                // "Combo List". Only when it has entries, because the renderer
                // draws nothing at all for an empty one.
                if (section.containerHeading && entries.length) addMajor(tabId, section.label);

                entries.forEach(entry => {
                    if (!entry) return;
                    const key = entry[section.keyField];
                    // The anchor comes from the RENDERED heading, which is not
                    // always the key on its own - a matchup renders as "vs. X".
                    const parent = key
                        ? addMajor(tabId, `${section.headingPrefix || ''}${key}`)
                        : null;
                    collectHeadings(entry.content, t => addMinor(tabId, parent, t));
                });
            });
        });

        // Last, matching where they render below the tabs.
        STRUCTURAL_SECTIONS.forEach(section => {
            const entry = mint(section.title);
            if (!entry) return;
            entry.tab = section.tab;
            entry.tabLabel = section.tabLabel;
            entry.children = [];
            targets.push(entry);
        });

        return targets;
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
