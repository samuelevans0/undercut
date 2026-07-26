import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { blendReference, learnFromPrices } from "../src/core/reference.js";
import { getReference, seedReferences, updateLearned } from "../src/db/refs.js";
import seedJson from "../seed/reference-prices.json";

const NOW = 1_800_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM reference_prices").run();
});

describe("learnFromPrices", () => {
  it("uses the median for typical", () => {
    expect(learnFromPrices([100, 200, 300]).typicalCents).toBe(200);
  });

  it("averages the two middle values for an even count", () => {
    expect(learnFromPrices([100, 200, 300, 400]).typicalCents).toBe(250);
  });

  it("uses the 10th percentile for the floor", () => {
    const prices = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    expect(learnFromPrices(prices).floorCents).toBe(110);
  });

  it("reports the sample count", () => {
    expect(learnFromPrices([1, 2, 3]).sampleCount).toBe(3);
  });

  it("handles a single sample", () => {
    const r = learnFromPrices([500]);
    expect(r.typicalCents).toBe(500);
    expect(r.floorCents).toBe(500);
  });

  it("returns nulls for no samples", () => {
    expect(learnFromPrices([])).toEqual({ typicalCents: null, floorCents: null, sampleCount: 0 });
  });
});

describe("blendReference", () => {
  const seed = { typicalCents: 32000, floorCents: 19800 };

  it("uses the seed alone below five samples", () => {
    const r = blendReference(seed, { typicalCents: 10000, floorCents: 5000, sampleCount: 4 });
    expect(r.typicalCents).toBe(32000);
    expect(r.origin).toBe("seed");
  });

  it("blends a quarter of the way at five samples", () => {
    const r = blendReference(seed, { typicalCents: 20000, floorCents: 12000, sampleCount: 5 });
    expect(r.typicalCents).toBe(29000);
    expect(r.origin).toBe("learned");
  });

  it("hands over completely at twenty samples", () => {
    const r = blendReference(seed, { typicalCents: 20000, floorCents: 12000, sampleCount: 20 });
    expect(r.typicalCents).toBe(20000);
    expect(r.floorCents).toBe(12000);
  });

  it("uses learned values alone when there is no seed", () => {
    const r = blendReference(null, { typicalCents: 20000, floorCents: 12000, sampleCount: 30 });
    expect(r.typicalCents).toBe(20000);
  });

  it("returns nulls when there is neither seed nor learned data", () => {
    const r = blendReference(null, { typicalCents: null, floorCents: null, sampleCount: 0 });
    expect(r.typicalCents).toBe(null);
    expect(r.floorCents).toBe(null);
  });

  it("ignores learned data below five samples even with no seed", () => {
    const r = blendReference(null, { typicalCents: 9999, floorCents: 9999, sampleCount: 2 });
    expect(r.typicalCents).toBe(null);
  });
});

describe("reference storage", () => {
  it("seeds every key from the json", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:240hz");
    expect(row.floor_cents).toBe(19800);
    expect(row.origin).toBe("seed");
  });

  it("is idempotent", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    await seedReferences(env.DB, seedJson, NOW);
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM reference_prices").all();
    expect(results[0].n).toBe(Object.keys(seedJson).length);
  });

  it("returns null for an unknown key", async () => {
    expect(await getReference(env.DB, "monitor:99:8k:999hz")).toBe(null);
  });

  it("writes blended values once enough samples exist", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    const prices = Array(20).fill(20000);
    await updateLearned(env.DB, "monitor:27:1440p:240hz", "monitor", prices, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:240hz");
    expect(row.typical_cents).toBe(20000);
    expect(row.origin).toBe("learned");
    expect(row.sample_count).toBe(20);
  });

  it("creates a row for a spec key that was never seeded", async () => {
    const prices = Array(20).fill(15000);
    await updateLearned(env.DB, "monitor:27:1440p:390hz", "monitor", prices, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:390hz");
    expect(row.typical_cents).toBe(15000);
  });
});
