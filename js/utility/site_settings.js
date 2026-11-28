/**
 * The Site Settings box, saved on this device through window.siteSettings
 * (site_utils.js). Loaded the first time it opens, by window.openSiteSettings in
 * site_utils.js, which stays on every page with the store.
 * @since v1.1, as part of site_utils.js
 * @touches window.siteSettings, window.openDialog
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
                            <input type="radio" name="site-setting-look" id="site-setting-look-default" value="default">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Default</span>
                                <span class="site-setting-hint">The site's usual look.</span>
                            </span>
                        </label>
                        <label class="site-setting" for="site-setting-look-classic">
                            <input type="radio" name="site-setting-look" id="site-setting-look-classic" value="classic">
                            <span class="site-setting-text">
                                <span class="site-setting-name">Classic</span>
                                <span class="site-setting-hint">A plain, dark wiki look.</span>
                            </span>
                        </label>
                    </fieldset>
                    <label class="site-setting" for="site-setting-motion-off">
                        <input type="checkbox" id="site-setting-motion-off">
                        <span class="site-setting-text">
                            <span class="site-setting-name">Turn off animations</span>
                            <span class="site-setting-hint">Stops hover lifts, button sweeps, flashes and smooth scrolling. If your device is set to reduce motion, the site already follows it.</span>
                        </span>
                    </label>
                    <p class="site-settings-note">Saved on this device only.</p>
                    <p class="site-settings-error" hidden>This browser blocked saving, so the setting only lasts until you leave this page.</p>
                </div>
                <div class="dialog-footer"><button type="button" class="btn-sys btn-sys-regular" data-dialog-close>CLOSE</button></div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#site-setting-motion-off').addEventListener('change', e => {
            const saved = window.siteSettings.set('motionOff', e.target.checked);
            overlay.querySelector('.site-settings-error').hidden = saved;
        });
        overlay.querySelector('.site-setting-group').addEventListener('change', e => {
            const saved = window.siteSettings.set('look', e.target.value);
            overlay.querySelector('.site-settings-error').hidden = saved;
        });
    }
    const look = window.siteSettings.get('look') === 'classic' ? 'classic' : 'default';
    overlay.querySelector(`#site-setting-look-${look}`).checked = true;
    overlay.querySelector('#site-setting-motion-off').checked = window.siteSettings.get('motionOff');
    // Nothing typed in it: a click outside closes it.
    window.openDialog(overlay, { light: true });
    overlay.querySelector(`#site-setting-look-${look}`).focus();
};
