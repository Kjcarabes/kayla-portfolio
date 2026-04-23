# How to Edit Your Portfolio Website

Heyyyyy HB. This guide will help you update your website. Don't worry - you are a coder now 
ദ്ദി ˉ͈̀꒳ˉ͈́ )✧

---

## Before You Start Editing

**Always pull the latest changes first!** The shop syncs automatically from Stripe, so the code may have changed since you last worked on it.

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
| Add/remove shop products | Stripe Dashboard (syncs automatically!) |
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

To link a shop product to an artwork, add `workId` metadata in Stripe (see Shop section below).

### Descriptions on Shop Cards

The **Stripe product description** is shown prominently on the shop card, right next to the price. It's one of the first things a shopper reads, so keep it short and punchy — a phrase or short sentence, not a paragraph. Example: `"Signed giclée, 11x14"` or `"Open edition"`.

- Shop cards use the **Stripe product description only** — they do *not* fall back to the linked work's description.
- If you leave a product's Stripe description blank, no description shows on the shop card for that product.
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
  "heroFeature": true
}
```

**What each field does:**
- `description` = artistic statement about the piece (shown on the work detail page only — shop cards use the Stripe product description)
- `medium` = technical details like materials and size (shown everywhere: work detail page, shop cards, etc.)
- `featured: true` = shows in "Selected Work" grid on homepage
- `heroFeature: true` = shows in the big hero slideshow at top of homepage
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

## Managing Your Shop (Automatic Stripe Sync!)

Your shop syncs automatically with Stripe every 6 hours. **No need to edit any files** - just manage products in Stripe and they appear on your website!

### Adding a Product

1. Log into [dashboard.stripe.com](https://dashboard.stripe.com)
2. Go to **Payment Links** → Click **+ New**
3. Fill in the product details:
   - **Product name**: e.g., "Mountain Print 11x14"
   - **Price**: e.g., $35.00
   - **Image**: Upload a photo (this shows on your website!)
   - **Description**: short text that appears on the shop card next to the price (e.g., "Signed giclée, 11x14"). Keep it short — a phrase or short sentence. Leave blank to show no description on the card.

4. **Set the category**:
   - Scroll down and click **"Additional options"**
   - Click **"Add metadata"**
   - Add: Key = `category`, Value = `Originals`, `Prints`, or `Crafts`

5. **Link to a work** (Optional but recommended!):
   - In the same metadata section, add another entry
   - Add: Key = `workId`, Value = the ID of the artwork (e.g., `sparkle-face`)
   - This makes the product appear on that Work detail page!
   - Find artwork IDs in `content/works.json`

6. **For limited items** (originals, limited editions):
   - Click "Advanced options"
   - Enable **"Limit the number of payments"**
   - Set the limit (1 for one-of-a-kind originals, or your edition size for limited prints)

7. Click **Create link** - Done!

Your product will appear on your website within 6 hours (or sync manually - see below).

### Originals don't need Stripe at all

Every work in `content/works.json` is automatically treated as an available original. Nothing to create in Stripe — the Originals tab on the shop populates from works.json directly.

To mark an original's availability, add an **optional** `originalStatus` field to the work:

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

Visitors click **Contact me** on available originals; that opens the inquiry modal and emails you. You don't handle money through the site for originals.

### Syncing Immediately (Manual Sync)

Don't want to wait 6 hours?

1. Go to your GitHub repo
2. Click **Actions** tab
3. Click **"Sync Stripe Products"** on the left
4. Click **"Run workflow"** → **"Run workflow"**
5. Wait ~30 seconds, refresh your site!

### Metadata Tips

The sync is forgiving with metadata:
- `category`, `Category`, or `CATEGORY`
- `prints`, `Prints`, `print`, `Print`
- `crafts`, `craft`, `Crafts`
- If you forget the category, it defaults to "Prints"
- `workId`, `workid`, `WorkId`, or `work_id`

> Note: `category: Originals` in Stripe is ignored. Originals come from `works.json` (see "Originals don't need Stripe at all" above).

### When Something Sells Out

- Stripe automatically stops accepting payments when payment limit is reached
- The item will automatically show as "Sold" on your site after the next sync
- To remove a sold item entirely, delete the payment link in Stripe

### Removing a Product

- **Delete** the Payment Link in Stripe to remove it from your site entirely
- **Deactivate** the Payment Link to keep it visible but show "Sold"

### Product Images

If a product is linked to a work (via `workId`), it automatically uses that work's image from your `assets/images/` folder. No need to upload to Stripe!

If no work is linked, the image you upload to Stripe is used instead.

---

## Updating Your Email & Social Links (Site-Wide!)

Your email and social links appear on every page. Edit them in ONE place and they update everywhere!

### Open `content/site-settings.json`:

```json
{
  "email": "kjcarabes@gmail.com",

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
| Product not appearing | Check Payment Link is active in Stripe, wait for sync |
| Wrong category | Edit product metadata in Stripe, run sync |
| Changes not appearing | Did you push to GitHub? Wait 1-2 minutes. |

---

That's it! Welcome to Beep Boop the water's fine