// Pure apart from WebCrypto hashing. Stable identity for a deal across sources.
// Price is deliberately excluded: a repost at a lower price must update the
// existing row, not create a second one.

const enc = new TextEncoder();

function normalise(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function fingerprint({ cleanTitle, merchant, category, specKey }) {
  const parts = [
    normalise(cleanTitle),
    normalise(merchant) || "nomerchant",
    normalise(category) || "unknown",
    normalise(specKey) || "nospec",
  ];
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(parts.join("|")));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
