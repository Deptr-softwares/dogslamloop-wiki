/**
 * Dogslamloop Wiki - Editor: Block Folders (v0.15 item 9)
 *
 * Groups the block list into named, collapsible folders so a long section can
 * be navigated instead of scrolled.
 *
 * EDITOR-FACING ONLY, and that is a property of the data shape rather than a
 * promise: membership is a plain `folder` string on the block, and
 * js/description.js renders by dispatching on block.type through an if/else
 * chain that reads named fields. An unrecognised property is not skipped by a
 * rule someone has to maintain - there is nothing that could look at it. A
 * visitor's page is byte-identical whether the blocks are foldered or not.
 *
 * THE CONTIGUITY INVARIANT
 *
 * Array order IS the order a visitor reads, so a folder cannot gather blocks
 * scattered through a section without silently rewriting the page. A folder is
 * therefore a CONTIGUOUS RUN of blocks sharing a `folder` value, and every
 * operation here preserves that:
 *
 *   - joining a folder MOVES the block to the end of the run,
 *   - leaving one steps it out past the run's end rather than tearing a hole
 *     in the middle, which would render as two folders with the same name,
 *   - reconcileFolderAt() repairs the invariant after a positional move,
 *     because a drag can drop a block straight through a folder it was never
 *     assigned to and the gesture never touches `folder` itself.
 *
 * Own file, and an IIFE, for the reason spelled out at the top of
 * editor-blocks.js: these are classic scripts sharing one global lexical
 * scope, and a bare top-level const here can abort an unrelated file.
 */

