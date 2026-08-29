# Admin Worker — setup

Backend for the `/admin` portal. It commits form changes to this repo and can
post work to Instagram and a Facebook page. Deploy it once; after that Kayla only
uses the web form at `https://www.kaylacarabes.com/admin/`.

## 1. GitHub token

Create a **fine-grained personal access token** (github.com → Settings →
Developer settings → Fine-grained tokens):

- **Repository access:** Only select repositories → `Kjcarabes/kayla-portfolio`
- **Permissions:** Repository → **Contents: Read and write**
- Copy the token (starts with `github_pat_…`).

## 2. Deploy the Worker

```
cd admin-worker
npx wrangler login          # one-time, opens Cloudflare auth
npx wrangler deploy         # publishes; prints the Worker URL
```

Then set the secrets (each prompts for the value, nothing is stored in git):

```
npx wrangler secret put GITHUB_TOKEN      # paste the fine-grained PAT
npx wrangler secret put ADMIN_PASSWORD    # the password Kayla will type
```

The Worker URL is baked into the admin (`WORKER_URL` at the top of
`admin/admin.js`) — currently `https://kayla-admin.bb69z8ddnz.workers.dev`. If
you ever redeploy under a different name, update that one constant. Kayla only
types her **password** on the sign-in screen.

`GH_OWNER` / `GH_REPO` / `GH_BRANCH` are already set in `wrangler.toml`.

## 3. Instagram posting (optional, enable when ready)

Uses **Instagram API with Instagram login** (Business/Creator account, no
Facebook Page). `IG_API_BASE` in `wrangler.toml` is already set to
`graph.instagram.com` for this path.

Getting the two values, in the Meta app dashboard → **Instagram → API setup with
Instagram business login**:

1. Make sure the IG account is a **Business/Creator** account and has **accepted
   the tester invite** (Instagram app → Settings → Apps and websites → Tester
   invites → Accept).
2. Under **"Generate access tokens"**, click **Generate token** for the account,
   authorize — copy the **short-lived** token.
3. **IG user ID:** open in a browser →
   `https://graph.instagram.com/me?fields=user_id,username&access_token=SHORT_TOKEN`
   The `user_id` it returns is `IG_USER_ID`.
4. **Token lifetime:** the dashboard's "Generate token" button already returns a
   **long-lived (~60-day) token** — use it directly as `IG_ACCESS_TOKEN`, no
   exchange step needed. Verify expiry at
   developers.facebook.com/tools/debug/accesstoken (paste the token; "Expires"
   should be ~60 days out). Only if you have a genuinely *short-lived* token do
   you exchange it, and it must use the **Instagram** app secret (Instagram → API
   setup), not the Facebook app secret:
   `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=INSTAGRAM_APP_SECRET&access_token=SHORT_TOKEN`

```
npx wrangler secret put IG_USER_ID
npx wrangler secret put IG_ACCESS_TOKEN
```

Until these are set, the admin shows the Instagram tick box greyed out as "not
set up yet" and only publishes to the site.

Notes / limits:
- The token is long-lived (~60 days) and must be refreshed periodically.
- Instagram only accepts JPEG at aspect ratios between 4:5 and 1.91:1. Very tall
  or very wide paintings will be rejected by Instagram (the commit still lands).
- It posts the original uploaded photo (no cropping or graphics generation).

## 3b. Facebook page posting (optional)

Separate from Instagram above and independent of it — a page post always goes
through `graph.facebook.com` with a **page** access token, whichever Instagram
path is in use. Set up either, both, or neither.

You need two values: `FB_PAGE_ID` and a **page** access token. There are two ways
to get them — the system-user route (B) is fewer steps and the token never
expires, so prefer it unless the page isn't in a business portfolio.

**The page ID on its own** (either route): Meta Business Suite → **Settings →
Pages**, or on the page itself **About → Page transparency**. It's a long number.

### Route A — Graph API Explorer

The Explorer is a **separate tool, not part of the app dashboard**:
[developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer/).
The "Generate access tokens" panel inside *Instagram → API setup* is Instagram-only
and has nothing to do with pages — that's the usual wrong turn.

