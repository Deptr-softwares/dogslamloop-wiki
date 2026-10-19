# The Update Log

The owner writes every entry (2026-10-18), at the release, from the devlog. This file is for sorting what the devlog records into the three parts the way they would, for a grammar pass that never undoes their choices, for putting their entry into `data/updates.json`, and for the Discord post. It is not a licence to rewrite their entry.

## Contents
- The shape in `data/updates.json`
- The three parts
- The owner's rules for an entry
- The Discord post

## The shape in `data/updates.json`

Newest first. A heading is an object, a change is a string:

```json
{
  "version": "Release v1.0",
  "date": "10/11/2026",
  "type": "site",
  "title": "The 'Nothing' Update",
  "description": "One or two sentences.",
  "changes": [
    { "heading": "Features" },
    "One visible change per line.",
    { "heading": "Bug fixes" },
    "Another line."
  ]
}
```

- `date` is MM/DD/YYYY.
- `version` copies the label `site_meta` carries, exactly as the owner set it in owner tools ("Beta v0.19", "Stable v0.20", "Release v1.0").
- Entries before v0.17 are flat string arrays and still render: `buildUpdateChangesHTML` (`js/home_widgets.js`) opens an unheaded list and starts a new one at each heading. A heading is an object so that a change line reading "Bug fixes" can never turn into one.
- Verify the entry renders on `/systems/updatelog/index.html`.

## The three parts

Every release uses Features, Fine-tuning and Bug fixes, in that order (owner, 2026-09-03).

| Part | What goes in it |
|---|---|
| **Features** | Something that did not exist before |
| **Fine-tuning** | Something that existed and is now better |
| **Bug fixes** | Something that was broken and now works |

- A part with nothing in it is left out, not left empty.
- Features or Fine-tuning is decided by what the reader meets, not the tool it lives in: the heavy-clip warning is Features although it sits in the existing Media Library.
- Invisible work is one bare line at the end: "Changed a few things under the hood." Never qualified. The owner cut "...including two places where text typed into a heading could be read as code" in v0.18; a security fix is not itemised to readers.

## The owner's rules for an entry

Collected from the drafts they cut and rewrote (v0.12, v0.18, v0.20).

1. The reader is a player using the wiki. Every line is something a visitor can picture on the site.
2. Never "you": in a changelog it can only mean the owner.
3. Simple and short, not jokey. No explaining an internal problem the reader never saw.
4. A number that IS the feature stays ("up to 4 images", "1080p or over 2 MB"). A measurement that needs its page for context goes ("no clip stays blank for over 2 seconds, down from 8" was cut).
5. When a change has an invisible cause and a visible result, the result is the line.
6. A bug-fix line is the outcome, never the mechanism: "Reordering the tabs on a guide page now saves."
7. Name the exact surface: "Tier lists' editor uses the character portraits", because the reader page already did.
8. No hedging that a new feature starts empty.
9. A detail of a feature already announced does not get its own line.
10. One clause per line. A trailing "and ..." or a second sentence is usually the part to cut.
11. Say what it is for in plain words, not how it works or the component's name: "Clips load in order to reduce lag and clips that won't load".
12. The feature's own name is the line, in their register: "Add ..." for a feature, "Fixed where ..." for a fix ("Add Matchup Clash to the Matchup Table").
13. No intensifiers: "the real character portraits" became "the character portraits".

"Matchup Chart" and "Matchup Table" are interchangeable to the owner: not a slip.

## The Discord post

Rendered from the entry in `data/updates.json` after the owner has seen it, never from a separate draft (in v0.18 the two were drafted together, edited apart, and then disagreed). Their lines, unchanged:

```
**Release v1.0**
**The 'Nothing' Update**

One or two sentences of context.

**[Features]**
change
change

**[Fine-tuning]**
change

**[Bug fixes]**
change
```

- `**` bolds the version, the title and each heading. The version and the title go on separate lines (owner, 2026-09-09).
- No hyphens and no bullet characters.
- Same parts in the same order as the entry; an empty part is left out of both.
