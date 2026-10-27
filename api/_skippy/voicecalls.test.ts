import { afterEach, describe, expect, it } from "vitest";
import type { GreenBoard, GreenPlayer } from "../_green/types.ts";
import { shapeInjuryDetail, shapeNewsDetail, type FpInjuryDetail, type FpNewsDetail } from "../_green/fantasypros.ts";
import { slimPlayers, type SlimPlayer } from "../_green/sleeper.ts";
import { PLAYER_READ, SLOW_TEXT, WEB_ACT, handle, type RoomSources } from "./toolroute.ts";
import { agentBody, voicePrompt } from "./voice.ts";
import { BACK_TO_SKIPPY, CLIENT_EVENTS, KERNEL_TOOLS, ON_AIR, OWN_VOICE, SKIPPY_CREW_PROMPT, SKIPPY_SOUND, TOOL_DEFS, TURN_MAX_TOKENS, ensureCrew, skippyTransfers, submindBody, submindPrompt, toolConfig } from "./voicecrew.ts";
import { STILL_SEARCHING, forgetSearches, namesPlayer, playerNewsText, webSearch, type PlayerSources, type WebDeps } from "./voicelookups.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";

/**
 * Nikita's first live call (#491): Skippy refused to look up Lamar Jackson, sent him to the Desk and the beat
 * reporters, announced a transfer he never made, and the Pessimist re-dumped his whole list on "hey". These pin the fix.
 */

const NOW = Date.parse("2026-10-27T16:00:00Z");
const DESK = "a test desk key, not a real one";
const SITE = "https://ceo.test";
const LIMITS = { sessionSecs: 600, silenceSecs: 20, llm: "claude-sonnet-5-5" };

const everyPrompt = () => [
  { who: "Skippy", text: voicePrompt(true) },
  ...ON_AIR.map((s) => ({ who: s.name, text: submindPrompt(s) })),
];

