/* global Blob, TextEncoder */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BlobStore } from "../api/_world/store.ts";
import { BlobStoryStore, STORY_STYLE as API_STORY_STYLE } from "../api/_world/story.ts";
import { RECENT_KEEP as API_RECENT_KEEP } from "../api/_world/prompt.ts";
import { runStep } from "../api/_world/step.ts";
import { mondayOf, publicSeedFiles, RECENT_KEEP, seedTarget, STORY_STYLE, TTS_MODEL, TTS_VOICE } from "./seed-azure-lib.mjs";

const root = "/tmp/seed";

describe("the Azure seed's file names", () => {
  it("keep the world, its stories and the idea pictures under the same names", () => {
    expect(seedTarget(root, "world/state.json")).toBe(join(root, "world/state.json"));
    expect(seedTarget(root, "world/days/2026-10-21.json")).toBe(join(root, "world/days/2026-10-21.json"));
    expect(seedTarget(root, "world/stories/2026-10-21.wav")).toBe(join(root, "world/stories/2026-10-21.wav"));
    expect(seedTarget(root, "foundry/ideas/1760000000000-AbC.jpg")).toBe(join(root, "foundry/ideas/1760000000000-AbC.jpg"));
  });

  it("leave the Desk's sign-ins and everything else behind", () => {
    expect(seedTarget(root, "desk/auth/passkeys.json")).toBeNull();
    expect(seedTarget(root, "desk/skippy/spend.json")).toBeNull();
    expect(seedTarget(root, "other.json")).toBeNull();
    expect(seedTarget(root, "world/")).toBeNull();
  });

  it("refuse names that could step outside the folder", () => {
    expect(seedTarget(root, "world/../../etc/passwd")).toBeNull();
    expect(seedTarget(root, "world/./state.json")).toBeNull();
    expect(seedTarget(root, "world//state.json")).toBeNull();
    expect(seedTarget(root, "world\\..\\x")).toBeNull();
    expect(seedTarget(root, "/world/state.json")).toBeNull();
    expect(seedTarget(root, "world/a\nb.json")).toBeNull();
    expect(seedTarget(root, undefined)).toBeNull();
  });
});

/* ── The public seed: production's public API → the Azure store's own files ── */

// Made-up fixtures in the public feed's shape: two days in Ilyr, 30 hours, nothing taken from production.
const hour = (step, day, extra = {}) => ({
  step,
  at: `${day}T${String(step % 24).padStart(2, "0")}:00:00.000Z`,
  day,
  source: "scripted",
  summary: `Hour ${step} in the fixture.`,
  scenes: [{ room: "foundry", title: "A test", lines: [{ who: "rusty", text: "Fixture line." }] }],
  changes: [],
  remarks: [],
  events: [],
  cost: null,
  ...extra,
});
const dayA = "2026-10-20";
const dayB = "2026-10-21";
const hoursA = Array.from({ length: 20 }, (_, i) => hour(i + 1, dayA));
const hoursB = Array.from({ length: 10 }, (_, i) => hour(i + 21, dayB, i === 0 ? { recap: { day: dayA, text: "Day A, told." } } : {}));
const feed = {
  ok: true,
  at: hoursB.at(-1).at,
  step: 30,
  nextAt: null,
  relationships: [{ a: "rusty", b: "fizz", kind: "friend", note: "Fixture friends." }],
  recent: [...hoursA, ...hoursB].slice(-12),
  days: [dayB, dayA],
  remarks: [{ issue: 1, title: "A fixture", who: "rusty", text: "Shipped.", at: hoursB[0].at }],
  spend: { month: "2026-10", budget: 6, usd: 0.25, tokensIn: 100, tokensOut: 10, calls: 3, scripted: 27 },
  claude: false,
  story: { month: "2026-10", budget: 5, gemini: true, usd: 0.02, calls: 1, stories: 1, tokensIn: 5, tokensOut: 50, scriptUsd: 0.001 },
};
// Day B as read a moment later: an hour that stepped after the feed (step 31) must not come across.
const pages = [
  { day: dayA, entries: hoursA, recap: "Day A, told." },
  { day: dayB, entries: [...hoursB, hour(31, dayB)], recap: null },
];
const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const stories = [{ view: { day: dayA, ready: true, script: "Fixture story.", durationSec: 12.5, partial: false, writer: "claude", stale: false, at: "2026-10-21T06:00:00.000Z", audio: "/api/day-story?day=2026-10-20&audio=1" }, wav }];
const weeks = [{ view: { week: "2026-10-19", ready: true, script: "Fixture week.", durationSec: 0, writer: "chronicle", at: "2026-10-21T07:00:00.000Z", audio: null }, wav: null }];

const asFiles = (files) => new Map(files.map(({ name, data }) => [name, typeof data === "string" ? JSON.parse(data) : data]));

