#!/usr/bin/env node
// Generates the TaxiFlow web brand assets from the APPROVED originals in
// assets/brand/source/ (Task 19). Deterministic; re-run after an approved
// artwork change:  node scripts/brand/generate-brand-assets.mjs
//
// Rules: crop only near-white margins, never stretch (one uniform scale per
// output), never redraw. The only pixel change is mapping the source's
// off-white background (RGB ~253) and near-white margins (every channel >= 250)
// to pure white, so icons sit on solid white; artwork colours are untouched.
//
// The symbol for icons is taken from the approved full logo, where the same
// artwork is 870 px wide; the separate approved symbol image is 289 px wide,
// too small for the 512 px icons without upscaling. The two were compared
// (aspect 2.219 vs 2.206, mean channel difference about 2% after resampling).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { artworkBounds, crop, onWhiteSquare, readRgba, resizePng, writePng } from "./lib/raw.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(ROOT, "assets/brand/source/taxiflow-logo-full-approved.webp");
const PUBLIC = path.join(ROOT, "public");
const BRAND = path.join(PUBLIC, "brand");
const WORK = mkdtempSync(path.join(os.tmpdir(), "taxiflow-brand-"));
mkdirSync(BRAND, { recursive: true });

const whiten = (image) => {
  const data = Buffer.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
    data[i + 3] = 255;
  }
  return { ...image, data };
};

const full = whiten(readRgba(SOURCE));
const report = { source: { file: path.relative(ROOT, SOURCE).split(path.sep).join("/"), width: full.width, height: full.height }, outputs: [] };
const note = (file, width, height, extra = {}) => report.outputs.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), width, height, ...extra });

// --- Full logo: artwork bounds plus a small white margin --------------------------------
const logoBounds = artworkBounds(full, 24);
const margin = 24;
const logo = crop(
  full,
  Math.max(0, logoBounds.minX - margin),
  Math.max(0, logoBounds.minY - margin),
  Math.min(full.width - Math.max(0, logoBounds.minX - margin), logoBounds.width + margin * 2),
  Math.min(full.height - Math.max(0, logoBounds.minY - margin), logoBounds.height + margin * 2),
);
const logoFile = path.join(BRAND, "taxiflow-logo.png");
writePng(logoFile, logo);
note(logoFile, logo.width, logo.height, { use: "login, app header, reports and PDF (full logo, native resolution)" });

// --- Symbol: the TF mark above the wordmark (rows above y=625 in the source) ------------
const symbolBounds = artworkBounds(full, 24, [0, 0, full.width, 625]);
const symbol = crop(full, symbolBounds.minX, symbolBounds.minY, symbolBounds.width, symbolBounds.height);
const symbolFile = path.join(WORK, "symbol-full-res.png");
writePng(symbolFile, symbol);
const aspect = symbol.width / symbol.height;
report.symbol = { width: symbol.width, height: symbol.height, aspect: Number(aspect.toFixed(3)) };

// Symbol scaled uniformly to `width`, centred on a white square of `size`.
const icon = (size, width, name, extra) => {
  const height = Math.round(width / aspect);
  const scaled = path.join(WORK, `symbol-${width}.png`);
  resizePng(symbolFile, scaled, width, height);
  const square = onWhiteSquare(readRgba(scaled), size);
  const file = path.join(BRAND, name);
  writePng(file, square);
  note(file, size, size, { symbolWidth: width, symbolHeight: height, ...extra });
  return file;
};

// Favicons: the wide mark uses the full width for legibility at 16-48 px.
const favicons = [16, 32, 48].map((size) => icon(size, size, `favicon-${size}.png`, { use: "favicon.ico frame" }));
icon(180, 152, "apple-touch-icon.png", { use: "Apple touch icon (iOS rounds the corners)" });
icon(192, 168, "icon-192.png", { use: "PWA icon, purpose any" });
icon(512, 448, "icon-512.png", { use: "PWA icon, purpose any" });
// Maskable: the whole mark must sit inside the central safe circle (diameter
// 80% of the icon). A w x h box fits a circle of diameter d when w^2 + h^2 <= d^2.
const maskable = (size) => {
  const safeDiameter = size * 0.8;
  const maxWidth = Math.floor(safeDiameter / Math.sqrt(1 + 1 / (aspect * aspect)));
  const width = Math.floor(maxWidth * 0.96);
  return icon(size, width, `icon-maskable-${size}.png`, { use: "PWA icon, purpose maskable", safeZoneDiameter: safeDiameter, diagonal: Math.round(Math.hypot(width, width / aspect)) });
};
maskable(192);
maskable(512);

// favicon.ico with PNG-encoded 16, 32 and 48 px frames (supported by current
// browsers and Windows).
const frames = favicons.map((file) => readFileSync(file));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const size = [16, 32, 48][index];
  const entry = 6 + index * 16;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
const icoFile = path.join(PUBLIC, "favicon.ico");
writeFileSync(icoFile, Buffer.concat([header, ...frames]));
note(icoFile, 48, 48, { frames: [16, 32, 48] });

writeFileSync(path.join(ROOT, "assets/brand/brand-assets.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