describe("the call's rules on the prompt text (#491)", () => {
  it("never refuses a lookup or points Nikita elsewhere: what no tool answers goes to hand_to_kernel, on every agent", () => {
    for (const { who, text } of everyPrompt()) {
      expect(text, who).toMatch(/Never refuse to look something up that a tool of yours can look up/);
      expect(text, who).toMatch(/never say you don't go digging around the web/);
      expect(text, who).toMatch(/Never point Nikita somewhere else/);
      for (const banned of ["hit the injury tracker on your Desk", "check the beat reporters", "go look in the Lattice"]) expect(text, who).toContain(`no "${banned}"`);
      expect(text, who).toMatch(/call hand_to_kernel straight away/);
      expect(text, who).toMatch(/When the answer is put into the call, say it straight away in your own words/);
    }
    for (const s of ON_AIR) expect(submindPrompt(s), s.name).toMatch(/one short line that you're asking Skippy, the Magnificent/);
    expect(voicePrompt(true)).toMatch(/digging into your own mind \("Rummaging through my mainframe\."\)/);
    // What pushed him to refuse: "say so plainly when you don't know" is gone from the crewed call.
    expect(voicePrompt(true)).not.toMatch(/Say so plainly when you don't know/);
    expect(voicePrompt(true)).toMatch(/never just say you don't know or won't look/);
    expect(voicePrompt(false)).toMatch(/Say so plainly when you don't know/);
  });

  it("names the lookups that answer the Lamar Jackson question, for Skippy and the Commentator", () => {
    expect(SKIPPY_CREW_PROMPT).toMatch(/player_news for any NFL player's injury status/);
    expect(SKIPPY_CREW_PROMPT).toMatch(/whether a player is playing is a player_news lookup, yours to answer/);
    const turf = submindPrompt(ON_AIR.find((s) => s.id === "turf")!);
    expect(turf).toMatch(/call player_news/);
    expect(turf).toMatch(/call web_search/);
    expect(turf).toMatch(/injury and news desk for the C\.E\.O\.'s roster/);
  });

  it("makes announcing a transfer and doing it the same action, and a named room one hop", () => {
    for (const { who, text } of everyPrompt()) {
      expect(text, who).toMatch(/call transfer_to_agent in that same turn, with no hand-over line of your own/);
      expect(text, who).toMatch(/Never say you're handing over, passing Nikita along, "giving you" someone/);
      expect(text, who).toMatch(/When Nikita names a room or a submind .* transfer straight to it, whoever has the mic/);
    }
    // The old wording that made him say the line and stop.
    expect(SKIPPY_CREW_PROMPT).not.toMatch(/Before handing over, say one short line/);
  });

  it("signs on once per transfer and keeps status answers short", () => {
    for (const s of ON_AIR) {
      const p = submindPrompt(s);
      expect(p).toMatch(/Say it once per hand-over, only in your very first line right after a hand-over line that names you/);
      expect(p).toContain(s.handOver);
      expect(p).toMatch(/On every later turn: no sign-on, no greeting, no recap of your room/);
      expect(p).toMatch(/one or two spoken sentences, the most important thing first; no offer of more/);
      expect(p).toMatch(/Small talk \("hey, how's it going\?"\) gets one short line/);
    }
  });
});

describe("the agents on ElevenLabs (#491)", () => {
  const known = { turf: "agent_turf_1", ticker: "agent_tick_1", static: "agent_stat_1", soot: "agent_soot_1", ember: "agent_embr_1" };

  it("every submind can hand to each sibling and back to Skippy; the transfer says the line", () => {
    for (const s of ON_AIR) {
      const t = submindBody(s, "v", "agent_skippy", ["tool_1"], LIMITS, "full", Object.fromEntries(Object.entries(known).filter(([id]) => id !== s.id))).conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers;
      expect(t.map((x) => x.agent_id).sort()).toEqual(["agent_skippy", ...Object.entries(known).filter(([id]) => id !== s.id).map(([, a]) => a)].sort());
      expect(t.at(-1)).toMatchObject({ agent_id: "agent_skippy", condition: BACK_TO_SKIPPY });
      for (const x of t.slice(0, -1)) expect(x.condition).toMatch(/^Nikita names The .+ or .+ \(wants to talk to it, chat with it, or asks for it\)/);
      const boiler = t.find((x) => x.agent_id === "agent_soot_1");
      if (s.id !== "soot") expect(boiler).toMatchObject({ condition: expect.stringContaining("the Boiler Room"), transfer_message: "Passing you to The Pessimist." });
    }
    const sk = skippyTransfers(Object.fromEntries(Object.entries(known).map(([id, a]) => [id, { id: a, sig: "0".repeat(16) }])))!.transfer_to_agent.params.transfers;
    expect(sk.find((x) => x.agent_id === "agent_soot_1")!.condition).toMatch(/^Nikita names The Pessimist or the Boiler Room/);
  });

  it("every pair of subminds passes the mic directly, both ways, never via Skippy (#504)", () => {
    const edges = new Set<string>();
    for (const s of ON_AIR) {
      const t = submindBody(s, "v", "agent_skippy", ["tool_1"], LIMITS, "full", Object.fromEntries(Object.entries(known).filter(([id]) => id !== s.id))).conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers;
      for (const x of t) if (x.agent_id !== "agent_skippy") edges.add(`${s.id}->${x.agent_id}`);
      // The room's own ask goes to the sibling, the Bookie included: its in-depth rule rides on the edge.
      for (const o of ON_AIR.filter((o) => o.id !== s.id)) expect(t.find((x) => x.agent_id === known[o.id])!.condition).toContain(o.takes);
    }
    expect(edges.size).toBe(ON_AIR.length * (ON_AIR.length - 1));
    expect(edges).toContain(`turf->${known.ticker}`);
    expect(edges).toContain(`ticker->${known.turf}`);
  });

  it("the mic comes home to Skippy's own voice, settings and persona (#504)", () => {
    const skippy = agentBody("v", "full", { toolIds: ["t"], transfers: null }).conversation_config.tts;
    expect(skippy).toEqual({ voice_id: "v", ...SKIPPY_SOUND });
    // Each submind sounds its own way, so the hand-back is heard.
    for (const s of ON_AIR) {
      const body = submindBody(s, "v", "agent_skippy", ["t"], LIMITS, "full", known);
      expect(body.conversation_config.tts).toEqual({ voice_id: "v", ...s.sound });
      expect(s.sound).not.toEqual(SKIPPY_SOUND);
      expect(s.sound.speed).toBeGreaterThanOrEqual(0.7);
      expect(s.sound.speed).toBeLessThanOrEqual(1.2);
      // No transfer carries the speaker's voice across: the target's own applies, Skippy's on the way home.
      for (const x of body.conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers) expect(x).toMatchObject(OWN_VOICE);
      expect(submindPrompt(s)).toMatch(/You are not Skippy and never speak as him/);
    }
    const sk = skippyTransfers(Object.fromEntries(Object.entries(known).map(([id, a]) => [id, { id: a, sig: "0".repeat(16) }])))!.transfer_to_agent.params.transfers;
    for (const x of sk) expect(x).toMatchObject({ preserve_voice_settings: false, preserve_client_tts_overrides: false });
    expect(voicePrompt(true)).toMatch(/When the mic comes back to you, you are Skippy again, all of you: your own voice, pace and manner, never the submind's/);
    // The core fallback (ElevenLabs refused a setting) still keeps the voice id.
    expect(agentBody("v", "core").conversation_config.tts).toEqual({ voice_id: "v" });
  });

  it("sends the transfers' results to the browser and gives a turn room to finish its sentence", () => {
    expect(CLIENT_EVENTS).toContain("agent_tool_response_full_payload");
    expect(CLIENT_EVENTS).not.toContain("agent_tool_response"); // one result event per tool, so the hologram's count stays right
    const skippy = agentBody("v", "full", { toolIds: ["t"], transfers: null });
    expect(skippy.conversation_config.conversation.client_events).toEqual([...CLIENT_EVENTS]);
    expect(agentBody("v", "core").conversation_config.conversation.client_events).toEqual([...CLIENT_EVENTS]);
    expect(skippy.conversation_config.agent.prompt).toMatchObject({ max_tokens: TURN_MAX_TOKENS });
    const sub = submindBody(ON_AIR[0]!, "v", "agent_skippy", ["t"], LIMITS);
    expect(sub.conversation_config.conversation.client_events).toEqual([...CLIENT_EVENTS]);
    expect(sub.conversation_config.agent.prompt).toMatchObject({ max_tokens: TURN_MAX_TOKENS, llm: "claude-sonnet-5-5" });
    expect(TURN_MAX_TOKENS).toBeGreaterThanOrEqual(1_000);
  });

  it("the player and web tools let the LLM fill only the name or the query", () => {
    const pn = toolConfig(TOOL_DEFS.find((t) => t.name === "player_news")!, SITE).api_schema;
    expect(pn.method).toBe("GET");
    expect(pn.query_params_schema).toMatchObject({ properties: { read: { constant_value: "player_news" }, player: { type: "string" } }, required: ["read"] });
    expect(pn.query_params_schema.properties).not.toHaveProperty("player.constant_value");
    const ws = toolConfig(TOOL_DEFS.find((t) => t.name === "web_search")!, SITE).api_schema;
    expect(ws).toMatchObject({ method: "POST", query_params_schema: { properties: { act: { constant_value: "web" } } }, request_body_schema: { required: ["query"] } });
  });

  it("makes every submind with the Kernel's tools, the Commentator with the lookups, and its siblings in two passes", async () => {
    const bodies = new Map<string, { tool_ids: string[]; transfers: { agent_id: string }[] }>();
    let n = 0;
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.includes("/tools")) return new Response(JSON.stringify({ id: `tool_${++n}xx` }), { status: 200 });
      const b = JSON.parse(String(init?.body)) as { name: string; conversation_config: { agent: { prompt: { tool_ids: string[]; built_in_tools: { transfer_to_agent: { params: { transfers: { agent_id: string }[] } } } } } } };
      const id = url.includes("/create") ? `agent_${++n}xx` : decodeURIComponent(url.split("/").pop()!);
      bodies.set(b.name, { tool_ids: b.conversation_config.agent.prompt.tool_ids, transfers: b.conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers });
      return new Response(JSON.stringify({ agent_id: id }), { status: 200 });
    }) as typeof fetch;
    const got = await ensureCrew({ key: "k", voice: "v", site: SITE, skippy: "agent_skippy", limits: LIMITS, fetcher, log: () => undefined }, { tools: {}, agents: {} });
    const id = (name: string) => got.tools[name]!.id;
    for (const s of ON_AIR) {
      const b = bodies.get(`${s.name} (C.E.O. Desk call)`)!;
      for (const k of KERNEL_TOOLS) expect(b.tool_ids, s.name).toContain(id(k));
      expect(b.transfers).toHaveLength(ON_AIR.length); // Skippy and the four siblings, after the second pass
    }
    const turf = bodies.get("The Commentator (C.E.O. Desk call)")!;
    for (const t of ["read_green", "player_news", "web_search"]) expect(turf.tool_ids).toContain(id(t));
    expect(bodies.get("The Pessimist (C.E.O. Desk call)")!.tool_ids).not.toContain(id("web_search"));
  });
});

/* ── The lookups ── */

const lamar = { id: "4881", n: "Lamar Jackson", pos: "QB", team: "BAL", inj: "Q", rank: 3, yh: null, sr: null, ib: "Knee", prac: "Limited", inote: "Limited Thursday with a knee bruise", nu: NOW - 5 * 3_600_000 } satisfies SlimPlayer;
const PLAYERS = { value: { "4881": lamar, "100": { id: "100", n: "Josh Allen", pos: "QB", team: "BUF", inj: null, rank: 1, yh: null, sr: null } as SlimPlayer }, at: NOW - 3 * 3_600_000 };
const me = (name: string, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id: "100", name, pos: "QB", team: "BUF", inj: null, proj: 0, src: "fp", avg: 20, last: 22, wk: null, ecr: 2, posRank: "QB2", bye: 8, ...over });
const BOARD = { ok: true, season: "2026", week: 8, roster: { starters: [{ slot: "QB", player: me("Josh Allen"), pts: 0 }], bench: [], reserve: [] }, byes: ["BUF"] } as unknown as GreenBoard;
const FP: { news: FpNewsDetail[]; injuries: FpInjuryDetail[] } = {
  injuries: [{ name: "Lamar Jackson", team: "BAL", pos: "QB", status: "Questionable", injury: "Knee", note: "Expected to play, per the team", at: new Date(NOW - 2 * 3_600_000).toISOString() }],
  news: [{ fpid: "1", name: "Lamar Jackson", text: "Jackson (knee) practices in full Friday", at: new Date(NOW - 3_600_000).toISOString(), desc: "He is on track to start Sunday." }],
};

describe("player_news (#491)", () => {
  it("answers 'will Lamar play?' from Sleeper and FantasyPros, with the C.E.O.'s QB on bye", () => {
    const text = playerNewsText("Lamar Jackson", { board: BOARD, players: PLAYERS, fp: FP, now: NOW });
    expect(text).toContain("Lamar Jackson (QB, BAL).");
    expect(text).toContain("Sleeper: questionable (Knee; practice: Limited; Limited Thursday with a knee bruise; news updated 5 hours ago)");
    expect(text).toContain("FantasyPros injury report: Questionable, Knee, Expected to play, per the team, updated 2 hours ago.");
    expect(text).toContain("FantasyPros news (1 hours ago): Jackson (knee) practices in full Friday He is on track to start Sunday.");
    expect(playerNewsText("lamar", { board: BOARD, players: PLAYERS, fp: FP, now: NOW })).toContain("Lamar Jackson (QB, BAL)");
    const roster = playerNewsText("Josh Allen", { board: BOARD, players: PLAYERS, fp: FP, now: NOW });
    expect(roster).toContain("Josh Allen (QB, BUF), on the C.E.O.'s roster, his team is on bye in week 8.");
  });

  it("says plainly who it can't find, and works on Sleeper alone when FantasyPros is down", () => {
    expect(playerNewsText("Nobody Atall", { board: BOARD, players: PLAYERS, fp: FP, now: NOW })).toMatch(/No player matching "Nobody Atall".*hand_to_kernel/);
    const solo = playerNewsText("Lamar Jackson", { board: BOARD, players: PLAYERS, fp: null, now: NOW });
    expect(solo).toContain("Sleeper: questionable");
    expect(solo).toContain("FantasyPros didn't answer this time");
  });

  it("with no name, reads the roster's injuries and news", () => {
    const board = { ...BOARD, roster: { starters: [{ slot: "QB", player: me("Lamar Jackson", { id: "4881", team: "BAL", inj: "Q" }), pts: 0 }], bench: [me("Josh Allen")], reserve: [] } } as unknown as GreenBoard;
    const text = playerNewsText(null, { board, players: PLAYERS, fp: FP, now: NOW });
    expect(text).toMatch(/^The C\.E\.O\.'s roster, injuries and news \(week 8\):/);
    expect(text).toContain("Lamar Jackson (QB, BAL), on the C.E.O.'s roster.");
    expect(text).not.toContain("Josh Allen");
  });

  it("matches names whole-word, without accents or suffixes", () => {
    expect(namesPlayer("Lamar", "Lamar Jackson")).toBe(true);
    expect(namesPlayer("Marvin Harrison", "Marvin Harrison Jr.")).toBe(true);
    expect(namesPlayer("Amon-Ra St Brown", "Amon-Ra St. Brown")).toBe(true);
    expect(namesPlayer("Lam", "Lamar Jackson")).toBe(false);
    expect(namesPlayer("", "Lamar Jackson")).toBe(false);
  });

  it("keeps Sleeper's and FantasyPros' injury detail from their answers, and nothing else", () => {
    const slim = slimPlayers({ "4881": { position: "QB", team: "BAL", full_name: "Lamar Jackson", injury_status: "Questionable", injury_body_part: "Knee", injury_notes: "Limited", practice_participation: "Limited", news_updated: NOW, search_rank: 3, email: "x@example.com" }, "100": { position: "QB", team: "BUF", full_name: "Josh Allen", injury_body_part: "Elbow" } });
    expect(slim["4881"]).toMatchObject({ inj: "Q", ib: "Knee", inote: "Limited", prac: "Limited", nu: NOW });
    expect(slim["100"]).not.toHaveProperty("ib"); // detail only for a player listed injured
    expect(JSON.stringify(slim)).not.toContain("example.com");
    expect(shapeInjuryDetail({ injuries: [{ name: "Lamar Jackson", team_id: "BAL", position_id: "QB", status: "Questionable", injury: "Knee", notes: "Full Friday", last_update: "2026-10-27T10:00:00Z" }] })[0]).toEqual({ name: "Lamar Jackson", team: "BAL", pos: "QB", status: "Questionable", injury: "Knee", note: "Full Friday", at: "2026-10-27T10:00:00.000Z" });
    expect(shapeNewsDetail({ items: [{ title: "Jackson practices", desc: "On track to start.", player_name: "Lamar Jackson", created: "2026-10-27T10:00:00Z" }] })[0]).toMatchObject({ name: "Lamar Jackson", text: "Jackson practices", desc: "On track to start." });
  });
});

describe("web_search (#491)", () => {
  afterEach(() => forgetSearches());
  const deps = (over: Partial<WebDeps> = {}) => {
    const spent: number[] = [];
    let release: (v: { text: string; usage: { input_tokens: number; output_tokens: number }; usd: number }) => void = () => undefined;
    const d: WebDeps = {
      search: () => new Promise((resolve) => (release = resolve)),
      canSpend: async () => true,
      addSpend: async (_u, usd) => void spent.push(usd),
      ...over,
    };
    return { d, spent, release: (text: string) => release({ text, usage: { input_tokens: 10, output_tokens: 5 }, usd: 0.03 }) };
  };

  it("answers 'still searching' inside the budget, then the answer on the same query, counted once", async () => {
    const { d, spent, release } = deps();
    expect(await webSearch("Lamar Jackson injury status week 8", "call1", d, NOW, 5)).toBe(STILL_SEARCHING);
    release("Jackson practiced in full Friday and is expected to start, per the Ravens.");
    await new Promise((r) => setTimeout(r, 0));
    const text = await webSearch("lamar jackson injury status week 8", "call1", d, NOW, 5);
    expect(text).toContain('Web search for "Lamar Jackson injury status week 8":');
    expect(text).toContain("expected to start");
    expect(spent).toEqual([0.03]);
    // Another call's same query is its own search.
    expect(await webSearch("Lamar Jackson injury status week 8", "call2", d, NOW, 5)).toBe(STILL_SEARCHING);
  });

  it("refuses a private query, an empty one, past the budget or past the call's searches, each pointing at the Kernel", async () => {
    const { d } = deps();
    expect(await webSearch("email me at someone@example.com", "c", d, NOW, 5)).toMatch(/private/);
    expect(await webSearch("   ", "c", d, NOW, 5)).toMatch(/empty/);
    expect(await webSearch("q", "c", deps({ canSpend: async () => false }).d, NOW, 5)).toMatch(/budget is spent; hand the question to hand_to_kernel/);
    expect(await webSearch("q", "c", deps({ search: null }).d, NOW, 5)).toMatch(/hand_to_kernel/);
    for (let i = 0; i < 6; i++) await webSearch(`query ${i}`, "c9", d, NOW, 1);
    expect(await webSearch("query 7", "c9", d, NOW, 1)).toMatch(/all the web searches it may/);
  });
});

describe("the route's new lookups (#491)", () => {
  const setup = async (over: Partial<RoomSources> = {}) => {
    const crew = new MemoryCrewStore();
    const token = (await issueToolToken(crew, DESK, "conv_live_491", NOW + 12 * 60_000, NOW))!;
    const players: PlayerSources = { board: async () => BOARD, players: async () => PLAYERS, fp: async () => FP };
    const web = deps0();
    const sources = { players, web, ...over } as unknown as RoomSources;
    return { token, d: { deskKey: DESK, crew, sources, now: NOW } };
  };
  const deps0 = (): WebDeps => ({ search: async () => ({ text: "Expected to start.", usage: { input_tokens: 1, output_tokens: 1 }, usd: 0.02 }), canSpend: async () => true, addSpend: async () => undefined });
  afterEach(() => forgetSearches());

  it("GET ?read=player_news&player= answers the player, and takes no other parameter", async () => {
    const { token, d } = await setup();
    const get = (q: string) => new Request(`${SITE}/api/skippy-tools?${q}`, { headers: { [TOOL_HEADER]: token } });
    const body = (await (await handle(get(`read=${PLAYER_READ}&player=Lamar%20Jackson`), d)).json()) as { read: string; text: string };
    expect(body.read).toBe("player_news");
    expect(body.text).toContain("Sleeper: questionable");
    expect((await handle(get(`read=${PLAYER_READ}&player=a&player=b`), d)).status).toBe(400);
    expect((await handle(get(`read=${PLAYER_READ}&url=x`), d)).status).toBe(400);
    expect((await handle(get(`read=green&player=x`), d)).status).toBe(400);
  });

  it("a slow player lookup says so and points at the Kernel, never elsewhere", async () => {
    const { token, d } = await setup({ players: { board: () => new Promise(() => undefined), players: () => new Promise(() => undefined), fp: async () => null } } as Partial<RoomSources>);
    const res = await handle(new Request(`${SITE}/api/skippy-tools?read=${PLAYER_READ}`, { headers: { [TOOL_HEADER]: token } }), { ...d, budgetMs: 30 });
    const body = (await res.json()) as { text: string };
    // Inside the budget, each part held short: the answer says what didn't answer and where to hand it.
    expect(body.text).toMatch(/isn't answering.*hand_to_kernel/);
    expect(SLOW_TEXT).toMatch(/hand_to_kernel/);
    expect(SLOW_TEXT).not.toMatch(/Desk|Lattice|reporters/);
  });

  it("POST ?act=web { query } runs the search", async () => {
    const { token, d } = await setup();
    const res = await handle(new Request(`${SITE}/api/skippy-tools?act=${WEB_ACT}`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: "Ravens injury report" }) }), d);
    expect(((await res.json()) as { text: string }).text).toContain("Expected to start.");
    expect((await handle(new Request(`${SITE}/api/skippy-tools?act=nope`, { method: "POST", headers: { [TOOL_HEADER]: token } }), d)).status).toBe(400);
  });
});
