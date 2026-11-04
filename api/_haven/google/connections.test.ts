import { describe, expect, it, beforeEach } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import { MemoryRoomLog } from "../../_skippy/log.ts";
import { Home } from "../devices/home.ts";
import type { Fetch } from "../devices/http.ts";
import { THERMO_MAX_F, THERMO_MIN_F, thermostatPlan } from "../devices/rails.ts";
import type { DeviceReading } from "../devices/types.ts";
import { HomeVault, homeKey, vaultPath } from "../devices/vault.ts";
import { KitchenList } from "../list.ts";
import { commandFor, cToF, fToC, NestClient, readThermostat } from "./nest.ts";
import { authUrl, exchangeCode, forgetTokens, havenClientFrom, nestProjectFrom, SDM_SCOPE, TASKS_SCOPE, type HavenClient } from "./oauth.ts";
import { checkState, googleCallback, googleGet, googlePost, makeState, STATE_COOKIE, type GoogleRouteDeps } from "./route.ts";
import { readTasksState, setTasksList, syncTasks } from "./tasks.ts";

/**
 * The Haven's connections (#637): the Nest thermostat through Google's SDM API and its rails, Connect Nest and Connect
 * Google Tasks (the OAuth state, the scope allowlist, the sealed grants), the Tasks quick-add onto the Kitchen list. Every vendor is mocked; every id, token and key here is made up.
 */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const HOME_KEY = "a-test-home-token-key-that-is-long-enough-0123";
const SEAL = homeKey(HOME_KEY, "seal")!;
const ID_KEY = homeKey(HOME_KEY, "id")!;
const PROJECT = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
const CLIENT: HavenClient = { clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-client-secret", redirectUri: "https://thankful-forest-019308c1e.5.azurestaticapps.net/api/haven/google-callback" };
const DEVICE = `enterprises/${PROJECT}/devices/AVPHwEtestDEVICEid0001`;
const SECRETS = ["test-refresh-nest", "test-refresh-tasks", "test-access", "test-client-secret", "AVPHwEtestDEVICEid0001"];

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

function fakeFetch(routes: Array<[RegExp, (url: URL, init: RequestInit) => unknown]>): Fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    for (const [re, answer] of routes) if (re.test(`${init.method ?? "GET"} ${u.origin}${u.pathname}`)) {
      const got = answer(u, init);
      return got instanceof Response ? got : jsonRes(got);
    }
    return jsonRes({ error: "no route" }, 404);
  }) as Fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}

const allText = (blob: { files: Map<string, Uint8Array> }) => [...blob.files.values()].map((b) => new TextDecoder().decode(b)).join("\n");

/* ── The thermostat ── */

function sdmDevice(over: { mode?: string; eco?: string; heat?: number; cool?: number; hvac?: string; online?: boolean } = {}) {
  return {
    name: DEVICE,
    type: "sdm.devices.types.THERMOSTAT",
    traits: {
      "sdm.devices.traits.Info": { customName: "Nikita's private name" },
      "sdm.devices.traits.Humidity": { ambientHumidityPercent: 38.4 },
      "sdm.devices.traits.Connectivity": { status: over.online === false ? "OFFLINE" : "ONLINE" },
      "sdm.devices.traits.ThermostatMode": { mode: over.mode ?? "HEAT", availableModes: ["HEAT", "COOL", "HEATCOOL", "OFF"] },
      "sdm.devices.traits.ThermostatEco": { availableModes: ["OFF", "MANUAL_ECO"], mode: over.eco ?? "OFF", heatCelsius: 15, coolCelsius: 28 },
      "sdm.devices.traits.ThermostatHvac": { status: over.hvac ?? "HEATING" },
      "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 20.5 },
      "sdm.devices.traits.ThermostatTemperatureSetpoint": { ...(over.heat !== undefined ? { heatCelsius: over.heat } : { heatCelsius: 20 }), ...(over.cool !== undefined && { coolCelsius: over.cool }) },
    },
    parentRelations: [{ parent: `enterprises/${PROJECT}/structures/S/rooms/R`, displayName: "Living Room" }],
  };
}