1. In the Explorer's right-hand panel: **Meta App** → pick your app. Below it is
   the **User or Page** dropdown → **Get User Access Token** (older layouts show
   a **Get Token** button with the same menu under it).
2. Tick `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` in the
   permissions list → **Generate Access Token** → authorize, and make sure the
   page is ticked on Meta's consent screen.
3. If the app has no page permissions to tick at all, it was created as an
   Instagram-only app. In the app dashboard add the use case **"Manage everything
   on your Page"** (or create a new **Business**-type app for this), then come
   back to step 1.
4. **Make the user token long-lived — do this before reading the page token.**
   A page token inherits its lifetime from the user token it was read with, and
   there is no way to extend a page token after the fact:
   ```
   curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=USER_TOKEN"
   ```
   - `APP_ID` / `APP_SECRET` — app dashboard → **App settings → Basic**. Use the
     **Facebook** app secret, not the Instagram one from §3 (the app has both).
   - `USER_TOKEN` — the one in the Explorer's Access Token box, **not** a page
     token. Exchanging a page token here is the usual mistake.

   Returns `{"access_token":"…","expires_in":5183944}` — a ~60-day user token.
5. **Page ID + page token:** run `GET /me/accounts` in the Explorer *with the
   long-lived token from step 4* pasted into the Access Token field (or
   `curl "https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN"`).
   Each entry has an `id` (`FB_PAGE_ID`) and an `access_token` — that one is
   `FB_PAGE_TOKEN`, and it doesn't expire.

### Route B — system user (no Explorer, token never expires)

In [business.facebook.com/settings](https://business.facebook.com/settings) (Meta
Business Suite → Settings → **Business settings**):

1. **Users → System users → Add** — name it anything ("website poster"), role
   **Employee**.
2. **Assign assets** → **Pages** → pick the page → **Full control** (or at least
   "Create content"). Also assign the **app** under Assets → Apps.
3. **Generate new token** → pick the app → tick `pages_manage_posts`,
   `pages_read_engagement`, `pages_show_list` → **Generate**. Copy it now; Meta
   shows it once. That token doesn't expire.

### Either route

