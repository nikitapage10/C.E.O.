import { ACTIVITIES, ROOMS, ROOM_IDS, type Activity, type Place } from "@ceo/core";
import { describe, expect, it } from "vitest";
import type { Crate } from "../foundry.ts";
import { briefPitch, crateCard, recordCard, spanText } from "./taskCard.ts";
import { TASK_LINE_MAX, onTask, shorten, stationPhrase, taskLine, tidyTitle } from "./taskLine.ts";

describe("a real job on the task line", () => {
  const job = { title: "#43 Lattice: speed up the first load of the world", status: "running", number: 43, short: "Speeding up the Lattice" };

  it("says what's being built in a few words: the issue number and its short line", () => {
    expect(onTask(job)).toBe("#43 · Speeding up the Lattice");
    expect(line("working", at("foundry", "assembler"), { task: job })).toEqual({ icon: "work", text: "#43 · Speeding up the Lattice" });
  });

  it("replaces a line that would only say where they stand", () => {
    // Without the job these say "Building at the assembly arm", "Fine work at the bench", "Waiting at the dock…".
    expect(line("working", at("foundry", "assembler"), { task: job }).text).not.toMatch(/assembly arm/);
    expect(line("typing", at("foundry", "bench-a"), { task: job }).text).toBe("#43 · Speeding up the Lattice");
    expect(line("waiting", at("foundry", "shipping"), { task: job }).text).toBe("#43 · Speeding up the Lattice");
    expect(line("idle", at("foundry", "drafting"), { task: job }).text).toBe("#43 · Speeding up the Lattice");
    expect(line("carrying", at("foundry", "assembler"), { task: job, prop: "crate" }).text).toBe("#43 · Speeding up the Lattice");
  });

  it("falls back to the trimmed title without a short line", () => {
    expect(onTask({ ...job, short: "" })).toBe("#43 Lattice: speed up the first load…");
    expect(onTask({ ...job, short: undefined, title: "#33 Idea: show each agent's current task on the Lattice" })).toBe("#33 Show each agent's current task…");
  });

  it("says what they're stuck on in the short line's words", () => {
    expect(line("slumped", at("foundry", "furnace"), { task: job }).text).toBe("Stuck on speeding up the Lattice");
  });

  it("stays short even with a long short line", () => {
    expect(onTask({ ...job, number: 1234, short: "Rebuilding every single room of the whole Lattice" })!.length).toBeLessThanOrEqual(TASK_LINE_MAX);
  });
});

describe("the task card", () => {
  const NOW = Date.parse("2026-10-13T12:00:00Z");
  const crate: Crate = {
    number: 49,
    title: "Lattice: hover an agent's task line to see what they're really working on",
    kind: "chat",
    state: "working",
    rung: null,
    url: "https://github.com/nikitapage10/C.E.O./issues/49",
    updatedAt: NOW,
    createdAt: NOW - (2 * 60 + 14) * 60_000,
    pitch: "Hovering the task line opens a small card with the detail. For room demo work, a note that it's a drill. Lines that only say where an agent is pick up the real job.",
    size: "small",
    short: "Explaining agents' tasks",
    revising: false,
    builder: "tessellate",
    model: "Opus",
  };

  it("shows real work's issue, pitch, builder and model, how long it has been going, and the link", () => {
    expect(crateCard(crate, "tessellate", { now: NOW })).toEqual({
      kind: "real",
      number: 49,
      title: "Lattice: hover an agent's task line to see what they're really working on",
      pitch: "Hovering the task line opens a small card with the detail. For room demo work, a note that it's a drill.",
      builder: "Rusty · Opus",
      hands: null,
      status: "Going for 2 h 14 min",
      url: "https://github.com/nikitapage10/C.E.O./issues/49",
    });
  });

  it("names the dock crew member whose hands are on it, and falls back to the holder's usual model", () => {
    const card = crateCard({ ...crate, builder: null, model: null }, "tessellate", { now: NOW, hands: "Dusty" });
    expect(card).toMatchObject({ builder: "Rusty · Sonnet", hands: "Dusty" });
    expect(crateCard({ ...crate, builder: null, model: null, kind: "fix", rung: 1 }, "semicolon", { now: NOW })).toMatchObject({ builder: "Rivet · Haiku" });
  });

  it("says where a job stands when it isn't simply going", () => {
    const status = (over: Partial<Crate>, waiting = false) => (crateCard({ ...crate, ...over }, "tessellate", { now: NOW, waiting }) as { status: string }).status;
    expect(status({ state: "stuck" })).toBe("Stuck: needs you");
    expect(status({ state: "ready" })).toBe("Checked, waiting for your OK");
    expect(status({ paused: true })).toBe("Paused for a fix");
    expect(status({}, true)).toBe("Waiting its turn");
    expect(status({ state: "shipped", closedAt: NOW - 3 * 3_600_000 })).toBe("Shipped 3 h ago");
    expect(status({ createdAt: NOW - 20_000 })).toBe("Just started");
  });

  it("calls a demo room's work a drill, and real work with no issue live", () => {
    expect(recordCard({ title: "Reconcile store orders", status: "running" })).toEqual({ kind: "drill", title: "Reconcile store orders" });
    expect(recordCard({ title: "Checks on main", status: "running", live: true })).toEqual({ kind: "live", title: "Checks on main" });
    expect(recordCard({ title: "Done", status: "success" })).toBeNull();
    expect(recordCard(undefined)).toBeNull();
  });

  it("keeps the pitch to a sentence or two", () => {
    expect(briefPitch("One. Two. Three.")).toBe("One. Two.");
    expect(briefPitch(`${"A long first sentence that goes on and on about what it does for Nikita in the room".repeat(1)}. Then a second one.`)).toBe("A long first sentence that goes on and on about what it does for Nikita in the room. Then a second one.");
    expect(briefPitch("word ".repeat(80)).length).toBeLessThanOrEqual(190);
    expect(briefPitch("")).toBe("");
  });

  it("reads spans of time plainly", () => {
    expect(spanText(10_000)).toBe("just now");
    expect(spanText(12 * 60_000)).toBe("12 min");
    expect(spanText(2 * 3_600_000)).toBe("2 h");
    expect(spanText(26 * 3_600_000)).toBe("a day");
    expect(spanText(80 * 3_600_000)).toBe("3 days");
  });
});

