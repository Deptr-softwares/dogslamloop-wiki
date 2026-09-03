// v0.17 F13: a contributor can answer the discussion on their own submission.
//
// The owner: "There should be no reason why they get a notification of 'Staff
// are discussing your submission'" without being able to reply. The
// notification has existed since v0.13; the reply had not.
//
// The interesting half is WHY this is an RPC. "Authors can update own pending
// revisions" already lets an author UPDATE their own row while it is pending or
// ticket_open, so appending to ticket_chat needed no new policy - and that is
// the problem, because RLS cannot restrict WHICH COLUMNS an update touches and
// pending_revisions carries GRANT ALL to authenticated. An author writing to
// ticket_chat through the table is an author who can write every other column
// in the same statement.
//
// RLS is invisible to Playwright, so the migration half here is static and the
// probes in the PR verify the guard. The live half drives the real page.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260903000002_ticket_messages.sql'), 'utf8');
const CODE = SQL.replace(/--[^\n]*/g, ' ');

// --- THE RPC ---

test('it is an RPC and it adds no policy', async () => {
    // A tighter policy cannot express this. The point of the whole item.
    expect(CODE).toContain('CREATE OR REPLACE FUNCTION "public"."post_ticket_message"');
    expect(CODE, 'no policy is created or altered here')
        .not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY/);
    expect(CODE, 'and no new table grant either')
        .not.toMatch(/GRANT[^;]*ON TABLE "public"\."pending_revisions"/);
});

test('the caller is checked before anything is read or written', async () => {
    const signedIn = CODE.search(/IF "auth"\."uid"\(\) IS NULL THEN/);
    const firstRead = CODE.search(/SELECT pr\."author_id"/);
    const firstWrite = CODE.search(/UPDATE "public"\."pending_revisions"/);

    expect(signedIn, 'there is a signed-in check').toBeGreaterThan(-1);
    expect(firstRead, 'and it comes before the read').toBeGreaterThan(signedIn);
    expect(firstWrite, 'and before the write').toBeGreaterThan(signedIn);

    // Permission, status and ban are all decided before the UPDATE too.
    for (const gate of [
        /IF NOT \("is_author" OR "public"\."can_review_page"\("rev_page_id"\)\) THEN/,
        /IF "rev_status" IS DISTINCT FROM 'pending' AND "rev_status" IS DISTINCT FROM 'ticket_open' THEN/,
        /IF "public"\."get_my_role"\(\) IS NOT DISTINCT FROM 'viewer' THEN/,
    ]) {
        const at = CODE.search(gate);
        expect(at, `gate present: ${gate}`).toBeGreaterThan(-1);
        expect(firstWrite, 'and it precedes the write').toBeGreaterThan(at);
    }
});

test('an expert can answer on their own pages, by the same gate the queue uses', async () => {
    // can_review_page(), not is_staff(). A second opinion about who may review
    // would be a fourth place to keep in step, and it would silently exclude
    // every expert from the conversation on their own page.
    expect(CODE).toMatch(/"public"\."can_review_page"\("rev_page_id"\)/);
    expect(CODE, 'and never a literal role').not.toMatch(/= '(?:owner|admin|reviewer)'/);
});

