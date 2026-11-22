/**
 * The ten input slots (M1, 1 to 4, R, Q, F, Space, Shift), and which slot each
 * move name belongs to, for colouring combo routes by input. JJS combos are
 * written name-first ("MURMURATE > R^ > AIR UPDRAFT"), so colouring needs each
 * name's slot.
 * @since v0.15
 * @touches frame_data (each move's `input`), desc_data.characterSettings (slots and
 *   aliases); the slot colours are custom properties in style/ColorCoding.css
 * @watch the map is derived from each move's `input`, never written by hand, so
 *   fixing a move's input fixes its colour too; characterSettings only overrides
 * @see docs/format-tags.md
 */

(function () {
    // The ten slots, in order. Their colours are custom properties in
    // style/ColorCoding.css, where the site's colours live.
    const SLOTS = [
        { id: 'M1',    label: 'Basic Attack', cls: 'is-m1' },
        { id: '1',     label: 'Skill 1',      cls: 'is-1' },
        { id: '2',     label: 'Skill 2',      cls: 'is-2' },
        { id: '3',     label: 'Skill 3',      cls: 'is-3' },
        { id: '4',     label: 'Skill 4',      cls: 'is-4' },
        { id: 'R',     label: 'Special',      cls: 'is-r' },
        { id: 'Q',     label: 'Dash',         cls: 'is-q' },
        { id: 'F',     label: 'Block',        cls: 'is-f' },
        { id: 'Space', label: 'Jump',         cls: 'is-space' },
        { id: 'Shift', label: 'Shift-lock',   cls: 'is-shift' },
    ];

    SLOTS.forEach(Object.freeze);
    /** The ten slots, and their ids, for patterns that match a bare key. */
    window.INPUT_SLOTS = Object.freeze(SLOTS);
    window.INPUT_SLOT_IDS = Object.freeze(SLOTS.map(s => s.id));

    const BY_ID = new Map(SLOTS.map(s => [s.id.toUpperCase(), s]));
    /** A slot by its id, in any case, or null. */
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
    // a space are the same separator: frame data says "Dive-Bomb" and
    // people write "Dive Bomb". Without this, every hyphenated move on the
    // roster would need an alias to colour at all.
    const normalise = (name) => String(name === null || name === undefined ? '' : name)
        .trim().replace(/[\s‐-―-]+/g, ' ').toLowerCase();

    // The tabs that hold a move array, from the tab list, resolved at call time.
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

    // Mechanics every character shares, which no character's frame data holds, named
    // the way people write them ("Side Dash"). Not Block: combo prose uses it as an
    // ordinary verb ("block the follow-up"). A kit with a move named Block still gets
    // it from deriveMoveSlots, or through characterSettings.slots.
    const UNIVERSAL_MECHANICS = {
        Q: ['Dash', 'Side Dash', 'Front Dash', 'Forward Dash', 'Back Dash', 'Backward Dash', 'Air Dash'],
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
    /** A move name as matched: hyphens and spaces are one separator, lower case. */
    window.normaliseMoveName = normalise;
})();
