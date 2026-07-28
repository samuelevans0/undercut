import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { shouldNotify, buildNotification } from "../src/core/notify-decision.js";
import { notifyDeal } from "../src/notify.js";
import { addPushSub, listPushSubs } from "../src/db/prefs.js";

const NOW = 1_800_000_000;

const dec = (over = {}) => ({
  score: 90, threshold: 78, forceNotify: false,
  notifiedAt: null, notifiedPriceCents: null, priceCents: 6000, ...over,
});

describe("shouldNotify", () => {
  it("fires above the threshold", () => {
    expect(shouldNotify(dec()).notify).toBe(true);
  });

  it("does not fire below the threshold", () => {
    expect(shouldNotify(dec({ score: 50 })).notify).toBe(false);
  });

  it("fires exactly at the threshold", () => {
    expect(shouldNotify(dec({ score: 78 })).notify).toBe(true);
  });

  it("fires on a rule match regardless of score", () => {
    const r = shouldNotify(dec({ score: 5, forceNotify: true }));
    expect(r.notify).toBe(true);
    expect(r.reason).toBe("rule");
  });

  it("does not fire twice for the same deal", () => {
    expect(shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000 })).notify).toBe(false);
  });

  it("does not re-fire on a trivial price drop", () => {
    const r = shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000, priceCents: 5800 }));
    expect(r.notify).toBe(false);
  });

  it("re-fires on a drop of 10 percent or more", () => {
    const r = shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000, priceCents: 5400 }));
    expect(r.notify).toBe(true);
    expect(r.reason).toBe("price-drop");
  });

  it("does not re-fire a rule match that was already notified", () => {
    const r = shouldNotify(dec({ score: 5, forceNotify: true, notifiedAt: NOW, notifiedPriceCents: 6000 }));
    expect(r.notify).toBe(false);
  });

  it("reports the score reason", () => {
    expect(shouldNotify(dec()).reason).toBe("score");
  });
});

describe("buildNotification", () => {
  const deal = {
    title: 'LG 27GR83Q 27" 1440p 240Hz IPS',
    price_cents: 6000,
    was_price_cents: 39900,
    posted_at: NOW - 40,
    condition: "new",
  };

  it("leads the title with the price", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "r/buildapcsales", nowSec: NOW });
    expect(n.title.startsWith("$60")).toBe(true);
    expect(n.title).toContain("LG 27GR83Q");
  });

  it("leads the body with the unprecedented price when history exists", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "r/buildapcsales", nowSec: NOW });
    expect(n.body).toContain("Never seen below $198");
    expect(n.body).toContain("40s ago");
    expect(n.body).toContain("r/buildapcsales");
  });

  it("falls back to the stated discount with no history", () => {
    const n = buildNotification({ deal, reference: null, sourceName: "woot", nowSec: NOW });
    expect(n.body).toContain("85% off");
    expect(n.body).not.toContain("Never seen");
  });

  it("says only how fresh it is when there is neither history nor a was-price", () => {
    const bare = { ...deal, was_price_cents: null };
    const n = buildNotification({ deal: bare, reference: null, sourceName: "woot", nowSec: NOW });
    expect(n.body).toContain("woot");
    expect(n.body).toMatch(/40s ago/);
  });

  it("does not claim an unprecedented price when the price is above the floor", () => {
    const n = buildNotification({ deal: { ...deal, price_cents: 25000 }, reference: { floorCents: 19800 }, sourceName: "x", nowSec: NOW });
    expect(n.body).not.toContain("Never seen");
  });

  it("names the watchlist entry that matched", () => {
    const n = buildNotification({
      deal, reference: null, sourceName: "woot", nowSec: NOW,
      matches: [{ type: "watchlist", label: "240hz under $200" }],
    });
    expect(n.title).toContain("240hz under $200");
  });

  it("shows minutes and hours for older posts", () => {
    const n5 = buildNotification({ deal: { ...deal, posted_at: NOW - 300 }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n5.body).toContain("5m ago");
    const n2h = buildNotification({ deal: { ...deal, posted_at: NOW - 7200 }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n2h.body).toContain("2h ago");
  });

  it("flags a non-new condition in the title", () => {
    const n = buildNotification({ deal: { ...deal, condition: "refurb" }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n.title).toMatch(/refurb/i);
  });

  it("contains no em-dashes", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "x", nowSec: NOW });
    expect(`${n.title} ${n.body}`).not.toContain("—");
  });
});

describe("notifyDeal", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM push_subscriptions").run();
    await env.DB.prepare("DELETE FROM notifications").run();
    await env.DB.prepare("DELETE FROM deals").run();
  });

  async function seedDeal() {
    const res = await env.DB.prepare(
      "INSERT INTO deals (fingerprint, source_id, title, url, price_cents, first_seen_at, last_seen_at) " +
        "VALUES ('fp','reddit','t','https://x.test',6000,?,?)"
    ).bind(NOW, NOW).run();
    return res.meta.last_row_id;
  }

  it("sends to every subscription", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    await addPushSub(env.DB, { endpoint: "https://push.test/b", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send);
    expect(r.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("prunes subscriptions the push service reports as gone", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/dead", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: false, gone: true }));
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send);
    expect(r.pruned).toBe(1);
    expect(await listPushSubs(env.DB)).toHaveLength(0);
  });

  it("marks the deal as notified", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, async () => ({ ok: true, gone: false }));
    const row = await env.DB.prepare("SELECT * FROM deals WHERE id = ?").bind(id).first();
    expect(row.notified_at).toBe(NOW);
    expect(row.notified_price_cents).toBe(6000);
  });

  it("never throws when the push service errors", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => { throw new Error("network down"); });
    await expect(notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send)).resolves.toEqual({ sent: 0, pruned: 0 });
  });

  it("is a no-op with no subscriptions", async () => {
    const id = await seedDeal();
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, async () => ({ ok: true }));
    expect(r).toEqual({ sent: 0, pruned: 0 });
  });
});
