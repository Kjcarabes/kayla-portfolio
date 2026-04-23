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

Top-level files / dirs the user touches:

- `index.html`, `work.html`, `shop.html`, `about.html`, `blog.html`, `contact.html`, `work-detail.html` — the pages
- `assets/css/style.css` — single global stylesheet (CSS variables in `:root`)
- `assets/js/main.js` — single global script. Multi-page: each page-specific function early-returns if its DOM root isn't present
- `content/works.json` — the artwork database (the source of truth for everything art-related, including originals on the shop)
- `content/products.json` — **auto-generated** from Stripe via `scripts/sync-stripe-products.js`. Don't edit by hand
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
- Don't write multi-paragraph comments or summary docs unless the user asks. Inline comments should explain *why*, never *what*.