test('the soft ban is tested with IS NOT DISTINCT FROM, not =', async () => {
    // get_my_role() is NULL for an ordinary contributor - the majority case
    // here - and NULL = 'viewer' is NULL, which is not true, so the ban would
    // simply never fire. The inverse of the usual mistake, and the reason this
    // is worth its own test.
    expect(CODE).toMatch(/"public"\."get_my_role"\(\) IS NOT DISTINCT FROM 'viewer'/);
    expect(CODE).not.toMatch(/get_my_role"\(\)\s*=\s*'viewer'/);
});

test('the message is appended in SQL, not written back as a whole array', async () => {
    // The client used to SELECT ticket_chat, append in JavaScript and write the
    // array back. Two people replying at once lost one of the two messages, and
    // nothing reported it.
    expect(CODE).toMatch(/SET "ticket_chat" = COALESCE\("ticket_chat", '\[\]'::jsonb\) \|\| jsonb_build_array\("new_message"\)/);
});

test('the author name is resolved server-side and cannot be sent', async () => {
    // The old call sent window.currentUsername, so the name on a ticket message
    // was whatever the caller said it was. page_discussions solved the same
    // problem with a trigger that overwrites author_name.
    expect(CODE).toMatch(/SELECT COALESCE\(\s*NULLIF\(au\."raw_user_meta_data"->>'display_name'/);
    expect(CODE).toMatch(/FROM "auth"\."users" au WHERE au\."id" = "auth"\."uid"\(\)/);
    // Only two parameters, and neither is a name.
    expect(CODE).toMatch(/"post_ticket_message"\(\s*"target_revision_id" uuid,\s*"message_text" "text"\s*\)/);
    expect(CODE, 'no email-prefix fallback, as everywhere else').toMatch(/'Anonymous'/);
});

test('a message is bounded and cannot be blank', async () => {
    expect(CODE).toMatch(/char_length\("clean_text"\) > 2000/);
    expect(CODE).toMatch(/IF "clean_text" = '' THEN/);
    expect(CODE, 'trimmed, so whitespace is not a message').toMatch(/btrim\(COALESCE\("message_text", ''\)\)/);
});

test('anon cannot reach it', async () => {
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."post_ticket_message"\(uuid, "text"\) FROM PUBLIC/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."post_ticket_message"\(uuid, "text"\) FROM "anon"/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."post_ticket_message"\(uuid, "text"\) TO "authenticated"/);
    expect(CODE).toMatch(/SET "search_path" TO 'public'/);
});

// --- THE CONTRIBUTOR'S PAGE ---

const REV = (over = {}) => ({
    id: 'r-ticket', page_id: 'boomcat', author_id: 'me', status: 'ticket_open',
    is_delta: true, target_scope: 'move', target_key: 'm1s::5H',
    created_at: '2026-08-01T00:00:00Z', qa_metadata: {}, ticket_chat: [], ...over,
});

async function load(page, revisions, rpcResult) {
    await page.goto('/submissions.html', { waitUntil: 'networkidle' });
    await page.evaluate(({ revisions, rpcResult }) => {
        window.__rpcCalls = [];
        window.supabaseClient = {
            from() {
                return { select() { return this; }, eq() { return this; },
                         order: async () => ({ data: revisions, error: null }) };
            },
            rpc: async (name, params) => {
                window.__rpcCalls.push({ name, params });
                return rpcResult || { data: {
                    author: 'RealName', text: params.message_text, timestamp: 1756900000000, type: 'author',
                }, error: null };
            },
        };
        window.currentSessionUserId = 'me';
        return window.loadSubmissions();
    }, { revisions, rpcResult });
}

test('a discussion the contributor could only read now has a reply box', async ({ page }) => {
    await load(page, [REV({ ticket_chat: [
        { author: 'ReviewerOne', text: 'Where did this number come from?', timestamp: 1756800000000 },
    ] })]);

    await expect(page.locator('.ticket-thread')).toHaveCount(1);
    await expect(page.locator('.ticket-thread-log')).toContainText('Where did this number come from?');
    await expect(page.locator('#ticket-reply-r-ticket')).toBeVisible();
    await expect(page.locator('#ticket-send-r-ticket')).toBeVisible();
});

test('sending goes through the RPC with the revision and the text', async ({ page }) => {
    await load(page, [REV()]);
    await page.fill('#ticket-reply-r-ticket', 'I tested it on the dummy twice.');
    await page.click('#ticket-send-r-ticket');

    await expect.poll(async () => await page.evaluate(() => window.__rpcCalls.length)).toBe(1);
    const call = await page.evaluate(() => window.__rpcCalls[0]);
    expect(call.name).toBe('post_ticket_message');
    expect(call.params).toEqual({
        target_revision_id: 'r-ticket',
        message_text: 'I tested it on the dummy twice.',
    });
});

test('the posted message shows the name the SERVER returned', async ({ page }) => {
    // Not the local guess. The name is resolved server-side, so echoing what
    // the client thinks it is would show the author a different message from
    // the one every reviewer sees.
    await load(page, [REV()], { data: {
        author: 'ServerResolvedName', text: 'sent', timestamp: 1756900000000, type: 'author',
    }, error: null });

    await page.fill('#ticket-reply-r-ticket', 'sent');
    await page.click('#ticket-send-r-ticket');

    await expect(page.locator('.ticket-thread-log')).toContainText('ServerResolvedName');
    await expect(page.locator('.ticket-thread-mine')).toHaveCount(1);
    // And the box is cleared so the message is not sent twice.
    await expect(page.locator('#ticket-reply-r-ticket')).toHaveValue('');
});

test('a staff line and the contributor\'s own reply look different', async ({ page }) => {
    await load(page, [REV({ ticket_chat: [
        { author: 'ReviewerOne', text: 'Where did this come from?', timestamp: 1756800000000 },
        { author: 'Me', text: 'Tested it twice.', timestamp: 1756800100000, type: 'author' },
        { author: 'ReviewerOne', text: 'Please add a source.', timestamp: 1756800200000, type: 'changes_requested' },
    ] })]);

    await expect(page.locator('.ticket-thread-staff')).toHaveCount(1);
    await expect(page.locator('.ticket-thread-mine')).toHaveCount(1);
    await expect(page.locator('.ticket-thread-changes')).toHaveCount(1);
    // The contributor's own line says so, so a thread reads as a conversation.
    await expect(page.locator('.ticket-thread-mine')).toContainText('(you)');
});

test('a message containing markup arrives as text', async ({ page }) => {
    // Ticket chat is written by contributors and reviewers and rendered on a
    // page the author opens from a notification.
    await load(page, [REV({ ticket_chat: [
        { author: '<img src=x onerror=alert(1)>', text: '<script>alert(2)</script>', timestamp: 1756800000000 },
    ] })]);

    await expect(page.locator('.ticket-thread-text')).toHaveText('<script>alert(2)</script>');
    await expect(page.locator('.ticket-thread-who')).toContainText('<img src=x onerror=alert(1)>');
    expect(await page.locator('.ticket-thread img').count(), 'no element was created').toBe(0);
});

test('a closed submission shows the conversation but no reply box', async ({ page }) => {
    // The RPC refuses a closed row anyway. Offering a control that cannot work
    // is worse than not offering one.
    await load(page, [REV({ id: 'r-done', status: 'approved', ticket_chat: [
        { author: 'ReviewerOne', text: 'Approved, thanks.', timestamp: 1756800000000 },
    ] })]);

    await expect(page.locator('.ticket-thread-log')).toContainText('Approved, thanks.');
    await expect(page.locator('#ticket-reply-r-done')).toHaveCount(0);
    await expect(page.locator('#ticket-send-r-done')).toHaveCount(0);
});

test('a pending submission nobody has commented on gets no thread', async ({ page }) => {
    // There is nothing to answer, and an empty discussion box on every pending
    // row is noise.
    await load(page, [REV({ id: 'r-quiet', status: 'pending', ticket_chat: [] })]);
    await expect(page.locator('.ticket-thread')).toHaveCount(0);
});

test('an empty reply is refused before calling out', async ({ page }) => {
    await load(page, [REV()]);
    await page.click('#ticket-send-r-ticket');
    await expect(page.locator('#ticket-status-r-ticket')).toContainText('Write something');
    expect(await page.evaluate(() => window.__rpcCalls.length)).toBe(0);
});

test('a missing migration explains itself instead of showing PostgREST text', async ({ page }) => {
    // The state between deploying this code and the release.
    await load(page, [REV()], { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await page.fill('#ticket-reply-r-ticket', 'hello');
    await page.click('#ticket-send-r-ticket');

    const status = page.locator('#ticket-status-r-ticket');
    await expect(status).toContainText('next update');
    await expect(status).not.toContainText('PGRST202');
    // And the text is kept so it is not lost.
    await expect(page.locator('#ticket-reply-r-ticket')).toHaveValue('hello');
});
