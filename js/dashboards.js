/**
 * Dogslamloop Wiki - Dashboard widgets (Character Hub and Side Hub).
 *
 * Written as plain code against the data, deliberately. These are computed
 * views of what the wiki already knows - which pages are unfinished, what was
 * edited recently, where a character sits on the tier list - not text anyone
 * would want to reword. Only the hub intros are CMS-backed (js/hub_content.js);
 * everything here is derived, so an authoring layer would be a layer with
 * nothing to author.
 *
 * Every widget follows the same three rules:
 *
 *   1. Nothing is fetched twice. The hubs already load the roster, and these
 *      add three or four more queries; each is scoped to what it renders.
 *   2. A failure renders an explanation, never an empty box. An empty widget
 *      and a broken widget look identical to a reader, and the second is the
 *      one worth reporting.
 *   3. Archived pages are filtered out. These read page_data, the revision
 *      feed and the tier list - none of which come from navigation.json, so
 *      none of which drop an archived page on their own. That gap is exactly
 *      what data/archived-pages.json and isEntryPointHidden exist for.
 */

const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

/**
 * "3 days ago" for anything recent, a plain date beyond that.
 *
 * Local rather than shared: posts.js has its own formatDate producing a long
 * absolute date, which is right for a blog post and wrong for an activity
 * feed. Matching the project's preference for small per-file duplication over
 * a shared helper neither caller quite wants.
 */
function relativeDate(value) {
    const then = new Date(value);
    if (isNaN(then)) return '';

    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The sections a character page can have, in the order they appear on it. */
const CHARACTER_SECTIONS = [
    { key: 'has_profile', label: 'Profile' },
    { key: 'has_overview', label: 'Overview' },
    { key: 'has_playstyle', label: 'Playstyle' },
    { key: 'has_m1s', label: 'M1s' },
    { key: 'has_skills', label: 'Skills' },
    { key: 'has_specials', label: 'Specials' },
    { key: 'has_strategy', label: 'Strategy' },
    { key: 'has_matchups', label: 'Matchups' },
    { key: 'has_counterplay', label: 'Counterplay' },
];

function widgetError(container, message) {
    container.innerHTML = `<p class="admin-error-text">${esc(message)}</p>`;
}

/** page_id -> {name, url} for every live character, from navigation.json. */
async function liveCharacters() {
    const nav = await window.fetchNavigationData();
    const rootPath = window.getRootPath ? window.getRootPath() : './';
    const out = {};

    for (const entry of (nav.Characters || [])) {
        if (!entry.cms_config) continue;
        out[entry.cms_config.pageId] = {
            name: entry.name,
            navId: entry.id,
            url: rootPath + entry.url,
            isWip: entry.isWip === true,
        };
    }
    return out;
}

// ---------------------------------------------------------------- what needs work

/**
 * Characters the owner has flagged as work in progress.
 *
 * The list is driven by is_wip, not by measured completeness. That is a
 * deliberate choice by the owner and the right one: "needs work" is an
 * editorial judgement, and a page can be structurally complete while still
 * being wrong, or be missing a section nobody intends to write.
 *
 * Completeness still supplies the *detail* - which sections are empty - so the
 * panel says what to do rather than only who to do it to. That comes from the
 * page_completeness view rather than page_data, where the same information
 * costs 385 KB.
 *
 * is_wip is editable from owner.html's Page Details card. Until v0.11 it was
 * unmaintainable, and it shows: 21 of 22 characters carry it, so this list is
 * near-total until those flags get curated. That is now a data task rather
 * than a code one.
 */
window.buildNeedsWork = async function(containerId, limit = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [characters, archived, { data, error }] = await Promise.all([
            liveCharacters(),
            window.fetchArchivedPages ? window.fetchArchivedPages() : {},
            window.supabaseClient.from('page_completeness').select('*').eq('page_type', 'character'),
        ]);

        if (error) throw error;

        const byId = {};
        (data || []).forEach(row => { byId[row.page_id] = row; });

        const rows = Object.entries(characters)
            .filter(([pageId]) => pageId !== 'template')
            .filter(([, info]) => info.isWip)
            .filter(([pageId]) => !window.isEntryPointHidden(archived, pageId))
            .map(([pageId, info]) => {
                // A character with no page_data row at all is missing
                // everything, not nothing. register is exactly this case.
                const row = byId[pageId] || {};
                const missing = CHARACTER_SECTIONS.filter(s => !row[s.key]);
                return { ...info, pageId, missing };
            })
            .sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));

        if (rows.length === 0) {
            container.innerHTML = `<p class="wiki-section-empty">Nothing is flagged as work in progress right now.</p>`;
            return;
        }

        const shown = rows.slice(0, limit);
        container.innerHTML = `
            <ul class="needs-work-list">
                ${shown.map(c => `
                    <li class="needs-work-row">
                        <a href="${esc(c.url)}" class="needs-work-name">${esc(c.name)}</a>
                        <span class="needs-work-missing">${
                            // A page can be flagged in progress with every
                            // section already written - the flag is a
                            // judgement, not a measurement.
                            c.missing.length > 0
                                ? c.missing.map(m => esc(m.label)).join(', ')
                                : 'in progress'
                        }</span>
                    </li>
                `).join('')}
            </ul>
            ${rows.length > shown.length
                ? `<p class="needs-work-more">and ${rows.length - shown.length} more.</p>`
                : ''}
        `;
    } catch (e) {
        widgetError(container, `Could not work out what needs writing: ${e.message}`);
    }
};

