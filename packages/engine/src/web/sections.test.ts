import { describe, expect, it } from "vitest";
import { sectionOf, sectionTitle, type RoomSection } from "./sections.ts";

const S: RoomSection[] = [
  { id: "front", label: "Front", path: "/room", hint: "The front page" },
  { id: "deep", label: "Deep", path: "/room/deep", hint: "Further in" },
];

describe("a room's sub-menu", () => {
  it("opens the section a path names, or the front page", () => {
    expect(sectionOf(S, "/room").id).toBe("front");
    expect(sectionOf(S, "/room/").id).toBe("front");
    expect(sectionOf(S, "/room/deep").id).toBe("deep");
    expect(sectionOf(S, "/room/deep/").id).toBe("deep");
    expect(sectionOf(S, "/room/unknown").id).toBe("front");
    // An old spelling of the room's address still finds the section by its second part.
    expect(sectionOf(S, "/old/deep").id).toBe("deep");
  });

  it("names the tab by the room on its front page and by the section past it", () => {
    expect(sectionTitle("Room", S, "/room")).toBe("Room · C.E.O.");
    expect(sectionTitle("Room", S, "/room/deep")).toBe("Deep · Room · C.E.O.");
  });
});
