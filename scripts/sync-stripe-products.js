/**
 * Sync products to products.json — the JSON files are the source of truth.
 *
 * Kayla only ever edits code/JSON; this script does all the Stripe wiring.
 *
 *   - Prints      come from content/works.json     (per-work `printPrice`)
 *   - Crafts/merch come from content/shop-items.json (items not tied to a work)
 *   - Shipping    comes from content/shop-settings.json (countries + flat rates)
 *
 * Two phases per run:
 *
 *  1. RECONCILE  — for every purchasable JSON item with a price > 0 (and stock
 *     not 0), ensure a Stripe Product + Price + active Payment Link exists at
 *     that amount, with the configured shipping + an optional stock cap. Price 0
 *     / stock 0 / missing means "sold out": any active link is deactivated and a
 *     synthetic sold entry is emitted (Stripe can't make a $0 link).
 *
 *  2. GENERATE   — write products.json from the JSON-driven items above plus any
 *     *manual* Stripe products explicitly flagged `shop: true` (escape hatch).
 *     Private commission / invoice payment links (no flag) never appear.
 *
 * Originals are NOT handled here — they're driven entirely from works.json
 * (`originalStatus`) on the front-end. Stripe `category: Originals` is ignored.
 *
 * works.json print fields:  printPrice, printDescription, printStock, printOrder, noPrint
 * shop-items.json fields:   id, title, category, price, image, description, stock, order
 *
 * Needs STRIPE_SECRET_KEY — runs in CI or via `npm run sync-products`.
 */

const fs = require('fs');
const path = require('path');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CATEGORY_MAP = {
  'originals': 'Originals',
  'original':  'Originals',
  'prints':    'Prints',
  'print':     'Prints',
  'crafts':    'Crafts',
  'craft':     'Crafts',
};

const DEFAULT_PRINT_DESCRIPTION = 'Print';

// Public site origin — Stripe needs absolute, fetchable URLs for product images
// so the painting shows on the payment-link checkout page.
const SITE_URL = 'https://www.kaylacarabes.com';

// Absolute image URL(s) for a Stripe product. Prefer an optimized WebP variant
// when the optimizer has run (smaller, faster for Stripe to fetch); fall back to
// the original path otherwise. Returns [] for a missing image.
function stripeImageUrls(image, widths) {
  if (!image) return [];
  let rel = image.replace(/^\.\//, '');
  const m = rel.match(/^assets\/images\/(.+)\.[^.]+$/);
  if (m && Array.isArray(widths) && widths.length) {
    const capped = widths.filter(w => w <= 1600);
    const w = capped.length ? Math.max(...capped) : Math.max(...widths);
    rel = `assets/images/optimized/${m[1]}-${w}.webp`;
  }
  return [`${SITE_URL}/${rel}`];
}

// Shown on Stripe's checkout page when a buyer reaches a link that just hit its
// stock cap (Stripe auto-deactivates it before our next sync flips the card).
// Stripe only allows inactive_message on links that have `restrictions` set, so
// it's attached to stock-capped links only.
const INACTIVE_MESSAGE = 'Aw, this one just sold out! 💛 Check back soon for restocks and new work.';

// --- content loaders -------------------------------------------------------

function loadJson(relPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'));
  } catch (error) {
    console.log(`Could not load ${relPath} (${error.message}); using defaults`);
    return fallback;
  }
}

function loadWorks() {
  return loadJson('content/works.json', { works: [] }).works || [];
}

// `_example` items are inline documentation in the file — never synced.
function loadShopItems() {
  const items = loadJson('content/shop-items.json', { items: [] }).items || [];
  return items.filter(i => i && i.id && !i._example);
}

function loadShopSettings() {
  const s = loadJson('content/shop-settings.json', {});
  return {
    shippingCountries: Array.isArray(s.shippingCountries) ? s.shippingCountries : [],
    shippingRates: Array.isArray(s.shippingRates) ? s.shippingRates : [],
  };
}

// --- small helpers ---------------------------------------------------------

function readMetadata(md, ...keys) {
  if (!md) return undefined;
  for (const k of keys) if (md[k] !== undefined && md[k] !== '') return md[k];
  return undefined;
}

