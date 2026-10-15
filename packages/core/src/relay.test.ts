import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RELAY_COUNT_KEYS,
  RELAY_MAX_BYTES,
  RELAY_STATUS_KEYS,
  RelayStatusSchema,
  emptyRelayStatus,
  parseRelayStatus,
  readRelayStatus,
  type RelayStatus,
} from "./index.ts";

/** Holds the site to "counts only" (#149, docs/RELAY-PRIVACY.md): nothing a message, a contact or a person is made of passes. */

const NOW = Date.UTC(2026, 9, 15, 18, 30);
const DAY = 86_400_000;

const good = (): RelayStatus => ({
  v: 1,
  at: NOW,
  hub: "listening",
  messages: "up",
  models: "up",
  owed: 5,
  sooner: 2,
  overdue: 1,
  later: 1,
  settled: 14,
  draftsReady: 4,
  sentToday: 3,
  streakDays: 6,
  week: Array.from({ length: 7 }, (_, i) => ({ day: Date.UTC(2026, 9, 9) + i * DAY, sent: i + 2, medianMinutes: i === 3 ? null : 40 + i * 10 })),
  nextNudgeAt: NOW + 30 * 60_000,
});

/** Things that must never cross: message text, names, phone numbers, emails, addresses, drafts, keys. */
const PRIVATE = [
  "Are you still coming Sunday? Dad wants to know if he should do the grill",
  "yes!! coming sunday, tell dad grill for sure",
  "Mom",
  "Priya Raman",
  "Dave (landlord)",
  "+1 (555) 867-5309",
  "555-867-5309",
  "5558675309",
  "+44 20 7946 0958",
  "priya@example.com",
  "mailto:sam@example.org",
  "1600 Pennsylvania Ave",
  "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
  "iMessage;-;+15558675309",
  "chat123456789",
];

/** Every leaf of a status, as a path and its value. */
function leaves(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, Array.isArray(value) ? Number(k) : k]));
  return [path];
}

function setAt(obj: unknown, path: (string | number)[], v: unknown) {
  let o = obj as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) o = o[p] as Record<string | number, unknown>;
  o[path[path.length - 1]!] = v;
}

const refused = (input: unknown) => {
  const r = readRelayStatus(input);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.problems;
};

