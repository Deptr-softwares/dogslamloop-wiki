/**
 * The Editor Playground, edit.html?playground: the real editor, where nothing is
 * sent anywhere, open to anyone. It starts as a blank character page, and Submit
 * becomes Pull, which copies any page's data in to edit.
 * @since v1.1
 * @touches window.editorPlayground, localStorage (its one draft), data/navigation.json
 * @watch what it cannot do is switched off where it happens: editor-core.js never
 *   wires Submit, editor-media.js refuses uploads, editor-config.js leaves out the
 *   Conflict Check, editor-drafts.js keeps its one draft apart from the page's.
 *   Runs while the page loads, before editor-core.js reads the address.
 * @see docs/editor.md
 */
(function () {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('playground')) return;

    const DRAFT_KEY = 'dsl_playground';
    // Not a page: the blank start is never fetched.
    const BLANK_ID = 'playground';
    // The page types edit.html opens; a tier list has its own editor.
    const PULLABLE_TYPES = new Set(['character', 'system', 'tool', 'gallery']);

    let draft = null;
    try {
        draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (e) {
        // Unreadable or blocked: the Playground opens blank.
        draft = null;
    }
    if (!draft || typeof draft.charId !== 'string' || !draft.desc_data) draft = null;

    const pulling = params.get('pull') === '1';

    // The draft decides what is open, not the address: one Playground, and an old
    // link must not open a second. A pull is the one time the address wins.
    if (!pulling) {
        params.set('page', draft ? draft.charId : BLANK_ID);
        params.set('type', draft && typeof draft.pageType === 'string' ? draft.pageType : 'character');
        params.set('tab', draft && typeof draft.tabId === 'string' ? draft.tabId : 'overview');
        params.delete('move');
    }
    // Every way the editor opens something real: a ticket, a draft, a state.
    ['char', 'editTicket', 'loadDraft', 'draftKey', 'mode'].forEach(name => params.delete(name));
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    window.editorPlayground = {
        draftKey: DRAFT_KEY,
        // The blank page has no row to fetch.
        blankPage: params.get('page') === BLANK_ID,
        draft: pulling ? null : draft,
    };

    const byId = (id) => document.getElementById(id);
    ['btn-drafts', 'btn-save'].forEach(id => { const node = byId(id); if (node) node.classList.add('hidden'); });
    // Removed, not hidden: it is about Submit, and initEditorChrome would show it
    // again.
    const tip = byId('editor-scope-tip');
    if (tip) tip.remove();

    const header = byId('editor-header');
    if (header) {
        const banner = document.createElement('p');
        banner.className = 'playground-banner';
        banner.setAttribute('role', 'note');
        banner.innerHTML = '<strong>PLAYGROUND.</strong> Nothing you do here is sent anywhere or seen by anyone. It stays in this browser until you press NEW.';
        header.insertAdjacentElement('afterend', banner);
    }

    const pullBtn = byId('submit-payload-btn');
    if (pullBtn) {
        pullBtn.textContent = 'Pull';
        pullBtn.dataset.tip = 'Copy any page into the Playground';
        pullBtn.classList.remove('btn-sys-green');
        pullBtn.classList.add('btn-sys-blue');
        pullBtn.addEventListener('click', openPullPicker);

        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.id = 'btn-playground-new';
        newBtn.className = 'btn-sys btn-sys-red';
        newBtn.dataset.tip = 'Clear the Playground and start from a blank page';
        newBtn.textContent = 'New';
        newBtn.addEventListener('click', startNew);
        pullBtn.insertAdjacentElement('beforebegin', newBtn);
    }

    function go(query) {
        window.location.href = `${window.location.pathname}?${query}`;
    }

    async function startNew() {
        const ok = await window.customConfirm(
            'Clear the Playground and start again from a blank character page?\n\nWhat is in the playground now is gone for good.',
            'START NEW', true);
        if (!ok) return;
        try {
            localStorage.removeItem(DRAFT_KEY);
        } catch (e) {
            window.editorAlert('This browser blocked clearing the Playground, so it could not start again.');
            return;
        }
        go('playground');
    }

    async function pullablePages() {
        const nav = await window.fetchNavigationData();
        const groups = [];
        Object.entries(nav || {}).forEach(([category, entries]) => {
            if (!Array.isArray(entries)) return;
            const pages = entries.filter(e => e && e.cms_config && e.cms_config.pageId
                && PULLABLE_TYPES.has(e.cms_config.pageType)
                // A locked page has no editor, the Playground's included.
                && e.cms_config.editRole !== 'locked'
                && e.cms_config.pageId !== 'editor_playground');
            if (pages.length) groups.push({ category, pages });
        });
        return groups;
    }

    async function openPullPicker() {
        let overlay = byId('playground-pull-modal');
        if (!overlay) {
            overlay = document.createElement('dialog');
            overlay.id = 'playground-pull-modal';
            overlay.className = 'site-dialog dialog-md';
            overlay.setAttribute('aria-labelledby', 'playground-pull-title');
            overlay.innerHTML = `
                <div class="dialog-header"><h3 id="playground-pull-title">PULL A PAGE</h3></div>
                <div class="dialog-body playground-pull-box">
                    <p class="playground-pull-hint">Copies the page as it is live now into the Playground. The page itself is not touched.</p>
                    <input type="search" class="editor-input" id="playground-pull-search" placeholder="Search pages..." autocomplete="off" aria-label="Search pages">
                    <div class="playground-pull-list" id="playground-pull-list"></div>
                </div>
                <div class="dialog-footer">
                    <button type="button" class="btn-sys btn-sys-regular" id="playground-pull-close" data-dialog-close>CLOSE</button>
                </div>`;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (e) => {
                const pick = e.target.closest('[data-pull-page]');
                if (pick) pullPage(pick.dataset.pullPage, pick.dataset.pullType, pick.dataset.pullName);
            });
            byId('playground-pull-search').addEventListener('input', filterPicker);
        }
        if (overlay.open) return;

        const list = byId('playground-pull-list');
        list.textContent = 'Loading pages...';
        // A page to pick and a search: a click outside closes it.
        window.openDialog(overlay, { light: true });
        byId('playground-pull-search').value = '';
        byId('playground-pull-search').focus();

        let groups;
        try {
            groups = await pullablePages();
        } catch (e) {
            console.error('[Playground] Could not read the page list:', e);
            list.textContent = 'The page list could not be loaded. Close this and try again.';
            return;
        }

        list.textContent = '';
        groups.forEach(({ category, pages }) => {
            const section = document.createElement('section');
            section.className = 'playground-pull-group';
            const title = document.createElement('h4');
            title.className = 'playground-pull-category';
            title.textContent = category;
            section.appendChild(title);
            pages.forEach(page => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn-sys btn-sys-regular playground-pull-page';
                btn.dataset.pullPage = page.cms_config.pageId;
                btn.dataset.pullType = page.cms_config.pageType;
                btn.dataset.pullName = page.name;
                btn.textContent = page.name;
                section.appendChild(btn);
            });
            list.appendChild(section);
        });
    }

    function filterPicker() {
        const term = byId('playground-pull-search').value.trim().toLowerCase();
        document.querySelectorAll('#playground-pull-list .playground-pull-group').forEach(group => {
            let shown = 0;
            group.querySelectorAll('[data-pull-page]').forEach(btn => {
                const match = !term || btn.dataset.pullName.toLowerCase().includes(term);
                btn.classList.toggle('hidden', !match);
                if (match) shown++;
            });
            group.classList.toggle('hidden', !shown);
        });
    }

    async function pullPage(pageId, pageType, name) {
        const ok = await window.customConfirm(
            `Replace what is in the Playground with ${name}?\n\nWhat is in the playground now is gone for good.`,
            'PULL', true);
        if (!ok) return;
        const query = new URLSearchParams({ page: pageId, type: pageType, tab: 'overview', pull: '1' });
        go(`playground&${query.toString()}`);
    }

    // The name the menus use, or the id written out.
    async function pageName(id) {
        try {
            const nav = await window.fetchNavigationData();
            const entry = Object.values(nav || {}).flat()
                .find(e => e && e.cms_config && e.cms_config.pageId === id);
            if (entry) return entry.name;
        } catch (e) {
            console.warn('[Playground] Could not read the page list for the title:', e);
        }
        return String(id).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // Called at the end of editor-core.js's boot.
    window.playgroundBooted = async function () {
        const now = new URLSearchParams(window.location.search);
        const id = now.get('page');

        // A pull is the new draft from the start, so leaving before the first edit comes
        // back to it, and a reload does not pull again over the edits.
        if (now.get('pull') === '1') {
            if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
            now.delete('pull');
            window.history.replaceState({}, '', `${window.location.pathname}?${now.toString()}`);
        }

        const title = byId('editor-title');
        const subtitle = byId('editor-subtitle');
        if (title) title.textContent = 'Editor Playground';
        if (subtitle) {
            subtitle.textContent = id === BLANK_ID
                ? 'A blank character page.'
                : `A copy of ${await pageName(id)}.`;
        }
    };
})();
