import { createHash, createHmac } from "node:crypto";
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import { MemoryRoomLog } from "../../_skippy/log.ts";
import { decide, type GateContext } from "../../_site/gate.ts";
import { classify } from "../classify.ts";
import { PhoneKeys } from "../phones.ts";
import { claimSignature, clientSecret, cognitoTimestamp, G, hkdf, K, modPow, N, padHex, srpSignIn, type CognitoTokens } from "./cognito.ts";
import { Home, type HomeDeps } from "./home.ts";
import type { Fetch } from "./http.ts";
import { connectPacket, publishPacket, readPackets, readPublish } from "./mqtt.ts";
import { PetlibroClient, petlibroKind } from "./petlibro.ts";
import { FeedLedger, feedCap, litterBlock, mountainDay } from "./rails.ts";
import { crc32, decodeMessage, encodeMessage, hawk, loginWithCode, mqttParams, requestPayload, responseResult, RoborockClient, scrambledTs, sendCode, vacuumReading, type RoborockLogin } from "./roborock.ts";
import { matchRooms, namedRooms, roomKey, segmentPairs } from "./rooms.ts";
import { devicesAction, devicesConnect, devicesGet, type DevicesDeps } from "./route.ts";
import type { DeviceClient, DeviceReading, Found } from "./types.ts";
import { deviceId, HomeVault, homeKey, vaultPath } from "./vault.ts";
import { litterReading, litterState, WhiskerClient } from "./whisker.ts";
import homeFixture from "./fixtures/roborock-home.json";
import statusFixture from "./fixtures/roborock-status.json";
import mappingFixture from "./fixtures/roborock-room-mapping.json";
import robotsFixture from "./fixtures/whisker-robots.json";
import activitiesFixture from "./fixtures/whisker-activities.json";
import petListFixture from "./fixtures/petlibro-list.json";
import petRealFixture from "./fixtures/petlibro-realinfo.json";
import petWorkFixture from "./fixtures/petlibro-workrecord.json";

/**
 * Nikita's home devices (#632): each vendor client against recorded-shape fixtures (every serial, key, email and
 * login digest here is made up), the safety rails, the room names, the Council log, the routes' sign-in and what never
 * leaves the server.
 */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const HOME_KEY = "a-test-home-token-key-that-is-long-enough-0123";
const SEAL = homeKey(HOME_KEY, "seal")!;
const ID_KEY = homeKey(HOME_KEY, "id")!;
const PEPPER = Buffer.alloc(32, 7);
const SERIALS = ["TESTDUID000000000001", "LR5PTESTSERIAL0001", "AF0400TESTDRY01", "PLAF7TESTWET01", "PLWF1TESTWTR01"];
/** Made-up login digests: the setup paste makes the real ones in Cloud Shell, and the code never hashes a password. */
const PL_TEST = "0123456789abcdef0123456789abcdef";
const SRP_TEST = "ab".repeat(32);
const SECRETS = ["abcdefghijklmnop", "rr-test-token", "test-rriot-h", "test-rriot-s", "nikita.test@example.com", PL_TEST, SRP_TEST, "pl-token-1", "whisker-id-token"];

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

/** A fetch that answers from a list of routes and records every call. */
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

/* ── Roborock ── */

const RRIOT = { u: "test-rriot-u", s: "test-rriot-s", h: "test-rriot-h", k: "test-rriot-k", r: { a: "https://api-us.roborock.test", m: "ssl://mqtt-us.roborock.test:8883" } };
const LOGIN: RoborockLogin = { email: "nikita.test@example.com", baseUrl: "https://usiot.roborock.test", clientId: "client-id-test", token: "rr-test-token", rriot: RRIOT };

/** A fake MQTT broker for one device: answers CONNECT and SUBSCRIBE, and each RPC from `answers` by method. */
class FakeBroker extends Duplex {
  buf = Buffer.alloc(0);
  sent: { method: string; params: unknown }[] = [];
  connects: Buffer[] = [];
  constructor(
    private readonly localKey: string,
    private readonly answers: Record<string, unknown>,
    private readonly refuse = false,
  ) {
    super();
  }
  override _read() {}
  override _write(chunk: Buffer, _enc: BufferEncoding, done: () => void) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const { packets, rest } = readPackets(this.buf);
    this.buf = Buffer.from(rest);
    for (const p of packets) {
      if (p.type === 1) {
        this.connects.push(Buffer.from(p.body));
        this.push(Buffer.from([0x20, 0x03, 0x00, this.refuse ? 0x86 : 0x00, 0x00]));
      } else if (p.type === 8) {
        const id = p.body.readUInt16BE(0);
        this.push(Buffer.from([0x90, 0x04, id >> 8, id & 0xff, 0x00, 0x00]));
      } else if (p.type === 3) {
        const msg = readPublish(p);
        const m = decodeMessage(msg.payload, this.localKey)!;
        const inner = JSON.parse(JSON.parse(m.payload.toString()).dps["101"]) as { id: number; method: string; params: unknown };
        this.sent.push({ method: inner.method, params: inner.params });
        const result = this.answers[inner.method] ?? ["ok"];
        const reply = encodeMessage({ seq: 1, random: 2, timestamp: m.timestamp, protocol: 102, payload: Buffer.from(JSON.stringify({ dps: { "102": JSON.stringify({ id: inner.id, result }) }, t: m.timestamp })) }, this.localKey);
        this.push(publishPacket(msg.topic.replace("rr/m/i/", "rr/m/o/"), reply));
      }
    }
    done();
  }
}

