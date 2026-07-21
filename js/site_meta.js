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

// Global Frame Data Color Dictionary (Maps to ColorCoding.css)
window.FRAME_COLORS = {
    'bg-tick-start': 'hsl(217.18, 100%, 50%)',
    'bg-tick-active': 'hsl(0, 100%, 45%)',
    'bg-tick-recov': 'hsl(295, 89.76%, 50.2%)',
    'bg-tick-selfstun': 'hsl(111.06, 100%, 50%)',
    'bg-tick-inskillstun': 'hsl(34, 99%, 27%)',
    'bg-tick-targetstun': 'hsl(0, 70%, 35%)',
    'bg-tick-misc': 'hsl(153.88, 100%, 50%)',
    'bg-tick-blockendlag': 'hsl(319.73, 88.24%, 50%)',
    'bg-tick-inactive': 'hsl(44, 100%, 50%)'
};

// Global Window/Overlay Color Dictionary (Maps to ColorCoding.css)
window.WINDOW_COLORS = {
    'reverse-hitcancel': '#14b8a6', // Cyber Teal
    'iframe-melee': '#94a3b8',      // Silver Slate
    'iframe-bullet': '#3b82f6',     // Electric Blue
    'iframe-explosion': '#f59e0b',  // Vibrant Amber
    'iframe-swarm': '#ec4899',      // Neon Pink
    'iframe-complete': '#ffffff'    // Pure White
};

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