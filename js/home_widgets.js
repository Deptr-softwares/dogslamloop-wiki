/**
 * Dogslamloop Wiki - Home Page Widgets Engine (Updates & FAQ)
 */

/* ==========================================
   1. UPDATE LOG ENGINE
========================================== */
let cachedUpdates = [];

async function loadUpdateLogs(containerId, limit = null, filterType = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        if (cachedUpdates.length === 0) {
            if (!window.fetchJson) {
                throw new Error('fetchJson helper is not loaded');
            }

            const rootPath = window.getRootPath ? window.getRootPath() : './';
            const data = await window.fetchJson(`${rootPath}data/updates.json`, { cache: true });
            cachedUpdates = data.changelogs || [];
        }

        container.innerHTML = '';
        let filteredLogs = filterType ? cachedUpdates.filter(log => log.type === filterType) : cachedUpdates;
        const targetedLogs = limit ? filteredLogs.slice(0, limit) : filteredLogs;

        if (targetedLogs.length === 0) {
            container.innerHTML = `<p style="color: #8b949e; font-style: italic;">No recent updates found.</p>`;
            return;
        }

        targetedLogs.forEach(log => {
            const logBox = document.createElement('details');
            logBox.className = 'update-log-item';
            
            let typeBadgeClass = 'badge-general'; 
            if (log.type === 'site') typeBadgeClass = 'badge-site';
            if (log.type === 'patch') typeBadgeClass = 'badge-patch';

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

function toggleUpdates(containerId, buttonId, defaultLimit = 2, filterType = null) {
    const btn = document.getElementById(buttonId);
    const container = document.getElementById(containerId);
    if (!btn || !container) return;

    const isExpanded = btn.getAttribute('data-expanded') === 'true';

    if (isExpanded) {
        loadUpdateLogs(containerId, defaultLimit, filterType);
        btn.textContent = 'View All';
        btn.setAttribute('data-expanded', 'false');
        container.classList.remove('faq-scroll-box');
        container.style.maxHeight = '';
    } else {
        loadUpdateLogs(containerId, null, filterType);
        btn.textContent = 'Show Less';
        btn.setAttribute('data-expanded', 'true');
        container.classList.add('faq-scroll-box');
        container.style.maxHeight = '450px'; 
    }
}

/* ==========================================
   2. FAQ ENGINE
========================================== */
async function loadFAQ(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        if (!window.fetchJson) {
            throw new Error('fetchJson helper is not loaded');
        }

        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const data = await window.fetchJson(`${rootPath}data/faq.json`, { cache: true });
        const faqItems = data.faqs || [];

        if (faqItems.length === 0) {
            container.innerHTML = `<p style="color: #8b949e; font-style: italic;">No FAQ entries found.</p>`;
            return;
        }

        container.innerHTML = '';

        faqItems.forEach(item => {
            const faqDetails = document.createElement('details');
            faqDetails.className = 'faq-details'; 

            let paragraphsHTML = '';
            item.paragraphs.forEach(text => {
                const formattedText = text.replace(/(@[a-zA-Z0-9_\.]+)/g, '<code class="text-purple-400">$1</code>');
                paragraphsHTML += `<p class="faq-paragraph">${formattedText}</p>`;
            });

            faqDetails.innerHTML = `
                <summary class="faq-summary">
                    ${item.question}
                    <span class="faq-arrow">▼</span>
                </summary>
                <div class="faq-content">
                    ${paragraphsHTML}
                </div>
            `;
            container.appendChild(faqDetails);
        });
    } catch (error) {
        console.error("Failed managing live FAQ sync sequences:", error);
        container.innerHTML = `<p class="error-msg" style="color:#f85149; font-style:italic;">Error rendering FAQ records.</p>`;
    }
}

window.loadUpdateLogs = loadUpdateLogs;
window.toggleUpdates = toggleUpdates;
window.loadFAQ = loadFAQ;