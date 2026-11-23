/**
 * The character tab list: which tabs a character page has, in order, with the
 * attributes every page, the editor and the Overseer derive their own lists from.
 * Also the keyed sections (data that is an array of named entries), the document
 * tabs' three parts, and the in-page link targets.
 * @since v0.15
 * @touches page_data.tab_settings (optional tabs); desc_data and frame_data (link
 *   targets and the search index)
 * @watch it loads first, before page_router.js builds the page, so it depends on
 *   nothing that loads later
 * @watch a tab's id is stored everywhere (frame data, delta scopes, history, open
 *   submissions): `specials` shows as Innate and `ultimateAtk` as Ultimate, and a
 *   rename changes the label only
 * @see docs/character-page.md
 */

(function () {
    // Attributes:
    //   label        the reader's and the Overseer's strips
    //   editorLabel  edit.html's narrower strip; falls back to label
    //   panelClass   the panel's classes, without `hidden` (see isDefault)
    //   isDefault    the tab that starts visible
    //   injected     in no static strip; added at runtime (character_modes.js,
    //                admin-modes.js)
    //   baseOnlyTab  only for a base-only character, or one with moves in it already
    //   editable     has an editor and a review screen
    //   frameMoves   holds a frame-data move array
    //   modeScoped   drawn again when the mode toggle changes
    //   documentTab  a document in three parts (getDocumentSections)
    //   optional     off until the owner turns it on for a character
    //   keyed        its data is an array of named entries (getKeyedSections)
    const TABS = [
        {
            id: 'overview', label: 'Overview & Strategy', editorLabel: 'Overview',
            panelClass: 'tab-content', isDefault: true,
            editable: true, frameMoves: false, modeScoped: true,
        },
        // The kit first, then how to use it.
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
            // Labelled Innate, id `specials`: see the file header.
            id: 'specials', label: 'Innate',
            panelClass: 'tab-content',
            editable: true, frameMoves: true, modeScoped: true,
        },
        {
            id: 'combos', label: 'Combos',
            panelClass: 'tab-content',
            editable: true, frameMoves: false, modeScoped: true,
            // Not keyed itself: a document of three parts, declared in EXTRA_KEYED_SECTIONS
            // and FIXED_BLOCK_SECTIONS below.
            documentTab: true,
            emptyMessage: 'No combos have been written for this character yet.',
        },
        // Techs: Combos' shape in other words, and optional. The flag is applied in one
        // place, getCharacterTabs.
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
            // No metaField: Starter Guide is Counterplay's shape, without a second meaning
            // for that select.
            keyed: {
                keyField: 'topic', scope: 'starterGuide', entryLabel: 'Starter Guide Topic',
                emptyMessage: 'A starter guide for this character has not been written yet.',
                emptyEntryMessage: 'No details recorded for this topic yet.',
            },
        },
        {
            id: 'matchups', label: 'Matchups',
            panelClass: 'vessel-content',
            editable: true, frameMoves: false, modeScoped: true,
            keyed: {
                keyField: 'opponent', scope: 'matchup', entryLabel: 'Matchup',
                metaField: 'tier',
                // The heading reads "vs. Crow Charmer", and the anchor comes from the heading.
                // Declared, so collectSectionTargets and the page agree.
                headingPrefix: 'vs. ',
                // Its card links to the opponent's page and its editor lists the roster: a
                // different screen, not the shared one with different words.
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
            // modeScoped false: a character's media is the character's, not one state's.
            editable: true, frameMoves: false, modeScoped: false,
            // Declared on the tab, not in EXTRA_KEYED_SECTIONS: the gallery is its whole tab
            // (field === tab id), so getKeyedSectionByTab finds it. One delta per item, keyed
            // by name, so two contributors adding different clips can never collide.
            // charGalleryItem, not gallery_item: that scope is the gallery page type's
            // (newDesc.items). The label tells a reviewer the two apart.
            keyed: {
                keyField: 'name', scope: 'charGalleryItem',
                entryLabel: 'Character Gallery Item',
                // The gallery page type's item shape ({ name, src, alt, tags, note }), so its
                // reader card and editor row are reused.
                customRenderer: true, customEditor: true,
                rendererFn: 'renderCharacterGalleryTab',
                editorFn: 'renderCharacterGalleryEditor',
                // A flat object with no content array: diffed whole, or the review screen would
                // diff two empty arrays and show no change.
                wholeEntryDiff: true,
                unitNoun: 'Gallery Item',
                emptyMessage: 'No media has been added for this character yet.',
                emptyEntryMessage: 'Nothing recorded for this item yet.',
            },
        },
    ];

    // Frozen: a vocabulary, not state. A consumer that changed it would corrupt every
    // later reader on the page.
    TABS.forEach(t => { if (t.keyed) Object.freeze(t.keyed); Object.freeze(t); });
    window.CHARACTER_TABS = Object.freeze(TABS);

    // Optional tabs. page_data.tab_settings says which are on, and every surface that
    // loads a page row hands it to setOptionalCharacterTabs. The filter sits in one
    // place, getCharacterTabs. Off by default, and off when nothing calls the setter:
    // a failed fetch shows one tab too few, never an empty tab nobody can fill.
    let enabledOptionalTabs = [];

    /**
     * Records which optional tabs this page has, from page_data.tab_settings
     * ({"techs": true}) or an array of ids (the Overseer's preview). Anything else
     * means none, so a cached page or a failed fetch fails closed.
     */
    window.setOptionalCharacterTabs = function (settings) {
        const optionalIds = window.CHARACTER_TABS.filter(t => t.optional).map(t => t.id);

        let requested;
        if (Array.isArray(settings)) requested = settings;
        else if (settings && typeof settings === 'object') {
            requested = Object.keys(settings).filter(k => settings[k] === true);
        } else requested = [];

        // Intersected with the tab list, so a stale key cannot bring back a removed tab,
        // and a key naming a tab that is not optional cannot turn it off.
        enabledOptionalTabs = requested.filter(id => optionalIds.includes(id));
        return enabledOptionalTabs.slice();
    };

    /** Which optional tabs are on right now. */
    window.getEnabledOptionalTabs = function () {
        return enabledOptionalTabs.slice();
    };

    /** Every optional tab, on or off: the owner tools draw a checkbox for each. */
    window.getOptionalCharacterTabs = function () {
        return window.CHARACTER_TABS.filter(t => t.optional);
    };

    /**
     * The tabs a surface shows, filtered.
     * @param {Object} [opts]
     * @param {boolean} [opts.includeInjected=false] include `ultimateAtk`: the full
     *   set, for anything reasoning about a loaded character
     * @param {boolean} [opts.editableOnly=false] drop tabs with no editor
     * @param {boolean} [opts.frameMovesOnly=false] only tabs holding a move array
     * @param {boolean} [opts.includeOptional=false] include optional tabs switched
     *   off. Only for building markup (page_router.js), which ships for every
     *   character; never for deciding what someone can reach
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

    /** getCharacterTabs' filters, ids only. */
    window.getCharacterTabIds = function (opts) {
        return window.getCharacterTabs(opts).map(t => t.id);
    };

    /**
     * Shows or hides optional tabs' buttons and panels wherever they are drawn. The
     * strips exist before the page row loads, so a button always exists and this
     * decides whether it shows. Both id conventions: `nav-<id>` (reader, Overseer)
     * and `edit-nav-<id>` (editor).
     */
    window.applyOptionalTabVisibility = function () {
        if (typeof document === 'undefined') return;

        window.getOptionalCharacterTabs().forEach(tab => {
            const on = enabledOptionalTabs.includes(tab.id);

            [`nav-${tab.id}`, `edit-nav-${tab.id}`].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.toggle('hidden', !on);
            });

            // A tab that is on is left alone: setupTabs owns which panel shows.
            const panel = document.getElementById(`tab-${tab.id}`);
            if (panel && !on) panel.classList.add('hidden');
        });
    };

    /**
     * Reads tab_settings off a page_data row and applies it. Every surface that loads
     * a page row calls this.
     */
    window.applyOptionalTabsFromPageRow = function (row) {
        window.setOptionalCharacterTabs(row ? row.tab_settings : null);
        window.applyOptionalTabVisibility();
        return window.getEnabledOptionalTabs();
    };

    // Sections that render inside a tab rather than being one: a document tab's
    // groups and list. Each declares `tab` (where it renders, for the diff) and `role`
    // (intro, groups or list), so the composer and the editor ask for "this tab's
    // groups" rather than naming Combos.
    //
    //   comboGroups  [{ title, content: [blocks] }]   keyed by title
    //   comboList    [{ starter, rows: [...] }]       keyed by starter
    //   techGroups   [{ title, content: [blocks] }]   keyed by title
    //   techList     [{ theory, rows: [...] }]        keyed by theory
    //
    // The list is keyed by starter, so a reviewer sees "5H Starters changed" rather
    // than every row at once.
    const EXTRA_KEYED_SECTIONS = [
        {
            tab: 'combos',
            role: 'groups',
            field: 'comboGroups',
            keyField: 'title',
            scope: 'comboGroup',
            entryLabel: 'Combo Group',
            label: 'Combo Group',
            // Drawn by the tab composer and edited in the Combos sub-tabs, but it needs the
            // shared pipeline (submit, merge, diff, apply).
            customRenderer: true, customEditor: true,
            // What one entry in a group is called in the editor ("COMBO CARDS").
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
            // It draws its own heading above its tables, so collectSectionTargets offers it.
            containerHeading: true,
            rowsField: 'rows',
            customRenderer: true,
            customEditor: true,
            rendererFn: 'renderCombosTab',
            // What one table is called: a Combo List is divided by starter, a Tech List by
            // theory.
            entryNoun: 'Starter', entryNounPlural: 'starters',
            emptyEntryMessage: 'No combos under this starter yet.',
        },

        // The Techs tab: the same shape in its own words. Separate fields and scopes, so
        // an edit to one can never touch the other.
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
            // theory, not starter: a tech is not a combo route, and a different field keeps a
            // Tech List row from ever being read as a combo table.
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

    // Fixed block sections: a plain [blocks] array under its own scope, like overview,
    // so the submit scan and applyDeltaToData find them.
    window.FIXED_BLOCK_SECTIONS = Object.freeze([
        Object.freeze({ tab: 'combos', role: 'intro', field: 'comboIntro', scope: 'comboIntro', label: 'Read First' }),
        Object.freeze({ tab: 'techs', role: 'intro', field: 'techIntro', scope: 'techIntro', label: 'Technical Overview' }),
    ]);

    // Keyed sections: arrays of entries, each named by one field and holding its own
    // Blocks (desc_data[field] = [{ <keyField>: 'Vessel', content: [blocks] }]). The
    // pipeline reads them from here, never by name. `scope` is the delta scope, and is
    // declared, never derived from the tab id: matchups uses 'matchup'.

    /** Every keyed array in desc_data: the tabs' own, then those inside a tab. */
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
     * A document tab's three parts, { intro, groups, list }, or null.
     * @watch not filtered by the optional flag: an approved delta must still apply to
     *   a page whose tab was switched off after the ticket was raised
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

    /** Every document tab that is on: Combos, and Techs where switched on. */
    window.getDocumentTabIds = function () {
        return window.getCharacterTabs({ includeInjected: true })
            .filter(t => t.documentTab)
            .map(t => t.id);
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

    /** A tab's own keyed section, whose field is the tab id (several can render in one tab). */
    window.getKeyedSectionByTab = function (tabId) {
        return window.getKeyedSections().find(s => s.tab === tabId && s.field === tabId) || null;
    };

    /** Look one up by its desc_data field. */
    window.getKeyedSectionByField = function (field) {
        return window.getKeyedSections().find(s => s.field === field) || null;
    };

    // In-page link targets, read from desc_data rather than the DOM: the editor draws
    // only the tab being edited. The walk follows the page's rendered order, because a
    // repeated name is numbered by position (tests/in-page-links.spec.js checks the
    // ids match the page's). The Overview's fixed titles are literals in page_render.js.
    const OVERVIEW_FIXED = [
        { field: 'overview', title: 'Character Overview' },
        { field: 'strategy', title: 'General Strategy' },
    ];

    /**
     * Titles that name nothing (every move card has one), skipped by the contents,
     * assignSectionAnchors and the link picker alike.
     */
    window.GENERIC_SECTION_TITLES = Object.freeze(['Move Overview and Strategy']);

    /**
     * A heading's text without format tags, so an anchor is made from what the reader
     * sees, on the page and in the data alike. Here because this file loads first and
     * runs in Node too.
     * @since v1.0
     * @watch this tag list is one of the copies of the format-tag grammar
     *   (docs/format-tags.md): a new tag goes here too
     */
    const STYLE_SHORTCODES = /\[\/?(?:b|i|u|s|code|kbd|noauto|outline)\]|\[noauto=all\]|\[(?:color|multicolor|url)=[^\]]*\]|\[\/(?:color|multicolor|url)\]|\[icon=[^\]]*\]/gi;
    window.stripStyleShortcodes = function (text) {
        return String(text == null ? '' : text).replace(STYLE_SHORTCODES, '');
    };

    // Page furniture outside the tab strip that still has a heading worth linking to,
    // listed last because it renders last.
    const STRUCTURAL_SECTIONS = Object.freeze([
        Object.freeze({ tab: 'page', tabLabel: 'This Page', title: 'Discussion' }),
    ]);

    // The Block keys that hold readable text, for the full-text index. A list, not
    // every string: the rest is machinery (src, videoId, align), and an index of
    // storage addresses is worse than none.
    const TEXT_KEYS = Object.freeze([
        'content', 'items', 'title', 'caption', 'alt', 'note', 'oneliner', 'headers', 'rows', 'sequence',
    ]);

    /** Every readable string on ONE block, without descending into child blocks. */
    function blockText(block) {
        const out = [];
        const take = (v) => {
            if (typeof v === 'string') { const s = v.trim(); if (s) out.push(s); return; }
            // Arrays of strings are taken; objects are child Blocks, and belong to
            // collectHeadings' recursion.
            if (Array.isArray(v)) v.forEach(take);
        };
        for (const key of TEXT_KEYS) {
            if (key === 'content' && block.type === 'heading') continue;   // it is the target's own title
            if (Object.prototype.hasOwnProperty.call(block, key)) take(block[key]);
        }
        // Notation styles are objects, which take skips, so they are read here: a route in
        // another notation is still the same combo.
        if (Array.isArray(block.notations)) {
            block.notations.forEach(n => { if (n && typeof n === 'object') { take(n.label); take(n.sequence); } });
        }
        return out;
    }

    // sink, when given, is { current: <target> }: body text lands on whichever target
    // is in scope as the walk goes, the way a reader sees text under a subheading as
    // the subheading's.
    function collectHeadings(blocks, push, depth, sink) {
        if (!Array.isArray(blocks) || (depth || 0) > 6) return;
        blocks.forEach(block => {
            if (!block || typeof block !== 'object') return;

            // A Combo Card: its name is a heading, and on a multi-section card each section's
            // name, in tab order, each followed by its write-up. A multi-section card's own
            // fields are never drawn, so they are not walked.
            if (block.type === 'theorybox') {
                const card = block.data || block;
                const parts = (card.multiSections && Array.isArray(card.sections) && card.sections.length)
                    ? card.sections : [card];
                // Text after the card belongs to whatever was in scope before
                // it, not to its last section: the card is a box with an end.
                const outside = sink ? sink.current : null;
                parts.forEach(part => {
                    if (!part || typeof part !== 'object') return;
                    const made = push(part.title);
                    if (sink && made) sink.current = made;
                    if (sink && sink.current) {
                        // Its name is the target's own title, as a heading's is.
                        const text = blockText(made ? { ...part, title: undefined } : part);
                        if (text.length) {
                            if (!sink.current.text) sink.current.text = [];
                            sink.current.text.push(...text);
                        }
                    }
                    collectHeadings(part.content, push, (depth || 0) + 1, sink);
                });
                if (sink) sink.current = outside;
                return;
            }

            if (block.type === 'heading' && block.content) {
                const made = push(block.content);
                // A heading whose title is generic or empty mints nothing; text
                // after it keeps belonging to whatever was in scope before.
                if (sink && made) sink.current = made;
            } else if (sink && sink.current) {
                const text = blockText(block);
                if (text.length) {
                    if (!sink.current.text) sink.current.text = [];
                    sink.current.text.push(...text);
                }
            }
            // Blocks nest: an accordion, and now a Combo Card, carry their own.
            if (Array.isArray(block.content)) collectHeadings(block.content, push, (depth || 0) + 1, sink);
        });
    }

    /**
     * The page's major sections, each with its minor headings: the contents' two
     * levels. Takes frame data too, because a move's heading is its name in
     * frame_data, and only its write-up is in desc_data.
     * @watch opts.collectText also hangs each section's body text on it, for the
     *   search index (scripts/fetch-search-index.js); off for the picker and contents
     */
    window.collectSectionTargets = function (descData, frameData, opts) {
        const data = descData || {};
        const frame = frameData || {};
        const collectText = !!(opts && opts.collectText);
        const targets = [];
        const counts = Object.create(null);

        const slugify = (text) => (window.sectionAnchorSlug
            ? window.sectionAnchorSlug(text)
            : window.stripStyleShortcodes(text).trim().toLowerCase()
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

        const labels = window.getCharacterTabLabels();
        const skipTitles = window.GENERIC_SECTION_TITLES;

        // The next id for a title, as assignSectionAnchors mints them: the first keeps the
        // clean id, and later ones are numbered in page order.
        const mint = (title) => {
            // The name the reader sees, which is also what a search result
            // and the picker show: "Neutral", never "[b]Neutral[/b]".
            const text = window.stripStyleShortcodes(title).trim();
            if (!text || skipTitles.includes(text)) return null;
            const slug = slugify(text);
            if (!slug) return null;
            counts[slug] = (counts[slug] || 0) + 1;
            return {
                id: counts[slug] === 1 ? `sec-${slug}` : `sec-${slug}-${counts[slug]}`,
                title: text,
            };
        };

        // `tabLabel` is an override for the system-page branch below, whose tab
        // names are authored per page and are not in CHARACTER_TABS.
        const addMajor = (tabId, title, tabLabel) => {
            const entry = mint(title);
            if (!entry) return null;
            entry.tab = tabId;
            entry.tabLabel = tabLabel || labels[tabId] || tabId;
            entry.children = [];
            targets.push(entry);
            return entry;
        };

        // A minor heading belongs to the major section above it; with none it stands
        // alone, as the contents treat an orphan. Returns what it minted, so
        // collectHeadings can move its text sink.
        const addMinor = (tabId, parent, title, tabLabel) => {
            const entry = mint(title);
            if (!entry) return null;
            if (parent) { parent.children.push(entry); return entry; }
            entry.tab = tabId;
            entry.tabLabel = tabLabel || labels[tabId] || tabId;
            entry.children = [];
            targets.push(entry);
            return entry;
        };

        // One per major section, for collectHeadings' text sink; none unless text was asked for.
        const sinkFor = (parent) => (collectText ? { current: parent } : undefined);

        // A system page: its content is desc.tabs. Walked in rendered order (tab, section,
        // minor headings), because that decides the numbering when two sections share a
        // title.
        if (Array.isArray(data.tabs)) {
            data.tabs.forEach(tab => {
                if (!tab) return;
                const tabId = tab.tabId || '';
                const tabLabel = tab.tabLabel || tabId;
                (tab.sections || []).forEach(section => {
                    if (!section) return;
                    // A section with no title draws no heading and mints nothing, but its Blocks still
                    // can.
                    const parent = addMajor(tabId, section.sectionTitle, tabLabel);
                    collectHeadings(section.blocks, t => addMinor(tabId, parent, t, tabLabel), 0, sinkFor(parent));
                });
            });

            STRUCTURAL_SECTIONS.forEach(section => {
                const entry = mint(section.title);
                if (!entry) return;
                entry.tab = section.tab;
                entry.tabLabel = section.tabLabel;
                entry.children = [];
                targets.push(entry);
            });

            return targets;
        }

        const frameCategories = window.FRAME_MOVE_CATEGORIES || [];

        window.getCharacterTabIds({ includeInjected: true }).forEach(tabId => {
            if (tabId === 'overview') {
                OVERVIEW_FIXED.forEach(fixed => {
                    const blocks = data[fixed.field];
                    if (!Array.isArray(blocks) || !blocks.length) return;
                    const parent = addMajor(tabId, fixed.title);
                    collectHeadings(blocks, t => addMinor(tabId, parent, t), 0, sinkFor(parent));
                });
                (data.extras || []).forEach(extra => {
                    if (!extra) return;
                    const parent = addMajor(tabId, extra.title);
                    collectHeadings(extra.content, t => addMinor(tabId, parent, t), 0, sinkFor(parent));
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
                    collectHeadings(strategies, t => addMinor(tabId, parent, t), 0, sinkFor(parent));
                });
            }

            // Sections that are a fixed block list inside a tab - Read First.
            (window.FIXED_BLOCK_SECTIONS || [])
                .filter(s => s.tab === tabId)
                .forEach(section => {
                    const blocks = data[section.field];
                    if (!Array.isArray(blocks) || !blocks.length) return;
                    const parent = addMajor(tabId, section.label);
                    collectHeadings(blocks, t => addMinor(tabId, parent, t), 0, sinkFor(parent));
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
                    collectHeadings(entry.content, t => addMinor(tabId, parent, t), 0, sinkFor(parent));
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

    /**
     * The frame-data arrays that hold moves: M1s, Skills, Innate (`specials`), and
     * `ultimateAtk` for a base-only character, whose ultimate is one attack rather
     * than a second kit.
     */
    window.FRAME_MOVE_CATEGORIES = window.getCharacterTabIds({
        includeInjected: true,
        frameMovesOnly: true,
    });
})();