// ---------------------------------------------------------------- recent character edits

/** Approved edits to character pages, newest first. */
window.buildRecentCharacterEdits = async function(containerId, limit = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [characters, archived, { data, error }] = await Promise.all([
            liveCharacters(),
            window.fetchArchivedPages ? window.fetchArchivedPages() : {},
            window.supabaseClient
                .from('pending_revisions')
                .select('page_id, author_name, created_at')
                .eq('status', 'approved')
                .eq('page_type', 'character')
                .order('created_at', { ascending: false })
                .limit(40),
        ]);

        if (error) throw error;

        // One entry per character - several edits to the same page in a row is
        // one piece of news, not six.
        const seen = new Set();
        const rows = [];
        for (const rev of (data || [])) {
            if (seen.has(rev.page_id)) continue;
            if (!characters[rev.page_id]) continue;         // archived or removed
            if (window.isEntryPointHidden(archived, rev.page_id)) continue;
            seen.add(rev.page_id);
            rows.push({ ...characters[rev.page_id], ...rev });
            if (rows.length >= limit) break;
        }

        if (rows.length === 0) {
            container.innerHTML = `<p class="wiki-section-empty">No approved character edits yet.</p>`;
            return;
        }

        container.innerHTML = `
            <ul class="recent-edit-list">
                ${rows.map(r => `
                    <li class="recent-edit-row">
                        <a href="${esc(r.url)}" class="recent-edit-name">${esc(r.name)}</a>
                        <span class="recent-edit-meta">${esc(relativeDate(r.created_at))} &middot; ${esc(r.author_name || 'someone')}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    } catch (e) {
        widgetError(container, `Could not load recent edits: ${e.message}`);
    }
};

// ---------------------------------------------------------------- tier snapshot

/**
 * The community tier list, compactly.
 *
 * Reads the tier list's own page_data rather than site_pages.tier, which is
 * "TBD" for every character and always has been.
 */
window.buildTierSnapshot = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [characters, archived, { data, error }] = await Promise.all([
            liveCharacters(),
            window.fetchArchivedPages ? window.fetchArchivedPages() : {},
            window.supabaseClient.from('page_data').select('desc_data').eq('page_id', 'tierlist').maybeSingle(),
        ]);

        if (error) throw error;

        const tabs = ((data || {}).desc_data || {}).tabs || [];
        const tiers = (tabs[0] || {}).tiers || [];
        if (tiers.length === 0) {
            container.innerHTML = `<p class="wiki-section-empty">No tier list has been published yet.</p>`;
            return;
        }

        // The tier list stores nav_ids; the roster is keyed by page_id.
        const byNavId = {};
        Object.entries(characters).forEach(([pageId, info]) => { byNavId[info.navId] = { ...info, pageId }; });

        container.innerHTML = tiers.map(tier => {
            const names = (tier.characters || [])
                .map(navId => byNavId[navId])
                .filter(Boolean)
                .filter(c => !window.isEntryPointHidden(archived, c.pageId));

            if (names.length === 0) return '';
            return `
                <div class="tier-snapshot-row">
                    <span class="tier-snapshot-label" style="background-color: ${esc(tier.color || 'var(--bg-secondary)')};">${esc(tier.name)}</span>
                    <div class="tier-snapshot-names">
                        ${names.map(c => `<a href="${esc(c.url)}" class="tier-snapshot-name">${esc(c.name)}</a>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        widgetError(container, `Could not load the tier list: ${e.message}`);
    }
};

