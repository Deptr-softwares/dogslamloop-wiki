// One panel heading on a character page (v1.2). Owner, 2026-11-20: "This type
// of small heading and underline is seemingly only used in the Overview and
// Strategy, M1s, Skills, and Innate sections of a character page. Every other
// parts and pages use this much bigger heading with arguably better underline
// style as well."
//
// The small one was .strategy-title (Overview & Strategy's panels and every
// move's "Move Overview and Strategy"); the bigger one is a card's
// .card-header-title in its .card-header-flex row (Matchups, Starter Guide,
// Counterplay, Combos, Techs). They now match in both looks. Puppet Master's
// colour is dark, so the character theme's !important heading rule is in play
// too. Supabase's REST API is refused: the headings are placed by hand.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Puppet_master/index.html';

for (const look of ['default', 'classic']) {
    test(`${look}: a strategy heading matches a card heading in size, weight, colour and rule`, async ({ page }) => {
        await page.route('**/rest/v1/**', r => r.abort());
        await page.addInitScript((look) => {
            try { localStorage.setItem('dsl_site_settings', JSON.stringify({ look })); } catch (e) {}
        }, look);
        await page.goto(PAGE);
        await expect(page.locator('.character-title')).toHaveText('Puppet Master');

        const m = await page.evaluate(() => {
            document.querySelector('main').insertAdjacentHTML('afterbegin', `
                <section class="wiki-section" id="t-strategy"><h3 class="strategy-title">Character Overview</h3><p>Text.</p></section>
                <section class="wiki-section" id="t-card"><div class="card-header-flex"><h3 class="card-header-title">vs. Vessel</h3></div><p>Text.</p></section>`);
            const pick = (heading, row) => {
                const h = getComputedStyle(heading);
                const r = getComputedStyle(row);
                const panel = row.parentElement;
                const p = getComputedStyle(panel);
                const inner = panel.clientWidth - parseFloat(p.paddingLeft) - parseFloat(p.paddingRight);
                return {
                    size: h.fontSize, weight: h.fontWeight, colour: h.color, font: h.fontFamily,
                    rule: r.borderBottomWidth, ruleColour: r.borderBottomColor, below: r.paddingBottom, after: r.marginBottom,
                    // The rule runs across the panel, not under the words only.
                    across: Math.abs(row.getBoundingClientRect().width - inner) < 1,
                };
            };
            const s = document.querySelector('#t-strategy .strategy-title');
            return {
                strategy: pick(s, s),
                card: pick(document.querySelector('#t-card .card-header-title'), document.querySelector('#t-card .card-header-flex')),
            };
        });
        expect(m.strategy.across, 'the strategy heading\'s rule spans the panel').toBe(true);
        expect(m.strategy).toEqual(m.card);
    });
}
