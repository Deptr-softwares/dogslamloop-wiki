/**
 * Site lookups every page reads: the character colours, the names the community
 * uses for characters, the Skill Card accolades, the site's icons, character icon
 * paths, the frame and overlay colours, the site's version line, and the theme a
 * character page paints itself with.
 * @since v0.1
 * @touches site_pages.color (the generated CHARACTER_COLORS region),
 *   style/ColorCoding.css (frame and overlay colours, read at load),
 *   data/site_meta.json (the version and tagline)
 * @watch only CHARACTER_COLORS, between its two markers, is generated
 *   (scripts/fetch-content.js); the rest is hand-written, and the markers stay
 *   exactly as they are
 * @see docs/shared-code.md
 */

// The character colours, keyed by name: a copy of site_pages.color, rewritten by
// `npm run refresh-content` and the nightly job. Change a colour in the owner tools
// (Pages > Page Details > COLOUR), never here. A plain object, not a fetch, because
// ten files read it as they load. fetch-content.js refuses to write without both
// markers.
//
// --- GENERATED REGION: CHARACTER_COLORS (scripts/fetch-content.js) ---
window.CHARACTER_COLORS = {
    "Honored One": "hsl(180, 100%, 83%)",
    "Vessel": "hsl(0, 100%, 80%)",
    "Restless Gambler": "hsl(100, 100%, 75%)",
    "Ten Shadows": "hsl(0, 0%, 47%)",
    "Perfection": "hsl(300, 100%, 83%)",
    "Blood Manipulator": "hsl(0, 39%, 48%)",
    "Switcher": "hsl(180, 100%, 83%)",
    "Defense Attorney": "hsl(35, 20%, 38%)",
    "Cursed Partners": "hsl(300, 100%, 83%)",
    "Puppet Master": "hsl(342, 91%, 46%)",
    "Head of the Hei": "hsl(241, 100%, 75%)",
    "Salaryman": "hsl(204, 100%, 68%)",
    "Disaster Plants": "hsl(106, 28%, 72%)",
    "True Cannon": "hsl(180, 100%, 83%)",
    "Register": "hsl(0, 0%, 100%)",
    "Hired Hunter": "hsl(0, 0%, 20%)",
    "Locust Guy": "hsl(100, 100%, 75%)",
    "Star Rage": "hsl(240, 100%, 83%)",
    "Aspiring Mangaka": "hsl(0, 100%, 96%)",
    "Lucky Coward": "hsl(272, 43%, 64%)",
    "Crow Charmer": "hsl(233, 39%, 23%)",
    "Black Death": "hsl(352, 49%, 27%)",
    "Sky Bender": "hsl(275, 17%, 60%)",
    "Boomcat": "hsl(0, 1%, 75%)",
    "Strongest of History": "hsl(0, 100%, 25%)",
    "Monkey Kid": "hsl(352, 100%, 54%)"
};
// --- END GENERATED REGION ---

