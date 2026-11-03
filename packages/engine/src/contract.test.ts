import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINEAGE_IDS, ROOM_IDS, type RoomId } from "@ceo/core";
import { LIVE_ROOMS } from "@ceo/simulator";
import { PATHS, ROOM_ROUTES } from "../../../apps/world/src/route.ts";
import { ENGINE_ENDPOINTS, ENGINE_KEYS, KERNEL_LEAD, RoomManifestSchema, type RoomManifest } from "./manifest.ts";
import { AGENT_QUIPS, HOUSES, LORE, ROOM_QUIPS, SAMPLE_AGENTS, SKIPPY_LORE, SKIPPY_QUIPS, SUBMINDS, defaultCast } from "./lore.ts";
import { REPO_ROOT, azureEndpoints, cssTokens, headingsOf, readRepoFile, secretSettings } from "./testing.ts";

/**
 * The room contract (#617, docs/ROOMS.md), as tests. Each room's manifest (rooms/<id>/room.ts) is held to the schema,
 * to the site's real routes and nav order, to the live list and the subminds, to the Azure wiring and the Key Vault,
 * and to the world's lore (CLAUDE.md's lore rule, as a failing test).
 *
 * Gaps that are real today are named in KNOWN_GAPS and show as todos. Each room's migration PR closes its own: when a
 * gap's check starts passing, its test fails until the name is taken off the list, so the list only ever shrinks.
 */
const KNOWN_GAPS = new Set<string>([
  // Rooms with a real API whose submind is still simulated (CLAUDE.md, "Real agents").
  "spire: a room with a real integration is live, with its submind active",
  "archive: a room with a real integration is live, with its submind active",
  // Integrations the threat model doesn't name yet (docs/THREAT-MODEL.md).
  "relay: every integration is in THREAT-MODEL.md",
  "spire: every integration is in THREAT-MODEL.md",
  "exchange: every integration is in THREAT-MODEL.md",
  "green: every integration is in THREAT-MODEL.md",
  // A key with no threat-model id (the Studio's OpenAI key is set, its line isn't built).
  "studio: a room that holds keys or endpoints has a threat-model id",
  // Rooms whose lore lives only in the cast table, with no section of their own in lore/syntherion.md.
  "foundry: its lore section is its own",
  "exchange: its lore section is its own",
  "green: its lore section is its own",
]);

/** A contract check: a test, or a todo while it is a known gap; a known gap that passes fails until it's taken off. */
const CHECKS = new Set<string>();
function check(name: string, fn: () => void) {
  CHECKS.add(name);
  if (!KNOWN_GAPS.has(name)) return it(name, fn);
  let passes = true;
  try {
    fn();
  } catch {
    passes = false;
  }
  if (passes) it(name, () => expect.fail(`"${name}" passes now: take it off KNOWN_GAPS in contract.test.ts`));
  else it.todo(name);
}

