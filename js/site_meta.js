/**
 * Dogslamloop Wiki - Global Site Metadata & Configurations
 */

// Global Character Color Dictionary (Single Source of Truth)
window.CHARACTER_COLORS = {
    "Vessel": "hsl(0, 100%, 80%)",
    "Honored One": "hsl(180, 100%, 83%)",
    "Restless Gambler": "hsl(100, 100%, 75%)",
    "Ten Shadows": "hsl(0, 0%, 47%)",
    "Perfection": "hsl(300, 100%, 83%)",
    "Blood Manipulator": "hsl(0, 39%, 48%)",
    "Switcher": "hsl(180, 100%, 83%)",
    "Defense Attorney": "hsl(35, 20%, 38%)",
    "Cursed Partners": "hsl(300, 100%, 83%)",
    "Puppet Master": "hsl(342, 91%, 46%)",
    "Salaryman": "hsl(204, 100%, 68%)",
    "Head of the Hei": "hsl(241, 100%, 75%)",
    "Disaster Plants": "hsl(106, 28%, 72%)",
    "True Cannon": "hsl(180, 100%, 83%)",
    "Register": "hsl(0, 0%, 100%)",
    "Locust Guy": "hsl(100, 100%, 75%)",
    "Star Rage": "hsl(240, 100%, 83%)",
    "Aspiring Mangaka": "hsl(0, 100%, 96%)",
    "Lucky Coward": "hsl(272, 43%, 64%)",
    "Crow Charmer": "hsl(233, 39%, 23%)",
    "Black Death": "hsl(352, 49%, 27%)",
    "Boomcat": "hsl(0, 1%, 75%)"
};

// Every other name the community uses for a character, owner-supplied
// 2026-08-14. js/internalstyling.js highlights and links these exactly as it
// does the canonical name, using the canonical name's colour.
//
// A SEPARATE MAP RATHER THAN MORE KEYS IN CHARACTER_COLORS. "Mangaka" used to
// live in that dictionary with a comment explaining it was a text fallback,
// which meant anything iterating the roster saw a character that does not
// exist. A colour dictionary should describe the roster; this describes how
// people write about it.
//
// Canonical names must match CHARACTER_COLORS exactly - that is the join.
window.CHARACTER_ALIASES = {
    "Honored One":       ["Gojo", "Gojo Satoru", "Satoru Gojo", "Blue Judas"],
    // The list as supplied had "Itadori Yuji" twice; read as the two orderings.
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
    // "enjoys beating the life out of" was supplied and then withdrawn: it is
    // a sentence fragment, so it fired mid-prose - "Nanami enjoys beating the
    // life out of curses" would colour and link the middle of that sentence.
    "Salaryman":         ["Kento Nanami", "Nanami Kento", "Nanami"],
    "Disaster Plants":   ["Hanami", "Peaceful Gardener"],
    "True Cannon":       ["Ryu Ishigori", "Ishigori Ryu", "Ryu", "Jane Juliet"],
    "Register":          ["Reggie Star", "Reggie"],
    "Locust Guy":        ["Ko Guy", "MIT Researcher"],
    "Star Rage":         ["Yuki Tsukumo", "Tsukumo Yuki", "Yuki", "Bass da da da"],
    "Aspiring Mangaka":  ["Charles Bernard", "Tatsuki Fujimoto", "Mangaka", "Charles"],
    "Lucky Coward":      ["Haruta Shigemo", "Shigemo Haruta", "Haruta", "Kind Scholar"],
    "Crow Charmer":      ["Mei Mei"],
    "Black Death":       ["Kurourushi", "Kuro", "I love the taste of iron"]
    // Boomcat has none on purpose - it is the owner's joke character.
};

// Frame Data & Window/Overlay Color Dictionaries.
// ColorCoding.css's :root custom properties are the single source of truth;
// read them once here instead of duplicating literal color values in JS.
// This relies on ColorCoding.css being loaded (in <head>) before this
// script runs, which holds true across every page in the site.
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
        'reverse-hitcancel': readVar('--window-color-rhc'),
        'iframe-melee': readVar('--window-color-iframe-melee'),
        'iframe-bullet': readVar('--window-color-iframe-bullet'),
        'iframe-explosion': readVar('--window-color-iframe-explosion'),
        'iframe-swarm': readVar('--window-color-iframe-swarm'),
        'iframe-complete': readVar('--window-color-iframe-complete')
    };

    // Display names for the two dictionaries above, so anything offering these
    // colours as a choice calls them what the frame-data legend calls them.
    // The wording is taken from that legend (js/framedata.js) rather than
    // invented - "InSkill Stun" and "Melee I-Frames" are the terms the people
    // maintaining this data actually use.
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
        'reverse-hitcancel': 'Reverse Hitcancel',
        'iframe-melee': 'Melee I-Frames',
        'iframe-bullet': 'Bullet I-Frames',
        'iframe-explosion': 'Explosion I-Frames',
        'iframe-swarm': 'Swarm I-Frames',
        'iframe-complete': 'Complete I-Frames'
    };
})();

/**
 * Fetches global site metadata and injects it into the header.
 */
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
 * Automatically extracts the character's Hue and paints the entire UI.
 */
window.applyCharacterTheme = function() {
    const titleEl = document.querySelector('.character-title');
    if (!titleEl) return; 

    const charName = titleEl.textContent.trim();
    const charColor = window.CHARACTER_COLORS[charName];

    if (charColor) {
        // 1. The Accent Replacement
        document.documentElement.style.setProperty('--accent-blue', charColor);
        
        // 2. The Universal Tint Engine
        const hslMatch = charColor.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
        if (hslMatch) {
            const h = hslMatch[1];
            const s = parseFloat(hslMatch[2]);
            const l = parseFloat(hslMatch[3]); 
            
            const themeSat = s > 0 ? 25 : 0; 
            const bgSat = s > 0 ? 15 : 0;

            document.documentElement.style.setProperty('--border-color', `hsl(${h}, ${themeSat}%, 23%)`);
            document.documentElement.style.setProperty('--text-muted', `hsl(${h}, ${themeSat}%, 65%)`);
            
            document.documentElement.style.setProperty('--bg-main', `hsl(${h}, ${bgSat}%, 7%)`);
            document.documentElement.style.setProperty('--bg-secondary', `hsl(${h}, ${bgSat}%, 11%)`);

            // Ensure global box shadows stay black!
            document.documentElement.style.setProperty('--manga-shadow', '#000000');

            // 3. THE TEXT SHADOW ENGINE
            let dynamicStyle = document.getElementById('persona-dynamic-styles');
            if (!dynamicStyle) {
                dynamicStyle = document.createElement('style');
                dynamicStyle.id = 'persona-dynamic-styles';
                document.head.appendChild(dynamicStyle);
            }

            // If Lightness is below 50% (Ten Shadows, Crow Charmer, Black Death)
            if (l < 50) {
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
                // Normal behavior for bright characters
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

// Execute boot sequence
document.addEventListener('DOMContentLoaded', () => {
    loadSiteMetadata();
    applyCharacterTheme();
});