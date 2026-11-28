/**
 * The Site Settings box, saved on this device through window.siteSettings
 * (site_utils.js). Loaded the first time it opens, by window.openSiteSettings in
 * site_utils.js, which stays on every page with the store.
 * @since v1.1, as part of site_utils.js
 * @touches window.siteSettings, window.openDialog, the site dropdown
 *   (initializeMangaSelects)
 * @watch every control names its setting in data-setting: a new setting is one
 *   more control, and the box reads and saves it with the rest
 * @see docs/shared-code.md
 */

/**
 * Builds the box on first open, shows each setting's saved value and opens it.
 * Every value in it is the site's own, so nothing is escaped.
 */
window.showSiteSettings = function () {
    let overlay = document.getElementById('site-settings-overlay');
    if (!overlay) {
        overlay = document.createElement('dialog');
        overlay.id = 'site-settings-overlay';
        overlay.className = 'site-dialog';
        overlay.setAttribute('aria-labelledby', 'site-settings-title');
        overlay.innerHTML = `
                <div class="dialog-header"><h3 id="site-settings-title">Site settings</h3></div>
                <div class="dialog-body site-settings-body">
                    <fieldset class="site-setting-group">
                        <legend class="site-setting-name">Look</legend>
                        <label class="site-setting" for="site-setting-look-default">
                            <input type="radio" name="site-setting-look" id="site-setting-look-default" value="default" data-setting="look">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Default</span>
                                <span class="site-setting-hint">The site's usual look.</span>
                            </span>
                        </label>
                        <label class="site-setting" for="site-setting-look-classic">
                            <input type="radio" name="site-setting-look" id="site-setting-look-classic" value="classic" data-setting="look">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Classic</span>
                                <span class="site-setting-hint">A plain, dark wiki look.</span>
                            </span>
                        </label>
                    </fieldset>
                    <fieldset class="site-setting-group">
                        <legend class="site-setting-name">Theme</legend>
                        <span class="site-setting-hint">The colours, over either look. Dark is each look's own.</span>
                        <div class="site-setting-choices" id="site-setting-themes"></div>
                    </fieldset>
                    <fieldset class="site-setting-group">
                        <legend class="site-setting-name">Fonts</legend>
                        <div class="site-setting-font">
                            <label class="site-setting-text" for="site-setting-font-title">
                                <span class="site-setting-name">Title text</span>
                                <span class="site-setting-hint">Page and section titles, the big tabs and buttons.</span>
                            </label>
                            <select class="editor-select" id="site-setting-font-title" data-setting="fontTitle"></select>
                        </div>
                        <div class="site-setting-font">
                            <label class="site-setting-text" for="site-setting-font-label">
                                <span class="site-setting-name">Sub-heading text</span>
                                <span class="site-setting-hint">Small headings, labels, badges and table headers.</span>
                            </label>
                            <select class="editor-select" id="site-setting-font-label" data-setting="fontLabel"></select>
                        </div>
                        <div class="site-setting-font">
                            <label class="site-setting-text" for="site-setting-font-body">
                                <span class="site-setting-name">Regular text</span>
                                <span class="site-setting-hint">Everything else you read.</span>
                            </label>
                            <select class="editor-select" id="site-setting-font-body" data-setting="fontBody"></select>
                        </div>
                    </fieldset>
                    <label class="site-setting" for="site-setting-motion-off">
                        <input type="checkbox" id="site-setting-motion-off" data-setting="motionOff">
                        <span class="site-setting-text">
                            <span class="site-setting-name">Turn off animations</span>
                            <span class="site-setting-hint">Stops hover lifts, button sweeps, flashes and smooth scrolling. If your device is set to reduce motion, the site already follows it.</span>
                        </span>
                    </label>
                    <label class="site-setting" for="site-setting-count-visits">
                        <input type="checkbox" id="site-setting-count-visits" data-setting="countVisits">
                        <span class="site-setting-text">
                            <span class="site-setting-name">Count my visits</span>
                            <span class="site-setting-hint">Your visits are counted anonymously with Umami Cloud, as the Privacy Policy says. Untick it and the site stops loading Umami on this device.</span>
                        </span>
                    </label>
                    <p class="site-settings-note">Saved on this device only.</p>
                    <p class="site-settings-error" hidden>This browser blocked saving, so the setting only lasts until you leave this page.</p>
                </div>
                <div class="dialog-footer"><button type="button" class="btn-sys btn-sys-regular" data-dialog-close>CLOSE</button></div>`;
        // Each font takes the look's own or a face the store knows, filled before the
        // box joins the page, so the site dropdown it becomes has its rows.
        overlay.querySelectorAll('select[data-setting]').forEach(select => {
            select.add(new Option("The look's own", ''));
            Object.entries(window.siteSettings.FACES).forEach(([key, name]) => select.add(new Option(name, key)));
        });
        // One radio a theme, in the store's order, Dark first.
        const themes = overlay.querySelector('#site-setting-themes');
        Object.entries(window.siteSettings.THEMES).forEach(([key, name]) => {
            const id = `site-setting-theme-${key || 'dark'}`;
            const label = document.createElement('label');
            label.className = 'site-setting';
            label.htmlFor = id;
            const input = document.createElement('input');
            Object.assign(input, { type: 'radio', name: 'site-setting-theme', id, value: key });
            input.dataset.setting = 'theme';
            const text = document.createElement('span');
            text.className = 'site-setting-name';
            text.textContent = name;
            label.append(input, text);
            themes.appendChild(label);
        });
        overlay.addEventListener('change', e => {
            const key = e.target.dataset.setting;
            if (!key) return;
            const saved = window.siteSettings.set(key, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
            overlay.querySelector('.site-settings-error').hidden = saved;
        });
        document.body.appendChild(overlay);
    }
    overlay.querySelectorAll('[data-setting]').forEach(control => {
        const value = window.siteSettings.get(control.dataset.setting);
        if (control.type === 'checkbox') control.checked = value;
        else if (control.type === 'radio') control.checked = control.value === value;
        else control.value = value;
    });
    // Nothing typed in it: a click outside closes it.
    window.openDialog(overlay, { light: true });
    overlay.querySelector('[data-setting="look"]:checked').focus();
};
