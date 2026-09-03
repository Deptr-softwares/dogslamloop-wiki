/**
 * Dogslamloop Wiki - Home Page Widgets Engine (Updates & FAQ)
 * Fully integrated with the V0.4 Design System (DSL)
 */

let cachedUpdates = [];

// --- SHARED CHANGELOG RENDER HELPERS ---
// Used by both the homepage "Recent Changes" widget and the full
// systems/updatelog page, so the two views can't drift out of sync.
function getUpdateBadgeClass(type) {
    if (type === 'site') return 'badge-site';
    if (type === 'Beta Launch' || type === 'Alpha Launch') return 'badge-patch';
    return 'badge-general';
}

function buildUpdateTableHTML(tableData) {
    if (!tableData || !tableData.headers || !tableData.rows) return '';
    const headersHTML = tableData.headers.map(h => `<th>${h}</th>`).join('');
    const rowsHTML = tableData.rows.map(row => {
        const cellsHTML = row.map(cell => `<td>${cell}</td>`).join('');
        return `<tr class="update-row">${cellsHTML}</tr>`;
    }).join('');

    return `
        <div class="update-table-container" style="overflow-x: auto; margin-top: 1rem; border: 2px solid var(--border-color); box-shadow: 4px 4px 0px var(--manga-shadow); background: var(--bg-main);">
            <table class="update-table" style="width: 100%; border-collapse: collapse;">
                <thead><tr>${headersHTML}</tr></thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        </div>
    `;
}

// Every release is divided into Features, Fine-tuning and Bug fixes (owner,
// 2026-09-03), so `changes` can carry headings as well as lines.
//
// ADDITIVE, and deliberately so: a heading is `{ heading: "Features" }` and a
// change is still a plain string, so the eighteen entries written before this
// render exactly as they did. Same mechanism as the ticket-chat `type` field -
// the older shape is the fallback, not a migration.
//
// An object rather than a magic string ("Features" as a bare line) because a
// heading and a change line would otherwise be indistinguishable, and one day
// somebody writes a change that happens to read "Bug fixes".
function buildUpdateChangesHTML(changes) {
    if (!changes || changes.length === 0) return '';

    // One <ul> per group, so a heading is a real heading rather than a bullet
    // pretending to be one. A list that starts with lines and no heading - every
    // older entry - opens an unheaded group and never closes one.
    let html = '';
    let open = false;

    changes.forEach(change => {
        const heading = change && typeof change === 'object' ? change.heading : null;
        if (heading) {
            if (open) { html += '</ul>'; open = false; }
            html += `<h4 class="update-changes-heading">${window.escapeHtml ? window.escapeHtml(heading) : heading}</h4>`;
            return;
        }
        if (!open) {
            html += `<ul class="wiki-block-list space-y-2 update-changes-list" style="color: var(--text-primary); font-size: 0.85rem; margin-top: 1rem;">`;
            open = true;
        }
        html += `<li>${change}</li>`;
    });

    if (open) html += '</ul>';
    return html;
}

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

            const typeBadgeClass = getUpdateBadgeClass(log.type);
            const tableHTML = buildUpdateTableHTML(log.tableData);
            const changesHTML = buildUpdateChangesHTML(log.changes);

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
                    ${changesHTML}
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
window.getUpdateBadgeClass = getUpdateBadgeClass;
window.buildUpdateTableHTML = buildUpdateTableHTML;
window.buildUpdateChangesHTML = buildUpdateChangesHTML;
/**
 * Renders the main dashboard's Credits list.
 *
 * This used to be a hardcoded <ul> in index.html that duplicated
 * systems/collaborators/collaborators_data.json by hand - and the two had
 * already drifted, listing different people. Both now read the same file, so
 * editing credits in owner.html updates both places.
 */
async function loadCredits(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Reuses the existing dot palette so the list looks the way it always has;
    // cycled by position rather than stored, since the colour carries no
    // meaning.
    const DOTS = ['dot-green', 'dot-blue', 'dot-yellow', 'dot-lime', 'dot-grey', 'dot-pink'];

    const escapeHtml = (str) => String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    try {
        const rootPath = window.getRootPath ? window.getRootPath() : './';
        const data = await window.fetchJson(`${rootPath}systems/collaborators/collaborators_data.json`, { cache: true });

        const people = [
            ...(data.mainContributors || []).map(c => ({ name: c.name, note: c.role || c.description })),
            ...(data.specialThanks || []).map(c => ({ name: c.name, note: c.reason })),
        ];

        if (people.length === 0) {
            container.innerHTML = `<li><p class="loading-msg">No credits yet.</p></li>`;
            return;
        }

        container.innerHTML = people.map((person, i) => `
            <li>
                <span class="dot-indicator ${DOTS[i % DOTS.length]}"></span>
                <div><span class="credit-name">@${escapeHtml(person.name)}</span>${person.note ? ` - ${escapeHtml(person.note)}` : ''}</div>
            </li>
        `).join('');
    } catch (error) {
        console.error('Failed loading credits:', error);
        container.innerHTML = `<li><p class="loading-msg">Could not load credits.</p></li>`;
    }
}

window.loadCredits = loadCredits;
