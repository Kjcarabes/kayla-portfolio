/**
 * KAYLA'S PORTFOLIO - Main JavaScript
 *
 * This file handles:
 * - Site-wide settings (social links, email)
 * - Loading artwork from works.json
 * - Mobile navigation
 * - Lightbox for viewing images
 * - Dynamic year in footer
 */

// Set current year in footer
document.querySelectorAll('#year').forEach(el => {
    el.textContent = new Date().getFullYear();
});

// 🍑
if (new URLSearchParams(window.location.search).get('ass') === 'phat') {
    document.body.style.cursor = 'url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22><text y=%2224%22 font-size=%2224%22>🍑</text></svg>") 16 16, auto';
}

// ===========================================
// NEWSLETTER POPUP
// ===========================================

async function initNewsletter() {
    if (localStorage.getItem('newsletter_subscribed')) return;

    const settings = await getSiteSettings();
    if (!settings.newsletter?.enabled) return;

    const nl = settings.newsletter;

    const dismissed = localStorage.getItem('newsletter_dismissed');
    if (dismissed) {
        const daysSince = (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
        if (daysSince < (nl.showAfterDays || 7)) return;
    }

    try {

        // Create popup HTML
        const popup = document.createElement('div');
        popup.className = 'newsletter-popup';
        popup.id = 'newsletter-popup';
        popup.innerHTML = `
            <button class="newsletter-popup-close" aria-label="Close">&times;</button>
            <h3>${nl.heading}</h3>
            <p>${nl.message}</p>
            <form class="newsletter-form" action="${nl.formAction}" method="POST">
                <input type="email" name="email" placeholder="${nl.placeholder}" required>
                <button type="submit">${nl.buttonText}</button>
            </form>
        `;

        document.body.appendChild(popup);

        // Show popup after 3 seconds
        setTimeout(() => popup.classList.add('active'), 3000);

        // Close button
        popup.querySelector('.newsletter-popup-close').addEventListener('click', () => {
            popup.classList.remove('active');
            localStorage.setItem('newsletter_dismissed', Date.now().toString());
        });

        // Form submission
        popup.querySelector('.newsletter-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const email = form.querySelector('input[type="email"]').value;
            const submitBtn = form.querySelector('button');
            submitBtn.textContent = '...';
            submitBtn.disabled = true;

            try {
                // Google Apps Script requires specific handling
                const formData = new FormData();
                formData.append('email', email);
                formData.append('timestamp', new Date().toISOString());

                await fetch(nl.formAction, {
                    method: 'POST',
                    mode: 'no-cors', // Required for Google Apps Script
                    body: formData
                });

                // Show success (no-cors means we can't read response, but assume success)
                popup.innerHTML = `
                    <button class="newsletter-popup-close" aria-label="Close">&times;</button>
                    <p class="newsletter-success">${nl.successMessage}</p>
                `;
                popup.querySelector('.newsletter-popup-close').addEventListener('click', () => {
                    popup.classList.remove('active');
                });

                localStorage.setItem('newsletter_subscribed', 'true');

                // Auto-close after 3 seconds
                setTimeout(() => popup.classList.remove('active'), 3000);

            } catch (error) {
                console.error('Newsletter signup error:', error);
                submitBtn.textContent = nl.buttonText;
                submitBtn.disabled = false;
            }
        });

    } catch (error) {
        console.error('Error loading newsletter settings:', error);
    }
}

// ===========================================
// INQUIRY MODAL (originals)
// ===========================================

