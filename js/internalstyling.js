/**
 * Dogslamloop Wiki - Automated Contextual Text Colorizer
 */

function applyInternalStyling() {
    // Select elements designated for wiki rich formatting context
    const textBlocks = document.querySelectorAll('.wiki-text, .vessel-content p, .vessel-content li');
    
    const rules = [
        { pattern: /\bStartup\b/g, replacement: '<span class="text-[#00e500] font-bold">Startup</span>' },
        { pattern: /\bActive\b/g, replacement: '<span class="text-[#e50000] font-bold">Active</span>' },
        { pattern: /\bRecovery\b/g, replacement: '<span class="text-[#2b5fed] font-bold">Recovery</span>' },
        { pattern: /\bWhiff Endlag\b/gi, replacement: '<span class="text-[#2b5fed] font-bold">Whiff Endlag</span>' },
        { pattern: /\bSelf Stun\b/gi, replacement: '<span class="text-[#4b5563] font-bold">Self Stun</span>' },
        { pattern: /\bInSkill Stun\b/gi, replacement: '<span class="text-[#0f1114] font-bold">InSkill Stun</span>' },
        { pattern: /\bTarget Stun\b/gi, replacement: '<span class="text-[#991b1b] font-bold">Target Stun</span>' },
        { pattern: /\bBlock Endlag\b/gi, replacement: '<span class="text-[#1e3a8a] font-bold">Block Endlag</span>' },
        
        // Match frames formatting such as (30f) or (+48f) or (-46f)
        { pattern: /\(([-+]\d+f)\)/g, replacement: '<span class="text-yellow-400 font-mono font-bold">($1)</span>' },
        { pattern: /\((\d+f)\)/g, replacement: '<span class="text-cyan-400 font-mono">($1)</span>' }
    ];

    textBlocks.forEach(block => {
        let content = block.innerHTML;
        rules.forEach(rule => {
            content = content.replace(rule.pattern, rule.replacement);
        });
        block.innerHTML = content;
    });
}

// Run on page initialization
document.addEventListener('DOMContentLoaded', applyInternalStyling);
window.applyInternalStyling = applyInternalStyling;