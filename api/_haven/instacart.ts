/**
 * Send to Instacart (#637, docs/HOME-DEVICES.md): the Kitchen list's open items become an Instacart shopping list
 * page through the Instacart Developer Platform (IDP). Nikita opens the link, picks the store (Safeway) and checks
 * out there; nothing is bought from here, and Instacart gets only the items' names.
 *
 *   POST {base}/idp/v1/products/products_link
 *        { title, link_type: "shopping_list", line_items: [{ name, display_text }], landing_page_configuration }
 *        → { products_link_url }
 *
 *   INSTACART_API_KEY   the IDP key (Key Vault, `haven-instacart-key`); without it Send to Instacart waits
 *   INSTACART_ENV       development (default, https://connect.dev.instacart.tools) or production
 *                       (https://connect.instacart.com), once Instacart has approved a production key
 *
 * The last send's time, item count and how it went are kept in the private store (`haven/instacart.json`), counts
 * only, for the Desk and Systems. The link itself goes back to the signed-in Desk only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import type { Fetch } from "./devices/http.js";
import { readJson } from "./json.js";
import type { ListItem } from "./list.js";
import { siteUrl } from "../_site/hosts.js";

export const IDP_BASE = { development: "https://connect.dev.instacart.tools", production: "https://connect.instacart.com" } as const;
export type InstacartEnv = keyof typeof IDP_BASE;
export const PRODUCTS_LINK_PATH = "/idp/v1/products/products_link";
export const INSTACART_PATH = "haven/instacart.json";
/** The most items sent in one list. */
export const INSTACART_MAX_ITEMS = 100;

type Env = Record<string, string | undefined>;

export interface InstacartConfig {
  key: string;
  env: InstacartEnv;
}

/** The key and environment from the settings, or null without a key. */
export function instacartFrom(env: Env): InstacartConfig | null {
  const key = (env.INSTACART_API_KEY ?? "").trim();
  if (!key || key.length > 512 || /\s/.test(key)) return null;
  return { key, env: (env.INSTACART_ENV ?? "").trim().toLowerCase() === "production" ? "production" : "development" };
}

export interface InstacartState {
  lastAt: string | null;
  lastItems: number;
  lastOk: boolean | null;
}

export async function readInstacart(blob: BlobBackend): Promise<InstacartState> {
  const o = (await readJson<Record<string, unknown> | null>(blob, INSTACART_PATH, null)) ?? {};
  return {
    lastAt: typeof o.lastAt === "string" ? o.lastAt : null,
    lastItems: typeof o.lastItems === "number" && Number.isInteger(o.lastItems) ? o.lastItems : 0,
    lastOk: typeof o.lastOk === "boolean" ? o.lastOk : null,
  };
}

async function remember(blob: BlobBackend, now: number, items: number, ok: boolean): Promise<void> {
  await blob.put(INSTACART_PATH, JSON.stringify({ lastAt: new Date(now).toISOString(), lastItems: items, lastOk: ok }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

/** The request body for a list of names (pure). */
export function linkBody(names: string[], now: number, site: string): Record<string, unknown> {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(new Date(now));
  return {
    title: `Kitchen list, ${day}`,
    link_type: "shopping_list",
    line_items: names.slice(0, INSTACART_MAX_ITEMS).map((name) => ({ name, display_text: name })),
    landing_page_configuration: { partner_linkback_url: `${site}/` },
  };
}

export type SendResult = { ok: true; url: string; items: number } | { ok: false; error: "not-set-up" | "empty" | "vendor" };

/** Makes the shopping list page from the open items. */
export async function sendToInstacart(deps: { fetch: Fetch; config: InstacartConfig | null; blob: BlobBackend; now: number; env?: Env; log: (line: string) => void }, items: ListItem[]): Promise<SendResult> {
  if (!deps.config) return { ok: false, error: "not-set-up" };
  const names = items.filter((i) => !i.done).map((i) => i.name);
  if (!names.length) return { ok: false, error: "empty" };
  const base = IDP_BASE[deps.config.env];
  let url: string | null = null;
  try {
    const res = await deps.fetch(`${base}${PRODUCTS_LINK_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.config.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(linkBody(names, deps.now, siteUrl(deps.env ?? process.env))),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const got = res.ok ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : (await res.body?.cancel().catch(() => undefined), null);
    const link = typeof got?.products_link_url === "string" ? got.products_link_url : "";
    // Only an https link on Instacart's own hosts goes back to the Desk.
    if (/^https:\/\/([a-z0-9-]+\.)*instacart\.(com|tools)\//i.test(link) && link.length < 2048) url = link;
    deps.log(url ? `instacart: list made (${names.length} items)` : `instacart: failed (${res.status})`);
  } catch {
    deps.log("instacart: failed (network)");
  }
  await remember(deps.blob, deps.now, names.length, url !== null).catch(() => undefined);
  return url ? { ok: true, url, items: Math.min(names.length, INSTACART_MAX_ITEMS) } : { ok: false, error: "vendor" };
}