(function () {
    'use strict';

    // Long enough for "Corner routes (Dragon Install)", short enough that the
    // header stays one line. Contributor-authored, so it is also the point
    // where an absurd value stops being stored rather than being escaped
    // forever after.
    const MAX_FOLDER_NAME = 60;

    function nameOf(block) {
        if (!block || typeof block.folder !== 'string') return '';
        return block.folder.trim();
    }

    function normalize(raw) {
        if (typeof raw !== 'string') return '';
        return raw.trim().slice(0, MAX_FOLDER_NAME);
    }

    window.blockFolderName = nameOf;
    window.normalizeFolderName = normalize;

    // --- READING ---

    // Contiguous runs, in document order. Two runs CAN share a name if the
    // data arrives that way (a hand-edited payload, an older ticket merged
    // over a newer one); they render as two folders, which is honest about
    // what the array actually says rather than hiding it.
    window.collectBlockFolders = function (blocks) {
        const runs = [];
        if (!Array.isArray(blocks)) return runs;

        let current = null;
        for (let i = 0; i < blocks.length; i++) {
            const name = nameOf(blocks[i]);
            if (!name) { current = null; continue; }
            if (current && current.name === name) {
                current.end = i;
                current.count += 1;
                continue;
            }
            current = { name: name, start: i, end: i, count: 1 };
            runs.push(current);
        }
        return runs;
    };

    function runContaining(blocks, index) {
        const runs = window.collectBlockFolders(blocks);
        for (let i = 0; i < runs.length; i++) {
            if (index >= runs[i].start && index <= runs[i].end) return runs[i];
        }
        return null;
    }

    function runNamed(blocks, name) {
        const runs = window.collectBlockFolders(blocks);
        for (let i = 0; i < runs.length; i++) {
            if (runs[i].name === name) return runs[i];
        }
        return null;
    }

    window.blockFolderRunContaining = runContaining;
    window.blockFolderRunNamed = runNamed;

    // --- WRITING ---

    // Moves block `index` into folder `rawName`, or out of any folder when
    // rawName is empty. Returns the block's index AFTER the move, or -1 if the
    // call was a no-op, so the caller can flash the card where it landed.
    window.assignBlockToFolder = function (blocks, index, rawName) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return -1;

        const block = blocks[index];
        const target = normalize(rawName);
        if (target === nameOf(block)) return -1;

        if (!target) {
            const run = runContaining(blocks, index);
            delete block.folder;
            // A lone member leaves nothing behind to split, so it stays put.
            if (!run || run.count === 1) return index;
            blocks.splice(index, 1);
            blocks.splice(run.end, 0, block);
            return run.end;
        }

        // Read the run BEFORE the assignment, so `existing` describes where the
        // folder was rather than where this block is about to be counted.
        const existing = runNamed(blocks, target);
        block.folder = target;

        // A name nobody is using yet becomes a one-block folder exactly where
        // the block already sits - nothing needs to move.
        if (!existing) return index;

        const insertAt = index < existing.start ? existing.end : existing.end + 1;
        blocks.splice(index, 1);
        blocks.splice(insertAt, 0, block);
        return insertAt;
    };

    // Puts the block at the TOP of a folder instead of the end. This is what
    // dropping onto the folder header means, and it is the only way to reach
    // the inside of a COLLAPSED folder, which shows no cards to drop between.
    window.dropBlockIntoFolderHead = function (blocks, index, rawName) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return -1;

        const target = normalize(rawName);
        if (!target) return -1;

        const block = blocks[index];
        const existing = runNamed(blocks, target);
        block.folder = target;
        if (!existing) return index;

        const insertAt = index < existing.start ? existing.start - 1 : existing.start;
        blocks.splice(index, 1);
        blocks.splice(insertAt, 0, block);
        return insertAt;
    };

    // Called after any positional move - a drag, or the up/down buttons. The
    // gesture moves an array element and says nothing about membership, so
    // without this a block can be dragged into the middle of a folder and
    // render inside it while carrying no `folder` at all, splitting the run in
    // two.
    window.reconcileFolderAt = function (blocks, index) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return;

        const block = blocks[index];
        const own = nameOf(block);
        const prevName = index > 0 ? nameOf(blocks[index - 1]) : '';
        const nextName = index < blocks.length - 1 ? nameOf(blocks[index + 1]) : '';

        // Landed between two members of one folder: it is inside it now.
        if (prevName && prevName === nextName) {
            if (own !== prevName) block.folder = prevName;
            return;
        }

        // Still touching its own folder on one side, so it is the new first or
        // last member.
        if (!own || own === prevName || own === nextName) return;

        // Touching neither side. If other blocks still carry the name it was
        // dragged OUT; if none do it is a one-block folder that simply moved,
        // and clearing that would make solo folders impossible to reposition.
        const stillPopulated = blocks.some(function (b, i) {
            return i !== index && nameOf(b) === own;
        });
        if (stillPopulated) delete block.folder;
    };

    // False when the name is already taken - two runs sharing a name would
    // render as two folders called the same thing, and the author would have
    // no way to tell them apart.
    window.renameBlockFolder = function (blocks, oldName, rawNew) {
        const from = normalize(oldName);
        const next = normalize(rawNew);
        if (!Array.isArray(blocks) || !from || !next) return false;
        if (from === next) return true;
        if (runNamed(blocks, next)) return false;

        blocks.forEach(function (b) {
            if (nameOf(b) === from) b.folder = next;
        });
        return true;
    };

    // Dissolves the folder and KEEPS every block, in place. Deleting content
    // is what the per-block ✖ is for; a folder is organisation, and losing a
    // section's writing to a misread icon is not a recoverable mistake for a
    // contributor who has not saved.
    window.ungroupBlockFolder = function (blocks, name) {
        const target = normalize(name);
        if (!Array.isArray(blocks) || !target) return 0;

        let n = 0;
        blocks.forEach(function (b) {
            if (nameOf(b) === target) { delete b.folder; n += 1; }
        });
        return n;
    };

    // "New Folder", "New Folder 2", ... - a name that is free at this level.
    window.nextFolderName = function (blocks, base) {
        const stem = normalize(base) || 'New Folder';
        if (!runNamed(blocks, stem)) return stem;
        for (let n = 2; n < 500; n++) {
            const candidate = normalize(stem + ' ' + n);
            if (!runNamed(blocks, candidate)) return candidate;
        }
        return stem + ' ' + Date.now();
    };

    // --- COLLAPSED STATE ---
    //
    // In memory, not localStorage. The requirement is that it survives
    // renderBlockList(), which runs on nearly every edit; surviving a reload
    // would mean inventing a storage key scoped to page + section + folder,
    // and a stale one would collapse a folder the author has never seen.
    //
    // Keyed by the accordion path as well as the name, because an inner
    // theorybox write-up can hold a folder called the same thing as one in the
    // section around it.

    let collapsed = new Set();

    function collapseKey(name) {
        const path = Array.isArray(window.activeAccordionPath)
            ? window.activeAccordionPath.join('.')
            : '';
        return path + '|' + normalize(name);
    }

    window.resetBlockFolderState = function () {
        collapsed = new Set();
    };

    window.isBlockFolderCollapsed = function (name) {
        return collapsed.has(collapseKey(name));
    };

    window.setBlockFolderCollapsed = function (name, on) {
        const key = collapseKey(name);
        if (!normalize(name)) return;
        if (on) collapsed.add(key);
        else collapsed.delete(key);
    };

    window.toggleBlockFolderCollapsed = function (name) {
        const on = !window.isBlockFolderCollapsed(name);
        window.setBlockFolderCollapsed(name, on);
        return on;
    };
})();
