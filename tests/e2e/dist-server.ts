import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A tiny static server for apps/world/dist that answers the way Vercel does for the parts that matter to the browser:
 * the `headers` and `rewrites` it applies are read from vercel.json itself, so a test run against it can't drift from
 * the deployed config. Not a general server: no ranges, no compression, no /api functions (those answer 404).
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = join(ROOT, "apps/world/dist");

type Header = { key: string; value: string };
type Rule = { source: string; has?: { type: string; key: string }[]; headers: Header[] };
type Rewrite = { source: string; destination: string };
export const vercelConfig = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { headers: Rule[]; rewrites: Rewrite[] };

// Vercel sources are path-to-regexp patterns; the ones in use are literals and "(.*)" groups.
const matcher = (source: string) => new RegExp(`^${source.replace(/\(\.\*\)/g, "@@ANY@@").replace(/\./g, "\\.").replace(/@@ANY@@/g, "(.*)")}$`);

/** Every header Vercel would add to this request, later rules winning over earlier ones for the same key. */
export function headersFor(pathname: string, query: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of vercelConfig.headers) {
    if (!matcher(rule.source).test(pathname)) continue;
    if (rule.has && !rule.has.every((h) => h.type !== "query" || query.has(h.key))) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain",
};

export function startDistServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    const rewrite = vercelConfig.rewrites.find((r) => r.source === pathname);
    if (rewrite) pathname = rewrite.destination;
    const file = normalize(join(DIST, pathname === "/" ? "/index.html" : pathname));
    const headers = headersFor(url.pathname, url.searchParams);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, headers).end("not found");
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
