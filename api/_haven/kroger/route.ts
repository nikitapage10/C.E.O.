/**
 * Send to King Soopers (#664, docs/HOME-DEVICES.md, "King Soopers"): the Haven Kitchen list's open items matched to
 * products at Nikita's home store through Kroger's public API, shown with prices on the Kitchen page, and the picks he
 * confirms added to his King Soopers cart. He checks out (pickup or delivery) in the King Soopers app: nothing is
 * bought from the Desk. Azure only: azure/src/index.ts registers these behind the site gate.
 *
 *   GET  /api/haven/kroger?view=status   public: { ready, state, picks }: the link's state (waiting, live, down) and how
 *                                        many open items have a match. Never a store, an item, a price or a link.
 *   GET  /api/haven/kroger               passkey session: the ZIP, the store, each open item's pick and the other
 *                                        matches, the total, whether King Soopers is connected, the last send.
 *   POST /api/haven/kroger               passkey session only (a phone key or bearer is refused):
 *          { action: "set-zip", zip }                    the ZIP the store picker searches near ("" clears it)
 *          { action: "find-stores" }                     Kroger's stores near the ZIP (one Locations call)
 *          { action: "pick-store", id }                  one of those as the home store; the picks start over
 *          { action: "match" }                           matches the open items that have no pick yet, or a stale one
 *                                                        (one Products call each, MATCH_MAX at most)
 *          { action: "search", key, term }               other matches for one item, by another term (one call)
 *          { action: "choose", key, productId }          swaps an item's pick to one of its other matches
 *          { action: "skip", key, skip }                 leaves an item out of the send, or puts it back
 *          { action: "connect" } → { url }               Connect King Soopers: Kroger's sign-in, and a state cookie
 *          { action: "disconnect" }                      forgets the cart grant
 *          { action: "send", picks: [{ key, productId }] }   adds exactly these picks to the cart, each still the
 *                                                        current pick, then → { url }: the King Soopers cart
 *   GET  /api/haven/kroger-callback      where Kroger sends the browser back; then to /boiler/controls?kroger=<result>
 *
 * Calls are few by design: a store search only on a tap, a product search only for an item without a fresh pick, never
 * a poll. The state cookie works as Connect Nest's does (api/_haven/google/route.ts). Nothing here logs a ZIP, a
 * store, an item, a price, a code or a token: log lines carry counts only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BlobBackend } from "../../_blob.js";
import { deskKeyFor } from "../../_desk/keys.js";
import { readCookie, readToken, requireSession, signToken, withCookie, type DeskDeps } from "../../_desk/session.js";
import type { Fetch } from "../devices/http.js";
import type { VendorState } from "../devices/home.js";
import type { HomeVault } from "../devices/vault.js";
import { PHONE_KEY_HEADER } from "../links.js";
import { KitchenList, sameKey, type ListItem } from "../list.js";
import { addToCart, appToken, authUrl, cartToken, CART_URL, costOf, exchangeCode, findStores, forgetKrogerTokens, KrogerRefusedError, line, redirectFor, searchProducts, termOf, type KrogerClient, type Product } from "./api.js";
import { rankProducts } from "./rank.js";
import { ALTS_MAX, changeKroger, readKroger, ZIP, type KrogerState, type ItemPick } from "./store.js";

export const STATE_COOKIE = "__Host-ceo-haven-kroger";
export const STATE_S = 10 * 60;
const BODY_MAX = 8 * 1024;
/** The most product searches one Match makes. */
export const MATCH_MAX = 25;
/** A pick Nikita didn't choose himself is matched again after this long (prices and stock move). */
export const PICK_FRESH_MS = 3 * 24 * 60 * 60_000;
/** The most items one send adds. */
export const SEND_MAX = 50;

/** The cart grant, sealed in the private store. */
export interface StoredKroger {
  refresh: string;
  connectedAt: number;
  refused?: boolean;
}

export interface KrogerDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  vault: HomeVault | null;
  client: KrogerClient | null;
  fetch: Fetch;
  now: number;
  log: (line: string) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