function normalizeCategory(rawCategory) {
  if (!rawCategory) return null;
  return CATEGORY_MAP[rawCategory.toLowerCase()] || null;
}

function dollarsToCents(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

// null = unlimited; integer >= 0 otherwise (0 = sold out).
function parseStock(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function intOr(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Manual products are opt-in: only surfaced when metadata `shop` is truthy.
function isShopFlagged(product) {
  const v = readMetadata(product.metadata, 'shop', 'Shop', 'showInShop');
  return v != null && ['true', 'yes', '1'].includes(String(v).toLowerCase());
}

function productIdOf(r) {
  return typeof r.product === 'string' ? r.product : r.product.id;
}

// --- Stripe loaders --------------------------------------------------------

async function listAllProducts() {
  const out = [];
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    out.push(product);
  }
  return out;
}

// Resolve every payment link (active + inactive) to its product + amount once.
//
// Inactive links are deliberately never deleted — Stripe can't delete them anyway,
// and each one still owns the completed Checkout Sessions bought through it, which
// is where sold counts come from. They only accumulate, so this MUST paginate: a
// single 100-item page would silently start hiding older links and the reconcile
// would mint duplicates for anything past the cut-off.
async function resolvePaymentLinks() {
  const links = [];
  let active = 0;
  for (const isActive of [true, false]) {
    for await (const link of stripe.paymentLinks.list({ active: isActive, limit: 100 })) {
      links.push(link);
      if (isActive) active++;
    }
  }
  console.log(`Found ${active} active and ${links.length - active} inactive payment links`);

  const resolved = [];
  for (const link of links) {
    try {
      const lineItems = await stripe.paymentLinks.listLineItems(link.id, { limit: 1 });
      if (lineItems.data.length === 0) continue;
      const price = await stripe.prices.retrieve(lineItems.data[0].price.id, { expand: ['product'] });
      resolved.push({ link, price, product: price.product, amount: price.unit_amount });
    } catch (error) {
      console.error(`Error resolving payment link ${link.id}:`, error.message);
    }
  }
  return resolved;
}

// Ensure each configured flat shipping rate exists in Stripe; return their ids.
async function ensureShippingRates(rates) {
  if (!rates.length) return [];
  const existing = (await stripe.shippingRates.list({ active: true, limit: 100 })).data;
  const ids = [];
  for (const r of rates) {
    const amount = Math.round(Number(r.amount) * 100);
    const match = existing.find(s =>
      s.display_name === r.label &&
      s.fixed_amount?.amount === amount &&
      s.fixed_amount?.currency === 'usd'
    );
    if (match) { ids.push(match.id); continue; }

    const params = {
      display_name: r.label,
      type: 'fixed_amount',
      fixed_amount: { amount, currency: 'usd' },
    };
    if (r.deliveryDaysMin && r.deliveryDaysMax) {
      params.delivery_estimate = {
        minimum: { unit: 'business_day', value: r.deliveryDaysMin },
        maximum: { unit: 'business_day', value: r.deliveryDaysMax },
      };
    }
    const created = await stripe.shippingRates.create(params);
    console.log(`Created shipping rate "${r.label}" ($${r.amount})`);
    ids.push(created.id);
  }
  return ids;
}

// --- reconcile -------------------------------------------------------------

function findProductByMeta(allProducts, matcher) {
  const candidates = allProducts.filter(p =>
    matcher(p) && normalizeCategory(readMetadata(p.metadata, 'category', 'Category', 'CATEGORY')) !== 'Originals'
  );
  return candidates.find(p =>
    normalizeCategory(readMetadata(p.metadata, 'category', 'Category', 'CATEGORY')) === 'Prints'
  ) || candidates[0] || null;
}

async function createProduct(spec) {
  const product = await stripe.products.create({
    name: spec.title,
    description: spec.description || undefined,
    images: spec.images?.length ? spec.images : undefined,
    metadata: spec.productMetadata,
  });
  console.log(`Created Stripe product for "${spec.title}"`);
  return product;
}

async function deactivate(links) {
  for (const l of links) {
    if (l.link.active) {
      await stripe.paymentLinks.update(l.link.id, { active: false });
      console.log(`Deactivated payment link ${l.link.id}`);
    }
  }
}

function linkStockLimit(link) {
  return link.restrictions?.completed_sessions?.limit ?? null;
}

// How many checkouts have completed for a link = units sold. `cap` lets us stop
// early once we know it's sold out (we only need the count up to the edition size).
async function countCompletedSessions(linkId, cap) {
  let count = 0;
  for await (const session of stripe.checkout.sessions.list({ payment_link: linkId, limit: 100 })) {
    if (session.status === 'complete') {
      count++;
      if (cap != null && count >= cap) break;
    }
  }
  return count;
}

// Units sold = completed checkouts across EVERY link this product has ever had,
// not just the current one. Stripe prices and links are immutable, so a price
// change (or clearing a stock cap) mints a fresh link — counting only that link
// would quietly reset a limited edition back to its full size.
async function countSoldForProduct(links, cap) {
  let sold = 0;
  for (const l of links) {
    sold += await countCompletedSessions(l.link.id, cap != null ? cap - sold : null);
    if (cap != null && sold >= cap) break;
  }
  return sold;
}

// Does an existing link already carry the shipping config we want now? If not
// (e.g. a link made manually or before shipping was set up, or referencing an
// outdated rate), we must NOT reuse it — otherwise it'd keep its stale/missing
// shipping forever. A mismatch falls through to create a fresh link below.
function linkShippingMatches(link, shippingRateIds, countries) {
  if (countries.length && !link.shipping_address_collection) return false;
  if (shippingRateIds.length) {
    const have = (link.shipping_options || []).map(o => o.shipping_rate).sort();
    const want = [...shippingRateIds].sort();
    if (have.length !== want.length || have.some((id, i) => id !== want[i])) return false;
  }
  return true;
}

// Stripe can't unset a payment link's `restrictions` once it's been set, so a link
// that carries a cap can never become unlimited. When the JSON now says unlimited
// (blank stock) we must reject that link and mint a fresh one — otherwise the old
// edition cap silently survives and keeps deactivating the link at the old number.
// A link whose cap merely *changed* is fine: that we can update in place.
function linkStockMatches(link, stock) {
  return stock != null ? true : linkStockLimit(link) == null;
}

// Ensure one active link at `cents` (with shipping + optional stock cap). Returns URL.
async function ensureActiveLink({ product, cents, stock, label, metadata, links, shippingRateIds, countries }) {
  const match = links.find(l =>
    l.amount === cents &&
    linkShippingMatches(l.link, shippingRateIds, countries) &&
    linkStockMatches(l.link, stock));
  if (match) {
    const updates = {};
    if (!match.link.active) updates.active = true;
    if (stock != null && stock > 0 && linkStockLimit(match.link) !== stock) {
      updates.restrictions = { completed_sessions: { limit: stock } };
      updates.inactive_message = INACTIVE_MESSAGE;
    }
    if (Object.keys(updates).length) {
      await stripe.paymentLinks.update(match.link.id, updates);
      console.log(`Updated payment link ${match.link.id} for "${label}"`);
    }
    await deactivate(links.filter(l => l !== match && l.amount !== cents));
    return match.link.url;
  }

  const price = await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: cents });
  const params = { line_items: [{ price: price.id, quantity: 1 }], metadata };
  if (countries.length) params.shipping_address_collection = { allowed_countries: countries };
  if (shippingRateIds.length) params.shipping_options = shippingRateIds.map(id => ({ shipping_rate: id }));
  if (stock != null && stock > 0) {
    params.restrictions = { completed_sessions: { limit: stock } };
    params.inactive_message = INACTIVE_MESSAGE;
  }

  const link = await stripe.paymentLinks.create(params);
  console.log(`Created $${cents / 100} payment link for "${label}"${stock != null ? ` (stock ${stock})` : ''}`);
  await deactivate(links);
  return link.url;
}

