/**
 * Fulfil paid Stripe orders through Gelato — from the command line.
 *
 *   npm run gelato                      # show every paid order + its state (reads only)
 *   npm run gelato -- --plan            # show the exact Gelato payloads that WOULD be sent
 *   npm run gelato -- --live            # stage them at Gelato as DRAFTS (nothing prints yet)
 *   npm run gelato -- --drafts          # list drafts waiting for review
 *   npm run gelato -- --approve all --live   # send the reviewed drafts to print
 *
 * DRAFTS FIRST, ALWAYS. `--live` creates Gelato *draft* orders: Gelato holds them,
 * nothing goes to production and nothing is charged. A draft only becomes a real
 * print when it is approved — from the Orders tab in /admin, or with --approve
 * here. `--print-now` skips the draft step, and exists only for the rare case
 * where you're standing over the order and want it out the door immediately.
 *
 * Nothing at all is sent without `--live`. Everything else is read-only.
 *
 * WHY THE IDEMPOTENCY IS BELT-AND-BRACES
 * Double-printing costs real money and can't be undone once Gelato starts, so an
 * order is skipped if ANY of three independent records says it's already done:
 *
 *   1. Stripe    — we stamp `gelato_order_id` onto the PaymentIntent's metadata the
 *                  instant Gelato accepts. This is the authority: it lives with the
 *                  payment itself, so it survives a lost laptop, a fresh clone, or
 *                  the Worker and this script both running.
 *   2. Gelato    — we search Gelato for an order whose orderReferenceId is this
 *                  Stripe session id before creating one.
 *   3. Local     — .gelato-ledger.json (gitignored) as an audit log / last resort.
 *
 * The Stripe checkout session id IS the Gelato orderReferenceId. One purchase =
 * one reference = one print, forever.
 *
 * A paid order is also REFUSED (never silently fulfilled) when it is refunded, not
 * fully paid, missing a shipping address, or has no Gelato product configured.
 *
 * Other modes:
 *   --catalog [text]      find Gelato productUids to paste into the admin
 *   --shipping <COUNTRY>  list shipment methods for a country
 *   --drafts              list Gelato draft orders waiting for approval
 *   --approve <id|all>    turn drafts into real orders (needs --live)
 *
 * Needs STRIPE_SECRET_KEY and GELATO_API_KEY (read from .env or the environment).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- env ---------------------------------------------------------------------

// Tiny .env reader — the repo deliberately has no dotenv dependency.
(function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
})();

const GELATO_KEY = process.env.GELATO_API_KEY || '';
const LEDGER_PATH = path.join(__dirname, '..', '.gelato-ledger.json');

// --- args --------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const opts = {
  live: has('--live'),
  plan: has('--plan'),
  yes: has('--yes'),
  drafts: has('--drafts'),
  approve: valueOf('--approve'),
  catalog: has('--catalog') ? (valueOf('--catalog') || '') : null,
  shipping: valueOf('--shipping'),
  only: valueOf('--only'),
  since: valueOf('--since'),
  max: parseInt(valueOf('--max', '25'), 10),
  // Draft is the default and the whole point: an order is staged for review, not
  // printed. --print-now is the deliberate opt-out.
  draftMode: !has('--print-now'),
};

// --- pretty printing ---------------------------------------------------------

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const money = (cents, cur = 'usd') => `${(cents / 100).toFixed(2)} ${cur.toUpperCase()}`;
const rule = (label = '') => console.log(C.dim('─'.repeat(78)) + (label ? ` ${label}` : ''));

function die(msg) {
  console.error(`\n${C.red('✖')} ${msg}\n`);
  process.exit(1);
}

// --- content -----------------------------------------------------------------

function loadJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
  } catch {
    return fallback;
  }
}

const SITE_URL = 'https://www.kaylacarabes.com';

// Absolute, publicly fetchable URL for the file Gelato prints. An explicit
// gelatoPrintFile wins; otherwise a print falls back to the artwork photo itself
// (which is what the print IS). Crafts have no sane fallback — a photo OF a tote
// is not the tote's artwork — so they must set gelatoPrintFile explicitly.
function printFileUrl(entry) {
  const raw = entry.gelatoPrintFile || null;
  if (raw) return /^https?:\/\//i.test(raw) ? raw : `${SITE_URL}/${String(raw).replace(/^\.?\//, '')}`;
  if (entry._kind === 'print' && entry.image) return `${SITE_URL}/${String(entry.image).replace(/^\.?\//, '')}`;
  return null;
}

// Build workId/shopItemId → fulfilment config, the same two sources the shop is
// generated from, so nothing can drift between what sells and what ships.
function loadCatalogConfig() {
  const byWorkId = new Map();
  const byShopItemId = new Map();

  for (const w of (loadJson('content/works.json', { works: [] }).works || [])) {
    byWorkId.set(w.id, {
      _kind: 'print',
      key: w.id,
      title: w.title,
      image: w.image,
      gelatoProductUid: w.gelatoProductUid || '',
      gelatoPrintFile: w.gelatoPrintFile || '',
      gelatoAuto: w.gelatoAuto === true,
    });
  }
  for (const it of (loadJson('content/shop-items.json', { items: [] }).items || [])) {
    if (!it || !it.id || it._example) continue;
    byShopItemId.set(it.id, {
      _kind: 'craft',
      key: it.id,
      title: it.title,
      image: it.image,
      gelatoProductUid: it.gelatoProductUid || '',
      gelatoPrintFile: it.gelatoPrintFile || '',
      gelatoAuto: it.gelatoAuto === true,
    });
  }
  return { byWorkId, byShopItemId };
}

const settings = (() => {
  const s = loadJson('content/gelato-settings.json', {});
  return {
    currency: s.currency || 'USD',
    shipmentMethodUid: s.shipmentMethodUid || '',
    maxQuantityPerOrder: Number(s.maxQuantityPerOrder) || 3,
    allowedCountries: Array.isArray(s.allowedCountries) ? s.allowedCountries : [],
  };
})();

// --- local ledger ------------------------------------------------------------

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')); } catch { return { orders: {} }; }
}
function writeLedger(ledger) {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
}

// --- Gelato ------------------------------------------------------------------

async function gelato(method, url, body) {
  if (!GELATO_KEY) die('GELATO_API_KEY is not set. Add it to .env (see admin-worker/README.md).');
  const res = await fetch(url, {
    method,
    headers: { 'X-API-KEY': GELATO_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text.slice(0, 300) || res.statusText;
    const err = new Error(`Gelato ${method} ${url} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const GELATO_ORDERS = 'https://order.gelatoapis.com/v4/orders';

// Has Gelato already got an order for this Stripe session? Treated as advisory:
// if the search endpoint misbehaves we fall back to the Stripe + ledger records
// rather than risking a duplicate on a maybe.
async function gelatoHasOrder(referenceId) {
  try {
    const res = await gelato('POST', `${GELATO_ORDERS}:search`, {
      orderReferenceId: referenceId,
      orderReferenceIds: [referenceId],
      limit: 50,
    });
    const orders = (res && res.orders) || [];
    // The filter is applied server-side, but re-check locally so a search that
    // silently ignores the filter can't produce a false "already ordered".
    const hit = orders.find(o => o.orderReferenceId === referenceId);
    return hit ? { id: hit.id, status: hit.fulfillmentStatus, orderType: hit.orderType } : null;
  } catch (err) {
    console.log(C.yellow(`   ⚠ couldn't check Gelato for existing order (${err.message.slice(0, 120)})`));
    return null;
  }
}

// --- Stripe ------------------------------------------------------------------

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) die('STRIPE_SECRET_KEY is not set. Add it to .env.');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Map every payment link we own → which work / shop item it sells. The link
// metadata is written by sync-stripe-products.js, so this join is exact.
async function loadLinkMap(stripe) {
  const map = new Map();
  for (const active of [true, false]) {
    for await (const link of stripe.paymentLinks.list({ active, limit: 100 })) {
      map.set(link.id, {
        workId: link.metadata?.workId || null,
        shopItemId: link.metadata?.shopItemId || null,
      });
    }
  }
  return map;
}

function shippingOf(session) {
  // `shipping_details` moved under `collected_information` in newer API versions;
  // read both so this keeps working across a Stripe version bump.
  return session.collected_information?.shipping_details || session.shipping_details || null;
}

function toGelatoAddress(session) {
  const ship = shippingOf(session);
  const addr = ship?.address;
  if (!addr || !addr.line1 || !addr.country) return null;
  const name = (ship.name || session.customer_details?.name || '').trim();
  const sp = name.indexOf(' ');
  return {
    firstName: sp > 0 ? name.slice(0, sp) : (name || 'Customer'),
    lastName: sp > 0 ? name.slice(sp + 1) : '-',
    addressLine1: addr.line1,
    addressLine2: addr.line2 || '',
    city: addr.city || '',
    postCode: addr.postal_code || '',
    state: addr.state || '',
    country: addr.country,
    email: session.customer_details?.email || '',
    phone: session.customer_details?.phone || '',
  };
}

// --- building the work list --------------------------------------------------

/**
 * One row per paid Stripe order, annotated with everything needed to decide
 * whether it may be fulfilled. `blockers` non-empty means "never send this".
 */