/** The Azure store's own code over the seed's files (as uploaded into ceo-state). */
function storeOver(files) {
  const map = new Map(files.map(({ name, data }) => [name, typeof data === "string" ? new TextEncoder().encode(data) : data]));
  let version = 0;
  const etags = new Map([...map.keys()].map((k) => [k, `"${++version}"`]));
  return {
    map,
    backend: {
      kind: "azureblob",
      async get(path) {
        const body = map.get(path);
        return body ? { stream: new Blob([body]).stream(), etag: etags.get(path), contentType: "" } : null;
      },
      async etag(path) {
        return map.has(path) ? etags.get(path) : null;
      },
      async put(path, body, opts) {
        if (opts.ifMatch && etags.get(path) !== opts.ifMatch) throw new Error("changed");
        map.set(path, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
        etags.set(path, `"${++version}"`);
        return { pathname: path };
      },
      async del(path) {
        map.delete(path);
      },
    },
  };
}

describe("the public seed", () => {
  it("uses the same constants as the Azure store's code", () => {
    expect(RECENT_KEEP).toBe(API_RECENT_KEEP);
    expect(STORY_STYLE).toBe(API_STORY_STYLE);
    // Production's old stories were Gemini's readings (before #472): the seed labels them so.
    expect(TTS_MODEL).toBe("gemini-3.8-flash-tts");
    expect(TTS_VOICE).toBe("Achird");
  });

  it("names a week by its Monday", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-21")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });

  it("rebuilds the state the hourly step carries, up to the feed's hour", () => {
    const files = asFiles(publicSeedFiles({ feed, pages, stories, weeks }));
    const state = files.get("world/state.json");
    expect(state).toEqual({
      version: 1,
      step: 30,
      at: feed.at,
      relationships: feed.relationships,
      recent: [...hoursA, ...hoursB].slice(-24),
      days: [dayB, dayA],
      recapped: dayA,
      spend: { "2026-10": { usd: 0.25, tokensIn: 100, tokensOut: 10, calls: 3, scripted: 27 } },
      remarks: feed.remarks,
    });
    expect(files.get(`world/days/${dayA}.json`)).toEqual({ day: dayA, entries: hoursA, recap: "Day A, told." });
    expect(files.get(`world/days/${dayB}.json`)).toEqual({ day: dayB, entries: hoursB, recap: null });
  });

  it("keeps the stories, their audio and this month's speech ledger in the store's shape", () => {
    const files = asFiles(publicSeedFiles({ feed, pages, stories, weeks }));
    expect(files.get(`world/stories/${dayA}.wav`)).toEqual(wav);
    expect(files.get(`world/stories/${dayA}.json`)).toEqual({
      day: dayA, script: "Fixture story.", partial: false, writer: "claude", style: STORY_STYLE, durationSec: 12.5, bytes: wav.byteLength,
      model: TTS_MODEL, voice: TTS_VOICE, at: "2026-10-21T06:00:00.000Z", cost: { usd: 0, tokensIn: 0, tokensOut: 0 }, scriptUsd: 0,
    });
    expect(files.get("world/stories/week-2026-10-19.json")).toMatchObject({ week: "2026-10-19", audio: false, bytes: 0, model: null, voice: null });
    expect(files.has("world/stories/week-2026-10-19.wav")).toBe(false);
    expect(files.get("world/stories/spend.json")).toEqual({ "2026-10": { usd: 0.02, tokensIn: 5, tokensOut: 50, calls: 1, stories: 1, scriptUsd: 0.001 } });
    for (const name of files.keys()) expect(seedTarget(root, name)).toBe(join(root, name));
  });

  it("refuses a feed with no world, or hours that stop short", () => {
    expect(() => publicSeedFiles({ feed: { error: "not-set-up" } })).toThrow();
    expect(() => publicSeedFiles({ feed: { ...feed, step: 0, at: null } })).toThrow();
    expect(() => publicSeedFiles({ feed: { ...feed, step: 40 }, pages })).toThrow(/stop before step 40/);
  });

  it("lets the Azure world carry on from production's: the next hour is 31 and it tells the day that ended", async () => {
    const { backend, map } = storeOver(publicSeedFiles({ feed, pages, stories, weeks }));
    const store = new BlobStore(backend);
    const now = Date.parse("2026-10-22T14:00:00.000Z");
    const result = await runStep({ store, now, readFeed: async () => ({ issues: [], comments: [], runs: [] }), ask: null });
    expect(result.stepped).toBe(true);
    expect(result.entry.step).toBe(31);
    expect(result.entry.recap?.day).toBe(dayB);
    const state = await store.loadState();
    expect(state.recent).toHaveLength(24);
    expect(state.recapped).toBe(dayB);
    expect(state.spend["2026-10"].scripted).toBe(28);
    expect((await store.readDay(dayB)).recap).toBe(result.entry.recap.text);
    expect(map.has("world/days/2026-10-22.json")).toBe(true);
    const story = await new BlobStoryStore(backend).readStory(dayA);
    expect(story?.bytes).toBe(wav.byteLength);
  });
});
