// Browser smoke test for the public website, served locally from website/dist.
//   node website/tests/smoke.mjs [screenshotDir]
// Desktop (1440x900) and mobile (375x812): every request succeeds, no console
// errors, Log in visible and pointing to the app, the mobile menu exposes it, no
// horizontal scroll, every in-page link lands on its target, and the
// walkthrough planner only downloads a brief and says no enquiry was sent.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const shots = process.argv[2] ?? null;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(dist, rel);
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (ok, name, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const failed = [];
  const errors = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  // Never leave the site during the test: the app sign-in is checked by href.
  await page.route("https://taxiflow.co.za/**", (route) => route.abort());
  await page.goto(base, { waitUntil: "networkidle" });

  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.weight); });
  check(new Set(fonts).size >= 3, `${label}: Poppins loaded locally`, fonts.join(","));
  const images = await page.evaluate(() => [...document.images].filter((i) => i.loading !== "lazy").map((i) => i.complete && i.naturalWidth > 0));
  check(images.every(Boolean), `${label}: above-the-fold images decoded`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, `${label}: no horizontal scroll`, `overflow=${overflow}px`);

  const login = page.locator("header nav a", { hasText: "Log in" });
  check((await login.getAttribute("href")) === "https://taxiflow.co.za", `${label}: Log in points to https://taxiflow.co.za`);
  if (label === "mobile") {
    check(!(await login.isVisible()), "mobile: Log in sits in the closed menu");
    await page.getByRole("button", { name: "Open navigation" }).click();
    check(await login.isVisible(), "mobile: opening the menu shows Log in");
    const box = await login.boundingBox();
    check(box && box.height >= 40 && box.x >= 0 && box.x + box.width <= viewport.width, "mobile: Log in is a full tap target inside the screen", JSON.stringify(box));
    await page.getByRole("button", { name: "Close navigation" }).click();
  } else {
    check(await login.isVisible(), "desktop: Log in visible in the navigation");
  }
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-top.png`) });

  // Every in-page link lands on its target.
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")).filter((h) => h.length > 1))]);
  const missing = await page.evaluate((list) => list.filter((h) => !document.querySelector(h)), hrefs);
  check(missing.length === 0, `${label}: ${hrefs.length} in-page links have targets`, missing.join(","));

  // Walkthrough planner: open, prepare, download, honest status.
  const trigger = page.locator("[data-enquiry]:visible").first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const dialog = page.locator("#enquiry-dialog");
  check(await dialog.isVisible(), `${label}: walkthrough button opens the planner`);
  await page.selectOption("#fleet-size", { index: 1 });
  await page.selectOption("#priority", { index: 1 });
  await dialog.getByRole("button", { name: /Prepare my brief/ }).click();
  check(/No enquiry has been sent\./.test(await page.locator("#brief-text").textContent()), `${label}: brief says no enquiry has been sent`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-brief")]);
  check(download.suggestedFilename() === "TaxiFlow-Pro-Walkthrough-Brief.txt", `${label}: brief downloads locally`);
  check((await page.locator("#download-status").textContent()) === "Brief download started. No enquiry was sent.", `${label}: no false success message`);
  if (shots) await dialog.screenshot({ path: path.join(shots, `${label}-planner.png`) });
  await page.click(".dialog-close");

  // Sample-board and walkthrough controls respond.
  await page.click("#tab-fleet");
  check(await page.locator("#panel-fleet").isVisible(), `${label}: fleet tab shows the fleet sample`);
  await page.click("#next-step");
  check((await page.locator("#flow-status").textContent()) === "Counted", `${label}: walkthrough advances pending → counted`);

  check(failed.length === 0, `${label}: no failed requests`, failed.join(", "));
  check(errors.length === 0, `${label}: no console errors`, errors.join(" | "));
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-full.png`), fullPage: true });
  await context.close();
}
await browser.close();
server.close();
const failedCount = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failedCount}/${results.length} PASS`);
process.exit(failedCount ? 1 : 0);
