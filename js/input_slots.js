/**
 * Dogslamloop Wiki - The input slot vocabulary, and how a move name gets one
 *
 * JJS has ten inputs, and the community writes combos NAME-FIRST - "MURMURATE
 * > R↑ > AIR UPDRAFT", not "2 > R > 1". So colouring a route by input means
 * knowing which slot each move NAME belongs to, per character.
 *
 * DERIVED, NOT AUTHORED
 *
 * That mapping already exists: every move in frame_data carries an `input`
 * ("1", "2 Key", "Air + 1 Key", "Space + M1"). A hand-written map beside it
 * would be a second copy of the same fact, and the moment someone edits a
 * move's input the two disagree and the colouring goes quietly wrong - the
 * failure this project has already paid for with tab lists and keyed sections.
 *
 * So the map is derived from frame data, and `desc_data.characterSettings` is
 * a thin OVERRIDE layer on top for the two things derivation cannot do:
 *
 *   aliases   community shorthand - "Garuda" for "Garuda Stab"
 *   slots     moves whose `input` is blank or genuinely ambiguous
 *
 * Measured against the live roster on 2026-08-17: 519 moves, 396 (76%) resolve
 * from `input` alone, 33 are multi-key, and 90 have no input at all. The
 * modifier rule below takes the multi-key ones; the 90 blanks are a frame-data
 * gap - filling `input` fixes the frame-data page AND the colouring at once,
 * which is why the override exists but is not the primary path.
 */

