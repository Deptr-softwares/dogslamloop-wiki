# Mocking Supabase in specs

The site creates its client once, at script-parse time, in `js/site_utils.js`:

```js
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
```

So a mock has to be in place **before that line runs**. `page.addInitScript` plus a setter on `window.supabase` intercepts `createClient` and patches only the pieces a given test needs, leaving the real client for everything else.

## The pattern

```js
async function mockAuth(page, { role = 'admin', rows = [] } = {}) {
  await page.addInitScript(({ role, rows }) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);

            client.auth.getSession = async () => ({
              data: { session: {
                // email is REQUIRED - getDisplayName and editor-core's
                // fallback both call session.user.email.split('@'), so a
                // session without one throws during boot and handlers are
                // never attached.
                user: { id: 'u1', email: 'test@example.com' },
                access_token: 'tok',
              } },
            });

            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role }], error: null }) };
              }
              return origFrom(table);   // everything else hits the real thing
            };

            client.rpc = async (name, params) => ({ data: rows, error: null });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { role, rows });
}
```

`__patched` matters: the setter can fire more than once, and re-wrapping compounds the patch.

## Query-builder chains

`supabase-js` chains are thenable at any point. Mock only the methods the code under test actually calls, and end the chain where it awaits:

```js
// .from().select().eq().order()  -> awaited after order()
const chain = {
  select() { return chain; },
  eq() { return chain; },
  order: async () => ({ data: rows, error: null }),
};

// Two .order() calls before awaiting: count them
let orderCalls = 0;
const chain = {
  select() { return chain; }, eq() { return chain; },
  order() {
    orderCalls++;
    return orderCalls >= 2 ? Promise.resolve({ data: rows, error: null }) : chain;
  },
};
```

Declare that counter **inside** `client.from`, so each query gets a fresh one.

For a chain awaited directly, give it a `then`:

```js
const chain = {
  select() { return chain; }, eq(k, v) { filters[k] = v; return chain; },
  then(resolve, reject) {
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  },
};
```

Recording `filters` lets a test assert the query was *scoped* correctly — that a listing really filtered on `status = 'published'` rather than filtering in the renderer.

## Capturing writes

```js
insert(payload) { window.__writes.push({ op: 'insert', payload }); return Promise.resolve({ error: null }); },
update(payload) {
  return { eq: (col, val) => {
    window.__writes.push({ op: 'update', payload, val });
    return Promise.resolve({ error: null });
  }};
},
```

Then `await page.evaluate(() => window.__writes)`. Assert the payload, not just that something happened — several bugs here were wrong values in a write that did occur.

## Match the real call signature

A mock looser than the real call passes while the code is wrong. `.upsert(payload, { onConflict: 'page_id' })` is one call, not `.upsert(payload).onConflict(...)` — mocking the latter would pass against code that could never work.

## Gates that run before your assertion

Pages have guards that will short-circuit a test if unsatisfied:

- **RBAC gates** (`admin-core.js`, `owner.js`, `post-editor.js`) retry once over ~600ms before denying, so allow >1.2s or wait on a locator rather than a fixed timeout.
- **`kickUser()` replaces `document.body.innerHTML` entirely** — an unauthenticated `page.goto` destroys the markup under test.
- **The editor's submit pipeline** checks page permissions, a 3-minute localStorage cooldown, and a live collision fetch before opening the QA modal. That path is legitimately slow; wait for the outcome, don't sleep.
