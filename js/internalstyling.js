/**
 * Dogslamloop Wiki - Automated Contextual Text Colorizer & Shortcode Engine
 */

function applyInternalStyling() {
    // 1. Select targets
    const textBlocks = document.querySelectorAll('.wiki-text:not(.is-styled), .vessel-content p:not(.is-styled), .vessel-content li:not(.is-styled), .strategy-paragraph:not(.is-styled), .vessel-content h2:not(.is-styled), .vessel-content h3:not(.is-styled), .vessel-content h4:not(.is-styled), .update-table th:not(.is-styled), .update-table td:not(.is-styled)');
    
    // 2. Pull Characters from the Global Meta configuration
    const characterColors = window.CHARACTER_COLORS || {};

    // Replace literal spaces with \s+ so it catches KaTeX non-breaking spaces
    const charNames = Object.keys(characterColors).map(name => name.replace(/ /g, '\\s+')).join('|');
    const charRegex = new RegExp(`\\b(${charNames})\\b(?![^<]*>)`, 'g');

    // 3. Map Frame Data Terms with \s+ for LaTeX safety
    const frameRules = [
        { pattern: /\b(Startup)\b(?![^<]*>)/gi, color: 'hsl(217.18, 100%, 50%)' },
        { pattern: /\b(Active)\b(?![^<]*>)/gi, color: 'hsl(0, 100%, 45%)' },
        { pattern: /\b(Recovery|Whiff\s+Endlag)\b(?![^<]*>)/gi, color: 'hsl(295, 89.76%, 50.2%)' },
        { pattern: /\b(Self\s+Stun)\b(?![^<]*>)/gi, color: 'hsl(111.06, 100%, 50%)' },
        { pattern: /\b(InSkill\s+Stun)\b(?![^<]*>)/gi, color: 'hsl(34, 99%, 27%)' },
        { pattern: /\b(Target\s+Stun)\b(?![^<]*>)/gi, color: 'hsl(0, 70%, 35%)' },
        { pattern: /\b(Block\s+Endlag|Extended\s+Recovery)\b(?![^<]*>)/gi, color: 'hsl(319.73, 88.24%, 50%)' },
        { pattern: /\b(Misc)\b(?![^<]*>)/gi, color: 'hsl(153.88, 100%, 50%)' },
        { pattern: /\b(Inactive)\b(?![^<]*>)/gi, color: 'hsl(44, 100%, 50%)' }
    ];

    // Detect current character header title context
    const pageTitleEl = document.querySelector('.character-title');
    let currentCharColor = 'var(--text-white)'; // Fallback
    if (pageTitleEl && characterColors[pageTitleEl.textContent.trim()]) {
        currentCharColor = characterColors[pageTitleEl.textContent.trim()];
    }

    textBlocks.forEach(block => {
        block.classList.add('is-styled');
        let content = block.innerHTML;

        // --- STEP A: Custom Shortcodes (Stackable & Nested) ---
        // A do-while loop ensures that nested tags (e.g. [color=red][b][i]Text[/i][/b][/color]) 
        // are processed from the inside out until no more tags are left.
        let previousContent;
        do {
            previousContent = content;
            
            // Standard Formatting
            content = content.replace(/\[b\]((?:(?!\[b\])[\s\S])*?)\[\/b\]/gi, '<strong style="color: var(--text-white);">$1</strong>');
            content = content.replace(/\[i\]((?:(?!\[i\])[\s\S])*?)\[\/i\]/gi, '<em style="font-style: italic;">$1</em>');
            content = content.replace(/\[u\]((?:(?!\[u\])[\s\S])*?)\[\/u\]/gi, '<span style="text-decoration: underline; text-underline-offset: 2px;">$1</span>');
            content = content.replace(/\[s\]((?:(?!\[s\])[\s\S])*?)\[\/s\]/gi, '<span style="text-decoration: line-through; opacity: 0.6;">$1</span>');
            
            // Colors
            content = content.replace(/\[color=([^\]]+)\]((?:(?!\[color=)[\s\S])*?)\[\/color\]/gi, '<span style="color: $1; font-weight: bold;">$2</span>');
            
            // Inline Code Blocks
            content = content.replace(/\[code\]((?:(?!\[code\])[\s\S])*?)\[\/code\]/gi, '<code style="background: rgba(255,255,255,0.1); padding: 0.15rem 0.35rem; border-radius: 4px; font-family: var(--text-mono); color: var(--text-white); font-size: 0.85em; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2);">$1</code>');
            
            // Hyperlinks
            content = content.replace(/\[url=([^\]]+)\]((?:(?!\[url=)[\s\S])*?)\[\/url\]/gi, '<a href="$1" class="wiki-link" target="_blank" style="color: var(--accent-blue); text-decoration: underline; text-underline-offset: 2px; transition: color 0.1s;">$2</a>');
            
        } while (content !== previousContent);
        // Replace literal spaces with \s+ so it catches KaTeX non-breaking spaces
        const charNames = Object.keys(characterColors).map(name => name.replace(/ /g, '\\s+')).join('|');
        
        // NEW: Wrap the regex generation in a safety check!
        if (charNames.length > 0) {
            const charRegex = new RegExp(`\\b(${charNames})\\b(?![^<]*>)`, 'g');

            // --- STEP B: Auto-Highlight Characters (Safe for KaTeX) ---
            content = content.replace(charRegex, (match) => {
                const cleanName = match.replace(/\s+/g, ' '); // Normalize spaces back to literal to match dictionary
                return `<span style="color: ${characterColors[cleanName]}; font-weight: bold;">${match}</span>`;
            });
        }

        // --- STEP C: Auto-Highlight Frame Data Terms (Safe for KaTeX) ---
        frameRules.forEach(rule => {
            content = content.replace(rule.pattern, `<span style="color: ${rule.color}; font-weight: bold;">$1</span>`);
        });

        // --- STEP D: Single-Pass Conditional Frame Timing Engine ---
        // Captures parenthesized or standalone timing indicators safely across word boundaries
        const timingRegex = /(\([-+]?\d+f\)|\([-+]?f\d+\)|\b\d+f\b|\bf\d+\b|[-+]\d+f\b|[-+]f\d+\b)(?![^<]*>)/gi;

        content = content.replace(timingRegex, (match) => {
            let finalColor = currentCharColor;

            if (match.includes('+')) {
                finalColor = 'hsl(127, 59%, 58%)';  // Generic Green Advantage
            } else if (match.includes('-')) {
                finalColor = 'hsl(3, 93%, 63%)';    // Generic Red Disadvantage
            }

            return `<span style="color: ${finalColor}; font-family: var(--text-mono); font-weight: bold;">${match}</span>`;
        });

        // Apply changes back to DOM
        block.innerHTML = content;
    });
}

document.addEventListener('DOMContentLoaded', applyInternalStyling);

const observer = new MutationObserver((mutations) => {
    let shouldRestyle = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            shouldRestyle = true;
            break;
        }
    }
    if (shouldRestyle) {
        applyInternalStyling();
    }
});

// Start watching the main content area once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.querySelector('main');
    if (mainContent) {
        observer.observe(mainContent, { childList: true, subtree: true });
    }
});

window.applyInternalStyling = applyInternalStyling;