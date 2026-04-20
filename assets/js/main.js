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
            <button type="button" class="inquiry-modal-close" aria-label="Close" data-inquiry-close>&times;</button>
            <h3 id="inquiry-modal-title">Interested in an original?</h3>
            <p class="inquiry-modal-lede">Leave your info and Kayla will be in touch.</p>
            <p class="inquiry-modal-artwork" data-inquiry-artwork></p>
            <form class="inquiry-form" novalidate>
                <label>Name<span aria-hidden="true">*</span>
                    <input type="text" name="name" required autocomplete="name">
                </label>
                <label>Email
                    <input type="email" name="email" autocomplete="email">
                </label>
                <label>Phone
                    <input type="tel" name="phone" autocomplete="tel">
                </label>
                <fieldset class="inquiry-form-preference">
                    <legend>Preferred contact</legend>
                    <label><input type="radio" name="contactPreference" value="email" checked> Email</label>
                    <label><input type="radio" name="contactPreference" value="phone"> Phone</label>
                </fieldset>
                <label>Message (optional)
                    <textarea name="message" rows="3"></textarea>
                </label>
                <p class="inquiry-form-error" data-inquiry-error hidden></p>
                <button type="submit" class="inquiry-form-submit">Send</button>
            </form>
            <div class="inquiry-modal-success" hidden>
                <p>Thanks — your message is on its way. Kayla will reply soon.</p>
                <button type="button" class="inquiry-form-submit" data-inquiry-close>Close</button>
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

