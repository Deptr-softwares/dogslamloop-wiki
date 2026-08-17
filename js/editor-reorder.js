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
     * ONE FIXED GROUP PER STRIP, acting on whatever is selected.
     *
     * These were per-item to begin with, and the owner found the real problem
     * with that immediately: you do not "ride along" with the section you are
     * moving. The selection stayed put while the item slid out from under it,
     * AND the buttons moved with the item, so a second nudge meant chasing them
     * across the row. Both go away when the controls sit still and act on the
     * active entry.
     *
     * Rendered at the end of the strip, beside + ADD - section-level actions
     * stay on the section row rather than mixing in with the block toolbar's
     * undo/redo, and the moves strip renders that toolbar far below its stats
     * and DAW editor.
     *
     * The active index is read from the DOM at click time rather than passed in
     * here. Six strips track their selection in six different globals, and this
     * needs none of them.
     */
    window.reorderStripControls = function (listSpec) {
        if (!listSpec) return '';
        const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v));
        const spec = esc(listSpec);
        return `<div class="daw-reorder-bar">`
             + `<span class="daw-reorder-label">Selected</span>`
             + `<span class="daw-reorder-group" data-reorder-list="${spec}">`
             + `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}" data-reorder-dir="-1"
                        title="Move the selected one left" aria-label="Move selected left">&#9664;</button>`
             + `<button type="button" class="daw-tab-insert-btn" data-reorder-list="${spec}"
                        title="Insert after the selected one" aria-label="Insert after selected">&#43;</button>`
             + `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}" data-reorder-dir="1"
                        title="Move the selected one right" aria-label="Move selected right">&#9654;</button>`
             + `</span></div>`;
    };

    // Which entry is selected, and where its strip is. Read from the rendered
    // strip so no per-strip selection global has to be plumbed through.
    function activeIndexIn(row) {
        if (!row) return -1;
        const items = [...row.querySelectorAll('.daw-tab-item')];
        return items.findIndex(item => item.querySelector('.daw-tab-btn.active'));
    }

    // The strip is the next .daw-variant-tabs AFTER the bar.
    //
    // The bar has now been in three places. Per item, it travelled with the
    // entry being moved, so a second nudge meant chasing it along the row. At
    // the END of the strip, a character with twenty skills had to scroll the
    // whole strip right to reach it - every time, because the strip scrolls
    // back on re-render. Both faults are the same one: the controls moved with
    // the content. Its own row above the strip is the fixed spot.
    function rowFor(el) {
        if (!el || !el.closest) return null;
        const bar = el.closest('.daw-reorder-bar');
        if (!bar) return el.closest('.daw-variant-tabs');
        let node = bar.nextElementSibling;
        while (node && !node.classList.contains('daw-variant-tabs')) node = node.nextElementSibling;
        return node || null;
    }

    // Re-selecting by CLICKING the strip's own button, rather than by setting a
    // selection global: each strip loads a different editor on selection, and
    // the button already carries whichever one that is.
    function reselect(listSpec, index) {
        const group = document.querySelector(`.daw-reorder-group[data-reorder-list="${listSpec}"]`);
        const row = rowFor(group);
        if (!row) return;
        const items = [...row.querySelectorAll('.daw-tab-item')];
        const btn = items[index] && items[index].querySelector('.daw-tab-btn');
        if (btn) btn.click();
    }

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
        // Nothing selected, or the selection is already last: the add flow
        // appended, which is where it belongs. Guarding index < 0 explicitly,
        // because -1 + 1 would otherwise relocate the new entry to the front.
        if (index < 0 || index >= after.length - 1) return true;

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
            const spec = moveBtn.getAttribute('data-reorder-list');
            const dir = parseInt(moveBtn.getAttribute('data-reorder-dir'), 10);
            const index = activeIndexIn(rowFor(moveBtn));
            const list = resolveList(spec);

            // Nothing selected, or already at the end. Silent rather than an
            // error: the buttons are always there, and a strip can legitimately
            // have a non-movable section open (Overview's fixed four).
            if (index < 0 || !list || !window.moveListItem(list, index, dir)) return;

            afterChange();
            reselect(spec, index + dir);
            return;
        }

        const insertBtn = e.target.closest && e.target.closest('.daw-tab-insert-btn');
        if (insertBtn && !insertBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            const spec = insertBtn.getAttribute('data-reorder-list');
            // With nothing selected, append - which is what + ADD does anyway.
            const index = activeIndexIn(rowFor(insertBtn));
            window.insertListItemAfter(spec, index).then(inserted => {
                if (!inserted) return;
                afterChange();
                const list = resolveList(spec);
                reselect(spec, index < 0 ? (list ? list.length - 1 : 0) : index + 1);
            });
        }
    });
})();
