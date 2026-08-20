// Undercut cron pinger. Wakes the Pages app once a minute and fans out one
// signed request per source, so each feed parse gets its own CPU budget
// instead of four sources sharing one invocation.
//
// Pages Functions cannot run cron. This tiny Worker is the reason why.
// Deploy by pasting into the Cloudflare dashboard (Workers, Create, paste),
// then set UNDERCUT_ORIGIN and POLL_SECRET. This code should never need to change.

const SOURCES = ["reddit", "slickdeals", "woot", "ebay"];

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async scheduled(_event, env, ctx, fetchImpl = fetch) {
    if (!env.UNDERCUT_ORIGIN || !env.POLL_SECRET) {
      console.error("pinger not configured: UNDERCUT_ORIGIN and POLL_SECRET required");
      return;
    }
    const origin = env.UNDERCUT_ORIGIN.replace(/\/+$/, "");
    const timestamp = String(Math.floor(Date.now() / 1000));

    const work = SOURCES.map(async (sourceId) => {
      try {
        const signature = await hmacHex(env.POLL_SECRET, `${sourceId}.${timestamp}`);
        await fetchImpl(`${origin}/api/poll/${sourceId}`, {
          method: "POST",
          headers: { "x-uc-timestamp": timestamp, "x-uc-signature": signature },
        });
      } catch (e) {
        console.error(`poll ping failed for ${sourceId}`, e);
      }
    });

    ctx.waitUntil(Promise.allSettled(work));
    await Promise.allSettled(work);
  },
};
