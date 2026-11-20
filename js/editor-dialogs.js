// The editor's message and confirm boxes, #editor-alert-modal and
// #editor-custom-modal. Only edit.html and post-editor.html carry that markup,
// so only they load this file: code shared with other pages checks
// `typeof window.customConfirm` and does without where it is missing.

window.editorAlert = function(message) {
    document.getElementById('editor-alert-msg').textContent = message;
    window.runDialog(document.getElementById('editor-alert-modal'), {
        buttons: [[document.getElementById('editor-alert-ok')]],
    });
};

// cancelText is optional: most confirms are "do it or don't", but a choice
// between two real actions needs both buttons named. The markup's own label is
// kept and put back when no cancelText is given.
//
// altText adds a third button, for a choice between two actions that can
// still be called off (+ STATE: start empty or copy the base kit). It
// resolves 'alt', so a caller that never passes it only ever sees true/false.
window.customConfirm = function(message, confirmText = "DELETE", isDanger = true, cancelText = null, altText = null) {
    const modal = document.getElementById('editor-custom-modal');
    const textEl = document.getElementById('editor-modal-text');
    const btnCancel = document.getElementById('editor-modal-cancel');
    const btnConfirm = document.getElementById('editor-modal-confirm');

    if (btnCancel.dataset.defaultLabel === undefined) btnCancel.dataset.defaultLabel = btnCancel.textContent;
    btnCancel.textContent = cancelText || btnCancel.dataset.defaultLabel;

    // Made on first use, so neither page carrying this modal needs new
    // markup for a button most of its confirms never show.
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
