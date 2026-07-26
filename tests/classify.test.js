import { describe, it, expect } from "vitest";
import { classify } from "../src/core/classify.js";

describe("classify category", () => {
  it("uses an explicit source tag when present", () => {
    expect(classify("LG 27GR83Q", { tag: "Monitor" }).category).toBe("monitor");
    expect(classify("Samsung 990 Pro", { tag: "SSD" }).category).toBe("ssd");
  });

  it("infers a monitor from specs in the title", () => {
    expect(classify('LG 27" 1440p 240Hz IPS').category).toBe("monitor");
  });

  it("infers an ssd", () => {
    expect(classify("Samsung 990 Pro 2TB NVMe M.2").category).toBe("ssd");
  });

  it("infers a gpu", () => {
    expect(classify("NVIDIA GeForce RTX 4070 Super 12GB").category).toBe("gpu");
    expect(classify("AMD Radeon RX 7800 XT").category).toBe("gpu");
  });

  it("infers a cpu", () => {
    expect(classify("AMD Ryzen 7 7800X3D").category).toBe("cpu");
    expect(classify("Intel Core i5-13600K").category).toBe("cpu");
  });

  it("infers peripherals", () => {
    expect(classify("Logitech G Pro X Superlight wireless mouse").category).toBe("mouse");
    expect(classify("Keychron Q1 mechanical keyboard").category).toBe("keyboard");
    expect(classify("SteelSeries Arctis Nova Pro headset").category).toBe("headset");
  });

  it("falls back to unknown", () => {
    expect(classify("Assorted mystery box").category).toBe("unknown");
  });

  it("recognises an Intel part with a suffix letter and no 'Core'", () => {
    // digit-to-letter is not a word boundary, so `i[3579]-\d{4,5}\b` never
    // matches "i5-13600K". Titles that omit "Core" hit only this branch.
    expect(classify("Intel i5-13600K Desktop Processor").category).toBe("cpu");
    expect(classify("Intel i7-12700KF").category).toBe("cpu");
    expect(classify("Intel i5-13600").category).toBe("cpu");
  });

  it("recognises a Radeon card written without the word Radeon", () => {
    expect(classify("XFX RX 7800 XT").category).toBe("gpu");
    expect(classify("Sapphire Pulse RX 7800 XT").specKey).toBe("gpu:rx7800xt");
  });

  it("does not file a motherboard as storage because it mentions M.2 and GB", () => {
    expect(classify("ASUS ROG Strix motherboard with M.2 slots, 32GB RAM kit").category)
      .toBe("motherboard");
  });

  it("prefers the tag over inference when they disagree", () => {
    expect(classify("RTX 4070 gaming monitor bundle", { tag: "Monitor" }).category).toBe("monitor");
  });
});

describe("classify spec keys", () => {
  it("buckets a monitor by size, resolution, and refresh", () => {
    const r = classify('LG 27GR83Q 27" 1440p 240Hz IPS', { tag: "Monitor" });
    expect(r.specKey).toBe("monitor:27:1440p:240hz");
    expect(r.specs).toMatchObject({ sizeInches: 27, resolution: "1440p", refreshHz: 240 });
  });

  it("normalises resolution synonyms", () => {
    expect(classify('Dell 32" 3840x2160 144Hz', { tag: "Monitor" }).specKey).toBe("monitor:32:4k:144hz");
    expect(classify('Acer 24" 1920x1080 165Hz', { tag: "Monitor" }).specKey).toBe("monitor:24:1080p:165hz");
    expect(classify('MSI 34" QHD 180Hz', { tag: "Monitor" }).specKey).toBe("monitor:34:1440p:180hz");
  });

  it("buckets an ssd by interface and capacity", () => {
    const r = classify("Samsung 990 Pro 2TB NVMe M.2", { tag: "SSD" });
    expect(r.specKey).toBe("ssd:nvme:2tb");
    expect(r.specs).toMatchObject({ capacityGb: 2048, interface: "nvme" });
  });

  it("treats sata separately from nvme", () => {
    expect(classify("Crucial MX500 1TB SATA SSD", { tag: "SSD" }).specKey).toBe("ssd:sata:1tb");
  });

  it("buckets a gpu by model", () => {
    expect(classify("MSI GeForce RTX 4070 Super Ventus 12GB").specKey).toBe("gpu:rtx4070super");
    expect(classify("Sapphire Radeon RX 7800 XT Pulse").specKey).toBe("gpu:rx7800xt");
  });

  it("returns a null spec key when specs are missing", () => {
    expect(classify("Some monitor", { tag: "Monitor" }).specKey).toBe(null);
  });

  it("returns a null spec key for unknown categories", () => {
    expect(classify("Assorted mystery box").specKey).toBe(null);
  });
});
