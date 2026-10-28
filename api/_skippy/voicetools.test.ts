import { describe, expect, it } from "vitest";
import { decide, type GateContext } from "../_site/gate.ts";
import { siteKeys, stateOf } from "../_site/state.ts";
import type { GreenBoard, GreenPlayer } from "../_green/types.ts";
import type { PmBoard, PmPositions } from "../_exchange/types.ts";
import { readEmailStatus, type EmailStatus } from "../_email/status.ts";
import { MemoryRoomLog, keepTurns } from "./log.ts";
import { roomLog } from "../skippy.ts";
import { handle, readText, type RoomSources } from "./toolroute.ts";
import { exchangesOf } from "./voicecouncil.ts";
import { KERNEL_TOOLS, ON_AIR, SKIPPY_CREW_PROMPT, TEXT_TOOLS, TOOL_DEFS, clientToolConfig, ensureCrew, skippyToolIds, skippyTransfers, submindBody, toolConfig } from "./voicecrew.ts";
import { READS, billText, boilerText, exchangeText, greenText, positionsText, relayText } from "./voicereads.ts";
import { MAX_HANDOFFS, MemoryCrewStore, TOOL_HEADER, TOOL_VAR, callHandoffs, checkToolToken, endToolToken, issueToolToken, mintToolToken, signedUntil, toolTokenSigned } from "./voicetoken.ts";

const NOW = Date.parse("2026-10-27T06:00:00Z");
const DESK = "a test desk key, not a real one";
const UNTIL = NOW + 12 * 60_000;
const SITE = "https://ceo.test";

const player = (name: string, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id: name, name, pos: "WR", team: "TB", inj: null, proj: 9, src: "fp", avg: 8, last: 7, wk: 20, ecr: 40, posRank: "WR20", bye: 9, fp: 9, sl: 8.4, ...over });

const GREEN = {
  ok: true,
  at: "2026-10-27T05:59:00.000Z",
  season: "2026",
  week: 8,
  league: { id: "1", name: "Dynasty of Ilyr", teams: 12, scoring: "half PPR", faab: 100 },
  me: { rosterId: 1, team: "Rocky's Welders", record: "5-2", rank: 2, pf: 800, pa: 700, benchLeft: 30, faabLeft: 41, streak: "W3" },
  roster: { starters: [{ slot: "FLEX", player: player("Tre Tucker"), pts: 0 }], bench: [player("Chris Godwin")], reserve: [] },
  matchup: { week: 8, me: { rosterId: 1, team: "Rocky's Welders", record: "5-2", pts: 0, proj: 112, starters: [] }, them: { rosterId: 2, team: "Grace Sends $20 to grace@example.com", record: "4-3", pts: 0, proj: 104, starters: [] }, win: 0.62, live: false },
  swaps: [],
  pickups: [],
  standings: [],
  dropping: [],
  byes: ["KC"],
  sources: { sleeper: "live", fantasypros: "live", fpAt: null, calls: "fp", fpParts: null },
  calls: [{ slot: "FLEX", start: player("Tre Tucker"), sit: player("Chris Godwin", { fp: 8.4 }), change: true, edge: 0.6, slEdge: -0.7, sleeper: "disagrees", split: true, tiebreak: "the underdog takes the ceiling", why: "x" }],
} as unknown as GreenBoard;

const BOARD: PmBoard = {
  ok: true,
  at: "2026-10-27T05:59:00.000Z",
  top: [{ id: "1", question: "Will the $5,000,000 prize see https://evil.example/x claimed?", outcome: "Yes", prob: 0.34, change24h: 0.04, volume24h: 123456, volume: 9999999, endDate: null, url: null, closed: false, spark: [] }],
  watch: [],
  world: [],
  watchlist: [],
  canPin: true,
};

const POSITIONS: PmPositions = {
  ok: true,
  state: "live",
  at: "2026-10-27T05:59:00.000Z",
  positions: [{ market: "Brewers win the pennant", outcome: "Yes", url: null, short: false, contracts: 40, avgPrice: 0.31, value: 18.4, cost: 12.4, pnl: 6, pnlPct: 48.4, realized: 0, expired: false }],
  activity: [],
  totals: { open: 1, value: 18.4, cost: 12.4, pnl: 6 },
  more: false,
};

const EMAIL = readEmailStatus({ v: 1, at: NOW, gmail: "connected", agent: "listening", needsYou: 3, fyi: 5, noise: 12, newToday: 20, unsorted: 0, skipped: 1, budgetPct: 14, lastCheck: NOW - 60_000 })!;

