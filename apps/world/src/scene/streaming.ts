import { ROOM_IDS, type RoomId } from "@ceo/core";
import { SAMPLE_AGENTS } from "@ceo/simulator";
import { bodyModels } from "../agents/bodies/assets.ts";
import { useCast } from "../cast/castStore.ts";
import { flushPreloads, libUrl, preloadNow } from "../fx/library.ts";
import { MODEL as BROGU } from "../pets/Brogu.tsx";
import { LIBRARY_PETS } from "../pets/LibraryPet.tsx";
import { MODEL as MYSHKA } from "../pets/Myshka.tsx";
import { MODEL as OWLBEAR } from "../pets/Owlbear.tsx";
import { PETS, petStart, type PetKind } from "../pets/pets.ts";
import { useWorld } from "../store.ts";
import { ROOM_MODELS } from "./roomModels.ts";
import { useStreaming } from "./roomScope.ts";

/**
 * Room-first loading. Opened on a room (/lattice?room=foundry, the Desk's room links), the Lattice fetches what that
 * room needs (its props, the agents and pets in it), lifts the curtain on it at full detail, then streams the other
 * rooms' props, agents and pets in behind it. Their walls, floors, lights and furniture built in code are there from
 * the start, so the light count (and every shader) stays the same as they fill in. Opened on the overview, everything
 * loads, as before, but all at once instead of in waves.
 *
 * Whatever is fetched ahead of need (bodies in the studio's wardrobe, House frames) waits until the world on screen
 * is in (fx/library.ts, preloadLib).
 */

/** Each pet's model. */
const PET_MODELS: Record<PetKind, string> = {
  kitten: MYSHKA,
  brogu: BROGU,
  owlbear: OWLBEAR,
  shiba: LIBRARY_PETS.shiba.model,
  mushnub: LIBRARY_PETS.mushnub.model,
};

/** Skippy over the Kernel, seen from every room. */
const KERNEL_MODELS = [libUrl("custom/Skippy")];

let booted = false;
let readied = false;

/** What a set of rooms needs on screen: their props, the bodies the cast in them wears, their pets. */
function modelsFor(rooms: ReadonlySet<RoomId>): string[] {
  const urls = new Set<string>(KERNEL_MODELS);
  for (const room of rooms) for (const id of ROOM_MODELS[room]) urls.add(libUrl(id));
  const profiles = useCast.getState().cast.profiles;
  const agents = useWorld.getState().lattice.agents;
  for (const a of SAMPLE_AGENTS) {
    const room = agents[a.id]?.place.room ?? a.home.room;
    const body = profiles[a.id]?.look.body;
    if (body && rooms.has(room)) for (const url of bodyModels(body)) urls.add(url);
  }
  for (const p of PETS) if (rooms.has(petStart(p))) urls.add(libUrl(PET_MODELS[p.kind]));
  return [...urls];
}

/** Let the other rooms in, and fetch what they need. */
function release() {
  if (useStreaming.getState().all) return;
  useStreaming.setState({ all: true });
  preloadNow(...modelsFor(new Set(ROOM_IDS)));
  if (readied) whenIdle(flushPreloads);
}

function whenIdle(fn: () => void, timeout = 1500) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
}

/**
 * Called once, as the Lattice mounts, with the room it opened on (if any). Starts fetching what's on screen before
 * the scene has rendered, so nothing waits behind anything else.
 */
export function bootStreaming(first: RoomId | null) {
  if (booted) return;
  booted = true;
  const room = first && (ROOM_IDS as readonly string[]).includes(first) ? first : null;
  useStreaming.setState({ first: room, all: room === null });
  preloadNow(...modelsFor(new Set(room ? [room] : ROOM_IDS)));
  if (!room) return;
  // Leaving the first room for anywhere else brings the rest in at once.
  const off = useWorld.subscribe((s) => {
    if (s.focus === room) return;
    // The room link sets focus just after mount; ignore the moment before it lands.
    if (s.focus === null && !readied) return;
    off();
    release();
  });
}

/** The curtain is up on the world on screen: stream in the rest when the browser is next idle. */
export function streamingReady() {
  if (readied) return;
  readied = true;
  whenIdle(() => {
    if (useStreaming.getState().all) flushPreloads();
    else release();
  });
}
