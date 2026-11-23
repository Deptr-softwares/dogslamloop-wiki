# Discussions, the Forum and posts

Where readers write: a character page's discussion thread, the Forum, and the blog and hotfix notes staff post. Readers post and read; moderators hide, remove and restore; the Discord relay mirrors threads and Forum posts both ways.

## Files

- `js/pages/community/discussions.js`: threads, posts and replies, images, KLIPY GIFs and the GIF picker, editing, reporting and moderation. The Forum's conversations use it too.
- `js/pages/core/page_boot.js`: on a character page, loads `emoji.js` and `discussions.js` as the thread nears the screen, and runs the jump-to-discussion button and its count.
- `js/pages/community/forum.js`: the Forum's list, one post's title and category, the new-post form and moderation of a whole post.
- `js/utility/emoji.js`: emojis in posts, and the emoji picker.
- `js/pages/community/posts.js`: the blog and hotfix notes, reader side.

## Data

- `page_discussions`: every post and reply, keyed by `page_id` (a character's page id, or `forum:<id>` for a Forum post). `page_discussion_edits`: what a post said before, readable by moderators alone.
- `forum_threads`, `forum_thread_edits`: Forum posts and their earlier titles.
- `site_posts`: blog posts and hotfix notes, as Block lists.
- The `discussion-media` and `discord-media` buckets: uploaded images, and pictures the relay copied off Discord.
- `data/emoji.json`: the emoji picker's list (`scripts/build-emoji-data.js`).

## Watch for

- A post is live the moment it is sent, so its text never goes through innerHTML: text nodes and `<br>` nodes only. Every address is checked against an exact pattern and set as a property.
- The rules live in the database (triggers, RLS and the RPCs); the browser's copies of the limits are a courtesy.
- Only a reader's browser calls KLIPY, and only when a post is made or from the GIF picker (CLAUDE.md, Stack).
- The custom emojis are named exactly as on the Discord server, and the relay's `CUSTOM_EMOJI` lists the same ones.
- A thread that fails to load never blocks its page.
- On a character page the thread's scripts load about a screen before the reader reaches it, at once for a `#post-` link or a press of the jump button, so anything that must run at load (the jump button's count) lives in `page_boot.js`, not `discussions.js`. The Forum loads them with the page. Test: `tests/discussion-on-approach.spec.js`.

## Decisions

Newest first. One entry per decision.

- **2026-11-23, silent release, #310.** A character page loads its discussion (about 29 KB gzipped of scripts) as the reader nears the thread rather than with the page (the owner's pick of three, over a button and over no change). Its stylesheet stays with the page, since it also styles the jump button at the top, and the count on that button still shows at load.
- **2026-10-23, v1.1, #249.** Each Forum category has its own colour, on its filter button and on every post's tag (owner).
- **2026-10-21, v1.1, #243.** Posts can hold emojis (owner, 2026-10-21): the wiki's own, named exactly as on the Discord server so the relay can turn one into the other, and every standard emoji in Discord's look (Twemoji's art, pinned). A post stores the name or the character itself. The picker gives a picture its address only when it is seen: opening it once fetched 744 pictures (measured 2026-10-21).
- **2026-10-21, v1.1, #243.** The post box has a GIF picker, KLIPY's own search, built to KLIPY's production rules: the box says "Search KLIPY", every request and picture goes straight from the reader's browser to KLIPY, results show in KLIPY's order with nothing added or taken out, the strictest content filter (many readers are children), and no user id.
- **2026-10-11, v1.0, #228.** A thread reads like a Discord channel: posts one person sends within 7 minutes share a name line, each person has a round letter in their own colour, and a page holds 100 top-level posts with all their replies (owner, 2026-10-12, keeping that much of the channel layout).
- **2026-10-05, v1.0, #219.** The box that starts a conversation links the Rules page (`forum_rules`) once that page is live.
- **2026-10-05, v1.0, #218.** The person who started a Forum post can change its title and category, at most once every 5 minutes, and a moderator sees what it was called before, on the wiki or on Discord.
- **2026-10-05, v1.0, #217.** The Forum: posts by category, most recently active first, each with a conversation drawn by the same component as a character's thread, on the wiki and on Discord. Six categories, in the owner's order, held by the database too. Spec: `.claude/archived-devlogs/V1.0-DEVLOG.md`, "SPEC 2026-10-04: batch 2, the Forum".
- **2026-10-05, v1.0, #218.** Replies can answer replies, staying one step in and quoting which they answer, and an author can edit the words of their own post (owner, 2026-10-04). A moderator can see what a post said before.
- **2026-10-04, v1.0, #216.** The Discord relay copies messages and their pictures into the wiki's threads. A Discord message's author is shown as text with their Discord handle: there is no wiki account to open.
- **2026-10-02, v1.0, #213.** A KLIPY page link, which is what Discord's GIF picker copies (owner, 2026-10-01), is looked up through KLIPY's API once, when the post is made, and stored as the GIF's own address, so readers never call KLIPY. The API key is visible in the page, like the anon key (the owner's choice, 2026-10-02). MP4 is picked first: one GIF's HD file was 22.6 MB and its MP4 0.58 MB. A thread's GIFs load through the clip queue, never all at once (owner).
- **2026-09-28, v0.20, #206.** Posts can carry up to four images and KLIPY GIFs. An image is shrunk and re-encoded in the browser before upload; the limits mirror the database, which holds the real rules.
- **2026-09-03, v0.17, #150.** Beside a name in a thread: an EXPERT chip on a page the person covers, their flair and the badges they show, drawn after the thread is on screen.
- **2026-08-13, v0.14, #77.** Readers can report a post into a moderator queue. There is no "incorrect" reason: on a frame-data wiki it is the commonest complaint and the least actionable, and a thread is where being wrong is argued.
- **2026-08-13, v0.14, #76.** Moderators hide, remove and restore posts, giving a reason, and never restore a post its author withdrew. The jump-to-discussion button carries the post count, and nothing for an empty thread.
- **2026-08-13, v0.14, #75.** Each character page has a discussion thread, the site's first open write path: a post is live the moment it is sent. The rules live in the database (authorship, the rate limit, the reply shape, the viewer ban); post text never goes through innerHTML; a thread that fails never blocks the page.
- **2026-08-08, v0.9, #30.** Blog posts and hotfix notes are `site_posts` rows holding the same Block list a page does. Hotfix notes show on the Update Log looking like its own entries, and fail quietly: the page's changelog is still there.
