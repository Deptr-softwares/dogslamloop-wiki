/**
 * Dogslamloop Wiki - FAQ Fetcher
 */

async function loadFAQ(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        // Cache bust query parameter ensures instant updates across user refreshes
        const response = await fetch(`./data/faq.json?t=${Date.now()}`);
        if (!response.ok) throw new Error("Unable to locate FAQ profile configuration.");
        
        const data = await response.json();
        const faqItems = data.faqs || [];

        if (faqItems.length === 0) {
            container.innerHTML = `<p style="color: #8b949e; font-style: italic;">No FAQ entries found.</p>`;
            return;
        }

        container.innerHTML = '';

        faqItems.forEach(item => {
            const faqDetails = document.createElement('details');
            faqDetails.className = 'faq-details'; // Matches your defined UI theme layout

            // Compile all string elements in the paragraph array
            let paragraphsHTML = '';
            item.paragraphs.forEach(text => {
                // Formatting bonus: Auto-wrap @handles with your custom purple class highlight
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

// Export initialization handle globally
window.loadFAQ = loadFAQ;