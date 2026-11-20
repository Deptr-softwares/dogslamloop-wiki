---
paths:
  - ".github/workflows/**"
  - "scripts/**"
  - "characters/*/index.html"
  - "systems/*/index.html"
---

# The regeneration job

- `regenerate.yml` must push generated artifacts past rulesets that reject direct pushes. It checks out over SSH with a deploy key (`secrets.REGEN_DEPLOY_KEY`) that is in both rulesets' bypass list. The default `GITHUB_TOKEN` cannot do this: `github-actions[bot]` is not a user, team or installed app, so no bypass list can name it.
- It commits generated files only, and checks them before committing: `npm run validate`, then the content gate (`npm run test:content`, the list in `playwright.content.config.js`). The code beside them passed the full suite on its PR, and the suite runs again on the commit the job pushes (a deploy key's push triggers `playwright.yml`). The full suite was the gate until v1.2 (owner, 2026-11-17).
- A spec whose Node side reads a generated file belongs in the gate's list. `tests/content-gate.spec.js` fails a PR that adds one without listing it.
- Both branches regenerate at once: each leg has its own runner and pushes to its own branch.
- `workflow_dispatch` carries `publish_to_main`, default off; ticked, it regenerates `main` as well as `next-update`. The nightly cron never sets it, so a scheduled run cannot deploy.
- **Each branch regenerates from Supabase with its own code. Never copy generated files across.** Stubs embed an asset stamp derived from `js/`, so two branches with different unreleased JS produce different stubs, and copying either way stamps every page wrongly. So `main` and `next-update` each carry their own `chore: regenerate` commits (the back-merge check excludes them), and release PRs conflict on stubs: regenerate, never hand-merge.
- The job's write set must cover its check set: anything `npm run validate` checks, the job must also rewrite.
- Every run writes a summary to its own page (`scripts/regen-summary.js`, appended to `$GITHUB_STEP_SUMMARY`): what it fetched, and on a failure which content check stopped it and its error. The script never fails the job.