// Every other name the community uses for a character, highlighted and linked by
// internalstyling.js in the canonical name's colour. A map of its own, so the colour
// dictionary describes only the roster. Canonical names match CHARACTER_COLORS
// exactly: that is the join.
window.CHARACTER_ALIASES = {
    "Honored One":       ["Gojo", "Gojo Satoru", "Satoru Gojo", "Blue Judas"],
    "Vessel":            ["Itadori Yuji", "Yuji Itadori", "Yuji", "Red Judas"],
    "Restless Gambler":  ["Kinji Hakari", "Hakari Kinji", "Hakari", "Tuca Donka"],
    "Ten Shadows":       ["Fushiguro Megumi", "Megumi Fushiguro", "Megumi", "Potential Man"],
    "Perfection":        ["Mahito", "Mahitoes", "Purifier"],
    "Blood Manipulator": ["Choso", "Nchoso", "Loving and Caring Brother"],
    "Switcher":          ["Aoi Todo", "Todo Aoi", "Todo", "Menace to Society"],
    "Defense Attorney":  ["Hiromi Higuruma", "Higuruma Hiromi", "Higuruma", "Higgy", "Greedy Lawyer"],
    "Cursed Partners":   ["Yuta Okkotsu", "Okkotsu Yuta", "Yuta", "JJK OC"],
    "Puppet Master":     ["Ultimate Mechamaru", "Mechamaru", "Kokichi Muta", "Muta Kokichi", "Kokichi", "Larping Individual"],
    "Head of the Hei":   ["Zenin Naoya", "Naoya Zenin", "Naoya", "Bubble Pop Electric"],
    // No sentence fragments: one fires mid-prose ("Nanami enjoys beating the life out
    // of curses").
    "Salaryman":         ["Kento Nanami", "Nanami Kento", "Nanami"],
    "Disaster Plants":   ["Hanami", "Peaceful Gardener"],
    "True Cannon":       ["Ryu Ishigori", "Ishigori Ryu", "Ryu", "Jane Juliet"],
    "Register":          ["Reggie Star", "Reggie"],
    "Locust Guy":        ["Ko Guy", "MIT Researcher"],
    "Star Rage":         ["Yuki Tsukumo", "Tsukumo Yuki", "Yuki", "Bass da da da"],
    "Aspiring Mangaka":  ["Charles Bernard", "Tatsuki Fujimoto", "Mangaka", "Charles"],
    "Lucky Coward":      ["Haruta Shigemo", "Shigemo Haruta", "Haruta", "Kind Scholar"],
    "Crow Charmer":      ["Mei Mei"],
    "Black Death":       ["Kurourushi", "Kuro", "I love the taste of iron"],
    // The names the game used before, so older posts and Discord messages still link.
    "Hired Hunter":      ["Hired Killer"],
    "Sky Bender":        ["Sky Assassin"]
    // Boomcat has none on purpose: a joke character.
};

/**
 * The Skill Card accolades, in the order a card shows them, whatever order an
 * editor ticks them in. A move stores the ids, so a name can be reworded; an id
 * never changes once used, since it is also the icon's file name
 * (medias/icons/accolades/<id>.png). `color` is the badge's text, border and icon.
 * @since v1.2
 */
window.ACCOLADES = [
    { id: 'blockbreak', name: 'Blockbreak', description: 'This move can break block', color: '#ff5c5c' },
    { id: 'block-bypass', name: 'Block Bypass', description: 'This move ignores block', color: '#a855f7' },
    { id: 'neutral-skip', name: 'Neutral Skip', description: 'This move closes the gap quickly', color: '#facc15' },
    { id: 'punishable-on-block', name: 'Punishable on Block', description: 'This move can be punished on Block', color: '#fca5a5' },
    { id: 'safe-on-block', name: 'Safe on Block', description: 'This move cannot be punished on Block', color: '#4ade80' },
    { id: 'punishable-on-whiff', name: 'Punishable on Whiff', description: 'This move can be punished on Whiff', color: '#fca5a5' },
    { id: 'safe-on-whiff', name: 'Safe on Whiff', description: 'This move cannot be punished on Whiff', color: '#4ade80' },
    { id: 'punishable-on-hit', name: 'Punishable on Hit', description: 'This move can be punished on Hit', color: '#fca5a5' },
    { id: 'safe-on-hit', name: 'Safe on Hit', description: 'This move cannot be punished on Hit', color: '#4ade80' },
    { id: 'evasive-punishable', name: 'Evasive Punishable', description: 'This move is evasive punishable on Hit', color: '#34d399' },
    { id: 'frame-perfect-evasive-punishable', name: 'Frame Perfect Evasive Punishable', description: 'This move is evasive punishable on Hit with a really tight window', color: '#5eead4' },
    { id: 'hit-only-air-ragdoll', name: 'Hit only Air Ragdoll', description: 'This move can only hit ragdoll targets in the air', color: '#818cf8' },
    { id: 'hit-ragdoll', name: 'Hit Ragdoll', description: 'This move can hit ragdoll targets', color: '#38bdf8' },
    { id: 'cannot-hit-ragdoll', name: 'Cannot hit Ragdoll', description: 'This move cannot hit ragdoll targets', color: '#94a3b8' },
    { id: 'uncancelable', name: 'Uncancelable', description: 'This move cannot be canceled after casting it', color: '#ec4899' },
    { id: 'semi-uncancelable', name: 'Semi-uncancelable', description: 'This move can be canceled after casting it with a specific condition', color: '#f472b6' },
    { id: 'invincible', name: 'Invincible', description: 'This move has some sort of I-Frames within its duration', color: '#e9d5ff' },
    { id: 'multi-use', name: 'Multi-use', description: 'This move can be used multiple times before going on cooldown', color: '#fdba74' },
    { id: 'execution', name: 'Execution', description: 'This move kills earlier than its total damage', color: '#ef4444' },
    { id: 'qte', name: 'QTE', description: 'This move has some sort of Quick Time Event in it', color: '#fbbf24' },
    { id: 'buff', name: 'Buff', description: 'This move buffs the character with something', color: '#22c55e' },
    { id: 'debuff', name: 'Debuff', description: 'This move debuffs the opponent with something', color: '#d946ef' },
    { id: 'resource', name: 'Resource', description: "This move helps manage the character's resource gimmick", color: '#fb923c' },
    { id: 'teleport', name: 'Teleport', description: 'This move teleports the character', color: '#14b8a6' },
    { id: 'cursor-aimed', name: 'Cursor-aimed', description: 'This move is aimed with the cursor', color: '#eab308' },
    { id: 'camera-aimed', name: 'Camera-aimed', description: 'This move is aimed with the camera direction', color: '#f59e0b' },
];