(function () {
    // The ten, in the order the owner listed them (2026-08-16). `outline` is
    // the colour drawn AROUND the text, always on: an outline's whole job is
    // to keep a chip readable against whatever is behind it, and a light slot
    // on a light character page is exactly as unreadable as the reverse.
    //
    // The colours themselves live in style/ColorCoding.css as custom
    // properties, the same way FRAME_COLORS does - CSS is the single source of
    // truth for colour on this site, and the color-codes page reads it.
    const SLOTS = [
        { id: 'M1',    label: 'Basic Attack', cls: 'is-m1',    outline: 'dark' },
        { id: '1',     label: 'Skill 1',      cls: 'is-1',     outline: 'dark' },
        { id: '2',     label: 'Skill 2',      cls: 'is-2',     outline: 'dark' },
        { id: '3',     label: 'Skill 3',      cls: 'is-3',     outline: 'dark' },
        { id: '4',     label: 'Skill 4',      cls: 'is-4',     outline: 'light' },
        { id: 'R',     label: 'Special',      cls: 'is-r',     outline: 'light' },
        { id: 'Q',     label: 'Dash',         cls: 'is-q',     outline: 'light' },
        { id: 'F',     label: 'Block',        cls: 'is-f',     outline: 'dark' },
        { id: 'Space', label: 'Jump',         cls: 'is-space', outline: 'dark' },
        { id: 'Shift', label: 'Shift-lock',   cls: 'is-shift', outline: 'light' },
    ];

    SLOTS.forEach(Object.freeze);
    window.INPUT_SLOTS = Object.freeze(SLOTS);
    window.INPUT_SLOT_IDS = Object.freeze(SLOTS.map(s => s.id));

    const BY_ID = new Map(SLOTS.map(s => [s.id.toUpperCase(), s]));
    window.getInputSlot = function (id) {
        return BY_ID.get(String(id === null || id === undefined ? '' : id).toUpperCase()) || null;
    };

    // Words that MODIFY an input rather than being one. Space and Shift are
    // both - they are slots in their own right, and modifiers when combined:
    // "Space + M1" is the uppercut, an M1, not a jump. So a multi-key input
    // drops these and keeps what is left.
    const MODIFIERS = ['AIR', 'HOLD', 'CHARGED', 'RELEASE', 'LAST', 'SPACE', 'SHIFT'];

    // Bounded by non-alphanumerics so "1" does not match inside "M1", and
    // "R" does not match inside "RELEASE".
    const KEY_PATTERN = /(?<![A-Za-z0-9])(M1|[1-4]|R|Q|F|Space|Shift)(?![A-Za-z0-9])/gi;

    /**
     * The slot an `input` string names, or null.
     *
     * Multi-key inputs are real and common: "Space + M1" (uppercut),
     * "Air + 1 Key", "R into Any 4 Keys", "4 + 1 key". The rule is
     *   1. drop modifiers, and
     *   2. take the FIRST key left - a move is named by the key that starts
     *      it, and anything after is what it leads into.
     * That resolves "R into Any 4 Keys" to R rather than 4, which is the
     * move's own input.
     */
    window.resolveInputSlot = function (input) {
        const raw = String(input === null || input === undefined ? '' : input);
        KEY_PATTERN.lastIndex = 0;

        const found = [];
        let m;
        while ((m = KEY_PATTERN.exec(raw)) !== null) {
            const hit = m[1];
            const canonical = window.getInputSlot(hit);
            if (canonical && !found.includes(canonical.id)) found.push(canonical.id);
        }
        if (found.length === 0) return null;
        if (found.length === 1) return found[0];

        const withoutModifiers = found.filter(id => !MODIFIERS.includes(id.toUpperCase()));
        if (withoutModifiers.length) return withoutModifiers[0];
        // Every key found was a modifier, so it really is one of them -
        // "Shift + Space" names a jump, not nothing.
        return found[0];
    };

    // Move names are matched against what a contributor typed, so a hyphen and
    // a space are the same separator: frame data says "Dive-Bomb" and the
    // owner writes "Dive Bomb". Without this, every hyphenated move on the
    // roster would need an alias to colour at all.
    const normalise = (name) => String(name === null || name === undefined ? '' : name)
        .trim().replace(/[\s‐-―-]+/g, ' ').toLowerCase();

    // From the tab vocabulary, not listed here: these are exactly the tabs
    // that hold a frame-data move array, and a second copy of that list is
    // what tests/character-tab-vocabulary.spec.js exists to prevent. Resolved
    // at call time because character_tabs.js loads just before this file.
    const moveCategories = () => (window.getCharacterTabIds
        ? window.getCharacterTabIds({ includeInjected: true, frameMovesOnly: true })
        : (window.FRAME_MOVE_CATEGORIES || []));

    /**
     * name -> slot id, derived from one frame-data object.
     *
     * Not mode-aware by itself: pass the slice you want. A character's
     * ultimate state has different skills in the same slots, so the same name
     * can mean a different colour per state - which is exactly why this is
     * derived per slice rather than flattened into one map per character.
     */
    window.deriveMoveSlots = function (frameData) {
        const map = new Map();
        if (!frameData) return map;

        moveCategories().forEach(category => {
            const moves = frameData[category];
            if (!Array.isArray(moves)) return;

            moves.forEach(move => {
                if (!move || !move.name) return;
                const slot = window.resolveInputSlot(move.input);
                if (!slot) return;

                const key = normalise(move.name);
                // First writer wins. A move listed twice - "Impetus Updraft"
                // at "1" and at "1 + 1" - is the same move, and the earlier
                // entry is the plain form.
                if (!map.has(key)) map.set(key, slot);

                // Variants carry their own names and share the parent's input
                // unless they declare one.
                if (Array.isArray(move.variants)) {
                    move.variants.forEach(v => {
                        if (!v || !v.name) return;
                        const vKey = normalise(v.name);
                        if (!map.has(vKey)) map.set(vKey, window.resolveInputSlot(v.input) || slot);
                    });
                }
            });
        });

        return map;
    };

    // Mechanics every character shares, which therefore appear in no
    // character's frame data - so derivation can never find them, and a route
    // that says "Side Dash" or "Block" came out uncoloured next to the moves
    // around it (owner, 2026-08-17).
    //
    // Names are what people WRITE, not what a menu calls them: nobody types
    // "Dash Input", they type "Side Dash".
    const UNIVERSAL_MECHANICS = {
        Q: ['Dash', 'Side Dash', 'Front Dash', 'Forward Dash', 'Back Dash', 'Backward Dash', 'Air Dash'],
        F: ['Block', 'Blocking', 'Guard'],
        Space: ['Jump', 'Jumping', 'Double Jump'],
    };

    /**
     * The full map for a page: derived from frame data, then overridden by
     * `desc_data.characterSettings`.
     *
     *   characterSettings: {
     *     slots:   { "Garuda Stab": "4" },        // fills a blank `input`
     *     aliases: { "Garuda": "Garuda Stab" }    // community shorthand
     *   }
     *
     * Overrides are applied AFTER derivation so an author can correct it, and
     * aliases resolve through the map so an alias of a derived move needs no
     * slot of its own.
     */
    window.buildMoveSlotMap = function (frameData, descData) {
        const map = window.deriveMoveSlots(frameData);
        const settings = (descData && descData.characterSettings) || {};

        // Universals fill GAPS rather than seeding the map, so a character
        // whose own kit has a move called "Dash" keeps its own slot for it.
        Object.keys(UNIVERSAL_MECHANICS).forEach(slotId => {
            UNIVERSAL_MECHANICS[slotId].forEach(name => {
                const key = normalise(name);
                if (!map.has(key)) map.set(key, slotId);
            });
        });

        Object.keys(settings.slots || {}).forEach(name => {
            const slot = window.getInputSlot(settings.slots[name]);
            if (slot) map.set(normalise(name), slot.id);
        });

        Object.keys(settings.aliases || {}).forEach(alias => {
            const target = normalise(settings.aliases[alias]);
            // An alias may point at a derived move OR at another override.
            if (map.has(target)) map.set(normalise(alias), map.get(target));
        });

        return map;
    };

    window.UNIVERSAL_MECHANICS = Object.freeze(UNIVERSAL_MECHANICS);
    window.normaliseMoveName = normalise;
})();
