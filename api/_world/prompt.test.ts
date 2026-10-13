import { describe, expect, it } from "vitest";
import { WORLD_CAST } from "./cast.ts";
import { builderOf, digestEvents, scrub, type Feed } from "./digest.ts";
import { answerSchema, applyChanges, buildPrompt, readAnswer } from "./prompt.ts";
import { initialState } from "./step.ts";

const FROM = Date.parse("2026-10-13T15:00:00Z");
const TO = Date.parse("2026-10-13T16:05:00Z");
const inHour = "2026-10-13T15:30:00Z";

/** Things that must never reach the prompt: Relay-style messages, contacts and personal data, wherever they hide. */
const SECRETS = ["Mum", "call me back", "nikita.page@example.com", "555-867-5309", "4111 1111 1111 1111", "sk-ant-api03-SECRETSECRETSECRET", "Dinner with Sam at 7"];

/** A GitHub feed with Foundry work, plus private material in every place the step could stumble on it. */
const FEED: Feed = {
  issues: [
    // Foundry work: its title and number may be used, never its body.
    {
      number: 41,
      title: "Idea: Keep the Lattice alive",
      state: "closed",
      created_at: "2026-10-13T05:00:00Z",
      closed_at: inHour,
      body: "**Builder:** Rocky (Opus)\n\nFrom Nikita: email nikita.page@example.com, phone 555-867-5309, card 4111 1111 1111 1111",
      labels: [{ name: "foundry" }, { name: "foundry:build" }, { name: "foundry:shipped" }],
    },
    { number: 50, title: "Idea: Relay drafts", state: "open", created_at: inHour, closed_at: null, body: "Mum said: call me back. Dinner with Sam at 7", labels: ["foundry", "foundry:idea"] },
    // Not Foundry work (a Relay-like note someone filed): never read at all.
    { number: 51, title: "Message from Mum: call me back at 555-867-5309", state: "open", created_at: inHour, closed_at: null, body: "Dinner with Sam at 7", labels: ["relay"] },
  ],
  comments: [
    { issue_url: "https://api.github.com/repos/nikitapage10/C.E.O./issues/50", created_at: inHour, body: "**Trail · Decision:** Sent back by Nikita on the Desk with notes:\n\n> Dinner with Sam at 7, call me back" },
    { issue_url: "https://api.github.com/repos/nikitapage10/C.E.O./issues/41", created_at: inHour, body: "**Trail · Assigned:** Rocky on Opus. Key: sk-ant-api03-SECRETSECRETSECRET" },
    { issue_url: "https://api.github.com/repos/nikitapage10/C.E.O./issues/51", created_at: inHour, body: "**Trail · Decision:** Mum: call me back" },
  ],
  runs: [{ status: "completed", conclusion: "success", created_at: inHour, updated_at: inHour }],
};

