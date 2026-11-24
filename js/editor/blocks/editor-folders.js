/**
 * Block folders: named, collapsible groups in the Workspace's Block list, so a
 * long section can be moved around in rather than scrolled.
 * @since v0.15
 * @touches a Block's `folder` and `folderColor` (editor-only: the page renderer
 *   reads named fields and never these), renderBlockList (editor-blocks.js)
 * @watch a folder is a contiguous run of Blocks sharing a `folder` value, since
 *   array order is the order a reader reads. Joining moves the Block to the end
 *   of the run, leaving steps it out past the end, and reconcileFolderAt repairs
 *   the run after any move. An IIFE: a bare top-level const here could clash in
 *   the shared global scope.
 * @see docs/block-editor.md
 */

(function () {
    'use strict';

    // Long enough for "Corner routes (Dragon Install)", one line in the header.
    // Contributor-written, so this is where an absurd value stops being stored.
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

    // Contiguous runs, in order. Two runs can share a name if the data arrives that
    // way (a hand-edited payload); they draw as two folders, as the array says.
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

    // A folder's colour is stored on every member as `folderColor`, like its name, so
    // it moves with the Blocks. Every write here keeps a run's members agreeing, and
    // a Block in no folder carries none.
    function colorOf(block) {
        return block && typeof block.folderColor === 'string' ? block.folderColor : '';
    }

    function paint(block, color) {
        if (color) block.folderColor = color;
        else delete block.folderColor;
    }

    // The colour a Block takes on joining folder `name`: the other members'. Read
    // before the Block counts as a member.
    function joiningColor(blocks, block, name) {
        // Already in it (dropped on its own folder's header): nothing to join.
        if (nameOf(block) === name) return colorOf(block);
        const run = runNamed(blocks, name);
        if (!run) return '';
        for (let i = run.start; i <= run.end; i++) {
            if (blocks[i] !== block) return colorOf(blocks[i]);
        }
        return '';
    }

    window.blockFolderColor = function (blocks, name) {
        const run = Array.isArray(blocks) ? runNamed(blocks, normalize(name)) : null;
        return run ? colorOf(blocks[run.start]) : '';
    };

    /**
     * Sets folder `name`'s colour on every member; an empty `color` takes it off.
     * The caller vets the value with safeColor.
     * @since v1.1
     */
    window.setBlockFolderColor = function (blocks, name, color) {
        const target = normalize(name);
        if (!Array.isArray(blocks) || !target) return 0;
        let n = 0;
        blocks.forEach(function (b) {
            if (nameOf(b) === target) { paint(b, color); n += 1; }
        });
        return n;
    };

    // Empty folders exist only for the session: membership is a string on each
    // Block, so a folder with none is not in the data. Made from a header's +,
    // drawn as an empty drop zone, and made real once a Block joins. `after` anchors
    // one to its folder by name, so a reorder cannot strand it.
    let pending = [];

    window.pendingBlockFolders = function () {
        return pending.map(function (p) { return { name: p.name, after: p.after }; });
    };

    window.addPendingBlockFolder = function (blocks, afterFolder) {
        const name = window.nextFolderName(blocks, 'New Folder');
        pending.push({ name: name, after: normalize(afterFolder) });
        // Open: a new folder is made to be named and filled.
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

    // Taken by a real run or an empty folder, or renaming onto an empty one would
    // make two.
    function nameTaken(blocks, name) {
        return !!(runNamed(blocks, name) || pendingNamed(name));
    }
    window.blockFolderNameTaken = nameTaken;

    // Moves the Block to where the empty folder is drawn, which is where the author
    // pointed.
    function promotePending(blocks, index, name) {
        const spec = pendingNamed(name);
        if (!spec) return -1;

        const block = blocks[index];
        const anchor = spec.after ? runNamed(blocks, spec.after) : null;
        let insertAt = anchor ? anchor.end + 1 : blocks.length;

        blocks.splice(index, 1);
        if (index < insertAt) insertAt -= 1; // the removal shifted the anchor down
        blocks.splice(insertAt, 0, block);

        window.dropPendingBlockFolder(name);
        return insertAt;
    }

    /**
     * Moves Block `index` into folder `rawName`, or out of any folder for "". Returns
     * the Block's index after the move, or -1 for a no-op, so the caller can flash it.
     */
    window.assignBlockToFolder = function (blocks, index, rawName) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return -1;

        const block = blocks[index];
        const target = normalize(rawName);
        if (target === nameOf(block)) return -1;

        if (!target) {
            const run = runContaining(blocks, index);
            delete block.folder;
            delete block.folderColor;
            // A lone member leaves nothing behind to split, so it stays put.
            if (!run || run.count === 1) return index;
            blocks.splice(index, 1);
            blocks.splice(run.end, 0, block);
            return run.end;
        }

        // Read before the assignment, so `existing` is where the folder was.
        const existing = runNamed(blocks, target);
        paint(block, joiningColor(blocks, block, target));
        block.folder = target;

        if (!existing) {
            // An empty folder has a place on screen, so joining it means going there. A name
            // nobody uses becomes a one-Block folder where the Block is.
            const promoted = promotePending(blocks, index, target);
            return promoted >= 0 ? promoted : index;
        }

        const insertAt = index < existing.start ? existing.end : existing.end + 1;
        blocks.splice(index, 1);
        blocks.splice(insertAt, 0, block);
        return insertAt;
    };

    /**
     * Puts the Block at the top of a folder: dropping on a folder's header, the only
     * way into a shut folder.
     */
    window.dropBlockIntoFolderHead = function (blocks, index, rawName) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return -1;

        const target = normalize(rawName);
        if (!target) return -1;

        const block = blocks[index];
        const existing = runNamed(blocks, target);
        paint(block, joiningColor(blocks, block, target));
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

    /**
     * Settles folder membership at `index` after any move (a drag, the up and down
     * buttons), which says nothing about folders itself.
     */
    window.reconcileFolderAt = function (blocks, index) {
        if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return;

        const block = blocks[index];
        const own = nameOf(block);
        const prevName = index > 0 ? nameOf(blocks[index - 1]) : '';
        const nextName = index < blocks.length - 1 ? nameOf(blocks[index + 1]) : '';

        // Landed between two members of one folder: it is inside it now.
        if (prevName && prevName === nextName) {
            if (own !== prevName) {
                block.folder = prevName;
                paint(block, colorOf(blocks[index - 1]));
            }
            return;
        }

        // Still touching its own folder on one side, so it is the new first or
        // last member.
        if (!own || own === prevName || own === nextName) return;

        // Touching neither side: dragged out if others still carry the name, or a
        // one-Block folder that moved, which must stay one.
        const stillPopulated = blocks.some(function (b, i) {
            return i !== index && nameOf(b) === own;
        });
        if (stillPopulated) {
            delete block.folder;
            delete block.folderColor;
        }
    };

    /**
     * Moves a whole folder: one slice of the array cut out and spliced back.
     * `memberIndex` is any Block in it (two runs sharing a name stay two folders);
     * `slot` is an insert-before position, never strictly inside another folder
     * (folderDropSlot snaps it to an edge). Returns the new first index, or -1.
     * @since v1.1
     */
    window.moveBlockFolder = function (blocks, memberIndex, slot) {
        const run = Array.isArray(blocks) ? runContaining(blocks, memberIndex) : null;
        if (!run || slot < 0 || slot > blocks.length) return -1;
        if (slot >= run.start && slot <= run.end + 1) return -1;
        const members = blocks.splice(run.start, run.count);
        const at = slot > run.end ? slot - run.count : slot;
        blocks.splice.apply(blocks, [at, 0].concat(members));
        return at;
    };

    /**
     * Where a folder dropped at insert-before position `index` lands: folders do not
     * nest, so a position inside one moves to its nearer edge.
     * @since v1.1
     */
    window.folderDropSlot = function (blocks, index) {
        const runs = window.collectBlockFolders(blocks);
        for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            if (index > run.start && index <= run.end) {
                return index - run.start <= run.end + 1 - index ? run.start : run.end + 1;
            }
        }
        return index;
    };

    /**
     * Renames a folder. False when the name is taken: two runs with one name could
     * not be told apart.
     */
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
        // What is anchored to the old name follows it.
        pending.forEach(function (p) { if (p.after === from) p.after = next; });
        return true;
    };

    /**
     * Dissolves the folder and keeps every Block in place. Deleting content is what
     * a Block's own delete button is for.
     */
    window.ungroupBlockFolder = function (blocks, name) {
        const target = normalize(name);
        if (!Array.isArray(blocks) || !target) return 0;

        let n = 0;
        blocks.forEach(function (b) {
            if (nameOf(b) === target) { delete b.folder; delete b.folderColor; n += 1; }
        });
        return n;
    };

    // "New Folder", "New Folder 2", ...: a name free at this level.
    window.nextFolderName = function (blocks, base) {
        const stem = normalize(base) || 'New Folder';
        if (!nameTaken(blocks, stem)) return stem;
        for (let n = 2; n < 500; n++) {
            const candidate = normalize(stem + ' ' + n);
            if (!nameTaken(blocks, candidate)) return candidate;
        }
        return stem + ' ' + Date.now();
    };

    // Which folders are open, in memory: it must survive renderBlockList, and a
    // stored one could shut a folder the author never saw. Keyed by the accordion
    // path too, since a Combo Card's write-up can hold a folder with an outer one's
    // name. It tracks what is open, so every folder starts shut.

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
