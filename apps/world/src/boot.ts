import { create } from "zustand";

/** Whether the world has finished its first proper frames (assets in, shaders compiled). */
export const useBoot = create<{ sceneReady: boolean; setSceneReady: () => void }>((set) => ({
  sceneReady: false,
  setSceneReady: () => set({ sceneReady: true }),
}));
