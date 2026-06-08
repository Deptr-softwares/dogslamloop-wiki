/**
 * Dogslamloop Wiki - Update Log Engine
 */

let cachedUpdates = [];

async function loadUpdateLogs(containerId, limit = null, filterType = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        if (cachedUpdates.length === 0) {
            const response = await fetch(`./data/updates.json?t=${Date.now()}`);
            if (!response.ok) throw new Error("Unable to locate updates profile configuration.");
            const data = await response.json();
            cachedUpdates = data.changelogs || [];
        }

        container.innerHTML = '';

        // Filter logs by type if specified
        let filteredLogs = filterType 
            ? cachedUpdates.filter(log => log.type === filterType) 
            : cachedUpdates;

        const targetedLogs = limit ? filteredLogs.slice(0, limit) : filteredLogs;

        if (targetedLogs.length === 0) {
            container.innerHTML = `<p style="color: #8b949e; font-style: italic;">No recent updates found.</p>`;
            return;
        }

        targetedLogs.forEach(log => {
            // Use native <details> tag for the expand/collapse accordion functionality
            const logBox = document.createElement('details');
            logBox.className = 'update-log-item';
            
            // Dynamic badge styling based on your JSON types
            let typeBadgeClass = 'badge-general'; 
            if (log.type === 'site') typeBadgeClass = 'badge-site';
            if (log.type === 'patch') typeBadgeClass = 'badge-patch';

            // If it's a known type, set label, otherwise just use the string (e.g., "Alpha Launch")
            const typeLabel = log.type === 'site' ? 'Site Update' : (log.type === 'patch' ? 'Game Patch' : log.type);

            let bulletHTML = '';
            if (log.changes) {
                log.changes.forEach(change => bulletHTML += `<li>${change}</li>`);
            }

            logBox.innerHTML = `
                <summary class="update-log-summary">
                    <div class="update-log-meta">
                        <span class="update-version">${log.version}</span>
                        <span class="update-date">${log.date}</span>
                        <span class="update-badge ${typeBadgeClass}">${typeLabel}</span>
                        <span class="expand-hint">▼</span>
                    </div>
                    <h3 class="update-title">${log.title}</h3>
                </summary>
                <div class="update-log-body">
                    <p class="update-desc">${log.description}</p>
                    <ul class="update-bullet-list">${bulletHTML}</ul>
                </div>
            `;
            container.appendChild(logBox);
        });

    } catch (error) {
        console.error("Failed managing live changelog sync sequences:", error);
        container.innerHTML = `<p class="error-msg">Error rendering update history records.</p>`;
    }
}

// Global toggle function to expand or collapse the update timelines
function toggleUpdates(containerId, buttonId, defaultLimit = 2, filterType = null) {
    const btn = document.getElementById(buttonId);
    const container = document.getElementById(containerId);
    if (!btn || !container) return;

    // Check our custom attribute to see if the list is currently expanded
    const isExpanded = btn.getAttribute('data-expanded') === 'true';

    if (isExpanded) {
        // It is expanded, so collapse it back down to the default limit
        loadUpdateLogs(containerId, defaultLimit, filterType);
        btn.textContent = 'View All';
        btn.setAttribute('data-expanded', 'false');
        
        // Remove the scrollbox styling so it returns to normal
        container.classList.remove('faq-scroll-box');
        container.style.maxHeight = '';
    } else {
        // It is collapsed, so expand it to show absolutely everything (limit = null)
        loadUpdateLogs(containerId, null, filterType);
        btn.textContent = 'Show Less';
        btn.setAttribute('data-expanded', 'true');
        
        container.classList.add('faq-scroll-box');
        container.style.maxHeight = '450px'; // Slightly taller than the FAQ box
    }
}

window.loadUpdateLogs = loadUpdateLogs;
window.toggleUpdates = toggleUpdates;