function initInquiryModal() {
    const modal = document.createElement('div');
    modal.className = 'inquiry-modal';
    modal.id = 'inquiry-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'inquiry-modal-title');
    modal.innerHTML = `
        <div class="inquiry-modal-backdrop" data-inquiry-close></div>
        <div class="inquiry-modal-content">
            <h3 id="inquiry-modal-title">Interested in an original?</h3>
            <p class="inquiry-modal-lede">Leave your info and Kayla will be in touch.</p>
            <p class="inquiry-modal-artwork" data-inquiry-artwork></p>
            <form class="inquiry-form" novalidate>
                <label><span class="inquiry-form-label">Name *</span>
                    <input type="text" name="name" required autocomplete="name">
                </label>
                <label><span class="inquiry-form-label">Email</span>
                    <input type="email" name="email" autocomplete="email">
                </label>
                <label><span class="inquiry-form-label">Phone</span>
                    <input type="tel" name="phone" autocomplete="tel">
                </label>
                <fieldset class="inquiry-form-preference">
                    <legend>Preferred contact</legend>
                    <label><input type="radio" name="contactPreference" value="email" checked> Email</label>
                    <label><input type="radio" name="contactPreference" value="phone"> Phone</label>
                </fieldset>
                <label><span class="inquiry-form-label">Message (optional)</span>
                    <textarea name="message" rows="3"></textarea>
                </label>
                <p class="inquiry-form-error" data-inquiry-error hidden></p>
                <button type="submit" class="inquiry-form-submit">Send</button>
            </form>
            <div class="inquiry-modal-success" hidden>
                <p>Thanks — your message is on its way. Kayla will reply soon.</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector('.inquiry-form');
    const errorEl = modal.querySelector('[data-inquiry-error]');
    const artworkEl = modal.querySelector('[data-inquiry-artwork]');
    const successEl = modal.querySelector('.inquiry-modal-success');

    // Open
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-inquire]');
        if (!trigger) return;
        e.preventDefault();
        openInquiryModal(trigger.dataset.productTitle || '', trigger.dataset.productId || '');
    });

    // Close
    modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-inquiry-close]')) closeInquiryModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeInquiryModal();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;

        const fd = new FormData(form);
        const name = (fd.get('name') || '').toString().trim();
        const email = (fd.get('email') || '').toString().trim();
        const phone = (fd.get('phone') || '').toString().trim();

        if (!name) { showError('Please enter your name.'); return; }
        if (!email && !phone) { showError('Please leave an email or phone so Kayla can reply.'); return; }

        const settings = await getSiteSettings();
        const endpoint = settings.inquiryFormAction;
        if (!endpoint) { showError('This form isn’t configured yet. Please try again later.'); return; }

        fd.append('productTitle', form.dataset.productTitle || '');
        fd.append('productId', form.dataset.productId || '');
        fd.append('timestamp', new Date().toISOString());

        const submitBtn = form.querySelector('.inquiry-form-submit');
        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Sending…';

        try {
            await fetch(endpoint, { method: 'POST', mode: 'no-cors', body: fd });
            form.hidden = true;
            successEl.hidden = false;
            setTimeout(closeInquiryModal, 2500);
        } catch (err) {
            console.error('Inquiry submit failed:', err);
            showError('Something went wrong. Please try again or email kjcarabes@gmail.com.');
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
    }

    function openInquiryModal(productTitle, productId) {
        form.reset();
        form.hidden = false;
        successEl.hidden = true;
        errorEl.hidden = true;
        form.dataset.productTitle = productTitle;
        form.dataset.productId = productId;
        artworkEl.textContent = productTitle ? `About: ${productTitle}` : '';
        artworkEl.hidden = !productTitle;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 50);
    }

    function closeInquiryModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ===========================================
// SITE-WIDE SETTINGS
// ===========================================

let siteSettingsPromise = null;

// Shared, cached fetch — inquiry modal and other features reuse this.
function getSiteSettings() {
    if (!siteSettingsPromise) {
        siteSettingsPromise = fetch('content/site-settings.json')
            .then(r => r.json())
            .catch(err => {
                console.error('Error loading site settings:', err);
                siteSettingsPromise = null;
                return {};
            });
    }
    return siteSettingsPromise;
}

async function loadSiteSettings() {
    const settings = await getSiteSettings();
    if (settings) applySiteSettings(settings);
}

// About page: render bio + exhibitions from content/about.json (the HTML holds a
// no-JS/SEO fallback that this replaces).
async function initAbout() {
    const bioEl = document.getElementById('about-bio');
    const exEl = document.getElementById('exhibitions-list');
    if (!bioEl && !exEl) return;
    let data;
    try {
        data = await (await fetch('content/about.json')).json();
    } catch (err) {
        console.error('Error loading about content:', err);
        return;
    }
    if (bioEl && data.bio) bioEl.textContent = data.bio;
    if (exEl && Array.isArray(data.exhibitions)) {
        exEl.innerHTML = '';
        data.exhibitions.forEach(x => {
            const li = document.createElement('li');
            const t = document.createElement('span'); t.className = 'exhibition-title'; t.textContent = x.title || '';
            const d = document.createElement('span'); d.className = 'exhibition-details'; d.textContent = x.details || '';
            li.append(t, d);
            exEl.appendChild(li);
        });
    }
}

// Keep the JSON-LD Person node (structured data for search/AI engines) in sync
// with the editable social links + email, so changing them in one place updates
// the SEO metadata too. Runs on every page; no-ops if there's no Person node.
function syncPersonJsonLd(settings) {
    const urls = (settings.socialLinks || []).map(s => s.url).filter(Boolean);
    // Treat www/non-www and http/https as the same profile so we don't duplicate.
    const norm = (u) => String(u).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
    document.querySelectorAll('script[type="application/ld+json"]').forEach(tag => {
        let data;
        try { data = JSON.parse(tag.textContent); } catch { return; }
        const nodes = data['@graph'] || [data];
        let changed = false;
        nodes.forEach(node => {
            if (!node || node['@type'] !== 'Person') return;
            const existing = Array.isArray(node.sameAs) ? node.sameAs : [];
            const seen = new Set(existing.map(norm));
            const additions = urls.filter(u => !seen.has(norm(u)));
            if (additions.length) { node.sameAs = [...existing, ...additions]; changed = true; }
            if (settings.email && node.email !== `mailto:${settings.email}`) { node.email = `mailto:${settings.email}`; changed = true; }
        });
        if (changed) tag.textContent = JSON.stringify(data);
    });
}

// Apply settings to the page
function applySiteSettings(settings) {
    syncPersonJsonLd(settings);

    // Update all footer social links
    document.querySelectorAll('.social-links').forEach(container => {
        container.innerHTML = '';

        // Add social links from settings
        settings.socialLinks.forEach(social => {
            const link = document.createElement('a');
            link.href = social.url;
            link.textContent = social.name;
            link.target = '_blank';
            link.rel = 'noopener';
            container.appendChild(link);
        });

        // Add email link
        if (settings.email) {
            const emailLink = document.createElement('a');
            emailLink.href = `mailto:${settings.email}`;
            emailLink.textContent = 'Email';
            container.appendChild(emailLink);
        }
    });

    // Update contact page email if it exists
    const contactEmail = document.querySelector('.contact-email');
    if (contactEmail && settings.email) {
        contactEmail.href = `mailto:${settings.email}`;
        contactEmail.textContent = settings.email;
    }

    // Update contact page social links if they exist
    const contactSocial = document.querySelector('.contact-social');
    if (contactSocial) {
        contactSocial.innerHTML = '';
        settings.socialLinks.forEach(social => {
            const link = document.createElement('a');
            link.href = social.url;
            link.textContent = social.name;
            link.target = '_blank';
            link.rel = 'noopener';
            contactSocial.appendChild(link);
        });
    }
}

// Mobile navigation toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle) {
    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });
}

// Load and display works from JSON
async function loadWorks() {
    try {
        const response = await fetch('content/works.json');
        const data = await response.json();
        return data.works;
    } catch (error) {
        console.error('Error loading works:', error);
        return [];
    }
}

// Build the <picture> markup for an image whose path lives under assets/images/.
// `widths` is the list of optimized WebP variants written by scripts/optimize-images.js.
// If widths is missing (e.g. the optimizer hasn't been re-run after a new image was added),
// we fall back to a plain <img> — slower but the site still works.
function pictureMarkup({ image, widths, aspectRatio, alt = '', sizes, lazy = true, fetchPriority }) {
    const altAttr = `alt="${escapeAttr(alt)}"`;
    const loadAttrs = lazy ? 'loading="lazy" decoding="async"' : 'decoding="async"';
    const priorityAttr = fetchPriority ? `fetchpriority="${fetchPriority}"` : '';
    const styleAttr = aspectRatio ? `style="aspect-ratio:${aspectRatio}"` : '';
    const m = image && image.match(/^(?:\.\/)?assets\/images\/(.+)\.[^.]+$/);
    if (!m || !Array.isArray(widths) || widths.length === 0) {
        return `<img src="${escapeAttr(image || '')}" ${altAttr} ${loadAttrs} ${priorityAttr} ${styleAttr}>`;
    }
    const baseRel = m[1];
    const srcset = widths.map(w => `assets/images/optimized/${baseRel}-${w}.webp ${w}w`).join(', ');
    const sizesAttr = sizes ? `sizes="${sizes}"` : '';
    return `<picture>
        <source type="image/webp" srcset="${srcset}" ${sizesAttr}>
        <img src="${escapeAttr(image)}" ${altAttr} ${loadAttrs} ${priorityAttr} ${styleAttr}>
    </picture>`;
}

// Create a work item element
function createWorkItem(work) {
    const link = document.createElement('a');
    link.className = 'work-item';
    link.href = `work-detail.html?id=${work.id}`;
    link.dataset.category = work.category;
    if (work.aspectRatio) link.dataset.aspectRatio = work.aspectRatio;

    const sizes = '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 600px';
    link.innerHTML = `
        ${pictureMarkup({ image: work.image, widths: work.widths, aspectRatio: work.aspectRatio, alt: work.title, sizes })}
        <div class="work-item-overlay">
            <h3 class="work-item-title">${work.title}</h3>
            <span class="work-item-year">${workDisplayYear(work)}</span>
        </div>
    `;

    return link;
}

// Hero slideshow functionality
async function initHeroSlideshow() {
    const slideshow = document.getElementById('hero-slideshow');
    if (!slideshow) return;

    const works = await loadWorks();
    const heroWorks = works.filter(w => w.heroFeature);

    if (heroWorks.length === 0) return;

    // Create all slide images. First slide is the LCP — load it eagerly.
    heroWorks.forEach((work, index) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide' + (index === 0 ? ' active' : '');
        slide.innerHTML = pictureMarkup({
            image: work.image,
            widths: work.widths,
            aspectRatio: work.aspectRatio,
            alt: work.title,
            sizes: '100vw',
            lazy: index !== 0,
            fetchPriority: index === 0 ? 'high' : undefined,
        });

        const img = slide.querySelector('img');
        if (img.complete) {
            slide.classList.add('loaded');
        } else {
            img.addEventListener('load', () => slide.classList.add('loaded'), { once: true });
        }

        slideshow.appendChild(slide);
    });

    // If only one slide, no need for navigation
    if (heroWorks.length === 1) return;

    let currentIndex = 0;
    const slides = slideshow.querySelectorAll('.hero-slide');
    let autoAdvance;

    const goToSlide = (newIndex) => {
        slides[currentIndex].classList.remove('active');

        currentIndex = newIndex;
        if (currentIndex < 0) currentIndex = heroWorks.length - 1;
        if (currentIndex >= heroWorks.length) currentIndex = 0;

        slides[currentIndex].classList.add('active');
    };

    const resetAutoAdvance = () => {
        clearInterval(autoAdvance);
        autoAdvance = setInterval(() => goToSlide(currentIndex + 1), 5000);
    };

    // Click on left/right side to navigate
    slideshow.addEventListener('click', (e) => {
        const rect = slideshow.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const halfWidth = rect.width / 2;

        if (clickX < halfWidth) {
            goToSlide(currentIndex - 1);
        } else {
            goToSlide(currentIndex + 1);
        }
        resetAutoAdvance();
    });

    // Start auto-advance
    autoAdvance = setInterval(() => goToSlide(currentIndex + 1), 5000);
}

// Populate featured works on homepage
async function populateFeaturedWorks() {
    const container = document.getElementById('featured-work');
    if (!container) return;

    const works = await loadWorks();
    const featured = works.filter(w => w.featured);

    container.innerHTML = '';
    featured.forEach(work => {
        container.appendChild(createWorkItem(work));
    });

    // The featured-work container *is* a .work-grid, so it gets the same
    // justified-rows treatment as the year grids on the work page.
    await applyJustifiedLayout([container]);
}

// Populate all works on work page, grouped by year
async function populateAllWorks() {
    const container = document.getElementById('all-work');
    if (!container) return;

    const works = await loadWorks();

    // Group works by year
    const worksByYear = {};
    works.forEach(work => {
        const year = workDisplayYear(work) || 'Other';
        if (!worksByYear[year]) {
            worksByYear[year] = [];
        }
        worksByYear[year].push(work);
    });

    // Sort years descending (newest first)
    const sortedYears = Object.keys(worksByYear).sort((a, b) => b - a);

    // Within a year: works with a full date sort newest-first; works without keep their JSON order
    // and fall to the bottom of the year as a group.
    sortedYears.forEach(year => {
        worksByYear[year] = worksByYear[year]
            .map((work, i) => ({ work, i, fullMs: workFullDateMs(work) }))
            .sort((a, b) => {
                if (a.fullMs !== null && b.fullMs !== null) return b.fullMs - a.fullMs;
                if (a.fullMs !== null) return -1;
                if (b.fullMs !== null) return 1;
                return a.i - b.i;
            })
            .map(x => x.work);
    });

    container.innerHTML = '';

    // Create sections for each year
    sortedYears.forEach(year => {
        const yearSection = document.createElement('div');
        yearSection.className = 'work-year-section';

        const yearHeading = document.createElement('h2');
        yearHeading.className = 'work-year-heading';
        yearHeading.textContent = year;
        yearSection.appendChild(yearHeading);

        const yearGrid = document.createElement('div');
        yearGrid.className = 'work-grid';

        worksByYear[year].forEach(work => {
            yearGrid.appendChild(createWorkItem(work));
        });

        yearSection.appendChild(yearGrid);
        container.appendChild(yearSection);
    });

    await applyJustifiedLayout(Array.from(container.querySelectorAll('.work-grid')));
}

// Wait for image dimensions, run the justified-rows layout, then fade the
// grids in. Hooks a debounced resize listener so rows reflow when the
// viewport changes. Used by both the work page (year sections) and the home
// page featured grid.
async function applyJustifiedLayout(grids) {
    if (grids.length === 0) return;

    // If every item carries a precomputed aspect ratio (set by the optimizer pipeline
    // and surfaced as data-aspect-ratio in createWorkItem), we can lay out immediately
    // without forcing any image to download. That lets loading="lazy" actually work.
    // If even one item is missing it (a freshly added work that hasn't been through
    // the optimizer yet), fall back to awaiting natural dimensions for accuracy.
    const allItems = grids.flatMap(g => Array.from(g.querySelectorAll('.work-item')));
    const needImageWait = allItems.some(item => !item.dataset.aspectRatio);

    if (needImageWait) {
        const allImgs = grids.flatMap(g => Array.from(g.querySelectorAll('.work-item img')));
        await Promise.all(allImgs.map(img =>
            img.decode ? img.decode().catch(() => {}) :
            new Promise(res => {
                if (img.complete) return res();
                img.addEventListener('load', res, { once: true });
                img.addEventListener('error', res, { once: true });
            })
        ));
    }

    const relayout = () => grids.forEach(g => {
        layoutJustifiedRows(g);
        g.classList.add('laid-out');
    });
    relayout();

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(relayout, 120);
    });
}

// Justified-rows layout: every row has a uniform height; widths within the
// row scale to each image's natural aspect ratio. Mirrors the museum-style
// hang you see on Flickr / Google Photos / most fine-art portfolio sites.
function layoutJustifiedRows(grid) {
    const items = Array.from(grid.querySelectorAll('.work-item'));
    if (items.length === 0) return;

    const containerWidth = grid.clientWidth;
    if (containerWidth === 0) return;

    const gap = parseFloat(getComputedStyle(grid).gap) || 16;

    // Target row height tuned per viewport. On narrow screens we set the
    // target high enough that each image typically fills its own row,
    // which gives a clean single-column read on phones.
    const vw = window.innerWidth;
    let targetHeight;
    if (vw < 600)        targetHeight = Math.min(containerWidth, 520);
    else if (vw < 1024)  targetHeight = 280;
    else if (vw < 1600)  targetHeight = 340;
    else                 targetHeight = 400;

    let row = [];
    let ratioSum = 0;

    const flushRow = (stretchToFit) => {
        if (row.length === 0) return;
        const totalGap = gap * (row.length - 1);
        let height;
        if (stretchToFit) {
            height = (containerWidth - totalGap) / ratioSum;
        } else {
            // Last/incomplete row: keep target height, but never let the row
            // overflow the container — a single very wide image at the target
            // height would otherwise blow out the viewport on mobile.
            const idealWidth = ratioSum * targetHeight + totalGap;
            height = idealWidth > containerWidth
                ? (containerWidth - totalGap) / ratioSum
                : targetHeight;
        }
        row.forEach(({ item, ratio }) => {
            item.style.width = (ratio * height) + 'px';
            item.style.height = height + 'px';
        });
        row = [];
        ratioSum = 0;
    };

    items.forEach((item) => {
        // Prefer precomputed aspect ratio (no image load needed). Fall back to the
        // natural dimensions for items added without running the optimizer.
        let ratio = parseFloat(item.dataset.aspectRatio);
        if (!ratio) {
            const img = item.querySelector('img');
            ratio = (img && img.naturalWidth && img.naturalHeight)
                ? img.naturalWidth / img.naturalHeight
                : 1;
        }

        // Does adding this item overflow the row?
        const gapsWith = gap * row.length;       // n items → n gaps after adding = (row.length+1)-1
        const idealWithThis = (ratioSum + ratio) * targetHeight + gapsWith;

        if (idealWithThis >= containerWidth && row.length > 0) {
            // Two options: stretch down to include this item, or flush now (stretch up)
            // and let this item start the next row. Pick whichever ends up closer
            // to the target height — prevents one very wide image from squashing
            // an otherwise-fine row into a thin strip.
            const gapsWithout = gap * (row.length - 1);
            const heightWith = (containerWidth - gapsWith) / (ratioSum + ratio);
            const heightWithout = (containerWidth - gapsWithout) / ratioSum;
            const distWith = Math.abs(heightWith - targetHeight);
            const distWithout = Math.abs(heightWithout - targetHeight);

            if (distWithout <= distWith) {
                flushRow(true);                         // close row without this item
                row.push({ item, ratio });              // start a new row with it
                ratioSum += ratio;
            } else {
                row.push({ item, ratio });
                ratioSum += ratio;
                flushRow(true);                         // include and stretch down
            }
        } else {
            row.push({ item, ratio });
            ratioSum += ratio;
        }
    });

    flushRow(false); // last (incomplete) row keeps the target height instead of stretching
}

// Lightbox functionality
function openLightbox(src, alt) {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    const img = lightbox.querySelector('img');
    img.src = src;
    img.alt = alt;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

// Lightbox event listeners
const lightbox = document.getElementById('lightbox');
if (lightbox) {
    lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });
}

// ===========================================
// SHOP FUNCTIONALITY
// ===========================================

// Load products from JSON
async function loadProducts() {
    try {
        const response = await fetch('content/products.json');
        const data = await response.json();
        return data.products;
    } catch (error) {
        console.error('Error loading products:', error);
        return [];
    }
}

// Escape values we interpolate into HTML attributes.
function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const isOriginal = (product) => (product.category || '').toLowerCase() === 'originals';

// Every work is implicitly an available original unless `originalStatus` says otherwise.
// "available" (default) | "sold" | "nfs" (not for sale — Kayla still owns it; shown as
// "Original unavailable — Not for sale" so galleries know it's not available to buy).
function worksAsOriginals(works) {
    return works.map(w => ({
        id: `original:${w.id}`,
        title: w.title,
        category: 'Originals',
        price: 0,
        image: w.image,
        aspectRatio: w.aspectRatio,
        widths: w.widths,
        description: '', // shop cards don't display work descriptions
        sold: w.originalStatus === 'sold',
        nfs: w.originalStatus === 'nfs',
        workId: w.id,
    }));
}

// Works accept either `date` (full ISO or just a year) or the legacy `year` field.
// Display always renders just the year portion.
function workDisplayYear(work) {
    const v = work.date || work.year;
    if (!v) return '';
    const match = String(v).match(/\d{4}/);
    return match ? match[0] : String(v);
}

// Returns a timestamp when the date has more granularity than just a year,
// or null for year-only / missing values.
function workFullDateMs(work) {
    const v = work.date || work.year;
    if (!v) return null;
    const s = String(v);
    if (/^\d{4}$/.test(s)) return null;
    const t = new Date(s).getTime();
    return isNaN(t) ? null : t;
}

function inquireButtonHtml(product, variant) {
    const cls = variant === 'work-detail' ? 'work-detail-buy-btn' : 'product-card-btn inquire';
    return `<button type="button" class="${cls}" data-inquire data-product-title="${escapeAttr(product.title)}" data-product-id="${escapeAttr(product.id)}">Contact me</button>`;
}

// Create a product card element.
// If `attachedOriginal` is passed, the card is a print that shares a workId with an original —
// the original is rendered inline as a status note instead of getting its own card.
function createProductCard(product, works = [], attachedOriginal = null) {
    const article = document.createElement('article');
    article.className = 'product-card';

    article.dataset.categories = product.category;
    article.dataset.category = product.category;
    if (isOriginal(product) && product.sold) article.classList.add('original-sold');

    let buttonHtml = '';
    let statusHtml = '';
    if (isOriginal(product)) {
        if (product.nfs) {
            statusHtml = '<p class="product-card-status">Original unavailable — Not for sale</p>';
            buttonHtml = '<span class="product-card-btn sold">Not for sale</span>';
        } else if (product.sold) {
            statusHtml = '<p class="product-card-status">Original unavailable — Sold!</p>';
            buttonHtml = '<span class="product-card-btn sold">Sold!</span>';
        } else {
            statusHtml = '<p class="product-card-status">Original available</p>';
            buttonHtml = inquireButtonHtml(product);
        }
    } else if (product.sold) {
        const soldLabel = product.category === 'Prints' ? 'Print sold out' : 'Sold out';
        buttonHtml = `<span class="product-card-btn sold">${soldLabel}</span>`;
    } else if (product.stripeLink) {
        if (typeof product.stockRemaining === 'number' && product.stockRemaining > 0 && product.stockRemaining <= 10) {
            statusHtml = `<p class="product-card-status">Only ${product.stockRemaining} left</p>`;
        }
        buttonHtml = `<a href="${product.stripeLink}" target="_blank" rel="noopener" class="product-card-btn">Buy Now</a>`;
    } else {
        buttonHtml = '<span class="product-card-btn coming-soon">Coming Soon</span>';
    }

    // Attached original (on a print card): show status + Contact-me below the print's own CTA.
    let attachedOriginalHtml = '';
    if (attachedOriginal) {
        if (attachedOriginal.nfs) {
            attachedOriginalHtml = `
                <div class="product-card-original sold">
                    <p class="product-card-status">Original unavailable — Not for sale</p>
                    <span class="product-card-btn sold">Not for sale</span>
                </div>
            `;
        } else if (attachedOriginal.sold) {
            attachedOriginalHtml = `
                <div class="product-card-original sold">
                    <p class="product-card-status">Original unavailable — Sold!</p>
                    <span class="product-card-btn sold">Sold!</span>
                </div>
            `;
        } else {
            attachedOriginalHtml = `
                <div class="product-card-original">
                    <p class="product-card-status">Original available</p>
                    ${inquireButtonHtml(attachedOriginal)}
                </div>
            `;
        }
    }

    // Shop cards show the product's own description only — no fallback to the linked work's.
    // When sold out, the button itself carries the label (e.g. "Print sold out"), so the
    // redundant blurb above it is suppressed.
    const description = product.sold ? '' : (product.description || '');
    const linkedWork = product.workId ? works.find(w => w.id === product.workId) : null;

    // Get medium from linked work
    const medium = linkedWork?.medium || '';

    // Show "View artwork" link if product is linked to a work
    const viewArtworkHtml = linkedWork
        ? `<a href="work-detail.html?id=${product.workId}" class="product-card-link">View artwork</a>`
        : '';

    const cardImageMarkup = pictureMarkup({
        image: product.image,
        widths: product.widths,
        aspectRatio: product.aspectRatio,
        alt: product.title,
        sizes: '(max-width: 768px) 100vw, 320px',
    });
    article.innerHTML = `
        <div class="product-card-image">
            ${cardImageMarkup}
            <span class="product-card-badge">${product.category}</span>
        </div>
        <div class="product-card-info">
            <div class="product-card-top">
                <h3 class="product-card-title">${product.title}</h3>
                ${medium ? `<p class="product-card-medium">${medium}</p>` : ''}
            </div>
            <div class="product-card-actions">
                ${isOriginal(product) || (product.price <= 0 && !description) ? '' : `
                    <div class="product-card-price-row">
                        ${product.price > 0 ? `<span class="product-card-price">$${product.price}</span>` : ''}
                        ${description ? `<span class="product-card-description">${description}</span>` : ''}
                    </div>
                `}
                ${statusHtml}
                ${buttonHtml}
                ${attachedOriginalHtml}
                ${viewArtworkHtml}
            </div>
        </div>
    `;

    return article;
}

// Populate shop page
async function populateShop() {
    const container = document.getElementById('product-grid');
    if (!container) return;

    // Load products and works in parallel (works needed for description fallback)
    const [products, works] = await Promise.all([
        loadProducts(),
        loadWorks()
    ]);

    // Originals are synthesized from works.json (default: available). Stripe "Originals" products
    // are ignored here so there's one source of truth for original availability.
    const nonOriginalProducts = products.filter(p => !isOriginal(p));
    const syntheticOriginals = worksAsOriginals(works);
    const originalsByWorkId = new Map(syntheticOriginals.map(o => [o.workId, o]));

    // A work has a sibling product if there's a print/craft with the same workId.
    const workIdsWithPrintSibling = new Set();
    for (const p of nonOriginalProducts) {
        if (p.workId && originalsByWorkId.has(p.workId)) workIdsWithPrintSibling.add(p.workId);
    }

    // Available prints/crafts first, sold-out last (stable, so relative order is otherwise preserved).
    const isPurchasable = (p) => !p.sold && !!p.stripeLink;
    const orderedNonOriginal = [...nonOriginalProducts].sort(
        (a, b) => (isPurchasable(b) ? 1 : 0) - (isPurchasable(a) ? 1 : 0)
    );

    const displayItems = [];
    for (const p of orderedNonOriginal) {
        const attached = p.workId ? originalsByWorkId.get(p.workId) : null;
        displayItems.push({ product: p, attachedOriginal: attached || null, originalsTabOnly: false });
    }
    for (const o of syntheticOriginals) {
        const hasSibling = workIdsWithPrintSibling.has(o.workId);
        displayItems.push({ product: o, attachedOriginal: null, originalsTabOnly: hasSibling });
    }

    container.innerHTML = '';
    container.classList.add('filter-all'); // initial state — matches the active "All" filter button
    displayItems.forEach(({ product, attachedOriginal, originalsTabOnly }) => {
        const card = createProductCard(product, works, attachedOriginal);
        if (originalsTabOnly) card.classList.add('originals-tab-only');
        container.appendChild(card);
    });

    setupShopFilters();
}

// Setup shop category filters
function setupShopFilters() {
    const filtersContainer = document.getElementById('shop-filters');
    if (!filtersContainer) return;

    const grid = document.getElementById('product-grid');

    filtersContainer.addEventListener('click', (e) => {
        if (!e.target.classList.contains('shop-filter-btn')) return;

        filtersContainer.querySelectorAll('.shop-filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');

        const filter = e.target.dataset.filter;
        grid?.classList.toggle('filter-originals', filter === 'Originals');
        grid?.classList.toggle('filter-all', filter === 'all');
        grid?.classList.toggle('filter-prints', filter === 'Prints');

        document.querySelectorAll('.product-card').forEach(item => {
            const cats = (item.dataset.categories || item.dataset.category || '').split(/\s+/);
            const originalsTabOnly = item.classList.contains('originals-tab-only');
            let show;
            if (filter === 'all') {
                show = !originalsTabOnly;
            } else {
                show = cats.includes(filter);
            }
            item.classList.toggle('hidden', !show);
        });
    });
}

// ===========================================
// BLOG PAGE
// ===========================================

// Load blog posts from JSON
async function loadBlogPosts() {
    try {
        const response = await fetch('content/blog.json');
        const data = await response.json();
        return data.posts;
    } catch (error) {
        console.error('Error loading blog posts:', error);
        return [];
    }
}

// Format date for display
function formatBlogDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Create a blog post element
function createBlogPost(post) {
    const article = document.createElement('article');
    article.className = 'blog-post';

    // Support both single image (string) and multiple images (array)
    const images = Array.isArray(post.images) ? post.images : [post.image];
    const hasMultipleImages = images.length > 1;

    const imagesHtml = images.map((img, index) => `
        <div class="blog-post-image">
            <img src="${img}" alt="${post.title || 'Blog image'}" loading="lazy">
        </div>
    `).join('');

    article.innerHTML = `
        <div class="blog-post-images${hasMultipleImages ? ' scattered' : ''}">
            ${imagesHtml}
        </div>
        <div class="blog-post-content">
            <p class="blog-post-date">${formatBlogDate(post.date)}</p>
            ${post.title ? `<h2 class="blog-post-title">${post.title}</h2>` : ''}
            <p class="blog-post-text">${post.content}</p>
        </div>
    `;

    // Add click to zoom on images
    article.querySelectorAll('.blog-post-image').forEach((imgContainer, index) => {
        imgContainer.addEventListener('click', () => {
            openLightbox(images[index], post.title || 'Blog image');
        });
    });

    return article;
}

// Populate blog page
async function populateBlog() {
    const container = document.getElementById('blog-grid');
    if (!container) return;

    const posts = await loadBlogPosts();

    container.innerHTML = '';
    posts.forEach(post => {
        container.appendChild(createBlogPost(post));
    });

    // Setup image fade-in for blog posts
    container.querySelectorAll('.blog-post-image img').forEach(img => {
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => img.classList.add('loaded'));
        }
    });
}

// ===========================================
// WORK DETAIL PAGE
// ===========================================

// Get URL parameter
function getUrlParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

const SITE_ORIGIN = 'https://www.kaylacarabes.com';

// Create-or-update a <meta> tag by attribute (name= or property=).
function setMetaTag(attr, key, content) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
}

function setCanonical(url) {
    let el = document.getElementById('canonical-link') || document.head.querySelector('link[rel="canonical"]');
    if (!el) {
        el = document.createElement('link');
        el.rel = 'canonical';
        document.head.appendChild(el);
    }
    el.href = url;
}

function injectJsonLd(id, obj) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.id = id;
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(obj);
}

// Per-artwork SEO/social meta + structured data. The work-detail page is a
// query-param URL whose body is rendered client-side, so without this an engine
// only ever sees the generic default head. Engines that render JS (Googlebot)
// pick this up; the static work.html ItemList + sitemap cover no-JS crawlers.
function applyWorkDetailSeo(work, products = []) {
    const url = `${SITE_ORIGIN}/work-detail.html?id=${encodeURIComponent(work.id)}`;
    const year = workDisplayYear(work);
    const absImg = work.image && work.image.startsWith('http')
        ? work.image
        : `${SITE_ORIGIN}/${String(work.image || '').replace(/^\//, '')}`;
    // Social scrapers cap image size (X ~5MB) and originals can be larger, so prefer a
    // small optimized WebP variant for og:image/twitter:image. Fall back to the original.
    const widths = Array.isArray(work.widths) ? work.widths : [];
    const optMatch = String(work.image || '').match(/^(?:\.\/)?assets\/images\/(.+)\.[^.]+$/);
    let socialImg = absImg;
    if (optMatch && widths.length) {
        const w = widths.includes(1200) ? 1200 : (widths.filter(x => x <= 1600).pop() || widths[0]);
        socialImg = `${SITE_ORIGIN}/assets/images/optimized/${optMatch[1]}-${w}.webp`;
    }
    const mediumBits = [work.medium, work.size].filter(Boolean).join(', ');
    const description = (work.description && work.description.trim())
        ? `${work.description.trim()} — ${work.title} by Kayla Carabes${year ? `, ${year}` : ''}.`
        : `${work.title}${year ? ` (${year})` : ''}${mediumBits ? `, ${mediumBits}` : ''} — original artwork by Kayla Carabes.`;
    const social = `${work.title} — Kayla Carabes`;

    document.title = `${work.title}${year ? ` (${year})` : ''} | Kayla Carabes`;
    setMetaTag('name', 'description', description);
    setCanonical(url);
    setMetaTag('property', 'og:type', 'article');
    setMetaTag('property', 'og:title', social);
    setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:image', socialImg);
    setMetaTag('property', 'og:url', url);
    setMetaTag('name', 'twitter:title', social);
    setMetaTag('name', 'twitter:description', description);
    setMetaTag('name', 'twitter:image', socialImg);

    const artwork = {
        '@context': 'https://schema.org',
        '@type': 'VisualArtwork',
        name: work.title,
        url,
        image: absImg,
        creator: { '@type': 'Person', name: 'Kayla Carabes', url: `${SITE_ORIGIN}/` },
        artform: work.category === 'Paintings' ? 'Painting' : (work.category || 'Artwork'),
    };
    if (work.medium) artwork.artMedium = work.medium;
    if (work.size) artwork.width = work.size;
    if (year) artwork.dateCreated = year;
    const livePrint = products.find(p => p.workId === work.id && !p.sold && p.stripeLink && p.price > 0);
    if (livePrint) {
        artwork.offers = {
            '@type': 'Offer',
            price: String(livePrint.price),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            url: livePrint.stripeLink,
        };
    }
    injectJsonLd('work-detail-jsonld', artwork);
}

// Load and display work detail
async function loadWorkDetail() {
    const container = document.getElementById('work-detail');
    if (!container) return;

    const workId = getUrlParam('id');
    if (!workId) {
        container.innerHTML = '<p>Work not found.</p>';
        return;
    }

    // Load works and products in parallel
    const [works, products] = await Promise.all([
        loadWorks(),
        loadProducts()
    ]);

    // Find the work
    const work = works.find(w => w.id === workId);
    if (!work) {
        container.innerHTML = '<p>Work not found.</p>';
        return;
    }

    // Per-artwork title, social meta, canonical, and VisualArtwork JSON-LD.
    applyWorkDetailSeo(work, products);

    // Prints/crafts from Stripe — only show when available (and never Stripe originals, those are
    // driven from works.json now). The synthesized original is always prepended — including "nfs",
    // shown as "Not for sale" so galleries know Kayla still owns the piece.
    const printsAndCrafts = products.filter(p => p.workId === workId && !isOriginal(p) && !p.sold);
    const syntheticOriginal = worksAsOriginals([work])[0];
    const linkedProducts = [syntheticOriginal, ...printsAndCrafts];

    let shopHtml = '';
    if (linkedProducts.length > 0) {
        shopHtml = `
            <div class="work-detail-shop">
                ${linkedProducts.map(product => {
                    const original = isOriginal(product);
                    let actionHtml;
                    if (original && product.nfs) {
                        actionHtml = '<span class="work-detail-buy-btn sold">Not for sale</span>';
                    } else if (original && product.sold) {
                        actionHtml = '<span class="work-detail-buy-btn sold">Sold</span>';
                    } else if (original) {
                        actionHtml = inquireButtonHtml(product, 'work-detail');
                    } else {
                        actionHtml = `<a href="${product.stripeLink}" target="_blank" rel="noopener" class="work-detail-buy-btn">Buy</a>`;
                    }
                    let titleText;
                    if (original) {
                        if (product.nfs) titleText = 'Original — Not for sale';
                        else if (product.sold) titleText = 'Original — Sold';
                        else titleText = 'Original available';
                    } else {
                        titleText = product.description || product.title;
                    }
                    const subText = original ? '' : `$${product.price}`;
                    return `
                    <div class="work-detail-shop-item">
                        <div class="work-detail-shop-item-info">
                            <span class="work-detail-shop-item-title">${titleText}</span>
                            ${subText ? `<span class="work-detail-shop-item-price">${subText}</span>` : ''}
                        </div>
                        ${actionHtml}
                    </div>
                `}).join('')}
            </div>
        `;
    }

    // Support a `detail_images` array (first image is the main). Falls back to single `image`.
    const imagesList = (Array.isArray(work.detail_images) && work.detail_images.length > 0)
        ? work.detail_images
        : [work.image].filter(Boolean);

    const thumbsHtml = imagesList.length > 1 ? `
        <div class="work-detail-thumbs">
            ${imagesList.map((src, i) => `
                <button type="button" class="work-detail-thumb${i === 0 ? ' active' : ''}" data-src="${escapeAttr(src)}" aria-label="View image ${i + 1}">
                    <img src="${escapeAttr(src)}" alt="" loading="lazy">
                </button>
            `).join('')}
        </div>
    ` : '';

    container.innerHTML = `
        <div class="work-detail-gallery">
            <div class="work-detail-image">
                <img src="${escapeAttr(imagesList[0] || '')}" alt="${work.title}" id="detail-image">
            </div>
            ${thumbsHtml}
        </div>
        <div class="work-detail-info">
            <h1>${work.title}</h1>
            <p class="work-detail-meta">${workDisplayYear(work)}${work.category ? ` · ${work.category}` : ''}</p>
            ${work.description ? `<p class="work-detail-description">${work.description}</p>` : ''}
            ${work.medium || work.size ? `<p class="work-detail-medium">${[work.medium, work.size].filter(Boolean).join(' | ')}</p>` : ''}
            ${shopHtml}
        </div>
    `;

    const detailImage = document.getElementById('detail-image');
    if (detailImage) {
        detailImage.addEventListener('click', () => {
            openLightbox(detailImage.src, work.title);
        });
    }

    // Thumbnail click → swap main image
    container.querySelectorAll('.work-detail-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            const src = thumb.dataset.src;
            if (!src || !detailImage) return;
            detailImage.src = src;
            detailImage.classList.remove('loaded');
            container.querySelectorAll('.work-detail-thumb').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        });
    });
}

