/**
 * The inline text diff, shared by the review queue and the editor's diff mode,
 * so the two screens cannot disagree about what a change is.
 * @since v0.20
 * @touches escapeHtml (site_utils.js), the block renderer (page_render.js)
 * @watch the text stays raw and the change boundaries are control-character
 *   markers: the renderer escapes the text once, as it does all content, the
 *   markers pass through escapeHtml untouched, and resolveDiffMarkers then swaps
 *   them for <ins> and <del>. No Block can opt out of escaping. Never put diffed
 *   text in an attribute: the markers would become tags inside it.
 * @see docs/editor.md
 */
(function () {
    // Escape sequences on purpose: the raw control characters are invisible bytes
    // that some tools treat as binary.
    const ADD_OPEN = '\u0011';
    const ADD_CLOSE = '\u0012';
    const DEL_OPEN = '\u0013';
    const DEL_CLOSE = '\u0014';
    const ANY = /[\u0011-\u0014]/g;

    window.DIFF_MARKERS = Object.freeze({
        addOpen: ADD_OPEN, addClose: ADD_CLOSE,
        delOpen: DEL_OPEN, delClose: DEL_CLOSE,
    });

    /**
     * Turns diffTextLCS's markers into <ins> and <del> after the renderer escaped
     * everything around them, once per diff container. The tags are two fixed
     * strings with no contributor value, so a forged marker cannot inject anything.
     */
    window.resolveDiffMarkers = function (el) {
        if (!el || !el.innerHTML) return;
        if (!ANY.test(el.innerHTML)) { ANY.lastIndex = 0; return; }
        ANY.lastIndex = 0;

        el.innerHTML = el.innerHTML
            .split(ADD_OPEN).join('<ins class="diff-add">')
            .split(ADD_CLOSE).join('</ins>')
            .split(DEL_OPEN).join('<del class="diff-del">')
            .split(DEL_CLOSE).join('</del>');
    };

    window.diffTextLCS = function (oldStr, newStr) {
        // Contributor text cannot carry the markers, or a submission could open a tag
        // this never opened. Stripped: they are control characters, nothing real is lost.
        const clean = (s) => String(s || '').replace(ANY, '');
        oldStr = clean(oldStr);
        newStr = clean(newStr);

        if (oldStr === newStr) return newStr;
        if (!oldStr) return `${ADD_OPEN}${newStr}${ADD_CLOSE}`;
        if (!newStr) return `${DEL_OPEN}${oldStr}${DEL_CLOSE}`;

        const a = oldStr.split(/(\s+)/).filter(val => val.length > 0);
        const b = newStr.split(/(\s+)/).filter(val => val.length > 0);
        const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1] + 1;
                else matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }

        let i = a.length, j = b.length;
        const rawOps = [];

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
                rawOps.unshift({ type: 'eq', text: a[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
                rawOps.unshift({ type: 'ins', text: b[j - 1] });
                j--;
            } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
                rawOps.unshift({ type: 'del', text: a[i - 1] });
                i--;
            }
        }

        for (let k = 1; k < rawOps.length - 1; k++) {
            if (rawOps[k].type === 'eq' && (!rawOps[k].text.trim() || rawOps[k].text.length === 1)) {
                if (rawOps[k - 1].type !== 'eq' && rawOps[k + 1].type !== 'eq') {
                    rawOps[k].type = 'trivial';
                }
            }
        }

        let finalHtml = '';
        let currentDels = '';
        let currentInss = '';

        const flushEdits = () => {
            if (currentDels) finalHtml += `${DEL_OPEN}${currentDels}${DEL_CLOSE}`;
            if (currentInss) finalHtml += `${ADD_OPEN}${currentInss}${ADD_CLOSE}`;
            currentDels = '';
            currentInss = '';
        };

        for (const op of rawOps) {
            if (op.type === 'eq') {
                flushEdits();
                finalHtml += op.text;
            } else if (op.type === 'del') {
                currentDels += op.text;
            } else if (op.type === 'ins') {
                currentInss += op.text;
            } else if (op.type === 'trivial') {
                currentDels += op.text;
                currentInss += op.text;
            }
        }
        flushEdits();

        return finalHtml;
    };
})();
