import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-session-secret",
          POLL_SECRET: "test-poll-secret",
          PUBLIC_ORIGIN: "https://undercut.test",
          VAPID_PUBLIC_KEY: "test-vapid-public",
          VAPID_PRIVATE_KEY: "{}",
          VAPID_SUBJECT: "mailto:push@undercut.test",
        },
      },
    }),
  ],
  test: {},
});