/**
 * An accolade's icon. On a badge or a chip it takes its holder's colour; in text
 * (inText, [icon=accolade/<id>]) it stands for the word, so it is named and keeps
 * the accolade's colour. Root-absolute, so one path works at every depth.
 * @since v1.2
 */
window.accoladeIconHTML = function (accolade, { inText = false } = {}) {
    if (!accolade || !/^[a-z0-9-]+$/.test(accolade.id)) return '';
    const file = `--px-icon: url('/medias/icons/accolades/${accolade.id}.png')`;
    if (!inText) return `<span class="px-icon" aria-hidden="true" style="${file}"></span>`;
    const name = window.escapeHtml(accolade.name);
    const color = /^#[0-9a-f]{6}$/i.test(accolade.color || '') ? `; color: ${accolade.color}` : '';
    return `<span class="px-icon text-icon" role="img" aria-label="${name}" title="${name}" style="${file}${color}"></span>`;
};

/**
 * The site's icons (medias/icons/<id>.png, 16px; the tick and the dropdown arrow
 * 8px). The id is the file name and what [icon=ui/<id>] takes, so it never changes
 * once used; `name` is what a hover and a screen reader say for one in text.
 * @since v1.2
 * @watch page_router.js, editor.css and the hand-written pages' Ko-fi buttons write
 *   this markup themselves, since they come before this file
 */
window.UI_ICONS = [
    { id: 'edit', name: 'Edit' },
    { id: 'history', name: 'History' },
    { id: 'discussion', name: 'Discussion' },
    { id: 'search', name: 'Search' },
    { id: 'kofi', name: 'Ko-fi' },
    { id: 'delete', name: 'Delete' },
    { id: 'check', name: 'Check' },
    { id: 'dropdown', name: 'Dropdown' },
    { id: 'align-left', name: 'Align left' },
    { id: 'align-center', name: 'Align center' },
    { id: 'align-right', name: 'Align right' },
    { id: 'dock-overseer', name: 'Overseer' },
    { id: 'dock-inbox', name: 'Inbox' },
    { id: 'dock-submissions', name: 'My Submissions' },
    { id: 'dock-site-settings', name: 'Site Settings' },
    { id: 'role-owner', name: 'Owner' },
    { id: 'role-admin', name: 'Admin' },
    { id: 'role-reviewer', name: 'Reviewer' },
    { id: 'role-trusted-editor', name: 'Trusted Editor' },
    { id: 'role--member', name: 'Member' },
    { id: 'role--guest', name: 'Guest' },
];

/**
 * A site icon: on a button it takes the button's colour and is hidden from screen
 * readers; in text it stands for a word, so it is named. An unknown id draws nothing.
 * @since v1.2
 */