const EXPECTED = ["today", "relay", "foundry", "boiler", "archive", "spire", "exchange", "green", "workshop", "studio"];
const roomDirs = readdirSync(REPO_ROOT + "rooms", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const manifests: RoomManifest[] = await Promise.all(
  roomDirs.map(async (dir) => (await import(`../../../rooms/${dir}/room.ts`)).default as RoomManifest),
);
const byId = new Map(manifests.map((m) => [m.id, m]));

/** The Desk's key order: Today, Foundry, Relay, then the rooms (apps/world/src/desk/DeskNav.tsx, KEY_ORDER). */
const KEY_ORDER = ["today", "foundry", "relay", ...ROOM_ROUTES];
const NAV_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
/** The Desk bar's labels (MAIN_TABS and ROOM_TABS in DeskNav.tsx, read as text so the test loads no React). */
const deskNav = readRepoFile("apps/world/src/desk/DeskNav.tsx") ?? "";
const tabLabel = (id: string) => deskNav.match(new RegExp(`(?:id: "${id}", |\\b${id}: \\{ )label: "([^"]+)"`))?.[1];

const isRoomId = (id: string): id is RoomId => (ROOM_IDS as readonly string[]).includes(id);
const threatModel = readRepoFile("docs/THREAT-MODEL.md");
const loreHeadings = headingsOf(readRepoFile("lore/syntherion.md") ?? "");
const deskTokens = cssTokens("apps/world/src/desk/desk.css");
const cast = defaultCast();
const endpoints = azureEndpoints();
const settings = secretSettings();

describe("the room manifests", () => {
  it("there is one for each of the ten rooms, in rooms/<id>/room.ts", () => {
    expect(roomDirs).toEqual([...EXPECTED].sort());
    for (const dir of roomDirs) expect(byId.get(dir)?.id, `rooms/${dir}/room.ts`).toBe(dir);
  });

  it("each passes the schema", () => {
    for (const m of manifests) expect(RoomManifestSchema.safeParse(m).success, m.id).toBe(true);
  });

  it("ids, paths, nav keys and keys are unique", () => {
    const unique = (xs: string[]) => expect(new Set(xs).size, xs.join(", ")).toBe(xs.length);
    unique(manifests.map((m) => m.id));
    unique(manifests.map((m) => m.path));
    unique(manifests.map((m) => m.navKey));
    unique(manifests.flatMap((m) => m.keys));
    unique(manifests.flatMap((m) => Object.keys(m.auth)));
  });

  it("paths match the site's routes (route.ts PATHS)", () => {
    for (const m of manifests) expect(m.path, m.id).toBe(PATHS[m.id as keyof typeof PATHS]);
    const routes = Object.keys(PATHS).filter((r) => r !== "lattice");
    expect(manifests.map((m) => m.id).sort()).toEqual(routes.sort());
  });

  it("nav keys follow the Desk's key order, and names its labels (DeskNav.tsx)", () => {
    expect(KEY_ORDER).toHaveLength(NAV_KEYS.length);
    KEY_ORDER.forEach((id, i) => expect(byId.get(id)?.navKey, id).toBe(NAV_KEYS[i]));
    for (const m of manifests) expect(m.name, m.id).toBe(tabLabel(m.id));
  });

  it("each room past Today, the Foundry and Relay is one of the Desk's room tabs (ROOM_TABS)", () => {
    const tabs = manifests.filter((m) => !["today", "foundry", "relay"].includes(m.id)).map((m) => m.id);
    expect(tabs.sort()).toEqual([...ROOM_ROUTES].sort());
  });

  it("each accent is a colour token the Desk defines (desk.css)", () => {
    for (const m of manifests) expect(deskTokens.has(m.accent), `${m.id}: ${m.accent}`).toBe(true);
  });

  it("live matches LIVE_ROOMS, and Today, the Kernel's page, is live", () => {
    for (const m of manifests) expect(m.live, m.id).toBe(isRoomId(m.id) ? LIVE_ROOMS.has(m.id) : true);
    for (const room of LIVE_ROOMS) expect(byId.get(room)?.live, room).toBe(true);
  });

  it("every Azure endpoint belongs to exactly one room or the engine (azure/src/index.ts)", () => {
    expect(endpoints.length).toBeGreaterThan(20);
    const owned = [...ENGINE_ENDPOINTS, ...manifests.flatMap((m) => Object.keys(m.auth))];
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual([...endpoints].sort());
  });

  it("every secret setting belongs to exactly one room or the engine (azure/src/env.ts)", () => {
    expect(settings.length).toBeGreaterThan(10);
    const owned = [...ENGINE_KEYS, ...manifests.flatMap((m) => m.keys)];
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual([...settings].sort());
  });
});

describe("the room contract, room by room", () => {
  for (const m of manifests) {
    describe(m.id, () => {
      check(`${m.id}: its submind exists and leads this room`, () => {
        expect(m.lore.submind).toBe(m.submind);
        if (!isRoomId(m.id)) return expect(m.submind).toBe(KERNEL_LEAD);
        const sub = SUBMINDS.find((s) => s.id === m.submind);
        expect(sub, m.submind).toBeDefined();
        expect(sub!.room).toBe(m.id);
      });

      check(`${m.id}: its submind is active exactly when the room is live`, () => {
        if (!isRoomId(m.id)) return expect(m.live).toBe(true);
        expect(SUBMINDS.find((s) => s.id === m.submind)?.active).toBe(m.live);
      });

      check(`${m.id}: a live room lists at least one real integration`, () => {
        if (m.live) expect(m.purpose.agents.length).toBeGreaterThan(0);
      });

      check(`${m.id}: a room with a real integration is live, with its submind active`, () => {
        if (m.purpose.agents.length > 0) expect(m.live).toBe(true);
      });

      check(`${m.id}: its purpose has a goal, its integrations and a measure`, () => {
        expect(m.purpose.goal.length).toBeLessThanOrEqual(200);
        expect(m.purpose.goal).toMatch(/\.$/);
        expect(m.purpose.measure.length).toBeGreaterThan(2);
      });

      check(`${m.id}: its agents are the ones who work there`, () => {
        if (!isRoomId(m.id)) return expect(m.lore.agents).toEqual([]);
        const home = SAMPLE_AGENTS.filter((a) => a.home.room === m.id && a.id !== m.submind).map((a) => a.id);
        expect([...m.lore.agents].sort()).toEqual(home.sort());
      });

      check(`${m.id}: its houses are real, and its agents' own`, () => {
        for (const h of m.lore.house) expect(HOUSES[h], h).toBeDefined();
        const lineages = new Set(m.lore.agents.map((id) => SAMPLE_AGENTS.find((a) => a.id === id)?.lineage));
        expect(new Set(m.lore.house)).toEqual(lineages);
        expect(m.lore.house.every((h) => (LINEAGE_IDS as readonly string[]).includes(h))).toBe(true);
      });

      check(`${m.id}: its lore section is in lore/syntherion.md`, () => {
        expect(loreHeadings).toContain(m.lore.section);
      });

      check(`${m.id}: its lore section is its own`, () => {
        const sharing = manifests.filter((o) => o.lore.section === m.lore.section).map((o) => o.id);
        expect(sharing).toEqual([m.id]);
      });

      check(`${m.id}: its flavour pool has at least 3 lines`, () => {
        const pool = m.lore.lines === "skippy" ? SKIPPY_QUIPS : m.lore.lines ? ROOM_QUIPS[m.lore.lines] : [];
        expect(m.lore.lines).toBeDefined();
        expect(pool.length).toBeGreaterThanOrEqual(3);
      });

      if (m.submind === KERNEL_LEAD) {
        check(`${m.id}: Skippy has his dossier and 3+ lines`, () => {
          expect(SKIPPY_LORE.origin.length).toBeGreaterThan(0);
          expect(SKIPPY_QUIPS.length).toBeGreaterThanOrEqual(3);
        });
      }

      for (const agent of isRoomId(m.id) ? [m.submind, ...m.lore.agents] : []) {
        check(`${m.id}: ${agent} has a dossier (lore.ts)`, () => {
          expect(LORE[agent]?.origin, agent).toBeTruthy();
        });
        check(`${m.id}: ${agent} has a bio and a catchphrase (cast.ts)`, () => {
          const p = cast.profiles[agent]?.personality;
          expect(p?.bio, agent).toBeTruthy();
          expect(p?.catchphrase, agent).toBeTruthy();
        });
        check(`${m.id}: ${agent} has a relationship (cast.ts)`, () => {
          expect(cast.relationships.some((r) => r.a === agent || r.b === agent), agent).toBe(true);
        });
        check(`${m.id}: ${agent} has at least 3 quips (quips.ts)`, () => {
          expect(AGENT_QUIPS[agent]?.length ?? 0, agent).toBeGreaterThanOrEqual(3);
        });
      }

      if (threatModel) {
        check(`${m.id}: its threat-model ids are in THREAT-MODEL.md`, () => {
          for (const t of m.threat) expect(threatModel, t).toMatch(new RegExp(`\\b${t}\\b`));
        });
        check(`${m.id}: a room that holds keys or endpoints has a threat-model id`, () => {
          if (m.keys.length > 0 || Object.keys(m.auth).length > 0) expect(m.threat.length).toBeGreaterThan(0);
        });
        check(`${m.id}: every integration is in THREAT-MODEL.md`, () => {
          for (const a of m.purpose.agents) expect(threatModel.includes(a.name), a.name).toBe(true);
        });
      } else {
        it.todo(`${m.id}: its threat-model ids are in THREAT-MODEL.md (no THREAT-MODEL.md yet)`);
      }
    });
  }
});

describe("the known gaps", () => {
  it("each names a check that runs", () => {
    for (const g of KNOWN_GAPS) expect(CHECKS.has(g), g).toBe(true);
  });
});
