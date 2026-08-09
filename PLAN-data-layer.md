# Plan: one data layer

**Status:** proposed, not started. Ships as `chore/data-layer`, before v0.12.

## The problem, stated precisely

It is not "a mix of local and cloud". Almost every dataset already has a
database table, and that table is already the source of truth. The problem is
narrower and worse:

> **The browser reads a committed artifact, while the owner edits the table.**

Those artifacts refresh only when the `regenerate.yml` workflow runs. So the
loop is: edit → saved to the database → **invisible on the site** until a
workflow run that nothing prompts you to do.

That single gap caused three separate confusions on 2026-08-09 alone:

| Symptom | Actual cause |
|---|---|
| Archived "Source Code" button still on both dashboards | `navigation.json` not regenerated |
| Reordered Start Here list did not change the site | `renderHubList` read `site_meta.json`, not the table |
| A tool that said "Live immediately" and was not | I wrote the hint against the wrong mental model |

The third is the tell. The rule was never written down anywhere, so each new
renderer picked a source by whatever the file next to it happened to do.

## Inventory

| Artifact | Table behind it | Read at runtime by | Read at build by |
|---|---|---|---|
| `data/navigation.json` | `site_pages` | 6 call sites | `generate-pages`, `generate-sitemap`, `validate-navigation` |
| `data/site_meta.json` | `site_meta` | `site_meta.js` (version/tagline) | `generate-hub-meta` |
| `data/faq.json` | `site_faq` | `home_widgets.js` | — |
| `collaborators_data.json` | `site_collaborators` | collaborators page | — |
| `data/archived-pages.json` | `site_pages.status` | `isEntryPointHidden` | `generate-pages` |
| `data/page-previews.json` | `page_data` | — | `generate-pages` |
| `data/updates.json` | **none** | update log + homepage | — |
| `tierlist_data.json` | `page_data` | tierlist page | — |

## Three rules

**1. The database is the runtime source for anything the owner can edit.**
The committed file is a fallback for when Supabase is unreachable, never the
primary. A save must be visible on reload, with no workflow run in between.

**2. Artifacts exist for build consumers and crawlers, not for the browser.**
`generate-pages.js` must stay offline and deterministic — CI compares committed
stubs byte-for-byte. `sitemap.xml`, `robots.txt` and the OG tags are fetched as
files by crawlers and unfurlers that do not run JavaScript. Those keep their
artifacts. The browser stops reading them.

**3. One module owns every read.**
`js/site_data.js`. Each dataset declares `live` (table first, file fallback) or
`static` (file only, with the reason). The policy being emergent rather than
declared is exactly what allowed rule 1 to be violated three different ways.

## What changes

- **`navigation.json` → live.** The big one. Reading `site_pages` at runtime
  also carries `status`, which means **`archived-pages.json` stops being a
  runtime concern entirely** — archived is just a filter on the same query.
  That whole class of "I archived it and it is still there" disappears.
  In-memory cache per page load, not `sessionStorage`: one query per page is
  cheap, and a stale cache is the bug being fixed.
- **`faq.json`, `collaborators_data.json`, `site_meta.json` → live.**
- **`updates.json` → needs a `site_updates` table.** Today, publishing a
  changelog requires a commit. It is the only owner-facing content still
  hand-edited in the repo.
- **`page-previews.json`, `archived-pages.json` → static, build-only.** Stated
  as a decision rather than left as an accident.
- **`generate-*.js` keep reading files.** Unchanged, deliberately.

## Guardrails, so this cannot recur

**`scripts/check-data-sources.js`**, wired into `npm run preflight`: fails if
any file in `js/` reads a `data/*.json` that has a table behind it, unless it
goes through `js/site_data.js`. Mechanical, and it would have caught the
`renderHubList` bug before it shipped.

**Source-of-truth tests.** The existing specs mocked the JSON file and asserted
the page rendered the mock. That passes whether the page reads the file or the
table — it only ever proved the renderer works. The pattern that works is to
make the two sources **disagree** and assert the table wins. Already applied in
`tests/hub-content-source.spec.js`; extend to every live dataset.

**`npm run preflight`** = `validate` + `test` + the new check, so there is one
command rather than a list to remember.

## What this is not

Not "move everything to the cloud". Four things genuinely must stay as files,
and moving them would break CI determinism or make the site invisible to
Discord and Google. The goal is one clear rule per dataset, not one storage
location for all of them.
