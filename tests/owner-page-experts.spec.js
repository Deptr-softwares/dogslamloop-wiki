// v0.17 F5: the Page Experts owner tool.
//
// An expert reviews submissions for their own pages and nothing else. They may
// hold no role at all - that is the point of the feature, and the reason
// page_experts is a table rather than a column on user_roles, whose `role` is
// NOT NULL. So they appear in no roster, and email is the only handle for them.
//
// It lives on owner.html rather than admin.html by the owner's own rule
// (2026-08-27): which page a tool lives on decides who owns it. Granting review
// rights over a page is a personnel decision, not a queue action.
//
// Playwright cannot reach the is_owner() guard inside the RPC - that is probed
// against production. What these tests drive is the tool: the roster renders,
// the controls call the right function with the right arguments, and a
// contributor-supplied email never reaches an inline onclick.
const { test, expect } = require('@playwright/test');

const EXPERTS = [
    { user_id: 'u1', email: 'mango@example.com', page_id: 'boomcat', granted_at: '2026-09-01T00:00:00Z' },
    { user_id: 'u2', email: 'nyko@example.com', page_id: 'boomcat', granted_at: '2026-09-01T00:00:00Z' },
    { user_id: 'u3', email: 'kai@example.com', page_id: 'sukuna', granted_at: '2026-09-02T00:00:00Z' },
];

const PAGES = [
    { page_id: 'boomcat', name: 'Boomcat', category: 'Characters' },
    { page_id: 'sukuna', name: 'Sukuna', category: 'Characters' },
];

async function mockOwner(page, { experts = EXPERTS, pages = PAGES, rpcResult, listError } = {}) {
    await page.addInitScript(({ experts, pages, rpcResult, listError }) => {
        window.__rpcCalls = [];
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u-owner', email: 'owner@example.com' }, access_token: 't' } },
                    });
                    const origFrom = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                        }
                        if (table === 'site_pages') {
                            const chain = {
                                select() { return chain; },
                                order() { return chain; },
                                then(r) { return Promise.resolve({ data: pages, error: null }).then(r); },
                            };
                            return chain;
                        }
                        return origFrom(table);
                    };
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        if (name === 'list_page_experts') {
                            return listError ? { data: null, error: listError } : { data: experts, error: null };
                        }
                        if (name === 'assign_page_expert' || name === 'revoke_page_expert') {
                            return rpcResult || { data: 'Successfully made ' + params.target_email
                                + ' an expert of ' + params.target_page_id, error: null };
                        }
                        return { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, { experts, pages, rpcResult, listError });
}

async function open(page, opts) {
    await mockOwner(page, opts);
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#tool-page-experts');
}

// --- THE TOOL IS WHERE IT SHOULD BE ---

test('the tool sits in the People group, with personnel', async ({ page }) => {
    await open(page);
    const group = await page.locator('#tool-page-experts').evaluate(
        el => el.closest('.owner-group')?.dataset.group);
    // Not Pages. It grants a person a right; it does not edit a page.
    expect(group).toBe('people');
});

test('it is on owner.html and not on admin.html', async ({ page }) => {
    // The owner's rule made concrete: which page a tool lives on decides who
    // owns it, and an admin has no owner-tool access at all.
    //
    // Navigates first: a relative fetch from about:blank has no base URL to
    // resolve against and throws before it asks for anything.
    await open(page);
    const adminHtml = await page.evaluate(async () => (await fetch('/admin.html')).text());
    expect(adminHtml).not.toContain('tool-page-experts');
    expect(adminHtml).not.toContain('assign_page_expert');
    // Paired positive, so this cannot pass on an empty response.
    expect(adminHtml, 'and admin.html really was fetched').toContain('queue-container');
});

// --- THE ROSTER ---

test('the roster groups experts by page', async ({ page }) => {
    await open(page);
    const titles = await page.locator('#page-experts-roster .expert-group-title')
        .evaluateAll(els => els.map(e => e.textContent.trim()));
    expect(titles).toEqual(['boomcat', 'sukuna']);

    const boomcat = page.locator('#page-experts-roster .expert-group').first();
    await expect(boomcat.locator('.personnel-email')).toHaveCount(2);
});