async function nestSetup(device = sdmDevice(), opts: { tokenStatus?: number; command?: (init: RequestInit) => Response | unknown; grant?: boolean; list?: () => Response | unknown; now?: () => number } = {}) {
  forgetTokens();
  const blob = memoryBlob();
  const vault = new HomeVault(blob, SEAL);
  const f = fakeFetch([
    [/POST https:\/\/oauth2\.googleapis\.com\/token$/, () => (opts.tokenStatus ? jsonRes({ error: "invalid_grant" }, opts.tokenStatus) : { access_token: "test-access", expires_in: 3599 })],
    [/GET https:\/\/smartdevicemanagement\.googleapis\.com\/v1\/enterprises\/[^/]+\/devices$/, () => opts.list?.() ?? { devices: [device, { name: `enterprises/${PROJECT}/devices/cam1`, type: "sdm.devices.types.CAMERA", traits: {} }] }],
    [/POST https:\/\/smartdevicemanagement\.googleapis\.com\/v1\/enterprises\/.+:executeCommand$/, (_u, init) => (opts.command ? opts.command(init) : {})],
  ]);
  const now = opts.now ?? (() => NOW);
  const nest = new NestClient({ fetch: f, vault, idKey: ID_KEY, client: CLIENT, project: PROJECT, now });
  const council = new MemoryRoomLog();
  const lines: string[] = [];
  const home = new Home({ blob, clients: [nest], feedCap: 2, council, log: (l) => lines.push(l), now });
  if (opts.grant !== false) await vault.write("google-nest", { refresh: "test-refresh-nest", connectedAt: NOW });
  return { blob, vault, f, nest, council, home, lines };
}

const commands = (f: { calls: { url: string; init: RequestInit }[] }) => f.calls.filter((c) => c.url.endsWith(":executeCommand")).map((c) => JSON.parse(String(c.init.body)) as { command: string; params: Record<string, number | string> });