function buildEntry(spec, { id, sold, price, stripeLink, stockRemaining }) {
  const entry = {
    id,
    title: spec.title,
    category: spec.category,
    price,
    image: spec.image,
    description: spec.description || '',
    stripeLink: stripeLink || '',
    sold,
    _order: spec.order,
  };
  if (spec.workId) entry.workId = spec.workId;
  if (spec.featured) entry.featured = true;
  // Remaining units (edition cap minus completed Stripe checkouts). Omitted when
  // stock is unlimited. Refreshes at sync cadence, not per-pageview.
  if (stockRemaining != null) entry.stockRemaining = stockRemaining;
  return entry;
}

// Reconcile one purchasable spec (print or craft) and push its products.json entry.
async function reconcilePurchasable(spec, ctx) {
  const { allProducts, linksByProduct, ownedProductIds, products, shippingRateIds, countries } = ctx;
  const product = spec.findProduct(allProducts);
  const links = product ? (linksByProduct.get(product.id) || []) : [];

  // Pull live "units sold" from Stripe so inventory tracks itself as sales happen.
  let remaining = null;
  if (spec.priceCents > 0 && spec.stock != null && spec.stock > 0) {
    remaining = Math.max(0, spec.stock - await countSoldForProduct(links, spec.stock));
  }

  const explicitlySoldOut = spec.stock === 0;
  const outOfStock = remaining != null && remaining <= 0;
  const live = spec.priceCents > 0 && !explicitlySoldOut && !outOfStock;

  if (live) {
    const ensured = product || await createProduct(spec);
    ownedProductIds.add(ensured.id);
    // Keep an already-created product's image current (e.g. the painting changed).
    if (spec.images?.length && (ensured.images || []).join('|') !== spec.images.join('|')) {
      await stripe.products.update(ensured.id, { images: spec.images });
      console.log(`Updated images for "${spec.title}"`);
    }
    const url = await ensureActiveLink({
      product: ensured,
      cents: spec.priceCents,
      stock: spec.stock,
      label: spec.title,
      metadata: spec.linkMetadata,
      links: linksByProduct.get(ensured.id) || [],
      shippingRateIds,
      countries,
    });
    products.push(buildEntry(spec, {
      id: ensured.id, sold: false, price: spec.priceCents / 100, stripeLink: url, stockRemaining: remaining,
    }));
    console.log(`${spec.category}: "${spec.title}" — $${spec.priceCents / 100} [live]${remaining != null ? ` (${remaining} left)` : ''}`);
  } else {
    if (product) {
      ownedProductIds.add(product.id);
      await deactivate(linksByProduct.get(product.id) || []);
    }
    products.push(buildEntry(spec, {
      id: product ? product.id : spec.fallbackId,
      sold: true,
      price: spec.priceCents > 0 ? spec.priceCents / 100 : 0,
      stripeLink: '',
      stockRemaining: spec.stock != null ? 0 : null,
    }));
    console.log(`${spec.category}: "${spec.title}" — sold out`);
  }
}

