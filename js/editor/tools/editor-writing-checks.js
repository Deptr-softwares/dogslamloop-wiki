/**
 * Writing checks: character names written the anime's way, and broken format
 * tags. A yellow line under the field while typing, with FIX for a name, and at
 * Submit a list of what is left in the text the submission adds or changes,
 * which can still be sent.
 * @since v1.1
 * @touches walkEditorStrings and buildFindPattern (editor-find-replace.js),
 *   CHARACTER_ALIASES (site_meta.js), isTextIconTag (internalstyling.js)
 * @watch exact case and whole words, nothing inside [noauto], and the same text
 *   Find and Replace walks, so the two agree on what a page says. The tag grammar
 *   here is one of the copies of internalstyling.js's. An IIFE: one global scope.
 * @see docs/editor.md
 */
(function () {
    'use strict';

    // The JJK names, both orders where site_meta.js has them. Each resolves to its
    // character through CHARACTER_ALIASES, which also holds the nicknames left out.
    const JJK_NAMES = [
        'Gojo', 'Gojo Satoru', 'Satoru Gojo',
        'Itadori Yuji', 'Yuji Itadori', 'Yuji',
        'Kinji Hakari', 'Hakari Kinji', 'Hakari',
        'Fushiguro Megumi', 'Megumi Fushiguro', 'Megumi',
        'Mahito', 'Choso',
        'Aoi Todo', 'Todo Aoi', 'Todo',
        'Hiromi Higuruma', 'Higuruma Hiromi', 'Higuruma', 'Higgy',
        'Yuta Okkotsu', 'Okkotsu Yuta', 'Yuta',
        'Ultimate Mechamaru', 'Mechamaru', 'Kokichi Muta', 'Muta Kokichi', 'Kokichi',
        'Zenin Naoya', 'Naoya Zenin', 'Naoya',
        'Kento Nanami', 'Nanami Kento', 'Nanami',
        'Hanami',
        'Ryu Ishigori', 'Ishigori Ryu', 'Ryu',
        'Reggie Star', 'Reggie',
        'Ko Guy',
        'Yuki Tsukumo', 'Tsukumo Yuki', 'Yuki',
        'Charles Bernard', 'Charles',
        'Haruta Shigemo', 'Shigemo Haruta', 'Haruta',
        'Mei Mei',
        'Kurourushi', 'Kuro',
    ];
    window.JJK_NAMES = JJK_NAMES;

    let names = null;

    function nameLookup() {
        if (names) return names;
        const aliases = window.CHARACTER_ALIASES;
        if (!aliases) return { character: new Map(), pattern: null };
        const character = new Map();
        Object.entries(aliases).forEach(([canonical, list]) => (list || []).forEach(a => character.set(a, canonical)));
        // Longest first, so "Yuji Itadori" is one name, not "Yuji" and a word.
        const known = JJK_NAMES.filter(n => character.has(n)).sort((a, b) => b.length - a.length);
        names = {
            character,
            // Find and Replace's whole-word edge: not next to a letter, digit, _ or -.
            pattern: known.length ? new RegExp(`(?<![\\w-])(?:${known.map(window.escapeRegExp).join('|')})(?![\\w-])`, 'g') : null,
        };
        return names;
    }

    // [noauto] regions and every [tag] blanked to spaces of the same length, so an
    // index here is an index in the field.
    const NOAUTO = /\[noauto(?:=all)?\][\s\S]*?\[\/noauto\]/gi;
    const ANY_TAG = /\[[^\]\n]*\]/g;
    const blank = (m) => ' '.repeat(m.length);

    function nameMatches(text) {
        const { character, pattern } = nameLookup();
        if (!pattern) return [];
        const prose = text.replace(NOAUTO, blank).replace(ANY_TAG, blank);
        const out = [];
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(prose)) !== null) {
            out.push({ index: m.index, name: m[0], character: character.get(m[0]) });
        }
        return out;
    }

    // The format tags, internalstyling.js's grammar: paired tags with no value, three
    // that need one, [noauto] and [noauto=all], and the mini icon, in any case. A
    // bracketed word that is none of them and has no "=" is left alone: "[M1]" is how
    // a keybind is written.
    const PLAIN_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'kbd', 'outline']);
    const VALUE_TAGS = new Set(['color', 'multicolor', 'url']);
    const TAG = /\[(\/?)([a-z][a-z0-9]*)(=[^\]\n]*)?\]/gi;

    function tagProblems(text) {
        const problems = [];
        const open = []; // [{ name, shown }]
        TAG.lastIndex = 0;
        let m;
        while ((m = TAG.exec(text)) !== null) {
            const [, slash, written, value] = m;
            const name = written.toLowerCase();
            // A mini icon wraps nothing, so it opens nothing.
            if (!slash && name === 'icon' && typeof window.isTextIconTag === 'function' && window.isTextIconTag(m[0])) continue;
            const known = PLAIN_TAGS.has(name) || VALUE_TAGS.has(name) || name === 'noauto';

            if (slash) {
                if (!known || value) { problems.push(`[/${written}] is not a format tag.`); continue; }
                const at = open.map(o => o.name).lastIndexOf(name);
                if (at < 0) { problems.push(`[/${written}] has no [${written}] before it.`); continue; }
                if (at < open.length - 1) {
                    const inner = open[open.length - 1].shown;
                    problems.push(`${inner} is still open at [/${written}]. Close ${inner} first.`);
                }
                open.splice(at, 1);
                continue;
            }

            if (!known) {
                if (value) problems.push(`[${written}] is not a format tag.`);
                continue;
            }
            // A tag missing its value, or with one it does not take, prints as typed, so it
            // opens nothing.
            const opens = name === 'noauto'
                ? (!value || value.toLowerCase() === '=all')
                : (VALUE_TAGS.has(name) ? !!value && value.length > 1 : !value);
            if (opens) open.push({ name, shown: `[${written}]` });
        }
        open.forEach(o => problems.push(`${o.shown} is never closed.`));
        return problems;
    }

    // Everything wrong with one text: each name once, with its FIX, then each tag.
    function writingIssues(text) {
        const value = String(text === null || text === undefined ? '' : text);
        const issues = [];
        const seen = new Set();
        nameMatches(value).forEach(m => {
            if (seen.has(m.name)) return;
            seen.add(m.name);
            issues.push({ fix: m.name, text: `"${m.name}" is ${m.character} in game.` });
        });
        tagProblems(value).forEach(text => issues.push({ text }));
        return issues;
    }
    window.writingIssues = writingIssues;

    // Fields in the Workspace and the Combo Row window, less those that hold no page
    // text: a key Find and Replace skips, and the editor's own controls.
    const FIELD_SCOPE = '#interactive-builder, #combo-row-modal';
    const NOT_TEXT = '.cp-hex, [data-nstyle-label], .format-jump-search, .block-folder-name-input, #profile-image-input, #new-move-id';

    function isCheckedField(el) {
        if (!el || !el.matches || !el.matches('textarea, input[type="text"]')) return false;
        if (!el.closest(FIELD_SCOPE) || el.matches(NOT_TEXT)) return false;
        const key = el.getAttribute('data-field') || el.getAttribute('data-card-field') || el.getAttribute('data-combo-field');
        return !(key && typeof window.isEditorSkipField === 'function' && window.isEditorSkipField(key));
    }

    const boxOf = new WeakMap(); // field -> its line
    const fieldOf = new WeakMap(); // line -> its field

    // A table cell's line goes under the table's buttons, so typing never moves them.
    function anchorFor(field) {
        const table = field.closest('.block-table-wrapper');
        if (!table) return field;
        const actions = table.nextElementSibling;
        return actions && actions.matches('.block-table-actions-row') ? actions : table;
    }

    function showIssues(field) {
        const issues = writingIssues(field.value);
        let box = boxOf.get(field);
        if (box && !box.isConnected) box = null;
        if (!issues.length) {
            if (box) box.remove();
            boxOf.delete(field);
            return;
        }
        if (!box) {
            box = document.createElement('div');
            box.className = 'writing-checks';
            box.setAttribute('data-writing-checks', '');
            anchorFor(field).insertAdjacentElement('afterend', box);
            boxOf.set(field, box);
            fieldOf.set(box, field);
        }
        box.innerHTML = issues.map(i => `
            <div class="writing-check"><span>${window.escapeHtml(i.text)}</span>${i.fix
                ? `<button type="button" class="btn-sys btn-sys-yellow writing-check-fix" data-writing-fix="${window.escapeHtml(i.fix)}">FIX</button>`
                : ''}</div>`).join('');
    }

    // Every occurrence, through the field's own input handler, so each surface stores
    // it as typing. The caret stays where it was.
    function fixName(field, name) {
        const value = field.value;
        const matches = nameMatches(value).filter(m => m.name === name);
        if (!matches.length) return;
        const caret = field.selectionStart === null ? value.length : field.selectionStart;
        let out = '';
        let from = 0;
        let shift = 0;
        matches.forEach(m => {
            out += value.slice(from, m.index) + m.character;
            from = m.index + m.name.length;
            if (m.index < caret) shift += m.character.length - m.name.length;
        });
        field.value = out + value.slice(from);
        field.focus();
        field.setSelectionRange(caret + shift, caret + shift);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Capture: some of the editor's handlers stop the event first.
    document.addEventListener('input', (e) => {
        if (isCheckedField(e.target)) showIssues(e.target);
    }, true);

    // FIX keeps the focus, and the toolbar's remembered selection, in the field.
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest && e.target.closest('[data-writing-fix]')) e.preventDefault();
    });
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-writing-fix]');
        if (!btn) return;
        const field = fieldOf.get(btn.closest('[data-writing-checks]'));
        if (field && field.isConnected) fixName(field, btn.getAttribute('data-writing-fix'));
    });

    // At Submit, only text this submission adds or changes: a string already on the
    // page as loaded is somebody else's, or moved, not written.
    function changedIssues() {
        const root = window.editorMasterDescData || window.currentEditorDescData;
        if (!root || typeof window.walkEditorStrings !== 'function') return [];
        const before = window.originalCloudMasterDesc || window.originalCloudDescData;
        const old = new Set();
        if (before) window.walkEditorStrings(before, [], (value) => old.add(value));
        const found = [];
        window.walkEditorStrings(root, [], (value, path) => {
            if (old.has(value)) return;
            writingIssues(value).forEach(i => found.push({ where: window.describeEditorPath(root, path), text: i.text }));
        });
        return found;
    }

    /**
     * True to carry on and send, false to go back. True at once when there is
     * nothing to show.
     */
    window.confirmWritingChecks = function () {
        const found = changedIssues();
        if (!found.length) return Promise.resolve(true);

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'editor-modal-overlay modal-warning writing-checks-modal';
            overlay.innerHTML = `
                <div class="editor-modal-box auth-modal-box" role="dialog" aria-modal="true" aria-labelledby="writing-checks-title">
                    <div class="auth-header"><h3 id="writing-checks-title">CHECK BEFORE SENDING</h3></div>
                    <div class="auth-body">
                        <p class="modal-prompt-text">${found.length === 1 ? '1 thing' : `${found.length} things`} to check before sending:</p>
                        <ul class="writing-checks-list">${found.map(f => `
                            <li><span class="writing-checks-where">${window.escapeHtml(f.where)}:</span> ${window.escapeHtml(f.text)}</li>`).join('')}
                        </ul>
                        <div class="modal-actions-centered">
                            <button type="button" class="btn-sys btn-sys-regular" data-writing-back>GO BACK</button>
                            <button type="button" class="btn-sys btn-sys-yellow" data-writing-send>SEND ANYWAY</button>
                        </div>
                    </div>
                </div>`;

            const onKey = (e) => { if (e.key === 'Escape') done(false); };
            function done(send) {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(send);
            }
            overlay.addEventListener('click', (e) => {
                if (e.target.closest('[data-writing-back]')) done(false);
                else if (e.target.closest('[data-writing-send]')) done(true);
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(overlay);
            overlay.querySelector('[data-writing-back]').focus();
        });
    };
})();
