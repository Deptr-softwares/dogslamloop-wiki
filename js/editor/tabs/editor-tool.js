/**
 * The tool page editor: the config (where the tool lives, whether it embeds) and
 * two Block lists of prose, the intro and the notes, edited apart.
 * @since v0.12
 * @touches desc_data.tool, desc_data.intro and notes, window.WIKI_TOOLS
 *   (tool_page.js), the Block editor
 * @watch the config is the owner's and the prose everyone's, so they are separate
 *   scopes: a typo fix in the notes never carries a URL change. A tool with its
 *   own renderer ignores the link and embed config, and the form says so.
 * @see docs/editor.md
 */

(function () {
    const SECTIONS = [
        { id: 'intro', label: 'Intro', hint: 'Shown above the tool.' },
        { id: 'notes', label: 'Notes', hint: 'Shown below the tool.' },
    ];

    function toolConfig() {
        const desc = window.currentEditorDescData || {};
        if (!desc.tool) desc.tool = {};
        return desc.tool;
    }

    function syncPreview() {
        if (typeof window.saveLocalDraft === 'function') window.saveLocalDraft();
        if (typeof window.renderToolPage === 'function' && window.currentEditorCharId) {
            window.renderToolPage(window.currentEditorCharId);
        }
    }

    window.switchToolSection = async function(sectionId) {
        if (sectionId === window.currentToolSection) return;
        // Flushed first: the buffer reaches desc_data only on sync, and would land in the
        // other section.
        if (typeof window.triggerManualSync === 'function') await window.triggerManualSync();
        window.currentToolSection = sectionId;
        window.renderToolEditor(document.getElementById('interactive-builder'));
    };

    window.renderToolEditor = function(builder) {
        if (!builder) return;

        const desc = window.currentEditorDescData || {};
        const config = toolConfig();

        if (!SECTIONS.some(s => s.id === window.currentToolSection)) {
            window.currentToolSection = 'intro';
        }
        const active = SECTIONS.find(s => s.id === window.currentToolSection);

        // A tool with its own renderer does not use the link fallback; better said than
        // left to wonder.
        const hasOwnRenderer = !!(window.WIKI_TOOLS && window.WIKI_TOOLS[window.currentEditorCharId]);

        const sectionTabs = SECTIONS.map(s => `
            <button class="sub-tab${s.id === active.id ? ' is-active' : ''}" data-tool-section="${s.id}">${window.escapeHtml(s.label)}</button>
        `).join('');

        builder.innerHTML = `
            <div class="editor-section-banner editor-section-banner-spaced">
                <span class="editor-section-banner-text">TOOL SETUP</span>
            </div>

            <div class="block-editor-container block-editor-container-tight">
                <div class="block-card">
                    <div class="block-header">
                        <span class="block-type-badge">${hasOwnRenderer ? 'TOOL OPTIONS' : 'LINKED TOOL'}</span>
                    </div>

                    ${hasOwnRenderer ? `
                        <p class="tool-editor-hint">
                            This page has its own built-in tool, so it ignores the link and embed
                            settings below. They are kept because they are what the page falls back
                            to if that tool ever fails to load.
                        </p>` : ''}

                    <label class="block-field-label-sm" for="tool-url">Tool URL</label>
                    <input type="text" class="editor-input" id="tool-url"
                           value="${window.escapeHtml(config.url || '')}" placeholder="https://...">

                    <div class="editor-row editor-row-divider">
                        <div>
                            <label class="block-field-label-sm" for="tool-launch-label">Button text</label>
                            <input type="text" class="editor-input" id="tool-launch-label"
                                   value="${window.escapeHtml(config.launchLabel || '')}" placeholder="Open the tool">
                        </div>
                        <div>
                            <label class="block-field-label-sm" for="tool-height">Embed height (px)</label>
                            <input type="number" class="editor-input" id="tool-height" min="200" max="2000" step="20"
                                   value="${window.escapeHtml(config.height || 720)}">
                        </div>
                    </div>

                    <label class="system-checkbox-label tool-embed-toggle">
                        <input type="checkbox" id="tool-embed" ${config.embed ? 'checked' : ''}>
                        Show the tool embedded in the page
                    </label>
                    <!-- Opt-in rather than automatic, and the reason is worth
                         repeating to whoever ticks it: a tool served with
                         X-Frame-Options renders as a permanently blank box that
                         the page has no way to detect. -->
                    <p class="tool-editor-hint">
                        Leave this off unless you have checked the tool actually loads in a frame.
                        Some sites refuse, and the page cannot tell - it just shows an empty box.
                        The launch button is always there either way.
                    </p>
                </div>
            </div>

            <div class="editor-section-banner editor-section-banner-spaced">
                <span class="editor-section-banner-text">PAGE TEXT</span>
            </div>

            <div class="sub-tabs sub-tabs-scroll editor-nav-row" id="tool-section-tabs" role="tablist" aria-label="Tool sections">${sectionTabs}</div>
            <p class="tool-editor-hint">${window.escapeHtml(active.hint)}</p>
            <div id="tool-block-target"></div>
        `;

        builder.querySelector('#tool-url').addEventListener('input', (e) => {
            config.url = e.target.value; syncPreview();
        });
        builder.querySelector('#tool-launch-label').addEventListener('input', (e) => {
            config.launchLabel = e.target.value; syncPreview();
        });
        builder.querySelector('#tool-height').addEventListener('input', (e) => {
            config.height = parseInt(e.target.value, 10) || 720; syncPreview();
        });
        builder.querySelector('#tool-embed').addEventListener('change', (e) => {
            config.embed = e.target.checked; syncPreview();
        });

        builder.querySelectorAll('[data-tool-section]').forEach(btn => {
            btn.addEventListener('click', () => window.switchToolSection(btn.dataset.toolSection));
        });

        if (typeof initStrategyBlockBuilder === 'function') {
            initStrategyBlockBuilder('tool-block-target', desc[active.id] || []);
        }
    };

    /**
     * Writes the buffer back into the intro or the notes; the sync engine decides
     * when.
     */
    window.flushToolBlocks = function() {
        const desc = window.currentEditorDescData;
        if (!desc) return;
        const sectionId = SECTIONS.some(s => s.id === window.currentToolSection) ? window.currentToolSection : 'intro';
        desc[sectionId] = JSON.parse(JSON.stringify(currentStrategyBlocks));
    };

    /**
     * The deltas a tool page submits: three scopes, never one whole-page payload, so
     * approving the prose never applies a config change with it. Here so it can be
     * tested directly.
     */
    window.buildToolDeltas = function(local, cloud) {
        const localDesc = local || {};
        const cloudDesc = cloud || {};
        const differs = (a, b) => JSON.stringify(a || null) !== JSON.stringify(b || null);

        const deltas = [];
        if (differs(localDesc.tool, cloudDesc.tool)) {
            deltas.push({ scope: 'tool_config', key: 'full', payload: localDesc.tool || null });
        }
        SECTIONS.forEach(s => {
            if (differs(localDesc[s.id], cloudDesc[s.id])) {
                deltas.push({ scope: s.id, key: 'full', payload: localDesc[s.id] || null });
            }
        });
        return deltas;
    };
})();
