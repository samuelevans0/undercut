# Undercut build log

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Plan: `docs/superpowers/plans/2026-07-25-undercut-implementation.md`

Read this file first when resuming. Update it at the end of every task.

## Status
Task 16 done: the read and settings API. `src/api/feed.js` exposes
`routeFeed` (`GET /api/feed?minScore=&limit=`, `GET /api/deal/:id`);
`src/api/settings.js` exposes `routeSettings` (`GET|PATCH /api/settings`,
`GET|POST /api/watchlist`, `DELETE /api/watchlist/:id`, `GET|POST /api/rules`,
`DELETE /api/rules/:id`, `POST /api/sources/:id/enable`); `src/api/push.js`
exposes `routePush` (`GET /api/push/key`, `POST /api/push/subscribe`,
`POST /api/push/unsubscribe`). All three registered in `src/index.js`'s
`browserRouters` array, behind both the origin check and the session gate,
without touching the `/api/poll/` early-return branch above them. Feed's
`limit`/`minScore` query params are clamped at both ends (`limit` must be a
finite integer `> 0`, then capped at `LIMITS.maxFeedRows`; `minScore` clamped
to 0..100) so a negative or zero `limit` can't hit SQLite's "negative LIMIT
means unbounded" behavior. `withReasons` parses `score_reasons_json` inside a
try/catch so one malformed row can't break the whole feed response.
`publicPrefs` strips `password_hash` before every `/api/settings` response;
it's the only place prefs get serialised. `routeSettings`'s rule validation
requires `predicate` to be a non-empty array and every clause's `op` to be in
`VALID_OPS`, and its watchlist/rule/source-enable SQL binds every value as a
parameter, never interpolating a caller-supplied key or string into the
query. 256 tests green (236 prior + 20 new; the brief's "20 tests" estimate
was correct this time). Explicitly re-ran `npx vitest run tests/poll.test.js`
after the `src/index.js` edit: 18/18 still pass, confirming the machine
endpoints are unaffected by the new routers.