function printSpec(work) {
  return {
    title: work.title,
    category: 'Prints',
    description: work.printDescription || DEFAULT_PRINT_DESCRIPTION,
    image: work.image,
    images: stripeImageUrls(work.image, work.widths),
    priceCents: dollarsToCents(work.printPrice),
    stock: parseStock(work.printStock),
    workId: work.id,
    order: intOr(work.printOrder, 0),
    fallbackId: `print:${work.id}`,
    productMetadata: { workId: work.id, category: 'Prints', source: 'works.json' },
    linkMetadata: { workId: work.id },
    findProduct: (all) => findProductByMeta(all, p =>
      readMetadata(p.metadata, 'workId', 'workid', 'WorkId', 'work_id') === work.id),
  };
}

function craftSpec(item) {
  const category = normalizeCategory(item.category) || 'Crafts';
  return {
    title: item.title,
    category,
    workId: item.workId || null,       // optional: link the item to a painting
    featured: !!item.featured,         // optional: show it in the site spotlight
    description: item.description || '',
    image: item.image || 'assets/images/placeholder.jpg',
    images: stripeImageUrls(item.image || 'assets/images/placeholder.jpg', item.widths),
    priceCents: dollarsToCents(item.price),
    stock: parseStock(item.stock),
    order: intOr(item.order, 0),
    fallbackId: `shop:${item.id}`,
    productMetadata: { shopItemId: item.id, category, source: 'shop-items.json' },
    linkMetadata: { shopItemId: item.id },
    findProduct: (all) => all.find(p =>
      readMetadata(p.metadata, 'shopItemId', 'shopitemid') === item.id) || null,
  };
}

