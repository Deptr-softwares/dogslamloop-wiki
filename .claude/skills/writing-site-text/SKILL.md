---
name: writing-site-text
description: The owner's voice for text readers see on dogslamloop.com (guide and policy pages, notices, UI labels, empty states, error messages) and their rules for Update Log entries. Use when writing or editing that text, grammar-checking a draft the owner hands over, sorting change notes into Features, Fine-tuning and Bug fixes, putting the owner's entry into data/updates.json, or rendering the Discord post.
---

# Text readers see

The owner writes the Update Log, the devlogs and the guide pages. Text written here is the UI copy that ships with code (labels, notices, empty states, errors) and grammar fixes on the owner's drafts. For anything about an Update Log entry, read [update-log.md](update-log.md).

## On the owner's draft

Grammar and spelling only. Keep their wording and register, list every edit, and flag (don't fix) a line that does not match what changed. Their Manual of Style is American English. Their typos are not their style: don't copy *"editting"*, *"appropiate"*, *"every articles"* or *"PLaystyle"* into new text.

## The owner's voice

Read off their own pages: the **Writing Guide** (`page_data`, `page_id = 'writing_guide'`, tabs `basics` / `character-pages` / `combos` / `frame-data`) and **Terminologies** (`page_id = 'terminologies'`, tabs `archetypes` / `mechanics`). Read those, not this summary, when the register matters.

- **Write to whoever is actually reading.** Their guide says pages other than character pages *"can mention or refer to the reader"*, so "you" is right on a guide or policy page. "Never write 'you'" is a changelog rule only: in a changelog the only "you" is the owner.
- **Warm opener, then hard rules.** *"Hello! Welcome to the Writing Guide of Dogslamloop Wiki."*, and two headings later a numbered list of grounds for rejection.
- **Named concepts, capitalised and reused.** Ground for Rejection, Combo Card, Workspace Header, M1 Merchant, Neutral. Never invent a second name for something they have named.
- **A term, a colon, then one sentence that ends.**
- **Right and wrong shown, not described.** `[s]granite blast[/s], Granite blast`: strikethrough for the wrong form, green for the right one, red for anything that gets an edit rejected.
- **Permitted and not permitted as a pair** of lists, not one list with exceptions buried in it.
- **Pre-empt the misreading in the same breath.** *"It is not a bad thing to be an M1 Merchant, but..."*
- **Rules carry their limit.** *"so long as these tones don't undermine or break the baseline set by the Guide, they are fine to stay"*.
- **Humour in small doses that never costs information.** Their rule: *"don't get to the point where information is bogged down by humor."*
- **Honest placeholders.** *"To be completed"*, never filler pretending to be content.
- **Numbers and concrete examples over adjectives.** *"a 14f M1"*, *"word limit of 50"*, *"#F4CC43"*.

Policy, licence and reference text states the rule and stops, and no text anywhere uses an em-dash (both in `CLAUDE.md`, Conventions).
