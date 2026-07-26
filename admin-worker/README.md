# Admin Worker — setup

Backend for the `/admin` portal. It commits form changes to this repo and can
auto-post new work to Instagram. Deploy it once; after that Kayla only uses the
web form at `https://www.kaylacarabes.com/admin/`.

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

## 3. Instagram auto-post (optional, enable when ready)

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

Until these are set, the "Also post to Instagram" checkbox just publishes to the
site (the post step reports it's not configured — the commit still succeeds).

Notes / limits:
- The token is long-lived (~60 days) and must be refreshed periodically.
- Instagram only accepts JPEG at aspect ratios between 4:5 and 1.91:1. Very tall
  or very wide paintings will be rejected by Instagram (the commit still lands).
- It posts the original uploaded photo (no cropping or graphics generation).

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
const INQUIRIES_SHEET_ID = 'sheet_id'; // the separate "inquiries on originals" spreadsheet ID
const NOTIFY_EMAILS = ['kjcarabes@gmail.com', 'jrstarkman@gmail.com']; // who gets emailed on a new inquiry

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
  // Otherwise it's a form POST from the site (one URL for both, by design).
  var p = e.parameter || {};
  if (p.name || p.productTitle || p.phone || p.message) return logInquiry(p); // an inquiry
  // Plain newsletter signup (email only).
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow([p.email, p.timestamp || new Date().toISOString()]);
  return ContentService.createTextOutput('Success');
}

// A site inquiry → log to the inquiries sheet (8 cols) + email you.
function logInquiry(p) {
  var sheet = SpreadsheetApp.openById(INQUIRIES_SHEET_ID).getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Preferred Contact', 'Artwork', 'Product ID', 'Message']);
  sheet.appendRow([new Date(), p.name || '', p.email || '', p.phone || '', p.contactPreference || '', p.productTitle || '', p.productId || '', p.message || '']);
  var subject = p.productTitle ? ('New artwork inquiry: ' + p.productTitle) : 'New artwork inquiry';
  var body = 'New inquiry from your website!\n\n'
    + 'Artwork:   ' + (p.productTitle || '(not specified)') + '\n'
    + 'Name:      ' + (p.name || '') + '\n'
    + 'Email:     ' + (p.email || '(none)') + '\n'
    + 'Phone:     ' + (p.phone || '(none)') + '\n'
    + 'Preferred: ' + (p.contactPreference || '') + '\n\nMessage:\n' + (p.message || '(none)');
  var opts = {}; if (p.email) opts.replyTo = p.email;
  MailApp.sendEmail(NOTIFY_EMAILS.join(','), subject, body, opts);
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

## Local dev

`npx wrangler dev` runs the Worker locally; point the admin sign-in at the
`http://localhost:8787` URL it prints. `localhost` origins are already allowed
in `worker.js`.