const at = (room: Place["room"], station: string): Place => ({ room, station });
const line = (activity: Activity, place: Place, extra: Partial<Parameters<typeof taskLine>[0]> = {}) => taskLine({ activity, place, prop: null, ...extra });

describe("task line", () => {
  it("a running task's title says what they're on, tidied and with the issue number kept", () => {
    const task = { title: "#33 Idea: show each agent's current task on the Lattice", status: "running" };
    expect(line("working", at("foundry", "assembler"), { task })).toEqual({ icon: "work", text: "#33 Show each agent's current task…" });
    expect(line("walking", at("foundry", "furnace"), { task }).icon).toBe("walk");
    expect(line("carrying", at("foundry", "assembler"), { task, prop: "crate" })).toMatchObject({ icon: "carry", text: expect.stringMatching(/^#33 Show/) });
  });

  it("a finished task no longer shows", () => {
    const task = { title: "Reconcile store orders", status: "success" };
    expect(line("working", at("spire", "desk-1"), { task })).toEqual({ icon: "write", text: "Working the books" });
  });

  it("without a task, the station says what the work is", () => {
    expect(line("working", at("foundry", "furnace"))).toEqual({ icon: "work", text: "Testing in the furnace" });
    expect(line("idle", at("foundry", "watch"))).toEqual({ icon: "look", text: "Keeping watch" });
    expect(line("working", at("foundry", "drafting"))).toEqual({ icon: "read", text: "Studying the plan" });
    expect(line("typing", at("relay", "draft-desk"))).toEqual({ icon: "write", text: "Drafting a reply" });
    expect(line("working", at("breakroom", "decks"))).toEqual({ icon: "music", text: "Spinning the decks" });
    expect(line("waiting", at("foundry", "shipping"))).toEqual({ icon: "wait", text: "Waiting at the dock for your OK" });
  });

  it("moving says where they're heading, and with what", () => {
    expect(line("walking", at("breakroom", "bar"))).toEqual({ icon: "walk", text: "Heading to the bar" });
    expect(line("carrying", at("foundry", "assembler"), { prop: "crate" })).toEqual({ icon: "carry", text: "Carrying a crate to the assembly arm" });
  });

  it("naps, slumps and wins say so over any task", () => {
    const task = { title: "#12 Fix: furnace runs cold", status: "running" };
    expect(line("napping", at("breakroom", "server-rack"), { task })).toEqual({ icon: "nap", text: "Napping" });
    expect(line("slumped", at("foundry", "furnace"), { task })).toEqual({ icon: "stuck", text: "Stuck on Furnace runs cold" });
    expect(line("slumped", at("foundry", "furnace"))).toEqual({ icon: "stuck", text: "Stuck: needs a hand" });
    expect(line("celebrating", at("green", "huddle"))).toEqual({ icon: "cheer", text: "Celebrating a win" });
  });

  it("a room lead at the conductor's post watches over the room", () => {
    expect(line("waiting", at("foundry", "post"))).toEqual({ icon: "look", text: "Watching over the room" });
    expect(line("working", at("archive", "post"))).toEqual({ icon: "look", text: "Conducting the room" });
    expect(line("walking", at("spire", "post")).text).toBe("Heading to the Spire's post");
    expect(line("walking", at("foundry", "command")).text).toBe("Coming out to give orders");
    expect(line("working", at("foundry", "command")).text).toBe("Giving orders");
  });

  it("every activity at every station gives a short line", () => {
    for (const room of ROOM_IDS)
      for (const st of ROOMS[room].stations)
        for (const activity of ACTIVITIES) {
          const l = line(activity, at(room, st.id), { prop: "mug" });
          expect(l.text.length, `${room}/${st.id} ${activity}`).toBeGreaterThan(0);
          expect(l.text.length, `${room}/${st.id} ${activity}: ${l.text}`).toBeLessThanOrEqual(TASK_LINE_MAX);
          expect(l.text, `${room}/${st.id} ${activity}`).not.toMatch(/\(|undefined/);
        }
  });
});

describe("task line helpers", () => {
  it("station labels read in a sentence", () => {
    expect(stationPhrase(at("foundry", "intake"))).toBe("the crate intake");
    expect(stationPhrase(at("breakroom", "server-rack"))).toBe("the server rack");
    expect(stationPhrase(at("spire", "desk-2"))).toBe("desk 2");
    expect(stationPhrase(at("boiler", "pipes"))).toBe("the pipe wall");
    expect(stationPhrase(at("foundry", "nowhere"))).toBe("their spot");
  });

  it("long lines are cut at a word", () => {
    expect(shorten("short")).toBe("short");
    const s = shorten("Subminds' thrones levitate high in the back-right corner of the room");
    expect(s.length).toBeLessThanOrEqual(TASK_LINE_MAX);
    expect(s).toBe("Subminds' thrones levitate high in…");
  });

  it("lane prefixes drop from titles", () => {
    expect(tidyTitle("#30 Idea: a podium for the submind")).toBe("#30 A podium for the submind");
    expect(tidyTitle("Foundry: check the queue")).toBe("Check the queue");
    expect(tidyTitle("Checks on main")).toBe("Checks on main");
  });
});
