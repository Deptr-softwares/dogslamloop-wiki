/**
 * The dashboard widgets on the hubs: what needs work, recent character edits, the
 * tier snapshot, wiki stats, a terminology peek and the site-wide matchup grid.
 * Computed from the data, so there is nothing to author.
 * @since v0.11
 * @touches data/navigation.json, site_pages, page_completeness, approved_revisions,
 *   page_data (the tier list's, the Terminologies page's, every page's matchups),
 *   data/archived-pages.json
 * @watch nothing is fetched twice; a failure says so rather than leaving an empty
 *   box; archived pages are filtered out (isEntryPointHidden), since these reads do
 *   not come from navigation.json alone
 * @see docs/home.md
 */

/** "3 days ago" for anything recent, a plain date beyond. Local: posts.js's long date suits a post, not a feed. */
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
    { key: 'has_specials', label: 'Innate' },
    { key: 'has_strategy', label: 'Strategy' },
    { key: 'has_matchups', label: 'Matchups' },
    { key: 'has_counterplay', label: 'Counterplay' },
];

function widgetError(container, message) {
    container.innerHTML = `<p class="admin-error-text">${window.escapeHtml(message)}</p>`;
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

/**
 * The characters flagged work in progress (is_wip, an editorial call, not a
 * measure), each with the sections it is missing, from the page_completeness view.
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
                        <a href="${window.escapeHtml(c.url)}" class="needs-work-name">${window.escapeHtml(c.name)}</a>
                        <span class="needs-work-missing">${
                            // A page can be flagged in progress with every
                            // section already written - the flag is a
                            // judgement, not a measurement.
                            c.missing.length > 0
                                ? c.missing.map(m => window.escapeHtml(m.label)).join(', ')
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

/** Approved edits to character pages, newest first. */
window.buildRecentCharacterEdits = async function(containerId, limit = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [characters, archived, { data, error }] = await Promise.all([
            liveCharacters(),
            window.fetchArchivedPages ? window.fetchArchivedPages() : {},
            window.supabaseClient
                .from('approved_revisions')
                .select('page_id, author_name, created_at')
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
                        <a href="${window.escapeHtml(r.url)}" class="recent-edit-name">${window.escapeHtml(r.name)}</a>
                        <span class="recent-edit-meta">${window.escapeHtml(relativeDate(r.created_at))} &middot; ${window.escapeHtml(r.author_name || 'someone')}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    } catch (e) {
        widgetError(container, `Could not load recent edits: ${e.message}`);
    }
};

/** The community tier list, compactly, from the tier list's own page_data. */
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
                    <span class="tier-snapshot-label" style="background-color: ${window.escapeHtml(tier.color || 'var(--bg-secondary)')};">${window.escapeHtml(tier.name)}</span>
                    <div class="tier-snapshot-names">
                        ${names.map(c => `<a href="${window.escapeHtml(c.url)}" class="tier-snapshot-name">${window.escapeHtml(c.name)}</a>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        widgetError(container, `Could not load the tier list: ${e.message}`);
    }
};

/** Pages, contributors and approved edits. */
window.buildWikiStats = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const [pages, revisions] = await Promise.all([
            window.supabaseClient.from('site_pages').select('page_id', { count: 'exact', head: true }).eq('status', 'live'),
            // Names rather than a count: the same query answers "how many
            // edits" and "how many people", and head:true cannot do the second.
            window.supabaseClient.from('approved_revisions').select('author_name'),
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
                        <span class="wiki-stat-value">${window.escapeHtml(s.value)}</span>
                        <span class="wiki-stat-label">${window.escapeHtml(s.label)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        widgetError(container, `Could not load site statistics: ${e.message}`);
    }
};

/**
 * A few terms from the Terminologies page, or nothing at all when it has no real
 * content: an empty glossary box is worse than none.
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
                        <dt class="glossary-term wiki-text">${window.escapeHtml(t.term)}</dt>
                        <dd class="glossary-def wiki-text">${window.escapeHtml(t.definition)}</dd>
                    </div>
                `).join('')}
            </dl>
        `;

        // wiki-text marks this as prose for format_tags.js, whose observer on <main>
        // styles it, so format tags in a term render. The section must stay inside <main>
        // (a test checks).
    } catch (e) {
        // Hidden rather than error-reported: this section is optional, and a
        // failure to load an optional extra should not shout at a reader.
        section.hidden = true;
    }
};

/**
 * The site-wide matchup grid on the systems hub: every character against every
 * other, each cell coloured by the tier the row character's page claims, read
 * through resolveMatchupTier so free-text tiers still draw.
 * @watch any mismatch between a pair's two pages is a Clash, one step included, and
 *   is marked, never resolved: picking a winner would invent a rating nobody wrote.
 *   A pair rated from one side, or a tier off the ladder, is never one.
 */
window.buildMatchupTable = async function (sectionId, containerId) {
    const section = document.getElementById(sectionId);
    const container = document.getElementById(containerId);
    if (!section || !container) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';

        // Narrowed with a json selector rather than all of desc_data (content still rides
        // along: PostgREST cannot project inside a json array).
        const [navData, rows] = await Promise.all([
            window.fetchJson(rootPath + 'data/navigation.json', { cache: true }),
            window.supabaseClient
                .from('page_data')
                .select('page_id,matchups:desc_data->matchups')
                .then(r => { if (r.error) throw r.error; return r.data || []; }),
        ]);

        // In navigation.json's order, like every menu, without archived pages and without
        // hidden characters, as row and column, so no Clash involves one.
        const roster = ((navData || {}).Characters || [])
            .filter(c => c && c.cms_config && c.cms_config.pageId && c.name && !c.isHidden);
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

        // A rung on MATCHUP_TIERS, or -1 for wording off the ladder, through
        // resolveMatchupTier, so the two renamed tiers compare as the words they became.
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
            '<th class="matchup-grid-col" scope="col" data-tip="' + window.escapeHtml(c.name) + '">'
            + window.escapeHtml(abbrev(c.name)) + '</th>').join('');

        const body = roster.map(rowChar => {
            const rowClashes = clashOf.get(rowChar.name);
            const cells = roster.map(colChar => {
                if (colChar.name === rowChar.name) {
                    return '<td class="matchup-grid-cell is-self" aria-hidden="true"></td>';
                }
                const raw = ratingOf(rowChar.name, colChar.name);
                if (raw === undefined) {
                    return '<td class="matchup-grid-cell is-blank" data-tip="'
                        + window.escapeHtml(rowChar.name) + ' vs ' + window.escapeHtml(colChar.name) + ': not rated"></td>';
                }

                const tier = window.resolveMatchupTier(raw);
                const href = matchupHref(rowChar, colChar);
                const label = window.escapeHtml(rowChar.name) + ' vs ' + window.escapeHtml(colChar.name) + ': ' + window.escapeHtml(tier.id);

                // A clashing cell names the other page's rating as well, so it
                // says what it disagrees with without opening the list. A new
                // line in the tooltip, a full stop for a screen reader.
                const other = rowClashes ? rowClashes.get(colChar.name) : undefined;
                const clash = other
                    ? 'Clash: ' + window.escapeHtml(colChar.name) + ' vs ' + window.escapeHtml(rowChar.name) + ' is ' + window.escapeHtml(other.id)
                    : '';

                return '<td class="matchup-grid-cell">'
                    + '<a class="matchup-grid-link' + (clash ? ' is-clash' : '') + '" href="' + window.escapeHtml(href) + '"'
                    + ' style="background:' + window.escapeHtml(tier.color) + '"'
                    + ' data-tip="' + label + (clash ? '&#10;' + clash : '') + '">'
                    + '<span class="sr-only">' + label + (clash ? '. ' + clash : '') + '</span></a></td>';
            }).join('');

            return '<tr><th class="matchup-grid-row" scope="row" style="color:'
                + window.escapeHtml(colour(rowChar.name)) + '">'
                + '<a href="' + window.escapeHtml(rootPath + rowChar.url) + '?tab=matchups">'
                + window.escapeHtml(rowChar.name) + '</a></th>' + cells + '</tr>';
        }).join('');

        const legend = window.MATCHUP_TIERS.map(t =>
            '<span class="matchup-legend-item">'
            + '<span class="matchup-legend-swatch" style="background:' + window.escapeHtml(t.color) + '"></span>'
            + window.escapeHtml(t.id) + '</span>').join('')
            + (clashes.length
                ? '<span class="matchup-legend-item"><span class="matchup-legend-swatch is-clash"></span>Clash</span>'
                : '');

        // One notice per pair, as a sentence ("Honored One vs True Cannon is Equal but True
        // Cannon vs Honored One is Hopeless"), each half linking to the page that wrote it.
        // Collapsed, since the grid is the point; absent when there are none.
        const side = (rowChar, colChar, tier) =>
            '<a href="' + window.escapeHtml(matchupHref(rowChar, colChar)) + '">'
            + window.escapeHtml(rowChar.name) + ' vs ' + window.escapeHtml(colChar.name) + '</a> is '
            + '<span class="matchup-clash-tier" style="color:' + window.escapeHtml(tier.color) + '">'
            + window.escapeHtml(tier.id) + '</span>';
        const notices = clashes.length
            ? '<details class="matchup-clashes"><summary>Clashes (' + clashes.length + ')</summary>'
                + '<p class="matchup-grid-caption">Clash: the two character pages don\'t mirror each'
                + ' other. Advantage on one page should read Disadvantage on the other, and such.</p><ol>'
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
        // A failure explains itself: unlike the terminology peek, this is the only place
        // the grid exists.
        section.hidden = false;
        widgetError(container, 'The matchup grid could not be loaded - ' + e.message);
    }
};
