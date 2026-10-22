import { existsSync, statSync } from "node:fs";
import { defaultCast, SAMPLE_AGENTS } from "@ceo/simulator";
import { describe, expect, it } from "vitest";
import { PATHS } from "../route.ts";
import { DESK_ROOMS, roomImage } from "./deskData.ts";
import { PORTRAITS } from "./portraits.ts";
import { BANNERS, roomImage2x } from "./RoomBanner.tsx";
import { ROOM_META } from "./roomPulse.ts";
import { systemsPageOf } from "./SystemsNav.tsx";

const file = (src: string) => new URL(`../../public${src}`, import.meta.url);

describe("room banners", () => {
  it("gives every Desk page past Today, and each Boiler Room subpage, a banner from one of the Lattice's rooms", () => {
    const pages: string[] = (Object.keys(PATHS) as (keyof typeof PATHS)[]).filter((r) => r !== "today" && r !== "lattice");
    // The Boiler Room's subpages each carry the banner too.
    for (const sub of ["/boiler/security", "/boiler/compliance"]) pages.push(systemsPageOf(sub));
    expect(Object.keys(BANNERS).sort()).toEqual(pages.sort());
    for (const { room } of Object.values(BANNERS)) expect(DESK_ROOMS[room]).toBeDefined();
  });

  it("has each banner's still on disk, at 1x and 2x, and not too heavy (run scripts/desk-images.mjs --only=rooms)", () => {
    for (const { room } of Object.values(BANNERS)) {
      for (const src of [roomImage(room), roomImage2x(room)]) {
        expect(existsSync(file(src)), src).toBe(true);
        expect(statSync(file(src)).size, src).toBeLessThan(400 * 1024);
      }
    }
  });

  it("speaks in the room's voice: a keeper of that room, in their own words from the cast", () => {
    const cast = defaultCast();
    for (const { room, voice } of Object.values(BANNERS)) {
      const agent = SAMPLE_AGENTS.find((a) => a.id === voice.id);
      expect(agent, voice.id).toBeDefined();
      expect(agent!.home.room).toBe(room);
      expect(voice.line).toBe(cast.profiles[voice.id]!.personality.catchphrase);
      expect(PORTRAITS[voice.id]?.name).toBe(agent!.name);
    }
  });

  it("puts the Pessimist on the Boiler Room banner and Gary on Compliance", () => {
    expect(BANNERS.boiler.voice.id).toBe("soot");
    expect(BANNERS.compliance.voice.id).toBe("gary");
  });

  it("has a portrait on disk for every room's submind, the face on its pipe", () => {
    for (const { submind } of Object.values(ROOM_META)) expect(existsSync(file(`/desk/agent-${submind.id}.webp`)), submind.id).toBe(true);
  });
});
