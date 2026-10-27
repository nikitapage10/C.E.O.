import { LIVE_ROOMS } from "@ceo/simulator";
import { describe, expect, it } from "vitest";
import { ROOM_ABOUT } from "./about.ts";

const DEMO_WORDING = [/simulated/i, /nothing is connected/i, /\bdemo\b/i, /\?boiler=demo/i];

describe("live rooms' about text", () => {
  it("covers every live room", () => {
    for (const room of LIVE_ROOMS) expect(ROOM_ABOUT[room], room).toBeDefined();
  });

  for (const room of LIVE_ROOMS) {
    it(`${room} does not describe itself as a demo`, () => {
      const about = ROOM_ABOUT[room];
      const texts = [about.blurb, about.today, about.next, ...Object.values(about.stations)];
      for (const text of texts) for (const bad of DEMO_WORDING) expect(text, `${room}: ${bad}`).not.toMatch(bad);
    });
  }
});
