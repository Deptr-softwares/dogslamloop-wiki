# The owner tools

owner.html, the owner's own page: who holds which role and capability, the page registry and each page's details, the dashboards' text and steps, the site's metadata, the FAQ, the tier lists, Staff Perks, page experts, and the tools that clean up media. The Post editor (post-editor.html) is the owner's too. Only the owner gets in.

## Files

- `owner.html`: the page, in four groups (People, Pages, Content, Danger Zone).
- `js/owner/owner.js`: the gate, Personnel (roles, capabilities, account search), the page registry, page restrictions, the FAQ, deleting an account, and media garbage collection.
- `js/owner/owner-nav.js`: switching between the groups.
- `js/owner/owner-page-meta.js`: Page Details (badges, roster filters, archetype, release date, colour, optional tabs).
- `js/owner/owner-page-experts.js`: Page Experts.
- `js/owner/owner-staff-perks.js`: Staff Perks.
- `js/owner/owner-site-meta.js`: Site Metadata and Game Info.
- `js/owner/owner-hub-text.js`: Dashboard Text.
- `js/owner/owner-hub-lists.js`: Dashboard Steps.
- `js/owner/owner-tier-lists.js`: the Tier List page's introduction, who has a list, and the Free Submit Tier List's settings and reset.
- `js/owner/owner-media-report.js`: the broken-media report.
- `post-editor.html`, `js/owner/post-editor.js` and `style/post-editor.css`: the Post editor.
- `style/admin.css`: the look, shared with the Overseer (`docs/overseer.md`).

## Data

