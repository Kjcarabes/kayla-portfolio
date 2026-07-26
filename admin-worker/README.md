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

## Local dev

`npx wrangler dev` runs the Worker locally; point the admin sign-in at the
`http://localhost:8787` URL it prints. `localhost` origins are already allowed
in `worker.js`.
