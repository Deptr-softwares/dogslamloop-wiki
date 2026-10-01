/**
 * Dogslamloop Wiki - Owner tools: the broken-media report (v0.20 batch 3)
 *
 * Every image and video link on every page, checked, and the ones that load
 * nothing listed by page and by where on the page. On 2026-09-28 a one-off scan
 * found 86 of the 466 linked files missing, on 15 pages: placeholder M1 images
 * never uploaded, clips deleted after being linked, expired Discord attachment
 * links, and one address with a second one pasted into the middle of it. This
 * makes that scan repeatable, so a dead link can be fixed rather than found by
 * a reader.
 *
 * ON DEMAND, NEVER A CHECK. It reads owner content. A test or a CI step that
 * failed on a dead link would turn every edit that breaks one into a red
 * required check, and CLAUDE.md records what that does to the site: the
 * regeneration job stops and everything goes stale.
 *
 * HOW A FILE IS CHECKED, from the owner's own browser:
 *   - a HEAD request where the host allows it (Supabase Storage does), which
 *     answers exactly;
 *   - otherwise a detached <img> or <video>, which any host answers, Discord's
 *     CDN included. Detached, so the page's own missing-media listener never
 *     sees it.
 * A file that answers neither way within TIMEOUT_MS is "not checked", never
 * "fine": a slow host is not a working link.
 */
