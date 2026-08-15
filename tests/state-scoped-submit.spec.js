// Two bugs on the same axis: the editor knowing which CHARACTER STATE it is
// working in.
//
// Bug 3 - a contributor edits the base kit and two ultimate states, presses
// Submit once, and only the open state's edits become deltas. v0.13 fixed the
// TAB axis with a scan that sweeps every tab; it missed that every scan inside
// it reads currentEditorDescData / currentEditorFrameData, which
// applyEditorModeView points at the active state's slice. So it swept every
// tab inside one state. The rest stayed in editorMasterDescData and rode along
// in the desc_data fallback, which the reviewer never applies.
//
// Bug 6 - pressing "edit this tab" while reading an ultimate state opened the
// base kit, because the link carried ?tab= but never ?mode=, and
// js/editor-modes.js chooses the state by reading exactly that parameter.
//
// These are unit-shaped rather than driven through the editor UI, because the
// defect is in what the scan READS, and reproducing three edited states
// through the real editor would test the setup far more than the fix. The
// functions under test are pure enough to call directly.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const editorCore = fs.readFileSync(path.join(ROOT, 'js', 'editor-core.js'), 'utf8');
const pageBuilder = fs.readFileSync(path.join(ROOT, 'js', 'pagebuilder.js'), 'utf8');

// --------------------------------------------------------------------------
// Bug 6: the edit link carries the state
// --------------------------------------------------------------------------

// Driven through the real button on a real character page. Lifting the
// handler out and running it in isolation was the first attempt and it was
// worse: it tested a rewritten copy of the source, which can pass while the
// shipped code stays broken.
async function clickEditFrom(page, mode) {
    // edit.html is stubbed so the click can navigate without booting the whole
    // editor - the assertion is about the URL the button builds, not what the
    // editor then does with it.
    await page.route('**/edit.html*', route => route.fulfill({
        status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>',
    }));

    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

    const btn = page.locator('#btn-edit-current-tab');
    await expect(btn).toBeVisible({ timeout: 10000 });

    // Stand where a reader stands: on the Skills tab, in the given state.
    await page.locator('#nav-skills').click();
    await page.evaluate(m => { window.activeCharacterMode = m; }, mode);

    await btn.click();
    await page.waitForURL(/edit\.html/, { timeout: 10000 });
    return page.url();
}

test('the edit link carries ?mode= so the editor opens the state you were reading', async ({ page }) => {
    const url = await clickEditFrom(page, 'ultimate');

    expect(url, 'reading an ultimate state must open that state').toContain('mode=ultimate');
    expect(url, 'the tab must still be carried').toContain('tab=skills');
    expect(url).toContain('page=boomcat');
});

test('the edit link drops the parameter on the base kit', async ({ page }) => {
    const url = await clickEditFrom(page, 'base');

    // Base sends no mode rather than ?mode=base, matching what
    // js/character_modes.js does to the reading page's canonical URL.
    expect(url, 'base must not append a mode parameter').not.toContain('mode=');
    expect(url, 'the tab is still carried').toContain('tab=skills');
});

// --------------------------------------------------------------------------
// Bug 3: the submit scan visits every state
// --------------------------------------------------------------------------

test('the submit scan collects states from the data, not the declared list', async ({ page }) => {
    await page.goto('/404.html', { waitUntil: 'domcontentloaded' });

    const collectSrc = editorCore.slice(
        editorCore.indexOf('const collectStates = () => {'),
        editorCore.indexOf('const states = collectStates();')
    );
    expect(collectSrc, 'collectStates not found — this test is reading the wrong file').toContain('modeData');

    const found = await page.evaluate(({ src }) => {
        window.BASE_MODE_ID = 'base';

        // Deliberately inconsistent: 'ultimate-2' has real data but was never
        // added to `modes`. Scanning the declaration would drop it, which is
        // the failure mode this whole fix exists to prevent — so the union
        // must come from the data.
        window.editorMasterFrameData = {
            modes: [{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Ultimate' }],
            modeData: { ultimate: { skills: [] } },
        };
        window.editorMasterDescData = {
            modeData: { ultimate: {}, 'ultimate-2': { matchups: [{ opponent: 'Vessel' }] } },
        };

        const fn = new Function(`${src} return collectStates();`);
        return fn();
    }, { src: collectSrc });

    expect(found[0], 'base must be scanned first').toBe('base');
    expect(found).toContain('ultimate');
    expect(found, 'a state with data but no declaration must still be scanned').toContain('ultimate-2');
    expect(new Set(found).size, 'states must not be scanned twice').toBe(found.length);
});

test('a page with no states scans exactly once', async ({ page }) => {
    await page.goto('/404.html', { waitUntil: 'domcontentloaded' });

    const collectSrc = editorCore.slice(
        editorCore.indexOf('const collectStates = () => {'),
        editorCore.indexOf('const states = collectStates();')
    );

    const found = await page.evaluate(({ src }) => {
        window.BASE_MODE_ID = 'base';
        window.editorMasterFrameData = { m1s: [] };
        window.editorMasterDescData = { overview: [] };
        return new Function(`${src} return collectStates();`)();
    }, { src: collectSrc });

    // Most pages. The loop must degrade to the single pass this code has
    // always done, or every ordinary submission changes behaviour.
    expect(found).toEqual(['base']);
});

test('the scan restores the editor to the state the user was actually in', () => {
    // A submit that left the editor pointed at whichever state happened to be
    // scanned last would move the user somewhere they never navigated, and
    // `finally` is what makes that hold even when a scan throws.
    const loop = editorCore.slice(
        editorCore.indexOf('const states = collectStates();'),
        editorCore.indexOf('if (payloadsToInsert.length === 0')
    );

    expect(loop).toContain('const savedMode = window.editorActiveMode;');
    expect(loop).toContain('finally');
    expect(loop.indexOf('finally'), 'the restore must be in a finally, not after the loop')
        .toBeLessThan(loop.indexOf('window.editorActiveMode = savedMode;'));
});