async function collectOrders(stripe, config) {
  const linkMap = await loadLinkMap(stripe);
  const ledger = readLedger();
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  if (opts.since && Number.isNaN(sinceMs)) die(`--since "${opts.since}" is not a date (use YYYY-MM-DD).`);

  const rows = [];
  for await (const session of stripe.checkout.sessions.list({
    status: 'complete', limit: 100, expand: ['data.payment_intent'],
  })) {
    if (opts.only && session.id !== opts.only) continue;
    if (sinceMs && session.created * 1000 < sinceMs) continue;

    const link = session.payment_link ? linkMap.get(typeof session.payment_link === 'string' ? session.payment_link : session.payment_link.id) : null;
    const item = link
      ? (link.workId ? config.byWorkId.get(link.workId) : link.shopItemId ? config.byShopItemId.get(link.shopItemId) : null)
      : null;

    const pi = typeof session.payment_intent === 'object' ? session.payment_intent : null;
    const address = toGelatoAddress(session);
    const blockers = [];
    const notes = [];

    if (session.payment_status !== 'paid') blockers.push(`payment_status is "${session.payment_status}"`);
    if (pi && pi.status !== 'succeeded') blockers.push(`payment is "${pi.status}"`);
    if (!link) notes.push('not a shop payment link (commission/invoice?)');
    else if (!item) blockers.push('no matching work / shop item in JSON');
    if (item && !item.gelatoProductUid) blockers.push(`no Gelato product set for "${item.title}"`);
    if (item && !printFileUrl(item)) blockers.push(`no print file for "${item.title}" — set gelatoPrintFile`);
    if (!address) blockers.push('no shipping address on the order');
    else if (settings.allowedCountries.length && !settings.allowedCountries.includes(address.country)) {
      notes.push(`ships to ${address.country}, outside the configured list`);
    }

    rows.push({
      session, pi, item, address, blockers, notes,
      // Filled in lazily — each costs an API call, so only for real candidates.
      lineItems: null,
      quantity: 1,
      existing: {
        stripe: pi?.metadata?.gelato_order_id || null,
        ledger: ledger.orders?.[session.id]?.gelatoOrderId || null,
        gelato: null,
      },
    });
  }
  rows.sort((a, b) => b.session.created - a.session.created);
  return rows;
}

