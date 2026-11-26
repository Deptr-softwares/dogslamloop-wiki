/**
 * Reorder and insert in place for every list strip in the editor (moves, overview
 * extras, matchups, keyed sections, combo groups and tables, system tabs and
 * sections), through one delegated listener over the strips' shared shape
 * (.daw-tab-item, its .daw-tab-btn and remove button).
 * @since v0.15
 * @touches window.currentEditorDescData and the frame data (data-reorder-list
 *   paths), triggerManualSync (editor-sync.js), each strip's own add flow
 * @watch a strip names its array in a data attribute, so a new strip needs no
 *   change here
 * @see docs/block-editor.md
 */

(function () {
    'use strict';

    // `data-reorder-list` is a dotted path from one of the editor's two data objects:
    // "desc.matchups", "frame.skills", "desc.tabs.0.sections".
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
     * The strip's one group of controls, fixed in its own row above the strip, acting
     * on the entry selected (read from the page at click time, since six strips keep
     * their selection in six different globals).
     */
    window.reorderStripControls = function (listSpec) {
        if (!listSpec) return '';
        const spec = window.escapeHtml(listSpec);
        return `<div class="daw-reorder-bar">`
             + `<span class="daw-reorder-label">Selected</span>`
             + `<span class="daw-reorder-group" data-reorder-list="${spec}">`
             + `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}" data-reorder-dir="-1"
                        data-tip="Move the selected one left" aria-label="Move selected left">&#9664;</button>`
             + `<button type="button" class="daw-tab-insert-btn" data-reorder-list="${spec}"
                        data-tip="Insert after the selected one" aria-label="Insert after selected">&#43;</button>`
             + `<button type="button" class="daw-tab-move-btn" data-reorder-list="${spec}" data-reorder-dir="1"
                        data-tip="Move the selected one right" aria-label="Move selected right">&#9654;</button>`
             + `</span></div>`;
    };

    // The selected entry and its strip, read from the page.
    function activeIndexIn(row) {
        if (!row) return -1;
        const items = [...row.querySelectorAll('.daw-tab-item')];
        return items.findIndex(item => item.querySelector('.daw-tab-btn.active'));
    }

    // The strip is the next .daw-variant-tabs after the bar: controls that moved with
    // the content had to be chased, so they sit still above it.
    function rowFor(el) {
        if (!el || !el.closest) return null;
        const bar = el.closest('.daw-reorder-bar');
        if (!bar) return el.closest('.daw-variant-tabs');
        let node = bar.nextElementSibling;
        while (node && !node.classList.contains('daw-variant-tabs')) node = node.nextElementSibling;
        return node || null;
    }

    // By clicking the strip's own button: each strip loads a different editor, and
    // the button already carries which.
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

    // Inserting runs the strip's own add flow, then moves the new entry into place:
    // a flow does more than build an object (addMove asks for an id and seeds
    // moveStrategies), and a second copy would drift.
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

        // Again: an add flow re-renders and can hand back a different array.
        const after = resolveList(listSpec);
        if (!after || after.length !== lengthBefore + 1) return false; // cancelled, or refused
        // Nothing selected, or the last: the add appended, which is right. -1 + 1 would
        // move the new entry to the front.
        if (index < 0 || index >= after.length - 1) return true;

        const [entry] = after.splice(after.length - 1, 1);
        after.splice(index + 1, 0, entry);
        return true;
    };

    // Each strip re-renders itself: six functions build them, and each knows which
    // selection to keep.
    let refresh = null;
    window.setReorderRefresh = function (fn) { refresh = fn; };

    // A refresh hook can decline with false: the system editor's is registered on
    // character pages too, and both render into #interactive-builder.
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

    // The open entry's Blocks sit in a buffer that each loader writes back to the
    // entry the selection names. A move changes the array under the selection, so
    // that write-back would land on whichever entry slid into the slot: the selection
    // is forgotten, and reselect() opens the moved entry from the data.
    function forgetSelection() {
        if (typeof window.clearPositionalSelection === 'function') window.clearPositionalSelection();
    }

    // On the document: every strip rebuilds its markup.
    document.addEventListener('click', async (e) => {
        const moveBtn = e.target.closest && e.target.closest('.daw-tab-move-btn');
        if (moveBtn && !moveBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            const spec = moveBtn.getAttribute('data-reorder-list');
            const dir = parseInt(moveBtn.getAttribute('data-reorder-dir'), 10);
            const index = activeIndexIn(rowFor(moveBtn));
            if (index < 0 || !resolveList(spec)) return;

            // The buffer goes into its entry first: forgetting the selection drops it, and
            // typing syncs only after a pause.
            if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
            const list = resolveList(spec);

            // Nothing selected, or at the end: silent, since a strip can have a fixed
            // section open (Overview's four).
            if (!list || !window.moveListItem(list, index, dir)) return;

            forgetSelection();
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
                // The add flows sync before they append, and the buffer now holds the new
                // entry, with nothing to keep yet.
                forgetSelection();
                afterChange();
                const list = resolveList(spec);
                reselect(spec, index < 0 ? (list ? list.length - 1 : 0) : index + 1);
            });
        }
    });
})();
