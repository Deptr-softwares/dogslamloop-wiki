---
paths:
  - "supabase/functions/**"
---

# The Discord relay

- `supabase/functions/discord-relay` deploys on merge to `main` because `supabase/config.toml` declares it, and Supabase Cron calls it every 10 seconds.
- **Live on production since 2026-10-07** (v1.0 Part 1, #223) with the owner's secrets, so a merge that changes the relay changes what happens on the real Discord server. Try relay changes on a preview against the owner's test server first.
- **Its bot token and webhook URLs live in Supabase secrets, set by the owner, and never appear in this repo, in CI or in a chat message.** Without them the relay does nothing, which is what a preview gets unless secrets are set on that branch (`supabase secrets set --project-ref <branch ref>`).
- Its rules are plain JS in `supabase/functions/_shared/`, tested in Node.
- Attachments are copied into Supabase Storage, never linked from Discord's CDN.
- A fake standing in for the database keeps the real thing's state over time (first call wins, counters, leases). The v1.0 relay skipped every first post on the live server because its fake answered "when was the forum connected" with a fixed time.
