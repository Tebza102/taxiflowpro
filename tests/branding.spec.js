import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

// TaxiFlow branding smoke checks (Task 19), demo mode: approved logo shown at
// its own proportions without clipping, icons referenced and sized correctly on
// solid white, favicon frames, and the logo embedded in the A4 PDF.
// Screenshots go to test-results/branding/ for visual review.

const PASSWORD = "TaxiFlow.123";
const LOGO_RATIO = 1268 / 735;
const SHOTS = "test-results/branding";
mkdirSync(SHOTS, { recursive: true });

const signIn = async (page, email) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

// Rendered logo: loaded, displayed at the artwork's proportions (no stretch),
// fully inside the viewport horizontally (no clipping).
const expectLogo = async (page, selector) => {
  const logo = page.locator(selector).first();
  await expect(logo).toBeVisible();
  const info = await logo.evaluate((img) => {
    const box = img.getBoundingClientRect();
    return {
      src: new URL(img.currentSrc).pathname,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: box.width,
      height: box.height,
      left: box.left,
      right: box.right,
      viewport: window.innerWidth,
      objectFit: getComputedStyle(img).objectFit,
    };
  });
  expect(info.src).toBe("/brand/taxiflow-logo.png");
  expect(info.complete && info.naturalWidth === 1268 && info.naturalHeight === 735).toBe(true);
  expect(Math.abs(info.width / info.height - LOGO_RATIO) / LOGO_RATIO).toBeLessThan(0.02);
  expect(info.left).toBeGreaterThanOrEqual(0);
  expect(info.right).toBeLessThanOrEqual(info.viewport);
  return info;
};

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 375, height: 812 }]) {
  test(`approved logo on login and app header (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
    const login = await expectLogo(page, "img.auth-logo");
    await page.screenshot({ path: `${SHOTS}/login-${viewport.name}.png` });

    await signIn(page, "owner@taxiflow.local");
    const header = await expectLogo(page, "img.toolbar-logo");
    await page.screenshot({ path: `${SHOTS}/header-${viewport.name}.png` });
    console.log(`[branding] ${viewport.name}: login ${Math.round(login.width)}x${Math.round(login.height)}, header ${Math.round(header.width)}x${Math.round(header.height)}`);
  });
}

test("icons: manifest, apple touch icon and favicon sizes on solid white", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const decode = async (src) => {
      const blob = await (await fetch(src, { cache: "no-store" })).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const corners = [[0, 0], [bitmap.width - 1, 0], [0, bitmap.height - 1], [bitmap.width - 1, bitmap.height - 1]]
        .map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
      return { src, type: blob.type, width: bitmap.width, height: bitmap.height, corners };
    };
    const manifest = await (await fetch("/manifest.webmanifest", { cache: "no-store" })).json();
    const icons = [];
    for (const icon of manifest.icons) icons.push({ ...(await decode(icon.src)), sizes: icon.sizes, purpose: icon.purpose });
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    const apple = await decode(appleLink.getAttribute("href"));
    const ico = new DataView(await (await fetch("/favicon.ico", { cache: "no-store" })).arrayBuffer());
    const frames = Array.from({ length: ico.getUint16(4, true) }, (_, i) => ico.getUint8(6 + i * 16));
    return {
      icons,
      apple: { ...apple, sizes: appleLink.getAttribute("sizes") },
      frames,
      iconLinks: Array.from(document.querySelectorAll('link[rel="icon"]')).map((l) => l.getAttribute("href")),
    };
  });

  const white = [255, 255, 255, 255];
  for (const icon of result.icons) {
    expect(icon.type).toBe("image/png");
    expect(`${icon.width}x${icon.height}`).toBe(icon.sizes);
    icon.corners.forEach((corner) => expect(corner).toEqual(white));
  }
  expect(result.icons.map((i) => `${i.sizes}:${i.purpose}`).sort()).toEqual(["192x192:any", "192x192:maskable", "512x512:any", "512x512:maskable"]);
  expect(result.apple.sizes).toBe("180x180");
  expect(`${result.apple.width}x${result.apple.height}`).toBe("180x180");
  result.apple.corners.forEach((corner) => expect(corner).toEqual(white));
  expect(result.frames).toEqual([16, 32, 48]);
  expect(result.iconLinks).toEqual(["/favicon.ico", "/brand/favicon-32.png"]);
});

test("report preview and A4 PDF carry the approved logo", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await page.locator("button.module-button").filter({ hasText: "Reports" }).first().click();
  await expect(page.getByTestId("reports-preview").getByText("Expected cash hand-in")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/report-preview.png`, fullPage: false });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("reports-download").click();
  const download = await downloadPromise;
  const buffer = await readFile(await download.path());
  await writeFile(`${SHOTS}/report.pdf`, buffer);
  const text = buffer.toString("latin1");
  expect(text).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  const image = /\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)|\/Width (\d+)[\s\S]*?\/Height (\d+)[\s\S]*?\/Subtype \/Image/.exec(text);
  expect(image).not.toBeNull();
  const [width, height] = (image[1] ? [image[1], image[2]] : [image[3], image[4]]).map(Number);
  expect([width, height]).toEqual([1268, 735]);
});
