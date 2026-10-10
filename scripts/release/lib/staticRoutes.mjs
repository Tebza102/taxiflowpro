// Minimal local evaluator for the "routes" table of a static Vercel deployment
// (src regex, headers, continue, status, dest, handle: filesystem). Used only to
// test deploy/maintenance locally; it is not a full Vercel implementation.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png" };

export const resolveStatic = (root, routes, pathname) => {
  const headers = {};
  const fileFor = (urlPath) => {
    const file = path.join(root, decodeURIComponent(urlPath));
    if (!file.startsWith(path.resolve(root))) return null;
    return existsSync(file) && statSync(file).isFile() ? file : null;
  };
  for (const route of routes) {
    if (route.handle === "filesystem") {
      const file = fileFor(pathname);
      if (file) return { status: 200, headers, file };
      continue;
    }
    if (!new RegExp(`^${route.src}$`).test(pathname)) continue;
    Object.assign(headers, route.headers ?? {});
    if (route.continue) continue;
    const file = fileFor(route.dest ?? pathname);
    return { status: route.status ?? (file ? 200 : 404), headers, file };
  }
  return { status: 404, headers, file: null };
};

export const sendStatic = (res, root, routes, pathname) => {
  const result = resolveStatic(root, routes, pathname);
  const body = result.file ? readFileSync(result.file) : Buffer.from("not found");
  const type = result.headers["content-type"] ?? TYPES[path.extname(result.file ?? "")] ?? "text/plain";
  res.writeHead(result.status, { ...result.headers, "content-type": type });
  res.end(body);
  return result;
};
