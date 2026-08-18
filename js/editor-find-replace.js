/**
 * Dogslamloop Wiki - Editor: Find and Replace (v0.15 item 7)
 *
 * Renaming a character or a move meant opening every tab and hunting through
 * dozens of blocks by eye. A combo table alone can carry 127 rows.
 *
 * WALKS THE DATA GENERICALLY RATHER THAN ENUMERATING BLOCK TYPES. A block type
 * added later is searched without anybody coming back here - which matters,
 * because this version alone added two (theorybox, and the combo row shape) and
 * the last thing that enumerated block types by hand missed two of six sites.
 *
 * What it will not touch is therefore the interesting half, and it is a list of
 * FIELD NAMES rather than a list of types:
 *
 *   - structure and enums (type, align, size, difficulty...) - replacing text
 *     inside these silently breaks rendering or sorting rather than showing an
 *     error. A typo'd difficulty sorts the row to the bottom and says nothing.
 *   - links and media (src, videoId, video, image) - a rename that rewrites a
 *     URL breaks the media rather than renaming anything.
 *   - credit (author) - whose work it is, not what it says.
 *   - identity (id, uid, anchor) - an anchor is what in-page links resolve
 *     against (item 5), so rewriting one breaks every link pointing at it.
 */

(function () {
    'use strict';

    const SKIP_FIELDS = new Set([
        // Structure and enums.
        'type', 'align', 'size', 'style', 'intent', 'layout', 'width', 'alignment',
        'padding', 'controls', 'difficulty', 'status', 'tier', 'importance',
        // Links and media.
        'src', 'videoId', 'video', 'image', 'media', 'url', 'href', 'thumbnail',
        // Credit and identity.
        'author', 'uploader', 'id', 'uid', 'anchor', 'tabId',
    ]);

    const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    window.buildFindPattern = function (needle, opts) {
        const o = opts || {};
        if (!needle) return null;
        let body = escapeRe(needle);
        // \b would not fire against a term starting or ending in punctuation,
        // which "M1" and "R+4" both can - so the boundary is asserted as "not
        // adjacent to a word character" instead.
        if (o.wholeWord) body = `(?<![\\w-])${body}(?![\\w-])`;
        return new RegExp(body, o.matchCase ? 'g' : 'gi');
    };

    // --- WALKING ---

    function walkStrings(node, path, visit) {
        if (typeof node === 'string') { visit(node, path); return; }
        if (Array.isArray(node)) {
            node.forEach((child, i) => walkStrings(child, path.concat(i), visit));
            return;
        }
        if (node && typeof node === 'object') {
            Object.keys(node).forEach(k => {
                if (SKIP_FIELDS.has(k)) return;
                walkStrings(node[k], path.concat(k), visit);
            });
        }
    }

    window.getAtPath = function (root, path) {
        return path.reduce((acc, k) => (acc === null || acc === undefined ? acc : acc[k]), root);
    };

    window.setAtPath = function (root, path, value) {
        if (!path.length) return;
        const parent = window.getAtPath(root, path.slice(0, -1));
        if (parent === null || parent === undefined) return;
        parent[path[path.length - 1]] = value;
    };

    // --- NAMING WHERE A MATCH IS ---
    //
    // A path is ['matchups', 3, 'content', 1, 'content']. On its own that tells
    // a contributor nothing, and the whole point of listing matches is so they
    // can decide about each one.
    const FIELD_LABELS = {
        overview: 'Character Overview',
        strategy: 'General Strategy',
        profile: 'Profile',
        playstyle: 'Playstyle',
        extras: 'Custom Section',
        moveStrategies: 'Move Write-up',
        tabs: 'Tab',
        sections: 'Section',
        content: 'Text',
        items: 'List item',
        sequence: 'Route step',
        rows: 'Row',
        headers: 'Table header',
        notes: 'Notes',
        oneliner: 'Summary',
        title: 'Title',
        sectionTitle: 'Section name',
        combo: 'Combo route',
    };

    function keyedFieldLabel(field) {
        const section = window.getKeyedSectionByField && window.getKeyedSectionByField(field);
        if (section) return section.label || section.entryLabel || field;
        const fixed = (window.FIXED_BLOCK_SECTIONS || []).find(f => f.field === field);
        if (fixed) return fixed.label;
        if (FIELD_LABELS[field]) return FIELD_LABELS[field];
        // humanFieldName lives in js/admin-diff.js, which the editor does not
        // load - so this needs its own fallback rather than assuming it.
        if (typeof window.humanFieldName === 'function') return window.humanFieldName(field);
        return String(field)
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/^\w/, c => c.toUpperCase());
    }

    // The name an array ENTRY goes by - a matchup's opponent, a combo group's
    // title - so a match reads "Matchups > vs. Vessel" rather than "Matchups > 3".
    function entryName(container, index) {
        const entry = container && container[index];
        if (!entry || typeof entry !== 'object') return `#${index + 1}`;
        const named = entry.opponent || entry.topic || entry.title || entry.starter
            || entry.sectionTitle || entry.tabLabel || entry.combo || entry.name;
        return named ? String(named) : `#${index + 1}`;
    }

    window.describeEditorPath = function (root, path) {
        const parts = [];
        let cursor = root;
        let i = 0;

        // A character state's slice, so a match in the Ultimate kit says so.
        if (path[0] === 'modeData' && path.length > 1) {
            parts.push(String(path[1]).toUpperCase());
            cursor = cursor[path[0]][path[1]];
            i = 2;
        }

        for (; i < path.length; i++) {
            const key = path[i];
            const parent = cursor;
            cursor = cursor === null || cursor === undefined ? cursor : cursor[key];

            if (typeof key === 'number') {
                // An index is only worth naming when its entry has a name.
                const name = entryName(parent, key);
                if (!/^#\d+$/.test(name)) parts.push(name);
                else if (i === path.length - 1) parts.push(name);
                continue;
            }
            if (key === 'content' && i === path.length - 1) continue;   // "Text" adds nothing at the end
            const label = keyedFieldLabel(key);
            if (label) parts.push(label);
        }

        return parts.filter(Boolean).join(' › ');
    };

    // --- FINDING ---

    window.findEditorMatches = function (root, needle, opts) {
        const pattern = window.buildFindPattern(needle, opts);
        if (!pattern || !root) return [];

        const matches = [];
        walkStrings(root, [], (value, path) => {
            pattern.lastIndex = 0;
            let m;
            let occurrence = 0;
            while ((m = pattern.exec(value)) !== null) {
                matches.push({
                    path: path.slice(),
                    occurrence,
                    index: m.index,
                    match: m[0],
                    // Enough either side to recognise which one this is.
                    before: value.slice(Math.max(0, m.index - 40), m.index),
                    after: value.slice(m.index + m[0].length, m.index + m[0].length + 40),
                    where: window.describeEditorPath(root, path),
                });
                occurrence++;
                if (m[0] === '') pattern.lastIndex++;   // never spin on an empty match
            }
        });
        return matches;
    };

    // --- REPLACING ---

    // One occurrence, identified by path and position within that string. Done
    // by index rather than by re-running the pattern, so replacing the second
    // "Ryu" in a paragraph cannot land on the first.
    window.replaceOneMatch = function (root, match, replacement) {
        const value = window.getAtPath(root, match.path);
        if (typeof value !== 'string') return false;
        const head = value.slice(0, match.index);
        const tail = value.slice(match.index + match.match.length);
        window.setAtPath(root, match.path, head + replacement + tail);
        return true;
    };

    window.replaceAllMatches = function (root, needle, replacement, opts) {
        const pattern = window.buildFindPattern(needle, opts);
        if (!pattern || !root) return 0;

        let count = 0;
        const edits = [];
        walkStrings(root, [], (value, path) => {
            pattern.lastIndex = 0;
            if (!pattern.test(value)) return;
            pattern.lastIndex = 0;
            const next = value.replace(pattern, () => { count++; return replacement; });
            edits.push({ path, next });
        });
        // Collected first, written after: mutating a string while walking is
        // safe here, but writing during the walk makes the traversal depend on
        // its own output, which is how a replacement gets re-scanned and
        // replaced twice when the new text contains the old.
        edits.forEach(e => window.setAtPath(root, e.path, e.next));
        return count;
    };
})();

