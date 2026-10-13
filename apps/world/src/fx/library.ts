import { useGLTF } from "@react-three/drei";

/** Each model's content hash, from vite.config.ts (absent in tests). */
declare const __MODEL_VERSIONS__: Record<string, string> | undefined;
const VERSIONS: Record<string, string> = typeof __MODEL_VERSIONS__ === "undefined" ? {} : __MODEL_VERSIONS__;

/**
 * A model under public/models ("lib/custom/Rocky.glb"), tagged with its content hash: the browser keeps it for good
 * (vercel.json) and still fetches a new one as soon as the file changes.
 */
export function modelUrl(path: string) {
  const v = VERSIONS[path];
  return `${import.meta.env.BASE_URL}models/${path}${v ? `?v=${v}` : ""}`;
}

/**
 * Models from the CC0 library (github.com/nikitapage10/models), vendored into public/models/lib by
 * scripts/vendor-models.mjs from apps/world/library.json. They're meshopt-compressed, so every load decodes.
 */
export const libUrl = (id: string) => modelUrl(`lib/${id}.glb`);

/** Load a library model by id ("nature/CommonTree_1"). Suspends until it arrives. */
export function useLib(id: string) {
  return useGLTF(libUrl(id), false, true);
}

/** Start fetching models (full URLs) now. Anything already cached or on its way is left alone. */
export function preloadNow(...urls: string[]) {
  for (const url of urls) useGLTF.preload(url, false, true);
}

/** Models asked for ahead of time, waiting until the world on screen has loaded (scene/streaming.ts). */
const later = new Set<string>();
let flushed = false;

/**
 * Fetch these library models once the world on screen is in, so they're warm for when they're needed (a costume
 * change, an event, a room you haven't looked at yet) without slowing the first view. What's on screen is fetched
 * first, by scene/streaming.ts, from the cast and the rooms in view.
 */
export function preloadLib(...ids: string[]) {
  preloadLater(...ids.map(libUrl));
}

/** preloadLib for models outside the library (full URLs). */
export function preloadLater(...urls: string[]) {
  if (flushed) preloadNow(...urls);
  else for (const url of urls) later.add(url);
}

/** Fetch everything preloadLib has been holding, and anything asked for from now on. */
export function flushPreloads() {
  flushed = true;
  preloadNow(...later);
  later.clear();
}
