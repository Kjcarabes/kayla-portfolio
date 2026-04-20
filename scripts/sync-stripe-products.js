/**
 * Sync products from Stripe to products.json
 *
 * How originals vs prints/crafts flow through here:
 *
 *   Prints & Crafts — must have an active Stripe Payment Link.
 *     Availability = payment link active flag.
 *
 *   Originals — no payment link required. The script also scans all active
 *     Stripe products tagged `category: Originals` and picks them up even
 *     when no payment link exists. Availability comes from the product's
 *     `status` metadata field (`available` | `sold`, default available).
 *
 * Metadata on a Stripe product:
 *   - category: "Originals" | "Prints" | "Crafts"       (required)
 *   - status:   "available" | "sold"                    (originals only)
 *   - workId:   matches a work id in works.json         (optional)
 *   - order:    integer sort order                      (optional)
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

function loadWorks() {
  try {
    const worksPath = path.join(__dirname, '..', 'content', 'works.json');
    const data = JSON.parse(fs.readFileSync(worksPath, 'utf8'));
    return data.works || [];
  } catch (error) {
    console.log('Could not load works.json, skipping image inheritance');
    return [];
  }
}

function readMetadata(md, ...keys) {
  if (!md) return undefined;
  for (const k of keys) if (md[k] !== undefined && md[k] !== '') return md[k];
  return undefined;
}

function normalizeCategory(rawCategory) {
  if (!rawCategory) return null;
  return CATEGORY_MAP[rawCategory.toLowerCase()] || null;
}

// Build a product entry from a Stripe product, given price + optional payment link.
function buildProductEntry({ product, priceAmount, stripeLink, soldOverride, works }) {
  const rawCategory = readMetadata(product.metadata, 'category', 'Category', 'CATEGORY') || 'Prints';
  const category = normalizeCategory(rawCategory) || 'Prints';

  const rawOrder = readMetadata(product.metadata, 'order', 'Order') || '0';
  const order = parseInt(rawOrder, 10) || 0;

  const workId = readMetadata(product.metadata, 'workId', 'workid', 'WorkId', 'work_id') || null;

  // Originals: availability comes from status metadata. Prints/crafts: from payment link.
  let sold;
  if (category === 'Originals') {
    const status = (readMetadata(product.metadata, 'status', 'Status') || 'available').toLowerCase();
    sold = status === 'sold';
  } else {
    sold = soldOverride === true;
  }

  let image = product.images?.[0] || 'assets/images/placeholder.jpg';
  const linkedWork = workId ? works.find(w => w.id === workId) : null;
  if (linkedWork?.image) image = linkedWork.image;

  const entry = {
    id: product.id,
    title: product.name,
    category,
    price: priceAmount != null ? priceAmount / 100 : 0,
    image,
    description: product.description || '',
    stripeLink: stripeLink || '',
    sold,
    _order: order,
  };
  if (workId) entry.workId = workId;
  return entry;
}

async function syncProducts() {
  const works = loadWorks();

  console.log('Fetching payment links from Stripe...');
  const [activeLinks, inactiveLinks] = await Promise.all([
    stripe.paymentLinks.list({ active: true, limit: 100, expand: ['data.line_items'] }),
    stripe.paymentLinks.list({ active: false, limit: 100, expand: ['data.line_items'] }),
  ]);
  const paymentLinks = [...activeLinks.data, ...inactiveLinks.data];
  console.log(`Found ${activeLinks.data.length} active and ${inactiveLinks.data.length} inactive payment links`);

  const products = [];
  const capturedProductIds = new Set();

  // --- Pass 1: products reached via payment links (prints, crafts, and any
  //             originals that happen to have a payment link too). ---
  for (const link of paymentLinks) {
    try {
      const lineItems = await stripe.paymentLinks.listLineItems(link.id, { limit: 1 });
      if (lineItems.data.length === 0) {
        console.log(`Skipping ${link.id} - no line items`);
        continue;
      }

      const price = await stripe.prices.retrieve(lineItems.data[0].price.id, { expand: ['product'] });
      const product = price.product;

      if (!product.active) {
        console.log(`Skipping ${product.name} - product not active`);
        continue;
      }

      const entry = buildProductEntry({
        product,
        priceAmount: price.unit_amount,
        stripeLink: link.url,
        soldOverride: !link.active,
        works,
      });

      products.push(entry);
      capturedProductIds.add(product.id);
      console.log(`Added (link): ${product.name} (${entry.category}) - $${entry.price}${entry.sold ? ' [sold]' : ''}`);
    } catch (error) {
      console.error(`Error processing payment link ${link.id}:`, error.message);
    }
  }

  // --- Pass 2: originals without a payment link. ---
  console.log('\nScanning for originals without payment links...');
  let originalsFound = 0;
  for await (const product of stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'] })) {
    const category = normalizeCategory(readMetadata(product.metadata, 'category', 'Category', 'CATEGORY'));
    if (category !== 'Originals') continue;
    if (capturedProductIds.has(product.id)) continue;

    const defaultPrice = product.default_price && typeof product.default_price === 'object'
      ? product.default_price
      : null;

    const entry = buildProductEntry({
      product,
      priceAmount: defaultPrice?.unit_amount ?? null,
      stripeLink: '',
      soldOverride: false, // unused for originals; status metadata drives it
      works,
    });

    products.push(entry);
    capturedProductIds.add(product.id);
    originalsFound++;
    console.log(`Added (product): ${product.name} (${entry.category}) - $${entry.price}${entry.sold ? ' [sold]' : ''}`);
  }
  console.log(`Found ${originalsFound} originals without payment links`);

  // Sort: lower _order first, then by title.
  products.sort((a, b) => (a._order - b._order) || a.title.localeCompare(b.title));
  products.forEach(p => delete p._order);

  const output = {
    '_comment': '✏️ AUTO-GENERATED FROM STRIPE - Do not edit manually!',
    '_instructions': 'Manage products in Stripe Dashboard. This file syncs automatically.',
    'products': products,
    '_lastSync': new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, '..', 'content', 'products.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`\nSynced ${products.length} products to products.json`);
}

syncProducts().catch(error => {
  console.error('Sync failed:', error);
  process.exit(1);
});