// =====================================================================
// THE PANEL
// =====================================================================
(function () {
    'use strict';

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

    // The WHOLE page, every tab and every character state - not the slice the
    // editor is showing. window.currentEditorDescData points at the active
    // state (js/editor-modes.js), so searching that would quietly miss the
    // other kit, which is exactly the axis three separate bugs have already
    // been lost along in this project.
    function searchRoot() {
        return window.editorMasterDescData || window.currentEditorDescData || null;
    }

    function currentOptions() {
        return {
            matchCase: !!(document.getElementById('find-match-case') || {}).checked,
            wholeWord: !!(document.getElementById('find-whole-word') || {}).checked,
        };
    }

    let lastMatches = [];

    // ONE LEVEL OF UNDO, FOR THIS OPERATION ONLY.
    //
    // The editor already has an undo (btn-undo, Ctrl+Z) and it does not cover
    // this: its history is the block buffer of the section currently OPEN, and
    // a replace writes across every tab and both character states. Worse, the
    // re-render afterwards calls initStrategyBlockBuilder, which resets that
    // history to the post-replace state - so the button comes back disabled and
    // Ctrl+Z does nothing. Confirmed by driving it, not assumed.
    //
    // That failure is at least SAFE: partially reverting one open section while
    // the rest of the page stayed renamed would be worse than nothing. But a
    // mass replace across 127 rows still needs a way back.
    let undoSnapshot = null;
    let undoLabel = '';

    function takeUndoSnapshot(label) {
        const root = searchRoot();
        undoSnapshot = root ? JSON.parse(JSON.stringify(root)) : null;
        undoLabel = label;
        refreshUndoButton();
    }

    function refreshUndoButton() {
        const btn = document.getElementById('find-replace-undo');
        if (!btn) return;
        btn.disabled = !undoSnapshot;
        btn.textContent = undoSnapshot ? `UNDO ${undoLabel}` : 'UNDO';
    }

    // Restored IN PLACE. window.currentEditorDescData is a live sub-reference
    // of the master (js/editor-modes.js), so reassigning the master would leave
    // the editor pointing at an object nothing writes to any more - which is
    // the bug that shape has already produced once in this project.
    function restoreInto(target, source) {
        Object.keys(target).forEach(k => { delete target[k]; });
        Object.keys(source).forEach(k => { target[k] = JSON.parse(JSON.stringify(source[k])); });
    }

    function renderResults() {
        const results = document.getElementById('find-replace-results');
        const countEl = document.getElementById('find-replace-count');
        const needle = (document.getElementById('find-input') || {}).value || '';
        if (!results) return;

        if (!needle) {
            lastMatches = [];
            results.innerHTML = '';
            if (countEl) countEl.textContent = '';
            return;
        }

        lastMatches = window.findEditorMatches(searchRoot(), needle, currentOptions());

        if (countEl) {
            const places = new Set(lastMatches.map(m => m.where)).size;
            countEl.textContent = lastMatches.length
                ? `${lastMatches.length} match${lastMatches.length === 1 ? '' : 'es'} in ${places} place${places === 1 ? '' : 's'}`
                : 'No matches.';
        }

        if (!lastMatches.length) {
            results.innerHTML = `<p class="find-replace-empty">Nothing on this page matches.</p>`;
            return;
        }

        let html = '';
        let lastWhere = null;
        lastMatches.forEach((m, i) => {
            if (m.where !== lastWhere) {
                html += `<div class="find-replace-where">${esc(m.where || 'This page')}</div>`;
                lastWhere = m.where;
            }
            html += `<div class="find-replace-row">`
                + `<span class="find-replace-snippet">${esc(m.before)}`
                + `<mark class="find-replace-hit">${esc(m.match)}</mark>`
                + `${esc(m.after)}</span>`
                + `<button type="button" class="btn-sys btn-sys-regular find-replace-one" data-match="${i}">Replace</button>`
                + `</div>`;
        });
        results.innerHTML = html;
    }

    // Flushing first is not optional. currentStrategyBlocks is a buffer that is
    // only written back into desc_data on sync, so without this the text being
    // edited right now is not searchable - and worse, the re-render afterwards
    // would load the stale buffer back over a replacement that had just landed.
    async function withFlushedData(fn) {
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        const result = fn();
        if (typeof initFullTabEditor === 'function') {
            initFullTabEditor(
                window.currentEditorCharId,
                window.currentEditorTabId,
                window.currentEditorDescData,
                window.currentEditorFrameData
            );
        }
        if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
        return result;
    }

    window.openFindReplace = async function () {
        const modal = document.getElementById('find-replace-modal');
        if (!modal) return;
        // A stale snapshot is worse than none: reopening the panel after doing
        // other work and pressing UNDO would roll that work back too.
        undoSnapshot = null;
        refreshUndoButton();
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        modal.classList.remove('hidden');
        const input = document.getElementById('find-input');
        if (input) input.focus();
        renderResults();
    };

    function closePanel() {
        const modal = document.getElementById('find-replace-modal');
        if (modal) modal.classList.add('hidden');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('find-replace-modal');
        if (!modal) return;

        ['find-input', 'find-match-case', 'find-whole-word'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', renderResults);
            if (el && el.type === 'checkbox') el.addEventListener('change', renderResults);
        });

        const closeBtn = document.getElementById('find-replace-close');
        if (closeBtn) closeBtn.addEventListener('click', closePanel);

        // Delegated: the rows are rebuilt on every keystroke, and a match index
        // baked into an inline handler would point at the previous list.
        const results = document.getElementById('find-replace-results');
        if (results) {
            results.addEventListener('click', async (e) => {
                const btn = e.target.closest('.find-replace-one');
                if (!btn) return;
                const match = lastMatches[parseInt(btn.getAttribute('data-match'), 10)];
                if (!match) return;
                const replacement = (document.getElementById('replace-input') || {}).value || '';
                await withFlushedData(() => {
                    // Snapshot INSIDE the flush, so it captures the buffer that
                    // was just written back rather than the state before it.
                    takeUndoSnapshot('replace');
                    return window.replaceOneMatch(searchRoot(), match, replacement);
                });
                renderResults();
            });
        }

        const undoBtn = document.getElementById('find-replace-undo');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                if (!undoSnapshot) return;
                const root = searchRoot();
                if (!root) return;

                // DELIBERATELY NOT flushed first. triggerManualSync writes the
                // open block buffer into desc_data, and that buffer holds the
                // POST-replace blocks - syncing before restoring would put them
                // straight back over the restored ones.
                restoreInto(root, undoSnapshot);
                undoSnapshot = null;
                refreshUndoButton();

                if (typeof initFullTabEditor === 'function') {
                    initFullTabEditor(
                        window.currentEditorCharId,
                        window.currentEditorTabId,
                        window.currentEditorDescData,
                        window.currentEditorFrameData
                    );
                }
                if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
                renderResults();
            });
        }

        const allBtn = document.getElementById('find-replace-all');
        if (allBtn) {
            allBtn.addEventListener('click', async () => {
                const needle = (document.getElementById('find-input') || {}).value || '';
                if (!needle || !lastMatches.length) return;
                const replacement = (document.getElementById('replace-input') || {}).value || '';

                const ok = typeof window.customConfirm === 'function'
                    ? await window.customConfirm(
                        `Replace all ${lastMatches.length} occurrence(s) of "${needle}" with "${replacement}"? This cannot be undone from here.`)
                    : true;
                if (!ok) return;

                const count = await withFlushedData(() => {
                    takeUndoSnapshot(`replace all (${lastMatches.length})`);
                    return window.replaceAllMatches(searchRoot(), needle, replacement, currentOptions());
                });
                renderResults();
                if (typeof window.editorAlert === 'function') window.editorAlert(`Replaced ${count} occurrence(s).`);
            });
        }
    });
})();
