/**
 * Dogslamloop Wiki - Owner Tools: group navigation.
 *
 * owner.html grew from two tools to ten in one uninterrupted scroll, with no
 * way to find anything and no reason to expect that to stop. The tools are now
 * in four groups - People, Pages, Content, Danger Zone - and this switches
 * between them.
 *
 * Deliberately not a router: no hash, no history entries. Switching groups is
 * not navigation, and putting it in the back button would mean the browser's
 * Back leaves a half-filled form on a page whose whole job is filling in forms.
 *
 * The choice is remembered, because the alternative is landing on People every
 * time you come back to fix one more FAQ answer.
 */

const OWNER_GROUP_KEY = 'dsl_owner_group';

function showOwnerGroup(name) {
    const groups = document.querySelectorAll('.owner-group');
    const buttons = document.querySelectorAll('.owner-nav-btn');
    if (groups.length === 0) return;

    // An unknown name (a stale value in storage after a group is renamed)
    // falls back to the first group rather than hiding everything.
    const known = [...groups].some(g => g.dataset.group === name);
    const target = known ? name : groups[0].dataset.group;

    groups.forEach(g => { g.hidden = g.dataset.group !== target; });
    buttons.forEach(b => b.classList.toggle('active', b.dataset.group === target));

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
