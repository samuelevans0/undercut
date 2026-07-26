# Undercut — design spec

**Date:** 2026-07-25
**Status:** Approved (core system and product surface both signed off)
**Owner:** Samuel Evans

## 1. Problem

A 240Hz monitor was marked down roughly $100 to about $60 and Samuel found out
after it was gone. Deals of that quality surface in public feeds and die within
minutes. Nothing he currently uses watches those feeds continuously or knows
enough about normal prices to recognise an outlier when it appears.

Undercut is a private, single-user tech deal hunter. It watches deal feeds
continuously, scores every deal against what that class of hardware normally
costs, and pushes his iPhone the moment something genuinely exceptional shows
up.

## 2. Goals

- Notice an exceptional deal and deliver a push within roughly 60 seconds of it
  being posted.
- Judge deals against learned price history, not just an advertised discount, so
  a real outlier is distinguishable from marketing.
- Never fail silently. A source that stops working must announce itself.
- Fit entirely inside free tiers.

## 3. Non-goals

- Multi-user. Single user, password gated, no signup.
- Buying, cart automation, or affiliate monetisation.
- Categories outside monitors/displays, PC components, and peripherals/audio.
- Tracking the price of an arbitrary pasted product URL. See section 13.

## 4. Architecture

Two deployables in Samuel's existing Cloudflare account.

**`undercut` (Pages, advanced mode).** `src/` builds to `public/_worker.js`, the
same build style as Freehold and My Email. Serves the PWA, the API, and the poll
endpoints. Binds D1 `undercut-db`.

**`undercut-pinger` (Worker).** About 40 lines, `crons = ["* * * * *"]`. Pages
Functions cannot run cron, so scheduled work needs an external caller. See
`ClaudeBrain/Knowledge/Cloudflare Pages Functions cannot run cron.md`.

The pinger does the fan-out. On each tick it fires one HMAC-signed POST per
source at `/api/poll/:source`, in parallel. Each lands as an independent Pages
Function invocation with its own CPU budget, rather than all four feeds sharing
one 10ms allowance. The app decides per source whether it is actually due and
returns 204 quickly if not.

```
pinger (every 60s)
  ├─ POST /api/poll/reddit      due every 60s
  ├─ POST /api/poll/slickdeals  due every 300s
  ├─ POST /api/poll/woot        due every 900s
  └─ POST /api/poll/ebay        due every 300s

each poll: fetch → adapt → parse → classify → fingerprint
         → upsert deal + append event → score → notify if it clears the bar
```

**Request budget.** 1440 pinger invocations/day, 5760 poll requests/day against
a 100k/day free ceiling. eBay is capped at 288 API calls/day by rotating one
watchlist query per tick, well under its 5000/day allowance.

## 5. Module layout

The core is five pure functions with no I/O, each unit-testable in isolation.

| Module | Responsibility |
|---|---|
| `src/core/parse-title.js` | Extract price, was-price, and merchant from a listing title |
| `src/core/classify.js` | Title and attributes to category plus spec bucket |
| `src/core/score.js` | Deal, reference price, heat, weights to `{score, reasons[]}` |
| `src/core/rules.js` | Watchlist keywords and category price rules to a force-notify decision |
| `src/core/fingerprint.js` | Stable identity key for cross-source dedupe |

Around those: `src/sources/*.js` (one adapter per feed, each returns raw items
and nothing else), `src/db/*.js` (D1 access), `src/routes/*.js` (API), and
`src/lib/webpush-crypto.js` vendored from Soda City Cubing.

Adapters are deliberately dumb. They fetch and shape, they do not score, classify,
or write. That keeps every scoring change testable without network access.

## 6. Sources (v1)

| id | Mechanism | Auth | Interval |
|---|---|---|---|
| `reddit` | `GET /r/{sub}/new?limit=50`, default sub `buildapcsales` | OAuth2 client_credentials | 60s |
| `slickdeals` | Computers/tech RSS | none | 300s |
| `woot` | Official sale RSS, computers + electronics | none | 900s |
| `ebay` | Browse API `item_summary/search`, one watchlist query per tick | App token | 300s |

The subreddit list is a data row, not a constant, so adding r/monitordeals later
is a database insert rather than a deploy.

