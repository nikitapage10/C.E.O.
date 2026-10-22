import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
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
// Every other character is escaped, so a source can only ever match itself plus those groups.
const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const matcher = (source: string) => new RegExp(`^${source.split("(.*)").map(escape).join("(.*)")}$`);

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
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain",
};

/**
 * Something to run in front of every request, the way Vercel runs middleware.ts (tests/e2e/gate.spec.ts puts the
 * site password's gate here, #236). It answers a web Response: one with `x-middleware-next: 1` carries on to the
 * file (with its Set-Cookie, if any), anything else is sent as it is.
 */
export type Front = (request: Request) => Promise<Response>;

async function webRequest(req: import("node:http").IncomingMessage, port: number): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const method = req.method ?? "GET";
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = new Uint8Array(Buffer.concat(chunks));
  }
  return new Request(`http://localhost:${port}${req.url ?? "/"}`, { method, headers, ...(body && { body }) });
}

export function startDistServer(port: number, front?: Front): Promise<Server> {
  const server = createServer(async (req, res) => {
    let extra: Record<string, string[]> = {};
    if (front) {
      const answer = await front(await webRequest(req, port));
      if (answer.headers.get("x-middleware-next") !== "1") {
        const out: Record<string, string | string[]> = {};
        answer.headers.forEach((v, k) => k !== "set-cookie" && (out[k] = v));
        const cookies = answer.headers.getSetCookie();
        if (cookies.length) out["set-cookie"] = cookies;
        res.writeHead(answer.status, out).end(Buffer.from(await answer.arrayBuffer()));
        return;
      }
      const cookies = answer.headers.getSetCookie();
      if (cookies.length) extra = { "set-cookie": cookies };
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    const rewrite = vercelConfig.rewrites.find((r) => r.source === pathname);
    if (rewrite) pathname = rewrite.destination;
    const file = normalize(join(DIST, pathname === "/" ? "/index.html" : pathname));
    const headers = headersFor(url.pathname, url.searchParams);
    // Read in one step (no check-then-read): a missing file or a folder answers 404.
    let body: Buffer | null = null;
    if (file.startsWith(DIST)) {
      try {
        body = readFileSync(file);
      } catch {
        body = null;
      }
    }
    if (!body) {
      res.writeHead(404, { ...headers, ...extra }).end("not found");
      return;
    }
    res.writeHead(200, { ...headers, ...extra, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