// Fade in images when loaded
function setupImageFadeIn() {
    const handleImage = (img) => {
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => img.classList.add('loaded'));
        }
    };

    // Handle existing images
    document.querySelectorAll('.work-item img, .product-card-image img').forEach(handleImage);

    // Watch for dynamically added images
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    node.querySelectorAll?.('.work-item img, .product-card-image img').forEach(handleImage);
                    if (node.matches?.('.work-item img, .product-card-image img')) {
                        handleImage(node);
                    }
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize based on current page
// Card / link-in-bio page (/card): render the tappable link buttons from
// content/card.json so links can be edited without touching HTML. Root-relative
// fetch because this page lives in a /card/ subdirectory, unlike the root pages.
async function initCardPage() {
    const list = document.getElementById('card-links-list');
    if (!list) return;

    let data = {};
    try {
        const res = await fetch('/content/card.json');
        data = await res.json();
    } catch (err) {
        console.error('Error loading card content:', err);
    }

    // Profile — override the HTML defaults (which stay as the no-JS/SEO fallback)
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    const setSrc = (id, val) => { const el = document.getElementById(id); if (el && val) el.src = val; };
    setText('card-name', data.name);
    setText('card-tagline', data.tagline);
    setText('card-location', data.location);
    setSrc('card-photo', data.photo);
    setSrc('card-banner-img', data.featured);
    setSrc('card-banner-logo', data.logo);
    const photoEl = document.getElementById('card-photo');
    if (photoEl && data.name) photoEl.alt = data.name;

    const links = (Array.isArray(data.links) && data.links.length)
        ? data.links
        : [{ label: 'Visit the full website', url: '/' }];

    list.innerHTML = '';
    links.forEach(link => {
        const a = document.createElement('a');
        a.className = 'card-link';
        a.href = link.url;
        a.textContent = link.label;
        if (link.external) {
            a.target = '_blank';
            a.rel = 'noopener';
        }
        list.appendChild(a);
    });
}

