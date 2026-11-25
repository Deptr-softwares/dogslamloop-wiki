/**
 * The two first-visit notices: one on opening the editor, one on opening the
 * Media Library, both pointing at the Writing Guide, each shown once per browser.
 * The editor's notice hands over to the tour.
 * @since v0.18
 * @touches localStorage dsl_notice_seen_*, startEditorTutorial, pauseEditorTutorial
 *   and resumeEditorTutorial (editor-tutorial.js)
 * @watch the copy is the owner's own, word for word, bold and link included. It
 *   is the one place innerHTML takes markup: fixed copy from this file, looked up
 *   by id, never passed in, so no caller can hand it user text.
 * @see docs/editor.md
 */

(function () {
    'use strict';

    const SEEN_PREFIX = 'dsl_notice_seen_';
    const GUIDE = 'https://dogslamloop.com/systems/writing_guide/index.html';

    // A new tab: the editor holds unsaved work. noopener, or the new page gets a
    // window.opener.
    const guideLink = `<a href="${GUIDE}" target="_blank" rel="noopener">Writing Guide</a>`;

    const NOTICES = {
        editor: {
            title: 'BEFORE YOU EDIT',
            body: `Welcome to the Dogslamloop Wiki Editor! Before doing any edits yourself, `
                + `<strong>make sure to read up on the</strong> ${guideLink}! It details the `
                + `rules and the writing style of this wiki, so failure to follow it will `
                + `get your edits rejected.`,
        },
        mediaLibrary: {
            title: 'THE MEDIA LIBRARY',
            body: `Welcome to the Media Library! Here's where we keep all of the media and `
                + `resources of the wiki. This is the place where we keep and host our local `
                + `resources, so make sure to check out the ${guideLink} `
                + `<strong>section when it comes to Local Resource!</strong>`,
        },
    };

    // localStorage throws in some privacy modes. Both failures show the notice once
    // more, which is harmless.
    function hasSeen(id) {
        try { return window.localStorage.getItem(SEEN_PREFIX + id) === '1'; }
        catch (e) { return false; }
    }
    function markSeen(id) {
        try { window.localStorage.setItem(SEEN_PREFIX + id, '1'); }
        catch (e) { /* it will show once more */ }
    }

    let openOverlay = null;

    /**
     * Shows a notice once per browser, by id, never by markup. True if it was shown.
     */
    window.showEditorNotice = function (id, opts = {}) {
        const notice = NOTICES[id];
        if (!notice) return false;
        if (!opts.force && hasSeen(id)) return false;
        // Two notices stacked is a modal nobody can read: the library can open while the
        // editor's notice is up.
        if (openOverlay) return false;

        // The tour's text box sits where this modal's GOT IT lands, so the tour steps
        // aside and comes back. Refusing the notice instead would mean a first-time
        // contributor never sees the library's notice.
        const pausedTutorial = typeof window.pauseEditorTutorial === 'function'
            && window.pauseEditorTutorial();

        // A dialog: opened over the library, it is on top of it by opening last.
        const overlay = document.createElement('dialog');
        overlay.className = 'site-dialog';
        overlay.id = `editor-notice-${id}`;
        overlay.setAttribute('aria-labelledby', `editor-notice-${id}-title`);
        overlay.innerHTML = `
                <div class="dialog-header"><h3 id="editor-notice-${id}-title">${notice.title}</h3></div>
                <div class="dialog-body dialog-question">
                    <p class="dialog-text">${notice.body}</p>
                    <div class="dialog-actions">
                        <button type="button" class="btn-sys btn-sys-green" data-notice-dismiss>GOT IT</button>
                    </div>
                </div>`;

        document.body.appendChild(overlay);
        openOverlay = overlay;
        markSeen(id);

        let gotIt = false;
        overlay.querySelector('[data-notice-dismiss]').addEventListener('click', () => {
            gotIt = true;
            overlay.close();
        });

        // Every way out (GOT IT, Escape, a click outside) gives the tour back.
        overlay.addEventListener('close', () => {
            overlay.remove();
            openOverlay = null;

            // GOT IT on the editor's notice starts the tour: the click proves somebody is
            // looking at the editor. Not after the library's notice: they are picking a file.
            // startEditorTutorial is once per browser on its own.
            if (gotIt && id === 'editor' && typeof window.startEditorTutorial === 'function') {
                window.startEditorTutorial();
            }

            // Always given back, not only when this notice paused it: the tour loads
            // asynchronously and can open paused on its own. resumeEditorTutorial does
            // nothing when there is no tour.
            void pausedTutorial;
            if (typeof window.resumeEditorTutorial === 'function') {
                window.resumeEditorTutorial();
            }
        });
        // Only reading in it: a click outside closes it.
        window.openDialog(overlay, { light: true });

        const btn = overlay.querySelector('[data-notice-dismiss]');
        if (btn && typeof btn.focus === 'function') btn.focus();
        return true;
    };

    // Marked seen when shown, not when dismissed, or it would reappear on every load
    // until someone clicks.

    document.addEventListener('DOMContentLoaded', () => {
        // The editor page only: the Post editor and the tier editor have their own
        // guidance.
        if (document.getElementById('interactive-builder')) {
            window.showEditorNotice('editor');
        }
    });

    // Delegated: the Block editor redraws the library's button, and it keeps
    // editor-blocks.js unaware of notices.
    document.addEventListener('click', (e) => {
        if (!e.target.closest) return;
        if (e.target.closest('#btn-media-library')) {
            window.showEditorNotice('mediaLibrary');
        }
    });
})();