// ---------------------------------------------------------------- wiki stats

/** Pages, contributors and approved edits. */
window.buildWikiStats = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [pages, revisions] = await Promise.all([
            window.supabaseClient.from('site_pages').select('page_id', { count: 'exact', head: true }).eq('status', 'live'),
            // Names rather than a count: the same query answers "how many
            // edits" and "how many people", and head:true cannot do the second.
            window.supabaseClient.from('pending_revisions').select('author_name').eq('status', 'approved'),
        ]);

        if (pages.error) throw pages.error;
        if (revisions.error) throw revisions.error;

        const contributors = new Set((revisions.data || []).map(r => r.author_name).filter(Boolean));

        const stats = [
            { value: pages.count || 0, label: 'pages' },
            { value: (revisions.data || []).length, label: 'approved edits' },
            { value: contributors.size, label: 'contributors' },
        ];

        container.innerHTML = `
            <div class="wiki-stats-grid">
                ${stats.map(s => `
                    <div class="wiki-stat">
                        <span class="wiki-stat-value">${esc(s.value)}</span>
                        <span class="wiki-stat-label">${esc(s.label)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        widgetError(container, `Could not load site statistics: ${e.message}`);
    }
};

// ---------------------------------------------------------------- terminology

/**
 * A few terms from the Terminologies page.
 *
 * Renders nothing at all when that page has no real content - which is the
 * case today: its only tab holds a single placeholder paragraph reading
 * "Write your strategy here...". An empty glossary box advertising that the
 * wiki has no glossary is worse than no box, so the section hides itself and
 * appears on its own once the page is written.
 */
window.buildTerminologyPeek = async function(sectionId, containerId, limit = 6) {
    const section = document.getElementById(sectionId);
    const container = document.getElementById(containerId);
    if (!section || !container) return;

    try {
        const { data, error } = await window.supabaseClient
            .from('page_data').select('desc_data').eq('page_id', 'terminologies').maybeSingle();
        if (error) throw error;

        const tabs = ((data || {}).desc_data || {}).tabs || [];
        const blocks = tabs.flatMap(tab => (tab.sections || []).flatMap(s => s.blocks || []));

        // A heading followed by a paragraph is a term and its definition.
        const terms = [];
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (block.type !== 'heading' || !block.content) continue;

            const next = blocks[i + 1];
            const definition = (next && next.type === 'paragraph' && next.content) ? next.content : '';
            if (!definition || /write your .* here/i.test(definition)) continue;   // placeholder

            terms.push({ term: block.content, definition });
            if (terms.length >= limit) break;
        }

        if (terms.length === 0) { section.hidden = true; return; }

        section.hidden = false;
        container.innerHTML = `
            <dl class="glossary-list">
                ${terms.map(t => `
                    <div class="glossary-row">
                        <dt class="glossary-term wiki-text">${esc(t.term)}</dt>
                        <dd class="glossary-def wiki-text">${esc(t.definition)}</dd>
                    </div>
                `).join('')}
            </dl>
        `;

        // `wiki-text` above is the whole fix (owner, 2026-09-20). A term and
        // its definition are written in the editor like any other prose, so
        // they carry shortcodes, and the reader was seeing
        // `[color=#ff0000]Domain Expansion[/color]` as literal text here while
        // the same words rendered correctly on the Terminologies page itself.
        //
        // NOT a missing call. internalstyling.js runs a MutationObserver over
        // `<main>` with subtree:true and restyles on any added node, so this
        // widget was already being passed over - it just matched none of the
        // selectors, because applyInternalStyling picks its targets BY CLASS
        // and `glossary-term` is not one of them. `wiki-text` is the marker for
        // "this is prose, style it" and carries no CSS of its own, so adding it
        // is an opt-in and nothing else.
        //
        // The observer is why this needs no explicit call, and why the section
        // has to stay inside <main> - there is a test for that, because it is
        // the kind of dependency a later layout change breaks silently.
    } catch (e) {
        // Hidden rather than error-reported: this section is optional, and a
        // failure to load an optional extra should not shout at a reader.
        section.hidden = true;
    }
};

