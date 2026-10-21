/**
 * Dogslamloop Wiki - Create Tier List (v1.1)
 *
 * Any visitor ranks the roster their own way and copies the result as an
 * image. Nothing is sent anywhere: the list lives in this browser, and the
 * image goes to the clipboard (owner, 2026-08-16: "delivers to the clipboard,
 * not a download"), with a PNG download only when the browser cannot copy one.
 *
 * The owner's calls: on the site, not an external tool (2026-10-18);
 * drag-and-drop, with tier names and colours customisable (v0.15); the image
 * carries an optional title (2026-10-20) and the site's branding at the top
 * right of the first tier, on the board too, TierMaker's way (2026-10-21); no
 * Edit and no History, because the page is the tool (2026-10-21).
 *
 * The characters come from the shared roster (loadCharacterRoster in
 * js/site_utils.js), which serves every portrait from this site's own
 * medias/portraits/. That is what lets the image be drawn at all: a
 * cross-origin portrait taints the canvas, and toBlob() throws on a tainted
 * one. Hidden characters are private-server only, so they are left out.
 *
 * Namespaced mk- ("make") in the markup. The certified lists use ctl- and Free
 * Submit fs-, and three features sharing a prefix is how a fix to one reaches
 * the others. .tier-portrait is the one deliberate reuse: the same icon.
 */

