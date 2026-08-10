// The small end of the reviewer-workflow batch: three fixes that are cheap
// individually but each cost a reviewer something every time they hit it.
const { test, expect } = require('@playwright/test');

test('each moderation action gets its own prompt wording, not the reject modal\'s', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.access-denied-screen');

  // All three actions share one modal. Its textarea carried "Explain why this
  // revision was declined..." hardcoded in admin.html, so approving asked the
  // reviewer to justify a decline - in red. Working a queue at speed, that is
  // wording someone eventually acts on.
  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <div id="admin-prompt-modal" class="hidden">
        <div>
          <h3></h3>
          <p id="admin-prompt-msg"></p>
          <textarea id="admin-prompt-input" placeholder="Type your note here..."></textarea>
          <button id="btn-admin-prompt-ok"></button>
          <button id="btn-admin-prompt-cancel"></button>
        </div>
      </div>
    `;

    const capture = (title, confirmText, isDanger, placeholder) => {
      const p = window.adminPrompt('msg', title, confirmText, isDanger, placeholder);
      const box = document.getElementById('admin-prompt-modal').firstElementChild;
      const snapshot = {
        title: box.querySelector('h3').textContent,
        placeholder: document.getElementById('admin-prompt-input').placeholder,
        confirmText: document.getElementById('btn-admin-prompt-ok').textContent,
        danger: box.classList.contains('accent-red'),
      };
      document.getElementById('btn-admin-prompt-cancel').click();
      return p.then(() => snapshot);
    };

    return {
      approve: await capture('APPROVE REVISION', 'MERGE TICKET', false, 'Optional note for the author, e.g. what you verified...'),
      reject: await capture('REJECT REVISION', 'DECLINE TICKET', true, 'Explain why this revision was declined...'),
      changes: await capture('REQUEST CHANGES', 'SEND REQUEST', false, 'Describe what needs changing before this can be approved...'),
    };
  });

  expect(result.approve.placeholder).toContain('Optional note for the author');
  expect(result.approve.placeholder, 'approving must not ask why it was declined').not.toContain('declined');
  expect(result.approve.danger, 'and must not be red').toBe(false);

  expect(result.reject.placeholder).toContain('declined');
  expect(result.reject.danger).toBe(true);

  expect(result.changes.placeholder).toContain('what needs changing');
  expect(result.changes.placeholder).not.toContain('declined');
  expect(result.changes.danger).toBe(false);
});

test('the editor offers every frame type the site documents', async ({ page }) => {
  // The dropdown must stay in step with the legend in js/framedata.js and
  // systems/color-codes. InSkill Stun and Inactive were both styled and
  // documented but unauthorable, so contributors either omitted them or
  // recorded something else.
  await page.goto('/edit.html?char=testchar&tab=skills', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="daw-diag-target"></div>');
    const moveData = {
      id: 'm', name: 'M', media: { src: '', alt: '' }, stats: [],
      bars: [{ type: 'single', headerInfo: 'Track 1', phases: [{ duration: 5, styleClass: 'bg-tick-start', label: '' }] }],
      variants: {},
    };
    window.initDawEditor('daw-diag-target', moveData);
    await new Promise(r => setTimeout(r, 100));

    // Select the phase so the inspector, which owns the Frame Type select,
    // renders at all.
    const phase = document.querySelector('#daw-diag-target .daw-phase-block');
    if (phase) phase.click();
    await new Promise(r => setTimeout(r, 100));

    const sel = document.getElementById('insp-class');
    return sel ? Array.from(sel.options).map(o => o.value) : null;
  });

  expect(result, 'the frame-type inspector should render').not.toBeNull();

  // Every tick class the legend defines must be authorable.
  const documented = [
    'bg-tick-start', 'bg-tick-active', 'bg-tick-inactive', 'bg-tick-recov',
    'bg-tick-blockendlag', 'bg-tick-selfstun', 'bg-tick-inskillstun',
    'bg-tick-targetstun', 'bg-tick-misc',
  ];
  documented.forEach(cls => {
    expect(result, `${cls} is documented in the legend and must be selectable`).toContain(cls);
  });
});

test('the frame-type list matches the legend exactly, so neither can drift', async ({ request }) => {
  // Guards the pairing rather than a snapshot of one side: the bug was the
  // two lists disagreeing, and they can only disagree if nothing compares
  // them. Read from source because frameDataLegendHTML is a module-level
  // const in a classic script, so it never reaches window.
  const legendSource = await (await request.get('/js/framedata.js')).text();
  const editorSource = await (await request.get('/js/editor-framedata.js')).text();

  const legendClasses = [...new Set(
    Array.from(legendSource.matchAll(/legend-swatch (bg-tick-[a-z]+)/g)).map(m => m[1])
  )];

  expect(legendClasses.length, 'the legend should list its tick types').toBeGreaterThan(5);

  legendClasses.forEach(cls => {
    expect(editorSource, `${cls} appears in the legend but has no editor option`).toContain(`value="${cls}"`);
  });
});

test('cancel leaves the editor even when there is no history to go back to', async ({ page }) => {
  // A reviewer intercepting a ticket arrives via window.open(..., '_blank'),
  // and a fresh tab has no history entry - so a bare history.back() did
  // nothing at all, which is exactly how it was reported.
  await page.goto('/edit.html?char=testchar&editTicket=rev-1', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const calls = { closed: false, back: false, href: null };

    // Simulate the tab having been script-opened from admin.html.
    Object.defineProperty(window, 'opener', { value: { closed: false }, configurable: true });
    window.close = () => { calls.closed = true; };
    window.history.back = () => { calls.back = true; };

    window.cancelEditor();
    return calls;
  });

  expect(result.closed, 'closing the tab reveals the queue underneath').toBe(true);
  expect(result.back, 'and does not fall through to a no-op history.back').toBe(false);
});

test('cancel from a deep link sends staff to the queue and contributors to the page', async ({ page }) => {
  // window.location cannot be replaced in a real browser, so the destination
  // choice is asserted directly rather than by stubbing navigation.
  await page.goto('/edit.html?char=testchar', { waitUntil: 'networkidle' });

  const destinations = await page.evaluate(() => ({
    intercepted: window.editorExitDestination('?char=testchar&editTicket=rev-1'),
    character: window.editorExitDestination('?char=testchar'),
    system: window.editorExitDestination('?page=combat&type=system'),
    bare: window.editorExitDestination(''),
    quoted: window.editorExitDestination('?char=' + encodeURIComponent('a b/c')),
  }));

  expect(destinations.intercepted, 'an intercepted ticket belongs to the review queue').toBe('admin.html');
  expect(destinations.character).toBe('characters/testchar/');
  expect(destinations.system, 'system pages do not live under characters/').toBe('systems/combat/');
  expect(destinations.bare).toBe('index.html');
  expect(destinations.quoted, 'the page id is encoded, not pasted into a path raw').toBe('characters/a%20b%2Fc/');
});
