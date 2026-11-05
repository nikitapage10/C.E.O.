import { describe, expect, it } from "vitest";
import { matchVacuumRooms, roomWords } from "./vacuumMatch.ts";

/** Plan rooms to the vacuum's own room names (#894), from made-up houses: never the real plan. */

const room = (id: string, name: string, vacuum: string | null = null) => ({
  id,
  name,
  vacuum,
});
const asObject = (m: Map<string, string>) => Object.fromEntries(m);

describe("room words", () => {
  it("fold synonyms and drop filler", () => {
    expect(roomWords("Master Bathroom")).toEqual(["master", "bath"]);
    expect(roomWords("master bath")).toEqual(["master", "bath"]);
    expect(roomWords("Dining room")).toEqual(["dining"]);
    expect(roomWords("Primary Bedroom")).toEqual(["master", "bed"]);
    expect(roomWords("Kid's  Room!")).toEqual(["kids"]);
  });
});

describe("matching plan rooms to the vacuum's rooms", () => {
  it("matches short plan names to the vacuum's longer ones", () => {
    const names = ["Hall", "Kitchen", "Owner Bathroom", "Owner Closet", "Visitor Bathroom", "Dining room", "Den Room"];
    const plan = [room("a", "Hall"), room("b", "kitchen"), room("c", "Owner bath"), room("d", "Closet"), room("e", "Visitor bath"), room("f", "Dining"), room("g", "Den"), room("h", "Porch")];
    expect(asObject(matchVacuumRooms(names, plan))).toEqual({
      a: "Hall",
      b: "Kitchen",
      c: "Owner Bathroom",
      d: "Owner Closet",
      e: "Visitor Bathroom",
      f: "Dining room",
      g: "Den Room",
    });
  });

  it("leaves a loose match alone when it isn't the only one", () => {
    const names = ["Blue Bedroom", "Green Bedroom"];
    expect(matchVacuumRooms(names, [room("a", "Bedroom")]).size).toBe(0);
    // Two plan rooms that both fit one name: neither takes it.
    expect(matchVacuumRooms(["Upper Closet"], [room("a", "Closet"), room("b", "Upper closet space")]).get("b")).toBeUndefined();
  });

  it("settles an exact pair first, so the leftover loose pair becomes unique", () => {
    const names = ["Closet", "Owner Closet"];
    const plan = [room("a", "Closet"), room("b", "Owner closet")];
    expect(asObject(matchVacuumRooms(names, plan))).toEqual({
      a: "Closet",
      b: "Owner Closet",
    });
    const plan2 = [room("a", "Closet"), room("b", "Owner")];
    expect(asObject(matchVacuumRooms(["Closet", "Owner Closet"], plan2))).toEqual({ a: "Closet", b: "Owner Closet" });
  });

  it("keeps an explicit vacuum name, and doesn't guess for a room whose name isn't on the vacuum", () => {
    const names = ["Zone 7", "Study"];
    const plan = [room("a", "Study", "zone 7"), room("b", "Office", "Missing"), room("c", "Reading")];
    expect(asObject(matchVacuumRooms(names, plan))).toEqual({ a: "Zone 7" });
  });

  it("never hands one vacuum room to two plan rooms", () => {
    const m = matchVacuumRooms(["Bath"], [room("a", "Bath"), room("b", "Bathroom")]);
    expect([...m.values()]).toEqual(["Bath"]);
  });
});