(function () {
    const PAGE_ID = 'create_tier_list';
    const STORE_KEY = 'dsl_create_tier_list';
    const NAME_MAX = 24;    // the tier editor's limit
    const TITLE_MAX = 60;
    const TIERS_MAX = 12;
    const DRAG_START_PX = 6;

    // Free Submit's scale (supabase/migrations/20260814000001), so the two
    // community lists read alike.
    const DEFAULT_TIERS = [
        { name: 'S', color: 'hsl(0, 80%, 60%)' },
        { name: 'A', color: 'hsl(30, 80%, 60%)' },
        { name: 'B', color: 'hsl(60, 80%, 60%)' },
        { name: 'C', color: 'hsl(120, 60%, 60%)' },
        { name: 'D', color: 'hsl(210, 80%, 60%)' },
        { name: 'F', color: 'hsl(300, 80%, 60%)' },
    ];

    // A palette and a hex field, not the editor's full picker: that lives in
    // js/editor-blocks.js, and this page would have to load the whole editor
    // for it. Not <input type="color"> either, which opens the operating
    // system's dialog over the wiki (why the tier editor dropped it).
    const PALETTE = [
        ...DEFAULT_TIERS.map(t => t.color),
        'hsl(45, 90%, 55%)', 'hsl(180, 70%, 55%)', 'hsl(270, 70%, 70%)',
        'hsl(340, 80%, 70%)', 'hsl(0, 0%, 75%)', 'hsl(0, 0%, 45%)',
    ];

    // The image, laid out at its Standard size. Width is fixed so a list
    // looks the same wherever it was made; height follows the rows. The cells
    // stretch to fill the row, 3px apart (owner, 2026-10-21: "the distance
    // between the each character ... somewhere 2px-3px").
    const IMG = { width: 1200, label: 150, cell: 120, gap: 3, pad: 3, line: 2, title: 76 };
    // High and Max draw the same layout two and three times as sharp (owner,
    // 2026-10-21: "the export quality is kinda low"). The portraits are 320 to
    // 400px across, so Max is about as sharp as they get.
    const QUALITIES = [
        { scale: 1, label: 'Standard (1200px wide)' },
        { scale: 2, label: 'High (2400px wide)' },
        { scale: 3, label: 'Max (3600px wide)' },
    ];
    const DEFAULT_SCALE = 2;
    // A fixed block at the top right of the first tier, the last `cells`
    // places of its first row, which that tier's characters wrap around; every
    // other tier fills its whole row (owner, 2026-10-21, after TierMaker's).
    const BRAND = { text: 'dogslamloop.com', icon: 'medias/images/DogslamloopIcon.webp', cells: 2 };
    const LABEL_FONT = '"CC-Wild-Words", sans-serif';

    const state = {
        roster: new Map(),   // page_id -> { name, url, image }, hidden left out
        title: '',
        tiers: [],           // [{ name, color, characters: [page_id] }]
        scale: DEFAULT_SCALE, // the image quality; kept through RESET
        picked: null,        // tap-to-place: the character picked up
        press: null,         // a mouse press that may become a drag
        drag: null,
        marker: null,        // the drop indicator, over the board
        suppressClick: false,
        root: null,
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(className, text) {
        const node = el('button', className, text);
        node.type = 'button';
        return node;
    }

    const validColor = (c) => typeof c === 'string' && c.length <= 40
        && typeof CSS !== 'undefined' && CSS.supports('color', c);

    function defaults() {
        return { title: '', tiers: DEFAULT_TIERS.map(t => ({ ...t, characters: [] })) };
    }

    // --- KEPT ON THIS DEVICE ---

    // Whatever was saved, cut back to what can still be drawn: a character
    // removed or hidden since goes, and each character sits in one tier only.
    function sanitise(saved) {
        if (!saved || !Array.isArray(saved.tiers) || !saved.tiers.length) return null;
        const seen = new Set();
        const tiers = saved.tiers.slice(0, TIERS_MAX).map(t => {
            const characters = [];
            (Array.isArray(t && t.characters) ? t.characters : []).forEach(id => {
                if (typeof id !== 'string' || !state.roster.has(id) || seen.has(id)) return;
                seen.add(id);
                characters.push(id);
            });
            return {
                name: t && typeof t.name === 'string' ? t.name.slice(0, NAME_MAX) : '',
                color: t && validColor(t.color) ? t.color : PALETTE[10],
                characters,
            };
        });
        return { title: typeof saved.title === 'string' ? saved.title.slice(0, TITLE_MAX) : '', tiers };
    }

    function restore() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        } catch (e) {
            // Unreadable or blocked: start from the defaults. A blocked write
            // is the one the reader is told about, in save().
            saved = null;
        }
        const list = sanitise(saved) || defaults();
        state.title = list.title;
        state.tiers = list.tiers;
        state.scale = QUALITIES.some(q => q.scale === (saved && saved.scale)) ? saved.scale : DEFAULT_SCALE;
    }

    function save() {
        let saved = true;
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, title: state.title, tiers: state.tiers, scale: state.scale }));
        } catch (e) {
            saved = false;
        }
        const note = state.root && state.root.querySelector('[data-mk-storage-note]');
        if (note) note.hidden = saved;
    }

    // --- WHERE EVERYONE IS ---

    function zoneOf(id) {
        const index = state.tiers.findIndex(t => t.characters.includes(id));
        return index < 0 ? 'pool' : String(index);
    }

    // Also the tap and keyboard path: a move is a data operation, and the drag
    // is one way to ask for it.
    function place(id, zone, beforeId, focusAfter) {
        state.tiers.forEach(t => { t.characters = t.characters.filter(c => c !== id); });
        const tier = zone === 'pool' ? null : state.tiers[Number(zone)];
        if (tier) {
            const at = beforeId ? tier.characters.indexOf(beforeId) : -1;
            if (at < 0) tier.characters.push(id);
            else tier.characters.splice(at, 0, id);
        }
        state.picked = null;
        setStatus('');
        save();
        renderBoard();
        if (focusAfter) {
            const moved = state.root.querySelector(`.mk-entry[data-character="${CSS.escape(id)}"]`);
            if (moved) moved.focus();
        }
    }

    function pick(id) {
        state.picked = id;
        state.root.querySelectorAll('.mk-entry').forEach(entry => {
            entry.setAttribute('aria-pressed', String(entry.dataset.character === id));
        });
        if (!id) { setStatus(''); return; }
        const meta = state.roster.get(id);
        setStatus(`Picked up ${meta ? meta.name : id}. Tap a tier to place them there, or tap a character to place them before it.`);
    }

    function setStatus(text, isError) {
        const node = state.root && state.root.querySelector('[data-mk-status]');
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('mk-status-error', !!isError);
    }

    // --- THE BOARD ---

    function portrait(id) {
        const rootPath = window.getRootPath();
        const meta = state.roster.get(id);

        const face = el('span', 'tier-portrait');
        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) {
            face.style.backgroundColor = window.CHARACTER_COLORS[meta.name];
        }
        // Under the image, so a portrait that fails to load still says who.
        face.appendChild(el('span', 'tier-portrait-name', meta.name));

        const img = document.createElement('img');
        img.className = 'tier-portrait-img';
        img.alt = '';
        // Or the browser starts its own image drag and cancels ours.
        img.draggable = false;
        img.addEventListener('error', () => { img.style.display = 'none'; });
        if (meta.image) img.src = rootPath + meta.image;
        face.appendChild(img);
        return face;
    }

    function entry(id) {
        const node = button('mk-entry');
        node.dataset.character = id;
        node.title = state.roster.get(id).name;
        node.setAttribute('aria-pressed', String(state.picked === id));
        node.appendChild(portrait(id));
        return node;
    }

    // Decorative: the copied image says the same in pixels. Its corner is held
    // by grid placement (create_tier_list.css), so nothing here measures.
    function brand() {
        const node = el('div', 'mk-brand');
        node.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('img');
        icon.className = 'mk-brand-icon';
        icon.alt = '';
        icon.draggable = false;
        icon.src = window.getRootPath() + BRAND.icon;
        node.append(icon, el('span', 'mk-brand-text', BRAND.text));
        return node;
    }

    // One size per name length rather than measuring: a scale of labels
    // reads as one when the short ones agree, and a long name wraps inside.
    function setLabel(label, name) {
        label.textContent = name;
        const length = Array.from(name).length;
        label.classList.toggle('mk-label-mid', length > 2 && length <= 6);
        label.classList.toggle('mk-label-long', length > 6);
    }

    function renderBoard() {
        const board = state.root.querySelector('[data-mk-board]');
        const pool = state.root.querySelector('[data-mk-pool]');
        board.textContent = '';

        state.tiers.forEach((tier, index) => {
            const row = el('div', 'mk-row');
            const label = button('mk-label mk-zone');
            label.dataset.zone = String(index);
            label.style.backgroundColor = tier.color;
            setLabel(label, tier.name);
            row.appendChild(label);

            const body = el('div', 'mk-body mk-zone');
            body.dataset.zone = String(index);
            if (index === 0) body.appendChild(brand());
            tier.characters.forEach(id => body.appendChild(entry(id)));
            row.appendChild(body);
            board.appendChild(row);
        });

        // Recomputed, never stored, so a character added to the wiki shows up
        // here the next time the page opens.
        const placed = new Set(state.tiers.flatMap(t => t.characters));
        const waiting = Array.from(state.roster.keys()).filter(id => !placed.has(id));
        pool.textContent = '';
        waiting.forEach(id => pool.appendChild(entry(id)));
        if (!waiting.length) pool.appendChild(el('span', 'mk-empty', 'Everyone is placed.'));
        state.root.querySelector('[data-mk-pool-count]').textContent = `(${waiting.length})`;
    }

    // --- THE TIERS ---

    function closeColorPopups() {
        state.root.querySelectorAll('.mk-color-popup').forEach(popup => {
            popup.hidden = true;
            const swatch = popup.parentNode.querySelector('.mk-color-swatch');
            if (swatch) swatch.setAttribute('aria-expanded', 'false');
        });
    }

    function parseHex(value) {
        const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
        if (!match) return null;
        const digits = match[1].length === 3 ? match[1].split('').map(c => c + c).join('') : match[1];
        return `#${digits.toLowerCase()}`;
    }

    function colorControl(tier, index) {
        const wrap = el('div', 'mk-color-wrap');

        const swatch = button('mk-color-swatch');
        swatch.style.backgroundColor = tier.color;
        swatch.setAttribute('aria-label', `Colour of tier ${index + 1}`);
        swatch.setAttribute('aria-expanded', 'false');
        wrap.appendChild(swatch);

        const popup = el('div', 'mk-color-popup');
        popup.hidden = true;
        const palette = el('div', 'mk-palette');
        PALETTE.forEach(color => {
            const chip = button('mk-palette-swatch');
            chip.dataset.color = color;
            chip.style.backgroundColor = color;
            chip.title = color;
            chip.setAttribute('aria-label', color);
            palette.appendChild(chip);
        });
        popup.appendChild(palette);

        const hexRow = el('div', 'mk-hex-row');
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'editor-input mk-hex';
        hex.maxLength = 7;
        hex.placeholder = '#ff8800';
        hex.spellcheck = false;
        hex.autocomplete = 'off';
        hex.setAttribute('aria-label', 'Hex colour');
        const use = button('btn-sys btn-sys-green mk-hex-use', 'USE');
        hexRow.append(hex, use);
        popup.appendChild(hexRow);
        wrap.appendChild(popup);

        const apply = (color) => {
            tier.color = color;
            swatch.style.backgroundColor = color;
            const label = state.root.querySelector(`.mk-label[data-zone="${index}"]`);
            if (label) label.style.backgroundColor = color;
            closeColorPopups();
            save();
            swatch.focus();
        };
        const useHex = () => {
            const color = parseHex(hex.value);
            if (!color) {
                setStatus(`"${hex.value}" is not a colour. Use a hex like #ff8800.`, true);
                return;
            }
            setStatus('');
            apply(color);
        };

        swatch.addEventListener('click', () => {
            const opening = popup.hidden;
            closeColorPopups();
            popup.hidden = !opening;
            swatch.setAttribute('aria-expanded', String(opening));
        });
        palette.addEventListener('click', (e) => {
            const chip = e.target.closest('.mk-palette-swatch');
            if (chip) apply(chip.dataset.color);
        });
        use.addEventListener('click', useHex);
        hex.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); useHex(); }
        });
        return wrap;
    }

    function renderControls() {
        const host = state.root.querySelector('[data-mk-controls]');
        host.textContent = '';

        state.tiers.forEach((tier, index) => {
            const row = el('div', 'mk-control-row');

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'editor-input mk-control-name';
            name.maxLength = NAME_MAX;
            name.value = tier.name;
            name.setAttribute('aria-label', `Name of tier ${index + 1}`);
            name.addEventListener('input', () => {
                tier.name = name.value;
                // The board label only. Rebuilding the controls here would
                // throw away the field being typed into, the tier editor's
                // one-letter-at-a-time bug (owner, 2026-08-18).
                const label = state.root.querySelector(`.mk-label[data-zone="${index}"]`);
                if (label) setLabel(label, tier.name);
                save();
            });
            row.appendChild(name);
            row.appendChild(colorControl(tier, index));

            const up = button('btn-sys btn-sys-regular mk-control-btn', '▲');
            up.dataset.mkAction = 'up';
            up.dataset.tier = String(index);
            up.setAttribute('aria-label', `Move tier ${index + 1} up`);
            up.disabled = index === 0;
            const down = button('btn-sys btn-sys-regular mk-control-btn', '▼');
            down.dataset.mkAction = 'down';
            down.dataset.tier = String(index);
            down.setAttribute('aria-label', `Move tier ${index + 1} down`);
            down.disabled = index === state.tiers.length - 1;
            const remove = button('btn-sys btn-sys-red mk-control-btn', '✖');
            remove.dataset.mkAction = 'remove';
            remove.dataset.tier = String(index);
            remove.setAttribute('aria-label', `Remove tier ${index + 1}`);
            // A list with no tiers has nowhere to put anyone.
            remove.disabled = state.tiers.length === 1;
            row.append(up, down, remove);
            host.appendChild(row);
        });

        state.root.querySelector('[data-mk-action="add"]').disabled = state.tiers.length >= TIERS_MAX;
    }

    function renderAll() {
        renderBoard();
        renderControls();
        state.root.querySelector('[data-mk-title]').value = state.title;
    }

    function tierAction(action, index) {
        if (action === 'add') {
            const used = new Set(state.tiers.map(t => t.color));
            state.tiers.push({ name: 'New', color: PALETTE.find(c => !used.has(c)) || PALETTE[10], characters: [] });
        } else if (action === 'remove') {
            // Its characters go back to Not placed yet, because the pool is
            // whoever is in no tier.
            state.tiers.splice(index, 1);
        } else {
            const other = action === 'up' ? index - 1 : index + 1;
            if (other < 0 || other >= state.tiers.length) return;
            [state.tiers[index], state.tiers[other]] = [state.tiers[other], state.tiers[index]];
        }
        save();
        renderAll();

        const focusAt = action === 'add' ? state.tiers.length - 1
            : action === 'remove' ? Math.min(index, state.tiers.length - 1)
            : (action === 'up' ? index - 1 : index + 1);
        const names = state.root.querySelectorAll('.mk-control-name');
        if (names[focusAt]) {
            names[focusAt].focus();
            if (action === 'add') names[focusAt].select();
        }
    }

    // --- DRAG (mouse and pen; a finger taps, so the page still scrolls) ---

    // Where a drop at (x, y) lands. Over a character, its left half means
    // before it and its right half after it; past the end of a line, the
    // start of the next. The pool keeps roster order, so it has no position.
    function targetAt(x, y) {
        const under = document.elementFromPoint(x, y);
        if (!under || !state.root.contains(under)) return null;
        const zone = under.closest('.mk-zone');
        if (!zone) return null;
        if (zone.dataset.zone === 'pool') return { zone: 'pool', zoneEl: zone, body: null, before: null };

        // A label places at the end of its row.
        const body = zone.classList.contains('mk-body') ? zone : zone.parentNode.querySelector('.mk-body');
        const others = Array.from(body.querySelectorAll('.mk-entry')).filter(n => !state.drag || n !== state.drag.node);
        const beforeEl = zone !== body ? null : others.find(n => {
            const r = n.getBoundingClientRect();
            return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
        }) || null;
        return { zone: zone.dataset.zone, zoneEl: zone, body, others, beforeEl, before: beforeEl ? beforeEl.dataset.character : null };
    }

    function highlight(zoneEl) {
        state.root.querySelectorAll('.mk-zone-hot').forEach(z => { if (z !== zoneEl) z.classList.remove('mk-zone-hot'); });
        if (zoneEl) zoneEl.classList.add('mk-zone-hot');
    }

    // The bar in the gap the character will drop into (owner, 2026-10-21: "a
    // clear indicator inbetween the characters"). Fixed over the board rather
    // than inserted into it, so nothing moves under the pointer.
    function showMarker(target) {
        const marker = state.marker;
        if (!target || !target.body) { marker.hidden = true; return; }
        const gap = parseFloat(getComputedStyle(target.body).columnGap) || 0;
        let top, height, x;
        if (target.beforeEl || target.others.length) {
            const r = (target.beforeEl || target.others[target.others.length - 1]).getBoundingClientRect();
            x = target.beforeEl ? r.left - gap / 2 : r.right + gap / 2;
            top = r.top;
            height = r.height;
        } else {
            const b = target.body.getBoundingClientRect();
            const pad = parseFloat(getComputedStyle(target.body).paddingLeft) || 0;
            x = b.left + pad;
            top = b.top + pad;
            height = b.height - pad * 2;
        }
        marker.hidden = false;
        marker.style.left = `${x - marker.offsetWidth / 2}px`;
        marker.style.top = `${top}px`;
        marker.style.height = `${height}px`;
    }

    function onPointerDown(e) {
        const node = e.target.closest('.mk-entry');
        if (!node || e.button !== 0 || e.pointerType === 'touch') return;
        state.press = { id: node.dataset.character, node, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    }

    function onPointerMove(e) {
        const press = state.press;
        if (!press || e.pointerId !== press.pointerId) return;
        if (!state.drag) {
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START_PX) return;
            const ghost = press.node.querySelector('.tier-portrait').cloneNode(true);
            ghost.classList.add('tier-portrait-ghost');
            document.body.appendChild(ghost);
            press.node.classList.add('tier-portrait-dragging');
            state.drag = { id: press.id, node: press.node, ghost };
        }
        e.preventDefault();
        state.drag.ghost.style.left = `${e.clientX}px`;
        state.drag.ghost.style.top = `${e.clientY}px`;
        const target = targetAt(e.clientX, e.clientY);
        highlight(target ? target.zoneEl : null);
        showMarker(target);
    }

    function endDrag(e, dropped) {
        state.press = null;
        if (!state.drag) return;
        // Read while the drag is still on, so the character being moved is
        // not a place to drop it.
        const target = dropped ? targetAt(e.clientX, e.clientY) : null;
        const { id, node, ghost } = state.drag;
        state.drag = null;
        ghost.remove();
        node.classList.remove('tier-portrait-dragging');
        highlight(null);
        showMarker(null);

        // The click that follows a drag is not a tap. Cleared on the next
        // turn, because a drop between two elements fires no click at all.
        state.suppressClick = true;
        setTimeout(() => { state.suppressClick = false; }, 0);

        if (target) place(id, target.zone, target.before, false);
    }

    // --- TAP (and the keyboard, since entries and labels are buttons) ---

    function onClick(e) {
        if (state.suppressClick) return;

        const action = e.target.closest('[data-mk-action]');
        if (action) {
            if (action.dataset.mkAction === 'copy') copyImage(action);
            else if (action.dataset.mkAction === 'reset') resetList();
            else tierAction(action.dataset.mkAction, Number(action.dataset.tier));
            return;
        }

        const node = e.target.closest('.mk-entry');
        if (node) {
            const id = node.dataset.character;
            if (!state.picked) { pick(id); return; }
            if (state.picked === id) { pick(null); return; }
            const zone = zoneOf(id);
            place(state.picked, zone, zone === 'pool' ? null : id, true);
            return;
        }

        const zone = e.target.closest('.mk-zone');
        if (!zone) return;
        if (state.picked) {
            place(state.picked, zone.dataset.zone, null, true);
        } else if (zone.classList.contains('mk-label')) {
            setStatus('Pick a character first, then tap a tier.');
        }
    }

    async function resetList() {
        const ok = await window.siteConfirm(
            'Every character goes back to Not placed yet, and the tiers, their colours and the title go back to the defaults.',
            { title: 'RESET THE LIST', confirmText: 'RESET' });
        if (!ok) return;
        const list = defaults();
        state.title = list.title;
        state.tiers = list.tiers;
        state.picked = null;
        save();
        renderAll();
        setStatus('The list is back to the defaults.');
    }

    // --- THE IMAGE ---

    function fitFont(ctx, text, maxWidth, largest, smallest, family) {
        let size = largest;
        ctx.font = `${size}px ${family}`;
        while (size > smallest && ctx.measureText(text).width > maxWidth) {
            size -= 2;
            ctx.font = `${size}px ${family}`;
        }
        return size;
    }

    function loadImage(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            // A missing portrait draws the name on its colour, the same as the
            // board does.
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    function wrapName(ctx, name, width) {
        const lines = [];
        let line = '';
        name.split(/\s+/).forEach(word => {
            const next = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(next).width > width) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function drawEntry(ctx, id, img, x, y, size, border) {
        const meta = state.roster.get(id);
        ctx.fillStyle = (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) || '#333333';
        ctx.fillRect(x, y, size, size);

        if (img && img.naturalWidth && img.naturalHeight) {
            // Cropped to a centred square, the crop object-fit: cover gives
            // the board.
            const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
            const sw = size / scale;
            const sh = size / scale;
            ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, size, size);
        } else {
            ctx.font = `13px ${LABEL_FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.fillStyle = '#ffffff';
            const lines = wrapName(ctx, meta.name, size - 8);
            lines.forEach((line, i) => {
                const ly = y + size / 2 + (i - (lines.length - 1) / 2) * 15;
                ctx.strokeText(line, x + size / 2, ly);
                ctx.fillText(line, x + size / 2, ly);
            });
        }

        ctx.lineWidth = 2;
        ctx.strokeStyle = border;
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    async function drawTierList(scale) {
        const css = getComputedStyle(document.documentElement);
        const token = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
        const ground = token('--bg-main', '#111111');
        const rowGround = token('--bg-secondary', '#1b1b1b');
        const line = token('--border-color', '#333333');
        const ink = token('--text-white', '#ffffff');

        try {
            await document.fonts.load(`40px ${LABEL_FONT}`);
        } catch (e) {
            // The image still draws, in the fallback face.
            console.warn('[CreateTierList] Label font unavailable:', e);
        }

        const rootPath = window.getRootPath();
        const images = new Map();
        await Promise.all(state.tiers.flatMap(t => t.characters).map(async id => {
            const meta = state.roster.get(id);
            images.set(id, meta.image ? await loadImage(rootPath + meta.image) : null);
        }));
        const icon = await loadImage(rootPath + BRAND.icon);

        // As many cells as fit at IMG.cell, then stretched to fill the row.
        const bodyWidth = IMG.width - IMG.label - IMG.pad * 2;
        const perRow = Math.max(1, Math.floor((bodyWidth + IMG.gap) / (IMG.cell + IMG.gap)));
        const cell = Math.floor((bodyWidth - (perRow - 1) * IMG.gap) / perRow);
        // The place character n takes in tier i: the first tier's first row
        // stops where the branding starts, and the rest carry on below it.
        const firstRow = perRow - BRAND.cells;
        const slot = (i, n) => (i === 0 && n >= firstRow ? n + BRAND.cells : n);
        const heights = state.tiers.map((t, i) => {
            const taken = t.characters.length + (i === 0 ? BRAND.cells : 0);
            const lines = Math.max(1, Math.ceil(taken / perRow));
            return lines * cell + (lines - 1) * IMG.gap + IMG.pad * 2;
        });
        const title = state.title.trim();
        const top = title ? IMG.title : 0;
        const height = top + heights.reduce((a, b) => a + b, 0) + IMG.line * (heights.length + 1);

        // Drawn in Standard units and scaled, so every quality has the same
        // layout and only the sharpness changes.
        const canvas = document.createElement('canvas');
        canvas.width = IMG.width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.imageSmoothingQuality = 'high';

        ctx.fillStyle = ground;
        ctx.fillRect(0, 0, IMG.width, height);

        if (title) {
            ctx.fillStyle = ink;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            fitFont(ctx, title, IMG.width - IMG.pad * 4, 40, 18, LABEL_FONT);
            ctx.fillText(title, IMG.width / 2, IMG.title / 2);
        }

        let y = top;
        ctx.fillStyle = line;
        ctx.fillRect(0, y, IMG.width, IMG.line);
        y += IMG.line;

        state.tiers.forEach((tier, i) => {
            const h = heights[i];
            ctx.fillStyle = rowGround;
            ctx.fillRect(0, y, IMG.width, h);
            ctx.fillStyle = tier.color;
            ctx.fillRect(0, y, IMG.label, h);

            if (tier.name) {
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                fitFont(ctx, tier.name, IMG.label - 16, 44, 12, LABEL_FONT);
                ctx.fillText(tier.name, IMG.label / 2, y + h / 2);
            }

            tier.characters.forEach((id, n) => {
                const at = slot(i, n);
                const x = IMG.label + IMG.pad + (at % perRow) * (cell + IMG.gap);
                const cy = y + IMG.pad + Math.floor(at / perRow) * (cell + IMG.gap);
                drawEntry(ctx, id, images.get(id), x, cy, cell, line);
            });

            if (i === 0) {
                const bx = IMG.label + IMG.pad + firstRow * (cell + IMG.gap);
                drawBrand(ctx, icon, bx, y + IMG.pad, BRAND.cells * cell + (BRAND.cells - 1) * IMG.gap, cell, ink);
            }

            y += h;
            ctx.fillStyle = line;
            ctx.fillRect(0, y, IMG.width, IMG.line);
            y += IMG.line;
        });

        return canvas;
    }

    // The icon over dogslamloop.com, centred in its block, at full strength
    // like TierMaker's own.
    function drawBrand(ctx, icon, x, y, w, h, ink) {
        const iconH = icon ? Math.round(h * 0.46) : 0;
        const iconW = icon ? iconH * icon.naturalWidth / icon.naturalHeight : 0;
        const space = icon ? 8 : 0;
        const size = fitFont(ctx, BRAND.text, w - 16, 26, 12, LABEL_FONT);
        const top = y + (h - (iconH + space + size)) / 2;
        if (icon) ctx.drawImage(icon, x + (w - iconW) / 2, top, iconW, iconH);
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(BRAND.text, x + w / 2, top + iconH + space);
    }

    function toPng(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The canvas gave no image.'))), 'image/png');
        });
    }

    function canCopyImage() {
        return typeof window.ClipboardItem === 'function'
            && !!navigator.clipboard && typeof navigator.clipboard.write === 'function'
            && (typeof window.ClipboardItem.supports !== 'function' || window.ClipboardItem.supports('image/png'));
    }

    function fileName() {
        const slug = state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        return `${slug || 'tier-list'}.png`;
    }

    function download(blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName();
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function copyImage(btn) {
        btn.disabled = true;
        setStatus('Drawing the image...');
        // Started before the clipboard call and handed to it as a promise:
        // Safari only allows the write while the click is still the reason
        // for it, and drawing takes longer than that.
        const drawn = drawTierList(state.scale);
        const png = drawn.then(toPng);
        // The size, because a big image is the one a chat app refuses.
        const size = async () => {
            const [canvas, blob] = await Promise.all([drawn, png]);
            return `${canvas.width}x${canvas.height}, ${(blob.size / 1048576).toFixed(1)} MB`;
        };
        try {
            let refused = false;
            if (canCopyImage()) {
                try {
                    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
                    setStatus(`Copied (${await size()}). Paste it anywhere.`);
                    return;
                } catch (e) {
                    console.warn('[CreateTierList] The browser would not copy the image:', e);
                    refused = true;
                }
            }
            download(await png);
            setStatus(refused
                ? `The browser would not copy the image, so it was downloaded instead (${await size()}).`
                : `This browser cannot copy images, so the image was downloaded instead (${await size()}).`);
        } catch (e) {
            console.error('[CreateTierList] The image could not be made:', e);
            setStatus('The image could not be made. Try again, and if it keeps happening, report it on Discord.', true);
        } finally {
            btn.disabled = false;
        }
    }

    // --- THE PAGE ---

    window.registerWikiTool(PAGE_ID, async (mount) => {
        const all = await window.loadCharacterRoster();
        state.roster = new Map(Array.from(all).filter(([, meta]) => !meta.hidden));
        if (!state.roster.size) {
            mount.innerHTML = '<p class="admin-error-text">The character list could not be loaded. Try refreshing; if it keeps happening, report it on Discord.</p>';
            return;
        }
        restore();

        const root = el('div', 'mk-tool');
        root.innerHTML = `
            <label class="mk-title-field">
                <span class="mk-section-title">Title</span>
                <input type="text" class="editor-input mk-title-input" data-mk-title maxlength="${TITLE_MAX}"
                       placeholder="Optional. Shown on top of the image." autocomplete="off">
            </label>
            <p class="mk-hint">Drag a character into a tier. On a phone, tap a character, then tap a tier.</p>
            <div class="mk-board" data-mk-board></div>
            <section>
                <h3 class="mk-section-title">Not placed yet <span data-mk-pool-count></span></h3>
                <div class="mk-pool mk-zone" data-zone="pool" data-mk-pool></div>
            </section>
            <div class="mk-actions">
                <label class="mk-quality">
                    <span class="mk-quality-label">Quality</span>
                    <select class="filter-select" data-mk-quality>
                        ${QUALITIES.map(q => `<option value="${q.scale}">${q.label}</option>`).join('')}
                    </select>
                </label>
                <button type="button" class="btn-sys btn-sys-green" data-mk-action="copy">COPY IMAGE</button>
                <button type="button" class="btn-sys btn-sys-red" data-mk-action="reset">RESET</button>
                <span class="mk-status" data-mk-status role="status"></span>
            </div>
            <p class="mk-storage-note" data-mk-storage-note hidden>This browser blocked saving, so the list only lasts until you leave this page.</p>
            <section>
                <h3 class="mk-section-title">Tiers</h3>
                <div class="mk-controls" data-mk-controls></div>
                <button type="button" class="btn-sys btn-sys-regular mk-add-tier" data-mk-action="add">+ ADD TIER</button>
            </section>
        `;
        mount.appendChild(root);
        state.root = root;

        root.querySelector('[data-mk-title]').addEventListener('input', (e) => {
            state.title = e.target.value;
            save();
        });
        const quality = root.querySelector('[data-mk-quality]');
        quality.value = String(state.scale);
        quality.addEventListener('change', () => {
            state.scale = Number(quality.value);
            save();
        });

        state.marker = el('div', 'mk-drop-marker');
        state.marker.hidden = true;
        document.body.appendChild(state.marker);
        root.addEventListener('click', onClick);
        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('dragstart', (e) => e.preventDefault());
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', (e) => endDrag(e, true));
        document.addEventListener('pointercancel', (e) => endDrag(e, false));
        document.addEventListener('click', (e) => {
            if (!e.target.closest || !e.target.closest('.mk-color-wrap')) closeColorPopups();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (root.querySelector('.mk-color-popup:not([hidden])')) closeColorPopups();
            else if (state.picked) pick(null);
        });

        renderAll();
    });
})();
