import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import { Govee, GOVEE_BASE } from "./govee.ts";
import { Lights, lightId, STATE_BUDGET } from "./lights.ts";
import { lightsGet, lightsPost, type LightsRouteDeps } from "./route.ts";
import { signedHeaders, SwitchBot, SWITCHBOT_BASE } from "./switchbot.ts";

/**
 * The Haven's lights (#931). Every account, device, name and key here is made up: nothing is anyone's real home.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-06T18:00:00Z");
const ID_KEY = Buffer.alloc(32, 7);

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** A made-up SwitchBot and Govee account: two plugs, a hub, a projector remote, one scene, one Govee strip. */
function vendors(opts: { sbDown?: boolean } = {}) {
  const calls: Call[] = [];
  const power: Record<string, string> = { "SB-PLUG-1": "on", "SB-BOT-2": "off" };
  let goveeOn = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const f = async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body, headers });
    if (url.startsWith(SWITCHBOT_BASE)) {
      if (opts.sbDown) return reply({ statusCode: 190, message: "nope" });
      const path = url.slice(SWITCHBOT_BASE.length);
      if (path === "/devices")
        return reply({
          statusCode: 100,
          body: {
            deviceList: [
              { deviceId: "SB-HUB-0", deviceName: "Test Hub", deviceType: "Hub Mini", enableCloudService: false },
              { deviceId: "SB-PLUG-1", deviceName: "Study", deviceType: "Plug Mini (US)", enableCloudService: true },
              { deviceId: "SB-BOT-2", deviceName: "Porch", deviceType: "Bot", enableCloudService: true },
            ],
            infraredRemoteList: [{ deviceId: "SB-IR-3", deviceName: "Beamer", remoteType: "Projector", hubDeviceId: "SB-HUB-0" }],
          },
        });
      if (path === "/scenes") return reply({ statusCode: 100, body: [{ sceneId: "SC-1", sceneName: "All off" }] });
      const st = path.match(/^\/devices\/([^/]+)\/status$/);
      if (st) return reply({ statusCode: 100, body: { power: power[decodeURIComponent(st[1]!)] } });
      const cmd = path.match(/^\/devices\/([^/]+)\/commands$/);
      if (cmd) {
        power[decodeURIComponent(cmd[1]!)] = body.command === "turnOn" ? "on" : "off";
        return reply({ statusCode: 100, body: {} });
      }
      if (path === "/scenes/SC-1/execute") return reply({ statusCode: 100, body: {} });
      return reply({ statusCode: 160 });
    }
    if (url.startsWith(GOVEE_BASE)) {
      const path = url.slice(GOVEE_BASE.length);
      if (path === "/user/devices")
        return reply({
          code: 200,
          data: [
            { sku: "H6000", device: "AA:BB", deviceName: "Shelf strip", type: "devices.types.light", capabilities: [{ type: "devices.capabilities.on_off", instance: "powerSwitch" }] },
            { sku: "H7000", device: "CC:DD", deviceName: "Air sensor", type: "devices.types.sensor", capabilities: [] },
            {
              sku: "H6076",
              device: "EE:FF",
              deviceName: "Test Floor Lamp",
              type: "devices.types.light",
              capabilities: [
                { type: "devices.capabilities.on_off", instance: "powerSwitch" },
                { type: "devices.capabilities.range", instance: "brightness", parameters: { range: { min: 1, max: 100 } } },
                { type: "devices.capabilities.color_setting", instance: "colorRgb" },
                { type: "devices.capabilities.color_setting", instance: "colorTemperatureK", parameters: { range: { min: 2200, max: 6500 } } },
                { type: "devices.capabilities.dynamic_scene", instance: "lightScene", parameters: { options: [] } },
              ],
            },
            { sku: "SameModeGroup", device: "GG:HH", deviceName: "Same-Model", type: "devices.types.light", capabilities: [{ type: "devices.capabilities.on_off", instance: "powerSwitch" }] },
          ],
        });
      if (path === "/device/state")
        return reply({
          code: 200,
          payload: {
            capabilities: [
              { type: "devices.capabilities.on_off", instance: "powerSwitch", state: { value: goveeOn } },
              { type: "devices.capabilities.online", instance: "online", state: { value: true } },
              ...(body.payload.device === "EE:FF" ? [{ instance: "colorRgb", state: { value: 0x39ff7a } }, { instance: "brightness", state: { value: 80 } }] : []),
            ],
          },
        });
      if (path === "/device/scenes") return reply({ code: 200, payload: { capabilities: [{ type: "devices.capabilities.dynamic_scene", instance: "lightScene", parameters: { options: [{ name: "Aurora", value: { id: 11, paramId: 22 } }, { name: "<b>Sunset</b>", value: { id: 33, paramId: 44 } }] } }] } });
      if (path === "/device/control") {
        if (body.payload.capability.instance === "powerSwitch") goveeOn = body.payload.capability.value;
        return reply({ code: 200 });
      }
    }
    return reply({}, 404);
  };
  return { f, calls };
}

