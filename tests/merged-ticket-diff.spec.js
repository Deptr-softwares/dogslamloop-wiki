// A merged ticket showed only the edits before its first null key.
//
// FROM A REAL TICKET. 63a024d0 on defense_attorney, sitting in the queue with
// support, carried six... five entries:
//
//   move      :: m1s::defense-attorney-first-m1
//   move      :: m1s::defense-attorney-second-m1
//   playstyle ::                                  <- null key
//   strategy  ::                                  <- null key
//   move      :: skills::extended-swings-mixup
//
// The banner read "BATCHED MULTI-PAYLOAD DETECTED (5 EDITS)" and the reviewer
// was shown two. Every editor-produced ticket in the same table carries
// `playstyle :: full` instead, which is why only MERGED tickets broke.
//
// Two independent faults, and both are fixed, because either alone leaves a
// hole:
//
//   1. js/admin-merge-compiler.js normalised a null key to 'full' in its
//      mode-wrapped branch and not in its plain one, so base-kit section
//      conflicts shipped `{ scope: 'playstyle', key: null }`.
//   2. js/admin-preview.js interpolated `key.replace(...)`, which throws on
//      null, inside a bare forEach - so one bad entry abandoned every entry
//      after it. Fixing only the compiler would leave tickets already in the
//      queue unreviewable.
//
// The ticket APPLIED correctly the whole time. Only the review was blind,
// which is the dangerous shape: a reviewer approving changes never shown.
const { test, expect } = require('@playwright/test');

const LIVE_DESC = {
    playstyle: ['Live playstyle'],
    strategy: ['Live strategy'],
    overview: ['Live overview'],
};
const LIVE_FRAME = {
    m1s: [
        { id: 'defense-attorney-first-m1', name: 'First M1', stats: [{ label: 'Damage', value: '3' }] },
        { id: 'defense-attorney-second-m1', name: 'Second M1', stats: [{ label: 'Damage', value: '3' }] },
    ],
    skills: [{ id: 'extended-swings-mixup', name: 'Extended Swings Mixup', stats: [] }],
};

// The real ticket's shape, null keys included.
const MERGED_TICKET = {
    id: 'test-merged-ticket',
    page_id: 'defense_attorney',
    page_type: 'character',
    is_delta: true,
    target_scope: 'multi',
    target_key: 'batch',
    delta_payload: [
        { scope: 'move', key: 'm1s::defense-attorney-first-m1', payload: { frame_data: { id: 'defense-attorney-first-m1', name: 'First M1', stats: [{ label: 'Damage', value: '2' }] }, desc_data: [] } },
        { scope: 'move', key: 'm1s::defense-attorney-second-m1', payload: { frame_data: { id: 'defense-attorney-second-m1', name: 'Second M1', stats: [{ label: 'Damage', value: '4 (2+2)' }] }, desc_data: [] } },
        { scope: 'playstyle', key: null, payload: ['Merged playstyle'] },
        { scope: 'strategy', key: null, payload: ['Merged strategy'] },
        { scope: 'move', key: 'skills::extended-swings-mixup', payload: { frame_data: { id: 'extended-swings-mixup', name: 'Extended Swings Mixup', stats: [{ label: 'Damage', value: '9' }] }, desc_data: [] } },
    ],
};

async function renderDiff(page, ticket) {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });

    return page.evaluate(async ({ rev, liveDesc, liveFrame }) => {
        // The RBAC gate wipes body for a logged-out visitor; rebuild only what
        // the diff branch of switchVersionView actually reads. It appends its
        // container to `.main-content-area` — with that missing, the container
        // is never attached and the whole view renders into nothing.
        document.body.innerHTML = `<div class="main-content-area"></div>`;

        window.currentQueueData = [rev];
        window.activePreviewRevId = rev.id;
        window.activePreviewCharId = rev.page_id;
        window.activePreviewPageType = rev.page_type;
        window.activePreviewMode = null;
        window.currentLiveDescData = liveDesc;
        window.currentLiveFrameData = liveFrame;
        window.currentPendingDescData = liveDesc;
        window.currentPendingFrameData = liveFrame;

        const errors = [];
        const onError = (e) => errors.push(String(e.message || e));
        window.addEventListener('error', onError);

        await switchVersionView('diff');

        window.removeEventListener('error', onError);

        const container = document.getElementById('admin-diff-container');
        return {
            html: container ? container.innerHTML : '',
            text: container ? container.innerText : '',
            locations: container
                ? [...container.querySelectorAll('.diff-location-label')].map(n => n.innerText.trim())
                : [],
            errors,
        };
    }, { rev: ticket, liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });
}