async function enrich(stripe, row) {
  if (row.lineItems) return row;
  const li = await stripe.checkout.sessions.listLineItems(row.session.id, { limit: 10 });
  row.lineItems = li.data;
  row.quantity = li.data.reduce((n, l) => n + (l.quantity || 1), 0) || 1;
  if (row.quantity > settings.maxQuantityPerOrder) {
    row.notes.push(`quantity ${row.quantity} is above maxQuantityPerOrder (${settings.maxQuantityPerOrder})`);
  }
  // A refunded order must never print. `latest_charge` carries the truth.
  if (row.pi?.latest_charge) {
    const chargeId = typeof row.pi.latest_charge === 'string' ? row.pi.latest_charge : row.pi.latest_charge.id;
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.refunded || charge.amount_refunded > 0) {
        row.blockers.push(`refunded (${money(charge.amount_refunded, charge.currency)})`);
      }
      if (charge.disputed) row.blockers.push('disputed');
    } catch (err) {
      row.blockers.push(`couldn't verify refund status (${err.message.slice(0, 80)})`);
    }
  }
  return row;
}

function alreadyDone(row) {
  return row.existing.stripe || row.existing.ledger || row.existing.gelato;
}

function gelatoPayload(row, asDraft) {
  return {
    orderType: asDraft ? 'draft' : 'order',
    orderReferenceId: row.session.id,
    customerReferenceId: row.session.customer_details?.email || row.session.customer || row.session.id,
    currency: settings.currency,
    items: [{
      itemReferenceId: `${row.item.key}:${row.session.id}`,
      productUid: row.item.gelatoProductUid,
      files: [{ type: 'default', url: printFileUrl(row.item) }],
      quantity: row.quantity,
    }],
    ...(settings.shipmentMethodUid ? { shipmentMethodUid: settings.shipmentMethodUid } : {}),
    shippingAddress: row.address,
  };
}