describe("the hour's digest of real events", () => {
  it("reads Foundry work only, by title and kind of step", () => {
    const d = digestEvents(FEED, FROM, TO);
    expect(d.shipped).toEqual([{ issue: 41, title: "Keep the Lattice alive", who: "caret" }]);
    expect(d.lines).toContain("Shipped: #41 Keep the Lattice alive (built by Rocky).");
    expect(d.lines).toContain("Started: #41 Keep the Lattice alive (Rocky on it).");
    expect(d.lines).toContain("The C.E.O. sent back with notes #50 Relay drafts.");
    expect(d.lines).toContain("The checks on main are green.");
    expect(d.lines.join("\n")).not.toMatch(/#51/);
  });

  it("leaves out anything outside the hour", () => {
    expect(digestEvents(FEED, TO, TO + 3_600_000).lines).toEqual([]);
  });

  it("knows who built a job from its Builder line, Rusty's dock crew counting as Rusty", () => {
    const issue = (body: string, labels: string[] = []) => ({ number: 1, title: "t", state: "closed", created_at: inHour, closed_at: inHour, body, labels });
    expect(builderOf(issue("**Builder:** Rocky (Opus)"))).toBe("caret");
    expect(builderOf(issue("**Builder:** Dusty (Sonnet)"))).toBe("tessellate");
    expect(builderOf(issue("**Builder:** Rivet (Haiku)"))).toBe("semicolon");
    expect(builderOf(issue("no line", ["rung:1"]))).toBe("semicolon");
    expect(builderOf(issue("no line"))).toBe("tessellate");
  });
});

describe("scrubbing", () => {
  it("hides emails, phone numbers, cards, keys, links and amounts", () => {
    const out = scrub("Mail nikita.page@example.com or ring +1 (555) 867-5309, card 4111 1111 1111 1111, key sk-ant-api03-SECRETSECRETSECRET, $12.50, see https://example.com/x?token=abc");
    for (const s of ["nikita.page@example.com", "867-5309", "4111", "SECRET", "12.50", "example.com"]) expect(out).not.toContain(s);
  });

  it("leaves ordinary words, issue numbers and dates alone", () => {
    expect(scrub("Shipped: #41 on 2026-10-13, 71 pages, 3 pm")).toBe("Shipped: #41 on 2026-10-13, 71 pages, 3 pm");
  });
});

describe("the step's prompt", () => {
  const digest = digestEvents(FEED, FROM, TO);
  const prompt = buildPrompt({ cast: WORLD_CAST, state: initialState(), digest, clock: "Tuesday 13 October, 10 am", recap: null });
  const all = `${prompt.system}\n${prompt.user}`;

  it("never carries Relay messages, contacts or personal data", () => {
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(all).not.toMatch(/@example\.com|555|4111|sk-ant/);
    expect(all).not.toContain("#51");
    // And it tells the writer the rule.
    expect(prompt.system).toMatch(/Relay's real messages are never shown to you/);
    expect(prompt.system).toMatch(/Never write personal data/);
  });

  it("has the whole cast in the cached part, and the hour in the rest", () => {
    for (const m of WORLD_CAST.members) expect(prompt.system).toContain(`- ${m.id}: ${m.name}`);
    expect(prompt.system).not.toContain("Tuesday 13 October");
    expect(prompt.user).toContain("Tuesday 13 October, 10 am");
    expect(prompt.user).toContain("Shipped: #41 Keep the Lattice alive (built by Rocky).");
    expect(prompt.user).toContain("#41 Keep the Lattice alive: built by caret");
    expect(prompt.user).toContain("caret & tessellate: rival");
  });

  it("keeps the cached part identical from hour to hour", () => {
    const later = buildPrompt({ cast: WORLD_CAST, state: initialState(), digest: { lines: [], shipped: [] }, clock: "Tuesday 13 October, 11 am", recap: { day: "2026-10-12", summaries: ["x"] } });
    expect(later.system).toBe(prompt.system);
    expect(later.user).toContain("the day in Ilyr (recap) for 2026-10-12");
  });

  it("asks for an answer in a fixed shape, with only real agents, rooms and kinds", () => {
    const schema = answerSchema(WORLD_CAST);
    expect(schema.required).toEqual(["summary", "scenes", "changes", "remarks", "recap"]);
    expect(schema.properties.scenes.items.properties.lines.items.properties.who.enum).toContain("caret");
    expect(schema.properties.changes.items.properties.kind.enum).toContain("rival");
  });
});

describe("reading Claude's answer", () => {
  const digest = digestEvents(FEED, FROM, TO);
  const rels = initialState().relationships;

  it("drops unknown agents, rooms and kinds, and trims everything", () => {
    const hour = readAnswer(
      {
        summary: "An hour.",
        scenes: [
          { room: "foundry", title: "Ok", lines: [{ who: "caret", text: "Amaze." }, { who: "nobody", text: "Who?" }] },
          { room: "moon", title: "No such room", lines: [{ who: "caret", text: "Hi" }] },
        ],
        changes: [
          { a: "caret", b: "tessellate", kind: "best-friend", note: "Finally." },
          { a: "caret", b: "caret", kind: "friend", note: "Self" },
          { a: "caret", b: "kevin", kind: "frenemy", note: "No such kind" },
        ],
        remarks: [],
        recap: "",
      },
      WORLD_CAST,
      rels,
      digest,
    )!;
    expect(hour.scenes).toEqual([{ room: "foundry", title: "Ok", lines: [{ who: "caret", text: "Amaze." }] }]);
    expect(hour.changes).toEqual([{ a: "caret", b: "tessellate", kind: "best-friend", note: "Finally.", was: "rival" }]);
  });

  it("scrubs anything sensitive Claude might write anyway", () => {
    const hour = readAnswer({ summary: "Mail me at nikita.page@example.com", scenes: [], changes: [], remarks: [{ issue: 41, text: "Call 555-867-5309!" }], recap: "" }, WORLD_CAST, rels, digest)!;
    expect(hour.summary).not.toContain("example.com");
    expect(hour.remarks[0]!.text).not.toContain("867");
  });

  it("puts each remark in its builder's mouth, only for jobs that shipped", () => {
    const hour = readAnswer({ summary: "s", scenes: [], changes: [], remarks: [{ issue: 41, text: "Good good good." }, { issue: 99, text: "Never shipped." }], recap: "" }, WORLD_CAST, rels, digest)!;
    expect(hour.remarks).toEqual([{ issue: 41, title: "Keep the Lattice alive", who: "caret", text: "Good good good." }]);
  });

  it("is null when there is nothing usable", () => {
    expect(readAnswer(null, WORLD_CAST, rels, digest)).toBeNull();
    expect(readAnswer({ scenes: [] }, WORLD_CAST, rels, digest)).toBeNull();
  });

  it("applies relationship changes, adding new pairs", () => {
    const next = applyChanges(rels, [{ a: "kevin", b: "gilt", kind: "friend", note: "New.", was: null }, { a: "tessellate", b: "caret", kind: "friend", note: "Softened.", was: "rival" }], "2026-10-13T16:05:00.000Z");
    expect(next).toHaveLength(rels.length + 1);
    expect(next.find((r) => r.a === "caret" && r.b === "tessellate")).toMatchObject({ kind: "friend", note: "Softened.", since: "2026-10-13T16:05:00.000Z" });
  });
});