/**
 * The site-wide matchup grid, for the systems hub (v0.19 F4).
 *
 * Every character against every other, one cell per pairing, coloured by the
 * tier the row character's own page claims. Owner's request: a matchup table
 * on the Side Dashboard, under the Terminology section.
 *
 * WHY A GRID AND NOT A PEEK
 *
 * buildTerminologyPeek above shows six of something and links to the rest,
 * because a glossary is a list and six of it is a fair sample. A matchup chart
 * is not a list - its whole value is seeing the shape of the roster at once,
 * and six rows of it would say nothing. So this draws the full grid and
 * scrolls sideways rather than sampling.
 *
 * THE DATA, read from production on 2026-09-20
 *
 *   desc_data.matchups = [{ opponent, tier, content, author? }]
 *   22 pages carry one, 417 entries, and only 121 have any written content.
 *
 * `tier` is FREE TEXT and the data proves it: one entry reads "Aerial Circling
 * tier". resolveMatchupTier (js/site_utils.js) already returns something
 * renderable for any value, keeping unrecognised wording and colouring it
 * white rather than guessing at a neighbouring difficulty - so every value
 * goes through it and no tier is ever tested by name here.
 *
 * 266 of 417 are "Equal", so the finished grid is mostly grey. That is the
 * honest picture of a roster nobody has finished rating, not a rendering bug.
 *
 * CLASHES (v0.20)
 *
 * A pair whose two pages do not mirror each other: Advantage on one side
 * should read Disadvantage on the other, Equal should read Equal. The owner's
 * example is Honored One vs True Cannon at Equal while True Cannon vs Honored
 * One is Hopeless.
 *
 * ANY mismatch is a Clash, one step included (owner, 2026-09-24). Offered
 * "disagree on who wins" (86 pairs in production) and "three or more steps
 * apart" (46), they chose this one, 96 of the 178 pairs rated from both
 * sides. Do not loosen it to make the list shorter.
 *
 * The grid still reports both ratings exactly as written. A Clash is marked,
 * never resolved: picking a winner would invent a rating nobody wrote.
 *
 * Two things are never a Clash. A pair rated from one side only has nothing
 * to disagree with. A tier outside the ladder ("Aerial Circling tier") has no
 * mirror to compare against, and guessing one is the same guess
 * resolveMatchupTier refuses to make.
 */
