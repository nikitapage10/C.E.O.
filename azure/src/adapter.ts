/**
 * The bridge between Azure Functions and C.E.O.'s handlers (docs/AZURE.md). The handlers in api/ take a web
 * `Request` and return a web `Response`, as Vercel calls them; Azure hands a function an HttpRequest and wants an
 * HttpResponseInit back. This file turns one into the other and leaves the handlers untouched.
 *
 *   The URL     the address the browser used: behind the Static Web App the function sees its own host, so the
 *               proxy's original URL (`x-ms-original-url`) or forwarded host is put back. The Desk's origin check
 *               and its passkeys (WebAuthn's origin and RP ID) depend on it.
 *   The caller  `x-real-ip` is what the Desk's sign-in limits count by. Vercel sets it itself; Azure doesn't, so a
 *               caller could send their own. It is always replaced with the address Azure saw.
 *   Cookies     Azure keeps one value per header name, so each Set-Cookie becomes one of the response's cookies.
 *   waitUntil   work a handler hands to waitUntil (api/_waitUntil.ts) is waited for before answering, up to
 *               `settleMs`; anything still running after that carries on on the warm instance.
 */

import type { Cookie, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectWaitUntil } from "../../api/_waitUntil.js";

/** A handler as api/*.ts exports it (`GET`, `POST`, …). Some take no request at all. */
export type WebHandler = (request: Request) => Response | Promise<Response>;

/** What the adapter reads from Azure's HttpRequest (so a test can hand it a plain object). */
export type AzureRequest = Pick<HttpRequest, "method" | "url" | "headers" | "arrayBuffer">;

/** The default wait for waitUntil work: answers stay under the Static Web App proxy's ~45 s cut. */
export const SETTLE_MS = 35_000;

/** Headers that describe the hop to the function, not the request, and must not be copied. */
const HOP = new Set(["connection", "content-length", "transfer-encoding", "keep-alive", "host", "x-real-ip"]);

/** One address without its port: "1.2.3.4:5678" → "1.2.3.4", "[::1]:443" → "::1". */
export function stripPort(addr: string): string {
  const a = addr.trim();
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (v6) return v6[1]!;
  return /^[\d.]+:\d+$/.test(a) ? a.slice(0, a.lastIndexOf(":")) : a;
}

/**
 * The caller's address as Azure saw it: App Service's own client-IP headers, else the last X-Forwarded-For entry
 * (the one Azure's front end appended; entries before it came from the caller and prove nothing).
 */
export function clientIp(headers: Headers): string {
  const own = headers.get("x-azure-clientip") || headers.get("x-client-ip");
  if (own) return stripPort(own);
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length ? stripPort(chain[chain.length - 1]!) : "";
}

/** The URL the browser asked for: the proxy's original URL or forwarded host on the function's own path and query. */
export function publicUrl(azureUrl: string, headers: Headers): string {
  const own = new URL(azureUrl);
  const original = headers.get("x-ms-original-url");
  if (original) {
    try {
      const u = new URL(original);
      if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    } catch {
      // not a URL: fall through
    }
  }
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "http" ? "http:" : "https:";
    return `${proto}//${host}${own.pathname}${own.search}`;
  }
  return own.toString();
}

/** Azure's HttpRequest as the web Request the handlers take. */
export async function toWebRequest(req: AzureRequest): Promise<Request> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.append(key, value);
  });
  const ip = clientIp(req.headers);
  if (ip) headers.set("x-real-ip", ip);
  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  return new Request(publicUrl(req.url, req.headers), { method, headers, ...(body && body.byteLength > 0 && { body }) });
}

/** One Set-Cookie value as Azure's Cookie. */
export function parseSetCookie(line: string): Cookie | null {
  const [pair, ...attrs] = line.split(";");
  const at = pair?.indexOf("=") ?? -1;
  if (!pair || at <= 0) return null;
  const cookie: Cookie = { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() };
  for (const attr of attrs) {
    const eq = attr.indexOf("=");
    const key = (eq < 0 ? attr : attr.slice(0, eq)).trim().toLowerCase();
    const val = eq < 0 ? "" : attr.slice(eq + 1).trim();
    if (key === "path") cookie.path = val;
    else if (key === "domain") cookie.domain = val;
    else if (key === "max-age" && /^-?\d+$/.test(val)) cookie.maxAge = Number(val);
    else if (key === "expires" && !Number.isNaN(Date.parse(val))) cookie.expires = new Date(val);
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite") {
      const s = val.toLowerCase();
      cookie.sameSite = s === "strict" ? "Strict" : s === "lax" ? "Lax" : s === "none" ? "None" : undefined;
    }
  }
  return cookie;
}

/** A web Response as Azure's HttpResponseInit: status, headers, cookies and the whole body. */
export async function toAzureResponse(res: Response): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const cookies = res.headers
    .getSetCookie()
    .map(parseSetCookie)
    .filter((c): c is Cookie => c !== null);
  const bytes = res.body ? new Uint8Array(await res.arrayBuffer()) : null;
  return {
    status: res.status,
    headers,
    ...(cookies.length && { cookies }),
    ...(bytes && bytes.byteLength > 0 && { body: bytes }),
  };
}

/** Wait for every promise to settle, or until `ms` passes; true when they all finished in time. */
export async function settle(pending: Promise<unknown>[], ms: number): Promise<boolean> {
  if (!pending.length) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const all = Promise.allSettled(pending).then(() => true);
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([all, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AdaptOptions {
  /** How long to wait for waitUntil work before answering (ms); Infinity waits for all of it. */
  settleMs?: number;
}

/** An Azure HTTP handler running a web handler. */
export function adapt(handler: WebHandler, opts: AdaptOptions = {}) {
  const settleMs = opts.settleMs ?? SETTLE_MS;
  return async (req: AzureRequest, context: Pick<InvocationContext, "error" | "warn">): Promise<HttpResponseInit> => {
    try {
      const request = await toWebRequest(req);
      const { result, pending } = await collectWaitUntil(async () => handler(request));
      const done = await settle(pending, Number.isFinite(settleMs) ? settleMs : 2 ** 31 - 1);
      if (!done) context.warn(`background work still running after ${settleMs} ms; answering now`);
      return await toAzureResponse(result);
    } catch (e) {
      context.error("handler failed", e instanceof Error ? e.message : String(e));
      return { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ error: "server" }) };
    }
  };
}
