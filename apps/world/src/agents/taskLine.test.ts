import { ACTIVITIES, ROOMS, ROOM_IDS, type Activity, type Place } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { TASK_LINE_MAX, shorten, stationPhrase, taskLine, tidyTitle } from "./taskLine.ts";

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
