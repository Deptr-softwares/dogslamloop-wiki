/**
 * Dogslamloop Wiki - Emojis in posts (v1.1, batch 8.5)
 *
 * Two kinds, both drawn as pictures in a post's text (owner, 2026-10-21):
 *
 *   - The wiki's own, :HmmCat: and the rest, named exactly as the emojis on
 *     the Discord server, so the relay can turn one into the other. A post
 *     stores the name; the relay's CUSTOM_EMOJI
 *     (supabase/functions/_shared/discord-relay-core.mjs) lists the same ones.
 *   - Every standard emoji, in Discord's look: Twemoji's art, pinned, from
 *     jsDelivr. A post stores the character itself, so it reaches Discord as
 *     it is, and a device without the art still shows its own.
 *
 * Post text is the most attacker-reachable string on the site
 * (js/discussions.js), so nothing here uses innerHTML: words go in as text
 * nodes, and each picture is an <img> whose address comes from the list
 * below or from code points, never from the text as written.
 */

(function () {
    // Named exactly as on the Discord server, none animated (owner,
    // 2026-10-21).
    const CUSTOM = [
        { name: 'HmmCat', file: 'medias/images/HmmCat.webp' },
        { name: 'darkCat', file: 'medias/images/darkCat.webp' },
        { name: 'friedCat', file: 'medias/images/friedCat.webp' },
        { name: 'lightCat', file: 'medias/images/lightCat.webp' },
        { name: 'Boomcat', file: 'medias/images/Boomcat.webp' },
    ];
    const BY_NAME = new Map(CUSTOM.map(e => [e.name, e]));

    // The same version data/emoji.json was cut to (scripts/build-emoji-data.js),
    // so every emoji the picker offers has a picture here.
    const TWEMOJI_VERSION = '17.0.3';
    const TWEMOJI = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg/`;

    // A post of nothing but emojis shows them big, as Discord does, up to
    // Discord's own limit.
    const JUMBO_MAX = 30;

    // A standard emoji: a flag's letter pair, a keycap, or a character that is
    // an emoji by default (or asked to be one with U+FE0F), then an optional
    // skin tone, a tag sequence (England's flag) and parts joined by U+200D.
    // A character that is text by default, such as © or ™, stays text.
    const PART = '(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?';
    const JOINED = '(?:\\u200D(?:\\p{Extended_Pictographic}\\uFE0F?|\\p{Emoji_Presentation})\\p{Emoji_Modifier}?)*';
    const STANDARD = `\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${PART}(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?${JOINED}`;
    const NAMES = CUSTOM.map(e => e.name).join('|');
    let TOKEN;
    try {
        TOKEN = new RegExp(`:(${NAMES}):|${STANDARD}`, 'gu');
    } catch (e) {
        // A browser too old for Unicode property escapes. Deliberately quiet:
        // the wiki's own emojis still draw, and the standard ones stay the
        // device's.
        TOKEN = new RegExp(`:(${NAMES}):`, 'g');
    }

    // Twemoji's file naming (grabTheRightIcon in its source): code points in
    // lowercase hex joined by '-', U+FE0F dropped unless the sequence has a
    // U+200D. One file breaks the rule (eye in speech bubble), so the name with
    // no U+FE0F at all is the second try. Same order as the build script.
    const hex = (text) => Array.from(text).map(c => c.codePointAt(0).toString(16)).join('-');
    function twemojiNames(text) {
        const stripped = hex(text.replace(/️/g, ''));
        return text.includes('‍') ? [hex(text), stripped] : [stripped];
    }

    // One emoji as a picture. A custom one by `name`; a standard one by its
    // characters, which are also its alt text, so copying the post copies the
    // emoji. A picture that will not load becomes its text again. `deferred`
    // leaves the address in data-src for the picker to set when it is seen.
    function picture(text, name, deferred) {
        const img = document.createElement('img');
        img.className = name ? 'emoji emoji-custom' : 'emoji';
        img.draggable = false;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        let src;
        if (name) {
            img.alt = `:${name}:`;
            img.title = `:${name}:`;
            img.addEventListener('error', () => img.replaceWith(document.createTextNode(`:${name}:`)), { once: true });
            src = window.getRootPath() + BY_NAME.get(name).file;
        } else {
            img.alt = text;
            const tries = twemojiNames(text);
            img.addEventListener('error', () => {
                tries.shift();
                if (tries.length) img.src = `${TWEMOJI}${tries[0]}.svg`;
                // Newer than Twemoji's art: the device draws it.
                else img.replaceWith(document.createTextNode(text));
            });
            src = `${TWEMOJI}${tries[0]}.svg`;
        }
        if (deferred) img.dataset.src = src;
        else img.src = src;
        return img;
    }

    // A post's text into an element: words as text nodes, line breaks as
    // <br>, emojis as pictures. Marks the element emoji-jumbo when it holds
    // nothing but emojis and spaces.
    function renderText(node, text) {
        node.textContent = '';
        let count = 0;
        let words = false;
        const addText = (s) => {
            if (!s) return;
            node.appendChild(document.createTextNode(s));
            if (s.trim()) words = true;
        };
        String(text == null ? '' : text).split('\n').forEach((line, i) => {
            if (i > 0) node.appendChild(document.createElement('br'));
            let last = 0;
            for (const m of line.matchAll(TOKEN)) {
                addText(line.slice(last, m.index));
                node.appendChild(picture(m[0], m[1]));
                count++;
                last = m.index + m[0].length;
            }
            addText(line.slice(last));
        });
        node.classList.toggle('emoji-jumbo', count > 0 && !words && count <= JUMBO_MAX);
    }

    // --- THE PICKER ---
    //
    // The wiki's own first, then Unicode's groups, with a search over names.
    // A picture gets its address only when it scrolls into the picker's own
    // view. loading="lazy" alone is not enough inside a scrolling box: opening
    // the picker fetched 744 pictures with it (measured 2026-10-21).

    const SEARCH_MAX = 120;

    function loadData() {
        return window.fetchJson(`${window.getRootPath()}data/emoji.json`, { cache: true });
    }

    function cell(insert, label, pictureNode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-cell';
        btn.dataset.emojiInsert = insert;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.appendChild(pictureNode);
        return btn;
    }

    const customCell = (e) => cell(`:${e.name}:`, `:${e.name}:`, picture(null, e.name, true));
    const standardCell = ([char, name]) => cell(char, name, picture(char, null, true));

    function section(title, cells) {
        const box = document.createElement('section');
        box.className = 'emoji-section';
        const heading = document.createElement('h4');
        heading.className = 'emoji-section-title';
        heading.textContent = title;
        const grid = document.createElement('div');
        grid.className = 'emoji-grid';
        cells.forEach(c => grid.appendChild(c));
        box.append(heading, grid);
        return box;
    }

    // Where the next pick goes in each box, kept here rather than read off the
    // box: after a real click writes into a box that is not focused, Chrome
    // moves its caret back to the start a moment later (seen 2026-10-21; a
    // write inside one script task keeps it). Kept from when the picker opens
    // and whenever the box loses focus, moved on by each pick, and handed back
    // to the browser when the box is focused again.
    const carets = new WeakMap();

    function keepCaret(area) {
        carets.set(area, [area.selectionStart, area.selectionEnd]);
        if (area.dataset.emojiCaret === 'kept') return;
        area.dataset.emojiCaret = 'kept';
        area.addEventListener('blur', () => carets.set(area, [area.selectionStart, area.selectionEnd]));
        area.addEventListener('focus', () => carets.delete(area));
    }

    // At the caret, replacing any selection, and within the box's own length
    // limit, which a script's write would otherwise skip past.
    function insertAt(area, text) {
        const kept = document.activeElement === area ? null : carets.get(area);
        const length = area.value.length;
        const [start, end] = (kept || [area.selectionStart, area.selectionEnd]).map(n => Math.min(Number(n) || 0, length));
        if (area.maxLength > 0 && length - (end - start) + text.length > area.maxLength) return false;
        area.setRangeText(text, start, end, 'end');
        carets.set(area, [start + text.length, start + text.length]);
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function closeAll() {
        document.querySelectorAll('.emoji-picker').forEach(panel => {
            if (panel.emojiToggle) panel.emojiToggle.setAttribute('aria-expanded', 'false');
            if (panel.emojiSeen) panel.emojiSeen.disconnect();
            panel.remove();
        });
    }

    function buildPicker(area, toggle) {
        const panel = document.createElement('div');
        panel.className = 'emoji-picker';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Emojis');
        panel.emojiToggle = toggle;

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'editor-input emoji-search';
        search.placeholder = 'Search emojis';
        search.setAttribute('aria-label', 'Search emojis');
        search.autocomplete = 'off';

        const tabs = document.createElement('div');
        tabs.className = 'emoji-tabs';
        const scroll = document.createElement('div');
        scroll.className = 'emoji-scroll';
        const results = document.createElement('div');
        results.className = 'emoji-grid emoji-results';
        results.hidden = true;
        const note = document.createElement('p');
        note.className = 'emoji-note';
        note.hidden = true;
        const showNote = (text) => { note.textContent = text; note.hidden = !text; };

        const show = (img) => { img.src = img.dataset.src; delete img.dataset.src; };
        const seen = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(entries => entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                seen.unobserve(entry.target);
                show(entry.target);
            }), { root: scroll, rootMargin: '96px 0px' })
            : null;
        panel.emojiSeen = seen;
        const watch = (box) => box.querySelectorAll('img[data-src]').forEach(img => (seen ? seen.observe(img) : show(img)));

        const credit = document.createElement('p');
        credit.className = 'emoji-credit';
        credit.append('Emoji art: Twemoji, by Twitter and contributors, ');
        const licence = document.createElement('a');
        licence.href = 'https://creativecommons.org/licenses/by/4.0/';
        licence.target = '_blank';
        licence.rel = 'noopener';
        licence.textContent = 'CC-BY 4.0';
        credit.appendChild(licence);

        const addGroup = (title, icon, cells) => {
            const box = section(title, cells);
            scroll.appendChild(box);
            watch(box);
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'emoji-tab';
            tab.title = title;
            tab.setAttribute('aria-label', title);
            tab.appendChild(icon);
            // .emoji-scroll is positioned, so offsetTop is measured from it.
            tab.addEventListener('click', () => { scroll.scrollTop = box.offsetTop; });
            tabs.appendChild(tab);
        };
        scroll.appendChild(results);
        addGroup('Dogslamloop', picture(null, 'Boomcat'), CUSTOM.map(customCell));
        panel.append(search, tabs, scroll, note, credit);

        let groups = [];
        let loadError = '';
        loadData().then(data => {
            groups = (data && Array.isArray(data.groups)) ? data.groups : [];
            groups.forEach(g => addGroup(g.name, picture(g.emoji[0][0]), g.emoji.map(standardCell)));
            if (search.value.trim()) search.dispatchEvent(new Event('input'));
        }).catch(e => {
            console.error('[Emoji] The emoji list could not be loaded:', e);
            loadError = 'The standard emojis could not be loaded. The Dogslamloop ones still work.';
            showNote(loadError);
        });

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            const searching = q !== '';
            tabs.hidden = searching;
            scroll.querySelectorAll('.emoji-section').forEach(s => { s.hidden = searching; });
            if (seen) results.querySelectorAll('img[data-src]').forEach(img => seen.unobserve(img));
            results.textContent = '';
            results.hidden = !searching;
            scroll.scrollTop = 0;
            if (!searching) { showNote(loadError); return; }
            const found = [
                ...CUSTOM.filter(e => e.name.toLowerCase().includes(q)).map(customCell),
                ...groups.flatMap(g => g.emoji).filter(([, name]) => name.toLowerCase().includes(q))
                    .slice(0, SEARCH_MAX).map(standardCell),
            ];
            found.forEach(c => results.appendChild(c));
            watch(results);
            showNote(found.length ? loadError : 'No emoji by that name.');
        });

        panel.addEventListener('click', (e) => {
            const pick = e.target.closest('[data-emoji-insert]');
            if (pick && !insertAt(area, pick.dataset.emojiInsert)) showNote('The post is at its length limit.');
        });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            closeAll();
            toggle.focus();
        });
        return { panel, search };
    }

    // Opens the picker at the end of `form`, writing into `area`, or closes
    // it. One is open at a time on a page.
    function togglePicker(form, area, toggle) {
        const open = form.querySelector(':scope > .emoji-picker');
        closeAll();
        if (open) return;
        keepCaret(area);
        const { panel, search } = buildPicker(area, toggle);
        form.appendChild(panel);
        toggle.setAttribute('aria-expanded', 'true');
        // Not on a touch screen, where focusing would throw the keyboard over
        // the picker.
        if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) search.focus();
    }

    window.DslEmoji = { CUSTOM, TWEMOJI_VERSION, renderText, togglePicker };
})();
