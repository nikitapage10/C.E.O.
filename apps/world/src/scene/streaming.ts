import { ROOM_IDS, roomCenter, type RoomId } from "@ceo/core";
import { SAMPLE_AGENTS } from "@ceo/simulator";
import { bodyModels } from "../agents/bodies/assets.ts";
import { useCast } from "../cast/castStore.ts";
import { useProgress } from "@react-three/drei";
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
 * the start, so the light count (and every shader) stays the same as they fill in. Opened on the overview (#373), the
 * rooms nearest its camera, the biggest on screen, come first (NEAR of them), and the rest of the ring the same way.
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

/** Where the overview's camera starts (Scene.tsx), and how many of the rooms nearest it load first. */
const OVERVIEW_EYE = [0, 66, 96] as const;
export const NEAR = 4;

/** The rooms nearest the overview's camera, nearest first: what fills most of the screen when the Lattice opens. */
export function nearestRooms(n = NEAR): RoomId[] {
  const d = (r: RoomId) => {
    const [x, y, z] = roomCenter(r);
    return Math.hypot(x - OVERVIEW_EYE[0], y - OVERVIEW_EYE[1], z - OVERVIEW_EYE[2]);
  };
  return [...ROOM_IDS].sort((a, b) => d(a) - d(b)).slice(0, n);
}

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

/** Resolves once nothing is loading (the models asked for so far are all in), or after `ms` at the latest. */
function settled(ms = 20000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      // useProgress only notices a load on its next tick, so give a just-started fetch a moment to register.
      if ((performance.now() - start > 100 && !useProgress.getState().active) || performance.now() - start > ms) resolve();
      else setTimeout(check, 100);
    };
    setTimeout(check, 0);
  });
}

/**
 * One room's step on its own (#327; the 2D map of #332 calls it when a room is picked): let it in, so its props,
 * the agents in it and its pets mount, and fetch their models. Resolves when they have arrived (each still shows
 * once its shaders are compiled, fx/Warm.tsx). The rest of the ring stays as it was; release() lets it all in.
 */
export function loadRoom(room: RoomId): Promise<void> {
  const s = useStreaming.getState();
  if (!s.all && !s.rooms.includes(room)) useStreaming.setState({ rooms: [...s.rooms, room] });
  preloadNow(...modelsFor(new Set([room])));
  return settled();
}

/** Let the other rooms in, and fetch what they need. (Brogu's eyes calls it too: he can walk anywhere.) */
export function release() {
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
  // On a room: that room. On the overview: the rooms nearest its camera.
  const rooms = room ? [room] : nearestRooms();
  useStreaming.setState({ rooms: [], all: false });
  for (const r of rooms) void loadRoom(r);
  // Going anywhere past the first rooms brings the rest in at once.
  const off = useWorld.subscribe((s) => {
    if (s.focus === room || (s.focus !== null && rooms.includes(s.focus))) return;
    // The room link sets focus just after mount; ignore the moment before it lands.
    if (s.focus === null && (room === null || !readied)) return;
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
