/**
 * Dogslamloop Wiki - Dynamic Content Database Loader
 */

async function loadCharacterDescriptions(characterId) {
    try {
        // Adjust path based on your final production deployment structure
        const response = await fetch('../data/description.json');
        if (!response.ok) throw new Error('Failed to fetch description asset data');
        
        const data = await response.json();
        const characterData = data[characterId];
        
        if (!characterData) return;

        // Map general structural categories
        const textSections = ['overview', 'm1s', 'specials', 'matchups', 'counterplay'];
        textSections.forEach(section => {
            const container = document.getElementById(`tab-${section}`);
            if (container && characterData[section]) {
                container.innerHTML = characterData[section];
                container.classList.remove('text-gray-500', 'italic', 'text-center');
            }
        });

        // Trigger text styling processing after data is written to DOM
        if (window.applyInternalStyling) {
            window.applyInternalStyling();
        }

    } catch (error) {
        console.error('Error handling description component construction:', error);
    }
}

window.loadCharacterDescriptions = loadCharacterDescriptions;