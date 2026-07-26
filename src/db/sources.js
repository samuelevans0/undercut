import { LIMITS } from "../config.js";

export async function listSources(db) {
  const { results } = await db.prepare("SELECT * FROM sources ORDER BY id").all();
  return results ?? [];
}

export async function getSource(db, id) {
  return db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first();
}

export function isDue(source, nowSec) {
  if (!source) return false;
  if (!source.enabled) {
    if (!source.disabled_at) return false;
    return nowSec - source.disabled_at >= LIMITS.sourceRetryAfterSec;
  }
  if (!source.last_polled_at) return true;
  return nowSec - source.last_polled_at >= source.poll_interval_s;
}

export async function markPolled(db, id, nowSec) {
  await db.prepare("UPDATE sources SET last_polled_at = ? WHERE id = ?").bind(nowSec, id).run();
}

export async function markSuccess(db, id, nowSec) {
  await db
    .prepare(
      "UPDATE sources SET last_success_at = ?, last_status = 'ok', consecutive_failures = 0, " +
        "enabled = 1, disabled_at = NULL WHERE id = ?"
    )
    .bind(nowSec, id)
    .run();
}

export async function markFailure(db, id, nowSec, message = "error") {
  await db
    .prepare("UPDATE sources SET consecutive_failures = consecutive_failures + 1, last_status = ? WHERE id = ?")
    .bind(String(message).slice(0, 200), id)
    .run();
  // No `AND enabled = 1` guard here on purpose. An already-disabled source that
  // fails its hourly retry must push `disabled_at` forward, otherwise the retry
  // window stays permanently elapsed and a dead source gets polled every minute.
  await db
    .prepare("UPDATE sources SET enabled = 0, disabled_at = ? WHERE id = ? AND consecutive_failures >= ?")
    .bind(nowSec, id, LIMITS.sourceFailureThreshold)
    .run();
}
