/**
 * Dogslamloop Wiki - Editor Playground's page (v1.1)
 *
 * The page the Tools menu lists. The Playground itself is edit.html?playground
 * (js/editor-playground.js); this says what it is and opens it. A page of its
 * own, so a new editor finds it before they have ever opened the editor (owner,
 * 2026-10-20).
 */

(function () {
    window.registerWikiTool('editor_playground', async (mount) => {
        const about = document.createElement('div');
        about.className = 'playground-about';
        about.innerHTML = `
            <p>This is a playground to use the wiki's editor. You can go wild here and such, so don't worry about breaking anything.</p>
            <ul>
                <li>The playground will start as a blank character page.</li>
                <li><strong>PULL</strong> copies any page as it is live now, so you can try things on the real content without touching it.</li>
                <li>Your work stays in this browser until you press <strong>NEW</strong>.</li>
                <li>Uploading media is off. Media already in the library can still be used.</li>
            </ul>`;

        const open = document.createElement('a');
        open.href = `${window.getRootPath()}edit.html?playground`;
        open.className = 'btn-manga btn-manga-slanted tool-launch-btn';
        open.innerHTML = '<div class="btn-manga-content"><span class="btn-manga-text">OPEN THE PLAYGROUND</span></div>';

        mount.append(about, open);
    });
})();
