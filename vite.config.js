import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server only: Vite does not run the Vercel functions in api/, so the two
// report routes are mapped to their real handlers here, mirroring Vercel's
// api/admin/daily-log/[id]/<name>.js routing. Never part of a build.
const reportApiDevRoutes = () => ({
  name: "taxiflow-report-api-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = /^\/api\/admin\/daily-log\/([^/]+)\/(report-view|report-pdf)$/.exec(url.pathname);

      if (!match) {
        next();
        return;
      }

      try {
        const handlerUrl = pathToFileURL(
          fileURLToPath(new URL(`./api/admin/daily-log/[id]/${match[2]}.js`, import.meta.url)),
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
  },
});