describe("Relay's status for the site: counts and states only", () => {
  it("passes a real status as it is", () => {
    const r = readRelayStatus(good());
    expect(r).toEqual({ ok: true, status: good() });
  });

  it("passes the empty and wiped statuses", () => {
    expect(readRelayStatus(emptyRelayStatus(NOW)).ok).toBe(true);
    expect(readRelayStatus(emptyRelayStatus(NOW, "wiped")).ok).toBe(true);
  });

  it("returns a fresh copy, not the object it was handed", () => {
    const input = good();
    const r = readRelayStatus(input);
    if (!r.ok) throw new Error("expected ok");
    expect(r.status).not.toBe(input);
    expect(r.status.week[0]).not.toBe(input.week[0]);
  });

  it("has no free string anywhere in its shape: every string is an enum", () => {
    const schema = z.toJSONSchema(RelayStatusSchema) as Record<string, unknown>;
    const strings: unknown[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "string" || (Array.isArray(n.type) && n.type.includes("string"))) strings.push(n);
      for (const v of Object.values(n)) walk(v);
    };
    walk(schema);
    expect(strings.length).toBe(3);
    for (const s of strings) expect(s, JSON.stringify(s)).toHaveProperty("enum");
    // And every object in it is closed.
    const objects: Record<string, unknown>[] = [];
    const walkObjects = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") objects.push(n);
      for (const v of Object.values(n)) walkObjects(v);
    };
    walkObjects(schema);
    expect(objects.length).toBeGreaterThan(1);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
  });

  it("lists exactly the keys the spec allows", () => {
    expect(RELAY_STATUS_KEYS).toEqual(["v", "at", "hub", "messages", "models", "owed", "sooner", "overdue", "later", "settled", "draftsReady", "sentToday", "streakDays", "week", "nextNudgeAt"]);
  });

  it("refuses a message, a name, a number or an address in any field", () => {
    const paths = leaves(good());
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      for (const text of PRIVATE) {
        const s = good();
        setAt(s, path, text);
        expect(readRelayStatus(s).ok, `${path.join(".")} = ${text}`).toBe(false);
      }
    }
  });

  it("refuses any extra key, at the top or inside a day, whatever it is called", () => {
    for (const key of ["name", "preview", "draft", "text", "contact", "handle", "summary", "thread", "note", "debug", "Mom"]) {
      for (const value of [...PRIVATE, 1, true, null, ["Mom"], { text: "hi" }]) {
        refused({ ...good(), [key]: value });
        const s = good();
        (s.week[0] as Record<string, unknown>)[key] = value;
        refused(s);
      }
    }
  });

  it("refuses an owed list, even one of counts", () => {
    refused({ ...good(), owed: [{ name: "Mom", preview: "call me back" }] });
    refused({ ...good(), owed: [1, 2, 3] });
    refused({ ...good(), owed: { count: 5 } });
  });

  it("refuses keys that try to reach the prototype", () => {
    refused(JSON.parse(`{${JSON.stringify(good()).slice(1, -1)},"__proto__":{"name":"Mom"}}`));
    refused({ ...good(), constructor: "Mom" });
  });

  it("refuses enum fields that carry anything but their own values", () => {
    for (const hub of ["Listening", " listening", "listening ", "listening: Mom", "on", "", 1, null]) refused({ ...good(), hub });
    for (const field of ["messages", "models"] as const) for (const v of ["UP", "up, texting Mom", "down\n", "priya@example.com"]) refused({ ...good(), [field]: v });
  });

  it("can't smuggle a phone number, a date of birth or text as a count or a time", () => {
    for (const k of RELAY_COUNT_KEYS) {
      for (const v of [5558675309, 15558675309, 19900412, 10_000, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", "5 from Mom", true, null, undefined]) {
        refused({ ...good(), [k]: v });
      }
    }
    // Phone numbers read as milliseconds land in 1970; a date written as digits is not a timestamp either.
    for (const v of [5558675309, 15558675309, 19900412, 0, -1, NOW + 0.5, Date.UTC(2101, 0, 1), String(NOW), new Date(NOW).toISOString()]) {
      refused({ ...good(), at: v });
      refused({ ...good(), nextNudgeAt: v });
    }
    refused({ ...good(), week: [{ day: NOW, sent: 1, medianMinutes: 5558675309 }] });
  });

  it("refuses more than seven days, and a missing field", () => {
    refused({ ...good(), week: [...good().week, good().week[0]] });
    for (const k of RELAY_STATUS_KEYS) {
      const s: Record<string, unknown> = good();
      delete s[k];
      refused(s);
    }
    refused({ ...good(), v: 2 });
  });

  it("refuses parts larger than the whole, and a wipe that still reports counts", () => {
    refused({ ...good(), sooner: 6 });
    refused({ ...good(), draftsReady: 6 });
    refused({ ...emptyRelayStatus(NOW, "wiped"), settled: 3 });
  });

  it("never repeats what it refused in its problems", () => {
    for (const text of PRIVATE) {
      const problems = [...refused({ ...good(), [text]: text }), ...refused({ ...good(), hub: text }), ...refused({ ...good(), owed: text })];
      const s = good();
      (s.week[2] as Record<string, unknown>)[text] = 1;
      problems.push(...refused(s));
      for (const p of problems) {
        expect(p).not.toContain(text);
        expect(p).toMatch(/^[\w.]+: [\w ]+$/);
      }
    }
  });

  it("reads raw JSON, capped in size", () => {
    expect(parseRelayStatus(JSON.stringify(good()))).toEqual({ ok: true, status: good() });
    expect(parseRelayStatus("not json")).toEqual({ ok: false, problems: ["status: not JSON"] });
    expect(parseRelayStatus(JSON.stringify({ ...good(), pad: "x".repeat(RELAY_MAX_BYTES) }))).toEqual({ ok: false, problems: ["status: too large"] });
    expect(parseRelayStatus(JSON.stringify({ ...good(), preview: "call me back" })).ok).toBe(false);
  });
});