function lightsWith(v = vendors(), keys = { sb: true, gv: true }) {
  const lines: string[] = [];
  let now = NOW;
  const lights = new Lights({
    switchbot: keys.sb ? new SwitchBot(v.f, "test-sb-token", "test-sb-secret") : null,
    govee: keys.gv ? new Govee(v.f, "test-govee-key") : null,
    idKey: ID_KEY,
    now: () => now,
    log: (l) => lines.push(l),
  });
  return { lights, lines, calls: v.calls, tick: (ms: number) => void (now += ms) };
}

describe("SwitchBot's signature (#931)", () => {
  it("signs token + t + nonce with HMAC-SHA256 under the secret, in base64", () => {
    const h = signedHeaders("tok", "sec", 1_700_000_000_000, "n-1");
    expect(h.sign).toBe(createHmac("sha256", "sec").update("tok1700000000000n-1").digest("base64"));
    expect(h).toMatchObject({ Authorization: "tok", t: "1700000000000", nonce: "n-1" });
  });
});

describe("the lights (#931)", () => {
  it("lists the lights with their states, the scenes and the remotes, with opaque ids and no hub or sensor", async () => {
    const { lights } = lightsWith();
    const v = await lights.view();
    expect(v.vendors).toEqual({ switchbot: "live", govee: "live" });
    expect(v.lights.map((l) => [l.name, l.vendor, l.type, l.on])).toEqual([
      ["Porch", "switchbot", "Bot", false],
      ["Shelf strip", "govee", "devices.types.light", false],
      ["Study", "switchbot", "Plug Mini (US)", true],
      ["Test Floor Lamp", "govee", "devices.types.light", false],
    ]);
    // A group made in the app is listed apart, never as a light.
    expect(v.groups?.map((g) => g.name)).toEqual(["Same-Model"]);
    expect(v.scenes.map((s) => s.name)).toEqual(["All off"]);
    expect(v.remotes.map((r) => [r.name, r.type])).toEqual([["Beamer", "Projector"]]);
    for (const x of [...v.lights, ...v.scenes, ...v.remotes]) expect(x.id).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(v)).not.toMatch(/SB-|AA:BB|SC-1/);
    expect(v.lights[2]!.id).toBe(lightId(ID_KEY, "switchbot", "SB-PLUG-1"));
  });

  it("switches a light, a Govee light and the projector's remote, and keeps the new state without reading back", async () => {
    const { lights, calls, lines } = lightsWith();
    const v = await lights.view();
    const n = calls.length;
    expect(await lights.set(v.lights.find((l) => l.name === "Study")!.id, false)).toMatchObject({ ok: true, say: "Study is off." });
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { command: "turnOff", parameter: "default", commandType: "command" } });
    expect(calls.at(-1)!.headers.sign).toBeTruthy();
    expect(await lights.set(v.lights.find((l) => l.name === "Shelf strip")!.id, true)).toMatchObject({ ok: true });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { sku: "H6000", device: "AA:BB", capability: { instance: "powerSwitch", value: 1 } } });
    expect(calls.at(-1)!.headers["Govee-API-Key"]).toBe("test-govee-key");
    expect(await lights.set(v.remotes[0]!.id, true)).toMatchObject({ ok: true, say: "Beamer is on." });
    expect(calls.at(-1)!.url).toBe(`${SWITCHBOT_BASE}/devices/SB-IR-3/commands`);
    expect(calls.length).toBe(n + 3);
    const again = await lights.view();
    expect(again.lights.find((l) => l.name === "Study")!.on).toBe(false);
    expect(calls.length).toBe(n + 3);
    // No line holds a name or a vendor id.
    expect(lines.join("\n")).not.toMatch(/Study|Shelf|Beamer|SB-|AA:BB/);
  });

  it("runs a scene and reads the states fresh afterwards", async () => {
    const { lights, calls } = lightsWith();
    const v = await lights.view();
    expect(await lights.scene(v.scenes[0]!.id)).toMatchObject({ ok: true, say: "Done: All off." });
    expect(calls.at(-1)!.url).toBe(`${SWITCHBOT_BASE}/scenes/SC-1/execute`);
    const n = calls.length;
    await lights.view();
    expect(calls.length).toBeGreaterThan(n);
  });

  it("keeps the states 20 s, reads them again after 4 s when asked fresh, and slows down past the day's budget (#1020)", async () => {
    const { lights, calls, tick } = lightsWith();
    await lights.view();
    const n = calls.length;
    tick(3_000);
    await lights.view({ fresh: true });
    expect(calls.length).toBe(n);
    tick(2_000);
    await lights.view();
    expect(calls.length).toBe(n);
    await lights.view({ fresh: true });
    const m = calls.length;
    expect(m).toBeGreaterThan(n);
    tick(21_000);
    await lights.view();
    expect(calls.length).toBeGreaterThan(m);
    // Past the budget the states are kept three minutes, a fresh read included.
    (lights as unknown as { calls: { n: number } }).calls.n = STATE_BUDGET;
    const k = calls.length;
    tick(60_000);
    await lights.view({ fresh: true });
    expect(calls.length).toBe(k);
    tick(121_000);
    await lights.view();
    expect(calls.length).toBeGreaterThan(k);
  });

  it("refuses an id it doesn't know, a scene's id as a light and a hub", async () => {
    const { lights } = lightsWith();
    const v = await lights.view();
    expect(await lights.set("0123456789ab", true)).toMatchObject({ ok: false, code: "unknown" });
    expect(await lights.set(v.scenes[0]!.id, true)).toMatchObject({ ok: false, code: "unknown" });
    expect(await lights.set(lightId(ID_KEY, "switchbot", "SB-HUB-0"), true)).toMatchObject({ ok: false, code: "unknown" });
    expect(await lights.scene(v.lights[0]!.id)).toMatchObject({ ok: false, code: "unknown" });
  });

  it("finds a light, remote or scene by its name as said, and nothing when it's unclear", async () => {
    const { lights } = lightsWith();
    expect(await lights.byName("the study light")).toMatchObject({ kind: "light", name: "Study" });
    expect(await lights.byName("beamer")).toMatchObject({ kind: "remote" });
    expect(await lights.byName("All off")).toMatchObject({ kind: "scene" });
    expect(await lights.byName("garage")).toBeNull();
  });

  it("says a vendor is down, waiting without its key, and keeps the other", async () => {
    const { lights, lines } = lightsWith(vendors({ sbDown: true }));
    const v = await lights.view();
    expect(v.vendors).toEqual({ switchbot: "down", govee: "live" });
    expect(v.lights.map((l) => l.name)).toEqual(["Shelf strip", "Test Floor Lamp"]);
    expect(lines.join("\n")).toMatch(/switchbot list failed \(190\)/);
    const only = await lightsWith(vendors(), { sb: false, gv: true }).lights.view();
    expect(only.vendors.switchbot).toBe("waiting");
  });

  it("reads a Govee light's colour, brightness and moods, and sets each (#974)", async () => {
    const { lights, calls, lines } = lightsWith();
    const v = await lights.view();
    const lamp = v.lights.find((l) => l.name === "Test Floor Lamp")!;
    expect(lamp).toMatchObject({ rgb: "#39ff7a", brightness: 80, look: { color: true, brightness: true, kelvin: [2200, 6500], moods: ["Aurora", "bSunset/b"] } });
    expect(v.lights.find((l) => l.name === "Shelf strip")!.look).toMatchObject({ color: false, moods: [] });
    expect(await lights.look(lamp.id, { rgb: 0xff3030 })).toMatchObject({ ok: true });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { device: "EE:FF", capability: { type: "devices.capabilities.color_setting", instance: "colorRgb", value: 0xff3030 } } });
    expect(await lights.look(lamp.id, { kelvin: 1000 })).toMatchObject({ ok: true });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { capability: { instance: "colorTemperatureK", value: 2200 } } });
    expect(await lights.look(lamp.id, { brightness: 40 })).toMatchObject({ ok: true });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { capability: { instance: "brightness", value: 40 } } });
    expect(await lights.look(lamp.id, { mood: "aurora" })).toMatchObject({ ok: true, say: "Test Floor Lamp: Aurora." });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { capability: { type: "devices.capabilities.dynamic_scene", instance: "lightScene", value: { id: 11, paramId: 22 } } } });
    expect(await lights.look(lamp.id, { mood: "Disco" })).toMatchObject({ ok: false, code: "unknown" });
    const strip = v.lights.find((l) => l.name === "Shelf strip")!;
    expect(await lights.look(strip.id, { rgb: 0xffffff })).toMatchObject({ ok: false, code: "unknown" });
    expect(await lights.look(v.groups![0]!.id, { rgb: 0xffffff })).toMatchObject({ ok: false, code: "unknown" });
    // A group switches on and off like a light.
    expect(await lights.set(v.groups![0]!.id, true)).toMatchObject({ ok: true });
    expect(calls.at(-1)!.body).toMatchObject({ payload: { sku: "SameModeGroup", device: "GG:HH" } });
    expect(lines.join("\n")).not.toMatch(/Floor Lamp|EE:FF|Aurora/);
  });

  it("keeps the states 20 s, then reads them again (#1020)", async () => {
    const t = lightsWith();
    await t.lights.view();
    const n = t.calls.length;
    t.tick(15_000);
    await t.lights.view();
    expect(t.calls.length).toBe(n);
    t.tick(10_000);
    await t.lights.view();
    expect(t.calls.length).toBeGreaterThan(n);
  });
});

