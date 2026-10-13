import { ROOM_IDS, type RoomId } from "@ceo/core";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import bundles from "../fx/bundles.gen.json";
import { ROOM_MODELS, modelFile } from "./roomModels.ts";

const ROOMS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../rooms");
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public/models/lib");
const BUNDLES = bundles as Record<string, string>;

const FILES: Record<RoomId, string> = {
  foundry: "Foundry.tsx",
  spire: "Spire.tsx",
  exchange: "Exchange.tsx",
  green: "Green.tsx",
  relay: "Relay.tsx",
  archive: "Archive.tsx",
  breakroom: "BreakRoom.tsx",
  boiler: "BoilerRoom.tsx",
  workshop: "Workshop.tsx",
};
const EGGS: Record<RoomId, string> = {
  foundry: "FoundryEggs",
  spire: "SpireEggs",
  exchange: "ExchangeEggs",
  green: "GreenEggs",
  relay: "RelayEggs",
  archive: "ArchiveEggs",
  breakroom: "BreakRoomEggs",
  boiler: "BoilerEggs",
  workshop: "WorkshopEggs",
};

const isModel = (id: string) => id in BUNDLES || existsSync(join(LIB_DIR, `${id}.glb`));

/** Library model ids named in some source, with the shared plant when it uses one. */
function idsIn(src: string): string[] {
  const ids = [...src.matchAll(/"([a-z-]+\/[A-Za-z0-9_/]+)"/g)].map((m) => m[1]!).filter(isModel);
  if (src.includes("<Plant")) ids.push("nature/Plant_1_Big");
  return ids;
}

/** A room's file and the room files it pulls in (LongTable, Club, the Foundry's crates…). */
function roomSources(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const src = readFileSync(join(ROOMS_DIR, file), "utf8");
  const local = [...src.matchAll(/from "\.\/([A-Za-z]+\.tsx)"/g)].map((m) => m[1]!).filter((f) => f !== "primitives.tsx");
  return [src, ...local.flatMap((f) => roomSources(f, seen))];
}

function eggSource(room: RoomId): string {
  const src = readFileSync(join(ROOMS_DIR, "EasterEggs.tsx"), "utf8");
  const start = src.indexOf(`function ${EGGS[room]}(`);
  if (start < 0) return "";
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

describe("ROOM_MODELS", () => {
  for (const room of ROOM_IDS) {
    it(`lists every file the ${room}'s props load from`, () => {
      const ids = [...roomSources(FILES[room]), eggSource(room)].flatMap(idsIn);
      const missing = [...new Set(ids.map((id) => modelFile(id, BUNDLES)))].filter((f) => !ROOM_MODELS[room].includes(f));
      expect(missing).toEqual([]);
    });
  }

  it("names only files that exist", () => {
    for (const files of Object.values(ROOM_MODELS)) for (const f of files) expect(existsSync(join(LIB_DIR, `${f}.glb`)), f).toBe(true);
  });
});
