import { beforeEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import type { Fetch } from "../devices/http.ts";
import { HomeVault, homeKey } from "../devices/vault.ts";
import { KitchenList } from "../list.ts";
import { authUrl, CART_SCOPE, findStores, CART_URL, forgetKrogerTokens, imageOf, krogerClientFrom, krogerImage, readProduct, readStoredProduct, readStore, redirectFor, termOf, broaderTerm, type KrogerClient } from "./api.ts";
import { krogerCallback, krogerGet, krogerPost, linkState, MATCH_MAX, STATE_COOKIE, viewOf, type KrogerDeps } from "./route.ts";

type Got = ReturnType<typeof viewOf> & { ok?: boolean; error?: string; items?: number; already?: number; url?: string; left?: number; more?: boolean };
import { KROGER_PATH, readKroger } from "./store.ts";

/**
 * Send to King Soopers (#664): Kroger's answers read as untrusted data, the store picker, matching with a cache, the
 * swap, Connect King Soopers and the send, which adds exactly the picks the Desk showed. Every Kroger answer is mocked
 * in the shape developer.kroger.com documents; every id, token, ZIP and store here is made up.
 */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const SEAL = homeKey("a-test-home-token-key-that-is-long-enough-0123", "seal")!;
const CLIENT: KrogerClient = { clientId: "test-kroger-app-0001", clientSecret: "test-kroger-secret", redirectUri: "https://thankful-forest-019308c1e.5.azurestaticapps.net/api/haven/kroger-callback" };
const ZIP = "12345";
const SECRETS = ["test-kroger-secret", "test-refresh-kroger", "test-app-access", "test-cart-access"];

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Route = [RegExp, (url: URL, init: RequestInit) => unknown];
function fakeFetch(routes: Route[]): Fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    for (const [re, answer] of routes)
      if (re.test(`${init.method ?? "GET"} ${u.origin}${u.pathname}`)) {
        const got = answer(u, init);
        return got instanceof Response ? got : jsonRes(got);
      }
    return jsonRes({ error: "no route" }, 404);
  }) as Fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}

const allText = (blob: { files: Map<string, Uint8Array> }) => [...blob.files.values()].map((b) => new TextDecoder().decode(b)).join("\n");

/** A product as Kroger's Products API answers it with a locationId. */
const kp = (id: string, upc: string, description: string, regular: number, promo = 0, stockLevel = "HIGH") => ({
  productId: id,
  upc,
  brand: "Test Brand",
  description,
  images: [],
  items: [{ itemId: upc, inventory: { stockLevel }, fulfillment: { curbside: true, delivery: true, inStore: true, shipToHome: false }, price: { regular, promo }, size: "1 gal", soldBy: "UNIT" }],
});

const STORES = {
  data: [
    { locationId: "62000001", storeNumber: "001", divisionNumber: "620", chain: "KINGSOOPERS", name: "King Soopers - Test Town", address: { addressLine1: "1 Test Ave", city: "Testville", state: "CO", zipCode: ZIP, county: "TEST" }, geolocation: { latitude: 0, longitude: 0 } },
    { locationId: "62000002", chain: "KINGSOOPERS", name: "King Soopers - Elsewhere", address: { addressLine1: "2 Test Ave", city: "Testville", state: "CO", zipCode: ZIP } },
    { locationId: "<script>", name: "bad" },
  ],
};

const PRODUCTS: Record<string, unknown[]> = {
  "oat milk": [{ ...kp("0001111000001", "0001111000001", "Test Oat Milk", 4.29, 3.99), images: [{ perspective: "front", featured: true, sizes: [{ size: "medium", url: "https://www.kroger.com/product/images/medium/front/0001111000001" }] }] }, kp("0001111000002", "0001111000002", "Other Oat Milk", 5.49)],
  lemons: [kp("0001111000003", "0001111000003", "Lemons", 0.79, 0, "TEMPORARILY_OUT_OF_STOCK"), kp("0001111000004", "0001111000004", "Organic Lemons", 1.19, 0, "LOW")],
  "meyer lemons": [kp("0001111000005", "0001111000005", "Meyer Lemons", 1.99)],
};

