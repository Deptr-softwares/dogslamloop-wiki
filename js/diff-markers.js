/**
 * Dogslamloop Wiki - The inline text diff, shared by the review queue and the
 * editor's diff mode
 *
 * Loaded by admin.html and edit.html. It was two copies until v0.20 batch 3:
 * this one in js/admin-diff.js, and an older one in js/editor-sync.js that
 * still returned real <ins>/<del> tags. Since v0.15 escaped every field in the
 * block renderer, those tags were escaped too, so a contributor's diff mode
 * printed `Hold the <del class="diff-del">dash</del><ins class="diff-add">jump</ins>`
 * as literal text while the reviewer's queue, running this copy, was correct.
 * One file, so the two screens can no longer disagree about what a change is.
 *
 * MARKERS, NOT MARKUP. The first version escaped the text and returned real
 * tags, which worked for as long as the block renderer passed content through
 * untouched. v0.15 item 1 closed a stored-XSS hole by escaping at every
 * innerHTML interpolation in js/description.js, and that escaped these tags a
 * second time. Correct escaping, correct diff, and they cancelled each other
 * out.
 *
 * The fix has to survive a renderer that escapes, without giving anything a way
 * to opt out of escaping: an opt-out flag would have to live on the block, and
 * blocks are contributor-submitted, so a crafted payload could set it.
 *
 * So the text stays RAW here and the boundaries are marked with control
 * characters. The renderer escapes the text exactly once, as it does for any
 * other content, and the markers pass through untouched because escapeHtml does
 * not alter them. resolveDiffMarkers then swaps them for the real tags.
 *
 * NEVER IN AN ATTRIBUTE. resolveDiffMarkers rewrites innerHTML as a string, so
 * a marker inside an attribute value would become a tag inside an attribute.
 * Renderers put diffed text in element content only.
 */
(function () {
    // Written as escape sequences on purpose. Typing the control characters
    // themselves leaves bytes that no editor shows and some tools treat as
    // binary - a literal NUL written that way once made git call a source file
    // binary in this repo.
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
     * Turns the markers left by diffTextLCS into real <ins>/<del> tags, after
     * the renderer has escaped everything around them.
     *
     * Takes an element and rewrites its innerHTML, so it runs once per rendered
     * diff container rather than per field. The tags it writes carry no
     * contributor-derived attributes - they are two fixed strings - so this
     * cannot become an injection point even if a marker were somehow forged.
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
        // Contributor text cannot be allowed to carry the markers themselves,
        // or a submission could open a tag this function never opened.
        // Stripped rather than escaped: these are control characters, so
        // nothing legitimate is lost.
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
