---
name: building-a-change
description: How to implement a feature, fix or cleanup in this project so it fits what exists and leaves the code smaller where it can - read every place the thing is set first, change the base instead of adding on top, remove code only with proof, check the tools that check the work, and prove the result with the snapshot, the budgets and tests that fail when it breaks. Use when building any item of a batch, rewriting CSS or shared code, deleting code thought dead, or running a script that rewrites many files.
---

# Building a change

CLAUDE.md's "Writing code here" holds the rules and the practice files in `.claude/rules/` hold their incidents. `writing-tests` says how to prove a change. This is the order of work that held up through Stage C, and the mistakes it is there to catch. Scoping comes first (`scoping-a-batch`).

## Before writing

- Read every place the thing is set, not the first one found. In JS that is every caller and every page that loads the file. In CSS it is every rule on the element, in every sheet and both looks: grep the class, then read the computed style and the rules behind it in a browser.
- Know which files each kind of page loads, and in what order (`PAGE_SCRIPTS` and `PAGE_STYLES` in `scripts/page-scripts.js`). Order settles ties: `Badges.css` loads before `Layout.css` on a character page and after it on the privacy page, and a moved page's notice loads four sheets and no script at all.
- Search for an existing helper by what it does, and reuse it (`practice-new-code.md`).

## Change the base, not on top

- Put a value where it belongs and state it once. A rule whose only job is to undo another (a `revert` to the browser's value, a `:not(:where(...))` carve-out, a reset patching what a revert broke, an override for one page) is a second copy of one decision, and the copies drift. In the looks, the plain part says what Classic draws and the Dogslamloop part only what Default draws differently (`docs/looks.md`).
- When the goal is lighter code, the diff removes more than it adds, and the page budgets come down in the same PR.
- No option or layer for a case that does not exist yet. Something new beside an existing mechanism has its reason in `docs/`.

## Removing code

- Dead means taken out on a page that draws the element, in the state it names (hover, focus, a phone width, reduce motion), with nothing changed. A check that never holds the element in hover, or a page that never draws it, proves nothing about it (`practice-css.md`). What could not be tried stays, or is argued from the selector alone and the PR says so.
- A rule older than the change under way stays even when it tests dead: its value can matter where the tested pages do not show it.
- A value and the patch that undoes it are each live while the other is there, so taking them out one at a time keeps both. Try the pair together.

## Scripted rewrites

- A script that edits many files runs on a committed tree, and its whole diff is read afterwards. Three of C-3b's rewrite scripts broke something only the diff showed: a comment eaten with a rule, half a selector left glued to the next rule, a comment read as part of a property name.
- A script with backslashes in it is written to a file with the Write tool. A heredoc or `sed` through Git Bash eats them.

## Check the checker

- A tool that reports "no change" or "nothing left to remove" is code too. Before trusting it, run it on a case it must catch and a case it must pass, and run it against the same tree more than once. The removal script behind #319 read `::before` and `::after` for its baseline and not for its tests, and called 836 of 846 declarations live; fixed, it found 365 dead. The snapshot called History different from itself until it held every video still.

## Prove it

- Nothing visible changed: `npm run snapshot -- --base=<the last merge>` on all its pages. A difference in the specimen counts until every page that draws that element is found and none of them loads these sheets.
- Behaviour: a test that drives the real control, seen failing with the change reverted, and mutation probes on committed code (`writing-tests`).
- The specs related to the change (grep for what it touches), at most 2 workers, never the whole suite; `npm run generate` after a CSS or JS edit; `npm run validate` and `npm run lint`; CI read after every push.

## Commit and report

- One item, or one step of an item, per commit, with its proof in the message. Commit before probing, so every restore comes from a commit.
- Report what changed, what broke along the way (Claude's own wrong claims first), what was verified and against what, and what was not. When this work shows an earlier PR's notes or docs wrong, the same PR corrects them.
