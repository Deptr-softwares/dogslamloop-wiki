---
name: scoping-a-batch
description: How to plan and scope a batch in this project before any code is written - turn the owner's goal into a check that can fail, measure where things stand, find the model the change must fit, size and order the items, ask only the owner's calls, and write the scope back for an OK. Use when the owner says "let's start batch N", "scope the next batch" or "what's next", hands over a roadmap item, feedback or a new direction in the middle of a batch, or when a batch is about to be built with no scope written back.
---

# Scoping a batch

A batch goes wrong before its first line of code when nobody said what "done" means, or when the plan is a list of things to add on top of a structure nobody looked at. C-3a flipped the looks with no weight target and took a character page's CSS from 51.7 to 55.2 KB gzipped. C-3b's target and C-3c's model (the owner: "Classic Look > Dogslamloop Look") brought it to 49.0.

The loop itself (multiple-choice questions, the write-back, one PR open at a time) is the `batch-workflow` skill. This is what this project adds to scoping. Building each item is the `building-a-change` skill.

## 1. Turn the goal into a check

- Quote the owner's words and the roadmap entry. Ask what the item is for, not only what it is: lighter pages, one look system, fewer copies, a feature readers asked for.
- Write the goal as something a run can fail: a size ("every reader page's CSS under its size before #318"), a count ("no palette colour written as a literal"), a snapshot ("nothing visible changes"), a test that drives the real control. A goal with no check is met by feel.
- Say what must not change, and what shows it did not: `npm run snapshot`, the page budgets, the content gate, an existing spec.

## 2. Measure where things stand

- Numbers before opinions: gzipped size per kind of page (`tests/page-weight.spec.js` measures it), how many copies of a thing, how often live content uses it. "20 colours cover 89% of 827 uses" settled the palette's size in one line.
- Read how the code got this way: `git log -S`, the area's `docs/` Decisions, the PR that wrote it. C-3a's flip was generated from v1.2's Classic file, which was written to undo Default; that one fact explained 187 reverts.
- A measurement that says "stop, there is nothing more to gain" is checked like code: what would it show if it were wrong? #319 recorded the flip's CSS as near-minimal on the word of a removal script with a bug in it.

## 3. Find the model before the list

- Name where the change lives and what its base is: a Block type through the editor's `blockTemplates`, a box through `window.openDialog`, a shared helper in its `site_utils` part, a colour in the palette, a look as Classic's rules plus Default's additions. The change fits the model; it does not sit on top of it.
- A plan that adds something to undo something else (a revert, a carve-out, an override for one page, a second copy "just here") means the base is wrong. Plan the fix to the base.
- Something new beside an existing mechanism needs its reason in the area's `docs/` page (`practice-new-code.md`).

## 4. Size and order

- 3 or 4 finished items per PR. An item too big for that becomes a batch of its own (C-3 became C-3a, b and c).
- Repair first when later items build on it: C-3b cleaned up the flip before the palette, so each colour was converted once, not in 144 copies.
- A target that cannot be met without a visible change stops the batch and goes back to the owner. It never bends a "nothing visible changes" the owner asked for.

## 5. Ask, then write back

- Ask only the owner's calls: how it looks, how it behaves, what to give up. Multiple choice, the recommended option first, each with its cost (KB, a visible change, an earlier decision reversed). Visual choices get mockups.
- Say plainly when a pick reverses an earlier one: "Follow the reader's pick" reversed v1.2's Classic for reader pages only.
- The write-back holds the owner's words verbatim, the checks from step 1, the measured start from step 2, and Claude's own calls marked as reversible. Save it to memory and wait for the OK. Anything sent with the OK joins the batch.
- A direction the owner gives in the middle of a batch is scope. Quote it, measure whether it holds, change the plan and say what changed: "Classic Look > Dogslamloop Look" came with the go-ahead for C-3c and became its first item.
