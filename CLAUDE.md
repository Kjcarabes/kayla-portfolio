# Project context for Claude

This file is auto-loaded by Claude Code when working in this repo. It encodes the
design decisions and constraints behind the current state of the codebase so future
sessions don't relitigate them.

## What this project is

A static portfolio site for the artist Kayla Carabes (`kaylacarabes.com`). The
**runtime site is plain HTML / CSS / vanilla JS** — no framework, no client bundler,
no build step required to deploy. GitHub Pages serves the repo root directly.

There *is* local Node tooling (`package.json` + `scripts/`), but it only generates
content that lives in the repo (optimized images, synced Stripe products); the site
itself never imports any of it.

Open work and ideas live in `TODO.md` (dated; check it before proposing new features).

Top-level files / dirs the user touches:

- `index.html`, `work.html`, `shop.html`, `about.html`, `blog.html`, `contact.html`, `work-detail.html` — the pages
- `assets/css/style.css` — single global stylesheet (CSS variables in `:root`)
- `assets/js/main.js` — single global script. Multi-page: each page-specific function early-returns if its DOM root isn't present
- `content/works.json` — the artwork database (the source of truth for everything art-related, including originals on the shop)
- `content/products.json` — **auto-generated** by `scripts/sync-stripe-products.js`. Don't edit by hand. Prints come from `works.json` (`printPrice`); crafts come from `shop-items.json`; the script provisions all the Stripe objects
- `content/shop-items.json` — shop items that aren't artworks (crafts/merch). Each becomes a Stripe product+price+payment link automatically. `_example` items are skipped
- `content/shop-settings.json` — shipping config (allowed countries + flat shipping rates) applied to the auto-created checkouts
- `content/blog.json`, `content/site-settings.json` — straightforward content files
- `assets/images/` — raw source images (large originals)
- `assets/images/optimized/` — **auto-generated** WebP variants. Don't edit by hand
- `EDITING-GUIDE.md` — written for Kayla (non-developer). Keep tone friendly, instructions concrete

## Critical design decisions

### Gallery layout: justified rows, never crop

The works grid (work page year sections + home page "Selected Work") uses a
**Flickr / Google Photos-style justified-rows layout**, not a CSS grid with fixed
aspect-ratio cells. Each row has a uniform height; item *widths* vary to preserve
each painting's natural aspect ratio.

This was a deliberate aesthetic choice: Kayla's pieces are deliberately uneven sizes
(6"×3" panels to 6'×5' canvases) and any fixed-aspect cell would crop the work, which
destroys the museum read she wants. Confirmed and validated by the user.

Implementation lives in `assets/js/main.js`:

- `layoutJustifiedRows(grid)` — does the per-grid packing
- `applyJustifiedLayout(grids)` — runs layout + sets up resize handler + does the fade-in lifecycle (`.work-grid` starts at `opacity: 0`, JS adds `.laid-out` class once dimensions are set)

Subtle behaviors that are load-bearing — don't regress them:

1. **Smart row packing.** When adding the next item would overflow, the algorithm compares the row height *with* the new item (stretched down) vs. *without* it (stretched up) and picks whichever ends up closest to the target row height. Without this, one wide painting at the end of a row crushes the whole row to a thin strip.
2. **Last-row width cap.** The trailing partial row keeps the target height *unless* a single very wide image would overflow the container — then it scales down to fit. Without this, a wide last image overflows the viewport on mobile.
3. **Responsive target height.** `< 600px` viewport: target ≈ container width (one image per row). `< 1024px`: 280. `< 1600px`: 340. Else: 400.
4. **Fade-in after layout.** `.work-item` elements have no width until JS sets it. If the grid weren't `opacity: 0` until laid out, the user briefly sees images at their intrinsic size during decode/measure. Don't remove this.

### Image optimization pipeline (the perf story)

Originals are heavy (some 6+ MB). The pipeline:

- `scripts/optimize-images.js` walks every image referenced in `works.json` and writes WebP variants at multiple widths into `assets/images/optimized/` (mirroring source paths, e.g. `xochi/xochi-800.webp`)
- It also writes `aspectRatio` and `widths` back into each work entry in `works.json`
- The runtime helper `pictureMarkup({...})` in `main.js` builds `<picture>` markup with a `<source type="image/webp" srcset="...">` block and a fallback `<img src="original">`

The aspect-ratio precomputation is the layout perf win: `applyJustifiedLayout` checks
`item.dataset.aspectRatio` first and only falls back to awaiting image decode if any
item is missing it. With ratios precomputed, the layout runs **without downloading any
image**, and `loading="lazy"` on the `<img>` actually does its job — only on-screen
images get fetched.

