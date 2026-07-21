/**
 * Dogslamloop Wiki - Character Text Descriptions Engine
 */

// Helper to assign CSS classes, inline widths, and safe style merging for media
function getMediaAttributes(align, customWidth, extraStyles = '') {
    let alignClass = 'wiki-media-full';
    
    if (align === 'left') alignClass = 'wiki-media-left';
    else if (align === 'right') alignClass = 'wiki-media-right';
    else if (align === 'center') alignClass = 'wiki-media-center';

    return `class="wiki-media ${alignClass}" style="width: ${customWidth || '100%'}; ${extraStyles}"`;
}

// --- PLAYSTYLE COMPONENT GENERATOR ---
window.generatePlaystyleHTML = function(playstyle) {
    if (!playstyle || (!playstyle.likes?.length && !playstyle.dislikes?.length)) return '';
    
    const renderList = (items, icon, color) => items.map(text => `
        <li style="margin-bottom:0.5rem; display:flex; gap:0.6rem; align-items:flex-start;">
            <span style="color:${color}; font-weight:bold; font-size: 1rem; line-height: 1;">${icon}</span> 
            <span style="line-height: 1.4;">${text}</span>
        </li>
    `).join('');

    return `
        <div class="playstyle-container" style="display: flex; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 250px; background: rgba(34, 197, 94, 0.05); border: 1px solid #22c55e; box-shadow: 4px 4px 0px var(--manga-shadow, #000); padding: 1.25rem 1.5rem;">
                <h4 style="color: #22c55e; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.9rem; text-transform: uppercase; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px dotted #22c55e; padding-bottom: 0.5rem;">PICK IF YOU LIKE</h4>
                <ul style="list-style: none; padding: 0; margin: 0; font-family: var(--text-mono); font-size: 0.8rem; color: #e5e7eb;">
                    ${renderList(playstyle.likes || [], '✓', '#22c55e')}
                </ul>
            </div>
            <div style="flex: 1; min-width: 250px; background: rgba(239, 68, 68, 0.05); border: 1px solid #ef4444; box-shadow: 4px 4px 0px var(--manga-shadow, #000); padding: 1.25rem 1.5rem;">
                <h4 style="color: #ef4444; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.9rem; text-transform: uppercase; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px dotted #ef4444; padding-bottom: 0.5rem;">AVOID IF YOU DISLIKE</h4>
                <ul style="list-style: none; padding: 0; margin: 0; font-family: var(--text-mono); font-size: 0.8rem; color: #e5e7eb;">
                    ${renderList(playstyle.dislikes || [], '✖', '#ef4444')}
                </ul>
            </div>
        </div>
    `;
};

