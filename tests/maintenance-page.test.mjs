import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { resolveStatic } from "../scripts/release/lib/staticRoutes.mjs";

const ROOT = new URL("../deploy/maintenance/", import.meta.url);
const read = (name) => readFileSync(new URL(name, ROOT), "utf8");
const root = decodeURIComponent(ROOT.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const config = JSON.parse(read("vercel.json"));

test("the maintenance deployment has no build, no functions and no secrets", () => {
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, "");
  assert.equal(config.installCommand, "");
  assert.equal(config.outputDirectory, ".");
  assert.ok(!existsSync(new URL("api", ROOT)), "no api/ folder, so no serverless functions");
  assert.ok(!existsSync(new URL("package.json", ROOT)), "no package.json, so nothing is installed");
  for (const name of readdirSync(ROOT).filter((file) => /\.(html|js|json)$/.test(file))) {
    assert.doesNotMatch(read(name), /supabase|sb_publishable|sb_secret|service_role|VITE_|process\.env/i, `${name} references no backend or key`);
  }
});

test("the maintenance page runs no scripts", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /noindex/);
});

test("navigations get 200 no-store (legacy workers only fall back to their cache on non-OK)", () => {
  for (const path of ["/", "/finance", "/assets/index-DguJu-LE.js"]) {
    const result = resolveStatic(root, config.routes, path);
    assert.equal(result.status, 200, path);
    assert.ok(result.file.endsWith("index.html"), path);
    assert.match(result.headers["cache-control"], /no-store/);
  }
});

test("every API path answers 503 JSON", () => {
  for (const path of ["/api", "/api/business/finance-actions", "/api/admin/daily-log/x/report-pdf"]) {
    const result = resolveStatic(root, config.routes, path);
    assert.equal(result.status, 503, path);
    assert.ok(result.file.endsWith("api-maintenance.json"));
    assert.match(result.headers["content-type"], /json/);
  }
});

test("the replacement /sw.js deletes caches, reloads clients and unregisters itself", () => {
  const sw = read("sw.js");
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /registration\.unregister\(\)/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.doesNotMatch(sw, /caches\.open|cache\.put|caches\.match/);
  const result = resolveStatic(root, config.routes, "/sw.js");
  assert.equal(result.status, 200);
  assert.ok(result.file.endsWith("sw.js"));
  assert.match(result.headers["cache-control"], /no-store/);
});
