/**
 * Find and Replace across a whole page: every tab and every character state.
 * @since v0.15
 * @touches window.currentEditorDescData and the master desc_data (editor-modes.js),
 *   triggerManualSync (editor-sync.js), reopenEditorTab (editor-tabs.js)
 * @watch it walks the data, not a list of Block types, so a new type is searched
 *   with no change here. What it never touches is a list of field names below:
 *   structure, links and media, credit and identity (an anchor is what in-page
 *   links resolve against).
 * @see docs/block-editor.md
 */

(function () {
    'use strict';

    const SKIP_FIELDS = new Set([
        // Structure and enums.
        'type', 'align', 'size', 'style', 'intent', 'layout', 'width', 'alignment',
        'padding', 'controls', 'difficulty', 'status', 'tier', 'importance',
        // A colour: renaming "Red" would make the bar's value invalid, and no bar.
        'sideBar',
        // Links and media.
        'src', 'videoId', 'video', 'image', 'media', 'url', 'href', 'thumbnail',
        // Credit and identity.
        'author', 'uploader', 'id', 'uid', 'anchor', 'tabId',
        // Editor-only organisation: renaming a folder would regroup the Block list.
        'folder',
        // A colour value, not text.
        'folderColor',
        // Which grid a Color Swatches Block draws, and a Collaborator's kind, badge
        // colour and avatar: replacing "line" would change what the Block is.
        'set', 'kind', 'badge', 'avatar',
    ]);


    window.buildFindPattern = function (needle, opts) {
        const o = opts || {};
        if (!needle) return null;
        let body = window.escapeRegExp(needle);
        // \b does not fire next to punctuation, which "M1" and "R+4" can end in, so the
        // boundary is "not next to a word character".
        if (o.wholeWord) body = `(?<![\\w-])${body}(?![\\w-])`;
        return new RegExp(body, o.matchCase ? 'g' : 'gi');
    };

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

    // The writing checks read the same text, so the two agree on what a page says.
    window.walkEditorStrings = walkStrings;
    window.isEditorSkipField = (key) => SKIP_FIELDS.has(key);

    window.getAtPath = function (root, path) {
        return path.reduce((acc, k) => (acc === null || acc === undefined ? acc : acc[k]), root);
    };

    window.setAtPath = function (root, path, value) {
        if (!path.length) return;
        const parent = window.getAtPath(root, path.slice(0, -1));
        if (parent === null || parent === undefined) return;
        parent[path[path.length - 1]] = value;
    };

    // Naming where a match is: ['matchups', 3, 'content'] tells a contributor
    // nothing, and the list is for deciding about each match.
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
        // A combo's extra routes, named so a match there says where it is.
        notations: 'Notation style',
    };

    function keyedFieldLabel(field) {
        const section = window.getKeyedSectionByField && window.getKeyedSectionByField(field);
        if (section) return section.label || section.entryLabel || field;
        const fixed = (window.FIXED_BLOCK_SECTIONS || []).find(f => f.field === field);
        if (fixed) return fixed.label;
        if (FIELD_LABELS[field]) return FIELD_LABELS[field];
        // humanFieldName is in admin-diff.js, which the editor does not load.
        if (typeof window.humanFieldName === 'function') return window.humanFieldName(field);
        return String(field)
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/^\w/, c => c.toUpperCase());
    }

    // The name an entry goes by (a matchup's opponent, a group's title), so a match
    // reads "Matchups > vs. Vessel", not "Matchups > 3".
    function entryName(container, index) {
        const entry = container && container[index];
        if (!entry || typeof entry !== 'object') return `#${index + 1}`;
        // `label` last: a notation style has nothing else to go by.
        const named = entry.opponent || entry.topic || entry.title || entry.starter
            || entry.sectionTitle || entry.tabLabel || entry.combo || entry.name || entry.label;
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
                if (m[0] === '') pattern.lastIndex++; // never spin on an empty match
            }
        });
        return matches;
    };

    // One occurrence, by path and position, not by running the pattern again, so the
    // second "Ryu" in a paragraph cannot land on the first.
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
        // Collected first, written after: writing during the walk would scan its own
        // output, and replace twice when the new text holds the old.
        edits.forEach(e => window.setAtPath(root, e.path, e.next));
        return count;
    };
})();

// The panel.
(function () {
    'use strict';

    // The whole page, every tab and every character state:
    // window.currentEditorDescData is only the state on screen.
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

    // One UNDO for this operation only. The editor's own UNDO covers the open
    // section's Blocks, and the redraw afterwards resets it, while a replace writes
    // across every tab and both states.
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

    // In place: window.currentEditorDescData is a live part of the master, so a new
    // master would leave the editor writing to an object nothing reads.
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
                html += `<div class="find-replace-where">${window.escapeHtml(m.where || 'This page')}</div>`;
                lastWhere = m.where;
            }
            html += `<div class="find-replace-row">`
                + `<span class="find-replace-snippet">${window.escapeHtml(m.before)}`
                + `<mark class="find-replace-hit">${window.escapeHtml(m.match)}</mark>`
                + `${window.escapeHtml(m.after)}</span>`
                + `<button type="button" class="btn-sys btn-sys-regular find-replace-one" data-match="${i}">Replace</button>`
                + `</div>`;
        });
        results.innerHTML = html;
    }

    // Flushed first: the open section's Blocks reach desc_data only on sync, so the
    // text being edited would be missed, and the redraw would load the stale buffer
    // over the replacement. The redraw goes through reopenEditorTab, since the
    // section loaders write the old buffer back on entry.
    async function withFlushedData(fn) {
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        const result = fn();
        if (typeof window.reopenEditorTab === 'function') window.reopenEditorTab();
        if (typeof window.updateLivePreview === 'function') window.updateLivePreview();
        return result;
    }

    window.openFindReplace = async function () {
        const modal = document.getElementById('find-replace-modal');
        if (!modal) return;
        // A stale snapshot would roll back work done since.
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

        // Delegated: the rows are rebuilt on every keystroke.
        const results = document.getElementById('find-replace-results');
        if (results) {
            results.addEventListener('click', async (e) => {
                const btn = e.target.closest('.find-replace-one');
                if (!btn) return;
                const match = lastMatches[parseInt(btn.getAttribute('data-match'), 10)];
                if (!match) return;
                const replacement = (document.getElementById('replace-input') || {}).value || '';
                await withFlushedData(() => {
                    // Inside the flush, so it holds the buffer just written back.
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

                // Not flushed first: the open buffer holds the replaced Blocks, and a sync would
                // put them back over the restored ones.
                restoreInto(root, undoSnapshot);
                undoSnapshot = null;
                refreshUndoButton();

                if (typeof window.reopenEditorTab === 'function') window.reopenEditorTab();
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
