import { sendPush } from "./lib/webpush.js";
import { listPushSubs, removePushSub } from "./db/prefs.js";
import { markNotified } from "./db/deals.js";

export async function notifyDeal(env, deal, payload, nowSec, sendImpl = sendPush) {
  let sent = 0;
  let pruned = 0;
  try {
    const subs = await listPushSubs(env.DB);
    if (!subs.length) return { sent: 0, pruned: 0 };

    for (const sub of subs) {
      let result;
      try {
        result = await sendImpl(env, sub, payload);
      } catch {
        result = { ok: false, gone: false };
      }
      if (result.gone) {
        await removePushSub(env.DB, sub.endpoint);
        pruned++;
      } else if (result.ok) {
        sent++;
      }
      await env.DB
        .prepare("INSERT INTO notifications (deal_id, endpoint, sent_at, result) VALUES (?,?,?,?)")
        .bind(deal.id, sub.endpoint, nowSec, result.ok ? "ok" : result.gone ? "gone" : "failed")
        .run();
    }

    if (sent > 0) await markNotified(env.DB, deal.id, deal.price_cents, nowSec);
  } catch (e) {
    console.error("notifyDeal failed", e);
  }
  return { sent, pruned };
}
