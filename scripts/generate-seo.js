/**
 * SEO / AEO generator.
 *
 * The site renders its galleries, shop and blog client-side from JSON, so the
 * raw HTML a non-JS crawler (Googlebot's no-JS pass, and most AI answer-engine
 * bots like GPTBot / ClaudeBot / PerplexityBot) fetches is otherwise empty.
 *
 * This script writes the *data-derived* SEO into the repo, exactly like
 * optimize-images.js injects the HERO-PRELOAD tag — the site stays plain static
 * HTML with no runtime build step. It:
 *   1. Generates sitemap.xml (home + sections + every work-detail URL).
 *   2. Injects per-page JSON-LD (ItemList / Product / Blog) between
 *      <!-- SEO-JSONLD:START/END --> markers in the <head>.
 *   3. Injects a hidden-but-crawlable content fallback (the works list, shop
 *      inventory, blog posts) between <!-- SEO-CONTENT:START/END --> markers,
 *      inside the same containers main.js hydrates — so the JS wipes it on load
 *      and sighted users never see it, while crawlers read real content.
 *
 * Hand-written SEO (titles, meta descriptions, Open Graph, the stable
 * Person/WebSite/page graph) lives directly in each HTML file. This script only
 * owns what's derived from the JSON sources. Missing markers are skipped with a
 * warning, never an error — the site is never left broken.
 *
 * Run: `npm run generate-seo` (also runs in CI on content changes).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = 'https://www.kaylacarabes.com';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const works = (readJson('content/works.json').works || []).filter(Boolean);
const products = (() => {
    try { return readJson('content/products.json').products || []; }
    catch { return []; }
})();
const posts = (() => {
    try { return readJson('content/blog.json').posts || []; }
    catch { return []; }
})();

// --- helpers ---------------------------------------------------------------

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Year shown to users; mirrors workDisplayYear() in main.js.
function displayYear(work) {
    const v = work.date || work.year;
    if (!v) return '';
    const m = String(v).match(/\d{4}/);
    return m ? m[0] : String(v);
}

// A W3C sitemap lastmod only when we have a real calendar date (not year-only).
function fullDate(work) {
    const v = work.date || work.year;
    if (!v) return null;
    const s = String(v);
    if (/^\d{4}$/.test(s)) return null;
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

const abs = (rel) => rel.startsWith('http') ? rel : `${BASE}/${String(rel).replace(/^\//, '')}`;

// Serialize JSON-LD safely for inlining in <script> (escape '<' to avoid </script> breakouts).
function jsonLd(obj) {
    return JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
}

// Replace content between a START/END marker pair. Warns (never throws) when absent.
// Greedy (matches to the LAST END marker) so a previously-corrupted block with a
// stray marker is healed rather than nested. A function replacer is used so '$'
// sequences in the generated content (e.g. "$20") are never treated as
// String.replace backreferences.
function injectBetween(html, label, replacement, file) {
    const re = new RegExp(`(<!-- ${label}:START -->)[\\s\\S]*(<!-- ${label}:END -->)`);
    if (!re.test(html)) {
        process.stdout.write(`! ${file}: no ${label} markers; skipping.\n`);
        return html;
    }
    return html.replace(re, (_m, start, end) => `${start}\n${replacement}\n    ${end}`);
}

function writeIfChanged(relPath, next) {
    const full = path.join(ROOT, relPath);
    let prev = null;
    try { prev = fs.readFileSync(full, 'utf8'); } catch {}
    if (prev === next) { process.stdout.write(`= ${relPath} (unchanged)\n`); return; }
    fs.writeFileSync(full, next);
    process.stdout.write(`✓ ${relPath}\n`);
}

// Works in the same order/grouping the work page renders: newest year first.
function worksByYearDesc() {
    const byYear = {};
    for (const w of works) {
        const y = displayYear(w) || 'Other';
        (byYear[y] = byYear[y] || []).push(w);
    }
    return Object.keys(byYear)
        .sort((a, b) => Number(b) - Number(a))
        .map((y) => [y, byYear[y]]);
}

const PERSON_REF = { '@type': 'Person', name: 'Kayla Carabes', url: `${BASE}/` };
const workUrl = (w) => `${BASE}/work-detail.html?id=${encodeURIComponent(w.id)}`;

// --- 1. sitemap.xml --------------------------------------------------------

function buildSitemap() {
    const today = new Date().toISOString().slice(0, 10);
    const newestWork = works
        .map(fullDate)
        .filter(Boolean)
        .sort()
        .pop();

    const urls = [
        { loc: `${BASE}/`, changefreq: 'weekly', priority: '1.0', lastmod: newestWork || today },
        { loc: `${BASE}/work.html`, changefreq: 'weekly', priority: '0.9', lastmod: newestWork || today },
        { loc: `${BASE}/shop.html`, changefreq: 'weekly', priority: '0.9' },
        { loc: `${BASE}/about.html`, changefreq: 'monthly', priority: '0.7' },
        { loc: `${BASE}/blog.html`, changefreq: 'weekly', priority: '0.6' },
        { loc: `${BASE}/contact.html`, changefreq: 'yearly', priority: '0.5' },
    ];

    for (const w of works) {
        urls.push({ loc: workUrl(w), changefreq: 'monthly', priority: '0.8', lastmod: fullDate(w) });
    }

    const body = urls.map((u) => {
        const parts = [`    <loc>${escapeHtml(u.loc)}</loc>`];
        if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
        if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
        if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
        return `  <url>\n${parts.join('\n')}\n  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// --- 2. JSON-LD blocks -----------------------------------------------------

function scriptTag(obj) {
    return `    <script type="application/ld+json">\n${jsonLd(obj)}\n    </script>`;
}

function workArtworkNode(w, position) {
    const node = {
        '@type': 'VisualArtwork',
        position,
        name: w.title,
        url: workUrl(w),
        image: abs(w.image),
        creator: PERSON_REF,
        artform: w.category === 'Paintings' ? 'Painting' : (w.category || 'Artwork'),
    };
    if (w.medium) node.artMedium = w.medium;
    const y = displayYear(w);
    if (y) node.dateCreated = y;
    return node;
}

// Same ordering as populateFeaturedWorks in main.js, so crawlers see the grid
// in the order visitors do.
function featuredWorks() {
    return works.filter((w) => w.featured)
        .sort((a, b) => (a.featuredOrder ?? 1e9) - (b.featuredOrder ?? 1e9));
}

function homeJsonLd() {
    const featured = featuredWorks();
    return scriptTag({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Selected Work by Kayla Carabes',
        itemListElement: featured.map((w, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: workUrl(w),
            item: workArtworkNode(w, i + 1),
        })),
    });
}

function workJsonLd() {
    return scriptTag({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Artworks by Kayla Carabes',
        numberOfItems: works.length,
        itemListElement: works.map((w, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: workUrl(w),
            item: workArtworkNode(w, i + 1),
        })),
    });
}

// Shop offers: prints/crafts with a real price + live payment link.
function shopJsonLd() {
    const buyable = products.filter((p) => !p.sold && p.stripeLink && p.price > 0);
    return scriptTag({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Shop — Original Paintings, Prints & Crafts by Kayla Carabes',
        itemListElement: buyable.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
                '@type': 'Product',
                name: p.description && p.description !== 'Print' ? `${p.title} — ${p.description}` : p.title,
                image: abs(p.image),
                category: p.category,
                brand: PERSON_REF,
                offers: {
                    '@type': 'Offer',
                    price: String(p.price),
                    priceCurrency: 'USD',
                    availability: 'https://schema.org/InStock',
                    url: p.stripeLink,
                    seller: PERSON_REF,
                },
            },
        })),
    });
}

function blogJsonLd() {
    return scriptTag({
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Studio Notes — Kayla Carabes',
        url: `${BASE}/blog.html`,
        blogPost: posts.map((post) => {
            const imgs = Array.isArray(post.images) ? post.images : [post.image].filter(Boolean);
            const node = {
                '@type': 'BlogPosting',
                headline: post.title || `Studio note — ${post.date}`,
                datePublished: post.date,
                articleBody: post.content,
                author: PERSON_REF,
                publisher: PERSON_REF,
                mainEntityOfPage: `${BASE}/blog.html`,
            };
            if (imgs.length) node.image = imgs.map(abs);
            return node;
        }),
    });
}

// --- 3. Hidden-but-crawlable content fallbacks -----------------------------

const FALLBACK_OPEN = '    <div class="seo-fallback visually-hidden" aria-hidden="true" data-seo-fallback>';
const FALLBACK_CLOSE = '    </div>';

function wrapFallback(inner) {
    return `${FALLBACK_OPEN}\n${inner}\n${FALLBACK_CLOSE}`;
}

function workLine(w) {
    const bits = [displayYear(w), w.medium, w.size].filter(Boolean).join(', ');
    return `        <li><a href="work-detail.html?id=${escapeHtml(w.id)}">${escapeHtml(w.title)}</a>${bits ? ` — ${escapeHtml(bits)}` : ''}</li>`;
}

function homeFallback() {
    const featured = featuredWorks();
    const lis = featured.map(workLine).join('\n');
    return wrapFallback(
        `        <h2>Selected work by Kayla Carabes</h2>\n        <ul>\n${lis}\n        </ul>`
    );
}

function workFallback() {
    const sections = worksByYearDesc().map(([year, list]) => {
        const lis = list.map(workLine).join('\n');
        return `        <section>\n          <h2>${escapeHtml(year)}</h2>\n          <ul>\n${lis}\n          </ul>\n        </section>`;
    }).join('\n');
    return wrapFallback(`        <h2>Artworks by Kayla Carabes</h2>\n${sections}`);
}

function shopFallback() {
    const lines = [];
    for (const p of products) {
        if (p.sold || !p.stripeLink || !(p.price > 0)) continue;
        const label = p.description && p.description !== 'Print' ? `${p.title} (${p.description})` : `${p.title} print`;
        lines.push(`        <li>${escapeHtml(label)} — $${escapeHtml(p.price)} — <a href="${escapeHtml(p.stripeLink)}" rel="nofollow">Buy print</a></li>`);
    }
    for (const w of works) {
        const status = w.originalStatus === 'sold' ? 'sold'
            : w.originalStatus === 'nfs' ? 'not for sale'
            : 'available — inquire to purchase';
        lines.push(`        <li>${escapeHtml(w.title)} — original ${escapeHtml(w.medium || 'painting')} — ${escapeHtml(status)} — <a href="work-detail.html?id=${escapeHtml(w.id)}">View artwork</a></li>`);
    }
    return wrapFallback(
        `        <h2>Shop original paintings, prints &amp; crafts by Kayla Carabes</h2>\n        <ul>\n${lines.join('\n')}\n        </ul>`
    );
}

function blogFallback() {
    const arts = posts.map((post) => {
        const heading = post.title || `Studio note — ${post.date}`;
        return `        <article>\n          <h2>${escapeHtml(heading)}</h2>\n          <time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>\n          <p>${escapeHtml(post.content)}</p>\n        </article>`;
    }).join('\n');
    return wrapFallback(`        <h2>Studio notes by Kayla Carabes</h2>\n${arts}`);
}

// --- run -------------------------------------------------------------------

function processPage(file, jsonLdBlock, fallbackBlock) {
    let html = read(file);
    if (jsonLdBlock) html = injectBetween(html, 'SEO-JSONLD', jsonLdBlock, file);
    if (fallbackBlock) html = injectBetween(html, 'SEO-CONTENT', fallbackBlock, file);
    writeIfChanged(file, html);
}

function main() {
    writeIfChanged('sitemap.xml', buildSitemap());
    processPage('index.html', homeJsonLd(), homeFallback());
    processPage('work.html', workJsonLd(), workFallback());
    processPage('shop.html', shopJsonLd(), shopFallback());
    processPage('blog.html', blogJsonLd(), blogFallback());
    process.stdout.write('SEO generation complete.\n');
}

main();
