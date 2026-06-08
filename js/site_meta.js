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
/**
 * Fetches global site metadata and injects it into the header.
 */
async function loadSiteMetadata() {
    try {
        // Use an absolute path (starting with /) so it works across all subfolders
        // The cache-busting timestamp ensures users always see the latest version
        const response = await fetch(`/data/site_meta.json?t=${Date.now()}`);
        if (!response.ok) throw new Error('Could not fetch site metadata.');
        
        const meta = await response.json();
        
        // Target the subtitle class you use in your headers
        const subtitleElements = document.querySelectorAll('.site-subtitle');
        
        // Loop through and update them (in case there are multiple on one page)
        subtitleElements.forEach(el => {
            el.textContent = `${meta.version} | ${meta.tagline}`;
        });

    } catch (error) {
        console.error('Failed to load site version:', error);
    }
}

// Execute as soon as the DOM is ready
document.addEventListener('DOMContentLoaded', loadSiteMetadata);