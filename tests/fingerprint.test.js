import { describe, it, expect } from "vitest";
import { fingerprint } from "../src/core/fingerprint.js";

const base = {
  cleanTitle: 'LG 27GR83Q 27" 1440p 240Hz IPS',
  merchant: "Amazon",
  category: "monitor",
  specKey: "monitor:27:1440p:240hz",
};

describe("fingerprint", () => {
  it("is stable for identical input", async () => {
    expect(await fingerprint(base)).toBe(await fingerprint(base));
  });

  it("is 32 hex characters", async () => {
    expect(await fingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("ignores price entirely", async () => {
    const a = await fingerprint({ ...base, priceCents: 6000 });
    const b = await fingerprint({ ...base, priceCents: 5000 });
    expect(a).toBe(b);
  });

  it("ignores case, punctuation, and extra whitespace", async () => {
    const a = await fingerprint(base);
    const b = await fingerprint({ ...base, cleanTitle: 'lg  27gr83q -- 27" 1440p, 240hz  IPS!' });
    expect(a).toBe(b);
  });

  it("differs for a different merchant", async () => {
    expect(await fingerprint(base)).not.toBe(await fingerprint({ ...base, merchant: "Newegg" }));
  });

  it("differs for a different spec bucket", async () => {
    expect(await fingerprint(base)).not.toBe(
      await fingerprint({ ...base, specKey: "monitor:27:1440p:144hz" })
    );
  });

  it("treats a missing merchant as its own stable value", async () => {
    const a = await fingerprint({ ...base, merchant: null });
    const b = await fingerprint({ ...base, merchant: undefined });
    expect(a).toBe(b);
    expect(a).not.toBe(await fingerprint(base));
  });
});