const sources = (over: Partial<RoomSources> = {}): RoomSources => ({
  green: async () => GREEN,
  exchange: async () => BOARD,
  positions: async () => POSITIONS,
  email: async () => EMAIL,
  foundryBoard: async () => "Builds in flight: 1\n  - #479 Talk: live room lookups (in progress)",
  jobs: async () => ({ jobs: [{ name: "Checks", status: "completed", conclusion: "failure", created_at: "2026-10-27T05:00:00Z", run_started_at: "2026-10-27T05:00:00Z", html_url: "https://github.com/x" }], open: [{ number: 481, html_url: "https://github.com/x", created_at: "2026-10-27T05:00:00Z", draft: false, issue: 479, checks: "running" }] }),
  world: async () => null,
  bill: async () => ({ credits: { used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" } }),
  ...over,
});

const toolReq = (read: string, token?: string | null, method = "GET") => new Request(`${SITE}/api/skippy-tools?read=${read}`, { method, headers: token ? { [TOOL_HEADER]: token } : {} });

describe("the call's tool token (#479)", () => {
  it("is signed by the Desk key, carries its expiry and is refused once tampered with", () => {
    const t = mintToolToken(DESK, UNTIL)!;
    expect(t).toMatch(/^vt1\.[0-9a-z]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(signedUntil(t, DESK)).toBe(UNTIL);
    expect(signedUntil(t, "another desk key entirely")).toBeNull();
    const [v, exp, nonce, mac] = t.split(".");
    expect(signedUntil(`${v}.${(UNTIL + 3_600_000).toString(36)}.${nonce}.${mac}`, DESK)).toBeNull();
    expect(signedUntil(`${v}.${exp}.${nonce}.${"A".repeat(mac!.length)}`, DESK)).toBeNull();
    expect(toolTokenSigned(t, DESK, NOW)).toBe(true);
    expect(toolTokenSigned(t, DESK, UNTIL + 1)).toBe(false);
    expect(mintToolToken("short", UNTIL)).toBeNull();
    expect(mintToolToken(DESK, UNTIL)).not.toBe(t);
  });

  it("answers only a kept, live, unexpired token: missing, wrong, unknown, expired and ended are refused", async () => {
    const store = new MemoryCrewStore();
    const t = (await issueToolToken(store, DESK, "conv_live_123", UNTIL, NOW))!;
    expect(JSON.stringify(store.state)).not.toContain(t);
    expect(await checkToolToken(t, DESK, store, NOW)).toMatchObject({ ok: true, conversation: "conv_live_123", handoffs: [] });
    expect(await checkToolToken(null, DESK, store, NOW)).toEqual({ ok: false, why: "missing" });
    expect(await checkToolToken("", DESK, store, NOW)).toEqual({ ok: false, why: "missing" });
    expect(await checkToolToken("vt1.abc.def.ghi", DESK, store, NOW)).toEqual({ ok: false, why: "bad" });
    expect(await checkToolToken(mintToolToken(DESK, UNTIL), DESK, store, NOW)).toEqual({ ok: false, why: "unknown" });
    expect(await checkToolToken(t, DESK, store, UNTIL + 1)).toEqual({ ok: false, why: "expired" });
    expect(await checkToolToken(t, DESK, null, NOW)).toEqual({ ok: false, why: "store" });
    await endToolToken(store, "conv_live_123", NOW);
    expect(await checkToolToken(t, DESK, store, NOW)).toEqual({ ok: false, why: "ended" });
  });

  it("drops expired tokens from the store on the next write", async () => {
    const store = new MemoryCrewStore();
    await issueToolToken(store, DESK, "conv_old_1234", NOW + 1000, NOW);
    await issueToolToken(store, DESK, "conv_new_1234", UNTIL + 60_000, NOW + 5000);
    expect((await store.load(NOW + 5000)).tokens.map((x) => x.conversation)).toEqual(["conv_new_1234"]);
  });
});

describe("the lookups' route", () => {
  const deps = async () => {
    const crew = new MemoryCrewStore();
    const token = (await issueToolToken(crew, DESK, "conv_live_123", UNTIL, NOW))!;
    return { token, deps: { deskKey: DESK, crew, sources: sources(), now: NOW } };
  };

  it("refuses without a live token, with one 401 for every reason", async () => {
    const { token, deps: d } = await deps();
    for (const bad of [null, "nonsense", mintToolToken(DESK, UNTIL)!, mintToolToken("another desk key entirely", UNTIL)!]) {
      const res = await handle(toolReq("green", bad), d);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "not-allowed" });
    }
    expect((await handle(toolReq("green", token), { ...d, now: UNTIL + 1 })).status).toBe(401);
    expect((await handle(toolReq("green", token, "PUT"), d)).status).toBe(405);
    expect((await handle(toolReq("green", token, "POST"), d)).status).toBe(400);
  });

  it("answers a live token with the room, never cached", async () => {
    const { token, deps: d } = await deps();
    const res = await handle(toolReq("green", token), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { read: string; text: string };
    expect(body.read).toBe("green");
    expect(body.text).toContain("win chance 62 percent");
    expect(body.text).toContain("split decision");
  });

  it("answers 'slow' inside ElevenLabs' five seconds when a room drags", async () => {
    const { token, deps: d } = await deps();
    const res = await handle(toolReq("green", token), { ...d, budgetMs: 20, sources: sources({ green: () => new Promise(() => undefined) }) });
    expect(await res.json()).toMatchObject({ read: "green", slow: true });
  });

  it("takes exactly one known read and nothing else", async () => {
    const { token, deps: d } = await deps();
    expect((await handle(toolReq("spire", token), d)).status).toBe(400);
    expect((await handle(new Request(`${SITE}/api/skippy-tools?read=green&read=relay`, { headers: { [TOOL_HEADER]: token } }), d)).status).toBe(400);
    expect((await handle(new Request(`${SITE}/api/skippy-tools?read=green&x=1`, { headers: { [TOOL_HEADER]: token } }), d)).status).toBe(400);
  });

  it("the site gate lets a signed, unexpired token through on exactly GET or POST /api/skippy-tools", async () => {
    const env = { FOUNDRY_DESK_KEY: DESK };
    const ctx: GateContext = { state: stateOf({ v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "v" }, {}), keys: (await siteKeys(env))!, env, now: NOW };
    const t = mintToolToken(DESK, UNTIL)!;
    expect(decide(toolReq("green", t), ctx)).toEqual({ allow: true, why: "voice-tool" });
    expect(decide(toolReq("green", t), { ...ctx, now: UNTIL + 1 }).allow).toBe(false);
    expect(decide(toolReq("green", mintToolToken("another desk key entirely", UNTIL)), ctx).allow).toBe(false);
    expect(decide(toolReq("green", t, "POST"), ctx)).toEqual({ allow: true, why: "voice-tool" });
    expect(decide(toolReq("green", t, "PUT"), ctx).allow).toBe(false);
    expect(decide(new Request(`${SITE}/api/exchange-positions`, { headers: { [TOOL_HEADER]: t } }), ctx).allow).toBe(false);
    expect(decide(new Request(`${SITE}/api/skippy-voice`, { headers: { [TOOL_HEADER]: t } }), ctx).allow).toBe(false);
  });
});

describe("the Kernel from the call (#480)", () => {
  const setup = async () => {
    const crew = new MemoryCrewStore();
    const log = new MemoryRoomLog();
    const token = (await issueToolToken(crew, DESK, "conv_live_123", UNTIL, NOW))!;
    const post = (ask: unknown) => new Request(`${SITE}/api/skippy-tools?act=kernel`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ ask }) });
    return { crew, log, token, post, deps: { deskKey: DESK, crew, log, sources: sources(), now: NOW } };
  };

  it("hand_to_kernel files the ask for Skippy's thread, as the typed chat does, and check_answers reads it back", async () => {
    const { crew, log, token, post, deps: d } = await setup();
    const res = await handle(post("Start a build that adds a waiver alarm to the Green"), d);
    const body = (await res.json()) as { ok: boolean; turn: string };
    expect(body.ok).toBe(true);
    const [turn] = await log.list("kernel", NOW, "skippy");
    expect(turn).toMatchObject({ id: body.turn, room: "kernel", needs: "skippy", question: "Start a build that adds a waiver alarm to the Green" });
    expect(await callHandoffs(crew, "conv_live_123", NOW)).toEqual([body.turn]);
    const read = async () => ((await (await handle(toolReq("answers", token), d)).json()) as { text: string }).text;
    expect(await read()).toMatch(/no answer yet/);
    await log.answer(body.turn, { from: "skippy", text: "On it: number 485 is open.", at: new Date(NOW).toISOString(), final: false }, NOW);
    expect(await read()).toMatch(/so far: On it: number 485 is open\./);
    await log.answer(body.turn, { from: "skippy", text: "Shipped in number 485.", at: new Date(NOW).toISOString() }, NOW);
    expect(await read()).toMatch(/answered: Shipped in number 485\./);
  });

  it("never hands on a private-looking ask, and stops at the call's share", async () => {
    const { log, post, deps: d } = await setup();
    const held = (await (await handle(post("Email sam@example.com about lunch"), d)).json()) as { ok: boolean };
    expect(held.ok).toBe(false);
    expect(await log.list("kernel", NOW)).toEqual([]);
    for (let i = 0; i < MAX_HANDOFFS; i++) expect(((await (await handle(post(`Ask number ${i}`), { ...d, now: NOW + i })).json()) as { ok: boolean }).ok).toBe(true);
    expect(((await (await handle(post("one too many"), { ...d, now: NOW + 99 })).json()) as { ok: boolean }).ok).toBe(false);
    expect((await handle(post(""), d)).status).toBe(400);
  });

  it("the kernel tool posts a body the LLM fills; the Kernel's tools come on top of each submind's room tools (#491)", () => {
    const c = toolConfig(TOOL_DEFS.find((t) => t.name === "hand_to_kernel")!, SITE);
    expect(c.api_schema).toMatchObject({ method: "POST", query_params_schema: { properties: { act: { constant_value: "kernel" } } }, request_body_schema: { required: ["ask"] } });
    for (const s of ON_AIR) for (const k of KERNEL_TOOLS) expect(s.tools).not.toContain(k);
  });
});