describe("/api/haven/lights (#931)", () => {
  const routeDeps = (store = new MemoryAuthStore(), lights: Lights | null = lightsWith().lights): LightsRouteDeps & { store: MemoryAuthStore } => ({ desk: { deskKey: DESK, store, now: NOW }, lights: () => lights, store });
  const post = (body: unknown, cookie = "") => new Request(`${ORIGIN}/api/haven/lights`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });

  it("answers nobody without a passkey session, and switches nothing", async () => {
    const t = lightsWith();
    const d = routeDeps(undefined, t.lights);
    expect((await lightsGet(new Request(`${ORIGIN}/api/haven/lights`), d)).status).toBe(401);
    expect((await lightsGet(new Request(`${ORIGIN}/api/haven/lights`, { headers: { "x-ceo-phone-key": "a".repeat(43) } }), d)).status).toBe(401);
    expect((await lightsPost(post({ op: "set", id: "0123456789ab", on: true }), d)).status).toBe(401);
    expect(t.calls.length).toBe(0);
  });

  it("lists and switches for a passkey session, and refuses a bad body", async () => {
    const d = routeDeps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    const got = await lightsGet(new Request(`${ORIGIN}/api/haven/lights`, { headers: { Cookie: cookie } }), d);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toBe("private, no-store");
    const v = (await got.json()) as { lights: { id: string; name: string }[] };
    const study = v.lights.find((l) => l.name === "Study")!;
    expect((await lightsPost(post({ op: "set", id: study.id, on: false }, cookie), d)).status).toBe(200);
    expect((await lightsPost(post({ op: "set", id: study.id }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "set", id: "SB-PLUG-1", on: true }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "blink", id: study.id }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "set", id: "0123456789ab", on: true }, cookie), d)).status).toBe(404);
    // #974: one look change at a time, checked.
    const lamp = v.lights.find((l) => l.name === "Test Floor Lamp")!;
    expect((await lightsPost(post({ op: "look", id: lamp.id, rgb: "#39ff7a" }, cookie), d)).status).toBe(200);
    expect((await lightsPost(post({ op: "look", id: lamp.id, brightness: 50 }, cookie), d)).status).toBe(200);
    expect((await lightsPost(post({ op: "look", id: lamp.id, rgb: "green" }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "look", id: lamp.id, brightness: 0 }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "look", id: lamp.id, rgb: "#39ff7a", brightness: 50 }, cookie), d)).status).toBe(400);
    expect((await lightsPost(post({ op: "look", id: study.id, rgb: "#39ff7a" }, cookie), d)).status).toBe(404);
  });

  it("takes ?fresh=1 and no other query (#1020)", async () => {
    const d = routeDeps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    expect((await lightsGet(new Request(`${ORIGIN}/api/haven/lights?fresh=1`, { headers: { Cookie: cookie } }), d)).status).toBe(200);
    expect((await lightsGet(new Request(`${ORIGIN}/api/haven/lights?fresh=2`, { headers: { Cookie: cookie } }), d)).status).toBe(400);
  });

  it("waits without keys", async () => {
    const d = routeDeps(undefined, null);
    const cookie = await signedInCookie(DESK, NOW, d.store);
    expect((await lightsGet(new Request(`${ORIGIN}/api/haven/lights`, { headers: { Cookie: cookie } }), d)).status).toBe(503);
  });
});
