/**
 * Dogslamloop Wiki - Tier List Editor (v0.14 item 3, second half)
 *
 * The list lives in the preview pane on the right and is dragged directly;
 * the workspace on the left holds the tier controls, the reasoning editor, and
 * the thing that makes this feature what it is - the pending moves, each
 * demanding a note before SAVE will do anything.
 *
 * THE NOTE RULE IS THE POINT. The owner's requirement is that every character
 * going up or down gets a short note from that author at the time they move
 * it. So this does not offer a changelog field to fill in afterwards: it
 * diffs the board against the placement it loaded, and every difference
 * becomes a row that has to be explained. A changelog written later is a
 * changelog written from memory, and the notes worth having are the ones
 * somebody wrote while they still knew why.
 *
 * The schema enforces it too - tier_list_changes.note is NOT NULL with a
 * length floor - so this file is the courtesy layer over a real rule rather
 * than the rule itself.
 *
 * Drag-and-drop is written here rather than reused from js/tierlist.js. That
 * file's editor operates on the old desc_data.tabs model through
 * window.currentEditorDescData, and it is the least-audited major file in the
 * repo; binding a new feature to it would mean inheriting both its data model
 * and its bugs. Pointer events, so one implementation covers mouse and touch.
 */

(function () {
    const state = {
        list: null,          // the row being edited
        tiers: [],           // working copy: [{ name, color, characters: [entry] }]
        roster: new Map(),   // page_id -> { name, url, image }
        original: new Map(), // entry key -> tier name at load, for the diff
        notes: new Map(),    // entry key -> note typed for its pending move
        // Unplaced entries that carry more than a page_id: copies, and
        // characters with a badge (v1.2). Any other unplaced character is just
        // its page_id, recomputed from the roster as before.
        loose: new Map(),    // entry key -> entry
        gone: new Map(),     // entry key -> entry, for copies deleted this session
        canEdit: false,
        drag: null,
        // Two documents, one block editor. See switchDoc.
        activeDoc: 'intro',
        intro: [],
        reasoning: [],
    };

    const client = () => window.supabaseClient;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function setStatus(text, isError) {
        const node = document.getElementById('tier-save-status');
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('admin-error-text', !!isError);
    }

    function deny(message) {
        document.body.innerHTML = `<div class="access-denied-screen">
            <h1 class="access-denied-title">NO TIER LIST HERE</h1>
        </div>`;
        const title = document.querySelector('.access-denied-title');
        if (title && message) title.textContent = message;
    }

    // --- DATA ---

    // site_utils.js's loadCharacterRoster, shared with every tier list. This
    // was the third copy, and the second found broken (v0.18): it read
    // `entry.image`, which navigation.json never carries, so the editor drew
    // the old guessed art while the reader page showed the current portraits.
    async function loadRoster() {
        state.roster = await window.loadCharacterRoster();
    }

    // --- ENTRIES, COPIES AND BADGES (v1.2) ---
    //
    // An entry is a page_id, a badged character, or a copy; window.tierListEntry
    // (js/site_utils.js) reads all three, the same way the reader page does.
    // Everything below keys on entry.key, so each copy is placed, diffed,
    // noted and logged on its own.
    const entryOf = (raw) => window.tierListEntry(raw);
    const keyOf = (raw) => { const entry = entryOf(raw); return entry ? entry.key : null; };

    // What is saved for an entry. A character with no badge is saved as its
    // page_id, exactly as every list was before copies existed.
    function cleanEntry(raw) {
        const entry = entryOf(raw);
        if (!entry) return null;
        const color = entry.color || '#888888';
        if (entry.copy) return { id: entry.id, copy: entry.copy, label: entry.label, color };
        return entry.label ? { id: entry.id, label: entry.label, color } : entry.id;
    }

    // As stored, which is as any caller sent it (save_tier_list checks only
    // that tiers is an array): anything that is not an entry is dropped, and a
    // key met twice keeps its first place, since two entries with one key
    // could never be told apart.
    function normalizeLoaded() {
        const seen = new Set();
        state.tiers.forEach(tier => {
            tier.characters = (Array.isArray(tier.characters) ? tier.characters : []).filter(raw => {
                const key = keyOf(raw);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        });
    }

    // Where an entry is, to read it or put a changed one back: a tier, or
    // Unranked (state.loose, or for a plain character just its page_id).
    function locate(key) {
        for (const tier of state.tiers) {
            const list = tier.characters || [];
            const i = list.findIndex(raw => keyOf(raw) === key);
            if (i !== -1) return { raw: list[i], replace: (next) => { list[i] = next; }, remove: () => { list.splice(i, 1); } };
        }
        if (state.loose.has(key)) {
            return { raw: state.loose.get(key), replace: (next) => { state.loose.set(key, next); }, remove: () => { state.loose.delete(key); } };
        }
        if (!String(key).includes('#') && state.roster.has(key)) {
            return { raw: key, replace: (next) => { state.loose.set(key, next); }, remove: () => {} };
        }
        return null;
    }

    // page_id -> the keys of its copies, in the order they appear.
    function copyGroups() {
        const groups = new Map();
        const add = (raw) => {
            const entry = entryOf(raw);
            if (!entry || !entry.copy) return;
            if (!groups.has(entry.id)) groups.set(entry.id, []);
            groups.get(entry.id).push(entry.key);
        };
        state.tiers.forEach(tier => (tier.characters || []).forEach(add));
        state.loose.forEach(add);
        return groups;
    }

    // Snapshot of where everyone started, which is the only thing that makes a
    // move detectable later. Taken once at load and never refreshed until a
    // successful save, so moving a character out and back counts as no move.
    function snapshotOriginal() {
        state.original.clear();
        state.tiers.forEach(tier => {
            (tier.characters || []).forEach(raw => {
                const key = keyOf(raw);
                if (key) state.original.set(key, tier.name);
            });
        });
    }

    function currentPlacement() {
        const map = new Map();
        state.tiers.forEach(tier => {
            (tier.characters || []).forEach(raw => {
                const key = keyOf(raw);
                if (key) map.set(key, tier.name);
            });
        });
        return map;
    }

    // Everybody whose tier differs from where they started, in either
    // direction, including first placements and removals.
    function pendingMoves() {
        const now = currentPlacement();
        const moves = [];
        const seen = new Set();

        now.forEach((toTier, id) => {
            seen.add(id);
            const fromTier = state.original.get(id) || null;
            if (fromTier !== toTier) moves.push({ id, from: fromTier, to: toTier });
        });

        state.original.forEach((fromTier, id) => {
            if (!seen.has(id)) moves.push({ id, from: fromTier, to: null });
        });

        return moves;
    }

    // --- THE BOARD ---

    // v0.18 FT4. Read from the control rather than held in state, so the board
    // and the dropdown cannot disagree: there is exactly one place the answer
    // lives while the editor is open, and it is the thing the contributor is
    // looking at.
    function currentArtStyle() {
        const field = document.getElementById('tier-art-style');
        return field && field.value === 'icon' ? 'icon' : 'portrait';
    }

    // `raw` is an entry: a page_id, a badged character or a copy.
    function portrait(raw, draggable) {
        const entry = entryOf(raw) || { key: String(raw), id: String(raw), label: '' };
        const pageId = entry.id;
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };
        const useIcon = currentArtStyle() === 'icon';

        const node = el('div', 'tier-portrait' + (draggable ? ' draggable-portrait' : ''));
        // THE EDITOR BOARD SHOWS WHAT THE READER WILL SEE. Without this the
        // contributor picks "icons", their own board keeps drawing portraits,
        // and the control reads as broken until they open the live page - which
        // is the shape of complaint this project keeps receiving about work
        // that shipped correctly.
        if (useIcon) node.classList.add('tier-portrait-icon');
        node.dataset.charId = entry.key;
        node.title = meta.name;
        // Icon mode moves the colour to the border - see the reader's copy of
        // this in js/certified-tier-lists.js and the rule it feeds in
        // style/Layout.css. The editor board has to make the same choice or a
        // contributor picks icons and previews something the readers will not
        // see.
        const charColor = window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name];
        if (charColor) {
            if (useIcon) node.style.setProperty('--char-color', charColor);
            else node.style.backgroundColor = charColor;
        }

        node.appendChild(el('span', 'tier-portrait-name', meta.name));

        const img = document.createElement('img');
        img.className = 'tier-portrait-img';
        img.alt = '';
        img.draggable = false;
        img.addEventListener('error', () => { img.style.display = 'none'; });

        // Derived from the pageId by the roster's own function, not a second
        // manifest - an icon the owner adds appears here the day it appears on
        // the roster. This page sits at the repo root, so the path needs no
        // prefix, which is why meta.image is used bare above.
        const iconPath = useIcon && typeof window.rosterIconPath === 'function'
            ? window.rosterIconPath(pageId)
            : null;
        // The reader's rule, so the board previews it (style/Layout.css,
        // .is-icon-loaded).
        if (iconPath) img.addEventListener('load', () => node.classList.add('is-icon-loaded'));

        img.src = iconPath || (meta.image
            ? meta.image
            : `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${encodeURIComponent(String(meta.name).replace(/[^a-zA-Z0-9]/g, ''))}Portrait.webp`);
        node.appendChild(img);

        const badge = window.tierBadgeElement(entry);
        if (badge) node.appendChild(badge);

        return node;
    }

    // A badge edited in the panel, redrawn on its portrait alone: renderBoard
    // would rebuild the panel and drop the caret from the field being typed in.
    function refreshBadge(key) {
        const loc = locate(key);
        const entry = loc ? entryOf(loc.raw) : null;
        document.querySelectorAll('.tier-editor-board .tier-portrait, .tier-editor-tray .tier-portrait').forEach(node => {
            if (node.dataset.charId !== key) return;
            node.querySelectorAll('.tier-badge').forEach(b => b.remove());
            const badge = window.tierBadgeElement(entry);
            if (badge) node.appendChild(badge);
        });
    }

    function renderBoard() {
        const board = document.getElementById('tier-editor-board');
        const tray = document.getElementById('tier-editor-tray');
        if (!board || !tray) return;

        board.innerHTML = '';
        state.tiers.forEach((tier, index) => {
            const row = el('div', 'ctl-row tier-editor-row');
            row.dataset.tierIndex = String(index);

            const label = el('div', 'ctl-label', tier.name || '');
            if (tier.color) label.style.backgroundColor = tier.color;
            row.appendChild(label);

            const chars = el('div', 'ctl-chars tier-dropzone');
            chars.dataset.tierIndex = String(index);
            (tier.characters || []).forEach(raw => chars.appendChild(portrait(raw, true)));
            row.appendChild(chars);

            board.appendChild(row);
        });

        // Anyone in the roster and in no tier. Recomputed rather than stored,
        // so a character added to the wiki after this list was written shows up
        // here on the next edit instead of being invisible forever. Then the
        // copies waiting to be placed (v1.2), which only state.loose holds.
        const placed = new Set(currentPlacement().keys());

        tray.innerHTML = '';
        tray.dataset.tierIndex = 'unranked';
        let unranked = 0;
        state.roster.forEach((_meta, id) => {
            if (placed.has(id)) return;
            tray.appendChild(portrait(state.loose.get(id) || id, true));
            unranked += 1;
        });
        state.loose.forEach((raw, key) => {
            if (!key.includes('#') || placed.has(key)) return;
            tray.appendChild(portrait(raw, true));
            unranked += 1;
        });
        if (!unranked) tray.appendChild(el('span', 'ctl-empty-note', 'everyone is placed'));
        renderCopies();

        fitTierLabels();
        // Per render, not once at script load: whether the font beats the
        // board onto the page depends on the network, and a single handler
        // registered at parse time fires before there is anything to measure.
        refitWhenFontsLoad();
        renderTierControls();
        renderPendingMoves();
        // A move IS a changelog entry, so the preview has to follow the board.
        // Guarded on state.ready because renderBoard runs during boot BEFORE
        // the block builder is initialised, and renderPreviewDocs flushes the
        // open document - which would write an empty buffer over the
        // introduction it has not loaded yet.
        if (state.ready) renderPreviewDocs();
    }

    // --- TIER NAMES THAT ARE NOT ONE LETTER (v0.16 fine-tuning 3) ---
    //
    // The name was never capped in code - the input allows 24 characters. What
    // capped it was the box: .ctl-label is a fixed 92px at 1.5rem, so anything
    // past about two characters wrapped and pushed the row out of shape, which
    // is why "S" and "A" were the only names that ever looked right.
    //
    // ONE size for every tier, not one per tier. Shrinking only the long name
    // leaves a board where the labels disagree about how important they are,
    // and a tier list is a ranking - the labels are a scale and have to read as
    // one. So the longest name decides, and everybody wears it.
    const TIER_LABEL_MAX_REM = 1.5;
    const TIER_LABEL_MIN_REM = 0.6;

    // Measured with a Range over the text rather than by scrollWidth. The box
    // is a centred flex container, so an oversized name spills out of BOTH
    // sides - and scrollWidth counts only the overflow to the right, which
    // makes a name that visibly does not fit report that it does.
    function labelOverflows(label) {
        const style = getComputedStyle(label);
        const available = label.clientWidth
            - parseFloat(style.paddingLeft || 0)
            - parseFloat(style.paddingRight || 0);
        if (!(available > 0)) return false;

        const range = document.createRange();
        range.selectNodeContents(label);
        const width = range.getBoundingClientRect().width;
        return width > available + 1;
    }

    // "Fits" means ON ONE LINE. The box already wraps - word-break: break-word
    // - so a long name never overflows and an overflow test would never fire;
    // it just silently reads as two cramped lines, which is the thing that
    // looked broken in the first place.
    function tierLabels() {
        return Array.prototype.slice.call(
            document.querySelectorAll('.tier-editor-row .ctl-label'));
    }

    function fitTierLabels() {
        const labels = tierLabels();
        if (!labels.length) return;

        labels.forEach(label => {
            label.style.fontSize = '';
            label.style.whiteSpace = 'nowrap';
        });

        const tooWide = () => labels.some(labelOverflows);

        let size = TIER_LABEL_MAX_REM;
        // Stepped and re-measured rather than computed from character count:
        // the font is CC-Wild-Words and its glyphs are nowhere near uniform
        // width, so "WWW" and "III" need very different sizes.
        while (tooWide() && size > TIER_LABEL_MIN_REM) {
            size = Math.round((size - 0.1) * 10) / 10;
            labels.forEach(label => { label.style.fontSize = size + 'rem'; });
        }

        // Past the floor, wrapping is the better failure: a 24-character tier
        // name is going to look odd whatever happens, and unreadably small is
        // worse than two lines.
        if (tooWide()) {
            labels.forEach(label => { label.style.whiteSpace = ''; });
        }
    }

    // A web font arrives AFTER first paint, and CC-Wild-Words is far wider
    // than the sans-serif these labels are first measured in - so the size
    // computed on render is a fit for the wrong typeface. Measured once with
    // the fallback, "Situational" settled on 1.2rem and then rendered 119px
    // wide in a 92px box.
    //
    // Resize matters for the same reason: the mobile rule takes .ctl-label
    // from 92px to 64px, and a fit computed at the wider one does not hold.
    function refitWhenFontsLoad() {
        if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => fitTierLabels());
        }
    }
    let refitTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(refitTimer);
        refitTimer = setTimeout(fitTierLabels, 120);
    });

    function renderTierControls() {
        const host = document.getElementById('tier-controls');
        if (!host) return;
        host.innerHTML = '';

        state.tiers.forEach((tier, index) => {
            const row = el('div', 'tier-control-row');

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'editor-input tier-control-name';
            name.value = tier.name || '';
            name.maxLength = 24;
            name.setAttribute('aria-label', 'Tier name');
            name.addEventListener('input', () => {
                // Renaming a tier is not a move. The diff keys on the tier a
                // character sits in, so renaming would otherwise register as
                // everyone in that tier moving - which is both wrong and a wall
                // of notes to write.
                const oldName = tier.name;
                tier.name = name.value;
                state.original.forEach((value, id) => {
                    if (value === oldName) state.original.set(id, tier.name);
                });

                // NOT renderBoard(). That rebuilds the controls too, which
                // destroys the input being typed into and drops the caret - the
                // `name.focus()` that used to follow was focusing a node that
                // had already been thrown away. The result was that a tier
                // could only be renamed one letter at a time, with a click in
                // between each (owner, 2026-08-18).
                //
                // Only the board label actually depends on this value, so only
                // the board label is touched.
                const boardLabel = document.querySelector(
                    `.tier-editor-row[data-tier-index="${index}"] .ctl-label`);
                if (boardLabel) boardLabel.textContent = tier.name;
                fitTierLabels();
                renderPendingMoves();
            });
            row.appendChild(name);

            // The v0.14 picker instead of <input type="color">, which opens the
            // OPERATING SYSTEM's colour dialog on top of the wiki - a different
            // palette, different conventions, and a modal the page cannot see.
            // Same reasoning that replaced it in the block toolbar, and the
            // same engine: initColorPicker resolves its parts with
            // container.querySelector, so a second copy of the markup in a
            // popup of our own is all it needs.
            row.appendChild(tierColorControl(tier, index));

            const up = el('button', 'btn-sys btn-sys-regular tier-control-btn', '▲');
            up.type = 'button';
            up.disabled = index === 0;
            up.addEventListener('click', () => { swapTier(index, index - 1); });
            row.appendChild(up);

            const down = el('button', 'btn-sys btn-sys-regular tier-control-btn', '▼');
            down.type = 'button';
            down.disabled = index === state.tiers.length - 1;
            down.addEventListener('click', () => { swapTier(index, index + 1); });
            row.appendChild(down);

            const remove = el('button', 'btn-sys btn-sys-red tier-control-btn', '✖');
            remove.type = 'button';
            remove.title = 'Remove this tier';
            remove.addEventListener('click', () => {
                // Its occupants go back to unranked rather than vanishing, and
                // each becomes a move that needs a note - removing a tier is a
                // ranking decision about everybody in it.
                state.tiers.splice(index, 1);
                renderBoard();
            });
            row.appendChild(remove);

            host.appendChild(row);
        });
    }

    // A swatch that opens the site's own colour picker. One popup per tier row,
    // built with the picker's markup and handed to initColorPicker - the IDs
    // inside are duplicated across rows, which is fine because every lookup
    // that engine makes is scoped to the container it was given.
    function tierColorControl(tier, index) {
        return colorControl('Tier colour', toHex(tier.color), `Colour for tier ${index + 1}`, (hex) => {
            tier.color = hex;
            // Only the board label's colour depends on this, and rebuilding
            // the controls here would throw away the popup mid-interaction
            // - the same trap the rename handler fell into.
            const boardLabel = document.querySelector(
                `.tier-editor-row[data-tier-index="${index}"] .ctl-label`);
            if (boardLabel) boardLabel.style.backgroundColor = hex;
        });
    }

    // The swatch and its popup, for a tier and (v1.2) for a copy's badge.
    // `heading` is always one of this file's own strings, and `hex` has been
    // through toHex, so neither needs escaping.
    function colorControl(heading, hex, ariaLabel, onPick) {
        const wrap = el('div', 'tier-color-wrap');

        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'tier-control-color';
        swatch.style.backgroundColor = hex;
        swatch.setAttribute('aria-label', ariaLabel);
        wrap.appendChild(swatch);

        const popup = el('div', 'tier-color-popup hidden');
        popup.innerHTML = `
            <div class="cp-label">${heading}</div>
            <div class="cp-surface" id="cp-surface">
                <div class="cp-thumb" id="cp-surface-thumb"></div>
            </div>
            <div class="cp-hue" id="cp-hue" role="slider" tabindex="0"
                 aria-label="Hue" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">
                <div class="cp-thumb cp-hue-thumb" id="cp-hue-thumb"></div>
            </div>
            <div class="format-color-custom-row">
                <span class="cp-preview" id="cp-preview"></span>
                <input type="text" id="cp-hex" class="cp-hex" value="${hex}"
                       maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour">
                <button type="button" class="btn-sys btn-sys-green cp-apply" id="cp-apply">USE</button>
            </div>
        `;
        wrap.appendChild(popup);

        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = popup.classList.contains('hidden');
            document.querySelectorAll('.tier-color-popup').forEach(p => p.classList.add('hidden'));
            popup.classList.toggle('hidden', !opening);
        });

        if (typeof window.initColorPicker === 'function') {
            window.initColorPicker(popup, (picked) => {
                swatch.style.backgroundColor = picked;
                popup.classList.add('hidden');
                onPick(picked);
            });
        }

        return wrap;
    }

    // --- COPIES (v1.2) ---
    //
    // The owner's picks, 2026-11-19: copies are made here, any number of them,
    // each with a badge (a label and a colour), and the character's original
    // may wear one too. A new copy waits in Unranked until it is dragged, and
    // SAVE waits until every copy is placed: only the tiers are saved, so an
    // unplaced copy would have nowhere to be kept.

    function renderCopies() {
        const host = document.getElementById('tier-copies');
        if (!host) return;
        host.innerHTML = '';

        const groups = copyGroups();
        if (!groups.size) {
            host.appendChild(el('p', 'admin-queue-empty-msg', 'No copies yet. Pick a character and a badge, then + COPY.'));
            return;
        }
        groups.forEach((keys, id) => {
            const box = el('div', 'tier-copy-group');
            box.dataset.copyGroup = id;
            box.appendChild(el('div', 'tier-copy-group-name', nameOf(id, { bare: true })));
            box.appendChild(copyRow(id, 'ORIGINAL'));
            keys.forEach(key => box.appendChild(copyRow(key, 'COPY')));
            host.appendChild(box);
        });
    }

    function copyRow(key, kind) {
        const loc = locate(key);
        const entry = (loc && entryOf(loc.raw)) || { key, id: key, copy: null, label: '', color: '' };
        const isCopy = kind === 'COPY';

        const row = el('div', 'tier-copy-row');
        row.dataset.copyKey = key;
        row.appendChild(el('span', 'tier-copy-kind', kind));

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'editor-input tier-copy-label-input';
        input.maxLength = window.TIER_BADGE_MAX;
        input.value = entry.label;
        input.placeholder = isCopy ? 'Badge' : 'No badge';
        input.disabled = !state.canEdit;
        input.setAttribute('aria-label', isCopy ? 'Badge for this copy' : 'Badge for the original');
        input.addEventListener('input', () => setBadge(key, { label: input.value }));
        row.appendChild(input);

        row.appendChild(colorControl('Badge colour', toHex(entry.color || '#888888'),
            isCopy ? 'Badge colour for this copy' : 'Badge colour for the original',
            (hex) => setBadge(key, { color: hex })));

        if (isCopy) {
            const del = el('button', 'btn-sys btn-sys-red tier-control-btn', '✖');
            del.type = 'button';
            del.title = 'Delete this copy';
            del.dataset.copyDelete = '';
            del.disabled = !state.canEdit;
            del.addEventListener('click', () => deleteCopy(key));
            row.appendChild(del);
        }
        return row;
    }

    // A label or colour changed. An original keeps an empty label while it is
    // edited, so its colour is not lost; cleanEntry saves it as a plain page_id.
    function setBadge(key, change) {
        const loc = locate(key);
        if (!loc) return;
        const entry = entryOf(loc.raw);
        const label = change.label !== undefined
            ? String(change.label).trim().slice(0, window.TIER_BADGE_MAX) : entry.label;
        const color = change.color !== undefined ? change.color : (entry.color || '#888888');
        loc.replace(entry.copy
            ? { id: entry.id, copy: entry.copy, label, color }
            : { id: entry.id, label, color });
        refreshBadge(key);
        // Moves and the changelog preview name a copy by its badge.
        renderPendingMoves();
        if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
    }

    function deleteCopy(key) {
        const loc = locate(key);
        if (!loc) return;
        const entry = entryOf(loc.raw);
        // Kept so a placed copy's removal (a move, which needs its note) can
        // still be named after the copy itself is gone.
        state.gone.set(key, entry);
        loc.remove();
        state.loose.delete(key);
        state.notes.delete(key);
        // The last copy takes the original's badge with it: there is nothing
        // left for it to tell apart.
        if (!copyGroups().has(entry.id)) {
            const original = locate(entry.id);
            const originalEntry = original && entryOf(original.raw);
            if (originalEntry && originalEntry.label) setBadge(entry.id, { label: '' });
        }
        renderBoard();
    }

    function addCopy() {
        const select = document.getElementById('tier-copy-character');
        const field = document.getElementById('tier-copy-label');
        if (!select || !field || !state.canEdit) return;
        const id = select.value;
        const label = field.value.trim().slice(0, window.TIER_BADGE_MAX);
        if (!id || !label || !state.roster.has(id)) return;

        // A key nothing has used, here or in the changelog, so an old line
        // can never be read as about a new copy.
        const used = new Set([...currentPlacement().keys(), ...state.loose.keys(), ...state.gone.keys(),
            ...(Array.isArray(state.changes) ? state.changes.map(c => c.character_id) : [])]);
        let copy = '';
        while (!/^[a-z0-9]{4}$/.test(copy) || used.has(`${id}#${copy}`)) {
            copy = Math.random().toString(36).slice(2, 6);
        }
        state.loose.set(`${id}#${copy}`, { id, copy, label, color: '#888888' });

        field.value = '';
        updateAddCopyState();
        renderBoard();
    }

    function updateAddCopyState() {
        const select = document.getElementById('tier-copy-character');
        const field = document.getElementById('tier-copy-label');
        const btn = document.getElementById('btn-add-copy');
        if (!btn) return;
        btn.disabled = !state.canEdit || !select || !select.value || !field || !field.value.trim();
    }

    // Filled once the roster is in, and only then given the site's dropdown:
    // initializeMangaSelects copies a <select>'s options when it builds, so a
    // dropdown built empty would stay empty.
    function fillCopyCharacters() {
        const select = document.getElementById('tier-copy-character');
        if (!select) return;
        const people = [...state.roster.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
        select.innerHTML = '';
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = 'Pick a character';
        select.appendChild(prompt);
        people.forEach(([id, meta]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = meta.name;
            select.appendChild(option);
        });
        select.disabled = !state.canEdit;
        select.classList.add('editor-select');
        if (typeof window.initializeMangaSelects === 'function') window.initializeMangaSelects();
        select.addEventListener('change', updateAddCopyState);
        updateAddCopyState();
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest || !e.target.closest('.tier-color-wrap')) {
            document.querySelectorAll('.tier-color-popup').forEach(p => p.classList.add('hidden'));
        }
    });

    function swapTier(a, b) {
        if (b < 0 || b >= state.tiers.length) return;
        const tmp = state.tiers[a];
        state.tiers[a] = state.tiers[b];
        state.tiers[b] = tmp;
        renderBoard();
    }

    // <input type="color"> only accepts #rrggbb, and the seeded tiers carry
    // hsl() strings from the original list. Converted through the browser
    // rather than by hand so every colour format it understands is covered.
    function toHex(value) {
        if (!value) return '#888888';
        if (/^#[0-9a-f]{6}$/i.test(value)) return value;
        try {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color;
            probe.remove();
            const parts = rgb.match(/\d+/g);
            if (!parts || parts.length < 3) return '#888888';
            return '#' + parts.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return '#888888';
        }
    }

    // --- PENDING MOVES ---

    function renderPendingMoves() {
        const host = document.getElementById('tier-pending-moves');
        const count = document.getElementById('tier-move-count');
        const save = document.getElementById('btn-save-tier-list');
        if (!host) return;

        const moves = pendingMoves();
        if (count) count.textContent = String(moves.length);

        host.innerHTML = '';

        if (!moves.length) {
            host.appendChild(el('p', 'admin-queue-empty-msg',
                'Drag a character to another tier and it will appear here.'));
            // Still saveable: retitling a tier, reordering, or editing the
            // reasoning are real edits that move nobody and need no note.
            // The gate still runs, for a copy left in Unranked (v1.2).
            updateSaveState();
            return;
        }

        moves.forEach(move => {
            const meta = { name: nameOf(move.id) };
            const row = el('div', 'tier-move');

            const head = el('div', 'tier-move-head');
            head.appendChild(el('span', 'tier-move-char', meta.name));
            head.appendChild(el('span', 'tier-move-arrow',
                move.from && move.to ? `${move.from} → ${move.to}`
                    : (move.to ? `→ ${move.to}` : `${move.from} → unranked`)));
            row.appendChild(head);

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'editor-input tier-move-note';
            input.placeholder = 'Why? Required.';
            input.maxLength = 500;
            input.dataset.charId = move.id;
            input.value = state.notes.get(move.id) || '';
            input.setAttribute('aria-label', `Reason for moving ${meta.name}`);
            input.addEventListener('input', () => {
                state.notes.set(move.id, input.value);
                updateSaveState();
                // The note is a changelog entry, and the preview shows the
                // changelog - so it follows the typing like the documents do.
                if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
            });
            row.appendChild(input);

            host.appendChild(row);
        });

        updateSaveState();
    }

    // The gate. Mirrors the schema's own floor of three characters after
    // trimming, so the button and the database agree about what counts.
    function updateSaveState() {
        const save = document.getElementById('btn-save-tier-list');
        if (!save) return;

        const moves = pendingMoves();
        const missing = moves.filter(m => (state.notes.get(m.id) || '').trim().length < 3);
        const blocked = copyProblem();

        save.disabled = !state.canEdit || missing.length > 0 || !!blocked;

        if (blocked) {
            setStatus(blocked);
        } else if (missing.length) {
            setStatus(missing.length === 1
                ? `${nameOf(missing[0].id)} still needs a note.`
                : `${missing.length} moves still need notes.`);
        } else {
            setStatus('');
        }
    }

    // What stops a save about copies (v1.2), or null. Only the tiers are
    // saved, so a copy left in Unranked would be lost, and a copy is told
    // apart by its badge, so it cannot be blank.
    function copyProblem() {
        const unlabeled = [];
        state.tiers.forEach(tier => (tier.characters || []).forEach(raw => {
            const entry = entryOf(raw);
            if (entry && entry.copy && !entry.label) unlabeled.push(entry.key);
        }));
        const waiting = [...state.loose.keys()].filter(key => key.includes('#'));
        state.loose.forEach(raw => {
            const entry = entryOf(raw);
            if (entry && entry.copy && !entry.label) unlabeled.push(entry.key);
        });
        if (unlabeled.length) return 'Every copy needs a badge.';
        if (waiting.length) return `Place or delete every copy before saving: ${nameOf(waiting[0])} is in Unranked.`;
        return null;
    }

    // --- DRAG AND DROP ---
    //
    // Pointer events, so mouse and touch are one implementation. The ghost is
    // a clone following the pointer; the original stays in place at reduced
    // opacity so the reader can still see where it came from.
    function beginDrag(e) {
        const node = e.target.closest('.draggable-portrait');
        if (!node || !state.canEdit) return;

        e.preventDefault();

        const ghost = node.cloneNode(true);
        ghost.classList.add('tier-portrait-ghost');
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        document.body.appendChild(ghost);

        node.classList.add('tier-portrait-dragging');
        state.drag = { charId: node.dataset.charId, node, ghost };

        node.setPointerCapture(e.pointerId);
    }

    function moveDrag(e) {
        if (!state.drag) return;
        state.drag.ghost.style.left = `${e.clientX}px`;
        state.drag.ghost.style.top = `${e.clientY}px`;

        // elementFromPoint rather than pointerenter on the zones: the ghost
        // follows the cursor and would otherwise be the element under it.
        state.drag.ghost.style.pointerEvents = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const zone = under && under.closest('.tier-dropzone, .tier-editor-tray');

        document.querySelectorAll('.tier-dropzone-hot').forEach(z => z.classList.remove('tier-dropzone-hot'));
        if (zone) zone.classList.add('tier-dropzone-hot');
    }

    function endDrag(e) {
        if (!state.drag) return;

        const { charId, node, ghost } = state.drag;
        ghost.remove();
        node.classList.remove('tier-portrait-dragging');

        const under = document.elementFromPoint(e.clientX, e.clientY);
        const zone = under && under.closest('.tier-dropzone, .tier-editor-tray');
        document.querySelectorAll('.tier-dropzone-hot').forEach(z => z.classList.remove('tier-dropzone-hot'));

        state.drag = null;

        if (!zone) return;
        placeCharacter(charId, zone.dataset.tierIndex);
    }

    // Also the keyboard and test path: moving a character is a data operation,
    // and the drag is one way to trigger it rather than the operation itself.
    //
    // `charId` is an entry key (v1.2): the entry itself is what moves, so a
    // copy or a badged character keeps its badge wherever it goes.
    function placeCharacter(charId, target) {
        const loc = locate(charId);
        if (!loc) return;
        const raw = loc.raw;
        loc.remove();
        state.loose.delete(charId);

        const index = Number(target);
        if (target !== 'unranked' && Number.isInteger(index) && state.tiers[index]) {
            state.tiers[index].characters = state.tiers[index].characters || [];
            state.tiers[index].characters.push(raw);
        } else if (typeof raw === 'object') {
            // Unranked keeps a copy, or a character's badge, for the session.
            state.loose.set(charId, raw);
        }

        // A character dragged back to where they started stops being a pending
        // move, and their half-typed note goes with it.
        const now = currentPlacement().get(charId) || null;
        if ((state.original.get(charId) || null) === now) state.notes.delete(charId);

        renderBoard();
    }
    window.tierEditorPlace = placeCharacter;

    // --- TWO DOCUMENTS, ONE BLOCK EDITOR ---
    //
    // initStrategyBlockBuilder keeps a single module-level buffer
    // (currentStrategyBlocks in js/editor-blocks.js), so two builders cannot
    // exist at the same time. Switching therefore has to flush the open one
    // before loading the other - exactly what editor-tabs.js does when it
    // crosses a tab boundary, and the bug it fixed there was one tab's blocks
    // being written into another's.
    const DOC_HINTS = {
        intro: "Shown at the top of your list, in place of the page's own introduction. Yours alone — it does not go through the review queue.",
        reasoning: 'The long-form argument for your placements, shown under the changelog. Same editor the rest of the wiki uses.',
    };

    // --- THE PREVIEW PANEL (v0.16 fine-tuning 3) ---
    //
    // js/editor-blocks.js calls updateLivePreview() BY BARE NAME from about ten
    // places after every block change. It is a top-level declaration in
    // js/editor-sync.js, which this page deliberately does not load - so every
    // edit here threw a ReferenceError, silently, into the console. Confirmed
    // by driving the editor: typeof was 'undefined' and one typing session
    // produced two errors.
    //
    // post-editor.html reimplements it locally for exactly this reason. Here it
    // gets to be the thing it is named after, because this page finally has a
    // preview to update.
    window.updateLivePreview = function () {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreviewDocs, 200);
    };

    let previewTimer = null;

    function renderPreviewDocs() {
        const host = document.getElementById('tier-preview-docs');
        const introHost = document.getElementById('tier-preview-intro');
        if (!host || typeof window.generateHTMLForBlocks !== 'function') return;

        // Read the open document out of the builder first, or the preview shows
        // the last saved version of whatever is being typed right now.
        flushOpenDoc();
        host.innerHTML = '';
        if (introHost) introHost.innerHTML = '';

        // The LIVE page's own classes and structure, copied from
        // js/certified-tier-lists.js - .ctl-intro / .ctl-subheading /
        // .ctl-change and the rest. A preview that renders its own layout is
        // not a preview; it is a second design nobody asked for, and the first
        // version of this had a Finger-Paint card heading where the real page
        // has a small mono label on an accent border (owner, 2026-08-18).
        //
        // Same call the board already made: .ctl-row, .ctl-label and
        // .ctl-chars are the public page's classes too.
        // Into its own host ABOVE the board. The reader meets the author before
        // the ranking, so previewing the introduction underneath the tiers
        // showed the right content in the wrong place (owner, 2026-08-18).
        if (introHost && state.intro && state.intro.length) {
            const box = el('section', 'ctl-intro');
            box.appendChild(el('h3', 'ctl-subheading', 'Tier List Introduction'));
            const body = el('div', 'ctl-intro-body');
            body.innerHTML = window.generateHTMLForBlocks(state.intro);
            box.appendChild(body);
            introHost.appendChild(box);
        }

        // The saved changelog, plus whatever is waiting to join it. Both,
        // because an author writing notes needs to see them in the shape the
        // reader will, not only as a to-do list in the sidebar.
        const saved = Array.isArray(state.changes) ? state.changes : [];
        const pending = pendingMoves();
        if (state.reasoning && state.reasoning.length) {
            const box = el('div', 'ctl-reasoning');
            box.appendChild(el('h3', 'ctl-subheading', 'Reasoning'));
            const body = el('div', 'ctl-reasoning-body');
            body.innerHTML = window.generateHTMLForBlocks(state.reasoning);
            box.appendChild(body);
            host.appendChild(box);
        }

        // Reasoning first, then the changelog - the order the live page uses,
        // because the reasoning is the argument and the changelog is the record
        // of acting on it.
        if (saved.length || pending.length) {
            const box = el('div', 'ctl-changelog');
            box.appendChild(el('h3', 'ctl-subheading', 'Changelog'));

            // Unsaved moves render as real entries, marked - they are what the
            // reader will get the moment SAVE is pressed, and seeing them in
            // the reader's shape is the point of previewing at all.
            const entry = (charId, from, to, note, date, pendingFlag) => {
                const row = el('div', 'ctl-change' + (pendingFlag ? ' ctl-change-pending' : ''));
                const head = el('div', 'ctl-change-head');
                head.appendChild(el('span', 'ctl-change-char', nameOf(charId)));
                const moved = from && to ? `${from} → ${to}`
                    : (to ? `added to ${to}` : `removed from ${from || '—'}`);
                head.appendChild(el('span', 'ctl-change-move', moved));
                head.appendChild(el('span', 'ctl-change-date', date));
                row.appendChild(head);
                row.appendChild(el('p', 'ctl-change-note', note));
                box.appendChild(row);
            };

            pending.forEach(m => entry(
                m.id, m.from, m.to,
                (state.notes.get(m.id) || '').trim() || 'Needs a note before this can be saved.',
                'unsaved', true));

            saved.forEach(c => entry(
                c.character_id, c.from_tier, c.to_tier, c.note || '',
                new Date(c.created_at).toLocaleDateString(), false));

            host.appendChild(box);
        }

        if (!host.children.length && introHost && !introHost.children.length) {
            host.appendChild(el('p', 'ctl-empty-note',
                'Your introduction, reasoning and changelog appear here as you write them.'));
        }

        if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
    }

    // The roster name rather than the page id, so the changelog reads the way
    // the board does. A copy, or a character wearing a badge, is named with it
    // ("Vessel [Ult]"); a copy that no longer exists reads "(copy)". `bare`
    // gives the character's name alone.
    function nameOf(key, { bare = false } = {}) {
        const k = String(key || '');
        const loc = locate(k);
        const entry = (loc && entryOf(loc.raw)) || state.gone.get(k) || null;
        const id = entry ? entry.id : k.split('#')[0];
        const meta = state.roster.get(id);
        const name = meta ? meta.name : id.replace(/_/g, ' ');
        if (bare) return name;
        if (entry && entry.label) return `${name} [${entry.label}]`;
        return k.includes('#') ? `${name} (copy)` : name;
    }

    function flushOpenDoc() {
        if (typeof window.getActiveBlocks !== 'function') return;
        const blocks = JSON.parse(JSON.stringify(window.getActiveBlocks()));
        state[state.activeDoc] = blocks;
    }

    function switchDoc(doc) {
        if (doc !== 'intro' && doc !== 'reasoning') return;
        if (doc === state.activeDoc) return;

        flushOpenDoc();
        state.activeDoc = doc;

        document.querySelectorAll('.tier-doc-btn').forEach(btn => {
            const on = btn.dataset.doc === doc;
            btn.classList.toggle('active', on);
            btn.classList.toggle('btn-sys-blue', on);
            btn.classList.toggle('btn-sys-regular', !on);
        });

        const hint = document.getElementById('tier-doc-hint');
        if (hint) hint.textContent = DOC_HINTS[doc];

        if (typeof initStrategyBlockBuilder === 'function') {
            initStrategyBlockBuilder('strategy-block-target', state[doc]);
        }
        renderPreviewDocs();
    }
    window.tierEditorSwitchDoc = switchDoc;

    // --- SAVING ---

    async function save() {
        const save = document.getElementById('btn-save-tier-list');
        const moves = pendingMoves();

        const missing = moves.filter(m => (state.notes.get(m.id) || '').trim().length < 3);
        if (missing.length || copyProblem()) { updateSaveState(); return; }

        if (save) save.disabled = true;
        setStatus('Saving…');

        // Whichever document is open only reaches state when read out, so it
        // is flushed first. Without this, saving while the introduction is open
        // would write a stale reasoning and silently drop everything just
        // typed into the introduction.
        flushOpenDoc();

        // Read at save time rather than tracked on input: it is one field with
        // no preview to keep in step, and a change listener would be a second
        // place for it to go stale.
        const versionField = document.getElementById('tier-game-version');
        // Same reasoning as the version field above: one control, no preview to
        // keep in step, so it is read at save time rather than tracked on
        // change. Omitted entirely when the control is absent, because the RPC
        // COALESCEs a null and leaves the stored value alone - sending a
        // fallback string here would let a missing element overwrite the
        // author's choice.
        const artField = document.getElementById('tier-art-style');

        const { data, error } = await client().rpc('save_tier_list', {
            p_list_id: state.list.id,
            // Each entry as cleanEntry writes it: a plain page_id unless it
            // wears a badge, so a list with no copies saves exactly as before.
            p_tiers: state.tiers.map(tier => ({
                ...tier,
                characters: (tier.characters || []).map(cleanEntry).filter(Boolean),
            })),
            p_reasoning: state.reasoning,
            p_intro: state.intro,
            p_game_version: versionField ? versionField.value.trim() : '',
            p_art_style: artField ? artField.value : null,
            p_changes: moves.map(m => ({
                character_id: m.id,
                from_tier: m.from,
                to_tier: m.to,
                note: (state.notes.get(m.id) || '').trim(),
            })),
        });

        if (error) {
            if (save) save.disabled = false;
            setStatus(error.message || 'Could not save.', true);
            return;
        }

        // Only now does the board become the new baseline. Doing it before the
        // write would mean a failed save silently discarding the very moves it
        // failed to record.
        snapshotOriginal();
        state.notes.clear();
        state.gone.clear();
        renderBoard();
        renderPreviewDocs();
        setStatus(data || 'Saved.');
    }

    // --- BOOT ---

    document.addEventListener('DOMContentLoaded', async () => {
        if (!client()) { deny('NO CONNECTION'); return; }

        const { data: sessionData } = await client().auth.getSession();
        const session = sessionData ? sessionData.session : null;
        if (!session) { deny('SIGN IN FIRST'); return; }

        await loadRoster();

        // Which list this is. An admin may edit anyone's via ?list=<slug>;
        // everybody else gets their own, and nothing else exists for them.
        const requested = new URLSearchParams(window.location.search).get('list');
        const query = client().from('tier_lists').select('*');
        const { data, error } = requested
            ? await query.eq('slug', requested).maybeSingle()
            : await query.eq('owner_id', session.user.id).maybeSingle();

        if (error || !data) {
            deny(error && /schema cache/i.test(error.message || '')
                ? 'NOT DEPLOYED YET'
                : 'NO TIER LIST ASSIGNED TO YOU');
            return;
        }

        state.list = data;
        state.tiers = Array.isArray(data.tiers) ? JSON.parse(JSON.stringify(data.tiers)) : [];
        normalizeLoaded();
        snapshotOriginal();

        // The client half of the per-row rule. The RPC re-checks it, because
        // this one only decides whether to disable a button.
        const { data: roleRow } = await client()
            .from('user_roles').select('*').eq('user_id', session.user.id).maybeSingle();
        // Mirrors save_tier_list(), owner-gated as of 20260827000003: stamping a
        // patch number onto somebody else's list is an owner action, matching
        // assign_tier_list() beside it.
        state.canEdit = data.owner_id === session.user.id
            || (roleRow && window.roleMeets(roleRow.role, 'owner'));

        const subtitle = document.getElementById('tier-editor-subtitle');
        if (subtitle) {
            subtitle.textContent = state.canEdit
                ? `Editing ${data.author_name}'s list`
                : `${data.author_name}'s list — read only`;
        }

        if (!state.canEdit) {
            const status = document.getElementById('tier-editor-status');
            if (status) status.textContent = 'This list belongs to somebody else.';
        }

        // The art style is set BEFORE the first board is drawn, because
        // portrait() reads it off this control. Set after, as it was until
        // 2026-10-01, every list opened drawn as portraits whatever it stored
        // ("the tier list always default back to the Portraits mode").
        //
        // Absent rather than a value between writing the migration and the
        // release, and the default keeps the control showing what such a list
        // actually renders as.
        const artField = document.getElementById('tier-art-style');
        if (artField) {
            artField.value = data.art_style === 'icon' ? 'icon' : 'portrait';
            artField.disabled = !state.canEdit;
            // The site's dropdown (initializeMangaSelects) is built 100ms after
            // the page loads, long before the list arrives, and it only re-reads
            // the <select> on `change`. Without this it kept saying Portraits
            // over an Icons list. Dispatched before the redraw listener below is
            // attached, and not bubbling, so it changes nothing but the label.
            artField.dispatchEvent(new Event('change'));
            // Redrawn immediately rather than on save. Choosing between two
            // pieces of art is a decision you make by LOOKING at them, and a
            // control whose effect only appears after a round trip is one
            // nobody trusts enough to try.
            artField.addEventListener('change', () => renderBoard());
        }

        // The Copies panel (v1.2). After canEdit is known, which disables it on
        // somebody else's list, and after the roster, which fills its picker.
        fillCopyCharacters();
        const copyLabel = document.getElementById('tier-copy-label');
        if (copyLabel) {
            copyLabel.disabled = !state.canEdit;
            copyLabel.addEventListener('input', updateAddCopyState);
            copyLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCopy(); });
        }
        const addCopyBtn = document.getElementById('btn-add-copy');
        if (addCopyBtn) addCopyBtn.addEventListener('click', addCopy);

        renderBoard();

        state.intro = Array.isArray(data.intro) ? JSON.parse(JSON.stringify(data.intro)) : [];
        state.reasoning = Array.isArray(data.reasoning) ? JSON.parse(JSON.stringify(data.reasoning)) : [];
        state.activeDoc = 'intro';

        // Absent rather than empty on a page loaded before the migration
        // reaches production, which is the normal state between writing a
        // migration and the release - `|| ''` covers both without a branch.
        const versionField = document.getElementById('tier-game-version');
        if (versionField) {
            versionField.value = data.game_version || '';
            versionField.disabled = !state.canEdit;
        }

        if (typeof initStrategyBlockBuilder === 'function') {
            initStrategyBlockBuilder('strategy-block-target', state.intro);
        }

        // The changelog the reader already sees. Fetched once rather than kept
        // live: nothing in this editor writes to it except a save, which
        // reloads anyway.
        const { data: changeRows } = await client()
            .from('tier_list_changes').select('*').eq('list_id', data.id)
            .order('created_at', { ascending: false });
        state.changes = Array.isArray(changeRows) ? changeRows : [];

        // Only now is flushing the open document safe - see renderBoard.
        state.ready = true;
        renderPreviewDocs();

        document.querySelectorAll('.tier-doc-btn').forEach(btn => {
            btn.addEventListener('click', () => switchDoc(btn.dataset.doc));
        });

        const board = document.querySelector('.editor-layout');
        if (board) {
            board.addEventListener('pointerdown', beginDrag);
            board.addEventListener('pointermove', moveDrag);
            board.addEventListener('pointerup', endDrag);
            board.addEventListener('pointercancel', endDrag);
        }

        const saveBtn = document.getElementById('btn-save-tier-list');
        if (saveBtn) saveBtn.addEventListener('click', save);

        const addTier = document.getElementById('btn-add-tier');
        if (addTier) addTier.addEventListener('click', () => {
            state.tiers.push({ name: 'New', color: '#888888', characters: [] });
            renderBoard();
        });

        // Leaving with unwritten notes loses the reasoning, not just the
        // placement - the notes are the part that cannot be reconstructed.
        // A copy still in Unranked is unsaved work too (v1.2).
        window.addEventListener('beforeunload', (e) => {
            const copyWaiting = [...state.loose.keys()].some(key => key.includes('#'));
            if (pendingMoves().length || copyWaiting) { e.preventDefault(); e.returnValue = ''; }
        });
    });
})();