Task 15 done: the auth API. `src/api/auth.js` exposes `routeAuth` (`GET
/api/auth/state`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST
/api/auth/logout`) and `requireSession` (throws `HttpError(401)` with no valid
`uc_session` cookie), built on the already-tested `hashPassword`/
`verifyPassword`, `createSessionCookie`/`readSession`/`clearSessionCookie`,
and `getPrefs`/`setPrefs`. `src/index.js`'s `handleApi` was restructured with
the machine-endpoint bypass first (`/api/poll/` returns before either gate
exists, using the same code Task 14 already positioned there), then the
same-origin check for non-GET/HEAD, then the session gate for every path
outside `OPEN_PREFIXES` (`/api/auth/`, `/api/health`), then the new
`browserRouters` array (currently just `routeAuth`; Task 16 appends to it).
236 tests green (224 prior + 12 new auth tests; the brief's "13 tests"
estimate overcounted by one, the verbatim test file has 12 `it()` blocks).

Explicitly re-ran `npx vitest run tests/poll.test.js` after the `src/index.js`
restructure: all 18 pass (13 pollSource + 5 route), confirming the HMAC-signed
machine endpoints are unaffected by the new gates.

One pre-existing test needed updating for a genuine, intended cross-task
behavior change: Task 1's `tests/health.test.js` asserted that an
unauthenticated request to an unknown `/api/*` path 404s. That test predates
any auth wall. With Task 15's gate in place, an unauthenticated request to any
path outside `OPEN_PREFIXES` now hits `requireSession` and 401s before routing
ever reaches the "not found" fallback, whether or not the path would have
matched a route, so unauthenticated callers can't distinguish "route doesn't
exist" from "route exists but needs a session". That is the correct, intended
effect of putting a global gate in front of the routers, not a bug, so the
test's expected status was changed from 404 to 401 (kept the "response is JSON
with an error property" assertion). Not a case of loosening the current task's
own tests to fit the implementation; it is a stale assumption in a different
task's frozen test invalidated by this task's actual purpose.

Task 14 done: the poll pipeline. `src/poll.js` wires fetch, parse, classify,
fingerprint, upsert/appendEvent, getReference, scoreDeal, evaluateRules,
shouldNotify/notifyDeal, and end-of-tick learned-reference refresh into one
`pollSource(env, sourceId, nowSec, deps)` call; `src/api/poll.js` exposes it
as `POST /api/poll/:sourceId`, HMAC-verified, registered in `src/index.js`
outside any origin/session gate (neither exists yet; that's T15's job, but
`routePoll` is already positioned to sit outside them). Items with no
parseable price are skipped before classify/fingerprint/upsert ever run, so
junk never reaches the deals table. `adapter.list` is the only wrapped call;
on throw it records `markFailure` and returns `status: "failed"` without
propagating, and `markPolled` is called before the fetch so a throwing source
still consumes its interval instead of being retried every tick. 224 tests
green (206 prior + 18 new: 13 pollSource + 5 route; the brief's "18 tests"
estimate was correct this time).

Two test-infra/implementation fixes were needed beyond the brief's verbatim
code:
1. `vitest.config.js` had no `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`
   bindings. T10's own test file sidesteps this by constructing a plain `env`
   object by hand; T14 is the first test to call `pollSource` against the
   real `cloudflare:test` `env`, which reaches the reddit adapter's
   credential check. Added fake test bindings alongside the existing
   `SESSION_SECRET`/`POLL_SECRET`/VAPID ones.
2. Genuine bug in `poll.js`'s own `heatFor` (new code this task, not a
   frozen module): `Math.max(1, ageMin)` was written to dodge divide-by-zero
   for a post whose age is exactly 0, but it doesn't just dodge the crash, it
   manufactures a rate (votes ÷ 1 minute) from a genuinely zero-length
   window. The shared reddit fixture's `created_utc` happens to equal this
   task's `NOW` exactly (a T10 fixture coincidentally reused by a T14 test
   constant), so the monitor item's heat maxed out, pushing its score to a
   capped 100 and making it independently clear a `threshold: 100` meant to
   be reachable only via a watchlist force-notify (T13's `shouldNotify`
   already fires exactly at the threshold, by design, so this wasn't a bug
   there). Fixed by gating on minimum elapsed time (`ageSec < 60 -> null`,
   which `scoreDeal` already tolerates) instead of flooring the denominator.
   All other tests, including the ">= 90" outlier-score assertion, still
   pass with heat suppressed for that specific zero-age item.

Task 13 done: notification decision, copy, and delivery. `src/core/notify-decision.js`
(pure) holds `shouldNotify` (already-notified check first, price-drop the only
escape) and `buildNotification` (anomaly-first copy: unprecedented-price fact
leads when reference history exists, falls back to stated discount, then to
freshness alone). `src/notify.js` holds `notifyDeal`, which wraps each
`sendImpl` call in its own try/catch (one corrupt subscription cannot starve
the rest) and wraps the whole function body in a second try/catch (a D1
failure reading subs or writing rows cannot escape) — both needed because the
vendored `sendPush` in `src/lib/webpush.js` runs its encryption and VAPID JWT
signing outside its own try block, confirmed by reading the file directly
(lines 96-98 sit before the `try` at line 99). `SOURCE_HEAT_BASELINE` appended
to `src/config.js`. 206 tests green (183 prior + 23 new: 9 shouldNotify + 9
buildNotification + 5 notifyDeal; the brief's "21 tests" estimate
undercounted the verbatim test code, which is authoritative).

Task 12 done: eBay Browse API adapter (src/sources/ebay.js) with OAuth
client-credentials token caching and one-query-per-poll rotation by
`config.cursor`, plus the source registry (src/sources/index.js: `ADAPTERS`,
`getAdapter`). 183 tests green (167 prior + 15 new + 1 review-round-1 fix:
12 ebayAdapter + 3 adapter registry + 1 cursor-guard regression test; the
brief's "14 tests" estimate undercounted the verbatim test code, which is
authoritative). Review round 1 fixed a cursor-guard bug in the brief's own
code: `Number.isFinite` let negative or fractional cursors through, and a
negative modulo or fractional array index resolved to `undefined`, silently
burning one of the day's 288 searches on the literal string "undefined".
Fixed with `Number.isInteger(config.cursor) && config.cursor >= 0`.

## Task ledger
- [x] T1 scaffold
- [x] T2 vendored libs
- [x] T3 schema + db layer
- [x] T4 parse-title
- [x] T5 classify
- [x] T6 fingerprint
- [x] T7 reference prices
- [x] T8 score
- [x] T9 rules
- [x] T10 reddit source
- [x] T11 rss sources (slickdeals, woot)
- [x] T12 ebay source
- [x] T13 notify
- [x] T14 poll pipeline
- [x] T15 auth api
- [x] T16 read api
- [ ] T17 feed + detail UI
- [ ] T18 settings UI
- [ ] T19 PWA shell + push
- [ ] T20 cron-pinger
- [ ] T21 deploy runbook

## Gotchas found
- Task 2 brief's prose said "15 tests" / "18 tests total" for tests/lib.test.js
  and the full suite, but the verbatim test code given (which is authoritative)
  contains 13 `it()` blocks, so the real totals are 13 and 16. Ran the exact
  code as instructed rather than padding it to hit the stated number.
- Task 3: the brief's `tests/setup.js` (`readFileSync(new URL("../schema.sql",
  import.meta.url))`) cannot work on this host. `@cloudflare/vitest-pool-workers`
  runs `setupFiles` inside the workerd/Miniflare sandbox, not real Node: its
  `node:fs` is a virtualized fs that (a) reports `process.platform` as `linux`
  even on this Windows box, mangling any `fileURLToPath`/`URL.pathname`-derived
  path (undecoded `%20`, a stray leading slash before the drive letter), and
  (b) rejects plain path strings outright (`TypeError: File path must be a
  file: URL`) and still can't find *any* real file even given a correct
  `file://` URL, including files proven to exist in the same directory. There
  is no real host disk access from inside that sandbox at all. Fixed by
  dropping `node:fs` entirely and using Vite's native `?raw` import suffix
  (`import sql from "../schema.sql?raw"`), which resolves the file's content
  at transform time instead of through runtime fs. Confirmed this is a targeted
  fix to the test-harness plumbing, not the "per-test table creation" workaround
  the brief warned against — schema application still happens once in a single
  `beforeAll`, unchanged in spirit.
- Task 11: the same virtualized-`node:fs` issue from Task 3 recurs, this time
  inside the verbatim test file itself rather than a separate setup file.
  `tests/source-rss.test.js`'s brief code loads fixtures with
  `readFileSync(new URL("./fixtures/slickdeals.xml", import.meta.url), "utf8")`;
  that throws `no such file or directory` for the same reason as Task 3 (no
  real host disk access inside the workerd/Miniflare sandbox). Fixed the same
  way: swapped the two loader lines to Vite's `?raw` import suffix
  (`import slickXml from "./fixtures/slickdeals.xml?raw"`). Every `describe`/
  `it` block is unmodified from the brief. Verified 15 tests pass (7 parseRss
  + 5 slickdealsAdapter + 3 wootAdapter), not the "13 tests" the brief's prose
  estimated.
- Task 12: `tests/source-ebay.test.js`'s fixture import (`import fixture from
  "./fixtures/ebay-search.json"`) is a plain JSON import, not a `readFileSync`
  call, so it sidesteps the virtualized-`node:fs` issue from Tasks 3 and 11
  entirely; no test-harness workaround was needed here. Verified 15 tests pass
  (12 ebayAdapter + 3 adapter registry), not the "14 tests" the brief's prose
  estimated.
- Task 15: adding the global session gate changed the true status code for
  unauthenticated requests to unknown `/api/*` paths from 404 (Task 1's
  assumption, written before auth existed) to 401 (the gate now runs before
  the routers' "not found" fallback for anything outside `OPEN_PREFIXES`).
  Updated the one affected assertion in `tests/health.test.js` accordingly;
  see Status above for the full reasoning.
- Task 14: `vitest.config.js` needed `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`
  test bindings added (see Status above) because this is the first test to
  drive the reddit adapter through the real `cloudflare:test` `env` rather
  than a hand-built stand-in. Also found and fixed a genuine bug in `poll.js`'s
  own `heatFor`: flooring the age denominator to 1 minute for a zero-age post
  manufactures a fake velocity instead of signalling "no data yet"; fixed by
  gating on elapsed time instead (see Status above for the full story).

## Assumptions to verify (from spec section 17)
- [ ] Per-source fan-out keeps each poll inside the free-tier CPU allowance.
      T14 note: a fully-stored 50-item tick makes roughly 300-450 D1 calls —
      ~6 per stored item (upsertDeal's own SELECT-then-INSERT/UPDATE, plus
      appendEvent, getReference, setScore, getDeal), a few more per item that
      clears the notify bar (listPushSubs, one notifications INSERT per push
      subscription, markNotified), ~2 per distinct spec bucket touched this
      tick (refreshLearned's SELECT + updateLearned's write), and ~6 fixed
      per-tick calls (getSource, markPolled, getPrefs, listWatchlist,
      listRules, markSuccess). Skipped (unparseable-price) items cost zero DB
      calls. Not optimised per the brief; flagged for the deploy task to
      measure against the actual free-tier CPU/subrequest budget.
- [ ] Reddit requires OAuth from Cloudflare datacenter IPs
