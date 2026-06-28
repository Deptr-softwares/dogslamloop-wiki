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
    "Disaster Plant": "hsl(106, 28%, 72%)",
    "True Cannon": "hsl(180, 100%, 83%)",
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
// Execute as soon as the DOM is ready
document.addEventListener('DOMContentLoaded', loadSiteMetadata);