function kroger(over: Route[] = []) {
  return fakeFetch([
    ...over,
    [/^POST https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/token$/, (_u, init) => {
      const form = new URLSearchParams(String(init.body));
      if (form.get("grant_type") === "client_credentials") return { access_token: "test-app-access", expires_in: 1800, token_type: "bearer" };
      if (form.get("grant_type") === "authorization_code") return { access_token: "test-cart-access", refresh_token: "test-refresh-kroger", expires_in: 1800 };
      if (form.get("grant_type") === "refresh_token") return { access_token: "test-cart-access", refresh_token: form.get("refresh_token"), expires_in: 1800 };
      return jsonRes({ error: "unsupported_grant_type" }, 400);
    }],
    [/^GET https:\/\/api\.kroger\.com\/v1\/locations$/, () => STORES],
    [/^GET https:\/\/api\.kroger\.com\/v1\/products$/, (u) => ({ data: PRODUCTS[u.searchParams.get("filter.term") ?? ""] ?? [] })],
    [/^PUT https:\/\/api\.kroger\.com\/v1\/cart\/add$/, () => new Response(null, { status: 204 })],
  ]);
}

async function setup(over: Partial<KrogerDeps> = {}) {
  const blob = memoryBlob();
  const store = new MemoryAuthStore();
  const vault = new HomeVault(blob, SEAL);
  const lines: string[] = [];
  const cookie = await signedInCookie(DESK, NOW, store);
  const f = kroger();
  const deps: KrogerDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, vault, client: CLIENT, fetch: f, now: NOW, log: (l) => lines.push(l), ...over };
  return { deps, blob, vault, cookie, lines, f };
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, ...headers } });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/haven/kroger`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

beforeEach(() => forgetKrogerTokens());

describe("Kroger's answers (#664)", () => {
  it("reads the app from the settings and asks only for the cart scope", () => {
    expect(krogerClientFrom({})).toBeNull();
    expect(krogerClientFrom({ KROGER_CLIENT_ID: "id" })).toBeNull();
    expect(krogerClientFrom({ KROGER_CLIENT_ID: " id ", KROGER_CLIENT_SECRET: "s" })).toMatchObject({ clientId: "id", clientSecret: "s" });
    const u = new URL(authUrl(CLIENT, "nonce"));
    expect(`${u.origin}${u.pathname}`).toBe("https://api.kroger.com/v1/connect/oauth2/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({ scope: CART_SCOPE, response_type: "code", client_id: CLIENT.clientId, redirect_uri: CLIENT.redirectUri, state: "nonce" });
    expect(redirectFor(CLIENT, new Request("https://ceo.nikita.page/api/haven/kroger")).redirectUri).toBe("https://ceo.nikita.page/api/haven/kroger-callback");
    expect(redirectFor(CLIENT, new Request("https://evil.example/api/haven/kroger")).redirectUri).toBe(CLIENT.redirectUri);
  });

  it("keeps prices in cents, a sale only below the regular price, and drops what isn't sold at the store", () => {
    expect(readProduct(kp("0001111000001", "0001111000001", "Test Oat Milk", 4.29, 3.99))).toEqual({ productId: "0001111000001", upc: "0001111000001", description: "Test Oat Milk", brand: "Test Brand", size: "1 gal", price: 429, promo: 399, stock: "high", image: null, aisle: null, categories: [] });
    // Where it is and its departments (#737), only as the Products API gives them.
    expect(readProduct({ ...kp("0001111000001", "0001111000001", "X", 2), aisleLocations: [{ description: "Aisle 12", number: "12" }], categories: ["Dairy", "<b>x</b>", "Natural", "Extra"] })).toMatchObject({ aisle: "Aisle 12", categories: ["Dairy", "bx/b", "Natural"] });
    expect(readProduct(kp("0001111000001", "0001111000001", "X", 2, 0, "TEMPORARILY_OUT_OF_STOCK"))).toMatchObject({ promo: null, stock: "out" });
    expect(readProduct({ ...kp("0001111000001", "0001111000001", "X", 2), items: [{}] })).toBeNull();
    expect(readProduct({ ...kp("0001111000001", "not-a-upc", "X", 2) })).toBeNull();
    expect(readProduct(kp("0001111000001", "0001111000001", "<b>Oat</b>\u0000 milk", 2))?.description).toBe("bOat/b milk");
  });

  it("keeps the featured photo, only from Kroger's image host (#677)", () => {
    const img = (perspective: string, featured: boolean, host = "www.kroger.com") => ({ perspective, featured, sizes: ["thumbnail", "small", "medium", "large"].map((size) => ({ size, url: `https://${host}/product/images/${size}/${perspective}/0001111000001` })) });
    expect(readProduct({ ...kp("0001111000001", "0001111000001", "Oat", 2), images: [img("back", false), img("front", true)] })?.image).toBe("https://www.kroger.com/product/images/medium/front/0001111000001");
    expect(imageOf([img("back", false), img("front", false)])).toBe("https://www.kroger.com/product/images/medium/front/0001111000001");
    expect(imageOf([{ perspective: "front", featured: true, sizes: [{ size: "small", url: "https://www.kroger.com/s.jpg" }] }])).toBe("https://www.kroger.com/s.jpg");
    expect(imageOf([img("front", true, "evil.example")])).toBeNull();
    expect(imageOf([img("front", true, "kroger.com.evil.example")])).toBeNull();
    expect(imageOf("nope")).toBeNull();
    for (const bad of ["http://www.kroger.com/a.jpg", "https://www.kroger.com:8443/a.jpg", "https://user@www.kroger.com/a.jpg", "javascript:alert(1)", "https://notkroger.com/a.jpg", 7]) expect(krogerImage(bad)).toBeNull();
    expect(krogerImage("https://kroger.com/a.jpg")).toBe("https://kroger.com/a.jpg");
    const stored = { productId: "0001111000001", upc: "0001111000001", description: "Oat", brand: "", size: "", price: 200, promo: null, stock: null };
    expect(readStoredProduct({ ...stored, image: "https://www.kroger.com/a.jpg" })?.image).toBe("https://www.kroger.com/a.jpg");
    expect(readStoredProduct({ ...stored, image: "https://evil.example/a.jpg" })?.image).toBeNull();
    expect(readStore(STORES.data[2])).toBeNull();
    expect(readStore(STORES.data[0])).toEqual({ id: "62000001", name: "King Soopers - Test Town", line: "1 Test Ave", city: "Testville", state: "CO", zip: ZIP });
  });

  it("turns a list item into a search term Kroger takes", () => {
    expect(termOf("oat milk")).toBe("oat milk");
    expect(termOf("ox")).toBe("");
    expect(termOf("eggs (a dozen!)")).toBe("eggs");
    expect(termOf("alpha bravo charlie delta echo foxtrot golf hotel india")).toBe("alpha bravo charlie delta echo foxtrot golf hotel");
  });

  it("searches for the food, not its quantity, unit or prep (#737, the misses from a real week)", () => {
    expect(termOf("snow peas (3 oz)")).toBe("snow peas");
    expect(termOf("snow peas 3 oz")).toBe("snow peas");
    expect(termOf("tomato paste (6 oz can)")).toBe("tomato paste");
    expect(termOf("heavy cream (1 cup)")).toBe("heavy cream");
    expect(termOf("panko, 1 cup")).toBe("panko");
    expect(termOf("panko (1 cup)")).toBe("panko");
    expect(termOf("garlic (4 cloves)")).toBe("garlic");
    expect(termOf("fresh basil, chopped (1 bunch)")).toBe("basil");
    expect(termOf("chicken thighs (1½ lb)")).toBe("chicken thighs");
    expect(termOf("1/2 cup of rice")).toBe("rice");
    expect(termOf("lemons x2")).toBe("lemons");
    expect(termOf("ground beef 1lb")).toBe("ground beef");
    expect(termOf("2 oz")).toBe("");
    expect(broaderTerm("fire roasted diced tomatoes")).toBe("diced tomatoes");
    expect(broaderTerm("tomato paste")).toBe("paste");
    expect(broaderTerm("panko")).toBe("");
  });
});

