import { useGLTF } from "@react-three/drei";

/**
 * Models from the CC0 library (github.com/nikitapage10/models), vendored into public/models/lib by
 * scripts/vendor-models.mjs from apps/world/library.json. They're meshopt-compressed, so every load decodes.
 */
export const libUrl = (id: string) => `${import.meta.env.BASE_URL}models/lib/${id}.glb`;

/** Load a library model by id ("nature/CommonTree_1"). Suspends until it arrives. */
export function useLib(id: string) {
  return useGLTF(libUrl(id), false, true);
}

/** Start fetching models before anything asks for them. */
export function preloadLib(...ids: string[]) {
  for (const id of ids) useGLTF.preload(libUrl(id), false, true);
}