Verify at [developers.facebook.com/tools/debug/accesstoken](https://developers.facebook.com/tools/debug/accesstoken)
— paste the token; it should say **Expires: Never** and list the page permissions.

```
npx wrangler secret put FB_PAGE_ID
npx wrangler secret put FB_PAGE_TOKEN
```

Notes / limits:
- **"Error validating access token: Session has expired on …"** means the stored
  page token came from a *short-lived* user token — Explorer tokens die after
  ~1–2 hours, at the top of the hour. There's no fixing it after the fact: redo
  route A from a fresh user token (exchange first, *then* read `/me/accounts`),
  or use route B. Checking the debugger says **Expires: Never** before running
  `wrangler secret put` catches this every time.
- The app needs to be **Live** (not in Development mode) for the post to appear
  publicly, and `pages_manage_posts` requires App Review unless you're posting to
  a page you administer with a token you generated yourself — which is this case.
- Facebook accepts JPEG and PNG, and doesn't have Instagram's aspect-ratio rule,
  so tall or wide paintings that Instagram rejects still post fine here.
- Posting a photo also puts it in the page's Photos album — that's how the Graph
  API works, there's no "post without album" option.

## 3c. Sharing a work that's already on the site

The **Share** button on any row in the admin's Works tab opens the same tick
boxes and a caption, and posts the photo immediately (`POST /api/social-post`) —
no commit, nothing changes on the site. It only works for photos already
committed; a photo added but not yet published is blocked with a note to publish
first, because Instagram and Facebook fetch the image from
`raw.githubusercontent.com` themselves.

## 4. Newsletter sending (optional)

Lets Kayla compose a message in the admin **Newsletter** tab that emails every
subscriber, shows her the recipient list first, and gives each email a one-click
**unsubscribe link** (which opens a confirmation page).

**IMPORTANT — you already have a `doPost` (the signup handler).** An Apps Script
can only have ONE `doPost`, so don't paste a second one. Instead, **replace your
whole script** with the merged version below — it keeps your exact signup
behavior *and* adds newsletter send + subscriber list + unsubscribe, all through
the one Web App you already have.

1. Open the signups Google Sheet → **Extensions → Apps Script**.
2. **Select all, delete, and paste the script below.** Set `SEND_SECRET` to a long
   random string. Save.
3. **Re-deploy the SAME web app** so the URL doesn't change: Deploy → Manage
   deployments → your web app → ✏️ Edit → Version: **New version** → Deploy.
   Make sure *Who has access* is **Anyone** (so recipients can open the
   unsubscribe link without signing in).
4. Worker secrets (secrets apply immediately, no redeploy):
   ```
   npx wrangler secret put NEWSLETTER_SEND_URL      # same /exec URL as your signup form
   npx wrangler secret put NEWSLETTER_SEND_SECRET   # same string as SEND_SECRET
   ```
   `NEWSLETTER_SEND_URL` is literally the URL already in
   `content/site-settings.json` → `newsletter.formAction`.

No triggers needed — unsubscribe is handled by the link (`doGet`), and the admin
pulls the recipient list on demand. Unsubscribes are recorded in **column C**;
`collectEmails` skips them.

```js
// Signups + Newsletter + subscriber list + link unsubscribe.
// ONE doPost + ONE doGet, bound to the signups Sheet.
const SEND_SECRET = 'PUT_A_LONG_RANDOM_STRING_HERE'; // must match NEWSLETTER_SEND_SECRET
const FROM_NAME = 'Kayla Carabes';
const INQUIRIES_SHEET_ID = 'sheet_id'; // the separate "inquiries on originals" spreadsheet ID (for the admin's Leads tab)

function doPost(e) {
  // Newsletter actions = a JSON body carrying the secret (from the Worker).
  var payload = null;
  try { payload = JSON.parse(e.postData.contents); } catch (err) {}
  if (payload && payload.secret) {
    if (payload.secret !== SEND_SECRET) return json({ ok: false, error: 'unauthorized' });
    if (payload.action === 'list') return json({ ok: true, emails: collectEmails() });
    if (payload.action === 'inquiries') return listInquiries();
    return sendNewsletter(payload);
  }
  // Otherwise it's a newsletter signup from the site form.
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow([e.parameter.email, e.parameter.timestamp || new Date().toISOString()]);
  return ContentService.createTextOutput('Success');
}

// Unsubscribe links land here (GET). The confirm step avoids accidental
// unsubscribes from email apps that pre-fetch links.
function doGet(e) {
  if (e.parameter.action !== 'unsubscribe') return HtmlService.createHtmlOutput('OK');
  var email = String(e.parameter.e || '').toLowerCase();
  if (!email || sign(email) !== String(e.parameter.t || '')) {
    return page('Invalid link', 'This unsubscribe link is invalid.');
  }
  if (e.parameter.confirm === '1') {
    markUnsubscribed(email);
    return page('Unsubscribed', 'You have been unsubscribed and won’t receive any more emails.');
  }
  var url = ScriptApp.getService().getUrl() + '?action=unsubscribe&e=' + encodeURIComponent(email) + '&t=' + sign(email) + '&confirm=1';
  return page('Unsubscribe?', 'Unsubscribe <b>' + escapeHtml(email) + '</b> from the newsletter?<br><br><a class="btn" href="' + url + '">Unsubscribe</a>');
}

function sendNewsletter(req) {
  if (!req.subject || !req.body) return json({ ok: false, error: 'missing subject or body' });
  var emails = collectEmails();
  var esc = String(req.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  var base = ScriptApp.getService().getUrl();
  emails.forEach(function (to) {
    var link = base + '?action=unsubscribe&e=' + encodeURIComponent(to) + '&t=' + sign(to);
    var htmlBody = esc + '<br><br>&mdash;<br><span style="color:#888;font-size:12px">'
      + 'You signed up at kaylacarabes.com. <a href="' + link + '">Unsubscribe</a>.</span>';
    MailApp.sendEmail({ to: to, subject: req.subject, htmlBody: htmlBody, name: FROM_NAME });
  });
  return json({ ok: true, sent: emails.length });
}

// Emails from column A, skipping rows marked unsubscribed in column C.
function collectEmails() {
  var rows = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getDataRange().getValues();
  var seen = {};
  rows.forEach(function (row) {
    var email = String(row[0] || '').trim().toLowerCase();
    if (!String(row[2] || '').trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) seen[email] = true;
  });
  return Object.keys(seen);
}

// Return the inquiries sheet rows, and auto-add any new inquiry email to the
// mailing list (skips emails already present — including unsubscribed ones).
function listInquiries() {
  if (!INQUIRIES_SHEET_ID || INQUIRIES_SHEET_ID.indexOf('PUT_') === 0) return json({ ok: false, error: 'INQUIRIES_SHEET_ID not set' });
  var rows = SpreadsheetApp.openById(INQUIRIES_SHEET_ID).getSheets()[0].getDataRange().getValues();
  var sign = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var existing = {};
  sign.getDataRange().getValues().forEach(function (r) {
    var e = String(r[0] || '').trim().toLowerCase(); if (e) existing[e] = true;
  });
  var added = 0;
  rows.forEach(function (row, idx) {
    if (idx === 0) return; // header row
    row.forEach(function (cell) {
      var e = String(cell || '').trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !existing[e]) {
        sign.appendRow([e, new Date().toISOString(), '', 'from inquiry']);
        existing[e] = true; added++;
      }
    });
  });
  return json({ ok: true, rows: rows, added: added });
}

function markUnsubscribed(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][0]).trim().toLowerCase() === email) {
      sheet.getRange(r + 1, 3).setValue('unsubscribed ' + new Date().toISOString());
    }
  }
}

// Signed token so a link only unsubscribes its own address (not guessable).
function sign(email) {
  var raw = Utilities.computeHmacSha256Signature(String(email).toLowerCase(), SEND_SECRET);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function page(title, msg) {
  var html = '<style>body{font-family:Georgia,serif;max-width:480px;margin:14vh auto;padding:0 1.5rem;'
    + 'text-align:center;color:#1a1a1a}h1{font-size:1.5rem;margin-bottom:1rem}'
    + 'a.btn{display:inline-block;padding:.7rem 1.4rem;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px}</style>'
    + '<h1>Kayla Carabes</h1><p>' + msg + '</p>';
  return HtmlService.createHtmlOutput(html).setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

Limits / notes:
- **Gmail quota:** ~100 recipients/day on a free @gmail account, ~1,500/day on
  Google Workspace. Fine for a small list; move to a real email service
  (Buttondown, Mailchimp) if it grows.
- Each email includes a signed one-click **unsubscribe** link → confirmation page
  → recorded in column C and skipped on future sends. Add a mailing address to
  the footer to fully satisfy CAN-SPAM as the list grows, or switch to an ESP.

## 5. Orders + Gelato fulfilment (optional)

Powers the admin **Orders** tab and the automatic staging of print orders.

**Nothing ever prints by itself.** When a print sells, the Worker asks Gelato to
hold a **draft** — no production, no charge. The draft shows up in the Orders tab
and only turns into a real print when Kayla presses **Send to print**. Items with
the Gelato toggle off never touch Gelato at all; she just gets an email with the
buyer's address.

### Secrets

```
npx wrangler secret put STRIPE_SECRET_KEY      # same live key the sync Action uses
npx wrangler secret put GELATO_API_KEY         # Gelato dashboard → Developers → API keys
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # from step 3 below (starts whsec_)
```

Order state (Kayla's manual status / tracking / notes) is stored in the existing
private `SALES` KV namespace under the key `orders`. Bind a dedicated `ORDERS`
namespace instead if you'd rather keep them apart — the Worker prefers `ORDERS`
when it exists. **Customer addresses live only in KV and Stripe, never in the
repo.**

### Stripe webhook

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**.
2. URL: `https://kayla-admin.bb69z8ddnz.workers.dev/stripe-webhook`
3. Event: **`checkout.session.completed`** (that one only).
4. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET` above.

The Worker verifies Stripe's HMAC signature and rejects anything older than five
minutes, so the endpoint can't be spoofed or replayed even though it sits outside
the admin password gate.

### Stripe customer receipts

Separately, turn on Stripe → **Settings → Customer emails → Successful payments**.
The payment links carry no email configuration of their own, so with that toggle
off buyers get *no* email at all — just Stripe's hosted confirmation page. Past
payments can be receipted retroactively: Payments → open the payment → **Send
receipt**.

### Gelato webhook (tells the buyer their order shipped)

Gelato is white-label and emails nobody, so without this the buyer hears nothing
between the Stripe receipt and a parcel arriving.

1. Invent a long random token (`openssl rand -hex 32`) and store it:
   ```
   npx wrangler secret put GELATO_WEBHOOK_TOKEN
   ```
2. Gelato dashboard → **Developers → Webhooks** → add the endpoint:
   - **URL** `https://kayla-admin.bb69z8ddnz.workers.dev/gelato-webhook`
   - **Method** `POST`
   - **Authorization** — tick it and supply the same token. Whatever field shape
     Gelato offers, the Worker accepts it: `Bearer <token>`, HTTP Basic with the
     token as either the username or the password, or a bare token with no scheme.
   - If you'd rather not use the Authorization box, append `?token=<token>` to the
     URL instead — that works too.
3. Subscribe to **`order_status_updated`**.

Gelato doesn't sign its webhooks, so this shared token *is* the authentication —
treat it like a password. Without it, anyone who guessed the URL could POST a fake
"shipped" event and make the Worker email your customers. On a `shipped` status the
Worker emails the buyer their tracking number (once — it records
`trackingEmailedAt`) and updates the Orders row.

If a webhook is ever missed, tracking is also picked up whenever the Orders tab
refreshes, and **Email tracking to buyer** in that tab sends it by hand. That button
works for parcels Kayla posts herself too: type the tracking number into the row,
**Save my changes**, then press it.

### Per-item setup

In `/admin` → **Works** (or **Shop**) → open the item → **Print-on-demand (Gelato)**:

- **Auto-prepare a Gelato order when this sells** — off by default.
- **Gelato product ID** — the `productUid`. Orders can only be placed against a
  productUid; a *template* (what you build in Gelato's product editor) can't be
  ordered directly. Each template variant carries a productUid, so paste the
  template ID into the **Look up** box under the field and pick the size you sell.
  `npm run gelato -- --template <id>` does the same from the terminal, and
  `--catalog` browses Gelato's stock catalogue if you have no template.
- **Print file** — optional for prints (defaults to the artwork photo); **required**
  for crafts, since a photo of a tote is not the tote's artwork.

### Notification email (optional — skip it and everything else still works)

Everything above runs on Worker secrets alone. Apps Script is only needed for the
heads-up email to Kayla; without it, orders still stage, still show in the Orders
tab, and are still approved from there — she just has to look rather than be told.

> ⚠️ **Do the script edit BEFORE setting `ORDER_NOTIFY_URL`.** The Apps Script's
> `doPost` ends with `return sendNewsletter(payload)`, so any action it doesn't
> recognise falls through and mails the **entire mailing list**. The Worker
> therefore refuses to send order emails until `ORDER_NOTIFY_URL` exists — that
> secret is your confirmation that the script below is deployed. Never point it at
> an Apps Script that lacks the `notify` branch.

Add these pieces to the Apps Script from step 4 so the Worker can send Kayla a
single-recipient email. In `doPost`, just above `return sendNewsletter(payload);`:

```js
    if (payload.action === 'notify') return notifyOne(payload);
    // Anything else with an action is a mistake, NOT a newsletter. Without this
    // line an unrecognised action falls through and mails every subscriber.
    // (The real newsletter send carries no `action`, so it still works.)
    if (payload.action) return json({ ok: false, error: 'unknown action: ' + payload.action });
```

and anywhere below, a new function:

```js
// Single-recipient email: order alerts to Kayla, shipping notices to buyers.
// `p.html` is optional — buyer emails send both a styled HTML body and a plain
// text fallback; Kayla's own alerts send text only.
function notifyOne(p) {
  var opts = { name: FROM_NAME };
  if (p.html) opts.htmlBody = p.html;
  if (p.replyTo) opts.replyTo = p.replyTo; // dashboard replies: the customer's answer goes to Kayla's inbox
  GmailApp.sendEmail(p.to, p.subject, p.body, opts);
  return json({ ok: true });
}
```

The `replyTo` line matters for the admin **Inquiries** tab: replies Kayla sends from
there go out through this same function, and without it a customer who hits
"Reply" writes back to the Sheet owner's address rather than
`kaylacarabesart@gmail.com`.

To send from `kaylacarabesart@gmail.com` instead of the Sheet owner's address, add
`from: 'kaylacarabesart@gmail.com'` to `opts` — but read "About the From address"
below first; it needs a verified alias *and* a re-authorisation.

(`MailApp.sendEmail({to, subject, body, htmlBody, name})` works identically and
needs no extra OAuth scope, if you'd rather avoid `GmailApp`.)

**About the From address.** Apps Script sends as the Google account that owns the
signups Sheet — which is *not* kaylacarabesart@gmail.com. Recipients see
`Kayla Carabes <owner@gmail.com>`: the same thing newsletter subscribers already
see, so it's consistent, and `MailApp` above needs nothing set up.

If you want the address itself to read `kaylacarabesart@gmail.com`, it takes two
steps and **both are required** — doing only the second throws
`Exception: Invalid argument: from` and Apps Script returns an HTML error page:

1. In the **owning** account: Gmail → Settings → **Accounts and Import → Send mail
   as → Add another email address** → `kaylacarabesart@gmail.com` → Google mails a
   code to that inbox → confirm. Check it took by running
   `Logger.log(GmailApp.getAliases())` in the editor; the address must be listed.
2. Only then swap `MailApp` for `GmailApp`:
   ```js
   GmailApp.sendEmail(p.to, p.subject, p.body, { name: FROM_NAME, from: 'kaylacarabesart@gmail.com' });
   ```
   `GmailApp` also needs a **wider OAuth scope** than `MailApp`. After switching,
   run any function once from the editor to trigger the new consent prompt, accept
   it, *then* re-deploy a new version — otherwise the web app keeps failing with
   the old scopes.

**Don't transfer the Sheet** to solve this. Re-deploying under another account
issues a NEW `/exec` URL, and that URL is the live newsletter signup endpoint in
`content/site-settings.json` as well as `NEWSLETTER_SEND_URL` / `ORDER_NOTIFY_URL`.
Signups break until all three are updated — a lot of risk for a From address.

Buyers see `Kayla Carabes <that address>`. **Gelato is never mentioned and never
emails your customers** — the only external link in the email is the carrier's
tracking URL.

Re-deploy the web app as a **New version** (same URL), then and only then:

```
npx wrangler secret put ORDER_NOTIFY_URL   # the same /exec URL as NEWSLETTER_SEND_URL
```

Test it by placing a cheap real order, or by temporarily pointing `ORDER_NOTIFY_URL`
at the script and hitting `/stripe-webhook` — if the wrong thing goes out, it goes
out to every subscriber, so verify the `notify` branch is live first.

### Command line

The same fulfilment logic is available locally for backlogs and one-offs — see the
header comment in `scripts/gelato-orders.js`:

```
npm run gelato                          # list every paid order + its state (read-only)
npm run gelato -- --plan                # show the exact Gelato payloads
npm run gelato -- --live                # stage them as drafts (nothing prints)
npm run gelato -- --drafts              # list drafts awaiting approval
npm run gelato -- --approve all --live  # send reviewed drafts to print
npm run gelato -- --catalog poster      # find productUids
```

Needs `STRIPE_SECRET_KEY` and `GELATO_API_KEY` in `.env` (gitignored).

## 6. Site forms → the Inquiries tab

The site's inquiry modal (originals), the **contact page** message form and the
newsletter signups all post to the Worker (`POST /forms/inquiry`,
`POST /forms/newsletter` — public, no password) instead of straight to Google. The
Worker keeps every entry in private KV first, forwards to the same Apps Script
URLs in `content/site-settings.json` (read from the live site, so editing them
there is enough), and returns a real yes/no — the page only says "Sent!" when it was.

**Inquiries** land in the admin's Inquiries tab, grouped by source (`original`,
`contact`, `other`), with To do / Done / Delete and a **Reply** button. Reply opens
with a draft written for that inquiry by Claude (`POST /api/inquiry-draft`, needs
the `ANTHROPIC_API_KEY` secret; a plain template otherwise) and sends through the
`notify` Apps Script (`POST /api/inquiry-reply`) with the signature appended and
`replyTo` set to the site's public email. The Worker also emails Kayla about every inquiry, to the
`email` in `site-settings.json` — so the inquiries Sheet's own `MailApp.sendEmail`
line should be **deleted** (it mails the Sheet owner's inbox, and she'd get two).

Newsletter signups that failed to reach the Sheet show as a warning in the
Newsletter tab (they're the mailing list, so they need adding by hand).

Bot filtering: the request's `Origin` must be the site, a hidden honeypot field must
be empty, and each IP gets 10 submissions per hour per form. `SITE_URL` in
`wrangler.toml` is where it reads `site-settings.json` from. Blank out
`formsRelayUrl` in `site-settings.json` and the site goes back to posting directly.

## 7. Opportunity finder + job watcher (Claude Code routines)

Two **scheduled cloud routines** (claude.ai/code/routines) search the web for art
opportunities / jobs that fit Kayla and add them to a dedicated Google Calendar.
Their prompts are `agents/opportunity-finder.md` and `agents/job-watcher.md`; the
profile they read and the "not interested" list are `content/opportunities.json`,
edited in the admin's **Calendar** tab, which also embeds the calendar.

Routine IDs: finder `trig_015xYnXohxD62S4JTYabBfR5` (Mon 9am Seattle), job watcher
`trig_013aQa9cgiobCWoymt43nQyE` (every 2 days, 8am). Manage at claude.ai/code/routines.

Guardrails — what is actually enforced vs. what is only asked for:

- **Calendar connector is list/create only** (`permitted_tools` on the routine's
  `mcp_connections`: `list_calendars, list_events, get_event, create_event`). There is
  no update/delete tool in the session at all — this is a real wall.
- **The connector's Google account only sees one calendar**: a throwaway Google
  account that has "Kayla — Opportunities" shared to it with "make changes to
  events". Even the full Calendar OAuth scope then covers exactly one calendar.
- **No Gmail connector** → it cannot send mail. Google's per-calendar notifications
  ("new events" + 14/3-day reminders) do the emailing.
- **No repository access at all.** The routines have no git source; they fetch
  `agents/*.md` and `content/opportunities.json` / `about.json` / `works.json` from
  the **live site** (GitHub Pages serves the whole repo). The Claude GitHub App is
  not needed and should stay uninstalled — nothing Claude does can reach the repo.
  Consequence: a change to those files takes effect after the next push + Pages
  deploy (Kayla's admin Publish does exactly that).
- **Prompt-level:** one named calendar, create-only, per-run safety ceiling
  (`limits.maxNewEventsPerRun` 20; `maxNewEventsFirstRun` 40 for the first backlog —
  ceilings, not targets; soonest deadlines win, the rest resurface next run), stop
  after two tool errors, never invent. The first test run proved the stop rules work:
  with page fetches blocked it created nothing and reported why.
- **Network:** the cloud environment's default "Trusted" egress policy blocks
  `WebFetch` for arts-org sites, and the routine refuses to add anything it couldn't
  open. The environment (claude.ai/code → environments → Default) must allow general
  web access, or the routine can search but never verify.
- **State:** the calendar itself is the "seen" list (the routine lists existing
  events before adding) plus `notInterested` in the JSON. Nothing is written to KV or
  the repo by the routine.
- **Cadence:** finder weekly (Mon 9am Seattle = `0 16 * * 1` UTC), job watcher every
  2 days. Model `claude-sonnet-5`. Usage draws on Jason's Claude subscription, not an
  API key; runs are visible as sessions at claude.ai/code.

Setup: connect the **Google Calendar** connector at claude.ai/customize/connectors (signed
in to the Google account that owns the calendar), create the calendar per the
Calendar tab's instructions, paste its ID, Publish. Then create the routines with
the saved prompt "Fetch https://www.kaylacarabes.com/agents/opportunity-finder.md
(or `job-watcher.md`) and follow it exactly" and no repository source. Trigger one manual run and read its transcript before trusting
the schedule.

## Local dev

`npx wrangler dev` runs the Worker locally; point the admin sign-in at the
`http://localhost:8787` URL it prints. `localhost` origins are already allowed
in `worker.js`.