`r/buildapcsales` titles follow a strong convention
(`[Monitor] LG 27GL83A 27" 1440p 144Hz IPS - $279 (was $399)`) which
`parse-title.js` exploits for reliable price, was-price, and category extraction.

## 7. Data model (D1 `undercut-db`)

- **`sources`** — id, name, enabled, config_json, poll_interval_s, last_polled_at,
  last_status, consecutive_failures
- **`deals`** — id, fingerprint (unique), source_id, external_id, title, url,
  merchant, condition, price_cents, was_price_cents, currency, category,
  spec_key, specs_json, posted_at, first_seen_at, last_seen_at, score,
  score_reasons_json, notified_at, notified_price_cents, dead_at
- **`deal_events`** — deal_id, seen_at, price_cents, upvotes, comments.
  One row per observation. Drives both heat velocity and price history.
- **`reference_prices`** — category, spec_key, typical_cents, floor_cents,
  origin (`seed` | `learned`), sample_count, updated_at
- **`watchlist`** — id, label, query, max_price_cents, enabled, hit_count
- **`rules`** — id, category, predicate_json, enabled
- **`prefs`** — singleton: notify_threshold, category weights, push settings
- **`push_subscriptions`** — endpoint, p256dh, auth, created_at, last_ok_at, failures
- **`notifications`** — deal_id, endpoint, sent_at, result

One deal row per unique item. Price changes append to `deal_events` and update
the deal in place, so a repost at a lower price updates rather than duplicates,
and remains eligible for a re-notify.

## 8. Scoring

Score is 0 to 100. Every score carries a `reasons[]` array recording each
component's contribution, which the detail screen renders verbatim.

```
outlier   0..50    how far under the learned floor the price sits
discount  0..25    stated was-price discount, when the listing states one
heat      0..20    votes plus comments per minute, normalised per source
                   against that source's own baseline
weight    0.0..1.5 category weight from prefs, a multiplier on the subtotal
penalties          used or refurb -3, unknown category -10, weak eBay seller -5

subtotal = outlier + discount + heat
score    = clamp(0, 100, round(subtotal * weight - penalties))
```

The detail screen renders the category weight as the delta it contributed
(`subtotal * weight - subtotal`) so the breakdown reads as four additive lines
that sum to the final score. Worked example, the $60 monitor at weight 1.125:
outlier 48, discount 22, heat 18, category +11, total 99.

Outlier is the headline signal and the reason the $60 monitor scores 99: the
learned floor for `monitor:27:1440p:240hz` sits near $198, so $60 is far outside
anything previously observed.

**Cold start.** A checked-in `seed/reference-prices.json` gives every seeded spec
bucket a plausible typical and floor from day one. Once a bucket accumulates 5 or
more observations, learned values take over: rolling median for typical, 10th
percentile for floor, blended against the seed by `sample_count` so the handover
is gradual rather than a cliff.

## 9. Watchlist and rules

Both force a notify independently of the score, rather than inflating it. This
keeps precision alerts working regardless of where the threshold slider sits.

- **Watchlist** entries are standing keyword and spec matchers evaluated against
  every incoming deal (`240hz monitor under $200`). Always fires, never breaks,
  costs nothing.
- **Rules** are hard category predicates (`category=ssd AND capacity>=2TB AND
  price<8000`).

## 10. Notifications

Instant, 24/7, no quiet hours and no batching. This was an explicit decision: a
2am pricing error is dead by 7am. Noise is managed by raising the threshold, not
by delaying delivery.

```
notify when (score >= prefs.notify_threshold) OR rules.forceNotify
  and  deal.notified_at is null
  or   price_cents <= notified_price_cents * 0.9   (10%+ further drop re-fires)
```

Default threshold 78.

**Copy format** (anomaly first, chosen from three candidates):

```
title: $60 · LG 27" 1440p 240Hz
body:  Never seen below $198. Posted 40s ago on r/buildapcsales.
```

The unprecedented-price fact leads because it is the one thing our own price
history is uniquely able to say, and it is what actually decides whether the
notification is worth acting on. When no learned history exists yet, the body
falls back to the stated discount.

iOS home screen PWAs render text only. `userVisibleOnly: true` is required and
the site must be installed to the home screen before push works at all.

## 11. UI

