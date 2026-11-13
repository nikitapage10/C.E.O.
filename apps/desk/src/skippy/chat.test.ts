import { beforeEach, describe, expect, it } from "vitest";
import { runAction, type ActionDeps } from "./actions.ts";
import { ASK_ERROR, HISTORY_TURNS, MESSAGE_MAX, actionPath, askSkippy, historyFor, readActions, readSources, docUrl, speakable, tapConfirm, useSkippy, type Turn } from "./chat.ts";

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

describe("Skippy's buttons, checked again in the browser", () => {
  it("keeps the closed set and drops the rest", () => {
    expect(
      readActions([
        { kind: "idea", label: "File it", text: "A podium" },
        { kind: "build", label: "Build #10", issue: 10 },
        { kind: "open", label: "Open", page: "https://attacker.example" },
        { kind: "answer", label: "Answer", issue: 11, text: "The Desk" },
        { kind: "lattice", label: "Go", room: "mars" },
      ]),
    ).toEqual([
      { kind: "idea", label: "File it", text: "A podium" },
      { kind: "answer", label: "Answer", issue: 11, text: "The Desk" },
      { kind: "lattice", label: "Go" },
    ]);
    expect(readActions("nope")).toEqual([]);
    expect(readActions(Array.from({ length: 6 }, () => ({ kind: "open", label: "x", page: "today" })))).toHaveLength(3);
  });

  it("knows where pages and rooms are, and that ideas and answers aren't links", () => {
    expect(actionPath({ kind: "open", label: "x", page: "security" })).toBe("/boiler/security");
    expect(actionPath({ kind: "open", label: "x", page: "today" })).toBe("/");
    expect(actionPath({ kind: "lattice", label: "x", room: "spire" })).toBe("/lattice?room=spire");
    expect(actionPath({ kind: "lattice", label: "x" })).toBe("/lattice");
    expect(actionPath({ kind: "idea", label: "x", text: "y" })).toBeNull();
  });
});

describe("the conversation", () => {
  it("sends only the last few turns of what was said, never the Desk's own notes", () => {
    const turns: Turn[] = Array.from({ length: 12 }, (_, i) => ({ id: i, who: i % 2 ? "skippy" : "nikita", text: `t${i}`, note: i === 11 }));
    const h = historyFor(turns);
    expect(h).toHaveLength(HISTORY_TURNS);
    expect(h.at(-1)).toEqual({ who: "nikita", text: "t10" });
  });

  it("reads a reply aloud without the symbols", () => {
    expect(speakable("**Bask** in #12, `monkey`.")).toBe("Bask in number 12, monkey.");
  });
});

describe("askSkippy", () => {
  it("returns the reply and the checked buttons", async () => {
    const got = await askSkippy("hi", [], reply(200, { reply: "Bask.", actions: [{ kind: "open", label: "Open", page: "foundry" }, { kind: "merge", label: "x" }] }));
    expect(got).toEqual({ ok: true, reply: "Bask.", actions: [{ kind: "open", label: "Open", page: "foundry" }], capped: false, looked: [], sources: [], did: [], confirm: [] });
  });
  it("reads the agent's chips, the calls waiting for a tap and the month (#646), and drops anything malformed", async () => {
    const got = await askSkippy(
      "hi",
      [],
      reply(200, {
        reply: "Done.",
        looked: ["Memory: plants", 7, "x".repeat(200)],
        did: ["Added 2 to the Kitchen list"],
        confirm: [{ id: "0123456789abcdef0123", label: "Remember it", summary: "Remember: likes window seats" }, { id: "nope", label: "x", summary: "y" }],
        spend: { usd: 12.5, cap: 60, warn: 50 },
      }),
    );
    expect(got).toMatchObject({ ok: true, did: ["Added 2 to the Kitchen list"], confirm: [{ id: "0123456789abcdef0123", label: "Remember it" }], spend: { usd: 12.5, cap: 60, warn: 50 } });
    expect(got.ok && got.looked[0]).toBe("Memory: plants");
    expect(got.ok && got.confirm).toHaveLength(1);
  });
  it("posts Nikita's tap to the act endpoint", async () => {
    const calls: { url: string; body: string }[] = [];
    const doFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ ok: true, text: "Kept.", did: "Remembered it" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await tapConfirm("0123456789abcdef0123", true, doFetch)).toMatchObject({ ok: true, did: "Remembered it" });
    expect(calls[0]).toEqual({ url: "/api/skippy-act", body: JSON.stringify({ confirm: "0123456789abcdef0123", yes: true }) });
  });
  it("says why when it can't answer", async () => {
    expect(await askSkippy("hi", [], reply(401, { error: "signed-out" }))).toMatchObject({ ok: false, error: "signed-out" });
    expect(await askSkippy("hi", [], reply(422, { error: "private", held: ["an email address"] }))).toMatchObject({ ok: false, error: "held", message: expect.stringContaining("an email address") });
    expect(await askSkippy("hi", [], reply(429, { error: "slow-down", wait: 30 }))).toMatchObject({ ok: false, error: "slow", message: expect.stringContaining("30 s") });
    expect(await askSkippy("hi", [], reply(503, { error: "not-set-up" }))).toMatchObject({ ok: false, error: "off" });
    expect(await askSkippy("hi", [], reply(502, { error: "model" }))).toMatchObject({ ok: false, error: "failed", message: ASK_ERROR.failed });
    expect(await askSkippy("hi", [], (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toMatchObject({ ok: false, error: "failed" });
  });
  it("caps what it sends", async () => {
    let sent: { message: string } | null = null;
    const spy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as { message: string };
      return new Response(JSON.stringify({ reply: "ok", actions: [] }));
    }) as unknown as typeof fetch;
    await askSkippy("x".repeat(2000), [], spy);
    expect(sent!.message).toHaveLength(MESSAGE_MAX);
  });
});