// A manual (dashboard-created, shop:true) product, keyed off its payment link.
function manualEntry({ link, product, amount }, works) {
  const category = normalizeCategory(readMetadata(product.metadata, 'category', 'Category', 'CATEGORY')) || 'Prints';
  const order = intOr(readMetadata(product.metadata, 'order', 'Order'), 0);
  const workId = readMetadata(product.metadata, 'workId', 'workid', 'WorkId', 'work_id') || null;

  let image = product.images?.[0] || 'assets/images/placeholder.jpg';
  const linkedWork = workId ? works.find(w => w.id === workId) : null;
  if (linkedWork?.image) image = linkedWork.image;

  const entry = {
    id: product.id,
    title: product.name,
    category,
    price: amount != null ? amount / 100 : 0,
    image,
    description: product.description || '',
    stripeLink: link.url,
    sold: !link.active,
    _order: order,
  };
  if (workId) entry.workId = workId;
  return entry;
}

// --- main ------------------------------------------------------------------

async function syncProducts() {
  const works = loadWorks();
  const shopItems = loadShopItems();
  const settings = loadShopSettings();

  console.log('Loading Stripe products, payment links and shipping rates...');
  const [allProducts, resolved] = await Promise.all([listAllProducts(), resolvePaymentLinks()]);
  const shippingRateIds = await ensureShippingRates(settings.shippingRates);

  const linksByProduct = new Map();
  for (const r of resolved) {
    const pid = productIdOf(r);
    if (!linksByProduct.has(pid)) linksByProduct.set(pid, []);
    linksByProduct.get(pid).push(r);
  }

  const ctx = {
    allProducts,
    linksByProduct,
    ownedProductIds: new Set(), // JSON-driven products — skipped in the manual pass
    products: [],
    shippingRateIds,
    countries: settings.shippingCountries,
  };

  // Phase 1: prints (works.json) then crafts (shop-items.json)
  for (const work of works) {
    if (work.noPrint === true) continue;
    await reconcilePurchasable(printSpec(work), ctx);
  }
  for (const item of shopItems) {
    await reconcilePurchasable(craftSpec(item), ctx);
  }

  // Phase 2: manual crafts/merch — opt-in only (metadata shop: true), so private
  // commission/invoice payment links never leak into the shop.
  for (const r of resolved) {
    if (ctx.ownedProductIds.has(productIdOf(r))) continue;
    if (!r.product.active) continue;
    if (!isShopFlagged(r.product)) {
      console.log(`Skipping "${r.product.name}" - not flagged for the shop (set metadata shop: true)`);
      continue;
    }
    if (normalizeCategory(readMetadata(r.product.metadata, 'category', 'Category', 'CATEGORY')) === 'Originals') {
      continue;
    }
    const entry = manualEntry(r, works);
    ctx.products.push(entry);
    console.log(`Manual: ${r.product.name} (${entry.category})${r.link.active ? '' : ' [sold]'}`);
  }

  // Sort: lower _order first, then title.
  ctx.products.sort((a, b) => (a._order - b._order) || a.title.localeCompare(b.title));
  ctx.products.forEach(p => delete p._order);

  const output = {
    '_comment': '✏️ AUTO-GENERATED - Do not edit manually! Prints come from works.json; crafts from shop-items.json.',
    '_instructions': 'Set printPrice on a work, or add an item to shop-items.json. This file syncs automatically.',
    'products': ctx.products,
    '_lastSync': new Date().toISOString(),
  };

  fs.writeFileSync(path.join(__dirname, '..', 'content', 'products.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(`\nSynced ${ctx.products.length} products to products.json`);
}

syncProducts().catch(error => {
  console.error('Sync failed:', error);
  process.exit(1);
});
