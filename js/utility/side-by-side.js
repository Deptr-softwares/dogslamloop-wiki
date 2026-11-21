/**
 * Dogslamloop Wiki - The side-by-side diff, shared by the Overseer's DIFF VIEW
 * (js/overseer/admin-preview.js) and the editor's VIEW DIFF (js/editor/core/editor-sync.js)
 *
 * Owner's Overseer card (v1.2): "turning the navigation bar to an overlay that
 * can pop out and in, and then fit in the review panel that page current state
 * with all the red parts, and the current submission with all the green
 * parts". Picked from mockups on 2026-11-18: the whole page, side by side,
 * rows level with each other.
 *
 * HOW. Each caller draws both versions with the site's own renderers, the
 * ones the reader's page and the PENDING / LIVE views use, and hands the two
 * results to mount(). So each side looks exactly as the page would, and no
 * block type needs a diff of its own. Then:
 *
 *   1. Each side is cut into units: the smallest blocks that sit one above
 *      the other (a paragraph, a list item, a heading, a table, a Frame
 *      Track). A block holding inline content is one unit, so is anything
 *      that only makes sense whole (a table, a clip, an accordion).
 *   2. Units are paired: identical ones first (longest common subsequence),
 *      then, between two identical pairs, units of the same kind in order.
 *   3. Changes are marked: changed words red on the left and green on the
 *      right; a unit only one side has, outlined in its side's colour; a unit
 *      whose words match but whose picture changed (a clip, a colour, a
 *      Frame Track bar), outlined on both sides.
 *   4. The higher unit of each pair is pushed down until the two are level,
 *      so a change sits beside what it replaces. A unit standing in a row
 *      moves with its row. The gap left opposite a unit only one side has is
 *      the labelled slot ("Not on the live page").
 *
 * Text is never re-rendered here. Changed words are wrapped where they stand,
 * in elements this file creates, so nothing a contributor wrote goes through
 * innerHTML a second time. Labels are fixed strings set with textContent.
 */