// --- output ------------------------------------------------------------------

function describe(row) {
  const s = row.session;
  const when = new Date(s.created * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const who = s.customer_details?.name || s.customer_details?.email || '(no name)';
  const what = row.item ? row.item.title : (s.payment_link ? 'unknown item' : 'not a shop link');
  return `${C.dim(when)}  ${C.bold(what.padEnd(28).slice(0, 28))} ${money(s.amount_total, s.currency).padStart(11)}  ${who}`;
}

function statusLabel(row) {
  if (alreadyDone(row)) {
    const src = row.existing.stripe ? 'Stripe' : row.existing.gelato ? 'Gelato' : 'ledger';
    return C.green(`✓ fulfilled (${row.existing.stripe || row.existing.gelato || row.existing.ledger}, per ${src})`);
  }
  if (row.blockers.length) return C.red(`✖ blocked: ${row.blockers.join('; ')}`);
  return C.yellow('● ready to fulfil');
}

function printRows(rows) {
  for (const row of rows) {
    console.log(describe(row));
    console.log(`   ${statusLabel(row)}`);
    for (const n of row.notes) console.log(C.dim(`   · ${n}`));
    console.log(C.dim(`   ${row.session.id}`));
  }
}

// --- confirmation ------------------------------------------------------------

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a); }));
}

async function confirmOrExit(count, what) {
  if (opts.yes) return;
  const phrase = `place ${count}`;
  console.log('');
  const answer = await ask(`${C.bold(`Type "${phrase}" to ${what}, anything else to cancel: `)}`);
  if (answer.trim() !== phrase) die('Cancelled — nothing was sent to Gelato.');
}

// --- modes -------------------------------------------------------------------

async function runCatalog(query) {
  console.log(C.bold(`\nSearching the Gelato catalog${query ? ` for "${query}"` : ''}…\n`));
  const catalogs = await gelato('GET', 'https://product.gelatoapis.com/v3/catalogs');
  const list = Array.isArray(catalogs) ? catalogs : (catalogs.data || catalogs.catalogs || []);
  const wanted = query
    ? list.filter(c => `${c.catalogUid} ${c.title}`.toLowerCase().includes(query.toLowerCase()))
    : list;

  if (!wanted.length) {
    console.log('No catalogs matched. All catalogs:');
    list.forEach(c => console.log(`  ${C.cyan(c.catalogUid)}  ${c.title}`));
    return;
  }
  for (const cat of wanted) {
    console.log(`${C.bold(cat.title)}  ${C.dim(cat.catalogUid)}`);
    try {
      const res = await gelato('POST', `https://product.gelatoapis.com/v3/catalogs/${cat.catalogUid}/products:search`, { limit: 12 });
      for (const p of (res.products || [])) {
        console.log(`   ${C.cyan(p.productUid)}`);
      }
      if ((res.products || []).length === 12) console.log(C.dim('   …more (narrow with --catalog <text>)'));
    } catch (err) {
      console.log(C.dim(`   (${err.message.slice(0, 100)})`));
    }
    console.log('');
  }
  console.log(C.dim('Paste the productUid you want into the work\'s "Gelato product ID" box in /admin.\n'));
}