function roborockFetch() {
  return fakeFetch([
    [/GET https:\/\/usiot\.roborock\.test\/api\/v1\/getHomeDetail$/, () => ({ code: 200, data: { rrHomeId: 1234567 } })],
    [/GET https:\/\/api-us\.roborock\.test\/v3\/user\/homes\/1234567$/, () => homeFixture],
  ]);
}

describe("Roborock's V1 messages", () => {
  it("scrambles the timestamp as python-roborock does", () => {
    expect(scrambledTs(0x12345678)).toBe("67482315");
    expect(scrambledTs(0)).toBe("00000000");
  });

  it("round-trips a request under the device's local key, with a CRC32 the broker checks", () => {
    const payload = requestPayload(12345, "get_status", [], 1_762_280_000);
    expect(JSON.parse(payload.toString())).toEqual({ dps: { "101": '{"id":12345,"method":"get_status","params":[]}' }, t: 1_762_280_000 });
    const wire = encodeMessage({ seq: 100001, random: 20002, timestamp: 1_762_280_000, protocol: 101, payload }, "abcdefghijklmnop");
    expect(wire.subarray(0, 3).toString()).toBe("1.0");
    expect(wire.readUInt32BE(wire.length - 4)).toBe(crc32(wire.subarray(0, wire.length - 4)));
    const back = decodeMessage(wire, "abcdefghijklmnop")!;
    expect(back).toMatchObject({ seq: 100001, random: 20002, timestamp: 1_762_280_000, protocol: 101 });
    expect(back.payload.equals(payload)).toBe(true);
    // The wrong key, or a flipped byte, reads as nothing.
    expect(decodeMessage(wire, "ponmlkjihgfedcba")).toBeNull();
    const bad = Buffer.from(wire);
    bad[20] = bad[20]! ^ 0xff;
    expect(decodeMessage(bad, "abcdefghijklmnop")).toBeNull();
  });

  it("matches CRC32 to the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("reads an RPC answer for its own request id only, and refuses an error answer", () => {
    const msg = (inner: unknown) => ({ seq: 1, random: 1, timestamp: 1, protocol: 102, payload: Buffer.from(JSON.stringify({ dps: { "102": JSON.stringify(inner) } })) });
    expect(responseResult(msg({ id: 7, result: ["ok"] }), 7)).toEqual(["ok"]);
    expect(responseResult(msg({ id: 8, result: ["ok"] }), 7)).toBeUndefined();
    expect(() => responseResult(msg({ id: 7, error: { code: -10007, message: "invalid status" } }), 7)).toThrow();
  });

  it("derives the broker login and Hawk header from the rriot credentials", () => {
    const p = mqttParams(RRIOT);
    expect(p).toEqual({ host: "mqtt-us.roborock.test", port: 8883, username: createHash("md5").update("test-rriot-u:test-rriot-k").digest("hex").slice(2, 10), password: createHash("md5").update("test-rriot-s:test-rriot-k").digest("hex").slice(16) });
    const h = hawk(RRIOT, "/v3/user/homes/1", 1_762_280_000, "abcd1234");
    const pre = ["test-rriot-u", "test-rriot-s", "abcd1234", "1762280000", createHash("md5").update("/v3/user/homes/1").digest("hex"), "", ""].join(":");
    expect(h).toBe(`Hawk id="test-rriot-u",s="test-rriot-s",ts="1762280000",nonce="abcd1234",mac="${createHmac("sha256", "test-rriot-h").update(pre).digest("base64")}"`);
  });

  it("speaks MQTT 5 on connect", () => {
    const c = connectPacket({ clientId: "c", username: "u", password: "p" });
    expect(c[0]).toBe(0x10);
    expect(c.subarray(2, 8).toString("latin1")).toBe("\u0000\u0004MQTT");
    expect(c[8]).toBe(5);
  });
});

describe("Roborock's status and rooms", () => {
  it("reads the Qrevo's state, battery and tank alerts", () => {
    const rooms = namedRooms(segmentPairs(mappingFixture), { "11100001": "Kitchen" });
    const r = vacuumReading("abc", "Roborock Qrevo", statusFixture, rooms, true);
    expect(r).toMatchObject({ kind: "vacuum", state: "docked", battery: 100, place: "Hall", online: true });
    expect(r.alerts).toEqual(["dirty water tank full"]);
    expect(vacuumReading("abc", "Q", [{ state: 5, battery: 40, error_code: 9, water_shortage_status: 1 }], [], true)).toMatchObject({ state: "cleaning", alerts: ["bin missing", "clean water tank low"] });
    expect(vacuumReading("abc", "Q", null, [], false).state).toBe("offline");
  });

  it("pairs map segments with the app's room names", () => {
    const names = { "11100001": "Kitchen", "11100002": "Hall", "11100003": "Dining room", "11100004": "Studio" };
    const rooms = namedRooms(segmentPairs(mappingFixture), names);
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen", "Hall", "Dining room", "Studio", "Room 20"]);
    expect(segmentPairs([16, 11100001])).toEqual([[16, "11100001"]]);
    expect(segmentPairs("nope")).toEqual([]);
  });

  it("matches what was said to rooms, forgivingly but never between two", () => {
    const rooms = [
      { segment: 16, name: "Kitchen" },
      { segment: 17, name: "Hall" },
      { segment: 18, name: "Dining room" },
      { segment: 19, name: "Studio" },
      { segment: 21, name: "Bedroom 1" },
      { segment: 22, name: "Bedroom 2" },
    ];
    expect(matchRooms(["the kitchen"], rooms).rooms.map((r) => r.segment)).toEqual([16]);
    expect(matchRooms(["hallway and the dining room"], rooms).rooms.map((r) => r.segment)).toEqual([17, 18]);
    expect(matchRooms(["office"], rooms).rooms.map((r) => r.segment)).toEqual([19]);
    expect(matchRooms(["kitchens", "Kitchen"], rooms).rooms.map((r) => r.segment)).toEqual([16]);
    expect(matchRooms(["bedroom"], rooms)).toEqual({ rooms: [], unknown: ["bedroom"] });
    expect(matchRooms(["garage"], rooms).unknown).toEqual(["garage"]);
    expect(roomKey("The Living Room!")).toBe("living");
  });
});