- `user_roles`: one role per account, and the capabilities `can_moderate`, `can_delete_media` and `can_upload_media`, through `list_personnel()`, `search_users()`, `assign_role_by_email()` and `set_user_capability()`. `anonymize_user_by_email()` deletes an account.
- `site_pages`: the page registry, written to `data/navigation.json` by the next regeneration run.
- `page_permissions`: a page's `required_role` for submitting.
- `site_faq`, written to `data/faq.json`.
- `site_meta`: the version, the tagline, each hub's title, description, headings and steps (`hubs`), and `game_info`, written to `data/site_meta.json`.
- `page_data`: the hub dashboards' text, and a character's `tab_settings`.
- `site_settings.staff_bypass_submission_cooldown`, read by `check_revision_rate_limit()` on every submission.
- `page_experts`, through `list_page_experts()`, `assign_page_expert()` and `revoke_page_expert()`.
- `tier_lists` through `list_tier_lists()`, `assign_tier_list()`, `set_tier_list_status()` and `delete_tier_list()`; `tier_page_settings` (the page's introduction and the Free Submit settings); `reset_free_submit_tier_list()`.
- `site_posts`: the blog and hotfix notes.
- The `wiki-media` bucket, which garbage collection checks against `page_data`, `pending_revisions` and `page_history`.

## Watch for

- The gate decides what to show. Every tool's RPC or RLS checks the caller itself, with `is_owner()` (`tests/owner-role.spec.js`). The gate is owner.js's own copy, not admin-core.js's.
- A registry change, and a hub's title and description, reach the site at the next regeneration run; the rest of `site_meta` is read at runtime.
- A character page's category is always "Characters": the roster, the systems directory and the sidebar's colours read that key by name (`tests/owner-character-category.spec.js`).
- Garbage collection works by elimination, so a failed or short read looks like "nothing uses this file". Every read is checked and paged to the end, and scanning and deleting are separate clicks (`tests/media-gc-guard.spec.js`).
- The broken-media report runs on demand and never in a test or CI: it reads owner content.
- Dashboard Steps and Site Metadata both save the whole `hubs` column, each from the copy it loaded.
- A class that sets `display` restates `[hidden]` (`.owner-group`, `.page-row`).
- The tier page's introduction uses the one Block editor's buffer, so owner.html never opens a second Block editor.

## Decisions

Newest first. One entry per decision.

- **2026-11-20, v1.2, #288.** The Tier List page's introduction saves the whole Block list, not only the Section Box or Dropdown open in it.
- **2026-11-17, v1.2, #277.** A page's colour is stored in a form the site reads, hex or hsl(), converted on save (owner, 2026-11-17): a named colour themed nothing and failed that night's colour check.
- **2026-11-16, v1.2, #274.** A reviewer's moderation box is live, since a reviewer moderates only by the owner's tick (the owner's card: "Remove Reviewer default permission to moderate discussion").
- **2026-10-02, v1.0, #213.** The broken-media report counts only "not there" as missing. A 429, a 408 or a 5xx is the host: retried, then "not checked". The owner's run had listed files that load fine, and 38 of the "missing" came back one by one.
- **2026-09-28, v0.20, #206.** The broken-media report, on demand and never a check, since a test on owner content would stop regeneration. A one-off scan had found 86 of 466 linked files missing, on 15 pages. A viewer's upload capability says it is refused.
- **2026-09-04, v0.18, #163.** A character's colour is data, edited in Page Details: a text field (the value, hex or hsl()), the browser's picker, and a swatch, checked with the browser's own colour parser.
- **2026-09-04, v0.18, #162.** The page registry is grouped by category, collapsed, with a filter that opens the groups it matches (the owner: "they aren't seperated well and create a long column, so scrolling through them take quite a time"). An archived page or tier list can be deleted, and only once archived (owner's call, 2026-09-04), which `delete_tier_list` enforces too.
- **2026-09-04, v0.18, #161.** The FAQ's answers are edited in place, on their row. A tier list is archived rather than deleted, so it and its change history can be restored.
- **2026-09-04, v0.18, #160.** Account search finds anyone, by display name or address (the owner: "a new Vessel Expert come to me... he logged in using a burner mail... Now it is impossible for me to shift through the list just to find the email to assign it to him"). A capability stands without a role. The role dropdown opens on what the person holds: for a roleless account it showed Administrator, which APPLY would grant. A disabled capability says why in text (owner, 2026-09-04: "clicking on it and nothing happen").
- **2026-09-03, v0.17, #153.** A character page's category is "Characters", locked in the form and forced on save (owner, 2026-09-03: "Adding a character page require me to pick a category, but if I do, it will break the formatting").
- **2026-09-03, v0.17, #151.** Page Experts, granted by email since an expert may hold no role, grouped by page. An owner tool, because granting review rights is a personnel decision (the owner's rule, 2026-08-27: which page a tool is on decides who owns it).
- **2026-08-27, v0.17, #145.** The owner tools and the Post editor are owner only: an admin works the review queue and has no owner tools (owner, 2026-08-27). The last-owner guard counts owners.
- **2026-08-25, v0.16, #135.** Reset Ranking for the Free Submit Tier List, set apart from SAVE, behind the site's own confirm, and reporting how many votes it removed.
- **2026-08-25, v0.16, #134.** Hidden (private server only) is a flag of its own, apart from WIP: one is whether a page is finished, the other where the character can be played.
- **2026-08-20, v0.15, #120.** Page Details offers a character's optional tabs (Techs) from the vocabulary, saved to `page_data.tab_settings` only when a box moved: an upsert on a page with no row would make one with no content.
- **2026-08-14, v0.14, #85.** The Free Submit Tier List's anti-brigading settings are knobs on this page, so voting can be closed within a minute during a brigade.
- **2026-08-14, v0.14, #84.** The Tier Lists tools. Assigning someone a list grants trusted_editor in the same step, never downgrades their role, and refuses a viewer.
- **2026-08-12, v0.13, #70.** Per-account capabilities are columns, not roles, shown under the role row: one role per account.
- **2026-08-12, v0.13, #62.** Galleries and tool pages can be restricted too: they shipped without it, so the Emotes gallery could not be locked.
- **2026-08-12, v0.13, #54.** Media garbage collection can no longer delete the library on a failed read. Every read is checked and paged, an empty corpus is refused, scanning and deleting are separate clicks, and a sweep of a large share of the library says so.
- **2026-08-10, v0.12, #41.** Where a page lives (characters/, systems/, others/, tools/) is separate from how it renders, so an Others or Tools page needs no render type of its own. Categories are free text with the existing spellings offered.
- **2026-08-10, v0.12, #40.** Staff Perks: whether staff skip the submission cooldown, a switch rather than a constant (the owner asked for a toggle), so it can be turned off without a migration if a staff account is compromised.
- **2026-08-09, v0.11, #36.** owner.html is one wide pane in four groups, remembered on the device and not a router, since Back would leave a half-filled form. Dashboard Text moves out of the editor into plain fields: the editor showed a generic title, leftover tabs and a preview that could never show a dashboard. Dashboard Steps are curated by the owner rather than generated. Site Metadata, Game Info and Page Details make editable what had needed SQL.
- **2026-08-08, v0.10, #31.** The personnel roster. 'contributor' is gone (it gated nothing) and 'viewer' is the soft ban, labelled as one. The last owner cannot demote themselves. Deleting an account anonymizes it, as the owner confirmed: the account and email go, past edits stay, re-attributed. The page registry creates pages as WIP and archives rather than deletes, so old links still resolve; order within a category follows in-game release order. Page restrictions, and the FAQ.
- **2026-08-08, v0.10, #30.** The Post editor: the blog and hotfix notes written with the wiki's own Block editor and saved straight to `site_posts`, with no review. The slug follows the title until edited by hand, and the publish date is set on first publish only.
- **2026-08-07, v0.8, #28.** The gate retries once before refusing.
- **2026-08-03, v0.6, #27.** The owner tools move out of the Overseer into their own page, with their own copy of the gate: small duplication over one feature file depending on another.
