import { blendReference, learnFromPrices } from "../core/reference.js";

export async function getReference(db, specKey) {
  if (!specKey) return null;
  return db.prepare("SELECT * FROM reference_prices WHERE spec_key = ?").bind(specKey).first();
}

export async function seedReferences(db, seedJson, nowSec) {
  const stmt = db.prepare(
    "INSERT INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
      "VALUES (?,?,?,?,'seed',0,?) ON CONFLICT(spec_key) DO NOTHING"
  );
  const batch = Object.entries(seedJson).map(([specKey, v]) =>
    stmt.bind(specKey, v.category, v.typicalCents, v.floorCents, nowSec)
  );
  // D1 caps bound parameters per call, so chunk. See the My Email cascade-delete fix.
  for (let i = 0; i < batch.length; i += 15) await db.batch(batch.slice(i, i + 15));
}

export async function updateLearned(db, specKey, category, pricesCents, seedJson, nowSec) {
  if (!specKey) return;
  const learned = learnFromPrices(pricesCents);
  const seed = seedJson?.[specKey] ?? null;
  const blended = blendReference(seed, learned);
  if (blended.typicalCents === null) return;
  await db
    .prepare(
      "INSERT INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
        "VALUES (?,?,?,?,?,?,?) ON CONFLICT(spec_key) DO UPDATE SET " +
        "typical_cents = excluded.typical_cents, floor_cents = excluded.floor_cents, " +
        "origin = excluded.origin, sample_count = excluded.sample_count, updated_at = excluded.updated_at"
    )
    .bind(specKey, category, blended.typicalCents, blended.floorCents, blended.origin, blended.sampleCount, nowSec)
    .run();
}