describe("Roborock's client, end to end over a fake broker", () => {
  async function setup(answers: Record<string, unknown> = {}) {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    await vault.write("roborock", LOGIN);
    const broker = { last: null as FakeBroker | null, all: [] as FakeBroker[] };
    const f = roborockFetch();
    const client = new RoborockClient({
      fetch: f,
      vault,
      idKey: ID_KEY,
      now: () => NOW,
      open: () => {
        const b = new FakeBroker("abcdefghijklmnop", { get_status: statusFixture, get_room_mapping: mappingFixture, ...answers });
        broker.last = b;
        broker.all.push(b);
        return b;
      },
    });
    return { blob, vault, client, broker, f };
  }

  it("lists the vacuum (and skips other Roborock products) with its rooms", async () => {
    const { client, vault, broker } = await setup();
    const found = await client.status();
    expect(found).toHaveLength(1);
    expect(found[0]!.reading).toMatchObject({ id: deviceId(ID_KEY, "roborock", "TESTDUID000000000001"), model: "Roborock Qrevo", state: "docked", rooms: ["Kitchen", "Hall", "Dining room", "Studio", "Room 20"] });
    expect(broker.all.map((b) => b.sent[0]!.method)).toEqual(["get_status", "get_room_mapping"]);
    // The broker login is the derived one, never the token.
    const connect = broker.all[0]!.connects[0]!.toString("latin1");
    expect(connect).toContain(mqttParams(RRIOT).username);
    expect(connect).not.toContain("rr-test-token");
    // The home data and room map are kept sealed for next time.
    const kept = (await vault.read<RoborockLogin>("roborock"))!;
    expect(kept.home?.maps.TESTDUID000000000001).toHaveLength(5);
  });

  it("sends start, pause, dock and a named-room clean with the map's segments", async () => {
    const { client, broker } = await setup();
    const [found] = await client.status();
    for (const [action, method] of [["vacuum.start", "app_start"], ["vacuum.pause", "app_pause"], ["vacuum.dock", "app_charge"]] as const) {
      expect(await client.run(action, found!, {})).toEqual({ ok: true });
      expect(broker.last!.sent[0]!.method).toBe(method);
    }
    const r = await client.run("vacuum.rooms", found!, { rooms: ["kitchen and hall"] });
    expect(r).toEqual({ ok: true, say: "The vacuum is off to clean the kitchen and hall." });
    expect(broker.last!.sent[0]).toEqual({ method: "app_segment_clean", params: [{ segments: [16, 17], repeat: 1 }] });
    expect(await client.run("vacuum.rooms", found!, { rooms: ["garage"] })).toEqual({ ok: false, code: "unknown-room" });
  });

  it("says vendor when the broker refuses the login", async () => {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    await vault.write("roborock", LOGIN);
    const client = new RoborockClient({ fetch: roborockFetch(), vault, idKey: ID_KEY, now: () => NOW, open: () => new FakeBroker("abcdefghijklmnop", {}, true) });
    const found = await client.status();
    expect(found[0]!.reading.online).toBe(false);
  });

  it("connects with the emailed code: region, code, signed key and login", async () => {
    const f = fakeFetch([
      [/POST https:\/\/usiot\.roborock\.com\/api\/v1\/getUrlByEmail$/, () => ({ code: 200, data: { url: "https://usiot.roborock.test", country: "US", countrycode: "1" } })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v4\/email\/code\/send$/, () => ({ code: 200, msg: "success" })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v3\/key\/sign$/, () => ({ code: 200, data: { k: "signed-k" } })],
      [/GET https:\/\/usiot\.roborock\.test\/api\/v3\/app\/agreement\/latest$/, () => ({ code: 200, data: { majorVersion: 15, minorVersion: 2 } })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v4\/auth\/email\/login\/code$/, (_u, init) => (new URLSearchParams(String(init.body)).get("code") === "123456" ? { code: 200, data: { token: "rr-test-token", rriot: RRIOT } } : { code: 2018, msg: "invalid code" })],
    ]);
    const sent = await sendCode(f, "nikita.test@example.com", NOW);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.pending).toMatchObject({ baseUrl: "https://usiot.roborock.test", country: "US", countryCode: "1", until: NOW + 10 * 60_000 });
    expect(await loginWithCode(f, sent.pending, "000000")).toEqual({ ok: false, error: "bad-code" });
    const ok = await loginWithCode(f, sent.pending, "123456");
    expect(ok).toEqual({ ok: true, login: { email: "nikita.test@example.com", baseUrl: "https://usiot.roborock.test", clientId: sent.pending.clientId, token: "rr-test-token", rriot: RRIOT } });
    const login = f.calls.find((c) => c.url.endsWith("/login/code"))!;
    expect((login.init.headers as Record<string, string>)["x-mercy-k"]).toBe("signed-k");
    expect(new URLSearchParams(String(login.init.body)).get("majorVersion")).toBe("15");
  });
});