(function () {
    const MEDIA_EXT = /\.(webm|mp4|mov|m4v|ogv|gif|webp|png|jpe?g|avif)$/i;
    const VIDEO_EXT = /\.(webm|mp4|mov|m4v|ogv)$/i;
    const CONCURRENCY = 6;
    const TIMEOUT_MS = 15000;

    // An address, to a media file or into Storage. Relative /medias/ paths are
    // the site's own files and count too.
    function isMediaLink(s) {
        if (!/^(https?:\/\/|\/medias\/|medias\/)/i.test(s)) return false;
        return MEDIA_EXT.test(s.split(/[?#]/)[0]) || s.includes('/storage/v1/object/');
    }

    function sectionLabel(key) {
        const tab = (window.CHARACTER_TABS || []).find(t => t.id === key);
        if (tab) return tab.label;
        return String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
            .replace(/^./, c => c.toUpperCase());
    }

    // Headings and names carry the site's [b]...[/b] shortcodes; the report
    // wants the words.
    function plain(s) {
        return String(s).replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    // Where a link sits, as a trail a person can follow on the page: the tab or
    // section, the named thing it belongs to (a move, a matchup, a card), and
    // the nearest heading above it.
    function collectRefs(pageId, data, refs) {
        const walk = (node, trail) => {
            if (typeof node === 'string') {
                const s = node.trim();
                if (isMediaLink(s)) refs.push({ pageId, url: s, where: trail.filter(Boolean).join(' > ') });
                return;
            }
            if (Array.isArray(node)) {
                let heading = null;
                node.forEach(item => {
                    if (item && typeof item === 'object' && item.type === 'heading' && typeof item.content === 'string') {
                        heading = plain(item.content);
                    }
                    walk(item, heading ? trail.concat(heading) : trail);
                });
                return;
            }
            if (node && typeof node === 'object') {
                const own = ['name', 'title', 'opponent', 'topic', 'label']
                    .map(k => node[k]).find(v => typeof v === 'string' && v.trim());
                const next = own ? trail.concat(plain(own)) : trail;
                Object.values(node).forEach(v => walk(v, next));
            }
        };
        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([key, value]) => walk(value, [sectionLabel(key)]));
        }
    }

    function absolute(url) {
        try { return new URL(url, window.location.origin + '/').href; } catch (e) { return null; }
    }

    // null when the host will not say (no CORS), so the element probe decides.
    async function checkWithFetch(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
            return res.ok ? 'ok' : 'missing';
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function checkWithElement(url) {
        return new Promise(resolve => {
            const isVideo = VIDEO_EXT.test(url.split(/[?#]/)[0]);
            const el = document.createElement(isVideo ? 'video' : 'img');
            let settled = false;
            const finish = (verdict) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                // Stop the download: only the answer was wanted.
                if (isVideo) { el.removeAttribute('src'); el.load(); } else { el.removeAttribute('src'); }
                resolve(verdict);
            };
            const timer = setTimeout(() => finish('unknown'), TIMEOUT_MS);
            el.addEventListener(isVideo ? 'loadedmetadata' : 'load', () => finish('ok'), { once: true });
            el.addEventListener('error', () => finish('missing'), { once: true });
            if (isVideo) { el.preload = 'metadata'; el.muted = true; }
            el.src = url;
        });
    }

    async function checkFile(url) {
        const abs = absolute(url);
        if (!abs) return 'missing';
        return (await checkWithFetch(abs)) || checkWithElement(abs);
    }

    async function runPool(items, worker, onProgress) {
        let next = 0;
        let done = 0;
        const lane = async () => {
            while (next < items.length) {
                const item = items[next++];
                await worker(item);
                onProgress(++done);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function fileName(url) {
        const last = url.split(/[?#]/)[0].split('/').pop() || url;
        try { return decodeURIComponent(last); } catch (e) { return last; }
    }

    // Every node built with createElement, every address set as a property:
    // links and headings in this report are contributor-written content.
    function renderReport(out, refs, status, pages) {
        out.textContent = '';
        const files = [...new Set(refs.map(r => r.url))];
        const bad = refs.filter(r => status.get(r.url) !== 'ok');
        const missingFiles = new Set(bad.filter(r => status.get(r.url) === 'missing').map(r => r.url));
        const unknownFiles = new Set(bad.filter(r => status.get(r.url) === 'unknown').map(r => r.url));

        const byPage = new Map();
        bad.forEach(r => {
            if (!byPage.has(r.pageId)) byPage.set(r.pageId, []);
            byPage.get(r.pageId).push(r);
        });

        const missingPages = new Set(bad.filter(r => missingFiles.has(r.url)).map(r => r.pageId)).size;
        const summary = el('p', 'media-report-summary',
            `${refs.length} media links to ${files.length} files checked. `
            + (missingFiles.size
                ? `${missingFiles.size} ${missingFiles.size === 1 ? 'file loads' : 'files load'} nothing, on ${missingPages} ${missingPages === 1 ? 'page' : 'pages'}.`
                : (unknownFiles.size ? 'None are missing.' : 'Every one of them loads.')));
        out.appendChild(summary);
        if (unknownFiles.size) {
            out.appendChild(el('p', 'media-report-note',
                `${unknownFiles.size} did not answer in time and are marked "not checked". Run it again to retry them.`));
        }

        [...byPage.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .forEach(([pageId, list]) => {
                const page = pages.get(pageId);
                const block = el('div', 'media-report-page');
                const head = el('div', 'media-report-page-head');
                const title = page && page.url ? el('a', 'media-report-page-name') : el('span', 'media-report-page-name');
                title.textContent = (page && page.name) || pageId;
                if (page && page.url) { title.href = page.url; title.target = '_blank'; title.rel = 'noopener'; }
                head.appendChild(title);
                head.appendChild(el('span', 'media-report-count', `${list.length}`));
                block.appendChild(head);

                const ul = el('ul', 'media-report-list');
                list.forEach(r => {
                    const li = el('li', 'media-report-item');
                    li.appendChild(el('span', 'media-report-where', r.where || '(top of the page)'));
                    const abs = absolute(r.url);
                    const file = abs && /^https?:/i.test(abs) ? el('a', 'media-report-file') : el('span', 'media-report-file');
                    file.textContent = fileName(r.url);
                    file.title = r.url;
                    if (file.tagName === 'A') { file.href = abs; file.target = '_blank'; file.rel = 'noopener'; }
                    li.appendChild(file);
                    li.appendChild(el('span', `media-report-state is-${status.get(r.url)}`,
                        status.get(r.url) === 'unknown' ? 'not checked' : 'missing'));
                    ul.appendChild(li);
                });
                block.appendChild(ul);
                out.appendChild(block);
            });
    }

    async function runMediaReport() {
        const btn = document.getElementById('btn-media-report');
        const out = document.getElementById('media-report-results');
        if (!btn || !out || !window.supabaseClient) return;

        btn.disabled = true;
        out.textContent = 'Reading every page…';
        try {
            const [{ data: rows, error }, { data: pageRows }] = await Promise.all([
                window.supabaseClient.from('page_data').select('page_id, desc_data, frame_data'),
                window.supabaseClient.from('site_pages').select('page_id, name, url'),
            ]);
            if (error) { out.textContent = `Could not read the pages: ${error.message}`; return; }

            const refs = [];
            (rows || []).forEach(r => {
                collectRefs(r.page_id, r.desc_data, refs);
                collectRefs(r.page_id, r.frame_data, refs);
            });
            const pages = new Map((pageRows || []).map(p => [p.page_id, p]));

            const files = [...new Set(refs.map(r => r.url))];
            const status = new Map();
            out.textContent = `Checking ${files.length} files…`;
            await runPool(files, async (url) => { status.set(url, await checkFile(url)); },
                (done) => { out.textContent = `Checked ${done} of ${files.length} files…`; });

            renderReport(out, refs, status, pages);
        } catch (e) {
            out.textContent = `The check stopped: ${e && e.message ? e.message : e}`;
        } finally {
            btn.disabled = false;
        }
    }

    // Exposed for the test, which drives the walk without a network.
    window.mediaReportInternals = { isMediaLink, collectRefs };

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('btn-media-report');
        if (btn) btn.addEventListener('click', runMediaReport);
    });
})();
