// The Discord relay (v1.0 batch 1). Supabase Cron calls this every 10 seconds
// through pg_net (public.discord_relay_tick, 20261004000000_discord_relay.sql).
//
// All of the work is in ../_shared/discord-relay-tick.mjs, which the test suite
// runs in Node. This file only checks the caller and hands over the
// environment, a service-role client and fetch.
//
// verify_jwt is off for this function (supabase/config.toml): the anon key is
// in every page's source, so a valid JWT proves nothing about the caller. The
// guard is RELAY_SECRET, which only Vault and this function's secrets hold.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runTick } from '../_shared/discord-relay-tick.mjs';

function sameSecret(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

Deno.serve(async (req: Request) => {
    const secret = Deno.env.get('RELAY_SECRET') || '';
    const given = req.headers.get('x-relay-secret') || '';
    // A wrong or missing secret looks like no function at all.
    if (!secret || !sameSecret(given, secret)) {
        return new Response('Not found', { status: 404 });
    }

    const db = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
        { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const report = await runTick({ env: Deno.env.toObject(), db, fetch });
    return Response.json(report);
});
