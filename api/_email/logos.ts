/**
 * Sender logos (#642, docs/GMAIL.md, "Sender logos"): the small picture beside a sender on the Relay page, fetched by
 * the Function App from the sender's own domain, once per domain (never per message), and kept sealed in the private
 * store for 30 days. The Desk asks for one by the domain's keyed hash, passkey-only; without one it shows the initial.
 *
 * The guards, each tested (./logos.test.ts):
 *   - a public hostname only: no IP literal, no single label, no localhost or internal names, and it must resolve to a
 *     public address (no private, loopback, link-local or metadata range), checked before each request;
 *   - free-mail domains (gmail.com and the like) are never fetched: their logo isn't the sender's;
 *   - money and legal senders and the private skip list never get one (their mail is never kept anyway);
 *   - https only, two well-known paths (/apple-touch-icon.png, /favicon.ico) on the domain and its parent;
 *   - redirects followed by hand, at most two, and only within the same domain: an off-domain redirect ends it;
 *   - 3 seconds for the whole domain, whatever the number of requests;
 *   - an image content type only (PNG, ICO, JPEG, GIF, WebP; never SVG, which can carry script), and the bytes must
 *     start like that type;
 *   - at most LOGO_MAX_BYTES, read in a stream and cut off past it (a Content-Length over it isn't read at all).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { preFilter } from "./filter.js";
import type { Fetcher } from "./gmail.js";

export const LOGO_MAX_BYTES = 200 * 1024;
export const LOGO_TIMEOUT_MS = 3_000;
export const LOGO_KEEP_MS = 30 * 24 * 60 * 60_000;
/** At most this many new domains a tick. */
export const LOGOS_PER_TICK = 3;
export const LOGO_TYPES = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/gif", "image/webp"] as const;
export const LOGO_PATHS = ["/apple-touch-icon.png", "/favicon.ico"] as const;
const MAX_REDIRECTS = 2;

/** Mail services everyone uses: a sender there is a person, and the service's logo isn't theirs. */
const FREEMAIL = /(?:^|\.)(?:gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|fastmail|hey|tutanota|tuta|qq|163|126)\.(?:com|net|org|me|de|ru|co\.uk|fr|it|es|ch)$/i;

/** Resolves a hostname to its addresses. */
export type Lookup = (host: string) => Promise<string[]>;
export const liveLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Whether an address is somewhere a logo can't live: private, loopback, link-local, metadata, CGNAT, multicast. */
export function privateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return privateAddress(mapped[1]!);
    return /^(?:fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

/** A sender domain a logo may be fetched for, lower-cased, or null. */
export function logoDomain(domain: string, skipTerms: readonly string[] = []): string | null {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (d.length > 120 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return null;
  if (isIP(d) || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|example|invalid)$/.test(d)) return null;
  if (FREEMAIL.test(d)) return null;
  if (preFilter({ fromAddress: "", fromDomain: d, subject: "" }).kind !== "pass") return null;
  if (skipTerms.some((t) => t && d.includes(t.toLowerCase()))) return null;
  return d;
}

/** The domain's registrable base, roughly: the last two labels, or three under a two-letter second level (co.uk). */
export function baseOf(d: string): string {
  const parts = d.split(".");
  const n = parts.length >= 3 && parts[parts.length - 2]!.length <= 3 && parts[parts.length - 1]!.length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** Whether a redirect target stays on the sender's own domain (the base or a name under it). */
export function sameDomain(host: string, base: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === base || h.endsWith(`.${base}`);
}

const typeOf = (ct: string | null): string => (ct ?? "").split(";")[0]!.trim().toLowerCase();

/** Whether the bytes start like the type says. */
export function looksLike(type: string, b: Uint8Array): boolean {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  switch (type) {
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47);
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return at(0, 0, 0, 1, 0) || at(0, 0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/gif":
      return at(0, 0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    default:
      return false;
  }
}

/** A body read in a stream, cut off (null) past `max`. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) return null;
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > max ? null : b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export interface Logo {
  type: string;
  bytes: Uint8Array;
}

export interface LogoDeps {
  fetcher: Fetcher;
  lookup?: Lookup;
  /** The whole domain's time budget (ms). */
  timeoutMs?: number;
}

/** One URL, its redirects followed by hand within the domain; the logo, or null. */
async function fetchOne(url: URL, base: string, deps: LogoDeps, signal: AbortSignal): Promise<Logo | null> {
  const lookup = deps.lookup ?? liveLookup;
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (at.protocol !== "https:" || at.port || at.username || at.password || !sameDomain(at.hostname, base)) return null;
    const addrs = await lookup(at.hostname).catch(() => [] as string[]);
    if (!addrs.length || addrs.some(privateAddress)) return null;
    const res = await deps.fetcher(at.toString(), { method: "GET", redirect: "manual", signal, headers: { Accept: LOGO_TYPES.join(", ") } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) return null;
      try {
        at = new URL(loc, at);
      } catch {
        return null;
      }
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = typeOf(res.headers.get("content-type"));
    if (!(LOGO_TYPES as readonly string[]).includes(type)) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readCapped(res, LOGO_MAX_BYTES);
    if (!bytes || bytes.length < 16 || !looksLike(type, bytes)) return null;
    return { type: type === "image/vnd.microsoft.icon" ? "image/x-icon" : type, bytes };
  }
  return null;
}

/**
 * A domain's logo, or null: the well-known paths on the domain, then on its base, within one 3-second budget. Never
 * throws.
 */
export async function fetchLogo(domain: string, deps: LogoDeps, skipTerms: readonly string[] = []): Promise<Logo | null> {
  const d = logoDomain(domain, skipTerms);
  if (!d) return null;
  const base = baseOf(d);
  const hosts = [...new Set([d, base])];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? LOGO_TIMEOUT_MS);
  try {
    for (const host of hosts) {
      for (const path of LOGO_PATHS) {
        if (ctl.signal.aborted) return null;
        const got = await fetchOne(new URL(`https://${host}${path}`), base, deps, ctl.signal).catch(() => null);
        if (got) return got;
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
