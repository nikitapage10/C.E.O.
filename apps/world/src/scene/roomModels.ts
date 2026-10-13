import type { RoomId } from "@ceo/core";

/**
 * The library files (a pack, or a model with a file of its own) each room's props come from. scene/streaming.ts
 * fetches them as the room starts loading, so its props never wait their turn behind the rest of the scene. A file
 * missing here still loads, just later; roomModels.test.ts checks each room's props are covered.
 */
export const ROOM_MODELS: Record<RoomId, readonly string[]> = {
  foundry: ["fantasy-props", "scifi-essentials", "scifi-modular"],
  spire: ["downtown", "fantasy-props", "nature", "scifi-essentials"],
  exchange: ["scifi-modular", "animals/Bull"],
  green: ["downtown", "medieval", "nature"],
  relay: ["fantasy-props"],
  archive: ["fantasy-props", "fantasy-props/Chest_Wood", "nature"],
  breakroom: ["nature"],
  boiler: [],
  workshop: ["fantasy-props", "nature", "scifi-essentials"],
};

/** The file a library model id loads from: its pack's bundle, or its own file. */
export function modelFile(id: string, bundles: Record<string, string>): string {
  return bundles[id] ?? id;
}
