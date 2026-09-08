/**
 * Dogslamloop Wiki - Editor: first-visit notices (v0.18 F6 and F7)
 *
 * Two one-time notices the owner asked for: one when somebody opens the editor,
 * one when they open the Media Library. Both point at the Writing Guide, which
 * is the thing that decides whether an edit gets accepted, and neither is worth
 * showing twice to the same person.
 *
 * THE COPY IS THE OWNER'S, AND IT WAS REVISED BY THEM. It arrived with "Do not
 * change anything" against it and was shipped verbatim; on 2026-09-08 the owner
 * asked for the grammar to be corrected, and this is that pass. Anything still
 * reading oddly is deliberate until they say otherwise - "Local Resource" stays
 * singular and capitalised because it reads as the name of a section in the
 * Writing Guide, while the lowercase "local resources" beside it is the
 * ordinary noun and was pluralised.
 *
 * Which words are bold and which are the link are the owner's too, and are not
 * a styling decision to revisit.
 *
 * WHY THIS IS THE ONE PLACE innerHTML TAKES MARKUP. Every other interpolation
 * in this project escapes, because the text is contributor-authored and
 * attacker-reachable. These two strings are the exception that proves it: they
 * are FIXED COPY, authored in this file, reaching innerHTML with no
 * substitution of any kind. `renderNotice` therefore takes a notice ID and
 * looks the body up in NOTICES - it does NOT take an HTML argument, so there is
 * no parameter for a caller to pass user text into later.
 *
 * The modal is built here rather than added to edit.html so that the copy, the
 * markup and the once-only rule sit together. Both surfaces are edit.html only
 * (#interactive-builder and #media-modal-overlay exist on no other page), so
 * this file has exactly one host.
 */

(function () {
    'use strict';

    const SEEN_PREFIX = 'dsl_notice_seen_';
    const GUIDE = 'https://dogslamloop.com/systems/writing_guide/index.html';

    // target="_blank" is a behaviour decision, not a change to the copy, and it
    // is load-bearing: the editor holds unsaved work, and a same-tab navigation
    // out of it would discard whatever the contributor had typed. rel="noopener"
    // because a _blank link hands the new page a window.opener otherwise.
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

    // localStorage throws outright in some privacy modes rather than returning
    // null, and a notice is not worth breaking the editor over. Failing to read
    // shows the notice again; failing to write shows it again next visit. Both
    // are the harmless direction.
    function hasSeen(id) {
        try { return window.localStorage.getItem(SEEN_PREFIX + id) === '1'; }
        catch (e) { return false; }
    }
    function markSeen(id) {
        try { window.localStorage.setItem(SEEN_PREFIX + id, '1'); }
        catch (e) { /* nothing to do - it will show once more */ }
    }

    function dismiss(overlay) {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKeydown);
    }

    let openOverlay = null;
    function onKeydown(e) {
        if (e.key === 'Escape' && openOverlay) { dismiss(openOverlay); openOverlay = null; }
    }

    /**
     * Shows a notice once per browser. Takes an ID, never markup - see the
     * header. Returns true if it was shown.
     */
    window.showEditorNotice = function (id, opts = {}) {
        const notice = NOTICES[id];
        if (!notice) return false;
        if (!opts.force && hasSeen(id)) return false;
        // Two notices stacked on top of each other is a modal nobody can read.
        // Opening the Media Library on a first visit is the case: it fires
        // while the editor notice may still be up.
        if (openOverlay) return false;

        const overlay = document.createElement('div');
        // editor-notice-overlay carries an explicit z-index. Appending to body
        // would put this last in DOM order and win at the shared 10000 anyway,
        // and that is precisely the mechanism style/editor.css warns about two
        // paragraphs above its own confirm-layer rule - DELETE COMBO opened a
        // confirmation a reviewer could see and could not click. The media
        // notice is a RESPONSE to opening the Media Library, so it can never be
        // the one underneath.
        overlay.className = 'editor-modal-overlay editor-notice-overlay';
        overlay.id = `editor-notice-${id}`;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="editor-modal-box auth-modal-box">
                <div class="auth-header"><h3>${notice.title}</h3></div>
                <div class="auth-body">
                    <p class="modal-prompt-text">${notice.body}</p>
                    <div class="modal-actions-centered">
                        <button type="button" class="btn-sys btn-sys-green" data-notice-dismiss>GOT IT</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        openOverlay = overlay;
        markSeen(id);

        overlay.querySelector('[data-notice-dismiss]').addEventListener('click', () => {
            dismiss(overlay);
            openOverlay = null;
        });
        document.addEventListener('keydown', onKeydown);

        const btn = overlay.querySelector('[data-notice-dismiss]');
        if (btn && typeof btn.focus === 'function') btn.focus();
        return true;
    };

    // Marked seen when SHOWN rather than when dismissed, deliberately: a
    // contributor who closes the tab has still been shown it, and the
    // alternative is a modal that reappears on every load until somebody clicks
    // the button.

    document.addEventListener('DOMContentLoaded', () => {
        // The editor page, not post-editor or tier-editor - both load this
        // file's neighbours but are different tools with their own guidance.
        if (document.getElementById('interactive-builder')) {
            window.showEditorNotice('editor');
        }
    });

    // Delegated, because the Media Library button is inside markup the block
    // builder re-renders - a listener bound to the button would be dropped on
    // the next render, which is the failure js/pagebuilder.js's tab strip
    // registry already documents. It also keeps editor-blocks.js unaware of
    // notices entirely.
    document.addEventListener('click', (e) => {
        if (!e.target.closest) return;
        if (e.target.closest('#btn-media-library')) {
            window.showEditorNotice('mediaLibrary');
        }
    });
})();
