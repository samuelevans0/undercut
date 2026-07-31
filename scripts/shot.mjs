// Authenticated screenshot helper for local dev.
// Usage: node scripts/shot.mjs "#/" out.png [--width=390] [--height=844]
import puppeteer from "puppeteer";

const ORIGIN = process.env.UC_ORIGIN || "http://localhost:8787";
const PASSWORD = process.env.UC_PASSWORD || "screenshot-password-1234";

const args = process.argv.slice(2);
const hash = args[0] || "#/";
const output = args[1] || "shot.png";
const width = parseInt(args.find((a) => a.startsWith("--width="))?.split("=")[1] || "390", 10);
const height = parseInt(args.find((a) => a.startsWith("--height="))?.split("=")[1] || "844", 10);

async function login() {
  const body = JSON.stringify({ password: PASSWORD });
  // The origin header matters: the app rejects cross-origin writes.
  const headers = { "content-type": "application/json", origin: ORIGIN };

  // Claim on a fresh database, log in on every run after that.
  let res = await fetch(`${ORIGIN}/api/auth/setup`, { method: "POST", headers, body });
  if (res.status === 409) {
    res = await fetch(`${ORIGIN}/api/auth/login`, { method: "POST", headers, body });
  }
  if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie header in the auth response");
  const [name, value] = setCookie.split(";")[0].split("=");
  return { name, value };
}

const { name, value } = await login();
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.setCookie({ name, value, domain: "localhost", path: "/" });
  await page.goto(`${ORIGIN}/${hash}`, { waitUntil: "networkidle2", timeout: 30000 });
  // The hash router renders after load; give it a beat before capturing.
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: output, fullPage: false });
  console.log(`saved ${output}`);
} finally {
  await browser.close();
}
