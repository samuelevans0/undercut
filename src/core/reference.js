// Pure. No I/O. Cold-start seed blended with learned observations.

const MIN_SAMPLES = 5;
const FULL_HANDOVER_SAMPLES = 20;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function learnFromPrices(pricesCents) {
  const list = (pricesCents ?? []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!list.length) return { typicalCents: null, floorCents: null, sampleCount: 0 };
  const mid = Math.floor(list.length / 2);
  const median = list.length % 2 === 0 ? Math.round((list[mid - 1] + list[mid]) / 2) : list[mid];
  return { typicalCents: median, floorCents: percentile(list, 0.1), sampleCount: list.length };
}

export function blendReference(seed, learned) {
  const n = learned?.sampleCount ?? 0;
  const hasLearned = n >= MIN_SAMPLES && learned.typicalCents !== null;
  if (!hasLearned) {
    if (!seed) return { typicalCents: null, floorCents: null, origin: "seed", sampleCount: n };
    return { typicalCents: seed.typicalCents, floorCents: seed.floorCents, origin: "seed", sampleCount: n };
  }
  if (!seed) {
    return { typicalCents: learned.typicalCents, floorCents: learned.floorCents, origin: "learned", sampleCount: n };
  }
  const w = Math.min(1, n / FULL_HANDOVER_SAMPLES);
  return {
    typicalCents: Math.round(seed.typicalCents * (1 - w) + learned.typicalCents * w),
    floorCents: Math.round(seed.floorCents * (1 - w) + learned.floorCents * w),
    origin: "learned",
    sampleCount: n,
  };
}
