# Undercut build log

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Plan: `docs/superpowers/plans/2026-07-25-undercut-implementation.md`

Read this file first when resuming. Update it at the end of every task.

## Status
Task 2 done: vendored crypto/session/webpush from My Email, added hmac-auth poll signing, 16 tests green.

## Task ledger
- [x] T1 scaffold
- [x] T2 vendored libs
- [ ] T3 schema + db layer
- [ ] T4 parse-title
- [ ] T5 classify
- [ ] T6 fingerprint
- [ ] T7 reference prices
- [ ] T8 score
- [ ] T9 rules
- [ ] T10 reddit source
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

## Assumptions to verify (from spec section 17)
- [ ] Per-source fan-out keeps each poll inside the free-tier CPU allowance
- [ ] Reddit requires OAuth from Cloudflare datacenter IPs