test('every edit in a merged ticket is rendered, null keys included', async ({ page }) => {
    const out = await renderDiff(page, MERGED_TICKET);

    // The banner counts delta_payload.length, so it was always honest. The
    // render is what lied - assert the render, not the count.
    expect(out.text).toContain('5 EDITS');

    // One location label per edit. Two was the bug.
    expect(out.locations.length,
        `expected one location label per edit, got:\n${out.locations.join('\n')}`).toBe(5);

    // And the entries AFTER the null keys must survive, which is the actual
    // regression: a throw on edit 3 took edits 4 and 5 with it.
    const joined = out.locations.join(' | ').toUpperCase();
    expect(joined, 'the first M1 must render').toContain('DEFENSE-ATTORNEY-FIRST-M1');
    expect(joined, 'the second M1 must render').toContain('DEFENSE-ATTORNEY-SECOND-M1');
    expect(joined, 'the null-keyed playstyle must render').toContain('PLAYSTYLE');
    expect(joined, 'the null-keyed strategy must render').toContain('STRATEGY');
    expect(joined, 'the edit AFTER the null keys must survive').toContain('EXTENDED-SWINGS-MIXUP');
});

test('a null key is labelled, not printed as "null"', async ({ page }) => {
    const out = await renderDiff(page, MERGED_TICKET);

    // 'full' is what the editor emits for a singular scope, so a merged
    // ticket reads the same way as an editor one rather than exposing that
    // the compiler left the field empty.
    const playstyle = out.locations.find(l => /PLAYSTYLE/.test(l));
    expect(playstyle).toBeTruthy();
    expect(playstyle).toContain('FULL');
    expect(playstyle.toLowerCase()).not.toContain('null');
    expect(playstyle.toLowerCase()).not.toContain('undefined');
});

test('one unrenderable edit cannot hide the rest', async ({ page }) => {
    // Not the null-key case - a genuinely broken entry, to prove the batch
    // loop is resilient rather than merely that one bug is patched. A future
    // scope this renderer has never seen must cost its own row, not the
    // remainder of the ticket.
    const poisoned = JSON.parse(JSON.stringify(MERGED_TICKET));
    poisoned.delta_payload.splice(1, 0, { scope: 'move', key: null, payload: null });

    const out = await renderDiff(page, poisoned);

    expect(out.text).toContain('6 EDITS');
    expect(out.locations.length + (out.html.match(/could not be displayed/g) || []).length,
        'every edit must produce either a diff or an explicit failure row').toBeGreaterThanOrEqual(6);

    // The edits after the poisoned one are the point.
    const joined = out.html.toUpperCase();
    expect(joined).toContain('EXTENDED-SWINGS-MIXUP');
    expect(joined).toContain('PLAYSTYLE');
});

test('the merge compiler never emits a null key again', () => {
    // The renderer guard above makes existing tickets reviewable; this is the
    // root cause. Asserted against the source because compiling a real merge
    // needs the full conflict UI, which admin-merge-compiler.spec.js already
    // drives - this only pins the normalisation itself.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-merge-compiler.js'), 'utf8');

    // Anchored forward from pushDelta itself. Slicing to `conflicts.forEach`
    // silently produced an empty string, because an earlier one appears above
    // this point in the file — and an empty haystack fails every match for the
    // wrong reason.
    const start = src.indexOf('const pushDelta =');
    expect(start, 'pushDelta not found — this test is reading the wrong file').toBeGreaterThan(-1);
    const push = src.slice(start, start + 400);

    expect(push, 'the plain branch must normalise its key too, not only the mode branch')
        .toMatch(/:\s*\{\s*scope,\s*key:\s*normaliseKey\(key\)/);
});
