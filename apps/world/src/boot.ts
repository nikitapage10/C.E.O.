import { create } from "zustand";

interface BootStore {
  /** The world on screen has its shaders compiled and has drawn a few frames. */
  sceneReady: boolean;
  setSceneReady: () => void;
  /**
   * Whether the canvas draws at all. It waits for the first shader compile (scene/SceneReady.tsx), so no frame stops
   * to compile a program in the middle of drawing (#327), and the loading screen lifting turns it on regardless.
   */
  drawing: boolean;
  startDrawing: () => void;
}

export const useBoot = create<BootStore>((set) => ({
  sceneReady: false,
  setSceneReady: () => {
    markBoot("scene");
    set({ sceneReady: true, drawing: true });
  },
  drawing: false,
  startDrawing: () => set({ drawing: true }),
}));

/**
 * When each stage of loading the Lattice finished, in ms since the page started loading: `lattice` (its code ran),
 * `compiled` (the first shader compile finished and the canvas starts drawing), `scene` (shaders compiled and a few frames drawn), `models` (nothing left loading), `curtain` (the loading screen lifted). Read it from
 * the console with window.__ceo.boot(), on a real machine, to see where the wait goes.
 */
export const bootMarks: Record<string, number> = {};

export function markBoot(stage: string) {
  if (!(stage in bootMarks)) bootMarks[stage] = Math.round(performance.now());
}
