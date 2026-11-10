import { describe, expect, it } from "vitest";
import { MemoryMemory } from "./memory.ts";
import { MemoryPending } from "./pending.ts";
import { callTool, confirmTool, toolNamed, toolsFor, type ToolHost } from "./tools.ts";

/** Skippy's lights tools (#931), on a made-up home: the lights, scene and remote here are nobody's. */

const NOW = Date.parse("2026-11-06T12:00:00Z");

function host(): ToolHost & { switched: [string, boolean][]; scenes: string[] } {
  const switched: [string, boolean][] = [];
  const scenes: string[] = [];
  const view = {
    vendors: { switchbot: "live" as const, govee: "waiting" as const },
    lights: [
      { id: "aaaaaaaaaaaa", vendor: "switchbot" as const, name: "Study", type: "Bot", on: true, online: true },
      { id: "bbbbbbbbbbbb", vendor: "switchbot" as const, name: "Porch", type: "Bot", on: false, online: true },
    ],
    scenes: [{ id: "cccccccccccc", name: "All off" }],
    remotes: [{ id: "dddddddddddd", name: "Beamer", type: "Projector" }],
  };
  const all = [...view.lights.map((x) => ({ kind: "light" as const, ...x })), ...view.remotes.map((x) => ({ kind: "remote" as const, ...x })), ...view.scenes.map((x) => ({ kind: "scene" as const, ...x }))];
  return {
    read: async () => "",
    memory: new MemoryMemory(),
    kitchenAdd: null,
    homeAct: null,
    fileIssue: null,
    skipTerms: [],
    now: NOW,
    lights: {
      view: async () => view,
      byName: async (w) => {
        const hit = all.filter((x) => x.name.toLowerCase() === w.toLowerCase().replace(/^the /, ""));
        return hit.length === 1 ? { kind: hit[0]!.kind, id: hit[0]!.id, name: hit[0]!.name } : null;
      },
      set: async (id, on) => (switched.push([id, on]), { ok: true, say: "Done." }),
      scene: async (id) => (scenes.push(id), { ok: true, say: "Done." }),
    },
    switched,
    scenes,
  };
}

describe("Skippy's lights tools (#931)", () => {
  it("reads the lights on every surface, and switches only on the Desk after a Yes", async () => {
    expect(toolsFor("spoken").map((t) => t.name)).toEqual(expect.arrayContaining(["lights_list", "lights_set", "lights_scene"]));
    expect(toolNamed("lights_set")?.confirm).toBe(true);
    expect(toolNamed("lights_scene")?.confirm).toBe(true);
    const h = host();
    const list = await callTool("lights_list", {}, h, { pending: null, surface: "spoken" });
    expect(list).toMatchObject({ ok: true, text: expect.stringMatching(/Study \(SwitchBot Bot\) on; Porch \(SwitchBot Bot\) off.*All off.*Beamer \(Projector\)/) });
    expect(list.ok && "text" in list ? list.text : "").not.toMatch(/aaaa|cccc/);
    // Said out loud, even in Nikita's own words, a switch waits for his Yes on the Desk.
    expect(await callTool("lights_set", { name: "Study", on: false }, h, { pending: new MemoryPending(), surface: "spoken", said: "turn the study light off", via: "phone" })).toMatchObject({ ok: false, text: expect.stringMatching(/Yes tap/) });
    expect(await callTool("lights_scene", { name: "All off" }, h, { pending: new MemoryPending(), surface: "spoken", said: "all off" })).toMatchObject({ ok: false });
    expect(h.switched).toEqual([]);
  });

  it("asks before switching a light or the projector, then does exactly that", async () => {
    const h = host();
    const pending = new MemoryPending();
    const got = await callTool("lights_set", { name: "Study", on: false }, h, { pending, surface: "desk" });
    expect(got).toMatchObject({ ok: true, confirm: { label: "Turn it off", summary: "Turn Study off" } });
    expect(h.switched).toEqual([]);
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    expect(await confirmTool(id, true, h, pending)).toMatchObject({ ok: true, did: "Study off" });
    expect(h.switched).toEqual([["aaaaaaaaaaaa", false]]);
    const beam = await callTool("lights_set", { name: "Beamer", on: true }, h, { pending, surface: "desk" });
    await confirmTool(beam.ok && "confirm" in beam ? beam.confirm.id : "", true, h, pending);
    expect(h.switched.at(-1)).toEqual(["dddddddddddd", true]);
  });

  it("runs a scene by its name after a Yes, and won't take a scene as a light or a name it doesn't know", async () => {
    const h = host();
    const pending = new MemoryPending();
    const got = await callTool("lights_scene", { name: "All off" }, h, { pending, surface: "desk" });
    await confirmTool(got.ok && "confirm" in got ? got.confirm.id : "", true, h, pending);
    expect(h.scenes).toEqual(["cccccccccccc"]);
    expect(await callTool("lights_set", { name: "All off", on: false }, h, { pending, surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("lights_set", { name: "Garage", on: true }, h, { pending, surface: "desk" })).toMatchObject({ ok: false, text: expect.stringMatching(/lights_list/) });
    expect(await callTool("lights_scene", { name: "Study" }, h, { pending, surface: "desk" })).toMatchObject({ ok: false });
  });

  it("puts a light on the map by room and corner, or by x and y, without a tap, and never a scene (#974)", async () => {
    const placed: [string, unknown][] = [];
    const h = { ...host(), placeLight: async (name: string, at: unknown) => (placed.push([name, at]), { ok: true, say: `${name} is on the map.` }) };
    expect(toolNamed("lights_place")?.confirm).toBeFalsy();
    expect(await callTool("lights_place", { name: "the study", room: "Study", where: "sw" }, h, { pending: null, surface: "spoken" })).toMatchObject({ ok: true, text: "Study is on the map." });
    expect(await callTool("lights_place", { name: "Porch", x: 120, y: 40 }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: true });
    expect(await callTool("lights_place", { name: "Porch", clear: true }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: true });
    expect(placed).toEqual([["Study", { room: "Study", where: "sw" }], ["Porch", { x: 120, y: 40 }], ["Porch", null]]);
    expect(await callTool("lights_place", { name: "All off", room: "Study" }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false, text: expect.stringMatching(/scene/) });
    expect(await callTool("lights_place", { name: "Garage", room: "Study" }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("lights_place", { name: "Porch" }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false });
    expect(placed.length).toBe(3);
  });

  it("says so when the lights aren't set up", async () => {
    const h = { ...host(), lights: null };
    expect(await callTool("lights_list", {}, h, { pending: null, surface: "desk" })).toMatchObject({ ok: true, text: expect.stringMatching(/aren't set up/) });
  });
});
