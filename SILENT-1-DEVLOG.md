# Silent release 1 — owner tools

**Not v0.18, and not on the roadmap** (owner, 2026-09-04). No version bump, no
changelog entry, no Discord post. `V0.18-DEVLOG.md` sits alongside this file and
stays untouched — when v0.18 is scoped it is scoped independently of everything
here.

Requirements as written by the owner: `devlogs/SilentRelease1.txt`. Eleven
items, eight of them missing capability in the owner tools and three of them
bugs. This file records what each one turned out to be on inspection, because
several are not what their one-line description suggests.

**Why silent:** every item is a tool only the owner can open. A reader cannot
point at any of it, and the test for silent is "can a reader point at it"
rather than "is it small". Some of this is neither small nor invisible in
effort.

---

## The diagnosis pass

Read before building anything, and it changed the batching twice. Three items
turned out to share one root cause, and one "missing feature" is a data-loss
bug.

### Confirmed by reading the code

**The expert could not reach the queue they were given** *(bug 1)*. v0.17 gave a
page expert review rights over their own pages — the queue policies read
`can_review_page()`, which is `is_staff()` OR a `page_experts` row
(`20260903000001`). That half shipped and works; the post-release production
probe confirmed it. Neither client gate learned the word "expert":
`js/admin-core.js:285` kicked them to ACCESS DENIED and `js/pagebuilder.js:429`
drew no OVERSEER button. **The badge rendered on their profile the whole time**,
which is what made it look like a display bug.

`pagebuilder.js` already carried a comment saying those two gates are changed
together or not at all, from the previous time they drifted. They drifted again,
in the one direction `moderator-access.spec.js` did not cover.

**APPLY threw away every capability** *(bug 3)*. `assign_role_by_email` has been
`DELETE`-then-`INSERT` since `20260808000000`, and the INSERT names
`(user_id, role)`. `bypass_cooldown`, `can_moderate` and `can_delete_media` came
back as column defaults — FALSE — every time a role was applied.

Nothing errored, which is why it lasted this long. `set_user_capability` wrote
TRUE correctly; APPLY discarded the row a moment later. **Two tools that each
worked, in an order that lost data.**

**A user with no role does not exist to the owner tools** *(reqs 4 and 6,
and probably bug 2)*. `list_personnel()` is
`FROM user_roles ur JOIN auth.users u` — an inner join from the role table. A
signed-in account with no role has no `user_roles` row and therefore **never
appears in the roster at all**. That single fact explains:

- *"no way to add moderators perk to a regular authenticated user"* — there is
  no row to tick a box on;
- *"shifting through people mail address on Supabase Dashboard is extremely
  inconvenient"* — the roster can only ever show people who already have roles,
  so a new expert on a burner address is unfindable by construction;
- and very likely bug 2, below.

`set_user_capability` refuses roleless users too, deliberately:
*"No role assigned to % — give them a role before granting a capability."*
Whether that rule survives is a design question, not a bug fix — see Open
questions.

**FAQ has no update path** *(req 2)*. `js/owner.js` does `select`, `insert` and
`delete` against `site_faq` and nothing else. Add and remove work; edit was
never built.

**Tier-list contributors have no revoke** *(req 5)*. `js/owner-tier-lists.js`
has no remove path. Mirrors `revoke_page_expert`, which does exist and is the
shape to copy.

### Not confirmed

**Bug 2 — "the button to grant moderate discussions doesn't work"**. I could not
reproduce this from the code with confidence, and I am not going to claim it is
fixed.

What I can see: the checkbox is rendered `disabled` when the person already
meets `reviewer` (`js/owner.js:228`), with the reason in a `title` tooltip and
nowhere else. On a reviewer or above, clicking it genuinely does nothing — and
that is intentional, tested behaviour (`user-capabilities.spec.js:121`), because
moderation comes with the role.

So the two candidates are: the person clicked was staff and the box was
correctly inert, or the person wanted was roleless and never in the list. **Both
are addressed by the roster work, not by touching the checkbox.** Asked of the
owner rather than guessed.

---

## Batches

Three to four items each, because CI is ~13 minutes and that wait dominates a
small fix.