// Card page mailing-list signup — a button that opens a popup with the email
// field. Same flow as the site (Google Apps Script formAction, FormData +
// no-cors POST, success message + localStorage flag).
async function initCardNewsletter() {
    const openBtn = document.getElementById('card-newsletter-open');
    if (!openBtn) return;
    if (localStorage.getItem('newsletter_subscribed')) return;

    let nl;
    try {
        const res = await fetch('/content/site-settings.json');
        nl = (await res.json()).newsletter;
    } catch (err) {
        console.error('Error loading newsletter settings:', err);
        return;
    }
    if (!nl || !nl.enabled || !nl.formAction) return;

    openBtn.hidden = false;
    openBtn.addEventListener('click', () => openCardNewsletterModal(nl));
}

function openCardNewsletterModal(nl) {
    const backdrop = document.createElement('div');
    backdrop.className = 'card-modal-backdrop';
    backdrop.innerHTML = `
        <div class="card-modal" role="dialog" aria-modal="true">
            <button class="card-modal-close" aria-label="Close">&times;</button>
            <h3>${nl.heading || 'Stay in the loop'}</h3>
            <p>${nl.message || ''}</p>
            <form class="card-modal-form">
                <input type="email" name="email" placeholder="${nl.placeholder || 'your@email.com'}" required autocomplete="email" aria-label="Email address">
                <button type="submit" class="card-link card-link--primary">${nl.buttonText || 'Subscribe'}</button>
            </form>
        </div>`;
    document.body.appendChild(backdrop);

    const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('.card-modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    const input = backdrop.querySelector('input[type="email"]');
    input.focus();

    backdrop.querySelector('.card-modal-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = backdrop.querySelector('button[type="submit"]');
        const original = btn.textContent;
        btn.textContent = '...';
        btn.disabled = true;
        try {
            const fd = new FormData();
            fd.append('email', input.value);
            fd.append('timestamp', new Date().toISOString());
            await fetch(nl.formAction, { method: 'POST', mode: 'no-cors', body: fd });
            localStorage.setItem('newsletter_subscribed', 'true');
            const modal = backdrop.querySelector('.card-modal');
            modal.innerHTML = `<button class="card-modal-close" aria-label="Close">&times;</button><p style="margin-top:1rem">${nl.successMessage || 'Thanks for subscribing!'}</p>`;
            modal.querySelector('.card-modal-close').addEventListener('click', close);
            const openBtn = document.getElementById('card-newsletter-open');
            if (openBtn) openBtn.hidden = true;
            setTimeout(close, 2500);
        } catch (error) {
            console.error('Newsletter signup error:', error);
            btn.textContent = original;
            btn.disabled = false;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    initAbout();
    initCardPage();
    initCardNewsletter();
    initHeroSlideshow();
    populateFeaturedWorks();
    populateAllWorks();
    populateShop();
    populateBlog();
    loadWorkDetail();
    setupImageFadeIn();
    initInquiryModal();
    initNewsletter();
});