describe("the shared store", () => {
  beforeEach(() => useSkippy.setState({ turns: [], busy: false, open: false, voice: false }));
  it("adds Nikita's words and Skippy's answer, or a note when it failed", async () => {
    await useSkippy.getState().send("What's building?", reply(200, { reply: "Two things, monkey.", actions: [] }));
    await useSkippy.getState().send("again", reply(401, {}));
    const turns = useSkippy.getState().turns;
    expect(turns.map((t) => [t.who, t.text, Boolean(t.note)])).toEqual([
      ["nikita", "What's building?", false],
      ["skippy", "Two things, monkey.", false],
      ["nikita", "again", false],
      ["skippy", ASK_ERROR["signed-out"], true],
    ]);
    expect(useSkippy.getState().busy).toBe(false);
  });
  it("never locks: messages sent while one is out queue, and each is answered in turn under its own question (#952)", async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { message: string; history: { text: string }[] };
      seen.push(`${body.message}|${body.history.map((h) => h.text).join(",")}`);
      if (body.message === "first") await gate;
      return new Response(JSON.stringify({ reply: `re ${body.message}`, actions: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = useSkippy.getState().send("first", slow);
    const b = useSkippy.getState().send("second", slow);
    // Both show at once, while the first is still out.
    expect(useSkippy.getState().turns.map((t) => t.text)).toEqual(["first", "second"]);
    expect(useSkippy.getState().busy).toBe(true);
    release();
    expect((await a)?.text).toBe("re first");
    expect((await b)?.text).toBe("re second");
    expect(useSkippy.getState().turns.map((t) => t.text)).toEqual(["first", "re first", "second", "re second"]);
    // In order, each with only what came before it.
    expect(seen).toEqual(["first|", "second|first,re first"]);
    expect(useSkippy.getState().busy).toBe(false);
  });
  it("ignores an empty message", async () => {
    expect(await useSkippy.getState().send("   ", reply(200, { reply: "x" }))).toBeNull();
    expect(useSkippy.getState().turns).toEqual([]);
  });
});

describe("a tap on a button", () => {
  const calls: string[] = [];
  const deps = (signed = "ok"): ActionDeps => ({
    signIn: async () => signed,
    fileIdea: async (text) => (calls.push(`idea:${text}`), "shaping"),
    answer: async (issue, text) => (calls.push(`answer:${issue}:${text}`), "ok"),
    go: (path) => void calls.push(`go:${path}`),
  });
  beforeEach(() => void (calls.length = 0));

  it("files an idea through the Suggest box's path, and answers through the idea card's", async () => {
    expect(await runAction({ kind: "idea", label: "File", text: "A podium" }, undefined, deps())).toBe("done");
    expect(await runAction({ kind: "answer", label: "Answer", issue: 11, text: "Today" }, undefined, deps())).toBe("done");
    expect(calls).toEqual(["idea:A podium", "answer:11:Today"]);
  });
  it("opens pages in place without signing in", async () => {
    expect(await runAction({ kind: "open", label: "Open", page: "foundry" }, undefined, deps("cancelled"))).toBe("done");
    expect(calls).toEqual(["go:/foundry"]);
  });
  it("sends nothing when signing in doesn't happen", async () => {
    expect(await runAction({ kind: "idea", label: "File", text: "x" }, undefined, deps("cancelled"))).toBe("signed-out");
    expect(calls).toEqual([]);
  });
});

describe("the sources line under an answer (#1153)", () => {
  it("keeps public doc paths only, at most two, and links them on GitHub's main branch", () => {
    const got = readSources([
      { title: "Foundry › Lane 2", path: "docs/FOUNDRY.md" },
      { title: "A private note", path: "kb/me.md" },
      { title: "Escape", path: "../x.md" },
      { title: "Remote", path: "https://evil.test/a.md" },
      { title: "Room: Green", path: "rooms/green/room.ts" },
      { title: "Third", path: "docs/ROOMS.md" },
    ]);
    expect(got.map((s) => s.path)).toEqual(["docs/FOUNDRY.md", "rooms/green/room.ts"]);
    expect(docUrl(got[0]!.path)).toBe("https://github.com/nikitapage10/C.E.O./blob/main/docs/FOUNDRY.md");
    expect(readSources(undefined)).toEqual([]);
  });
});