describe("the Nest thermostat (#637)", () => {
  it("reads temperature, humidity, mode, set point and HVAC status in whole °F, with an opaque id", () => {
    const found = readThermostat(sdmDevice(), ID_KEY)!;
    expect(found.reading).toMatchObject({ vendor: "nest", kind: "thermostat", online: true, state: "heating", tempF: 69, humidity: 38, mode: "heat", modes: ["heat", "cool", "heatcool", "off"], eco: false, hvac: "heating", heatF: 68, coolF: null, place: "Living Room" });
    expect(found.reading.id).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(found.reading)).not.toMatch(/AVPHwE|private name|enterprises/);
    expect(readThermostat({ ...sdmDevice(), type: "sdm.devices.types.CAMERA" }, ID_KEY)).toBeNull();
    expect(readThermostat(sdmDevice({ eco: "MANUAL_ECO" }), ID_KEY)!.reading.state).toBe("eco");
    expect(readThermostat(sdmDevice({ online: false }), ID_KEY)!.reading.state).toBe("offline");
    expect(readThermostat(sdmDevice({ hvac: "OFF" }), ID_KEY)!.reading.state).toBe("idle");
    expect([cToF(20), fToC(68), fToC(80)]).toEqual([68, 20, 26.67]);
  });

  it("keeps set points from 60 to 80 °F, out of eco, and only the modes it offers", () => {
    const r = readThermostat(sdmDevice(), ID_KEY)!.reading;
    expect(thermostatPlan(r, "thermostat.set", { tempF: 70 })).toEqual({ ok: true, args: { heatF: 70 } });
    expect(thermostatPlan(r, "thermostat.set", { tempF: 69.6 })).toEqual({ ok: true, args: { heatF: 70 } });
    expect(thermostatPlan(r, "thermostat.set", { tempF: THERMO_MAX_F + 1 })).toEqual({ ok: false, code: "range" });
    expect(thermostatPlan(r, "thermostat.set", { tempF: THERMO_MIN_F - 1 })).toEqual({ ok: false, code: "range" });
    expect(thermostatPlan(r, "thermostat.set", { tempF: "hot" })).toEqual({ ok: false, code: "no-setpoint" });
    expect(thermostatPlan({ ...r, eco: true }, "thermostat.set", { tempF: 70 })).toEqual({ ok: false, code: "eco" });
    expect(thermostatPlan({ ...r, mode: "off" }, "thermostat.set", { tempF: 70 })).toEqual({ ok: false, code: "mode-off" });
    const both: DeviceReading = { ...r, mode: "heatcool" };
    expect(thermostatPlan(both, "thermostat.set", { heatF: 66, coolF: 74 })).toEqual({ ok: true, args: { heatF: 66, coolF: 74 } });
    expect(thermostatPlan(both, "thermostat.set", { heatF: 70, coolF: 71 })).toEqual({ ok: false, code: "gap" });
    expect(thermostatPlan(both, "thermostat.set", { heatF: 66, coolF: 82 })).toEqual({ ok: false, code: "range" });
    expect(thermostatPlan(r, "thermostat.mode", { mode: "COOL" })).toEqual({ ok: true, args: { mode: "cool" } });
    expect(thermostatPlan({ ...r, modes: ["heat", "off"] }, "thermostat.mode", { mode: "cool" })).toEqual({ ok: false, code: "bad-mode" });
    expect(thermostatPlan(r, "thermostat.mode", { mode: "eco" })).toEqual({ ok: false, code: "bad-mode" });
    expect(commandFor("thermostat.set", { heatF: 66, coolF: 74 }, "heatcool")).toEqual({ command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange", params: { heatCelsius: 18.89, coolCelsius: 23.33 } });
  });

  it("sets the heat point in Celsius, and logs the change to the Council", async () => {
    const { home, f, council, lines } = await nestSetup();
    const got = await home.act({ action: "thermostat.set", tempF: 70, via: "desk" });
    expect(got).toEqual({ ok: true, say: "The thermostat is set to heat to 70°F." });
    expect(commands(f)).toEqual([{ command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat", params: { heatCelsius: 21.11 } }]);
    const turns = await council.list("kernel", NOW);
    expect(turns[0]).toMatchObject({ question: "Set the thermostat to 70°F", answer: got.say, room: "kernel", model: "home" });
    expect(lines).toEqual(["home: thermostat.set done"]);
  });

  it("refuses outside the rails without calling Google, and still logs the ask", async () => {
    const { home, f, council } = await nestSetup();
    const hot = await home.act({ action: "thermostat.set", tempF: 85, via: "phone", said: "set the heat to 85" });
    expect(hot).toMatchObject({ ok: false, code: "range" });
    expect(hot.say).toContain("60°F and 80°F");
    expect(commands(f)).toEqual([]);
    expect((await council.list("kernel", NOW))[0]).toMatchObject({ question: "set the heat to 85", via: "phone" });
    const eco = await nestSetup(sdmDevice({ eco: "MANUAL_ECO" }));
    expect(await eco.home.act({ action: "thermostat.set", tempF: 70, via: "desk" })).toMatchObject({ ok: false, code: "eco" });
    expect(commands(eco.f)).toEqual([]);
  });

  it("changes the mode, and says a refused grant is down until reconnected", async () => {
    const { home, f } = await nestSetup();
    expect(await home.act({ action: "thermostat.mode", mode: "cool", via: "desk" })).toEqual({ ok: true, say: "The thermostat is on cool." });
    expect(commands(f)).toEqual([{ command: "sdm.devices.commands.ThermostatMode.SetMode", params: { mode: "COOL" } }]);

    const gone = await nestSetup(sdmDevice(), { tokenStatus: 400 });
    expect((await gone.home.status(true)).vendors.nest).toBe("down");
    expect(await gone.vault.read("google-nest")).toMatchObject({ refused: true });
    expect((await gone.home.status(true)).vendors.nest).toBe("waiting");
  });

  it("stays up after a set point change while Google rate-limits the reads (Nikita, 2026-11-04)", async () => {
    // Google's SDM API keeps a per-user quota of reads a minute and answers 429 RESOURCE_EXHAUSTED past it. A change
    // costs a read for the rails and the command, and the Desk reads again straight after: that read must not knock
    // the thermostat down.
    let clock = NOW;
    let limited = false;
    const lists = () => n.f.calls.filter((c) => /\/devices$/.test(c.url)).length;
    const n = await nestSetup(sdmDevice(), { now: () => clock, list: () => (limited ? jsonRes({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Rate limited." } }, 429) : undefined) });
    expect((await n.home.status(true)).vendors.nest).toBe("live");
    clock += 5_000;
    expect(await n.home.act({ action: "thermostat.set", tempF: 70, via: "desk" })).toMatchObject({ ok: true });
    limited = true;
    const before = lists();
    // Straight after: the new set point, without asking Google again.
    clock += 1_000;
    const after = await n.home.status();
    expect(after.vendors.nest).toBe("live");
    expect(after.devices[0]).toMatchObject({ kind: "thermostat", heatF: 70, online: true });
    expect(lists()).toBe(before);
    // A minute on, Google still says slow down: the last good reading stays, marked stale, not down.
    clock += 60_000;
    const later = await n.home.status(true);
    expect(later.vendors.nest).toBe("live");
    expect(later.problems.nest).toBeUndefined();
    expect(later.devices[0]).toMatchObject({ kind: "thermostat", heatF: 70, stale: true });
    expect(Home.publicOf(later).devices).toEqual([{ kind: "thermostat", state: "heating", online: true }]);
    expect(await n.vault.read("google-nest")).not.toMatchObject({ refused: true });
    // Long past any rate limit, it reads down.
    clock += 60 * 60_000;
    expect((await n.home.status(true)).vendors.nest).toBe("down");
    // Two changes in a row: the second uses the reading the first left, so it costs Google one command and no read.
    limited = false;
    clock += 1_000;
    expect((await n.home.status(true)).vendors.nest).toBe("live");
    const cmds = commands(n.f).length;
    const reads = lists();
    expect(await n.home.act({ action: "thermostat.set", tempF: 71, via: "desk" })).toMatchObject({ ok: true });
    expect(await n.home.act({ action: "thermostat.set", tempF: 72, via: "desk" })).toMatchObject({ ok: true });
    expect(commands(n.f).length).toBe(cmds + 2);
    expect(lists()).toBe(reads + 1);
  });

  it("shares one token refresh between calls at once, and never marks the grant refused for a hiccup", async () => {
    const n = await nestSetup();
    await Promise.all([n.nest.status(), n.nest.status(), n.nest.status()]);
    expect(n.f.calls.filter((c) => c.url.endsWith("/token")).length).toBe(1);
    const flaky = await nestSetup(sdmDevice(), { tokenStatus: 503 });
    expect((await flaky.home.status(true)).vendors.nest).toBe("down");
    expect(await flaky.vault.read("google-nest")).not.toMatchObject({ refused: true });
  });

  it("waits until the client, the project and the grant are all there, and keeps the grant sealed", async () => {
    const { nest, vault, blob, home } = await nestSetup(sdmDevice(), { grant: false });
    expect(await nest.connected()).toBe(false);
    expect((await home.status(true)).vendors.nest).toBe("waiting");
    await vault.write("google-nest", { refresh: "test-refresh-nest", connectedAt: NOW });
    expect(await nest.connected()).toBe(true);
    const view = await home.status(true);
    expect(view.vendors.nest).toBe("live");
    expect(view.devices.map((d) => d.kind)).toEqual(["thermostat"]);
    expect(Home.publicOf(view).devices).toEqual([{ kind: "thermostat", state: "heating", online: true }]);
    for (const s of SECRETS) expect(allText(blob)).not.toContain(s);
    expect(blob.files.has(vaultPath("google-nest"))).toBe(true);
  });
});

/* ── Connect Nest and Connect Google Tasks ── */

async function googleSetup(over: Partial<GoogleRouteDeps> = {}) {
  forgetTokens();
  const blob = memoryBlob();
  const store = new MemoryAuthStore();
  const vault = new HomeVault(blob, SEAL);
  const lines: string[] = [];
  const cookie = await signedInCookie(DESK, NOW, store);
  const deps: GoogleRouteDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, vault, client: CLIENT, project: PROJECT, fetch: fakeFetch([]), now: NOW, log: (l) => lines.push(l), ...over };
  return { deps, blob, vault, cookie, lines, store };
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, ...headers } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

describe("Connect Nest and Connect Google Tasks (#637)", () => {
  it("reads the settings, and sends Nest through Partner Connections and Tasks through Google's consent page", () => {
    expect(havenClientFrom({})).toBeNull();
    expect(havenClientFrom({ HAVEN_GOOGLE_CLIENT_ID: "id", HAVEN_GOOGLE_CLIENT_SECRET: "s" })?.redirectUri).toMatch(/\/api\/haven\/google-callback$/);
    expect(nestProjectFrom({ HAVEN_NEST_PROJECT_ID: ` ${PROJECT.toUpperCase()} ` })).toBe(PROJECT);
    expect(nestProjectFrom({ HAVEN_NEST_PROJECT_ID: "not-a-project" })).toBeNull();
    const nest = new URL(authUrl("nest", CLIENT, "nonce", PROJECT)!);
    expect(`${nest.origin}${nest.pathname}`).toBe(`https://nestservices.google.com/partnerconnections/${PROJECT}/auth`);
    expect(Object.fromEntries(nest.searchParams)).toMatchObject({ scope: SDM_SCOPE, state: "nonce", access_type: "offline", prompt: "consent", response_type: "code" });
    expect(authUrl("nest", CLIENT, "nonce", null)).toBeNull();
    const tasks = new URL(authUrl("tasks", CLIENT, "nonce", null)!);
    expect(tasks.origin).toBe("https://accounts.google.com");
    expect(tasks.searchParams.get("scope")).toBe(TASKS_SCOPE);
  });

  it("keeps a grant only for exactly its own scope", async () => {
    const answer = (scope: string) => fakeFetch([[/POST https:\/\/oauth2\.googleapis\.com\/token$/, () => ({ refresh_token: "test-refresh-tasks", access_token: "test-access", scope })]]);
    expect(await exchangeCode(answer(TASKS_SCOPE), "tasks", CLIENT, "code")).toBe("test-refresh-tasks");
    await expect(exchangeCode(answer(`${TASKS_SCOPE} https://www.googleapis.com/auth/gmail.modify`), "tasks", CLIENT, "code")).rejects.toThrow("scope");
    await expect(exchangeCode(answer(TASKS_SCOPE), "nest", CLIENT, "code")).rejects.toThrow("scope");
  });

  it("connects only with our own signed state, and seals the refresh token", async () => {
    const f = fakeFetch([
      [/POST https:\/\/oauth2\.googleapis\.com\/token$/, (_u, init) => (String(init.body).includes("authorization_code") ? { refresh_token: "test-refresh-nest", scope: SDM_SCOPE } : { access_token: "test-access", expires_in: 3599 })],
      [/GET https:\/\/smartdevicemanagement\.googleapis\.com\/v1\/enterprises\/[^/]+\/devices$/, () => ({ devices: [] })],
    ]);
    const { deps, cookie, vault, blob, lines } = await googleSetup({ fetch: f });
    const res = await googlePost(post("/api/haven/google", { action: "connect", grant: "nest" }, { Cookie: cookie }), deps);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))!;
    expect(set).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const stateValue = set.split(";")[0]!.slice(STATE_COOKIE.length + 1);

    // A different state, or none, is refused and stores nothing.
    const wrong = await googleCallback(get(`/api/haven/google-callback?code=c&state=other`, { Cookie: `${STATE_COOKIE}=${stateValue}` }), deps);
    expect(wrong.headers.get("Location")).toBe("/?haven=refused");
    expect(await vault.read("google-nest")).toBeNull();

    const ok = await googleCallback(get(`/api/haven/google-callback?code=c&state=${state}`, { Cookie: `${STATE_COOKIE}=${stateValue}` }), deps);
    expect(ok.headers.get("Location")).toBe("/?haven=nest-connected");
    expect(await vault.read("google-nest")).toMatchObject({ refresh: "test-refresh-nest" });
    // The devices are listed once, which finishes the Device Access authorization.
    expect(f.calls.some((c) => c.url.endsWith("/devices"))).toBe(true);
    for (const s of SECRETS) expect(allText(blob)).not.toContain(s);
    for (const s of SECRETS) expect(lines.join("\n")).not.toContain(s);
  });

  it("checks the state's grant, expiry and nonce", async () => {
    const { nonce, cookie } = await makeState(DESK, "tasks", "test-passkey", NOW);
    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    expect(await checkState(DESK, value, nonce, NOW)).toEqual({ grant: "tasks", passkey: "test-passkey" });
    expect(await checkState(DESK, value, nonce, NOW + 11 * 60_000)).toBeNull();
    expect(await checkState(DESK, value, `${nonce}x`, NOW)).toBeNull();
    expect(await checkState("another desk key", value, nonce, NOW)).toBeNull();
  });

  it("takes a passkey session only, and shows the public states and nothing else", async () => {
    const { deps, cookie, blob } = await googleSetup();
    expect((await googlePost(post("/api/haven/google", { action: "connect", grant: "tasks" }), deps)).status).toBe(401);
    expect((await googlePost(post("/api/haven/google", { action: "connect", grant: "tasks" }, { Cookie: cookie, Authorization: "Bearer skp_x" }), deps)).status).toBe(401);
    expect((await googlePost(post("/api/haven/google", { action: "connect", grant: "tasks" }, { Cookie: cookie, "x-ceo-phone-key": "skp_x" }), deps)).status).toBe(401);
    expect((await googleGet(get("/api/haven/google"), deps)).status).toBe(401);
    await setTasksList(blob, "Groceries for Nikita");
    const pub = await (await googleGet(get("/api/haven/google?view=status"), deps)).text();
    expect(JSON.parse(pub)).toEqual({ ready: true, nest: "waiting", tasks: "waiting" });
    expect(pub).not.toContain("Groceries");
    const priv = (await (await googleGet(get("/api/haven/google", { Cookie: cookie }), deps)).json()) as { tasks: { list: string } };
    expect(priv.tasks.list).toBe("Groceries for Nikita");
  });

  it("disconnects a grant and asks Google to revoke it", async () => {
    const f = fakeFetch([[/POST https:\/\/oauth2\.googleapis\.com\/revoke$/, () => ({})]]);
    const { deps, cookie, vault } = await googleSetup({ fetch: f });
    await vault.write("google-tasks", { refresh: "test-refresh-tasks", connectedAt: NOW });
    expect((await googlePost(post("/api/haven/google", { action: "disconnect", grant: "tasks" }, { Cookie: cookie }), deps)).status).toBe(200);
    expect(await vault.read("google-tasks")).toBeNull();
    expect(f.calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/revoke"]);
  });
});

/* ── Google Tasks quick-add ── */

function tasksFetch(tasks: { id: string; title: string; status?: string }[], lists = [{ id: "LIST1", title: "shopping " }]) {
  return fakeFetch([
    [/POST https:\/\/oauth2\.googleapis\.com\/token$/, () => ({ access_token: "test-access", expires_in: 3599 })],
    [/GET https:\/\/tasks\.googleapis\.com\/tasks\/v1\/users\/@me\/lists$/, () => ({ items: lists })],
    [/GET https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/LIST1\/tasks$/, () => ({ items: tasks.map((t) => ({ status: "needsAction", ...t })) })],
    [/PATCH https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/LIST1\/tasks\/[^/]+$/, () => ({})],
  ]);
}

describe("Google Tasks quick-add (#637)", () => {
  beforeEach(() => forgetTokens());

  it("imports new items, skips ones already listed (ignoring case), and marks every one completed", async () => {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    await vault.write("google-tasks", { refresh: "test-refresh-tasks", connectedAt: NOW });
    await new KitchenList(blob).add(["Garlic"], NOW);
    const f = tasksFetch([
      { id: "t1", title: "oat milk" },
      { id: "t2", title: "garlic" },
      { id: "t3", title: "Lemons" },
      { id: "t4", title: "done already", status: "completed" },
    ]);
    const lines: string[] = [];
    const got = await syncTasks({ fetch: f, client: CLIENT, vault, blob, now: () => NOW, log: (l) => lines.push(l) });
    expect(got).toEqual({ result: "synced", imported: 2, skipped: 1 });
    const items = await new KitchenList(blob).items(NOW);
    expect(items.map((i) => [i.name, i.source])).toEqual([["Garlic", "phone"], ["oat milk", "tasks"], ["Lemons", "tasks"]]);
    const patched = f.calls.filter((c) => c.init.method === "PATCH");
    expect(patched.map((c) => c.url.split("/").pop())).toEqual(["t1", "t2", "t3"]);
    expect(patched.every((c) => JSON.parse(String(c.init.body)).status === "completed")).toBe(true);
    expect(lines).toEqual(["tasks: 2 imported, 1 already listed"]);
    expect(await readTasksState(blob)).toMatchObject({ list: "Shopping", lastResult: "synced", lastImported: 2, imported: 2 });
  });

  it("waits without a grant, says when the list isn't there, and is down when Google refuses", async () => {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    const lines: string[] = [];
    const deps = (f: Fetch) => ({ fetch: f, client: CLIENT, vault, blob, now: () => NOW, log: (l: string) => lines.push(l) });
    expect((await syncTasks(deps(tasksFetch([])))).result).toBe("waiting");
    await vault.write("google-tasks", { refresh: "test-refresh-tasks", connectedAt: NOW });
    expect((await syncTasks(deps(tasksFetch([{ id: "t1", title: "eggs" }], [{ id: "LIST1", title: "Errands" }])))).result).toBe("no-list");
    expect(await new KitchenList(blob).items(NOW)).toEqual([]);
    forgetTokens();
    const refuse = fakeFetch([[/POST https:\/\/oauth2\.googleapis\.com\/token$/, () => jsonRes({ error: "invalid_grant" }, 400)]]);
    expect((await syncTasks(deps(refuse))).result).toBe("refused");
    expect(await vault.read("google-tasks")).toMatchObject({ refused: true });
    expect(lines.join("\n")).not.toContain("eggs");
  });
});
