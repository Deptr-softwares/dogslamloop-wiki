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
        };
    }
    return out;
}

// ---------------------------------------------------------------- what needs work

/**
 * Characters with unwritten sections, most-incomplete first.
 *
 * Reads the page_completeness view rather than page_data: the same information
 * is a few hundred bytes there and 385 KB here.
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
            // A character with no page_data row at all still needs work - it
            // needs it most. register is exactly this case.
            .filter(([pageId]) => pageId !== 'template')
            .filter(([pageId]) => !window.isEntryPointHidden(archived, pageId))
            .map(([pageId, info]) => {
                const row = byId[pageId] || {};
                const missing = CHARACTER_SECTIONS.filter(s => !row[s.key]);
                return { ...info, pageId, missing };
            })
            .filter(c => c.missing.length > 0)
            .sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));

        if (rows.length === 0) {
            container.innerHTML = `<p class="wiki-section-empty">Every character page is complete. Remarkable.</p>`;
            return;
        }

        const shown = rows.slice(0, limit);
        container.innerHTML = `
            <ul class="needs-work-list">
                ${shown.map(c => `
                    <li class="needs-work-row">
                        <a href="${esc(c.url)}" class="needs-work-name">${esc(c.name)}</a>
                        <span class="needs-work-missing">${c.missing.map(m => esc(m.label)).join(', ')}</span>
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
                        <dt class="glossary-term">${esc(t.term)}</dt>
                        <dd class="glossary-def">${esc(t.definition)}</dd>
                    </div>
                `).join('')}
            </dl>
        `;
    } catch (e) {
        // Hidden rather than error-reported: this section is optional, and a
        // failure to load an optional extra should not shout at a reader.
        section.hidden = true;
    }
};
