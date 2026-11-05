import { describe, expect, it } from "vitest";
import { annexPulse, COUNCIL_RC, havenPulse } from "./deskPulses.ts";
import { memberLive } from "./live.ts";

const NOW = Date.parse("2026-11-04T12:00:00");
const vendors = { roborock: "live", petlibro: "live", whisker: "live", nest: "waiting" } as const;
const links = { tasks: "waiting", kroger: "waiting" } as const;

describe("the Desk's own subminds on the Council", () => {
  it("seats the Steward and the Stagehand with their colours", () => {
    for (const id of ["haven", "annex"]) expect(COUNCIL_RC[id]).toMatch(/^\d+,\d+,\d+$/);
    expect(havenPulse("idle", null).submind.title).toBe("The Steward");
    expect(annexPulse("idle", { elections: "live" }, NOW).submind.title).toBe("The Stagehand");
  });

  it("lights the Steward only while a device is at work or one is down", () => {
    const quiet = havenPulse("live", { vendors, links, devices: [{ kind: "vacuum", state: "docked", online: true }, { kind: "fountain", state: "running", online: true }] });
    expect(quiet.state).toBe("steady");
    expect(memberLive(quiet, NOW)).toBe(0);
    const cleaning = havenPulse("live", { vendors, links, devices: [{ kind: "vacuum", state: "cleaning", online: true }] });
    expect(cleaning.state).toBe("busy");
    expect(cleaning.status).toBe("The vacuum is cleaning");
    expect(memberLive(cleaning, NOW)).toBe(1);
    expect(havenPulse("live", { vendors: { ...vendors, whisker: "down" }, links, devices: [] }).status).toBe("Whisker isn't answering");
    expect(memberLive(havenPulse("off", null), NOW)).toBe(0);
  });

  it("lights the Stagehand while a pop-up is live, and not after its last day", () => {
    expect(memberLive(annexPulse("ready", { elections: "live" }, NOW), NOW)).toBe(1);
    expect(memberLive(annexPulse("ready", { elections: "ended" }, NOW), NOW)).toBe(0);
    const later = Date.parse("2026-11-06T12:00:00");
    expect(memberLive(annexPulse("ready", { elections: "live" }, later), later)).toBe(0);
  });
});