**PR 1 — the two confirmed bugs.** Expert access, and the capability wipe.
Merged as [#159](https://github.com/Deptr-softwares/dogslamloop-wiki/pull/159).

**PR 2 — the roster.** One root cause, three symptoms: find any account by
email or display name, not only those holding a role; grant a capability to a
roleless user; and bug 2's real answer. The biggest item in the list and the
one the owner hits daily.

**PR 3 — content tools.** FAQ edit, collaborator fields and edit, tier-list
contributor removal. Plus a regression PR 2 caused, found by sweeping.

**PR 4 — pages.** The Pages tool's single long column, and character colour
codes.

---

## PR 1 — what shipped

`20260904000000_preserve_capabilities_on_role_change.sql` moves the `DELETE`
into the revoke branch, where dropping the row **is** the intent, and upserts on
the assign path.

`ON CONFLICT ("user_id")` targets `user_roles_one_role_per_user`
(`20260801000000`), **not** the `(user_id, role)` primary key. Worth stating
because the PK looks like the obvious target and is the wrong one: it would not
conflict at all on a role *change*, so the insert would proceed and violate the
unique constraint instead.

`applyModeratorScope()` became `applyScope({ seesRevisions, seesMedia,
seesReports })`. The ways into the Overseer **compose** — an expert who also
holds the moderation capability is there for revisions *and* reports — and a
pair of mutually exclusive "only" flags could not express that. The moderator
path is unchanged in effect and its six existing tests still pass untouched.

### Falsified, not assumed

Both fixes were confirmed to fail before they passed, on committed code:

- Reverting `admin-core.js` and `pagebuilder.js` to their pre-fix state failed
  **exactly** the six new expert tests while the nine moderator tests kept
  passing — so they test the fix rather than merely breaking everything.
- Removing the migration failed four of the eight capability tests, including
  the load-bearing one. The other four pass against the broken version too,
  because they assert properties it also had. The positional assertion is what
  carries the claim: a `DELETE` must sit **inside** the `IF assigned_role IS
  NULL` branch. Asserting merely that a `DELETE` exists would have passed
  against the bug, which deleted too — one line too early.

`capability-preservation.spec.js` asserts against whichever migration *last*
defines the function, replaying all of them in order, rather than against the
file that fixes it today. A future `CREATE OR REPLACE` reintroducing the delete
fails there instead of shipping.

---

## PR 2 — what shipped

**Answered by the owner, 2026-09-04**, and both answers shaped the build:

- *Bug 2 was a reviewer or admin.* So the box was correctly inert — moderation
  comes with the role — and nothing about the logic was wrong. **Not a bug.**
  The failure was that the only thing saying so was a `title` attribute, which
  is invisible to somebody who has already clicked and seen nothing happen. The
  reason is now rendered text and the row dims.
- *Capabilities stand alone.* A roleless account may hold one.

That second answer hit a schema wall worth recording: `role` was `NOT NULL`
**and** half of `PRIMARY KEY (user_id, role)`, so a row could not exist without
one — and there is no neutral role to borrow, because `viewer` is a ban rather
than a floor.

Making `role` nullable is less invasive than it sounds, because **a NULL role is
already the contract everywhere else**: `get_my_role()` returns NULL for a
roleless user and every comparison against it uses `IS DISTINCT FROM` for
exactly that reason, `role_rank(NULL)` is 0, the CHECK is `role = ANY (...)`
which evaluates to NULL rather than FALSE and passes untouched, and the viewer
ban is `IS DISTINCT FROM`. One role per user is unchanged — the count is now
zero or one instead of exactly one.

The composite PK is dropped **to** `user_id` rather than kept alongside the
existing `UNIQUE(user_id)`, so `ON CONFLICT` has one arbiter index to infer and
not two identical candidates.

`search_users()` searches **display name as well as address**, because the
owner's scenario is an expert who "logged in using a burner mail" — the name is
the only thing they know. `LEFT JOIN`, or it would reproduce the very bug it
exists to fix. Owner-only, guarded inside the function, and a query under two
characters returns nothing: it is a lookup, not an export.

### Found while in there

**The role dropdown fell through to its first option — Administrator — for
anyone whose role was not in `ROLE_LABELS`.** That already meant every `owner`
row whenever the last-owner guard did not disable the select, and after this
change it would have meant every roleless account. Since APPLY applies whatever
is showing, it was a promotion waiting to happen. Now whatever the person holds
is rendered as a selected option, in the label table or not — which makes the
current value visible without making an unofferable role grantable.

### Falsified

Reverting **only** `js/owner.js` failed 11 tests and left the 9 SQL tests
passing — the split is the point: each half fails for its own claim rather than
everything collapsing together.

---

## PR 3 — what shipped

**Two of the three needed no migration at all.** `site_faq` and
`site_collaborators` have carried a `FOR ALL` policy on `is_owner()` with UPDATE
granted since `20260808000005`, and `site_collaborators` has carried `role`,
`avatar`, `badge_type`, `is_lead` and `links` from the start. The database has
permitted every one of these edits for a month; the tools simply never asked.
Four columns were readable on the public site and changeable nowhere.

Editing is **inline on the row**, not a modal — for the FAQ the paragraph
splitting is the thing most likely to surprise, and seeing the answer in the
shape it was typed is what makes that legible. CANCEL reloads rather than
hiding, so cancelled text cannot sit in a closed box waiting for the next person
who opens it.

It also removes a workaround with a real cost: fixing a typo meant delete and
retype, which **moved the entry to the bottom**, because a re-add gets a new
`sort_order`.

### Archiving is a deliberate refusal of the literal request

The owner asked to *remove* a tier list contributor. `set_tier_list_status`
archives instead. `'archived'` is already in `tier_lists_status_check` and the
public read policy is `status = 'published'`, so archiving takes the list off
the site — which is the part actually wanted. Deleting would take more:
`tier_list_changes` references `tier_lists` `ON DELETE CASCADE`, so every note
explaining every move goes with it, unrecoverably. Status is a parameter, so the
same function puts a list back.

The `trusted_editor` role `assign_tier_list` may have granted is **not** revoked
as a side effect. That is a separate decision and the roster is where roles are
managed.

### A regression PR 2 caused, found by sweeping rather than by report

Making `role` nullable changed what `existing_role IS NULL` **means**. It used
to imply "this person has no row at all"; it now also matches a roleless
capability holder. `assign_tier_list` read exactly that:

```sql
IF existing_role IS NULL THEN
    INSERT ... ON CONFLICT (user_id) DO NOTHING;
    granted := true;
```

For a roleless capability holder the row already exists, so `DO NOTHING` did
nothing — and `granted := true` then reported *"Granted trusted_editor."*
anyway. **No error, no role, and a message saying otherwise.**

`granted` now comes from `FOUND`, and the `DO UPDATE` carries a `WHERE
role IS NULL` so a role gained between the SELECT and the INSERT cannot be
silently demoted to `trusted_editor`.

**Swept for other readers of that assumption; `existing_role` was the only one.**
The two `count(*)` sites filter on `role = 'admin'`, which a NULL row does not
match, and every other `IS NULL` test against `user_roles` is on
`target_user_id` — "no such account" — which is unaffected. Recorded because
the sweep is the evidence, not the absence of a bug report.

### Escaping the collaborators page

It built six values straight into `innerHTML`. Owner-authored, so not
attacker-reachable — but **this pass is the first thing that ever let four of
those columns be typed in**, which makes it the input path and brings the
project standard with it. Links are held to http(s) at both entry points as
well: escaping stops a tag being written, that check stops a `javascript:` href
being followed.

### Two things the tests found

The Tier Lists group **loads its roster from a click handler on the nav button**,
not from `showOwnerGroup()` — deliberately, since the block editor is heavy. A
test calling the switcher directly leaves the roster on "Loading..." forever, so
it now clicks the real control.

And a run of 113 specs across 9 files reported 2 failures in
`certified-tier-lists.spec.js`, a file this PR does not touch. **All 22 pass in
isolation** — load, not a regression, which is the documented way to tell those
apart here.

---

## Open questions for the owner

1. **Character colour codes** (req 1) is the one item whose scope I cannot infer.
   "Applying that colour throughout the site (mainly auto-colouring), and
   probably more" needs pinning down before it is built.
2. **Does `viewer` still mean anything now that a role is optional?** A roleless
   account and a `viewer` are no longer the same shape, but `viewer` is a ban and
   NULL is not — that distinction still holds. Raised only because the two look
   alike on the roster now, not because anything is wrong.

---

## Verify after merge

Migrations apply on merge to `main`, so the usual probe applies — being
unannounced changes nothing about that.

- **`assign_role_by_email`**: tick a capability, press APPLY, confirm the column
  is still TRUE in the dashboard. That is the entire bug, and it is one minute.
- **The expert**: the account from the original report should now see OVERSEER
  and land on a queue holding their pages and no others. **Needs the pair** —
  that they see their own page's submissions *and* not somebody else's. Either
  alone proves nothing.
- A reviewer must still see all three queues, and a moderator still exactly one.
- **`search_users` as a non-owner must fail with 42501**, and as anon must not
  be callable at all. It returns email addresses, so this is the probe that
  matters most in PR 2 — and it is the half Playwright cannot see.
- **Grant a capability to an account with no role**, then take it away again,
  and confirm the row is gone rather than left behind carrying nothing.
