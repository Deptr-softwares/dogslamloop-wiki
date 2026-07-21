/**
 * Dogslamloop Wiki - Home Page Widgets Engine (Updates & FAQ)
 * Fully integrated with the V0.4 Design System (DSL)
 */

let cachedUpdates = [];

async function loadUpdateLogs(containerId, limit = null, filterType = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        if (cachedUpdates.length === 0) {
            if (!window.fetchJson) throw new Error('fetchJson helper is not loaded');

            const rootPath = window.getRootPath ? window.getRootPath() : './';
            const data = await window.fetchJson(`${rootPath}data/updates.json`, { cache: true });
            cachedUpdates = data.changelogs || [];
        }

        container.innerHTML = '';
        let filteredLogs = filterType ? cachedUpdates.filter(log => log.type === filterType) : cachedUpdates;
        const targetedLogs = limit ? filteredLogs.slice(0, limit) : filteredLogs;

        if (targetedLogs.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No recent updates found.</p>`;
            return;
        }

        targetedLogs.forEach(log => {
            const logBox = document.createElement('details');
            logBox.className = 'update-log-item';
            
            let typeBadgeClass = 'badge-general';
            if (log.type === 'Site Structure') typeBadgeClass = 'badge-site';
            if (log.type === 'Game Patch') typeBadgeClass = 'badge-patch';

            // --- V0.4 AESTHETIC TABLE UPGRADE ---
            let tableHTML = '';
            if (log.tableData && log.tableData.headers && log.tableData.rows) {
                let headersHTML = log.tableData.headers.map(h => `<th>${h}</th>`).join('');
                let rowsHTML = log.tableData.rows.map(row => {
                    let cellsHTML = row.map((cell, idx) => `<td>${cell}</td>`).join('');
                    return `<tr class="update-row">${cellsHTML}</tr>`;
                }).join('');

                tableHTML = `
                    <div class="update-table-container" style="overflow-x: auto; margin-top: 1rem; border: 2px solid var(--border-color); box-shadow: 4px 4px 0px var(--manga-shadow); background: var(--bg-main);">
                        <table class="update-table" style="width: 100%; border-collapse: collapse;">
                            <thead><tr>${headersHTML}</tr></thead>
                            <tbody>${rowsHTML}</tbody>
                        </table>
                    </div>
                `;
            }

            logBox.innerHTML = `
                <summary class="update-log-summary">
                    <div class="update-log-meta">
                        <span>${log.date}</span>
                        <span class="update-badge ${typeBadgeClass}">${log.type}</span>
                        <span class="expand-hint">▼</span>
                    </div>
                    <h3 class="update-title">${log.title}</h3>
                </summary>
                <div class="update-log-body">
                    <p class="strategy-paragraph" style="color: var(--text-primary); margin: 0;">${log.description}</p>
                    ${tableHTML}
                </div>
            `;
            container.appendChild(logBox);
        });
    } catch (error) {
        console.error("Failed loading live update log streams:", error);
        container.innerHTML = `<p class="loading-msg" style="color: #ef4444;">Error rendering site update metrics.</p>`;
    }
}

async function loadFAQ(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const data = await window.fetchJson(`${rootPath}data/faq.json`, { cache: true });
        const faqItems = data.faqs || [];

        if (faqItems.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No FAQ entries found.</p>`;
            return;
        }

        container.innerHTML = '';

        faqItems.forEach(item => {
            const faqDetails = document.createElement('details');
            faqDetails.className = 'faq-details'; 

            let paragraphsHTML = '';
            item.paragraphs.forEach(text => {
                const formattedText = text.replace(/(@[a-zA-Z0-9_\.]+)/g, '<span style="color: #a855f7; font-family: var(--text-mono); font-weight: bold;">$1</span>');
                paragraphsHTML += `<p class="strategy-paragraph" style="margin-bottom: 0.5rem;">${formattedText}</p>`;
            });

            faqDetails.innerHTML = `
                <summary class="faq-summary">
                    <span>${item.question}</span>
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
        container.innerHTML = `<p class="loading-msg" style="color:#ef4444;">Error rendering FAQ records.</p>`;
    }
}

window.loadUpdateLogs = loadUpdateLogs;
window.loadFAQ = loadFAQ;