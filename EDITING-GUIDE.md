# How to Edit Your Portfolio Website

Heyyyyy HB. This guide will help you update your website. Don't worry - you are a coder now 
ദ്ദി ˉ͈̀꒳ˉ͈́ )✧

---

## Before You Start Editing

**Always pull the latest changes first!** The shop re-syncs automatically (a bot commits the generated `products.json`), so the code may have changed since you last worked on it.

Everytime before you make any changes- in your VSCode terminal (if you don't see it: hover to top menu bar -> click terminal -> new terminal), run:
```
git fetch
git pull
```

---

## Quick Reference

| What you want to do | Where to do it |
|---------------------|----------------|
| Add/remove artwork | `content/works.json` |
| Sell a print of a work | `content/works.json` (set `printPrice` — see Shop section!) |
| Sell crafts/merch (not a painting) | `content/shop-items.json` (see Shop section) |
| Change shipping countries / prices | `content/shop-settings.json` (see Shop section) |
| Add/remove blog posts | `content/blog.json` |
| Update email & social links | `content/site-settings.json` (updates everywhere!) |
| Update your bio | `about.html` |
| Change colors/fonts | `assets/css/style.css` |
| Replace images | `assets/images/` folder (auto-optimized on push!) |
| Change hero slideshow | `content/works.json` (heroFeature) |

⚠️ **Don't edit `content/products.json` directly** - it's auto-generated from Stripe and will be overwritten!

---

## How Work Detail Pages Work

When visitors click on any artwork in your gallery, they're taken to a dedicated detail page showing:
- The full-size image (click to zoom)
- Title and year
- Description (if you've added one)
- **Any linked shop products** (prints or originals available for purchase)

A print is automatically linked to its artwork — just set `printPrice` on the work (see Shop section below). Crafts/merch link to a work via optional `workId` metadata in Stripe.

### Descriptions on Shop Cards

For a **print**, the `printDescription` you set on the work is the little label shown on the shop card next to the price. Keep it short and punchy — a phrase, not a paragraph. Example: `"Signed giclée, 11x14"` or `"8x10 Print"`. (For crafts/merch, the Stripe product description plays this role.)

- The work's `description` in `works.json` is separate — it appears on the **Work detail page** (the artist statement), not on shop cards.
- The `medium` field from the linked work (e.g., "Acrylic on canvas, 24x36") shows as a small label under the product title on the shop card.

---

## Adding New Work

### Step 1: Add your image
1. Put your image file in the `assets/images/` folder
2. Use a simple filename with no spaces (e.g., `sunset-painting.jpg` not `Sunset Painting (Final).jpg`)

### Step 2: Add it to your gallery
Open `content/works.json` and add a new entry. Copy this template:

```json
{
  "id": "unique-name-here",
  "title": "Your Artwork Title",
  "date": "2024",
  "category": "Paintings",
  "image": "assets/images/your-image-filename.jpg",
  "description": "An artistic statement about your piece.",
  "medium": "Acrylic on canvas, 24x36",
  "featured": true,
  "heroFeature": true,
  "printPrice": 0,
  "printDescription": "5x7 Print",
  "printStock": 10
}
```

**What each field does:**
- `description` = artistic statement about the piece (shown on the work detail page only — shop cards use `printDescription`)
- `medium` = technical details like materials and size (shown everywhere: work detail page, shop cards, etc.)
- `featured: true` = shows in "Selected Work" grid on homepage
- `heroFeature: true` = shows in the big hero slideshow at top of homepage
- `printPrice` = the price of a **print** of this work, in dollars. `0` (or leaving it out) means the print shows as **"Sold out"**. Set it to a real number (e.g. `25`) to start selling — that's the *only* step; the website builds the Stripe checkout for you automatically. (See "Managing Your Shop" below.)
- `printDescription` = the little label on the print's shop card (e.g. `"5x7 Print"`). Defaults to "Print".
- `printStock` (optional) = the **Stock** box in the admin. Leave it out (or leave the box empty) for **unlimited** — that's almost always what you want for a print, since Gelato prints each one to order. Only put a number here if you *want* a limited run: Stripe counts each sale for you, the site shows **"Only N left"**, and it closes itself when they're gone. ⚠️ **`0` means SOLD OUT, not "I don't have any on a shelf"** — a `0` here hides the print from the shop. (The count refreshes each time the site syncs — within a minute of a push, or every few hours on its own — not the instant a sale happens, since there's no live server.)
- Put a comma after the previous artwork's `}` before adding yours
- Categories can be anything you want: Paintings, Drawings, Digital, Photography, etc.

**Optional extras:**

- `date` — can be a full ISO date (`"2025-07-15"`) or just a year (`"2025"`). The site always displays **only the year portion** in meta labels; the full date (when present) is used to sort works within a year on the Work page, giving finer-grained ordering. If you only know the year, just use `"2025"` — that's also what existing entries with the legacy `year` field do, and both keep working. New entries should prefer `date`.
- `detail_images` — an array of image paths, used for a photo gallery on the work-detail page:
  ```json
  "detail_images": [
    "assets/images/piece-front.jpg",
    "assets/images/piece-detail.jpg",
    "assets/images/piece-back.jpg"
  ]
  ```
  The first image is the main one; the rest appear as clickable thumbnails under it. Keep the single `image` field alongside — it's used on the gallery grid, homepage hero, and shop cards.

**Hero Slideshow:** Works with `heroFeature: true` will cycle through the homepage hero. Visitors can click or wait 5 seconds for auto-advance.

---

## Managing Your Shop

Good news: **for prints and originals you never have to touch Stripe.** You control the
whole shop from `content/works.json`. The website does all the Stripe setup for you behind
the scenes. Here's how each part of the shop works.

### Originals (paintings)

Every work in `content/works.json` is automatically an available original — nothing to set
up. To change an original's availability, add an **optional** `originalStatus` field:

```json
{
  "id": "moon",
  "title": "Moon over Utopia",
  ...
  "originalStatus": "sold"
}
```

Values:
- `"available"` *(default — omit the field)*
- `"sold"` — shows "Original Sold — Unavailable" with an X across the image
- `"nfs"` — hides the work from the Originals tab entirely (use for pieces that were never for sale)

Visitors click **Contact me** on available originals; that opens the inquiry modal and
emails you. You don't handle money through the site for originals.

### Prints (the easy new way!) 🎉

**You no longer make payment links in Stripe.** To sell a print of any artwork, just set
its `printPrice` in `content/works.json`:

```json
{
  "id": "sparkle-face",
  "title": "Luchadora",
  ...
  "printPrice": 25,
  "printDescription": "8x10 Print"
}
```

That's it. When you push to GitHub, the website automatically creates the Stripe product,
the price, and the **Buy Now** checkout link for you. ✨

**How `printPrice` works:**
- `printPrice: 0` (or leaving it out entirely) → the print shows as **"Sold out"**. Every
  work starts here by default, so your shop is safe — nothing sells until you say so.
- `printPrice: 25` → the print goes **live** at $25 with a working Buy button.
- Want to stop selling a print? Set `printPrice` back to `0`. It flips to "Sold out" and the
  checkout link is turned off automatically.
- **Limited editions:** add `"printStock": 10` (the **Stock** box in the admin). Stripe tracks
  each sale, the card shows "Only N left", and it auto-closes when sold out — nothing for you
  to update. **Leave it blank for unlimited**, which is the normal case for prints. Watch out:
  `0` means *sold out* and hides the print — if you meant "I don't keep any in a drawer", leave
  the box empty instead.
- Don't want a print option for a work at all? Add `"noPrint": true` to that work.

You can change the price anytime — edit the number and push, and the checkout rebuilds to
match.

> **Why this is better:** the old way meant logging into Stripe and hand-building a payment
> link for every print. Now your artwork database (`works.json`) is the single source of
> truth — the same file you already use for everything else.

### Crafts & merch (things that aren't paintings)

For shop items that *aren't* a painting in `works.json` — stickers, tote bags, zines, etc.
— add them to **`content/shop-items.json`**. Same deal as prints: you edit the file, push,
and the website builds the Stripe checkout for you. No Stripe dashboard needed!

```json
{
  "items": [
    {
      "id": "sticker-pack",
      "title": "Sticker Pack",
      "category": "Crafts",
      "price": 8,
      "image": "assets/images/stickers.jpg",
      "description": "Set of 5 vinyl stickers",
      "stock": 20,
      "order": 0
    }
  ]
}
```

- `id` = a unique short name (lowercase, dashes)
- `price` = dollars (`0` or sold-out `stock` shows it as "Sold out")
- `stock` (optional) = the **Stock** box. Leave it out for unlimited; a number caps the run and
  checkout closes when they sell out. `0` means **sold out** and hides the item.
- `category` = `Crafts` (or `Prints`)
- `image` = a file in `assets/images/`

The example item already in the file is ignored (it's there to copy) — just replace it.

> **What about Stripe for commissions?** You can still make a payment link in Stripe for a
> private commission or deposit, and it will **stay private** — it only shows up in the shop
> if you deliberately add metadata `shop = true` to it. So your one-off commission links
> never leak into the public shop. 👍

### Shipping settings

Open **`content/shop-settings.json`** to control shipping for all prints and crafts. It
comes set up to ship worldwide to the biggest markets (US, Canada, UK & Europe, Australia
& New Zealand, Japan):

```json
{
  "shippingCountries": ["US", "CA", "GB", "IE", "DE", "FR", "NL", "IT", "ES", "SE", "AU", "NZ", "JP"],
  "shippingRates": [
    { "label": "US Shipping", "amount": 6, "deliveryDaysMin": 3, "deliveryDaysMax": 7 },
    { "label": "Canada Shipping", "amount": 16, "deliveryDaysMin": 7, "deliveryDaysMax": 18 },
    { "label": "UK & Europe Shipping", "amount": 24, "deliveryDaysMin": 8, "deliveryDaysMax": 21 },
    { "label": "Australia & New Zealand Shipping", "amount": 28, "deliveryDaysMin": 10, "deliveryDaysMax": 24 },
    { "label": "Japan & Rest of World Shipping", "amount": 26, "deliveryDaysMin": 10, "deliveryDaysMax": 24 }
  ]
}
```

- `shippingCountries` = the countries you'll ship to (2-letter codes). Add or remove freely.
- `shippingRates` = the flat shipping prices a buyer chooses from at checkout. **Edit the
  `amount`s to match real USPS rates from Seattle** — the numbers above are just starting
  estimates.

> ⚠️ **One thing to know:** Stripe can't detect a buyer's country and auto-pick their rate —
> it shows *all* the options and the buyer chooses. That's why each one is clearly labeled by
> region. The small risk: someone in Australia could pick "US Shipping" and underpay. If that
> ever bugs you, you can ship US-only (just one rate) and add regions back later. There's no
> way around this on a no-server site — true per-country auto-pricing needs a backend.

### Syncing Immediately (Manual Sync)

A `works.json` change normally syncs within a minute of pushing. To force it (or to pull in
a Stripe craft change without waiting for the 6-hour timer):

1. Go to your GitHub repo → **Actions** tab
2. Click **"Sync Stripe Products"** on the left
3. Click **"Run workflow"** → **"Run workflow"**
4. Wait ~30 seconds, refresh your site!

### Print Images

Prints automatically use the artwork's own image from `works.json` — you never upload a
print photo to Stripe. For crafts/merch, the image you upload to Stripe is used.

---

## Orders (who bought what, and getting it shipped)

The **Orders** tab in your admin lists every purchase from the shop: what sold, what
they paid, and exactly where it goes. The green banner at the top is the total those
orders have made you.

### Nothing ever prints without you saying so

When a print sells and it's set up with Gelato, the website asks Gelato to **hold a
draft**. A draft costs nothing and prints nothing — it's just the order sitting there,
filled in and ready. You'll see it in Orders as **"Draft — awaiting your OK"** and the
row is tinted yellow.

The pills along the top — **All · Not started · Drafts · Printing · To post myself ·
Shipped · Cancelled** — show you one stage at a time, with a count on each. That's
what makes a batch easy:

1. Click **Not started**, tick the box in the table header to select them all, press
   **Prepare draft**.
2. Check them over in Gelato.
3. Click **Drafts**, tick the header box again, press **Send to print**.
4. Confirm — it names each piece and buyer so you can double-check before it goes.

Step 3 is the only thing that spends money. Before it, **Cancel draft** undoes
everything and nothing was ever made.

The buttons only light up when they can actually do something to what you've ticked,
and each shows how many rows it will affect — so *Send to print (4)* means four.

### Items you post yourself

If a piece doesn't have Gelato turned on, nothing goes to Gelato at all. You get an
email with the buyer's address and you ship it yourself.

### Letting the buyer know it's on the way

For Gelato orders this happens **by itself** — the moment Gelato ships, the buyer gets
an email from you with their tracking number. You'll see "buyer emailed" under the
tracking column.

For parcels you ship yourself: tick the row and press **Tell buyer it shipped**. It asks
you for a tracking number (leave it blank if there isn't one), shows you exactly who's
about to be emailed, then sends it and marks the order **Shipped** for you.

The email comes from *you*, in your words — the print company never contacts your
customers.

### Changing a status by hand

The **Status** column is a dropdown — click it and pick anything you like, for any row.
It's yours to override whenever the automatic status isn't quite right. Changed rows
turn yellow until you press **Save my changes**.

### The columns

| Column | What it's for |
|---|---|
| **Status** | Change it to anything you like — this is yours to control |
| **Gelato** | What Gelato says: `draft`, then printing, then shipped |
| **Tracking** | Paste a tracking number here for your own records |
| **Notes** | Anything you want to remember about this order |

Press **Save my changes** after editing Status, Tracking or Notes. **Refresh** re-checks
Stripe and Gelato for the latest.

### Turning Gelato on for a print

Open the work in the **Works** tab → **Print-on-demand (Gelato)** → tick
**Auto-prepare a Gelato order when this sells**, and paste in the Gelato product ID.
It's **off by default**, so nothing changes for your existing work until you switch it on.

> **Buyer addresses are private.** They live in Stripe and in your admin's private
> storage only — they're never written into the website's files.

---

## Updating Your Email & Social Links (Site-Wide!)

Your email and social links appear on every page. Edit them in ONE place and they update everywhere!

### Open `content/site-settings.json`:

```json
{
  "email": "kaylacarabesart@gmail.com",

  "socialLinks": [
    {
      "name": "Instagram",
      "url": "https://instagram.com/kayla_carabes"
    }
  ]
}
```

### To change your email:
Just change the `email` value.

### To add a new social link:
Add a new entry to the `socialLinks` array:

```json
"socialLinks": [
    {
      "name": "Instagram",
      "url": "https://instagram.com/kayla_carabes"
    },
    {
      "name": "Etsy",
      "url": "https://etsy.com/shop/yourshopname"
    },
    {
      "name": "TikTok",
      "url": "https://tiktok.com/@yourusername"
    }
  ]
```

**Don't forget:** Add a comma after each `}` except the last one!

### To remove a social link:
Just delete its entire `{ "name": "...", "url": "..." }` entry (and the comma before it if it's the last one)

---

## Updating Your Bio (About Page)

Open `about.html` and find this section:

```html
<!-- ✏️ EDIT YOUR BIO HERE -->
<p>
    Kayla Carabes is a talented cool awesome...
</p>
<!-- END BIO SECTION -->
```

Just change the text between the `<p>` and `</p>` tags. Each `<p>...</p>` is a paragraph.

**To add a new paragraph:**
```html
<p>
    Your new paragraph text here.
</p>
```

---

## Adding Blog Posts

### Open `content/blog.json`:

```json
{
  "posts": [
    {
      "id": "unique-post-id",
      "title": "Optional Title",
      "date": "2025-02-26",
      "images": [
        "assets/images/blog-image-1.webp",
        "assets/images/blog-image-2.webp"
      ],
      "content": "Your blog post text goes here..."
    }
  ]
}
```

**What each field does:**
- `id` - A unique identifier (use lowercase, dashes instead of spaces)
- `title` - Optional! Leave it out for posts without a title
- `date` - Format: `YYYY-MM-DD` (e.g., `2025-02-26` for Feb 26, 2025)
- `images` - A list of image paths (can be 1 or many!)
- `content` - Your post text

### Adding a New Blog Post

1. **Add your images** to `assets/images/` folder
2. **Open `content/blog.json`**
3. **Add a new entry at the TOP** of the posts list (newest first):

```json
{
  "posts": [
    {
      "id": "new-post",
      "date": "2025-03-01",
      "images": ["assets/images/new-image.webp"],
      "content": "My new blog post about this painting..."
    },
    {
      "id": "older-post",
      ...
    }
  ]
}
```

**Don't forget:** Add a comma after the `}` of your new post!

### Multiple Images

When you add multiple images, they display in a scattered/overlapping layout:

```json
{
  "id": "studio-update",
  "date": "2025-02-10",
  "images": [
    "assets/images/painting-1.webp",
    "assets/images/painting-2.webp",
    "assets/images/detail-shot.webp"
  ],
  "content": "Working on several pieces this week..."
}
```

Images are clickable - visitors can click to view full size.

### Posts With or Without Titles

**With title:**
```json
{
  "id": "drawing-with-light",
  "title": "Drawing with light",
  "date": "2025-02-17",
  "images": ["assets/images/blog-2.webp"],
  "content": "Turned this painting around and put it up to my window..."
}
```

**Without title (just date and content):**
```json
{
  "id": "forest-painting",
  "date": "2025-02-10",
  "images": ["assets/images/blog-1.webp"],
  "content": "Slowly chipping away at this forest painting..."
}
```

### Removing a Blog Post

Just delete the entire post entry from the list (including the comma before or after it).

---

## Changing the Contact Page Text

The email and social links on the contact page are automatically pulled from `content/site-settings.json` (see above).

To change the contact page message, open `contact.html` and find:

```html
<!-- ✏️ EDIT YOUR CONTACT INFO HERE -->
<p>
    Interested in working together...
</p>
```

Edit the text between `<p>` and `</p>` to say whatever you want.

---

## Changing Colors (For When You're Feeling Adventurous)

Open `assets/css/style.css` and look at the top:

```css
:root {
    --color-bg: #fafafa;           /* Background color */
    --color-text: #1a1a1a;         /* Main text color */
    --color-text-light: #666;      /* Secondary text */
    --color-accent: #1a1a1a;       /* Links, buttons */
    --color-border: #e5e5e5;       /* Subtle borders */
}
```

---

## Image Tips

You don't have to worry about resizing your photos before uploading anymore — the site
automatically generates smaller versions for you (see "Image Optimization" below).

- **Just upload the high-quality original** straight from your camera or phone. The site
  will serve smaller, faster versions to visitors automatically.
- **File formats:** JPG/JPEG for photos and paintings, PNG if you need transparency.
  Don't use HEIC (iPhone's default) — convert to JPG first.
- **Filenames:** lowercase, no spaces. Use dashes: `mountain-painting.jpeg`, not
  `Mountain Painting.jpg`.

---

## Image Optimization (How Your Site Stays Fast)

Big art photos are slow to load — a single 6 MB original can take seconds on phone
data. The site automatically generates small WebP copies of every image so visitors
see paintings immediately without you having to do anything.

### What happens automatically

When you push a new image to GitHub (e.g., you added a work in `works.json` that points
to `assets/images/your-new-piece.jpeg`), a workflow called **Optimize images** runs in
the background:

1. It reads each image referenced in `works.json`
2. It writes resized WebP copies into `assets/images/optimized/` at a few common widths (400, 800, 1200, 1600 pixels) plus a max-quality copy at the original size
3. It records each work's actual `aspectRatio` and the list of generated `widths` back into `works.json` (these fields are auto-managed — don't edit them by hand)
4. It commits those generated files back to the repo with the message `Auto-optimize images [skip ci]`

Your push → wait 30-60 seconds → you'll see a new commit appear from `github-actions[bot]`. That's it.

### "But what if I add an image and the workflow hasn't finished?"

The site still works! If a new image hasn't been optimized yet, the page just shows the
original full-size file (slower, but no broken images). Once the bot's commit lands,
visitors automatically get the fast versions.

### Running it locally (optional)

If you want to optimize images on your own machine before pushing — for example, to test
before committing — open the terminal in VSCode and run:

```
npm install     # only needed the very first time
npm run optimize-images
```

This generates the same files locally that the GitHub Action would generate. Then
`git add . && git commit -m "..." && git push` like usual.

### Troubleshooting

- **Workflow failed in GitHub Actions tab:** open the failed run, read the error. Usually
  it's a corrupt image file. Try re-saving/re-exporting the image and pushing again.
- **`aspectRatio` / `widths` look weird in `works.json`:** these are auto-generated. If
  you accidentally hand-edit them, the next workflow run will rewrite them correctly.

---

## Something Broke?

Don't panic! Here's what to do:

1. **Check for typos** - especially in `.json` files. A missing comma or quote will break it.

2. **Use a JSON validator** - Paste your file.json content into [jsonlint.com](https://jsonlint.com) to find errors.

3. **Call Jason :)** - I got u hb

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Images not showing | Check the filename matches exactly (case-sensitive!) |
| Page looks broken | You might have deleted a `<` or `>` in HTML |
| Works page is blank | Check `works.json` for missing commas or quotes |
| Blog page is blank | Check `blog.json` for missing commas or quotes |
| Blog images not scattered | Need 2+ images in the `images` array for scattered layout |
| Shop not updating | Run manual sync (Actions → Sync Stripe Products → Run workflow) |
| Print not showing / stuck "Sold out" | Set `printPrice` to a number > 0 on that work in `works.json`, push, wait ~1 min |
| Print price wrong | Edit `printPrice` on the work in `works.json` and push |
| Craft/merch not appearing | Check it's in `content/shop-items.json` with a `price` > 0 (and `stock` not 0), push |
| Commission link showing in shop | Remove the `shop` = `true` metadata flag from that payment link in Stripe |
| Changes not appearing | Did you push to GitHub? Wait 1-2 minutes. |

---

That's it! Welcome to Beep Boop the water's fine