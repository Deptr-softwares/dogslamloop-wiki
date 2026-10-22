// Media has square corners, like the rest of the site (owner, 2026-10-18:
// "Yes sharp corner on all media, Almost everything in the site has sharp
// corner, so the media being not is bothering me").
//
// Read back from what the browser computed, not from the stylesheet. An image
// block without a caption also carried its own inline border-radius from the
// renderer, which a check of the CSS alone would never have seen.
const { test, expect } = require('@playwright/test');

async function cornersOf(page) {
    return page.evaluate(() => {
        const read = (el) => {
            const s = getComputedStyle(el);
            return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(' ');
        };
        const host = document.createElement('div');
        document.querySelector('main').appendChild(host);

        // Both image paths of the real renderer: the captioned one uses the
        // class, the plain one built its own style attribute.
        host.innerHTML = window.generateHTMLForBlocks([
            { type: 'image', src: 'https://example.com/plain.png', alt: 'plain image', align: 'center' },
            { type: 'image', src: 'https://example.com/caption.png', alt: 'captioned image', caption: 'A caption', align: 'center' },
        ], '');

        const named = {};
        host.querySelectorAll('img').forEach(img => { named[img.alt] = read(img); });

        // The rest by class: YouTube embeds, native video, the media helper
        // class, the profile card's portrait and its placeholder, and a
        // discussion avatar, which is an icon and stays round.
        [['iframe', 'wiki-video-embed'], ['video', 'wiki-video-native'], ['img', 'wiki-media'],
         ['img', 'profile-portrait'], ['div', 'profile-portrait-missing'], ['span', 'discussion-avatar']]
            .forEach(([tag, cls]) => {
                const el = document.createElement(tag);
                el.className = cls;
                host.appendChild(el);
                named[cls] = read(el);
            });
        return named;
    });
}

test('every kind of media renders with square corners, and avatars stay round', async ({ page }) => {
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    const out = await cornersOf(page);

    const media = ['plain image', 'captioned image', 'wiki-video-embed', 'wiki-video-native',
        'wiki-media', 'profile-portrait', 'profile-portrait-missing'];
    for (const name of media) {
        expect(out[name], `${name} should have square corners`).toBe('0px 0px 0px 0px');
    }

    // The control: the owner's call was media, not every rounded thing. A
    // blanket reset of border-radius would pass the loop above and fail here.
    expect(out['discussion-avatar']).toBe('50% 50% 50% 50%');
});
