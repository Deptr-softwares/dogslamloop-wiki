---
paths:
  - ".github/workflows/**"
  - "scripts/**"
  - "characters/*/index.html"
  - "systems/*/index.html"
---

# The regeneration job

- `regenerate.yml` must push generated artifacts past rulesets that reject direct pushes. It checks out over SSH with a deploy key (`secrets.REGEN_DEPLOY_KEY`) that is in both rulesets' bypass list. The default `GITHUB_TOKEN` cannot do this: `github-actions[bot]` is not a user, team or installed app, so no bypass list can name it.
- It runs the full suite before committing, so the bypass skips no check the job does not perform on itself.
- `workflow_dispatch` carries `publish_to_main`, default off; ticked, it regenerates `main` as well as `next-update`. The nightly cron never sets it, so a scheduled run cannot deploy.
- **Each branch regenerates from Supabase with its own code. Never copy generated files across.** Stubs embed an asset stamp derived from `js/`, so two branches with different unreleased JS produce different stubs, and copying either way stamps every page wrongly. So `main` and `next-update` each carry their own `chore: regenerate` commits (the back-merge check excludes them), and release PRs conflict on stubs: regenerate, never hand-merge.
- The job's write set must cover its check set: anything `npm run validate` checks, the job must also rewrite.
