import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// On Vercel, the SPA catch-all rewrite took precedence over the dynamic
// api/admin/daily-log/[id]/<name>.js routes, so reports returned index.html.
// Report routes now rewrite explicitly to static function files.
const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const rewrites = config.rewrites;

test("report URLs rewrite to existing static function files with the id as a query parameter", () => {
  for (const name of ["report-view", "report-pdf"]) {
    const rule = rewrites.find((r) => r.source === `/api/admin/daily-log/:id/${name}`);
    assert.ok(rule, `${name} rewrite exists`);
    assert.equal(rule.destination, `/api/admin/daily-log/${name}?id=:id`);
    assert.ok(existsSync(new URL(`../api/admin/daily-log/${name}.js`, import.meta.url)), `${name}.js exists`);
  }
  assert.ok(!existsSync(new URL("../api/admin/daily-log/[id]", import.meta.url)), "no dynamic [id] function directory remains");
});

test("the SPA catch-all never rewrites /api paths and comes last", () => {
  const last = rewrites[rewrites.length - 1];
  assert.equal(last.destination, "/index.html");
  const pattern = new RegExp(`^${last.source.replace(/^\//, "\\/")}$`);
  assert.ok(pattern.test("/finance") && pattern.test("/") && pattern.test("/reports/x"));
  for (const path of ["/api/business/workspace", "/api/admin/daily-log/x/report-view", "/api/admin/auth-users", "/api/admin/reports/period"]) {
    assert.ok(!pattern.test(path), `${path} is not sent to index.html`);
  }
  assert.ok(!rewrites.some((r) => r.source === "/api/admin/:path*"), "no self-rewrite of /api/admin");
});

test("the period report is served from its own static function file (no rewrite needed)", () => {
  assert.ok(existsSync(new URL("../api/admin/reports/period.js", import.meta.url)));
  assert.ok(!rewrites.some((r) => r.source.startsWith("/api/admin/reports")), "no rewrite shadows it");
});