window.uiIconHTML = function (id, { className = '', inText = false } = {}) {
    const icon = window.UI_ICONS.find(i => i.id === id);
    if (!icon) return '';
    const cls = window.escapeHtml(['px-icon', inText ? 'text-icon' : '', className].filter(Boolean).join(' '));
    const file = `--px-icon: url('/medias/icons/${icon.id}.png')`;
    if (!inText) return `<span class="${cls}" aria-hidden="true" style="${file}"></span>`;
    const name = window.escapeHtml(icon.name);
    return `<span class="${cls}" role="img" aria-label="${name}" title="${name}" style="${file}"></span>`;
};

/**
 * A character's icon path, derived from the page id (honored_one ->
 * HonoredOneIcon.webp), never stored: the owner uploads a file and nothing else.
 * A new character's missing file is where the fallback runs.
 * @since v0.16
 */
window.rosterIconPath = function (pageId) {
    if (!pageId) return null;
    const pascal = String(pageId)
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    return pascal ? `medias/images/${pascal}Icon.webp` : null;
};

// The frame and overlay colours, read once from ColorCoding.css's custom
// properties, the one source of colour. ColorCoding.css loads in <head>, before
// this script, on every page.
(function populateFrameColorDictionaries() {
    const rootStyle = getComputedStyle(document.documentElement);
    const readVar = (name) => rootStyle.getPropertyValue(name).trim();

    window.FRAME_COLORS = {
        'bg-tick-start': readVar('--frame-color-start'),
        'bg-tick-active': readVar('--frame-color-active'),
        'bg-tick-recov': readVar('--frame-color-recov'),
        'bg-tick-selfstun': readVar('--frame-color-selfstun'),
        'bg-tick-inskillstun': readVar('--frame-color-inskillstun'),
        'bg-tick-targetstun': readVar('--frame-color-targetstun'),
        'bg-tick-misc': readVar('--frame-color-misc'),
        'bg-tick-blockendlag': readVar('--frame-color-blockendlag'),
        'bg-tick-inactive': readVar('--frame-color-inactive')
    };

    window.WINDOW_COLORS = {
        'iframe-melee': readVar('--window-color-iframe-melee'),
        'iframe-bullet': readVar('--window-color-iframe-bullet'),
        'iframe-explosion': readVar('--window-color-iframe-explosion'),
        'iframe-swarm': readVar('--window-color-iframe-swarm'),
        'iframe-complete': readVar('--window-color-iframe-complete')
    };

    /** The names for the frame and overlay colours, in the frame-data legend's own wording. */
    window.FRAME_COLOR_LABELS = {
        'bg-tick-start': 'Startup',
        'bg-tick-active': 'Active',
        'bg-tick-recov': 'Recovery',
        'bg-tick-selfstun': 'Self Stun',
        'bg-tick-inskillstun': 'InSkill Stun',
        'bg-tick-targetstun': 'Target Stun',
        'bg-tick-misc': 'Misc',
        'bg-tick-blockendlag': 'Block Endlag',
        'bg-tick-inactive': 'Inactive',
        'iframe-melee': 'Melee I-Frames',
        'iframe-bullet': 'Bullet I-Frames',
        'iframe-explosion': 'Explosion I-Frames',
        'iframe-swarm': 'Swarm I-Frames',
        'iframe-complete': 'Complete I-Frames'
    };
})();

/** Writes "version | tagline" from data/site_meta.json into the sidebar's subtitle. */
async function loadSiteMetadata() {
    try {
        if (!window.fetchJson) {
            throw new Error('fetchJson helper is not loaded');
        }

        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const meta = await window.fetchJson(`${rootPath}data/site_meta.json`, { cache: true });

        const subtitleElements = document.querySelectorAll('.site-subtitle');
        subtitleElements.forEach(el => {
            el.textContent = `${meta.version} | ${meta.tagline}`;
        });

    } catch (error) {
        console.error('Failed to load site version:', error);
    }
}

/**
 * A character colour as { h, s, l } (s and l in percent), from hsl() or hex as the
 * owner tools take it, or null.
 */
