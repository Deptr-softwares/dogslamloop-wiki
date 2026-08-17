/**
 * Dogslamloop Wiki - Editor: reorder and insert in place (v0.15 item 8)
 *
 * Every author-ordered list in the editor could only be appended to. Adding a
 * variant next to Skill 1 meant deleting and re-entering every skill after it.
 *
 * ONE MECHANISM FOR EVERY STRIP. The editor draws eight of them - moves,
 * overview extras, matchups, each keyed section, combo groups, combo tables,
 * system tabs, system sections - and they already share a shape:
 *
 *     <div class="daw-tab-item">
 *         <button class="daw-tab-btn">…</button>
 *         <button class="daw-tab-remove-btn">✖</button>
 *     </div>
 *
 * So the controls are injected into that shape and resolved through one
 * delegated listener, rather than eight copies of the same three handlers.
 * A ninth strip added later gets reordering by declaring where its array lives.
 *
 * The array is named by a data attribute rather than looked up in a registry
 * here, because the strip already knows what it is rendering and a registry
 * would be a second list to keep in step - the drift this version has spent
 * item 0 and item 6 removing elsewhere.
 */

(function () {
    'use strict';

    // `data-reorder-list` is a dotted path, rooted at one of the editor's two
    // data objects: "desc.matchups", "frame.skills", "desc.tabs.0.sections".
    function resolveList(spec) {
        if (!spec) return null;
        const parts = String(spec).split('.');
        const rootName = parts.shift();
        let node = rootName === 'frame'
            ? window.currentEditorFrameData
            : window.currentEditorDescData;

        for (const part of parts) {
            if (node === null || node === undefined) return null;
            node = node[/^\d+$/.test(part) ? Number(part) : part];
        }
        return Array.isArray(node) ? node : null;
    }

    /**
     * The controls for one item in a strip.
     *
     * Rendered for every item including the ends: a disabled button in a fixed
     * position reads as "cannot go further", while omitting it shifts every
     * other control sideways and makes the row jump as the selection moves.
     */
    window.reorderControls = function (listSpec, index, total) {
        if (!listSpec || total < 1) return '';
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v));
        const spec = esc(listSpec);
        return `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}"
                        data-reorder-index="${index}" data-reorder-dir="-1"
                        title="Move left" aria-label="Move left"${index === 0 ? ' disabled' : ''}>&#9664;</button>`
             + `<button type="button" class="daw-tab-insert-btn" data-reorder-list="${spec}"
                        data-reorder-index="${index}"
                        title="Insert after this one" aria-label="Insert after this one">&#43;</button>`
             + `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}"
                        data-reorder-index="${index}" data-reorder-dir="1"
                        title="Move right" aria-label="Move right"${index === total - 1 ? ' disabled' : ''}>&#9654;</button>`;
    };

    window.moveListItem = function (list, index, direction) {
        const target = index + direction;
        if (!Array.isArray(list) || index < 0 || index >= list.length) return false;
        if (target < 0 || target >= list.length) return false;
        const [item] = list.splice(index, 1);
        list.splice(target, 0, item);
        return true;
    };

    // INSERTING REUSES THE STRIP'S OWN ADD FLOW, then moves the new entry into
    // place. Building the entry here instead would mean a second copy of every
    // shape - and those flows do more than build an object: addMove prompts for
    // an id and validates it, and seeds moveStrategies alongside the move.
    // Duplicating that is how the two halves drift.
    //
    // So an inserter is just "run the add", and the relocation is this file's.
    const inserters = {};
    window.registerInserter = function (listSpec, appendFn) {
        inserters[listSpec] = appendFn;
    };

    window.insertListItemAfter = async function (listSpec, index) {
        const append = inserters[listSpec];
        if (typeof append !== 'function') return false;

        const before = resolveList(listSpec);
        const lengthBefore = before ? before.length : 0;

        await append();

        // Re-resolved: an add flow re-renders and can hand back a different
        // array object than the one measured a moment ago.
        const after = resolveList(listSpec);
        if (!after || after.length !== lengthBefore + 1) return false;   // cancelled, or refused
        if (index >= after.length - 1) return true;                      // already last

        const [entry] = after.splice(after.length - 1, 1);
        after.splice(index + 1, 0, entry);
        return true;
    };

    // Re-rendering is the strip's business too: they are built by six different
    // functions and each knows which selection to keep.
    let refresh = null;
    window.setReorderRefresh = function (fn) { refresh = fn; };

    // A refresh hook may DECLINE by returning false - the system editor
    // registers one at file load, and that file is loaded on character pages
    // too. Without a way to decline it would rebuild the system editor over a
    // character page, because both render into #interactive-builder.
    function afterChange() {
        const handled = typeof refresh === 'function' ? refresh() : false;
        if (handled) {
            if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
            return;
        }
        if (typeof initFullTabEditor === 'function') {
            initFullTabEditor(
                window.currentEditorCharId,
                window.currentEditorTabId,
                window.currentEditorDescData,
                window.currentEditorFrameData
            );
        }
        if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
    }

    // Delegated on the document, because every strip rebuilds its own markup
    // and a listener bound to the buttons would be lost on the next render -
    // the failure the tab strip registry in js/pagebuilder.js already documents.
    document.addEventListener('click', (e) => {
        const moveBtn = e.target.closest && e.target.closest('.daw-tab-move-btn');
        if (moveBtn && !moveBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            const list = resolveList(moveBtn.getAttribute('data-reorder-list'));
            const index = parseInt(moveBtn.getAttribute('data-reorder-index'), 10);
            const dir = parseInt(moveBtn.getAttribute('data-reorder-dir'), 10);
            if (list && window.moveListItem(list, index, dir)) afterChange();
            return;
        }

        const insertBtn = e.target.closest && e.target.closest('.daw-tab-insert-btn');
        if (insertBtn && !insertBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            const spec = insertBtn.getAttribute('data-reorder-list');
            const index = parseInt(insertBtn.getAttribute('data-reorder-index'), 10);
            window.insertListItemAfter(spec, index).then(moved => { if (moved) afterChange(); });
        }
    });
})();
