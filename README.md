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

1. **eBay developer key.** developer.ebay.com, create a Production keyset.
   Keep the App ID (client ID) and Cert ID (client secret). Then, next to the
   App ID, open **Notifications** and toggle **"Exempted from Marketplace
   Account Deletion"** on, choosing "I do not persist eBay data" — eBay
   disables Production keysets that skip this, and a disabled keyset fails
   auth with a plain `401 invalid_client`, no hint that compliance is the
   cause.
2. **VAPID keys.** `npm run vapid`, keep both lines it prints.
3. **A random `POLL_SECRET` and `SESSION_SECRET`.** Any long random strings.

Reddit needs no credentials — Reddit closed self-serve OAuth app registration
in November 2025 (a manual, ticketed, no-guaranteed-turnaround process now),
so this reads Reddit's public `new.rss` feed instead, which needs no key at
all. Trade-off: no upvote/comment signal from Reddit, which only ever fed the
optional "heat" score component.

**Woot is disabled by default.** Its RSS feed is dead site-wide (discontinued
long ago); the adapter now reads Woot's real developer API instead, but that
needs an API key requested via the Woot forums and issued weekly, not
self-serve. To enable it once you have a key: set `WOOT_API_KEY` as a Pages
secret, then `UPDATE sources SET enabled = 1 WHERE id = 'woot'`.

**eBay searches its own query list, not the watchlist.** `sources.config_json`
for the `ebay` row holds `{"queries": [...], "cursor": N}` — one query per
poll, cycling through the list. There's no UI for this yet; set it directly:
`UPDATE sources SET config_json = '{"queries":["term one","term two"],"cursor":0}' WHERE id = 'ebay'`.
Keep these broad (category-level) — the watchlist table is for the opposite
case: narrow, specific things you want an instant alert on *regardless of
score* (its terms match if every word appears anywhere in a deal's title, so
broad multi-word terms there catch a lot of false positives — "graphics card"
matched a baseball card whose seller was "Perma-Graphics" selling "Credit
Cards").

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
| `EBAY_CLIENT_ID` | from step 1 |
| `EBAY_CLIENT_SECRET` | from step 1 |
| `VAPID_PUBLIC_KEY` | from step 2 |
| `VAPID_PRIVATE_KEY` | from step 2, the whole JSON line |
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
