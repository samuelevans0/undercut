import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { listSources, getSource, isDue, markPolled, markFailure, markSuccess } from "../src/db/sources.js";
import { upsertDeal, appendEvent, getDeal, listFeed, listEvents, setScore, markNotified } from "../src/db/deals.js";
import { getPrefs, setPrefs, listWatchlist, addPushSub, listPushSubs, removePushSub } from "../src/db/prefs.js";

const NOW = 1_800_000_000;

function sampleDeal(over = {}) {
  return {
    fingerprint: "fp-1",
    sourceId: "reddit",
    externalId: "t3_abc",
    title: 'LG 27GR83Q 27" 1440p 240Hz',
    url: "https://example.test/1",
    merchant: "Amazon",
    condition: "new",
    priceCents: 6000,
    wasPriceCents: 39900,
    currency: "USD",
    category: "monitor",
    specKey: "monitor:27:1440p:240hz",
    specs: { size: 27, refresh: 240 },
    postedAt: NOW - 40,
    ...over,
  };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM notifications").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
});

describe("sources", () => {
  it("seeds all four sources", async () => {
    const rows = await listSources(env.DB);
    expect(rows.map((r) => r.id).sort()).toEqual(["ebay", "reddit", "slickdeals", "woot"]);
  });

  it("treats a never-polled source as due", () => {
    expect(isDue({ enabled: 1, poll_interval_s: 60, last_polled_at: null }, NOW)).toBe(true);
  });

  it("respects the poll interval", () => {
    const s = { enabled: 1, poll_interval_s: 300, last_polled_at: NOW - 100 };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue({ ...s, last_polled_at: NOW - 301 }, NOW)).toBe(true);
  });

  it("treats a disabled source as not due until the retry window elapses", () => {
    const s = { enabled: 0, poll_interval_s: 60, last_polled_at: NOW - 999, disabled_at: NOW - 10 };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue({ ...s, disabled_at: NOW - 3601 }, NOW)).toBe(true);
  });

  it("escalates failures and auto-disables at the threshold", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    const s = await getSource(env.DB, "woot");
    expect(s.consecutive_failures).toBe(3);
    expect(s.enabled).toBe(0);
    expect(s.disabled_at).toBe(NOW);
  });

  it("pushes the retry window forward when an already-disabled source fails again", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    await markFailure(env.DB, "woot", NOW + 3700);
    const s = await getSource(env.DB, "woot");
    expect(s.disabled_at).toBe(NOW + 3700);
    expect(isDue(s, NOW + 3800)).toBe(false);
  });

  it("clears failures and re-enables on success", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    await markSuccess(env.DB, "woot", NOW + 10);
    const s = await getSource(env.DB, "woot");
    expect(s.consecutive_failures).toBe(0);
    expect(s.enabled).toBe(1);
    expect(s.disabled_at).toBe(null);
  });

  it("records the poll time", async () => {
    await markPolled(env.DB, "reddit", NOW);
    expect((await getSource(env.DB, "reddit")).last_polled_at).toBe(NOW);
  });
});

describe("deals", () => {
  it("inserts a new deal and reports it as new", async () => {
    const res = await upsertDeal(env.DB, sampleDeal(), NOW);
    expect(res.isNew).toBe(true);
    expect(res.previousPriceCents).toBe(null);
    const row = await getDeal(env.DB, res.id);
    expect(row.price_cents).toBe(6000);
    expect(row.first_seen_at).toBe(NOW);
  });

  it("updates in place on the same fingerprint and reports the old price", async () => {
    const first = await upsertDeal(env.DB, sampleDeal(), NOW);
    const second = await upsertDeal(env.DB, sampleDeal({ priceCents: 5000 }), NOW + 60);
    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
    expect(second.previousPriceCents).toBe(6000);
    const row = await getDeal(env.DB, second.id);
    expect(row.price_cents).toBe(5000);
    expect(row.first_seen_at).toBe(NOW);
    expect(row.last_seen_at).toBe(NOW + 60);
  });

  it("appends events and reads them back in order", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await appendEvent(env.DB, id, { priceCents: 6000, upvotes: 10, comments: 2 }, NOW);
    await appendEvent(env.DB, id, { priceCents: 5000, upvotes: 350, comments: 40 }, NOW + 240);
    const events = await listEvents(env.DB, id);
    expect(events).toHaveLength(2);
    expect(events[1].upvotes).toBe(350);
  });

  it("stores score and reasons", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await setScore(env.DB, id, 99, [{ key: "outlier", points: 50 }]);
    const row = await getDeal(env.DB, id);
    expect(row.score).toBe(99);
    expect(JSON.parse(row.score_reasons_json)[0].key).toBe("outlier");
  });

  it("records the notified price", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await markNotified(env.DB, id, 6000, NOW);
    const row = await getDeal(env.DB, id);
    expect(row.notified_at).toBe(NOW);
    expect(row.notified_price_cents).toBe(6000);
  });

  it("lists the feed newest first and honours minScore", async () => {
    const a = await upsertDeal(env.DB, sampleDeal({ fingerprint: "a" }), NOW);
    const b = await upsertDeal(env.DB, sampleDeal({ fingerprint: "b" }), NOW + 10);
    await setScore(env.DB, a.id, 90, []);
    await setScore(env.DB, b.id, 20, []);
    const all = await listFeed(env.DB, { limit: 10, minScore: 0 });
    expect(all[0].fingerprint).toBe("b");
    const good = await listFeed(env.DB, { limit: 10, minScore: 50 });
    expect(good.map((r) => r.fingerprint)).toEqual(["a"]);
  });
});

describe("prefs", () => {
  it("returns defaults", async () => {
    const p = await getPrefs(env.DB);
    expect(p.notify_threshold).toBe(78);
    expect(p.setup_done).toBe(0);
  });

  it("patches only the given fields", async () => {
    await setPrefs(env.DB, { notify_threshold: 85 });
    const p = await getPrefs(env.DB);
    expect(p.notify_threshold).toBe(85);
    expect(p.setup_done).toBe(0);
    await setPrefs(env.DB, { notify_threshold: 78 });
  });

  it("adds, lists, and removes push subscriptions", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/1", p256dh: "k", auth: "a" }, NOW);
    expect(await listPushSubs(env.DB)).toHaveLength(1);
    await addPushSub(env.DB, { endpoint: "https://push.test/1", p256dh: "k2", auth: "a2" }, NOW);
    expect(await listPushSubs(env.DB)).toHaveLength(1);
    await removePushSub(env.DB, "https://push.test/1");
    expect(await listPushSubs(env.DB)).toHaveLength(0);
  });

  it("starts with an empty watchlist", async () => {
    expect(await listWatchlist(env.DB)).toEqual([]);
  });
});