async function runShipping(country) {
  const res = await gelato('GET', `https://shipment.gelatoapis.com/v1/shipment-methods?country=${encodeURIComponent(country)}`);
  console.log(C.bold(`\nShipment methods for ${country}:\n`));
  for (const m of (res.shipmentMethods || [])) {
    console.log(`  ${C.cyan((m.shipmentMethodUid || '').padEnd(28))} ${m.name}${m.hasTracking ? C.dim('  (tracking)') : ''}`);
  }
  console.log('');
}

async function runDrafts() {
  const res = await gelato('POST', `${GELATO_ORDERS}:search`, { orderTypes: ['draft'], limit: 100 });
  const drafts = (res && res.orders) || [];
  if (!drafts.length) {
    console.log(C.green('\nNo draft orders waiting. Nothing to approve.\n'));
    return drafts;
  }
  console.log(C.bold(`\n${drafts.length} draft order(s) waiting for approval:\n`));
  for (const d of drafts) {
    console.log(`  ${C.cyan(d.id)}  ${C.dim(d.createdAt || '')}  ref=${d.orderReferenceId || '—'}`);
  }
  console.log(C.dim(`\nApprove them with:  npm run gelato -- --approve all --live\n`));
  return drafts;
}

async function runApprove() {
  const drafts = await runDrafts();
  if (!drafts.length) return;

  const targets = opts.approve === 'all' ? drafts : drafts.filter(d => d.id === opts.approve);
  if (!targets.length) die(`No draft order matches "${opts.approve}".`);

  if (!opts.live) {
    console.log(C.yellow(`Dry run — would approve ${targets.length} draft(s). Add --live to actually do it.\n`));
    return;
  }
  await confirmOrExit(targets.length, `approve ${targets.length} draft(s) and send them to print`);

  for (const d of targets) {
    try {
      await gelato('PATCH', `${GELATO_ORDERS}/${d.id}`, { orderType: 'order' });
      console.log(`${C.green('✓')} approved ${d.id}`);
    } catch (err) {
      console.log(`${C.red('✖')} ${d.id}: ${err.message}`);
    }
  }
  console.log('');
}

