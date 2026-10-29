import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server only: Vite does not run the Vercel functions in api/, so the two
// report routes are mapped to their real handlers here, mirroring the vercel.json
// rewrites /api/admin/daily-log/:id/<name> -> api/admin/daily-log/<name>.js?id=:id.
// Never part of a build.
const reportApiDevRoutes = () => ({
  name: "taxiflow-report-api-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = /^\/api\/admin\/daily-log\/([^/]+)\/(report-view|report-pdf)$/.exec(url.pathname);
      // Tenant business and platform routes (dev only): same real handlers as
      // Vercel's api/business/<name>.js and api/platform/<name>.js routing.
      const businessMatch =
        /^\/api\/(business)\/(workspace|memberships|members|finance-actions)$/.exec(url.pathname) ??
        /^\/api\/(platform)\/(businesses)$/.exec(url.pathname) ??
        /^\/api\/(admin\/reports)\/(period)$/.exec(url.pathname);

      if (businessMatch) {
        try {
          const handlerUrl = pathToFileURL(
            fileURLToPath(new URL(`./api/${businessMatch[1]}/${businessMatch[2]}.js`, import.meta.url)),
          ).href;
          const { default: handler } = await import(handlerUrl);
          req.query = Object.fromEntries(url.searchParams);
          await handler(req, res);
        } catch (error) {
          next(error);
        }
        return;
      }

      if (!match) {
        next();
        return;
      }

      try {
        const handlerUrl = pathToFileURL(
          fileURLToPath(new URL(`./api/admin/daily-log/${match[2]}.js`, import.meta.url)),
        ).href;
        const { default: handler } = await import(handlerUrl);
        req.query = { ...Object.fromEntries(url.searchParams), id: decodeURIComponent(match[1]) };
        await handler(req, res);
      } catch (error) {
        next(error);
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), reportApiDevRoutes()],
  resolve: {
    alias: [
      {
        find: /^\.\/lib\/appRuntime$/,
        replacement: fileURLToPath(new URL("./src/lib/appRuntimeSecure.js", import.meta.url)),
      },
      {
        find: /^\.\/lib\/dataGateway$/,
        replacement: fileURLToPath(new URL("./src/lib/dataGatewaySecure.js", import.meta.url)),
      },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return null;
          }

          if (id.includes("react")) {
            return "react-vendor";
          }

          if (id.includes("@supabase")) {
            return "supabase-vendor";
          }

          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }

          if (id.includes("date-fns")) {
            return "date-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Test logs, traces and downloads (scripts/verify-all.mjs, UAT) are written
    // under uat-reports while a dev server is running; watching them made the
    // dev server reprocess and reload mid-test. Vite already ignores test-results.
    watch: { ignored: ["**/uat-reports/**"] },
  },
});