test('an empty roster says so rather than looking broken', async ({ page }) => {
    await open(page, { experts: [] });
    await expect(page.locator('#page-experts-roster')).toContainText('Nobody is an expert');
});

test('a missing migration explains itself', async ({ page }) => {
    // The normal state between deploying this code and the release. Raw
    // PostgREST text reads like a crash to the owner.
    await open(page, { listError: { code: 'PGRST202', message: 'Could not find the function' } });
    const text = await page.locator('#page-experts-roster').textContent();
    expect(text).not.toContain('PGRST202');
    expect(text.toLowerCase()).toMatch(/deployed|migration|arrives/);
});

// --- ESCAPING ---

test('an email is escaped everywhere it is drawn', async ({ page }) => {
    // Emails come from auth.users and are shown back to the owner. The tag must
    // survive as text rather than becoming an element.
    await open(page, {
        experts: [{ user_id: 'x', email: '<img src=x onerror=alert(1)>@e.com',
                    page_id: 'boomcat', granted_at: '2026-09-01T00:00:00Z' }],
    });
    await expect(page.locator('#page-experts-roster .personnel-email'))
        .toContainText('<img src=x onerror=alert(1)>');
    expect(await page.locator('#page-experts-roster img').count()).toBe(0);
});

test('REVOKE carries the email in a data attribute, not an onclick', async ({ page }) => {
    // The project's rule: never build a user-influenced value into an inline
    // onclick. An apostrophe in an address would break the handler, and worse
    // is available.
    await open(page);
    const btn = page.locator('.expert-revoke-btn').first();
    await expect(btn).toHaveAttribute('data-email', 'mango@example.com');
    await expect(btn).toHaveAttribute('data-page', 'boomcat');
    expect(await btn.evaluate(el => el.getAttribute('onclick'))).toBeNull();
});

// --- THE CONTROLS ACTUALLY CALL THE RPC ---

test('granting sends the email and the page', async ({ page }) => {
    await open(page);
    await page.fill('#expert-email', 'newexpert@example.com');
    await page.selectOption('#expert-page', 'sukuna');
    await page.click('#tool-page-experts button.admin-tool-btn');

    await expect.poll(async () => await page.evaluate(() =>
        window.__rpcCalls.filter(c => c.name === 'assign_page_expert').length)).toBe(1);

    const call = await page.evaluate(() =>
        window.__rpcCalls.find(c => c.name === 'assign_page_expert'));
    expect(call.params).toEqual({ target_email: 'newexpert@example.com', target_page_id: 'sukuna' });
});

test('granting with no email refuses before calling out', async ({ page }) => {
    await open(page);
    await page.click('#tool-page-experts button.admin-tool-btn');
    await expect(page.locator('#page-experts-results')).toContainText('Enter an email');
    expect(await page.evaluate(() =>
        window.__rpcCalls.filter(c => c.name === 'assign_page_expert').length)).toBe(0);
});

test('an "Error:" answer is not reported as success', async ({ page }) => {
    // assign_page_expert RETURNS a sentence for "no such user" rather than
    // raising - a mistyped address is not an exception. Colouring by the answer
    // is what stops "Error: User with this email not found." rendering green.
    await open(page, { rpcResult: { data: 'Error: User with this email not found.', error: null } });
    await page.fill('#expert-email', 'nobody@example.com');
    await page.click('#tool-page-experts button.admin-tool-btn');

    const results = page.locator('#page-experts-results');
    await expect(results).toContainText('not found');
    await expect(results.locator('.admin-error-text')).toHaveCount(1);
    await expect(results.locator('.owner-success-text')).toHaveCount(0);
    // And the address stays in the box so it can be corrected.
    await expect(page.locator('#expert-email')).toHaveValue('nobody@example.com');
});

test('the page dropdown is filled from site_pages', async ({ page }) => {
    // Not from navigation.json: a page the owner created a minute ago has to be
    // offerable before the next regeneration runs.
    await open(page);
    const options = await page.locator('#expert-page option')
        .evaluateAll(os => os.map(o => o.value));
    expect(options).toEqual(['boomcat', 'sukuna']);
});
