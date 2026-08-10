/**
 * Dogslamloop Wiki - Editor: tool pages (page_type 'tool')
 *
 * js/tool_page.js shipped a renderer that reads desc_data.tool, and nothing
 * ever wrote it - so a tool page could exist but never be pointed at anything.
 * This is the other half.
 *
 * A tool page is three things, and they are edited separately because they
 * belong to different people: the CONFIG (where the tool lives, whether it
 * embeds) is the owner's, while the INTRO and NOTES are ordinary wiki prose
 * that any contributor can improve. Splitting them means a note fixing a typo
 * never carries a change to the tool's URL along with it.
 *
 * Tools with their own registered renderer (window.registerWikiTool) ignore
 * the link/embed config entirely - it is the fallback for a tool that is
 * genuinely just a link, like the Skill Builder ID Reader. The form says so
 * rather than pretending otherwise.
 */

(function () {
    const SECTIONS = [
        { id: 'intro', label: 'Intro', hint: 'Shown above the tool.' },
        { id: 'notes', label: 'Notes', hint: 'Shown below the tool.' },
    ];

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v === null || v === undefined ? '' : v));

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
        // Flush first: currentStrategyBlocks only reaches desc_data on sync, so
        // switching without this drops the paragraph being typed - into the
        // other section, at that.
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

        // A tool with its own renderer does not use the link/embed fallback,
        // and saying so beats leaving someone to wonder why the URL they typed
        // changes nothing.
        const hasOwnRenderer = !!(window.WIKI_TOOLS && window.WIKI_TOOLS[window.currentEditorCharId]);

        const sectionTabs = SECTIONS.map(s => `
            <button class="daw-tab-btn${s.id === active.id ? ' active' : ''}" data-tool-section="${s.id}">${esc(s.label)}</button>
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
                           value="${esc(config.url || '')}" placeholder="https://...">

                    <div class="editor-row editor-row-divider">
                        <div>
                            <label class="block-field-label-sm" for="tool-launch-label">Button text</label>
                            <input type="text" class="editor-input" id="tool-launch-label"
                                   value="${esc(config.launchLabel || '')}" placeholder="Open the tool">
                        </div>
                        <div>
                            <label class="block-field-label-sm" for="tool-height">Embed height (px)</label>
                            <input type="number" class="editor-input" id="tool-height" min="200" max="2000" step="20"
                                   value="${esc(config.height || 720)}">
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

            <div class="daw-variant-tabs daw-editor-nav-row" id="tool-section-tabs">${sectionTabs}</div>
            <p class="tool-editor-hint">${esc(active.hint)}</p>
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

    // Called by the sync engine, which owns when the block buffer is flushed.
    window.flushToolBlocks = function() {
        const desc = window.currentEditorDescData;
        if (!desc) return;
        const sectionId = SECTIONS.some(s => s.id === window.currentToolSection) ? window.currentToolSection : 'intro';
        desc[sectionId] = JSON.parse(JSON.stringify(currentStrategyBlocks));
    };

    /**
     * The deltas a tool page submits.
     *
     * Three scopes rather than one whole-page payload, for the same reason the
     * gallery emits one delta per item: the config belongs to the owner and the
     * prose belongs to everyone, so a contributor improving the intro must not
     * be able to carry a change to the tool's URL with them - and a reviewer
     * approving one must not silently apply the other.
     *
     * Exported so it can be driven directly; editor-core.js's submit handler is
     * otherwise reachable only through auth, the QA modal and a live insert.
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
