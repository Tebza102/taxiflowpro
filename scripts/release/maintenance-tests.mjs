#!/usr/bin/env node
// Local proof for deploy/maintenance (no network, no Vercel):
// 1. A "legacy" site on 127.0.0.1 registers the LEGACY service worker taken from
//    the legacy production commit (git show 008ce8e:public/sw.js), which caches
//    the app shell and falls back to it whenever a navigation is not OK.
// 2. The same origin then switches to the maintenance build, routed exactly as
//    deploy/maintenance/vercel.json says.
// 3. In Chromium: the installed legacy client must end up showing the
//    maintenance page (not the cached legacy app), with every cache deleted and
//    no service worker left; /api/* answers 503 JSON; assets of the legacy
//    build are not served; the page has no scripts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { sendStatic } from "./lib/staticRoutes.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAINT = path.join(REPO_ROOT, "deploy/maintenance");
const routes = JSON.parse(readFileSync(path.join(MAINT, "vercel.json"), "utf8")).routes;
const legacySw = execFileSync("git", ["show", "008ce8e:public/sw.js"], { cwd: REPO_ROOT, encoding: "utf8" });

const LEGACY_HTML = `<!doctype html><html><head><title>LEGACY APP</title><script type="module" src="/assets/index-legacy.js"></script></head><body><h1>LEGACY APP</h1></body></html>`;
let mode = "legacy";
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (mode === "legacy") {
    if (pathname === "/sw.js") return res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }).end(legacySw);
    if (pathname === "/assets/index-legacy.js") return res.writeHead(200, { "content-type": "application/javascript" }).end("navigator.serviceWorker.register('/sw.js');");
    if (pathname === "/manifest.webmanifest") return res.writeHead(200, { "content-type": "application/manifest+json" }).end("{}");
    if (pathname.startsWith("/pwa-")) return res.writeHead(200, { "content-type": "image/png" }).end("");
    return res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(LEGACY_HTML);
  }
  sendStatic(res, MAINT, routes, pathname);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const results = [];
const record = (ok, name, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Legacy install: service worker active and the app shell cached.
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && Boolean((await (await caches.open((await caches.keys())[0])).match("/"))));
  const legacyState = await page.evaluate(async () => ({ controlled: Boolean(navigator.serviceWorker.controller), caches: await caches.keys() }));
  record(legacyState.controlled && legacyState.caches.length > 0, "setup: the legacy service worker controls the page and has cached the legacy app shell", JSON.stringify(legacyState.caches));

  // Evidence that the risk is real: a non-OK navigation shows the cached legacy app.
  mode = "maintenance-503";
  const original = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => res.writeHead(503, { "content-type": "text/html" }).end("<h1>503</h1>"));
  await page.reload();
  record((await page.title()) === "LEGACY APP", "evidence: a 503 maintenance page would let the legacy worker show the cached legacy app", await page.title());
  server.removeAllListeners("request");
  server.on("request", original);

  // 2. Switch the origin to the maintenance build.
  mode = "maintenance";
  await page.reload();
  await page.waitForFunction(() => document.title.includes("upgrade in progress"), null, { timeout: 15_000 });
  // Poll explicitly (the maintenance worker reloads the page while it removes itself).
  const timeline = [];
  for (let i = 0; i < 40; i += 1) {
    const state = await page
      .evaluate(async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        return { regs: regs.length, active: regs[0]?.active?.scriptURL ? "yes" : "no", waiting: Boolean(regs[0]?.waiting), installing: Boolean(regs[0]?.installing), caches: (await caches.keys()).length, title: document.title };
      })
      .catch(() => ({ navigating: true }));
    timeline.push(JSON.stringify(state));
    if (state.regs === 0 && state.caches === 0) break;
    await page.waitForTimeout(500);
  }
  if (process.env.MAINT_DEBUG) console.log(timeline.join("\n"));
  const after = await page.evaluate(async () => ({
    title: document.title,
    heading: document.querySelector("h1")?.textContent,
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
    scripts: document.scripts.length,
  }));
  record(after.title.includes("upgrade in progress") && /upgrading/.test(after.heading ?? ""), "an installed legacy client now shows the maintenance page", after.heading);
  record(after.registrations === 0 && after.caches.length === 0, "the legacy worker is replaced, all caches are deleted, and no worker remains", JSON.stringify({ registrations: after.registrations, caches: after.caches }));
  record(after.scripts === 0, "the maintenance page runs no scripts and loads no app code");

  // Offline after maintenance: nothing legacy left to fall back to.
  await context.setOffline(true);
  const offline = await page.reload().then(() => page.title()).catch(() => "network error (no cached app)");
  record(!/LEGACY/.test(offline), "offline, the browser has no cached legacy app to show", offline);
  await context.setOffline(false);

  // 3. HTTP behaviour of the maintenance routes.
  const get = async (pathname) => {
    const response = await fetch(`${origin}${pathname}`);
    return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), retry: response.headers.get("retry-after"), body: await response.text() };
  };
  const root = await get("/");
  record(root.status === 200 && /no-store/.test(root.cache ?? "") && /upgrading/.test(root.body), "/ answers 200 no-store with the maintenance page (so legacy workers never fall back)");
  const deep = await get("/finance/day/2026-10-11");
  record(deep.status === 200 && /upgrading/.test(deep.body), "deep links show the maintenance page");
  for (const apiPath of ["/api/business/workspace", "/api/admin/auth-users", "/api"]) {
    const api = await get(apiPath);
    record(api.status === 503 && /json/.test(api.type ?? "") && JSON.parse(api.body).maintenance === true && api.retry === "3600", `${apiPath} answers 503 JSON maintenance`);
  }
  const asset = await get("/assets/index-DguJu-LE.js");
  record(!/javascript/.test(asset.type ?? "") && /upgrading/.test(asset.body), "the legacy build's assets are not served");
  const sw = await get("/sw.js");
  record(sw.status === 200 && /javascript/.test(sw.type ?? "") && /no-store/.test(sw.cache ?? "") && /unregister/.test(sw.body), "/sw.js is the self-removing maintenance worker, served no-store");
  const config = await get("/vercel.json");
  record(config.status === 404, "the deployment config file is not served");
  const icon = await get("/brand/icon-192.png");
  record(icon.status === 200 && icon.type === "image/png", "brand icon is served");
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