async function runOrders() {
  const stripe = stripeClient();
  const config = loadCatalogConfig();

  console.log(C.bold('\nLoading paid Stripe orders…'));
  const rows = await collectOrders(stripe, config);
  if (!rows.length) {
    console.log(C.dim('\nNo completed Stripe checkouts found.\n'));
    return;
  }

  // Enrich only the ones that could plausibly be sent (each costs API calls).
  for (const row of rows) {
    if (!row.blockers.length && !alreadyDone(row) && row.item) await enrich(stripe, row);
  }
  // Ask Gelato itself about anything that still looks unfulfilled.
  for (const row of rows) {
    if (!row.blockers.length && !alreadyDone(row) && row.item) {
      const hit = await gelatoHasOrder(row.session.id);
      if (hit) row.existing.gelato = hit.id;
    }
  }

  rule();
  printRows(rows);
  rule();

  const ready = rows.filter(r => r.item && !r.blockers.length && !alreadyDone(r));
  const done = rows.filter(r => alreadyDone(r)).length;
  const blocked = rows.filter(r => r.blockers.length).length;
  const revenue = rows.reduce((n, r) => n + (r.session.amount_total || 0), 0);

  console.log(`${rows.length} paid order(s) · ${C.green(`${done} already fulfilled`)} · ${C.yellow(`${ready.length} ready`)} · ${C.red(`${blocked} blocked`)}`);
  console.log(C.dim(`Total collected: ${money(revenue, rows[0].session.currency)}\n`));

  if (!ready.length) {
    console.log(C.green('Nothing to do — every fulfillable order is already placed.\n'));
    return;
  }

  const capped = ready.slice(0, opts.max);
  if (capped.length < ready.length) {
    console.log(C.yellow(`Only the newest ${opts.max} will be processed (--max ${opts.max}). ${ready.length - capped.length} left for a later run.\n`));
  }

  console.log(C.bold(`These ${capped.length} would be sent to Gelato as ${opts.draftMode ? 'DRAFTS (held for review, nothing prints)' : C.red('REAL ORDERS — these print immediately')}:\n`));
  for (const row of capped) {
    const payload = gelatoPayload(row, opts.draftMode);
    console.log(`  ${C.bold(row.item.title)} ×${row.quantity} → ${row.address.firstName} ${row.address.lastName}, ${row.address.city} ${row.address.country}`);
    console.log(C.dim(`     productUid : ${payload.items[0].productUid}`));
    console.log(C.dim(`     print file : ${payload.items[0].files[0].url}`));
    console.log(C.dim(`     reference  : ${payload.orderReferenceId}`));
    if (opts.plan) console.log(C.dim(JSON.stringify(payload, null, 2).split('\n').map(l => '     ' + l).join('\n')));
  }
  console.log('');

  if (!opts.live) {
    console.log(C.yellow('Dry run. Nothing was sent.'));
    console.log(C.dim('Add --plan to see the full JSON, or --live to stage them as drafts.\n'));
    return;
  }

  await confirmOrExit(capped.length, opts.draftMode
    ? `stage ${capped.length} Gelato draft(s) for review`
    : `place ${capped.length} REAL Gelato order(s) that will print immediately`);

  const ledger = readLedger();
  let placed = 0;
  for (const row of capped) {
    const label = `${row.item.title} → ${row.address.city} ${row.address.country}`;
    try {
      // Last-second re-check: another run (or the Worker) may have placed it in
      // the seconds since we listed. Cheap insurance against a double print.
      const race = await gelatoHasOrder(row.session.id);
      if (race) {
        console.log(`${C.yellow('↷')} skipped ${label} — Gelato already has ${race.id}`);
        continue;
      }

      const order = await gelato('POST', GELATO_ORDERS, gelatoPayload(row, opts.draftMode));
      console.log(`${C.green('✓')} ${label} → Gelato ${order.id}`);
      placed++;

      // Record it on the payment itself FIRST — if this fails we want to know
      // loudly, because Stripe is what every future run trusts.
      try {
        if (row.pi) {
          await stripe.paymentIntents.update(row.pi.id, {
            metadata: {
              ...(row.pi.metadata || {}),
              gelato_order_id: order.id,
              gelato_order_type: order.orderType || (opts.draftMode ? 'draft' : 'order'),
              gelato_placed_at: new Date().toISOString(),
            },
          });
        }
      } catch (err) {
        console.log(C.red(`   ⚠ Gelato order ${order.id} was created but stamping Stripe failed: ${err.message}`));
        console.log(C.red(`   ⚠ Write gelato_order_id=${order.id} onto payment ${row.pi?.id} by hand before re-running.`));
      }

      ledger.orders = ledger.orders || {};
      ledger.orders[row.session.id] = {
        gelatoOrderId: order.id,
        orderType: order.orderType || (opts.draftMode ? 'draft' : 'order'),
        item: row.item.title,
        quantity: row.quantity,
        placedAt: new Date().toISOString(),
      };
      writeLedger(ledger);
    } catch (err) {
      console.log(`${C.red('✖')} ${label}: ${err.message}`);
    }
  }

  console.log(`\n${C.bold(`${placed} order(s) sent.`)}${opts.draftMode
    ? ' They are DRAFTS — nothing prints until they are approved, in the Orders tab of /admin or with:\n  npm run gelato -- --approve all --live'
    : ''}\n`);
}

// --- main --------------------------------------------------------------------

(async () => {
  if (opts.catalog !== null) return runCatalog(opts.catalog);
  if (opts.shipping) return runShipping(opts.shipping);
  if (opts.approve) return runApprove();
  if (opts.drafts) return runDrafts();
  return runOrders();
})().catch(err => die(err.stack || err.message));
