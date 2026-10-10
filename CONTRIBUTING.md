# Contributing

## Welcome

Thank you for taking the time to come here and read this. This file explains
how to contribute to the wiki's code itself, instead of the usual way (edits,
posts, media and so on). To contribute content, check out the
[Writing Guide](https://dogslamloop.com/systems/writing_guide/index.html) and
the [Terms of Service](https://dogslamloop.com/terms.html).

Let's get started, shall we?

## Quick Links

Here are all the links you need:

- [Dogslamloop Wiki](https://dogslamloop.com/)
- [Writing Guide](https://dogslamloop.com/systems/writing_guide/index.html)
- [Terms of Service](https://dogslamloop.com/terms.html)
- [Privacy Policy](https://dogslamloop.com/privacy-policy.html)
- [Forum Rules](https://dogslamloop.com/systems/forum-rules/index.html)
- [Discord server](https://discord.gg/FR2DeR6c5h)
- [GitHub Issues](https://github.com/Deptr-softwares/dogslamloop-wiki/issues)
- [MIT License](LICENSE) (the code)
- [Content Licence, CC BY-NC-SA 4.0](CONTENT-LICENSE.md) (the wiki's content)

## Bug Reports and Suggestions

You can report bugs and issues you find on the wiki's official
[Discord server](https://discord.gg/FR2DeR6c5h), in the
#bugs-feedback-suggestions channel. If you don't have a Discord account, or
prefer another way, use
[GitHub Issues](https://github.com/Deptr-softwares/dogslamloop-wiki/issues)
instead.

A good bug report says:

- what you did, step by step;
- what happened;
- what you expected to happen;
- your role, if you were signed in;
- whether you were on a phone or a computer, and which browser.

A screenshot or a short video helps.

You can also make a suggestion in the same Discord channel, or on GitHub
Issues. A suggestion can be just words. It needs to say what it is and why the
wiki should have it. For a big change, message @deptr4869 on Discord before
you start building it.

Do not report security problems here. See Security below.

## Getting the Wiki on Your Device

First, you need Git, Node.js (version 20 or newer), Python 3, and a code
editor for HTML, CSS and JavaScript.

There is no **build step** here. The site is static HTML, CSS and classic
`<script src>` tags sharing one `window` scope. There's no bundler, no
framework and nothing to transpile. You just open a file, edit it and reload
the page.

To get a copy and start a local server, run:

```bash
git clone https://github.com/Deptr-softwares/dogslamloop-wiki.git
cd dogslamloop-wiki
npm install                       # Playwright and the generator scripts only
npx playwright install chromium   # the browser the tests run in
python -m http.server 8123
```

Then open <http://localhost:8123/index.html>.

Signed out, the local site is read-only. It talks to the live Supabase project
with the public anon key, which is in `js/site_utils.js` and in every page's
source (**it is not a secret**).

You can sign in locally with an email and password, but not with Discord,
Google or GitHub. Signed in, you are using the live wiki: anything you post,
submit or upload is real. Anything that needs a role you don't have will not
work.

<!-- Everything below is the old file, kept until each part is rewritten. -->

---

## Before you open a pull request

```bash
npm test               # the Playwright suite
npm run validate       # migration lock, navigation, generated stubs, asset stamps
```

Both must pass. If you changed anything under `js/`, also run:

```bash
npm run generate       # restamps every page's asset version
```

Skipping that is the most common reason `validate` fails in CI on an otherwise
fine change.

## Where work lands

**`next-update` is the integration branch. `main` is production**, served by
GitHub Pages — every merge to `main` is a live deploy.

- Target your PR at **`next-update`**. Never `main`.
- CI runs on `main` and `next-update` only. A PR targeting anything else runs
  no tests **and reports green because nothing ran**.
- Direct pushes to either branch are rejected. Everything lands through a PR.

Releases are the maintainer's job: one PR from `next-update` to `main`, carrying
the changelog and the version bump together.

## Things that will surprise you

These are not style preferences. Each one has cost this project a real outage or
a real security hole.

**Escape at every `innerHTML` interpolation.** Page content, contributor names,
chat messages, QA notes and error strings are all attacker-reachable. Never
build a user-influenced value into an inline `onclick` — use a `data-` attribute
and a delegated listener. Three live XSS holes have been closed here, and a
reviewer could not have caught any of them by reading the diff.

**A failing test is a production outage, not a failing test.** The nightly
regeneration job runs the full suite *before* it commits, so a red test stops
every generated artifact — navigation, colours, portraits, stubs — from reaching
the site, and keeps stopping them until it is fixed. It has happened twice.
Never assert a count of pages, characters or colours; the owner adds those, and
your test would block them.

**Some files are generated. Do not hand-edit them.** `data/navigation.json`,
`data/portraits.json`, `data/faq.json`, `data/site_meta.json`, every
`characters/*/index.html` and `systems/*/index.html`. They carry a
`GENERATED by` marker. Edit the source and regenerate.

**A migration is immutable once pushed.** Supabase records it by version and
will not re-run it, so editing a migration you have already pushed is verified
by nothing and reports green. Write a new one. `supabase/migrations.lock.json`
exists to catch this and `npm run validate` checks it.

**Never test a role by name.** No `= 'admin'`, no `roles.includes('admin')`.
The ladder is stated once, in `role_rank()` (SQL) and `window.ROLE_RANK` (JS),
with `is_staff()` / `is_owner()` and `roleMeets()` on top. A literal is how a
permissions bug shipped, and it is what turned a rename into a 30-site change.

**Shared CSS classes have consumers you are not looking at.** `.btn-sys`,
`.btn-manga` and friends are used across pages that do not reference each other.
Check every one before changing a shared rule.

## Tests

Specs live flat in `tests/*.spec.js`, one per feature or bug. Lead each file
with a comment saying what it exists to protect — the next reader needs to know
why an assertion is there before they relax it.

Two rules worth stating up front:

- **Test the interaction, not the render.** A page that loads is not a page that
  works. Click the real control and assert a visible consequence, plus that no
  `pageerror` fired.
- **A passing test may be passing for the wrong reason.** If a new test passes
  first time, ask what would have to break for it to fail. If the answer is
  "nothing reachable", it is not a test yet. Prove a regression test fails
  against the old code before trusting it.

`visual.spec.js` is excluded from CI — its baselines are per-OS and can never
match a Linux runner. It is a local before/after tool for CSS work.

## Security

**Found a security problem?** Do not open a public issue. Contact the maintainer
directly and give them a chance to ship a fix first.
