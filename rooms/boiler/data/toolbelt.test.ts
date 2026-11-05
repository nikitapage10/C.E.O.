import { describe, expect, it } from "vitest";
import type { RoomTool } from "@ceo/engine/tools";
import { beltLine, kindOf, roomName, toolbelt } from "./toolbelt.ts";

/** Synthetic tools only: the shape the registry declares, none of the real rooms' prompts. */
const input = { type: "object", properties: {}, required: [], additionalProperties: false } as const;
const tool = (name: string, room: string, effect: RoomTool["effect"], confirm?: boolean): RoomTool => ({ name, room, title: `Tool ${name}`, description: "A synthetic tool for the toolbelt test.", input, effect, ...(confirm ? { confirm } : {}) });

describe("Skippy's tools on Controls (#847)", () => {
  it("sorts each tool into reads, changes or asks first, as the Yes-tap rule does", () => {
    expect(kindOf({ effect: "read" })).toBe("reads");
    expect(kindOf({ effect: "write" })).toBe("changes");
    expect(kindOf({ effect: "write", confirm: true })).toBe("asks");
    for (const effect of ["send", "spend", "delete"] as const) expect(kindOf({ effect })).toBe("asks");
  });

  it("groups by room in the registry's order and counts what the line says", () => {
    const b = toolbelt([tool("a_read", "today", "read"), tool("b_send", "foundry", "send"), tool("c_write", "today", "write"), tool("d_dev", "haven", "write", true)]);
    expect(b.rooms.map((r) => r.room)).toEqual(["today", "foundry", "haven"]);
    expect(b.rooms[0]!.tools.map((t) => t.name)).toEqual(["a_read", "c_write"]);
    expect(b).toMatchObject({ total: 4, reads: 1, changes: 1, asks: 2, spoken: 2 });
    expect(b.rooms[2]!.tools[0]).toEqual({ name: "d_dev", title: "Tool d_dev", kind: "asks", spoken: false });
    expect(beltLine(b)).toBe("4 tools in 3 rooms · 2 ask first");
  });

  it("never carries a tool's description (the model's prompt) onto the page", () => {
    const b = toolbelt([tool("a_read", "today", "read")]);
    expect(JSON.stringify(b)).not.toContain("synthetic tool");
  });

  it("reads plainly with one tool, or none plugged in", () => {
    expect(beltLine(toolbelt([tool("a_read", "boiler", "read")]))).toBe("1 tool in 1 room");
    expect(beltLine(toolbelt([tool("a_ask", "relay", "send")]))).toBe("1 tool in 1 room · 1 asks first");
    expect(beltLine(toolbelt([]))).toBe("none plugged in");
    expect(roomName("boiler")).toBe("Boiler Room");
    expect(roomName("annex")).toBe("Annex");
  });
});