describe("what each lookup says", () => {
  const all = async () => Object.fromEntries(await Promise.all(READS.map(async (r) => [r, await readText(r, sources(), NOW)] as const)));

  it("keeps money to the two private reads, and scrubs every outside string", async () => {
    const texts = await all();
    for (const r of READS) {
      if (r === "exchange_positions") expect(texts[r]).toMatch(/\$\d/);
      else expect(texts[r], r).not.toMatch(/\$\s?\d/);
      expect(texts[r], r).not.toMatch(/https?:\/\/|@example\.com/);
    }
    expect(texts.exchange).toContain("[amount]");
    expect(texts.exchange).toContain("34 percent, up 4 points today");
    expect(texts.exchange_positions).toContain("worth $18.40");
    expect(texts.voice_bill).toContain("21,743 credits left of 122,113");
    expect(texts.voice_bill).not.toMatch(/cap|share/);
    expect(texts.green).toContain("[private]");
  });

  it("Relay says counts only, whatever else rides on the status", async () => {
    const sneaky = { ...EMAIL, subject: "Lunch with Sam Reyes", from: "sam@example.com", items: [{ text: "the secret message body" }] } as unknown as EmailStatus;
    // The checked status refuses anything but its own fields; and even unchecked, only the counts are read.
    expect(readEmailStatus(sneaky)).toBeNull();
    const text = relayText(sneaky);
    expect(text).toContain("3 mails waiting on the C.E.O., 5 FYI, 12 noise today, 20 new today");
    for (const leak of ["Lunch", "Sam", "example", "secret message"]) expect(text).not.toContain(leak);
    expect(relayText(null)).toMatch(/isn't answering/);
  });

  it("the Boiler Room puts what needs a look first", () => {
    const text = boilerText({ jobs: [{ name: "Checks", status: "completed", conclusion: "failure", created_at: "2026-10-27T05:00:00Z", run_started_at: "2026-10-27T05:00:00Z", html_url: "x" }], open: [], world: { step: 40, at: "2026-10-27T05:35:00Z" }, email: EMAIL, green: GREEN, exchange: BOARD, now: NOW });
    expect(text.split("\n")[0]).toBe("Boiler Room: 1 thing to look at, 5 healthy.");
    expect(text).toContain("Needs a look: Checks red (failure), 60 minutes ago.");
  });

  it("says plainly when a room doesn't answer", async () => {
    expect(greenText(null)).toMatch(/isn't answering/);
    expect(exchangeText(null)).toMatch(/isn't answering/);
    expect(positionsText({ ok: true, state: "waiting", reason: "no-key" })).toMatch(/isn't connected/);
    expect(await readText("green", sources({ green: () => Promise.reject(new Error("down")) }), NOW)).toMatch(/isn't answering/);
    expect(billText({ credits: null })).toMatch(/isn't telling me/);
  });
});

describe("the crew on ElevenLabs", () => {
  it("each room tool is a GET to the site with a constant read and the token from the secret variable", () => {
    for (const def of TOOL_DEFS.filter((d) => d.read !== "kernel" && d.read !== "web" && d.read !== "player_news" && d.read !== "sports")) {
      const c = toolConfig(def, SITE);
      expect(c.type).toBe("webhook");
      expect(c.pre_tool_speech).toBe("off");
      expect(c.response_timeout_secs).toBe(5);
      expect(c.api_schema.url).toBe(`${SITE}/api/skippy-tools`);
      expect(c.api_schema.method).toBe("GET");
      expect(c.api_schema.query_params_schema.properties).toEqual({ read: { type: "string", constant_value: def.read } });
      expect(c.api_schema.request_headers).toEqual({ [TOOL_HEADER]: { variable_name: TOOL_VAR } });
      expect(TOOL_VAR.startsWith("secret__")).toBe(true);
    }
  });

  it("each submind keeps Skippy's voice, the call's limits, its own room's tools and a way back", () => {
    const limits = { sessionSecs: 600, silenceSecs: 20, llm: "claude-sonnet-5-5" };
    for (const s of ON_AIR) {
      const b = submindBody(s, "voice123", "agent_skippy", ["tool_1"], limits);
      expect(b.conversation_config.tts.voice_id).toBe("voice123");
      expect(b.conversation_config.conversation.max_duration_seconds).toBe(600);
      expect(b.platform_settings.auth.enable_auth).toBe(true);
      expect(b.conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers[0]!.agent_id).toBe("agent_skippy");
      expect(b.conversation_config.agent.prompt.prompt).toContain(s.name);
    }
    expect(ON_AIR.find((s) => s.id === "static")!.tools).toEqual(["read_relay"]);
    expect(ON_AIR.find((s) => s.id === "ticker")!.tools).toContain("read_exchange_positions");
    expect(ON_AIR.filter((s) => s.tools.includes("read_exchange_positions")).map((s) => s.id)).toEqual(["ticker"]);
  });

  it("Skippy hands over only for an in-depth, room-specific ask (Nikita's rule)", () => {
    expect(SKIPPY_CREW_PROMPT).toMatch(/answer basic questions yourself/);
    const t = skippyTransfers({ turf: { id: "agent_turf_1", sig: "0".repeat(16) } })!;
    expect(t.transfer_to_agent.params.transfers).toHaveLength(1);
    for (const s of ON_AIR) expect(s.takes).toMatch(/in-depth/);
    expect(t.transfer_to_agent.params.transfers[0]!.condition).toMatch(/basic question .* stays with Skippy/);
    expect(skippyTransfers({})).toBeNull();
  });

  it("is made once, then left alone until the code changes; a refusal leaves that piece out", async () => {
    const calls: string[] = [];
    let n = 0;
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace("https://api.elevenlabs.io", "")}`);
      if (String(init?.body).includes("The Pessimist")) return new Response("{}", { status: 403 });
      const body = url.includes("/tools") ? { id: `tool_${++n}xx` } : { agent_id: `agent_${++n}xx` };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const d = { key: "k", voice: "v", site: SITE, skippy: "agent_skippy", limits: { sessionSecs: 600, silenceSecs: 20, llm: "claude-sonnet-5-5" }, fetcher, log: () => undefined };
    const first = await ensureCrew(d, { tools: {}, agents: {} });
    expect(Object.keys(first.tools)).toHaveLength(TOOL_DEFS.length + TEXT_TOOLS.length);
    expect(Object.keys(first.agents).sort()).toEqual(["ember", "static", "ticker", "turf"]);
    const made = calls.length;
    const again = await ensureCrew(d, first);
    expect(calls.length).toBe(made + 2); // only the Pessimist is tried again (full, then core), once a call
    expect(again.agents).toEqual(first.agents);
    calls.length = 0;
    await ensureCrew({ ...d, voice: "new-voice" }, first);
    expect(calls.filter((c) => c.startsWith("PATCH /v1/convai/agents/"))).toHaveLength(4);
  });
});

describe("texting on the call (#536)", () => {
  it("runs in the browser: client tools, with a minute to answer, that only Skippy carries", () => {
    for (const def of TEXT_TOOLS) {
      const c = clientToolConfig(def);
      expect(c.type).toBe("client");
      expect(c.expects_response).toBe(true);
      expect(c.response_timeout_secs).toBeLessThanOrEqual(60);
      expect(JSON.stringify(c)).not.toMatch(/https?:|api_schema|request_headers/);
    }
    expect(TEXT_TOOLS.map((t) => t.name).sort()).toEqual(["cancel_text", "draft_text", "edit_text", "pick_contact", "send_text"]);
    const tools = Object.fromEntries([...TOOL_DEFS, ...TEXT_TOOLS].map((t, i) => [t.name, { id: `tool_${i}xxxx`, sig: "s" }]));
    const ids = skippyToolIds(tools);
    for (const t of TEXT_TOOLS) expect(ids).toContain(tools[t.name]!.id);
    for (const s of ON_AIR) {
      const body = JSON.stringify(submindBody(s, "v", "agent_skippy", s.tools.map((n) => tools[n]?.id ?? ""), { sessionSecs: 600, silenceSecs: 20, llm: "x" }));
      for (const t of TEXT_TOOLS) expect(body).not.toContain(tools[t.name]!.id);
    }
  });

  it("tells Skippy to read the recipient and the text aloud and send only on Nikita's word", () => {
    expect(SKIPPY_CREW_PROMPT).toMatch(/draft_text/);
    expect(SKIPPY_CREW_PROMPT).toMatch(/word for word/);
    expect(SKIPPY_CREW_PROMPT).toMatch(/Send only when he answers "send"/);
    expect(SKIPPY_CREW_PROMPT).toMatch(/edit_text[^.]*ask again/);
  });
});

describe("the Council's record of a call", () => {
  const agents = { turf: { id: "agent_turf_1", sig: "0".repeat(16) }, ticker: { id: "agent_tick_1", sig: "0".repeat(16) } };
  const conv = {
    status: "done",
    metadata: { start_time_unix_secs: NOW / 1000 },
    transcript: [
      { role: "agent", message: "Ah, the C.E.O. calls.", agent_metadata: { agent_id: "agent_skippy" }, time_in_call_secs: 0 },
      { role: "user", message: "Give me the play-by-play on Tucker versus Godwin.", time_in_call_secs: 4 },
      { role: "agent", message: "Hold on, monkey.", agent_metadata: { agent_id: "agent_skippy" }, time_in_call_secs: 6 },
      { role: "agent", message: "THE COMMENTATOR, live from the booth! TUCKER over Godwin, folks. Under a point on FantasyPros. SPLIT DECISION.", agent_metadata: { agent_id: "agent_turf_1" }, time_in_call_secs: 8 },
      { role: "user", message: "Why?", time_in_call_secs: 20 },
      { role: "agent", message: "The underdog takes the ceiling!", agent_metadata: { agent_id: "agent_turf_1" }, time_in_call_secs: 22 },
      { role: "user", message: "Thanks. Now my book, in detail, call me at 303-555-0123.", time_in_call_secs: 30 },
      { role: "agent", message: "Back to the boss.", agent_metadata: { agent_id: "agent_skippy" }, time_in_call_secs: 31 },
      { role: "agent", message: "The Bookie. Your book is worth $18.40, up $6. Sixty percent sure that holds.", agent_metadata: { agent_id: "agent_tick_1" }, time_in_call_secs: 34 },
    ],
  };

  it("keeps who took the mic, the question in short and the gist, scrubbed, private parts held back", () => {
    const turns = exchangesOf(conv, agents, NOW);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ room: "green", by: "turf", via: "voice", model: "voice", question: "Give me the play-by-play on Tucker versus Godwin." });
    expect(turns[0]!.answer).toContain("TUCKER over Godwin");
    expect(turns[0]!.at).toBe(new Date(NOW + 8000).toISOString());
    expect(turns[1]).toMatchObject({ room: "exchange", by: "ticker", question: "(held back: it looked private)" });
    expect(turns[1]!.answer).not.toMatch(/\$\d/);
  });

  it("stays Desk-only: the read key never lists a call's exchanges", async () => {
    const log = new MemoryRoomLog();
    for (const t of exchangesOf(conv, agents, NOW)) await log.add(t, NOW);
    await log.add({ at: new Date(NOW).toISOString(), question: "typed ask", answer: "typed answer", room: "green", model: "claude" }, NOW);
    expect(keepTurns(log.rooms.green, NOW).map((t) => t.via ?? "typed")).toEqual(["typed", "voice"]);
    const key = "a-test-submind-log-token-long-enough-0123456789";
    const res = await roomLog(new Request(`${SITE}/api/skippy-log?room=green`, { headers: { "x-ceo-room-key": key } }), { deskKey: DESK, store: null, log, now: NOW + 1000, env: { SUBMIND_LOG_TOKEN: key } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turns: { question: string }[] };
    expect(body.turns.map((t) => t.question)).toEqual(["typed ask"]);
  });
});