// Apply settings to the page
function applySiteSettings(settings) {
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

// Create a work item element
function createWorkItem(work) {
    const link = document.createElement('a');
    link.className = 'work-item';
    link.href = `work-detail.html?id=${work.id}`;
    link.dataset.category = work.category;

    link.innerHTML = `
        <img src="${work.image}" alt="${work.title}" loading="lazy">
        <div class="work-item-overlay">
            <h3 class="work-item-title">${work.title}</h3>
            <span class="work-item-year">${work.year}</span>
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

    // Create all slide images
    heroWorks.forEach((work, index) => {
        const img = document.createElement('img');
        img.src = work.image;
        img.alt = work.title;
        img.className = 'hero-slide' + (index === 0 ? ' active' : '');

        // Fade in when loaded
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => img.classList.add('loaded'));
        }

        slideshow.appendChild(img);
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
}

// Populate all works on work page, grouped by year
async function populateAllWorks() {
    const container = document.getElementById('all-work');
    if (!container) return;

    const works = await loadWorks();

    // Group works by year
    const worksByYear = {};
    works.forEach(work => {
        const year = work.year || 'Other';
        if (!worksByYear[year]) {
            worksByYear[year] = [];
        }
        worksByYear[year].push(work);
    });

    // Sort years descending (newest first)
    const sortedYears = Object.keys(worksByYear).sort((a, b) => b - a);

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

function inquireButtonHtml(product, variant) {
    const cls = variant === 'work-detail' ? 'work-detail-buy-btn' : 'product-card-btn inquire';
    return `<button type="button" class="${cls}" data-inquire data-product-title="${escapeAttr(product.title)}" data-product-id="${escapeAttr(product.id)}">Contact me</button>`;
}

// Create a product card element
function createProductCard(product, works = []) {
    const article = document.createElement('article');
    article.className = 'product-card';
    article.dataset.category = product.category;

    let buttonHtml;
    if (isOriginal(product)) {
        buttonHtml = product.sold
            ? '<span class="product-card-btn sold">Original — Sold</span>'
            : inquireButtonHtml(product);
    } else if (product.sold) {
        buttonHtml = '<span class="product-card-btn sold">Sold</span>';
    } else if (product.stripeLink) {
        buttonHtml = `<a href="${product.stripeLink}" target="_blank" rel="noopener" class="product-card-btn">Buy Now</a>`;
    } else {
        buttonHtml = '<span class="product-card-btn coming-soon">Coming Soon</span>';
    }

    const statusHtml = isOriginal(product) && !product.sold
        ? '<p class="product-card-status">Original available</p>'
        : '';

    // Use product description, or fall back to linked work's description
    let description = product.description;
    let linkedWork = null;
    if (product.workId) {
        linkedWork = works.find(w => w.id === product.workId);
        if (linkedWork && !description) {
            description = linkedWork.description;
        }
    }

    // Get medium from linked work
    const medium = linkedWork?.medium || '';

    // Show "View artwork" link if product is linked to a work
    const viewArtworkHtml = linkedWork
        ? `<a href="work-detail.html?id=${product.workId}" class="product-card-link">View artwork</a>`
        : '';

    article.innerHTML = `
        <div class="product-card-image">
            <img src="${product.image}" alt="${product.title}" loading="lazy">
            <span class="product-card-badge">${product.category}</span>
        </div>
        <div class="product-card-info">
            <h3 class="product-card-title">${product.title}</h3>
            ${description ? `<p class="product-card-description">${description}</p>` : ''}
            ${medium ? `<p class="product-card-medium">${medium}</p>` : ''}
            <p class="product-card-price">$${product.price}</p>
            ${statusHtml}
            ${buttonHtml}
            ${viewArtworkHtml}
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

    container.innerHTML = '';
    products.forEach(product => {
        container.appendChild(createProductCard(product, works));
    });

    // Setup filter functionality
    setupShopFilters();
}

// Setup shop category filters
function setupShopFilters() {
    const filtersContainer = document.getElementById('shop-filters');
    if (!filtersContainer) return;

    filtersContainer.addEventListener('click', (e) => {
        if (!e.target.classList.contains('shop-filter-btn')) return;

        // Update active state
        filtersContainer.querySelectorAll('.shop-filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        e.target.classList.add('active');

        // Filter items
        const filter = e.target.dataset.filter;
        const items = document.querySelectorAll('.product-card');

        items.forEach(item => {
            if (filter === 'all' || item.dataset.category === filter) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
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

    // Update page title
    document.title = `${work.title} | Kayla Carabes`;

    // Prints/crafts: only show when available. Originals: always show (so "Sold" is visible too).
    const linkedProducts = products
        .filter(p => p.workId === workId && (isOriginal(p) || !p.sold))
        .sort((a, b) => Number(isOriginal(b)) - Number(isOriginal(a)));

    let shopHtml = '';
    if (linkedProducts.length > 0) {
        shopHtml = `
            <div class="work-detail-shop">
                <p class="work-detail-shop-title">Shop this piece</p>
                ${linkedProducts.map(product => {
                    const description = product.description || work.description || '';
                    const medium = work.medium || '';
                    const original = isOriginal(product);
                    let actionHtml;
                    if (original && product.sold) {
                        actionHtml = '<span class="work-detail-buy-btn sold">Sold</span>';
                    } else if (original) {
                        actionHtml = inquireButtonHtml(product, 'work-detail');
                    } else {
                        actionHtml = `<a href="${product.stripeLink}" target="_blank" rel="noopener" class="work-detail-buy-btn">Buy</a>`;
                    }
                    const priceHtml = original
                        ? `<span class="work-detail-shop-item-price">${product.sold ? 'Original — Sold' : 'Original available'}</span>`
                        : `<span class="work-detail-shop-item-price">$${product.price}</span>`;
                    return `
                    <div class="work-detail-shop-item">
                        <div class="work-detail-shop-item-info">
                            <span class="work-detail-shop-item-title">${product.title}</span>
                            ${description ? `<span class="work-detail-shop-item-desc">${description}</span>` : ''}
                            ${medium ? `<span class="work-detail-shop-item-medium">${medium}</span>` : ''}
                            ${priceHtml}
                        </div>
                        ${actionHtml}
                    </div>
                `}).join('')}
            </div>
        `;
    }

    // Render the detail page
    container.innerHTML = `
        <div class="work-detail-image">
            <img src="${work.image}" alt="${work.title}" id="detail-image">
        </div>
        <div class="work-detail-info">
            <h1>${work.title}</h1>
            <p class="work-detail-meta">${work.year}${work.category ? ` · ${work.category}` : ''}</p>
            ${work.description ? `<p class="work-detail-description">${work.description}</p>` : ''}
            ${work.medium || work.size ? `<p class="work-detail-medium">${[work.medium, work.size].filter(Boolean).join(' | ')}</p>` : ''}
            ${shopHtml}
        </div>
    `;

    // Add click to zoom on image (opens lightbox)
    const detailImage = document.getElementById('detail-image');
    if (detailImage) {
        detailImage.addEventListener('click', () => {
            openLightbox(work.image, work.title);
        });
    }
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
document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
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
