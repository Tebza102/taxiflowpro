#!/usr/bin/env node
// Builds supabase/release/tenant-pilot/01_tenant_foundation.sql from the TESTED
// local foundation core (schema, mapping, backfill, helpers, triggers) plus the
// hosted access section written against the live inventory. Re-run after any
// change to either part; the output is committed and reviewed as SQL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const local = readFileSync(path.join(ROOT, "scripts/localdb/migrations/20261010003451_tenant_foundation.sql"), "utf8").replace(/\r\n/g, "\n").split("\n");
const start = local.findIndex((line) => line.startsWith("create schema if not exists taxiflow_private"));
const end = local.findIndex((line) => line.startsWith("-- Owner-only membership administration"));
if (start < 0 || end < 0) throw new Error("Local foundation markers not found.");
const core = local.slice(start, end).join("\n").trimEnd();
const hostedAccess = readFileSync(path.join(ROOT, "scripts/localdb/hosted-copy/hosted-access.sql"), "utf8").replace(/\r\n/g, "\n");
const header = readFileSync(path.join(ROOT, "scripts/localdb/hosted-copy/hosted-header.sql"), "utf8").replace(/\r\n/g, "\n");

const out = `${header.trimEnd()}\n\n-- === Core: copied unchanged from the local foundation (lines ${start + 1}-${end}) ===\n${core}\n\n${hostedAccess.trimEnd()}\n`;
mkdirSync(path.join(ROOT, "supabase/release/tenant-pilot"), { recursive: true });
writeFileSync(path.join(ROOT, "supabase/release/tenant-pilot/01_tenant_foundation.sql"), out);
console.log(`written: ${out.split("\n").length} lines (core ${end - start} lines)`);