**Graceful fallback is required and intentional:** if an image is referenced before
the optimizer has run for it, `pictureMarkup` returns a plain `<img>` (no srcset),
and `applyJustifiedLayout` falls back to the await-decode path. The page is slower
but never broken. Don't add hard requirements that the optimizer must have run.

The `.github/workflows/optimize-images.yml` action runs the optimizer on every push
that touches raw images (excluding `assets/images/optimized/**`) or `works.json`,
and commits the result with `[skip ci]` to avoid an infinite loop.

Where `pictureMarkup` is consumed:

- `createWorkItem` — work grid + featured grid (uses `data-aspect-ratio` for layout)
- `initHeroSlideshow` — hero on the home page (first slide is **eagerly** loaded since it's the LCP)
- `createProductCard` — shop cards (synthetic Originals get the optimized path; Stripe-sourced product images have no `widths` so they fall back to plain `<img>`, which is correct because we don't control Stripe's CDN)

### Shop card design

- Cards are uniform (1:1 image cell, fixed-min-width grid). Their *images* use `object-fit: contain` (not cover) so paintings letterbox instead of crop.
- Letterbox bands are `#f0f0f0` — soft enough to read as part of the card, distinct enough not to look like missing whitespace. The user iterated on this color several times: white was "doesn't fit the site," `#e5e5e5` was "too noticeable," `#f0f0f0` is the agreed sweet spot.
- The "All" and "Prints" tabs render a **combined view** (one card per work, with the original's status surfaced as a sub-block on the print's card). On those tabs, the per-product **category badge is hidden** (redundant — each card represents a combined work) and the **non-clickable "Sold!" button is hidden** (it only added vertical noise that misaligned cards). The status label still communicates sold-ness ("Original unavailable — Sold!"). Originals tab still shows the badge and the Sold button so its uniformly-structured cards stay aligned.
- Toggle classes: `filter-all`, `filter-prints`, `filter-originals` on `#product-grid` (set in `populateShop` initially and `setupShopFilters` on click).
- Cards stretch to row height (`align-items: stretch`) so a card with a long medium doesn't leave its neighbors with whitespace below the buy button. Price lives **inside** `.product-card-actions` (not in `.product-card-top`) so it bottom-anchors with the rest of the action area and aligns across cards in a row even when descriptions vary in length.
- `.product-card-medium` is line-clamped to 2 lines so a runaway value can't pull a row stretched-tall.

### Prints & shop inventory: JSON is the source of truth, Stripe is just plumbing

Design goal (explicit user requirement): **Kayla only ever edits JSON/code — never the
Stripe dashboard.** The sync script provisions every Stripe object (product, price,
payment link, shipping rate) from the JSON. The unifying rule is **default-exclude**:
nothing appears in the shop unless it's intentionally declared inventory.

Three buckets:

- **Originals** — synthesized from `works.json` (`originalStatus`). Covered above.
- **Prints** — driven from `works.json` per-work fields:
  - `printPrice` (number): `> 0` = live at that price; `0` / omitted = sold out.
  - `printDescription` (string, default `"Print"`): the short blurb on the shop card.
  - `printStock` (int, optional): edition size → Stripe payment-link `restrictions.
    completed_sessions.limit`. `0` = sold out; omitted = unlimited. Inventory tracks
    itself: each sync counts completed Checkout Sessions for the link (`countCompleted
    Sessions`) and writes `stockRemaining = stock − sold` into the entry. Stripe
    auto-deactivates the link at the cap; the reconcile then shows it sold out. The
    counter refreshes at **sync cadence** (push / 6h cron / manual dispatch), NOT per
    pageview — there's no backend. The front-end shows "Only N left" when `stockRemaining`
    is 1–10. Because Stripe inactivates a maxed link, `reconcilePurchasable` decides
    available/sold-out from `stock − sold` (not the link's `active` flag) so it won't
    wrongly reactivate a sold-out edition.
  - `printOrder` (int, optional): sort order. `noPrint: true`: no print card at all.
  - **`printStock` is a cap, not an inventory count.** Blank/omitted = unlimited, which
    is the normal case for print-on-demand. `0` = sold out. That `0` is a live footgun:
    both the Jimothy print and the tote were hidden from the shop because a literal `0`
    was typed into the admin meaning "I don't hold any on a shelf". The admin labels it
    "Stock", placeholders it `Unlimited`, and shows a red inline warning the moment a
    `0` is entered. Keep that warning.
  - Stripe **cannot unset** a payment link's `restrictions`, so a link that once had a
    cap can never become unlimited. `linkStockMatches` therefore refuses to reuse a
    capped link when the JSON now says unlimited, forcing a fresh link. Without this,
    clearing the stock box silently leaves the old cap in force.
  - Default is **on for every work** — a work with no `printPrice` still shows a
    "Sold out" print card. Deliberate (user chose the literal "every new work auto-gets a
    print, sold out until priced"). Opt out with `noPrint`.
- **Crafts / merch not tied to a painting** — driven from `content/shop-items.json`
  (`id`, `title`, `category`, `price`, `image`, `description`, `stock`, `order`). Same
  reconcile mechanics as prints. `_example` items are skipped (inline docs). There's also
  a legacy escape hatch: a *manual* Stripe product flagged `shop: true` still shows — but
  JSON is the documented path. Unflagged payment links (commissions/invoices) never appear.

Shipping (`content/shop-settings.json`): Stripe does NOT auto-calculate shipping for
payment links, and a payment link shows **all** `shipping_options` to **every** buyer —
there's no per-destination filtering. So we define flat regional `shippingRates` (each →
a Stripe shipping_rate, reused by display_name+amount) the buyer self-selects, plus
`shippingCountries` (allowed_countries). Default covers US/Canada/UK+Europe/AU+NZ/RoW.
Known tradeoff (documented for Kayla): a buyer can pick the wrong region and underpay;
real per-country rates would need a backend Checkout Session — out of scope here.

`scripts/sync-stripe-products.js` runs in one pass (CI + `npm run sync-products`):

1. **Reconcile** — for each purchasable spec (print or craft) with `price > 0` and
   `stock !== 0`, ensure a Stripe Product + Price + active Payment Link exists at that
   amount, with shipping + optional stock cap (creating the first time, adopting an
   existing product by `metadata.workId` / `metadata.shopItemId`). Price 0 / stock 0
   deactivates any active link. Stripe can't make a $0 link, so sold-out items are
   emitted as synthetic `sold: true` entries straight from the JSON.
2. **Generate** — write `products.json` from the JSON-driven items + manual `shop: true`
   products. Stripe `category: Originals` is ignored.

Idempotency: a link URL is reused when an existing link already matches the desired
amount, so re-runs don't churn URLs. Price changes create a new Price + Link and
deactivate the old (Stripe prices/links are immutable). Needs `STRIPE_SECRET_KEY`;
runs only in CI or via the npm script.

`sync-stripe-products.yml` triggers on push to `content/works.json`,
`content/shop-items.json`, `content/shop-settings.json`, plus a 6h cron and manual
dispatch. It commits only `products.json` (never the source JSON) — no trigger loop.

### Order fulfilment: drafts always, printing only on a human click

Gelato is the print-on-demand fulfiller. The governing rule is **nothing prints
automatically, ever** — the user rejected true auto-fulfilment in favour of an
auto-*draft* + explicit approval flow, because a wrong print costs real money and
can't be undone once production starts.

The pipeline:

1. A print sells → Stripe fires `checkout.session.completed` → the admin Worker's
   `POST /stripe-webhook` stages a Gelato order with `orderType: 'draft'`. Gelato
   holds it: no production, no charge.
2. It appears in the admin **Orders** tab as "Draft — awaiting your OK".
3. Kayla ticks rows and presses **Send to print**, which `PATCH`es the draft to
   `orderType: 'order'`. This is the *only* code path that spends money.

Per-item opt-in lives on the item itself (`gelatoAuto`, default false, plus
`gelatoProductUid` and optional `gelatoPrintFile`), on works in `works.json` and on
items in `shop-items.json` — same "JSON is the source of truth" rule as the shop.
`gelatoAuto: false` skips Gelato entirely and just emails Kayla the address.

Print-file defaults are asymmetric on purpose: a **print** falls back to the artwork
photo (that photo *is* the print), a **craft** must set `gelatoPrintFile` explicitly
(a photo *of* a tote is not the tote's artwork). Don't "fix" the craft fallback.

**Idempotency is deliberately triple-redundant** — a double print is unrecoverable:

- The Stripe **PaymentIntent metadata** `gelato_order_id` is the authority. It lives
  with the payment, so it survives a fresh clone and is shared by the Worker and the
  CLI. Stamped immediately after Gelato accepts.
- Gelato is searched by `orderReferenceId` before creating (advisory — a failed
  search never blocks, but a hit always does).
- `.gelato-ledger.json` (gitignored) as a local audit log.

`orderReferenceId` is always the **Stripe checkout session id**. One purchase = one
reference = one print, forever. Don't change that mapping.

`scripts/gelato-orders.js` (`npm run gelato`) is the CLI equivalent, used for
backlogs. It is read-only without `--live`, `--live` only creates drafts, and
`--print-now` is the deliberate escape hatch. It refuses refunded, disputed,
unpaid, address-less and unconfigured orders rather than skipping them quietly.

**Buyer-facing email is entirely ours.** Gelato is white-label and emails customers
nothing, and the payment links carry no email config — so buyer comms are exactly
two things: Stripe's receipt (a dashboard toggle, `Customer emails → Successful
payments`, which was off until 2026-08-01) and our own shipping notice. The latter
comes from `POST /gelato-webhook?token=…` on `order_status_updated`; Gelato does not
sign its webhooks, so that URL token *is* the authentication. It emails once, keyed
on `trackingEmailedAt` in KV, with a manual resend button as the fallback.

`sendEmail` is gated on `ORDER_NOTIFY_URL`, **not** `NEWSLETTER_SEND_URL`, and must
stay that way. The Apps Script's `doPost` ends with `return sendNewsletter(payload)`,
so an unrecognised action falls through to a send to the entire mailing list —
requiring a separate secret is what guarantees the script has learned `notify`
before anything is sent. Never add a fallback to the newsletter URL here.

**Two separations the Orders tab depends on — don't collapse them.**

*Blockers vs. readiness.* `fulfilmentBlockers` only complains about Gelato config
when `item.auto` is on. A hand-posted item having no `gelatoProductUid` is the
correct state, not a fault, and flagging it trained the eye to ignore warnings.
Whether staging is possible is a separate flag, `gelatoReady`, which is what gates
the "Prepare draft" button — so an action is never offered that could only fail.

*Shop orders vs. everything else.* A completed Checkout Session with no
`workId`/`shopItemId` on its payment link is a commission or one-off invoice Kayla
made by hand. Those are returned as `otherPayments`, never as `orders`: there is
nothing to fulfil, so in the fulfilment queue they were permanently stuck in an
error state. They surface in **Original Sales** with a one-click import into the
sale record, deduped by session id via `sales.importedPayments`.

Customer addresses live **only** in Stripe and the Worker's private KV — never in
the repo. `/api/orders` merges Stripe (what/where) + Gelato (progress) + KV (Kayla's
manual status/tracking/notes) at read time; nothing about a buyer is committed.

### Site forms: relay through the Worker, KV first, honest answer

The inquiry modal, the contact-page message form and both newsletter signups
(`main.js` → `submitSiteForm`) post to the admin Worker's public `POST /forms/inquiry`
/ `/forms/newsletter` (outside the `/api/` password gate on purpose — visitors call
them). The Worker stores the entry in private KV **first**, then relays server-side
to the same Apps Script URLs the forms always used (read from the live
`site-settings.json`, so Kayla can change them without a redeploy), and returns a
real `{ ok }`. Before this the page posted `no-cors` and said "Sent!" unconditionally.

- **KV is the inquiry record now; the Sheet is history.** Each inquiry carries a
  `source` (`original` = shop modal, `contact` = contact page, `other`) and a `status`
  (`todo` / `done`). The admin **Inquiries** tab is the manager: filter pills, Mark
  done / to do, Delete, CSV, and **Reply** — a modal whose body is a draft written
  for that inquiry by Claude (`POST /api/inquiry-draft`: Worker-side raw fetch to
  the Messages API, `claude-opus-5`, artwork facts from `works.json` so it can't
  invent availability; falls back to a plain template without `ANTHROPIC_API_KEY`)
  and sends via `POST /api/inquiry-reply` → the notify Apps Script, with
  `renderBuyerEmail` appending "Kayla" + the signature. Drafts therefore end at the
  closing line, never with her name. When a price is asked, the draft gets
  `pricingFacts`: the Original Sales price list (list = target × markup; the floor
  is passed as "never state or go below"), the tab's fair-price formula on the
  work's parsed size, and median $/in² of actual sales — written as
  `$N [estimate — confirm]` unless it's the list price. The old inquiries Sheet is
  importable once via `/api/inquiries-import` (hash-keyed, idempotent, lands as
  `done`); the admin no longer reads the Sheet live. **Everyone who writes in joins
  the mailing list by default** (user's decision; every newsletter has a signed
  unsubscribe link): `subscribeInquirer` → Apps Script `subscribe` action, which
  refuses to re-add an address present in any row so opt-outs stick; falls back to
  the plain signup post once per address (`nl:auto:<email>` KV marker) on an older
  script. The inquiry/contact privacy line discloses it. The Sheet is no longer read live (its `inquiries` action also
  auto-added emails to the mailing list — that side effect is gone with it).
- **The Worker emails Kayla about every inquiry**, to `site-settings.json → email`
  (`kaylacarabesart@gmail.com`). The inquiries Sheet's Apps Script used to do this
  and mailed the Sheet owner's inbox (`kjcarabes@gmail.com`) — its `MailApp` line is
  meant to be deleted, not the Worker's. Newsletter signups get no email.
- Replies set `replyTo` on the notify payload; the Apps Script's `notifyOne` must
  pass it on (README §5) or customer replies go to the Sheet owner.
- `{ ok: true }` when *either* the KV write or the relay succeeded; the visitor is
  only told it failed when both did. Customer PII lives in KV only, never the repo.
- Bot filtering is Origin allow-list + honeypot (`website` field, class `.hp`) + a
  soft 10/hour/IP KV counter. A filled honeypot gets a happy `200` and is dropped.
- Validation is duplicated client (`isValidEmail` / `isValidPhone` in `main.js`) and
  server (`validateForm` in `worker.js`) — keep them in step. Phone = 7–15 digits
  after stripping formatting; the chosen contact preference must have its field; the
  contact page requires email + message.
- If `formsRelayUrl` is blank in `site-settings.json` the site falls back to the old
  direct no-cors post — graceful, never broken, same rule as the image pipeline.
- Anti-spoofing DNS (added 2026-08-28): `v=spf1 -all` + `_dmarc` `p=reject`. The
  domain sends no mail (Gmail does), so nothing legitimate is affected.

### Opportunity finder / job watcher: read-only routines, calendar is the state

Two scheduled Claude Code cloud routines run the prompts in `agents/*.md` (fetched
from the live site, not a checkout) and add events to a dedicated public Google Calendar
(`content/opportunities.json → calendarId`, edited in the admin Calendar tab). The
user asked for this to be "on guardrails heavily", and the shape follows from that:

- Real walls vs. asks. **Enforced:** the calendar connector is restricted to
  `list_calendars/list_events/get_event/create_event` via `permitted_tools` (no
  delete/update tool exists in the session); the connector's Google account is a
  throwaway that can see only the Opportunities calendar; no Gmail connector.
  **No repo access:** the routines have no git source — they fetch the prompt and
  the content JSON from the live site (`https://www.kaylacarabes.com/agents/…`,
  `/content/…`). The Claude GitHub App is uninstalled on purpose; `allowed_tools`
  in the routine config does not actually remove Bash from cloud sessions, so
  removing access was the only real wall. Edits to `agents/*.md` reach the routines
  only after a push + Pages deploy. Don't add an email connector to
  "improve" them; notifications come from Google Calendar's per-calendar settings.
- The cloud environment's default "Trusted" egress blocks `WebFetch` on arts sites;
  the routine then (correctly) creates nothing. The environment needs general web
  access for the finder to verify pages — that's a claude.ai environment setting.
- The calendar is the "seen" set (list before create) and `notInterested` is the
  reject list. No KV, no ledger, no repo writes. Deleting an event alone does not
  stop it resurfacing — that's why the admin tab has the Not-interested list.
- Create-only, one named calendar, hard per-run cap, "zero results is fine" — all in
  the prompt files. Keep those rules at the top of the prompt where they are.
- The profile is plain English in JSON so Kayla edits it in the admin; the prompt
  files are for developers. The Google Calendar embed requires the calendar to be
  public, which is acceptable only because it contains public open calls — never
  point it at her personal calendar.

### Mobile shop sidebar

On `<= 768px` the shop sidebar visually disappears: the `.shop-title` H1 is preserved
for SEO/a11y but is `clip: rect(0,0,0,0)` hidden, the sidebar has no border or padding,
and the filter buttons render as horizontally-centered pills (`border-radius: 999px`)
across the top. Don't reintroduce a visible sidebar on mobile.

### Mobile xochi-overflow bug (fixed, watch for regressions)

The image `xochi.jpeg` is wide enough that on phone widths a single-item last row
could blow past the viewport. Fixed in `flushRow(false)` which now caps height when
the projected width exceeds `containerWidth`. If you touch the layout function,
preserve this cap.

### SEO / AEO: stable in HTML, derived data generated between markers

Because galleries/shop/blog render client-side from JSON, the raw HTML a non-JS
crawler (or an AI answer-engine bot like GPTBot / ClaudeBot / PerplexityBot) fetches
would otherwise be near-empty. The split mirrors the rest of the repo — stable things
are hand-written, data-derived things are generated and committed (like HERO-PRELOAD
and the image pipeline), so the site stays plain static HTML with **no runtime build step**.

- **Hand-written, per page (in each `.html` `<head>`):** `<title>`, meta description,
  canonical, robots, `theme-color`, Open Graph + Twitter tags, and a stable JSON-LD
  `@graph` (`WebSite` + `Person` + the page-type node + `BreadcrumbList`). The `Person`
  block is intentionally duplicated across pages so each page is self-contained for
  crawlers; if the bio/identity changes, update it everywhere (about.html has the rich
  version with `subjectOf` exhibitions). The home page carries an SEO `<h1>` + intro in a
  `.visually-hidden` `<header>` so the image-first design is preserved.
- **Generated by `scripts/generate-seo.js` (`npm run generate-seo`):** `sitemap.xml`
  (home + sections + every `work-detail.html?id=…`), a per-page JSON-LD `ItemList` /
  `Product` / `Blog` block injected between `<!-- SEO-JSONLD:START/END -->` in the head,
  and a hidden-but-crawlable content fallback injected between `<!-- SEO-CONTENT:START/END -->`
  inside the same container main.js hydrates. The fallback is `.visually-hidden` and is
  wiped by `container.innerHTML = ''` on hydration — sighted users never see it. Pages
  covered: index, work, shop, blog. `robots.txt` is static.
- **work-detail.html** is a query-param URL whose body is JS-rendered, so its per-artwork
  title/description/canonical/OG + `VisualArtwork` JSON-LD are set at runtime by
  `applyWorkDetailSeo()` in main.js (helps engines that render JS; the static work.html
  `ItemList` + sitemap cover the no-JS crawlers). The `<link id="canonical-link">` and
  default OG tags in its head are placeholders JS overwrites.
- **CI:** `.github/workflows/generate-seo.yml` regenerates on content-JSON pushes, after
  the optimize-images / sync-products workflows complete (their `GITHUB_TOKEN` commits
  don't re-trigger path filters), on a daily cron, and on manual dispatch — committing
  with `[skip ci]`.

Gotchas — don't regress:
- `injectBetween` uses a **function replacer** and a **greedy** match on purpose. Prices
  like `$20` in the generated content would otherwise be interpreted as `$2`
  String.replace backreferences (corrupts output, breaks idempotency); the greedy match
  heals a block that ever got a stray marker. The generator must stay idempotent — run it
  twice, the second run must report everything "unchanged".
- Don't hand-edit anything between the SEO markers or in `sitemap.xml` — regenerated.
- Keep the SEO content fallback inside a container main.js fully replaces, or it will
  double-render in the browser.

## Working in this repo

### When the user adds a new image

The user just adds the file to `assets/images/` and references it in `content/works.json`.
The GitHub Action handles optimization on push. No manual step needed.

If they want to run it locally first: `npm install` (once) then `npm run optimize-images`.

### When the user changes works.json

The action runs and may auto-update `aspectRatio` / `widths` on works. Don't manually
add or "fix" those fields — they're machine-managed.

### When the user reports a layout/perf issue

Before changing `layoutJustifiedRows` or `applyJustifiedLayout`, re-read the bullets
in "Critical design decisions → Gallery layout" — multiple subtle behaviors are tied
together and easy to break.

### Don't

- Don't introduce a build step for the site itself. The site is plain HTML/CSS/JS served by GitHub Pages and must stay that way.
- Don't add a fixed `aspect-ratio` to `.work-item` (the museum-row design hinges on natural ratios).
- Don't crop with `object-fit: cover` on shop card images — `contain` is intentional.
- Don't manually edit `content/products.json` or `assets/images/optimized/` or the `aspectRatio` / `widths` fields in `works.json` — all auto-generated.
- Don't hand-edit `sitemap.xml` or anything between the `SEO-JSONLD` / `SEO-CONTENT` markers — regenerated by `scripts/generate-seo.js` (see "SEO / AEO" above).
- Don't write multi-paragraph comments or summary docs unless the user asks. Inline comments should explain *why*, never *what*.
