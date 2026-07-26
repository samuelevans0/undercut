import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
import sql from "../schema.sql?raw";

beforeAll(async () => {
  for (const stmt of sql.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed) await env.DB.prepare(trimmed).run();
  }
});
