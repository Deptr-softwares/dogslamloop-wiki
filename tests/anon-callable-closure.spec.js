// A function anon may call is only usable if everything IT calls is reachable
// by anon too.
//
// This exists because 20260827000001 broke exactly that and nothing caught it.
// The sweep rewrote "Anyone can read published tier lists" to call is_staff(),
// correctly granted is_staff() to anon - the policy has no TO clause and anon
// holds SELECT on tier_lists, so every reader evaluates it - and then stopped.
//
// is_staff() is deliberately NOT SECURITY DEFINER, so it runs as the CALLER.
// It calls role_rank(), which 20260825000001 explicitly revoked from anon. An
// anonymous visitor would have reached the policy, entered is_staff(), and hit
// "permission denied for function role_rank" where a tier list should be.
//
// EXECUTE on the entry point is not the permission that matters. The whole
// call chain is. get_my_role() was granted to anon back in 20260803000002 for
// this reason, which is why that half of is_staff() worked and the other did
// not - and why a test asserting only "is_staff is granted to anon" would have
// stayed green through the entire regression.
//
// SECURITY DEFINER functions are exempt: they execute as their owner, so their
// callees are reached with the owner's privileges rather than the caller's.
// That exemption is the reason this check has to read the definition and not
// just the grants.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

// Replay every migration in order: last definition wins, last grant wins.
function schema() {
  const defs = new Map();     // name -> { text, definer, file }
  const anonExec = new Map(); // name -> boolean

  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');

    const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"public"\."([a-z_0-9]+)"/gi;
    let m;
    while ((m = fnRe.exec(sql))) {
      const end = sql.indexOf('$$;', m.index);
      const text = sql.slice(m.index, end === -1 ? sql.length : end + 3);
      defs.set(m[1], { text, definer: /SECURITY\s+DEFINER/i.test(text), file: f });
    }

    // Grants and revokes, in file order, so a REVOKE after a GRANT wins.
    const aclRe = /(REVOKE|GRANT)\s+(?:ALL|EXECUTE)[^;]*?ON\s+FUNCTION\s+"public"\."([a-z_0-9]+)"[^;]*?(?:FROM|TO)\s+((?:PUBLIC|"anon"|"authenticated"|[a-z_]+))[^;]*;/gi;
    let a;
    while ((a = aclRe.exec(sql))) {
      const [, verb, name, who] = a;
      const target = who.replace(/"/g, '').toUpperCase();
      if (target !== 'ANON' && target !== 'PUBLIC') continue;
      anonExec.set(name, verb.toUpperCase() === 'GRANT');
    }
  }
  return { defs, anonExec };
}

// Calls to this project's own functions, from inside a body.
function calleesOf(text) {
  const out = new Set();
  // "public"."name"(  and  public.name(
  for (const m of text.matchAll(/"public"\."([a-z_0-9]+)"\s*\(/g)) out.add(m[1]);
  for (const m of text.matchAll(/(?<!")\bpublic\.([a-z_0-9]+)\s*\(/g)) out.add(m[1]);
  return out;
}

test('every function anon may call can reach everything it calls', () => {
  const { defs, anonExec } = schema();

  const anonCallable = [...anonExec.entries()]
    .filter(([, granted]) => granted)
    .map(([name]) => name)
    .filter(name => defs.has(name));

  expect(anonCallable.length, 'the replay found functions granted to anon')
    .toBeGreaterThan(0);

  const problems = [];
  for (const name of anonCallable) {
    const def = defs.get(name);
    // Runs as its owner, so its callees are not reached as anon.
    if (def.definer) continue;

    for (const callee of calleesOf(def.text)) {
      if (callee === name) continue;
      if (!defs.has(callee)) continue;          // built-in or another schema
      if (anonExec.get(callee) === true) continue;
      problems.push(
        `${name}() is callable by anon but calls ${callee}(), which anon cannot execute`
        + ` — ${name} is not SECURITY DEFINER, so it runs as the caller (${def.file})`);
    }
  }

  expect(problems).toEqual([]);
});

test('is_staff is the case this was written for', () => {
  // Named explicitly as well as covered by the sweep above, because the generic
  // test passes the moment somebody "fixes" it by making is_staff a definer -
  // which would be the wrong fix and would silently exempt it from the check.
  const { defs, anonExec } = schema();

  const isStaff = defs.get('is_staff');
  expect(isStaff, 'is_staff exists').toBeTruthy();
  expect(isStaff.definer, 'and stays a plain STABLE function - it crosses no RLS boundary')
    .toBe(false);

  expect(anonExec.get('is_staff'), 'anon evaluates the tier_lists policy that calls it').toBe(true);
  expect(anonExec.get('role_rank'), 'so anon must be able to execute what it calls').toBe(true);
  expect(anonExec.get('get_my_role'), 'granted back in 20260803000002 for the same reason').toBe(true);
});
