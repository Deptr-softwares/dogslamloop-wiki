/**
 * Dogslamloop Wiki - Page Builder & Navigation Module
 */

function setupTabs(buttonGroupType, contentPrefix, tabIds) {
    tabIds.forEach(tabId => {
        const button = document.getElementById(`${buttonGroupType}-${tabId}`);
        if (!button) return;

        button.addEventListener('click', () => {
            tabIds.forEach(id => {
                const btn = document.getElementById(`${buttonGroupType}-${id}`);
                const content = document.getElementById(`${contentPrefix}-${id}`);
                
                // Pure semantic class toggling
                if (btn) btn.classList.remove('active');
                if (content) {
                    content.classList.add('hidden');
                    content.classList.remove('space-y-8');
                }
            });

            // Activate current selection
            button.classList.add('active');
            
            const targetContent = document.getElementById(`${contentPrefix}-${tabId}`);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                if (buttonGroupType === 'nav' && tabId === 'skills') {
                    targetContent.classList.add('space-y-8');
                }
            }
        });
    });
}

/**
 * Fetches and dynamically renders the character roster grid
 */
async function loadRosterGrid() {
    try {
        const response = await fetch('data/roster.json');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const characters = await response.json();
        const rosterGrid = document.querySelector('.roster-grid');
        if (!rosterGrid) return;

        // Clear existing hardcoded placeholder items
        rosterGrid.innerHTML = '';

        characters.forEach(char => {
            const card = document.createElement('a');
            card.href = char.url;
            card.className = 'roster-card';
            card.id = `${char.id}-button`; // Matches the ColorCoding.css identifiers

            const textSpan = document.createElement('span');
            textSpan.className = 'roster-card-text';
            
            // Automatically appends (WIP) tag if flagged true
            textSpan.innerHTML = char.isWip ? `${char.name}<br>(WIP)` : char.name;

            card.appendChild(textSpan);
            rosterGrid.appendChild(card);
        });
    } catch (error) {
        console.error("Failed to compile roster layout grid component:", error);
    }
}

// Initialize on home page load
if (document.querySelector('.roster-grid')) {
    document.addEventListener('DOMContentLoaded', loadRosterGrid);
}

window.setupTabs = setupTabs;