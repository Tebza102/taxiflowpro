import { createServer } from "vite";

// Loads the app's own normalizers (src/lib/appRuntime.js, browser module) in
// Node through Vite SSR, the same way tests/finance-capture-parity.test.mjs does,
// so operator tooling produces exactly the records the app produces.
export const loadAppRuntime = async () => {
  const vite = await createServer({
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const module = await vite.ssrLoadModule("/src/lib/appRuntime.js");
  const rt = {
    buildRouteReferenceId: module.buildRouteReferenceId,
    getRouteStops: module.getRouteStops,
    normalizeRouteMasterRecord: module.normalizeRouteMasterRecord,
    normalizeVehicleCapabilityHooks: module.normalizeVehicleCapabilityHooks,
    normalizeExpensePresetCatalog: module.normalizeExpensePresetCatalog,
  };
  for (const [name, fn] of Object.entries(rt)) {
    if (typeof fn !== "function") throw new Error(`appRuntime does not export ${name}.`);
  }
  return { rt, close: () => vite.close() };
};
