/**
 * Switches owner.html between its four tool groups: People, Pages, Content and
 * Danger Zone. Remembered on this device.
 * @since v0.11
 * @touches localStorage dsl_owner_group
 * @watch not a router: no hash and no history, since Back would leave a
 *   half-filled form
 * @see docs/owner-tools.md
 */

const OWNER_GROUP_KEY = 'dsl_owner_group';

function showOwnerGroup(name) {
    const groups = document.querySelectorAll('.owner-group');
    const buttons = document.querySelectorAll('.owner-nav-btn');
    if (groups.length === 0) return;

    // An unknown name, such as a renamed group's, falls back to the first.
    const known = [...groups].some(g => g.dataset.group === name);
    const target = known ? name : groups[0].dataset.group;

    groups.forEach(g => { g.hidden = g.dataset.group !== target; });
    buttons.forEach(b => b.classList.toggle('is-active', b.dataset.group === target));

    try {
        localStorage.setItem(OWNER_GROUP_KEY, target);
    } catch (e) {
        // Private mode or a full quota. Switching still works for this visit.
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('owner-nav');
    if (!nav) return;   // not on owner.html

    nav.addEventListener('click', (event) => {
        const btn = event.target.closest('.owner-nav-btn');
        if (btn) showOwnerGroup(btn.dataset.group);
    });

    let saved = null;
    try { saved = localStorage.getItem(OWNER_GROUP_KEY); } catch (e) { /* see above */ }
    showOwnerGroup(saved || 'people');
});

window.showOwnerGroup = showOwnerGroup;
