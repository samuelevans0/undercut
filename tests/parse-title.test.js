import { describe, it, expect } from "vitest";
import { parseTitle } from "../src/core/parse-title.js";

describe("parseTitle price extraction", () => {
  it("pulls a simple price", () => {
    expect(parseTitle("Some Monitor - $279").priceCents).toBe(27900);
  });

  it("handles thousands separators and decimals", () => {
    expect(parseTitle("GPU - $1,299.99").priceCents).toBe(129999);
  });

  it("handles a whole-dollar price with no decimals", () => {
    expect(parseTitle("Mouse - $18").priceCents).toBe(1800);
  });

  it("returns null when there is no price", () => {
    expect(parseTitle("[Monitor] Discussion thread").priceCents).toBe(null);
  });

  it("takes the first price as current and the second as was-price", () => {
    const r = parseTitle('LG 27" 1440p 240Hz - $279 ($399)');
    expect(r.priceCents).toBe(27900);
    expect(r.wasPriceCents).toBe(39900);
  });

  it("understands an explicit was-price", () => {
    const r = parseTitle("SSD - $52 (was $169)");
    expect(r.priceCents).toBe(5200);
    expect(r.wasPriceCents).toBe(16900);
  });

  it("ignores a was-price that is not higher than the price", () => {
    expect(parseTitle("Thing - $50 ($40)").wasPriceCents).toBe(null);
  });

  it("does not treat a resolution or refresh figure as a price", () => {
    const r = parseTitle('[Monitor] Samsung 32" 4K 144Hz 1000R - $399');
    expect(r.priceCents).toBe(39900);
    expect(r.wasPriceCents).toBe(null);
  });
});

describe("parseTitle condition", () => {
  it("detects refurbished", () => {
    expect(parseTitle("Logitech G Pro X (Refurbished) - $18").condition).toBe("refurb");
    expect(parseTitle("Dell monitor refurb - $80").condition).toBe("refurb");
  });

  it("detects open box", () => {
    expect(parseTitle("RTX 4070 Super Open Box - $210").condition).toBe("openbox");
    expect(parseTitle("RTX 4070 open-box - $210").condition).toBe("openbox");
  });

  it("detects used", () => {
    expect(parseTitle("Used ThinkPad dock - $25").condition).toBe("used");
  });

  it("defaults to new", () => {
    expect(parseTitle("Brand new SSD - $52").condition).toBe("new");
  });
});

describe("parseTitle merchant and cleaning", () => {
  it("extracts a known merchant name", () => {
    expect(parseTitle("[SSD] Samsung 990 Pro 2TB - $52 (Amazon)").merchant).toBe("Amazon");
    expect(parseTitle("Monitor - $279 [Best Buy]").merchant).toBe("Best Buy");
  });

  it("returns null for an unknown merchant", () => {
    expect(parseTitle("Monitor - $279").merchant).toBe(null);
  });

  it("strips the leading category tag and the price tail", () => {
    expect(parseTitle('[Monitor] LG 27GR83Q 27" 1440p 240Hz - $279 ($399)').cleanTitle)
      .toBe('LG 27GR83Q 27" 1440p 240Hz');
  });

  it("survives an empty or junk title", () => {
    expect(parseTitle("").priceCents).toBe(null);
    expect(parseTitle(null).cleanTitle).toBe("");
  });
});
