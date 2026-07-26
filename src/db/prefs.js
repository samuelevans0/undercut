const PREF_COLUMNS = ["notify_threshold", "weights_json", "password_hash", "setup_done"];

export async function getPrefs(db) {
  return db.prepare("SELECT * FROM prefs WHERE id = 1").first();
}

export async function setPrefs(db, patch) {
  const keys = Object.keys(patch).filter((k) => PREF_COLUMNS.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE prefs SET ${sets} WHERE id = 1`)
    .bind(...keys.map((k) => patch[k]))
    .run();
}

export async function listWatchlist(db) {
  const { results } = await db
    .prepare("SELECT * FROM watchlist WHERE enabled = 1 ORDER BY created_at DESC")
    .all();
  return results ?? [];
}

export async function listRules(db) {
  const { results } = await db.prepare("SELECT * FROM rules WHERE enabled = 1 ORDER BY created_at DESC").all();
  return results ?? [];
}

export async function listPushSubs(db) {
  const { results } = await db.prepare("SELECT * FROM push_subscriptions").all();
  return results ?? [];
}

export async function addPushSub(db, sub, nowSec) {
  await db
    .prepare(
      "INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0"
    )
    .bind(sub.endpoint, sub.p256dh, sub.auth, nowSec)
    .run();
}

export async function removePushSub(db, endpoint) {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}
