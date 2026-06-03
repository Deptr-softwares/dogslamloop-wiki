// js/framedata.js

/**
 * Creates a visual block of frame ticks
 * @param {number} frames - Number of frames for this phase
 * @param {number} totalScale - The maximum width of the timeline for proportional scaling
 * @param {string} colorClass - The CSS class for the color (e.g., 'bg-tick-green')
 * @param {string} tooltipText - Hover text
 */
function createPhase(frames, totalScale, colorClass, tooltipText) {
    const percentage = (frames / totalScale) * 100;
    let phaseDiv = document.createElement('div');
    phaseDiv.className = `phase-section ${colorClass}`;
    phaseDiv.style.width = `${percentage}%`;
    if (tooltipText) phaseDiv.title = tooltipText; 
    
    // Generate individual ticks
    for(let i = 0; i < frames; i++) {
        let tick = document.createElement('div');
        tick.className = 'frame-tick';
        phaseDiv.appendChild(tick);
    }
    return phaseDiv;
}

/**
 * A universal function to handle switching any set of tabs
 * @param {string} btnPrefix - The ID prefix for the buttons (e.g., 'nav')
 * @param {string} viewPrefix - The ID prefix for the content views (e.g., 'tab')
 * @param {Array} tabNames - Array of tab name strings
 */
function setupTabs(btnPrefix, viewPrefix, tabNames) {
    tabNames.forEach(activeTab => {
        const triggerBtn = document.getElementById(`${btnPrefix}-${activeTab}`);
        if (!triggerBtn) return; // Skip if button doesn't exist on page

        triggerBtn.addEventListener('click', () => {
            tabNames.forEach(tab => {
                const btn = document.getElementById(`${btnPrefix}-${tab}`);
                const view = document.getElementById(`${viewPrefix}-${tab}`);
                
                if (!btn || !view) return;

                if (tab === activeTab) {
                    // Turn On
                    if (btnPrefix === 'nav') {
                        btn.classList.add('active'); // Character Hub specific class
                    } else {
                        btn.classList.replace('text-gray-500', 'text-white'); // Move specific classes
                        btn.classList.add('border-b-2', 'border-blue-500');
                    }
                    view.classList.remove('hidden');
                } else {
                    // Turn Off
                    if (btnPrefix === 'nav') {
                        btn.classList.remove('active');
                    } else {
                        btn.classList.replace('text-white', 'text-gray-500');
                        btn.classList.remove('border-b-2', 'border-blue-500');
                    }
                    view.classList.add('hidden');
                }
            });
        });
    });
}