(function () {
    // Whole units, never cut further: a table's rows only line up as a
    // table, a Frame Track's bars only beside its ruler, and an accordion or
    // a clip is one thing to a reader.
    const ATOMIC = [
        'table', 'figure', 'img', 'video', 'iframe', 'picture', 'svg', 'canvas',
        'details', 'pre', 'blockquote', 'button', 'select', 'input', 'textarea', 'hr',
        '.frame-scroll-wrapper', '.skill-media-wrapper', '.sbs-spacer',
    ].join(',');
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
    // A box of its own, even when it flows inline: a section's title is an
    // inline-block above its blocks (Layout.css), and a row of chips or
    // badges holds nothing but inline-blocks.
    const BLOCKISH = new Set([
        'block', 'flow-root', 'flex', 'grid', 'list-item', 'table',
        'inline-block', 'inline-flex', 'inline-grid', 'inline-table',
    ]);
    // A picture or a clip between two paragraphs flows inline but stands on
    // its own line (an image block with no caption is a bare <img>).
    const REPLACED = new Set(['IMG', 'VIDEO', 'IFRAME', 'CANVAS', 'PICTURE', 'svg', 'SVG']);
    const DESCEND = new Set(['block', 'flow-root', 'flex', 'grid', 'list-item']);
    // Past this many words a side, a unit is outlined instead of diffed word by
    // word: the comparison table grows with the product of the two lengths
    // (1,500 x 1,500 is about 4.5 MB).
    const WORD_LIMIT = 1500;
    // Where the Overseer and the editor go to one column (admin.css,
    // editor.css). Stacked, there is nothing to line up.
    const STACK_QUERY = '(max-width: 900px)';

    const DEFAULT_LABELS = {
        left: 'LIVE NOW',
        leftHint: 'red: goes',
        right: 'THIS SUBMISSION',
        rightHint: 'green: comes',
        onlyRight: 'Not on the live page',
        onlyLeft: 'Removed by this submission',
    };

    const cs = (el) => window.getComputedStyle(el);
    const hasLayout = (el) => el.getClientRects().length > 0;

    // --- 1. UNITS ---

    function isContainer(el) {
        if (el.matches(ATOMIC)) return false;
        if (!DESCEND.has(cs(el).display)) return false;
        let blockChild = false;
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.nodeValue.trim()) return false;
                continue;
            }
            if (node.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(node.tagName)) continue;
            const display = cs(node).display;
            if (display === 'none') continue;
            if (!BLOCKISH.has(display) && display !== 'contents' && !REPLACED.has(node.tagName)) return false;
            blockChild = true;
        }
        return blockChild;
    }

    // A hidden element (another Micro Variant, a closed Section Box tab) is
    // kept as one unit: it cannot be lined up, but its words are still
    // compared, so its tab can say it changed and the marks are there when a
    // reviewer opens it.
    function collectUnits(root) {
        const units = [];
        const visit = (el) => {
            if (SKIP_TAGS.has(el.tagName)) return;
            const display = cs(el).display;
            if (display === 'contents') { Array.from(el.children).forEach(visit); return; }
            if (display !== 'none' && isContainer(el)) { Array.from(el.children).forEach(visit); return; }
            units.push(el);
        };
        Array.from(root.children).forEach(visit);
        return units;
    }

    const kindOf = (el) => `${el.tagName}.${el.classList[0] || ''}`;

    function mediaOf(el) {
        const list = [];
        const add = (node) => {
            const src = node.getAttribute('data-lazy-src') || node.getAttribute('src');
            if (src) list.push(src);
        };
        if (el.matches('img, video, source, iframe')) add(el);
        el.querySelectorAll('img, video, source, iframe').forEach(add);
        return list.join(' ');
    }

    // What a reader would see, without what only the page's own bookkeeping
    // sets: ids (renamed on the left), and where a lazy clip happens to be in
    // loading. Two units with the same signature are the same unit.
    function signatureOf(el) {
        const html = el.outerHTML
            .replace(/\s(?:id|src|data-lazy-src|poster|loading|aria-controls|aria-labelledby)="[^"]*"/g, '')
            // A clip's shape comes from the stills list (js/pages/core/description.js),
            // which can reach one side before the other.
            .replace(/aspect-ratio:[^;"]*;?\s*/g, '')
            .replace(/\sstyle=""/g, '')
            .replace(/\s+/g, ' ');
        return `${html}\u0001${mediaOf(el)}`;
    }

    // --- 2. PAIRING ---

    // Longest common subsequence over two arrays, by a key. Returns the
    // matched index pairs in order.
    function lcsPairs(a, b, keyA, keyB) {
        const n = a.length;
        const m = b.length;
        if (!n || !m) return [];
        const width = m + 1;
        // Uint16 holds any length here: the longest list compared is
        // WORD_LIMIT words or one page's units.
        const table = new Uint16Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                table[i * width + j] = keyA[i] === keyB[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
            }
        }
        const pairs = [];
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (keyA[i] === keyB[j]) { pairs.push([i, j]); i++; j++; }
            else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
            else j++;
        }
        return pairs;
    }

    // The two sides as one ordered sequence of rows: a pair (same or changed)
    // or a unit only one side has.
    function align(left, right) {
        const sigL = left.map(signatureOf);
        const sigR = right.map(signatureOf);
        const anchors = lcsPairs(left, right, sigL, sigR);
        anchors.push([left.length, right.length]);

        const seq = [];
        let li = 0;
        let ri = 0;
        anchors.forEach(([ai, aj]) => {
            const gapL = left.slice(li, ai);
            const gapR = right.slice(ri, aj);
            const kindPairs = lcsPairs(gapL, gapR, gapL.map(kindOf), gapR.map(kindOf));
            let x = 0;
            let y = 0;
            kindPairs.concat([[gapL.length, gapR.length]]).forEach(([pi, pj]) => {
                while (x < pi) seq.push({ type: 'left', l: gapL[x++] });
                while (y < pj) seq.push({ type: 'right', r: gapR[y++] });
                if (pi < gapL.length && pj < gapR.length) {
                    seq.push({ type: 'pair', l: gapL[pi], r: gapR[pj], same: false });
                    x = pi + 1;
                    y = pj + 1;
                }
            });
            if (ai < left.length && aj < right.length) {
                seq.push({ type: 'pair', l: left[ai], r: right[aj], same: true });
            }
            li = ai + 1;
            ri = aj + 1;
        });
        return seq;
    }

    // --- 3. MARKING ---

    function wordTokens(root) {
        const tokens = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => (node.parentElement && SKIP_TAGS.has(node.parentElement.tagName)
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        let node;
        while ((node = walker.nextNode())) {
            const re = /\S+/g;
            let match;
            while ((match = re.exec(node.nodeValue))) {
                tokens.push({ node, start: match.index, end: match.index + match[0].length, text: match[0] });
            }
        }
        return tokens;
    }

    // Wraps the given tokens in <del> or <ins>. Neighbouring changed words in
    // one text node become one mark, spaces between them included, so a
    // rewritten sentence reads as one change rather than a row of boxes.
    function wrapTokens(tokens, tag, cls) {
        const byNode = new Map();
        tokens.forEach(t => {
            if (!byNode.has(t.node)) byNode.set(t.node, []);
            byNode.get(t.node).push(t);
        });
        byNode.forEach((list, node) => {
            const text = node.nodeValue;
            const ranges = [];
            list.sort((a, b) => a.start - b.start).forEach(t => {
                const last = ranges[ranges.length - 1];
                if (last && !text.slice(last.end, t.start).trim()) last.end = t.end;
                else ranges.push({ start: t.start, end: t.end });
            });
            const frag = document.createDocumentFragment();
            let at = 0;
            ranges.forEach(r => {
                if (r.start > at) frag.appendChild(document.createTextNode(text.slice(at, r.start)));
                const mark = document.createElement(tag);
                mark.className = cls;
                mark.textContent = text.slice(r.start, r.end);
                frag.appendChild(mark);
                at = r.end;
            });
            if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
            node.parentNode.replaceChild(frag, node);
        });
    }

    // Marks the words that differ. Returns false when it could not tell
    // (too long to compare, or the same words), so the caller outlines the
    // unit instead.
    function markWords(l, r) {
        const a = wordTokens(l);
        const b = wordTokens(r);
        if (a.length > WORD_LIMIT || b.length > WORD_LIMIT) return false;
        const pairs = lcsPairs(a, b, a.map(t => t.text), b.map(t => t.text));
        if (pairs.length === a.length && pairs.length === b.length) return false;
        const keptA = new Set(pairs.map(p => p[0]));
        const keptB = new Set(pairs.map(p => p[1]));
        wrapTokens(a.filter((_, i) => !keptA.has(i)), 'del', 'diff-del');
        wrapTokens(b.filter((_, i) => !keptB.has(i)), 'ins', 'diff-add');
        return true;
    }

    const holdsChange = (el) => el.matches('.sbs-changed, .sbs-gone, .sbs-new')
        || !!el.querySelector('del.diff-del, ins.diff-add, .sbs-changed');

    // The tab that would show a hidden change: a Micro Variant's button
    // (view-X is opened by tab-X, js/pages/core/framedata.js) or a Section Box's
    // (data-sbox-panel N by data-sbox-tab N, js/pages/core/description.js).
    function tabFor(hidden, col) {
        const view = hidden.closest('.view-section');
        if (view && view.id) {
            const btn = col.querySelector(`#${CSS.escape(view.id.replace(/view-/, 'tab-'))}`);
            if (btn) return btn;
        }
        const panel = hidden.closest('[data-sbox-panel]');
        if (panel) {
            const box = panel.closest('.sbox');
            const n = panel.getAttribute('data-sbox-panel');
            if (box) return box.querySelector(`:scope > .sbox-tabs > [data-sbox-tab="${CSS.escape(n)}"]`);
        }
        return null;
    }

    // --- 4. LEVELLING ---

    function makeSpacer(parent, height, text) {
        const sp = document.createElement(/^(UL|OL)$/.test(parent.tagName) ? 'li' : 'div');
        sp.className = text ? 'sbs-spacer sbs-slot' : 'sbs-spacer';
        sp.setAttribute('aria-hidden', 'true');
        sp.style.height = `${height}px`;
        // Only a slot tall enough to read gets its words.
        if (text && height >= 28) sp.textContent = text;
        return sp;
    }

    window.SideBySide = {
        /**
         * Puts two drawn versions side by side in `host` and marks the
         * difference. `left` and `right` are elements holding each version's
         * drawn content, already finished (no renderer still writing into
         * them), with each one's shortcodes already styled.
         *
         * opts.labels overrides DEFAULT_LABELS; opts.dataChanged says the
         * caller's data differs, for the note when nothing visible does;
         * opts.extraButtons are put in the bar, opts.leadButtons first in it.
         */
        mount(host, left, right, opts = {}) {
            const labels = { ...DEFAULT_LABELS, ...(opts.labels || {}) };

            host.innerHTML = '';
            const root = document.createElement('div');
            root.className = 'sbs';

            const top = document.createElement('div');
            top.className = 'sbs-top';
            const bar = document.createElement('div');
            bar.className = 'sbs-bar';
            const count = document.createElement('span');
            count.className = 'sbs-count';
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'btn-sys btn-sys-purple sbs-next';
            next.textContent = '↓ NEXT CHANGE';
            bar.append(...(opts.leadButtons || []), count, next);
            (opts.extraButtons || []).forEach(b => bar.appendChild(b));

            const head = (side, title, hint) => {
                const h = document.createElement('div');
                h.className = `sbs-head sbs-head-${side}`;
                h.textContent = title;
                const small = document.createElement('small');
                small.textContent = hint;
                h.appendChild(small);
                return h;
            };
            const heads = document.createElement('div');
            heads.className = 'sbs-heads';
            heads.append(head('left', labels.left, labels.leftHint), head('right', labels.right, labels.rightHint));
            top.append(bar, heads);

            const note = document.createElement('p');
            note.className = 'sbs-note';
            note.hidden = true;

            const cols = document.createElement('div');
            cols.className = 'sbs-cols';
            const leftCol = document.createElement('div');
            leftCol.className = 'sbs-col sbs-col-left';
            const rightCol = document.createElement('div');
            rightCol.className = 'sbs-col sbs-col-right';
            leftCol.append(head('left', labels.left, labels.leftHint), left);
            rightCol.append(head('right', labels.right, labels.rightHint), right);
            cols.append(leftCol, rightCol);

            root.append(top, note, cols);
            host.appendChild(root);

            // Units need layout, so they are read once both halves are on the page.
            const seq = align(collectUnits(left), collectUnits(right));
            const partner = new Map();
            seq.forEach(e => {
                if (e.type === 'pair') { partner.set(e.l, e.r); partner.set(e.r, e.l); }
            });

            seq.forEach(e => {
                if (e.type === 'left') e.l.classList.add('sbs-gone');
                else if (e.type === 'right') e.r.classList.add('sbs-new');
                else if (!e.same && !markWords(e.l, e.r)) {
                    e.l.classList.add('sbs-changed');
                    e.r.classList.add('sbs-changed');
                }
            });

            // An accordion that holds a change opens on both sides.
            seq.forEach(e => {
                if (e.type !== 'pair' || e.same) return;
                if (e.l.tagName === 'DETAILS' && e.r.tagName === 'DETAILS') { e.l.open = true; e.r.open = true; }
            });

            // A change inside something hidden marks the tab that shows it.
            [[leftCol, 'l'], [rightCol, 'r']].forEach(([col, side]) => {
                seq.forEach(e => {
                    const el = side === 'l' ? e.l : e.r;
                    if (!el || hasLayout(el) || !holdsChange(el)) return;
                    const tab = tabFor(el, col);
                    if (tab) tab.classList.add('sbs-tab-changed');
                });
            });

            // One stop per run of changed rows, for NEXT CHANGE.
            const stops = [];
            let inRun = false;
            seq.forEach(e => {
                const changed = !(e.type === 'pair' && e.same);
                if (changed && !inRun) stops.push(e);
                inRun = changed;
            });
            const stopTarget = (e) => [e.r, e.l].find(el => el && hasLayout(el)) || null;

            const changes = stops.length;
            count.textContent = changes === 0 ? 'No change on this tab'
                : (changes === 1 ? '1 change on this tab' : `${changes} changes on this tab`);
            // A class, not the hidden attribute: .btn-sys sets a display,
            // which beats [hidden] (CLAUDE.md, Conventions).
            next.classList.toggle('hidden', changes === 0);
            if (changes === 0) {
                note.hidden = false;
                // The Overseer knows which tabs a submission touched; the
                // editor does not, so it gets the sentence that is true either way.
                if (opts.dataChanged === true) note.textContent = 'This tab changed in ways the page does not show (an editor folder or a setting, for example). CHANGE LIST shows where.';
                else if (opts.dataChanged === false) note.textContent = 'Nothing on this tab changed.';
                else note.textContent = 'Nothing this tab shows has changed.';
            }

            let at = -1;
            next.addEventListener('click', () => {
                const visible = stops.filter(e => stopTarget(e));
                if (!visible.length) return;
                at = (at + 1) % visible.length;
                next.textContent = `↓ NEXT CHANGE (${at + 1} of ${visible.length})`;
                stopTarget(visible[at]).scrollIntoView({
                    behavior: typeof window.scrollMotion === 'function' ? window.scrollMotion() : 'auto',
                    block: 'center',
                });
            });

            // --- levelling, and keeping it level ---
            const saved = new Map();
            const stacked = window.matchMedia(STACK_QUERY);
            const topOf = (el) => el.getBoundingClientRect().top;

            // Side by side rather than one above the other: a flex row, or a
            // grid of more than one column.
            const isRow = (el) => {
                const c = cs(el);
                if (/flex/.test(c.display)) return !c.flexDirection.startsWith('column');
                if (/grid/.test(c.display)) return c.gridTemplateColumns.trim().split(/\s+/).length > 1;
                return false;
            };
            // What moves to level a unit: the unit, or the row it stands in.
            // Pushing one item of a row down makes the whole row taller and
            // stretches the items beside it (a Micro Variant's tab bar,
            // 2026-11-21). The row moves as one instead, so the next pair in
            // the same two rows is usually level already.
            const moverOf = (el) => {
                while (el.parentElement !== left && el.parentElement !== right && isRow(el.parentElement)) el = el.parentElement;
                return el;
            };

            function clear() {
                cols.querySelectorAll('.sbs-spacer').forEach(sp => sp.remove());
                saved.forEach((margin, el) => { el.style.marginTop = margin; });
                saved.clear();
            }

            // Pushes `unit` down by `by` pixels, by moving it or its row
            // (moverOf): a spacer before that in ordinary flow, or a larger top
            // margin where a new element would become a flex item or a grid
            // cell. Then corrects for margins that collapsed differently once
            // the spacer was there.
            function push(unit, by, twin, slotText) {
                const el = moverOf(unit);
                const parent = el.parentElement;
                const display = cs(parent).display;
                if (/flex|grid/.test(display)) {
                    if (!saved.has(el)) saved.set(el, el.style.marginTop);
                    // At once, and for good: a margin that animates (many
                    // things here have `transition: all`) is still moving
                    // after it was measured, so the observer below would
                    // level again, mid-animation, every frame.
                    el.style.transition = 'none';
                    const base = parseFloat(cs(el).marginTop) || 0;
                    el.style.marginTop = `${base + by}px`;
                    const off = topOf(twin) - topOf(unit);
                    if (Math.abs(off) >= 1) el.style.marginTop = `${Math.max(0, base + by + off)}px`;
                    return;
                }
                const sp = makeSpacer(parent, by, slotText);
                parent.insertBefore(sp, el);
                const off = topOf(twin) - topOf(unit);
                if (Math.abs(off) >= 1) sp.style.height = `${Math.max(0, by + off)}px`;
            }

            let aligning = false;
            let heights = [0, 0];
            function level() {
                if (aligning) return;
                aligning = true;
                try {
                    clear();
                    if (stacked.matches) return;
                    let gapL = 0;
                    let gapR = 0;
                    seq.forEach(e => {
                        if (e.type === 'left') { if (hasLayout(e.l)) gapL++; return; }
                        if (e.type === 'right') { if (hasLayout(e.r)) gapR++; return; }
                        if (!hasLayout(e.l) || !hasLayout(e.r)) return;
                        const dl = topOf(e.l);
                        const dr = topOf(e.r);
                        if (Math.abs(dl - dr) >= 1) {
                            if (dl < dr) push(e.l, dr - dl, e.r, gapR && !gapL ? labels.onlyRight : '');
                            else push(e.r, dl - dr, e.l, gapL && !gapR ? labels.onlyLeft : '');
                        }
                        gapL = 0;
                        gapR = 0;
                    });
                    // Rows after the last pair: the shorter side ends in a slot,
                    // after its content rather than in it, since the content
                    // root can be a flex row (a system page's tab).
                    const diff = right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom;
                    if (Math.abs(diff) >= 1) {
                        if (diff > 0) leftCol.appendChild(makeSpacer(leftCol, diff, gapR && !gapL ? labels.onlyRight : ''));
                        else rightCol.appendChild(makeSpacer(rightCol, -diff, gapL && !gapR ? labels.onlyLeft : ''));
                    }
                } finally {
                    heights = [left.offsetHeight, right.offsetHeight];
                    aligning = false;
                }
            }

            // A clip or an image that loads, an accordion, a Micro Variant
            // switched: anything that changes a side's height lines the rows
            // up again. Heights equal to the ones the last levelling left
            // behind are its own doing and are ignored.
            let frame = 0;
            const observer = new ResizeObserver(() => {
                if (aligning) return;
                if (left.offsetHeight === heights[0] && right.offsetHeight === heights[1]) return;
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(level);
            });
            observer.observe(left);
            observer.observe(right);
            const onStack = () => level();
            stacked.addEventListener('change', onStack);

            // --- the two sides move together ---
            // A Micro Variant or Section Box tab pressed on one side is pressed
            // on the other, and an accordion opened on one opens on the other,
            // so the reader keeps comparing like with like.
            const unitOf = (el) => {
                for (let at = el; at && at !== cols; at = at.parentElement) {
                    if (partner.has(at)) return at;
                }
                return null;
            };
            const pathFrom = (unit, el) => {
                const path = [];
                for (let at = el; at !== unit; at = at.parentElement) {
                    path.unshift(Array.prototype.indexOf.call(at.parentElement.children, at));
                }
                return path;
            };
            const follow = (unit, path) => path.reduce((at, i) => (at ? at.children[i] : null), unit);
            const twinOf = (el) => {
                const unit = unitOf(el);
                if (!unit) return null;
                const twin = follow(partner.get(unit), pathFrom(unit, el));
                return twin && twin.tagName === el.tagName ? twin : null;
            };

            let syncing = false;
            cols.addEventListener('click', (ev) => {
                if (syncing) return;
                const btn = ev.target.closest('.skill-tab-bar > button, .sbox-tabs > .sbox-tab');
                if (!btn || !cols.contains(btn)) return;
                const twin = twinOf(btn);
                if (!twin) return;
                syncing = true;
                try { twin.click(); } finally { syncing = false; }
            });
            cols.addEventListener('toggle', (ev) => {
                const d = ev.target;
                if (!(d instanceof HTMLDetailsElement)) return;
                const twin = twinOf(d);
                if (twin && twin.open !== d.open) twin.open = d.open;
            }, true);

            level();

            return {
                changes,
                realign: level,
                destroy() {
                    observer.disconnect();
                    stacked.removeEventListener('change', onStack);
                    cancelAnimationFrame(frame);
                },
            };
        },
    };
})();
