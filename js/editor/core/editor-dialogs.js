/**
 * The editor's message and confirm boxes, #editor-alert-modal and
 * #editor-custom-modal, on window.runDialog (site_utils.js).
 * @since v0.4, as part of editor.js
 * @watch only edit.html and post-editor.html carry that markup and load this
 *   file: shared code checks `typeof window.customConfirm` and does without
 * @see docs/editor.md
 */

window.editorAlert = function(message) {
    document.getElementById('editor-alert-msg').textContent = message;
    window.runDialog(document.getElementById('editor-alert-modal'), {
        buttons: [[document.getElementById('editor-alert-ok')]],
    });
};

/**
 * A confirm box, resolving true or false. cancelText (optional) names the cancel
 * button for a choice between two real actions; altText adds a third button for
 * a choice that can still be called off (+ STATE: start empty or copy the base
 * kit), resolving 'alt'.
 */
window.customConfirm = function(message, confirmText = "DELETE", isDanger = true, cancelText = null, altText = null) {
    const modal = document.getElementById('editor-custom-modal');
    const textEl = document.getElementById('editor-modal-text');
    const btnCancel = document.getElementById('editor-modal-cancel');
    const btnConfirm = document.getElementById('editor-modal-confirm');

    if (btnCancel.dataset.defaultLabel === undefined) btnCancel.dataset.defaultLabel = btnCancel.textContent;
    btnCancel.textContent = cancelText || btnCancel.dataset.defaultLabel;

    // Made on first use, so neither page needs markup for a button most confirms
    // never show.
    let btnAlt = document.getElementById('editor-modal-alt');
    if (altText && !btnAlt) {
        btnAlt = document.createElement('button');
        btnAlt.type = 'button';
        btnAlt.id = 'editor-modal-alt';
        btnConfirm.before(btnAlt);
    }
    if (btnAlt) {
        btnAlt.className = altText ? 'btn-sys btn-sys-blue' : 'btn-sys btn-sys-blue hidden';
        btnAlt.textContent = altText || '';
    }

    textEl.textContent = message;
    btnConfirm.textContent = confirmText;
    btnConfirm.className = isDanger ? "btn-sys btn-sys-red btn-danger-fill" : "btn-sys btn-sys-blue";

    const buttons = [[btnCancel, false], [btnConfirm, true]];
    if (btnAlt && altText) buttons.push([btnAlt, 'alt']);
    return window.runDialog(modal, { buttons, cancel: false });
};
