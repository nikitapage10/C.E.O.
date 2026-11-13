import { describe, expect, it } from "vitest";
import { callTool, toolNamed, type ToolHost } from "./agent/tools.ts";
import { MemoryPending } from "./agent/pending.ts";
import { DESK_LIBRARY, DOC_PATH, READ_MAX, deskCallText, deskLookup, deskLookupText, deskReadText, excerpt, planSections, sourceOf, stem, terms, type PlanIssue } from "./desk.ts";
import { DESK_READ, handle, type RoomSources } from "./toolroute.ts";
import { TOOL_DEFS, toolConfig } from "./voicecrew.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";

const NOW = Date.parse("2026-11-13T18:00:00Z");
const ISSUES: PlanIssue[] = [
  { number: 1200, title: "Give the Haven a garden tab", body: "**Pitch:** A garden tab with the balcony plants.\n**Size:** medium", labels: [{ name: "foundry" }, { name: "foundry:working" }] },
  { number: 1201, title: "Shipped already", body: "", labels: ["foundry", "foundry:shipped"] },
  { number: 1202, title: "A pull request", pull_request: {}, labels: ["foundry"] },
  { number: 1203, title: "Text 303-555-0123 about it", body: "**Pitch:** private", labels: ["foundry"] },
];

describe("the Desk's library (#1141)", () => {
  it("is built in, by section", () => {
    expect(DESK_LIBRARY.length).toBeGreaterThan(200);
    expect(DESK_LIBRARY.some((s) => s.source === "lore/syntherion.md")).toBe(true);
  });

  it("finds the sections that answer an ask, titles first", () => {
    expect(deskLookup("Rocky")[0]!.id).toMatch(/^dossier-caret/);
    expect(deskLookup("who is Rivet?")[0]!.id).toMatch(/^dossier-semicolon/);
    expect(deskLookup("what does the Green room do").map((h) => h.id)).toContain("room-green");
    expect(deskLookup("the Kernel subminds").some((h) => /Kernel|submind/i.test(h.title))).toBe(true);
    expect(deskLookup("Azure deploy").some((h) => h.source === "docs/AZURE.md" || h.source === "README.md" || h.source === "docs/DELIVERY.md")).toBe(true);
    expect(deskLookup("the the what is")).toEqual([]);
    expect(deskLookup("zzqxv nonsenseword")).toEqual([]);
  });

  it("words: stop words out, plain plurals folded", () => {
    expect(terms("What are the subminds of the Kernel?")).toEqual(["submind", "kernel"]);
    expect(stem("Houses")).toBe("house");
    expect(stem("stories")).toBe("story");
    expect(stem("glass")).toBe("glass");
    expect(stem("deployed")).toBe(stem("deploy"));
    expect(stem("building")).toBe("build");
    expect(excerpt("One thing. The Kernel seat is here. More.", ["kernel"], 40)).toMatch(/^…The Kernel seat/);
  });

  it("reads a section by id, capped, and names the next part", () => {
    const multi = DESK_LIBRARY.find((s) => / \(part 1 of \d+\)$/.test(s.title))!;
    const text = deskReadText(multi.id);
    expect(text.startsWith(multi.title)).toBe(true);
    expect(text).toMatch(/The next part: \[[a-z0-9-]+-2\]/);
    expect(text.length).toBeLessThanOrEqual(READ_MAX + 400);
    expect(deskReadText("no-such-section")).toMatch(/No section/);
  });

  it("turns the Foundry's open issues into plans, leaving out ships, pull requests and anything private", () => {
    const plans = planSections(ISSUES);
    expect(plans.map((p) => p.id)).toEqual(["plans", "plan-1200"]);
    expect(plans[1]!.text).toMatch(/being built now/);
    expect(plans[1]!.text).toMatch(/Pitch: A garden tab/);
    expect(deskLookup("what's planned for the Haven garden", plans)[0]!.id).toMatch(/^plan/);
    expect(deskLookupText("future plans roadmap", plans)).toMatch(/\[plans\] Future plans/);
    expect(planSections([])).toEqual([]);
  });
});

