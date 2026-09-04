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
Shipped in this branch.

**PR 2 — the roster.** One root cause, three symptoms: find any account by
email or display name, not only those holding a role; grant a capability to a
roleless user; and bug 2's real answer. The biggest item in the list and the
one the owner hits daily.

**PR 3 — content tools.** FAQ edit, collaborator fields and edit, tier-list
contributor removal.

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

## Open questions for the owner

1. **Bug 2** — which person were you clicking? A reviewer/admin (box correctly
   inert, needs a legible reason rather than a tooltip), or somebody with no
   role (never in the list — PR 2)?
2. **Should a roleless account be allowed to hold a capability?** Today
   `set_user_capability` says no on purpose. Letting a moderator exist with no
   role at all is the cleaner model and matches how experts already work, but it
   is a real change to what a capability means.
3. **Character colour codes** (req 1) is the one item whose scope I cannot infer.
   "Applying that colour throughout the site (mainly auto-colouring), and
   probably more" needs pinning down before it is built.

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
