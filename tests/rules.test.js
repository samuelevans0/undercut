import { describe, it, expect } from "vitest";
import { evaluateRules } from "../src/core/rules.js";

const deal = {
  cleanTitle: 'LG 27GR83Q 27" 1440p 240Hz IPS',
  category: "monitor",
  specKey: "monitor:27:1440p:240hz",
  priceCents: 6000,
  condition: "new",
  specs: { sizeInches: 27, refreshHz: 240, resolution: "1440p" },
};

const wl = (over) => ({ id: 1, label: "w", query: "", max_price_cents: null, ...over });
const rule = (over) => ({ id: 1, label: "r", category: "monitor", predicate_json: "[]", ...over });

describe("watchlist matching", () => {
  it("matches when every term appears", () => {
    const r = evaluateRules(deal, [wl({ query: "240hz monitor" })], []);
    expect(r.forceNotify).toBe(true);
    expect(r.matches[0].type).toBe("watchlist");
  });

  it("does not match when one term is missing", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz oled" })], []).forceNotify).toBe(false);
  });

  it("is case insensitive", () => {
    expect(evaluateRules(deal, [wl({ query: "LG 240HZ" })], []).forceNotify).toBe(true);
  });

  it("searches the spec key as well as the title", () => {
    expect(evaluateRules(deal, [wl({ query: "1440p" })], []).forceNotify).toBe(true);
  });

  it("honours max_price_cents", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz", max_price_cents: 5000 })], []).forceNotify).toBe(false);
    expect(evaluateRules(deal, [wl({ query: "240hz", max_price_cents: 20000 })], []).forceNotify).toBe(true);
  });

  it("parses an inline 'under $200' ceiling", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz monitor under $200" })], []).forceNotify).toBe(true);
    expect(evaluateRules(deal, [wl({ query: "240hz monitor under $50" })], []).forceNotify).toBe(false);
  });

  it("does not treat the price words as required search terms", () => {
    expect(evaluateRules(deal, [wl({ query: "lg under $200" })], []).forceNotify).toBe(true);
  });

  it("accepts the < shorthand however it is spaced", () => {
    // A \b in front of the whole alternation only holds when < is glued to a
    // word char, so these all failed and the phrase stayed a search term.
    for (const q of ["lg < 200", "lg <200", "240hz monitor <200", "lg<200"]) {
      expect(evaluateRules(deal, [wl({ query: q })], []).forceNotify).toBe(true);
    }
  });

  it("still enforces the ceiling when written with <", () => {
    expect(evaluateRules(deal, [wl({ query: "lg < 50" })], []).forceNotify).toBe(false);
  });

  it("accepts the below and less than variants", () => {
    expect(evaluateRules(deal, [wl({ query: "lg below 200" })], []).forceNotify).toBe(true);
    expect(evaluateRules(deal, [wl({ query: "lg less than $200" })], []).forceNotify).toBe(true);
  });

  it("ignores an empty query", () => {
    expect(evaluateRules(deal, [wl({ query: "   " })], []).forceNotify).toBe(false);
  });

  it("reports every match", () => {
    const r = evaluateRules(deal, [wl({ id: 1, query: "lg" }), wl({ id: 2, query: "240hz" })], []);
    expect(r.matches).toHaveLength(2);
  });
});

describe("rule matching", () => {
  it("matches a price ceiling in the right category", () => {
    const r = evaluateRules(deal, [], [rule({ predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(true);
    expect(r.matches[0].type).toBe("rule");
  });

  it("does not match a different category", () => {
    const r = evaluateRules(deal, [], [rule({ category: "ssd", predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(false);
  });

  it("matches any category with the wildcard", () => {
    const r = evaluateRules(deal, [], [rule({ category: "*", predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(true);
  });

  it("requires every clause to hold", () => {
    const both = JSON.stringify([
      { field: "priceCents", op: "lt", value: 20000 },
      { field: "refreshHz", op: "gte", value: 240 },
    ]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: both })]).forceNotify).toBe(true);

    const impossible = JSON.stringify([
      { field: "priceCents", op: "lt", value: 20000 },
      { field: "refreshHz", op: "gte", value: 360 },
    ]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: impossible })]).forceNotify).toBe(false);
  });

  it("reads fields out of specs", () => {
    const p = JSON.stringify([{ field: "resolution", op: "eq", value: "1440p" }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(true);
  });

  it("does not match when a field is absent", () => {
    const p = JSON.stringify([{ field: "capacityGb", op: "gte", value: 2048 }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(false);
  });

  it("survives malformed predicate json without throwing", () => {
    expect(evaluateRules(deal, [], [rule({ predicate_json: "{{{" })]).forceNotify).toBe(false);
  });

  it("ignores an unknown operator", () => {
    const p = JSON.stringify([{ field: "priceCents", op: "wat", value: 1 }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(false);
  });

  it("treats an empty clause list as no match", () => {
    expect(evaluateRules(deal, [], [rule({ predicate_json: "[]" })]).forceNotify).toBe(false);
  });
});

describe("no configuration", () => {
  it("returns false with nothing configured", () => {
    const r = evaluateRules(deal, [], []);
    expect(r.forceNotify).toBe(false);
    expect(r.matches).toEqual([]);
  });
});