describe("desk_lookup and desk_read in Skippy's tools (#1141)", () => {
  const host = (over: Partial<ToolHost> = {}): ToolHost => ({ read: async () => "", memory: null, kitchenAdd: null, homeAct: null, fileIssue: null, skipTerms: [], now: NOW, ...over });
  const opts = { pending: new MemoryPending(), surface: "spoken" as const };

  it("are registered as reads, on Today", () => {
    for (const n of ["desk_lookup", "desk_read"]) expect(toolNamed(n)).toMatchObject({ effect: "read", room: "today" });
  });

  it("look up and read, with the live plans when there are any, and the library alone when GitHub is down", async () => {
    const got = await callTool("desk_lookup", { query: "Rocky the Eridian" }, host(), opts);
    expect(got).toMatchObject({ ok: true });
    expect("text" in got && got.text).toMatch(/\[dossier-caret/);
    const withPlans = await callTool("desk_lookup", { query: "garden tab" }, host({ plans: async () => planSections(ISSUES) }), opts);
    expect("text" in withPlans && withPlans.text).toMatch(/\[plan-1200\]/);
    const down = await callTool("desk_lookup", { query: "Rocky" }, host({ plans: async () => Promise.reject(new Error("down")) }), opts);
    expect("text" in down && down.text).toMatch(/dossier-caret/);
    const read = await callTool("desk_read", { id: "room-green" }, host(), { ...opts, surface: "desk" });
    expect("text" in read && read.text).toMatch(/^Room: Green \(green\)/);
    const plan = await callTool("desk_read", { id: "plan-1200" }, host({ plans: async () => planSections(ISSUES) }), opts);
    expect("text" in plan && plan.text).toMatch(/Give the Haven a garden tab/);
  });
});

describe("the call's desk read (#1141)", () => {
  const SITE = "https://ceo.test";
  const DESK = "a test desk key, not a real one";
  const setup = async (sources: Partial<RoomSources> = {}) => {
    const crew = new MemoryCrewStore();
    const token = (await issueToolToken(crew, DESK, "conv_desk_1141", NOW + 12 * 60_000, NOW))!;
    return { token, d: { deskKey: DESK, crew, sources: sources as RoomSources, now: NOW } };
  };

  it("GET ?read=desk&q= answers the top excerpts, takes only q, and needs the call's token", async () => {
    const { token, d } = await setup({ plans: async () => planSections(ISSUES) });
    const get = (q: string, t = token) => new Request(`${SITE}/api/skippy-tools?${q}`, { headers: { [TOOL_HEADER]: t } });
    const body = (await (await handle(get(`read=${DESK_READ}&q=${encodeURIComponent("Rivet hard hat")}`), d)).json()) as { read: string; text: string };
    expect(body.read).toBe("desk");
    expect(body.text).toMatch(/^From the Desk's own library/);
    expect(body.text).toMatch(/Rivet/);
    expect(body.text.length).toBeLessThan(1_600);
    const plan = (await (await handle(get(`read=desk&q=garden`), d)).json()) as { text: string };
    expect(plan.text).toMatch(/garden tab/);
    expect((await handle(get(`read=desk&q=a&q=b`), d)).status).toBe(400);
    expect((await handle(get(`read=desk&url=x`), d)).status).toBe(400);
    expect((await handle(get(`read=desk&q=Rocky`, "not-a-token"), d)).status).toBe(401);
    expect(deskCallText("")).toMatch(/Say what to look up/);
  });

  it("is on Skippy's call as a webhook tool with a q parameter", () => {
    const def = TOOL_DEFS.find((t) => t.name === "desk_lookup")!;
    expect(def.read).toBe("desk");
    expect(toolConfig(def, SITE).api_schema).toMatchObject({ method: "GET", query_params_schema: { properties: { read: { constant_value: "desk" }, q: { type: "string" } }, required: ["read", "q"] } });
  });
});

describe("the page an answer came from (#1153)", () => {
  const host = (over: Partial<ToolHost> = {}): ToolHost => ({ read: async () => "", memory: null, kitchenAdd: null, homeAct: null, fileIssue: null, skipTerms: [], now: NOW, ...over });
  const opts = { pending: new MemoryPending(), surface: "desk" as const };

  it("names the doc a desk_read opened, without a part suffix", async () => {
    const got = await callTool("desk_read", { id: "room-green" }, host(), opts);
    expect(got).toMatchObject({ ok: true, from: { tool: "desk_read", source: { path: "rooms/green/room.ts" } } });
  });
  it("names the top hit of a desk_lookup", async () => {
    const got = await callTool("desk_lookup", { query: "Rocky the Eridian" }, host(), opts);
    expect("from" in got && got.from?.tool).toBe("desk_lookup");
    expect("from" in got && got.from?.source.path).toMatch(DOC_PATH);
  });
  it("cites no plan (a GitHub issue) and nothing outside the public docs", async () => {
    const plan = await callTool("desk_read", { id: "plan-1200" }, host({ plans: async () => planSections(ISSUES) }), opts);
    expect("from" in plan && plan.from).toBeFalsy();
    expect(sourceOf({ title: "x", source: "kb/notes.md" })).toBeNull();
    expect(sourceOf({ title: "x", source: "../secrets.md" })).toBeNull();
    expect(sourceOf({ title: "FOUNDRY (part 2 of 3)", source: "docs/FOUNDRY.md" })).toEqual({ title: "FOUNDRY", path: "docs/FOUNDRY.md" });
  });
});