Direction: **Ticker**. Undercut presented as a monitoring instrument rather than
a shopping app. Monospace rows in fixed columns, score as a hard number scanned
down the left edge, roughly twice the deal density of a card layout. Dark by
default, since it is checked at night. Colour is functional and not decorative:
green for 90+, amber for the 78 to 89 band, dim grey below.

Screens:

1. **Feed.** The row stack. Score, item, source, age, price, was-price.
2. **Deal detail.** Itemised score breakdown ("why this fired"), 90-day observed
   price history for the spec bucket, condition and seller, open-at-retailer.
3. **Watchlist.** Standing alerts with hit counts.
4. **Rules.** Category predicates.
5. **Settings.** Source health first, threshold slider annotated with how many
   alerts that setting would have produced over the past 7 days, category
   weights, push enable.

Per `ClaudeBrain/You/Preferences.md`, nothing may read as AI-generated. The
signature element is the fixed-column ticker row with its score gutter, grounded
in the product's actual job of monitoring.

## 12. Failure handling

The dangerous failure for this product is not a crash, it is a source that
quietly returns nothing while the app looks healthy.

- Every adapter is wrapped. One failing source can never break a tick or affect
  another source.
- `consecutive_failures` increments on error or on a well-formed but empty
  response where the source normally returns items.
- At 3 consecutive failures the source auto-disables and fires a single push
  ("eBay source is down"). It retries hourly and self-heals, clearing the alert.
- Source health renders on the settings screen, not buried.
- Push failures returning 404 or 410 prune the subscription. Push is wrapped so
  it can never throw into the poll path.
- All external fetches carry a timeout and one retry.

## 13. Deferred, deliberately kept on the shelf

The price-source layer is an interface, not hardwired to feed matching, so these
can be added without a rewrite:

1. **Local scraper agent.** A Node script on Samuel's Windows PC scraping real
   product pages from a residential IP and reporting prices back. Defeats the
   datacenter bot wall that blocks Amazon, Best Buy, and Newegg from Workers.
   Only runs when the PC is on.
2. **Keepa API** (about $20/month) for real Amazon price history.

## 14. Security

- Single user. Password hashed with PBKDF2 via WebCrypto, stateless signed
  session cookie, 90-day expiry. Pattern copied from My Email.
- `/api/poll/*` requires an HMAC signature over body plus timestamp, timing-safe
  comparison, with a 5-minute window to reject replays.
- Session cookie HttpOnly, Secure, SameSite=Lax.
- No credentials in the repo. Reddit, eBay, VAPID, HMAC, and password secrets are
  all wrangler secrets. `.dev.vars` and `.env` are gitignored.

## 15. Testing

vitest with `@cloudflare/vitest-pool-workers`, matching the existing projects.

- Unit tests over the five pure modules against real captured feed fixtures
  committed under `tests/fixtures/`.
- `score.js` gets table-driven tests including the $60 monitor case, a mediocre
  deal that must not fire, and cold-start behaviour with no learned history.
- Integration tests over `/api/poll/:source` with mocked fetch, covering the
  success path, a failing source, an empty response, and HMAC rejection.
- Source health escalation and the auto-disable threshold are tested explicitly.
- `webpush-crypto.js` arrives with its RFC 8291 known-answer test already passing.

## 16. Deployment

- Pages project `undercut`, D1 `undercut-db`, Worker `undercut-pinger`.
- Private, password gated, on the `pages.dev` URL. No custom domain for now.
- **This project is deployed**, unlike the local-only V2/V3 folders. It cannot do
  its job unless it is live and polling.

**Prerequisites Samuel must supply before deploy:**

1. Reddit OAuth app (client ID and secret) from reddit.com/prefs/apps. Free.
2. eBay developer app key. Free, 5000 calls/day.
3. A Cloudflare API token with Workers scope, or one dashboard paste for the
   pinger. The existing site token is Pages and D1 only and cannot deploy
   Workers. This is the same wall My Email hit on deploy day.

VAPID keys are generated during the build.

## 17. Assumptions to verify during implementation

Both are design assumptions, not measured facts. Verify early and record the
outcome.

1. The per-source fan-out actually keeps each poll inside the free-tier CPU
   allowance. If a single source still exceeds it, shard that source's parsing
   across ticks.
2. Reddit blocks unauthenticated datacenter IPs and requires an OAuth app for a
   workable rate limit. If plain JSON access works from Workers, the OAuth
   dependency can be dropped.
