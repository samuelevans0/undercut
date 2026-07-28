import { redditAdapter } from "./reddit.js";
import { slickdealsAdapter } from "./slickdeals.js";
import { wootAdapter } from "./woot.js";
import { ebayAdapter } from "./ebay.js";

export const ADAPTERS = {
  reddit: redditAdapter,
  slickdeals: slickdealsAdapter,
  woot: wootAdapter,
  ebay: ebayAdapter,
};

export function getAdapter(id) {
  return ADAPTERS[id] ?? null;
}