window.parseCharacterColor = function(color) {
    const text = String(color == null ? '' : color).trim();
    const hslMatch = text.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if (hslMatch) return { h: Number(hslMatch[1]), s: parseFloat(hslMatch[2]), l: parseFloat(hslMatch[3]) };

    const hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) return null;
    const digits = hexMatch[1].length === 3 ? hexMatch[1].replace(/./g, d => d + d) : hexMatch[1];
    const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const chroma = max - min;
    if (chroma === 0) return { h: 0, s: 0, l: l * 100 };

    const s = chroma / (1 - Math.abs(2 * l - 1));
    const sector = max === r ? ((g - b) / chroma + 6) % 6
        : max === g ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;
    return { h: Math.round(sector * 60) % 360, s: s * 100, l: l * 100 };
};

/**
 * Whether a character colour is dark (lightness under 50%): the one test behind
 * --character-ink, the title's shadows and a dark name's outline in prose, which
 * sit side by side and must agree. False for anything unparseable: no outline,
 * rather than one on a guess.
 */
window.isDarkCharacterColor = function(color) {
    const parts = window.parseCharacterColor(color);
    return parts ? parts.l < 50 : false;
};

/** Paints a character page in its character's colour: the accent, the tint, the ink and the title. */
window.applyCharacterTheme = function() {
    const titleEl = document.querySelector('.character-title');
    if (!titleEl) return; 

    const charName = titleEl.textContent.trim();
    const charColor = window.CHARACTER_COLORS[charName];

    if (charColor) {
        document.documentElement.style.setProperty('--accent-blue', charColor);
        
        const parts = window.parseCharacterColor(charColor);
        if (parts) {
            const h = parts.h;
            const s = parts.s;

            const themeSat = s > 0 ? 25 : 0; 
            const bgSat = s > 0 ? 15 : 0;

            document.documentElement.style.setProperty('--border-color', `hsl(${h}, ${themeSat}%, 23%)`);
            document.documentElement.style.setProperty('--text-muted', `hsl(${h}, ${themeSat}%, 65%)`);
            
            document.documentElement.style.setProperty('--bg-main', `hsl(${h}, ${bgSat}%, 7%)`);
            document.documentElement.style.setProperty('--bg-secondary', `hsl(${h}, ${bgSat}%, 11%)`);

            // Box shadows stay black on every character's page.
            document.documentElement.style.setProperty('--manga-shadow', '#000000');

            // Text drawn on a surface filled with the character colour (the combo block's
            // hover highlight).
            const pageIsDark = window.isDarkCharacterColor(charColor);
            document.documentElement.style.setProperty('--character-ink', pageIsDark ? '#ffffff' : '#000000');

            // Marks the page, not the name: one name is on many pages, and needs the outline
            // only on the dark ones.
            document.documentElement.classList.toggle('page-character-dark', pageIsDark);

            let dynamicStyle = document.getElementById('persona-dynamic-styles');
            if (!dynamicStyle) {
                dynamicStyle = document.createElement('style');
                dynamicStyle.id = 'persona-dynamic-styles';
                document.head.appendChild(dynamicStyle);
            }

            // A dark colour: headings and the title get a white outline.
            if (pageIsDark) {
                dynamicStyle.innerHTML = `
                    .section-title, .strategy-title, .card-header-title, .skill-title {
                        color: ${charColor} !important;
                        text-shadow: 
                            -1px -1px 0 #ffffff, 
                             1px -1px 0 #ffffff, 
                            -1px  1px 0 #ffffff, 
                             1px  1px 0 #ffffff,
                             3px  3px 0px #ffffff !important;
                    }
                `;
                
                titleEl.style.color = charColor;
                titleEl.style.textShadow = `
                    -1px -1px 0 #ffffff, 
                     1px -1px 0 #ffffff, 
                    -1px  1px 0 #ffffff, 
                     1px  1px 0 #ffffff,
                     3px  3px 0px #ffffff
                `;
            } else {
                dynamicStyle.innerHTML = ''; 
                titleEl.style.color = 'var(--text-white)';
                titleEl.style.textShadow = `
                    -1px -1px 0 ${charColor}, 
                     1px -1px 0 ${charColor}, 
                    -1px  1px 0 ${charColor}, 
                     1px  1px 0 ${charColor},
                     3px  3px 0px var(--manga-shadow)
                `;
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    loadSiteMetadata();
    applyCharacterTheme();
});