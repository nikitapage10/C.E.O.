import { create } from "zustand";

/** Whether the world has finished its first proper frames (assets in, shaders compiled). */
export const useBoot = create<{ sceneReady: boolean; setSceneReady: () => void }>((set) => ({
  sceneReady: false,
  setSceneReady: () => {
    markBoot("scene");
    set({ sceneReady: true });
  },
}));

/**
 * When each stage of loading the Lattice finished, in ms since the page started loading: `lattice` (its code ran),
 * `scene` (shaders compiled), `models` (nothing left loading), `curtain` (the loading screen lifted). Read it from
 * the console with window.__ceo.boot(), on a real machine, to see where the wait goes.
 */
export const bootMarks: Record<string, number> = {};

export function markBoot(stage: string) {
  if (!(stage in bootMarks)) bootMarks[stage] = Math.round(performance.now());
}
