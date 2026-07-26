import { describe, it, expect } from "vitest";
import { scoreDeal } from "../src/core/score.js";
import { CATEGORY_WEIGHTS } from "../src/config.js";

const W = CATEGORY_WEIGHTS;

function base(over = {}) {
  return {
    priceCents: 6000,
    wasPriceCents: 39900,
    category: "monitor",
    condition: "new",
    reference: { typicalCents: 32000, floorCents: 19800 },
    heat: { velocity: 2, baseline: 1 },
    sellerRating: null,
    weights: W,
    ...over,
  };
}

function points(result, key) {
  return result.reasons.find((r) => r.key === key)?.points ?? 0;
}

describe("scoreDeal, the headline case", () => {
  it("scores the $60 240Hz monitor at a capped 100", () => {
    const r = scoreDeal(base());
    expect(points(r, "outlier")).toBe(50);
    expect(points(r, "discount")).toBe(25);
    expect(points(r, "heat")).toBe(20);
    expect(r.subtotal).toBe(95);
    expect(points(r, "category")).toBe(19);
    expect(r.score).toBe(100);
    expect(r.capped).toBe(true);
  });
});

describe("outlier component", () => {
  it("gives zero at or above the floor", () => {
    expect(points(scoreDeal(base({ priceCents: 19800 })), "outlier")).toBe(0);
    expect(points(scoreDeal(base({ priceCents: 25000 })), "outlier")).toBe(0);
  });

  it("scales linearly below the floor", () => {
    // 35% below floor is half of the 70% needed for full marks.
    const r = scoreDeal(base({ priceCents: Math.round(19800 * 0.65), heat: null, wasPriceCents: null }));
    expect(points(r, "outlier")).toBe(25);
  });

  it("caps at 50", () => {
    expect(points(scoreDeal(base({ priceCents: 1 })), "outlier")).toBe(50);
  });

  it("gives zero with no reference data", () => {
    expect(points(scoreDeal(base({ reference: null })), "outlier")).toBe(0);
  });

  it("gives zero when the floor is zero or missing", () => {
    expect(points(scoreDeal(base({ reference: { typicalCents: 100, floorCents: 0 } })), "outlier")).toBe(0);
  });
});

describe("discount component", () => {
  it("gives zero without a was-price", () => {
    expect(points(scoreDeal(base({ wasPriceCents: null })), "discount")).toBe(0);
  });

  it("scales linearly", () => {
    // 30% off is half of the 60% needed for full marks.
    const r = scoreDeal(base({ priceCents: 7000, wasPriceCents: 10000 }));
    expect(points(r, "discount")).toBe(13);
  });

  it("caps at 25", () => {
    expect(points(scoreDeal(base({ priceCents: 100, wasPriceCents: 100000 })), "discount")).toBe(25);
  });

  it("gives zero when the was-price is not higher", () => {
    expect(points(scoreDeal(base({ priceCents: 5000, wasPriceCents: 5000 })), "discount")).toBe(0);
  });
});

describe("heat component", () => {
  it("gives zero with no heat data", () => {
    expect(points(scoreDeal(base({ heat: null })), "heat")).toBe(0);
  });

  it("gives half marks at baseline velocity", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 1, baseline: 1 } })), "heat")).toBe(10);
  });

  it("caps at 20 above twice baseline", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 99, baseline: 1 } })), "heat")).toBe(20);
  });

  it("gives zero when the baseline is zero", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 5, baseline: 0 } })), "heat")).toBe(0);
  });
});

describe("weights and penalties", () => {
  it("applies the category weight as a delta reason", () => {
    const r = scoreDeal(base({ category: "ram", heat: null, wasPriceCents: null, priceCents: 19800 }));
    expect(r.subtotal).toBe(0);
    expect(points(r, "category")).toBe(0);
  });

  it("penalises refurbished", () => {
    const neu = scoreDeal(base({ priceCents: 15000 }));
    const ref = scoreDeal(base({ priceCents: 15000, condition: "refurb" }));
    expect(neu.score - ref.score).toBe(3);
  });

  it("penalises used and open box the same as refurbished", () => {
    const used = scoreDeal(base({ priceCents: 15000, condition: "used" }));
    const open = scoreDeal(base({ priceCents: 15000, condition: "openbox" }));
    expect(used.score).toBe(open.score);
  });

  it("penalises an unknown category by 10", () => {
    const r = scoreDeal(base({ category: "unknown", priceCents: 15000 }));
    expect(points(r, "penalty")).toBe(-10);
  });

  it("penalises a weak seller rating", () => {
    const good = scoreDeal(base({ priceCents: 15000, sellerRating: 99.5 }));
    const weak = scoreDeal(base({ priceCents: 15000, sellerRating: 90 }));
    expect(good.score - weak.score).toBe(5);
  });

  it("never returns a negative score", () => {
    const r = scoreDeal(base({
      priceCents: 32000, wasPriceCents: null, heat: null,
      category: "unknown", condition: "used", sellerRating: 50,
    }));
    expect(r.score).toBe(0);
  });

  it("marks capped only when the raw total exceeded 100", () => {
    expect(scoreDeal(base({ priceCents: 15000 })).capped).toBe(false);
  });
});

describe("a mediocre deal must not fire", () => {
  it("scores a 10% discount on a mid-price monitor well under the threshold", () => {
    const r = scoreDeal(base({
      priceCents: 29000, wasPriceCents: 32000,
      heat: { velocity: 0.2, baseline: 1 },
    }));
    expect(r.score).toBeLessThan(30);
  });
});

describe("cold start", () => {
  it("still scores usefully on a stated discount alone", () => {
    const r = scoreDeal(base({ reference: null, heat: null, priceCents: 10000, wasPriceCents: 40000 }));
    expect(points(r, "discount")).toBe(25);
    expect(r.score).toBe(30);
  });
});
