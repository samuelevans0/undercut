// Pure. No I/O. Title -> category + reference-price bucket.

const TAG_MAP = {
  monitor: "monitor", display: "monitor",
  ssd: "ssd", hdd: "ssd", storage: "ssd",
  gpu: "gpu", "video card": "gpu",
  cpu: "cpu", motherboard: "motherboard", mobo: "motherboard",
  ram: "ram", memory: "ram", psu: "psu", case: "case", cooler: "cooler",
  keyboard: "keyboard", mouse: "mouse", headset: "headset", headphones: "audio",
  audio: "audio", speakers: "audio", webcam: "webcam", microphone: "audio",
};

const RESOLUTIONS = [
  [/\b(3840\s?x\s?2160|4k|uhd)\b/i, "4k"],
  [/\b(2560\s?x\s?1440|1440p|qhd|wqhd)\b/i, "1440p"],
  [/\b(3440\s?x\s?1440|uwqhd)\b/i, "1440p"],
  [/\b(1920\s?x\s?1080|1080p|fhd)\b/i, "1080p"],
];

function inferCategory(t) {
  if (/\b\d{2,3}\s?hz\b/i.test(t) && /\b\d{2}(?:"|\s?inch|-inch)/i.test(t)) return "monitor";
  if (/\b(nvme|m\.2|sata)\b/i.test(t) && /\b(ssd|\d+\s?(gb|tb))\b/i.test(t)) return "ssd";
  if (/\b(rtx|gtx|radeon\s+rx|arc\s+a)\s?\d{3,4}/i.test(t)) return "gpu";
  if (/\b(ryzen|core\s+i[3579]|i[3579]-\d{4,5})\b/i.test(t)) return "cpu";
  if (/\bmouse\b|\bsuperlight\b/i.test(t)) return "mouse";
  if (/\bkeyboard\b|\bkeycaps?\b/i.test(t)) return "keyboard";
  if (/\bheadset\b/i.test(t)) return "headset";
  if (/\bheadphones?\b|\bearbuds?\b|\bspeakers?\b|\bdac\b/i.test(t)) return "audio";
  if (/\bwebcam\b/i.test(t)) return "webcam";
  if (/\bmotherboard\b/i.test(t)) return "motherboard";
  if (/\b(ddr[45])\b/i.test(t)) return "ram";
  if (/\bpsu\b|\bpower supply\b/i.test(t)) return "psu";
  if (/\b(aio|air cooler|cpu cooler)\b/i.test(t)) return "cooler";
  return "unknown";
}

function monitorSpecs(t) {
  const size = t.match(/\b(\d{2})\s?("|inch|-inch)/i);
  const refresh = t.match(/\b(\d{2,3})\s?hz\b/i);
  let resolution = null;
  for (const [re, name] of RESOLUTIONS) if (re.test(t)) { resolution = name; break; }
  const specs = {
    sizeInches: size ? parseInt(size[1], 10) : null,
    resolution,
    refreshHz: refresh ? parseInt(refresh[1], 10) : null,
  };
  const key = specs.sizeInches && specs.resolution && specs.refreshHz
    ? `monitor:${specs.sizeInches}:${specs.resolution}:${specs.refreshHz}hz`
    : null;
  return { specs, specKey: key };
}

function ssdSpecs(t) {
  const cap = t.match(/\b(\d+(?:\.\d+)?)\s?(tb|gb)\b/i);
  const iface = /\b(nvme|m\.2)\b/i.test(t) ? "nvme" : /\bsata\b/i.test(t) ? "sata" : null;
  let capacityGb = null;
  let label = null;
  if (cap) {
    const n = parseFloat(cap[1]);
    const isTb = cap[2].toLowerCase() === "tb";
    capacityGb = isTb ? Math.round(n * 1024) : Math.round(n);
    label = isTb ? `${n}tb` : `${n}gb`;
  }
  const specs = { capacityGb, interface: iface };
  return { specs, specKey: iface && label ? `ssd:${iface}:${label}` : null };
}

function gpuSpecs(t) {
  const m = t.match(/\b(rtx|gtx|rx|arc)\s?(\d{3,4})\s?(super|ti|xt|xtx)?\b/i);
  if (!m) return { specs: {}, specKey: null };
  const model = `${m[1]}${m[2]}${m[3] ?? ""}`.toLowerCase().replace(/\s+/g, "");
  return { specs: { model }, specKey: `gpu:${model}` };
}

export function classify(cleanTitle, hints = {}) {
  const t = typeof cleanTitle === "string" ? cleanTitle : "";
  const tag = hints.tag ? String(hints.tag).toLowerCase().trim() : null;
  const category = (tag && TAG_MAP[tag]) || inferCategory(t);

  let detail = { specs: {}, specKey: null };
  if (category === "monitor") detail = monitorSpecs(t);
  else if (category === "ssd") detail = ssdSpecs(t);
  else if (category === "gpu") detail = gpuSpecs(t);

  return { category, specKey: detail.specKey, specs: detail.specs };
}
