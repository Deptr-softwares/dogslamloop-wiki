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
    "Mangaka": "hsl(0, 100%, 96%)", // Fallback for short-name text mentions
    "Lucky Coward": "hsl(272, 43%, 64%)",
    "Crow Charmer": "hsl(233, 39%, 23%)",
    "Black Death": "hsl(352, 49%, 27%)",
    "Boomcat": "hsl(0, 1%, 75%)"
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