window.buildMatchupTable = async function (sectionId, containerId) {
    const section = document.getElementById(sectionId);
    const container = document.getElementById(containerId);
    if (!section || !container) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';

        // Narrowed with a PostgREST json selector rather than pulling desc_data
        // whole: the full column is 533 KB across every page and this is 112 KB
        // of it. `content` still rides along - PostgREST cannot project inside a
        // json array - but it is empty on 296 of the 417 entries.
        const [navData, rows] = await Promise.all([
            window.fetchJson(rootPath + 'data/navigation.json', { cache: true }),
            window.supabaseClient
                .from('page_data')
                .select('page_id,matchups:desc_data->matchups')
                .then(r => { if (r.error) throw r.error; return r.data || []; }),
        ]);

        // Roster order comes from navigation.json, so the grid reads in the
        // same order as every menu on the site. Archived pages are already
        // absent from it, which is rule 3 in this file's header.
        const roster = ((navData || {}).Characters || [])
            .filter(c => c && c.cms_config && c.cms_config.pageId && c.name);
        if (roster.length < 2) { section.hidden = true; return; }

        const byPageId = new Map(rows.map(r => [r.page_id, r.matchups]));

        // name -> tier, per character page. Opponents are stored by NAME, which
        // is what the editor writes and what the heading renders.
        const ratings = new Map();
        let rated = 0;
        for (const char of roster) {
            const list = byPageId.get(char.cms_config.pageId);
            if (!Array.isArray(list)) continue;
            const row = new Map();
            for (const m of list) {
                if (!m || !m.opponent) continue;
                row.set(m.opponent, m.tier);
                rated += 1;
            }
            ratings.set(char.name, row);
        }

        if (rated === 0) { section.hidden = true; return; }

        const slug = (text) => (window.sectionAnchorSlug
            ? window.sectionAnchorSlug(text)
            : String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

        // Two letters, because 22 full names across the top is a grid nobody
        // can read. The full name is on every cell title and on the column
        // header title, so nothing is lost to hovering or to a screen reader.
        const abbrev = (name) => String(name || '').split(/\s+/)
            .map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

        const colour = (name) =>
            (window.CHARACTER_COLORS && window.CHARACTER_COLORS[name]) || 'var(--text-white)';

        // The anchor collectSectionTargets mints for the rendered "vs. X"
        // heading, so a link lands on the matchup itself rather than the top
        // of the Matchups tab.
        const matchupHref = (rowChar, colChar) =>
            rootPath + rowChar.url + '?tab=matchups#sec-vs-' + slug(colChar.name);

        // undefined means "not rated", exactly as the cells below read it. An
        // entry with an empty tier is rated, and resolves to Equal.
        const ratingOf = (rowName, colName) => {
            const row = ratings.get(rowName);
            return row ? row.get(colName) : undefined;
        };

        // A rung on window.MATCHUP_TIERS, or -1 for wording off the ladder.
        // Read through resolveMatchupTier so the two v0.13 renames compare as
        // the words they became.
        const ladder = window.MATCHUP_TIERS.map(t => t.id);
        const rung = (raw) => ladder.indexOf(window.resolveMatchupTier(raw).id);

        // Each unordered pair once. `clashOf` answers per cell, keyed row then
        // column, with the OTHER page's tier; `clashes` is the notice list.
        const clashes = [];
        const clashOf = new Map();
        const markClash = (rowName, colName, otherTier) => {
            if (!clashOf.has(rowName)) clashOf.set(rowName, new Map());
            clashOf.get(rowName).set(colName, otherTier);
        };
        roster.forEach((a, ai) => {
            roster.slice(ai + 1).forEach(b => {
                const ab = ratingOf(a.name, b.name);
                const ba = ratingOf(b.name, a.name);
                if (ab === undefined || ba === undefined) return;
                const ra = rung(ab);
                const rb = rung(ba);
                if (ra < 0 || rb < 0) return;
                // A mirror sits the same distance from the far end of the
                // ladder, so a matching pair always sums to its last index.
                const gap = Math.abs(ra + rb - (ladder.length - 1));
                if (gap === 0) return;
                const tierAB = window.resolveMatchupTier(ab);
                const tierBA = window.resolveMatchupTier(ba);
                markClash(a.name, b.name, tierBA);
                markClash(b.name, a.name, tierAB);
                clashes.push({ a, b, tierAB, tierBA, gap, order: clashes.length });
            });
        });
        // Biggest gap first, then roster order, which is the order they were
        // found in.
        clashes.sort((x, y) => (y.gap - x.gap) || (x.order - y.order));

        const head = roster.map(c =>
            '<th class="matchup-grid-col" scope="col" title="' + esc(c.name) + '">'
            + esc(abbrev(c.name)) + '</th>').join('');

        const body = roster.map(rowChar => {
            const rowClashes = clashOf.get(rowChar.name);
            const cells = roster.map(colChar => {
                if (colChar.name === rowChar.name) {
                    return '<td class="matchup-grid-cell is-self" aria-hidden="true"></td>';
                }
                const raw = ratingOf(rowChar.name, colChar.name);
                if (raw === undefined) {
                    return '<td class="matchup-grid-cell is-blank" title="'
                        + esc(rowChar.name) + ' vs ' + esc(colChar.name) + ': not rated"></td>';
                }

                const tier = window.resolveMatchupTier(raw);
                const href = matchupHref(rowChar, colChar);
                const label = esc(rowChar.name) + ' vs ' + esc(colChar.name) + ': ' + esc(tier.id);

                // A clashing cell names the other page's rating as well, so it
                // says what it disagrees with without opening the list. A new
                // line in the tooltip, a full stop for a screen reader.
                const other = rowClashes ? rowClashes.get(colChar.name) : undefined;
                const clash = other
                    ? 'Clash: ' + esc(colChar.name) + ' vs ' + esc(rowChar.name) + ' is ' + esc(other.id)
                    : '';

                return '<td class="matchup-grid-cell">'
                    + '<a class="matchup-grid-link' + (clash ? ' is-clash' : '') + '" href="' + esc(href) + '"'
                    + ' style="background:' + esc(tier.color) + '"'
                    + ' title="' + label + (clash ? '&#10;' + clash : '') + '">'
                    + '<span class="sr-only">' + label + (clash ? '. ' + clash : '') + '</span></a></td>';
            }).join('');

            return '<tr><th class="matchup-grid-row" scope="row" style="color:'
                + esc(colour(rowChar.name)) + '">'
                + '<a href="' + esc(rootPath + rowChar.url) + '?tab=matchups">'
                + esc(rowChar.name) + '</a></th>' + cells + '</tr>';
        }).join('');

        const legend = window.MATCHUP_TIERS.map(t =>
            '<span class="matchup-legend-item">'
            + '<span class="matchup-legend-swatch" style="background:' + esc(t.color) + '"></span>'
            + esc(t.id) + '</span>').join('')
            + (clashes.length
                ? '<span class="matchup-legend-item"><span class="matchup-legend-swatch is-clash"></span>Clash</span>'
                : '');

        // One notice per pair, in the owner's own sentence: "Honored One vs
        // True Cannon is Equal but True Cannon vs Honored One is Hopeless".
        // Each half links to the page that wrote it, which is where a fix goes.
        // Collapsed, because the list runs to about a hundred lines on
        // production data and the grid is what the section is for. Absent
        // entirely when there are none.
        const side = (rowChar, colChar, tier) =>
            '<a href="' + esc(matchupHref(rowChar, colChar)) + '">'
            + esc(rowChar.name) + ' vs ' + esc(colChar.name) + '</a> is '
            + '<span class="matchup-clash-tier" style="color:' + esc(tier.color) + '">'
            + esc(tier.id) + '</span>';
        const notices = clashes.length
            ? '<details class="matchup-clashes"><summary>Clashes (' + clashes.length + ')</summary>'
                + '<p class="matchup-grid-caption">Clash: the two character pages don\'t mirror each'
                + ' other. Advantage on one page should read Disadvantage on the other, and Equal'
                + ' should read Equal. Biggest gap first.</p><ol>'
                + clashes.map(c => '<li>' + side(c.a, c.b, c.tierAB) + ', but '
                    + side(c.b, c.a, c.tierBA) + '.</li>').join('')
                + '</ol></details>'
            : '';

        container.innerHTML =
            '<p class="matchup-grid-caption">Read a row as that character page rates it: the row'
            + ' is who you play, the column is who you face. Ratings are opinions written on each'
            + ' character page.</p>'
            + '<div class="matchup-grid-scroll"><table class="matchup-grid">'
            + '<thead><tr><td class="matchup-grid-corner"></td>' + head + '</tr></thead>'
            + '<tbody>' + body + '</tbody></table></div>'
            + '<div class="matchup-legend">' + legend + '</div>'
            + notices;

        section.hidden = false;
    } catch (e) {
        // Rule 2 in this file's header: a failure explains itself rather than
        // rendering an empty box. Deliberately unlike the terminology peek
        // above, which hides on failure - that is a sample of something one
        // click away, and this is the only place the whole grid exists.
        section.hidden = false;
        widgetError(container, 'The matchup grid could not be loaded - ' + e.message);
    }
};