function redirect(to: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

const stateCookie = (value: string, maxAge: number) => `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;

export async function makeState(deskKey: string, passkey: string, now: number): Promise<{ nonce: string; cookie: string }> {
  const nonce = randomBytes(24).toString("base64url");
  const token = signToken(await deskKeyFor(deskKey, "haven-kroger"), { t: "haven-kroger", n: nonce, c: passkey, e: Math.floor(now / 1000) + STATE_S });
  return { nonce, cookie: stateCookie(token, STATE_S) };
}

export async function checkState(deskKey: string, cookieValue: string | null, state: string | null, now: number): Promise<{ passkey: string } | null> {
  if (!deskKey || !cookieValue || !state || state.length > 128) return null;
  const p = readToken(await deskKeyFor(deskKey, "haven-kroger"), cookieValue);
  if (!p || p.t !== "haven-kroger" || typeof p.n !== "string" || typeof p.c !== "string" || typeof p.e !== "number") return null;
  if (p.e <= Math.floor(now / 1000)) return null;
  const a = Buffer.from(p.n);
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { passkey: p.c };
}

const grantOf = async (deps: Pick<KrogerDeps, "vault">): Promise<StoredKroger | null> => (deps.vault ? await deps.vault.read<StoredKroger>("kroger").catch(() => null) : null);

/** The link's state for the Desk and Systems: waiting until set up and called; live or down from the last real call. */
export function linkState(client: KrogerClient | null, state: KrogerState | null, grant: StoredKroger | null): VendorState {
  if (!client) return "waiting";
  if (grant?.refused) return "down";
  if (!state?.last) return "waiting";
  return state.last.ok ? "live" : "down";
}

/** The state of the link, for the devices route's answers (and so Systems). */
export async function krogerLink(deps: Pick<KrogerDeps, "blob" | "vault" | "client">): Promise<VendorState> {
  if (!deps.client || !deps.blob) return "waiting";
  const [state, grant] = await Promise.all([readKroger(deps.blob).catch(() => null), grantOf(deps)]);
  return linkState(deps.client, state, grant);
}

/** The open items, one line each, keyed as their picks are. */
const openLines = (items: ListItem[]) => {
  const seen = new Set<string>();
  return items.filter((i) => !i.done && !seen.has(sameKey(i.name)) && seen.add(sameKey(i.name)));
};

const counts = (p: ItemPick | undefined): p is ItemPick & { product: Product } => Boolean(p?.product && !p.skip && p.product.stock !== "out");

/** What the signed-in Kitchen page shows. */
export function viewOf(state: KrogerState, items: ListItem[], client: KrogerClient | null, grant: StoredKroger | null) {
  const lines = openLines(items).map((i) => ({ id: i.id, name: i.name, key: sameKey(i.name), pick: state.picks[sameKey(i.name)] ?? null }));
  const going = lines.filter((l) => counts(l.pick ?? undefined));
  return {
    ready: Boolean(client),
    state: linkState(client, state, grant),
    connected: Boolean(grant && !grant.refused),
    refused: Boolean(grant?.refused),
    zip: state.zip,
    found: state.found,
    store: state.store,
    lines,
    total: going.reduce((n, l) => n + costOf(l.pick!.product!), 0),
    count: going.length,
    sent: state.sent,
  };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return null;
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return null;
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** GET /api/haven/kroger. */
export async function krogerGet(request: Request, deps: KrogerDeps): Promise<Response> {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "status") {
    if (!deps.blob) return json({ ready: Boolean(deps.client), state: "waiting", picks: 0 });
    const [state, grant, items] = await Promise.all([readKroger(deps.blob).catch(() => null), grantOf(deps), new KitchenList(deps.blob).items(deps.now).catch(() => [])]);
    const picks = state ? openLines(items).filter((i) => state.picks[sameKey(i.name)]?.product).length : 0;
    return json({ ready: Boolean(deps.client), state: linkState(deps.client, state, grant), picks });
  }
  if (view !== null) return json({ error: "bad-request" }, 400);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.blob) return withCookie(json({ error: "not-set-up" }, 503), signed);
  const [state, grant, items] = await Promise.all([readKroger(deps.blob), grantOf(deps), new KitchenList(deps.blob).items(deps.now)]);
  return withCookie(json(viewOf(state, items, deps.client, grant)), signed);
}

/** Notes how the last Kroger call went (Systems' live or down). */
const noteCall = (blob: BlobBackend, ok: boolean, now: number) =>
  changeKroger(blob, (cur) => ({ next: { ...cur, last: { at: new Date(now).toISOString(), ok } }, result: undefined })).catch(() => undefined);

export type SendResult = { result: "sent"; items: number } | { result: "not-set-up" | "not-connected" | "empty" | "too-many" | "changed" | "refused" | "vendor" };

/**
 * Adds exactly these picks to the King Soopers cart: each still on the list, still the current pick, in stock and not
 * left out, or nothing goes ("changed"). The Kitchen's Send button and Skippy's meals_cart (after Nikita's Yes tap) both
 * come here.
 */
export async function sendPicks(deps: Pick<KrogerDeps, "blob" | "vault" | "client" | "fetch" | "now" | "log">, asked: { key: string; productId: string }[]): Promise<SendResult> {
  const { blob, vault, client, now } = deps;
  if (!blob || !vault || !client) return { result: "not-set-up" };
  const grant = await grantOf(deps);
  if (!grant || grant.refused) return { result: "not-connected" };
  if (!asked.length) return { result: "empty" };
  if (asked.length > SEND_MAX) return { result: "too-many" };
  const stamp = new Date(now).toISOString();
  const [cur, items] = await Promise.all([readKroger(blob), new KitchenList(blob).items(now)]);
  const open = new Set(openLines(items).map((i) => sameKey(i.name)));
  // Exactly what the Desk showed: each one still on the list, still the current pick, in stock, not left out.
  const upcs: string[] = [];
  for (const a of asked) {
    const p = cur.picks[a.key];
    if (!open.has(a.key) || !counts(p) || p.product.productId !== a.productId) return { result: "changed" };
    if (!upcs.includes(p.product.upc)) upcs.push(p.product.upc);
  }
  const add = async (refresh: string) => {
    const t = await cartToken(deps.fetch, client, refresh, now);
    if (t.refresh !== refresh) await vault.write("kroger", { ...grant, refresh: t.refresh } satisfies StoredKroger);
    await addToCart(deps.fetch, t.token, upcs.map((upc) => ({ upc, quantity: 1 })));
    return t.refresh;
  };
  let result: "sent" | "refused" | "vendor" = "vendor";
  try {
    try {
      await add(grant.refresh);
    } catch (e) {
      // A cached access token Kroger no longer takes: once more with a fresh one before calling the grant gone.
      if (!(e instanceof KrogerRefusedError)) throw e;
      forgetKrogerTokens();
      const again = (await grantOf(deps)) ?? grant;
      await add(again.refresh);
    }
    result = "sent";
  } catch (e) {
    if (e instanceof KrogerRefusedError) {
      result = "refused";
      await vault.write("kroger", { ...grant, refused: true } satisfies StoredKroger).catch(() => undefined);
      forgetKrogerTokens();
    }
  }
  await changeKroger(blob, (c) => ({ next: { ...c, sent: { at: stamp, items: upcs.length, ok: result === "sent" }, last: { at: stamp, ok: result === "sent" } }, result: undefined })).catch(() => undefined);
  deps.log(`kroger: send ${result === "vendor" ? "failed" : result} (${upcs.length} items)`);
  return result === "sent" ? { result, items: upcs.length } : { result };
}

/** What a send would add right now, as the Kitchen shows it: the matched, in-stock picks not left out, and the open items still unmatched. */
export async function cartNow(deps: Pick<KrogerDeps, "blob" | "vault" | "client" | "now">): Promise<{ picks: { key: string; productId: string }[]; unmatched: number; connected: boolean; store: boolean } | null> {
  if (!deps.blob || !deps.client) return null;
  const [state, grant, items] = await Promise.all([readKroger(deps.blob), grantOf(deps), new KitchenList(deps.blob).items(deps.now)]);
  const lines = openLines(items).map((i) => ({ key: sameKey(i.name), pick: state.picks[sameKey(i.name)] }));
  return {
    picks: lines.filter((l) => counts(l.pick)).map((l) => ({ key: l.key, productId: l.pick!.product!.productId })),
    unmatched: lines.filter((l) => !l.pick?.product && !l.pick?.skip).length,
    connected: Boolean(grant && !grant.refused),
    store: Boolean(state.store),
  };
}

/** POST /api/haven/kroger: passkey session only. */
export async function krogerPost(request: Request, deps: KrogerDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return json({ error: "unauthorized" }, 401);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const body = await bodyOf(request);
  if (!body) return reply({ error: "bad-request" }, 400);
  const blob = deps.blob;
  if (!blob) return reply({ error: "not-set-up" }, 503);
  const now = deps.now;
  const stamp = new Date(now).toISOString();
  const view = async () => {
    const [state, grant, items] = await Promise.all([readKroger(blob), grantOf(deps), new KitchenList(blob).items(now)]);
    return viewOf(state, items, deps.client, grant);
  };

  if (body.action === "set-zip") {
    const zip = typeof body.zip === "string" ? body.zip.trim() : "";
    if (zip && !ZIP.test(zip)) return reply({ error: "bad-zip" }, 400);
    await changeKroger(blob, (cur) => ({ next: { ...cur, zip, found: [] }, result: undefined }));
    return reply({ ok: true, ...(await view()) });
  }

  if (body.action === "pick-store") {
    const id = typeof body.id === "string" ? body.id : "";
    const ok = await changeKroger(blob, (cur) => {
      const store = cur.found.find((s) => s.id === id) ?? null;
      if (!store) return { next: null, result: false };
      // A new store starts the picks over: products and prices are per store.
      return { next: { ...cur, store, picks: cur.store?.id === store.id ? cur.picks : {} }, result: true };
    });
    if (!ok) return reply({ error: "not-found" }, 404);
    deps.log("kroger: store picked");
    return reply({ ok: true, ...(await view()) });
  }

  if (body.action === "choose" || body.action === "skip") {
    const key = line(body.key, 60);
    const productId = typeof body.productId === "string" ? body.productId : "";
    if (!key || (body.action === "skip" && typeof body.skip !== "boolean")) return reply({ error: "bad-request" }, 400);
    const ok = await changeKroger(blob, (cur) => {
      const pick = cur.picks[key];
      if (!pick) return { next: null, result: false };
      let next: ItemPick;
      if (body.action === "skip") next = { ...pick, skip: body.skip === true };
      else {
        const to = pick.alts.find((p) => p.productId === productId) ?? (pick.product?.productId === productId ? pick.product : null);
        if (!to) return { next: null, result: false };
        // The old pick joins the others, so a swap can be swapped back.
        const alts = [...(pick.product && pick.product.productId !== to.productId ? [pick.product] : []), ...pick.alts.filter((p) => p.productId !== to.productId)].slice(0, ALTS_MAX);
        next = { ...pick, product: to, alts, chosen: true, skip: false };
      }
      return { next: { ...cur, picks: { ...cur.picks, [key]: next } }, result: true };
    });
    return ok ? reply({ ok: true, ...(await view()) }) : reply({ error: "not-found" }, 404);
  }

  if (body.action === "disconnect") {
    if (deps.vault) await deps.vault.forget("kroger");
    forgetKrogerTokens();
    deps.log("kroger: disconnected");
    return reply({ ok: true, ...(await view()) });
  }

  // Everything below reaches Kroger.
  const client = deps.client;
  if (!client) return reply({ error: "not-set-up" }, 503);

  if (body.action === "connect") {
    if (!deps.vault) return reply({ error: "not-set-up" }, 503);
    const { nonce, cookie } = await makeState(deps.desk.deskKey, signed.passkey.id, now);
    const res = reply({ ok: true, url: authUrl(redirectFor(client, request), nonce) });
    res.headers.append("Set-Cookie", cookie);
    return res;
  }

  if (body.action === "find-stores") {
    const cur = await readKroger(blob);
    if (!cur.zip) return reply({ error: "no-zip" }, 409);
    try {
      const found = await findStores(deps.fetch, await appToken(deps.fetch, client, now), cur.zip);
      await changeKroger(blob, (c) => ({ next: { ...c, found, last: { at: stamp, ok: true } }, result: undefined }));
      deps.log(`kroger: ${found.length} stores found`);
      return reply({ ok: true, ...(await view()) });
    } catch {
      await noteCall(blob, false, now);
      deps.log("kroger: store search failed");
      return reply({ error: "vendor" }, 502);
    }
  }

  if (body.action === "match") {
    const [cur, items] = await Promise.all([readKroger(blob), new KitchenList(blob).items(now)]);
    const store = cur.store;
    if (!store) return reply({ error: "no-store" }, 409);
    const stale = (p: ItemPick | undefined) => !p || (!p.chosen && !(Date.parse(p.at) > now - PICK_FRESH_MS));
    const todo = openLines(items)
      .filter((i) => stale(cur.picks[sameKey(i.name)]))
      .slice(0, MATCH_MAX);
    const made: Record<string, ItemPick> = {};
    let failed = 0;
    if (todo.length) {
      let token: string;
      try {
        token = await appToken(deps.fetch, client, now);
      } catch {
        await noteCall(blob, false, now);
        deps.log("kroger: match failed (token)");
        return reply({ error: "vendor" }, 502);
      }
      for (const i of todo) {
        const term = termOf(i.name);
        const was = cur.picks[sameKey(i.name)];
        if (!term) {
          made[sameKey(i.name)] = { term: "", at: stamp, product: null, alts: [], chosen: false, skip: was?.skip ?? false };
          continue;
        }
        try {
          // Best fit first (rank.ts: the real thing over imitation, mixes, brand-name hits and out of stock); the rest to swap to.
          const [best = null, ...rest] = rankProducts(term, await searchProducts(deps.fetch, token, term, store.id, ALTS_MAX + 1));
          made[sameKey(i.name)] = { term, at: stamp, product: best, alts: rest.slice(0, ALTS_MAX), chosen: false, skip: was?.skip ?? false };
        } catch {
          failed++;
        }
      }
    }
    const keep = new Set(openLines(items).map((i) => sameKey(i.name)));
    await changeKroger(blob, (c) => {
      if (c.store?.id !== store.id) return { next: null, result: undefined };
      const picks: Record<string, ItemPick> = {};
      for (const [k, p] of Object.entries({ ...c.picks, ...made })) if (keep.has(k)) picks[k] = p;
      return { next: { ...c, picks, ...(todo.length && { last: { at: stamp, ok: failed < todo.length || !todo.some((i) => termOf(i.name)) } }) }, result: undefined };
    });
    deps.log(`kroger: matched ${Object.keys(made).length} of ${todo.length}${failed ? `, ${failed} failed` : ""}`);
    return reply({ ok: failed === 0, matched: Object.keys(made).length, failed, more: openLines(items).filter((i) => stale(cur.picks[sameKey(i.name)])).length > todo.length, ...(await view()) }, failed && failed === todo.length ? 502 : 200);
  }

  if (body.action === "search") {
    const key = line(body.key, 60);
    const term = termOf(typeof body.term === "string" ? body.term : "");
    if (!key || !term) return reply({ error: "bad-request" }, 400);
    const cur = await readKroger(blob);
    if (!cur.store || !cur.picks[key]) return reply({ error: cur.store ? "not-found" : "no-store" }, cur.store ? 404 : 409);
    const storeId = cur.store.id;
    try {
      const found = rankProducts(term, await searchProducts(deps.fetch, await appToken(deps.fetch, client, now), term, storeId, ALTS_MAX));
      await changeKroger(blob, (c) => {
        const pick = c.picks[key];
        if (!pick || c.store?.id !== storeId) return { next: null, result: undefined };
        const alts = found.filter((p) => p.productId !== pick.product?.productId).slice(0, ALTS_MAX);
        return { next: { ...c, picks: { ...c.picks, [key]: { ...pick, alts } }, last: { at: stamp, ok: true } }, result: undefined };
      });
      deps.log(`kroger: ${found.length} other matches`);
      return reply({ ok: true, ...(await view()) });
    } catch {
      await noteCall(blob, false, now);
      return reply({ error: "vendor" }, 502);
    }
  }

  if (body.action === "send") {
    const asked = (Array.isArray(body.picks) ? body.picks : []).slice(0, SEND_MAX + 1).map((p) => {
      const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      return { key: line(o.key, 60), productId: typeof o.productId === "string" ? o.productId : "" };
    });
    const got = await sendPicks(deps, asked);
    if (got.result === "sent") return reply({ ok: true, items: got.items, url: CART_URL, ...(await view()) });
    if (got.result === "not-set-up") return reply({ error: "not-set-up" }, 503);
    if (got.result === "not-connected" || got.result === "empty") return reply({ error: got.result }, 409);
    if (got.result === "too-many") return reply({ error: "too-many" }, 400);
    if (got.result === "changed") return reply({ error: "changed", ...(await view()) }, 409);
    return reply({ error: got.result, ...(await view()) }, got.result === "refused" ? 409 : 502);
  }

  return reply({ error: "bad-request" }, 400);
}

/** GET /api/haven/kroger-callback. */
export async function krogerCallback(request: Request, deps: KrogerDeps): Promise<Response> {
  const url = new URL(request.url);
  const back = (result: string) => redirect(`/boiler/controls?kroger=${result}`, [stateCookie("", 0)]);
  const checked = await checkState(deps.desk.deskKey, readCookie(request, STATE_COOKIE), url.searchParams.get("state"), deps.now).catch(() => null);
  if (!checked || !deps.desk.store) return back("refused");
  const enrolled = (await deps.desk.store.passkeys().catch(() => [])).some((p) => p.id === checked.passkey);
  if (!enrolled) return back("refused");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || !deps.client || !deps.vault) return back("failed");
  try {
    const refresh = await exchangeCode(deps.fetch, redirectFor(deps.client, request), code);
    await deps.vault.write("kroger", { refresh, connectedAt: deps.now } satisfies StoredKroger);
    forgetKrogerTokens();
    deps.log("kroger: connected");
    return back("connected");
  } catch {
    deps.log("kroger: connect failed");
    return back("failed");
  }
}
