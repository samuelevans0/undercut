# Undercut build log

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Plan: `docs/superpowers/plans/2026-07-25-undercut-implementation.md`

Read this file first when resuming. Update it at the end of every task.

## Status
Task 1 done: scaffold, config, health route, 3 tests green.

## Task ledger
- [x] T1 scaffold
- [ ] T2 vendored libs
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
(none yet)

## Assumptions to verify (from spec section 17)
- [ ] Per-source fan-out keeps each poll inside the free-tier CPU allowance
- [ ] Reddit requires OAuth from Cloudflare datacenter IPs
