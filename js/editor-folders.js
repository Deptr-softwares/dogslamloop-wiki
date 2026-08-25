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

    // --- EMPTY FOLDERS ---
    //
    // Membership is a per-block string, so a folder holding no blocks does not
    // exist in the data at all. Empty folders are held here for the session
    // instead: created from a folder header's ＋, rendered as an empty drop
    // zone, and promoted into real data the moment a block joins one. Losing
    // them on reload is correct rather than a gap - there was nothing to save.
    //
    // `after` anchors one to the folder it was created from BY NAME, not by
    // index, so reordering blocks around it cannot strand it somewhere else.
    let pending = [];

    window.pendingBlockFolders = function () {
        return pending.map(function (p) { return { name: p.name, after: p.after }; });
    };

    window.addPendingBlockFolder = function (blocks, afterFolder) {
        const name = window.nextFolderName(blocks, 'New Folder');
        pending.push({ name: name, after: normalize(afterFolder) });
        // Open, for the same reason a newly added block is: folders now start
        // collapsed (v0.16 fine-tuning 2), and a brand new one that appeared
        // shut would need a click before it could be named or filled - which
        // is the opposite of what pressing "new folder" asked for.
        if (typeof window.setBlockFolderCollapsed === 'function') {
            window.setBlockFolderCollapsed(name, false);
        }
        return name;
    };

    window.dropPendingBlockFolder = function (name) {
        const key = normalize(name);
        const before = pending.length;
        pending = pending.filter(function (p) { return p.name !== key; });
        return pending.length !== before;
    };

    function pendingNamed(name) {
        const key = normalize(name);
        for (let i = 0; i < pending.length; i++) if (pending[i].name === key) return pending[i];
        return null;
    }

    // A name is taken if EITHER a real run or an empty folder holds it -
    // otherwise renaming onto an empty folder would produce two of them.
    function nameTaken(blocks, name) {
        return !!(runNamed(blocks, name) || pendingNamed(name));
    }
    window.blockFolderNameTaken = nameTaken;

    // Moves the block to where the empty folder is DRAWN. Without this, filing
    // a block into an empty folder would create it wherever that block already
    // sat, which is rarely where the author was pointing.
    function promotePending(blocks, index, name) {
        const spec = pendingNamed(name);
        if (!spec) return -1;

        const block = blocks[index];
        const anchor = spec.after ? runNamed(blocks, spec.after) : null;
        let insertAt = anchor ? anchor.end + 1 : blocks.length;

        blocks.splice(index, 1);
        if (index < insertAt) insertAt -= 1;   // the removal shifted the anchor down
        blocks.splice(insertAt, 0, block);

        window.dropPendingBlockFolder(name);
        return insertAt;
    }

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

        if (!existing) {
            // An empty folder already has a place on screen, so joining it
            // means going there. A name nobody is using at all becomes a
            // one-block folder exactly where the block already sits.
            const promoted = promotePending(blocks, index, target);
            return promoted >= 0 ? promoted : index;
        }

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
        if (!existing) {
            const promoted = promotePending(blocks, index, target);
            return promoted >= 0 ? promoted : index;
        }

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
        if (nameTaken(blocks, next)) return false;

        // An empty folder is renamed in place; it has no members to rewrite.
        const empty = pendingNamed(from);
        if (empty) { empty.name = next; return true; }

        blocks.forEach(function (b) {
            if (nameOf(b) === from) b.folder = next;
        });
        // Anything anchored to the old name follows it, or it would jump to
        // the end of the list the moment its neighbour was renamed.
        pending.forEach(function (p) { if (p.after === from) p.after = next; });
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
        if (!nameTaken(blocks, stem)) return stem;
        for (let n = 2; n < 500; n++) {
            const candidate = normalize(stem + ' ' + n);
            if (!nameTaken(blocks, candidate)) return candidate;
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

    // TRACKS WHAT IS OPEN, NOT WHAT IS CLOSED (v0.16 fine-tuning 2).
    //
    // This was a set of collapsed folders, so the default was expanded and a
    // section with a dozen folders opened as a wall. The owner asked for the
    // workspace to open quiet: everything closed, and opening is the opt-in.
    //
    // Inverting the SET rather than adding a "startCollapsed" flag keeps one
    // source of truth. A flag would have to be consulted everywhere the set
    // already is, and the two would disagree the first time somebody added a
    // third state.
    let expanded = new Set();

    function collapseKey(name) {
        const path = Array.isArray(window.activeAccordionPath)
            ? window.activeAccordionPath.join('.')
            : '';
        return path + '|' + normalize(name);
    }

    window.resetBlockFolderState = function () {
        expanded = new Set();
        pending = [];
    };

    window.isBlockFolderCollapsed = function (name) {
        return !expanded.has(collapseKey(name));
    };

    window.setBlockFolderCollapsed = function (name, on) {
        const key = collapseKey(name);
        if (!normalize(name)) return;
        if (on) expanded.delete(key);
        else expanded.add(key);
    };

    window.toggleBlockFolderCollapsed = function (name) {
        const on = !window.isBlockFolderCollapsed(name);
        window.setBlockFolderCollapsed(name, on);
        return on;
    };
})();
