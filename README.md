# Undercut

Private tech deal hunter. Polls community deal feeds every minute, scores each
deal against learned price history, and pushes an iPhone when something
genuinely exceptional appears.

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Build log: `docs/PROGRESS.md`

## Local development

```bash
npm install
npx wrangler d1 create undercut-db          # once, paste the id into wrangler.toml
npx wrangler d1 execute undercut-db --local --file=./schema.sql
npx wrangler dev --port 8787
```

Tests: `npx vitest run`

## What you need before deploying

All free, all one-time.

1. **Reddit OAuth app.** reddit.com/prefs/apps, Create App, type `script`.
   Redirect URI can be `http://localhost`. Keep the client ID (under the app
   name) and the secret.
2. **eBay developer key.** developer.ebay.com, create a Production keyset.
   Keep the App ID (client ID) and Cert ID (client secret).
3. **VAPID keys.** `npm run vapid`, keep both lines it prints.
4. **A random `POLL_SECRET` and `SESSION_SECRET`.** Any long random strings.

## Deploy

```bash
npm run build:pages
npx wrangler pages project create undercut
npm run deploy:pages
npx wrangler d1 execute undercut-db --remote --file=./schema.sql
```

Bind D1 to the Pages project (dashboard, Pages, undercut, Settings, Functions,
D1 bindings): binding name `DB`, database `undercut-db`.

Set secrets on the Pages project (dashboard, Settings, Environment variables,
Production, Encrypt):

| Name | Value |
|---|---|
| `SESSION_SECRET` | long random string |
| `POLL_SECRET` | long random string, same one the pinger uses |
| `REDDIT_CLIENT_ID` | from step 1 |
| `REDDIT_CLIENT_SECRET` | from step 1 |
| `EBAY_CLIENT_ID` | from step 2 |
| `EBAY_CLIENT_SECRET` | from step 2 |
| `VAPID_PUBLIC_KEY` | from step 3 |
| `VAPID_PRIVATE_KEY` | from step 3, the whole JSON line |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `PUBLIC_ORIGIN` | `https://undercut.pages.dev` |

Redeploy after setting variables so they take effect.

Then deploy the pinger: `cron-pinger/DASHBOARD-PASTE.md`.

## Claim the instance immediately

**Until you set a password, anyone who finds the URL can claim it.** Open
`https://undercut.pages.dev` and set one as the very first thing after deploy.

## Turn on notifications

On the iPhone: open the site in Safari, Share, Add to Home Screen. Open it from
the home screen icon, not from Safari. Settings, Enable Push. iOS will not offer
push in a Safari tab at all.

## Diagnosing

Nothing arriving:

```bash
# Are sources being polled?
npx wrangler d1 execute undercut-db --remote --command "SELECT id, last_polled_at, last_success_at, last_status, consecutive_failures, enabled FROM sources"

# Are deals being stored and scored?
npx wrangler d1 execute undercut-db --remote --command "SELECT id, score, price_cents, title FROM deals ORDER BY last_seen_at DESC LIMIT 10"

# Were pushes attempted?
npx wrangler d1 execute undercut-db --remote --command "SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 10"
```

If `last_polled_at` is not advancing, the pinger is not running or its
`POLL_SECRET` does not match. If deals are stored but nothing pushes, either the
threshold is too high or there are no push subscriptions.

You can trigger a poll by hand. Compute the signature over `<sourceId>.<unix>`:

```bash
node -e 'const s=process.argv[1],id=process.argv[2],t=Math.floor(Date.now()/1000);const c=require("crypto");console.log(t, c.createHmac("sha256",s).update(id+"."+t).digest("hex"))' "$POLL_SECRET" reddit
```

then POST with `x-uc-timestamp` and `x-uc-signature`.
