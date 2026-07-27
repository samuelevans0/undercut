# Undercut build log

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Plan: `docs/superpowers/plans/2026-07-25-undercut-implementation.md`

Read this file first when resuming. Update it at the end of every task.

## Status
Task 10 done: Reddit source adapter in src/sources/reddit.js.
150 tests green (139 prior + 11 new).

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
- [ ] T11 rss sources (slickdeals, woot)
- [ ] T12 ebay source
- [ ] T13 notify
- [ ] T14 poll pipeline
- [ ] T15 auth api
- [ ] T16 read api
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

## Assumptions to verify (from spec section 17)
- [ ] Per-source fan-out keeps each poll inside the free-tier CPU allowance
- [ ] Reddit requires OAuth from Cloudflare datacenter IPs
