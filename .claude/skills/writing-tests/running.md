# Running specs and reading the result

## Contents
- Lean on CI
- Derive the set
- Read the counts
- Read a red CI run
- One suite at a time

## Lean on CI

Locally, run the specs a change touches plus `npm run validate`, not the full suite: CI runs everything. Read CI after every push.

## Derive the set, don't guess it

- **For a change of default behaviour, the neighbours are every spec that relied on the default.** v0.16's collapsed blocks broke ten tests in five files nobody would have picked. Grep for the markup and globals the change touches:
  ```bash
  npx playwright test $(grep -rln "block-list\|block-card\|editor-textarea" tests/*.spec.js | tr '\n' ' ')
  ```
- **Grep by the surface the change appears on, not the symbols it renames.** A UI-driving spec knows a page as `owner.html` and `#pages-list` (PR #162: 4 specs by identifier, 33 by surface).
- **Grep by content, never by filename.** On 2026-10-12, specs picked by name missed `discussion-images.spec.js`; a content grep found 15.
- **Grep for what was deleted too.** A spec can grep a source file for a literal the change turned into generated output (`theorybox.spec.js` and `data-type="theorybox"`):
  ```bash
  git diff -U0 | grep '^-' | grep -o '[a-z-]*="[a-z_-]*"' | sort -u
  ```
  Point such a test at the new source of truth rather than loosening it.
- **A selector that exists in only one state encodes the default.** `.block-card-summary` exists only on a collapsed block, so flipping the default turned 18 tests into timeouts.

## Read the counts

```bash
npx playwright test <files> --reporter=line > run.log 2>&1
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" run.log
```

Anything other than a single `N passed` line is not green. Never `tail` the output: the line reporter prints failures above the passed count, and a tail once showed "27 passed" under 18 failures (PR #203, then cancelled at CI's 30-minute cap, which prints no failure report). Check the log has lines before trusting a zero from it.

## Read a red CI run

Check the conclusion (CANCELLED is not FAILURE), compare the duration with a normal run, then pull the assertion:

```bash
gh run view <id> --log-failed | grep "Error:"
```

A local pass does not make a CI failure flaky.

## One suite at a time

One dev server on a fixed port serves every worker. Two concurrent runs report different test counts and scattered failures (v0.15: 519, 951, 975 and 984 of the same 980). Re-run failures alone before believing them: a failure that passes alone is load, one that fails alone is real. Never change the working tree while a suite runs; that run's output means nothing.
