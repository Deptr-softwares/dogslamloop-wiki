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
        tiers: [],           // working copy: [{ name, color, characters: [page_id] }]
        roster: new Map(),   // page_id -> { name, url, image }
        original: new Map(), // page_id -> tier name at load, for the diff
        notes: new Map(),    // page_id -> note typed for its pending move
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

    async function loadRoster() {
        try {
            const nav = window.fetchJson
                ? await window.fetchJson('data/navigation.json', { cache: true })
                : await (await fetch('data/navigation.json')).json();
            (nav.Characters || []).forEach(entry => {
                const pageId = entry.cms_config && entry.cms_config.pageId;
                if (pageId) state.roster.set(pageId, { name: entry.name, url: entry.url, image: entry.image });
            });
        } catch (e) {
            console.warn('[TierEditor] Could not read the roster:', e);
        }
    }

    // Snapshot of where everyone started, which is the only thing that makes a
    // move detectable later. Taken once at load and never refreshed until a
    // successful save, so moving a character out and back counts as no move.
    function snapshotOriginal() {
        state.original.clear();
        state.tiers.forEach(tier => {
            (tier.characters || []).forEach(id => state.original.set(id, tier.name));
        });
    }

    function currentPlacement() {
        const map = new Map();
        state.tiers.forEach(tier => {
            (tier.characters || []).forEach(id => map.set(id, tier.name));
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

    function portrait(pageId, draggable) {
        const meta = state.roster.get(pageId) || { name: String(pageId).replace(/_/g, ' ') };

        const node = el('div', 'tier-portrait' + (draggable ? ' draggable-portrait' : ''));
        node.dataset.charId = pageId;
        node.title = meta.name;
        if (window.CHARACTER_COLORS && window.CHARACTER_COLORS[meta.name]) {
            node.style.backgroundColor = window.CHARACTER_COLORS[meta.name];
        }

        node.appendChild(el('span', 'tier-portrait-name', meta.name));

        const img = document.createElement('img');
        img.className = 'tier-portrait-img';
        img.alt = '';
        img.draggable = false;
        img.addEventListener('error', () => { img.style.display = 'none'; });
        img.src = meta.image
            ? meta.image
            : `https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media/${encodeURIComponent(String(meta.name).replace(/[^a-zA-Z0-9]/g, ''))}Portrait.webp`;
        node.appendChild(img);

        return node;
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
            (tier.characters || []).forEach(id => chars.appendChild(portrait(id, true)));
            row.appendChild(chars);

            board.appendChild(row);
        });

        // Anyone in the roster and in no tier. Recomputed rather than stored,
        // so a character added to the wiki after this list was written shows up
        // here on the next edit instead of being invisible forever.
        const placed = new Set();
        state.tiers.forEach(t => (t.characters || []).forEach(id => placed.add(id)));

        tray.innerHTML = '';
        tray.dataset.tierIndex = 'unranked';
        let unranked = 0;
        state.roster.forEach((_meta, id) => {
            if (placed.has(id)) return;
            tray.appendChild(portrait(id, true));
            unranked += 1;
        });
        if (!unranked) tray.appendChild(el('span', 'ctl-empty-note', 'everyone is placed'));

        renderTierControls();
        renderPendingMoves();
    }

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
                renderBoard();
                name.focus();
            });
            row.appendChild(name);

            const color = document.createElement('input');
            color.type = 'color';
            color.className = 'tier-control-color';
            color.value = toHex(tier.color);
            color.setAttribute('aria-label', 'Tier colour');
            color.addEventListener('input', () => { tier.color = color.value; renderBoard(); });
            row.appendChild(color);

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
            if (save) save.disabled = !state.canEdit;
            return;
        }

        moves.forEach(move => {
            const meta = state.roster.get(move.id) || { name: move.id };
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

        save.disabled = !state.canEdit || missing.length > 0;

        if (missing.length) {
            const meta = state.roster.get(missing[0].id) || { name: missing[0].id };
            setStatus(missing.length === 1
                ? `${meta.name} still needs a note.`
                : `${missing.length} moves still need notes.`);
        } else {
            setStatus('');
        }
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
    function placeCharacter(charId, target) {
        state.tiers.forEach(tier => {
            tier.characters = (tier.characters || []).filter(id => id !== charId);
        });

        if (target !== 'unranked') {
            const index = Number(target);
            if (Number.isInteger(index) && state.tiers[index]) {
                state.tiers[index].characters = state.tiers[index].characters || [];
                state.tiers[index].characters.push(charId);
            }
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
    }
    window.tierEditorSwitchDoc = switchDoc;

    // --- SAVING ---

    async function save() {
        const save = document.getElementById('btn-save-tier-list');
        const moves = pendingMoves();

        const missing = moves.filter(m => (state.notes.get(m.id) || '').trim().length < 3);
        if (missing.length) { updateSaveState(); return; }

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

        const { data, error } = await client().rpc('save_tier_list', {
            p_list_id: state.list.id,
            p_tiers: state.tiers,
            p_reasoning: state.reasoning,
            p_intro: state.intro,
            p_game_version: versionField ? versionField.value.trim() : '',
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
        renderBoard();
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
        snapshotOriginal();

        // The client half of the per-row rule. The RPC re-checks it, because
        // this one only decides whether to disable a button.
        const { data: roleRow } = await client()
            .from('user_roles').select('*').eq('user_id', session.user.id).maybeSingle();
        state.canEdit = data.owner_id === session.user.id || (roleRow && roleRow.role === 'admin');

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
        window.addEventListener('beforeunload', (e) => {
            if (pendingMoves().length) { e.preventDefault(); e.returnValue = ''; }
        });
    });
})();
