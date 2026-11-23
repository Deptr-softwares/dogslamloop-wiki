/**
 * The tier editor (tier-editor.html): one person's certified tier list, dragged
 * on the board in the preview, with the tier controls, copies and badges, the
 * introduction and reasoning, and the moves waiting for their notes. Every
 * character moved needs a short note before SAVE, written while the author still
 * knows why.
 * @since v0.14
 * @touches tier_lists, tier_list_changes, save_tier_list(), user_roles,
 *   loadCharacterRoster and tierListEntry (site_data.js), rosterIconPath
 *   (site_meta.js), initStrategyBlockBuilder, currentStrategyBlocks and
 *   initColorPicker (editor-blocks.js)
 * @watch tier_list_changes.note is NOT NULL with a length floor, and the save
 *   gate here mirrors it. Its own drag and drop, not tierlist.js's (another data
 *   model). The board and the preview use the reader page's classes, so the two
 *   must stay alike.
 * @see docs/tier-lists.md
 */

(function () {
    const state = {
        list: null,          // the row being edited
        tiers: [],           // working copy: [{ name, color, characters: [entry] }]
        roster: new Map(),   // page_id -> { name, url, image }
        original: new Map(), // entry key -> tier name at load, for the diff
        notes: new Map(),    // entry key -> note typed for its pending move
        // Unplaced entries that carry more than a page_id: copies and badged
        // characters. Any other unplaced character is its page_id, from the roster.
        loose: new Map(),    // entry key -> entry
        gone: new Map(),     // entry key -> entry, for copies deleted this session
        canEdit: false,
        drag: null,
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

    // The roster loader every tier list shares.
    async function loadRoster() {
        state.roster = await window.loadCharacterRoster();
    }

    // An entry is a page_id, a badged character or a copy, read by tierListEntry as
    // the reader page reads it. Everything keys on entry.key, so each copy is
    // placed, diffed, noted and logged on its own.
    const entryOf = (raw) => window.tierListEntry(raw);
    const keyOf = (raw) => { const entry = entryOf(raw); return entry ? entry.key : null; };

    // A character with no badge is saved as its page_id.
    function cleanEntry(raw) {
        const entry = entryOf(raw);
        if (!entry) return null;
        const color = entry.color || '#888888';
        if (entry.copy) return { id: entry.id, copy: entry.copy, label: entry.label, color };
        return entry.label ? { id: entry.id, label: entry.label, color } : entry.id;
    }

    // As stored, which is as any caller sent it: what is not an entry is dropped,
    // and a key met twice keeps its first place.
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

    // Where an entry is: a tier, or Unranked.
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

    // Where everyone started, the only thing that makes a move detectable. Taken at
    // load and after a successful save, so out and back again is no move.
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

    // Everyone whose tier differs from where they started, first placements and
    // removals included.
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

    // Read from the control, so the board and the dropdown cannot disagree.
    function currentArtStyle() {
        const field = document.getElementById('tier-art-style');
        return field && field.value === 'icon' ? 'icon' : 'portrait';
    }

    function portrait(raw, draggable) {
        const entry = entryOf(raw) || { key: String(raw), id: String(raw), label: '' };
        const pageId = entry.id;
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };
        const useIcon = currentArtStyle() === 'icon';

        const node = el('div', 'tier-portrait' + (draggable ? ' draggable-portrait' : ''));
        // The board shows what the reader will see.
        if (useIcon) node.classList.add('tier-portrait-icon');
        node.dataset.charId = entry.key;
        node.title = meta.name;
        // Icon mode moves the colour to the border, as the reader page does.
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

        // From the roster's own function, so a new icon appears here when it does there.
        // This page is at the repo root, so meta.image needs no prefix.
        const iconPath = useIcon && typeof window.rosterIconPath === 'function'
            ? window.rosterIconPath(pageId)
            : null;
        // The reader's rule (.is-icon-loaded in Layout.css), previewed.
        if (iconPath) img.addEventListener('load', () => node.classList.add('is-icon-loaded'));

        img.src = iconPath || (meta.image
            ? meta.image
            : `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${encodeURIComponent(String(meta.name).replace(/[^a-zA-Z0-9]/g, ''))}Portrait.webp`);
        node.appendChild(img);

        const badge = window.tierBadgeElement(entry);
        if (badge) node.appendChild(badge);

        return node;
    }

    // Redrawn on its portrait alone: renderBoard would drop the caret from the field.
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

        // Anyone on the roster and in no tier, recomputed, so a character added to the
        // wiki later shows up. Then the copies waiting to be placed.
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
        // Per render: whether the font beats the board depends on the network.
        refitWhenFontsLoad();
        renderTierControls();
        renderPendingMoves();
        // A move is a changelog entry, so the preview follows the board. Not before
        // state.ready: the flush would write an empty buffer over the introduction.
        if (state.ready) renderPreviewDocs();
    }

    // A tier name of any length: one size for every tier, set by the longest, since
    // the labels are a scale and must read as one.
    const TIER_LABEL_MAX_REM = 1.5;
    const TIER_LABEL_MIN_REM = 0.6;

    // A Range over the text, not scrollWidth: a centred name spills out of both sides,
    // and scrollWidth counts only the right.
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

    // "Fits" means on one line: the box wraps, so it never overflows.
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
        // Stepped and measured: CC-Wild-Words' glyphs are far from uniform.
        while (tooWide() && size > TIER_LABEL_MIN_REM) {
            size = Math.round((size - 0.1) * 10) / 10;
            labels.forEach(label => { label.style.fontSize = size + 'rem'; });
        }

        // Past the floor, two lines beat unreadably small.
        if (tooWide()) {
            labels.forEach(label => { label.style.whiteSpace = ''; });
        }
    }

    // Fitted again once the web font arrives (far wider than the fallback) and on
    // resize, since the phone's label box is narrower.
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
                // Renaming a tier is not a move: the diff keys on the tier name.
                const oldName = tier.name;
                tier.name = name.value;
                state.original.forEach((value, id) => {
                    if (value === oldName) state.original.set(id, tier.name);
                });

                // Not renderBoard(), which would rebuild the input being typed in and lose the
                // caret: only the board's label changes.
                const boardLabel = document.querySelector(
                    `.tier-editor-row[data-tier-index="${index}"] .ctl-label`);
                if (boardLabel) boardLabel.textContent = tier.name;
                fitTierLabels();
                renderPendingMoves();
            });
            row.appendChild(name);

            // The site's colour picker, not <input type="color">, which opens the
            // operating system's dialog.
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
                // Its occupants go to Unranked, and each is a move that needs a note.
                state.tiers.splice(index, 1);
                renderBoard();
            });
            row.appendChild(remove);

            host.appendChild(row);
        });
    }

    // One popup per tier row. Their ids repeat across rows, which is fine: the picker
    // looks inside the container it is given.
    function tierColorControl(tier, index) {
        return colorControl('Tier colour', toHex(tier.color), `Colour for tier ${index + 1}`, (hex) => {
            tier.color = hex;
            // Only the label's colour changes, and a rebuild would close the popup.
            const boardLabel = document.querySelector(
                `.tier-editor-row[data-tier-index="${index}"] .ctl-label`);
            if (boardLabel) boardLabel.style.backgroundColor = hex;
        });
    }

    // The swatch and its popup, for a tier or a copy's badge. `heading` is one of this
    // file's own strings and `hex` has been through toHex, so neither needs escaping.
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

    // Copies: any number, each with a badge (a label and a colour), and the original
    // may wear one too. A new copy waits in Unranked, and SAVE waits until every copy
    // is placed: only the tiers are saved.

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

    // An original keeps an empty label while edited, so its colour survives;
    // cleanEntry saves it as a plain page_id.
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
        renderPendingMoves();
        if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
    }

    function deleteCopy(key) {
        const loc = locate(key);
        if (!loc) return;
        const entry = entryOf(loc.raw);
        // Kept, so a placed copy's removal can still be named in its note.
        state.gone.set(key, entry);
        loc.remove();
        state.loose.delete(key);
        state.notes.delete(key);
        // The last copy takes the original's badge with it: nothing is left to tell apart.
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

        // A key nothing has used, here or in the changelog, so an old line can never read
        // as about a new copy.
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

    // Given the site dropdown's class only once filled: initializeMangaSelects copies
    // the options when it builds, so an empty one would stay empty.
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

    // The picker takes #rrggbb, and older tiers carry hsl(): converted through the
    // browser, so every colour form it reads is covered.
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

    function renderPendingMoves() {
        const host = document.getElementById('tier-pending-moves');
        const count = document.getElementById('tier-move-count');
        if (!host) return;

        const moves = pendingMoves();
        if (count) count.textContent = String(moves.length);

        host.innerHTML = '';

        if (!moves.length) {
            host.appendChild(el('p', 'admin-queue-empty-msg',
                'Drag a character to another tier and it will appear here.'));
            // Still saveable: a renamed tier, a reorder or new reasoning moves nobody. A copy
            // left in Unranked still stops it.
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
                // The note is a changelog entry, so the preview follows the typing.
                if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
            });
            row.appendChild(input);

            host.appendChild(row);
        });

        updateSaveState();
    }

    // Mirrors the schema's floor, three characters after trimming.
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

    // What stops a save about copies, or null: one in Unranked would be lost, and a
    // blank badge tells nothing apart.
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

    // Pointer events, so mouse and touch are one implementation. A ghost follows the
    // pointer and the original stays, dimmed.
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

        // elementFromPoint, since the ghost is the element under the cursor.
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

    // The keyboard and test path too: a move is a data operation, and dragging is one
    // way to do it. charId is an entry key, so a badge goes where its entry goes.
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
            state.loose.set(charId, raw);
        }

        // Back where they started is no longer a move, and the half-typed note goes too.
        const now = currentPlacement().get(charId) || null;
        if ((state.original.get(charId) || null) === now) state.notes.delete(charId);

        renderBoard();
    }
    window.tierEditorPlace = placeCharacter;

    // Two documents, one Block editor: its buffer is single, so switching flushes the
    // open one before loading the other, as editor-tabs.js does between tabs.
    const DOC_HINTS = {
        intro: "Shown at the top of your list, in place of the page's own introduction. Yours alone; it does not go through the review queue.",
        reasoning: 'The long-form argument for your placements, shown under the changelog. Same editor the rest of the wiki uses.',
    };

    // The Block editor calls updateLivePreview by bare name, and editor-sync.js is not
    // on this page, so it is defined here, as the preview of this page.
    window.updateLivePreview = function () {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreviewDocs, 200);
    };

    let previewTimer = null;

    function renderPreviewDocs() {
        const host = document.getElementById('tier-preview-docs');
        const introHost = document.getElementById('tier-preview-intro');
        if (!host || typeof window.generateHTMLForBlocks !== 'function') return;

        // The open document first, or the preview shows its last saved version.
        flushOpenDoc();
        host.innerHTML = '';
        if (introHost) introHost.innerHTML = '';

        // The live page's own classes and structure (certified-tier-lists.js), so the
        // preview is the page. The introduction goes above the board, where the reader
        // meets it.
        if (introHost && state.intro && state.intro.length) {
            const box = el('section', 'ctl-intro');
            box.appendChild(el('h3', 'ctl-subheading', 'Tier List Introduction'));
            const body = el('div', 'ctl-intro-body');
            body.innerHTML = window.generateHTMLForBlocks(state.intro);
            box.appendChild(body);
            introHost.appendChild(box);
        }

        // The saved changelog and what waits to join it, in the reader's shape.
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

        // Reasoning, then the changelog: the live page's order.
        if (saved.length || pending.length) {
            const box = el('div', 'ctl-changelog');
            box.appendChild(el('h3', 'ctl-subheading', 'Changelog'));

            // Unsaved moves are real entries, marked.
            const entry = (charId, from, to, note, date, pendingFlag) => {
                const row = el('div', 'ctl-change' + (pendingFlag ? ' ctl-change-pending' : ''));
                const head = el('div', 'ctl-change-head');
                head.appendChild(el('span', 'ctl-change-char', nameOf(charId)));
                const moved = from && to ? `${from} → ${to}`
                    : (to ? `added to ${to}` : `removed from ${from || '-'}`);
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

    // The roster name, with a badge when there is one ("Vessel [Ult]"); a copy no
    // longer there reads "(copy)". `bare` gives the name alone.
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

    // The document's own list, currentStrategyBlocks, not getActiveBlocks(), which
    // inside a Section Box or a Dropdown is only that box's.
    function flushOpenDoc() {
        if (typeof currentStrategyBlocks === 'undefined') return;
        const blocks = JSON.parse(JSON.stringify(currentStrategyBlocks));
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

    async function save() {
        const save = document.getElementById('btn-save-tier-list');
        const moves = pendingMoves();

        const missing = moves.filter(m => (state.notes.get(m.id) || '').trim().length < 3);
        if (missing.length || copyProblem()) { updateSaveState(); return; }

        if (save) save.disabled = true;
        setStatus('Saving…');

        // The open document reaches state only when read out, so it is flushed first.
        flushOpenDoc();

        // Read at save time: one field with no preview to keep in step.
        const versionField = document.getElementById('tier-game-version');
        // Read at save time too, and left out when the control is absent: the RPC keeps
        // the stored value on a null, and a fallback would overwrite it.
        const artField = document.getElementById('tier-art-style');

        const { data, error } = await client().rpc('save_tier_list', {
            p_list_id: state.list.id,
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

        // The new baseline only after the write, so a failed save keeps its moves.
        snapshotOriginal();
        state.notes.clear();
        state.gone.clear();
        renderBoard();
        renderPreviewDocs();
        setStatus(data || 'Saved.');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (!client()) { deny('NO CONNECTION'); return; }

        const { data: sessionData } = await client().auth.getSession();
        const session = sessionData ? sessionData.session : null;
        if (!session) { deny('SIGN IN FIRST'); return; }

        await loadRoster();

        // ?list=<slug> opens that list; without it, your own.
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

        // Only decides whether a button is enabled; the RPC checks again.
        const { data: roleRow } = await client()
            .from('user_roles').select('*').eq('user_id', session.user.id).maybeSingle();
        // Mirrors save_tier_list(): the list's author, or the owner.
        state.canEdit = data.owner_id === session.user.id
            || (roleRow && window.roleMeets(roleRow.role, 'owner'));

        const subtitle = document.getElementById('tier-editor-subtitle');
        if (subtitle) {
            subtitle.textContent = state.canEdit
                ? `Editing ${data.author_name}'s list`
                : `${data.author_name}'s list, read only`;
        }

        if (!state.canEdit) {
            const status = document.getElementById('tier-editor-status');
            if (status) status.textContent = 'This list belongs to somebody else.';
        }

        // Set before the first board: portrait() reads it, and set after, every list
        // opened as portraits. Absent before its migration's release.
        const artField = document.getElementById('tier-art-style');
        if (artField) {
            artField.value = data.art_style === 'icon' ? 'icon' : 'portrait';
            artField.disabled = !state.canEdit;
            // The site's dropdown was built before the list arrived and re-reads only on
            // change. Not bubbling, so only its label changes.
            artField.dispatchEvent(new Event('change'));
            // Redrawn at once: art is chosen by looking at it.
            artField.addEventListener('change', () => renderBoard());
        }

        // After canEdit, which disables it on someone else's list, and after the roster,
        // which fills its picker.
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

        // Absent before its migration's release; `|| ''` covers both.
        const versionField = document.getElementById('tier-game-version');
        if (versionField) {
            versionField.value = data.game_version || '';
            versionField.disabled = !state.canEdit;
        }

        if (typeof initStrategyBlockBuilder === 'function') {
            initStrategyBlockBuilder('strategy-block-target', state.intro);
        }

        // Fetched once: only a save writes to it, and a save reloads.
        const { data: changeRows } = await client()
            .from('tier_list_changes').select('*').eq('list_id', data.id)
            .order('created_at', { ascending: false });
        state.changes = Array.isArray(changeRows) ? changeRows : [];

        // Only now is flushing the open document safe.
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

        // Leaving with unwritten notes loses the reasoning, which cannot be rebuilt, and an
        // unplaced copy is unsaved work too.
        window.addEventListener('beforeunload', (e) => {
            const copyWaiting = [...state.loose.keys()].some(key => key.includes('#'));
            if (pendingMoves().length || copyWaiting) { e.preventDefault(); e.returnValue = ''; }
        });
    });
})();