/* ── Whisker ── */

const POOL_NAME = "rjhNnZVAm";

/** A Cognito stand-in that holds the account's SRP digest and checks the SRP proof the way Cognito does. */
function fakeCognito(srpDigest: string) {
  const salt = "a1b2c3d4e5f60718";
  const userId = "user-id-for-srp-test";
  const b = 0x1234567890abcdef1234567890abcdefn;
  const x = BigInt(`0x${createHash("sha256").update(Buffer.from(padHex(BigInt(`0x${salt}`)) + srpDigest, "hex")).digest("hex")}`);
  const v = modPow(G, x, N);
  const B = (K * v + modPow(G, b, N)) % N;
  let A = 0n;
  const secretBlock = Buffer.from("secret-block-test").toString("base64");
  const idToken = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + 3600 })).toString("base64url")}.s`;
  return fakeFetch([
    [
      /POST https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/$/,
      (_u, init) => {
        const target = (init.headers as Record<string, string>)["X-Amz-Target"];
        const body = JSON.parse(String(init.body));
        if (target?.endsWith("InitiateAuth") && body.AuthFlow === "USER_SRP_AUTH") {
          A = BigInt(`0x${body.AuthParameters.SRP_A}`);
          return { ChallengeName: "PASSWORD_VERIFIER", ChallengeParameters: { SALT: salt, SRP_B: B.toString(16), SECRET_BLOCK: secretBlock, USER_ID_FOR_SRP: userId, USERNAME: userId } };
        }
        if (target?.endsWith("RespondToAuthChallenge")) {
          const u = BigInt(`0x${createHash("sha256").update(Buffer.from(padHex(A) + padHex(B), "hex")).digest("hex")}`);
          const S = modPow((A * modPow(v, u, N)) % N, b, N);
          const want = claimSignature(hkdf(padHex(S), padHex(u)), POOL_NAME, userId, secretBlock, body.ChallengeResponses.TIMESTAMP);
          if (body.ChallengeResponses.PASSWORD_CLAIM_SIGNATURE !== want) return jsonRes({ __type: "NotAuthorizedException" }, 400);
          return { AuthenticationResult: { IdToken: idToken, AccessToken: "access-test", RefreshToken: "refresh-test" } };
        }
        if (body.AuthFlow === "REFRESH_TOKEN_AUTH") return { AuthenticationResult: { IdToken: idToken, AccessToken: "access-2" } };
        return jsonRes({}, 400);
      },
    ],
  ]);
}

describe("Whisker's sign-in (Cognito SRP)", () => {
  it("agrees on the shared secret with a server that holds the verifier", () => {
    const a = 0xabcdef0123456789n;
    const A = modPow(G, a, N);
    const salt = "0f0e0d0c";
    const x = BigInt(`0x${createHash("sha256").update(Buffer.from(padHex(BigInt("0x0f0e0d0c")) + "cd".repeat(32), "hex")).digest("hex")}`);
    const v = modPow(G, x, N);
    const b = 0x55555555n;
    const B = (K * v + modPow(G, b, N)) % N;
    const { S, u } = clientSecret(a, A, B, salt, "cd".repeat(32));
    expect(S).toBe(modPow((A * modPow(v, u, N)) % N, b, N));
  });

  it("formats the timestamp as Cognito wants it", () => {
    expect(cognitoTimestamp(new Date("2026-11-04T08:05:09Z"))).toBe("Wed Nov 4 08:05:09 UTC 2026");
  });

  it("signs in with the right SRP digest and is refused with a wrong one", async () => {
    const pool = { poolId: `us-east-1_${POOL_NAME}`, clientId: "client-test" };
    const t = await srpSignIn(fakeCognito(SRP_TEST), pool, "nikita.test@example.com", SRP_TEST, NOW);
    expect(t).toMatchObject({ accessToken: "access-test", refreshToken: "refresh-test", expires: NOW + 3_600_000 });
    await expect(srpSignIn(fakeCognito(SRP_TEST), pool, "nikita.test@example.com", "ef".repeat(32), NOW)).rejects.toMatchObject({ status: 401 });
  });
});

describe("the Litter-Robot 5 Pro", () => {
  it("folds the robot's state the way pylitterbot does", () => {
    const at = (state: Record<string, unknown>) => litterState({ state: { isOnline: true, ...state } });
    expect(at({ state: "StRobotIdle" })).toBe("ready");
    expect(at({ state: "StRobotIdle", isDrawerFull: true })).toBe("drawer full");
    expect(at({ state: "StRobotCatDetectDelay" })).toBe("cat-inside");
    expect(at({ cycleState: "StPause", state: "StRobotClean" })).toBe("paused");
    expect(at({ displayCode: "DcModeCycle" })).toBe("cycling");
    expect(at({ statusIndicator: { type: "CAT_DETECTED" } })).toBe("cat-inside");
    expect(at({ status: "Ready" })).toBe("ready");
    expect(litterState({ state: { isOnline: false, state: "StRobotIdle" } })).toBe("offline");
  });

  it("reads the drawer, the litter, the last use and the model", () => {
    const r = litterReading("abc", robotsFixture[0], "2026-11-04T16:41:07.000Z");
    expect(r).toMatchObject({ model: "Litter-Robot 5 Pro", state: "ready", drawer: 42, litter: 87, lastUse: "2026-11-04T16:41:07.000Z", catInside: false, place: "Corridor", alerts: [] });
  });

  it("reads through the LR5 API with the sealed token, and starts a clean cycle", async () => {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    const tokens: CognitoTokens = { idToken: "whisker-id-token", accessToken: "a", refreshToken: "r", expires: NOW + 3_600_000 };
    await vault.write("whisker", tokens);
    const f = fakeFetch([
      [/GET https:\/\/ub\.prod\.iothings\.site\/robots$/, () => robotsFixture],
      [/GET https:\/\/ub\.prod\.iothings\.site\/robots\/LR5PTESTSERIAL0001\/activities$/, () => activitiesFixture],
      [/POST https:\/\/ub\.prod\.iothings\.site\/robots\/LR5PTESTSERIAL0001\/commands$/, () => ({})],
    ]);
    const c = new WhiskerClient({ fetch: f, vault, idKey: ID_KEY, email: "nikita.test@example.com", srpDigest: SRP_TEST, now: () => NOW });
    const [found] = await c.status();
    expect(found!.reading).toMatchObject({ id: deviceId(ID_KEY, "whisker", "LR5PTESTSERIAL0001"), lastUse: "2026-11-04T16:41:07.000Z" });
    expect(await c.run("litter.clean", found!)).toEqual({ ok: true });
    const cmd = f.calls.find((x) => x.init.method === "POST")!;
    expect(JSON.parse(String(cmd.init.body))).toEqual({ type: "CLEAN_CYCLE" });
    expect((cmd.init.headers as Record<string, string>).Authorization).toBe("Bearer whisker-id-token");
  });
});

/* ── Petlibro ── */

function petlibroFetch() {
  const real = petRealFixture as Record<string, unknown>;
  let logins = 0;
  const f = fakeFetch([
    [/POST https:\/\/api\.us\.petlibro\.com\/member\/auth\/login$/, (_u, init) => {
      logins++;
      const b = JSON.parse(String(init.body));
      return b.password === PL_TEST ? { code: 0, data: { token: `pl-token-${logins}` } } : { code: 1002, msg: "bad password" };
    }],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/device\/list$/, (_u, init) => ((init.headers as Record<string, string>).token === "stale" ? { code: 1009, msg: "NOT_YET_LOGIN" } : petListFixture)],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/device\/realInfo$/, (_u, init) => real[JSON.parse(String(init.body)).deviceSn]],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/workRecord\/list$/, () => petWorkFixture],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/wetFeedingPlan\/wetListV3$/, () => ({ code: 0, data: { templateName: "Test plan", plan: [] } })],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/device\/manualFeeding$/, () => ({ code: 0, data: 1 })],
    [/POST https:\/\/api\.us\.petlibro\.com\/device\/wetFeedingPlan\/manualFeedNow$/, () => ({ code: 0, data: null })],
  ]);
  return f;
}

describe("the Petlibro feeders and fountain", () => {
  it("tells the three apart by product name", () => {
    expect(petlibroKind("Granary Smart Feeder")).toBe("dry-feeder");
    expect(petlibroKind("Polar Wet Food Feeder")).toBe("wet-feeder");
    expect(petlibroKind("Dockstream Smart RFID Fountain")).toBe("fountain");
    expect(petlibroKind("Luma Smart Litter Box")).toBeNull();
  });

  it("signs in again when the token lapses, and reads all three", async () => {
    const blob = memoryBlob();
    const vault = new HomeVault(blob, SEAL);
    await vault.write("petlibro", { token: "stale" });
    const f = petlibroFetch();
    const c = new PetlibroClient({ fetch: f, vault, idKey: ID_KEY, email: "nikita.test@example.com", loginDigest: PL_TEST, now: () => NOW });
    const found = await c.status();
    expect(found.map((x) => x.reading.kind)).toEqual(["dry-feeder", "wet-feeder", "fountain"]);
    expect(found[0]!.reading).toMatchObject({ model: "Granary Smart Feeder", foodLow: false, lastFed: new Date(1762272000000).toISOString(), place: "Kitchen" });
    expect(found[1]!.reading).toMatchObject({ model: "Polar Wet Food Feeder", foodLow: true, state: "closed", alerts: ["food low"] });
    expect(found[2]!.reading).toMatchObject({ water: 64, filter: 40, state: "running" });
    expect((await vault.read<{ token: string }>("petlibro"))!.token).toBe("pl-token-1");
    // One portion from the dry feeder; the wet feeder opens on the bowl in front.
    expect(await c.run("feeder.feed", found[0]!)).toEqual({ ok: true });
    expect(JSON.parse(String(f.calls.at(-1)!.init.body))).toMatchObject({ deviceSn: "AF0400TESTDRY01", grainNum: 1 });
    expect(await c.run("wet.open", found[1]!)).toEqual({ ok: true });
    expect(JSON.parse(String(f.calls.at(-1)!.init.body))).toEqual({ deviceSn: "PLAF7TESTWET01", plate: 2 });
    expect(await c.run("feeder.feed", found[2]!)).toEqual({ ok: false, code: "unsupported" });
  });
});

/* ── The rails and the Council ── */

function reading(over: Partial<DeviceReading>): DeviceReading {
  return { id: "000000000001", vendor: "petlibro", kind: "dry-feeder", model: "Test", place: "Kitchen", online: true, state: "idle", alerts: [], ...over };
}

/** A client with fixed devices that records what it ran. */
function stubClient(vendor: "petlibro" | "whisker" | "roborock", readings: DeviceReading[], actions: DeviceClient["actions"], fail = false): DeviceClient & { ran: string[] } {
  const ran: string[] = [];
  return {
    vendor,
    actions,
    ran,
    connected: async () => true,
    status: async () => readings.map((r): Found => ({ reading: { ...r }, ref: { serial: `SERIAL-${r.id}` } })),
    run: async (action) => {
      ran.push(action);
      return fail ? { ok: false, code: "vendor" } : { ok: true };
    },
  };
}

function homeWith(clients: DeviceClient[], over: Partial<HomeDeps> = {}) {
  const blob = memoryBlob();
  const council = new MemoryRoomLog();
  const lines: string[] = [];
  const home = new Home({ blob, clients, feedCap: 2, council, log: (l) => lines.push(l), now: () => NOW, ...over });
  return { home, blob, council, lines };
}

describe("the safety rails", () => {
  it("reads the feed cap setting, 2 by default", () => {
    expect(feedCap(undefined)).toBe(2);
    expect(feedCap("")).toBe(2);
    expect(feedCap("3")).toBe(3);
    expect(feedCap("0")).toBe(0);
    expect(feedCap("99")).toBe(6);
    expect(feedCap("two")).toBe(2);
    expect(mountainDay(Date.parse("2026-11-05T05:00:00Z"))).toBe("2026-11-04");
  });

  it("allows two manual feeds a day per feeder, counted apart, and refuses the third", async () => {
    const dry = reading({ id: "00000000000d" });
    const wet = reading({ id: "00000000000e", kind: "wet-feeder", state: "closed" });
    const client = stubClient("petlibro", [dry, wet], ["feeder.feed", "wet.open"]);
    const { home, council } = homeWith([client]);
    expect(await home.act({ action: "feeder.feed", via: "desk" })).toEqual({ ok: true, say: "One portion is coming out of the dry food feeder. That's 1 of 2 today." });
    expect((await home.act({ action: "feeder.feed", via: "phone", said: "Feed the cat a portion" })).ok).toBe(true);
    const third = await home.act({ action: "feeder.feed", via: "desk" });
    expect(third).toMatchObject({ ok: false, code: "cap" });
    expect(third.say).toContain("No more until tomorrow");
    expect(client.ran).toEqual(["feeder.feed", "feeder.feed"]);
    // The wet feeder has its own two.
    expect((await home.act({ action: "wet.open", via: "desk" })).say).toBe("The wet food feeder's lid is open. That's 1 of 2 today.");
    // Every ask is in the Council, refused or not, the phone's in its own words.
    const turns = await council.list("kernel", NOW);
    expect(turns).toHaveLength(4);
    expect(turns.map((t) => t.question)).toContain("Feed the cat a portion");
    expect(turns.find((t) => t.question === "Feed the cat a portion")!.via).toBe("phone");
    expect(turns.every((t) => t.model === "home")).toBe(true);
    const view = await home.status(true);
    expect(view.devices.find((d) => d.kind === "dry-feeder")).toMatchObject({ manualToday: 2, manualCap: 2 });
  });

  it("gives the feed back when the vendor call fails", async () => {
    const client = stubClient("petlibro", [reading({})], ["feeder.feed"], true);
    const { home, blob } = homeWith([client]);
    expect(await home.act({ action: "feeder.feed", via: "desk" })).toMatchObject({ ok: false, code: "vendor" });
    expect(await new FeedLedger(blob).today(NOW)).toEqual({});
  });

  it("starts a litter cycle only when the robot is ready", async () => {
    const at = (over: Partial<DeviceReading>) => reading({ vendor: "whisker", kind: "litter", state: "ready", ...over });
    expect(litterBlock(at({}))).toBeNull();
    expect(litterBlock(at({ state: "cat-inside", catInside: true }))).toBe("cat");
    expect(litterBlock(at({ state: "cycling" }))).toBe("cycling");
    expect(litterBlock(at({ state: "drawer full" }))).toBe("drawer");
    expect(litterBlock(at({ online: false, state: "offline" }))).toBe("offline");
    const busy = stubClient("whisker", [at({ state: "cat-inside", catInside: true })], ["litter.clean"]);
    const { home } = homeWith([busy]);
    expect(await home.act({ action: "litter.clean", via: "desk" })).toEqual({ ok: false, code: "cat", say: "Not now: there's a cat in the Litter-Robot." });
    expect(busy.ran).toEqual([]);
    const ready = stubClient("whisker", [at({})], ["litter.clean"]);
    expect(await homeWith([ready]).home.act({ action: "litter.clean", via: "desk" })).toEqual({ ok: true, say: "The Litter-Robot is running a clean cycle." });
  });

  it("asks which rooms when none are named, and logs only the action and outcome", async () => {
    const vac = stubClient("roborock", [reading({ vendor: "roborock", kind: "vacuum", state: "docked", rooms: ["Kitchen"] })], ["vacuum.start", "vacuum.pause", "vacuum.dock", "vacuum.rooms"]);
    const { home, lines } = homeWith([vac]);
    expect(await home.act({ action: "vacuum.rooms", rooms: [], via: "desk" })).toMatchObject({ ok: false, code: "no-rooms" });
    expect(await home.act({ action: "vacuum.dock", via: "desk" })).toEqual({ ok: true, say: "The vacuum is heading back to its dock in the Hall." });
    expect(lines).toEqual(["home: vacuum.rooms refused (no-rooms)", "home: vacuum.dock done"]);
  });

  it("calls a vendor waiting until it is connected", async () => {
    const off: DeviceClient = { ...stubClient("whisker", [], ["litter.clean"]), connected: async () => false };
    const { home } = homeWith([off]);
    expect((await home.status()).vendors).toEqual({ roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" });
    expect(await home.act({ action: "litter.clean", via: "phone" })).toMatchObject({ ok: false, code: "not-connected" });
  });
});

/* ── The routes ── */

describe("the devices API", () => {
  async function routeDeps(over: Partial<DevicesDeps> = {}) {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const vault = new HomeVault(blob, SEAL);
    const lines: string[] = [];
    const petF = petlibroFetch();
    const pet = new PetlibroClient({ fetch: petF, vault, idKey: ID_KEY, email: "nikita.test@example.com", loginDigest: PL_TEST, now: () => NOW });
    const council = new MemoryRoomLog();
    const home = new Home({ blob, clients: [pet], feedCap: 2, council, log: (l) => lines.push(l), now: () => NOW });
    const deps: DevicesDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, pepper: async () => PEPPER, home: () => home, vault, fetch: petF, log: (l) => lines.push(l), ...over };
    const cookie = await signedInCookie(DESK, NOW, store);
    return { deps, cookie, lines, blob, council };
  }
  const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, ...headers } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

  it("answers 401 signed out, on every route", async () => {
    const { deps } = await routeDeps();
    expect((await devicesGet(get("/api/haven/devices"), deps)).status).toBe(401);
    expect((await devicesAction(post("/api/haven/devices/action", { action: "feeder.feed" }), deps)).status).toBe(401);
    expect((await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "disconnect" }), deps)).status).toBe(401);
    expect((await devicesGet(get("/api/haven/devices", { Authorization: "Bearer skp_notarealkeynotarealkeynotarealkeynotareal1" }), deps)).status).toBe(401);
  });

  it("gives a signed-in Desk the readings and runs an action", async () => {
    const { deps, cookie } = await routeDeps();
    const res = await devicesGet(get("/api/haven/devices", { Cookie: cookie }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const view = (await res.json()) as { devices: DeviceReading[]; vendors: Record<string, string>; roborockConnected: boolean };
    expect(view.vendors.petlibro).toBe("live");
    expect(view.roborockConnected).toBe(false);
    const act = await devicesAction(post("/api/haven/devices/action", { action: "feeder.feed", device: view.devices[0]!.id }, { Cookie: cookie }), deps);
    expect(act.status).toBe(200);
    expect(((await act.json()) as { say: string }).say).toContain("dry food feeder");
  });

  it("takes a phone key for reads and actions, but never for Connect Roborock", async () => {
    const { deps, blob } = await routeDeps();
    const made = (await new PhoneKeys(blob, PEPPER).add("Nikita's iPhone", NOW))!;
    const auth = { Authorization: `Bearer ${made.key}` };
    expect((await devicesGet(get("/api/haven/devices", auth), deps)).status).toBe(200);
    const act = await devicesAction(post("/api/haven/devices/action", { action: "wet.open" }, auth), deps);
    expect(act.status).toBe(200);
    expect((await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "disconnect" }, auth), deps)).status).toBe(401);
    // The shortcut's own header (#633): the Static Web App replaces Authorization on its way in.
    const own = { "x-ceo-phone-key": made.key };
    expect((await devicesGet(get("/api/haven/devices", own), deps)).status).toBe(200);
    expect((await devicesAction(post("/api/haven/devices/action", { action: "vacuum.dock" }, own), deps)).status).not.toBe(401);
    expect((await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "disconnect" }, own), deps)).status).toBe(401);
    expect((await devicesGet(get("/api/haven/devices", { "x-ceo-phone-key": "skp_notarealkeynotarealkeynotarealkeynotareal1" }), deps)).status).toBe(401);
  });

  it("refuses past the cap with 409 and a spoken reason", async () => {
    const { deps, cookie } = await routeDeps();
    for (let i = 0; i < 2; i++) expect((await devicesAction(post("/api/haven/devices/action", { action: "feeder.feed" }, { Cookie: cookie }), deps)).status).toBe(200);
    const third = await devicesAction(post("/api/haven/devices/action", { action: "feeder.feed" }, { Cookie: cookie }), deps);
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ ok: false, code: "cap" });
  });

  it("shows the public kinds and states only", async () => {
    const { deps } = await routeDeps();
    const res = await devicesGet(get("/api/haven/devices?view=status"), deps);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ready: true, links: { tasks: "waiting", kroger: "waiting" }, vendors: { roborock: "waiting", petlibro: "live", whisker: "waiting", nest: "waiting" }, devices: [{ kind: "dry-feeder", state: "idle", online: true }, { kind: "wet-feeder", state: "closed", online: true }, { kind: "fountain", state: "running", online: true }] });
    for (const leak of ["Granary", "Kitchen", "model", "place", '"id"', ...SERIALS]) expect(body).not.toContain(leak);
  });

  it("connects Roborock with the code and keeps the login sealed", async () => {
    const f = fakeFetch([
      [/POST https:\/\/usiot\.roborock\.com\/api\/v1\/getUrlByEmail$/, () => ({ code: 200, data: { url: "https://usiot.roborock.test", country: "US", countrycode: "1" } })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v4\/email\/code\/send$/, () => ({ code: 200 })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v3\/key\/sign$/, () => ({ code: 200, data: { k: "signed-k" } })],
      [/GET https:\/\/usiot\.roborock\.test\/api\/v3\/app\/agreement\/latest$/, () => ({ code: 500 })],
      [/POST https:\/\/usiot\.roborock\.test\/api\/v4\/auth\/email\/login\/code$/, () => ({ code: 200, data: { token: "rr-test-token", rriot: RRIOT } })],
    ]);
    const { deps, cookie, blob, lines } = await routeDeps({ fetch: f });
    const send = await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "send", email: "nikita.test@example.com" }, { Cookie: cookie }), deps);
    expect(await send.json()).toEqual({ ok: true, step: "code" });
    const code = await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "code", code: "123456" }, { Cookie: cookie }), deps);
    expect(await code.json()).toEqual({ ok: true, connected: true });
    const sealed = new TextDecoder().decode(blob.files.get(vaultPath("roborock"))!);
    for (const s of ["rr-test-token", "test-rriot-h", "nikita.test@example.com"]) expect(sealed).not.toContain(s);
    expect(blob.files.has(vaultPath("roborock-pending"))).toBe(false);
    expect(lines).toEqual(["home: roborock code sent", "home: roborock connected"]);
    // A code with no request in progress has run out.
    expect((await devicesConnect(post("/api/haven/devices/connect", { vendor: "roborock", step: "code", code: "123456" }, { Cookie: cookie }), deps)).status).toBe(409);
  });

  it("never lets a serial, an email, a token or a password into an answer, a log line or the Council", async () => {
    const { deps, cookie, lines, council } = await routeDeps();
    const bodies: string[] = [];
    bodies.push(await (await devicesGet(get("/api/haven/devices", { Cookie: cookie }), deps)).text());
    for (const action of ["feeder.feed", "wet.open", "feeder.feed", "feeder.feed", "litter.clean"]) bodies.push(await (await devicesAction(post("/api/haven/devices/action", { action }, { Cookie: cookie }), deps)).text());
    const turns = JSON.stringify(await council.list("kernel", NOW));
    const everything = [...bodies, ...lines, turns].join("\n");
    for (const s of [...SERIALS, ...SECRETS]) expect(everything, s).not.toContain(s);
  });
});

/* ── Hey Skippy's words, and the gate ── */

describe("home-device captures", () => {
  it("sorts the device asks before the to-dos", () => {
    expect(classify("Vacuum, go clean the kitchen")).toEqual({ kind: "device", action: "vacuum.rooms", rooms: ["kitchen"] });
    expect(classify("Clean the hall and the dining room")).toEqual({ kind: "device", action: "vacuum.rooms", rooms: ["hall", "dining room"] });
    expect(classify("clean the house")).toEqual({ kind: "device", action: "vacuum.start" });
    expect(classify("start the vacuum")).toEqual({ kind: "device", action: "vacuum.start" });
    expect(classify("pause the vacuum")).toEqual({ kind: "device", action: "vacuum.pause" });
    expect(classify("send the vacuum home")).toEqual({ kind: "device", action: "vacuum.dock" });
    expect(classify("Feed the cat a portion")).toEqual({ kind: "device", action: "feeder.feed" });
    expect(classify("feed the cat")).toEqual({ kind: "device", action: "feeder.feed" });
    expect(classify("give the cat wet food")).toEqual({ kind: "device", action: "wet.open" });
    expect(classify("Run a litter clean cycle")).toEqual({ kind: "device", action: "litter.clean" });
    expect(classify("clean the litter box")).toEqual({ kind: "device", action: "litter.clean" });
    // Still to-dos and shopping.
    expect(classify("remind me to clean the kitchen").kind).toBe("todo");
    expect(classify("clean the garage").kind).toBe("todo");
    expect(classify("we need cat food").kind).toBe("shopping");
  });
});

describe("the gate and the home devices", () => {
  const ctx: GateContext = { state: { on: true, v: 1, sv: 1 } as unknown as GateContext["state"], keys: null, env: { FOUNDRY_DESK_KEY: DESK }, now: NOW };
  const key = `skp_${"a".repeat(43)}`;
  it("lets a phone-key bearer through to the devices' read and action, nothing more", () => {
    const req = (method: string, path: string) => new Request(`${ORIGIN}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
    expect(decide(req("GET", "/api/haven/devices"), ctx)).toMatchObject({ allow: true, why: "phone-key" });
    expect(decide(req("POST", "/api/haven/devices/action"), ctx)).toMatchObject({ allow: true, why: "phone-key" });
    expect(decide(req("POST", "/api/haven/devices/connect"), ctx).allow).toBe(false);
    expect(decide(req("GET", "/api/haven/devices?view=status"), ctx).allow).toBe(false);
    expect(decide(req("POST", "/api/haven"), ctx).allow).toBe(false);
  });

  it("takes the phone key in its own header too (#633)", () => {
    const req = (method: string, path: string) => new Request(`${ORIGIN}${path}`, { method, headers: { "x-ceo-phone-key": key } });
    expect(decide(req("GET", "/api/haven/devices"), ctx)).toMatchObject({ allow: true, why: "phone-key" });
    expect(decide(req("POST", "/api/haven/devices/action"), ctx)).toMatchObject({ allow: true, why: "phone-key" });
    expect(decide(req("POST", "/api/haven/devices/connect"), ctx).allow).toBe(false);
  });
});