// --- THE RECURSIVE BLOCK ENGINE ---
// This standalone function can render blocks infinitely deep!
window.generateHTMLForBlocks = function(blocks, contextClass = '') { // FIXED 1: Added contextClass parameter
    let contentHTML = '';
    let sectionAuthors = new Set(); // FIXED 2: Initialized the authors array here!
    
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    blocks.forEach(block => {
        if (!block) return;
        
        // FIXED 3: Defined the alignment variable inside the loop so every block can use it!
        const alignAttr = getAlignStyle(block.align); 
        
        if (block.type === 'heading') {
            let headingClass = 'wiki-block-heading';
            if (contextClass) headingClass += ` ${contextClass}-heading`;
            
            const tag = block.size || 'h3';
            
            contentHTML += `<${tag} class="${headingClass}" ${alignAttr}>${block.content}</${tag}>`;
        }
        // --- PARAGRAPHS (With Inline Keybinds & URL Links) ---
        else if (block.type === 'paragraph') {
            const rawText = Array.isArray(block.content) ? block.content.join('<br>') : block.content;
            
            // Convert keybinds
            let text = rawText.replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
            
            const pClass = contextClass ? 'strategy-paragraph card-text' : 'strategy-paragraph';
            contentHTML += `<p class="${pClass}" ${alignAttr}>${text}</p>`;
        }
        else if (block.type === 'list') {
            const lClass = contextClass ? 'wiki-block-list space-y-2 card-text' : 'wiki-block-list space-y-2 text-gray-300';
            contentHTML += `<ul class="${lClass}" ${alignAttr}>`;
            block.items.forEach(item => { contentHTML += `<li>${item}</li>`; });
            contentHTML += `</ul>`;
        }
        else if (block.type === 'image') {
            if (block.caption) {
                contentHTML += `
                    <figure ${getMediaAttributes(block.align, block.width, 'text-align: center;')} >
                        <img src="${block.src}" alt="${block.alt || 'Wiki Image'}" style="width: 100%; border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow, #000);" loading="lazy">
                        <figcaption style="font-family: var(--text-mono); font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; font-style: italic;">
                            ${block.caption}
                        </figcaption>
                    </figure>
                `;
            } else {
                contentHTML += `<img src="${block.src}" alt="${block.alt || 'Wiki Image'}" ${getMediaAttributes(block.align, block.width, 'border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow, #000);')} loading="lazy">`;
            }
        }
        // --- DIVIDERS ---
        else if (block.type === 'divider') {
            const bData = block.data || block; // SAFE EXTRACTOR
            
            // Legacy fallback for old invisible blocks
            let currentStyle = bData.style || (bData.invisible ? 'invisible' : 'diamond');
            let paddingClass = bData.padding || 'normal';
            
            // Resolve the math for the margins
            let marginVal = '2.5rem';
            if (paddingClass === 'none') marginVal = '0';
            else if (paddingClass === 'small') marginVal = '1rem';
            else if (paddingClass === 'large') marginVal = '4rem';
            else if (paddingClass === 'massive') marginVal = '6rem';

            // The master wrapper
            const wrapStart = `<div style="clear: both; margin: ${marginVal} 0; display: flex; align-items: center; justify-content: center; opacity: 0.8; width: 100%;">`;
            const wrapEnd = `</div>`;
            
            let divHtml = '';
            
            // Inject the exact HTML for the requested style
            switch (currentStyle) {
                case 'invisible':
                    divHtml = ``; // Just the margin container!
                    break;
                case 'solid':
                    divHtml = `<div style="width: 100%; height: 2px; background: var(--border-color, #333);"></div>`;
                    break;
                case 'dashed':
                    divHtml = `<div style="width: 100%; height: 2px; border-bottom: 2px dashed var(--border-color, #333);"></div>`;
                    break;
                case 'dotted':
                    divHtml = `<div style="width: 100%; height: 4px; border-bottom: 4px dotted var(--border-color, #333);"></div>`;
                    break;
                case 'double':
                    divHtml = `<div style="width: 100%; height: 6px; border-top: 2px solid var(--border-color, #333); border-bottom: 2px solid var(--border-color, #333);"></div>`;
                    break;
                case 'circle':
                    divHtml = `
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                        <div style="margin: 0 1rem; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent-blue); background: var(--bg-main); box-shadow: 2px 2px 0px var(--manga-shadow);"></div>
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                    `;
                    break;
                case 'cross':
                    divHtml = `
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                        <div style="margin: 0 1rem; font-family: var(--text-mono); color: var(--accent-blue); font-weight: bold; font-size: 1.4rem; line-height: 0.5;">+</div>
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                    `;
                    break;
                case 'fade':
                    divHtml = `<div style="width: 100%; height: 2px; background: linear-gradient(90deg, transparent, var(--border-color, #333) 20%, var(--border-color, #333) 80%, transparent);"></div>`;
                    break;
                case 'slash':
                    divHtml = `
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                        <div style="margin: 0 1rem; font-family: 'CC-Wild-Words', sans-serif; color: var(--border-color, #333); font-size: 1rem; letter-spacing: 2px; font-style: italic;">///</div>
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                    `;
                    break;
                case 'diamond':
                default:
                    divHtml = `
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                        <div style="margin: 0 1rem; transform: rotate(45deg); width: 10px; height: 10px; border: 2px solid var(--accent-blue); background: var(--bg-main); box-shadow: 2px 2px 0px var(--manga-shadow);"></div>
                        <div style="flex-grow: 1; height: 2px; background: var(--border-color, #333);"></div>
                    `;
                    break;
            }
            
            contentHTML += wrapStart + divHtml + wrapEnd;
        }
        // --- STANDALONE AUTHOR BLOCK ---
        else if (block.type === 'author') {
            // (Handled below in the author aggregation step)
        }
        // --- INLINE CALLOUTS ---
        else if (block.type === 'callout') {
            const bData = block.data || block; 
            
            const intentMap = {
                'tip': { color: '#facc15', icon: '💡', label: 'TIP' },
                'warning': { color: '#fb923c', icon: '⚠️', label: 'WARNING' },
                'danger': { color: '#ef4444', icon: '🚨', label: 'DANGER' },
                'info': { color: '#22d3ee', icon: '📌', label: 'INFO' }
            };
            const config = intentMap[bData.intent] || intentMap['info'];
            const text = Array.isArray(bData.content) ? bData.content.join('<br>') : (bData.content || bData.text || '');

            let tooltipContent = '';
            if (bData.title) {
                tooltipContent += `<strong style="color: ${config.color}; font-family: 'CC-Wild-Words', sans-serif; text-transform: uppercase; font-size: 0.9rem; display: block; margin-bottom: 0.5rem; border-bottom: 1px dashed ${config.color}; padding-bottom: 0.25rem;">${bData.title}</strong>`;
            }

            tooltipContent += `<span class="tooltip-desc" style="font-family: var(--text-mono); font-size: 0.75rem; color: #e5e7eb; line-height: 1.5; display: block;">${text}</span>`;

            contentHTML += `
                <div ${getAlignStyle(bData.align)} style="margin: 0.75rem 0;">
                    <span class="inline-callout-btn" style="--callout-color: ${config.color}; display: inline-flex; align-items: center; gap: 0.5rem; background: var(--bg-secondary, #111); border: 2px solid var(--border-color, #333); border-left: 4px solid ${config.color}; color: var(--text-white, #fff); font-family: var(--text-mono); font-size: 0.75rem; font-weight: bold; text-transform: uppercase; padding: 0.4rem 0.75rem; cursor: help; box-shadow: 3px 3px 0px var(--manga-shadow, #000); transition: transform 0.1s, box-shadow 0.1s, border-color 0.1s, color 0.1s;" data-tooltip="${encodeURIComponent(tooltipContent)}" onmouseover="this.style.transform='translate(-2px, -2px)'; this.style.boxShadow='5px 5px 0px ${config.color}'; this.style.borderColor='${config.color}'; this.style.color='${config.color}';" onmouseout="this.style.transform='none'; this.style.boxShadow='3px 3px 0px var(--manga-shadow, #000)'; this.style.borderColor='var(--border-color, #333)'; this.style.color='var(--text-white, #fff)';">
                        <span class="callout-icon" style="font-size: 0.9rem;">${config.icon}</span> 
                        <span class="callout-label">${config.label}</span>
                    </span>
                </div>
            `;
        }
        // --- DATA TABLES ---
        else if (block.type === 'table') {
            const bData = block.data || block; // SAFE EXTRACTOR

            const headers = bData.headers || [];
            const rows = bData.rows || [];
            
            let tableContent = '<table class="update-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">';
            
            // Render Headers
            if (headers.length > 0) {
                tableContent += `<thead><tr style="background: var(--bg-main, #050505); border-bottom: 2px solid var(--border-color, #333);">`;
                headers.forEach(h => {
                    tableContent += `<th style="padding: 0.85rem 1rem; font-family: var(--text-mono); color: var(--accent-blue); text-transform: uppercase;">${h}</th>`;
                });
                tableContent += `</tr></thead>`;
            }
            
            // Render Rows
            if (rows.length > 0) {
                tableContent += `<tbody>`;
                rows.forEach((row, rowIndex) => {
                    // Alternating row background for readability
                    const bgStyle = rowIndex % 2 !== 0 ? 'background: rgba(255,255,255,0.02);' : '';
                    const hoverBg = rowIndex % 2 !== 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
                    
                    tableContent += `<tr style="border-bottom: 1px dashed var(--border-color, #222); ${bgStyle} transition: background 0.1s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='${hoverBg}'">`;
                    
                    // Parse [M1] keybinds natively inside the cells
                    row.forEach(cell => {
                        let parsedCell = (cell || '').replace(/\[([A-Z0-9\s\+]+)\]/g, '<kbd class="keybind-badge">$1</kbd>');
                        tableContent += `<td style="padding: 0.75rem 1rem; color: var(--text-primary, #d1d5db);">${parsedCell}</td>`;
                    });
                    tableContent += `</tr>`;
                });
                tableContent += `</tbody>`;
            } else {
                tableContent += '<tr><td style="padding: 1rem; text-align: center; color: #888; font-style: italic;">Table data is empty.</td></tr>';
            }
            tableContent += '</table>';

            // Wrapping container provides horizontal scrolling on mobile and the heavy manga shadow
            contentHTML += `
                <div style="overflow-x: auto; margin: 1.5rem 0; border: 2px solid var(--border-color, #333); box-shadow: 4px 4px 0px var(--manga-shadow, #000); background: var(--bg-secondary, #0a0a0a);">
                    ${tableContent}
                </div>
            `;
        }
        // --- YOUTUBE & NATIVE VIDEO EMBEDS ---
        else if (block.type === 'youtube' || block.type === 'video' || block.type === 'embed') {
            const bData = block.data || block; 
            let mediaInnerHtml = '';

            if (block.type === 'youtube' || bData.videoId) {
                let videoId = bData.videoId || bData.url || '';
                const ytMatch = videoId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
                if (ytMatch) videoId = ytMatch[1];
                
                if (videoId) {
                    // Injecting data-lazy-src
                    mediaInnerHtml = `
                        <iframe data-lazy-src="https://www.youtube.com/embed/${videoId}" src="about:blank"
                                style="width: 100%; aspect-ratio: 16/9; border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow); background: #050505; border: none; display: block;" 
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                allowfullscreen>
                        </iframe>
                    `;
                }
            } 
            else if (block.type === 'video') {
                const videoUrl = bData.url || bData.src || '';
                if (videoUrl) {
                    const controlsAttr = bData.controls ? 'controls' : 'autoplay loop muted playsinline';
                    // Injecting data-lazy-src and preload="none"
                    mediaInnerHtml = `<video data-lazy-src="${videoUrl}" ${controlsAttr} style="width: 100%; background: #050505; display: block; border-radius: 4px; box-shadow: 4px 4px 0px var(--manga-shadow);" preload="none"></video>`;
                }
            }

            if (mediaInnerHtml) {
                if (bData.caption) {
                    contentHTML += `
                        <figure ${getMediaAttributes(bData.align, bData.width, 'text-align: center;')} >
                            ${mediaInnerHtml}
                            <figcaption style="font-family: var(--text-mono); font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; font-style: italic;">
                                ${bData.caption}
                            </figcaption>
                        </figure>
                    `;
                } else {
                    contentHTML += `
                        <div ${getMediaAttributes(bData.align, bData.width)}>
                            ${mediaInnerHtml}
                        </div>
                    `;
                }
            }
        }
        // --- ACCORDION  ---
        else if (block.type === 'accordion' || block.type === 'details') {
            const bData = block.data || block; 
            const title = bData.title || bData.summary || 'COLLAPSIBLE SECTION';

            // Recursively generate the inner content
            const innerHTML = window.generateHTMLForBlocks(bData.content || [], contextClass);

            // The arrow is pinned via absolute positioning so it doesn't move when the title is centered!
            contentHTML += `
                <div style="margin: 1.5rem 0; width: 100%;">
                    <style>
                        .manga-accordion summary::-webkit-details-marker { display: none; }
                        .manga-accordion[open] summary .accordion-arrow { transform: translateY(-50%) rotate(180deg) !important; }
                    </style>
                    <details class="manga-accordion" style="background: var(--bg-main, #050505); border: 1px solid var(--border-color, #333); box-shadow: 4px 4px 0px var(--manga-shadow, #000); width: 100%;">
                        <summary style="position: relative; padding: 0.75rem 2.5rem 0.75rem 1rem; cursor: pointer; font-family: 'CC-Wild-Words', sans-serif; font-size: 0.8rem; color: var(--accent-blue, #3b82f6); list-style: none; outline: none; user-select: none; text-transform: uppercase; text-align: ${bData.align || 'left'};">
                            <span>${title}</span> 
                            <span class="accordion-arrow" style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); font-size: 0.6rem; color: var(--text-muted, #888); transition: transform 0.2s;">▼</span>
                        </summary>
                        <div style="padding: 1rem; border-top: 1px dashed var(--border-color, #333); background: var(--bg-secondary, #111); display: flex; flex-direction: column; gap: 0.5rem; text-align: left;">
                            ${innerHTML}
                        </div>
                    </details>
                </div>
            `;
        }
        // --- COMBO STRINGS ---
        else if (block.type === 'combo') {
            if (block.sequence && block.sequence.length > 0) {
                
                // Determine flex justification based on alignment
                let justifyClass = 'flex-start';
                if (block.align === 'center') justifyClass = 'center';
                if (block.align === 'right') justifyClass = 'flex-end';

                let comboHTML = `<div class="combo-container" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: ${justifyClass}; gap: 0.5rem; margin: 1.5rem 0;">`;
                
                block.sequence.forEach((move, index) => {
                    // Use the new Keycap aesthetic
                    comboHTML += `<span class="combo-node">${move}</span>`;
                    
                    // Thicker, sharper arrows
                    if (index < block.sequence.length - 1) {
                        comboHTML += `<svg class="combo-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
                    }
                });

                if (block.note || block.damage) {
                    // If aligned left, push the damage to the far right. Otherwise, keep it grouped together.
                    const pushRight = block.align === 'left' ? 'margin-left: auto;' : '';
                    comboHTML += `<div style="display:flex; align-items:center; gap:0.75rem; ${pushRight}">`;
                    
                    if (block.note) {
                        comboHTML += `<span class="combo-note">${block.note}</span>`;
                    }
                    if (block.damage) {
                        comboHTML += `<span class="combo-damage">${block.damage}</span>`;
                    }
                    
                    comboHTML += `</div>`;
                }

                comboHTML += `</div>`;
                contentHTML += comboHTML;
            }
        }
        
        // --- AUTHOR AGGREGATION ---
        if (block.author && block.author.trim() !== '') {
            // Split by comma in case multiple authors collaborated on one block
            block.author.split(',').forEach(a => sectionAuthors.add(a.trim()));
        }
    });

    // --- AUTHOR FOOTER ---
    if (sectionAuthors.size > 0) {
        // Wrap each author in a badge span
        const authorBadges = Array.from(sectionAuthors)
            .map(a => `<span class="author-badge">${a}</span>`)
            .join('');
        
        contentHTML += `
            <div class="aggregated-contributors-footer">
                <div class="contributors-header">
                    <span class="contributors-icon">👥</span>
                    <span class="contributors-text">Contributors</span>
                </div>
                <div class="contributors-list">${authorBadges}</div>
            </div>
        `;
    }

    contentHTML += `<div style="clear: both; display: table; width: 100%;"></div>`;

    return contentHTML;
};

// Helper to apply dynamic text alignment and prevent long-word overflow
function getAlignStyle(align) {
    let styleStr = 'overflow-wrap: break-word; word-break: break-word;';
    if (align) styleStr += ` text-align: ${align};`;
    return `style="${styleStr}"`;
}

function populateTextSection(containerId, sectionTitle, blocks, contextClass = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.classList.remove('vessel-content');
    container.classList.add('content-section-wrapper');

    if (blocks && blocks.length > 0) {

        const section = document.createElement('section');
        
        if (contextClass === 'move-strategy') {
            section.className = 'skill-strategy-section';
        } else if (contextClass === 'system-content') {
            section.className = 'system-content-wrapper'; 
        } else {
            section.className = `wiki-section ${contextClass}`.trim();
        }
        
        if (sectionTitle) {
            section.innerHTML = `<h3 class="strategy-title">${sectionTitle}</h3>`;
        }

        // 1. Generate the HTML using our recursive engine
        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = window.generateHTMLForBlocks(blocks, contextClass);
        section.appendChild(bodyDiv);
        container.appendChild(section);

        // 2. Bind the tooltips
        const callouts = section.querySelectorAll('.inline-callout-btn');
        callouts.forEach(btn => {
            const decodedTooltip = decodeURIComponent(btn.getAttribute('data-tooltip'));
            
            btn.addEventListener('mouseenter', (e) => {
                let frameTooltip = document.getElementById('wiki-frame-tooltip');
                if (!frameTooltip) {
                    frameTooltip = document.createElement('div');
                    frameTooltip.id = 'wiki-frame-tooltip';
                    
                    // Explicitly define the heavy manga box styles here!
                    frameTooltip.style.position = 'fixed';
                    frameTooltip.style.zIndex = '100000';
                    frameTooltip.style.pointerEvents = 'none'; // Prevents it from stealing the hover
                    frameTooltip.style.background = 'var(--bg-main, #050505)';
                    frameTooltip.style.border = '2px solid var(--border-color, #333)';
                    frameTooltip.style.padding = '0.75rem 1rem';
                    frameTooltip.style.boxShadow = '6px 6px 0px var(--manga-shadow, #000)';
                    frameTooltip.style.maxWidth = '320px';
                    
                    document.body.appendChild(frameTooltip);
                }
                
                frameTooltip.innerHTML = decodedTooltip;
                frameTooltip.style.display = 'block'; // Force it to show
            });
            
            btn.addEventListener('mousemove', (e) => {
                const frameTooltip = document.getElementById('wiki-frame-tooltip');
                if(frameTooltip) {
                    let x = e.clientX + 15;
                    let y = e.clientY + 15;
                    const box = frameTooltip.getBoundingClientRect();
                    
                    // Boundary Physics: Flip the box if it gets too close to the right/bottom edges
                    if (x + box.width > window.innerWidth) {
                        x = e.clientX - box.width - 15;
                    }
                    if (y + box.height > window.innerHeight) {
                        y = e.clientY - box.height - 15;
                    }
                    
                    frameTooltip.style.left = x + 'px';
                    frameTooltip.style.top = y + 'px';
                }
            });
            
            btn.addEventListener('mouseleave', () => {
                const frameTooltip = document.getElementById('wiki-frame-tooltip');
                if(frameTooltip) {
                    frameTooltip.style.display = 'none'; 
                }
            });
        });

        // 3. Initialize Lazy Loading for newly injected videos
        if (typeof window.initLazyMedia === 'function') {
            window.initLazyMedia(container);
        }

    } else {
        container.innerHTML = `
            <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-family: var(--text-mono); font-size: 0.85rem; font-style: italic; border-top: 1px dashed var(--border-color);">
                "${sectionTitle}" analysis has not been written yet.
            </div>
        `;
    }
}

async function loadPageDescriptions(pageId, pageType = 'character') {
    try {
        let data = null;
        
        // 1. Check Editor Cache (For Live Preview pane)
        if (window.currentEditorDescData) {
            data = window.currentEditorDescData;
        } 
        else {
            // 2. Check Supabase Cloud Database
            if (typeof window.fetchCloudCharacterData === 'function') {
                const cloudData = await window.fetchCloudCharacterData(pageId);
                if (cloudData && cloudData.desc_data) {
                    data = cloudData.desc_data;
                    console.log(`[Cloud] Loaded ${pageId} descriptions.`);
                }
            }
            
            // 3. FALLBACK: Dynamic Pathing based on pageType!
            if (!data) {
                const rootPath = typeof window.getRootPath === 'function' ? window.getRootPath() : '../../';
                let descPath = '';
                
                if (pageType === 'system') {
                    descPath = `${rootPath}systems/${pageId}/${pageId}_descriptions.json`;
                } else {
                    descPath = `${rootPath}characters/${pageId.charAt(0).toUpperCase() + pageId.slice(1)}/${pageId}_descriptions.json`;
                }
                
                // CRITICAL FIX: Wrapped in try/catch so a missing local JSON file doesn't crash the engine!
                try {
                    data = await window.fetchJson(descPath);
                    console.log(`[Local] Loaded ${pageId} descriptions from ${pageType} directory.`);
                } catch (e) {
                    console.warn(`[Local] No local JSON found for ${pageId}.`);
                }
            }
        }

        // --- PREVENT FATAL CRASH IF NO DATA EXISTS ---
        if (!data) {
            if (pageType === 'system') {
                console.log(`[System] Initializing blank schema for new system page.`);
                data = { tabs: [] }; 
            } else {
                throw new Error("No descriptive data found.");
            }
        }

        // =====================================================================
        // THE SYSTEM PAGE ENGINE (Dynamic Tabs & Sections)
        // =====================================================================
        if (pageType === 'system') {
            const mainArea = document.querySelector('.main-content-area');
            if (!mainArea) return;

            // --- AUTO-MIGRATION: Initialize default tab or rescue old corrupted data ---
            if (!data.tabs || data.tabs.length === 0) {
                let rescuedBlocks = [];
                if (data.overview && data.overview.length > 0) rescuedBlocks.push(...data.overview);
                if (data.strategy && data.strategy.length > 0) rescuedBlocks.push(...data.strategy);
                
                data = {
                    tabs: [{
                        tabId: 'overview',
                        tabLabel: 'Overview',
                        sections: [{ 
                            sectionTitle: rescuedBlocks.length > 0 ? 'Recovered Data' : 'Introduction', 
                            layout: 'full', 
                            blocks: rescuedBlocks 
                        }]
                    }]
                };
            }

            // 1. Wipe out any hardcoded legacy containers and old dynamic navs
            const oldTarget = document.getElementById('tab-overview');
            if (oldTarget) oldTarget.remove();
            const oldNav = document.getElementById('system-dynamic-nav');
            if (oldNav) oldNav.remove();

            // 2. Build the interactive Manga Tab Navigation Bar
            const isEditor = !!document.getElementById('interactive-builder');
            let navHTML = `<nav id="system-dynamic-nav" class="character-nav" style="display: ${isEditor ? 'none' : 'flex'}; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--accent-blue); align-items: center;">`;
            
            const tabIdsForPageBuilder = []; // Passed to setupTabs()

            data.tabs.forEach((tab, idx) => {
                const isActive = idx === 0 ? 'active' : '';
                navHTML += `<button id="nav-${tab.tabId}" class="btn-manga btn-manga-slanted ${isActive}"><div class="btn-manga-content"><span class="btn-manga-text">${tab.tabLabel}</span></div></button>`;
                tabIdsForPageBuilder.push(tab.tabId);
            });
            navHTML += `</nav>`;

            // Inject the nav directly beneath the page header
            const header = mainArea.querySelector('.home-main-header');
            if (header) {
                header.insertAdjacentHTML('afterend', navHTML);
            } else {
                mainArea.insertAdjacentHTML('afterbegin', navHTML);
            }

            // 3. Generate the Tab Containers and Content
            data.tabs.forEach((tab, idx) => {
                let tabContainer = document.getElementById(`tab-${tab.tabId}`);
                if (!tabContainer) {
                    tabContainer = document.createElement('div');
                    tabContainer.id = `tab-${tab.tabId}`;
                    // Removed space-y-6 so Flexbox can properly control vertical margins
                    tabContainer.className = 'tab-content wiki-tab-content';
                    if (idx !== 0) tabContainer.classList.add('hidden'); 
                    mainArea.appendChild(tabContainer);
                }
                
                tabContainer.innerHTML = ''; 
                
                // --- ACTIVATE SMART FLEX GRID ---
                tabContainer.style.display = 'flex';
                tabContainer.style.flexWrap = 'wrap';
                tabContainer.style.margin = '0 -0.5rem'; // Offsets internal padding to keep edges flush

                if (tab.sections && tab.sections.length > 0) {
                    tab.sections.forEach((section, sIdx) => {
                        
                        // --- MIGRATION & CALCULATION ENGINE ---
                        let sWidth = section.width;
                        let sAlign = section.alignment;
                        let sBreak = section.forceBreak;

                        // Seamlessly converts old database data to the new dynamic schema
                        if (sWidth === undefined) {
                            if (section.layout === 'centered') { sWidth = 80; sAlign = 'center'; sBreak = true; }
                            else if (section.layout === 'split-left') { sWidth = 48; sAlign = 'left'; sBreak = false; }
                            else if (section.layout === 'split-right') { sWidth = 48; sAlign = 'right'; sBreak = false; }
                            else { sWidth = 100; sAlign = 'left'; sBreak = true; }
                            
                            section.width = sWidth; section.alignment = sAlign; section.forceBreak = sBreak;
                        }

                        // --- THE ROW BREAKER ---
                        if (sBreak && sIdx !== 0) {
                            const flexBreak = document.createElement('div');
                            flexBreak.style.flexBasis = '100%';
                            flexBreak.style.height = '0';
                            tabContainer.appendChild(flexBreak);
                        }

                        const sectionNode = document.createElement('section');
                        sectionNode.className = 'wiki-section';
                        
                        // --- DYNAMIC GEOMETRY APPLICATION ---
                        sectionNode.style.boxSizing = 'border-box';
                        sectionNode.style.padding = '0 0.5rem'; // Standard horizontal grid padding
                        sectionNode.style.marginBottom = '1.5rem'; // Replaces the old space-y-6
                        
                        sectionNode.style.flex = `0 0 ${sWidth}%`;
                        sectionNode.style.maxWidth = `${sWidth}%`;

                        // Auto-Margin alignment physics 
                        if (sAlign === 'center') {
                            sectionNode.style.marginLeft = 'auto';
                            sectionNode.style.marginRight = 'auto';
                        } else if (sAlign === 'right') {
                            sectionNode.style.marginLeft = 'auto';
                        } else if (sAlign === 'left') {
                            sectionNode.style.marginRight = 'auto';
                        }
                        
                        if (section.sectionTitle) {
                            sectionNode.innerHTML = `<h2 class="section-title mb-4" style="text-transform: uppercase;">${section.sectionTitle}</h2>`;
                        }
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.id = `system-${tab.tabId}-sec-${sIdx}`;
                        sectionNode.appendChild(contentDiv);
                        tabContainer.appendChild(sectionNode);
                        
                        populateTextSection(contentDiv.id, '', section.blocks, 'system-content');
                    });
                    
                    // Flexbox safe clear-fix
                    const clearFix = document.createElement('div');
                    clearFix.style.flexBasis = '100%';
                    clearFix.style.height = '0';
                    tabContainer.appendChild(clearFix);
                } else {
                    tabContainer.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-family: var(--text-mono); font-size: 0.85rem; font-style: italic; border-top: 1px dashed var(--border-color); flex-basis: 100%;">This section has not been written yet.</div>`;
                }
            });

            // --- 4. NATIVE PAGEBUILDER DELEGATION ---
            if (typeof window.setupTabs === 'function') {
                window.setupTabs('nav', 'tab', tabIdsForPageBuilder, 'major');
            }

            if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling();
            
            if (window.renderMathInElement) {
                renderMathInElement(document.body, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
            
            if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
            return; // EXIT EARLY to guarantee Character logic never runs
        }
        // =====================================================================
        // THE CHARACTER PAGE ENGINE (Legacy Strict Architecture)
        // =====================================================================
        else {
            // --- 1. OVERVIEW & STRATEGY TAB ---
            const overviewContainer = document.getElementById('tab-overview');
            if (overviewContainer) {
                overviewContainer.innerHTML = '';
                overviewContainer.classList.add('vessel-content', 'space-y-6');

                const topSplit = document.createElement('div');
                topSplit.className = 'profile-top-split';

                let profileHTML = '';
                if (data.profile) {
                    let statsHTML = '';
                    if (data.profile.stats) {
                        data.profile.stats.forEach(stat => {
                            statsHTML += `
                                <div class="profile-stat-row">
                                    <span class="profile-stat-label">${stat.label}</span>
                                    <span class="profile-stat-val">${stat.value}</span>
                                </div>`;
                        });
                    }

                    const imgHTML = data.profile.image 
                        ? `<img src="${data.profile.image}" class="profile-portrait" alt="Character Portrait">` 
                        : `<div class="profile-portrait-missing">[No Portrait]</div>`;

                    profileHTML = `
                        <aside class="wiki-section profile-card" style="align-self: flex-start;">
                            ${imgHTML}
                            <div class="profile-stats-container">${statsHTML}</div>
                        </aside>
                    `;
                }

                const rightColumn = document.createElement('div');
                rightColumn.className = 'profile-text-wrapper'; 
                rightColumn.style.display = 'flex';
                rightColumn.style.flexDirection = 'column';

                const overviewTextWrapper = document.createElement('div');
                overviewTextWrapper.id = 'overview-text-subnode';
                
                rightColumn.appendChild(overviewTextWrapper);

                if (data.playstyle && (data.playstyle.likes?.length > 0 || data.playstyle.dislikes?.length > 0)) {
                     const playstyleDiv = document.createElement('div');
                     playstyleDiv.innerHTML = window.generatePlaystyleHTML(data.playstyle);
                     rightColumn.appendChild(playstyleDiv);
                }

                topSplit.innerHTML = profileHTML;
                topSplit.appendChild(rightColumn);
                overviewContainer.appendChild(topSplit);

                populateTextSection('overview-text-subnode', 'Character Overview', data.overview);
                if (data.strategy && data.strategy.length > 0) {
                    const stratWrapper = document.createElement('div');
                    stratWrapper.id = 'overview-strategy-subnode';
                    overviewContainer.appendChild(stratWrapper);
                    populateTextSection('overview-strategy-subnode', 'General Strategy', data.strategy);
                }

                if (data.extras && data.extras.length > 0) {
                    data.extras.forEach((extraItem, index) => {
                        const extraWrapper = document.createElement('div');
                        extraWrapper.id = `overview-extra-${index}`;
                        overviewContainer.appendChild(extraWrapper);
                        
                        if (extraItem.content) {
                            populateTextSection(`overview-extra-${index}`, extraItem.title, extraItem.content);
                        }
                    });
                }
            }

            // --- 2. MATCHUPS TAB ---
            const matchupsContainer = document.getElementById('tab-matchups');
            if (matchupsContainer) {
                matchupsContainer.innerHTML = '';
                matchupsContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.matchups && data.matchups.length > 0) {
                    data.matchups.forEach(mu => {

                        const tierColors = {
                            "Unwinnable": "#dc2626", "Extreme Disadvantage": "#ef4444",
                            "Disadvantage": "#fb923c", "Equal": "#9ca3af",
                            "Advantage": "#4ade80", "Extreme Advantage": "#22c55e",
                            "Unloseable": "#22d3ee"
                        };
                        const tierColor = tierColors[mu.tier] || "#ffffff";

                        const muSection = document.createElement('section');
                        muSection.className = 'wiki-section'; 
                        muSection.style.overflow = 'hidden'; 

                        let muHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">vs. ${mu.opponent}</h3>
                                <span class="card-tier-label" style="color: ${tierColor};">${mu.tier}</span>
                            </div>
                        `;

                        muSection.innerHTML = muHTML;
                        matchupsContainer.appendChild(muSection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'matchup-content';
                        contentWrapper.id = `matchup-content-${(mu.opponent || 'Unknown').replace(/\s+/g, '-')}`;
                        muSection.appendChild(contentWrapper);

                        if (mu.content && mu.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', mu.content, 'matchup');

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">No notes recorded for this matchup.</p>`;
                        }
                    });
                }
            }

            // --- 3. COUNTERPLAY TAB ---
            const counterplayContainer = document.getElementById('tab-counterplay');
            if (counterplayContainer) {
                counterplayContainer.innerHTML = '';
                counterplayContainer.classList.add('vessel-content', 'space-y-6'); 

                if (data.counterplay && data.counterplay.length > 0) {
                    data.counterplay.forEach(cp => {

                        const importanceColors = {
                            "Crucial": "#ef4444", "High": "#fb923c",
                            "Moderate": "#facc15", "Low": "#4ade80",
                            "Situational": "#22d3ee"
                        };
                        const impColor = importanceColors[cp.importance] || "#9ca3af";

                        const cpSection = document.createElement('section');
                        cpSection.className = 'wiki-section'; 
                        cpSection.style.overflow = 'hidden';

                        let cpHTML = `
                            <div class="card-header-flex">
                                <h3 class="card-header-title">${cp.topic}</h3>
                                <span class="card-tier-label" style="color: ${impColor};">${cp.importance}</span>
                            </div>
                        `;

                        cpSection.innerHTML = cpHTML;
                        counterplayContainer.appendChild(cpSection);

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'counterplay-content';
                        contentWrapper.id = `counterplay-content-${(cp.topic || 'Unknown').replace(/\s+/g, '-')}`;
                        cpSection.appendChild(contentWrapper);

                        if (cp.content && cp.content.length > 0) {
                            populateTextSection(contentWrapper.id, '', cp.content, 'counterplay');

                            const injectedSection = contentWrapper.querySelector('section.wiki-section');
                            if (injectedSection) injectedSection.classList.remove('wiki-section');

                            const emptyH3 = contentWrapper.querySelector('h3.strategy-title');
                            if (emptyH3 && !emptyH3.textContent) emptyH3.remove();
                        } else {
                            contentWrapper.innerHTML = `<p class="empty-notes-msg">No specific counterplay details recorded.</p>`;
                        }
                    });
                } else {
                     counterplayContainer.innerHTML = `
                        <div class="empty-tab-msg">
                            Counterplay analysis has not been written yet.
                        </div>
                    `;
                }
            }

            // --- 4. MOVE STRATEGIES (M1s, Skills, Specials) ---
            if (data.moveStrategies) {
                setTimeout(() => {
                    for (const [moveId, blocks] of Object.entries(data.moveStrategies)) {
                        populateTextSection(`strategy-${moveId}`, 'Move Overview and Strategy', blocks, 'move-strategy');
                    }
                    if (typeof applyInternalStyling === 'function') applyInternalStyling();
                    if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);
                }, 300); 
            }
        } // End of else block (Character Engine)

        // --- Trigger KaTeX to render LaTeX automatically ---
        if (window.renderMathInElement) {
            renderMathInElement(document.body, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
        
        // --- Auto-Refresh ToC when rendering finishes ---
        if (typeof window.refreshTOC === 'function') setTimeout(window.refreshTOC, 100);

    } catch (error) {
        console.error("Failed handling live descriptive text resource synchronization:", error);
    }
}

// --- LAZY MEDIA OBSERVER ---
window.initLazyMedia = function(rootElement = document) {
    const lazyMedia = rootElement.querySelectorAll('video[data-lazy-src], iframe[data-lazy-src]');
    
    if ('IntersectionObserver' in window) {
        const mediaObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const media = entry.target;
                    // Swap the lazy attribute to the real source
                    media.src = media.getAttribute('data-lazy-src');
                    media.removeAttribute('data-lazy-src');
                    
                    // If it's a video meant to auto-play, trigger it once loaded
                    if (media.tagName === 'VIDEO' && media.hasAttribute('autoplay')) {
                        media.play().catch(e => console.warn("Autoplay prevented:", e));
                    }
                    observer.unobserve(media);
                }
            });
        }, { rootMargin: "300px 0px" }); // Start loading 300px BEFORE it enters the screen

        lazyMedia.forEach(media => mediaObserver.observe(media));
    } else {
        // Fallback for ancient browsers
        lazyMedia.forEach(media => {
            media.src = media.getAttribute('data-lazy-src');
            media.removeAttribute('data-lazy-src');
        });
    }
};

window.loadPageDescriptions = loadPageDescriptions;
window.loadCharacterDescriptions = loadPageDescriptions;
window.populateTextSection = populateTextSection;