describe("Send to King Soopers (#664)", () => {
  it("shows the public only a state and a count, and waits until the app is set up and called", async () => {
    const { deps, cookie } = await setup({ client: null });
    const pub = await (await krogerGet(get("/api/haven/kroger?view=status"), deps)).json();
    expect(pub).toEqual({ ready: false, state: "waiting", picks: 0 });
    expect(linkState(CLIENT, null, null)).toBe("waiting");
    expect(linkState(CLIENT, { zip: "", found: [], store: null, picks: {}, last: { at: "x", ok: false }, sent: null, inCart: {} }, null)).toBe("down");
    expect(linkState(CLIENT, { zip: "", found: [], store: null, picks: {}, last: { at: "x", ok: true }, sent: null, inCart: {} }, { refresh: "r", connectedAt: 0, refused: true })).toBe("down");
    expect((await krogerGet(get("/api/haven/kroger"), deps)).status).toBe(401);
    expect((await krogerPost(post({ action: "set-zip", zip: ZIP }), deps)).status).toBe(401);
    expect((await krogerPost(post({ action: "set-zip", zip: ZIP }, { Cookie: cookie, Authorization: "Bearer x" }), deps)).status).toBe(401);
    expect((await krogerPost(post({ action: "find-stores" }, { Cookie: cookie }), deps)).status).toBe(503);
  });

  it("picks the home store near the ZIP, matches each item once, swaps, and adds exactly the shown picks", async () => {
    const { deps, cookie, blob, f, lines } = await setup();
    await new KitchenList(blob).add(["oat milk", "lemons", "ox"], NOW);
    const call = async (body: unknown) => {
      const res = await krogerPost(post(body, { Cookie: cookie }), deps);
      return { status: res.status, body: (await res.json()) as Got };
    };

    expect((await call({ action: "set-zip", zip: "8021" })).status).toBe(400);
    expect((await call({ action: "find-stores" })).status).toBe(409);
    expect((await call({ action: "set-zip", zip: ZIP })).body.zip).toBe(ZIP);
    const found = await call({ action: "find-stores" });
    expect(found.body.found.map((s) => s.id)).toEqual(["62000001", "62000002"]);
    const loc = new URL(f.calls.find((c) => c.url.includes("/locations"))!.url);
    expect(loc.searchParams.get("filter.zipCode.near")).toBe(ZIP);
    expect(loc.searchParams.get("filter.chain")).toBe("KINGSOOPERS");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("test-kroger-app-0001:test-kroger-secret").toString("base64")}`);
    expect(new URLSearchParams(String(f.calls[0]!.init.body)).get("scope")).toBe("product.compact");

    expect((await call({ action: "match" })).status).toBe(409);
    expect((await call({ action: "pick-store", id: "99999999" })).status).toBe(404);
    expect((await call({ action: "pick-store", id: "62000001" })).body.store?.name).toBe("King Soopers - Test Town");

    const matched = await call({ action: "match" });
    expect(matched.status).toBe(200);
    const byKey = Object.fromEntries(matched.body.lines.map((l) => [l.key, l.pick]));
    expect(byKey["oat milk"]?.product).toMatchObject({ description: "Test Oat Milk", price: 429, promo: 399, image: "https://www.kroger.com/product/images/medium/front/0001111000001" });
    // The first in-stock match, not the out-of-stock one.
    expect(byKey["lemon"]?.product).toMatchObject({ description: "Organic Lemons", stock: "low" });
    expect(byKey["ox"]?.product).toBeNull();
    expect(matched.body.total).toBe(399 + 119);
    const products = () => f.calls.filter((c) => c.url.includes("/products")).length;
    expect(products()).toBe(2);
    const prod = new URL(f.calls.find((c) => c.url.includes("/products"))!.url);
    expect(prod.searchParams.get("filter.locationId")).toBe("62000001");
    // Cached: a second Match calls Kroger for nothing, and one token serves every call.
    await call({ action: "match" });
    expect(products()).toBe(2);
    expect(f.calls.filter((c) => c.url.endsWith("/oauth2/token")).length).toBe(1);

    // Swap: another term, then one of its matches; skip leaves an item out of the total.
    const searched = await call({ action: "search", key: "lemon", term: "meyer lemons" });
    expect(searched.body.lines.find((l) => l.key === "lemon")?.pick?.alts.map((p) => p.description)).toEqual(["Meyer Lemons"]);
    const chose = await call({ action: "choose", key: "lemon", productId: "0001111000005" });
    const lemon = chose.body.lines.find((l) => l.key === "lemon")?.pick;
    expect(lemon).toMatchObject({ chosen: true, product: { description: "Meyer Lemons" } });
    expect(lemon?.alts.map((p) => p.description)).toContain("Organic Lemons");
    expect((await call({ action: "skip", key: "oat milk", skip: true })).body.total).toBe(199);
    await call({ action: "skip", key: "oat milk", skip: false });

    // Not connected yet: nothing is added.
    const picks = [
      { key: "oat milk", productId: "0001111000001" },
      { key: "lemon", productId: "0001111000005" },
    ];
    expect((await call({ action: "send", picks })).body.error).toBe("not-connected");

    // Connect King Soopers: Kroger's page, a state cookie, then the callback seals the grant.
    const conn = await krogerPost(post({ action: "connect" }, { Cookie: cookie }), deps);
    const url = new URL(((await conn.json()) as { url: string }).url);
    expect(url.searchParams.get("redirect_uri")).toBe(CLIENT.redirectUri);
    const stateValue = conn.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))!.split(";")[0]!.slice(STATE_COOKIE.length + 1);
    const wrong = await krogerCallback(get(`/api/haven/kroger-callback?code=c&state=other`, { Cookie: `${STATE_COOKIE}=${stateValue}` }), deps);
    expect(wrong.headers.get("location")).toBe("/boiler/controls?kroger=refused");
    const ok = await krogerCallback(get(`/api/haven/kroger-callback?code=c&state=${url.searchParams.get("state")}`, { Cookie: `${STATE_COOKIE}=${stateValue}` }), deps);
    expect(ok.headers.get("location")).toBe("/boiler/controls?kroger=connected");

    // A pick the Desk didn't show is refused; the shown ones go to the cart, once each, and the cart link comes back.
    expect((await call({ action: "send", picks: [{ key: "lemon", productId: "0001111000004" }] })).body.error).toBe("changed");
    const sent = await call({ action: "send", picks });
    expect(sent.body).toMatchObject({ ok: true, items: 2, url: CART_URL, connected: true, state: "live" });
    const put = f.calls.find((c) => c.init.method === "PUT")!;
    expect(JSON.parse(String(put.init.body))).toEqual({ items: [{ upc: "0001111000001", quantity: 1 }, { upc: "0001111000005", quantity: 1 }] });
    expect((put.init.headers as Record<string, string>).Authorization).toBe("Bearer test-cart-access");

    // Sent once is remembered (#737): the lines say so, and a resend adds nothing twice.
    const view = await call({ action: "skip", key: "oat milk", skip: false });
    expect(
      view.body.lines
        .filter((l) => l.inCart)
        .map((l) => l.key)
        .sort(),
    ).toEqual(["lemon", "oat milk"]);
    const again = await call({ action: "send", picks });
    expect(again.body).toMatchObject({ ok: true, items: 0, already: 2 });
    expect(f.calls.filter((c) => c.init.method === "PUT")).toHaveLength(1);

    // Rematch one item from scratch: a fresh search, its own pick again, no longer marked as sent.
    const before = products();
    const re = await call({ action: "rematch", key: "lemon" });
    expect(products()).toBe(before + 1);
    expect(re.body.lines.find((l) => l.key === "lemon")).toMatchObject({ inCart: false, pick: { chosen: false, product: { description: "Organic Lemons" } } });
    expect((await call({ action: "rematch", key: "nope" })).status).toBe(404);

    // Signed out, still only a state and a count.
    const pub = await (await krogerGet(get("/api/haven/kroger?view=status"), deps)).json();
    expect(pub).toEqual({ ready: true, state: "live", picks: 2 });

    // Nothing private in the logs; no secret or token in the store in the clear.
    const log = lines.join("\n");
    for (const word of [ZIP, "oat", "lemon", "Test Town", "62000001", "4.29"]) expect(log).not.toContain(word);
    for (const s of SECRETS) expect(allText(blob)).not.toContain(s);
    expect((await readKroger(blob)).sent).toMatchObject({ items: 2, ok: true });
    expect(blob.files.has(KROGER_PATH)).toBe(true);

    // Clear: every pick and the sent record gone, ready to match afresh.
    const cleared = await call({ action: "clear" });
    expect(cleared.body.lines.every((l) => l.pick === null && !l.inCart)).toBe(true);
    expect((await readKroger(blob)).inCart).toEqual({});
  });

  it("calls the grant gone when Kroger refuses its refresh token, and starts the picks over for a new store", async () => {
    const refusing = kroger([[/^POST https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/token$/, (_u, init) => (new URLSearchParams(String(init.body)).get("grant_type") === "refresh_token" ? jsonRes({ error: "invalid_grant" }, 400) : { access_token: "test-app-access", expires_in: 1800 })]]);
    const { deps, cookie, blob, vault } = await setup({ fetch: refusing });
    await new KitchenList(blob).add(["oat milk"], NOW);
    await vault.write("kroger", { refresh: "test-refresh-kroger", connectedAt: NOW });
    const call = async (body: unknown) => (await krogerPost(post(body, { Cookie: cookie }), deps).then((r) => r.json())) as Got;
    await call({ action: "set-zip", zip: ZIP });
    await call({ action: "find-stores" });
    await call({ action: "pick-store", id: "62000001" });
    await call({ action: "match" });
    const res = await call({ action: "send", picks: [{ key: "oat milk", productId: "0001111000001" }] });
    expect(res).toMatchObject({ error: "refused", connected: false, refused: true, state: "down" });
    expect(await vault.read("kroger")).toMatchObject({ refused: true });
    const moved = await call({ action: "pick-store", id: "62000002" });
    expect(moved.lines[0]?.pick).toBeNull();
    const kept = await call({ action: "disconnect" });
    expect(kept).toMatchObject({ connected: false, refused: false });
  });
});

describe("Match all in one press (#737)", () => {
  it("matches MATCH_MAX a request and says how many are left, so the Kitchen calls again until none are", async () => {
    const { deps, cookie, blob, f } = await setup();
    await new KitchenList(blob).add(
      Array.from({ length: MATCH_MAX + 3 }, (_, i) => `test item ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`),
      NOW,
    );
    const call = async (body: unknown) => (await krogerPost(post(body, { Cookie: cookie }), deps).then((r) => r.json())) as Got;
    await call({ action: "set-zip", zip: ZIP });
    await call({ action: "find-stores" });
    await call({ action: "pick-store", id: "62000001" });
    const first = await call({ action: "match" });
    expect(first).toMatchObject({ left: 3, more: true });
    const second = await call({ action: "match" });
    expect(second).toMatchObject({ left: 0, more: false });
    expect(Object.keys((await readKroger(blob)).picks)).toHaveLength(MATCH_MAX + 3);
    // Each item searched by its words, then once more by its last noun when nothing came back.
    expect(f.calls.filter((c) => c.url.includes("/products")).length).toBe((MATCH_MAX + 3) * 2);
  });
});

describe("Only King Soopers in the store picker", () => {
  it("asks for the KINGSOOPERS chain and drops any other banner Kroger sends back", async () => {
    const row = (id: string, chain: string, name: string) => ({ locationId: id, chain, name, address: { addressLine1: "1 Test Ave", city: "Testville", state: "CO", zipCode: "80000" } });
    const f = fakeFetch([[/^GET https:\/\/api\.kroger\.com\/v1\/locations$/, () => ({ data: [row("62000001", "KINGSOOPERS", "King Soopers - A"), row("70100001", "SMITHS", "Smith's - B"), row("62000003", "King Soopers", "King Soopers - C"), row("70400001", "FREDMEYER", "Fred Meyer - D"), { locationId: "62000009", name: "No chain" }] })]]);
    const rows = await findStores(f, "test-token", "80000");
    expect(new URL(f.calls[0]!.url).searchParams.get("filter.chain")).toBe("KINGSOOPERS");
    expect(rows.map((r) => r.id)).toEqual(["62000001", "62000003"]);
  });

  it("falls back to every nearby store when the chain filter leaves none", async () => {
    const row = (id: string, chain: string) => ({ locationId: id, chain, name: `Store ${id}`, address: { addressLine1: "1 Test Ave", city: "Testville", state: "CO", zipCode: "80000" } });
    const f = fakeFetch([[/^GET https:\/\/api\.kroger\.com\/v1\/locations$/, (u: URL) => ({ data: u.searchParams.has("filter.chain") ? [] : [row("62000001", "KSOOP")] })]]);
    const rows = await findStores(f, "test-token", "80000");
    expect(f.calls).toHaveLength(2);
    expect(new URL(f.calls[1]!.url).searchParams.has("filter.chain")).toBe(false);
    expect(rows.map((r) => r.id)).toEqual(["62000001"]);
  });
});
